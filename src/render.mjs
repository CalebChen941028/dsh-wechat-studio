/**
 * Article renderer.
 *
 * Builds one plain node tree and exposes two projections of it: React elements
 * for the live preview, and an HTML string for the clipboard. Both must stay
 * identical, so the tree never carries class names, stylesheets, or anything
 * the WeChat editor would drop.
 */

import { parseInline, plainText } from './engine.mjs'

const FONT_STACK = {
  sans: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', sans-serif",
  serif: "'Songti SC', 'STSong', 'Noto Serif SC', 'Source Han Serif SC', SimSun, Georgia, serif",
  round: "'PingFang SC', 'Hiragino Sans GB', 'Yuanti SC', 'Microsoft YaHei', sans-serif",
}

const MONO_STACK = "'SF Mono', 'JetBrains Mono', Menlo, Consolas, 'Courier New', monospace"

const UNITLESS = new Set(['lineHeight', 'fontWeight', 'opacity', 'zIndex', 'order', 'flexGrow', 'flexShrink'])

const node = (tag, style, children = [], attrs = {}) => ({
  tag,
  style: style ?? {},
  children: typeof children === 'string' ? [children] : (children ?? []),
  attrs,
})
const text = value => String(value ?? '')
const span = (style, children, attrs) => node('span', style, children, attrs)
const section = (style, children, attrs) => node('section', style, children, attrs)
const image = (attrs, style) => node('img', style, [], attrs)

