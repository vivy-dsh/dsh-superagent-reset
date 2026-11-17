/**
 * Superagent 会话重置：排队、盘点、搬移。
 *
 * 「删掉 master 会话」不能在建 host 里做——那条会话日志正是 host 打开着的文件。
 * 所以设置页只写一个排队标记，真正的搬移由启动器在下次 `npm start`、host 还没起来
 * 之前执行。搬移一律是 rename 进 `$DSH_HOME/backups/`，不删，随时能搬回。
 *
 * 范围只有会话与它的两份投影缓存。`orchestrator.sqlite`（工单、设置、提示词修订）、
 * ActMem 记忆卡、人格文件、skills 都不在这套里。
 * @module dsh-superagent-reset/reset
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'

/** 排队标记：存在即表示「下次启动前搬一次」。 */
export const MARKER_FILE = 'superagent-reset.json'
/** 上一次执行结果，设置页用它回显。 */
export const RESULT_FILE = 'superagent-reset.last.json'

const MASTER_SESSION = /^orchestrator-[0-9a-z]+$/

/** `$DSH_HOME` 下的路径集合。 */
function layout(home) {
  return {
    home,
    marker: join(home, MARKER_FILE),
    result: join(home, RESULT_FILE),
    backups: join(home, 'backups'),
    sessions: join(home, 'sessions'),
  }
}

/* 只认含状态目录的那几个工作区；别的普通会话一律不碰。 */
function workspaces(home) {
  const root = layout(home).sessions
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.includes('state-superagent-local'))
    .map(entry => join(root, entry.name))
}

/**
 * 所有 master 会话目录（正常情况下只有一条）。
 * @param home - `$DSH_HOME`。
 * @returns 绝对路径列表。
 */
export function masterSessions(home) {
  const found = []
  for (const workspace of workspaces(home)) {
    for (const entry of readdirSync(workspace, { withFileTypes: true })) {
      if (entry.isDirectory() && MASTER_SESSION.test(entry.name)) found.push(join(workspace, entry.name))
    }
  }
  return found
}

/**
 * 这次会搬走的东西。
 * @param home - `$DSH_HOME`。
 * @returns `{ label, path }` 列表，按会话、投影缓存、洞察缓存的顺序。
 */
export function targets(home) {
  const paths = layout(home)
  const list = []
  const masters = masterSessions(home)
  for (const path of masters) list.push({ label: 'master 会话日志', path })
  for (const path of masters) {
    list.push({ label: '会话投影缓存', path: join(paths.home, 'storages', 'session_projcache', 'sessions', basename(path) + '.json') })
  }
  list.push({ label: '上下文洞察缓存', path: join(paths.home, 'storages', 'dsh-context', 'overview-cache.v1.json') })
  const seen = new Set()
  return list.filter(item => (seen.has(item.path) ? false : seen.add(item.path)))
}

function bytesOf(path) {
  try {
    const info = statSync(path)
    if (info.isFile()) return info.size
    let total = 0
    for (const entry of readdirSync(path, { withFileTypes: true, recursive: true })) {
      if (!entry.isFile()) continue
      try { total += statSync(join(entry.parentPath, entry.name)).size } catch { /* 边算边变的文件就当 0 */ }
    }
    return total
  } catch {
    return 0
  }
}

function readJson(file) {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'))
    return value && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

/**
 * 排队标记。
 * @param home - `$DSH_HOME`。
 * @returns `{ requestedAt }`，没排队时是 `null`。
 */
export function pendingRequest(home) {
  const value = readJson(layout(home).marker)
  return value && typeof value.requestedAt === 'string' ? value : null
}

/**
 * 写排队标记（原子替换）。
 * @param home - `$DSH_HOME`。
 * @param at - ISO 时间。
 * @returns 写入的标记。
 */
export function requestReset(home, at) {
  const paths = layout(home)
  const value = { version: 1, requestedAt: at }
  mkdirSync(home, { recursive: true })
  const stage = paths.marker + '.tmp'
  writeFileSync(stage, JSON.stringify(value))
  renameSync(stage, paths.marker)
  return value
}

/**
 * 取消排队。
 * @param home - `$DSH_HOME`。
 * @returns 是否真的有东西被取消。
 */
export function cancelReset(home) {
  const { marker } = layout(home)
  if (!existsSync(marker)) return false
  rmSync(marker, { force: true })
  return true
}

/**
 * 上一次执行结果。
 * @param home - `$DSH_HOME`。
 * @returns 结果对象，没有则 `null`。
 */
export function lastResult(home) {
  const value = readJson(layout(home).result)
  return value && typeof value.at === 'string' ? value : null
}

function recordResult(home, value) {
  const { result } = layout(home)
  const stage = result + '.tmp'
  writeFileSync(stage, JSON.stringify(value))
  renameSync(stage, result)
}

/**
 * 设置页需要的全部状态。
 * @param home - `$DSH_HOME`。
 * @returns 排队、上次结果、当前目标清单（带体积与是否存在）。
 */
export function describe(home) {
  return {
    pending: pendingRequest(home),
    last: lastResult(home),
    targets: targets(home).map(item => ({
      label: item.label,
      // 只报相对 $DSH_HOME 的路径：绝对路径进了浏览器就等于把用户名写进页面。
      path: relative(home, item.path).split('\\').join('/'),
      exists: existsSync(item.path),
      bytes: bytesOf(item.path),
    })),
  }
}

function stamp(at) {
  return String(at).replace(/\D/g, '').slice(0, 14)
}

/**
 * 真正搬移。调用方必须保证 host 没在跑。
 *
 * 单个目标搬失败不影响其它目标；有失败就保留排队标记，下次启动再试一次。
 * @param home - `$DSH_HOME`。
 * @param at - ISO 时间，用来命名备份目录。
 * @returns 结果对象，与写进 `superagent-reset.last.json` 的一致。
 */
export function applyReset(home, at) {
  const paths = layout(home)
  const backup = join(paths.backups, 'reset-' + stamp(at))
  const moved = []
  const missing = []
  const failures = []
  for (const item of targets(home)) {
    if (!existsSync(item.path)) {
      missing.push(relative(home, item.path).split('\\').join('/'))
      continue
    }
    const destination = join(backup, relative(home, item.path))
    try {
      mkdirSync(dirname(destination), { recursive: true })
      renameSync(item.path, destination)
      moved.push(relative(home, item.path).split('\\').join('/'))
    } catch (error) {
      failures.push({ path: relative(home, item.path).split('\\').join('/'), error: String(error?.message ?? error) })
    }
  }
  const result = { at, ok: failures.length === 0, backup: relative(home, backup).split('\\').join('/'), moved, missing, failures }
  if (result.ok) cancelReset(home)
  recordResult(home, result)
  return result
}
