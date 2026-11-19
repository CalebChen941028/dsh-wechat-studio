/**
 * Host 半部单测：微信接口封装、HTTP 工具、业务动作、路由分发。
 *
 * 全部用内存里的假 fetch 和假 credentials，不联网、不碰真实密钥。
 * 运行：node --test test/host.test.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'

import { createWechatClient, mapWechatError, WechatApiError } from '../host/wechat.js'
import { HttpError, readJsonBody, rejectCrossSite, sendJson, toErrorResponse } from '../host/http.js'
import { createStudioService, StudioError } from '../host/service.js'
import { apply } from '../index.js'

const APP_ID = 'wx1234567890abcdef'
const APP_SECRET = 'abcdef0123456789abcdef0123456789'
const ACCOUNT_RECORD = { kind: 'api-key', key: JSON.stringify({ appId: APP_ID, appSecret: APP_SECRET }) }

/** 构造 JSON 响应。 */
function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

/** 构造二进制响应。 */
function binaryResponse(contentType, bytes, headers = {}) {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { 'content-type': contentType, ...headers },
  })
}

/** 按 URL 片段分发的假 fetch，并记录每次调用。 */
function routeFetch(routes) {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const href = String(url)
    const record = { url: href, init }
    calls.push(record)
    for (const [fragment, handler] of routes) {
      if (href.includes(fragment)) return handler(record)
    }
    throw new Error(`测试没有为 ${href} 配置 fetch mock`)
  }
  return { fetchImpl, calls }
}

/** 内存版 credentials 服务。 */
function fakeCredentials(initialRecord) {
  const store = new Map()
  if (initialRecord !== undefined) store.set('wechat-studio/account', initialRecord)
  return {
    store,
    async readRecord(key) {
      return store.get(key)
    },
    async modifyRecord(key, mutate) {
      const next = await mutate(store.get(key))
      if (next === undefined) store.delete(key)
      else store.set(key, next)
      return next
    },
    async deleteRecord(key) {
      store.delete(key)
    },
  }
}

/** 伪造 Cordis 上下文。 */
function fakeCtx({ credentials, connection } = {}) {
  return {
    get(name) {
      if (name === 'credentials') return credentials
      if (name === 'connection') return connection
      return undefined
    },
  }
}

/** 构造带凭据的服务。 */
function makeService({ routes, record = ACCOUNT_RECORD, credentials } = {}) {
  const credentialsService = credentials ?? fakeCredentials(record)
  const { fetchImpl, calls } = routeFetch(routes)
  const service = createStudioService({ ctx: fakeCtx({ credentials: credentialsService }), fetchImpl })
  return { service, credentials: credentialsService, calls }
}

/** 合法草稿参数。 */
function draftPayload(overrides = {}) {
  return {
    title: '一篇文章的标题',
    author: '作者',
    digest: '这是一段摘要',
    content: '<p>正文</p>',
    thumbMediaId: 'MEDIA-ID',
    ...overrides,
  }
}

/** data URL 形式的 PNG。 */
function pngDataUrl(bytes = [1, 2, 3]) {
  return `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`
}

/** 伪造请求对象。 */
function mockRequest({ method = 'POST', headers = {}, body } = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))])
  req.method = method
  req.headers = headers
  return req
}

/** 伪造响应对象。 */
function mockResponse() {
  return {
    statusCode: 0,
    headers: {},
    headersSent: false,
    bodyText: '',
    writeHead(status, headers) {
      this.statusCode = status
      this.headers = headers ?? {}
      return this
    },
    end(chunk) {
      if (chunk !== undefined && chunk !== null) this.bodyText += chunk.toString()
      this.headersSent = true
    },
    json() {
      return this.bodyText === '' ? undefined : JSON.parse(this.bodyText)
    },
  }
}

// ---------------------------------------------------------------------------
// 微信接口封装
// ---------------------------------------------------------------------------

test('token：优先走 stable_token，解析 access_token 与 expires_in，并带超时信号', async () => {
  const { fetchImpl, calls } = routeFetch([
    ['/cgi-bin/stable_token', () => jsonResponse({ access_token: 'TOKEN-1', expires_in: 7200 })],
  ])
  const client = createWechatClient({ fetchImpl })
  const result = await client.getAccessToken({ appId: APP_ID, appSecret: APP_SECRET })
  assert.deepEqual(result, { accessToken: 'TOKEN-1', expiresIn: 7200 })

  assert.equal(calls.length, 1)
  const [call] = calls
  assert.ok(call.url.includes('/cgi-bin/stable_token'))
  assert.equal(call.init.method, 'POST')
  assert.deepEqual(JSON.parse(call.init.body), {
    grant_type: 'client_credential',
    appid: APP_ID,
    secret: APP_SECRET,
    force_refresh: false,
  })
  assert.ok(call.init.signal instanceof AbortSignal, '请求必须带超时信号')
})

