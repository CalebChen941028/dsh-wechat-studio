/**
 * Outbound network settings for WeChat API calls.
 *
 * The Host runs on the user's machine, so the WeChat API sees whatever egress
 * IP the local network/proxy uses. A rotating proxy makes the WeChat IP
 * allowlist impossible to maintain. This module keeps an explicit proxy in the
 * local credential store and lets the Host pin WeChat calls to it.
 *
 * Modes:
 * - `system` (default): use the global fetch; OS-level proxy/TUN still applies.
 * - `proxy`: route WeChat API calls through one HTTP(S) proxy URL.
 */

const MODES = new Set(['system', 'proxy'])

/** Normalize one mode value. */
export function normalizeNetworkMode(value) {
  return MODES.has(value) ? value : 'system'
}

/** Keep a credential-bearing proxy URL out of client responses and logs. */
export function redactProxyUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return ''
  try {
    const url = new URL(value.trim())
    if (url.username !== '' || url.password !== '') {
      url.username = url.username === '' ? '' : '***'
      url.password = url.password === '' ? '' : '***'
    }
    return url.toString()
  } catch {
    return ''
  }
}

/**
 * Validate a proxy URL. Empty is allowed only when an existing URL is reused.
 * @param {string} value raw value from the client.
 * @param {string} [current] stored URL, reused when the client sends the redacted form.
 * @returns {string} normalized URL, or '' for system mode.
 */
export function normalizeProxyUrl(value, current = '') {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (raw === '') return typeof current === 'string' ? current.trim() : ''
  if (raw.includes('***')) {
    if (current === '') throw new TypeError('代理地址里的账号密码不能是 ***，请重新填写完整地址')
    return current
  }
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new TypeError('代理地址格式不对，示例：http://127.0.0.1:7890')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('目前只支持 http:// 或 https:// 代理，不支持 SOCKS')
  }
  if (url.hostname === '') throw new TypeError('代理地址缺少主机名')
  url.hash = ''
  return url.toString()
}

/**
 * Normalize a settings payload against the currently stored settings.
 * @param {object} payload incoming mode/proxyUrl.
 * @param {{ mode?: string, proxyUrl?: string }} current stored settings.
 * @returns {{ mode: 'system'|'proxy', proxyUrl: string }}
 */
export function normalizeNetworkSettings(payload = {}, current = {}) {
  const mode = normalizeNetworkMode(payload.mode ?? current.mode)
  let proxyUrl = normalizeProxyUrl(payload.proxyUrl, current.proxyUrl)
  if (mode === 'proxy' && proxyUrl === '') {
    throw new TypeError('选择自定义代理后必须填写代理地址')
  }
  if (mode === 'system') proxyUrl = proxyUrl || (typeof current.proxyUrl === 'string' ? current.proxyUrl : '')
  return { mode, proxyUrl }
}

/**
 * Build a fetch implementation for one settings object.
 * `system` returns the provided fetch. `proxy` uses undici's ProxyAgent and
 * tunnels HTTPS through the proxy (the proxy cannot read WeChat request bodies).
 * @param {{ mode: string, proxyUrl: string }} settings normalized settings.
 * @param {{ fetchImpl?: typeof fetch, importUndici?: () => Promise<any> }} [options]
 * @returns {Promise<typeof fetch>} fetch implementation.
 */
export async function createNetworkFetch(settings, options = {}) {
  const fallback = options.fetchImpl ?? fetch
  if (settings.mode !== 'proxy' || settings.proxyUrl === '') return fallback
  let undici
  try {
    undici = await (options.importUndici ?? (() => import('undici')))()
  } catch {
    throw new TypeError('代理功能需要 undici 依赖，请重新安装插件后再试')
  }
  let agent
  try {
    agent = new undici.ProxyAgent(settings.proxyUrl)
  } catch (error) {
    throw new TypeError(`代理初始化失败：${error instanceof Error ? error.message : String(error)}`)
  }
  const proxyFetch = undici.fetch
  return (input, init = {}) => proxyFetch(input, { ...init, dispatcher: agent })
}

/**
 * Ask a what-is-my-IP service which address is used by this fetch path.
 * @param {typeof fetch} fetchImpl fetch implementation.
 * @param {{ timeoutMs?: number }} [options] probe timeout.
 * @returns {Promise<{ ip: string, ms: number }>} observed egress IP.
 */
export async function probeEgress(fetchImpl, options = {}) {
  const timeoutMs = options.timeoutMs ?? 10000
  const controller = typeof AbortController === 'function' ? new AbortController() : undefined
  const timer = controller === undefined ? undefined : setTimeout(() => controller.abort(), timeoutMs)
  const started = Date.now()
  try {
    const response = await fetchImpl('https://api.ipify.org?format=json', {
      signal: controller?.signal,
      headers: { accept: 'application/json' },
    })
    if (response.ok !== true) throw new Error(`出口检测服务返回 HTTP ${response.status}`)
    const text = await response.text()
    let ip = ''
    try {
      const parsed = JSON.parse(text)
      ip = typeof parsed?.ip === 'string' ? parsed.ip : ''
    } catch {
      ip = text.trim()
    }
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) throw new Error('出口检测服务没有返回 IPv4 地址')
    return { ip, ms: Date.now() - started }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
