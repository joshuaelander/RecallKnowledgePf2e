// RecallKnowledge.js (Patched for Foundry V13 + PF2e)

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

// Add button to scene controls (GM only)
Hooks.on('getSceneControlButtons', (controls) => {
  if (!game.user.isGM) return;

  const tokenControls = controls.find(c => c.name === "token");
  if (tokenControls) {
    tokenControls.tools.push({
      name: "recall-knowledge",
      title: "Recall Knowledge Check",
      icon: "fas fa-brain",
      button: true,
      onClick: () => openRecallKnowledgeDialog()
    });
  }
});

async function createRecallKnowledgeMacro() {
  try {
    if (!game.user.isGM) return; // Only GMs create macros by default
    const existingMacro = game.macros.find(m => m.name === "Recall Knowledge" && m.command?.includes("game.recallKnowledge.openDialog"));
    if (existingMacro) return;

    await Macro.create({
      name: "Recall Knowledge",
      type: "script",
      img: "icons/skills/trades/academics-study-reading-book.webp",
      command: "game.recallKnowledge.openDialog();",
      folder: null,
      flags: {}
    });

    console.log('Recall Knowledge | Macro created');
  } catch (err) {
    console.warn('Recall Knowledge | Failed to create macro:', err);
  }
}

/**
 * Create the secret chat message for the recall knowledge check.
 * The roll is whispered to GMs only and marked blind so players don't see it.
 */
async function createRecallKnowledgeMessage(actor, skillLabel, roll, dc, degreeOfSuccess, creatureName) {
  // Determine color based on result
  const colorMap = {
    "Critical Success": "#00aa00",
    "Success": "#0066cc",
    "Failure": "#cc6600",
    "Critical Failure": "#cc0000"
  };
  const color = colorMap[degreeOfSuccess] || "#000000";

  // Safely extract the d20 raw result (if present)
  let d20Result = null;
  try {
    const d20Term = roll.dice?.find(d => d.faces === 20);
    d20Result = d20Term?.results?.[0]?.result ?? null;
  } catch (e) {
    d20Result = null;
  }

  // Build a visible GM-only content
  const gmContent = `
    <div class="recall-knowledge-result" style="border-left: 4px solid ${color}; padding-left: 8px;">
      <h3>Recall Knowledge: ${escapeHtml(creatureName)}</h3>
      <p><strong>Actor:</strong> ${escapeHtml(actor.name)}</p>
      <p><strong>Skill:</strong> ${escapeHtml(skillLabel)}</p>
      <p><strong>Roll:</strong> ${roll.total}${d20Result !== null ? ` (${d20Result} + ${roll.total - d20Result})` : ''}</p>
      <p><strong>DC:</strong> ${dc}</p>
      <p><strong>Result:</strong> <span style="color: ${color}; font-weight: bold;">${degreeOfSuccess}</span></p>
      <hr>
      <p><em>GM: Provide information based on the degree of success.</em></p>
    </div>
  `;

  // Whisper recipients: all GM user ids
  const gmIds = game.users.filter(u => u.isGM).map(u => u.id);

  // Use roll.toMessage to correctly attach the roll and whisper it to GMs.
  // Use flavor for a short visible description (for GMs only because we whisper).
  try {
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `Recall Knowledge: ${escapeHtml(creatureName)}`,
      content: gmContent,
      whisper: gmIds,
      blind: true
    });
    ui.notifications.info(`Recall Knowledge check made for ${actor.name}`);
  } catch (err) {
    // Fallback to creating a ChatMessage manually if toMessage fails
    console.error('Recall Knowledge | roll.toMessage failed, falling back to ChatMessage.create', err);
    await ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor }),
      content: gmContent,
      whisper: gmIds,
      blind: true,
      type: CONST.CHAT_MESSAGE_TYPES.ROLL,
      roll: roll.toJSON?.() ?? roll,
      sound: CONFIG.sounds?.dice
    });
    ui.notifications.info(`Recall Knowledge check made for ${actor.name}`);
  }
}

/**
 * Perform the recall knowledge check using values from the dialog HTML.
 */
