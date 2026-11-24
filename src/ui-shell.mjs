/**
 * The studio UI: three panes (copy, live WeChat preview, design controls),
 * local drafts, and the publish flow. Written against the slot framework's
 * plain-JavaScript surface: React.createElement only, inline styles for the
 * article, and theme tokens for the chrome.
 */

const PANEL_ID = 'wechat-studio'
const STORAGE_KEY = 'dsh.wechat-studio.docs.v1'
const ACTIVE_KEY = 'dsh.wechat-studio.active.v1'
const HELP_SEEN_KEY = 'dsh.wechat-studio.helpSeen.v1'
const DIAGNOSTICS_KEY = 'dsh.wechat-studio.errors.v1'
const APPEARANCE_KEY = 'dsh.wechat-studio.appearance.v1'
const LONG_TEXT_CHUNK_THRESHOLD = 7000
const DEVICE_KEY = 'dsh.wechat-studio.device.v1'
const SKINS = [
  { id: 'auto', name: t('跟随应用'), hint: t('自动适配深浅') },
  { id: 'light', name: t('浅色玻璃'), hint: t('明亮通透') },
  { id: 'dark', name: t('深色玻璃'), hint: t('低光环境') },
  { id: 'sand', name: t('暖砂'), hint: t('米色柔光') },
]
const UI_ACCENTS = ['#0A84FF', '#3A3A3C', '#0E7C86', '#A2653B', '#B23A3A', '#6E6E73']
const BG_CHOICES = [['', t('跟随版式')], ['#FFFFFF', t('纸白')], ['#F7F4EE', t('米色')], ['#F3F4F6', t('冷灰')], ['#161616', t('墨黑')]]
const BG_PATTERNS = [['none', t('无底纹')], ['paper', t('纸纹')], ['grid', t('网格')], ['dots', t('点阵')], ['lines', t('竖线')], ['wash', t('淡彩')], ['watercolor', t('水彩')], ['halftone', t('网点')]]
const ORNAMENTS = [['none', t('不加角标')], ['corner', t('边角线')], ['column', t('栏线')], ['seal', t('印记')], ['leaf', t('叶形')], ['sprig', t('枝叶')], ['star', t('星标')]]