test('错误映射：40013 → invalid-appid', async () => {
  const { fetchImpl } = routeFetch([['/cgi-bin/token', () => jsonResponse({ errcode: 40013, errmsg: 'invalid appid' })]])
  const client = createWechatClient({ fetchImpl })
  await assert.rejects(
    () => client.getAccessToken({ appId: 'wxbad', appSecret: APP_SECRET }),
    (error) => {
      assert.ok(error instanceof WechatApiError)
      assert.equal(error.errcode, 40013)
      const mapped = mapWechatError(error)
      assert.equal(mapped.code, 'invalid-appid')
      assert.match(mapped.message, /AppID 不正确/)
      return true
    },
  )
})

test('错误映射：40164 → ip-not-allowed，并把出口 IP 写进提示', async () => {
  const { fetchImpl } = routeFetch([
    ['/cgi-bin/token', () => jsonResponse({ errcode: 40164, errmsg: 'invalid ip 1.2.3.4, not in whitelist' })],
  ])
  const client = createWechatClient({ fetchImpl })
  await assert.rejects(
    () => client.getAccessToken({ appId: APP_ID, appSecret: APP_SECRET }),
    (error) => {
      const mapped = mapWechatError(error)
      assert.equal(mapped.code, 'ip-not-allowed')
      assert.match(mapped.message, /1\.2\.3\.4/)
      assert.match(mapped.message, /IP白名单/)
      assert.equal(mapped.detail.ip, '1.2.3.4')
      return true
    },
  )
})

test('错误映射：48001 → api-unauthorized', async () => {
  const { fetchImpl } = routeFetch([
    ['/cgi-bin/draft/add', () => jsonResponse({ errcode: 48001, errmsg: 'api unauthorized' })],
  ])
  const client = createWechatClient({ fetchImpl })
  await assert.rejects(
    () => client.createDraft({ accessToken: 'TOKEN', article: { title: 't' } }),
    (error) => {
      const mapped = mapWechatError(error)
      assert.equal(mapped.code, 'api-unauthorized')
      assert.match(mapped.message, /保存到草稿箱/)
      return true
    },
  )
})

test('错误映射：网络失败 → network-error', async () => {
  const fetchImpl = async () => {
    throw new TypeError('fetch failed')
  }
  const client = createWechatClient({ fetchImpl })
  await assert.rejects(
    () => client.getAccessToken({ appId: APP_ID, appSecret: APP_SECRET }),
    (error) => {
      const mapped = mapWechatError(error)
      assert.equal(mapped.code, 'network-error')
      assert.match(mapped.message, /无法连接微信服务器/)
      return true
    },
  )
})

// ---------------------------------------------------------------------------
// token 缓存与重试
// ---------------------------------------------------------------------------

test('token 缓存命中：连续两次动作只取一次 token', async () => {
  const { service, calls } = makeService({
    routes: [['/cgi-bin/token', () => jsonResponse({ access_token: 'TOKEN-1', expires_in: 7200 })]],
  })
  const first = await service.testConnection()
  const second = await service.testConnection()
  assert.equal(first.ok, true)
  assert.equal(typeof first.expiresIn, 'number')
  assert.equal(second.ok, true)
  const tokenCalls = calls.filter((call) => call.url.includes('/cgi-bin/token')).length
  assert.equal(tokenCalls, 1)
})

test('token：并发请求合并成一次取 token', async () => {
  let tokenCalls = 0
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const { service } = makeService({
    routes: [['/cgi-bin/token', async () => {
      tokenCalls += 1
      await gate
      return jsonResponse({ access_token: 'TOKEN-1', expires_in: 7200 })
    }]],
  })
  const first = service.testConnection()
  const second = service.testConnection()
  release()
  const results = await Promise.all([first, second])
  assert.equal(results[0].ok, true)
  assert.equal(results[1].ok, true)
  assert.equal(tokenCalls, 1, '同一 appId 的并发取 token 必须合并')
})

test('status：取到 token 后 tokenCached 为 true', async () => {
  const { service } = makeService({
    routes: [['/cgi-bin/token', () => jsonResponse({ access_token: 'TOKEN-1', expires_in: 7200 })]],
  })
  await service.testConnection()
  const value = await service.status()
  assert.equal(value.configured, true)
  assert.equal(value.tokenCached, true)
})

