import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

import { JSDOM } from 'jsdom'
import { createCanvas, Image as CanvasImage } from '@napi-rs/canvas'
import { IDBFactory } from 'fake-indexeddb'
import { saveDocsToDb, saveSnapshot, appendLedgerEvent } from '../src/docdb.mjs'
import React from 'react'
import ReactDOMClient from 'react-dom/client'

const { createRoot } = ReactDOMClient
const h = React.createElement

/** Mount the generated client bundle in jsdom and return the container. */
async function mountPanel({ width = 1280, language = '', fetchImpl = null, seedDocs = null, idbFactory = null } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://127.0.0.1:52889/',
    pretendToBeVisual: true,
  })
  const { window } = dom
  globalThis.window = window
  globalThis.document = window.document
  try { Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true }) } catch { /* Node exposes a read-only navigator */ }
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return width } })
  window.matchMedia = window.matchMedia ?? (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  const canvasMap = new WeakMap()
  const nativeCanvas = (element) => {
    let canvas = canvasMap.get(element)
    if (canvas === undefined || canvas.width !== (element.width || 300) || canvas.height !== (element.height || 150)) {
      canvas = createCanvas(element.width || 300, element.height || 150)
      canvasMap.set(element, canvas)
    }
    return canvas
  }
  window.Image = CanvasImage
  window.HTMLCanvasElement.prototype.getContext = function getContext(type) { return nativeCanvas(this).getContext(type) }
  window.HTMLCanvasElement.prototype.toDataURL = function toDataURL(type, quality) { return nativeCanvas(this).toDataURL(type, quality) }
  if (language !== '') window.localStorage.setItem('dsh.wechat-studio.uiLang', language)
  if (Array.isArray(seedDocs) && seedDocs.length > 0) window.localStorage.setItem('dsh.wechat-studio.docs.v1', JSON.stringify({ docs: seedDocs, activeId: seedDocs[0].id }))

  const sandbox = {
    window,
    document: window.document,
    localStorage: window.localStorage,
    navigator: window.navigator,
    location: window.location,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Blob,
    Response,
    indexedDB: idbFactory ?? undefined,
    AbortController,
    AbortSignal,
    BroadcastChannel,
    URL,
    TextDecoder,
    TextEncoder,
    HTMLElement: window.HTMLElement,
    Image: window.Image,
    FileReader: window.FileReader,
    Element: window.Element,
    MutationObserver: window.MutationObserver,
    ResizeObserver: class { observe() {} disconnect() {} },
    getComputedStyle: window.getComputedStyle,
    DOMParser: window.DOMParser,
    requestAnimationFrame: callback => setTimeout(callback, 0),
    fetch: fetchImpl ?? (async () => {
      throw new Error('host calls are not available in the UI test')
    }),
  }
  let registration = null
  window.__ModuleLoader__ = { load(config) { registration = config } }
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: 'client.js' })
  const plugin = registration.factory(id => {
    if (id === 'react') return React
    throw new Error(`unexpected module: ${id}`)
  })

  const registrations = []
  plugin.apply({
    effect: callback => callback(),
    get: () => undefined,
    slots: {
      inject: (key, callback) => callback(),
      register: (options, component) => {
        registrations.push({ options, component })
        return () => {}
      },
    },
  })

  const container = window.document.getElementById('root')
  const root = createRoot(container)
  const panel = registrations.find(entry => entry.options.name === 'main')
  assert.ok(panel, 'main panel must be registered')
  root.render(h(panel.component, {}))
  await new Promise(resolve => setTimeout(resolve, 400))
  return { dom, window, container, root }
}

test('工作台在 1280px 宽度下渲染三栏与主题库', async () => {
  const { dom, window, container, root } = await mountPanel()
  try {
    assert.ok(container.querySelector('.ws-root'))
    assert.ok(container.querySelector('.ws-editor'), 'editor textarea exists')
    assert.ok(container.querySelectorAll('.ws-theme').length >= 10, 'theme library renders')
    assert.equal(container.querySelectorAll('.ws-theme-mini').length, container.querySelectorAll('.ws-theme').length, 'theme cards use mini previews')
    assert.ok(container.querySelector('.ws-phone'), 'phone preview renders')
  } finally {
    root.unmount()
    dom.window.close()
  }
})

test('工作台可以切换排版、装饰 tab 与外观皮肤', async () => {
  const { dom, window, container, root } = await mountPanel()
  try {
    const tabs = [...container.querySelectorAll('.ws-tab')]
    const decorTab = tabs.find(button => button.textContent.includes('装饰'))
    assert.ok(decorTab)
    decorTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 120))
    assert.ok([...container.querySelectorAll('.ws-group-head')].some(node => node.textContent.includes('图片')))

    const typeTab = tabs.find(button => button.textContent.trim() === '排版')
    assert.ok(typeTab)
    typeTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 120))
    const presets = [...container.querySelectorAll('.ws-preset-row .ws-chip')]
    assert.equal(presets.length, 4)
    const relaxed = presets.find(button => button.textContent.trim() === '舒展')
    assert.ok(relaxed)
    relaxed.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 160))
    assert.ok([...container.querySelectorAll('.ws-preset-row .ws-chip')].some(button => button.textContent.trim() === '舒展' && button.className.includes(' on')))

    const palette = container.querySelector('[title="外观与主题"]')
    assert.ok(palette)
    palette.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 120))
    const popover = container.querySelector('.ws-appearance')
    assert.ok(popover, 'appearance popover opens')
    assert.ok(popover.querySelector('.ws-lang-switch'), 'language switch renders')
    const dark = [...popover.querySelectorAll('.ws-skin')].find(button => button.textContent.includes('深色玻璃'))
    dark.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 120))
    assert.equal(container.querySelector('.ws-root').getAttribute('data-skin'), 'dark')
  } finally {
    root.unmount()
    dom.window.close()
  }
})

test('窄宽度下切换到单栏视图', async () => {
  const { dom, window, container, root } = await mountPanel({ width: 760 })
  try {
    await new Promise(resolve => setTimeout(resolve, 120))
    assert.ok(container.querySelector('.ws-narrow') || container.querySelector('.ws-root'), 'panel renders in narrow mode')
    const views = [...container.querySelectorAll('.ws-view-switch button, .ws-top .ws-btn')]
    assert.ok(views.length > 0)
  } finally {
    root.unmount()
    dom.window.close()
  }
})


