/**
 * 排版工作台的 Host 业务层：动作分发、凭据读写、access_token 缓存，
 * 以及把微信接口错误翻译成面向用户的中文提示。
 *
 * 每个动作接收一个 payload 对象，成功时返回 JSON 值；业务失败抛
 * StudioError（带 code 与 message），由 HTTP 层转成统一响应。
 */

import { createWechatClient, mapWechatError, WechatApiError, isTokenInvalidError } from './wechat.js'
import { createAiEditor } from './ai.js'
import { createNetworkFetch, normalizeNetworkSettings, probeEgress, redactProxyUrl } from './network.js'

/** 业务动作失败。 */
export class StudioError extends Error {
  /**
   * @param {string} code 机器可读错误码。
   * @param {string} message 面向用户的中文说明。
   * @param {unknown} [detail] 附加信息，原样放进响应 detail 字段。
   */
  constructor(code, message, detail) {
    super(message)
    this.name = 'StudioError'
    this.code = code
    if (detail !== undefined) this.detail = detail
  }
}

/** 公众号凭据在 credentials 记录里的 key。 */
const CREDENTIALS_KEY = 'wechat-studio/account'
const ACCOUNTS_KEY = 'wechat-studio/accounts'

/** 出站网络设置在 credentials 记录里的 key。 */
const NETWORK_KEY = 'wechat-studio/network'

/** 正文图片单张上限：微信 media/uploadimg 只收 1MB 以内的图。 */
const CONTENT_IMAGE_MAX_BYTES = 1024 * 1024

/** 封面图片单张上限：微信永久图片素材上限 10MB。 */
const COVER_IMAGE_MAX_BYTES = 10 * 1024 * 1024

/** 外链图片转存上限：单张 5MB。 */
const REMOTE_IMAGE_MAX_BYTES = 5 * 1024 * 1024

/** 外链图片下载超时。 */
const REMOTE_IMAGE_TIMEOUT_MS = 15000

/** token 提前 5 分钟视为过期，避开临界失效。 */
const TOKEN_SAFETY_WINDOW_MS = 5 * 60 * 1000

/** 微信没给 expires_in 时按 2 小时算。 */
const FALLBACK_TOKEN_TTL_SECONDS = 7200

/** 发布状态码文案。 */
const PUBLISH_STATUS_TEXT = [
  '发布成功',
  '发布中',
  '原创声明失败',
  '常规失败',
  '平台审核不通过',
  '发布成功后用户删除',
  '发布成功后系统封禁',
]

/** 微信正文图片只接受 png / jpeg 的 data URL。 */
const DATA_URL_PATTERN = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/