test('token 失效（40001）自动清缓存并重试一次', async () => {
  let tokenCalls = 0
  let draftCalls = 0
  const { service } = makeService({
    routes: [
      ['/cgi-bin/token', () => {
        tokenCalls += 1
        return jsonResponse({ access_token: `TOKEN-${tokenCalls}`, expires_in: 7200 })
      }],
      ['/cgi-bin/draft/add', () => {
        draftCalls += 1
        if (draftCalls === 1) return jsonResponse({ errcode: 40001, errmsg: 'invalid credential' })
        return jsonResponse({ media_id: 'DRAFT-1' })
      }],
    ],
  })
  const result = await service.createDraft(draftPayload())
  assert.deepEqual(result, { mediaId: 'DRAFT-1', warnings: [] })
  assert.equal(tokenCalls, 2, '重试时必须重新取 token')
  assert.equal(draftCalls, 2, '失败的动作必须重试一次')
})

// ---------------------------------------------------------------------------
// createDraft
// ---------------------------------------------------------------------------

test('createDraft：draft/add 请求体形状正确', async () => {
  const { service, calls } = makeService({
    routes: [
      ['/cgi-bin/token', () => jsonResponse({ access_token: 'TOKEN-1', expires_in: 7200 })],
      ['/cgi-bin/draft/add', () => jsonResponse({ media_id: 'DRAFT-1' })],
    ],
  })
  await service.createDraft(draftPayload({ contentSourceUrl: 'https://example.com/source' }))
  const draftCall = calls.find((call) => call.url.includes('/cgi-bin/draft/add'))
  assert.ok(draftCall)
  const url = new URL(draftCall.url)
  assert.equal(url.searchParams.get('access_token'), 'TOKEN-1')
  assert.equal(draftCall.init.method, 'POST')
  const body = JSON.parse(draftCall.init.body)
  assert.ok(Array.isArray(body.articles))
  assert.equal(body.articles.length, 1)
  const article = body.articles[0]
  assert.equal(article.article_type, 'news')
  assert.equal(article.title, '一篇文章的标题')
  assert.equal(article.author, '作者')
  assert.equal(article.digest, '这是一段摘要')
  assert.equal(article.content, '<p>正文</p>')
  assert.equal(article.thumb_media_id, 'MEDIA-ID')
  assert.equal(article.content_source_url, 'https://example.com/source')
  assert.equal(article.need_open_comment, 0)
  assert.equal(article.only_fans_can_comment, 0)
})

test('createDraft：title/author/digest 截断并返回 warnings', async () => {
  const { service, calls } = makeService({
    routes: [
      ['/cgi-bin/token', () => jsonResponse({ access_token: 'TOKEN-1', expires_in: 7200 })],
      ['/cgi-bin/draft/add', () => jsonResponse({ media_id: 'DRAFT-1' })],
    ],
  })
  const result = await service.createDraft(draftPayload({
    title: '标'.repeat(70),
    author: '作'.repeat(10),
    digest: '摘'.repeat(130),
  }))
  assert.equal(result.warnings.length, 3)
  assert.match(result.warnings.join('；'), /标题超过微信 64 字上限/)
  assert.match(result.warnings.join('；'), /作者名超过微信 8 字上限/)
  assert.match(result.warnings.join('；'), /摘要超过微信 120 字上限/)

  const draftCall = calls.find((call) => call.url.includes('/cgi-bin/draft/add'))
  const article = JSON.parse(draftCall.init.body).articles[0]
  assert.equal(Array.from(article.title).length, 64)
  assert.equal(Array.from(article.author).length, 8)
  assert.equal(Array.from(article.digest).length, 120)
})

test('createDraft：缺少 thumbMediaId 抛 cover-required', async () => {
  const { service } = makeService({ routes: [] })
  await assert.rejects(
    () => service.createDraft(draftPayload({ thumbMediaId: undefined })),
    (error) => {
      assert.ok(error instanceof StudioError)
      assert.equal(error.code, 'cover-required')
      assert.match(error.message, /封面/)
      return true
    },
  )
})

test('createDraft：空标题抛 title-required', async () => {
  const { service } = makeService({ routes: [] })
  await assert.rejects(
    () => service.createDraft(draftPayload({ title: '   ' })),
    (error) => {
      assert.equal(error.code, 'title-required')
      return true
    },
  )
})

// ---------------------------------------------------------------------------
// 图片上传
// ---------------------------------------------------------------------------

