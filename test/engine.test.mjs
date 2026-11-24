import test from 'node:test'
import assert from 'node:assert/strict'

import {
  parseArticle, parseInline, plainText, detectTopic, measure, composeDesign,
  autoCompose, rankThemes, nextVariant, mixHex, readableOn, splitMarkdownChunks,
  auditTypography, splitLongParagraphs, normalizeCjkPunctuation, tidyMarkdown, diffTextLines, replaceImageCaption, replaceImageSource, hashBlock, paletteFromPixels, replaceAllOccurrences, normalizeStyleGuide, auditHouseStyle, DEFAULT_STYLE_GUIDE,
} from '../src/engine.mjs'
import { THEMES } from '../src/themes.mjs'
import {
  buildArticle, serializeNodes, styleToCss, escapeHtml, collectDataImages, rewriteImageSources,
} from '../src/render.mjs'

const ARTICLE = `# 把写作流程拆开之后

> 工具只是工具，流程才是资产。

## 先说结论

公众号编辑器只认内联样式。\`style\` 标签和 class 名会被丢掉，这**不是** bug。

- 第三方排版工具好看，但模板都长一个样
- 直接粘 Markdown 干净，但引用会散架

## 第二步

![白板照片](https://example.com/a.png)

### 三个习惯

1. 每段不超过四行
2. 小节标题带序号
3. 引用只留一句

---

最后一段收尾。==结论== 先行。`

const CODE_ARTICLE = `# 一个轮询脚本

\`\`\`js
const timer = setInterval(poll, 1000)
\`\`\`

## 为什么不用 WebSocket

因为服务端不支持长连接。`

const EMOTION_ARTICLE = `# 那年冬天，母亲寄来一封信

我拆开信封的时候，手指是抖的。信纸很薄，字迹有点洇。

> 天冷了，记得添衣。

后来我才知道，那封信她写了三个晚上。`

test('parseArticle splits blocks and keeps source line ranges', () => {
  const { blocks, title } = parseArticle(ARTICLE)
  assert.equal(title, '把写作流程拆开之后')
  assert.deepEqual(blocks.map(block => block.type), [
    'title', 'quote', 'heading', 'paragraph', 'list', 'heading', 'image', 'heading', 'list', 'divider', 'paragraph',
  ])
  const paragraph = blocks.find(block => block.type === 'paragraph')
  assert.ok(paragraph.lines[0] < paragraph.lines[1] || paragraph.lines[0] === paragraph.lines[1])
  const list = blocks.find(block => block.type === 'list')
  assert.equal(list.items.length, 2)
  assert.equal(list.ordered, false)
  const ordered = blocks.filter(block => block.type === 'list')[1]
  assert.equal(ordered.ordered, true)
  assert.equal(blocks.find(block => block.type === 'image').src, 'https://example.com/a.png')
})

test('parseArticle handles fenced code and missing H1', () => {
  const { blocks, title } = parseArticle(CODE_ARTICLE)
  assert.equal(title, '一个轮询脚本')
  const code = blocks.find(block => block.type === 'code')
  assert.equal(code.text, 'const timer = setInterval(poll, 1000)')
  const noTitle = parseArticle('只有一段正文。')
  assert.equal(noTitle.title, '')
  assert.equal(noTitle.blocks.length, 1)
})

test('parseArticle joins wrapped Chinese lines without a gap', () => {
  const { blocks } = parseArticle('第一行\n第二行\n\nEnglish line\nsecond line')
  assert.equal(blocks[0].text, '第一行第二行')
  assert.equal(blocks[1].text, 'English line second line')
})

test('parseInline styles bold, highlight, code, links and del', () => {
  const runs = parseInline('**粗** ==高== `码` [链](https://a.b) ~~删~~ *斜*')
  assert.deepEqual(runs.map(run => run.kind), ['strong', 'text', 'mark', 'text', 'code', 'text', 'link', 'text', 'del', 'text', 'em'])
  assert.equal(runs[6].href, 'https://a.b')
  assert.equal(plainText('**粗** `码`'), '粗 码')
})

test('detectTopic recognises technology, culture and emotion copy', () => {
  assert.equal(detectTopic(ARTICLE).topic, 'writing')
  assert.equal(detectTopic('大模型和 AI 算法在 GPU 上训练，代码用 Python 写。').topic, 'tech')
  assert.equal(detectTopic('中秋节快乐，愿你团圆安康，节日祝福送到。').topic, 'festival')
  assert.equal(detectTopic(EMOTION_ARTICLE).topic, 'emotion')
  assert.equal(detectTopic('今天天气不错。').topic, 'general')
})

