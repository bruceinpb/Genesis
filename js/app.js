/**
 * Genesis 2 — Main Application Controller
 * Orchestrates all modules and manages the UI.
 */

import { Storage, STORE_NAMES } from './storage.js';
import { ManuscriptManager } from './manuscript.js';
import { ProseAnalyzer } from './prose.js';
import { StructureManager } from './structure.js';
import { ExportManager } from './export.js';
import { Editor } from './editor.js';
import { ProseGenerator } from './generate.js';

class App {
  constructor() {
    this.storage = new Storage();
    this.manuscript = null;
    this.analyzer = new ProseAnalyzer();
    this.structure = new StructureManager();
    this.exporter = null;
    this.editor = null;
    this.generator = null;

    this.state = {
      currentProjectId: null,
      currentSceneId: null,
      sidebarTab: 'manuscript', // manuscript, characters, notes
      focusMode: false,
      sidebarOpen: true,
      theme: 'dark',
      dailyGoal: 1000,
      wordsToday: 0,
      sessionStart: Date.now()
    };
  }

  async init() {
    await this.storage.init();
    this.manuscript = new ManuscriptManager(this.storage);
    this.exporter = new ExportManager(this.storage, this.manuscript);
    this.generator = new ProseGenerator(this.storage);
    await this.generator.init();

    // Load settings
    this.state.theme = await this.storage.getSetting('theme', 'dark');
    this.state.dailyGoal = await this.storage.getSetting('dailyGoal', 1000);
    this.state.currentProjectId = await this.storage.getSetting('lastProjectId', null);

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

    // Load last project or show welcome
    if (this.state.currentProjectId) {
      await this._loadProject(this.state.currentProjectId);
    } else {
      this._showWelcome();
    }

    // Track daily words
    await this._loadDailyProgress();

    // Register service worker
    this._registerServiceWorker();
  }

  // --- Project Management ---

  async createNewProject() {
    const name = await this._prompt('Project Name', 'My Novel');
    if (!name) return;

    const genre = await this._prompt('Genre (optional)', '');
    const targetStr = await this._prompt('Target word count', '80000');
    const targetWords = parseInt(targetStr) || 80000;

    const project = await this.manuscript.createProject(name, genre, targetWords);

    // Create first chapter and scene
    const chapter = await this.manuscript.createChapter(project.id, 'Chapter One');
    await this.manuscript.createScene(chapter.id, 'Opening Scene');

    await this._loadProject(project.id);
  }

  async _loadProject(projectId) {
    const project = await this.storage.get(STORE_NAMES.projects, projectId);
    if (!project) {
      this._showWelcome();
      return;
    }

    this.state.currentProjectId = projectId;
    await this.storage.setSetting('lastProjectId', projectId);

    // Update toolbar title
    document.getElementById('project-title').textContent = project.name;

    // Load manuscript tree
    await this._renderManuscriptTree();

    // Load first scene
    const tree = await this.manuscript.getManuscriptTree(projectId);
    if (tree.length > 0 && tree[0].scenes.length > 0) {
      await this._loadScene(tree[0].scenes[0].id);
    } else {
      this.editor.clear();
      this.state.currentSceneId = null;
    }

    // Update status bar
    await this._updateStatusBar();
  }

  async _loadScene(sceneId) {
    const scene = await this.storage.get(STORE_NAMES.scenes, sceneId);
    if (!scene) return;

    // Save current scene first
    await this._saveCurrentScene();

    this.state.currentSceneId = sceneId;
    this.editor.setContent(scene.content || '');

    // Update active state in tree
    document.querySelectorAll('.tree-item').forEach(el => {
      el.classList.toggle('active', el.dataset.id === sceneId);
    });

    // Update toolbar scene title
    const chapter = await this.storage.get(STORE_NAMES.chapters, scene.chapterId);
    const titleEl = document.getElementById('scene-title');
    if (titleEl) {
      titleEl.textContent = chapter ? `${chapter.title} — ${scene.title}` : scene.title;
    }
  }

  async _saveCurrentScene() {
    if (!this.state.currentSceneId) return;
    const content = this.editor.getContent();
    await this.manuscript.updateScene(this.state.currentSceneId, { content });
  }

  // --- Editor Events ---

  async _onEditorChange(content) {
    if (!this.state.currentSceneId) return;
    await this.manuscript.updateScene(this.state.currentSceneId, { content });
    await this._updateStatusBar();
    this._updateTreeWordCounts();
  }

