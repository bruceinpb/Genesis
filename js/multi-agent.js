/**
 * Genesis 2 — Multi-Agent Prose Orchestrator
 *
 * Implements a NASA Mission Control pattern for prose generation and quality assurance.
 *
 * Architecture:
 * - Writing Agents: N parallel agents generate competing prose drafts (different temperatures)
 * - Judge Agent: Evaluates all candidates and selects the best one
 * - Fix Agents: Collaborate on identifying and prioritizing improvements
 * - Editor Agent: Single agent applies the agreed fixes
 * - Chapter Agents: Per-chapter continuity guardians that perform GO/NO-GO conflict checks
 *
 * The pipeline:
 *   1. Deploy N writing agents in parallel → N candidate drafts
 *   2. Judge agent scores and selects best candidate
 *   3. Agents collaborate on a fix list for the winner
 *   4. Single editor agent applies fixes
 *   5. Chapter agents perform GO/NO-GO sequence (NASA launch control pattern)
 *   6. If all chapters report GO → prose is accepted
 *   7. If any chapter reports NO-GO → conflicts shown to user for resolution
 */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

class MultiAgentOrchestrator {
  constructor(generator, storage) {
    this.generator = generator;
    this.storage = storage;

    // Configuration
    this.agentCount = 3;
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
    if (agentCount !== undefined) this.agentCount = Math.max(2, Math.min(5, agentCount));
    if (chapterAgentsEnabled !== undefined) this.chapterAgentsEnabled = chapterAgentsEnabled;
  }

  /**
   * Register a callback for status updates during the pipeline.
   * callback(phase, message, data)
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

  /** @private Emit a status update. */
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

  /**
   * Get the accumulated pipeline log entries.
   * @returns {Array} Log entries with timestamp, phase, message, data
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

  // ═══════════════════════════════════════════════════════════
  //  PHASE 1: MULTI-AGENT PROSE GENERATION
  // ═══════════════════════════════════════════════════════════

  /**
   * Generate prose using multiple writing agents in parallel.
   * Each agent uses a different temperature for creative diversity.
   *
   * @param {Object} params - { systemPrompt, userPrompt, maxTokens }
   * @returns {Array} Array of { agentId, text, temperature, label } candidates.
   */
  async generateWithAgents(params) {
    const { systemPrompt, userPrompt, maxTokens = 4096 } = params;

    // Temperature profiles — each agent has a distinct creative "personality"
    const profiles = [
      { temp: 0.70, label: 'Focused' },
      { temp: 0.85, label: 'Balanced' },
      { temp: 1.00, label: 'Creative' },
      { temp: 0.75, label: 'Precise' },
      { temp: 0.95, label: 'Bold' }
    ];

    const agentProfiles = profiles.slice(0, this.agentCount);

    this._emit('generating', `Deploying ${this.agentCount} writing agents...`, {
      agentCount: this.agentCount
    });

    // Launch all agents with slight stagger to reduce rate-limit risk
    const promises = agentProfiles.map((profile, i) => {
      return new Promise(async (resolve) => {
        // 300ms stagger between agent starts
        if (i > 0) await new Promise(r => setTimeout(r, i * 300));

        const agentId = i + 1;
        this._emit('agent-started', `Agent ${agentId} (${profile.label}) writing...`, {
          agentId, profile: profile.label
        });

        try {
          const text = await this._callApi(systemPrompt, userPrompt, {
            maxTokens,
            temperature: profile.temp
          });
          this._emit('agent-done', `Agent ${agentId} (${profile.label}) complete.`, { agentId });
          resolve({ agentId, text, temperature: profile.temp, label: profile.label, error: null });
        } catch (err) {
          // Retry once on rate limit
          if (err.message.startsWith('RATE_LIMITED')) {
            this._emit('agent-retry', `Agent ${agentId} rate limited. Retrying in 5s...`, { agentId });
            await new Promise(r => setTimeout(r, 5000));
            try {
              const text = await this._callApi(systemPrompt, userPrompt, {
                maxTokens,
                temperature: profile.temp
              });
              this._emit('agent-done', `Agent ${agentId} (${profile.label}) complete (retry).`, { agentId });
              resolve({ agentId, text, temperature: profile.temp, label: profile.label, error: null });
              return;
            } catch (retryErr) {
              this._emit('agent-error', `Agent ${agentId} retry failed: ${retryErr.message}`, { agentId });
              resolve({ agentId, text: '', temperature: profile.temp, label: profile.label, error: retryErr.message });
              return;
            }
          }
          this._emit('agent-error', `Agent ${agentId} failed: ${err.message}`, { agentId });
          resolve({ agentId, text: '', temperature: profile.temp, label: profile.label, error: err.message });
        }
      });
    });

    const candidates = await Promise.all(promises);
    const valid = candidates.filter(c => c.text && c.text.length > 50);

    if (valid.length === 0) {
      throw new Error('All writing agents failed to produce prose. Check your API key and rate limits.');
    }

    this._emit('generation-complete',
      `${valid.length} of ${this.agentCount} agents produced candidates.`,
      { total: this.agentCount, successful: valid.length }
    );

    return valid;
  }

