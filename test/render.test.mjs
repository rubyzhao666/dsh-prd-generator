// 纯函数单测：schema helpers、validatePrdInput 归一化、四个 renderer。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  classifyMetrics,
  classifyNonFunctional,
  classifyTech,
  computeStats,
  looksLikeGivenWhenThen,
  slugify,
  stripCheckMarks,
} from '../lib/prd/schema.js'
import { validatePrdInput, validatePrdJson } from '../lib/prd/validate.js'
import { renderPrdMd } from '../lib/prd/render-md.js'
import { buildPrdJson, serializePrdJson } from '../lib/prd/render-json.js'
import { renderAcceptanceMd } from '../lib/prd/render-acceptance.js'
import { renderFlowchart, renderMindmap } from '../lib/prd/render-mermaid.js'
import { validPrd, validPrdJson } from './helpers.mjs'

// 只给必填字段的 PRD，归一化后用来测 renderer 的空数据兜底。
function normalizedMinimal() {
  const result = validatePrdInput({
    name: '极简功能',
    summary: '只填必填字段的 PRD。',
    user_stories: [
      { id: 'US-001', story: '作为用户，我想要一个功能，以便完成目标', priority: 'P0', acceptance_criteria: ['给定条件，当操作，那么结果'] },
    ],
  })
  assert.equal(result.ok, true, result.errors.join('\n'))
  return result.prd
}

test('slugify 保留中英文与数字，其余折叠成 -', () => {
  assert.equal(slugify('每日打卡 + 跟读打分'), '每日打卡-跟读打分')
  assert.equal(slugify('Daily Check-in / v2'), 'daily-check-in-v2')
  assert.equal(slugify('!!!'), 'prd')
  assert.equal(slugify(''), 'prd')
  assert.equal(slugify('a'.repeat(80)).length <= 60, true)
})

test('stripCheckMarks / looksLikeGivenWhenThen', () => {
  assert.equal(stripCheckMarks('✅ 给定 A，当 B，那么 C'), '给定 A，当 B，那么 C')
  assert.equal(stripCheckMarks('- [ ] 给定 A，当 B，那么 C'), '给定 A，当 B，那么 C')
  assert.equal(stripCheckMarks('  用户可以看到列表  '), '用户可以看到列表')

  assert.equal(looksLikeGivenWhenThen('给定用户未登录，当点击收藏，那么跳转登录页'), true)
  assert.equal(looksLikeGivenWhenThen('✅ Given a user, When they click, Then redirect'), true)
  assert.equal(looksLikeGivenWhenThen('用户可以看到列表'), false)
  assert.equal(looksLikeGivenWhenThen('当条件满足时，那么展示结果'), true)
})

test('classifyTech / classifyNonFunctional / classifyMetrics', () => {
  const tech = classifyTech(['前端：React', '后端：Node.js', '数据库：PostgreSQL', '第三方：Stripe'])
  assert.deepEqual(tech.frontend, ['前端：React'])
  assert.deepEqual(tech.backend, ['后端：Node.js'])
  assert.deepEqual(tech.database, ['数据库：PostgreSQL'])
  assert.deepEqual(tech.dependencies, ['第三方：Stripe'])

  const nf = classifyNonFunctional(['性能：P95 < 1s', '安全：数据加密', '兼容性：iOS 15+', '可维护性：模块化'])
  assert.deepEqual(nf.performance, ['性能：P95 < 1s'])
  assert.deepEqual(nf.security, ['安全：数据加密'])
  assert.deepEqual(nf.compatibility, ['兼容性：iOS 15+'])
  assert.deepEqual(nf.other, ['可维护性：模块化'])

  const metrics = classifyMetrics([
    { name: '7 日留存', target: '≥ 35%' },
    { name: '接口 P95 延迟', target: '< 1s' },
  ])
  assert.deepEqual(metrics.business, ['7 日留存：≥ 35%'])
  assert.deepEqual(metrics.technical, ['接口 P95 延迟：< 1s'])
})

test('computeStats 统计故事 / AC / 优先级 / 范围', () => {
  const stats = computeStats(validPrd())
  assert.deepEqual(stats, {
    stories: 3,
    acceptanceCriteria: 4,
    p0: 2,
    p1: 1,
    p2: 0,
    features: 2,
    inScope: 2,
    outOfScope: 2,
  })
})

test('validatePrdInput 归一化可选字段并与默认值一致', () => {
  const result = validatePrdInput({ name: ' 名称 ', summary: ' 摘要 ', user_stories: [] })
  assert.equal(result.ok, false)
  assert.equal(result.prd.name, '名称')
  assert.equal(result.prd.summary, '摘要')
  assert.equal(result.prd.template, 'general')
  assert.deepEqual(result.prd.scope, { in_scope: [], out_of_scope: [] })
  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0], /user_stories 为空/)
})

