import test from 'node:test'
import assert from 'node:assert/strict'
import { createBrandKit, parseBrandKit, mergeBrandKits } from '../src/brandkit.mjs'

test('brand kit round-trips and merges presets/snippets', () => {
  const kit = createBrandKit({
    favorites: ['column', 'ink', 'column'],
    recent: ['pine'],
    dnaPresets: [{ id: 'dna-1', name: '参考', overrides: { accent: '#123456' } }],
    styleGuide: { tone: 'spoken', bannedWords: ['赋能'] },
    snippets: [{ id: 'snip-1', name: '简介', text: '你好' }],
  })
  assert.equal(kit.favorites.length, 2)
  assert.equal(parseBrandKit(kit).styleGuide.tone, 'spoken')
  const merged = mergeBrandKits(kit, {
    format: 'dsh-wechat-brand-kit', version: 1, favorites: ['amber'], recent: [], dnaPresets: [{ id: 'dna-2', name: '二', overrides: {} }],
    styleGuide: null, snippets: [{ id: 'snip-2', name: '二', text: '二' }],
  })
  assert.deepEqual(merged.favorites, ['column', 'ink', 'amber'])
  assert.equal(merged.dnaPresets.length, 2)
  assert.equal(merged.snippets.length, 2)
})

test('parseBrandKit rejects foreign JSON', () => {
  assert.equal(parseBrandKit(null), null)
  assert.equal(parseBrandKit({ foo: 1 }), null)
})
