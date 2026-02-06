/**
 * Genesis 2 — Story Structure Tools
 * Beat sheets, three-act structure, and pacing guides for best-seller plotting.
 */

const BEAT_SHEETS = {
  threeAct: {
    name: 'Three-Act Structure',
    description: 'Classic dramatic structure used in most best-selling fiction.',
    beats: [
      { name: 'Opening Image', percent: 0, description: 'A snapshot of the protagonist\'s world before the story begins.' },
      { name: 'Setup / Status Quo', percent: 1, description: 'Establish the world, characters, and stakes. Show the protagonist\'s ordinary life.' },
      { name: 'Inciting Incident', percent: 10, description: 'The event that disrupts the status quo and launches the story.' },
      { name: 'Debate / Refusal', percent: 12, description: 'The protagonist resists or deliberates the call to action.' },
      { name: 'Break into Act Two', percent: 25, description: 'The protagonist commits to the journey. There is no going back.' },
      { name: 'B-Story / Subplot', percent: 27, description: 'A secondary storyline begins, often carrying the theme.' },
      { name: 'Fun & Games / Promise of the Premise', percent: 30, description: 'The core experience the reader came for. The protagonist in the new world.' },
      { name: 'Midpoint', percent: 50, description: 'A major revelation or reversal. Stakes rise dramatically. False victory or false defeat.' },
      { name: 'Bad Guys Close In', percent: 55, description: 'External pressures mount. Internal flaws intensify. Allies may fracture.' },
      { name: 'All Is Lost', percent: 75, description: 'The lowest point. It appears the protagonist has failed completely.' },
      { name: 'Dark Night of the Soul', percent: 77, description: 'Emotional rock bottom. The protagonist confronts their deepest fear or flaw.' },
      { name: 'Break into Act Three', percent: 80, description: 'A new idea or insight emerges from the darkness. The protagonist resolves to fight.' },
      { name: 'Climax', percent: 88, description: 'The final confrontation. The protagonist faces the antagonist with everything at stake.' },
      { name: 'Resolution', percent: 95, description: 'The aftermath. New status quo established. Character transformation is evident.' },
      { name: 'Final Image', percent: 100, description: 'Mirror of the opening image, showing how much has changed.' }
    ]
  },

  heroJourney: {
    name: 'Hero\'s Journey',
    description: 'Joseph Campbell\'s monomyth adapted for modern storytelling.',
    beats: [
      { name: 'Ordinary World', percent: 0, description: 'The hero\'s normal life before the adventure.' },
      { name: 'Call to Adventure', percent: 10, description: 'A challenge or quest is presented.' },
      { name: 'Refusal of the Call', percent: 14, description: 'The hero hesitates, showing fear or reluctance.' },
      { name: 'Meeting the Mentor', percent: 18, description: 'A guide appears to prepare the hero.' },
      { name: 'Crossing the Threshold', percent: 25, description: 'The hero leaves the ordinary world.' },
      { name: 'Tests, Allies, Enemies', percent: 30, description: 'The hero faces challenges and discovers who can be trusted.' },
      { name: 'Approach to the Inmost Cave', percent: 45, description: 'Preparation for the major challenge ahead.' },
      { name: 'The Ordeal', percent: 50, description: 'The hero faces their greatest test yet — a death and rebirth moment.' },
      { name: 'Reward', percent: 60, description: 'The hero seizes what they came for.' },
      { name: 'The Road Back', percent: 75, description: 'The hero returns, but dangers follow.' },
      { name: 'Resurrection', percent: 88, description: 'Final test where the hero is transformed.' },
      { name: 'Return with the Elixir', percent: 95, description: 'The hero returns changed, bearing wisdom or a prize for the world.' }
    ]
  },

  sevenPoint: {
    name: 'Seven-Point Structure',
    description: 'Dan Wells\' streamlined plot framework.',
    beats: [
      { name: 'Hook', percent: 0, description: 'Opposite state of the resolution. Show where the protagonist starts.' },
      { name: 'Plot Turn 1', percent: 15, description: 'Introduce the conflict. The world changes.' },
      { name: 'Pinch Point 1', percent: 30, description: 'Apply pressure. Force the protagonist to act.' },
      { name: 'Midpoint', percent: 50, description: 'The protagonist moves from reaction to action.' },
      { name: 'Pinch Point 2', percent: 70, description: 'More pressure. The situation seems hopeless.' },
      { name: 'Plot Turn 2', percent: 85, description: 'The protagonist gains the final piece needed to succeed.' },
      { name: 'Resolution', percent: 100, description: 'The conflict is resolved. Opposite state of the hook.' }
    ]
  },

  kishoutenketsu: {
    name: 'Kishoutenketsu',
    description: 'East Asian four-act structure. Conflict emerges from juxtaposition rather than opposition.',
    beats: [
      { name: 'Ki (Introduction)', percent: 0, description: 'Introduce the characters and setting. Establish the tone.' },
      { name: 'Shou (Development)', percent: 25, description: 'Develop the narrative. Deepen the world without dramatic conflict.' },
      { name: 'Ten (Twist)', percent: 50, description: 'An unexpected element is introduced that shifts the perspective entirely.' },
      { name: 'Ketsu (Conclusion)', percent: 75, description: 'Reconcile the twist with the established narrative. New understanding emerges.' }
    ]
  }
};

class StructureManager {
  constructor() {
    this.templates = BEAT_SHEETS;
  }

  getTemplates() {
    return Object.entries(this.templates).map(([key, val]) => ({
      id: key,
      name: val.name,
      description: val.description,
      beatCount: val.beats.length
    }));
  }

  getTemplate(id) {
    return this.templates[id] || null;
  }

  /**
   * Map beats to actual word count / chapter positions.
   */
  mapBeatsToManuscript(templateId, targetWords, currentWords) {
    const template = this.templates[templateId];
    if (!template) return [];

    return template.beats.map(beat => {
      const targetWordPosition = Math.round((beat.percent / 100) * targetWords);
      const isReached = currentWords >= targetWordPosition;

      return {
        ...beat,
        targetWordPosition,
        isReached,
        approximatePage: Math.ceil(targetWordPosition / 250)
      };
    });
  }

  /**
   * Determine which story beat the writer is currently at based on word count.
   */
  getCurrentBeat(templateId, targetWords, currentWords) {
    const beats = this.mapBeatsToManuscript(templateId, targetWords, currentWords);
    let current = beats[0];

    for (const beat of beats) {
      if (currentWords >= beat.targetWordPosition) {
        current = beat;
      } else {
        break;
      }
    }

    return current;
  }

  /**
   * Get pacing guidance: what should be happening at this point in the story.
   */
  getPacingGuidance(templateId, targetWords, currentWords) {
    const currentBeat = this.getCurrentBeat(templateId, targetWords, currentWords);
    const beats = this.mapBeatsToManuscript(templateId, targetWords, currentWords);
    const currentIndex = beats.findIndex(b => b.name === currentBeat.name);
    const nextBeat = beats[currentIndex + 1] || null;

    const progress = targetWords > 0 ? (currentWords / targetWords) * 100 : 0;

    return {
      currentBeat,
      nextBeat,
      progress: Math.min(100, Math.round(progress * 10) / 10),
      wordsRemaining: Math.max(0, targetWords - currentWords),
      wordsToNextBeat: nextBeat ? Math.max(0, nextBeat.targetWordPosition - currentWords) : 0
    };
  }
}

export { StructureManager, BEAT_SHEETS };
