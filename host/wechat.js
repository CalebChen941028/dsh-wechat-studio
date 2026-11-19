/**
 * 微信公众平台接口封装（Host 半部底层）。
 *
 * 微信接口的特点：HTTP 状态几乎总是 200，真正的错误放在响应 JSON 的
 * errcode / errmsg 里；因此每个方法都检查 errcode，并统一抛 WechatApiError。
 * 所有请求都带超时（默认 20 秒），网络层失败也归到同一个错误类型，
 * 方便上层用法一致。
 */

/** 微信接口根地址。 */
export const WECHAT_API_BASE = 'https://api.weixin.qq.com'

/** 单次请求微信接口的超时时间。 */
export const DEFAULT_TIMEOUT_MS = 20000

/** access_token 失效类错误码；收到这些错误时上层会清缓存重取一次。 */
export const TOKEN_INVALID_ERRCODES = new Set([40001, 40014, 42001])

/** 常见错误码对应的中文可执行提示。 */
const ERROR_HINTS = new Map([
  [40013, { code: 'invalid-appid', message: 'AppID 不正确，请核对公众号后台 → 设置与开发 → 基本配置 中的 AppID' }],
  [41002, { code: 'invalid-appid', message: 'AppID 不正确，请核对公众号后台 → 设置与开发 → 基本配置 中的 AppID' }],
  [40125, { code: 'invalid-secret', message: 'AppSecret 不正确。注意重置 AppSecret 后旧的立即失效' }],
  [41004, { code: 'invalid-secret', message: 'AppSecret 不正确。注意重置 AppSecret 后旧的立即失效' }],
  [40164, { code: 'ip-not-allowed', message: '当前网络出口 IP 不在公众号 IP 白名单中，请到公众号后台添加后再试' }],
  [45009, { code: 'rate-limited', message: '接口调用频率超限，请稍后再试' }],
  [45011, { code: 'rate-limited', message: '接口调用频率超限，请稍后再试' }],
  [48001, { code: 'api-unauthorized', message: '该公众号没有此接口权限（未认证账号通常没有发布接口）。可以改用「保存到草稿箱」或「复制 HTML」' }],
  [40007, { code: 'invalid-media', message: 'media_id 无效或已过期，请重新上传封面' }],
  [53404, { code: 'account-unverified', message: '公众号未完成认证，无法使用发布接口' }],
  [40048, { code: 'account-unverified', message: '公众号未完成认证，无法使用发布接口' }],
  [40001, { code: 'token-invalid', message: 'access_token 已失效，已尝试重新获取' }],
  [40014, { code: 'token-invalid', message: 'access_token 已失效，已尝试重新获取' }],
  [42001, { code: 'token-invalid', message: 'access_token 已失效，已尝试重新获取' }],
])

/** 微信接口错误。errcode 为 null 时表示网络或响应格式问题。 */
export class WechatApiError extends Error {
  /**
   * @param {object} init 错误信息。
   * @param {number|null} init.errcode 微信 errcode；网络/格式问题为 null。
   * @param {string} init.errmsg 微信 errmsg 或本地说明。
   * @param {string} init.endpoint 出错的接口路径。
   * @param {'api'|'network'|'response'} [init.kind] 错误类别。
   * @param {unknown} [init.cause] 原始异常。
   */
  constructor({ errcode = null, errmsg = '', endpoint = 'unknown', kind = 'api', cause } = {}) {
    super(`wechat ${endpoint} ${errcode === null ? kind : `errcode ${errcode}`}: ${errmsg}`)
    this.name = 'WechatApiError'
    this.errcode = errcode
    this.errmsg = errmsg
    this.endpoint = endpoint
    this.kind = kind
    if (cause !== undefined) this.cause = cause
  }
}

/** 是否属于「token 失效，需要清缓存重试」的错误。 */
export function isTokenInvalidError(error) {
  return error instanceof WechatApiError && TOKEN_INVALID_ERRCODES.has(error.errcode)
}

/** 从微信 errmsg 里取出点分十进制 IP，例如 invalid ip 1.2.3.4, not in whitelist。 */
function extractIp(errmsg) {
  const match = /(\d{1,3}(?:\.\d{1,3}){3})/.exec(typeof errmsg === 'string' ? errmsg : '')
  return match === null ? '' : match[1]
}

/**
 * 把微信错误翻译成前端可以直接显示的中文提示。
 * @param {unknown} error 抛出的错误。
 * @returns {{ code: string, message: string, detail?: object }} 错误码与中文提示。
 */
