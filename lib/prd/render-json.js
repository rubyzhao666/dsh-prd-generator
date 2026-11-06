// 渲染 prd.json（snarktank/ralph 兼容）。纯函数：输入归一化后的 prd，输出 JSON 对象/字符串。

import {
  FILE_NAMES,
  GENERATOR,
  GENERATOR_VERSION,
  classifyMetrics,
  classifyNonFunctional,
  classifyTech,
  slugify,
} from './schema.js'

const joinList = (list) => list.join('；')

function normalizeFormats(formats) {
  if (!Array.isArray(formats) || formats.length === 0) return ['md', 'json', 'acceptance', 'mindmap', 'flowchart']
  return formats
}

export function buildPrdJson(prd, options = {}) {
  const generatedAt = options.generatedAt ?? new Date().toISOString()
  const formats = normalizeFormats(options.formats)
  const tech = classifyTech(prd.tech)
  const nonFunctional = classifyNonFunctional(prd.non_functional)
  const metrics = classifyMetrics(prd.metrics)
  const assumptions = Array.isArray(prd.assumptions) ? prd.assumptions : []
  const openQuestions = Array.isArray(prd.open_questions) ? prd.open_questions : []

  return {
    // —— snarktank/ralph 认识的核心字段 ——
    name: slugify(prd.name),
    title: prd.name,
    version: '1.0.0',
    description: prd.summary,
    goal: prd.summary,
    user_stories: prd.user_stories.map((story) => ({
      id: story.id,
      story: story.story,
      priority: story.priority,
      acceptance_criteria: [...story.acceptance_criteria],
      tasks: [...story.tasks],
      complexity: story.complexity,
    })),
    scope: {
      in_scope: [...prd.scope.in_scope],
      out_of_scope: [...prd.scope.out_of_scope],
    },
    assumptions: assumptions.map((item) => {
      // 干净输出：可选字段为空时直接省略，不留 undefined / null。
      const clean = {
        id: item.id,
        statement: item.statement,
        source: item.source,
        impact: item.impact,
        affects: [...item.affects],
      }
      if (item.evidence) clean.evidence = item.evidence
      return clean
    }),
    open_questions: openQuestions.map((item) => {
      const clean = { id: item.id, question: item.question, blocks: [...item.blocks] }
      if (item.default_assumption) clean.default_assumption = item.default_assumption
      if (item.owner) clean.owner = item.owner
      return clean
    }),
    tech_requirements: {
      frontend: { stack: joinList(tech.frontend), components: [] },
      backend: { stack: joinList(tech.backend), apis: [] },
      database: { schema: [...tech.database] },
      dependencies: [...tech.dependencies],
    },
    non_functional: {
      performance: joinList(nonFunctional.performance),
      security: joinList(nonFunctional.security),
      compatibility: joinList(nonFunctional.compatibility),
      other: [...nonFunctional.other],
    },
    success_metrics: {
      business: [...metrics.business],
      technical: [...metrics.technical],
    },
    risks: [],
    // —— 生成元信息（Ralph 会忽略未知字段；给人和其他 agent 追溯用）——
    _meta: {
      generator: GENERATOR,
      generator_version: GENERATOR_VERSION,
      generated_at: generatedAt,
      template: prd.template,
      source_files: formats.map((format) => FILE_NAMES[format]).filter(Boolean),
      assumption_count: assumptions.length,
      open_question_count: openQuestions.length,
    },
  }
}

export function serializePrdJson(prd, options = {}) {
  return `${JSON.stringify(buildPrdJson(prd, options), null, 2)}\n`
}
