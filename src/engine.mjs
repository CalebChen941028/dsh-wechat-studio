/**
 * Content parsing, topic analysis, and automatic layout composition.
 *
 * Everything here is pure: the same text and seed always produce the same
 * design, so the panel can re-render on every keystroke and the tests can pin
 * the output.
 */

import { THEMES, themeOf, variantOf } from './themes.mjs'

/** Shared vocabulary for preset themes and AI-authored custom designs. */
const DESIGN_BG_PATTERNS = ['none', 'paper', 'grid', 'dots', 'lines', 'wash', 'watercolor', 'halftone']
const DESIGN_ORNAMENTS = ['none', 'corner', 'column', 'seal', 'leaf', 'sprig', 'star']
const DESIGN_TITLE_STYLES = ['rule', 'kicker', 'ribbon', 'tag', 'boxed', 'vertical', 'underline', 'centered', 'eyebrow', 'poster', 'stacked']
const DESIGN_SECTION_STYLES = ['bar', 'rule', 'tag', 'numbered', 'line', 'dot', 'ghost', 'brush', 'band', 'folio']
const DESIGN_QUOTE_STYLES = ['bar', 'pull', 'card', 'center', 'tint', 'stamp', 'poster', 'margin']
const DESIGN_DIVIDER_STYLES = ['dots', 'diamond', 'ornament', 'line', 'dash', 'none', 'star']
const DESIGN_LIST_STYLES = ['dot', 'num', 'square', 'arrow', 'dash']
const DESIGN_IMAGE_STYLES = ['plain', 'rounded', 'shadow', 'frame', 'polaroid', 'full', 'plate']
const DESIGN_COVER_STYLES = ['magazine', 'poster', 'split', 'minimal']
const DESIGN_FONT_KINDS = ['serif', 'sans', 'round']
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

/* ------------------------------------------------------------------ *
 * Markdown-ish parsing
 * ------------------------------------------------------------------ */

const FENCE = /^```/
const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/
const DIVIDER_LINE = /^(-{3,}|\*{3,}|_{3,})\s*$/
const HEADING_LINE = /^(#{1,4})\s+(.*)$/
const UL_LINE = /^\s*[-*+]\s+(.*)$/
const OL_LINE = /^\s*\d{1,3}[.)]\s+(.*)$/
const QUOTE_LINE = /^\s*>\s?(.*)$/

/**
 * Split authored copy into typed blocks while keeping source line ranges so the
 * preview can reorder or delete a block by rewriting the source.
 * @param {string} text authored copy.
 * @returns {{ blocks: any[], title: string }} parsed blocks and the first H1, when present.
 */
export function parseArticle(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  let title = ''
  let paragraph = []
  let paragraphStart = -1

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    const body = joinSoftLines(paragraph)
    if (body.trim() !== '') {
      blocks.push({ type: 'paragraph', text: body, lines: [paragraphStart, paragraphStart + paragraph.length - 1] })
    }
    paragraph = []
    paragraphStart = -1
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const trimmed = line.trim()

    if (FENCE.test(trimmed)) {
      flushParagraph()
      const start = i
      const body = []
      i += 1
      while (i < lines.length && !FENCE.test(lines[i].trim())) {
        body.push(lines[i])
        i += 1
      }
      blocks.push({ type: 'code', text: body.join('\n'), lines: [start, Math.min(i, lines.length - 1)] })
      continue
    }

    if (trimmed === '') {
      flushParagraph()
      continue
    }

    const heading = HEADING_LINE.exec(trimmed)
    if (heading) {
      flushParagraph()
      const level = heading[1].length
      const value = heading[2].trim()
      if (level === 1 && title === '') {
        title = value
        blocks.push({ type: 'title', level: 1, text: value, lines: [i, i] })
      } else {
        blocks.push({ type: 'heading', level: level === 1 ? 2 : level, text: value, lines: [i, i] })
      }
      continue
    }

    if (DIVIDER_LINE.test(trimmed)) {
      flushParagraph()
      blocks.push({ type: 'divider', lines: [i, i] })
      continue
    }

    const image = IMAGE_LINE.exec(trimmed)
    if (image) {
      flushParagraph()
      blocks.push({ type: 'image', alt: image[1], src: image[2], lines: [i, i] })
      continue
    }

    if (QUOTE_LINE.test(line)) {
      flushParagraph()
      const start = i
      const paragraphs = []
      while (i < lines.length && QUOTE_LINE.test(lines[i])) {
        const value = QUOTE_LINE.exec(lines[i])[1].trim()
        if (value === '') {
          if (paragraphs.length > 0) paragraphs[paragraphs.length - 1].push('')
        } else {
          if (paragraphs.length === 0 || paragraphs[paragraphs.length - 1].length === 0 || lines[i - 1].trim() === '') {
            paragraphs.push([value])
          } else {
            paragraphs[paragraphs.length - 1].push(value)
          }
        }
        i += 1
      }
      i -= 1
      blocks.push({
        type: 'quote',
        paragraphs: paragraphs.filter(group => group.length > 0).map(group => joinSoftLines(group)),
        lines: [start, start + (i - start)],
      })
      continue
    }

    if (UL_LINE.test(line) || OL_LINE.test(line)) {
      flushParagraph()
      const start = i
      const ordered = OL_LINE.test(line) && !UL_LINE.test(line)
      const items = []
      while (i < lines.length) {
        const ul = UL_LINE.exec(lines[i])
        const ol = OL_LINE.exec(lines[i])
        if (ul) items.push(ul[1].trim())
        else if (ol) items.push(ol[1].trim())
        else if (lines[i].trim() === '') {
          const next = lines[i + 1] ?? ''
          if (!UL_LINE.test(next) && !OL_LINE.test(next)) break
        } else break
        i += 1
      }
      i -= 1
      blocks.push({ type: 'list', ordered, items, lines: [start, start + (i - start)] })
      continue
    }

    if (paragraph.length === 0) paragraphStart = i
    paragraph.push(trimmed)
  }
  flushParagraph()

  return { blocks, title }
}

/**
 * Join wrapped source lines. Chinese lines concatenate without a gap; Latin
 * lines keep one space so words do not fuse.
 * @param {string[]} lines wrapped lines of one paragraph.
 * @returns {string} joined paragraph text.
 */
export function joinSoftLines(lines) {
  let out = ''
  for (const line of lines) {
    if (out === '') {
      out = line
      continue
    }
    const needsSpace = /[A-Za-z0-9,.;:!?%)]$/.test(out) && /^[A-Za-z0-9(]/.test(line)
    out += needsSpace ? ` ${line}` : line
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Inline markup
 * ------------------------------------------------------------------ */

const INLINE_PATTERN = /(`[^`]+`)|(\[([^\]]+)\]\(([^)\s]+)\))|(\*\*([\s\S]+?)\*\*)|(__([\s\S]+?)__)|(~~([\s\S]+?)~~)|(==([\s\S]+?)==)|(\*([^*\n]+?)\*)/g

