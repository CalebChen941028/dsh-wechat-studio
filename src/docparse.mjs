/**
 * Drop a document on the studio and get Markdown back.
 *
 * Supported: .md / .markdown / .txt (as-is), .html / .htm (structure mapped to
 * Markdown), .docx (ZIP + XML parsed in the browser, so Word drafts work
 * without a server round trip). PDF and legacy .doc stay unsupported.
 */

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx', 'txt'])
const HTML_EXTENSIONS = new Set(['html', 'htm'])
const DOCX_EXTENSIONS = new Set(['docx'])

/** Read one File and return its Markdown body. */
export async function readDocumentFile(file) {
  const name = typeof file?.name === 'string' ? file.name : ''
  const extension = name.includes('.') ? name.split('.').pop().toLowerCase() : ''
  if (MARKDOWN_EXTENSIONS.has(extension)) {
    const text = await file.text()
    return { text: normalizeMarkdown(text), source: 'markdown' }
  }
  if (HTML_EXTENSIONS.has(extension)) {
    const html = await file.text()
    return { text: normalizeMarkdown(htmlToMarkdown(html)), source: 'html' }
  }
  if (DOCX_EXTENSIONS.has(extension)) {
    const buffer = await file.arrayBuffer()
    const parsed = await parseDocx(buffer)
    return { text: normalizeMarkdown(parsed.text), source: 'docx', images: parsed.images }
  }
  if (extension === 'pdf') {
    throw new Error('PDF 暂不支持。先把 PDF 里的文字复制出来粘进编辑区，或另存为 Markdown / Word 再上传。')
  }
  if (extension === 'doc') {
    throw new Error('旧版 .doc 不支持。用 Word 另存为 .docx，或导出 Markdown / 纯文本再上传。')
  }
  throw new Error(`不支持的文件类型：.${extension || '未知'}。可以上传 .md、.txt、.html、.docx。`)
}

