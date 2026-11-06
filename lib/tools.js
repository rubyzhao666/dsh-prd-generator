// 模型工具：prd_write（结构化写入 5 个文件）+ prd_check（校验 prd.json）。
// 约定：parameters / output.schema 是原始 JSON Schema；execute 自己校验参数；
// 出错直接 throw Error，错误信息要能指导模型补齐后重试。

import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import { FILE_NAMES, FORMATS, TEMPLATES, computeStats, isPlainObject } from './prd/schema.js'
import { validatePrdInput, validatePrdJson } from './prd/validate.js'
import { renderPrdMd } from './prd/render-md.js'
import { serializePrdJson } from './prd/render-json.js'
import { renderAcceptanceMd } from './prd/render-acceptance.js'
import { renderMindmap, renderFlowchart } from './prd/render-mermaid.js'
import { writeOutputFiles } from './prd/io.js'

const text = (value) => [{ type: 'text', text: value }]

const STATS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['stories', 'acceptanceCriteria', 'p0', 'p1', 'p2', 'assumptions', 'openQuestions'],
  properties: {
    stories: { type: 'integer' },
    acceptanceCriteria: { type: 'integer' },
    p0: { type: 'integer' },
    p1: { type: 'integer' },
    p2: { type: 'integer' },
    features: { type: 'integer' },
    inScope: { type: 'integer' },
    outOfScope: { type: 'integer' },
    assumptions: { type: 'integer' },
    openQuestions: { type: 'integer' },
  },
}

const CHECK_STATS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['stories', 'acceptanceCriteria', 'p0', 'p1', 'p2', 'inScope', 'outOfScope', 'assumptions', 'openQuestions'],
  properties: {
    stories: { type: 'integer' },
    acceptanceCriteria: { type: 'integer' },
    p0: { type: 'integer' },
    p1: { type: 'integer' },
    p2: { type: 'integer' },
    inScope: { type: 'integer' },
    outOfScope: { type: 'integer' },
    assumptions: { type: 'integer' },
    openQuestions: { type: 'integer' },
  },
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatCounts(stats) {
  return `${stats.stories} 条用户故事（P0 ${stats.p0} / P1 ${stats.p1} / P2 ${stats.p2}），${stats.acceptanceCriteria} 条验收标准，假设 ${stats.assumptions ?? 0} 条 / 待确认 ${stats.openQuestions ?? 0} 条`
}

function requireAbsolute(value, name, hint) {
  let raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) throw new Error(`${name} 缺失或为空：${hint}`)
  if (raw === '~' || raw.startsWith('~/')) raw = join(homedir(), raw.slice(1))
  if (!isAbsolute(raw)) {
    throw new Error(`${name} 必须是绝对路径，收到相对路径 "${raw}"。${hint}`)
  }
  return resolve(raw)
}

function normalizeFormats(value) {
  if (value == null) return [...FORMATS]
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`formats 必须是非空数组，可选值：${FORMATS.join(' / ')}；不传 formats 则生成全部 ${FORMATS.length} 个文件。`)
  }
  const formats = []
  for (const item of value) {
    const format = String(item ?? '').trim().toLowerCase()
    if (!FORMATS.includes(format)) {
      throw new Error(`formats 里有不支持的格式 "${item}"。可选值：${FORMATS.join(' / ')}（不传 formats 则生成全部）。`)
    }
    if (!formats.includes(format)) formats.push(format)
  }
  return formats
}

function buildEntries(prd, formats, generatedAt) {
  const entries = []
  for (const format of formats) {
    if (format === 'md') {
      entries.push({ format, fileName: FILE_NAMES.md, content: renderPrdMd(prd, { generatedAt, formats }) })
    } else if (format === 'json') {
      entries.push({ format, fileName: FILE_NAMES.json, content: serializePrdJson(prd, { generatedAt, formats }) })
    } else if (format === 'acceptance') {
      entries.push({ format, fileName: FILE_NAMES.acceptance, content: renderAcceptanceMd(prd, { generatedAt }) })
    } else if (format === 'mindmap') {
      entries.push({ format, fileName: FILE_NAMES.mindmap, content: renderMindmap(prd) })
    } else if (format === 'flowchart') {
      entries.push({ format, fileName: FILE_NAMES.flowchart, content: renderFlowchart(prd) })
    }
  }
  return entries
}

