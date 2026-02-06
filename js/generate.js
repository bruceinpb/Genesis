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
  async generate({ plot, existingContent, sceneTitle, chapterTitle, characters, notes, tone, style, wordTarget }, { onChunk, onDone, onError }) {
    if (!this.apiKey) {
      onError(new Error('No API key set. Go to Settings to add your Anthropic API key.'));
      return;
    }

    this.abortController = new AbortController();

    const systemPrompt = this._buildSystemPrompt({ tone, style });
    const userPrompt = this._buildUserPrompt({ plot, existingContent, sceneTitle, chapterTitle, characters, notes, wordTarget });

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

  _buildSystemPrompt({ tone, style }) {
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
- Write ONLY the prose — no meta-commentary, no scene labels, no author notes`;

    if (tone) {
      prompt += `\n- Tone: ${tone}`;
    }
    if (style) {
      prompt += `\n- Writing style inspiration: ${style}`;
    }

    return prompt;
  }

  _buildUserPrompt({ plot, existingContent, sceneTitle, chapterTitle, characters, notes, wordTarget }) {
    let prompt = '';

    if (chapterTitle) {
      prompt += `Chapter: ${chapterTitle}\n`;
    }
    if (sceneTitle) {
      prompt += `Scene: ${sceneTitle}\n`;
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
        const truncated = plainText.slice(-2000);
        prompt += `\nContinue from this existing text (pick up exactly where it leaves off):\n"""${truncated}"""\n`;
      }
    }

    const target = wordTarget || 500;
    prompt += `\nWrite approximately ${target} words of prose. Output ONLY the story text, no labels or commentary.`;

    return prompt;
  }
}

export { ProseGenerator };