test('英文语言包翻译核心导航与页签', async () => {
  const { dom, container, root } = await mountPanel({ language: 'en' })
  try {
    const tabs = [...container.querySelectorAll('.ws-tab')].map(button => button.textContent.trim())
    assert.ok(tabs.includes('Theme'), `theme tab translated: ${tabs.join(', ')}`)
    assert.ok(tabs.includes('Publish'))
    assert.ok(tabs.includes('Type'))
    assert.ok(tabs.includes('Design'))
    const text = container.textContent
    assert.match(text, /Auto layout/)
    assert.match(text, /AI edit|AI chat/)
  } finally {
    root.unmount()
    dom.window.close()
  }
})


test('发布面板：读取草稿箱并导入为本地草稿', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    const body = init === undefined ? {} : JSON.parse(init.body)
    calls.push(body.action)
    let value = null
    if (body.action === 'status') {
      value = { configured: true, phase: 'ready', appIdPreview: 'wx123', message: '' }
    } else if (body.action === 'listDrafts') {
      value = { totalCount: 1, items: [{ mediaId: 'DRAFT-1', title: '联调草稿', digest: '摘要', updateTime: 1700000000 }] }
    } else if (body.action === 'getDraft') {
      value = { items: [{
        title: '联调草稿',
        author: '作者',
        digest: '摘要',
        content: '<h1>导入标题</h1><p>这是一段足够长的导入正文内容，应该超过二十个字符，用来验证导入流程。</p>',
        contentSourceUrl: '',
        thumbMediaId: '',
        needOpenComment: false,
        onlyFansCanComment: false,
      }] }
    }
    return { ok: true, status: 200, async json() { return { ok: true, value } } }
  }

  const { dom, window, container, root } = await mountPanel({ fetchImpl })
  try {
    const publishTab = [...container.querySelectorAll('.ws-tab')].find(button => button.textContent.includes('发布'))
    assert.ok(publishTab)
    publishTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 150))

    assert.ok(container.querySelector('.ws-egress-row'), 'egress IP card renders')
    assert.ok(container.querySelector('.ws-preflight'), 'publish preflight renders')
    assert.ok([...container.querySelectorAll('button')].some(button => button.textContent.includes('获取出口 IP')))
    assert.ok(['左对齐', '居中', '底部', '极简'].every(label => [...container.querySelectorAll('button')].some(button => button.textContent.trim() === label)), 'cover layouts render')

    const loadButton = [...container.querySelectorAll('button')].find(button => button.textContent.includes('刷新草稿箱'))
    assert.ok(loadButton, 'draft box load button renders')
    loadButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 200))
    assert.ok(container.querySelector('.ws-draft-row'), 'draft row renders after loading')

    const importButton = [...container.querySelectorAll('.ws-draft-row button')].find(button => button.textContent.trim() === '导入')
    assert.ok(importButton, 'import button renders')
    importButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 350))

    assert.ok(calls.includes('getDraft'))
    const editor = container.querySelector('.ws-editor')
    assert.match(editor.value, /导入标题/)
    assert.match(editor.value, /导入正文内容/)
  } finally {
    root.unmount()
    dom.window.close()
  }
})

test('AI 修改先出 diff，确认后才写入正文', async () => {
  const fetchImpl = async (url, init) => {
    const body = init === undefined ? {} : JSON.parse(init.body)
    if (body.action === 'aiEditStream') {
      const payload = JSON.stringify({
        type: 'done',
        value: { reply: '已按建议修改', text: '# 新标题\n\n这是 AI 改写后的正文。' },
      })
      return new Response(`data: ${payload}\n\n`, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    }
    const value = body.action === 'networkStatus'
      ? { mode: 'system', proxyUrl: '', configured: false }
      : { configured: false }
    return { ok: true, status: 200, async json() { return { ok: true, value } } }
  }

  const { dom, window, container, root } = await mountPanel({ fetchImpl })
  try {
    const aiTab = [...container.querySelectorAll('.ws-tab')].find(button => button.textContent.trim() === 'AI')
    assert.ok(aiTab)
    aiTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 120))

    const suggestion = container.querySelector('.ws-chat-empty .ws-chip')
    assert.ok(suggestion)
    suggestion.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 350))

    assert.ok(container.querySelector('.ws-diff-card'), 'diff card appears before applying')
    const editorBefore = container.querySelector('.ws-editor').value
    assert.ok(!editorBefore.includes('AI 改写后的正文'))

    const apply = [...container.querySelectorAll('.ws-diff-card button')].find(button => button.textContent.trim() === '应用修改')
    assert.ok(apply)
    apply.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 250))
    assert.match(container.querySelector('.ws-editor').value, /AI 改写后的正文/)
  } finally {
    root.unmount()
    dom.window.close()
  }
})

test('大纲点击会选中段落并定位编辑器', async () => {
  const { dom, window, container, root } = await mountPanel()
  try {
    const outline = [...container.querySelectorAll('.ws-outline-item')]
    assert.ok(outline.length >= 2, 'outline renders headings')
    outline[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 200))
    assert.ok(container.querySelector('.ws-block.selected'), 'preview marks the selected block')
    assert.ok(container.querySelector('.ws-editor').selectionStart > 0, 'editor selection moved')
    assert.ok(outline[1].className.includes(' on'), 'outline item is active')
  } finally {
    root.unmount()
    dom.window.close()
  }
})


test('图片图注可以独立编辑并写回 Markdown', async () => {
  const seed = [{
    id: 'doc-caption',
    text: '# 图注测试\n\n![旧图注](https://example.com/a.png)\n\n正文内容。',
    design: { themeId: 'column', variantId: 'essay', overrides: {} },
    meta: { title: '', author: '', digest: '', sourceUrl: '', brand: '', coverDataUrl: '', needOpenComment: false, onlyFansCanComment: false },
    createdAt: 1,
    updatedAt: 1,
  }]
  const { dom, window, container, root } = await mountPanel({ seedDocs: seed })
  try {
    const captionTool = [...container.querySelectorAll('button')].find(button => button.getAttribute('title') === '编辑图注')
    assert.ok(captionTool, 'caption tool renders for images')
    captionTool.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 120))
    assert.ok(container.querySelector('.ws-caption-editor input'), 'caption editor opens')

    const clear = [...container.querySelectorAll('.ws-caption-editor button')].find(button => button.textContent.trim() === '清除')
    assert.ok(clear)
    clear.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 160))
    assert.match(container.querySelector('.ws-editor').value, /!\[\]\(https:\/\/example\.com\/a\.png\)/)
  } finally {
    root.unmount()
    dom.window.close()
  }
})

