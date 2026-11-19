import test from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeNetworkMode, normalizeProxyUrl, normalizeNetworkSettings,
  redactProxyUrl, createNetworkFetch, probeEgress,
} from '../host/network.js'

test('normalizeNetworkMode 只接受 system/proxy', () => {
  assert.equal(normalizeNetworkMode('proxy'), 'proxy')
  assert.equal(normalizeNetworkMode('system'), 'system')
  assert.equal(normalizeNetworkMode('direct'), 'system')
  assert.equal(normalizeNetworkMode(undefined), 'system')
})

test('normalizeProxyUrl 校验协议并保留认证信息', () => {
  assert.equal(normalizeProxyUrl('http://127.0.0.1:7890'), 'http://127.0.0.1:7890/')
  assert.equal(normalizeProxyUrl('https://user:pass@proxy.example:8443'), 'https://user:pass@proxy.example:8443/')
  assert.throws(() => normalizeProxyUrl('socks5://127.0.0.1:1080'), /SOCKS/)
  assert.throws(() => normalizeProxyUrl('not a url'), /格式不对/)
  assert.equal(normalizeProxyUrl('', 'http://127.0.0.1:7890'), 'http://127.0.0.1:7890')
  assert.throws(() => normalizeProxyUrl('http://***:***@proxy.example:8080'), /重新填写/)
})

test('redactProxyUrl 隐去账号密码', () => {
  assert.equal(redactProxyUrl('http://user:pass@proxy.example:8080/'), 'http://***:***@proxy.example:8080/')
  assert.equal(redactProxyUrl('http://proxy.example:8080/'), 'http://proxy.example:8080/')
  assert.equal(redactProxyUrl(''), '')
})

test('normalizeNetworkSettings 在 proxy 模式要求地址', () => {
  assert.deepEqual(normalizeNetworkSettings({ mode: 'system' }, { mode: 'proxy', proxyUrl: 'http://127.0.0.1:7890' }), {
    mode: 'system',
    proxyUrl: 'http://127.0.0.1:7890',
  })
  assert.deepEqual(normalizeNetworkSettings({ mode: 'proxy', proxyUrl: 'http://127.0.0.1:7890' }), {
    mode: 'proxy',
    proxyUrl: 'http://127.0.0.1:7890/',
  })
  assert.throws(() => normalizeNetworkSettings({ mode: 'proxy', proxyUrl: '' }), /必须填写代理地址/)
})

test('createNetworkFetch：system 直接用原 fetch，proxy 创建 ProxyAgent', async () => {
  let imported = 0
  const fallback = async () => ({ ok: true, text: async () => 'fallback' })
  const systemFetch = await createNetworkFetch({ mode: 'system', proxyUrl: '' }, {
    fetchImpl: fallback,
    importUndici: async () => { imported += 1; return {} },
  })
  assert.equal(systemFetch, fallback)
  assert.equal(imported, 0)

  const calls = []
  const fakeUndici = {
    ProxyAgent: class { constructor(url) { calls.push({ agent: url }) } },
    fetch: async (input, init) => {
      calls.push({ input, init })
      return { ok: true, text: async () => '{"ip":"1.2.3.4"}' }
    },
  }
  const proxyFetch = await createNetworkFetch({ mode: 'proxy', proxyUrl: 'http://127.0.0.1:7890/' }, {
    fetchImpl: fallback,
    importUndici: async () => fakeUndici,
  })
  await proxyFetch('https://api.weixin.qq.com/cgi-bin/token', { method: 'POST' })
  assert.equal(calls[0].agent, 'http://127.0.0.1:7890/')
  assert.equal(calls[1].init.dispatcher instanceof fakeUndici.ProxyAgent, true)
})

test('probeEgress 解析 JSON 和纯文本 IP', async () => {
  const json = await probeEgress(async () => ({ ok: true, text: async () => '{"ip":"143.198.98.198"}' }))
  assert.equal(json.ip, '143.198.98.198')
  const plain = await probeEgress(async () => ({ ok: true, text: async () => '203.0.113.9\n' }))
  assert.equal(plain.ip, '203.0.113.9')
  await assert.rejects(() => probeEgress(async () => ({ ok: false, status: 502 })), /HTTP 502/)
})
