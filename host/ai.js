/**
 * 对话式修改：把当前文章、排版和用户指令发给当前默认模型，收回结构化修改。
 *
 * 模型通过 `ctx.llm` 调用（不需要 Session），模型选择来自
 * `ctx.agentDefaultModel.currentSelection()`。输出要求是严格 JSON，
 * 解析失败时退化成一句可读的说明，不让前端白屏。
 */

/** 模型响应上限，留足整篇正文重写的空间。 */
const MIN_MAX_TOKENS = 4096
const MAX_MAX_TOKENS = 8192
/** 超过这个长度时只允许改版式，避免正文被截断。 */
const LONG_TEXT_DESIGN_ONLY = 7000

/** 单次对话的超时时间。 */
const TIMEOUT_MS = 120000

/** 主题目录。直接从浏览器端 themes.mjs 生成，保持单一数据源。 */
import { customDesignFromLegacy, detectTopic, measure, normalizeCustomDesign, normalizeStyleGuide, parseArticle } from '../src/engine.mjs'

/** 装饰选项。与浏览器端 render/decor 选项一致。 */
const DECOR_OPTIONS = {
  titleStyle: ['rule', 'kicker', 'ribbon', 'tag', 'boxed', 'vertical', 'underline', 'centered', 'eyebrow', 'poster', 'stacked'],
  sectionStyle: ['bar', 'rule', 'tag', 'numbered', 'line', 'dot', 'ghost', 'brush', 'band', 'folio'],
  quoteStyle: ['bar', 'pull', 'card', 'center', 'tint', 'stamp', 'poster', 'margin'],
  dividerStyle: ['dots', 'diamond', 'ornament', 'line', 'dash', 'none', 'star'],
  listStyle: ['dot', 'num', 'square', 'arrow', 'dash'],
  imageStyle: ['plain', 'rounded', 'shadow', 'frame', 'polaroid', 'full', 'plate'],
  imageAlign: ['left', 'center', 'right'],
}

