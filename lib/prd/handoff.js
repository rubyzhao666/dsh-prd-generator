// 执行前门禁 + handoff.md（0.3.0 G2）。
// - 只读 prd.json，不修改它和其它产物；
// - 输出 ready / blockers / warnings，并生成可直接交给 Ralph / coding agent 的六章 Markdown；
// - 落盘用「同目录临时文件 + rename」原子替换，write=false 时完全不写文件。

import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import {
  FILE_NAMES,
  GENERATOR,
  GENERATOR_VERSION,
  PRIORITIES,
  asTrimmedStringList,
  blockingQuestionsWithoutDefault,
  isPlainObject,
  oneLine,
  questionsBlockingStory,
  stripCheckMarks,
  trimText,
} from './schema.js'
import { readLedger } from './validate.js'

export const HANDOFF_FILE_NAME = 'handoff.md'

export const BLOCKER_CODES = [
  'P0_BLOCKED_BY_OPEN_QUESTION',
  'P0_WITHOUT_TASKS',
  'P0_WITHOUT_ACCEPTANCE',
  'BLOCKS_P0_ASSUMPTION_WITHOUT_EVIDENCE',
]

export const WARNING_CODES = ['OPEN_QUESTION_WITHOUT_OWNER', 'NON_P0_BLOCKED', 'NO_ASSUMPTIONS']

const PRIORITY_RANK = new Map(PRIORITIES.map((priority, index) => [priority, index]))

function readStories(json) {
  const list = Array.isArray(json?.user_stories) ? json.user_stories : []
  return list.filter(isPlainObject).map((story, index) => ({
    id: trimText(story.id) || `US-${String(index + 1).padStart(3, '0')}`,
    story: trimText(story.story),
    priority: trimText(story.priority).toUpperCase() || '未标注',
    tasks: asTrimmedStringList(story.tasks),
    acceptance_criteria: asTrimmedStringList(story.acceptance_criteria),
  }))
}

// path = prd.json 文件或包含它的目录。返回 { jsonPath, json, bytes }；错误信息可直接指导模型修。
export async function loadPrdJson(target) {
  let info
  try {
    info = await stat(target)
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`找不到路径：${target}。请传 prd.json 的绝对路径，或 prd_write 返回的 dir（包含 prd.json 的目录）。`)
    }
    throw new Error(`读取路径失败：${error.message}（${target}）`)
  }

  let jsonPath = target
  if (info.isDirectory()) {
    jsonPath = join(target, FILE_NAMES.json)
    if (!existsSync(jsonPath)) {
      throw new Error(
        `目录里没有 prd.json：${target}。先跑 prd_write（formats 需包含 "json"）生成，或直接传 prd.json 的绝对路径。`,
      )
    }
  } else if (!target.toLowerCase().endsWith('.json')) {
    throw new Error(`path 指向的不是 prd.json：${target}。请传 prd.json 的绝对路径，或包含它的目录。`)
  }

  let raw
  try {
    raw = await readFile(jsonPath, 'utf8')
  } catch (error) {
    throw new Error(`读取 prd.json 失败：${error.message}（${jsonPath}）`)
  }

  let json
  try {
    json = JSON.parse(raw)
  } catch (error) {
    throw new Error(
      `prd.json 不是合法 JSON：${error.message}。修法：重新跑 prd_write 覆盖生成（推荐），或按报错位置修好后重试 prd_handoff。（${jsonPath}）`,
    )
  }
  if (!isPlainObject(json)) {
    const actual = Array.isArray(json) ? '数组' : json === null ? 'null' : typeof json
    throw new Error(`prd.json 顶层必须是 JSON 对象（Ralph 兼容格式），当前是 ${actual}。请用 prd_write 重新生成或修正后重试。`)
  }

  return { jsonPath, json, bytes: Buffer.byteLength(raw, 'utf8') }
}

function refsSuffix(refs) {
  return refs.length ? `（相关：${refs.join(' / ')}）` : ''
}

function priorityCounts(stories) {
  const counts = { P0: 0, P1: 0, P2: 0 }
  for (const story of stories) {
    if (Object.hasOwn(counts, story.priority)) counts[story.priority] += 1
  }
  return counts
}

function orderedStories(stories) {
  const known = [...stories].sort((a, b) => (PRIORITY_RANK.get(a.priority) ?? 99) - (PRIORITY_RANK.get(b.priority) ?? 99))
  return known
}

