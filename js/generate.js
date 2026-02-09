/**
 * Genesis 2 — AI Prose Generation Module
 * Uses the Anthropic Messages API to generate prose from story plots.
 * Calls the API directly from the browser via CORS-enabled endpoint.
 */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';

class ProseGenerator {
  constructor(storage) {
    this.storage = storage;
    this.apiKey = null;
    this.model = DEFAULT_MODEL;
    this.abortController = null;
  }

  async init() {
    this.apiKey = await this.storage.getSetting('anthropicApiKey', '');
    this.model = await this.storage.getSetting('aiModel', DEFAULT_MODEL);
  }

  async setApiKey(key) {
    this.apiKey = key;
    await this.storage.setSetting('anthropicApiKey', key);
  }

  async setModel(model) {
    this.model = model;
    await this.storage.setSetting('aiModel', model);
  }

  hasApiKey() {
    return !!this.apiKey;
  }

  cancel() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Generate prose based on a plot description and optional context.
   * Streams the response and calls onChunk for each piece of text.
   */
  async generate({ plot, existingContent, sceneTitle, chapterTitle, characters, notes, chapterOutline, aiInstructions, tone, style, wordTarget, maxTokens, concludeStory, genre, genreRules, projectGoal, voice, errorPatternsPrompt }, { onChunk, onDone, onError }) {
    if (!this.apiKey) {
      onError(new Error('No API key set. Go to Settings to add your Anthropic API key.'));
      return;
    }

    this.abortController = new AbortController();

    const systemPrompt = this._buildSystemPrompt({ tone, style, genre, genreRules, voice, errorPatternsPrompt });
    const userPrompt = this._buildUserPrompt({ plot, existingContent, sceneTitle, chapterTitle, characters, notes, aiInstructions, chapterOutline, wordTarget, concludeStory, genre, genreRules, projectGoal });

    try {
      const response = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: maxTokens || 4096,
          stream: true,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }]
        }),
        signal: this.abortController.signal
      });

      if (!response.ok) {
        const errorBody = await response.text();
        let msg = `API error (${response.status})`;
        try {
          const parsed = JSON.parse(errorBody);
          msg = parsed.error?.message || msg;
        } catch (_) {}
        throw new Error(msg);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;

            try {
              const event = JSON.parse(data);
              if (event.type === 'content_block_delta' && event.delta?.text) {
                onChunk(event.delta.text);
              }
            } catch (_) {}
          }
        }
      }

      this.abortController = null;
      onDone();
    } catch (err) {
      this.abortController = null;
      if (err.name === 'AbortError') {
        onDone();
      } else {
        onError(err);
      }
    }
  }

  /**
   * Generate detailed chapter outlines based on notes, characters, and book structure.
   * Returns an array of { title, outline } objects for each chapter.
   */
  async generateOutlines({ title, subtitle, genre, totalWords, numChapters, characters, notes, aiInstructions }) {
    if (!this.apiKey) {
      throw new Error('No API key set. Go to Settings to add your Anthropic API key.');
    }

    const systemPrompt = `You are a master book architect and bestselling author. You create extraordinarily detailed chapter outlines that serve as the blueprint for an entire novel. Your outlines are specific, actionable, and rich with narrative detail.

Your output must be valid JSON — an array of objects with "title" and "outline" fields. No markdown, no commentary, just JSON.`;

    let userPrompt = `Create detailed chapter outlines for a ${numChapters}-chapter novel.

Book Title: ${title}${subtitle ? `\nSubtitle: ${subtitle}` : ''}
${genre ? `Genre: ${genre}` : ''}
Target Total Words: ${totalWords.toLocaleString()} (~${Math.round(totalWords / numChapters).toLocaleString()} words per chapter)
Number of Chapters: ${numChapters}`;

    if (characters && characters.length > 0) {
      userPrompt += '\n\nCharacters:';
      for (const char of characters) {
        userPrompt += `\n- ${char.name} (${char.role})`;
        if (char.description) userPrompt += `: ${char.description}`;
        if (char.motivation) userPrompt += ` | Motivation: ${char.motivation}`;
        if (char.arc) userPrompt += ` | Arc: ${char.arc}`;
      }
    }

    if (notes) {
      userPrompt += `\n\nProject Notes & World-Building:\n${notes}`;
    }

    if (aiInstructions) {
      userPrompt += `\n\nAuthor Instructions (MUST follow):\n${aiInstructions}`;
    }

    userPrompt += `\n\nFor each of the ${numChapters} chapters, provide:
1. A descriptive chapter title that reflects the chapter's content
2. A detailed outline of 200-250 words describing:
   - The key events and scenes in the chapter
   - Character actions, motivations, and emotional beats
   - Important dialogue moments or revelations
   - Setting and atmosphere details
   - How the chapter connects to the overall narrative arc
   - The chapter's role in building tension or advancing the plot

Ensure narrative continuity across all chapters — each chapter should flow naturally from the previous one.

Output ONLY a JSON array like: [{"title": "Chapter Title", "outline": "Detailed outline text..."}, ...]`;

    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 8192,
        messages: [{ role: 'user', content: userPrompt }],
        system: systemPrompt
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      let msg = `API error (${response.status})`;
      try { msg = JSON.parse(errorBody).error?.message || msg; } catch (_) {}
      throw new Error(msg);
    }

    const result = await response.json();
    const text = result.content?.[0]?.text?.trim() || '';

    // Parse JSON from response (handle potential markdown wrapping)
    let jsonStr = text;
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) jsonStr = jsonMatch[0];

    try {
      return JSON.parse(jsonStr);
    } catch (e) {
      throw new Error('Failed to parse outline response. The AI returned invalid JSON.');
    }
  }

  /**
   * Rethink/revise a chapter outline based on user instructions.
   */
  async rethinkOutline({ currentOutline, chapterTitle, userInstructions, bookTitle, genre, characters, notes }) {
    if (!this.apiKey) {
      throw new Error('No API key set.');
    }

    const systemPrompt = `You are a master book architect revising a chapter outline. Output ONLY the revised outline text (200-250 words). No commentary, no labels, no JSON — just the outline text.`;

    let userPrompt = `Revise this chapter outline based on the author's instructions.

Book: ${bookTitle}${genre ? ` (${genre})` : ''}
Chapter: ${chapterTitle}

Current Outline:
${currentOutline}

Author's Revision Instructions:
${userInstructions}`;

    if (characters && characters.length > 0) {
      userPrompt += '\n\nCharacters: ' + characters.map(c => `${c.name} (${c.role})`).join(', ');
    }

    if (notes) {
      userPrompt += `\n\nProject Notes:\n${notes.slice(0, 2000)}`;
    }

    userPrompt += '\n\nWrite the revised outline (200-250 words). Output ONLY the outline text.';

    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        messages: [{ role: 'user', content: userPrompt }],
        system: systemPrompt
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      let msg = `API error (${response.status})`;
      try { msg = JSON.parse(errorBody).error?.message || msg; } catch (_) {}
      throw new Error(msg);
    }

    const result = await response.json();
    return result.content?.[0]?.text?.trim() || '';
  }

  /**
   * Score prose quality on a 100-point scale and detect AI patterns.
   * Returns { score, label, issues[], aiPatterns[], summary }
   */
  async scoreProse(proseText, { isRewrite, previousIssueCount, previousScore, previousSubscores } = {}) {
    if (!this.apiKey) {
      throw new Error('No API key set.');
    }

    const systemPrompt = `You are a senior literary editor at The New York Times with 40 years of experience reviewing fiction. You score prose honestly and critically on a 100-point scale. You also detect common AI-generated writing patterns.

${isRewrite ? `IMPORTANT CONTEXT: This prose was just rewritten to fix ${previousIssueCount || 'several'} identified issues.
SCORING RULES FOR REWRITES:
- Score based ONLY on what is genuinely present in THIS text — evaluate it fresh on its own merits
- Do NOT artificially inflate or deflate the score
- Do NOT flag borderline cases or nitpick — only flag clear, unambiguous problems that a professional editor would actually flag
- Do NOT penalize the same dimension twice for the same type of issue
- If a passage is competent but not exceptional, that is NOT an issue — only flag things that are clearly wrong
- IMPORTANT: If the prose has genuinely improved in any dimension, the sub-score for that dimension MUST increase to reflect the improvement. Do not anchor to previous scores — judge the text on its current quality
${previousSubscores ? `- Previous sub-scores for context (these may increase OR stay the same — judge each dimension honestly based on what you see):
  ${Object.entries(previousSubscores).map(([k, v]) => `${k}: ${v}`).join(', ')}` : ''}` : ''}

SCORING INSTRUCTIONS — Score each sub-category independently, then sum them:
1. Sentence variety and rhythm (0-15): Count sentence length variation. If most sentences are similar length, score 4-6. If there's genuine variety between short punchy and long flowing, score 10+.
2. Dialogue authenticity (0-15): Does each character sound distinct? Are dialogue tags varied and natural? If dialogue is present, judge its quality. If NO dialogue is present in the passage, score this based on the distinctiveness and authenticity of the narrative voice instead (a strong narrative voice with distinct character perspectives can score 8-12 even without direct dialogue).
3. Sensory detail / showing vs telling (0-15): Count instances of SHOWING (concrete action, sensory detail) vs TELLING (stating emotions directly). Heavy telling = 3-5. Mostly showing = 10+.
4. Emotional resonance and character depth (0-15): Are emotions conveyed through behavior, not named? Is there interiority beyond surface reactions?
5. Vocabulary precision (0-10): Are words specific and earned? Or generic and interchangeable?
6. Narrative flow and pacing (0-10): Does the prose move at the right speed? Are transitions smooth?
7. Originality and voice (0-10): Does this feel like a distinct author's voice? Or generic AI prose?
8. Technical execution (0-10): Grammar, punctuation, paragraph breaks.

CRITICAL SCORING RULES:
- You MUST report individual sub-scores in a "subscores" object
- The total score MUST equal the sum of all sub-scores — do NOT round or adjust
- Do NOT default to any particular score. Score each dimension independently based on evidence
- CALIBRATION GUIDE:
  * 40-60: Raw AI prose with many clichés, PET phrases, formulaic structure
  * 65-78: Competent fiction with some AI patterns remaining, generic descriptions
  * 78-88: Strong human-quality writing with good variety, specific details, authentic voice
  * 88-95: Excellent prose with deliberate rhythm, vivid specificity, genuine emotional resonance, distinctive voice
  * 96-100: Truly masterful, rare even in published fiction
- A score of 88-95 is achievable for well-crafted prose with deliberate sentence variety, concrete sensory details, and authentic voice. Do not artificially cap scores
- Be specific: cite exact passages as evidence for each sub-score. When a dimension is strong, give it a high score — do not look for problems where none exist

KNOWN AI WRITING PATTERNS to detect:
- Overuse of "delicate", "intricate", "testament to", "tapestry", "symphony of", "dance of", "nestled", "whispering"
- Starting sentences with "As" or "While" excessively (count them)
- Lists of three (tricolons) used too frequently
- Purple prose or overly flowery descriptions
- Telling emotions instead of showing them ("She felt sad", "He was angry")
- Formulaic paragraph structures (observation → feeling → action → reflection)
- Lack of authentic dialogue tags variety
- Excessive use of em-dashes
- Repetitive transitional phrases ("Meanwhile", "In that moment")
- Generic or vague descriptions lacking specificity

PET PHRASES (Physical Emotional Telling) — these are CLICHED BODY-REACTION SHORTCUTS that substitute for genuine emotional writing. Flag ALL of these:
- throat tightened/constricted, chest tightened/constricted
- breath caught, breath hitched, held his/her breath
- stomach churned/dropped/knotted/clenched/sank
- heart pounded/hammered/raced/sank/clenched/skipped
- blood ran cold, blood drained from face
- eyes widened/narrowed/burned/stung/glistened/welled
- jaw clenched/tightened, teeth gritted
- fists clenched/balled, hands trembled/shook
- shoulders tensed/slumped, spine stiffened
- knees weakened/buckled, legs turned to jelly
- skin crawled/prickled, hairs stood on end, goosebumps
- bile rose, mouth went dry, swallowed hard/thickly
- tears streamed/pricked/threatened, vision blurred
- voice cracked/broke/wavered/trembled
- a chill ran down/up spine, shiver ran through
- weight settled in chest/stomach, pit in stomach
- nostrils flared, lip trembled/quivered
- pulse quickened/raced, temples throbbed

Each PET phrase found should be flagged as a SEPARATE issue with severity "high" because these are lazy emotional shortcuts. The goal is prose that SHOWS emotion through character-specific action and context, not generic body reactions.

IMPORTANT: The total score = sum of subscores. Report both.

Output valid JSON only:
{
  "score": number,
  "label": "string (Exceptional/Strong/Good/Competent/Needs Work/Rough Draft)",
  "subscores": {
    "sentenceVariety": number,
    "dialogueAuthenticity": number,
    "sensoryDetail": number,
    "emotionalResonance": number,
    "vocabularyPrecision": number,
    "narrativeFlow": number,
    "originalityVoice": number,
    "technicalExecution": number
  },
  "issues": [{"text": "quoted problematic passage", "problem": "description", "severity": "high|medium|low", "category": "pet-phrase|telling|cliche|weak-words|passive|structure|pacing|other", "estimatedImpact": number}],
  "aiPatterns": [{"pattern": "pattern name", "examples": ["example from text"], "estimatedImpact": number}],
  "summary": "2-3 sentence overall assessment"
}

For "estimatedImpact": estimate how many points the score would improve if this specific issue were fixed (1-5 points per issue).`;

    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        temperature: 0,
        messages: [{ role: 'user', content: `Score this prose critically and detect ALL AI patterns and PET phrases. Be thorough and honest — do not default to any particular score. Score each sub-category independently based on evidence from the text, then sum them:\n\n"""${proseText.slice(-12000)}"""` }],
        system: systemPrompt
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      let msg = `API error (${response.status})`;
      try { msg = JSON.parse(errorBody).error?.message || msg; } catch (_) {}
      throw new Error(msg);
    }

    const result = await response.json();
    const text = result.content?.[0]?.text?.trim() || '';

    let jsonStr = text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonStr = jsonMatch[0];

    try {
      const parsed = JSON.parse(jsonStr);
      // Validate: if subscores exist, ensure score = sum of subscores
      if (parsed.subscores) {
        const sum = Object.values(parsed.subscores).reduce((a, b) => a + (Number(b) || 0), 0);
        parsed.score = Math.round(sum);
      }
      // Assign label based on actual score
      if (parsed.score >= 88) parsed.label = 'Exceptional';
      else if (parsed.score >= 78) parsed.label = 'Strong - Distinctive Human Voice';
      else if (parsed.score >= 65) parsed.label = 'Good - Strong Human Voice';
      else if (parsed.score >= 50) parsed.label = 'Competent - Needs Polish';
      else if (parsed.score >= 35) parsed.label = 'Needs Work';
      else parsed.label = 'Rough Draft';
      return parsed;
    } catch (e) {
      return { score: 0, label: 'Unable to score', issues: [], aiPatterns: [], subscores: {}, summary: 'Scoring failed — could not parse response.' };
    }
  }

  _buildSystemPrompt({ tone, style, genre, genreRules, voice, errorPatternsPrompt }) {
    let prompt = `You are a world-class fiction author whose prose has been compared to Cormac McCarthy, Toni Morrison, and Denis Johnson. You write with precision, authority, and an unmistakable human voice. Every sentence earns its place.

=== YOUR CRAFT PRINCIPLES ===
Before writing, mentally plan: What is the emotional core of this passage? What specific sensory details anchor it? What rhythm should the sentences follow? Then write with intention.

PROSE EXCELLENCE — what makes your writing score 90+:
1. SENTENCE VARIETY & RHYTHM (crucial): Alternate deliberately between short, punchy sentences (3-8 words) and longer, flowing ones (15-30 words). Use fragments for impact. Let a one-word sentence land after a complex one. Aim for standard deviation of 8+ in sentence lengths.
2. DIALOGUE AUTHENTICITY: Each character speaks differently. One uses clipped phrases. Another rambles. Give them verbal tics, regional flavor, interrupted thoughts. Use "said" mostly, but vary with silence, action, and no tag at all.
3. SENSORY DETAIL / SHOW DON'T TELL: Name the specific brand, the exact color, the particular smell. Not "flowers" but "the roses his mother grew along the fence, the roses that smelled like rust." Not "He was angry" but "He swept the papers off the desk. They scattered across the floor like dead leaves."
4. EMOTIONAL RESONANCE: Convey emotion through what characters DO, not what they FEEL. A grieving person might reorganize a kitchen drawer. A nervous person might count ceiling tiles. Find the unexpected, character-specific gesture.
5. VOCABULARY PRECISION: Choose the one right word. Not "walked slowly" but "shuffled" or "drifted" or "picked his way." Cut every "very", "really", "just", "quite", "rather."
6. NARRATIVE FLOW & PACING: Vary paragraph lengths. A single-sentence paragraph commands attention. Follow dense description with quick action. Let white space do work.
7. ORIGINALITY & VOICE: Write sentences no one has written before. Avoid any construction that sounds like it came from a template. If a phrase sounds familiar, replace it.
8. TECHNICAL EXECUTION: Clean grammar. Purposeful paragraph breaks. Consistent tense and POV.`;

    // Voice / POV instruction
    if (voice && voice !== 'auto') {
      const voiceInstructions = {
        'first-person': `\n- Write in FIRST PERSON (I/me/my). The narrator is a character in the story, sharing their direct experience. Maintain consistent first-person throughout.`,
        'third-limited': `\n- Write in THIRD-PERSON LIMITED. Follow one character's perspective at a time. The reader only knows what the POV character thinks, feels, sees, and knows.`,
        'third-omniscient': `\n- Write in THIRD-PERSON OMNISCIENT. The narrator has access to all characters' thoughts and feelings. The narrator can comment on events with broader knowledge than any single character.`,
        'third-objective': `\n- Write in THIRD-PERSON OBJECTIVE (camera eye). Report only what can be seen and heard externally — no character thoughts, no internal feelings. Let action and dialogue carry all meaning.`,
        'second-person': `\n- Write in SECOND PERSON (you/your). Place the reader directly into the story as the protagonist. Maintain consistent second-person throughout.`,
        'deep-pov': `\n- Write in DEEP POV (close third-person). Eliminate all narrative distance — no filter words (felt, noticed, saw, seemed), no "he thought" tags. The reader IS the character. Every sensation and thought is presented as direct experience, not narrated observation.`,
        'unreliable': `\n- Write with an UNRELIABLE NARRATOR. The narrator's account should contain subtle contradictions, self-serving interpretations, or gaps that hint the full truth differs from what's being told. Let the reader question the narrator's version of events.`,
        'multiple-pov': `\n- Write in MULTIPLE POV (third-person limited, rotating). Each section follows a different character's perspective. Maintain distinct voice and vocabulary for each POV character. Never reveal information the current POV character wouldn't know.`,
        'stream-of-consciousness': `\n- Write in STREAM OF CONSCIOUSNESS. Capture the unfiltered flow of a character's thoughts — associative, non-linear, mixing memory with present sensation. Use run-on sentences, fragments, and abrupt transitions to mirror actual thinking.`,
        'epistolary': `\n- Write in EPISTOLARY form. Tell the story through documents — letters, diary entries, emails, reports, text messages, or other written artifacts. Each document should have a distinct voice reflecting its author and purpose.`
      };
      prompt += voiceInstructions[voice] || `\n- Write in the specified narrative voice: ${voice}`;
    } else {
      prompt += `\n- Write in third-person limited or first-person as appropriate to the story`;
    }

    prompt += `

=== MANDATORY CRAFT RULES ===
- Show, don't tell: use concrete action, sensory detail, and dialogue to convey emotion and meaning
- Vary sentence length deliberately: short sentences (under 8 words) should comprise at least 20% of your sentences; long sentences (over 20 words) at least 15%
- Use strong, specific verbs: not "walked" but "shuffled", "strode", "picked his way"
- Eliminate filter words: never use felt, saw, noticed, seemed, realized, watched, thought, knew, wondered
- Keep passive voice under 10%
- Write natural, character-distinct dialogue where each speaker has their own vocabulary and rhythm
- Convey interiority through action and environment, not stated feelings
- Aim for Flesch readability 60-80
- Write ONLY the prose. No meta-commentary, no scene labels, no author notes

=== THINGS TO NEVER DO ===
- NEVER use em dashes (\u2014, \u2013, ---) under any circumstances. Use commas, semicolons, colons, periods, or parentheses instead
- NEVER use these AI-telltale words: delicate, intricate, testament to, tapestry, symphony of, dance of, nestled, whispering, pierced the silence, shattered the silence, hung in the air, palpable
- NEVER start more than one sentence per passage with "As" or "While"
- NEVER use tricolons (lists of three) more than once per 1000 words
- NEVER write purple prose or flowery descriptions. Prefer plain, precise language
- NEVER tell emotions: "She felt sad", "He was angry", "Fear gripped her"
- NEVER use formulaic paragraph structures (observation, feeling, action, reflection)
- NEVER use: "Meanwhile", "In that moment", "Little did she know", "It was then that"
- NEVER use cliched body-reaction shortcuts (PET phrases): throat tightened, chest tightened, breath caught, breath hitched, stomach churned/dropped/knotted, heart pounded/hammered/raced/sank, blood ran cold, eyes widened/narrowed, jaw clenched, fists clenched/balled, hands trembled, shoulders tensed/slumped, knees weakened/buckled, skin crawled, bile rose, mouth went dry, swallowed hard, voice cracked/broke/wavered, chill ran down spine, pulse quickened
- Instead of PET phrases: show emotion through character-specific action (a grieving man polishes his dead wife's reading glasses; a scared child arranges pebbles in a line)`;

    if (genreRules) {
      prompt += `\n\n=== GENRE STYLE RULES (${genre}) ===\n${genreRules}`;
      prompt += `\n\n=== STYLE CONSISTENCY ===`;
      prompt += `\nCRITICAL: Maintain a consistent prose style throughout. Do NOT shift between styles mid-passage.`;
      prompt += `\n- Keep the same narrative voice, tense, and point of view from start to finish`;
      prompt += `\n- Do NOT switch from prose to poetry, verse, rhyming couplets, or song lyrics unless the genre rules specifically call for it`;
      prompt += `\n- Do NOT adopt a different genre's conventions partway through`;
      prompt += `\n- If continuing existing text, match the established voice and style exactly`;
      prompt += `\n- Consistency is more important than creativity — never drift from the selected genre style`;
    }

    // Inject error pattern database as negative prompts (learned from previous scoring)
    if (errorPatternsPrompt) {
      prompt += errorPatternsPrompt;

      // Add sentence/paragraph-level error checking instructions
      prompt += `

=== SENTENCE-LEVEL ERROR CHECKING PROTOCOL ===
You MUST follow this protocol while writing:

WHILE WRITING EACH SENTENCE:
1. Before committing a sentence, mentally check it against the ERROR PATTERN DATABASE above
2. If the sentence contains ANY pattern from the database (a PET phrase, an AI pattern, a cliche, telling instead of showing, weak words), REWRITE the sentence immediately before moving on
3. The rewritten sentence must not contain any error from the database

AFTER EACH PARAGRAPH:
1. Re-read the paragraph as a whole
2. Check for: repeated sentence structures, monotonous rhythm, any error patterns that slipped through
3. If any errors are found, fix them before writing the next paragraph
4. Verify sentence length variety within the paragraph (mix of short and long)

This self-checking protocol is MANDATORY. The error database represents patterns that have been repeatedly flagged in past scoring. Producing prose that contains these known errors is unacceptable.
=== END ERROR CHECKING PROTOCOL ===`;
    }

    if (tone) {
      prompt += `\n- Tone: ${tone}`;
    }
    if (style) {
      prompt += `\n- Writing style inspiration: ${style}`;
    }

    return prompt;
  }

  _buildUserPrompt({ plot, existingContent, sceneTitle, chapterTitle, characters, notes, aiInstructions, chapterOutline, wordTarget, concludeStory, genre, genreRules, projectGoal }) {
    let prompt = '';

    if (chapterTitle) {
      prompt += `Chapter: ${chapterTitle}\n`;
    }
    if (sceneTitle) {
      prompt += `Scene: ${sceneTitle}\n`;
    }
    if (genre) {
      prompt += `Genre: ${genre}\n`;
    }

    if (aiInstructions) {
      prompt += `\n=== AUTHOR INSTRUCTIONS (MUST FOLLOW) ===\n${aiInstructions}\n=== END AUTHOR INSTRUCTIONS ===\n`;
      prompt += `CRITICAL: The above author instructions take priority over all other guidance. Follow them exactly.\n`;
    }

    if (chapterOutline) {
      prompt += `\n=== CHAPTER OUTLINE (CANON — follow this precisely) ===\n${chapterOutline}\n=== END CHAPTER OUTLINE ===\n`;
      prompt += `CRITICAL: The chapter outline above is the authoritative guide for this chapter's content. Follow it precisely while writing vivid, engaging prose.\n`;
    }

    prompt += `\nStory/Plot:\n${plot}\n`;

    if (characters && characters.length > 0) {
      prompt += '\nCharacters:\n';
      for (const char of characters) {
        prompt += `- ${char.name} (${char.role})`;
        if (char.description) prompt += `: ${char.description}`;
        if (char.motivation) prompt += ` | Motivation: ${char.motivation}`;
        prompt += '\n';
      }
    }

    if (notes) {
      prompt += `\nAdditional context/notes:\n${notes}\n`;
    }

    if (existingContent) {
      const plainText = existingContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (plainText.length > 0) {
        const truncated = plainText.slice(-3000);
        prompt += `\nContinue from this existing text (pick up exactly where it leaves off):\n"""${truncated}"""\n`;
        if (genreRules) {
          prompt += `\nREMINDER: Match the prose style, voice, and tone of the existing text above. Stay within the ${genre} genre conventions. Do NOT change styles.`;
        }
      }
    }

    const target = wordTarget || 1000;

    // Formatting instructions for scene breaks and chapter structure
    if (!existingContent || existingContent.replace(/<[^>]+>/g, '').trim().length === 0) {
      // Starting a new chapter from scratch - add chapter heading instruction
      if (chapterTitle) {
        prompt += `\n=== CHAPTER FORMATTING ===`;
        prompt += `\nIMPORTANT: Begin the chapter with the chapter title as a standalone line of text. Do NOT include "Chapter X:" prefix unless it is part of the actual chapter title. This heading line should be on its own line before the prose begins.`;
      }
    }

    // Scene break instructions
    prompt += `\n\n=== SCENE BREAK FORMATTING ===`;
    prompt += `\nWhen there is a shift in time, location, or point of view (a new beat or scene), insert a scene break using three asterisks on their own line: * * *`;
    prompt += `\nScene breaks should appear between distinct beats or scenes within the chapter.`;
    prompt += `\nAt the very end of the chapter, include a final scene break (three asterisks on their own line) to clearly mark the chapter boundary.`;
    prompt += `\nNEVER use em dashes in any text. Use commas, semicolons, colons, periods, or parentheses instead.`;

    if (concludeStory) {
      prompt += `\nIMPORTANT: This is the FINAL section of the story. You have approximately ${target} words to bring the story to a satisfying, complete conclusion.`;
      prompt += `\n- Resolve the main conflict and any critical plot threads`;
      prompt += `\n- Give the protagonist a clear emotional resolution`;
      prompt += `\n- Write a memorable final scene or closing image`;
      prompt += `\n- Ensure the ending feels earned and not rushed`;
      if (genre) {
        prompt += `\n- Honor the conventions and reader expectations of the ${genre} genre`;
      }
      if (projectGoal) {
        prompt += `\n- The total story target is ${projectGoal.toLocaleString()} words — pace your conclusion to fit within ~${target} words`;
      }
      prompt += `\n\nWrite approximately ${target} words to conclude the story. Output ONLY the story text, no labels or commentary.`;
    } else {
      prompt += `\nWrite approximately ${target} words of prose. Output ONLY the story text, no labels or commentary.`;
    }

    // Quality guidance at the end for emphasis (recency bias in LLMs means this carries more weight)
    prompt += `\n\n=== QUALITY TARGET ===`;
    prompt += `\nThis prose will be scored on an 8-dimension rubric (sentence variety, dialogue, sensory detail, emotional resonance, vocabulary, flow, originality, technical execution). Target: 90/100.`;
    prompt += `\nBefore writing each paragraph, ask yourself: Does this sentence sound like something a real human author would write, or does it sound generated? If generated, rewrite it in your head first.`;
    prompt += `\nPrioritize: (1) varied sentence lengths with deliberate rhythm, (2) concrete sensory details over abstract descriptions, (3) emotion shown through action not stated, (4) precise vocabulary with zero filler words.`;

    return prompt;
  }

  /**
   * Rewrite prose to fix identified problems and/or apply user instructions.
   * Streams the response, replacing (not appending to) the original prose.
   */
  async rewriteProse({ originalProse, problems, userInstructions, chapterTitle, characters, notes, chapterOutline, aiInstructions, tone, style, wordTarget, maxTokens, genre, genreRules, voice, previousScore, previousSubscores, rewriteIteration, errorPatternsPrompt }, { onChunk, onDone, onError }) {
    if (!this.apiKey) {
      onError(new Error('No API key set. Go to Settings to add your Anthropic API key.'));
      return;
    }

    this.abortController = new AbortController();

    // DO NOT use _buildSystemPrompt here — those creative writing instructions
    // conflict with surgical rewrite goals and cause the AI to rewrite too aggressively.
    // Instead, use a focused rewrite-only system prompt.
    let systemPrompt = `You are a senior literary editor with the skill of a world-class fiction author. Your job is to surgically improve specific weaknesses in existing prose while preserving its strengths.

=== YOUR APPROACH ===
1. Read the original prose carefully. Understand its voice, rhythm, and intent.
2. Read each listed issue. Plan your fix BEFORE writing — ask yourself: "Will this fix genuinely improve the prose, or just change it?"
3. For each fix, write the replacement in your head first. Verify it: (a) solves the stated problem, (b) doesn't introduce new issues, (c) sounds like the same author.
4. Copy all non-problematic text verbatim. Change ONLY what's listed.

=== RULES ===
- PRESERVE: voice, tense, POV, paragraph structure, approximate length
- OUTPUT: Only the rewritten prose. No commentary, labels, or meta-text
- NEVER introduce: em dashes (\u2014, \u2013, ---), filter words (felt/saw/noticed/seemed/realized), AI-telltale words (delicate/intricate/testament/tapestry/symphony/nestled), tricolons, purple prose, PET phrases

=== HOW TO FIX EACH TYPE OF ISSUE ===

SENTENCE VARIETY (low score): The problem is usually too many similar-length sentences in a row.
- Find runs of 3+ sentences with similar word counts and break the pattern
- Split a long sentence into two short ones. Or combine two short ones into a flowing compound sentence
- Add a fragment for emphasis. One word. Like that.
- Example: "He walked to the door. He opened it slowly. He looked outside." → "He walked to the door and opened it. Slowly. The yard stretched empty in the morning light."

DIALOGUE AUTHENTICITY (low score): Characters sound the same, or tags are repetitive.
- Give each character distinct speech patterns: one uses short sentences, another hedges, another interrupts
- Vary tags: use "said" 60% of the time, action beats 30%, no tag 10%
- Add interruptions, trailing off (...), or mid-sentence corrections

SENSORY DETAIL / SHOW VS TELL (low score): Too much abstract description, not enough concrete detail.
- Replace abstract with specific: not "the room was messy" but "newspapers covered the table, a coffee cup grew mold by the sink"
- Replace stated emotions with visible behavior: not "she was nervous" but "she straightened the silverware, then straightened it again"

EMOTIONAL RESONANCE (low score): Emotions are named or shown through clichéd body reactions.
- Replace "He felt grief" with a character-specific action that IMPLIES grief
- Replace PET phrases with unique physical details: not "his hands trembled" but "he couldn't get the key in the lock"

VOCABULARY PRECISION (low score): Weak, generic, or filler words.
- Replace each flagged weak word with the ONE specific word that fits: not "walked slowly" but "shuffled"
- Delete: very, really, quite, rather, somewhat, just, actually, basically

NARRATIVE FLOW (low score): Pacing issues, awkward transitions.
- Vary paragraph lengths. One sentence paragraphs create emphasis. Dense paragraphs slow the reader.
- Cut unnecessary transitions ("Meanwhile", "After a moment"). Just jump to the next beat.

ORIGINALITY & VOICE (low score / AI patterns detected):
- Replace any phrase that sounds templated or machine-generated with something unexpected
- If a metaphor is familiar, delete it entirely or find a genuinely novel comparison
- Avoid "As [action], [reaction]" constructions

PET PHRASES: NEVER replace with another PET phrase. Replace with character-specific action.
- BAD: "His throat tightened" → "His chest constricted" (still a PET phrase!)
- GOOD: "His throat tightened" → "He grabbed the doorframe, knuckles white."
- If no good replacement exists, DELETE the phrase entirely`;

    if (rewriteIteration && rewriteIteration > 4) {
      // After 4+ iterations, the surgical approach has plateaued — allow bolder changes
      systemPrompt += `

=== ITERATION ${rewriteIteration} — ESCALATED MODE ===
This prose has been rewritten ${rewriteIteration - 1} time(s) without reaching the quality threshold. Previous surgical fixes were insufficient.
SWITCH TO BOLD MODE:
- You may now rewrite MORE than just the flagged sentences if it serves the overall quality
- Restructure sentences for dramatic rhythm variation (mix 3-word punches with 25-word flowing sentences)
- Replace bland or safe word choices with vivid, precise, unexpected ones
- If a passage needs more sensory detail or emotional depth, ADD it (while keeping overall length similar)
- If a previous rewrite introduced new issues, fix those too
- The goal is prose that scores 90+. Be creative and bold, not cautious`;
    } else if (rewriteIteration && rewriteIteration > 2) {
      systemPrompt += `

=== ITERATION ${rewriteIteration} NOTE ===
This prose has been rewritten ${rewriteIteration - 1} time(s). Focus on quality over caution: make each fix count. If a previous rewrite introduced new issues, fix those too. The goal is prose that scores 90+, not prose that is merely unchanged.
- Still change ONLY sentences with listed issues
- But make each change EXCELLENT, not minimal`;
    }

    // Add genre/voice context minimally — just enough to maintain consistency
    if (genre) {
      systemPrompt += `\nGenre context: ${genre}`;
    }
    if (voice && voice !== 'auto') {
      const voiceNames = {
        'first-person': 'first person', 'third-limited': 'third-person limited',
        'third-omniscient': 'third-person omniscient', 'deep-pov': 'deep POV',
        'multiple-pov': 'multiple POV'
      };
      systemPrompt += `\nNarrative voice: ${voiceNames[voice] || voice} (preserve this exactly)`;
    }

    // Inject error pattern database as negative prompts (learned from previous scoring)
    if (errorPatternsPrompt) {
      systemPrompt += errorPatternsPrompt;

      // Add sentence-level validation for rewrites
      systemPrompt += `

=== REWRITE VALIDATION PROTOCOL ===
For EACH sentence you rewrite:
1. Check the replacement against the ERROR PATTERN DATABASE above
2. If the replacement contains ANY known error pattern (PET phrase, AI pattern, cliche, weak word), rewrite it again until clean
3. Do NOT replace one error with another error from the database
4. After fixing all listed issues, re-read the full paragraph to verify no new errors were introduced

CRITICAL: Previous rewrites have failed to improve the score because they introduced new errors from the database while fixing old ones. Break this cycle by validating every replacement.
=== END VALIDATION PROTOCOL ===`;
    }

    let userPrompt = '';

    if (aiInstructions) {
      userPrompt += `=== AUTHOR INSTRUCTIONS ===\n${aiInstructions}\n\n`;
    }

    userPrompt += `=== ORIGINAL PROSE (copy unchanged parts VERBATIM) ===\n${originalProse}\n=== END ORIGINAL PROSE ===\n`;

    if (problems && problems.length > 0) {
      userPrompt += `\n=== ISSUES TO FIX (${problems.length} total — fix ONLY these, change NOTHING else) ===\n`;
      problems.forEach((p, i) => {
        userPrompt += `${i + 1}. ${p}\n`;
      });
      userPrompt += `=== END ISSUES ===\n`;
    }

    if (userInstructions) {
      userPrompt += `\n=== ADDITIONAL REVISION INSTRUCTIONS ===\n${userInstructions}\n`;
    }

    if (characters && characters.length > 0) {
      userPrompt += '\nCharacters for context: ';
      userPrompt += characters.map(c => `${c.name} (${c.role})`).join(', ');
      userPrompt += '\n';
    }

    userPrompt += `\nRewrite the prose, fixing the ${problems?.length || 0} issues listed above. For each fix, ensure the replacement is genuinely better (more vivid, more specific, more human-sounding) — not just different. Copy all non-problematic text verbatim. Output ONLY the prose.`;

    try {
      const response = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: maxTokens || 4096,
          stream: true,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }]
        }),
        signal: this.abortController.signal
      });

      if (!response.ok) {
        const errorBody = await response.text();
        let msg = `API error (${response.status})`;
        try {
          const parsed = JSON.parse(errorBody);
          msg = parsed.error?.message || msg;
        } catch (_) {}
        throw new Error(msg);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;

            try {
              const event = JSON.parse(data);
              if (event.type === 'content_block_delta' && event.delta?.text) {
                onChunk(event.delta.text);
              }
            } catch (_) {}
          }
        }
      }

      this.abortController = null;
      onDone();
    } catch (err) {
      this.abortController = null;
      if (err.name === 'AbortError') {
        onDone();
      } else {
        onError(err);
      }
    }
  }

  /**
   * Generate a cover image prompt by analyzing the story content.
   * Uses Claude to create a vivid image generation prompt.
   */
  async generateCoverPrompt({ title, genre, proseExcerpt, characters }) {
    if (!this.apiKey) {
      throw new Error('No API key set. Go to Settings to add your Anthropic API key.');
    }

    const systemPrompt = `You are an expert book cover designer and art director. Given details about a novel, generate a vivid, detailed image generation prompt for a compelling book cover illustration. The prompt should describe a single striking visual scene that captures the essence and mood of the story. Focus on visual elements: composition, colors, lighting, mood, key imagery, and artistic style. The image should work as a book cover — dramatic, evocative, and visually striking. Do NOT include any text, titles, words, letters, or author names in the image description. Output ONLY the image prompt, nothing else.`;

    let userPrompt = `Generate a book cover image prompt for:\n\nTitle: ${title}\n`;
    if (genre) userPrompt += `Genre: ${genre}\n`;
    if (characters && characters.length > 0) {
      userPrompt += `Key characters: ${characters.map(c => c.name + (c.description ? ' - ' + c.description : '')).join('; ')}\n`;
    }
    if (proseExcerpt) {
      userPrompt += `\nExcerpt from the novel:\n"""${proseExcerpt.slice(0, 3000)}"""\n`;
    }
    userPrompt += `\nGenerate a concise, vivid image prompt (2-3 sentences) for a professional book cover illustration. Focus on mood, key visual elements, and artistic style. Absolutely no text, words, or typography in the image.`;

    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 300,
        messages: [{ role: 'user', content: userPrompt }],
        system: systemPrompt
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      let msg = `API error (${response.status})`;
      try { msg = JSON.parse(errorBody).error?.message || msg; } catch (_) {}
      throw new Error(msg);
    }

    const result = await response.json();
    return result.content?.[0]?.text?.trim() || '';
  }

  /**
   * Generate a cover image using Puter.js (free, no API key, CORS-free).
   * Tries Stable Diffusion 3 first (custom dimensions), then DALL-E 3.
   * Returns a base64 data URL of the generated image.
   */
  async generateCoverWithPuter(prompt) {
    if (typeof puter === 'undefined' || !puter.ai) {
      throw new Error('Puter.js not loaded');
    }

    // Try SD3 (allows custom book-cover dimensions)
    const models = [
      { model: 'stabilityai/stable-diffusion-3-medium', width: 768, height: 1152, steps: 25,
        negative_prompt: 'text, words, letters, typography, watermark, blurry, low quality' },
      { model: 'dall-e-3' }
    ];

    let lastError = null;
    for (const opts of models) {
      try {
        const img = await puter.ai.txt2img(prompt, opts);
        return await this._imgElementToDataUrl(img);
      } catch (err) {
        console.warn(`Puter model ${opts.model} failed:`, err.message);
        lastError = err;
      }
    }
    throw lastError || new Error('Puter image generation failed');
  }

  /**
   * Overlay the project title onto an AI-generated cover image.
   * Uses white bold text with a dark outline for readability on any background.
   * Converts data URL to Blob + object URL for reliable loading on iPad Safari.
   * @param {string} dataUrl - base64 data URL of the image
   * @param {string} title - the project title
   * @returns {Promise<string>} - base64 data URL with title overlaid
   */
  async overlayTitle(dataUrl, title, subtitle) {
    if (!title) return dataUrl;
    try {
      // Convert data URL to Blob → object URL (more reliable than loading huge data URLs)
      const parts = dataUrl.split(',');
      const mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
      const binary = atob(parts[1]);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: mime });
      const objectUrl = URL.createObjectURL(blob);

      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Image load failed'));
        el.src = objectUrl;
      });

      const canvas = document.createElement('canvas');
      const w = img.naturalWidth || img.width || 768;
      const h = img.naturalHeight || img.height || 1024;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');

      // Draw the AI image
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(objectUrl);

      // Add a gradient at the bottom for text readability
      const grad = ctx.createLinearGradient(0, h * 0.55, 0, h);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.7)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, h * 0.55, w, h * 0.45);

      // Calculate font size — scale to fit width with padding
      const maxWidth = w * 0.85;
      let fontSize = Math.round(w * 0.08);
      ctx.font = `bold ${fontSize}px Georgia, "Times New Roman", serif`;

      // Word-wrap text into lines
      const wrapText = (text, size, bold) => {
        ctx.font = `${bold ? 'bold ' : ''}${size}px Georgia, "Times New Roman", serif`;
        const words = text.split(/\s+/);
        const result = [];
        let current = '';
        for (const word of words) {
          const test = current ? current + ' ' + word : word;
          if (ctx.measureText(test).width > maxWidth && current) {
            result.push(current);
            current = word;
          } else {
            current = test;
          }
        }
        if (current) result.push(current);
        return result;
      };

      let titleLines = wrapText(title, fontSize, true);
      if (titleLines.length > 3) {
        fontSize = Math.round(fontSize * 0.7);
        titleLines = wrapText(title, fontSize, true);
      }

      // Calculate subtitle lines if present
      const subtitleFontSize = Math.round(fontSize * 0.55);
      let subtitleLines = [];
      if (subtitle) {
        subtitleLines = wrapText(subtitle, subtitleFontSize, false);
      }

      // Position text near the bottom
      const titleLineHeight = fontSize * 1.3;
      const subtitleLineHeight = subtitleFontSize * 1.4;
      const subtitleGap = subtitle ? subtitleFontSize * 0.8 : 0;
      const totalTextHeight = (titleLines.length * titleLineHeight) + subtitleGap + (subtitleLines.length * subtitleLineHeight);
      const startY = h - totalTextHeight - h * 0.05;

      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';

      // Draw title
      ctx.font = `bold ${fontSize}px Georgia, "Times New Roman", serif`;
      for (let i = 0; i < titleLines.length; i++) {
        const x = w / 2;
        const y = startY + i * titleLineHeight;

        ctx.strokeStyle = 'rgba(0,0,0,0.9)';
        ctx.lineWidth = Math.max(4, fontSize * 0.1);
        ctx.lineJoin = 'round';
        ctx.strokeText(titleLines[i], x, y);

        ctx.fillStyle = '#ffffff';
        ctx.fillText(titleLines[i], x, y);
      }

      // Draw subtitle if present
      if (subtitleLines.length > 0) {
        ctx.font = `italic ${subtitleFontSize}px Georgia, "Times New Roman", serif`;
        const subtitleStartY = startY + titleLines.length * titleLineHeight + subtitleGap;
        for (let i = 0; i < subtitleLines.length; i++) {
          const x = w / 2;
          const y = subtitleStartY + i * subtitleLineHeight;

          ctx.strokeStyle = 'rgba(0,0,0,0.8)';
          ctx.lineWidth = Math.max(2, subtitleFontSize * 0.08);
          ctx.lineJoin = 'round';
          ctx.strokeText(subtitleLines[i], x, y);

          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.fillText(subtitleLines[i], x, y);
        }
      }

      return canvas.toDataURL('image/jpeg', 0.9);
    } catch (err) {
      console.warn('Title overlay failed:', err);
      return dataUrl;
    }
  }

  /**
   * Convert an Image element to a base64 data URL via canvas.
   */
  _imgElementToDataUrl(img) {
    return new Promise((resolve, reject) => {
      const convert = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width || 768;
          canvas.height = img.naturalHeight || img.height || 1152;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        } catch (err) {
          // If canvas tainted (cross-origin), use img.src directly
          if (img.src) resolve(img.src);
          else reject(err);
        }
      };

      if (img.complete && img.naturalWidth > 0) {
        convert();
      } else {
        img.onload = convert;
        img.onerror = () => reject(new Error('Puter image element failed to load'));
      }
    });
  }

  /**
   * Generate a cover image using Hugging Face via Puter.js CORS-free fetch.
   * puter.net.fetch() proxies requests through Puter's servers, bypassing CORS.
   * Returns a base64 data URL.
   */
  async generateCoverViaHF(prompt, hfToken) {
    if (!hfToken) throw new Error('No Hugging Face token set.');
    if (typeof puter === 'undefined' || !puter.net || !puter.net.fetch) {
      throw new Error('Puter.js net.fetch not available');
    }

    const models = [
      'stabilityai/stable-diffusion-xl-base-1.0',
      'black-forest-labs/FLUX.1-schnell'
    ];

    let lastError = null;
    for (const model of models) {
      try {
        const url = `https://api-inference.huggingface.co/models/${model}`;
        console.log(`Trying HF model via puter.net.fetch: ${model}`);

        let response = await puter.net.fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${hfToken}`,
            'Content-Type': 'application/json',
            'x-wait-for-model': 'true'
          },
          body: JSON.stringify({ inputs: prompt })
        });

        // Handle model cold start — retry up to 2 times
        let retries = 0;
        while (response.status === 503 && retries < 2) {
          let wait = 30000;
          try {
            const body = await response.json();
            wait = Math.min((body.estimated_time || 30) * 1000, 45000);
          } catch (_) {}
          console.log(`HF model loading (attempt ${retries + 1}), waiting ${Math.round(wait / 1000)}s...`);
          await new Promise(r => setTimeout(r, wait));
          response = await puter.net.fetch(url, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${hfToken}`,
              'Content-Type': 'application/json',
              'x-wait-for-model': 'true'
            },
            body: JSON.stringify({ inputs: prompt })
          });
          retries++;
        }

        if (!response.ok) {
          const text = await response.text();
          let msg = `HF error (${response.status})`;
          try { msg = JSON.parse(text).error || msg; } catch (_) {}
          throw new Error(msg);
        }

        const ct = response.headers.get('content-type') || '';
        if (!ct.startsWith('image/')) {
          const text = await response.text();
          throw new Error(`Expected image, got ${ct}: ${text.slice(0, 100)}`);
        }

        const blob = await response.blob();
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('Failed to read image data'));
          reader.readAsDataURL(blob);
        });
      } catch (err) {
        console.warn(`HF model ${model} via puter.net.fetch failed:`, err.message);
        lastError = err;
        if (err.message.includes('401') || err.message.includes('403')) throw err;
      }
    }
    throw lastError || new Error('All HF models failed via puter.net.fetch');
  }

  /**
   * Generate a cover image using Hugging Face via a CORS proxy.
   * Returns a base64 data URL of the generated image.
   */
  async generateCoverImage(prompt, hfToken) {
    if (!hfToken) {
      throw new Error('No Hugging Face token set.');
    }

    const models = [
      'stabilityai/stable-diffusion-xl-base-1.0',
      'black-forest-labs/FLUX.1-schnell'
    ];

    let lastError = null;
    for (const model of models) {
      try {
        return await this._callHuggingFaceViaProxy(model, prompt, hfToken);
      } catch (err) {
        console.warn(`Model ${model} failed:`, err.message);
        lastError = err;
        if (err.message.includes('401') || err.message.includes('403')) throw err;
      }
    }
    throw lastError || new Error('All image generation models failed.');
  }

  async _callHuggingFaceViaProxy(model, prompt, hfToken) {
    const targetUrl = `https://api-inference.huggingface.co/models/${model}`;

    // Try multiple CORS proxy URL formats
    const proxyUrls = [
      `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`,
      `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`
    ];

    let lastError = null;
    for (const proxyUrl of proxyUrls) {
      try {
        return await this._fetchHfImage(proxyUrl, prompt, hfToken);
      } catch (err) {
        console.warn(`Proxy format failed:`, err.message);
        lastError = err;
      }
    }
    throw lastError;
  }

  async _fetchHfImage(proxyUrl, prompt, hfToken) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000); // 90s total timeout

    try {
      const doFetch = () => fetch(proxyUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${hfToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ inputs: prompt }),
        signal: controller.signal
      });

      let response = await doFetch();

      // Model cold start — wait and retry up to 2 times
      let retries = 0;
      while (response.status === 503 && retries < 2) {
        const body = await response.json().catch(() => ({}));
        const wait = Math.min((body.estimated_time || 30) * 1000, 45000);
        console.log(`HF model loading (attempt ${retries + 1}), waiting ${Math.round(wait / 1000)}s...`);
        await new Promise(r => setTimeout(r, wait));
        response = await doFetch();
        retries++;
      }

      if (!response.ok) {
        const text = await response.text();
        let msg = `Hugging Face error (${response.status})`;
        try { msg = JSON.parse(text).error || msg; } catch (_) {}
        throw new Error(msg);
      }

      const ct = response.headers.get('content-type') || '';
      if (!ct.startsWith('image/')) {
        const text = await response.text();
        throw new Error(`Expected image, got ${ct}: ${text.slice(0, 100)}`);
      }

      const blob = await response.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Failed to read image data'));
        reader.readAsDataURL(blob);
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Build a Pollinations.ai image URL from a prompt.
   * Uses img src approach which bypasses CORS entirely.
   */
  getCoverImageUrl(prompt) {
    const encoded = encodeURIComponent(prompt);
    // Deterministic seed from prompt hash
    let hash = 0;
    for (let i = 0; i < prompt.length; i++) {
      hash = ((hash << 5) - hash) + prompt.charCodeAt(i);
      hash |= 0;
    }
    const seed = Math.abs(hash);
    return `https://image.pollinations.ai/prompt/${encoded}?width=600&height=900&seed=${seed}`;
  }

  /**
   * Get a genre-appropriate cover design for canvas fallback.
   */
  getDefaultCoverDesign(genre) {
    const g = (genre || '').toLowerCase();

    const designs = {
      romance:  { bgGradient: ['#8e2de2','#4a00e0','#2d1b69'], accentColor: '#ff6b6b', titleColor: '#ffffff', subtitleColor: 'rgba(255,255,255,0.7)', pattern: 'waves',    symbol: '\u2665', overlay: 'dark' },
      thriller: { bgGradient: ['#1a1a2e','#16213e','#0f3460'], accentColor: '#e94560', titleColor: '#ffffff', subtitleColor: 'rgba(255,255,255,0.7)', pattern: 'lines',    symbol: '\u2620', overlay: 'dark' },
      fantasy:  { bgGradient: ['#2d1b69','#1a0a3e','#0f0728'], accentColor: '#ffd700', titleColor: '#ffd700', subtitleColor: 'rgba(255,215,0,0.7)',   pattern: 'stars',    symbol: '\u2726', overlay: 'dark' },
      'sci-fi': { bgGradient: ['#0c0c1d','#1a1a3e','#0a2a4a'], accentColor: '#00d4ff', titleColor: '#00d4ff', subtitleColor: 'rgba(0,212,255,0.7)',   pattern: 'circles',  symbol: '\u2605', overlay: 'dark' },
      science:  { bgGradient: ['#0c0c1d','#1a1a3e','#0a2a4a'], accentColor: '#00d4ff', titleColor: '#00d4ff', subtitleColor: 'rgba(0,212,255,0.7)',   pattern: 'circles',  symbol: '\u2605', overlay: 'dark' },
      horror:   { bgGradient: ['#1a0000','#2d0000','#0a0a0a'], accentColor: '#cc0000', titleColor: '#cc0000', subtitleColor: 'rgba(204,0,0,0.5)',     pattern: 'lines',    symbol: '\u2620', overlay: 'dark' },
      mystery:  { bgGradient: ['#1a1a2e','#0a1628','#0f2f4f'], accentColor: '#d4a574', titleColor: '#d4a574', subtitleColor: 'rgba(212,165,116,0.7)', pattern: 'diamonds',  symbol: '?',     overlay: 'dark' },
      literary: { bgGradient: ['#2c2c2c','#1a1a1a','#333333'], accentColor: '#c9a96e', titleColor: '#c9a96e', subtitleColor: 'rgba(201,169,110,0.7)', pattern: 'dots',     overlay: 'dark' }
    };

    let design = designs.literary; // default
    for (const [key, val] of Object.entries(designs)) {
      if (g.includes(key)) { design = val; break; }
    }
    return { ...design, mood: genre || 'A Novel' };
  }

  /**
   * Render a book cover design to a canvas and return as base64 PNG data URL.
   */
  renderCover(design, title, author, width = 600, height = 900) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // Background gradient
    const colors = design.bgGradient || ['#1a1a2e', '#16213e', '#0f3460'];
    const grad = ctx.createLinearGradient(0, 0, width * 0.3, height);
    grad.addColorStop(0, colors[0]);
    grad.addColorStop(0.5, colors[1]);
    grad.addColorStop(1, colors[2]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Pattern overlay
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = design.accentColor || '#ffffff';
    const pattern = design.pattern || 'circles';
    this._drawPattern(ctx, pattern, width, height);
    ctx.globalAlpha = 1.0;

    // Dark/light overlay for readability
    if (design.overlay === 'dark') {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(0, 0, width, height);
    } else if (design.overlay === 'light') {
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(0, 0, width, height);
    }

    // Accent bar at top
    const accent = design.accentColor || '#e94560';
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, width, 6);

    // Symbol (large, centered)
    if (design.symbol) {
      ctx.globalAlpha = 0.12;
      ctx.font = `${Math.round(width * 0.5)}px serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = design.accentColor || '#ffffff';
      ctx.fillText(design.symbol, width / 2, height * 0.52);
      ctx.globalAlpha = 1.0;
    }

    // Title
    ctx.textAlign = 'center';
    ctx.fillStyle = design.titleColor || '#ffffff';
    const titleSize = Math.round(width * 0.085);
    ctx.font = `bold ${titleSize}px Georgia, serif`;
    this._wrapText(ctx, title.toUpperCase(), width / 2, height * 0.28, width * 0.8, titleSize * 1.2);

    // Mood / tagline
    if (design.mood) {
      ctx.fillStyle = design.subtitleColor || 'rgba(255,255,255,0.7)';
      const moodSize = Math.round(width * 0.035);
      ctx.font = `italic ${moodSize}px Georgia, serif`;
      ctx.fillText(design.mood, width / 2, height * 0.58);
    }

    // Author name at bottom
    if (author) {
      ctx.fillStyle = design.subtitleColor || 'rgba(255,255,255,0.8)';
      const authorSize = Math.round(width * 0.045);
      ctx.font = `${authorSize}px Georgia, serif`;
      ctx.fillText(author, width / 2, height * 0.88);
    }

    // Bottom accent bar
    ctx.fillStyle = accent;
    ctx.fillRect(0, height - 6, width, 6);

    // Subtle border
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 2;
    ctx.strokeRect(width * 0.05, height * 0.03, width * 0.9, height * 0.94);

    return canvas.toDataURL('image/png');
  }

  _drawPattern(ctx, pattern, w, h) {
    const step = 40;
    switch (pattern) {
      case 'circles':
        for (let x = 0; x < w; x += step) {
          for (let y = 0; y < h; y += step) {
            ctx.beginPath();
            ctx.arc(x, y, 8, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        break;
      case 'waves':
        for (let y = 0; y < h; y += step) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          for (let x = 0; x < w; x += 10) {
            ctx.lineTo(x, y + Math.sin(x * 0.05) * 12);
          }
          ctx.stroke();
        }
        break;
      case 'diamonds':
        for (let x = 0; x < w; x += step) {
          for (let y = 0; y < h; y += step) {
            ctx.beginPath();
            ctx.moveTo(x, y - 10);
            ctx.lineTo(x + 10, y);
            ctx.lineTo(x, y + 10);
            ctx.lineTo(x - 10, y);
            ctx.closePath();
            ctx.fill();
          }
        }
        break;
      case 'stars':
        for (let x = 20; x < w; x += step * 1.5) {
          for (let y = 20; y < h; y += step * 1.5) {
            ctx.font = '16px serif';
            ctx.fillText('\u2726', x, y);
          }
        }
        break;
      case 'lines':
        for (let i = -h; i < w + h; i += step) {
          ctx.beginPath();
          ctx.moveTo(i, 0);
          ctx.lineTo(i + h, h);
          ctx.stroke();
        }
        break;
      default: // dots
        for (let x = 0; x < w; x += step / 2) {
          for (let y = 0; y < h; y += step / 2) {
            ctx.beginPath();
            ctx.arc(x, y, 2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
    }
  }

  _wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '';
    let currentY = y;
    for (const word of words) {
      const test = line + word + ' ';
      if (ctx.measureText(test).width > maxWidth && line.length > 0) {
        ctx.fillText(line.trim(), x, currentY);
        line = word + ' ';
        currentY += lineHeight;
      } else {
        line = test;
      }
    }
    ctx.fillText(line.trim(), x, currentY);
  }
}

export { ProseGenerator };
