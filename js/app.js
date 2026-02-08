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

    this.state = {
      currentUser: null,
      currentProjectId: null,
      currentChapterId: null,
      sidebarTab: 'chapters',
      focusMode: false,
      sidebarOpen: true,
      theme: 'dark',
      dailyGoal: 1000,
      wordsToday: 0,
      sessionStart: Date.now()
    };

    // Cached project data to avoid extra Firestore reads
    this._currentProject = null;
    this._chapterWordCounts = {};
    this._autoSaveInterval = null;
    this._currentChapterOutline = '';
    this._lastProseReview = null;
    this._lastGeneratedText = '';
  }

  async init() {
    // Initialize local storage (for settings, characters, notes)
    await this.localStorage.init();
    this.manuscript = new ManuscriptManager(this.localStorage);

    // Initialize modules
    this.exporter = new ExportManager(this.fs);
    this.generator = new ProseGenerator(this.localStorage);
    await this.generator.init();

    // Load settings
    this.state.theme = await this.localStorage.getSetting('theme', 'dark');
    this.state.dailyGoal = await this.localStorage.getSetting('dailyGoal', 1000);
    this._hfToken = await this.localStorage.getSetting('hfToken', '');

    // Apply theme
    this._applyTheme(this.state.theme);

    // Initialize editor
    const editorEl = document.getElementById('editor');
    this.editor = new Editor(editorEl, {
      onChange: (content) => this._onEditorChange(content),
      onWordCount: (count) => this._onWordCountUpdate(count)
    });

    // Bind UI events
    this._bindEvents();

    // Check for saved user
    this.state.currentUser = window.localStorage.getItem('genesis2_userName') || null;

    // Show landing page
    await this._showLanding();

    // Track daily words
    await this._loadDailyProgress();

    // Register service worker
    this._registerServiceWorker();
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
  //  Project & Chapter Management
  // ========================================

  async _loadProject(projectId) {
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

      // Render chapter list
      await this._renderChapterList();

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
        this.editor.clear();
        this.state.currentChapterId = null;
        this._showWelcome();
      }

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
      alert('Failed to load project. Check your internet connection.');
      await this._showLanding();
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
      this._currentChapterOutline = chapter.outline || '';
      this.editor.setContent(chapter.content || '');

      // Display chapter outline if available
      const outlineDisplay = document.getElementById('chapter-outline-display');
      const outlineText = document.getElementById('chapter-outline-text');
      if (outlineDisplay && outlineText) {
        if (this._currentChapterOutline) {
          outlineText.textContent = this._currentChapterOutline;
          outlineDisplay.style.display = '';
        } else {
          outlineDisplay.style.display = 'none';
        }
      }

      // Update active state in tree
      document.querySelectorAll('.tree-item').forEach(el => {
        el.classList.toggle('active', el.dataset.id === chapterId);
      });

      // Update toolbar chapter title
      const titleEl = document.getElementById('scene-title');
      if (titleEl) titleEl.textContent = chapter.title;
    } catch (err) {
      console.error('Failed to load chapter:', err);
    }
  }

  async _saveCurrentChapter() {
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
    const container = document.getElementById('sidebar-chapters');
    if (!container || !this.state.currentProjectId) return;

    try {
      const chapters = await this.fs.getProjectChapters(this.state.currentProjectId);

      let html = '';

      // Chapter toolbar with Select All, Delete Selected, Accept Outline
      if (chapters.length > 0) {
        html += `
        <div class="chapter-toolbar">
          <label class="chapter-select-all-label">
            <input type="checkbox" id="chapter-select-all" title="Select All">
            <span>Select All</span>
          </label>
          <button class="btn btn-sm chapter-toolbar-btn chapter-delete-selected-btn" id="btn-delete-selected-chapters" disabled title="Delete selected chapters">Delete Selected</button>
          <button class="btn btn-sm chapter-toolbar-btn chapter-accept-outline-btn" id="btn-accept-chapter-outline" title="Accept outline and begin prose generation">Accept Outline</button>
        </div>`;
      }

      for (const chapter of chapters) {
        const statusLabel = chapter.status === 'complete' ? 'done' : chapter.status === 'revision' ? 'rev' : '';
        const hasOutline = chapter.outline ? ' title="Has outline"' : '';
        const outlineIcon = chapter.outline ? '<span style="color:var(--accent-primary);font-size:0.7rem;margin-right:2px;">&#9998;</span>' : '';
        html += `
        <div class="tree-item chapter ${chapter.id === this.state.currentChapterId ? 'active' : ''}"
             data-id="${chapter.id}" data-type="chapter"${hasOutline}>
          <input type="checkbox" class="chapter-checkbox" data-chapter-id="${chapter.id}" title="Select chapter">
          <span class="icon">&#9656;</span>
          <span class="name">${outlineIcon}${this._esc(chapter.title)}</span>
          <span class="word-count">${(chapter.wordCount || 0).toLocaleString()}${statusLabel ? ' (' + statusLabel + ')' : ''}</span>
          <button class="chapter-delete-btn" data-delete-chapter="${chapter.id}" title="Delete chapter">&times;</button>
        </div>`;
      }

      html += `
        <button class="tree-add" data-action="add-chapter">
          + Chapter
        </button>`;

      container.innerHTML = html;
    } catch (err) {
      console.error('Failed to render chapter list:', err);
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
    if (!this.state.currentProjectId || !this._currentProject) return;

    const project = this._currentProject;
    const totalWords = Object.values(this._chapterWordCounts).reduce((sum, wc) => sum + wc, 0);
    const templateId = await this.localStorage.getSetting('structureTemplate_' + this.state.currentProjectId, 'threeAct');
    const targetWords = project.wordCountGoal || 80000;

    const guidance = this.structure.getPacingGuidance(templateId, targetWords, totalWords);
    const beats = this.structure.mapBeatsToManuscript(templateId, targetWords, totalWords);

    const body = document.getElementById('panel-structure-body');
    if (!body) return;

    body.innerHTML = this._renderStructure(guidance, beats, project, templateId);
    this._showPanel('structure');
  }

  async openExportPanel() {
    // Show/hide cover download section
    const coverSection = document.getElementById('export-cover-section');
    const coverPreview = document.getElementById('export-cover-preview');
    if (coverSection && coverPreview) {
      if (this._currentProject?.coverImage) {
        coverSection.style.display = '';
        coverPreview.style.display = '';
        coverPreview.src = this._currentProject.coverImage;
      } else {
        coverSection.style.display = 'none';
      }
    }
    this._showPanel('export');
  }

  async openGeneratePanel() {
    const noKeyEl = document.getElementById('generate-no-key');
    const generateBtn = document.getElementById('btn-generate-prose');
    const plotEl = document.getElementById('generate-plot');

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

    // Populate AI instructions from project
    const aiInstructionsEl = document.getElementById('generate-ai-instructions');
    if (aiInstructionsEl) {
      aiInstructionsEl.value = this._currentProject?.aiInstructions || '';
    }

    // Show chapter outline if available
    if (this._currentChapterOutline && plotEl) {
      // Pre-fill the plot field with the outline if the plot field is empty
      if (!plotEl.value?.trim()) {
        plotEl.value = this._currentChapterOutline;
      }
    }

    this._showPanel('generate');

    setTimeout(() => plotEl?.focus(), 300);
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
      wordTarget = parseInt(document.getElementById('generate-word-target')?.value) || 500;
      tone = document.getElementById('generate-tone')?.value?.trim() || '';
      style = document.getElementById('generate-style')?.value?.trim() || '';
      useCharacters = document.getElementById('generate-use-characters')?.checked;
    }

    const existingContent = this.editor.getContent();
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
    const errEl = document.getElementById('generate-error');
    if (errEl) { errEl.style.display = 'none'; }

    this._closeAllPanels();
    this._hideWelcome();

    const editorEl = this.editor.element;
    let streamedText = '';

    // Load chapter outline if available
    const chapterOutline = this._currentChapterOutline || '';

    await this.generator.generate(
      { plot, existingContent, chapterTitle, characters, notes, chapterOutline, aiInstructions, tone, style, wordTarget, concludeStory, genre, genreRules, projectGoal },
      {
        onChunk: (text) => {
          streamedText += text;
          const startingContent = existingContent.trim() ? existingContent : '';
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
          // Update word count live during streaming
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

          // Write to Goal: check if we need another chunk
          if (this._autoWriteToGoal && this._writeToGoalTarget > 0) {
            const currentTotal = this._getTotalWordCount();
            const goal = this._writeToGoalTarget;
            const maxOverage = this._writeToGoalMaxOverage || Math.round(goal * 0.03);
            const remaining = goal - currentTotal;

            if (remaining > maxOverage * -1 && remaining > 50) {
              // Still have words to write — schedule next chunk
              const nextChunk = Math.min(remaining, 2000);
              const isLastChunk = remaining <= 2000;
              setTimeout(() => this._runGeneration({
                isContinuation: true,
                wordTarget: nextChunk,
                concludeStory: isLastChunk,
                writeToGoal: true
              }), 1500);
              return;
            } else {
              // Goal reached (within 3% overage) — stop
              this._autoWriteToGoal = false;
              this._writeToGoalTarget = 0;
            }
          }

          // Score the generated prose quality
          if (streamedText && streamedText.length > 100) {
            this._scoreProse(streamedText);
          }

          this._showContinueBar(true);
        },
        onError: (err) => {
          this._setGenerateStatus(false);
          this._autoWriteToGoal = false;
          this._writeToGoalTarget = 0;
          this._showPanel('generate');
          if (errEl) {
            errEl.style.display = 'block';
            errEl.textContent = err.message;
          }
        }
      }
    );
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

  async _handleWriteToGoal() {
    const project = this._currentProject;
    if (!project) return;

    const totalWords = this._getTotalWordCount();
    const goal = project.wordCountGoal || 0;

    if (goal <= 0) {
      alert('No word count goal set for this project. Set one in Settings → Project Settings.');
      return;
    }

    const remaining = goal - totalWords;
    const maxOverage = Math.round(goal * 0.03); // 3% overage allowed

    if (remaining <= 0) {
      alert(`Your story has already reached ${totalWords.toLocaleString()} words (goal: ${goal.toLocaleString()}).`);
      return;
    }

    this._showContinueBar(false);

    // Generate in chunks, targeting the remaining word count
    // Each chunk targets min(remaining, 2000) words
    // The final chunk includes story conclusion instructions
    this._autoWriteToGoal = true;
    this._writeToGoalTarget = goal;
    this._writeToGoalMaxOverage = maxOverage;

    // Set the word target for this chunk
    const chunkSize = Math.min(remaining, 2000);
    if (this._lastGenSettings) this._lastGenSettings.wordTarget = chunkSize;

    // If remaining words fit in one chunk, include conclusion instructions
    const concludeStory = remaining <= 2000;
    await this._runGeneration({ isContinuation: true, wordTarget: chunkSize, concludeStory, writeToGoal: true });
  }

  _setGenerateStatus(active) {
    const statusEl = document.getElementById('generate-status');
    const cancelBtn = document.getElementById('btn-generate-cancel');
    const generateBtn = document.getElementById('btn-generate-prose');

    if (statusEl) statusEl.style.display = active ? 'block' : 'none';
    if (cancelBtn) cancelBtn.style.display = active ? '' : 'none';
    if (generateBtn) generateBtn.disabled = active;
  }

  async openSettingsPanel() {
    const body = document.getElementById('panel-settings-body');
    if (!body) return;

    body.innerHTML = this._renderSettings(this._currentProject);
    this._initApiKeyPinLock();

    // Render story structure into settings if project is open
    if (this._currentProject && this.state.currentProjectId) {
      const container = document.getElementById('settings-structure-container');
      if (container) {
        const totalWords = Object.values(this._chapterWordCounts).reduce((sum, wc) => sum + wc, 0);
        const templateId = await this.localStorage.getSetting('structureTemplate_' + this.state.currentProjectId, 'threeAct');
        const targetWords = this._currentProject.wordCountGoal || 80000;
        const guidance = this.structure.getPacingGuidance(templateId, targetWords, totalWords);
        const beats = this.structure.mapBeatsToManuscript(templateId, targetWords, totalWords);
        container.innerHTML = this._renderStructureInSettings(guidance, beats, this._currentProject, templateId);
      }
    }

    this._showPanel('settings');
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
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('visible'));
    document.getElementById('panel-overlay').classList.remove('visible');

    const panel = document.getElementById('panel-' + panelId);
    if (panel) {
      panel.classList.add('visible');
      document.getElementById('panel-overlay').classList.add('visible');
    }
  }

  _closeAllPanels() {
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('visible'));
    document.getElementById('panel-overlay').classList.remove('visible');
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
    if (!placeholder || !img || !regenBtn) return;

    if (project?.coverImage) {
      placeholder.style.display = 'none';
      img.style.display = 'block';
      img.src = project.coverImage;
      regenBtn.style.display = '';
    } else {
      placeholder.style.display = '';
      img.style.display = 'none';
      img.src = '';
      regenBtn.style.display = 'none';
    }
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

      // Overlay title (and subtitle if set) on AI-generated cover
      if (coverImage) {
        coverImage = await this.generator.overlayTitle(coverImage, project.title, project.subtitle || '');
      }

      // Step 2d: Canvas fallback (always works, has its own title rendering)
      if (!coverImage) {
        console.warn('AI image sources failed, using canvas fallback');
        const design = this.generator.getDefaultCoverDesign(project.genre);
        coverImage = this.generator.renderCover(design, project.title, project.owner);
      }

      // Save to Firestore
      await this.fs.updateProject(project.id, { coverImage, coverPrompt });
      this._currentProject.coverImage = coverImage;
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
          <label data-tooltip="Choose your editor color scheme. Dark reduces eye strain for nighttime writing. Light provides a clean daytime look. Sepia gives a warm, paper-like feel that's easy on the eyes.">Theme</label>
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
          <label data-tooltip="Your Anthropic API key enables AI prose generation, story analysis, and structure analysis. The key is stored only on this device and is sent directly to Anthropic's API — never to any other server. You can protect it with a PIN below.">Anthropic API Key</label>
          <div id="api-key-locked" style="display:none;">
            <div style="display:flex;gap:8px;align-items:center;">
              <input type="password" class="form-input" id="api-key-pin-input" data-tooltip="Enter the PIN you set to unlock and view or change your API key." placeholder="Enter PIN to unlock" style="flex:1;">
              <button class="btn btn-sm" id="api-key-unlock-btn" data-tooltip="Unlock — Verify your PIN to access the API key field.">Unlock</button>
            </div>
            <p style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">API key is PIN-protected.</p>
          </div>
          <div id="api-key-unlocked">
            <input type="password" class="form-input" id="setting-api-key" data-tooltip="Paste your Anthropic API key here. It starts with 'sk-ant-'. Get one free at console.anthropic.com. Usage is billed directly to your Anthropic account." value="${this._esc(this.generator?.apiKey || '')}" placeholder="sk-ant-...">
            <p style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">
              Get your key at <a href="https://console.anthropic.com/settings/keys" target="_blank" style="color:var(--accent-primary);">console.anthropic.com</a>. Stored locally on this device only.
            </p>
            <div style="margin-top:8px;display:flex;gap:8px;align-items:center;">
              <input type="password" class="form-input" id="api-key-set-pin" data-tooltip="Set a PIN code (at least 4 characters) to protect your API key. When locked, the key cannot be viewed or changed without entering the correct PIN. Useful on shared devices." placeholder="${localStorage.getItem('genesis-api-pin') ? 'New PIN (leave blank to keep)' : 'Set a PIN to lock (optional)'}" style="flex:1;">
              <button class="btn btn-sm" id="api-key-lock-btn" data-tooltip="${localStorage.getItem('genesis-api-pin') ? 'Update PIN — Change your existing PIN to a new one.' : 'Set PIN — Protect your API key with a PIN code so others cannot view or change it.'}">${localStorage.getItem('genesis-api-pin') ? 'Update PIN' : 'Set PIN'}</button>
              ${localStorage.getItem('genesis-api-pin') ? '<button class="btn btn-sm" id="api-key-remove-pin" data-tooltip="Remove PIN — Remove PIN protection from your API key. Anyone with access to this device will be able to view and change the key.">Remove PIN</button>' : ''}
            </div>
          </div>
        </div>
        <div class="form-group">
          <label data-tooltip="Choose which Claude AI model powers prose generation and analysis. Sonnet 4.5 is the best balance of quality, speed, and cost — recommended for most writers. Haiku 4.5 is faster and cheaper but produces slightly less polished prose. Opus 4.6 produces the highest quality literary prose but is slower and costs more per generation.">AI Model</label>
          <select class="form-input" id="setting-ai-model">
            <option value="claude-sonnet-4-5-20250929" ${this.generator?.model === 'claude-sonnet-4-5-20250929' ? 'selected' : ''}>Claude Sonnet 4.5 (recommended)</option>
            <option value="claude-haiku-4-5-20251001" ${this.generator?.model === 'claude-haiku-4-5-20251001' ? 'selected' : ''}>Claude Haiku 4.5 (faster, cheaper)</option>
            <option value="claude-opus-4-6" ${this.generator?.model === 'claude-opus-4-6' ? 'selected' : ''}>Claude Opus 4.6 (highest quality)</option>
          </select>
        </div>
        <button class="btn btn-sm" id="save-api-settings" data-tooltip="Save your API key and AI model selection. These settings apply to all projects." style="width:100%;">Save AI Settings</button>
      </div>

      <div class="analysis-section">
        <h3>Cover Image Generation</h3>
        <div class="form-group">
          <label data-tooltip="Your Hugging Face API token enables AI-generated book cover images using Stable Diffusion XL and FLUX models. Free tokens are available at huggingface.co/settings/tokens. The cover generator analyzes your story's content and genre to create a unique cover image.">Hugging Face API Token</label>
          <input type="password" class="form-input" id="setting-hf-token" data-tooltip="Paste your Hugging Face API token here. It starts with 'hf_'. Free tokens have generous rate limits for image generation." value="${this._esc(this._hfToken || '')}" placeholder="hf_...">
          <p style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">
            Free token from <a href="https://huggingface.co/settings/tokens" target="_blank" style="color:var(--accent-primary);">huggingface.co</a>. Used for AI cover art (FLUX / Stable Diffusion).
          </p>
        </div>
        <button class="btn btn-sm" id="save-hf-settings" data-tooltip="Save your Hugging Face token. Once saved, use 'Create Cover' or 'Regenerate Cover' in the sidebar to generate AI cover art." style="width:100%;">Save Cover Settings</button>
      </div>

      <div class="analysis-section">
        <h3>Writing Goals</h3>
        <div class="form-group">
          <label data-tooltip="Set your daily writing target in words. Your progress toward this goal is tracked in the status bar at the bottom of the screen and resets each day at midnight. A consistent daily goal helps build a productive writing habit.">Daily Word Goal</label>
          <input type="number" class="form-input" id="setting-daily-goal" data-tooltip="Enter your daily word count target. Common goals: 500 (casual), 1000 (steady), 2000 (ambitious), 5000+ (NaNoWriMo pace)." value="${this.state.dailyGoal}" min="100" step="100">
        </div>
      </div>

      ${project ? `
      <div class="analysis-section">
        <h3>Project Settings</h3>
        <div class="form-group">
          <label data-tooltip="The title of your book or manuscript. This appears in the project list, on the AI-generated cover image, and in exported manuscripts.">Project Title</label>
          <input type="text" class="form-input" id="setting-project-name" value="${this._esc(project.title)}">
        </div>
        <div class="form-group">
          <label data-tooltip="Select your project's literary genre. The AI uses genre-specific prose style rules to maintain consistent tone, pacing, and conventions throughout your manuscript. This prevents style drift during long writing sessions.">Genre</label>
          <select class="form-input" id="setting-project-genre">
            <option value="">— Select Genre —</option>
            ${(window.GENRE_DATA || []).map(g => `<option value="${g.id}" ${(project.genre === g.id) ? 'selected' : ''}>${g.label}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" id="subgenre-group" style="${project.subgenre ? '' : 'display:none;'}">
          <label data-tooltip="Refine your genre selection with a subgenre. Subgenres provide more specific prose style rules — for example, 'Cozy Mystery' vs 'Noir' produce very different writing styles. The AI will follow these specialized rules.">Subgenre</label>
          <select class="form-input" id="setting-project-subgenre">
            <option value="">— None (use main genre rules) —</option>
            ${this._getSubgenreOptions(project.genre, project.subgenre)}
          </select>
        </div>
        <button class="btn btn-primary" id="save-project-settings" data-tooltip="Save changes to the project title and genre." style="width:100%;margin-top:8px;">Save Project Settings</button>
        <p style="font-size:0.75rem;color:var(--text-muted);margin-top:6px;">Word count goal and chapter structure are configured in the Book Structure panel (sidebar).</p>
      </div>

      <div class="analysis-section">
        <h3>Story Structure</h3>
        <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:10px;">
          Select a narrative structure template to guide your story's pacing and beat progression. Choose "User / AI Created Outline" if your story doesn't follow a traditional structure (e.g., biographies, non-fiction, or custom outlines).
        </p>
        <div id="settings-structure-container"></div>
      </div>

      <div class="analysis-section">
        <h3>Data</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-sm" id="btn-export-json" data-tooltip="Export a complete JSON backup of this project including all chapters, characters, notes, cover image, and settings. Use for backups or transferring your project to another device.">Backup (JSON)</button>
        </div>
      </div>

      <div class="analysis-section">
        <h3>Danger Zone</h3>
        <button class="btn btn-sm" id="btn-delete-project" data-tooltip="Permanently delete this entire project and all its contents: chapters, characters, notes, and cover image. This action cannot be undone. You will be asked to confirm before deletion." style="border-color:var(--danger);color:var(--danger);">Delete Project</button>
      </div>
      ` : ''}
    `;
  }

  // ========================================
  //  Book Structure Panel
  // ========================================

  async openBookStructurePanel() {
    const project = this._currentProject;
    if (!project) return;

    const titleEl = document.getElementById('bs-title');
    const subtitleEl = document.getElementById('bs-subtitle');
    const totalWordsEl = document.getElementById('bs-total-words');
    const numChaptersEl = document.getElementById('bs-num-chapters');

    if (titleEl) titleEl.value = project.title || '';
    if (subtitleEl) subtitleEl.value = project.subtitle || '';
    if (totalWordsEl) totalWordsEl.value = project.wordCountGoal || 80000;

    // Calculate num chapters from existing or default
    const chapters = await this.fs.getProjectChapters(this.state.currentProjectId);
    const numCh = project.numChapters || chapters.length || 20;
    if (numChaptersEl) numChaptersEl.value = numCh;

    this._updateWordsPerChapter();
    this._showPanel('book-structure');
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

    try {
      await this.fs.updateProject(this.state.currentProjectId, {
        title, subtitle, wordCountGoal, numChapters
      });

      this._currentProject = { ...this._currentProject, title, subtitle, wordCountGoal, numChapters };
      document.getElementById('project-title').textContent = title;
      this._updateStatusBarLocal();
      alert('Book structure saved.');
    } catch (err) {
      console.error('Failed to save book structure:', err);
      alert('Failed to save book structure.');
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

    try {
      const outlines = await this.generator.generateOutlines({
        title, subtitle, genre, totalWords, numChapters, characters, notes, aiInstructions
      });

      if (!outlines || !Array.isArray(outlines) || outlines.length === 0) {
        throw new Error('No outlines were generated.');
      }

      // Save book structure first
      await this.fs.updateProject(this.state.currentProjectId, {
        title, subtitle, wordCountGoal: totalWords, numChapters
      });
      this._currentProject = { ...this._currentProject, title, subtitle, wordCountGoal: totalWords, numChapters };

      // Create chapters from outlines
      for (let i = 0; i < outlines.length; i++) {
        const outline = outlines[i];
        const ch = await this.fs.createChapter({
          projectId: this.state.currentProjectId,
          chapterNumber: i + 1,
          title: outline.title || `Chapter ${i + 1}`,
          content: '',
          outline: outline.outline || ''
        });
        this._chapterWordCounts[ch.id] = 0;
      }

      // Refresh chapter list and load first chapter
      await this._renderChapterList();
      const chapters = await this.fs.getProjectChapters(this.state.currentProjectId);
      if (chapters.length > 0) {
        await this._loadChapter(chapters[0].id);
      }

      document.getElementById('project-title').textContent = title;
      this._updateStatusBarLocal();
      this._closeAllPanels();
      alert(`Generated ${outlines.length} chapter outlines. Review each chapter's outline in the editor.`);
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
  //  Rethink Chapter Outline
  // ========================================

  async _openRethinkModal() {
    if (!this.state.currentChapterId) {
      alert('No chapter selected.');
      return;
    }

    const chapter = await this.fs.getChapter(this.state.currentChapterId);
    if (!chapter?.outline) {
      alert('This chapter has no outline to rethink. Generate outlines first from the Book Structure panel.');
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
  //  Prose Quality Scoring
  // ========================================

  async _scoreProse(generatedText) {
    if (!this.generator.hasApiKey()) return;
    if (!generatedText || generatedText.length < 100) return;

    try {
      const review = await this.generator.scoreProse(generatedText);
      this._showProseReview(review, generatedText);
    } catch (err) {
      console.error('Prose scoring failed:', err);
      // Non-fatal — just show continue bar without scoring
    }
  }

  _showProseReview(review, generatedText) {
    const body = document.getElementById('prose-review-body');
    if (!body) return;

    const scoreClass = review.score >= 80 ? 'score-excellent' :
                       review.score >= 65 ? 'score-good' :
                       review.score >= 50 ? 'score-fair' : 'score-poor';

    const scoreLabel = review.score >= 80 ? 'Excellent' :
                       review.score >= 65 ? 'Good' :
                       review.score >= 50 ? 'Needs Work' : 'Rough Draft';

    let html = `
      <div class="prose-score-display">
        <div class="prose-score-number ${scoreClass}">${review.score}</div>
        <div class="prose-score-label">${review.label || scoreLabel} / 100</div>
        <div class="meter" style="margin-top:12px;max-width:200px;margin-left:auto;margin-right:auto;">
          <div class="meter-fill ${review.score >= 70 ? 'good' : review.score >= 50 ? 'warning' : 'danger'}" style="width:${review.score}%"></div>
        </div>
      </div>

      <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:16px;">${this._esc(review.summary || '')}</p>`;

    if (review.aiPatterns && review.aiPatterns.length > 0) {
      html += `<h3 style="font-size:0.85rem;font-weight:600;color:var(--danger);margin-bottom:8px;">AI Patterns Detected</h3>
        <ul class="prose-patterns-list">
          ${review.aiPatterns.map(p => `
            <li class="prose-pattern-item">
              <strong>${this._esc(p.pattern)}</strong>
              ${p.examples && p.examples.length > 0 ? `<br><span style="font-size:0.8rem;color:var(--text-muted);">"${this._esc(p.examples[0])}"</span>` : ''}
            </li>
          `).join('')}
        </ul>`;
    }

    if (review.issues && review.issues.length > 0) {
      html += `<h3 style="font-size:0.85rem;font-weight:600;color:var(--text-secondary);margin-top:16px;margin-bottom:8px;">Quality Issues</h3>
        <ul class="prose-issues-list">
          ${review.issues.map(issue => `
            <li class="prose-issue-item severity-${issue.severity || 'medium'}">
              <strong>${this._esc(issue.problem || '')}</strong>
              ${issue.text ? `<br><span style="font-size:0.8rem;color:var(--text-muted);">"${this._esc(issue.text)}"</span>` : ''}
            </li>
          `).join('')}
        </ul>`;
    }

    if ((!review.issues || review.issues.length === 0) && (!review.aiPatterns || review.aiPatterns.length === 0)) {
      html += `<p style="color:var(--success);font-size:0.9rem;text-align:center;margin-top:16px;">No major issues detected. The prose quality is solid.</p>`;
    }

    body.innerHTML = html;

    // Store for rewrite action
    this._lastProseReview = review;
    this._lastGeneratedText = generatedText;

    // Show rewrite button only if there are issues or AI patterns
    const rewriteBtn = document.getElementById('btn-prose-review-rewrite');
    if (rewriteBtn) {
      rewriteBtn.style.display = (review.issues?.length > 0 || review.aiPatterns?.length > 0) ? '' : 'none';
    }

    const overlay = document.getElementById('prose-review-overlay');
    if (overlay) overlay.classList.add('visible');
  }

  async _rewriteProblems() {
    if (!this._lastProseReview || !this._lastGeneratedText) return;

    const review = this._lastProseReview;
    const problems = [];
    if (review.aiPatterns) {
      for (const p of review.aiPatterns) {
        problems.push(`AI Pattern: ${p.pattern}${p.examples?.[0] ? ` (e.g. "${p.examples[0]}")` : ''}`);
      }
    }
    if (review.issues) {
      for (const issue of review.issues) {
        if (issue.severity === 'high' || issue.severity === 'medium') {
          problems.push(`${issue.problem}${issue.text ? ` ("${issue.text}")` : ''}`);
        }
      }
    }

    if (problems.length === 0) return;

    // Close review modal
    document.getElementById('prose-review-overlay').classList.remove('visible');

    // Build a targeted rewrite prompt
    const rewriteInstructions = `REWRITE the following prose to fix these specific issues:\n${problems.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n\nKeep the same story events, characters, and plot points but improve the prose quality. Eliminate all AI patterns. Make it read as authentically human-written.`;

    // Add the rewrite instruction to the AI instructions temporarily for this generation
    const originalInstructions = this._currentProject?.aiInstructions || '';
    const combinedInstructions = originalInstructions + '\n\n' + rewriteInstructions;

    // Run a targeted rewrite generation
    this._showContinueBar(false);
    this._setGenerateStatus(true);

    const existingContent = this.editor.getContent();
    const plot = this._lastGenSettings?.plot || 'Continue the story.';
    const characters = this._lastGenSettings?.useCharacters ? await this.localStorage.getProjectCharacters(this.state.currentProjectId) : [];

    // Remove the last generated chunk and regenerate
    const textToReplace = this._lastGeneratedText;
    const plainExisting = existingContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const plainGenerated = textToReplace.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

    // Strip the last generated text from the editor to replace it
    let baseContent = existingContent;
    if (plainExisting.endsWith(plainGenerated)) {
      const cutPoint = plainExisting.length - plainGenerated.length;
      // Approximate — remove from the end of the HTML
      const editorHtml = existingContent;
      const editorText = editorHtml.replace(/<[^>]*>/g, '');
      // We'll just regenerate the same amount of words
    }

    // Simpler approach: regenerate with the fix instructions
    await this._runGeneration({
      isContinuation: true,
      wordTarget: this._lastGenSettings?.wordTarget || 500
    });
  }

  // ========================================
  //  Welcome Screen
  // ========================================

  _showWelcome() {
    const overlay = document.getElementById('welcome-overlay');
    const editorEl = document.getElementById('editor');
    if (overlay) overlay.style.display = '';
    if (editorEl) editorEl.style.display = 'none';
    const outlineDisplay = document.getElementById('chapter-outline-display');
    if (outlineDisplay) outlineDisplay.style.display = 'none';
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

  _bindEvents() {
    // --- Landing Page Events ---

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

    // --- Back to Projects ---
    document.getElementById('btn-back-to-projects')?.addEventListener('click', () => this._showLanding());
    document.getElementById('btn-back-to-projects-sidebar')?.addEventListener('click', () => this._showLanding());

    // --- Switch User ---
    document.getElementById('btn-switch-user-sidebar')?.addEventListener('click', () => this._switchUser());

    // --- Delete Project (sidebar) ---
    document.getElementById('btn-delete-project-sidebar')?.addEventListener('click', () => this._deleteCurrentProject());

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

      // Handle chapter delete button
      const deleteBtn = e.target.closest('.chapter-delete-btn');
      if (deleteBtn) {
        e.stopPropagation();
        const chapterId = deleteBtn.dataset.deleteChapter;
        if (chapterId) {
          await this._deleteChapter(chapterId);
        }
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

    // --- Toolbar buttons ---
    document.getElementById('btn-bold')?.addEventListener('click', () => this.editor.bold());
    document.getElementById('btn-italic')?.addEventListener('click', () => this.editor.italic());
    document.getElementById('btn-heading')?.addEventListener('click', () => this.editor.insertHeading());
    document.getElementById('btn-blockquote')?.addEventListener('click', () => this.editor.insertBlockquote());
    document.getElementById('btn-scene-break')?.addEventListener('click', () => this.editor.insertSceneBreak());
    document.getElementById('btn-undo')?.addEventListener('click', () => this.editor.undo());
    document.getElementById('btn-redo')?.addEventListener('click', () => this.editor.redo());

    // --- Panel buttons ---
    document.getElementById('btn-generate')?.addEventListener('click', () => this.openGeneratePanel());
    document.getElementById('btn-analysis')?.addEventListener('click', () => this.openAnalysisPanel());
    document.getElementById('btn-export')?.addEventListener('click', () => this.openExportPanel());
    document.getElementById('btn-settings')?.addEventListener('click', () => this.openSettingsPanel());
    document.getElementById('btn-book-structure')?.addEventListener('click', () => this.openBookStructurePanel());

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
      if (e.target.id === 'setting-daily-goal') {
        this.state.dailyGoal = parseInt(e.target.value) || 1000;
        await this.localStorage.setSetting('dailyGoal', this.state.dailyGoal);
      }
      if (e.target.id === 'bs-total-words' || e.target.id === 'bs-num-chapters') {
        this._updateWordsPerChapter();
      }
      if (e.target.id === 'structure-template-select') {
        await this.localStorage.setSetting('structureTemplate_' + this.state.currentProjectId, e.target.value);
        // Refresh the structure section within settings
        const container = document.getElementById('settings-structure-container');
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
        const key = document.getElementById('setting-api-key')?.value || '';
        const model = document.getElementById('setting-ai-model')?.value || 'claude-sonnet-4-5-20250929';
        await this.generator.setApiKey(key);
        await this.generator.setModel(model);
        alert('AI settings saved.');
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
      // --- Prose Review events ---
      if (e.target.id === 'btn-prose-review-accept') {
        document.getElementById('prose-review-overlay')?.classList.remove('visible');
      }
      if (e.target.id === 'btn-prose-review-rewrite') {
        await this._rewriteProblems();
      }
      if (e.target.id === 'btn-prose-review-rethink') {
        document.getElementById('prose-review-overlay')?.classList.remove('visible');
        await this._openRethinkModal();
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
        await this._runGeneration();
      }
      if (e.target.id === 'btn-generate-cancel') {
        this.generator.cancel();
        this._autoWriteToGoal = false;
        this._setGenerateStatus(false);
        this._showContinueBar(true);
      }
      if (e.target.id === 'btn-generate-open-settings') {
        this._closeAllPanels();
        setTimeout(() => this.openSettingsPanel(), 100);
      }
      // Continue Writing word-count buttons (+500, +1000, +2000)
      const continueBtn = e.target.closest('.continue-word-btn');
      if (continueBtn) {
        // Close prose review modal if the button was clicked from there
        document.getElementById('prose-review-overlay')?.classList.remove('visible');
        const wordTarget = parseInt(continueBtn.dataset.words) || 500;
        await this._handleContinueWriting(wordTarget);
      }
      if (e.target.id === 'btn-continue-to-target' || e.target.closest('#btn-continue-to-target')) {
        await this._handleWriteToGoal();
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
      body.textContent = text;
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
    document.addEventListener('mouseover', (e) => {
      const el = e.target.closest('[data-tooltip]');
      if (!el || el === activeEl) return;
      hide();
      hoverTimer = setTimeout(() => show(el), 400);
    });

    document.addEventListener('mouseout', (e) => {
      const el = e.target.closest('[data-tooltip]');
      if (el) hide();
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
    if (el('status-daily')) el('status-daily').textContent = `${this.state.wordsToday} / ${this.state.dailyGoal}`;
    if (el('fwc-total')) el('fwc-total').textContent = total.toLocaleString();
    if (el('fwc-progress')) el('fwc-progress').textContent = progress + '%';
  }

  async _loadDailyProgress() {
    const today = new Date().toISOString().split('T')[0];
    this.state.wordsToday = await this.localStorage.getSetting('wordsToday_' + today, 0);
  }

  _trackDailyWords(currentChapterWords) {
    const today = new Date().toISOString().split('T')[0];
    const key = 'wordsToday_' + today;
    const updated = Math.max(this.state.wordsToday, currentChapterWords);
    this.state.wordsToday = updated;
    this.localStorage.setSetting(key, updated);
    // Update daily display
    const dailyEl = document.getElementById('status-daily');
    if (dailyEl) dailyEl.textContent = `${updated.toLocaleString()} / ${this.state.dailyGoal.toLocaleString()}`;
  }

  _applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme === 'dark' ? '' : theme);
    if (theme === 'dark') document.documentElement.removeAttribute('data-theme');
  }

  async _saveProjectSettings() {
    if (!this.state.currentProjectId) return;
    const title = document.getElementById('setting-project-name')?.value;
    const genre = document.getElementById('setting-project-genre')?.value || '';
    const subgenre = document.getElementById('setting-project-subgenre')?.value || '';

    try {
      await this.fs.updateProject(this.state.currentProjectId, {
        title, genre, subgenre
      });

      // Update cached project
      this._currentProject = { ...this._currentProject, title, genre, subgenre };
      document.getElementById('project-title').textContent = title;
      this._updateStatusBarLocal();
      this._closeAllPanels();
    } catch (err) {
      console.error('Failed to save project settings:', err);
      alert('Failed to save settings.');
    }
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

  async _deleteChapter(chapterId) {
    if (!confirm('Delete this chapter? This cannot be undone.')) return;

    try {
      // If deleting the currently loaded chapter, clear the editor and reset word count
      if (this.state.currentChapterId === chapterId) {
        this.state.currentChapterId = null;
        this.editor.clear();
        this._showWelcome();
        const wcEl = document.getElementById('status-words');
        if (wcEl) wcEl.textContent = '0';
        const fwcWords = document.getElementById('fwc-words');
        if (fwcWords) fwcWords.textContent = '0';
      }

      await this.fs.deleteChapter(chapterId);
      delete this._chapterWordCounts[chapterId];

      // Renumber remaining chapters
      const chapters = await this.fs.getProjectChapters(this.state.currentProjectId);
      const orderedIds = chapters.map(ch => ch.id);
      if (orderedIds.length > 0) {
        await this.fs.reorderChapters(this.state.currentProjectId, orderedIds);
      }

      await this._renderChapterList();
      this._updateStatusBarLocal();
    } catch (err) {
      console.error('Failed to delete chapter:', err);
      alert('Failed to delete chapter.');
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

      for (const chapterId of idsToDelete) {
        if (this.state.currentChapterId === chapterId) {
          this.state.currentChapterId = null;
          this.editor.clear();
          this._showWelcome();
          const wcEl = document.getElementById('status-words');
          if (wcEl) wcEl.textContent = '0';
          const fwcWords = document.getElementById('fwc-words');
          if (fwcWords) fwcWords.textContent = '0';
        }

        await this.fs.deleteChapter(chapterId);
        delete this._chapterWordCounts[chapterId];
      }

      // Renumber remaining chapters
      const chapters = await this.fs.getProjectChapters(this.state.currentProjectId);
      const orderedIds = chapters.map(ch => ch.id);
      if (orderedIds.length > 0) {
        await this.fs.reorderChapters(this.state.currentProjectId, orderedIds);
      }

      await this._renderChapterList();
      this._updateStatusBarLocal();
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

    // Trigger generation
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

  _esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  _registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      const swPath = new URL('sw.js', window.location.href).pathname;
      navigator.serviceWorker.register(swPath).catch(() => {
        // Service worker registration failed — app still works without it
      });
    }
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
