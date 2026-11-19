/**
 * Document body persistence (IndexedDB).
 *
 * localStorage keeps preferences and small UI state; draft bodies live here so
 * long articles and many drafts do not hit the ~5 MB localStorage quota.
 * Falls back to the caller's localStorage path when IndexedDB is unavailable.
 */

const DOC_DB_NAME = 'dsh-wechat-studio-docs'
const DOC_STORE_NAME = 'state'
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
    try { request = indexedDB.open(DOC_DB_NAME, 1) } catch { resolve(null); return }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(DOC_STORE_NAME)) db.createObjectStore(DOC_STORE_NAME, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
  return docDbPromise
}

function withDocStore(mode, run) {
  return openDocDb().then(db => {
    if (db === null) return null
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(DOC_STORE_NAME, mode)
        const request = run(tx.objectStore(DOC_STORE_NAME))
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
