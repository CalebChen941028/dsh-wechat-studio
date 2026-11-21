import test from 'node:test'
import assert from 'node:assert/strict'

import {
  expandImageRefsWith, collectImageRefIds, findInlineImageDataUrls,
  materializeInlineImages, hasUnresolvedImageRefs,
} from '../src/images.mjs'

test('expandImageRefsWith 只替换缓存里存在的引用', () => {
  const text = 'a ![x](wsimg://img-1) b ![y](wsimg://img-2)'
  const expanded = expandImageRefsWith(text, id => (id === 'img-1' ? 'data:image/png;base64,AAAA' : undefined))
  assert.equal(expanded, 'a ![x](data:image/png;base64,AAAA) b ![y](wsimg://img-2)')
})

test('collectImageRefIds 去重并保持顺序', () => {
  const ids = collectImageRefIds('![a](wsimg://x) ![b](wsimg://y) ![c](wsimg://x)')
  assert.deepEqual(ids, ['x', 'y'])
})

test('findInlineImageDataUrls 找出 Markdown 里的 data URL 图片', () => {
  const text = '![图](data:image/png;base64,AAAA)\n\n![外链](https://example.com/a.png)\n\n![另一张](data:image/jpeg;base64,BBBB)'
  assert.deepEqual(findInlineImageDataUrls(text), ['data:image/png;base64,AAAA', 'data:image/jpeg;base64,BBBB'])
})

test('没有 IndexedDB 时 materializeInlineImages 保留原始 data URL', async () => {
  const text = '![图](data:image/png;base64,AAAA)'
  assert.equal(await materializeInlineImages(text), text)
})

test('hasUnresolvedImageRefs 在缓存为空时报告未解析引用', () => {
  assert.equal(hasUnresolvedImageRefs('![a](wsimg://missing)'), true)
  assert.equal(hasUnresolvedImageRefs('![a](https://example.com/a.png)'), false)
})

