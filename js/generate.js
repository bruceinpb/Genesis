/**
 * Genesis 2 — AI Prose Generation Module
 * Uses the Anthropic Messages API to generate prose from story plots.
 * Calls the API directly from the browser via CORS-enabled endpoint.
 */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';

/** Lazy-load the Puter.js SDK only when AI image features are used. */
let _puterLoading = null;
function loadPuterSDK() {
  if (typeof puter !== 'undefined') return Promise.resolve();
  if (_puterLoading) return _puterLoading;
  _puterLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://js.puter.com/v2/';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Puter.js SDK'));
    document.head.appendChild(script);
  });
  return _puterLoading;
}

class ProseGenerator {
  constructor(storage) {
    this.storage = storage;
    this.apiKey = null;
    this.model = DEFAULT_MODEL;
    this.abortController = null;
  }

  async init() {
    this.apiKey = (await this.storage.getSetting('anthropicApiKey', '') || '').trim();
    this.model = await this.storage.getSetting('aiModel', DEFAULT_MODEL);
  }

  async setApiKey(key) {
    this.apiKey = (key || '').trim();
    await this.storage.setSetting('anthropicApiKey', this.apiKey);
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
  async generate({ plot, existingContent, sceneTitle, chapterTitle, characters, notes, chapterOutline, aiInstructions, tone, style, wordTarget, maxTokens, concludeStory, genre, genreRules, projectGoal, voice, errorPatternsPrompt, poetryLevel, authorPalette }, { onChunk, onDone, onError }) {
    if (!this.apiKey) {
      onError(new Error('No API key set. Go to Settings to add your Anthropic API key.'));
      return;
    }

    this.abortController = new AbortController();

    const systemPrompt = this._buildSystemPrompt({ tone, style, genre, genreRules, voice, errorPatternsPrompt, poetryLevel, authorPalette });
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

IMPORTANT — KNOWLEDGE BASE INTEGRATION:
If the notes section contains a "PROJECT KNOWLEDGE BASE" section, you MUST actively incorporate information from those reference materials into your outlines. This includes:
- Historical facts, dates, names, and events should be woven into chapter events
- Technical details and domain knowledge should inform scene accuracy
- World-building information should shape settings and atmosphere
- Character background information should drive motivations and dialogue
- Any research materials should enrich the specificity and authenticity of each chapter outline

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

    const systemPrompt = `You are a master book architect revising a chapter outline. The author has given MANDATORY revision instructions that MUST be applied. Every instruction the author gives is a hard requirement — not a suggestion. If the author says to remove something, it MUST be removed. If the author says to change something, it MUST be changed. Output ONLY the revised outline text (200-250 words). No commentary, no labels, no JSON — just the outline text.`;

    let userPrompt = `Revise this chapter outline. The author's instructions below are MANDATORY — every single one must be fully applied.

Book: ${bookTitle}${genre ? ` (${genre})` : ''}
Chapter: ${chapterTitle}

Current Outline:
${currentOutline}

MANDATORY Author Revision Instructions (apply ALL of these):
${userInstructions}

IMPORTANT: You MUST apply every one of the author's instructions above. Do not preserve any element the author has asked to remove or change. The revised outline must clearly reflect ALL requested changes.`;

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
  async scoreProse(proseText, { isRewrite, previousIssueCount, previousSubscores } = {}) {
    if (!this.apiKey) {
      throw new Error('No API key set.');
    }

    // Build anchoring context for rewrites when previous subscores are available
    let rewriteContext = '';
    if (isRewrite && previousSubscores) {
      const subscoreLines = Object.entries(previousSubscores)
        .map(([k, v]) => `  ${k}: ${v}`)
        .join('\n');
      rewriteContext = `IMPORTANT CONTEXT: This prose was rewritten to fix ${previousIssueCount || 'several'} identified issues.
PREVIOUS SUB-SCORES (from the pre-fix version):
${subscoreLines}

SCORING RULES FOR REWRITES:
- Use the previous sub-scores as your BASELINE REFERENCE
- For each dimension, compare the rewritten text against what the previous score reflected
- Only CHANGE a sub-score if you see CONCRETE, SPECIFIC evidence that the dimension improved or degraded
- If a dimension reads roughly the same as before, keep the same sub-score — do NOT introduce random variance
- Do NOT artificially inflate or deflate scores
- Do NOT flag borderline cases or nitpick — only flag clear, unambiguous problems
- Do NOT penalize the same dimension twice for the same type of issue
- A sub-score should only decrease if you can point to specific text that is WORSE than what the score previously reflected
- A sub-score should only increase if you can point to specific text that is BETTER than what the score previously reflected`;
    } else if (isRewrite) {
      rewriteContext = `IMPORTANT CONTEXT: This prose was just rewritten to fix ${previousIssueCount || 'several'} identified issues.
SCORING RULES FOR REWRITES:
- Score this text on its own merits
- Do NOT artificially inflate or deflate the score
- Do NOT flag borderline cases or nitpick — only flag clear, unambiguous problems that a professional editor would actually flag
- Do NOT penalize the same dimension twice for the same type of issue
- If a passage is competent but not exceptional, that is NOT an issue — only flag things that are clearly wrong
- Judge each dimension independently based on the text in front of you`;
    }

    const systemPrompt = `You are a senior literary editor at The New York Times with 40 years of experience reviewing fiction. You score prose honestly and critically on a 100-point scale. You also detect common AI-generated writing patterns.

${rewriteContext}

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

AI PATTERN DENSITY CAPS (mandatory):
After identifying all AI patterns, apply these HARD CAPS:
- 0-1 AI patterns found: No cap. Score dimensions normally.
- 2-3 AI patterns found: Cap "Originality & Voice" at 8/10. Cap "Technical Execution" at 8/10.
- 4-5 AI patterns found: Cap "Originality & Voice" at 7/10. Cap "Technical Execution" at 7/10.
- 6+ AI patterns found: Cap "Originality & Voice" at 6/10. Cap "Technical Execution" at 6/10.

AI patterns include: tricolons, personified abstractions, formulaic paragraph structures, rhetorical parallelism as crutch, explanatory narration, PET phrases, overwrought similes, dramatic kicker paragraphs.

Count each INSTANCE, not each type. Two separate tricolons = 2 patterns. One tricolon + one personification = 2 patterns.

This is NOT optional. These caps exist because prose with many AI patterns cannot be considered "original" or "technically excellent" regardless of how strong the other dimensions are.
- A score of 88-95 is achievable for well-crafted prose with deliberate sentence variety, concrete sensory details, and authentic voice. Do not artificially cap scores
- Be specific: cite exact passages as evidence for each sub-score. When a dimension is strong, give it a high score — do not look for problems where none exist

KNOWN AI WRITING PATTERNS to detect:
- Overuse of "delicate", "intricate", "testament to", "tapestry", "symphony of", "dance of", "nestled", "whispering"
- Starting sentences with "As" or "While" excessively (count them)
- ZERO tricolons. Never write any list of three items, three adjectives, three clauses, or three parallel phrases. This is the single most common AI writing pattern. If you need multiple items, use exactly two. If you need three things, make the third its own separate sentence. This is non-negotiable
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
  "issues": [{"text": "quoted problematic passage", "problem": "description", "severity": "high|medium|low", "category": "ai-pattern|tricolon|formulaic|parallelism|simile|pet-phrase|telling|cliche|weak-words|passive|structure|pacing|other", "estimatedImpact": number}],
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
      // Enforce AI pattern density caps
      // Count from both aiPatterns array and AI-categorized issues
      if (parsed.subscores) {
        const aiPatternCount = (parsed.aiPatterns || []).reduce((sum, p) =>
          sum + (p.examples?.length || 1), 0
        );
        // Also count issues categorized as AI patterns
        const aiIssueCount = (parsed.issues || []).filter(i =>
          ['ai-pattern', 'tricolon', 'formulaic', 'parallelism', 'simile', 'pet-phrase'].includes(i.category)
        ).length;
        const totalAiPatterns = Math.max(aiPatternCount, aiIssueCount);

        let cap = Infinity;
        if (totalAiPatterns >= 6) cap = 6;
        else if (totalAiPatterns >= 4) cap = 7;
        else if (totalAiPatterns >= 2) cap = 8;

        if (cap < Infinity) {
          if (parsed.subscores.originalityVoice > cap) parsed.subscores.originalityVoice = cap;
          if (parsed.subscores.technicalExecution > cap) parsed.subscores.technicalExecution = cap;
          // Recalculate total
          const sum = Object.values(parsed.subscores).reduce((a, b) => a + (Number(b) || 0), 0);
          parsed.score = Math.round(sum);
        }
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

  /**
   * Combined score + targeted improvement in a single API call.
   * The model scores the prose, identifies the top issues, and outputs
   * the improved version — all in one response with full context.
   *
   * Returns { score, subscores, label, issues, improvedProse, summary, fourRequirementsFound }
   */
  async scoreAndImprove(proseText, {
    threshold = 90,
    iterationNum = 1,
    previousScore = null,
    previousIssues = null,
    lintDefects = [],
    intentLedger = null,
    genre = '',
    voice = '',
    aiInstructions = '',
    isEscalated = false
  } = {}) {
    if (!this.apiKey) throw new Error('No API key set.');

    const systemPrompt = `You are a senior literary editor at The New York Times with 40 years of experience. You will SCORE the prose, then IMPROVE it in one pass.

=== SCORING RUBRIC (100 points total) ===
Score each dimension independently based on EVIDENCE from the text:
1. Sentence variety and rhythm (0-15): Measure actual sentence length variation. Similar lengths = 4-6. Genuine variety between short punchy and long flowing = 10+.
2. Dialogue authenticity (0-15): Distinct character voices? Natural tags? If no dialogue, score narrative voice distinctiveness.
3. Sensory detail / show vs tell (0-15): Count concrete SHOWING vs abstract TELLING. Heavy telling = 3-5. Mostly showing = 10+.
4. Emotional resonance and depth (0-15): Emotions conveyed through behavior, not named? Character interiority beyond surface?
5. Vocabulary precision (0-10): Specific, earned words? Or generic, interchangeable?
6. Narrative flow and pacing (0-10): Right speed? Smooth transitions? Varied paragraph lengths?
7. Originality and voice (0-10): Distinct author voice? Or generic AI prose?
8. Technical execution (0-10): Grammar, punctuation, paragraph breaks.

CALIBRATION:
- 40-60: Raw AI prose with cliches, formulaic structure
- 65-78: Competent fiction with some AI patterns, generic descriptions
- 78-88: Strong human-quality writing with good variety, specific details
- 88-95: Excellent prose with deliberate rhythm, vivid specificity, genuine emotional resonance
- 96-100: Truly masterful, rare even in published fiction

PROSECUTION FIRST: Identify ALL weaknesses before assessing strengths. Do not look for positives until negatives are catalogued.

=== IMPROVEMENT RULES ===
After scoring, if the score is below ${threshold}:
- Identify the TOP 3-5 highest-impact issues
- For each issue, make the MINIMUM change needed to fix it
- Copy all non-problematic text VERBATIM
- NEVER introduce: em dashes, PET phrases, AI-telltale words, filter words, tricolons
- NEVER replace a PET phrase with another PET phrase
- Preserve: voice, tense, POV, paragraph structure, approximate word count
- Each fix must make the prose measurably BETTER, not just different

${isEscalated ? `=== ESCALATED MODE ===
Previous iteration did not reach threshold. Be BOLDER:
- Rewrite weak sentences entirely rather than just swapping words
- Add vivid new sensory details where prose is generic
- Dramatically vary sentence rhythm where it's monotonous
- But STILL preserve voice, POV, and narrative intent` : ''}

${lintDefects.length > 0 ? `=== HARD DEFECTS FOUND BY LINT (must fix ALL) ===
${lintDefects.map((d, i) => `${i+1}. [${d.severity}] ${d.type}: "${d.text}" \u2014 ${d.suggestion}`).join('\n')}` : ''}

${intentLedger ? `=== INTENT LEDGER (preserve these non-negotiables) ===
- POV: ${intentLedger.povCharacter || 'unknown'} (${intentLedger.povType || 'unknown'})
- Tense: ${intentLedger.tense || 'past'}
- Emotional arc: ${intentLedger.emotionalArc || 'unknown'}
- Scene change: ${intentLedger.sceneChange || 'unknown'}
- Sensory anchors to preserve: ${(intentLedger.sensoryAnchors || []).join(', ')}
- Canon facts (DO NOT ALTER): ${(intentLedger.canonFacts || []).join(', ')}` : ''}

${previousScore !== null ? `=== PREVIOUS ATTEMPT ===
Previous score: ${previousScore}/100. ${previousIssues ? `Issues that were flagged: ${previousIssues}` : ''}
This is attempt ${iterationNum}. The previous fixes were insufficient. Take a DIFFERENT approach.` : ''}

${genre ? `Genre: ${genre}` : ''}
${voice ? `Narrative voice: ${voice} (preserve exactly)` : ''}
${aiInstructions ? `Author instructions: ${aiInstructions}` : ''}

=== OUTPUT FORMAT ===
You MUST output valid JSON with this exact structure:
{
  "score": number (sum of subscores),
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
  "label": "Exceptional|Strong|Good|Competent|Needs Work",
  "issues": [
    {"text": "quoted passage", "problem": "description", "severity": "high|medium|low", "fix_applied": "what was changed (or 'none' if score >= threshold)"}
  ],
  "summary": "2-3 sentence assessment",
  "improvedProse": "The complete improved prose if score < ${threshold}. If score >= ${threshold}, set to null.",
  "fourRequirementsFound": {
    "characterSpecificThought": "quote or null",
    "preciseObservation": "quote or null",
    "musicalSentence": "quote or null",
    "expectationBreak": "quote or null"
  }
}

CRITICAL: The total score MUST equal the sum of all subscores. Do NOT round or adjust.
CRITICAL: If score >= ${threshold}, set "improvedProse" to null. Do not rewrite prose that already meets the bar.
CRITICAL: If score < ${threshold}, "improvedProse" MUST contain the COMPLETE rewritten passage with fixes applied.`;

    const userPrompt = `Score this prose using prosecution-first methodology, then improve it if below ${threshold}/100. Output valid JSON only.\n\n"""${proseText}"""`;

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
        temperature: 0,
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
    const rawText = result.content?.[0]?.text?.trim() || '';

    // Parse JSON (handle markdown wrapping)
    let jsonStr = rawText;
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();
    const braceStart = jsonStr.indexOf('{');
    const braceEnd = jsonStr.lastIndexOf('}');
    if (braceStart >= 0 && braceEnd > braceStart) {
      jsonStr = jsonStr.slice(braceStart, braceEnd + 1);
    }

    try {
      const parsed = JSON.parse(jsonStr);
      // Validate score = sum of subscores
      if (parsed.subscores) {
        const sum = Object.values(parsed.subscores).reduce((a, b) => a + (Number(b) || 0), 0);
        parsed.score = Math.round(sum);
      }
      // Assign label
      if (parsed.score >= 88) parsed.label = 'Exceptional';
      else if (parsed.score >= 78) parsed.label = 'Strong';
      else if (parsed.score >= 65) parsed.label = 'Good';
      else if (parsed.score >= 50) parsed.label = 'Competent';
      else parsed.label = 'Needs Work';

      return parsed;
    } catch (e) {
      return {
        score: 0, label: 'Parse Error', subscores: {},
        issues: [], summary: 'Failed to parse response',
        improvedProse: null, fourRequirementsFound: {}
      };
    }
  }

  /**
   * Score prose, apply ONE micro-fix, validate internally, return only if improved.
   *
   * KEY INNOVATION: The model scores BEFORE and AFTER its own fix in the same
   * API call, eliminating inter-call scoring variance. The fix is only returned
   * if the model's internal validation confirms improvement.
   *
   * Returns {
   *   beforeScore, afterScore, subscores, label, issues,
   *   microFixedProse (null if no improvement), fixApplied, fixCategory,
   *   summary, fourRequirementsFound
   * }
   */
  async scoreAndMicroFix(proseText, {
    threshold = 90,
    iterationNum = 1,
    maxIterations = 3,
    previousFixes = [],      // Accepted fixes
    attemptedFixes = [],      // ALL attempted fixes (accepted + rejected)
    lintDefects = [],
    intentLedger = null,
    genre = '',
    voice = '',
    aiInstructions = ''
  } = {}) {
    if (!this.apiKey) throw new Error('No API key set.');

    const isFirstPass = iterationNum === 1;
    const isFinalPass = iterationNum >= maxIterations;

    const systemPrompt = `You are a senior literary editor at The New York Times with 40 years of experience reviewing fiction. You will perform a precise 3-step process:

STEP 1: SCORE the prose as-is (the "before" score)
STEP 2: Apply exactly ONE surgical micro-fix to the single highest-impact issue
STEP 3: SCORE your fixed version (the "after" score) — be HONEST, not optimistic

Only return the fix if the after-score is HIGHER than the before-score.
If the after-score is not higher, set microFixedProse to null and explain why you couldn't improve it without introducing new problems.

=== SCORING RUBRIC (100 points total) ===
Score each dimension independently based on EVIDENCE from the text:
1. Sentence variety and rhythm (0-15): Measure actual sentence length variation.
2. Dialogue authenticity (0-15): Distinct character voices? If no dialogue, score narrative voice.
3. Sensory detail / show vs tell (0-15): Count concrete SHOWING vs abstract TELLING.
4. Emotional resonance and depth (0-15): Emotions through behavior, not named?
5. Vocabulary precision (0-10): Specific, earned words?
6. Narrative flow and pacing (0-10): Right speed? Varied paragraph lengths?
7. Originality and voice (0-10): Distinct author voice?
8. Technical execution (0-10): Grammar, punctuation, paragraph breaks.

CALIBRATION:
- 40-60: Raw AI prose
- 65-78: Competent, some AI patterns
- 78-88: Strong human-quality writing
- 88-95: Excellent, deliberate craft
- 96-100: Masterful

PROSECUTION FIRST: Catalogue ALL weaknesses before acknowledging strengths.

=== CONSISTENCY RULE ===
When scoring the "before" and "after" versions, use IDENTICAL standards. Do not grade on a curve. Do not give the "after" version credit just because you tried to improve it. If your fix weakened another dimension (e.g., broke rhythm to fix a tricolon), the after-score for that dimension must reflect the damage.

=== AI PATTERN DETECTION ===
Flag EVERY instance of:
- TRICOLONS: "X, Y, and Z" lists of three. Fix: use two items or restructure.
- PERSONIFIED ABSTRACTIONS: Non-physical things that "live," "settle," "creep," "wash over," have "weight," "color." Fix: replace with concrete observable action.
- OVERWROUGHT SIMILES: Similes that sound crafted rather than observed. Fix: simplify or use the character's own vocabulary.
- FORMULAIC STRUCTURES: observation → metaphor → thematic statement; punchy one-liner paragraphs for dramatic effect; paragraph-ending epigrams. Fix: restructure.
- RHETORICAL PARALLELISM: "X would... Y would..." used as structural crutch. Fix: break the parallel.
- PET PHRASES: body-reaction shortcuts (throat tightened, heart pounded, etc.). Fix: character-specific action.
- TELLING EMOTIONS: naming the emotion. Fix: show through action.

=== MICRO-FIX RULES ===
PRIORITY OVERRIDE: If any tricolons remain, fix a tricolon FIRST — even if another issue has higher estimated impact. Tricolons are the #1 factor in the AI pattern density cap that limits your Originality and Technical scores. Removing tricolons lifts the cap.

${isFinalPass ? 'This is the FINAL scoring pass. Score only — do NOT apply any fix. Set microFixedProse to null.' : `
1. From all issues found, pick the SINGLE highest-impact issue (but tricolons always take priority — see PRIORITY OVERRIDE above)
2. Change the ABSOLUTE MINIMUM words to fix it (1-3 sentences max)
3. Copy ALL other text VERBATIM — character for character, including punctuation
4. Your fix must NOT introduce ANY new issues (no new AI patterns, tricolons, PET phrases, personification)
5. After writing your fix, re-read the full passage. Does the rhythm still work? Did you break anything?
6. Score your fixed version HONESTLY in Step 3

WHEN YOU CANNOT IMPROVE:
Sometimes the best fix for an issue would damage something else. In that case:
- Set microFixedProse to null
- Explain in fixApplied: "Could not fix [issue] without damaging [dimension]"
- This is BETTER than returning a fix that makes the prose worse`}

${lintDefects.length > 0 ? `\n=== HARD DEFECTS FROM LINT (highest priority) ===\n${lintDefects.map((d, i) => `${i + 1}. [${d.severity}] ${d.type}: "${d.text}" — ${d.suggestion}`).join('\n')}` : ''}

${attemptedFixes.length > 0 ? `\n=== FIXES ALREADY ATTEMPTED (DO NOT retry these — pick a DIFFERENT issue) ===\n${attemptedFixes.map((f, i) => `Attempt ${i + 1}: ${f}`).join('\n')}\nYou MUST target a different issue than any listed above. If no other fixable issues remain, set microFixedProse to null.` : ''}

${intentLedger ? `\n=== INTENT LEDGER (non-negotiables) ===\n- POV: ${intentLedger.povCharacter || 'unknown'} (${intentLedger.povType || 'unknown'})\n- Tense: ${intentLedger.tense || 'past'}\n- Emotional arc: ${intentLedger.emotionalArc || 'unknown'}\n- Canon facts: ${(intentLedger.canonFacts || []).join(', ')}` : ''}

${genre ? `Genre: ${genre}` : ''}
${voice ? `Narrative voice: ${voice} (preserve exactly)` : ''}
${aiInstructions ? `Author instructions: ${aiInstructions}` : ''}

=== OUTPUT FORMAT ===
Output valid JSON:
{
  "beforeScore": number (Step 1 score — sum of beforeSubscores),
  "beforeSubscores": {
    "sentenceVariety": number,
    "dialogueAuthenticity": number,
    "sensoryDetail": number,
    "emotionalResonance": number,
    "vocabularyPrecision": number,
    "narrativeFlow": number,
    "originalityVoice": number,
    "technicalExecution": number
  },
  "afterScore": number (Step 3 score after fix applied — sum of afterSubscores. Same as beforeScore if no fix applied),
  "afterSubscores": {
    "sentenceVariety": number,
    "dialogueAuthenticity": number,
    "sensoryDetail": number,
    "emotionalResonance": number,
    "vocabularyPrecision": number,
    "narrativeFlow": number,
    "originalityVoice": number,
    "technicalExecution": number
  },
  "label": "Exceptional|Strong|Good|Competent|Needs Work",
  "issues": [
    {"text": "quoted passage", "problem": "description", "severity": "high|medium|low", "category": "ai-pattern|tricolon|pet-phrase|telling|simile|cliche|formulaic|parallelism|weak-word|rhythm|other", "estimatedImpact": number}
  ],
  "summary": "2-3 sentence assessment of the original prose",
  "fixApplied": "Description of the ONE fix made, or explanation of why no fix was applied",
  "fixCategory": "ai-pattern|tricolon|pet-phrase|telling|simile|cliche|formulaic|parallelism|weak-word|rhythm|other|none",
  "fixTarget": "The exact text that was changed (for tracking attempted fixes)",
  "microFixedProse": "COMPLETE prose with ONE fix applied. null if beforeScore >= ${threshold}, or if fix would not improve the score, or if this is the final pass.",
  "internalValidation": "Explanation of why the after-score is higher/lower/same. What dimension improved? Did any dimension get worse?",
  "fourRequirementsFound": {
    "characterSpecificThought": "quote or null",
    "preciseObservation": "quote or null",
    "musicalSentence": "quote or null",
    "expectationBreak": "quote or null"
  }
}

CRITICAL RULES:
- beforeScore MUST equal sum of beforeSubscores. afterScore MUST equal sum of afterSubscores.
- If afterScore <= beforeScore, set microFixedProse to null. The fix didn't help.
- microFixedProse must contain the COMPLETE passage, not just the changed part.
- Be HONEST in Step 3. Do not inflate the after-score to justify your fix.`;

    const userPrompt = `Perform the 3-step process: (1) Score this prose, (2) Apply one micro-fix to the highest-impact issue, (3) Score your fixed version. Only return the fix if it genuinely improved the score. Output valid JSON only.\n\n"""${proseText}"""`;

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
        temperature: 0,
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
    const rawText = result.content?.[0]?.text?.trim() || '';

    // Parse JSON
    let jsonStr = rawText;
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();
    const braceStart = jsonStr.indexOf('{');
    const braceEnd = jsonStr.lastIndexOf('}');
    if (braceStart >= 0 && braceEnd > braceStart) {
      jsonStr = jsonStr.slice(braceStart, braceEnd + 1);
    }

    try {
      const parsed = JSON.parse(jsonStr);
      // Validate scores = sum of subscores
      if (parsed.beforeSubscores) {
        const sum = Object.values(parsed.beforeSubscores).reduce((a, b) => a + (Number(b) || 0), 0);
        parsed.beforeScore = Math.round(sum);
      }
      if (parsed.afterSubscores) {
        const sum = Object.values(parsed.afterSubscores).reduce((a, b) => a + (Number(b) || 0), 0);
        parsed.afterScore = Math.round(sum);
      }

      // Enforce AI pattern density caps on both before and after scores
      const aiRelatedCategories = ['ai-pattern', 'tricolon', 'formulaic', 'parallelism', 'simile', 'pet-phrase'];
      const aiPatternCount = (parsed.issues || []).filter(i =>
        aiRelatedCategories.includes(i.category)
      ).length;

      let cap = Infinity;
      if (aiPatternCount >= 8) cap = 6;
      else if (aiPatternCount >= 5) cap = 7;
      else if (aiPatternCount >= 3) cap = 8;

      if (cap < Infinity) {
        // Cap before scores
        if (parsed.beforeSubscores) {
          if (parsed.beforeSubscores.originalityVoice > cap) parsed.beforeSubscores.originalityVoice = cap;
          if (parsed.beforeSubscores.technicalExecution > cap) parsed.beforeSubscores.technicalExecution = cap;
          parsed.beforeScore = Math.round(Object.values(parsed.beforeSubscores).reduce((a, b) => a + (Number(b) || 0), 0));
        }
        // For after scores, reduce cap by number of AI patterns fixed
        // (If 1 AI pattern was fixed, allow +1 to the cap)
        const fixedAi = aiRelatedCategories.includes(parsed.fixCategory) ? 1 : 0;
        const afterCap = Math.min(10, cap + fixedAi);
        if (parsed.afterSubscores) {
          if (parsed.afterSubscores.originalityVoice > afterCap) parsed.afterSubscores.originalityVoice = afterCap;
          if (parsed.afterSubscores.technicalExecution > afterCap) parsed.afterSubscores.technicalExecution = afterCap;
          parsed.afterScore = Math.round(Object.values(parsed.afterSubscores).reduce((a, b) => a + (Number(b) || 0), 0));
        }
      }

      // Use the beforeScore as the primary score for tracking
      parsed.score = parsed.beforeScore;
      parsed.subscores = parsed.beforeSubscores;
      // Label based on before score
      if (parsed.beforeScore >= 88) parsed.label = 'Exceptional';
      else if (parsed.beforeScore >= 78) parsed.label = 'Strong';
      else if (parsed.beforeScore >= 65) parsed.label = 'Good';
      else if (parsed.beforeScore >= 50) parsed.label = 'Competent';
      else parsed.label = 'Needs Work';

      // CRITICAL: If the model returned a fix but afterScore <= beforeScore,
      // null out the prose — the fix didn't help even by the model's own assessment
      if (parsed.microFixedProse && parsed.afterScore <= parsed.beforeScore) {
        parsed.microFixedProse = null;
        parsed.fixApplied = (parsed.fixApplied || '') + ' [SELF-REJECTED: after-score did not improve]';
      }

      return parsed;
    } catch (e) {
      return {
        beforeScore: 0, afterScore: 0, score: 0, label: 'Parse Error',
        beforeSubscores: {}, afterSubscores: {}, subscores: {},
        issues: [], summary: 'Failed to parse response',
        microFixedProse: null, fixApplied: null, fixCategory: null,
        fixTarget: null, internalValidation: null,
        fourRequirementsFound: {}
      };
    }
  }

  /**
   * Adversarial AI-detection audit.
   * Scores prose on a 0-100 scale for how "human" it reads.
   * Returns { humanScore, dimensions, flaggedPatterns, verdict }
   */
  async runAdversarialAudit(proseText) {
    if (!this.apiKey) throw new Error('No API key set.');

    const adversarialSystemPrompt = `You are a forensic literary analyst hired to determine whether prose was written by a human author or generated by AI. You are skeptical and adversarial. Your job is to find AI signals, not to praise quality.

Score from 0-100 where:
  100 = Certainly written by a human
  75-99 = Probably human, minor concerns
  50-74 = Uncertain, significant AI signals present
  25-49 = Probably AI-generated
  0-24 = Certainly AI-generated

DETECTION DIMENSIONS (check each one):

1. CITATION AUTHENTICITY (0-15 points)
   - Are there vague-but-authoritative attributions? ("according to one account," "records from the period")
   - Are there footnote markers that point to nothing?
   - Are there hyper-specific archival references that feel decorative rather than functional?
   - Deduct 5 points for each fake-seeming citation.

2. FACTUAL PRECISION (0-15 points)
   - Are specific numbers, dates, or statistics plausible?
   - Could the quantitative claims be verified, or do they have the "sounds right but is wrong" quality?
   - Deduct 5 points for each suspicious statistic.

3. PHRASE REPETITION (0-15 points)
   - Does any transitional phrase appear more than once?
   - Are there "bridge sentences" that exist only to pivot between sections?
   - Are paragraph endings formulaic (kicker sentences, epigrams, moral summaries)?
   - Deduct 3 points per repeated pattern.

4. CADENCE UNIFORMITY (0-15 points)
   - Is the prose uniformly polished? (Real writing has rough patches.)
   - Are all paragraphs approximately the same length?
   - Does every paragraph opening function as a "hook"?
   - Is the pacing consistently "cinematic"?
   - Award full points only if paragraph length and sentence complexity genuinely vary.

5. VOICE CONSISTENCY (0-15 points)
   - Does the voice feel like one person writing, or like a committee?
   - Are there shifts in register or diction that suggest multiple agents?
   - Does the prose feel like it was assembled from separately-written parts?

6. STRUCTURAL ORIGINALITY (0-15 points)
   - Are transitions between topics natural and varied, or do they follow a template?
   - Does the prose ever do something unexpected structurally?
   - Is there any moment of genuine authorial personality breaking through?

7. DETAIL AUTHENTICITY (0-10 points)
   - Do sensory details feel observed or generated?
   - Is there a detail that feels like it could only come from someone who was there or read a primary source?
   - Deduct points for decorative details that add atmosphere but no information.

OUTPUT FORMAT (strict — return ONLY this JSON, no other text):
{
  "humanScore": <number 0-100>,
  "dimensions": {
    "citationAuthenticity": <0-15>,
    "factualPrecision": <0-15>,
    "phraseRepetition": <0-15>,
    "cadenceUniformity": <0-15>,
    "voiceConsistency": <0-15>,
    "structuralOriginality": <0-15>,
    "detailAuthenticity": <0-10>
  },
  "flaggedPatterns": [
    "<specific phrase or pattern that triggered a deduction>"
  ],
  "verdict": "<one sentence summary>"
}`;

    // Use a different model than the generator if possible for independence
    const auditModel = this.model === 'claude-sonnet-4-5-20250929'
      ? 'claude-sonnet-4-5-20250929'
      : 'claude-sonnet-4-5-20250929';

    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: auditModel,
        max_tokens: 1000,
        temperature: 0,
        system: adversarialSystemPrompt,
        messages: [{
          role: 'user',
          content: `Analyze this prose for AI detection signals:\n\n${proseText}`
        }]
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      let msg = `Adversarial audit API error (${response.status})`;
      try { msg = JSON.parse(errorBody).error?.message || msg; } catch (_) {}
      console.error(msg);
      return { humanScore: 50, dimensions: {}, flaggedPatterns: ['API error — manual review needed'], verdict: 'Could not run adversarial audit' };
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    try {
      // Strip markdown code fences if present
      const clean = text.replace(/```json\s?|```/g, '').trim();
      const braceStart = clean.indexOf('{');
      const braceEnd = clean.lastIndexOf('}');
      if (braceStart >= 0 && braceEnd > braceStart) {
        return JSON.parse(clean.slice(braceStart, braceEnd + 1));
      }
      return JSON.parse(clean);
    } catch (e) {
      console.error('Adversarial scorer parse error:', e);
      return { humanScore: 50, dimensions: {}, flaggedPatterns: ['Parse error — manual review needed'], verdict: 'Could not parse adversarial score' };
    }
  }

  _buildSystemPrompt({ tone, style, genre, genreRules, voice, errorPatternsPrompt, poetryLevel, heatLevel, authorPalette }) {
    // Poetry level calibration
    const poetryGuidance = {
      1: 'Write clean, invisible prose. Let the story carry itself. Hemingway-level restraint.',
      2: 'Write with modest detail. Grounding sensory touches but nothing ornate.',
      3: 'Write with literary craft. Every sentence shaped with care, metaphors earned.',
      4: 'Write with heightened language. Rich metaphor, musical sentences, every line crafted.',
      5: 'Write with lyrical density. Prose-poetry territory. Unconventional structure allowed.'
    };

    const poetryInstruction = poetryGuidance[poetryLevel || 3];

    let prompt = `You are a world-class fiction author. Your prose has been compared to the best living novelists. You write with precision, authority, and an unmistakable human voice.

=== PROSE DENSITY ===
${poetryInstruction}

=== THE FOUR REQUIREMENTS (MANDATORY) ===
Every 250 words of output MUST contain AT LEAST ONE of these. This is not optional:

1. CHARACTER-SPECIFIC THOUGHT — A line that ONLY this character would think. Not generic human reaction. Test: could any character think this? If yes, it fails.
   EXAMPLE: "Harold had kept a tape measure behind his ear for forty years, as if calamity were something that could be sized up and cut to fit."

2. PRECISE OBSERVATION — So specific it feels like a secret the reader wasn't supposed to know.
   EXAMPLE: "The coffee cup grew mold by the sink, a civilization rising in miniature beside the unwashed spoons."

3. MUSICAL SENTENCE — Rhythm that demands to be read aloud. Deliberate cadence.
   EXAMPLE: "Three seconds. That was how long she believed it."

4. EXPECTATION BREAK — True but unexpected. The obvious emotional beat, subverted.
   EXAMPLE: "She lied to them, and the lying felt good."

=== SENTENCE ARCHITECTURE (MANDATORY) ===
You MUST alternate sentence lengths deliberately:
- At least 20% of sentences must be SHORT (3-8 words). Fragments count.
- At least 15% of sentences must be LONG (20+ words, flowing).
- NEVER write 3+ consecutive sentences of similar length.
- After a complex sentence, land a short one. After rapid-fire short sentences, let one breathe.
- Aim for standard deviation of 8+ in sentence word counts.

Example of GOOD rhythm:
"The house settled around her. Every creak had a name she'd forgotten to teach anyone else, and the forgetting felt like a second kind of loss, quieter than the first but wider. She poured coffee. The mug said World's Best Grandma in letters that were peeling. She wasn't anybody's grandma. Not yet. Maybe not ever, the way things kept not working out."

Example of BAD rhythm (monotonous):
"She walked into the kitchen and looked around. The house was quiet and still. She noticed the coffee pot on the counter. She picked up a mug and poured herself some coffee. She took a sip and looked out the window."

=== AUTHOR PALETTE ===
Channel these voices as you write, not imitating, but channeling their STRENGTHS:
${this._formatAuthorPalette(authorPalette)}

=== HARD CONSTRAINTS (ZERO TOLERANCE) ===
The following are absolute prohibitions. ANY occurrence is a failure:

BANNED WORDS/PHRASES:
- Em dashes (\u2014, \u2013, ---) \u2192 use comma, semicolon, colon, period, or parentheses
- "delicate", "intricate", "testament to", "tapestry", "symphony of"
- "dance of", "nestled", "whispering", "pierced the silence"
- "shattered the silence", "hung in the air", "palpable"
- "found herself/himself" \u2192 use action
- "seemed to" \u2192 commit to the observation
- "began to" / "started to" \u2192 just do the action
- "something" / "somehow" \u2192 be specific
- "for a long moment" \u2192 specific duration or cut
- "In that moment", "Little did she know", "Meanwhile"
- Filter words: felt, noticed, realized, saw, seemed, appeared, watched, thought, knew, wondered

BANNED STRUCTURES:
- Starting more than 1 sentence with "As" or "While" per 500 words
- ABSOLUTELY ZERO tricolons. Never write any list of three items, three adjectives, three parallel clauses, three parallel sentences, or three items joined by 'and'. This is the #1 AI writing pattern. When you need to list things, use EXACTLY TWO items. If you must mention three things, put the third in its own separate sentence with different structure. Check EVERY sentence you write for groups of three before committing it.
  BANNED examples: "salt pork, eggs, bread" (three food items) → use "salt pork and eggs"
  BANNED: "She knew X. She knew Y. She knew Z." (three parallel sentences) → use two, or vary the structure
  BANNED: "its weight, its smoothness, the hollow" (three sensory items) → pick the best two
  BANNED: "draft horses first, then the milk cows, then the hogs" (three sequential items) → "draft horses and milk cows first, then the hogs"
  BANNED: "the cotton sheet and the rough palms and the animal sounds" (three items with 'and') → pick two
- Telling emotions: "She felt sad", "He was angry", "Fear gripped her"
- PET phrases (body-reaction shortcuts): throat tightened, chest tightened, breath caught, heart pounded, eyes widened, jaw clenched, fists clenched, stomach churned, bile rose, pulse quickened, etc.
- Formulaic paragraph structure: observation \u2192 feeling \u2192 action \u2192 reflection
- NEVER end a paragraph with a polished aphorism, thematic summary, or epigrammatic punch line. These are the #2 AI writing pattern. Real literary fiction lets paragraphs end on concrete action or observation, not on a crafted "insight." If your paragraph's last sentence sounds like it could be an Instagram caption or book jacket quote, rewrite it as a plain concrete observation.
  BANNED: "This was not cruelty. It was the only imagination available to him." (negation \u2192 thematic restatement)
  BANNED: "Work made its own argument, and daylight was the only currency that could not be saved." (personified abstraction \u2192 aphorism)
  BANNED: "a distinction that would harden into a fissure" (metaphorical abstraction as closer)
  INSTEAD: End paragraphs with a specific observed detail, an action, or a plain declarative sentence
- NEVER use personified abstractions: don't give agency to abstract nouns. "Work made its own argument" gives 'work' human agency. "The arithmetic of survival" personifies math. "A distinction hardening into a fissure" personifies a concept. Use concrete subjects doing concrete things.
- NEVER use the construction "the way a [metaphor]" \u2014 e.g., "the way a sum could separate the living from the dead" or "the way a man rereads a letter." This is an overwrought simile/epigram structure that AI prose gravitates toward.

INSTEAD OF PET PHRASES:
Show emotion through character-specific action:
- NOT "His hands trembled" \u2192 "He couldn't get the key in the lock"
- NOT "Her heart raced" \u2192 "She counted the ceiling tiles. Twelve. She counted again."
- NOT "His throat tightened" \u2192 "He picked up the photograph, put it down, picked it up again"

=== CRAFT PRINCIPLES ===
- Show, don't tell: concrete action, sensory detail, dialogue convey meaning
- Strong, specific verbs: not "walked" but "shuffled", "strode", "picked his way"
- Eliminate filler: every "very", "really", "just", "quite", "rather" is a failure
- Natural dialogue: each character sounds distinct; use "said" mostly; vary with action beats and no-tag
- Convey interiority through behavior, not narration
- Write ONLY the prose. No meta-commentary, no scene labels, no author notes

=== CRITICAL: AI PATTERN AVOIDANCE ===
The prose you write will be analyzed for AI writing patterns. The following patterns will FAIL the quality gate. Study these BEFORE/AFTER examples:

TRICOLONS (lists of three) — THE #1 AI TELL:
  FAIL: "He could remake himself in American soil, could own what had owned his father, could feed children who would never know hunger"
  PASS: "He could remake himself in American soil. He could feed children who would never know hunger." (two items, separate sentences)
  FAIL: "silently, completely, and with a retention that would surprise even his father"
  PASS: "silently and completely, in a way that would surprise even his father" (two items + clause)
  RULE: ZERO tricolons. Do not write any list of three items, three adjectives, three clauses, or three parallel phrases. This is the single most common AI writing pattern. If you find yourself writing X, Y, and Z — stop. Use two items, or restructure as separate sentences. This is non-negotiable.

  ALSO BANNED — subtle tricolons the model often produces:
  FAIL: "He was [adj], [adj], [adj]." (three adjectives)
  FAIL: "[noun], [noun], and [noun]" in a sensory list (e.g., "manure, hay, and copper")
  FAIL: "She was [X] by [Y], [X] by [Y], and [X] by [Y]" (three parallel phrases)
  FAIL: Three consecutive short sentences about the same subject (acts as a tricolon of sentences)
  PASS: Use two items. Always two. If you need three things, make the third its own sentence.

  TRICOLON EXAMPLES THAT ARE BANNED:
  BAD: "He was red, wailing, unremarkable." (three adjectives)
  GOOD: "He was red and wailing." or "He was red. He was wailing. He was unremarkable." (separate sentences)
  BAD: "About the blood. About the heat. About the sky." (three parallel fragments)
  GOOD: "About the blood. About the flat white sky." (two items only)
  BAD: "its weight, its smoothness, the hollow" (three sensory items)
  GOOD: "its smoothness, the hollow where the thread had been" (two items)
  BAD: "Cleared timber. Dug ditches. Set fence posts." (three parallel action sentences)
  GOOD: "He had cleared the timber and dug the drainage ditches. The fence posts he set himself." (vary structure)

PERSONIFIED ABSTRACTIONS — THE #2 AI TELL:
  FAIL: "where language had weight and color" (language cannot have weight)
  PASS: "where the children went quiet and listened" (observable behavior)
  FAIL: "silence settled between them" (silence cannot settle)
  PASS: "Neither of them spoke." (plain, direct)
  FAIL: "grief singed at the edges" (grief cannot singe)
  PASS: "The newspaper was weeks old, creased where someone had gripped it too hard" (physical detail implying emotion)
  RULE: Non-physical things (silence, grief, language, knowledge, patience) must NEVER be given physical verbs.

FORMULAIC PARAGRAPH ENDINGS:
  FAIL: "William Ford had no time for arguments. He had eighty acres." (punchy one-liner paragraph for dramatic effect)
  FAIL: "They named him Henry." (dramatic kicker sentence as its own paragraph)
  PASS: Fold these into the preceding paragraph. Let the prose breathe without demanding attention.
  RULE: No more than ONE standalone short-sentence paragraph per 500 words.

RHETORICAL PARALLELISM:
  FAIL: "William would answer with practicality... Mary would answer with..." (parallel structure as crutch)
  PASS: Vary the construction. Let one character's response be shown, the other implied.
  RULE: Never use "X would... Y would..." as a structural device.

EXPLANATORY NARRATOR:
  FAIL: "He drew them because they were what he saw when he looked at the world" (over-explains motivation)
  PASS: "He drew them." (trust the reader to infer why from context)
  RULE: If the scene has already SHOWN something, do not EXPLAIN it in the next sentence.

=== HARD CONSTRAINTS (will cause automatic failure) ===
- ZERO em dashes (\u2014, \u2013, ---). Use commas, semicolons, colons, periods, or parentheses
- ZERO PET phrases: throat tightened, chest constricted, breath caught, heart pounded, stomach churned, eyes widened, jaw clenched, fists clenched, bile rose, pulse quickened, hands trembled, voice wavered
- ZERO filter words: felt, noticed, seemed, realized, watched, wondered
- ZERO tricolons. Do not write any list of three items, three adjectives, three clauses, or three parallel phrases. If you find yourself writing X, Y, and Z — stop. Use two items, or restructure as separate sentences. This is non-negotiable
- Maximum 1 standalone dramatic-kicker paragraph per 500 words
- No "X would... Y would..." parallel constructions
- No sentences explaining what a scene has already shown

=== ANTI-AI-DETECTION RULES (MANDATORY — violations cause immediate rejection) ===

1. NEVER FABRICATE CITATIONS OR SOURCES.
   - Do NOT invent archival references (box numbers, accession numbers, folder numbers).
   - Do NOT create fake footnote markers like [1], [2], [3].
   - Do NOT use phrases like "according to documents in Acc. 65, Box 15" unless the user has provided that exact source in the knowledge base.
   - If you want to attribute a fact, state it plainly without attribution: "The assembly line reduced production time dramatically" — NOT "According to Ford Archives records, the assembly line reduced production time dramatically."
   - RULE: Real citations or no citations. NEVER fake citations.

2. NEVER INVENT SPECIFIC NUMBERS, DATES, OR STATISTICS.
   - Do NOT generate precise production figures, dollar amounts, percentages, or quantities unless the user has provided them in the story prompt or knowledge base.
   - WRONG: "Between October and December of 1923, the Ford Motor Company assembled 1,695,295 Model T automobiles."
   - RIGHT: "By late 1923, Model T production had reached volumes no other manufacturer could match."
   - If a specific number is essential for the narrative, flag it with [VERIFY: number] so the user can confirm or replace it.
   - Approximate language is always safer than fabricated precision.

3. VARY YOUR SENTENCE AND PARAGRAPH STRUCTURE.
   - Do NOT use the same transitional phrase more than once in the entire output. If you write "The situation was more complicated than that" in one paragraph, you may NEVER use that phrase again.
   - Do NOT end paragraphs with aphoristic "kicker" sentences that summarize a moral lesson. Examples of BANNED kicker patterns:
     * "It was the [noun] that [verb] [object]." (e.g., "It was the silence that told the story.")
     * "[Abstract noun] made its own argument."
     * "The [noun] would not [verb] forever."
     * "That was the [noun] of it."
     * Personified abstractions acting as sentence subjects at paragraph endings.
   - Vary paragraph length deliberately: include at least one paragraph under 3 sentences AND one paragraph over 6 sentences per chapter.
   - Include at least one sentence fragment or incomplete thought per chapter (real writers do this).
   - Occasionally let a paragraph end without resolution, mid-thought, trailing off into the next paragraph.

4. AVOID "PERFORMED SCHOLARSHIP" PATTERNS.
   - Do NOT write "according to one machinist's later account" or "dealer correspondence from the period" or "as a foreman recalled years later" unless the user's source material contains that specific account.
   - Do NOT use the construction "In a [document type] preserved in [archive name]..."
   - Do NOT pepper prose with dates in the format "On [Month] [Day], [Year]" more than twice per chapter. Use vaguer temporal references: "that winter," "weeks later," "by the time the leaves turned."
   - Do NOT use the pattern of naming an archival source, describing its physical form (onionskin paper, typewritten memo, handwritten ledger), and then quoting from it. This is the #1 AI detection signal for historical nonfiction.

5. EMBRACE IMPERFECTION.
   - Real prose has moments where the writer's opinion shows through slightly.
   - Real prose sometimes uses an unusual word choice that isn't the "optimal" one.
   - Real prose occasionally has a sentence that does too much work, cramming two ideas together with a comma splice or an overlong dependent clause.
   - Do NOT produce uniformly polished, cinematically paced prose. Let some sentences be merely functional.
   - Do NOT make every paragraph opening a "hook." Some paragraphs should start plainly.

6. UNIQUE PHRASING DEDUPLICATION.
   - Before finalizing output, scan for any phrase of 4+ words that appears more than once. If found, rewrite one instance.
   - Scan for any "bridge sentence" pattern (a sentence that exists solely to transition between topics without adding information). Limit to 2 per chapter maximum. Examples: "But the story did not end there." "What happened next would change everything." "The truth was more complicated."

=== END ANTI-AI-DETECTION RULES ===`;

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

  /**
   * Format the author palette for inclusion in system prompts.
   * Handles both structured palette objects (new AI-selected) and legacy strings.
   */
  _formatAuthorPalette(authorPalette) {
    const defaultPalette = '- Morrison: elemental weight\n- Tyler: domestic warmth\n- Russo: working-class dignity\n- Saunders: absurdist heart\n- Strout: plainspoken power';

    if (!authorPalette) return defaultPalette;

    // Structured palette object from the new AI selection system
    if (typeof authorPalette === 'object' && authorPalette.authors && authorPalette.authors.length > 0) {
      return authorPalette.authors.map(a =>
        `- ${a.name} (${a.label}): ${a.role}`
      ).join('\n');
    }

    // Legacy string palette
    if (typeof authorPalette === 'string' && authorPalette.trim()) {
      return authorPalette;
    }

    return defaultPalette;
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
      // Separate knowledge base from regular notes for clearer AI consumption
      const knowledgeStart = notes.indexOf('=== PROJECT KNOWLEDGE BASE');
      if (knowledgeStart >= 0) {
        const regularNotes = notes.slice(0, knowledgeStart).trim();
        const knowledgeSection = notes.slice(knowledgeStart);
        if (regularNotes) {
          prompt += `\nAdditional context/notes:\n${regularNotes}\n`;
        }
        prompt += `\n${knowledgeSection}\n`;
      } else {
        prompt += `\nAdditional context/notes:\n${notes}\n`;
      }
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

    // Inject score context so the rewriter knows what dimensions need the most help
    if (previousScore != null && previousSubscores) {
      const subScoreLabels = {
        sentenceVariety: { label: 'Sentence Variety & Rhythm', max: 15 },
        dialogueAuthenticity: { label: 'Dialogue Authenticity', max: 15 },
        sensoryDetail: { label: 'Sensory Detail / Show vs Tell', max: 15 },
        emotionalResonance: { label: 'Emotional Resonance & Depth', max: 15 },
        vocabularyPrecision: { label: 'Vocabulary Precision', max: 10 },
        narrativeFlow: { label: 'Narrative Flow & Pacing', max: 10 },
        originalityVoice: { label: 'Originality & Voice', max: 10 },
        technicalExecution: { label: 'Technical Execution', max: 10 }
      };

      // Find the weakest dimensions (sorted by how far below maximum)
      const dims = Object.entries(subScoreLabels).map(([key, info]) => {
        const val = previousSubscores[key] ?? 0;
        const pct = Math.round((val / info.max) * 100);
        return { key, label: info.label, val, max: info.max, pct, gap: info.max - val };
      }).sort((a, b) => b.gap - a.gap);

      const weakest = dims.filter(d => d.pct < 80).slice(0, 3);

      systemPrompt += `

=== SCORE CONTEXT (use this to prioritize fixes) ===
Current score: ${previousScore}/100. Target: 90+. Gap: ${Math.max(0, 90 - previousScore)} points needed.
${rewriteIteration ? `Rewrite iteration: ${rewriteIteration}` : ''}

Sub-score breakdown (weakest first):
${dims.map(d => `  ${d.label}: ${d.val}/${d.max} (${d.pct}%)`).join('\n')}

${weakest.length > 0 ? `PRIORITY DIMENSIONS (biggest opportunities for improvement):
${weakest.map(d => `  - ${d.label}: ${d.val}/${d.max} — ${d.gap} points recoverable`).join('\n')}

Focus your fixes on these weak dimensions FIRST. A fix that improves a weak dimension by 2+ points is more valuable than a fix that marginally improves an already-strong dimension.` : 'All dimensions are reasonably strong. Focus on the listed issues.'}
=== END SCORE CONTEXT ===`;
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
   * AI self-reflection: Analyze prose and generate a detailed fix list.
   * Asks the AI "How can I improve this prose? What surgical fixes or rewrites
   * are needed to get closer to the threshold?"
   * Returns a structured fix list that can be applied in the next rewrite.
   */
  /** @deprecated Use scoreAndImprove() instead. Kept for backward compatibility. */
  async reflectOnProse({ prose, score, subscores, threshold, issues, aiPatterns, iterationNum, previousFixLists, degradationAnalysis, validationFeedback }) {
    if (!this.apiKey) {
      throw new Error('No API key set.');
    }

    let systemPrompt = `You are an expert literary editor performing a deep self-reflection analysis. You just scored a piece of prose and now must deeply analyze HOW to improve it. Think step by step about what's holding the score back and create a precise, actionable fix list.

Your analysis should consider:
1. What specific weaknesses are dragging the score down the most?
2. For each weakness, what is the EXACT surgical fix needed? Prefer the SMALLEST possible change.
3. Will each proposed fix genuinely improve the prose, or just change it?
4. Are there any fixes that could be applied together for compounding improvement?
5. Could this fix introduce NEW problems (broken rhythm, lost voice, new clichés)?

CRITICAL — SURGICAL, MINIMUM-CHANGE APPROACH:
- Prefer word-level and phrase-level substitutions over full sentence rewrites
- Full sentence rewrites often INTRODUCE more errors than they fix
- Full paragraph rewrites are FORBIDDEN unless explicitly necessary
- The goal is to PRESERVE what works while fixing ONLY what's broken
- Each fix should change the MINIMUM number of words needed to resolve the issue
- Example of GOOD surgical fix: Replace "very tired" → "exhausted" (one word swap)
- Example of BAD fix: Rewrite the entire paragraph to fix one weak word

RULES:
- Be specific — reference exact phrases from the prose
- Each fix must include the problematic text AND the proposed replacement approach
- Prioritize fixes by estimated point impact (highest first)
- Never suggest introducing: em dashes, filter words (felt/saw/noticed/seemed/realized), AI-telltale words (delicate/intricate/testament/tapestry/symphony/nestled), PET phrases, tricolons
- Focus on fixes that will MEASURABLY improve the score toward the threshold
- CRITICAL FIX COUNT LIMITS based on gap size:
  * Gap of 1-2 points: MAX 2 fixes (fewer fixes = less regression risk)
  * Gap of 3-5 points: MAX 4 fixes
  * Gap of 6+ points: MAX 8 fixes
- More fixes increases the risk of regression — be conservative
- Ask yourself for EACH fix: "Is this fix clearly better, or just different?" Only include fixes that are CLEARLY better`;

    // Dynamically set max fixes based on gap
    const maxFixes = (threshold - score) <= 2 ? 2 : (threshold - score) <= 5 ? 4 : 8;
    systemPrompt += `\n\nFor this specific case (gap: ${threshold - score} pts), limit to ${maxFixes} fixes maximum.`;

    if (previousFixLists && previousFixLists.length > 0) {
      const scoreGap = threshold - score;
      systemPrompt += `\n\nIMPORTANT: Previous fix lists have already been attempted but the score has not reached the threshold.
Previous approaches that did NOT work sufficiently:
${previousFixLists.map((fl, i) => `Attempt ${i + 1}: ${fl.summary || fl.fixes?.map(f => f.description).join('; ')}`).join('\n')}

${scoreGap <= 3 ? `CRITICAL — NEAR-THRESHOLD STRATEGY (only ${scoreGap} pts needed):
The score is VERY close to threshold. Previous bold approaches FAILED because they disrupted the prose's existing strengths.
YOU MUST:
- Make FEWER fixes, not more (1-3 maximum)
- Target ONLY the single weakest sub-score dimension
- Each fix must be a precise word or phrase swap — do NOT rewrite sentences
- If a "fix" might disrupt voice, rhythm, or existing strengths, DO NOT make it
- Ask yourself: "Is this change clearly and unambiguously better, or just different?"
- "Different" is NOT "better" — only propose a fix if the improvement is obvious
- Preserve everything that earned the current high score` : `You MUST take a DIFFERENT approach this time. Do not repeat the same types of fixes. Consider:
- Targeting DIFFERENT sub-score dimensions than previous attempts
- Fewer, more targeted fixes rather than many broad changes
- Focus on the lowest-scoring dimension specifically
- Each fix must be clearly better, not just different`}`;
    }

    if (degradationAnalysis) {
      systemPrompt += `\n\nCRITICAL — PREVIOUS FIX ATTEMPT CAUSED SCORE TO DROP:
The last set of fixes made the prose WORSE. Here is the analysis of what went wrong:

Root cause: ${degradationAnalysis.rootCause || 'Unknown'}
Analysis: ${degradationAnalysis.analysis || 'Not available'}
${degradationAnalysis.harmfulChanges?.length > 0 ? `\nFixes that HURT the prose:\n${degradationAnalysis.harmfulChanges.map(h => `- ${h.fix}: ${h.problem}\n  Recommendation: ${h.recommendation}`).join('\n')}` : ''}
${degradationAnalysis.preserveQualities?.length > 0 ? `\nQualities that MUST be preserved:\n${degradationAnalysis.preserveQualities.map(q => `- ${q}`).join('\n')}` : ''}
${degradationAnalysis.betterApproach ? `\nRecommended approach: ${degradationAnalysis.betterApproach}` : ''}

YOU MUST:
- Avoid repeating the mistakes identified above
- Follow the recommended better approach
- Be MORE surgical and conservative — only fix what is clearly broken
- Preserve the specific strengths and qualities listed above
- Each fix must have a clear, evidence-based reason why it will IMPROVE (not just change) the prose`;
    }

    if (validationFeedback) {
      systemPrompt += `\n\nPRE-VALIDATION REJECTED PREVIOUS FIX LIST:
A previous fix list was pre-validated and predicted to ${validationFeedback.overallAssessment || 'not improve the score'}.
Predicted score: ${validationFeedback.predictedScore || 'unknown'} (needs to exceed current score)
${validationFeedback.riskyFixes?.length > 0 ? `Risky fixes to AVOID or rethink: ${validationFeedback.riskyFixes.map(i => `Fix #${i + 1}`).join(', ')}` : ''}
${validationFeedback.suggestedModifications ? `Suggested modifications: ${validationFeedback.suggestedModifications}` : ''}
${validationFeedback.fixAssessments ? `\nPer-fix assessment:\n${validationFeedback.fixAssessments.filter(a => !a.willHelp).map(a => `- Fix #${a.fixIndex}: ${a.risks} → ${a.recommendation}`).join('\n')}` : ''}

Create a REFINED fix list that addresses these concerns. Focus on fixes that the pre-validation predicts will actually help.`;
    }

    let userPrompt = `=== PROSE TO ANALYZE ===
${prose}
=== END PROSE ===

Current Score: ${score}/100
Target Threshold: ${threshold}/100
Gap: ${threshold - score} points needed

Sub-scores:
${subscores ? Object.entries(subscores).map(([k, v]) => `  ${k}: ${v}`).join('\n') : 'Not available'}

${issues && issues.length > 0 ? `Known Issues:\n${issues.map((iss, i) => `  ${i + 1}. [${iss.severity}] ${iss.problem || iss.description}${iss.text ? ` — "${iss.text}"` : ''}`).join('\n')}` : ''}
${aiPatterns && aiPatterns.length > 0 ? `\nAI Patterns Detected:\n${aiPatterns.map(p => `  - ${p.pattern}: "${p.examples?.[0] || ''}"`).join('\n')}` : ''}

Reflect deeply on this prose. Ask yourself:
1. "How can I improve the prose I just scored? What is holding the score back the most?"
2. "What fixes — either surgical word/phrase replacements or broader sentence rewrites — are necessary to improve the score closer to ${threshold}?"
3. "How would I implement each fix on this specific prose? What exact changes would I make?"

Create a fix list based on this analysis. Output valid JSON only:
{
  "reflection": "2-3 sentence analysis of what's holding the score back",
  "summary": "One sentence describing the overall fix strategy",
  "fixes": [
    {
      "target": "exact text from the prose to fix (or 'GENERAL' for broad improvements)",
      "description": "what's wrong and why it hurts the score",
      "approach": "surgical|rewrite",
      "replacement_guidance": "specific guidance on what the replacement should look like",
      "estimated_impact": number (1-5 points)
    }
  ],
  "expected_score_after": number
}`;

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
        max_tokens: 2048,
        messages: [{ role: 'user', content: userPrompt }],
        system: systemPrompt
      })
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

    const result = await response.json();
    const rawText = result.content?.[0]?.text || '';

    // Parse JSON from response (handle markdown code blocks)
    let jsonStr = rawText;
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();
    // Also handle bare JSON
    const braceStart = jsonStr.indexOf('{');
    const braceEnd = jsonStr.lastIndexOf('}');
    if (braceStart >= 0 && braceEnd > braceStart) {
      jsonStr = jsonStr.slice(braceStart, braceEnd + 1);
    }

    try {
      return JSON.parse(jsonStr);
    } catch (err) {
      throw new Error('Failed to parse reflection response: ' + err.message);
    }
  }

  /**
   * Apply a fix list from reflectOnProse to the prose via a targeted rewrite.
   * The fix list guides the rewrite with specific, pre-analyzed improvements.
   */
  /** @deprecated Use scoreAndImprove() instead. Kept for backward compatibility. */
  async applyFixList({ originalProse, fixList, chapterTitle, characters, notes, chapterOutline, aiInstructions, tone, style, wordTarget, maxTokens, genre, genreRules, voice, errorPatternsPrompt, iterationNum, threshold }, { onChunk, onDone, onError }) {
    if (!this.apiKey) {
      onError(new Error('No API key set.'));
      return;
    }

    this.abortController = new AbortController();

    let systemPrompt = `You are a senior literary editor implementing a pre-analyzed fix list. You have already reflected on this prose and identified specific improvements. Now implement them with SURGICAL PRECISION.

=== YOUR APPROACH ===
1. Read the original prose and the fix list carefully
2. For each fix, change ONLY the specific words or phrases identified — do NOT rewrite surrounding text
3. Copy all unchanged text VERBATIM — character for character, including punctuation and whitespace
4. Surgical means: if the fix targets a two-word phrase, only change those two words
5. After all fixes, verify the result reads naturally without introducing new problems

=== CRITICAL: MINIMUM CHANGE PRINCIPLE ===
- Change the ABSOLUTE MINIMUM number of words needed for each fix
- Do NOT "improve" surrounding text while making a fix — that introduces new errors
- Do NOT restructure sentences unless the fix list explicitly calls for it
- Do NOT change paragraph breaks, sentence order, or narrative structure
- If a fix says to replace a phrase, replace ONLY that phrase
- Rewrites of full sentences or paragraphs often induce MORE errors than they fix

=== RULES ===
- PRESERVE: voice, tense, POV, paragraph structure, approximate length, sentence count
- OUTPUT: Only the rewritten prose. No commentary, labels, or meta-text
- NEVER introduce: em dashes, filter words (felt/saw/noticed/seemed/realized), AI-telltale words (delicate/intricate/testament/tapestry/symphony/nestled), tricolons, purple prose, PET phrases
- Each fix must result in measurably better prose, not just different prose`;

    if (genre) systemPrompt += `\nGenre context: ${genre}`;
    if (voice && voice !== 'auto') {
      const voiceNames = {
        'first-person': 'first person', 'third-limited': 'third-person limited',
        'third-omniscient': 'third-person omniscient', 'deep-pov': 'deep POV',
        'multiple-pov': 'multiple POV'
      };
      systemPrompt += `\nNarrative voice: ${voiceNames[voice] || voice} (preserve this exactly)`;
    }
    if (errorPatternsPrompt) systemPrompt += errorPatternsPrompt;

    let userPrompt = '';
    if (aiInstructions) userPrompt += `=== AUTHOR INSTRUCTIONS ===\n${aiInstructions}\n\n`;

    userPrompt += `=== ORIGINAL PROSE ===\n${originalProse}\n=== END ORIGINAL PROSE ===\n`;

    userPrompt += `\n=== FIX LIST (Iteration ${iterationNum}) — Implement ALL fixes below ===\n`;
    userPrompt += `Strategy: ${fixList.summary || fixList.reflection || ''}\n\n`;

    if (fixList.fixes && fixList.fixes.length > 0) {
      fixList.fixes.forEach((fix, i) => {
        userPrompt += `FIX ${i + 1}: `;
        if (fix.target && fix.target !== 'GENERAL') {
          userPrompt += `TARGET: "${fix.target}" — `;
        }
        userPrompt += `${fix.description}\n`;
        userPrompt += `  APPROACH: ${fix.approach || 'surgical'}\n`;
        userPrompt += `  GUIDANCE: ${fix.replacement_guidance}\n`;
        userPrompt += `  EXPECTED IMPACT: ~${fix.estimated_impact || 1} pts\n\n`;
      });
    }

    userPrompt += `\nImplement ALL ${fixList.fixes?.length || 0} fixes above. Target score: ${threshold}/100. Output ONLY the improved prose.`;

    if (characters && characters.length > 0) {
      userPrompt += '\nCharacters for context: ';
      userPrompt += characters.map(c => `${c.name} (${c.role})`).join(', ');
      userPrompt += '\n';
    }

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
   * Compare two prose versions to understand WHY a rewrite scored lower than the original.
   * Performs detailed analysis of which fixes helped vs. hurt and why.
   * Returns structured guidance for creating better fixes.
   */
  /** @deprecated No longer used in the 3-phase pipeline. Kept for backward compatibility. */
  async compareProseVersions({ bestProse, bestScore, bestSubscores, rewrittenProse, rewrittenScore, rewrittenSubscores, appliedFixes }) {
    if (!this.apiKey) {
      throw new Error('No API key set.');
    }

    const systemPrompt = `You are an expert literary editor analyzing why a prose rewrite scored LOWER than the original. Two versions exist: the original (higher-scoring) and the rewrite (lower-scoring). The rewrite attempted to improve the prose by applying specific fixes, but instead degraded it.

Your task: Perform a detailed comparative analysis to understand EXACTLY why the fixes caused a score decrease. This analysis will guide the next round of improvements.

ANALYSIS REQUIREMENTS:
- Be specific about which changes helped vs. hurt
- Identify if fixes introduced new problems (e.g., broke rhythm, added generic language, lost distinctive voice, over-smoothed raw power)
- Explain the root cause — why did "improvements" make things worse?
- Note any qualities in the original that were inadvertently destroyed
- Provide actionable guidance for what a better fix approach would look like

COMMON PITFALLS TO CHECK:
- Did fixes sand down distinctive rough edges that gave the prose character?
- Did vocabulary changes make the prose more generic rather than more precise?
- Did sentence restructuring break a deliberate rhythm pattern?
- Did adding detail dilute a powerful sparse style?
- Did "fixing" dialogue make it sound less authentic/more writerly?`;

    const fixSummary = appliedFixes?.fixes?.map((f, i) =>
      `Fix ${i + 1}: ${f.description} (approach: ${f.approach}, target: "${(f.target || 'GENERAL').slice(0, 80)}")`
    ).join('\n') || 'No fix details available';

    const subscoreComparison = bestSubscores && rewrittenSubscores ?
      Object.keys(bestSubscores).map(k => {
        const diff = (rewrittenSubscores[k] || 0) - (bestSubscores[k] || 0);
        return `  ${k}: ${bestSubscores[k]} → ${rewrittenSubscores[k]} (${diff >= 0 ? '+' : ''}${diff})`;
      }).join('\n') : 'Not available';

    const userPrompt = `=== ORIGINAL VERSION (Score: ${bestScore}) ===
${bestProse}
=== END ORIGINAL ===

=== REWRITTEN VERSION (Score: ${rewrittenScore}) ===
${rewrittenProse}
=== END REWRITTEN ===

=== FIXES THAT WERE APPLIED ===
${fixSummary}
=== END FIXES ===

=== SUB-SCORE CHANGES ===
${subscoreComparison}
=== END SUB-SCORES ===

Score dropped from ${bestScore} to ${rewrittenScore} (${bestScore - rewrittenScore} point decrease).

Analyze:
1. Which specific fixes HELPED (improved their target area)?
2. Which specific fixes HURT (degraded quality, broke rhythm, lost voice, introduced problems)?
3. What is the ROOT CAUSE of the overall score decline?
4. Which qualities of the ORIGINAL version were lost and must be preserved?
5. What would a BETTER approach look like for the next attempt?

Output valid JSON only:
{
  "analysis": "2-3 sentence summary of why the score dropped",
  "rootCause": "The primary reason fixes degraded the prose",
  "helpfulChanges": ["list of changes that worked well"],
  "harmfulChanges": [
    {
      "fix": "which fix caused harm",
      "problem": "what went wrong",
      "recommendation": "what should be done instead"
    }
  ],
  "preserveQualities": ["specific qualities from the original that MUST be preserved in any future fix"],
  "subscoreAnalysis": {
    "improved": ["dimensions that improved and why"],
    "declined": ["dimensions that declined and why"]
  },
  "betterApproach": "Specific guidance for the next fix attempt that avoids these pitfalls"
}`;

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
        max_tokens: 2048,
        temperature: 0,
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
    const rawText = result.content?.[0]?.text || '';

    let jsonStr = rawText;
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();
    const braceStart = jsonStr.indexOf('{');
    const braceEnd = jsonStr.lastIndexOf('}');
    if (braceStart >= 0 && braceEnd > braceStart) {
      jsonStr = jsonStr.slice(braceStart, braceEnd + 1);
    }

    try {
      return JSON.parse(jsonStr);
    } catch (err) {
      throw new Error('Failed to parse comparison response: ' + err.message);
    }
  }

  /**
   * Pre-validate proposed fixes by having AI predict the scoring outcome
   * BEFORE actually applying the fixes. This prevents wasting an iteration
   * on fixes that are predicted to decrease the score.
   * Returns predicted score, confidence level, and per-fix assessments.
   */
  /** @deprecated Use scoreAndImprove() instead. Kept for backward compatibility. */
  async preValidateFixes({ prose, fixList, currentScore, subscores, threshold }) {
    if (!this.apiKey) {
      throw new Error('No API key set.');
    }

    const systemPrompt = `You are a senior literary editor performing a pre-implementation scoring review. Your job is to MENTALLY APPLY each proposed fix to the prose, then SCORE the result as if the fixes were already implemented.

This is a critical gate: if your predicted score is not an improvement, the fixes will NOT be applied. Be honest and rigorous.

EVALUATION PROCESS:
1. Read the original prose carefully
2. For each fix, mentally envision how the prose would read after the change
3. Consider ripple effects — how does each fix affect rhythm, voice, flow, and coherence?
4. Score the mentally-rewritten version using the same 8-dimension rubric:
   - Sentence Variety & Rhythm (0-15)
   - Dialogue Authenticity (0-15)
   - Sensory Detail / Show vs Tell (0-15)
   - Emotional Resonance & Depth (0-15)
   - Vocabulary Precision (0-10)
   - Narrative Flow & Pacing (0-10)
   - Originality & Voice (0-10)
   - Technical Execution (0-10)
5. Sum the predicted subscores for the total predicted score
6. Assess each fix individually — will it help or hurt?

CRITICAL RULES:
- Be conservative in predictions — if a fix seems risky, predict cautiously
- Flag fixes that might damage dimensions they don't target
- Consider whether fixes work well TOGETHER or create conflicts
- A fix that "improves" one dimension while degrading two others is a net negative`;

    const fixDetails = fixList.fixes?.map((f, i) =>
      `Fix ${i + 1}: TARGET="${(f.target || 'GENERAL').slice(0, 100)}" | ${f.description} | APPROACH: ${f.approach} | GUIDANCE: ${f.replacement_guidance} | EST. IMPACT: ${f.estimated_impact}pts`
    ).join('\n') || '';

    const userPrompt = `=== CURRENT PROSE (Score: ${currentScore}/${threshold}) ===
${prose}
=== END PROSE ===

=== CURRENT SUB-SCORES ===
${subscores ? Object.entries(subscores).map(([k, v]) => `  ${k}: ${v}`).join('\n') : 'Not available'}

=== PROPOSED FIXES ===
${fixDetails}
Overall strategy: ${fixList.summary || fixList.reflection || 'Not specified'}
AI's expected score after fixes: ${fixList.expected_score_after || 'Not specified'}
=== END FIXES ===

Mentally apply ALL fixes to the prose. Then score the result as if the fixes were implemented.

For each fix, assess:
1. Will it genuinely improve its target dimension?
2. Could it damage OTHER dimensions (collateral damage)?
3. Is the estimated impact realistic?

Then predict subscores and total score for the mentally-rewritten version.

Output valid JSON only:
{
  "predictedScore": number,
  "predictedSubscores": {
    "sentenceVariety": number,
    "dialogueAuthenticity": number,
    "sensoryDetail": number,
    "emotionalResonance": number,
    "vocabularyPrecision": number,
    "narrativeFlow": number,
    "originalityVoice": number,
    "technicalExecution": number
  },
  "confidence": "high|medium|low",
  "overallAssessment": "1-2 sentence prediction of outcome",
  "fixAssessments": [
    {
      "fixIndex": number,
      "willHelp": boolean,
      "predictedImpact": number,
      "risks": "description of risks or 'none'",
      "recommendation": "proceed|modify|skip"
    }
  ],
  "riskyFixes": [number],
  "suggestedModifications": "If fixes need changes, describe what should be different to achieve a better outcome"
}`;

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
        max_tokens: 2048,
        temperature: 0,
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
    const rawText = result.content?.[0]?.text || '';

    let jsonStr = rawText;
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();
    const braceStart = jsonStr.indexOf('{');
    const braceEnd = jsonStr.lastIndexOf('}');
    if (braceStart >= 0 && braceEnd > braceStart) {
      jsonStr = jsonStr.slice(braceStart, braceEnd + 1);
    }

    try {
      const parsed = JSON.parse(jsonStr);
      // Validate predicted score = sum of predicted subscores
      if (parsed.predictedSubscores) {
        const sum = Object.values(parsed.predictedSubscores).reduce((a, b) => a + (Number(b) || 0), 0);
        parsed.predictedScore = Math.round(sum);
      }
      return parsed;
    } catch (err) {
      throw new Error('Failed to parse pre-validation response: ' + err.message);
    }
  }

  /** Generate an image prompt for a book cover using Claude. */
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
    await loadPuterSDK();
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
   * Convert an Image element to a base64 data URL via canvas with a timeout.
   * Handles broken images and tainted canvas scenarios.
   */
  _imgElementToDataUrl(img, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Image conversion timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const tryConvert = () => {
        try {
          if (img.naturalWidth === 0 || img.naturalHeight === 0) {
            clearTimeout(timer);
            reject(new Error('Image has zero dimensions — broken or not loaded'));
            return;
          }
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          clearTimeout(timer);
          resolve(dataUrl);
        } catch (err) {
          clearTimeout(timer);
          reject(err); // Catches SecurityError from tainted canvas
        }
      };

      if (img.complete && img.naturalWidth > 0) {
        tryConvert();
      } else if (img.complete && img.naturalWidth === 0) {
        clearTimeout(timer);
        reject(new Error('Image already complete but has zero width — broken'));
      } else {
        img.onload = tryConvert;
        img.onerror = () => {
          clearTimeout(timer);
          reject(new Error('Image failed to load'));
        };
      }
    });
  }

  /**
   * Convert a Puter.js txt2img result to a safe data: URL.
   * Puter returns either an HTMLImageElement, a Blob, or a base64 string.
   * If it's an HTMLImageElement from a cross-origin CDN, we can't use
   * canvas.toDataURL() — it will throw SecurityError.
   *
   * Solution: Use puter.net.fetch() which is a CORS-free proxy, fetch
   * the image URL as a blob, then convert to data: URL via FileReader.
   */
  async _puterResultToDataUrl(result) {
    // Case 1: Already a base64 data URL string
    if (typeof result === 'string' && result.startsWith('data:')) {
      return result;
    }

    // Case 2: Base64 string without data: prefix
    if (typeof result === 'string' && !result.startsWith('http')) {
      return `data:image/png;base64,${result}`;
    }

    // Case 3: Blob — convert directly
    if (result instanceof Blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('FileReader failed'));
        reader.readAsDataURL(result);
      });
    }

    // Case 4: HTMLImageElement from CDN — CANNOT use canvas (tainted)
    // Use Puter's CORS-free proxy to re-fetch as blob
    if (result instanceof HTMLImageElement || (result && result.src)) {
      const imageUrl = result.src || result;

      try {
        // puter.net.fetch() bypasses CORS restrictions
        const response = await puter.net.fetch(imageUrl);
        const blob = await response.blob();

        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('FileReader failed on re-fetched blob'));
          reader.readAsDataURL(blob);
        });
      } catch (proxyErr) {
        console.error('[Illustration] puter.net.fetch proxy failed:', proxyErr);

        // Last resort: try canvas anyway (will fail if cross-origin, but
        // might work if same-origin in some environments)
        return this._imgElementToDataUrl(result, 10000);
      }
    }

    // Case 5: Object with .base64 property (some Puter API responses)
    if (result && result.base64) {
      return `data:image/png;base64,${result.base64}`;
    }

    // Case 6: Object with .url property
    if (result && result.url) {
      return this._puterResultToDataUrl(result.url); // Recurse with the URL string
    }

    throw new Error(`Unknown Puter result type: ${typeof result}`);
  }

  /**
   * Map requested dimensions to the nearest valid DALL-E 3 size string.
   * DALL-E 3 ONLY accepts: "1024x1024", "1024x1792", "1792x1024"
   */
  static _getDalle3Size(requestedWidth, requestedHeight) {
    const ratio = requestedWidth / requestedHeight;
    if (ratio > 1.3) {
      return '1792x1024'; // Landscape
    } else if (ratio < 0.77) {
      return '1024x1792'; // Portrait
    } else {
      return '1024x1024'; // Square-ish
    }
  }

  /**
   * Map requested dimensions to the nearest valid GPT Image 1 size string.
   * GPT Image 1 supports: "1024x1024", "1024x1536", "1536x1024"
   */
  static _getGptImageSize(requestedWidth, requestedHeight) {
    const ratio = requestedWidth / requestedHeight;
    if (ratio > 1.3) {
      return '1536x1024'; // Landscape
    } else if (ratio < 0.77) {
      return '1024x1536'; // Portrait
    } else {
      return '1024x1024'; // Square
    }
  }

  /**
   * Generate a cover image using Hugging Face via Puter.js CORS-free fetch.
   * puter.net.fetch() proxies requests through Puter's servers, bypassing CORS.
   * Returns a base64 data URL.
   */
  async generateCoverViaHF(prompt, hfToken) {
    if (!hfToken) throw new Error('No Hugging Face token set.');
    await loadPuterSDK();
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

  // ═══════════════════════════════════════════════════════════
  // ILLUSTRATION GENERATION — extends existing cover pipeline
  // ═══════════════════════════════════════════════════════════

  /**
   * Get style prefix string for illustration prompts based on style and color mode.
   */
  getStylePrefix(style, colorMode) {
    const stylePrefixes = {
      'photorealistic': 'Photorealistic photograph,',
      'documentary': 'Documentary-style photograph,',
      'portrait': 'Portrait photograph,',
      'cinematic': 'Cinematic film still,',
      'watercolor': 'Watercolor painting,',
      'oil_painting': 'Oil painting,',
      'pencil_sketch': 'Pencil sketch drawing,',
      'charcoal': 'Charcoal drawing,',
      'ink_wash': 'Ink wash painting, sumi-e style,',
      'pastel': 'Pastel drawing,',
      'gouache': 'Gouache painting,',
      'woodcut': 'Woodcut print,',
      'engraving': 'Engraving etching,',
      'digital_painting': 'Digital painting,',
      'concept_art': 'Concept art,',
      'comic_book': 'Comic book illustration, graphic novel style,',
      'manga': 'Manga style illustration,',
      'pixel_art': 'Pixel art,',
      'vector': 'Vector flat illustration,',
      'storybook': 'Classic storybook illustration, warm and inviting,',
      'whimsical': 'Whimsical fantasy illustration,',
      'cartoon': 'Cartoon illustration,',
      'cutout': 'Paper cutout collage,',
      'crayon': 'Crayon drawing, child-like style,',
      'vintage_photo': 'Vintage photograph,',
      'daguerreotype': 'Daguerreotype photograph,',
      'sepia_style': 'Sepia toned photograph,',
      'art_deco': 'Art Deco style illustration,',
      'art_nouveau': 'Art Nouveau style illustration,',
      'impressionist': 'Impressionist painting,',
      'architectural': 'Architectural rendering,',
      'technical': 'Technical illustration,',
      'botanical': 'Botanical illustration,',
      'map': 'Cartographic map illustration,',
    };

    const colorPrefixes = {
      'full_color': '',
      'black_white': ' black and white,',
      'grayscale': ' grayscale,',
      'sepia': ' sepia toned,',
      'duotone': ' duotone,',
      'limited_palette': ' limited color palette,',
    };

    return (stylePrefixes[style] || '') + (colorPrefixes[colorMode] || '');
  }

  /**
   * Get negative prompt for illustration based on style and color mode.
   */
  getIllustrationNegativePrompt(style, colorMode) {
    const base = 'text, words, letters, typography, watermark, blurry, low quality';

    const styleAdditions = {
      'photorealistic': ', cartoon, anime, illustration, painting, drawing',
      'documentary': ', color, modern elements, digital artifacts, clean surfaces',
      'watercolor': ', photographic, 3D render, digital, sharp edges',
      'cartoon': ', photorealistic, photograph, dark, gritty',
      'pencil_sketch': ', color, photographic, digital painting',
      'vintage_photo': ', color, modern elements, digital, clean, sharp',
      'oil_painting': ', photograph, digital, 3D render, flat',
      'storybook': ', dark, scary, violent, realistic, photograph',
    };

    const colorAdditions = {
      'black_white': ', color, colored, vibrant, saturated',
      'sepia': ', vibrant color, blue, green, modern',
      'grayscale': ', color, colored, vibrant',
    };

    return base
      + (styleAdditions[style] || '')
      + (colorAdditions[colorMode] || '');
  }

  /**
   * Extract illustration scenes from chapter prose using Claude.
   * Mirrors generateCoverPrompt() pattern.
   */
  async extractScenesFromProse(chapterProse, illustrationCount, config) {
    if (!this.apiKey) throw new Error('No API key set.');

    const systemPrompt = `You are a visual scene analyst for book illustration. Given a chapter of prose and a target illustration count, identify the most visually compelling scenes.

SELECTION CRITERIA:
- Strong visual imagery already present in the prose
- Emotional peaks or turning points
- Scenes with clear physical action or vivid setting
- Moments that translate well to a still image
- Variety across the chapter (spread them out, don't cluster)

AVOID:
- Internal monologue with no visual anchor
- Dialogue-heavy scenes unless setting is vivid
- Abstract or philosophical passages

For each scene, extract:
- paragraphIndex: Which paragraph (0-indexed)
- insertAfter: Where the image goes (paragraph index)
- characters: Which characters are visible
- setting: Physical location and time of day
- action: What is physically happening
- mood: Emotional tone (for lighting/color guidance)
- lighting: Time of day and light quality
- keyObjects: Significant visible objects
- compositionHint: Suggested framing (close-up, wide shot, etc.)
- sourceText: The exact prose passage that inspired this (max 200 words)

OUTPUT: Valid JSON array of scene objects, one per requested illustration.
No commentary, no explanation — just the JSON.`;

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
        max_tokens: 2000,
        temperature: 0.3,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: `Extract ${illustrationCount} illustration scenes from this chapter:\n\n${chapterProse.slice(0, 12000)}`
        }]
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      let msg = `API error (${response.status})`;
      try { msg = JSON.parse(errorBody).error?.message || msg; } catch (_) {}
      throw new Error(msg);
    }

    const result = await response.json();
    const text = result.content?.[0]?.text?.trim() || '[]';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    try {
      return JSON.parse(jsonMatch ? jsonMatch[0] : text);
    } catch (e) {
      console.warn('Scene extraction parse error:', e);
      return [];
    }
  }

  /**
   * Generate an illustration prompt from scene data using Claude.
   * Mirrors generateCoverPrompt() at line 2318.
   */
  async generateIllustrationPrompt(scene, config) {
    if (!this.apiKey) throw new Error('No API key set.');

    const characterContext = Object.entries(config.characterDescriptions || {})
      .filter(([name]) => (scene.characters || []).some(c =>
        c.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(c.toLowerCase())
      ))
      .map(([name, desc]) => `Character "${name}": ${desc}`)
      .join('\n');

    const settingContext = config.settingDescriptions
      ? Object.entries(config.settingDescriptions)
          .filter(([name]) => (scene.setting || '').toLowerCase().includes(name.toLowerCase()))
          .map(([name, desc]) => `Setting "${name}": ${desc}`)
          .join('\n')
      : '';

    const stylePrefix = this.getStylePrefix(config.illustrationStyle || config.globalStyle, config.colorMode || config.globalColorMode);
    const globalStyle = config.globalStylePrompt || '';
    const referenceGuidance = scene.referenceAnalysis || '';
    const styleLock = config.styleLock?.styleDescription || '';

    const systemPrompt = `You are an expert art director translating written prose into AI image generation prompts.

TRANSLATION RULES:
- Convert metaphors to literal visual elements ("his iron will" = stern expression, rigid posture)
- Convert emotions to visual cues ("she felt lost" = looking down, surrounded by empty space)
- Convert sound to visual atmosphere ("the factory roared" = steam, sparks, scale, motion)
- Add concrete period-appropriate details the prose implies
- Include the STYLE, GLOBAL STYLE, REFERENCE GUIDANCE, and STYLE LOCK directives in the prompt verbatim
- Include CHARACTER descriptions verbatim for any characters present
- Include SETTING descriptions verbatim for the scene's location

KEY CONSTRAINT: Produce NO text, NO typography, NO lettering in the prompt. Only visual imagery.

AVOID:
- Names of real living people (use physical descriptions)
- Copyrighted character likenesses
- Requests for specific named artist styles (describe the technique)

OUTPUT FORMAT (JSON only, no commentary):
{
  "prompt": "Full image generation prompt, 150-300 words",
  "altText": "Accessibility description, 1-2 sentences",
  "caption": "Optional caption, or null",
  "compositionNotes": "Brief framing note for user reference"
}`;

    const userContent = `STYLE: ${stylePrefix}
GLOBAL STYLE: ${globalStyle}
REFERENCE GUIDANCE: ${referenceGuidance}
STYLE LOCK: ${styleLock}
${characterContext}
${settingContext}

SOURCE PROSE:
${(scene.sourceText || '').slice(0, 3000)}

SCENE DATA:
${JSON.stringify({
  characters: scene.characters,
  setting: scene.setting,
  action: scene.action,
  mood: scene.mood,
  lighting: scene.lighting,
  keyObjects: scene.keyObjects,
  compositionHint: scene.compositionHint
}, null, 2)}

Generate an image prompt for this scene.`;

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
        max_tokens: 1000,
        temperature: 0.4,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }]
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      let msg = `API error (${response.status})`;
      try { msg = JSON.parse(errorBody).error?.message || msg; } catch (_) {}
      throw new Error(msg);
    }

    const result = await response.json();
    const text = result.content?.[0]?.text?.trim() || '{}';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    try {
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
      return {
        prompt: parsed.prompt || '',
        negativePrompt: this.getIllustrationNegativePrompt(
          config.illustrationStyle || config.globalStyle,
          config.colorMode || config.globalColorMode
        ),
        altText: parsed.altText || '',
        caption: parsed.caption || null,
        compositionNotes: parsed.compositionNotes || '',
      };
    } catch (e) {
      console.warn('Illustration prompt parse error:', e);
      return {
        prompt: text,
        negativePrompt: this.getIllustrationNegativePrompt(
          config.illustrationStyle || config.globalStyle,
          config.colorMode || config.globalColorMode
        ),
        altText: '',
        caption: null,
        compositionNotes: '',
      };
    }
  }

  /**
   * Generate all illustration prompts in parallel batches.
   */
  async generateAllIllustrationPrompts(illustrations, config, onProgress) {
    const PROMPT_WORKERS = 5;
    const results = [];

    for (let i = 0; i < illustrations.length; i += PROMPT_WORKERS) {
      const batch = illustrations.slice(i, i + PROMPT_WORKERS);

      const settledResults = await Promise.allSettled(
        batch.map(ill => this.generateIllustrationPrompt(ill.scene, config))
      );

      for (let idx = 0; idx < settledResults.length; idx++) {
        const result = settledResults[idx];
        if (result.status === 'fulfilled') {
          results.push({
            ...batch[idx],
            ...result.value,
            state: 'prompt_ready',
          });
        } else {
          console.error(`[Illustration] Prompt generation failed for scene ${i + idx}:`, result.reason);
          results.push({
            ...batch[idx],
            prompt: null,
            negativePrompt: '',
            altText: '',
            state: 'prompt_failed',
            error: result.reason?.message || 'Prompt generation failed',
          });
        }
      }

      if (onProgress) onProgress(results.length, illustrations.length);

      if (i + PROMPT_WORKERS < illustrations.length) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    // Filter out failed prompts and warn
    const valid = results.filter(r => r.prompt !== null && r.prompt !== '');
    const failedCount = results.length - valid.length;
    if (failedCount > 0) {
      console.warn(`[Illustration] ${failedCount} prompt(s) failed — proceeding with ${valid.length} valid prompts`);
    }

    return valid;
  }

  /**
   * Analyze a reference image for style guidance using Claude vision.
   */
  async analyzeReferenceImage(imageUrl, config) {
    if (!this.apiKey) throw new Error('No API key set.');

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
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'url', url: imageUrl } },
            { type: 'text', text: 'Analyze this image\'s visual style for use as a reference in AI image generation. Extract ONLY: composition approach, color palette, lighting style, mood/atmosphere, texture quality. Output as comma-separated descriptive phrases. Do NOT describe the subject matter — only the artistic/technical style.' }
          ]
        }]
      })
    });

    if (!response.ok) throw new Error('Reference analysis failed');
    const data = await response.json();
    return data.content?.[0]?.text?.trim() || '';
  }

  /**
   * Lock style from an approved illustration image.
   */
  async lockStyleFromImage(imageDataUrl) {
    if (!this.apiKey) throw new Error('No API key set.');

    // Convert data URL to base64 for Claude vision
    const base64Match = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!base64Match) throw new Error('Invalid image data URL');

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
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: base64Match[1],
                data: base64Match[2]
              }
            },
            { type: 'text', text: 'Analyze this illustration\'s visual style comprehensively. Output a style description that can be injected into future image generation prompts to maintain consistency. Include: art medium, color palette, lighting approach, texture, line quality, composition style, mood, level of detail. Output as a single paragraph of descriptive phrases.' }
          ]
        }]
      })
    });

    if (!response.ok) throw new Error('Style lock analysis failed');
    const data = await response.json();
    return {
      enabled: true,
      styleDescription: data.content?.[0]?.text?.trim() || '',
      lockedAt: new Date().toISOString(),
    };
  }

  /**
   * Generate an illustration image via HuggingFace (reuses existing cover HF code).
   */
  async generateIllustrationHF(prompt, negativePrompt, model, dimensions) {
    const hfToken = await this.storage?.getSetting?.('hfToken');
    if (!hfToken) throw new Error('No HuggingFace token set.');
    await loadPuterSDK();
    if (typeof puter === 'undefined' || !puter.net?.fetch) {
      throw new Error('Puter.js net.fetch not available');
    }

    const url = `https://api-inference.huggingface.co/models/${model}`;
    let response = await puter.net.fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${hfToken}`,
        'Content-Type': 'application/json',
        'x-wait-for-model': 'true'
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: {
          negative_prompt: negativePrompt,
          width: dimensions.w,
          height: dimensions.h,
          num_inference_steps: 30,
          guidance_scale: 7.5,
        }
      })
    });

    // Handle cold start
    let retries = 0;
    while (response.status === 503 && retries < 2) {
      let wait = 30000;
      try {
        const body = await response.json();
        wait = Math.min((body.estimated_time || 30) * 1000, 45000);
      } catch (_) {}
      await new Promise(r => setTimeout(r, wait));
      response = await puter.net.fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${hfToken}`,
          'Content-Type': 'application/json',
          'x-wait-for-model': 'true'
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: {
            negative_prompt: negativePrompt,
            width: dimensions.w,
            height: dimensions.h,
          }
        })
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
      reader.onloadend = () => resolve({
        imageData: reader.result,
        model: model,
        provider: 'huggingface',
        dimensions: dimensions,
      });
      reader.onerror = () => reject(new Error('Failed to read image data'));
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Generate an illustration image via Puter.js (reuses existing cover Puter code).
   */
  async generateIllustrationPuter(prompt, model, dimensions) {
    await loadPuterSDK();
    if (typeof puter === 'undefined' || !puter.ai) {
      throw new Error('Puter.js not loaded');
    }

    const opts = { model: model };

    if (model === 'dall-e-3') {
      // DALL-E 3 requires a size string, not width/height integers
      opts.size = ProseGenerator._getDalle3Size(dimensions.w, dimensions.h);
    } else if (model === 'gpt-image-1') {
      // GPT Image 1 also requires a size string
      opts.size = ProseGenerator._getGptImageSize(dimensions.w, dimensions.h);
    } else {
      opts.width = dimensions.w;
      opts.height = dimensions.h;
      opts.steps = 25;
      opts.negative_prompt = 'text, words, letters, typography, watermark, blurry, low quality';
    }

    console.log(`[Illustration] Generating via ${model} (Puter), opts:`, JSON.stringify(opts));

    const result = await puter.ai.txt2img(prompt, opts);
    // Use the safe CORS-free conversion instead of canvas-based conversion
    const imageData = await this._puterResultToDataUrl(result);

    return {
      imageData: imageData,
      model: model,
      provider: 'puter',
      dimensions: dimensions,
    };
  }

  /**
   * Generate illustration using GPT Image 1 via Puter.js.
   * This is a FREE provider — no API key needed.
   * Supports sizes: "1024x1024", "1024x1536", "1536x1024"
   */
  async generateIllustrationGptImage1(prompt, dimensions) {
    await loadPuterSDK();
    if (typeof puter === 'undefined' || !puter.ai) {
      throw new Error('Puter.js not loaded');
    }

    const size = ProseGenerator._getGptImageSize(dimensions.w, dimensions.h);

    console.log(`[Illustration] Generating via GPT Image 1 (Puter), size: ${size}`);

    const result = await puter.ai.txt2img(prompt, {
      model: 'gpt-image-1',
      size: size,
    });

    // Use the safe conversion (handles cross-origin, blobs, etc.)
    const imageData = await this._puterResultToDataUrl(result);

    return {
      imageData: imageData,
      model: 'gpt-image-1',
      provider: 'puter',
      dimensions: dimensions,
    };
  }

  /**
   * Calculate pixel dimensions from size option for illustration generation.
   */
  getIllustrationDimensions(sizeOption) {
    const aspectRatios = {
      'inline_small': { w: 1024, h: 1024 },
      'inline_medium': { w: 1024, h: 1024 },
      'inline_full': { w: 1024, h: 768 },
      'full_page': { w: 768, h: 1152 },
      'full_bleed': { w: 768, h: 1152 },
      'half_page': { w: 1024, h: 512 },
      'quarter_page': { w: 512, h: 512 },
      'chapter_header': { w: 1024, h: 384 },
      'vignette': { w: 512, h: 512 },
    };
    return aspectRatios[sizeOption] || { w: 1024, h: 1024 };
  }

  /**
   * Calculate final print dimensions from size, DPI, and trim size.
   */
  calculateFinalDimensions(sizeOption, dpi, trimSize) {
    trimSize = trimSize || { width: 6, height: 9 };
    const dims = {
      'inline_small':   { w: 3 * dpi, h: Math.round(2 * dpi) },
      'inline_medium':  { w: Math.round(4.5 * dpi), h: Math.round(3 * dpi) },
      'inline_full':    { w: Math.round((trimSize.width - 1.5) * dpi), h: Math.round(3 * dpi) },
      'full_page':      { w: Math.round(trimSize.width * dpi), h: Math.round(trimSize.height * dpi) },
      'full_bleed':     { w: Math.round((trimSize.width + 0.25) * dpi), h: Math.round((trimSize.height + 0.25) * dpi) },
      'half_page':      { w: Math.round((trimSize.width - 1.5) * dpi), h: Math.round(3.75 * dpi) },
      'quarter_page':   { w: Math.round(2.25 * dpi), h: Math.round(2.25 * dpi) },
      'chapter_header': { w: Math.round((trimSize.width - 1.5) * dpi), h: Math.round(1.5 * dpi) },
      'vignette':       { w: Math.round(1.5 * dpi), h: Math.round(1.5 * dpi) },
    };
    return dims[sizeOption] || { w: Math.round(trimSize.width * dpi), h: Math.round(trimSize.height * dpi) };
  }

  /**
   * Upscale an image using canvas with high-quality interpolation.
   */
  async upscaleImage(imageDataUrl, targetWidth, targetHeight) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

        // Apply mild sharpening
        this._applyUnsharpMask(ctx, targetWidth, targetHeight, 0.3);

        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('Image load failed for upscaling'));
      img.src = imageDataUrl;
    });
  }

