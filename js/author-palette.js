/**
 * Genesis 2 — AI-Powered Author Palette Selection
 *
 * Replaces the hardcoded Author Palette with a dynamic, AI-selected system:
 *   User selects Genre → Subgenre → POV/Voice from dropdowns
 *   On selection change, an AI prompt selects 5 optimal authors for that combination
 *   Each selected author comes with a tailored voice prompt describing their specific prose approach
 *   The 5 authors feed directly into the existing Chimera Synthesis pipeline
 *   User can regenerate the palette or lock specific authors they want to keep
 *
 * This is a one-time call per project setup (or when genre/subgenre/POV changes), not per chunk.
 */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

class AuthorPaletteManager {
  constructor(generator) {
    this.generator = generator;
  }

  /**
   * Call the AI to select 5 optimal authors for the genre/subgenre/POV combination.
   * Returns an object with authors array and paletteRationale.
   *
   * @param {string} genre - Primary genre label (e.g., "Documentary Historical Prose")
   * @param {string|null} subgenre - Subgenre label (e.g., "Literary Documentary Biography") or null
   * @param {string} pov - POV label (e.g., "Third-Person Objective (camera eye)")
   * @returns {Promise<Object>} Palette object with authors array and metadata
   */
  async selectAuthorPalette(genre, subgenre, pov) {
    const systemPrompt = this._getAuthorSelectionSystemPrompt(5);

    const userPrompt = `Select 5 authors for this project:

GENRE: ${genre}
SUBGENRE: ${subgenre || 'None (general genre rules)'}
POV/VOICE: ${pov}

Remember: the 5 authors must produce structurally DIFFERENT prose. Each voice prompt must be tailored to this specific genre/subgenre/POV combination, not generic. Include an original example passage in each voice prompt showing how that author's style would sound in THIS genre/subgenre.`;

    const response = await this._callAPI(systemPrompt, userPrompt, {
      temperature: 0.5,
      max_tokens: 4000,
    });

    const parsed = this._parseAuthorSelectionResponse(response);

    if (!parsed.authors || parsed.authors.length !== 5) {
      throw new Error(`Expected 5 authors, got ${parsed.authors?.length || 0}`);
    }

    // Add metadata
    parsed.genre = genre;
    parsed.subgenre = subgenre;
    parsed.pov = pov;
    parsed.selectedAt = new Date().toISOString();

    // Initialize locked state
    for (const author of parsed.authors) {
      author.locked = false;
    }

    return parsed;
  }

  /**
   * Get the system prompt for author selection.
   * @param {number} authorCount - Number of authors to select
   * @returns {string} System prompt
   */
  _getAuthorSelectionSystemPrompt(authorCount) {
    return `You are a literary expert selecting the ${authorCount} best authors whose prose styles should be channeled for a specific writing project.

Your goal is to choose authors whose techniques will produce GENUINELY DIFFERENT prose when each writes the same passage.

=== SELECTION CRITERIA ===

1. STRUCTURAL DIVERSITY: The ${authorCount} authors must produce structurally different prose — different sentence lengths, different approaches to scene-building, different ways of handling interiority, different relationships to dialogue. Do NOT select ${authorCount} authors who all write the same way.

2. GENRE MASTERY: At least ${Math.ceil(authorCount * 0.6)} of the ${authorCount} authors should be recognized masters of the specified genre or subgenre. The others can be from adjacent genres if their prose techniques would elevate this project.

3. POV FIT: All ${authorCount} authors must have demonstrated mastery of (or adaptability to) the specified point of view. If the POV is "Third-Person Objective (camera eye)," do not select authors known exclusively for deep first-person interiority.

4. VOICE RANGE: Include at least:
   - One author known for RESTRAINT (economy, understatement, what's not said)
   - One author known for SENSORY RICHNESS (physical world, embodied experience)
   - One author known for PSYCHOLOGICAL DEPTH (interiority, emotional complexity)
   - One author known for NARRATIVE DRIVE (momentum, pacing, tension)
   - One author known for DISTINCTIVE VOICE (unique sentence rhythms, unforgettable style)
   These roles may overlap — an author can fill more than one — but all five qualities must be represented across the palette.

5. NO DUPLICATIVE STYLES: If two authors would produce nearly identical prose for this genre/POV combination, drop one and select someone who provides contrast.

6. PRACTICAL CHANNELING: The authors must be well-known enough that an AI model can reliably channel their style. Obscure or debut authors whose style is not well-established in training data should be avoided. Prioritize authors with large, distinctive bodies of work.

=== FOR EACH AUTHOR, PROVIDE ===

A tailored voice prompt (150-250 words) that describes SPECIFICALLY how to channel that author's prose approach for THIS genre/subgenre/POV combination. The voice prompt should:
- Describe sentence structure tendencies (length, rhythm, complexity)
- Describe their approach to sensory detail and physical world
- Describe their handling of emotion and interiority
- Describe their dialogue approach
- Describe what they do that NO OTHER author on this palette does
- Include one short example passage (2-4 sentences) showing this voice applied to the genre/subgenre at hand — NOT a quote from the author's actual work, but an ORIGINAL example written in their style for this specific project type
- Specify an appropriate temperature setting (0.55-0.85) for this author's style

=== OUTPUT FORMAT ===

Return ONLY valid JSON, no markdown, no backticks, no preamble:

{
  "authors": [
    {
      "id": "author-lastname-lowercase",
      "name": "Full Author Name",
      "label": "2-3 word style label (e.g., 'Stark Declarative', 'Cool Observational')",
      "role": "Which of the 5 voice range qualities this author primarily fills",
      "temperature": 0.70,
      "voicePrompt": "The full 150-250 word channeling instruction with example passage",
      "whySelected": "One sentence explaining why this author fits this specific combination"
    }
  ],
  "paletteRationale": "2-3 sentences explaining the overall palette strategy and how these ${authorCount} voices will produce diverse, complementary prose for this project"
}`;
  }