test('uploadImages：上传 multipart（字段名 media）并返回 id → url', async () => {
  const { service, calls } = makeService({
    routes: [
      ['/cgi-bin/token', () => jsonResponse({ access_token: 'TOKEN-1', expires_in: 7200 })],
      ['/cgi-bin/media/uploadimg', () => jsonResponse({ url: 'https://mmbiz.qpic.cn/a.png' })],
    ],
  })
  const result = await service.uploadImages({
    images: [{ id: 'img-0', dataUrl: pngDataUrl([1, 2, 3]), name: 'image-0.png' }],
  })
  assert.deepEqual(result, { images: [{ id: 'img-0', url: 'https://mmbiz.qpic.cn/a.png' }] })

  const uploadCall = calls.find((call) => call.url.includes('/cgi-bin/media/uploadimg'))
  assert.ok(uploadCall.init.body instanceof FormData, '正文图片必须用 multipart 上传')
  const file = uploadCall.init.body.get('media')
  assert.ok(file, 'multipart 字段名必须是 media')
  assert.equal(file.type, 'image/png')
  assert.deepEqual(Array.from(new Uint8Array(await file.arrayBuffer())), [1, 2, 3])
})

test('uploadImages：单张超过 1MB 抛 image-too-large', async () => {
  const { service } = makeService({ routes: [] })
  const big = pngDataUrl(Buffer.alloc(1024 * 1024 + 1, 7))
  await assert.rejects(
    () => service.uploadImages({ images: [{ id: 'img-0', dataUrl: big }] }),
    (error) => {
      assert.equal(error.code, 'image-too-large')
      assert.match(error.message, /1MB/)
      return true
    },
  )
})

test('uploadImages：非 png/jpeg 的 data URL 抛 image-invalid', async () => {
  const { service } = makeService({ routes: [] })
  await assert.rejects(
    () => service.uploadImages({ images: [{ id: 'img-0', dataUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }] }),
    (error) => {
      assert.equal(error.code, 'image-invalid')
      assert.match(error.message, /PNG|JPEG/)
      return true
    },
  )
})

test('uploadCover：上传永久素材并返回 mediaId 与 url', async () => {
  const { service, calls } = makeService({
    routes: [
      ['/cgi-bin/token', () => jsonResponse({ access_token: 'TOKEN-1', expires_in: 7200 })],
      ['/cgi-bin/material/add_material', () => jsonResponse({ media_id: 'COVER-1', url: 'https://mmbiz.qpic.cn/cover.png' })],
    ],
  })
  const result = await service.uploadCover({ dataUrl: pngDataUrl(), name: 'cover.png' })
  assert.deepEqual(result, { mediaId: 'COVER-1', url: 'https://mmbiz.qpic.cn/cover.png' })
  const coverCall = calls.find((call) => call.url.includes('/cgi-bin/material/add_material'))
  const url = new URL(coverCall.url)
  assert.equal(url.searchParams.get('type'), 'image')
  assert.ok(coverCall.init.body instanceof FormData)
})

// ---------------------------------------------------------------------------
// importImages（外链图片转存）
// ---------------------------------------------------------------------------

test('importImages：按输入顺序转存外链图片', async () => {
  let uploaded = 0
  const { service, calls } = makeService({
    routes: [
      ['cdn.example.com/a.png', () => binaryResponse('image/png', [1, 2, 3])],
      ['cdn.example.com/b.jpg', () => binaryResponse('image/jpeg', [4, 5, 6])],
      ['/cgi-bin/media/uploadimg', () => {
        uploaded += 1
        return jsonResponse({ url: `https://mmbiz.qpic.cn/img-${uploaded}.png` })
      }],
      ['/cgi-bin/token', () => jsonResponse({ access_token: 'TOKEN-1', expires_in: 7200 })],
    ],
  })
  const result = await service.importImages({
    urls: ['https://cdn.example.com/a.png', 'https://cdn.example.com/b.jpg'],
  })
  assert.deepEqual(result, {
    images: [
      { url: 'https://cdn.example.com/a.png', wechatUrl: 'https://mmbiz.qpic.cn/img-1.png' },
      { url: 'https://cdn.example.com/b.jpg', wechatUrl: 'https://mmbiz.qpic.cn/img-2.png' },
    ],
  })
  assert.equal(uploaded, 2)
  const downloadCall = calls.find((call) => call.url === 'https://cdn.example.com/a.png')
  assert.equal(downloadCall.init.redirect, 'follow')
  assert.ok(downloadCall.init.signal instanceof AbortSignal, '下载必须带超时信号')
})

test('importImages：返回内容类型不对抛 image-fetch-failed 并带 URL', async () => {
  const { service } = makeService({
    routes: [['cdn.example.com/page.png', () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } })]],
  })
  await assert.rejects(
    () => service.importImages({ urls: ['https://cdn.example.com/page.png'] }),
    (error) => {
      assert.equal(error.code, 'image-fetch-failed')
      assert.match(error.message, /https:\/\/cdn\.example\.com\/page\.png/)
      assert.match(error.message, /text\/html/)
      return true
    },
  )
})

