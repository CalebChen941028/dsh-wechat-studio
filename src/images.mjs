/**
 * Image registry.
 *
 * Editor text keeps short `wsimg://id` references; the actual data URLs live in
 * IndexedDB. Before parsing/rendering/publishing the panel expands refs back to
 * data URLs, so the existing renderer and publish pipeline stay unchanged.
 *
 * If IndexedDB is unavailable (private mode, unusual embeds), callers fall back
 * to inline data URLs so the editor still works.
 */

const DB_NAME = 'dsh-wechat-studio-images'
const STORE_NAME = 'images'
const REF_PREFIX = 'wsimg://'
const REF_PATTERN = /wsimg:\/\/([a-zA-Z0-9_-]+)/g
const INLINE_IMAGE_PATTERN = /!\[([^\]]*)\]\((data:image\/[a-zA-Z+]+;base64,[^)\s]+)\)/g
const MAX_INLINE_IMAGES = 40

const cache = new Map()
let dbPromise
let loadingPromise

/** Check whether the environment can open IndexedDB. */
function hasIndexedDb() {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null
  } catch {
    return false
  }
}

/** Open (once) the registry database, or resolve null when unavailable. */
function openDb() {
  if (dbPromise !== undefined) return dbPromise
  dbPromise = new Promise((resolve) => {
    if (!hasIndexedDb()) {
      resolve(null)
      return
    }
    let request
    try {
      request = indexedDB.open(DB_NAME, 1)
    } catch {
      resolve(null)
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
  return dbPromise
}

/** Run one transaction and swallow storage errors (the cache still serves the session). */
async function withStore(mode, run) {
  const db = await openDb()
  if (db === null) return null
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, mode)
      const store = tx.objectStore(STORE_NAME)
      let result = null
      const request = run(store)
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
}

/** Load every stored image into the in-memory cache. */
export function loadImages() {
  if (loadingPromise !== undefined) return loadingPromise
  loadingPromise = (async () => {
    const rows = await withStore('readonly', store => store.getAll())
    if (!Array.isArray(rows)) return false
    for (const row of rows) {
      if (row !== null && typeof row === 'object' && typeof row.id === 'string' && typeof row.dataUrl === 'string') {
        cache.set(row.id, row)
      }
    }
    return true
  })()
  return loadingPromise
}

/** Number of images currently cached. */
export function imageCacheSize() {
  return cache.size
}

/** Generate one image id. */
function nextImageId() {
  return `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Store a data URL and return a short reference. Falls back to the original
 * data URL when IndexedDB cannot persist it.
 * @param {string} dataUrl image data URL.
 * @param {{ kind?: string }} [meta] optional metadata for debugging.
 * @returns {Promise<string>} `wsimg://id` or the original data URL.
 */
export async function materializeImage(dataUrl, meta = {}) {
  if (typeof dataUrl !== 'string' || !/^data:image\//.test(dataUrl)) return dataUrl
  const id = nextImageId()
  const row = {
    id,
    dataUrl,
    bytes: Math.floor((dataUrl.length * 3) / 4),
    kind: typeof meta.kind === 'string' ? meta.kind : 'content',
    createdAt: Date.now(),
  }
  cache.set(id, row)
  const saved = await withStore('readwrite', store => store.put(row))
  if (saved === null) {
    // Persistence failed (quota/private mode): keep the image inline.
    cache.delete(id)
    return dataUrl
  }
  return `${REF_PREFIX}${id}`
}

/** Replace every `wsimg://id` reference using a lookup function (pure helper for tests). */
export function expandImageRefsWith(text, lookup) {
  return String(text ?? '').replace(REF_PATTERN, (match, id) => {
    const value = typeof lookup === 'function' ? lookup(id) : undefined
    return typeof value === 'string' && value !== '' ? value : match
  })
}

/** Replace image refs with data URLs from the in-memory cache. */
export function expandImageRefs(text) {
  return expandImageRefsWith(text, id => cache.get(id)?.dataUrl)
}

/** Collect referenced image ids (pure helper for tests). */
export function collectImageRefIds(text) {
  const ids = new Set()
  for (const match of String(text ?? '').matchAll(REF_PATTERN)) ids.add(match[1])
  return [...ids]
}

/** True when some refs could not be resolved from the cache. */
export function hasUnresolvedImageRefs(text) {
  let unresolved = false
  for (const match of String(text ?? '').matchAll(REF_PATTERN)) {
    if (!cache.has(match[1])) unresolved = true
  }
  return unresolved
}

/** Extract inline Markdown data-URL images (pure helper). */
export function findInlineImageDataUrls(text) {
  const urls = []
  for (const match of String(text ?? '').matchAll(INLINE_IMAGE_PATTERN)) {
    if (!urls.includes(match[2])) urls.push(match[2])
  }
  return urls
}

/**
 * Move inline Markdown data-URL images into the registry and replace them with
 * short refs. Used for Word imports, pasted Markdown and draft JSON.
 * @param {string} text Markdown text.
 * @param {{ kind?: string }} [meta] optional metadata.
 * @returns {Promise<string>} Markdown with refs.
 */
export async function materializeInlineImages(text, meta = {}) {
  const source = String(text ?? '')
  const urls = findInlineImageDataUrls(source).slice(0, MAX_INLINE_IMAGES)
  if (urls.length === 0) return source
  const replacements = new Map()
  for (const url of urls) {
    replacements.set(url, await materializeImage(url, meta))
  }
  return source.replace(INLINE_IMAGE_PATTERN, (match, alt, dataUrl) => `![${alt}](${replacements.get(dataUrl) ?? dataUrl})`)
}

/**
 * Delete images not referenced by any draft text. Runs after drafts change so
 * deleted files do not keep IndexedDB space forever.
 * @param {string[]} texts current draft Markdown texts.
 * @returns {Promise<number>} number of removed images.
 */
export async function pruneImages(texts) {
  const referenced = new Set()
  for (const text of texts) for (const id of collectImageRefIds(text)) referenced.add(id)
  const stale = [...cache.keys()].filter(id => !referenced.has(id))
  if (stale.length === 0) return 0
  for (const id of stale) cache.delete(id)
  const db = await openDb()
  if (db !== null) {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      for (const id of stale) store.delete(id)
      await new Promise((resolve) => { tx.oncomplete = resolve; tx.onerror = resolve; tx.onabort = resolve })
    } catch {
      // Cache cleanup is enough for this session.
    }
  }
  return stale.length
}
