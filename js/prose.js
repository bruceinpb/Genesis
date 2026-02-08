/**
 * Genesis 2 — Prose Analysis Engine
 * Analyzes writing quality to help authors craft best-seller prose.
 * Evaluates sentence variety, word choice, pacing, readability, and more.
 */

class ProseAnalyzer {
  constructor() {
    // Common weak/overused words that dilute prose
    this.weakWords = new Set([
      'very', 'really', 'just', 'quite', 'rather', 'somewhat', 'basically',
      'actually', 'literally', 'definitely', 'certainly', 'obviously',
      'simply', 'totally', 'completely', 'absolutely', 'probably',
      'thing', 'things', 'stuff', 'got', 'get', 'getting',
      'nice', 'good', 'bad', 'big', 'small', 'pretty'
    ]);

    // Filter words — often signal telling instead of showing
    this.filterWords = new Set([
      'felt', 'noticed', 'realized', 'saw', 'heard', 'watched',
      'seemed', 'appeared', 'looked', 'thought', 'knew', 'wondered',
      'decided', 'understood', 'recognized', 'remembered'
    ]);

    // Common cliches to flag
    this.cliches = [
      'at the end of the day', 'in the nick of time', 'few and far between',
      'better late than never', 'time will tell', 'only time will tell',
      'it was a dark and stormy', 'dead as a doornail', 'fit as a fiddle',
      'cold as ice', 'quiet as a mouse', 'sharp as a tack',
      'white as a sheet', 'scared to death', 'bated breath',
      'sigh of relief', 'blood ran cold', 'heart skipped a beat',
      'pit of .* stomach', 'knot in .* stomach', 'butterflies in .* stomach',
      'shivers? down .* spine', 'tears streamed', 'eyes widened',
      'jaw dropped', 'let out a breath', 'didn\'t realize .* was holding',
      'crystal clear', 'easier said than done', 'last but not least',
      'needle in a haystack', 'once in a lifetime', 'tip of the iceberg'
    ];

    // PET phrases — Physical Emotional Telling: lazy body-reaction shortcuts
    this.petPhrases = [
      'throat tightened', 'throat constricted', 'chest tightened', 'chest constricted',
      'breath caught', 'breath hitched', 'held .* breath',
      'stomach churned', 'stomach dropped', 'stomach knotted', 'stomach clenched', 'stomach sank',
      'heart pounded', 'heart hammered', 'heart raced', 'heart sank', 'heart clenched', 'heart skipped',
      'blood ran cold', 'blood drained',
      'eyes widened', 'eyes narrowed', 'eyes burned', 'eyes stung', 'eyes glistened', 'eyes welled',
      'jaw clenched', 'jaw tightened', 'teeth gritted',
      'fists? clenched', 'fists? balled', 'hands? trembled', 'hands? shook',
      'shoulders tensed', 'shoulders slumped', 'spine stiffened',
      'knees weakened', 'knees buckled', 'legs turned to',
      'skin crawled', 'skin prickled', 'hairs? stood on end', 'goosebumps',
      'bile rose', 'mouth went dry', 'swallowed hard', 'swallowed thickly',
      'tears pricked', 'tears threatened', 'vision blurred',
      'voice cracked', 'voice broke', 'voice wavered', 'voice trembled',
      'chill ran down', 'chill ran up', 'shiver ran through',
      'weight settled in', 'nostrils flared', 'lip trembled', 'lip quivered',
      'pulse quickened', 'pulse raced', 'temples throbbed'
    ];

    // Words that often indicate passive voice
    this.passiveHelpers = new Set([
      'was', 'were', 'been', 'being', 'is', 'are', 'am'
    ]);

    this.pastParticipleSuffixes = ['ed', 'en', 'wn', 'ne', 'nt', 'ht', 'lt', 'ft'];
  }

  /**
   * Full analysis of a text passage.
   * Returns a comprehensive report object.
   */
  analyze(text) {
    if (!text || text.trim().length === 0) {
      return this._emptyReport();
    }

    const cleanText = this._stripHtml(text);
    const words = this._getWords(cleanText);
    const sentences = this._getSentences(cleanText);
    const paragraphs = this._getParagraphs(cleanText);

    return {
      counts: this._getCounts(words, sentences, paragraphs, cleanText),
      readability: this._getReadability(words, sentences),
      sentenceVariety: this._getSentenceVariety(sentences),
      wordChoice: this._getWordChoice(words, cleanText),
      pacing: this._getPacing(paragraphs, sentences),
      dialogue: this._getDialogueRatio(cleanText),
      cliches: this._findCliches(cleanText),
      petPhrases: this._findPetPhrases(cleanText),
      passiveVoice: this._findPassiveVoice(sentences),
      adverbs: this._findAdverbs(words),
      repetition: this._findRepetition(words),
      openingAnalysis: this._analyzeOpenings(sentences),
      score: 0 // calculated below
    };
  }

