// Tiny IndexedDB wrapper. Everything is stored on the phone.
const NAME = 'kdex-agent';
const VERSION = 2;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const has = (n) => db.objectStoreNames.contains(n);
      if (!has('kv')) db.createObjectStore('kv', { keyPath: 'key' });
      if (!has('chats')) db.createObjectStore('chats', { keyPath: 'id' });
      if (!has('messages')) { const msgs = db.createObjectStore('messages', { keyPath: 'id', autoIncrement: true }); msgs.createIndex('chatId', 'chatId'); }
      if (!has('backups')) { const backups = db.createObjectStore('backups', { keyPath: 'id', autoIncrement: true }); backups.createIndex('chatId', 'chatId'); }
      if (!has('usage')) { const usage = db.createObjectStore('usage', { keyPath: 'id', autoIncrement: true }); usage.createIndex('day', 'day'); }
      if (!has('scratch')) { const sc = db.createObjectStore('scratch', { keyPath: 'k' }); sc.createIndex('chatId', 'chatId'); } // temporary files of chats without a folder
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function wrap(req) {
  return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}

async function tx(store, mode, fn) {
  const db = await open();
  const t = db.transaction(store, mode);
  const s = t.objectStore(store);
  const result = await fn(s);
  await new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = () => reject(t.error); t.onabort = () => reject(t.error); });
  return result;
}

export const db = {
  get: (store, key) => tx(store, 'readonly', (s) => wrap(s.get(key))),
  put: (store, obj) => tx(store, 'readwrite', (s) => wrap(s.put(obj))),
  del: (store, key) => tx(store, 'readwrite', (s) => wrap(s.delete(key))),
  all: (store) => tx(store, 'readonly', (s) => wrap(s.getAll())),
  byIndex: (store, index, value) => tx(store, 'readonly', (s) => wrap(s.index(index).getAll(value))),
  async delByIndex(store, index, value) {
    const db0 = await open();
    const t = db0.transaction(store, 'readwrite');
    const s = t.objectStore(store);
    const keys = await wrap(s.index(index).getAllKeys(value));
    keys.forEach((k) => s.delete(k));
    await new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = () => reject(t.error); });
  },
};

// Key-value settings
export async function kvGet(key, fallback) {
  const r = await db.get('kv', key);
  return r ? r.value : fallback;
}
export function kvSet(key, value) { return db.put('kv', { key, value }); }