/**
 * Parse one line of inline markup into flat runs the renderer can style.
 * @param {string} text inline source.
 * @returns {Array<{ kind: string, text: string, href?: string }>} runs in order.
 */
export function parseInline(text) {
  const source = String(text ?? '')
  const runs = []
  let cursor = 0
  INLINE_PATTERN.lastIndex = 0
  let match
  while ((match = INLINE_PATTERN.exec(source)) !== null) {
    if (match.index > cursor) runs.push({ kind: 'text', text: source.slice(cursor, match.index) })
    if (match[1]) runs.push({ kind: 'code', text: match[1].slice(1, -1) })
    else if (match[2]) runs.push({ kind: 'link', text: match[3], href: match[4] })
    else if (match[5]) runs.push({ kind: 'strong', text: match[6] })
    else if (match[8]) runs.push({ kind: 'strong', text: match[8] })
    else if (match[10]) runs.push({ kind: 'del', text: match[10] })
    else if (match[12]) runs.push({ kind: 'mark', text: match[12] })
    else if (match[14]) runs.push({ kind: 'em', text: match[14] })
    cursor = match.index + match[0].length
  }
  if (cursor < source.length) runs.push({ kind: 'text', text: source.slice(cursor) })
  return runs
}

/** Strip markup for analysis and summaries. */
export function plainText(text) {
  return parseInline(text).map(run => run.text).join('')
}

/* ------------------------------------------------------------------ *
 * Topic analysis
 * ------------------------------------------------------------------ */

/** Topic dictionaries. Longer keys are more specific and weigh more. */
const TOPICS = [
  { id: 'tech', label: '科技', keywords: ['人工智能', '大模型', '算法', '编程', '开源', '芯片', '云计算', '数据库', '架构', '前端', '后端', '接口', '部署', '服务器', '自动化', '机器人', '数字化', '技术', '工程师', '代码', '模型', '训练', '推理', 'gpu', 'api', 'ai', 'llm', 'prompt', 'agent', 'token', 'saas', '软件', '开发', '插件', '产品经理'] },
  { id: 'business', label: '商业', keywords: ['商业模式', '品牌', '营销', '增长', '融资', '创业', '战略', '竞争', '营收', '利润', '客户', '销售', '组织', '管理', '效率', '职场', '招聘', '绩效', '汇报', '方案', '项目', '市场', '流量', '转化', '复盘', '目标', '团队', '公司', '企业', '商业', '运营'] },
  { id: 'finance', label: '投资理财', keywords: ['投资', '理财', '基金', '股票', '收益', '风险', '资产', '经济', '通胀', '利率', '估值', '现金流', '利率', '财报', '分红', '仓位', '复利', '债券', '保险'] },
  { id: 'writing', label: '写作与内容', keywords: ['写作', '排版', '稿件', '文案', '标题', '段落', '读者', '编辑', '公众号', '文章', '叙事', '改稿', '措辞', '表达', '行文', '句式', '文章结构', '素材', '灵感', '写作法', '内容创作'] },
  { id: 'lifestyle', label: '生活方式', keywords: ['生活', '日常', '周末', '旅行', '城市', '咖啡', '美食', '穿搭', '家居', '收纳', '好物', '推荐', '清单', '探店', '摄影', '电影', '音乐', '阅读', '书单', '运动', '健身', '睡眠', '仪式感', '松弛', '慢生活'] },
  { id: 'emotion', label: '情感故事', keywords: ['故事', '回忆', '妈妈', '母亲', '父亲', '孩子', '成长', '告别', '相遇', '心情', '温柔', '深夜', '孤独', '陪伴', '治愈', '眼泪', '青春', '故乡', '时光', '那年', '后来', '遗憾', '喜欢', '想念', '信封', '信纸', '冬天'] },
  { id: 'culture', label: '人文', keywords: ['文化', '历史', '诗词', '书法', '传统', '节气', '非遗', '美学', '艺术', '宋代', '唐代', '文人', '东方', '国风', '古典', '禅', '茶', '园林', '文物', '哲学', '读书'] },
  { id: 'academic', label: '学术研究', keywords: ['研究', '论文', '实验', '样本', '理论', '假设', '文献', '统计', '显著', '机制', '变量', '综述', '实证', '回归', '量表', '信度', '效度', '学术', '课题', '申报', '对照组', '显著性', 'p值'] },
  { id: 'festival', label: '节日祝福', keywords: ['春节', '新年', '中秋', '国庆', '圣诞', '节日', '祝福', '团圆', '红包', '周年', '庆典', '快乐', '跨年', '生日', '元宵', '端午'] },
  { id: 'beauty', label: '时尚美妆', keywords: ['美妆', '护肤', '穿搭', '时尚', '口红', '香水', '妆容', '身材', '搭配', '风格', '质感', '色号', '底妆', '抗老', '防晒', '单品'] },
  { id: 'food', label: '美食', keywords: ['美食', '菜谱', '食谱', '味道', '餐厅', '烘焙', '食材', '做饭', '厨房', '甜点', '面条', '火锅', '早餐', '好吃', '香气'] },
  { id: 'education', label: '教育学习', keywords: ['学习', '课程', '考试', '备考', '教育', '老师', '学生', '知识', '方法论', '笔记', '复习', '技巧', '教程', '入门', '自学', '读书笔记'] },
  { id: 'parent', label: '亲子', keywords: ['育儿', '孩子', '宝宝', '亲子', '妈妈', '成长', '教育', '陪伴', '幼儿园', '小学', '青春期', '绘本', '家庭'] },
  { id: 'health', label: '健康运动', keywords: ['健康', '运动', '健身', '跑步', '睡眠', '饮食', '体检', '免疫力', '减脂', '瑜伽', '拉伸', '心率', '营养', '作息'] },
  { id: 'travel', label: '旅行', keywords: ['旅行', '旅行攻略', '自驾', '徒步', '海岛', '古镇', '酒店', '机票', '民宿', '风景', '露营', 'citywalk', '打卡'] },
]

/**
 * Score the copy against the topic dictionaries.
 * @param {string} text authored copy.
 * @returns {{ topic: string, label: string, scores: Record<string, number>, matches: Record<string, number> }} topic verdict.
 */
export function detectTopic(text) {
  const haystack = String(text ?? '').toLowerCase()
  const scores = {}
  const matches = {}
  for (const topic of TOPICS) {
    let raw = 0
    for (const keyword of topic.keywords) {
      const count = countOccurrences(haystack, keyword)
      if (count === 0) continue
      raw += count * (keyword.length >= 3 ? 1.6 : 1)
    }
    matches[topic.id] = raw
    scores[topic.id] = raw / (raw + 4)
  }
  let best = TOPICS[0]
  let bestScore = -1
  for (const topic of TOPICS) {
    if (scores[topic.id] > bestScore) {
      best = topic
      bestScore = scores[topic.id]
    }
  }
  const matched = matches[best.id] ?? 0
  return {
    topic: matched > 0 ? best.id : 'general',
    label: matched > 0 ? best.label : '阅读',
    scores,
    matches,
  }
}

