// 校验与归一化。分两套：
// - validatePrdInput：prd_write 的输入校验，缺 name/summary/user_stories/acceptance_criteria 直接判错；
// - validatePrdJson：prd_check 对已落盘 prd.json 的校验，返回 {ok, errors, warnings, stats}。
// 错误信息都按「哪里错了 + 怎么改」写，模型看完可以直接补齐重试。

import {
  ASSUMPTION_IMPACTS,
  ASSUMPTION_SOURCES,
  COMPLEXITIES,
  PRIORITIES,
  TEMPLATES,
  asTrimmedStringList,
  blockingQuestionsWithoutDefault,
  isNonEmptyString,
  isPlainObject,
  isPriority,
  looksLikeGivenWhenThen,
  oneLine,
  trimText,
} from './schema.js'

export const KNOWN_PRD_KEYS = [
  'name',
  'summary',
  'background',
  'target_users',
  'user_stories',
  'features',
  'non_functional',
  'scope',
  'metrics',
  'tech',
  'insights',
  'competitive_analysis',
  'template',
  'assumptions',
  'open_questions',
]

const KNOWN_STORY_KEYS = ['id', 'story', 'priority', 'acceptance_criteria', 'tasks', 'complexity']
const KNOWN_TARGET_USER_KEYS = ['type', 'description', 'needs']
const KNOWN_FEATURE_KEYS = ['name', 'priority', 'description']
const KNOWN_METRIC_KEYS = ['name', 'target']
const KNOWN_ASSUMPTION_KEYS = ['id', 'statement', 'source', 'impact', 'affects', 'evidence']
const KNOWN_OPEN_QUESTION_KEYS = ['id', 'question', 'blocks', 'default_assumption', 'owner']

function unknownKeys(object, known) {
  return Object.keys(object).filter((key) => !known.includes(key))
}

function warnUnknown(push, object, known, where) {
  const unknown = unknownKeys(object, known)
  if (unknown.length) push(`忽略了 ${where} 里未识别的字段：${unknown.join('、')}。可用字段：${known.join('、')}。`)
}

function normalizeTargetUsers(raw, warnings) {
  const users = []
  if (raw == null) return users
  if (!Array.isArray(raw)) {
    warnings.push('prd.target_users 应为数组 [{type, description, needs}]，已忽略。')
    return users
  }
  raw.forEach((user, index) => {
    const where = `prd.target_users[${index}]`
    if (!isPlainObject(user)) {
      warnings.push(`${where} 不是对象 {type, description, needs}，已忽略。`)
      return
    }
    warnUnknown((message) => warnings.push(message), user, KNOWN_TARGET_USER_KEYS, where)
    const type = trimText(user.type)
    const description = trimText(user.description)
    const needs = typeof user.needs === 'string' ? trimText(user.needs) : asTrimmedStringList(user.needs).join('；')
    if (!type && !description && !needs) {
      warnings.push(`${where} 全是空字段，已忽略。`)
      return
    }
    users.push({ type, description, needs })
  })
  return users
}

function normalizeFeatures(raw, warnings) {
  const features = []
  if (raw == null) return features
  if (!Array.isArray(raw)) {
    warnings.push('prd.features 应为数组 [{name, priority, description}]，已忽略。')
    return features
  }
  raw.forEach((feature, index) => {
    const where = `prd.features[${index}]`
    if (!isPlainObject(feature)) {
      warnings.push(`${where} 不是对象 {name, priority, description}，已忽略。`)
      return
    }
    warnUnknown((message) => warnings.push(message), feature, KNOWN_FEATURE_KEYS, where)
    const name = trimText(feature.name)
    if (!name) {
      warnings.push(`${where}.name 为空，已忽略；功能点至少要有名字。`)
      return
    }
    let priority = trimText(feature.priority).toUpperCase()
    if (!priority) priority = 'P1'
    else if (!isPriority(priority)) {
      warnings.push(`${where}.priority 是 "${feature.priority}"，已按 P1 处理；只能是 P0/P1/P2。`)
      priority = 'P1'
    }
    features.push({ name, priority, description: trimText(feature.description) })
  })
  return features
}

