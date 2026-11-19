import test from 'node:test'
import assert from 'node:assert/strict'

import { indexedDB as fakeIndexedDB } from 'fake-indexeddb'

globalThis.indexedDB = fakeIndexedDB

const { saveDocsToDb, loadDocsFromDb } = await import('../src/docdb.mjs')

test('saveDocsToDb / loadDocsFromDb 保留顺序与长正文', async () => {
  const longText = '长文正文。'.repeat(12000)
  const docs = [
    { id: 'doc-a', text: longText, meta: { title: 'A' }, design: {}, updatedAt: 1 },
    { id: 'doc-b', text: '# B', meta: { title: 'B' }, design: {}, updatedAt: 2 },
  ]
  assert.equal(await saveDocsToDb(docs), true)
  const loaded = await loadDocsFromDb()
  assert.ok(Array.isArray(loaded))
  assert.deepEqual(loaded.map(doc => doc.id), ['doc-a', 'doc-b'])
  assert.equal(loaded[0].text.length, longText.length)
  assert.equal(loaded[1].meta.title, 'B')
})

test('saveDocsToDb 拒绝非数组输入', async () => {
  assert.equal(await saveDocsToDb(null), false)
  assert.equal(await saveDocsToDb({ id: 'x' }), false)
})