test('validatePrdInput 对非对象 / 未知字段 / 非法 template 的处理', () => {
  const notObject = validatePrdInput('nope')
  assert.equal(notObject.ok, false)
  assert.match(notObject.errors[0], /prd 必须是 JSON 对象/)

  const result = validatePrdInput(validPrd({ template: 'x', extra: 1 }))
  assert.equal(result.ok, true)
  assert.equal(result.prd.template, 'general')
  assert.ok(result.warnings.some((warning) => warning.includes('template')))
  assert.ok(result.warnings.some((warning) => warning.includes('extra')))
})

test('validatePrdJson 是纯函数，能直接产出 errors/warnings/stats', () => {
  const ok = validatePrdJson(validPrdJson())
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.errors, [])
  assert.equal(ok.stats.stories, 2)

  const bad = validatePrdJson({ user_stories: [{ id: 'US-001', story: 'x', priority: 'P9', acceptance_criteria: [] }], scope: {} })
  assert.equal(bad.ok, false)
  assert.ok(bad.errors.some((error) => error.includes('priority 是 "P9"')))
  assert.ok(bad.errors.some((error) => error.includes('acceptance_criteria 缺失')))
  assert.ok(bad.errors.some((error) => error.includes('没有 P0')))
  assert.ok(bad.errors.some((error) => error.includes('scope.in_scope')))
})

test('renderPrdMd：极简 PRD 也稳定输出 9 章 + 空数据提示', () => {
  const prd = normalizedMinimal()
  const md = renderPrdMd(prd, { generatedAt: '2026-01-01T00:00:00.000Z' })
  assert.ok(md.startsWith('# 极简功能 · PRD'))
  for (const chapter of ['## 1. 功能概览', '## 9. 洞察与判断']) assert.ok(md.includes(chapter))
  assert.ok(md.includes('下一轮建议补'))
  assert.ok(md.includes('MVP 范围'))
})

test('renderAcceptanceMd：只有 P0 时也分组齐全、勾选框数量正确', () => {
  const prd = normalizedMinimal()
  const md = renderAcceptanceMd(prd, { generatedAt: '2026-01-01T00:00:00.000Z' })
  assert.ok(md.includes('## P0 · 必须完成（阻塞 MVP） — 1 条故事 / 1 条验收'))
  assert.ok(md.includes('## P1 · MVP 后第一个迭代 — 0 条故事 / 0 条验收'))
  assert.equal((md.match(/^- \[ \] /gm) ?? []).length, 1)
})

test('renderMindmap / renderFlowchart：最小数据也能输出合法 Mermaid 头', () => {
  const prd = normalizedMinimal()
  const mindmap = renderMindmap(prd)
  assert.match(mindmap, /^mindmap\n {2}root\(\(极简功能\)\)/)
  assert.ok(mindmap.includes('P0 必须完成'))
  // 子节点不能出现 ASCII 括号，否则 Mermaid mindmap 会误解成形状语法
  const childLines = mindmap.split('\n').slice(2)
  assert.ok(childLines.every((line) => !line.includes('(') && !line.includes(')')))

  const flowchart = renderFlowchart(prd)
  assert.match(flowchart, /^flowchart TD\n/)
  assert.ok(flowchart.includes('Launch'))
  assert.ok(flowchart.includes('Gate'), '有 P0 时应出现验收 Gate')

  const noP0 = validatePrdInput({
    name: '无 P0 功能',
    summary: '用于测试没有 P0 的兜底。',
    user_stories: [{ id: 'US-001', story: '作为用户，我想要功能', priority: 'P1', acceptance_criteria: ['给定条件，当操作，那么结果'] }],
  }).prd
  const noP0Flowchart = renderFlowchart(noP0)
  assert.match(noP0Flowchart, /^flowchart TD\n/)
  assert.ok(!noP0Flowchart.includes('Gate'), '没有 P0 时不应出现验收 Gate')
  assert.ok(noP0Flowchart.includes('未标 P0'))
})

test('buildPrdJson / serializePrdJson：Ralph 兼容结构 + 可解析 JSON', () => {
  const prd = validatePrdInput(validPrd()).prd
  const json = buildPrdJson(prd, { generatedAt: '2026-01-01T00:00:00.000Z', formats: ['md', 'json'] })
  assert.equal(json.name, '每日打卡-跟读打分')
  assert.equal(json.title, '每日打卡 + 跟读打分')
  assert.equal(json.user_stories[0].id, 'US-001')
  assert.equal(json._meta.source_files.includes('prd.md'), true)
  assert.equal(json._meta.source_files.includes('acceptance.md'), false)
  assert.equal(json._meta.generated_at, '2026-01-01T00:00:00.000Z')

  const text = serializePrdJson(prd)
  assert.ok(text.endsWith('\n'))
  const parsed = JSON.parse(text)
  assert.equal(parsed.user_stories.length, 3)
  assert.equal(parsed.scope.in_scope.length, 2)
})