/** 人类可读的字节数。 */
function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`
  return `${bytes}B`
}

/** 按字符（而不是 UTF-16 码元）计算长度，避免把 emoji 截成半个。 */
function textLength(text) {
  return Array.from(text).length
}

/** 按字符截断，超出时返回前 max 个字符。 */
function truncateText(text, max) {
  const characters = Array.from(text)
  return characters.length <= max ? text : characters.slice(0, max).join('')
}

/** 把文件名扩展名对齐到 MIME 类型，微信靠扩展名判断图片格式。 */
function filenameFor(mimeType, name, fallbackStem) {
  const extension = mimeType === 'image/png' ? 'png' : 'jpg'
  const raw = typeof name === 'string' ? name.trim() : ''
  const base = raw.replace(/[\\/:*?"<>|\s]/g, '')
  const stem = base === '' ? fallbackStem : base.replace(/\.[A-Za-z0-9]{1,5}$/, '')
  return `${stem === '' ? fallbackStem : stem}.${extension}`
}

/** appId 预览：长度大于 10 时显示前 6 位 + 省略号 + 后 4 位。 */
function previewAppId(appId) {
  if (typeof appId !== 'string' || appId === '') return null
  return appId.length > 10 ? `${appId.slice(0, 6)}…${appId.slice(-4)}` : appId
}

/** 校验并规整 AppID。 */
function normalizeAppId(value) {
  const appId = typeof value === 'string' ? value.trim() : ''
  if (appId === '') throw new StudioError('config-invalid', '请填写公众号 AppID（形如 wx 开头的 18 位字符）')
  if (!/^[0-9A-Za-z]{6,64}$/.test(appId)) {
    throw new StudioError('config-invalid', 'AppID 格式不正确：应为 wx 开头的 18 位字母数字（自定义 AppID 需 6~64 位字母数字）')
  }
  return appId
}

/** 校验并规整 AppSecret。 */
function normalizeAppSecret(value) {
  const appSecret = typeof value === 'string' ? value.trim() : ''
  if (appSecret === '') throw new StudioError('config-invalid', '请填写公众号 AppSecret（公众号后台 → 设置与开发 → 基本配置 里可以查看或重置）')
  if (!/^[0-9A-Za-z]{16,128}$/.test(appSecret)) {
    throw new StudioError('config-invalid', 'AppSecret 格式不正确：应为 16~128 位字母数字，注意不要带空格或引号')
  }
  return appSecret
}

/** 从 credentials 记录里解析出公众号凭据；解析失败按未配置处理。 */
function parseAccountRecord(record) {
  if (record === undefined || record === null || record.kind !== 'api-key' || typeof record.key !== 'string') return null
  let parsed
  try {
    parsed = JSON.parse(record.key)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object') return null
  if (typeof parsed.appId !== 'string' || parsed.appId === '') return null
  if (typeof parsed.appSecret !== 'string' || parsed.appSecret === '') return null
  return { appId: parsed.appId, appSecret: parsed.appSecret }
}

/** 把错误统一成 StudioError；微信错误走中文映射。 */
function toStudioError(error) {
  if (error instanceof StudioError) return error
  if (error instanceof WechatApiError) {
    const mapped = mapWechatError(error)
    return new StudioError(mapped.code, mapped.message, mapped.detail)
  }
  return error
}

/** 执行一段微信调用，出错时转成 StudioError。 */
async function wechatCall(run) {
  try {
    return await run()
  } catch (error) {
    throw toStudioError(error)
  }
}

/**
 * 解码 data URL 形式的图片。
 * @param {string} dataUrl 图片 data URL。
 * @param {{ maxBytes: number, label: string, name?: string }} options 上限与文案。
 * @returns {{ bytes: Uint8Array, mimeType: string, filename: string }} 图片数据。
 * @throws {StudioError} 格式不对抛 image-invalid，超过上限抛 image-too-large。
 */
function decodeImageDataUrl(dataUrl, { maxBytes, label, name }) {
  if (typeof dataUrl !== 'string' || dataUrl.trim() === '') {
    throw new StudioError('image-invalid', `${label}的数据为空，请重新选择图片`)
  }
  const trimmed = dataUrl.trim()
  const match = DATA_URL_PATTERN.exec(trimmed)
  if (match === null) {
    const declared = /^data:([^;,]+)/i.exec(trimmed)
    if (declared !== null) {
      throw new StudioError('image-invalid', `${label}的格式是 ${declared[1]}，只支持 PNG 或 JPEG 图片`)
    }
    throw new StudioError('image-invalid', `${label}不是 data URL 格式，请重新选择图片`)
  }
  const mimeType = match[1]
  const base64 = match[2]
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.length === 0) {
    throw new StudioError('image-invalid', `${label}解析后是空文件，请重新选择图片`)
  }
  if (bytes.length > maxBytes) {
    const limit = Math.round(maxBytes / 1024 / 1024)
    throw new StudioError(
      'image-too-large',
      `${label}有 ${formatBytes(bytes.length)}，微信要求单张 ≤${limit}MB，请压缩后重试`,
      { bytes: bytes.length, maxBytes },
    )
  }
  return { bytes: new Uint8Array(bytes), mimeType, filename: filenameFor(mimeType, name, 'image') }
}

/**
 * 创建排版工作台服务。
 * @param {{ ctx: object, fetchImpl?: typeof fetch }} options 上下文与 fetch 注入。
 * @returns {object} 动作方法集合。
 */
/** Hostnames that never make sense as public article images. */
const PRIVATE_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa']

/** Parse a dotted IPv4 into octets. */
function parseIpv4(hostname) {
  const parts = hostname.split('.')
  if (parts.length !== 4) return null
  const values = parts.map(part => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN))
  if (values.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return null
  return values
}

/** Loopback, private, link-local and reserved IPv4 ranges. */
function isPrivateIpv4([a, b]) {
  if (a === 10 || a === 127 || a === 0 || a === 255) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  if (a >= 224) return true
  if (a === 192 && b === 0) return true
  if (a === 198 && b === 51) return true
  if (a === 203 && b === 0) return true
  return false
}

/** True for localhost, private IP literals and local-only suffixes. */
function isPrivateHostname(hostname) {
  const host = String(hostname ?? '').toLowerCase().replace(/^\[|\]$/g, '')
  if (host === '' || host === 'localhost' || host === '0.0.0.0' || host === '::' || host === '::1') return true
  if (PRIVATE_HOST_SUFFIXES.some(suffix => host.endsWith(suffix))) return true
  if (host.includes(':')) {
    return host.startsWith('fc') || host.startsWith('fd') || /^fe[89ab]/.test(host) || host.startsWith('::ffff:')
  }
  const ipv4 = parseIpv4(host)
  return ipv4 !== null && isPrivateIpv4(ipv4)
}

/** Refuse image URLs that point at the machine or its local network. */
function assertPublicImageUrl(parsed, rawUrl) {
  if (isPrivateHostname(parsed.hostname)) {
    throw new StudioError('image-fetch-failed', `图片地址指向本机或内网（${parsed.hostname}），已拒绝：${rawUrl}`)
  }
}

/** Validate one draft article and apply WeChat field limits. */
function normalizeDraftArticle(raw, position, total) {
  const warnings = []
  const prefix = total > 1 ? `第 ${position + 1} 篇：` : ''
  let title = typeof raw?.title === 'string' ? raw.title.trim() : ''
  if (title === '') throw new StudioError('title-required', `${prefix}标题不能为空，请先填写文章标题`)
  if (textLength(title) > 64) {
    warnings.push(`${prefix}标题超过微信 64 字上限，已截断为前 64 字`)
    title = truncateText(title, 64)
  }
  const content = typeof raw?.content === 'string' ? raw.content : ''
  if (content.trim() === '') throw new StudioError('content-required', `${prefix}正文内容是空的，请先写好文章内容再保存草稿`)
  const thumbMediaId = typeof raw?.thumbMediaId === 'string' ? raw.thumbMediaId.trim() : ''
  if (thumbMediaId === '') {
    throw new StudioError('cover-required', `${prefix}缺少封面图。请先在发布面板生成或上传封面，再保存草稿`)
  }
  let author = typeof raw?.author === 'string' ? raw.author.trim() : ''
  if (author !== '' && textLength(author) > 8) {
    author = truncateText(author, 8)
    warnings.push(`${prefix}作者名超过微信 8 字上限，已截断为「${author}」`)
  }
  let digest = typeof raw?.digest === 'string' ? raw.digest.trim() : ''
  if (digest !== '' && textLength(digest) > 120) {
    digest = truncateText(digest, 120)
    warnings.push(`${prefix}摘要超过微信 120 字上限，已截断为前 120 字`)
  }
  const contentSourceUrl = typeof raw?.contentSourceUrl === 'string' ? raw.contentSourceUrl.trim() : ''
  const needOpenComment = raw?.needOpenComment === true ? 1 : 0
  const onlyFansCanComment = needOpenComment === 1 && raw?.onlyFansCanComment === true ? 1 : 0
  const article = {
    article_type: 'news',
    title,
    content,
    thumb_media_id: thumbMediaId,
    need_open_comment: needOpenComment,
    only_fans_can_comment: onlyFansCanComment,
  }
  if (author !== '') article.author = author
  if (digest !== '') article.digest = digest
  if (contentSourceUrl !== '') article.content_source_url = contentSourceUrl
  return { article, warnings }
}

export function createStudioService({ ctx, fetchImpl = fetch, importUndici } = {}) {
  if (ctx === undefined || ctx === null) throw new TypeError('createStudioService 需要 Cordis 上下文')
  const ai = createAiEditor({ ctx })

  /** appId → { token, expiresAt, expiresIn } */
  const tokenCache = new Map()
  /** appId → 正在进行的取 token Promise，合并并发请求 */
  const tokenPending = new Map()
  /** 网络设置 key → fetch 实现 */
  const networkFetchCache = new Map()

  /** 取 credentials 服务；环境里没有时给出明确说明。 */
  function credentials() {
    const service = typeof ctx.get === 'function' ? ctx.get('credentials') : undefined
    if (
      service === undefined
      || service === null
      || typeof service.readRecord !== 'function'
      || typeof service.modifyRecord !== 'function'
      || typeof service.deleteRecord !== 'function'
    ) {
      throw new StudioError('credentials-unavailable', '本环境没有 credentials 服务，无法保存公众号密钥。请在 DSH 桌面应用中打开这个插件')
    }
    return service
  }

  /** Normalize the persisted account list; invalid rows are dropped. */
  function normalizeAccountsState(value) {
    const accounts = Array.isArray(value?.accounts)
      ? value.accounts
        .filter(entry => entry && typeof entry.appId === 'string' && typeof entry.appSecret === 'string')
        .map((entry, index) => ({
          id: typeof entry.id === 'string' && entry.id !== '' ? entry.id : `acct-${index + 1}`,
          name: typeof entry.name === 'string' && entry.name.trim() !== '' ? entry.name.trim().slice(0, 40) : `公众号 ${index + 1}`,
          appId: entry.appId,
          appSecret: entry.appSecret,
        }))
      : []
    const activeId = accounts.some(entry => entry.id === value?.activeId) ? value.activeId : (accounts[0]?.id ?? '')
    return { activeId, accounts }
  }

  async function writeAccountsState(state) {
    const service = credentials()
    try {
      await service.modifyRecord(ACCOUNTS_KEY, async () => ({ kind: 'api-key', key: JSON.stringify(state) }))
    } catch (error) {
      throw new StudioError('credentials-unavailable', `保存公众号账号失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** Read the multi-account state, migrating the legacy single-account record once. */
  async function readAccountsState() {
    const service = credentials()
    let record
    try {
      record = await service.readRecord(ACCOUNTS_KEY)
    } catch (error) {
      throw new StudioError('credentials-unavailable', `读取本机保存的公众号账号失败：${error instanceof Error ? error.message : String(error)}`)
    }
    if (record !== undefined && record !== null && typeof record.key === 'string') {
      try {
        const parsed = JSON.parse(record.key)
        const state = normalizeAccountsState(parsed)
        if (state.accounts.length > 0) return state
      } catch {
        // Fall through to the legacy record.
      }
    }
    let legacy = null
    try {
      legacy = parseAccountRecord(await service.readRecord(CREDENTIALS_KEY))
    } catch {
      legacy = null
    }
    if (legacy !== null) {
      const migrated = { activeId: 'acct-legacy', accounts: [{ id: 'acct-legacy', name: '默认账号', appId: legacy.appId, appSecret: legacy.appSecret }] }
      await writeAccountsState(migrated)
      return migrated
    }
    return { activeId: '', accounts: [] }
  }

  function activeAccountOf(state) {
    const account = state.accounts.find(entry => entry.id === state.activeId) ?? state.accounts[0]
    return account === undefined ? null : { id: account.id, name: account.name, appId: account.appId, appSecret: account.appSecret }
  }

  function publicAccounts(state) {
    return {
      activeId: state.activeId,
      accounts: state.accounts.map(entry => ({
        id: entry.id,
        name: entry.name,
        appIdPreview: previewAppId(entry.appId),
        active: entry.id === state.activeId,
      })),
    }
  }

  /** 读取当前公众号凭据。 */
  async function readAccount({ required }) {
    const state = await readAccountsState()
    const account = activeAccountOf(state)
    if (account === null && required) {
      throw new StudioError('not-configured', '还没有配置公众号 AppID 和 AppSecret，请先在设置里填写并保存')
    }
    return account
  }

  /** 读取网络设置；读不到时按跟随系统处理。 */
  async function readNetworkSettings() {
    const service = typeof ctx.get === 'function' ? ctx.get('credentials') : undefined
    if (service === undefined || service === null || typeof service.readRecord !== 'function') {
      return { mode: 'system', proxyUrl: '' }
    }
    let record
    try {
      record = await service.readRecord(NETWORK_KEY)
    } catch {
      return { mode: 'system', proxyUrl: '' }
    }
    if (record === undefined || record === null || typeof record.key !== 'string') return { mode: 'system', proxyUrl: '' }
    try {
      const parsed = JSON.parse(record.key)
      return normalizeNetworkSettings(
        { mode: parsed?.mode, proxyUrl: typeof parsed?.proxyUrl === 'string' ? parsed.proxyUrl : '' },
        { mode: 'system', proxyUrl: '' },
      )
    } catch {
      return { mode: 'system', proxyUrl: '' }
    }
  }

  /** 微信 API 使用的 fetch：按当前设置走系统或固定代理。 */
  async function networkFetch(input, init = {}) {
    const settings = await readNetworkSettings()
    const key = `${settings.mode}|${settings.proxyUrl}`
    let impl = networkFetchCache.get(key)
    if (impl === undefined) {
      impl = await createNetworkFetch(settings, { fetchImpl, importUndici })
      networkFetchCache.set(key, impl)
    }
    return impl(input, init)
  }

  const client = createWechatClient({ fetchImpl: networkFetch })

  /** 取缓存里仍有效的 token。 */
  function cachedToken(appId) {
    const entry = tokenCache.get(appId)
    if (entry !== undefined && entry.expiresAt > Date.now()) return entry
    return undefined
  }

  /** 取 token：先查缓存，再合并并发请求，最后真正请求微信。 */
  function loadToken(account, { force = false } = {}) {
    const appId = account.appId
    if (!force) {
      const hit = cachedToken(appId)
      if (hit !== undefined) return Promise.resolve(hit)
    }
    const pending = tokenPending.get(appId)
    if (pending !== undefined) return pending
    const promise = client
      .getAccessToken({ appId, appSecret: account.appSecret })
      .then((result) => {
        const seconds = Number.isFinite(result.expiresIn) && result.expiresIn > 0 ? result.expiresIn : FALLBACK_TOKEN_TTL_SECONDS
        const ttlSeconds = Math.max(60, seconds - 300)
        const entry = { token: result.accessToken, expiresAt: Date.now() + ttlSeconds * 1000, expiresIn: ttlSeconds }
        tokenCache.set(appId, entry)
        return entry
      })
      .finally(() => {
        if (tokenPending.get(appId) === promise) tokenPending.delete(appId)
      })
    tokenPending.set(appId, promise)
    return promise
  }

  /** 带 token 执行调用；token 失效时清缓存重试一次。 */
  async function withToken(account, run) {
    const entry = await loadToken(account)
    try {
      return await run(entry.token)
    } catch (error) {
      if (!isTokenInvalidError(error)) throw error
      tokenCache.delete(account.appId)
      const refreshed = await loadToken(account, { force: true })
      return await run(refreshed.token)
    }
  }

  /** 读取远程图片，限制大小、类型和超时。 */
  async function downloadRemoteImage(rawUrl) {
    let parsed
    try {
      parsed = new URL(rawUrl)
    } catch {
      throw new StudioError('image-fetch-failed', `图片地址不是合法的 URL：${rawUrl}`)
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new StudioError('image-fetch-failed', `图片地址必须是 http 或 https：${rawUrl}`)
    }
    assertPublicImageUrl(parsed, rawUrl)
    let response
    try {
      response = await fetchImpl(rawUrl, {
        redirect: 'follow',
        headers: { accept: 'image/png,image/jpeg' },
        signal: AbortSignal.timeout(REMOTE_IMAGE_TIMEOUT_MS),
      })
    } catch (error) {
      const failed = error instanceof Error
      const reason = failed && (error.name === 'TimeoutError' || error.name === 'AbortError')
        ? '下载超时（15 秒）'
        : `网络请求失败：${failed ? error.message : String(error)}`
      throw new StudioError('image-fetch-failed', `下载图片失败（${rawUrl}）：${reason}`)
    }
    if (response.ok !== true) {
      throw new StudioError('image-fetch-failed', `下载图片失败（${rawUrl}）：图片地址返回 HTTP ${response.status}`)
    }
    if (typeof response.url === 'string' && response.url !== '') {
      // A public URL may redirect into the local network; refuse before reading.
      assertPublicImageUrl(new URL(response.url), rawUrl)
    }
    const contentType = String(response.headers?.get?.('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (contentType !== 'image/png' && contentType !== 'image/jpeg') {
      throw new StudioError(
        'image-fetch-failed',
        `下载图片失败（${rawUrl}）：返回的内容类型是「${contentType === '' ? '未知' : contentType}」，只支持 PNG 或 JPEG`,
      )
    }
    const declaredLength = Number(response.headers?.get?.('content-length') ?? '')
    if (Number.isFinite(declaredLength) && declaredLength > REMOTE_IMAGE_MAX_BYTES) {
      throw tooLargeRemoteImage(rawUrl, declaredLength)
    }
    const bytes = await readBoundedImageBody(response, rawUrl)
    return { bytes, mimeType: contentType, filename: filenameFor(contentType, parsed.pathname.split('/').pop(), 'image') }
  }

  /** 下载体积超限的统一错误。 */
  function tooLargeRemoteImage(rawUrl, bytes) {
    return new StudioError(
      'image-fetch-failed',
      `下载图片失败（${rawUrl}）：图片有 ${formatBytes(bytes)}，超过单张 5MB 上限`,
      { url: rawUrl, bytes, maxBytes: REMOTE_IMAGE_MAX_BYTES },
    )
  }

  /** 流式读取响应体并计数，超过上限立刻停止。 */
  async function readBoundedImageBody(response, rawUrl, { maxBytes = REMOTE_IMAGE_MAX_BYTES, onTooLarge } = {}) {
    const makeTooLargeError = onTooLarge ?? ((bytes) => tooLargeRemoteImage(rawUrl, bytes))
    const chunks = []
    let total = 0
    const take = (chunk) => {
      const view = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
      total += view.byteLength
      if (total > maxBytes) throw makeTooLargeError(total)
      chunks.push(Buffer.from(view))
    }
    const body = response.body
    if (body !== undefined && body !== null && typeof body.getReader === 'function') {
      const reader = body.getReader()
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done === true) break
          take(value)
        }
      } catch (error) {
        if (error instanceof StudioError) {
          try {
            await reader.cancel()
          } catch {
            // 已经失败，取消结果无关紧要。
          }
          throw error
        }
        throw new StudioError('image-fetch-failed', `下载图片失败（${rawUrl}）：读取图片数据时出错：${error instanceof Error ? error.message : String(error)}`)
      } finally {
        if (typeof reader.releaseLock === 'function') reader.releaseLock()
      }
    } else {
      let buffer
      try {
        buffer = Buffer.from(await response.arrayBuffer())
      } catch (error) {
        throw new StudioError('image-fetch-failed', `下载图片失败（${rawUrl}）：读取图片数据时出错：${error instanceof Error ? error.message : String(error)}`)
      }
      if (buffer.length > maxBytes) throw makeTooLargeError(buffer.length)
      chunks.push(buffer)
      total = buffer.length
    }
    if (total === 0) throw new StudioError('image-fetch-failed', `下载图片失败（${rawUrl}）：图片内容是空的`)
    return new Uint8Array(Buffer.concat(chunks, total))
  }

  return {
    /** 当前配置状态。 */
    async status() {
      const state = await readAccountsState()
      const account = activeAccountOf(state)
      if (account === null) return { configured: false, appIdPreview: null, tokenCached: false, ...publicAccounts(state) }
      return {
        configured: true,
        appIdPreview: previewAppId(account.appId),
        tokenCached: cachedToken(account.appId) !== undefined,
        ...publicAccounts(state),
      }
    },

    /** 列出账号；secret 不返回。 */
    async listAccounts() {
      return publicAccounts(await readAccountsState())
    },

    /** 新增或更新账号，并可按请求切换。 */
    async saveAccount(payload = {}) {
      const state = await readAccountsState()
      const appId = normalizeAppId(payload?.appId)
      const appSecret = normalizeAppSecret(payload?.appSecret)
      const name = typeof payload?.name === 'string' && payload.name.trim() !== '' ? payload.name.trim().slice(0, 40) : ''
      const id = typeof payload?.id === 'string' && payload.id !== '' ? payload.id : `acct-${Date.now().toString(36)}`
      const existing = state.accounts.find(entry => entry.id === id)
      if (existing === undefined) {
        state.accounts.push({ id, name: name || `公众号 ${state.accounts.length + 1}`, appId, appSecret })
      } else {
        existing.appId = appId
        existing.appSecret = appSecret
        if (name !== '') existing.name = name
      }
      if (payload?.activate === true || state.activeId === '') state.activeId = id
      await writeAccountsState(state)
      tokenCache.clear()
      tokenPending.clear()
      return publicAccounts(state)
    },

    /** 切换当前账号。 */
    async switchAccount(payload = {}) {
      const state = await readAccountsState()
      const id = typeof payload?.id === 'string' ? payload.id : ''
      if (!state.accounts.some(entry => entry.id === id)) throw new StudioError('account-missing', '这个公众号账号不存在')
      state.activeId = id
      await writeAccountsState(state)
      tokenCache.clear()
      tokenPending.clear()
      return publicAccounts(state)
    },

    /** 删除一个账号。 */
    async removeAccount(payload = {}) {
      const state = await readAccountsState()
      const id = typeof payload?.id === 'string' ? payload.id : ''
      state.accounts = state.accounts.filter(entry => entry.id !== id)
      if (state.activeId === id) state.activeId = state.accounts[0]?.id ?? ''
      await writeAccountsState(state)
      tokenCache.clear()
      tokenPending.clear()
      return publicAccounts(state)
    },

    /** 读取出站网络设置（代理密码不回传明文）。 */
    async networkStatus() {
      const settings = await readNetworkSettings()
      return {
        mode: settings.mode,
        proxyUrl: redactProxyUrl(settings.proxyUrl),
        configured: settings.mode === 'proxy',
      }
    },

    /**
     * 取回一张远程图片，供预览里裁剪；只允许 http/https 公网地址。
     * @param {{ url?: string }} payload 图片地址。
     * @returns {Promise<{ dataUrl: string, mime: string }>} 图片 data URL。
     */
    async fetchRemoteImage(payload = {}) {
      const maxBytes = 8 * 1024 * 1024
      const raw = typeof payload?.url === 'string' ? payload.url.trim() : ''
      let url
      try {
        url = new URL(raw)
      } catch {
        throw new StudioError('image-url-invalid', '图片地址不合法')
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new StudioError('image-url-invalid', '只支持 http/https 图片地址')
      }
      if (isPrivateHostname(url.hostname)) {
        throw new StudioError('image-url-invalid', '不允许读取本机或内网地址')
      }
      let response
      try {
        response = await networkFetch(url.toString(), {
          redirect: 'follow',
          signal: AbortSignal.timeout(REMOTE_IMAGE_TIMEOUT_MS),
        })
      } catch (error) {
        const failed = error instanceof Error
        const reason = failed && (error.name === 'TimeoutError' || error.name === 'AbortError')
          ? '下载超时（15 秒）'
          : (failed ? error.message : String(error))
        throw new StudioError('image-fetch-failed', `图片下载失败：${reason}`)
      }
      if (!response.ok) throw new StudioError('image-fetch-failed', `图片下载失败（HTTP ${response.status}）`)
      if (typeof response.url === 'string' && response.url !== '') {
        let finalUrl
        try {
          finalUrl = new URL(response.url)
        } catch {
          throw new StudioError('image-url-invalid', '图片重定向后的地址不合法')
        }
        if ((finalUrl.protocol !== 'http:' && finalUrl.protocol !== 'https:') || isPrivateHostname(finalUrl.hostname)) {
          throw new StudioError('image-url-invalid', '不允许读取本机或内网地址')
        }
      }
      const mime = (response.headers?.get?.('content-type') ?? '').split(';')[0].trim().toLowerCase()
      if (!mime.startsWith('image/')) throw new StudioError('image-fetch-failed', '这个地址返回的不是图片')
      const declared = Number(response.headers?.get?.('content-length') ?? 0)
      if (Number.isFinite(declared) && declared > maxBytes) {
        throw new StudioError('image-too-large', '远程图片超过 8MB，先压缩或换一张')
      }
      const bytes = await readBoundedImageBody(response, raw, {
        maxBytes,
        onTooLarge: () => new StudioError('image-too-large', '远程图片超过 8MB，先压缩或换一张'),
      })
      return { dataUrl: `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`, mime }
    },

    /** 保存出站网络设置；只写本机凭据库，不写浏览器存储。 */
    async saveNetwork(payload = {}) {
      const current = await readNetworkSettings()
      let settings
      try {
        settings = normalizeNetworkSettings(payload, current)
      } catch (error) {
        throw new StudioError('proxy-invalid', error instanceof Error ? error.message : String(error))
      }
      const service = credentials()
      try {
        await service.modifyRecord(NETWORK_KEY, async () => ({ kind: 'api-key', key: JSON.stringify(settings) }))
      } catch (error) {
        throw new StudioError('credentials-unavailable', `保存代理设置失败：${error instanceof Error ? error.message : String(error)}`)
      }
      networkFetchCache.clear()
      return { mode: settings.mode, proxyUrl: redactProxyUrl(settings.proxyUrl), configured: settings.mode === 'proxy' }
    },

    /**
     * 连续探测微信接口实际看到的出口 IP。
     * 微信在 40164 的 errmsg 里带 IP；如果 token 能取到，说明当前出口已白名单。
     */
    async probeWechatEgress(payload = {}) {
      const account = await readAccount({ required: true })
      const raw = Number(payload?.samples)
      const samples = Number.isFinite(raw) ? Math.min(3, Math.max(1, Math.trunc(raw))) : 3
      const results = []
      for (let index = 0; index < samples; index += 1) {
        try {
          await client.getAccessToken({ appId: account.appId, appSecret: account.appSecret })
          results.push({ ok: true, ip: '', code: 'ok' })
        } catch (error) {
          const mapped = error instanceof WechatApiError ? mapWechatError(error) : { code: 'wechat-failed', message: String(error), detail: {} }
          results.push({
            ok: false,
            ip: typeof mapped.detail?.ip === 'string' ? mapped.detail.ip : '',
            code: mapped.code,
            message: mapped.message,
          })
          if (mapped.code !== 'ip-not-allowed') break
        }
        if (index < samples - 1) await new Promise(resolve => setTimeout(resolve, 400))
      }
      const ips = [...new Set(results.map(result => result.ip).filter(ip => ip !== ''))]
      return {
        samples: results,
        ips,
        whitelisted: results.every(result => result.ok),
        changing: ips.length > 1,
      }
    },

    /** 用当前（或临时填写的）网络设置请求一次 IP 检测服务。 */
    async probeNetwork(payload = {}) {
      const current = await readNetworkSettings()
      let settings
      try {
        settings = normalizeNetworkSettings(payload, current)
      } catch (error) {
        throw new StudioError('proxy-invalid', error instanceof Error ? error.message : String(error))
      }
      let probeFetch
      try {
        probeFetch = await createNetworkFetch(settings, { fetchImpl, importUndici })
      } catch (error) {
        throw new StudioError('proxy-invalid', error instanceof Error ? error.message : String(error))
      }
      try {
        const result = await probeEgress(probeFetch)
        return { ...result, mode: settings.mode, proxyUrl: redactProxyUrl(settings.proxyUrl) }
      } catch (error) {
        throw new StudioError('proxy-failed', `出口检测失败：${error instanceof Error ? error.message : String(error)}`)
      }
    },

    /** 保存 AppID / AppSecret 到本机凭据库。 */
    async saveConfig(payload = {}) {
      const state = await readAccountsState()
      const appId = normalizeAppId(payload?.appId)
      const appSecret = normalizeAppSecret(payload?.appSecret)
      const existing = state.accounts.find(entry => entry.id === state.activeId)
      if (existing === undefined) {
        const created = { id: `acct-${Date.now().toString(36)}`, name: '默认账号', appId, appSecret }
        state.accounts.push(created)
        state.activeId = created.id
      } else {
        existing.appId = appId
        existing.appSecret = appSecret
        state.activeId = existing.id
      }
      await writeAccountsState(state)
      tokenCache.clear()
      tokenPending.clear()
      return { configured: true, appIdPreview: previewAppId(appId), ...publicAccounts(state) }
    },

    /** 删除本机保存的公众号密钥。 */
    async clearConfig() {
      const state = await readAccountsState()
      state.accounts = []
      state.activeId = ''
      await writeAccountsState(state)
      try { await credentials().deleteRecord(CREDENTIALS_KEY) } catch { /* legacy may be absent */ }
      tokenCache.clear()
      tokenPending.clear()
      return { configured: false, activeId: '', accounts: [] }
    },

    /** 取一次 access_token，确认凭据可用。 */
    async testConnection() {
      const account = await readAccount({ required: true })
      return wechatCall(async () => {
        const entry = await loadToken(account)
        const remaining = Math.max(1, Math.round((entry.expiresAt - Date.now()) / 1000))
        return { ok: true, expiresIn: remaining }
      })
    },

    /** 上传正文图片（data URL 输入），返回 id → 微信图片地址的映射。 */
    async uploadImages(payload = {}) {
      const account = await readAccount({ required: true })
      const images = payload?.images
      if (!Array.isArray(images) || images.length === 0) {
        throw new StudioError('images-required', '请至少提供一张要上传的图片')
      }
      // 先全部解码校验，避免上传到一半才发现某张图不合法。
      const prepared = images.map((item, index) => {
        const label = `第 ${index + 1} 张正文图片`
        if (item === null || typeof item !== 'object' || typeof item.dataUrl !== 'string') {
          throw new StudioError('image-invalid', `${label}缺少 dataUrl，请重新选择图片`)
        }
        const id = typeof item.id === 'string' && item.id.trim() !== '' ? item.id : `image-${index}`
        return { id, ...decodeImageDataUrl(item.dataUrl, { maxBytes: CONTENT_IMAGE_MAX_BYTES, label, name: item.name }) }
      })
      return wechatCall(async () => {
        const uploaded = []
        for (const image of prepared) {
          const result = await withToken(account, (token) => client.uploadContentImage({
            accessToken: token,
            bytes: image.bytes,
            mimeType: image.mimeType,
            filename: image.filename,
          }))
          uploaded.push({ id: image.id, url: result.url })
        }
        return { images: uploaded }
      })
    },

    /**
     * 转存外链图片：先按 URL 下载，再上传到微信，返回原地址与微信地址的映射。
     * 任何一张失败就整体报错，并说明是哪张 URL。
     */
    async importImages(payload = {}) {
      const account = await readAccount({ required: true })
      const urls = payload?.urls
      if (!Array.isArray(urls) || urls.length === 0) {
        throw new StudioError('urls-required', '请提供要转存的图片地址列表（urls）')
      }
      const results = []
      for (let index = 0; index < urls.length; index += 1) {
        const rawUrl = urls[index]
        if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
          throw new StudioError('image-fetch-failed', `第 ${index + 1} 张图片的地址为空，请检查正文里的图片链接`)
        }
        const url = rawUrl.trim()
        const downloaded = await downloadRemoteImage(url)
        const uploaded = await wechatCall(async () => {
          try {
            return await withToken(account, (token) => client.uploadContentImage({
              accessToken: token,
              bytes: downloaded.bytes,
              mimeType: downloaded.mimeType,
              filename: downloaded.filename,
            }))
          } catch (error) {
            const studio = toStudioError(error)
            throw new StudioError(
              studio instanceof StudioError ? studio.code : 'image-fetch-failed',
              `第 ${index + 1} 张图片（${url}）转存到微信失败：${studio instanceof Error ? studio.message : String(studio)}`,
              { url, index, detail: studio instanceof StudioError ? studio.detail : undefined },
            )
          }
        })
        results.push({ url, wechatUrl: uploaded.url })
      }
      return { images: results }
    },

    /** 上传封面到永久素材库，返回 media_id 供草稿使用。 */
    async uploadCover(payload = {}) {
      const account = await readAccount({ required: true })
      const image = decodeImageDataUrl(payload?.dataUrl, {
        maxBytes: COVER_IMAGE_MAX_BYTES,
        label: '封面图片',
        name: typeof payload?.name === 'string' ? payload.name : 'cover.png',
      })
      return wechatCall(async () => {
        const result = await withToken(account, (token) => client.uploadPermanentImage({
          accessToken: token,
          bytes: image.bytes,
          mimeType: image.mimeType,
          filename: image.filename,
        }))
        return { mediaId: result.mediaId, url: result.url }
      })
    },

    /**
     * 新建草稿。payload 可以是单篇字段，也可以用 `articles` 传 1-8 篇。
     * 按微信限制截断标题/作者/摘要，返回 warnings 与篇数。
     */
    async createDraft(payload = {}) {
      const account = await readAccount({ required: true })
      const rawArticles = Array.isArray(payload?.articles) ? payload.articles : [payload]
      if (rawArticles.length === 0) throw new StudioError('articles-required', '草稿里至少需要一篇文章')
      if (rawArticles.length > 8) throw new StudioError('too-many-articles', '一篇草稿最多 8 篇文章，请分两次保存')
      const total = rawArticles.length
      const warnings = []
      const articles = rawArticles.map((raw, index) => {
        const normalized = normalizeDraftArticle(raw, index, total)
        warnings.push(...normalized.warnings)
        return normalized.article
      })
      return wechatCall(async () => {
        const result = await withToken(account, (token) => client.createDraft({ accessToken: token, articles }))
        return { mediaId: result.mediaId, warnings, count: articles.length }
      })
    },

    /** 覆盖更新一篇已有草稿；多图文按原篇数逐篇更新，篇数变化时要求另存。 */
    async updateDraft(payload = {}) {
      const account = await readAccount({ required: true })
      const mediaId = typeof payload?.mediaId === 'string' ? payload.mediaId.trim() : ''
      if (mediaId === '') throw new StudioError('media-required', '缺少草稿 mediaId，无法更新')
      const rawArticles = Array.isArray(payload?.articles) ? payload.articles : [payload]
      if (rawArticles.length === 0) throw new StudioError('articles-required', '草稿里至少需要一篇文章')
      if (rawArticles.length > 8) throw new StudioError('too-many-articles', '一篇草稿最多 8 篇文章，请分两次保存')
      const warnings = []
      const total = rawArticles.length
      const articles = rawArticles.map((raw, index) => {
        const normalized = normalizeDraftArticle(raw, index, total)
        warnings.push(...normalized.warnings)
        return normalized.article
      })
      return wechatCall(async () => {
        return withToken(account, async (token) => {
          const existing = await client.getDraft({ accessToken: token, mediaId })
          const existingCount = Array.isArray(existing.items) ? existing.items.length : 0
          if (existingCount !== total) {
            throw new StudioError(
              'update-count-mismatch',
              `后台草稿有 ${existingCount} 篇，本地合集有 ${total} 篇；篇数变化无法覆盖，请另存为新草稿`,
            )
          }
          for (let index = 0; index < articles.length; index += 1) {
            await client.updateDraft({ accessToken: token, mediaId, index, article: articles[index] })
          }
          return { mediaId, warnings, count: total, updated: true }
        })
      })
    },

    /** 读取公众号草稿箱，用于在面板里查看和清理。 */
    async listDrafts(payload = {}) {
      const account = await readAccount({ required: true })
      const rawCount = Number(payload?.count)
      const rawOffset = Number(payload?.offset)
      const count = Number.isFinite(rawCount) ? Math.min(20, Math.max(1, Math.trunc(rawCount))) : 10
      const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.trunc(rawOffset)) : 0
      return wechatCall(async () => {
        const result = await withToken(account, (token) => client.listDrafts({ accessToken: token, offset, count }))
        return { totalCount: result.totalCount, items: result.items }
      })
    },

    /** 读取公众号草稿的完整内容，用于导回工作台继续编辑。 */
    async getDraft(payload = {}) {
      const account = await readAccount({ required: true })
      const mediaId = typeof payload?.mediaId === 'string' ? payload.mediaId.trim() : ''
      if (mediaId === '') throw new StudioError('media-required', '缺少草稿 mediaId，无法读取')
      return wechatCall(async () => {
        const result = await withToken(account, (token) => client.getDraft({ accessToken: token, mediaId }))
        if (!Array.isArray(result.items) || result.items.length === 0) {
          throw new StudioError('draft-empty', '这篇草稿里没有可读取的文章')
        }
        return { items: result.items }
      })
    },

    /** 读取发布复盘数据；没有数据统计权限时返回微信原始错误。 */
    async articleStats(payload = {}) {
      const account = await readAccount({ required: true })
      const raw = Number(payload?.days)
      const days = Number.isFinite(raw) ? Math.min(30, Math.max(1, Math.trunc(raw))) : 7
      const end = new Date()
      const begin = new Date(end.getTime() - (days - 1) * 24 * 60 * 60 * 1000)
      const format = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      return wechatCall(async () => {
        const result = await withToken(account, (token) => client.getArticleSummary({
          accessToken: token,
          beginDate: format(begin),
          endDate: format(end),
        }))
        return { days, items: Array.isArray(result.list) ? result.list : [] }
      })
    },

    /** 删除一篇公众号草稿。 */
    async deleteDraft(payload = {}) {
      const account = await readAccount({ required: true })
      const mediaId = typeof payload?.mediaId === 'string' ? payload.mediaId.trim() : ''
      if (mediaId === '') throw new StudioError('media-required', '缺少草稿 mediaId，无法删除')
      return wechatCall(async () => {
        await withToken(account, (token) => client.deleteDraft({ accessToken: token, mediaId }))
        return { deleted: true, mediaId }
      })
    },

    /** 提交发布。没有发布权限时提示改用保存到草稿箱。 */
    async publish(payload = {}) {
      const account = await readAccount({ required: true })
      const mediaId = typeof payload?.mediaId === 'string' ? payload.mediaId.trim() : ''
      if (mediaId === '') throw new StudioError('media-required', '缺少草稿 mediaId，请先保存草稿再发布')
      try {
        return await wechatCall(async () => {
          const result = await withToken(account, (token) => client.submitPublish({ accessToken: token, mediaId }))
          return { publishId: result.publishId }
        })
      } catch (error) {
        const studio = toStudioError(error)
        if (studio instanceof StudioError && studio.code === 'api-unauthorized') {
          throw new StudioError(
            studio.code,
            '当前公众号没有发布接口权限：发布需要已认证并具备发布能力的公众号。可以改用「保存到草稿箱」，再到公众号后台手动发布',
            studio.detail,
          )
        }
        if (studio instanceof StudioError && studio.code === 'account-unverified') {
          throw new StudioError(
            studio.code,
            '当前公众号未完成认证，无法使用发布接口。可以改用「保存到草稿箱」，再到公众号后台手动发布',
            studio.detail,
          )
        }
        throw studio
      }
    },

    /** 查询发布状态，返回状态码与中文文案。 */
    async publishStatus(payload = {}) {
      const account = await readAccount({ required: true })
      const publishId = typeof payload?.publishId === 'string' ? payload.publishId.trim() : ''
      if (publishId === '') throw new StudioError('publish-id-required', '缺少发布任务 publishId，请先发起发布')
      return wechatCall(async () => {
        const data = await withToken(account, (token) => client.getPublishStatus({ accessToken: token, publishId }))
        const rawStatus = Number(data?.publish_status)
        const publishStatus = Number.isFinite(rawStatus) ? rawStatus : -1
        return {
          publishStatus,
          statusText: PUBLISH_STATUS_TEXT[publishStatus] ?? '未知状态',
        }
      })
    },

    /** 对话式修改：把文章、排版与自然语言指令交给当前默认模型。 */
    async aiEdit(payload = {}) {
      try {
        return await ai.edit(payload)
      } catch (error) {
        if (error !== null && typeof error === 'object' && typeof error.code === 'string') {
          throw new StudioError(error.code, error.message)
        }
        throw error
      }
    },
  }
}
