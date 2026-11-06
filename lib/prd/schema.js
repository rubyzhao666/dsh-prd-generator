// 共享常量与纯函数。这里不 import 任何 DSH 运行时，方便 node --test 直接单测。

export const PLUGIN_ID = 'prd-generator'
export const GENERATOR = 'dsh-prd-generator'
export const GENERATOR_VERSION = '0.1.0'

export const PRIORITIES = ['P0', 'P1', 'P2']

export const PRIORITY_LABELS = {
  P0: 'P0 · 必须完成（阻塞 MVP）',
  P1: 'P1 · MVP 后第一个迭代',
  P2: 'P2 · 长期规划',
}

export const COMPLEXITIES = ['low', 'medium', 'high']

export const TEMPLATES = ['web-app', 'mobile-app', 'api', 'backend', 'general']

export const TEMPLATE_LABELS = {
  'web-app': 'Web 应用',
  'mobile-app': '移动端 App',
  api: 'API 接口',
  backend: '后端服务',
  general: '通用',
}

export const FORMATS = ['md', 'json', 'acceptance', 'mindmap', 'flowchart']

export const FILE_NAMES = {
  md: 'prd.md',
  json: 'prd.json',
  acceptance: 'acceptance.md',
  mindmap: 'mindmap.mmd',
  flowchart: 'flowchart.mmd',
}

export const FORMAT_LABELS = {
  md: '完整 PRD（Markdown，9 章）',
  json: '结构化 JSON（snarktank/ralph 兼容）',
  acceptance: '验收清单（P0/P1/P2 + Given-When-Then 勾选）',
  mindmap: 'Mermaid 思维导图',
  flowchart: 'Mermaid 用户流程图',
}

// 生成 prd.json 时写在 _meta.source_files 里的相对文件名。
export const OUTPUT_FILES = FORMATS.map((format) => FILE_NAMES[format])

export const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export const isNonEmptyString = (value) =>
  typeof value === 'string' && value.trim().length > 0

export const trimText = (value) => (typeof value === 'string' ? value.trim() : '')

export function asTrimmedStringList(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => trimText(item)).filter(Boolean)
}