test('⌘B 会给选中文字加粗', async () => {
  const { dom, window, container, root } = await mountPanel()
  try {
    const editor = container.querySelector('.ws-editor')
    editor.focus()
    editor.setSelectionRange(0, 6)
    editor.dispatchEvent(new window.KeyboardEvent('keydown', {
      key: 'b', code: 'KeyB', metaKey: true, bubbles: true, cancelable: true,
    }))
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.match(editor.value, /^\*\*# 我为什么\*\*/)
  } finally {
    root.unmount()
    dom.window.close()
  }
})

test('主题可以收藏并筛选', async () => {
  const { dom, window, container, root } = await mountPanel()
  try {
    const star = container.querySelector('.ws-theme-fav')
    assert.ok(star)
    star.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 100))
    const favoriteFilter = [...container.querySelectorAll('.ws-theme-filter .ws-chip')].find(button => button.textContent.trim() === '收藏')
    favoriteFilter.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 120))
    assert.equal(container.querySelectorAll('.ws-theme').length, 1)
  } finally {
    root.unmount()
    dom.window.close()
  }
})

test('分发镜可以切到信息流与分享卡', async () => {
  const { dom, window, container, root } = await mountPanel()
  try {
    const feed = [...container.querySelectorAll('.ws-surface-switch button')].find(button => button.textContent.trim() === '信息流')
    assert.ok(feed)
    feed.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 120))
    assert.ok(container.querySelector('.ws-feed-card'))
    assert.ok(container.querySelector('.ws-feed-title'))

    const share = [...container.querySelectorAll('.ws-surface-switch button')].find(button => button.textContent.trim() === '分享卡')
    share.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 120))
    assert.ok(container.querySelector('.ws-share-card'))
  } finally {
    root.unmount()
    dom.window.close()
  }
})

test('预览里可以锁定段落，AI 范围提示锁定', async () => {
  const { dom, window, container, root } = await mountPanel()
  try {
    const lock = [...container.querySelectorAll('button')].find(button => button.getAttribute('title') === '锁定这一段')
    assert.ok(lock)
    lock.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 120))
    assert.ok(container.querySelector('.ws-block.locked'))
    const aiTab = [...container.querySelectorAll('.ws-tab')].find(button => button.textContent.trim() === 'AI')
    aiTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 120))
    assert.ok(container.textContent.includes('锁定'))
  } finally {
    root.unmount()
    dom.window.close()
  }
})

const scopeSeed = [{
  id: 'doc-scope',
  text: '# 标题\n\n第一段原文。\n\n第二段原文。',
  design: { themeId: 'column', variantId: 'essay', overrides: {} },
  meta: { title: '', author: '', digest: '', sourceUrl: '', brand: '', coverDataUrl: '', needOpenComment: false, onlyFansCanComment: false },
  createdAt: 1,
  updatedAt: 1,
}]