  // ═══════════════════════════════════════════════════════════
  //  PHASE 2: JUDGE AGENT — SELECT BEST CANDIDATE
  // ═══════════════════════════════════════════════════════════

  /**
   * Judge agent evaluates all candidates and selects the best one.
   *
   * @param {Array} candidates - Array of { agentId, text, label }
   * @param {Object} params - { genre, voice, authorPalette, qualityThreshold }
   * @returns {{ winner, report }}
   */
  async judgeAndSelect(candidates, { genre, voice, authorPalette, qualityThreshold }) {
    this._emit('judging', `Judge agent evaluating ${candidates.length} candidates...`);

    const candidateBlock = candidates.map(c =>
      `=== CANDIDATE ${c.agentId} (${c.label}) ===\n${c.text}\n=== END CANDIDATE ${c.agentId} ===`
    ).join('\n\n');

    const systemPrompt = `You are a senior literary editor and competition judge. You have ${candidates.length} versions of the same prose passage, each written by a different author. Select the BEST version.

EVALUATION CRITERIA (order of importance):
1. VOICE AUTHENTICITY (25%) — Distinct human voice, not generic/AI-sounding?
2. PROSE QUALITY (25%) — Sentence variety, rhythm, word choice, sensory detail, showing vs telling
3. GENRE ADHERENCE (20%) — Matches ${genre || 'the genre'} conventions and reader expectations?
4. EMOTIONAL RESONANCE (15%) — Makes the reader feel? Emotions shown through action, not stated?
5. ORIGINALITY (15%) — Fresh imagery, unexpected turns, no cliches or formulaic patterns?
${voice && voice !== 'auto' ? `\nVOICE REQUIREMENT: Must be in ${voice} voice/POV.` : ''}
${authorPalette ? `STYLE INFLUENCES: ${authorPalette}` : ''}
QUALITY TARGET: ${qualityThreshold || 90}/100

SCORING RULES:
- Score each candidate on every criterion (0-100). Be critical.
- Cite specific passages as evidence for scores.
- Identify the single BEST candidate.
- Note strengths to PRESERVE from the winner.
- Note any elements from LOSING candidates that could improve the winner.

Output valid JSON only:
{
  "selectedCandidate": <number: winning agent ID>,
  "scores": [
    {
      "agentId": <number>,
      "voiceAuthenticity": <number 0-100>,
      "proseQuality": <number 0-100>,
      "genreAdherence": <number 0-100>,
      "emotionalResonance": <number 0-100>,
      "originality": <number 0-100>,
      "totalScore": <number 0-100>,
      "summary": "<1-2 sentence assessment>"
    }
  ],
  "selectionReasoning": "<Why this candidate won — cite specific passages>",
  "strengthsToPreserve": ["<specific qualities that must NOT be changed>"],
  "borrowFromOthers": [
    {
      "fromAgent": <number>,
      "element": "<specific passage or technique to borrow>",
      "reason": "<why it would improve the winning text>"
    }
  ],
  "suggestedFixes": [
    {
      "issue": "<what needs fixing>",
      "location": "<approximate location>",
      "suggestion": "<how to fix it>",
      "priority": "high|medium|low"
    }
  ]
}`;

    const text = await this._callApi(systemPrompt,
      `Evaluate these ${candidates.length} prose candidates and select the best one:\n\n${candidateBlock}`,
      { maxTokens: 4096, temperature: 0 }
    );

    const report = this._parseJson(text);
    const winnerId = report.selectedCandidate;
    const winner = candidates.find(c => c.agentId === winnerId) || candidates[0];
    const winnerScore = report.scores?.find(s => s.agentId === winnerId)?.totalScore || '?';

    this._emit('judging-complete',
      `Judge selected Agent ${winnerId} (${winner.label}). Score: ${winnerScore}/100`,
      { winnerId, report }
    );

    return { winner, report };
  }

  // ═══════════════════════════════════════════════════════════
  //  PHASE 3: COLLABORATIVE FIX PLANNING
  // ═══════════════════════════════════════════════════════════