/** Trim trailing spaces and collapse more than two blank lines. */
export function normalizeMarkdown(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/* ------------------------------------------------------------------ *
 * HTML
 * ------------------------------------------------------------------ */

/** Map one HTML document to Markdown, keeping headings, lists, quotes and images. */
export function htmlToMarkdown(html) {
  if (typeof DOMParser !== 'function') throw new Error('当前环境无法解析 HTML')
  const document = new DOMParser().parseFromString(String(html ?? ''), 'text/html')
  for (const node of document.querySelectorAll('script, style, noscript, iframe, svg, nav, footer, form')) node.remove()
  const blocks = []
  const walk = (element) => {
    for (const child of element.children) {
      const tag = child.tagName.toLowerCase()
      if (/^h[1-6]$/.test(tag)) {
        const level = Number(tag.slice(1))
        const value = inlineText(child)
        if (value !== '') blocks.push(`${'#'.repeat(Math.min(3, level))} ${value}`)
        continue
      }
      if (tag === 'p') {
        const value = inlineText(child)
        if (value !== '') blocks.push(value)
        continue
      }
      if (tag === 'blockquote') {
        const value = child.textContent.replace(/\s+/g, ' ').trim()
        if (value !== '') blocks.push(`> ${value}`)
        continue
      }
      if (tag === 'ul' || tag === 'ol') {
        const ordered = tag === 'ol'
        let index = 1
        for (const item of child.querySelectorAll(':scope > li')) {
          const value = inlineText(item)
          if (value === '') continue
          blocks.push(`${ordered ? `${index++}.` : '-'} ${value}`)
        }
        continue
      }
      if (tag === 'pre') {
        const value = child.textContent.replace(/\n+$/, '')
        if (value.trim() !== '') blocks.push(`\`\`\`\n${value}\n\`\`\``)
        continue
      }
      if (tag === 'img') {
        const src = child.getAttribute('src') ?? ''
        if (src !== '') blocks.push(`![${child.getAttribute('alt') ?? ''}](${src})`)
        continue
      }
      if (tag === 'figure') {
        const image = child.querySelector('img')
        if (image) {
          const src = image.getAttribute('src') ?? ''
          const caption = child.querySelector('figcaption')?.textContent?.trim() ?? image.getAttribute('alt') ?? ''
          if (src !== '') blocks.push(`![${caption}](${src})`)
        }
        continue
      }
      if (tag === 'hr') {
        blocks.push('---')
        continue
      }
      if (['div', 'section', 'article', 'main', 'body', 'header', 'aside'].includes(tag)) {
        walk(child)
        continue
      }
      const value = inlineText(child)
      if (value !== '') blocks.push(value)
    }
  }
  walk(document.body)
  return blocks.join('\n\n')
}

function inlineText(element) {
  let out = ''
  const visit = (node) => {
    if (node.nodeType === 3) {
      out += node.nodeValue
      return
    }
    if (node.nodeType !== 1) return
    const tag = node.tagName.toLowerCase()
    if (tag === 'br') {
      out += '\n'
      return
    }
    if (tag === 'strong' || tag === 'b') {
      const inner = childText(node)
      if (inner.trim() !== '') out += `**${inner}**`
      return
    }
    if (tag === 'em' || tag === 'i') {
      const inner = childText(node)
      if (inner.trim() !== '') out += `*${inner}*`
      return
    }
    if (tag === 'code') {
      out += `\`${node.textContent}\``
      return
    }
    for (const child of node.childNodes) visit(child)
  }
  for (const child of element.childNodes) visit(child)
  return out.replace(/\s+/g, ' ').replace(/ ?\n ?/g, '\n').trim()
}

function childText(node) {
  let out = ''
  for (const child of node.childNodes) {
    if (child.nodeType === 3) out += child.nodeValue
    else if (child.nodeType === 1) out += childText(child)
  }
  return out.replace(/\s+/g, ' ').trim()
}

/* ------------------------------------------------------------------ *
 * DOCX
 * ------------------------------------------------------------------ */

const SIG_EOCD = 0x06054b50
const SIG_CENTRAL = 0x02014b50

/** Read the central directory of a ZIP archive. */
function readZipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  const lowest = Math.max(0, bytes.length - 66000)
  for (let offset = bytes.length - 22; offset >= lowest; offset -= 1) {
    if (view.getUint32(offset, true) === SIG_EOCD) {
      eocd = offset
      break
    }
  }
  if (eocd === -1) throw new Error('文件不是有效的 .docx（找不到 ZIP 目录）')
  const total = view.getUint16(eocd + 10, true)
  let pointer = view.getUint32(eocd + 16, true)
  const entries = []
  for (let index = 0; index < total; index += 1) {
    if (view.getUint32(pointer, true) !== SIG_CENTRAL) break
    const method = view.getUint16(pointer + 10, true)
    const compressedSize = view.getUint32(pointer + 20, true)
    const nameLength = view.getUint16(pointer + 28, true)
    const extraLength = view.getUint16(pointer + 30, true)
    const commentLength = view.getUint16(pointer + 32, true)
    const localOffset = view.getUint32(pointer + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength))
    entries.push({ name, method, compressedSize, localOffset })
    pointer += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

async function readZipEntry(bytes, entry) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const localOffset = entry.localOffset
  if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('docx 压缩包损坏（本地头无效）')
  const nameLength = view.getUint16(localOffset + 26, true)
  const extraLength = view.getUint16(localOffset + 28, true)
  const start = localOffset + 30 + nameLength + extraLength
  const size = entry.compressedSize > 0
    ? entry.compressedSize
    : view.getUint32(localOffset + 22, true)
  const payload = bytes.subarray(start, start + size)
  if (entry.method === 0) return payload
  if (entry.method !== 8) throw new Error('docx 使用了不支持的压缩方式')
  if (typeof DecompressionStream !== 'function') throw new Error('当前环境无法解压 .docx')
  const stream = new Blob([payload]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Convert a .docx ArrayBuffer to Markdown. */
export async function docxToMarkdown(buffer) {
  return (await parseDocx(buffer)).text
}

/** Parse a .docx and report how many embedded images were left behind. */
async function parseDocx(buffer) {
  const bytes = new Uint8Array(buffer)
  const entries = readZipEntries(bytes)
  const documentEntry = entries.find(entry => entry.name === 'word/document.xml')
  if (!documentEntry) throw new Error('这个 .docx 里没有正文（word/document.xml 缺失）')
  const xml = new TextDecoder('utf-8').decode(await readZipEntry(bytes, documentEntry))
  const resolver = await createDocxImageResolver(bytes, entries)
  const text = docxXmlToMarkdown(xml, resolver.resolve)
  return { text, images: resolver.count() }
}

const MIME_BY_EXTENSION = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }

/** Base64-encode a byte array without relying on Node-only globals. */
function bytesToBase64(bytes) {
  let binary = ''
  const step = 0x8000
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode.apply(null, bytes.subarray(index, index + step))
  }
  return btoa(binary)
}

