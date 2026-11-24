/**
 * Theme library for the WeChat article studio.
 *
 * A theme owns palette + type scale; a variant owns the decoration vocabulary
 * (title treatment, section header, divider, quote, list, image). Every value
 * here ends up as an inline CSS declaration, because the WeChat editor drops
 * stylesheets and class names.
 *
 * Topic affinity keys must match the topic ids declared in engine.mjs.
 */

const SANS = 'sans'
const SERIF = 'serif'
const ROUND = 'round'

/** @typedef {{ bg:string, card:string, text:string, secondary:string, accent:string, accentSoft:string, border:string }} Palette */

export const THEMES = [

  {
    id: 'column',
    name: '专栏',
    tagline: '衬线标题、细线与编号，克制的杂志内页',
    mood: ['克制', '耐读', '编辑感'],
    dropCap: true,
    topics: { writing: 0.9, culture: 0.75, lifestyle: 0.5, emotion: 0.4, academic: 0.5, business: 0.3, tech: 0.2 },
    palette: {
      bg: '#FCFAF6', card: '#F4EFE6', text: '#1E1B18', secondary: '#6F675D',
      accent: '#9A5B3D', accentSoft: '#F0E4DB', border: '#E3D9CC',
    },
    type: { titleFont: SERIF, bodyFont: SERIF, titleSize: 31, titleWeight: 600, titleTracking: '0.01em', bodySize: 16, lineHeight: 1.92, letterSpacing: '0.015em', paraGap: 24, paddingX: 20 },
    variants: [
      { id: 'essay', name: '随笔', titleStyle: 'kicker', sectionStyle: 'rule', dividerStyle: 'line', quoteStyle: 'pull', listStyle: 'num', imageStyle: 'plain' },
      { id: 'feature', name: '特稿', titleStyle: 'kicker', sectionStyle: 'numbered', dividerStyle: 'none', quoteStyle: 'pull', listStyle: 'num', imageStyle: 'plain' },
    ],
  },
  {
    id: 'ink',
    name: '墨白',
    tagline: '黑字、细线、大留白，让文章自己说话',
    mood: ['克制', '深度', '编辑感'],
    topics: { academic: 0.55, culture: 0.6, tech: 0.5, business: 0.5, lifestyle: 0.35, writing: 0.85 },
    palette: {
      bg: '#FAF9F5', card: '#F1EFE8', text: '#232323', secondary: '#6E6A63',
      accent: '#2F2A26', accentSoft: '#E8E4DB', border: '#DED9CF',
    },
    type: { titleFont: SERIF, bodyFont: SANS, titleSize: 30, titleWeight: 600, titleTracking: '0.03em', bodySize: 15.5, lineHeight: 1.85, letterSpacing: '0.015em', paraGap: 22, paddingX: 18 },
    variants: [
      { id: 'editorial', name: '社论', titleStyle: 'rule', sectionStyle: 'bar', dividerStyle: 'diamond', quoteStyle: 'bar', listStyle: 'dot', imageStyle: 'plain' },
      { id: 'index', name: '索引', titleStyle: 'eyebrow', sectionStyle: 'numbered', dividerStyle: 'line', quoteStyle: 'center', listStyle: 'num', imageStyle: 'shadow' },
    ],
  },
  {
    id: 'paper',
    name: '米纸',
    tagline: '旧纸的暖调，像一本翻旧了的随笔集',
    mood: ['温润', '文学', '慢'],
    dropCap: true,
    topics: { culture: 0.85, lifestyle: 0.6, emotion: 0.75, academic: 0.3, writing: 0.5 },
    palette: {
      bg: '#F8F1E3', card: '#EFE3CE', text: '#3A3026', secondary: '#7A6A57',
      accent: '#8E5E2F', accentSoft: '#EDE0CA', border: '#E0D2B8',
    },
    type: { titleFont: SERIF, bodyFont: SERIF, titleSize: 29, titleWeight: 600, titleTracking: '0.04em', bodySize: 15.5, lineHeight: 1.95, letterSpacing: '0.02em', paraGap: 24, paddingX: 20 },
    variants: [
      { id: 'letter', name: '书信', titleStyle: 'rule', sectionStyle: 'tag', dividerStyle: 'ornament', quoteStyle: 'card', listStyle: 'dot', imageStyle: 'polaroid' },
      { id: 'scroll', name: '卷轴', titleStyle: 'vertical', sectionStyle: 'bar', dividerStyle: 'dash', quoteStyle: 'tint', listStyle: 'square', imageStyle: 'frame' },
    ],
  },
  {
    id: 'pine',
    name: '青松',
    tagline: '清爽的绿，适合讲方法、讲经验',
    mood: ['清新', '成长', '利落'],
    topics: { education: 0.8, lifestyle: 0.65, health: 0.7, tech: 0.45, parent: 0.55, writing: 0.35 },
    palette: {
      bg: '#F8FAF5', card: '#EAF2E6', text: '#253027', secondary: '#657366',
      accent: '#4E7A5A', accentSoft: '#E3EFE4', border: '#D6E3D7',
    },
    type: { titleFont: SANS, bodyFont: SANS, titleSize: 28, titleWeight: 600, titleTracking: '0.02em', bodySize: 15.5, lineHeight: 1.8, letterSpacing: '0.01em', paraGap: 20, paddingX: 18 },
    variants: [
      { id: 'garden', name: '花园', titleStyle: 'ribbon', sectionStyle: 'tag', dividerStyle: 'dots', quoteStyle: 'tint', listStyle: 'dot', imageStyle: 'rounded' },
      { id: 'clean', name: '留白', titleStyle: 'underline', sectionStyle: 'bar', dividerStyle: 'line', quoteStyle: 'bar', listStyle: 'arrow', imageStyle: 'rounded' },
    ],
  },
  {
    id: 'ocean',
    name: '深海蓝',
    tagline: '结构清楚、层级分明，适合分析与复盘',
    mood: ['专业', '理性', '结构'],
    topics: { business: 0.9, tech: 0.75, finance: 0.8, academic: 0.6, education: 0.5, writing: 0.45 },
    palette: {
      bg: '#F6F8FB', card: '#E8EFF7', text: '#1F2A35', secondary: '#66717D',
      accent: '#3C6288', accentSoft: '#E2EBF3', border: '#D6E1EA',
    },
    type: { titleFont: SANS, bodyFont: SANS, titleSize: 28, titleWeight: 700, titleTracking: '0.01em', bodySize: 15.5, lineHeight: 1.8, letterSpacing: '0.01em', paraGap: 20, paddingX: 18 },
    variants: [
      { id: 'report', name: '报告', titleStyle: 'boxed', sectionStyle: 'numbered', dividerStyle: 'line', quoteStyle: 'card', listStyle: 'num', imageStyle: 'shadow' },
      { id: 'brief', name: '简报', titleStyle: 'eyebrow', sectionStyle: 'bar', dividerStyle: 'dash', quoteStyle: 'bar', listStyle: 'square', imageStyle: 'plain' },
    ],
  },
  {
    id: 'magazine',
    name: '摩登',
    tagline: '大标题、强对比，像一页封面',
    mood: ['锋利', '时髦', '视觉'],
    topics: { lifestyle: 0.8, business: 0.7, tech: 0.6, beauty: 0.8, food: 0.5, writing: 0.6 },
    palette: {
      bg: '#FAF7F2', card: '#F0E8DC', text: '#171513', secondary: '#6B6359',
      accent: '#C04A2E', accentSoft: '#F3E3DC', border: '#E1D6C8',
    },
    type: { titleFont: SANS, bodyFont: SANS, titleSize: 34, titleWeight: 800, titleTracking: '0em', bodySize: 16, lineHeight: 1.75, letterSpacing: '0.01em', paraGap: 20, paddingX: 16 },
    variants: [
      { id: 'cover', name: '封面', titleStyle: 'ribbon', sectionStyle: 'ghost', dividerStyle: 'line', quoteStyle: 'center', listStyle: 'num', imageStyle: 'full' },
      { id: 'feature', name: '特写', titleStyle: 'eyebrow', sectionStyle: 'bar', dividerStyle: 'dots', quoteStyle: 'tint', listStyle: 'arrow', imageStyle: 'shadow' },
    ],
  },
  {
    id: 'rose',
    name: '玫瑰',
    tagline: '柔和的粉调，适合审美、人物与生活方式',
    mood: ['柔和', '精致', '亲近'],
    topics: { beauty: 0.95, lifestyle: 0.75, emotion: 0.7, food: 0.45, writing: 0.3 },
    palette: {
      bg: '#FBF6F5', card: '#F5E9E8', text: '#35282B', secondary: '#7A6265',
      accent: '#8E4A55', accentSoft: '#F2E3E4', border: '#E8D6D7',
    },
    type: { titleFont: SANS, bodyFont: SANS, titleSize: 28, titleWeight: 600, titleTracking: '0.03em', bodySize: 15.5, lineHeight: 1.85, letterSpacing: '0.015em', paraGap: 22, paddingX: 18 },
    variants: [
      { id: 'soft', name: '软光', titleStyle: 'centered', sectionStyle: 'tag', dividerStyle: 'ornament', quoteStyle: 'card', listStyle: 'dot', imageStyle: 'rounded' },
      { id: 'glossy', name: '缎面', titleStyle: 'underline', sectionStyle: 'numbered', dividerStyle: 'line', quoteStyle: 'center', listStyle: 'num', imageStyle: 'polaroid' },
    ],
  },
  {
    id: 'amber',
    name: '暖橙',
    tagline: '暖色叙事，适合故事、经历与人物',
    mood: ['温暖', '叙事', '生活'],
    topics: { emotion: 0.9, lifestyle: 0.7, food: 0.6, education: 0.35, parent: 0.5, writing: 0.35 },
    palette: {
      bg: '#FDF8F0', card: '#F7EBDD', text: '#342A22', secondary: '#7A6A5A',
      accent: '#9C532A', accentSoft: '#F5E4D7', border: '#E8D7C5',
    },
    type: { titleFont: SERIF, bodyFont: SANS, titleSize: 28, titleWeight: 600, titleTracking: '0.03em', bodySize: 15.5, lineHeight: 1.9, letterSpacing: '0.015em', paraGap: 23, paddingX: 18 },
    variants: [
      { id: 'warm', name: '暖房', titleStyle: 'ribbon', sectionStyle: 'bar', dividerStyle: 'dash', quoteStyle: 'tint', listStyle: 'dot', imageStyle: 'rounded' },
      { id: 'story', name: '口述', titleStyle: 'eyebrow', sectionStyle: 'tag', dividerStyle: 'ornament', quoteStyle: 'center', listStyle: 'arrow', imageStyle: 'polaroid' },
    ],
  },
  {
    id: 'night',
    name: '夜幕',
    tagline: '深靛蓝配浅底，安静但有分量',
    mood: ['沉静', '思辨', '夜读'],
    topics: { tech: 0.85, academic: 0.65, culture: 0.55, business: 0.55, emotion: 0.45, writing: 0.35 },
    palette: {
      bg: '#F4F5F8', card: '#E7EAF1', text: '#1D2430', secondary: '#66707F',
      accent: '#4B5C7A', accentSoft: '#E2E7EF', border: '#D5DCE7',
    },
    type: { titleFont: SANS, bodyFont: SANS, titleSize: 28, titleWeight: 700, titleTracking: '0.02em', bodySize: 15.5, lineHeight: 1.85, letterSpacing: '0.01em', paraGap: 22, paddingX: 18 },
    variants: [
      { id: 'night', name: '夜航', titleStyle: 'boxed', sectionStyle: 'numbered', dividerStyle: 'line', quoteStyle: 'stamp', listStyle: 'num', imageStyle: 'shadow' },
      { id: 'calm', name: '静水', titleStyle: 'centered', sectionStyle: 'line', dividerStyle: 'dots', quoteStyle: 'bar', listStyle: 'dot', imageStyle: 'plain' },
    ],
  },
  {
    id: 'festival',
    name: '节庆',
    tagline: '红金配色，用在祝福、周年与节点',
    mood: ['热闹', '祝福', '仪式'],
    topics: { festival: 0.95, culture: 0.5, business: 0.4, emotion: 0.5, writing: 0.2 },
    palette: {
      bg: '#FDF6EE', card: '#F8E7D8', text: '#3A211C', secondary: '#7A5A4E',
      accent: '#B23A2E', accentSoft: '#F3DCD4', border: '#E8D1C3',
    },
    type: { titleFont: SERIF, bodyFont: SANS, titleSize: 30, titleWeight: 700, titleTracking: '0.05em', bodySize: 15.5, lineHeight: 1.85, letterSpacing: '0.015em', paraGap: 22, paddingX: 18 },
    variants: [
      { id: 'celebrate', name: '庆典', titleStyle: 'ribbon', sectionStyle: 'tag', dividerStyle: 'ornament', quoteStyle: 'stamp', listStyle: 'dot', imageStyle: 'frame' },
      { id: 'greeting', name: '贺卡', titleStyle: 'centered', sectionStyle: 'numbered', dividerStyle: 'line', quoteStyle: 'center', listStyle: 'num', imageStyle: 'rounded' },
    ],
  },
  {
    id: 'scholar',
    name: '学术',
    tagline: '编号、脚注式引用，适合研究与长文',
    mood: ['严谨', '正式', '论证'],
    dropCap: true,
    topics: { academic: 0.95, education: 0.7, business: 0.55, finance: 0.6, tech: 0.5, writing: 0.4 },
    palette: {
      bg: '#FBF9F4', card: '#F0EBE1', text: '#2A2A26', secondary: '#6F6A60',
      accent: '#5A6B4A', accentSoft: '#E8EADF', border: '#DDD6C8',
    },
    type: { titleFont: SERIF, bodyFont: SERIF, titleSize: 26, titleWeight: 700, titleTracking: '0.02em', bodySize: 15, lineHeight: 1.95, letterSpacing: '0.02em', paraGap: 20, paddingX: 18 },
    variants: [
      { id: 'paper', name: '论文', titleStyle: 'rule', sectionStyle: 'numbered', dividerStyle: 'line', quoteStyle: 'bar', listStyle: 'num', imageStyle: 'plain' },
      { id: 'notebook', name: '笔记', titleStyle: 'eyebrow', sectionStyle: 'bar', dividerStyle: 'dash', quoteStyle: 'tint', listStyle: 'square', imageStyle: 'frame' },
    ],
  },
  {
    id: 'mint',
    name: '薄荷',
    tagline: '干净的科学感，适合产品与工具说明',
    mood: ['干净', '轻快', '说明'],
    topics: { tech: 0.85, health: 0.75, education: 0.6, lifestyle: 0.5, writing: 0.35 },
    palette: {
      bg: '#F7FAF8', card: '#E8F2EC', text: '#22302B', secondary: '#60736B',
      accent: '#3F7D6B', accentSoft: '#E1F0E9', border: '#D2E4DB',
    },
    type: { titleFont: SANS, bodyFont: SANS, titleSize: 28, titleWeight: 600, titleTracking: '0.02em', bodySize: 15.5, lineHeight: 1.8, letterSpacing: '0.01em', paraGap: 20, paddingX: 18 },
    variants: [
      { id: 'fresh', name: '清透', titleStyle: 'ribbon', sectionStyle: 'tag', dividerStyle: 'dots', quoteStyle: 'tint', listStyle: 'dot', imageStyle: 'rounded' },
      { id: 'minimal', name: '极简', titleStyle: 'underline', sectionStyle: 'line', dividerStyle: 'line', quoteStyle: 'bar', listStyle: 'arrow', imageStyle: 'plain' },
    ],
  },
  {
    id: 'mono',
    name: '灰阶',
    tagline: '无彩色，信息密度优先',
    mood: ['中性', '效率', '清单'],
    topics: { tech: 0.6, business: 0.6, education: 0.5, academic: 0.5, writing: 0.4 },
    palette: {
      bg: '#F7F7F6', card: '#ECECEA', text: '#2A2A28', secondary: '#6C6C68',
      accent: '#555550', accentSoft: '#E6E6E2', border: '#DADAD6',
    },
    type: { titleFont: SANS, bodyFont: SANS, titleSize: 27, titleWeight: 700, titleTracking: '0.01em', bodySize: 15, lineHeight: 1.8, letterSpacing: '0.01em', paraGap: 18, paddingX: 18 },
    variants: [
      { id: 'grid', name: '网格', titleStyle: 'boxed', sectionStyle: 'bar', dividerStyle: 'dash', quoteStyle: 'bar', listStyle: 'square', imageStyle: 'frame' },
      { id: 'plain', name: '素面', titleStyle: 'underline', sectionStyle: 'line', dividerStyle: 'line', quoteStyle: 'center', listStyle: 'dot', imageStyle: 'plain' },
    ],
  },
  {
    id: 'zine',
    name: '画报',
    tagline: '独立杂志跨页感：衬线大标题、朱砂强调与隐约栏线',
    mood: ['杂志', '独立', '视觉'],
    dropCap: true,
    topics: { lifestyle: 0.85, culture: 0.85, beauty: 0.75, travel: 0.8, writing: 0.65, food: 0.65 },
    palette: {
      bg: '#FAF6EE', card: '#F1E8DA', text: '#1D1A16', secondary: '#6E6558',
      accent: '#B8452F', accentSoft: '#F1DED7', border: '#E1D4C2',
    },
    surface: { pattern: 'lines', ornament: 'corner' },
    type: { titleFont: SERIF, bodyFont: SANS, titleSize: 33, titleWeight: 700, titleTracking: '0.01em', bodySize: 15.5, lineHeight: 1.88, letterSpacing: '0.015em', paraGap: 22, paddingX: 20 },
    variants: [
      { id: 'spread', name: '跨页', titleStyle: 'kicker', sectionStyle: 'ghost', dividerStyle: 'line', quoteStyle: 'pull', listStyle: 'num', imageStyle: 'full' },
      { id: 'dossier', name: '特辑', titleStyle: 'eyebrow', sectionStyle: 'rule', dividerStyle: 'diamond', quoteStyle: 'stamp', listStyle: 'square', imageStyle: 'frame' },
    ],
  },
  {
    id: 'illustration',
    name: '插画',
    tagline: '水粉绘本与手账感：圆润标题、奶油纸底与淡彩叶形',
    mood: ['插画', '明快', '绘本'],
    topics: { parent: 0.95, travel: 0.85, food: 0.85, lifestyle: 0.8, emotion: 0.7, education: 0.6 },
    palette: {
      bg: '#FFFBF1', card: '#FDF0DF', text: '#2D241D', secondary: '#7A6B5C',
      accent: '#A94F2E', accentSoft: '#F8E6DA', border: '#EAD9C8',
    },
    surface: { pattern: 'wash', ornament: 'leaf' },
    type: { titleFont: ROUND, bodyFont: SANS, titleSize: 30, titleWeight: 700, titleTracking: '0.03em', bodySize: 15.5, lineHeight: 1.9, letterSpacing: '0.015em', paraGap: 22, paddingX: 20 },
    variants: [
      { id: 'picturebook', name: '绘本', titleStyle: 'tag', sectionStyle: 'dot', dividerStyle: 'ornament', quoteStyle: 'card', listStyle: 'dot', imageStyle: 'polaroid' },
      { id: 'sketch', name: '手账', titleStyle: 'ribbon', sectionStyle: 'tag', dividerStyle: 'dots', quoteStyle: 'tint', listStyle: 'arrow', imageStyle: 'rounded' },
    ],
  },
  {
    id: 'storybook',
    name: '故事书',
    tagline: '精装书页质感：全衬线扉页、细腻纸纹与藏书印记',
    mood: ['故事', '书卷', '沉浸'],
    dropCap: true,
    topics: { emotion: 0.85, culture: 0.85, parent: 0.85, writing: 0.7, travel: 0.65, lifestyle: 0.55 },
    palette: {
      bg: '#F8F2E6', card: '#EEE4D2', text: '#2E261E', secondary: '#706454',
      accent: '#4E6277', accentSoft: '#E5EBF0', border: '#DFD3BF',
    },
    surface: { pattern: 'paper', ornament: 'seal' },
    type: { titleFont: SERIF, bodyFont: SERIF, titleSize: 30, titleWeight: 600, titleTracking: '0.06em', bodySize: 16, lineHeight: 1.98, letterSpacing: '0.02em', paraGap: 25, paddingX: 22 },
    variants: [
      { id: 'chapter', name: '章回', titleStyle: 'rule', sectionStyle: 'line', dividerStyle: 'ornament', quoteStyle: 'center', listStyle: 'dot', imageStyle: 'frame' },
      { id: 'fable', name: '寓言', titleStyle: 'centered', sectionStyle: 'rule', dividerStyle: 'diamond', quoteStyle: 'pull', listStyle: 'num', imageStyle: 'polaroid' },
    ],
  },
  {
    id: 'gallery',
    name: '策展',
    tagline: '美术馆展签与画册感：冷白墙面、微弱网格与青铜细线',
    mood: ['策展', '建筑', '画册'],
    dropCap: true,
    topics: { culture: 0.9, beauty: 0.85, lifestyle: 0.8, travel: 0.75, writing: 0.65, tech: 0.45 },
    palette: {
      bg: '#F7F7F4', card: '#EEEEE8', text: '#1E1E1B', secondary: '#6B6B63',
      accent: '#5E6B4C', accentSoft: '#E7EADD', border: '#DDDDD6',
    },
    surface: { pattern: 'grid', ornament: 'column' },
    type: { titleFont: SERIF, bodyFont: SANS, titleSize: 29, titleWeight: 600, titleTracking: '0.05em', bodySize: 15, lineHeight: 1.88, letterSpacing: '0.015em', paraGap: 22, paddingX: 22 },
    variants: [
      { id: 'exhibit', name: '展签', titleStyle: 'boxed', sectionStyle: 'numbered', dividerStyle: 'line', quoteStyle: 'stamp', listStyle: 'square', imageStyle: 'frame' },
      { id: 'catalog', name: '图录', titleStyle: 'kicker', sectionStyle: 'line', dividerStyle: 'none', quoteStyle: 'pull', listStyle: 'num', imageStyle: 'shadow' },
    ],
  },
  {
    id: 'watercolor',
    name: '水彩',
    tagline: '水彩绘本感：淡绿晕染、枝叶角标与手绘横幅',
    mood: ['水彩', '自然', '绘本'],
    topics: { parent: 0.9, lifestyle: 0.8, food: 0.75, travel: 0.7, emotion: 0.65, culture: 0.6 },
    palette: {
      bg: '#FFFDF8', card: '#F1F7EC', text: '#263229', secondary: '#5A6859',
      accent: '#4C7148', accentSoft: '#E7F1E1', border: '#DCE7D5',
    },
    surface: { pattern: 'watercolor', ornament: 'sprig' },
    type: { titleFont: ROUND, bodyFont: SERIF, titleSize: 30, titleWeight: 700, titleTracking: '0.02em', bodySize: 16, lineHeight: 1.95, letterSpacing: '0.02em', paraGap: 24, paddingX: 20 },
    variants: [
      { id: 'garden', name: '庭园', titleStyle: 'centered', sectionStyle: 'brush', dividerStyle: 'ornament', quoteStyle: 'tint', listStyle: 'dot', imageStyle: 'shadow' },
      { id: 'journal', name: '手记', titleStyle: 'rule', sectionStyle: 'brush', dividerStyle: 'dash', quoteStyle: 'card', listStyle: 'dot', imageStyle: 'polaroid' },
    ],
  },
  {
    id: 'poster',
    name: '海报',
    tagline: '大字号、撞色色块与网点，像一张演出海报',
    mood: ['海报', '强视觉', '宣言'],
    topics: { culture: 0.8, festival: 0.8, lifestyle: 0.7, business: 0.55, tech: 0.45, writing: 0.6 },
    palette: {
      bg: '#F1EADF', card: '#E6DCCB', text: '#171412', secondary: '#5E564C',
      accent: '#B03522', accentSoft: '#F1DDD6', border: '#D8CCBB',
    },
    surface: { pattern: 'halftone', ornament: 'star' },
    type: { titleFont: SANS, bodyFont: SANS, titleSize: 34, titleWeight: 800, titleTracking: '-0.01em', bodySize: 15.5, lineHeight: 1.72, letterSpacing: '0.005em', paraGap: 20, paddingX: 20 },
    variants: [
      { id: 'bill', name: '演出单', titleStyle: 'poster', sectionStyle: 'band', dividerStyle: 'star', quoteStyle: 'poster', listStyle: 'square', imageStyle: 'full' },
      { id: 'manifesto', name: '宣言', titleStyle: 'stacked', sectionStyle: 'band', dividerStyle: 'line', quoteStyle: 'stamp', listStyle: 'num', imageStyle: 'plate' },
    ],
  },
  {
    id: 'folio',
    name: '画册',
    tagline: '大留白、图版编号与衬线页眉，像一本展览画册',
    mood: ['画册', '展览', '留白'],
    dropCap: true,
    topics: { culture: 0.9, beauty: 0.85, travel: 0.7, writing: 0.6, lifestyle: 0.55, tech: 0.35 },
    palette: {
      bg: '#F8F4EA', card: '#EDE5D6', text: '#24211C', secondary: '#6C6559',
      accent: '#5A6B4A', accentSoft: '#E4E9DC', border: '#DDD3C1',
    },
    surface: { pattern: 'paper', ornament: 'seal' },
    type: { titleFont: SERIF, bodyFont: SERIF, titleSize: 30, titleWeight: 600, titleTracking: '0.04em', bodySize: 15.5, lineHeight: 1.95, letterSpacing: '0.02em', paraGap: 24, paddingX: 24 },
    variants: [
      { id: 'plate', name: '图版', titleStyle: 'stacked', sectionStyle: 'folio', dividerStyle: 'none', quoteStyle: 'margin', listStyle: 'dash', imageStyle: 'plate' },
      { id: 'catalogue', name: '目录', titleStyle: 'centered', sectionStyle: 'folio', dividerStyle: 'line', quoteStyle: 'pull', listStyle: 'num', imageStyle: 'frame' },
    ],
  },
  {
    id: 'bauhaus',
    name: '构成',
    tagline: '几何色块与不对称网格，包豪斯式招贴秩序',
    mood: ['构成', '几何', '招贴'],
    topics: { beauty: 0.8, tech: 0.65, business: 0.6, culture: 0.7, lifestyle: 0.6, writing: 0.5 },
    palette: {
      bg: '#F2EFE6', card: '#E6E1D3', text: '#171614', secondary: '#5C584F',
      accent: '#245E9E', accentSoft: '#DCE7F2', border: '#D4CEC0',
    },
    surface: { pattern: 'grid', ornament: 'corner' },
    type: { titleFont: SANS, bodyFont: SANS, titleSize: 32, titleWeight: 800, titleTracking: '-0.01em', bodySize: 15.5, lineHeight: 1.75, letterSpacing: '0.01em', paraGap: 20, paddingX: 22 },
    variants: [
      { id: 'axis', name: '轴线', titleStyle: 'poster', sectionStyle: 'band', dividerStyle: 'line', quoteStyle: 'stamp', listStyle: 'square', imageStyle: 'plate' },
      { id: 'grid', name: '网格', titleStyle: 'stacked', sectionStyle: 'folio', dividerStyle: 'star', quoteStyle: 'poster', listStyle: 'num', imageStyle: 'full' },
    ],
  },
]

export const THEME_IDS = THEMES.map(theme => theme.id)

/** Find a theme by id, falling back to the first one so a stale stored design still renders. */
export function themeOf(id) {
  return THEMES.find(theme => theme.id === id) ?? THEMES[0]
}

/** Find a variant inside a theme, falling back to its first variant. */
export function variantOf(theme, id) {
  return theme.variants.find(variant => variant.id === id) ?? theme.variants[0]
}
