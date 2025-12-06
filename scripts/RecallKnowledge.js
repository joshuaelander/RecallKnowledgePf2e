// RecallKnowledge.js (Patched for Foundry V13 + PF2e)
// Supports multiple selected actors (controlled tokens) or the whole party if none selected.

Hooks.once('init', () => {
  console.log('Recall Knowledge | Initializing');
});

Hooks.once('ready', () => {
  console.log('Recall Knowledge | Ready');

  // Make function globally accessible
  game.recallKnowledge = {
    openDialog: openRecallKnowledgeDialog
  };

  // Try to create a macro for convenience (only if user can create macros)
  createRecallKnowledgeMacro();
});

async function createRecallKnowledgeMacro() {
  try {
    if (!game.user.isGM) return; // Only GMs create macros by default
    const existingMacro = game.macros.find(m => m.name === 'Recall Knowledge' && m.command?.includes('game.recallKnowledge.openDialog'));
    if (existingMacro) return;

    await Macro.create({
      name: 'Quick Recall Knowledge',
      type: 'script',
      img: 'icons/skills/trades/academics-study-reading-book.webp',
      command: 'game.recallKnowledge.openDialog();',
      folder: null,
      flags: {}
    });

    console.log('Recall Knowledge | Macro created');
  } catch (err) {
    console.warn('Recall Knowledge | Failed to create macro:', err);
  }
}

/**
 * Create the secret aggregated chat message for multiple recall knowledge checks.
 * Whispered to all GMs (GM-only).
 */
async function createAggregatedRecallMessage(results, dc, creatureName) {
  // Determine color based on result
  const colorMap = {
    'Critical Success': '#00aa00',
    'Success': '#0066cc',
    'Failure': '#cc6600',
    'Critical Failure': '#cc0000'
  };

  // Build HTML summary table
  let rows = '';
  for (const res of results) {
    const color = colorMap[res.degree] || '#000000';
    const d20display = res.d20 !== null ? `${res.d20}` : '—';
    const breakdown = res.d20 !== null ? `${d20display} + ${res.total - res.d20}` : `${res.total}`;
    rows += `
      <div class="recall-knowledge-row" style="border-left: 4px solid ${color}; padding-left:8px; margin-bottom:6px;">
        <strong>${escapeHtml(res.actorName)}</strong> — ${escapeHtml(res.skillLabel)}:
        <span>${res.total} (${escapeHtml(breakdown)})</span>
        &nbsp;|&nbsp;
        <span style="color:${color}; font-weight:bold;">${escapeHtml(res.degree)}</span>
      </div>
    `;
  }

  // Title: include creature name only if provided (otherwise show generic title)
  const title = creatureName ? `Recall Knowledge: ${escapeHtml(creatureName)} (DC ${dc})` : `Recall Knowledge (DC ${dc})`;

  const content = `
    <div class="recall-knowledge-result" style="padding:6px;">
      <h3>${title}</h3>
      ${rows}
    </div>
  `;

  // Whisper recipients: all GM user ids
  const gmIds = game.users.filter(u => u.isGM).map(u => u.id);

  // Create a single GM-only chat message with the aggregated results
  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor: null }),
    content: content,
    whisper: gmIds,
    blind: true
  });

  ui.notifications.info(`Recall Knowledge checks completed for ${results.length} actor(s).`);
}

/**
 * Perform recall knowledge checks for multiple actors (controlled tokens or whole party if none controlled).
 */
async function performRecallKnowledge(html) {
  // Get form values
  const skillKey = html.find('[name="skill"]').val();
  const dcValue = html.find('[name="dc"]').val();
  const dc = parseInt(dcValue, 10) || 0;
  const creatureInput = (html.find('[name="creature"]').val() || '').trim();

  // Determine creature name: prefer explicit input, otherwise use first targeted token (if any), otherwise empty
  let creatureName = '';
  if (creatureInput) {
    creatureName = creatureInput;
  } else {
    const targets = Array.from(game.user.targets ?? []);
    if (targets.length > 0) {
      const t = targets[0];
      creatureName = t?.name ?? t?.actor?.name ?? '';
    }
  }

  // Determine target actors:
  // If there are controlled tokens, use their actors (unique).
  // Otherwise, look for an actor folder named "party" (case-insensitive) and use actors in it.
  // If no such folder or it's empty, fall back to player characters / actors with player owners.
  const controlled = canvas?.tokens?.controlled ?? [];
  let targetActors = [];

  if (controlled.length > 0) {
    const seen = new Set();
    for (const token of controlled) {
      const actor = token.actor;
      if (actor && !seen.has(actor.id)) {
        targetActors.push(actor);
        seen.add(actor.id);
      }
    }
  } else {
    // Try to find an actor Folder named "party" (case-insensitive)
    const actorFolders = game.folders.filter(f => f.type === 'Actor');
    const partyFolder = actorFolders.find(f => (f.name || '').toLowerCase() === 'party');

    if (partyFolder) {
      for (const actor of game.actors.values()) {
        if (actor.folder?.id === partyFolder.id) {
          targetActors.push(actor);
        }
      }
    }

    // Fallback: if no party folder or it's empty, use player characters / actors with player owners
    if (targetActors.length === 0) {
      for (const actor of game.actors.values()) {
        if (actor && (actor.type === 'character' || actor.hasPlayerOwner)) {
          // actor.hasPlayerOwner is true when at least one player has ownership
          targetActors.push(actor);
        }
      }
    }
  }

  if (targetActors.length === 0) {
    ui.notifications.error('No target actors found (no controlled tokens and no party actors).');
    return;
  }

  // For each actor, resolve skill info and roll
  const rollPromises = targetActors.map(async (actor) => {
    const skillInfo = getSkillInfo(actor, skillKey);
    const skillLabel = skillInfo?.label ?? skillKey;

    const modifier = Number(skillInfo?.mod ?? skillInfo?.value ?? skillInfo?.total ?? 0);
    const safeModifier = Number.isFinite(modifier) ? modifier : 0;
    const formula = `1d20 ${safeModifier >= 0 ? '+' : '-'} ${Math.abs(safeModifier)}`;

    let roll;
    try {
      roll = await new Roll(formula).evaluate({ async: true });
    } catch (err) {
      console.error('Recall Knowledge | Roll failed for', actor.name, err);
      // Provide a fallback "failed roll" object
      roll = { total: 0, dice: [], toJSON: () => ({}) }; 
    }

    // Safely extract d20 raw result
    let d20Result = null;
    try {
      const d20Term = roll.dice?.find(d => d.faces === 20);
      d20Result = d20Term?.results?.[0]?.result ?? null;
    } catch (e) {
      d20Result = null;
    }

    const degree = calculateDegreeOfSuccess(roll.total, dc);

    return {
      actorId: actor.id,
      actorName: actor.name,
      skillLabel: skillLabel,
      total: roll.total ?? 0,
      d20: d20Result,
      degree: degree,
      roll: roll
    };
  });

  // Wait for all rolls
  let results;
  try {
    results = await Promise.all(rollPromises);
  } catch (err) {
    console.error('Recall Knowledge | Error evaluating rolls:', err);
    ui.notifications.error('Error performing one or more rolls.');
    return;
  }

  // Create aggregated GM-only chat message summarizing all actors
  await createAggregatedRecallMessage(results, dc, creatureName);
}