  _onWordCountUpdate(count) {
    const wcEl = document.getElementById('status-words');
    if (wcEl) wcEl.textContent = count.toLocaleString();

    // Update daily progress
    this._trackDailyWords(count);
  }

  // --- Sidebar Rendering ---

  async _renderManuscriptTree() {
    const container = document.getElementById('sidebar-manuscript');
    if (!container || !this.state.currentProjectId) return;

    const tree = await this.manuscript.getManuscriptTree(this.state.currentProjectId);

    let html = '';
    for (const chapter of tree) {
      html += `
        <div class="tree-item chapter" data-id="${chapter.id}" data-type="chapter">
          <span class="icon">&#9656;</span>
          <span class="name">${this._esc(chapter.title)}</span>
          <span class="word-count">${chapter.wordCount.toLocaleString()}</span>
        </div>`;

      for (const scene of chapter.scenes) {
        html += `
        <div class="tree-item scene ${scene.id === this.state.currentSceneId ? 'active' : ''}"
             data-id="${scene.id}" data-type="scene" data-chapter="${chapter.id}">
          <span class="icon">&#9702;</span>
          <span class="name">${this._esc(scene.title)}</span>
          <span class="word-count">${(scene.wordCount || 0).toLocaleString()}</span>
        </div>`;
      }

      // Add scene button
      html += `
        <button class="tree-add" data-action="add-scene" data-chapter="${chapter.id}">
          + Scene
        </button>`;
    }

    // Add chapter button
    html += `
      <button class="tree-add" data-action="add-chapter">
        + Chapter
      </button>`;

    container.innerHTML = html;
  }

  async _renderCharactersList() {
    const container = document.getElementById('sidebar-characters');
    if (!container || !this.state.currentProjectId) return;

    const characters = await this.storage.getProjectCharacters(this.state.currentProjectId);

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

    const notes = await this.storage.getProjectNotes(this.state.currentProjectId);

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

  // --- Panels ---

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
    if (!this.state.currentProjectId) return;

    const project = await this.storage.get(STORE_NAMES.projects, this.state.currentProjectId);
    const totalWords = await this.storage.getProjectWordCount(this.state.currentProjectId);
    const templateId = await this.storage.getSetting('structureTemplate_' + this.state.currentProjectId, 'threeAct');

    const guidance = this.structure.getPacingGuidance(templateId, project.targetWords, totalWords);
    const beats = this.structure.mapBeatsToManuscript(templateId, project.targetWords, totalWords);

    const body = document.getElementById('panel-structure-body');
    if (!body) return;

    body.innerHTML = this._renderStructure(guidance, beats, project, templateId);
    this._showPanel('structure');
  }

  async openExportPanel() {
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

    // Clear previous errors
    const errEl = document.getElementById('generate-error');
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

    this._setGenerateStatus(false);
    this._showPanel('generate');

    // Focus the plot textarea
    setTimeout(() => plotEl?.focus(), 300);
  }