function normalizeMetrics(raw, warnings) {
  const metrics = []
  if (raw == null) return metrics
  if (!Array.isArray(raw)) {
    warnings.push('prd.metrics 应为数组 [{name, target}]，已忽略。')
    return metrics
  }
  raw.forEach((metric, index) => {
    const where = `prd.metrics[${index}]`
    if (!isPlainObject(metric)) {
      warnings.push(`${where} 不是对象 {name, target}，已忽略。`)
      return
    }
    warnUnknown((message) => warnings.push(message), metric, KNOWN_METRIC_KEYS, where)
    const name = trimText(metric.name)
    const target = trimText(metric.target)
    if (!name) {
      warnings.push(`${where}.name 为空，已忽略；指标要有名字（如 DAU / 转化率 / P95 延迟）。`)
      return
    }
    if (!target) warnings.push(`${where}（${name}）.target 为空：建议写可量化目标值，否则无法验收。`)
    metrics.push({ name, target })
  })
  return metrics
}

// 假设 / 待确认问题账本（0.2.0）：id 全局唯一、枚举、affects/blocks 引用必须存在的用户故事。
// 校验严格（error），归一化后写入 prd 对象，供三产物渲染与 prd.json 输出。
function normalizeAssumptions(raw, storyIds, ledgerIds, errors, warnings) {
  const assumptions = []
  if (raw == null) return assumptions
  if (!Array.isArray(raw)) {
    errors.push(
      'prd.assumptions 必须是数组（空数组允许）：[{id:"A1", statement:"你替用户决定了什么", source:"user|inference|industry", impact:"blocks-p0|changes-scope|minor", affects:["US-001"], evidence:"依据"}]。',
    )
    return assumptions
  }
  raw.forEach((item, index) => {
    const where = `prd.assumptions[${index}]`
    if (!isPlainObject(item)) {
      errors.push(`${where} 不是对象：应为 {id, statement, source, impact, affects?, evidence?}。`)
      return
    }
    warnUnknown((message) => warnings.push(message), item, KNOWN_ASSUMPTION_KEYS, where)

    const id = trimText(item.id)
    if (!id) {
      errors.push(`${where}.id 缺失：给假设一个唯一 id，建议 "A1"、"A2"。`)
    } else {
      const previous = ledgerIds.get(id)
      if (previous) errors.push(`${where}.id "${id}" 重复（已出现在 ${previous}）：assumptions / open_questions 的 id 必须唯一。`)
      else ledgerIds.set(id, where)
    }

    const statement = trimText(item.statement)
    if (!statement) errors.push(`${where}.statement 缺失：一句话写清你替用户决定了什么（例如「假设首版只支持 iOS」）。`)

    const source = trimText(item.source).toLowerCase()
    if (!source) errors.push(`${where}.source 缺失：必须是 user / inference / industry 之一（用户原话 / 推断 / 行业惯例）。`)
    else if (!ASSUMPTION_SOURCES.includes(source)) {
      errors.push(`${where}.source 是 "${item.source}"：只能是 user / inference / industry（用户原话 / 推断 / 行业惯例）。`)
    }

    const impact = trimText(item.impact).toLowerCase()
    if (!impact) errors.push(`${where}.impact 缺失：必须是 blocks-p0 / changes-scope / minor 之一。`)
    else if (!ASSUMPTION_IMPACTS.includes(impact)) {
      errors.push(`${where}.impact 是 "${item.impact}"：只能是 blocks-p0 / changes-scope / minor（是否阻塞 P0 / 是否改变范围 / 影响较小）。`)
    }

    const affects = asTrimmedStringList(item.affects)
    if (item.affects != null) {
      if (!Array.isArray(item.affects)) {
        errors.push(`${where}.affects 必须是字符串数组（受影响的用户故事 id）。`)
      } else {
        const missing = affects.filter((storyId) => !storyIds.has(storyId))
        if (missing.length) {
          errors.push(`${where}.affects 引用了不存在的用户故事 id：${missing.join('、')}。可用的故事 id：${[...storyIds].join('、') || '（无）'}。`)
        }
      }
    }

    assumptions.push({ id, statement, source, impact, affects, evidence: trimText(item.evidence) })
  })
  return assumptions
}

