/**
 * Genesis 4 — Ghost Author Module
 *
 * Replaces the 3,000-word constraint-based system prompt with a ~500-word
 * "Ghost Author" prompt built around reference passages. Instead of telling
 * the model what NOT to do (50+ rules), we show it what TO do (a reference
 * passage that demonstrates the target register, rhythm, and craft level).
 *
 * LLMs are dramatically better at imitation than rule-following. A single
 * paragraph of target prose is more effective than 40 prohibition rules.
 */

// ═══════════════════════════════════════════════════════════
//  REFERENCE PASSAGES — Per-genre exemplars of target prose
// ═══════════════════════════════════════════════════════════

const REFERENCE_PASSAGES = {
  'literary-fiction': {
    label: 'Literary Fiction',
    passages: [
      {
        source: 'Marilynne Robinson style',
        text: `The light in the kitchen had the quality of water in a glass, clear and still. She set the kettle on the stove and listened to the house settle around her. The third step from the top had been loose since before the war, and she had never fixed it because the sound it made was the sound of someone coming home. The kettle began to whisper. She stood at the window and watched the snow fill in the tracks her son had left that morning, heading for the bus stop, his coat unbuttoned because he was sixteen and therefore immortal.`
      },
      {
        source: 'Elizabeth Strout style',
        text: `The town looked the way it always did in March, which is to say discouraged. The snow had gone gray weeks ago and now sat in humps along the sidewalks like something that had given up. Lucy went to the post office because she needed to buy stamps and because she needed to leave the house. The woman behind the counter said the price had gone up again, and Lucy said she knew, and that was the whole conversation. She bought twenty stamps with flags on them. She did not need twenty stamps. She needed to stand somewhere that was not her living room.`
      }
    ]
  },

  'documentary-historical-prose': {
    label: 'Documentary Historical Prose',
    passages: [
      {
        source: 'Robert Caro style',
        text: `The office was on the eleventh floor, and the man who sat behind the desk had been sitting behind desks for thirty years, each one larger than the last. He had learned early that the size of the desk mattered. The men who came to see him would sit in chairs that were three inches lower than his own, a difference no one noticed and everyone felt. By nine-fifteen the first appointment was waiting. The mayor's assistant had been calling since Tuesday, and the calls had not been returned, because not returning calls was also a form of power, perhaps the purest form, and he understood this the way a carpenter understands wood, which is to say in his hands.`
      },
      {
        source: 'Erik Larson style',
        text: `The morning of the fire, the wind came from the southwest at eleven miles per hour. It carried the smell of the stockyards across the river and into the windows of the Iroquois Theatre, where the stagehands were hanging a new curtain that had arrived three days late from a supplier in New Jersey. The curtain was supposed to be fireproof. It was made of cotton and wood pulp, and it had cost twelve dollars less than the asbestos curtain specified in the original plans. No one in the audience that afternoon would know this. The programs listed the curtain as asbestos.`
      }
    ]
  },

  'romance': {
    label: 'Romance',
    passages: [
      {
        source: 'Contemporary romance style',
        text: `She told herself she was only going to the hardware store for lightbulbs. She was not going because he worked there on Saturdays. She was not going because the last time she had gone, he had explained the difference between Phillips head and flathead screwdrivers with the kind of patient attention most people reserved for serious matters, and she had bought both kinds even though she did not own a screwdriver. The bell above the door rang when she walked in. He was in aisle four, stacking paint cans, and he looked up and smiled like she was the first good thing that had happened to him all day. She had not prepared for that.`
      }
    ]
  },

  'mystery': {
    label: 'Mystery',
    passages: [
      {
        source: 'Literary mystery style',
        text: `The body had been in the water for three days. Halloran knew this because the coroner said so, and because the fingertips had started to slip, which was a thing he wished he had never learned. He stood on the dock and wrote in his notebook with a pencil that needed sharpening. The lake was flat and gray. A family was picnicking on the north shore, too far away to see what was happening here, and he was grateful for the distance. He wrote the time. He wrote the temperature of the water, which an officer had measured with a kitchen thermometer borrowed from the bait shop. He would need a better thermometer. He would need many things.`
      }
    ]
  },

  'thriller': {
    label: 'Thriller',
    passages: [
      {
        source: 'Propulsive thriller style',
        text: `The text came at 2:14 a.m. and it was not from a number she recognized. Two words. She read them, put the phone down, and then picked it up and read them again because two words should not be able to rearrange the furniture of your life, but these two did. She got out of bed. She did not turn on the light. She went to the closet and pulled out the bag she had packed nine months ago and never unpacked because some part of her had always known this night would come. The bag was heavy. She had packed it with the assumption that she would not be coming back.`
      }
    ]
  },

  'science-fiction': {
    label: 'Science Fiction',
    passages: [
      {
        source: 'Near-future SF style',
        text: `The station smelled like recycled air and old coffee, which is what the future smells like when you are actually living in it. Park checked the seals on the airlock for the third time because the readout said they were fine and the readout had also said they were fine the day the outer ring lost pressure and two people died. The readout was a liar. He trusted his hands. The seals felt solid, the kind of solid that meant someone on the last shift had actually done the work instead of logging it and going to sleep. He marked the inspection complete and moved to the next hatch. There were forty-seven hatches. He would check them all.`
      }
    ]
  },

  'fantasy': {
    label: 'Fantasy',
    passages: [
      {
        source: 'Grounded fantasy style',
        text: `The smith had been working the same forge for forty years, and in that time she had made swords for three kings, two of whom were now dead by swords she had not made, which she considered a reasonable batting average. The current king had not asked for a sword. He had asked for a lock. She did not ask what the lock was for, because kings do not explain themselves to smiths, and because she had learned that knowing what your work would be used for was a kind of burden she preferred not to carry. The iron was ready. She pulled it from the coals and began to shape it on the anvil, and the sound rang out across the yard where the apprentices were eating bread with lard.`
      }
    ]
  },

  'horror': {
    label: 'Horror',
    passages: [
      {
        source: 'Atmospheric horror style',
        text: `The house had been empty for six years and it smelled like six years of emptiness, which is a specific smell, damp and mineral, like the inside of a well. She walked through the front room with her phone flashlight cutting a white path across the floor. The boards were soft in places. She tested each step before committing her weight, the way you test ice, knowing that the testing itself is an act of faith. The kitchen was at the back. The window over the sink was broken and something had built a nest in the gap, sticks and mud and what looked like a piece of a child's shirt, blue with white stars. She did not touch it. She moved on.`
      }
    ]
  },

  'historical': {
    label: 'Historical Fiction',
    passages: [
      {
        source: 'Immersive historical style',
        text: `The road from York to London took four days in good weather and this was not good weather. The mud came up past the horses' fetlocks and the driver cursed at intervals so regular they might have been measured with a clock. Margaret sat inside the coach with her hands in her lap and her back straight because posture was the one thing she could control. The woman across from her had fallen asleep somewhere past Doncaster and was snoring with the particular abandon of someone who had stopped caring what strangers thought. Margaret envied her. The coach hit a stone and lurched, and the sleeping woman did not wake, and Margaret thought about the letter in her trunk and what it would mean when she arrived.`
      }
    ]
  },

  'biography-memoir': {
    label: 'Biography & Memoir',
    passages: [
      {
        source: 'Narrative biography style',
        text: `He arrived in Washington on a Tuesday, carrying a leather bag that had belonged to his father and a letter of introduction that would turn out to be worthless. The city was smaller than he had expected. The Capitol dome was still unfinished, a skeleton of iron ribs against the sky, and the streets were unpaved past Seventh Street. He found a boarding house on H Street run by a widow who charged two dollars a week and served potatoes at every meal. The room was twelve feet by ten feet and the window looked out on an alley where someone kept chickens. He unpacked his bag. He hung his one good suit on a nail behind the door. He sat on the bed and read the letter of introduction one more time, then folded it and put it in his pocket. He would present it tomorrow. It would not help.`
      }
    ]
  },

  // Fallback for genres without specific passages
  'default': {
    label: 'General Fiction',
    passages: [
      {
        source: 'Clean narrative prose style',
        text: `The morning was cold and the coffee was not good, but he drank it standing at the kitchen counter because sitting down felt like a commitment he was not ready to make. The dog watched him from under the table with the patient intensity of an animal that has learned when food is likely. He poured a second cup. Through the window he could see the neighbor's truck was gone, which meant the neighbor was already at work, which meant it was later than he thought. He looked at the clock. It was later than he thought. He put the cup down, found his keys on the hook where they always were except when they weren't, and went out to start the day.`
      }
    ]
  }
};


