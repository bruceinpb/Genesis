/**
 * Genesis 2 — Error Pattern Database
 * Tracks prose errors found during scoring across all projects.
 * Builds a cross-project "negative prompt" database that helps the AI
 * avoid repeating the same mistakes during prose generation.
 *
 * Each error pattern records:
 *   - The problematic text
 *   - The category (pet-phrase, telling, cliche, weak-words, passive, structure, pacing, ai-pattern, other)
 *   - The problem description
 *   - How many times this pattern has been seen (frequency)
 *   - Which projects/chapters it was found in
 *   - The severity and estimated impact
 *
 * The database aggregates patterns over time, so high-frequency errors
 * become strong negative prompts during future prose generation.
 */

class ErrorDatabase {
  /**
   * @param {object} storage - The IndexedDB Storage instance
   * @param {object} firestoreStorage - The FirestoreStorage instance (for cloud sync)
   */
  constructor(storage, firestoreStorage) {
    this.storage = storage;
    this.fs = firestoreStorage;
    this._cache = null;
    this._cacheTime = 0;
    this._cacheTTL = 30000; // 30s cache
  }

  /**
   * Record errors from a scoring review into the database.
   * Called after each scoring pass (chunk or final).
   *
   * @param {object} review - The scoring review object from scoreProse()
   * @param {object} context - { projectId, chapterId, chapterTitle, genre, sessionKey }
   *   sessionKey: optional unique key for the current iteration session.
   *   When provided, each pattern is only recorded once per session to prevent
   *   duplicate frequency bumps during iterative refinement loops.
   */
  async recordFromReview(review, context = {}) {
    if (!review) return;

    const timestamp = Date.now();
    const entries = [];

    // Extract issues
    if (review.issues && review.issues.length > 0) {
      for (const issue of review.issues) {
        entries.push({
          text: issue.text || '',
          category: issue.category || 'other',
          problem: issue.problem || '',
          severity: issue.severity || 'medium',
          estimatedImpact: issue.estimatedImpact || 1,
          source: 'scoring-issue'
        });
      }
    }

    // Extract AI patterns
    if (review.aiPatterns && review.aiPatterns.length > 0) {
      for (const pattern of review.aiPatterns) {
        entries.push({
          text: pattern.examples?.[0] || '',
          category: 'ai-pattern',
          problem: `AI Pattern: ${pattern.pattern}`,
          severity: 'high',
          estimatedImpact: pattern.estimatedImpact || 3,
          source: 'ai-pattern'
        });
      }
    }

    // Store each entry, merging with existing patterns
    for (const entry of entries) {
      await this._mergePattern(entry, context, timestamp);
    }

    // Invalidate cache
    this._cache = null;
  }

  /**
   * Merge a new error entry with existing patterns.
   * If a similar pattern exists, increment its frequency (once per session).
   * Otherwise, create a new pattern entry.
   *
   * Session-aware: When context.sessionKey is provided, frequency is only
   * incremented once per session per pattern to prevent inflated counts
   * during iterative refinement loops.
   */
  async _mergePattern(entry, context, timestamp) {
    const key = this._patternKey(entry);
    const existing = await this.storage.get('errorPatterns', key);

    if (existing) {
      // Session-aware deduplication: skip frequency bump if already recorded this session
      const sessionKey = context.sessionKey || null;
      const alreadySeenThisSession = sessionKey && existing._lastSessionKey === sessionKey;

      if (!alreadySeenThisSession) {
        existing.frequency = (existing.frequency || 1) + 1;
      }
      existing.lastSeen = timestamp;
      if (sessionKey) existing._lastSessionKey = sessionKey;
      existing.estimatedImpact = Math.max(existing.estimatedImpact, entry.estimatedImpact);
      // Track which projects this pattern appears in
      if (context.projectId && !existing.projectIds.includes(context.projectId)) {
        existing.projectIds.push(context.projectId);
      }
      // Update severity to the highest seen
      if (entry.severity === 'high' || existing.severity === 'high') {
        existing.severity = 'high';
      } else if (entry.severity === 'medium' || existing.severity === 'medium') {
        existing.severity = 'medium';
      }
      await this.storage.put('errorPatterns', existing);
    } else {
      // Create new pattern
      const pattern = {
        id: key,
        text: entry.text,
        category: entry.category,
        problem: entry.problem,
        severity: entry.severity,
        estimatedImpact: entry.estimatedImpact,
        source: entry.source,
        frequency: 1,
        firstSeen: timestamp,
        lastSeen: timestamp,
        projectIds: context.projectId ? [context.projectId] : [],
        dismissed: false,
        _lastSessionKey: context.sessionKey || null
      };
      await this.storage.put('errorPatterns', pattern);
    }
  }

