/**
 * Document body persistence (IndexedDB).
 *
 * localStorage keeps preferences and small UI state; draft bodies live here so
 * long articles and many drafts do not hit the ~5 MB localStorage quota.
 * Falls back to the caller's localStorage path when IndexedDB is unavailable.
 */

const DOC_DB_NAME = 'dsh-wechat-studio-docs'
const DOC_STORE_NAME = 'state'
const DOC_SNAPSHOT_STORE = 'snapshots'
const DOC_LEDGER_STORE = 'ledger'
const DOC_SNIPPET_STORE = 'snippets'
const DOC_ROW_ID = 'docs'

let docDbPromise
let docLoadingPromise

function hasDocIndexedDb() {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null
  } catch {
    return false
  }
}

function openDocDb() {
  if (docDbPromise !== undefined) return docDbPromise
  docDbPromise = new Promise((resolve) => {
    if (!hasDocIndexedDb()) { resolve(null); return }
    let request
    try { request = indexedDB.open(DOC_DB_NAME, 4) } catch { resolve(null); return }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(DOC_STORE_NAME)) db.createObjectStore(DOC_STORE_NAME, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(DOC_SNAPSHOT_STORE)) db.createObjectStore(DOC_SNAPSHOT_STORE, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(DOC_LEDGER_STORE)) db.createObjectStore(DOC_LEDGER_STORE, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(DOC_SNIPPET_STORE)) db.createObjectStore(DOC_SNIPPET_STORE, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
  return docDbPromise
}

function withDocStore(mode, run, storeName = DOC_STORE_NAME) {
  return openDocDb().then(db => {
    if (db === null) return null
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, mode)
        const request = run(tx.objectStore(storeName))
        let result = null
        if (request !== undefined && request !== null) {
          request.onsuccess = () => { result = request.result }
          request.onerror = () => { result = null }
        }
        tx.oncomplete = () => resolve(result)
        tx.onerror = () => resolve(result)
        tx.onabort = () => resolve(result)
      } catch {
        resolve(null)
      }
    })
  }).catch(() => null)
}

/** Load stored drafts; null when IndexedDB is unavailable or empty. */
export function loadDocsFromDb() {
  if (docLoadingPromise !== undefined) return docLoadingPromise
  docLoadingPromise = withDocStore('readonly', store => store.get(DOC_ROW_ID)).then(row => {
    if (row === null || row === undefined || !Array.isArray(row.items)) return null
    const items = row.items.filter(entry => entry && typeof entry.id === 'string' && typeof entry.text === 'string')
    return items.length === 0 ? null : items
  })
  return docLoadingPromise
}

/** Persist the full draft array as one record. */
export async function saveDocsToDb(items) {
  if (!Array.isArray(items)) return false
  const result = await withDocStore('readwrite', store => store.put({ id: DOC_ROW_ID, items, updatedAt: Date.now() }))
  return result !== null && result !== undefined
}

/** Remove the stored draft array (not used by normal flows). */
export async function clearDocsDb() {
  await withDocStore('readwrite', store => store.delete(DOC_ROW_ID))
}


