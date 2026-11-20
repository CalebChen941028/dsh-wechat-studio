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
const BG_CHOICES = [['', t('跟随主题')], ['#FFFFFF', t('纸白')], ['#F7F4EE', t('米色')], ['#F3F4F6', t('冷灰')], ['#161616', t('墨黑')]]
const BG_PATTERNS = [['none', t('无底纹')], ['paper', t('纸纹')], ['grid', t('网格')], ['dots', t('点阵')], ['lines', t('竖线')], ['wash', t('淡彩')]]
const ORNAMENTS = [['none', t('不加角标')], ['corner', t('边角线')], ['column', t('栏线')], ['seal', t('印记')], ['leaf', t('叶形')]]

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

先把稿子写成 Markdown，再让工具把它翻译成内联样式。标题、引用、列表、配图各有一套固定的处理方式，改主题只需要换一份配色。

> 排版的目的不是好看，是让读者别分心。

### 三个小习惯

1. 每段不超过四行，手机屏幕上不出现文字墙
2. 小节标题带序号，读者知道自己走到哪了
3. 引用只留一句，多了就变成第二个正文

---

写到这里，样式应该已经套好了。你可以改右侧的主题，也可以只调字号和行距。改完复制，粘回公众号编辑器。`

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
    meta: { title: '', author: '', digest: '', sourceUrl: '', brand: '', coverDataUrl: '', coverLayout: 'left', draftMediaId: '', draftArticleCount: 0, needOpenComment: false, onlyFansCanComment: false, ...(meta ?? {}) },
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
  const [helpFirstRun, setHelpFirstRun] = React.useState(() => { try { return localStorage.getItem(HELP_SEEN_KEY) !== '1' } catch { return false } })
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
  const [autoRefine, setAutoRefine] = React.useState(() => {
    try {
      return localStorage.getItem('dsh.wechat-studio.autoRefine') !== '0'
    } catch {
      return true
    }
  })
  const [refining, setRefining] = React.useState(false)
  const textareaRef = React.useRef(null)
  const toastSeq = React.useRef(0)
  const autoTimerRef = React.useRef(undefined)
  const refineTimerRef = React.useRef(undefined)
  const refineTokenRef = React.useRef(0)

  React.useEffect(() => {
    try {
      localStorage.setItem('dsh.wechat-studio.autoRefine', autoRefine ? '1' : '0')
    } catch {
      // Private mode: the preference just won't survive a reload.
    }
  }, [autoRefine])

  React.useEffect(() => () => {
    clearTimeout(autoTimerRef.current)
    clearTimeout(refineTimerRef.current)
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

  const runCompose = () => {
    const result = autoCompose(parsed.blocks, doc.text, 0)
    store.updateDoc(current => ({ ...current, design: result.design, meta: current.meta }))
    setTab('theme')
    if (narrow) setNarrowView('design')
    toast(`已按「${result.analysis.label}」编排：${composeDesign(result.design).themeName} · ${composeDesign(result.design).variantName}`, 'success')
  }

  const reshuffle = () => {
    store.updateDesign(current => nextVariant(current))
    const next = composeDesign(nextVariant(doc.design))
    toast(`换了一版：${next.themeName} · ${next.variantName}`)
  }

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

  /**
   * Run the local composer on whatever is in the editor now. This is instant
   * and deterministic, so pasted copy gets a decent layout before the model
   * even answers.
   */
  const composeFromCurrent = React.useCallback((announce) => {
    const current = store.getDoc()
    if (!current || current.text.trim().length < 40) return null
    const parsedNow = parseArticle(current.text)
    if (parsedNow.blocks.length === 0) return null
    const designNow = autoCompose(parsedNow.blocks, current.text, 0).design
    store.updateDoc(entry => ({ ...entry, design: designNow }))
    if (announce) {
      const composed = composeDesign(designNow)
      toast(`已按内容自动编排：${composed.themeName} · ${composed.variantName}`, 'success')
    }
    return designNow
  }, [store, toast])

  /** Ask the model to pick a layout, without letting it rewrite the copy. */
  const refineWithAi = React.useCallback(async (force = false) => {
    if (!autoRefine && force !== true) return
    const current = store.getDoc()
    if (!current || current.text.trim().length < 120) return
    const token = refineTokenRef.current + 1
    refineTokenRef.current = token
    const designBefore = JSON.stringify(current.design)
    setRefining(true)
    try {
      const value = await callHost('aiEdit', {
        instruction: '只做版式编排，不要改正文、标题和摘要。按内容类型做完整的杂志化设计：主题、版式、标题/小节/引文/分割线/列表/配图的装饰组合，必要时调整背景与矢量角标，以及字号、行高、段距、左右留白。reply 用一句话说明设计判断，不要只换一个颜色。',
        text: current.text,
        title: current.meta.title,
        design: current.design,
        meta: { author: current.meta.author, digest: current.meta.digest },
        history: [],
      }, { timeoutMs: 150000 })
      if (token !== refineTokenRef.current) return
      const latest = store.getDoc()
      if (!latest || latest.id !== current.id) return
      if (JSON.stringify(latest.design) !== designBefore) {
        toast('你刚手动调过版式，AI 精排的结果没有覆盖它')
        return
      }
      if (!value.design || typeof value.design.themeId !== 'string') return
      const theme = THEMES.find(entry => entry.id === value.design.themeId)
      if (theme === undefined) return
      const variantId = theme.variants.some(entry => entry.id === value.design.variantId)
        ? value.design.variantId
        : theme.variants[0].id
      store.updateDoc(entry => {
        const themeChanged = theme.id !== entry.design.themeId
        return {
          ...entry,
          design: {
            themeId: theme.id,
            variantId,
            // A theme switch starts from the new theme's own vocabulary;
            // keeping the old accent/decor would fight the new design.
            overrides: themeChanged
              ? (value.design.overrides ?? {})
              : { ...(entry.design.overrides ?? {}), ...(value.design.overrides ?? {}) },
          },
        }
      })
      const composed = composeDesign({ themeId: theme.id, variantId, overrides: value.design.overrides ?? {} })
      toast(`AI 精排完成：${composed.themeName} · ${composed.variantName}`, 'success')
    } catch (error) {
      if (token === refineTokenRef.current) toast(`AI 精排没有完成（${error.message}），已保留自动编排的结果`)
    } finally {
      if (token === refineTokenRef.current) setRefining(false)
    }
  }, [autoRefine, store, toast])

  /** Debounce the local composer, then hand off to the model when enabled. */
  const scheduleAutoCompose = React.useCallback((announce) => {
    clearTimeout(autoTimerRef.current)
    clearTimeout(refineTimerRef.current)
    autoTimerRef.current = setTimeout(() => {
      composeFromCurrent(announce)
      if (autoRefine) refineTimerRef.current = setTimeout(() => { refineWithAi() }, 700)
    }, 60)
  }, [composeFromCurrent, refineWithAi, autoRefine])

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
      const composed = composeDesign(designNow)
      const imageNote = typeof images === 'number' && images > 0 ? t('，含 {count} 张插图', { count: images }) : ''
      toast(`已导入「${parsedNow.title || file.name}」，自动编排为 ${composed.themeName} · ${composed.variantName}${imageNote}`, 'success')
      if (autoRefine) {
        clearTimeout(refineTimerRef.current)
        refineTimerRef.current = setTimeout(() => { refineWithAi() }, 900)
      }
    } catch (error) {
      toast(error.message || t('导入失败'), 'error')
    }
  }, [store, autoRefine, narrow, refineWithAi, toast, bumpImages])

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
      onCompose: runCompose, onReshuffle: reshuffle, onCopy: copyArticle, onOpenDesign: openDesign,
      onImportDocument: importDocument, refining, toast, appearance, setAppearance, onHelp: () => { setHelpFirstRun(false); setHelpOpen(true) },
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
        onGoToBlock: goToBlock, onEditorCaret: syncBlockFromCaret,
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
        autoRefine, setAutoRefine, refining, onRefineNow: () => refineWithAi(true),
        takeSnapshot, snapshotVersion,
      }),
    ),
    helpOpen ? h(HelpDialog, { firstRun: helpFirstRun, onClose: closeHelp }) : null,
    refining
      ? h('div', { className: 'ws-refining' },
        h('span', { className: 'ws-typing-dot' }),
        h('span', { className: 'ws-typing-dot' }),
        h('span', { className: 'ws-typing-dot' }),
        h('span', null, t('AI 正在按内容精排版式…')),
      )
      : null,
    h(ToastStack, { toasts }),
  )
}

function HelpDialog({ firstRun, onClose }) {
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
      ['⌘K / ⌘F', '链接 / 查找替换'],
    ]],
    ['AI 修改', [
      ['选中段 / 本节 / 整篇', '控制改写范围'],
      ['更克制 / 更口语 / 更短', '语气预设'],
      ['应用修改', '先看 diff 再落盘'],
      ['取消', '生成中可中止'],
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
      ['主题收藏', '收藏与最近筛选'],
    ]],
  ]
  return h('div', { className: 'ws-modal-scrim', onClick: event => { if (event.target === event.currentTarget) onClose() } },
    h('div', { className: 'ws-modal', role: 'dialog', 'aria-modal': 'true' },
      h('div', { className: 'ws-modal-head' },
        h(Icon, { name: 'help', size: 16 }),
        h('strong', null, firstRun ? t('第一次用？先看这几条') : t('使用提示与快捷键')),
        h(IconButton, { icon: 'close', title: t('关闭'), onClick: onClose }),
      ),
      h('p', { className: 'ws-hint' }, firstRun ? t('编辑器写 Markdown，中间实时预览，右侧调主题与发布。下面是最容易漏掉的用法。') : t('这些操作在界面里没有全部写出来，需要时回来查。')),
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
        h(Button, { variant: 'primary', onClick: onClose }, firstRun ? t('开始使用') : t('知道了')),
      ),
    ),
  )
}

/* ------------------------------------------------------------------ *
 * Top bar
 * ------------------------------------------------------------------ */

