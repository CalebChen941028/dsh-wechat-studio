/**
 * 微信公众号排版工作台 —— Host 半部入口。
 *
 * 往 DSH 的 WebServer 上注册一个本地 HTTP 路由 `/wechat-studio/api`，
 * 浏览器端把 { action, ...payload } POST 过来，这里做协议检查、来源检查，
 * 再把动作交给 host/service.js，最后统一包成 { ok, value } / { ok, code, message }。
 */

import { createAiEditor } from './host/ai.js'
import { createDraftTool } from './host/tool-draft.js'
import { createStudioService, StudioError } from './host/service.js'
import { WechatApiError } from './host/wechat.js'
import { HttpError, readJsonBody, rejectCrossSite, sendJson, toErrorResponse } from './host/http.js'

/** 这个插件依赖 DSH 的浏览器 HTTP 服务。 */
export const inject = ['webServer']

/** 路由路径。 */
const API_PATH = '/wechat-studio/api'

/** 请求体上限 32 MiB：正文里可能带多张 base64 图片。 */
const MAX_BODY_BYTES = 32 * 1024 * 1024

/** 允许的动作名，避免把任意属性当成方法调用。 */
const KNOWN_ACTIONS = new Set([
  'status',
  'saveConfig',
  'clearConfig',
  'testConnection',
  'networkStatus',
  'saveNetwork',
  'probeNetwork',
  'uploadImages',
  'importImages',
  'uploadCover',
  'createDraft',
  'listDrafts',
  'getDraft',
  'deleteDraft',
  'publish',
  'publishStatus',
  'aiEdit',
  'aiEditStream',
])

/** 读单个请求头。 */
function readHeader(headers, name) {
  const value = headers?.[name]
  return Array.isArray(value) ? value[0] : typeof value === 'string' ? value : undefined
}

/**
 * 把请求体解析成动作与参数。
 * 浏览器端发的是扁平的 `{ action, ...payload }`，这里也接受
 * `{ action, payload: {...} }` 的嵌套写法，两种都能用。
 */
function parseEnvelope(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new StudioError('bad-request', '请求体必须是 JSON 对象，例如 { "action": "status" }')
  }
  const action = typeof body.action === 'string' ? body.action.trim() : ''
  if (action === '') {
    throw new StudioError('bad-request', '请求里缺少 action 字段，无法判断要执行哪个动作')
  }
  if (!KNOWN_ACTIONS.has(action)) {
    throw new StudioError('unknown-action', `不支持的动作：${action}`)
  }
  const nested = body.payload
  if (nested !== undefined && nested !== null && typeof nested === 'object' && !Array.isArray(nested)) {
    const { payload: _ignored, action: _action, ...rest } = body
    const payload = Object.keys(rest).length === 0 ? nested : { ...nested, ...rest }
    return { action, payload }
  }
  const { action: _action, ...rest } = body
  return { action, payload: rest }
}

/**
 * 插件入口：注册路由，返回 disposer 由 ctx.effect 管理。
 * @param {object} ctx Cordis 上下文。
 * @param {object} [config] 插件配置（当前没有配置项）。
 */
