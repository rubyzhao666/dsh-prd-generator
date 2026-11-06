// /prd-generator/ 只读页面（0.4.0）：PRD 项目列表 + 单 PRD 详情。
// - 只读：GET/HEAD；其它方法 405；未知 id / 路径穿越 404
// - 列表数据来自 $DSH_HOME/prd-generator/registry.json；详情以磁盘上的 prd.json 为准
// - 所有动态文本一律 HTML 转义；页面不加载任何外部资源（无 script/link/外部图片）
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import {
  ASSUMPTION_IMPACT_LABELS,
  ASSUMPTION_SOURCE_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  stripCheckMarks,
} from './prd/schema.js'
import { evaluateHandoff } from './prd/handoff.js'
import { listEntries, readEntry, registryPath } from './registry.js'

export const BASE = '/prd-generator'
export const MAX_PAGE_BYTES = 2 * 1024 * 1024
const PRD_JSON = 'prd.json'
const ENTRY_ID_RE = /^[0-9a-f]{12}$/
const HTML_HEADERS = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }

// 单字段最大展示长度，防止极端数据把页面撑爆（超出部分截断并提示）。
const MAX_FIELD_CHARS = 2000
const MAX_TABLE_ROWS = 80

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function clipped(value, max = MAX_FIELD_CHARS) {
  const text = String(value ?? '')
  if (text.length <= max) return { text, clipped: false }
  return { text: `${text.slice(0, max)}…`, clipped: true }
}

function escapeField(value, max) {
  return escapeHtml(clipped(value, max).text)
}