function countOccurrences(haystack, needle) {
  if (needle === '') return 0
  let count = 0
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at === -1) return count
    count += 1
    from = at + needle.length
  }
}

/**
 * Measure the structure and density of the parsed article.
 * @param {any[]} blocks parsed blocks.
 * @param {string} text raw copy.
 * @returns {object} numeric features used by composition and shown in the reasons.
 */
export function measure(blocks, text) {
  const plain = plainText(text ?? '')
  const chars = plain.replace(/\s/g, '').length
  const cjk = (plain.match(/[\u4e00-\u9fff]/g) ?? []).length
  const paragraphs = blocks.filter(block => block.type === 'paragraph')
  const headings = blocks.filter(block => block.type === 'heading')
  const quotes = blocks.filter(block => block.type === 'quote')
  const lists = blocks.filter(block => block.type === 'list')
  const images = blocks.filter(block => block.type === 'image')
  const code = blocks.filter(block => block.type === 'code')
  const avgParagraph = paragraphs.length === 0
    ? 0
    : Math.round(paragraphs.reduce((sum, block) => sum + block.text.length, 0) / paragraphs.length)
  const exc = (plain.match(/[!！]/g) ?? []).length
  const percent = (plain.match(/%/g) ?? []).length
  const numbers = (plain.match(/\d/g) ?? []).length
  return {
    chars,
    cjk,
    paragraphs: paragraphs.length,
    headings: headings.length,
    quotes: quotes.length,
    lists: lists.length,
    listItems: lists.reduce((sum, block) => sum + block.items.length, 0),
    images: images.length,
    codeBlocks: code.length,
    avgParagraph,
    exclamations: exc,
    digits: numbers,
    percent,
    readingMinutes: Math.max(1, Math.round(chars / 420)),
    latinRatio: chars === 0 ? 0 : Math.round(((plain.match(/[A-Za-z]/g) ?? []).length / chars) * 100) / 100,
    hasLeadCandidate: paragraphs.length >= 3 && (paragraphs[0]?.text.length ?? 0) <= 140,
  }
}


/** WCAG contrast ratio for two #RRGGBB colours. */
function contrastRatio(a, b) {
  const left = hexToRgb(a)
  const right = hexToRgb(b)
  if (left === null || right === null) return 21
  const linear = value => {
    const scaled = value / 255
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
  }
  const luminance = rgb => 0.2126 * linear(rgb.r) + 0.7152 * linear(rgb.g) + 0.0722 * linear(rgb.b)
  const [high, low] = [luminance(left), luminance(right)].sort((x, y) => y - x)
  return (high + 0.05) / (low + 0.05)
}

/** Nudge a foreground toward black/white until it clears the contrast floor. */
function ensureReadable(foreground, background, minimum = 4.5) {
  if (!HEX_COLOR.test(foreground) || !HEX_COLOR.test(background)) return foreground
  if (contrastRatio(foreground, background) >= minimum) return foreground
  const target = readableOn(background) === '#141414' ? '#000000' : '#FFFFFF'
  for (let step = 1; step <= 10; step += 1) {
    const candidate = mixHex(foreground, target, step / 10)
    if (contrastRatio(candidate, background) >= minimum) return candidate
  }
  return target
}

const pickCustomHex = (value, fallback) => typeof value === 'string' && HEX_COLOR.test(value) ? value : fallback
const pickCustomEnum = (value, allowed, fallback) => typeof value === 'string' && allowed.includes(value) ? value : fallback
const pickCustomNumber = (value, fallback, min, max) => {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(max, Math.max(min, number))
}
const pickCustomEm = (value, fallback, min = 0, max = 0.08) => {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? parseFloat(value) : NaN
  const safe = Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : parseFloat(fallback) || 0
  return `${Math.round(safe * 1000) / 1000}em`
}

/**
 * Validate an AI-authored design into a complete token set. The model can
 * invent a palette, type scale and combination of layout primitives; values
 * are clamped and enum-checked so the renderer only sees safe inputs.
 * @param {object} raw custom design fragment.
 * @returns {object|null} complete custom design, or null when absent/empty.
 */
