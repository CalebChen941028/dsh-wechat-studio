/**
 * Pure helpers for the optional real-account fidelity check.
 *
 * Keeping HTML generation and comparison out of the network script lets the
 * suite run locally in dry-run mode and lets tests simulate a sanitizer that
 * drops SVG or background images.
 */
import { createHash } from 'node:crypto'
import { parseArticle, composeDesign } from '../src/engine.mjs'
import { THEMES } from '../src/themes.mjs'
import { buildArticle, serializeNodes } from '../src/render.mjs'

/** Small sample used when WX_FIDELITY_ALL is not set. */
export const LEAN_THEMES = [
  ['column', 'essay'],
  ['ink', 'index'],
  ['pine', 'clean'],
  ['magazine', 'cover'],
]

/** @param {boolean} all include every theme variant. */
export function fidelitySuite(all = false) {
  if (!all) return LEAN_THEMES.map(pair => [...pair])
  return THEMES.flatMap(theme => theme.variants.map(variant => [theme.id, variant.id]))
}

function stampNow() {
  return new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
}

/** Build the Markdown fixture rendered for one theme variant. */
export function themeHtml(themeId, variantId, imageUrl, stamp = stampNow()) {
  const text = `# 回归测试标题 ${stamp}\n\n开头段落，用来检查正文字体与行高是否保留。\n\n## 第一节\n\n这是第二节之前的正文，包含**加粗**与==高亮==。\n\n> 一句引文，检查引用样式是否保留。\n\n- 列表第一项\n- 列表第二项\n\n![测试配图](${imageUrl})\n\n## 第二节\n\n结尾段落，检查分割线与段落间距。`
  const parsed = parseArticle(text)
  const design = composeDesign({ themeId, variantId, overrides: {} })
  return serializeNodes(buildArticle({
    blocks: parsed.blocks,
    design,
    meta: { title: `回归测试标题 ${stamp}`, author: 'DSH', date: stamp.slice(0, 8), readingMinutes: 1 },
  }).nodes)
}

/**
 * Compare the renderer output with the HTML returned by WeChat.
 *
 * A theme is only faithful when the features present in the source survive:
 * SVG ornaments and background-image patterns are now part of the default
 * new-theme look, so they are hard failures rather than report-only flags.
 * @returns {object} checks and a final `ok` verdict.
 */
export function compareHtml(theme, original, returned) {
  const source = String(original ?? '')
  const result = String(returned ?? '')
  const requires = {
    background: /background/i.test(source),
    backgroundImage: /background-image\s*:/i.test(source),
    fontFamily: /font-family/i.test(source),
    section: /<section/i.test(source),
    image: /<img/i.test(source),
    svg: /<svg[\s>]/i.test(source),
  }
  const checks = {
    lengthRatio: source.length === 0 ? 0 : result.length / source.length,
    hasBackground: /background/i.test(result),
    hasBackgroundImage: /background-image\s*:/i.test(result),
    hasFontFamily: /font-family/i.test(result),
    hasSection: /<section/i.test(result),
    hasImage: /<img/i.test(result),
    svgDropped: requires.svg && !/<svg[\s>]/i.test(result),
    backgroundImageDropped: requires.backgroundImage && !/background-image\s*:/i.test(result),
    scriptFree: !/<script/i.test(result),
    sameHash: createHash('sha1').update(source).digest('hex') === createHash('sha1').update(result).digest('hex'),
  }
  const ok = checks.scriptFree
    && checks.lengthRatio > 0.8
    && checks.lengthRatio < 1.25
    && (!requires.background || checks.hasBackground)
    && (!requires.fontFamily || checks.hasFontFamily)
    && (!requires.section || checks.hasSection)
    && (!requires.image || checks.hasImage)
    && !checks.svgDropped
    && !checks.backgroundImageDropped
  return { theme, ...checks, requires, ok }
}

/** Shape the machine-readable report written by the network script. */
export function summarizeFidelity(report, suite, generatedAt = new Date().toISOString()) {
  return { generatedAt, suite, ok: report.every(item => item.ok), report }
}
