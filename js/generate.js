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
  async generate({ plot, existingContent, sceneTitle, chapterTitle, characters, notes, chapterOutline, tone, style, wordTarget, concludeStory, genre, genreRules, projectGoal }, { onChunk, onDone, onError }) {
    if (!this.apiKey) {
      onError(new Error('No API key set. Go to Settings to add your Anthropic API key.'));
      return;
    }

    this.abortController = new AbortController();

    const systemPrompt = this._buildSystemPrompt({ tone, style, genre, genreRules });
    const userPrompt = this._buildUserPrompt({ plot, existingContent, sceneTitle, chapterTitle, characters, notes, chapterOutline, wordTarget, concludeStory, genre, genreRules, projectGoal });

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
          max_tokens: 4096,
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
  async scoreProse(proseText) {
    if (!this.apiKey) {
      throw new Error('No API key set.');
    }

    const systemPrompt = `You are a senior literary editor at The New York Times with 40 years of experience reviewing fiction. You score prose honestly and critically on a 100-point scale. You also detect common AI-generated writing patterns.

Your scoring criteria:
- Sentence variety and rhythm (0-15)
- Dialogue authenticity and distinction (0-15)
- Sensory detail and showing vs telling (0-15)
- Emotional resonance and character depth (0-15)
- Vocabulary precision and word choice (0-10)
- Narrative flow and pacing (0-10)
- Originality and voice (0-10)
- Technical execution (grammar, punctuation) (0-10)

Known AI writing patterns to detect:
- Overuse of "delicate", "intricate", "testament to", "tapestry", "symphony of"
- Starting sentences with "As" or "While" excessively
- Lists of three (tricolons) used too frequently
- Purple prose or overly flowery descriptions
- Telling emotions instead of showing them ("She felt sad")
- Formulaic paragraph structures
- Lack of authentic dialogue tags variety
- Excessive use of em-dashes
- Repetitive transitional phrases
- Generic or vague descriptions lacking specificity

Be HONEST. Most raw AI prose scores 45-65. Good human writing scores 70-85. Exceptional prose scores 85+.

Output valid JSON only: {"score": number, "label": "string", "issues": [{"text": "quoted problematic passage", "problem": "description", "severity": "high|medium|low"}], "aiPatterns": [{"pattern": "pattern name", "examples": ["example from text"]}], "summary": "2-3 sentence overall assessment"}`;

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
        messages: [{ role: 'user', content: `Score this prose and detect any AI patterns:\n\n"""${proseText.slice(-4000)}"""` }],
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
      return { score: 0, label: 'Unable to score', issues: [], aiPatterns: [], summary: 'Scoring failed — could not parse response.' };
    }
  }

  _buildSystemPrompt({ tone, style, genre, genreRules }) {
    let prompt = `You are a world-class fiction author writing prose for a novel. Your writing should be vivid, engaging, and publication-ready.

Guidelines for your prose:
- Write in third-person limited or first-person as appropriate to the story
- Show, don't tell — use sensory details, action, and dialogue instead of exposition
- Vary sentence length for rhythm — mix short punchy sentences with longer flowing ones
- Use strong, specific verbs instead of weak verbs with adverbs
- Minimize filter words (felt, saw, noticed, seemed) — put the reader directly in the experience
- Keep passive voice under 10%
- Write natural, character-distinct dialogue
- Include internal thought and emotional resonance
- Aim for a Flesch readability score of 60-80 (accessible but not simplistic)
- Write ONLY the prose — no meta-commentary, no scene labels, no author notes

=== AVOID AI WRITING PATTERNS ===
CRITICAL: Your prose must read as authentically human-written. Strictly avoid these known AI patterns:
- Do NOT overuse words like "delicate", "intricate", "testament to", "tapestry", "symphony of", "dance of", "nestled", "whispering"
- Do NOT start sentences with "As" or "While" excessively
- Do NOT use tricolons (lists of three) more than once per 500 words
- Do NOT write purple prose or overly flowery descriptions
- Do NOT tell emotions ("She felt sad") — SHOW them through action and dialogue
- Do NOT use formulaic paragraph structures (observation → feeling → action → reflection)
- Do NOT overuse em-dashes — use varied punctuation
- Do NOT use generic transitional phrases like "Meanwhile", "In that moment", "Little did she know"
- Vary dialogue tags — not every line needs "said" or an action beat
- Be specific, not generic — real details over vague descriptions`;

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

    const target = wordTarget || 500;

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

    return prompt;
  }

  /**
   * Rewrite prose to fix identified problems and/or apply user instructions.
   * Streams the response, replacing (not appending to) the original prose.
   */
  async rewriteProse({ originalProse, problems, userInstructions, chapterTitle, characters, notes, chapterOutline, aiInstructions, tone, style, wordTarget, genre, genreRules }, { onChunk, onDone, onError }) {
    if (!this.apiKey) {
      onError(new Error('No API key set. Go to Settings to add your Anthropic API key.'));
      return;
    }

    this.abortController = new AbortController();

    let systemPrompt = this._buildSystemPrompt({ tone, style, genre, genreRules });
    systemPrompt += `\n\n=== REWRITE MODE ===
You are REWRITING existing prose to fix specific issues. Rules:
- Maintain the same story events, characters, plot points, and narrative arc
- Preserve the narrative voice, tense, and point of view
- Fix ONLY the identified problems — do not introduce new issues
- If problems are minor, make surgical fixes to the affected passages
- If problems are pervasive, do a complete rewrite while preserving the story
- Output ONLY the rewritten prose — no commentary, no labels, no meta-text`;

    let userPrompt = '';
    if (chapterTitle) {
      userPrompt += `Chapter: ${chapterTitle}\n`;
    }
    if (genre) {
      userPrompt += `Genre: ${genre}\n`;
    }

    if (aiInstructions) {
      userPrompt += `\n=== AUTHOR INSTRUCTIONS (MUST FOLLOW) ===\n${aiInstructions}\n=== END AUTHOR INSTRUCTIONS ===\n`;
    }

    if (chapterOutline) {
      userPrompt += `\n=== CHAPTER OUTLINE (reference) ===\n${chapterOutline}\n=== END CHAPTER OUTLINE ===\n`;
    }

    userPrompt += `\n=== ORIGINAL PROSE TO REWRITE ===\n${originalProse}\n=== END ORIGINAL PROSE ===\n`;

    if (problems && problems.length > 0) {
      userPrompt += `\n=== ISSUES TO FIX ===\n`;
      problems.forEach((p, i) => {
        userPrompt += `${i + 1}. ${p}\n`;
      });
      userPrompt += `=== END ISSUES ===\n`;
    }

    if (userInstructions) {
      userPrompt += `\n=== AUTHOR'S REVISION INSTRUCTIONS ===\n${userInstructions}\n=== END REVISION INSTRUCTIONS ===\n`;
    }

    if (characters && characters.length > 0) {
      userPrompt += '\nCharacters:\n';
      for (const char of characters) {
        userPrompt += `- ${char.name} (${char.role})`;
        if (char.description) userPrompt += `: ${char.description}`;
        userPrompt += '\n';
      }
    }

    if (notes) {
      userPrompt += `\nAdditional context/notes:\n${notes}\n`;
    }

    const target = wordTarget || 500;
    userPrompt += `\nRewrite the prose (~${target} words), fixing all identified issues while keeping the same story events and characters. Output ONLY the rewritten prose.`;

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
          max_tokens: 4096,
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
