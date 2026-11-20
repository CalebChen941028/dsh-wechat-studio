#!/usr/bin/env node
/**
 * Optional real-account fidelity check.
 *
 * Requires WX_APPID and WX_SECRET. Creates one temporary draft per theme,
 * reads it back with draft/get, compares the returned HTML with what the
 * renderer produced, then deletes every draft and the temporary cover.
 *
 * Not part of CI: this writes to the real Official Account for a few seconds.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { parseArticle, composeDesign } from '../src/engine.mjs'
import { buildArticle, serializeNodes } from '../src/render.mjs'

const BASE = 'https://api.weixin.qq.com'
const APPID = process.env.WX_APPID ?? ''
const SECRET = process.env.WX_SECRET ?? ''
const COVER_PATH = process.env.WX_COVER_PATH ?? ''
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
const THEMES = [
  ['column', 'essay'],
  ['ink', 'index'],
  ['pine', 'clean'],
  ['magazine', 'cover'],
]

if (APPID === '' || SECRET === '') {
  console.error('设置 WX_APPID / WX_SECRET 后再运行：npm run e2e:wechat')
  process.exit(2)
}

function request(url, body, headers = {}) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async response => {
    const text = await response.text()
    try { return JSON.parse(text) } catch { throw new Error(`微信返回非 JSON：${text.slice(0, 200)}`) }
  })
}
function check(response, label) {
  if (response?.errcode !== undefined && response.errcode !== 0) {
    throw new Error(`${label}: ${response.errcode} ${response.errmsg ?? ''}`)
  }
  return response
}
function coverBytes() {
  if (COVER_PATH === '') throw new Error('设置 WX_COVER_PATH 指向一张 900×383 的 PNG 测试封面')
  return readFileSync(COVER_PATH)
}
async function uploadCover(token) {
  const canvas = coverBytes()
  const boundary = `----dsh${Date.now()}`
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="cover.png"\r\nContent-Type: image/png\r\n\r\n`),
    canvas,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  const response = await fetch(`${BASE}/cgi-bin/material/add_material?access_token=${token}&type=image`, {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body,
  }).then(res => res.json())
  return check(response, '上传测试封面').media_id
}
async function uploadContentImage(token) {
  const boundary = `----dsh${Date.now()}`
  const png = coverBytes()
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="content.png"\r\nContent-Type: image/png\r\n\r\n`),
    png,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  const response = await fetch(`${BASE}/cgi-bin/media/uploadimg?access_token=${token}`, {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body,
  }).then(res => res.json())
  return check(response, '上传测试正文图').url
}
function themeHtml(themeId, variantId, imageUrl) {
  const text = `# 回归测试标题 ${stamp}\n\n开头段落，用来检查正文字体与行高是否保留。\n\n## 第一节\n\n这是第二节之前的正文，包含**加粗**与==高亮==。\n\n> 一句引文，检查引用样式是否保留。\n\n- 列表第一项\n- 列表第二项\n\n![测试配图](${imageUrl})\n\n## 第二节\n\n结尾段落，检查分割线与段落间距。`
  const parsed = parseArticle(text)
  const design = composeDesign({ themeId, variantId, overrides: {} })
  return serializeNodes(buildArticle({
    blocks: parsed.blocks,
    design,
    meta: { title: `回归测试标题 ${stamp}`, author: 'DSH', date: stamp.slice(0, 8), readingMinutes: 1 },
  }).nodes)
}

function compare(theme, original, returned) {
  const checks = {
    lengthRatio: returned.length / original.length,
    hasBackground: /background/i.test(returned),
    hasFontFamily: /font-family/i.test(returned),
    hasSection: /<section/i.test(returned),
    hasImage: /<img/i.test(returned),
    svgDropped: /<svg/i.test(original) && !/<svg/i.test(returned),
    scriptFree: !/<script/i.test(returned),
    sameHash: createHash('sha1').update(original).digest('hex') === createHash('sha1').update(returned).digest('hex'),
  }
  return { theme, ...checks, ok: checks.scriptFree && checks.lengthRatio > 0.8 && checks.lengthRatio < 1.25 }
}

const token = check(await request(`${BASE}/cgi-bin/stable_token`, {
  grant_type: 'client_credential', appid: APPID, secret: SECRET,
}), '获取 access_token').access_token
const coverId = await uploadCover(token)
const imageUrl = await uploadContentImage(token)
const created = []
const report = []
try {
  for (const [themeId, variantId] of THEMES) {
    const html = themeHtml(themeId, variantId, imageUrl)
    const title = `DSH 保真回归 ${stamp} ${themeId}`
    const createdDraft = check(await request(`${BASE}/cgi-bin/draft/add?access_token=${token}`, {
      articles: [{
        title,
        author: 'DSH',
        digest: '真实账号版式保真回归，完成后删除。',
        content: html,
        thumb_media_id: coverId,
        need_open_comment: 0,
        only_fans_can_comment: 0,
      }],
    }), '新建草稿')
    created.push(createdDraft.media_id)
    const fetched = check(await request(`${BASE}/cgi-bin/draft/get?access_token=${token}`, { media_id: createdDraft.media_id }), '读取草稿')
    const returned = fetched.news_item?.[0]?.content ?? ''
    report.push(compare(`${themeId}/${variantId}`, html, returned))
  }
} finally {
  for (const mediaId of created) {
    try { await request(`${BASE}/cgi-bin/draft/delete?access_token=${token}`, { media_id: mediaId }) } catch { /* best effort */ }
  }
  try { await request(`${BASE}/cgi-bin/material/del_material?access_token=${token}`, { media_id: coverId }) } catch { /* best effort */ }
}
console.log(JSON.stringify({ ok: report.every(item => item.ok), report }, null, 2))
if (!report.every(item => item.ok)) process.exitCode = 1
