/**
 * Genesis 2 — Manuscript Manager
 * Handles projects, chapters, and scenes.
 */

import { STORE_NAMES } from './storage.js';

class ManuscriptManager {
  constructor(storage) {
    this.storage = storage;
    this.currentProject = null;
    this.currentScene = null;
  }

  // --- ID generation ---

  _id(prefix) {
    return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }

  // --- Projects ---

  async createProject(name, genre = '', targetWords = 80000) {
    const project = {
      id: this._id('proj'),
      name,
      genre,
      targetWords,
      synopsis: '',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await this.storage.put(STORE_NAMES.projects, project);
    return project;
  }

  async getProjects() {
    const projects = await this.storage.getAll(STORE_NAMES.projects);
    return projects.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async updateProject(id, updates) {
    const project = await this.storage.get(STORE_NAMES.projects, id);
    if (!project) return null;
    Object.assign(project, updates, { updatedAt: Date.now() });
    await this.storage.put(STORE_NAMES.projects, project);
    return project;
  }

  async deleteProject(id) {
    // Delete all related data
    const chapters = await this.storage.getProjectChapters(id);
    for (const ch of chapters) {
      const scenes = await this.storage.getChapterScenes(ch.id);
      for (const sc of scenes) {
        await this.storage.delete(STORE_NAMES.scenes, sc.id);
      }
      await this.storage.delete(STORE_NAMES.chapters, ch.id);
    }
    const chars = await this.storage.getProjectCharacters(id);
    for (const c of chars) {
      await this.storage.delete(STORE_NAMES.characters, c.id);
    }
    const notes = await this.storage.getProjectNotes(id);
    for (const n of notes) {
      await this.storage.delete(STORE_NAMES.notes, n.id);
    }
    await this.storage.delete(STORE_NAMES.projects, id);
  }

  // --- Chapters ---

  async createChapter(projectId, title = 'Untitled Chapter') {
    const existing = await this.storage.getProjectChapters(projectId);
    const chapter = {
      id: this._id('ch'),
      projectId,
      title,
      order: existing.length,
      notes: '',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await this.storage.put(STORE_NAMES.chapters, chapter);
    await this._touchProject(projectId);
    return chapter;
  }

  async updateChapter(id, updates) {
    const chapter = await this.storage.get(STORE_NAMES.chapters, id);
    if (!chapter) return null;
    Object.assign(chapter, updates, { updatedAt: Date.now() });
    await this.storage.put(STORE_NAMES.chapters, chapter);
    await this._touchProject(chapter.projectId);
    return chapter;
  }

  async deleteChapter(id) {
    const chapter = await this.storage.get(STORE_NAMES.chapters, id);
    if (!chapter) return;
    const scenes = await this.storage.getChapterScenes(id);
    for (const sc of scenes) {
      await this.storage.delete(STORE_NAMES.scenes, sc.id);
    }
    await this.storage.delete(STORE_NAMES.chapters, id);
    await this._reorderChapters(chapter.projectId);
    await this._touchProject(chapter.projectId);
  }

  async reorderChapter(id, newOrder) {
    const chapter = await this.storage.get(STORE_NAMES.chapters, id);
    if (!chapter) return;
    const chapters = await this.storage.getProjectChapters(chapter.projectId);
    const oldOrder = chapter.order;

    for (const ch of chapters) {
      if (ch.id === id) {
        ch.order = newOrder;
      } else if (newOrder < oldOrder && ch.order >= newOrder && ch.order < oldOrder) {
        ch.order++;
      } else if (newOrder > oldOrder && ch.order > oldOrder && ch.order <= newOrder) {
        ch.order--;
      }
      await this.storage.put(STORE_NAMES.chapters, ch);
    }
  }

  // --- Scenes ---

  async createScene(chapterId, title = 'Untitled Scene') {
    const existing = await this.storage.getChapterScenes(chapterId);
    const chapter = await this.storage.get(STORE_NAMES.chapters, chapterId);
    const scene = {
      id: this._id('sc'),
      chapterId,
      projectId: chapter ? chapter.projectId : null,
      title,
      content: '',
      wordCount: 0,
      order: existing.length,
      status: 'draft', // draft, revised, final
      pov: '',
      location: '',
      notes: '',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await this.storage.put(STORE_NAMES.scenes, scene);
    if (chapter) await this._touchProject(chapter.projectId);
    return scene;
  }

  async updateScene(id, updates) {
    const scene = await this.storage.get(STORE_NAMES.scenes, id);
    if (!scene) return null;

    // Calculate word count if content changed
    if (updates.content !== undefined) {
      const text = updates.content.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');
      const words = text.match(/[a-zA-Z''-]+/g) || [];
      updates.wordCount = words.length;
    }

    Object.assign(scene, updates, { updatedAt: Date.now() });
    await this.storage.put(STORE_NAMES.scenes, scene);

    const chapter = await this.storage.get(STORE_NAMES.chapters, scene.chapterId);
    if (chapter) await this._touchProject(chapter.projectId);

    return scene;
  }

  async deleteScene(id) {
    const scene = await this.storage.get(STORE_NAMES.scenes, id);
    if (!scene) return;
    await this.storage.delete(STORE_NAMES.scenes, id);
    await this._reorderScenes(scene.chapterId);
  }

  // --- Characters ---

  async createCharacter(projectId, data = {}) {
    const character = {
      id: this._id('char'),
      projectId,
      name: data.name || 'New Character',
      role: data.role || 'supporting', // protagonist, antagonist, supporting, minor
      description: data.description || '',
      motivation: data.motivation || '',
      arc: data.arc || '',
      traits: data.traits || [],
      relationships: data.relationships || [],
      notes: data.notes || '',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await this.storage.put(STORE_NAMES.characters, character);
    return character;
  }

  async updateCharacter(id, updates) {
    const character = await this.storage.get(STORE_NAMES.characters, id);
    if (!character) return null;
    Object.assign(character, updates, { updatedAt: Date.now() });
    await this.storage.put(STORE_NAMES.characters, character);
    return character;
  }

  async deleteCharacter(id) {
    await this.storage.delete(STORE_NAMES.characters, id);
  }

  // --- Notes ---

  async createNote(projectId, data = {}) {
    const note = {
      id: this._id('note'),
      projectId,
      title: data.title || 'Untitled Note',
      type: data.type || 'general', // general, worldbuilding, research, plot
      content: data.content || '',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await this.storage.put(STORE_NAMES.notes, note);
    return note;
  }

  async updateNote(id, updates) {
    const note = await this.storage.get(STORE_NAMES.notes, id);
    if (!note) return null;
    Object.assign(note, updates, { updatedAt: Date.now() });
    await this.storage.put(STORE_NAMES.notes, note);
    return note;
  }

  async deleteNote(id) {
    await this.storage.delete(STORE_NAMES.notes, id);
  }

  // --- Full manuscript tree ---

  async getManuscriptTree(projectId) {
    const chapters = await this.storage.getProjectChapters(projectId);
    const tree = [];

    for (const ch of chapters) {
      const scenes = await this.storage.getChapterScenes(ch.id);
      const chapterWords = scenes.reduce((sum, s) => sum + (s.wordCount || 0), 0);
      tree.push({
        ...ch,
        wordCount: chapterWords,
        scenes: scenes.map(s => ({
          ...s
        }))
      });
    }

    return tree;
  }

  // --- Private helpers ---

  async _touchProject(projectId) {
    const project = await this.storage.get(STORE_NAMES.projects, projectId);
    if (project) {
      project.updatedAt = Date.now();
      await this.storage.put(STORE_NAMES.projects, project);
    }
  }

  async _reorderChapters(projectId) {
    const chapters = await this.storage.getProjectChapters(projectId);
    for (let i = 0; i < chapters.length; i++) {
      chapters[i].order = i;
      await this.storage.put(STORE_NAMES.chapters, chapters[i]);
    }
  }

  async _reorderScenes(chapterId) {
    const scenes = await this.storage.getChapterScenes(chapterId);
    for (let i = 0; i < scenes.length; i++) {
      scenes[i].order = i;
      await this.storage.put(STORE_NAMES.scenes, scenes[i]);
    }
  }
}

export { ManuscriptManager };
