import { validateSavedStage } from './StageArchive.js';

// Summaries are separate so opening the list never fetches every music file.
export class StageLibrary {
  constructor() { this.connection = null; }

  async open() {
    if (this.connection) return this.connection;
    if (!globalThis.indexedDB) throw new Error('このブラウザでは保存一覧を使えません。ファイル書出しをご利用ください');
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('soundgame-stage-library', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('stages', { keyPath: 'id' });
        request.result.createObjectStore('summaries', { keyPath: 'id' });
      };
      request.onerror = () => reject(new Error('保存領域を開けません。ファイル書出しをご利用ください'));
      request.onblocked = () => reject(new Error('別のゲームタブを閉じてから再読み込みしてください'));
      request.onsuccess = () => {
        this.connection = request.result;
        this.connection.onversionchange = () => this.close();
        resolve(this.connection);
      };
    });
  }

  async list() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db.transaction('summaries').objectStore('summaries').getAll();
      request.onsuccess = () => resolve(request.result.sort((a, b) => b.createdAt - a.createdAt));
      request.onerror = () => reject(new Error('保存一覧を読み込めませんでした'));
    });
  }

  async get(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db.transaction('stages').objectStore('stages').get(id);
      request.onsuccess = () => request.result ? resolve(request.result) : reject(new Error('保存ステージが見つかりません'));
      request.onerror = () => reject(new Error('保存ステージを読み込めませんでした'));
    });
  }

  async save(record) {
    validateSavedStage(record);
    const db = await this.open();
    const id = crypto.randomUUID(), createdAt = Date.now();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['stages', 'summaries'], 'readwrite');
      transaction.objectStore('stages').add({ ...record, id, createdAt });
      transaction.objectStore('summaries').add({ id, createdAt, name: record.name, audioName: record.audioName });
      transaction.oncomplete = () => resolve(id);
      transaction.onabort = () => reject(new Error(transaction.error?.name === 'QuotaExceededError'
        ? '保存容量が足りません。音楽入りファイルを書き出して保管してください'
        : '保存できませんでした。音楽入りファイルの書出しをお試しください'));
      transaction.onerror = () => {}; // onabort handles the complete transaction failure.
    });
  }

  close() { this.connection?.close(); this.connection = null; }
}