export function mapWechatError(error) {
  if (!(error instanceof WechatApiError)) {
    const reason = error instanceof Error ? error.message : String(error)
    return { code: 'internal', message: `微信接口调用失败：${reason}` }
  }
  const location = { endpoint: error.endpoint, errcode: error.errcode, errmsg: error.errmsg }
  if (error.kind === 'network') {
    return {
      code: 'network-error',
      message: '无法连接微信服务器，请检查网络后重试',
      detail: { endpoint: error.endpoint, reason: error.errmsg },
    }
  }
  if (error.kind === 'response') {
    return {
      code: 'wechat-bad-response',
      message: `微信接口返回的数据不完整：${error.errmsg}`,
      detail: location,
    }
  }
  const hint = error.errcode === null ? undefined : ERROR_HINTS.get(error.errcode)
  if (hint !== undefined) {
    if (error.errcode === 40164) {
      const ip = extractIp(error.errmsg)
      return {
        code: 'ip-not-allowed',
        message: `当前网络出口 IP 不在公众号 IP 白名单中${ip === '' ? '' : `（微信识别到的出口 IP：${ip}）`}。到 公众号后台 → 设置与开发 → 基本配置 → IP白名单 添加后再试`,
        detail: { ...location, ip: ip === '' ? undefined : ip },
      }
    }
    return { code: hint.code, message: hint.message, detail: location }
  }
  return {
    code: `wechat-${error.errcode}`,
    message: `微信接口返回错误（errcode=${error.errcode}）：${error.errmsg === '' ? '没有错误说明' : error.errmsg}`,
    detail: location,
  }
}

/** 判断异常是不是超时。 */
function isTimeoutError(error) {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
}

/** 解析 JSON 文本，解析失败返回 undefined。 */
function parseJsonText(text) {
  const trimmed = typeof text === 'string' ? text.trim() : ''
  if (trimmed === '') return {}
  try {
    return JSON.parse(trimmed)
  } catch {
    return undefined
  }
}

/** 给地址补上 access_token 查询参数。 */
function withAccessToken(url, accessToken) {
  const target = new URL(url)
  target.searchParams.set('access_token', accessToken)
  return target.toString()
}

