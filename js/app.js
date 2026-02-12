/**
 * Genesis 2 — Main Application Controller
 * Orchestrates all modules and manages the UI.
 *
 * Uses Firestore for cloud storage (projects, chapters) and
 * IndexedDB for local-only features (characters, notes, settings).
 */

import { Storage, STORE_NAMES } from './storage.js';
import { FirestoreStorage } from './firestore-storage.js';
import { ManuscriptManager } from './manuscript.js';
import { ProseAnalyzer } from './prose.js';
import { StructureManager } from './structure.js';
import { ExportManager } from './export.js';
import { Editor } from './editor.js';
import { ProseGenerator } from './generate.js';
import { ErrorDatabase } from './error-database.js';
import { CoverEditor } from './cover-editor.js';

class App {
  constructor() {
    this.localStorage = new Storage();   // IndexedDB for local features
    this.fs = new FirestoreStorage();     // Firestore for cloud features
    this.manuscript = null;               // For characters/notes (IndexedDB)
    this.analyzer = new ProseAnalyzer();
    this.structure = new StructureManager();
    this.exporter = null;
    this.editor = null;
    this.generator = null;
    this.errorDb = null;
    this.coverEditor = null;

    this.state = {
      currentUser: null,
      currentProjectId: null,
      currentChapterId: null,
      currentMatterId: null,
      sidebarTab: 'characters',
      focusMode: false,
      sidebarOpen: true,
      theme: 'dark',
      sessionStart: Date.now()
    };

    // Chapter Navigator state
    this._navSelectedIds = new Set();
    this._navDragItem = null;
    this._navResizing = false;

    // Cached project data to avoid extra Firestore reads
    this._currentProject = null;
    this._chapterWordCounts = {};
    this._autoSaveInterval = null;
    this._currentChapterOutline = '';
    this._lastProseReview = null;
    this._lastGeneratedText = '';
    this._cachedErrorPatternsPrompt = '';
  }

  async init() {
    // Bind landing page events FIRST — these don't depend on async init
    // and must work even if later initialization steps fail.
    this._bindLandingEvents();

    // Check for saved user early (sync localStorage read)
    this.state.currentUser = window.localStorage.getItem('genesis2_userName') || null;

    try {
      // Initialize local storage (for settings, characters, notes)
      await this.localStorage.init();
      this.manuscript = new ManuscriptManager(this.localStorage);

      // Initialize modules
      this.exporter = new ExportManager(this.fs);
      this.generator = new ProseGenerator(this.localStorage);
      await this.generator.init();
      this.errorDb = new ErrorDatabase(this.localStorage, this.fs);

      // One-time cleanup of duplicate error patterns from old problem-based keying
      this.errorDb.deduplicateExistingPatterns().catch(() => {});

      // Pre-load error patterns prompt for immediate availability
      this.errorDb.buildNegativePrompt({ maxPatterns: 20, minFrequency: 2 })
        .then(prompt => { this._cachedErrorPatternsPrompt = prompt; })
        .catch(() => {});

      // Load settings
      this.state.theme = await this.localStorage.getSetting('theme', 'dark');
      this._hfToken = await this.localStorage.getSetting('hfToken', '');

      // Apply theme
      this._applyTheme(this.state.theme);

      // Initialize editor
      const editorEl = document.getElementById('editor');
      this.editor = new Editor(editorEl, {
        onChange: (content) => this._onEditorChange(content),
        onWordCount: (count) => this._onWordCountUpdate(count)
      });

      // Bind remaining UI events (editor, sidebar, etc.)
      this._bindEvents();

      // Initialize Chapter Navigator
      this._initChapterNav();

      // Initialize Cover Editor
      this.coverEditor = new CoverEditor(this);
      this.coverEditor.init();

      // Initialize Translation System
      this._initTranslation();

      // Show landing page
      await this._showLanding();

      // Register service worker
      this._registerServiceWorker();

      // ── FAILSAFE: Watch for chapter deletions and clear editor if needed ──
      this._initChapterDeletionFailsafe();
    } catch (err) {
      console.error('Genesis 2 init failed:', err);
      // Even if init fails, show the landing page so the user can still log in
      await this._showLanding();
    }
  }

  /**
   * Failsafe: MutationObserver + periodic check to clear the editor
   * if the current chapter no longer exists (e.g. after deletion).
   */
  _initChapterDeletionFailsafe() {
    // Watch the chapter navigator for changes
    const chapterNavContainer = document.getElementById('nav-chapter-items');

    if (chapterNavContainer) {
      const observer = new MutationObserver(() => {
        this._checkCurrentChapterExists();
      });
      observer.observe(chapterNavContainer, { childList: true, subtree: true });
    }

    // Periodic check every 2 seconds as ultimate backup
    setInterval(() => {
      this._checkCurrentChapterExists();
    }, 2000);
  }

  /**
   * Check if current chapter still exists; if not, clear the editor.
   */
  async _checkCurrentChapterExists() {
    if (!this.state.currentChapterId || !this.state.currentProjectId) return;
    if (this._isLoadingProject) return; // Don't interfere during project loading

    // Check if the current chapter item still exists in the navigator DOM
    const chapterEl = document.querySelector(`.nav-item[data-nav-id="${this.state.currentChapterId}"]`);
    if (chapterEl) return; // Still in DOM, nothing to do

    // Also check if navigator has been rendered (avoid false positive during initial load)
    const navContainer = document.getElementById('nav-chapter-items');
    if (!navContainer || navContainer.children.length === 0) return;

    console.log('Chapter deletion detected via failsafe — clearing editor');

    // Clear editor
    try {
      if (this.editor?.clear) this.editor.clear();
      else if (this.editor?.commands?.clearContent) this.editor.commands.clearContent();
      else if (this.editor?.commands?.setContent) this.editor.commands.setContent('');
    } catch (e) {}

    // DOM fallback
    for (const sel of ['.ProseMirror', '[contenteditable="true"]', '.tiptap']) {
      const el = document.querySelector(sel);
      if (el) { el.innerHTML = ''; break; }
    }

    this.state.currentChapterId = null;

    // Hide compare button
    const compareBtn = document.getElementById('btn-compare-current');
    if (compareBtn) compareBtn.style.display = 'none';
  }

  // ========================================
  //  Landing Page
  // ========================================

  async _showLanding() {
    // Stop auto-save
    if (this._autoSaveInterval) {
      clearInterval(this._autoSaveInterval);
      this._autoSaveInterval = null;
    }

    // Save current chapter before leaving
    await this._saveCurrentChapter();

    // Show landing, hide app
    document.getElementById('landing-page').style.display = '';
    document.getElementById('app').style.display = 'none';

    // Reset state
    this.state.currentProjectId = null;
    this.state.currentChapterId = null;
    this._currentProject = null;
    this._chapterWordCounts = {};

    if (this.state.currentUser) {
      await this._showProjectSelection();
    } else {
      this._showUserSelection();
    }
  }

  async _switchUser() {
    await this._saveCurrentChapter();
    this.state.currentUser = null;
    localStorage.removeItem('genesis-user');
    await this._showLanding();
  }

  _showUserSelection() {
    document.getElementById('landing-user-select').style.display = '';
    document.getElementById('landing-projects').style.display = 'none';
    this._loadExistingUsers();
    // Focus the name input
    setTimeout(() => document.getElementById('new-user-name')?.focus(), 300);
  }

  async _showProjectSelection() {
    document.getElementById('landing-user-select').style.display = 'none';
    document.getElementById('landing-projects').style.display = '';
    document.getElementById('landing-user-name').textContent = this.state.currentUser;
    await this._loadProjects();
  }

  async _loadExistingUsers() {
    const list = document.getElementById('user-list');
    try {
      const users = await this.fs.getAllUsers();
      if (users.length === 0) {
        list.innerHTML = '';
      } else {
        list.innerHTML = users.map(u =>
          `<button class="user-btn" data-name="${this._esc(u.displayName)}">${this._esc(u.displayName)}</button>`
        ).join('');
      }
    } catch (err) {
      console.error('Failed to load users:', err);
      list.innerHTML = `<p class="landing-error">Could not connect to database. Check Firebase configuration in js/firebase-config.js.</p>`;
    }
  }

  async _selectUser(name) {
    this.state.currentUser = name;
    window.localStorage.setItem('genesis2_userName', name);
    try {
      await this.fs.getOrCreateUser(name);
    } catch (err) {
      console.error('Failed to create user:', err);
    }
    await this._showProjectSelection();
  }

  async _loadProjects() {
    const myList = document.getElementById('my-projects-list');
    const othersList = document.getElementById('others-projects-list');
    const othersSection = document.getElementById('others-projects-section');

    myList.innerHTML = '<div class="landing-loading"><div class="generate-spinner"></div> Loading projects...</div>';

    try {
      const allProjects = await this.fs.getAllProjects();
      const myProjects = allProjects.filter(p => p.owner === this.state.currentUser);
      const otherProjects = allProjects.filter(p => p.owner !== this.state.currentUser);

      myList.innerHTML = myProjects.length > 0
        ? myProjects.map(p => this._renderProjectCard(p)).join('')
        : '<p class="projects-empty">No projects yet. Create your first one!</p>';

      if (otherProjects.length > 0) {
        othersSection.style.display = '';
        const grouped = {};
        for (const p of otherProjects) {
          if (!grouped[p.owner]) grouped[p.owner] = [];
          grouped[p.owner].push(p);
        }
        let html = '';
        for (const [owner, projects] of Object.entries(grouped)) {
          html += `<div class="owner-group"><h4>${this._esc(owner)}'s Projects</h4>`;
          html += `<div class="project-grid">`;
          html += projects.map(p => this._renderProjectCard(p)).join('');
          html += `</div></div>`;
        }
        othersList.innerHTML = html;
      } else {
        othersSection.style.display = 'none';
      }
    } catch (err) {
      console.error('Failed to load projects:', err);
      myList.innerHTML = `<p class="landing-error">Failed to load projects. Check your internet connection and Firebase configuration.</p>`;
    }
  }

  _renderProjectCard(project) {
    const updated = project.updatedAt?.toDate
      ? project.updatedAt.toDate()
      : new Date(project.updatedAt);
    const dateStr = updated.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `
      <div class="project-card" data-id="${project.id}">
        <div class="project-card-inner">
          ${project.coverImage ? `<img class="project-card-cover" src="${project.coverImage}" alt="Cover" loading="lazy">` : '<div class="project-card-cover-empty"></div>'}
          <div class="project-card-info">
            <div class="project-card-title">${this._esc(project.title)}</div>
            <div class="project-card-meta">
              ${project.genre ? `<span class="project-genre">${this._esc(project.genre)}</span>` : ''}
              <span class="project-date">Updated ${dateStr}</span>
            </div>
            <div class="project-card-goal">${(project.wordCountGoal || 0).toLocaleString()} word goal</div>
          </div>
        </div>
      </div>`;
  }

  async _createNewProject() {
    this._showNewProjectHelp();
  }

  _showNewProjectHelp() {
    const overlay = document.getElementById('new-project-help-overlay');
    if (overlay) overlay.classList.add('visible');
  }

  _showNewProjectModal() {
    const overlay = document.getElementById('new-project-overlay');
    if (!overlay) return;

    // Reset form fields
    const titleEl = document.getElementById('new-project-title');
    const genreEl = document.getElementById('new-project-genre');
    const subgenreGroupEl = document.getElementById('new-project-subgenre-group');
    const subgenreEl = document.getElementById('new-project-subgenre');
    const goalEl = document.getElementById('new-project-word-goal');
    const structureEl = document.getElementById('new-project-structure');

    if (titleEl) titleEl.value = '';
    if (goalEl) goalEl.value = '80000';
    if (subgenreGroupEl) subgenreGroupEl.style.display = 'none';
    if (subgenreEl) subgenreEl.innerHTML = '<option value="">— None —</option>';

    // Populate genre options
    if (genreEl) {
      genreEl.innerHTML = '<option value="">— Select Genre (optional) —</option>' +
        (window.GENRE_DATA || []).map(g => `<option value="${g.id}">${g.label}</option>`).join('');
    }

    // Populate structure template options
    if (structureEl) {
      const templates = this.structure.getTemplates();
      structureEl.innerHTML = templates.map(t =>
        `<option value="${t.id}" ${t.id === 'userOutline' ? '' : (t.id === 'threeAct' ? 'selected' : '')}>${t.name}</option>`
      ).join('');
    }

    overlay.classList.add('visible');
    setTimeout(() => titleEl?.focus(), 300);
  }

  async _submitNewProject() {
    const title = document.getElementById('new-project-title')?.value?.trim();
    if (!title) {
      alert('Please enter a project title.');
      return;
    }

    const genre = document.getElementById('new-project-genre')?.value || '';
    const subgenre = document.getElementById('new-project-subgenre')?.value || '';
    const wordCountGoal = parseInt(document.getElementById('new-project-word-goal')?.value) || 80000;
    const structureTemplate = document.getElementById('new-project-structure')?.value || 'threeAct';

    // Close the modal
    document.getElementById('new-project-overlay')?.classList.remove('visible');

    try {
      const project = await this.fs.createProject({
        owner: this.state.currentUser,
        title,
        genre,
        subgenre,
        wordCountGoal
      });

      // Save the structure template choice for this project
      await this.localStorage.setSetting('structureTemplate_' + project.id, structureTemplate);

      await this.fs.createChapter({
        projectId: project.id,
        chapterNumber: 1,
        title: 'Chapter One'
      });

      await this._openProject(project.id);
    } catch (err) {
      console.error('Failed to create project:', err);
      alert('Failed to create project. Check your internet connection.');
    }
  }

  async _openProject(projectId) {
    // Hide landing, show app
    document.getElementById('landing-page').style.display = 'none';
    document.getElementById('app').style.display = '';

    await this._loadProject(projectId);
  }

  // ========================================
  //  Project Import (MD / DOCX / EPUB)
  // ========================================

  async _handleImportProject(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const baseName = file.name.replace(/\.[^.]+$/, '');

    const prog = this._showProgressOverlay('Importing\u2026', file.name, 'Reading file\u2026');

    try {
      let chapters; // Array of { title: string, content: string (HTML) }

      if (ext === 'md') {
        const text = await file.text();
        prog.update(null, null, 30, 'Parsing Markdown\u2026');
        chapters = this._parseMdImport(text);
      } else if (ext === 'docx') {
        if (typeof mammoth === 'undefined') throw new Error('DOCX library not loaded. Please refresh and try again.');
        const arrayBuf = await file.arrayBuffer();
        prog.update(null, null, 30, 'Converting DOCX\u2026');
        const result = await mammoth.convertToHtml({ arrayBuffer: arrayBuf });
        chapters = this._parseHtmlImport(result.value);
      } else if (ext === 'epub') {
        if (typeof JSZip === 'undefined') throw new Error('EPUB library not loaded. Please refresh and try again.');
        const arrayBuf = await file.arrayBuffer();
        prog.update(null, null, 20, 'Extracting EPUB\u2026');
        chapters = await this._parseEpubImport(arrayBuf, (msg) => {
          prog.update(null, null, null, msg);
        });
      } else {
        throw new Error(`Unsupported file type: .${ext}`);
      }

      if (!chapters || chapters.length === 0) {
        throw new Error('No chapters found in the imported file.');
      }

      // Create the project
      prog.update(null, null, 60, 'Creating project\u2026');
      const project = await this.fs.createProject({
        owner: this.state.currentUser,
        title: baseName,
        genre: '',
        wordCountGoal: 80000
      });

      // Create chapters
      for (let i = 0; i < chapters.length; i++) {
        const pct = 60 + ((i / chapters.length) * 35);
        prog.update(null, null, pct, `Saving chapter ${i + 1} of ${chapters.length}\u2026`);
        await this.fs.createChapter({
          projectId: project.id,
          chapterNumber: i + 1,
          title: chapters[i].title || `Chapter ${i + 1}`,
          content: chapters[i].content || ''
        });
      }

      prog.update(null, null, 100, 'Done!');
      await new Promise(r => setTimeout(r, 500));

      await this._openProject(project.id);
    } catch (err) {
      console.error('Import failed:', err);
      alert('Import failed: ' + err.message);
    } finally {
      prog.remove();
    }
  }

  /**
   * Parse a Markdown file into chapters.
   * Splits on heading lines (# or ##) that look like chapter titles.
   */
  _parseMdImport(text) {
    const lines = text.split('\n');
    const chapters = [];
    let currentTitle = null;
    let currentLines = [];

    const flushChapter = () => {
      const body = currentLines.join('\n').trim();
      if (currentTitle || body) {
        chapters.push({
          title: currentTitle || `Chapter ${chapters.length + 1}`,
          content: this._mdToHTML(currentLines.join('\n').trim())
        });
      }
      currentTitle = null;
      currentLines = [];
    };

    for (const line of lines) {
      // Match # or ## headings (chapter-level)
      const headingMatch = line.match(/^#{1,2}\s+(.+)$/);
      if (headingMatch) {
        flushChapter();
        currentTitle = headingMatch[1].trim();
        continue;
      }
      currentLines.push(line);
    }
    flushChapter();

    // If no headings found, treat entire file as one chapter
    if (chapters.length === 0 && text.trim()) {
      chapters.push({
        title: 'Chapter 1',
        content: this._mdToHTML(text.trim())
      });
    }

    return chapters;
  }

  /**
   * Convert simple Markdown text to HTML paragraphs.
   */
  _mdToHTML(md) {
    if (!md) return '';
    // Split on blank lines to get paragraphs
    const blocks = md.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
    let html = '';
    for (const block of blocks) {
      // Skip headings (already used as chapter titles)
      if (/^#{1,3}\s+/.test(block)) continue;
      // Scene breaks
      if (/^[\*\-\s]{3,}$/.test(block) || block === '***' || block === '---' || block === '* * *') {
        html += '<p style="text-align:center;">* * *</p>';
        continue;
      }
      // Convert single newlines within a block to spaces (soft wrap)
      const text = block.replace(/\n/g, ' ');
      html += `<p>${text}</p>`;
    }
    return html;
  }

  /**
   * Parse HTML output (from mammoth DOCX conversion) into chapters.
   * Splits on h1/h2 elements that look like chapter titles.
   */
  _parseHtmlImport(html) {
    if (!html) return [];

    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
    const root = doc.body.firstChild;
    const chapters = [];
    let currentTitle = null;
    let currentNodes = [];

    const flushChapter = () => {
      const div = document.createElement('div');
      for (const n of currentNodes) div.appendChild(n.cloneNode(true));
      const body = div.innerHTML.trim();
      if (currentTitle || body) {
        chapters.push({
          title: currentTitle || `Chapter ${chapters.length + 1}`,
          content: body
        });
      }
      currentTitle = null;
      currentNodes = [];
    };

    for (const node of root.childNodes) {
      const tag = node.tagName?.toLowerCase();
      if (tag === 'h1' || tag === 'h2') {
        flushChapter();
        currentTitle = node.textContent.trim();
        continue;
      }
      currentNodes.push(node);
    }
    flushChapter();

    // If no headings found, treat entire content as one chapter
    if (chapters.length === 0 && html.trim()) {
      chapters.push({
        title: 'Chapter 1',
        content: html
      });
    }

    return chapters;
  }

  /**
   * Parse an EPUB file into chapters.
   * Reads the OPF manifest to find content documents in spine order,
   * then extracts text from each XHTML file.
   */
  async _parseEpubImport(arrayBuffer, onProgress) {
    const zip = await JSZip.loadAsync(arrayBuffer);

    // 1. Find the OPF file via META-INF/container.xml
    const containerXml = await zip.file('META-INF/container.xml')?.async('string');
    if (!containerXml) throw new Error('Invalid EPUB: missing container.xml');

    const containerDoc = new DOMParser().parseFromString(containerXml, 'application/xml');
    const rootfileEl = containerDoc.querySelector('rootfile');
    const opfPath = rootfileEl?.getAttribute('full-path');
    if (!opfPath) throw new Error('Invalid EPUB: no OPF path found');

    const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';

    // 2. Parse the OPF
    const opfXml = await zip.file(opfPath)?.async('string');
    if (!opfXml) throw new Error('Invalid EPUB: cannot read OPF');

    const opfDoc = new DOMParser().parseFromString(opfXml, 'application/xml');

    // Build manifest map: id → href
    const manifest = {};
    for (const item of opfDoc.querySelectorAll('manifest item')) {
      manifest[item.getAttribute('id')] = item.getAttribute('href');
    }

    // Get spine order
    const spineItems = [];
    for (const itemref of opfDoc.querySelectorAll('spine itemref')) {
      const id = itemref.getAttribute('idref');
      if (manifest[id]) spineItems.push(manifest[id]);
    }

    // 3. Parse TOC (NCX or EPUB3 nav) to get real chapter titles and boundaries
    //    This maps file hrefs → chapter titles from the table of contents
    const tocMap = new Map(); // href (without fragment) → title
    const tocOrder = [];      // ordered list of hrefs that start chapters

    // Try NCX first (EPUB 2)
    // Use > navPoint to skip nested sub-entries (Kindle splits chapters across
    // multiple files and nests continuation navPoints under the parent chapter)
    const tocId = opfDoc.querySelector('spine')?.getAttribute('toc');
    const ncxHref = tocId && manifest[tocId];
    if (ncxHref) {
      const ncxXml = await zip.file(opfDir + ncxHref)?.async('string');
      if (ncxXml) {
        const ncxDoc = new DOMParser().parseFromString(ncxXml, 'application/xml');
        for (const np of ncxDoc.querySelectorAll('navMap > navPoint')) {
          const label = np.querySelector(':scope > navLabel > text')?.textContent?.trim();
          const src = np.querySelector(':scope > content')?.getAttribute('src');
          if (label && src) {
            const bare = src.split('#')[0]; // strip fragment
            if (!tocMap.has(bare)) {
              tocMap.set(bare, label);
              tocOrder.push(bare);
            }
          }
        }
      }
    }

    // Try EPUB 3 nav if NCX yielded nothing
    // Use only top-level <li> > <a> entries to skip nested sub-sections
    if (tocMap.size === 0) {
      for (const item of opfDoc.querySelectorAll('manifest item')) {
        const props = item.getAttribute('properties') || '';
        if (props.split(/\s+/).includes('nav')) {
          const navHref = item.getAttribute('href');
          const navXml = await zip.file(opfDir + navHref)?.async('string');
          if (navXml) {
            const navDoc = new DOMParser().parseFromString(navXml, 'application/xhtml+xml');
            const tocNav = navDoc.querySelector('nav[epub\\:type="toc"], nav[role="doc-toc"]')
                        || navDoc.querySelector('nav');
            if (tocNav) {
              // Select only direct children <li> of the top-level <ol>
              const topOl = tocNav.querySelector(':scope > ol');
              const topLinks = topOl
                ? topOl.querySelectorAll(':scope > li > a[href]')
                : tocNav.querySelectorAll('a[href]');
              for (const a of topLinks) {
                const label = a.textContent.trim();
                const href = a.getAttribute('href');
                if (label && href) {
                  const bare = href.split('#')[0];
                  if (!tocMap.has(bare)) {
                    tocMap.set(bare, label);
                    tocOrder.push(bare);
                  }
                }
              }
            }
          }
          break;
        }
      }
    }

    // Build a set of spine hrefs that are TOC chapter starts for quick lookup
    const chapterStarts = new Set(tocOrder);

    // 4. Read spine documents, using TOC to determine chapter boundaries
    //    - Spine items that match a TOC entry start a new chapter (using TOC title)
    //    - Spine items NOT in the TOC are continuation sections — append to previous chapter
    //    - Even TOC-listed items are merged if they have no heading and duplicate
    //      the previous chapter's title (flat NCX with split-file entries)
    //    - If no TOC was found, fall back to heading-based detection with merging
    const chapters = [];
    const hasToc = tocMap.size > 0;

    for (let i = 0; i < spineItems.length; i++) {
      if (onProgress) onProgress(`Reading section ${i + 1} of ${spineItems.length}\u2026`);

      const spineHref = spineItems[i];
      const href = opfDir + spineHref;
      const xhtml = await zip.file(href)?.async('string');
      if (!xhtml) continue;

      const doc = new DOMParser().parseFromString(xhtml, 'application/xhtml+xml');
      const body = doc.querySelector('body');
      if (!body) continue;

      // Strip the first heading from content (to avoid duplication with title)
      const heading = body.querySelector('h1, h2, h3');
      const headingText = heading?.textContent?.trim() || '';
      if (heading) heading.remove();

      const content = body.innerHTML.trim();
      const textContent = body.textContent.trim();

      // Skip effectively empty sections (e.g. cover image only)
      if (textContent.length < 20) continue;

      if (hasToc) {
        const tocTitle = tocMap.get(spineHref);
        const isTocEntry = chapterStarts.has(spineHref);

        // Detect continuation: a TOC entry with no heading whose title matches the
        // previous chapter (flat NCX with duplicate entries for split files)
        const prevTitle = chapters.length > 0 ? chapters[chapters.length - 1].title : null;
        const isDuplicateTocEntry = isTocEntry && !headingText && prevTitle && tocTitle === prevTitle;

        if (isTocEntry && !isDuplicateTocEntry) {
          // This spine item starts a new TOC chapter
          const title = tocTitle || headingText || `Chapter ${chapters.length + 1}`;
          chapters.push({ title, content });
        } else if (chapters.length > 0) {
          // Continuation section — append to the previous chapter
          chapters[chapters.length - 1].content += '\n' + content;
        } else {
          // Before first TOC entry — treat as front matter chapter
          const title = headingText || `Chapter ${chapters.length + 1}`;
          chapters.push({ title, content });
        }
      } else {
        // Fallback: no TOC found — use heading-based detection with merge
        if (headingText) {
          chapters.push({ title: headingText, content });
        } else if (chapters.length > 0) {
          // No heading — merge with previous chapter
          chapters[chapters.length - 1].content += '\n' + content;
        } else {
          chapters.push({ title: `Chapter ${chapters.length + 1}`, content });
        }
      }
    }

    return chapters;
  }

  // ========================================
  //  Project & Chapter Management
  // ========================================

  async _loadProject(projectId) {
    this._isLoadingProject = true;
    try {
      const project = await this.fs.getProject(projectId);
      if (!project) {
        await this._showLanding();
        return;
      }

      this.state.currentProjectId = projectId;
      this._currentProject = project;

      // Update toolbar title
      document.getElementById('project-title').textContent = project.title;

      // Render chapter navigator (single chapter management area)
      await this.renderChapterNav();

      // Load first chapter
      const chapters = await this.fs.getProjectChapters(projectId);

      // Cache word counts
      this._chapterWordCounts = {};
      for (const ch of chapters) {
        this._chapterWordCounts[ch.id] = ch.wordCount || 0;
      }

      if (chapters.length > 0) {
        await this._loadChapter(chapters[0].id);
      } else {
        if (this.editor) this.editor.clear();
        this.state.currentChapterId = null;
        this._showWelcome();
      }

      // Render sidebar character list (default tab)
      await this._renderCharactersList();

      // Update cover display
      this._updateCoverDisplay();

      // Update status bar
      this._updateStatusBarLocal();

      // Start auto-save interval (30 seconds)
      if (this._autoSaveInterval) clearInterval(this._autoSaveInterval);
      this._autoSaveInterval = setInterval(() => {
        this._saveCurrentChapter();
      }, 30000);
    } catch (err) {
      console.error('Failed to load project:', err);
      alert('Failed to load project: ' + (err.message || err) + '\n\nCheck your internet connection.');
      await this._showLanding();
    } finally {
      this._isLoadingProject = false;
    }
  }

  async _loadChapter(chapterId) {
    try {
      const chapter = await this.fs.getChapter(chapterId);
      if (!chapter) return;

      // Save current chapter first
      await this._saveCurrentChapter();

      // Show editor, hide welcome
      this._hideWelcome();

      this.state.currentChapterId = chapterId;
      this.state.currentMatterId = null; // Clear matter page when loading a chapter
      this._currentChapterOutline = chapter.outline || '';
      this.editor.setContent(chapter.content || '');

      // Show chapter outline popup whenever chapter has an outline
      console.log('[Genesis] _loadChapter: outline =', !!this._currentChapterOutline, 'chapterId =', chapterId);
      if (this._currentChapterOutline) {
        console.log('[Genesis] Showing chapter outline popup for:', chapter.title);
        this._showChapterOutlinePopup(chapter.title);
      }

      // Update active state in tree
      document.querySelectorAll('.tree-item').forEach(el => {
        el.classList.toggle('active', el.dataset.id === chapterId);
      });

      // Update toolbar chapter title
      const titleEl = document.getElementById('scene-title');
      if (titleEl) titleEl.textContent = chapter.title;

      // Show/hide Compare button for translated chapters
      const compareBtn = document.getElementById('btn-compare-current');
      if (compareBtn) {
        compareBtn.style.display = chapter.isTranslation ? 'inline-block' : 'none';
      }
    } catch (err) {
      console.error('Failed to load chapter:', err);
    }
  }

  async _saveCurrentChapter() {
    // Save matter page if one is active
    if (this.state.currentMatterId) {
      await this._saveMatterPage();
      return;
    }
    if (!this.state.currentChapterId) return;
    const content = this.editor.getContent();
    try {
      await this.fs.updateChapter(this.state.currentChapterId, { content });
    } catch (err) {
      console.error('Auto-save failed:', err);
    }
  }

  // ========================================
  //  Editor Events
  // ========================================

  async _onEditorChange(content) {
    // Save matter page if one is active
    if (this.state.currentMatterId) {
      await this._saveMatterPage();
      return;
    }

    if (!this.state.currentChapterId) return;

    // Save to Firestore
    try {
      await this.fs.updateChapter(this.state.currentChapterId, { content });
    } catch (err) {
      console.error('Save failed:', err);
    }

    // Update local word count displays
    this._updateLocalWordCounts(content);
  }

  _onWordCountUpdate(count) {
    const wcEl = document.getElementById('status-words');
    if (wcEl) wcEl.textContent = count.toLocaleString();

    const fwcWords = document.getElementById('fwc-words');
    if (fwcWords) fwcWords.textContent = count.toLocaleString();

    this._trackDailyWords(count);
  }

  _updateLocalWordCounts(content) {
    const text = content.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');
    const words = text.match(/[a-zA-Z'''\u2019-]+/g) || [];
    const chapterWords = words.length;

    // Update tree item
    const chEl = document.querySelector(`.tree-item[data-id="${this.state.currentChapterId}"] .word-count`);
    if (chEl) chEl.textContent = chapterWords.toLocaleString();

    // Update cached word count
    this._chapterWordCounts[this.state.currentChapterId] = chapterWords;

    // Recalculate total
    const total = Object.values(this._chapterWordCounts).reduce((sum, wc) => sum + wc, 0);

    const totalEl = document.getElementById('status-total');
    if (totalEl) totalEl.textContent = total.toLocaleString();
    const fwcTotal = document.getElementById('fwc-total');
    if (fwcTotal) fwcTotal.textContent = total.toLocaleString();

    // Update progress
    const project = this._currentProject;
    if (project) {
      const goal = project.wordCountGoal || 80000;
      const progress = Math.round((total / goal) * 100);
      const progressEl = document.getElementById('status-progress');
      if (progressEl) progressEl.textContent = progress + '%';
      const fwcProgress = document.getElementById('fwc-progress');
      if (fwcProgress) fwcProgress.textContent = progress + '%';
    }
  }

  // ========================================
  //  Sidebar Rendering
  // ========================================

  async _renderChapterList() {
    // Chapter list is now consolidated into the Chapter Navigator.
    // Redirect to renderChapterNav which is the single chapter management area.
    if (!this.state.currentProjectId) return;
    try {
      await this.renderChapterNav();
    } catch (err) {
      console.error('Failed to render chapter nav:', err);
    }
  }

  async _renderCharactersList() {
    const container = document.getElementById('sidebar-characters');
    if (!container || !this.state.currentProjectId) return;

    // Characters stored locally in IndexedDB
    const characters = await this.localStorage.getProjectCharacters(this.state.currentProjectId);

    let html = '';
    for (const char of characters) {
      html += `
        <div class="character-card" data-id="${char.id}">
          <div class="name">${this._esc(char.name)}</div>
          <div class="role">${char.role}</div>
          ${char.description ? `<div class="desc">${this._esc(char.description.substring(0, 100))}</div>` : ''}
        </div>`;
    }

    html += `
      <button class="tree-add" data-action="add-character">
        + Character
      </button>`;

    container.innerHTML = html;
  }

  async _renderNotesList() {
    const container = document.getElementById('sidebar-notes');
    if (!container || !this.state.currentProjectId) return;

    // Notes stored locally in IndexedDB
    const notes = await this.localStorage.getProjectNotes(this.state.currentProjectId);

    let html = '';
    for (const note of notes) {
      html += `
        <div class="tree-item" data-id="${note.id}" data-type="note">
          <span class="icon">&#9998;</span>
          <span class="name">${this._esc(note.title)}</span>
          <span class="word-count">${note.type}</span>
        </div>`;
    }

    html += `
      <button class="tree-add" data-action="add-note">
        + Note
      </button>`;

    container.innerHTML = html;
  }

  // ========================================
  //  Panels
  // ========================================

  async openAnalysisPanel() {
    const content = this.editor.getContent();
    const analysis = this.analyzer.analyze(content);
    const score = this.analyzer.calculateScore(analysis);

    const body = document.getElementById('panel-analysis-body');
    if (!body) return;

    body.innerHTML = this._renderAnalysis(analysis, score);
    this._showPanel('analysis');
  }

  async openStructurePanel() {
    // Structure is now part of the Book Setup tab in the central modal
    await this.openSetupBookModal('book');
  }

  async openExportPanel() {
    await this.openSetupBookModal('export');
  }

  async openGeneratePanel() {
    await this.openSetupBookModal('ai-writer');
    setTimeout(() => document.getElementById('generate-plot')?.focus(), 300);
  }

  async _runGeneration(options = {}) {
    let plot, wordTarget, tone, style, useCharacters;
    if (options.isContinuation && this._lastGenSettings) {
      plot = this._lastGenSettings.plot;
      wordTarget = options.wordTarget || this._lastGenSettings.wordTarget;
      tone = this._lastGenSettings.tone;
      style = this._lastGenSettings.style;
      useCharacters = this._lastGenSettings.useCharacters;
    } else {
      plot = document.getElementById('generate-plot')?.value?.trim();
      if (!plot) {
        alert('Please enter a story plot or description.');
        return;
      }
      wordTarget = parseInt(document.getElementById('generate-word-target')?.value) || 1000;
      tone = document.getElementById('generate-tone')?.value?.trim() || '';
      style = document.getElementById('generate-style')?.value?.trim() || '';
      useCharacters = document.getElementById('generate-use-characters')?.checked;
    }

    const existingContent = this.editor.getContent();
    // Store pre-generation content so rewrite can roll back to it
    this._preGenerationContent = existingContent;
    let characters = [];
    if (useCharacters && this.state.currentProjectId) {
      characters = await this.localStorage.getProjectCharacters(this.state.currentProjectId);
    }

    // Load project notes if checkbox is checked
    let useNotes;
    if (options.isContinuation && this._lastGenSettings) {
      useNotes = this._lastGenSettings.useNotes;
    } else {
      useNotes = document.getElementById('generate-use-notes')?.checked;
    }
    let notes = '';
    if (useNotes && this.state.currentProjectId) {
      const projectNotes = await this.localStorage.getProjectNotes(this.state.currentProjectId);
      if (projectNotes.length > 0) {
        notes = projectNotes.map(n => {
          let entry = n.title;
          if (n.type && n.type !== 'general') entry = `[${n.type}] ${entry}`;
          if (n.content) entry += '\n' + n.content;
          return entry;
        }).join('\n\n');
      }
    }

    // Append project knowledge base as reference materials
    const knowledgePromptMain = await this._getProjectKnowledge();
    if (knowledgePromptMain) {
      notes = notes ? notes + '\n\n' + knowledgePromptMain : knowledgePromptMain;
    }

    // Load AI instructions from project
    const aiInstructions = this._currentProject?.aiInstructions || '';

    this._lastGenSettings = { plot, wordTarget, tone, style, useCharacters, useNotes, chapterOutline: this._currentChapterOutline || '' };

    // Get chapter title
    let chapterTitle = '';
    if (this.state.currentChapterId) {
      try {
        const chapter = await this.fs.getChapter(this.state.currentChapterId);
        if (chapter) chapterTitle = chapter.title;
      } catch (_) {}
    }

    // Build conclusion instructions if needed
    let concludeStory = options.concludeStory || false;
    const project = this._currentProject;
    const projectGoal = project ? (project.wordCountGoal || 0) : 0;
    const genreId = project ? (project.genre || '') : '';
    const subgenreId = project ? (project.subgenre || '') : '';
    const genreInfo = this._getGenreRules(genreId, subgenreId);
    const genre = genreInfo ? genreInfo.label : '';
    const genreRules = genreInfo ? genreInfo.rules : '';

    this._showContinueBar(false);
    this._setGenerateStatus(true);
    this._generateCancelled = false;
    const errEl = document.getElementById('generate-error');
    if (errEl) { errEl.style.display = 'none'; }

    // Hide chapter outline popup once generation begins
    this._hideChapterOutlinePopup();

    this._closeAllPanels();
    this._hideWelcome();

    const editorEl = this.editor.element;

    // Load chapter outline if available
    const chapterOutline = this._currentChapterOutline || '';

    // Load error patterns from the cross-project database as negative prompts
    let errorPatternsPrompt = '';
    if (this.errorDb) {
      try {
        errorPatternsPrompt = await this.errorDb.buildNegativePrompt({ maxPatterns: 20, minFrequency: 2 });
        this._cachedErrorPatternsPrompt = errorPatternsPrompt;
      } catch (_) {}
    }

    // --- Chunked generation with scoring between chunks ---
    // Break the total word target into scored chunks.
    // After each chunk, halt and score the prose, then continue.
    const CHUNK_SIZE = 1000;
    const maxTokensPerChunk = 4096; // ~1000 words
    let wordsGenerated = 0;
    let chunkNum = 0;
    let allStreamedText = '';
    let chunkScores = []; // Track per-chunk best scores for weighted average
    const generationSessionKey = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Show iterative overlay for the scoring phases
    const qualityThresholdDisplay = this._currentProject?.qualityThreshold || 90;
    this._showIterativeOverlay(true);
    this._showIterativeScoringNotice(false);
    this._updateIterativeScore(null);
    this._updateIterativeIteration(0, 0);
    // Update threshold display
    const thresholdLabelEl = document.getElementById('iterative-threshold-label');
    if (thresholdLabelEl) thresholdLabelEl.textContent = `Target: ${qualityThresholdDisplay}%`;
    const thresholdMarkerEl = document.getElementById('iterative-progress-threshold');
    if (thresholdMarkerEl) thresholdMarkerEl.style.left = qualityThresholdDisplay + '%';
    const logEl = document.getElementById('iterative-status-log');
    if (logEl) logEl.textContent = `Generating ~${wordTarget} words in scored chunks (threshold: ${qualityThresholdDisplay}%)\u2026`;

    while (wordsGenerated < wordTarget && !this._generateCancelled) {
      chunkNum++;
      const remaining = wordTarget - wordsGenerated;
      const thisChunkTarget = Math.min(CHUNK_SIZE, remaining);
      const isLastChunk = remaining <= CHUNK_SIZE;

      this._updateIterativeChunk(chunkNum);
      this._updateIterativePhase('Generating\u2026');
      this._updateIterativeLog(`Chunk ${chunkNum}: Generating ~${thisChunkTarget} words\u2026`);

      let streamedText = '';
      const currentExisting = this.editor.getContent();

      try {
        await new Promise((resolve, reject) => {
          if (this._generateCancelled) { resolve(); return; }

          this.generator.generate(
            {
              plot,
              existingContent: currentExisting,
              chapterTitle,
              characters,
              notes,
              chapterOutline,
              aiInstructions,
              tone,
              style,
              wordTarget: thisChunkTarget,
              maxTokens: maxTokensPerChunk,
              concludeStory: isLastChunk && concludeStory,
              genre,
              genreRules,
              projectGoal,
              voice: project?.voice || '',
              errorPatternsPrompt,
              poetryLevel: project?.poetryLevel || 3,
              authorPalette: project?.authorPalette || ''
            },
            {
              onChunk: (text) => {
                streamedText += text;
                streamedText = this._stripEmDashes(streamedText);
                const startingContent = currentExisting.trim() ? currentExisting : '';
                const paragraphs = streamedText.split('\n\n');
                const newHtml = paragraphs
                  .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
                  .join('');
                editorEl.innerHTML = startingContent + newHtml;
                const container = editorEl.closest('.editor-area');
                if (container) container.scrollTop = container.scrollHeight;
                const wc = editorEl.textContent.match(/[a-zA-Z'''\u2019-]+/g) || [];
                const chapterWords = wc.length;
                const wordsEl = document.getElementById('status-words');
                if (wordsEl) wordsEl.textContent = chapterWords.toLocaleString();
                const fwcWords = document.getElementById('fwc-words');
                if (fwcWords) fwcWords.textContent = chapterWords.toLocaleString();
                this._updateLocalWordCounts(editorEl.innerHTML);
                this._trackDailyWords(chapterWords);
              },
              onDone: () => {
                // Format headings and scene breaks
                editorEl.innerHTML = this._formatGeneratedHtml(editorEl.innerHTML, chapterTitle);
                const content = this.editor.getContent();
                if (this.state.currentChapterId) {
                  this.fs.updateChapter(this.state.currentChapterId, { content }).catch(() => {});
                  this._updateLocalWordCounts(content);
                }
                resolve();
              },
              onError: (err) => reject(err)
            }
          );
        });
      } catch (err) {
        this._setGenerateStatus(false);
        this._showIterativeOverlay(false);
        this._autoWriteToGoal = false;
        this._writeToGoalTarget = 0;
        this._showSetupBookModal();
        this._switchSetupTab('ai-writer');
        if (errEl) {
          errEl.style.display = 'block';
          errEl.textContent = err.message;
        }
        return;
      }

      if (this._generateCancelled) break;

      // Count words in this chunk
      const chunkWords = (streamedText.match(/[a-zA-Z'''\u2019-]+/g) || []).length;
      wordsGenerated += chunkWords;
      allStreamedText += streamedText;

      this._updateIterativeLog(`Chunk ${chunkNum}: Generated ${chunkWords} words (${wordsGenerated}/${wordTarget} total)`);

      // If chunk was too small or empty, stop to avoid infinite loop
      if (chunkWords < 10) break;

      // === MICRO-FIX ITERATION PIPELINE (v2 — with internal validation) ===
      if (streamedText.length > 50) {
        const qualityThreshold = this._currentProject?.qualityThreshold || 90;
        const MAX_MICRO_ITERATIONS = 8;
        const SCORE_NOISE_FLOOR = 2;  // Don't reject a fix for a 1-2 point score difference
        let currentText = streamedText;
        let bestScore = 0;
        let bestText = streamedText;
        let bestReview = null;
        let previousFixes = [];    // Accepted fixes (descriptions)
        let attemptedFixes = [];   // ALL attempted fixes — including rejected ones
        let consecutiveNoFix = 0;  // Track consecutive passes with no viable fix

        // Reset iteration display for this chunk
        this._updateIterativeScore(null);
        this._updateIterativeIteration(0, 0);
        this._resetScoreHistory();

        // --- Deterministic lint ---
        let lintResult = this.analyzer.lintProse(currentText);
        let hardDefects = lintResult.defects.filter(d => d.severity === 'hard');
        this._updateIterativeLog(`Chunk ${chunkNum}: Lint \u2014 ${hardDefects.length} hard, ${lintResult.stats.mediumDefects || 0} medium defects`);

        // Calculate local quality metrics
        if (lintResult.qualityMetrics) {
          const qm = lintResult.qualityMetrics;
          this._updateIterativeLog(`Chunk ${chunkNum}: Metrics \u2014 Sentence StdDev: ${qm.sentenceLengthStdDev}, Short%: ${qm.shortSentencePct}%, Filters: ${qm.filterWordCount}`);
        }

        // --- Intent ledger (once) ---
        let intentLedger = null;
        try {
          this._updateIterativePhase('Locking intent\u2026');
          this._updateIterativeLog(`Chunk ${chunkNum}: Generating intent ledger\u2026`);
          intentLedger = await this.generator.generateIntentLedger({
            plot, chapterOutline, characters,
            existingProse: currentText, chapterTitle
          });
          this._updateIterativeLog(`Chunk ${chunkNum}: Intent locked (POV: ${intentLedger.povType}, tense: ${intentLedger.tense})`);
        } catch (err) {
          this._updateIterativeLog(`Chunk ${chunkNum}: Intent ledger failed: ${err.message}. Continuing without.`);
        }

        // --- Micro-fix loop ---
        for (let iteration = 1; iteration <= MAX_MICRO_ITERATIONS; iteration++) {
          if (this._generateCancelled) break;

          // Re-lint current text
          lintResult = this.analyzer.lintProse(currentText);
          hardDefects = lintResult.defects.filter(d => d.severity === 'hard');

          const isFinalPass = iteration === MAX_MICRO_ITERATIONS;
          this._updateIterativePhase(`Pass ${iteration}/${MAX_MICRO_ITERATIONS}${isFinalPass ? ' (final score)' : ''}\u2026`);
          this._showIterativeScoringNotice(true);
          this._updateIterativeLog(`Chunk ${chunkNum}: Pass ${iteration}${isFinalPass ? ' (final score only)' : ' \u2014 scoring + micro-fix'}\u2026`);

          let result;
          try {
            result = await this.generator.scoreAndMicroFix(currentText, {
              threshold: qualityThreshold,
              iterationNum: iteration,
              maxIterations: MAX_MICRO_ITERATIONS,
              previousFixes,
              attemptedFixes,
              lintDefects: hardDefects,
              intentLedger,
              genre,
              voice: project?.voice || '',
              aiInstructions,
            });
          } catch (err) {
            this._updateIterativeLog(`Chunk ${chunkNum}: Pass ${iteration} failed: ${err.message}`);
            break;
          }

          this._showIterativeScoringNotice(false);
          if (this._generateCancelled) break;

          if (!result || result.beforeScore === 0) {
            this._updateIterativeLog(`Chunk ${chunkNum}: Scoring returned 0. Using current text.`);
            break;
          }

          const beforeScore = result.beforeScore;
          const afterScore = result.afterScore || beforeScore;

          // On first pass, establish the baseline score
          if (iteration === 1 && bestScore === 0) {
            bestScore = beforeScore;
          }

          // Skip fix if scoring variance has pushed us too far below best
          // (the fix can only gain ~2 points, so if we're 4+ below, it's hopeless)
          if (iteration > 1 && beforeScore < bestScore - 3) {
            this._updateIterativeLog(
              `Chunk ${chunkNum}: Before-score ${beforeScore} is ${bestScore - beforeScore} below best (${bestScore}). ` +
              `Skipping fix (variance too large to recover). Keeping best text.`
            );
            break; // Exit loop — further passes will also suffer variance
          }

          this._updateIterativeScore(beforeScore, true);
          this._recordIterationScore(iteration, beforeScore);
          this._updateIterativeIteration(iteration, bestScore);

          // Log results
          const issueCount = result.issues?.length || 0;
          this._updateIterativeLog(`Chunk ${chunkNum}: Pass ${iteration} \u2014 Before: ${beforeScore}/100 | After: ${afterScore}/100 (${result.label}) | Issues: ${issueCount}`);

          if (result.fixApplied) {
            this._updateIterativeLog(`Chunk ${chunkNum}: Fix: [${result.fixCategory || '?'}] ${result.fixApplied}`);
          }

          // Log internal validation
          if (result.internalValidation) {
            this._updateIterativeLog(`Chunk ${chunkNum}: Validation: ${result.internalValidation}`);
          }

          // Log Four Requirements
          if (result.fourRequirementsFound) {
            const found = Object.entries(result.fourRequirementsFound)
              .filter(([_, v]) => v)
              .map(([k]) => k.replace(/([A-Z])/g, ' $1').trim());
            this._updateIterativeLog(`Chunk ${chunkNum}: Four Requirements: ${found.length}/4`);
            this._updateFourRequirementsDisplay(result.fourRequirementsFound);
          }

          // Record errors to cross-project database (non-blocking)
          if (this.errorDb && issueCount > 0) {
            this.errorDb.recordFromReview(result, {
              projectId: this.state.currentProjectId,
              chapterId: this.state.currentChapterId,
              chapterTitle, genre, sessionKey: generationSessionKey
            }).catch(() => {});
            try {
              errorPatternsPrompt = await this.errorDb.buildNegativePrompt({ maxPatterns: 20, minFrequency: 1 });
              this._cachedErrorPatternsPrompt = errorPatternsPrompt;
            } catch (_) {}
          }

          // Track attempted fix (whether or not it's accepted)
          if (result.fixTarget) {
            attemptedFixes.push(`[${result.fixCategory || 'unknown'}] Target: "${(result.fixTarget || '').slice(0, 80)}" \u2014 ${(result.fixApplied || '').slice(0, 100)}`);
          }

          // === DECISION: Accept or reject the fix ===

          // Case 1: No fix was produced (model self-rejected, or score >= threshold, or final pass)
          if (!result.microFixedProse) {
            // Smart early exit: track consecutive passes with no viable fix
            consecutiveNoFix++;
            if (consecutiveNoFix >= 2 && !isFinalPass) {
              this._updateIterativeLog(`Chunk ${chunkNum}: Two consecutive passes with no viable fix. Best: ${bestScore}/100`);
              break;
            }

            // Update best score if this scoring was higher (reduces variance drift)
            if (beforeScore > bestScore) {
              bestScore = beforeScore;
              bestReview = result;
            }

            if (beforeScore >= qualityThreshold) {
              this._updateIterativeLog(`Chunk ${chunkNum}: PASSED threshold (${qualityThreshold}). Score: ${beforeScore}/100`);
              break;
            }

            if (isFinalPass) {
              this._updateIterativeLog(`Chunk ${chunkNum}: Final pass. Best: ${bestScore}/100`);
              break;
            }

            if (result.fixApplied && result.fixApplied.includes('Could not fix')) {
              this._updateIterativeLog(`Chunk ${chunkNum}: Model could not find a safe fix. Best: ${bestScore}/100`);
              // Don't break \u2014 try another iteration, the model might find a different issue
              continue;
            }

            this._updateIterativeLog(`Chunk ${chunkNum}: No fix returned. Continuing\u2026`);
            continue;
          }

          // Case 2: Fix was produced \u2014 validate it
          // The model already self-validated (afterScore > beforeScore), but we do external checks too

          const preWords = (currentText.match(/[a-zA-Z\u2019'''-]+/g) || []).length;
          const postWords = (result.microFixedProse.match(/[a-zA-Z\u2019'''-]+/g) || []).length;
          const wordDrift = Math.abs(postWords - preWords) / Math.max(preWords, 1);

          // External check 1: Word count drift
          if (wordDrift > 0.15) {
            this._updateIterativeLog(`Chunk ${chunkNum}: Fix REJECTED \u2014 word count drift ${Math.round(wordDrift * 100)}% (${preWords} \u2192 ${postWords})`);
            continue;
          }

          // External check 2: No new hard lint defects
          // First, auto-fix trivially correctable hard defects (em dashes)
          let cleanedProse = result.microFixedProse;
          const preLint = this.analyzer.lintProse(cleanedProse);
          const preHardDefects = preLint.defects.filter(d => d.severity === 'hard');

          if (preHardDefects.length > hardDefects.length) {
            // Check if the ONLY new defects are em dashes \u2014 these can be auto-fixed
            const newDefects = preHardDefects.filter(d =>
              !hardDefects.some(hd => hd.text === d.text && hd.position === d.position)
            );
            const allEmDash = newDefects.every(d => d.type === 'em-dash');

            if (allEmDash && newDefects.length <= 3) {
              // Auto-fix: replace em dashes with commas
              cleanedProse = cleanedProse
                .replace(/\s*[\u2014\u2013]\s*/g, ', ')   // em/en dash \u2192 comma
                .replace(/\s*---\s*/g, ', ')                // triple hyphen \u2192 comma
                .replace(/,\s*,/g, ',')                     // cleanup double commas
                .replace(/\s+/g, ' ')                       // cleanup whitespace
                .trim();

              // Re-lint after auto-fix
              const postLint = this.analyzer.lintProse(cleanedProse);
              const postHardDefects = postLint.defects.filter(d => d.severity === 'hard');

              if (postHardDefects.length <= hardDefects.length) {
                this._updateIterativeLog(`Chunk ${chunkNum}: Auto-fixed ${newDefects.length} em dash(es) in replacement text`);
                result.microFixedProse = cleanedProse;
                // Fall through to acceptance checks below
              } else {
                this._updateIterativeLog(`Chunk ${chunkNum}: Fix REJECTED \u2014 introduced ${postHardDefects.length - hardDefects.length} non-em-dash hard defects`);
                continue;
              }
            } else {
              this._updateIterativeLog(`Chunk ${chunkNum}: Fix REJECTED \u2014 introduced ${newDefects.length} new hard defect(s): ${newDefects.map(d => d.type).join(', ')}`);
              continue;
            }
          }

          // External check 3: The model's own afterScore should be higher
          // (We already null'd microFixedProse if afterScore <= beforeScore in the method,
          //  but double-check here)
          if (afterScore < beforeScore) {
            this._updateIterativeLog(`Chunk ${chunkNum}: Fix REJECTED \u2014 model's own after-score (${afterScore}) lower than before (${beforeScore})`);
            continue;
          }

          // All checks passed \u2014 but only update text if afterScore >= bestScore
          // Otherwise the fix is internally valid but globally regressive
          consecutiveNoFix = 0;
          if (afterScore >= bestScore) {
            currentText = result.microFixedProse;
            bestText = result.microFixedProse;
            bestScore = afterScore;
            bestReview = result;
            previousFixes.push(result.fixApplied || 'Unknown fix');
            this._updateIterativeLog(`Chunk ${chunkNum}: Fix ACCEPTED. Before: ${beforeScore} \u2192 After: ${afterScore}. Best: ${bestScore}/100`);
          } else {
            // Fix improved from before but didn't reach the previous best
            // This means scoring variance \u2014 don't change text
            this._updateIterativeLog(`Chunk ${chunkNum}: Fix improved (${beforeScore}\u2192${afterScore}) but below best (${bestScore}). Text NOT changed to avoid regression.`);
            // Still record as attempted so we don't retry the same fix
          }

          // Check if we passed threshold
          if (afterScore >= qualityThreshold) {
            this._updateIterativeLog(`Chunk ${chunkNum}: PASSED threshold (${qualityThreshold}) after fix. Score: ${afterScore}/100`);
            break;
          }

          // Brief pause
          await new Promise(r => setTimeout(r, 500));
        }

        // Record errors to database
        if (this.errorDb && bestReview) {
          const issueCount = (bestReview.issues?.length || 0);
          if (issueCount > 0) {
            this.errorDb.recordFromReview(bestReview, {
              projectId: this.state.currentProjectId,
              chapterId: this.state.currentChapterId,
              chapterTitle, genre, sessionKey: generationSessionKey
            }).catch(() => {});
          }
        }

        // Restore best version in editor
        if (bestText !== streamedText) {
          const startingContent = currentExisting.trim() ? currentExisting : '';
          const paragraphs = bestText.split('\n\n');
          const html = paragraphs.map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
          editorEl.innerHTML = startingContent + html;
          editorEl.innerHTML = this._formatGeneratedHtml(editorEl.innerHTML, chapterTitle);
          if (this.state.currentChapterId) {
            this.fs.updateChapter(this.state.currentChapterId, { content: this.editor.getContent() }).catch(() => {});
            this._updateLocalWordCounts(this.editor.getContent());
          }
        }

        chunkScores.push({ score: bestScore, words: chunkWords, review: bestReview });
        this._updateIterativeLog(`Chunk ${chunkNum}: Complete. Best: ${bestScore}/100 (${previousFixes.length} accepted, ${attemptedFixes.length} attempted)`);
      }

      // Check if we should stop (close to target or generation cancelled)
      if (wordsGenerated >= wordTarget * 0.9) break;
    }

    // All chunks done
    this._setGenerateStatus(false);

    // Save final content
    const finalContent = this.editor.getContent();
    if (this.state.currentChapterId) {
      try {
        await this.fs.updateChapter(this.state.currentChapterId, { content: finalContent });
      } catch (_) {}
      this._updateLocalWordCounts(finalContent);
    }

    // Write to Goal: check if we need another chunk
    if (this._autoWriteToGoal && this._writeToGoalTarget > 0) {
      const currentTotal = this._getTotalWordCount();
      const goal = this._writeToGoalTarget;
      const maxOverage = this._writeToGoalMaxOverage || Math.round(goal * 0.03);
      const remaining = goal - currentTotal;

      if (remaining > maxOverage * -1 && remaining > 50) {
        this._showIterativeOverlay(false);
        const nextChunk = Math.min(remaining, 2000);
        const isLastChunkForGoal = remaining <= 2000;
        setTimeout(() => this._runGeneration({
          isContinuation: true,
          wordTarget: nextChunk,
          concludeStory: isLastChunkForGoal,
          writeToGoal: true
        }), 1500);
        return;
      } else {
        this._autoWriteToGoal = false;
        this._writeToGoalTarget = 0;
      }
    }

    // Final scoring of all generated prose against the threshold
    if (allStreamedText && allStreamedText.length > 100) {
      const finalThreshold = this._currentProject?.qualityThreshold || 90;

      // Calculate weighted average of chunk scores for consistency check
      let weightedAvg = 0;
      if (chunkScores.length > 0) {
        const totalChunkWords = chunkScores.reduce((s, c) => s + c.words, 0);
        weightedAvg = totalChunkWords > 0
          ? Math.round(chunkScores.reduce((s, c) => s + c.score * c.words, 0) / totalChunkWords)
          : Math.round(chunkScores.reduce((s, c) => s + c.score, 0) / chunkScores.length);
      }

      this._updateIterativePhase('Scoring complete work\u2026');
      this._updateIterativeLog(`All ${chunkNum} chunks complete (avg: ${weightedAvg}). Scoring full text against threshold (${finalThreshold}%)\u2026`);
      this._showIterativeScoringNotice(true);

      try {
        // Use iteration's best scores if weighted average already >= threshold
        // This avoids scoring variance between scoreAndMicroFix and scoreProse
        let finalReview;
        if (weightedAvg >= finalThreshold && chunkScores.length > 0) {
          finalReview = { score: weightedAvg, label: 'Strong - Distinctive Human Voice', issues: [], aiPatterns: [], subscores: {}, summary: 'Passed threshold during iteration scoring.' };
          this._updateIterativeLog(`Chunk iteration average (${weightedAvg}) already meets threshold (${finalThreshold}). Skipping full-text rescore to avoid variance.`);
          this._showIterativeScoringNotice(false);
        } else {
          finalReview = await this.generator.scoreProse(allStreamedText);
          this._showIterativeScoringNotice(false);
        }

        if (finalReview && finalReview.score > 0) {
          let finalScore = finalReview.score;

          // Use whichever score is higher: iteration's best chunk or fresh final review
          // This protects against scoring variance between iteration and final scoreProse
          const chunkBest = chunkScores.reduce((best, c) => c.score > best.score ? c : best, { score: 0 });
          if (chunkBest.score > finalScore && chunkBest.review) {
            this._updateIterativeLog(`Iteration best (${chunkBest.score}) > final review (${finalScore}). Using iteration best.`);
            finalReview = { ...chunkBest.review };
            finalScore = chunkBest.score;
            finalReview.score = chunkBest.score;
          }

          // If full-text score is significantly lower than the weighted chunk average,
          // use the chunk average as a floor (within 5 points) to prevent scoring inconsistency
          if (weightedAvg > 0 && finalScore < weightedAvg - 5) {
            const adjustedScore = weightedAvg - 3;
            this._updateIterativeLog(`Full-text score (${finalScore}) was inconsistent with chunk average (${weightedAvg}). Adjusted to ${adjustedScore}.`);
            finalScore = adjustedScore;
            finalReview.score = adjustedScore;
          }

          // Display the higher of chunk average vs final score to avoid variance confusion
          const displayScore = Math.max(weightedAvg || 0, finalScore);
          if (displayScore > finalScore) {
            this._updateIterativeLog(`Using chunk average (${weightedAvg}) for display (higher than final score ${finalScore}).`);
          }

          this._updateIterativeScore(displayScore);
          this._updateIterativeLog(`Final score: ${displayScore}/100 (threshold: ${finalThreshold})`);

          if (displayScore >= finalThreshold) {
            this._updateIterativeLog(`Full text passed threshold! Score: ${displayScore}/${finalThreshold}`);
          } else {
            this._updateIterativeLog(`Full text below threshold: ${displayScore}/${finalThreshold}. Review and fix options will be shown.`);
          }

          // Update finalReview.score to display score for the review modal
          finalReview.score = displayScore;

          // Brief pause for user to see the final score
          await new Promise(r => setTimeout(r, 1500));
          this._showIterativeOverlay(false);

          // Record final review errors into the cross-project error database (session-aware)
          if (this.errorDb && ((finalReview.issues?.length || 0) + (finalReview.aiPatterns?.length || 0)) > 0) {
            this.errorDb.recordFromReview(finalReview, {
              projectId: this.state.currentProjectId,
              chapterId: this.state.currentChapterId,
              chapterTitle,
              genre,
              sessionKey: generationSessionKey
            }).catch(() => {});
          }

          // Show the full prose review with threshold context
          finalReview._qualityThreshold = finalThreshold;
          this._showProseReview(finalReview, allStreamedText);
        } else {
          this._showIterativeOverlay(false);
          this._scoreProse(allStreamedText);
        }
      } catch (err) {
        this._showIterativeScoringNotice(false);
        this._showIterativeOverlay(false);
        console.error('Final scoring failed:', err);
        this._scoreProse(allStreamedText);
      }
    } else {
      this._showIterativeOverlay(false);
    }

    this._showContinueBar(true);
  }

  _showContinueBar(show) {
    const bar = document.getElementById('continue-bar');
    if (bar) bar.style.display = show ? 'flex' : 'none';
  }

  _getTotalWordCount() {
    return Object.values(this._chapterWordCounts).reduce((sum, wc) => sum + wc, 0);
  }

  async _handleContinueWriting(wordTarget) {
    const project = this._currentProject;
    const totalWords = this._getTotalWordCount();
    const goal = project ? (project.wordCountGoal || 0) : 0;

    // Check if this generation would exceed the project word count goal
    if (goal > 0 && totalWords + wordTarget > goal) {
      const remaining = Math.max(0, goal - totalWords);
      const willExceed = remaining < wordTarget;

      if (willExceed && remaining > 0) {
        const proceed = confirm(
          `Your story has ${totalWords.toLocaleString()} words with a goal of ${goal.toLocaleString()}. ` +
          `Adding ~${wordTarget.toLocaleString()} words will exceed the goal.\n\n` +
          `Would you like the AI to write a conclusion to wrap up the story instead?`
        );
        if (proceed) {
          // User wants to wrap up — generate remaining words with conclusion instructions
          this._showContinueBar(false);
          this._lastGenSettings.wordTarget = wordTarget;
          await this._runGeneration({ isContinuation: true, concludeStory: true, wordTarget });
          return;
        }
        // User said no — generate normally without conclusion
      } else if (remaining <= 0) {
        const proceed = confirm(
          `Your story has already reached ${totalWords.toLocaleString()} words (goal: ${goal.toLocaleString()}). ` +
          `Continue writing anyway?`
        );
        if (!proceed) return;
      }
    }

    this._showContinueBar(false);
    if (this._lastGenSettings) this._lastGenSettings.wordTarget = wordTarget;
    await this._runGeneration({ isContinuation: true, wordTarget });
  }

  async _handleWriteToEnd() {
    const project = this._currentProject;
    if (!project) return;

    const btn = document.getElementById('btn-continue-to-end');
    if (!btn) return;

    const originalText = btn.textContent;
    btn.disabled = true;
    this._showContinueBar(false);

    try {
      const MAX_ITERATIONS = 20;
      let iteration = 0;
      let keepGoing = true;

      while (keepGoing && iteration < MAX_ITERATIONS) {
        iteration++;
        btn.textContent = `Writing\u2026 (pass ${iteration})`;

        const beforeWords = this._getTotalWordCount();
        await this._runGeneration({ isContinuation: true, wordTarget: 1000 });
        const afterWords = this._getTotalWordCount();
        const wordsAdded = afterWords - beforeWords;

        // Check chapter word count against per-chapter target
        const goal = project.wordCountGoal || 0;
        const numChapters = project.numChapters || 10;
        const chapterGoal = goal > 0 ? Math.ceil(goal / numChapters) : 4000;
        const currentChapterWords = this.editor?.getWordCount?.() || 0;

        // Stop if chapter has reached its target length
        if (currentChapterWords >= chapterGoal) {
          keepGoing = false;
        }

        // Stop if generation produced very few words (indicates natural completion)
        if (wordsAdded < 100) {
          keepGoing = false;
        }

        // Brief pause between iterations to avoid rate limiting
        if (keepGoing) {
          await new Promise(r => setTimeout(r, 1500));
        }
      }

      if (iteration >= MAX_ITERATIONS) {
        alert(`Reached maximum of ${MAX_ITERATIONS} generation passes. Review the chapter and continue manually if needed.`);
      }

    } catch (err) {
      console.error('Write to End failed:', err);
      alert('Generation stopped: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  _setGenerateStatus(active) {
    const statusEl = document.getElementById('generate-status');
    const cancelBtn = document.getElementById('btn-generate-cancel');
    const generateBtn = document.getElementById('btn-generate-prose');

    if (statusEl) statusEl.style.display = active ? 'block' : 'none';
    if (cancelBtn) cancelBtn.style.display = active ? '' : 'none';
    if (generateBtn) generateBtn.disabled = active;
  }

  _showScoringProgress(show) {
    const overlay = document.getElementById('scoring-progress-overlay');
    if (overlay) {
      if (show) {
        overlay.classList.add('visible');
      } else {
        overlay.classList.remove('visible');
      }
    }
  }

  async openSettingsPanel() {
    await this.openSetupBookModal('settings');
  }

  async openErrorDatabasePanel() {
    const body = document.getElementById('panel-error-database-body');
    if (!body) return;

    body.innerHTML = '<div class="analysis-section"><p>Loading error patterns...</p></div>';
    this._showPanel('error-database');

    await this._renderErrorDatabasePanel();
  }

  async _renderErrorDatabasePanel() {
    const body = document.getElementById('panel-error-database-body');
    if (!body || !this.errorDb) return;

    const stats = await this.errorDb.getStats();
    const allPatterns = await this.errorDb.getPatterns({ minFrequency: 1, limit: 200 });

    const categoryLabels = {
      'pet-phrase': 'PET Phrases',
      'telling': 'Telling vs Showing',
      'cliche': 'Cliches',
      'weak-words': 'Weak/Filler Words',
      'passive': 'Passive Voice',
      'structure': 'Structural Issues',
      'pacing': 'Pacing Problems',
      'ai-pattern': 'AI Writing Patterns',
      'other': 'Other Issues'
    };

    const severityColors = {
      'high': 'var(--danger, #e94560)',
      'medium': 'var(--warning, #f0a500)',
      'low': 'var(--text-secondary, #999)'
    };

    let html = '';

    // Stats summary
    html += `<div class="analysis-section">`;
    html += `<h3>Database Overview</h3>`;
    html += `<p>The error pattern database tracks common prose problems found during AI scoring. These patterns are automatically used as "negative prompts" during prose generation to prevent repeating the same mistakes.</p>`;
    html += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin:12px 0;">`;
    html += `<div style="text-align:center;padding:12px;background:var(--bg-secondary,#1a1a2e);border-radius:8px;"><div style="font-size:24px;font-weight:700;color:var(--accent-primary,#4fc3f7);">${stats.totalPatterns}</div><div style="font-size:11px;color:var(--text-secondary,#999);">Unique Patterns</div></div>`;
    html += `<div style="text-align:center;padding:12px;background:var(--bg-secondary,#1a1a2e);border-radius:8px;"><div style="font-size:24px;font-weight:700;color:var(--accent-primary,#4fc3f7);">${stats.totalOccurrences}</div><div style="font-size:11px;color:var(--text-secondary,#999);">Total Occurrences</div></div>`;
    html += `<div style="text-align:center;padding:12px;background:var(--bg-secondary,#1a1a2e);border-radius:8px;"><div style="font-size:24px;font-weight:700;color:var(--accent-primary,#4fc3f7);">${stats.projectCount}</div><div style="font-size:11px;color:var(--text-secondary,#999);">Projects</div></div>`;
    html += `<div style="text-align:center;padding:12px;background:var(--bg-secondary,#1a1a2e);border-radius:8px;"><div style="font-size:24px;font-weight:700;color:var(--accent-primary,#4fc3f7);">${Object.keys(stats.categories).length}</div><div style="font-size:11px;color:var(--text-secondary,#999);">Categories</div></div>`;
    html += `</div>`;

    if (stats.totalPatterns === 0) {
      html += `<p style="color:var(--text-secondary,#999);margin-top:12px;">No error patterns recorded yet. Patterns are automatically captured during prose scoring. Generate and score some prose to start building your error database.</p>`;
    }
    html += `</div>`;

    // Category breakdown
    if (stats.totalPatterns > 0 && Object.keys(stats.categories).length > 0) {
      html += `<div class="analysis-section">`;
      html += `<h3>Categories</h3>`;
      for (const [cat, count] of Object.entries(stats.categories).sort((a, b) => b[1] - a[1])) {
        const label = categoryLabels[cat] || cat;
        const pct = Math.round((count / stats.totalPatterns) * 100);
        html += `<div style="display:flex;align-items:center;gap:8px;margin:6px 0;">`;
        html += `<span style="flex:1;font-size:13px;">${label}</span>`;
        html += `<span style="font-size:12px;color:var(--text-secondary,#999);">${count} patterns (${pct}%)</span>`;
        html += `<div style="width:100px;height:6px;background:var(--bg-secondary,#1a1a2e);border-radius:3px;overflow:hidden;"><div style="width:${pct}%;height:100%;background:var(--accent-primary,#4fc3f7);border-radius:3px;"></div></div>`;
        html += `</div>`;
      }
      html += `</div>`;
    }

    // Pattern list grouped by category
    if (allPatterns.length > 0) {
      const grouped = {};
      for (const p of allPatterns) {
        const cat = p.category || 'other';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(p);
      }

      html += `<div class="analysis-section">`;
      html += `<h3>All Patterns</h3>`;
      html += `<p style="font-size:12px;color:var(--text-secondary,#999);margin-bottom:8px;">Patterns seen 2+ times are included in negative prompts during generation. Click the dismiss button to exclude a pattern.</p>`;

      for (const [cat, items] of Object.entries(grouped).sort((a, b) => b[1].length - a[1].length)) {
        const label = categoryLabels[cat] || cat;
        html += `<div style="margin:16px 0 8px 0;font-weight:600;font-size:14px;color:var(--text-primary,#eee);">${label} (${items.length})</div>`;

        for (const item of items) {
          const sevColor = severityColors[item.severity] || severityColors.low;
          const freqBadge = item.frequency >= 2
            ? `<span style="background:var(--accent-primary,#4fc3f7);color:#000;padding:1px 6px;border-radius:8px;font-size:10px;font-weight:700;">${item.frequency}x</span>`
            : `<span style="color:var(--text-secondary,#999);font-size:10px;">${item.frequency}x</span>`;
          const activeLabel = item.frequency >= 2
            ? `<span style="color:var(--accent-primary,#4fc3f7);font-size:10px;margin-left:4px;">ACTIVE</span>`
            : '';

          html += `<div style="display:flex;align-items:flex-start;gap:8px;padding:8px;margin:4px 0;background:var(--bg-secondary,#1a1a2e);border-radius:6px;border-left:3px solid ${sevColor};" data-pattern-id="${item.id}">`;
          html += `<div style="flex:1;min-width:0;">`;
          if (item.text) {
            html += `<div style="font-size:12px;color:var(--text-secondary,#999);font-style:italic;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">"${item.text}"</div>`;
          }
          html += `<div style="font-size:13px;color:var(--text-primary,#eee);">${item.problem}</div>`;
          html += `<div style="font-size:11px;color:var(--text-secondary,#999);margin-top:2px;">${freqBadge}${activeLabel} &middot; Impact: ~${item.estimatedImpact} pts &middot; ${item.severity}</div>`;
          html += `</div>`;
          html += `<button class="btn btn-sm error-db-dismiss-btn" data-pattern-id="${item.id}" style="flex-shrink:0;font-size:11px;padding:4px 8px;" title="Dismiss this pattern">&times;</button>`;
          html += `</div>`;
        }
      }
      html += `</div>`;
    }

    // Actions
    html += `<div class="analysis-section" style="display:flex;gap:8px;flex-wrap:wrap;">`;
    if (stats.totalPatterns > 0) {
      html += `<button class="btn btn-sm" id="btn-download-error-db">Download Log (.md)</button>`;
      html += `<button class="btn btn-sm" id="btn-clear-error-db" style="border-color:var(--danger,#e94560);color:var(--danger,#e94560);">Clear All Patterns</button>`;
    }
    if (stats.dismissedPatterns > 0) {
      html += `<button class="btn btn-sm" id="btn-restore-dismissed">Restore ${stats.dismissedPatterns} Dismissed</button>`;
    }
    html += `</div>`;

    body.innerHTML = html;

    // Bind dismiss buttons
    body.querySelectorAll('.error-db-dismiss-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.target.dataset.patternId;
        if (id && this.errorDb) {
          await this.errorDb.dismissPattern(id);
          await this._renderErrorDatabasePanel();
        }
      });
    });

    // Bind clear all button
    document.getElementById('btn-clear-error-db')?.addEventListener('click', async () => {
      if (confirm('Clear all error patterns? This cannot be undone.')) {
        await this.errorDb.clearAll();
        await this._renderErrorDatabasePanel();
      }
    });

    // Bind restore dismissed button
    document.getElementById('btn-restore-dismissed')?.addEventListener('click', async () => {
      const allWithDismissed = await this.errorDb.storage.getAll('errorPatterns');
      for (const p of allWithDismissed) {
        if (p.dismissed) {
          await this.errorDb.restorePattern(p.id);
        }
      }
      await this._renderErrorDatabasePanel();
    });

    // Bind download button
    document.getElementById('btn-download-error-db')?.addEventListener('click', async () => {
      await this._downloadErrorDatabaseLog();
    });
  }

  async _downloadErrorDatabaseLog() {
    if (!this.errorDb) return;

    const allPatterns = await this.errorDb.getPatterns({ minFrequency: 1, limit: 500 });
    const stats = await this.errorDb.getStats();

    const categoryLabels = {
      'pet-phrase': 'PET Phrases',
      'telling': 'Telling vs Showing',
      'cliche': 'Cliches',
      'weak-words': 'Weak/Filler Words',
      'passive': 'Passive Voice',
      'structure': 'Structural Issues',
      'pacing': 'Pacing Problems',
      'ai-pattern': 'AI Writing Patterns',
      'other': 'Other Issues'
    };

    let md = `# Error Pattern Database\n\n`;
    md += `**Exported:** ${new Date().toLocaleString()}\n\n`;
    md += `## Overview\n\n`;
    md += `| Metric | Value |\n|--------|-------|\n`;
    md += `| Unique Patterns | ${stats.totalPatterns} |\n`;
    md += `| Total Occurrences | ${stats.totalOccurrences} |\n`;
    md += `| Projects | ${stats.projectCount} |\n`;
    md += `| Categories | ${Object.keys(stats.categories).length} |\n`;
    md += `| Dismissed | ${stats.dismissedPatterns} |\n\n`;

    // Category breakdown
    if (Object.keys(stats.categories).length > 0) {
      md += `## Categories\n\n`;
      md += `| Category | Count | % |\n|----------|-------|---|\n`;
      for (const [cat, count] of Object.entries(stats.categories).sort((a, b) => b[1] - a[1])) {
        const label = categoryLabels[cat] || cat;
        const pct = Math.round((count / stats.totalPatterns) * 100);
        md += `| ${label} | ${count} | ${pct}% |\n`;
      }
      md += `\n`;
    }

    // Group patterns by category
    const grouped = {};
    for (const p of allPatterns) {
      const cat = p.category || 'other';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(p);
    }

    // All patterns
    if (allPatterns.length > 0) {
      md += `## All Patterns\n\n`;
      for (const [cat, items] of Object.entries(grouped).sort((a, b) => b[1].length - a[1].length)) {
        const label = categoryLabels[cat] || cat;
        md += `### ${label} (${items.length})\n\n`;

        for (const item of items) {
          const active = item.frequency >= 2 ? ' **ACTIVE**' : '';
          md += `- **${item.frequency}x**${active} | ${item.severity} | ~${item.estimatedImpact} pts\n`;
          if (item.text) {
            md += `  - Text: _"${item.text}"_\n`;
          }
          md += `  - ${item.problem}\n`;
        }
        md += `\n`;
      }
    }

    // Download
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const projectName = this._currentProject?.title || 'genesis';
    a.download = `error_patterns_${projectName.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 40)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  _initApiKeyPinLock() {
    const hasPin = !!localStorage.getItem('genesis-api-pin');
    const lockedDiv = document.getElementById('api-key-locked');
    const unlockedDiv = document.getElementById('api-key-unlocked');
    if (!lockedDiv || !unlockedDiv) return;

    if (hasPin) {
      lockedDiv.style.display = 'block';
      unlockedDiv.style.display = 'none';
    } else {
      lockedDiv.style.display = 'none';
      unlockedDiv.style.display = 'block';
    }
  }

  _showPanel(panelId) {
    // Auto-save API key and HF token if leaving settings panel
    const settingsPanel = document.getElementById('panel-settings');
    if (settingsPanel?.classList.contains('visible') && panelId !== 'settings') {
      this._autoSaveSettingsKeys();
    }
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('visible'));
    document.getElementById('panel-overlay').classList.remove('visible');

    const panel = document.getElementById('panel-' + panelId);
    if (panel) {
      panel.classList.add('visible');
      document.getElementById('panel-overlay').classList.add('visible');
    }
  }

  _closeAllPanels() {
    this._autoSaveSettingsKeys();
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('visible'));
    document.getElementById('panel-overlay')?.classList.remove('visible');
    this._closeSetupBookModal();
  }

  async _autoSaveSettingsKeys() {
    // Auto-save API key if present in the unlocked field
    const apiKeyEl = document.getElementById('setting-api-key');
    if (apiKeyEl) {
      const key = (apiKeyEl.value || '').trim();
      if (key && key !== (this.generator?.apiKey || '')) {
        await this.generator.setApiKey(key);
      }
    }
    // Auto-save AI model
    const modelEl = document.getElementById('setting-ai-model');
    if (modelEl) {
      const model = modelEl.value || 'claude-sonnet-4-5-20250929';
      if (model !== (this.generator?.model || '')) {
        await this.generator.setModel(model);
      }
    }
    // Auto-save HF token
    const hfEl = document.getElementById('setting-hf-token');
    if (hfEl) {
      const token = (hfEl.value || '').trim();
      if (token !== (this._hfToken || '')) {
        this._hfToken = token;
        await this.localStorage.setSetting('hfToken', token);
      }
    }
  }

  // ========================================
  //  Analysis Rendering
  // ========================================

  _renderAnalysis(analysis, score) {
    const sv = analysis.sentenceVariety;
    const bars = sv.lengths.slice(0, 80).map(len => {
      const height = Math.min(100, (len / 40) * 100);
      let cls = 'medium';
      if (len <= 8) cls = 'short';
      else if (len <= 18) cls = 'medium';
      else if (len <= 30) cls = 'long';
      else cls = 'very-long';
      return `<div class="sentence-bar ${cls}" style="height:${height}%" title="${len} words"></div>`;
    }).join('');

    return `
      <div class="analysis-section">
        <h3>Prose Score</h3>
        <div class="stat-card" style="text-align:center;padding:20px;">
          <div class="stat-value" style="font-size:2.5rem;">${score}</div>
          <div class="stat-label">${score >= 80 ? 'Excellent' : score >= 65 ? 'Good' : score >= 50 ? 'Needs Work' : 'Rough Draft'}</div>
          <div class="meter" style="margin-top:12px;">
            <div class="meter-fill ${score >= 70 ? 'good' : score >= 50 ? 'warning' : 'danger'}" style="width:${score}%"></div>
          </div>
        </div>
      </div>

      <div class="analysis-section">
        <h3>Counts</h3>
        <div class="stat-grid">
          <div class="stat-card">
            <div class="stat-value">${analysis.counts.words.toLocaleString()}</div>
            <div class="stat-label">Words</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${analysis.counts.sentences.toLocaleString()}</div>
            <div class="stat-label">Sentences</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${analysis.counts.paragraphs}</div>
            <div class="stat-label">Paragraphs</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${analysis.counts.pages}</div>
            <div class="stat-label">Pages</div>
          </div>
        </div>
      </div>

      <div class="analysis-section">
        <h3>Readability</h3>
        <div class="stat-grid">
          <div class="stat-card">
            <div class="stat-value">${analysis.readability.fleschKincaid}</div>
            <div class="stat-label">Flesch Score</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${analysis.readability.gradeLevel}</div>
            <div class="stat-label">Grade Level</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${analysis.readability.avgWordsPerSentence}</div>
            <div class="stat-label">Avg Words/Sent</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${analysis.readability.avgSyllablesPerWord}</div>
            <div class="stat-label">Avg Syllables</div>
          </div>
        </div>
        <p style="font-size:0.8rem;color:var(--text-muted);margin-top:8px;">
          Best sellers typically score 60-80 on Flesch (grade 5-9). Your prose reads at grade ${analysis.readability.gradeLevel}.
        </p>
      </div>

      <div class="analysis-section">
        <h3>Sentence Variety</h3>
        <div class="sentence-bars">${bars}</div>
        <div class="stat-grid" style="margin-top:8px;">
          <div class="stat-card">
            <div class="stat-value">${sv.categories.short}</div>
            <div class="stat-label">Short (&le;8)</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${sv.categories.medium}</div>
            <div class="stat-label">Medium (9-18)</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${sv.categories.long}</div>
            <div class="stat-label">Long (19-30)</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${sv.categories.veryLong}</div>
            <div class="stat-label">Very Long (30+)</div>
          </div>
        </div>
        <div class="meter" style="margin-top:8px;">
          <div class="meter-fill ${sv.varietyScore >= 60 ? 'good' : sv.varietyScore >= 35 ? 'warning' : 'danger'}" style="width:${sv.varietyScore}%"></div>
        </div>
        <p style="font-size:0.8rem;color:var(--text-muted);">Variety score: ${sv.varietyScore}/100. Mix short punchy sentences with longer flowing ones.</p>
      </div>

      <div class="analysis-section">
        <h3>Passive Voice (${analysis.passiveVoice.percentage}%)</h3>
        <div class="meter">
          <div class="meter-fill ${analysis.passiveVoice.percentage <= 15 ? 'good' : analysis.passiveVoice.percentage <= 25 ? 'warning' : 'danger'}" style="width:${Math.min(100, analysis.passiveVoice.percentage * 2)}%"></div>
        </div>
        ${analysis.passiveVoice.instances.length > 0 ? `
          <div style="margin-top:8px;">
            ${analysis.passiveVoice.instances.slice(0, 5).map(p =>
              `<div class="word-tag" style="display:block;margin:4px 0;border-radius:var(--radius-sm);">
                <strong>${this._esc(p.phrase)}</strong> &mdash; <span style="color:var(--text-muted)">${this._esc(p.sentence)}...</span>
              </div>`
            ).join('')}
          </div>` : '<p style="font-size:0.8rem;color:var(--success);">No passive voice detected.</p>'}
      </div>

      ${analysis.wordChoice.weakWords.length > 0 ? `
      <div class="analysis-section">
        <h3>Weak / Filler Words</h3>
        <div class="word-list">
          ${analysis.wordChoice.weakWords.map(w =>
            `<span class="word-tag">${w.word} <span class="count">${w.count}</span></span>`
          ).join('')}
        </div>
        <p style="font-size:0.8rem;color:var(--text-muted);margin-top:8px;">Consider replacing with stronger, more specific words.</p>
      </div>` : ''}

      ${analysis.wordChoice.filterWords.length > 0 ? `
      <div class="analysis-section">
        <h3>Filter Words (Show Don't Tell)</h3>
        <div class="word-list">
          ${analysis.wordChoice.filterWords.map(w =>
            `<span class="word-tag">${w.word} <span class="count">${w.count}</span></span>`
          ).join('')}
        </div>
        <p style="font-size:0.8rem;color:var(--text-muted);margin-top:8px;">
          Filter words like "felt," "saw," and "noticed" create distance. Show the experience directly.
        </p>
      </div>` : ''}

      ${analysis.adverbs.list.length > 0 ? `
      <div class="analysis-section">
        <h3>Adverbs (${analysis.adverbs.percentage}%)</h3>
        <div class="word-list">
          ${analysis.adverbs.list.slice(0, 10).map(a =>
            `<span class="word-tag">${a.word} <span class="count">${a.count}</span></span>`
          ).join('')}
        </div>
      </div>` : ''}

      ${analysis.cliches.length > 0 ? `
      <div class="analysis-section">
        <h3>Cliches Found</h3>
        <div style="margin-top:4px;">
          ${analysis.cliches.map(c =>
            `<div class="word-tag" style="display:block;margin:4px 0;border-radius:var(--radius-sm);color:var(--danger);">
              "${c.phrase}" <span class="count">&times;${c.count}</span>
            </div>`
          ).join('')}
        </div>
      </div>` : ''}

      ${analysis.repetition.length > 0 ? `
      <div class="analysis-section">
        <h3>Overused Words</h3>
        <div class="word-list">
          ${analysis.repetition.slice(0, 10).map(r =>
            `<span class="word-tag">${r.word} <span class="count">${r.count} (${r.frequency}%)</span></span>`
          ).join('')}
        </div>
      </div>` : ''}

      <div class="analysis-section">
        <h3>Dialogue Ratio</h3>
        <div class="stat-grid">
          <div class="stat-card">
            <div class="stat-value">${Math.round(analysis.dialogue.ratio * 100)}%</div>
            <div class="stat-label">Dialogue</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${Math.round((1 - analysis.dialogue.ratio) * 100)}%</div>
            <div class="stat-label">Narrative</div>
          </div>
        </div>
        <p style="font-size:0.8rem;color:var(--text-muted);margin-top:8px;">
          Best-selling fiction typically balances 20-50% dialogue with narrative.
        </p>
      </div>

      <div class="analysis-section">
        <h3>Lexical Diversity</h3>
        <div class="meter">
          <div class="meter-fill ${analysis.wordChoice.uniqueWordRatio >= 0.5 ? 'good' : 'warning'}" style="width:${analysis.wordChoice.uniqueWordRatio * 100}%"></div>
        </div>
        <p style="font-size:0.8rem;color:var(--text-muted);">
          ${Math.round(analysis.wordChoice.uniqueWordRatio * 100)}% unique words. Higher diversity suggests richer vocabulary.
        </p>
      </div>
    `;
  }

  // ========================================
  //  Structure Rendering
  // ========================================

  _renderStructure(guidance, beats, project, templateId) {
    const templates = this.structure.getTemplates();

    return `
      <div class="analysis-section">
        <h3>Structure Template</h3>
        <select class="form-input" id="structure-template-select" style="margin-bottom:12px;">
          ${templates.map(t =>
            `<option value="${t.id}" ${t.id === templateId ? 'selected' : ''}>${t.name} (${t.beatCount} beats)</option>`
          ).join('')}
        </select>
      </div>

      <div class="analysis-section">
        <h3>Progress</h3>
        <div class="stat-grid">
          <div class="stat-card">
            <div class="stat-value">${guidance.progress}%</div>
            <div class="stat-label">Complete</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${guidance.wordsRemaining.toLocaleString()}</div>
            <div class="stat-label">Words Remaining</div>
          </div>
        </div>
        <div class="meter" style="margin-top:12px;">
          <div class="meter-fill info" style="width:${guidance.progress}%"></div>
        </div>
      </div>

      <div class="analysis-section">
        <h3>Current Beat</h3>
        <div class="stat-card" style="text-align:left;">
          <div style="font-weight:600;color:var(--accent-primary);">${guidance.currentBeat.name}</div>
          <div style="font-size:0.85rem;color:var(--text-secondary);margin-top:4px;">${guidance.currentBeat.description}</div>
        </div>
        ${guidance.nextBeat ? `
        <div style="margin-top:12px;font-size:0.85rem;color:var(--text-muted);">
          Next: <strong>${guidance.nextBeat.name}</strong> in ~${guidance.wordsToNextBeat.toLocaleString()} words
        </div>` : ''}
      </div>

      <div class="analysis-section">
        <h3>Beat Sheet</h3>
        <div class="beat-sheet">
          ${beats.map(beat => `
            <div class="beat-item ${beat.isReached ? 'completed' : ''}">
              <div class="beat-title">${beat.name}</div>
              <div class="beat-desc">${beat.description}</div>
              <div class="beat-percent">${beat.percent}% &bull; ~${beat.targetWordPosition.toLocaleString()} words &bull; p.${beat.approximatePage}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  _renderStructureInSettings(guidance, beats, project, templateId) {
    const templates = this.structure.getTemplates();

    return `
      <select class="form-input" id="structure-template-select" style="margin-bottom:12px;">
        ${templates.map(t =>
          `<option value="${t.id}" ${t.id === templateId ? 'selected' : ''}>${t.name} (${t.beatCount} beats)</option>`
        ).join('')}
      </select>

      <div class="stat-grid" style="margin-bottom:12px;">
        <div class="stat-card">
          <div class="stat-value">${guidance.progress}%</div>
          <div class="stat-label">Complete</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${guidance.wordsRemaining.toLocaleString()}</div>
          <div class="stat-label">Words Remaining</div>
        </div>
      </div>
      <div class="meter" style="margin-bottom:12px;">
        <div class="meter-fill info" style="width:${guidance.progress}%"></div>
      </div>

      <div class="stat-card" style="text-align:left;margin-bottom:12px;">
        <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:4px;">Current Beat</div>
        <div style="font-weight:600;color:var(--accent-primary);">${guidance.currentBeat.name}</div>
        <div style="font-size:0.85rem;color:var(--text-secondary);margin-top:4px;">${guidance.currentBeat.description}</div>
        ${guidance.nextBeat ? `
        <div style="margin-top:8px;font-size:0.85rem;color:var(--text-muted);">
          Next: <strong>${guidance.nextBeat.name}</strong> in ~${guidance.wordsToNextBeat.toLocaleString()} words
        </div>` : ''}
      </div>

      <details style="margin-top:8px;">
        <summary style="cursor:pointer;font-size:0.85rem;color:var(--accent-primary);font-weight:600;">View Full Beat Sheet</summary>
        <div class="beat-sheet" style="margin-top:8px;">
          ${beats.map(beat => `
            <div class="beat-item ${beat.isReached ? 'completed' : ''}">
              <div class="beat-title">${beat.name}</div>
              <div class="beat-desc">${beat.description}</div>
              <div class="beat-percent">${beat.percent}% &bull; ~${beat.targetWordPosition.toLocaleString()} words &bull; p.${beat.approximatePage}</div>
            </div>
          `).join('')}
        </div>
      </details>
    `;
  }

  // ========================================
  //  Cover Image
  // ========================================

  _updateCoverDisplay() {
    const project = this._currentProject;
    const placeholder = document.getElementById('cover-placeholder');
    const img = document.getElementById('cover-image');
    const regenBtn = document.getElementById('btn-regenerate-cover');
    const editBtn = document.getElementById('btn-edit-cover');
    if (!placeholder || !img || !regenBtn) return;

    if (project?.coverImage) {
      placeholder.style.display = 'none';
      img.style.display = 'block';
      img.src = project.coverImage;
      regenBtn.style.cssText = 'display:block; width:100%; margin-top:6px;';
    } else {
      placeholder.style.display = '';
      img.style.display = 'none';
      img.src = '';
      regenBtn.style.cssText = 'display:none; width:100%; margin-top:6px;';
    }
    // Always show the edit button when a project is loaded (editor can generate images)
    if (editBtn && project) editBtn.style.cssText = 'display:block; width:100%; margin-top:6px;';
  }

  async _generateCover(regenerate = false) {
    const project = this._currentProject;
    if (!project) return;

    if (!this.generator.hasApiKey()) {
      alert('Set your Anthropic API key in Settings first.');
      return;
    }

    // Show loading state
    const loading = document.getElementById('cover-loading');
    const placeholder = document.getElementById('cover-placeholder');
    if (loading) loading.style.display = '';
    if (placeholder) placeholder.style.display = 'none';

    try {
      // Gather prose excerpt from chapters
      const chapters = await this.fs.getProjectChapters(project.id);
      let proseExcerpt = '';
      for (const ch of chapters) {
        if (ch.content) {
          const text = ch.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          proseExcerpt += text + ' ';
          if (proseExcerpt.length > 3000) break;
        }
      }

      // Gather characters
      const characters = await this.localStorage.getProjectCharacters(this.state.currentProjectId) || [];

      // Step 1: Claude generates the image prompt
      const coverPrompt = await this.generator.generateCoverPrompt({
        title: project.title,
        genre: project.genre || '',
        proseExcerpt: proseExcerpt.trim(),
        characters
      });

      if (!coverPrompt) throw new Error('Failed to generate cover prompt.');

      let coverImage = null;

      // Step 2a: Try HuggingFace via Puter.js CORS-free fetch (best approach)
      if (!coverImage && this._hfToken) {
        try {
          if (loading) loading.textContent = 'Generating AI cover...';
          coverImage = await this.generator.generateCoverViaHF(coverPrompt, this._hfToken);
        } catch (err) {
          console.warn('HF via puter.net.fetch failed:', err.message);
        }
      }

      // Step 2b: Try Puter.js built-in image generation
      if (!coverImage) {
        try {
          if (loading) loading.textContent = 'Generating cover image...';
          coverImage = await this.generator.generateCoverWithPuter(coverPrompt);
        } catch (err) {
          console.warn('Puter cover generation failed:', err.message);
        }
      }

      // Step 2c: Try Hugging Face via CORS proxy (corsproxy.io)
      if (!coverImage && this._hfToken) {
        try {
          if (loading) loading.textContent = 'Generating cover image...';
          coverImage = await this.generator.generateCoverImage(coverPrompt, this._hfToken);
        } catch (err) {
          console.warn('HF via CORS proxy failed:', err.message);
        }
      }

      // Save base image (without text) for the cover editor
      let coverImageBase = coverImage || null;

      // Overlay title (and subtitle if set) on AI-generated cover
      if (coverImage) {
        coverImage = await this.generator.overlayTitle(coverImage, project.title, project.subtitle || '');
      }

      // Step 2d: Canvas fallback (always works, has its own title rendering)
      if (!coverImage) {
        console.warn('AI image sources failed, using canvas fallback');
        const design = this.generator.getDefaultCoverDesign(project.genre);
        // Render fallback without text for base image
        coverImageBase = this.generator.renderCover(design, '', '');
        coverImage = this.generator.renderCover(design, project.title, project.owner);
      }

      // Save to Firestore (include base image for cover editor)
      await this.fs.updateProject(project.id, { coverImage, coverImageBase, coverPrompt });
      this._currentProject.coverImage = coverImage;
      this._currentProject.coverImageBase = coverImageBase;
      this._currentProject.coverPrompt = coverPrompt;

      // Update display
      this._updateCoverDisplay();
    } catch (err) {
      console.error('Cover generation failed:', err);
      alert('Cover generation failed: ' + err.message);
      if (placeholder) placeholder.style.display = '';
    } finally {
      if (loading) {
        loading.style.display = 'none';
        loading.textContent = 'Generating...';
      }
    }
  }

  _downloadCover() {
    const project = this._currentProject;
    if (!project?.coverImage) return;

    if (project.coverImage.startsWith('data:')) {
      // Base64 data URL — direct download
      const a = document.createElement('a');
      a.href = project.coverImage;
      a.download = `${project.title || 'cover'} - cover.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      // External URL — open in new tab
      window.open(project.coverImage, '_blank');
    }
  }

  // ========================================
  //  Settings Rendering
  // ========================================

  _renderSettings(project) {
    return `
      <div class="analysis-section">
        <h3>Appearance</h3>
        <div class="form-group">
          <label>Theme</label>
          <select class="form-input" id="setting-theme">
            <option value="dark" ${this.state.theme === 'dark' ? 'selected' : ''}>Dark</option>
            <option value="light" ${this.state.theme === 'light' ? 'selected' : ''}>Light</option>
            <option value="sepia" ${this.state.theme === 'sepia' ? 'selected' : ''}>Sepia</option>
          </select>
        </div>
      </div>

      <div class="analysis-section">
        <h3>AI Prose Generation</h3>
        <div class="form-group">
          <label>Anthropic API Key</label>
          <div id="api-key-locked" style="display:none;">
            <div style="display:flex;gap:8px;align-items:center;">
              <input type="password" class="form-input" id="api-key-pin-input" placeholder="Enter PIN to unlock" style="flex:1;">
              <button class="btn btn-sm" id="api-key-unlock-btn">Unlock</button>
            </div>
            <p style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">API key is PIN-protected.</p>
          </div>
          <div id="api-key-unlocked">
            <input type="password" class="form-input" id="setting-api-key" value="${this._esc(this.generator?.apiKey || '')}" placeholder="sk-ant-...">
            <p style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">
              Get your key at <a href="https://console.anthropic.com/settings/keys" target="_blank" style="color:var(--accent-primary);">console.anthropic.com</a>. Stored locally on this device only.
            </p>
            <div style="margin-top:8px;display:flex;gap:8px;align-items:center;">
              <input type="password" class="form-input" id="api-key-set-pin" placeholder="${localStorage.getItem('genesis-api-pin') ? 'New PIN (leave blank to keep)' : 'Set a PIN to lock (optional)'}" style="flex:1;">
              <button class="btn btn-sm" id="api-key-lock-btn">${localStorage.getItem('genesis-api-pin') ? 'Update PIN' : 'Set PIN'}</button>
              ${localStorage.getItem('genesis-api-pin') ? '<button class="btn btn-sm" id="api-key-remove-pin">Remove PIN</button>' : ''}
            </div>
          </div>
        </div>
        <div class="form-group">
          <label>AI Model</label>
          <select class="form-input" id="setting-ai-model">
            <option value="claude-sonnet-4-5-20250929" ${this.generator?.model === 'claude-sonnet-4-5-20250929' ? 'selected' : ''}>Claude Sonnet 4.5 (recommended)</option>
            <option value="claude-haiku-4-5-20251001" ${this.generator?.model === 'claude-haiku-4-5-20251001' ? 'selected' : ''}>Claude Haiku 4.5 (faster, cheaper)</option>
            <option value="claude-opus-4-6" ${this.generator?.model === 'claude-opus-4-6' ? 'selected' : ''}>Claude Opus 4.6 (highest quality)</option>
          </select>
        </div>
        <button class="btn btn-sm" id="save-api-settings" style="width:100%;">Save AI Settings</button>
      </div>

      <div class="analysis-section">
        <h3>Cover Image Generation</h3>
        <div class="form-group">
          <label>Hugging Face API Token</label>
          <input type="password" class="form-input" id="setting-hf-token" value="${this._esc(this._hfToken || '')}" placeholder="hf_...">
          <p style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">
            Free token from <a href="https://huggingface.co/settings/tokens" target="_blank" style="color:var(--accent-primary);">huggingface.co</a>. Used for AI cover art.
          </p>
        </div>
        <button class="btn btn-sm" id="save-hf-settings" style="width:100%;">Save Cover Settings</button>
      </div>

      ${project ? `
      <div class="analysis-section">
        <h3>Data</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-sm" id="btn-export-json">Backup (JSON)</button>
        </div>
      </div>

      <div class="analysis-section">
        <h3>Danger Zone</h3>
        <button class="btn btn-sm" id="btn-delete-project" style="border-color:var(--danger);color:var(--danger);">Delete Project</button>
      </div>
      ` : ''}
    `;
  }

  // ========================================
  //  Setup Book Central Modal
  // ========================================

  async openSetupBookModal(tab = 'book') {
    const project = this._currentProject;
    if (!project) return;

    // Populate Book Setup tab fields
    const titleEl = document.getElementById('bs-title');
    const subtitleEl = document.getElementById('bs-subtitle');
    const totalWordsEl = document.getElementById('bs-total-words');
    const numChaptersEl = document.getElementById('bs-num-chapters');

    if (titleEl) titleEl.value = project.title || '';
    if (subtitleEl) subtitleEl.value = project.subtitle || '';
    if (totalWordsEl) totalWordsEl.value = project.wordCountGoal || 80000;

    // Populate Genre & Voice fields
    this._populateGenreDropdowns(project);
    const voiceEl = document.getElementById('bs-voice');
    if (voiceEl) voiceEl.value = project.voice || 'auto';

    // Populate Story Structure
    await this._populateStructureInModal(project);

    // Populate AI Writer tab fields
    const thresholdEl = document.getElementById('bs-quality-threshold');
    if (thresholdEl) thresholdEl.value = project.qualityThreshold || 90;

    const poetryLevelEl = document.getElementById('bs-poetry-level');
    if (poetryLevelEl) poetryLevelEl.value = project.poetryLevel || 3;

    const authorPaletteEl = document.getElementById('bs-author-palette');
    if (authorPaletteEl) authorPaletteEl.value = project.authorPalette || '';

    // Populate AI Instructions
    const aiInstructionsEl = document.getElementById('generate-ai-instructions');
    if (aiInstructionsEl) aiInstructionsEl.value = project.aiInstructions || '';

    // Populate chapter outline in plot field if available
    const plotEl = document.getElementById('generate-plot');
    if (this._currentChapterOutline && plotEl && !plotEl.value?.trim()) {
      plotEl.value = this._currentChapterOutline;
    }

    // Check API key for generate tab
    const noKeyEl = document.getElementById('generate-no-key');
    const generateBtn = document.getElementById('btn-generate-prose');
    if (noKeyEl && generateBtn) {
      if (!this.generator.hasApiKey()) {
        noKeyEl.style.display = 'block';
        generateBtn.style.display = 'none';
      } else {
        noKeyEl.style.display = 'none';
        generateBtn.style.display = '';
      }
    }
    const errEl = document.getElementById('generate-error');
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
    this._setGenerateStatus(false);

    // Calculate num chapters from existing or default
    const chapters = await this.fs.getProjectChapters(this.state.currentProjectId);
    const numCh = project.numChapters || chapters.length || 20;
    if (numChaptersEl) numChaptersEl.value = numCh;

    // Populate translation checkboxes
    const translationLanguages = project.translationLanguages || (Array.isArray(project.translations) ? project.translations : []);
    const translationLangs = ['spanish', 'french', 'italian', 'german', 'portuguese', 'japanese'];
    for (const lang of translationLangs) {
      const cb = document.getElementById(`bs-translate-${lang}`);
      if (cb) cb.checked = translationLanguages.includes(lang);
    }
    this._updateTranslateButton();

    // Populate front/back matter checkboxes
    const frontMatter = project.frontMatter || [];
    const backMatter = project.backMatter || [];
    const fmTypes = ['title-page', 'copyright', 'dedication', 'epigraph', 'table-of-contents', 'prologue'];
    const bmTypes = ['epilogue', 'acknowledgments', 'about-author', 'also-by', 'glossary', 'appendix'];
    for (const fm of fmTypes) {
      const cb = document.getElementById(`bs-fm-${fm}`);
      if (cb) cb.checked = frontMatter.includes(fm);
    }
    for (const bm of bmTypes) {
      const cb = document.getElementById(`bs-bm-${bm}`);
      if (cb) cb.checked = backMatter.includes(bm);
    }

    this._updateWordsPerChapter();
    this._populateExportButtons();

    // Populate Settings tab
    const settingsBody = document.getElementById('panel-settings-body');
    if (settingsBody) {
      settingsBody.innerHTML = this._renderSettings(project);
      this._initApiKeyPinLock();
    }

    // Populate Export tab cover section
    const coverSection = document.getElementById('export-cover-section');
    const coverPreview = document.getElementById('export-cover-preview');
    if (coverSection && coverPreview) {
      if (project.coverImage) {
        coverSection.style.display = '';
        coverPreview.style.display = '';
        coverPreview.src = project.coverImage;
      } else {
        coverSection.style.display = 'none';
      }
    }

    // Switch to requested tab and show modal
    this._switchSetupTab(tab);
    this._showSetupBookModal();
  }

  _showSetupBookModal() {
    const overlay = document.getElementById('setup-book-overlay');
    if (overlay) overlay.classList.add('visible');
  }

  _closeSetupBookModal() {
    const overlay = document.getElementById('setup-book-overlay');
    if (overlay) overlay.classList.remove('visible');
    // Auto-save settings keys when closing
    this._autoSaveSettingsKeys();
  }

  _switchSetupTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.setup-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.setupTab === tabName);
    });
    // Update tab content panels
    document.querySelectorAll('.setup-tab-content').forEach(panel => {
      panel.classList.toggle('active', panel.id === `setup-tab-${tabName}`);
    });
  }

  _populateGenreDropdowns(project) {
    const genreEl = document.getElementById('bs-genre');
    if (!genreEl) return;

    // Populate genre options
    let genreHtml = '<option value="">-- Select Genre --</option>';
    for (const g of (window.GENRE_DATA || [])) {
      genreHtml += `<option value="${g.id}" ${project.genre === g.id ? 'selected' : ''}>${g.label}</option>`;
    }
    genreEl.innerHTML = genreHtml;

    // Populate subgenre if genre is set
    const subgenreGroup = document.getElementById('bs-subgenre-group');
    const subgenreEl = document.getElementById('bs-subgenre');
    if (project.genre && subgenreEl) {
      subgenreGroup.style.display = '';
      let subHtml = '<option value="">-- None (use main genre rules) --</option>';
      subHtml += this._getSubgenreOptions(project.genre, project.subgenre);
      subgenreEl.innerHTML = subHtml;
    } else if (subgenreGroup) {
      subgenreGroup.style.display = 'none';
    }
  }

  async _populateStructureInModal(project) {
    const container = document.getElementById('bs-structure-container');
    if (!container) return;

    const totalWords = Object.values(this._chapterWordCounts).reduce((sum, wc) => sum + wc, 0);
    const templateId = await this.localStorage.getSetting('structureTemplate_' + this.state.currentProjectId, 'threeAct');
    const targetWords = project.wordCountGoal || 80000;
    const guidance = this.structure.getPacingGuidance(templateId, targetWords, totalWords);
    const beats = this.structure.mapBeatsToManuscript(templateId, targetWords, totalWords);
    container.innerHTML = this._renderStructureInSettings(guidance, beats, project, templateId);
  }

  // Legacy aliases for backward compatibility
  async openBookStructurePanel() {
    await this.openSetupBookModal('book');
  }

  _updateWordsPerChapter() {
    const totalWords = parseInt(document.getElementById('bs-total-words')?.value) || 80000;
    const numChapters = parseInt(document.getElementById('bs-num-chapters')?.value) || 20;
    const wpc = Math.round(totalWords / numChapters);
    const el = document.getElementById('bs-words-per-chapter');
    if (el) el.textContent = wpc.toLocaleString();
  }

  async _saveBookStructure() {
    if (!this.state.currentProjectId) return;

    const title = document.getElementById('bs-title')?.value?.trim();
    const subtitle = document.getElementById('bs-subtitle')?.value?.trim() || '';
    const wordCountGoal = parseInt(document.getElementById('bs-total-words')?.value) || 80000;
    const numChapters = parseInt(document.getElementById('bs-num-chapters')?.value) || 20;
    const qualityThreshold = Math.max(50, Math.min(100, parseInt(document.getElementById('bs-quality-threshold')?.value) || 90));
    const poetryLevel = parseInt(document.getElementById('bs-poetry-level')?.value) || 3;
    const authorPalette = document.getElementById('bs-author-palette')?.value?.trim() || '';

    // Gather genre, subgenre, and voice from Book Setup tab
    const genre = document.getElementById('bs-genre')?.value || '';
    const subgenre = document.getElementById('bs-subgenre')?.value || '';
    const voice = document.getElementById('bs-voice')?.value || 'auto';

    // Gather translation languages (stored separately from translation results)
    const translationLangs = ['spanish', 'french', 'italian', 'german', 'portuguese', 'japanese'];
    const translationLanguages = translationLangs.filter(lang =>
      document.getElementById(`bs-translate-${lang}`)?.checked
    );

    // Gather front/back matter selections
    const fmTypes = ['title-page', 'copyright', 'dedication', 'epigraph', 'table-of-contents', 'prologue'];
    const bmTypes = ['epilogue', 'acknowledgments', 'about-author', 'also-by', 'glossary', 'appendix'];
    const frontMatter = fmTypes.filter(fm => document.getElementById(`bs-fm-${fm}`)?.checked);
    const backMatter = bmTypes.filter(bm => document.getElementById(`bs-bm-${bm}`)?.checked);

    try {
      await this.fs.updateProject(this.state.currentProjectId, {
        title, subtitle, wordCountGoal, numChapters, qualityThreshold, poetryLevel, authorPalette,
        genre, subgenre, voice, translationLanguages, frontMatter, backMatter
      });

      this._currentProject = { ...this._currentProject, title, subtitle, wordCountGoal, numChapters, qualityThreshold, poetryLevel, authorPalette, genre, subgenre, voice, translationLanguages, frontMatter, backMatter };
      document.getElementById('project-title').textContent = title;
      this._updateStatusBarLocal();
      await this.renderChapterNav();
      alert('Book structure saved.');
    } catch (err) {
      console.error('Failed to save book structure:', err);
      alert('Failed to save book structure.');
    }
  }

  _updateTranslateButton() {
    const langs = ['spanish', 'french', 'italian', 'german', 'portuguese', 'japanese'];
    const selected = langs.filter(lang => document.getElementById(`bs-translate-${lang}`)?.checked);
    const btn = document.getElementById('btn-perform-translation');
    if (btn) {
      btn.disabled = selected.length === 0;
      btn.textContent = selected.length === 1
        ? `Perform Translation (1 language)`
        : 'Perform Translation';
    }
  }


  async _generateOutlines() {
    if (!this.state.currentProjectId || !this._currentProject) return;

    const project = this._currentProject;
    if (!this.generator.hasApiKey()) {
      alert('Set your Anthropic API key in Settings first.');
      return;
    }

    const numChapters = parseInt(document.getElementById('bs-num-chapters')?.value) || project.numChapters || 20;
    const totalWords = parseInt(document.getElementById('bs-total-words')?.value) || project.wordCountGoal || 80000;
    const title = document.getElementById('bs-title')?.value?.trim() || project.title;
    const subtitle = document.getElementById('bs-subtitle')?.value?.trim() || project.subtitle || '';

    // Gather characters
    const characters = await this.localStorage.getProjectCharacters(this.state.currentProjectId) || [];

    // Gather notes
    const projectNotes = await this.localStorage.getProjectNotes(this.state.currentProjectId) || [];
    let notes = '';
    if (projectNotes.length > 0) {
      notes = projectNotes.map(n => {
        let entry = n.title;
        if (n.type && n.type !== 'general') entry = `[${n.type}] ${entry}`;
        if (n.content) entry += '\n' + n.content;
        return entry;
      }).join('\n\n');
    }

    // Append project knowledge base as reference materials
    const knowledgePromptOutline = await this._getProjectKnowledge();
    if (knowledgePromptOutline) {
      notes = notes ? notes + '\n\n' + knowledgePromptOutline : knowledgePromptOutline;
    }

    const aiInstructions = project.aiInstructions || '';
    const genreInfo = this._getGenreRules(project.genre, project.subgenre);
    const genre = genreInfo ? genreInfo.label : (project.genre || '');

    // Show loading state
    const statusEl = document.getElementById('bs-outline-status');
    const errorEl = document.getElementById('bs-outline-error');
    const genBtn = document.getElementById('btn-generate-outlines');
    if (statusEl) statusEl.style.display = '';
    if (errorEl) { errorEl.style.display = 'none'; errorEl.textContent = ''; }
    if (genBtn) genBtn.disabled = true;

    // Store generation params for rethink
    this._outlineGenParams = { title, subtitle, genre, totalWords, numChapters, characters, notes, aiInstructions };

    try {
      const outlines = await this.generator.generateOutlines({
        title, subtitle, genre, totalWords, numChapters, characters, notes, aiInstructions
      });

      if (!outlines || !Array.isArray(outlines) || outlines.length === 0) {
        throw new Error('No outlines were generated.');
      }

      // Store outlines for review instead of immediately saving
      this._pendingOutlines = outlines;
      this._showOutlineReview(outlines);

    } catch (err) {
      console.error('Outline generation failed:', err);
      if (errorEl) {
        errorEl.style.display = '';
        errorEl.textContent = err.message;
      }
    } finally {
      if (statusEl) statusEl.style.display = 'none';
      if (genBtn) genBtn.disabled = false;
    }
  }

  // ========================================
  //  Outline Review Popup
  // ========================================

  _showOutlineReview(outlines) {
    const body = document.getElementById('outline-review-body');
    if (!body) return;

    // Render each chapter outline as an editable card
    body.innerHTML = outlines.map((outline, i) => {
      const title = outline.title || `Chapter ${i + 1}`;
      const text = outline.outline || '';
      return `<div class="outline-chapter" data-index="${i}">
        <h4>Chapter ${i + 1}: ${this._escapeHtml(title)}</h4>
        <textarea class="outline-edit" data-index="${i}" rows="6">${this._escapeHtml(text)}</textarea>
      </div>`;
    }).join('');

    const overlay = document.getElementById('outline-review-overlay');
    if (overlay) overlay.classList.add('visible');
  }

  async _acceptOutlines() {
    const outlines = this._pendingOutlines;
    if (!outlines || outlines.length === 0) return;

    // Read any user edits from the textareas
    const editedOutlines = outlines.map((outline, i) => {
      const textarea = document.querySelector(`#outline-review-body textarea[data-index="${i}"]`);
      return {
        title: outline.title || `Chapter ${i + 1}`,
        outline: textarea ? textarea.value : (outline.outline || '')
      };
    });

    const params = this._outlineGenParams || {};

    // Save book structure first
    await this.fs.updateProject(this.state.currentProjectId, {
      title: params.title, subtitle: params.subtitle,
      wordCountGoal: params.totalWords, numChapters: params.numChapters
    });
    this._currentProject = { ...this._currentProject, title: params.title, subtitle: params.subtitle, wordCountGoal: params.totalWords, numChapters: params.numChapters };

    // Create chapters from outlines
    for (let i = 0; i < editedOutlines.length; i++) {
      const outline = editedOutlines[i];
      const ch = await this.fs.createChapter({
        projectId: this.state.currentProjectId,
        chapterNumber: i + 1,
        title: outline.title,
        content: '',
        outline: outline.outline
      });
      this._chapterWordCounts[ch.id] = 0;
    }

    // Refresh chapter list and load first chapter
    await this._renderChapterList();
    await this.renderChapterNav();
    const chapters = await this.fs.getProjectChapters(this.state.currentProjectId);
    if (chapters.length > 0) {
      await this._loadChapter(chapters[0].id);
    }

    document.getElementById('project-title').textContent = params.title || '';
    this._updateStatusBarLocal();

    // Close popups
    document.getElementById('outline-review-overlay')?.classList.remove('visible');
    this._closeAllPanels();

    this._pendingOutlines = null;
  }

  _openRethinkCommentsPopup() {
    document.getElementById('rethink-comments-prompt').value = '';
    document.getElementById('rethink-comments-status').style.display = 'none';
    document.getElementById('btn-rethink-comments-submit').disabled = false;
    const overlay = document.getElementById('rethink-comments-overlay');
    if (overlay) overlay.classList.add('visible');
  }

  async _submitRethinkComments() {
    const userInstructions = document.getElementById('rethink-comments-prompt')?.value?.trim();
    if (!userInstructions) {
      alert('Please enter instructions for how to revise the outline.');
      return;
    }

    const outlines = this._pendingOutlines;
    if (!outlines || outlines.length === 0) return;

    // Read any user edits from the textareas in the review popup
    const currentOutlines = outlines.map((outline, i) => {
      const textarea = document.querySelector(`#outline-review-body textarea[data-index="${i}"]`);
      return {
        title: outline.title || `Chapter ${i + 1}`,
        outline: textarea ? textarea.value : (outline.outline || '')
      };
    });

    const params = this._outlineGenParams || {};

    document.getElementById('rethink-comments-status').style.display = '';
    document.getElementById('btn-rethink-comments-submit').disabled = true;

    try {
      // Build a combined outline text for the AI to revise
      const combinedOutline = currentOutlines.map((ch, i) =>
        `Chapter ${i + 1}: ${ch.title}\n${ch.outline}`
      ).join('\n\n---\n\n');

      const revisedOutlines = await this.generator.generateOutlines({
        ...params,
        aiInstructions: (params.aiInstructions || '') +
          '\n\nIMPORTANT REVISION INSTRUCTIONS: The user has reviewed a previous outline and wants the following changes applied:\n' +
          userInstructions +
          '\n\nHere is the previous outline to revise:\n' + combinedOutline
      });

      if (!revisedOutlines || !Array.isArray(revisedOutlines) || revisedOutlines.length === 0) {
        throw new Error('No revised outlines were generated.');
      }

      // Update pending outlines and refresh the review popup
      this._pendingOutlines = revisedOutlines;
      this._showOutlineReview(revisedOutlines);

      // Close rethink comments popup
      document.getElementById('rethink-comments-overlay')?.classList.remove('visible');

    } catch (err) {
      console.error('Rethink outlines failed:', err);
      alert('Rethink failed: ' + err.message);
    } finally {
      document.getElementById('rethink-comments-status').style.display = 'none';
      document.getElementById('btn-rethink-comments-submit').disabled = false;
    }
  }

  // ========================================
  //  Rethink Chapter Outline (single chapter)
  // ========================================

  async _openRethinkModal() {
    if (!this.state.currentChapterId) {
      alert('No chapter selected.');
      return;
    }

    const chapter = await this.fs.getChapter(this.state.currentChapterId);
    if (!chapter?.outline) {
      alert('This chapter has no outline to rethink. Generate outlines first from the AI Writer tab.');
      return;
    }

    document.getElementById('rethink-prompt').value = '';
    document.getElementById('rethink-status').style.display = 'none';
    const overlay = document.getElementById('rethink-overlay');
    if (overlay) overlay.classList.add('visible');
  }

  async _submitRethink() {
    const userInstructions = document.getElementById('rethink-prompt')?.value?.trim();
    if (!userInstructions) {
      alert('Please enter instructions for how to revise the outline.');
      return;
    }

    const chapter = await this.fs.getChapter(this.state.currentChapterId);
    if (!chapter?.outline) return;

    const project = this._currentProject;
    const characters = await this.localStorage.getProjectCharacters(this.state.currentProjectId) || [];
    const projectNotes = await this.localStorage.getProjectNotes(this.state.currentProjectId) || [];
    let notes = projectNotes.map(n => {
      let entry = n.title;
      if (n.content) entry += '\n' + n.content;
      return entry;
    }).join('\n\n');

    const genreInfo = this._getGenreRules(project?.genre, project?.subgenre);

    document.getElementById('rethink-status').style.display = '';
    document.getElementById('btn-rethink-submit').disabled = true;

    try {
      const revisedOutline = await this.generator.rethinkOutline({
        currentOutline: chapter.outline,
        chapterTitle: chapter.title,
        userInstructions,
        bookTitle: project?.title || '',
        genre: genreInfo?.label || '',
        characters,
        notes
      });

      if (revisedOutline) {
        await this.fs.updateChapter(this.state.currentChapterId, { outline: revisedOutline });
        // Close modal and reload chapter
        document.getElementById('rethink-overlay').classList.remove('visible');
        await this._loadChapter(this.state.currentChapterId);
        alert('Chapter outline has been revised.');
      }
    } catch (err) {
      console.error('Rethink failed:', err);
      alert('Rethink failed: ' + err.message);
    } finally {
      document.getElementById('rethink-status').style.display = 'none';
      document.getElementById('btn-rethink-submit').disabled = false;
    }
  }

  // ========================================
  //  Chapter Outline Popup (fixed-position modal, same as outline-review-overlay)
  // ========================================

  /**
   * Show the chapter outline popup when a chapter with an outline is clicked.
   * Uses the proven fixed-position modal pattern (same as outline-review-overlay).
   */
  _showChapterOutlinePopup(chapterTitle) {
    console.log('[Genesis] _showChapterOutlinePopup called for:', chapterTitle);
    const popup = document.getElementById('ch-outline-popup');
    console.log('[Genesis] popup element found:', !!popup);
    if (!popup) {
      console.error('[Genesis] CRITICAL: #ch-outline-popup not found in DOM!');
      // Fallback: use a native alert to prove the code is running
      alert('Chapter Outline:\n\n' + (this._currentChapterOutline || '(no outline)').substring(0, 500));
      return;
    }

    // Set title
    const titleEl = document.getElementById('ch-outline-popup-title');
    if (titleEl) titleEl.textContent = chapterTitle ? `Outline: ${chapterTitle}` : 'Chapter Outline';

    // Fill the editable textarea with the outline
    const textEl = document.getElementById('ch-outline-popup-text');
    if (textEl) textEl.value = this._currentChapterOutline || '';

    // Reset rethink area
    const rethinkArea = document.getElementById('ch-outline-rethink-area');
    if (rethinkArea) rethinkArea.style.display = 'none';
    const rethinkStatus = document.getElementById('ch-outline-rethink-status');
    if (rethinkStatus) rethinkStatus.style.display = 'none';
    const rethinkSubmit = document.getElementById('btn-ch-outline-rethink-submit');
    if (rethinkSubmit) rethinkSubmit.disabled = false;

    // Show the popup
    popup.classList.add('visible');
    console.log('[Genesis] popup classList after add:', popup.classList.toString());
  }

  _hideChapterOutlinePopup() {
    const popup = document.getElementById('ch-outline-popup');
    if (popup) popup.classList.remove('visible');
  }

  /**
   * Called when user clicks "Accept Outline" — saves any edits, closes popup,
   * then starts prose generation using the outline.
   */
  async _acceptChapterOutline() {
    // Save any edits the user made to the outline text
    const textEl = document.getElementById('ch-outline-popup-text');
    const editedOutline = textEl?.value?.trim();
    if (editedOutline && editedOutline !== this._currentChapterOutline) {
      this._currentChapterOutline = editedOutline;
      if (this.state.currentChapterId) {
        await this.fs.updateChapter(this.state.currentChapterId, { outline: editedOutline });
      }
    }

    this._hideChapterOutlinePopup();

    if (!this.state.currentChapterId || !this._currentChapterOutline) return;
    if (!this.generator.hasApiKey()) {
      alert('Set your Anthropic API key in Settings first.');
      return;
    }

    // Open the generate panel, fill the plot with the outline, trigger generation
    await this.openGeneratePanel();
    const plotEl = document.getElementById('generate-plot');
    if (plotEl && !plotEl.value?.trim()) {
      plotEl.value = this._currentChapterOutline;
    }
    this._closeSetupBookModal();
    await this._runGeneration();
  }

  /**
   * Called when user clicks "Finished" in the rethink area — sends the user's
   * instructions to the AI to revise the chapter outline, then updates the popup.
   */
  async _submitChapterOutlineRethink() {
    const promptEl = document.getElementById('ch-outline-rethink-prompt');
    const userInstructions = promptEl?.value?.trim();
    if (!userInstructions) {
      alert('Please enter instructions for how to revise the outline.');
      return;
    }

    if (!this.state.currentChapterId) return;
    const chapter = await this.fs.getChapter(this.state.currentChapterId);
    if (!chapter?.outline) return;

    const project = this._currentProject;
    const characters = await this.localStorage.getProjectCharacters(this.state.currentProjectId) || [];
    const projectNotes = await this.localStorage.getProjectNotes(this.state.currentProjectId) || [];
    let notes = projectNotes.map(n => {
      let entry = n.title;
      if (n.content) entry += '\n' + n.content;
      return entry;
    }).join('\n\n');

    const genreInfo = this._getGenreRules(project?.genre, project?.subgenre);

    // Show spinner, disable button
    document.getElementById('ch-outline-rethink-status').style.display = '';
    document.getElementById('btn-ch-outline-rethink-submit').disabled = true;

    try {
      const revisedOutline = await this.generator.rethinkOutline({
        currentOutline: chapter.outline,
        chapterTitle: chapter.title,
        userInstructions,
        bookTitle: project?.title || '',
        genre: genreInfo?.label || '',
        characters,
        notes
      });

      if (revisedOutline) {
        await this.fs.updateChapter(this.state.currentChapterId, { outline: revisedOutline });
        this._currentChapterOutline = revisedOutline;

        // Update the editable textarea with the revised outline
        const textEl = document.getElementById('ch-outline-popup-text');
        if (textEl) textEl.value = revisedOutline;

        // Hide rethink area so user can review the new outline
        document.getElementById('ch-outline-rethink-area').style.display = 'none';
        document.getElementById('ch-outline-rethink-prompt').value = '';
      }
    } catch (err) {
      console.error('Outline rethink failed:', err);
      alert('Rethink failed: ' + err.message);
    } finally {
      document.getElementById('ch-outline-rethink-status').style.display = 'none';
      document.getElementById('btn-ch-outline-rethink-submit').disabled = false;
    }
  }

  // ========================================
  //  Prose Quality Scoring
  // ========================================

  async _scoreProse(generatedText) {
    if (!this.generator.hasApiKey()) return;
    if (!generatedText || generatedText.length < 100) return;

    // Reset rewrite iteration counter for fresh generations
    this._rewriteIteration = 0;
    this._previousRewriteScore = null;
    this._previousRewriteIssueCount = null;
    this._previousRewriteText = null;

    // Show scoring progress bar
    this._showScoringProgress(true);

    try {
      const review = await this.generator.scoreProse(generatedText);
      this._showScoringProgress(false);

      // Record errors to the cross-project error pattern database
      if (this.errorDb && review && ((review.issues?.length || 0) + (review.aiPatterns?.length || 0)) > 0) {
        this.errorDb.recordFromReview(review, {
          projectId: this.state.currentProjectId,
          chapterId: this.state.currentChapterId,
          genre: this._currentProject?.genre || ''
        }).catch(() => {});
      }

      this._showProseReview(review, generatedText);
    } catch (err) {
      this._showScoringProgress(false);
      console.error('Prose scoring failed:', err);
    }
  }

  async _scoreProseAfterRewrite(generatedText, previousScore, previousIssueCount, previousSubscores) {
    if (!this.generator.hasApiKey()) return;
    if (!generatedText || generatedText.length < 100) return;

    // Show scoring progress bar
    this._showScoringProgress(true);

    try {
      const review = await this.generator.scoreProse(generatedText, {
        isRewrite: true,
        previousIssueCount,
        previousScore,
        previousSubscores
      });

      // Add comparison data to the review for display
      review._previousScore = previousScore;
      review._rewriteIteration = this._rewriteIteration;
      review._previousIssueCount = previousIssueCount;

      // Detect convergence: score didn't improve meaningfully
      const scoreDelta = review.score - previousScore;
      const newIssueCount = (review.issues?.length || 0) + (review.aiPatterns?.length || 0);

      if (scoreDelta <= 1 && this._rewriteIteration >= 2) {
        review._convergenceWarning = true;
      }

      // If score dropped, automatically revert to the previous version
      // This is the key safeguard: rewrites should never make things worse
      if (scoreDelta < 0 && this._previousRewriteText) {
        review._scoreDecreased = true;
        review._revertedToPrevious = true;

        // Restore the previous (better-scoring) text
        const baseContent = this._preGenerationContent || '';
        const editorEl = this.editor.element;
        const paragraphs = this._previousRewriteText.split('\n\n');
        const restoredHtml = paragraphs
          .map(p => {
            const lines = p.replace(/\n/g, '<br>');
            return `<p>${lines}</p>`;
          })
          .join('');
        editorEl.innerHTML = (baseContent.trim() ? baseContent : '') + restoredHtml;

        // Save the reverted content
        if (this.state.currentChapterId) {
          try {
            await this.fs.updateChapter(this.state.currentChapterId, { content: this.editor.getContent() });
          } catch (_) {}
          this._updateLocalWordCounts(this.editor.getContent());
        }

        // Reset the generated text to the previous version
        this._lastGeneratedText = this._previousRewriteText;
      }

      this._showScoringProgress(false);

      // Record errors to the cross-project error pattern database
      if (this.errorDb && review && ((review.issues?.length || 0) + (review.aiPatterns?.length || 0)) > 0) {
        this.errorDb.recordFromReview(review, {
          projectId: this.state.currentProjectId,
          chapterId: this.state.currentChapterId,
          genre: this._currentProject?.genre || ''
        }).catch(() => {});
      }

      this._showProseReview(review, generatedText);
    } catch (err) {
      this._showScoringProgress(false);
      console.error('Prose scoring failed:', err);
    }
  }

  // ========================================
  //  Iterative Writing Engine
  // ========================================

  /**
   * Iterative Write: generates ~100 words, scores, rewrites until score >= 90,
   * then automatically continues to the next chunk. Repeats until cancelled.
   */
  async _iterativeWrite() {
    if (!this.generator.hasApiKey()) {
      alert('No API key set. Go to Settings to add your Anthropic API key.');
      return;
    }

    // Gather generation settings from the panel
    const plot = document.getElementById('generate-plot')?.value?.trim();
    if (!plot) {
      alert('Please enter a story plot or description.');
      return;
    }

    const tone = document.getElementById('generate-tone')?.value?.trim() || '';
    const style = document.getElementById('generate-style')?.value?.trim() || '';
    const useCharacters = document.getElementById('generate-use-characters')?.checked;
    const useNotes = document.getElementById('generate-use-notes')?.checked;

    // Store settings for the iterative session
    this._iterativeSettings = { plot, tone, style, useCharacters, useNotes };
    this._iterativeCancelled = false;
    this._iterativeChunkNum = 0;

    this._closeAllPanels();
    this._hideWelcome();

    // Start the iterative loop
    await this._iterativeWriteLoop();
  }

  async _iterativeWriteLoop() {
    if (this._iterativeCancelled) return;

    const settings = this._iterativeSettings;
    if (!settings) return;

    // Advance chunk counter
    this._iterativeChunkNum = (this._iterativeChunkNum || 0) + 1;

    // Reset stagnation tracking for new chunk
    this._iterativeNoImprovement = 0;
    this._iterativeBestReview = null;
    this._iterativeBestText = null;
    this._iterativeConsecutiveNoIssues = 0;

    // Show iterative writing overlay with fresh state for new chunk
    this._showIterativeOverlay(true);
    this._showIterativeScoringNotice(false);
    this._updateIterativeChunk(this._iterativeChunkNum);
    this._updateIterativePhase('Generating paragraph\u2026');
    this._updateIterativeScore(null);
    this._updateIterativeIteration(0, 0);
    this._resetScoreHistory();
    // Update threshold display
    const qualityThreshold = this._currentProject?.qualityThreshold || 90;
    const thresholdLabel = document.getElementById('iterative-threshold-label');
    if (thresholdLabel) thresholdLabel.textContent = `Target: ${qualityThreshold}%`;
    const thresholdMarker = document.getElementById('iterative-progress-threshold');
    if (thresholdMarker) thresholdMarker.style.left = qualityThreshold + '%';
    // Clear log for new chunk
    const logEl = document.getElementById('iterative-status-log');
    if (logEl) logEl.textContent = `Chunk ${this._iterativeChunkNum}: Generating ~100 words\u2026`;

    // Gather context
    const existingContent = this.editor.getContent();
    this._preGenerationContent = existingContent;

    let characters = [];
    if (settings.useCharacters && this.state.currentProjectId) {
      characters = await this.localStorage.getProjectCharacters(this.state.currentProjectId);
    }

    let notes = '';
    if (settings.useNotes && this.state.currentProjectId) {
      const projectNotes = await this.localStorage.getProjectNotes(this.state.currentProjectId);
      if (projectNotes.length > 0) {
        notes = projectNotes.map(n => {
          let entry = n.title;
          if (n.type && n.type !== 'general') entry = `[${n.type}] ${entry}`;
          if (n.content) entry += '\n' + n.content;
          return entry;
        }).join('\n\n');
      }
    }

    // Append project knowledge base as reference materials
    const knowledgePrompt = await this._getProjectKnowledge();
    if (knowledgePrompt) {
      notes = notes ? notes + '\n\n' + knowledgePrompt : knowledgePrompt;
    }

    const aiInstructions = this._currentProject?.aiInstructions || '';
    let chapterTitle = '';
    if (this.state.currentChapterId) {
      try {
        const chapter = await this.fs.getChapter(this.state.currentChapterId);
        if (chapter) chapterTitle = chapter.title;
      } catch (_) {}
    }

    const project = this._currentProject;
    const genreId = project ? (project.genre || '') : '';
    const subgenreId = project ? (project.subgenre || '') : '';
    const genreInfo = this._getGenreRules(genreId, subgenreId);
    const chapterOutline = this._currentChapterOutline || '';

    // Generate ~100 words — hard limit via maxTokens to prevent overrun
    const editorEl = this.editor.element;
    let streamedText = '';

    try {
      await new Promise((resolve, reject) => {
        if (this._iterativeCancelled) { resolve(); return; }

        this.generator.generate(
          {
            plot: settings.plot + '\n\nCRITICAL CONSTRAINT: Write EXACTLY ONE PARAGRAPH of approximately 80-120 words. STOP after one paragraph. Do NOT write more than 150 words under any circumstances.',
            existingContent,
            chapterTitle,
            characters,
            notes,
            chapterOutline,
            aiInstructions,
            tone: settings.tone,
            style: settings.style,
            wordTarget: 100,
            maxTokens: 250,
            genre: genreInfo?.label || '',
            genreRules: genreInfo?.rules || '',
            projectGoal: project?.wordCountGoal || 0,
            voice: project?.voice || ''
          },
          {
            onChunk: (text) => {
              streamedText += text;
              streamedText = this._stripEmDashes(streamedText);
              const startingContent = existingContent.trim() ? existingContent : '';
              const paragraphs = streamedText.split('\n\n');
              const newHtml = paragraphs.map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
              editorEl.innerHTML = startingContent + newHtml;
              const container = editorEl.closest('.editor-area');
              if (container) container.scrollTop = container.scrollHeight;
              const wc = editorEl.textContent.match(/[a-zA-Z'''\u2019-]+/g) || [];
              const wordsEl = document.getElementById('status-words');
              if (wordsEl) wordsEl.textContent = wc.length.toLocaleString();
              const fwcWords = document.getElementById('fwc-words');
              if (fwcWords) fwcWords.textContent = wc.length.toLocaleString();
            },
            onDone: () => {
              // Format headings and scene breaks
              editorEl.innerHTML = this._formatGeneratedHtml(editorEl.innerHTML, chapterTitle);
              // Save generated content
              const content = this.editor.getContent();
              if (this.state.currentChapterId) {
                this.fs.updateChapter(this.state.currentChapterId, { content }).catch(() => {});
                this._updateLocalWordCounts(content);
              }
              resolve();
            },
            onError: (err) => reject(err)
          }
        );
      });
    } catch (err) {
      this._showIterativeOverlay(false);
      alert('Generation failed: ' + err.message);
      return;
    }

    if (this._iterativeCancelled || !streamedText || streamedText.length < 20) {
      this._showIterativeOverlay(false);
      return;
    }

    // Store the generated text for the iteration loop
    this._lastGeneratedText = streamedText;
    this._iterativeBestText = null;
    this._iterPrevScore = 0;
    this._iterPrevIssueCount = 0;
    this._iterPrevSubscores = {};
    // Unique session key to prevent duplicate error recording within the same iteration session
    this._iterativeSessionKey = `iter_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this._lastGenSettings = {
      plot: settings.plot, wordTarget: 100, tone: settings.tone,
      style: settings.style, useCharacters: settings.useCharacters,
      useNotes: settings.useNotes, chapterOutline
    };

    // Begin score-and-refine loop
    await this._iterativeScoreAndRefine(streamedText, 0, 0);
  }

  /**
   * Score the current paragraph and refine it using the micro-fix pipeline.
   * Phase 2: Deterministic lint (free, instant)
   * Phase 3: Micro-fix iterations (up to 5 passes, each fixing exactly 1 issue)
   * Each pass targets the single highest-impact defect with internal before/after validation.
   */
  async _iterativeScoreAndRefine(currentText, iteration, bestScore) {
    if (this._iterativeCancelled) {
      this._showIterativeOverlay(false);
      return;
    }

    const MAX_MICRO_ITERATIONS = 5;
    const qualityThreshold = this._currentProject?.qualityThreshold || 90;
    let workingText = currentText;
    let iterationHistory = [];
    let previousFixes = [];    // Accepted fixes (descriptions)
    let attemptedFixes = [];   // ALL attempted fixes — including rejected ones
    let consecutiveNoFix = 0;  // Track consecutive passes with no viable fix

    // --- Deterministic lint ---
    let lintResult = this.analyzer.lintProse(workingText);
    let hardDefects = lintResult.defects.filter(d => d.severity === 'hard');
    this._updateIterativeLog(`Lint: ${hardDefects.length} hard defects, ${lintResult.stats.mediumDefects || 0} medium`);

    if (lintResult.qualityMetrics) {
      const qm = lintResult.qualityMetrics;
      this._updateIterativeLog(`Metrics: Sentence StdDev: ${qm.sentenceLengthStdDev}, Short%: ${qm.shortSentencePct}%, Filters: ${qm.filterWordCount}`);
    }

    // Get project context once
    const project = this._currentProject;
    const genreInfo = this._getGenreRules(project?.genre, project?.subgenre);

    // --- Micro-fix loop ---
    for (let iter = 1; iter <= MAX_MICRO_ITERATIONS; iter++) {
      if (this._iterativeCancelled) {
        this._showIterativeOverlay(false);
        return;
      }

      // Re-lint current text
      lintResult = this.analyzer.lintProse(workingText);
      hardDefects = lintResult.defects.filter(d => d.severity === 'hard');

      const isFinalPass = iter === MAX_MICRO_ITERATIONS;
      this._updateIterativePhase(`Pass ${iter}/${MAX_MICRO_ITERATIONS}${isFinalPass ? ' (final score)' : ''}\u2026`);
      this._showIterativeScoringNotice(true);
      this._updateIterativeIteration(iter, bestScore);
      this._updateIterativeLog(`Pass ${iter}${isFinalPass ? ' (final score only)' : ' \u2014 scoring + micro-fix'}\u2026`);

      let result;
      try {
        result = await this.generator.scoreAndMicroFix(workingText, {
          threshold: qualityThreshold,
          iterationNum: iter,
          maxIterations: MAX_MICRO_ITERATIONS,
          previousFixes,
          attemptedFixes,
          lintDefects: hardDefects,
          genre: genreInfo?.label || '',
          voice: project?.voice || '',
          aiInstructions: project?.aiInstructions || '',
        });
      } catch (err) {
        this._updateIterativeLog(`Pass ${iter} failed: ${err.message}`);
        break;
      }

      this._showIterativeScoringNotice(false);

      if (this._iterativeCancelled) {
        this._showIterativeOverlay(false);
        return;
      }

      if (!result || result.beforeScore === 0) {
        this._updateIterativeLog(`Scoring failed. Using best available version.`);
        break;
      }

      const beforeScore = result.beforeScore;
      const afterScore = result.afterScore || beforeScore;

      // On first pass, establish the baseline score
      if (iter === 1 && bestScore === 0) {
        bestScore = beforeScore;
      }

      // Record errors to cross-project error pattern database
      if (this.errorDb && result.issues?.length > 0) {
        const sessionKey = this._iterativeSessionKey || null;
        this.errorDb.recordFromReview(result, {
          projectId: this.state.currentProjectId,
          chapterId: this.state.currentChapterId,
          genre: this._currentProject?.genre || '',
          sessionKey
        }).catch(() => {});
        this.errorDb.buildNegativePrompt({ maxPatterns: 20, minFrequency: 1 }).then(prompt => {
          this._cachedErrorPatternsPrompt = prompt;
        }).catch(() => {});
      }

      // Record iteration history
      iterationHistory.push({ iteration: iter, score: beforeScore, subscores: { ...result.subscores }, issueCount: result.issues?.length || 0, text: workingText });

      // Log results
      const issueCount = result.issues?.length || 0;
      this._updateIterativeLog(`Pass ${iter} \u2014 Before: ${beforeScore}/100 | After: ${afterScore}/100 (${result.label}) | Issues: ${issueCount}`);

      if (result.fixApplied) {
        this._updateIterativeLog(`Pass ${iter}: Fix: [${result.fixCategory || '?'}] ${result.fixApplied}`);
      }

      // Log internal validation
      if (result.internalValidation) {
        this._updateIterativeLog(`Pass ${iter}: Validation: ${result.internalValidation}`);
      }

      // Log Four Requirements
      if (result.fourRequirementsFound) {
        const found = Object.entries(result.fourRequirementsFound)
          .filter(([_, v]) => v)
          .map(([k]) => k.replace(/([A-Z])/g, ' $1').trim());
        this._updateIterativeLog(`Four Requirements: ${found.length}/4`);
        this._updateFourRequirementsDisplay(result.fourRequirementsFound);
      }

      // Update UI
      this._updateIterativeScore(beforeScore, true);
      this._recordIterationScore(iter, beforeScore);
      this._updateIterativeIteration(iter, Math.max(bestScore, beforeScore));

      this._iterPrevScore = beforeScore;
      this._iterPrevIssueCount = issueCount;
      this._iterPrevSubscores = result.subscores;

      // Track attempted fix (whether or not it's accepted)
      if (result.fixTarget) {
        attemptedFixes.push(`[${result.fixCategory || 'unknown'}] Target: "${(result.fixTarget || '').slice(0, 80)}" \u2014 ${(result.fixApplied || '').slice(0, 100)}`);
      }

      // === DECISION: Accept or reject the fix ===

      // Case 1: No fix was produced (model self-rejected, or score >= threshold, or final pass)
      if (!result.microFixedProse) {
        // Smart early exit: track consecutive passes with no viable fix
        consecutiveNoFix++;
        if (consecutiveNoFix >= 2 && !isFinalPass) {
          this._updateIterativeLog(`Two consecutive passes with no viable fix. Best: ${bestScore}/100`);
          break;
        }

        // Update best score if this scoring was higher (reduces variance drift)
        if (beforeScore > bestScore) {
          bestScore = beforeScore;
          this._iterativeBestText = workingText;
          this._iterativeBestReview = result;
        }

        if (beforeScore >= qualityThreshold) {
          this._updateIterativeLog(`PASSED threshold (${qualityThreshold}). Score: ${beforeScore}/100`);
          await new Promise(r => setTimeout(r, 800));
          this._showIterativeOverlay(false);
          this._showFinalFixScreen(
            this._iterativeBestText || workingText,
            bestScore,
            this._iterativeBestReview || result,
            iterationHistory,
            qualityThreshold,
            true
          );
          return;
        }

        if (isFinalPass) {
          this._updateIterativeLog(`Final pass. Best: ${bestScore}/100`);
          break;
        }

        if (result.fixApplied && result.fixApplied.includes('Could not fix')) {
          this._updateIterativeLog(`Model could not find a safe fix. Best: ${bestScore}/100`);
          continue;
        }

        this._updateIterativeLog(`No fix returned. Continuing\u2026`);
        continue;
      }

      // Case 2: Fix was produced \u2014 validate it

      const preWords = (workingText.match(/[a-zA-Z\u2019'''-]+/g) || []).length;
      const postWords = (result.microFixedProse.match(/[a-zA-Z\u2019'''-]+/g) || []).length;
      const wordDrift = Math.abs(postWords - preWords) / Math.max(preWords, 1);

      // External check 1: Word count drift
      if (wordDrift > 0.15) {
        this._updateIterativeLog(`Fix REJECTED \u2014 word count drift ${Math.round(wordDrift * 100)}% (${preWords} \u2192 ${postWords})`);
        continue;
      }

      // External check 2: No new hard lint defects
      // First, auto-fix trivially correctable hard defects (em dashes)
      let cleanedProse = result.microFixedProse;
      const preLint = this.analyzer.lintProse(cleanedProse);
      const preHardDefects = preLint.defects.filter(d => d.severity === 'hard');

      if (preHardDefects.length > hardDefects.length) {
        // Check if the ONLY new defects are em dashes \u2014 these can be auto-fixed
        const newDefects = preHardDefects.filter(d =>
          !hardDefects.some(hd => hd.text === d.text && hd.position === d.position)
        );
        const allEmDash = newDefects.every(d => d.type === 'em-dash');

        if (allEmDash && newDefects.length <= 3) {
          // Auto-fix: replace em dashes with commas
          cleanedProse = cleanedProse
            .replace(/\s*[\u2014\u2013]\s*/g, ', ')   // em/en dash \u2192 comma
            .replace(/\s*---\s*/g, ', ')                // triple hyphen \u2192 comma
            .replace(/,\s*,/g, ',')                     // cleanup double commas
            .replace(/\s+/g, ' ')                       // cleanup whitespace
            .trim();

          // Re-lint after auto-fix
          const postLint = this.analyzer.lintProse(cleanedProse);
          const postHardDefects = postLint.defects.filter(d => d.severity === 'hard');

          if (postHardDefects.length <= hardDefects.length) {
            this._updateIterativeLog(`Auto-fixed ${newDefects.length} em dash(es) in replacement text`);
            result.microFixedProse = cleanedProse;
            // Fall through to acceptance checks below
          } else {
            this._updateIterativeLog(`Fix REJECTED \u2014 introduced ${postHardDefects.length - hardDefects.length} non-em-dash hard defects`);
            continue;
          }
        } else {
          this._updateIterativeLog(`Fix REJECTED \u2014 introduced ${newDefects.length} new hard defect(s): ${newDefects.map(d => d.type).join(', ')}`);
          continue;
        }
      }

      // External check 3: The model's own afterScore should be higher
      if (afterScore < beforeScore) {
        this._updateIterativeLog(`Fix REJECTED \u2014 model's own after-score (${afterScore}) lower than before (${beforeScore})`);
        continue;
      }

      // All checks passed \u2014 but only update text if afterScore >= bestScore
      // Otherwise the fix is internally valid but globally regressive
      consecutiveNoFix = 0;
      if (afterScore >= bestScore) {
        workingText = result.microFixedProse;
        this._lastGeneratedText = workingText;
        bestScore = afterScore;
        this._iterativeBestText = workingText;
        this._iterativeBestReview = result;
        previousFixes.push(result.fixApplied || 'Unknown fix');

        // Update editor
        const baseContent = this._preGenerationContent || '';
        const editorEl = this.editor.element;
        const paragraphs = workingText.split('\n\n');
        const newHtml = paragraphs.map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
        editorEl.innerHTML = (baseContent.trim() ? baseContent : '') + newHtml;
        if (this.state.currentChapterId) {
          this.fs.updateChapter(this.state.currentChapterId, { content: this.editor.getContent() }).catch(() => {});
          this._updateLocalWordCounts(this.editor.getContent());
        }
        this._updateIterativeLog(`Fix ACCEPTED. Before: ${beforeScore} \u2192 After: ${afterScore}. Best: ${bestScore}/100`);
      } else {
        // Fix improved from before but didn't reach the previous best
        // This means scoring variance \u2014 don't change text
        this._updateIterativeLog(`Fix improved (${beforeScore}\u2192${afterScore}) but below best (${bestScore}). Text NOT changed to avoid regression.`);
      }

      // === THRESHOLD CHECK ===
      if (afterScore >= qualityThreshold) {
        this._updateIterativeLog(`PASSED threshold (${qualityThreshold}) after fix. Score: ${afterScore}/100`);
        await new Promise(r => setTimeout(r, 800));
        this._showIterativeOverlay(false);
        this._showFinalFixScreen(
          this._iterativeBestText || workingText,
          bestScore,
          this._iterativeBestReview,
          iterationHistory,
          qualityThreshold,
          true
        );
        return;
      }

      // Brief pause between iterations
      await new Promise(r => setTimeout(r, 500));
    }

    // === FINAL: Show the final fix screen with best version ===
    this._showIterativeOverlay(false);
    const finalText = this._iterativeBestText || workingText;
    const finalScore = bestScore;
    const finalReview = this._iterativeBestReview;

    this._showFinalFixScreen(
      finalText,
      finalScore,
      finalReview,
      iterationHistory,
      qualityThreshold,
      finalScore >= qualityThreshold
    );
  }

  /**
   * Show the final fix screen after all background iterations are complete.
   * Presents the best prose with options: Fix Critical Errors, Apply All Fixes, Accept As-Is.
   */
  _showFinalFixScreen(prose, score, review, iterationHistory, threshold, thresholdMet) {
    const overlay = document.getElementById('iterative-accept-overlay');
    if (!overlay) return;

    // Store state for button handlers
    this._iterativeAcceptText = prose;
    this._finalFixReview = review;
    this._finalFixIterationHistory = iterationHistory;

    // Build the score display
    const scoreClass = score >= 88 ? 'score-excellent' : score >= 78 ? 'score-good' :
      score >= 65 ? 'score-fair' : 'score-poor';

    const scoreEl = document.getElementById('iterative-accept-score');
    if (scoreEl) {
      scoreEl.textContent = score;
      scoreEl.className = 'iterative-score-number ' + scoreClass;
    }

    // Build iteration journey summary
    let journeyHtml = '';
    if (iterationHistory && iterationHistory.length > 1) {
      const startScore = iterationHistory[0].score;
      journeyHtml = `<div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:8px;text-align:center;">
        Score journey: ${iterationHistory.map(h => h.score).join(' \u2192 ')}
        (${score - startScore >= 0 ? '+' : ''}${score - startScore} over ${iterationHistory.length} iterations)
      </div>`;
    }

    // Build threshold status
    const thresholdStatusHtml = thresholdMet
      ? `<div style="color:var(--success, #28a745);font-size:0.85rem;font-weight:600;text-align:center;margin-bottom:8px;">Threshold met: ${score}/${threshold}</div>`
      : `<div style="color:var(--danger, #dc3545);font-size:0.85rem;font-weight:600;text-align:center;margin-bottom:8px;">Below threshold: ${score}/${threshold} (${threshold - score} pts needed)</div>`;

    // Build remaining issues summary
    let issuesHtml = '';
    const highIssues = (review?.issues || []).filter(i => i.severity === 'high');
    const mediumIssues = (review?.issues || []).filter(i => i.severity === 'medium');
    const lowIssues = (review?.issues || []).filter(i => i.severity === 'low');
    const aiPatterns = review?.aiPatterns || [];
    const criticalCount = highIssues.length + aiPatterns.length;
    const totalIssues = highIssues.length + mediumIssues.length + lowIssues.length + aiPatterns.length;

    if (totalIssues > 0) {
      issuesHtml = `<div style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:12px;padding:8px;background:var(--bg-secondary);border-radius:var(--radius-sm);">
        <strong>Remaining issues:</strong>
        ${criticalCount > 0 ? `<span style="color:var(--danger);"> ${criticalCount} critical</span>` : ''}
        ${mediumIssues.length > 0 ? `<span style="color:var(--warning, #ffc107);"> ${mediumIssues.length} moderate</span>` : ''}
        ${lowIssues.length > 0 ? `<span style="color:var(--text-muted);"> ${lowIssues.length} minor</span>` : ''}
      </div>`;
    } else {
      issuesHtml = `<div style="font-size:0.8rem;color:var(--success);margin-bottom:12px;text-align:center;">No remaining issues detected.</div>`;
    }

    // Build prose preview
    const previewEl = document.getElementById('iterative-accept-preview');
    if (previewEl) {
      previewEl.textContent = prose;
    }

    // Insert journey and issue info before preview
    const modalBody = overlay.querySelector('.modal-body');
    if (modalBody) {
      // Remove any previously injected info divs
      modalBody.querySelectorAll('.final-fix-info').forEach(el => el.remove());

      const infoDiv = document.createElement('div');
      infoDiv.className = 'final-fix-info';
      infoDiv.innerHTML = thresholdStatusHtml + journeyHtml + issuesHtml;

      const previewContainer = document.getElementById('iterative-accept-preview');
      if (previewContainer) {
        modalBody.insertBefore(infoDiv, previewContainer);
      }
    }

    // Update modal title
    const modalHeader = overlay.querySelector('.modal-header h2');
    if (modalHeader) {
      modalHeader.textContent = thresholdMet ? 'Prose Ready' : 'Best Result';
    }

    // Update description text
    const descEl = overlay.querySelector('.modal-body > p');
    if (descEl) {
      descEl.innerHTML = thresholdMet
        ? 'This prose meets your quality threshold. Accept as-is or review remaining issues.'
        : `After ${iterationHistory?.length || 0} iterations, this is the best version achieved. You can accept it, or fix remaining issues.`;
    }

    // Update footer buttons
    const footer = overlay.querySelector('.modal-footer');
    if (footer) {
      footer.innerHTML = '';

      // Button: Fix Critical Errors (only if critical issues exist)
      if (criticalCount > 0) {
        const fixCritBtn = document.createElement('button');
        fixCritBtn.className = 'btn';
        fixCritBtn.style.cssText = 'border-color:var(--danger);color:var(--danger);';
        fixCritBtn.textContent = `Fix Critical (${criticalCount})`;
        fixCritBtn.id = 'btn-final-fix-critical';
        fixCritBtn.addEventListener('click', () => {
          overlay.classList.remove('visible');
          this._applyFinalFixes('critical');
        });
        footer.appendChild(fixCritBtn);
      }

      // Button: Apply All Fixes (only if any issues exist)
      if (totalIssues > 0) {
        const fixAllBtn = document.createElement('button');
        fixAllBtn.className = 'btn';
        fixAllBtn.textContent = `Fix All (${totalIssues})`;
        fixAllBtn.id = 'btn-final-fix-all';
        fixAllBtn.addEventListener('click', () => {
          overlay.classList.remove('visible');
          this._applyFinalFixes('all');
        });
        footer.appendChild(fixAllBtn);
      }

      // Button: Accept & Continue
      const acceptBtn = document.createElement('button');
      acceptBtn.className = 'btn btn-primary';
      acceptBtn.textContent = 'Accept & Continue';
      acceptBtn.id = 'btn-iterative-accept';
      acceptBtn.addEventListener('click', () => {
        overlay.classList.remove('visible');
        this._iterativeWriteLoop();
      });
      footer.appendChild(acceptBtn);

      // Button: Accept & Stop
      const stopBtn = document.createElement('button');
      stopBtn.className = 'btn';
      stopBtn.textContent = 'Accept & Stop';
      stopBtn.id = 'btn-iterative-accept-stop';
      stopBtn.addEventListener('click', () => {
        overlay.classList.remove('visible');
        this._iterativeCancelled = true;
        this._showContinueBar(true);
      });
      footer.appendChild(stopBtn);
    }

    overlay.classList.add('visible');
  }

  /**
   * Apply final fixes (critical-only or all) after the background iteration loop.
   * This triggers a rewrite pass focused on the remaining issues.
   */
  async _applyFinalFixes(mode) {
    const review = this._finalFixReview;
    const prose = this._iterativeAcceptText;
    if (!review || !prose) return;

    // Build fix list from remaining issues
    const problems = [];

    if (review.aiPatterns) {
      for (const p of review.aiPatterns) {
        problems.push(`AI Pattern: ${p.pattern}${p.examples?.[0] ? ` — "${p.examples[0]}"` : ''}`);
      }
    }

    if (review.issues) {
      for (const issue of review.issues) {
        if (mode === 'critical' && issue.severity !== 'high') continue;
        if (issue.severity === 'low') continue; // Skip low even in 'all' mode — they cause more harm
        problems.push(`[${issue.severity}] ${issue.problem || ''}${issue.text ? ` — "${issue.text}"` : ''}`);
      }
    }

    if (problems.length === 0) {
      // Nothing to fix, just continue
      this._iterativeWriteLoop();
      return;
    }

    this._updateIterativeLog(`Applying ${mode} fixes (${problems.length} issues)\u2026`);
    this._showIterativeOverlay(true);
    this._updateIterativePhase(`Applying ${problems.length} ${mode} fixes\u2026`);

    // Use the existing rewrite infrastructure
    const project = this._currentProject;
    const genreInfo = this._getGenreRules(project?.genre, project?.subgenre);
    let characters = [];
    if (this._iterativeSettings?.useCharacters && this.state.currentProjectId) {
      characters = await this.localStorage.getProjectCharacters(this.state.currentProjectId);
    }
    let chapterTitle = '';
    if (this.state.currentChapterId) {
      try {
        const chapter = await this.fs.getChapter(this.state.currentChapterId);
        if (chapter) chapterTitle = chapter.title;
      } catch (_) {}
    }

    const baseContent = this._preGenerationContent || '';
    const editorEl = this.editor.element;
    editorEl.innerHTML = baseContent;

    let rewrittenText = '';
    const qualityThreshold = this._currentProject?.qualityThreshold || 90;

    try {
      await new Promise((resolve, reject) => {
        this.generator.rewriteProse(
          {
            originalProse: prose,
            problems,
            userInstructions: `Apply ONLY the listed fixes. Use surgical, minimum-change fixes. Do NOT rewrite full sentences or paragraphs unless absolutely necessary. Preserve the existing voice, rhythm, and structure.`,
            chapterTitle,
            characters,
            notes: '',
            chapterOutline: this._currentChapterOutline || '',
            aiInstructions: project?.aiInstructions || '',
            tone: this._iterativeSettings?.tone || '',
            style: this._iterativeSettings?.style || '',
            wordTarget: 100,
            maxTokens: 4096,
            genre: genreInfo?.label || '',
            genreRules: genreInfo?.rules || '',
            voice: project?.voice || '',
            previousScore: this._iterativeBestReview?.score,
            previousSubscores: this._iterativeBestReview?.subscores,
            rewriteIteration: 1,
            errorPatternsPrompt: this._cachedErrorPatternsPrompt || ''
          },
          {
            onChunk: (text) => {
              rewrittenText += text;
              rewrittenText = this._stripEmDashes(rewrittenText);
              const startingContent = baseContent.trim() ? baseContent : '';
              const paragraphs = rewrittenText.split('\n\n');
              const newHtml = paragraphs.map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
              editorEl.innerHTML = startingContent + newHtml;
              const container = editorEl.closest('.editor-area');
              if (container) container.scrollTop = container.scrollHeight;
            },
            onDone: () => {
              const content = this.editor.getContent();
              if (this.state.currentChapterId) {
                this.fs.updateChapter(this.state.currentChapterId, { content }).catch(() => {});
                this._updateLocalWordCounts(content);
              }
              resolve();
            },
            onError: (err) => reject(err)
          }
        );
      });

      if (rewrittenText && rewrittenText.length > 20) {
        this._iterativeAcceptText = rewrittenText;
        this._lastGeneratedText = rewrittenText;
        this._updateIterativeLog(`${mode} fixes applied. Re-scoring\u2026`);

        // Re-score the fixed prose
        this._updateIterativePhase('Re-scoring\u2026');
        try {
          const newReview = await this.generator.scoreProse(rewrittenText, {
            isRewrite: true,
            previousScore: this._iterativeBestReview?.score || 0,
            previousIssueCount: problems.length,
            previousSubscores: this._iterativeBestReview?.subscores || {}
          });
          if (newReview && newReview.score > 0) {
            this._updateIterativeLog(`New score after fixes: ${newReview.score}/100`);
            this._showIterativeOverlay(false);

            // Show updated final fix screen with new results
            this._showFinalFixScreen(
              rewrittenText,
              newReview.score,
              newReview,
              this._finalFixIterationHistory || [],
              qualityThreshold,
              newReview.score >= qualityThreshold
            );
            return;
          }
        } catch (err) {
          this._updateIterativeLog(`Re-scoring failed: ${err.message}`);
        }
      }
    } catch (err) {
      this._updateIterativeLog(`Fix application failed: ${err.message}`);
    }

    this._showIterativeOverlay(false);
    this._showContinueBar(true);
  }

  /**
   * Show the accept/reject dialog once score target is met (or iterations exhausted).
   */
  _presentIterativeAccept(text, score) {
    const scoreEl = document.getElementById('iterative-accept-score');
    if (scoreEl) {
      scoreEl.textContent = score;
      scoreEl.className = 'iterative-score-number ' + (
        score >= 88 ? 'score-excellent' : score >= 78 ? 'score-good' :
        score >= 65 ? 'score-fair' : 'score-poor'
      );
    }

    const previewEl = document.getElementById('iterative-accept-preview');
    if (previewEl) {
      previewEl.textContent = text;
    }

    this._iterativeAcceptText = text;

    const overlay = document.getElementById('iterative-accept-overlay');
    if (overlay) overlay.classList.add('visible');
  }

  _showIterativeOverlay(show) {
    const overlay = document.getElementById('iterative-write-overlay');
    if (overlay) {
      if (show) {
        overlay.classList.add('visible');
      } else {
        overlay.classList.remove('visible');
      }
    }
  }

  _updateIterativePhase(text) {
    const el = document.getElementById('iterative-phase-label');
    if (el) el.textContent = text;
  }

  _updateIterativeScore(score, isCurrent) {
    const numEl = document.getElementById('iterative-score-value');
    const pctEl = document.getElementById('iterative-score-pct');
    const fillEl = document.getElementById('iterative-progress-fill');
    const labelEl = document.getElementById('iterative-score-label');

    if (score === null || score === undefined) {
      if (numEl) { numEl.textContent = '--'; numEl.className = 'iterative-score-number'; }
      if (pctEl) pctEl.textContent = '0%';
      if (fillEl) { fillEl.style.width = '0%'; fillEl.className = 'iterative-progress-fill'; }
      if (labelEl) labelEl.textContent = 'Score / 100';
      return;
    }

    const scoreClass = score >= 88 ? 'score-excellent' : score >= 78 ? 'score-good' :
                       score >= 65 ? 'score-fair' : 'score-poor';

    if (numEl) { numEl.textContent = score; numEl.className = 'iterative-score-number ' + scoreClass; }
    if (pctEl) pctEl.textContent = score + '%';
    if (fillEl) { fillEl.style.width = score + '%'; fillEl.className = 'iterative-progress-fill ' + scoreClass; }
    if (labelEl) labelEl.textContent = isCurrent ? 'Current Score / 100' : 'Score / 100';
  }

  _updateIterativeIteration(iteration, bestScore) {
    const numEl = document.getElementById('iterative-iteration-num');
    const bestEl = document.getElementById('iterative-best-score');
    if (numEl) numEl.textContent = iteration;
    if (bestEl) bestEl.textContent = bestScore > 0 ? bestScore : '--';
  }

  /**
   * Record a score for a specific iteration and display the score history.
   */
  _recordIterationScore(iteration, score) {
    if (!this._iterationScoreHistory) this._iterationScoreHistory = [];
    this._iterationScoreHistory.push({ iteration, score });
    this._renderScoreHistory();
  }

  _resetScoreHistory() {
    this._iterationScoreHistory = [];
    const histEl = document.getElementById('iterative-score-history');
    if (histEl) {
      histEl.style.display = 'none';
      histEl.innerHTML = '';
    }
  }

  _renderScoreHistory() {
    const histEl = document.getElementById('iterative-score-history');
    if (!histEl || !this._iterationScoreHistory || this._iterationScoreHistory.length === 0) return;
    histEl.style.display = 'block';
    const entries = this._iterationScoreHistory.map(h => {
      const cls = h.score >= 88 ? 'color:var(--success)' : h.score >= 78 ? 'color:var(--accent-primary)' :
                  h.score >= 65 ? 'color:var(--warning)' : 'color:var(--danger)';
      return `<span style="${cls};font-weight:600;">Iter ${h.iteration}: ${h.score}</span>`;
    });
    histEl.innerHTML = entries.join(' &bull; ');
  }

  _updateIterativeLog(message) {
    const logEl = document.getElementById('iterative-status-log');
    if (logEl) {
      logEl.textContent += '\n' + message;
      logEl.scrollTop = logEl.scrollHeight;
    }
  }

  _updateFourRequirementsDisplay(fourReqs) {
    const container = document.getElementById('iterative-four-reqs');
    if (!container) return;
    container.style.display = 'block';

    const items = {
      'four-req-thought': fourReqs?.characterSpecificThought,
      'four-req-observation': fourReqs?.preciseObservation,
      'four-req-musical': fourReqs?.musicalSentence,
      'four-req-break': fourReqs?.expectationBreak
    };

    for (const [id, value] of Object.entries(items)) {
      const el = document.getElementById(id);
      if (!el) continue;
      if (value) {
        el.style.color = 'var(--success, #28a745)';
        el.textContent = '\u25CF ' + el.textContent.replace(/^[\u25CB\u25CF]\s*/, '');
      } else {
        el.style.color = 'var(--text-muted)';
        el.textContent = '\u25CB ' + el.textContent.replace(/^[\u25CB\u25CF]\s*/, '');
      }
    }
  }

  _showIterativeScoringNotice(show) {
    const el = document.getElementById('iterative-scoring-notice');
    if (el) {
      if (show) {
        el.classList.add('visible');
      } else {
        el.classList.remove('visible');
      }
    }
  }

  _updateIterativeChunk(num) {
    const el = document.getElementById('iterative-chunk-num');
    if (el) el.textContent = num;
  }

  _showProseReview(review, generatedText) {
    const body = document.getElementById('prose-review-body');
    if (!body) return;

    const scoreClass = review.score >= 88 ? 'score-excellent' :
                       review.score >= 78 ? 'score-good' :
                       review.score >= 65 ? 'score-fair' : 'score-poor';

    // Score comparison for rewrites
    let scoreComparisonHtml = '';
    if (review._previousScore != null) {
      const delta = review.score - review._previousScore;
      const deltaSign = delta > 0 ? '+' : '';
      const deltaColor = delta > 0 ? 'var(--success)' : delta < 0 ? 'var(--danger)' : 'var(--text-muted)';
      scoreComparisonHtml = `<div style="font-size:0.8rem;color:${deltaColor};margin-top:4px;">
        ${deltaSign}${delta} from previous (${review._previousScore}) &mdash; Rewrite #${review._rewriteIteration || 1}
      </div>`;
    }

    // Convergence warning
    let convergenceHtml = '';
    if (review._convergenceWarning) {
      convergenceHtml = `<div style="background:var(--warning-bg, rgba(255,193,7,0.15));border:1px solid var(--warning, #ffc107);border-radius:var(--radius-sm);padding:10px;margin:12px 0;font-size:0.85rem;">
        <strong>Diminishing returns detected.</strong> The score has not improved meaningfully after ${review._rewriteIteration} rewrites. This prose may be near its optimization ceiling for AI-assisted fixes. Consider accepting the prose or making manual edits.
      </div>`;
    }
    if (review._scoreDecreased) {
      const revertNote = review._revertedToPrevious
        ? ' <strong>The previous (higher-scoring) version has been automatically restored.</strong>'
        : '';
      convergenceHtml = `<div style="background:var(--danger-bg, rgba(220,53,69,0.15));border:1px solid var(--danger, #dc3545);border-radius:var(--radius-sm);padding:10px;margin:12px 0;font-size:0.85rem;">
        <strong>Score decreased after rewrite.</strong> The rewrite introduced new issues while fixing old ones.${revertNote} Consider accepting the prose and making targeted manual edits for remaining issues.
      </div>`;
    }

    // Threshold comparison
    const qualityThreshold = review._qualityThreshold || this._currentProject?.qualityThreshold || 90;
    let thresholdHtml = '';
    if (qualityThreshold) {
      const meetsThreshold = review.score >= qualityThreshold;
      thresholdHtml = `<div style="font-size:0.8rem;margin-top:6px;color:${meetsThreshold ? 'var(--success, #28a745)' : 'var(--danger, #dc3545)'};">
        ${meetsThreshold ? 'Meets' : 'Below'} threshold: ${review.score}/${qualityThreshold}
      </div>`;
    }

    let html = `
      <div class="prose-score-display">
        <div class="prose-score-number ${scoreClass}">${review.score}</div>
        <div class="prose-score-label">${this._esc(review.label || '')} / 100</div>
        ${scoreComparisonHtml}
        ${thresholdHtml}
        <div class="meter" style="margin-top:12px;max-width:200px;margin-left:auto;margin-right:auto;">
          <div class="meter-fill ${review.score >= 70 ? 'good' : review.score >= 50 ? 'warning' : 'danger'}" style="width:${review.score}%"></div>
        </div>
      </div>
      ${convergenceHtml}`;

    // Sub-scores breakdown
    if (review.subscores) {
      const subScoreLabels = {
        sentenceVariety: { label: 'Sentence Variety & Rhythm', max: 15 },
        dialogueAuthenticity: { label: 'Dialogue Authenticity', max: 15 },
        sensoryDetail: { label: 'Sensory Detail / Show vs Tell', max: 15 },
        emotionalResonance: { label: 'Emotional Resonance & Depth', max: 15 },
        vocabularyPrecision: { label: 'Vocabulary Precision', max: 10 },
        narrativeFlow: { label: 'Narrative Flow & Pacing', max: 10 },
        originalityVoice: { label: 'Originality & Voice', max: 10 },
        technicalExecution: { label: 'Technical Execution', max: 10 }
      };
      html += `<div class="prose-subscores">`;
      for (const [key, info] of Object.entries(subScoreLabels)) {
        const val = review.subscores[key] ?? 0;
        const pct = Math.round((val / info.max) * 100);
        const barClass = pct >= 80 ? 'good' : pct >= 55 ? 'warning' : 'danger';
        html += `
          <div class="prose-subscore-row">
            <span class="prose-subscore-label">${info.label}</span>
            <span class="prose-subscore-value">${val}/${info.max}</span>
            <div class="prose-subscore-bar"><div class="meter-fill ${barClass}" style="width:${pct}%"></div></div>
          </div>`;
      }
      html += `</div>`;
    }

    html += `<p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:16px;">${this._esc(review.summary || '')}</p>`;

    if (review.aiPatterns && review.aiPatterns.length > 0) {
      const totalAiImpact = review.aiPatterns.reduce((s, p) => s + (p.estimatedImpact || 0), 0);
      html += `<h3 style="font-size:0.85rem;font-weight:600;color:var(--danger);margin-bottom:8px;">AI Patterns Detected${totalAiImpact > 0 ? ` <span class="prose-impact-badge">fixing could add ~${totalAiImpact} pts</span>` : ''}</h3>
        <ul class="prose-patterns-list">
          ${review.aiPatterns.map(p => `
            <li class="prose-pattern-item">
              <strong>${this._esc(p.pattern)}</strong>${p.estimatedImpact ? ` <span class="prose-impact-inline">+${p.estimatedImpact}</span>` : ''}
              ${p.examples && p.examples.length > 0 ? `<br><span style="font-size:0.8rem;color:var(--text-muted);">"${this._esc(p.examples[0])}"</span>` : ''}
            </li>
          `).join('')}
        </ul>`;
    }

    // Separate issues by severity
    const highIssues = (review.issues || []).filter(i => i.severity === 'high');
    const mediumIssues = (review.issues || []).filter(i => i.severity === 'medium');
    const lowIssues = (review.issues || []).filter(i => i.severity === 'low');
    const hasIssues = highIssues.length > 0 || mediumIssues.length > 0 || lowIssues.length > 0;

    if (hasIssues) {
      const totalHighImpact = highIssues.reduce((s, i) => s + (i.estimatedImpact || 0), 0);
      const totalMedImpact = mediumIssues.reduce((s, i) => s + (i.estimatedImpact || 0), 0);
      const totalLowImpact = lowIssues.reduce((s, i) => s + (i.estimatedImpact || 0), 0);
      const totalAllImpact = totalHighImpact + totalMedImpact + totalLowImpact;

      html += `<h3 style="font-size:0.85rem;font-weight:600;color:var(--text-secondary);margin-top:16px;margin-bottom:8px;">Quality Issues (${review.issues.length})${totalAllImpact > 0 ? ` <span class="prose-impact-badge">fixing all could add ~${totalAllImpact} pts</span>` : ''}</h3>`;

      // Filter toggle buttons
      html += `<div class="prose-filter-bar">
        <button class="prose-filter-btn active" data-filter="all">All (${review.issues.length})</button>
        <button class="prose-filter-btn prose-filter-high" data-filter="high">Serious (${highIssues.length})${totalHighImpact > 0 ? ` +${totalHighImpact}` : ''}</button>
        <button class="prose-filter-btn prose-filter-medium" data-filter="medium">Moderate (${mediumIssues.length})${totalMedImpact > 0 ? ` +${totalMedImpact}` : ''}</button>
        <button class="prose-filter-btn prose-filter-low" data-filter="low">Minor (${lowIssues.length})${totalLowImpact > 0 ? ` +${totalLowImpact}` : ''}</button>
      </div>`;

      html += `<ul class="prose-issues-list">
          ${review.issues.map(issue => `
            <li class="prose-issue-item severity-${issue.severity || 'medium'}" data-severity="${issue.severity || 'medium'}">
              <strong>${this._esc(issue.problem || '')}</strong>${issue.estimatedImpact ? ` <span class="prose-impact-inline">+${issue.estimatedImpact}</span>` : ''}${issue.category ? ` <span class="prose-category-tag">${this._esc(issue.category)}</span>` : ''}
              ${issue.text ? `<br><span style="font-size:0.8rem;color:var(--text-muted);">"${this._esc(issue.text)}"</span>` : ''}
            </li>
          `).join('')}
        </ul>`;
    }

    if (!hasIssues && (!review.aiPatterns || review.aiPatterns.length === 0)) {
      html += `<p style="color:var(--success);font-size:0.9rem;text-align:center;margin-top:16px;">No major issues detected. The prose quality is solid.</p>`;
    }

    body.innerHTML = html;

    // Wire up severity filter buttons
    body.querySelectorAll('.prose-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        body.querySelectorAll('.prose-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const filter = btn.dataset.filter;
        body.querySelectorAll('.prose-issue-item').forEach(item => {
          if (filter === 'all') {
            item.style.display = '';
          } else {
            item.style.display = item.dataset.severity === filter ? '' : 'none';
          }
        });
      });
    });

    // Store for rewrite action
    this._lastProseReview = review;
    this._lastGeneratedText = generatedText;

    // Show rewrite buttons based on issue severity
    const hasAnyIssues = review.issues?.length > 0 || review.aiPatterns?.length > 0;
    const hasHighIssues = (review.issues || []).some(i => i.severity === 'high') || review.aiPatterns?.length > 0;

    const rewriteBtn = document.getElementById('btn-prose-review-rewrite');
    if (rewriteBtn) {
      rewriteBtn.style.display = hasAnyIssues ? '' : 'none';
    }

    const rewriteSeriousBtn = document.getElementById('btn-prose-review-rewrite-serious');
    if (rewriteSeriousBtn) {
      rewriteSeriousBtn.style.display = hasHighIssues ? '' : 'none';
    }

    const overlay = document.getElementById('prose-review-overlay');
    if (overlay) overlay.classList.add('visible');
  }

  async _rewriteProblems(userInstructions, severityFilter) {
    if (!this._lastProseReview || !this._lastGeneratedText) return;

    const review = this._lastProseReview;
    const problems = [];

    // Always include AI patterns — these are high-priority
    if (review.aiPatterns) {
      for (const p of review.aiPatterns) {
        problems.push({
          text: p.examples?.[0] || '',
          description: `AI Pattern: ${p.pattern}`,
          impact: p.estimatedImpact || 3,
          severity: 'high',
          category: 'ai-pattern'
        });
      }
    }

    // Filter and collect issues — NEVER include low-severity issues in rewrites
    // Low-severity fixes almost always introduce new problems that outweigh the benefit
    if (review.issues) {
      for (const issue of review.issues) {
        // Skip low-severity issues entirely — they cause more harm than good
        if (issue.severity === 'low') continue;

        if (severityFilter === 'high' && issue.severity !== 'high') continue;

        problems.push({
          text: issue.text || '',
          description: issue.problem || '',
          impact: issue.estimatedImpact || 1,
          severity: issue.severity,
          category: issue.category || 'other'
        });
      }
    }

    // Sort by estimated impact (highest first) so the most valuable fixes are prioritized
    problems.sort((a, b) => b.impact - a.impact);

    // Cap at 10 issues per rewrite pass to prevent the AI from being overwhelmed
    // Trying to fix too many issues at once is the primary cause of score degradation
    const MAX_ISSUES_PER_PASS = 10;
    const cappedProblems = problems.slice(0, MAX_ISSUES_PER_PASS);

    // Format problems as precise, actionable instructions
    const formattedProblems = cappedProblems.map(p => {
      if (p.text) {
        return `FIND: "${p.text}" → PROBLEM: ${p.description} [${p.severity}, ~${p.impact} pts]`;
      }
      return `${p.description} [${p.severity}, ~${p.impact} pts]`;
    });

    if (formattedProblems.length === 0 && !userInstructions) return;

    // Track rewrite iterations for convergence detection
    this._rewriteIteration = (this._rewriteIteration || 0) + 1;
    const previousScore = review.score;
    const previousSubscores = review.subscores;
    const previousIssueCount = (review.issues?.length || 0) + (review.aiPatterns?.length || 0);

    // Store previous text so we can revert if score drops
    this._previousRewriteText = this._lastGeneratedText;
    this._previousRewriteScore = previousScore;
    this._previousRewriteIssueCount = previousIssueCount;

    // Close review modal
    document.getElementById('prose-review-overlay').classList.remove('visible');

    this._showContinueBar(false);
    this._setGenerateStatus(true);

    // Roll back the editor to the content before the last generation
    const baseContent = this._preGenerationContent || '';
    const editorEl = this.editor.element;
    editorEl.innerHTML = baseContent;

    // Gather context for the rewrite
    const characters = this._lastGenSettings?.useCharacters
      ? await this.localStorage.getProjectCharacters(this.state.currentProjectId)
      : [];

    let notes = '';
    if (this._lastGenSettings?.useNotes && this.state.currentProjectId) {
      const projectNotes = await this.localStorage.getProjectNotes(this.state.currentProjectId);
      if (projectNotes.length > 0) {
        notes = projectNotes.map(n => {
          let entry = n.title;
          if (n.type && n.type !== 'general') entry = `[${n.type}] ${entry}`;
          if (n.content) entry += '\n' + n.content;
          return entry;
        }).join('\n\n');
      }
    }

    // Append project knowledge base as reference materials
    const knowledgePromptRewrite = await this._getProjectKnowledge();
    if (knowledgePromptRewrite) {
      notes = notes ? notes + '\n\n' + knowledgePromptRewrite : knowledgePromptRewrite;
    }

    let chapterTitle = '';
    if (this.state.currentChapterId) {
      try {
        const chapter = await this.fs.getChapter(this.state.currentChapterId);
        if (chapter) chapterTitle = chapter.title;
      } catch (_) {}
    }

    const project = this._currentProject;
    const genreInfo = this._getGenreRules(project?.genre, project?.subgenre);

    let streamedText = '';

    await this.generator.rewriteProse(
      {
        originalProse: this._lastGeneratedText,
        problems: formattedProblems,
        userInstructions: userInstructions || '',
        chapterTitle,
        characters,
        notes,
        chapterOutline: this._currentChapterOutline || '',
        aiInstructions: project?.aiInstructions || '',
        tone: this._lastGenSettings?.tone || '',
        style: this._lastGenSettings?.style || '',
        wordTarget: this._lastGenSettings?.wordTarget || 1000,
        genre: genreInfo?.label || '',
        genreRules: genreInfo?.rules || '',
        voice: project?.voice || '',
        previousScore,
        previousSubscores,
        rewriteIteration: this._rewriteIteration,
        errorPatternsPrompt: this._cachedErrorPatternsPrompt || ''
      },
      {
        onChunk: (text) => {
          streamedText += text;
          streamedText = this._stripEmDashes(streamedText);
          const startingContent = baseContent.trim() ? baseContent : '';
          const paragraphs = streamedText.split('\n\n');
          const newHtml = paragraphs
            .map(p => {
              const lines = p.replace(/\n/g, '<br>');
              return `<p>${lines}</p>`;
            })
            .join('');
          editorEl.innerHTML = startingContent + newHtml;
          const container = editorEl.closest('.editor-area');
          if (container) container.scrollTop = container.scrollHeight;
          // Update word count live
          const wc = editorEl.textContent.match(/[a-zA-Z'''\u2019-]+/g) || [];
          const chapterWords = wc.length;
          const wordsEl = document.getElementById('status-words');
          if (wordsEl) wordsEl.textContent = chapterWords.toLocaleString();
          const fwcWords = document.getElementById('fwc-words');
          if (fwcWords) fwcWords.textContent = chapterWords.toLocaleString();
          this._updateLocalWordCounts(editorEl.innerHTML);
          this._trackDailyWords(chapterWords);
        },
        onDone: async () => {
          this._setGenerateStatus(false);
          const content = this.editor.getContent();
          if (this.state.currentChapterId) {
            try {
              await this.fs.updateChapter(this.state.currentChapterId, { content });
            } catch (_) {}
            this._updateLocalWordCounts(content);
          }

          // Re-score the rewritten prose with rewrite context
          if (streamedText && streamedText.length > 100) {
            this._scoreProseAfterRewrite(streamedText, previousScore, previousIssueCount, previousSubscores);
          }

          this._showContinueBar(true);
        },
        onError: (err) => {
          this._setGenerateStatus(false);
          alert('Rewrite failed: ' + err.message);
        }
      }
    );
  }

  _openProseRethinkModal() {
    if (!this._lastGeneratedText) {
      alert('No generated prose to rethink.');
      return;
    }

    // Close the prose review modal
    document.getElementById('prose-review-overlay')?.classList.remove('visible');

    document.getElementById('prose-rethink-prompt').value = '';
    document.getElementById('prose-rethink-status').style.display = 'none';
    document.getElementById('btn-prose-rethink-submit').disabled = false;
    const overlay = document.getElementById('prose-rethink-overlay');
    if (overlay) overlay.classList.add('visible');
  }

  async _submitProseRethink() {
    const userInstructions = document.getElementById('prose-rethink-prompt')?.value?.trim();
    if (!userInstructions) {
      alert('Please enter instructions for how to revise the prose.');
      return;
    }

    // Show spinner and disable button
    document.getElementById('prose-rethink-status').style.display = '';
    document.getElementById('btn-prose-rethink-submit').disabled = true;

    // Close the modal
    document.getElementById('prose-rethink-overlay')?.classList.remove('visible');

    // Rewrite with user instructions (problems from last review are also included)
    await this._rewriteProblems(userInstructions);
  }

  // ========================================
  //  Welcome Screen
  // ========================================

  _showWelcome() {
    const overlay = document.getElementById('welcome-overlay');
    const editorEl = document.getElementById('editor');
    if (overlay) overlay.style.display = '';
    if (editorEl) editorEl.style.display = 'none';
    this._hideChapterOutlinePopup();
    document.getElementById('project-title').textContent = 'Genesis 2';
  }

  _hideWelcome() {
    const overlay = document.getElementById('welcome-overlay');
    const editorEl = document.getElementById('editor');
    if (overlay) overlay.style.display = 'none';
    if (editorEl) editorEl.style.display = '';
  }

  // ========================================
  //  Event Binding
  // ========================================

  // Landing page events — bound early before async init so the
  // splash screen is always interactive even if later steps fail.
  _bindLandingEvents() {
    // User list clicks
    document.getElementById('user-list')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.user-btn');
      if (btn) this._selectUser(btn.dataset.name);
    });

    // New user input
    document.getElementById('btn-user-continue')?.addEventListener('click', () => {
      const name = document.getElementById('new-user-name')?.value?.trim();
      if (name) this._selectUser(name);
    });
    document.getElementById('new-user-name')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const name = e.target.value?.trim();
        if (name) this._selectUser(name);
      }
    });

    // Switch user
    document.getElementById('btn-change-user')?.addEventListener('click', () => {
      window.localStorage.removeItem('genesis2_userName');
      this.state.currentUser = null;
      this._showUserSelection();
    });

    // Create project
    document.getElementById('btn-create-project')?.addEventListener('click', () => {
      this._createNewProject();
    });

    // --- Chapter Outline Popup buttons ---
    document.getElementById('btn-ch-outline-close')?.addEventListener('click', () => {
      this._hideChapterOutlinePopup();
    });
    document.getElementById('btn-ch-outline-accept')?.addEventListener('click', () => {
      this._acceptChapterOutline();
    });
    document.getElementById('btn-ch-outline-rethink')?.addEventListener('click', () => {
      const area = document.getElementById('ch-outline-rethink-area');
      if (area) {
        area.style.display = area.style.display === 'none' ? '' : 'none';
        const prompt = document.getElementById('ch-outline-rethink-prompt');
        if (prompt) { prompt.value = ''; prompt.focus(); }
      }
    });
    document.getElementById('btn-ch-outline-rethink-submit')?.addEventListener('click', () => {
      this._submitChapterOutlineRethink();
    });
    // Close popup when clicking the dark backdrop
    document.getElementById('ch-outline-popup')?.addEventListener('click', (e) => {
      if (e.target.id === 'ch-outline-popup') this._hideChapterOutlinePopup();
    });

    // Import project — landing page
    document.getElementById('btn-import-project-landing')?.addEventListener('click', () => {
      document.getElementById('import-project-file-landing')?.click();
    });
    document.getElementById('import-project-file-landing')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (file) await this._handleImportProject(file);
      e.target.value = '';
    });

    // Import project — sidebar
    document.getElementById('btn-import-project-sidebar')?.addEventListener('click', () => {
      document.getElementById('import-project-file-sidebar')?.click();
    });
    document.getElementById('import-project-file-sidebar')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (file) await this._handleImportProject(file);
      e.target.value = '';
    });

    // New project modal events
    document.getElementById('btn-new-project-accept')?.addEventListener('click', () => {
      this._submitNewProject();
    });
    document.getElementById('btn-new-project-cancel')?.addEventListener('click', () => {
      document.getElementById('new-project-overlay')?.classList.remove('visible');
    });
    document.getElementById('new-project-title')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._submitNewProject();
    });

    // Project card clicks (event delegation on both lists)
    const handleProjectClick = (e) => {
      const card = e.target.closest('.project-card');
      if (card) this._openProject(card.dataset.id);
    };
    document.getElementById('my-projects-list')?.addEventListener('click', handleProjectClick);
    document.getElementById('others-projects-list')?.addEventListener('click', handleProjectClick);

    // Back to Projects
    document.getElementById('btn-back-to-projects')?.addEventListener('click', () => this._showLanding());
    document.getElementById('btn-back-to-projects-sidebar')?.addEventListener('click', () => this._showLanding());
  }

  _bindEvents() {
    // --- App Events (landing events already bound in _bindLandingEvents) ---

    // --- Switch User ---
    document.getElementById('btn-switch-user-sidebar')?.addEventListener('click', () => this._switchUser());

    // --- Import Knowledge (sidebar) ---
    document.getElementById('btn-import-knowledge-sidebar')?.addEventListener('click', () => this._openImportKnowledgePanel());

    // --- Sidebar toggle ---
    document.getElementById('btn-sidebar-toggle')?.addEventListener('click', () => {
      this.state.sidebarOpen = !this.state.sidebarOpen;
      document.getElementById('app').classList.toggle('sidebar-collapsed', !this.state.sidebarOpen);
      document.querySelector('.sidebar')?.classList.toggle('mobile-open', this.state.sidebarOpen);
    });

    document.getElementById('btn-sidebar-toggle-mobile')?.addEventListener('click', () => {
      this.state.sidebarOpen = !this.state.sidebarOpen;
      document.getElementById('app').classList.toggle('sidebar-collapsed', !this.state.sidebarOpen);
      document.querySelector('.sidebar')?.classList.toggle('mobile-open', this.state.sidebarOpen);
    });

    // --- Focus mode ---
    const toggleFocus = () => {
      this.state.focusMode = !this.state.focusMode;
      document.getElementById('app').classList.toggle('focus-mode', this.state.focusMode);
      // Directly control exit button via JS — CSS selectors are unreliable on iPad Safari
      const exitBtn = document.getElementById('btn-exit-focus');
      if (exitBtn) exitBtn.style.display = this.state.focusMode ? 'flex' : 'none';
    };
    document.getElementById('btn-focus-mode')?.addEventListener('click', toggleFocus);
    document.getElementById('btn-exit-focus')?.addEventListener('click', toggleFocus);

    // --- Sidebar navigation tabs ---
    document.querySelectorAll('.sidebar-nav button').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const tab = e.target.dataset.tab;
        this.state.sidebarTab = tab;
        document.querySelectorAll('.sidebar-nav button').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');

        document.querySelectorAll('.sidebar-panel').forEach(p => p.style.display = 'none');
        const panel = document.getElementById('sidebar-' + tab);
        if (panel) panel.style.display = 'block';

        if (tab === 'characters') await this._renderCharactersList();
        if (tab === 'notes') await this._renderNotesList();
      });
    });

    // --- Sidebar content clicks (event delegation) ---
    document.querySelector('.sidebar-content')?.addEventListener('click', async (e) => {
      // Handle chapter checkbox clicks
      if (e.target.classList.contains('chapter-checkbox')) {
        e.stopPropagation();
        this._updateDeleteSelectedBtn();
        return;
      }

      // Handle Select All checkbox
      if (e.target.id === 'chapter-select-all') {
        e.stopPropagation();
        this._toggleSelectAll(e.target.checked);
        return;
      }

      // Handle Delete Selected button
      if (e.target.id === 'btn-delete-selected-chapters' || e.target.closest('#btn-delete-selected-chapters')) {
        e.stopPropagation();
        await this._deleteSelectedChapters();
        return;
      }

      // Handle Accept Chapter Outline button
      if (e.target.id === 'btn-accept-chapter-outline' || e.target.closest('#btn-accept-chapter-outline')) {
        e.stopPropagation();
        this._showAcceptOutlineConfirmation();
        return;
      }

      // Handle chapter delete button (inline × or from menu)
      const deleteBtn = e.target.closest('.chapter-delete-btn') || e.target.closest('[data-delete-chapter]');
      if (deleteBtn) {
        e.stopPropagation();
        const chapterId = deleteBtn.dataset.deleteChapter;
        if (chapterId) {
          this._closeChapterMenus();
          await this._deleteChapter(chapterId);
        }
        return;
      }

      // Handle chapter menu button (⋮)
      const menuBtn = e.target.closest('.chapter-menu-btn');
      if (menuBtn) {
        e.stopPropagation();
        const chapterId = menuBtn.dataset.chapterMenu;
        const menu = document.querySelector(`.chapter-menu[data-menu-for="${chapterId}"]`);
        if (menu) {
          const wasOpen = menu.classList.contains('open');
          this._closeChapterMenus();
          if (!wasOpen) menu.classList.add('open');
        }
        return;
      }

      // Handle merge up
      const mergeUpBtn = e.target.closest('[data-merge-up]');
      if (mergeUpBtn) {
        e.stopPropagation();
        this._closeChapterMenus();
        await this._mergeChapter(mergeUpBtn.dataset.mergeUp, 'up');
        return;
      }

      // Handle merge down
      const mergeDownBtn = e.target.closest('[data-merge-down]');
      if (mergeDownBtn) {
        e.stopPropagation();
        this._closeChapterMenus();
        await this._mergeChapter(mergeDownBtn.dataset.mergeDown, 'down');
        return;
      }

      const treeItem = e.target.closest('.tree-item');
      const addBtn = e.target.closest('.tree-add');
      const charCard = e.target.closest('.character-card');

      if (treeItem) {
        const type = treeItem.dataset.type;
        const id = treeItem.dataset.id;

        if (type === 'chapter') {
          await this._loadChapter(id);
        } else if (type === 'note') {
          await this._openNoteEditor(id);
        }
      }

      if (charCard) {
        await this._openCharacterEditor(charCard.dataset.id);
      }

      if (addBtn) {
        const action = addBtn.dataset.action;
        if (action === 'add-chapter') {
          if (!this.state.currentProjectId) return;
          const chapters = await this.fs.getProjectChapters(this.state.currentProjectId);
          const nextNum = chapters.length + 1;
          const title = await this._prompt('Chapter Title', `Chapter ${nextNum}`);
          if (title) {
            try {
              const ch = await this.fs.createChapter({
                projectId: this.state.currentProjectId,
                chapterNumber: nextNum,
                title
              });
              this._chapterWordCounts[ch.id] = 0;
              await this._renderChapterList();
              await this.renderChapterNav();
              await this._loadChapter(ch.id);
            } catch (err) {
              console.error('Failed to create chapter:', err);
            }
          }
        } else if (action === 'add-character') {
          const name = await this._prompt('Character Name', 'New Character');
          if (name && this.state.currentProjectId) {
            await this.manuscript.createCharacter(this.state.currentProjectId, { name });
            await this._renderCharactersList();
          }
        } else if (action === 'add-note') {
          const title = await this._prompt('Note Title', 'New Note');
          if (title && this.state.currentProjectId) {
            await this.manuscript.createNote(this.state.currentProjectId, { title });
            await this._renderNotesList();
          }
        }
      }
    });

    // Close chapter menus on click outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.chapter-menu-btn') && !e.target.closest('.chapter-menu')) {
        this._closeChapterMenus();
      }
    });

    // --- Toolbar buttons ---
    // Use mousedown + preventDefault to keep editor focus/selection when clicking toolbar
    const toolbarButtons = [
      ['btn-bold', () => this.editor.bold()],
      ['btn-italic', () => this.editor.italic()],
      ['btn-heading', () => {
        // Cycle: paragraph → H1 → H2 → H3 → paragraph
        const sel = window.getSelection();
        const block = sel?.anchorNode?.nodeType === 3
          ? sel.anchorNode.parentElement
          : sel?.anchorNode;
        const tag = block?.closest('h1,h2,h3,p,div')?.tagName || '';
        if (tag === 'H1') this.editor.insertHeading(2);
        else if (tag === 'H2') this.editor.insertHeading(3);
        else if (tag === 'H3') this.editor.insertParagraph();
        else this.editor.insertHeading(1);
      }],
      ['btn-code', () => this.editor.toggleCode()],
      ['btn-blockquote', () => this.editor.insertBlockquote()],
      ['btn-scene-break', () => this.editor.insertSceneBreak()],
    ];
    for (const [id, handler] of toolbarButtons) {
      const btn = document.getElementById(id);
      if (btn) {
        btn.addEventListener('mousedown', (e) => e.preventDefault());
        btn.addEventListener('click', handler);
      }
    }
    document.getElementById('btn-undo')?.addEventListener('click', () => this.editor.undo());
    document.getElementById('btn-redo')?.addEventListener('click', () => this.editor.redo());

    // --- Help button ---
    document.getElementById('btn-help')?.addEventListener('click', () => {
      const overlay = document.getElementById('help-features-overlay');
      if (overlay) overlay.classList.add('visible');
    });
    document.getElementById('btn-help-close')?.addEventListener('click', () => {
      const overlay = document.getElementById('help-features-overlay');
      if (overlay) overlay.classList.remove('visible');
    });

    // --- Panel buttons ---
    document.getElementById('btn-analysis')?.addEventListener('click', () => this.openAnalysisPanel());
    document.getElementById('btn-book-structure')?.addEventListener('click', () => this.openSetupBookModal('book'));

    // --- Setup Book Modal: close button and overlay click ---
    document.getElementById('btn-close-setup-book')?.addEventListener('click', () => this._closeSetupBookModal());
    document.getElementById('setup-book-overlay')?.addEventListener('click', (e) => {
      if (e.target.id === 'setup-book-overlay') this._closeSetupBookModal();
    });

    // Outline Review popup: close on overlay click
    document.getElementById('outline-review-overlay')?.addEventListener('click', (e) => {
      if (e.target.id === 'outline-review-overlay') {
        document.getElementById('outline-review-overlay')?.classList.remove('visible');
      }
    });

    // Rethink Comments popup: close on overlay click
    document.getElementById('rethink-comments-overlay')?.addEventListener('click', (e) => {
      if (e.target.id === 'rethink-comments-overlay') {
        document.getElementById('rethink-comments-overlay')?.classList.remove('visible');
      }
    });

    // --- Setup Book Modal: tab switching ---
    document.querySelectorAll('.setup-tab').forEach(tab => {
      tab.addEventListener('click', () => this._switchSetupTab(tab.dataset.setupTab));
    });

    // --- Setup Book Modal: Genre change updates subgenre dropdown ---
    document.getElementById('bs-genre')?.addEventListener('change', (e) => {
      const genreId = e.target.value;
      const subgenreGroup = document.getElementById('bs-subgenre-group');
      const subgenreEl = document.getElementById('bs-subgenre');
      if (genreId && subgenreEl) {
        subgenreGroup.style.display = '';
        let html = '<option value="">-- None (use main genre rules) --</option>';
        html += this._getSubgenreOptions(genreId, '');
        subgenreEl.innerHTML = html;
      } else if (subgenreGroup) {
        subgenreGroup.style.display = 'none';
      }
    });

    // --- Error Database (from Settings tab) ---
    document.getElementById('btn-error-database-popup')?.addEventListener('click', () => {
      this._closeSetupBookModal();
      this.openErrorDatabasePanel();
    });

    // Translation language selection — SINGLE SELECT (radio behavior with checkboxes)
    const translationLangs = ['spanish', 'french', 'italian', 'german', 'portuguese', 'japanese'];
    for (const lang of translationLangs) {
      const cb = document.getElementById(`bs-translate-${lang}`);
      if (cb) {
        cb.addEventListener('change', () => {
          if (cb.checked) {
            // Uncheck all others — only one language at a time
            for (const otherLang of translationLangs) {
              if (otherLang !== lang) {
                const otherCb = document.getElementById(`bs-translate-${otherLang}`);
                if (otherCb) otherCb.checked = false;
              }
            }
          }
          this._updateTranslateButton();
        });
      }
    }

    // --- Translation split view ---
    document.getElementById('btn-close-split')?.addEventListener('click', () => {
      this._closeTranslationSplitView();
    });

    document.getElementById('btn-export-translation-docx')?.addEventListener('click', async () => {
      await this._exportTranslationDocx();
    });

    // Compare with Original button (visible only for translated chapters)
    document.getElementById('btn-compare-current')?.addEventListener('click', async () => {
      if (!this.state.currentChapterId) return;
      const currentChapter = await this.fs.getChapter(this.state.currentChapterId);
      if (currentChapter?.isTranslation) {
        await this._openComparisonFromChapter(currentChapter);
      }
    });

    // Close split view on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const overlay = document.getElementById('translation-split-view');
        if (overlay && overlay.style.display !== 'none') {
          this._closeTranslationSplitView();
        }
      }
    });

    // --- Export original manuscript DOCX ---
    document.getElementById('btn-export-original-docx')?.addEventListener('click', async () => {
      await this._exportFullManuscriptDocx(null);
    });

    // --- Chapter filter ---
    document.querySelectorAll('.chapter-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.chapter-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const filter = btn.dataset.filter;
        this._filterChapterList(filter);
      });
    });

    // --- Panel overlay close ---
    document.getElementById('panel-overlay')?.addEventListener('click', () => this._closeAllPanels());
    document.querySelectorAll('.panel-close').forEach(btn => {
      btn.addEventListener('click', () => this._closeAllPanels());
    });

    // --- Export panel actions ---
    document.getElementById('export-plain')?.addEventListener('click', async () => {
      if (!this.state.currentProjectId) return;
      const result = await this.exporter.exportPlainText(this.state.currentProjectId);
      this.exporter.download(result);
    });
    document.getElementById('export-manuscript')?.addEventListener('click', async () => {
      if (!this.state.currentProjectId) return;
      const result = await this.exporter.exportManuscriptFormat(this.state.currentProjectId);
      this.exporter.download(result);
    });
    document.getElementById('export-html')?.addEventListener('click', async () => {
      if (!this.state.currentProjectId) return;
      const result = await this.exporter.exportStyledHtml(this.state.currentProjectId);
      this.exporter.download(result);
    });
    document.getElementById('export-json')?.addEventListener('click', async () => {
      if (!this.state.currentProjectId) return;
      const result = await this.exporter.exportJson(this.state.currentProjectId);
      this.exporter.download(result);
    });

    // --- Welcome screen buttons ---
    document.addEventListener('click', async (e) => {
      if (e.target.id === 'btn-new-project' || e.target.closest('#btn-new-project')) {
        await this._createNewProject();
      }
      if (e.target.id === 'btn-import-project' || e.target.closest('#btn-import-project')) {
        document.getElementById('import-project-file')?.click();
      }
    });

    // --- Import project file handler ---
    document.getElementById('import-project-file')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (file) await this._handleImportProject(file);
      e.target.value = '';
    });

    // --- Book structure inputs (live update) ---
    document.addEventListener('input', (e) => {
      if (e.target.id === 'bs-total-words' || e.target.id === 'bs-num-chapters') {
        this._updateWordsPerChapter();
      }
    });

    // --- Settings panel dynamic events ---
    document.addEventListener('change', async (e) => {
      if (e.target.id === 'setting-theme') {
        this.state.theme = e.target.value;
        this._applyTheme(this.state.theme);
        await this.localStorage.setSetting('theme', this.state.theme);
      }
      if (e.target.id === 'bs-total-words' || e.target.id === 'bs-num-chapters') {
        this._updateWordsPerChapter();
      }
      if (e.target.id === 'structure-template-select') {
        await this.localStorage.setSetting('structureTemplate_' + this.state.currentProjectId, e.target.value);
        // Refresh the structure section within the Book Setup tab
        const container = document.getElementById('bs-structure-container');
        if (container && this._currentProject) {
          const totalWords = Object.values(this._chapterWordCounts).reduce((sum, wc) => sum + wc, 0);
          const templateId = e.target.value;
          const targetWords = this._currentProject.wordCountGoal || 80000;
          const guidance = this.structure.getPacingGuidance(templateId, targetWords, totalWords);
          const beats = this.structure.mapBeatsToManuscript(templateId, targetWords, totalWords);
          container.innerHTML = this._renderStructureInSettings(guidance, beats, this._currentProject, templateId);
        }
      }
      if (e.target.id === 'setting-project-genre') {
        const genreId = e.target.value;
        const subGroup = document.getElementById('subgenre-group');
        const subSelect = document.getElementById('setting-project-subgenre');
        if (subGroup && subSelect) {
          if (genreId) {
            subSelect.innerHTML = '<option value="">— None (use main genre rules) —</option>' + this._getSubgenreOptions(genreId, '');
            subGroup.style.display = '';
          } else {
            subSelect.innerHTML = '<option value="">— None (use main genre rules) —</option>';
            subGroup.style.display = 'none';
          }
        }
      }
      // New project modal genre change
      if (e.target.id === 'new-project-genre') {
        const genreId = e.target.value;
        const subGroup = document.getElementById('new-project-subgenre-group');
        const subSelect = document.getElementById('new-project-subgenre');
        if (subGroup && subSelect) {
          if (genreId) {
            subSelect.innerHTML = '<option value="">— None —</option>' + this._getSubgenreOptions(genreId, '');
            subGroup.style.display = '';
          } else {
            subSelect.innerHTML = '<option value="">— None —</option>';
            subGroup.style.display = 'none';
          }
        }
      }
    });

    document.addEventListener('click', async (e) => {
      if (e.target.id === 'btn-create-cover') {
        await this._generateCover(false);
      }
      if (e.target.id === 'btn-regenerate-cover') {
        await this._generateCover(true);
      }
      if (e.target.id === 'btn-edit-cover') {
        this.coverEditor?.open();
      }
      if (e.target.id === 'btn-knowledge-paste') {
        this._showKnowledgePasteArea();
      }
      if (e.target.id === 'btn-knowledge-file') {
        document.getElementById('knowledge-file-input')?.click();
      }
      if (e.target.id === 'btn-knowledge-save') {
        await this._saveKnowledge();
      }
      if (e.target.classList.contains('knowledge-delete-btn')) {
        const id = e.target.dataset.knowledgeId;
        if (id) await this._deleteKnowledge(id);
      }
      if (e.target.id === 'export-cover-download') {
        await this._downloadCover();
      }
      if (e.target.id === 'save-project-settings') {
        await this._saveProjectSettings();
      }
      if (e.target.id === 'btn-delete-project') {
        await this._deleteCurrentProject();
      }
      if (e.target.id === 'btn-export-json') {
        if (!this.state.currentProjectId) return;
        const result = await this.exporter.exportJson(this.state.currentProjectId);
        this.exporter.download(result);
      }
      if (e.target.id === 'api-key-unlock-btn') {
        const pin = document.getElementById('api-key-pin-input')?.value || '';
        const stored = localStorage.getItem('genesis-api-pin');
        if (pin === stored) {
          document.getElementById('api-key-locked').style.display = 'none';
          document.getElementById('api-key-unlocked').style.display = 'block';
          document.getElementById('api-key-pin-input').value = '';
        } else {
          alert('Incorrect PIN.');
        }
      }
      if (e.target.id === 'api-key-lock-btn') {
        const pin = document.getElementById('api-key-set-pin')?.value || '';
        if (!pin || pin.length < 4) {
          alert('PIN must be at least 4 characters.');
          return;
        }
        localStorage.setItem('genesis-api-pin', pin);
        alert('PIN set. API key is now protected.');
        await this.openSettingsPanel();
      }
      if (e.target.id === 'api-key-remove-pin') {
        localStorage.removeItem('genesis-api-pin');
        alert('PIN removed.');
        await this.openSettingsPanel();
      }
      if (e.target.id === 'save-api-settings') {
        const key = (document.getElementById('setting-api-key')?.value || '').trim();
        const model = document.getElementById('setting-ai-model')?.value || 'claude-sonnet-4-5-20250929';
        await this.generator.setApiKey(key);
        await this.generator.setModel(model);
        if (!key) {
          alert('AI model saved, but no API key was entered. Paste your key starting with "sk-ant-" and save again.');
        } else {
          alert('AI settings saved.');
        }
      }
      if (e.target.id === 'save-hf-settings') {
        const token = document.getElementById('setting-hf-token')?.value || '';
        this._hfToken = token;
        await this.localStorage.setSetting('hfToken', token);
        alert('Cover settings saved.');
      }
      // --- Book Structure events ---
      if (e.target.id === 'btn-save-book-structure') {
        await this._saveBookStructure();
      }
      if (e.target.id === 'btn-ai-populate-matter') {
        await this._aiPopulateMatter();
      }
      if (e.target.id === 'btn-perform-translation') {
        const bsLangs = ['spanish', 'french', 'italian', 'german', 'portuguese', 'japanese'];
        const checkedLangs = bsLangs.filter(lang => document.getElementById(`bs-translate-${lang}`)?.checked);
        if (checkedLangs.length > 0) {
          await this._performTranslation(checkedLangs);
        }
      }
      // --- New Project Help modal ---
      if (e.target.id === 'btn-help-create-project') {
        document.getElementById('new-project-help-overlay')?.classList.remove('visible');
        this._showNewProjectModal();
      }
      if (e.target.id === 'btn-generate-outlines') {
        await this._generateOutlines();
      }
      // --- Rethink events ---
      if (e.target.id === 'btn-continue-rethink' || e.target.closest('#btn-continue-rethink')) {
        await this._openRethinkModal();
      }
      if (e.target.id === 'btn-rethink-submit') {
        await this._submitRethink();
      }
      if (e.target.id === 'btn-rethink-cancel') {
        document.getElementById('rethink-overlay')?.classList.remove('visible');
      }
      // --- Outline Review popup events ---
      if (e.target.id === 'btn-outline-accept') {
        await this._acceptOutlines();
      }
      if (e.target.id === 'btn-outline-rethink') {
        this._openRethinkCommentsPopup();
      }
      if (e.target.id === 'btn-close-outline-review') {
        document.getElementById('outline-review-overlay')?.classList.remove('visible');
      }
      // --- Rethink Comments popup events ---
      if (e.target.id === 'btn-rethink-comments-submit') {
        await this._submitRethinkComments();
      }
      if (e.target.id === 'btn-rethink-comments-cancel') {
        document.getElementById('rethink-comments-overlay')?.classList.remove('visible');
      }
      // --- Prose Review events ---
      if (e.target.id === 'btn-prose-review-accept') {
        document.getElementById('prose-review-overlay')?.classList.remove('visible');
      }
      if (e.target.id === 'btn-prose-review-rewrite') {
        await this._rewriteProblems(null, 'all');
      }
      if (e.target.id === 'btn-prose-review-rewrite-serious') {
        await this._rewriteProblems(null, 'high');
      }
      if (e.target.id === 'btn-prose-review-rethink') {
        this._openProseRethinkModal();
      }
      if (e.target.id === 'btn-prose-rethink-submit') {
        await this._submitProseRethink();
      }
      if (e.target.id === 'btn-prose-rethink-cancel') {
        document.getElementById('prose-rethink-overlay')?.classList.remove('visible');
      }
      if (e.target.id === 'btn-save-ai-instructions') {
        const instructions = document.getElementById('generate-ai-instructions')?.value || '';
        if (this.state.currentProjectId) {
          await this.fs.updateProject(this.state.currentProjectId, { aiInstructions: instructions });
          this._currentProject = { ...this._currentProject, aiInstructions: instructions };
          alert('AI instructions saved.');
        }
      }
      // --- Accept Outline confirmation modal events ---
      if (e.target.id === 'btn-accept-outline-continue') {
        await this._acceptChapterOutlineAndGenerate();
      }
      if (e.target.id === 'btn-accept-outline-cancel') {
        document.getElementById('accept-outline-overlay')?.classList.remove('visible');
      }
      if (e.target.id === 'btn-generate-prose') {
        this._closeSetupBookModal();
        await this._runGeneration();
      }
      if (e.target.id === 'btn-generate-cancel') {
        this.generator.cancel();
        this._generateCancelled = true;
        this._autoWriteToGoal = false;
        this._setGenerateStatus(false);
        this._showIterativeOverlay(false);
        this._showIterativeScoringNotice(false);
        this._showContinueBar(true);
      }
      if (e.target.id === 'btn-iterative-write') {
        this._closeSetupBookModal();
        await this._iterativeWrite();
      }
      if (e.target.id === 'btn-iterative-cancel') {
        this._iterativeCancelled = true;
        this._generateCancelled = true;
        this.generator.cancel();
        this._showIterativeOverlay(false);
        this._showIterativeScoringNotice(false);
        this._setGenerateStatus(false);
        this._showContinueBar(true);
      }
      // Note: btn-iterative-accept and btn-iterative-accept-stop handlers are now
      // attached directly in _showFinalFixScreen() to avoid conflicts with the
      // dynamically generated footer buttons. Only handle legacy reject if present.
      if (e.target.id === 'btn-iterative-reject') {
        // Reject — keep refining the same paragraph
        document.getElementById('iterative-accept-overlay')?.classList.remove('visible');
        const logEl = document.getElementById('iterative-status-log');
        if (logEl) logEl.textContent = 'Continuing refinement\u2026';
        // Reset iteration tracking and continue refining
        this._iterPrevScore = 0;
        this._iterPrevIssueCount = 0;
        this._iterPrevSubscores = {};
        await this._iterativeScoreAndRefine(this._iterativeAcceptText || this._lastGeneratedText, 0, 0);
      }
      if (e.target.id === 'btn-generate-open-settings') {
        this._switchSetupTab('settings');
      }
      // Continue Writing word-count buttons (+1000, +2000, +3000)
      const continueBtn = e.target.closest('.continue-word-btn');
      if (continueBtn) {
        // Close prose review modal if the button was clicked from there
        document.getElementById('prose-review-overlay')?.classList.remove('visible');
        const wordTarget = parseInt(continueBtn.dataset.words) || 1000;
        await this._handleContinueWriting(wordTarget);
      }
      if (e.target.id === 'btn-continue-to-end' || e.target.closest('#btn-continue-to-end')) {
        await this._handleWriteToEnd();
      }
      if (e.target.id === 'btn-continue-dismiss' || e.target.closest('#btn-continue-dismiss')) {
        this._showContinueBar(false);
      }
    });

    // --- Auto-save on visibility change ---
    document.addEventListener('visibilitychange', async () => {
      if (document.hidden) {
        await this._saveCurrentChapter();
      }
    });

    // --- Before unload save ---
    window.addEventListener('beforeunload', () => {
      this._saveCurrentChapter();
      this._autoSaveSettingsKeys();
    });

    // --- Flyout Tooltip System ---
    this._initTooltips();
  }

  // ========================================
  //  Flyout Tooltip System
  // ========================================

  _initTooltips() {
    const flyout = document.getElementById('tooltip-flyout');
    if (!flyout) return;
    const body = flyout.querySelector('.tooltip-body');

    let touchTimer = null;
    let activeEl = null;
    let hoverTimer = null;

    const show = (el) => {
      const text = el.dataset.tooltip;
      if (!text) return;
      // Convert URLs in tooltip text to clickable links
      const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      body.innerHTML = escaped.replace(
        /(https?:\/\/[^\s<]+)/g,
        '<a href="$1" target="_blank" rel="noopener" style="color:var(--accent-primary);text-decoration:underline;">$1</a>'
      );
      flyout.className = 'visible';
      activeEl = el;

      // Position the tooltip relative to the element
      const rect = el.getBoundingClientRect();
      const fw = flyout.offsetWidth;
      const fh = flyout.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Horizontal: center on element, clamp to viewport
      let left = rect.left + rect.width / 2 - fw / 2;
      left = Math.max(8, Math.min(left, vw - fw - 8));

      // Arrow horizontal position
      const arrowX = Math.max(16, Math.min(rect.left + rect.width / 2 - left, fw - 16));
      flyout.style.setProperty('--arrow-x', arrowX + 'px');

      // Vertical: prefer below the element, flip above if not enough room
      const gap = 8;
      let top;
      if (rect.bottom + gap + fh < vh) {
        top = rect.bottom + gap;
        flyout.classList.add('arrow-top');
      } else {
        top = rect.top - gap - fh;
        flyout.classList.add('arrow-bottom');
      }
      top = Math.max(8, Math.min(top, vh - fh - 8));

      flyout.style.left = left + 'px';
      flyout.style.top = top + 'px';
    };

    const hide = () => {
      flyout.className = '';
      flyout.style.left = '';
      flyout.style.top = '';
      activeEl = null;
      overFlyout = false;
      clearTimeout(touchTimer);
      clearTimeout(hoverTimer);
    };

    // Touch: long-press (600ms hold) shows tooltip
    document.addEventListener('touchstart', (e) => {
      const el = e.target.closest('[data-tooltip]');
      if (!el) { hide(); return; }
      clearTimeout(touchTimer);
      touchTimer = setTimeout(() => {
        show(el);
        // Prevent the tap from also firing as a click
        el.addEventListener('click', preventClick, { once: true, capture: true });
      }, 600);
    }, { passive: true });

    const preventClick = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };

    document.addEventListener('touchend', () => {
      clearTimeout(touchTimer);
    }, { passive: true });

    document.addEventListener('touchmove', () => {
      clearTimeout(touchTimer);
    }, { passive: true });

    // Tap anywhere dismisses tooltip
    document.addEventListener('touchstart', (e) => {
      if (activeEl && !e.target.closest('#tooltip-flyout')) {
        // Small delay to avoid immediately dismissing on the same touch
        setTimeout(() => { if (activeEl) hide(); }, 50);
      }
    }, { passive: true });

    // Mouse: hover shows tooltip after 400ms delay
    // Keep tooltip open while cursor is over the trigger element OR the flyout itself
    let hideTimer = null;
    let overFlyout = false;

    const scheduleHide = () => {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (!overFlyout) hide();
      }, 1500);
    };

    const cancelHide = () => {
      clearTimeout(hideTimer);
    };

    // Track mouse on the flyout directly — mouseenter/mouseleave are reliable
    // (they don't re-fire when moving between child elements like <a> tags)
    flyout.addEventListener('mouseenter', () => {
      overFlyout = true;
      cancelHide();
    });

    flyout.addEventListener('mouseleave', () => {
      overFlyout = false;
      scheduleHide();
    });

    document.addEventListener('mouseover', (e) => {
      if (e.target.closest('#tooltip-flyout')) return;
      const el = e.target.closest('[data-tooltip]');
      if (!el || el === activeEl) return;
      cancelHide();
      hide();
      hoverTimer = setTimeout(() => show(el), 400);
    });

    document.addEventListener('mouseout', (e) => {
      const el = e.target.closest('[data-tooltip]');
      if (el) {
        clearTimeout(hoverTimer);
        scheduleHide();
      }
    });
  }

  // ========================================
  //  Helper Methods
  // ========================================

  _updateStatusBarLocal() {
    const total = Object.values(this._chapterWordCounts).reduce((sum, wc) => sum + wc, 0);
    const project = this._currentProject;
    const goal = project ? (project.wordCountGoal || 80000) : 80000;
    const progress = Math.round((total / goal) * 100);

    const el = (id) => document.getElementById(id);
    if (el('status-total')) el('status-total').textContent = total.toLocaleString();
    if (el('status-goal')) el('status-goal').textContent = goal.toLocaleString();
    if (el('status-progress')) el('status-progress').textContent = progress + '%';
    if (el('fwc-total')) el('fwc-total').textContent = total.toLocaleString();
    if (el('fwc-progress')) el('fwc-progress').textContent = progress + '%';
  }

  _applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme === 'dark' ? '' : theme);
    if (theme === 'dark') document.documentElement.removeAttribute('data-theme');
  }

  async _saveProjectSettings() {
    // Project settings (genre, voice, title) are now saved via _saveBookStructure
    // from the Book Setup tab in the central modal
    await this._saveBookStructure();
  }

  async _deleteCurrentProject() {
    if (!this.state.currentProjectId) return;
    if (!confirm('Delete this entire project? This cannot be undone.')) return;
    if (!confirm('Are you absolutely sure? All chapters will be permanently deleted.')) return;

    try {
      // Stop auto-save
      if (this._autoSaveInterval) {
        clearInterval(this._autoSaveInterval);
        this._autoSaveInterval = null;
      }
      this.state.currentChapterId = null;

      await this.fs.deleteProject(this.state.currentProjectId);

      this.state.currentProjectId = null;
      this._currentProject = null;
      this._chapterWordCounts = {};
      this._closeAllPanels();
      await this._showLanding();
    } catch (err) {
      console.error('Failed to delete project:', err);
      alert('Failed to delete project.');
    }
  }

  /**
   * Central chapter deletion handler. ALL delete operations must go through here.
   * Handles: Firestore removal, editor clearing, word count reset, auto-switch.
   * @param {string[]} chapterIds - Array of chapter IDs to delete
   */
  async _deleteChaptersAndCleanup(chapterIds) {
    if (!chapterIds || chapterIds.length === 0) return;

    const wasActiveDeleted = chapterIds.includes(this.state.currentChapterId);

    // 1. Delete from Firestore (including any associated translations)
    for (const id of chapterIds) {
      try {
        await this.fs.deleteChapter(id);
        delete this._chapterWordCounts[id];

        // Also delete any translations of this chapter
        const langCodes = ['es', 'fr', 'it', 'de', 'pt', 'ja'];
        for (const code of langCodes) {
          try {
            const translationDocId = `${id}_${code}`;
            await this.fs.deleteChapter(translationDocId);
          } catch (e) { /* translation chapter may not exist, ignore */ }
        }
      } catch (err) {
        console.error(`Failed to delete chapter ${id}:`, err);
      }
    }

    // 2. If the currently-displayed chapter was deleted, CLEAR THE EDITOR
    if (wasActiveDeleted) {
      this.state.currentChapterId = null;

      // Cancel any pending auto-save
      if (this._autoSaveTimer) {
        clearTimeout(this._autoSaveTimer);
        this._autoSaveTimer = null;
      }
      if (this._saveTimeout) {
        clearTimeout(this._saveTimeout);
        this._saveTimeout = null;
      }

      // Clear editor via API
      try {
        if (this.editor) {
          if (this.editor.clear) this.editor.clear();
          else if (this.editor.commands?.clearContent) this.editor.commands.clearContent();
          else if (this.editor.commands?.setContent) this.editor.commands.setContent('');
        }
      } catch (e) {
        console.warn('Editor clear via API failed:', e);
      }

      // DOM fallback — clear all possible editor elements
      const editorSelectors = [
        '.ProseMirror', '.editor-content', '[contenteditable="true"]',
        '#editor', '.tiptap', '.ql-editor'
      ];
      for (const sel of editorSelectors) {
        const el = document.querySelector(sel);
        if (el && el.innerHTML) {
          el.innerHTML = '';
          break;
        }
      }

      // Reset all word count displays
      const wcEl = document.getElementById('status-words');
      if (wcEl) wcEl.textContent = '0';
      const fwcWords = document.getElementById('fwc-words');
      if (fwcWords) fwcWords.textContent = '0';
      document.querySelectorAll('.word-count, #word-count, [data-word-count]').forEach(el => {
        if (el.textContent?.includes('Words:')) el.textContent = 'Words: 0';
      });
    }

    // 3. Renumber remaining chapters and refresh UI
    const chapters = await this.fs.getProjectChapters(this.state.currentProjectId);
    const originalChapters = chapters.filter(ch => !ch.isTranslation);
    const orderedIds = originalChapters.map(ch => ch.id);
    if (orderedIds.length > 0) {
      await this.fs.reorderChapters(this.state.currentProjectId, orderedIds);
    }

    await this._renderChapterList();
    await this.renderChapterNav();
    this._updateStatusBarLocal();

    // 4. If the deleted chapter was displayed, auto-switch to next remaining
    if (wasActiveDeleted) {
      const remaining = chapters.filter(ch => !ch.isTranslation);
      if (remaining.length > 0) {
        await this._loadChapter(remaining[0].id);
      } else {
        this._showWelcome();
      }
    }
  }

  async _deleteChapter(chapterId) {
    if (!confirm('Delete this chapter? This cannot be undone.')) return;
    try {
      await this._deleteChaptersAndCleanup([chapterId]);
    } catch (err) {
      console.error('Failed to delete chapter:', err);
      alert('Failed to delete chapter.');
    }
  }

  _closeChapterMenus() {
    document.querySelectorAll('.chapter-menu.open').forEach(m => m.classList.remove('open'));
  }

  async _mergeChapter(chapterId, direction) {
    try {
      const chapters = await this.fs.getProjectChapters(this.state.currentProjectId);
      const originals = chapters.filter(ch => !ch.isTranslation);
      const idx = originals.findIndex(ch => ch.id === chapterId);
      if (idx === -1) return;

      const source = originals[idx];
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= originals.length) return;
      const target = originals[targetIdx];

      const sourceTitle = source.title || 'Untitled';
      const targetTitle = target.title || 'Untitled';
      const label = direction === 'up'
        ? `Merge "${sourceTitle}" into "${targetTitle}" (previous)?`
        : `Merge "${sourceTitle}" into "${targetTitle}" (next)?`;
      if (!confirm(label)) return;

      // Read full content of both chapters
      const sourceData = await this.fs.getChapter(source.id);
      const targetData = await this.fs.getChapter(target.id);
      if (!sourceData || !targetData) return;

      // Merge up: append source after target (previous chapter keeps its content first)
      // Merge down: prepend source before target (next chapter gets source content first)
      const mergedContent = direction === 'up'
        ? (targetData.content || '') + '\n' + (sourceData.content || '')
        : (sourceData.content || '') + '\n' + (targetData.content || '');

      // Update target with merged content
      await this.fs.updateChapter(target.id, { content: mergedContent });

      // Delete the source chapter (and its translations)
      await this._deleteChaptersAndCleanup([source.id]);

      // If the source was the currently loaded chapter, switch to the target
      if (this.state.currentChapterId === source.id) {
        await this._loadChapter(target.id);
      } else if (this.state.currentChapterId === target.id) {
        // Reload target chapter to show merged content
        await this._loadChapter(target.id);
      }
    } catch (err) {
      console.error('Failed to merge chapters:', err);
      alert('Failed to merge chapters.');
    }
  }

  _updateDeleteSelectedBtn() {
    const checked = document.querySelectorAll('.chapter-checkbox:checked');
    const btn = document.getElementById('btn-delete-selected-chapters');
    if (btn) {
      btn.disabled = checked.length === 0;
      btn.textContent = checked.length > 0 ? `Delete Selected (${checked.length})` : 'Delete Selected';
    }
    // Sync "Select All" checkbox state
    const selectAll = document.getElementById('chapter-select-all');
    const allBoxes = document.querySelectorAll('.chapter-checkbox');
    if (selectAll && allBoxes.length > 0) {
      selectAll.checked = checked.length === allBoxes.length;
      selectAll.indeterminate = checked.length > 0 && checked.length < allBoxes.length;
    }
  }

  _toggleSelectAll(checked) {
    document.querySelectorAll('.chapter-checkbox').forEach(cb => {
      cb.checked = checked;
    });
    this._updateDeleteSelectedBtn();
  }

  async _deleteSelectedChapters() {
    const checked = document.querySelectorAll('.chapter-checkbox:checked');
    if (checked.length === 0) return;

    const count = checked.length;
    if (!confirm(`Delete ${count} selected chapter${count > 1 ? 's' : ''}? This cannot be undone.`)) return;

    try {
      const idsToDelete = Array.from(checked).map(cb => cb.dataset.chapterId);
      await this._deleteChaptersAndCleanup(idsToDelete);
    } catch (err) {
      console.error('Failed to delete selected chapters:', err);
      alert('Failed to delete selected chapters.');
    }
  }

  _showAcceptOutlineConfirmation() {
    const overlay = document.getElementById('accept-outline-overlay');
    if (overlay) overlay.classList.add('visible');
  }

  async _acceptChapterOutlineAndGenerate() {
    // Close the confirmation modal
    const overlay = document.getElementById('accept-outline-overlay');
    if (overlay) overlay.classList.remove('visible');

    // Ensure we have a current chapter with an outline
    if (!this.state.currentChapterId) {
      alert('Please select a chapter first.');
      return;
    }

    if (!this._currentChapterOutline) {
      alert('The current chapter has no outline. Generate outlines first via Structure.');
      return;
    }

    if (!this.generator.hasApiKey()) {
      alert('Set your Anthropic API key in Settings first.');
      return;
    }

    // Open the generate panel with outline pre-filled, then auto-trigger generation
    await this.openGeneratePanel();

    // Auto-fill the plot field with the chapter outline if not already set
    const plotEl = document.getElementById('generate-plot');
    if (plotEl && !plotEl.value?.trim()) {
      plotEl.value = this._currentChapterOutline;
    }

    // Close the modal and trigger generation
    this._closeSetupBookModal();
    await this._runGeneration();
  }

  async _openCharacterEditor(charId) {
    const character = await this.localStorage.get(STORE_NAMES.characters, charId);
    if (!character) return;

    const body = document.getElementById('panel-analysis-body');
    if (!body) return;

    body.innerHTML = `
      <div class="analysis-section">
        <h3>Character Details</h3>
        <div class="form-group">
          <label>Name</label>
          <input type="text" class="form-input" id="char-name" value="${this._esc(character.name)}">
        </div>
        <div class="form-group">
          <label>Role</label>
          <select class="form-input" id="char-role">
            <option value="protagonist" ${character.role === 'protagonist' ? 'selected' : ''}>Protagonist</option>
            <option value="antagonist" ${character.role === 'antagonist' ? 'selected' : ''}>Antagonist</option>
            <option value="supporting" ${character.role === 'supporting' ? 'selected' : ''}>Supporting</option>
            <option value="minor" ${character.role === 'minor' ? 'selected' : ''}>Minor</option>
          </select>
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea class="form-input" id="char-desc" rows="3">${this._esc(character.description || '')}</textarea>
        </div>
        <div class="form-group">
          <label>Motivation / Want</label>
          <textarea class="form-input" id="char-motivation" rows="2">${this._esc(character.motivation || '')}</textarea>
        </div>
        <div class="form-group">
          <label>Character Arc</label>
          <textarea class="form-input" id="char-arc" rows="3">${this._esc(character.arc || '')}</textarea>
        </div>
        <div class="form-group">
          <label>Notes</label>
          <textarea class="form-input" id="char-notes" rows="3">${this._esc(character.notes || '')}</textarea>
        </div>
        <button class="btn btn-primary" id="save-character" data-id="${charId}" style="width:100%;">Save Character</button>
        <button class="btn btn-sm" id="delete-character" data-id="${charId}" style="width:100%;margin-top:8px;border-color:var(--danger);color:var(--danger);">Delete Character</button>
      </div>
    `;

    document.getElementById('save-character')?.addEventListener('click', async () => {
      await this.manuscript.updateCharacter(charId, {
        name: document.getElementById('char-name')?.value,
        role: document.getElementById('char-role')?.value,
        description: document.getElementById('char-desc')?.value,
        motivation: document.getElementById('char-motivation')?.value,
        arc: document.getElementById('char-arc')?.value,
        notes: document.getElementById('char-notes')?.value
      });
      this._closeAllPanels();
      await this._renderCharactersList();
    });

    document.getElementById('delete-character')?.addEventListener('click', async () => {
      if (confirm('Delete this character?')) {
        await this.manuscript.deleteCharacter(charId);
        this._closeAllPanels();
        await this._renderCharactersList();
      }
    });

    this._showPanel('analysis');
  }

  async _openNoteEditor(noteId) {
    const note = await this.localStorage.get(STORE_NAMES.notes, noteId);
    if (!note) return;

    const body = document.getElementById('panel-analysis-body');
    if (!body) return;

    body.innerHTML = `
      <div class="analysis-section">
        <h3>Note</h3>
        <div class="form-group">
          <label>Title</label>
          <input type="text" class="form-input" id="note-title" value="${this._esc(note.title)}">
        </div>
        <div class="form-group">
          <label>Type</label>
          <select class="form-input" id="note-type">
            <option value="general" ${note.type === 'general' ? 'selected' : ''}>General</option>
            <option value="worldbuilding" ${note.type === 'worldbuilding' ? 'selected' : ''}>World Building</option>
            <option value="research" ${note.type === 'research' ? 'selected' : ''}>Research</option>
            <option value="plot" ${note.type === 'plot' ? 'selected' : ''}>Plot</option>
          </select>
        </div>
        <div class="form-group">
          <label>Content</label>
          <textarea class="form-input" id="note-content" rows="10">${this._esc(note.content || '')}</textarea>
        </div>
        <button class="btn btn-primary" id="save-note" data-id="${noteId}" style="width:100%;">Save Note</button>
        <button class="btn btn-sm" id="delete-note" data-id="${noteId}" style="width:100%;margin-top:8px;border-color:var(--danger);color:var(--danger);">Delete Note</button>
      </div>
    `;

    document.getElementById('save-note')?.addEventListener('click', async () => {
      await this.manuscript.updateNote(noteId, {
        title: document.getElementById('note-title')?.value,
        type: document.getElementById('note-type')?.value,
        content: document.getElementById('note-content')?.value
      });
      this._closeAllPanels();
      await this._renderNotesList();
    });

    document.getElementById('delete-note')?.addEventListener('click', async () => {
      if (confirm('Delete this note?')) {
        await this.manuscript.deleteNote(noteId);
        this._closeAllPanels();
        await this._renderNotesList();
      }
    });

    this._showPanel('analysis');
  }

  _prompt(label, defaultValue = '') {
    return new Promise((resolve) => {
      const result = prompt(label, defaultValue);
      resolve(result);
    });
  }

  _getSubgenreOptions(genreId, selectedSubgenre) {
    if (!genreId || !window.GENRE_DATA) return '';
    const genre = window.GENRE_DATA.find(g => g.id === genreId);
    if (!genre || !genre.subgenres) return '';
    return genre.subgenres.map(s =>
      `<option value="${s.id}" ${selectedSubgenre === s.id ? 'selected' : ''}>${s.label}</option>`
    ).join('');
  }

  _getGenreRules(genreId, subgenreId) {
    if (!genreId || !window.GENRE_DATA) return null;
    const genre = window.GENRE_DATA.find(g => g.id === genreId);
    if (!genre) return null;
    let rules = genre.rules;
    let label = genre.label;
    if (subgenreId && genre.subgenres) {
      const sub = genre.subgenres.find(s => s.id === subgenreId);
      if (sub) {
        rules += '\n\nSubgenre-specific rules (' + sub.label + '): ' + sub.rules;
        label = sub.label;
      }
    }
    return { label, rules };
  }

  /**
   * Format generated prose HTML: convert chapter headings to H1, scene breaks to centered markers.
   */
  _formatGeneratedHtml(html, chapterTitle) {
    if (!html) return html;
    // Convert scene break paragraphs (e.g. "* * *") to centered format
    html = html.replace(/<p>\s*\*\s*\*\s*\*\s*<\/p>/gi, '<p style="text-align:center;text-indent:0">* * *</p>');

    // If the first paragraph matches the chapter title, convert it to H1
    if (chapterTitle) {
      const escapedTitle = chapterTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const h1Regex = new RegExp(`^(<p>)(\\s*${escapedTitle}\\s*)(</p>)`, 'i');
      html = html.replace(h1Regex, '<h1 style="text-align:center;margin:1em 0 0.5em;font-size:1.8em;">$2</h1>');
    }
    return html;
  }

  /**
   * Strip em dashes and en dashes from generated text, replacing with commas or appropriate punctuation.
   */
  _stripEmDashes(text) {
    if (!text) return text;
    // Replace em dash (U+2014) and en dash (U+2013) surrounded by spaces with comma
    text = text.replace(/\s*\u2014\s*/g, ', ');
    text = text.replace(/\s*\u2013\s*/g, ', ');
    // Replace double/triple hyphens used as em dashes
    text = text.replace(/\s*---\s*/g, ', ');
    text = text.replace(/\s*--\s*/g, ', ');
    // Clean up double commas or comma-period
    text = text.replace(/,\s*,/g, ',');
    text = text.replace(/,\s*\./g, '.');
    text = text.replace(/,\s*!/g, '!');
    text = text.replace(/,\s*\?/g, '?');
    return text;
  }

  // ======================================================
  // CHAPTER NAVIGATOR
  // ======================================================

  _initChapterNav() {
    // --- Resize Handle ---
    const resizeHandle = document.getElementById('chapter-nav-resize');
    if (resizeHandle) {
      let startX, startWidth;

      const onMouseMove = (e) => {
        if (!this._navResizing) return;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const diff = clientX - startX;
        const newWidth = Math.max(
          parseInt(getComputedStyle(document.documentElement).getPropertyValue('--chapter-nav-min-width')) || 160,
          Math.min(
            parseInt(getComputedStyle(document.documentElement).getPropertyValue('--chapter-nav-max-width')) || 400,
            startWidth + diff
          )
        );
        document.documentElement.style.setProperty('--chapter-nav-width', newWidth + 'px');
      };

      const onMouseUp = () => {
        this._navResizing = false;
        resizeHandle.classList.remove('dragging');
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.removeEventListener('touchmove', onMouseMove);
        document.removeEventListener('touchend', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      resizeHandle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this._navResizing = true;
        startX = e.clientX;
        startWidth = document.getElementById('chapter-nav')?.offsetWidth || 220;
        resizeHandle.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });

      resizeHandle.addEventListener('touchstart', (e) => {
        this._navResizing = true;
        startX = e.touches[0].clientX;
        startWidth = document.getElementById('chapter-nav')?.offsetWidth || 220;
        resizeHandle.classList.add('dragging');
        document.body.style.userSelect = 'none';
        document.addEventListener('touchmove', onMouseMove, { passive: false });
        document.addEventListener('touchend', onMouseUp);
      }, { passive: true });
    }

    // --- Section Collapse ---
    document.getElementById('chapter-nav-body')?.addEventListener('click', (e) => {
      const header = e.target.closest('.nav-section-header');
      if (header) {
        const section = header.closest('.nav-section');
        if (section) section.classList.toggle('collapsed');
        return;
      }
    });

    // --- Collapse Navigator ---
    document.getElementById('btn-nav-collapse')?.addEventListener('click', () => {
      document.getElementById('app')?.classList.toggle('chapnav-collapsed');
    });

    // --- Select All ---
    document.getElementById('btn-nav-select-all')?.addEventListener('click', () => {
      const allItems = document.querySelectorAll('.nav-item-checkbox');
      const allChecked = [...allItems].every(cb => cb.checked);
      allItems.forEach(cb => {
        cb.checked = !allChecked;
        const item = cb.closest('.nav-item');
        if (item) {
          const id = item.dataset.navId;
          if (!allChecked) this._navSelectedIds.add(id);
          else this._navSelectedIds.delete(id);
          item.classList.toggle('selected', !allChecked);
        }
      });
      this._updateNavDeleteButton();
      const btn = document.getElementById('btn-nav-select-all');
      if (btn) btn.textContent = allChecked ? '\u2610' : '\u2611';
    });

    // --- Delete Selected ---
    document.getElementById('btn-nav-delete-selected')?.addEventListener('click', async () => {
      if (this._navSelectedIds.size === 0) return;
      const count = this._navSelectedIds.size;
      if (!confirm(`Delete ${count} selected item${count > 1 ? 's' : ''}? This cannot be undone.`)) return;

      const chapterIds = [];
      for (const id of this._navSelectedIds) {
        if (id.startsWith('fm-') || id.startsWith('bm-')) {
          await this._removeBookMatterItem(id);
        } else {
          chapterIds.push(id);
        }
      }
      if (chapterIds.length > 0) {
        await this._deleteChaptersAndCleanup(chapterIds);
      }
      this._navSelectedIds.clear();
      this._updateNavDeleteButton();
    });

    // --- Toolbar: Select All ---
    document.getElementById('nav-toolbar-select-all')?.addEventListener('change', (e) => {
      const checked = e.target.checked;
      const allItems = document.querySelectorAll('.nav-item-checkbox');
      allItems.forEach(cb => {
        cb.checked = checked;
        const item = cb.closest('.nav-item');
        if (item) {
          const id = item.dataset.navId;
          if (checked) this._navSelectedIds.add(id);
          else this._navSelectedIds.delete(id);
          item.classList.toggle('selected', checked);
        }
      });
      this._updateNavDeleteButton();
      // Sync header select-all button
      const headerBtn = document.getElementById('btn-nav-select-all');
      if (headerBtn) headerBtn.textContent = checked ? '\u2611' : '\u2610';
      // Update toolbar delete button
      const delBtn = document.getElementById('btn-nav-toolbar-delete');
      if (delBtn) delBtn.disabled = this._navSelectedIds.size === 0;
    });

    // --- Toolbar: Delete Selected ---
    document.getElementById('btn-nav-toolbar-delete')?.addEventListener('click', async () => {
      // Delegate to the existing nav delete handler
      document.getElementById('btn-nav-delete-selected')?.click();
    });

    // --- Toolbar: Accept Outline ---
    document.getElementById('btn-nav-accept-outline')?.addEventListener('click', () => {
      this._showAcceptOutlineConfirmation();
    });

    // --- Add Chapter ---
    document.getElementById('btn-nav-add-chapter')?.addEventListener('click', async () => {
      if (!this.state.currentProjectId) return;
      try {
        const chapters = await this.fs.getProjectChapters(this.state.currentProjectId);
        const nextNum = chapters.length + 1;
        const ch = await this.fs.createChapter({
          projectId: this.state.currentProjectId,
          chapterNumber: nextNum,
          title: `Chapter ${nextNum}`,
          content: '',
          outline: ''
        });
        this._chapterWordCounts[ch.id] = 0;
        await this._renderChapterList();
        await this.renderChapterNav();
        await this._loadChapter(ch.id);
      } catch (err) {
        console.error('Failed to add chapter:', err);
      }
    });

    // --- Click/double-click handlers on items (delegated) ---
    const navBody = document.getElementById('chapter-nav-body');
    if (navBody) {
      // Single click
      navBody.addEventListener('click', async (e) => {
        // Checkbox click
        const checkbox = e.target.closest('.nav-item-checkbox');
        if (checkbox) {
          const item = checkbox.closest('.nav-item');
          const id = item?.dataset.navId;
          if (id) {
            if (checkbox.checked) this._navSelectedIds.add(id);
            else this._navSelectedIds.delete(id);
            item?.classList.toggle('selected', checkbox.checked);
          }
          this._updateNavDeleteButton();
          return;
        }

        // Item click (not on checkbox or drag handle)
        const item = e.target.closest('.nav-item');
        if (item && !e.target.closest('.drag-handle') && !e.target.closest('.nav-item-name-input')) {
          const id = item.dataset.navId;
          const type = item.dataset.navType;

          if (type === 'chapter') {
            await this._loadChapter(id);
            document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            document.querySelectorAll('.tree-item.chapter').forEach(el => el.classList.remove('active'));
            const oldItem = document.querySelector(`.tree-item.chapter[data-id="${id}"]`);
            if (oldItem) oldItem.classList.add('active');
          } else if (type === 'front-matter' || type === 'back-matter') {
            await this._loadMatterPage(id, type);
            document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
          }
        }
      });

      // Double-click — rename
      navBody.addEventListener('dblclick', (e) => {
        const nameSpan = e.target.closest('.nav-item-name');
        if (!nameSpan) return;
        const item = nameSpan.closest('.nav-item');
        if (!item) return;

        const currentName = nameSpan.textContent;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'nav-item-name-input';
        input.value = currentName;

        nameSpan.replaceWith(input);
        input.focus();
        input.select();

        const commit = async () => {
          const newName = input.value.trim() || currentName;
          const span = document.createElement('span');
          span.className = 'nav-item-name';
          span.textContent = newName;
          input.replaceWith(span);

          if (newName !== currentName) {
            const id = item.dataset.navId;
            const type = item.dataset.navType;
            if (type === 'chapter') {
              await this.fs.updateChapter(id, { title: newName });
              await this._renderChapterList();
            } else {
              await this._renameMatterPage(id, newName);
            }
          }
        };

        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
          if (ev.key === 'Escape') { input.value = currentName; input.blur(); }
        });
      });

      // --- Drag and Drop for Reordering ---
      navBody.addEventListener('dragstart', (e) => {
        const item = e.target.closest('.nav-item[draggable="true"]');
        if (!item) return;
        this._navDragItem = item;
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.dataset.navId);
      });

      navBody.addEventListener('dragover', (e) => {
        e.preventDefault();
        const item = e.target.closest('.nav-item[draggable="true"]');
        if (!item || item === this._navDragItem) return;
        navBody.querySelectorAll('.drag-over, .drag-over-bottom').forEach(el => {
          el.classList.remove('drag-over', 'drag-over-bottom');
        });
        const rect = item.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        if (clientY < midY) {
          item.classList.add('drag-over');
        } else {
          item.classList.add('drag-over-bottom');
        }
      });

      navBody.addEventListener('dragleave', (e) => {
        const item = e.target.closest('.nav-item');
        if (item) {
          item.classList.remove('drag-over', 'drag-over-bottom');
        }
      });

      navBody.addEventListener('drop', async (e) => {
        e.preventDefault();
        navBody.querySelectorAll('.drag-over, .drag-over-bottom').forEach(el => {
          el.classList.remove('drag-over', 'drag-over-bottom');
        });

        if (!this._navDragItem) return;
        const dragId = this._navDragItem.dataset.navId;
        const dragType = this._navDragItem.dataset.navType;

        const dropTarget = e.target.closest('.nav-item[draggable="true"]');
        if (!dropTarget || dropTarget === this._navDragItem) {
          this._navDragItem.classList.remove('dragging');
          this._navDragItem = null;
          return;
        }

        if (dropTarget.dataset.navType !== dragType) {
          this._navDragItem.classList.remove('dragging');
          this._navDragItem = null;
          return;
        }

        const rect = dropTarget.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const clientY = e.clientY;
        const insertBefore = clientY < midY;

        const sectionItems = [...dropTarget.parentElement.querySelectorAll(`.nav-item[data-nav-type="${dragType}"]`)];
        const dragIndex = sectionItems.findIndex(el => el.dataset.navId === dragId);
        let dropIndex = sectionItems.findIndex(el => el.dataset.navId === dropTarget.dataset.navId);
        if (!insertBefore) dropIndex++;
        if (dragIndex < dropIndex) dropIndex--;

        if (dragType === 'chapter') {
          await this._reorderChapters(dragId, dropIndex);
        }

        this._navDragItem.classList.remove('dragging');
        this._navDragItem = null;
        await this.renderChapterNav();
        await this._renderChapterList();
      });

      navBody.addEventListener('dragend', () => {
        if (this._navDragItem) {
          this._navDragItem.classList.remove('dragging');
          this._navDragItem = null;
        }
        navBody.querySelectorAll('.drag-over, .drag-over-bottom').forEach(el => {
          el.classList.remove('drag-over', 'drag-over-bottom');
        });
      });
    }
  }

  _updateNavDeleteButton() {
    const btn = document.getElementById('btn-nav-delete-selected');
    if (btn) {
      btn.disabled = this._navSelectedIds.size === 0;
      btn.title = this._navSelectedIds.size > 0
        ? `Delete ${this._navSelectedIds.size} selected`
        : 'Delete Selected';
    }
    // Also update toolbar delete button
    const toolbarBtn = document.getElementById('btn-nav-toolbar-delete');
    if (toolbarBtn) {
      toolbarBtn.disabled = this._navSelectedIds.size === 0;
      toolbarBtn.textContent = this._navSelectedIds.size > 0
        ? `Delete (${this._navSelectedIds.size})`
        : 'Delete';
    }
  }

  /**
   * Render the full Chapter Navigator from project data.
   * Call this whenever chapters change, front/back matter changes, or project loads.
   */
  async renderChapterNav() {
    const project = this._currentProject;
    if (!project) return;

    const chapters = await this.fs.getProjectChapters(this.state.currentProjectId);
    const frontMatter = project.frontMatter || [];
    const backMatter = project.backMatter || [];
    const matterNames = project.matterPageNames || {};

    // --- Front Matter Items ---
    const frontContainer = document.getElementById('nav-front-items');
    const frontCount = document.getElementById('nav-front-count');
    if (frontContainer) {
      const matterLabels = {
        'title-page': { icon: '\uD83D\uDCD6', name: 'Title Page' },
        'copyright': { icon: '\u00A9', name: 'Copyright Page' },
        'dedication': { icon: '\uD83D\uDC9D', name: 'Dedication' },
        'epigraph': { icon: '\u2726', name: 'Epigraph' },
        'table-of-contents': { icon: '\uD83D\uDCCB', name: 'Table of Contents' },
        'prologue': { icon: '\u25B6', name: 'Prologue' }
      };

      let html = '';
      for (const fm of frontMatter) {
        const info = matterLabels[fm] || { icon: '\uD83D\uDCC4', name: fm };
        const customName = matterNames[`fm-${fm}`] || info.name;
        const id = `fm-${fm}`;
        const isActive = this.state.currentMatterId === id;
        const hasContent = !!(project.matterContent?.[id]);
        html += `
          <div class="nav-item matter-item ${isActive ? 'active' : ''} ${!hasContent ? 'empty' : ''}"
               data-nav-id="${id}" data-nav-type="front-matter" draggable="true">
            <input type="checkbox" class="nav-item-checkbox" ${this._navSelectedIds.has(id) ? 'checked' : ''}>
            <span class="drag-handle">\u2807</span>
            <span class="nav-item-icon">${info.icon}</span>
            <span class="nav-item-name">${this._esc(customName)}</span>
            ${hasContent ? '<span class="nav-item-status done">\u2713</span>' : ''}
          </div>`;
      }
      frontContainer.innerHTML = html;
      if (frontCount) frontCount.textContent = frontMatter.length;
    }

    // --- Chapter Items ---
    const chapContainer = document.getElementById('nav-chapter-items');
    const chapCount = document.getElementById('nav-chapters-count');
    if (chapContainer) {
      let html = '';
      for (let i = 0; i < chapters.length; i++) {
        const ch = chapters[i];
        const isActive = ch.id === this.state.currentChapterId;
        const statusClass = ch.status === 'complete' ? 'done' : '';
        const statusLabel = ch.status === 'complete' ? 'Done' : ch.status === 'revision' ? 'Rev' : '';
        const hasOutline = ch.outline ? '\u270E ' : '';
        html += `
          <div class="nav-item ${isActive ? 'active' : ''}"
               data-nav-id="${ch.id}" data-nav-type="chapter" draggable="true">
            <input type="checkbox" class="nav-item-checkbox" ${this._navSelectedIds.has(ch.id) ? 'checked' : ''}>
            <span class="drag-handle">\u2807</span>
            <span class="nav-item-name">${hasOutline}${this._esc(ch.title)}</span>
            <span class="nav-item-meta">${(ch.wordCount || 0).toLocaleString()}</span>
            ${statusLabel ? `<span class="nav-item-status ${statusClass}">${statusLabel}</span>` : ''}
          </div>`;
      }
      chapContainer.innerHTML = html;
      if (chapCount) chapCount.textContent = chapters.length;
    }

    // --- Back Matter Items ---
    const backContainer = document.getElementById('nav-back-items');
    const backCount = document.getElementById('nav-back-count');
    if (backContainer) {
      const matterLabels = {
        'epilogue': { icon: '\u25C0', name: 'Epilogue' },
        'acknowledgments': { icon: '\uD83D\uDE4F', name: 'Acknowledgments' },
        'about-author': { icon: '\uD83D\uDC64', name: 'About the Author' },
        'also-by': { icon: '\uD83D\uDCDA', name: 'Also By This Author' },
        'glossary': { icon: '\uD83D\uDCDD', name: 'Glossary' },
        'appendix': { icon: '\uD83D\uDCCE', name: 'Appendix' }
      };

      let html = '';
      for (const bm of backMatter) {
        const info = matterLabels[bm] || { icon: '\uD83D\uDCC4', name: bm };
        const customName = matterNames[`bm-${bm}`] || info.name;
        const id = `bm-${bm}`;
        const isActive = this.state.currentMatterId === id;
        const hasContent = !!(project.matterContent?.[id]);
        html += `
          <div class="nav-item matter-item ${isActive ? 'active' : ''} ${!hasContent ? 'empty' : ''}"
               data-nav-id="${id}" data-nav-type="back-matter" draggable="true">
            <input type="checkbox" class="nav-item-checkbox" ${this._navSelectedIds.has(id) ? 'checked' : ''}>
            <span class="drag-handle">\u2807</span>
            <span class="nav-item-icon">${info.icon}</span>
            <span class="nav-item-name">${this._esc(customName)}</span>
            ${hasContent ? '<span class="nav-item-status done">\u2713</span>' : ''}
          </div>`;
      }
      backContainer.innerHTML = html;
      if (backCount) backCount.textContent = backMatter.length;
    }

    // Hide sections with no items
    const frontSection = document.getElementById('nav-section-front');
    const backSection = document.getElementById('nav-section-back');
    if (frontSection) frontSection.style.display = frontMatter.length ? '' : 'none';
    if (backSection) backSection.style.display = backMatter.length ? '' : 'none';
  }

  /**
   * Load a front/back matter page into the editor
   */
  async _loadMatterPage(matterId, type) {
    const project = this._currentProject;
    if (!project) return;

    // Store current chapter first
    if (this.state.currentChapterId) {
      await this._saveCurrentChapter();
    }

    // Set state
    this.state.currentChapterId = null;
    this.state.currentMatterId = matterId;

    // Load content
    const matterContent = project.matterContent || {};
    const content = matterContent[matterId] || '';

    if (this.editor) {
      this.editor.setContent(content);
    }

    // Update toolbar title
    const matterLabels = {
      'fm-title-page': 'Title Page',
      'fm-copyright': 'Copyright Page',
      'fm-dedication': 'Dedication',
      'fm-epigraph': 'Epigraph',
      'fm-table-of-contents': 'Table of Contents',
      'fm-prologue': 'Prologue',
      'bm-epilogue': 'Epilogue',
      'bm-acknowledgments': 'Acknowledgments',
      'bm-about-author': 'About the Author',
      'bm-also-by': 'Also By This Author',
      'bm-glossary': 'Glossary',
      'bm-appendix': 'Appendix'
    };

    const customNames = project.matterPageNames || {};
    const label = customNames[matterId] || matterLabels[matterId] || matterId;
    const sceneTitle = document.getElementById('scene-title');
    if (sceneTitle) sceneTitle.textContent = label;
  }

  /**
   * Save matter page content from editor back to project
   */
  async _saveMatterPage() {
    if (!this.state.currentMatterId || !this._currentProject) return;
    const content = this.editor?.getContent() || '';
    const matterContent = this._currentProject.matterContent || {};
    matterContent[this.state.currentMatterId] = content;
    await this.fs.updateProject(this.state.currentProjectId, { matterContent });
    this._currentProject.matterContent = matterContent;
  }

  // ========================================
  //  AI Populate Front & Back Matter
  // ========================================

  /**
   * Use AI to auto-generate content for all selected front and back matter pages.
   * Builds a synopsis from the first ~3000 words of prose, then generates each
   * matter page with context-appropriate prompts.
   */
  async _aiPopulateMatter() {
    const project = this._currentProject;
    if (!project) { alert('No project open.'); return; }

    const apiKey = this.generator?.apiKey;
    if (!apiKey) { alert('No API key found. Set your Anthropic API key in Settings.'); return; }

    const frontMatter = project.frontMatter || [];
    const backMatter = project.backMatter || [];
    const allMatter = [
      ...frontMatter.map(fm => ({ id: `fm-${fm}`, key: fm, type: 'front' })),
      ...backMatter.map(bm => ({ id: `bm-${bm}`, key: bm, type: 'back' }))
    ];

    // Skip pages that already have content
    const matterContent = project.matterContent || {};
    const toGenerate = allMatter.filter(m => !matterContent[m.id]?.trim());

    if (toGenerate.length === 0) {
      alert('All selected front & back matter pages already have content. Clear a page to regenerate it.');
      return;
    }

    const btn = document.getElementById('btn-ai-populate-matter');
    const originalText = btn?.textContent;
    if (btn) btn.disabled = true;

    const prog = this._showProgressOverlay(
      'Populating Matter Pages\u2026',
      `0 of ${toGenerate.length} pages`,
      'Building synopsis from manuscript\u2026'
    );

    try {
      // ── 1. Build a synopsis from the manuscript prose ──
      const chapters = await this.fs.getProjectChapters(this.state.currentProjectId);
      const proseChapters = chapters.filter(ch => ch.status !== 'translation');

      let proseSample = '';
      const chapterTitles = [];
      for (const ch of proseChapters) {
        chapterTitles.push(ch.title || `Chapter ${ch.chapterNumber}`);
        const plain = this._htmlToPlainText(ch.content || '');
        if (proseSample.length < 4000) {
          proseSample += plain + '\n\n';
        }
      }
      proseSample = proseSample.substring(0, 4000).trim();

      if (!proseSample || proseSample.length < 100) {
        throw new Error('Not enough prose in the manuscript to generate matter pages. Write or generate some chapters first.');
      }

      // Gather characters
      let characterSummary = '';
      try {
        const chars = await this.localStorage.getProjectCharacters(this.state.currentProjectId);
        if (chars?.length > 0) {
          characterSummary = chars.map(c => `${c.name} (${c.role || 'character'}): ${c.description || ''}`).join('\n');
        }
      } catch (_) {}

      const projectTitle = project.title || 'Untitled';
      const projectGenre = project.genre || '';
      const authorName = project.owner || 'the author';

      // ── 2. Generate a synopsis via AI ──
      prog.update(null, null, 10, 'Generating synopsis\u2026');

      const synopsisResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: this.generator.model || 'claude-sonnet-4-5-20250929',
          max_tokens: 1024,
          messages: [{
            role: 'user',
            content: `Write a 2-3 paragraph synopsis of this novel based on the prose sample below. Include the main characters, central conflict, setting, and tone. Do NOT include spoilers about the ending.\n\nTitle: "${projectTitle}"\nGenre: ${projectGenre || 'Fiction'}\n${characterSummary ? `\nCharacters:\n${characterSummary}\n` : ''}\nChapter Titles: ${chapterTitles.join(', ')}\n\nProse Sample:\n${proseSample}`
          }]
        })
      });

      if (!synopsisResponse.ok) throw new Error(`Synopsis API error: ${synopsisResponse.status}`);
      const synopsisData = await synopsisResponse.json();
      const synopsis = synopsisData.content?.filter(b => b.type === 'text').map(b => b.text).join('\n') || '';

      // ── 3. Generate each matter page ──
      const matterPrompts = this._getMatterPrompts(projectTitle, authorName, projectGenre, synopsis, chapterTitles, characterSummary);

      for (let i = 0; i < toGenerate.length; i++) {
        const matter = toGenerate[i];
        const pct = 20 + ((i / toGenerate.length) * 75);
        prog.update(null, `${i + 1} of ${toGenerate.length} pages`, pct, `Generating ${this._getMatterLabel(matter.key)}\u2026`);

        const prompt = matterPrompts[matter.key];
        if (!prompt) {
          // No prompt defined for this type, skip
          continue;
        }

        try {
          const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
              model: this.generator.model || 'claude-sonnet-4-5-20250929',
              max_tokens: 2048,
              system: 'You are a publishing professional who creates polished book matter pages. Output clean HTML using only <p>, <h2>, <h3>, <em>, <strong> tags. No markdown. No explanations or commentary \u2014 output ONLY the page content.',
              messages: [{ role: 'user', content: prompt }]
            })
          });

          if (!response.ok) {
            console.error(`Failed to generate ${matter.key}: ${response.status}`);
            continue;
          }

          const data = await response.json();
          const html = data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';

          if (html.trim()) {
            matterContent[matter.id] = html;
          }
        } catch (err) {
          console.error(`Error generating ${matter.key}:`, err);
        }
      }

      // ── 4. Save all generated matter content ──
      prog.update(null, null, 98, 'Saving\u2026');
      await this.fs.updateProject(this.state.currentProjectId, { matterContent });
      this._currentProject.matterContent = matterContent;

      // Refresh nav to show checkmarks
      await this.renderChapterNav();

      prog.update(null, null, 100, 'Done!');
      await new Promise(r => setTimeout(r, 500));
      prog.remove();

      const generated = toGenerate.length;
      alert(`Front & back matter populated! ${generated} page(s) generated. Navigate to each page in the chapter navigator to review and edit.`);

    } catch (err) {
      console.error('AI matter population failed:', err);
      alert('Failed to populate matter pages: ' + err.message);
      prog.remove();
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = originalText; }
    }
  }

  /**
   * Build matter-specific prompts for each page type.
   */
  _getMatterPrompts(title, author, genre, synopsis, chapterTitles, characters) {
    return {
      'title-page': `Create a title page for a ${genre || 'fiction'} novel.\n\nTitle: "${title}"\nAuthor: ${author}\n\nFormat it as a centered title page with the book title as an <h2>, subtitle line if appropriate for the genre, and author name. Keep it elegant and simple.`,

      'copyright': `Create a standard copyright page for a published novel.\n\nTitle: "${title}"\nAuthor: ${author}\nYear: ${new Date().getFullYear()}\n\nInclude: copyright notice, "All rights reserved" statement, "This is a work of fiction" disclaimer, placeholder for ISBN, and placeholder for publisher info. Use standard publishing conventions.`,

      'dedication': `Write a short, heartfelt dedication page for this ${genre || 'fiction'} novel.\n\nTitle: "${title}"\nSynopsis: ${synopsis}\n\nMake it brief (1-3 lines), evocative, and appropriate for the book's tone. Do not use generic clich\u00e9s.`,

      'epigraph': `Choose or compose a fitting epigraph (opening quotation) for this ${genre || 'fiction'} novel.\n\nTitle: "${title}"\nSynopsis: ${synopsis}\n\nProvide a short, thematically resonant quote (real or original) that sets the tone for the story. Include attribution. Keep it to 1-3 lines.`,

      'table-of-contents': `Create a Table of Contents page for this novel.\n\nChapters:\n${chapterTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\nFormat as a clean, simple list with chapter numbers and titles. Use <p> tags for each entry.`,

      'prologue': `Write a compelling prologue for this ${genre || 'fiction'} novel.\n\nTitle: "${title}"\nSynopsis: ${synopsis}\n${characters ? `Characters: ${characters}\n` : ''}\nWrite a 300-500 word prologue that hooks the reader and establishes the story's central tension or mystery. Match the tone and style of the genre. This should feel like the opening of a published novel.`,

      'epilogue': `Write a satisfying epilogue for this ${genre || 'fiction'} novel.\n\nTitle: "${title}"\nSynopsis: ${synopsis}\n${characters ? `Characters: ${characters}\n` : ''}\nWrite a 300-500 word epilogue that provides closure and a sense of where the characters end up. Match the story's tone. Do not contradict the synopsis.`,

      'acknowledgments': `Write an acknowledgments page for this ${genre || 'fiction'} novel.\n\nTitle: "${title}"\nAuthor: ${author}\n\nWrite warm, genuine acknowledgments (150-250 words) thanking editors, family, writing community, and readers. Use placeholders like [editor name], [agent name], [family member] where specific names would go. Make it feel authentic and personal.`,

      'about-author': `Write an "About the Author" page for the author of this ${genre || 'fiction'} novel.\n\nAuthor Name: ${author}\nBook Title: "${title}"\nGenre: ${genre || 'Fiction'}\n\nWrite a professional 100-150 word third-person author bio. Use placeholder details like [city], [previous works], [hobby/interest]. Make it polished and suitable for the back of a published book.`,

      'also-by': `Create an "Also By This Author" page.\n\nAuthor: ${author}\nCurrent Book: "${title}"\nGenre: ${genre || 'Fiction'}\n\nCreate a placeholder page with 3-4 fictional book titles in the same genre that this author might have written. Format as a simple list. Include a note: "[Replace with your actual published titles]"`,

      'glossary': `Create a glossary page for this ${genre || 'fiction'} novel.\n\nTitle: "${title}"\nSynopsis: ${synopsis}\n\nBased on the synopsis and genre, create 8-12 glossary entries for key terms, places, or concepts that readers might encounter. Format each as: <p><strong>Term</strong> \u2014 Definition</p>`,

      'appendix': `Create an appendix page for this ${genre || 'fiction'} novel.\n\nTitle: "${title}"\nSynopsis: ${synopsis}\nGenre: ${genre || 'Fiction'}\n\nCreate a brief appendix with supplementary material appropriate for this genre (timeline, character list, map description, historical notes, etc.). Keep it to 200-300 words.`
    };
  }

  /**
   * Get human-readable label for a matter key.
   */
  _getMatterLabel(key) {
    const labels = {
      'title-page': 'Title Page', 'copyright': 'Copyright Page',
      'dedication': 'Dedication', 'epigraph': 'Epigraph',
      'table-of-contents': 'Table of Contents', 'prologue': 'Prologue',
      'epilogue': 'Epilogue', 'acknowledgments': 'Acknowledgments',
      'about-author': 'About the Author', 'also-by': 'Also By This Author',
      'glossary': 'Glossary', 'appendix': 'Appendix'
    };
    return labels[key] || key;
  }

  async _removeBookMatterItem(id) {
    const project = this._currentProject;
    if (!project) return;

    if (id.startsWith('fm-')) {
      const fmKey = id.replace('fm-', '');
      const frontMatter = (project.frontMatter || []).filter(fm => fm !== fmKey);
      await this.fs.updateProject(this.state.currentProjectId, { frontMatter });
      project.frontMatter = frontMatter;
    } else if (id.startsWith('bm-')) {
      const bmKey = id.replace('bm-', '');
      const backMatter = (project.backMatter || []).filter(bm => bm !== bmKey);
      await this.fs.updateProject(this.state.currentProjectId, { backMatter });
      project.backMatter = backMatter;
    }

    // Also remove content
    const matterContent = project.matterContent || {};
    delete matterContent[id];
    await this.fs.updateProject(this.state.currentProjectId, { matterContent });
    project.matterContent = matterContent;
  }

  async _renameMatterPage(id, newName) {
    const project = this._currentProject;
    if (!project) return;
    const matterPageNames = project.matterPageNames || {};
    matterPageNames[id] = newName;
    await this.fs.updateProject(this.state.currentProjectId, { matterPageNames });
    project.matterPageNames = matterPageNames;
  }

  async _reorderChapters(draggedId, newIndex) {
    try {
      const chapters = await this.fs.getProjectChapters(this.state.currentProjectId);
      const currentIndex = chapters.findIndex(ch => ch.id === draggedId);
      if (currentIndex === -1 || currentIndex === newIndex) return;

      const ordered = [...chapters];
      const [moved] = ordered.splice(currentIndex, 1);
      ordered.splice(newIndex, 0, moved);

      for (let i = 0; i < ordered.length; i++) {
        if (ordered[i].sortOrder !== i) {
          await this.fs.updateChapter(ordered[i].id, { sortOrder: i });
        }
      }
    } catch (err) {
      console.error('Reorder failed:', err);
    }
  }

  _esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ======== Edit Cover Methods ========
  // Cover editing is now handled by the CoverEditor class (js/cover-editor.js)

  // ======== Import Knowledge Methods ========

  _openImportKnowledgePanel() {
    const panel = document.getElementById('panel-import-knowledge');
    if (!panel) return;
    panel.classList.add('visible');

    // Reset form
    const titleInput = document.getElementById('knowledge-title');
    const contentArea = document.getElementById('knowledge-content');
    const pasteArea = document.getElementById('knowledge-paste-area');
    const fileInfo = document.getElementById('knowledge-file-info');
    if (titleInput) titleInput.value = '';
    if (contentArea) contentArea.value = '';
    if (pasteArea) pasteArea.style.display = 'none';
    if (fileInfo) fileInfo.style.display = 'none';

    // Set up file input handler
    const fileInput = document.getElementById('knowledge-file-input');
    if (fileInput) {
      fileInput.onchange = (e) => this._handleKnowledgeFile(e);
    }

    // Render existing knowledge list
    this._renderKnowledgeList();
  }

  _showKnowledgePasteArea() {
    const pasteArea = document.getElementById('knowledge-paste-area');
    const fileInfo = document.getElementById('knowledge-file-info');
    if (pasteArea) pasteArea.style.display = '';
    if (fileInfo) fileInfo.style.display = 'none';
    this._knowledgeFileContent = null;
  }

  _handleKnowledgeFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const pasteArea = document.getElementById('knowledge-paste-area');
    const fileInfo = document.getElementById('knowledge-file-info');
    if (pasteArea) pasteArea.style.display = 'none';

    const reader = new FileReader();
    reader.onload = () => {
      this._knowledgeFileContent = reader.result;
      if (fileInfo) {
        fileInfo.style.display = '';
        fileInfo.textContent = `File loaded: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
      }
      // Auto-fill title from filename if empty
      const titleInput = document.getElementById('knowledge-title');
      if (titleInput && !titleInput.value) {
        titleInput.value = file.name.replace(/\.[^.]+$/, '');
      }
    };
    reader.onerror = () => {
      alert('Failed to read file.');
    };
    reader.readAsText(file);
  }

  async _saveKnowledge() {
    const project = this._currentProject;
    if (!project) {
      alert('Open a project first.');
      return;
    }

    const title = document.getElementById('knowledge-title')?.value?.trim();
    if (!title) {
      alert('Please enter a title for this knowledge entry.');
      return;
    }

    const type = document.getElementById('knowledge-type')?.value || 'research';
    const pastedContent = document.getElementById('knowledge-content')?.value?.trim();
    const content = this._knowledgeFileContent || pastedContent;

    if (!content) {
      alert('Please paste text or upload a file.');
      return;
    }

    const entry = {
      id: `kb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      projectId: project.id,
      title,
      type,
      content,
      wordCount: (content.match(/[a-zA-Z'''\u2019-]+/g) || []).length,
      createdAt: Date.now()
    };

    try {
      await this.localStorage.put('knowledgeBase', entry);
      this._knowledgeFileContent = null;

      // Reset form
      const titleInput = document.getElementById('knowledge-title');
      const contentArea = document.getElementById('knowledge-content');
      const pasteArea = document.getElementById('knowledge-paste-area');
      const fileInfo = document.getElementById('knowledge-file-info');
      if (titleInput) titleInput.value = '';
      if (contentArea) contentArea.value = '';
      if (pasteArea) pasteArea.style.display = 'none';
      if (fileInfo) fileInfo.style.display = 'none';

      this._renderKnowledgeList();
    } catch (err) {
      alert('Failed to save knowledge: ' + err.message);
    }
  }

  async _deleteKnowledge(knowledgeId) {
    if (!confirm('Delete this knowledge entry?')) return;
    try {
      await this.localStorage.delete('knowledgeBase', knowledgeId);
      this._renderKnowledgeList();
    } catch (err) {
      alert('Failed to delete: ' + err.message);
    }
  }

  async _renderKnowledgeList() {
    const listEl = document.getElementById('knowledge-list');
    if (!listEl) return;

    const project = this._currentProject;
    if (!project) {
      listEl.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">Open a project first.</p>';
      return;
    }

    try {
      const allKnowledge = await this.localStorage.getAll('knowledgeBase');
      const projectKnowledge = allKnowledge.filter(k => k.projectId === project.id);

      if (projectKnowledge.length === 0) {
        listEl.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">No knowledge imported yet.</p>';
        return;
      }

      const typeLabels = {
        research: 'Research',
        reference: 'Reference',
        wikipedia: 'Wikipedia',
        notes: 'Notes',
        other: 'Other'
      };

      listEl.innerHTML = projectKnowledge.map(k => `
        <div style="padding:8px; margin-bottom:8px; background:var(--bg-secondary); border-radius:var(--radius-sm); border:1px solid var(--border-color);">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong style="font-size:14px;">${this._esc(k.title)}</strong>
            <button class="btn btn-sm knowledge-delete-btn" data-knowledge-id="${k.id}" style="padding:2px 8px; border-color:var(--danger); color:var(--danger); font-size:12px;">&times;</button>
          </div>
          <div style="font-size:12px; color:var(--text-muted); margin-top:4px;">
            ${typeLabels[k.type] || k.type} &bull; ${(k.wordCount || 0).toLocaleString()} words &bull; ${new Date(k.createdAt).toLocaleDateString()}
          </div>
        </div>
      `).join('');
    } catch (err) {
      listEl.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">Failed to load knowledge.</p>';
    }
  }

  async _getProjectKnowledge() {
    const project = this._currentProject;
    if (!project) return '';

    try {
      const allKnowledge = await this.localStorage.getAll('knowledgeBase');
      const projectKnowledge = allKnowledge.filter(k => k.projectId === project.id);
      if (projectKnowledge.length === 0) return '';

      let knowledgePrompt = '\n=== PROJECT KNOWLEDGE BASE (AUTHORITATIVE REFERENCE MATERIALS) ===\n';
      knowledgePrompt += 'The following reference materials have been imported for this project. You MUST actively consult them during writing.\n';
      knowledgePrompt += 'INSTRUCTIONS:\n';
      knowledgePrompt += '- Use facts, names, dates, locations, and details from these materials for accuracy\n';
      knowledgePrompt += '- Incorporate relevant information to enrich prose, outlines, and character development\n';
      knowledgePrompt += '- When knowledge files contain historical facts, technical details, or world-building, weave them naturally into the narrative\n';
      knowledgePrompt += '- Do NOT contradict information in these reference materials\n\n';

      // Build a brief overview index first
      knowledgePrompt += 'KNOWLEDGE FILES INDEX:\n';
      for (let i = 0; i < projectKnowledge.length; i++) {
        const k = projectKnowledge[i];
        const wordCount = (k.content.match(/[a-zA-Z]+/g) || []).length;
        knowledgePrompt += `  ${i + 1}. "${k.title}" (${k.type}) — ${wordCount.toLocaleString()} words\n`;
      }
      knowledgePrompt += '\nFULL REFERENCE MATERIALS:\n\n';

      for (const k of projectKnowledge) {
        // Truncate very long knowledge entries to keep prompt manageable
        const truncated = k.content.length > 8000
          ? k.content.slice(0, 8000) + '\n[... truncated ...]'
          : k.content;
        knowledgePrompt += `--- ${k.title} (${k.type}) ---\n${truncated}\n\n`;
      }

      knowledgePrompt += '=== END PROJECT KNOWLEDGE BASE ===\n';

      // Silently log the scan (no UI display)
      console.log(`[Knowledge Scan] Project "${project.title}": ${projectKnowledge.length} knowledge file(s) loaded`);
      for (const k of projectKnowledge) {
        const wordCount = (k.content.match(/[a-zA-Z]+/g) || []).length;
        console.log(`  - "${k.title}" (${k.type}): ${wordCount.toLocaleString()} words`);
      }

      return knowledgePrompt;
    } catch (err) {
      return '';
    }
  }

  _registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      const swPath = new URL('sw.js', window.location.href).pathname;
      navigator.serviceWorker.register(swPath).catch(() => {
        // Service worker registration failed — app still works without it
      });

      // When a new SW activates, it posts SW_UPDATED — reload to get fresh code
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'SW_UPDATED') {
          window.location.reload();
        }
      });
    }
  }

  // ======================================================
  // TRANSLATION SYSTEM
  // ======================================================

  _initTranslation() {
    // Toggle detail panels when adaptation checkboxes change
    document.querySelectorAll('.trans-option input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const detail = e.target.closest('.trans-option')?.querySelector('.trans-option-detail');
        if (detail) detail.style.display = e.target.checked ? '' : 'none';
        this._updateTranslationButton();
      });
    });

    // Enable/disable Begin Translation based on target language
    document.getElementById('trans-target-lang')?.addEventListener('change', () => {
      this._updateTranslationButton();
    });

    // Begin Translation
    document.getElementById('btn-start-translation')?.addEventListener('click', () => {
      this._beginTranslation();
    });

    // Close translation view
    document.getElementById('btn-close-translation')?.addEventListener('click', () => {
      this._closeTranslationView();
    });

    // Copy translation
    document.getElementById('btn-translation-copy')?.addEventListener('click', () => {
      const el = document.getElementById('editor-translation');
      if (el) {
        navigator.clipboard.writeText(el.innerText || el.textContent);
        alert('Translation copied to clipboard.');
      }
    });

    // Modal close buttons
    document.querySelectorAll('[data-close="modal-translation"]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('modal-translation').style.display = 'none';
      });
    });
  }

  _updateTranslationButton() {
    const btn = document.getElementById('btn-start-translation');
    const lang = document.getElementById('trans-target-lang')?.value;
    if (btn) btn.disabled = !lang;
  }

  _getTranslationSettings() {
    const targetLang = document.getElementById('trans-target-lang')?.value || '';
    const sourceLang = document.getElementById('trans-source-lang')?.value || 'en-US';
    const [targetLangCode, targetCountry] = targetLang.split('-');
    const [sourceLangCode, sourceCountry] = sourceLang.split('-');

    const langNames = {
      'es': 'Spanish', 'fr': 'French', 'it': 'Italian', 'de': 'German',
      'pt': 'Portuguese', 'ja': 'Japanese', 'ko': 'Korean', 'zh': 'Chinese',
      'nl': 'Dutch', 'sv': 'Swedish', 'pl': 'Polish', 'ru': 'Russian', 'en': 'English'
    };
    const countryNames = {
      'US': 'United States', 'GB': 'United Kingdom', 'AU': 'Australia',
      'ES': 'Spain', 'MX': 'Mexico', 'AR': 'Argentina',
      'FR': 'France', 'CA': 'Canada', 'IT': 'Italy',
      'DE': 'Germany', 'AT': 'Austria', 'BR': 'Brazil', 'PT': 'Portugal',
      'JP': 'Japan', 'KR': 'South Korea', 'CN': 'China',
      'NL': 'Netherlands', 'SE': 'Sweden', 'PL': 'Poland', 'RU': 'Russia'
    };

    return {
      sourceLang: langNames[sourceLangCode] || sourceLangCode,
      sourceCountry: countryNames[sourceCountry] || sourceCountry,
      targetLang: langNames[targetLangCode] || targetLangCode,
      targetCountry: countryNames[targetCountry] || targetCountry,
      targetLocale: targetLang,
      adaptNames: document.getElementById('trans-adapt-names')?.checked || false,
      namesMode: document.getElementById('trans-names-mode')?.value || 'translate',
      adaptLocations: document.getElementById('trans-adapt-locations')?.checked || false,
      locationsMode: document.getElementById('trans-locations-mode')?.value || 'equivalent',
      adaptBrands: document.getElementById('trans-adapt-brands')?.checked || false,
      adaptUnits: document.getElementById('trans-adapt-units')?.checked || false,
      adaptFood: document.getElementById('trans-adapt-food')?.checked || false,
      adaptCulture: document.getElementById('trans-adapt-culture')?.checked || false,
      adaptRegister: document.getElementById('trans-adapt-register')?.checked || false,
      registerMode: document.getElementById('trans-register-mode')?.value || 'contextual',
      adaptIdioms: document.getElementById('trans-adapt-idioms')?.checked || false,
      scope: document.querySelector('input[name="trans-scope"]:checked')?.value || 'current-chapter'
    };
  }

  async _beginTranslation() {
    const settings = this._getTranslationSettings();
    if (!settings.targetLang) return;

    // Close modal
    document.getElementById('modal-translation').style.display = 'none';

    // Open side-by-side view
    this._openTranslationView(settings);

    // Get text to translate based on scope
    let sourceText = '';
    if (settings.scope === 'selection') {
      const sel = window.getSelection();
      sourceText = sel?.toString() || '';
      if (!sourceText) {
        alert('No text selected. Please select text first.');
        return;
      }
    } else if (settings.scope === 'current-chapter') {
      sourceText = this.editor?.getContent() || '';
    } else {
      // all-chapters
      const chapters = await this.fs.getProjectChapters(this.state.currentProjectId);
      const texts = [];
      for (const ch of chapters) {
        texts.push(`\n\n--- ${ch.title} ---\n\n${ch.content || ''}`);
      }
      sourceText = texts.join('');
    }

    if (!sourceText.trim()) {
      alert('No text to translate.');
      return;
    }

    await this._executeTranslation(sourceText, settings);
  }

  _openTranslationView(settings) {
    const editorArea = document.getElementById('editor-area');
    if (editorArea) editorArea.classList.add('translation-active');

    // Show headers
    const origHeader = document.getElementById('editor-pane-header-original');
    if (origHeader) origHeader.style.display = '';

    const translationPane = document.getElementById('editor-container-translation');
    if (translationPane) translationPane.style.display = '';

    // Set labels
    const origLang = document.getElementById('pane-lang-original');
    if (origLang) origLang.textContent = `${settings.sourceLang} (${settings.sourceCountry})`;

    const transLang = document.getElementById('pane-lang-translation');
    if (transLang) transLang.textContent = `${settings.targetLang} (${settings.targetCountry})`;

    // Clear previous translation
    const transEditor = document.getElementById('editor-translation');
    if (transEditor) transEditor.innerHTML = '<p style="color:var(--text-muted);font-style:italic;">Preparing translation...</p>';

    // Show progress
    const progress = document.getElementById('translation-progress');
    if (progress) progress.style.display = '';
  }

  _closeTranslationView() {
    const editorArea = document.getElementById('editor-area');
    if (editorArea) editorArea.classList.remove('translation-active');

    const origHeader = document.getElementById('editor-pane-header-original');
    if (origHeader) origHeader.style.display = 'none';

    const translationPane = document.getElementById('editor-container-translation');
    if (translationPane) translationPane.style.display = 'none';
  }

  async _executeTranslation(sourceText, settings) {
    if (!this.generator?.apiKey) {
      alert('Set your Anthropic API key in Settings first.');
      return;
    }

    const transEditor = document.getElementById('editor-translation');
    const progressBar = document.getElementById('translation-progress-bar');
    const progressText = document.getElementById('translation-progress-text');

    // Build the cultural adaptation instructions
    let adaptationRules = '';

    if (settings.adaptNames) {
      const modeDesc = {
        'translate': 'Translate character names to local equivalents (e.g., William \u2192 Guglielmo, Mary \u2192 Maria)',
        'phonetic': 'Adapt name spellings for local pronunciation while keeping them recognizable',
        'keep-first': 'Keep first names unchanged but translate/adapt surnames'
      };
      adaptationRules += `\n\nCHARACTER NAMES: ${modeDesc[settings.namesMode] || modeDesc.translate}`;
    } else {
      adaptationRules += `\n\nCHARACTER NAMES: Keep all character names exactly as they are in the original.`;
    }

    if (settings.adaptLocations) {
      const modeDesc = {
        'equivalent': `Replace locations with culturally equivalent places in ${settings.targetCountry}. Research and use real places that match the original's social status, geography, climate, and narrative function.`,
        'same-country-translate': 'Keep the same locations but translate place names where applicable.',
        'relocate-full': `Fully relocate the entire story to ${settings.targetCountry}. All places, institutions, geography, and regional details should be adapted to feel native to ${settings.targetCountry}.`
      };
      adaptationRules += `\n\nLOCATIONS & SETTINGS: ${modeDesc[settings.locationsMode] || modeDesc.equivalent}`;
    }

    if (settings.adaptBrands) {
      adaptationRules += `\n\nVEHICLES, BRANDS & PRODUCTS: Replace with locally popular equivalents in ${settings.targetCountry}. American cars \u2192 local market cars. Store brands \u2192 local chain brands. Global brands (Apple, Samsung) can stay.`;
    }

    if (settings.adaptUnits) {
      adaptationRules += `\n\nCURRENCY & MEASUREMENTS: Convert all measurements to local standards. USD \u2192 local currency (adjust for approximate economic equivalence). Miles \u2192 kilometers. Fahrenheit \u2192 Celsius. Acres \u2192 hectares. Feet/inches \u2192 meters/centimeters. Pounds \u2192 kilograms.`;
    }

    if (settings.adaptFood) {
      adaptationRules += `\n\nFOOD & CUISINE: Replace dishes with local equivalents that carry the same cultural weight and context in ${settings.targetCountry}.`;
    }

    if (settings.adaptCulture) {
      adaptationRules += `\n\nCULTURAL REFERENCES: Adapt holidays, institutions, customs, sports, entertainment references, and social norms to ${settings.targetCountry} equivalents.`;
    }

    if (settings.adaptRegister) {
      const regDesc = {
        'contextual': 'Choose formal or informal address based on each character relationship. Strangers and authority figures \u2192 formal. Close friends and family \u2192 informal.',
        'formal': 'Default to formal address (vous/usted/Sie/Lei) except in very intimate scenes.',
        'informal': 'Default to informal address (tu/t\u00fa/du/tu) to create a casual, accessible tone.'
      };
      adaptationRules += `\n\nFORMAL/INFORMAL REGISTER: ${regDesc[settings.registerMode] || regDesc.contextual}`;
    }

    if (settings.adaptIdioms) {
      adaptationRules += `\n\nIDIOMS & EXPRESSIONS: Replace English idioms and colloquialisms with equivalent expressions in ${settings.targetLang} that carry the same meaning and emotional weight. Never translate idioms literally.`;
    }

    const systemPrompt = `You are an expert literary translator specializing in ${settings.sourceLang}-to-${settings.targetLang} fiction translation. You have deep knowledge of both cultures and produce translations that read as if the story were originally written in ${settings.targetLang}.

=== TRANSLATION PRINCIPLES ===
1. LITERARY QUALITY: The translation must read as polished ${settings.targetLang} prose, not as translated text. Match the original's literary register, rhythm, and voice.
2. CULTURAL AUTHENTICITY: Adapted elements must feel genuinely ${settings.targetCountry} \u2014 as if a ${settings.targetCountry} author wrote them.
3. NARRATIVE FIDELITY: The story's emotional arc, character relationships, themes, and plot must be preserved exactly.
4. CONSISTENCY: Maintain consistent terminology throughout.
5. VOICE MATCHING: Mirror the original's style \u2014 plain voice stays plain, ornate stays ornate.

=== TARGET: ${settings.targetLang} (${settings.targetCountry}) ===
${adaptationRules}

=== OUTPUT FORMAT ===
- Output ONLY the translated text. No commentary, no notes, no bracketed explanations.
- Preserve all paragraph breaks, scene breaks (* * *), and chapter headings.
- Maintain the same approximate word count as the original (\u00b115%).`;

    // Chunk the text for API calls
    const chunks = this._splitTextForTranslation(sourceText, 2000);
    let translatedParts = [];

    if (transEditor) transEditor.innerHTML = '';

    for (let i = 0; i < chunks.length; i++) {
      if (progressBar) progressBar.style.width = `${((i) / chunks.length) * 100}%`;
      if (progressText) progressText.textContent = `Translating part ${i + 1} of ${chunks.length}...`;

      try {
        const contextBefore = translatedParts.length > 0
          ? `\n\n[Previous translated text for context \u2014 do NOT repeat this, continue from where it ends:]\n${translatedParts[translatedParts.length - 1].slice(-500)}`
          : '';

        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.generator.apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
          },
          body: JSON.stringify({
            model: this.generator.model || 'claude-sonnet-4-20250514',
            max_tokens: 4096,
            system: systemPrompt,
            messages: [{
              role: 'user',
              content: `Translate the following ${settings.sourceLang} text into ${settings.targetLang} (${settings.targetCountry}). Apply all cultural adaptation rules specified in your instructions.${contextBefore}\n\n---\n\n${chunks[i]}`
            }]
          })
        });

        if (!response.ok) {
          const err = await response.text();
          throw new Error(`API error: ${response.status} - ${err}`);
        }

        const result = await response.json();
        const translatedText = result.content?.[0]?.text || '';
        translatedParts.push(translatedText);

        // Append to translation editor
        if (transEditor) {
          const div = document.createElement('div');
          div.innerHTML = translatedText.split('\n').map(line =>
            line.trim() ? `<p>${this._esc(line)}</p>` : ''
          ).join('');
          transEditor.appendChild(div);
        }

      } catch (err) {
        console.error('Translation error:', err);
        if (transEditor) {
          const errDiv = document.createElement('p');
          errDiv.style.color = 'var(--danger)';
          errDiv.textContent = `Translation error on part ${i + 1}: ${err.message}`;
          transEditor.appendChild(errDiv);
        }
      }
    }

    if (progressBar) progressBar.style.width = '100%';
    if (progressText) progressText.textContent = `Translation complete \u2014 ${chunks.length} part${chunks.length > 1 ? 's' : ''} translated.`;

    // Save translation to project
    try {
      const fullTranslation = translatedParts.join('\n\n');
      const translations = this._currentProject?.translations || {};
      translations[settings.targetLocale] = {
        text: fullTranslation,
        settings: settings,
        translatedAt: new Date().toISOString(),
        chapterId: this.state.currentChapterId
      };
      await this.fs.updateProject(this.state.currentProjectId, { translations });
      if (this._currentProject) this._currentProject.translations = translations;
    } catch (err) {
      console.error('Failed to save translation:', err);
    }
  }

  // ========================================
  //  Localization Engine
  // ========================================

  /**
   * Phase 1: Use Claude to analyze prose for culture-specific elements.
   * Returns an array of localization items with suggestions.
   */
  async _analyzeForLocalization(proseText, targetLang, langConfig) {
    const apiKey = this.generator?.apiKey;
    if (!apiKey) return [];

    const analysisPrompt = `You are a cultural localization expert preparing an American English novel for publication in ${langConfig.name}-speaking markets.

Analyze the following prose and identify ALL elements that should be culturally adapted for a ${langConfig.name} audience. For each element, provide a suggested replacement.

CATEGORIES TO CHECK:
1. VEHICLES — American car brands/models → popular local equivalents
2. FOOD & DRINK — American brands, dishes, restaurants → local equivalents
3. CURRENCY — Dollar amounts → local currency with equivalent purchasing power
4. MEASUREMENTS — Imperial → metric (feet, miles, Fahrenheit, etc.)
5. HOLIDAYS & EVENTS — American holidays → local equivalents or explanations
6. GEOGRAPHY — American locations, stores, landmarks → local equivalents where they serve as generic references
7. SPORTS — American sports references → popular local sport equivalents
8. POP CULTURE — American TV shows, music, celebrities → local or global equivalents
9. EMERGENCY/GOVERNMENT — 911, legal terms, government agencies → local equivalents
10. EDUCATION — School system terms (high school, college, GPA) → local system terms
11. SOCIAL CUSTOMS — Tipping, dating customs, workplace norms → local norms
12. IDIOMS & EXPRESSIONS — American idioms → natural ${langConfig.name} equivalents
13. BRAND NAMES — American-specific brands → local or globally recognized alternatives

IMPORTANT RULES:
- Do NOT flag proper nouns that are character names
- Do NOT flag things that are universal/global (internet, smartphones, etc.)
- Do NOT flag historical references that are central to the plot
- DO flag things where a ${langConfig.name} reader would think "that's very American"
- Each suggestion should feel NATURAL to a ${langConfig.name} reader
- Include a brief reasoning for each suggestion

Respond ONLY with a JSON array. No other text. Each item:
{
  "category": "VEHICLES",
  "original_text": "the exact phrase from the source text",
  "context": "brief surrounding context so user knows where this appears",
  "suggestion": "the suggested replacement in ${langConfig.name}",
  "suggestion_english": "English translation of your suggestion for the author's reference",
  "reasoning": "Why this change helps the ${langConfig.name} reader"
}

If there are NO items to localize, return an empty array: []`;

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: this.generator.model || 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          messages: [{
            role: 'user',
            content: `${analysisPrompt}\n\nPROSE TO ANALYZE:\n\n${proseText}`
          }]
        })
      });

      if (!response.ok) throw new Error(`API error ${response.status}`);

      const data = await response.json();
      const rawText = data.content
        ?.filter(b => b.type === 'text')
        .map(b => b.text)
        .join('') || '[]';

      // Parse JSON — handle markdown code fences
      const cleaned = rawText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const items = JSON.parse(cleaned);
      return Array.isArray(items) ? items : [];

    } catch (err) {
      console.error('Localization analysis failed:', err);
      return []; // Graceful fallback — skip localization, proceed to translate
    }
  }

  /**
   * Phase 2: Show the localization review modal to the user.
   * Returns a promise that resolves with the user's decisions.
   */
  _showLocalizationReview(items, langConfig) {
    return new Promise((resolve) => {
      const modal = document.getElementById('localization-modal');
      if (!modal || items.length === 0) {
        resolve({ approved: [], skipped: true });
        return;
      }

      // Update header
      document.getElementById('localization-title').textContent =
        `${langConfig.flag} Cultural Localization: ${langConfig.name}`;
      document.getElementById('localization-subtitle').textContent =
        `Review ${items.length} AI-suggested cultural adaptation${items.length !== 1 ? 's' : ''} before translating`;
      document.getElementById('localization-lang-label').textContent = langConfig.name;
      document.getElementById('localization-count').textContent =
        `${items.length} item${items.length !== 1 ? 's' : ''} found`;

      // Build items list
      const listEl = document.getElementById('localization-items-list');
      listEl.innerHTML = '';

      const decisions = items.map((item, idx) => ({
        ...item,
        index: idx,
        status: 'pending', // pending | approved | rejected | custom
        customValue: null
      }));

      for (const dec of decisions) {
        const div = document.createElement('div');
        div.className = 'loc-item';
        div.id = `loc-item-${dec.index}`;
        div.innerHTML = `
          <div class="loc-item-category">${dec.category || ''}</div>
          <div class="loc-item-original">
            ...${dec.context || ''}... <strong>"${dec.original_text || ''}"</strong>
          </div>
          <div class="loc-item-suggestion">
            <span class="loc-item-arrow">&rarr;</span>
            <span class="loc-item-replacement">${dec.suggestion || ''}</span>
          </div>
          ${dec.suggestion_english ? `<div class="loc-item-reasoning">(${dec.suggestion_english})</div>` : ''}
          <div class="loc-item-reasoning">${dec.reasoning || ''}</div>
          <div class="loc-item-actions">
            <button class="loc-btn loc-btn-approve" data-idx="${dec.index}">Approve</button>
            <button class="loc-btn loc-btn-reject" data-idx="${dec.index}">Keep Original</button>
            <button class="loc-btn loc-btn-custom" data-idx="${dec.index}">Custom</button>
          </div>
          <input type="text" class="loc-custom-input" data-idx="${dec.index}"
                 placeholder="Type your preferred replacement...">
        `;
        listEl.appendChild(div);
      }

      // Wire up item buttons
      listEl.querySelectorAll('.loc-btn-approve').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.idx);
          decisions[idx].status = 'approved';
          const item = document.getElementById(`loc-item-${idx}`);
          item.className = 'loc-item approved';
          item.querySelector('.loc-custom-input').classList.remove('visible');
        });
      });

      listEl.querySelectorAll('.loc-btn-reject').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.idx);
          decisions[idx].status = 'rejected';
          const item = document.getElementById(`loc-item-${idx}`);
          item.className = 'loc-item rejected';
          item.querySelector('.loc-custom-input').classList.remove('visible');
        });
      });

      listEl.querySelectorAll('.loc-btn-custom').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.idx);
          decisions[idx].status = 'custom';
          const item = document.getElementById(`loc-item-${idx}`);
          item.className = 'loc-item approved';
          const input = item.querySelector('.loc-custom-input');
          input.classList.add('visible');
          input.focus();
          input.addEventListener('input', () => {
            decisions[idx].customValue = input.value;
          });
        });
      });

      // Footer buttons — clone to remove any prior event listeners
      const cloneBtn = (id) => {
        const el = document.getElementById(id);
        if (el) { const clone = el.cloneNode(true); el.replaceWith(clone); return clone; }
        return null;
      };

      const approveAllBtn = cloneBtn('btn-loc-approve-all');
      const skipAllBtn = cloneBtn('btn-loc-skip-all');
      const applyBtn = cloneBtn('btn-loc-apply');

      const cleanup = () => { modal.style.display = 'none'; };

      approveAllBtn?.addEventListener('click', () => {
        decisions.forEach(d => { if (d.status === 'pending') d.status = 'approved'; });
        listEl.querySelectorAll('.loc-item').forEach(el => {
          if (!el.classList.contains('rejected')) el.className = 'loc-item approved';
        });
      });

      skipAllBtn?.addEventListener('click', () => {
        cleanup();
        resolve({ approved: [], skipped: true });
      });

      applyBtn?.addEventListener('click', () => {
        const approved = decisions
          .filter(d => d.status === 'approved' || d.status === 'custom')
          .map(d => ({
            original: d.original_text,
            replacement: d.status === 'custom' && d.customValue
              ? d.customValue
              : d.suggestion,
            category: d.category
          }));
        cleanup();
        resolve({ approved, skipped: false });
      });

      // Show modal
      modal.style.display = 'flex';
    });
  }

  async _performTranslation(languages) {
    const btn = document.getElementById('btn-perform-translation');
    const originalBtnText = btn.textContent;
    btn.disabled = true;

    try {
      // ── 1. Validate ──
      const content = this.editor?.getContent() || '';
      const plainText = this._htmlToPlainText(content);

      if (!plainText || plainText.length < 50) {
        alert('No prose in the current chapter to translate. Write or generate prose first.');
        return;
      }

      const apiKey = this.generator?.apiKey;
      if (!apiKey) {
        alert('No Anthropic API key found. Please set your API key in settings.');
        return;
      }

      const projectId = this.state.currentProjectId;
      const chapterId = this.state.currentChapterId;

      if (!projectId || !chapterId) {
        alert('No chapter selected. Please select a chapter first.');
        return;
      }

      // Get chapter info from Firestore
      const chapter = await this.fs.getChapter(chapterId);
      const chapterTitle = chapter?.title || 'Untitled Chapter';
      const chapterNumber = chapter?.chapterNumber || 1;

      // ── 2. Language config ──
      const langConfig = {
        spanish:    { name: 'Spanish',    native: 'espa\u00f1ol',    code: 'es', flag: '\uD83C\uDDEA\uD83C\uDDF8', chapterWord: 'Cap\u00edtulo'  },
        french:     { name: 'French',     native: 'fran\u00e7ais',   code: 'fr', flag: '\uD83C\uDDEB\uD83C\uDDF7', chapterWord: 'Chapitre' },
        italian:    { name: 'Italian',    native: 'italiano',   code: 'it', flag: '\uD83C\uDDEE\uD83C\uDDF9', chapterWord: 'Capitolo' },
        german:     { name: 'German',     native: 'Deutsch',    code: 'de', flag: '\uD83C\uDDE9\uD83C\uDDEA', chapterWord: 'Kapitel'  },
        portuguese: { name: 'Portuguese', native: 'portugu\u00eas',  code: 'pt', flag: '\uD83C\uDDE7\uD83C\uDDF7', chapterWord: 'Cap\u00edtulo' },
        japanese:   { name: 'Japanese',   native: '\u65E5\u672C\u8A9E',      code: 'ja', flag: '\uD83C\uDDEF\uD83C\uDDF5', chapterWord: '\u7B2C'       }
      };

      const results = {};
      let completed = 0;

      // ── Show progress overlay (created dynamically for reliability) ──
      let prog = this._showProgressOverlay('Translating\u2026', `0 of ${languages.length} language(s)`, 'Starting\u2026');

      // ── 3. Translate each language (with localization analysis) ──
      for (const lang of languages) {
        completed++;
        const lc = langConfig[lang];
        const pct = ((completed - 1) / languages.length) * 100;

        // ═══ PHASE 1: LOCALIZATION ANALYSIS ═══
        btn.textContent = `Analyzing for ${lc.flag} ${lc.name} localization\u2026`;
        prog.update(`${lc.flag} ${lc.name}`, `Language ${completed} of ${languages.length}`, pct, 'Analyzing for cultural localization\u2026');
        const locItems = await this._analyzeForLocalization(plainText, lang, lc);

        // ═══ PHASE 2: HUMAN REVIEW (if items found) ═══
        let localizationInstructions = '';
        if (locItems.length > 0) {
          prog.remove();  // Remove overlay from DOM so user can interact with review modal
          const review = await this._showLocalizationReview(locItems, lc);
          // Re-create overlay after review completes
          prog = this._showProgressOverlay(
            `${lc.flag} ${lc.name}`,
            `Language ${completed} of ${languages.length}`,
            'Preparing translation\u2026'
          );
          prog.update(null, null, pct, 'Preparing translation\u2026');

          if (!review.skipped && review.approved.length > 0) {
            localizationInstructions = `\n\nCULTURAL LOCALIZATIONS (approved by author \u2014 apply these changes during translation):\n`;
            for (const item of review.approved) {
              localizationInstructions += `- Replace "${item.original}" with "${item.replacement}" [${item.category}]\n`;
            }
          }
        }

        // ═══ PHASE 3: TRANSLATE WITH LOCALIZATIONS ═══
        btn.textContent = `Translating ${completed}/${languages.length}: ${lc.flag} ${lc.name}\u2026`;
        prog.update(null, null, null, 'Translating prose\u2026');

        const systemPrompt = `You are an expert literary translator specializing in ${lc.name} (${lc.native}). Your translations read as if originally written by a skilled native-speaker novelist.

RULES:
- Preserve the author's narrative voice, tone, rhythm, and literary style
- Adapt idioms, metaphors, and cultural references naturally \u2014 never translate literally
- Use vocabulary and sentence structures natural to ${lc.name} literary fiction
- Preserve all paragraph breaks exactly
- Use ${lc.name} dialogue punctuation conventions (e.g., guillemets for French/Italian/Spanish)
- For emotional language, terms of endearment, humor: use what a native reader expects
- Output ONLY the translated prose \u2014 no notes, no commentary, no explanations
- Do NOT change content, plot, character actions, or proper nouns (character names stay in English unless they have established translations)
${lang === 'japanese' ? '\nUse standard modern Japanese (\u6A19\u6E96\u8A9E). Appropriate keigo for character relationships. Use Japanese quotation marks \u300C\u300D.' : ''}
${lang === 'spanish' ? '\nUse neutral Latin American Spanish.' : ''}
${lang === 'portuguese' ? '\nUse Brazilian Portuguese.' : ''}${localizationInstructions}`;

        try {
          // ── 3a. Translate the prose ──
          const proseResponse = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
              model: this.generator.model || 'claude-sonnet-4-20250514',
              max_tokens: 8192,
              system: systemPrompt,
              messages: [{
                role: 'user',
                content: `Translate the following prose into ${lc.name}:\n\n${plainText}`
              }]
            })
          });

          if (!proseResponse.ok) {
            const errData = await proseResponse.json().catch(() => ({}));
            throw new Error(`API ${proseResponse.status}: ${errData?.error?.message || proseResponse.statusText}`);
          }

          const proseData = await proseResponse.json();
          const translatedProse = proseData.content
            ?.filter(b => b.type === 'text')
            .map(b => b.text)
            .join('\n') || '';

          if (translatedProse.trim().length < 20) {
            throw new Error('Translation too short or empty');
          }

          // ── 3b. Translate the chapter title ──
          prog.update(null, null, null, 'Translating chapter title\u2026');
          const titleResponse = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
              model: this.generator.model || 'claude-sonnet-4-20250514',
              max_tokens: 200,
              messages: [{
                role: 'user',
                content: `Translate this chapter title into ${lc.name}. Return ONLY the translated title, nothing else.\n\nTitle: "${chapterTitle}"`
              }]
            })
          });

          let translatedTitle = chapterTitle;
          if (titleResponse.ok) {
            const titleData = await titleResponse.json();
            const rawTitle = titleData.content
              ?.filter(b => b.type === 'text')
              .map(b => b.text)
              .join('') || '';
            const cleanedTitle = rawTitle.replace(/^["'\u201C\u201D\u2018\u2019]+|["'\u201C\u201D\u2018\u2019]+$/g, '').trim();
            if (cleanedTitle) translatedTitle = cleanedTitle;
          }

          // ── 3c. Build the translated chapter name with flag indicator ──
          const translatedChapterName = `${lc.flag} ${translatedTitle}`;

          // ── 3d. Create a new chapter in Firestore for the translation ──
          prog.update(null, null, null, 'Saving translation\u2026');
          const translationChapterData = await this.fs.createChapter({
            projectId: projectId,
            chapterNumber: chapterNumber,
            title: translatedChapterName,
            content: translatedProse,
            status: 'translation'
          });

          // Update the chapter with translation metadata and recalculate word count
          await this.fs.updateChapter(translationChapterData.id, {
            content: translatedProse,
            isTranslation: true,
            sourceChapterId: chapterId,
            sourceChapterTitle: chapterTitle,
            language: lang,
            languageCode: lc.code,
            languageName: lc.name,
            languageFlag: lc.flag,
            localizations: localizationInstructions || null,
            translatedAt: new Date().toISOString()
          });

          // Also save to translations collection for backward compat
          const translationDocId = `${chapterId}_${lc.code}`;
          await this.fs.saveTranslation(translationDocId, {
            language: lang,
            languageCode: lc.code,
            languageName: lc.name,
            content: translatedProse,
            sourceWordCount: plainText.split(/\s+/).length,
            translatedAt: new Date().toISOString(),
            chapterId: chapterId,
            projectId: projectId,
            chapterTitle: chapterTitle,
            translationChapterId: translationChapterData.id
          });

          results[lang] = {
            success: true,
            translatedProse,
            translatedTitle: translatedChapterName,
            translationChapterId: translationChapterData.id,
            langConfig: lc
          };

          console.log(`${lc.flag} ${lc.name} translation saved as chapter: ${translatedChapterName}`);

        } catch (langErr) {
          console.error(`${lc.name} translation failed:`, langErr);
          results[lang] = { success: false, error: langErr.message };
        }
      }

      // ── Hide progress overlay ──
      prog.update(null, null, 100, 'Complete!');
      await new Promise(r => setTimeout(r, 600));
      prog.remove();

      // ── 4. Refresh chapter list to show new translated chapters ──
      await this._renderChapterList();
      await this.renderChapterNav();

      // Show the chapter filter bar since we now have translations
      const filterBar = document.getElementById('chapter-filter-bar');
      if (filterBar) filterBar.style.display = 'flex';

      // ── 4b. Populate export buttons immediately (don't wait for Setup Book panel) ──
      await this._populateExportButtons();

      // ── 5. Open side-by-side view with the first successful translation ──
      const firstSuccess = Object.entries(results).find(([, r]) => r.success);
      if (firstSuccess) {
        this._openTranslationSplitView(plainText, chapterTitle, results, langConfig);
      }

      // ── 6. Show summary ──
      const successCount = Object.values(results).filter(r => r.success).length;
      const failCount = languages.length - successCount;
      let summary = `Translation complete!\n\n${successCount} language(s) translated and saved as new chapters.`;
      if (failCount > 0) {
        summary += `\n${failCount} failed:`;
        for (const [lang, r] of Object.entries(results)) {
          if (!r.success) summary += `\n   \u2022 ${langConfig[lang].name}: ${r.error}`;
        }
      }
      alert(summary);

    } catch (err) {
      console.error('Translation failed:', err);
      alert('Translation failed: ' + err.message);
    } finally {
      this._removeProgressOverlay();
      btn.disabled = false;
      btn.textContent = originalBtnText;
      this._updateTranslateButton();
    }
  }

  // ========================================
  //  Translation Split View
  // ========================================

  /**
   * Open the side-by-side translation split view
   */
  _openTranslationSplitView(originalText, originalTitle, results, langConfig) {
    const overlay = document.getElementById('translation-split-view');
    if (!overlay) return;

    // Populate language dropdown
    const langSelect = document.getElementById('translation-lang-select');
    langSelect.innerHTML = '';
    const successfulLangs = Object.entries(results).filter(([, r]) => r.success);
    for (const [lang, r] of successfulLangs) {
      const opt = document.createElement('option');
      opt.value = lang;
      opt.textContent = `${r.langConfig.flag} ${r.langConfig.name}`;
      langSelect.appendChild(opt);
    }

    // Format original text as proper HTML with paragraphs
    const originalPane = document.getElementById('split-original-content');
    originalPane.innerHTML = this._proseToHTML(originalText);

    // Store for language switching
    this._translationResults = results;
    this._translationOriginalText = originalText;
    this._translationOriginalTitle = originalTitle;

    // Show first translation
    if (successfulLangs.length > 0) {
      langSelect.value = successfulLangs[0][0];
      this._showTranslationInPane(successfulLangs[0][0]);
    }

    langSelect.onchange = () => {
      if (langSelect.value) this._showTranslationInPane(langSelect.value);
    };

    overlay.style.display = 'flex';
    document.getElementById('translation-split-title').textContent =
      `Translation: ${originalTitle}`;
  }

  /**
   * Display a specific language translation in the right pane
   */
  _showTranslationInPane(lang) {
    const result = this._translationResults?.[lang];
    if (!result?.success) return;

    const translatedPane = document.getElementById('split-translated-content');
    translatedPane.innerHTML = this._proseToHTML(result.translatedProse);

    const label = document.getElementById('split-translated-label');
    label.textContent = `${result.langConfig.flag} ${result.langConfig.name.toUpperCase()} TRANSLATION`;
  }

  /**
   * Convert plain text prose into formatted HTML with proper paragraphs,
   * indentation, and scene breaks.
   */
  _proseToHTML(text) {
    if (!text) return '';

    const blocks = text.split(/\n\s*\n|\n/).map(b => b.trim()).filter(Boolean);

    let html = '';
    for (const block of blocks) {
      // Scene break markers
      if (/^[\*\s#-]{3,}$/.test(block) || block === '* * *' || block === '***') {
        html += `<div style="text-align:center;margin:24px 0;color:#888;letter-spacing:0.3em;">* * *</div>`;
        continue;
      }

      // Detect if this looks like a chapter title (short, no period at end)
      if (block.length < 80 && !block.endsWith('.') && !block.endsWith(',') && !block.endsWith('"')) {
        html += `<h3 style="font-family:Georgia,serif;font-size:1.2rem;font-weight:bold;margin:20px 0 16px;text-align:left;">${this._escapeHTML(block)}</h3>`;
      } else {
        html += `<p style="font-family:Georgia,serif;font-size:1.05rem;line-height:1.8;margin:0 0 12px;text-indent:2em;">${this._escapeHTML(block)}</p>`;
      }
    }

    return html;
  }

  /**
   * Escape HTML special characters
   */
  _escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Convert HTML content to plain text while preserving paragraph breaks.
   * Unlike a simple tag-strip, this inserts newlines for block-level elements
   * so that _proseToHTML() can reconstruct proper paragraphs.
   */
  _htmlToPlainText(html) {
    if (!html) return '';
    let text = html;
    // Normalize <br> variants to newlines
    text = text.replace(/<br\s*\/?>/gi, '\n');
    // Block-level closing tags → double newline (paragraph break)
    text = text.replace(/<\/(?:p|div|h[1-6]|li|blockquote)>/gi, '\n\n');
    // Remove all remaining HTML tags
    text = text.replace(/<[^>]+>/g, '');
    // Decode common HTML entities
    text = text.replace(/&amp;/g, '&')
               .replace(/&lt;/g, '<')
               .replace(/&gt;/g, '>')
               .replace(/&quot;/g, '"')
               .replace(/&#39;/g, "'")
               .replace(/&nbsp;/g, ' ');
    // Collapse runs of 3+ newlines into double newlines
    text = text.replace(/\n{3,}/g, '\n\n');
    return text.trim();
  }

  _escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ========================================
  //  Progress Overlay (dynamically created)
  // ========================================

  /**
   * Create and show a full-screen progress overlay with spinner, title,
   * detail text, progress bar, and step description.
   * Returns an object with update(), hide(), show(), and remove() methods.
   */
  _showProgressOverlay(title, detail, step) {
    // Remove any existing overlay first
    this._removeProgressOverlay();

    const el = document.createElement('div');
    el.id = 'genesis-progress-overlay';
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.75);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;';

    el.innerHTML = `
      <div style="background:#1e1e30;border:1px solid #c8a96e;border-radius:12px;padding:40px 48px;text-align:center;max-width:420px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.5);">
        <div id="gpo-spinner" style="width:48px;height:48px;margin:0 auto 20px;border:3px solid #333;border-top-color:#c8a96e;border-radius:50%;animation:gpo-spin 0.8s linear infinite;"></div>
        <h3 id="gpo-title" style="margin:0 0 8px;font-size:1.15rem;color:#eee;">${this._escapeHTML(title || '')}</h3>
        <p id="gpo-detail" style="margin:0 0 20px;font-size:0.85rem;color:#aaa;">${this._escapeHTML(detail || '')}</p>
        <div style="height:4px;background:#333;border-radius:2px;overflow:hidden;margin-bottom:12px;">
          <div id="gpo-fill" style="height:100%;width:0%;background:#c8a96e;border-radius:2px;transition:width 0.4s ease;"></div>
        </div>
        <p id="gpo-step" style="margin:0;font-size:0.75rem;color:#777;">${this._escapeHTML(step || '')}</p>
      </div>
    `;

    // Inject the spinner keyframe animation if not already present
    if (!document.getElementById('gpo-keyframes')) {
      const style = document.createElement('style');
      style.id = 'gpo-keyframes';
      style.textContent = '@keyframes gpo-spin { to { transform: rotate(360deg); } }';
      document.head.appendChild(style);
    }

    document.body.appendChild(el);

    const titleEl  = el.querySelector('#gpo-title');
    const detailEl = el.querySelector('#gpo-detail');
    const fillEl   = el.querySelector('#gpo-fill');
    const stepEl   = el.querySelector('#gpo-step');

    return {
      update: (t, d, pct, s) => {
        if (t != null) titleEl.textContent = t;
        if (d != null) detailEl.textContent = d;
        if (pct != null) fillEl.style.width = `${pct}%`;
        if (s != null) stepEl.textContent = s;
      },
      hide: () => { el.style.display = 'none'; },
      show: () => { el.style.display = 'flex'; },
      remove: () => { el.remove(); }
    };
  }

  /**
   * Remove the progress overlay if it exists (safety cleanup).
   */
  _removeProgressOverlay() {
    document.getElementById('genesis-progress-overlay')?.remove();
  }

  /**
   * Close the split view
   */
  _closeTranslationSplitView() {
    const overlay = document.getElementById('translation-split-view');
    if (overlay) overlay.style.display = 'none';
    this._translationResults = null;
  }

  /**
   * Open side-by-side view from a translated chapter.
   * Loads the original chapter content and shows comparison.
   */
  async _openComparisonFromChapter(translatedChapter) {
    try {
      const sourceId = translatedChapter.sourceChapterId;
      let originalText = '';
      let originalTitle = translatedChapter.sourceChapterTitle || 'Original';

      // Try to load the original chapter from Firestore
      try {
        const sourceChapter = await this.fs.getChapter(sourceId);
        if (sourceChapter) {
          originalText = this._htmlToPlainText(sourceChapter.content || '');
          originalTitle = sourceChapter.title || originalTitle;
        }
      } catch (e) {
        console.error('Could not load original chapter:', e);
      }

      if (!originalText) {
        alert('Could not load the original chapter for comparison.');
        return;
      }

      const translatedText = this._htmlToPlainText(translatedChapter.content || '');
      const lang = translatedChapter.language || 'unknown';
      const lc = {
        flag: translatedChapter.languageFlag || '',
        name: translatedChapter.languageName || lang
      };

      const results = {
        [lang]: {
          success: true,
          translatedProse: translatedText,
          translatedTitle: translatedChapter.title,
          langConfig: lc
        }
      };

      this._openTranslationSplitView(originalText, originalTitle, results, { [lang]: lc });
    } catch (err) {
      console.error('Failed to open comparison:', err);
      alert('Could not open comparison view: ' + err.message);
    }
  }

  // ========================================
  //  DOCX Export
  // ========================================

  /**
   * Export the selected translation from split view as Vellum-ready DOCX.
   */
  async _exportTranslationDocx() {
    try {
      const docx = window.docx;
      if (!docx) { alert('DOCX library not loaded.'); return; }

      const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = docx;

      const langSelect = document.getElementById('translation-lang-select');
      const selectedLang = langSelect?.value;
      if (!selectedLang || !this._translationResults?.[selectedLang]) {
        alert('No translation selected.');
        return;
      }

      const result = this._translationResults[selectedLang];
      const translatedText = result.translatedProse || '';
      const translatedTitle = (result.translatedTitle || 'Untitled')
        .replace(/^[\uD83C][\uDDE6-\uDDFF][\uD83C][\uDDE6-\uDDFF]\s*/, '');

      const children = [];

      // Chapter title
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 0, after: 200 },
        children: [new TextRun({
          text: translatedTitle,
          bold: true,
          size: 32,
          font: 'Times New Roman'
        })]
      }));

      // For translated content: it's plain text (from API), not HTML
      // Split on double newlines first, then single newlines
      const blocks = translatedText.split(/\n\s*\n/).filter(s => s.trim());

      for (const block of blocks) {
        const trimmed = block.trim();

        if (this._isSceneBreak(trimmed)) {
          children.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 240, after: 240 },
            children: [new TextRun({ text: '***', font: 'Times New Roman', size: 24 })]
          }));
          continue;
        }

        // Split on single newlines for sub-paragraphs
        const lines = trimmed.split(/\n/).filter(s => s.trim());
        for (const line of lines) {
          const t = line.trim();
          if (this._isSceneBreak(t)) {
            children.push(new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 240, after: 240 },
              children: [new TextRun({ text: '***', font: 'Times New Roman', size: 24 })]
            }));
          } else if (t) {
            children.push(new Paragraph({
              spacing: { before: 0, after: 200, line: 276 },
              children: [new TextRun({ text: t, font: 'Times New Roman', size: 24 })]
            }));
          }
        }
      }

      const project = this._currentProject || {};
      const doc = new Document({
        title: translatedTitle,
        creator: project.authorName || project.author || '',
        styles: {
          paragraphStyles: [{
            id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
            run: { size: 32, bold: true, font: 'Times New Roman' },
            paragraph: { spacing: { before: 240, after: 240 }, outlineLevel: 0 }
          }],
          default: { document: { run: { font: 'Times New Roman', size: 24 } } }
        },
        sections: [{
          properties: {
            page: {
              size: { width: 12240, height: 15840 },
              margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
            }
          },
          children
        }]
      });

      const blob = await Packer.toBlob(doc);
      const filename = translatedTitle.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '_') + '_Vellum.docx';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

    } catch (err) {
      console.error('Translation DOCX export failed:', err);
      alert('Export failed: ' + err.message);
    }
  }

  /**
   * Export manuscript as Vellum-ready DOCX.
   * Parses editor HTML to preserve paragraph structure, bold/italic, and scene breaks.
   * @param {string|null} languageCode - null for original English, 'it'/'es'/etc. for translation
   */
  async _exportFullManuscriptDocx(languageCode = null) {
    try {
      const docx = window.docx;
      if (!docx) {
        alert('DOCX library not loaded. Please refresh the page.');
        return;
      }

      const {
        Document, Packer, Paragraph, TextRun, PageBreak,
        HeadingLevel, AlignmentType, ImageRun
      } = docx;

      // Fetch all chapters for this project
      const allProjectChapters = await this.fs.getProjectChapters(this.state.currentProjectId);

      const chaptersToExport = allProjectChapters
        .filter(ch => {
          if (languageCode) {
            return ch.isTranslation && ch.languageCode === languageCode;
          } else {
            return !ch.isTranslation;
          }
        })
        .sort((a, b) => (a.chapterNumber || 0) - (b.chapterNumber || 0));

      if (chaptersToExport.length === 0) {
        alert(languageCode
          ? `No translated chapters found for language code "${languageCode}".`
          : 'No chapters found to export.');
        return;
      }

      const project = this._currentProject || {};
      const bookTitle = project.title || 'Untitled';
      const authorName = project.authorName || project.author || '';

      // Build document content
      const children = [];

      // Add cover image as first page if available
      if (project.coverImage && ImageRun) {
        try {
          const coverData = await this._dataUrlToUint8Array(project.coverImage);
          if (coverData) {
            // Page content area: 6.5 x 9 inches (letter with 1in margins)
            const maxWPx = 468; // 6.5 * 72
            const maxHPx = 648; // 9 * 72
            const dims = await this._getImageDimensions(project.coverImage);
            let w = maxWPx;
            let h = maxHPx;
            if (dims) {
              const scale = Math.min(maxWPx / dims.width, maxHPx / dims.height);
              w = Math.round(dims.width * scale);
              h = Math.round(dims.height * scale);
            }
            children.push(new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new ImageRun({
                data: coverData,
                transformation: { width: w, height: h },
                type: project.coverImage.includes('image/png') ? 'png' : 'jpg'
              })]
            }));
            children.push(new Paragraph({ children: [new PageBreak()] }));
          }
        } catch (coverErr) {
          console.warn('Could not embed cover image in DOCX:', coverErr);
        }
      }

      for (let i = 0; i < chaptersToExport.length; i++) {
        const chapter = chaptersToExport[i];
        const chapterTitle = (chapter.title || `Chapter ${i + 1}`)
          .replace(/^[\uD83C][\uDDE6-\uDDFF][\uD83C][\uDDE6-\uDDFF]\s*/, '');

        // Page break before each chapter (except the first)
        if (i > 0) {
          children.push(new Paragraph({ children: [new PageBreak()] }));
        }

        // Chapter title as Heading 1 — this is how Vellum detects chapters
        children.push(new Paragraph({
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 0, after: 200 },
          children: [new TextRun({
            text: chapterTitle,
            bold: true,
            size: 32,
            font: 'Times New Roman'
          })]
        }));

        // Parse the chapter content HTML into paragraphs (strip leading heading to avoid duplication)
        const htmlContent = (chapter.content || '').replace(/^\s*<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>\s*/i, '');
        const paragraphs = this._parseHTMLToParagraphs(htmlContent);

        for (const para of paragraphs) {
          if (para.type === 'empty') continue;

          if (para.type === 'scene-break') {
            children.push(new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 240, after: 240 },
              children: [new TextRun({
                text: '***',
                font: 'Times New Roman',
                size: 24
              })]
            }));
            continue;
          }

          // Regular paragraph — create TextRuns preserving bold/italic
          const textRuns = para.runs.map(run => new TextRun({
            text: run.text,
            font: 'Times New Roman',
            size: 24,
            bold: run.bold || undefined,
            italics: run.italic || undefined
          }));

          children.push(new Paragraph({
            spacing: { before: 0, after: 200, line: 276 },
            children: textRuns
          }));
        }
      }

      // Create the document
      const doc = new Document({
        title: bookTitle,
        creator: authorName,
        description: `${bookTitle} by ${authorName}`,
        styles: {
          paragraphStyles: [
            {
              id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
              run: { size: 32, bold: true, font: 'Times New Roman' },
              paragraph: { spacing: { before: 240, after: 240 }, outlineLevel: 0 }
            },
            {
              id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
              run: { size: 28, bold: true, font: 'Times New Roman' },
              paragraph: { spacing: { before: 180, after: 180 }, outlineLevel: 1 }
            }
          ],
          default: {
            document: { run: { font: 'Times New Roman', size: 24 } }
          }
        },
        sections: [{
          properties: {
            page: {
              size: { width: 12240, height: 15840 },
              margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
            }
          },
          children
        }]
      });

      // Export and download
      const blob = await Packer.toBlob(doc);

      let filename = bookTitle.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '_');
      if (languageCode) {
        const langNames = { es: 'Spanish', fr: 'French', it: 'Italian', de: 'German', pt: 'Portuguese', ja: 'Japanese' };
        filename += `_${langNames[languageCode] || languageCode}`;
      }
      filename += '_Vellum.docx';

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

    } catch (err) {
      console.error('DOCX export failed:', err);
      alert('Export failed: ' + err.message);
    }
  }

  /**
   * Parse editor HTML content into an array of paragraph objects.
   * Each paragraph contains typed runs preserving bold/italic formatting.
   *
   * TipTap/ContentEditable outputs HTML like:
   *   <p>Regular text <em>italic text</em> more text <strong>bold</strong></p>
   *   <p>* * *</p>
   *   <p>Next paragraph</p>
   *
   * Returns: [
   *   { type: 'paragraph', runs: [{text, bold, italic}, ...] },
   *   { type: 'scene-break' },
   *   { type: 'paragraph', runs: [{text, bold, italic}] },
   * ]
   */
  _parseHTMLToParagraphs(html) {
    if (!html || typeof html !== 'string') return [];

    const results = [];

    // Use DOMParser to properly parse the HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Get all block-level elements
    const blocks = doc.body.querySelectorAll('p, h1, h2, h3, h4, h5, h6, div, blockquote');

    // If no block elements found, treat the entire content as plain text
    if (blocks.length === 0) {
      const text = doc.body.textContent?.trim() || '';
      if (!text) return results;

      // Try splitting on double newlines as fallback
      const chunks = text.split(/\n\s*\n/).filter(s => s.trim());
      if (chunks.length > 1) {
        for (const chunk of chunks) {
          const trimmed = chunk.trim();
          if (this._isSceneBreak(trimmed)) {
            results.push({ type: 'scene-break' });
          } else {
            const subLines = trimmed.split(/\n/).filter(s => s.trim());
            for (const line of subLines) {
              if (this._isSceneBreak(line.trim())) {
                results.push({ type: 'scene-break' });
              } else {
                results.push({ type: 'paragraph', runs: [{ text: line.trim(), bold: false, italic: false }] });
              }
            }
          }
        }
      } else {
        results.push({ type: 'paragraph', runs: [{ text: text, bold: false, italic: false }] });
      }
      return results;
    }

    // Process each block element
    for (const block of blocks) {
      const textContent = block.textContent?.trim() || '';

      // Skip truly empty elements
      if (!textContent) {
        results.push({ type: 'empty' });
        continue;
      }

      // Detect scene breaks
      if (this._isSceneBreak(textContent)) {
        results.push({ type: 'scene-break' });
        continue;
      }

      // Extract formatted runs from this paragraph
      const runs = this._extractTextRuns(block);

      if (runs.length > 0) {
        results.push({ type: 'paragraph', runs });
      }
    }

    return results;
  }

  /**
   * Check if text is a scene break marker.
   */
  _dataUrlToUint8Array(dataUrl) {
    return new Promise((resolve) => {
      try {
        const parts = dataUrl.split(',');
        if (parts.length < 2) { resolve(null); return; }
        const byteString = atob(parts[1]);
        const bytes = new Uint8Array(byteString.length);
        for (let i = 0; i < byteString.length; i++) {
          bytes[i] = byteString.charCodeAt(i);
        }
        resolve(bytes);
      } catch (e) {
        resolve(null);
      }
    });
  }

  _getImageDimensions(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  _isSceneBreak(text) {
    if (!text) return false;
    const t = text.trim();
    return (
      t === '***' ||
      t === '* * *' ||
      t === '---' ||
      t === '\u2013 \u2013 \u2013' ||
      t === '\u2014 \u2014 \u2014' ||
      t === '###' ||
      t === '# # #' ||
      t === '+++' ||
      /^\*\s*\*\s*\*$/.test(t) ||
      /^[-\u2013\u2014]{3,}$/.test(t) ||
      /^#\s*#\s*#$/.test(t)
    );
  }

  /**
   * Walk the DOM of a paragraph element and extract text runs
   * preserving bold and italic formatting.
   *
   * Handles nested tags like: <p>Text <em>italic <strong>bold-italic</strong></em> more</p>
   */
  _extractTextRuns(element) {
    const runs = [];

    function walk(node, inherited) {
      const state = {
        bold: inherited.bold,
        italic: inherited.italic
      };

      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent;
        if (text) {
          runs.push({ text, bold: state.bold, italic: state.italic });
        }
        return;
      }

      if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = node.tagName.toLowerCase();

        if (tag === 'b' || tag === 'strong') state.bold = true;
        if (tag === 'i' || tag === 'em') state.italic = true;

        // Handle <br> as a space
        if (tag === 'br') {
          runs.push({ text: ' ', bold: state.bold, italic: state.italic });
          return;
        }

        for (const child of node.childNodes) {
          walk(child, state);
        }
      }
    }

    walk(element, { bold: false, italic: false });

    // Merge adjacent runs with same formatting to reduce XML size
    const merged = [];
    for (const run of runs) {
      if (merged.length > 0) {
        const last = merged[merged.length - 1];
        if (last.bold === run.bold && last.italic === run.italic) {
          last.text += run.text;
          continue;
        }
      }
      merged.push({ ...run });
    }

    return merged;
  }

  // ========================================
  //  Export Buttons & Chapter Filter
  // ========================================

  /**
   * Populate translation export buttons based on which languages have translated chapters.
   */
  async _populateExportButtons() {
    const container = document.getElementById('export-translation-buttons');
    if (!container) return;
    container.innerHTML = '';

    // Find which languages have translated chapters
    const allChapters = await this.fs.getProjectChapters(this.state.currentProjectId);
    const translatedLangs = new Map();
    for (const ch of allChapters) {
      if (ch.isTranslation && ch.languageCode && ch.languageFlag) {
        translatedLangs.set(ch.languageCode, {
          flag: ch.languageFlag,
          name: ch.languageName || ch.languageCode
        });
      }
    }

    if (translatedLangs.size === 0) {
      container.innerHTML = '<p style="font-size:0.8rem;color:var(--text-muted);">No translations yet. Use Translation above to create them.</p>';
      return;
    }

    for (const [code, info] of translatedLangs) {
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.style.cssText = 'width:100%;';
      btn.textContent = `${info.flag} Export ${info.name} Translation`;
      btn.addEventListener('click', async () => {
        await this._exportFullManuscriptDocx(code);
      });
      container.appendChild(btn);
    }

    // Show filter bar if translations exist
    const filterBar = document.getElementById('chapter-filter-bar');
    if (filterBar) filterBar.style.display = 'flex';
  }

  /**
   * Filter the chapter list sidebar by original/translated/all
   */
  _filterChapterList(filter) {
    const chapterItems = document.querySelectorAll('.tree-item.chapter[data-id]');
    chapterItems.forEach(item => {
      const chapterTitle = item.querySelector('.name')?.textContent || '';
      // Translated chapters have flag emoji prefixes
      const isTranslation = /^[\uD83C][\uDDE6-\uDDFF][\uD83C][\uDDE6-\uDDFF]\s/.test(chapterTitle);

      if (filter === 'all') {
        item.style.display = '';
      } else if (filter === 'original') {
        item.style.display = isTranslation ? 'none' : '';
      } else if (filter === 'translations') {
        item.style.display = isTranslation ? '' : 'none';
      }
    });
  }

  _splitTextForTranslation(text, maxWords) {
    const paragraphs = text.split(/\n\s*\n/);
    const chunks = [];
    let current = '';
    let currentWords = 0;

    for (const para of paragraphs) {
      const paraWords = para.split(/\s+/).length;
      if (currentWords + paraWords > maxWords && current.trim()) {
        chunks.push(current.trim());
        current = '';
        currentWords = 0;
      }
      current += para + '\n\n';
      currentWords += paraWords;
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks.length > 0 ? chunks : [text];
  }
}

// --- Initialize ---
document.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.init().catch(err => {
    console.error('Genesis 2 initialization failed:', err);
  });

  // Expose for debugging
  window.__genesis = app;
});