export function apply(ctx, config) {
  void config
  const studio = createStudioService({ ctx })
  const ai = createAiEditor({ ctx })

  /**
   * AI 流式进度：先把响应切到 SSE，再按生成字数推事件，最后给最终结果。
   * 只用于面板的对话/精排；工具调用仍走普通 aiEdit。
   */
  const handleAiStream = async (res, payload) => {
    res.statusCode = 200
    res.setHeader('content-type', 'text/event-stream; charset=utf-8')
    res.setHeader('cache-control', 'no-cache')
    res.setHeader('connection', 'keep-alive')
    res.setHeader('x-accel-buffering', 'no')
    if (typeof res.flushHeaders === 'function') res.flushHeaders()
    const send = (event) => {
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`)
      } catch {
        // The page went away; nothing else to do.
      }
    }
    let lastReported = 0
    try {
      const value = await ai.edit(payload, {
        onDelta: (chars) => {
          if (chars - lastReported >= 240) {
            lastReported = chars
            send({ type: 'progress', chars })
          }
        },
      })
      send({ type: 'done', value })
    } catch (error) {
      send({
        type: 'error',
        code: error !== null && typeof error === 'object' && typeof error.code === 'string' ? error.code : 'ai-failed',
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      res.end()
    }
  }

  /** 执行一个动作并把结果写成统一响应。 */
  const handleAction = async (req, res) => {
    let body
    try {
      body = await readJsonBody(req, { maxBytes: MAX_BODY_BYTES })
    } catch (error) {
      const response = toErrorResponse(error)
      sendJson(res, response.status, response.body)
      return
    }

    let action
    let payload
    try {
      const envelope = parseEnvelope(body)
      action = envelope.action
      payload = envelope.payload
    } catch (error) {
      const response = toErrorResponse(error)
      sendJson(res, response.status, response.body)
      return
    }

    if (action === 'aiEditStream') {
      await handleAiStream(res, payload)
      return
    }

    try {
      const value = await studio[action](payload)
      sendJson(res, 200, { ok: true, value: value === undefined ? null : value })
    } catch (error) {
      if (error instanceof StudioError || error instanceof WechatApiError || error instanceof HttpError) {
        const response = toErrorResponse(error)
        sendJson(res, response.status, response.body)
        return
      }
      console.error('[wechat-studio] 动作执行时出现未预期错误：', error)
      sendJson(res, 200, { ok: false, code: 'internal', message: '插件内部错误，请查看 DSH 日志排查' })
    }
  }

  /** Node 原生请求处理函数。 */
  const handler = async (req, res) => {
    try {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, code: 'method-not-allowed', message: '这个接口只接受 POST 请求' })
        return
      }
      const contentType = readHeader(req.headers, 'content-type')
      if (contentType === undefined || !/^application\/json(?:\s*;|$)/i.test(contentType.trim())) {
        sendJson(res, 415, { ok: false, code: 'unsupported-media-type', message: '请求的 Content-Type 必须是 application/json' })
        return
      }
      const rejection = rejectCrossSite(req, ctx)
      if (rejection !== undefined) {
        sendJson(res, rejection.status, { ok: false, code: rejection.code, message: rejection.message })
        return
      }
      await handleAction(req, res)
    } catch (error) {
      console.error('[wechat-studio] 处理请求时出现未预期错误：', error)
      if (res.headersSent !== true) {
        sendJson(res, 200, { ok: false, code: 'internal', message: '插件内部错误，请查看 DSH 日志排查' })
      }
    }
  }

  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: API_PATH, handler }), 'wechat-studio: api route')

  // The same AI pipeline the panel uses is exposed as a tool, so an Agent can
  // edit an article without switching to the panel.
  const tools = ctx.get('tools')
  if (tools !== undefined && tools !== null && typeof tools.register === 'function') {
    const definition = {
      name: 'wechat_studio_ai_edit',
      description: 'Edit a WeChat article draft from a natural-language instruction: rewrite copy, pick a theme, or tune the layout. Returns the full revised Markdown plus any theme change; nothing is published.',
      parameters: {
        type: 'object',
        properties: {
          instruction: { type: 'string', description: 'What to change, in the user\'s words, e.g. "标题更有冲击力" or "换成暖色主题".' },
          markdown: { type: 'string', description: 'The complete current article source in Markdown.' },
          themeId: { type: 'string', description: 'Current theme id (ink, paper, pine, ocean, magazine, rose, amber, night, festival, scholar, mint, mono).' },
          variantId: { type: 'string', description: 'Current variant id inside that theme.' },
          title: { type: 'string', description: 'Current title field, when the Markdown has no H1.' },
          author: { type: 'string', description: 'Current author byline.' },
        },
        required: ['instruction', 'markdown'],
      },
      output: {
        schema: { type: 'object' },
        render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute(args) {
        try {
          return await ai.edit({
            instruction: String(args?.instruction ?? ''),
            text: String(args?.markdown ?? ''),
            title: typeof args?.title === 'string' ? args.title : '',
            design: {
              themeId: typeof args?.themeId === 'string' ? args.themeId : 'ink',
              variantId: typeof args?.variantId === 'string' ? args.variantId : 'editorial',
            },
            meta: { author: typeof args?.author === 'string' ? args.author : '' },
            history: [],
          })
        } catch (error) {
          throw new StudioError(
            error !== null && typeof error === 'object' && typeof error.code === 'string' ? error.code : 'ai-failed',
            error instanceof Error ? error.message : String(error),
          )
        }
      },
    }
    try {
      ctx.effect(() => tools.register(definition), 'wechat-studio: ai edit tool')
    } catch (error) {
      console.error('[wechat-studio] AI 工具注册失败，面板功能不受影响：', error)
    }

    /** Convert one expected failure into the StudioError the registry renders. */
    const asStudioError = (error) => new StudioError(
      error !== null && typeof error === 'object' && typeof error.code === 'string' ? error.code : 'wechat-studio-failed',
      error instanceof Error ? error.message : String(error),
    )

    const statusTool = {
      name: 'wechat_studio_status',
      description: 'Check the WeChat Official Account credentials saved in this profile, and optionally request a fresh access_token to verify the AppID, AppSecret and IP whitelist.',
      parameters: {
        type: 'object',
        properties: {
          testConnection: { type: 'boolean', description: 'Also request a fresh access_token to verify the credentials and IP whitelist.' },
        },
      },
      output: {
        schema: { type: 'object' },
        render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute(args) {
        try {
          const status = await studio.status()
          if (args?.testConnection !== true) return status
          const connection = await studio.testConnection()
          return { ...status, connection }
        } catch (error) {
          throw asStudioError(error)
        }
      },
    }
    try {
      ctx.effect(() => tools.register(statusTool), 'wechat-studio: status tool')
    } catch (error) {
      console.error('[wechat-studio] 状态工具注册失败，面板功能不受影响：', error)
    }

    try {
      ctx.effect(() => tools.register(createDraftTool({ service: studio, StudioError })), 'wechat-studio: draft tool')
    } catch (error) {
      console.error('[wechat-studio] 草稿工具注册失败，面板功能不受影响：', error)
    }
  }
}
