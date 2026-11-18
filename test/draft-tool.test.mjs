import test from 'node:test'
import assert from 'node:assert/strict'

import { createDraftTool } from '../host/tool-draft.js'

class StudioError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

const COVER = 'data:image/png;base64,iVBORw0KGgo='

/** Fake Host service that records calls and returns WeChat-shaped results. */
function fakeService(overrides = {}) {
  const calls = []
  const service = {
    async uploadImages(payload) {
      calls.push(['uploadImages', payload])
      return { images: payload.images.map(image => ({ id: image.id, url: `https://mmbiz.qpic.cn/${image.id}.jpg` })) }
    },
    async importImages(payload) {
      calls.push(['importImages', payload])
      return { images: payload.urls.map(url => ({ url, wechatUrl: `https://mmbiz.qpic.cn/imported-${calls.length}.jpg` })) }
    },
    async uploadCover(payload) {
      calls.push(['uploadCover', payload])
      return { mediaId: 'cover-media-id', url: 'https://mmbiz.qpic.cn/cover.jpg' }
    },
    async createDraft(payload) {
      calls.push(['createDraft', payload])
      return { mediaId: 'draft-media-id', warnings: [] }
    },
    async publish(payload) {
      calls.push(['publish', payload])
      return { publishId: 'publish-id' }
    },
    async publishStatus(payload) {
      calls.push(['publishStatus', payload])
      return { publishStatus: 0, statusText: '发布成功' }
    },
    ...overrides,
  }
  return { service, calls }
}

function run(payload, overrides) {
  const { service, calls } = fakeService(overrides)
  const tool = createDraftTool({ service, StudioError })
  return { promise: tool.execute(payload), calls }
}

test('save draft renders Markdown with inline styles and uses the H1 as title', async () => {
  const { promise, calls } = run({ markdown: '# 我的标题\n\n第一段。\n\n> 引用。', coverMediaId: 'existing-cover' })
  const result = await promise
  assert.equal(result.saved, true)
  assert.equal(result.mediaId, 'draft-media-id')
  const draftCall = calls.find(call => call[0] === 'createDraft')
  assert.ok(draftCall, 'createDraft was called')
  const draft = draftCall[1]
  assert.equal(draft.title, '我的标题')
  assert.equal(draft.thumbMediaId, 'existing-cover')
  assert.ok(draft.content.includes('<section'))
  assert.ok(draft.content.includes('font-size'))
  assert.ok(!/class=/.test(draft.content))
  assert.ok(!/<style/.test(draft.content))
  assert.ok(draft.content.includes('我的标题'))
})

test('title argument wins over the H1 and long fields are handed to the host validators', async () => {
  const { promise, calls } = run({
    markdown: '# 正文标题\n\n内容',
    title: '发布标题',
    author: '张三',
    digest: '摘要',
    coverMediaId: 'cover',
    contentSourceUrl: 'https://example.com/post',
  })
  await promise
  const draft = calls.find(call => call[0] === 'createDraft')[1]
  assert.equal(draft.title, '发布标题')
  assert.equal(draft.author, '张三')
  assert.equal(draft.digest, '摘要')
  assert.equal(draft.contentSourceUrl, 'https://example.com/post')
})

test('a data URL image is uploaded and rewritten to the WeChat CDN', async () => {
  const { promise, calls } = run({
    markdown: '# 有图\n\n![配图](data:image/png;base64,iVBORw0KGgo=)',
    coverMediaId: 'cover',
  })
  const result = await promise
  assert.equal(result.saved, true)
  const upload = calls.find(call => call[0] === 'uploadImages')
  assert.ok(upload, 'uploadImages was called')
  assert.equal(upload[1].images.length, 1)
  const draft = calls.find(call => call[0] === 'createDraft')[1]
  assert.ok(draft.content.includes('mmbiz.qpic.cn/img-0.jpg'))
  assert.ok(!draft.content.includes('data:image/png'))
})

test('a remote image is imported before the draft is written', async () => {
  const { promise, calls } = run({
    markdown: '# 外链图\n\n![图](https://example.com/photo.png)',
    coverMediaId: 'cover',
  })
  await promise
  const imported = calls.find(call => call[0] === 'importImages')
  assert.ok(imported, 'importImages was called')
  assert.deepEqual(imported[1].urls, ['https://example.com/photo.png'])
  const draft = calls.find(call => call[0] === 'createDraft')[1]
  assert.ok(draft.content.includes('imported-'))
})

test('a missing cover is refused before any WeChat write', async () => {
  const { promise, calls } = run({ markdown: '# 无封面\n\n正文' })
  await assert.rejects(promise, error => {
    assert.equal(error.code, 'cover-required')
    return true
  })
  assert.equal(calls.some(call => call[0] === 'createDraft'), false)
})

test('coverDataUrl is uploaded once and its media_id reaches the draft', async () => {
  const { promise, calls } = run({ markdown: '# 有封面\n\n正文', coverDataUrl: COVER })
  await promise
  const cover = calls.find(call => call[0] === 'uploadCover')
  assert.ok(cover)
  assert.equal(cover[1].dataUrl, COVER)
  const draft = calls.find(call => call[0] === 'createDraft')[1]
  assert.equal(draft.thumbMediaId, 'cover-media-id')
})

test('publish=true submits the saved draft and reports the status', async () => {
  const { promise, calls } = run({ markdown: '# 发布测试\n\n正文', coverMediaId: 'cover', publish: true })
  const result = await promise
  assert.equal(result.publishId, 'publish-id')
  assert.equal(result.publishStatus.publishStatus, 0)
  assert.ok(calls.some(call => call[0] === 'publish' && call[1].mediaId === 'draft-media-id'))
})

test('empty Markdown and an empty title are refused with actionable codes', async () => {
  const tool = createDraftTool({ service: fakeService().service, StudioError })
  await assert.rejects(() => tool.execute({ markdown: '   ' }), error => error.code === 'text-required')
  await assert.rejects(() => tool.execute({ markdown: '只有正文，没有标题', coverMediaId: 'cover' }), error => error.code === 'title-required')
})

test('oversized HTML is refused before the cover upload', async () => {
  const big = '# 巨大\n\n' + '字'.repeat(960 * 1024)
  const { promise, calls } = run({ markdown: big, coverMediaId: 'cover' })
  await assert.rejects(promise, error => error.code === 'content-too-large')
  assert.equal(calls.some(call => call[0] === 'uploadCover'), false)
})