/** Parse a CSS color and report whether it is dark. */
function cssColorIsDark(value) {
  const text = String(value ?? '')
  const match = text.match(/(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/)
  if (match === null) return false
  const r = Number(match[1]); const g = Number(match[2]); const b = Number(match[3])
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return false
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5
}

/** Read the host theme from the Document, so the auto skin can match it. */
function detectHostDark() {
  try {
    const root = document.documentElement
    const styles = window.getComputedStyle(root)
    const base = styles.getPropertyValue('--dsw-alias-bg-base').trim()
    if (base !== '') return cssColorIsDark(base)
    const label = styles.getPropertyValue('--dsw-alias-label-primary').trim()
    if (label !== '') return !cssColorIsDark(label)
  } catch {
    // Fall through to the system preference.
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches === true
}

/** Track host theme changes without remounting the panel. */
function useHostDark() {
  const [dark, setDark] = React.useState(detectHostDark)
  React.useEffect(() => {
    const update = () => setDark(detectHostDark())
    update()
    const targets = [document.documentElement, document.body].filter(Boolean)
    const observer = new MutationObserver(update)
    for (const target of targets) observer.observe(target, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    media?.addEventListener?.('change', update)
    return () => {
      observer.disconnect()
      media?.removeEventListener?.('change', update)
    }
  }, [])
  return dark
}

/** Read the saved workbench skin and accent, ignoring malformed values. */
function loadAppearance() {
  try {
    const raw = localStorage.getItem(APPEARANCE_KEY)
    if (raw !== null) {
      const saved = JSON.parse(raw)
      const skin = SKINS.some(entry => entry.id === saved?.skin) ? saved.skin : 'auto'
      const accent = typeof saved?.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(saved.accent) ? saved.accent : UI_ACCENTS[0]
      return { skin, accent }
    }
  } catch {
    // Ignore a corrupt preference.
  }
  return { skin: 'auto', accent: UI_ACCENTS[0] }
}

const ACCENT_SWATCHES = [
  '#18191B', '#1F5FA8', '#2E7D5B', '#149E8C', '#C8342C', '#D97B29',
  '#C2606F', '#6B4E9B', '#C9A227', '#A8763E', '#44546A', '#A63A6B',
]

const SAMPLE_ARTICLE = `# 我为什么又开始自己排版

> 复制粘贴一次，样式全丢。第三次之后，我决定自己写一个排版器。

## 先说结论

公众号编辑器只认内联样式。你从网页复制过来的 style 标签、class 名，它一律丢掉。这不是 bug，是从一开始就定下的规则。

我试过三种省事的办法，都不太灵：

- 用第三方排版工具：好看，但模板都长一个样
- 直接粘 Markdown：干净，但代码块和引用会散架
- 手写 style 属性：能对齐，但改一次颜色要改十几处

## 现在我怎么做

先把稿子写成 Markdown，再让工具把它翻译成内联样式。标题、引用、列表、配图各有一套固定的处理方式，改版式只需要重做一套配色与层级。

> 排版的目的不是好看，是让读者别分心。

### 三个小习惯

1. 每段不超过四行，手机屏幕上不出现文字墙
2. 小节标题带序号，读者知道自己走到哪了
3. 引用只留一句，多了就变成第二个正文

---

写到这里，样式应该已经套好了。你可以让 AI 重新设计，也可以只调字号和行距。改完复制，粘回公众号编辑器。`

const SAMPLE_TEXT_FALLBACK = SAMPLE_ARTICLE

/* ------------------------------------------------------------------ *
 * Small utilities
 * ------------------------------------------------------------------ */

function formatDate(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now())
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function docId() {
  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function createDocument(seedText, design, meta) {
  const text = typeof seedText === 'string' ? seedText : SAMPLE_TEXT_FALLBACK
  const parsed = parseArticle(text)
  const composed = design ?? autoCompose(parsed.blocks, text, 0).design
  return {
    id: docId(),
    text,
    design: composed,
    meta: { title: '', author: '', digest: '', sourceUrl: '', brand: '', coverDataUrl: '', coverLayout: 'left', draftMediaId: '', draftArticleCount: 0, aiHashes: [], lockedHashes: [], styleGuide: DEFAULT_STYLE_GUIDE, plannedAt: '', needOpenComment: false, onlyFansCanComment: false, ...(meta ?? {}) },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw !== null) {
      const parsed = JSON.parse(raw)
      if (parsed && Array.isArray(parsed.docs) && parsed.docs.length > 0) {
        const docs = parsed.docs.filter(entry => entry && typeof entry.text === 'string')
        if (docs.length > 0) {
          const remembered = localStorage.getItem(ACTIVE_KEY)
          const preferred = remembered ?? parsed.activeId
          const activeId = docs.some(entry => entry.id === preferred) ? preferred : docs[0].id
          return { docs, activeId }
        }
      }
    }
  } catch {
    // A corrupt store must not block the panel; fall through to a fresh sample.
  }
  const sample = createDocument(undefined, undefined, { sample: true })
  return { docs: [sample], activeId: sample.id }
}

function useElementWidth(ref) {
  const [width, setWidth] = React.useState(0)
  React.useEffect(() => {
    const element = ref.current
    if (!element) return undefined
    setWidth(element.clientWidth)
    if (typeof ResizeObserver !== 'function') {
      const onResize = () => setWidth(element.clientWidth)
      window.addEventListener('resize', onResize)
      return () => window.removeEventListener('resize', onResize)
    }
    const observer = new ResizeObserver(entries => {
      const entry = entries[0]
      if (entry) setWidth(Math.round(entry.contentRect.width))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return width
}

/* ------------------------------------------------------------------ *
 * Document store (drafts + undo/redo + persistence)
 * ------------------------------------------------------------------ */

/** Persist only durable fields: generated covers are rebuilt from the theme. */
function serializeDocs(docs) {
  return docs.map(entry => {
    if (entry?.meta?.coverCustom === true) return entry
    if (typeof entry?.meta?.coverDataUrl === 'string' && entry.meta.coverDataUrl !== '') {
      return { ...entry, meta: { ...entry.meta, coverDataUrl: '' } }
    }
    return entry
  })
}

function useDocumentStore() {
  const initialRef = React.useRef(null)
  if (initialRef.current === null) initialRef.current = loadStore()
  const [docs, setDocs] = React.useState(initialRef.current.docs)
  const [activeId, setActiveId] = React.useState(initialRef.current.activeId)
  const [past, setPast] = React.useState([])
  const [future, setFuture] = React.useState([])
  const [persistError, setPersistError] = React.useState(false)
  const [hydrated, setHydrated] = React.useState(false)
  const [storageMode, setStorageMode] = React.useState('local')
  const [remoteNotice, setRemoteNotice] = React.useState(null)
  const channelRef = React.useRef(null)
  const tabIdRef = React.useRef(`tab-${Math.random().toString(36).slice(2, 9)}`)
  const docsRef = React.useRef(docs)
  docsRef.current = docs
  const lastPushRef = React.useRef({ key: '', at: 0 })

  const doc = React.useMemo(
    () => docs.find(entry => entry.id === activeId) ?? docs[0],
    [docs, activeId],
  )
  const docRef = React.useRef(doc)
  docRef.current = doc
  const pastRef = React.useRef(past)
  pastRef.current = past

  React.useEffect(() => {
    let cancelled = false
    const initial = initialRef.current
    loadDocsFromDb().then((stored) => {
      if (cancelled) return
      if (Array.isArray(stored) && stored.length > 0) {
        setDocs(stored)
        let remembered = ''
        try { remembered = localStorage.getItem(ACTIVE_KEY) ?? '' } catch { remembered = '' }
        setActiveId((current) => (
          stored.some(entry => entry.id === current) ? current
            : stored.some(entry => entry.id === remembered) ? remembered
              : stored[0].id
        ))
        setStorageMode('idb')
        setHydrated(true)
        return
      }
      saveDocsToDb(serializeDocs(initial.docs)).then((saved) => {
        if (cancelled) return
        setStorageMode(saved ? 'idb' : 'local')
        setHydrated(true)
        if (saved) {
          try { localStorage.removeItem(STORAGE_KEY) } catch { /* private mode */ }
        }
      }).catch(() => {
        if (!cancelled) { setStorageMode('local'); setHydrated(true) }
      })
    }).catch(() => {
      if (!cancelled) { setStorageMode('local'); setHydrated(true) }
    })
    return () => { cancelled = true }
  }, [])

  React.useEffect(() => {
    if (!hydrated) return undefined
    const timer = setTimeout(() => {
      const cleaned = serializeDocs(docs)
      if (storageMode === 'idb') {
        saveDocsToDb(cleaned).then((saved) => {
          if (!saved) {
            setPersistError(true)
            setStorageMode('local')
            return
          }
          setPersistError(false)
          try {
            localStorage.setItem(ACTIVE_KEY, activeId)
            localStorage.removeItem(STORAGE_KEY)
          } catch { /* private mode */ }
        }).catch(() => {
          setPersistError(true)
          setStorageMode('local')
        })
        return
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ docs: cleaned, activeId }))
        localStorage.setItem(ACTIVE_KEY, activeId)
        setPersistError(false)
      } catch {
        // Quota or privacy mode: the panel keeps working in memory, and the
        // header shows a warning so the draft is not lost silently.
        setPersistError(true)
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [docs, activeId, hydrated, storageMode])

  React.useEffect(() => {
    if (typeof BroadcastChannel !== 'function') return undefined
    const channel = new BroadcastChannel('dsh.wechat-studio.docs.v1')
    channelRef.current = channel
    channel.onmessage = (event) => {
      const data = event.data
      if (!data || data.type !== 'docs' || data.sourceId === tabIdRef.current || !Array.isArray(data.docs)) return
      const local = new Map(docsRef.current.map(entry => [entry.id, entry]))
      const newer = data.docs.some(entry => {
        const current = local.get(entry.id)
        return current === undefined || (Number(entry.updatedAt) || 0) > (Number(current.updatedAt) || 0)
      })
      if (newer) setRemoteNotice({ docs: data.docs, activeId: data.activeId })
    }
    return () => { channel.close(); channelRef.current = null }
  }, [])

  React.useEffect(() => {
    if (!hydrated || channelRef.current === null) return undefined
    const timer = setTimeout(() => {
      try {
        channelRef.current?.postMessage({ type: 'docs', docs: serializeDocs(docs), activeId, sourceId: tabIdRef.current })
      } catch { /* oversized or closed */ }
    }, 900)
    return () => clearTimeout(timer)
  }, [docs, activeId, hydrated])

  const acceptRemote = React.useCallback(() => {
    const notice = remoteNotice
    if (!notice) return
    setDocs(notice.docs)
    if (notice.docs.some(entry => entry.id === notice.activeId)) setActiveId(notice.activeId)
    setRemoteNotice(null)
  }, [remoteNotice])

  const updateDoc = React.useCallback((updater, options = {}) => {
    const current = docRef.current
    if (!current) return
    const next = typeof updater === 'function' ? updater(current) : updater
    if (next === undefined || next === null || next === current) return
    const now = Date.now()
    const coalesce = options.coalesce
    const shouldPush = options.history !== false
      && (coalesce === undefined || lastPushRef.current.key !== coalesce || now - lastPushRef.current.at > 900)
    if (shouldPush) {
      lastPushRef.current = { key: coalesce ?? '', at: now }
      setPast(stack => [...stack, current].slice(-60))
      setFuture([])
    }
    setDocs(list => list.map(entry => (entry.id === current.id ? { ...next, updatedAt: now } : entry)))
  }, [])

  const updateDesign = React.useCallback((mutator) => {
    updateDoc(current => ({ ...current, design: mutator(current.design) }), { coalesce: 'design' })
  }, [updateDoc])

  const updateMeta = React.useCallback((patch) => {
    updateDoc(current => ({ ...current, meta: { ...current.meta, ...patch } }), { coalesce: 'meta' })
  }, [updateDoc])

  const undo = React.useCallback(() => {
    const stack = pastRef.current
    if (stack.length === 0) return
    const previous = stack[stack.length - 1]
    const current = docRef.current
    setPast(list => list.slice(0, -1))
    setFuture(list => [current, ...list].slice(0, 60))
    setDocs(list => list.map(entry => (entry.id === current.id ? previous : entry)))
  }, [])

  const futureRef = React.useRef(future)
  futureRef.current = future
  const redo = React.useCallback(() => {
    const stack = futureRef.current
    if (stack.length === 0) return
    const next = stack[0]
    const current = docRef.current
    setFuture(list => list.slice(1))
    setPast(list => [...list, current].slice(-60))
    setDocs(list => list.map(entry => (entry.id === current.id ? next : entry)))
  }, [])

  const selectDoc = React.useCallback((id) => {
    setActiveId(id)
    setPast([])
    setFuture([])
  }, [])

  const addDoc = React.useCallback((text, design, meta) => {
    const created = createDocument(text, design, meta)
    setDocs(list => [created, ...list])
    setActiveId(created.id)
    setPast([])
    setFuture([])
    return created
  }, [])

  const removeDoc = React.useCallback((id) => {
    setDocs(list => {
      const remaining = list.filter(entry => entry.id !== id)
      if (remaining.length === 0) {
        const fresh = createDocument('')
        setActiveId(fresh.id)
        return [fresh]
      }
      if (id === activeId) setActiveId(remaining[0].id)
      return remaining
    })
    setPast([])
    setFuture([])
  }, [activeId])

  return {
    docs, doc, activeId, updateDoc, updateDesign, updateMeta,
    undo, redo, canUndo: past.length > 0, canRedo: future.length > 0, persistError,
    remoteNotice, acceptRemote, dismissRemote: () => setRemoteNotice(null),
    historyTexts: () => [...pastRef.current, ...futureRef.current].map(entry => entry.text),
    selectDoc, addDoc, removeDoc,
    getDoc: () => docRef.current,
  }
}

/* ------------------------------------------------------------------ *
 * Root panel
 * ------------------------------------------------------------------ */

function StudioPanel(props) {
  const store = useDocumentStore()
  const { doc } = store
  const rootRef = React.useRef(null)
  const width = useElementWidth(rootRef)
  // The panel lives in a resizable column, so its own width, not the window's,
  // decides how many panes fit: three, two with a drawer, or one at a time.
  const narrow = width > 0 && width < 860
  const compact = width > 0 && width < 1200
  const [narrowView, setNarrowView] = React.useState('preview')
  const [rightOpen, setRightOpen] = React.useState(true)
  const sizedRef = React.useRef(false)
  React.useEffect(() => {
    if (sizedRef.current || width <= 0) return
    sizedRef.current = true
    setRightOpen(width >= 1200)
  }, [width])
  const [tab, setTab] = React.useState('theme')
  const [selectedBlock, setSelectedBlock] = React.useState(null)
  const [toasts, setToasts] = React.useState([])
  const [hostStatus, setHostStatus] = React.useState({ phase: 'loading', configured: false, appIdPreview: null, message: '' })
  const [imageReady, setImageReady] = React.useState(false)
  const [imageVersion, setImageVersion] = React.useState(0)
  const [snapshotVersion, setSnapshotVersion] = React.useState(0)
  const [helpOpen, setHelpOpen] = React.useState(() => { try { return localStorage.getItem(HELP_SEEN_KEY) !== '1' } catch { return false } })
  const [snippetsOpen, setSnippetsOpen] = React.useState(false)
  const [imagesOpen, setImagesOpen] = React.useState(false)
  const [paletteOpen, setPaletteOpen] = React.useState(false)
  const [diagnosticsOpen, setDiagnosticsOpen] = React.useState(false)
  const [helpFirstRun, setHelpFirstRun] = React.useState(() => { try { return localStorage.getItem(HELP_SEEN_KEY) !== '1' } catch { return false } })
  React.useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen(value => !value)
      }
      if (event.key === 'Escape') {
        setPaletteOpen(false)
        setSnippetsOpen(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  React.useEffect(() => {
    const onError = (event) => recordDiagnostic(event.error ?? event.message, 'window')
    const onRejection = (event) => recordDiagnostic(event.reason, 'promise')
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])
  const bumpImages = React.useCallback(() => setImageVersion(value => value + 1), [])
  React.useEffect(() => {
    let cancelled = false
    loadImages().then(() => {
      if (cancelled) return
      setImageReady(true)
      setImageVersion(value => value + 1)
    })
    return () => { cancelled = true }
  }, [])
  React.useEffect(() => {
    if (!imageReady) return undefined
    // Orphaned images should not occupy IndexedDB forever.
    const timer = setTimeout(() => { pruneImages([...store.docs.map(entry => entry.text), ...store.historyTexts()]) }, 3000)
    return () => clearTimeout(timer)
  }, [store.docs, imageReady])
  const [appearance, setAppearance] = React.useState(loadAppearance)
  const [device, setDevice] = React.useState(() => {
    try { return localStorage.getItem(DEVICE_KEY) === 'android' ? 'android' : 'iphone' } catch { return 'iphone' }
  })
  React.useEffect(() => {
    try { localStorage.setItem(DEVICE_KEY, device) } catch { /* private mode */ }
  }, [device])
  const hostDark = useHostDark()
  React.useEffect(() => {
    try {
      localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance))
    } catch {
      // Private mode: the choice just won't survive a reload.
    }
  }, [appearance])
  const textareaRef = React.useRef(null)
  const toastSeq = React.useRef(0)
  const autoTimerRef = React.useRef(undefined)

  React.useEffect(() => () => {
    clearTimeout(autoTimerRef.current)
  }, [])

  const toast = React.useCallback((message, kind = 'info') => {
    toastSeq.current += 1
    const id = toastSeq.current
    setToasts(list => [...list, { id, message, kind }])
    setTimeout(() => setToasts(list => list.filter(entry => entry.id !== id)), kind === 'error' ? 6000 : 3800)
  }, [])
  const persistWarnedRef = React.useRef(false)
  React.useEffect(() => {
    if (!store.persistError) {
      persistWarnedRef.current = false
      return
    }
    if (persistWarnedRef.current) return
    persistWarnedRef.current = true
    toast(t('浏览器存储写入失败，这轮修改只保存在内存里，刷新会丢失。请导出草稿 JSON，或删掉带大图的草稿。'), 'error')
  }, [store.persistError, toast])


  // Host capability probe. A failure is a normal state here: the panel still
  // renders and copies HTML, only publishing stays disabled.
  React.useEffect(() => {
    let cancelled = false
    callHost('status')
      .then(value => {
        if (cancelled) return
        setHostStatus({ phase: 'ready', configured: value.configured === true, appIdPreview: value.appIdPreview ?? null, message: '' })
      })
      .catch(error => {
        if (cancelled) return
        setHostStatus({ phase: 'error', configured: false, appIdPreview: null, message: error.message })
      })
    return () => { cancelled = true }
  }, [])

  // Keep typing responsive on long articles: the preview catches up through a
  // deferred value while the editor itself updates immediately.
  const deferredText = React.useDeferredValue(doc.text)
  const renderText = React.useMemo(() => expandImageRefs(deferredText), [deferredText, imageVersion])
  // Counting/ranking must not count base64 payloads as article characters.
  const measureText = React.useMemo(() => deferredText.replace(/data:image\/[a-zA-Z+]+;base64,[^)\s]+/g, ''), [deferredText])
  const parsed = React.useMemo(() => parseArticle(renderText), [renderText])
  const design = React.useMemo(() => composeDesign(doc.design), [doc.design])
  const features = React.useMemo(() => measure(parsed.blocks, measureText), [parsed.blocks, measureText])
  const analysis = React.useMemo(() => autoCompose(parsed.blocks, measureText, 0).analysis, [parsed.blocks, measureText])
  const date = formatDate(doc.updatedAt)
  const meta = {
    title: doc.meta.title.trim(),
    author: doc.meta.author.trim(),
    date,
    readingMinutes: features.readingMinutes,
  }
  const article = React.useMemo(
    () => buildArticle({ blocks: parsed.blocks, design, meta }),
    [parsed.blocks, design, meta.author, meta.title, date, features.readingMinutes],
  )

  const scrollEditorToBlock = React.useCallback((index, shouldFocus) => {
    const block = parsed.blocks.filter(entry => entry.type !== 'title')[index]
    const element = textareaRef.current
    if (block === undefined || element === null) return
    const lines = doc.text.split('\n')
    const firstLine = block.lines?.[0] ?? 0
    const lastLine = block.lines?.[1] ?? firstLine
    const start = lines.slice(0, firstLine).join('\n').length + (firstLine > 0 ? 1 : 0)
    const end = lines.slice(0, lastLine + 1).join('\n').length
    requestAnimationFrame(() => {
      try {
        if (shouldFocus) {
          element.focus({ preventScroll: true })
          element.setSelectionRange(start, end)
        }
        const lineHeight = parseFloat(window.getComputedStyle(element).lineHeight) || 22
        element.scrollTop = Math.max(0, firstLine * lineHeight - element.clientHeight / 3)
      } catch {
        // Editor may be unmounted in narrow view.
      }
    })
  }, [parsed.blocks, doc.text])

  const takeSnapshot = React.useCallback(async (reason = 'manual', announce = false) => {
    const current = store.getDoc()
    if (!current) return false
    const clean = serializeDocs([current])[0]
    const saved = await saveSnapshot({
      docId: current.id,
      text: clean.text,
      design: clean.design,
      meta: clean.meta,
      reason,
    })
    if (saved) setSnapshotVersion(value => value + 1)
    if (announce) toast(saved ? t('已保存快照') : t('快照保存失败'), saved ? 'success' : 'error')
    return saved
  }, [store, toast])

  const goToBlock = React.useCallback((index) => {
    setSelectedBlock(index)
    scrollEditorToBlock(index, true)
  }, [scrollEditorToBlock])

  const syncBlockFromCaret = React.useCallback((event) => {
    const element = event.currentTarget
    const line = element.value.slice(0, element.selectionStart).split('\n').length - 1
    const blocks = parsed.blocks.filter(entry => entry.type !== 'title')
    let found = -1
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index]
      const first = block.lines?.[0] ?? -1
      const last = block.lines?.[1] ?? first
      if (first <= line && line <= last) { found = index; break }
      if (first <= line) found = index
    }
    setSelectedBlock(found >= 0 ? found : null)
  }, [parsed.blocks])

  const copyArticle = async () => {
    if (doc.text.trim() === '') {
      toast('编辑区还是空的，先写点内容再复制', 'error')
      return
    }
    if (hasUnresolvedImageRefs(doc.text)) {
      toast('正文图片还在从本地图库读取，等一秒再复制。', 'error')
      return
    }
    const tree = buildArticle({ blocks: parsed.blocks, design, meta })
    const html = serializeNodes(tree.nodes)
    try {
      const mode = await copyRichHtml(html)
      toast(mode === 'rich' ? t('已复制带样式的正文，粘到公众号编辑器即可') : t('已复制，样式可能不完整'), 'success')
    } catch (error) {
      toast(error.message || t('复制失败'), 'error')
    }
  }

  const composeFromCurrent = React.useCallback((announce) => {
    const current = store.getDoc()
    if (!current || current.text.trim().length < 40) return null
    if (current.design?.custom !== undefined && current.design?.custom !== null) return current.design
    const parsedNow = parseArticle(current.text)
    if (parsedNow.blocks.length === 0) return null
    const designNow = autoCompose(parsedNow.blocks, current.text, 0).design
    store.updateDoc(entry => ({ ...entry, design: designNow }))
    if (announce) {
      toast('已生成中性基础版式，可让 AI 继续设计')
    }
    return designNow
  }, [store, toast])

  /** Debounce the local baseline so typing never waits on the model. */
  const scheduleAutoCompose = React.useCallback((announce) => {
    clearTimeout(autoTimerRef.current)
    autoTimerRef.current = setTimeout(() => {
      composeFromCurrent(announce)
    }, 60)
  }, [composeFromCurrent])

  const importDocument = React.useCallback(async (file) => {
    if (!file) return
    try {
      const { text, images } = await readDocumentFile(file)
      const shrunk = await shrinkMarkdownImages(String(text ?? ''))
      const body = (await materializeInlineImages(shrunk, { kind: 'import' })).trim()
      bumpImages()
      if (body.length < 20) throw new Error(t('这份文档里没有可用的正文'))
      const parsedNow = parseArticle(body)
      const designNow = autoCompose(parsedNow.blocks, body, 0).design
      store.addDoc(body, designNow)
      if (narrow) setNarrowView('preview')
      const imageNote = typeof images === 'number' && images > 0 ? t('，含 {count} 张插图', { count: images }) : ''
      toast(`已导入「${parsedNow.title || file.name}」，先使用基础版式${imageNote}`, 'success')
    } catch (error) {
      toast(error.message || t('导入失败'), 'error')
    }
  }, [store, narrow, toast, bumpImages])

  const openDesign = (nextTab) => {
    setTab(nextTab)
    if (narrow) setNarrowView('design')
    else setRightOpen(true)
  }
  const closeHelp = () => {
    setHelpOpen(false)
    try { localStorage.setItem(HELP_SEEN_KEY, '1') } catch { /* private mode */ }
  }

  const closeDesign = () => {
    if (narrow) setNarrowView('preview')
    else setRightOpen(false)
  }

  const paletteCommands = [
    { id: 'design', label: t('打开 AI 设计'), hint: t('在对话里让 AI 直接设计版式'), run: () => openDesign('ai') },
    { id: 'copy', label: t('复制 HTML'), hint: t('复制带内联样式的正文'), run: copyArticle },
    { id: 'theme', label: t('打开设计面板'), hint: t('配色、字号、底纹、版式 DNA'), run: () => openDesign('theme') },
    { id: 'publish', label: t('打开发布面板'), hint: t('草稿、对账单、发布检查'), run: () => openDesign('publish') },
    { id: 'ai', label: t('打开 AI 修改'), hint: t('对话修改正文或版式'), run: () => openDesign('ai') },
    { id: 'snapshot', label: t('保存版本快照'), hint: t('当前正文存入历史版本'), run: () => takeSnapshot('manual', true) },
    { id: 'new', label: t('新建草稿'), hint: t('从空白开始'), run: () => { store.addDoc(''); setSelectedBlock(null); toast(t('已新建草稿')) } },
    { id: 'snippets', label: t('打开片段库'), hint: t('插入作者简介、引导等常用块'), run: () => setSnippetsOpen(true) },
    { id: 'images', label: t('打开素材库'), hint: t('复用已上传的图片'), run: () => setImagesOpen(true) },
    { id: 'help', label: t('使用提示与快捷键'), hint: t('查看隐藏操作'), run: () => setHelpOpen(true) },
    { id: 'diagnostics', label: t('诊断报告'), hint: t('存储用量与最近错误'), run: () => setDiagnosticsOpen(true) },
    ...store.docs.map(entry => ({
      id: `doc-${entry.id}`,
      label: `${t('切换草稿')}：${entry.meta.title.trim() || parseArticle(entry.text).title || t('未命名草稿')}`,
      hint: t('当前窗口载入这篇草稿'),
      run: () => { store.selectDoc(entry.id); setSelectedBlock(null) },
    })),
  ]

  const rootClassNames = [
    'ws-root',
    narrow ? 'ws-narrow' : compact ? 'ws-compact' : 'ws-wide',
    narrow ? `ws-view-${narrowView}` : '',
    rightOpen ? 'ws-right-open' : 'ws-right-closed',
  ].filter(Boolean).join(' ')

  const accentInk = readableOn(appearance.accent)
  return h('div', {
    className: rootClassNames,
    ref: rootRef,
    'data-skin': appearance.skin,
    'data-dark': hostDark ? 'true' : 'false',
    style: { '--ws-accent': appearance.accent, '--ws-accent-ink': accentInk },
  },
    h('style', { dangerouslySetInnerHTML: { __html: STUDIO_CSS } }),
    h(TopBar, {
      store, design, features, narrow, compact, narrowView, setNarrowView, rightOpen, setRightOpen,
      onCopy: copyArticle, onOpenDesign: openDesign,
      onImportDocument: importDocument, toast, appearance, setAppearance, onHelp: () => { setHelpFirstRun(false); setHelpOpen(true) },
    }),
    store.remoteNotice
      ? h('div', { className: 'ws-remote-banner' },
        h('span', null, t('另一个窗口更新了草稿；直接覆盖会丢掉这边的修改。')),
        h('button', { type: 'button', className: 'ws-link', onClick: store.acceptRemote }, t('载入另一窗口版本')),
        h('button', { type: 'button', className: 'ws-link', onClick: store.dismissRemote }, t('继续用当前版本')),
      )
      : null,
    h('div', { className: 'ws-body' },
      h(DocRail, {
        store, parsed, features, textareaRef, toast, narrow, selectedBlock, setSelectedBlock,
        onGoToBlock: goToBlock, onEditorCaret: syncBlockFromCaret, onOpenSnippets: () => setSnippetsOpen(true), onOpenImages: () => setImagesOpen(true),
        onImportDocument: importDocument, onContentPasted: () => scheduleAutoCompose(true),
        onImagesChanged: bumpImages,
        onOpenAi: () => openDesign('ai'),
      }),
      h(PreviewStage, {
        article, design, doc, parsed, features, selectedBlock, setSelectedBlock, store, toast, narrow, date, onImagesChanged: bumpImages, device, setDevice,
      }),
      compact && !narrow && rightOpen ? h('div', { className: 'ws-scrim', onClick: () => setRightOpen(false) }) : null,
      h(DesignPanel, {
        store, design, doc, analysis, features, hostStatus, setHostStatus, tab, setTab, toast, parsed, article, selectedBlock,
        narrow, compact, showClose: narrow || compact, onClose: closeDesign,
        takeSnapshot, snapshotVersion,
      }),
    ),
    paletteOpen ? h(CommandPalette, { commands: paletteCommands, onClose: () => setPaletteOpen(false) }) : null,
    snippetsOpen ? h(SnippetDialog, { store, toast, textareaRef, onClose: () => setSnippetsOpen(false) }) : null,
    imagesOpen ? h(ImageLibraryDialog, { store, toast, textareaRef, onClose: () => setImagesOpen(false) }) : null,
    helpOpen ? h(HelpDialog, { firstRun: helpFirstRun, onClose: closeHelp, onDiagnostics: () => { setHelpOpen(false); setDiagnosticsOpen(true) } }) : null,
    diagnosticsOpen ? h(DiagnosticsDialog, { onClose: () => setDiagnosticsOpen(false) }) : null,
    h(ToastStack, { toasts }),
  )
}

function recordDiagnostic(error, source = 'runtime') {
  try {
    const items = JSON.parse(localStorage.getItem(DIAGNOSTICS_KEY) ?? '[]')
    const list = Array.isArray(items) ? items : []
    list.unshift({
      at: new Date().toISOString(),
      source,
      message: error?.message ?? String(error),
      stack: typeof error?.stack === 'string' ? error.stack.slice(0, 4000) : '',
    })
    localStorage.setItem(DIAGNOSTICS_KEY, JSON.stringify(list.slice(0, 20)))
  } catch { /* storage unavailable */ }
}

function readDiagnostics() {
  try {
    const items = JSON.parse(localStorage.getItem(DIAGNOSTICS_KEY) ?? '[]')
    return Array.isArray(items) ? items : []
  } catch {
    return []
  }
}

let ErrorBoundaryClass = null
function getErrorBoundaryClass() {
  if (ErrorBoundaryClass !== null) return ErrorBoundaryClass
  ErrorBoundaryClass = class StudioErrorBoundary extends React.Component {
    constructor(props) {
      super(props)
      this.state = { error: null }
    }
    static getDerivedStateFromError(error) { return { error } }
    componentDidCatch(error) { recordDiagnostic(error, 'render') }
    render() {
      if (this.state.error === null) return this.props.children
      return h('div', { className: 'ws-root ws-crash', style: { padding: 24, fontFamily: 'system-ui', color: 'inherit' } },
        h('h2', { style: { fontSize: 16, margin: '0 0 8px' } }, t('编辑器遇到错误')),
        h('p', { style: { fontSize: 12, opacity: 0.7, lineHeight: 1.6 } }, t('这一轮修改还在浏览器存储里。先刷新页面；如果反复出现，打开诊断报告看看最近的错误。')),
        h('div', { style: { display: 'flex', gap: 8, marginTop: 12 } },
          h('button', { type: 'button', className: 'ws-btn primary', onClick: () => location.reload() }, t('刷新页面')),
          h('button', { type: 'button', className: 'ws-btn', onClick: () => { try { localStorage.removeItem(DIAGNOSTICS_KEY) } catch { /* ignore */ } location.reload() } }, t('清除错误并刷新')),
        ),
      )
    }
  }
  return ErrorBoundaryClass
}


function StudioShell(props) {
  return h(getErrorBoundaryClass(), null, h(StudioPanel, props))
}

function DiagnosticsDialog({ onClose }) {
  const [errors, setErrors] = React.useState(() => readDiagnostics())
  const [storage, setStorage] = React.useState(null)
  React.useEffect(() => {
    let cancelled = false
    if (navigator?.storage?.estimate) {
      navigator.storage.estimate().then(value => { if (!cancelled) setStorage(value) }).catch(() => {})
    }
    return () => { cancelled = true }
  }, [])
  const clear = () => {
    try { localStorage.removeItem(DIAGNOSTICS_KEY) } catch { /* ignore */ }
    setErrors([])
  }
  const copy = async () => {
    const report = JSON.stringify({ generatedAt: new Date().toISOString(), storage, errors }, null, 2)
    try { await navigator.clipboard.writeText(report) } catch { /* clipboard may be blocked */ }
    onClose()
  }
  const mb = (bytes) => typeof bytes === 'number' ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : '—'
  return h('div', { className: 'ws-modal-scrim', onClick: event => { if (event.target === event.currentTarget) onClose() } },
    h('div', { className: 'ws-modal', role: 'dialog', 'aria-modal': 'true' },
      h('div', { className: 'ws-modal-head' },
        h(Icon, { name: 'help', size: 16 }),
        h('strong', null, t('诊断报告')),
        h(IconButton, { icon: 'close', title: t('关闭'), onClick: onClose }),
      ),
      h('div', { className: 'ws-help-section' },
        h('h4', null, t('浏览器存储')),
        h('p', { className: 'ws-hint' }, storage === null ? t('暂时无法读取存储用量') : t('已用 {used} / 配额 {quota}', { used: mb(storage.usage), quota: mb(storage.quota) })),
      ),
      h('div', { className: 'ws-help-section' },
        h('h4', null, t('最近错误')),
        errors.length === 0
          ? h('p', { className: 'ws-hint' }, t('最近没有记录到错误。'))
          : errors.slice(0, 6).map((item, index) => h('div', { key: index, className: 'ws-help-row' },
            h('span', { className: 'ws-help-key' }, item.at.slice(11, 19)),
            h('span', null, `${item.source} · ${item.message}`),
          )),
      ),
      h('div', { className: 'ws-modal-actions' },
        h(Button, { variant: 'ghost', onClick: clear }, t('清空错误')),
        h(Button, { onClick: copy }, t('复制报告并关闭')),
        h(Button, { variant: 'primary', onClick: onClose }, t('关闭')),
      ),
    ),
  )
}

function CommandPalette({ commands, onClose }) {
  const [query, setQuery] = React.useState('')
  const [index, setIndex] = React.useState(0)
  const filtered = commands.filter(command => `${command.label} ${command.hint ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()))
  React.useEffect(() => { setIndex(0) }, [query])
  const run = (command) => { onClose(); command.run() }
  const onKeyDown = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose() }
    else if (event.key === 'ArrowDown') { event.preventDefault(); setIndex(value => Math.min(filtered.length - 1, value + 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setIndex(value => Math.max(0, value - 1)) }
    else if (event.key === 'Enter') {
      event.preventDefault()
      const command = filtered[index]
      if (command !== undefined) run(command)
    }
  }
  return h('div', { className: 'ws-modal-scrim', onClick: event => { if (event.target === event.currentTarget) onClose() } },
    h('div', { className: 'ws-modal ws-palette', role: 'dialog', 'aria-modal': 'true', onKeyDown },
      h('div', { className: 'ws-palette-search' },
        h(Icon, { name: 'search', size: 15 }),
        h('input', {
          className: 'ws-palette-input',
          autoFocus: true,
          value: query,
          placeholder: t('搜索动作、草稿、版式…'),
          onChange: event => setQuery(event.target.value),
        }),
        h('span', { className: 'ws-kbd' }, 'Esc'),
      ),
      h('div', { className: 'ws-palette-list' },
        filtered.length === 0
          ? h('p', { className: 'ws-hint' }, t('没有匹配的命令'))
          : filtered.map((command, commandIndex) => h('button', {
            key: command.id,
            type: 'button',
            className: 'ws-palette-item' + (commandIndex === index ? ' on' : ''),
            onMouseEnter: () => setIndex(commandIndex),
            onClick: () => run(command),
          },
          h('span', { className: 'ws-palette-label' }, command.label),
          command.hint ? h('span', { className: 'ws-palette-hint' }, command.hint) : null,
          )),
      ),
      h('div', { className: 'ws-palette-foot' },
        h('span', null, '↑↓ 选择 · Enter 执行'),
        h('span', null, '⌘K 开关'),
      ),
    ),
  )
}

const SNIPPET_BUILTINS = [
  { id: 'builtin-outro', name: '关注引导', text: '如果这篇对你有用，点个「在看」，或者转给正在需要它的人。' },
  { id: 'builtin-bio', name: '作者简介', text: '{{author}}，写作者。这里放一句你希望读者记住的话。' },
  { id: 'builtin-disclaimer', name: '免责声明', text: '本文只代表个人经验，不构成专业建议；涉及具体决策请结合自身情况判断。' },
]

function SnippetDialog({ store, toast, textareaRef, onClose }) {
  const [snippets, setSnippets] = React.useState([])
  const [name, setName] = React.useState('')
  const [text, setText] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const refresh = React.useCallback(() => {
    listSnippets().then(items => setSnippets(items)).catch(() => setSnippets([]))
  }, [])
  React.useEffect(() => { refresh() }, [refresh])
  const renderText = (value) => {
    const current = store.getDoc()
    const title = current?.meta?.title?.trim() || parseArticle(current?.text ?? '').title || ''
    const date = new Date()
    const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    return String(value)
      .replace(/\{\{title\}\}/g, title)
      .replace(/\{\{author\}\}/g, current?.meta?.author?.trim() || '')
      .replace(/\{\{brand\}\}/g, current?.meta?.brand?.trim() || '')
      .replace(/\{\{date\}\}/g, stamp)
  }
  const insert = (snippet) => {
    const element = textareaRef.current
    if (!element) { toast(t('先把光标放到正文里')); return }
    const start = element.selectionStart
    const end = element.selectionEnd
    const value = renderText(snippet.text)
    store.updateDoc(current => ({ ...current, text: `${current.text.slice(0, start)}${value}${current.text.slice(end)}` }), { coalesce: 'insert' })
    requestAnimationFrame(() => {
      element.focus()
      const caret = start + value.length
      element.setSelectionRange(caret, caret)
    })
    toast(t('已插入片段「{name}」', { name: snippet.name }), 'success')
    onClose()
  }
  const save = async () => {
    if (name.trim() === '' || text.trim() === '') { toast(t('片段名称和内容都不能为空')); return }
    setBusy(true)
    try {
      const ok = await saveSnippet({ name, text })
      if (!ok) throw new Error(t('片段保存失败，检查浏览器存储是否可用'))
      setName('')
      setText('')
      refresh()
      toast(t('片段已保存'), 'success')
    } catch (error) {
      toast(error.message || t('片段保存失败'), 'error')
    } finally {
      setBusy(false)
    }
  }
  const remove = async (id) => {
    await deleteSnippet(id)
    refresh()
  }
  return h('div', { className: 'ws-modal-scrim', onClick: event => { if (event.target === event.currentTarget) onClose() } },
    h('div', { className: 'ws-modal ws-snippet-modal', role: 'dialog', 'aria-modal': 'true' },
      h('div', { className: 'ws-modal-head' },
        h(Icon, { name: 'doc', size: 16 }),
        h('strong', null, t('片段库')),
        h(IconButton, { icon: 'close', title: t('关闭'), onClick: onClose }),
      ),
      h('p', { className: 'ws-hint' }, t('插入作者简介、关注引导、免责声明等常用块；支持 {{title}}、{{author}}、{{date}}、{{brand}} 变量。')),
      h('div', { className: 'ws-snippet-create' },
        h('input', { className: 'ws-input', value: name, placeholder: t('片段名称'), onChange: event => setName(event.target.value) }),
        h('textarea', { className: 'ws-input ws-textarea', rows: 3, value: text, placeholder: t('片段内容，支持 Markdown 和变量'), onChange: event => setText(event.target.value) }),
        h('div', { className: 'ws-row' },
          h(Button, { variant: 'primary', disabled: busy, onClick: save }, busy ? t('保存中…') : t('保存片段')),
        ),
      ),
      h('div', { className: 'ws-snippet-section' },
        h('div', { className: 'ws-snippet-section-title' }, t('内置片段')),
        SNIPPET_BUILTINS.map(snippet => h('div', { key: snippet.id, className: 'ws-snippet-row' },
          h('span', { className: 'ws-snippet-name' }, snippet.name),
          h('button', { type: 'button', className: 'ws-link', onClick: () => insert(snippet) }, t('插入')),
        )),
      ),
      h('div', { className: 'ws-snippet-section' },
        h('div', { className: 'ws-snippet-section-title' }, t('我的片段')),
        snippets.length === 0
          ? h('p', { className: 'ws-hint' }, t('还没有保存的片段。'))
          : snippets.map(snippet => h('div', { key: snippet.id, className: 'ws-snippet-row' },
            h('span', { className: 'ws-snippet-name' }, snippet.name),
            h('button', { type: 'button', className: 'ws-link', onClick: () => insert(snippet) }, t('插入')),
            h('button', { type: 'button', className: 'ws-link danger', onClick: () => remove(snippet.id) }, t('删除')),
          )),
      ),
    ),
  )
}

function ImageLibraryDialog({ store, toast, textareaRef, onClose }) {
  const [images, setImages] = React.useState([])
  const [busy, setBusy] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const fileRef = React.useRef(null)
  const refresh = React.useCallback(() => {
    setLoading(true)
    listImages().then(items => setImages(items)).catch(() => setImages([])).finally(() => setLoading(false))
  }, [])
  React.useEffect(() => { refresh() }, [refresh])
  const insert = (image) => {
    const element = textareaRef.current
    if (!element) { toast(t('先把光标放到正文里')); return }
    const start = element.selectionStart
    const end = element.selectionEnd
    const alt = t('配图')
    const snippet = `\n\n![${alt}](wsimg://${image.id})\n\n`
    store.updateDoc(current => ({ ...current, text: `${current.text.slice(0, start)}${snippet}${current.text.slice(end)}` }), { coalesce: 'insert' })
    requestAnimationFrame(() => {
      element.focus()
      const caret = start + snippet.length
      element.setSelectionRange(caret, caret)
    })
    toast(t('图片已插入正文'), 'success')
    onClose()
  }
  const upload = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      const raw = await readFileAsDataUrl(file)
      const compressed = await compressImage(raw, 1600)
      const ref = await materializeImage(compressed.dataUrl, { kind: 'library' })
      if (!ref.startsWith('wsimg://')) throw new Error(t('图片保存失败，浏览器存储不可用'))
      refresh()
      toast(t('图片已加入素材库'), 'success')
    } catch (error) {
      toast(error.message || t('图片处理失败'), 'error')
    } finally {
      setBusy(false)
    }
  }
  const remove = async (id) => {
    await deleteImage(id)
    refresh()
  }
  return h('div', { className: 'ws-modal-scrim', onClick: event => { if (event.target === event.currentTarget) onClose() } },
    h('div', { className: 'ws-modal ws-library-modal', role: 'dialog', 'aria-modal': 'true' },
      h('div', { className: 'ws-modal-head' },
        h(Icon, { name: 'image', size: 16 }),
        h('strong', null, t('图片素材库')),
        h(IconButton, { icon: 'close', title: t('关闭'), onClick: onClose }),
      ),
      h('p', { className: 'ws-hint' }, t('已上传的图片可以跨文章复用；点击插入会把短引用写进正文。')),
      h('div', { className: 'ws-row' },
        h(Button, { onClick: () => fileRef.current?.click(), disabled: busy }, busy ? t('上传中…') : t('上传图片')),
        h('span', { className: 'ws-hint' }, t('支持 PNG / JPEG，自动压缩')),
        h('input', { ref: fileRef, type: 'file', accept: 'image/*', style: { display: 'none' }, onChange: upload }),
      ),
      loading
        ? h('p', { className: 'ws-hint' }, t('读取素材中…'))
        : images.length === 0
          ? h('p', { className: 'ws-hint' }, t('素材库还是空的。'))
          : h('div', { className: 'ws-library-grid' }, images.map(image => h('div', { key: image.id, className: 'ws-library-card' },
            h('img', { src: image.dataUrl, alt: '' }),
            h('div', { className: 'ws-library-meta' },
              h('span', null, image.kind === 'library' ? t('素材') : t('正文图')),
              h('span', null, `${Math.round((image.bytes ?? 0) / 1024)}KB`),
            ),
            h('div', { className: 'ws-library-actions' },
              h('button', { type: 'button', className: 'ws-link', onClick: () => insert(image) }, t('插入')),
              h('button', { type: 'button', className: 'ws-link danger', onClick: () => remove(image.id) }, t('删除')),
            ),
          ))),
    ),
  )
}

function HelpDialog({ firstRun, onClose, onDiagnostics }) {
  React.useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])
  const sections = [
    ['快捷键', [
      ['⌘B / ⌘⇧H', '加粗 / 高亮'],
      ['⌘1 / ⌘2 / ⌘3', '标题层级'],
      ['⌘⇧7 / ⌘⇧8', '无序 / 有序列表'],
      ['⌘K / ⌘⇧K', '命令面板 / 链接'],
      ['⌘F', '查找替换'],
    ]],
    ['AI 修改', [
      ['选中段 / 本节 / 整篇', '控制改写范围'],
      ['更克制 / 更口语 / 更短', '语气预设'],
      ['应用修改', '先看 diff 再落盘'],
      ['取消', '生成中可中止'],
      ['发布前质检', '汇总保真、规范、发布差异'],
    ]],
    ['发布', [
      ['更新当前草稿', '覆盖已关联的公众号草稿'],
      ['另存新草稿', '合集篇数变化时使用'],
      ['版本快照', 'AI 前/发布前自动保存'],
      ['草稿失效', '自动解除关联，重新保存'],
    ]],
    ['编辑', [
      ['拖拽段落', '调整顺序'],
      ['复制这一段', '复制块后继续改'],
      ['图片工具', '图注 / 裁剪'],
      ['AI 设计', '对话生成整套版式'],
      ['段落锁', '锁定后 AI 不会改'],
      ['片段库', '作者简介、关注引导等'],
      ['品牌包', '导出版式 DNA、规范与片段'],
    ]],
  ]
  return h('div', { className: 'ws-modal-scrim', onClick: event => { if (event.target === event.currentTarget) onClose() } },
    h('div', { className: 'ws-modal', role: 'dialog', 'aria-modal': 'true' },
      h('div', { className: 'ws-modal-head' },
        h(Icon, { name: 'help', size: 16 }),
        h('strong', null, firstRun ? t('第一次用？先看这几条') : t('使用提示与快捷键')),
        h(IconButton, { icon: 'close', title: t('关闭'), onClick: onClose }),
      ),
      h('p', { className: 'ws-hint' }, firstRun ? t('编辑器写 Markdown，中间实时预览，右侧调版式与发布。下面是最容易漏掉的用法。') : t('这些操作在界面里没有全部写出来，需要时回来查。')),
      h('div', { className: 'ws-help-grid' },
        sections.map(([title, rows]) => h('div', { className: 'ws-help-section', key: title },
          h('h4', null, t(title)),
          rows.map(([key, text]) => h('div', { className: 'ws-help-row', key: key },
            h('span', { className: 'ws-help-key' }, key),
            h('span', null, t(text)),
          )),
        )),
      ),
      h('div', { className: 'ws-modal-actions' },
        h(Button, { variant: 'ghost', onClick: onDiagnostics }, t('诊断报告')),
        h(Button, { variant: 'primary', onClick: onClose }, firstRun ? t('开始使用') : t('知道了')),
      ),
    ),
  )
}

/* ------------------------------------------------------------------ *
 * Top bar
 * ------------------------------------------------------------------ */

