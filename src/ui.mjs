/**
 * The studio UI: three panes (copy, live WeChat preview, design controls),
 * local drafts, and the publish flow. Written against the slot framework's
 * plain-JavaScript surface: React.createElement only, inline styles for the
 * article, and theme tokens for the chrome.
 */

const PANEL_ID = 'wechat-studio'
const STORAGE_KEY = 'dsh.wechat-studio.docs.v1'
const APPEARANCE_KEY = 'dsh.wechat-studio.appearance.v1'
const LONG_TEXT_CHUNK_THRESHOLD = 7000
const SKINS = [
  { id: 'auto', name: '跟随应用', hint: '自动适配深浅' },
  { id: 'light', name: '浅色玻璃', hint: '明亮通透' },
  { id: 'dark', name: '深色玻璃', hint: '低光环境' },
  { id: 'sand', name: '暖砂', hint: '米色柔光' },
]
const UI_ACCENTS = ['#0A84FF', '#3A3A3C', '#0E7C86', '#A2653B', '#B23A3A', '#6E6E73']
const BG_CHOICES = [['', '跟随主题'], ['#FFFFFF', '纸白'], ['#F7F4EE', '米色'], ['#F3F4F6', '冷灰'], ['#161616', '墨黑']]
const BG_PATTERNS = [['none', '无底纹'], ['paper', '纸纹'], ['grid', '网格'], ['dots', '点阵'], ['lines', '竖线'], ['wash', '淡彩']]
const ORNAMENTS = [['none', '不加角标'], ['corner', '边角线'], ['column', '栏线'], ['seal', '印记'], ['leaf', '叶形']]

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
    meta: { title: '', author: '', digest: '', sourceUrl: '', brand: '', coverDataUrl: '', needOpenComment: false, onlyFansCanComment: false, ...(meta ?? {}) },
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
          const activeId = docs.some(entry => entry.id === parsed.activeId) ? parsed.activeId : docs[0].id
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
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ docs: serializeDocs(docs), activeId }))
        setPersistError(false)
      } catch {
        // Quota or privacy mode: the panel keeps working in memory, and the
        // header shows a warning so the draft is not lost silently.
        setPersistError(true)
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [docs, activeId])

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
    toast('本地存储已满，这轮修改只保存在内存里，刷新会丢失。请导出草稿 JSON，或删掉带大图的草稿。', 'error')
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

  const renderText = React.useMemo(() => expandImageRefs(doc.text), [doc.text, imageVersion])
  // Counting/ranking must not count base64 payloads as article characters.
  const measureText = React.useMemo(() => doc.text.replace(/data:image\/[a-zA-Z+]+;base64,[^)\s]+/g, ''), [doc.text])
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
      toast(mode === 'rich' ? '已复制带样式的正文，粘到公众号编辑器即可' : '已复制，样式可能不完整', 'success')
    } catch (error) {
      toast(error.message || '复制失败', 'error')
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
      if (body.length < 20) throw new Error('这份文档里没有可用的正文')
      const parsedNow = parseArticle(body)
      const designNow = autoCompose(parsedNow.blocks, body, 0).design
      store.addDoc(body, designNow)
      if (narrow) setNarrowView('preview')
      const composed = composeDesign(designNow)
      const imageNote = typeof images === 'number' && images > 0 ? `，含 ${images} 张插图` : ''
      toast(`已导入「${parsedNow.title || file.name}」，自动编排为 ${composed.themeName} · ${composed.variantName}${imageNote}`, 'success')
      if (autoRefine) {
        clearTimeout(refineTimerRef.current)
        refineTimerRef.current = setTimeout(() => { refineWithAi() }, 900)
      }
    } catch (error) {
      toast(error.message || '导入失败', 'error')
    }
  }, [store, autoRefine, narrow, refineWithAi, toast, bumpImages])

  const openDesign = (nextTab) => {
    setTab(nextTab)
    if (narrow) setNarrowView('design')
    else setRightOpen(true)
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
      onImportDocument: importDocument, refining, toast, appearance, setAppearance,
    }),
    h('div', { className: 'ws-body' },
      h(DocRail, {
        store, parsed, features, textareaRef, toast, narrow, selectedBlock, setSelectedBlock,
        onImportDocument: importDocument, onContentPasted: () => scheduleAutoCompose(true),
        onImagesChanged: bumpImages,
        onOpenAi: () => openDesign('ai'),
      }),
      h(PreviewStage, {
        article, design, doc, parsed, features, selectedBlock, setSelectedBlock, store, toast, narrow, date, onImagesChanged: bumpImages,
      }),
      compact && !narrow && rightOpen ? h('div', { className: 'ws-scrim', onClick: () => setRightOpen(false) }) : null,
      h(DesignPanel, {
        store, design, doc, analysis, features, hostStatus, setHostStatus, tab, setTab, toast, parsed, article,
        narrow, compact, showClose: narrow || compact, onClose: closeDesign,
        autoRefine, setAutoRefine, refining, onRefineNow: () => refineWithAi(true),
      }),
    ),
    refining
      ? h('div', { className: 'ws-refining' },
        h('span', { className: 'ws-typing-dot' }),
        h('span', { className: 'ws-typing-dot' }),
        h('span', { className: 'ws-typing-dot' }),
        h('span', null, 'AI 正在按内容精排版式…'),
      )
      : null,
    h(ToastStack, { toasts }),
  )
}

/* ------------------------------------------------------------------ *
 * Top bar
 * ------------------------------------------------------------------ */

function TopBar(props) {
  const { store, design, features, narrow, compact, narrowView, setNarrowView, rightOpen, setRightOpen, onCompose, onReshuffle, onCopy, onOpenDesign, onImportDocument, refining, toast, appearance, setAppearance } = props
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [appearanceOpen, setAppearanceOpen] = React.useState(false)
  React.useEffect(() => {
    if (!appearanceOpen && !menuOpen) return undefined
    const onPointerDown = (event) => {
      const target = event.target
      if (target instanceof Element && target.closest('.ws-menu-anchor') !== null) return
      setAppearanceOpen(false)
      setMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown, true)
    return () => document.removeEventListener('mousedown', onPointerDown, true)
  }, [appearanceOpen, menuOpen])
  const fileRef = React.useRef(null)

  const exportHtml = () => {
    const tree = buildArticle({
      blocks: parseArticle(expandImageRefs(store.doc.text)).blocks,
      design,
      meta: { title: store.doc.meta.title, author: store.doc.meta.author, date: formatDate(store.doc.updatedAt), readingMinutes: features.readingMinutes },
    })
    downloadFile(`${(store.doc.meta.title || 'wechat-article').slice(0, 40)}.html`, serializeNodes(tree.nodes), 'text/html;charset=utf-8')
    setMenuOpen(false)
  }
  const exportMarkdown = () => {
    downloadFile(`${(store.doc.meta.title || 'wechat-article').slice(0, 40)}.md`, expandImageRefs(store.doc.text), 'text/markdown;charset=utf-8')
    setMenuOpen(false)
  }
  const exportJson = () => {
    downloadFile('wechat-studio-draft.json', JSON.stringify({ ...store.doc, text: expandImageRefs(store.doc.text) }, null, 2), 'application/json;charset=utf-8')
    setMenuOpen(false)
  }
  const importFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      if (!/\.json$/i.test(file.name)) {
        onImportDocument(file)
        return
      }
      const content = await file.text()
      const parsed = JSON.parse(content)
      if (!parsed || typeof parsed.text !== 'string') throw new Error('这个 JSON 里没有可用的正文')
      const importedText = await materializeInlineImages(parsed.text, { kind: 'import' })
      bumpImages()
      store.addDoc(importedText, parsed.design, parsed.meta)
      toast(`已导入「${parsed.meta?.title || '未命名草稿'}」`, 'success')
    } catch (error) {
      toast(error.message || '导入失败', 'error')
    }
  }

  return h('header', { className: 'ws-top' },
    h('div', { className: 'ws-brand' },
      h(Icon, { name: 'pen', size: 17 }),
      h('span', null, '公众号排版'),
      compact ? null : h('span', { className: 'ws-badge' }, design.themeName + ' · ' + design.variantName),
      refining ? h('span', { className: 'ws-badge busy' }, 'AI 精排中…') : null,
    ),
    narrow
      ? h('div', { className: 'ws-seg' },
        h('button', { type: 'button', className: narrowView === 'write' ? 'on' : '', onClick: () => setNarrowView('write') }, '编辑'),
        h('button', { type: 'button', className: narrowView === 'preview' ? 'on' : '', onClick: () => setNarrowView('preview') }, '预览'),
        h('button', { type: 'button', className: narrowView === 'design' ? 'on' : '', onClick: () => setNarrowView('design') }, '设计'),
      )
      : null,
    h('div', { className: 'ws-top-spacer' }),
    !narrow
      ? h('div', { className: 'ws-top-group' },
        h(IconButton, { icon: 'undo', title: '撤销', disabled: !store.canUndo, onClick: store.undo }),
        h(IconButton, { icon: 'redo', title: '重做', disabled: !store.canRedo, onClick: store.redo }),
      )
      : null,
    compact
      ? h(IconButton, { icon: 'chat', title: 'AI 对话修改', onClick: () => onOpenDesign('ai') })
      : h(Button, { icon: 'chat', onClick: () => onOpenDesign('ai'), title: '用对话让 AI 改文案或版式' }, 'AI 修改'),
    h(Button, { icon: 'sparkles', variant: 'primary', onClick: onCompose, title: '按内容自动选择主题与版式' }, '自动编排'),
    compact
      ? h(IconButton, { icon: 'shuffle', title: '换一版', onClick: onReshuffle })
      : h(Button, { icon: 'shuffle', onClick: onReshuffle, title: '在当前主题里换一个版式' }, '换一版'),
    compact
      ? h(IconButton, { icon: 'copy', title: '复制带样式的正文', onClick: onCopy })
      : h(Button, { icon: 'copy', onClick: onCopy }, '复制 HTML'),
    h(Button, { icon: 'send', variant: 'solid', onClick: () => onOpenDesign('publish') }, '发布'),
    narrow
      ? null
      : h(IconButton, { icon: 'panel', title: rightOpen ? '收起设计面板' : '展开设计面板', onClick: () => setRightOpen(value => !value) }),
    h('div', { className: 'ws-menu-anchor' },
      h(IconButton, { icon: 'palette', title: '外观与主题', onClick: () => { setAppearanceOpen(value => !value); setMenuOpen(false) } }),
      appearanceOpen
        ? h('div', { className: 'ws-appearance' },
          h('div', { className: 'ws-appearance-head' }, h(Icon, { name: 'palette', size: 14 }), h('span', null, '外观')),
          h('div', { className: 'ws-skins' },
            SKINS.map(skin => h('button', {
              key: skin.id,
              type: 'button',
              className: 'ws-skin' + (appearance.skin === skin.id ? ' on' : '') + ' ws-skin-' + skin.id,
              onClick: () => setAppearance({ ...appearance, skin: skin.id }),
            },
            h('span', { className: 'ws-skin-preview' }),
            h('span', { className: 'ws-skin-text' },
              h('span', { className: 'ws-skin-name' }, skin.name),
              h('span', { className: 'ws-skin-hint' }, skin.hint),
            ),
            )),
          ),
          h('div', { className: 'ws-appearance-sub' }, '强调色'),
          h('div', { className: 'ws-swatches' },
            UI_ACCENTS.map(color => h('button', {
              key: color,
              type: 'button',
              className: 'ws-swatch' + (appearance.accent.toLowerCase() === color.toLowerCase() ? ' on' : ''),
              style: { background: color },
              title: color,
              onClick: () => setAppearance({ ...appearance, accent: color }),
            })),
          ),
        )
        : null,
    ),
    h('div', { className: 'ws-menu-anchor' },
      h(IconButton, { icon: 'more', title: '更多', onClick: () => { setMenuOpen(value => !value); setAppearanceOpen(false) } }),
      menuOpen
        ? h('div', { className: 'ws-menu', onMouseLeave: () => setMenuOpen(false) },
          h('button', { type: 'button', onClick: exportHtml }, h(Icon, { name: 'download', size: 14 }), '导出 HTML'),
          h('button', { type: 'button', onClick: exportMarkdown }, h(Icon, { name: 'download', size: 14 }), '导出 Markdown'),
          h('button', { type: 'button', onClick: exportJson }, h(Icon, { name: 'download', size: 14 }), '导出草稿 JSON'),
          h('button', { type: 'button', onClick: () => fileRef.current?.click() }, h(Icon, { name: 'upload', size: 14 }), '导入 .md / .txt / .json'),
          h('div', { className: 'ws-menu-sep' }),
          h('button', { type: 'button', className: 'danger', onClick: () => { setMenuOpen(false); store.removeDoc(store.doc.id); toast('草稿已删除') } }, h(Icon, { name: 'trash', size: 14 }), '删除当前草稿'),
        )
        : null,
    ),
    h('input', { ref: fileRef, type: 'file', accept: '.md,.markdown,.txt,.json,.docx,.html,.htm', style: { display: 'none' }, onChange: importFile }),
  )
}

/* ------------------------------------------------------------------ *
 * Left rail: drafts, title, toolbar, editor
 * ------------------------------------------------------------------ */

