/**
 * Genesis 2 — Multi-Agent Prose Orchestrator (v2.1: Anti-Detection Pipeline)
 *
 * Architecture:
 * - Writing Agents: N parallel agents (1-10) generate competing prose drafts
 * - Chimera Selection: Paragraph-level best-of selection across all agents
 * - Voice Unification: Rewrite non-dominant paragraphs in dominant voice ★ NEW
 * - Transition Smoothing: Junction sentences with continuity constraints ★ UPGRADED
 * - Adversarial Audit: Forensic AI-detection scoring ★ NEW
 * - Iterative Micro-Fix: Repair manual strategies + adversarial findings ★ UPGRADED
 * - Roughness Injection: Controlled human-like imperfections ★ NEW
 * - Chapter Agents: Per-chapter continuity guardians (GO/NO-GO)
 * - Footnote Insertion: Scholarly citation generation (conditional) ★ NEW
 * - Index Compilation: Back-of-book index (conditional) ★ NEW
 *
 * Pipeline:
 *   1.   Deploy N writing agents in parallel → N candidate drafts
 *   2.   Paragraph-level chimera selection
 *   2.5  Voice unification pass (rewrite non-native paragraphs in dominant voice)
 *   3.   Transition smoothing (with continuity digest constraints)
 *   3.5  Adversarial audit (human-likeness scoring, 0-100)
 *   4.   Iterative micro-fix loop (repair manual + adversarial fix priorities)
 *        Dual Score Gate: Quality >= 93 AND Human-Likeness >= 70 (max 2 loops)
 *   4.5  Roughness injection (controlled imperfections)
 *   5.   Chapter agents GO/NO-GO sequence
 *   6.   Footnote insertion (conditional on scholarlyApparatus.footnotesEnabled)
 *   7.   Index compilation (conditional on scholarlyApparatus.indexEnabled)
 */

import { deterministicVerification } from './verification.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

// ═══════════════════════════════════════════════════════════
//  8-AUTHOR PALETTE (Genesis 3.0)
// ═══════════════════════════════════════════════════════════
const GENESIS_AUTHOR_PALETTE = {
  'robert-caro': {
    id: 'robert-caro', name: 'Robert Caro', label: 'Architectonic Sweep',
    temperature: 0.72,
    voicePrompt: 'Architectonic panoramic sweep, psychological depth, power dynamics through institutional behavior. Write with the expansive authority of someone who has spent decades tracking how power actually works. Sentences should feel like they contain compressed years of research. Use long accumulative sentences that build toward revelations about character and power, followed by short declarative sentences that land like verdicts.'
  },
  'joan-didion': {
    id: 'joan-didion', name: 'Joan Didion', label: 'Cool Forensic Irony',
    temperature: 0.65,
    voicePrompt: 'Cool forensic irony, controlled understatement, character revealed through what is NOT said. Write with the detached precision of a reporter who notices everything and editorializes nothing. Sentences should feel polished to the point of apparent simplicity. Use short, declarative sentences that accumulate into devastating observations. Let irony emerge from juxtaposition of facts, never from commentary.'
  },
  'john-hersey': {
    id: 'john-hersey', name: 'John Hersey', label: 'Witness Accumulation',
    temperature: 0.60,
    voicePrompt: 'Witness accumulation, radical restraint, physical observations without editorializing. Write as if you were present, recording exactly what happened without judgment. Every detail is physical, concrete, observed. Never tell the reader what to feel. Let the accumulation of specific, witnessed detail do all emotional work. Sentences should be clean, direct, and unadorned.'
  },
  'ryszard-kapuscinski': {
    id: 'ryszard-kapuscinski', name: 'Ryszard Kapuściński', label: 'Visceral Panoramic',
    temperature: 0.82,
    voicePrompt: 'Visceral panoramic, sensory immersion, ground abstractions in physical sensation. Write with the immediacy of someone standing in the dust and heat. Every abstract concept must be grounded in a physical sensation — power smells like something, history has a temperature. Sentences should move between panoramic sweep and microscopic physical detail. Use present tense for immediacy when appropriate.'
  },
  'david-halberstam': {
    id: 'david-halberstam', name: 'David Halberstam', label: 'Propulsive Narrative Engine',
    temperature: 0.75,
    voicePrompt: 'Propulsive narrative engine, institutional momentum, each sentence drives forward. Write with relentless forward momentum. Every sentence should contain the seeds of the next conflict. Use the machinery of institutions — meetings, phone calls, memos, decisions — as the engine of narrative. Paragraphs should feel like they are moving inexorably toward a consequence that the characters cannot yet see.'
  },
  'erik-larson': {
    id: 'erik-larson', name: 'Erik Larson', label: 'Invisible Research',
    temperature: 0.70,
    voicePrompt: 'Invisible research embedding, novelistic flow, facts feel observed not cited. Write so that extensive research disappears into seamless narrative. The reader should feel they are watching events unfold, never reading a history book. Weave factual detail into scenes with novelistic fluidity. Use weather, light, and time of day to anchor the reader in specific moments.'
  },
  'janet-malcolm': {
    id: 'janet-malcolm', name: 'Janet Malcolm', label: 'Structural Unpredictability',
    temperature: 0.68,
    voicePrompt: 'Structural unpredictability, interrupted thought, resist smooth transitions. Write with the intellectual restlessness of someone who distrusts narrative smoothness. Interrupt your own train of thought. Let paragraphs end mid-idea and pick up from a different angle. Use digressions that turn out to be the real subject. Resist giving the reader the satisfaction of expected structure.'
  },
  'john-mcphee': {
    id: 'john-mcphee', name: 'John McPhee', label: 'Informational Digression',
    temperature: 0.70,
    voicePrompt: 'Informational digression, observational embedding, follow thoughts sideways. Write with the patient curiosity of someone who finds everything interesting. Follow tangents because they reveal something unexpected about the main subject. Embed technical information so naturally that the reader absorbs it without noticing they are learning. Use precise, specific language — the right word for every geological formation, every botanical species, every mechanical process.'
  }
};

// ═══════════════════════════════════════════════════════════
//  GENESIS 3.0 CONFIGURATION
// ═══════════════════════════════════════════════════════════
const GENESIS_3_CONFIG = {
  pipeline: {
    phases: [
      'outline_analysis', 'single_voice_generation', 'sentence_iteration',
      'deterministic_verification', 'quality_score', 'micro_fix', 'go_no_go', 'docx_export'
    ],
    disabled: [
      'multi_agent_generation', 'paragraph_chimera', 'voice_unification',
      'transition_smoothing', 'adversarial_audit_loop', 'roughness_injection'
    ]
  },
  generation: {
    agentCount: 1,
    chunkMaxWords: 750,
    temperature: 0.7,
    voiceLockPerChapter: true,
    antiKickerInstruction: true,
    antiModularInstruction: true,
    functionalSentenceInstruction: true
  },
  sentenceIteration: {
    enabled: true,
    chapterOpening: { drafts: 13, useAuthorComparisons: true },
    chapterClosing: { drafts: 13, useAuthorComparisons: true },
    sceneOpenClose: { drafts: 5 },
    emotionalBeats: { drafts: 5 },
    keyRevelations: { drafts: 5 },
    functionalTransitions: { drafts: 0 },
    expositoryConnective: { drafts: 0 }
  },
  scoring: {
    method: 'prosecution_first',
    target: 92,
    rewriteThreshold: 89,
    maxMicroFixPasses: 2,
    maxMicroFixCycles: 1,
    adversarialLoopIterations: 0
  },
  structuralLimits: {
    kickerDensityMax: 0.30,
    tricolonMaxPerChunk: 1,
    fabricatedPrecisionFlag: true,
    fourRequirementsMinPerChunk: 1
  },
  docxExport: {
    deduplicateHeadings: true,
    emDashScrub: true,
    smartQuotes: true,
    vellumCompatible: true,
    sceneBreakMarker: '* * *'
  }
};

class MultiAgentOrchestrator {
  constructor(generator, storage) {
    this.generator = generator;
    this.storage = storage;

    // Configuration
    this.agentCount = 5;
    this.chapterAgentsEnabled = true;
    // Genesis 3.0: Pipeline mode flag (true = new single-voice pipeline, false = legacy chimera)
    this.genesis3Enabled = true;
    // Genesis 3.0: Human review gate (default ON)
    this.humanReviewEnabled = true;

    // Chapter digests cache: chapterId → { contentHash, digest }
    this._chapterDigests = new Map();

    // Status callback: (phase, message, data) => void
    this._statusCallback = null;

    // Abort controller for cancellation
    this._abortController = null;

    // Pipeline log accumulator for download
    this._pipelineLog = [];

    // Human gate callback: set by the app when the user makes a decision
    this._humanGateResolve = null;
  }

