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

  // ========================================
  //  Deterministic Prose Lint (Prose CI/CD)
  // ========================================

  /**
   * Deterministic lint pass — detects hard defects without an API call.
   * Returns { defects[], stats{} } where each defect has:
   *   { type, severity, text, position, suggestion }
   * Stats include sentence length variance, filter word count, etc.
   */
  lintProse(text) {
    if (!text || text.trim().length === 0) {
      return { defects: [], stats: {} };
    }

    const cleanText = this._stripHtml(text);
    const words = this._getWords(cleanText);
    const sentences = this._getSentences(cleanText);
    const lower = cleanText.toLowerCase();
    const defects = [];

    // --- Hard Gate 1: Repeated n-grams (8+ word sequences repeated) ---
    const ngramRepeats = this._findRepeatedNgrams(cleanText, 6);
    for (const ng of ngramRepeats) {
      defects.push({
        type: 'repeated-ngram',
        severity: 'hard',
        text: ng.ngram,
        position: ng.positions[0],
        suggestion: `Repeated phrase "${ng.ngram}" appears ${ng.count} times. Rephrase at least one occurrence.`
      });
    }

    // --- Hard Gate 2: Template transitions ---
    const templateTransitions = [
      'suddenly', 'in that moment', 'little did .* know', 'it was then that',
      'as if on cue', 'without warning', 'before .* knew it',
      'in the blink of an eye', 'out of nowhere', 'all of a sudden',
      'at that very moment', 'just then', 'meanwhile'
    ];
    for (const tt of templateTransitions) {
      const regex = new RegExp(`\\b${tt}\\b`, 'gi');
      let match;
      while ((match = regex.exec(lower)) !== null) {
        defects.push({
          type: 'template-transition',
          severity: 'hard',
          text: match[0],
          position: match.index,
          suggestion: `Template transition "${match[0]}". Remove or replace with a concrete action.`
        });
      }
    }

    // --- Hard Gate 3: AI cadence clusters (EXPANDED) ---
    const aiWords = [
      // Existing
      'delicate', 'intricate', 'testament to', 'tapestry', 'symphony of',
      'dance of', 'nestled', 'whispering', 'pierced the silence',
      'shattered the silence', 'hung in the air', 'palpable',
      'echoed through', 'weight of .* words', 'a sense of',
      // NEW — common AI writing flourishes
      'couldn\'t help but', 'seemed to .* itself',
      'the world .* around', 'something .* shifted',
      'the silence .* between', 'a wave of',
      'washed over', 'settled over', 'crept into',
      'the air .* thick', 'the air .* heavy', 'the air .* between',
      'a flicker of', 'a hint of', 'a ghost of',
      'the ghost of a smile', 'the hint of a smile',
      'threatened to', 'dared to', 'refused to .* away',
      'the weight of', 'the enormity of', 'the gravity of',
      'unmistakable', 'undeniable', 'unmistakably',
      'in the depths of', 'in the stillness',
      'the rhythm of', 'the cadence of', 'the melody of',
      'a kaleidoscope', 'myriad', 'juxtaposition',
      'resonated', 'reverberated', 'permeated',
      'visceral', 'tangible(?!\\s+(?:object|thing|item))', 'ineffable',
      'profound(?!ly\\s+(?:deaf|different|impact))',
      'bittersweet', 'bittersweetness',
      'the irony .* not lost',
      'a mixture of .* and',  // "a mixture of sadness and relief"
      'both .* and .* at the same time',  // "both terrified and exhilarated at the same time"
      'something between .* and',  // "something between a laugh and a sob"
      'as if the .* itself',  // "as if the house itself knew"
      'knowledge .* inside',  // "knowledge living inside the binding"
      'living inside',  // personification AI pattern
    ];
    for (const aw of aiWords) {
      const regex = new RegExp(`\\b${aw}\\b`, 'gi');
      let match;
      while ((match = regex.exec(lower)) !== null) {
        defects.push({
          type: 'ai-pattern',
          severity: 'hard',
          text: match[0],
          position: match.index,
          suggestion: `AI-telltale word/phrase "${match[0]}". Replace with a concrete, specific alternative.`
        });
      }
    }

    // --- Hard Gate 4: PET phrases ---
    const petFinds = this._findPetPhrases(cleanText);
    for (const pf of petFinds) {
      const regex = new RegExp(pf.phrase, 'gi');
      let match;
      while ((match = regex.exec(lower)) !== null) {
        defects.push({
          type: 'pet-phrase',
          severity: 'hard',
          text: match[0],
          position: match.index,
          suggestion: `PET phrase "${match[0]}". Replace with character-specific action that implies the emotion.`
        });
      }
    }

    // --- Hard Gate 5: Em dashes ---
    const emDashRegex = /[\u2014\u2013]|---/g;
    let emMatch;
    while ((emMatch = emDashRegex.exec(cleanText)) !== null) {
      defects.push({
        type: 'em-dash',
        severity: 'hard',
        text: emMatch[0],
        position: emMatch.index,
        suggestion: 'Em dash found. Replace with comma, semicolon, colon, period, or parentheses.'
      });
    }

    // --- Hard Gate 6: Perspective slips (detect mixed pronouns) ---
    // This is heuristic — count first-person vs third-person pronouns
    const firstPersonCount = (lower.match(/\b(i|me|my|myself|mine)\b/g) || []).length;
    const thirdPersonCount = (lower.match(/\b(he|she|him|her|his|hers|himself|herself)\b/g) || []).length;
    if (firstPersonCount > 5 && thirdPersonCount > 5) {
      const ratio = Math.min(firstPersonCount, thirdPersonCount) / Math.max(firstPersonCount, thirdPersonCount);
      if (ratio > 0.3) {
        defects.push({
          type: 'perspective-slip',
          severity: 'hard',
          text: `Mixed POV: ${firstPersonCount} first-person, ${thirdPersonCount} third-person pronouns`,
          position: 0,
          suggestion: 'Possible perspective slip. Verify consistent POV throughout.'
        });
      }
    }

    // --- Hard Gate 7: Tricolons (lists of three) ---
    // Detect "X, Y, and Z" patterns — more than 1 per 1000 words is an AI tell
    const tricolonPatterns = [
      /\b\w+,\s+\w+,\s+and\s+\w+\b/gi,          // "brave, kind, and strong"
      /\b\w+,\s+\w+,\s+and\s+\w+\s+\w+\b/gi,    // "walked slowly, breathed deeply, and closed her eyes"
      /\b(?:the|a|his|her|their|its)\s+\w+,\s+(?:the|a|his|her|their|its)\s+\w+,\s+and\s+(?:the|a|his|her|their|its)\s+\w+/gi  // "the sun, the wind, and the rain"
    ];

    let tricolonCount = 0;
    const tricolonMatches = [];
    for (const pattern of tricolonPatterns) {
      let match;
      while ((match = pattern.exec(cleanText)) !== null) {
        // Avoid counting the same match twice
        const alreadyCounted = tricolonMatches.some(m =>
          Math.abs(m.position - match.index) < 10
        );
        if (!alreadyCounted) {
          tricolonCount++;
          tricolonMatches.push({ text: match[0], position: match.index });
        }
      }
    }

    const wordsPerTricolon = words.length / Math.max(tricolonCount, 1);
    if (tricolonCount > 0 && wordsPerTricolon < 1000) {
      // More than 1 per 1000 words — flag as hard
      for (const tm of tricolonMatches) {
        defects.push({
          type: 'tricolon',
          severity: tricolonCount >= 2 ? 'hard' : 'medium',
          text: tm.text,
          position: tm.position,
          suggestion: `Tricolon (list of three): "${tm.text}". AI writing marker. Rephrase: use two items, or four, or restructure entirely.`
        });
      }
    }

    // --- Hard Gate 8: Overwrought similes (AI flourish pattern) ---
    // Detect "like a [unusual noun] [preposition] [context]" patterns
    // These are similes that try too hard — a hallmark of AI writing
    const simileRegex = /(?:like|as)\s+(?:a|an|the)\s+\w+(?:\s+\w+){0,2}\s+(?:on|in|at|from|of|across|against|beneath|under|upon)\s+(?:a|an|the)\s+\w+/gi;
    let simileMatch;
    let simileCount = 0;
    while ((simileMatch = simileRegex.exec(cleanText)) !== null) {
      simileCount++;
      if (simileCount > 2) {  // More than 2 elaborate similes per passage
        defects.push({
          type: 'overwrought-simile',
          severity: 'medium',
          text: simileMatch[0],
          position: simileMatch.index,
          suggestion: `Elaborate simile: "${simileMatch[0]}". If this feels like a writerly flourish rather than a genuine observation, cut it or simplify.`
        });
      }
    }

    // --- Measurable: Filter words count ---
    let filterCount = 0;
    const filterInstances = [];
    for (const fw of this.filterWords) {
      const regex = new RegExp(`\\b${fw}\\b`, 'gi');
      let match;
      while ((match = regex.exec(lower)) !== null) {
        filterCount++;
        if (filterInstances.length < 10) {
          filterInstances.push({ word: fw, position: match.index });
        }
      }
    }
    const filterDensity = words.length > 0 ? filterCount / words.length : 0;
    if (filterDensity > 0.015) {
      defects.push({
        type: 'filter-words',
        severity: 'medium',
        text: `${filterCount} filter words (${(filterDensity * 100).toFixed(1)}% density)`,
        position: filterInstances[0]?.position || 0,
        suggestion: `Too many filter words (${filterInstances.map(f => f.word).join(', ')}). Remove or replace with showing.`
      });
    }

    // --- Measurable: Hedge words ---
    const hedgeWords = ['seemed', 'almost', 'a bit', 'somewhat', 'rather', 'slightly', 'perhaps', 'maybe', 'sort of', 'kind of'];
    let hedgeCount = 0;
    for (const hw of hedgeWords) {
      const regex = new RegExp(`\\b${hw}\\b`, 'gi');
      const matches = lower.match(regex);
      if (matches) hedgeCount += matches.length;
    }
    if (hedgeCount > 3) {
      defects.push({
        type: 'hedge-words',
        severity: 'medium',
        text: `${hedgeCount} hedge words found`,
        position: 0,
        suggestion: `Reduce hedge words (seemed, almost, perhaps, etc.). Be more definitive.`
      });
    }

    // --- Measurable: AI connector density ---
    const aiConnectors = ['however', 'moreover', 'in fact', 'as though', 'furthermore', 'nevertheless', 'consequently', 'additionally'];
    let connectorCount = 0;
    for (const ac of aiConnectors) {
      const regex = new RegExp(`\\b${ac}\\b`, 'gi');
      const matches = lower.match(regex);
      if (matches) connectorCount += matches.length;
    }
    const connectorDensity = words.length > 0 ? connectorCount / words.length : 0;
    if (connectorDensity > 0.008) {
      defects.push({
        type: 'ai-connectors',
        severity: 'medium',
        text: `${connectorCount} AI-style connectors (${(connectorDensity * 100).toFixed(1)}% density)`,
        position: 0,
        suggestion: 'Too many formal connectors (however, moreover, etc.). Use simpler transitions or eliminate.'
      });
    }

    // --- Measurable: Sentence opening repetition ---
    const openings = {};
    sentences.forEach(s => {
      const firstWord = (s.match(/^[a-zA-Z]+/) || [''])[0].toLowerCase();
      if (firstWord && firstWord.length > 1) {
        openings[firstWord] = (openings[firstWord] || 0) + 1;
      }
    });
    for (const [word, count] of Object.entries(openings)) {
      const pct = sentences.length > 0 ? (count / sentences.length) * 100 : 0;
      if (count >= 3 && pct > 20) {
        defects.push({
          type: 'opening-repetition',
          severity: 'medium',
          text: `"${word}" starts ${count} sentences (${pct.toFixed(0)}%)`,
          position: 0,
          suggestion: `Too many sentences starting with "${word}". Vary sentence openings.`
        });
      }
    }

    // --- Measurable: Weak words ---
    let weakCount = 0;
    for (const ww of this.weakWords) {
      const regex = new RegExp(`\\b${ww}\\b`, 'gi');
      const matches = lower.match(regex);
      if (matches) weakCount += matches.length;
    }
    const weakDensity = words.length > 0 ? weakCount / words.length : 0;
    if (weakDensity > 0.02) {
      defects.push({
        type: 'weak-words',
        severity: 'medium',
        text: `${weakCount} weak/filler words (${(weakDensity * 100).toFixed(1)}% density)`,
        position: 0,
        suggestion: 'Reduce weak/filler words (very, really, just, quite, etc.).'
      });
    }

    // --- Stats for voice fingerprint comparison ---
    const sentenceLengths = sentences.map(s => this._getWords(s).length);
    const meanLen = sentenceLengths.length > 0
      ? sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length : 0;
    const variance = sentenceLengths.length > 0
      ? sentenceLengths.reduce((sum, l) => sum + Math.pow(l - meanLen, 2), 0) / sentenceLengths.length : 0;
    const stdDev = Math.sqrt(variance);

    const shortSentences = sentenceLengths.filter(l => l <= 8).length;
    const longSentences = sentenceLengths.filter(l => l >= 20).length;
    const shortPct = sentenceLengths.length > 0 ? shortSentences / sentenceLengths.length : 0;
    const longPct = sentenceLengths.length > 0 ? longSentences / sentenceLengths.length : 0;

    // --- Rhythm monotony detection: runs of similar-length sentences ---
    let maxRun = 0;
    let currentRun = 1;
    for (let i = 1; i < sentenceLengths.length; i++) {
      if (Math.abs(sentenceLengths[i] - sentenceLengths[i - 1]) <= 3) {
        currentRun++;
        maxRun = Math.max(maxRun, currentRun);
      } else {
        currentRun = 1;
      }
    }

    if (maxRun >= 4) {
      defects.push({
        type: 'rhythm-monotony',
        severity: 'medium',
        text: `${maxRun} consecutive sentences with similar length`,
        position: 0,
        suggestion: 'Break the rhythm. Add a fragment or a long flowing sentence to create variety.'
      });
    }

    if (Math.round(shortPct * 100) < 15) {
      defects.push({
        type: 'missing-short-sentences',
        severity: 'medium',
        text: `Only ${Math.round(shortPct * 100)}% short sentences (target: 20%+)`,
        position: 0,
        suggestion: 'Add short punchy sentences (3-8 words) or fragments for rhythm.'
      });
    }

    const dialogue = this._getDialogueRatio(cleanText);

    const stats = {
      wordCount: words.length,
      sentenceCount: sentences.length,
      sentenceLengthMean: Math.round(meanLen * 10) / 10,
      sentenceLengthStdDev: Math.round(stdDev * 10) / 10,
      shortSentencePct: Math.round(shortPct * 100),
      longSentencePct: Math.round(longPct * 100),
      dialogueRatio: dialogue.ratio,
      filterWordDensity: Math.round(filterDensity * 1000) / 10,
      weakWordDensity: Math.round(weakDensity * 1000) / 10,
      hedgeCount,
      petPhraseCount: petFinds.reduce((s, p) => s + p.count, 0),
      emDashCount: (cleanText.match(/[\u2014\u2013]|---/g) || []).length,
      passiveVoicePct: this._findPassiveVoice(sentences).percentage,
      hardDefects: defects.filter(d => d.severity === 'hard').length,
      mediumDefects: defects.filter(d => d.severity === 'medium').length
    };

    // --- Quality metrics for Phase 2 deterministic gate ---
    const qualityMetrics = {
      sentenceLengthMean: Math.round(meanLen * 10) / 10,
      sentenceLengthStdDev: Math.round(stdDev * 10) / 10,
      shortSentencePct: Math.round(shortPct * 100),
      longSentencePct: Math.round(longPct * 100),
      maxSimilarLengthRun: maxRun,
      filterWordCount: filterCount,
      filterWordDensity: Math.round(filterDensity * 1000) / 10,
      hedgeWordCount: hedgeCount,
      totalSentences: sentenceLengths.length,
      totalWords: words.length
    };

    return { defects, stats, qualityMetrics };
  }

  /**
   * Find repeated n-grams (sequences of n words appearing more than once).
   */
  _findRepeatedNgrams(text, n) {
    const words = text.toLowerCase().replace(/[^a-z\s'-]/g, ' ').split(/\s+/).filter(w => w.length > 0);
    if (words.length < n * 2) return [];

    const ngramCounts = {};
    const ngramPositions = {};
    for (let i = 0; i <= words.length - n; i++) {
      const ngram = words.slice(i, i + n).join(' ');
      ngramCounts[ngram] = (ngramCounts[ngram] || 0) + 1;
      if (!ngramPositions[ngram]) ngramPositions[ngram] = [];
      ngramPositions[ngram].push(i);
    }

    const repeats = [];
    for (const [ngram, count] of Object.entries(ngramCounts)) {
      if (count >= 2) {
        // Skip if it's all common words
        const ngramWords = ngram.split(' ');
        const commonCount = ngramWords.filter(w =>
          ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'was', 'it', 'he', 'she', 'they', 'that', 'this'].includes(w)
        ).length;
        if (commonCount < ngramWords.length * 0.6) {
          repeats.push({ ngram, count, positions: ngramPositions[ngram] });
        }
      }
    }

    return repeats.sort((a, b) => b.count - a.count).slice(0, 10);
  }

  // ========================================
  //  Voice Fingerprint (Prose CI/CD)
  // ========================================

  /**
   * Calculate a voice fingerprint: measurable style characteristics.
   * Used to detect drift during iterative refinement.
   * Returns { sentenceLengthMean, sentenceLengthStdDev, shortPct, longPct,
   *           dialogueRatio, abstractNounRatio, verbSpecificity, avgParagraphLen }
   */
  calculateVoiceFingerprint(text) {
    if (!text || text.trim().length === 0) {
      return this._emptyFingerprint();
    }

    const cleanText = this._stripHtml(text);
    const words = this._getWords(cleanText);
    const sentences = this._getSentences(cleanText);
    const paragraphs = this._getParagraphs(cleanText);

    // Sentence length distribution
    const sentenceLengths = sentences.map(s => this._getWords(s).length);
    const meanLen = sentenceLengths.length > 0
      ? sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length : 0;
    const variance = sentenceLengths.length > 0
      ? sentenceLengths.reduce((sum, l) => sum + Math.pow(l - meanLen, 2), 0) / sentenceLengths.length : 0;
    const stdDev = Math.sqrt(variance);

    const shortSentences = sentenceLengths.filter(l => l <= 8).length;
    const longSentences = sentenceLengths.filter(l => l >= 20).length;
    const shortPct = sentenceLengths.length > 0 ? shortSentences / sentenceLengths.length : 0;
    const longPct = sentenceLengths.length > 0 ? longSentences / sentenceLengths.length : 0;

    // Simple/compound/complex sentence ratio
    const simpleCount = sentenceLengths.filter(l => l <= 10).length;
    const compoundCount = sentenceLengths.filter(l => l > 10 && l <= 22).length;
    const complexCount = sentenceLengths.filter(l => l > 22).length;

    // Dialogue-to-narration ratio
    const dialogue = this._getDialogueRatio(cleanText);

    // Abstract noun detection (common abstract nouns that signal AI prose)
    const abstractNouns = ['notion', 'idea', 'sense', 'presence', 'essence', 'feeling',
      'thought', 'weight', 'silence', 'darkness', 'realization', 'understanding',
      'awareness', 'consciousness', 'emotion', 'sensation', 'intensity', 'beauty',
      'truth', 'reality', 'possibility', 'certainty', 'inevitability'];
    const lower = cleanText.toLowerCase();
    let abstractCount = 0;
    for (const an of abstractNouns) {
      const regex = new RegExp(`\\b${an}s?\\b`, 'g');
      const matches = lower.match(regex);
      if (matches) abstractCount += matches.length;
    }
    const abstractRatio = words.length > 0 ? abstractCount / words.length : 0;

    // Verb specificity: ratio of specific/vivid verbs vs generic ones
    const genericVerbs = ['was', 'were', 'is', 'are', 'had', 'have', 'went', 'came',
      'got', 'made', 'said', 'looked', 'walked', 'moved', 'took', 'put'];
    let genericVerbCount = 0;
    for (const gv of genericVerbs) {
      const regex = new RegExp(`\\b${gv}\\b`, 'g');
      const matches = lower.match(regex);
      if (matches) genericVerbCount += matches.length;
    }
    const genericVerbRatio = words.length > 0 ? genericVerbCount / words.length : 0;

    // Average paragraph length
    const parLengths = paragraphs.map(p => this._getWords(p).length);
    const avgParLen = parLengths.length > 0
      ? parLengths.reduce((a, b) => a + b, 0) / parLengths.length : 0;

    // Interiority frequency (thought/feeling markers)
    const interiorityMarkers = ['thought', 'felt', 'wondered', 'realized', 'knew',
      'remembered', 'noticed', 'sensed', 'imagined', 'hoped', 'feared',
      'wished', 'believed', 'considered', 'supposed'];
    let interiorityCount = 0;
    for (const im of interiorityMarkers) {
      const regex = new RegExp(`\\b${im}\\b`, 'g');
      const matches = lower.match(regex);
      if (matches) interiorityCount += matches.length;
    }
    const interiorityDensity = words.length > 0 ? interiorityCount / words.length : 0;

    return {
      sentenceLengthMean: Math.round(meanLen * 10) / 10,
      sentenceLengthStdDev: Math.round(stdDev * 10) / 10,
      shortPct: Math.round(shortPct * 100),
      longPct: Math.round(longPct * 100),
      simpleRatio: sentenceLengths.length > 0 ? Math.round((simpleCount / sentenceLengths.length) * 100) : 0,
      compoundRatio: sentenceLengths.length > 0 ? Math.round((compoundCount / sentenceLengths.length) * 100) : 0,
      complexRatio: sentenceLengths.length > 0 ? Math.round((complexCount / sentenceLengths.length) * 100) : 0,
      dialogueRatio: dialogue.ratio,
      abstractNounRatio: Math.round(abstractRatio * 1000) / 10,
      genericVerbRatio: Math.round(genericVerbRatio * 1000) / 10,
      avgParagraphLen: Math.round(avgParLen),
      interiorityDensity: Math.round(interiorityDensity * 1000) / 10,
      wordCount: words.length
    };
  }

  /**
   * Compare two voice fingerprints. Returns a drift score (0 = identical, higher = more drift).
   * Also returns which dimensions drifted and by how much.
   */
  compareFingerprints(baseline, current) {
    if (!baseline || !current) return { totalDrift: 0, dimensions: [] };

    const dimensions = [];
    const weights = {
      sentenceLengthMean: 2,
      sentenceLengthStdDev: 2,
      shortPct: 1.5,
      longPct: 1.5,
      dialogueRatio: 1,
      abstractNounRatio: 1,
      genericVerbRatio: 1,
      avgParagraphLen: 1,
      interiorityDensity: 0.5
    };

    let totalDrift = 0;
    for (const [key, weight] of Object.entries(weights)) {
      const bVal = baseline[key] || 0;
      const cVal = current[key] || 0;
      const maxVal = Math.max(Math.abs(bVal), Math.abs(cVal), 1);
      const drift = Math.abs(bVal - cVal) / maxVal;
      const weightedDrift = drift * weight;
      totalDrift += weightedDrift;

      if (drift > 0.15) {
        dimensions.push({
          dimension: key,
          baseline: bVal,
          current: cVal,
          drift: Math.round(drift * 100),
          direction: cVal > bVal ? 'increased' : 'decreased'
        });
      }
    }

    return {
      totalDrift: Math.round(totalDrift * 100) / 100,
      dimensions: dimensions.sort((a, b) => b.drift - a.drift)
    };
  }

  _emptyFingerprint() {
    return {
      sentenceLengthMean: 0, sentenceLengthStdDev: 0,
      shortPct: 0, longPct: 0,
      simpleRatio: 0, compoundRatio: 0, complexRatio: 0,
      dialogueRatio: 0, abstractNounRatio: 0, genericVerbRatio: 0,
      avgParagraphLen: 0, interiorityDensity: 0, wordCount: 0
    };
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
