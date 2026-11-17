/**
 * dsh-superagent-reset — 把「初始化 Superagent 会话」做成一行动作。
 *
 * host 这一半只做三件事：报状态、写排队标记、取消标记。它**不搬文件**——master
 * 会话日志正是 host 打开着的文件。真正的搬移由 `scripts/vivy-dsh.mjs` 在下次
 * `npm start`、host 起来之前执行（`applyReset`）。
 *
 * 路由与校验照 dsh-laputa 的既有写法：只认本机 host、非 GET 要求同源、再过一道
 * `connection.requestRejection`。真正的人为确认在请求体里（`confirm: true`）。
 * @module dsh-superagent-reset
 */

import { cancelReset, describe, pendingRequest, requestReset } from './lib/reset.mjs'

/** Cordis 插件名。 */
export const name = 'dsh-superagent-reset'

/** 路由前缀。客户端与它写死同一个常量。 */
const API_PREFIX = '/dsh-superagent-reset/api'

function send(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

function failure(res, status, message) {
  send(res, status, { ok: false, message })
}

function allowedHost(host) {
  const value = String(host ?? '').toLowerCase()
  return /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(value)
}

function sameOrigin(req) {
  if (req.headers.origin === undefined) return true
  try {
    return new URL(req.headers.origin).host.toLowerCase() === String(req.headers.host).toLowerCase()
  } catch {
    return false
  }
}

async function readBody(req, limit) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk)
    if (size > limit) throw Object.assign(new Error('body too large'), { code: 'BODY_TOO_LARGE' })
    chunks.push(Buffer.from(chunk))
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

function home() {
  const value = process.env.DSH_HOME
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * 挂上设置页用的接口。
 * @param ctx - Cordis 上下文。
 */
export function apply(ctx) {
  const logger = ctx.logger('superagent-reset')
  ctx.inject(['webServer', 'connection'], scope => {
    scope.effect(() => scope.get('webServer').register({
      kind: 'prefix',
      path: API_PREFIX,
      handler: async (req, res) => {
        if (!allowedHost(req.headers.host)) return failure(res, 403, '只接受本机访问')
        if (req.method !== 'GET' && !sameOrigin(req)) return failure(res, 403, '跨站请求被拒绝')

        const connection = scope.get('connection')
        const rejection = typeof connection?.requestRejection === 'function' ? connection.requestRejection(req) : undefined
        if (rejection !== undefined && rejection !== null && rejection !== false) {
          return failure(res, typeof rejection === 'number' ? rejection : 403, '会话未通过验证')
        }

        const root = home()
        if (root === null) return failure(res, 503, 'DSH_HOME 未设置，找不到要清理的会话')

        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        try {
          if (url.pathname === `${API_PREFIX}/status` && req.method === 'GET') {
            send(res, 200, { ok: true, ...describe(root) })
            return
          }
          if (url.pathname === `${API_PREFIX}/queue` && req.method === 'POST') {
            if (!String(req.headers['content-type'] ?? '').toLowerCase().includes('application/json')) {
              return failure(res, 415, '需要 application/json')
            }
            const body = await readBody(req, 4096)
            if (body?.confirm !== true) return failure(res, 400, '缺少明确确认')
            if (pendingRequest(root) === null) requestReset(root, new Date().toISOString())
            logger.info('reset queued; the next npm start moves the master session aside')
            send(res, 200, { ok: true, ...describe(root) })
            return
          }
          if (url.pathname === `${API_PREFIX}/cancel` && req.method === 'POST') {
            cancelReset(root)
            logger.info('queued reset cancelled')
            send(res, 200, { ok: true, ...describe(root) })
            return
          }
          failure(res, 404, '没有这个操作')
        } catch (error) {
          logger.warn(`reset api failed: ${error?.message ?? error}`)
          failure(res, 500, String(error?.message ?? error))
        }
      },
    }), 'superagent-reset: settings api')
  })
}