test('AI 只把选中的段落发给模型并只改这一段', async () => {
  let seenText = ''
  const fetchImpl = async (url, init) => {
    const body = init === undefined ? {} : JSON.parse(init.body)
    if (body.action === 'aiEditStream') {
      seenText = body.text
      const payload = JSON.stringify({ type: 'done', value: { reply: '已改写', text: '第一段已改写。' } })
      return new Response(`data: ${payload}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }
    const value = body.action === 'networkStatus' ? { mode: 'system', proxyUrl: '', configured: false } : { configured: false }
    return { ok: true, status: 200, async json() { return { ok: true, value } } }
  }
  const { dom, window, container, root } = await mountPanel({ fetchImpl, seedDocs: scopeSeed })
  try {
    const block = [...container.querySelectorAll('.ws-block')].find(node => node.textContent.includes('第一段原文'))
    assert.ok(block)
    block.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 120))
    const aiTab = [...container.querySelectorAll('.ws-tab')].find(button => button.textContent.trim() === 'AI')
    aiTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 120))
    const suggestion = container.querySelector('.ws-chat-empty .ws-chip')
    suggestion.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 350))
    assert.equal(seenText, '第一段原文。')
    assert.ok(container.querySelector('.ws-diff-card'))
    const apply = [...container.querySelectorAll('.ws-diff-card button')].find(button => button.textContent.trim() === '应用修改')
    apply.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 220))
    const value = container.querySelector('.ws-editor').value
    assert.match(value, /第一段已改写/)
    assert.match(value, /第二段原文/)
  } finally {
    root.unmount()
    dom.window.close()
  }
})

test('锁定段落后 AI 不再发送请求', async () => {
  let aiCalls = 0
  const fetchImpl = async (url, init) => {
    const body = init === undefined ? {} : JSON.parse(init.body)
    if (body.action === 'aiEditStream') aiCalls += 1
    const value = body.action === 'networkStatus' ? { mode: 'system', proxyUrl: '', configured: false } : { configured: false }
    return { ok: true, status: 200, async json() { return { ok: true, value } } }
  }
  const { dom, window, container, root } = await mountPanel({ fetchImpl, seedDocs: scopeSeed })
  try {
    const lock = [...container.querySelectorAll('button')].find(button => button.getAttribute('title') === '锁定这一段')
    lock.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 150))
    const block = [...container.querySelectorAll('.ws-block')].find(node => node.textContent.includes('第一段原文'))
    block.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 120))
    const aiTab = [...container.querySelectorAll('.ws-tab')].find(button => button.textContent.trim() === 'AI')
    aiTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 120))
    const suggestion = container.querySelector('.ws-chat-empty .ws-chip')
    suggestion.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 250))
    assert.equal(aiCalls, 0)
    assert.ok(container.textContent.includes('锁定'))
  } finally {
    root.unmount()
    dom.window.close()
  }
})

test('草稿箱分页会带 offset 并翻到第二页', async () => {
  const offsets = []
  const fetchImpl = async (url, init) => {
    const body = init === undefined ? {} : JSON.parse(init.body)
    let value = null
    if (body.action === 'status') value = { configured: true, phase: 'ready', appIdPreview: 'wx123', message: '' }
    if (body.action === 'listDrafts') {
      offsets.push(body.offset)
      const start = Number(body.offset) || 0
      const items = Array.from({ length: start === 0 ? 10 : 2 }, (_, index) => ({ mediaId: `D${start + index}`, title: `草稿${start + index + 1}`, digest: '', updateTime: 1700000000 }))
      value = { totalCount: 12, items }
    }
    return { ok: true, status: 200, async json() { return { ok: true, value } } }
  }
  const { dom, window, container, root } = await mountPanel({ fetchImpl })
  try {
    const publishTab = [...container.querySelectorAll('.ws-tab')].find(button => button.textContent.trim() === '发布')
    publishTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 150))
    const refresh = [...container.querySelectorAll('button')].find(button => button.textContent.includes('刷新草稿箱'))
    refresh.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 250))
    assert.deepEqual(offsets, [0])
    assert.ok(container.textContent.includes('1–10 / 共 12 篇'))
    const next = [...container.querySelectorAll('button')].find(button => button.textContent.trim() === '下一页')
    next.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 250))
    assert.deepEqual(offsets, [0, 10])
    assert.ok(container.textContent.includes('草稿11'))
  } finally {
    root.unmount()
    dom.window.close()
  }
})

test('帮助弹层首次显示并可再次打开', async () => {
  const { dom, window, container, root } = await mountPanel()
  try {
    assert.ok(container.querySelector('.ws-modal'), 'first-run help opens')
    const start = [...container.querySelectorAll('.ws-modal button')].find(button => button.textContent.trim() === '开始使用')
    start.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 120))
    assert.equal(container.querySelector('.ws-modal'), null)
    const helpButton = [...container.querySelectorAll('button')].find(button => button.getAttribute('title') === '使用提示与快捷键')
    helpButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 120))
    assert.ok(container.querySelector('.ws-modal'))
    assert.ok(container.textContent.includes('使用提示与快捷键'))
  } finally {
    root.unmount()
    dom.window.close()
  }
})

test('主题卡显示 13 个实测保真分', async () => {
  const { dom, container, root } = await mountPanel()
  try {
    assert.equal(container.querySelectorAll('.ws-theme-fidelity').length, 13)
    assert.ok(container.querySelector('.ws-theme-fidelity').textContent.includes('实测'))
  } finally {
    root.unmount()
    dom.window.close()
  }
})

test('关联草稿失效时自动解除关联并提示重新保存', async () => {
  let uploads = 0
  const fetchImpl = async (url, init) => {
    const body = init === undefined ? {} : JSON.parse(init.body)
    if (body.action === 'status') {
      return { ok: true, status: 200, async json() { return { ok: true, value: { configured: true, phase: 'ready', appIdPreview: 'wx123', message: '' } } } }
    }
    if (body.action === 'uploadCover') {
      uploads += 1
      return { ok: true, status: 200, async json() { return { ok: true, value: { mediaId: 'COVER-1' } } } }
    }
    if (body.action === 'updateDraft') {
      return { ok: true, status: 200, async json() { return { ok: false, code: 'invalid-media', message: '草稿不存在' } } }
    }
    return { ok: true, status: 200, async json() { return { ok: true, value: { configured: true } } } }
  }
  const seed = [{
    id: 'doc-stale',
    text: '# 标题\n\n正文内容。',
    design: { themeId: 'column', variantId: 'essay', overrides: {} },
    meta: {
      title: '标题', author: '', digest: '', sourceUrl: '', brand: '', coverDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      coverCustom: true, draftMediaId: 'DRAFT-1', draftArticleCount: 1,
      needOpenComment: false, onlyFansCanComment: false,
    },
    createdAt: 1,
    updatedAt: 1,
  }]
  const { dom, window, container, root } = await mountPanel({ fetchImpl, seedDocs: seed })
  try {
    const publishTab = [...container.querySelectorAll('.ws-tab')].find(button => button.textContent.trim() === '发布')
    publishTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 180))
    const update = [...container.querySelectorAll('button')].find(button => button.textContent.trim() === '更新当前草稿')
    assert.ok(update, 'update button appears for linked draft')
    update.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 450))
    assert.equal(uploads, 1)
    assert.ok([...container.querySelectorAll('button')].some(button => button.textContent.trim() === '保存到草稿箱'), 'association cleared')
    assert.ok(container.textContent.includes('失效') || container.textContent.includes('解除'))
  } finally {
    root.unmount()
    dom.window.close()
  }
})

test('分发镜的搜一搜场景渲染结果卡', async () => {
  const { dom, window, container, root } = await mountPanel()
  try {
    const search = [...container.querySelectorAll('.ws-surface-switch button')].find(button => button.textContent.trim() === '搜一搜')
    search.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 120))
    assert.ok(container.querySelector('.ws-search-hit-title'))
  } finally {
    root.unmount()
    dom.window.close()
  }
})

test('AI 流式生成可以取消', async () => {
  const fetchImpl = async (url, init) => {
    const body = init === undefined ? {} : JSON.parse(init.body)
    if (body.action === 'aiEditStream') {
      return new Promise((resolve, reject) => {
        const signal = init?.signal
        const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        if (signal?.aborted) abort()
        else signal?.addEventListener?.('abort', abort)
      })
    }
    const value = body.action === 'networkStatus' ? { mode: 'system', proxyUrl: '', configured: false } : { configured: false }
    return { ok: true, status: 200, async json() { return { ok: true, value } } }
  }
  const { dom, window, container, root } = await mountPanel({ fetchImpl })
  try {
    const aiTab = [...container.querySelectorAll('.ws-tab')].find(button => button.textContent.trim() === 'AI')
    aiTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 120))
    const suggestion = container.querySelector('.ws-chat-empty .ws-chip')
    suggestion.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 180))
    const cancel = [...container.querySelectorAll('button')].find(button => button.textContent.trim() === '取消')
    assert.ok(cancel, 'cancel button appears while streaming')
    cancel.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 300))
    assert.equal([...container.querySelectorAll('button')].some(button => button.textContent.trim() === '取消'), false)
    assert.ok(container.textContent.includes('已取消'))
  } finally {
    root.unmount()
    dom.window.close()
  }
})

const blockSeed = [{
  id: 'doc-blocks',
  text: '# 标题\n\n第一段。\n\n第二段。\n\n第三段。',
  design: { themeId: 'column', variantId: 'essay', overrides: {} },
  meta: { title: '', author: '', digest: '', sourceUrl: '', brand: '', coverDataUrl: '', needOpenComment: false, onlyFansCanComment: false },
  createdAt: 1,
  updatedAt: 1,
}]

test('段落上移、下移、复制与删除都会改写正文', async () => {
  const { dom, window, container, root } = await mountPanel({ seedDocs: blockSeed })
  try {
    const upButtons = () => [...container.querySelectorAll('button')].filter(button => button.getAttribute('title') === '上移')
    upButtons()[1].click()
    await new Promise(resolve => setTimeout(resolve, 160))
    let value = container.querySelector('.ws-editor').value
    assert.ok(value.indexOf('第二段。') < value.indexOf('第一段。'), 'second block moved up')

    const downButtons = () => [...container.querySelectorAll('button')].filter(button => button.getAttribute('title') === '下移')
    downButtons()[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 160))
    value = container.querySelector('.ws-editor').value
    assert.ok(value.indexOf('第一段。') < value.indexOf('第二段。'), 'first block moved down')

    const copy = [...container.querySelectorAll('button')].find(button => button.getAttribute('title') === '复制这一段')
    copy.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 160))
    value = container.querySelector('.ws-editor').value
    assert.equal((value.match(/第一段。/g) ?? []).length, 2)

    const remove = [...container.querySelectorAll('button')].find(button => button.getAttribute('title') === '删除这一段')
    remove.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 160))
    value = container.querySelector('.ws-editor').value
    assert.equal((value.match(/第一段。/g) ?? []).length, 1)
  } finally {
    root.unmount()
    dom.window.close()
  }
})

test('拖拽可以把后一段移到前一段之前', async () => {
  const { dom, window, container, root } = await mountPanel({ seedDocs: blockSeed })
  try {
    const first = [...container.querySelectorAll('.ws-block')].find(node => node.textContent.includes('第一段。'))
    const second = [...container.querySelectorAll('.ws-block')].find(node => node.textContent.includes('第二段。'))
    second.dispatchEvent(new window.Event('dragstart', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 80))
    first.dispatchEvent(new window.Event('dragover', { bubbles: true, cancelable: true }))
    first.dispatchEvent(new window.Event('drop', { bubbles: true, cancelable: true }))
    await new Promise(resolve => setTimeout(resolve, 200))
    const value = container.querySelector('.ws-editor').value
    assert.ok(value.indexOf('第二段。') < value.indexOf('第一段。'))
  } finally {
    root.unmount()
    dom.window.close()
  }
})

test('点击主题卡切换主题，点击变体卡切换版式', async () => {
  const { dom, window, container, root } = await mountPanel()
  try {
    const badge = () => container.querySelector('.ws-brand .ws-badge')?.textContent ?? ''
    const before = badge()
    const themes = [...container.querySelectorAll('.ws-theme')]
    themes[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 160))
    assert.notEqual(badge(), before)
    assert.ok(themes[1].className.includes('on'))

    const variants = [...container.querySelectorAll('.ws-variant-card')]
    assert.ok(variants.length >= 2)
    variants[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 140))
    assert.ok([...container.querySelectorAll('.ws-variant-card')][1].className.includes('on'))
  } finally {
    root.unmount()
    dom.window.close()
  }
})

test('新主题默认底纹与角标在预览中继承，设计面板可显示并关闭', async () => {
  const { dom, window, container, root } = await mountPanel()
  try {
    const zine = [...container.querySelectorAll('.ws-theme')].find(node => node.textContent.includes('画报'))
    assert.ok(zine, '画报 theme card')
    zine.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 220))

    let article = container.querySelector('.ws-article')
    assert.match(article.getAttribute('style') ?? '', /background-image:\s*repeating-linear-gradient/)
    assert.equal(article.querySelector('svg[width="54"]') !== null, true, 'default corner ornament renders')

    const decorTab = [...container.querySelectorAll('.ws-tab')].find(button => button.textContent.includes('装饰'))
    decorTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 160))

    const selectFor = label => [...container.querySelectorAll('.ws-field')]
      .find(field => field.textContent.includes(label))?.querySelector('select')
    const bg = selectFor('底纹')
    const ornament = selectFor('矢量角标')
    assert.equal(bg.value, 'lines')
    assert.equal(ornament.value, 'corner')
    assert.ok([...selectFor('标题样式').options].some(option => option.value === 'kicker'), 'kicker option is editable')
    assert.ok([...selectFor('章节样式').options].some(option => option.value === 'rule'), 'rule option is editable')
    assert.ok([...selectFor('引用样式').options].some(option => option.value === 'pull'), 'pull option is editable')

    bg.value = 'none'
    bg.dispatchEvent(new window.Event('change', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 160))
    const ornamentAfter = selectFor('矢量角标')
    ornamentAfter.value = 'none'
    ornamentAfter.dispatchEvent(new window.Event('change', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 220))
    article = container.querySelector('.ws-article')
    assert.ok(!(article.getAttribute('style') ?? '').includes('background-image'), 'explicit none removes the pattern')
    assert.equal(article.querySelector('svg[width="54"]') === null, true, 'explicit none removes the ornament')
  } finally {
    root.unmount()
    dom.window.close()
  }
})

test('锁定后可以再解锁', async () => {
  const { dom, window, container, root } = await mountPanel()
  try {
    const lock = [...container.querySelectorAll('button')].find(button => button.getAttribute('title') === '锁定这一段')
    lock.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 140))
    assert.ok(container.querySelector('.ws-block.locked'))
    const unlock = [...container.querySelectorAll('button')].find(button => button.getAttribute('title') === '解锁这一段')
    assert.ok(unlock)
    unlock.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 140))
    assert.equal(container.querySelector('.ws-block.locked'), null)
  } finally {
    root.unmount()
    dom.window.close()
  }
})

test('AI 页未选中段落时也能选语气并显示 token 估算', async () => {
  const { dom, window, container, root } = await mountPanel()
  try {
    const aiTab = [...container.querySelectorAll('.ws-tab')].find(button => button.textContent.trim() === 'AI')
    aiTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.ok(container.textContent.includes('语气'))
    assert.ok(container.textContent.includes('tokens'))
    const spoken = [...container.querySelectorAll('.ws-chat-compose-option .ws-chip')].find(button => button.textContent.trim() === '更口语')
    assert.ok(spoken)
    spoken.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.ok(spoken.className.includes('on'))
  } finally {
    root.unmount()
    dom.window.close()
  }
})

test('封面布局切换会选中对应按钮', async () => {
  const { dom, window, container, root } = await mountPanel()
  try {
    const publishTab = [...container.querySelectorAll('.ws-tab')].find(button => button.textContent.trim() === '发布')
    publishTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 150))
    const centered = [...container.querySelectorAll('button')].find(button => button.textContent.trim() === '居中')
    centered.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 180))
    const again = [...container.querySelectorAll('button')].find(button => button.textContent.trim() === '居中')
    assert.ok(again.className.includes('on'))
  } finally {
    root.unmount()
    dom.window.close()
  }
})

test('标题过长时信息流显示截断警告', async () => {
  const seed = [{
    id: 'doc-long-title',
    text: '# 标题\n\n正文。',
    design: { themeId: 'column', variantId: 'essay', overrides: {} },
    meta: { title: '这是一个非常非常长、长到信息流里一定会被微信截断的标题，用来验证警告是否出现', author: '', digest: '', sourceUrl: '', brand: '', coverDataUrl: '', needOpenComment: false, onlyFansCanComment: false },
    createdAt: 1,
    updatedAt: 1,
  }]
  const { dom, window, container, root } = await mountPanel({ seedDocs: seed })
  try {
    const feed = [...container.querySelectorAll('.ws-surface-switch button')].find(button => button.textContent.trim() === '信息流')
    feed.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.ok(container.querySelector('.ws-surface-hints'))
    assert.ok(container.querySelector('.ws-surface-hints').textContent.includes('信息流'))
  } finally {
    root.unmount()
    dom.window.close()
  }
})

test('排版体检可以拆分长段落并统一半角标点', async () => {
  const seed = [{
    id: 'doc-audit',
    text: `# 标题\n\n${'这是一个需要拆分的很长段落。'.repeat(16)}\n\n你好,世界!`,
    design: { themeId: 'column', variantId: 'essay', overrides: {} },
    meta: { title: '', author: '', digest: '', sourceUrl: '', brand: '', coverDataUrl: '', needOpenComment: false, onlyFansCanComment: false },
    createdAt: 1,
    updatedAt: 1,
  }]
  const { dom, window, container, root } = await mountPanel({ seedDocs: seed })
  try {
    const typeTab = [...container.querySelectorAll('.ws-tab')].find(button => button.textContent.trim() === '排版')
    typeTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 150))
    const beforeLines = container.querySelector('.ws-editor').value.split('\n').length
    const split = [...container.querySelectorAll('.ws-audit-row button')].find(button => button.textContent.trim() === '拆分')
    assert.ok(split, 'long paragraph fix button renders')
    split.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 180))
    assert.ok(container.querySelector('.ws-editor').value.split('\n').length > beforeLines)
    const punct = [...container.querySelectorAll('.ws-audit-row button')].find(button => button.textContent.trim() === '统一')
    punct.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 180))
    const value = container.querySelector('.ws-editor').value
    assert.match(value, /你好，世界！/)
  } finally {
    root.unmount()
    dom.window.close()
  }
})