  async _runGeneration(options = {}) {
    // Use saved settings if continuing, otherwise read from panel
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

    // Always continue from existing content when generating
    const existingContent = this.editor.getContent();
    let characters = [];
    if (useCharacters && this.state.currentProjectId) {
      characters = await this.storage.getProjectCharacters(this.state.currentProjectId);
    }

    // Save settings for "Continue Writing"
    this._lastGenSettings = { plot, wordTarget, tone, style, useCharacters };

    // Get scene/chapter titles
    let sceneTitle = '';
    let chapterTitle = '';
    if (this.state.currentSceneId) {
      const scene = await this.storage.get(STORE_NAMES.scenes, this.state.currentSceneId);
      if (scene) {
        sceneTitle = scene.title;
        const chapter = await this.storage.get(STORE_NAMES.chapters, scene.chapterId);
        if (chapter) chapterTitle = chapter.title;
      }
    }

    // Hide continue bar and show generating state
    this._showContinueBar(false);
    this._setGenerateStatus(true);
    const errEl = document.getElementById('generate-error');
    if (errEl) { errEl.style.display = 'none'; }

    // Close any open panel so user can see the editor
    this._closeAllPanels();

    // Accumulate streamed text, then set it on the editor directly
    const editorEl = this.editor.element;
    let streamedText = '';

    await this.generator.generate(
      { plot, existingContent, sceneTitle, chapterTitle, characters, tone, style, wordTarget },
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
          // Save the content
          const content = this.editor.getContent();
          if (this.state.currentSceneId) {
            await this.manuscript.updateScene(this.state.currentSceneId, { content });
            await this._updateStatusBar();
            this._updateTreeWordCounts();
          }

          // If auto-writing to goal, check word count and continue
          if (this._autoWriteToGoal) {
            const currentWords = this.editor.getWordCount();
            const project = this.state.currentProjectId
              ? await this.storage.get(STORE_NAMES.projects, this.state.currentProjectId)
              : null;
            const target = project ? project.targetWords : 0;
            if (target > 0 && currentWords < target) {
              // Brief pause then continue
              setTimeout(() => this._runGeneration({ isContinuation: true }), 1500);
              return;
            } else {
              this._autoWriteToGoal = false;
            }
          }

          // Show the continue bar
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

    const project = this.state.currentProjectId
      ? await this.storage.get(STORE_NAMES.projects, this.state.currentProjectId)
      : null;

    body.innerHTML = this._renderSettings(project);
    this._showPanel('settings');
  }

  _showPanel(panelId) {
    // Close all panels first
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

  // --- Analysis Rendering ---

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

  // --- Structure Rendering ---

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

  // --- Settings Rendering ---

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
          <input type="password" class="form-input" id="setting-api-key" value="${this._esc(this.generator?.apiKey || '')}" placeholder="sk-ant-...">
          <p style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">
            Get your key at <a href="https://console.anthropic.com/settings/keys" target="_blank" style="color:var(--accent-primary);">console.anthropic.com</a>. Stored locally on this device only.
          </p>
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
          <label>Project Name</label>
          <input type="text" class="form-input" id="setting-project-name" value="${this._esc(project.name)}">
        </div>
        <div class="form-group">
          <label>Genre</label>
          <input type="text" class="form-input" id="setting-project-genre" value="${this._esc(project.genre || '')}">
        </div>
        <div class="form-group">
          <label>Target Word Count</label>
          <input type="number" class="form-input" id="setting-target-words" value="${project.targetWords}" min="1000" step="1000">
        </div>
        <div class="form-group">
          <label>Synopsis</label>
          <textarea class="form-input" id="setting-synopsis" rows="4">${this._esc(project.synopsis || '')}</textarea>
        </div>
        <button class="btn btn-primary" id="save-project-settings" style="width:100%;margin-top:8px;">Save Project Settings</button>
      </div>

      <div class="analysis-section">
        <h3>Data</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-sm" id="btn-export-json">Backup (JSON)</button>
          <button class="btn btn-sm" id="btn-import-json">Import Backup</button>
        </div>
      </div>

      <div class="analysis-section">
        <h3>Danger Zone</h3>
        <button class="btn btn-sm" id="btn-delete-project" style="border-color:var(--danger);color:var(--danger);">Delete Project</button>
      </div>
      ` : ''}
    `;
  }

  // --- Welcome Screen ---

  _showWelcome() {
    const editorArea = document.querySelector('.editor-area');
    const container = document.querySelector('.editor-container');
    if (container) {
      container.innerHTML = `
        <div class="welcome">
          <h2>Genesis 2</h2>
          <p>
            A writing studio crafted for creating world-class, best-seller prose.
            Designed for iPad, built for serious writers.
          </p>
          <button class="btn btn-primary" id="btn-new-project">Create New Project</button>
          <div style="margin-top:16px;">
            <button class="btn btn-sm" id="btn-import-project">Import Existing Project</button>
          </div>
        </div>
      `;
    }
    document.getElementById('project-title').textContent = 'Genesis 2';
  }

  // --- Event Binding ---

  _bindEvents() {
    // Sidebar toggle
    document.getElementById('btn-sidebar-toggle')?.addEventListener('click', () => {
      this.state.sidebarOpen = !this.state.sidebarOpen;
      document.getElementById('app').classList.toggle('sidebar-collapsed', !this.state.sidebarOpen);
      // Mobile sidebar
      document.querySelector('.sidebar')?.classList.toggle('mobile-open', this.state.sidebarOpen);
    });

    // Focus mode
    document.getElementById('btn-focus-mode')?.addEventListener('click', () => {
      this.state.focusMode = !this.state.focusMode;
      document.getElementById('app').classList.toggle('focus-mode', this.state.focusMode);
    });

    // Sidebar navigation tabs
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

    // Sidebar content clicks (event delegation)
    document.querySelector('.sidebar-content')?.addEventListener('click', async (e) => {
      const treeItem = e.target.closest('.tree-item');
      const addBtn = e.target.closest('.tree-add');

      if (treeItem) {
        const type = treeItem.dataset.type;
        const id = treeItem.dataset.id;

        if (type === 'scene') {
          await this._loadScene(id);
        } else if (type === 'chapter') {
          // Toggle expand / select first scene
          const chapterId = id;
          const scenes = await this.storage.getChapterScenes(chapterId);
          if (scenes.length > 0) {
            await this._loadScene(scenes[0].id);
          }
        } else if (type === 'note') {
          await this._openNoteEditor(id);
        }
      }

      if (addBtn) {
        const action = addBtn.dataset.action;
        if (action === 'add-chapter') {
          const title = await this._prompt('Chapter Title', `Chapter ${document.querySelectorAll('.tree-item.chapter').length + 1}`);
          if (title && this.state.currentProjectId) {
            const ch = await this.manuscript.createChapter(this.state.currentProjectId, title);
            const sc = await this.manuscript.createScene(ch.id);
            await this._renderManuscriptTree();
            await this._loadScene(sc.id);
          }
        } else if (action === 'add-scene') {
          const chapterId = addBtn.dataset.chapter;
          const title = await this._prompt('Scene Title', 'New Scene');
          if (title && chapterId) {
            const sc = await this.manuscript.createScene(chapterId, title);
            await this._renderManuscriptTree();
            await this._loadScene(sc.id);
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

    // Character card clicks
    document.querySelector('.sidebar-content')?.addEventListener('click', async (e) => {
      const card = e.target.closest('.character-card');
      if (card) {
        await this._openCharacterEditor(card.dataset.id);
      }
    });

    // Toolbar buttons
    document.getElementById('btn-bold')?.addEventListener('click', () => this.editor.bold());
    document.getElementById('btn-italic')?.addEventListener('click', () => this.editor.italic());
    document.getElementById('btn-heading')?.addEventListener('click', () => this.editor.insertHeading());
    document.getElementById('btn-blockquote')?.addEventListener('click', () => this.editor.insertBlockquote());
    document.getElementById('btn-scene-break')?.addEventListener('click', () => this.editor.insertSceneBreak());
    document.getElementById('btn-undo')?.addEventListener('click', () => this.editor.undo());
    document.getElementById('btn-redo')?.addEventListener('click', () => this.editor.redo());

    // Panel buttons
    document.getElementById('btn-generate')?.addEventListener('click', () => this.openGeneratePanel());
    document.getElementById('btn-analysis')?.addEventListener('click', () => this.openAnalysisPanel());
    document.getElementById('btn-structure')?.addEventListener('click', () => this.openStructurePanel());
    document.getElementById('btn-export')?.addEventListener('click', () => this.openExportPanel());
    document.getElementById('btn-settings')?.addEventListener('click', () => this.openSettingsPanel());

    // Panel overlay close
    document.getElementById('panel-overlay')?.addEventListener('click', () => this._closeAllPanels());
    document.querySelectorAll('.panel-close').forEach(btn => {
      btn.addEventListener('click', () => this._closeAllPanels());
    });

    // Export panel actions
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

    // Welcome screen buttons (use event delegation since they're dynamically created)
    document.addEventListener('click', async (e) => {
      if (e.target.id === 'btn-new-project' || e.target.closest('#btn-new-project')) {
        await this.createNewProject();
      }
      if (e.target.id === 'btn-import-project' || e.target.closest('#btn-import-project')) {
        this._importProjectFromFile();
      }
    });

    // Settings panel dynamic events
    document.addEventListener('change', async (e) => {
      if (e.target.id === 'setting-theme') {
        this.state.theme = e.target.value;
        this._applyTheme(this.state.theme);
        await this.storage.setSetting('theme', this.state.theme);
      }
      if (e.target.id === 'setting-daily-goal') {
        this.state.dailyGoal = parseInt(e.target.value) || 1000;
        await this.storage.setSetting('dailyGoal', this.state.dailyGoal);
      }
      if (e.target.id === 'structure-template-select') {
        await this.storage.setSetting('structureTemplate_' + this.state.currentProjectId, e.target.value);
        await this.openStructurePanel();
      }
    });

    document.addEventListener('click', async (e) => {
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
      if (e.target.id === 'btn-import-json') {
        this._importProjectFromFile();
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

    // Handle visibility change for auto-save
    document.addEventListener('visibilitychange', async () => {
      if (document.hidden) {
        await this._saveCurrentScene();
      }
    });

    // Before unload save
    window.addEventListener('beforeunload', () => {
      this._saveCurrentScene();
    });
  }

  // --- Helper methods ---

  async _updateStatusBar() {
    if (!this.state.currentProjectId) return;

    const totalWords = await this.storage.getProjectWordCount(this.state.currentProjectId);
    const project = await this.storage.get(STORE_NAMES.projects, this.state.currentProjectId);
    const progress = project ? Math.round((totalWords / project.targetWords) * 100) : 0;

    const el = (id) => document.getElementById(id);
    const totalEl = el('status-total');
    const goalEl = el('status-goal');
    const progressEl = el('status-progress');
    const dailyEl = el('status-daily');

    if (totalEl) totalEl.textContent = totalWords.toLocaleString();
    if (goalEl) goalEl.textContent = project ? project.targetWords.toLocaleString() : '—';
    if (progressEl) progressEl.textContent = progress + '%';
    if (dailyEl) dailyEl.textContent = `${this.state.wordsToday} / ${this.state.dailyGoal}`;
  }

  async _updateTreeWordCounts() {
    if (!this.state.currentProjectId) return;
    const tree = await this.manuscript.getManuscriptTree(this.state.currentProjectId);

    for (const ch of tree) {
      const chEl = document.querySelector(`.tree-item.chapter[data-id="${ch.id}"] .word-count`);
      if (chEl) chEl.textContent = ch.wordCount.toLocaleString();

      for (const sc of ch.scenes) {
        const scEl = document.querySelector(`.tree-item.scene[data-id="${sc.id}"] .word-count`);
        if (scEl) scEl.textContent = (sc.wordCount || 0).toLocaleString();
      }
    }
  }

  async _loadDailyProgress() {
    const today = new Date().toISOString().split('T')[0];
    this.state.wordsToday = await this.storage.getSetting('wordsToday_' + today, 0);
  }

  _trackDailyWords(currentSceneWords) {
    // Simple daily tracking — stores session delta
    const today = new Date().toISOString().split('T')[0];
    const key = 'wordsToday_' + today;
    // This is a simplified tracker — a production version would track
    // the delta between session start and current word count
    this.storage.setSetting(key, Math.max(this.state.wordsToday, currentSceneWords));
  }

  _applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme === 'dark' ? '' : theme);
    if (theme === 'dark') document.documentElement.removeAttribute('data-theme');
  }

  async _saveProjectSettings() {
    if (!this.state.currentProjectId) return;
    const name = document.getElementById('setting-project-name')?.value;
    const genre = document.getElementById('setting-project-genre')?.value;
    const targetWords = parseInt(document.getElementById('setting-target-words')?.value) || 80000;
    const synopsis = document.getElementById('setting-synopsis')?.value;

    await this.manuscript.updateProject(this.state.currentProjectId, {
      name, genre, targetWords, synopsis
    });

    document.getElementById('project-title').textContent = name;
    this._closeAllPanels();
  }

  async _deleteCurrentProject() {
    if (!this.state.currentProjectId) return;
    if (!confirm('Delete this entire project? This cannot be undone.')) return;
    if (!confirm('Are you absolutely sure? All chapters, scenes, characters, and notes will be permanently deleted.')) return;

    await this.manuscript.deleteProject(this.state.currentProjectId);
    this.state.currentProjectId = null;
    this.state.currentSceneId = null;
    await this.storage.setSetting('lastProjectId', null);
    this._closeAllPanels();
    this._showWelcome();
  }

  _importProjectFromFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const project = await this.storage.importProject(data);
        if (project) {
          await this._loadProject(project.id);
        }
      } catch (err) {
        alert('Failed to import: ' + err.message);
      }
    });
    input.click();
  }

  async _openCharacterEditor(charId) {
    const character = await this.storage.get(STORE_NAMES.characters, charId);
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
    const note = await this.storage.get(STORE_NAMES.notes, noteId);
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