// ═══════════════════════════════════════════════════════════
//  GHOST AUTHOR PROMPT BUILDER
// ═══════════════════════════════════════════════════════════

/**
 * Select the best reference passage for a given genre/subgenre combination.
 *
 * @param {string} genre - Genre ID (e.g., 'literary-fiction', 'romance')
 * @param {string|null} subgenre - Subgenre ID or null
 * @returns {Object} { source, text } reference passage
 */
function selectReferencePassage(genre, subgenre) {
  // Try exact genre match first
  const genreKey = genre || 'default';
  const genreData = REFERENCE_PASSAGES[genreKey] || REFERENCE_PASSAGES['default'];
  const passages = genreData.passages;

  // Pick a random passage from available options for variety
  return passages[Math.floor(Math.random() * passages.length)];
}

/**
 * Build the Ghost Author system prompt (~500 words instead of ~3,000).
 *
 * Core philosophy: show the model what good prose looks like via a reference
 * passage, rather than listing 50+ constraints. The reference passage
 * demonstrates the gestalt (register, rhythm, craft level) rather than
 * itemizing individual components.
 *
 * @param {Object} options
 * @param {string} options.genre - Genre label
 * @param {string|null} options.genreRules - Genre-specific rules
 * @param {string} options.voice - POV/voice setting
 * @param {Object} options.chapterVoice - Selected author voice object
 * @param {Object|string} options.authorPalette - Author palette
 * @param {number} options.poetryLevel - 1-5 prose density level
 * @param {number} options.wordTarget - Approximate word target
 * @param {string|null} options.tone - Optional tone
 * @param {string|null} options.style - Optional style
 * @returns {string} The complete Ghost Author system prompt
 */