test('快照 diff、恢复与发布对账单在真实 IndexedDB 下工作', async () => {
  const factory = new IDBFactory()
  globalThis.indexedDB = factory
  const seed = [{
    id: 'doc-idb',
    text: '# 新标题\n\n新正文。',
    design: { themeId: 'column', variantId: 'essay', overrides: {} },
    meta: { title: '新标题', author: '', digest: '', sourceUrl: '', brand: '', coverDataUrl: '', needOpenComment: false, onlyFansCanComment: false },
    createdAt: 1,
    updatedAt: 1,
  }]
  assert.equal(await saveDocsToDb(seed), true)
  assert.equal(await saveSnapshot({ docId: 'doc-idb', text: '# 旧标题\n\n旧正文。', reason: 'before-ai', design: seed[0].design, meta: seed[0].meta }), true)
  assert.equal(await appendLedgerEvent({ docId: 'doc-idb', type: 'draft', text: '# 旧标题\n\n旧正文。', mediaId: 'DRAFT-LEDGER', title: '旧标题', theme: '专栏 · 随笔', design: seed[0].design, meta: seed[0].meta }), true)

  const { dom, window, container, root } = await mountPanel({ seedDocs: seed, idbFactory: factory })
  try {
    const publishTab = [...container.querySelectorAll('.ws-tab')].find(button => button.textContent.trim() === '发布')
    publishTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 300))
    assert.ok(container.querySelector('.ws-ledger-row'), 'ledger event renders')
    assert.ok(container.querySelector('.ws-snapshot-row'), 'snapshot row renders')
    const compare = [...container.querySelectorAll('.ws-snapshot-row button')].find(button => button.textContent.trim() === '对比')
    assert.ok(compare)
    compare.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 160))
    assert.ok(container.querySelector('.ws-snapshot-diff'))
    const restore = [...container.querySelectorAll('.ws-snapshot-row button')].find(button => button.textContent.trim() === '恢复')
    restore.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 220))
    assert.match(container.querySelector('.ws-editor').value, /旧正文/)
  } finally {
    root.unmount()
    dom.window.close()
    globalThis.indexedDB = undefined
  }
})


