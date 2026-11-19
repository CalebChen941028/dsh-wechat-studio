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
async function mountPanel({ width = 1280 } = {}) {
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

  const sandbox = {
    window,
    document: window.document,
    localStorage: window.localStorage,
    navigator: window.navigator,
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
    requestAnimationFrame: callback => setTimeout(callback, 0),
    fetch: async () => {
      throw new Error('host calls are not available in the UI test')
    },
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
