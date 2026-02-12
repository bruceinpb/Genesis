/**
 * Genesis 2 — Multi-Agent Prose Orchestrator (v2: Chimera Pipeline)
 *
 * Architecture:
 * - Writing Agents: N parallel agents (1-10) generate competing prose drafts
 * - Chimera Selection: Paragraph-level best-of selection across all agents
 * - Transition Smoothing: Junction sentences between different-author paragraphs
 * - Iterative Micro-Fix: Diagnose ONE weakness → fix → re-score → repeat
 * - Chapter Agents: Per-chapter continuity guardians (GO/NO-GO)
 *
 * Pipeline:
 *   1. Deploy N writing agents in parallel → N candidate drafts
 *   2. Paragraph-level chimera selection (best paragraph from each agent per position)
 *   3. Transition smoothing (only junction sentences between different-author paragraphs)
 *   4. Iterative micro-fix loop (one fix at a time, validate each, stop at 93+ or 3 passes)
 *   5. Chapter agents GO/NO-GO sequence
 */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

class MultiAgentOrchestrator {
  constructor(generator, storage) {
    this.generator = generator;
    this.storage = storage;

    // Configuration
    this.agentCount = 5;
    this.chapterAgentsEnabled = true;

    // Chapter digests cache: chapterId → { contentHash, digest }
    this._chapterDigests = new Map();

    // Status callback: (phase, message, data) => void
    this._statusCallback = null;

    // Abort controller for cancellation
    this._abortController = null;

    // Pipeline log accumulator for download
    this._pipelineLog = [];
  }

  /**
   * Configure orchestrator settings.
   */
  configure({ agentCount, chapterAgentsEnabled }) {
    if (agentCount !== undefined) this.agentCount = Math.max(1, Math.min(10, agentCount));
    if (chapterAgentsEnabled !== undefined) this.chapterAgentsEnabled = chapterAgentsEnabled;
  }

  /**
   * Register a callback for status updates during the pipeline.
   */
  onStatus(callback) {
    this._statusCallback = callback;
  }

  /**
   * Cancel any in-progress multi-agent operation.
   */
  cancel() {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
  }

  /** @private Emit a status update and log it. */
  _emit(phase, message, data = {}) {
    this._pipelineLog.push({
      timestamp: new Date().toISOString(),
      phase,
      message,
      data: Object.keys(data).length > 0 ? data : undefined
    });
    if (this._statusCallback) {
      this._statusCallback(phase, message, data);
    }
  }

  /** Alias used by new pipeline methods for consistency. */
  _logPipeline(phase, message, data = {}) {
    this._emit(phase, message, data);
  }

  /**
   * Get the accumulated pipeline log entries.
   */
  getPipelineLog() {
    return [...this._pipelineLog];
  }

  /**
   * Clear the pipeline log.
   */
  clearPipelineLog() {
    this._pipelineLog = [];
  }