// 六章 Markdown。固定结构见 FEATURE-SPECS-0.3.0 G2。
export function renderHandoffMd({
  docName,
  prdJsonPath,
  generatedAt,
  stories,
  assumptions,
  openQuestions,
  outOfScope,
  blockers,
  warnings,
  stats,
  ready,
}) {
  const lines = []
  lines.push(`# 执行交接单：${docName}`)
  lines.push('')
  lines.push(`> 生成时间 ${generatedAt} · 来源 \`${prdJsonPath}\` · 门禁结论：${ready ? '可执行' : '需先确认'}`)
  lines.push('')

  // 1. blockers（warnings 以引用块附在本章末尾，避免新增章节打乱固定结构）
  lines.push('## 1. 执行前必须确认（blockers）')
  lines.push('')
  if (blockers.length) {
    for (const blocker of blockers) lines.push(`- [ ] ${blocker.message}${refsSuffix(blocker.refs)}`)
  } else {
    lines.push('- 无 blockers：门禁通过，可以直接开工。')
  }
  if (warnings.length) {
    lines.push('')
    lines.push('> 门禁警告（不阻塞，但建议开工前处理）：')
    for (const warning of warnings) lines.push(`> - ${warning.code}：${warning.message}${refsSuffix(warning.refs)}`)
  }
  lines.push('')

  // 2. 假设
  lines.push('## 2. 已采用的默认假设（执行时不得自行更改）')
  lines.push('')
  if (assumptions.length) {
    for (const assumption of assumptions) {
      const meta = `${assumption.source || 'unknown'}，${assumption.impact || 'unknown'}`
      const evidence = assumption.evidence || '未提供，执行前补充'
      lines.push(`- ${assumption.id || '(无 id)'}（${meta}）：${assumption.statement || '（未写陈述）'} — 依据：${evidence}`)
    }
  } else {
    lines.push('- 未记录任何假设（见 warnings：NO_ASSUMPTIONS）。')
  }
  lines.push('')

  // 3. out of scope
  lines.push('## 3. 不要做的事（out of scope）')
  lines.push('')
  if (outOfScope.length) {
    for (const item of outOfScope) lines.push(`- ${item}`)
  } else {
    lines.push('- 未声明（建议回到 prd 补 scope.out_of_scope，避免执行时自行扩范围）。')
  }
  lines.push('')

  // 4. 执行顺序与任务
  lines.push('## 4. 执行顺序与任务（按 P0 → P1 → P2）')
  lines.push('')
  if (!stories.length) {
    lines.push('- 没有用户故事（无法交接）。')
    lines.push('')
  } else {
    for (const story of orderedStories(stories)) {
      lines.push(`### ${story.id} · ${story.priority} · ${oneLine(story.story || '（未写故事）', 80)}`)
      lines.push('')
      lines.push(
        story.tasks.length
          ? `- 任务：${story.tasks.map((task, index) => `${index + 1}) ${task}`).join(' ')}`
          : '- 任务：未提供（见 blockers，先补 tasks 再开工）',
      )
      if (story.acceptance_criteria.length) {
        // 与契约结构一致：首条验收标准直接跟在「- 验收：」后，其余缩进并列。
        lines.push(`- 验收：- [ ] ${stripCheckMarks(story.acceptance_criteria[0])}`)
        for (const ac of story.acceptance_criteria.slice(1)) lines.push(`  - [ ] ${stripCheckMarks(ac)}`)
      } else {
        lines.push('- 验收：未提供（见 blockers，先补 acceptance_criteria 再开工）')
      }
      lines.push('')
    }
  }

  // 5. 验收门禁
  lines.push('## 5. 验收门禁（交付即验收）')
  lines.push('')
  lines.push(`- 全部 P0 故事的验收标准逐条通过；共 ${stats.acceptanceCriteria} 条 AC。`)
  lines.push(
    `- 有 blockers 时不得开工；当前${ready ? '无 blocker，可执行。' : `仍有 ${blockers.length} 个 blocker，需先解决。`}`,
  )
  lines.push('- 验收结果以 prd.json 的 acceptance_criteria 为准，勾选进度可回填 acceptance.md。')
  lines.push('')

  // 6. 生成信息
  const counts = priorityCounts(stories)
  lines.push('## 6. 生成信息')
  lines.push('')
  lines.push(`- 来源：\`${prdJsonPath}\``)
  lines.push(`- generator：${GENERATOR} v${GENERATOR_VERSION}`)
  lines.push(`- 生成时间：${generatedAt}`)
  lines.push(
    `- 故事与 AC 统计：${stats.stories} 条故事（P0 ${counts.P0} / P1 ${counts.P1} / P2 ${counts.P2}）· ${stats.acceptanceCriteria} 条验收标准`,
  )
  lines.push(`- 假设 / 待确认：${stats.assumptions} 条假设 / ${stats.openQuestions} 条待确认`)
  lines.push('')

  return lines.join('\n')
}

