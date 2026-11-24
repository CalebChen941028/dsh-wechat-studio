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
import { detectTopic, measure, normalizeStyleGuide, parseArticle } from '../src/engine.mjs'
import { THEMES } from '../src/themes.mjs'

const THEME_CATALOG = THEMES.map(theme => [
  theme.id,
  theme.name,
  theme.tagline,
  theme.variants.map(variant => variant.id).join('/'),
])

/** 编辑预设：给模型一个高设计感的起点，再按文章实际情况微调。 */
const DESIGN_PRESETS = [
  ['杂志特稿 / 文化评论', 'column / essay', 'titleSize 31、bodySize 16、lineHeight 1.92、paraGap 24、paddingX 20、titleStyle kicker、sectionStyle rule、quoteStyle pull'],
  ['独立画报 / 城市与生活特辑', 'zine / spread', 'bg #FAF8F4、bgStyle lines、ornament corner、titleSize 33、bodySize 15.5、lineHeight 1.88、paddingX 20、titleStyle kicker、sectionStyle ghost、quoteStyle pull、imageStyle full'],
  ['插画绘本 / 亲子美食手账', 'illustration / picturebook', 'bg #FFFBF2、bgStyle wash、ornament leaf、titleSize 30、bodySize 15.5、lineHeight 1.9、paddingX 20、titleStyle tag、sectionStyle dot、quoteStyle card、imageStyle polaroid'],
  ['故事书 / 非虚构与情感长文', 'storybook / chapter', 'bg #F9F4E8、bgStyle paper、ornament seal、titleSize 30、bodySize 16、lineHeight 1.98、paraGap 25、paddingX 22、titleStyle rule、sectionStyle line、quoteStyle center、imageStyle frame'],
  ['策展画册 / 建筑摄影与审美', 'gallery / exhibit', 'bg #F7F7F5、bgStyle grid、ornament column、titleSize 29、bodySize 15、lineHeight 1.88、paddingX 22、titleStyle boxed、sectionStyle numbered、quoteStyle stamp、imageStyle frame'],
  ['人物口述 / 暖调随笔', 'paper / letter', 'bodySize 16、lineHeight 1.95、paddingX 20、quoteStyle card、imageStyle polaroid'],
  ['行业分析 / 商业复盘', 'ocean / report', 'titleSize 28、bodySize 15.5、lineHeight 1.8、paraGap 20、paddingX 18、sectionStyle numbered'],
  ['产品说明 / 工具方法', 'mint / minimal', 'titleSize 27、bodySize 15.5、lineHeight 1.78、paddingX 18、sectionStyle bar、imageStyle rounded'],
  ['研究 / 数据长文', 'scholar / paper', 'bodySize 16、lineHeight 1.9、paraGap 24、paddingX 20、sectionStyle numbered、quoteStyle bar'],
  ['教程 / 经验分享', 'pine / clean', 'titleSize 28、bodySize 16、lineHeight 1.85、paddingX 18、listStyle dot'],
  ['视觉封面 / 品牌企划', 'magazine / cover', 'titleSize 34、bodySize 15.5、lineHeight 1.75、paddingX 16、sectionStyle ghost、imageStyle full'],
  ['日常 / 审美生活', 'rose / soft', 'titleSize 29、bodySize 15.5、lineHeight 1.85、paddingX 20、quoteStyle center'],
  ['节庆 / 祝福', 'festival / greeting', 'titleSize 30、bodySize 16、lineHeight 1.8、paddingX 18'],
]

