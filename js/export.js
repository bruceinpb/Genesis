/**
 * Genesis 2 — Export Module
 * Export manuscripts to standard formats: plain text, manuscript format,
 * HTML, and JSON backup.
 *
 * Works with the Firestore chapter-based model (no scenes).
 */

class ExportManager {
  constructor(firestoreStorage) {
    this.fs = firestoreStorage;
  }

  /**
   * Export the full manuscript as plain text.
   */
  async exportPlainText(projectId) {
    const project = await this.fs.getProject(projectId);
    const allChapters = await this.fs.getProjectChapters(projectId);
    const chapters = allChapters
      .filter(ch => !ch.isTranslation)
      .sort((a, b) => (a.chapterNumber || 0) - (b.chapterNumber || 0));
    let output = '';

    output += project.title.toUpperCase() + '\n';
    output += '='.repeat(project.title.length) + '\n\n';

    for (const chapter of chapters) {
      output += '\n' + chapter.title.toUpperCase() + '\n';
      output += '-'.repeat(chapter.title.length) + '\n\n';

      const text = this._htmlToText(this._stripLeadingHeading(chapter.content));
      output += text + '\n\n';
    }

    return {
      content: output,
      filename: this._sanitizeFilename(project.title) + '.txt',
      mimeType: 'text/plain'
    };
  }

