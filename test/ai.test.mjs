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

test('aiEdit ignores legacy theme ids and only accepts custom designs', async () => {
  const { ctx } = fakeContext({
    chunks: jsonReply({
      reply: '换成暖色',
      design: { themeId: 'amber', variantId: 'warm', overrides: { accent: '#C0603A', bodySize: 16 } },
    }),
  })
  const result = await createAiEditor({ ctx }).edit({ instruction: '换成暖色主题', text: ARTICLE })
  assert.equal(result.design, undefined)
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


test('aiEdit prompt carries content analysis and a custom-only design brief', async () => {
  const { ctx, calls } = fakeContext({
    chunks: jsonReply({
      reply: '按文化评论处理',
      design: { custom: { name: '文化评论', palette: { bg: '#F7F4EE', accent: '#8E5E2F' }, surface: { pattern: 'paper', ornament: 'corner' }, options: { bodySize: 16 } } },
    }),
  })
  const result = await createAiEditor({ ctx }).edit({
    instruction: '按内容重新精排，做得有设计感',
    text: '# 一篇长文\n\n## 小节\n\n正文内容。',
    design: { themeId: 'ink', variantId: 'editorial' },
  })
  const prompt = calls[0].messages[0].content[0].text
  assert.match(prompt, /内容分析/)
  assert.match(prompt, /当前是旧版预设版式/)
  assert.match(calls[0].system, /独立美术指导/)
  assert.match(calls[0].system, /系统没有主题库/)
  assert.match(calls[0].system, /ornament/)
  assert.equal(result.design.themeId, undefined)
  assert.equal(result.design.custom.name, '文化评论')
  assert.equal(result.design.custom.palette.bg, '#F7F4EE')
})

const MIN_EXPECTED = 4096

test('aiEdit scales maxTokens with article length, capped at 8192', async () => {
  const short = await (async () => {
    const { ctx, calls } = fakeContext({ chunks: jsonReply({ reply: 'ok', design: { themeId: 'ink', overrides: { bodySize: 16 } } }) })
    await createAiEditor({ ctx }).edit({ instruction: '只改版式', text: ARTICLE })
    return calls[0].maxTokens
  })()
  assert.equal(short, MIN_EXPECTED)

  const { ctx, calls } = fakeContext({ chunks: jsonReply({ reply: 'ok', design: { themeId: 'ink', overrides: { bodySize: 16 } } }) })
  const medium = '# 长文\n\n' + '字'.repeat(3000)
  await createAiEditor({ ctx }).edit({ instruction: '只改版式', text: medium })
  assert.ok(calls[0].maxTokens > 4096, `got ${calls[0].maxTokens}`)
  assert.ok(calls[0].maxTokens <= 8192, `got ${calls[0].maxTokens}`)
})

test('aiEdit 对长文只允许改版式并丢弃返回的正文', async () => {
  const { ctx, calls } = fakeContext({
    chunks: jsonReply({ reply: '按长文处理', text: '# 新的标题\n\n被截断的正文', design: { themeId: 'column', variantId: 'essay' } }),
  })
  const longText = '# 长文\n\n' + '字'.repeat(8000)
  const result = await createAiEditor({ ctx }).edit({ instruction: '改一下标题', text: longText })
  assert.equal(calls[0].maxTokens, 2048)
  assert.match(calls[0].messages[0].content[0].text, /只允许修改 design/)
  assert.equal(result.text, undefined)
  assert.match(result.reply, /只应用了版式修改/)
})

test('aiEdit 在模型 max-tokens 截断时给出可执行的错误', async () => {
  const { ctx } = fakeContext({
    chunks: [
      { type: 'text-delta', text: '{"reply":"写到一半' },
      { type: 'finish', reason: { kind: 'max-tokens' } },
    ],
  })
  await assert.rejects(
    () => createAiEditor({ ctx }).edit({ instruction: '改正文', text: ARTICLE }),
    (error) => {
      assert.equal(error.code, 'response-truncated')
      assert.match(error.message, /拆成两段/)
      return true
    },
  )
})


test('aiEdit 接受 custom 设计里的图片宽度与对齐', async () => {
  const { ctx } = fakeContext({
    chunks: jsonReply({ reply: '图片调窄', design: { custom: { name: '窄图', options: { imageWidth: 70, imageAlign: 'left' } } } }),
  })
  const result = await createAiEditor({ ctx }).edit({ instruction: '图片窄一点，左对齐', text: ARTICLE })
  assert.equal(result.design.custom.options.imageWidth, 70)
  assert.equal(result.design.custom.options.imageAlign, 'left')
})


test('aiEdit 通过 onDelta 汇报生成进度', async () => {
  const { ctx } = fakeContext({ chunks: jsonReply({ reply: '好', design: { themeId: 'column' } }) })
  const sizes = []
  await createAiEditor({ ctx }).edit({ instruction: '改版式', text: ARTICLE }, { onDelta: chars => sizes.push(chars) })
  assert.ok(sizes.length >= 1)
  assert.equal(sizes.at(-1), JSON.stringify({ reply: '好', design: { themeId: 'column' } }).length)
})

test('aiEdit prompt carries the house style', async () => {
  const { ctx, calls } = fakeContext({ chunks: jsonReply({ reply: '好' }) })
  await createAiEditor({ ctx }).edit({
    instruction: '润色',
    text: ARTICLE,
    styleGuide: { tone: 'spoken', bannedWords: ['赋能'], preferredWords: ['读者'], maxParagraphChars: 90, requireCaptions: true },
  })
  const prompt = calls[0].messages[0].content[0].text
  assert.match(prompt, /语气 口语/)
  assert.match(prompt, /禁用词（不要出现）：赋能/)
  assert.match(prompt, /偏好词（优先使用）：读者/)
  assert.match(prompt, /段落不超过 90 字/)
  assert.match(prompt, /正文图片必须带图注/)
})

test('aiEdit prompt carries recent adopted edits', async () => {
  const { ctx, calls } = fakeContext({ chunks: jsonReply({ reply: '好' }) })
  await createAiEditor({ ctx }).edit({ instruction: '润色', text: ARTICLE, styleMemory: ['标题改短', '第二段压到两行'] })
  const prompt = calls[0].messages[0].content[0].text
  assert.match(prompt, /最近采用的改法：标题改短；第二段压到两行/)
})

test('aiEdit 接受 AI 原创 custom 设计而不是只选主题', async () => {
  const { ctx, calls } = fakeContext({
    chunks: jsonReply({
      reply: '设计了一套夜色版式',
      design: {
        custom: {
          name: '夜色',
          palette: { bg: '#101418', accent: '#D9A441' },
          type: { titleFont: 'serif', titleSize: 34, bodySize: 16 },
          surface: { pattern: 'halftone', ornament: 'star' },
          titleStyle: 'stacked', sectionStyle: 'folio', quoteStyle: 'margin', imageStyle: 'plate',
          options: { dropCap: true },
        },
      },
    }),
  })
  const result = await createAiEditor({ ctx }).edit({ instruction: '随便发挥你的审美，不要用模板', text: ARTICLE })
  assert.equal(result.design.custom.name, '夜色')
  assert.equal(result.design.custom.palette.bg, '#101418')
  assert.equal(result.design.custom.titleStyle, 'stacked')
  assert.equal(result.design.custom.options.dropCap, true)
  assert.match(calls[0].system, /原创优先/)
  assert.match(calls[0].system, /系统没有主题库/)
  assert.match(calls[0].system, /design\.custom/)
  assert.match(calls[0].messages[0].content[0].text, /当前没有自定义版式/)
  await createAiEditor({ ctx }).edit({ instruction: '再暗一点', text: ARTICLE, design: { custom: { name: '夜色' } } })
  assert.match(calls[1].messages[0].content[0].text, /当前是 AI 自定义版式/)
})