/** 装饰选项。与浏览器端 render/decor 选项一致。 */
const DECOR_OPTIONS = {
  titleStyle: ['rule', 'kicker', 'ribbon', 'tag', 'boxed', 'vertical', 'underline', 'centered', 'eyebrow'],
  sectionStyle: ['bar', 'rule', 'tag', 'numbered', 'line', 'dot', 'ghost'],
  quoteStyle: ['bar', 'pull', 'card', 'center', 'tint', 'stamp'],
  dividerStyle: ['dots', 'diamond', 'ornament', 'line', 'dash', 'none'],
  listStyle: ['dot', 'num', 'square', 'arrow'],
  imageStyle: ['plain', 'rounded', 'shadow', 'frame', 'polaroid', 'full'],
  imageAlign: ['left', 'center', 'right'],
  bgStyle: ['none', 'paper', 'grid', 'dots', 'lines', 'wash'],
  ornament: ['none', 'corner', 'column', 'seal', 'leaf'],
}

const SYSTEM_PROMPT = `你是「公众号排版工作台」的编辑助手。用户会用自然语言要求修改文章或版式。你只做两类事。

一、改文案。可以改写标题与小节标题、调整段落措辞、删减或合并段落、移动段落顺序、补一句过渡、改文末引导。硬规则：
- 不新增原文没有的事实、数字、人名、时间、引语；用户没要求扩写就不要扩写。
- 不改变原文的断言强度，「可能」不能改成「一定」，结论不能升级。
- 保留 Markdown 结构：# 标题、## 小节、### 小标题、> 引用、- 列表、1. 有序列表、![说明](url)、--- 分割线、**加粗**、==高亮==、行内代码。
- 中文句子自然平实，不用「赋能、闭环、底层逻辑、全方位、抓手」这类黑话，不加「让我们」式煽情排比。

二、改版式。你的角色是杂志美术编辑：先判断文章气质与目标流派，再选主题与版式变体，最后统筹底纹、角标、字号层级与配图语言。只输出 design 字段，不要发明不存在的主题或装饰 id。
- 流派与主题映射：
  * 杂志 / 画报 / 高级编辑感：优先 zine（spread/dossier）、column（essay/feature）或 magazine（cover/feature）；用 kicker/eyebrow 眉标、ghost/rule 小节与 pull 上下细线拉引制造刊物节奏，可配 lines 底纹与 corner 角标。
  * 插画 / 绘本 / 手账 / 轻快温暖：优先 illustration（picturebook/sketch）；用奶油暖底、wash 淡彩底纹、leaf 叶形角标、tag/ribbon 标题、card/tint 引文与 polaroid/rounded 配图。
  * 故事书 / 纸质书 / 沉浸叙事 / 童话寓言：优先 storybook（chapter/fable）或 paper（letter/scroll）；用象牙纸底、paper 纸纹、seal 印记角标、rule/centered 扉页标题、line 居中细线小节与大行高（1.92–2.0）。
  * 策展 / 美术馆 / 摄影建筑画册：优先 gallery（exhibit/catalog）；用冷白墙面、grid 微弱网格、column 栏线角标、boxed 展签标题、stamp 摘录框与 frame 画框图。
  * 分析复盘 / 学术研究 / 产品说明：分别优先 ocean/scholar/mint/pine/mono。
- 视觉层级与呼吸感：
  * 标题与正文字号比保持在 1.8–2.2 倍（如 31/16、33/15.5），形成清晰视觉落差；一篇只保留一个主强调色。
  * 长文与叙事加大行高和留白（lineHeight 1.9–2.0、paraGap 22–26、paddingX 20–22）；信息密集型文章收紧节奏（lineHeight 1.75–1.85、paraGap 18–20）。
  * 多图文章优先 full / polaroid / frame 并统一 imageWidth 与 imageAlign，避免图片与文字视觉打架。
- 数值范围：bodySize 15-18、lineHeight 1.7-2.05、letterSpacing 0-0.05、paraGap 18-30、paddingX 16-24、titleSize 26-38。
- 背景：bg 用 #RRGGBB；bgStyle 可选 none/paper/grid/dots/lines/wash，不填时跟随主题默认，显式写 none 才关闭。
- 图片：imageWidth 40-100（百分比），imageAlign 可选 left/center/right。
- 矢量角标：ornament 可选 none/corner/column/seal/leaf，不填时跟随主题默认，显式写 none 才关闭；最多用一个，与底纹呼应而不堆砌。
- 克制底线：留白优先、同级统一、一个视觉记忆点；不用高饱和荧光色、彩虹拼盘、emoji、外发光和重阴影。
- 用户说「精排 / 设计感 / 杂志风 / 插画风 / 故事书风 / 优化排版 / 按内容排版」时，必须返回完整 design（themeId、variantId、overrides，包含成套的标题/小节/引文/配图样式以及呼应气质的 bg/bgStyle/ornament），不要只改一两个参数敷衍。reply 用一句话点明选定的风格流派和核心视觉判断。

只输出一个 JSON 对象，不要代码围栏、不要解释文字。字段：
- reply：一句话说明改了什么，直接说，不客套。
- text：修改后的完整 Markdown 全文（不是 diff）。没改正文就省略。
- design：{ "themeId": "...", "variantId": "...", "overrides": { ... } }。没改版式就省略。
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
  lines.push('编辑预设（起点，按文章实际情况微调）：')
  for (const preset of DESIGN_PRESETS) lines.push(`- ${preset[0]}：${preset[1]}；${preset[2]}`)
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
  lines.push(`当前排版：主题 ${typeof design.themeId === 'string' ? design.themeId : 'ink'}，版式 ${typeof design.variantId === 'string' ? design.variantId : 'editorial'}`)
  lines.push(`排版覆盖参数：${JSON.stringify(design.overrides ?? {}, null, 0)}`)
  lines.push(`可用主题（主题 id：名称，风格；版式 id）：${THEME_CATALOG.map(theme => `${theme[0]}（${theme[1]}，${theme[2]}；版式 ${theme[3]}）`).join('；')}`)
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

/** 只保留浏览器端认识的排版覆盖字段。 */
function sanitizeOverrides(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out = {}
  const numbers = ['bodySize', 'lineHeight', 'letterSpacing', 'paraGap', 'paddingX', 'titleSize', 'imageWidth']
  const enums = {
    bgStyle: DECOR_OPTIONS.bgStyle,
    ornament: DECOR_OPTIONS.ornament,
    titleStyle: DECOR_OPTIONS.titleStyle,
    sectionStyle: DECOR_OPTIONS.sectionStyle,
    quoteStyle: DECOR_OPTIONS.quoteStyle,
    dividerStyle: DECOR_OPTIONS.dividerStyle,
    listStyle: DECOR_OPTIONS.listStyle,
    imageStyle: DECOR_OPTIONS.imageStyle,
    imageAlign: DECOR_OPTIONS.imageAlign,
  }
  for (const key of numbers) {
    if (typeof raw[key] === 'number' && Number.isFinite(raw[key])) out[key] = raw[key]
  }
  for (const [key, allowed] of Object.entries(enums)) {
    if (typeof raw[key] === 'string' && allowed.includes(raw[key])) out[key] = raw[key]
  }
  if (typeof raw.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.accent)) out.accent = raw.accent
  if (typeof raw.bg === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.bg)) out.bg = raw.bg
  for (const key of ['showMeta', 'showFooter', 'showEyebrow', 'lead']) {
    if (typeof raw[key] === 'boolean') out[key] = raw[key]
  }
  for (const key of ['eyebrow', 'footerText', 'footerSign']) {
    if (typeof raw[key] === 'string' && raw[key].length <= 300) out[key] = raw[key]
  }
  return Object.keys(out).length === 0 ? undefined : out
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
          temperature: 0.3,
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
        if (typeof parsed.design.themeId === 'string') design.themeId = parsed.design.themeId
        if (typeof parsed.design.variantId === 'string') design.variantId = parsed.design.variantId
        const overrides = sanitizeOverrides(parsed.design.overrides)
        if (overrides !== undefined) design.overrides = overrides
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
