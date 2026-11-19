/**
 * Content parsing, topic analysis, and automatic layout composition.
 *
 * Everything here is pure: the same text and seed always produce the same
 * design, so the panel can re-render on every keystroke and the tests can pin
 * the output.
 */

import { THEMES, themeOf, variantOf } from './themes.mjs'

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

/**
 * Compose the design object the renderer consumes: theme palette and type
 * scale, variant decoration vocabulary, then explicit user overrides.
 * @param {object} stored stored design `{ themeId, variantId, overrides }`.
 * @returns {object} complete design spec.
 */
export function composeDesign(stored) {
  const input = stored && typeof stored === 'object' ? stored : {}
  const theme = themeOf(input.themeId)
  const variant = variantOf(theme, input.variantId)
  const overrides = input.overrides && typeof input.overrides === 'object' ? input.overrides : {}

  const colors = { ...theme.palette }
  if (typeof overrides.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(overrides.accent)) {
    colors.accent = overrides.accent
    colors.accentSoft = mixHex(overrides.accent, colors.bg, 0.12)
    colors.border = mixHex(overrides.accent, colors.bg, 0.2)
  }

  // Background override: keep text readable when the page turns dark.
  const customBg = typeof overrides.bg === 'string' && /^#[0-9a-fA-F]{6}$/.test(overrides.bg) ? overrides.bg : undefined
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

  const BG_PATTERNS = ['none', 'paper', 'grid', 'dots', 'lines', 'wash']
  const ORNAMENTS = ['none', 'corner', 'column', 'seal', 'leaf']
  const surface = {
    bg: colors.bg,
    pattern: BG_PATTERNS.includes(overrides.bgStyle) ? overrides.bgStyle : 'none',
    ornament: ORNAMENTS.includes(overrides.ornament) ? overrides.ornament : 'none',
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

  const decor = {
    titleStyle: overrides.titleStyle ?? variant.titleStyle,
    sectionStyle: overrides.sectionStyle ?? variant.sectionStyle,
    dividerStyle: overrides.dividerStyle ?? variant.dividerStyle,
    quoteStyle: overrides.quoteStyle ?? variant.quoteStyle,
    listStyle: overrides.listStyle ?? variant.listStyle,
    imageStyle: overrides.imageStyle ?? variant.imageStyle,
    imageWidth: Math.round(Math.min(100, Math.max(40, typeof overrides.imageWidth === 'number' && Number.isFinite(overrides.imageWidth) ? overrides.imageWidth : 100))),
    imageAlign: ['left', 'center', 'right'].includes(overrides.imageAlign) ? overrides.imageAlign : 'center',
    showMeta: overrides.showMeta !== false,
    showFooter: overrides.showFooter !== false,
    showEyebrow: overrides.showEyebrow !== false,
    lead: overrides.lead !== false,
    eyebrow: typeof overrides.eyebrow === 'string' ? overrides.eyebrow : '',
    footerText: typeof overrides.footerText === 'string' && overrides.footerText.trim() !== ''
      ? overrides.footerText
      : '如果这篇内容对你有帮助，欢迎点个「在看」或转发给需要的人。',
    footerSign: typeof overrides.footerSign === 'string' ? overrides.footerSign : '',
  }

  return {
    themeId: theme.id,
    variantId: variant.id,
    themeName: theme.name,
    themeBg: theme.palette.bg,
    surface,
    variantName: variant.name,
    tagline: theme.tagline,
    colors,
    type,
    layout,
    decor,
  }
}

/**
 * Choose a theme and variant from the copy, then derive a few tasteful
 * adjustments from its length and structure.
 * @param {any[]} blocks parsed blocks.
 * @param {string} text raw copy.
 * @param {number} seed increments the exploration of equally ranked variants.
 * @returns {{ design: object, analysis: object }} stored design plus the reasoning shown in the panel.
 */
export function autoCompose(blocks, text, seed = 0) {
  const features = measure(blocks, text)
  const topic = detectTopic(text)
  const ranked = rankThemes(topic, features)
  const theme = ranked[0].theme
  const variant = pickVariant(theme, features, seed)
  const reasons = []

  reasons.push(topic.topic === 'general'
    ? '主题词命中不多，按结构与长度选版式'
    : `识别为「${topic.label}」主题（命中 ${Math.round(topic.matches[topic.topic] ?? 0)} 个关键词）`)

  const structure = []
  if (features.headings > 0) structure.push(`${features.headings} 个小节`)
  if (features.quotes > 0) structure.push(`${features.quotes} 段引用`)
  if (features.images > 0) structure.push(`${features.images} 张配图`)
  if (features.listItems > 0) structure.push(`${features.listItems} 条列表`)
  if (features.codeBlocks > 0) structure.push(`${features.codeBlocks} 段代码`)
  reasons.push(structure.length > 0 ? `结构：${structure.join(' / ')}` : `结构：${features.paragraphs} 段连续正文`)
  reasons.push(features.chars > 2200
    ? `篇幅 ${features.chars} 字，放宽行高到 ${theme.type.lineHeight}`
    : `篇幅 ${features.chars} 字，约 ${features.readingMinutes} 分钟读完`)
  reasons.push(`配色「${theme.name}」· 版式「${variant.name}」：${theme.tagline}`)
  if (features.avgParagraph > 90) reasons.push('长段落偏多，正文按更松的段间距离排')

  const titleLength = (blocks.find(block => block.type === 'title')?.text ?? plainText(text.split('\n')[0] ?? '')).length
  const overrides = {
    eyebrow: topic.label,
    titleSize: titleLength <= 10 ? theme.type.titleSize + 3 : titleLength >= 24 ? theme.type.titleSize - 3 : theme.type.titleSize,
    lead: features.hasLeadCandidate,
    showEyebrow: variant.titleStyle === 'eyebrow' || variant.titleStyle === 'tag' || variant.titleStyle === 'centered' || variant.titleStyle === 'kicker',
    bodySize: features.chars > 3000 ? Math.max(theme.type.bodySize, 16) : theme.type.bodySize,
    lineHeight: features.chars > 2200 ? Math.max(theme.type.lineHeight, 1.88) : theme.type.lineHeight,
  }

  return {
    design: { themeId: theme.id, variantId: variant.id, overrides },
    analysis: {
      topic: topic.topic,
      label: topic.label,
      matches: topic.matches,
      features,
      reasons,
      ranked: ranked.map(entry => ({ id: entry.theme.id, name: entry.theme.name, score: Math.round(entry.score * 100) / 100 })),
    },
  }
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
    if (features.quotes >= 2 && ['paper', 'ink', 'rose', 'amber', 'column'].includes(theme.id)) score += 0.12
    if (features.headings >= 3 && ['ocean', 'scholar', 'mono', 'night'].includes(theme.id)) score += 0.1
    if (features.avgParagraph > 90 && ['scholar', 'ink', 'paper', 'column'].includes(theme.id)) score += 0.08
    if (features.avgParagraph > 0 && features.avgParagraph < 35 && ['magazine', 'ink', 'pine'].includes(theme.id)) score += 0.06
    if (features.listItems >= 4 && ['pine', 'mint', 'mono'].includes(theme.id)) score += 0.06
    if (features.exclamations >= 2 && ['festival', 'amber', 'magazine'].includes(theme.id)) score += 0.08
    if (features.images >= 2 && ['magazine', 'ocean', 'rose'].includes(theme.id)) score += 0.05
    return { theme, score }
  })
  ranked.sort((a, b) => b.score - a.score)
  return ranked
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