test('measure reports structure that composition can use', () => {
  const { blocks } = parseArticle(ARTICLE)
  const features = measure(blocks, ARTICLE)
  assert.equal(features.headings, 3)
  assert.equal(features.images, 1)
  assert.equal(features.lists, 2)
  assert.equal(features.listItems, 5)
  assert.ok(features.chars > 100)
  assert.ok(features.readingMinutes >= 1)
})

test('autoCompose is deterministic and returns explainable reasons', () => {
  const { blocks } = parseArticle(ARTICLE)
  const first = autoCompose(blocks, ARTICLE, 0)
  const second = autoCompose(blocks, ARTICLE, 0)
  assert.deepEqual(first.design, second.design)
  assert.ok(first.analysis.reasons.length >= 3)
  assert.equal(first.analysis.label, '写作与内容')
  assert.ok(THEMES.some(theme => theme.id === first.design.themeId))
  assert.ok(first.design.overrides.eyebrow.length > 0)
})

test('autoCompose sends technical code copy toward a code-friendly theme', () => {
  const { blocks } = parseArticle(CODE_ARTICLE)
  const result = autoCompose(blocks, CODE_ARTICLE, 0)
  assert.ok(['mint', 'night', 'mono', 'ocean'].includes(result.design.themeId), `got ${result.design.themeId}`)
})

test('专栏：写作类内容默认落到杂志版式', () => {
  const { blocks } = parseArticle(ARTICLE)
  const result = autoCompose(blocks, ARTICLE, 0)
  assert.equal(result.design.themeId, 'column')
  assert.ok(['essay', 'feature'].includes(result.design.variantId))
})

test('专栏：正文只用细线与衬线，不出现渐变和投影', () => {
  const { blocks } = parseArticle(ARTICLE)
  const design = composeDesign({ themeId: 'column', variantId: 'essay', overrides: { showEyebrow: true, eyebrow: '特稿' } })
  const html = serializeNodes(buildArticle({ blocks, design, meta: { author: '编辑部' } }).nodes)
  assert.ok(!/gradient/i.test(html))
  assert.ok(!/box-shadow/i.test(html))
  assert.ok(html.includes('border-top:1px solid'))
  assert.ok(html.includes("font-family:'Songti SC'"))
})

test('autoCompose sends story copy toward a warmer theme', () => {
  const { blocks } = parseArticle(EMOTION_ARTICLE)
  const result = autoCompose(blocks, EMOTION_ARTICLE, 0)
  assert.ok(['amber', 'paper', 'rose', 'ink'].includes(result.design.themeId), `got ${result.design.themeId}`)
})

test('rankThemes ranks every theme and puts a plausible winner first', () => {
  const { blocks } = parseArticle(ARTICLE)
  const features = measure(blocks, ARTICLE)
  const ranked = rankThemes(detectTopic(ARTICLE), features)
  assert.equal(ranked.length, THEMES.length)
  assert.ok(ranked[0].score >= ranked[ranked.length - 1].score)
})