  /**
   * Generate a stable key for a pattern based on its category and problem description.
   * Similar problems get merged under the same key.
   */
  _patternKey(entry) {
    // Normalize the problem description for deduplication
    const normalized = (entry.problem || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 80);
    const category = (entry.category || 'other').toLowerCase();
    return `ep_${category}_${normalized}`;
  }

  /**
   * Get all active error patterns, sorted by frequency (most common first).
   * Filters out dismissed patterns.
   *
   * @param {object} options - { minFrequency, category, limit }
   * @returns {Array} Sorted array of error patterns
   */
  async getPatterns(options = {}) {
    const { minFrequency = 1, category = null, limit = 100 } = options;

    // Use cache if fresh
    if (this._cache && (Date.now() - this._cacheTime) < this._cacheTTL) {
      return this._filterPatterns(this._cache, { minFrequency, category, limit });
    }

    const allPatterns = await this.storage.getAll('errorPatterns');
    this._cache = allPatterns.filter(p => !p.dismissed);
    this._cacheTime = Date.now();

    return this._filterPatterns(this._cache, { minFrequency, category, limit });
  }

  _filterPatterns(patterns, { minFrequency, category, limit }) {
    let result = patterns.filter(p => p.frequency >= minFrequency);
    if (category) {
      result = result.filter(p => p.category === category);
    }
    result.sort((a, b) => {
      // Sort by frequency * impact (weighted importance)
      const scoreA = a.frequency * a.estimatedImpact;
      const scoreB = b.frequency * b.estimatedImpact;
      return scoreB - scoreA;
    });
    return result.slice(0, limit);
  }

  /**
   * Build the negative prompt section to inject into prose generation.
   * Returns a string of instructions based on the most frequent error patterns.
   *
   * @param {object} options - { maxPatterns, minFrequency }
   * @returns {string} The negative prompt text to inject into the system prompt
   */
  async buildNegativePrompt(options = {}) {
    const { maxPatterns = 20, minFrequency = 2 } = options;

    const patterns = await this.getPatterns({ minFrequency, limit: maxPatterns });
    if (patterns.length === 0) return '';

    // Group patterns by category for organized output
    const grouped = {};
    for (const p of patterns) {
      const cat = p.category || 'other';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(p);
    }

    const categoryLabels = {
      'pet-phrase': 'PET Phrases (Physical Emotional Telling)',
      'telling': 'Telling Instead of Showing',
      'cliche': 'Cliches',
      'weak-words': 'Weak/Filler Words',
      'passive': 'Passive Voice',
      'structure': 'Structural Issues',
      'pacing': 'Pacing Problems',
      'ai-pattern': 'AI Writing Patterns',
      'other': 'Other Issues'
    };

    let prompt = `\n=== ERROR PATTERN DATABASE (learned from previous scoring) ===`;
    prompt += `\nThe following problems have been repeatedly found in past prose generation across projects. AVOID ALL of these:`;

    for (const [cat, items] of Object.entries(grouped)) {
      prompt += `\n\n${categoryLabels[cat] || cat} (found ${items.reduce((s, i) => s + i.frequency, 0)} times total):`;
      for (const item of items.slice(0, 8)) {
        const freq = item.frequency > 1 ? ` [seen ${item.frequency}x]` : '';
        if (item.text) {
          prompt += `\n- AVOID: "${item.text}" — ${item.problem}${freq}`;
        } else {
          prompt += `\n- ${item.problem}${freq}`;
        }
      }
    }

    prompt += `\n=== END ERROR PATTERN DATABASE ===`;

    // Add compact sentence-level checklist for quick reference during writing
    const checklist = await this.buildSentenceChecklist({ maxItems: 15 });
    if (checklist) {
      prompt += checklist;
    }

    return prompt;
  }

  /**
   * Dismiss a pattern (won't be included in negative prompts).
   * @param {string} patternId
   */
  async dismissPattern(patternId) {
    const pattern = await this.storage.get('errorPatterns', patternId);
    if (pattern) {
      pattern.dismissed = true;
      await this.storage.put('errorPatterns', pattern);
      this._cache = null;
    }
  }

  /**
   * Restore a dismissed pattern.
   * @param {string} patternId
   */
  async restorePattern(patternId) {
    const pattern = await this.storage.get('errorPatterns', patternId);
    if (pattern) {
      pattern.dismissed = false;
      await this.storage.put('errorPatterns', pattern);
      this._cache = null;
    }
  }

