// /prd-generator/ 项目工作台（0.5.0）：
// - GET /prd-generator/                单页应用壳（内联 CSS/JS，无前端构建、无外部资源）
// - GET /prd-generator/api/prds        项目列表 JSON
// - GET /prd-generator/api/prds/<id>   单 PRD JSON（prd 结构化 + handoff 门禁评估）
// - GET /prd-generator/p/<id>          旧路由兼容：302 → /prd-generator/#/p/<id>
// - 只读：仅 GET/HEAD；其它 405；未知 id / 路径穿越 404；所有错误给可读 JSON。
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { computeStats } from './prd/schema.js'
import { evaluateHandoff } from './prd/handoff.js'
import { readLedger } from './prd/validate.js'
import { listEntries, readEntry } from './registry.js'

export const BASE = '/prd-generator'
export const MAX_PAGE_BYTES = 2 * 1024 * 1024
const PRD_JSON = 'prd.json'
const ENTRY_ID_RE = /^[0-9a-f]{12}$/
const HTML_HEADERS = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }

const CSS = readFileSync(new URL('./ui/style.css', import.meta.url), 'utf8')
const APP_JS = readFileSync(new URL('./ui/app.js', import.meta.url), 'utf8')

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function strings(value) {
  if (!Array.isArray(value)) return []
  return value.filter((item) => typeof item === 'string' && item.trim())
}

function storiesOf(json) {
  const list = Array.isArray(json?.user_stories) ? json.user_stories : []
  return list
    .filter((story) => story && typeof story === 'object' && !Array.isArray(story))
    .map((story, index) => ({
      id: typeof story.id === 'string' && story.id.trim() ? story.id.trim() : `US-${String(index + 1).padStart(3, '0')}`,
      story: typeof story.story === 'string' ? story.story : '',
      priority: String(story.priority ?? '').toUpperCase(),
      acceptance_criteria: strings(story.acceptance_criteria),
      tasks: strings(story.tasks),
      complexity: typeof story.complexity === 'string' ? story.complexity : '',
    }))
}

function send(res, status, headers, body, { head = false } = {}) {
  try {
    res.writeHead(status, headers)
    res.end(head ? undefined : body)
  } catch {
    try {
      res.end()
    } catch {
      // 连接已关闭，忽略
    }
  }
}

function sendHtml(res, method, html) {
  send(res, 200, HTML_HEADERS, html, { head: method === 'HEAD' })
}

function sendJson(res, method, value, status = 200) {
  send(res, status, JSON_HEADERS, `${JSON.stringify(value)}\n`, { head: method === 'HEAD' })
}

function notFound(res, method = 'GET') {
  sendJson(res, method, { error: 'not_found', message: 'Not Found：未知路径或 id。' }, 404)
}

function methodNotAllowed(res, method) {
  send(
    res,
    405,
    { 'content-type': 'application/json; charset=utf-8', allow: 'GET, HEAD', 'cache-control': 'no-store' },
    `${JSON.stringify({ error: 'method_not_allowed', message: '本页面只读，仅支持 GET/HEAD。' })}\n`,
    { head: method === 'HEAD' },
  )
}

function redirect(res, method, location) {
  send(res, 302, { location, 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' }, `302 → ${location}`, {
    head: method === 'HEAD',
  })
}

export function renderShell() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PRD Creator · 项目工作台</title>
<style>${CSS}</style>
</head>
<body data-base="${BASE}">
<div class="app">
  <div id="topbar" class="topbar"></div>
  <div id="toolbar" class="toolbar"></div>
  <main id="view" class="view" aria-live="polite"></main>
