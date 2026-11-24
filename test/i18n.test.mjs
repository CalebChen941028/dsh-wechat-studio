import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { t, uiLanguage, setUiLanguage, localizeError } from '../src/i18n.mjs'
import { THEMES } from '../src/themes.mjs'

test('t：中文模式原样返回，英文模式查词典', () => {
  setUiLanguage('zh')
  assert.equal(uiLanguage(), 'zh')
  assert.equal(t('编辑'), '编辑')
  setUiLanguage('en')
  assert.equal(t('编辑'), 'Edit')
  assert.equal(t('主题'), 'Theme')
})

test('t：中文模式也会替换占位参数', () => {
  setUiLanguage('zh')
  assert.equal(t('{chars} 字 · 约 {minutes} 分钟', { chars: 120, minutes: 2 }), '120 字 · 约 2 分钟')
})

test('t：未知文案回退中文，占位参数可替换', () => {
  setUiLanguage('en')
  assert.equal(t('没有翻译的文案'), '没有翻译的文案')
  assert.equal(t('编辑', { name: 'x' }), 'Edit')
  setUiLanguage('')
})


test('localizeError：英文模式翻译错误码，未知码保留原文', () => {
  setUiLanguage('en')
  assert.match(localizeError('title-required', '中文兜底'), /title/i)
  assert.match(localizeError('host-timeout', '中文兜底'), /timed out/i)
  assert.equal(localizeError('unknown-code', '中文兜底'), '中文兜底')
  setUiLanguage('zh')
  assert.equal(localizeError('title-required', '中文兜底'), '中文兜底')
})

test('UI_EN：词典不包含重复键', () => {
  const root = dirname(dirname(fileURLToPath(import.meta.url)))
  const source = readFileSync(join(root, 'src', 'i18n.mjs'), 'utf8')
  const match = /const UI_EN = \{([\s\S]*?)\n\}/.exec(source)
  assert.ok(match !== null, 'UI_EN catalog should exist')
  const seen = new Set()
  const duplicates = []
  for (const line of match[1].split('\n')) {
    const entry = /^\s*'((?:\\'|[^'])+)'\s*:/.exec(line)
    if (!entry) continue
    if (seen.has(entry[1])) duplicates.push(entry[1])
    seen.add(entry[1])
  }
  assert.deepEqual(duplicates, [])
})

test('主题与变体名称、描述都有英文翻译', () => {
  setUiLanguage('en')
  try {
    for (const theme of THEMES) {
      assert.notEqual(t(theme.name), theme.name, `theme name: ${theme.name}`)
      assert.notEqual(t(theme.tagline), theme.tagline, `tagline: ${theme.id}`)
      for (const variant of theme.variants) {
        assert.notEqual(t(variant.name), variant.name, `variant name: ${theme.id}/${variant.id}`)
      }
    }
    assert.equal(t('{count} 个版式', { count: 34 }), '34 layouts')
  } finally {
    setUiLanguage('zh')
  }
})
