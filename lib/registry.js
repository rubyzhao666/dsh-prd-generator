// PRD 生成记录 registry（0.4.0）：$DSH_HOME/prd-generator/registry.json
// - 结构 { version: 1, entries: [...] }，最多保留 200 条（按 updatedAt 倒序裁剪）
// - 写入：临时文件 + rename 原子替换；目录不存在自动创建
// - 读取：文件不存在 / JSON 损坏 / 结构异常 → 返回空列表；单条 entry 字段不合法 → 跳过该条
// - 纯本地，不联网；只存 PRD 的摘要信息，不复制 PRD 正文
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const ROW_ID = 'prd-generator'
export const REGISTRY_VERSION = 1
export const MAX_ENTRIES = 200
export const REGISTRY_FILE_NAME = 'registry.json'

const ID_PATTERN = /^[0-9a-f]{12}$/
const MAX_TEXT = 4000

/** DSH_HOME 每次调用时读取（不缓存），便于测试与宿主环境变化。 */
export function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.trim()
  return join(homedir(), '.dsh')
}

export function dataRoot() {
  return join(dshHome(), ROW_ID)
}

export function registryPath() {
  return join(dataRoot(), REGISTRY_FILE_NAME)
}

/** PRD 目录稳定 id：sha1(dir) 前 12 位 hex。 */
export function entryId(dir) {
  return createHash('sha1').update(String(dir ?? '')).digest('hex').slice(0, 12)
}

function isIsoDate(value) {
  return typeof value === 'string' && value.length <= 64 && !Number.isNaN(Date.parse(value))
}

function text(value, max = MAX_TEXT) {
  if (typeof value !== 'string') return null
  return value.length > max ? value.slice(0, max) : value
}

function count(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null
}

function normalizeStats(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const stats = {
    stories: count(raw.stories),
    p0: count(raw.p0),
    acceptanceCriteria: count(raw.acceptanceCriteria),
    assumptions: count(raw.assumptions),
    openQuestions: count(raw.openQuestions),
  }
  return Object.values(stats).some((value) => value === null) ? null : stats
}

function normalizeHandoff(raw) {
  if (raw == null) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined
  if (typeof raw.exists !== 'boolean') return undefined
  const ready = raw.ready === null || raw.ready === undefined ? null : typeof raw.ready === 'boolean' ? raw.ready : undefined
  if (ready === undefined) return undefined
  const updatedAt = raw.updatedAt == null ? null : isIsoDate(raw.updatedAt) ? raw.updatedAt : undefined
  if (updatedAt === undefined) return undefined
  return { exists: raw.exists, ready, updatedAt }
}

/**
 * 单条 entry 白名单归一化。返回归一化 entry；字段缺失/类型不对返回 null（调用方跳过该条）。
 */
export function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const id = typeof raw.id === 'string' && ID_PATTERN.test(raw.id) ? raw.id : null
  const dir = text(raw.dir)?.trim() || null
  const name = text(raw.name)
  const summary = text(raw.summary)
  const generatedAt = isIsoDate(raw.generatedAt) ? raw.generatedAt : null
  const updatedAt = isIsoDate(raw.updatedAt) ? raw.updatedAt : null
  const stats = normalizeStats(raw.stats)
  const handoff = normalizeHandoff(raw.handoff)
  if (!id || !dir || !name || summary === null || !generatedAt || !updatedAt || !stats || handoff === undefined) return null
  return { id, dir, name, summary, generatedAt, updatedAt, stats, handoff }
}