const SYSTEM_PROMPT = `你是「公众号排版工作台」的编辑助手。用户会用自然语言要求修改文章或版式。你只做两类事。

一、改文案。可以改写标题与小节标题、调整段落措辞、删减或合并段落、移动段落顺序、补一句过渡、改文末引导。硬规则：
- 不新增原文没有的事实、数字、人名、时间、引语；用户没要求扩写就不要扩写。
- 不改变原文的断言强度，「可能」不能改成「一定」，结论不能升级。
- 保留 Markdown 结构：# 标题、## 小节、### 小标题、> 引用、- 列表、1. 有序列表、![说明](url)、--- 分割线、**加粗**、==高亮==、行内代码。
- 中文句子自然平实，不用「赋能、闭环、底层逻辑、全方位、抓手」这类黑话，不加「让我们」式煽情排比。

二、改版式。你的角色是独立美术指导。系统没有主题库、没有预设版式可挑；每次都要从文章气质出发，生成一套完整 custom 设计：配色、字体、字号层级、留白、底纹、角标，以及标题/小节/引文/列表/配图的组合。
- 原创优先：用户说「精排 / 设计感 / 改版 / 换个风格 / 杂志风 / 插画风 / 海报风 / 画册风 / 构成风」时，直接输出 design.custom。不要引用 themeId、variantId 或任何主题名，也不要说“选了某个模板”。
- 全新设计、时尚杂志、画册、人物特稿类请求，默认启用 blueprint.cover 和 contents；封面是开头版式，不是单独封面图。至少让标题层级、首屏、目录和正文节奏发生结构变化，不要只换配色或字号。
- 风格方向（只定方向，不是限制）：杂志/画报用手写感眉标、编号小节、细线与大留白；插画/手账用奶油底、淡彩、圆角与拍立得；故事书/非虚构用象牙纸、衬线扉页、大行高；策展/画册用冷白或象牙底、网格、图版与页边注；海报/活动用整版标题、反白色带、网点与星号；分析/产品用低饱和纸色、编号与清晰层级。
- 视觉层级与呼吸感：标题与正文字号比 1.8–2.2 倍；长文 lineHeight 1.9–2.0、paraGap 22–26、paddingX 20–22；信息密集内容 lineHeight 1.75–1.85、paraGap 18–20；多图统一 imageWidth 与 imageAlign。
- 数值范围：bodySize 15-18、lineHeight 1.7-2.05、letterSpacing 0-0.05em、paraGap 18-30、paddingX 16-24、titleSize 20-40、titleWeight 400-800。
- 品质底线：正文 15–16px、行高 1.8–1.95、字距 0.01–0.03em、左右留白 16–20px；全文最多一个强调色，正文不用纯黑纯白，强调只给关键词、编号和 CTA。
- 每篇只保留一个记忆点：首字下沉、章节大编号、图版、反白色带、水彩横幅或一个角标，不要全部堆上。不用高饱和荧光色、彩虹拼盘、emoji、外发光和重阴影。
- design.custom 结构：
  * name / tagline：版式名与一句话气质，可省略。
  * palette：bg、card、text、secondary、accent、accentSoft、border，均为 #RRGGBB；accent 和 secondary 对 bg 至少 4.5:1。
  * type：titleFont/bodyFont 取 serif|sans|round；titleSize 20-40、titleWeight 400-800、titleTracking "-0.01em" 这类字符串、bodySize 15-18、lineHeight 1.7-2.05、letterSpacing "0.01em" 这类字符串、paraGap 18-30、paddingX 16-24。
  * surface：pattern 取 none|paper|grid|dots|lines|wash|watercolor|halftone；ornament 取 none|corner|column|seal|leaf|sprig|star。
  * titleStyle、sectionStyle、quoteStyle、dividerStyle、listStyle、imageStyle：取值见用户消息里的「可用装饰」。
  * options：dropCap/lead/showMeta/showFooter/showEyebrow 布尔；eyebrow/footerText/footerSign 文本；imageWidth 40-100；imageAlign 取 left|center|right。
  * blueprint：可选，做杂志封面或画册开头时启用。cover = { enabled, style（magazine|poster|split|minimal）, masthead, issue, kicker, lines（最多 3 条短导读）, image（first|none）, align（left|center） }；contents 为布尔，按小节生成目录。
- 用户只要求微调时，也在当前 custom 基础上返回完整一套，不要只给一个颜色。
- 只要用户要求改版式，就必须返回 design.custom；只回一句说明、不返回 custom，视为没有完成设计任务。
- 只输出 design = { "custom": { ... } }。不要输出 themeId、variantId、overrides、HTML 或 CSS，不要发明装饰 id。

只输出一个 JSON 对象，不要代码围栏、不要解释文字。字段：
- reply：一句话说明改了什么，直接说，不客套。
- text：修改后的完整 Markdown 全文（不是 diff）。没改正文就省略。
- design：{ "custom": { ... } }。没改版式就省略。
- meta：{ "title": "...", "digest": "..." }。没改就省略。

用户只要求改版式时，不要动 text；只要求改文案时，不要动 design。`

/** 对话式修改失败。 */
class AiError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'AiError'
    this.code = code
  }
}

/**
 * 读取当前默认模型；没有默认选择时退回第一个可用 provider 的第一个模型。
 * @param {object} ctx Cordis 上下文。
 * @returns {Promise<{ provider: string, model: string, reasoningEffort?: string }>}
 */
async function resolveModel(ctx, llm) {
  const owner = ctx.get('agentDefaultModel')
  if (owner !== undefined && owner !== null && typeof owner.currentSelection === 'function') {
    try {
      const selection = owner.currentSelection()
      if (selection && typeof selection.provider === 'string' && typeof selection.model === 'string') {
        return {
          provider: selection.provider,
          model: selection.model,
          reasoningEffort: typeof selection.reasoningEffort === 'string' ? selection.reasoningEffort : undefined,
        }
      }
    } catch {
      // Fall through to the provider catalog.
    }
  }
  const providers = await llm.listProviders()
  if (!Array.isArray(providers) || providers.length === 0) {
    throw new AiError('no-model', '当前没有可用的模型。到「设置 → 模型」里配置一个后，再回来对话。')
  }
  for (const provider of providers) {
    const models = await llm.listModels(provider.id)
    if (Array.isArray(models) && models.length > 0 && typeof models[0].id === 'string') {
      return { provider: provider.id, model: models[0].id }
    }
  }
  throw new AiError('no-model', '当前没有可用的模型。到「设置 → 模型」里配置一个后，再回来对话。')
}