test('四种封面布局生成不同的 900×383 图片', async () => {
  const { dom, window, container, root } = await mountPanel()
  try {
    const publishTab = [...container.querySelectorAll('.ws-tab')].find(button => button.textContent.trim() === '发布')
    publishTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 350))
    const cover = () => {
      const image = container.querySelector('img.ws-cover')
      return image === null ? '' : image.getAttribute('src') ?? ''
    }
    const first = cover()
    assert.ok(first.startsWith('data:image/png'))
    for (const label of ['居中', '底部', '极简']) {
      const button = [...container.querySelectorAll('button')].find(item => item.textContent.trim() === label)
      button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
      await new Promise(resolve => setTimeout(resolve, 260))
      const next = cover()
      assert.ok(next.startsWith('data:image/png'))
      assert.notEqual(next, first, label + ' layout changes the cover')
    }
  } finally {
    root.unmount()
    dom.window.close()
  }
})

test('版式 DNA 可以从参考图提取并生成三个配方', async () => {
  const { dom, window, container, root } = await mountPanel()
  try {
    const reference = createCanvas(96, 96)
    const context = reference.getContext('2d')
    context.fillStyle = '#f5f1e8'
    context.fillRect(0, 0, 96, 96)
    context.fillStyle = '#c0392b'
    context.fillRect(10, 10, 30, 30)
    const buffer = reference.toBuffer('image/png')
    const file = new window.File([buffer], 'reference.png', { type: 'image/png' })
    const dnaGroup = [...container.querySelectorAll('.ws-group')].find(group => group.textContent.includes('版式 DNA'))
    const input = dnaGroup.querySelector('input[type="file"]')
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    input.dispatchEvent(new window.Event('change', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 500))
    assert.equal(container.querySelectorAll('.ws-dna-card').length, 3)
    const save = [...container.querySelectorAll('.ws-dna-card button')].find(button => button.textContent.trim() === '存为我的版式')
    save.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.ok(window.localStorage.getItem('dsh.wechat-studio.themeDna.v1'))
  } finally {
    root.unmount()
    dom.window.close()
  }
})