/**
 * Map relationship ids to data URLs for `word/media/*`, so inline drawings can
 * be carried into the Markdown as real images.
 * @param {Uint8Array} bytes docx bytes.
 * @param {Array<{name:string, method:number, compressedSize:number, size:number, offset:number}>} entries zip entries.
 * @returns {Promise<{ resolve: Function, count: Function }>}
 */
async function createDocxImageResolver(bytes, entries) {
  const relationships = new Map()
  const relsEntry = entries.find(entry => entry.name === 'word/_rels/document.xml.rels')
  if (relsEntry !== undefined && typeof DOMParser === 'function') {
    try {
      const relsXml = new TextDecoder('utf-8').decode(await readZipEntry(bytes, relsEntry))
      const parsed = new DOMParser().parseFromString(relsXml, 'application/xml')
      for (const rel of parsed.getElementsByTagName('*')) {
        if (rel.localName !== 'Relationship') continue
        const id = rel.getAttribute('Id')
        const target = rel.getAttribute('Target')
        if (typeof id === 'string' && typeof target === 'string') relationships.set(id, target)
      }
    } catch {
      // A missing relations file only means images are skipped.
    }
  }

  const cache = new Map()
  const used = new Set()
  let counter = 0

  // Pre-read every media entry so `resolve` can stay synchronous during the XML walk.
  for (const entry of entries) {
    if (!entry.name.startsWith('word/media/')) continue
    const extension = entry.name.split('.').pop().toLowerCase()
    const mimeType = MIME_BY_EXTENSION[extension]
    if (mimeType === undefined) continue
    try {
      const bytesOfImage = await readZipEntry(bytes, entry)
      cache.set(entry.name, `data:${mimeType};base64,${bytesToBase64(bytesOfImage)}`)
    } catch {
      // Skip an unreadable image.
    }
  }

  const resolveSync = (relationshipId) => {
    if (typeof relationshipId !== 'string' || relationshipId === '') return null
    const target = relationships.get(relationshipId)
    if (target === undefined) return null
    const name = `word/${target.replace(/^\.\.\//, '').replace(/^\//, '')}`
    const dataUrl = cache.get(name)
    if (dataUrl === undefined) return null
    if (used.has(name)) return { src: dataUrl, alt: `图片 ${[...used].indexOf(name) + 1}` }
    used.add(name)
    counter += 1
    return { src: dataUrl, alt: `图片 ${counter}` }
  }

  return { resolve: resolveSync, count: () => used.size }
}

