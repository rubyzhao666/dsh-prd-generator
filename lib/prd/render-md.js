// 渲染 prd.md（10 章）。纯函数：输入归一化后的 prd，输出 Markdown 字符串。

import {
  ASSUMPTION_IMPACT_LABELS,
  ASSUMPTION_SOURCE_LABELS,
  GENERATOR,
  GENERATOR_VERSION,
  PRIORITY_LABELS,
  PRIORITIES,
  TEMPLATE_LABELS,
  assumptionsForStory,
  computeStats,
  mdCell,
  stripCheckMarks,
} from './schema.js'

function emptyHint(text) {
  return `> ${text}`
}

export function renderPrdMd(prd, options = {}) {
  const generatedAt = options.generatedAt ?? new Date().toISOString()
  const formats = Array.isArray(options.formats) && options.formats.length ? options.formats : ['md', 'json', 'acceptance', 'mindmap', 'flowchart']
  const stats = computeStats(prd)
  const template = TEMPLATE_LABELS[prd.template] ?? TEMPLATE_LABELS.general
  const lines = []

  lines.push(`# ${prd.name} · PRD`)
  lines.push('')
  lines.push(`> ${prd.summary}`)
  lines.push('')
  lines.push('| 项目 | 内容 |')
  lines.push('| --- | --- |')
  lines.push(`| 专项模板 | ${mdCell(`${template}（${prd.template}）`)} |`)
  lines.push(`| 生成时间 | ${generatedAt} |`)
  lines.push(`| 用户故事 | ${stats.stories} 条（P0 ${stats.p0} / P1 ${stats.p1} / P2 ${stats.p2}） |`)
  lines.push(`| 验收标准 | ${stats.acceptanceCriteria} 条 |`)
  lines.push(`| 功能点 | ${stats.features} 个 |`)
  lines.push(`| MVP 范围 | 做 ${stats.inScope} 项 / 不做 ${stats.outOfScope} 项 |`)
  lines.push('')

  // ---- 1. 功能概览 ----
  lines.push('## 1. 功能概览（Overview）')
  lines.push('')
  lines.push(`**一句话描述：** ${prd.summary}`)
  lines.push('')
  lines.push('### 背景与动机')
  lines.push('')
  lines.push(prd.background ? prd.background : emptyHint('未提供。下一轮建议补：为什么现在做、解决用户的什么痛点、当前替代方案的问题。'))
  lines.push('')
  lines.push('### 目标用户画像')
  lines.push('')
  if (prd.target_users.length) {
    lines.push('| 用户类型 | 描述 | 核心需求 |')
    lines.push('| --- | --- | --- |')
    for (const user of prd.target_users) {
      lines.push(`| ${mdCell(user.type)} | ${mdCell(user.description)} | ${mdCell(user.needs)} |`)
    }
  } else {
    lines.push(emptyHint('未提供。下一轮建议补主要用户 / 次要用户，以及他们的核心诉求。'))
  }
  lines.push('')

  // ---- 2. 用户故事 ----
  lines.push('## 2. 用户故事（User Stories）')
  lines.push('')
  if (prd.user_stories.length) {
    lines.push('| ID | 用户故事 | 优先级 | 复杂度 | 依赖假设 |')
    lines.push('| --- | --- | --- | --- | --- |')
    for (const story of prd.user_stories) {
      const dependencies = assumptionsForStory(prd, story.id).map((assumption) => assumption.id)
      lines.push(`| ${mdCell(story.id)} | ${mdCell(story.story)} | ${story.priority} | ${mdCell(story.complexity)} | ${dependencies.length ? mdCell(dependencies.join('、')) : '—'} |`)
    }
    lines.push('')
    lines.push('> 优先级定义：' + PRIORITIES.map((priority) => `${priority} = ${PRIORITY_LABELS[priority].split('· ')[1]}`).join('；') + '。')
  } else {
    lines.push(emptyHint('未提供用户故事。'))
  }
  lines.push('')

  // ---- 3. 功能详情 ----
  lines.push('## 3. 功能详情（Features）')
  lines.push('')
  lines.push('### 3.1 核心功能列表')
  lines.push('')
  if (prd.features.length) {
    lines.push('| 优先级 | 功能 | 说明 |')
    lines.push('| --- | --- | --- |')
    for (const feature of prd.features) {
      lines.push(`| ${feature.priority} | ${mdCell(feature.name)} | ${mdCell(feature.description)} |`)
    }
  } else {
    lines.push(emptyHint('未提供功能点。下一轮建议把用户故事拆成可交付的功能点（名称 + 优先级 + 一句话说明）。'))
  }
  lines.push('')
  lines.push('### 3.2 用户流程')
  lines.push('')
  if (formats.includes('flowchart')) lines.push('- 用户流程图：`flowchart.mmd`（Mermaid，可直接在 GitHub / Obsidian / 飞书 / VS Code 渲染）')
  if (formats.includes('mindmap')) lines.push('- 结构思维导图：`mindmap.mmd`')
  lines.push(`- 验收操作路径：见第 4 章${formats.includes('acceptance') ? '与 `acceptance.md`' : ''}`)
  lines.push('')
  lines.push('### 3.3 边界与明确不做的范围')
  lines.push('')
  if (prd.scope.out_of_scope.length) {
    for (const item of prd.scope.out_of_scope) lines.push(`- ❌ ${item}`)
  } else {
    lines.push(emptyHint('未提供。建议写明第一版明确不做什么，避免范围蔓延。'))
  }
  lines.push('')

  // ---- 4. 验收标准 ----
  lines.push('## 4. 验收标准（Acceptance Criteria）')
  lines.push('')
  if (prd.user_stories.length) {
    lines.push(`> 每条验收标准都应是可判定的 Given-When-Then，可直接转成测试用例${formats.includes('acceptance') ? '；勾选清单见 `acceptance.md`' : ''}。`)
    lines.push('')
    for (const story of prd.user_stories) {
      lines.push(`### ${story.id}（${story.priority} · ${story.complexity}）`)
      lines.push('')
      lines.push(`> ${story.story}`)
      lines.push('')
      for (const ac of story.acceptance_criteria) {
        lines.push(`- ✅ ${stripCheckMarks(ac)}`)
      }
      lines.push('')
    }
  } else {
    lines.push(emptyHint('未提供验收标准。'))
    lines.push('')
  }

  // ---- 5. 非功能需求 ----
  lines.push('## 5. 非功能需求（Non-Functional Requirements）')
  lines.push('')
  if (prd.non_functional.length) {
    for (const item of prd.non_functional) lines.push(`- ${item}`)
  } else {
    lines.push(emptyHint('未提供。建议至少写：性能（响应/加载）、安全（权限/加密）、兼容性（浏览器/平台/设备）。'))
  }
  lines.push('')

  // ---- 6. 技术考虑 ----
  lines.push('## 6. 技术考虑（Technical Considerations）')
  lines.push('')
  if (prd.tech.length) {
    for (const item of prd.tech) lines.push(`- ${item}`)
  } else {
    lines.push(emptyHint('未提供。建议写清技术栈、关键依赖、外部服务与主要技术风险。'))
  }
  lines.push('')
  if (prd.template !== 'general') {
    lines.push(`> 本 PRD 使用专项模板：**${template}**。专项检查项（页面清单 / 性能指标 / 接口清单 / 数据模型等）见 skill 的 \`references/templates/${prd.template}.md\`，对应内容已被拆进功能、非功能与技术考虑章节。`)
    lines.push('')
  }

  // ---- 7. MVP 范围 ----
  lines.push('## 7. MVP 范围定义（MVP Scope）')
  lines.push('')
  lines.push(`用户故事优先级分布：P0 ${stats.p0} 条 / P1 ${stats.p1} 条 / P2 ${stats.p2} 条。`)
  lines.push('')
  const rows = Math.max(prd.scope.in_scope.length, prd.scope.out_of_scope.length)
  if (rows > 0) {
    lines.push('| ✅ In Scope（MVP 要做） | ❌ Out of Scope（明确不做） |')
    lines.push('| --- | --- |')
    for (let index = 0; index < rows; index += 1) {
      lines.push(`| ${mdCell(prd.scope.in_scope[index])} | ${mdCell(prd.scope.out_of_scope[index])} |`)
    }
  } else {
    lines.push(emptyHint('未提供范围。至少写清 MVP 做什么（in_scope）与不做什么（out_of_scope）。'))
  }
  lines.push('')

  // ---- 8. 成功指标 ----
  lines.push('## 8. 成功指标（Success Metrics）')
  lines.push('')
  if (prd.metrics.length) {
    lines.push('| 指标 | 目标 |')
    lines.push('| --- | --- |')
    for (const metric of prd.metrics) lines.push(`| ${mdCell(metric.name)} | ${mdCell(metric.target)} |`)
  } else {
    lines.push(emptyHint('未提供。建议补可量化的业务指标、用户行为指标与技术指标。'))
  }
  lines.push('')

  // ---- 9. 洞察与判断 ----
  lines.push('## 9. 洞察与判断（Insights & Judgments）')
  lines.push('')
  lines.push(prd.insights ? prd.insights : emptyHint('未提供。可按 skill 的 `references/insight-analysis.md` 六个维度（行业洞察 / 用户痛点深挖 / 竞品盲区 / 反直觉判断 / 风险预判 / 增长杠杆）补充。'))
  lines.push('')
  if (prd.competitive_analysis) {
    lines.push('### 9.2 竞品分析（Competitive Analysis）')
    lines.push('')
    lines.push(prd.competitive_analysis)
    lines.push('')
  }

  // ---- 10. 假设与待确认 ----
  lines.push('## 10. 假设与待确认（Assumptions & Open Questions）')
  lines.push('')
  lines.push('> AI 在写 PRD 时替用户做的决定都记录在假设里；影响 P0 或范围的假设必须让用户确认。待确认问题有答案后，更新 `prd` 对象并重新生成。')
  lines.push('')
  lines.push('### 10.1 假设（Assumptions）')
  lines.push('')
  if (prd.assumptions.length) {
    lines.push('| ID | 陈述 | 来源 | 影响 | 受影响故事 | 依据 |')
    lines.push('| --- | --- | --- | --- | --- | --- |')
    for (const assumption of prd.assumptions) {
      const source = `${ASSUMPTION_SOURCE_LABELS[assumption.source] ?? assumption.source}（${assumption.source}）`
      const impact = `${ASSUMPTION_IMPACT_LABELS[assumption.impact] ?? assumption.impact}（${assumption.impact}）`
      lines.push(
        `| ${mdCell(assumption.id)} | ${mdCell(assumption.statement)} | ${mdCell(source)} | ${mdCell(impact)} | ${mdCell(assumption.affects.join('、'))} | ${mdCell(assumption.evidence)} |`,
      )
    }
  } else {
    lines.push(emptyHint('本次未提供 assumptions。AI 替用户做的决定必须显式记录；若全部来自用户原话，也请写至少 1 条 source=user 的假设。'))
  }
  lines.push('')
  lines.push('### 10.2 待确认问题（Open Questions）')
  lines.push('')
  if (prd.open_questions.length) {
    lines.push('| ID | 问题 | 阻塞故事 | 默认假设 | 负责人 |')
    lines.push('| --- | --- | --- | --- | --- |')
    for (const question of prd.open_questions) {
      lines.push(
        `| ${mdCell(question.id)} | ${mdCell(question.question)} | ${mdCell(question.blocks.join('、'))} | ${mdCell(question.default_assumption)} | ${mdCell(question.owner)} |`,
      )
    }
  } else {
    lines.push(emptyHint('本次未提供 open_questions（没有待确认问题也建议留空数组，并在 assumptions 里说明关键假设）。'))
  }
  lines.push('')

  lines.push('---')
  lines.push('')
  const outputs = []
  if (formats.includes('json')) outputs.push('`prd.json`（snarktank/ralph 兼容）')
  if (formats.includes('acceptance')) outputs.push('`acceptance.md`（P0/P1/P2 验收清单）')
  if (formats.includes('mindmap')) outputs.push('`mindmap.mmd`')
  if (formats.includes('flowchart')) outputs.push('`flowchart.mmd`')
  lines.push(`*本 PRD 由 PRD Creator（${GENERATOR}）v${GENERATOR_VERSION} 生成 · 模板：${prd.template} · 生成时间：${generatedAt}*`)
  if (outputs.length) lines.push(`*配套文件：${outputs.join(' · ')}*`)
  lines.push('')

  return lines.join('\n')
}