function normalizeOpenQuestions(raw, storyIds, ledgerIds, errors, warnings) {
  const questions = []
  if (raw == null) return questions
  if (!Array.isArray(raw)) {
    errors.push('prd.open_questions 必须是数组（空数组允许）：[{id:"Q1", question:"待确认问题", blocks:["US-001"], default_assumption:"A1 或一句话", owner:"谁来回答"}]。')
    return questions
  }
  raw.forEach((item, index) => {
    const where = `prd.open_questions[${index}]`
    if (!isPlainObject(item)) {
      errors.push(`${where} 不是对象：应为 {id, question, blocks?, default_assumption?, owner?}。`)
      return
    }
    warnUnknown((message) => warnings.push(message), item, KNOWN_OPEN_QUESTION_KEYS, where)

    const id = trimText(item.id)
    if (!id) {
      errors.push(`${where}.id 缺失：给待确认问题一个唯一 id，建议 "Q1"、"Q2"。`)
    } else {
      const previous = ledgerIds.get(id)
      if (previous) errors.push(`${where}.id "${id}" 重复（已出现在 ${previous}）：assumptions / open_questions 的 id 必须唯一。`)
      else ledgerIds.set(id, where)
    }

    const question = trimText(item.question)
    if (!question) errors.push(`${where}.question 缺失：写出要用户确认的问题（例如「首版是否支持 Android？」）。`)

    const blocks = asTrimmedStringList(item.blocks)
    if (item.blocks != null) {
      if (!Array.isArray(item.blocks)) {
        errors.push(`${where}.blocks 必须是字符串数组（被阻塞的用户故事 id）。`)
      } else {
        const missing = blocks.filter((storyId) => !storyIds.has(storyId))
        if (missing.length) {
          errors.push(`${where}.blocks 引用了不存在的用户故事 id：${missing.join('、')}。可用的故事 id：${[...storyIds].join('、') || '（无）'}。`)
        }
      }
    }

    questions.push({
      id,
      question,
      blocks,
      default_assumption: trimText(item.default_assumption),
      owner: trimText(item.owner),
    })
  })
  return questions
}

