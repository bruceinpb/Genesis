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
    const coverUrl = project.coverPrompt
      ? `https://image.pollinations.ai/prompt/${encodeURIComponent(project.coverPrompt)}?width=200&height=300&seed=${project.coverSeed || 1}&nologo=true`
      : '';
    return `
      <div class="project-card" data-id="${project.id}">
        <div class="project-card-inner">
          ${coverUrl ? `<img class="project-card-cover" src="${coverUrl}" alt="Cover" loading="lazy">` : '<div class="project-card-cover-empty"></div>'}
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
    const title = await this._prompt('Project Title', 'My Novel');
    if (!title) return;
    const genre = await this._prompt('Genre (optional)', '');
    const goalStr = await this._prompt('Word count goal', '80000');
    const wordCountGoal = parseInt(goalStr) || 80000;

    try {
      const project = await this.fs.createProject({
        owner: this.state.currentUser,
        title,
        genre,
        wordCountGoal
      });

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
      this.editor.setContent(chapter.content || '');

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
      for (const chapter of chapters) {
        const statusLabel = chapter.status === 'complete' ? 'done' : chapter.status === 'revision' ? 'rev' : '';
        html += `
        <div class="tree-item chapter ${chapter.id === this.state.currentChapterId ? 'active' : ''}"
             data-id="${chapter.id}" data-type="chapter">
          <span class="icon">&#9656;</span>
          <span class="name">${this._esc(chapter.title)}</span>
          <span class="word-count">${(chapter.wordCount || 0).toLocaleString()}${statusLabel ? ' (' + statusLabel + ')' : ''}</span>
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
    const coverUrl = this._getCoverUrl(this._currentProject, 400, 600);
    if (coverSection && coverPreview) {
      if (coverUrl) {
        coverSection.style.display = '';
        coverPreview.style.display = '';
        coverPreview.src = coverUrl;
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
    this._showPanel('generate');

    setTimeout(() => plotEl?.focus(), 300);
  }

  async _runGeneration(options = {}) {
    let plot, wordTarget, tone, style, useCharacters;
    if (options.isContinuation && this._lastGenSettings) {
      plot = this._lastGenSettings.plot;
      wordTarget = this._lastGenSettings.wordTarget;
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

    this._lastGenSettings = { plot, wordTarget, tone, style, useCharacters };

    // Get chapter title
    let chapterTitle = '';
    if (this.state.currentChapterId) {
      try {
        const chapter = await this.fs.getChapter(this.state.currentChapterId);
        if (chapter) chapterTitle = chapter.title;
      } catch (_) {}
    }

    this._showContinueBar(false);
    this._setGenerateStatus(true);
    const errEl = document.getElementById('generate-error');
    if (errEl) { errEl.style.display = 'none'; }

    this._closeAllPanels();
    this._hideWelcome();

    const editorEl = this.editor.element;
    let streamedText = '';

    await this.generator.generate(
      { plot, existingContent, chapterTitle, characters, tone, style, wordTarget },
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

          if (this._autoWriteToGoal) {
            const currentWords = this.editor.getWordCount();
            const target = this._currentProject ? this._currentProject.wordCountGoal : 0;
            if (target > 0 && currentWords < target) {
              setTimeout(() => this._runGeneration({ isContinuation: true }), 1500);
              return;
            } else {
              this._autoWriteToGoal = false;
            }
          }

          this._showContinueBar(true);
        },
        onError: (err) => {
          this._setGenerateStatus(false);
          this._autoWriteToGoal = false;
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

  // ========================================
  //  Cover Image
  // ========================================

  _getCoverUrl(project, width = 512, height = 768) {
    if (!project?.coverPrompt) return null;
    const seed = project.coverSeed || 1;
    return `https://image.pollinations.ai/prompt/${encodeURIComponent(project.coverPrompt)}?width=${width}&height=${height}&seed=${seed}&nologo=true`;
  }

  _updateCoverDisplay() {
    const project = this._currentProject;
    const placeholder = document.getElementById('cover-placeholder');
    const img = document.getElementById('cover-image');
    const regenBtn = document.getElementById('btn-regenerate-cover');
    if (!placeholder || !img || !regenBtn) return;

    const url = this._getCoverUrl(project);
    if (url) {
      placeholder.style.display = 'none';
      img.style.display = 'block';
      img.src = url;
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
      const characters = await this.manuscript.getCharacters() || [];

      // Generate image prompt via Claude
      const coverPrompt = await this.generator.generateCoverPrompt({
        title: project.title,
        genre: project.genre || '',
        proseExcerpt: proseExcerpt.trim(),
        characters
      });

      if (!coverPrompt) throw new Error('Failed to generate cover prompt.');

      // Set seed (new random for regenerate, keep existing otherwise)
      const coverSeed = regenerate
        ? Math.floor(Math.random() * 999999) + 1
        : (project.coverSeed || Math.floor(Math.random() * 999999) + 1);

      // Save to Firestore
      await this.fs.updateProject(project.id, { coverPrompt, coverSeed });
      this._currentProject.coverPrompt = coverPrompt;
      this._currentProject.coverSeed = coverSeed;

      // Update display
      this._updateCoverDisplay();
    } catch (err) {
      console.error('Cover generation failed:', err);
      alert('Cover generation failed: ' + err.message);
      if (placeholder) placeholder.style.display = '';
    } finally {
      if (loading) loading.style.display = 'none';
    }
  }

  async _downloadCover() {
    const project = this._currentProject;
    const url = this._getCoverUrl(project, 1024, 1536);
    if (!url) return;

    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${project.title || 'cover'} - cover.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch (err) {
      // Fallback: open in new tab
      window.open(url, '_blank');
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
        <h3>Writing Goals</h3>
        <div class="form-group">
          <label>Daily Word Goal</label>
          <input type="number" class="form-input" id="setting-daily-goal" value="${this.state.dailyGoal}" min="100" step="100">
        </div>
      </div>

      ${project ? `
      <div class="analysis-section">
        <h3>Project Settings</h3>
        <div class="form-group">
          <label>Project Title</label>
          <input type="text" class="form-input" id="setting-project-name" value="${this._esc(project.title)}">
        </div>
        <div class="form-group">
          <label>Genre</label>
          <input type="text" class="form-input" id="setting-project-genre" value="${this._esc(project.genre || '')}">
        </div>
        <div class="form-group">
          <label>Word Count Goal</label>
          <input type="number" class="form-input" id="setting-target-words" value="${project.wordCountGoal || 80000}" min="1000" step="1000">
        </div>
        <button class="btn btn-primary" id="save-project-settings" style="width:100%;margin-top:8px;">Save Project Settings</button>
      </div>

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
  //  Welcome Screen
  // ========================================

  _showWelcome() {
    const overlay = document.getElementById('welcome-overlay');
    const editorEl = document.getElementById('editor');
    if (overlay) overlay.style.display = '';
    if (editorEl) editorEl.style.display = 'none';
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
    document.getElementById('btn-structure')?.addEventListener('click', () => this.openStructurePanel());
    document.getElementById('btn-export')?.addEventListener('click', () => this.openExportPanel());
    document.getElementById('btn-settings')?.addEventListener('click', () => this.openSettingsPanel());

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
      if (e.target.id === 'structure-template-select') {
        await this.localStorage.setSetting('structureTemplate_' + this.state.currentProjectId, e.target.value);
        await this.openStructurePanel();
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
      if (e.target.id === 'btn-continue-writing' || e.target.closest('#btn-continue-writing')) {
        this._showContinueBar(false);
        await this._runGeneration({ isContinuation: true });
      }
      if (e.target.id === 'btn-continue-to-target' || e.target.closest('#btn-continue-to-target')) {
        this._showContinueBar(false);
        this._autoWriteToGoal = true;
        await this._runGeneration({ isContinuation: true });
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
    this.localStorage.setSetting(key, Math.max(this.state.wordsToday, currentChapterWords));
  }

  _applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme === 'dark' ? '' : theme);
    if (theme === 'dark') document.documentElement.removeAttribute('data-theme');
  }

  async _saveProjectSettings() {
    if (!this.state.currentProjectId) return;
    const title = document.getElementById('setting-project-name')?.value;
    const genre = document.getElementById('setting-project-genre')?.value;
    const wordCountGoal = parseInt(document.getElementById('setting-target-words')?.value) || 80000;

    try {
      await this.fs.updateProject(this.state.currentProjectId, {
        title, genre, wordCountGoal
      });

      // Update cached project
      this._currentProject = { ...this._currentProject, title, genre, wordCountGoal };
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
