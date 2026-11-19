import test from 'node:test'
import assert from 'node:assert/strict'

import { t, uiLanguage, setUiLanguage, localizeError } from '../src/i18n.mjs'

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