const STORY_SCHEMA = {
  type: 'object',
  required: ['id', 'story', 'acceptance_criteria'],
  properties: {
    id: { type: 'string', description: '用户故事 id，唯一，建议 US-001 这种格式。' },
    story: { type: 'string', description: '「作为 [角色]，我想要 [功能]，以便 [价值]」。' },
    priority: { type: 'string', enum: ['P0', 'P1', 'P2'], description: 'P0 = MVP 必须完成；P1 = 下个迭代；P2 = 长期。至少 1 条 P0。' },
    acceptance_criteria: {
      type: 'array',
      minItems: 1,
      items: { type: 'string' },
      description: '每条验收标准写成「给定 [前置条件]，当 [操作]，那么 [预期结果]」；每条用户故事至少 1 条。',
    },
    tasks: { type: 'array', items: { type: 'string' }, description: '可执行的开发任务拆解（建议 2–5 条），供 Ralph 执行。' },
    complexity: { type: 'string', enum: ['low', 'medium', 'high'], description: '实现复杂度，默认 medium。' },
  },
}

const PRD_SCHEMA = {
  type: 'object',
  required: ['name', 'summary', 'user_stories'],
  properties: {
    name: { type: 'string', description: '功能名称，例如「每日打卡 + 跟读打分」。' },
    summary: { type: 'string', description: '一句话描述：是什么 + 给谁 + 解决什么核心价值。' },
    background: { type: 'string', description: '背景与动机（支持 Markdown）：为什么做、解决什么痛点、当前替代方案的问题。' },
    target_users: {
      type: 'array',
      items: {
        type: 'object',
        required: ['type'],
        properties: {
          type: { type: 'string', description: '用户类型，如「备考学生」。' },
          description: { type: 'string' },
          needs: { type: 'string', description: '核心需求。' },
        },
      },
      description: '目标用户画像。',
    },
    user_stories: { type: 'array', minItems: 1, items: STORY_SCHEMA, description: '用户故事列表，至少 1 条，至少含 1 条 P0。' },
    features: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          priority: { type: 'string', enum: ['P0', 'P1', 'P2'] },
          description: { type: 'string' },
        },
      },
      description: '功能点列表。',
    },
    non_functional: { type: 'array', items: { type: 'string' }, description: '非功能需求：性能、安全、兼容性等，每条一句。' },
    scope: {
      type: 'object',
      properties: {
        in_scope: { type: 'array', items: { type: 'string' }, description: 'MVP 要做的事，至少 1 条（否则 prd_check 会判失败）。' },
        out_of_scope: { type: 'array', items: { type: 'string' }, description: '明确不做什么。' },
      },
    },
    metrics: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: '指标名，如 DAU / 转化率 / P95 延迟。' },
          target: { type: 'string', description: '量化目标，如「≥ 5000」「< 500ms」。' },
        },
      },
      description: '成功指标。',
    },
    tech: { type: 'array', items: { type: 'string' }, description: '技术方案/技术栈/外部依赖，每条一句。' },
    insights: { type: 'string', description: '洞察分析 Markdown（六维度：行业洞察、用户痛点深挖、竞品盲区、反直觉判断、风险预判、增长杠杆）。' },
    competitive_analysis: { type: 'string', description: '竞品分析 Markdown（可选，用 web_search 调研后写）。' },
    template: { type: 'string', enum: TEMPLATES, description: '专项模板，默认 general；影响模型写内容时的检查项。' },
    assumptions: {
      type: 'array',
      description:
        '假设账本：AI 替用户做的决定必须显式记录（可空数组）。id/source/impact 必填，affects 里的用户故事 id 必须存在。',
      items: {
        type: 'object',
        required: ['id', 'statement', 'source', 'impact'],
        properties: {
          id: { type: 'string', description: '唯一 id，建议 A1 / A2（假设与待确认问题全局唯一）。' },
          statement: { type: 'string', description: '一句话写清你替用户决定了什么，例如「假设首版只支持 iOS」。' },
          source: { type: 'string', enum: ['user', 'inference', 'industry'], description: '来源：用户原话 / 推断 / 行业惯例。' },
          impact: { type: 'string', enum: ['blocks-p0', 'changes-scope', 'minor'], description: '影响：阻塞 P0 / 改变范围 / 影响较小。' },
          affects: { type: 'array', items: { type: 'string' }, description: '受影响的用户故事 id（必须存在）。' },
          evidence: { type: 'string', description: '依据：用户原话 / 搜索结果 / 行业惯例说明；impact=blocks-p0 时强烈建议写。' },
        },
      },
    },
    open_questions: {
      type: 'array',
      description:
        '待确认问题清单（可空数组）。被 blocks 指向的 P0 故事必须有 default_assumption 或被 assumptions 覆盖，否则 prd_check 报 error。',
      items: {
        type: 'object',
        required: ['id', 'question'],
        properties: {
          id: { type: 'string', description: '唯一 id，建议 Q1 / Q2。' },
          question: { type: 'string', description: '待用户确认的问题，一条一个问题。' },
          blocks: { type: 'array', items: { type: 'string' }, description: '被阻塞的用户故事 id（必须存在）。' },
          default_assumption: {
            type: 'string',
            description: '默认假设：assumptions 里的 id（如 "A2"）或直接一句话；P0 被阻塞时必须给。',
          },
          owner: { type: 'string', description: '谁来回答（用户 / 法务 / 老板 / 产品负责人…）。' },
        },
      },
    },
  },
}

