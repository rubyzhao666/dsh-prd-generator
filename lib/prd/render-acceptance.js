// 渲染 acceptance.md：按 P0 / P1 / P2 分组，每条故事一组 Given-When-Then 勾选清单。

import {
  GENERATOR,
  GENERATOR_VERSION,
  PRIORITIES,
  PRIORITY_LABELS,
  assumptionsForStory,
  blockingQuestionsWithoutDefault,
  computeStats,
  questionsBlockingStory,
  stripCheckMarks,
} from './schema.js'

function acCount(stories) {
  return stories.reduce((sum, story) => sum + story.acceptance_criteria.length, 0)
}

export function renderAcceptanceMd(prd, options = {}) {
  const generatedAt = options.generatedAt ?? new Date().toISOString()
  const stats = computeStats(prd)
  const lines = []

  lines.push(`# 验收清单 · ${prd.name}`)
  lines.push('')
  lines.push(`> ${prd.summary}`)
  lines.push('')
  lines.push('> 由 `prd.json` 同步生成：按 P0 / P1 / P2 分组，每条 Given-When-Then 都是一个勾选项。')
  lines.push('> 用法：开发/验收时逐条勾选为 `- [x]`；P0 全部勾满才可以发布 MVP。')
  lines.push('')

  lines.push('## 汇总')
  lines.push('')
  lines.push('| 优先级 | 含义 | 用户故事 | 验收标准 |')
  lines.push('| --- | --- | --- | --- |')
  for (const priority of PRIORITIES) {
    const stories = prd.user_stories.filter((story) => story.priority === priority)
    lines.push(`| ${priority} | ${PRIORITY_LABELS[priority].split('· ')[1]} | ${stories.length} | ${acCount(stories)} |`)
  }
  lines.push(`| 合计 | — | ${stats.stories} | ${stats.acceptanceCriteria} |`)
  lines.push('')

  for (const priority of PRIORITIES) {
    const stories = prd.user_stories.filter((story) => story.priority === priority)
    lines.push(`## ${PRIORITY_LABELS[priority]} — ${stories.length} 条故事 / ${acCount(stories)} 条验收`)
    lines.push('')
    if (!stories.length) {
      lines.push('_（无）_')
      lines.push('')
      continue
    }
    for (const story of stories) {
      const pending = story.priority === 'P0' && blockingQuestionsWithoutDefault(prd, story.id).length > 0
      lines.push(`### ${story.id}${pending ? ' ⚠ 待确认' : ''}`)
      lines.push('')
      lines.push(`> ${story.story}`)
      lines.push('')
      lines.push(`- 复杂度：${story.complexity}`)
      lines.push(`- 验收标准：${story.acceptance_criteria.length} 条`)
      // 假设与待确认账本（0.2.0）：让验收人能看出这条验收依赖哪个假设、被哪个问题阻塞。
      for (const assumption of assumptionsForStory(prd, story.id)) {
        lines.push(`- 依赖假设：${assumption.id}（${assumption.source}，${assumption.impact}）`)
      }
      for (const question of questionsBlockingStory(prd, story.id)) {
        lines.push(`- ⚠ 待确认：${question.id} — ${question.question}`)
      }
      if (story.tasks.length) {
        lines.push('- 实现要点：')
        for (const task of story.tasks) lines.push(`  - ${task}`)
      }
      lines.push('')
      for (const ac of story.acceptance_criteria) {
        lines.push(`- [ ] ${stripCheckMarks(ac)}`)
      }
      lines.push('')
    }
  }

  lines.push('---')
  lines.push('')
  lines.push(`*由 ${GENERATOR} v${GENERATOR_VERSION} 生成 · 生成时间：${generatedAt} · 修改需求后重新运行 prd_write 会覆盖本文件。*`)
  lines.push('')

  return lines.join('\n')
}
