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
async function mountPanel({ width = 1280, language = '', fetchImpl = null } = {}) {
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
    assert.ok([...container.querySelectorAll('button')].some(button => button.textContent.includes('获取出口 IP')))

    const loadButton = [...container.querySelectorAll('button')].find(button => button.textContent.includes('读取最近'))
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