function compareUpdatedDesc(a, b) {
  const byTime = Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
  if (byTime !== 0) return byTime
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function normalizeList(rawEntries) {
  if (!Array.isArray(rawEntries)) return []
  const byId = new Map()
  for (const raw of rawEntries) {
    const entry = normalizeEntry(raw)
    if (!entry) continue
    const previous = byId.get(entry.id)
    if (!previous || Date.parse(entry.updatedAt) > Date.parse(previous.updatedAt)) byId.set(entry.id, entry)
  }
  return [...byId.values()].sort(compareUpdatedDesc).slice(0, MAX_ENTRIES)
}

/** 读取整个 registry（容错）：任何异常都返回空列表，不让页面/工具崩。 */
export function readRegistry() {
  const file = registryPath()
  let rawText
  try {
    if (!existsSync(file)) return { version: REGISTRY_VERSION, entries: [] }
    rawText = readFileSync(file, 'utf8')
  } catch {
    return { version: REGISTRY_VERSION, entries: [] }
  }
  let parsed
  try {
    parsed = JSON.parse(rawText)
  } catch {
    return { version: REGISTRY_VERSION, entries: [] }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { version: REGISTRY_VERSION, entries: [] }
  return { version: REGISTRY_VERSION, entries: normalizeList(parsed.entries) }
}

export function listEntries() {
  return readRegistry().entries
}

export function readEntry(id) {
  if (typeof id !== 'string') return null
  return listEntries().find((entry) => entry.id === id) ?? null
}

/** 原子写整个 registry：同目录临时文件 + rename；失败清理临时文件。 */
function writeRegistry(entries) {
  const dir = dataRoot()
  mkdirSync(dir, { recursive: true })
  const file = registryPath()
  const tempPath = join(dir, `.${REGISTRY_FILE_NAME}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`)
  const payload = `${JSON.stringify({ version: REGISTRY_VERSION, entries }, null, 2)}\n`
  try {
    writeFileSync(tempPath, payload, 'utf8')
    renameSync(tempPath, file)
  } catch (error) {
    try {
      unlinkSync(tempPath)
    } catch {
      // 临时文件可能没写出来，忽略
    }
    throw new Error(`写入 PRD 生成记录失败：${error.message}（${file}）`)
  }
}

/**
 * 写入/更新一条记录：同 id 覆盖，按 updatedAt 倒序裁剪到 200 条。
 * entry 不合法时抛错（带字段说明，由调用方决定降级）。
 */
export function upsertEntry(raw) {
  const entry = normalizeEntry(raw)
  if (!entry) {
    throw new Error(
      '生成记录不合法：需要 { id: sha1(dir) 前 12 位 hex, dir, name, summary, generatedAt, updatedAt, stats{stories,p0,acceptanceCriteria,assumptions,openQuestions}, handoff: null | {exists,ready,updatedAt} }。',
    )
  }
  const entries = [entry, ...listEntries().filter((item) => item.id !== entry.id)]
    .sort(compareUpdatedDesc)
    .slice(0, MAX_ENTRIES)
  writeRegistry(entries)
  return entry
}

/** 从 prd 对象（prd_write 归一化后的对象或 prd.json）计算 registry 需要的 5 项统计。 */
export function statsForRegistry(prdLike) {
  const stories = Array.isArray(prdLike?.user_stories) ? prdLike.user_stories : []
  const stats = { stories: stories.length, p0: 0, acceptanceCriteria: 0, assumptions: Array.isArray(prdLike?.assumptions) ? prdLike.assumptions.length : 0, openQuestions: Array.isArray(prdLike?.open_questions) ? prdLike.open_questions.length : 0 }
  for (const story of stories) {
    if (!story || typeof story !== 'object') continue
    if (Array.isArray(story.acceptance_criteria)) {
      stats.acceptanceCriteria += story.acceptance_criteria.filter((item) => typeof item === 'string' && item.trim()).length
    }
    if (String(story.priority ?? '').toUpperCase() === 'P0') stats.p0 += 1
  }
  return stats
}

/** prd_write 落盘成功后构造 entry（新生成时 handoff 置 null）。 */
export function entryFromPrd({ dir, prd, generatedAt }) {
  return {
    id: entryId(dir),
    dir,
    name: String(prd?.name ?? '').trim(),
    summary: String(prd?.summary ?? '').trim(),
    generatedAt,
    updatedAt: generatedAt,
    stats: statsForRegistry(prd),
    handoff: null,
  }
}

/** prd_handoff 成功后：找到已有 entry 则更新 handoff/stats，否则按 dir 新建一条。 */
export function upsertHandoffEntry({ dir, prdJson, ready, updatedAt, generatedAt }) {
  const id = entryId(dir)
  const existing = readEntry(id)
  const stats = statsForRegistry(prdJson)
  const handoff = { exists: true, ready: Boolean(ready), updatedAt }
  const name = String(prdJson?.title ?? prdJson?.name ?? '').trim() || existing?.name || '未命名 PRD'
  const summary = String(prdJson?.description ?? prdJson?.goal ?? '').trim() || existing?.summary || ''
  const prdGeneratedAt = isIsoDate(prdJson?._meta?.generated_at) ? prdJson._meta.generated_at : existing?.generatedAt ?? generatedAt
  return upsertEntry({
    id,
    dir,
    name,
    summary,
    generatedAt: prdGeneratedAt,
    updatedAt,
    stats,
    handoff,
  })
}