export const prdWriteTool = {
  name: 'prd_write',
  description:
    '把结构化 PRD 对象写成 5 个文件到指定目录：prd.md（10 章）、prd.json（snarktank/ralph 兼容，供 AI coding agent 执行）、acceptance.md（按 P0/P1/P2 分组的 Given-When-Then 勾选清单）、mindmap.mmd、flowchart.mmd。字段校验严格：缺 name/summary/user_stories 或任一故事的 acceptance_criteria 会直接报错并列出缺什么；assumptions/open_questions 账本会校验 id 唯一、source/impact 枚举、affects/blocks 引用存在。用户要写 PRD、生成需求文档、做验收清单、导出 Ralph 任务时使用。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['dir', 'prd'],
    properties: {
      dir: {
        type: 'string',
        description:
          '输出目录的绝对路径（先用 working_directory 拿到工作区路径），例如 <工作区>/prd-daily-checkin。目录不存在会自动创建；同名文件会覆盖。',
      },
      prd: { ...PRD_SCHEMA, description: '结构化 PRD 对象。字段说明见 prd-generator skill 的 references/prd-template.md。至少 name/summary/user_stories，每条故事至少 1 条 acceptance_criteria。' },
      formats: {
        type: 'array',
        items: { type: 'string', enum: FORMATS },
        description: '要生成的文件类型，可选 md / json / acceptance / mindmap / flowchart；不传则生成全部 5 个。',
      },
    },
  },
  timeoutMs: 30_000,
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'dir', 'files', 'stats', 'warnings', 'replaced'],
      properties: {
        ok: { type: 'boolean' },
        dir: { type: 'string' },
        files: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['format', 'path', 'bytes'],
            properties: {
              format: { type: 'string' },
              path: { type: 'string' },
              bytes: { type: 'integer' },
            },
          },
        },
        stats: STATS_SCHEMA,
        warnings: { type: 'array', items: { type: 'string' } },
        replaced: { type: 'integer' },
      },
    },
    render: (_args, value) => {
      const lines = []
      lines.push(`已生成 PRD：${value.dir}`)
      lines.push('')
      for (const file of value.files) lines.push(`- ${file.path}（${formatBytes(file.bytes)}）`)
      lines.push('')
      lines.push(`统计：${formatCounts(value.stats)}，${value.stats.features} 个功能点，MVP 范围做 ${value.stats.inScope} 项 / 不做 ${value.stats.outOfScope} 项。`)
      if (value.replaced > 0) lines.push(`已覆盖 ${value.replaced} 个同名旧文件。`)
      lines.push('')
      if (value.warnings.length) {
        lines.push(`校验通过，但有 ${value.warnings.length} 条提醒（不阻塞，建议下一轮补齐）：`)
        for (const warning of value.warnings) lines.push(`- ${warning}`)
      } else {
        lines.push('校验通过，无警告。')
      }
      lines.push('')
      lines.push('下一步：调用 prd_check（path 传上面的目录）确认 prd.json 合规；若报错，按提示补字段后重新 prd_write。给用户汇报时可直接 read prd.md 做摘要，别把全文贴进对话。')
      return text(lines.join('\n'))
    },
  },
  async execute(args) {
    if (!isPlainObject(args)) throw new Error('prd_write 参数必须是对象：{dir, prd, formats?}。')
    const dir = requireAbsolute(
      args.dir,
      'dir',
      '先调用 working_directory 拿到工作区绝对路径，再用 <工作区>/prd-<功能 slug> 作为 dir。',
    )
    const formats = normalizeFormats(args.formats)

    const { ok, errors, warnings, prd } = validatePrdInput(args.prd)
    if (!ok) {
      const details = errors.map((message, index) => `${index + 1}. ${message}`).join('\n')
      throw new Error(
        `prd 校验失败（${errors.length} 处问题），未写任何文件：\n${details}\n\n补齐后重新调用 prd_write（同一个 dir 会覆盖同名文件）。字段格式见 prd-generator skill 的 references/prd-template.md。`,
      )
    }

    try {
      const info = await stat(dir)
      if (!info.isDirectory()) {
        throw new Error(`dir 已存在但不是目录：${dir}。请换一个目录路径（例如 ${dir}-prd）。`)
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }

    const generatedAt = new Date().toISOString()
    const entries = buildEntries(prd, formats, generatedAt)
    const replaced = entries.filter((entry) => existsSync(join(dir, entry.fileName))).length
    const files = await writeOutputFiles(dir, entries)
    const stats = computeStats(prd)

    return { ok: true, dir, files, stats, warnings, replaced }
  },
}

