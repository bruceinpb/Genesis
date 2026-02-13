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
      paragraphs.forEach(p => {
        const trimmed = p.trim();
        if (trimmed === '* * *' || trimmed === '***' || trimmed === '---') {
          html += `<div class="scene-break">* * *</div>\n`;
        } else {
          html += `<p>${this._escapeHtml(p)}</p>\n`;
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
</style>
</head>
<body>

${project.coverImage ? `<div class="cover-page">
  <img src="${project.coverImage}" alt="Cover">
</div>\n` : ''}<h1>${this._escapeHtml(project.title)}</h1>
`;

    for (const chapter of chapters) {
      html += `\n<h1 class="chapter-title">${this._escapeHtml(chapter.title)}</h1>\n\n`;
      html += this._sanitizeContent(this._stripLeadingHeading(chapter.content)) + '\n';
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

  // --- Helpers ---

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

    return (div.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
  }

  _contentToParagraphs(html) {
    if (!html) return [];
    const div = document.createElement('div');
    div.innerHTML = html;
    const paragraphs = [];

    div.querySelectorAll('p').forEach(p => {
      const text = (p.textContent || '').trim();
      if (text) paragraphs.push(text);
    });

    if (paragraphs.length === 0) {
      const text = (div.textContent || '').trim();
      if (text) {
        text.split(/\n\s*\n/).forEach(p => {
          const t = p.trim();
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
    // Strip any strategy markers left by the micro-fix pipeline
    cleaned = cleaned.replace(/---STRATEGY---[\s\S]*?(?=(<p>|<\/p>|\n\n|$))/g, '');
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
