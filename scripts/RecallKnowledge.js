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