/** Save one version snapshot for a document; keeps the newest 20 per doc. */
export async function saveSnapshot(snapshot) {
  if (snapshot === null || typeof snapshot !== 'object' || typeof snapshot.docId !== 'string') return false
  const entry = {
    id: `snap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    docId: snapshot.docId,
    createdAt: Date.now(),
    reason: typeof snapshot.reason === 'string' ? snapshot.reason : 'manual',
    text: typeof snapshot.text === 'string' ? snapshot.text : '',
    design: snapshot.design ?? {},
    meta: snapshot.meta ?? {},
  }
  const saved = await withDocStore('readwrite', store => store.put(entry), DOC_SNAPSHOT_STORE)
  if (saved === null || saved === undefined) return false
  const all = await withDocStore('readonly', store => store.getAll(), DOC_SNAPSHOT_STORE)
  if (Array.isArray(all)) {
    const mine = all.filter(item => item.docId === entry.docId).sort((a, b) => b.createdAt - a.createdAt)
    const stale = mine.slice(20)
    if (stale.length > 0) {
      await withDocStore('readwrite', store => {
        for (const item of stale) store.delete(item.id)
      }, DOC_SNAPSHOT_STORE)
    }
  }
  return true
}

/** List recent snapshots for one document, newest first. */
export async function listSnapshots(docId, limit = 8) {
  const all = await withDocStore('readonly', store => store.getAll(), DOC_SNAPSHOT_STORE)
  if (!Array.isArray(all)) return []
  return all
    .filter(item => item.docId === docId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
}

/** Delete all snapshots for one document. */
export async function clearSnapshots(docId) {
  const all = await withDocStore('readonly', store => store.getAll(), DOC_SNAPSHOT_STORE)
  if (!Array.isArray(all)) return
  await withDocStore('readwrite', store => {
    for (const item of all) if (item.docId === docId) store.delete(item.id)
  }, DOC_SNAPSHOT_STORE)
}


/** Append one publish-ledger event; keeps the newest 40 per document. */
export async function appendLedgerEvent(event) {
  if (event === null || typeof event !== 'object' || typeof event.docId !== 'string') return false
  const entry = {
    id: `ledger-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    docId: event.docId,
    type: typeof event.type === 'string' ? event.type : 'draft',
    at: Date.now(),
    title: typeof event.title === 'string' ? event.title : '',
    theme: typeof event.theme === 'string' ? event.theme : '',
    mediaId: typeof event.mediaId === 'string' ? event.mediaId : '',
    publishId: typeof event.publishId === 'string' ? event.publishId : '',
    status: typeof event.status === 'string' ? event.status : '',
    count: Number(event.count) || 0,
    text: typeof event.text === 'string' ? event.text : '',
    design: event.design ?? {},
    meta: event.meta ?? {},
  }
  const saved = await withDocStore('readwrite', store => store.put(entry), DOC_LEDGER_STORE)
  if (saved === null || saved === undefined) return false
  const all = await withDocStore('readonly', store => store.getAll(), DOC_LEDGER_STORE)
  if (Array.isArray(all)) {
    const mine = all.filter(item => item.docId === entry.docId).sort((a, b) => b.at - a.at)
    const stale = mine.slice(40)
    if (stale.length > 0) {
      await withDocStore('readwrite', store => {
        for (const item of stale) store.delete(item.id)
      }, DOC_LEDGER_STORE)
    }
  }
  return true
}

/** List recent ledger events for one document, newest first. */
export async function listLedgerEvents(docId, limit = 20) {
  const all = await withDocStore('readonly', store => store.getAll(), DOC_LEDGER_STORE)
  if (!Array.isArray(all)) return []
  return all.filter(item => item.docId === docId).sort((a, b) => b.at - a.at).slice(0, limit)
}


/** Save a reusable snippet. */
export async function saveSnippet(snippet) {
  if (snippet === null || typeof snippet !== 'object' || typeof snippet.name !== 'string' || typeof snippet.text !== 'string') return false
  const id = typeof snippet.id === 'string' && snippet.id !== '' ? snippet.id : `snippet-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const now = Date.now()
  const entry = { id, name: snippet.name.trim().slice(0, 60), text: snippet.text, createdAt: Number(snippet.createdAt) || now, updatedAt: now }
  const saved = await withDocStore('readwrite', store => store.put(entry), DOC_SNIPPET_STORE)
  return saved !== null && saved !== undefined
}

/** List saved snippets, newest first. */
export async function listSnippets() {
  const all = await withDocStore('readonly', store => store.getAll(), DOC_SNIPPET_STORE)
  if (!Array.isArray(all)) return []
  return all.sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Delete one snippet. */
export async function deleteSnippet(id) {
  const deleted = await withDocStore('readwrite', store => store.delete(id), DOC_SNIPPET_STORE)
  return deleted !== null
}