async function performRecallKnowledge(html) {
  // Get form values
  const actorId = html.find('[name="actor"]').val();
  const skillKey = html.find('[name="skill"]').val();
  const dcValue = html.find('[name="dc"]').val();
  const dc = parseInt(dcValue, 10) || 0;
  const creatureName = html.find('[name="creature"]').val() || "Unknown Creature";

  // Get the actor
  const actor = game.actors.get(actorId);
  if (!actor) {
    ui.notifications.error("Actor not found!");
    return;
  }

  // Resolve skill modifier in a defensive way to handle PF2e data shapes
  const skillInfo = getSkillInfo(actor, skillKey);
  if (!skillInfo) {
    ui.notifications.error(`Skill "${skillKey}" not found on actor ${actor.name}`);
    return;
  }

  const modifier = Number(skillInfo.mod ?? skillInfo.value ?? skillInfo.total ?? 0);
  const skillLabel = skillInfo.label ?? skillKey;

  // Ensure modifier is a number
  const safeModifier = Number.isFinite(modifier) ? modifier : 0;

  // Build formula (use parentheses for negative modifiers)
  const formula = `1d20 ${safeModifier >= 0 ? '+' : '-'} ${Math.abs(safeModifier)}`;

  // Create and evaluate the roll using the async API
  let roll;
  try {
    roll = await new Roll(formula).evaluate({ async: true });
  } catch (err) {
    console.error('Recall Knowledge | Roll failed:', err);
    ui.notifications.error("Failed to roll dice.");
    return;
  }

  // Calculate degree of success
  const degreeOfSuccess = calculateDegreeOfSuccess(roll.total, dc);

  // Create secret chat message (whispered to GM)
  await createRecallKnowledgeMessage(actor, skillLabel, roll, dc, degreeOfSuccess, creatureName);
}

/**
 * Degree of success calculation using a simple difference-based scale.
 */
function calculateDegreeOfSuccess(total, dc) {
  const difference = total - dc;

  if (difference >= 10) return "Critical Success";
  if (difference >= 0) return "Success";
  if (difference >= -9) return "Failure"; // failure for difference -9..-1
  return "Critical Failure"; // difference <= -10
}

/**
 * Open the Recall Knowledge dialog.
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

  const content = `
    <form>
      <div class="form-group">
        <label>Select Actor:</label>
        <select id="actor-select" name="actor">
          ${getActorOptions()}
        </select>
      </div>
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
        <input type="text" id="creature-name" name="creature" placeholder="Unknown Creature"/>
      </div>
    </form>
  `;

  new Dialog({
    title: "Recall Knowledge Check",
    content: content,
    buttons: {
      roll: {
        icon: '<i class="fas fa-dice-d20"></i>',
        label: "Roll",
        callback: (html) => performRecallKnowledge(html)
      },
      cancel: {
        icon: '<i class="fas fa-times"></i>',
        label: "Cancel"
      }
    },
    default: "roll"
  }).render(true);
}

/**
 * Build actor option elements. Prefer controlled tokens; otherwise list player characters and NPC tokens.
 */
function getActorOptions() {
  let options = '';

  // Controlled tokens take precedence
  const controlled = canvas?.tokens?.controlled ?? [];
  if (controlled.length > 0) {
    // Include each controlled token's actor (may include NPCs)
    controlled.forEach(token => {
      const actor = token.actor;
      if (actor) {
        options += `<option value="${escapeHtml(actor.id)}">${escapeHtml(actor.name)}</option>`;
      }
    });
  } else {
    // Fall back to visible actors (characters and NPCs)
    for (const actor of game.actors.values()) {
      // Optionally filter for player characters only: if (actor.type === 'character')
      options += `<option value="${escapeHtml(actor.id)}">${escapeHtml(actor.name)}</option>`;
    }
  }

  return options;
}

/**
 * Defensive helper to find skill data on a PF2e actor.
 * Returns an object with { mod, label, ... } or null if not found.
 */
function getSkillInfo(actor, skillKey) {
  // PF2e typically stores skills at actor.system.skills[skillKey]
  const systemData = actor.system ?? actor.data?.system ?? {};
  const skills = systemData.skills ?? systemData?.abilities ?? null;

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
