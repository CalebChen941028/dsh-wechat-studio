/**
 * Agent tool: render Markdown with the same engine the panel uses and save it
 * to the WeChat draft box.
 *
 * Kept beside the Host service so an Agent can drive the pipeline that the
 * browser UI drives, without a browser round trip.
 */

import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { parseArticle, composeDesign, autoCompose, measure } from '../src/engine.mjs'
import { buildArticle, serializeNodes, collectDataImages, rewriteImageSources } from '../src/render.mjs'

/** Images already on the WeChat CDN need no transfer. */
const WECHAT_IMAGE = /(mmbiz\.qpic\.cn|mmbiz\.qlogo\.cn|wx\.qlogo\.cn)/i

/** Collect remote image URLs that the draft body still points at. */
function collectRemoteImages(nodes) {
  const found = []
  const walk = list => {
    for (const node of list) {
      if (typeof node === 'string' || node === null || node === undefined) continue
      if (node.tag === 'img') {
        const src = node.attrs?.src
        if (typeof src === 'string' && /^https?:\/\//i.test(src) && !WECHAT_IMAGE.test(src) && !found.includes(src)) {
          found.push(src)
        }
      }
      walk(node.children ?? [])
    }
  }
  walk(nodes)
  return found
}

/** Today in the local timezone, for the article meta line. */
function today() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/**
 * Build the tool definition.
 * @param {{ service: object, StudioError: Function }} deps Host service and error class.
 * @returns {object} a ToolDefinition for ctx.tools.register.
 */