  /**
   * Apply unsharp mask for post-upscale sharpening.
   */
  _applyUnsharpMask(ctx, width, height, amount) {
    try {
      const imageData = ctx.getImageData(0, 0, width, height);
      const data = imageData.data;
      const copy = new Uint8ClampedArray(data);

      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          for (let c = 0; c < 3; c++) {
            const idx = (y * width + x) * 4 + c;
            const blur =
              (copy[((y - 1) * width + x) * 4 + c] +
               copy[((y + 1) * width + x) * 4 + c] +
               copy[(y * width + x - 1) * 4 + c] +
               copy[(y * width + x + 1) * 4 + c]) / 4;
            const sharp = copy[idx] + (copy[idx] - blur) * amount;
            data[idx] = Math.max(0, Math.min(255, Math.round(sharp)));
          }
        }
      }

      ctx.putImageData(imageData, 0, 0);
    } catch (e) {
      // Canvas may be tainted — skip sharpening
      console.warn('Unsharp mask skipped:', e.message);
    }
  }

  /**
   * Apply historical period filter to a canvas.
   */
  applyHistoricalFilter(canvas, period) {
    const filters = {
      'pre-1860':  { sepia: 0.9, grain: 0.3, vignette: 0.4, contrast: 1.2 },
      '1860-1900': { sepia: 0.6, grain: 0.2, vignette: 0.3, contrast: 1.1 },
      '1900-1940': { grayscale: 1.0, grain: 0.15, vignette: 0.2, contrast: 1.15 },
      '1940-1970': { grayscale: 1.0, grain: 0.08, vignette: 0.1, contrast: 1.05 },
      '1970-2000': { grain: 0.05, warmth: 0.1 },
      'post-2000': {},
    };

    const filter = filters[period];
    if (!filter) return;

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    try {
      const imageData = ctx.getImageData(0, 0, w, h);
      const data = imageData.data;

      for (let i = 0; i < data.length; i += 4) {
        let r = data[i], g = data[i + 1], b = data[i + 2];

        // Grayscale
        if (filter.grayscale) {
          const gray = 0.299 * r + 0.587 * g + 0.114 * b;
          r = r + (gray - r) * filter.grayscale;
          g = g + (gray - g) * filter.grayscale;
          b = b + (gray - b) * filter.grayscale;
        }

        // Sepia
        if (filter.sepia) {
          const gray = 0.299 * r + 0.587 * g + 0.114 * b;
          const sr = gray * 1.2, sg = gray * 1.0, sb = gray * 0.8;
          r = r + (sr - r) * filter.sepia;
          g = g + (sg - g) * filter.sepia;
          b = b + (sb - b) * filter.sepia;
        }

        // Contrast
        if (filter.contrast && filter.contrast !== 1) {
          r = ((r / 255 - 0.5) * filter.contrast + 0.5) * 255;
          g = ((g / 255 - 0.5) * filter.contrast + 0.5) * 255;
          b = ((b / 255 - 0.5) * filter.contrast + 0.5) * 255;
        }

        // Warmth
        if (filter.warmth) {
          r += filter.warmth * 20;
          b -= filter.warmth * 10;
        }

        // Film grain
        if (filter.grain) {
          const noise = (Math.random() - 0.5) * filter.grain * 128;
          r += noise;
          g += noise;
          b += noise;
        }

        data[i] = Math.max(0, Math.min(255, r));
        data[i + 1] = Math.max(0, Math.min(255, g));
        data[i + 2] = Math.max(0, Math.min(255, b));
      }

      ctx.putImageData(imageData, 0, 0);

      // Vignette
      if (filter.vignette) {
        const gradient = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
        gradient.addColorStop(0, 'rgba(0,0,0,0)');
        gradient.addColorStop(1, `rgba(0,0,0,${filter.vignette})`);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, w, h);
      }
    } catch (e) {
      console.warn('Historical filter failed:', e.message);
    }
  }

  /**
   * Generate a character reference sheet for children's book mode.
   */
  async generateCharacterSheet(characterDesc, config) {
    const prompt = `Character reference sheet, multiple poses and expressions, ${characterDesc}, front view, side view, three-quarter view, happy expression, sad expression, surprised expression, white background, clean separation between poses, ${this.getStylePrefix(config.illustrationStyle || config.globalStyle, config.globalColorMode || 'full_color')}, consistent proportions throughout`;

    const negativePrompt = this.getIllustrationNegativePrompt(config.illustrationStyle || config.globalStyle, 'full_color');
    const dimensions = { w: 1024, h: 1024 };

    // Try to generate via available providers
    try {
      return await this.generateIllustrationPuter(prompt, 'stabilityai/stable-diffusion-3-medium', dimensions);
    } catch (e) {
      try {
        return await this.generateIllustrationHF(prompt, negativePrompt, 'black-forest-labs/FLUX.1-schnell', dimensions);
      } catch (e2) {
        throw new Error('Character sheet generation failed: ' + e2.message);
      }
    }
  }

  // ========================================
  //  Prose CI/CD — Intent Ledger & Patching
  // ========================================

  /**
   * Generate an Intent Ledger for a prose passage — a locked set of constraints
   * that must NOT change during iterative refinement.
   * Returns { ledger: string[], povCharacter, emotionalArc, sensoryAnchors, canonFacts }
   */
  async generateIntentLedger({ plot, chapterOutline, characters, existingProse, chapterTitle }) {
    if (!this.apiKey) throw new Error('No API key set.');

    const systemPrompt = `You are a continuity editor. Given a story passage and its context, extract a concise Intent Ledger: the non-negotiable elements that must be preserved during any revision.

Output valid JSON only:
{
  "povCharacter": "name or null if unclear",
  "povType": "first-person|third-limited|third-omniscient|other",
  "emotionalArc": "start emotion → end emotion",
  "sceneChange": "what changes in the scene (decision, revelation, bond, etc.)",
  "sensoryAnchors": ["3-5 key sensory details that must remain"],
  "canonFacts": ["3-5 factual claims that must not change"],
  "tense": "past|present",
  "ledger": ["5-10 bullet-point constraints for revision"]
}`;

    let userPrompt = '';
    if (chapterTitle) userPrompt += `Chapter: ${chapterTitle}\n`;
    if (chapterOutline) userPrompt += `Outline: ${chapterOutline}\n`;
    if (plot) userPrompt += `Plot: ${plot}\n`;
    if (characters && characters.length > 0) {
      userPrompt += `Characters: ${characters.map(c => `${c.name} (${c.role})`).join(', ')}\n`;
    }
    userPrompt += `\nProse to analyze:\n"""${(existingProse || '').slice(0, 6000)}"""\n`;
    userPrompt += `\nExtract the Intent Ledger. Be specific and concrete.`;

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
        temperature: 0,
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

    let jsonStr = text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonStr = jsonMatch[0];

    try {
      return JSON.parse(jsonStr);
    } catch (e) {
      return {
        povCharacter: null, povType: 'unknown', emotionalArc: 'unknown',
        sceneChange: 'unknown', sensoryAnchors: [], canonFacts: [],
        tense: 'past', ledger: ['Preserve overall meaning and plot progression']
      };
    }
  }

  /**
   * Identify the single dominant craft constraint to focus on this iteration.
   * Returns { dimension, description, targetImprovement }
   */
  identifyDominantConstraint(review, lintResult) {
    if (!review || !review.subscores) return null;

    // Priority 1: If there are hard lint defects, focus on those
    if (lintResult && lintResult.defects) {
      const hardDefects = lintResult.defects.filter(d => d.severity === 'hard');
      if (hardDefects.length > 0) {
        // Group by type to find most common
        const typeGroups = {};
        for (const d of hardDefects) {
          typeGroups[d.type] = (typeGroups[d.type] || 0) + 1;
        }
        const topType = Object.entries(typeGroups).sort((a, b) => b[1] - a[1])[0];
        return {
          dimension: 'hard-defects',
          defectType: topType[0],
          count: topType[1],
          description: `Fix ${topType[1]} ${topType[0].replace(/-/g, ' ')} defects`,
          targetImprovement: Math.min(topType[1] * 2, 10)
        };
      }
    }

    // Priority 2: Find weakest scoring dimension
    const dimLabels = {
      sentenceVariety: { label: 'Sentence Variety & Rhythm', max: 15 },
      dialogueAuthenticity: { label: 'Dialogue Authenticity', max: 15 },
      sensoryDetail: { label: 'Sensory Detail / Show vs Tell', max: 15 },
      emotionalResonance: { label: 'Emotional Resonance', max: 15 },
      vocabularyPrecision: { label: 'Vocabulary Precision', max: 10 },
      narrativeFlow: { label: 'Narrative Flow & Pacing', max: 10 },
      originalityVoice: { label: 'Originality & Voice', max: 10 },
      technicalExecution: { label: 'Technical Execution', max: 10 }
    };

    let worstDim = null;
    let worstGap = 0;
    for (const [dim, val] of Object.entries(review.subscores)) {
      const info = dimLabels[dim];
      if (!info) continue;
      const gap = info.max - val;
      // Weight gap by the dimension's max to find proportionally weakest
      const proportionalGap = gap / info.max;
      if (proportionalGap > worstGap) {
        worstGap = proportionalGap;
        worstDim = { dimension: dim, label: info.label, max: info.max, current: val, gap };
      }
    }

    if (!worstDim) return null;

    return {
      dimension: worstDim.dimension,
      description: `Improve ${worstDim.label} from ${worstDim.current}/${worstDim.max}`,
      currentScore: worstDim.current,
      maxScore: worstDim.max,
      targetImprovement: Math.max(2, Math.ceil(worstDim.gap * 0.5))
    };
  }

  /**
   * Generate targeted patches for a specific defect class or craft dimension.
   * Returns patches via streaming (same interface as rewriteProse).
   * Uses the intent ledger to prevent regressions.
   */
  async patchProse({ originalProse, focus, intentLedger, voiceFingerprint, lintDefects, review, chapterTitle, characters, notes, chapterOutline, aiInstructions, tone, style, wordTarget, maxTokens, genre, genreRules, voice, errorPatternsPrompt }, { onChunk, onDone, onError }) {
    if (!this.apiKey) {
      onError(new Error('No API key set.'));
      return;
    }

    this.abortController = new AbortController();

    // Build a tightly-focused patch prompt
    let systemPrompt = `You are a precision prose editor. You make MINIMAL, TARGETED changes to fix ONE specific weakness while preserving everything else.

=== PATCHING RULES ===
1. You are fixing ONE thing: ${focus.description}
2. Change ONLY sentences that directly relate to this one weakness
3. Copy ALL other text VERBATIM — character for character
4. Your output must be the COMPLETE passage with patches applied
5. Each patch must be the smallest possible change that fixes the issue
6. NEVER introduce: em dashes, PET phrases, AI-telltale words, filter words
7. Maintain the same approximate word count (within 10%)`;

    // Add intent ledger constraints
    if (intentLedger) {
      systemPrompt += `\n\n=== INTENT LEDGER (NON-NEGOTIABLE — any violation means patch is rejected) ===`;
      if (intentLedger.povType) systemPrompt += `\nPOV: ${intentLedger.povType}`;
      if (intentLedger.tense) systemPrompt += `\nTense: ${intentLedger.tense}`;
      if (intentLedger.emotionalArc) systemPrompt += `\nEmotional arc: ${intentLedger.emotionalArc}`;
      if (intentLedger.canonFacts && intentLedger.canonFacts.length > 0) {
        systemPrompt += `\nCanon facts that must remain:`;
        intentLedger.canonFacts.forEach(f => { systemPrompt += `\n- ${f}`; });
      }
      if (intentLedger.sensoryAnchors && intentLedger.sensoryAnchors.length > 0) {
        systemPrompt += `\nSensory anchors that must remain:`;
        intentLedger.sensoryAnchors.forEach(a => { systemPrompt += `\n- ${a}`; });
      }
      if (intentLedger.ledger && intentLedger.ledger.length > 0) {
        systemPrompt += `\nAdditional constraints:`;
        intentLedger.ledger.forEach(l => { systemPrompt += `\n- ${l}`; });
      }
    }

    // Add voice fingerprint target
    if (voiceFingerprint) {
      systemPrompt += `\n\n=== VOICE FINGERPRINT TARGET (must stay within 15% of these values) ===`;
      systemPrompt += `\nSentence length mean: ${voiceFingerprint.sentenceLengthMean} words`;
      systemPrompt += `\nSentence length std dev: ${voiceFingerprint.sentenceLengthStdDev}`;
      systemPrompt += `\nShort sentences (<=8 words): ${voiceFingerprint.shortPct}%`;
      systemPrompt += `\nLong sentences (>=20 words): ${voiceFingerprint.longPct}%`;
      systemPrompt += `\nDialogue ratio: ${Math.round(voiceFingerprint.dialogueRatio * 100)}%`;
    }

    // Add genre/voice context
    if (genre) systemPrompt += `\nGenre: ${genre}`;
    if (voice && voice !== 'auto') {
      const voiceNames = {
        'first-person': 'first person', 'third-limited': 'third-person limited',
        'third-omniscient': 'third-person omniscient', 'deep-pov': 'deep POV'
      };
      systemPrompt += `\nNarrative voice: ${voiceNames[voice] || voice}`;
    }

    if (errorPatternsPrompt) {
      systemPrompt += errorPatternsPrompt;
    }

    // Build focused user prompt
    let userPrompt = '';
    if (aiInstructions) {
      userPrompt += `=== AUTHOR INSTRUCTIONS ===\n${aiInstructions}\n\n`;
    }

    userPrompt += `=== ORIGINAL PROSE ===\n${originalProse}\n=== END ORIGINAL PROSE ===\n`;

    userPrompt += `\n=== FOCUS: ${focus.description} ===\n`;

    // Add specific defects to fix if targeting hard defects
    if (focus.dimension === 'hard-defects' && lintDefects && lintDefects.length > 0) {
      const relevantDefects = lintDefects
        .filter(d => d.severity === 'hard' && d.type === focus.defectType)
        .slice(0, 15);
      userPrompt += `Fix these specific defects:\n`;
      relevantDefects.forEach((d, i) => {
        userPrompt += `${i + 1}. ${d.suggestion} [text: "${d.text}"]\n`;
      });
    } else if (focus.dimension !== 'hard-defects') {
      // Craft dimension improvement
      const craftInstructions = {
        sentenceVariety: 'Find 4+ consecutive sentences with similar word counts. Break the pattern: split long ones into short punchy fragments, combine short ones into flowing compound sentences. Target: mix of 3-8 word and 15-30 word sentences.',
        dialogueAuthenticity: 'Make each character sound distinctly different. Vary tags: "said" 60%, action beats 30%, no tag 10%. Add an interruption, trailing thought, or mid-sentence correction.',
        sensoryDetail: 'Replace 3+ abstract descriptions with concrete sensory details. Name specific colors, textures, smells, sounds. Change abstractions to camera-capturable details.',
        emotionalResonance: 'Replace stated emotions with character-specific actions that IMPLY the emotion. Find 2+ places to add behavioral details revealing inner state without naming it.',
        vocabularyPrecision: 'Replace 5+ generic verbs with precise ones (walked→shuffled, said→muttered). Delete every instance of: very, really, quite, just, rather, somewhat.',
        narrativeFlow: 'Vary paragraph lengths. Add one single-sentence paragraph for emphasis. Cut unnecessary transition words.',
        originalityVoice: 'Replace 3+ template-sounding phrases with genuinely novel alternatives. If any metaphor is cliche, delete or replace with something a reader has never seen.',
        technicalExecution: 'Fix grammar issues. Ensure purposeful paragraph breaks. Verify tense consistency throughout.'
      };
      userPrompt += (craftInstructions[focus.dimension] || 'Improve this dimension throughout the passage.') + '\n';

      if (review && review.issues) {
        const relevantIssues = review.issues
          .filter(i => {
            const catMap = {
              sentenceVariety: 'structure', dialogueAuthenticity: 'dialogue',
              sensoryDetail: 'telling', emotionalResonance: ['telling', 'pet-phrase'],
              vocabularyPrecision: 'weak-words', narrativeFlow: 'pacing',
              originalityVoice: ['cliche', 'ai-pattern'], technicalExecution: 'other'
            };
            const cats = catMap[focus.dimension];
            if (Array.isArray(cats)) return cats.includes(i.category);
            return i.category === cats;
          })
          .slice(0, 8);
        if (relevantIssues.length > 0) {
          userPrompt += `\nSpecific issues from scoring:\n`;
          relevantIssues.forEach((iss, i) => {
            userPrompt += `${i + 1}. ${iss.text ? `"${iss.text}" → ` : ''}${iss.problem}\n`;
          });
        }
      }
    }

    userPrompt += `\nApply ONLY the patches needed for the focus above. Copy everything else VERBATIM. Output ONLY the patched prose.`;

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
        try { msg = JSON.parse(errorBody).error?.message || msg; } catch (_) {}
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

// ═══════════════════════════════════════════════════════════
// PARALLEL ILLUSTRATION QUEUE
// Manages concurrent image generation across multiple providers
// ═══════════════════════════════════════════════════════════

class IllustrationQueue {
  constructor(generator, providerConfig) {
    this.generator = generator;
    this.paused = false;
    this.cancelled = false;

    this.pools = (providerConfig || [])
      .filter(p => p.enabled)
      .map(p => ({
        ...p,
        active: 0,
        totalGenerated: 0,
        totalFailed: 0,
      }));

    this._illustrationErrors = [];
    this._providerStats = {};
    this.pools.forEach(pool => {
      this._providerStats[pool.name] = { success: 0, failed: 0, retries: 0 };
    });

    this.onProgress = null;
    this.onImageReady = null;
    this.onError = null;
    this.onWorkerUpdate = null;
  }

  _recordError(job, pool, error) {
    const errorEntry = {
      illustrationId: job.illustrationId || 'unknown',
      provider: pool ? pool.name : 'unknown',
      error: error.message || String(error),
      timestamp: new Date().toISOString(),
      retryCount: job.retryCount || 0,
    };
    this._illustrationErrors.push(errorEntry);
    if (pool && this._providerStats[pool.name]) {
      this._providerStats[pool.name].failed++;
    }
    console.error(`[Illustration] Error on ${errorEntry.provider}: ${errorEntry.error}`);
  }

  _recordSuccess(job, pool) {
    if (pool && this._providerStats[pool.name]) {
      this._providerStats[pool.name].success++;
    }
  }

  getErrorSummary() {
    return {
      totalErrors: this._illustrationErrors.length,
      errors: this._illustrationErrors,
      providerStats: this._providerStats,
      failedIllustrations: this._illustrationErrors
        .filter(e => e.retryCount >= 2)
        .map(e => `${e.illustrationId}: ${e.error} (${e.provider})`),
    };
  }

  getAvailablePool() {
    return this.pools
      .filter(p => p.active < p.concurrent)
      .sort((a, b) => a.priority - b.priority)[0] || null;
  }

  hasActiveJobs() {
    return this.pools.some(p => p.active > 0);
  }

  pause() { this.paused = true; }
  resume() { this.paused = false; }
  cancel() { this.cancelled = true; }

  async processQueue(illustrations, variantMode) {
    this.cancelled = false;
    this.paused = false;
    const jobs = [];

    for (const ill of illustrations) {
      if (variantMode === 'multi_model') {
        const enabledPools = this.pools.filter(p => p.enabled !== false);
        const variantCount = Math.min(ill.variantsRequested || 3, enabledPools.length);
        for (let v = 0; v < variantCount; v++) {
          jobs.push({
            illustrationId: ill.id,
            variantIndex: v,
            prompt: ill.prompt,
            negativePrompt: ill.negativePrompt,
            config: ill.config,
            preferredProvider: enabledPools[v % enabledPools.length].name,
            retryCount: 0,
            maxRetries: 2,
          });
        }
      } else {
        for (let v = 0; v < (ill.variantsRequested || 3); v++) {
          jobs.push({
            illustrationId: ill.id,
            variantIndex: v,
            prompt: ill.prompt,
            negativePrompt: ill.negativePrompt,
            config: ill.config,
            preferredProvider: null,
            retryCount: 0,
            maxRetries: 2,
          });
        }
      }
    }

    const pending = [...jobs];
    const results = [];
    const totalJobs = jobs.length;

    while ((pending.length > 0 || this.hasActiveJobs()) && !this.cancelled) {
      while (this.paused && !this.cancelled) {
        await new Promise(r => setTimeout(r, 200));
      }
      if (this.cancelled) break;

      let dispatched = false;

      for (let i = 0; i < pending.length; i++) {
        if (this.cancelled) break;
        const job = pending[i];
        let pool;

        if (job.preferredProvider) {
          pool = this.pools.find(
            p => p.name === job.preferredProvider && p.active < p.concurrent
          );
        }
        if (!pool) {
          pool = this.getAvailablePool();
        }

        if (pool) {
          pending.splice(i, 1);
          i--;
          pool.active++;
          dispatched = true;

          if (this.onWorkerUpdate) {
            this.onWorkerUpdate(this.pools, job, pool.name, 'started');
          }

          this._executeJob(job, pool)
            .then(result => {
              pool.active--;
              pool.totalGenerated++;
              this._recordSuccess(job, pool);
              results.push({ ...result, illustrationId: job.illustrationId, variantIndex: job.variantIndex });

              if (this.onImageReady) {
                this.onImageReady(job.illustrationId, result, pool.name, job.variantIndex);
              }
              if (this.onProgress) {
                this.onProgress(results.length, totalJobs);
              }
              if (this.onWorkerUpdate) {
                this.onWorkerUpdate(this.pools, job, pool.name, 'completed');
              }
            })
            .catch(err => {
              pool.active--;
              pool.totalFailed++;
              this._recordError(job, pool, err);

              if (job.retryCount < job.maxRetries) {
                job.retryCount++;
                if (this._providerStats[pool.name]) {
                  this._providerStats[pool.name].retries++;
                }
                job.preferredProvider = null;
                pending.push(job);
              } else {
                if (this.onError) {
                  this.onError(job.illustrationId, err, pool.name);
                }
              }
              if (this.onWorkerUpdate) {
                this.onWorkerUpdate(this.pools, job, pool.name, 'failed');
              }
            });
        }
      }

      if (!dispatched && pending.length > 0) {
        await new Promise(r => setTimeout(r, 500));
      }

      if (this.hasActiveJobs()) {
        await new Promise(r => setTimeout(r, 100));
      }
    }

    // Wait for remaining active jobs
    while (this.hasActiveJobs()) {
      await new Promise(r => setTimeout(r, 200));
    }

    return results;
  }

  async _executeJob(job, pool) {
    const dimensions = this.generator.getIllustrationDimensions(job.config.size || 'inline_full');

    switch (pool.generateFn) {
      case 'generateHF':
        return await this.generator.generateIllustrationHF(
          job.prompt, job.negativePrompt, pool.model, dimensions
        );
      case 'generateGptImage1':
        return await this.generator.generateIllustrationGptImage1(
          job.prompt, dimensions
        );
      case 'generatePuterSD':
        return await this.generator.generateIllustrationPuter(
          job.prompt, 'stabilityai/stable-diffusion-3-medium', dimensions
        );
      case 'generatePuterDalle':
        return await this.generator.generateIllustrationPuter(
          job.prompt, 'dall-e-3', dimensions
        );
      default:
        throw new Error(`Unknown generation function: ${pool.generateFn}`);
    }
  }
}

export { ProseGenerator, IllustrationQueue, loadPuterSDK };