test('importImages：下载 HTTP 失败抛 image-fetch-failed 并带 URL', async () => {
  const { service } = makeService({
    routes: [['cdn.example.com/missing.png', () => new Response('not found', { status: 404 })]],
  })
  await assert.rejects(
    () => service.importImages({ urls: ['https://cdn.example.com/missing.png'] }),
    (error) => {
      assert.equal(error.code, 'image-fetch-failed')
      assert.match(error.message, /https:\/\/cdn\.example\.com\/missing\.png/)
      assert.match(error.message, /HTTP 404/)
      return true
    },
  )
})

test('importImages：urls 为空时给出提示', async () => {
  const { service } = makeService({ routes: [] })
  await assert.rejects(
    () => service.importImages({ urls: [] }),
    (error) => {
      assert.equal(error.code, 'urls-required')
      return true
    },
  )
})

test('importImages：超过 5MB 的上限时拒绝', async () => {
  const { service } = makeService({
    routes: [['cdn.example.com/huge.png', () => binaryResponse('image/png', [1], { 'content-length': '6000000' })]],
  })
  await assert.rejects(
    () => service.importImages({ urls: ['https://cdn.example.com/huge.png'] }),
    (error) => {
      assert.equal(error.code, 'image-fetch-failed')
      assert.match(error.message, /5MB/)
      return true
    },
  )
})

test('createDraft：评论开关按 payload 写入，关闭评论时忽略仅粉丝选项', async () => {
  const { service, calls } = makeService({
    routes: [
      ['/cgi-bin/token', () => jsonResponse({ access_token: 'TOKEN-1', expires_in: 7200 })],
      ['/cgi-bin/draft/add', () => jsonResponse({ media_id: 'DRAFT-1' })],
    ],
  })
  await service.createDraft(draftPayload({ needOpenComment: true, onlyFansCanComment: true }))
  const first = JSON.parse(calls.find(call => call.url.includes('/cgi-bin/draft/add')).init.body).articles[0]
  assert.equal(first.need_open_comment, 1)
  assert.equal(first.only_fans_can_comment, 1)

  await service.createDraft(draftPayload({ needOpenComment: false, onlyFansCanComment: true }))
  const second = JSON.parse(calls.filter(call => call.url.includes('/cgi-bin/draft/add')).at(-1).init.body).articles[0]
  assert.equal(second.need_open_comment, 0)
  assert.equal(second.only_fans_can_comment, 0)
})

test('importImages：拒绝本机、内网与元数据地址，不发起请求', async () => {
  const { service, calls } = makeService({ routes: [] })
  const blocked = [
    'http://127.0.0.1/a.png',
    'http://localhost/a.png',
    'http://192.168.1.2/a.png',
    'http://10.0.0.8/a.png',
    'http://169.254.169.254/latest/meta-data.png',
    'http://[::1]/a.png',
    'http://service.internal/a.png',
  ]
  for (const url of blocked) {
    await assert.rejects(
      () => service.importImages({ urls: [url] }),
      (error) => {
        assert.equal(error.code, 'image-fetch-failed')
        assert.match(error.message, /本机或内网/)
        return true
      },
      url,
    )
  }
  assert.equal(calls.filter(call => call.url.includes('cdn') || call.url.includes('127.0.0.1')).length, 0)
})

test('importImages：重定向后的地址也要通过内网校验', async () => {
  const { service } = makeService({
    routes: [['cdn.example.com/redirect.png', () => ({
      ok: true,
      status: 200,
      url: 'http://127.0.0.1/secret.png',
      headers: new Headers({ 'content-type': 'image/png' }),
    })]],
  })
  await assert.rejects(
    () => service.importImages({ urls: ['https://cdn.example.com/redirect.png'] }),
    (error) => {
      assert.equal(error.code, 'image-fetch-failed')
      assert.match(error.message, /本机或内网/)
      return true
    },
  )
})

test('listDrafts：读取草稿箱并映射标题与时间', async () => {
  const { service, calls } = makeService({
    routes: [
      ['/cgi-bin/token', () => jsonResponse({ access_token: 'TOKEN-1', expires_in: 7200 })],
      ['/cgi-bin/draft/batchget', () => jsonResponse({
        total_count: 2,
        item_count: 2,
        item: [
          { media_id: 'DRAFT-1', update_time: 1700000000, content: { news_item: [{ title: '第一篇', digest: '摘要一' }] } },
          { media_id: 'DRAFT-2', update_time: 1700000100, content: { news_item: [{ title: '第二篇', digest: '' }] } },
        ],
      })],
    ],
  })
  const result = await service.listDrafts({ count: 5, offset: 2 })
  assert.deepEqual(result, {
    totalCount: 2,
    items: [
      { mediaId: 'DRAFT-1', title: '第一篇', digest: '摘要一', updateTime: 1700000000 },
      { mediaId: 'DRAFT-2', title: '第二篇', digest: '', updateTime: 1700000100 },
    ],
  })
  const request = calls.find(call => call.url.includes('/cgi-bin/draft/batchget'))
  const body = JSON.parse(request.init.body)
  assert.equal(body.offset, 2)
  assert.equal(body.count, 5)
  assert.equal(body.no_content, 0)
})