function buildGhostAuthorPrompt(options) {
  const {
    genre, genreRules, voice, chapterVoice,
    poetryLevel, wordTarget, tone, style
  } = options;

  const reference = selectReferencePassage(genre);

  const poetryGuidance = {
    1: 'Clean, invisible prose. Let the story carry itself.',
    2: 'Modest detail. Grounding sensory touches, nothing ornate.',
    3: 'Literary craft. Every sentence shaped with care.',
    4: 'Heightened language. Rich metaphor, musical sentences.',
    5: 'Lyrical density. Prose-poetry territory.'
  };

  const densityNote = poetryGuidance[poetryLevel || 3];

  // Voice/POV instruction
  const voiceInstructions = {
    'first-person': 'Write in FIRST PERSON (I/me/my).',
    'third-limited': 'Write in THIRD-PERSON LIMITED. One character\'s perspective at a time.',
    'third-omniscient': 'Write in THIRD-PERSON OMNISCIENT. Access to all characters\' thoughts.',
    'third-objective': 'Write in THIRD-PERSON OBJECTIVE (camera eye). Only what can be seen and heard.',
    'second-person': 'Write in SECOND PERSON (you/your).',
    'deep-pov': 'Write in DEEP POV. Zero narrative distance, no filter words.',
    'unreliable': 'Write with an UNRELIABLE NARRATOR. Subtle contradictions and self-serving gaps.',
    'multiple-pov': 'Write in MULTIPLE POV (rotating third-person limited).',
    'stream-of-consciousness': 'Write in STREAM OF CONSCIOUSNESS. Unfiltered thought flow.',
    'epistolary': 'Write in EPISTOLARY form. Story told through documents.'
  };
  const povInstruction = voiceInstructions[voice] || 'Write in third-person limited or first-person as appropriate.';

  // Author voice section
  const authorSection = chapterVoice
    ? `=== VOICE: ${chapterVoice.name} ===\n${chapterVoice.voicePrompt || ''}\n=== END VOICE ===`
    : '';

  const prompt = `You are writing a chapter of a novel. Your prose should read like the reference passage below. Match its register, rhythm, and level of craft.

=== REFERENCE PASSAGE ===
${reference.text}
=== END REFERENCE ===

Write with that same density and humanity. Some sentences should be merely functional. Not every paragraph needs a revelation. Let the story carry itself.

${authorSection}

=== PROSE DENSITY ===
${densityNote}

=== RULES ===
${povInstruction}
${genreRules ? `Genre: ${genre}. ${genreRules}` : `Genre: ${genre || 'literary fiction'}.`}
${tone ? `Tone: ${tone}.` : ''}
${style ? `Style: ${style}.` : ''}

Do not use em dashes, en dashes, or double hyphens. Use commas, semicolons, colons, periods, or parentheses instead.
When listing items, limit to two. If a third item is needed, place it in its own sentence with different structure.
Do not fabricate citations, statistics, or archival references not present in the source material.
Do not write scene labels, meta-commentary, or author notes. Output only prose.
Write approximately ${wordTarget || 750} words.

=== WHAT MAKES PROSE HUMAN ===
Real prose has rough spots. Some sentences exist only to move from A to B. Some paragraphs end mid-thought. Not every verb is vivid. Not every observation is precise. Let 2-3 sentences per chunk be merely competent, not brilliant. Vary paragraph lengths. Start some paragraphs plainly. End most paragraphs on concrete action or observation, not on crafted insight.`;

  return prompt;
}

