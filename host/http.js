/**
 * HTTP 协议层工具：读 JSON 请求体、写 JSON 响应、同源信任检查、错误转响应。
 *
 * 这个路由挂在本地 WebServer 上，任何本机进程都能访问，所以除了请求格式
 * 还要做来源检查：DSH 连接层先检查一遍，这里再用插件自己的请求头和
 * Origin/Host 对比兜一层，挡住跨站页面和 DNS rebinding。
 */

import { WechatApiError, mapWechatError } from './wechat.js'
import { StudioError } from './service.js'

/** 协议层错误：带 HTTP 状态码，直接作为响应状态使用。 */
export class HttpError extends Error {
  /**
   * @param {number} statusCode HTTP 状态码。
   * @param {string} code 机器可读错误码。
   * @param {string} message 面向用户的中文说明。
   */
  constructor(statusCode, code, message) {
    super(message)
    this.name = 'HttpError'
    this.statusCode = statusCode
    this.code = code
  }
}

/** 本机回环主机名：只接受这三种写法。 */
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

/** 读取单个请求头（Node 把小写键放在 req.headers，值可能是字符串数组）。 */
function readHeader(headers, name) {
  if (headers === undefined || headers === null) return undefined
  const value = headers[name] ?? headers[name.toLowerCase()]
  if (Array.isArray(value)) return value[0]
  return typeof value === 'string' ? value : undefined
}

/** 解析 `host:port` 形式的 authority，失败返回 undefined。 */
function parseAuthority(authority) {
  if (typeof authority !== 'string' || authority.trim() === '') return undefined
  try {
    return new URL(`http://${authority.trim()}`)
  } catch {
    return undefined
  }
}

/**
 * 读取请求体并解析为 JSON。边读边计数，超过上限立即停止。
 * @param {import('node:http').IncomingMessage} req 请求对象。
 * @param {{ maxBytes?: number }} [options] 上限配置。
 * @returns {Promise<unknown>} 解析后的 JSON 值。
 * @throws {HttpError} 超限时 statusCode 为 413，JSON 非法时 statusCode 为 400。
 */
export function readJsonBody(req, { maxBytes = 32 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    let total = 0
    let settled = false
    const chunks = []

    const fail = (error) => {
      if (settled) return
      settled = true
      // 已经拒绝的请求体不再需要：排空剩余数据，让连接正常关闭。
      req.resume()
      reject(error)
    }

    req.on('data', (chunk) => {
      if (settled) return
      const size = chunk.length
      total += size
      if (total > maxBytes) {
        fail(new HttpError(413, 'payload-too-large', `请求体超过 ${Math.round(maxBytes / 1024 / 1024)}MB 上限，请减少图片数量或压缩后再试`))
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => {
      if (settled) return
      settled = true
      const text = Buffer.concat(chunks).toString('utf8')
      try {
        resolve(JSON.parse(text))
      } catch {
        reject(new HttpError(400, 'bad-json', '请求体不是合法的 JSON'))
      }
    })

    req.on('error', (error) => {
      fail(new HttpError(400, 'request-aborted', `读取请求体失败：${error instanceof Error ? error.message : String(error)}`))
    })

    req.on('aborted', () => {
      fail(new HttpError(400, 'request-aborted', '请求在读取完成前中断了'))
    })
  })
}

/**
 * 写一个 JSON 响应，统一带 no-store，避免浏览器缓存接口结果。
 * @param {import('node:http').ServerResponse} res 响应对象。
 * @param {number} status HTTP 状态码。
 * @param {unknown} value 要序列化的值。
 */
export function sendJson(res, status, value) {
  if (res.headersSent === true || res.writableEnded === true) {
    try {
      res.end()
    } catch {
      // 响应已经结束，忽略。
    }
    return
  }
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
  })
  res.end(body)
}

/** 构造同源检查的拒绝结果。 */
function forbidden(message, status = 403) {
  return { status, code: 'forbidden', message }
}