  /**
   * Quick word count (fast path for status bar).
   */
  wordCount(text) {
    if (!text) return 0;
    const clean = this._stripHtml(text);
    return this._getWords(clean).length;
  }

  // --- Private analysis methods ---

  _emptyReport() {
    return {
      counts: { words: 0, sentences: 0, paragraphs: 0, characters: 0, pages: 0 },
      readability: { fleschKincaid: 0, gradeLevel: 0, avgWordsPerSentence: 0, avgSyllablesPerWord: 0 },
      sentenceVariety: { lengths: [], categories: {}, varietyScore: 0 },
      wordChoice: { weakWords: [], filterWords: [], uniqueWordRatio: 0 },
      pacing: { avgParagraphLength: 0, dialogueBeats: 0 },
      dialogue: { ratio: 0, wordCount: 0 },
      cliches: [],
      petPhrases: [],
      passiveVoice: { instances: [], percentage: 0 },
      adverbs: { list: [], percentage: 0 },
      repetition: [],
      openingAnalysis: { repeated: [] },
      score: 0
    };
  }

  _stripHtml(html) {
    const div = typeof document !== 'undefined' ? document.createElement('div') : null;
    if (div) {
      div.innerHTML = html;
      return div.textContent || div.innerText || '';
    }
    return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');
  }

  _getWords(text) {
    return text.match(/[a-zA-Z''-]+/g) || [];
  }

  _getSentences(text) {
    // Split on sentence-ending punctuation followed by space or end
    const raw = text.split(/(?<=[.!?])\s+/);
    return raw.filter(s => s.trim().length > 0);
  }

  _getParagraphs(text) {
    return text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  }

  _getCounts(words, sentences, paragraphs, text) {
    const charCount = text.replace(/\s/g, '').length;
    // Standard manuscript page: ~250 words
    const pages = Math.ceil(words.length / 250);
    return {
      words: words.length,
      sentences: sentences.length,
      paragraphs: paragraphs.length,
      characters: charCount,
      pages
    };
  }

  _getReadability(words, sentences) {
    if (words.length === 0 || sentences.length === 0) {
      return { fleschKincaid: 0, gradeLevel: 0, avgWordsPerSentence: 0, avgSyllablesPerWord: 0 };
    }

    const avgWordsPerSentence = words.length / sentences.length;
    const totalSyllables = words.reduce((sum, w) => sum + this._syllableCount(w), 0);
    const avgSyllablesPerWord = totalSyllables / words.length;

    // Flesch Reading Ease
    const fleschKincaid = 206.835 - (1.015 * avgWordsPerSentence) - (84.6 * avgSyllablesPerWord);

    // Flesch-Kincaid Grade Level
    const gradeLevel = (0.39 * avgWordsPerSentence) + (11.8 * avgSyllablesPerWord) - 15.59;

    return {
      fleschKincaid: Math.round(Math.max(0, Math.min(100, fleschKincaid)) * 10) / 10,
      gradeLevel: Math.round(Math.max(0, gradeLevel) * 10) / 10,
      avgWordsPerSentence: Math.round(avgWordsPerSentence * 10) / 10,
      avgSyllablesPerWord: Math.round(avgSyllablesPerWord * 100) / 100
    };
  }

  _syllableCount(word) {
    word = word.toLowerCase().replace(/[^a-z]/g, '');
    if (word.length <= 3) return 1;

    word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
    word = word.replace(/^y/, '');

    const matches = word.match(/[aeiouy]{1,2}/g);
    return matches ? matches.length : 1;
  }

  _getSentenceVariety(sentences) {
    const lengths = sentences.map(s => {
      const words = this._getWords(s);
      return words.length;
    });

    const categories = { short: 0, medium: 0, long: 0, veryLong: 0 };
    lengths.forEach(len => {
      if (len <= 8) categories.short++;
      else if (len <= 18) categories.medium++;
      else if (len <= 30) categories.long++;
      else categories.veryLong++;
    });

    // Variety score: standard deviation of sentence lengths (higher = more variety)
    const avg = lengths.reduce((a, b) => a + b, 0) / (lengths.length || 1);
    const variance = lengths.reduce((sum, len) => sum + Math.pow(len - avg, 2), 0) / (lengths.length || 1);
    const stdDev = Math.sqrt(variance);

    // Normalize to 0-100 score (good prose has moderate variety, ~6-12 stdDev)
    let varietyScore = Math.min(100, (stdDev / 10) * 100);
    if (stdDev > 15) varietyScore = Math.max(50, 100 - (stdDev - 15) * 5);

    return {
      lengths,
      categories,
      varietyScore: Math.round(varietyScore)
    };
  }