  /**
   * Delete a pattern permanently.
   * @param {string} patternId
   */
  async deletePattern(patternId) {
    await this.storage.delete('errorPatterns', patternId);
    this._cache = null;
  }

  /**
   * Clear all patterns (reset the database).
   */
  async clearAll() {
    const all = await this.storage.getAll('errorPatterns');
    for (const p of all) {
      await this.storage.delete('errorPatterns', p.id);
    }
    this._cache = null;
  }

  /**
   * Analyze and classify all active error patterns.
   * Groups errors by category and severity, identifies the most impactful patterns,
   * and returns a structured analysis useful for targeted prose improvement.
   *
   * @returns {object} Classified error analysis
   */
  async analyzeErrors() {
    const patterns = await this.getPatterns({ minFrequency: 1, limit: 200 });

    const analysis = {
      byCategory: {},
      bySeverity: { high: [], medium: [], low: [] },
      topOffenders: [],
      totalPatterns: patterns.length,
      totalOccurrences: 0
    };

    for (const p of patterns) {
      const cat = p.category || 'other';
      if (!analysis.byCategory[cat]) {
        analysis.byCategory[cat] = { patterns: [], totalFrequency: 0, avgImpact: 0 };
      }
      analysis.byCategory[cat].patterns.push(p);
      analysis.byCategory[cat].totalFrequency += p.frequency;

      const sev = p.severity || 'medium';
      if (analysis.bySeverity[sev]) {
        analysis.bySeverity[sev].push(p);
      }

      analysis.totalOccurrences += p.frequency;
    }

    // Calculate average impact per category
    for (const cat of Object.values(analysis.byCategory)) {
      cat.avgImpact = cat.patterns.length > 0
        ? Math.round(cat.patterns.reduce((s, p) => s + p.estimatedImpact, 0) / cat.patterns.length * 10) / 10
        : 0;
    }

    // Top offenders: highest frequency * impact
    analysis.topOffenders = patterns
      .sort((a, b) => (b.frequency * b.estimatedImpact) - (a.frequency * a.estimatedImpact))
      .slice(0, 10);

    return analysis;
  }

  /**
   * Build a concise sentence-level checklist for real-time error checking during prose creation.
   * Returns a compact string that can be injected into the generation prompt.
   *
   * @param {object} options - { maxItems: number }
   * @returns {string} Compact checklist for sentence-level checking
   */
  async buildSentenceChecklist(options = {}) {
    const { maxItems = 30 } = options;
    const patterns = await this.getPatterns({ minFrequency: 1, limit: maxItems });
    if (patterns.length === 0) return '';

    const categoryLabels = {
      'pet-phrase': 'PET',
      'telling': 'TELL',
      'cliche': 'CLICHE',
      'weak-words': 'WEAK',
      'passive': 'PASSIVE',
      'structure': 'STRUCT',
      'pacing': 'PACE',
      'ai-pattern': 'AI',
      'other': 'OTHER'
    };

    let checklist = '\n=== SENTENCE-LEVEL ERROR CHECKLIST (check EVERY sentence against this) ===\n';
    checklist += 'Before writing each sentence, verify it does NOT contain:\n';

    for (const p of patterns) {
      const tag = categoryLabels[p.category] || 'OTHER';
      if (p.text) {
        checklist += `[${tag}] "${p.text}" (${p.problem})\n`;
      } else {
        checklist += `[${tag}] ${p.problem}\n`;
      }
    }

    checklist += '=== END CHECKLIST ===\n';
    return checklist;
  }

  /**
   * Get summary statistics about the error database.
   */
  async getStats() {
    const all = await this.storage.getAll('errorPatterns');
    const active = all.filter(p => !p.dismissed);
    const dismissed = all.filter(p => p.dismissed);

    const categories = {};
    for (const p of active) {
      categories[p.category] = (categories[p.category] || 0) + 1;
    }

    const totalOccurrences = active.reduce((sum, p) => sum + p.frequency, 0);
    const projectCount = new Set(active.flatMap(p => p.projectIds || [])).size;

    return {
      totalPatterns: active.length,
      dismissedPatterns: dismissed.length,
      totalOccurrences,
      projectCount,
      categories,
      topPatterns: active
        .sort((a, b) => (b.frequency * b.estimatedImpact) - (a.frequency * a.estimatedImpact))
        .slice(0, 5)
    };
  }
}

export { ErrorDatabase };