  /**
   * Agents collaborate on identifying fixes for the selected prose.
   * Returns a prioritized fix list.
   */
  async collaborateOnFixes(selectedProse, judgeReport, { genre, voice, qualityThreshold }) {
    this._emit('fixing', 'Agents collaborating on improvements...');

    const existingFixes = judgeReport.suggestedFixes || [];
    const borrowElements = judgeReport.borrowFromOthers || [];
    const preserveList = judgeReport.strengthsToPreserve || [];

    const systemPrompt = `You are a collaborative editorial team finalizing improvements to a prose passage. A judge has already identified the best version and suggested some fixes. Your job is to:

1. Validate the judge's suggested fixes
2. Identify any additional issues the judge missed
3. Incorporate valuable elements from other candidates (borrowFromOthers)
4. Create a FINAL, PRIORITIZED fix list for a single editor to apply

CRITICAL RULES:
- DO NOT change the core voice or style. These are STRENGTHS to preserve: ${preserveList.join('; ')}
- Each fix must be SURGICAL — change the minimum text necessary
- Fixes must not introduce new problems (AI patterns, cliches, PET phrases)
- Order from highest impact to lowest
- Maximum 5 fixes — focus on the most impactful improvements
${genre ? `- Maintain ${genre} genre conventions` : ''}
${voice && voice !== 'auto' ? `- Maintain ${voice} voice/POV throughout` : ''}

QUALITY TARGET: ${qualityThreshold || 90}/100

Output valid JSON only:
{
  "fixList": [
    {
      "priority": <number 1-5>,
      "type": "voice|rhythm|imagery|dialogue|pacing|clarity|genre|continuity",
      "description": "<what to fix and why>",
      "originalText": "<exact text to find>",
      "replacementText": "<exact replacement>",
      "rationale": "<why this improves the prose>"
    }
  ],
  "preserveWarnings": ["<things the editor must NOT change>"],
  "expectedScoreImpact": "<estimated score improvement>"
}`;

    const text = await this._callApi(systemPrompt,
      `Improve this prose:\n\n"""${selectedProse}"""\n\nJudge's fixes: ${JSON.stringify(existingFixes)}\nElements to borrow: ${JSON.stringify(borrowElements)}\nStrengths to preserve: ${JSON.stringify(preserveList)}`,
      { maxTokens: 4096, temperature: 0.2 }
    );

    const fixPlan = this._parseJson(text);

    this._emit('fixing-complete',
      `Fix plan ready: ${fixPlan.fixList?.length || 0} improvements.`,
      { fixPlan }
    );

    return fixPlan;
  }

  // ═══════════════════════════════════════════════════════════
  //  PHASE 4: EDITOR AGENT APPLIES FIXES
  // ═══════════════════════════════════════════════════════════

  /**
   * A single editor agent applies the agreed fixes to produce final prose.
   */
  async applyFixes(prose, fixPlan) {
    this._emit('editing', 'Editor agent applying fixes...');

    const fixes = fixPlan.fixList || [];
    const warnings = fixPlan.preserveWarnings || [];

    if (fixes.length === 0) {
      this._emit('editing-complete', 'No fixes needed. Prose accepted as-is.');
      return prose;
    }

    const systemPrompt = `You are a meticulous prose editor. Apply the following fixes EXACTLY as specified.

RULES:
- Apply each fix precisely — find the original text and replace it
- If you cannot find the exact original text, find the closest match and apply the fix intent
- DO NOT make any other changes beyond the specified fixes
- DO NOT add commentary, labels, or meta-text
- Preserve all paragraph breaks and formatting
- Output ONLY the complete fixed prose text — nothing else

PRESERVE THESE QUALITIES: ${warnings.join('; ')}`;

    const fixInstructions = fixes.map((f, i) =>
      `FIX ${i + 1} (${f.type}): ${f.description}\n  FIND: "${f.originalText}"\n  REPLACE WITH: "${f.replacementText}"`
    ).join('\n\n');

    const text = await this._callApi(systemPrompt,
      `Apply these fixes:\n\n${fixInstructions}\n\nORIGINAL PROSE:\n"""\n${prose}\n"""`,
      { maxTokens: 8192, temperature: 0.1 }
    );

    // Validate word count drift
    const origWords = (prose.match(/[a-zA-Z'''\u2019-]+/g) || []).length;
    const fixedWords = (text.match(/[a-zA-Z'''\u2019-]+/g) || []).length;
    const drift = Math.abs(fixedWords - origWords) / Math.max(origWords, 1);

    if (drift > 0.20) {
      this._emit('editing-warning',
        `Editor output has ${Math.round(drift * 100)}% word count drift. Using original.`);
      return prose;
    }

    this._emit('editing-complete',
      `Editor applied ${fixes.length} fixes. Words: ${origWords} -> ${fixedWords}`,
      { fixCount: fixes.length, wordsBefore: origWords, wordsAfter: fixedWords }
    );

    return text;
  }

  // ═══════════════════════════════════════════════════════════
  //  PHASE 5: CHAPTER AGENTS — CONTINUITY TRACKING
  // ═══════════════════════════════════════════════════════════