// prd_write 输入校验。返回归一化后的 prd（即使有错也返回，方便调试），由调用方决定是否落盘。
export function validatePrdInput(raw) {
  const errors = []
  const warnings = []
  const empty = {
    name: '',
    summary: '',
    background: '',
    target_users: [],
    user_stories: [],
    features: [],
    non_functional: [],
    scope: { in_scope: [], out_of_scope: [] },
    metrics: [],
    tech: [],
    insights: '',
    competitive_analysis: '',
    template: 'general',
  }
  if (!isPlainObject(raw)) {
    return {
      ok: false,
      errors: ['prd 必须是 JSON 对象：至少包含 name、summary、user_stories[{id, story, priority, acceptance_criteria}]。格式见 skill 的 references/prd-template.md。'],
      warnings,
      prd: empty,
    }
  }

  warnUnknown((message) => warnings.push(message), raw, KNOWN_PRD_KEYS, 'prd')

  const name = trimText(raw.name)
  if (!name) {
    errors.push('prd.name 缺失或为空：给功能起一个清晰的名字，例如 "每日打卡 + 跟读打分"。')
  }

  const summary = trimText(raw.summary)
  if (!summary) {
    errors.push('prd.summary 缺失或为空：用一句话写清这个功能的核心价值（是什么 + 给谁 + 解决什么）。')
  }

  let background = ''
  if (raw.background != null) {
    if (typeof raw.background !== 'string') warnings.push('prd.background 应为字符串（Markdown 也可以），已忽略。')
    else background = trimText(raw.background)
  }

  const targetUsers = normalizeTargetUsers(raw.target_users, warnings)
  const features = normalizeFeatures(raw.features, warnings)

  // ---- 用户故事：name/summary/user_stories 与每条故事的 AC 是硬性要求 ----
  const stories = []
  if (raw.user_stories == null) {
    errors.push(
      'prd.user_stories 缺失：至少需要 1 条用户故事，格式 [{id:"US-001", story:"作为…，我想要…，以便…", priority:"P0", acceptance_criteria:["给定…，当…，那么…"], tasks:["…"], complexity:"medium"}]。',
    )
  } else if (!Array.isArray(raw.user_stories)) {
    errors.push('prd.user_stories 必须是数组（每个元素是一条用户故事对象），当前不是数组。')
  } else if (raw.user_stories.length === 0) {
    errors.push('prd.user_stories 为空：PRD 至少需要 1 条用户故事（P0 优先）。')
  } else {
    const seenIds = new Map()
    const gwtHints = []
    raw.user_stories.forEach((story, index) => {
      const where = `prd.user_stories[${index}]`
      if (!isPlainObject(story)) {
        errors.push(`${where} 不是对象：应为 {id, story, priority, acceptance_criteria[], tasks[], complexity}。`)
        return
      }
      warnUnknown((message) => warnings.push(message), story, KNOWN_STORY_KEYS, where)

      const storyText = trimText(story.story)
      if (!storyText) {
        errors.push(`${where}.story 缺失：写成「作为 [角色]，我想要 [功能]，以便 [价值]」。`)
      }

      let id = trimText(story.id)
      let autoAssigned = false
      if (!id) {
        // 自动分配时跳过已被占用的编号，避免和显式 id 撞车。
        let n = index + 1
        while (seenIds.has(`US-${String(n).padStart(3, '0')}`)) n += 1
        id = `US-${String(n).padStart(3, '0')}`
        autoAssigned = true
      }
      if (seenIds.has(id)) {
        errors.push(`${where}.id 与 user_stories[${seenIds.get(id)}] 重复（都是 "${id}"）：用户故事 id 必须唯一，改一个再重试。`)
      } else {
        seenIds.set(id, index)
      }
      if (autoAssigned) warnings.push(`${where}.id 缺失，已自动分配 ${id}；建议显式给唯一 id（US-001 这种格式）。`)

      let priority = trimText(story.priority).toUpperCase()
      if (!priority) {
        priority = 'P1'
        warnings.push(`${where}.priority 缺失，已按 P1 处理；MVP 必须至少有 1 条 P0。`)
      } else if (!isPriority(priority)) {
        errors.push(`${where}.priority 是 "${story.priority}"：只能是 P0 / P1 / P2（P0 = MVP 必须完成）。`)
        priority = 'P1'
      }

      const rawAc = story.acceptance_criteria
      const ac = asTrimmedStringList(rawAc)
      if (rawAc == null || !Array.isArray(rawAc) || rawAc.length === 0) {
        errors.push(
          `${where}（${id}）.acceptance_criteria 缺失：每条用户故事至少需要 1 条验收标准，例如 ["给定 [前置条件]，当 [操作]，那么 [预期结果]"]。`,
        )
      } else if (ac.length === 0) {
        errors.push(`${where}（${id}）.acceptance_criteria 全是空白：至少写 1 条非空的 Given-When-Then 验收标准。`)
      } else {
        if (ac.length !== rawAc.length) warnings.push(`${where}.acceptance_criteria 里有空值或非字符串条目，已忽略。`)
        const bad = ac.filter((item) => !looksLikeGivenWhenThen(item))
        if (bad.length) gwtHints.push(`${id} 的「${oneLine(bad[0], 40)}」等 ${bad.length} 条`)
      }

      let tasks = []
      if (story.tasks != null) {
        if (!Array.isArray(story.tasks)) warnings.push(`${where}.tasks 应为字符串数组，已忽略。`)
        else tasks = asTrimmedStringList(story.tasks)
      }

      let complexity = trimText(story.complexity).toLowerCase()
      if (!complexity) complexity = 'medium'
      else if (!COMPLEXITIES.includes(complexity)) {
        warnings.push(`${where}.complexity 是 "${story.complexity}"，已按 medium 处理；只能是 low / medium / high。`)
        complexity = 'medium'
      }

      stories.push({ id, story: storyText, priority, acceptance_criteria: ac, tasks, complexity })
    })
    if (gwtHints.length) {
      warnings.push(
        `有 ${gwtHints.length} 条验收标准不是「给定…，当…，那么…」格式（${gwtHints.slice(0, 3).join('；')}）：建议改写，prd_check 会给同类提示，acceptance.md 也更好用。`,
      )
    }
    const p0 = stories.filter((item) => item.priority === 'P0').length
    if (stories.length && p0 === 0) {
      warnings.push('所有用户故事都没有标 P0：prd_check 会因「缺 P0」判失败，建议把 MVP 必做的故事标成 P0。')
    }
  }

  // ---- 假设与待确认问题账本：id 全局唯一、枚举、affects/blocks 引用必须存在 ----
  const storyIds = new Set(stories.map((story) => story.id))
  const ledgerIds = new Map()
  const assumptions = normalizeAssumptions(raw.assumptions, storyIds, ledgerIds, errors, warnings)
  const openQuestions = normalizeOpenQuestions(raw.open_questions, storyIds, ledgerIds, errors, warnings)

  let nonFunctional = []
  if (raw.non_functional != null) {
    if (!Array.isArray(raw.non_functional)) warnings.push('prd.non_functional 应为字符串数组（性能/安全/兼容性…），已忽略。')
    else {
      nonFunctional = asTrimmedStringList(raw.non_functional)
      if (nonFunctional.length !== raw.non_functional.length) warnings.push('prd.non_functional 里有空值或非字符串条目，已忽略。')
    }
  }

  const scope = { in_scope: [], out_of_scope: [] }
  if (raw.scope != null) {
    if (!isPlainObject(raw.scope)) {
      warnings.push('prd.scope 应为对象 {in_scope: string[], out_of_scope: string[]}，已忽略。')
    } else {
      scope.in_scope = asTrimmedStringList(raw.scope.in_scope)
      scope.out_of_scope = asTrimmedStringList(raw.scope.out_of_scope)
      if (!scope.in_scope.length) warnings.push('prd.scope.in_scope 为空：写清 MVP 要做什么（≥1 条），否则 prd_check 会判失败。')
      if (!scope.out_of_scope.length) warnings.push('prd.scope.out_of_scope 为空：建议明确第一版不做什么，减少范围蔓延。')
    }
  } else {
    warnings.push('prd.scope 未提供：建议补 in_scope / out_of_scope，否则 prd_check 会因 in_scope 为空判失败。')
  }

  const metrics = normalizeMetrics(raw.metrics, warnings)

  let tech = []
  if (raw.tech != null) {
    if (!Array.isArray(raw.tech)) warnings.push('prd.tech 应为字符串数组（每个元素一条技术方案/依赖），已忽略。')
    else {
      tech = asTrimmedStringList(raw.tech)
      if (tech.length !== raw.tech.length) warnings.push('prd.tech 里有空值或非字符串条目，已忽略。')
    }
  }

  let insights = ''
  if (raw.insights != null) {
    if (typeof raw.insights !== 'string') warnings.push('prd.insights 应为 Markdown 字符串，已忽略。')
    else insights = trimText(raw.insights)
  }

  let competitiveAnalysis = ''
  if (raw.competitive_analysis != null) {
    if (typeof raw.competitive_analysis !== 'string') warnings.push('prd.competitive_analysis 应为 Markdown 字符串，已忽略。')
    else competitiveAnalysis = trimText(raw.competitive_analysis)
  }

  let template = trimText(raw.template)
  if (!template) template = 'general'
  else if (!TEMPLATES.includes(template)) {
    warnings.push(`prd.template 是 "${raw.template}"，已按 general 处理；可选值：${TEMPLATES.join(' / ')}。`)
    template = 'general'
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    prd: {
      name,
      summary,
      background,
      target_users: targetUsers,
      user_stories: stories,
      features,
      non_functional: nonFunctional,
      scope,
      metrics,
      tech,
      insights,
      competitive_analysis: competitiveAnalysis,
      template,
      assumptions,
      open_questions: openQuestions,
    },
  }
}

