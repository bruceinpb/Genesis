/**
 * Deterministic Verification Engine
 *
 * Runs ZERO API calls. Uses only regex and JavaScript to verify prose
 * against a set of stylistic checks. Returns a structured results object
 * with pass/fail for each check.
 */

function deterministicVerification(prose) {
  const failures = [];

  // -------------------------------------------------------------------------
  // Utility helpers
  // -------------------------------------------------------------------------

  function countMatches(text, regex) {
    const matches = text.match(regex);
    return matches ? matches.length : 0;
  }

  function wordCount(text) {
    const trimmed = text.trim();
    if (trimmed.length === 0) return 0;
    return trimmed.split(/\s+/).length;
  }

  function sentences(text) {
    // Split on sentence-ending punctuation followed by whitespace or end of string.
    // Handles abbreviations poorly but is sufficient for heuristic checks.
    return text
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  function paragraphs(text) {
    return text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  }

  function stddev(values) {
    if (values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squareDiffs = values.map((v) => (v - mean) ** 2);
    const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(avgSquareDiff);
  }

  // -------------------------------------------------------------------------
  // Check 1: Banned Patterns (zero tolerance)
  // -------------------------------------------------------------------------

  const bannedPatternDefs = [
    {
      label: "found herself",
      regex: /\bfound herself\b/gi,
    },
    {
      label: "found himself",
      regex: /\bfound himself\b/gi,
    },
    {
      label: "found themselves",
      regex: /\bfound themselves\b/gi,
    },
    {
      // "the way" as a connector — exclude "the way home", "the way back",
      // "the way out", "the way forward", "the way there", "the way to"
      label: "the way (connector)",
      regex: /\bthe way\b(?!\s+(?:home|back|out|forward|there|to)\b)/gi,
    },
    {
      label: "voice was",
      regex: /\bvoice was\b/gi,
    },
    {
      label: "seemed to",
      regex: /\bseemed to\b/gi,
    },
    {
      label: "began to",
      regex: /\bbegan to\b/gi,
    },
    {
      label: "started to",
      regex: /\bstarted to\b/gi,
    },
    {
      // "something" standalone — not part of compound words
      label: "something (vague)",
      regex: /\bsomething\b/gi,
    },
    {
      // "somehow" standalone — not part of compound words
      label: "somehow (vague)",
      regex: /\bsomehow\b/gi,
    },
    {
      label: "for a long moment",
      regex: /\bfor a long moment\b/gi,
    },
    {
      label: "em-dash (\u2014)",
      regex: /\u2014/g,
    },
    {
      label: "en-dash (\u2013)",
      regex: /\u2013/g,
    },
    {
      label: "double-hyphen (--)",
      regex: / -- |--/g,
    },
    {
      label: "meanwhile",
      regex: /\bmeanwhile\b/gi,
    },
  ];

  const bannedPatterns = bannedPatternDefs.map((def) => {
    const count = countMatches(prose, def.regex);
    if (count > 0) {
      failures.push(`Banned pattern "${def.label}" found ${count} time(s)`);
    }
    return { pattern: def.label, count };
  });

  // -------------------------------------------------------------------------
  // Check 2: Pattern Budgets (per-chapter limits)
  // -------------------------------------------------------------------------

  const budgetDefs = [
    { label: "finally", regex: /\bfinally\b/gi, limit: 2 },
    { label: "at last", regex: /\bat last\b/gi, limit: 1 },
    { label: "his eyes", regex: /\bhis eyes\b/gi, limit: 3 },
    { label: "her eyes", regex: /\bher eyes\b/gi, limit: 3 },
    { label: "gaze", regex: /\bgaze\b/gi, limit: 3 },
    { label: "throat tight", regex: /\bthroat tight\b/gi, limit: 1 },
  ];

  const budgetViolations = [];
  for (const def of budgetDefs) {
    const count = countMatches(prose, def.regex);
    if (count > def.limit) {
      budgetViolations.push({
        pattern: def.label,
        count,
        limit: def.limit,
      });
      failures.push(
        `Budget violation: "${def.label}" appears ${count} time(s), limit is ${def.limit}`
      );
    }
  }

  // -------------------------------------------------------------------------
  // Check 3: Tricolon Counter
  // -------------------------------------------------------------------------

  const totalWords = wordCount(prose);

  // Detect "X, Y, and Z" patterns and parallel structures
  const tricolonRegex1 = /\b\w+,\s+\w+,\s+and\s+\w+\b/gi;
  const tricolonRegex2 = /\b\w+,\s+\w+,\s+and\s+\w+/gi;

  // Collect unique matches across both patterns using position tracking
  const tricolonPositions = new Set();
  let match;

  const tricolonRegex1Reset = new RegExp(tricolonRegex1.source, tricolonRegex1.flags);
  while ((match = tricolonRegex1Reset.exec(prose)) !== null) {
    tricolonPositions.add(match.index);
  }

  const tricolonRegex2Reset = new RegExp(tricolonRegex2.source, tricolonRegex2.flags);
  while ((match = tricolonRegex2Reset.exec(prose)) !== null) {
    tricolonPositions.add(match.index);
  }

  const tricolonCount = tricolonPositions.size;
  const tricolonMax = Math.max(1, Math.floor(totalWords / 750));

  if (tricolonCount > tricolonMax) {
    failures.push(
      `Tricolon overuse: ${tricolonCount} found, max allowed is ${tricolonMax} (1 per 750 words, ${totalWords} total words)`
    );
  }

  // -------------------------------------------------------------------------
  // Check 4: Kicker Density
  // -------------------------------------------------------------------------

  const paras = paragraphs(prose);
  let kickerCount = 0;
  const parasWithEnoughContent = paras.filter((p) => wordCount(p) > 5);

  const reversalWords = /\b(but|yet|however|instead|though|still)\b/i;
  const abstractNouns =
    /\b(truth|power|silence|history|fate|destiny|justice|freedom|time|death)\b/i;
  const aphoristicVerbs = /\b(was|had|became|remained|endured)\b/i;
  const personifiedPattern =
    /\b[A-Z][a-z]+\s+(made|demanded|required|insisted|claimed|offered|refused|whispered|spoke|called|knew|saw|wanted|decided)\b/;

  for (const para of parasWithEnoughContent) {
    const paraWords = wordCount(para);
    const paraSentences = sentences(para);
    if (paraSentences.length === 0) continue;

    const lastSentence = paraSentences[paraSentences.length - 1];
    const lastWords = wordCount(lastSentence);
    let isKicker = false;

    // Heuristic 1: Short punchy ending after a long paragraph
    if (lastWords < 10 && paraWords > 30) {
      isKicker = true;
    }

    // Heuristic 2: Ironic reversal words in final sentence
    if (reversalWords.test(lastSentence)) {
      isKicker = true;
    }

    // Heuristic 3: Personified abstractions
    if (personifiedPattern.test(lastSentence)) {
      isKicker = true;
    }

    // Heuristic 4: Aphoristic closings with abstract nouns + verbs
    if (abstractNouns.test(lastSentence) && aphoristicVerbs.test(lastSentence)) {
      isKicker = true;
    }

    if (isKicker) {
      kickerCount++;
    }
  }

  const kickerDensity =
    parasWithEnoughContent.length > 0
      ? kickerCount / parasWithEnoughContent.length
      : 0;

  if (kickerDensity > 0.3) {
    failures.push(
      `Kicker density too high: ${(kickerDensity * 100).toFixed(1)}% of paragraphs end with kickers (max 30%)`
    );
  }

  // -------------------------------------------------------------------------
  // Check 5: Paragraph Length Variance
  // -------------------------------------------------------------------------

  const paraWordCounts = paras.map((p) => wordCount(p));
  const paragraphVariance = stddev(paraWordCounts);

  if (paraWordCounts.length >= 2 && paragraphVariance < 15) {
    failures.push(
      `Paragraph lengths too uniform: std dev is ${paragraphVariance.toFixed(1)} (minimum 15 required)`
    );
  }

  // -------------------------------------------------------------------------
  // Check 6: Four Requirements (heuristic, per 750-word chunk)
  // -------------------------------------------------------------------------

  // Split prose into ~750-word chunks
  const allWords = prose.split(/\s+/);
  const chunkSize = 750;
  const chunks = [];

  for (let i = 0; i < allWords.length; i += chunkSize) {
    chunks.push(allWords.slice(i, i + chunkSize).join(" "));
  }

  // If the final chunk is very small (< 100 words), merge it with the previous one
  if (chunks.length > 1 && wordCount(chunks[chunks.length - 1]) < 100) {
    const last = chunks.pop();
    chunks[chunks.length - 1] += " " + last;
  }

  let fourRequirementsTotal = 0;
  let fourRequirementsFailed = false;

  // Proper noun pattern: capitalized word not at sentence start
  const behavioralVerbPattern =
    /\b[A-Z][a-z]{2,}\s+(thought|believed|wanted|feared|decided|knew|realized|hoped|wondered)\b/;

  // Concrete/sensory nouns — a representative list of physical objects, colors,
  // textures, sounds, smells
  const sensoryNouns =
    /\b(stone|wood|metal|glass|iron|steel|brick|dust|mud|sand|clay|leather|cotton|silk|wool|smoke|ash|flame|water|rain|snow|ice|fog|mist|wind|salt|blood|bone|skin|hair|grass|leaf|bark|moss|rust|gold|silver|copper|bronze|oak|pine|elm|maple|cedar|marble|granite|ivory|velvet|linen|satin|crimson|scarlet|amber|azure|cobalt|emerald|ivory|obsidian|jade|ruby|sapphire|turquoise|lavender|violet|indigo|ochre|copper|rust|shadow|light|dark|bright|dim|glow|glint|gleam|flash|spark|echo|whisper|hum|buzz|crack|snap|thud|clang|ring|toll|chime|roar|crash|rumble|thunder|creak|scrape|rattle|rustle|murmur|growl|hiss|sizzle|drip|splash|stench|perfume|scent|aroma|smoke|musk|cedar|pine|sweat|rot|earth|petrichor)\b/gi;

  for (const chunk of chunks) {
    let requirementsMet = 0;
    const chunkSentences = sentences(chunk);

    // Requirement A: Character-specific thought
    if (behavioralVerbPattern.test(chunk)) {
      requirementsMet++;
    }

    // Requirement B: Precise observation (2+ sensory nouns in one sentence)
    for (const sent of chunkSentences) {
      const sensoryMatches = sent.match(sensoryNouns);
      if (sensoryMatches && sensoryMatches.length >= 2) {
        requirementsMet++;
        break;
      }
    }

    // Requirement C: Musical sentence (large length variance from neighbors,
    // 4+ clauses)
    for (let i = 0; i < chunkSentences.length; i++) {
      const sent = chunkSentences[i];
      const clauseCount = sent.split(/[,;]/).length;
      if (clauseCount >= 4) {
        // Check length variance from neighbors
        const sentLen = wordCount(sent);
        let hasVariance = false;

        if (i > 0) {
          const prevLen = wordCount(chunkSentences[i - 1]);
          if (Math.abs(sentLen - prevLen) > 15) {
            hasVariance = true;
          }
        }
        if (i < chunkSentences.length - 1) {
          const nextLen = wordCount(chunkSentences[i + 1]);
          if (Math.abs(sentLen - nextLen) > 15) {
            hasVariance = true;
          }
        }
        // If first/last sentence with 4+ clauses, consider it musical anyway
        if (chunkSentences.length === 1) {
          hasVariance = true;
        }

        if (hasVariance) {
          requirementsMet++;
          break;
        }
      }
    }

    // Requirement D: Expectation break (short < 10 words after long > 25 words)
    for (let i = 1; i < chunkSentences.length; i++) {
      const prevLen = wordCount(chunkSentences[i - 1]);
      const currLen = wordCount(chunkSentences[i]);
      if (prevLen > 25 && currLen < 10) {
        requirementsMet++;
        break;
      }
    }

    fourRequirementsTotal += requirementsMet;

    if (requirementsMet === 0) {
      fourRequirementsFailed = true;
      failures.push(
        `Four Requirements check failed: a 750-word chunk starting with "${chunk.substring(0, 60).trim()}..." has zero requirements met`
      );
    }
  }

  // -------------------------------------------------------------------------
  // Check 7: Fabricated Precision Detector
  // -------------------------------------------------------------------------

  const fabricatedPrecision = [];

  // Number + time unit patterns — suspiciously specific numbers
  // Matches written-out numbers (e.g. "forty-nine") and digit numbers (e.g. "312")
  const writtenNumbers =
    /(?:(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[-\s](?:one|two|three|four|five|six|seven|eight|nine))/i;
  const digitNumbers = /\d{2,}/;
  const timeUnits =
    /\b(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?|decades?|centuries?)\b/i;

  // Check for written-out number + time unit
  const writtenNumberTimeRegex =
    /(?:(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[-\s](?:one|two|three|four|five|six|seven|eight|nine))\s+(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?|decades?|centuries?)/gi;

  let fpMatch;
  while ((fpMatch = writtenNumberTimeRegex.exec(prose)) !== null) {
    fabricatedPrecision.push(fpMatch[0]);
  }

  // Check for digit numbers (3+ digits or 2+ digits that look overly specific) + time unit
  const digitTimeRegex =
    /\b(\d{2,})\s+(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?|decades?|centuries?|workers?|soldiers?|people|men|women|children|pages?|copies|miles?|kilometers?|feet|meters?|pounds?|tons?|gallons?)\b/gi;

  while ((fpMatch = digitTimeRegex.exec(prose)) !== null) {
    fabricatedPrecision.push(fpMatch[0]);
  }

  // Check for "according to documents/records/archives"
  const accordingToRegex =
    /\baccording to\s+(?:documents?|records?|archives?|files?|reports?)\b/gi;

  while ((fpMatch = accordingToRegex.exec(prose)) !== null) {
    fabricatedPrecision.push(fpMatch[0]);
  }

  // Fabricated precision is a warning, not a hard fail — do not push to failures[]

  // -------------------------------------------------------------------------
  // Compile results
  // -------------------------------------------------------------------------

  const failCount = failures.length;
  const allPassed = failCount === 0;

  return {
    allPassed,
    failCount,
    failures,
    bannedPatterns,
    budgetViolations,
    tricolonCount,
    tricolonMax,
    kickerDensity: Math.round(kickerDensity * 1000) / 1000,
    paragraphVariance: Math.round(paragraphVariance * 100) / 100,
    fourRequirements: fourRequirementsTotal,
    fabricatedPrecision,
  };
}

export { deterministicVerification };
