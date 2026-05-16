// IndexedDB persistence for conversations.
//
// Why IndexedDB instead of localStorage:
//   • Conversations can grow large (artifacts, tool results) — localStorage's
//     5-10 MB quota gets hit fast.
//   • Native binary support for artifact bodies; no JSON-stringify overhead.
//   • Async API doesn't block the main thread on big writes.
//   • Survives across refreshes, browser updates, and most cache clears.
//
// The schema is intentionally simple — one object store keyed by conversation
// id, value is the full Conversation object. Future-proof for adding indexes
// (e.g. by updatedAt for sidebar sort) without a migration.

import type { Conversation } from './types';

const DB_NAME = 'nandai-chat';
const DB_VERSION = 1;
const STORE = 'conversations';

// ─── LRU eviction policy (tick-012) ──────────────────────────────────────────
// Defensive cap to prevent runaway growth — origin quota in Chromium/Safari
// is ~10 % of free disk, but a single conversation with embedded artifacts
// can hit hundreds of KB. With 200 convs * ~50 KB avg = 10 MB ceiling.
// When we cross MAX_CONVS, evict OLDEST UNPINNED until back at SOFT_TARGET.
// Pinned convs are sacred — the operator's expressed preference always wins.
const MAX_CONVS = 200;
const SOFT_TARGET = 160;

let _dbPromise: Promise<IDBDatabase> | null = null;
function openDB(): Promise<IDBDatabase> {
  if (_dbPromise) return _dbPromise;
  if (typeof indexedDB === 'undefined') {
    // SSR / sandboxed iframe — return a stub rejection so callers can no-op.
    _dbPromise = Promise.reject(new Error('indexedDB unavailable'));
    return _dbPromise;
  }
  _dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' });
        os.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

/** Load every saved conversation, newest-updated first. Empty array on fail. */
export async function loadAllConversations(): Promise<Conversation[]> {
  try {
    const db = await openDB();
    return new Promise<Conversation[]>((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const os = tx.objectStore(STORE);
      const req = os.getAll();
      req.onsuccess = () => {
        const arr = (req.result as Conversation[]) || [];
        // Sort by updatedAt desc — sidebar's natural order.
        arr.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
        resolve(arr);
      };
      req.onerror = () => resolve([]);
    });
  } catch { return []; }
}

/** Save (upsert) one conversation. Resolves silently on failure. */
export async function saveConversation(c: Conversation): Promise<void> {
  try {
    const db = await openDB();
    return new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      const os = tx.objectStore(STORE);
      const req = os.put(c);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  } catch { /* swallow */ }
}

/** Delete one conversation by id. */
export async function deleteConversationFromDB(id: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      const os = tx.objectStore(STORE);
      const req = os.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  } catch { /* swallow */ }
}

/** Persist many conversations in one transaction. Used on debounced batch saves.
 *  After writing, kicks off a fire-and-forget LRU pass — runs ONLY if the store
 *  has grown past MAX_CONVS, so most saves do zero extra work. */
export async function saveManyConversations(convos: Conversation[]): Promise<void> {
  if (!convos.length) return;
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      const os = tx.objectStore(STORE);
      for (const c of convos) {
        try { os.put(c); } catch { /* skip bad row */ }
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
    // Best-effort LRU sweep — never user-blocking, errors swallowed.
    void enforceCap();
  } catch { /* swallow */ }
}

/** Public LRU enforcer. Returns the number of convs evicted (0 if under cap).
 *  Exported so a future "Storage" section in Settings can trigger it manually. */
export async function enforceCap(): Promise<number> {
  try {
    const db = await openDB();
    return await new Promise<number>((resolve) => {
      // Read-only first: cheap count + early bail.
      const ro = db.transaction(STORE, 'readonly');
      const cntReq = ro.objectStore(STORE).count();
      cntReq.onsuccess = () => {
        const total = cntReq.result;
        if (total <= MAX_CONVS) { resolve(0); return; }
        const toEvict = total - SOFT_TARGET;
        // Read-write cursor over the updatedAt index (ascending = oldest first).
        // Skip pinned entries — never evict an operator favorite.
        const rw = db.transaction(STORE, 'readwrite');
        const os = rw.objectStore(STORE);
        const idx = os.index('updatedAt');
        let evicted = 0;
        const cur = idx.openCursor();  // ascending by default
        cur.onsuccess = () => {
          const c = cur.result;
          if (!c || evicted >= toEvict) {
            // Cursor exhausted OR we've evicted enough — let the txn close.
            return;
          }
          const conv = c.value as Conversation;
          if (conv.pinned) {
            c.continue();
            return;
          }
          os.delete(conv.id);
          evicted++;
          c.continue();
        };
        rw.oncomplete = () => resolve(evicted);
        rw.onerror = () => resolve(evicted);
        rw.onabort = () => resolve(evicted);
      };
      cntReq.onerror = () => resolve(0);
    });
  } catch { return 0; }
}

/** Storage stats helper — count and pinned-count. Used by Settings UI to
 *  show "X conversations stored (Y pinned)" in the data-management panel. */
export async function getStorageStats(): Promise<{ count: number; pinned: number; cap: number; softTarget: number }> {
  const blank = { count: 0, pinned: 0, cap: MAX_CONVS, softTarget: SOFT_TARGET };
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const all = tx.objectStore(STORE).getAll();
      all.onsuccess = () => {
        const arr = (all.result as Conversation[]) || [];
        resolve({
          count: arr.length,
          pinned: arr.filter((c) => c.pinned).length,
          cap: MAX_CONVS,
          softTarget: SOFT_TARGET,
        });
      };
      all.onerror = () => resolve(blank);
    });
  } catch { return blank; }
}

/** Wipe everything (used by "clear all chats" if we add it). */
export async function clearAllConversations(): Promise<void> {
  try {
    const db = await openDB();
    return new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      const os = tx.objectStore(STORE);
      const req = os.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  } catch { /* swallow */ }
}