export function createDraftTool({ service, StudioError }) {
  return {
    name: 'wechat_studio_save_draft',
    description: 'Render a Markdown article with the WeChat studio engine and save it to the Official Account draft box. Nothing is published to followers; pass publish=true only when the user explicitly asks to publish now.',
    parameters: {
      type: 'object',
      properties: {
        markdown: { type: 'string', description: 'The complete article source in Markdown.' },
        title: { type: 'string', description: 'Draft title; falls back to the Markdown H1 when omitted.' },
        author: { type: 'string', description: 'Author byline, at most 8 characters (WeChat truncates the rest).' },
        digest: { type: 'string', description: 'Summary shown in the WeChat list, at most 120 characters.' },
        themeId: { type: 'string', description: 'Theme id: ink, paper, pine, ocean, magazine, rose, amber, night, festival, scholar, mint, mono. Omit to pick one from the content.' },
        variantId: { type: 'string', description: 'Variant id inside the theme; omit for the theme default.' },
        coverDataUrl: { type: 'string', description: 'Cover image as a PNG/JPEG data URL (900x383 recommended). Required unless coverMediaId is given.' },
        coverMediaId: { type: 'string', description: 'Existing WeChat permanent image media_id to use as the cover.' },
        coverPath: { type: 'string', description: 'Absolute path of a local PNG/JPEG to upload as the cover; an alternative to coverDataUrl.' },
        contentSourceUrl: { type: 'string', description: 'Optional "read original" link.' },
        publish: { type: 'boolean', description: 'Submit for publishing after the draft is saved. Only set true when the user explicitly asks to publish.' },
      },
      required: ['markdown'],
    },
    output: {
      schema: { type: 'object' },
      render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      try {
        const markdown = typeof args?.markdown === 'string' ? args.markdown : ''
        if (markdown.trim() === '') throw new StudioError('text-required', 'markdown 不能为空')
        const parsed = parseArticle(markdown)
        const title = (typeof args?.title === 'string' && args.title.trim() !== '' ? args.title.trim() : parsed.title).trim()
        if (title === '') throw new StudioError('title-required', '标题为空：传 title，或在 Markdown 第一行写 # 标题')
        const features = measure(parsed.blocks, markdown)
        const design = composeDesign(
          typeof args?.themeId === 'string'
            ? { themeId: args.themeId, variantId: typeof args?.variantId === 'string' ? args.variantId : undefined }
            : autoCompose(parsed.blocks, markdown, 0).design,
        )
        const tree = buildArticle({
          blocks: parsed.blocks,
          design,
          meta: {
            title,
            author: typeof args?.author === 'string' ? args.author : '',
            date: today(),
            readingMinutes: features.readingMinutes,
          },
        })

        const dataImages = collectDataImages(tree.nodes)
        if (dataImages.length > 0) {
          const uploaded = await service.uploadImages({
            images: dataImages.map((dataUrl, index) => ({ id: `img-${index}`, dataUrl, name: `image-${index}.jpg` })),
          })
          const mapping = new Map()
          for (const entry of uploaded.images ?? []) {
            const source = dataImages[Number(String(entry.id).replace('img-', ''))]
            if (source !== undefined && entry.url !== undefined) mapping.set(source, entry.url)
          }
          rewriteImageSources(tree.nodes, mapping)
        }
        const remoteImages = collectRemoteImages(tree.nodes)
        if (remoteImages.length > 0) {
          const imported = await service.importImages({ urls: remoteImages })
          const mapping = new Map()
          for (const entry of imported.images ?? []) {
            if (entry.url !== undefined && entry.wechatUrl !== undefined) mapping.set(entry.url, entry.wechatUrl)
          }
          rewriteImageSources(tree.nodes, mapping)
        }

        const html = serializeNodes(tree.nodes)
        if (html.length > 950 * 1024) throw new StudioError('content-too-large', '正文 HTML 超过 950KB，删掉几张图或缩短正文后再试')

        let coverMediaId = typeof args?.coverMediaId === 'string' && args.coverMediaId.trim() !== '' ? args.coverMediaId.trim() : undefined
        if (coverMediaId === undefined) {
          let coverDataUrl = typeof args?.coverDataUrl === 'string' ? args.coverDataUrl : ''
          if (coverDataUrl === '' && typeof args?.coverPath === 'string' && args.coverPath !== '') {
            const extension = extname(args.coverPath).toLowerCase()
            const mimeType = extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : 'image/png'
            coverDataUrl = `data:${mimeType};base64,${readFileSync(args.coverPath).toString('base64')}`
          }
          if (!/^data:image\/(png|jpeg);base64,/.test(coverDataUrl)) {
            throw new StudioError('cover-required', '缺少封面：传 coverDataUrl（900x383 的 PNG/JPEG data URL）或 coverMediaId')
          }
          const cover = await service.uploadCover({ dataUrl: coverDataUrl, name: 'cover.png' })
          coverMediaId = cover.mediaId
        }

        const draft = await service.createDraft({
          title,
          author: typeof args?.author === 'string' ? args.author : undefined,
          digest: typeof args?.digest === 'string' ? args.digest : undefined,
          content: html,
          thumbMediaId: coverMediaId,
          contentSourceUrl: typeof args?.contentSourceUrl === 'string' ? args.contentSourceUrl : undefined,
        })

        const result = {
          saved: true,
          mediaId: draft.mediaId,
          title,
          theme: `${design.themeName} · ${design.variantName}`,
          htmlBytes: html.length,
          warnings: draft.warnings ?? [],
        }
        if (args?.publish === true) {
          const published = await service.publish({ mediaId: draft.mediaId })
          result.publishId = published.publishId
          try {
            let status
            for (let attempt = 0; attempt < 4; attempt += 1) {
              await new Promise(resolve => setTimeout(resolve, 2500))
              status = await service.publishStatus({ publishId: published.publishId })
              if (status.publishStatus !== 1) break
            }
            result.publishStatus = status
          } catch (error) {
            result.publishStatus = { publishStatus: -1, statusText: `状态查询失败：${error instanceof Error ? error.message : String(error)}` }
          }
        }
        return result
      } catch (error) {
        if (error instanceof StudioError) throw error
        throw new StudioError(
          error !== null && typeof error === 'object' && typeof error.code === 'string' ? error.code : 'draft-failed',
          error instanceof Error ? error.message : String(error),
        )
      }
    },
  }
}
