import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { JSDOM } from 'jsdom'

// docparse uses the browser DOMParser for HTML/Word XML; supply jsdom's.
const { DOMParser } = new JSDOM('').window
globalThis.DOMParser = DOMParser

const { readDocumentFile, htmlToMarkdown, docxToMarkdown, normalizeMarkdown } = await import('../src/docparse.mjs')

/** Build the minimal File-like object readDocumentFile expects. */
function fileLike(name, bytes) {
  return {
    name,
    async text() {
      return new TextDecoder('utf-8').decode(bytes)
    },
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    },
  }
}

test('normalizeMarkdown 去掉行尾空格并压缩多余空行', () => {
  const input = '第一段   \r\n\r\n\r\n\r\n第二段\t\n'
  assert.equal(normalizeMarkdown(input), '第一段\n\n第二段')
})

test('htmlToMarkdown 保留标题、列表、引用、代码和图片', () => {
  const html = `
    <h1>标题</h1>
    <p>第一段 <strong>加粗</strong>。</p>
    <ul><li>一项</li><li>二项</li></ul>
    <blockquote>一句引用</blockquote>
    <pre>const a = 1;</pre>
    <img src="https://example.com/a.png" alt="配图">
    <hr>
  `
  const markdown = htmlToMarkdown(html)
  assert.match(markdown, /^# 标题/m)
  assert.match(markdown, /- 一项/)
  assert.match(markdown, /- 二项/)
  assert.match(markdown, /> 一句引用/)
  assert.match(markdown, /```\nconst a = 1;\n```/)
  assert.match(markdown, /!\[配图\]\(https:\/\/example\.com\/a\.png\)/)
  assert.match(markdown, /^---/m)
})

test('readDocumentFile 读取 Markdown 并按规范归一化', async () => {
  const result = await readDocumentFile(fileLike('note.md', new TextEncoder().encode('# 标题\n\n\n正文  ')))
  assert.equal(result.source, 'markdown')
  assert.equal(result.text, '# 标题\n\n正文')
})

test('readDocumentFile 解析真实 docx 的标题、列表与内嵌图片', async () => {
  const bytes = readFileSync(new URL('./fixtures/sample.docx', import.meta.url))
  const result = await readDocumentFile(fileLike('sample.docx', new Uint8Array(bytes)))
  assert.equal(result.source, 'docx')
  assert.equal(result.images, 1)
  assert.match(result.text, /^# 带图的测试文稿/m)
  assert.match(result.text, /^## 小节标题/m)
  assert.match(result.text, /!\[图片 1\]\(data:image\/png;base64,/)
  assert.match(result.text, /^[-\d]/m)
  assert.match(result.text, /小节正文/)
})

test('docxToMarkdown 对缺失正文的压缩包给出明确错误', async () => {
  await assert.rejects(
    () => docxToMarkdown(new Uint8Array([0, 1, 2, 3]).buffer),
    (error) => {
      assert.match(error.message, /zip|docx|压缩|正文/i)
      return true
    },
  )
})

test('readDocumentFile 拒绝不支持的 PDF，并提示可用格式', async () => {
  await assert.rejects(
    () => readDocumentFile(fileLike('a.pdf', new Uint8Array([1]))),
    (error) => {
      assert.match(error.message, /PDF/)
      assert.match(error.message, /Markdown|Word/)
      return true
    },
  )
})
