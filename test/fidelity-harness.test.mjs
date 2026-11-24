import test from 'node:test'
import assert from 'node:assert/strict'

import { THEMES } from '../src/themes.mjs'
import { compareHtml, fidelitySuite, themeHtml } from '../scripts/fidelity-lib.mjs'

const IMAGE = 'https://example.com/fidelity.png'
const STAMP = '20260101000000'

test('保真套件在 all 模式覆盖 18 套主题的 36 个变体', () => {
  const sample = fidelitySuite(false)
  assert.equal(sample.length, 4)
  const all = fidelitySuite(true)
  assert.equal(all.length, THEMES.reduce((count, theme) => count + theme.variants.length, 0))
  assert.equal(all.length, 36)
  assert.ok(all.some(([themeId, variantId]) => themeId === 'zine' && variantId === 'dossier'))
  assert.ok(all.some(([themeId, variantId]) => themeId === 'storybook' && variantId === 'fable'))
  assert.ok(all.some(([themeId, variantId]) => themeId === 'watercolor' && variantId === 'journal'))
})

test('compareHtml 把 SVG、底纹和脚本丢失判为失败', () => {
  const html = themeHtml('zine', 'spread', IMAGE, STAMP)
  const clean = compareHtml('zine/spread', html, html)
  assert.equal(clean.ok, true)
  assert.equal(clean.requires.svg, true)
  assert.equal(clean.requires.backgroundImage, true)
  assert.equal(clean.svgDropped, false)
  assert.equal(clean.backgroundImageDropped, false)

  const withoutSvg = html.replace(/<svg[\s>][\s\S]*?<\/svg>/g, '')
  const svgDropped = compareHtml('zine/spread', html, withoutSvg)
  assert.equal(svgDropped.svgDropped, true)
  assert.equal(svgDropped.ok, false)

  const withoutPattern = html.replace(/background-image\s*:[^;"]+;?/g, '')
  const patternDropped = compareHtml('zine/spread', html, withoutPattern)
  assert.equal(patternDropped.hasBackground, true)
  assert.equal(patternDropped.backgroundImageDropped, true)
  assert.equal(patternDropped.ok, false)

  const scripted = `${html}<script>alert(1)</script>`
  assert.equal(compareHtml('zine/spread', html, scripted).ok, false)
})

test('全部 36 个变体的生成 HTML 保留各自主题的氛围特征', () => {
  for (const [themeId, variantId] of fidelitySuite(true)) {
    const theme = THEMES.find(entry => entry.id === themeId)
    const html = themeHtml(themeId, variantId, IMAGE, STAMP)
    const expectedPattern = Boolean(theme?.surface?.pattern && theme.surface.pattern !== 'none')
    const expectedSvg = Boolean(theme?.surface?.ornament && theme.surface.ornament !== 'none')
    assert.equal(/background-image\s*:/i.test(html), expectedPattern, `${themeId}/${variantId} pattern`)
    assert.equal(/<svg[\s>]/i.test(html), expectedSvg, `${themeId}/${variantId} ornament`)
    assert.ok(!/undefined|NaN/.test(html), `${themeId}/${variantId} output is clean`)
    assert.equal(compareHtml(`${themeId}/${variantId}`, html, html).ok, true, `${themeId}/${variantId} self-check`)
  }
})