test('图片裁剪会生成新的图片地址并写回正文', async () => {
  const source = createCanvas(240, 120)
  const sourceContext = source.getContext('2d')
  sourceContext.fillStyle = '#0e7c86'
  sourceContext.fillRect(0, 0, 240, 120)
  sourceContext.fillStyle = '#ffffff'
  sourceContext.fillRect(80, 20, 80, 80)
  const oldDataUrl = source.toDataURL('image/png')
  const seed = [{
    id: 'doc-crop',
    text: `# 裁剪测试\n\n![配图](${oldDataUrl})`,
    design: { themeId: 'column', variantId: 'essay', overrides: {} },
    meta: { title: '裁剪测试', author: '', digest: '', sourceUrl: '', brand: '', coverDataUrl: '', needOpenComment: false, onlyFansCanComment: false },
    createdAt: 1,
    updatedAt: 1,
  }]
  const { dom, window, container, root } = await mountPanel({ seedDocs: seed })
  try {
    const crop = [...container.querySelectorAll('button')].find(button => button.getAttribute('title') === '裁剪图片')
    assert.ok(crop)
    crop.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 120))
    const square = [...container.querySelectorAll('button')].find(button => button.textContent.trim() === '1:1')
    assert.ok(square)
    square.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 700))
    const value = container.querySelector('.ws-editor').value
    assert.ok(!value.includes(oldDataUrl), 'original image is replaced')
    assert.match(value, /!\[配图\]\(data:image\/(jpeg|png)/)
  } finally {
    root.unmount()
    dom.window.close()
  }
})


test('双窗口通过 BroadcastChannel 提示并载入另一版本', async () => {
  const first = await mountPanel({ seedDocs: blockSeed })
  const second = await mountPanel({ seedDocs: blockSeed })
  try {
    const copy = [...first.container.querySelectorAll('button')].find(button => button.getAttribute('title') === '复制这一段')
    copy.dispatchEvent(new first.window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 1400))
    assert.ok(second.container.querySelector('.ws-remote-banner'), 'remote banner appears in the other window')
    const load = [...second.container.querySelectorAll('.ws-remote-banner button')].find(button => button.textContent.includes('载入'))
    assert.ok(load)
    load.dispatchEvent(new second.window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 250))
    assert.equal((second.container.querySelector('.ws-editor').value.match(/第一段。/g) ?? []).length, 2)
  } finally {
    second.root.unmount()
    second.dom.window.close()
    first.root.unmount()
    first.dom.window.close()
  }
})

test('编辑部规范会被质检和发布检查读取', async () => {
  const seed = [{
    id: 'doc-style',
    text: '# 标题\n\n这段出现赋能，还出现了抓手。',
    design: { themeId: 'column', variantId: 'essay', overrides: {} },
    meta: {
      title: '标题', author: '', digest: '', sourceUrl: '', brand: '', coverDataUrl: '',
      styleGuide: { tone: 'spoken', bannedWords: ['赋能', '抓手'], preferredWords: [], maxParagraphChars: 80, requireCaptions: false },
      needOpenComment: false, onlyFansCanComment: false,
    },
    createdAt: 1,
    updatedAt: 1,
  }]
  const { dom, window, container, root } = await mountPanel({ seedDocs: seed })
  try {
    const publishTab = [...container.querySelectorAll('.ws-tab')].find(button => button.textContent.trim() === '发布')
    publishTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 200))
    assert.ok(container.querySelector('.ws-qa'), 'QA summary renders')
    assert.ok(container.querySelector('.ws-qa').textContent.includes('建议改'))
    assert.ok(container.textContent.includes('禁用词出现'))
    const typeTab = [...container.querySelectorAll('.ws-tab')].find(button => button.textContent.trim() === '排版')
    typeTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 120))
    assert.ok(container.textContent.includes('编辑部规范'))
  } finally {
    root.unmount()
    dom.window.close()
  }
})

test('⌘K 命令面板可以打开片段库并插入带变量的片段', async () => {
  const seed = [{
    id: 'doc-snippet',
    text: '# 标题\n\n正文。',
    design: { themeId: 'column', variantId: 'essay', overrides: {} },
    meta: { title: '标题', author: '亮亮', digest: '', sourceUrl: '', brand: '公众号', coverDataUrl: '', needOpenComment: false, onlyFansCanComment: false },
    createdAt: 1,
    updatedAt: 1,
  }]
  const { dom, window, container, root } = await mountPanel({ seedDocs: seed })
  try {
    const start = [...container.querySelectorAll('.ws-modal button')].find(button => button.textContent.trim() === '开始使用')
    if (start) start.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 100))

    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }))
    await new Promise(resolve => setTimeout(resolve, 120))
    assert.ok(container.querySelector('.ws-palette'))
    const snippets = [...container.querySelectorAll('.ws-palette-item')].find(button => button.textContent.includes('打开片段库'))
    assert.ok(snippets)
    snippets.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.ok(container.querySelector('.ws-snippet-modal'))

    const bioRow = [...container.querySelectorAll('.ws-snippet-row')].find(row => row.textContent.includes('作者简介'))
    const insert = [...bioRow.querySelectorAll('button')].find(button => button.textContent.trim() === '插入')
    insert.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 200))
    assert.match(container.querySelector('.ws-editor').value, /亮亮，写作者/)
  } finally {
    root.unmount()
    dom.window.close()
  }
})