/**
 * 同源信任检查，返回拒绝信息或 undefined。
 *
 * 两层：先让 DSH 连接层按它自己的策略判断（存在时），再用插件自己的规则
 * 检查自定义请求头、Host、Origin 和 Fetch Metadata。
 * @param {import('node:http').IncomingMessage} req 请求对象。
 * @param {object} ctx Cordis 上下文。
 * @returns {{ status: number, code: string, message: string } | undefined} 拒绝信息。
 */
export function rejectCrossSite(req, ctx) {
  const headers = req?.headers ?? {}

  // 第一层：DSH 连接层的 Host/Origin/浏览器认证检查。
  const connection = typeof ctx?.get === 'function' ? ctx.get('connection') : undefined
  if (connection !== undefined && connection !== null && typeof connection.requestRejection === 'function') {
    let rejection
    try {
      rejection = connection.requestRejection({ headers })
    } catch (error) {
      return forbidden(`连接层没有完成来源检查（${error instanceof Error ? error.message : String(error)}），已拒绝请求`)
    }
    if (typeof rejection === 'number') {
      return {
        status: rejection,
        code: 'forbidden',
        message: rejection === 401
          ? '当前页面没有通过 DSH 连接层的身份校验，请刷新页面后重试'
          : 'DSH 连接层拒绝了这次请求：来源地址或浏览器校验没有通过',
      }
    }
  }

  // 第二层：插件自己的检查。

  // 自定义请求头：跨站页面要带上它必须触发 CORS 预检，而预检会被这里拒绝。
  if (readHeader(headers, 'x-wechat-studio') !== '1') {
    return forbidden('请求缺少 x-wechat-studio: 1 请求头，已拒绝。这个接口只接受插件页面自己的调用')
  }

  const host = readHeader(headers, 'host')
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) {
    return forbidden(`请求缺少合法的 Host 头（${typeof host === 'string' ? host : '空'}），无法确认是本机页面，已拒绝`)
  }
  if (!LOOPBACK_HOSTNAMES.has(hostUrl.hostname.toLowerCase())) {
    return forbidden(`请求的 Host（${host}）不是本机地址（127.0.0.1、localhost 或 [::1]），已拒绝`)
  }

  const site = readHeader(headers, 'sec-fetch-site')
  if (typeof site === 'string') {
    const normalized = site.toLowerCase()
    if (normalized === 'cross-site' || normalized === 'same-site') {
      return forbidden(`请求来自其他站点（sec-fetch-site: ${normalized}），已拒绝`)
    }
  }

  const origin = readHeader(headers, 'origin')
  if (typeof origin === 'string' && origin !== '') {
    if (origin === 'null') {
      return forbidden('请求的 Origin 是 null（不透明来源），已拒绝')
    }
    let originUrl
    try {
      originUrl = new URL(origin)
    } catch {
      return forbidden(`请求的 Origin（${origin}）无法解析，已拒绝`)
    }
    if (originUrl.protocol !== 'http:' && originUrl.protocol !== 'https:') {
      return forbidden(`请求的 Origin（${origin}）不是 http(s) 地址，已拒绝`)
    }
    if (originUrl.host !== hostUrl.host) {
      return forbidden(`请求的 Origin（${origin}）与 Host（${host}）不是同一个地址，已拒绝`)
    }
  }

  return undefined
}

/**
 * 把业务错误转成 `{ status, body }`。业务错误用 200，协议错误保留状态码。
 * @param {unknown} error 抛出的错误。
 * @returns {{ status: number, body: object }} 响应状态与响应体。
 */
export function toErrorResponse(error) {
  if (error instanceof HttpError) {
    return { status: error.statusCode, body: { ok: false, code: error.code, message: error.message } }
  }
  if (error instanceof WechatApiError) {
    const mapped = mapWechatError(error)
    const body = { ok: false, code: mapped.code, message: mapped.message }
    if (mapped.detail !== undefined) body.detail = mapped.detail
    return { status: 200, body }
  }
  if (error instanceof StudioError) {
    const body = { ok: false, code: error.code, message: error.message }
    if (error.detail !== undefined) body.detail = error.detail
    return { status: 200, body }
  }
  const reason = error instanceof Error ? error.message : String(error)
  return { status: 200, body: { ok: false, code: 'internal', message: `插件内部错误：${reason}` } }
}