function DocRail(props) {
  const { store, parsed, features, textareaRef, toast, selectedBlock, setSelectedBlock, onImportDocument, onContentPasted, onOpenAi, onImagesChanged } = props
  const { doc } = store
  const [docMenu, setDocMenu] = React.useState(false)
  React.useEffect(() => {
    if (!docMenu) return undefined
    const onPointerDown = (event) => {
      const target = event.target
      if (target instanceof Element && target.closest('.ws-doc-switch') !== null) return
      setDocMenu(false)
    }
    document.addEventListener('mousedown', onPointerDown, true)
    return () => document.removeEventListener('mousedown', onPointerDown, true)
  }, [docMenu])
  const [dragging, setDragging] = React.useState(false)
  const uploadRef = React.useRef(null)
  const imageRef = React.useRef(null)

  const insert = (before, after = '', placeholder = '') => {
    const element = textareaRef.current
    if (!element) return
    const start = element.selectionStart
    const end = element.selectionEnd
    const selected = doc.text.slice(start, end) || placeholder
    const next = `${doc.text.slice(0, start)}${before}${selected}${after}${doc.text.slice(end)}`
    store.updateDoc(current => ({ ...current, text: next }), { coalesce: 'insert' })
    requestAnimationFrame(() => {
      element.focus()
      element.selectionStart = start + before.length
      element.selectionEnd = start + before.length + selected.length
    })
  }

  const insertText = (snippet) => {
    const element = textareaRef.current
    if (!element) return
    const start = element.selectionStart
    const end = element.selectionEnd
    const next = `${doc.text.slice(0, start)}${snippet}${doc.text.slice(end)}`
    store.updateDoc(current => ({ ...current, text: next }), { coalesce: 'insert' })
    requestAnimationFrame(() => {
      element.focus()
      const caret = start + snippet.length
      element.selectionStart = caret
      element.selectionEnd = caret
    })
  }

  const insertImageFile = async (file) => {
    if (!file) return
    try {
      const raw = await readFileAsDataUrl(file)
      const compressed = await compressImage(raw, 720)
      const alt = String(file.name ?? '配图').replace(/\.[^.]+$/, '') || '配图'
      const ref = await materializeImage(compressed.dataUrl, { kind: 'content' })
      insertText(`\n\n![${alt}](${ref})\n\n`)
      if (typeof onImagesChanged === 'function') onImagesChanged()
      toast('图片已插入正文，发布时会自动转存到微信 CDN', 'success')
    } catch (error) {
      toast(error.message || '图片处理失败', 'error')
    }
  }

  const insertBlock = (snippet) => {
    const element = textareaRef.current
    if (!element) return
    const position = element.selectionStart
    const before = doc.text.slice(0, position)
    const needsGap = before !== '' && !before.endsWith('\n\n')
    const prefix = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
    void needsGap
    const next = `${before}${prefix}${snippet}\n\n${doc.text.slice(position)}`
    store.updateDoc(current => ({ ...current, text: next }), { coalesce: 'insert' })
    requestAnimationFrame(() => {
      element.focus()
      const caret = before.length + prefix.length + snippet.length
      element.selectionStart = caret
      element.selectionEnd = caret
    })
  }

  const words = features.chars
  const toolbar = [
    { label: 'H2', title: '小节标题', run: () => insertBlock('## 小节标题') },
    { label: 'H3', title: '小标题', run: () => insertBlock('### 小标题') },
    { label: '“', title: '引用', run: () => insertBlock('> 写一句值得被记住的话') },
    { label: '•', title: '无序列表', run: () => insertBlock('- 第一点\n- 第二点\n- 第三点') },
    { label: '1.', title: '有序列表', run: () => insertBlock('1. 第一步\n2. 第二步\n3. 第三步') },
    { label: '—', title: '分割线', run: () => insertBlock('---') },
    { label: '图', title: '插入本地图片', run: () => imageRef.current?.click() },
    { label: 'B', title: '加粗', run: () => insert('**', '**', '加粗文字') },
    { label: '高', title: '高亮', run: () => insert('==', '==', '高亮文字') },
    { label: '码', title: '行内代码', run: () => insert('`', '`', 'code') },
  ]

  return h('aside', {
    className: 'ws-left' + (dragging ? ' ws-dragging' : ''),
    onDragOver: event => { event.preventDefault(); setDragging(true) },
    onDragLeave: event => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false) },
    onDrop: event => {
      event.preventDefault()
      setDragging(false)
      const file = event.dataTransfer?.files?.[0]
      if (!file) return
      if (String(file.type).startsWith('image/')) insertImageFile(file)
      else onImportDocument(file)
    },
  },
    h('div', { className: 'ws-left-head' },
      h('div', { className: 'ws-doc-switch' },
        h('button', { type: 'button', className: 'ws-doc-current', onClick: () => setDocMenu(value => !value) },
          h(Icon, { name: 'doc', size: 14 }),
          h('span', null, doc.meta.title.trim() || parsed.title || '未命名草稿'),
          h(Icon, { name: 'chevron', size: 12 }),
        ),
        docMenu
          ? h('div', { className: 'ws-doc-menu', onMouseLeave: () => setDocMenu(false) },
            store.docs.map(entry => h('button', {
              key: entry.id,
              type: 'button',
              className: entry.id === doc.id ? 'on' : '',
              onClick: () => { store.selectDoc(entry.id); setDocMenu(false); setSelectedBlock(null) },
            },
            h('span', { className: 'ws-doc-name' }, entry.meta.title.trim() || parseArticle(entry.text).title || '未命名草稿'),
            h('span', { className: 'ws-doc-date' }, formatDate(entry.updatedAt)),
            )),
          )
          : null,
      ),
      h('div', { className: 'ws-left-actions' },
        h(IconButton, { icon: 'chat', title: 'AI 对话修改', onClick: onOpenAi }),
        h(IconButton, { icon: 'upload', title: '上传文档（.md / .txt / .docx / .html）', onClick: () => uploadRef.current?.click() }),
        h(IconButton, { icon: 'plus', title: '新建草稿', onClick: () => { store.addDoc(''); setSelectedBlock(null); toast('已新建草稿') } }),
        h(IconButton, { icon: 'trash', title: '删除当前草稿', onClick: () => { store.removeDoc(doc.id); setSelectedBlock(null); toast('草稿已删除') } }),
        h('input', {
          ref: uploadRef,
          type: 'file',
          accept: '.md,.markdown,.txt,.docx,.html,.htm',
          style: { display: 'none' },
          onChange: event => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) onImportDocument(file)
          },
        }),
        h('input', {
          ref: imageRef,
          type: 'file',
          accept: 'image/*',
          style: { display: 'none' },
          onChange: event => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) insertImageFile(file)
          },
        }),
      ),
    ),
    parsed.title !== '' && doc.meta.title.trim() !== '' && doc.meta.title.trim() !== parsed.title
      ? h('div', { className: 'ws-title-hint' }, `正文 H1 是「${parsed.title}」，发布与预览当前用上面这个标题；留空则回到 H1。`)
      : null,
    doc.meta.sample === true
      ? h('div', { className: 'ws-title-hint' }, '这是示例文案。粘贴你的内容、上传文档或直接编辑，就会替换掉它。')
      : null,
    h('input', {
      className: 'ws-title-input',
      placeholder: parsed.title !== '' ? parsed.title : '文章标题（也可以直接写 # 标题）',
      value: doc.meta.title,
      onChange: event => store.updateMeta({ title: event.target.value }),
    }),
    h('div', { className: 'ws-toolbar' },
      toolbar.map(item => h('button', {
        key: item.label,
        type: 'button',
        className: 'ws-tool',
        title: item.title,
        onClick: item.run,
      }, item.label)),
    ),
    h('textarea', {
      ref: textareaRef,
      className: 'ws-editor',
      value: doc.text,
      spellCheck: false,
      placeholder: '把公众号文案粘到这里。支持 Markdown：## 小节、> 引用、- 列表、![图片](url)、--- 分割线、**加粗**、==高亮==。',
      onChange: event => store.updateDoc(current => ({
        ...current,
        text: event.target.value,
        meta: current.meta.sample === true ? { ...current.meta, sample: false } : current.meta,
      }), { coalesce: 'text' }),
      onPaste: event => {
        const imageFile = Array.from(event.clipboardData?.files ?? []).find(file => String(file.type).startsWith('image/'))
        if (imageFile) {
          event.preventDefault()
          insertImageFile(imageFile)
          return
        }
        const pasted = event.clipboardData?.getData('text') ?? ''
        if (pasted.includes('data:image/')) {
          event.preventDefault()
          materializeInlineImages(pasted, { kind: 'paste' }).then(text => {
            insertText(text)
            if (typeof onImagesChanged === 'function') onImagesChanged()
            if (text.trim().length >= 240) onContentPasted()
          }).catch(error => toast(error.message || '图片处理失败', 'error'))
          return
        }
        const element = event.currentTarget
        const replacingAll = element.selectionStart === 0 && element.selectionEnd === element.value.length
        const before = element.value.trim().length
        if (pasted.trim().length >= 240 && (before < 80 || replacingAll)) onContentPasted()
      },
      onKeyDown: event => {
        if (!(event.metaKey || event.ctrlKey)) return
        if (event.key === 'z' && !event.shiftKey) { event.preventDefault(); store.undo() } else if ((event.key === 'z' && event.shiftKey) || event.key === 'y') { event.preventDefault(); store.redo() }
      },
    }),
    h('div', { className: 'ws-left-foot' },
      h('span', null, `${features.chars} 字 · 约 ${features.readingMinutes} 分钟`),
      selectedBlock !== null ? h('span', { className: 'ws-foot-hint' }, '已选中第 ' + (selectedBlock + 1) + ' 段') : null,
      h('span', { className: 'ws-top-spacer' }),
      h('span', { className: 'ws-saved' }, h(Icon, { name: 'check', size: 12 }), '本地自动保存'),
    ),
  )
}

/* ------------------------------------------------------------------ *
 * Middle: live phone preview with per-block controls
 * ------------------------------------------------------------------ */

/** Re-encode any large inline data-URL image so a Word import stays editable. */
async function shrinkMarkdownImages(text) {
  const pattern = /!\[([^\]]*)\]\((data:image\/[a-zA-Z+]+;base64,[^)]+)\)/g
  const matches = Array.from(String(text ?? '').matchAll(pattern))
  if (matches.length === 0) return text
  let output = String(text)
  for (const match of matches.slice(0, 12)) {
    const dataUrl = match[2]
    try {
      if (base64Bytes(dataUrl) <= 240 * 1024) continue
      const compressed = await compressImage(dataUrl, 1080)
      output = output.split(dataUrl).join(compressed.dataUrl)
    } catch {
      // Keep the original image when the canvas cannot decode it.
    }
  }
  return output
}

/** Live clock for the status bar; recomputed twice a minute. */
function useClockText() {
  const format = () => {
    const now = new Date()
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  }
  const [text, setText] = React.useState(format)
  React.useEffect(() => {
    const timer = window.setInterval(() => setText(format()), 30000)
    return () => window.clearInterval(timer)
  }, [])
  return text
}