/**
 * 找一个 live Session id。
 *
 * OpenCode 这类路由要求请求带 `x-opencode-session`，缺了会被服务端直接拒绝；
 * 这个插件没有自己的 Session，所以借用当前进程里活跃的 Session id 作为路由键。
 * @param {object} ctx Cordis 上下文。
 * @returns {string|undefined} 可用的 Session id。
 */
function pickSessionId(ctx) {
  const agents = ctx.get('agents')
  if (agents === undefined || agents === null || typeof agents.list !== 'function') return undefined
  try {
    const list = agents.list()
    if (!Array.isArray(list) || list.length === 0) return undefined
    const running = list.find(agent => agent?.status === 'running')
    const chosen = running ?? list[list.length - 1]
    const id = chosen?.id ?? chosen?.session?.id
    return typeof id === 'string' && id !== '' ? id : undefined
  } catch {
    return undefined
  }
}

/** 文章太长时保留头尾，避免把上下文塞爆。 */
function clipArticle(text, limit = 14000) {
  if (text.length <= limit) return { text, clipped: false }
  const head = text.slice(0, Math.round(limit * 0.7))
  const tail = text.slice(-Math.round(limit * 0.25))
  return { text: `${head}\n\n……（中间省略 ${text.length - head.length - tail.length} 字）……\n\n${tail}`, clipped: true }
}

/** 拼用户消息。 */
function buildUserPrompt(payload) {
  const text = typeof payload?.text === 'string' ? payload.text : ''
  const instruction = typeof payload?.instruction === 'string' ? payload.instruction.trim() : ''
  const design = payload?.design && typeof payload.design === 'object' ? payload.design : {}
  const meta = payload?.meta && typeof payload.meta === 'object' ? payload.meta : {}
  const history = Array.isArray(payload?.history) ? payload.history.slice(-6) : []
  const article = clipArticle(text)
  const designOnly = article.clipped || text.length > LONG_TEXT_DESIGN_ONLY
  const lines = []
  lines.push(`用户指令：${instruction}`)
  lines.push('')
  const parsed = parseArticle(text)
  const topic = detectTopic(text)
  const features = measure(parsed.blocks, text)
  const titleLength = (parsed.title ?? '').length
  lines.push('内容分析：')
  lines.push(`- 主题：${topic.label}（${topic.topic}）`)
  lines.push(`- 结构：${features.headings} 个小节 / ${features.paragraphs} 段 / ${features.quotes} 段引用 / ${features.listItems} 条列表 / ${features.images} 张图 / ${features.codeBlocks} 段代码`)
  lines.push(`- 篇幅：${features.chars} 字，约 ${features.readingMinutes} 分钟；平均段长 ${features.avgParagraph} 字；标题 ${titleLength} 字`)
  lines.push('')
  lines.push(`当前标题：${typeof meta.title === 'string' && meta.title.trim() !== '' ? meta.title.trim() : '（正文第一行 # 标题）'}`)
  lines.push(`当前作者：${typeof meta.author === 'string' && meta.author.trim() !== '' ? meta.author.trim() : '（未填）'}`)
  const style = normalizeStyleGuide(payload?.styleGuide)
  const memory = Array.isArray(payload?.styleMemory) ? payload.styleMemory.filter(item => typeof item === 'string' && item.trim() !== '').slice(0, 3) : []
  const toneLabel = style.tone === 'spoken' ? '口语' : style.tone === 'professional' ? '专业' : style.tone === 'story' ? '故事' : '克制'
  lines.push(`写作规范：语气 ${toneLabel}；段落不超过 ${style.maxParagraphChars} 字${style.requireCaptions ? '；正文图片必须带图注' : ''}`)
  if (style.bannedWords.length > 0) lines.push(`禁用词（不要出现）：${style.bannedWords.join('、')}`)
  if (style.preferredWords.length > 0) lines.push(`偏好词（优先使用）：${style.preferredWords.join('、')}`)
  if (memory.length > 0) lines.push(`最近采用的改法：${memory.join('；')}`)
  const mode = payload?.mode === 'fresh' ? 'fresh' : 'refine'
  if (mode === 'fresh') {
    lines.push('设计模式：全新设计。不要沿用当前版式、主题或旧配色；先为这篇文章重新定封面、字体、层级、留白和节奏，再给完整 custom 设计。')
  } else if (design.custom !== undefined && design.custom !== null && typeof design.custom === 'object') {
    lines.push(`当前是 AI 自定义版式，可在此基础上微调：${JSON.stringify(design.custom)}`)
  } else if (typeof design.themeId === 'string') {
    lines.push(`当前是旧版预设版式（${design.themeId}）；请把它转换成完整的 custom 设计，不要引用主题 id。`)
  } else {
    lines.push('当前没有自定义版式；请按内容原创一套 custom 设计。')
  }
  lines.push(`当前手动微调：${JSON.stringify(design.overrides ?? {}, null, 0)}`)
  lines.push(`可用装饰：${Object.entries(DECOR_OPTIONS).map(([key, values]) => `${key}=${values.join('/')}`).join('；')}`)
  if (history.length > 0) {
    lines.push('')
    lines.push('最近对话：')
    for (const turn of history) {
      const role = turn?.role === 'assistant' ? '助手' : '用户'
      const content = typeof turn?.content === 'string' ? turn.content.slice(0, 300) : ''
      if (content !== '') lines.push(`${role}：${content}`)
    }
  }
  lines.push('')
  lines.push(`当前文章（Markdown${article.clipped ? '，已省略中间部分' : ''}）：`)
  lines.push('<<<ARTICLE')
  lines.push(article.text)
  lines.push('ARTICLE>>>')
  if (article.clipped) {
    lines.push('')
    lines.push('注意：这篇文章过长，上面只是节选。本次只允许修改 design，不要返回 text，否则正文会丢失。')
  } else if (designOnly) {
    lines.push('')
    lines.push('注意：这篇文章较长，本次只允许修改 design，不要返回 text，避免长文被截断。')
  }
  return { prompt: lines.join('\n'), clipped: article.clipped, designOnly }
}