test('发布复盘可以读取近 7 天文章数据', async () => {
  const fetchImpl = async (url, init) => {
    const body = init === undefined ? {} : JSON.parse(init.body)
    if (body.action === 'status') {
      return { ok: true, status: 200, async json() { return { ok: true, value: { configured: true, phase: 'ready', appIdPreview: 'wx123', message: '' } } } }
    }
    if (body.action === 'articleStats') {
      return { ok: true, status: 200, async json() { return { ok: true, value: { days: 7, items: [{ ref_date: '2026-11-20', title: '一篇旧文', read_num: 120, share_num: 3 }] } } } }
    }
    return { ok: true, status: 200, async json() { return { ok: true, value: { configured: true } } } }
  }
  const { dom, window, container, root } = await mountPanel({ fetchImpl })
  try {
    const publishTab = [...container.querySelectorAll('.ws-tab')].find(button => button.textContent.trim() === '发布')
    publishTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 180))
    const load = [...container.querySelectorAll('button')].find(button => button.textContent.trim() === '读取近 7 天')
    assert.ok(load)
    load.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 250))
    assert.ok(container.textContent.includes('一篇旧文'))
    assert.ok(container.textContent.includes('120'))
  } finally {
    root.unmount()
    dom.window.close()
  }
})

test('诊断报告显示存储与最近错误', async () => {
  const { dom, window, container, root } = await mountPanel()
  try {
    window.dispatchEvent(new window.ErrorEvent('error', { error: new Error('boom-test'), message: 'boom-test' }))
    await new Promise(resolve => setTimeout(resolve, 80))
    const diagnostics = [...container.querySelectorAll('.ws-modal button')].find(button => button.textContent.trim() === '诊断报告')
    assert.ok(diagnostics)
    diagnostics.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.ok(container.textContent.includes('浏览器存储'))
    assert.ok(container.textContent.includes('boom-test'))
  } finally {
    root.unmount()
    dom.window.close()
  }
})

test('品牌包可以导入收藏与版式预设', async () => {
  const { dom, window, container, root } = await mountPanel()
  try {
    const group = [...container.querySelectorAll('.ws-group')].find(node => node.textContent.includes('品牌包'))
    assert.ok(group)
    const input = group.querySelector('input[type="file"]')
    const kit = {
      format: 'dsh-wechat-brand-kit', version: 1,
      favorites: ['amber'], recent: [], dnaPresets: [{ id: 'dna-x', name: '导入版式', overrides: { accent: '#123456' } }],
      styleGuide: { tone: 'professional', bannedWords: ['赋能'], preferredWords: [], maxParagraphChars: 100, requireCaptions: false }, snippets: [],
    }
    const file = new window.File([JSON.stringify(kit)], 'brand.json', { type: 'application/json' })
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    input.dispatchEvent(new window.Event('change', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 350))
    const favorites = JSON.parse(window.localStorage.getItem('dsh.wechat-studio.themeFavorites.v1'))
    assert.ok(favorites.includes('amber'))
    assert.match(container.textContent, /导入版式|已导入品牌包/)
  } finally {
    root.unmount()
    dom.window.close()
  }
})

test('多个公众号账号可以切换', async () => {
  let active = 'a'
  const accounts = [
    { id: 'a', name: '主号', appIdPreview: 'wx1111', active: true },
    { id: 'b', name: '副号', appIdPreview: 'wx2222', active: false },
  ]
  const fetchImpl = async (url, init) => {
    const body = init === undefined ? {} : JSON.parse(init.body)
    let value = { configured: true }
    if (body.action === 'status') value = { configured: true, phase: 'ready', appIdPreview: 'wx1111', message: '', activeId: active, accounts }
    if (body.action === 'listAccounts') value = { activeId: active, accounts: accounts.map(item => ({ ...item, active: item.id === active })) }
    if (body.action === 'switchAccount') {
      active = body.id
      value = { activeId: active, accounts: accounts.map(item => ({ ...item, active: item.id === active })) }
    }
    return { ok: true, status: 200, async json() { return { ok: true, value } } }
  }
  const { dom, window, container, root } = await mountPanel({ fetchImpl })
  try {
    const publishTab = [...container.querySelectorAll('.ws-tab')].find(button => button.textContent.trim() === '发布')
    publishTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 250))
    assert.equal(container.querySelectorAll('.ws-account-row').length, 2)
    const switchButton = [...container.querySelectorAll('.ws-account-row button')].find(button => button.textContent.trim() === '切换')
    switchButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 220))
    assert.ok(container.querySelector('.ws-account-row.on').textContent.includes('副号'))
  } finally {
    root.unmount()
    dom.window.close()
  }
})

test('发布计划日期与草稿列表可见', async () => {
  const seed = [{
    id: 'doc-plan',
    text: '# 标题\n\n正文。',
    design: { themeId: 'column', variantId: 'essay', overrides: {} },
    meta: { title: '计划稿', author: '', digest: '', sourceUrl: '', brand: '', coverDataUrl: '', plannedAt: '2026-12-01T09:00:00', needOpenComment: false, onlyFansCanComment: false },
    createdAt: 1,
    updatedAt: 1,
  }]
  const { dom, window, container, root } = await mountPanel({ seedDocs: seed })
  try {
    const publishTab = [...container.querySelectorAll('.ws-tab')].find(button => button.textContent.trim() === '发布')
    publishTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 200))
    assert.ok(container.querySelector('.ws-plan-row'))
    assert.ok(container.querySelector('.ws-plan-row').textContent.includes('2026-12-01'))
    const dateInput = container.querySelector('input[type="date"]')
    assert.equal(dateInput.value, '2026-12-01')
  } finally {
    root.unmount()
    dom.window.close()
  }
})

test('命令面板可以打开素材库弹层', async () => {
  const { dom, window, container, root } = await mountPanel()
  try {
    const start = [...container.querySelectorAll('.ws-modal button')].find(button => button.textContent.trim() === '开始使用')
    if (start) start.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 100))
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }))
    await new Promise(resolve => setTimeout(resolve, 120))
    const item = [...container.querySelectorAll('.ws-palette-item')].find(button => button.textContent.includes('打开素材库'))
    item.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 180))
    assert.ok(container.querySelector('.ws-library-modal'))
  } finally {
    root.unmount()
    dom.window.close()
  }
})