/** Status-bar glyphs: cellular bars, Wi-Fi, battery. */
function PhoneStatusGlyphs() {
  return h('div', { className: 'ws-status-glyphs' },
    h('svg', { width: 17, height: 12, viewBox: '0 0 17 12', fill: 'currentColor', 'aria-hidden': 'true' },
      h('rect', { x: 0, y: 8, width: 3, height: 4, rx: 1 }),
      h('rect', { x: 4.5, y: 6, width: 3, height: 6, rx: 1 }),
      h('rect', { x: 9, y: 3.5, width: 3, height: 8.5, rx: 1 }),
      h('rect', { x: 13.5, y: 1, width: 3, height: 11, rx: 1 }),
    ),
    h('svg', { width: 16, height: 12, viewBox: '0 0 16 12', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', 'aria-hidden': 'true' },
      h('path', { d: 'M1.5 4.2C5.5 0.8 10.5 0.8 14.5 4.2' }),
      h('path', { d: 'M4.2 7C6.5 5 9.5 5 11.8 7' }),
      h('circle', { cx: 8, cy: 10, r: 1.1, fill: 'currentColor', stroke: 'none' }),
    ),
    h('svg', { width: 25, height: 12, viewBox: '0 0 25 12', fill: 'none', 'aria-hidden': 'true' },
      h('rect', { x: 0.7, y: 1.2, width: 21, height: 9.6, rx: 2.6, stroke: 'currentColor', strokeOpacity: 0.45, strokeWidth: 1.1 }),
      h('rect', { x: 2.2, y: 2.7, width: 15, height: 6.6, rx: 1.4, fill: 'currentColor' }),
      h('path', { d: 'M23.4 4.2v3.6c.9-.3 1.4-1 1.4-1.8s-.5-1.5-1.4-1.8z', fill: 'currentColor', fillOpacity: 0.5 }),
    ),
  )
}

/** One glyph for the WeChat bottom action bar. */
function WechatActionGlyph({ kind }) {
  const common = { width: 21, height: 21, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' }
  if (kind === 'share') {
    return h('svg', common, h('path', { d: 'M12 3v13' }), h('path', { d: 'M7.5 7.5L12 3l4.5 4.5' }), h('path', { d: 'M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6' }))
  }
  if (kind === 'wow') {
    return h('svg', common,
      h('path', { d: 'M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12z' }),
      h('circle', { cx: 12, cy: 12, r: 2.4 }),
    )
  }
  return h('svg', common,
    h('path', { d: 'M7 10.5v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3z' }),
    h('path', { d: 'M7 10.5l3.4-7a1.8 1.8 0 0 1 3.3 1.4L12.6 9h5.2a1.8 1.8 0 0 1 1.8 2.2l-1.3 6.1A1.8 1.8 0 0 1 16.5 19H7' }),
  )
}

/** The native-looking WeChat article chrome around the rendered body. */
function WechatPhoneChrome(props) {
  const { children, brand, source, empty } = props
  const clock = useClockText()
  return h('div', { className: 'ws-phone' },
    h('span', { className: 'ws-side-btn ws-side-btn-mute' }),
    h('span', { className: 'ws-side-btn ws-side-btn-volup' }),
    h('span', { className: 'ws-side-btn ws-side-btn-voldown' }),
    h('span', { className: 'ws-side-btn ws-side-btn-power' }),
    h('div', { className: 'ws-screen' },
      h('div', { className: 'ws-statusbar' },
        h('span', { className: 'ws-status-time' }, clock),
        h(PhoneStatusGlyphs, null),
      ),
      h('div', { className: 'ws-island', 'aria-hidden': 'true' }),
      h('div', { className: 'ws-wechat-nav' },
        h('span', { className: 'ws-nav-back' }, h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' }, h('path', { d: 'M15 4.5L7.5 12 15 19.5' }))),
        h('span', { className: 'ws-nav-brand' }, brand),
        h('span', { className: 'ws-nav-more' }, h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': 'true' }, h('circle', { cx: 5, cy: 12, r: 1.7 }), h('circle', { cx: 12, cy: 12, r: 1.7 }), h('circle', { cx: 19, cy: 12, r: 1.7 }))),
      ),
      h('div', { className: 'ws-phone-scroll' },
        empty ? h('div', { className: 'ws-empty' }, '把文案粘到左侧，或上传 .md / .docx 文档，这里会实时出现公众号版式。也可以点下方「插入图片」放一张插图。') : children,
        !empty && source !== ''
          ? h('div', { className: 'ws-read-original' }, '阅读原文', h('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' }, h('path', { d: 'M9 5l7 7-7 7' })))
          : null,
      ),
      h('div', { className: 'ws-wechat-actions' },
        h('span', { className: 'ws-comment-pill' }, '写留言'),
        h('span', { className: 'ws-action-icon', title: '分享' }, h(WechatActionGlyph, { kind: 'share' })),
        h('span', { className: 'ws-action-icon', title: '在看' }, h(WechatActionGlyph, { kind: 'wow' })),
        h('span', { className: 'ws-action-icon', title: '赞' }, h(WechatActionGlyph, { kind: 'like' })),
      ),
      h('div', { className: 'ws-home-indicator' }, h('i')),
    ),
  )
}

function PreviewStage(props) {
  const { article, design, doc, parsed, features, selectedBlock, setSelectedBlock, store, toast, narrow, date, onImagesChanged } = props
  const previewImageRef = React.useRef(null)
  const pendingReplaceRef = React.useRef(null)
  const replaceImage = (blockIndex) => {
    pendingReplaceRef.current = blockIndex
    previewImageRef.current?.click()
  }
  const replaceImageFile = async (blockIndex, file) => {
    const block = sourceBlocks[blockIndex]
    if (!block || block.type !== 'image') return
    try {
      const raw = await readFileAsDataUrl(file)
      const compressed = await compressImage(raw, 1200)
      const alt = String(file.name ?? '配图').replace(/\.[^.]+$/, '') || '配图'
      const ref = await materializeImage(compressed.dataUrl, { kind: 'content' })
      const lines = doc.text.split('\n')
      const next = [
        ...lines.slice(0, block.lines[0]),
        `![${alt}](${ref})`,
        ...lines.slice(block.lines[1] + 1),
      ].join('\n')
      store.updateDoc(current => ({ ...current, text: next }))
      if (typeof onImagesChanged === 'function') onImagesChanged()
      toast('图片已替换')
    } catch (error) {
      toast(error.message || '图片处理失败', 'error')
    }
  }
  const insertPreviewImage = async (file) => {
    if (!file) return
    try {
      const raw = await readFileAsDataUrl(file)
      const compressed = await compressImage(raw, 1200)
      const alt = String(file.name ?? '配图').replace(/\.[^.]+$/, '') || '配图'
      const ref = await materializeImage(compressed.dataUrl, { kind: 'content' })
      store.updateDoc(current => ({
        ...current,
        text: `${current.text.trimEnd()}${current.text.trim() === '' ? '' : '\n\n'}![${alt}](${ref})`,
      }))
      if (typeof onImagesChanged === 'function') onImagesChanged()
      toast('插图已加到正文末尾')
    } catch (error) {
      toast(error.message || '图片处理失败', 'error')
    }
  }
  const root = article.nodes[0]
  const titleFirst = article.title !== ''
  const sourceBlocks = parsed.blocks.filter(block => block.type !== 'title')

  const moveBlock = (index, direction) => {
    const blocks = parsed.blocks
    const groups = sourceBlocks.map(block => ({ start: block.lines[0], end: block.lines[1] }))
    const target = index + direction
    if (target < 0 || target >= groups.length) return
    const lines = doc.text.split('\n')
    const a = groups[index]
    const b = groups[target]
    const first = a.start < b.start ? a : b
    const second = a.start < b.start ? b : a
    const firstLines = lines.slice(first.start, first.end + 1)
    const secondLines = lines.slice(second.start, second.end + 1)
    const next = [
      ...lines.slice(0, first.start),
      ...(a.start < b.start ? secondLines : firstLines),
      ...lines.slice(first.end + 1, second.start),
      ...(a.start < b.start ? firstLines : secondLines),
      ...lines.slice(second.end + 1),
    ].join('\n')
    void blocks
    store.updateDoc(current => ({ ...current, text: next }))
    setSelectedBlock(target)
  }

  const removeBlock = (index) => {
    const groups = sourceBlocks.map(block => ({ start: block.lines[0], end: block.lines[1] }))
    const lines = doc.text.split('\n')
    const group = groups[index]
    if (!group) return
    let start = group.start
    let end = group.end
    if ((lines[end + 1] ?? '').trim() === '') end += 1
    else if ((lines[start - 1] ?? '').trim() === '') start -= 1
    const next = [...lines.slice(0, start), ...lines.slice(end + 1)].join('\n')
    store.updateDoc(current => ({ ...current, text: next }))
    setSelectedBlock(null)
    toast('已删除这一段')
  }

  const blockLabel = (block) => {
    if (!block) return ''
    if (block.type === 'heading') return '小节'
    if (block.type === 'quote') return '引用'
    if (block.type === 'list') return '列表'
    if (block.type === 'image') return '图片'
    if (block.type === 'code') return '代码'
    if (block.type === 'divider') return '分割线'
    return '段落'
  }

  const brand = (doc.meta.brand ?? '').trim() || '公众号'
  const source = (doc.meta.sourceUrl ?? '').trim()

  return h('section', { className: 'ws-mid' },
    h('div', { className: 'ws-stage' },
      h(WechatPhoneChrome, { brand, source, empty: doc.text.trim() === '' },
        h(ArticleBody, {
          root, titleFirst, sourceBlocks, selectedBlock, setSelectedBlock, moveBlock, removeBlock, blockLabel,
        }),
      ),
      h('input', {
        ref: previewImageRef,
        type: 'file',
        accept: 'image/*',
        style: { display: 'none' },
        onChange: event => {
          const file = event.target.files?.[0]
          const replaceIndex = pendingReplaceRef.current
          pendingReplaceRef.current = null
          event.target.value = ''
          if (!file) return
          if (replaceIndex !== null) replaceImageFile(replaceIndex, file)
          else insertPreviewImage(file)
        },
      }),
      h('div', { className: 'ws-stage-bar' },
        h('button', { type: 'button', className: 'ws-mini-btn', onClick: () => previewImageRef.current?.click() }, '插入图片'),
        h('span', { className: 'ws-stage-chip' }, h('i', { style: { background: design.colors.accent } }), design.colors.accent),
        h('span', { className: 'ws-stage-chip' }, `正文 ${design.type.bodySize}px / 行高 ${design.type.lineHeight}`),
        h('span', { className: 'ws-stage-chip' }, `边距 ${design.layout.paddingX}px`),
        h('span', { className: 'ws-stage-note' }, '悬停段落可上移、下移或删除'),
      ),
    ),
  )
}

function ArticleBody(props) {
  const { root, titleFirst, sourceBlocks, selectedBlock, setSelectedBlock, moveBlock, removeBlock, blockLabel, replaceImage } = props
  const [hovered, setHovered] = React.useState(null)
  const children = root.children

  return h('div', {
    className: 'ws-article',
    style: root.style,
  }, children.map((child, index) => {
    const blockIndex = index - (titleFirst ? 1 : 0)
    const block = blockIndex >= 0 && blockIndex < sourceBlocks.length ? sourceBlocks[blockIndex] : null
    const content = nodesToReact([child], h)
    if (!block) return h('div', { key: index, className: 'ws-block' }, content)
    const isSelected = selectedBlock === blockIndex
    return h('div', {
      key: index,
      className: 'ws-block' + (isSelected ? ' selected' : '') + (hovered === blockIndex ? ' hovered' : ''),
      onMouseEnter: () => setHovered(blockIndex),
      onMouseLeave: () => setHovered(value => (value === blockIndex ? null : value)),
      onClick: () => setSelectedBlock(isSelected ? null : blockIndex),
    },
    isSelected ? h('div', { className: 'ws-block-tag' }, blockLabel(block)) : null,
    content,
    h('div', { className: 'ws-block-tools' },
      block.type === 'image' ? h('button', { type: 'button', title: '替换图片', onClick: event => { event.stopPropagation(); replaceImage(blockIndex) } }, h(Icon, { name: 'image', size: 12 })) : null,
      h('button', { type: 'button', title: '上移', onClick: event => { event.stopPropagation(); moveBlock(blockIndex, -1) } }, h(Icon, { name: 'arrowUp', size: 12 })),
      h('button', { type: 'button', title: '下移', onClick: event => { event.stopPropagation(); moveBlock(blockIndex, 1) } }, h(Icon, { name: 'arrowDown', size: 12 })),
      h('button', { type: 'button', title: '删除这一段', onClick: event => { event.stopPropagation(); removeBlock(blockIndex) } }, h(Icon, { name: 'trash', size: 12 })),
    ),
    )
  }))
}

/* ------------------------------------------------------------------ *
 * Right panel
 * ------------------------------------------------------------------ */

const TABS = [
  { id: 'ai', label: 'AI' },
  { id: 'theme', label: '主题' },
  { id: 'type', label: '排版' },
  { id: 'decor', label: '装饰' },
  { id: 'publish', label: '发布' },
]

function DesignPanel(props) {
  const { store, design, doc, analysis, features, hostStatus, setHostStatus, tab, setTab, toast, parsed, article, showClose, onClose, autoRefine, setAutoRefine, refining, onRefineNow } = props
  return h('aside', { className: 'ws-right' },
    h('div', { className: 'ws-tabs' },
      TABS.map(entry => h('button', {
        key: entry.id,
        type: 'button',
        className: 'ws-tab' + (tab === entry.id ? ' on' : ''),
        onClick: () => setTab(entry.id),
      }, entry.label)),
      showClose ? h('button', { type: 'button', className: 'ws-tab-close', title: '收起设计面板', onClick: onClose }, h(Icon, { name: 'close', size: 14 })) : null,
    ),
    h('div', { className: 'ws-panel' },
      h('div', { className: 'ws-pane' + (tab === 'ai' ? '' : ' ws-pane-hidden') },
        h(AiSection, { store, design, doc, parsed, hostStatus, toast })),
      h('div', { className: 'ws-pane' + (tab === 'theme' ? '' : ' ws-pane-hidden') },
        h(ThemeSection, { store, design, analysis, doc, toast, autoRefine, setAutoRefine, refining, onRefineNow })),
      h('div', { className: 'ws-pane' + (tab === 'type' ? '' : ' ws-pane-hidden') },
        h(TypeSection, { store, design, toast })),
      h('div', { className: 'ws-pane' + (tab === 'decor' ? '' : ' ws-pane-hidden') },
        h(DecorSection, { store, design, toast })),
      h('div', { className: 'ws-pane' + (tab === 'publish' ? '' : ' ws-pane-hidden') },
        h(PublishSection, {
          store, design, doc, parsed, article, features, hostStatus, setHostStatus, toast,
        })),
    ),
  )
}

function AiSection(props) {
  const { store, design, doc, parsed, hostStatus, toast } = props
  const [messages, setMessages] = React.useState([])
  const [input, setInput] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [progress, setProgress] = React.useState(0)
  const [phase, setPhase] = React.useState('')
  const [chunked, setChunked] = React.useState(false)
  const listRef = React.useRef(null)
  const inputRef = React.useRef(null)

  React.useEffect(() => {
    const element = listRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [messages, busy])

  const send = async (override) => {
    const instruction = String(override ?? input).trim()
    if (instruction === '' || busy) return
    if (doc.text.trim() === '') {
      toast('编辑区还是空的，先写点内容', 'error')
      return
    }
    setInput('')
    const sentText = doc.text
    setMessages(list => [...list, { role: 'user', content: instruction }])
    setBusy(true)
    setProgress(0)
    setPhase('')
    try {
      let value
      const useChunks = chunked && doc.text.length > LONG_TEXT_CHUNK_THRESHOLD
      if (useChunks) {
        const chunks = splitMarkdownChunks(doc.text, 3200)
        if (chunks.length === 0) throw Object.assign(new Error('文章为空，无法分段'), { code: 'text-required' })
        if (chunks.length > 8) throw Object.assign(new Error(`文章会拆成 ${chunks.length} 段，超过 8 段上限；先手动拆成几篇再改`), { code: 'too-many-chunks' })
        const rewritten = []
        for (let index = 0; index < chunks.length; index += 1) {
          setPhase(`第 ${index + 1}/${chunks.length} 段改写中`)
          const part = await callHost('aiEdit', {
            instruction: `${instruction}\n\n（这是全文第 ${index + 1}/${chunks.length} 段。只改写这一段，保持 Markdown 结构；不要输出 design；不要添加原文没有的事实。）`,
            text: chunks[index],
            title: doc.meta.title,
            design: doc.design,
            meta: { author: doc.meta.author, digest: doc.meta.digest },
            history: [],
          }, { timeoutMs: 150000 })
          if (typeof part.text !== 'string' || part.text.trim() === '') {
            throw Object.assign(new Error(`第 ${index + 1} 段没有返回改写结果，已取消，正文未改。`), { code: 'chunk-missing' })
          }
          rewritten.push(part.text.trim())
        }
        value = { reply: `分段改写完成（${chunks.length} 段），版式未改。`, text: rewritten.join('\n\n') }
      } else {
        setPhase('模型生成中')
        value = await callHostStream('aiEditStream', {
          instruction,
          text: doc.text,
          title: doc.meta.title,
          design: doc.design,
          meta: { author: doc.meta.author, digest: doc.meta.digest },
          history: messages.slice(-6).map(message => ({ role: message.role === 'assistant' ? 'assistant' : 'user', content: message.content })),
        }, { timeoutMs: 150000, onProgress: chars => setProgress(chars) })
      }

      const applied = []
      const current = store.doc
      const typedMeanwhile = typeof value.text === 'string' && current.text !== sentText
      const nextText = typeof value.text === 'string' && value.text.trim() !== '' && value.text !== current.text && !typedMeanwhile
        ? value.text
        : undefined
      let nextDesign
      if (value.design && typeof value.design === 'object') {
        const theme = THEMES.find(entry => entry.id === value.design.themeId)
        const themeId = theme === undefined ? current.design.themeId : theme.id
        const variant = theme === undefined
          ? current.design.variantId
          : theme.variants.some(entry => entry.id === value.design.variantId) ? value.design.variantId : theme.variants[0].id
        const themeChanged = theme !== undefined && theme.id !== current.design.themeId
        nextDesign = {
          themeId,
          variantId: variant,
          overrides: themeChanged
            ? (value.design.overrides ?? {})
            : { ...(current.design.overrides ?? {}), ...(value.design.overrides ?? {}) },
        }
      }
      const nextMeta = value.meta && typeof value.meta === 'object' ? { ...current.meta, ...value.meta } : undefined
      if (nextText !== undefined) applied.push('正文')
      if (nextDesign !== undefined) applied.push('版式')
      if (nextMeta !== undefined) applied.push('标题/摘要')
      if (applied.length > 0) {
        store.updateDoc(state => ({
          ...state,
          ...(nextText === undefined ? {} : { text: nextText }),
          ...(nextDesign === undefined ? {} : { design: nextDesign }),
          ...(nextMeta === undefined ? {} : { meta: nextMeta }),
        }))
      }
      if (typedMeanwhile) applied.push('正文有改动，未覆盖')
      setMessages(list => [...list, {
        role: 'assistant',
        content: value.reply || '已修改',
        applied,
        canUndo: applied.length > 0,
        model: value.model?.model ?? '',
        parseError: value.parseError === true,
      }])
      if (applied.length > 0) toast(`AI 已修改：${applied.join('、')}`, 'success')
    } catch (error) {
      setMessages(list => [...list, { role: 'error', content: error.message || '修改失败', code: error.code }])
    } finally {
      setBusy(false)
      setPhase('')
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }

  const suggestions = ['按内容重新精排', '标题更有冲击力', '第二段压缩到两行', '换成杂志版式', '加一个小节标题', '行距调到 1.9']

  return h('div', { className: 'ws-chat' },
    h('div', { className: 'ws-card-head' },
      h(Icon, { name: 'chat', size: 14 }),
      h('span', null, 'AI 对话修改'),
      h('span', { className: 'ws-badge' }, busy ? '修改中' : '走当前默认模型'),
    ),
    messages.length === 0
      ? h('div', { className: 'ws-chat-empty' },
        h('p', null, '直接说想怎么改，AI 会改正文、换主题或调版式，改完可以撤销。'),
        h('div', { className: 'ws-chips' },
          suggestions.map(text => h('button', {
            key: text,
            type: 'button',
            className: 'ws-chip',
            onClick: () => send(text),
          }, text)),
        ),
      )
      : h('div', { className: 'ws-chat-list', ref: listRef },
        messages.map((message, index) => h('div', { key: index, className: 'ws-msg ' + message.role },
          h('div', { className: 'ws-msg-body' }, message.content),
          message.role === 'error' && (message.code === 'model-failed' || message.code === 'ai-timeout' || message.code === 'response-truncated')
            ? h('div', { className: 'ws-msg-model' }, '可以缩小改动范围再试一次；连续失败就去「设置 → 模型」检查当前默认模型。')
            : null,
          message.applied && message.applied.length > 0
            ? h('div', { className: 'ws-msg-tags' },
              message.applied.map(tag => h('span', { key: tag, className: 'ws-msg-tag' }, tag)),
              h('button', {
                type: 'button',
                className: 'ws-link',
                onClick: () => { store.undo(); toast('已撤销这次修改') },
              }, '撤销'),
            )
            : null,
          message.model ? h('div', { className: 'ws-msg-model' }, message.model) : null,
          message.parseError ? h('div', { className: 'ws-msg-model' }, '模型没有按结构返回，只显示了说明') : null,
        )),
        busy ? h('div', { className: 'ws-msg assistant typing' },
          h('span', { className: 'ws-typing-dot' }), h('span', { className: 'ws-typing-dot' }), h('span', { className: 'ws-typing-dot' }),
          h('span', { className: 'ws-msg-body' }, progress > 0 ? `模型已生成 ${progress} 字…` : (phase === '' ? '正在按你的要求修改…' : phase)),
        ) : null,
      ),
    doc.text.length > LONG_TEXT_CHUNK_THRESHOLD
      ? h('div', { className: 'ws-chat-compose-option' },
        h(Toggle, {
          label: `长文分段改写（约 ${splitMarkdownChunks(doc.text, 3200).length} 段，只改正文）`,
          checked: chunked,
          onChange: setChunked,
        }),
        chunked ? h('p', { className: 'ws-hint' }, '会按小节拆成多段分别调用模型，耗时和费用更高；版式不会变。') : null,
      )
      : null,
    h('div', { className: 'ws-chat-compose' },
      h('textarea', {
        ref: inputRef,
        className: 'ws-input ws-textarea',
        rows: 2,
        value: input,
        placeholder: '说一句想怎么改，例如：把标题改短一点，第二段压到两行',
        onChange: event => setInput(event.target.value),
        onKeyDown: event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent?.isComposing && event.keyCode !== 229) {
            event.preventDefault()
            send()
          }
        },
      }),
      h('div', { className: 'ws-row' },
        h(Button, { variant: 'primary', disabled: busy || input.trim() === '', onClick: () => send() }, busy ? '修改中…' : '发送'),
        h('span', { className: 'ws-hint' }, 'Enter 发送，Shift+Enter 换行'),
      ),
    ),
    messages.length > 0
      ? h('div', { className: 'ws-chips' }, suggestions.slice(0, 4).map(text => h('button', {
        key: text,
        type: 'button',
        className: 'ws-chip',
        onClick: () => send(text),
      }, text)))
      : null,
    h('p', { className: 'ws-hint' }, '模型是当前会话的默认模型；要求改版式时只动主题与装饰，不会重写正文。'),
  )
}

function ThemeSection(props) {
  const { store, design, analysis, doc, toast, autoRefine, setAutoRefine, refining, onRefineNow } = props
  const activeTheme = THEMES.find(theme => theme.id === design.themeId) ?? THEMES[0]
  const applyTheme = (theme) => {
    store.updateDoc(current => ({
      ...current,
      design: {
        themeId: theme.id,
        variantId: theme.variants[0].id,
        overrides: {
          eyebrow: current.design?.overrides?.eyebrow ?? analysis.label,
          showEyebrow: ['eyebrow', 'tag', 'centered', 'kicker'].includes(theme.variants[0].titleStyle),
        },
      },
    }))
  }
  const setVariant = (variantId) => store.updateDesign(current => ({ ...current, variantId }))
  const setAccent = (accent) => store.updateDesign(current => ({
    ...current,
    overrides: { ...(current.overrides ?? {}), accent },
  }))

  return h('div', { className: 'ws-sections' },
    h('div', { className: 'ws-card ws-analyze' },
      h('div', { className: 'ws-card-head' },
        h(Icon, { name: 'sparkles', size: 14 }),
        h('span', null, '内容分析'),
        h('span', { className: 'ws-badge' }, analysis.label),
      ),
      h('ul', { className: 'ws-reasons' },
        analysis.reasons.slice(0, 3).map((reason, index) => h('li', { key: index }, reason)),
        h('li', { key: 'current' }, `当前使用「${design.themeName}」·「${design.variantName}」`),
      ),
      h('p', { className: 'ws-hint' }, '这份分析只看标题、结构、关键词与篇幅，不联网，也不改动你的正文。'),
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' }, h('span', null, '自动编排')),
      h('p', { className: 'ws-hint' }, '粘贴或上传文档后，先本地按内容套一版（不联网、立即出效果），随后可让 AI 再精排一次。'),
      h(Toggle, { label: '粘贴 / 上传后让 AI 精排', checked: autoRefine, onChange: setAutoRefine }),
      h(Button, { onClick: onRefineNow, disabled: refining }, refining ? 'AI 正在精排…' : '现在就 AI 精排'),
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' }, h('span', null, '主题库'), h('span', { className: 'ws-group-note' }, `${THEMES.reduce((count, entry) => count + entry.variants.length, 0)} 个版式`)),
      h('div', { className: 'ws-themes' },
        THEMES.map(theme => h('button', {
          key: theme.id,
          type: 'button',
          className: 'ws-theme' + (theme.id === activeTheme.id ? ' on' : ''),
          onClick: () => applyTheme(theme),
        },
        h('span', { className: 'ws-theme-swatch', style: { background: theme.palette.bg, borderColor: theme.palette.border } },
          h('i', { style: { background: theme.palette.text } }),
          h('i', { style: { background: theme.palette.accent } }),
          h('i', { style: { background: theme.palette.accentSoft } }),
        ),
        h('span', { className: 'ws-theme-meta' },
          h('span', { className: 'ws-theme-name' }, theme.name),
          h('span', { className: 'ws-theme-tag' }, theme.tagline.slice(0, 14)),
        ),
        ),
        ),
      ),
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' }, h('span', null, '版式变体')),
      h('div', { className: 'ws-chips' },
        activeTheme.variants.map(variant => h('button', {
          key: variant.id,
          type: 'button',
          className: 'ws-chip' + (variant.id === design.variantId ? ' on' : ''),
          onClick: () => setVariant(variant.id),
        }, variant.name)),
      ),
      h('p', { className: 'ws-hint' }, activeTheme.tagline),
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' }, h('span', null, '主色')),
      h('div', { className: 'ws-swatches' },
        ACCENT_SWATCHES.map(color => h('button', {
          key: color,
          type: 'button',
          className: 'ws-swatch' + (color.toLowerCase() === design.colors.accent.toLowerCase() ? ' on' : ''),
          style: { background: color },
          title: color,
          onClick: () => setAccent(color),
        })),
        h('label', { className: 'ws-swatch ws-swatch-custom', title: '自定义颜色' },
          h('input', { type: 'color', value: design.colors.accent, onChange: event => setAccent(event.target.value) }),
          h(Icon, { name: 'plus', size: 12 }),
        ),
      ),
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' }, h('span', null, '话题标签')),
      h('input', {
        className: 'ws-input',
        value: doc.design?.overrides?.eyebrow ?? '',
        placeholder: '例如：科技 / 生活 / 深度',
        onChange: event => store.updateDesign(current => ({
          ...current,
          overrides: { ...(current.overrides ?? {}), eyebrow: event.target.value },
        })),
      }),
      h('p', { className: 'ws-hint' }, '显示在标题上方的标签位：封面、环形与居中版式会用到。'),
    ),
  )
}

function formatSlider(value) {
  if (typeof value !== 'number') return String(value)
  return Number.isInteger(value) ? String(value) : value.toFixed(value < 0.1 ? 3 : 2)
}

function TypeSection(props) {
  const { store, design, toast } = props
  const set = (patch) => store.updateDesign(current => ({ ...current, overrides: { ...(current.overrides ?? {}), ...patch } }))
  const rows = [
    { key: 'titleSize', label: '标题字号', value: design.type.titleSize, min: 20, max: 40, step: 1, unit: 'px' },
    { key: 'bodySize', label: '正文字号', value: design.type.bodySize, min: 13, max: 20, step: 0.5, unit: 'px' },
    { key: 'lineHeight', label: '正文行高', value: design.type.lineHeight, min: 1.5, max: 2.4, step: 0.05, unit: '' },
    { key: 'letterSpacing', label: '字间距', value: design.type.letterSpacing, min: 0, max: 0.06, step: 0.005, unit: 'em' },
    { key: 'paraGap', label: '段间距', value: design.type.paraGap, min: 10, max: 40, step: 1, unit: 'px' },
    { key: 'paddingX', label: '左右留白', value: design.layout.paddingX, min: 8, max: 28, step: 1, unit: 'px' },
  ]
  const reset = () => {
    store.updateDesign(current => ({ themeId: current.themeId, variantId: current.variantId, overrides: {} }))
    toast('已恢复当前主题的默认排版')
  }
  return h('div', { className: 'ws-sections' },
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' }, h('span', null, '字号与节奏'), h('button', { type: 'button', className: 'ws-link', onClick: reset }, '恢复默认')),
      rows.map(row => h('div', { key: row.key, className: 'ws-slider-row' },
        h('span', { className: 'ws-slider-label' }, row.label),
        h('input', {
          type: 'range',
          'aria-label': row.label,
          min: row.min,
          max: row.max,
          step: row.step,
          value: row.value,
          onChange: event => set({ [row.key]: Number(event.target.value) }),
        }),
        h('span', { className: 'ws-slider-value' }, formatSlider(row.value) + row.unit),
      )),
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' }, h('span', null, '阅读体验')),
      h('ul', { className: 'ws-checklist' },
        h('li', null, `正文 ${design.type.bodySize}px，在手机上大约每行 ${Math.round(300 / design.type.bodySize)} 个字`),
        h('li', null, `行高 ${design.type.lineHeight}，段间距 ${design.type.paraGap}px`),
        h('li', null, '字号超过 17px 后，列表和图片建议同步放大'),
      ),
    ),
  )
}

const DECOR_OPTIONS = {
  titleStyle: [
    ['rule', '通栏细线'], ['ribbon', '色块标题'], ['tag', '标签 + 标题'], ['boxed', '边框卡片'],
    ['vertical', '左侧竖线'], ['underline', '下划短线'], ['centered', '居中 + 短线'], ['eyebrow', '眉标 + 大标题'],
  ],
  sectionStyle: [
    ['bar', '左侧色条'], ['tag', '色块标签'], ['numbered', '章节编号'], ['line', '居中细线'], ['dot', '圆点'], ['ghost', '大号数字'],
  ],
  quoteStyle: [
    ['bar', '左侧竖线'], ['card', '卡片'], ['center', '居中引号'], ['tint', '浅色底'], ['stamp', '描边摘录'],
  ],
  dividerStyle: [
    ['dots', '三点'], ['diamond', '菱形'], ['ornament', '花饰'], ['line', '细线'], ['dash', '虚线'], ['none', '留白'],
  ],
  listStyle: [
    ['dot', '圆点'], ['num', '序号'], ['square', '方块'], ['arrow', '箭头'],
  ],
  imageStyle: [
    ['plain', '直角'], ['rounded', '圆角'], ['shadow', '投影'], ['frame', '细框'], ['polaroid', '拍立得'], ['full', '通栏出血'],
  ],
}

function DecorSection(props) {
  const { store, design, toast } = props
  const set = (patch) => store.updateDesign(current => ({ ...current, overrides: { ...(current.overrides ?? {}), ...patch } }))
  const resetDecor = () => {
    store.updateDesign(current => ({ themeId: current.themeId, variantId: current.variantId, overrides: {} }))
    toast('已恢复主题默认装饰')
  }
  const surface = design.surface ?? { bg: design.themeBg, pattern: 'none', ornament: 'none' }
  const bgValue = surface.bg === design.themeBg ? '' : surface.bg
  return h('div', { className: 'ws-sections' },
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' }, h('span', null, '背景与图形')),
      h('div', { className: 'ws-bg-row' },
        BG_CHOICES.map(([value, label]) => h('button', {
          key: label,
          type: 'button',
          className: 'ws-bg-swatch' + (bgValue === value ? ' on' : ''),
          title: label,
          style: { background: value === '' ? design.themeBg : value },
          onClick: () => set({ bg: value === '' ? null : value }),
        })),
      ),
      h('label', { className: 'ws-field' },
        h('span', { className: 'ws-field-label' }, '底纹'),
        h('select', { className: 'ws-input', value: surface.pattern, onChange: event => set({ bgStyle: event.target.value }) },
          BG_PATTERNS.map(([value, label]) => h('option', { key: value, value }, label))),
      ),
      h('label', { className: 'ws-field' },
        h('span', { className: 'ws-field-label' }, '矢量角标'),
        h('select', { className: 'ws-input', value: surface.ornament, onChange: event => set({ ornament: event.target.value }) },
          ORNAMENTS.map(([value, label]) => h('option', { key: value, value }, label))),
      ),
      h('div', { className: 'ws-hint' }, '底纹与角标都会写进复制/发布的 HTML；深色背景会自动换成浅色文字。'),
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' }, h('span', null, '形状与装饰'), h('button', { type: 'button', className: 'ws-link', onClick: resetDecor }, '恢复默认')),
      Object.entries(DECOR_OPTIONS).map(([key, options]) => h('label', { key, className: 'ws-field' },
        h('span', { className: 'ws-field-label' }, ({
          titleStyle: '标题样式', sectionStyle: '章节样式', quoteStyle: '引用样式',
          dividerStyle: '分割线', listStyle: '列表符号', imageStyle: '图片样式',
        })[key]),
        h('select', {
          className: 'ws-input',
          value: design.decor[key],
          onChange: event => set({ [key]: event.target.value }),
        }, options.map(([value, label]) => h('option', { key: value, value }, label))),
      )),
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' }, h('span', null, '图片')),
      h('label', { className: 'ws-field' },
        h('span', { className: 'ws-field-label' }, '宽度'),
        h('select', { className: 'ws-input', value: String(design.decor.imageWidth), onChange: event => set({ imageWidth: Number(event.target.value) }) },
          [['100', '通栏'], ['85', '大图'], ['70', '中等'], ['50', '小图']].map(([value, label]) => h('option', { key: value, value }, label))),
      ),
      h('label', { className: 'ws-field' },
        h('span', { className: 'ws-field-label' }, '对齐'),
        h('select', { className: 'ws-input', value: design.decor.imageAlign, onChange: event => set({ imageAlign: event.target.value }) },
          [['center', '居中'], ['left', '左对齐'], ['right', '右对齐']].map(([value, label]) => h('option', { key: value, value }, label))),
      ),
      h('p', { className: 'ws-hint' }, '图片样式选「通栏」时会忽略宽度。悬停图片可以点工具条里的图标换图。'),
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' }, h('span', null, '显示项')),
      h(Toggle, { label: '标题下方显示作者与日期', checked: design.decor.showMeta, onChange: value => set({ showMeta: value }) }),
      h(Toggle, { label: '话题标签', checked: design.decor.showEyebrow, onChange: value => set({ showEyebrow: value }) }),
      h(Toggle, { label: '首段作为导语放大', checked: design.decor.lead, onChange: value => set({ lead: value }) }),
      h(Toggle, { label: '显示文末引导', checked: design.decor.showFooter, onChange: value => set({ showFooter: value }) }),
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' }, h('span', null, '文末签名')),
      h('textarea', {
        className: 'ws-input ws-textarea',
        rows: 2,
        value: design.decor.footerText,
        onChange: event => set({ footerText: event.target.value }),
        placeholder: '写给读者的结束语',
      }),
      h('input', {
        className: 'ws-input',
        value: design.decor.footerSign,
        placeholder: '署名，例如：文 / 张三',
        onChange: event => set({ footerSign: event.target.value }),
      }),
    ),
  )
}

/* ------------------------------------------------------------------ *
 * Publish flow
 * ------------------------------------------------------------------ */

function PublishSection(props) {
  const { store, design, doc, parsed, features, hostStatus, setHostStatus, toast } = props
  const [configOpen, setConfigOpen] = React.useState(false)
  const [appId, setAppId] = React.useState('')
  const [appSecret, setAppSecret] = React.useState('')
  const [configBusy, setConfigBusy] = React.useState(false)
  const [steps, setSteps] = React.useState([])
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState(null)
  const [error, setError] = React.useState(null)
  const [confirmPublish, setConfirmPublish] = React.useState(false)
  const [coverBusy, setCoverBusy] = React.useState(false)
  const [draftBox, setDraftBox] = React.useState({ phase: 'idle', items: [], error: '' })
  const [draftBusy, setDraftBusy] = React.useState(false)
  const [deleteArm, setDeleteArm] = React.useState('')
  const deleteArmTimer = React.useRef(undefined)
  React.useEffect(() => () => clearTimeout(deleteArmTimer.current), [])
  const coverInputRef = React.useRef(null)
  const title = (doc.meta.title.trim() || parsed.title || '').trim()
  const author = doc.meta.author.trim()
  const digest = doc.meta.digest.trim() || deriveDigest(parsed.blocks)
  const coverDataUrl = doc.meta.coverDataUrl || ''

  React.useEffect(() => {
    // Keep the generated cover in step with the current theme; a cover the user
    // uploaded themselves stays untouched.
    if (doc.meta.coverCustom === true) return
    try {
      const generated = renderCover({ title, design })
      if (generated !== coverDataUrl) store.updateMeta({ coverDataUrl: generated })
    } catch {
      // Canvas may be unavailable in unusual embedders; the publish step reports it.
    }
  }, [title, design.themeId, design.variantId, design.colors.accent, coverDataUrl, doc.meta.coverCustom])

  const regenerateCover = () => {
    try {
      store.updateMeta({ coverDataUrl: renderCover({ title, design }), coverCustom: false })
      toast('已按新主题重绘封面')
    } catch (failure) {
      toast(failure.message || '封面生成失败', 'error')
    }
  }

  const uploadCoverFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setCoverBusy(true)
    try {
      const dataUrl = await readFileAsDataUrl(file)
      const cropped = await cropToCover(dataUrl)
      store.updateMeta({ coverDataUrl: cropped, coverCustom: true })
      toast('已换成你上传的封面', 'success')
    } catch (failure) {
      toast(failure.message || '封面处理失败', 'error')
    } finally {
      setCoverBusy(false)
    }
  }

  const saveConfig = async () => {
    setConfigBusy(true)
    try {
      const value = await callHost('saveConfig', { appId: appId.trim(), appSecret: appSecret.trim() })
      setHostStatus({ phase: 'ready', configured: value.configured === true, appIdPreview: value.appIdPreview ?? null, message: '' })
      setConfigOpen(false)
      setAppId('')
      setAppSecret('')
      toast('公众号密钥已保存到本机凭据库', 'success')
    } catch (failure) {
      toast(failure.message || '保存失败', 'error')
    } finally {
      setConfigBusy(false)
    }
  }

  const testConnection = async () => {
    setConfigBusy(true)
    try {
      const value = await callHost('testConnection')
      toast(`连接成功，access_token 有效 ${Math.round((value.expiresIn ?? 7200) / 60)} 分钟`, 'success')
    } catch (failure) {
      toast(failure.message || '连接失败', 'error')
    } finally {
      setConfigBusy(false)
    }
  }

  const clearConfig = async () => {
    setConfigBusy(true)
    try {
      await callHost('clearConfig')
      setHostStatus({ phase: 'ready', configured: false, appIdPreview: null, message: '' })
      toast('已清除本机保存的公众号密钥')
    } catch (failure) {
      toast(failure.message || '清除失败', 'error')
    } finally {
      setConfigBusy(false)
    }
  }

  const loadDrafts = async () => {
    setDraftBusy(true)
    try {
      const value = await callHost('listDrafts', { count: 10 })
      setDraftBox({ phase: 'ready', items: Array.isArray(value.items) ? value.items : [], error: '' })
    } catch (failure) {
      setDraftBox({ phase: 'error', items: [], error: failure.message || '读取草稿箱失败' })
    } finally {
      setDraftBusy(false)
    }
  }

  const removeDraft = async (mediaId) => {
    if (deleteArm !== mediaId) {
      setDeleteArm(mediaId)
      clearTimeout(deleteArmTimer.current)
      deleteArmTimer.current = setTimeout(() => setDeleteArm(''), 4000)
      return
    }
    clearTimeout(deleteArmTimer.current)
    setDeleteArm('')
    try {
      await callHost('deleteDraft', { mediaId })
      setDraftBox(current => ({ ...current, items: current.items.filter(item => item.mediaId !== mediaId) }))
      toast('草稿已删除')
    } catch (failure) {
      toast(failure.message || '删除失败', 'error')
    }
  }

  const runPublish = async (mode) => {
    if (hasUnresolvedImageRefs(doc.text)) { toast('正文图片还在从本地图库读取，等一秒再发布。', 'error'); return }
    if (title === '') { toast('先填文章标题', 'error'); return }
    setBusy(true)
    setConfirmPublish(false)
    setResult(null)
    setError(null)
    setSteps([])
    const push = (label, state, detail) => setSteps(list => [...list, { label, state, detail }])

    try {
      if (!hostStatus.configured) {
        throw Object.assign(new Error('还没有配置公众号 AppID / AppSecret'), { code: 'not-configured' })
      }
      push('检查公众号配置', 'done')

      const tree = buildArticle({
        blocks: parsed.blocks,
        design,
        meta: { title, author, date: formatDate(doc.updatedAt), readingMinutes: features.readingMinutes },
      })
      const dataImages = collectDataImages(tree.nodes)
      const remoteImages = collectRemoteImages(tree.nodes)
      if (dataImages.length > 0) {
        push(`压缩并上传正文图片（${dataImages.length} 张）`, 'running')
        // The WeChat CDN caps content images at 1 MiB, so re-encode locally and
        // keep the original data URL as the rewrite key.
        const prepared = []
        const originalById = new Map()
        for (let index = 0; index < dataImages.length; index += 1) {
          const original = dataImages[index]
          const id = `img-${index}`
          const compressed = await compressImage(original)
          prepared.push({ id, dataUrl: compressed.dataUrl, name: `image-${index}.jpg` })
          originalById.set(id, original)
        }
        const value = await callHost('uploadImages', { images: prepared }, { timeoutMs: 180000 })
        const mapping = new Map()
        for (const entry of value.images ?? []) {
          const original = originalById.get(entry.id)
          if (original && entry.url) mapping.set(original, entry.url)
        }
        rewriteImageSources(tree.nodes, mapping)
        setSteps(list => list.map((step, index) => (index === list.length - 1 ? { ...step, state: 'done' } : step)))
      }
      if (remoteImages.length > 0) {
        push(`转存外链图片（${remoteImages.length} 张）`, 'running')
        const value = await callHost('importImages', { urls: remoteImages }, { timeoutMs: 180000 })
        const mapping = new Map()
        for (const entry of value.images ?? []) {
          if (entry.url && entry.wechatUrl) mapping.set(entry.url, entry.wechatUrl)
        }
        rewriteImageSources(tree.nodes, mapping)
        setSteps(list => list.map((step, index) => (index === list.length - 1 ? { ...step, state: 'done' } : step)))
      }

      const html = serializeNodes(tree.nodes)
      if (html.length > 950 * 1024) throw Object.assign(new Error('正文 HTML 超过 950KB，删掉几张图或缩短正文后再试'), { code: 'content-too-large' })
      push('生成内联样式正文', 'done', `${Math.round(html.length / 1024)}KB`)

      push('上传封面到素材库', 'running')
      const cover = coverDataUrl || renderCover({ title, design })
      const coverValue = await callHost('uploadCover', { dataUrl: cover, name: 'cover.png' }, { timeoutMs: 120000 })
      setSteps(list => list.map((step, index) => (index === list.length - 1 ? { ...step, state: 'done', detail: coverValue.mediaId } : step)))

      push('写入公众号草稿箱', 'running')
      const draft = await callHost('createDraft', {
        title,
        author: author === '' ? undefined : author,
        digest,
        content: html,
        thumbMediaId: coverValue.mediaId,
        contentSourceUrl: doc.meta.sourceUrl.trim() || undefined,
        needOpenComment: doc.meta.needOpenComment === true,
        onlyFansCanComment: doc.meta.needOpenComment === true && doc.meta.onlyFansCanComment === true,
      }, { timeoutMs: 120000 })
      const warnings = Array.isArray(draft.warnings) ? draft.warnings : []
      setSteps(list => list.map((step, index) => (index === list.length - 1 ? { ...step, state: 'done', detail: warnings.join('；') || draft.mediaId } : step)))
      setResult({ kind: 'draft', mediaId: draft.mediaId, warnings })

      if (mode === 'publish') {
        push('提交发布', 'running')
        const published = await callHost('publish', { mediaId: draft.mediaId }, { timeoutMs: 120000 })
        setSteps(list => list.map((step, index) => (index === list.length - 1 ? { ...step, state: 'done', detail: published.publishId } : step)))
        let status = null
        try {
          for (let attempt = 0; attempt < 6; attempt += 1) {
            await new Promise(resolve => setTimeout(resolve, 2500))
            status = await callHost('publishStatus', { publishId: published.publishId })
            if (status.publishStatus !== 1) break
          }
        } catch {
          // The submission already succeeded; only the readback failed.
          status = { publishStatus: -1, statusText: '状态查询失败，发布可能仍在继续，稍后到公众号后台确认' }
        }
        setResult({ kind: 'published', mediaId: draft.mediaId, publishId: published.publishId, status })
        push(
          '发布结果',
          status?.publishStatus === 0 || status?.publishStatus === 1 ? 'done' : status?.publishStatus === -1 ? 'running' : 'error',
          status?.statusText ?? '状态未知',
        )
      }
      toast(mode === 'publish' ? '已提交发布，结果见下方状态' : '已保存到公众号草稿箱', 'success')
    } catch (failure) {
      setError({ message: failure.message || '发布失败', code: failure.code })
      toast(failure.message || '发布失败', 'error')
      setSteps(list => list.map((step, index) => (index === list.length - 1 && step.state === 'running' ? { ...step, state: 'error' } : step)))
    } finally {
      setBusy(false)
    }
  }

  return h('div', { className: 'ws-sections' },
    h('div', { className: 'ws-card' },
      h('div', { className: 'ws-card-head' },
        h(Icon, { name: 'key', size: 14 }),
        h('span', null, '公众号配置'),
        h('span', { className: 'ws-badge ' + (hostStatus.configured ? 'ok' : '') }, hostStatus.configured ? '已连接' : hostStatus.phase === 'error' ? '服务未响应' : '未配置'),
      ),
      hostStatus.phase === 'error'
        ? h('p', { className: 'ws-hint danger' }, hostStatus.message)
        : null,
      hostStatus.configured
        ? h('p', { className: 'ws-hint' }, `AppID：${hostStatus.appIdPreview ?? '（已保存）'}。密钥只在本机凭据库，页面拿不到明文。`)
        : h('p', { className: 'ws-hint' }, '在公众号后台「设置与开发 → 基本配置」拿到 AppID 与 AppSecret。还需要把本机出口 IP 加进白名单。'),
      configOpen
        ? h('div', { className: 'ws-config' },
          h('label', { className: 'ws-field' }, h('span', { className: 'ws-field-label' }, 'AppID'), h('input', { className: 'ws-input', value: appId, placeholder: 'wx 开头的一串字符', onChange: event => setAppId(event.target.value) })),
          h('label', { className: 'ws-field' }, h('span', { className: 'ws-field-label' }, 'AppSecret'), h('input', { className: 'ws-input', type: 'password', value: appSecret, placeholder: '32 位密钥，保存后不再显示', onChange: event => setAppSecret(event.target.value) })),
          h('div', { className: 'ws-row' },
            h(Button, { variant: 'primary', disabled: configBusy || appId.trim() === '' || appSecret.trim() === '', onClick: saveConfig }, configBusy ? '保存中…' : '保存'),
            h(Button, { onClick: () => setConfigOpen(false) }, '取消'),
          ),
        )
        : h('div', { className: 'ws-row' },
          h(Button, { variant: hostStatus.configured ? 'ghost' : 'primary', onClick: () => setConfigOpen(true), disabled: hostStatus.phase === 'error' }, hostStatus.configured ? '更新密钥' : '填写密钥'),
          hostStatus.configured ? h(Button, { onClick: testConnection, disabled: configBusy }, configBusy ? '测试中…' : '测试连接') : null,
          hostStatus.configured ? h(Button, { onClick: clearConfig, disabled: configBusy, variant: 'ghost' }, '清除') : null,
        ),
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' }, h('span', null, '文章信息'), h('span', { className: 'ws-group-note' }, `标题 ${title.length}/64 · 摘要 ${digest.length}/120`)),
      h('label', { className: 'ws-field' }, h('span', { className: 'ws-field-label' }, '标题'), h('input', { className: 'ws-input', value: doc.meta.title, placeholder: title || '文章标题', maxLength: 64, onChange: event => store.updateMeta({ title: event.target.value }) })),
      h('label', { className: 'ws-field' }, h('span', { className: 'ws-field-label' }, '公众号名称'), h('input', { className: 'ws-input', value: doc.meta.brand ?? '', placeholder: '预览顶栏显示；留空显示“公众号”', maxLength: 30, onChange: event => store.updateMeta({ brand: event.target.value }) })),
      h('label', { className: 'ws-field' }, h('span', { className: 'ws-field-label' }, '作者'), h('input', { className: 'ws-input', value: doc.meta.author, placeholder: '留空则用公众号主体名', maxLength: 8, onChange: event => store.updateMeta({ author: event.target.value }) })),
      h('label', { className: 'ws-field' }, h('span', { className: 'ws-field-label' }, '摘要'), h('textarea', { className: 'ws-input ws-textarea', rows: 2, value: doc.meta.digest, placeholder: digest || '留空自动取首段', maxLength: 120, onChange: event => store.updateMeta({ digest: event.target.value }) })),
      h('label', { className: 'ws-field' }, h('span', { className: 'ws-field-label' }, '原文链接'), h('input', { className: 'ws-input', value: doc.meta.sourceUrl, placeholder: '可选，https://', onChange: event => store.updateMeta({ sourceUrl: event.target.value }) })),
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' }, h('span', null, '发布选项')),
      h(Toggle, {
        label: '允许读者评论',
        checked: doc.meta.needOpenComment === true,
        onChange: value => store.updateMeta(value ? { needOpenComment: true } : { needOpenComment: false, onlyFansCanComment: false }),
      }),
      doc.meta.needOpenComment === true
        ? h(Toggle, {
          label: '仅关注者可评论',
          checked: doc.meta.onlyFansCanComment === true,
          onChange: value => store.updateMeta({ onlyFansCanComment: value }),
        })
        : null,
      h('p', { className: 'ws-hint' }, '评论设置会写进草稿；公众号后台仍可再改。'),
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' }, h('span', null, '封面（2.35:1）'), h('span', { className: 'ws-group-note' }, doc.meta.coverCustom === true ? '当前是自定义封面' : '自动按主题生成')),
      coverDataUrl !== ''
        ? h('img', { className: 'ws-cover', src: coverDataUrl, alt: '封面预览' })
        : h('div', { className: 'ws-cover ws-cover-empty' }, '封面生成中…'),
      h('div', { className: 'ws-row' },
        h(Button, { onClick: regenerateCover, disabled: coverBusy }, '按主题重绘'),
        h(Button, { onClick: () => coverInputRef.current?.click(), disabled: coverBusy }, coverBusy ? '处理中…' : '上传图片'),
        h('input', { ref: coverInputRef, type: 'file', accept: 'image/*', style: { display: 'none' }, onChange: uploadCoverFile }),
      ),
    ),
    h('div', { className: 'ws-publish-actions' },
      h(Button, { icon: 'save', variant: 'primary', disabled: busy || hostStatus.phase === 'error', onClick: () => runPublish('draft') }, busy ? '处理中…' : '保存到草稿箱'),
      confirmPublish
        ? h('div', { className: 'ws-confirm' },
          h('span', null, '直接发布会占用当天发布次数，确认？'),
          h(Button, { variant: 'danger', onClick: () => runPublish('publish'), disabled: busy }, '确认发布'),
          h(Button, { variant: 'ghost', onClick: () => setConfirmPublish(false) }, '再想想'),
        )
        : h(Button, { icon: 'send', variant: 'solid', disabled: busy || hostStatus.phase === 'error', onClick: () => setConfirmPublish(true) }, '直接发布'),
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' },
        h('span', null, '公众号草稿箱'),
        h('button', { type: 'button', className: 'ws-link', onClick: loadDrafts, disabled: draftBusy || hostStatus.configured !== true }, draftBusy ? '读取中…' : '读取最近 10 篇'),
      ),
      draftBox.phase === 'error' ? h('p', { className: 'ws-hint ws-error-text' }, draftBox.error) : null,
      draftBox.phase === 'ready' && draftBox.items.length === 0 ? h('p', { className: 'ws-hint' }, '草稿箱是空的。') : null,
      draftBox.items.map(item => h('div', { key: item.mediaId, className: 'ws-draft-row' },
        h('div', { className: 'ws-draft-main' },
          h('span', { className: 'ws-draft-title' }, item.title === '' ? '（无标题）' : item.title),
          h('span', { className: 'ws-draft-meta' }, item.updateTime > 0 ? new Date(item.updateTime * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '时间未知'),
        ),
        h('button', { type: 'button', className: 'ws-link danger', onClick: () => removeDraft(item.mediaId) }, deleteArm === item.mediaId ? '确认删除' : '删除'),
      )),
      h('p', { className: 'ws-hint' }, '删除会直接移除公众号后台的草稿，不影响已发布的文章。'),
    ),
    steps.length > 0
      ? h('div', { className: 'ws-steps' }, steps.map((step, index) => h('div', { key: index, className: 'ws-step ' + step.state },
        h('span', { className: 'ws-step-dot' }),
        h('span', { className: 'ws-step-label' }, step.label),
        step.detail ? h('span', { className: 'ws-step-detail' }, step.detail) : null,
      )))
      : null,
    error
      ? h('div', { className: 'ws-error' },
        h('strong', null, error.message),
        error.code === 'ip-not-allowed' ? h('p', null, '打开公众号后台 → 设置与开发 → 基本配置 → IP白名单，加入提示里的 IP 后重试。') : null,
        error.code === 'api-unauthorized' ? h('p', null, '未认证的订阅号通常没有发布接口，改用「保存到草稿箱」或「复制 HTML」。') : null,
        error.code === 'not-configured' ? h('p', null, '先在上方填写 AppID 和 AppSecret。') : null,
      )
      : null,
    result
      ? h('div', { className: 'ws-result' },
        h('strong', null, result.kind === 'published' ? '已提交发布' : '已进入草稿箱'),
        result.kind === 'draft' ? h('p', null, '到公众号后台「内容管理 → 草稿箱」就能看到这篇，手机预览后手动发布。') : null,
        result.kind === 'published'
          ? h('p', null, `发布状态：${result.status?.statusText ?? '发布中，稍后可在后台查看'}`)
          : null,
        result.warnings && result.warnings.length > 0 ? h('p', null, `提示：${result.warnings.join('；')}`) : null,
        h('a', { className: 'ws-link', href: 'https://mp.weixin.qq.com/', target: '_blank', rel: 'noreferrer' }, '打开公众号后台'),
      )
      : null,
  )
}