function checkStats(json) {
  const stories = Array.isArray(json?.user_stories) ? json.user_stories : []
  const stats = {
    stories: stories.length,
    acceptanceCriteria: 0,
    p0: 0,
    p1: 0,
    p2: 0,
    inScope: Array.isArray(json?.scope?.in_scope) ? asTrimmedStringList(json.scope.in_scope).length : 0,
    outOfScope: Array.isArray(json?.scope?.out_of_scope) ? asTrimmedStringList(json.scope.out_of_scope).length : 0,
    assumptions: Array.isArray(json?.assumptions) ? json.assumptions.length : 0,
    openQuestions: Array.isArray(json?.open_questions) ? json.open_questions.length : 0,
  }
  for (const story of stories) {
    if (!isPlainObject(story)) continue
    stats.acceptanceCriteria += Array.isArray(story.acceptance_criteria) ? asTrimmedStringList(story.acceptance_criteria).length : 0
    const priority = trimText(story.priority).toUpperCase()
    if (priority === 'P0') stats.p0 += 1
    else if (priority === 'P1') stats.p1 += 1
    else if (priority === 'P2') stats.p2 += 1
  }
  return stats
}

// prd_check 对 prd.json 的校验：schema / AC ≥1 / P0 存在 / in_scope 非空 / id 唯一。
export function validatePrdJson(json) {
  const errors = []
  const warnings = []
  if (!isPlainObject(json)) {
    return {
      ok: false,
      errors: ['prd.json 顶层必须是 JSON 对象（snarktank/ralph 兼容格式）：建议重新运行 prd_write 覆盖生成，或按 skill 的 references/ralph-json-format.md 修复。'],
      warnings,
      stats: { stories: 0, acceptanceCriteria: 0, p0: 0, p1: 0, p2: 0, inScope: 0, outOfScope: 0, assumptions: 0, openQuestions: 0 },
    }
  }

  if (!isNonEmptyString(json.name)) {
    warnings.push('prd.json 缺少 name：建议给功能一个 kebab-case 标识（如 daily-checkin），Ralph 会用它在分支/目录里标识任务。')
  }
  if (!isNonEmptyString(json.description) && !isNonEmptyString(json.goal)) {
    warnings.push('prd.json 缺少 description/goal：建议补一句话写清这个 PRD 的目标。')
  }

  const stories = json.user_stories
  if (!Array.isArray(stories) || stories.length === 0) {
    errors.push('user_stories 缺失或为空：Ralph 需要至少 1 条用户故事来拆任务；用 prd_write 重新生成，或手工补 user_stories 数组。')
  } else {
    const seenIds = new Map()
    stories.forEach((story, index) => {
      const where = `user_stories[${index}]`
      if (!isPlainObject(story)) {
        errors.push(`${where} 不是对象：应为 {id, story, priority, acceptance_criteria[], tasks[], complexity}。`)
        return
      }
      const id = trimText(story.id)
      if (!id) {
        errors.push(`${where}.id 缺失：补唯一 id，例如 "US-${String(index + 1).padStart(3, '0')}"。`)
      } else {
        if (seenIds.has(id)) {
          errors.push(`用户故事 id 重复："${id}" 同时出现在 user_stories[${seenIds.get(id)}] 和 ${where}；id 必须全局唯一。`)
        } else {
          seenIds.set(id, index)
        }
        if (!/^US-\d{2,}$/i.test(id)) {
          warnings.push(`${where}.id 是 "${id}"：建议用 US-001 这种格式，方便 acceptance.md 与 Ralph 对齐。`)
        }
      }

      if (!isNonEmptyString(story.story)) {
        errors.push(`${where}.story 缺失：写成「作为 [角色]，我想要 [功能]，以便 [价值]」。`)
      }

      const priority = trimText(story.priority).toUpperCase()
      if (!priority) {
        errors.push(`${where}.priority 缺失：必须是 P0 / P1 / P2；MVP 至少要有 1 条 P0。`)
      } else if (!isPriority(priority)) {
        errors.push(`${where}.priority 是 "${story.priority}"：只能是 P0 / P1 / P2（P0 = MVP 必须完成）。`)
      }

      const rawAc = story.acceptance_criteria
      const ac = asTrimmedStringList(rawAc)
      if (!Array.isArray(rawAc) || rawAc.length === 0) {
        errors.push(`${where}（${id || '无 id'}）的 acceptance_criteria 缺失或为空：每条用户故事至少 1 条验收标准（给定…，当…，那么…）。修法：在 prd 对象里补上该故事的 acceptance_criteria 后重新 prd_write。`)
      } else if (ac.length === 0) {
        errors.push(`${where}（${id || '无 id'}）的 acceptance_criteria 全是空白：至少写 1 条非空的 Given-When-Then 验收标准。`)
      } else {
        if (ac.length !== rawAc.length) warnings.push(`${where}.acceptance_criteria 里有空值或非字符串条目，会被忽略。`)
        const bad = ac.filter((item) => !looksLikeGivenWhenThen(item))
        if (bad.length) {
          warnings.push(`${id || where} 有 ${bad.length} 条验收标准不是「给定…，当…，那么…」格式（如「${oneLine(bad[0], 40)}」）：建议改写，方便直接转测试用例。`)
        }
      }

      if (!Array.isArray(story.tasks) || asTrimmedStringList(story.tasks).length === 0) {
        warnings.push(`${where}（${id || '无 id'}）的 tasks 为空：Ralph 执行时没有可拆解的开发任务，建议补 2–5 条。`)
      }

      const complexity = trimText(story.complexity).toLowerCase()
      if (!complexity) warnings.push(`${where}.complexity 缺失：建议 low / medium / high，Ralph 用来排期。`)
      else if (!COMPLEXITIES.includes(complexity)) warnings.push(`${where}.complexity 是 "${story.complexity}"：建议 low / medium / high。`)
    })

    const p0 = stories.filter((story) => isPlainObject(story) && trimText(story.priority).toUpperCase() === 'P0').length
    if (p0 === 0) {
      errors.push('没有 P0 用户故事：MVP 必须至少 1 条 priority="P0" 的故事，否则无法界定第一版范围。把最核心的故事标成 P0 后重新 prd_write。')
    }
  }

  if (!isPlainObject(json.scope)) {
    errors.push('scope 缺失：需要 {in_scope: [...], out_of_scope: [...]}；in_scope 至少 1 条，写明 MVP 做什么。')
  } else {
    const inScope = asTrimmedStringList(json.scope.in_scope)
    const outOfScope = asTrimmedStringList(json.scope.out_of_scope)
    if (!inScope.length) {
      errors.push('scope.in_scope 缺失或为空：必须写明 MVP 做什么（至少 1 条），否则 Ralph 无从判断完成边界。')
    }
    if (!outOfScope.length) {
      warnings.push('scope.out_of_scope 为空：建议明确第一版不做什么，避免范围蔓延。')
    }
  }

  const nf = json.non_functional
  const nfEmpty =
    nf == null ||
    (typeof nf === 'string' && !nf.trim()) ||
    (typeof nf === 'object' && !Array.isArray(nf) && Object.keys(nf).length === 0) ||
    (Array.isArray(nf) && nf.length === 0)
  if (nfEmpty) warnings.push('non_functional 为空：建议补性能/安全/兼容性要求，验收时才有硬约束。')

  const sm = json.success_metrics
  const smEmpty =
    sm == null ||
    (typeof sm === 'object' && !Array.isArray(sm) && Object.values(sm).every((value) => !value || (Array.isArray(value) && value.length === 0))) ||
    (Array.isArray(sm) && sm.length === 0)
  if (smEmpty) warnings.push('success_metrics 为空：建议补可量化的业务/技术指标。')

  // ---- 假设与待确认账本（0.2.0）----
  // 旧版 prd.json 没有这两个字段：只出 warning，不 crash、不判 error。
  const storyList = Array.isArray(stories) ? stories : []
  const storyIds = new Set(storyList.filter(isPlainObject).map((story) => trimText(story.id)).filter(Boolean))
  const ledgerIds = new Map()
  const ledgerAssumptions = []

  if (json.assumptions != null && !Array.isArray(json.assumptions)) {
    warnings.push('prd.json 的 assumptions 不是数组（应为 [{id, statement, source, impact, affects?, evidence?}]），已忽略。')
  } else if (Array.isArray(json.assumptions)) {
    json.assumptions.forEach((item, index) => {
      const where = `assumptions[${index}]`
      if (!isPlainObject(item)) {
        warnings.push(`${where} 不是对象，已忽略。`)
        return
      }
      const id = trimText(item.id)
      if (!id) warnings.push(`${where}.id 缺失：补唯一 id（建议 A1）；prd_check 的 P0 阻塞规则依赖它。`)
      else if (ledgerIds.has(id)) warnings.push(`${where}.id "${id}" 重复（已出现在 ${ledgerIds.get(id)}）：假设与待确认问题 id 必须唯一。`)
      else ledgerIds.set(id, where)

      const statement = trimText(item.statement)
      if (!statement) warnings.push(`${where}.statement 缺失：一句话写清 AI 替用户决定了什么。`)
      const source = trimText(item.source).toLowerCase()
      if (!ASSUMPTION_SOURCES.includes(source)) warnings.push(`${where}.source 是 "${item.source}"：建议 user / inference / industry。`)
      const impact = trimText(item.impact).toLowerCase()
      if (!ASSUMPTION_IMPACTS.includes(impact)) warnings.push(`${where}.impact 是 "${item.impact}"：建议 blocks-p0 / changes-scope / minor。`)
      const affects = asTrimmedStringList(item.affects)
      const missingAffects = affects.filter((storyId) => !storyIds.has(storyId))
      if (missingAffects.length) warnings.push(`${where}.affects 引用了不存在的用户故事 id：${missingAffects.join('、')}。`)
      ledgerAssumptions.push({
        id,
        statement,
        source,
        impact,
        affects,
        evidence: trimText(item.evidence),
        default_assumption: '',
      })
    })
  }

  const ledgerQuestions = []
  if (json.open_questions != null && !Array.isArray(json.open_questions)) {
    warnings.push('prd.json 的 open_questions 不是数组（应为 [{id, question, blocks?, default_assumption?, owner?}]），已忽略。')
  } else if (Array.isArray(json.open_questions)) {
    json.open_questions.forEach((item, index) => {
      const where = `open_questions[${index}]`
      if (!isPlainObject(item)) {
        warnings.push(`${where} 不是对象，已忽略。`)
        return
      }
      const id = trimText(item.id)
      if (!id) warnings.push(`${where}.id 缺失：补唯一 id（建议 Q1）。`)
      else if (ledgerIds.has(id)) warnings.push(`${where}.id "${id}" 重复（已出现在 ${ledgerIds.get(id)}）：假设与待确认问题 id 必须唯一。`)
      else ledgerIds.set(id, where)

      const question = trimText(item.question)
      if (!question) warnings.push(`${where}.question 缺失：写出待确认的问题。`)
      const blocks = asTrimmedStringList(item.blocks)
      const missingBlocks = blocks.filter((storyId) => !storyIds.has(storyId))
      if (missingBlocks.length) warnings.push(`${where}.blocks 引用了不存在的用户故事 id：${missingBlocks.join('、')}。`)
      ledgerQuestions.push({
        id,
        question,
        blocks,
        default_assumption: trimText(item.default_assumption),
        owner: trimText(item.owner),
      })
    })
  }

  // warning：AI 生成的 PRD 必须显式记录假设（旧格式也会命中，向后兼容的关键提示）。
  if (!Array.isArray(json.assumptions) || json.assumptions.length === 0) {
    warnings.push('assumptions 为空：AI 生成的 PRD 必须显式记录假设；若全部来自用户原话，请写明 source=user 的假设（至少 1 条）。')
  }

  // warning：阻塞 P0 的假设必须写依据，否则评审无法判断它是否成立。
  for (const item of ledgerAssumptions) {
    if (item.impact === 'blocks-p0' && !item.evidence) {
      warnings.push(
        `假设 ${item.id || '(无 id)'} 的 impact=blocks-p0，但 evidence 为空：补上依据（用户原话 / 搜索结果 / 行业惯例说明），否则评审时无法判断该假设是否成立。`,
      )
    }
  }

  // error：P0 故事被未确认问题阻塞，且既无 default_assumption、也无 affects 覆盖它的 assumptions。
  const ledger = { assumptions: ledgerAssumptions, open_questions: ledgerQuestions }
  for (const story of storyList) {
    if (!isPlainObject(story)) continue
    if (trimText(story.priority).toUpperCase() !== 'P0') continue
    const storyId = trimText(story.id)
    if (!storyId) continue
    const blockers = blockingQuestionsWithoutDefault(ledger, storyId)
    if (blockers.length) {
      errors.push(
        `P0 故事 ${storyId} 依赖未确认问题 ${blockers.map((question) => question.id || '(无 id)').join('、')}，且没有默认假设（open_questions[].default_assumption）、也没有 affects 覆盖它的 assumptions：必须先给默认假设或降级（把该故事改为 P1/P2）。`,
      )
    }
  }

  return { ok: errors.length === 0, errors, warnings, stats: checkStats(json) }
}

// 从已落盘 prd.json 读取假设 / 待确认账本（容错：非数组 / 非对象项静默忽略，字段缺失给空值）。
// prd_check 与 prd_handoff 共用一个读取口径，避免两处对同一份 prd.json 得出不同账本。
export function readLedger(json) {
  const assumptions = (Array.isArray(json?.assumptions) ? json.assumptions : [])
    .filter(isPlainObject)
    .map((item) => ({
      id: trimText(item.id),
      statement: trimText(item.statement),
      source: trimText(item.source).toLowerCase(),
      impact: trimText(item.impact).toLowerCase(),
      affects: asTrimmedStringList(item.affects),
      evidence: trimText(item.evidence),
    }))
  const openQuestions = (Array.isArray(json?.open_questions) ? json.open_questions : [])
    .filter(isPlainObject)
    .map((item) => ({
      id: trimText(item.id),
      question: trimText(item.question),
      blocks: asTrimmedStringList(item.blocks),
      default_assumption: trimText(item.default_assumption),
      owner: trimText(item.owner),
    }))
  return { assumptions, openQuestions }
}

export { PRIORITIES as VALID_PRIORITIES }