/**
 * Build a slim single-voice generation prompt for the Genesis 4 pipeline.
 * This replaces the heavy generateSingleVoice system prompt from Genesis 3.
 *
 * @param {Object} options - Same as buildGhostAuthorPrompt plus additional fields
 * @param {string} options.beats - Material/beats to cover
 * @param {string} options.continuityDigest - Continuity context
 * @param {string} options.errorPatternsPrompt - Error patterns (kept minimal)
 * @returns {string} System prompt for generation
 */
function buildGenesis4GenerationPrompt(options) {
  const {
    genre, genreRules, voice, chapterVoice,
    poetryLevel, wordTarget, tone, style,
    beats, continuityDigest, errorPatternsPrompt
  } = options;

  let prompt = buildGhostAuthorPrompt({
    genre, genreRules, voice, chapterVoice,
    poetryLevel, wordTarget, tone, style
  });

  if (beats) {
    prompt += `\n\n=== MATERIAL TO COVER ===\n${beats}`;
  }

  if (continuityDigest) {
    prompt += `\n\n=== CONTINUITY ===\n${continuityDigest}`;
  }

  // Only include top 5 most critical error patterns, not the full database
  if (errorPatternsPrompt) {
    // Extract just the essential banned patterns, not the full checking protocol
    const lines = errorPatternsPrompt.split('\n');
    const criticalLines = lines
      .filter(l => l.trim().startsWith('-') && l.includes(':'))
      .slice(0, 5);

    if (criticalLines.length > 0) {
      prompt += `\n\n=== PATTERNS TO AVOID ===\n${criticalLines.join('\n')}`;
    }
  }

  return prompt;
}


// ═══════════════════════════════════════════════════════════
//  EXPORTS
// ═══════════════════════════════════════════════════════════

export {
  REFERENCE_PASSAGES,
  selectReferencePassage,
  buildGhostAuthorPrompt,
  buildGenesis4GenerationPrompt
};