function deriveDigest(blocks) {
  const first = blocks.find(block => block.type === 'paragraph')
  if (!first) return ''
  const plain = plainText(first.text).replace(/\s+/g, ' ').trim()
  return plain.length > 110 ? `${plain.slice(0, 110)}…` : plain
}

function collectRemoteImages(nodes) {
  const found = []
  const walk = list => {
    for (const current of list) {
      if (typeof current === 'string' || !current) continue
      if (current.tag === 'img') {
        const src = current.attrs?.src
        if (typeof src === 'string' && /^https?:\/\//i.test(src) && !/(mmbiz\.qpic\.cn|mmbiz\.qlogo\.cn|wx\.qlogo\.cn)/i.test(src)) {
          if (!found.includes(src)) found.push(src)
        }
      }
      walk(current.children ?? [])
    }
  }
  walk(nodes)
  return found
}

/* Cover generation ------------------------------------------------- */

function wrapCoverTitle(context, title, maxWidth) {
  const lines = []
  let line = ''
  for (const character of title) {
    const candidate = line + character
    if (context.measureText(candidate).width > maxWidth && line !== '') {
      lines.push(line)
      line = character
    } else {
      line = candidate
    }
    if (lines.length === 3) break
  }
  if (lines.length < 3 && line !== '') lines.push(line)
  if (lines.length === 3 && lines.join('').length < title.length) lines[2] = `${lines[2].slice(0, Math.max(1, lines[2].length - 1))}…`
  return lines
}