export function normalizeCustomDesign(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const meaningful = ['palette', 'type', 'surface', 'titleStyle', 'sectionStyle', 'quoteStyle', 'dividerStyle', 'listStyle', 'imageStyle', 'options', 'blueprint']
  if (!meaningful.some(key => raw[key] !== undefined)) return null
  const base = themeOf('column')
  const paletteRaw = raw.palette !== null && typeof raw.palette === 'object' && !Array.isArray(raw.palette) ? raw.palette : {}
  const bg = pickCustomHex(paletteRaw.bg, base.palette.bg)
  const dark = readableOn(bg) === '#FFFFFF'
  const text = ensureReadable(pickCustomHex(paletteRaw.text, dark ? '#F6F4EF' : '#1E1B18'), bg)
  const accent = ensureReadable(pickCustomHex(paletteRaw.accent, base.palette.accent), bg)
  const palette = {
    bg,
    card: pickCustomHex(paletteRaw.card, dark ? mixHex(bg, '#FFFFFF', 0.08) : mixHex(bg, '#000000', 0.04)),
    text,
    secondary: ensureReadable(pickCustomHex(paletteRaw.secondary, dark ? '#B9B4AA' : mixHex(text, bg, 0.4)), bg),
    accent,
    accentSoft: pickCustomHex(paletteRaw.accentSoft, mixHex(accent, dark ? '#000000' : '#FFFFFF', dark ? 0.55 : 0.82)),
    border: pickCustomHex(paletteRaw.border, dark ? mixHex(bg, '#FFFFFF', 0.16) : mixHex(bg, '#000000', 0.12)),
  }
  const typeRaw = raw.type !== null && typeof raw.type === 'object' && !Array.isArray(raw.type) ? raw.type : {}
  const type = {
    titleFont: pickCustomEnum(typeRaw.titleFont, DESIGN_FONT_KINDS, base.type.titleFont),
    bodyFont: pickCustomEnum(typeRaw.bodyFont, DESIGN_FONT_KINDS, base.type.bodyFont),
    titleSize: Math.round(pickCustomNumber(typeRaw.titleSize, base.type.titleSize, 20, 40)),
    titleWeight: Math.round(pickCustomNumber(typeRaw.titleWeight, base.type.titleWeight, 300, 900) / 100) * 100,
    titleTracking: pickCustomEm(typeRaw.titleTracking, base.type.titleTracking, -0.02, 0.08),
    bodySize: Math.round(pickCustomNumber(typeRaw.bodySize, base.type.bodySize, 13, 20) * 2) / 2,
    lineHeight: Math.round(pickCustomNumber(typeRaw.lineHeight, base.type.lineHeight, 1.5, 2.4) * 100) / 100,
    letterSpacing: pickCustomEm(typeRaw.letterSpacing, base.type.letterSpacing, 0, 0.06),
    paraGap: Math.round(pickCustomNumber(typeRaw.paraGap, base.type.paraGap, 10, 40)),
    paddingX: Math.round(pickCustomNumber(typeRaw.paddingX, base.type.paddingX, 8, 28)),
  }
  const surfaceRaw = raw.surface !== null && typeof raw.surface === 'object' && !Array.isArray(raw.surface) ? raw.surface : {}
  const surface = {
    pattern: pickCustomEnum(surfaceRaw.pattern, DESIGN_BG_PATTERNS, 'none'),
    ornament: pickCustomEnum(surfaceRaw.ornament, DESIGN_ORNAMENTS, 'none'),
  }
  const optionsRaw = raw.options !== null && typeof raw.options === 'object' && !Array.isArray(raw.options) ? raw.options : {}
  const optionBool = (key, fallback) => typeof optionsRaw[key] === 'boolean' ? optionsRaw[key] : fallback
  const optionText = (key, max) => typeof optionsRaw[key] === 'string' ? optionsRaw[key].slice(0, max) : ''
  const options = {
    dropCap: optionBool('dropCap', false),
    lead: optionBool('lead', true),
    showMeta: optionBool('showMeta', true),
    showFooter: optionBool('showFooter', true),
    showEyebrow: optionBool('showEyebrow', true),
    eyebrow: optionText('eyebrow', 40),
    footerText: optionText('footerText', 140),
    footerSign: optionText('footerSign', 40),
    imageWidth: Math.round(pickCustomNumber(optionsRaw.imageWidth, 100, 40, 100)),
    imageAlign: pickCustomEnum(optionsRaw.imageAlign, ['left', 'center', 'right'], 'center'),
  }
  const blueprintRaw = raw.blueprint !== null && typeof raw.blueprint === 'object' && !Array.isArray(raw.blueprint) ? raw.blueprint : {}
  const coverRaw = blueprintRaw.cover !== null && typeof blueprintRaw.cover === 'object' && !Array.isArray(blueprintRaw.cover) ? blueprintRaw.cover : {}
  const coverText = (key, max) => typeof coverRaw[key] === 'string' ? coverRaw[key].trim().slice(0, max) : ''
  const lines = Array.isArray(coverRaw.lines)
    ? coverRaw.lines.filter(line => typeof line === 'string' && line.trim() !== '').map(line => line.trim().slice(0, 48)).slice(0, 3)
    : []
  const blueprint = {
    cover: {
      enabled: coverRaw.enabled === true,
      style: pickCustomEnum(coverRaw.style, DESIGN_COVER_STYLES, 'magazine'),
      masthead: coverText('masthead', 24),
      issue: coverText('issue', 24),
      kicker: coverText('kicker', 40),
      lines,
      image: pickCustomEnum(coverRaw.image, ['first', 'none'], 'first'),
      align: pickCustomEnum(coverRaw.align, ['left', 'center'], 'left'),
    },
    contents: blueprintRaw.contents === true,
  }
  return {
    source: raw.source === 'local' ? 'local' : 'ai',
    name: typeof raw.name === 'string' ? raw.name.trim().slice(0, 24) : '',
    tagline: typeof raw.tagline === 'string' ? raw.tagline.trim().slice(0, 60) : '',
    blueprint,
    palette,
    type,
    surface,
    titleStyle: pickCustomEnum(raw.titleStyle, DESIGN_TITLE_STYLES, 'rule'),
    sectionStyle: pickCustomEnum(raw.sectionStyle, DESIGN_SECTION_STYLES, 'rule'),
    quoteStyle: pickCustomEnum(raw.quoteStyle, DESIGN_QUOTE_STYLES, 'pull'),
    dividerStyle: pickCustomEnum(raw.dividerStyle, DESIGN_DIVIDER_STYLES, 'line'),
    listStyle: pickCustomEnum(raw.listStyle, DESIGN_LIST_STYLES, 'dot'),
    imageStyle: pickCustomEnum(raw.imageStyle, DESIGN_IMAGE_STYLES, 'plain'),
    options,
  }
}

/**
 * Compose the design object the renderer consumes: theme palette and type
 * scale, variant decoration vocabulary, then explicit user overrides.
 * @param {object} stored stored design `{ themeId, variantId, overrides }`.
 * @returns {object} complete design spec.
 */