test('deleteDraft：调用 draft/delete 并校验 mediaId', async () => {
  const { service, calls } = makeService({
    routes: [
      ['/cgi-bin/token', () => jsonResponse({ access_token: 'TOKEN-1', expires_in: 7200 })],
      ['/cgi-bin/draft/delete', () => jsonResponse({ errcode: 0 })],
    ],
  })
  await service.deleteDraft({ mediaId: 'DRAFT-1' })
  const request = calls.find(call => call.url.includes('/cgi-bin/draft/delete'))
  assert.deepEqual(JSON.parse(request.init.body), { media_id: 'DRAFT-1' })
  await assert.rejects(() => service.deleteDraft({}), (error) => error.code === 'media-required')
})

// ---------------------------------------------------------------------------
// 发布
// ---------------------------------------------------------------------------

test('publish：无发布权限时提示改用保存到草稿箱', async () => {
  const { service } = makeService({
    routes: [
      ['/cgi-bin/token', () => jsonResponse({ access_token: 'TOKEN-1', expires_in: 7200 })],
      ['/cgi-bin/freepublish/submit', () => jsonResponse({ errcode: 48001, errmsg: 'api unauthorized' })],
    ],
  })
  await assert.rejects(
    () => service.publish({ mediaId: 'DRAFT-1' }),
    (error) => {
      assert.equal(error.code, 'api-unauthorized')
      assert.match(error.message, /保存到草稿箱/)
      assert.match(error.message, /认证/)
      return true
    },
  )
})

test('publish：成功时返回 publishId', async () => {
  const { service } = makeService({
    routes: [
      ['/cgi-bin/token', () => jsonResponse({ access_token: 'TOKEN-1', expires_in: 7200 })],
      ['/cgi-bin/freepublish/submit', () => jsonResponse({ publish_id: 'PUB-1' })],
    ],
  })
  assert.deepEqual(await service.publish({ mediaId: 'DRAFT-1' }), { publishId: 'PUB-1' })
})

test('publishStatus：状态码映射成中文', async () => {
  let status = 4
  const { service } = makeService({
    routes: [
      ['/cgi-bin/token', () => jsonResponse({ access_token: 'TOKEN-1', expires_in: 7200 })],
      ['/cgi-bin/freepublish/get', () => jsonResponse({ publish_status: status })],
    ],
  })
  assert.deepEqual(await service.publishStatus({ publishId: 'PUB-1' }), {
    publishStatus: 4,
    statusText: '平台审核不通过',
  })
  status = 0
  assert.deepEqual(await service.publishStatus({ publishId: 'PUB-1' }), {
    publishStatus: 0,
    statusText: '发布成功',
  })
  status = 9
  assert.deepEqual(await service.publishStatus({ publishId: 'PUB-1' }), {
    publishStatus: 9,
    statusText: '未知状态',
  })
})

// ---------------------------------------------------------------------------
// 凭据读写
// ---------------------------------------------------------------------------

test('status/saveConfig/clearConfig：读写凭据且不回传 appSecret', async () => {
  const credentials = fakeCredentials()
  const { service } = makeService({ credentials, routes: [] })

  assert.deepEqual(await service.status(), { configured: false, appIdPreview: null, tokenCached: false })

  const saved = await service.saveConfig({ appId: APP_ID, appSecret: APP_SECRET })
  assert.deepEqual(saved, { configured: true, appIdPreview: 'wx1234…cdef' })
  assert.equal(JSON.stringify(saved).includes(APP_SECRET), false, '保存结果不能带 appSecret')

  const record = credentials.store.get('wechat-studio/account')
  assert.equal(record.kind, 'api-key')
  assert.deepEqual(JSON.parse(record.key), { appId: APP_ID, appSecret: APP_SECRET })

  assert.deepEqual(await service.status(), { configured: true, appIdPreview: 'wx1234…cdef', tokenCached: false })

  assert.deepEqual(await service.clearConfig(), { configured: false })
  assert.equal(credentials.store.has('wechat-studio/account'), false)
})

test('status：凭据记录损坏时按未配置处理', async () => {
  const credentials = fakeCredentials({ kind: 'api-key', key: '{不是 JSON' })
  const { service } = makeService({ credentials, routes: [] })
  assert.deepEqual(await service.status(), { configured: false, appIdPreview: null, tokenCached: false })
})

