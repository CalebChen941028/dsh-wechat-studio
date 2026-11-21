import test from 'node:test'
import assert from 'node:assert/strict'

import { indexedDB as fakeIndexedDB } from 'fake-indexeddb'

globalThis.indexedDB = fakeIndexedDB

const { saveDocsToDb, loadDocsFromDb, saveSnapshot, listSnapshots, clearSnapshots, appendLedgerEvent, listLedgerEvents, saveSnippet, listSnippets, deleteSnippet, appendStyleEvent, listStyleEvents, clearStyleEvents } = await import('../src/docdb.mjs')

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


test('saveSnapshot / listSnapshots / clearSnapshots 按文档保存版本', async () => {
  await saveSnapshot({ docId: 'doc-a', text: '第一版', reason: 'manual' })
  await new Promise(resolve => setTimeout(resolve, 5))
  await saveSnapshot({ docId: 'doc-a', text: '第二版', reason: 'before-ai' })
  await saveSnapshot({ docId: 'doc-b', text: '别的文档', reason: 'manual' })
  const list = await listSnapshots('doc-a')
  assert.equal(list.length, 2)
  assert.equal(list[0].text, '第二版')
  assert.equal(list[0].reason, 'before-ai')
  await clearSnapshots('doc-a')
  assert.deepEqual(await listSnapshots('doc-a'), [])
  assert.equal((await listSnapshots('doc-b')).length, 1)
})


test('appendLedgerEvent / listLedgerEvents 保留发布事件', async () => {
  await appendLedgerEvent({ docId: 'doc-a', type: 'draft', text: '第一版', mediaId: 'M1', title: '标题' })
  await new Promise(resolve => setTimeout(resolve, 5))
  await appendLedgerEvent({ docId: 'doc-a', type: 'published', text: '第二版', publishId: 'P1', title: '标题2' })
  await appendLedgerEvent({ docId: 'doc-b', type: 'draft', text: '别的文档' })
  const list = await listLedgerEvents('doc-a')
  assert.equal(list.length, 2)
  assert.equal(list[0].type, 'published')
  assert.equal(list[0].publishId, 'P1')
  assert.equal(list[0].text, '第二版')
})


test('snippet 增删查', async () => {
  const snippet = { id: 'snip-1', name: '作者简介', text: '{{author}} 是一名写作者。' }
  assert.equal(await saveSnippet(snippet), true)
  const list = await listSnippets()
  assert.equal(list.length, 1)
  assert.equal(list[0].name, '作者简介')
  assert.equal(await deleteSnippet('snip-1'), true)
  assert.deepEqual(await listSnippets(), [])
})


test('style memory 记录采用与放弃', async () => {
  await appendStyleEvent({ docId: 'doc-a', type: 'accepted', instruction: '标题改短', stylePreset: 'concise' })
  await new Promise(resolve => setTimeout(resolve, 5))
  await appendStyleEvent({ docId: 'doc-a', type: 'discarded', instruction: '改口语', stylePreset: 'spoken' })
  const list = await listStyleEvents()
  assert.equal(list.length, 2)
  assert.equal(list[0].type, 'discarded')
  await clearStyleEvents()
  assert.deepEqual(await listStyleEvents(), [])
})
