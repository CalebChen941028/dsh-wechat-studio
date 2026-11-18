import test from 'node:test'
import assert from 'node:assert/strict'

import { createAiEditor } from '../host/ai.js'
import { createStudioService } from '../host/service.js'

/** Build a fake Cordis context with just the services the AI editor reads. */
function fakeContext({ selection = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, chunks = [], failAt = -1 } = {}) {
  const calls = []
  const llm = {
    async listProviders() {
      return [{ id: 'deepseek-official', name: 'DeepSeek' }]
    },
    async listModels() {
      return [{ id: 'deepseek-v4-flash', name: 'Flash' }]
    },
    async *stream(options) {
      calls.push(options)
      for (let index = 0; index < chunks.length; index += 1) {
        if (index === failAt) throw new Error('socket hang up')
        yield chunks[index]
      }
    },
  }
  const ctx = {
    get(name) {
      if (name === 'llm') return llm
      if (name === 'agentDefaultModel') {
        return { currentSelection: () => (selection === null ? undefined : selection) }
      }
      if (name === 'agents') {
        return {
          list: () => [
            { id: 'session-idle', status: 'idle' },
            { id: 'session-running', status: 'running' },
          ],
        }
      }
      return undefined
    },
  }
  return { ctx, calls }
}

const ARTICLE = '# 旧标题\n\n第一段内容。\n\n## 小节\n\n正文。'

function jsonReply(value) {
  return [{ type: 'text-delta', text: JSON.stringify(value) }, { type: 'finish', reason: { kind: 'stop' } }]
}

