/**
 * 排版工作台的 Host 业务层：动作分发、凭据读写、access_token 缓存，
 * 以及把微信接口错误翻译成面向用户的中文提示。
 *
 * 每个动作接收一个 payload 对象，成功时返回 JSON 值；业务失败抛
 * StudioError（带 code 与 message），由 HTTP 层转成统一响应。
 */

import { createWechatClient, mapWechatError, WechatApiError, isTokenInvalidError } from './wechat.js'
import { createAiEditor } from './ai.js'

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
export function createStudioService({ ctx, fetchImpl = fetch } = {}) {
  if (ctx === undefined || ctx === null) throw new TypeError('createStudioService 需要 Cordis 上下文')
  const ai = createAiEditor({ ctx })
  const client = createWechatClient({ fetchImpl })

  /** appId → { token, expiresAt, expiresIn } */
  const tokenCache = new Map()
  /** appId → 正在进行的取 token Promise，合并并发请求 */
  const tokenPending = new Map()

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

  /** 读取已保存的公众号凭据。 */
  async function readAccount({ required }) {
    const service = credentials()
    let record
    try {
      record = await service.readRecord(CREDENTIALS_KEY)
    } catch (error) {
      throw new StudioError('credentials-unavailable', `读取本机保存的公众号密钥失败：${error instanceof Error ? error.message : String(error)}`)
    }
    const account = parseAccountRecord(record)
    if (account === null && required) {
      throw new StudioError('not-configured', '还没有配置公众号 AppID 和 AppSecret，请先在设置里填写并保存')
    }
    return account
  }

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

  /** 流式读取响应体并计数，超过 5MB 立刻停止。 */
  async function readBoundedImageBody(response, rawUrl) {
    const chunks = []
    let total = 0
    const take = (chunk) => {
      const view = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
      total += view.byteLength
      if (total > REMOTE_IMAGE_MAX_BYTES) throw tooLargeRemoteImage(rawUrl, total)
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
      if (buffer.length > REMOTE_IMAGE_MAX_BYTES) throw tooLargeRemoteImage(rawUrl, buffer.length)
      chunks.push(buffer)
      total = buffer.length
    }
    if (total === 0) throw new StudioError('image-fetch-failed', `下载图片失败（${rawUrl}）：图片内容是空的`)
    return new Uint8Array(Buffer.concat(chunks, total))
  }

  return {
    /** 当前配置状态。 */
    async status() {
      const account = await readAccount({ required: false })
      if (account === null) return { configured: false, appIdPreview: null, tokenCached: false }
      return {
        configured: true,
        appIdPreview: previewAppId(account.appId),
        tokenCached: cachedToken(account.appId) !== undefined,
      }
    },

    /** 保存 AppID / AppSecret 到本机凭据库。 */
    async saveConfig(payload = {}) {
      const appId = normalizeAppId(payload?.appId)
      const appSecret = normalizeAppSecret(payload?.appSecret)
      const service = credentials()
      const record = { kind: 'api-key', key: JSON.stringify({ appId, appSecret }) }
      try {
        await service.modifyRecord(CREDENTIALS_KEY, async () => record)
      } catch (error) {
        throw new StudioError('credentials-unavailable', `保存公众号密钥失败：${error instanceof Error ? error.message : String(error)}`)
      }
      tokenCache.clear()
      tokenPending.clear()
      return { configured: true, appIdPreview: previewAppId(appId) }
    },

    /** 删除本机保存的公众号密钥。 */
    async clearConfig() {
      const service = credentials()
      try {
        await service.deleteRecord(CREDENTIALS_KEY)
      } catch (error) {
        throw new StudioError('credentials-unavailable', `清除公众号密钥失败：${error instanceof Error ? error.message : String(error)}`)
      }
      tokenCache.clear()
      tokenPending.clear()
      return { configured: false }
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

    /** 新建草稿，按微信限制截断标题/作者/摘要并返回 warnings。 */
    async createDraft(payload = {}) {
      const account = await readAccount({ required: true })
      const warnings = []

      let title = typeof payload?.title === 'string' ? payload.title.trim() : ''
      if (title === '') throw new StudioError('title-required', '标题不能为空，请先填写文章标题')
      if (textLength(title) > 64) {
        warnings.push(`标题超过微信 64 字上限，已截断为前 64 字`)
        title = truncateText(title, 64)
      }

      const content = typeof payload?.content === 'string' ? payload.content : ''
      if (content.trim() === '') throw new StudioError('content-required', '正文内容是空的，请先写好文章内容再保存草稿')

      const thumbMediaId = typeof payload?.thumbMediaId === 'string' ? payload.thumbMediaId.trim() : ''
      if (thumbMediaId === '') {
        throw new StudioError('cover-required', '缺少封面图。请先在发布面板生成或上传封面，再保存草稿')
      }

      let author = typeof payload?.author === 'string' ? payload.author.trim() : ''
      if (author !== '' && textLength(author) > 8) {
        author = truncateText(author, 8)
        warnings.push(`作者名超过微信 8 字上限，已截断为「${author}」`)
      }

      let digest = typeof payload?.digest === 'string' ? payload.digest.trim() : ''
      if (digest !== '' && textLength(digest) > 120) {
        digest = truncateText(digest, 120)
        warnings.push('摘要超过微信 120 字上限，已截断为前 120 字')
      }

      const contentSourceUrl = typeof payload?.contentSourceUrl === 'string' ? payload.contentSourceUrl.trim() : ''

      const article = {
        article_type: 'news',
        title,
        content,
        thumb_media_id: thumbMediaId,
        need_open_comment: 0,
        only_fans_can_comment: 0,
      }
      if (author !== '') article.author = author
      if (digest !== '') article.digest = digest
      if (contentSourceUrl !== '') article.content_source_url = contentSourceUrl

      return wechatCall(async () => {
        const result = await withToken(account, (token) => client.createDraft({ accessToken: token, article }))
        return { mediaId: result.mediaId, warnings }
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