  /**
   * Configure orchestrator settings.
   */
  configure({ agentCount, chapterAgentsEnabled, genesis3Enabled, humanReviewEnabled }) {
    if (agentCount !== undefined) this.agentCount = Math.max(1, Math.min(10, agentCount));
    if (chapterAgentsEnabled !== undefined) this.chapterAgentsEnabled = chapterAgentsEnabled;
    if (genesis3Enabled !== undefined) this.genesis3Enabled = genesis3Enabled;
    if (humanReviewEnabled !== undefined) this.humanReviewEnabled = humanReviewEnabled;
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

  /**
   * Add a notation entry to the pipeline log (e.g. chapter deletion events).
   */
  addLogEntry(phase, message) {
    this._pipelineLog.push({
      timestamp: new Date().toISOString(),
      phase,
      message
    });
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
    let text = result.content?.[0]?.text?.trim() || '';
    // Strip echoed prompt labels the AI may parrot back (e.g. "PROSE (517 words):")
    text = text.replace(/^\s*(?:PROSE|PASSAGE|TEXT|CONTENT)\s*[\(\[]\s*[\d,]+\s*words?\s*[\)\]]\s*:?\s*\n*/i, '');
    return text;
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
    const emDashBan = `\nABSOLUTE FORMATTING RULE: Never use em dashes (\u2014) or en dashes (\u2013) anywhere in your output. Not with spaces ( \u2014 ), not without spaces (\u2014), not as en dashes (\u2013). Instead use: commas, colons, semicolons, periods, or parentheses. This is non-negotiable. Any em dash in your output is a critical failure.\n\nDo NOT include the chapter title in your output. Begin directly with the first sentence of prose. The chapter title is handled separately by the system.\n`;
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

    return emDashBan + prompt;
  }

  /**
   * Generate prose using multiple writing agents in parallel.
   * Supports 1-10 agents via the roster builder.
   *
   * @param {Object} params - { systemPrompt, userPrompt, maxTokens, authorPalette, roster, errorPatterns }
   * @returns {Array} Array of candidate objects.
   */
  async generateWithAgents(params) {
    const { systemPrompt, userPrompt, maxTokens = 4096, roster, errorPatterns, context } = params;

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
          let text = await this._callApi(agentSystemPrompt, userPrompt, {
            maxTokens, temperature: temp
          });
          // Strip em dashes and leading chapter title from agent output
          text = this._stripEmDashes(text);
          if (context && context.currentChapterTitle) {
            text = this._stripLeadingTitle(text, context.currentChapterTitle);
          }
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
              let text = await this._callApi(agentSystemPrompt, userPrompt, {
                maxTokens, temperature: temp
              });
              // Strip em dashes and leading chapter title from retry output
              text = this._stripEmDashes(text);
              if (context && context.currentChapterTitle) {
                text = this._stripLeadingTitle(text, context.currentChapterTitle);
              }
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
   * Deterministic em-dash / en-dash stripping.
   * Runs after every agent output, after chimera assembly, after micro-fix, and after roughness injection.
   */
  _stripEmDashes(text) {
    if (!text) return text;
    // Replace spaced em/en dashes with comma
    text = text.replace(/\s*[\u2014\u2013]\s*/g, ', ');
    // Replace unspaced em/en dashes with comma-space
    text = text.replace(/[\u2014\u2013]/g, ', ');
    // Replace double/triple hyphens used as em dashes
    text = text.replace(/\s*---\s*/g, ', ');
    text = text.replace(/\s*--\s*/g, ', ');
    // Clean up any double-comma or comma-space-comma artifacts
    text = text.replace(/,\s*,/g, ',');
    // Fix existing ` ,  ` artifacts from previous bad replacements
    text = text.replace(/ ,  /g, ', ');
    // Clean up comma before other punctuation
    text = text.replace(/,\s*\./g, '.');
    text = text.replace(/,\s*!/g, '!');
    text = text.replace(/,\s*\?/g, '?');
    // Clean up any double-space artifacts
    text = text.replace(/  +/g, ' ');
    return text;
  }

  /**
   * Strip the chapter title from an agent's output if it appears as the first paragraph.
   */
  _stripLeadingTitle(agentOutput, chapterTitle) {
    if (!agentOutput || !chapterTitle) return agentOutput;
    const lines = agentOutput.split('\n').filter(l => l.trim());
    if (lines.length > 0) {
      const firstLine = lines[0].trim().replace(/^#+\s*/, ''); // strip markdown heading marks
      const titleNormalized = chapterTitle.trim().toLowerCase();
      const lineNormalized = firstLine.toLowerCase();
      if (lineNormalized === titleNormalized ||
          lineNormalized.includes(titleNormalized) ||
          titleNormalized.includes(lineNormalized)) {
        lines.shift();
      }
    }
    return lines.join('\n');
  }

  /**
   * Deduplicate adjacent paragraphs in chimera output using Jaccard similarity.
   * Removes near-duplicate paragraphs (>50% word overlap) keeping the first.
   */
  _deduplicateChimera(prose) {
    if (!prose) return prose;
    const paragraphs = this._segmentParagraphs(prose);
    if (paragraphs.length < 2) return prose;

    const deduped = [paragraphs[0]];
    for (let i = 1; i < paragraphs.length; i++) {
      const similarity = this._jaccardSimilarity(paragraphs[i - 1], paragraphs[i]);
      if (similarity > 0.5) {
        this._logPipeline('chimera-dedup',
          `Duplicate detected: P${i} and P${i + 1} have ${(similarity * 100).toFixed(0)}% overlap. Removing P${i + 1}.`);
      } else {
        deduped.push(paragraphs[i]);
      }
    }
    return deduped.join('\n\n');
  }

  /**
   * Compute Jaccard similarity between two text strings (word-level).
   */
  _jaccardSimilarity(textA, textB) {
    const wordsA = new Set(textA.toLowerCase().split(/\s+/).filter(w => w.length > 0));
    const wordsB = new Set(textB.toLowerCase().split(/\s+/).filter(w => w.length > 0));
    let intersection = 0;
    for (const w of wordsA) {
      if (wordsB.has(w)) intersection++;
    }
    const union = wordsA.size + wordsB.size - intersection;
    return union === 0 ? 0 : intersection / union;
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
      { winnerId: winner.agentId, winnerLabel: winner.label || '', winnerName: winner.name || '', report }
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

    // Build continuity digest context if available
    let continuityContext = '';
    if (context.chapterDigest) {
      continuityContext = `\n\nCHAPTER CONTINUITY DIGEST:\n${JSON.stringify(context.chapterDigest, null, 2)}\n`;
    }

    const systemPrompt = `You are a prose transition specialist smoothing transitions between paragraphs from different author-agents in a chimera assembly. Your goal is seamless reading flow.

ABSOLUTE CONSTRAINTS:
- You may ONLY modify sentence structure, word choice, clause order, and connecting phrases.
- You may NOT introduce any new factual claims, attributions, dates, numbers, character motivations, or historical assertions.
- You may NOT remove established facts.
- You may NOT contradict any information in the CHAPTER CONTINUITY DIGEST provided below.
- If a smooth transition REQUIRES new factual content to work, output: "[TRANSITION FLAG: Needs factual bridge — user review required]" and leave the transition as-is.
${continuityContext}
PERMITTED OPERATIONS:
- Reorder clauses within a sentence
- Change descriptors using ONLY information already present in the text
- Add a subordinate clause using ONLY information already present in the preceding or following paragraph
- Adjust tense or aspect for flow
- Replace a period with a semicolon or comma to merge sentences

FORBIDDEN OPERATIONS:
- Adding characterization not present in source paragraphs
- Adding motivation not present in source paragraphs
- Adding historical claims not present in source paragraphs
- Inventing dialogue or quotations
- Adding dates, numbers, or proper nouns not already in the text

YOUR TASK: Smooth the flagged transitions by modifying ONLY:
- The LAST sentence of the preceding paragraph, AND/OR
- The FIRST sentence of the following paragraph

=== RULES ===
1. Change NO MORE than 2 sentences total per transition
2. Preserve the quality, voice, and content of both paragraphs
3. Do NOT change any sentence that is NOT at a transition junction
4. The goal is seamlessness — a reader should not notice the author change
5. Return the COMPLETE passage with smoothed transitions
6. Word count must stay within 5% of the input
7. After the passage, add a line "---SMOOTHING_LOG---" followed by a brief note on what you changed at each transition (1 line per transition)`;

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
    const hasAdversarialFixes = !!(context.adversarialFixPriorities && context.adversarialFixPriorities.length > 0);
    const qualityFloor = targetScore - 3; // Allow small quality dip when fixing adversarial issues

    // If we don't have a score yet, get one
    if (score === null || score === undefined) {
      score = await this._quickScore(currentProse, context);
      this._logPipeline('microfix', `Initial score: ${score}`);
    }

    for (let pass = 0; pass < maxPasses; pass++) {
      if (score >= targetScore && !hasAdversarialFixes) {
        this._logPipeline('microfix', `Score ${score} >= target ${targetScore}. Stopping.`);
        break;
      }

      if (score >= targetScore && hasAdversarialFixes) {
        this._logPipeline('microfix', `Score ${score} >= target ${targetScore}, but adversarial fixes pending. Continuing in adversarial-fix mode.`);
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

      // Step 3: Validate word count — allow higher drift for structural fixes
      const originalWords = this._countWords(currentProse);
      const fixedWords = this._countWords(fixedProse);
      const drift = Math.abs(fixedWords - originalWords) / originalWords;
      const structuralCategories = ['weak-imagery', 'near-duplicate', 'duplicate', 'structural', 'paragraph-removal'];
      const isStructural = structuralCategories.includes(diagnosis.category) ||
        (diagnosis.diagnosis && /duplicate|near.identical|redundant/i.test(diagnosis.diagnosis));
      const driftLimit = isStructural ? 0.25 : 0.09;

      if (drift > driftLimit) {
        this._logPipeline('microfix', `Pass ${pass + 1}: Fix caused ${Math.round(drift * 100)}% word drift (limit: ${Math.round(driftLimit * 100)}%). Rejecting.`);
        continue;
      }

      // Step 4: Re-score
      const newScore = await this._quickScore(fixedProse, context);

      // In adversarial-fix mode: accept fixes that maintain quality above floor
      if (hasAdversarialFixes && score >= targetScore) {
        if (newScore >= qualityFloor) {
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
          this._logPipeline('microfix', `Pass ${pass + 1} (adversarial): Score ${score - delta} -> ${score}. Fix accepted (floor: ${qualityFloor}).`);
        } else {
          this._logPipeline('microfix', `Pass ${pass + 1} (adversarial): Score dropped ${score} -> ${newScore} below floor ${qualityFloor}. Fix rejected.`);
        }
      } else if (newScore >= score) {
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
    const repairManual = this._buildRepairManualPrompt();

    const systemPrompt = `You are a surgical prose editor. Fix EXACTLY ONE weakness in this passage.

THE WEAKNESS:
Exact text: "${diagnosis.text || ''}"
Category: ${diagnosis.category}
Diagnosis: ${diagnosis.diagnosis}
Suggested approach: ${diagnosis.suggestedApproach || 'Rewrite to avoid the identified pattern'}

${repairManual}

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
7. If you cannot fix this without introducing new problems, return the original unchanged
8. State which repair strategy letter you used at the end, after a "---STRATEGY---" marker`;

    const response = await this._callApi(systemPrompt, `PROSE (${this._countWords(prose)} words):\n\n${prose}`, {
      temperature: 0.35,
      maxTokens: 2000
    });

    // Strip strategy markers from output before returning
    let cleaned = response.trim();
    const strategyIdx = cleaned.indexOf('---STRATEGY---');
    if (strategyIdx !== -1) {
      cleaned = cleaned.substring(0, strategyIdx).trim();
    }
    return cleaned;
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

    // Genesis 3.0: Cross-chapter structural variance check
    // Flag if the new chapter's structural approach matches the previous chapter
    const structuralFlags = [];
    if (otherChapters.length > 0) {
      const prevChapter = otherChapters[otherChapters.length - 1];
      const prevContent = (prevChapter.content || '').replace(/<[^>]+>/g, '');
      const newContent = newProse.replace(/<[^>]+>/g, '');

      // Check opening similarity: both start with scene, or both start with exposition
      const sceneOpeners = /^(?:The |He |She |It was |On |In |At |When |As )/;
      const contextOpeners = /^(?:By |For |Since |After |Before |Throughout |During |Between )/;
      const prevOpening = prevContent.trim().substring(0, 100);
      const newOpening = newContent.trim().substring(0, 100);

      if (sceneOpeners.test(prevOpening) && sceneOpeners.test(newOpening)) {
        structuralFlags.push('Both this chapter and the previous chapter open with a scene. Consider varying the structural approach.');
      }
      if (contextOpeners.test(prevOpening) && contextOpeners.test(newOpening)) {
        structuralFlags.push('Both this chapter and the previous chapter open with context/exposition. Consider varying the structural approach.');
      }
    }

    if (structuralFlags.length > 0) {
      for (const flag of structuralFlags) {
        this._emit('go-nogo-chapter', `  STRUCTURAL FLAG: ${flag}`, { type: 'structural-variance' });
      }
    }

    const noGoCount = results.filter(r => r.status === 'NO-GO').length;
    const overallStatus = noGoCount === 0 ? 'GO' : 'NO-GO';
    const allConflicts = results.flatMap(r => r.conflicts || []);

    this._emit('go-nogo-complete',
      `MISSION CONTROL: ${overallStatus} ` +
      (noGoCount === 0
        ? '- All chapters clear. Proceed.'
        : `- ${noGoCount} chapter(s) report conflicts.`) +
      (structuralFlags.length > 0 ? ` (${structuralFlags.length} structural flag(s))` : ''),
      { overallStatus, noGoCount, totalConflicts: allConflicts.length, results, structuralFlags }
    );

    return { overallStatus, results, allConflicts, structuralFlags };
  }

  // ═══════════════════════════════════════════════════════════
  //  FULL PIPELINE: Orchestrate all phases (v2: Chimera)
  // ═══════════════════════════════════════════════════════════

  /**
   * Run the complete multi-agent chimera pipeline (v2.1):
   *   Phase 1   → N writing agents generate in parallel
   *   Phase 2   → Paragraph-level chimera selection
   *   Phase 2.5 → Voice unification pass ★ NEW
   *   Phase 3   → Transition smoothing (UPGRADED — continuity digest)
   *   Phase 3.5 → Adversarial audit ★ NEW
   *   Phase 4   → Iterative micro-fix loop (UPGRADED — repair manual + adversarial findings)
   *   Phase 4.5 → Roughness injection ★ NEW
   *   Phase 5   → Chapter agents GO/NO-GO
   *   Phase 6   → Footnote insertion ★ NEW (conditional)
   *   Phase 7   → Index compilation ★ NEW (conditional)
   *
   * Dual Score Gate: Quality >= 93 AND Human-Likeness >= 70
   */
  async runFullPipeline(params) {
    const {
      systemPrompt, userPrompt, maxTokens,
      genre, voice, authorPalette, qualityThreshold,
      currentChapterId, currentChapterTitle, chapters,
      errorPatterns, scholarlyApparatus
    } = params;

    this._abortController = new AbortController();

    const context = {
      genre, voice, authorPalette, qualityThreshold,
      chapterTitle: currentChapterTitle,
      currentChapterTitle,
      errorPatterns: errorPatterns || [],
      scholarlyApparatus: scholarlyApparatus || {}
    };

    try {
      // ============ PHASE 1: Multi-Agent Generation ============
      this._emit('pipeline', '=== PHASE 1: Multi-Agent Generation ===');

      // Inject kicker budget into the system prompt
      // NOTE: Source specificity prompt is NO LONGER injected into prose generation.
      // It was causing AI detection failures by adding fake archival references inline.
      // Source specificity is now only used during footnote generation (Phase 6).
      let augmentedSystemPrompt = systemPrompt;
      augmentedSystemPrompt += this._buildKickerBudgetPrompt();

      const roster = this._buildAgentRoster(this.agentCount, authorPalette, context);

      this._logPipeline('generating', `Deploying ${roster.length} ${roster.length === 1 ? 'agent' : 'AI-selected author-voice agents'}...`);

      const candidates = await this.generateWithAgents({
        systemPrompt: augmentedSystemPrompt, userPrompt, maxTokens, roster, errorPatterns, context
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

      // Post-chimera: deduplicate adjacent near-identical paragraphs
      currentProse = this._deduplicateChimera(currentProse);
      // Post-chimera: strip any em dashes that survived
      currentProse = this._stripEmDashes(currentProse);

      // ============ PHASE 2.5: Voice Unification Pass ============
      if (chimeraResult.method === 'paragraph-chimera' && chimeraResult.selections.length > 1) {
        this._emit('pipeline', '=== PHASE 2.5: Voice Unification Pass ===');
        currentProse = await this._voiceUnify(currentProse, chimeraResult.selections, context);
        this._logPipeline('voice-unify-complete', 'Voice unification complete.');
      } else {
        this._emit('pipeline', '=== PHASE 2.5: Skipped (single voice) ===');
      }

      // ============ PHASE 3: Transition Smoothing ============
      if (chimeraResult.method === 'paragraph-chimera' && chimeraResult.selections.length > 1) {
        this._emit('pipeline', '=== PHASE 3: Transition Smoothing ===');

        // Build continuity digest for the transition smoother if chapter agents are enabled
        if (this.chapterAgentsEnabled && chapters && chapters.length > 1) {
          try {
            const otherChapters = chapters.filter(ch =>
              ch.id !== currentChapterId &&
              ch.content && ch.content.replace(/<[^>]+>/g, '').trim().length > 50
            );
            if (otherChapters.length > 0) {
              await this.refreshAllDigests(otherChapters);
              // Merge all digests into a combined context
              const allFacts = [];
              for (const ch of otherChapters) {
                const digest = this._chapterDigests.get(ch.id);
                if (digest && !digest.isEmpty) {
                  allFacts.push(...(digest.establishedFacts || []));
                }
              }
              if (allFacts.length > 0) {
                context.chapterDigest = { establishedFacts: allFacts };
              }
            }
          } catch (_) {
            // Continue without digest if it fails
          }
        }

        currentProse = await this._smoothTransitions(currentProse, chimeraResult.selections, context);
        this._logPipeline('smoothing-complete', 'Transitions smoothed.');
      } else {
        this._emit('pipeline', '=== PHASE 3: Skipped (no cross-agent transitions) ===');
      }

      // ============ PHASE 3.5: Adversarial Audit ============
      this._emit('pipeline', '=== PHASE 3.5: Adversarial Audit ===');
      const auditResult = await this._adversarialAudit(currentProse, context);
      let humanLikenessScore = auditResult.humanLikenessScore || 75;

      // ============ PHASE 4: Iterative Micro-Fix Loop (with Dual Score Gate) ============
      this._emit('pipeline', '=== PHASE 4: Iterative Micro-Fix Loop ===');

      // If adversarial audit failed, prepend its fix priorities to the micro-fix context
      if (humanLikenessScore < 70 && auditResult.topThreeFixPriorities) {
        context.adversarialFixPriorities = auditResult.topThreeFixPriorities;
        this._logPipeline('microfix', `Adversarial findings prepended: ${auditResult.topThreeFixPriorities.length} priority fixes.`);
      }

      const microFixResult = await this._iterativeMicroFix(
        currentProse, context, currentScore, qualityThreshold || 93, 2
      );

      currentProse = this._stripEmDashes(microFixResult.prose);
      currentScore = microFixResult.score;

      this._logPipeline('microfix-complete',
        `Final quality score: ${currentScore}. Fixes applied: ${microFixResult.fixesApplied.length}`);

      // Dual Score Gate: loop back if either gate fails (max 3 iterations)
      let dualGateIterations = 0;
      const maxDualGateLoops = 2;
      while (dualGateIterations < maxDualGateLoops) {
        const qualityPass = currentScore >= (qualityThreshold || 93);
        const humanPass = humanLikenessScore >= 70;

        if (qualityPass && humanPass) {
          this._logPipeline('dual-gate', `DUAL GATE: PASS. Quality: ${currentScore} >= ${qualityThreshold || 93}, Human-Likeness: ${humanLikenessScore} >= 70.`);
          break;
        }

        dualGateIterations++;
        this._logPipeline('dual-gate', `DUAL GATE: FAIL (iteration ${dualGateIterations}/${maxDualGateLoops}). Quality: ${currentScore}, Human-Likeness: ${humanLikenessScore}. Looping back to micro-fix.`);

        // Re-run adversarial audit to get fresh findings
        const reAudit = await this._adversarialAudit(currentProse, context);
        humanLikenessScore = reAudit.humanLikenessScore || humanLikenessScore;

        if (reAudit.topThreeFixPriorities) {
          context.adversarialFixPriorities = reAudit.topThreeFixPriorities;
        }

        const reFixResult = await this._iterativeMicroFix(
          currentProse, context, currentScore, qualityThreshold || 93, 2
        );
        currentProse = this._stripEmDashes(reFixResult.prose);
        currentScore = reFixResult.score;
      }

      if (dualGateIterations >= maxDualGateLoops) {
        this._logPipeline('dual-gate', `DUAL GATE: Max iterations reached. Flagging for user review. Quality: ${currentScore}, Human-Likeness: ${humanLikenessScore}`);
      }

      // ============ PHASE 4.5: Roughness Injection ============
      this._emit('pipeline', '=== PHASE 4.5: Roughness Injection ===');
      currentProse = await this._roughnessInjection(currentProse, context);
      currentProse = this._stripEmDashes(currentProse);
      this._logPipeline('roughness-complete', 'Roughness injection complete.');

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

      // ============ PHASE 6: Footnote Insertion (conditional) ============
      let footnoteResult = { prose: currentProse, footnotes: [], endnotes: [] };
      if (scholarlyApparatus && scholarlyApparatus.footnotesEnabled) {
        this._emit('pipeline', '=== PHASE 6: Footnote Insertion ===');
        footnoteResult = await this._generateFootnotes(currentProse, context);
        currentProse = footnoteResult.prose;
        this._logPipeline('footnotes-complete', `Generated ${footnoteResult.footnotes.length} footnotes.`);
      } else {
        this._emit('pipeline', '=== PHASE 6: Skipped (footnotes disabled) ===');
      }

      // ============ PHASE 7: Index Compilation (conditional) ============
      let indexResult = { entries: [], type: null };
      if (scholarlyApparatus && scholarlyApparatus.indexEnabled) {
        this._emit('pipeline', '=== PHASE 7: Index Compilation ===');
        indexResult = await this._compileIndex(currentProse, context);
        this._logPipeline('index-complete', `Compiled ${indexResult.entries.length} index entries.`);
      } else {
        this._emit('pipeline', '=== PHASE 7: Skipped (index disabled) ===');
      }

      this._abortController = null;

      return {
        prose: currentProse,
        score: currentScore,
        humanLikenessScore,
        candidates,
        chimeraMethod: chimeraResult.method,
        chimeraRationale: chimeraResult.rationale,
        fixesApplied: microFixResult.fixesApplied,
        goNoGoResult,
        auditResult,
        footnoteResult,
        indexResult,
        wordCount: this._countWords(currentProse),
        dualGateIterations,
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

  // ═══════════════════════════════════════════════════════════
  //  SOURCE SPECIFICITY MODE — PROMPT INJECTION
  // ═══════════════════════════════════════════════════════════

  /**
   * Build the source specificity prompt addition when mode is active.
   */
  _buildSourceSpecificityPrompt(scholarlyApparatus) {
    if (!scholarlyApparatus || !scholarlyApparatus.sourceSpecificityMode) return '';

    return `

=== SOURCE ATTRIBUTION RULES (Source Specificity Mode Active) ===

NEVER use vague attributions. Every factual claim attributed to a source
MUST include at least TWO of the following:
  - A specific date (month/day/year or at minimum month/year)
  - A document type with identifying detail (e.g., "memo to Sorensen dated March 4, 1924")
  - A page number or page range
  - An archival collection reference (e.g., "Box 14, Acc. 285, Benson Ford Research Center")
  - A publication with volume/issue/page

BANNED ATTRIBUTION PATTERNS (zero tolerance when Source Specificity is on):
  - "according to one account"
  - "contemporary accounts suggest"
  - "correspondence from the period"
  - "sources indicate"
  - "as one [role] later recalled"
  - "records from that era show"
  - Any attribution that a reader cannot independently verify

If the source material does not provide specific attribution data,
state the fact WITHOUT attribution rather than inventing soft anchoring.
Better to say "Ford visited the Rouge plant in January" than
"according to contemporary accounts, Ford visited the Rouge plant."

=== END SOURCE ATTRIBUTION RULES ===`;
  }

  // ═══════════════════════════════════════════════════════════
  //  KICKER BUDGET — PROMPT INJECTION
  // ═══════════════════════════════════════════════════════════

  /**
   * Build the kicker budget prompt addition for all generation agents.
   */
  _buildKickerBudgetPrompt() {
    return `

=== KICKER BUDGET ===
Maximum 2 paragraphs per chunk (750 words) may end on a deliberately resonant,
ironic, or dramatic note. All other paragraphs MUST end in one of these ways:
  - Mid-thought, with the next paragraph continuing the idea
  - On a plain factual statement with no ironic subtext
  - With a clause that propels forward ("which meant that..." /
    "a decision that would take another three months to resolve")
  - On a quotation that is informational rather than thematic

A "kicker" is defined as: a short sentence (under 15 words) that closes
a paragraph with deliberate resonance, irony, understatement, or thematic
weight. Examples of kickers to avoid overusing:
  - "He did not specify which people he meant."
  - "It also came in blue."
  - "Ford did not retract it."
  - "He kept his eyes on the gears."

ADDITIONAL RULE: No two consecutive paragraphs may BOTH end on kickers.
At least one "pass-through" paragraph must separate any two kicker endings.
=== END KICKER BUDGET ===`;
  }

  // ═══════════════════════════════════════════════════════════
  //  PHASE 2.5: VOICE UNIFICATION PASS
  // ═══════════════════════════════════════════════════════════

  /**
   * Unify the voice of a chimera assembly by rewriting non-dominant-voice
   * paragraphs in the dominant voice.
   */
  async _voiceUnify(prose, selections, context) {
    if (!selections || selections.length === 0) {
      this._logPipeline('voice-unify', 'No selection log available. Skipping voice unification.');
      return prose;
    }

    // Count paragraphs per agent to find the dominant voice
    const agentCounts = {};
    for (const sel of selections) {
      agentCounts[sel.agent] = (agentCounts[sel.agent] || 0) + 1;
    }

    // Find dominant voice
    let dominantAgent = null;
    let maxCount = 0;
    for (const [agent, count] of Object.entries(agentCounts)) {
      if (count > maxCount) {
        maxCount = count;
        dominantAgent = agent;
      } else if (count === maxCount) {
        // Tie-break: prefer agent with opening or closing paragraph
        const firstAgent = selections[0]?.agent;
        const lastAgent = selections[selections.length - 1]?.agent;
        if (agent === firstAgent || agent === lastAgent) {
          dominantAgent = agent;
        }
      }
    }

    if (!dominantAgent) {
      this._logPipeline('voice-unify', 'Could not determine dominant voice. Skipping.');
      return prose;
    }

    // Find non-native paragraphs
    const nonNative = selections.filter(s => s.agent !== dominantAgent);

    if (nonNative.length === 0) {
      this._logPipeline('voice-unify', `All paragraphs from ${dominantAgent}. No unification needed.`);
      return prose;
    }

    this._logPipeline('voice-unify',
      `Dominant voice: ${dominantAgent} — ${maxCount} of ${selections.length} paragraphs`);

    // Find the dominant agent's voice prompt from the author palette
    let dominantVoice = '';
    if (context.authorPalette && typeof context.authorPalette === 'object' && context.authorPalette.authors) {
      const author = context.authorPalette.authors.find(a => a.name === dominantAgent);
      if (author) {
        dominantVoice = author.voicePrompt || '';
      }
    }

    const paragraphs = this._segmentParagraphs(prose);
    let modified = false;
    let unifiedParagraphs = [...paragraphs];

    for (const sel of nonNative) {
      const idx = sel.position - 1;
      if (idx < 0 || idx >= paragraphs.length) continue;

      this._logPipeline('voice-unify', `Rewriting P${sel.position} (was: ${sel.agent}) in ${dominantAgent} voice...`);

      const preceding = idx > 0 ? paragraphs[idx - 1] : '';
      const following = idx < paragraphs.length - 1 ? paragraphs[idx + 1] : '';

      const systemPrompt = `You are ${dominantAgent}. Rewrite the following paragraph to match your voice and style. Preserve ALL factual content, proper nouns, dates, numbers, and quotations exactly. Change ONLY: sentence structure, word choice, rhythm, and cadence. Do not add or remove information.

${dominantVoice ? `YOUR VOICE:\n${dominantVoice}\n` : ''}
CONTEXT (for flow — do NOT rewrite these):
${preceding ? `PRECEDING PARAGRAPH:\n${preceding}\n` : ''}
${following ? `FOLLOWING PARAGRAPH:\n${following}\n` : ''}

Return ONLY the rewritten paragraph. No preamble, no explanation.`;

      try {
        const rewritten = await this._callApi(systemPrompt,
          `Rewrite this paragraph in your voice:\n\n${paragraphs[idx]}`,
          { temperature: 0.4, maxTokens: 1000 }
        );

        if (rewritten && rewritten.trim().length > 20) {
          unifiedParagraphs[idx] = rewritten.trim();
          modified = true;
        }
      } catch (err) {
        this._logPipeline('voice-unify', `Failed to rewrite P${sel.position}: ${err.message}`);
      }
    }

    if (!modified) {
      this._logPipeline('voice-unify', 'No paragraphs were modified. Keeping original.');
      return prose;
    }

    const unifiedProse = unifiedParagraphs.join('\n\n');

    // Score the unified version vs the original
    const originalScore = await this._quickScore(prose, context);
    const unifiedScore = await this._quickScore(unifiedProse, context);

    if (unifiedScore >= originalScore - 2) {
      this._logPipeline('voice-unify', `Unified chimera score: ${unifiedScore} (was ${originalScore}). Accepted.`);
      return unifiedProse;
    } else {
      this._logPipeline('voice-unify', `Unified score ${unifiedScore} dropped > 2 from ${originalScore}. Keeping original, flagging for review.`);
      return prose;
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  PHASE 3.5: ADVERSARIAL AUDIT
  // ═══════════════════════════════════════════════════════════

  /**
   * Adversarial audit pass that evaluates prose for AI-detection signals.
   * Returns a humanLikenessScore (0-100) and fix priorities.
   */
  async _adversarialAudit(prose, context) {
    this._logPipeline('adversarial', 'Running adversarial audit...');

    // Build the error pattern database section for injection
    let patternDbSection = '';
    if (context.errorPatterns && context.errorPatterns.length > 0) {
      const patterns = context.errorPatterns
        .filter(p => !p.dismissed)
        .slice(0, 38);
      patternDbSection = patterns.map(p =>
        `- [${p.category}] "${(p.text || '').substring(0, 60)}" — ${p.problem || p.category}`
      ).join('\n');
    }

    const systemPrompt = `ROLE: You are a forensic literary analyst hired by a major publishing house to determine whether a submitted manuscript was written by an experienced human author or generated by AI. You are adversarial — your job is to find every possible AI signal. You are not evaluating quality. Quality can be high and still be detectably AI.

Score the following prose on a 0-100 HUMAN-LIKENESS scale where:
  100 = Certainly written by an experienced human author
  75  = Probably human, minor concerns
  50  = Could go either way
  25  = Probably AI-generated or AI-assisted
  0   = Certainly AI-generated

EVALUATE THESE DIMENSIONS (score each 0-10, then compute weighted total):

1. ATTRIBUTION AUTHENTICITY (weight: 15%)
   Are source citations specific and auditable (dates, page numbers, archival box numbers, document identifiers)? Or are they vaguely plausible ("according to one account," "correspondence from the period")?
   - Each vague/soft attribution: -2 from this dimension
   - Specific, verifiable attributions: +1 each (max 10)

2. CADENCE NATURALNESS (weight: 15%)
   Is sentence rhythm varied organically, or consistently cinematic?
   Measure:
   - Paragraph length variance (standard deviation)
   - Sentence length variance within paragraphs
   - If paragraph length SD < 20 words: score <= 4
   - If all paragraphs are 50-80 words: score <= 3
   - Genuinely uneven paragraph lengths (30, 95, 45, 120, 15): score >= 8

3. KICKER DENSITY (weight: 15%)
   What percentage of paragraphs end on a deliberately resonant, ironic, or dramatic note?
   - Above 60%: score <= 2
   - Above 40%: score <= 5
   - 20-30%: score 7-8 (normal human range)
   - Below 20%: score 9-10

4. VOICE CONSISTENCY (weight: 15%)
   Does the prose read as one author's voice throughout?
   - Detectable register shifts between paragraphs: -2 each
   - Consistent voice with natural variation: score 8-10
   - "Committee prose" feel (competent everywhere, distinctive nowhere): score <= 4

5. PATTERN DENSITY (weight: 15%)
   Check against the KNOWN AI PATTERN DATABASE below. Count instances:
${patternDbSection || '(No project-specific patterns available — use general AI pattern knowledge)'}
   Scoring:
   - 0-2 patterns found: score 9-10
   - 3-5 patterns: score 6-8
   - 6-10 patterns: score 3-5
   - 11+ patterns: score <= 2

6. HUMAN ARTIFACTS (weight: 10%)
   Does the prose contain signals of human drafting?
   Positive signals (each found adds +1):
   - A slightly awkward transition that works but could be smoother
   - One sentence that runs longer than ideal
   - A citation more specific than strictly necessary
   - Asymmetric paragraph lengths
   - A factual aside that's interesting but not perfectly integrated
   - One instance of slightly elevated or slightly flat register
   If zero human artifacts found: score <= 3 (too clean = AI signal)

7. STRUCTURAL OSCILLATION (weight: 15%)
   Does the text alternate mechanically between analytical passages and dramatic scenes?
   - Metronomic A-B-A-B alternation: score <= 3
   - Organic, unpredictable structure: score 8-10
   - Occasionally predictable but not mechanical: score 5-7

OUTPUT FORMAT:
Return ONLY valid JSON, no markdown, no backticks:
{
  "humanLikenessScore": 72,
  "dimensionScores": {
    "attributionAuthenticity": { "score": 4, "findings": ["..."] },
    "cadenceNaturalness": { "score": 5, "findings": ["..."] },
    "kickerDensity": { "score": 3, "findings": ["..."] },
    "voiceConsistency": { "score": 6, "findings": ["..."] },
    "patternDensity": { "score": 5, "findings": ["..."] },
    "humanArtifacts": { "score": 2, "findings": ["..."] },
    "structuralOscillation": { "score": 6, "findings": ["..."] }
  },
  "topThreeFixPriorities": [
    { "dimension": "...", "specificFinding": "...", "suggestedFix": "..." },
    { "dimension": "...", "specificFinding": "...", "suggestedFix": "..." },
    { "dimension": "...", "specificFinding": "...", "suggestedFix": "..." }
  ]
}

Be STRICT. Real human nonfiction scores 80-95. AI prose typically scores 40-70.`;

    const response = await this._callApi(systemPrompt, `PROSE TO AUDIT:\n\n${prose}`, {
      temperature: 0.15,
      maxTokens: 2000
    });

    let result = this._parseJSON(response);

    if (!result || typeof result.humanLikenessScore !== 'number') {
      // Retry once before defaulting
      this._logPipeline('adversarial', 'Failed to parse adversarial audit result. Retrying...');
      try {
        const retryResponse = await this._callApi(systemPrompt, `PROSE TO AUDIT:\n\n${prose}`, {
          temperature: 0.15,
          maxTokens: 2000
        });
        result = this._parseJSON(retryResponse);
      } catch (_) {
        result = null;
      }

      if (!result || typeof result.humanLikenessScore !== 'number') {
        // Use last known adversarial score if available, otherwise default to 75
        const fallbackScore = this._lastAdversarialScore || 75;
        this._logPipeline('adversarial', `Retry also failed. Using fallback score: ${fallbackScore}.`);
        return {
          humanLikenessScore: fallbackScore,
          dimensionScores: {},
          topThreeFixPriorities: [],
          parseError: true
        };
      }
    }

    // Store successful score for fallback in case of future parse failures
    this._lastAdversarialScore = result.humanLikenessScore;

    // Log results
    this._logPipeline('adversarial', `Human-Likeness Score: ${result.humanLikenessScore}`);
    if (result.dimensionScores) {
      for (const [dim, data] of Object.entries(result.dimensionScores)) {
        const score = typeof data === 'object' ? data.score : data;
        const findings = typeof data === 'object' && data.findings ? data.findings.join('; ') : '';
        this._logPipeline('adversarial', `  ${dim}: ${score}/10${findings ? ' — ' + findings.substring(0, 100) : ''}`);
      }
    }

    if (result.humanLikenessScore >= 70) {
      this._logPipeline('adversarial', `GATE: PASS (${result.humanLikenessScore} >= 70).`);
    } else {
      this._logPipeline('adversarial', `GATE: FAIL (${result.humanLikenessScore} < 70). Routing top 3 fixes to micro-fix loop.`);
      if (result.topThreeFixPriorities) {
        result.topThreeFixPriorities.forEach((fix, i) => {
          this._logPipeline('adversarial', `  Priority ${i + 1}: ${fix.dimension} — ${fix.specificFinding}`);
        });
      }
    }

    return result;
  }

  // ═══════════════════════════════════════════════════════════
  //  PHASE 4 ENHANCEMENT: MICRO-FIX REPAIR MANUAL
  // ═══════════════════════════════════════════════════════════

  /**
   * Build the repair manual prompt section for the micro-fix agent.
   */
  _buildRepairManualPrompt() {
    return `
REPAIR STRATEGIES — When fixing an identified pattern, use ONLY these strategies:

TRICOLON (three-item lists/structures):
  Strategy A: Reduce to two items. Delete the weakest of the three.
  Strategy B: Expand to four or more items, breaking the rhythmic pattern.
  Strategy C: Collapse into a single compound sentence with subordinate clauses.
  Strategy D: Keep three items but vary their grammatical structure (noun phrase, then clause, then single word).
  NEVER: Replace a tricolon with a different tricolon.

DRAMATIC KICKER (resonant/ironic paragraph-ending sentence):
  Strategy A: Delete the kicker entirely. Let the preceding sentence end the paragraph. Often the kicker is redundant.
  Strategy B: Move the kicker content to the MIDDLE of the next paragraph, where it becomes a bridge rather than a landing.
  Strategy C: Replace with a continuation clause that propels into the next paragraph (e.g., change period to comma or semicolon and add forward momentum).
  Strategy D: Convert to a plain factual statement. Strip the irony/resonance. Sometimes "He signed the papers on March 4" is better than "He signed the papers. He did not enjoy signing them."
  NEVER: Replace one kicker with a differently-worded kicker.

FORMULAIC STRUCTURE (data -> pivot -> dramatic reversal):
  Strategy A: Reorder. Start with the reversal, then backfill context.
  Strategy B: Embed the pivot mid-paragraph rather than at a boundary.
  Strategy C: Remove the pivot entirely. Let the data speak and trust the reader to notice the tension.
  Strategy D: Split into two paragraphs with different content between the data and the reversal.
  NEVER: Rewrite a pivot sentence with a differently-worded pivot.

RHETORICAL PARALLELISM (repeated grammatical structures):
  Strategy A: Vary the grammar. If you have "He did X. He did Y. He did Z," change to "He did X. The Y happened on its own. As for Z, that required a different kind of attention."
  Strategy B: Subordinate one element: "He did X, and because of that, Y followed, though Z proved harder."
  Strategy C: Break with a parenthetical or aside between parallel elements.
  NEVER: Replace parallel structure with different parallel structure.

SOFT ATTRIBUTION:
  Strategy A: Add specificity — date, document ID, page number, archive box.
  Strategy B: Remove the attribution entirely. State the fact directly.
  Strategy C: Attribute to a named person with a specific context: "Sorensen told interviewers in 1956" not "one executive later recalled."
  NEVER: Replace one vague attribution with a differently-worded vague attribution.

TELLING VS SHOWING:
  Strategy A: Replace the emotional label with a physical action or gesture that is NOT a stock image (NOT "looked at the floor" or "clenched his fists" — those are stock).
  Strategy B: Delete the telling sentence. If the scene is well-written, the emotion is already implicit.
  Strategy C: Convert to dialogue that reveals the emotion indirectly.
  NEVER: Replace one telling statement with another telling statement using different emotion words.

For EACH fix you apply, state which strategy letter you are using.`;
  }

  // ═══════════════════════════════════════════════════════════
  //  PHASE 4.5: ROUGHNESS INJECTION
  // ═══════════════════════════════════════════════════════════

  /**
   * Inject controlled imperfections that mimic natural human writing.
   */
  async _roughnessInjection(prose, context) {
    this._logPipeline('roughness', 'Injecting controlled imperfections...');

    const systemPrompt = `ROLE: You are an editor performing a final pass to ensure this prose reads like it was written by a human author in a normal drafting process, not generated by a machine. Your job is to introduce CONTROLLED IMPERFECTIONS that mimic natural human writing.

REQUIRED CHANGES (apply exactly these, no more):

1. PARAGRAPH LENGTH VARIANCE
   Identify the current paragraph length pattern. If paragraphs cluster within +/-20 words of each other, adjust ONE paragraph to be notably shorter (under 30 words) and ONE to be notably longer (over 100 words) by either splitting a sentence from one paragraph into its own short paragraph, or combining two short paragraphs.

2. ONE FUNCTIONAL TRANSITION
   Find one transition between paragraphs that is currently elegant or crafted. Replace it with a plain functional transition:
   - "By that spring," or "The following month," or "Meanwhile," or "The situation was more complicated than that."
   These are the transitions real authors use when they are moving the narrative forward without performing.

3. ONE SLIGHTLY LONG SENTENCE
   Find one sentence in the 15-20 word range that could be tightened. Instead of tightening it, EXTEND it by 5-8 words with a subordinate clause or parenthetical aside that adds minor texture but is not strictly necessary. Real authors often leave these in because they like the detail even though an editor might trim it.

4. ONE MINOR RHYTHM BREAK
   Find a sequence of 3+ sentences with similar lengths. Vary one sentence length by adding or removing a subordinate clause.

CONSTRAINTS:
- Do NOT introduce grammatical errors. Human nonfiction authors do not make grammar mistakes. The roughness is in rhythm, structure, and proportion.
- Do NOT reduce prose quality. Every change should be indistinguishable from a normal human authorial choice.
- Do NOT change more than 8% of the total word count.
- Preserve all factual content exactly.
- Return the COMPLETE modified passage.
- After the passage, add a line "---ROUGHNESS_LOG---" followed by a brief description of each change made (one line per change).`;

    const response = await this._callApi(systemPrompt,
      `PROSE (${this._countWords(prose)} words):\n\n${prose}`,
      { temperature: 0.4, maxTokens: 2500 }
    );

    let roughened = response.trim();
    const logMarker = roughened.indexOf('---ROUGHNESS_LOG---');
    if (logMarker !== -1) {
      const log = roughened.substring(logMarker + '---ROUGHNESS_LOG---'.length).trim();
      roughened = roughened.substring(0, logMarker).trim();
      for (const line of log.split('\n').filter(l => l.trim())) {
        this._logPipeline('roughness', `  ${line.trim()}`);
      }
    }

    // Validate word count drift
    const originalWords = this._countWords(prose);
    const roughenedWords = this._countWords(roughened);
    const drift = Math.abs(roughenedWords - originalWords) / originalWords;

    if (drift > 0.08) {
      this._logPipeline('roughness', `Word count drift ${Math.round(drift * 100)}% exceeds 8%. Using original.`);
      return prose;
    }

    this._logPipeline('roughness', `Words: ${originalWords} -> ${roughenedWords}. Changes applied.`);
    return roughened;
  }

  // ═══════════════════════════════════════════════════════════
  //  PHASE 6: FOOTNOTE INSERTION
  // ═══════════════════════════════════════════════════════════

  /**
   * Generate footnotes for approved prose.
   * Only runs when scholarlyApparatus.footnotesEnabled is true.
   */
  async _generateFootnotes(prose, context) {
    const sa = context.scholarlyApparatus;
    if (!sa || !sa.footnotesEnabled) {
      return { prose, footnotes: [], endnotes: [] };
    }

    this._logPipeline('footnotes', `Generating ${sa.footnoteFormat || 'endnotes'}...`);

    const formatInstructions = {
      endnotes: 'Number footnotes sequentially within the chapter (1, 2, 3...). They will be collected at chapter end under a "Notes" heading. Use full Chicago Manual of Style citations on first reference, short form on subsequent references.',
      footnotes: 'Number footnotes sequentially per page, using superscript numbers. Use full Chicago Manual of Style citations.',
      inline: 'Insert (Author, Year, p. XX) at point of reference. Collect full citations for a bibliography section.'
    };

    const sourceSpecificityRules = sa.sourceSpecificityMode
      ? `\nSOURCE SPECIFICITY MODE IS ON: Footnotes must include archival detail (collection, box, folder, document type, date) whenever available.`
      : '';

    const systemPrompt = `ROLE: You are a professional research assistant preparing footnotes for a narrative nonfiction manuscript. You have access to the source material and must create accurate, properly formatted scholarly citations.

FORMAT: ${formatInstructions[sa.footnoteFormat] || formatInstructions.endnotes}
${sourceSpecificityRules}

RULES:
- NEVER invent citations. If you cannot identify the source for a claim, output: "[SOURCE NEEDED: (description of claim)]"
- Follow Chicago Manual of Style, 17th Edition (Notes-Bibliography system)
- First reference: full citation. Subsequent references: short form.
- For archival materials: Collection name, Box/Folder, Repository.
- For interviews/oral histories: Name, interview date, interviewer if known.
- For newspaper articles: Author (if known), "Title," Publication, date, page.

SCAN the prose for citation-worthy elements:
- Direct quotations attributed to a source
- Specific dates, figures, or statistics
- Claims about archival documents
- Named publications or studies
- Paraphrased accounts from named individuals

OUTPUT FORMAT:
Return ONLY valid JSON:
{
  "annotatedProse": "The prose with superscript markers inserted like [1] at appropriate positions",
  "footnotes": [
    { "number": 1, "text": "Full citation text here", "type": "archival|book|article|interview|document" },
    { "number": 2, "text": "[SOURCE NEEDED: description]", "type": "unknown" }
  ]
}`;

    const response = await this._callApi(systemPrompt,
      `Generate footnotes for this prose:\n\n${prose}`,
      { temperature: 0.1, maxTokens: 3000 }
    );

    const result = this._parseJSON(response);

    if (!result || !result.footnotes) {
      this._logPipeline('footnotes', 'Failed to parse footnote response. Returning prose without footnotes.');
      return { prose, footnotes: [], endnotes: [] };
    }

    const sourceNeeded = result.footnotes.filter(f => f.text?.includes('[SOURCE NEEDED'));
    this._logPipeline('footnotes', `Generated ${result.footnotes.length} footnotes. ${sourceNeeded.length} need source verification.`);

    return {
      prose: result.annotatedProse || prose,
      footnotes: result.footnotes,
      endnotes: sa.footnoteFormat === 'endnotes' ? result.footnotes : [],
      format: sa.footnoteFormat || 'endnotes'
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  PHASE 7: INDEX COMPILATION
  // ═══════════════════════════════════════════════════════════

  /**
   * Compile index entries from completed chapter text.
   * Runs as post-processing after all chapters are complete.
   */
  async _compileIndex(allChaptersText, context) {
    const sa = context.scholarlyApparatus;
    if (!sa || !sa.indexEnabled) {
      return { entries: [], type: null };
    }

    const indexType = sa.indexType || 'combined';
    this._logPipeline('index', `Compiling ${indexType} index...`);

    const typeInstructions = {
      subject: 'Create a SUBJECT INDEX only. Include key concepts, organizations, places, events, and technologies. Do NOT include individual people.',
      name: 'Create a NAME INDEX only. Include all named individuals with their role on first appearance. Format: Last name, First name.',
      combined: 'Create a COMBINED INDEX with both subjects and names in one alphabetical sequence.',
      separate: 'Create TWO SEPARATE INDEXES: first a NAME INDEX, then a SUBJECT INDEX. Each alphabetized independently.'
    };

    const systemPrompt = `ROLE: You are a professional book indexer preparing a back-of-book index for a narrative nonfiction work. You follow the conventions of the Chicago Manual of Style, 17th Edition, Chapter 16.

INDEX TYPE: ${typeInstructions[indexType]}

INDEXING RULES:
- Index significant discussions, not passing mentions
- Use page ranges for extended treatment (e.g., "45-52" not "45, 46, 47...")
- Create "See" references for alternate forms (e.g., "GM. See General Motors")
- Create "See also" references for related topics
- Sub-entries should be substantive, not just page locators
- Alphabetize letter-by-letter (ignoring spaces and punctuation)
- People: Last name, First name
- Numbers: file under spelled-out form
- Prepositions in sub-entries: avoid starting with articles (a, an, the)

For page numbers, use the chapter number as a prefix (e.g., "1-5" means chapter 1, approximate page 5).

OUTPUT FORMAT:
Return ONLY valid JSON:
{
  "type": "${indexType}",
  "entries": [
    {
      "term": "Ford, Henry",
      "pageRefs": "1-5, 2-12, 3-18",
      "subEntries": [
        { "term": "and Dodge brothers lawsuit", "pageRefs": "6-7" },
        { "term": "and Rouge River plant", "pageRefs": "1-5, 2-12" }
      ],
      "seeAlso": ["Ford Motor Company"],
      "category": "name"
    }
  ]
}`;

    const response = await this._callApi(systemPrompt,
      `Compile an index from this text:\n\n${allChaptersText.substring(0, 15000)}`,
      { temperature: 0.1, maxTokens: 4096 }
    );

    const result = this._parseJSON(response);

    if (!result || !result.entries) {
      this._logPipeline('index', 'Failed to parse index response.');
      return { entries: [], type: indexType };
    }

    this._logPipeline('index', `Compiled ${result.entries.length} index entries.`);
    return result;
  }

  // ═══════════════════════════════════════════════════════════
  //  GENESIS 3.0 — SINGLE-VOICE GENERATION (Session 3)
  // ═══════════════════════════════════════════════════════════

  /**
   * Select an author voice for a chapter. Locks it in chapterVoice field.
   * @param {Object} authorPalette - Project's author palette
   * @param {string} [preferredAuthorId] - Optional preferred author ID
   * @returns {Object} Selected author from GENESIS_AUTHOR_PALETTE
   */
  _selectChapterVoice(authorPalette, preferredAuthorId) {
    // If a preferred author is specified, use it
    if (preferredAuthorId && GENESIS_AUTHOR_PALETTE[preferredAuthorId]) {
      return GENESIS_AUTHOR_PALETTE[preferredAuthorId];
    }

    // Build available authors from palette + Genesis 3.0 palette
    const available = [];
    if (authorPalette && typeof authorPalette === 'object' && authorPalette.authors) {
      for (const a of authorPalette.authors) {
        const paletteAuthor = Object.values(GENESIS_AUTHOR_PALETTE).find(
          ga => ga.name.toLowerCase() === (a.name || '').toLowerCase()
        );
        if (paletteAuthor) {
          available.push(paletteAuthor);
        } else {
          // Use the palette author's own voice prompt
          available.push({
            id: a.id || a.name?.toLowerCase().replace(/\s+/g, '-'),
            name: a.name, label: a.label || a.name,
            temperature: a.temperature || 0.7,
            voicePrompt: a.voicePrompt || ''
          });
        }
      }
    }

    // If no palette authors, use the full Genesis 3.0 palette
    if (available.length === 0) {
      const all = Object.values(GENESIS_AUTHOR_PALETTE);
      return all[Math.floor(Math.random() * all.length)];
    }

    // Random selection from available
    return available[Math.floor(Math.random() * available.length)];
  }

  /**
   * Generate a single 750-word chunk in ONE author voice.
   * Replaces multi-agent parallel generation for Genesis 3.0.
   */
  async generateSingleVoice(params) {
    const { systemPrompt, userPrompt, maxTokens = 4096, chapterVoice, errorPatterns, beats, continuityDigest } = params;

    const authorName = chapterVoice.name || chapterVoice.label;
    const voiceChars = chapterVoice.voicePrompt || '';

    this._logPipeline('gen-single', `Generating in the voice of ${authorName}...`);

    const singleVoiceSystem = `You are writing narrative nonfiction in the voice of ${authorName}.
You are producing a rough first draft of approximately 750 words.

VOICE CHARACTERISTICS:
${voiceChars}

${beats ? `MATERIAL TO COVER:\n${beats}\n` : ''}
${continuityDigest ? `CONTINUITY:\n${continuityDigest}\n` : ''}

RULES:
- Write naturally. This is a FIRST DRAFT. Some roughness is expected and welcome.
- Do NOT try to make every sentence brilliant. Let 2-3 sentences per chunk be merely functional — competent but not brilliant.
- End 70%+ of paragraphs mid-thought, mid-action, or on a functional transition. Do NOT end paragraphs on resonant, ironic, or dramatic closing beats unless the content genuinely demands it.
- Maximum ONE tricolon (list of three) per 750 words.
- Do NOT fabricate citations, statistics, or archival references. If a number is not in the source material, do not fabricate one.
- Vary paragraph lengths. Some short (2-3 sentences). Some long (8-10 sentences). Do NOT make them all medium.
- Vary section structure per chapter. If Chapter 1 opens with a scene, Chapter 2 should open with context or data.
- Let sections bleed into each other. Start a political observation inside an industrial scene. Embed economic context mid-character-moment. Do NOT follow a modular template of scene > context > data > character > kicker.

ABSOLUTE BAN — EM-DASHES:
Never use em-dashes (—), en-dashes (–), or double-hyphens (--) in any context. This includes:
- Parenthetical asides (use commas or parentheses instead)
- Dramatic pauses (use periods instead)
- Definitions or explanations (use commas, colons, or parentheses)
- Interruptions (use ellipsis)
- Appositional phrases (use commas)
If you find yourself reaching for an em-dash, stop and restructure the sentence.

BANNED PATTERNS (zero occurrences):
- "found herself/himself"
- "the way" (as connector)
- "voice was"
- "seemed to"
- "began to" / "started to"
- "something" / "somehow"
- "for a long moment"
- "meanwhile"
- em-dash character (—)
- en-dash character (–)
- double-hyphen (--)

${systemPrompt}`;

    const text = await this._callApi(singleVoiceSystem, userPrompt, {
      maxTokens, temperature: 0.7
    });

    this._logPipeline('gen-single', `Single-voice generation complete. ${this._countWords(text)} words.`);
    return text;
  }

  // ═══════════════════════════════════════════════════════════
  //  GENESIS 3.0 — SENTENCE-LEVEL ITERATION (Session 4)
  // ═══════════════════════════════════════════════════════════

  /**
   * Parse a prose chunk into individual sentences.
   * Handles dialogue quotes, abbreviations, ellipsis.
   */
  parseSentences(chunk) {
    if (!chunk || chunk.trim().length === 0) return [];

    // Protect abbreviations from splitting
    let text = chunk
      .replace(/\bMr\./g, 'Mr\u200B')
      .replace(/\bMrs\./g, 'Mrs\u200B')
      .replace(/\bDr\./g, 'Dr\u200B')
      .replace(/\bU\.S\./g, 'U\u200BS\u200B')
      .replace(/\bSt\./g, 'St\u200B')
      .replace(/\bGen\./g, 'Gen\u200B')
      .replace(/\bSen\./g, 'Sen\u200B')
      .replace(/\bRep\./g, 'Rep\u200B')
      .replace(/\bvs\./g, 'vs\u200B')
      .replace(/\betc\./g, 'etc\u200B')
      .replace(/\be\.g\./g, 'e\u200Bg\u200B')
      .replace(/\bi\.e\./g, 'i\u200Be\u200B')
      .replace(/\.\.\./g, '\u2026'); // Ellipsis

    // Split on sentence-ending punctuation
    const raw = text.split(/(?<=[.!?])\s+/);

    // Restore abbreviations
    return raw
      .map(s => s
        .replace(/\u200B/g, '.')
        .replace(/\u2026/g, '...')
        .trim()
      )
      .filter(s => s.length > 0);
  }

  /**
   * Classify each sentence by type for iteration targeting.
   */
  classifySentences(sentences) {
    const emotionWords = /\b(felt|realized|knew|feared|hoped|remembered|heart|breath|tears|trembled|grief|joy|rage|despair|longing|dread|wonder|shame|pride|guilt)\b/i;
    const transitionStarters = /^(Later|Meanwhile|The next|That evening|By then|After|Before|Outside|Across|The following|In the|On the|Within|During|Throughout|At last|Eventually|Soon|Then|Afterward)/i;

    return sentences.map((sentence, index) => {
      const wordCount = sentence.split(/\s+/).length;

      if (index === 0) return { sentence, type: 'opener', index };
      if (index === sentences.length - 1) return { sentence, type: 'closer', index };
      if (emotionWords.test(sentence)) return { sentence, type: 'emotional_beat', index };
      if (wordCount < 15 && transitionStarters.test(sentence)) return { sentence, type: 'transition', index };
      return { sentence, type: 'factual', index };
    });
  }

  /**
   * Select authors best suited for a sentence purpose.
   */
  selectAuthorsForPurpose(sentenceType, maxAuthors = 3) {
    const authorMap = {
      opener: ['john-hersey', 'ryszard-kapuscinski', 'erik-larson', 'robert-caro'],
      closer: ['joan-didion', 'janet-malcolm', 'robert-caro', 'john-mcphee'],
      emotional_beat: ['robert-caro', 'joan-didion', 'janet-malcolm', 'ryszard-kapuscinski'],
      scene_setting: ['john-hersey', 'ryszard-kapuscinski', 'erik-larson'],
      analysis: ['robert-caro', 'david-halberstam', 'john-mcphee'],
      transition: ['john-mcphee', 'janet-malcolm', 'john-hersey'],
      revelation: ['joan-didion', 'janet-malcolm', 'robert-caro'],
      factual: ['erik-larson', 'john-mcphee', 'david-halberstam']
    };

    const candidates = (authorMap[sentenceType] || authorMap.factual)
      .map(id => GENESIS_AUTHOR_PALETTE[id])
      .filter(Boolean);

    // Shuffle before slicing
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    return candidates.slice(0, maxAuthors);
  }

  /**
   * Generate one alternative version of a sentence in a specific author's voice.
   */
  async generateSentenceAlternative(sentence, context, iteratorAuthor, chapterVoice) {
    const systemPrompt = `You are rewriting a single sentence in the voice of ${iteratorAuthor.name}.
The chapter is written in the voice of ${chapterVoice.name}. Your sentence
must fit naturally within that voice while bringing ${iteratorAuthor.name}'s
characteristic ${iteratorAuthor.label || 'style'}.

THE SENTENCE IN CONTEXT:
${context.prevSentences ? context.prevSentences.join(' ') + ' → ' : ''}**${sentence}**${context.nextSentences ? ' → ' + context.nextSentences.join(' ') : ''}

ORIGINAL SENTENCE:
"${sentence}"

WRITE ONE alternative version. Rules:
- Must fit the surrounding context naturally
- Be specific (concrete detail > abstract statement)
- Do NOT use a tricolon, parallel structure, or dramatic kicker
- Do NOT fabricate statistics or archival references
- Keep roughly the same length (±30%)

RESPOND WITH ONLY THE SENTENCE. No explanation, no quotes.`;

    const alt = await this._callApi(systemPrompt, `Rewrite: "${sentence}"`, {
      maxTokens: 300, temperature: 0.7
    });

    return alt.trim().replace(/^["']|["']$/g, '');
  }

  /**
   * Judge sentence alternatives and select the best.
   */
  async judgeSentence(original, alternatives, context, chapterVoice) {
    const labels = alternatives.map((_, i) => String.fromCharCode(65 + i));
    const altBlock = alternatives.map((alt, i) =>
      `${labels[i]} (${alt.author}): "${alt.text}"`
    ).join('\n');

    const systemPrompt = `Select the best version of a single sentence from these alternatives.

CONTEXT:
${context.prevSentences ? context.prevSentences.join(' ') + ' → ' : ''}[THIS SENTENCE]${context.nextSentences ? ' → ' + context.nextSentences.join(' ') : ''}

ORIGINAL: "${original}"
${altBlock}

SELECT the version that:
1. Fits the surrounding context most naturally
2. Is most specific (concrete detail > abstract statement)
3. Has the most interesting rhythm when read aloud
4. Does NOT use a tricolon or dramatic kicker
5. Maintains the voice of ${chapterVoice.name}

You may construct a HYBRID from multiple versions.

RESPOND WITH ONLY:
Winner: [ORIGINAL/${labels.join('/')}${alternatives.length > 0 ? '/HYBRID' : ''}]
Selected: "[the sentence]"
Reason: [one line]`;

    const response = await this._callApi(systemPrompt, `Judge these sentence alternatives.`, {
      maxTokens: 400, temperature: 0.2
    });

    // Parse the response
    const winnerMatch = response.match(/Winner:\s*(ORIGINAL|HYBRID|[A-Z])/i);
    const selectedMatch = response.match(/Selected:\s*"([^"]+)"/);
    const reasonMatch = response.match(/Reason:\s*(.+)/i);

    const winner = winnerMatch ? winnerMatch[1].toUpperCase() : 'ORIGINAL';
    const selected = selectedMatch ? selectedMatch[1] : original;

    return {
      winner,
      selected,
      reason: reasonMatch ? reasonMatch[1].trim() : 'No reason provided'
    };
  }

  /**
   * Main sentence iteration method.
   * Iterates important sentences in a chunk for quality improvement.
   */
  async iterateSentences(chunk, chapterVoice, agentCount) {
    // Map agentCount to iteration count
    let iterationCount;
    if (agentCount <= 1) return chunk; // No iteration
    if (agentCount <= 5) iterationCount = agentCount;
    else iterationCount = 5; // Cap at 5

    this._logPipeline('sentence-iter', `Sentence iteration: ${iterationCount} alternatives per important sentence`);

    const sentences = this.parseSentences(chunk);
    const classified = this.classifySentences(sentences);

    const important = classified.filter(c =>
      c.type === 'opener' || c.type === 'closer' || c.type === 'emotional_beat'
    );
    const skipped = classified.filter(c =>
      c.type === 'transition' || c.type === 'factual'
    );

    this._logPipeline('sentence-iter', `${important.length} important sentences, ${skipped.length} functional (skipped)`);

    const finalSentences = sentences.slice(); // Copy

    for (const item of important) {
      const { sentence, type, index } = item;
      this._logPipeline('sentence-iter', `  [${type}] "${sentence.substring(0, 60)}..."`);

      // Get context (surrounding sentences)
      const context = {
        prevSentences: sentences.slice(Math.max(0, index - 2), index),
        nextSentences: sentences.slice(index + 1, Math.min(sentences.length, index + 3))
      };

      // Select authors for this sentence type
      const authors = this.selectAuthorsForPurpose(type, iterationCount);

      // Generate alternatives in parallel
      const altPromises = authors.map(author =>
        this.generateSentenceAlternative(sentence, context, author, chapterVoice)
          .then(text => ({ text, author: author.name }))
          .catch(() => null)
      );

      const results = (await Promise.all(altPromises)).filter(Boolean);

      if (results.length === 0) {
        this._logPipeline('sentence-iter', `    No alternatives generated. Keeping original.`);
        continue;
      }

      // Judge alternatives
      const judgment = await this.judgeSentence(sentence, results, context, chapterVoice);

      if (judgment.winner !== 'ORIGINAL' && judgment.selected && judgment.selected !== sentence) {
        finalSentences[index] = judgment.selected;
        this._logPipeline('sentence-iter', `    Winner: ${judgment.winner} — ${judgment.reason}`);
      } else {
        this._logPipeline('sentence-iter', `    Keeping original.`);
      }
    }

    return finalSentences.join(' ');
  }

  // ═══════════════════════════════════════════════════════════
  //  GENESIS 3.0 — PROSECUTION SCORING (Session 5)
  // ═══════════════════════════════════════════════════════════

  /**
   * Prosecution-first scoring: weaknesses before strengths.
   * Returns detailed score with mechanical caps applied.
   */
  async _prosecutionScore(prose, context, verificationResult) {
    this._logPipeline('prosecution', 'Running prosecution-first scoring...');

    const systemPrompt = `You are a hostile editorial reviewer. Your job is to find weaknesses.
List every flaw BEFORE acknowledging any strength.

READ THIS PROSE AND RESPOND IN THIS EXACT ORDER:

WEAKNESSES (list ALL, most serious first):
1. [specific weakness with quoted text]
2. [specific weakness with quoted text]
...

STRENGTHS (ONLY after all weaknesses):
1. ...

SCORES (1-10 each):
- Prose Quality: [N]/10
- Emotional Resonance: [N]/10
- Pacing: [N]/10
- Character Voice: [N]/10
- Show vs. Tell: [N]/10
- Sentence Variety: [N]/10
- Word Choice: [N]/10
- Originality: [N]/10
- Technical: [N]/10

OVERALL: [N]/100

NOTE: Scores will be mechanically adjusted by code-based verification.
If code found 3 tricolons and you scored Originality 9/10, your score
will be overridden to 7/10. Score honestly.`;

    const response = await this._callApi(systemPrompt, `PROSE:\n\n${prose}`, {
      temperature: 0.15, maxTokens: 1500
    });

    // Parse scores from the response
    const overallMatch = response.match(/OVERALL:\s*(\d+)/i);
    let overall = overallMatch ? parseInt(overallMatch[1]) : 85;

    const origMatch = response.match(/Originality:\s*(\d+)/i);
    let originality = origMatch ? parseInt(origMatch[1]) : 7;

    const techMatch = response.match(/Technical:\s*(\d+)/i);
    let technical = techMatch ? parseInt(techMatch[1]) : 7;

    const emotMatch = response.match(/Emotional Resonance:\s*(\d+)/i);
    let emotionalResonance = emotMatch ? parseInt(emotMatch[1]) : 7;

    // Apply mechanical caps from deterministic verification
    if (verificationResult) {
      // Banned patterns → overall score = 0
      const bannedCount = verificationResult.bannedPatterns
        ? verificationResult.bannedPatterns.reduce((sum, bp) => sum + bp.count, 0)
        : 0;
      if (bannedCount > 0) {
        this._logPipeline('prosecution', `MECHANICAL CAP: Banned patterns found (${bannedCount}). Overall → 0.`);
        overall = 0;
      }

      // Tricolon > 2 → cap Originality at 7
      if (verificationResult.tricolonCount > 2) {
        const cappedOrig = Math.min(originality, 7);
        if (cappedOrig < originality) {
          this._logPipeline('prosecution', `MECHANICAL CAP: ${verificationResult.tricolonCount} tricolons. Originality ${originality} → ${cappedOrig}.`);
          originality = cappedOrig;
        }
      }

      // Kicker density > 0.30 → cap Technical at 7 (Genesis 3.0: 30% cap)
      if (verificationResult.kickerDensity > 0.30) {
        const cappedTech = Math.min(technical, 7);
        if (cappedTech < technical) {
          this._logPipeline('prosecution', `MECHANICAL CAP: Kicker density ${(verificationResult.kickerDensity * 100).toFixed(0)}%. Technical ${technical} → ${cappedTech}.`);
          technical = cappedTech;
        }
      }

      // Four requirements === 0 → cap Emotional Resonance at 6
      if (verificationResult.fourRequirements === 0) {
        const cappedEmot = Math.min(emotionalResonance, 6);
        if (cappedEmot < emotionalResonance) {
          this._logPipeline('prosecution', `MECHANICAL CAP: Zero requirements met. Emotional Resonance ${emotionalResonance} → ${cappedEmot}.`);
          emotionalResonance = cappedEmot;
        }
      }
    }

    this._logPipeline('prosecution', `Final score: ${overall}/100 (Orig: ${originality}, Tech: ${technical}, Emot: ${emotionalResonance})`);

    return {
      overall,
      originality,
      technical,
      emotionalResonance,
      rawResponse: response,
      mechanicallyCapped: !!verificationResult
    };
  }

  /**
   * Simplified adversarial audit: 3 binary questions (replaces 7-dimension JSON).
   */
  async _simplifiedAdversarialAudit(prose) {
    this._logPipeline('adversarial-v3', 'Running simplified adversarial audit (3 binary questions)...');

    const systemPrompt = `Answer YES or NO for each, with one example if YES.

1. KICKER_DENSITY: Do >30% of paragraphs end on a dramatic/ironic kicker?
2. PATTERN_DENSITY: Are there >2 tricolons or parallel structures?
3. VOICE_SHIFT: Does the voice change noticeably between paragraphs?

FORMAT:
KICKER_DENSITY: [YES/NO] — [example if yes]
PATTERN_DENSITY: [YES/NO] — [example if yes]
VOICE_SHIFT: [YES/NO] — [example if yes]`;

    const response = await this._callApi(systemPrompt, `PROSE:\n\n${prose}`, {
      temperature: 0.1, maxTokens: 500
    });

    // Parse with regex — this ALWAYS parses
    const kickerMatch = response.match(/KICKER_DENSITY:\s*(YES|NO)/i);
    const patternMatch = response.match(/PATTERN_DENSITY:\s*(YES|NO)/i);
    const voiceMatch = response.match(/VOICE_SHIFT:\s*(YES|NO)/i);

    const results = {
      kickerDensity: kickerMatch ? kickerMatch[1].toUpperCase() === 'YES' : false,
      patternDensity: patternMatch ? patternMatch[1].toUpperCase() === 'YES' : false,
      voiceShift: voiceMatch ? voiceMatch[1].toUpperCase() === 'YES' : false,
      rawResponse: response,
      anyYes: false,
      findings: []
    };

    if (results.kickerDensity) {
      results.findings.push({ dimension: 'KICKER_DENSITY', detail: response.match(/KICKER_DENSITY:\s*YES\s*—\s*(.*)/i)?.[1] || '' });
    }
    if (results.patternDensity) {
      results.findings.push({ dimension: 'PATTERN_DENSITY', detail: response.match(/PATTERN_DENSITY:\s*YES\s*—\s*(.*)/i)?.[1] || '' });
    }
    if (results.voiceShift) {
      results.findings.push({ dimension: 'VOICE_SHIFT', detail: response.match(/VOICE_SHIFT:\s*YES\s*—\s*(.*)/i)?.[1] || '' });
    }

    results.anyYes = results.findings.length > 0;

    this._logPipeline('adversarial-v3', `Results: Kicker=${results.kickerDensity ? 'YES' : 'NO'}, Pattern=${results.patternDensity ? 'YES' : 'NO'}, Voice=${results.voiceShift ? 'YES' : 'NO'}`);

    return results;
  }

  // ═══════════════════════════════════════════════════════════
  //  GENESIS 3.0 — VOICE CONSISTENCY CHECK (Session 6)
  // ═══════════════════════════════════════════════════════════

  /**
   * Check voice consistency across the prose.
   * Returns flagged paragraphs for re-iteration if shifts detected.
   */
  async _voiceConsistencyCheck(prose, chapterVoice) {
    this._logPipeline('voice-check', `Checking voice consistency for ${chapterVoice.name}...`);

    const systemPrompt = `Check voice consistency in this prose written in the style of ${chapterVoice.name}.
Your ONLY job: identify paragraphs where the voice shifts noticeably.

CONSISTENT: [YES/NO]
If NO, list paragraph numbers with one-line explanations:
- Paragraph [N]: [explanation]`;

    const response = await this._callApi(systemPrompt, `PROSE:\n\n${prose}`, {
      temperature: 0.1, maxTokens: 500
    });

    const consistentMatch = response.match(/CONSISTENT:\s*(YES|NO)/i);
    const isConsistent = consistentMatch ? consistentMatch[1].toUpperCase() === 'YES' : true;

    const flaggedParagraphs = [];
    if (!isConsistent) {
      const paraMatches = response.matchAll(/Paragraph\s+(\d+):\s*(.+)/gi);
      for (const m of paraMatches) {
        flaggedParagraphs.push({
          paragraphNumber: parseInt(m[1]),
          explanation: m[2].trim()
        });
      }
    }

    this._logPipeline('voice-check', isConsistent
      ? 'Voice consistent throughout.'
      : `Voice shifts detected in ${flaggedParagraphs.length} paragraph(s).`);

    return { isConsistent, flaggedParagraphs, rawResponse: response };
  }

  // ═══════════════════════════════════════════════════════════
  //  GENESIS 3.0 — FULL PIPELINE (replaces legacy chimera)
  // ═══════════════════════════════════════════════════════════

  /**
   * Run the Genesis 3.0 pipeline:
   *   Phase 1 → Single-voice generation (1 agent, 750-word chunks, voice locked per chapter)
   *   Phase 2 → Sentence-level iteration (3-13 alternatives for important sentences)
   *   Phase 3 → Deterministic verification (regex/code checks, no LLM)
   *   Phase 4 → Prosecution-first scoring (score < 89 = rewrite, 89-91 = micro-fix, 92+ = accept)
   *   Phase 5 → Micro-fix loop (max 3 passes, 1 cycle, no re-audit)
   *   Phase 6 → Simplified adversarial audit (3 binary questions)
   *   Phase 7 → Voice consistency check
   *   Phase 8 → Human review gate
   *   Phase 9 → GO/NO-GO (cross-chapter structural variance check) + export-ready
   */
  async runGenesis3Pipeline(params) {
    const {
      systemPrompt, userPrompt, maxTokens,
      genre, voice, authorPalette, qualityThreshold,
      currentChapterId, currentChapterTitle, chapters,
      errorPatterns, scholarlyApparatus, chapterVoice: preferredVoice
    } = params;

    this._abortController = new AbortController();

    const context = {
      genre, voice, authorPalette, qualityThreshold,
      chapterTitle: currentChapterTitle,
      currentChapterTitle,
      errorPatterns: errorPatterns || [],
      scholarlyApparatus: scholarlyApparatus || {}
    };

    try {
      // ============ SELECT CHAPTER VOICE ============
      const chapterVoice = this._selectChapterVoice(authorPalette, preferredVoice);
      this._logPipeline('pipeline-v3', `Chapter voice locked: ${chapterVoice.name} (${chapterVoice.label})`);

      // ============ PHASE 1: Single-Voice Generation ============
      this._emit('pipeline', '=== PHASE 1: Single-Voice Generation ===');

      let augmentedSystemPrompt = systemPrompt;
      augmentedSystemPrompt += this._buildKickerBudgetPrompt();
      const errorPatternSection = this._buildBannedPatternsFromErrorDB(errorPatterns);
      if (errorPatternSection) augmentedSystemPrompt += errorPatternSection;
      // Add em-dash ban and chapter title instruction to system prompt
      augmentedSystemPrompt = `\nABSOLUTE FORMATTING RULE: Never use em dashes (\u2014) or en dashes (\u2013) anywhere in your output. Not with spaces ( \u2014 ), not without spaces (\u2014), not as en dashes (\u2013). Instead use: commas, colons, semicolons, periods, or parentheses. This is non-negotiable. Any em dash in your output is a critical failure.\n\nDo NOT include the chapter title in your output. Begin directly with the first sentence of prose. The chapter title is handled separately by the system.\n` + augmentedSystemPrompt;

      let currentProse = await this.generateSingleVoice({
        systemPrompt: augmentedSystemPrompt,
        userPrompt, maxTokens, chapterVoice, errorPatterns
      });
      // Strip em dashes and leading chapter title from generated prose
      currentProse = this._stripEmDashes(currentProse);
      if (currentChapterTitle) {
        currentProse = this._stripLeadingTitle(currentProse, currentChapterTitle);
      }

      // ============ PHASE 2: Sentence-Level Iteration ============
      this._emit('pipeline', '=== PHASE 2: Sentence-Level Iteration ===');

      if (this.agentCount > 1) {
        currentProse = await this.iterateSentences(currentProse, chapterVoice, this.agentCount);
        this._logPipeline('sentence-iter-complete', 'Sentence iteration complete.');
      } else {
        this._logPipeline('sentence-iter', 'Skipped (agentCount = 1).');
      }

      // ============ PHASE 3: Deterministic Verification ============
      this._emit('pipeline', '=== PHASE 3: Deterministic Verification ===');

      let verificationResult = deterministicVerification(currentProse);
      this._logPipeline('verification', `Checks: ${verificationResult.allPassed ? 'ALL PASSED' : `${verificationResult.failCount} FAILURES`}`);
      for (const f of verificationResult.failures) {
        this._logPipeline('verification', `  FAIL: ${f}`);
      }
      if (verificationResult.fabricatedPrecision.length > 0) {
        this._logPipeline('verification', `  WARNING: ${verificationResult.fabricatedPrecision.length} fabricated precision flags`);
      }

      // ============ PHASE 4: Prosecution Scoring ============
      this._emit('pipeline', '=== PHASE 4: Prosecution Scoring ===');

      let scoreResult = await this._prosecutionScore(currentProse, context, verificationResult);
      let currentScore = scoreResult.overall;

      // Genesis 3.0: If score < 89, rewrite the chunk entirely (do not micro-fix)
      if (currentScore < 89) {
        this._logPipeline('prosecution', `Score ${currentScore} < 89. REWRITING chunk from scratch...`);
        this._emit('pipeline', '=== Score below 89 — Regenerating chunk ===');
        currentProse = await this.generateSingleVoice({
          systemPrompt: augmentedSystemPrompt,
          userPrompt, maxTokens, chapterVoice, errorPatterns
        });
        // Strip em dashes and leading title from rewritten prose
        currentProse = this._stripEmDashes(currentProse);
        if (currentChapterTitle) {
          currentProse = this._stripLeadingTitle(currentProse, currentChapterTitle);
        }
        verificationResult = deterministicVerification(currentProse);
        scoreResult = await this._prosecutionScore(currentProse, context, verificationResult);
        currentScore = scoreResult.overall;
        this._logPipeline('prosecution', `Rewrite score: ${currentScore}/100`);
      }

      // ============ PHASE 5: Micro-Fix Loop ============
      this._emit('pipeline', '=== PHASE 5: Micro-Fix Loop ===');

      // CRITICAL: Stop condition requires BOTH quality >= threshold AND verification.allPassed
      // Genesis 3.0: Capped at 3 passes max, 1 cycle, no re-audit
      const targetScore = qualityThreshold || 92;
      let microFixPasses = 0;
      const maxMicroFixPasses = 3;
      const fixesApplied = [];

      while (microFixPasses < maxMicroFixPasses) {
        const qualityOk = currentScore >= targetScore;
        const verificationOk = verificationResult.allPassed;

        if (qualityOk && verificationOk) {
          this._logPipeline('microfix-v3', `STOP: Quality ${currentScore} >= ${targetScore} AND verification passed.`);
          break;
        }

        microFixPasses++;
        this._logPipeline('microfix-v3', `Pass ${microFixPasses}/${maxMicroFixPasses}: Quality=${currentScore}, Verification=${verificationOk ? 'PASS' : 'FAIL'}`);

        // Use the existing micro-fix engine
        const diagnosis = await this._diagnoseWeakestElement(currentProse, context, fixesApplied.map(f => f.text));
        if (!diagnosis || diagnosis.severity === 'none') {
          this._logPipeline('microfix-v3', 'No weakness found. Stopping.');
          break;
        }

        const fixedProse = await this._fixSingleElement(currentProse, diagnosis, context);
        if (!fixedProse || fixedProse === currentProse) {
          this._logPipeline('microfix-v3', 'Fix produced no change. Skipping.');
          continue;
        }

        // Validate word count
        const drift = Math.abs(this._countWords(fixedProse) - this._countWords(currentProse)) / this._countWords(currentProse);
        if (drift > 0.08) {
          this._logPipeline('microfix-v3', `Word drift ${(drift * 100).toFixed(0)}% too high. Rejecting.`);
          continue;
        }

        // Re-verify and re-score
        const newVerification = deterministicVerification(fixedProse);
        const newScoreResult = await this._prosecutionScore(fixedProse, context, newVerification);

        if (newScoreResult.overall >= currentScore || newVerification.failCount < verificationResult.failCount) {
          currentProse = fixedProse;
          verificationResult = newVerification;
          scoreResult = newScoreResult;
          currentScore = newScoreResult.overall;
          fixesApplied.push({
            pass: microFixPasses,
            category: diagnosis.category,
            text: (diagnosis.text || '').substring(0, 80),
            scoreBefore: currentScore,
            scoreAfter: newScoreResult.overall
          });
          this._logPipeline('microfix-v3', `Fix accepted. Score: ${currentScore}, Verification failures: ${newVerification.failCount}`);
        } else {
          this._logPipeline('microfix-v3', `Fix rejected. Score would drop to ${newScoreResult.overall}.`);
        }
      }

      // ============ PHASE 6: Simplified Adversarial Audit ============
      this._emit('pipeline', '=== PHASE 6: Adversarial Audit ===');

      const auditResult = await this._simplifiedAdversarialAudit(currentProse);

      if (auditResult.anyYes && microFixPasses < maxMicroFixPasses) {
        this._logPipeline('adversarial-v3', 'Routing adversarial findings to micro-fix...');
        // One more micro-fix pass targeting adversarial findings
        for (const finding of auditResult.findings) {
          if (microFixPasses >= maxMicroFixPasses) break;
          microFixPasses++;

          const adversarialDiagnosis = {
            text: finding.detail || finding.dimension,
            category: finding.dimension.toLowerCase(),
            severity: 'high',
            diagnosis: `Adversarial audit: ${finding.dimension} — ${finding.detail}`,
            suggestedApproach: `Address the ${finding.dimension} issue identified by the adversarial audit`
          };

          const fixedProse = await this._fixSingleElement(currentProse, adversarialDiagnosis, context);
          if (fixedProse && fixedProse !== currentProse) {
            const drift = Math.abs(this._countWords(fixedProse) - this._countWords(currentProse)) / this._countWords(currentProse);
            if (drift <= 0.08) {
              currentProse = fixedProse;
              verificationResult = deterministicVerification(currentProse);
              this._logPipeline('adversarial-v3', `Adversarial fix applied for ${finding.dimension}.`);
            }
          }
        }
      }

      // ============ PHASE 7: Voice Consistency Check ============
      this._emit('pipeline', '=== PHASE 7: Voice Consistency Check ===');

      const voiceCheck = await this._voiceConsistencyCheck(currentProse, chapterVoice);

      // If voice shifts detected, re-iterate flagged paragraphs (max 1 reroute)
      if (!voiceCheck.isConsistent && voiceCheck.flaggedParagraphs.length > 0) {
        this._logPipeline('voice-check', 'Re-iterating flagged paragraphs...');
        // Split into paragraphs, re-iterate the flagged ones
        const paragraphs = this._segmentParagraphs(currentProse);
        for (const flagged of voiceCheck.flaggedParagraphs) {
          const idx = flagged.paragraphNumber - 1;
          if (idx >= 0 && idx < paragraphs.length) {
            const para = paragraphs[idx];
            const sentences = this.parseSentences(para);
            if (sentences.length > 0) {
              // Re-iterate the paragraph's sentences
              const rewritten = await this.iterateSentences(para, chapterVoice, Math.min(this.agentCount, 3));
              if (rewritten && rewritten.length > 20) {
                paragraphs[idx] = rewritten;
              }
            }
          }
        }
        currentProse = paragraphs.join('\n\n');
        verificationResult = deterministicVerification(currentProse);
      }

      // ============ PHASE 8: Human Review Gate ============
      this._emit('pipeline', '=== PHASE 8: Human Review Gate ===');

      let humanDecision = 'accept';
      if (this.humanReviewEnabled) {
        this._emit('human-gate', 'Awaiting human review...', {
          prose: currentProse,
          verificationResult,
          scoreResult,
          auditResult,
          voiceCheck,
          chapterVoice: chapterVoice.name
        });

        // The app layer will resolve this when the user clicks Accept or Rethink
        humanDecision = await new Promise((resolve) => {
          this._humanGateResolve = resolve;
          // Auto-accept after 60s if no response (for batch mode)
          setTimeout(() => {
            if (this._humanGateResolve === resolve) {
              this._humanGateResolve = null;
              resolve('accept');
            }
          }, 60000);
        });
        this._humanGateResolve = null;

        if (humanDecision === 'rethink') {
          this._logPipeline('human-gate', 'User requested rethink. Regenerating...');
          // Recursively regenerate
          return this.runGenesis3Pipeline(params);
        }
      }

      this._logPipeline('human-gate', humanDecision === 'accept' ? 'Chunk accepted.' : 'Auto-accepted.');

      // ============ PHASE 9: GO/NO-GO + Finalize ============
      let goNoGoResult = { overallStatus: 'GO', results: [], skipped: true };
      if (this.chapterAgentsEnabled && chapters && chapters.length > 1) {
        this._emit('pipeline', '=== PHASE 9: GO/NO-GO Launch Control ===');
        goNoGoResult = await this.runGoNoGo(
          currentProse, currentChapterId, chapters, currentChapterTitle
        );
      }

      // Footnotes (conditional)
      let footnoteResult = { prose: currentProse, footnotes: [], endnotes: [] };
      if (scholarlyApparatus && scholarlyApparatus.footnotesEnabled) {
        footnoteResult = await this._generateFootnotes(currentProse, context);
        currentProse = footnoteResult.prose;
      }

      // Index (conditional)
      let indexResult = { entries: [], type: null };
      if (scholarlyApparatus && scholarlyApparatus.indexEnabled) {
        indexResult = await this._compileIndex(currentProse, context);
      }

      this._abortController = null;

      return {
        prose: currentProse,
        score: currentScore,
        humanLikenessScore: auditResult.anyYes ? 70 : 90,
        candidates: [],
        chimeraMethod: 'single-voice-v3',
        chimeraRationale: `Single-voice generation in ${chapterVoice.name} style with sentence-level iteration`,
        fixesApplied,
        goNoGoResult,
        auditResult,
        verificationResult,
        scoreResult,
        voiceCheck,
        chapterVoice: chapterVoice.name,
        footnoteResult,
        indexResult,
        wordCount: this._countWords(currentProse),
        dualGateIterations: 0,
        humanDecision,
        judgeReport: null,
        fixPlan: null,
        winner: null
      };
    } catch (err) {
      this._abortController = null;
      throw err;
    }
  }

  /**
   * Resolve the human gate (called by the app when user clicks Accept/Rethink).
   */
  resolveHumanGate(decision) {
    if (this._humanGateResolve) {
      this._humanGateResolve(decision);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  PIPELINE ROUTER: Chooses between Genesis 3.0 and legacy
  // ═══════════════════════════════════════════════════════════

  /**
   * Main entry point — routes to Genesis 3.0 or legacy pipeline.
   */
  async runPipeline(params) {
    if (this.genesis3Enabled) {
      return this.runGenesis3Pipeline(params);
    }
    return this.runFullPipeline(params);
  }
}

export { MultiAgentOrchestrator, GENESIS_AUTHOR_PALETTE };