  /**
   * Export in standard manuscript format (Shunn format).
   * Courier 12pt, double-spaced, ~250 words/page.
   */
  async exportManuscriptFormat(projectId) {
    const project = await this.fs.getProject(projectId);
    const allChapters = await this.fs.getProjectChapters(projectId);
    const chapters = allChapters
      .filter(ch => !ch.isTranslation)
      .sort((a, b) => (a.chapterNumber || 0) - (b.chapterNumber || 0));
    const totalWords = chapters.reduce((sum, ch) => sum + (ch.wordCount || 0), 0);

    let html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${this._escapeHtml(project.title)}</title>
<style>
  @page { margin: 1in; size: letter; }
  body {
    font-family: 'Courier New', Courier, monospace;
    font-size: 12pt;
    line-height: 2;
    color: #000;
    background: #fff;
    max-width: 8.5in;
    margin: 0 auto;
    padding: 1in;
  }
  .cover-page {
    page-break-after: always;
    text-align: center;
    padding: 0;
    margin: -1in;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
  }
  .cover-page img {
    max-width: 100%;
    max-height: 100vh;
    object-fit: contain;
  }
  .title-page {
    text-align: center;
    page-break-after: always;
    padding-top: 33%;
  }
  .title-page h1 {
    font-size: 14pt;
    font-family: 'Courier New', Courier, monospace;
    text-transform: uppercase;
    margin-bottom: 24pt;
  }
  .title-page .byline { font-size: 12pt; }
  .title-page .wordcount {
    margin-top: 48pt;
    font-size: 12pt;
  }
  .chapter-start {
    page-break-before: always;
    padding-top: 33%;
    text-align: center;
    margin-bottom: 48pt;
  }
  .chapter-start h1 {
    font-family: 'Courier New', Courier, monospace;
    font-size: 14pt;
    text-transform: uppercase;
    font-weight: bold;
  }
  .scene-break {
    text-align: center;
    margin: 24pt 0;
    font-size: 12pt;
  }
  p {
    text-indent: 0.5in;
    margin: 0;
  }
  p:first-of-type { text-indent: 0; }
  .end-mark {
    text-align: center;
    margin-top: 48pt;
    font-weight: bold;
  }
</style>
</head>
<body>

${project.coverImage ? `<div class="cover-page">
  <img src="${project.coverImage}" alt="Cover">
</div>\n` : ''}
<div class="title-page">
  <h1>${this._escapeHtml(project.title)}</h1>
  <div class="byline">by ${this._escapeHtml(project.owner || '[Author Name]')}</div>
  <div class="wordcount">Approximately ${Math.round(totalWords / 1000) * 1000} words</div>
</div>
`;

    for (const chapter of chapters) {
      html += `\n<div class="chapter-start">
  <h1>${this._escapeHtml(chapter.title)}</h1>
</div>\n\n`;

      const paragraphs = this._contentToParagraphs(this._stripLeadingHeading(chapter.content));
      const illInsertMap = this._getEmbeddedIllustrationHtml(chapter.id);
      const hasIllustrations = Object.keys(illInsertMap).length > 0;

      paragraphs.forEach((p, pi) => {
        const trimmed = p.trim();
        if (trimmed === '* * *' || trimmed === '***' || trimmed === '---') {
          html += `<div class="scene-break">* * *</div>\n`;
        } else {
          html += `<p>${this._escapeHtml(p)}</p>\n`;
        }
        if (hasIllustrations && illInsertMap[pi]) {
          html += illInsertMap[pi] + '\n';
        }
      });
    }

    html += '\n<div class="end-mark">THE END</div>\n\n</body>\n</html>';

    return {
      content: html,
      filename: this._sanitizeFilename(project.title) + '_manuscript.html',
      mimeType: 'text/html'
    };
  }

  /**
   * Export as a styled HTML ebook.
   */
  async exportStyledHtml(projectId) {
    const project = await this.fs.getProject(projectId);
    const allChapters = await this.fs.getProjectChapters(projectId);
    // Filter out translation chapters and sort by chapter number (matches DOCX export behavior)
    const chapters = allChapters
      .filter(ch => !ch.isTranslation)
      .sort((a, b) => (a.chapterNumber || 0) - (b.chapterNumber || 0));

    let html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${this._escapeHtml(project.title)}</title>
<style>
  body {
    font-family: Georgia, 'Palatino Linotype', 'Book Antiqua', serif;
    font-size: 18px;
    line-height: 1.8;
    color: #333;
    background: #faf8f5;
    max-width: 640px;
    margin: 0 auto;
    padding: 40px 24px;
  }
  h1 {
    font-size: 2.5em;
    text-align: center;
    margin: 2em 0 0.5em;
    color: #1a1a1a;
  }
  h1.chapter-title {
    font-size: 1.8em;
    text-align: center;
    margin: 3em 0 1.5em;
    color: #1a1a1a;
    page-break-before: always;
  }
  .scene-break {
    text-align: center;
    margin: 2em 0;
    color: #999;
    font-size: 1.2em;
  }
  p { text-indent: 1.5em; margin: 0 0 0.2em; }
  p:first-of-type, h2 + p { text-indent: 0; }
  blockquote {
    border-left: 3px solid #d4a853;
    padding-left: 1.2em;
    margin: 1em 0;
    color: #555;
    font-style: italic;
  }
  .cover-page {
    page-break-after: always;
    text-align: center;
    margin: -40px -24px 0;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
  }
  .cover-page img {
    max-width: 100%;
    max-height: 100vh;
    object-fit: contain;
  }
  .chapter-illustration {
    text-align: center;
    margin: 1.5em 0;
    page-break-inside: avoid;
  }
  .chapter-illustration img {
    max-width: 100%;
    height: auto;
    border-radius: 4px;
  }
  .chapter-illustration figcaption {
    font-style: italic;
    font-size: 0.85em;
    color: #666;
    margin-top: 0.5em;
  }
</style>
</head>
<body>

${project.coverImage ? `<div class="cover-page">
  <img src="${project.coverImage}" alt="Cover">
</div>\n` : ''}<h1>${this._escapeHtml(project.title)}</h1>
`;

    for (let ci = 0; ci < chapters.length; ci++) {
      const chapter = chapters[ci];
      const displayTitle = chapter.title || `Chapter ${ci + 1}`;
      html += `\n<h1 class="chapter-title">${this._escapeHtml(displayTitle)}</h1>\n\n`;

      const chapterContent = this._sanitizeContent(this._stripLeadingHeading(chapter.content));
      if (chapterContent && chapterContent.trim()) {
        // If illustrations are available, embed them
        const illInsertMap = this._getEmbeddedIllustrationHtml(chapter.id);
        if (Object.keys(illInsertMap).length > 0) {
          const paragraphs = this._contentToParagraphs(chapterContent);
          for (let pi = 0; pi < paragraphs.length; pi++) {
            html += `<p>${this._escapeHtml(paragraphs[pi])}</p>\n`;
            if (illInsertMap[pi]) {
              html += illInsertMap[pi] + '\n';
            }
          }
        } else {
          html += chapterContent + '\n';
        }
      }
    }

    // Scholarly apparatus sections (if generator callback is provided)
    if (this._scholarlyGenerator && project.scholarlyApparatus) {
      const sa = project.scholarlyApparatus;
      const allProse = chapters.map((ch, idx) =>
        `CHAPTER ${idx + 1}: ${ch.title || 'Untitled'}\n${(ch.content || '').replace(/<[^>]+>/g, '')}`
      ).join('\n\n---\n\n');

      if (sa.footnotesEnabled) {
        try {
          const endnotesText = await this._scholarlyGenerator('endnotes', allProse, chapters);
          if (endnotesText) {
            html += '<div style="page-break-before: always;"></div>';
            html += '<h1 class="chapter-title">Notes</h1>';
            const noteLines = endnotesText.split('\n').filter(l => l.trim());
            for (const line of noteLines) {
              const isHeading = line.startsWith('Chapter ') && line.includes(':');
              html += isHeading
                ? `<h3 style="margin-top: 1.5em; margin-bottom: 0.5em;">${this._escapeHtml(line)}</h3>`
                : `<p style="font-size: 10pt; margin: 0.3em 0; padding-left: 2em; text-indent: -2em;">${this._escapeHtml(line)}</p>`;
            }
          }
        } catch (err) {
          console.error('Failed to generate endnotes for HTML:', err);
        }
      }

      if (sa.bibliographyEnabled) {
        try {
          const bibText = await this._scholarlyGenerator('bibliography', allProse, chapters);
          if (bibText) {
            html += '<div style="page-break-before: always;"></div>';
            html += '<h1 class="chapter-title">Bibliography</h1>';
            const bibLines = bibText.split('\n').filter(l => l.trim());
            for (const line of bibLines) {
              const isSection = /^(Primary|Secondary|Archival|Sources)/i.test(line);
              html += isSection
                ? `<h3 style="margin-top: 1.5em;">${this._escapeHtml(line)}</h3>`
                : `<p style="font-size: 11pt; margin: 0.3em 0; padding-left: 3em; text-indent: -3em;">${this._escapeHtml(line)}</p>`;
            }
          }
        } catch (err) {
          console.error('Failed to generate bibliography for HTML:', err);
        }
      }

      if (sa.indexEnabled) {
        try {
          const indexText = await this._scholarlyGenerator('index', allProse, chapters, sa.indexType);
          if (indexText) {
            html += '<div style="page-break-before: always;"></div>';
            html += '<h1 class="chapter-title">Index</h1>';
            html += '<div style="column-count: 2; column-gap: 2em;">';
            const indexLines = indexText.split('\n').filter(l => l.trim());
            for (const line of indexLines) {
              html += `<p style="font-size: 10pt; margin: 0.2em 0;">${this._escapeHtml(line)}</p>`;
            }
            html += '</div>';
          }
        } catch (err) {
          console.error('Failed to generate index for HTML:', err);
        }
      }
    }

    html += '\n</body>\n</html>';

    return {
      content: html,
      filename: this._sanitizeFilename(project.title) + '.html',
      mimeType: 'text/html'
    };
  }