export function composeDesign(stored) {
  const input = stored && typeof stored === 'object' ? stored : {}
  const custom = normalizeCustomDesign(input.custom)
  const theme = custom === null ? themeOf(input.themeId) : {
    id: 'custom',
    name: custom.name !== '' ? custom.name : 'AI 自定义',
    tagline: custom.tagline !== '' ? custom.tagline : 'AI 按内容生成的一套版式',
    palette: custom.palette,
    type: custom.type,
    surface: custom.surface,
    variants: [{
      id: 'custom',
      name: '自定义',
      titleStyle: custom.titleStyle,
      sectionStyle: custom.sectionStyle,
      dividerStyle: custom.dividerStyle,
      quoteStyle: custom.quoteStyle,
      listStyle: custom.listStyle,
      imageStyle: custom.imageStyle,
    }],
  }
  const variant = custom === null ? variantOf(theme, input.variantId) : theme.variants[0]
  const overrides = input.overrides && typeof input.overrides === 'object' ? input.overrides : {}

  const colors = { ...theme.palette }
  if (typeof overrides.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(overrides.accent)) {
    colors.accent = overrides.accent
    colors.accentSoft = mixHex(overrides.accent, colors.bg, 0.12)
    colors.border = mixHex(overrides.accent, colors.bg, 0.2)
  }

  // Background override: keep text readable when the page turns dark. Setting
  // the theme's own colour is a no-op, so a preset that restates the palette
  // does not recompute and wash out card and border tones.
  const requestedBg = typeof overrides.bg === 'string' && /^#[0-9a-fA-F]{6}$/.test(overrides.bg) ? overrides.bg : undefined
  const customBg = requestedBg !== undefined && requestedBg.toLowerCase() !== theme.palette.bg.toLowerCase() ? requestedBg : undefined
  if (customBg !== undefined) {
    colors.bg = customBg
    if (readableOn(customBg) === '#FFFFFF') {
      colors.text = '#F6F4EF'
      colors.secondary = '#B9B4AA'
      colors.card = mixHex(customBg, '#FFFFFF', 0.08)
      colors.border = mixHex(customBg, '#FFFFFF', 0.16)
      colors.accentSoft = mixHex(colors.accent, customBg, 0.2)
    } else {
      colors.card = mixHex(customBg, '#000000', 0.04)
      colors.border = mixHex(customBg, '#000000', 0.12)
    }
  }
  colors.accentInk = readableOn(colors.accent)

  const defaultPattern = DESIGN_BG_PATTERNS.includes(theme.surface?.pattern) ? theme.surface.pattern : 'none'
  const defaultOrnament = DESIGN_ORNAMENTS.includes(theme.surface?.ornament) ? theme.surface.ornament : 'none'
  const surface = {
    bg: colors.bg,
    pattern: DESIGN_BG_PATTERNS.includes(overrides.bgStyle) ? overrides.bgStyle : defaultPattern,
    ornament: DESIGN_ORNAMENTS.includes(overrides.ornament) ? overrides.ornament : defaultOrnament,
    ink: readableOn(colors.bg) === '#FFFFFF' ? '255,255,255' : '17,17,17',
    wash: colors.accent,
  }

  const pick = (value, fallback, min, max) => {
    const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback
    return Math.min(max, Math.max(min, number))
  }

  const type = {
    titleFont: theme.type.titleFont,
    bodyFont: theme.type.bodyFont,
    titleSize: Math.round(pick(overrides.titleSize, theme.type.titleSize, 20, 40)),
    titleWeight: theme.type.titleWeight,
    titleTracking: overrides.titleTracking ?? theme.type.titleTracking,
    bodySize: Math.round(pick(overrides.bodySize, theme.type.bodySize, 13, 20) * 2) / 2,
    lineHeight: Math.round(pick(overrides.lineHeight, theme.type.lineHeight, 1.5, 2.4) * 100) / 100,
    letterSpacing: Math.round(pick(overrides.letterSpacing, parseFloat(theme.type.letterSpacing) || 0, 0, 0.06) * 1000) / 1000,
    paraGap: Math.round(pick(overrides.paraGap, theme.type.paraGap, 10, 40)),
  }

  const layout = {
    paddingX: Math.round(pick(overrides.paddingX, theme.type.paddingX, 8, 28)),
    sectionGap: Math.round(pick(overrides.sectionGap, Math.max(20, Math.round(type.paraGap * 1.2)), 12, 48)),
    titleGap: Math.round(pick(overrides.titleGap, Math.max(18, Math.round(type.paraGap * 0.9)), 8, 40)),
  }

  const customOption = custom === null ? null : custom.options
  const optionBool = (key, fallback) => typeof overrides[key] === 'boolean'
    ? overrides[key]
    : typeof customOption?.[key] === 'boolean' ? customOption[key] : fallback
  const optionText = (key, fallback) => {
    if (typeof overrides[key] === 'string') return overrides[key]
    if (customOption !== null && typeof customOption[key] === 'string' && customOption[key] !== '') return customOption[key]
    return fallback
  }
  const optionNumber = (key, fallback, min, max) => {
    const value = typeof overrides[key] === 'number' && Number.isFinite(overrides[key])
      ? overrides[key]
      : customOption !== null && typeof customOption[key] === 'number' && Number.isFinite(customOption[key]) ? customOption[key] : fallback
    return Math.round(Math.min(max, Math.max(min, value)))
  }

  const decor = {
    titleStyle: overrides.titleStyle ?? variant.titleStyle,
    sectionStyle: overrides.sectionStyle ?? variant.sectionStyle,
    dividerStyle: overrides.dividerStyle ?? variant.dividerStyle,
    quoteStyle: overrides.quoteStyle ?? variant.quoteStyle,
    listStyle: overrides.listStyle ?? variant.listStyle,
    imageStyle: overrides.imageStyle ?? variant.imageStyle,
    imageWidth: optionNumber('imageWidth', 100, 40, 100),
    imageAlign: ['left', 'center', 'right'].includes(overrides.imageAlign)
      ? overrides.imageAlign
      : customOption?.imageAlign ?? 'center',
    showMeta: optionBool('showMeta', true),
    showFooter: optionBool('showFooter', true),
    showEyebrow: optionBool('showEyebrow', true),
    lead: optionBool('lead', true),
    dropCap: optionBool('dropCap', theme.dropCap === true),
    eyebrow: optionText('eyebrow', ''),
    footerText: optionText('footerText', '如果这篇内容对你有帮助，欢迎点个「在看」或转发给需要的人。'),
    footerSign: optionText('footerSign', ''),
  }

  return {
    themeId: custom === null ? theme.id : 'custom',
    variantId: custom === null ? variant.id : 'custom',
    themeName: theme.name,
    themeBg: theme.palette.bg,
    surface,
    variantName: variant.name,
    tagline: theme.tagline,
    custom: custom ?? undefined,
    blueprint: custom?.blueprint ?? null,
    colors,
    type,
    layout,
    decor,
  }
}

/**
 * Convert a stored legacy theme design into the custom token shape. Used only
 * as a compatibility bridge for old documents or a model that still returns a
 * theme id; new designs never need a theme.
 * @param {object} stored legacy design.
 * @returns {object} custom design.
 */
export function customDesignFromLegacy(stored) {
  const composed = composeDesign(stored)
  if (composed.custom !== undefined) return composed.custom
  const { bg, card, text, secondary, accent, accentSoft, border } = composed.colors
  return {
    source: 'ai',
    name: composed.themeName,
    tagline: composed.tagline,
    blueprint: null,
    palette: { bg, card, text, secondary, accent, accentSoft, border },
    type: { ...composed.type },
    surface: { pattern: composed.surface.pattern, ornament: composed.surface.ornament },
    titleStyle: composed.decor.titleStyle,
    sectionStyle: composed.decor.sectionStyle,
    quoteStyle: composed.decor.quoteStyle,
    dividerStyle: composed.decor.dividerStyle,
    listStyle: composed.decor.listStyle,
    imageStyle: composed.decor.imageStyle,
    options: {
      dropCap: composed.decor.dropCap,
      lead: composed.decor.lead,
      showMeta: composed.decor.showMeta,
      showFooter: composed.decor.showFooter,
      showEyebrow: composed.decor.showEyebrow,
      eyebrow: composed.decor.eyebrow,
      footerText: composed.decor.footerText,
      footerSign: composed.decor.footerSign,
      imageWidth: composed.decor.imageWidth,
      imageAlign: composed.decor.imageAlign,
    },
  }
}

/**
 * Build a neutral, content-aware baseline design. It deliberately has no
 * preset theme identity: local previews stay readable, and the AI is expected
 * to replace it with a bespoke token set when the user asks for design work.
 * @param {any[]} blocks parsed blocks.
 * @param {string} text raw copy.
 * @returns {{ custom: object }} stored custom design.
 */