</div>
<div id="toast" class="toast" role="status" aria-live="polite"></div>
<script>${APP_JS}</script>
</body>
</html>`
}

export function listPayload(entries) {
  const ready = entries.filter((entry) => entry.handoff && entry.handoff.ready === true).length
  const pending = entries.filter(
    (entry) => (entry.handoff && entry.handoff.ready === false) || (entry.stats && entry.stats.openQuestions > 0),
  ).length
  return { entries, stats: { total: entries.length, ready, pending } }
}

function buildHandoff(json, dir, prdJsonPath) {
  const path = join(dir, 'handoff.md')
  if (!existsSync(path)) return { exists: false, ready: null, blockers: [], warnings: [], path: null }
  try {
    const evaluation = evaluateHandoff(json, { prdJsonPath })
    return {
      exists: true,
      ready: evaluation.ready,
      blockers: evaluation.blockers,
      warnings: evaluation.warnings,
      path,
    }
  } catch (error) {
    return {
      exists: true,
      ready: null,
      blockers: [],
      warnings: [{ code: 'EVALUATE_FAILED', message: String(error && error.message ? error.message : error), refs: [] }],
      path,
    }
  }
}

function filesPayload(dir) {
  const names = ['prd.md', 'prd.json', 'acceptance.md', 'mindmap.mmd', 'flowchart.mmd', 'handoff.md']
  return names.map((name) => {
    const path = join(dir, name)
    return { name, path, exists: existsSync(path) }
  })
}

function readPrdJson(dir) {
  const prdJsonPath = join(dir, PRD_JSON)
  if (!existsSync(prdJsonPath)) {
    return { error: 'missing', message: `prd.json 不存在：${prdJsonPath}（目录可能已被移动或删除）`, prdJsonPath }
  }
  let raw
  try {
    if (statSync(prdJsonPath).size > MAX_PAGE_BYTES) {
      return { error: 'invalid', message: `prd.json 超过 ${MAX_PAGE_BYTES} 字节，页面不展示`, prdJsonPath }
    }
    raw = readFileSync(prdJsonPath, 'utf8')
  } catch (error) {
    return { error: 'invalid', message: `prd.json 读取失败：${error.message}`, prdJsonPath }
  }
  let json
  try {
    json = JSON.parse(raw)
  } catch (error) {
    return { error: 'invalid', message: `prd.json 不是合法 JSON：${error.message}`, prdJsonPath }
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { error: 'invalid', message: 'prd.json 顶层必须是 JSON 对象', prdJsonPath }
  }
  return { json, prdJsonPath }
}

export function buildDetailPayload(entry) {
  const loaded = readPrdJson(entry.dir)
  if (loaded.error) return { entry, error: loaded.error, message: loaded.message }
  const { json, prdJsonPath } = loaded
  const ledger = readLedger(json)
  const stats = computeStats(json)
  const meta = json._meta && typeof json._meta === 'object' ? json._meta : {}
  const prd = {
    name: String(json.title || json.name || entry.name || '未命名 PRD'),
    title: typeof json.title === 'string' ? json.title : '',
    summary: String(json.description || json.goal || entry.summary || ''),
    generatedAt: typeof meta.generated_at === 'string' ? meta.generated_at : entry.generatedAt,
    template: typeof meta.template === 'string' ? meta.template : '',
    generator: typeof meta.generator === 'string' ? meta.generator : '',
    user_stories: storiesOf(json),
    assumptions: ledger.assumptions,
    open_questions: ledger.openQuestions,
    scope: {
      in_scope: strings(json.scope && json.scope.in_scope),
      out_of_scope: strings(json.scope && json.scope.out_of_scope),
    },
    metrics: Array.isArray(json.metrics) ? json.metrics.filter((item) => item && typeof item === 'object') : [],
    non_functional: strings(json.non_functional),
    tech: strings(json.tech),
  }
  return {
    entry,
    prd,
    stats,
    handoff: buildHandoff(json, entry.dir, prdJsonPath),
    files: filesPayload(entry.dir),
  }
}

/**
 * 创建 /prd-generator/ 的请求处理器（由 ctx.webServer.register 挂载）。
 */
export function createHandler() {
  return function handler(req, res) {
    const method = String(req.method || 'GET').toUpperCase()
    let url
    try {
      url = new URL(req.url || '/', 'http://localhost')
    } catch {
      return notFound(res, method)
    }
    if (typeof url.pathname !== 'string' || !url.pathname.startsWith(BASE)) return notFound(res, method)
    if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed(res, method)

    let rest
    try {
      rest = decodeURIComponent(url.pathname.slice(BASE.length))
    } catch {
      return notFound(res, method)
    }

    if (rest === '' || rest === '/') return sendHtml(res, method, renderShell())

    if (rest === '/api/prds' || rest === '/api/prds/') {
      let entries
      try {
        entries = listEntries()
      } catch {
        entries = []
      }
      return sendJson(res, method, listPayload(entries))
    }

    const apiMatch = rest.match(/^\/api\/prds\/([^/]+)\/?$/)
    if (apiMatch) {
      const id = apiMatch[1]
      if (!ENTRY_ID_RE.test(id)) return notFound(res, method)
      let entry
      try {
        entry = readEntry(id)
      } catch {
        entry = null
      }
      if (!entry) return notFound(res, method)
      return sendJson(res, method, buildDetailPayload(entry))
    }

    // 旧路由兼容：/prd-generator/p/<id> → 302 到单页应用 hash 路由
    const legacyMatch = rest.match(/^\/p\/([^/]+)\/?$/)
    if (legacyMatch) {
      const id = legacyMatch[1]
      if (!ENTRY_ID_RE.test(id)) return notFound(res, method)
      return redirect(res, method, `${BASE}/#/p/${id}`)
    }

    return notFound(res, method)
  }
}
