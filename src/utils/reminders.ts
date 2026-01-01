// Lightweight IndexedDB helper for storing reminder timestamps

export interface ReminderTimestamp {
  id: string; // unique id
  timeMs: number;
  title?: string;
  body?: string;
  source?: 'scheduled' | 'threshold';
  meta?: any;
}

const DB_NAME = 'hrt-reminders-db';
const STORE_NAME = 'reminders';
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        // index by time for range queries
        store.createIndex('by_time', 'timeMs', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function addReminderTimestamp(rem: ReminderTimestamp): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(rem);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getDueReminders(beforeMs: number): Promise<ReminderTimestamp[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const idx = store.index('by_time');
    const range = IDBKeyRange.upperBound(beforeMs);
    const res: ReminderTimestamp[] = [];
    const req = idx.openCursor(range);
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return resolve(res);
      res.push(cur.value as ReminderTimestamp);
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteReminderTimestamp(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listReminders(): Promise<ReminderTimestamp[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result as ReminderTimestamp[]);
    req.onerror = () => reject(req.error);
  });
}