function renderCover({ title, design }) {
  const canvas = document.createElement('canvas')
  canvas.width = 900
  canvas.height = 383
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('当前环境无法生成封面')
  const accent = design.colors.accent
  const ink = design.colors.accentInk
  const gradient = context.createLinearGradient(0, 0, 900, 383)
  gradient.addColorStop(0, mixHex(accent, '#000000', 0.05))
  gradient.addColorStop(0.55, accent)
  gradient.addColorStop(1, mixHex(accent, '#000000', 0.42))
  context.fillStyle = gradient
  context.fillRect(0, 0, 900, 383)

  context.globalAlpha = 0.08
  context.fillStyle = ink
  context.beginPath()
  context.arc(760, 90, 150, 0, Math.PI * 2)
  context.fill()
  context.beginPath()
  context.arc(845, 330, 110, 0, Math.PI * 2)
  context.fill()
  context.globalAlpha = 1

  context.strokeStyle = ink
  context.globalAlpha = 0.35
  context.lineWidth = 2
  context.beginPath()
  context.moveTo(64, 118)
  context.lineTo(64 + 44, 118)
  context.stroke()
  context.globalAlpha = 1

  context.fillStyle = ink
  context.globalAlpha = 0.78
  context.font = '600 20px "PingFang SC", "Microsoft YaHei", sans-serif'
  context.fillText(design.decor.eyebrow || design.themeName, 64, 100)
  context.globalAlpha = 1

  const size = title.length > 26 ? 44 : title.length > 16 ? 52 : 58
  context.font = `700 ${size}px "PingFang SC", "Microsoft YaHei", sans-serif`
  const lines = wrapCoverTitle(context, title || '未命名文章', 700)
  const lineHeight = Math.round(size * 1.32)
  const startY = 118 + (3 - lines.length) * lineHeight * 0.5
  context.fillStyle = ink
  lines.forEach((line, index) => {
    context.fillText(line, 64, startY + lineHeight * (index + 1))
  })

  context.globalAlpha = 0.7
  context.font = '400 18px "PingFang SC", "Microsoft YaHei", sans-serif'
  context.fillText(design.themeName + ' · ' + design.variantName, 64, 340)
  context.globalAlpha = 1
  return canvas.toDataURL('image/png')
}