function shortTime(value) {
  if (typeof value !== 'string') return ''
  const time = Date.parse(value)
  if (Number.isNaN(time)) return value.slice(0, 16)
  const date = new Date(time)
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function truncatePath(path, max = 64) {
  const text = String(path ?? '')
  if (text.length <= max) return text
  const head = Math.max(12, Math.floor((max - 1) / 2))
  const tail = Math.max(12, max - head - 1)
  return `${text.slice(0, head)}…${text.slice(-tail)}`
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

function notFound(res, method = 'GET') {
  send(res, 404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }, 'Not Found', {
    head: method === 'HEAD',
  })
}

function methodNotAllowed(res, method) {
  send(
    res,
    405,
    { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD', 'cache-control': 'no-store' },
    'Method Not Allowed：PRD 项目页只读，仅支持 GET/HEAD。',
    { head: method === 'HEAD' },
  )
}

const STYLE = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: #0d1117; color: #c9d1d9;
  font: 14px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
}
a { color: #58a6ff; text-decoration: none; }
a:hover { text-decoration: underline; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; background: #161b22; padding: 1px 5px; border-radius: 4px; word-break: break-all; }
h1 { font-size: 22px; margin: 0 0 6px; color: #f0f6fc; }
h2 { font-size: 16px; margin: 26px 0 10px; color: #f0f6fc; }
h3 { font-size: 14px; margin: 18px 0 6px; color: #e6edf3; }
.wrap { max-width: 960px; margin: 0 auto; padding: 28px 20px 56px; }
.prd-header { border-bottom: 1px solid #21262d; padding-bottom: 18px; margin-bottom: 20px; }
.prd-sub { margin: 0 0 12px; color: #8b949e; font-size: 13px; }
.prd-stats { display: flex; gap: 18px; flex-wrap: wrap; margin: 14px 0 6px; color: #8b949e; font-size: 13px; }
.prd-stat strong { color: #f0f6fc; font-weight: 600; }
.prd-list { margin: 10px 0 0; }
.prd-row { display: block; border: 1px solid #21262d; border-radius: 8px; padding: 12px 14px; margin: 8px 0; color: inherit; }
.prd-row:hover { border-color: #30363d; background: #11161d; text-decoration: none; }
.prd-row-title { color: #f0f6fc; font-weight: 600; }
.prd-row-summary { color: #8b949e; font-size: 13px; margin: 4px 0 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.prd-badges { display: flex; gap: 6px; flex-wrap: wrap; margin: 4px 0; }
.prd-badge { display: inline-block; border: 1px solid #30363d; background: #161b22; color: #c9d1d9; border-radius: 999px; padding: 1px 8px; font-size: 12px; }
.prd-badge.ok { border-color: #238636; color: #3fb950; }
.prd-badge.warn { border-color: #9e6a03; color: #d29922; }
.prd-badge.muted { color: #8b949e; }
.prd-row-meta { color: #8b949e; font-size: 12.5px; display: flex; gap: 14px; flex-wrap: wrap; margin-top: 6px; }
.prd-empty { border: 1px dashed #30363d; border-radius: 8px; padding: 20px; color: #8b949e; margin: 18px 0; }
.prd-empty strong { color: #f0f6fc; }
.prd-error { border: 1px solid #f85149; background: rgba(248, 81, 73, .08); color: #ff7b72; padding: 10px 12px; border-radius: 6px; margin: 12px 0; }
.prd-warn { color: #d29922; }
.prd-muted { color: #8b949e; }
.prd-back { display: inline-block; margin-bottom: 14px; font-size: 13px; }
.prd-title { font-size: 22px; margin: 0 0 8px; color: #f0f6fc; }
.prd-meta { color: #8b949e; font-size: 13px; margin: 2px 0; }
.prd-story { border: 1px solid #21262d; border-radius: 8px; padding: 12px 14px; margin: 10px 0; }
.prd-story-id { color: #f0f6fc; font-weight: 600; }
.prd-story-text { margin: 6px 0 10px; color: #c9d1d9; }
.prd-ac-list, .prd-task-list { margin: 6px 0 0; padding-left: 18px; }
.prd-ac { margin: 3px 0; }
.prd-task-list li { color: #8b949e; margin: 2px 0; }
table.prd-table { width: 100%; border-collapse: collapse; margin: 8px 0 4px; font-size: 13px; }
table.prd-table th, table.prd-table td { border: 1px solid #21262d; padding: 6px 8px; text-align: left; vertical-align: top; word-break: break-word; }
table.prd-table th { color: #8b949e; font-weight: 600; background: #11161d; }
.prd-handoff { border: 1px solid #30363d; border-radius: 8px; padding: 14px; margin: 12px 0; }
.prd-handoff h2 { margin-top: 0; }
.prd-handoff.ok { border-color: #238636; }
.prd-handoff.warn { border-color: #9e6a03; }
.prd-truncated { color: #d29922; font-size: 13px; margin: 10px 0; }
.prd-footer { margin-top: 36px; padding-top: 16px; border-top: 1px solid #21262d; color: #8b949e; font-size: 12.5px; }
.prd-path { word-break: break-all; }
`

function htmlDocument(title, body) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
${body}
</div>
</body>
</html>`
}

function footerHtml() {
  return `<footer class="prd-footer">
只读页面 · 数据来自本机 <code class="prd-path">${escapeHtml(registryPath())}</code> · 页面不加载任何外部资源。<br>
生成 / 校验 / 交接仍在对话里完成：直接说「帮我写个需求文档」「这需求现在能开工吗」即可（skill：prd-generator）。
</footer>`
}

function listFooterHtml() {
  return `<footer class="prd-footer">
只读页面 · 生成记录来自本机 <code class="prd-path">${escapeHtml(registryPath())}</code> · 页面不加载任何外部资源。<br>
生成 / 校验 / 交接仍在对话里完成：直接说「帮我写个需求文档」「这需求现在能开工吗」「帮我出一份交接单」即可（skill：prd-generator）。
</footer>`
}

function handoffBadge(handoff) {
  if (!handoff || !handoff.exists) return '<span class="prd-badge muted">交接单：未生成</span>'
  if (handoff.ready === true) return '<span class="prd-badge ok">交接单：可执行</span>'
  if (handoff.ready === false) return '<span class="prd-badge warn">交接单：需先确认</span>'
  return '<span class="prd-badge muted">交接单：状态未知</span>'
}

function needsConfirm(entry) {
  return (entry.handoff && entry.handoff.ready === false) || entry.stats.openQuestions > 0
}

export function renderListPage(entries) {
  const total = entries.length
  const ready = entries.filter((entry) => entry.handoff && entry.handoff.ready === true).length
  const pending = entries.filter(needsConfirm).length
  const rows = entries
    .map((entry) => {
      const href = `${BASE}/p/${escapeHtml(entry.id)}`
      const badges = [
        `<span class="prd-badge">P0 ${entry.stats.p0}</span>`,
        `<span class="prd-badge">假设 ${entry.stats.assumptions}</span>`,
        `<span class="prd-badge">待确认 ${entry.stats.openQuestions}</span>`,
        handoffBadge(entry.handoff),
      ].join('')
      const when = shortTime(entry.updatedAt)
      return `<a class="prd-row" data-id="${escapeHtml(entry.id)}" href="${href}">
  <div class="prd-row-title">${escapeHtml(entry.name || '未命名 PRD')}</div>
  <div class="prd-row-summary" title="${escapeHtml(entry.summary)}">${escapeHtml(entry.summary || '（无一句话描述）')}</div>
  <div class="prd-badges">${badges}</div>
  <div class="prd-row-meta">
    <span>更新于 ${escapeHtml(when || '未知时间')}</span>
    <code title="${escapeHtml(entry.dir)}">${escapeHtml(truncatePath(entry.dir))}</code>
  </div>
</a>`
    })
    .join('\n')

  const main = total === 0
    ? `<section class="prd-empty">
<strong>还没有生成过 PRD。</strong><br>
对 DSH 说一句：「帮我写个需求文档：…」，生成后会出现在这里。<br>
<span class="prd-muted">本页数据来自本机 <code>${escapeHtml(registryPath())}</code>，只读。</span>
</section>`
    : `<main class="prd-list">
${rows}
</main>`

  const body = `<header class="prd-header">
<h1>PRD 项目</h1>
<p class="prd-sub">本机生成过的 PRD · 只读页面</p>
<div class="prd-stats">
  <span class="prd-stat">共 <strong>${total}</strong> 个 PRD</span>
  <span class="prd-stat">其中 <strong>${ready}</strong> 个可执行</span>
  <span class="prd-stat">待确认 <strong>${pending}</strong> 个</span>
</div>
</header>
${main}
${listFooterHtml()}`
  return htmlDocument('PRD 项目', body)
}

function storiesOf(json) {
  const list = Array.isArray(json?.user_stories) ? json.user_stories : []
  return list
    .filter((story) => story && typeof story === 'object' && !Array.isArray(story))
    .map((story, index) => ({
      id: typeof story.id === 'string' && story.id.trim() ? story.id.trim() : `US-${String(index + 1).padStart(3, '0')}`,
      story: typeof story.story === 'string' ? story.story : '',
      priority: String(story.priority ?? '').toUpperCase(),
      acceptance: Array.isArray(story.acceptance_criteria)
        ? story.acceptance_criteria.filter((item) => typeof item === 'string' && item.trim())
        : [],
      tasks: Array.isArray(story.tasks) ? story.tasks.filter((item) => typeof item === 'string' && item.trim()) : [],
    }))
}

function ledgerOf(json, key) {
  const list = Array.isArray(json?.[key]) ? json[key] : []
  return list.filter((item) => item && typeof item === 'object' && !Array.isArray(item))
}

function renderStory(story) {
  const acceptance = story.acceptance.length
    ? `<ul class="prd-ac-list">${story.acceptance.map((ac) => `<li class="prd-ac">☐ ${escapeField(ac)}</li>`).join('')}</ul>`
    : '<p class="prd-warn">（没有验收标准）</p>'
  const tasks = story.tasks.length
    ? `<div class="prd-muted" style="margin-top:8px">任务</div><ul class="prd-task-list">${story.tasks.map((task) => `<li class="prd-task">${escapeField(task)}</li>`).join('')}</ul>`
    : ''
  return `<article class="prd-story" data-id="${escapeHtml(story.id)}">
  <div class="prd-story-id">${escapeHtml(story.id)} · ${escapeHtml(story.priority || '未标注')}</div>
  <p class="prd-story-text">${escapeField(story.story || '（未写用户故事）')}</p>
  ${acceptance}
  ${tasks}
</article>`
}

function renderAssumptionTable(assumptions) {
  if (!assumptions.length) return '<p class="prd-muted">（没有记录假设）</p>'
  const rows = assumptions.slice(0, MAX_TABLE_ROWS).map((item) => {
    const source = String(item.source ?? '')
    const impact = String(item.impact ?? '')
    const affects = Array.isArray(item.affects) ? item.affects.filter((x) => typeof x === 'string').join('、') : ''
    const sourceLabel = ASSUMPTION_SOURCE_LABELS[source] ?? (source || '—')
    const impactLabel = ASSUMPTION_IMPACT_LABELS[impact] ?? (impact || '—')
    return `<tr class="prd-assumption">
  <td>${escapeHtml(item.id ?? '')}</td>
  <td>${escapeField(item.statement ?? '')}</td>
  <td>${escapeHtml(sourceLabel)}（${escapeHtml(source || '—')}）</td>
  <td>${escapeHtml(impactLabel)}（${escapeHtml(impact || '—')}）</td>
  <td>${escapeHtml(affects || '—')}</td>
  <td>${escapeField(item.evidence ?? '')}</td>
</tr>`
  }).join('')
  const note = assumptions.length > MAX_TABLE_ROWS ? `<p class="prd-truncated">假设较多，仅显示前 ${MAX_TABLE_ROWS} 条。</p>` : ''
  return `${note}<table class="prd-table">
<thead><tr><th>ID</th><th>陈述</th><th>来源</th><th>影响</th><th>受影响故事</th><th>依据</th></tr></thead>
<tbody>${rows}</tbody></table>`
}

function renderQuestionTable(questions) {
  if (!questions.length) return '<p class="prd-muted">（没有待确认问题）</p>'
  const rows = questions.slice(0, MAX_TABLE_ROWS).map((item) => {
    const blocks = Array.isArray(item.blocks) ? item.blocks.filter((x) => typeof x === 'string').join('、') : ''
    return `<tr class="prd-question">
  <td>${escapeHtml(item.id ?? '')}</td>
  <td>${escapeField(item.question ?? '')}</td>
  <td>${escapeHtml(blocks || '—')}</td>
  <td>${escapeField(item.default_assumption ?? '')}</td>
  <td>${escapeHtml(item.owner ?? '')}</td>
</tr>`
  }).join('')
  const note = questions.length > MAX_TABLE_ROWS ? `<p class="prd-truncated">待确认问题较多，仅显示前 ${MAX_TABLE_ROWS} 条。</p>` : ''
  return `${note}<table class="prd-table">
<thead><tr><th>ID</th><th>问题</th><th>阻塞故事</th><th>默认假设</th><th>负责人</th></tr></thead>
<tbody>${rows}</tbody></table>`
}

function renderHandoffCard(json, dir, prdJsonPath) {
  const handoffPath = join(dir, 'handoff.md')
  if (!existsSync(handoffPath)) {
    return `<section class="prd-handoff">
<h2>交接单</h2>
<p class="prd-warn">未生成交接单。</p>
<p class="prd-muted">回到对话说：「这份 PRD 能开工吗」，即可生成执行前门禁与 handoff.md。</p>
</section>`
  }
  let evaluation = null
  try {
    evaluation = evaluateHandoff(json, { prdJsonPath, generatedAt: new Date().toISOString() })
  } catch {
    evaluation = null
  }
  const status = evaluation
    ? evaluation.ready
      ? '<span class="prd-badge ok">可执行</span>'
      : `<span class="prd-badge warn">需先确认（${evaluation.blockers.length} 个 blocker）</span>`
    : '<span class="prd-badge muted">状态未知</span>'
  return `<section class="prd-handoff ${evaluation?.ready ? 'ok' : 'warn'}">
<h2>交接单</h2>
<p>已生成交接单 ${status}</p>
<p class="prd-muted">文件：<code>${escapeHtml(handoffPath)}</code></p>
</section>`
}

function renderDetailError(entry, prdJsonPath, reason) {
  const body = `<a class="prd-back" href="${BASE}/">← 返回 PRD 列表</a>
<h1>PRD 文件不可读</h1>
<p class="prd-sub">${escapeHtml(entry.name || '未命名 PRD')}</p>
<div class="prd-error">读取 <code>${escapeHtml(prdJsonPath)}</code> 失败：${escapeHtml(reason)}</div>
<p class="prd-muted">可能原因：PRD 目录被移动/删除，或 prd.json 损坏或被手改坏。回到对话重新运行「写 PRD」即可生成新文件；这条生成记录仍保留在 registry 里，可以返回列表查看其它 PRD。</p>
<footer class="prd-footer">只读页面 · 预期文件 <code class="prd-path">${escapeHtml(prdJsonPath)}</code></footer>`
  return htmlDocument(`PRD 不可读 · ${entry.name || '未命名 PRD'}`, body)
}

function loadPrdJson(prdJsonPath) {
  if (!existsSync(prdJsonPath)) return { json: null, reason: '文件不存在（目录可能被移动或删除）' }
  try {
    if (statSync(prdJsonPath).size > MAX_PAGE_BYTES) return { json: null, reason: '文件超过 2MB，页面不展示' }
    const raw = readFileSync(prdJsonPath, 'utf8')
    const json = JSON.parse(raw)
    if (!json || typeof json !== 'object' || Array.isArray(json)) return { json: null, reason: '顶层不是 JSON 对象' }
    return { json, reason: null }
  } catch (error) {
    return { json: null, reason: error.message }
  }
}

export function renderDetailPage(entry) {
  const prdJsonPath = join(entry.dir, PRD_JSON)
  const { json, reason } = loadPrdJson(prdJsonPath)
  if (!json) return renderDetailError(entry, prdJsonPath, reason || '未知错误')

  const name = String(json.title ?? json.name ?? entry.name ?? '未命名 PRD')
  const summary = String(json.description ?? json.goal ?? entry.summary ?? '')
  const generatedAt = typeof json._meta?.generated_at === 'string' ? json._meta.generated_at : entry.generatedAt
  const generator = typeof json._meta?.generator === 'string' ? `${json._meta.generator}${json._meta.generator_version ? ` v${json._meta.generator_version}` : ''}` : ''
  const template = typeof json._meta?.template === 'string' ? json._meta.template : ''
  const stories = storiesOf(json)
  const assumptions = ledgerOf(json, 'assumptions')
  const questions = ledgerOf(json, 'open_questions')
  const counts = { P0: 0, P1: 0, P2: 0 }
  let acceptanceCount = 0
  for (const story of stories) {
    if (Object.hasOwn(counts, story.priority)) counts[story.priority] += 1
    acceptanceCount += story.acceptance.length
  }

  const header = `<a class="prd-back" href="${BASE}/">← 返回 PRD 列表</a>
<h1 class="prd-title">${escapeHtml(name)}</h1>
<p class="prd-sub">${escapeField(summary)}</p>
<div class="prd-meta">生成时间 ${escapeHtml(shortTime(generatedAt) || generatedAt || '未知')}${template ? ` · 模板 ${escapeHtml(template)}` : ''}${generator ? ` · ${escapeHtml(generator)}` : ''}</div>
<div class="prd-meta">目录：<code title="${escapeHtml(entry.dir)}">${escapeHtml(entry.dir)}</code></div>
<div class="prd-stats">
  <span class="prd-stat">故事 <strong>${stories.length}</strong></span>
  <span class="prd-stat">验收标准 <strong>${acceptanceCount}</strong></span>
  <span class="prd-stat">P0 <strong>${counts.P0}</strong></span>
  <span class="prd-stat">P1 <strong>${counts.P1}</strong></span>
  <span class="prd-stat">P2 <strong>${counts.P2}</strong></span>
  <span class="prd-stat">假设 <strong>${assumptions.length}</strong></span>
  <span class="prd-stat">待确认 <strong>${questions.length}</strong></span>
</div>`

  // 故事区按 P0 → P1 → P2 分组，其余“未标注”殿后；预算控制单页 ≤ 2MB。
  const overhead = Buffer.byteLength(htmlDocument(`PRD · ${name}`, ''), 'utf8')
  let budget = MAX_PAGE_BYTES - overhead - 2048
  const storySections = []
  let shownStories = 0
  const groups = [...PRIORITIES, '未标注']
  let truncated = false
  const storyGroupsHtml = []
  for (const priority of groups) {
    const groupStories = stories.filter((story) => (priority === '未标注' ? !PRIORITIES.includes(story.priority) : story.priority === priority))
    if (!groupStories.length) continue
    let groupHtml = `<h2>${escapeHtml(PRIORITY_LABELS[priority] ?? priority)}（${groupStories.length}）</h2>`
    for (const story of groupStories) {
      const html = renderStory(story)
      const bytes = Buffer.byteLength(html, 'utf8')
      if (bytes > budget) {
        truncated = true
        break
      }
      groupHtml += html
      budget -= bytes
      shownStories += 1
    }
    storyGroupsHtml.push(groupHtml)
    if (truncated) break
  }
  if (truncated) storyGroupsHtml.push(`<p class="prd-truncated">故事较多，本页仅显示前 ${shownStories} / ${stories.length} 条；完整内容请用编辑器/read 工具打开 prd.md 或 prd.json。</p>`)
  if (stories.length) storySections.push(...storyGroupsHtml)
  else storySections.push('<p class="prd-muted">（没有用户故事）</p>')

  const body = `${header}
<main>
<section>
<h2>用户故事</h2>
${storySections.join('\n')}
</section>
<section>
<h2>假设（${assumptions.length}）</h2>
${renderAssumptionTable(assumptions)}
</section>
<section>
<h2>待确认问题（${questions.length}）</h2>
${renderQuestionTable(questions)}
</section>
${renderHandoffCard(json, entry.dir, prdJsonPath)}
</main>
<footer class="prd-footer">
只读页面 · 以磁盘上的 prd.json 为准 · <code class="prd-path">${escapeHtml(prdJsonPath)}</code> · 页面不加载任何外部资源。<br>
修改需求/生成交接单仍在对话里完成：直接说「把这个功能想法写成 PRD」「这需求现在能开工吗」即可（skill：prd-generator）。
</footer>`
  return htmlDocument(`PRD · ${name}`, body)
}

/**
 * 创建 /prd-generator/ 的请求处理器（由 ctx.webServer.register 挂载）。
 * 路由：GET/HEAD /prd-generator/（列表）与 /prd-generator/p/<12 位 hex id>（详情）；其余 404，非 GET/HEAD 405。
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
    if (rest === '' || rest === '/') {
      try {
        return sendHtml(res, method, renderListPage(listEntries()))
      } catch {
        return sendHtml(res, method, renderListPage([]))
      }
    }

    const match = rest.match(/^\/p\/([^/]+)\/?$/)
    if (!match) return notFound(res, method)
    const id = match[1]
    if (!ENTRY_ID_RE.test(id)) return notFound(res, method)
    let entry
    try {
      entry = readEntry(id)
    } catch {
      entry = null
    }
    if (!entry) return notFound(res, method)
    return sendHtml(res, method, renderDetailPage(entry))
  }
}