  /** @private Simple string hash for cache invalidation. */
  _hash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return hash.toString(36);
  }

  /** @private Count words in a text string. */
  _countWords(text) {
    if (!text) return 0;
    return (text.match(/[a-zA-Z\u00C0-\u024F'''\u2019-]+/g) || []).length;
  }

  /**
   * @private Make a non-streaming API call to Anthropic.
   */
  async _callApi(systemPrompt, userPrompt, { maxTokens = 4096, temperature = 0.8 } = {}) {
    const apiKey = this.generator.apiKey;
    if (!apiKey) throw new Error('No API key set.');

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
        max_tokens: maxTokens,
        temperature,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      }),
      signal: this._abortController?.signal
    });

    if (!response.ok) {
      const body = await response.text();
      let msg = `API error (${response.status})`;
      try { msg = JSON.parse(body).error?.message || msg; } catch (_) {}

      if (response.status === 429) {
        throw new Error(`RATE_LIMITED: ${msg}`);
      }
      throw new Error(msg);
    }

    const result = await response.json();
    return result.content?.[0]?.text?.trim() || '';
  }

  /** @private Parse JSON from API response, handling code blocks. */
  _parseJson(text) {
    let jsonStr = text;
    const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlock) jsonStr = codeBlock[1].trim();
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonStr = jsonMatch[0];
    return JSON.parse(jsonStr);
  }

  /** @private Generic JSON parser with common formatting cleanup. */
  _parseJSON(responseText) {
    if (!responseText) return null;
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
      console.error('JSON parse failed:', e, 'Raw:', responseText.substring(0, 200));
      return null;
    }
  }

  /** @private Format author palette for the judge prompt. */
  _formatPaletteForJudge(authorPalette) {
    if (!authorPalette) return '';
    if (typeof authorPalette === 'object' && authorPalette.authors) {
      const list = authorPalette.authors.map(a => `${a.name} (${a.label})`).join(', ');
      return `STYLE INFLUENCES (AI-selected authors): ${list}`;
    }
    if (typeof authorPalette === 'string' && authorPalette.trim()) {
      return `STYLE INFLUENCES: ${authorPalette}`;
    }
    return '';
  }

  /** @private Statistical mode (most common value). */
  _mode(arr) {
    const freq = {};
    let maxCount = 0;
    let mode = arr[0];
    for (const val of arr) {
      freq[val] = (freq[val] || 0) + 1;
      if (freq[val] > maxCount) {
        maxCount = freq[val];
        mode = val;
      }
    }
    return mode;
  }

  // ═══════════════════════════════════════════════════════════
  //  AGENT ROSTER BUILDER (1-10 agents, palette + wildcards)
  // ═══════════════════════════════════════════════════════════

  /**
   * Build the agent roster based on user-selected count and available palette.
   *
   * @param {number} agentCount - User-selected count (1-10)
   * @param {Object} authorPalette - The AI-selected author palette (5 authors)
   * @param {Object} context - Generation context (genre, subgenre, POV, etc.)
   * @returns {Array} Array of agent configs ready for parallel generation
   */
  _buildAgentRoster(agentCount, authorPalette, context) {
    const roster = [];
    const paletteAuthors = (authorPalette && typeof authorPalette === 'object' && authorPalette.authors)
      ? authorPalette.authors
      : [];

    // Case 1: Single agent mode
    if (agentCount === 1) {
      if (paletteAuthors.length > 0) {
        roster.push({ ...paletteAuthors[0], agentType: 'palette' });
      } else {
        roster.push({
          id: 'default', name: 'Default Voice', label: 'Balanced',
          temperature: 0.7, voicePrompt: '', agentType: 'default'
        });
      }
      return roster;
    }

    // Case 2: Agent count <= palette size — use first N palette authors
    if (agentCount <= paletteAuthors.length) {
      for (let i = 0; i < agentCount; i++) {
        roster.push({ ...paletteAuthors[i], agentType: 'palette' });
      }
      return roster;
    }

    // Case 3: Agent count > palette size — all palette authors + wildcards
    // If no palette, use temperature-varied fallback agents
    if (paletteAuthors.length === 0) {
      const fallbackTemps = [0.70, 0.85, 1.00, 0.75, 0.95, 0.45, 0.82, 0.78, 0.55, 0.72];
      const fallbackLabels = ['Focused', 'Balanced', 'Creative', 'Precise', 'Bold',
        'Precision', 'Sensory', 'Rhythmic', 'Restraint', 'Accumulative'];
      for (let i = 0; i < agentCount; i++) {
        roster.push({
          id: `fallback-${i}`, name: fallbackLabels[i] || `Agent ${i + 1}`,
          label: fallbackLabels[i] || `Agent ${i + 1}`,
          temperature: fallbackTemps[i] || 0.7, voicePrompt: '', agentType: 'fallback'
        });
      }
      return roster;
    }

    for (const author of paletteAuthors) {
      roster.push({ ...author, agentType: 'palette' });
    }

    // Generate wildcard agents to fill remaining slots
    const wildcardsNeeded = agentCount - paletteAuthors.length;
    const wildcardConfigs = this._generateWildcardAgents(wildcardsNeeded, paletteAuthors, context);

    for (const wc of wildcardConfigs) {
      roster.push({ ...wc, agentType: 'wildcard' });
    }

    return roster;
  }

  /**
   * Generate wildcard agent configs that complement the palette authors.
   */
  _generateWildcardAgents(count, paletteAuthors, context) {
    const wildcards = [];

    const strategies = [
      {
        id: 'wildcard-precision', name: 'Precision Variant', label: 'Maximum Precision',
        temperature: 0.45,
        voicePrompt: `Write with extreme precision and economy. Every word must earn its place. Prefer short, declarative sentences. Avoid all ornamentation. No metaphors unless they reveal something that literal description cannot. Sentences should average 8-15 words. Paragraphs should be 2-4 sentences. Let silence and white space do emotional work. The goal is a prose style so clean it becomes invisible — the reader sees only the scene, never the writer.`
      },
      {
        id: 'wildcard-sensory', name: 'Sensory Immersion Variant', label: 'Deep Sensory',
        temperature: 0.82,
        voicePrompt: `Write with radical sensory commitment. Every paragraph must anchor the reader in at least two physical senses (not just sight). Temperature, texture, smell, the quality of light, the weight of objects, the feel of air. Sentences should vary dramatically in length — short punches followed by long accumulative sentences that pile physical detail. Emotion should be rendered through the body, never named directly. If a character feels grief, describe what grief does to their posture, their breathing, their relationship to physical space.`
      },
      {
        id: 'wildcard-rhythm', name: 'Rhythmic Variant', label: 'Musical Prose',
        temperature: 0.78,
        voicePrompt: `Write with intense attention to sentence rhythm and sonic quality. Vary sentence length dramatically: follow a 30-word sentence with a 5-word sentence. Use consonant clusters for tension, open vowels for release. Every paragraph should have a distinct rhythmic shape — building, cresting, resolving. Read every sentence aloud in your mind. If two consecutive sentences have the same rhythm, rewrite one. The prose should feel like music: theme, variation, development, resolution.`
      },
      {
        id: 'wildcard-restraint', name: 'Maximum Restraint Variant', label: 'Radical Restraint',
        temperature: 0.55,
        voicePrompt: `Write with radical understatement. The most powerful moments should be rendered in the simplest possible language. Never explain what a detail means — trust the reader. Avoid all similes and metaphors. Use only concrete nouns and active verbs. When emotion is highest, the prose should be most restrained. Dialogue should be spare and incomplete — people don't say what they mean. The unsaid should carry more weight than the said. Paragraphs should end mid-thought, not with neat resolution.`
      },
      {
        id: 'wildcard-accumulative', name: 'Accumulative Variant', label: 'Documentary Accumulation',
        temperature: 0.72,
        voicePrompt: `Write in long, layered sentences that accumulate detail the way an archivist accumulates evidence. Sentences should contain subordinate clauses, parenthetical qualifications, and embedded facts. The reader should feel the weight of research behind every claim. Use specific dates, measurements, proper nouns, and archival references. Paragraphs should be substantial — 5-8 sentences that build a complete evidentiary picture. Avoid all dramatic effects. Let facts speak.`
      }
    ];

    // Sort strategies by temperature distance from palette average (maximize diversity)
    const paletteTemps = paletteAuthors.map(a => a.temperature || 0.7);
    const avgPaletteTemp = paletteTemps.reduce((a, b) => a + b, 0) / paletteTemps.length;

    const sorted = [...strategies].sort((a, b) => {
      const distA = Math.abs(a.temperature - avgPaletteTemp);
      const distB = Math.abs(b.temperature - avgPaletteTemp);
      return distB - distA;
    });

    for (let i = 0; i < Math.min(count, sorted.length); i++) {
      wildcards.push(sorted[i]);
    }

    return wildcards;
  }

  // ═══════════════════════════════════════════════════════════
  //  ERROR PATTERN INTEGRATION
  // ═══════════════════════════════════════════════════════════

  /**
   * Build a banned-patterns prompt section from the project's error pattern database.
   */
  _buildBannedPatternsFromErrorDB(errorPatterns) {
    if (!errorPatterns || !Array.isArray(errorPatterns) || errorPatterns.length === 0) return '';

    const topPatterns = errorPatterns
      .filter(p => !p.dismissed)
      .filter(p => p.severity === 'high' || (p.frequency || p.occurrences || 0) >= 2)
      .sort((a, b) => {
        const scoreA = (a.frequency || a.occurrences || 1) * (a.severity === 'high' ? 3 : a.severity === 'medium' ? 2 : 1);
        const scoreB = (b.frequency || b.occurrences || 1) * (b.severity === 'high' ? 3 : b.severity === 'medium' ? 2 : 1);
        return scoreB - scoreA;
      })
      .slice(0, 12);

    if (topPatterns.length === 0) return '';

    let section = `\n\n=== PROJECT-SPECIFIC BANNED PATTERNS (from error database — ZERO TOLERANCE) ===\n`;
    section += `These patterns have been repeatedly flagged in this project. Do NOT use them:\n\n`;

    for (const pattern of topPatterns) {
      const example = pattern.text ? `"${pattern.text.substring(0, 80)}"` : '';
      section += `- [${pattern.category || 'pattern'}] ${example} — ${pattern.problem || pattern.description || pattern.category}\n`;
    }

    section += `\nIf you catch yourself writing any of these patterns, STOP and rewrite the sentence.\n`;
    return section;
  }

  // ═══════════════════════════════════════════════════════════
  //  PHASE 1: MULTI-AGENT PROSE GENERATION
  // ═══════════════════════════════════════════════════════════

  /**
   * Build an author-voice-specific system prompt by injecting the voice prompt
   * into the base system prompt.
   * @private
   */
  _buildAuthorVoiceSystemPrompt(baseSystemPrompt, authorName, voicePrompt, errorPatterns) {
    const authorBlock = `\n\n=== AUTHOR VOICE: ${authorName} ===\nYou are channeling the prose approach of ${authorName}.\n${voicePrompt}\n=== END AUTHOR VOICE ===\n`;

    // Find the AUTHOR PALETTE section and replace it with the specific author voice
    const paletteStart = baseSystemPrompt.indexOf('=== AUTHOR PALETTE ===');
    const paletteEnd = baseSystemPrompt.indexOf('=== HARD CONSTRAINTS');

    let prompt;
    if (paletteStart !== -1 && paletteEnd !== -1) {
      prompt = baseSystemPrompt.substring(0, paletteStart) +
        authorBlock +
        baseSystemPrompt.substring(paletteEnd);
    } else {
      prompt = authorBlock + baseSystemPrompt;
    }

    // Add project-specific banned patterns from error database
    const errorPatternSection = this._buildBannedPatternsFromErrorDB(errorPatterns);
    if (errorPatternSection) {
      prompt += errorPatternSection;
    }

    return prompt;
  }

  /**
   * Generate prose using multiple writing agents in parallel.
   * Supports 1-10 agents via the roster builder.
   *
   * @param {Object} params - { systemPrompt, userPrompt, maxTokens, authorPalette, roster, errorPatterns }
   * @returns {Array} Array of candidate objects.
   */
  async generateWithAgents(params) {
    const { systemPrompt, userPrompt, maxTokens = 4096, roster, errorPatterns } = params;

    this._emit('generating',
      `Deploying ${roster.length} ${roster.length === 1 ? 'agent' : 'AI-selected author-voice agents'}...`,
      { agentCount: roster.length, authors: roster.map(a => a.name || a.label) }
    );

    // Launch all agents with slight stagger to reduce rate-limit risk
    const promises = roster.map((agent, i) => {
      return new Promise(async (resolve) => {
        if (i > 0) await new Promise(r => setTimeout(r, i * 300));

        const agentId = i + 1;
        const agentLabel = agent.name ? `${agent.name} (${agent.label})` : agent.label;
        this._emit('agent-started', `Agent ${agentId} (${agentLabel}) writing...`, {
          agentId, profile: agentLabel, agentType: agent.agentType
        });

        // Build the system prompt for this agent
        let agentSystemPrompt = systemPrompt;
        if (agent.voicePrompt) {
          agentSystemPrompt = this._buildAuthorVoiceSystemPrompt(
            systemPrompt, agent.name || agent.label, agent.voicePrompt, errorPatterns
          );
        }

        const temp = agent.temperature || 0.7;

        try {
          const text = await this._callApi(agentSystemPrompt, userPrompt, {
            maxTokens, temperature: temp
          });
          this._emit('agent-done', `Agent ${agentId} (${agentLabel}) complete.`, { agentId });
          resolve({
            agentId, text, temperature: temp, label: agentLabel,
            authorName: agent.name || agent.label,
            authorId: agent.id || null,
            paletteName: agent.label || '',
            agentType: agent.agentType || 'unknown',
            error: null
          });
        } catch (err) {
          // Retry once on rate limit
          if (err.message.startsWith('RATE_LIMITED')) {
            this._emit('agent-retry', `Agent ${agentId} rate limited. Retrying in 5s...`, { agentId });
            await new Promise(r => setTimeout(r, 5000));
            try {
              const text = await this._callApi(agentSystemPrompt, userPrompt, {
                maxTokens, temperature: temp
              });
              this._emit('agent-done', `Agent ${agentId} (${agentLabel}) complete (retry).`, { agentId });
              resolve({
                agentId, text, temperature: temp, label: agentLabel,
                authorName: agent.name || agent.label, authorId: agent.id || null,
                paletteName: agent.label || '', agentType: agent.agentType || 'unknown', error: null
              });
              return;
            } catch (retryErr) {
              this._emit('agent-error', `Agent ${agentId} retry failed: ${retryErr.message}`, { agentId });
              resolve({
                agentId, text: '', temperature: temp, label: agentLabel,
                authorName: agent.name || agent.label, authorId: agent.id || null,
                paletteName: agent.label || '', agentType: agent.agentType || 'unknown', error: retryErr.message
              });
              return;
            }
          }
          this._emit('agent-error', `Agent ${agentId} failed: ${err.message}`, { agentId });
          resolve({
            agentId, text: '', temperature: temp, label: agentLabel,
            authorName: agent.name || agent.label, authorId: agent.id || null,
            paletteName: agent.label || '', agentType: agent.agentType || 'unknown', error: err.message
          });
        }
      });
    });

    const candidates = await Promise.all(promises);
    const valid = candidates.filter(c => c.text && c.text.length > 50);

    if (valid.length === 0) {
      throw new Error('All writing agents failed to produce prose. Check your API key and rate limits.');
    }

    this._emit('generation-complete',
      `${valid.length} of ${roster.length} agents produced candidates.`,
      { total: roster.length, successful: valid.length }
    );

    return valid;
  }

  // ═══════════════════════════════════════════════════════════
  //  PHASE 2: PARAGRAPH-LEVEL CHIMERA SELECTION
  // ═══════════════════════════════════════════════════════════

  /**
   * Segment prose into paragraphs.
   */
  _segmentParagraphs(prose) {
    if (!prose) return [];
    return prose
      .split(/\n\s*\n/)
      .map(p => p.trim())
      .filter(p => p.length > 0)
      .filter(p => !/^\*\s*\*\s*\*$/.test(p));
  }

  /**
   * Paragraph-Level Chimera Selection.
   * Evaluates each paragraph position across all agents and selects the best.
   */
  async _chimeraSelect(candidates, context) {
    // Single candidate — no chimera possible
    if (candidates.length === 1) {
      return {
        prose: candidates[0].text || candidates[0].prose,
        score: null,
        rationale: 'Single agent mode — no chimera selection.',
        selections: [],
        sourceCandidates: candidates,
        method: 'single'
      };
    }

    // Two candidates — fall back to whole-output judging
    if (candidates.length === 2) {
      const result = await this._judgeWholeOutput(candidates, context);
      return { ...result, method: 'whole-output' };
    }

    // 3+ candidates — paragraph-level chimera
    this._logPipeline('chimera', `Segmenting ${candidates.length} candidates into paragraphs...`);

    const segmented = candidates.map(c => ({
      ...c,
      prose: c.text || c.prose,
      paragraphs: this._segmentParagraphs(c.text || c.prose)
    }));

    segmented.forEach(c => {
      this._logPipeline('chimera', `  ${c.authorName}: ${c.paragraphs.length} paragraphs`);
    });

    // Determine target paragraph count (mode)
    const counts = segmented.map(c => c.paragraphs.length);
    const targetCount = this._mode(counts);

    // Filter to compatible candidates (paragraph count within ±1 of target)
    const compatible = segmented.filter(c =>
      Math.abs(c.paragraphs.length - targetCount) <= 1
    );

    this._logPipeline('chimera', `Target: ${targetCount} paragraphs. ${compatible.length} of ${segmented.length} agents compatible.`);

    if (compatible.length < 3) {
      this._logPipeline('chimera', 'Too few compatible candidates. Falling back to whole-output judging.');
      const result = await this._judgeWholeOutput(candidates, context);
      return { ...result, method: 'whole-output-fallback' };
    }

    // Normalize paragraph counts
    const normalized = compatible.map(c => {
      const paras = [...c.paragraphs];
      if (paras.length > targetCount) {
        const excess = paras.splice(targetCount - 1);
        paras.push(excess.join('\n\n'));
      }
      return { ...c, normalizedParagraphs: paras };
    });

    // Shuffle candidate labels to prevent position bias
    const shuffled = [...normalized];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const labels = shuffled.map((_, i) => String.fromCharCode(65 + i));

    // Build the chimera selection prompt
    const systemPrompt = `You are an expert literary chimera synthesizer. You will see ${shuffled.length} versions of the same passage, each written by a different author-voice agent. Each version is divided into paragraphs.

YOUR TASK: For each paragraph position, select the BEST version from across all agents.
You are building a composite passage that takes the strongest paragraph from whichever agent wrote it best at that position.

=== EVALUATION CRITERIA PER PARAGRAPH ===
1. Prose quality — sentence rhythm, word choice, sonic texture
2. Absence of AI patterns — NO tricolons (lists of three), NO PET phrases (throat tightened, hands shook, heart hammered), NO formulaic structures (observation → detail → reflection), NO dramatic kicker endings
3. Sensory specificity — concrete, physical, embodied detail
4. Narrative advancement — does this paragraph move the story forward?
5. Voice distinctiveness — does this paragraph sound like a human author, not an AI?

=== TRANSITION AWARENESS ===
When selecting paragraphs from different agents for adjacent positions, consider whether the transition between them will feel natural. If two brilliant paragraphs from different agents would create a jarring transition, prefer a slightly-less-brilliant paragraph that flows better from the previous selection.

=== OUTPUT FORMAT ===
Return ONLY valid JSON, no markdown, no backticks, no preamble:
{
  "selections": [
    { "position": 1, "selected": "C", "reason": "One sentence why this version is best at this position", "needsSmoothing": false },
    { "position": 2, "selected": "A", "reason": "One sentence why", "needsSmoothing": true }
  ],
  "overallScore": 93,
  "chimeraRationale": "2-3 sentences explaining the chimera strategy and why this combination works"
}

SCORING GUIDANCE for overallScore:
- 95-100: Exceptional — every paragraph is the best it could be, transitions seamless, no AI patterns
- 90-94: Excellent — strong throughout with minor imperfections
- 85-89: Good — solid prose but with noticeable AI patterns or weak paragraphs
- Below 85: Needs significant work

Be HONEST. Do not inflate.`;

    let userPrompt = `CHAPTER CONTEXT: ${context.chapterTitle || context.currentChapterTitle || 'Current chapter'}\n`;
    if (context.beats) {
      userPrompt += `BEATS TO COVER: ${context.beats}\n`;
    }
    userPrompt += `\n`;

    for (let pos = 0; pos < targetCount; pos++) {
      userPrompt += `========== PARAGRAPH ${pos + 1} of ${targetCount} ==========\n\n`;
      shuffled.forEach((c, j) => {
        const para = c.normalizedParagraphs[pos] || '[agent did not produce a paragraph at this position]';
        userPrompt += `--- Version ${labels[j]} ---\n${para}\n\n`;
      });
    }

    userPrompt += `\nSelect the best version for each paragraph position. Remember: you're building a chimera from the best parts of each agent.`;

    this._logPipeline('chimera', `Evaluating ${targetCount} paragraph positions across ${shuffled.length} agents...`);

    const response = await this._callApi(systemPrompt, userPrompt, {
      temperature: 0.2,
      maxTokens: 2000
    });

    const result = this._parseChimeraResponse(response);

    if (!result || !result.selections || result.selections.length === 0) {
      this._logPipeline('chimera', 'Failed to parse chimera selection. Falling back to whole-output judging.');
      const fallback = await this._judgeWholeOutput(candidates, context);
      return { ...fallback, method: 'whole-output-parse-fallback' };
    }

    // Assemble the chimera
    const chimeraParagraphs = [];
    const selectionLog = [];

    for (const sel of result.selections) {
      const labelIndex = sel.selected.charCodeAt(0) - 65;
      const agent = shuffled[labelIndex];
      const para = agent?.normalizedParagraphs[sel.position - 1];

      if (para) {
        chimeraParagraphs.push(para);
        selectionLog.push({
          position: sel.position,
          agent: agent.authorName,
          label: agent.paletteName,
          reason: sel.reason,
          needsSmoothing: sel.needsSmoothing
        });
        this._logPipeline('chimera', `  P${sel.position}: ${agent.authorName} (${agent.paletteName}) — ${sel.reason}`);
      } else {
        const fallbackPara = normalized[0]?.normalizedParagraphs[sel.position - 1] || '';
        chimeraParagraphs.push(fallbackPara);
        selectionLog.push({
          position: sel.position,
          agent: normalized[0]?.authorName || 'fallback',
          label: 'fallback',
          reason: 'Chimera selection failed for this position',
          needsSmoothing: true
        });
      }
    }

    const chimeraProse = chimeraParagraphs.join('\n\n');

    this._logPipeline('chimera', `Chimera assembled: ${this._countWords(chimeraProse)} words, score: ${result.overallScore}`);
    this._logPipeline('chimera', `Rationale: ${result.chimeraRationale}`);

    return {
      prose: chimeraProse,
      score: result.overallScore,
      rationale: result.chimeraRationale,
      selections: selectionLog,
      sourceCandidates: candidates,
      method: 'paragraph-chimera'
    };
  }

  /**
   * Parse chimera selection JSON response.
   */
  _parseChimeraResponse(responseText) {
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
      console.error('Failed to parse chimera response:', e);
      return null;
    }
  }

  /**
   * Fallback: whole-output judging using the existing judge method.
   */
  async _judgeWholeOutput(candidates, context) {
    this._emit('judging', `Judge agent evaluating ${candidates.length} candidates...`);

    const shuffled = [...candidates];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const anonLabels = shuffled.map((_, i) => String.fromCharCode(65 + i));
    const candidateBlock = shuffled.map((c, i) =>
      `=== CANDIDATE ${anonLabels[i]} ===\n${c.text || c.prose}\n=== END CANDIDATE ${anonLabels[i]} ===`
    ).join('\n\n');

    const genre = context.genre || '';
    const voice = context.voice || '';
    const authorPalette = context.authorPalette || '';
    const qualityThreshold = context.qualityThreshold || 90;

    const systemPrompt = `You are a senior literary editor and competition judge. You have ${candidates.length} versions of the same prose passage. Select the BEST version.

EVALUATION CRITERIA (order of importance):
1. VOICE AUTHENTICITY (25%) — Distinct human voice, not generic/AI-sounding?
2. PROSE QUALITY (25%) — Sentence variety, rhythm, word choice, sensory detail, showing vs telling
3. GENRE ADHERENCE (20%) — Matches ${genre || 'the genre'} conventions?
4. EMOTIONAL RESONANCE (15%) — Makes the reader feel? Emotions shown through action?
5. ORIGINALITY (15%) — Fresh imagery, unexpected turns, no cliches?
${voice && voice !== 'auto' ? `\nVOICE REQUIREMENT: Must be in ${voice} voice/POV.` : ''}
${this._formatPaletteForJudge(authorPalette)}
QUALITY TARGET: ${qualityThreshold}/100

IMPORTANT: Candidates are labeled with letters. Evaluate ONLY based on prose quality. Do NOT favor any particular position.

Output valid JSON only:
{
  "selectedCandidate": "<letter>",
  "scores": [
    { "candidateLabel": "<letter>", "voiceAuthenticity": 0, "proseQuality": 0, "genreAdherence": 0, "emotionalResonance": 0, "originality": 0, "totalScore": 0, "summary": "" }
  ],
  "selectionReasoning": "<why this candidate won>",
  "strengthsToPreserve": ["<qualities to keep>"],
  "suggestedFixes": [{ "issue": "", "location": "", "suggestion": "", "priority": "high" }]
}`;

    const text = await this._callApi(systemPrompt,
      `Evaluate these ${candidates.length} prose candidates:\n\n${candidateBlock}`,
      { maxTokens: 4096, temperature: 0.3 }
    );

    const report = this._parseJson(text);

    // Map the anonymous winner back
    const winnerLabel = String(report.selectedCandidate).trim().toUpperCase();
    const winnerIdx = winnerLabel.charCodeAt(0) - 65;
    const winner = (winnerIdx >= 0 && winnerIdx < shuffled.length)
      ? shuffled[winnerIdx]
      : shuffled[0];

    if (report.scores) {
      for (const s of report.scores) {
        const lbl = String(s.candidateLabel).trim().toUpperCase();
        const idx = lbl.charCodeAt(0) - 65;
        s.agentId = (idx >= 0 && idx < shuffled.length) ? shuffled[idx].agentId : '?';
      }
    }

    const winnerScore = report.scores?.find(s => s.agentId === winner.agentId)?.totalScore || null;

    this._emit('judging-complete',
      `Judge selected Agent ${winner.agentId} (${winner.label}). Score: ${winnerScore || '?'}/100`,
      { winnerId: winner.agentId, report }
    );

    return {
      prose: winner.text || winner.prose,
      score: winnerScore,
      rationale: report.selectionReasoning || '',
      selections: [],
      sourceCandidates: candidates,
      judgeReport: report,
      winner
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  PHASE 3: TRANSITION SMOOTHING
  // ═══════════════════════════════════════════════════════════

  /**
   * Smooth transitions between paragraphs from different agents.
   * Only modifies junction sentences.
   */
  async _smoothTransitions(prose, selections, context) {
    const smoothingNeeded = [];
    for (let i = 0; i < selections.length - 1; i++) {
      const current = selections[i];
      const next = selections[i + 1];

      if (current.needsSmoothing || next.needsSmoothing || current.agent !== next.agent) {
        smoothingNeeded.push({
          fromPosition: current.position,
          toPosition: next.position,
          fromAgent: current.agent,
          toAgent: next.agent,
          flagged: current.needsSmoothing || next.needsSmoothing
        });
      }
    }

    if (smoothingNeeded.length === 0) {
      this._logPipeline('smoothing', 'No transitions need smoothing (all paragraphs from same agent).');
      return prose;
    }

    const flaggedTransitions = smoothingNeeded.filter(t => t.fromAgent !== t.toAgent);

    if (flaggedTransitions.length === 0) {
      this._logPipeline('smoothing', 'All cross-agent transitions look natural. Skipping smoothing.');
      return prose;
    }

    this._logPipeline('smoothing', `Smoothing ${flaggedTransitions.length} cross-agent transitions...`);

    const systemPrompt = `You are a prose transition specialist. A passage has been assembled by selecting the best paragraphs from different authors. Some transitions between paragraphs feel slightly abrupt because they were written by different voices.

YOUR TASK: Smooth the flagged transitions by modifying ONLY:
- The LAST sentence of the preceding paragraph, AND/OR
- The FIRST sentence of the following paragraph

=== RULES ===
1. Change NO MORE than 2 sentences total per transition
2. Preserve the quality, voice, and content of both paragraphs
3. Do NOT add new narrative content or remove existing content
4. Do NOT change any sentence that is NOT at a transition junction
5. The goal is seamlessness — a reader should not notice the author change
6. Return the COMPLETE passage with smoothed transitions
7. Word count must stay within 5% of the input
8. After the passage, add a line "---SMOOTHING_LOG---" followed by a brief note on what you changed at each transition (1 line per transition)`;

    const transitionDescriptions = flaggedTransitions.map(t =>
      `Between P${t.fromPosition} (by ${t.fromAgent}) and P${t.toPosition} (by ${t.toAgent})`
    ).join('\n');

    const userPrompt = `PASSAGE (${this._countWords(prose)} words):\n\n${prose}\n\nTRANSITIONS TO SMOOTH:\n${transitionDescriptions}\n\nSmooth these transitions. Change only junction sentences. Return the complete passage.`;

    const response = await this._callApi(systemPrompt, userPrompt, {
      temperature: 0.25,
      maxTokens: 2500
    });

    let smoothed = response.trim();
    const logMarker = smoothed.indexOf('---SMOOTHING_LOG---');
    if (logMarker !== -1) {
      const log = smoothed.substring(logMarker + '---SMOOTHING_LOG---'.length).trim();
      smoothed = smoothed.substring(0, logMarker).trim();
      this._logPipeline('smoothing', `Smoothing applied: ${log.substring(0, 200)}`);
    }

    // Validate word count drift
    const originalWords = this._countWords(prose);
    const smoothedWords = this._countWords(smoothed);
    const drift = Math.abs(smoothedWords - originalWords) / originalWords;

    if (drift > 0.10) {
      this._logPipeline('smoothing', `Smoothing caused ${Math.round(drift * 100)}% word drift. Using original.`);
      return prose;
    }

    this._logPipeline('smoothing', `Transitions smoothed. Words: ${originalWords} -> ${smoothedWords}`);
    return smoothed;
  }

  // ═══════════════════════════════════════════════════════════
  //  PHASE 4: ITERATIVE MICRO-FIX LOOP
  // ═══════════════════════════════════════════════════════════

  /**
   * Iterative micro-fix loop: diagnose ONE weakness, fix it, re-score, repeat.
   */
  async _iterativeMicroFix(prose, context, currentScore, targetScore = 93, maxPasses = 3) {
    let currentProse = prose;
    let score = currentScore;
    const fixesApplied = [];
    const attemptedFixes = [];

    // If we don't have a score yet, get one
    if (score === null || score === undefined) {
      score = await this._quickScore(currentProse, context);
      this._logPipeline('microfix', `Initial score: ${score}`);
    }

    for (let pass = 0; pass < maxPasses; pass++) {
      if (score >= targetScore) {
        this._logPipeline('microfix', `Score ${score} >= target ${targetScore}. Stopping.`);
        break;
      }

      // Step 1: Diagnose the single weakest element
      const diagnosis = await this._diagnoseWeakestElement(currentProse, context, attemptedFixes);

      if (!diagnosis || diagnosis.severity === 'none') {
        this._logPipeline('microfix', `No significant weakness found. Stopping at score ${score}.`);
        break;
      }

      this._logPipeline('microfix', `Pass ${pass + 1}: [${diagnosis.category}] "${(diagnosis.text || '').substring(0, 60)}..." — ${diagnosis.diagnosis}`);

      attemptedFixes.push(diagnosis.text || diagnosis.diagnosis);

      // Step 2: Fix ONLY that element
      const fixedProse = await this._fixSingleElement(currentProse, diagnosis, context);

      if (!fixedProse || fixedProse === currentProse) {
        this._logPipeline('microfix', `Pass ${pass + 1}: Fix produced no change. Skipping.`);
        continue;
      }

      // Step 3: Validate word count
      const originalWords = this._countWords(currentProse);
      const fixedWords = this._countWords(fixedProse);
      const drift = Math.abs(fixedWords - originalWords) / originalWords;

      if (drift > 0.08) {
        this._logPipeline('microfix', `Pass ${pass + 1}: Fix caused ${Math.round(drift * 100)}% word drift. Rejecting.`);
        continue;
      }

      // Step 4: Re-score
      const newScore = await this._quickScore(fixedProse, context);

      if (newScore >= score) {
        const delta = newScore - score;
        currentProse = fixedProse;
        score = newScore;
        fixesApplied.push({
          pass: pass + 1,
          category: diagnosis.category,
          text: (diagnosis.text || '').substring(0, 80),
          scoreBefore: score - delta,
          scoreAfter: score
        });
        this._logPipeline('microfix', `Pass ${pass + 1}: Score ${score - delta} -> ${score} (+${delta}). Fix accepted.`);
      } else {
        this._logPipeline('microfix', `Pass ${pass + 1}: Score dropped ${score} -> ${newScore}. Fix rejected.`);
      }
    }

    this._logPipeline('microfix', `Micro-fix complete. Final score: ${score}. Fixes applied: ${fixesApplied.length}`);

    return { prose: currentProse, score, fixesApplied };
  }

  /**
   * Diagnose the single weakest element in the prose.
   */
  async _diagnoseWeakestElement(prose, context, previousAttempts = []) {
    let avoidSection = '';
    if (previousAttempts.length > 0) {
      avoidSection = `\n\n=== ALREADY ATTEMPTED (do NOT identify these again) ===\n${
        previousAttempts.map(t => `- "${t}"`).join('\n')
      }\n\nFind a DIFFERENT weakness.`;
    }

    let errorDBSection = '';
    if (context.errorPatterns && context.errorPatterns.length > 0) {
      const topPatterns = context.errorPatterns
        .filter(p => p.severity === 'high' || (p.frequency || p.occurrences || 0) >= 2)
        .slice(0, 10);
      if (topPatterns.length > 0) {
        errorDBSection = `\n\n=== KNOWN PROJECT PATTERNS TO WATCH FOR ===\n${
          topPatterns.map(p => `- ${p.category}: "${(p.text || '').substring(0, 60) || p.problem}"`).join('\n')
        }`;
      }
    }

    const systemPrompt = `You are a prose diagnostician. Identify the SINGLE weakest element in this passage.

=== PRIORITY ORDER (check in this order) ===
1. TRICOLONS — Any list of three parallel items/phrases/sentences. This is the #1 AI pattern.
2. PET PHRASES — throat tightened, hands shook/trembled, heart hammered/raced, jaw clenched, stomach dropped, eyes widened, breath caught
3. DRAMATIC KICKER ENDINGS — short punchy final sentences designed for artificial profundity
4. FORMULAIC PARAGRAPH STRUCTURE — observation -> detail -> reflection pattern repeated
5. TELLING INSTEAD OF SHOWING — naming emotions instead of rendering them physically
6. OVERWROUGHT SIMILES — forced comparisons that feel literary-workshop
7. RHETORICAL PARALLELISM — consecutive sentences with identical structure used as crutch
8. WEAK/GENERIC IMAGERY — details that could apply to any scene
${errorDBSection}
${avoidSection}

=== OUTPUT FORMAT ===
Return ONLY valid JSON, no markdown, no backticks:
{
  "text": "the exact text that is weak (quote 1-3 sentences)",
  "category": "tricolon|pet-phrase|dramatic-kicker|formulaic|telling|simile|parallelism|weak-imagery|rhythm",
  "severity": "high|medium|none",
  "diagnosis": "one sentence explaining why this is weak",
  "suggestedApproach": "one sentence on how to fix without introducing new AI patterns"
}

If the prose is genuinely strong with no significant weakness remaining:
{ "severity": "none", "diagnosis": "No significant weakness found" }

Be HONEST. Most AI-generated prose has at least one tricolon or formulaic pattern.`;

    const response = await this._callApi(systemPrompt, `PROSE:\n\n${prose}`, {
      temperature: 0.15,
      maxTokens: 500
    });

    return this._parseJSON(response);
  }

  /**
   * Fix a single diagnosed weakness.
   */
  async _fixSingleElement(prose, diagnosis, context) {
    const systemPrompt = `You are a surgical prose editor. Fix EXACTLY ONE weakness in this passage.

THE WEAKNESS:
Exact text: "${diagnosis.text || ''}"
Category: ${diagnosis.category}
Diagnosis: ${diagnosis.diagnosis}
Suggested approach: ${diagnosis.suggestedApproach || 'Rewrite to avoid the identified pattern'}

=== ABSOLUTE RULES ===
1. Change ONLY the identified weak text and at most 1 adjacent sentence for flow
2. The replacement must be genuinely better — not just different
3. Preserve the voice, tone, and rhythm of the surrounding prose
4. Do NOT introduce new AI patterns. Specifically:
   - NO tricolons (lists of three)
   - NO PET phrases (throat, hands, heart, jaw, stomach, eyes, breath)
   - NO dramatic kicker endings
   - NO formulaic structures
5. Return the COMPLETE passage with the single fix applied
6. Word count must stay within 5% of the original
7. If you cannot fix this without introducing new problems, return the original unchanged`;

    const response = await this._callApi(systemPrompt, `PROSE (${this._countWords(prose)} words):\n\n${prose}`, {
      temperature: 0.35,
      maxTokens: 2000
    });

    return response.trim();
  }

  /**
   * Quick scoring pass — returns a single integer score (0-100).
   */
  async _quickScore(prose, context) {
    const systemPrompt = `You are a prose quality scorer. Score this passage on a 0-100 scale.

=== SCORING CRITERIA ===
- 95-100: Exceptional prose indistinguishable from a published bestseller. Zero AI patterns. Every sentence earns its place.
- 90-94: Excellent prose with minor imperfections. Perhaps one weak transition or slightly generic image.
- 85-89: Good prose with noticeable patterns. Contains 1-2 tricolons, or formulaic paragraph structures.
- 80-84: Decent prose with multiple AI patterns. Several tricolons, PET phrases, or formulaic structures.
- Below 80: Significant quality issues.

=== DEDUCTIONS ===
- Each tricolon: -2 points
- Each PET phrase: -2 points
- Each dramatic kicker ending: -1 point
- Each formulaic paragraph structure: -2 points
- Each instance of telling vs showing: -1 point
- Each overwrought simile: -1 point

Be HONEST. Do not inflate. An AI-generated passage that sounds "good" but contains 3 tricolons and 2 PET phrases is an 83-85, not a 91.

=== OUTPUT FORMAT ===
Return ONLY valid JSON:
{
  "score": 91,
  "deductions": [
    { "issue": "tricolon in paragraph 3", "points": -2 }
  ],
  "strengths": "One sentence on what works well",
  "ceiling": "One sentence on what prevents a higher score"
}`;

    const response = await this._callApi(systemPrompt, `PROSE:\n\n${prose}`, {
      temperature: 0.1,
      maxTokens: 500
    });

    const parsed = this._parseJSON(response);
    return parsed?.score || 85;
  }

  // ═══════════════════════════════════════════════════════════
  //  PHASE 5: CHAPTER AGENTS — CONTINUITY TRACKING
  // ═══════════════════════════════════════════════════════════

  /**
   * Build a continuity digest for a single chapter's content.
   */
  async buildChapterDigest(content, chapterTitle) {
    const plainText = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    if (plainText.length < 50) {
      return {
        chapterTitle, characters: [], locations: [], timelineEvents: [],
        plotPoints: [], establishedFacts: [], emotionalStates: {},
        objectsAndItems: [], relationships: [], isEmpty: true
      };
    }

    const contentHash = this._hash(plainText);

    const systemPrompt = `You are a continuity editor tracking every detail in a book chapter. Extract ALL factual details that could create continuity errors if contradicted in later chapters.

Be EXHAUSTIVE. A missing detail could cause a plot hole.

Output valid JSON only:
{
  "characters": [
    { "name": "<name>", "details": ["<physical descriptions>", "<age refs>", "<clothing>", "<injuries>", "<any stated fact>"] }
  ],
  "locations": [
    { "name": "<name>", "details": ["<physical descriptions>", "<distances>", "<directions>", "<layout>"] }
  ],
  "timelineEvents": [
    { "event": "<what happened>", "when": "<time reference>", "order": "<sequence position>" }
  ],
  "plotPoints": ["<key plot developments affecting future chapters>"],
  "establishedFacts": ["<any fact stated as true that cannot be contradicted>"],
  "emotionalStates": { "<characterName>": "<emotional state at END of chapter>" },
  "objectsAndItems": ["<significant objects: location, ownership, state>"],
  "relationships": ["<character relationships and any changes>"]
}`;

    const text = await this._callApi(systemPrompt,
      `Extract ALL continuity details from this chapter:\n\nChapter: ${chapterTitle}\n\n"""${plainText.slice(0, 12000)}"""`,
      { maxTokens: 4096, temperature: 0 }
    );

    const digest = this._parseJson(text);
    digest.chapterTitle = chapterTitle;
    digest.contentHash = contentHash;
    return digest;
  }

  /**
   * Refresh all chapter digests. Only rebuilds chapters whose content has changed.
   */
  async refreshAllDigests(chapters) {
    this._emit('digests', `Building chapter agent digests for ${chapters.length} chapters...`);

    let rebuilt = 0;
    let cached = 0;

    for (const chapter of chapters) {
      const plainText = (chapter.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const contentHash = this._hash(plainText);

      const existing = this._chapterDigests.get(chapter.id);
      if (existing && existing.contentHash === contentHash) {
        cached++;
        continue;
      }

      if (plainText.length < 50) {
        this._chapterDigests.set(chapter.id, {
          chapterTitle: chapter.title, contentHash,
          characters: [], locations: [], timelineEvents: [],
          plotPoints: [], establishedFacts: [], emotionalStates: {},
          objectsAndItems: [], relationships: [], isEmpty: true
        });
        cached++;
        continue;
      }

      this._emit('digest-building', `Chapter agent "${chapter.title}" analyzing...`, {
        chapterId: chapter.id
      });

      try {
        const digest = await this.buildChapterDigest(chapter.content, chapter.title);
        this._chapterDigests.set(chapter.id, digest);
        rebuilt++;
      } catch (err) {
        this._emit('digest-error', `Chapter agent "${chapter.title}" failed: ${err.message}`, {
          chapterId: chapter.id
        });
        this._chapterDigests.set(chapter.id, {
          chapterTitle: chapter.title, contentHash, error: err.message,
          characters: [], locations: [], timelineEvents: [],
          plotPoints: [], establishedFacts: [], emotionalStates: {},
          objectsAndItems: [], relationships: [], isEmpty: true
        });
      }
    }

    this._emit('digests-complete', `Chapter agents ready. ${rebuilt} updated, ${cached} cached.`, {
      rebuilt, cached
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  PHASE 5 (continued): GO/NO-GO — LAUNCH CONTROL
  // ═══════════════════════════════════════════════════════════

  /**
   * Check a single chapter for conflicts with new prose.
   */
  async checkChapterConflict(newProse, digest, currentChapterTitle) {
    if (digest.isEmpty) {
      return {
        chapterTitle: digest.chapterTitle, status: 'GO',
        conflicts: [], notes: 'Chapter is empty.'
      };
    }

    const systemPrompt = `You are the continuity agent for chapter "${digest.chapterTitle}". You know EVERY detail established in your chapter. Check whether new prose for "${currentChapterTitle}" creates contradictions with your chapter.

A CONFLICT is when new prose states or implies something that CONTRADICTS a fact in your chapter:
- Physical descriptions that differ (eye color, hair, height, etc.)
- Timeline inconsistencies (events on wrong day, impossible timing)
- Location descriptions that conflict
- Character knowledge contradictions (knows something they shouldn't)
- Objects in wrong places or states
- Relationship changes that contradict your chapter

NOT a conflict:
- New information that doesn't contradict existing facts
- Character development building on your chapter
- New details about things not mentioned

Be STRICT but FAIR. Only flag genuine contradictions.

Output valid JSON only:
{
  "status": "GO" or "NO-GO",
  "conflicts": [
    {
      "severity": "critical|warning",
      "category": "character|timeline|location|plot|object|relationship|knowledge",
      "established": "<what your chapter established>",
      "contradicted": "<what the new prose says that contradicts it>",
      "suggestion": "<how to resolve>"
    }
  ],
  "notes": "<observations that aren't conflicts but worth noting>"
}`;

    const text = await this._callApi(systemPrompt,
      `YOUR CHAPTER'S FACTS:\n${JSON.stringify(digest, null, 2)}\n\nNEW PROSE (for "${currentChapterTitle}"):\n"""${newProse.slice(0, 8000)}"""`,
      { maxTokens: 2048, temperature: 0 }
    );

    const result = this._parseJson(text);
    result.chapterTitle = digest.chapterTitle;
    return result;
  }

  /**
   * Run the full GO/NO-GO launch control sequence.
   */
  async runGoNoGo(newProse, currentChapterId, chapters, currentChapterTitle) {
    if (!this.chapterAgentsEnabled) {
      this._emit('go-nogo-skipped', 'Chapter agents disabled. Skipping GO/NO-GO.');
      return { overallStatus: 'GO', results: [], skipped: true };
    }

    const otherChapters = chapters.filter(ch =>
      ch.id !== currentChapterId &&
      ch.content && ch.content.replace(/<[^>]+>/g, '').trim().length > 50
    );

    if (otherChapters.length === 0) {
      this._emit('go-nogo-skipped', 'No other chapters with content. GO by default.');
      return { overallStatus: 'GO', results: [], skipped: true };
    }

    await this.refreshAllDigests(otherChapters);

    this._emit('go-nogo-start',
      `MISSION CONTROL: Initiating GO/NO-GO. Polling ${otherChapters.length} chapter agents...`,
      { chapterCount: otherChapters.length }
    );

    const results = [];

    for (const chapter of otherChapters) {
      const digest = this._chapterDigests.get(chapter.id);

      if (!digest || digest.isEmpty) {
        results.push({
          chapterTitle: chapter.title, chapterId: chapter.id,
          status: 'GO', conflicts: [], notes: 'Empty chapter.'
        });
        this._emit('go-nogo-chapter', `  "${chapter.title}": GO (empty)`, {
          chapterId: chapter.id, status: 'GO'
        });
        continue;
      }

      this._emit('go-nogo-polling', `  Polling "${chapter.title}"...`, {
        chapterId: chapter.id
      });

      try {
        const result = await this.checkChapterConflict(newProse, digest, currentChapterTitle);
        result.chapterId = chapter.id;
        results.push(result);

        const conflictNote = result.conflicts?.length > 0
          ? ` (${result.conflicts.length} conflict${result.conflicts.length > 1 ? 's' : ''})`
          : '';
        this._emit('go-nogo-chapter', `  "${chapter.title}": ${result.status}${conflictNote}`, {
          chapterId: chapter.id, status: result.status, conflicts: result.conflicts
        });
      } catch (err) {
        results.push({
          chapterTitle: chapter.title, chapterId: chapter.id,
          status: 'GO', conflicts: [], notes: `Agent error: ${err.message}. Defaulting to GO.`
        });
        this._emit('go-nogo-chapter', `  "${chapter.title}": GO (error — defaulting)`, {
          chapterId: chapter.id, status: 'GO'
        });
      }
    }

    const noGoCount = results.filter(r => r.status === 'NO-GO').length;
    const overallStatus = noGoCount === 0 ? 'GO' : 'NO-GO';
    const allConflicts = results.flatMap(r => r.conflicts || []);

    this._emit('go-nogo-complete',
      `MISSION CONTROL: ${overallStatus} ` +
      (noGoCount === 0
        ? '- All chapters clear. Proceed.'
        : `- ${noGoCount} chapter(s) report conflicts.`),
      { overallStatus, noGoCount, totalConflicts: allConflicts.length, results }
    );

    return { overallStatus, results, allConflicts };
  }

  // ═══════════════════════════════════════════════════════════
  //  FULL PIPELINE: Orchestrate all phases (v2: Chimera)
  // ═══════════════════════════════════════════════════════════

  /**
   * Run the complete multi-agent chimera pipeline:
   *   Phase 1 → N writing agents generate in parallel
   *   Phase 2 → Paragraph-level chimera selection (NEW)
   *   Phase 3 → Transition smoothing (NEW)
   *   Phase 4 → Iterative micro-fix loop (NEW)
   *   Phase 5 → Chapter agents GO/NO-GO (unchanged)
   */
  async runFullPipeline(params) {
    const {
      systemPrompt, userPrompt, maxTokens,
      genre, voice, authorPalette, qualityThreshold,
      currentChapterId, currentChapterTitle, chapters,
      errorPatterns
    } = params;

    this._abortController = new AbortController();

    const context = {
      genre, voice, authorPalette, qualityThreshold,
      chapterTitle: currentChapterTitle,
      currentChapterTitle,
      errorPatterns: errorPatterns || []
    };

    try {
      // ============ PHASE 1: Multi-Agent Generation ============
      this._emit('pipeline', '=== PHASE 1: Multi-Agent Generation ===');

      const roster = this._buildAgentRoster(this.agentCount, authorPalette, context);

      this._logPipeline('generating', `Deploying ${roster.length} ${roster.length === 1 ? 'agent' : 'AI-selected author-voice agents'}...`);

      const candidates = await this.generateWithAgents({
        systemPrompt, userPrompt, maxTokens, roster, errorPatterns
      });

      this._logPipeline('generation-complete', `${candidates.length} of ${roster.length} agents produced candidates.`);

      if (candidates.length === 0) {
        throw new Error('All agents failed to produce candidates.');
      }

      // ============ PHASE 2: Paragraph-Level Chimera Selection ============
      this._emit('pipeline', '=== PHASE 2: Paragraph-Level Chimera Selection ===');

      const chimeraResult = await this._chimeraSelect(candidates, context);

      this._logPipeline('chimera-complete',
        `Chimera assembled via ${chimeraResult.method}. Score: ${chimeraResult.score || 'pending'}`);

      let currentProse = chimeraResult.prose;
      let currentScore = chimeraResult.score;

      // ============ PHASE 3: Transition Smoothing ============
      if (chimeraResult.method === 'paragraph-chimera' && chimeraResult.selections.length > 1) {
        this._emit('pipeline', '=== PHASE 3: Transition Smoothing ===');
        currentProse = await this._smoothTransitions(currentProse, chimeraResult.selections, context);
        this._logPipeline('smoothing-complete', 'Transitions smoothed.');
      } else {
        this._emit('pipeline', '=== PHASE 3: Skipped (no cross-agent transitions) ===');
      }

      // ============ PHASE 4: Iterative Micro-Fix Loop ============
      this._emit('pipeline', '=== PHASE 4: Iterative Micro-Fix Loop ===');

      const microFixResult = await this._iterativeMicroFix(
        currentProse, context, currentScore, 93, 3
      );

      currentProse = microFixResult.prose;
      currentScore = microFixResult.score;

      this._logPipeline('microfix-complete',
        `Final score: ${currentScore}. Fixes applied: ${microFixResult.fixesApplied.length}`);

      // ============ PHASE 5: GO/NO-GO Launch Control ============
      let goNoGoResult = { overallStatus: 'GO', results: [], skipped: true };
      if (this.chapterAgentsEnabled && chapters && chapters.length > 1) {
        this._emit('pipeline', '=== PHASE 5: GO/NO-GO Launch Control ===');
        goNoGoResult = await this.runGoNoGo(
          currentProse, currentChapterId, chapters, currentChapterTitle
        );
      } else {
        this._emit('pipeline', '=== PHASE 5: Skipped (single chapter or agents disabled) ===');
      }

      this._abortController = null;

      return {
        prose: currentProse,
        score: currentScore,
        candidates,
        chimeraMethod: chimeraResult.method,
        chimeraRationale: chimeraResult.rationale,
        fixesApplied: microFixResult.fixesApplied,
        goNoGoResult,
        wordCount: this._countWords(currentProse),
        // Legacy compatibility fields
        judgeReport: chimeraResult.judgeReport || null,
        fixPlan: null,
        winner: chimeraResult.winner || null
      };
    } catch (err) {
      this._abortController = null;
      throw err;
    }
  }
}

export { MultiAgentOrchestrator };