/** Crop any image into the 900x383 cover frame. */
function cropToCover(dataUrl) {
  return loadImage(dataUrl).then(image => {
    const canvas = document.createElement('canvas')
    canvas.width = 900
    canvas.height = 383
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('当前环境无法处理封面')
    const targetRatio = 900 / 383
    const sourceRatio = image.width / image.height
    let sourceWidth = image.width
    let sourceHeight = image.height
    let sourceX = 0
    let sourceY = 0
    if (sourceRatio > targetRatio) {
      sourceWidth = image.height * targetRatio
      sourceX = (image.width - sourceWidth) / 2
    } else {
      sourceHeight = image.width / targetRatio
      sourceY = (image.height - sourceHeight) / 2
    }
    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, 900, 383)
    return canvas.toDataURL('image/jpeg', 0.92)
  })
}

/* ------------------------------------------------------------------ *
 * Primitives
 * ------------------------------------------------------------------ */

function Button({ children, icon, variant = 'default', ...rest }) {
  const className = `ws-btn ${variant}`
  return h('button', { type: 'button', className, ...rest },
    icon ? h(Icon, { name: icon, size: 14 }) : null,
    h('span', null, children),
  )
}

function IconButton({ icon, title, disabled, onClick }) {
  return h('button', { type: 'button', className: 'ws-icon-btn', title, disabled, onClick, 'aria-label': title },
    h(Icon, { name: icon, size: 15 }),
  )
}

function Toggle({ label, checked, onChange }) {
  return h('button', {
    type: 'button',
    className: 'ws-toggle',
    role: 'switch',
    'aria-checked': checked ? 'true' : 'false',
    onClick: () => onChange(!checked),
  },
  h('span', { className: 'ws-toggle-track' + (checked ? ' on' : '') }, h('span', { className: 'ws-toggle-knob' })),
  h('span', { className: 'ws-toggle-label' }, label),
  )
}

function ToastStack({ toasts }) {
  return h('div', { className: 'ws-toasts', role: 'status', 'aria-live': 'polite' },
    toasts.map(entry => h('div', { key: entry.id, className: 'ws-toast ' + entry.kind }, entry.message)),
  )
}

const ICON_PATHS = {
  pen: 'M4 20l4.5-1 9-9a2 2 0 0 0 0-2.8l-.7-.7a2 2 0 0 0-2.8 0l-9 9L4 20z M13 6l5 5',
  sparkles: 'M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z',
  shuffle: 'M4 7h3.5l9 10H20 M4 17h3.5l3-3.4 M14.5 9.5L16.5 7H20 M18 5l2 2-2 2 M18 15l2 2-2 2',
  copy: 'M9 9h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z M15 5H6a2 2 0 0 0-2 2v9',
  send: 'M21 3L10 14 M21 3l-7 18-4-7-7-4 18-7z',
  save: 'M5 3h11l3 3v15H5V3z M8 3v6h8V3 M8 21v-7h8v7',
  download: 'M12 3v12 M7 10l5 5 5-5 M4 21h16',
  upload: 'M12 21V9 M7 14l5-5 5 5 M4 3h16',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 14h10l1-14 M10 11v6 M14 11v6',
  plus: 'M12 5v14 M5 12h14',
  arrowUp: 'M12 19V5 M6 11l6-6 6 6',
  arrowDown: 'M12 5v14 M18 13l-6 6-6-6',
  check: 'M5 12l5 5L20 7',
  close: 'M6 6l12 12 M18 6L6 18',
  undo: 'M9 7L4 12l5 5 M4 12h10a5 5 0 0 1 0 10h-3',
  redo: 'M15 7l5 5-5 5 M20 12H10a5 5 0 0 0 0 10h3',
  panel: 'M4 4h16v16H4z M15 4v16',
  more: 'M6 12h.01 M12 12h.01 M18 12h.01',
  chevron: 'M6 9l6 6 6-6',
  doc: 'M6 3h8l4 4v14H6z M14 3v4h4',
  key: 'M14 7a4 4 0 1 0-3.5 4L4 17v3h3v-2h2v-2h2l2-2a4 4 0 0 0 4-4z',
  image: 'M4 5h16v14H4z M4 15l4-4 4 4 3-3 5 5',
  wand: 'M5 19L17 7 M14 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2z',
  chat: 'M4 5h16v11H9l-5 4V5z M8 9h8 M8 12.5h5',
  palette: 'M12 3a9 9 0 1 0 0 18c1.4 0 2-.9 2-1.7 0-.6-.3-1-.3-1.7 0-1 .8-1.6 1.8-1.6H18a3 3 0 0 0 3-3c0-4.4-4-9-9-9z M7.5 9.5h.01 M10.5 7h.01 M14 7h.01 M16.8 9.7h.01',
}

function Icon({ name, size = 16 }) {
  const path = ICON_PATHS[name] ?? ICON_PATHS.doc
  return h('svg', {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
  }, h('path', { d: path }))
}

/* ------------------------------------------------------------------ *
 * Sidebar icon and stylesheet
 * ------------------------------------------------------------------ */