const EMPTY_CHECK_STATS = {
  stories: 0,
  acceptanceCriteria: 0,
  p0: 0,
  p1: 0,
  p2: 0,
  inScope: 0,
  outOfScope: 0,
  assumptions: 0,
  openQuestions: 0,
}

export const prdCheckTool = {
  name: 'prd_check',
  description:
    '校验已有的 prd.json（Ralph 兼容格式）：JSON 是否合法、schema 字段、每条用户故事是否至少 1 条验收标准、是否有 P0、scope.in_scope 是否非空、用户故事 id 是否唯一；并校验假设账本：P0 故事被未确认问题阻塞且无默认假设时报 error，assumptions 为空 / blocks-p0 假设缺 evidence 时报 warning。返回 {ok, errors, warnings, stats}，errors 可直接指导修复。写完/改完 PRD 后自查用；纯本地，无网络。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['path'],
    properties: {
      path: {
        type: 'string',
        description: 'prd.json 的绝对路径，或包含 prd.json 的目录（通常是 prd_write 返回的 dir）。',
      },
    },
  },
  timeoutMs: 30_000,
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'path', 'errors', 'warnings', 'stats'],
      properties: {
        ok: { type: 'boolean' },
        path: { type: 'string' },
        errors: { type: 'array', items: { type: 'string' } },
        warnings: { type: 'array', items: { type: 'string' } },
        stats: CHECK_STATS_SCHEMA,
      },
    },
    render: (_args, value) => {
      const lines = []
      lines.push(`${value.ok ? '✅' : '❌'} prd.json ${value.ok ? '校验通过' : '校验未通过'}：${value.path}`)
      lines.push('')
      lines.push(`统计：${formatCounts(value.stats)}，scope.in_scope ${value.stats.inScope} 项 / out_of_scope ${value.stats.outOfScope} 项。`)
      lines.push('')
      if (value.ok) {
        if (value.warnings.length) {
          lines.push(`警告 ${value.warnings.length} 条（不阻塞发布，建议补）：`)
          for (const warning of value.warnings.slice(0, 10)) lines.push(`- ${warning}`)
          if (value.warnings.length > 10) lines.push(`- …还有 ${value.warnings.length - 10} 条，同上逻辑处理。`)
        } else {
          lines.push('无警告。')
        }
        lines.push('')
        lines.push('下一步：把 PRD 摘要与文件路径给用户（prd.md / acceptance.md），或按用户要求继续补竞品分析、调整 P0 范围后重新 prd_write 再校验。')
      } else {
        lines.push(`共 ${value.errors.length} 个错误，${value.warnings.length} 条警告。`)
        lines.push('')
        lines.push('错误（必须修）：')
        for (const [index, error] of value.errors.entries()) lines.push(`${index + 1}. ${error}`)
        if (value.warnings.length) {
          lines.push('')
          lines.push(`警告（建议修，${value.warnings.length} 条）：`)
          for (const warning of value.warnings.slice(0, 8)) lines.push(`- ${warning}`)
          if (value.warnings.length > 8) lines.push(`- …还有 ${value.warnings.length - 8} 条。`)
        }
        lines.push('')
        lines.push('推荐修法：修改 prd 对象后重新调用 prd_write（会覆盖 prd.json 与配套文件），再跑 prd_check；直接手改 prd.json 时保持结构不变，改完再校验。不要为了通过校验而删掉用户故事或验收标准。')
      }
      return text(lines.join('\n'))
    },
  },
  async execute(args) {
    if (!isPlainObject(args)) throw new Error('prd_check 参数必须是对象：{path}。')
    const target = requireAbsolute(
      args.path,
      'path',
      '传 prd.json 的绝对路径，或 prd_write 返回的 dir（包含 prd.json 的目录）。',
    )

    let info
    try {
      info = await stat(target)
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`找不到路径：${target}。请先运行 prd_write 生成 prd.json，或传 prd_write 返回的 dir（绝对路径）。`)
      }
      throw new Error(`读取路径失败：${error.message}（${target}）`)
    }

    let jsonPath = target
    if (info.isDirectory()) {
      jsonPath = join(target, FILE_NAMES.json)
      if (!existsSync(jsonPath)) {
        throw new Error(
          `目录里没有 prd.json：${target}。若只想校验某个 JSON 文件，请直接传文件绝对路径；若还没生成，先跑 prd_write（formats 需包含 "json"）或检查是否传错了目录。`,
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
      return {
        ok: false,
        path: jsonPath,
        errors: [`prd.json 不是合法 JSON：${error.message}。修法：重新运行 prd_write 覆盖生成（推荐），或按报错位置修好语法后重试 prd_check。`],
        warnings: [],
        stats: { ...EMPTY_CHECK_STATS },
      }
    }

    const { ok, errors, warnings, stats } = validatePrdJson(json)

    const dir = dirname(jsonPath)
    const missing = [FILE_NAMES.md, FILE_NAMES.acceptance].filter((fileName) => !existsSync(join(dir, fileName)))
    if (missing.length) {
      warnings.push(`同目录缺少 ${missing.join('、')}：prd_check 只校验 prd.json，完整交付建议重新跑 prd_write 生成全部格式。`)
    }

    return { ok, path: jsonPath, errors, warnings, stats }
  },
}

export const TOOLS = [prdWriteTool, prdCheckTool]