/** Convert `word/document.xml` text into Markdown paragraphs and headings. */
export function docxXmlToMarkdown(xml, resolveImage) {
  if (typeof DOMParser !== 'function') throw new Error('当前环境无法解析 Word 文档')
  const parsed = new DOMParser().parseFromString(String(xml ?? ''), 'application/xml')
  if (parsed.querySelector('parsererror')) throw new Error('Word 正文 XML 解析失败')
  const body = parsed.getElementsByTagNameNS('*', 'body')[0]
  if (!body) throw new Error('Word 正文为空')

  const blocks = []
  const walkBlocks = (parent) => {
    for (const child of parent.children) {
      const local = child.localName
      if (local === 'p') {
        const paragraph = readParagraph(child)
        if (paragraph !== null) blocks.push(paragraph)
        const images = readParagraphImages(child, resolveImage)
        for (const image of images) blocks.push(image)
        continue
      }
      if (local === 'tbl') {
        for (const row of child.getElementsByTagNameNS('*', 'tr')) {
          const cells = []
          for (const cell of row.getElementsByTagNameNS('*', 'tc')) {
            const value = Array.from(cell.getElementsByTagNameNS('*', 'p'))
              .map(paragraph => readParagraph(paragraph))
              .filter(Boolean)
              .join(' ')
            cells.push(value)
          }
          const line = cells.filter(cell => cell !== '').join(' ｜ ')
          if (line !== '') blocks.push(line)
        }
        continue
      }
      if (local === 'sectPr') continue
      walkBlocks(child)
    }
  }
  walkBlocks(body)
  return blocks.join('\n\n')
}

/** Turn inline drawings inside one paragraph into Markdown image lines. */
function readParagraphImages(paragraph, resolveImage) {
  if (typeof resolveImage !== 'function') return []
  const images = []
  const ids = []
  for (const blip of paragraph.getElementsByTagNameNS('*', 'blip')) {
    const embed = blip.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed')
      ?? blip.getAttribute('r:embed')
    if (typeof embed === 'string' && embed !== '') ids.push(embed)
  }
  for (const drawing of paragraph.getElementsByTagNameNS('*', 'imagedata')) {
    const id = drawing.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
      ?? drawing.getAttribute('r:id')
    if (typeof id === 'string' && id !== '') ids.push(id)
  }
  for (const id of ids) {
    const resolved = resolveImage(id)
    if (resolved !== null && resolved !== undefined) images.push(`![${resolved.alt}](${resolved.src})`)
  }
  return images
}

function readParagraph(paragraph) {
  const styleNode = paragraph.getElementsByTagNameNS('*', 'pStyle')[0]
  const style = styleNode?.getAttributeNS('*', 'val') ?? styleNode?.getAttribute('w:val') ?? ''
  const outlineNode = paragraph.getElementsByTagNameNS('*', 'outlineLvl')[0]
  const outline = Number(outlineNode?.getAttributeNS('*', 'val') ?? outlineNode?.getAttribute('w:val') ?? Number.NaN)
  const styleList = /list\s*(bullet|number)?/i.test(style) || /列表/.test(style)
  const orderedList = /list\s*number|listnumber|编号|数字/i.test(style)
  const isList = paragraph.getElementsByTagNameNS('*', 'numPr').length > 0 || styleList

  let text = ''
  for (const run of paragraph.getElementsByTagNameNS('*', 'r')) {
    const props = run.getElementsByTagNameNS('*', 'rPr')[0]
    const bold = props?.getElementsByTagNameNS('*', 'b').length > 0
    let runText = ''
    for (const child of run.children) {
      const local = child.localName
      if (local === 't') runText += child.textContent
      else if (local === 'tab') runText += ' '
      else if (local === 'br' || local === 'cr') runText += '\n'
    }
    if (runText === '') continue
    text += bold ? `**${runText}**` : runText
  }
  text = text.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim()
  if (text === '') return null

  const headingMatch = /heading\s*([1-6])/i.exec(style) ?? /标题\s*([1-6])/.exec(style)
  const headingLevel = headingMatch
    ? Number(headingMatch[1])
    : Number.isFinite(outline) && outline >= 0 && outline <= 2 && /^[1-3]$/.test(style) ? outline + 1 : 0
  if (headingLevel > 0) return `${'#'.repeat(Math.min(3, headingLevel))} ${text.replace(/\*\*/g, '')}`
  if (isList) return `${orderedList ? '1.' : '-'} ${text}`
  return text
}