/** 把文件名整理成微信能识别的形式（扩展名与 MIME 对齐）。 */
function normalizeFilename(filename, mimeType) {
  const extension = mimeType === 'image/png' ? '.png' : mimeType === 'image/jpeg' ? '.jpg' : ''
  const raw = typeof filename === 'string' ? filename.trim() : ''
  const base = raw.replace(/[\\/:*?"<>|\s]/g, '')
  if (base === '') return `image${extension}`
  const stem = base.replace(/\.[A-Za-z0-9]{1,5}$/, '')
  return `${stem === '' ? 'image' : stem}${extension}`
}

/**
 * 创建微信接口客户端。
 * @param {object} [options] 注入项。
 * @param {typeof fetch} [options.fetchImpl] fetch 实现，测试时替换。
 * @param {number} [options.timeoutMs] 单次请求超时毫秒数，默认 20 秒。
 * @returns {object} 微信接口方法集合。
 */
export function createWechatClient({ fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('createWechatClient 需要一个可用的 fetch 实现')

  /**
   * 发起一次请求并把微信响应解析成 JSON，errcode 非 0 时抛错。
   * @param {object} request 请求参数。
   * @param {string} request.url 完整地址（含查询参数）。
   * @param {string} [request.method] HTTP 方法。
   * @param {BodyInit} [request.body] 请求体。
   * @param {Record<string,string>} [request.headers] 请求头。
   * @param {string} request.endpoint 接口路径，仅用于错误信息。
   * @returns {Promise<object>} 微信返回的 JSON 对象。
   */
  async function call({ url, method = 'GET', body, headers, endpoint }) {
    let response
    try {
      response = await fetchImpl(url, {
        method,
        ...(body === undefined ? {} : { body }),
        ...(headers === undefined ? {} : { headers }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      const reason = isTimeoutError(error)
        ? `请求微信接口超时（${Math.round(timeoutMs / 1000)} 秒）`
        : `网络请求失败：${error instanceof Error ? error.message : String(error)}`
      throw new WechatApiError({ errcode: null, errmsg: reason, endpoint, kind: 'network', cause: error })
    }

    let text
    try {
      text = await response.text()
    } catch (error) {
      throw new WechatApiError({
        errcode: null,
        errmsg: `读取微信响应失败：${error instanceof Error ? error.message : String(error)}`,
        endpoint,
        kind: 'network',
        cause: error,
      })
    }

    const data = parseJsonText(text)
    if (data !== undefined && data !== null && typeof data === 'object' && typeof data.errcode === 'number' && data.errcode !== 0) {
      throw new WechatApiError({
        errcode: data.errcode,
        errmsg: typeof data.errmsg === 'string' ? data.errmsg : '',
        endpoint,
      })
    }
    if (!response.ok) {
      throw new WechatApiError({
        errcode: null,
        errmsg: `微信返回 HTTP ${response.status}：${text.slice(0, 200)}`,
        endpoint,
        kind: 'network',
      })
    }
    if (data === undefined) {
      throw new WechatApiError({
        errcode: null,
        errmsg: `微信返回了无法解析的内容：${text.slice(0, 200)}`,
        endpoint,
        kind: 'response',
      })
    }
    return data === null ? {} : data
  }

  /** 检查必须存在的 access_token。 */
  function requireToken(accessToken, endpoint) {
    if (typeof accessToken !== 'string' || accessToken === '') {
      throw new WechatApiError({ errcode: null, errmsg: '缺少 access_token，无法调用接口', endpoint, kind: 'response' })
    }
  }

  /** 解析必须存在的字符串字段。 */
  function requireStringField(data, field, endpoint, description) {
    const value = data[field]
    if (typeof value !== 'string' || value === '') {
      throw new WechatApiError({ errcode: null, errmsg: `微信没有返回${description}（${field}）`, endpoint, kind: 'response' })
    }
    return value
  }

  /** Normalize a token response from either token endpoint. */
  function readToken(data, endpoint) {
    const accessToken = requireStringField(data, 'access_token', endpoint, 'access_token')
    const rawExpiresIn = Number(data.expires_in)
    const expiresIn = Number.isFinite(rawExpiresIn) && rawExpiresIn > 0 ? rawExpiresIn : 7200
    return { accessToken, expiresIn }
  }

  /** Credential or account problems are final; anything else may mean the endpoint is unavailable. */
  function shouldFallbackToLegacyToken(error) {
    if (!(error instanceof WechatApiError)) return true
    if (error.kind !== 'api') return true
    // 40164 (IP whitelist) is worth a legacy retry: some accounts only serve one
    // of the two token endpoints. The legacy call repeats the same check, so a
    // real whitelist problem still surfaces with the same message.
    const finalErrcodes = new Set([40013, 41002, 40125, 41004, 45009, 45011, 48001, 53404, 40048])
    return !finalErrcodes.has(error.errcode)
  }

  return {
    /**
     * 获取 access_token。
     * @param {{ appId: string, appSecret: string }} account 公众号凭据。
     * @returns {Promise<{ accessToken: string, expiresIn: number }>} token 与有效期秒数。
     */
    async getAccessToken({ appId, appSecret } = {}) {
      const account = {
        appid: typeof appId === 'string' ? appId : '',
        secret: typeof appSecret === 'string' ? appSecret : '',
      }
      // `stable_token` is the endpoint WeChat recommends when several systems
      // share one account: with force_refresh=false it returns the live token
      // instead of invalidating another caller's token. Fall back to the
      // legacy endpoint when an older account or gateway does not serve it.
      try {
        const data = await call({
          url: `${WECHAT_API_BASE}/cgi-bin/stable_token`,
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ grant_type: 'client_credential', ...account, force_refresh: false }),
          endpoint: 'cgi-bin/stable_token',
        })
        return readToken(data, 'cgi-bin/stable_token')
      } catch (error) {
        if (!shouldFallbackToLegacyToken(error)) throw error
      }
      const endpoint = 'cgi-bin/token'
      const query = new URLSearchParams({
        grant_type: 'client_credential',
        appid: account.appid,
        secret: account.secret,
      })
      const data = await call({ url: `${WECHAT_API_BASE}/${endpoint}?${query.toString()}`, endpoint })
      return readToken(data, endpoint)
    },

    /**
     * 上传正文图片（不占用素材库额度），返回微信 CDN 地址。
     * @param {{ accessToken: string, bytes: Uint8Array, mimeType: string, filename?: string }} input 图片数据。
     * @returns {Promise<{ url: string }>} 微信图片地址。
     */
    async uploadContentImage({ accessToken, bytes, mimeType, filename } = {}) {
      const endpoint = 'cgi-bin/media/uploadimg'
      requireToken(accessToken, endpoint)
      const form = new FormData()
      form.append('media', new Blob([bytes], { type: mimeType }), normalizeFilename(filename, mimeType))
      const data = await call({
        url: withAccessToken(`${WECHAT_API_BASE}/${endpoint}`, accessToken),
        method: 'POST',
        body: form,
        endpoint,
      })
      return { url: requireStringField(data, 'url', endpoint, '图片地址') }
    },

    /**
     * 上传永久图片素材，返回 media_id 与预览地址（用作草稿封面）。
     * @param {{ accessToken: string, bytes: Uint8Array, mimeType: string, filename?: string }} input 图片数据。
     * @returns {Promise<{ mediaId: string, url: string }>} 素材 id 与预览地址。
     */
    async uploadPermanentImage({ accessToken, bytes, mimeType, filename } = {}) {
      const endpoint = 'cgi-bin/material/add_material'
      requireToken(accessToken, endpoint)
      const form = new FormData()
      form.append('media', new Blob([bytes], { type: mimeType }), normalizeFilename(filename, mimeType))
      const data = await call({
        url: withAccessToken(`${WECHAT_API_BASE}/${endpoint}?type=image`, accessToken),
        method: 'POST',
        body: form,
        endpoint,
      })
      const mediaId = requireStringField(data, 'media_id', endpoint, '素材 media_id')
      return { mediaId, url: typeof data.url === 'string' ? data.url : '' }
    },

    /**
     * 新建公众号草稿。
     * @param {{ accessToken: string, article?: object, articles?: object[] }} input 单篇或多篇文章内容。
     * @returns {Promise<{ mediaId: string }>} 草稿的 media_id。
     */
    async createDraft({ accessToken, article, articles } = {}) {
      const endpoint = 'cgi-bin/draft/add'
      requireToken(accessToken, endpoint)
      const list = Array.isArray(articles) ? articles : (article === undefined ? [] : [article])
      if (list.length === 0) {
        throw new WechatApiError({ errcode: null, errmsg: '草稿里没有文章内容', endpoint, kind: 'response' })
      }
      const data = await call({
        url: withAccessToken(`${WECHAT_API_BASE}/${endpoint}`, accessToken),
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ articles: list }),
        endpoint,
      })
      return { mediaId: requireStringField(data, 'media_id', endpoint, '草稿 media_id') }
    },

    /**
     * 读取公众号草稿箱。
     * @param {{ accessToken: string, offset?: number, count?: number }} input 分页参数。
     * @returns {Promise<{ totalCount: number, items: Array<object> }>} 草稿摘要。
     */
    async listDrafts({ accessToken, offset = 0, count = 10 } = {}) {
      const endpoint = 'cgi-bin/draft/batchget'
      requireToken(accessToken, endpoint)
      const data = await call({
        url: withAccessToken(`${WECHAT_API_BASE}/${endpoint}`, accessToken),
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ offset, count, no_content: 0 }),
        endpoint,
      })
      const items = Array.isArray(data.item) ? data.item : []
      return {
        totalCount: Number(data.total_count) || 0,
        items: items.map((item) => {
          const news = item?.content?.news_item?.[0] ?? {}
          return {
            mediaId: typeof item.media_id === 'string' ? item.media_id : '',
            title: typeof news.title === 'string' ? news.title : '',
            digest: typeof news.digest === 'string' ? news.digest : '',
            updateTime: Number(item.update_time) || 0,
          }
        }).filter(item => item.mediaId !== ''),
      }
    },

    /**
     * 删除一篇草稿。
     * @param {{ accessToken: string, mediaId: string }} input 草稿 media_id。
     * @returns {Promise<{ deleted: true }>} 删除结果。
     */
    async deleteDraft({ accessToken, mediaId } = {}) {
      const endpoint = 'cgi-bin/draft/delete'
      requireToken(accessToken, endpoint)
      if (typeof mediaId !== 'string' || mediaId === '') {
        throw new WechatApiError({ errcode: null, errmsg: '缺少草稿 media_id', endpoint, kind: 'response' })
      }
      await call({
        url: withAccessToken(`${WECHAT_API_BASE}/${endpoint}`, accessToken),
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ media_id: mediaId }),
        endpoint,
      })
      return { deleted: true }
    },

    /**
     * 提交发布任务。
     * @param {{ accessToken: string, mediaId: string }} input 草稿 media_id。
     * @returns {Promise<{ publishId: string }>} 发布任务 id。
     */
    async submitPublish({ accessToken, mediaId } = {}) {
      const endpoint = 'cgi-bin/freepublish/submit'
      requireToken(accessToken, endpoint)
      const data = await call({
        url: withAccessToken(`${WECHAT_API_BASE}/${endpoint}`, accessToken),
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ media_id: mediaId }),
        endpoint,
      })
      return { publishId: requireStringField(data, 'publish_id', endpoint, '发布任务 id') }
    },

    /**
     * 查询发布任务状态，返回微信原始 JSON。
     * @param {{ accessToken: string, publishId: string }} input 发布任务 id。
     * @returns {Promise<object>} 微信原始响应。
     */
    async getPublishStatus({ accessToken, publishId } = {}) {
      const endpoint = 'cgi-bin/freepublish/get'
      requireToken(accessToken, endpoint)
      return await call({
        url: withAccessToken(`${WECHAT_API_BASE}/${endpoint}`, accessToken),
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ publish_id: publishId }),
        endpoint,
      })
    },
  }
}
