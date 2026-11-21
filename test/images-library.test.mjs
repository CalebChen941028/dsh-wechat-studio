import test from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'

globalThis.indexedDB = new IDBFactory()
const { materializeImage, listImages, deleteImage } = await import('../src/images.mjs')

test('素材库可以列出和删除已存图片', async () => {
  const ref = await materializeImage('data:image/png;base64,AAAA', { kind: 'library' })
  assert.match(ref, /^wsimg:\/\//)
  const list = await listImages()
  assert.equal(list.length, 1)
  assert.equal(list[0].kind, 'library')
  assert.equal(await deleteImage(list[0].id), true)
  assert.deepEqual(await listImages(), [])
})