test('aiEdit sends the article and returns a structured text change', async () => {
  const { ctx, calls } = fakeContext({
    chunks: jsonReply({ reply: '把标题改短了', text: '# 新标题\n\n第一段内容。\n\n## 小节\n\n正文。' }),
  })
  const editor = createAiEditor({ ctx })
  const result = await editor.edit({
    instruction: '标题改短一点',
    text: ARTICLE,
    design: { themeId: 'ink', variantId: 'editorial', overrides: { bodySize: 15.5 } },
    meta: { title: '', author: '张三' },
  })
  assert.equal(result.reply, '把标题改短了')
  assert.match(result.text, /^# 新标题/)
  assert.equal(result.design, undefined)
  assert.equal(result.model.provider, 'deepseek-official')
  assert.equal(calls.length, 1)
  assert.ok(calls[0].messages[0].content[0].text.includes('标题改短一点'))
  assert.equal(calls[0].sessionId, 'session-running', 'active session id routes OpenCode requests')
  assert.ok(calls[0].messages[0].content[0].text.includes('旧标题'))
  assert.ok(calls[0].system.includes('JSON'))
})

test('aiEdit keeps only whitelisted design overrides and drops unknown themes as-is', async () => {
  const { ctx } = fakeContext({
    chunks: jsonReply({
      reply: '换成暖色',
      design: { themeId: 'amber', variantId: 'warm', overrides: { accent: '#C0603A', titleStyle: 'ribbon', evil: 'x', bodySize: 16, imageStyle: 'nope' } },
    }),
  })
  const result = await createAiEditor({ ctx }).edit({ instruction: '换成暖色主题', text: ARTICLE })
  assert.equal(result.design.themeId, 'amber')
  assert.equal(result.design.variantId, 'warm')
  assert.deepEqual(result.design.overrides, { bodySize: 16, titleStyle: 'ribbon', accent: '#C0603A' })
  assert.equal(result.text, undefined)
})

test('aiEdit ignores an unchanged text field', async () => {
  const { ctx } = fakeContext({ chunks: jsonReply({ reply: '不用改', text: ARTICLE }) })
  const result = await createAiEditor({ ctx }).edit({ instruction: '看看就行', text: ARTICLE })
  assert.equal(result.text, undefined)
  assert.match(result.reply, /没有产生实际修改/)
})

test('aiEdit falls back to plain reply when the model does not return JSON', async () => {
  const { ctx } = fakeContext({ chunks: [{ type: 'text-delta', text: '我觉得这篇文章可以再短一点。' }] })
  const result = await createAiEditor({ ctx }).edit({ instruction: '给点建议', text: ARTICLE })
  assert.equal(result.parseError, true)
  assert.match(result.reply, /再短一点/)
})

test('aiEdit reports an actionable error when the model fails', async () => {
  const { ctx } = fakeContext({ chunks: [{ type: 'text-delta', text: 'x' }, { type: 'text-delta', text: 'y' }], failAt: 1 })
  await assert.rejects(() => createAiEditor({ ctx }).edit({ instruction: '改标题', text: ARTICLE }), error => {
    assert.equal(error.code, 'model-failed')
    assert.match(error.message, /socket hang up/)
    return true
  })
})

test('aiEdit rejects empty instructions and empty articles', async () => {
  const { ctx } = fakeContext({ chunks: jsonReply({ reply: 'ok' }) })
  const editor = createAiEditor({ ctx })
  await assert.rejects(() => editor.edit({ instruction: '  ', text: ARTICLE }), error => error.code === 'instruction-required')
  await assert.rejects(() => editor.edit({ instruction: '改', text: '   ' }), error => error.code === 'text-required')
})

test('aiEdit reports a missing model service instead of throwing an unknown error', async () => {
  const ctx = { get: () => undefined }
  await assert.rejects(() => createAiEditor({ ctx }).edit({ instruction: '改', text: ARTICLE }), error => error.code === 'no-llm')
})

test('aiEdit falls back to the first registered provider when no default selection exists', async () => {
  const { ctx, calls } = fakeContext({ selection: null, chunks: jsonReply({ reply: 'ok' }) })
  const result = await createAiEditor({ ctx }).edit({ instruction: '改标题', text: ARTICLE })
  assert.equal(calls[0].provider, 'deepseek-official')
  assert.equal(calls[0].model, 'deepseek-v4-flash')
  assert.deepEqual(result.model, { provider: 'deepseek-official', model: 'deepseek-v4-flash' })
})

test('service.aiEdit converts AI failures into StudioError with the same code', async () => {
  const { ctx } = fakeContext({ chunks: [{ type: 'text-delta', text: 'x' }, { type: 'text-delta', text: 'y' }], failAt: 1 })
  const service = createStudioService({ ctx })
  await assert.rejects(() => service.aiEdit({ instruction: '改', text: ARTICLE }), error => {
    assert.equal(error.name, 'StudioError')
    assert.equal(error.code, 'model-failed')
    return true
  })
})


test('aiEdit prompt carries content analysis, editorial presets and the design brief', async () => {
  const { ctx, calls } = fakeContext({
    chunks: jsonReply({ reply: '按文化评论处理', design: { themeId: 'column', variantId: 'essay', overrides: { bg: '#F7F4EE', bgStyle: 'paper', ornament: 'corner', bodySize: 16, lineHeight: 1.92 } } }),
  })
  const result = await createAiEditor({ ctx }).edit({
    instruction: '按内容重新精排，做得有设计感',
    text: '# 一篇长文\n\n## 小节\n\n正文内容。',
    design: { themeId: 'ink', variantId: 'editorial' },
  })
  const prompt = calls[0].messages[0].content[0].text
  assert.match(prompt, /内容分析/)
  assert.match(prompt, /编辑预设/)
  assert.match(calls[0].system, /杂志美术编辑/)
  assert.match(calls[0].system, /矢量角标/)
  assert.match(calls[0].system, /bgStyle/)
  assert.equal(result.design.themeId, 'column')
  assert.deepEqual(result.design.overrides, { bg: '#F7F4EE', bgStyle: 'paper', ornament: 'corner', bodySize: 16, lineHeight: 1.92 })
})

test('aiEdit drops unknown background and ornament values', async () => {
  const { ctx } = fakeContext({
    chunks: jsonReply({ reply: '换背景', design: { themeId: 'column', overrides: { bg: 'red', bgStyle: 'stripes', ornament: 'star', bodySize: 16 } } }),
  })
  const result = await createAiEditor({ ctx }).edit({ instruction: '换个背景', text: ARTICLE })
  assert.equal(result.design.overrides.bg, undefined)
  assert.equal(result.design.overrides.bgStyle, undefined)
  assert.equal(result.design.overrides.ornament, undefined)
  assert.equal(result.design.overrides.bodySize, 16)
})
