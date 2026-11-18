import test from 'node:test'
import assert from 'node:assert/strict'

import { createWechatClient, mapWechatError } from '../host/wechat.js'

/** Build a fake fetch that answers by URL and records every request. */
function fakeFetch(handlers) {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    for (const handler of handlers) {
      const response = handler(String(url), init)
      if (response !== undefined) {
        return {
          ok: response.ok ?? true,
          status: response.status ?? 200,
          text: async () => JSON.stringify(response.body),
        }
      }
    }
    throw new Error(`unexpected request ${url}`)
  }
  return { fetchImpl, calls }
}

test('getAccessToken prefers stable_token with force_refresh=false', async () => {
  const { fetchImpl, calls } = fakeFetch([
    (url) => (url.includes('/cgi-bin/stable_token')
      ? { body: { access_token: 'stable-token', expires_in: 7200 } }
      : undefined),
  ])
  const client = createWechatClient({ fetchImpl })
  const result = await client.getAccessToken({ appId: 'wx1234567890abcdef', appSecret: 'secret' })
  assert.equal(result.accessToken, 'stable-token')
  assert.equal(result.expiresIn, 7200)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].init.method, 'POST')
  const body = JSON.parse(calls[0].init.body)
  assert.deepEqual(body, {
    grant_type: 'client_credential',
    appid: 'wx1234567890abcdef',
    secret: 'secret',
    force_refresh: false,
  })
})

test('getAccessToken falls back to the legacy endpoint when stable_token is unavailable', async () => {
  const { fetchImpl, calls } = fakeFetch([
    (url) => (url.includes('/cgi-bin/stable_token') ? { status: 404, ok: false, body: { errcode: 40066, errmsg: 'invalid url' } } : undefined),
    (url) => (url.includes('/cgi-bin/token') ? { body: { access_token: 'legacy-token', expires_in: 7200 } } : undefined),
  ])
  const client = createWechatClient({ fetchImpl })
  const result = await client.getAccessToken({ appId: 'wx1234567890abcdef', appSecret: 'secret' })
  assert.equal(result.accessToken, 'legacy-token')
  assert.equal(calls.filter(call => call.url.includes('/cgi-bin/stable_token')).length, 1)
  assert.equal(calls.filter(call => call.url.includes('/cgi-bin/token')).length, 1)
})

test('credential errors from stable_token are final and not retried on the legacy endpoint', async () => {
  const { fetchImpl, calls } = fakeFetch([
    (url) => (url.includes('/cgi-bin/stable_token')
      ? { body: { errcode: 40013, errmsg: 'invalid appid' } }
      : { body: { access_token: 'should-not-be-used', expires_in: 7200 } }),
  ])
  const client = createWechatClient({ fetchImpl })
  await assert.rejects(() => client.getAccessToken({ appId: 'bad', appSecret: 'bad' }), error => {
    assert.equal(error.errcode, 40013)
    assert.equal(mapWechatError(error).code, 'invalid-appid')
    return true
  })
  assert.equal(calls.length, 1, 'no legacy retry after a credential error')
})

test('network failures on stable_token fall through to the legacy endpoint', async () => {
  let first = true
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(String(url))
    if (String(url).includes('/cgi-bin/stable_token') && first) {
      first = false
      throw new Error('connection reset')
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'legacy-after-network', expires_in: 7200 }) }
  }
  const client = createWechatClient({ fetchImpl })
  const result = await client.getAccessToken({ appId: 'wx1', appSecret: 'secret' })
  assert.equal(result.accessToken, 'legacy-after-network')
  assert.equal(calls.length, 2)
})