function StudioSidebarIcon({ size, active }) {
  return h('svg', {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    'aria-hidden': 'true',
  },
  h('rect', { x: 2.2, y: 2.2, width: 19.6, height: 19.6, rx: 6.2, fill: 'currentColor', opacity: active ? 0.2 : 0.1 }),
  h('rect', { x: 3.2, y: 3.2, width: 17.6, height: 17.6, rx: 5.2, stroke: 'currentColor', strokeOpacity: active ? 0.5 : 0.28, strokeWidth: 1 }),
  h('path', { d: 'M8.4 7.6h5.8l2 2v7H8.4z', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' }),
  h('path', { d: 'M10.6 10.8h4 M10.6 13.2h2.8', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeOpacity: 0.7 }),
  h('path', { d: 'M10.6 15.8h4.4', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round' }),
  )
}

const STUDIO_CSS = `
.ws-root{--ws-bg:var(--dsw-alias-bg-base);--ws-surface:var(--dsw-alias-bg-layer-1);--ws-surface2:var(--dsw-alias-bg-layer-2);--ws-border:var(--dsw-alias-border-l1);--ws-border2:var(--dsw-alias-border-l2);--ws-text:var(--dsw-alias-label-primary);--ws-muted:var(--dsw-alias-label-secondary);--ws-brand:var(--dsw-alias-brand-primary);--ws-danger:var(--dsw-alias-state-error-primary);--ws-success:var(--dsw-alias-state-success-primary);height:100%;min-height:0;display:flex;flex-direction:column;background:var(--ws-bg);color:var(--ws-text);font-size:13px;line-height:1.5;-webkit-font-smoothing:antialiased}
.ws-root *{box-sizing:border-box}
.ws-top{flex:none;display:flex;align-items:center;gap:8px;height:52px;padding:0 14px;border-bottom:1px solid var(--ws-border);background:var(--ws-surface);-webkit-app-region:no-drag;app-region:no-drag;padding-left:max(14px, calc(var(--dsh-frame-leading-clearance, 0px) - 60px))}
.ws-brand{display:flex;align-items:center;gap:8px;font-weight:600;font-size:14px;white-space:nowrap;color:var(--ws-text)}
.ws-badge{font-size:11px;font-weight:400;color:var(--ws-muted);border:1px solid var(--ws-border);border-radius:99px;padding:1px 8px;white-space:nowrap;max-width:180px;overflow:hidden;text-overflow:ellipsis}
.ws-badge.ok{color:var(--ws-success);border-color:var(--ws-success)}
.ws-top-spacer{flex:1}
.ws-top-group{display:flex;align-items:center;gap:2px;padding-right:4px;margin-right:2px;border-right:1px solid var(--ws-border)}
.ws-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;padding:0 11px;border-radius:8px;border:1px solid var(--ws-border);background:var(--ws-surface);color:var(--ws-text);font:inherit;font-size:12.5px;cursor:pointer;white-space:nowrap;transition:background .12s,border-color .12s,transform .06s}
.ws-btn:hover:not(:disabled){background:var(--ws-surface2);border-color:var(--ws-border2)}
.ws-btn:active:not(:disabled){transform:translateY(1px)}
.ws-btn:disabled{opacity:.45;cursor:default}
.ws-btn.primary{background:var(--ws-brand);border-color:transparent;color:var(--ws-bg);font-weight:600}
.ws-btn.primary:hover:not(:disabled){filter:brightness(1.05);background:var(--ws-brand)}
.ws-btn.solid{background:var(--ws-text);border-color:transparent;color:var(--ws-bg);font-weight:600}
.ws-btn.solid:hover:not(:disabled){background:var(--ws-text);filter:brightness(1.1)}
.ws-btn.danger{background:var(--ws-danger);border-color:transparent;color:#fff;font-weight:600}
.ws-btn.ghost{background:transparent}
.ws-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:7px;border:0;background:transparent;color:var(--ws-muted);cursor:pointer;padding:0}
.ws-icon-btn:hover:not(:disabled){background:var(--ws-surface2);color:var(--ws-text)}
.ws-icon-btn:disabled{opacity:.35;cursor:default}
.ws-body{flex:1;min-height:0;display:flex;position:relative}
.ws-dragging{outline:2px dashed var(--ws-brand);outline-offset:-8px;background:color-mix(in srgb,var(--ws-brand) 6%,transparent)}
.ws-badge.busy{color:var(--ws-brand);border-color:var(--ws-brand);animation:ws-pulse 1.1s ease-in-out infinite}
.ws-left{flex:0 0 38%;min-width:300px;max-width:540px;display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--ws-border);background:var(--ws-bg)}
.ws-left-head{flex:none;display:flex;align-items:center;gap:6px;padding:10px 12px 6px}
.ws-doc-switch{position:relative;flex:1;min-width:0}
.ws-doc-current{display:flex;align-items:center;gap:7px;width:100%;height:30px;padding:0 9px;border-radius:7px;border:1px solid var(--ws-border);background:var(--ws-surface);color:var(--ws-text);font:inherit;font-size:12.5px;cursor:pointer;text-align:left}
.ws-doc-current span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ws-doc-menu{position:absolute;z-index:30;top:34px;left:0;width:260px;max-height:280px;overflow:auto;background:var(--dsw-alias-bg-overlay);border:1px solid var(--ws-border);border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.16);padding:4px}
.ws-doc-menu button{display:flex;align-items:center;gap:8px;width:100%;height:32px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--ws-text);font:inherit;font-size:12.5px;cursor:pointer;text-align:left}
.ws-doc-menu button:hover{background:var(--ws-surface2)}
.ws-doc-menu button.on{background:var(--ws-surface2);font-weight:600}
.ws-doc-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ws-doc-date{color:var(--ws-muted);font-size:11px}
.ws-left-actions{display:flex;gap:2px}
.ws-title-hint{margin:0 14px 6px;padding:5px 9px;border-radius:6px;background:var(--ws-accent-soft,#FFF4D6);background:var(--ws-surface2);color:var(--ws-muted);font-size:11px;line-height:1.6}
.ws-empty{display:flex;align-items:center;justify-content:center;min-height:420px;padding:40px 30px;color:#9a9a9a;font-size:13px;line-height:1.9;text-align:center}
.ws-title-input{flex:none;margin:0 12px 6px;height:34px;padding:0 10px;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--ws-text);font:inherit;font-size:15px;font-weight:600;outline:none}
.ws-title-input::placeholder{color:var(--ws-muted);font-weight:400}
.ws-title-input:focus{border-color:var(--ws-border);background:var(--ws-surface)}
.ws-toolbar{flex:none;display:flex;flex-wrap:wrap;gap:2px;padding:4px 12px 8px;border-bottom:1px solid var(--ws-border)}
.ws-tool{min-width:26px;height:26px;padding:0 6px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--ws-muted);font:inherit;font-size:12px;cursor:pointer}
.ws-tool:hover{background:var(--ws-surface2);color:var(--ws-text);border-color:var(--ws-border)}
.ws-editor{flex:1;min-height:0;width:100%;padding:14px 16px 24px;border:0;outline:none;resize:none;background:transparent;color:var(--ws-text);font:inherit;font-size:13.5px;line-height:1.9;tab-size:2}
.ws-editor::placeholder{color:var(--ws-muted)}
.ws-left-foot{flex:none;display:flex;align-items:center;gap:10px;height:34px;padding:0 14px;border-top:1px solid var(--ws-border);color:var(--ws-muted);font-size:11.5px}
.ws-foot-hint{color:var(--ws-brand)}
.ws-saved{display:inline-flex;align-items:center;gap:4px;color:var(--ws-muted)}
.ws-mid{flex:1;min-width:0;display:flex;flex-direction:column;background:var(--ws-surface2);position:relative}
.ws-stage{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;align-items:center;gap:14px;padding:20px 18px 26px}
.ws-phone{position:relative;width:410px;max-width:100%;flex:none;display:flex;flex-direction:column;max-height:calc(100% - 40px);padding:4px;border-radius:62px;background:linear-gradient(150deg,#55565b 0%,#26272b 26%,#1a1b1e 52%,#2f3035 74%,#5c5d63 100%);box-shadow:0 34px 78px rgba(0,0,0,.30),0 3px 10px rgba(0,0,0,.22),inset 0 0 0 1px rgba(255,255,255,.18)}
.ws-screen{position:relative;flex:1;min-height:0;display:flex;flex-direction:column;background:#fff;border-radius:58px;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(0,0,0,.06)}
.ws-side-btn{position:absolute;display:block;width:3px;border-radius:2px;background:linear-gradient(180deg,#3b3c40,#202125)}
.ws-side-btn-mute{left:-2px;top:150px;height:26px}
.ws-side-btn-volup{left:-2px;top:196px;height:52px}
.ws-side-btn-voldown{left:-2px;top:258px;height:52px}
.ws-side-btn-power{right:-2px;top:216px;height:78px}
.ws-statusbar{flex:none;height:56px;padding:17px 26px 0;display:flex;align-items:flex-start;justify-content:space-between;background:#fff;color:#111;position:relative;z-index:2}
.ws-status-time{font-size:15px;font-weight:600;letter-spacing:-.01em;padding-left:2px}
.ws-status-glyphs{display:flex;align-items:center;gap:5px;color:#111;padding-top:1px}
.ws-island{position:absolute;top:11px;left:50%;transform:translateX(-50%);width:118px;height:35px;border-radius:18px;background:#000;z-index:3;display:flex;align-items:center;justify-content:flex-end;padding-right:13px;box-shadow:0 1px 2px rgba(0,0,0,.4)}
.ws-island::after{content:'';width:7px;height:7px;border-radius:50%;background:#141f26;box-shadow:inset 0 0 0 1px rgba(90,130,150,.45)}
.ws-wechat-nav{flex:none;height:44px;padding:0 14px;display:flex;align-items:center;gap:8px;background:#fff;color:#111;position:relative;z-index:2;border-bottom:1px solid rgba(0,0,0,.04)}
.ws-nav-back,.ws-nav-more{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;color:#111}
.ws-nav-brand{flex:1;text-align:center;font-size:14px;font-weight:600;color:#1a1a1a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 4px}
.ws-phone-scroll{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;background:#fff;padding-top:12px;scrollbar-width:none;-ms-overflow-style:none}
.ws-phone-scroll::-webkit-scrollbar{width:0;height:0;display:none}
.ws-phone-scroll .ws-article{padding-top:6px}
.ws-read-original{display:flex;align-items:center;gap:1px;padding:2px 18px 30px;color:#576B95;font-size:14px;line-height:1.6}
.ws-wechat-actions{flex:none;height:58px;padding:0 12px;display:flex;align-items:center;gap:12px;border-top:1px solid #ededed;background:#fff}
.ws-comment-pill{flex:1;height:34px;border-radius:17px;background:#F4F4F4;color:#9b9b9b;font-size:13px;display:flex;align-items:center;padding:0 14px}
.ws-action-icon{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;color:#4a4a4a}
.ws-home-indicator{flex:none;height:22px;display:flex;align-items:center;justify-content:center;background:#fff}
.ws-home-indicator i{display:block;width:136px;height:5px;border-radius:3px;background:#111}
.ws-article{width:100%;min-height:120px}
.ws-block{position:relative;border-radius:4px}
.ws-block:hover{outline:1px dashed rgba(0,0,0,.14);outline-offset:2px}
.ws-block.selected{outline:2px solid var(--ws-brand);outline-offset:2px}
.ws-block-tools{position:absolute;top:-13px;right:2px;display:none;align-items:center;gap:1px;padding:2px;border-radius:7px;background:#212226;box-shadow:0 6px 18px rgba(0,0,0,.28);z-index:4}
.ws-block:hover .ws-block-tools{display:flex}
.ws-block-tools button{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border:0;border-radius:5px;background:transparent;color:#e6e6e6;cursor:pointer}
.ws-block-tools button:hover{background:#3a3b40}
.ws-block-tag{position:absolute;left:-2px;top:-18px;font-size:10px;line-height:16px;padding:0 6px;border-radius:4px;background:var(--ws-brand);color:var(--ws-bg);z-index:3}
.ws-mini-btn{height:24px;padding:0 10px;border-radius:8px;border:1px solid var(--ws-border);background:var(--ws-glass-strong);color:var(--ws-text);font:inherit;font-size:11.5px;cursor:pointer}
.ws-mini-btn:hover{border-color:var(--ws-border2)}
.ws-stage-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:0 4px 4px;color:var(--ws-muted);font-size:11.5px}
.ws-stage-chip{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:99px;background:var(--ws-surface);border:1px solid var(--ws-border)}
.ws-stage-chip i{width:8px;height:8px;border-radius:50%;display:block}
.ws-stage-note{opacity:.75}
.ws-right{flex:0 0 320px;display:flex;flex-direction:column;min-height:0;border-left:1px solid var(--ws-border);background:var(--ws-surface)}
.ws-wide.ws-right-closed .ws-right{display:none}
.ws-compact .ws-left{flex:0 0 360px;min-width:300px;max-width:none}
.ws-compact .ws-right{position:absolute;right:0;top:0;bottom:0;width:min(360px,92%);flex:none;box-shadow:-14px 0 34px rgba(0,0,0,.18);z-index:26}
.ws-compact.ws-right-closed .ws-right{display:none}
.ws-scrim{position:absolute;inset:0;background:rgba(0,0,0,.16);z-index:24}
.ws-tabs{flex:none;display:flex;gap:2px;padding:10px 12px 8px;border-bottom:1px solid var(--ws-border)}
.ws-tab{flex:1;height:28px;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--ws-muted);font:inherit;font-size:12.5px;cursor:pointer}
.ws-tab:hover{color:var(--ws-text);background:var(--ws-surface2)}
.ws-tab.on{background:var(--ws-surface2);border-color:var(--ws-border);color:var(--ws-text);font-weight:600}
.ws-tab-close{flex:none;width:28px;height:28px;border:0;border-radius:7px;background:transparent;color:var(--ws-muted);cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.ws-tab-close:hover{background:var(--ws-surface2);color:var(--ws-text)}
.ws-panel{flex:1;min-height:0;overflow-y:auto;padding:12px}
.ws-pane-hidden{display:none}
.ws-sections{display:flex;flex-direction:column;gap:14px}
.ws-card{border:1px solid var(--ws-border);border-radius:10px;padding:12px;background:var(--ws-bg)}
.ws-card-head{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:var(--ws-text);margin-bottom:8px}
.ws-card-head .ws-badge{margin-left:auto}
.ws-reasons{margin:0;padding-left:16px;display:flex;flex-direction:column;gap:4px;color:var(--ws-muted);font-size:11.5px;line-height:1.6}
.ws-group{display:flex;flex-direction:column;gap:8px}
.ws-group-head{display:flex;align-items:center;justify-content:space-between;font-size:12px;font-weight:600;color:var(--ws-muted);text-transform:uppercase;letter-spacing:.06em}
.ws-group-note{font-weight:400;text-transform:none;letter-spacing:0;color:var(--ws-muted)}
.ws-themes{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.ws-theme{display:flex;flex-direction:column;gap:6px;padding:8px;border:1px solid var(--ws-border);border-radius:9px;background:var(--ws-bg);cursor:pointer;text-align:left;font:inherit}
.ws-theme:hover{border-color:var(--ws-border2)}
.ws-theme.on{border-color:var(--ws-brand);box-shadow:0 0 0 1px var(--ws-brand) inset}
.ws-theme-swatch{display:flex;gap:3px;align-items:flex-end;height:26px;padding:5px 6px;border-radius:6px;border:1px solid transparent}
.ws-theme-swatch i{display:block;height:14px;border-radius:2px}
.ws-theme-swatch i:nth-child(1){flex:2;height:8px}
.ws-theme-swatch i:nth-child(2){flex:1;height:14px}
.ws-theme-swatch i:nth-child(3){flex:1.4;height:5px}
.ws-theme-meta{display:flex;flex-direction:column;gap:1px;min-width:0}
.ws-theme-name{font-size:12.5px;font-weight:600;color:var(--ws-text)}
.ws-theme-tag{font-size:10.5px;color:var(--ws-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ws-chips{display:flex;flex-wrap:wrap;gap:6px}
.ws-chip{height:28px;padding:0 11px;border:1px solid var(--ws-border);border-radius:99px;background:var(--ws-bg);color:var(--ws-text);font:inherit;font-size:12px;cursor:pointer}
.ws-chip:hover{border-color:var(--ws-border2)}
.ws-chip.on{background:var(--ws-text);color:var(--ws-bg);border-color:transparent;font-weight:600}
.ws-hint{margin:0;font-size:11.5px;line-height:1.65;color:var(--ws-muted)}
.ws-hint.danger{color:var(--ws-danger)}
.ws-swatches{display:flex;flex-wrap:wrap;gap:6px}
.ws-swatch{position:relative;width:22px;height:22px;border-radius:50%;border:2px solid transparent;cursor:pointer;padding:0;box-shadow:0 0 0 1px var(--ws-border) inset}
.ws-swatch.on{border-color:var(--ws-text)}
.ws-swatch-custom{display:inline-flex;align-items:center;justify-content:center;background:var(--ws-surface2);color:var(--ws-muted);overflow:hidden}
.ws-swatch-custom input{position:absolute;inset:0;opacity:0;cursor:pointer}
.ws-input{width:100%;height:30px;padding:0 9px;border:1px solid var(--ws-border);border-radius:7px;background:var(--ws-bg);color:var(--ws-text);font:inherit;font-size:12.5px;outline:none}
.ws-input:focus{border-color:var(--ws-brand)}
.ws-textarea{height:auto;padding:7px 9px;resize:vertical;line-height:1.7}
.ws-field{display:flex;flex-direction:column;gap:4px}
.ws-field-label{font-size:11.5px;color:var(--ws-muted)}
.ws-slider-row{display:grid;grid-template-columns:52px 1fr 52px;align-items:center;gap:8px}
.ws-slider-label{font-size:11.5px;color:var(--ws-muted)}
.ws-slider-value{font-size:11.5px;color:var(--ws-text);text-align:right;font-variant-numeric:tabular-nums}
.ws-slider-row input[type=range]{width:100%;accent-color:var(--ws-brand);height:18px}
.ws-checklist{margin:0;padding-left:16px;display:flex;flex-direction:column;gap:4px;color:var(--ws-muted);font-size:11.5px;line-height:1.6}
.ws-toggle{display:flex;align-items:center;gap:8px;padding:2px 0;border:0;background:transparent;color:var(--ws-text);font:inherit;font-size:12.5px;cursor:pointer;text-align:left}
.ws-toggle-track{position:relative;width:30px;height:17px;border-radius:99px;background:var(--ws-border2);transition:background .15s;flex:none}
.ws-toggle-track.on{background:var(--ws-brand)}
.ws-toggle-knob{position:absolute;top:2px;left:2px;width:13px;height:13px;border-radius:50%;background:#fff;transition:transform .15s;box-shadow:0 1px 3px rgba(0,0,0,.25)}
.ws-toggle-track.on .ws-toggle-knob{transform:translateX(13px)}
.ws-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.ws-config{display:flex;flex-direction:column;gap:8px;margin:8px 0 4px;padding:10px;border:1px dashed var(--ws-border2);border-radius:8px}
.ws-draft-row{display:flex;align-items:center;gap:10px;padding:7px 0;border-top:1px solid var(--ws-border)}
.ws-draft-row:first-of-type{border-top:0}
.ws-draft-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.ws-draft-title{font-size:12.5px;color:var(--ws-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ws-draft-meta{font-size:11px;color:var(--ws-muted)}
.ws-error-text{color:var(--ws-danger)}
.ws-cover{width:100%;aspect-ratio:900/383;border-radius:8px;object-fit:cover;display:block;border:1px solid var(--ws-border)}
.ws-cover-empty{display:flex;align-items:center;justify-content:center;background:var(--ws-surface2);color:var(--ws-muted);font-size:11.5px}
.ws-publish-actions{display:flex;flex-direction:column;gap:8px}
.ws-publish-actions .ws-btn{width:100%}
.ws-confirm{display:flex;flex-direction:column;gap:6px;padding:10px;border:1px solid var(--ws-danger);border-radius:8px;font-size:11.5px;color:var(--ws-text)}
.ws-confirm .ws-btn{width:100%}
.ws-steps{display:flex;flex-direction:column;gap:6px;padding:10px;border:1px solid var(--ws-border);border-radius:8px;background:var(--ws-bg)}
.ws-step{display:grid;grid-template-columns:14px 1fr;gap:2px 6px;align-items:center;font-size:11.5px;color:var(--ws-muted)}
.ws-step-dot{width:7px;height:7px;border-radius:50%;background:var(--ws-border2);margin-left:3px}
.ws-step.done .ws-step-dot{background:var(--ws-success)}
.ws-step.running .ws-step-dot{background:var(--ws-brand);animation:ws-pulse 1s ease-in-out infinite}
.ws-step.error .ws-step-dot{background:var(--ws-danger)}
.ws-step.done .ws-step-label{color:var(--ws-text)}
.ws-step-detail{grid-column:2;color:var(--ws-muted);word-break:break-all}
.ws-error{display:flex;flex-direction:column;gap:4px;padding:10px;border:1px solid var(--ws-danger);border-radius:8px;background:color-mix(in srgb,var(--ws-danger) 8%,transparent);font-size:11.5px;line-height:1.6}
.ws-error strong{color:var(--ws-danger);font-size:12px;word-break:break-word}
.ws-toast{word-break:break-word}
.ws-msg-body{word-break:break-word}
.ws-hint{word-break:break-word}
.ws-error p{margin:0;color:var(--ws-text)}
.ws-result{display:flex;flex-direction:column;gap:4px;padding:10px;border:1px solid var(--ws-success);border-radius:8px;background:color-mix(in srgb,var(--ws-success) 8%,transparent);font-size:11.5px;line-height:1.6}
.ws-result strong{color:var(--ws-success);font-size:12px}
.ws-result p{margin:0;color:var(--ws-text)}
.ws-link{border:0;background:transparent;padding:0;color:var(--ws-brand);font:inherit;font-size:11.5px;cursor:pointer;text-align:left;text-decoration:none}
.ws-link:hover{text-decoration:underline}
.ws-menu-anchor{position:relative}
.ws-menu{position:absolute;right:0;top:34px;z-index:40;width:190px;padding:4px;border:1px solid var(--ws-border);border-radius:10px;background:var(--dsw-alias-bg-overlay);box-shadow:0 14px 36px rgba(0,0,0,.18)}
.ws-menu button{display:flex;align-items:center;gap:8px;width:100%;height:30px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--ws-text);font:inherit;font-size:12.5px;cursor:pointer;text-align:left}
.ws-menu button:hover{background:var(--ws-surface2)}
.ws-menu button.danger{color:var(--ws-danger)}
.ws-menu-sep{height:1px;margin:4px 6px;background:var(--ws-border)}
.ws-chat{display:flex;flex-direction:column;gap:10px}
.ws-chat-empty{display:flex;flex-direction:column;gap:10px;padding:12px;border:1px dashed var(--ws-border2);border-radius:10px}
.ws-chat-empty p{margin:0;font-size:12px;line-height:1.7;color:var(--ws-muted)}
.ws-chat-list{display:flex;flex-direction:column;gap:8px;max-height:42vh;overflow-y:auto;padding-right:2px}
.ws-msg{display:flex;flex-direction:column;gap:4px;padding:9px 11px;border-radius:10px;font-size:12.5px;line-height:1.7}
.ws-msg.user{align-self:flex-end;max-width:92%;background:var(--ws-surface2);border:1px solid var(--ws-border);color:var(--ws-text)}
.ws-msg.assistant{align-self:flex-start;max-width:96%;background:var(--ws-bg);border:1px solid var(--ws-border);color:var(--ws-text)}
.ws-msg.error{align-self:stretch;background:color-mix(in srgb,var(--ws-danger) 10%,transparent);border:1px solid var(--ws-danger);color:var(--ws-text)}
.ws-msg-body{white-space:pre-wrap;word-break:break-word}
.ws-msg-tags{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:2px}
.ws-msg-tag{font-size:10.5px;padding:1px 7px;border-radius:99px;background:var(--ws-surface2);color:var(--ws-muted);border:1px solid var(--ws-border)}
.ws-msg-model{font-size:10.5px;color:var(--ws-muted)}
.ws-msg.typing{flex-direction:row;align-items:center;gap:6px;color:var(--ws-muted)}
.ws-typing-dot{width:5px;height:5px;border-radius:50%;background:var(--ws-brand);animation:ws-pulse 1s ease-in-out infinite}
.ws-typing-dot:nth-child(2){animation-delay:.15s}
.ws-typing-dot:nth-child(3){animation-delay:.3s}
.ws-chat-compose-option{padding:8px 0 0;display:flex;flex-direction:column;gap:4px}
.ws-chat-compose{display:flex;flex-direction:column;gap:6px}
.ws-refining{position:absolute;left:16px;bottom:16px;z-index:55;display:flex;align-items:center;gap:6px;padding:7px 12px;border-radius:99px;border:1px solid var(--ws-border);background:var(--dsw-alias-bg-overlay);color:var(--ws-muted);font-size:11.5px;box-shadow:0 8px 22px rgba(0,0,0,.14)}
.ws-toasts{position:absolute;right:16px;top:64px;z-index:60;display:flex;flex-direction:column;gap:8px;pointer-events:none;max-width:min(420px,80%)}
.ws-toast{padding:9px 13px;border-radius:9px;background:#212226;color:#f0f0f0;font-size:12.5px;line-height:1.5;box-shadow:0 12px 30px rgba(0,0,0,.3);animation:ws-in .18s ease-out}
.ws-toast.success{background:#173d2b;color:#d8f5e5}
.ws-toast.error{background:#3d1a1a;color:#ffdede}
.ws-seg{display:inline-flex;padding:2px;border-radius:8px;background:var(--ws-surface2);border:1px solid var(--ws-border)}
.ws-seg button{height:24px;padding:0 10px;border:0;border-radius:6px;background:transparent;color:var(--ws-muted);font:inherit;font-size:12px;cursor:pointer}
.ws-seg button.on{background:var(--ws-bg);color:var(--ws-text);box-shadow:0 1px 3px rgba(0,0,0,.12);font-weight:600}
.ws-narrow .ws-left{flex:1;max-width:none;border-right:0}
.ws-narrow.ws-view-preview .ws-right{display:none}
.ws-narrow .ws-right{position:absolute;right:0;top:0;bottom:0;width:min(360px,92%);flex:none;box-shadow:-12px 0 30px rgba(0,0,0,.18);z-index:25}
.ws-narrow.ws-view-write .ws-mid,.ws-narrow.ws-view-write .ws-right{display:none}
.ws-narrow.ws-view-preview .ws-left,.ws-narrow.ws-view-preview .ws-right{display:none}
.ws-narrow.ws-view-design .ws-left,.ws-narrow.ws-view-design .ws-mid{display:none}
.ws-narrow.ws-view-design .ws-right{position:static;flex:1;max-width:none;border-left:0}
.ws-narrow .ws-stage{padding:14px 10px}
.ws-narrow .ws-phone{width:min(410px,100%)}
.ws-narrow .ws-phone{max-height:calc(100% - 24px)}
.ws-narrow .ws-top{gap:6px;padding:0 10px;overflow-x:auto}
.ws-narrow .ws-brand span.ws-badge{display:none}
.ws-narrow .ws-title-input{font-size:14px}
@keyframes ws-pulse{0%,100%{opacity:1}50%{opacity:.35}}
@keyframes ws-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}

/* ===== macOS 27 liquid-glass workbench ===== */
.ws-root{
  --ws-accent:#0A84FF;--ws-accent-ink:#FFFFFF;
  --ws-text:var(--dsw-alias-label-primary);
  --ws-muted:var(--dsw-alias-label-secondary);
  --ws-border:color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent);
  --ws-border2:color-mix(in srgb,var(--dsw-alias-label-primary) 18%,transparent);
  --ws-hover:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent);
  --ws-glass:rgba(255,255,255,.96);
  --ws-glass-strong:#FFFFFF;
  --ws-bg:#FAFAFA;
  --ws-art:#8E8E93;
  --ws-surface:var(--ws-glass);--ws-surface2:var(--ws-glass-strong);
  --ws-brand:var(--ws-accent);
  --ws-engrave:var(--ws-border);
  --ws-shadow:0 14px 34px rgba(0,0,0,.06),0 1px 2px rgba(0,0,0,.05);
  --ws-inner:inset 0 1px 0 rgba(255,255,255,.34);
  position:relative;box-sizing:border-box;padding:10px;gap:10px;
  background:var(--ws-bg);color:var(--ws-text);
  font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','PingFang SC','Helvetica Neue',sans-serif;
}
.ws-root[data-skin="auto"][data-dark="true"]{
  --ws-text:#F5F5F7;--ws-muted:#A1A1A8;
  --ws-border:rgba(255,255,255,.12);--ws-border2:rgba(255,255,255,.2);
  --ws-hover:rgba(255,255,255,.08);
  --ws-glass:rgba(30,30,34,.92);--ws-glass-strong:#1C1C1F;
  --ws-bg:#0C0C0E;
  --ws-inner:inset 0 1px 0 rgba(255,255,255,.12);
  --ws-shadow:0 18px 42px rgba(0,0,0,.4),0 1px 3px rgba(0,0,0,.26);
}
.ws-root[data-skin="light"]{
  --ws-text:#1d1d1f;--ws-muted:#6e6e73;
  --ws-border:rgba(20,24,35,.10);--ws-border2:rgba(20,24,35,.18);
  --ws-hover:rgba(20,24,35,.05);
  --ws-glass:rgba(255,255,255,.96);--ws-glass-strong:#FFFFFF;
  --ws-bg:#F6F6F6;--ws-art:#8E8E93;
}
.ws-root[data-skin="dark"]{
  --ws-text:#F5F5F7;--ws-muted:#A1A1A8;
  --ws-border:rgba(255,255,255,.12);--ws-border2:rgba(255,255,255,.2);
  --ws-hover:rgba(255,255,255,.08);
  --ws-glass:rgba(30,30,34,.92);--ws-glass-strong:#1C1C1F;
  --ws-bg:#0C0C0E;--ws-art:#8E8E93;
  --ws-inner:inset 0 1px 0 rgba(255,255,255,.12);
  --ws-shadow:0 18px 42px rgba(0,0,0,.4),0 1px 3px rgba(0,0,0,.26);
}
.ws-root[data-skin="sand"]{
  --ws-text:#2b2620;--ws-muted:#7b7168;
  --ws-border:rgba(70,52,30,.13);--ws-border2:rgba(70,52,30,.22);
  --ws-hover:rgba(70,52,30,.06);
  --ws-glass:rgba(255,253,249,.96);--ws-glass-strong:#FFFDF9;
  --ws-bg:#F5F0E8;--ws-art:#9A8F80;
}
.ws-root::before{content:none}
.ws-top{position:relative;z-index:20}
.ws-body{position:relative;z-index:1}
.ws-top{
  height:56px;padding:0 12px;border:1px solid var(--ws-border);border-radius:18px;
  background:var(--ws-glass);backdrop-filter:blur(30px) saturate(180%);
  -webkit-backdrop-filter:blur(30px) saturate(180%);
  box-shadow:var(--ws-shadow),var(--ws-inner);
  padding-left:max(12px,calc(var(--dsh-frame-leading-clearance,0px) - 58px));
}
.ws-body{gap:10px}
.ws-left,.ws-mid,.ws-right{
  border:1px solid var(--ws-border);border-radius:18px;
  background:var(--ws-glass);backdrop-filter:blur(34px) saturate(180%);
  -webkit-backdrop-filter:blur(34px) saturate(180%);
  box-shadow:var(--ws-shadow),var(--ws-inner);
  overflow:hidden;
}
.ws-left{border-right:1px solid var(--ws-border)}
.ws-right{border-left:1px solid var(--ws-border)}
.ws-left-head{padding:12px 12px 6px}
.ws-doc-current{background:var(--ws-glass-strong);border:1px solid var(--ws-border);border-radius:11px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.ws-left-actions .ws-icon-btn{border-radius:10px}
.ws-toolbar{border-bottom:1px solid var(--ws-border);padding:4px 12px 8px}
.ws-tool{border-radius:9px;color:var(--ws-muted)}
.ws-tool:hover{background:var(--ws-hover);border-color:var(--ws-border);color:var(--ws-text)}
.ws-editor{background:transparent;color:var(--ws-text)}
.ws-title-input{border-radius:10px}
.ws-title-input:focus{background:var(--ws-glass-strong);border-color:var(--ws-border)}
.ws-title-hint{background:color-mix(in srgb,var(--ws-accent) 10%,transparent);color:var(--ws-muted);border-radius:9px}
.ws-left-foot{border-top:1px solid var(--ws-border);color:var(--ws-muted)}
.ws-mid{background:var(--ws-glass)}
.ws-stage{background:transparent}
.ws-mini-btn{height:24px;padding:0 10px;border-radius:8px;border:1px solid var(--ws-border);background:var(--ws-glass-strong);color:var(--ws-text);font:inherit;font-size:11.5px;cursor:pointer}
.ws-mini-btn:hover{border-color:var(--ws-border2)}
.ws-stage-bar{color:var(--ws-muted)}
.ws-stage-chip{background:var(--ws-glass-strong);border:1px solid var(--ws-border);box-shadow:0 1px 2px rgba(0,0,0,.04)}
.ws-right{background:var(--ws-glass)}
.ws-tabs{border-bottom:1px solid var(--ws-border);padding:12px 12px 10px;gap:4px}
.ws-tab{border-radius:10px;color:var(--ws-muted);height:30px}
.ws-tab:hover{background:var(--ws-hover);color:var(--ws-text)}
.ws-tab.on{background:var(--ws-glass-strong);border-color:var(--ws-border);color:var(--ws-text);box-shadow:0 4px 14px rgba(0,0,0,.07),var(--ws-inner)}
.ws-panel{padding:12px;background:transparent}
.ws-card,.ws-group{background:transparent}
.ws-card{background:var(--ws-glass-strong);border:1px solid var(--ws-border);border-radius:14px;box-shadow:0 2px 10px rgba(0,0,0,.05),var(--ws-inner)}
.ws-card-head{color:var(--ws-text)}
.ws-btn{
  height:32px;padding:0 13px;border-radius:11px;border:1px solid var(--ws-border);
  background:var(--ws-glass-strong);color:var(--ws-text);
  box-shadow:0 1px 2px rgba(0,0,0,.05),var(--ws-inner);
  backdrop-filter:blur(18px) saturate(160%);-webkit-backdrop-filter:blur(18px) saturate(160%);
}
.ws-btn:hover:not(:disabled){background:var(--ws-hover);border-color:var(--ws-border2);filter:none}
.ws-btn.primary{
  background:var(--ws-accent);border-color:color-mix(in srgb,var(--ws-accent) 70%,transparent);
  color:var(--ws-accent-ink);
  box-shadow:0 1px 2px rgba(0,0,0,.12),inset 0 1px 0 rgba(255,255,255,.18);
}
.ws-btn.primary:hover:not(:disabled){background:color-mix(in srgb,var(--ws-accent) 88%,#000);filter:none}
.ws-btn.solid{
  background:var(--ws-text);color:var(--ws-bg);border-color:transparent;
  box-shadow:0 1px 2px rgba(0,0,0,.16),inset 0 1px 0 rgba(255,255,255,.16);
}
.ws-btn.solid:hover:not(:disabled){background:color-mix(in srgb,var(--ws-text) 86%,var(--ws-accent));filter:none}
.ws-icon-btn{border-radius:10px;color:var(--ws-muted)}
.ws-icon-btn:hover:not(:disabled){background:var(--ws-hover);color:var(--ws-text)}
.ws-seg{background:color-mix(in srgb,var(--ws-text) 6%,transparent);border:1px solid var(--ws-border);border-radius:11px}
.ws-seg button{border-radius:9px}
.ws-seg button.on{background:var(--ws-glass-strong);color:var(--ws-text)}
.ws-input{
  background:color-mix(in srgb,var(--ws-text) 4%,transparent);border:1px solid var(--ws-border);
  border-radius:10px;color:var(--ws-text);
}
.ws-input:focus{border-color:var(--ws-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--ws-accent) 22%,transparent)}
.ws-theme{background:var(--ws-glass-strong);border:1px solid var(--ws-border);border-radius:13px;box-shadow:0 2px 8px rgba(0,0,0,.05)}
.ws-theme:hover{border-color:var(--ws-border2);box-shadow:0 6px 16px rgba(0,0,0,.08)}
.ws-theme.on{border-color:var(--ws-accent);box-shadow:0 0 0 1px var(--ws-accent) inset,0 2px 8px rgba(0,0,0,.06)}
.ws-theme-swatch{border-color:var(--ws-border)}
.ws-chip{background:var(--ws-glass-strong);border:1px solid var(--ws-border);border-radius:99px}
.ws-chip:hover{border-color:var(--ws-border2);background:var(--ws-hover)}
.ws-chip.on{background:var(--ws-accent);color:var(--ws-accent-ink);border-color:transparent;box-shadow:0 1px 2px rgba(0,0,0,.12)}
.ws-toggle-track{background:color-mix(in srgb,var(--ws-text) 16%,transparent)}
.ws-toggle-track.on{background:var(--ws-accent);box-shadow:0 2px 8px color-mix(in srgb,var(--ws-accent) 40%,transparent)}
.ws-slider-row input[type=range]{accent-color:var(--ws-accent)}
.ws-link{color:var(--ws-accent)}
.ws-menu,.ws-doc-menu,.ws-appearance{
  background:var(--ws-glass-strong);backdrop-filter:blur(36px) saturate(190%);
  -webkit-backdrop-filter:blur(36px) saturate(190%);
  border:1px solid var(--ws-border);border-radius:14px;
  box-shadow:0 30px 70px rgba(0,0,0,.22),0 2px 8px rgba(0,0,0,.1),var(--ws-inner);
}
.ws-doc-menu button,.ws-menu button{border-radius:9px}
.ws-doc-menu button:hover,.ws-menu button:hover{background:var(--ws-hover)}
.ws-refining{background:var(--ws-glass-strong);backdrop-filter:blur(20px) saturate(160%);border:1px solid var(--ws-border);box-shadow:0 12px 30px rgba(0,0,0,.16)}
.ws-steps,.ws-config{border-radius:12px;border-color:var(--ws-border);background:color-mix(in srgb,var(--ws-text) 3%,transparent)}
.ws-result,.ws-error{border-radius:12px}
.ws-empty{color:var(--ws-muted)}
.ws-brand svg{opacity:.9}
.ws-appearance{position:absolute;right:0;top:36px;z-index:50;width:256px;padding:12px}
.ws-appearance-head{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--ws-text);margin-bottom:10px}
.ws-skins{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.ws-skin{display:flex;flex-direction:column;gap:6px;padding:7px;border-radius:12px;border:1px solid var(--ws-border);background:var(--ws-glass-strong);cursor:pointer;text-align:left;font:inherit}
.ws-skin:hover{border-color:var(--ws-border2)}
.ws-skin.on{border-color:var(--ws-accent);box-shadow:0 0 0 1px var(--ws-accent) inset}
.ws-skin-preview{display:block;height:36px;border-radius:8px;border:1px solid var(--ws-border);background:#f4f4f6;position:relative;overflow:hidden}
.ws-skin-auto .ws-skin-preview{background:#f4f4f6}
.ws-skin-auto .ws-skin-preview::after{content:'';position:absolute;inset:0 0 0 50%;background:#202024}
.ws-skin-light .ws-skin-preview{background:#fbfbfd}
.ws-skin-dark .ws-skin-preview{background:#1e1e22}
.ws-skin-sand .ws-skin-preview{background:#efe6d6}
.ws-skin-text{display:flex;flex-direction:column;gap:1px;min-width:0}
.ws-skin-name{font-size:11.5px;font-weight:600;color:var(--ws-text)}
.ws-skin-hint{font-size:10px;color:var(--ws-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ws-appearance-sub{font-size:11px;color:var(--ws-muted);margin:12px 0 8px}
.ws-root[data-skin="dark"] .ws-toasts .ws-toast{background:#222329;color:#f2f2f4}
.ws-root[data-skin="sand"] .ws-toasts .ws-toast{background:#3a2f24;color:#fdf6ec}
.ws-root[data-skin="dark"] .ws-btn.solid{box-shadow:0 8px 20px rgba(0,0,0,.5)}
@media (max-width: 1000px){
  .ws-root{padding:8px;gap:8px}
  .ws-top{height:52px;border-radius:16px}
  .ws-left,.ws-mid,.ws-right{border-radius:16px}
}
`