// 单行化并截断，用于 Mermaid 节点 / 表格等不能出现换行的位置。
export function oneLine(value, max = 120) {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(1, max - 1))}…`
}

// Markdown 表格单元格：转义竖线、换行转 <br>。
export function mdCell(value) {
  const text = String(value ?? '')
    .trim()
    .replace(/\r?\n/g, '<br>')
    .replace(/\|/g, '\\|')
  return text || '—'
}

// 文件/节点用的 slug：保留中英文与数字，其余折叠成 -（中英混合也能得到可读名字）。
export function slugify(input, fallback = 'prd') {
  const text = trimText(input).toLowerCase()
  const slug = text
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  return slug || fallback
}

// 去掉验收标准前面可能带的列表符 / GFM 勾选框 / ✅ 等符号，供渲染勾选框时使用。
export function stripCheckMarks(value) {
  let text = String(value ?? '').trim()
  const prefix = /^(?:[-*+]\s+|\[[ xX]?\]\s*|[✅☑✔✓]\s*)+/u
  while (prefix.test(text)) text = text.replace(prefix, '')
  return text.trim()
}

// 判断一条验收标准是否写成 Given-When-Then（中英文都认）。
export function looksLikeGivenWhenThen(value) {
  const text = stripCheckMarks(value).replace(/^[【[(]\s*/u, '')
  return /^(给定|当|假如|假设|given|when|if)/i.test(text) || /(给定|given)[\s\S]+(当|when)[\s\S]+(那么|then)/i.test(text)
}

export function isPriority(value) {
  return PRIORITIES.includes(value)
}

// 汇总统计：prd_write 返回值与 prd_check 的 stats 共用同一套键。
export function computeStats(prd) {
  const stories = Array.isArray(prd?.user_stories) ? prd.user_stories : []
  const stats = {
    stories: stories.length,
    acceptanceCriteria: 0,
    p0: 0,
    p1: 0,
    p2: 0,
    features: Array.isArray(prd?.features) ? prd.features.length : 0,
    inScope: Array.isArray(prd?.scope?.in_scope) ? prd.scope.in_scope.length : 0,
    outOfScope: Array.isArray(prd?.scope?.out_of_scope) ? prd.scope.out_of_scope.length : 0,
  }
  for (const story of stories) {
    stats.acceptanceCriteria += Array.isArray(story?.acceptance_criteria) ? story.acceptance_criteria.length : 0
    const priority = String(story?.priority ?? '').toUpperCase()
    if (priority === 'P0') stats.p0 += 1
    else if (priority === 'P1') stats.p1 += 1
    else if (priority === 'P2') stats.p2 += 1
  }
  return stats
}

// 技术栈字符串按大类拆分，用于生成 Ralph 兼容的 tech_requirements 结构。
const FRONTEND_HINTS = ['前端', 'frontend', 'react', 'vue', 'next.js', 'nextjs', 'svelte', 'angular', 'tailwind', 'css', 'html', 'ui ', '浏览器']
const BACKEND_HINTS = ['后端', 'backend', '服务端', 'node', 'nestjs', 'express', 'fastapi', 'flask', 'django', 'spring', 'gin', 'go ', 'golang', 'java', 'python', 'api', '微服务', 'server']
const DATABASE_HINTS = ['数据库', 'database', 'mysql', 'postgres', 'postgresql', 'redis', 'mongo', 'mongodb', 'sqlite', 'elasticsearch', '存储', 'db']

export function classifyTech(items) {
  const result = { frontend: [], backend: [], database: [], dependencies: [] }
  for (const raw of items) {
    const item = String(raw ?? '').trim()
    if (!item) continue
    const lower = item.toLowerCase()
    if (FRONTEND_HINTS.some((hint) => lower.includes(hint))) result.frontend.push(item)
    else if (BACKEND_HINTS.some((hint) => lower.includes(hint))) result.backend.push(item)
    else if (DATABASE_HINTS.some((hint) => lower.includes(hint))) result.database.push(item)
    else result.dependencies.push(item)
  }
  return result
}

const PERFORMANCE_HINTS = ['性能', '响应', '延迟', '耗时', '并发', '吞吐', '加载', '首屏', 'qps', 'latency', 'performance', 'p95', 'p99']
const SECURITY_HINTS = ['安全', '权限', '加密', '隐私', '鉴权', '认证', '合规', '审计', 'security', 'auth', 'privacy', 'gdpr']
const COMPATIBILITY_HINTS = ['兼容', '浏览器', '平台', '设备', '屏幕', '适配', '型号', 'ios', 'android', 'chrome', 'safari', 'firefox', 'compatibility']

export function classifyNonFunctional(items) {
  const result = { performance: [], security: [], compatibility: [], other: [] }
  for (const raw of items) {
    const item = String(raw ?? '').trim()
    if (!item) continue
    const lower = item.toLowerCase()
    if (PERFORMANCE_HINTS.some((hint) => lower.includes(hint))) result.performance.push(item)
    else if (SECURITY_HINTS.some((hint) => lower.includes(hint))) result.security.push(item)
    else if (COMPATIBILITY_HINTS.some((hint) => lower.includes(hint))) result.compatibility.push(item)
    else result.other.push(item)
  }
  return result
}

const TECHNICAL_METRIC_HINTS = ['技术', '可用性', '错误率', '延迟', '响应', '性能', 'qps', 'uptime', 'latency', 'sla', 'p95', 'p99']

export function classifyMetrics(metrics) {
  const result = { business: [], technical: [] }
  for (const metric of metrics) {
    const label = String(metric?.name ?? '').trim()
    const target = String(metric?.target ?? '').trim()
    const line = [label, target].filter(Boolean).join('：')
    if (!line) continue
    const lower = line.toLowerCase()
    if (TECHNICAL_METRIC_HINTS.some((hint) => lower.includes(hint))) result.technical.push(line)
    else result.business.push(line)
  }
  return result
}

// 从 Markdown 里提取 2-4 级标题，供思维导图复用洞察分析的分段。
export function extractHeadings(markdown, max = 6) {
  return String(markdown ?? '')
    .split(/\r?\n/)
    .map((line) => line.match(/^#{2,4}\s+(.+?)\s*#*\s*$/)?.[1]?.trim() ?? '')
    .filter(Boolean)
    .slice(0, max)
}
