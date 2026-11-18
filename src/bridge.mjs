/**
 * Browser to Host bridge.
 *
 * The Host half registers one exact route under the Web server. That route is
 * public on localhost, so the Host also enforces same-origin trust; the custom
 * header here is the part a cross-site page cannot forge without a preflight
 * the Host refuses.
 */

const API_PATH = '/wechat-studio/api'
const DEFAULT_TIMEOUT_MS = 45000

/**
 * Call one Host action.
 * @param {string} action action name understood by the Host service.
 * @param {object} payload action payload.
 * @param {{ timeoutMs?: number }} options optional timeout.
 * @returns {Promise<any>} the `value` of a successful envelope.
 */
export async function callHost(action, payload = {}, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = typeof AbortController === 'function' ? new AbortController() : undefined
  const timer = controller === undefined ? undefined : setTimeout(() => controller.abort(), timeoutMs)
  let response
  try {
    response = await fetch(new URL(API_PATH, location.origin).toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-wechat-studio': '1' },
      body: JSON.stringify({ action, ...payload }),
      signal: controller?.signal,
    })
  } catch (error) {
    if (error && error.name === 'AbortError') throw bridgeError('host-timeout', '与排版服务通信超时，请重试')
    throw bridgeError('host-unreachable', '连不上公众号排版服务，确认插件已启用后刷新页面再试')
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }

  if (response.status === 404) throw bridgeError('host-missing', '排版服务的接口没有注册，插件可能未启用或需要刷新页面')
  if (!response.ok) throw bridgeError('host-http', `排版服务返回 HTTP ${response.status}`)

  let envelope
  try {
    envelope = await response.json()
  } catch {
    throw bridgeError('host-format', '排版服务返回了无法解析的内容')
  }
  if (envelope === null || typeof envelope !== 'object') throw bridgeError('host-format', '排版服务返回格式异常')
  if (envelope.ok === false) {
    const error = bridgeError(envelope.code ?? 'host-error', envelope.message ?? '操作失败')
    error.detail = envelope.detail
    throw error
  }
  return envelope.value
}

function bridgeError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

/**
 * Copy an HTML fragment to the clipboard with its formatting intact, falling
 * back to a hidden editable selection when the async clipboard API is absent.
 * @param {string} html inline-styled article HTML.
 * @returns {Promise<'rich'|'plain'>} which path succeeded.
 */
export async function copyRichHtml(html) {
  const plain = html.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim()
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.write === 'function') {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        }),
      ])
      return 'rich'
    } catch {
      // Fall through to the selection path.
    }
  }
  const holder = document.createElement('div')
  holder.contentEditable = 'true'
  holder.style.position = 'fixed'
  holder.style.left = '-9999px'
  holder.style.top = '0'
  holder.innerHTML = html
  document.body.appendChild(holder)
  try {
    const range = document.createRange()
    range.selectNodeContents(holder)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    const copied = document.execCommand('copy')
    if (!copied) throw bridgeError('copy-failed', '浏览器拒绝了复制操作')
    return 'plain'
  } finally {
    holder.remove()
  }
}

/** Trigger a browser download for generated text. */
export function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** Read a File object as a data URL. */
export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

/**
 * Downscale and re-encode one image data URL so content images fit the WeChat
 * 1 MiB limit while keeping the longest edge at 1080 px.
 * @param {string} dataUrl source image.
 * @returns {Promise<{ dataUrl: string, mimeType: string, bytes: number }>}
 */
export async function compressImage(dataUrl, maxEdge = 1080) {
  const image = await loadImage(dataUrl)
  const scale = Math.min(1, maxEdge / Math.max(image.width, image.height))
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('当前环境无法处理图片')
  context.fillStyle = '#FFFFFF'
  context.fillRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)
  let quality = 0.9
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const out = canvas.toDataURL('image/jpeg', quality)
    const bytes = base64Bytes(out)
    if (bytes <= 900 * 1024 || quality <= 0.5) return { dataUrl: out, mimeType: 'image/jpeg', bytes }
    quality -= 0.1
  }
  const out = canvas.toDataURL('image/jpeg', 0.5)
  return { dataUrl: out, mimeType: 'image/jpeg', bytes: base64Bytes(out) }
}

/** Load one image from a data URL. */
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片解码失败'))
    image.src = src
  })
}

/** Approximate decoded byte length of a base64 data URL. */
export function base64Bytes(dataUrl) {
  const comma = dataUrl.indexOf(',')
  const payload = comma === -1 ? dataUrl : dataUrl.slice(comma + 1)
  return Math.floor((payload.length * 3) / 4 - (payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0))
}