export function defaultDesign(blocks, text) {
  const features = measure(blocks, text)
  const topic = detectTopic(text)
  const title = blocks.find(block => block.type === 'title')?.text ?? plainText(text.split('\n')[0] ?? '')
  const titleLength = title.length
  const longCopy = features.chars > 2200
  const denseCopy = features.chars > 3000
  return {
    custom: normalizeCustomDesign({
      source: 'local',
      name: '基础版式',
      tagline: '按内容长度与结构生成的纸感底版，可让 AI 重做整套设计',
      palette: {
        bg: '#FCFAF6', card: '#F4EFE6', text: '#1E1B18', secondary: '#6F675D',
        accent: '#9A5B3D', accentSoft: '#F0E4DB', border: '#E3D9CC',
      },
      type: {
        titleFont: 'serif', bodyFont: 'sans',
        titleSize: titleLength <= 10 ? 34 : titleLength >= 24 ? 28 : 31,
        titleWeight: 600, titleTracking: '0.01em',
        bodySize: denseCopy ? 16 : 15.5,
        lineHeight: longCopy ? 1.92 : 1.86,
        letterSpacing: '0.015em',
        paraGap: longCopy ? 24 : 20,
        paddingX: 20,
      },
      surface: { pattern: 'paper', ornament: 'none' },
      titleStyle: 'rule',
      sectionStyle: features.headings >= 3 ? 'numbered' : 'rule',
      quoteStyle: features.quotes >= 2 ? 'card' : 'pull',
      dividerStyle: 'line',
      listStyle: features.listItems >= 4 ? 'num' : 'dot',
      imageStyle: features.images >= 2 ? 'frame' : 'plain',
      options: {
        dropCap: true,
        lead: features.hasLeadCandidate,
        eyebrow: topic.label,
        showEyebrow: true,
        showMeta: true,
        showFooter: true,
        imageWidth: 100,
        imageAlign: 'center',
      },
    }),
  }
}

/**
 * Explain the copy's topic and structure. This no longer chooses a theme; it
 * only reports what the local baseline and the AI can react to.
 * @param {any[]} blocks parsed blocks.
 * @param {string} text raw copy.
 * @returns {{ topic: string, label: string, matches: object, features: object, reasons: string[] }} content analysis.
 */
export function analyzeContent(blocks, text) {
  const features = measure(blocks, text)
  const topic = detectTopic(text)
  const reasons = []
  reasons.push(topic.topic === 'general'
    ? '主题词命中不多，按结构与长度生成基础版式'
    : `识别为「${topic.label}」主题（命中 ${Math.round(topic.matches[topic.topic] ?? 0)} 个关键词）`)
  const structure = []
  if (features.headings > 0) structure.push(`${features.headings} 个小节`)
  if (features.quotes > 0) structure.push(`${features.quotes} 段引用`)
  if (features.images > 0) structure.push(`${features.images} 张配图`)
  if (features.listItems > 0) structure.push(`${features.listItems} 条列表`)
  if (features.codeBlocks > 0) structure.push(`${features.codeBlocks} 段代码`)
  reasons.push(structure.length > 0 ? `结构：${structure.join(' / ')}` : `结构：${features.paragraphs} 段连续正文`)
  reasons.push(`篇幅 ${features.chars} 字，约 ${features.readingMinutes} 分钟读完`)
  reasons.push('基础版式只负责可读性；需要专属风格时让 AI 重做整套设计')
  return { topic: topic.topic, label: topic.label, matches: topic.matches, features, reasons }
}

/**
 * Produce the local baseline and its content analysis.
 * @param {any[]} blocks parsed blocks.
 * @param {string} text raw copy.
 * @param {number} seed retained for callers; the baseline is deterministic.
 * @returns {{ design: object, analysis: object }} stored design plus reasoning shown in the panel.
 */
export function autoCompose(blocks, text, seed = 0) {
  void seed
  return { design: defaultDesign(blocks, text), analysis: analyzeContent(blocks, text) }
}

/**
 * Rank themes by topic affinity plus structural fit.
 * @param {{ scores: Record<string, number> }} topic topic analysis.
 * @param {object} features measured structure.
 * @returns {Array<{ theme: any, score: number }>} themes, best first.
 */
export function rankThemes(topic, features) {
  const ranked = THEMES.map(theme => {
    let score = 0
    for (const [id, value] of Object.entries(topic.scores)) {
      const affinity = theme.topics[id]
      if (affinity === undefined) continue
      score += value * affinity
    }
    score += 0.18 // every theme stays reachable for copy with no topic hits
    // Writing and culture pieces start from the editorial magazine layout.
    if (theme.id === 'column' && (topic.scores.writing ?? 0) + (topic.scores.culture ?? 0) > 0.5) score += 0.08
    if (features.codeBlocks > 0 && ['mint', 'mono', 'ocean', 'night'].includes(theme.id)) score += 0.16
    if (features.quotes >= 2 && ['paper', 'ink', 'rose', 'amber', 'column', 'storybook'].includes(theme.id)) score += 0.12
    if (features.headings >= 3 && ['ocean', 'scholar', 'mono', 'night', 'gallery'].includes(theme.id)) score += 0.1
    if (features.avgParagraph > 90 && ['scholar', 'ink', 'paper', 'column', 'storybook'].includes(theme.id)) score += 0.08
    if (features.avgParagraph > 0 && features.avgParagraph < 35 && ['magazine', 'zine', 'ink', 'pine'].includes(theme.id)) score += 0.06
    if (features.listItems >= 4 && ['pine', 'mint', 'mono'].includes(theme.id)) score += 0.06
    if (features.exclamations >= 2 && ['festival', 'amber', 'magazine', 'illustration'].includes(theme.id)) score += 0.08
    if (features.images >= 2 && ['magazine', 'zine', 'illustration', 'gallery', 'watercolor', 'poster', 'folio', 'bauhaus', 'ocean', 'rose'].includes(theme.id)) score += 0.06
    return { theme, score }
  })
  ranked.sort((a, b) => b.score - a.score)
  return ranked
}

/** Half-width punctuation surrounded by CJK characters. */
const CJK_HALF_PUNCT = /[\u4e00-\u9fff][,.;:!?](?=$|[\s\u4e00-\u9fff，。；：！？、”’）】》])/g
const CJK_PUNCT_MAP = { ',': '，', '.': '。', ';': '；', ':': '：', '!': '！', '?': '？' }

/** Count and summarize typography issues in parsed blocks and raw Markdown. */
export function auditTypography(blocks, text) {
  const source = String(text ?? '')
  const paragraphs = (blocks ?? []).filter(block => block.type === 'paragraph')
  const images = (blocks ?? []).filter(block => block.type === 'image')
  const headings = (blocks ?? []).filter(block => block.type === 'heading' || block.type === 'title')
  const longParagraphs = paragraphs.filter(block => block.text.length > 140).length
  const halfWidthPunctuation = (source.match(CJK_HALF_PUNCT) ?? []).length
  const extraBlankLines = (source.match(/\n{3,}/g) ?? []).length
  const highlights = Math.floor((source.match(/==/g) ?? []).length / 2)
  const missingCaptions = images.filter(block => String(block.alt ?? '').trim() === '').length
  let headingSkips = 0
  let previous = 0
  for (const block of headings) {
    const level = Number(block.level) || 1
    if (previous > 0 && level - previous > 1) headingSkips += 1
    previous = level
  }
  return { longParagraphs, halfWidthPunctuation, extraBlankLines, highlights, missingCaptions, headingSkips }
}

