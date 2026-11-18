import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = readFileSync(join(root, 'client.js'), 'utf8')

/** Evaluate the browser artifact against a minimal loader and a fake React. */
function loadBundle() {
  let registration = null
  const fakeReact = { createElement: (type, props, ...children) => ({ type, props, children }) }
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(config) {
          registration = config
        },
      },
    },
    React: undefined,
    console,
    // Module-level code must not touch these before the factory runs.
    localStorage: { getItem: () => null, setItem: () => {} },
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: 'client.js' })
  assert.ok(registration !== null, 'module loader was not called')
  assert.equal(registration.id, '@local/dsh-wechat-studio')
  const required = []
  const plugin = registration.factory(id => {
    required.push(id)
    if (id === 'react') return fakeReact
    throw new Error(`unexpected module request: ${id}`)
  })
  return { plugin, required }
}

test('client bundle registers one factory under the package id', () => {
  const { plugin, required } = loadBundle()
  assert.deepEqual(required, ['react'])
  assert.equal(typeof plugin.apply, 'function')
  assert.deepEqual([...plugin.inject], ['slots'])
})

test('apply registers the sidebar entry and the main panel', () => {
  const { plugin } = loadBundle()
  const registrations = []
  const injectKeys = []
  const ctx = {
    effect(callback) {
      return callback()
    },
    get() {
      return undefined
    },
    slots: {
      inject(key, callback) {
        injectKeys.push(key)
        return callback()
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }
  plugin.apply(ctx)

  assert.deepEqual(injectKeys, ['sidebar.panellist', 'main'])
  assert.equal(registrations.length, 2)

  const [icon, panel] = registrations
  assert.equal(icon.options.name, 'sidebar.panellist')
  assert.equal(icon.options.id, 'wechat-studio')
  assert.equal(typeof icon.options.label, 'function')
  assert.equal(typeof icon.options.label(), 'string')
  assert.ok(icon.options.label().length > 0)
  assert.ok(Number.isFinite(icon.options.order))
  assert.equal(typeof icon.component, 'function')

  assert.equal(panel.options.name, 'main')
  assert.equal(panel.options.key, 'wechat-studio')
  assert.equal(typeof panel.component, 'function')
})

test('the label follows the active locale when the locale service exists', () => {
  const { plugin } = loadBundle()
  const registrations = []
  const makeCtx = active => ({
    effect: callback => callback(),
    get: name => (name === 'locale' ? { getLocale: () => ({ active }) } : undefined),
    slots: {
      inject: (key, callback) => callback(),
      register: (options, component) => {
        registrations.push({ options, component })
        return () => {}
      },
    },
  })
  plugin.apply(makeCtx('zh-CN'))
  assert.equal(registrations[0].options.label(), '公众号排版')
  registrations.length = 0
  plugin.apply(makeCtx('en-US'))
  assert.equal(registrations[0].options.label(), 'WeChat studio')
})

test('the bundle carries no ESM syntax the module loader cannot read', () => {
  assert.ok(!/^\s*import\s/m.test(source), 'no import statements')
  assert.ok(!/^\s*export\s/m.test(source), 'no export statements')
  assert.ok(source.includes('window.__ModuleLoader__.load'))
})