/** 从模型输出里取出 JSON；容忍代码围栏和前后说明文字。 */
function parseModelJson(raw) {
  const trimmed = raw.trim()
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)
  const candidate = fenced === null ? trimmed : fenced[1].trim()
  const first = candidate.indexOf('{')
  const last = candidate.lastIndexOf('}')
  if (first === -1 || last === -1 || last <= first) return null
  try {
    return JSON.parse(candidate.slice(first, last + 1))
  } catch {
    return null
  }
}

/**
 * 创建对话式修改器。每次调用重新读模型选择，切换模型后不用重启。
 * @param {{ ctx: object }} options
 * @returns {{ edit: (payload: object) => Promise<object> }}
 */
export function createAiEditor({ ctx }) {
  return {
    /**
     * 执行一次对话修改。
     * @param {{ instruction: string, text: string, design?: object, meta?: object, history?: object[] }} payload
     * @returns {Promise<{ reply: string, text?: string, design?: object, meta?: object, model: object, parseError?: true }>}
     */
    async edit(payload, hooks = {}) {
      const llm = ctx.get('llm')
      if (llm === undefined || llm === null || typeof llm.stream !== 'function') {
        throw new AiError('no-llm', '当前运行环境没有可用的模型服务，没法进行对话修改。')
      }
      const instruction = typeof payload?.instruction === 'string' ? payload.instruction.trim() : ''
      if (instruction === '') throw new AiError('instruction-required', '先说一句想怎么改，例如「标题更有冲击力」「这段压缩到两行」。')
      if (instruction.length > 2000) throw new AiError('instruction-too-long', '指令太长，压缩到 2000 字以内再发。')
      const sourceText = typeof payload?.text === 'string' ? payload.text : ''
      if (sourceText.trim() === '') throw new AiError('text-required', '编辑区还是空的，先写点内容再让模型改。')
      if (sourceText.length > 120000) throw new AiError('text-too-long', '正文字数超出上限，先拆分文章再对话修改。')

      const model = await resolveModel(ctx, llm)
      const sessionId = pickSessionId(ctx)
      const { prompt: userPrompt, clipped, designOnly } = buildUserPrompt(payload)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
      const maxTokens = designOnly
        ? 2048
        : Math.min(MAX_MAX_TOKENS, Math.max(MIN_MAX_TOKENS, Math.ceil(sourceText.length * 1.8) + 600))
      const creativeBrief = /设计|版式|排版|风格|海报|画册|杂志|创意|审美|模板|好看|丑/.test(instruction)
      let output = ''
      let truncated = false
      try {
        for await (const chunk of llm.stream({
          provider: model.provider,
          model: model.model,
          ...(model.reasoningEffort === undefined ? {} : { reasoningEffort: model.reasoningEffort }),
          ...(sessionId === undefined ? {} : { sessionId }),
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }],
          temperature: creativeBrief ? 0.5 : 0.3,
          maxTokens,
          signal: controller.signal,
        })) {
          if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
            output += chunk.text
            if (typeof hooks.onDelta === 'function') hooks.onDelta(output.length)
          }
          else if (chunk?.type === 'finish' && chunk.reason?.kind === 'error') {
            throw new AiError('model-failed', `模型返回失败：${chunk.reason.failure?.message ?? '未知原因'}`)
          } else if (chunk?.type === 'finish' && chunk.reason?.kind === 'aborted') {
            throw new AiError('ai-aborted', '这次修改被中止了，重新发一次即可。')
          } else if (chunk?.type === 'finish' && ['max-tokens', 'length', 'max_tokens'].includes(chunk.reason?.kind)) {
            truncated = true
          }
        }
      } catch (error) {
        if (error instanceof AiError) throw error
        if (controller.signal.aborted) throw new AiError('ai-timeout', '模型响应超时。可以再试一次，或把文章拆短一点。')
        throw new AiError('model-failed', `模型调用失败：${error instanceof Error ? error.message : String(error)}`)
      } finally {
        clearTimeout(timer)
      }

      if (output.trim() === '') throw new AiError('empty-response', '模型没有返回内容，换一句指令再试。')
      if (truncated) {
        throw new AiError('response-truncated', '模型输出被截断：这篇文章偏长，本次只改了版式；要改正文就把文章拆成两段再试。')
      }
      const parsed = parseModelJson(output)
      if (parsed === null) {
        return {
          reply: output.trim().slice(0, 500),
          model,
          parseError: true,
        }
      }

      const result = { reply: '', model }
      result.reply = typeof parsed.reply === 'string' && parsed.reply.trim() !== ''
        ? parsed.reply.trim().slice(0, 500)
        : '已按你的要求修改。'
      if (typeof parsed.text === 'string' && parsed.text.trim() !== '' && parsed.text !== sourceText) {
        result.text = parsed.text
      }
      if (parsed.design && typeof parsed.design === 'object' && !Array.isArray(parsed.design)) {
        const design = {}
        const custom = normalizeCustomDesign(parsed.design.custom)
        if (custom !== null) design.custom = { ...custom, source: 'ai' }
        else if (typeof parsed.design.themeId === 'string') {
          // Compatibility for a model that still returns a legacy theme id.
          design.custom = customDesignFromLegacy(parsed.design)
        }
        if (Object.keys(design).length > 0) result.design = design
      }
      if (parsed.meta && typeof parsed.meta === 'object' && !Array.isArray(parsed.meta)) {
        const meta = {}
        if (typeof parsed.meta.title === 'string' && parsed.meta.title.length <= 120) meta.title = parsed.meta.title
        if (typeof parsed.meta.digest === 'string' && parsed.meta.digest.length <= 200) meta.digest = parsed.meta.digest
        if (Object.keys(meta).length > 0) result.meta = meta
      }
      if ((clipped || designOnly) && result.text !== undefined) {
        delete result.text
        result.reply = `${result.reply}（文章较长，这次只应用了版式修改，正文没有替换）`
      }
      if (result.text === undefined && result.design === undefined && result.meta === undefined) {
        result.reply = `${result.reply}（这次没有产生实际修改）`
      }
      return result
    },
  }
}

export { AiError }