// 门禁评估。返回 { ok, docName, ready, blockers, warnings, checklist, stats }；
// ok 与 ready 一致（门禁结论），便于下游 agent 用统一字段判断能否开工。
export function evaluateHandoff(json, options = {}) {
  const prdJsonPath = options.prdJsonPath ?? FILE_NAMES.json
  const generatedAt = options.generatedAt ?? new Date().toISOString()
  const stories = readStories(json)
  const { assumptions, openQuestions } = readLedger(json)
  const ledger = { assumptions, open_questions: openQuestions }
  const outOfScope = asTrimmedStringList(json?.scope?.out_of_scope)

  const blockers = []
  const warnings = []
  const p0Stories = stories.filter((story) => story.priority === 'P0')

  // —— blocker 1/2/3：P0 故事的执行门禁 ——
  for (const story of p0Stories) {
    const blockingQuestions = blockingQuestionsWithoutDefault(ledger, story.id)
    if (blockingQuestions.length) {
      const questionIds = blockingQuestions.map((question) => question.id).filter(Boolean)
      blockers.push({
        code: 'P0_BLOCKED_BY_OPEN_QUESTION',
        message: `P0 故事 ${story.id} 依赖未确认问题 ${questionIds.join('、') || '(无 id)'}，且没有默认假设、也没有 affects 覆盖它的假设：先补 default_assumption 或把故事降级。`,
        refs: [story.id, ...questionIds],
      })
    }
    if (!story.tasks.length) {
      blockers.push({
        code: 'P0_WITHOUT_TASKS',
        message: `P0 故事 ${story.id} 没有 tasks：Ralph / 编码 agent 无法拆解执行任务，请补 2–5 条可执行任务。`,
        refs: [story.id],
      })
    }
    if (!story.acceptance_criteria.length) {
      blockers.push({
        code: 'P0_WITHOUT_ACCEPTANCE',
        message: `P0 故事 ${story.id} 没有验收标准（acceptance_criteria）：执行前必须补 Given-When-Then，否则无法判定完成。`,
        refs: [story.id],
      })
    }
  }

  // —— blocker 4：blocks-p0 假设必须有依据 ——
  for (const assumption of assumptions) {
    if (assumption.impact === 'blocks-p0' && !assumption.evidence) {
      blockers.push({
        code: 'BLOCKS_P0_ASSUMPTION_WITHOUT_EVIDENCE',
        message: `假设 ${assumption.id || '(无 id)'}（impact=blocks-p0）没有 evidence：交给执行前必须补依据（用户原话 / 搜索结果 / 行业惯例说明）。`,
        refs: [assumption.id, ...assumption.affects].filter(Boolean),
      })
    }
  }

  // —— warning 1：待确认问题没人负责、也没兜底 ——
  for (const question of openQuestions) {
    if (!question.owner && !question.default_assumption) {
      warnings.push({
        code: 'OPEN_QUESTION_WITHOUT_OWNER',
        message: `待确认问题 ${question.id || '(无 id)'} 没有 owner，也没有 default_assumption：至少补一个，否则没人对答案负责。`,
        refs: [question.id].filter(Boolean),
      })
    }
  }

  // —— warning 2：非 P0 故事被待确认问题阻塞 ——
  for (const story of stories) {
    if (story.priority === 'P0') continue
    const blockingQuestions = questionsBlockingStory(ledger, story.id)
    if (!blockingQuestions.length) continue
    const questionIds = blockingQuestions.map((question) => question.id).filter(Boolean)
    warnings.push({
      code: 'NON_P0_BLOCKED',
      message: `故事 ${story.id}（${story.priority}）被待确认问题 ${questionIds.join('、') || '(无 id)'} 阻塞：可以在执行到该优先级前解决，但不要忘记。`,
      refs: [story.id, ...questionIds],
    })
  }

  // —— warning 3：没有任何假设记录 ——
  if (!assumptions.length) {
    warnings.push({
      code: 'NO_ASSUMPTIONS',
      message: '没有任何假设记录：AI 生成的 PRD 应显式记录假设；若全部来自用户原话，也请写至少 1 条 source=user 的假设。',
      refs: [],
    })
  }

  const ready = blockers.length === 0
  const stats = {
    stories: stories.length,
    p0: p0Stories.length,
    assumptions: assumptions.length,
    openQuestions: openQuestions.length,
    acceptanceCriteria: stories.reduce((sum, story) => sum + story.acceptance_criteria.length, 0),
  }
  const docName = trimText(json.title) || trimText(json.name) || '未命名 PRD'
  const checklist = renderHandoffMd({
    docName,
    prdJsonPath,
    generatedAt,
    stories,
    assumptions,
    openQuestions,
    outOfScope,
    blockers,
    warnings,
    stats,
    ready,
  })

  return { ok: ready, docName, ready, blockers, warnings, checklist, stats }
}

// 原子写：同目录临时文件 + rename 覆盖旧文件；失败时清理临时文件。
export async function writeHandoffFile(handoffPath, content) {
  const dir = dirname(handoffPath)
  await mkdir(dir, { recursive: true })
  const tempPath = join(dir, `.${HANDOFF_FILE_NAME}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`)
  try {
    await writeFile(tempPath, content, 'utf8')
    await rename(tempPath, handoffPath)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {})
    throw new Error(`写入 handoff.md 失败：${error.message}（目标：${handoffPath}）`)
  }
  return { path: handoffPath, bytes: Buffer.byteLength(content, 'utf8') }
}
