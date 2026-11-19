import test from 'node:test'
import assert from 'node:assert/strict'

import { t, uiLanguage, setUiLanguage } from '../src/i18n.mjs'

test('t：中文模式原样返回，英文模式查词典', () => {
  setUiLanguage('zh')
  assert.equal(uiLanguage(), 'zh')
  assert.equal(t('编辑'), '编辑')
  setUiLanguage('en')
  assert.equal(t('编辑'), 'Edit')
  assert.equal(t('主题'), 'Theme')
})

test('t：未知文案回退中文，占位参数可替换', () => {
  setUiLanguage('en')
  assert.equal(t('没有翻译的文案'), '没有翻译的文案')
  assert.equal(t('编辑', { name: 'x' }), 'Edit')
  setUiLanguage('')
})