/** rgba() string from a hex colour and alpha. */
function rgba(hex, alpha) {
  const value = typeof hex === 'string' ? hex.replace('#', '') : ''
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return `rgba(0,0,0,${alpha})`
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

/** Page background: solid tone plus one restrained pattern layer. */
function surfaceBackground(surface) {
  const ink = surface.ink ?? '17,17,17'
  const style = { backgroundColor: surface.bg }
  switch (surface.pattern) {
    case 'paper':
      style.backgroundImage = `repeating-linear-gradient(45deg, rgba(${ink},0.02) 0px, rgba(${ink},0.02) 1px, transparent 1px, transparent 4px)`
      break
    case 'grid':
      style.backgroundImage = `repeating-linear-gradient(0deg, rgba(${ink},0.028) 0px, rgba(${ink},0.028) 1px, transparent 1px, transparent 24px), repeating-linear-gradient(90deg, rgba(${ink},0.028) 0px, rgba(${ink},0.028) 1px, transparent 1px, transparent 24px)`
      break
    case 'dots':
      style.backgroundImage = `radial-gradient(rgba(${ink},0.06) 1px, transparent 1.2px)`
      style.backgroundSize = '14px 14px'
      break
    case 'lines':
      style.backgroundImage = `repeating-linear-gradient(90deg, rgba(${ink},0.028) 0px, rgba(${ink},0.028) 1px, transparent 1px, transparent 30px)`
      break
    case 'wash':
      style.backgroundImage = `linear-gradient(180deg, ${rgba(surface.wash, 0.12)} 0%, ${rgba(surface.wash, 0)} 240px)`
      break
    default:
      break
  }
  return style
}

/** Small vector mark above the title; kept optional and quiet. */
function ornamentNode(surface, colors) {
  const accent = colors.accent
  const shape = (tag, attrs, style) => node(tag, style ?? {}, [], attrs)
  let children = []
  let viewBox = '0 0 54 22'
  switch (surface.ornament) {
    case 'corner':
      children = [
        shape('rect', { x: '30', y: '0', width: '24', height: '1.5' }, { fill: accent, opacity: 0.75 }),
        shape('rect', { x: '52.5', y: '0', width: '1.5', height: '16' }, { fill: accent, opacity: 0.75 }),
        shape('rect', { x: '26', y: '5', width: '3', height: '3' }, { fill: accent, opacity: 0.35 }),
      ]
      break
    case 'column':
      children = [
        shape('rect', { x: '2', y: '0', width: '1.2', height: '18' }, { fill: accent, opacity: 0.7 }),
        shape('rect', { x: '7', y: '8', width: '4', height: '4' }, { fill: accent, opacity: 0.55 }),
      ]
      viewBox = '0 0 20 22'
      break
    case 'seal':
      children = [
        shape('circle', { cx: '11', cy: '10', r: '9' }, { fill: accent, opacity: 0.12 }),
        shape('circle', { cx: '11', cy: '10', r: '3.4' }, { fill: accent, opacity: 0.85 }),
        shape('circle', { cx: '11', cy: '1.6', r: '1.1' }, { fill: accent, opacity: 0.45 }),
      ]
      viewBox = '0 0 22 20'
      break
    case 'leaf':
      children = [
        shape('path', { d: 'M2 20C8 14 13 8 21 2c-1 8-7 14-15 18z' }, { fill: accent, opacity: 0.55 }),
        shape('rect', { x: '3', y: '19', width: '17', height: '0.8' }, { fill: accent, opacity: 0.25 }),
      ]
      viewBox = '0 0 24 22'
      break
    default:
      return null
  }
  const svg = node('svg', { display: 'block', marginLeft: 'auto' }, children, {
    width: '54', height: '22', viewBox, fill: 'none', 'aria-hidden': 'true',
  })
  return section({ margin: '0 0 6px', lineHeight: 0 }, [svg])
}

/**
 * Build the article node tree.
 * @param {object} input blocks, design spec, and document metadata.
 * @returns {{ nodes: any[], title: string, wordCount: number }} render tree and derived facts.
 */
export function buildArticle(input) {
  const blocks = input.blocks ?? []
  const design = input.design
  const meta = input.meta ?? {}
  const colors = design.colors
  const type = design.type
  const layout = design.layout

  const titleBlock = blocks.find(block => block.type === 'title')
  // The publish title field is authoritative when set; otherwise the source H1.
  const titleText = plainText(meta.title || titleBlock?.text || '').trim()

  const bodyFont = FONT_STACK[type.bodyFont] ?? FONT_STACK.sans
  const titleFont = FONT_STACK[type.titleFont] ?? FONT_STACK.sans
  const baseStyle = {
    color: colors.text,
    fontFamily: bodyFont,
    fontSize: `${type.bodySize}px`,
    lineHeight: type.lineHeight,
    letterSpacing: `${type.letterSpacing}em`,
    wordBreak: 'break-word',
    textAlign: 'left',
  }
  const bodyInline = (value) => styledRuns(parseInline(value), design)

  const ctx = { design, colors, type, layout, titleFont, bodyFont, baseStyle, bodyInline }
  const surface = design.surface ?? { bg: colors.bg, pattern: 'none', ornament: 'none', ink: '17,17,17', wash: colors.accent }

  let headingIndex = 0
  const children = []
  const mark = ornamentNode(surface, colors)
  if (mark !== null) children.push(mark)
  if (titleText !== '') children.push(renderTitle(titleText, ctx, meta))

  const paragraphs = blocks.filter(block => block.type === 'paragraph')
  const firstParagraph = paragraphs[0]
  let didLead = false

  for (const block of blocks) {
    switch (block.type) {
      case 'title':
        break
      case 'heading':
        headingIndex += 1
        children.push(renderHeading(block, headingIndex, ctx))
        break
      case 'paragraph': {
        const isLead = design.decor.lead && !didLead && block === firstParagraph && paragraphs.length >= 3 && block.text.length <= 140
        if (isLead) didLead = true
        children.push(renderParagraph(block, ctx, isLead))
        break
      }
      case 'quote':
        children.push(renderQuote(block, ctx))
        break
      case 'list':
        children.push(renderList(block, ctx))
        break
      case 'image':
        children.push(renderImage(block, ctx))
        break
      case 'code':
        children.push(renderCode(block, ctx))
        break
      case 'divider':
        children.push(renderDivider(ctx))
        break
      default:
        break
    }
  }

  if (design.decor.showFooter && children.length > 1) children.push(renderFooter(ctx, meta))

  const root = section(
    {
      ...baseStyle,
      ...surfaceBackground(surface),
      padding: `4px ${layout.paddingX}px 10px`,
      maxWidth: '100%',
      boxSizing: 'border-box',
      margin: '0 auto',
    },
    children,
  )

  return { nodes: [root], title: titleText }
}

/* ------------------------------------------------------------------ *
 * Title
 * ------------------------------------------------------------------ */

function renderTitle(title, ctx, meta) {
  const { design, colors, type, layout, titleFont } = ctx
  const titleBase = {
    color: colors.text,
    fontFamily: titleFont,
    fontSize: `${type.titleSize}px`,
    fontWeight: type.titleWeight,
    lineHeight: 1.32,
    letterSpacing: type.titleTracking,
    margin: 0,
  }
  const metaLine = metaLineText(meta)
  const eyebrowText = design.decor.showEyebrow ? design.decor.eyebrow : ''
  const metaStyle = {
    fontSize: '12px',
    lineHeight: 1.7,
    letterSpacing: '0.08em',
    color: colors.secondary,
    marginTop: '12px',
  }
  const eyebrow = () => span(
    { display: 'inline-block', fontSize: '11px', letterSpacing: '0.24em', color: colors.accent, marginBottom: '10px' },
    text(eyebrowText),
  )
  const bar = (width = '34px', height = '3px', margin = '14px 0 0') => section({
    width, height, background: colors.accent, borderRadius: '2px',
  })

  let inner = null
  switch (design.decor.titleStyle) {
    case 'kicker':
      inner = section({ borderTop: `1px solid ${colors.border}`, paddingTop: '16px' }, [
        ...(eyebrowText !== '' ? [section({
          fontSize: '10.5px', letterSpacing: '0.3em', color: colors.accent, marginBottom: '10px',
        }, text(eyebrowText))] : []),
        section({ ...titleBase, fontSize: `${type.titleSize}px`, lineHeight: 1.24 }, text(title)),
        ...(metaLine !== '' && design.decor.showMeta ? [section({ ...metaStyle, marginTop: '14px' }, text(metaLine))] : []),
      ])
      break
    case 'rule':
      inner = section(
        { textAlign: 'center', borderTop: `1px solid ${colors.border}`, borderBottom: `1px solid ${colors.border}`, padding: '24px 6px 22px' },
        [
          ...(eyebrowText !== '' ? [span({
            display: 'inline-block', fontSize: '11px', letterSpacing: '0.26em', color: colors.accent, marginBottom: '12px',
          }, text(eyebrowText))] : []),
          section({ ...titleBase, textAlign: 'center', lineHeight: 1.38 }, text(title)),
          ...(metaLine !== '' && design.decor.showMeta ? [section({ ...metaStyle, textAlign: 'center' }, text(metaLine))] : []),
        ],
      )
      break
    case 'ribbon': {
      const ink = colors.accentInk
      inner = section(
        { background: colors.accent, borderRadius: '12px', padding: '26px 22px 22px' },
        [
          ...(eyebrowText !== '' ? [section({
            display: 'inline-block', fontSize: '11px', letterSpacing: '0.24em', color: ink, opacity: 0.72, marginBottom: '10px',
          }, text(eyebrowText))] : []),
          section({ ...titleBase, color: ink, fontSize: `${type.titleSize + 1}px` }, text(title)),
          ...(metaLine !== '' && design.decor.showMeta ? [section({ ...metaStyle, color: ink, opacity: 0.72 }, text(metaLine))] : []),
        ],
      )
      break
    }
    case 'tag':
      inner = section({}, [
        ...(eyebrowText !== '' ? [section({
          display: 'inline-block', background: colors.accentSoft, color: colors.accent,
          fontSize: '11px', letterSpacing: '0.2em', padding: '5px 10px', borderRadius: '4px', marginBottom: '13px',
        }, text(eyebrowText))] : []),
        section(titleBase, text(title)),
        bar('38px', '3px', '15px 0 0'),
        ...(metaLine !== '' && design.decor.showMeta ? [section(metaStyle, text(metaLine))] : []),
      ])
      break
    case 'boxed':
      inner = section(
        { border: `1.5px solid ${colors.accent}`, borderRadius: '12px', padding: '24px 20px 20px', background: colors.bg },
        [
          bar('26px', '3px', '0 0 16px'),
          ...(eyebrowText !== '' ? [section({
            fontSize: '11px', letterSpacing: '0.22em', color: colors.accent, marginBottom: '9px',
          }, text(eyebrowText))] : []),
          section(titleBase, text(title)),
          ...(metaLine !== '' && design.decor.showMeta ? [section(metaStyle, text(metaLine))] : []),
        ],
      )
      break
    case 'vertical':
      inner = section({ borderLeft: `4px solid ${colors.accent}`, paddingLeft: '16px' }, [
        ...(eyebrowText !== '' ? [section({
          fontSize: '11px', letterSpacing: '0.24em', color: colors.accent, marginBottom: '9px',
        }, text(eyebrowText))] : []),
        section(titleBase, text(title)),
        ...(metaLine !== '' && design.decor.showMeta ? [section(metaStyle, text(metaLine))] : []),
      ])
      break
    case 'underline':
      inner = section({}, [
        ...(eyebrowText !== '' ? [eyebrow()] : []),
        section({ ...titleBase, fontSize: `${type.titleSize + 2}px`, lineHeight: 1.28 }, text(title)),
        bar('46px', '4px', '16px 0 0'),
        ...(metaLine !== '' && design.decor.showMeta ? [section(metaStyle, text(metaLine))] : []),
      ])
      break
    case 'centered':
      inner = section({ textAlign: 'center' }, [
        section({ textAlign: 'center', margin: '0 0 18px' }, [
          span({ display: 'inline-block', width: '28px', height: '3px', background: colors.accent, borderRadius: '2px' }),
        ]),
        ...(eyebrowText !== '' ? [section({
          fontSize: '11px', letterSpacing: '0.24em', color: colors.accent, marginBottom: '12px', textAlign: 'center',
        }, text(eyebrowText))] : []),
        section({ ...titleBase, textAlign: 'center', lineHeight: 1.36 }, text(title)),
        ...(metaLine !== '' && design.decor.showMeta ? [section({ ...metaStyle, textAlign: 'center' }, text(metaLine))] : []),
      ])
      break
    case 'eyebrow':
    default:
      inner = section({}, [
        ...(eyebrowText !== '' ? [section({
          fontSize: '11px', letterSpacing: '0.3em', color: colors.accent, marginBottom: '12px',
        }, text(eyebrowText))] : []),
        section({ ...titleBase, fontSize: `${type.titleSize + 2}px`, fontWeight: 800, lineHeight: 1.24, letterSpacing: '0.01em' }, text(title)),
        bar('30px', '3px', '16px 0 0'),
        ...(metaLine !== '' && design.decor.showMeta ? [section(metaStyle, text(metaLine))] : []),
      ])
      break
  }

  return section({ marginBottom: `${design.layout.titleGap}px` }, [inner])
}

function metaLineText(meta) {
  const parts = []
  if (typeof meta.author === 'string' && meta.author.trim() !== '') parts.push(meta.author.trim())
  if (typeof meta.date === 'string' && meta.date.trim() !== '') parts.push(meta.date.trim())
  if (typeof meta.readingMinutes === 'number' && meta.readingMinutes > 0) parts.push(`约 ${meta.readingMinutes} 分钟`)
  return parts.join(' · ')
}

/* ------------------------------------------------------------------ *
 * Headings, paragraphs, lists
 * ------------------------------------------------------------------ */

function renderHeading(block, index, ctx) {
  const { design, colors, type } = ctx
  const level = block.level ?? 2
  const style = design.decor.sectionStyle
  const gap = `${Math.max(18, Math.round(type.paraGap * 1.4))}px 0 ${level === 3 ? '10px' : '14px'}`
  const headingStyle = level === 3
    ? { fontSize: '16px', fontWeight: 600, lineHeight: 1.7, letterSpacing: '0.02em', color: colors.text }
    : { fontSize: '19px', fontWeight: 700, lineHeight: 1.6, letterSpacing: '0.02em', color: colors.text }

  if (level === 3) {
    if (style === 'rule' || style === 'numbered') {
      return section({ margin: gap }, [
        section({ ...headingStyle, fontFamily: ctx.titleFont, fontSize: '16.5px', fontWeight: 600, letterSpacing: '0.03em' }, text(plainText(block.text))),
      ])
    }
    return section({ margin: gap }, [
      span({ color: colors.accent, marginRight: '6px' }, text('▍')),
      span(headingStyle, text(plainText(block.text))),
    ])
  }

  switch (style) {
    case 'tag':
      return section({ margin: gap }, [
        section({
          display: 'inline-block', background: colors.accentSoft, color: colors.accent,
          padding: '6px 12px', borderRadius: '6px', ...headingStyle, fontSize: '15.5px',
        }, text(plainText(block.text))),
      ])
    case 'rule':
      return section({ margin: gap, borderTop: `1px solid ${colors.border}`, paddingTop: '13px' }, [
        section({ fontSize: '10.5px', letterSpacing: '0.26em', color: colors.accent, marginBottom: '7px' }, text(String(index).padStart(2, '0'))),
        section({ ...headingStyle, fontSize: '18px', fontWeight: 600, letterSpacing: '0.03em' }, text(plainText(block.text))),
      ])
    case 'numbered':
      return section({ margin: gap }, [
        span({
          display: 'inline-block', minWidth: '24px', color: colors.accent,
          fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', verticalAlign: 'middle', marginRight: '8px',
        }, text(String(index).padStart(2, '0'))),
        span({ ...headingStyle, verticalAlign: 'middle' }, text(plainText(block.text))),
      ])
    case 'line':
      return section({ margin: gap, textAlign: 'center' }, [
        span({ display: 'inline-block', width: '22px', height: '1px', background: colors.border, verticalAlign: 'middle', marginRight: '10px' }),
        span({ ...headingStyle, fontSize: '17px', verticalAlign: 'middle' }, text(plainText(block.text))),
        span({ display: 'inline-block', width: '22px', height: '1px', background: colors.border, verticalAlign: 'middle', marginLeft: '10px' }),
      ])
    case 'dot':
      return section({ margin: gap }, [
        span({ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', background: colors.accent, verticalAlign: 'middle', marginRight: '10px' }),
        span({ ...headingStyle, verticalAlign: 'middle' }, text(plainText(block.text))),
      ])
    case 'ghost':
      return section({ margin: gap }, [
        section({ fontSize: '34px', fontWeight: 800, lineHeight: 1, color: colors.accentSoft, fontFamily: ctx.titleFont }, text(String(index).padStart(2, '0'))),
        section({ ...headingStyle, marginTop: '6px' }, text(plainText(block.text))),
      ])
    case 'bar':
    default:
      return section({ margin: gap, borderLeft: `4px solid ${colors.accent}`, paddingLeft: '11px' }, [
        section(headingStyle, text(plainText(block.text))),
      ])
  }
}

function renderParagraph(block, ctx, isLead) {
  const { design, colors, type, baseStyle, bodyInline } = ctx
  void design
  const style = {
    ...baseStyle,
    margin: `0 0 ${type.paraGap}px`,
    textAlign: 'left',
  }
  if (isLead) {
    style.fontSize = `${type.bodySize + 1}px`
    style.lineHeight = Math.round((type.lineHeight + 0.05) * 100) / 100
    style.color = colors.secondary
    style.marginBottom = `${type.paraGap + 4}px`
  }
  return section(style, bodyInline(block.text))
}

function renderQuote(block, ctx) {
  const { design, colors, type } = ctx
  const paragraphs = block.paragraphs ?? [block.text ?? '']
  const gap = `0 0 ${type.paraGap}px`
  const quoteText = {
    fontSize: `${type.bodySize + 0.5}px`,
    lineHeight: Math.round((type.lineHeight + 0.05) * 100) / 100,
    letterSpacing: `${type.letterSpacing}em`,
    margin: 0,
  }
  const paragraphNodes = (style) => paragraphs.map((paragraph, index) => section(
    { ...style, margin: index === paragraphs.length - 1 ? '0' : '0 0 8px' },
    ctx.bodyInline(paragraph),
  ))

  switch (design.decor.quoteStyle) {
    case 'card':
      return section({ background: colors.card, borderRadius: '10px', padding: '16px 18px 14px', margin: gap }, [
        section({ color: colors.accent, fontSize: '26px', lineHeight: 1, fontFamily: ctx.titleFont, marginBottom: '4px' }, text('“')),
        ...paragraphNodes({ ...quoteText, color: colors.text }),
      ])
    case 'center':
      return section({ textAlign: 'center', padding: '6px 10px', margin: `0 0 ${type.paraGap + 4}px` }, [
        section({ color: colors.accent, fontSize: '30px', lineHeight: 1, fontFamily: ctx.titleFont, marginBottom: '2px' }, text('“')),
        ...paragraphNodes({ ...quoteText, color: colors.secondary, textAlign: 'center', fontSize: `${type.bodySize + 1}px`, letterSpacing: '0.04em' }),
      ])
    case 'pull':
      return section({
        borderTop: `1px solid ${colors.border}`, borderBottom: `1px solid ${colors.border}`,
        padding: '17px 6px', margin: gap, textAlign: 'center',
      }, paragraphNodes({
        ...quoteText, color: colors.text, textAlign: 'center', fontFamily: ctx.titleFont,
        fontSize: `${type.bodySize + 2}px`, lineHeight: 1.8, letterSpacing: '0.02em',
      }))
    case 'tint':
      return section({ background: colors.accentSoft, borderRadius: '8px', padding: '15px 17px', margin: gap }, paragraphNodes({
        ...quoteText, color: colors.text,
      }))
    case 'stamp':
      return section({ border: `1px solid ${colors.accent}`, borderRadius: '8px', padding: '13px 15px', margin: gap }, [
        section({ fontSize: '11px', letterSpacing: '0.22em', color: colors.accent, marginBottom: '7px' }, text('摘 录')),
        ...paragraphNodes({ ...quoteText, color: colors.text }),
      ])
    case 'bar':
    default:
      return section({ borderLeft: `3px solid ${colors.accent}`, paddingLeft: '14px', margin: gap }, paragraphNodes({
        ...quoteText, color: colors.secondary,
      }))
  }
}

function renderList(block, ctx) {
  const { design, colors, type } = ctx
  const marker = (index) => {
    switch (design.decor.listStyle) {
      case 'num':
        return span({
          display: 'inline-block', width: '18px', height: '18px', lineHeight: '18px', borderRadius: '50%',
          background: colors.accentSoft, color: colors.accent, fontSize: '11px', textAlign: 'center',
          verticalAlign: 'middle', marginRight: '9px',
        }, text(String(index + 1)))
      case 'square':
        return span({ display: 'inline-block', width: '4px', height: '4px', background: colors.accent, verticalAlign: 'middle', marginRight: '10px' })
      case 'arrow':
        return span({ color: colors.accent, verticalAlign: 'middle', marginRight: '7px', fontSize: '13px' }, text('▸'))
      case 'dot':
      default:
        return span({ display: 'inline-block', width: '5px', height: '5px', borderRadius: '50%', background: colors.accent, verticalAlign: 'middle', marginRight: '10px' })
    }
  }

  const items = block.items.map((item, index) => section(
    { margin: index === block.items.length - 1 ? '0' : '0 0 9px', ...ctx.baseStyle },
    [
      block.ordered
        ? span({ color: colors.accent, fontWeight: 700, marginRight: '7px' }, text(`${index + 1}.`))
        : marker(index),
      ...ctx.bodyInline(item),
    ],
  ))
  return section({ margin: `0 0 ${type.paraGap}px` }, items)
}

/* ------------------------------------------------------------------ *
 * Media, divider, footer
 * ------------------------------------------------------------------ */

function renderImage(block, ctx) {
  const { design, colors, type, layout } = ctx
  const alt = plainText(block.alt ?? '').trim()
  const caption = alt === ''
    ? []
    : [section({ fontSize: '12px', lineHeight: 1.6, color: colors.secondary, textAlign: 'center', marginTop: '8px', letterSpacing: '0.04em' }, text(alt))]
  const width = design.decor.imageStyle === 'full' ? 100 : design.decor.imageWidth
  const align = design.decor.imageAlign
  const base = {
    width: `${width}%`,
    display: 'block',
    boxSizing: 'border-box',
    marginLeft: align === 'left' ? '0' : 'auto',
    marginRight: align === 'right' ? '0' : 'auto',
  }
  const wrap = (style, children) => section({ margin: `0 0 ${type.paraGap + 2}px`, textAlign: align, ...style }, children)

  switch (design.decor.imageStyle) {
    case 'rounded':
      return wrap({}, [image({ src: block.src, alt }, { ...base, borderRadius: '10px' }), ...caption])
    case 'shadow':
      return wrap({}, [image({ src: block.src, alt }, { ...base, borderRadius: '8px', boxShadow: '0 10px 26px rgba(0, 0, 0, 0.14)' }), ...caption])
    case 'frame':
      return wrap({ border: `1px solid ${colors.border}`, padding: '6px', background: '#FFFFFF', borderRadius: '6px' }, [
        image({ src: block.src, alt }, base),
        ...caption,
      ])
    case 'polaroid':
      return wrap({ background: '#FFFFFF', padding: '10px 10px 12px', boxShadow: '0 8px 22px rgba(0, 0, 0, 0.12)', borderRadius: '4px' }, [
        image({ src: block.src, alt }, base),
        ...(alt === '' ? [] : [section({ fontSize: '12px', lineHeight: 1.6, color: colors.secondary, textAlign: 'center', marginTop: '10px', fontFamily: ctx.titleFont }, text(alt))]),
      ])
    case 'full':
      return section({ margin: `0 ${-layout.paddingX}px ${type.paraGap + 2}px` }, [
        image({ src: block.src, alt }, { ...base, display: 'block' }),
        ...(alt === '' ? [] : [section({ fontSize: '12px', lineHeight: 1.6, color: colors.secondary, textAlign: 'center', marginTop: '8px' }, text(alt))]),
      ])
    case 'plain':
    default:
      return wrap({}, [image({ src: block.src, alt }, base), ...caption])
  }
}

function renderCode(block, ctx) {
  const { colors, type } = ctx
  return section({
    background: '#F6F8FA',
    borderRadius: '8px',
    padding: '13px 15px',
    margin: `0 0 ${type.paraGap}px`,
    overflowX: 'auto',
  }, [
    node('pre', {
      margin: 0,
      fontFamily: MONO_STACK,
      fontSize: '12.5px',
      lineHeight: 1.65,
      color: '#2B3138',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    }, [text(block.text)]),
  ])
}

function renderDivider(ctx) {
  const { design, colors } = ctx
  const hue = { color: colors.accent, verticalAlign: 'middle' }
  const line = (margin) => span({
    display: 'inline-block', width: '26px', height: '1px', background: colors.border, verticalAlign: 'middle', ...margin,
  })
  switch (design.decor.dividerStyle) {
    case 'dots':
      return section({ textAlign: 'center', margin: '2px 0 24px' }, [
        span({ display: 'inline-block', width: '4px', height: '4px', borderRadius: '50%', background: colors.accent, opacity: 0.55, margin: '0 4px' }),
        span({ display: 'inline-block', width: '4px', height: '4px', borderRadius: '50%', background: colors.accent, opacity: 0.8, margin: '0 4px' }),
        span({ display: 'inline-block', width: '4px', height: '4px', borderRadius: '50%', background: colors.accent, opacity: 0.55, margin: '0 4px' }),
      ])
    case 'diamond':
      return section({ textAlign: 'center', margin: '2px 0 26px' }, [
        line({ marginRight: '10px' }),
        span({ ...hue, fontSize: '8px' }, text('◆')),
        line({ marginLeft: '10px' }),
      ])
    case 'ornament':
      return section({ textAlign: 'center', margin: '2px 0 26px' }, [
        line({ marginRight: '10px' }),
        span({ ...hue, fontSize: '10px' }, text('✦')),
        line({ marginLeft: '10px' }),
      ])
    case 'dash':
      return section({ borderTop: `1px dashed ${colors.border}`, margin: '6px 0 26px' })
    case 'line':
      return section({ textAlign: 'center', margin: '4px 0 26px' }, [
        span({ display: 'inline-block', width: '42px', height: '1px', background: colors.border }),
      ])
    case 'none':
    default:
      return section({ height: '10px' })
  }
}

function renderFooter(ctx, meta) {
  const { design, colors, type } = ctx
  const hasSign = design.decor.footerSign.trim() !== ''
  return section({ marginTop: '30px', paddingTop: '20px', borderTop: `1px dashed ${colors.border}`, textAlign: 'center' }, [
    section({ fontSize: '11px', letterSpacing: '0.24em', color: colors.secondary, marginBottom: '12px' }, text('· 全 文 完 ·')),
    section({
      fontSize: '13px',
      lineHeight: 1.85,
      color: colors.secondary,
      letterSpacing: '0.03em',
      padding: '0 6px',
    }, text(design.decor.footerText)),
    ...(hasSign
      ? [section({ fontSize: '12px', letterSpacing: '0.1em', color: colors.accent, marginTop: '12px' }, text(design.decor.footerSign))]
      : []),
  ])
}

/* ------------------------------------------------------------------ *
 * Inline runs
 * ------------------------------------------------------------------ */

function styledRuns(runs, design) {
  const out = []
  for (const run of runs) {
    if (run.kind === 'text') out.push(text(run.text))
    else if (run.kind === 'strong') out.push(span({ fontWeight: 700, color: design.colors.accent }, text(run.text)))
    else if (run.kind === 'em') out.push(span({ color: design.colors.accent }, text(run.text)))
    else if (run.kind === 'del') out.push(span({ textDecoration: 'line-through', color: design.colors.secondary }, text(run.text)))
    else if (run.kind === 'mark') out.push(span({
      background: design.colors.accentSoft, color: design.colors.text, padding: '1px 4px', borderRadius: '3px',
    }, text(run.text)))
    else if (run.kind === 'code') out.push(span({
      fontFamily: MONO_STACK,
      background: design.colors.card,
      color: design.colors.text,
      padding: '1px 5px',
      borderRadius: '4px',
      fontSize: `${Math.max(12, design.type.bodySize - 1)}px`,
    }, text(run.text)))
    else if (run.kind === 'link') out.push(span({ color: design.colors.accent, textDecoration: 'none' }, text(run.text)))
    else out.push(text(run.text))
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Projections
 * ------------------------------------------------------------------ */

/**
 * Serialize the node tree to an HTML string with inline styles only.
 * @param {any[]} nodes render tree.
 * @returns {string} self-contained HTML.
 */
export function serializeNodes(nodes) {
  return nodes.map(serializeNode).join('')
}

function serializeNode(current) {
  if (typeof current === 'string') return escapeHtml(current)
  if (current === null || current === undefined) return ''
  if (current.tag === 'img') {
    const attrs = Object.entries(current.attrs ?? {})
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => ` ${key}="${escapeHtml(value)}"`)
      .join('')
    return `<img${attrs} style="${styleToCss(current.style)}">`
  }
  if (current.tag === 'br') return '<br>'
  const children = current.children.map(serializeNode).join('')
  const attrs = Object.entries(current.attrs ?? {})
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => ` ${key}="${escapeHtml(value)}"`)
    .join('')
  return `<${current.tag}${attrs} style="${styleToCss(current.style)}">${children}</${current.tag}>`
}

/**
 * Convert the node tree to React elements for the live preview.
 * @param {any[]} nodes render tree.
 * @param {Function} h React.createElement.
 * @returns {any[]} React children.
 */
export function nodesToReact(nodes, h) {
  return nodes.map((current, index) => {
    if (typeof current === 'string') return current
    if (current === null || current === undefined) return null
    const props = { key: index, ...(current.attrs ?? {}), style: reactStyle(current.style) }
    if (current.tag === 'img') {
      return h('img', { ...props, loading: 'lazy', decoding: 'async' })
    }
    return h(current.tag, props, ...nodesToReact(current.children, h))
  })
}

function reactStyle(style) {
  const out = {}
  for (const [key, value] of Object.entries(style ?? {})) {
    if (value === undefined || value === null || value === '') continue
    out[key] = value
  }
  return out
}

/**
 * Convert a camelCase style object into a CSS declaration list.
 * @param {object} style style object.
 * @returns {string} `a:b;c:d` text.
 */
export function styleToCss(style) {
  const parts = []
  for (const [key, value] of Object.entries(style ?? {})) {
    if (value === undefined || value === null || value === '') continue
    const prop = key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)
    const rendered = typeof value === 'number' && !UNITLESS.has(key) ? `${value}px` : String(value)
    parts.push(`${prop}:${rendered}`)
  }
  return parts.join(';')
}

/** HTML-escape text content and attribute values. */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Collect base64 image sources from a render tree so the Host can upload them
 * to the WeChat CDN and rewrite each one to the returned URL.
 * @param {any[]} nodes render tree.
 * @returns {string[]} data URLs in document order.
 */
export function collectDataImages(nodes) {
  const found = []
  const walk = list => {
    for (const current of list) {
      if (typeof current === 'string' || !current) continue
      if (current.tag === 'img') {
        const src = current.attrs?.src
        if (typeof src === 'string' && src.startsWith('data:image/')) found.push(src)
      }
      walk(current.children ?? [])
    }
  }
  walk(nodes)
  return found
}

/**
 * Replace data URL image sources in place with the URLs returned by the Host.
 * @param {any[]} nodes render tree (mutated).
 * @param {Map<string, string>} mapping data URL to CDN URL.
 */
export function rewriteImageSources(nodes, mapping) {
  const walk = list => {
    for (const current of list) {
      if (typeof current === 'string' || !current) continue
      if (current.tag === 'img') {
        const src = current.attrs?.src
        if (typeof src === 'string' && mapping.has(src)) current.attrs.src = mapping.get(src)
      }
      walk(current.children ?? [])
    }
  }
  walk(nodes)
}
