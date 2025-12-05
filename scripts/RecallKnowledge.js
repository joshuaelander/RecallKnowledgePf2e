Hooks.once('init', () => {
  console.log('Recall Knowledge | Initializing');
});

Hooks.once('ready', () => {
  console.log('Recall Knowledge | Ready');
  
  // Make function globally accessible
  game.recallKnowledge = {
    openDialog: openRecallKnowledgeDialog
  };
  
  // You can also create a macro automatically
  createRecallKnowledgeMacro();
});

// Add button to scene controls
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

// [Include all the functions from above here]

async function createRecallKnowledgeMacro() {
  // Check if macro already exists
  const existingMacro = game.macros.find(m => m.name === "Recall Knowledge");
  if (existingMacro) return;

  // Create the macro
  await Macro.create({
    name: "Recall Knowledge",
    type: "script",
    img: "icons/skills/trades/academics-study-reading-book.webp",
    command: "game.recallKnowledge.openDialog();",
    folder: null
  });
  
  console.log('Recall Knowledge | Macro created');
}

async function createRecallKnowledgeMessage(actor, skill, roll, dc, degreeOfSuccess, creatureName) {
  // Determine color based on result
  const colorMap = {
    "Critical Success": "#00aa00",
    "Success": "#0066cc",
    "Failure": "#cc6600",
    "Critical Failure": "#cc0000"
  };
  const color = colorMap[degreeOfSuccess];

  // Build the message content
  const content = `
    <div class="recall-knowledge-result" style="border-left: 4px solid ${color}; padding-left: 8px;">
      <h3>Recall Knowledge: ${creatureName}</h3>
      <p><strong>Actor:</strong> ${actor.name}</p>
      <p><strong>Skill:</strong> ${skill}</p>
      <p><strong>Roll:</strong> ${roll.total} (${roll.dice[0].results[0].result} + ${roll.total - roll.dice[0].results[0].result})</p>
      <p><strong>DC:</strong> ${dc}</p>
      <p><strong>Result:</strong> <span style="color: ${color}; font-weight: bold;">${degreeOfSuccess}</span></p>
      <hr>
      <p><em>GM: Provide information based on the degree of success.</em></p>
    </div>
  `;

  // Create the chat message (whispered to GM)
  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({actor: actor}),
    content: content,
    whisper: ChatMessage.getWhisperRecipients("GM"),
    blind: true, // This makes it a secret roll
    type: CONST.CHAT_MESSAGE_TYPES.ROLL,
    roll: roll,
    sound: CONFIG.sounds.dice
  });

  ui.notifications.info(`Recall Knowledge check made for ${actor.name}`);
}

async function performRecallKnowledge(html) {
  // Get form values
  const actorId = html.find('[name="actor"]').val();
  const skillKey = html.find('[name="skill"]').val();
  const dc = parseInt(html.find('[name="dc"]').val());
  const creatureName = html.find('[name="creature"]').val() || "Unknown Creature";

  // Get the actor
  const actor = game.actors.get(actorId);
  if (!actor) {
    ui.notifications.error("Actor not found!");
    return;
  }

  // Get the skill modifier
  const skill = actor.system.skills[skillKey];
  if (!skill) {
    ui.notifications.error("Skill not found!");
    return;
  }

  const modifier = skill.mod;
  const skillLabel = skill.label || skillKey;

  // Create the roll
  const roll = await new Roll(`1d20 + ${modifier}`).evaluate();

  // Calculate degree of success
  const degreeOfSuccess = calculateDegreeOfSuccess(roll.total, dc);

  // Create secret chat message
  await createRecallKnowledgeMessage(actor, skillLabel, roll, dc, degreeOfSuccess, creatureName);
}

function calculateDegreeOfSuccess(total, dc) {
  const difference = total - dc;
  
  if (difference >= 10) return "Critical Success";
  if (difference >= 0) return "Success";
  if (difference >= -10) return "Failure";
  return "Critical Failure";
}

function openRecallKnowledgeDialog() {
  // Get list of skills from PF2e system
  const skills = {
    'arcana': 'Arcana',
    'crafting': 'Crafting',
    'nature': 'Nature',
    'occultism': 'Occultism',
    'religion': 'Religion',
    'society': 'Society',
    'medicine': 'Medicine',
    // Add others as needed
  };

  // Build skill options HTML
  let skillOptions = '';
  for (let [key, label] of Object.entries(skills)) {
    skillOptions += `<option value="${key}">${label}</option>`;
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
        <input type="number" id="dc-input" name="dc" value="15" min="1" max="50"/>
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

function getActorOptions() {
  let options = '';
  
  // Get selected tokens first
  const controlled = canvas.tokens.controlled;
  if (controlled.length > 0) {
    controlled.forEach(token => {
      options += `<option value="${token.actor.id}">${token.actor.name}</option>`;
    });
  } else {
    // Fall back to party members
    game.actors.forEach(actor => {
      if (actor.type === 'character') {
        options += `<option value="${actor.id}">${actor.name}</option>`;
      }
    });
  }
  
  return options;
}