  _getWordChoice(words, text) {
    const lower = words.map(w => w.toLowerCase());

    const foundWeak = [];
    const weakCounts = {};
    lower.forEach(w => {
      if (this.weakWords.has(w)) {
        weakCounts[w] = (weakCounts[w] || 0) + 1;
      }
    });
    for (const [word, count] of Object.entries(weakCounts)) {
      foundWeak.push({ word, count });
    }
    foundWeak.sort((a, b) => b.count - a.count);

    const foundFilter = [];
    const filterCounts = {};
    lower.forEach(w => {
      if (this.filterWords.has(w)) {
        filterCounts[w] = (filterCounts[w] || 0) + 1;
      }
    });
    for (const [word, count] of Object.entries(filterCounts)) {
      foundFilter.push({ word, count });
    }
    foundFilter.sort((a, b) => b.count - a.count);

    // Unique word ratio (lexical diversity)
    const unique = new Set(lower);
    const uniqueWordRatio = words.length > 0 ? unique.size / words.length : 0;

    return {
      weakWords: foundWeak,
      filterWords: foundFilter,
      uniqueWordRatio: Math.round(uniqueWordRatio * 100) / 100
    };
  }

  _getPacing(paragraphs, sentences) {
    const parLengths = paragraphs.map(p => this._getWords(p).length);
    const avgParagraphLength = parLengths.reduce((a, b) => a + b, 0) / (parLengths.length || 1);

    return {
      avgParagraphLength: Math.round(avgParagraphLength),
      paragraphLengths: parLengths
    };
  }

  _getDialogueRatio(text) {
    // Count words inside quotation marks
    const dialogueMatches = text.match(/[""\u201C\u201D]([^""\u201C\u201D]*?)[""\u201C\u201D]/g) || [];
    let dialogueWordCount = 0;
    dialogueMatches.forEach(match => {
      dialogueWordCount += this._getWords(match).length;
    });

    const totalWords = this._getWords(text).length;
    const ratio = totalWords > 0 ? dialogueWordCount / totalWords : 0;

    return {
      ratio: Math.round(ratio * 100) / 100,
      wordCount: dialogueWordCount
    };
  }

  _findCliches(text) {
    const lower = text.toLowerCase();
    const found = [];

    this.cliches.forEach(cliche => {
      const regex = new RegExp(cliche, 'gi');
      const matches = lower.match(regex);
      if (matches) {
        found.push({ phrase: cliche, count: matches.length });
      }
    });

    return found;
  }

  _findPetPhrases(text) {
    const lower = text.toLowerCase();
    const found = [];

    this.petPhrases.forEach(phrase => {
      const regex = new RegExp(phrase, 'gi');
      const matches = lower.match(regex);
      if (matches) {
        found.push({ phrase, count: matches.length });
      }
    });

    return found;
  }

  _findPassiveVoice(sentences) {
    const instances = [];
    let passiveCount = 0;

    sentences.forEach(sentence => {
      const words = sentence.split(/\s+/);
      for (let i = 0; i < words.length - 1; i++) {
        const clean = words[i].toLowerCase().replace(/[^a-z]/g, '');
        if (this.passiveHelpers.has(clean)) {
          const next = (words[i + 1] || '').toLowerCase().replace(/[^a-z]/g, '');
          if (this.pastParticipleSuffixes.some(suffix => next.endsWith(suffix)) && next.length > 3) {
            instances.push({
              phrase: words[i] + ' ' + words[i + 1],
              sentence: sentence.substring(0, 80)
            });
            passiveCount++;
            break;
          }
        }
      }
    });

    return {
      instances: instances.slice(0, 20),
      percentage: sentences.length > 0 ? Math.round((passiveCount / sentences.length) * 100) : 0
    };
  }

