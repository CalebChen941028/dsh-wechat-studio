#!/usr/bin/env node
/**
 * Opt-in real publish check.
 *
 * This publishes a temporary article to real followers, then deletes it through
 * freepublish/delete. Only run it against a test Official Account.
 *
 * Required: WX_APPID, WX_SECRET, WX_COVER_PATH, WX_ALLOW_PUBLISH=1
 */
import { readFileSync } from 'node:fs'

const BASE = 'https://api.weixin.qq.com'
const APPID = process.env.WX_APPID ?? ''
const SECRET = process.env.WX_SECRET ?? ''
const COVER_PATH = process.env.WX_COVER_PATH ?? ''
const ALLOW = process.env.WX_ALLOW_PUBLISH === '1'

if (APPID === '' || SECRET === '' || COVER_PATH === '') {
  console.error('设置 WX_APPID、WX_SECRET、WX_COVER_PATH 后再运行')
  process.exit(2)
}
if (!ALLOW) {
  console.error('这会真实发布并通知关注者。确认使用测试公众号后，加 WX_ALLOW_PUBLISH=1 再运行。')
  process.exit(2)
}

const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)

async function request(path, body, headers) {
  const response = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: headers ?? { 'content-type': 'application/json' },
    body: body === undefined ? undefined : (Buffer.isBuffer(body) ? body : JSON.stringify(body)),
  })
  return response.json()
}
function ok(value, label) {
  if (value?.errcode !== undefined && value.errcode !== 0) throw new Error(`${label}: ${value.errcode} ${value.errmsg ?? ''}`)
  return value
}
async function uploadCover(token) {
  const boundary = `----dsh${Date.now()}`
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="cover.png"\r\nContent-Type: image/png\r\n\r\n`),
    readFileSync(COVER_PATH),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  const value = await request(`cgi-bin/material/add_material?access_token=${token}&type=image`, body, {
    'content-type': `multipart/form-data; boundary=${boundary}`,
  })
  return ok(value, '上传封面').media_id
}
function articleIdFrom(detail) {
  const items = detail?.article_detail?.item
  if (Array.isArray(items) && typeof items[0]?.article_id === 'string') return items[0].article_id
  return ''
}

const result = { ok: false, steps: [] }
let token = ''
let mediaId = ''
let publishId = ''
let articleId = ''
try {
  token = ok(await request('cgi-bin/stable_token', { grant_type: 'client_credential', appid: APPID, secret: SECRET }), '获取 token').access_token
  const cover = await uploadCover(token)
  const created = ok(await request(`cgi-bin/draft/add?access_token=${token}`, {
    articles: [{
      title: `DSH 发布回归 ${stamp}`,
      author: 'DSH',
      digest: '真实发布回归测试，随后删除。',
      content: `<section><p>DSH publish smoke ${stamp}</p></section>`,
      thumb_media_id: cover,
      need_open_comment: 0,
      only_fans_can_comment: 0,
    }],
  }), '新建草稿')
  mediaId = created.media_id
  result.steps.push('draft-created')

  const submitted = ok(await request(`cgi-bin/freepublish/submit?access_token=${token}`, { media_id: mediaId }), '提交发布')
  publishId = submitted.publish_id
  result.steps.push('submitted')

  let detail = null
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 5000))
    detail = await request(`cgi-bin/freepublish/get?access_token=${token}`, { publish_id: publishId })
    if (detail.publish_status === 4 || detail.publish_status === 3) break
  }
  if (detail?.publish_status !== 4) throw new Error(`发布未成功：${detail?.publish_status ?? 'unknown'} ${detail?.fail_idx ?? ''}`)
  result.steps.push('published')
  articleId = articleIdFrom(detail)
  if (articleId === '') throw new Error('发布成功但没拿到 article_id，需要手动删除')

  ok(await request(`cgi-bin/freepublish/delete?access_token=${token}`, { article_id: articleId }), '删除已发布文章')
  result.steps.push('deleted')
  result.ok = true
  result.articleIdTail = articleId.slice(-8)
} catch (error) {
  result.error = error.message
  if (publishId !== '' && articleId === '') {
    try {
      const detail = await request(`cgi-bin/freepublish/get?access_token=${token}`, { publish_id: publishId })
      articleId = articleIdFrom(detail)
    } catch { /* best effort */ }
  }
  if (mediaId !== '' && articleId === '') {
    try { await request(`cgi-bin/draft/delete?access_token=${token}`, { media_id: mediaId }) } catch { /* best effort */ }
  }
  if (articleId !== '') result.manualCleanup = `publishId=${publishId} articleId=${articleId}`
}
console.log(JSON.stringify(result, null, 2))
if (!result.ok) process.exitCode = 1
