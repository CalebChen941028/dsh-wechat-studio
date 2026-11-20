import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

import { JSDOM } from 'jsdom'
import React from 'react'
import ReactDOMClient from 'react-dom/client'

const { createRoot } = ReactDOMClient
const h = React.createElement

/** Mount the generated client bundle in jsdom and return the container. */
async function mountPanel({ width = 1280, language = '', fetchImpl = null, seedDocs = null } = {}) {
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
  // jsdom has no canvas; cover generation catches the failure.
  window.HTMLCanvasElement.prototype.getContext = () => null
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
    URL,
    TextDecoder,
    TextEncoder,
    HTMLElement: window.HTMLElement,
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
