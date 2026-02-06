/**
 * Genesis 2 — Export Module
 * Export manuscripts to standard formats: plain text, manuscript format,
 * HTML, and JSON backup.
 */

class ExportManager {
  constructor(storage, manuscriptManager) {
    this.storage = storage;
    this.manuscript = manuscriptManager;
  }

  /**
   * Export the full manuscript as plain text.
   */
  async exportPlainText(projectId) {
    const project = await this.storage.get('projects', projectId);
    const tree = await this.manuscript.getManuscriptTree(projectId);
    let output = '';

    output += project.name.toUpperCase() + '\n';
    output += '='.repeat(project.name.length) + '\n\n';

    if (project.synopsis) {
      output += project.synopsis + '\n\n';
      output += '---\n\n';
    }

    for (const chapter of tree) {
      output += '\n' + chapter.title.toUpperCase() + '\n';
      output += '-'.repeat(chapter.title.length) + '\n\n';

      for (const scene of chapter.scenes) {
        const text = this._htmlToText(scene.content);
        output += text + '\n\n';

        if (scene !== chapter.scenes[chapter.scenes.length - 1]) {
          output += '* * *\n\n';
        }
      }
    }

    return {
      content: output,
      filename: this._sanitizeFilename(project.name) + '.txt',
      mimeType: 'text/plain'
    };
  }

  /**
   * Export in standard manuscript format (Shunn format).
   * Courier 12pt, double-spaced, ~250 words/page.
   */
  async exportManuscriptFormat(projectId) {
    const project = await this.storage.get('projects', projectId);
    const tree = await this.manuscript.getManuscriptTree(projectId);
    const totalWords = tree.reduce((sum, ch) =>
      sum + ch.scenes.reduce((s, sc) => s + (sc.wordCount || 0), 0), 0
    );

    let html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${this._escapeHtml(project.name)}</title>
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
  .header {
    text-align: right;
    font-size: 12pt;
    margin-bottom: 0;
  }
  .chapter-start {
    page-break-before: always;
    padding-top: 33%;
    text-align: center;
    margin-bottom: 48pt;
  }
  .chapter-start h2 {
    font-family: 'Courier New', Courier, monospace;
    font-size: 12pt;
    text-transform: uppercase;
  }
  p {
    text-indent: 0.5in;
    margin: 0;
  }
  p:first-of-type { text-indent: 0; }
  .scene-break {
    text-align: center;
    margin: 24pt 0;
  }
  .end-mark {
    text-align: center;
    margin-top: 48pt;
    font-weight: bold;
  }
</style>
</head>
<body>

<div class="title-page">
  <h1>${this._escapeHtml(project.name)}</h1>
  <div class="byline">by [Author Name]</div>
  <div class="wordcount">Approximately ${Math.round(totalWords / 1000) * 1000} words</div>
</div>
`;

    for (let i = 0; i < tree.length; i++) {
      const chapter = tree[i];
      html += `\n<div class="chapter-start">
  <h2>${this._escapeHtml(chapter.title)}</h2>
</div>\n\n`;

      for (let j = 0; j < chapter.scenes.length; j++) {
        const scene = chapter.scenes[j];
        const paragraphs = this._contentToParagraphs(scene.content);

        paragraphs.forEach((p, idx) => {
          html += `<p>${this._escapeHtml(p)}</p>\n`;
        });

        if (j < chapter.scenes.length - 1) {
          html += '<div class="scene-break">#</div>\n\n';
        }
      }
    }

    html += '\n<div class="end-mark">THE END</div>\n\n</body>\n</html>';

    return {
      content: html,
      filename: this._sanitizeFilename(project.name) + '_manuscript.html',
      mimeType: 'text/html'
    };
  }

  /**
   * Export as a styled HTML ebook.
   */
  async exportStyledHtml(projectId) {
    const project = await this.storage.get('projects', projectId);
    const tree = await this.manuscript.getManuscriptTree(projectId);

    let html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${this._escapeHtml(project.name)}</title>
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
  h2 {
    font-size: 1.5em;
    text-align: center;
    margin: 3em 0 1.5em;
    color: #1a1a1a;
    page-break-before: always;
  }
  p { text-indent: 1.5em; margin: 0 0 0.2em; }
  p:first-of-type, h2 + p { text-indent: 0; }
  .scene-break {
    text-align: center;
    margin: 2em 0;
    color: #999;
    letter-spacing: 1em;
  }
  .synopsis {
    font-style: italic;
    text-align: center;
    color: #666;
    margin: 0 0 3em;
    text-indent: 0;
  }
  blockquote {
    border-left: 3px solid #d4a853;
    padding-left: 1.2em;
    margin: 1em 0;
    color: #555;
    font-style: italic;
  }
</style>
</head>
<body>

<h1>${this._escapeHtml(project.name)}</h1>
`;

    if (project.synopsis) {
      html += `<p class="synopsis">${this._escapeHtml(project.synopsis)}</p>\n`;
    }

    for (const chapter of tree) {
      html += `\n<h2>${this._escapeHtml(chapter.title)}</h2>\n\n`;

      for (let j = 0; j < chapter.scenes.length; j++) {
        const scene = chapter.scenes[j];
        // Preserve the HTML content but sanitize it
        html += this._sanitizeContent(scene.content) + '\n';

        if (j < chapter.scenes.length - 1) {
          html += '<div class="scene-break">* * *</div>\n\n';
        }
      }
    }

    html += '\n</body>\n</html>';

    return {
      content: html,
      filename: this._sanitizeFilename(project.name) + '.html',
      mimeType: 'text/html'
    };
  }

  /**
   * Export full project as JSON backup.
   */
  async exportJson(projectId) {
    const data = await this.storage.exportProject(projectId);
    return {
      content: JSON.stringify(data, null, 2),
      filename: this._sanitizeFilename(data.project.name) + '_backup.json',
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