test('没有 credentials 服务时给出明确错误', async () => {
  const { fetchImpl } = routeFetch([])
  const service = createStudioService({ ctx: fakeCtx({}), fetchImpl })
  await assert.rejects(
    () => service.status(),
    (error) => {
      assert.equal(error.code, 'credentials-unavailable')
      assert.match(error.message, /credentials 服务/)
      return true
    },
  )
})

test('saveConfig：AppID/AppSecret 格式不对时拒绝', async () => {
  const { service } = makeService({ routes: [] })
  await assert.rejects(() => service.saveConfig({ appId: 'x', appSecret: APP_SECRET }), (error) => {
    assert.equal(error.code, 'config-invalid')
    return true
  })
  await assert.rejects(() => service.saveConfig({ appId: APP_ID, appSecret: 'short' }), (error) => {
    assert.equal(error.code, 'config-invalid')
    return true
  })
})

// ---------------------------------------------------------------------------
// HTTP 工具
// ---------------------------------------------------------------------------

test('readJsonBody：解析正常 JSON', async () => {
  const body = await readJsonBody(mockRequest({ body: { action: 'status' } }))
  assert.deepEqual(body, { action: 'status' })
})

test('readJsonBody：超过上限抛 413', async () => {
  await assert.rejects(
    () => readJsonBody(mockRequest({ body: { text: 'x'.repeat(100) } }), { maxBytes: 10 }),
    (error) => {
      assert.ok(error instanceof HttpError)
      assert.equal(error.statusCode, 413)
      assert.equal(error.code, 'payload-too-large')
      return true
    },
  )
})

test('readJsonBody：非法 JSON 抛 400', async () => {
  await assert.rejects(
    () => readJsonBody(mockRequest({ body: '{oops' })),
    (error) => {
      assert.equal(error.statusCode, 400)
      assert.equal(error.code, 'bad-json')
      return true
    },
  )
})

test('rejectCrossSite：缺少 x-wechat-studio 请求头时拒绝', () => {
  const rejection = rejectCrossSite(mockRequest({ headers: { host: '127.0.0.1:52889' } }), fakeCtx())
  assert.equal(rejection.status, 403)
  assert.equal(rejection.code, 'forbidden')
})

test('rejectCrossSite：Origin 与 Host 不一致时拒绝', () => {
  const rejection = rejectCrossSite(
    mockRequest({
      headers: { 'x-wechat-studio': '1', host: '127.0.0.1:52889', origin: 'http://evil.example' },
    }),
    fakeCtx(),
  )
  assert.equal(rejection.status, 403)
  assert.match(rejection.message, /不是同一个地址/)
})

test('rejectCrossSite：正常同源请求放行', () => {
  const rejection = rejectCrossSite(
    mockRequest({
      headers: {
        'x-wechat-studio': '1',
        host: '127.0.0.1:52889',
        origin: 'http://127.0.0.1:52889',
        'sec-fetch-site': 'same-origin',
      },
    }),
    fakeCtx(),
  )
  assert.equal(rejection, undefined)
})

test('rejectCrossSite：localhost 与 [::1] 都算本机', () => {
  assert.equal(
    rejectCrossSite(
      mockRequest({ headers: { 'x-wechat-studio': '1', host: 'localhost:8080', origin: 'http://localhost:8080' } }),
      fakeCtx(),
    ),
    undefined,
  )
  assert.equal(
    rejectCrossSite(
      mockRequest({ headers: { 'x-wechat-studio': '1', host: '[::1]:8080', origin: 'http://[::1]:8080' } }),
      fakeCtx(),
    ),
    undefined,
  )
})

test('rejectCrossSite：sec-fetch-site 为 same-site 时拒绝', () => {
  const rejection = rejectCrossSite(
    mockRequest({
      headers: { 'x-wechat-studio': '1', host: '127.0.0.1:52889', 'sec-fetch-site': 'same-site' },
    }),
    fakeCtx(),
  )
  assert.equal(rejection.status, 403)
  assert.match(rejection.message, /其他站点/)
})

test('rejectCrossSite：连接层返回的状态码直接生效', () => {
  const rejection = rejectCrossSite(
    mockRequest({ headers: { host: '127.0.0.1:52889' } }),
    fakeCtx({ connection: { requestRejection: () => 401 } }),
  )
  assert.equal(rejection.status, 401)
  assert.equal(rejection.code, 'forbidden')
})

