import test from 'node:test'
import assert from 'node:assert/strict'
import { parseArticle, composeDesign } from '../src/engine.mjs'
import { buildArticle, serializeNodes, nodesToReact } from '../src/render.mjs'

test('长文解析与渲染保持在可接受预算内', () => {
  const paragraph = '这是一段用于压力测试的正文，包含标点、数字 123 和中英文混排。'
  const text = `# 长文压力测试\n\n${Array.from({ length: 3000 }, (_, index) => `## 小节 ${index + 1}\n\n${paragraph.repeat(2)}`).join('\n\n')}`
  const started = Date.now()
  const parsed = parseArticle(text)
  const design = composeDesign({ themeId: 'column', variantId: 'essay', overrides: {} })
  const article = buildArticle({ blocks: parsed.blocks, design, meta: { title: '长文压力测试', author: '', date: '2026-11-21', readingMinutes: 20 } })
  const html = serializeNodes(article.nodes)
  const elapsed = Date.now() - started
  assert.ok(parsed.blocks.length > 3000)
  assert.ok(html.length > 100000)
  assert.ok(elapsed < 5000, `parse+build took ${elapsed}ms`)
})

test('预览图片带 lazy/async 属性，复制 HTML 仍保持原样', () => {
  const article = buildArticle({
    blocks: [{ type: 'image', src: 'https://example.com/a.png', alt: '图', lines: [0, 0], text: '' }],
    design: composeDesign({ themeId: 'column', variantId: 'essay', overrides: {} }),
    meta: { title: 't', author: '', date: '2026-11-21', readingMinutes: 1 },
  })
  const h = (type, props, ...children) => ({ type, props, children })
  const react = nodesToReact(article.nodes, h)
  const findImage = (nodes) => {
    for (const node of nodes) {
      if (node?.type === 'img') return node
      if (Array.isArray(node?.children)) { const found = findImage(node.children); if (found) return found }
    }
    return null
  }
  const image = findImage(react)
  assert.equal(image.props.loading, 'lazy')
  assert.equal(image.props.decoding, 'async')
  assert.ok(!serializeNodes(article.nodes).includes('loading="lazy"'))
})
