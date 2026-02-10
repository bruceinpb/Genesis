/**
 * Genesis 2 — Editor Module
 * ContentEditable-based rich text editor optimized for iPad.
 * Supports formatting, auto-save, snapshots, and keyboard shortcuts.
 */

class Editor {
  constructor(element, options = {}) {
    this.element = element;
    this.onChanged = options.onChange || (() => {});
    this.onWordCount = options.onWordCount || (() => {});
    this.autoSaveDelay = options.autoSaveDelay || 2000;
    this._autoSaveTimer = null;
    this._lastContent = '';
    this._wordCount = 0;

    this._init();
  }

  _init() {
    this.element.contentEditable = 'true';
    this.element.spellcheck = true;
    this.element.setAttribute('role', 'textbox');
    this.element.setAttribute('aria-multiline', 'true');
    this.element.setAttribute('data-placeholder', 'Begin writing...');

    // Input handling
    this.element.addEventListener('input', () => this._handleInput());
    this.element.addEventListener('paste', (e) => this._handlePaste(e));

    // Keyboard shortcuts
    this.element.addEventListener('keydown', (e) => this._handleKeydown(e));

    // Track focus for iPad virtual keyboard
    this.element.addEventListener('focus', () => {
      document.body.classList.add('editor-focused');
    });
    this.element.addEventListener('blur', () => {
      document.body.classList.remove('editor-focused');
    });
  }

  // --- Public API ---

  setContent(html) {
    this.element.innerHTML = html || '';
    this._lastContent = this.element.innerHTML;
    this._updateWordCount();
  }

  getContent() {
    return this.element.innerHTML;
  }

  getPlainText() {
    return this.element.textContent || '';
  }

  focus() {
    this.element.focus();
    // Move cursor to end
    const range = document.createRange();
    const sel = window.getSelection();
    if (this.element.childNodes.length > 0) {
      range.selectNodeContents(this.element);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  clear() {
    this.element.innerHTML = '';
    this._lastContent = '';
    this._wordCount = 0;
  }

  getWordCount() {
    return this._wordCount;
  }

  // --- Formatting commands ---

  bold() {
    document.execCommand('bold', false, null);
    this.element.focus();
  }

  italic() {
    document.execCommand('italic', false, null);
    this.element.focus();
  }

  insertHeading(level = 2) {
    document.execCommand('formatBlock', false, `<h${level}>`);
    this.element.focus();
  }

  /**
   * Cycle heading: H1 → H2 → H3 → P (paragraph)
   */
  toggleHeading() {
    const sel = window.getSelection();
    if (!sel.rangeCount) {
      this.insertHeading(1);
      return;
    }
    const block = sel.anchorNode?.nodeType === 1
      ? sel.anchorNode
      : sel.anchorNode?.parentElement;
    const tag = block?.closest?.('h1, h2, h3, p, div')?.tagName;

    if (tag === 'H1') {
      document.execCommand('formatBlock', false, '<h2>');
    } else if (tag === 'H2') {
      document.execCommand('formatBlock', false, '<h3>');
    } else if (tag === 'H3') {
      document.execCommand('formatBlock', false, '<p>');
    } else {
      document.execCommand('formatBlock', false, '<h1>');
    }
    this.element.focus();
  }

  /**
   * Toggle inline code (monospace) formatting on selection
   */
  toggleCode() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;

    const range = sel.getRangeAt(0);
    const selectedText = range.toString();
    if (!selectedText) return;

    // Check if already wrapped in <code>
    const parent = sel.anchorNode?.parentElement;
    if (parent?.tagName === 'CODE') {
      // Unwrap: replace <code> with its text content
      const text = document.createTextNode(parent.textContent);
      parent.parentNode.replaceChild(text, parent);
    } else {
      // Wrap selection in <code>
      const code = document.createElement('code');
      code.style.cssText = 'font-family:monospace;background:rgba(128,128,128,0.15);padding:1px 4px;border-radius:3px;';
      range.surroundContents(code);
    }
    this.element.focus();
  }

  insertBlockquote() {
    document.execCommand('formatBlock', false, '<blockquote>');
    this.element.focus();
  }

  insertParagraph() {
    document.execCommand('formatBlock', false, '<p>');
    this.element.focus();
  }

  insertSceneBreak() {
    const br = '<p style="text-align:center;text-indent:0">* * *</p><p></p>';
    document.execCommand('insertHTML', false, br);
    this.element.focus();
  }

  undo() {
    document.execCommand('undo', false, null);
  }

  redo() {
    document.execCommand('redo', false, null);
  }

  // --- Private handlers ---

  _handleInput() {
    this._updateWordCount();
    this._scheduleAutoSave();
  }

  _handlePaste(e) {
    e.preventDefault();
    // Get plain text or clean HTML
    let text = e.clipboardData.getData('text/plain');
    if (text) {
      // Convert plain text to paragraphs
      const paragraphs = text.split(/\n\s*\n/);
      if (paragraphs.length > 1) {
        const html = paragraphs
          .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
          .join('');
        document.execCommand('insertHTML', false, html);
      } else {
        document.execCommand('insertText', false, text);
      }
    }
  }

  _handleKeydown(e) {
    // Cmd/Ctrl + B: Bold
    if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
      e.preventDefault();
      this.bold();
      return;
    }

    // Cmd/Ctrl + I: Italic
    if ((e.metaKey || e.ctrlKey) && e.key === 'i') {
      e.preventDefault();
      this.italic();
      return;
    }

    // Cmd/Ctrl + Z: Undo
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      this.undo();
      return;
    }

    // Cmd/Ctrl + Shift + Z: Redo
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) {
      e.preventDefault();
      this.redo();
      return;
    }

    // Tab: insert em-dash or soft indent (writer-friendly)
    if (e.key === 'Tab') {
      e.preventDefault();
      document.execCommand('insertText', false, '\u2003'); // em space
      return;
    }

    // Ensure Enter creates new paragraphs (not divs)
    if (e.key === 'Enter' && !e.shiftKey) {
      // Let default behavior handle it, but ensure paragraph format
      setTimeout(() => {
        const sel = window.getSelection();
        if (sel.rangeCount > 0) {
          const node = sel.anchorNode;
          const parent = node.nodeType === 3 ? node.parentElement : node;
          if (parent && parent !== this.element && parent.tagName !== 'P' && parent.tagName !== 'BLOCKQUOTE' && !parent.tagName.match(/^H[1-6]$/)) {
            document.execCommand('formatBlock', false, '<p>');
          }
        }
      }, 0);
    }
  }

  _updateWordCount() {
    const text = this.element.textContent || '';
    const words = text.match(/[a-zA-Z''\u2019-]+/g) || [];
    this._wordCount = words.length;
    this.onWordCount(this._wordCount);
  }

  _scheduleAutoSave() {
    if (this._autoSaveTimer) {
      clearTimeout(this._autoSaveTimer);
    }
    this._autoSaveTimer = setTimeout(() => {
      const content = this.element.innerHTML;
      if (content !== this._lastContent) {
        this._lastContent = content;
        this.onChanged(content);
      }
    }, this.autoSaveDelay);
  }

  destroy() {
    if (this._autoSaveTimer) {
      clearTimeout(this._autoSaveTimer);
    }
  }
}

export { Editor };