  /**
   * Parse the AI response, handling potential JSON formatting issues.
   * @param {string} responseText - Raw AI response text
   * @returns {Object} Parsed palette object
   */
  _parseAuthorSelectionResponse(responseText) {
    let cleaned = responseText.trim();
    cleaned = cleaned.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');

    const jsonStart = cleaned.indexOf('{');
    const jsonEnd = cleaned.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1) {
      cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
    }

    try {
      return JSON.parse(cleaned);
    } catch (e) {
      console.error('Failed to parse author selection response:', e);
      throw new Error('AI returned invalid author selection. Try regenerating.');
    }
  }

  /**
   * Check if palette needs regeneration based on genre/subgenre/POV changes.
   * @param {Object} project - Current project data
   * @param {string} newGenre - New genre label
   * @param {string|null} newSubgenre - New subgenre label
   * @param {string} newPov - New POV label
   * @returns {boolean} True if palette needs regeneration
   */
  paletteNeedsRegeneration(project, newGenre, newSubgenre, newPov) {
    const palette = project.authorPalette;
    if (!palette || typeof palette === 'string') return true;
    if (!palette.authors || palette.authors.length === 0) return true;
    if (palette.genre !== newGenre) return true;
    if (palette.subgenre !== newSubgenre) return true;
    if (palette.pov !== newPov) return true;
    return false;
  }

  /**
   * Regenerate palette, preserving locked authors.
   * @param {Object} project - Current project data
   * @param {string} genre - Genre label
   * @param {string|null} subgenre - Subgenre label
   * @param {string} pov - POV label
   * @returns {Promise<Object>} New palette object
   */
  async regeneratePalette(project, genre, subgenre, pov) {
    const lockedAuthors = (project.authorPalette?.authors || [])
      .filter(a => a.locked);

    if (lockedAuthors.length >= 5) {
      return project.authorPalette;
    }

    if (lockedAuthors.length > 0) {
      return await this.selectAuthorPaletteWithLocks(genre, subgenre, pov, lockedAuthors);
    }

    return await this.selectAuthorPalette(genre, subgenre, pov);
  }

  /**
   * Select authors while preserving locked selections.
   * @param {string} genre - Genre label
   * @param {string|null} subgenre - Subgenre label
   * @param {string} pov - POV label
   * @param {Array} lockedAuthors - Array of locked author objects
   * @returns {Promise<Object>} New palette object with locked + new authors
   */
  async selectAuthorPaletteWithLocks(genre, subgenre, pov, lockedAuthors) {
    const slotsToFill = 5 - lockedAuthors.length;

    const userPrompt = `Select ${slotsToFill} authors for this project:

GENRE: ${genre}
SUBGENRE: ${subgenre || 'None (general genre rules)'}
POV/VOICE: ${pov}

ALREADY SELECTED (locked — do NOT include these, select authors that COMPLEMENT them):
${lockedAuthors.map(a => `- ${a.name} (${a.label}): ${a.role}`).join('\n')}

Select ${slotsToFill} additional authors that provide CONTRAST and DIVERSITY against the locked selections. Fill voice range gaps — if the locked authors are all known for restraint, select authors known for richness or drive.`;

    const response = await this._callAPI(
      this._getAuthorSelectionSystemPrompt(slotsToFill),
      userPrompt,
      { temperature: 0.5, max_tokens: 3000 }
    );

    const parsed = this._parseAuthorSelectionResponse(response);

    // Initialize locked state on new authors
    if (parsed.authors) {
      for (const author of parsed.authors) {
        author.locked = false;
      }
    }

    return {
      genre,
      subgenre,
      pov,
      selectedAt: new Date().toISOString(),
      paletteRationale: parsed.paletteRationale,
      authors: [...lockedAuthors, ...parsed.authors],
    };
  }

  /**
   * Build a concise author palette string from the structured palette for use in system prompts.
   * This is the bridge between the new structured palette and the existing prompt system.
   * @param {Object} palette - The structured palette object
   * @returns {string} Formatted author palette string for prompt injection
   */
  buildPalettePromptString(palette) {
    if (!palette || !palette.authors || palette.authors.length === 0) {
      return '';
    }
    return palette.authors.map(a =>
      `- ${a.name} (${a.label}): ${a.role}`
    ).join('\n');
  }

  /**
   * Make an API call to Anthropic.
   * @private
   */
  async _callAPI(systemPrompt, userPrompt, { temperature = 0.5, max_tokens = 4000 } = {}) {
    const apiKey = this.generator.apiKey;
    if (!apiKey) throw new Error('No API key set. Go to Settings to add your Anthropic API key.');

    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: this.generator.model,
        max_tokens: max_tokens,
        temperature,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    if (!response.ok) {
      const body = await response.text();
      let msg = `API error (${response.status})`;
      try { msg = JSON.parse(body).error?.message || msg; } catch (_) {}

      if (response.status === 429) {
        throw new Error(`Rate limited. Please wait a moment and try again.`);
      }
      throw new Error(msg);
    }

    const result = await response.json();
    return result.content?.[0]?.text?.trim() || '';
  }
}

export { AuthorPaletteManager };