  /**
   * Export full project as JSON backup.
   */
  async exportJson(projectId) {
    const data = await this.fs.exportProject(projectId);
    return {
      content: JSON.stringify(data, null, 2),
      filename: this._sanitizeFilename(data.project.title) + '_backup.json',
      mimeType: 'application/json'
    };
  }

  /**
   * Trigger download in the browser.
   */
  download(exportResult) {
    const blob = new Blob([exportResult.content], { type: exportResult.mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportResult.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Print the full manuscript using the browser's print dialog.
   * Builds a temporary print-only container with all chapters, triggers
   * window.print(), then removes the container.
   */
  async printBook(projectId, chapterFilter = null) {
    const project = await this.fs.getProject(projectId);
    const allChapters = await this.fs.getProjectChapters(projectId);
    let chapters = allChapters
      .filter(ch => !ch.isTranslation)
      .sort((a, b) => (a.chapterNumber || 0) - (b.chapterNumber || 0));

    // If chapterFilter is provided, only print those chapter IDs
    if (chapterFilter && chapterFilter.length > 0) {
      chapters = chapters.filter(ch => chapterFilter.includes(ch.id));
    }

    if (chapters.length === 0) {
      alert('No chapters found to print.');
      return;
    }

    // Build the print container
    const container = document.createElement('div');
    container.id = 'print-book-container';

    // Title page
    const totalWords = chapters.reduce((sum, ch) => sum + (ch.wordCount || 0), 0);
    const titlePage = document.createElement('div');
    titlePage.className = 'print-title-page';
    titlePage.innerHTML =
      `<h1>${this._escapeHtml(project.title)}</h1>` +
      `<div class="print-byline">by ${this._escapeHtml(project.owner || '[Author Name]')}</div>` +
      `<div class="print-wordcount">Approximately ${Math.round(totalWords / 1000) * 1000} words</div>`;
    container.appendChild(titlePage);

    // Collect illustration data if available
    const illustrations = this._illustrations || [];

    // Each chapter
    for (let i = 0; i < chapters.length; i++) {
      const chapter = chapters[i];
      const chapterDiv = document.createElement('div');
      chapterDiv.className = 'print-chapter';

      const heading = document.createElement('div');
      heading.className = 'print-chapter-heading';
      heading.innerHTML = `<h2>${this._escapeHtml(chapter.title || 'Chapter ' + (i + 1))}</h2>`;
      chapterDiv.appendChild(heading);

      // Add chapter illustrations at top (before content)
      const chapterIlls = illustrations
        .filter(ill => ill.chapterId === chapter.id && ill.imageData)
        .sort((a, b) => (a.insertAfter || 0) - (b.insertAfter || 0));

      const content = document.createElement('div');
      content.className = 'print-chapter-content';
      const cleanedContent = this._stripLeadingHeading(chapter.content || '');
      const sanitizedContent = this._sanitizeContent(cleanedContent);

      if (chapterIlls.length > 0) {
        // Insert illustrations at their intended positions within the content
        const paragraphs = this._contentToParagraphs(sanitizedContent);
        for (let pi = 0; pi < paragraphs.length; pi++) {
          const p = document.createElement('p');
          p.textContent = paragraphs[pi];
          content.appendChild(p);
          // Check if any illustrations should be inserted after this paragraph
          for (const ill of chapterIlls) {
            if ((ill.insertAfter || 0) === pi) {
              const figure = document.createElement('figure');
              figure.className = 'print-illustration';
              figure.style.cssText = 'text-align:center;margin:24pt 0;page-break-inside:avoid;';
              const img = document.createElement('img');
              img.src = ill.imageData;
              img.alt = ill.altText || ill.caption || 'Illustration';
              img.style.cssText = 'max-width:100%;max-height:6in;';
              figure.appendChild(img);
              if (ill.caption) {
                const cap = document.createElement('figcaption');
                cap.style.cssText = 'font-style:italic;font-size:10pt;margin-top:6pt;';
                cap.textContent = ill.caption;
                figure.appendChild(cap);
              }
              content.appendChild(figure);
            }
          }
        }
      } else {
        content.innerHTML = sanitizedContent;
      }

      chapterDiv.appendChild(content);
      container.appendChild(chapterDiv);
    }

    // Append to body and make visible for rendering
    // iPad Safari sometimes fails to print all chapters when relying solely on @media print.
    // Force visibility by setting inline styles before printing.
    const appEl = document.getElementById('app');
    if (appEl) appEl.style.display = 'none';
    container.style.display = 'block';
    document.body.appendChild(container);

    // Use afterprint event for cleanup (works correctly on iPad Safari)
    const cleanup = () => {
      window.removeEventListener('afterprint', cleanup);
      if (document.body.contains(container)) {
        document.body.removeChild(container);
      }
      if (appEl) appEl.style.display = '';
    };
    window.addEventListener('afterprint', cleanup);

    // Allow DOM to fully render before printing — use rAF + generous timeout for iPad
    await new Promise(resolve => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setTimeout(resolve, 600);
        });
      });
    });
    window.print();

    // Fallback cleanup after 60 seconds if afterprint doesn't fire (some browsers)
    setTimeout(cleanup, 60000);
  }

  /**
   * Set illustration data for export. Called by app.js before export.
   * @param {Array} illustrations - Array of { chapterId, illustrationIndex, imageData, prompt, altText, caption, size, insertAfter }
   */
  setIllustrationData(illustrations) {
    this._illustrations = illustrations || [];
  }

  /**
   * Get illustration placeholders for a chapter (Vellum workflow).
   * Returns HTML with visible placeholder markers.
   */
  _getIllustrationPlaceholders(chapterId, paragraphs) {
    if (!this._illustrations || this._illustrations.length === 0) return paragraphs;

    const chapterIlls = this._illustrations
      .filter(ill => ill.chapterId === chapterId)
      .sort((a, b) => (a.insertAfter || 0) - (b.insertAfter || 0));

    if (chapterIlls.length === 0) return paragraphs;

    const result = [...paragraphs];

    // Insert placeholders in reverse order to preserve indices
    for (let i = chapterIlls.length - 1; i >= 0; i--) {
      const ill = chapterIlls[i];
      const shortDesc = (ill.action || 'illustration').slice(0, 40).replace(/[^a-zA-Z0-9 ]/g, '_');
      const fileName = `ch${String(ill.chapterNumber || 0).padStart(2, '0')}_img${String((ill.illustrationIndex || 0) + 1).padStart(2, '0')}_${shortDesc.replace(/ /g, '_')}.png`;
      const sizeLabel = (ill.size || 'inline_full').replace(/_/g, ' ');
      const dpi = ill.resolution || 300;

      const placeholder = `\n${'='.repeat(50)}\n[IMAGE: ${fileName}]\nType: ${sizeLabel} | ${dpi} DPI${ill.caption ? '\nCaption: ' + ill.caption : ''}\n${'='.repeat(50)}\n`;

      const insertIdx = Math.min(ill.insertAfter || 0, result.length);
      result.splice(insertIdx + 1, 0, placeholder);
    }

    return result;
  }

  /**
   * Get embedded illustration HTML for a chapter (direct DOCX/HTML workflow).
   * Returns modified paragraph array with embedded images.
   */
  _getEmbeddedIllustrationHtml(chapterId) {
    if (!this._illustrations || this._illustrations.length === 0) return {};

    const chapterIlls = this._illustrations
      .filter(ill => ill.chapterId === chapterId && ill.imageData)
      .sort((a, b) => (a.insertAfter || 0) - (b.insertAfter || 0));

    // Map: insertAfterIndex -> illustration HTML
    const insertMap = {};
    for (const ill of chapterIlls) {
      const idx = ill.insertAfter || 0;
      const imgHtml = `<div style="text-align:center;margin:1.5em 0;"><img src="${ill.imageData}" alt="${this._escapeHtml(ill.altText || '')}" style="max-width:100%;height:auto;">${ill.caption ? `<p style="font-size:0.85em;color:#666;font-style:italic;margin-top:0.5em;">${this._escapeHtml(ill.caption)}</p>` : ''}</div>`;
      if (!insertMap[idx]) insertMap[idx] = '';
      insertMap[idx] += imgHtml;
    }

    return insertMap;
  }

  // --- Helpers ---

  /**
   * Clean em dashes, en dashes, and related artifacts from text before export.
   */
  _cleanForExport(text) {
    if (!text) return text;
    // Replace em/en dashes with proper punctuation
    text = text.replace(/\s*[\u2014\u2013]\s*/g, ', ');
    text = text.replace(/[\u2014\u2013]/g, ', ');
    // Replace double/triple hyphens used as em dashes
    text = text.replace(/\s*---\s*/g, ', ');
    text = text.replace(/\s*--\s*/g, ', ');
    // Fix existing ` ,  ` artifacts from previous bad replacements
    text = text.replace(/ ,  /g, ', ');
    // Clean up double commas or comma before other punctuation
    text = text.replace(/,\s*,/g, ',');
    text = text.replace(/,\s*\./g, '.');
    text = text.replace(/,\s*!/g, '!');
    text = text.replace(/,\s*\?/g, '?');
    // Clean double spaces
    text = text.replace(/  +/g, ' ');
    return text;
  }

  _htmlToText(html) {
    if (!html) return '';
    const div = document.createElement('div');
    div.innerHTML = html;

    // Convert block elements to newlines
    div.querySelectorAll('p, br, div').forEach(el => {
      if (el.tagName === 'BR') {
        el.replaceWith('\n');
      } else {
        el.insertAdjacentText('afterend', '\n\n');
      }
    });

    let text = (div.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
    return this._cleanForExport(text);
  }

  _contentToParagraphs(html) {
    if (!html) return [];
    const div = document.createElement('div');
    div.innerHTML = html;
    const paragraphs = [];

    div.querySelectorAll('p').forEach(p => {
      const text = this._cleanForExport((p.textContent || '').trim());
      if (text) paragraphs.push(text);
    });

    if (paragraphs.length === 0) {
      const text = (div.textContent || '').trim();
      if (text) {
        text.split(/\n\s*\n/).forEach(p => {
          const t = this._cleanForExport(p.trim());
          if (t) paragraphs.push(t);
        });
      }
    }

    return paragraphs;
  }

  _stripLeadingHeading(html) {
    if (!html) return '';
    // Remove the first H1-H6 element from the content to avoid duplication
    // since export formats add their own chapter heading
    let cleaned = html.replace(/^\s*<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>\s*/i, '');
    // Strip any strategy/log markers left by the pipeline
    cleaned = cleaned.replace(/---STRATEGY---[\s\S]*?(?=(<p>|<\/p>|\n\n|$))/g, '');
    cleaned = cleaned.replace(/---STRATEGY---[\s\S]*/g, '');
    cleaned = cleaned.replace(/---SMOOTHING_LOG---[\s\S]*/g, '');
    cleaned = cleaned.replace(/---ROUGHNESS_LOG---[\s\S]*/g, '');
    // Strip markdown-style headings that leaked into prose (e.g. "# Chapter Title")
    cleaned = cleaned.replace(/<p>\s*#+\s+[^<]*<\/p>/g, '');
    return cleaned;
  }

  _sanitizeContent(html) {
    if (!html) return '';
    // Allow only safe tags
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/on\w+="[^"]*"/gi, '')
      .replace(/on\w+='[^']*'/gi, '');
  }

  _escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  _sanitizeFilename(name) {
    return (name || 'untitled')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .substring(0, 60);
  }
}

export { ExportManager };
