#!/usr/bin/env node
/**
 * Optional real-account fidelity check.
 *
 * Requires WX_APPID and WX_SECRET. Creates one temporary draft per variant,
 * reads it back with draft/get, compares the returned HTML with what the
 * renderer produced, then deletes every draft and the temporary cover.
 *
 * Set WX_FIDELITY_ALL=1 to cover all 21 themes × 2 variants. Without it, a
 * four-theme sample runs. Set WX_FIDELITY_DRY_RUN=1 to generate and inspect
 * every variant locally without calling WeChat.
 *
 * Not part of CI: the default mode writes to the real Official Account for a
 * few seconds.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { THEMES } from '../src/themes.mjs'
import { compareHtml, fidelitySuite, summarizeFidelity, themeHtml } from './fidelity-lib.mjs'

const BASE = 'https://api.weixin.qq.com'
const APPID = process.env.WX_APPID ?? ''
const SECRET = process.env.WX_SECRET ?? ''
const COVER_PATH = process.env.WX_COVER_PATH ?? ''
const ALL = process.env.WX_FIDELITY_ALL === '1'
const DRY_RUN = process.env.WX_FIDELITY_DRY_RUN === '1'
const SUITE = fidelitySuite(ALL)
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)

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

/** Local structural pass: no network, no cover, no credentials. */
function runDry() {
  const report = SUITE.map(([themeId, variantId]) => {
    const html = themeHtml(themeId, variantId, 'https://example.com/fidelity.png', stamp)
    const theme = THEMES.find(entry => entry.id === themeId)
    const expects = {
      background: true,
      backgroundImage: Boolean(theme?.surface?.pattern && theme.surface.pattern !== 'none'),
      svg: Boolean(theme?.surface?.ornament && theme.surface.ornament !== 'none'),
    }
    const hasBackgroundImage = /background-image\s*:/i.test(html)
    const hasSvg = /<svg[\s>]/i.test(html)
    const compared = compareHtml(`${themeId}/${variantId}`, html, html)
    return {
      ...compared,
      ok: compared.ok && hasBackgroundImage === expects.backgroundImage && hasSvg === expects.svg,
      bytes: html.length,
      expects,
      hasSvg,
      hasBackgroundImage,
    }
  })
  const summary = { ...summarizeFidelity(report, ALL ? 'all' : 'sample'), dryRun: true }
  console.log(JSON.stringify(summary, null, 2))
  process.exitCode = summary.ok ? 0 : 1
}

async function runReal() {
  if (APPID === '' || SECRET === '') {
    console.error('设置 WX_APPID / WX_SECRET 后再运行：npm run e2e:wechat')
    process.exitCode = 2
    return
  }
  const token = check(await request(`${BASE}/cgi-bin/stable_token`, {
    grant_type: 'client_credential', appid: APPID, secret: SECRET,
  }), '获取 access_token').access_token
  const coverId = await uploadCover(token)
  const imageUrl = await uploadContentImage(token)
  const created = []
  const report = []
  try {
    for (const [themeId, variantId] of SUITE) {
      const html = themeHtml(themeId, variantId, imageUrl, stamp)
      const title = `DSH 保真回归 ${stamp} ${themeId} ${variantId}`
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
      report.push(compareHtml(`${themeId}/${variantId}`, html, returned))
    }
  } finally {
    for (const mediaId of created) {
      try { await request(`${BASE}/cgi-bin/draft/delete?access_token=${token}`, { media_id: mediaId }) } catch { /* best effort */ }
    }
    try { await request(`${BASE}/cgi-bin/material/del_material?access_token=${token}`, { media_id: coverId }) } catch { /* best effort */ }
  }
  const summary = summarizeFidelity(report, ALL ? 'all' : 'sample')
  if (typeof process.env.WX_FIDELITY_OUT === 'string' && process.env.WX_FIDELITY_OUT !== '') {
    writeFileSync(process.env.WX_FIDELITY_OUT, JSON.stringify(summary, null, 2))
  }
  console.log(JSON.stringify(summary, null, 2))
  if (!summary.ok) process.exitCode = 1
}

if (DRY_RUN) runDry()
else await runReal()