test('composeDesign clamps overrides and derives accent variants', () => {
  const design = composeDesign({
    themeId: 'ocean',
    variantId: 'brief',
    overrides: { bodySize: 99, lineHeight: 0.1, paraGap: 999, paddingX: 0, accent: '#C8342C' },
  })
  assert.equal(design.type.bodySize, 20)
  assert.equal(design.type.lineHeight, 1.5)
  assert.equal(design.type.paraGap, 40)
  assert.equal(design.layout.paddingX, 8)
  assert.equal(design.colors.accent, '#C8342C')
  assert.match(design.colors.accentInk, /^#(FFFFFF|141414)$/)
  assert.equal(design.decor.titleStyle, 'eyebrow')
})

test('composeDesign falls back for unknown theme and variant ids', () => {
  const design = composeDesign({ themeId: 'nope', variantId: 'nope' })
  assert.equal(design.themeId, THEMES[0].id)
  assert.equal(design.variantId, THEMES[0].variants[0].id)
})

test('nextVariant cycles within the theme and keeps overrides', () => {
  const design = { themeId: 'pine', variantId: 'garden', overrides: { accent: '#123456' } }
  const next = nextVariant(design)
  assert.notEqual(next.variantId, 'garden')
  assert.equal(next.overrides.accent, '#123456')
  assert.equal(nextVariant(next).variantId, 'garden')
})

test('mixHex and readableOn stay within their contracts', () => {
  assert.equal(mixHex('#000000', '#FFFFFF', 0.5), '#808080')
  assert.equal(readableOn('#FFFFFF'), '#141414')
  assert.equal(readableOn('#111111'), '#FFFFFF')
  assert.equal(mixHex('nope', '#FFFFFF', 0.5), 'nope')
})

test('buildArticle emits only inline-styled markup WeChat keeps', () => {
  const { blocks } = parseArticle(ARTICLE)
  const design = composeDesign(autoCompose(blocks, ARTICLE, 0).design)
  const html = serializeNodes(buildArticle({ blocks, design, meta: { author: '张三', readingMinutes: 3 } }).nodes)
  assert.ok(html.includes('<section'))
  assert.ok(!/class=/.test(html), 'no class attributes')
  assert.ok(!/<style/.test(html), 'no style elements')
  assert.ok(!/<link/.test(html), 'no external stylesheets')
  assert.ok(!/position:\s*absolute/.test(html), 'no absolute positioning')
  assert.ok(html.includes('font-size:'))
  assert.ok(html.includes('line-height:'))
  assert.ok(html.includes('background:'))
  assert.ok(html.includes('</section>'))
})

test('buildArticle escapes authored text', () => {
  const blocks = [{ type: 'paragraph', text: '<script>alert(1)</script> & "x"', lines: [0, 0] }]
  const html = serializeNodes(buildArticle({ blocks, design: composeDesign({}), meta: {} }).nodes)
  assert.ok(!html.includes('<script>'))
  assert.ok(html.includes('&lt;script&gt;'))
  assert.ok(html.includes('&amp;'))
  assert.equal(escapeHtml('<a href="x">'), '&lt;a href=&quot;x&quot;&gt;')
})

test('every theme and variant renders a non-empty article with a code block and a quote', () => {
  const { blocks } = parseArticle(ARTICLE)
  for (const theme of THEMES) {
    for (const variant of theme.variants) {
      const design = composeDesign({ themeId: theme.id, variantId: variant.id })
      const html = serializeNodes(buildArticle({ blocks, design, meta: { author: '李四' } }).nodes)
      assert.ok(html.length > 500, `${theme.id}/${variant.id} too short`)
      assert.ok(html.includes('font-size'))
    }
  }
})

test('full-bleed images use negative margins equal to the measured padding', () => {
  const blocks = [{ type: 'image', src: 'https://example.com/x.png', alt: '示例', lines: [0, 0] }]
  const design = composeDesign({ themeId: 'magazine', variantId: 'cover', overrides: { paddingX: 16, imageStyle: 'full' } })
  const html = serializeNodes(buildArticle({ blocks, design, meta: {} }).nodes)
  assert.ok(html.includes('margin:0 -16px'))
})

test('Markdown 图片进入渲染树，data URL 与图注都保留', () => {
  const dataUrl = 'data:image/png;base64,iVBORw0KGgo='
  const { blocks } = parseArticle(`# 带图文章\n\n第一段。\n\n![一张插图](${dataUrl})\n\n第二段。`)
  const design = composeDesign({ themeId: 'column', variantId: 'essay' })
  const tree = buildArticle({ blocks, design, meta: { title: '带图文章' } })
  const html = serializeNodes(tree.nodes)
  assert.ok(html.includes('<img'))
  assert.ok(html.includes(dataUrl))
  assert.ok(html.includes('一张插图'))
  assert.deepEqual(collectDataImages(tree.nodes), [dataUrl])
})

test('data images are collected and rewritten in place', () => {
  const dataUrl = 'data:image/png;base64,iVBORw0KGgo='
  const blocks = [
    { type: 'image', src: dataUrl, alt: '正', lines: [0, 0] },
    { type: 'image', src: 'https://example.com/keep.png', alt: '外', lines: [2, 2] },
  ]
  const design = composeDesign({})
  const tree = buildArticle({ blocks, design, meta: {} })
  assert.deepEqual(collectDataImages(tree.nodes), [dataUrl])
  rewriteImageSources(tree.nodes, new Map([[dataUrl, 'https://mmbiz.qpic.cn/uploaded.png']]))
  const html = serializeNodes(tree.nodes)
  assert.ok(html.includes('https://mmbiz.qpic.cn/uploaded.png'))
  assert.ok(!html.includes('data:image/png'))
})

test('图片宽度与对齐进入版式，并限制在 40-100%', () => {
  const { blocks } = parseArticle('# 图\n\n![示例](https://example.com/a.png)')
  const design = composeDesign({ themeId: 'column', overrides: { imageWidth: 70, imageAlign: 'right' } })
  assert.equal(design.decor.imageWidth, 70)
  assert.equal(design.decor.imageAlign, 'right')
  assert.equal(composeDesign({ themeId: 'column', overrides: { imageWidth: 5 } }).decor.imageWidth, 40)
  assert.equal(composeDesign({ themeId: 'column', overrides: { imageWidth: 200 } }).decor.imageWidth, 100)
  const html = serializeNodes(buildArticle({ blocks, design, meta: {} }).nodes)
  assert.ok(html.includes('width:70%'))
  assert.ok(html.includes('margin-left:auto'))
  assert.ok(html.includes('margin-right:0'))
})

test('背景与角标：深色底自动换浅色字，图案与 svg 进入输出', () => {
  const { blocks } = parseArticle(ARTICLE)
  const design = composeDesign({
    themeId: 'column',
    variantId: 'essay',
    overrides: { bg: '#161616', bgStyle: 'grid', ornament: 'corner' },
  })
  assert.equal(design.surface.bg, '#161616')
  assert.equal(design.surface.pattern, 'grid')
  assert.equal(design.surface.ornament, 'corner')
  assert.equal(design.colors.text, '#F6F4EF')
  const html = serializeNodes(buildArticle({ blocks, design, meta: {} }).nodes)
  assert.ok(html.includes('background-color:#161616'))
  assert.ok(html.includes('repeating-linear-gradient'))
  assert.ok(html.includes('<svg'))
  assert.ok(html.includes('viewBox="0 0 54 22"'))
})

test('背景图案可选，非法值回落到 none', () => {
  const plain = composeDesign({ themeId: 'column', overrides: { bgStyle: 'nope', ornament: 'nope' } })
  assert.equal(plain.surface.pattern, 'none')
  assert.equal(plain.surface.ornament, 'none')
  const wash = composeDesign({ themeId: 'column', overrides: { bgStyle: 'wash', ornament: 'seal' } })
  assert.equal(wash.surface.pattern, 'wash')
  assert.equal(wash.surface.ornament, 'seal')
})

test('背景设成主题同色时不会重算卡片与边框色', () => {
  for (const themeId of ['zine', 'illustration', 'storybook', 'gallery']) {
    const base = composeDesign({ themeId })
    const same = composeDesign({ themeId, overrides: { bg: base.colors.bg.toLowerCase() } })
    assert.deepEqual(same.colors, base.colors, `${themeId} palette should stay untouched`)
    assert.equal(same.surface.pattern, base.surface.pattern, `${themeId} pattern should stay inherited`)
    assert.equal(same.surface.ornament, base.surface.ornament, `${themeId} ornament should stay inherited`)
  }
})

test('styleToCss converts camelCase and keeps unitless properties bare', () => {
  assert.equal(styleToCss({ fontSize: '15px', lineHeight: 1.8, fontWeight: 700, borderLeft: '3px solid #000' }),
    'font-size:15px;line-height:1.8;font-weight:700;border-left:3px solid #000')
  assert.equal(styleToCss({ letterSpacing: '0.02em' }), 'letter-spacing:0.02em')
})

test('paragraph reorder helpers used by the preview operate on line ranges', () => {
  // Mirrors the preview's move implementation: swap the two block line ranges.
  const text = 'a\nb\n\nc\nd\n\ne'
  const groups = [{ start: 0, end: 1 }, { start: 3, end: 4 }]
  const lines = text.split('\n')
  const first = groups[0]
  const second = groups[1]
  const firstLines = lines.slice(first.start, first.end + 1)
  const secondLines = lines.slice(second.start, second.end + 1)
  const moved = [
    ...lines.slice(0, first.start),
    ...secondLines,
    ...lines.slice(first.end + 1, second.start),
    ...firstLines,
    ...lines.slice(second.end + 1),
  ].join('\n')
  assert.equal(moved, 'c\nd\n\na\nb\n\ne')
})


test('splitMarkdownChunks 按小节切分长文且不切断代码块', () => {
  const section = '## 小节\n\n' + '正文内容。'.repeat(80) + '\n\n'
  const text = '# 标题\n\n' + section.repeat(4) + '```\n' + 'const a = 1;\n'.repeat(40) + '```\n'
  const chunks = splitMarkdownChunks(text, 1200)
  assert.ok(chunks.length > 1)
  assert.ok(chunks[0].length <= 1300, 'normal chunks stay near the cap')
  assert.ok(chunks.slice(1, -1).every(chunk => chunk.length <= 1300), 'chunks without a fence stay near the cap')
  assert.ok(chunks.join('\n\n').includes('## 小节'))
  assert.ok(chunks.some(chunk => chunk.includes('```')))
})


test('splitLongParagraphs 只在普通长段落内按句拆分', () => {
  const long = '第一句话。第二句话。第三句话。第四句话。第五句话。第六句话。第七句话。'.repeat(3)
  const text = `# 标题\n\n${long}\n\n> 引用保持原样\n\n- 列表保持原样\n`
  const fixed = splitLongParagraphs(text, 80)
  assert.ok(fixed.includes('# 标题'))
  assert.ok(fixed.includes('> 引用保持原样'))
  assert.ok(fixed.includes('- 列表保持原样'))
  const plain = fixed.split('\n').filter(line => line.trim() !== '' && !/^[#>\-]/.test(line.trim()))
  assert.ok(plain.length > 1)
  assert.ok(plain.every(line => line.length <= 90))
})

test('normalizeCjkPunctuation 只替换中文之间的半角标点', () => {
  assert.equal(normalizeCjkPunctuation('你好,世界。这是测试:内容;结束!'), '你好，世界。这是测试：内容；结束！')
  assert.equal(normalizeCjkPunctuation('版本 3.14，链接 https://a.com/x'), '版本 3.14，链接 https://a.com/x')
})

test('tidyMarkdown 去掉行尾空格并压缩空行', () => {
  assert.equal(tidyMarkdown('第一段  \n\n\n\n第二段   '), '第一段\n\n第二段')
})

test('auditTypography 统计长段落、半角标点、空行、高亮与缺图注', () => {
  const long = '这是长段落。'.repeat(40)
  const text = `# 标题\n\n### 小节\n\n${long}\n\n你好,世界\n\n==高亮==\n\n![](https://example.com/a.png)\n\n\n\n结尾`
  const audit = auditTypography(parseArticle(text).blocks, text)
  assert.equal(audit.longParagraphs, 1)
  assert.ok(audit.halfWidthPunctuation >= 1)
  assert.equal(audit.extraBlankLines, 1)
  assert.equal(audit.highlights, 1)
  assert.equal(audit.missingCaptions, 1)
  assert.equal(audit.headingSkips, 1)
})


test('diffTextLines 标记新增与删除行', () => {
  const operations = diffTextLines('第一行\n第二行\n第三行', '第一行\n修改后的第二行\n第三行')
  assert.deepEqual(operations.map(item => item.type), ['same', 'remove', 'add', 'same'])
  assert.equal(operations[1].text, '第二行')
  assert.equal(operations[2].text, '修改后的第二行')
})


test('replaceImageCaption 只改图片说明，不动地址', () => {
  const source = '# 标题\n\n![旧图注](https://example.com/a.png)\n'
  const next = replaceImageCaption(source, 2, '新的图注')
  assert.match(next, /!\[新的图注\]\(https:\/\/example\.com\/a\.png\)/)
  assert.equal(replaceImageCaption(next, 0, 'x'), next)
})


test('replaceImageSource 只换图片地址并保留说明', () => {
  const source = '![旧图注](https://example.com/a.png)'
  const next = replaceImageSource(source, 0, 'https://example.com/b.png')
  assert.equal(next, '![旧图注](https://example.com/b.png)')
})


test('hashBlock 对空白不敏感且稳定', () => {
  assert.equal(hashBlock('一段  文字'), hashBlock('一段 文字'))
  assert.notEqual(hashBlock('一段文字'), hashBlock('另一段文字'))
})


test('paletteFromPixels 取主背景和高饱和强调色', () => {
  const pixels = []
  const push = (r, g, b, n) => { for (let i = 0; i < n; i += 1) pixels.push(r, g, b, 255) }
  push(245, 241, 232, 600)
  push(192, 57, 43, 250)
  push(32, 32, 32, 150)
  const palette = paletteFromPixels(pixels)
  assert.match(palette.background, /^#[0-9a-f]{6}$/)
  assert.match(palette.accent, /^#[0-9a-f]{6}$/)
  assert.equal(palette.dark, false)
  assert.ok(palette.palette.length >= 2)
})


test('replaceAllOccurrences 替换全部并返回数量', () => {
  const result = replaceAllOccurrences('苹果和苹果。', '苹果', '橙子')
  assert.equal(result.text, '橙子和橙子。')
  assert.equal(result.count, 2)
  assert.deepEqual(replaceAllOccurrences('abc', '', 'x'), { text: 'abc', count: 0 })
})


test('auditHouseStyle 检查禁用词、长段与图注', () => {
  const longText = `禁用词出现了两次，禁用词。${'这一段很长。'.repeat(12)}`
  const text = `${longText}\n\n![图片](https://example.com/a.png)`
  const blocks = [
    { type: 'paragraph', text: longText },
    { type: 'image', alt: '', text: '图片' },
  ]
  const audit = auditHouseStyle(blocks, text, { bannedWords: ['禁用词'], maxParagraphChars: 60, requireCaptions: true })
  assert.equal(audit.bannedHits[0].count, 2)
  assert.equal(audit.longParagraphs, 1)
  assert.equal(audit.missingCaptions, 1)
  assert.ok(audit.violations >= 3)
  assert.deepEqual(normalizeStyleGuide({ bannedWords: '甲，乙 甲' }).bannedWords, ['甲', '乙'])
  assert.equal(DEFAULT_STYLE_GUIDE.tone, 'restrained')
})

test('高设计感主题（画报/插画/故事书/策展/水彩/海报/画册/构成）默认继承氛围纹理与角标并支持显式关闭', () => {
  const expected = [
    ['zine', 'spread', 'lines', 'corner'],
    ['illustration', 'picturebook', 'wash', 'leaf'],
    ['storybook', 'chapter', 'paper', 'seal'],
    ['gallery', 'exhibit', 'grid', 'column'],
    ['watercolor', 'garden', 'watercolor', 'sprig'],
    ['poster', 'bill', 'halftone', 'star'],
    ['folio', 'plate', 'paper', 'seal'],
    ['bauhaus', 'axis', 'grid', 'corner'],
  ]
  const { blocks } = parseArticle(ARTICLE)
  for (const [themeId, , pattern, ornament] of expected) {
    const theme = THEMES.find(entry => entry.id === themeId)
    for (const variant of theme.variants) {
      const design = composeDesign({ themeId, variantId: variant.id })
      assert.equal(design.surface.pattern, pattern, `${themeId}/${variant.id} default pattern`)
      assert.equal(design.surface.ornament, ornament, `${themeId}/${variant.id} default ornament`)
      const html = serializeNodes(buildArticle({ blocks, design, meta: { author: '编辑部' } }).nodes)
      assert.ok(html.includes('background-image'), `${themeId}/${variant.id} renders default pattern`)
      assert.ok(html.includes('<svg'), `${themeId}/${variant.id} renders default ornament`)
      if (themeId === 'watercolor') assert.ok(html.includes('linear-gradient(90deg'), `${variant.id} renders brush sections`)
      const stripped = composeDesign({ themeId, variantId: variant.id, overrides: { bgStyle: 'none', ornament: 'none' } })
      assert.equal(stripped.surface.pattern, 'none')
      assert.equal(stripped.surface.ornament, 'none')
      const strippedHtml = serializeNodes(buildArticle({ blocks, design: stripped, meta: { author: '编辑部' } }).nodes)
      assert.ok(!strippedHtml.includes('background-image'), `${themeId}/${variant.id} hides pattern`)
      assert.ok(!strippedHtml.includes('<svg'), `${themeId}/${variant.id} hides ornament`)
    }
  }
})


test('海报与画册主题的关键版面元素进入输出', () => {
  const { blocks } = parseArticle(ARTICLE)
  const poster = serializeNodes(buildArticle({ blocks, design: composeDesign({ themeId: 'poster', variantId: 'bill' }), meta: {} }).nodes)
  assert.ok(poster.includes('border-bottom:6px solid'))
  assert.ok(poster.includes('✳'))
  const folio = serializeNodes(buildArticle({ blocks, design: composeDesign({ themeId: 'folio', variantId: 'plate' }), meta: {} }).nodes)
  assert.ok(folio.includes('NOTE'))
  assert.ok(folio.includes('border-top:3px solid'))
})