/**
 * Degree of success calculation using a simple difference-based scale.
 */
function calculateDegreeOfSuccess(total, dc) {
  const difference = total - dc;

  if (difference >= 10) return 'Critical Success';
  if (difference >= 0) return 'Success';
  if (difference >= -9) return 'Failure'; // failure for difference -9..-1
  return 'Critical Failure'; // difference <= -10
}

/**
 * Open the Recall Knowledge dialog.
 * Note: Actor selection is driven by controlled tokens. If none are selected, checks will be run for the whole party.
 */
function openRecallKnowledgeDialog() {
  // Static PF2e skill map (adjust if you need additional skills)
  const skills = {
    'arcana': 'Arcana',
    'crafting': 'Crafting',
    'nature': 'Nature',
    'occultism': 'Occultism',
    'religion': 'Religion',
    'society': 'Society',
    'medicine': 'Medicine',
    'athletics': 'Athletics',
    'acrobatics': 'Acrobatics',
    'stealth': 'Stealth'
  };

  // Build skill options HTML
  let skillOptions = '';
  for (let [key, label] of Object.entries(skills)) {
    skillOptions += `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`;
  }

  // Determine if a "party" actor folder exists (case-insensitive)
  const actorFolders = game.folders.filter(f => f.type === 'Actor');
  const partyFolder = actorFolders.find(f => (f.name || '').toLowerCase() === 'party');

  // Note: We do not include an actor select. The module uses the currently controlled tokens (supports multiple).
  // If no tokens are controlled, it falls back to the party (player characters) or the 'party' actor folder if present.
  const selectionNote = (canvas?.tokens?.controlled?.length > 0)
    ? `<p><em>Using ${canvas.tokens.controlled.length} selected token(s).</em></p>`
    : (partyFolder ? `<p><em>No tokens selected — will use actors in the "${escapeHtml(partyFolder.name)}" folder.</em></p>`
      : `<p><em>No tokens selected — will use the whole party (player characters / actors with player owners).</em></p>`);

  const content = `
    <form>
      <div class="form-group">
        <label>Skill:</label>
        <select id="skill-select" name="skill">
          ${skillOptions}
        </select>
      </div>
      <div class="form-group">
        <label>DC:</label>
        <input type="number" id="dc-input" name="dc" value="15" min="1" max="100"/>
      </div>
      <div class="form-group">
        <label>Creature Name (optional):</label>
        <input type="text" id="creature-name" name="creature" placeholder="(optional)"/>
      </div>
      <div class="form-group">
        ${selectionNote}
        <p><em>Note: If you want to check specific actors, select their tokens before opening this dialog.</em></p>
      </div>
    </form>
  `;

  new Dialog({
    title: 'Recall Knowledge Check (Multiple Targets)',
    content: content,
    buttons: {
      roll: {
        icon: '<i class="fas fa-dice-d20"></i>',
        label: 'Roll for Targets',
        callback: (html) => performRecallKnowledge(html)
      },
      cancel: {
        icon: '<i class="fas fa-times"></i>',
        label: 'Cancel'
      }
    },
    default: 'roll'
  }).render(true);
}

/**
 * Defensive helper to find skill data on a PF2e actor.
 * Returns an object with { mod, label, ... } or null if not found.
 */
function getSkillInfo(actor, skillKey) {
  // PF2e typically stores skills at actor.system.skills[skillKey]
  const systemData = actor.system ?? actor.data?.system ?? {};
  const skills = systemData.skills ?? null;

  if (skills && skills[skillKey]) {
    return skills[skillKey];
  }

  // Try older shapes or flattened names
  if (actor.data?.data?.skills && actor.data.data.skills[skillKey]) {
    return actor.data.data.skills[skillKey];
  }

  // Try searching keys for a match (case-insensitive)
  if (skills) {
    const foundKey = Object.keys(skills).find(k => k.toLowerCase() === skillKey.toLowerCase());
    if (foundKey) return skills[foundKey];
  }

  return null;
}

/**
 * Simple HTML escape to avoid injection in chat content/options.
 */
function escapeHtml(unsafe) {
  if (unsafe === undefined || unsafe === null) return '';
  return String(unsafe)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
