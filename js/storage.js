/**
 * Genesis 2 — Storage Layer
 * IndexedDB-based persistence for manuscripts, characters, and settings.
 * Designed for reliable offline usage on iPad.
 */

const DB_NAME = 'genesis2';
const DB_VERSION = 3;

const STORES = {
  projects: 'projects',
  chapters: 'chapters',
  scenes: 'scenes',
  characters: 'characters',
  notes: 'notes',
  settings: 'settings',
  snapshots: 'snapshots',
  errorPatterns: 'errorPatterns',
  knowledgeBase: 'knowledgeBase'
};

class Storage {
  constructor() {
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;

        // Projects store
        if (!db.objectStoreNames.contains(STORES.projects)) {
          const projects = db.createObjectStore(STORES.projects, { keyPath: 'id' });
          projects.createIndex('updatedAt', 'updatedAt');
        }

        // Chapters store
        if (!db.objectStoreNames.contains(STORES.chapters)) {
          const chapters = db.createObjectStore(STORES.chapters, { keyPath: 'id' });
          chapters.createIndex('projectId', 'projectId');
          chapters.createIndex('order', 'order');
        }

        // Scenes store
        if (!db.objectStoreNames.contains(STORES.scenes)) {
          const scenes = db.createObjectStore(STORES.scenes, { keyPath: 'id' });
          scenes.createIndex('chapterId', 'chapterId');
          scenes.createIndex('order', 'order');
        }

        // Characters store
        if (!db.objectStoreNames.contains(STORES.characters)) {
          const chars = db.createObjectStore(STORES.characters, { keyPath: 'id' });
          chars.createIndex('projectId', 'projectId');
        }

        // Notes store
        if (!db.objectStoreNames.contains(STORES.notes)) {
          const notes = db.createObjectStore(STORES.notes, { keyPath: 'id' });
          notes.createIndex('projectId', 'projectId');
          notes.createIndex('type', 'type');
        }

        // Settings store
        if (!db.objectStoreNames.contains(STORES.settings)) {
          db.createObjectStore(STORES.settings, { keyPath: 'key' });
        }

        // Snapshots (version history)
        if (!db.objectStoreNames.contains(STORES.snapshots)) {
          const snaps = db.createObjectStore(STORES.snapshots, { keyPath: 'id' });
          snaps.createIndex('sceneId', 'sceneId');
          snaps.createIndex('createdAt', 'createdAt');
        }

        // Error Patterns (cross-project error database for negative prompts)
        if (!db.objectStoreNames.contains(STORES.errorPatterns)) {
          const errors = db.createObjectStore(STORES.errorPatterns, { keyPath: 'id' });
          errors.createIndex('category', 'category');
          errors.createIndex('frequency', 'frequency');
          errors.createIndex('lastSeen', 'lastSeen');
        }

        // Knowledge Base (per-project imported reference materials)
        if (!db.objectStoreNames.contains(STORES.knowledgeBase)) {
          const kb = db.createObjectStore(STORES.knowledgeBase, { keyPath: 'id' });
          kb.createIndex('projectId', 'projectId');
          kb.createIndex('type', 'type');
        }
      };

      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this);
      };

      request.onerror = (e) => {
        reject(e.target.error);
      };
    });
  }

  // Generic CRUD operations

  async put(storeName, data) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.put(data);
      request.onsuccess = () => resolve(data);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async get(storeName, id) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async getAll(storeName) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async getAllByIndex(storeName, indexName, value) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const index = store.index(indexName);
      const request = index.getAll(value);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async delete(storeName, id) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async count(storeName) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  // Project-specific helpers

  async getProjectChapters(projectId) {
    const chapters = await this.getAllByIndex(STORES.chapters, 'projectId', projectId);
    return chapters.sort((a, b) => a.order - b.order);
  }

  async getChapterScenes(chapterId) {
    const scenes = await this.getAllByIndex(STORES.scenes, 'chapterId', chapterId);
    return scenes.sort((a, b) => a.order - b.order);
  }

  async getProjectCharacters(projectId) {
    return this.getAllByIndex(STORES.characters, 'projectId', projectId);
  }

  async getProjectNotes(projectId) {
    return this.getAllByIndex(STORES.notes, 'projectId', projectId);
  }

  async getSceneSnapshots(sceneId) {
    const snaps = await this.getAllByIndex(STORES.snapshots, 'sceneId', sceneId);
    return snaps.sort((a, b) => b.createdAt - a.createdAt);
  }

  // Settings helpers

  async getSetting(key, defaultValue = null) {
    const result = await this.get(STORES.settings, key);
    return result ? result.value : defaultValue;
  }

  async setSetting(key, value) {
    return this.put(STORES.settings, { key, value });
  }

  // Project word count (aggregate)

  async getProjectWordCount(projectId) {
    const chapters = await this.getProjectChapters(projectId);
    let total = 0;
    for (const ch of chapters) {
      const scenes = await this.getChapterScenes(ch.id);
      for (const scene of scenes) {
        total += scene.wordCount || 0;
      }
    }
    return total;
  }

  // Create snapshot of a scene's content

  async createSnapshot(sceneId, content) {
    const id = 'snap_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    return this.put(STORES.snapshots, {
      id,
      sceneId,
      content,
      createdAt: Date.now()
    });
  }

  // Export entire project as JSON

  async exportProject(projectId) {
    const project = await this.get(STORES.projects, projectId);
    const chapters = await this.getProjectChapters(projectId);
    const allScenes = [];
    for (const ch of chapters) {
      const scenes = await this.getChapterScenes(ch.id);
      allScenes.push(...scenes);
    }
    const characters = await this.getProjectCharacters(projectId);
    const notes = await this.getProjectNotes(projectId);

    return {
      version: '2.0',
      exportDate: new Date().toISOString(),
      project,
      chapters,
      scenes: allScenes,
      characters,
      notes
    };
  }

  // Import project from JSON

  async importProject(data) {
    if (data.project) await this.put(STORES.projects, data.project);
    if (data.chapters) {
      for (const ch of data.chapters) await this.put(STORES.chapters, ch);
    }
    if (data.scenes) {
      for (const sc of data.scenes) await this.put(STORES.scenes, sc);
    }
    if (data.characters) {
      for (const c of data.characters) await this.put(STORES.characters, c);
    }
    if (data.notes) {
      for (const n of data.notes) await this.put(STORES.notes, n);
    }
    return data.project;
  }
}

const STORE_NAMES = STORES;
export { Storage, STORE_NAMES };