/** Split long ordinary paragraphs at sentence boundaries, leaving headings/lists/quotes alone. */
export function splitLongParagraphs(text, maxChars = 140) {
  const lines = String(text ?? '').split('\n')
  const output = []
  let inFence = false
  const isPlainLine = (line) => {
    const value = line.trim()
    if (value === '') return false
    if (/^(#{1,6}\s|>|\s*[-*+]\s|\s*\d+[.)]\s|!\[|```|---+\s*$)/.test(value)) return false
    return true
  }
  const splitLine = (line) => {
    const sentences = line.match(/[^。！？!?；;]+[。！？!?；;]?/g) ?? [line]
    const chunks = []
    let current = ''
    for (const sentence of sentences) {
      if (current === '') current = sentence
      else if ((current + sentence).length <= maxChars) current += sentence
      else {
        chunks.push(current)
        current = sentence
      }
    }
    if (current !== '') chunks.push(current)
    return chunks.join('\n\n')
  }
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      output.push(line)
      continue
    }
    if (!inFence && isPlainLine(line) && line.trim().length > maxChars) {
      output.push(splitLine(line))
    } else {
      output.push(line)
    }
  }
  return output.join('\n')
}

/** Convert half-width punctuation used between Chinese characters. */
export function normalizeCjkPunctuation(text) {
  return String(text ?? '').replace(/([\u4e00-\u9fff])([,.;:!?])(?=$|[\s\u4e00-\u9fff，。；：！？、”’）】》])/g, (match, previous, punctuation) => `${previous}${CJK_PUNCT_MAP[punctuation]}`)
}

/** Collapse repeated blank lines and trailing spaces. */
export function tidyMarkdown(text) {
  return String(text ?? '')
    .split('\n')
    .map(line => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Replace the source URL of one Markdown image line.
 * @param {string} text Markdown source.
 * @param {number} lineIndex zero-based line.
 * @param {string} src new image source.
 * @returns {string} updated source; unchanged when the line is not an image.
 */
export function replaceImageSource(text, lineIndex, src) {
  const lines = String(text ?? '').split('\n')
  const line = lines[lineIndex]
  if (typeof line !== 'string') return text
  const match = /^(\s*!\[[^\]]*\]\()([^)]*)(\)\s*)$/.exec(line)
  if (!match) return text
  lines[lineIndex] = `${match[1]}${String(src ?? '').replace(/[)\n\r]/g, '')}${match[3]}`
  return lines.join('\n')
}

/**
 * Extract a small palette from RGBA pixels, used by the reference-image theme DNA.
 * @param {Uint8ClampedArray|number[]} pixels RGBA pixel buffer.
 * @returns {{background: string, accent: string, dark: boolean, palette: string[]}}
 */
export function paletteFromPixels(pixels) {
  const counts = new Map()
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    const alpha = pixels[index + 3]
    if (alpha < 160) continue
    const r = pixels[index]
    const g = pixels[index + 1]
    const b = pixels[index + 2]
    const key = `${r >> 4},${g >> 4},${b >> 4}`
    const entry = counts.get(key) ?? { r: 0, g: 0, b: 0, n: 0 }
    entry.r += r; entry.g += g; entry.b += b; entry.n += 1
    counts.set(key, entry)
  }
  const sorted = [...counts.values()].map(entry => ({
    r: Math.round(entry.r / entry.n),
    g: Math.round(entry.g / entry.n),
    b: Math.round(entry.b / entry.n),
    n: entry.n,
  })).sort((a, b) => b.n - a.n)
  const toHex = (color) => `#${[color.r, color.g, color.b].map(value => value.toString(16).padStart(2, '0')).join('')}`
  const luminance = (color) => (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) / 255
  const saturation = (color) => {
    const max = Math.max(color.r, color.g, color.b)
    const min = Math.min(color.r, color.g, color.b)
    return max === 0 ? 0 : (max - min) / max
  }
  const background = sorted.length > 0 ? toHex(sorted[0]) : '#FBF8F1'
  const accentColor = sorted.find(color => saturation(color) > 0.24 && Math.abs(luminance(color) - luminance(sorted[0])) > 0.08)
    ?? sorted.find(color => saturation(color) > 0.18)
    ?? null
  return {
    background,
    accent: accentColor === null ? '' : toHex(accentColor),
    dark: sorted.length > 0 ? luminance(sorted[0]) < 0.45 : false,
    palette: sorted.slice(0, 5).map(toHex),
  }
}

/** Tone ids offered by the house style editor. */
export const STYLE_TONES = ['restrained', 'spoken', 'professional', 'story']

/** Default house style for a new document. */
export const DEFAULT_STYLE_GUIDE = {
  tone: 'restrained',
  bannedWords: [],
  preferredWords: [],
  maxParagraphChars: 140,
  requireCaptions: false,
}

/** Normalize a stored/user-entered style guide. */
export function normalizeStyleGuide(value) {
  const input = value && typeof value === 'object' ? value : {}
  const list = (raw) => {
    const items = Array.isArray(raw) ? raw : String(raw ?? '').split(/[,，、\s]+/)
    return [...new Set(items.map(item => String(item).trim()).filter(Boolean))].slice(0, 40)
  }
  const max = Number(input.maxParagraphChars)
  return {
    tone: STYLE_TONES.includes(input.tone) ? input.tone : DEFAULT_STYLE_GUIDE.tone,
    bannedWords: list(input.bannedWords),
    preferredWords: list(input.preferredWords),
    maxParagraphChars: Math.min(400, Math.max(60, Number.isFinite(max) ? Math.round(max) : DEFAULT_STYLE_GUIDE.maxParagraphChars)),
    requireCaptions: input.requireCaptions === true,
  }
}

/**
 * Audit text against a house style.
 * @param {Array<object>} blocks parsed article blocks.
 * @param {string} text raw markdown.
 * @param {object} rawGuide stored style guide.
 * @returns {{guide: object, active: boolean, bannedHits: Array<{word: string, count: number}>, longParagraphs: number, missingCaptions: number, violations: number}}
 */
export function auditHouseStyle(blocks, text, rawGuide) {
  const guide = normalizeStyleGuide(rawGuide)
  const source = String(text ?? '')
  const bannedHits = guide.bannedWords
    .map(word => ({ word, count: source.split(word).length - 1 }))
    .filter(item => item.count > 0)
  let longParagraphs = 0
  let missingCaptions = 0
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (block.type === 'paragraph' && plainText(block.text).length > guide.maxParagraphChars) longParagraphs += 1
    if (block.type === 'image' && String(block.alt ?? '').trim() === '') missingCaptions += 1
  }
  const captions = guide.requireCaptions ? missingCaptions : 0
  return {
    guide,
    active: guide.bannedWords.length > 0 || guide.preferredWords.length > 0 || guide.requireCaptions,
    bannedHits,
    longParagraphs,
    missingCaptions: captions,
    violations: bannedHits.length + longParagraphs + captions,
  }
}

/** Stable short hash for a block's text, used for AI provenance and locks. */
export function hashBlock(text) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

