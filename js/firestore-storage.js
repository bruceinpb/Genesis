/**
 * Genesis 2 — Firestore Storage Layer
 * Cloud persistence for users, projects, and chapters.
 * Replaces IndexedDB for shared/multi-user data.
 */

import { db } from './firebase-config.js';
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, where, writeBatch
} from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js';

class FirestoreStorage {

  // --- ID generation ---

  _id(prefix) {
    return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }

  // --- Users ---

  async getOrCreateUser(userName) {
    const userRef = doc(db, 'users', userName);
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      return { id: userName, ...userSnap.data() };
    }
    const userData = { displayName: userName, createdAt: new Date() };
    await setDoc(userRef, userData);
    return { id: userName, ...userData };
  }

  async getAllUsers() {
    const snap = await getDocs(collection(db, 'users'));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  // --- Projects ---

  async createProject(data) {
    const id = this._id('proj');
    const project = {
      owner: data.owner,
      title: data.title,
      genre: data.genre || '',
      wordCountGoal: data.wordCountGoal || 80000,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await setDoc(doc(db, 'projects', id), project);
    return { id, ...project };
  }

  async getProject(projectId) {
    const snap = await getDoc(doc(db, 'projects', projectId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
  }

  async getAllProjects() {
    const snap = await getDocs(collection(db, 'projects'));
    const projects = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return projects.sort((a, b) => {
      const aTime = a.updatedAt?.toDate ? a.updatedAt.toDate().getTime() : new Date(a.updatedAt).getTime();
      const bTime = b.updatedAt?.toDate ? b.updatedAt.toDate().getTime() : new Date(b.updatedAt).getTime();
      return bTime - aTime;
    });
  }

  async updateProject(projectId, updates) {
    const ref = doc(db, 'projects', projectId);
    await updateDoc(ref, { ...updates, updatedAt: new Date() });
  }

  async deleteProject(projectId) {
    const chapters = await this.getProjectChapters(projectId);
    const batch = writeBatch(db);
    for (const ch of chapters) {
      batch.delete(doc(db, 'chapters', ch.id));
    }
    batch.delete(doc(db, 'projects', projectId));
    await batch.commit();
  }

  // --- Chapters ---

  async createChapter(data) {
    const id = this._id('ch');
    const chapter = {
      projectId: data.projectId,
      chapterNumber: data.chapterNumber || 1,
      title: data.title || 'Untitled Chapter',
      content: data.content || '',
      wordCount: 0,
      status: data.status || 'draft',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await setDoc(doc(db, 'chapters', id), chapter);
    return { id, ...chapter };
  }

  async getChapter(chapterId) {
    const snap = await getDoc(doc(db, 'chapters', chapterId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
  }

  async getProjectChapters(projectId) {
    const snap = await getDocs(query(
      collection(db, 'chapters'),
      where('projectId', '==', projectId)
    ));
    const chapters = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return chapters.sort((a, b) => (a.chapterNumber || 0) - (b.chapterNumber || 0));
  }

  async updateChapter(chapterId, updates) {
    const ref = doc(db, 'chapters', chapterId);
    if (updates.content !== undefined) {
      const text = updates.content.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');
      const words = text.match(/[a-zA-Z'''\u2019-]+/g) || [];
      updates.wordCount = words.length;
    }
    await updateDoc(ref, { ...updates, updatedAt: new Date() });
  }

  async deleteChapter(chapterId) {
    await deleteDoc(doc(db, 'chapters', chapterId));
  }

  async reorderChapters(projectId, orderedChapterIds) {
    const batch = writeBatch(db);
    orderedChapterIds.forEach((id, index) => {
      batch.update(doc(db, 'chapters', id), { chapterNumber: index + 1 });
    });
    await batch.commit();
  }

  // --- Helpers ---

  async getProjectWordCount(projectId) {
    const chapters = await this.getProjectChapters(projectId);
    return chapters.reduce((sum, ch) => sum + (ch.wordCount || 0), 0);
  }

  async exportProject(projectId) {
    const project = await this.getProject(projectId);
    const chapters = await this.getProjectChapters(projectId);
    return {
      version: '2.0',
      exportDate: new Date().toISOString(),
      project,
      chapters
    };
  }
}

export { FirestoreStorage };