test('toErrorResponse：业务错误用 200，协议错误保留状态码', () => {
  const business = toErrorResponse(new StudioError('cover-required', '缺少封面图'))
  assert.equal(business.status, 200)
  assert.equal(business.body.ok, false)
  assert.equal(business.body.code, 'cover-required')

  const protocol = toErrorResponse(new HttpError(413, 'payload-too-large', '太大'))
  assert.equal(protocol.status, 413)
  assert.equal(protocol.body.code, 'payload-too-large')

  const network = toErrorResponse(new WechatApiError({ errcode: null, errmsg: 'x', endpoint: 'cgi-bin/token', kind: 'network' }))
  assert.equal(network.status, 200)
  assert.equal(network.body.code, 'network-error')

  const internal = toErrorResponse(new Error('boom'))
  assert.equal(internal.status, 200)
  assert.equal(internal.body.code, 'internal')
})

test('sendJson：写入 JSON、no-store 和 content-length', () => {
  const res = mockResponse()
  sendJson(res, 200, { ok: true, value: 1 })
  assert.equal(res.statusCode, 200)
  assert.match(res.headers['content-type'], /application\/json/)
  assert.equal(res.headers['cache-control'], 'no-store')
  assert.deepEqual(res.json(), { ok: true, value: 1 })
})

// ---------------------------------------------------------------------------
// index.js：路由分发
// ---------------------------------------------------------------------------

/** 挂载插件，返回注册的路由。 */
function mountPlugin(credentials) {
  let route
  const ctx = {
    get(name) {
      return name === 'credentials' ? credentials : undefined
    },
    effect(run) {
      return run()
    },
    webServer: {
      register(registration) {
        route = registration
        return () => {
          route = undefined
        }
      },
    },
  }
  apply(ctx, {})
  assert.ok(route, '插件必须注册一条路由')
  assert.equal(route.kind, 'exact')
  assert.equal(route.path, '/wechat-studio/api')
  return route
}

/** 调用一次路由，返回状态码与 JSON 响应体。 */
async function callRoute(route, { method = 'POST', headers = {}, body } = {}) {
  const res = mockResponse()
  await route.handler(mockRequest({ method, headers, body }), res)
  return { status: res.statusCode, headers: res.headers, body: res.json() }
}

const SAME_ORIGIN_HEADERS = {
  'content-type': 'application/json',
  'x-wechat-studio': '1',
  host: '127.0.0.1:52889',
  origin: 'http://127.0.0.1:52889',
  'sec-fetch-site': 'same-origin',
}

test('index.js：非 POST 返回 405', async () => {
  const route = mountPlugin(fakeCredentials())
  const response = await callRoute(route, { method: 'GET', headers: SAME_ORIGIN_HEADERS })
  assert.equal(response.status, 405)
  assert.equal(response.body.ok, false)
  assert.equal(response.body.code, 'method-not-allowed')
})

test('index.js：Content-Type 不是 JSON 返回 415', async () => {
  const route = mountPlugin(fakeCredentials())
  const response = await callRoute(route, {
    headers: { ...SAME_ORIGIN_HEADERS, 'content-type': 'text/plain' },
    body: { action: 'status' },
  })
  assert.equal(response.status, 415)
  assert.equal(response.body.code, 'unsupported-media-type')
})

test('index.js：缺少自定义请求头返回 403', async () => {
  const route = mountPlugin(fakeCredentials())
  const headers = { ...SAME_ORIGIN_HEADERS }
  delete headers['x-wechat-studio']
  const response = await callRoute(route, { headers, body: { action: 'status' } })
  assert.equal(response.status, 403)
  assert.equal(response.body.code, 'forbidden')
})

test('index.js：扁平 { action, ...payload } 请求走通 status', async () => {
  const credentials = fakeCredentials(ACCOUNT_RECORD)
  const route = mountPlugin(credentials)
  const response = await callRoute(route, {
    headers: SAME_ORIGIN_HEADERS,
    body: { action: 'status' },
  })
  assert.equal(response.status, 200)
  assert.deepEqual(response.body, {
    ok: true,
    value: { configured: true, appIdPreview: 'wx1234…cdef', tokenCached: false },
  })
})

test('index.js：嵌套 payload 写法也能保存配置', async () => {
  const credentials = fakeCredentials()
  const route = mountPlugin(credentials)
  const response = await callRoute(route, {
    headers: SAME_ORIGIN_HEADERS,
    body: { action: 'saveConfig', payload: { appId: APP_ID, appSecret: APP_SECRET } },
  })
  assert.equal(response.status, 200)
  assert.equal(response.body.ok, true)
  assert.equal(response.body.value.configured, true)
  assert.equal(credentials.store.has('wechat-studio/account'), true)
})

test('index.js：未知 action 返回业务错误', async () => {
  const route = mountPlugin(fakeCredentials())
  const response = await callRoute(route, {
    headers: SAME_ORIGIN_HEADERS,
    body: { action: 'deleteEverything' },
  })
  assert.equal(response.status, 200)
  assert.equal(response.body.ok, false)
  assert.equal(response.body.code, 'unknown-action')
})