/** Replace every literal occurrence of `find`; returns the new text and count. */
export function replaceAllOccurrences(text, find, replacement) {
  const source = String(text ?? '')
  const needle = String(find ?? '')
  if (needle === '') return { text: source, count: 0 }
  const count = source.split(needle).length - 1
  return { text: source.split(needle).join(String(replacement ?? '')), count }
}

/**
 * Replace the caption/alt text of one Markdown image line.
 * @param {string} text Markdown source.
 * @param {number} lineIndex zero-based line to edit.
 * @param {string} caption new caption (brackets/newlines are stripped).
 * @returns {string} updated source; unchanged when the line is not an image.
 */
export function replaceImageCaption(text, lineIndex, caption) {
  const lines = String(text ?? '').split('\n')
  const line = lines[lineIndex]
  if (typeof line !== 'string') return text
  const match = /^(\s*!\[)([^\]]*)(\]\([^)]*\)\s*)$/.exec(line)
  if (!match) return text
  const safeCaption = String(caption ?? '').replace(/[\[\]\n\r]/g, '').trim()
  lines[lineIndex] = `${match[1]}${safeCaption}${match[3]}`
  return lines.join('\n')
}

/**
 * Line-level diff for previewing an AI rewrite.
 * Returns same/add/remove operations; very large inputs fall back to a
 * common-prefix/suffix diff so the panel stays responsive.
 * @param {string} before current text.
 * @param {string} after proposed text.
 * @param {{ maxCells?: number }} [options] LCS budget.
 * @returns {Array<{ type: 'same'|'add'|'remove', text: string }>}
 */
export function diffTextLines(before, after, options = {}) {
  const left = String(before ?? '').split('\n')
  const right = String(after ?? '').split('\n')
  const maxCells = options.maxCells ?? 200000
  const operations = []
  if (left.length * right.length > maxCells) {
    let prefix = 0
    while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix += 1
    let suffix = 0
    while (
      suffix < left.length - prefix
      && suffix < right.length - prefix
      && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
    ) suffix += 1
    for (let index = 0; index < prefix; index += 1) operations.push({ type: 'same', text: left[index] })
    for (let index = prefix; index < left.length - suffix; index += 1) operations.push({ type: 'remove', text: left[index] })
    for (let index = prefix; index < right.length - suffix; index += 1) operations.push({ type: 'add', text: right[index] })
    for (let index = right.length - suffix; index < right.length; index += 1) operations.push({ type: 'same', text: right[index] })
    return operations
  }
  const rows = left.length
  const columns = right.length
  const dp = Array.from({ length: rows + 1 }, () => new Uint32Array(columns + 1))
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = columns - 1; j >= 0; j -= 1) {
      dp[i][j] = left[i] === right[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  let i = 0
  let j = 0
  while (i < rows && j < columns) {
    if (left[i] === right[j]) {
      operations.push({ type: 'same', text: left[i] })
      i += 1
      j += 1
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      operations.push({ type: 'remove', text: left[i] })
      i += 1
    } else {
      operations.push({ type: 'add', text: right[j] })
      j += 1
    }
  }
  while (i < rows) { operations.push({ type: 'remove', text: left[i] }); i += 1 }
  while (j < columns) { operations.push({ type: 'add', text: right[j] }); j += 1 }
  return operations
}

/**
 * Split a long Markdown article into chunks for per-section AI rewrites.
 * Headings stay with their own section, and fenced code blocks are never cut.
 * @param {string} text Markdown text.
 * @param {number} maxChars soft upper bound per chunk.
 * @returns {string[]} chunks in document order.
 */
export function splitMarkdownChunks(text, maxChars = 3200) {
  const source = String(text ?? '').trim()
  if (source === '') return []
  if (source.length <= maxChars) return [source]
  const lines = source.split('\n')
  const chunks = []
  let current = []
  let size = 0
  let inFence = false
  const flush = () => {
    if (current.length === 0) return
    const chunk = current.join('\n').trim()
    if (chunk !== '') chunks.push(chunk)
    current = []
    size = 0
  }
  for (const line of lines) {
    const fence = /^\s*```/.test(line)
    const lineSize = line.length + 1
    if (!inFence && current.length > 0 && size + lineSize > maxChars) flush()
    current.push(line)
    size += lineSize
    if (fence) inFence = !inFence
  }
  flush()
  return chunks
}

/**
 * Pick the variant whose decoration vocabulary matches the article structure.
 * @param {any} theme chosen theme.
 * @param {object} features measured structure.
 * @param {number} seed exploration offset for ties.
 * @returns {any} variant.
 */
export function pickVariant(theme, features, seed = 0) {
  const scored = theme.variants.map((variant, index) => {
    let score = 0
    if (variant.sectionStyle === 'numbered' && features.headings >= 3) score += 2
    if ((variant.quoteStyle === 'card' || variant.quoteStyle === 'center') && features.quotes >= 2) score += 2
    if (variant.imageStyle === 'shadow' || variant.imageStyle === 'full') score += features.images >= 2 ? 1 : 0
    if (variant.listStyle === 'num' && features.listItems >= 4) score += 1
    if (variant.titleStyle === 'rule' && features.avgParagraph > 90) score += 1
    score -= index * 0.15
    return { variant, score, index }
  })
  scored.sort((a, b) => b.score - a.score)
  const best = scored[0].score
  const tied = scored.filter(entry => best - entry.score < 0.2)
  return tied[Math.abs(seed) % tied.length].variant
}

/** Cycle to the theme's other variant, keeping the caller's overrides. */
export function nextVariant(design) {
  if (design?.custom !== undefined && design.custom !== null) return { ...design }
  const theme = themeOf(design?.themeId)
  const current = variantOf(theme, design?.variantId)
  const index = theme.variants.findIndex(variant => variant.id === current.id)
  const next = theme.variants[(index + 1) % theme.variants.length]
  return { ...design, variantId: next.id, overrides: { ...(design?.overrides ?? {}) } }
}

/* ------------------------------------------------------------------ *
 * Colour helpers
 * ------------------------------------------------------------------ */

/** Mix two hex colours. @param {string} a first @param {string} b second @param {number} ratio share of b */
export function mixHex(a, b, ratio) {
  const left = hexToRgb(a)
  const right = hexToRgb(b)
  if (!left || !right) return a
  const mix = channel => Math.round(left[channel] + (right[channel] - left[channel]) * ratio)
  return rgbToHex(mix('r'), mix('g'), mix('b'))
}

/** Readable ink for a filled swatch: near-white or near-black. */
export function readableOn(hex) {
  const rgb = hexToRgb(hex)
  if (!rgb) return '#FFFFFF'
  const linear = value => {
    const scaled = value / 255
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * linear(rgb.r) + 0.7152 * linear(rgb.g) + 0.0722 * linear(rgb.b)
  return luminance > 0.45 ? '#141414' : '#FFFFFF'
}

function hexToRgb(hex) {
  const value = String(hex ?? '').replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return null
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  }
}

function rgbToHex(r, g, b) {
  const part = value => Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase()
}