  /**
   * Build a continuity digest for a single chapter's content.
   * Extracts characters, locations, timeline events, plot points, and established facts.
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

      // Check cache
      const existing = this._chapterDigests.get(chapter.id);
      if (existing && existing.contentHash === contentHash) {
        cached++;
        continue;
      }

      // Skip empty chapters
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
  //  PHASE 6: GO/NO-GO — LAUNCH CONTROL SEQUENCE
  // ═══════════════════════════════════════════════════════════

  /**
   * Check a single chapter for conflicts with new prose.
   *
   * @param {string} newProse - The newly generated prose text
   * @param {Object} digest - The chapter's continuity digest
   * @param {string} currentChapterTitle - Title of the chapter being written
   * @returns {{ status: 'GO'|'NO-GO', conflicts: [...] }}
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
   * Polls every chapter agent (except the current chapter) for conflicts.
   *
   * @param {string} newProse - The newly generated prose
   * @param {string} currentChapterId - ID of the chapter being written
   * @param {Array} chapters - All project chapters (with content)
   * @param {string} currentChapterTitle - Title of current chapter
   * @returns {{ overallStatus, results, allConflicts }}
   */
  async runGoNoGo(newProse, currentChapterId, chapters, currentChapterTitle) {
    if (!this.chapterAgentsEnabled) {
      this._emit('go-nogo-skipped', 'Chapter agents disabled. Skipping GO/NO-GO.');
      return { overallStatus: 'GO', results: [], skipped: true };
    }

    // Filter to other chapters that have meaningful content
    const otherChapters = chapters.filter(ch =>
      ch.id !== currentChapterId &&
      ch.content && ch.content.replace(/<[^>]+>/g, '').trim().length > 50
    );

    if (otherChapters.length === 0) {
      this._emit('go-nogo-skipped', 'No other chapters with content. GO by default.');
      return { overallStatus: 'GO', results: [], skipped: true };
    }

    // Ensure digests are current
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
  //  FULL PIPELINE: Orchestrate all phases
  // ═══════════════════════════════════════════════════════════

  /**
   * Run the complete multi-agent pipeline:
   *   Phase 1 → N writing agents generate in parallel
   *   Phase 2 → Judge selects best candidate
   *   Phase 3 → Agents collaborate on fixes
   *   Phase 4 → Editor applies fixes
   *   Phase 5 → Chapter agents GO/NO-GO
   *
   * @param {Object} params
   * @returns {{ prose, candidates, judgeReport, fixPlan, goNoGoResult, winner }}
   */
  async runFullPipeline(params) {
    const {
      systemPrompt, userPrompt, maxTokens,
      genre, voice, authorPalette, qualityThreshold,
      currentChapterId, currentChapterTitle, chapters
    } = params;

    this._abortController = new AbortController();

    try {
      // Phase 1
      this._emit('pipeline', '=== PHASE 1: Multi-Agent Generation ===');
      const candidates = await this.generateWithAgents({ systemPrompt, userPrompt, maxTokens });

      // Phase 2
      this._emit('pipeline', '=== PHASE 2: Judge Agent Evaluation ===');
      const { winner, report } = await this.judgeAndSelect(candidates, {
        genre, voice, authorPalette, qualityThreshold
      });

      let finalProse = winner.text;

      // Phase 3
      this._emit('pipeline', '=== PHASE 3: Collaborative Fix Planning ===');
      const fixPlan = await this.collaborateOnFixes(finalProse, report, {
        genre, voice, qualityThreshold
      });

      // Phase 4
      if (fixPlan.fixList && fixPlan.fixList.length > 0) {
        this._emit('pipeline', '=== PHASE 4: Editor Agent Applying Fixes ===');
        finalProse = await this.applyFixes(finalProse, fixPlan);
      } else {
        this._emit('pipeline', '=== PHASE 4: Skipped (no fixes needed) ===');
      }

      // Phase 5
      let goNoGoResult = { overallStatus: 'GO', results: [], skipped: true };
      if (this.chapterAgentsEnabled && chapters && chapters.length > 1) {
        this._emit('pipeline', '=== PHASE 5: GO/NO-GO Launch Control ===');
        goNoGoResult = await this.runGoNoGo(
          finalProse, currentChapterId, chapters, currentChapterTitle
        );
      } else {
        this._emit('pipeline', '=== PHASE 5: Skipped (single chapter or agents disabled) ===');
      }

      this._abortController = null;

      return { prose: finalProse, candidates, judgeReport: report, fixPlan, goNoGoResult, winner };
    } catch (err) {
      this._abortController = null;
      throw err;
    }
  }
}

export { MultiAgentOrchestrator };