  _findAdverbs(words) {
    const adverbs = {};
    words.forEach(w => {
      const lower = w.toLowerCase();
      if (lower.endsWith('ly') && lower.length > 4 && !['only', 'early', 'family', 'holy', 'ugly', 'belly', 'jelly', 'lonely', 'lovely', 'likely', 'friendly'].includes(lower)) {
        adverbs[lower] = (adverbs[lower] || 0) + 1;
      }
    });

    const list = Object.entries(adverbs)
      .map(([word, count]) => ({ word, count }))
      .sort((a, b) => b.count - a.count);

    const totalAdverbs = list.reduce((sum, a) => sum + a.count, 0);

    return {
      list: list.slice(0, 20),
      percentage: words.length > 0 ? Math.round((totalAdverbs / words.length) * 1000) / 10 : 0
    };
  }

  _findRepetition(words) {
    // Find words repeated too often (excluding common words)
    const commonWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'is', 'was', 'are', 'were', 'be', 'been', 'have',
      'has', 'had', 'do', 'did', 'will', 'would', 'could', 'should', 'may',
      'might', 'shall', 'can', 'it', 'its', 'he', 'she', 'they', 'them',
      'his', 'her', 'their', 'this', 'that', 'these', 'those', 'i', 'my',
      'me', 'we', 'our', 'you', 'your', 'not', 'no', 'so', 'if', 'then',
      'than', 'as', 'from', 'up', 'out', 'into', 'about', 'all', 'there',
      'when', 'what', 'who', 'which', 'where', 'how', 'said'
    ]);

    const counts = {};
    words.forEach(w => {
      const lower = w.toLowerCase();
      if (lower.length > 3 && !commonWords.has(lower)) {
        counts[lower] = (counts[lower] || 0) + 1;
      }
    });

    // Flag words that appear more than 3 times per 1000 words
    const threshold = Math.max(3, Math.floor(words.length / 300));
    return Object.entries(counts)
      .filter(([, count]) => count >= threshold)
      .map(([word, count]) => ({
        word,
        count,
        frequency: Math.round((count / words.length) * 10000) / 100
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);
  }

  _analyzeOpenings(sentences) {
    // Check if too many sentences start with the same word
    const openings = {};
    sentences.forEach(s => {
      const firstWord = (s.match(/^[a-zA-Z]+/) || [''])[0].toLowerCase();
      if (firstWord) {
        openings[firstWord] = (openings[firstWord] || 0) + 1;
      }
    });

    const repeated = Object.entries(openings)
      .filter(([, count]) => count > 2)
      .map(([word, count]) => ({
        word,
        count,
        percentage: Math.round((count / sentences.length) * 100)
      }))
      .sort((a, b) => b.count - a.count);

    return { repeated };
  }

  /**
   * Generate a prose quality score (0-100) from analysis results.
   */
  calculateScore(analysis) {
    let score = 70; // Baseline

    // Readability (best sellers typically score 60-80 Flesch)
    const fk = analysis.readability.fleschKincaid;
    if (fk >= 55 && fk <= 85) score += 5;
    else if (fk < 40 || fk > 90) score -= 5;

    // Sentence variety
    if (analysis.sentenceVariety.varietyScore > 60) score += 5;
    else if (analysis.sentenceVariety.varietyScore < 30) score -= 5;

    // Weak words penalty
    const weakTotal = analysis.wordChoice.weakWords.reduce((s, w) => s + w.count, 0);
    const weakRatio = analysis.counts.words > 0 ? weakTotal / analysis.counts.words : 0;
    if (weakRatio > 0.03) score -= 5;
    if (weakRatio > 0.05) score -= 5;

    // Passive voice penalty
    if (analysis.passiveVoice.percentage > 20) score -= 5;
    if (analysis.passiveVoice.percentage > 35) score -= 5;

    // Adverb penalty
    if (analysis.adverbs.percentage > 2) score -= 3;
    if (analysis.adverbs.percentage > 4) score -= 5;

    // Cliche penalty
    if (analysis.cliches.length > 0) score -= analysis.cliches.length * 2;

    // PET phrase penalty — these are lazy emotional shortcuts
    if (analysis.petPhrases && analysis.petPhrases.length > 0) {
      const petCount = analysis.petPhrases.reduce((s, p) => s + p.count, 0);
      score -= Math.min(15, petCount * 3); // -3 per PET phrase, max -15
    }

    // Lexical diversity bonus
    if (analysis.wordChoice.uniqueWordRatio > 0.5) score += 3;
    if (analysis.wordChoice.uniqueWordRatio > 0.65) score += 3;

    // Dialogue balance bonus (20-50% is typical for fiction)
    const dr = analysis.dialogue.ratio;
    if (dr >= 0.15 && dr <= 0.55) score += 3;

    return Math.max(0, Math.min(100, Math.round(score)));
  }
}

export { ProseAnalyzer };
