// 测试共用：假 ctx、样例 PRD、JSON Schema 断言（不引第三方依赖）。

import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function fakeCtx() {
  const tools = new Map()
  const providers = []
  const effects = []
  const ctx = {
    effect(fn) {
      const cleanup = fn()
      effects.push(cleanup)
      return () => {}
    },
    tools: {
      register(tool) {
        tools.set(tool.name, tool)
        return () => tools.delete(tool.name)
      },
    },
    skills: { registerProvider(factory) { providers.push(factory()); return () => {} } },
    logger: { info() {}, warn() {}, error() {} },
  }
  return { ctx, tools, providers, effects }
}

export function makeTmpDir(prefix = 'dsh-prd-test-') {
  return mkdtemp(join(tmpdir(), prefix))
}

// 一条完整、合法的样例 PRD：3 条故事（P0 ×2 / P1 ×1）、4 条验收标准。
export function validPrd(overrides = {}) {
  return {
    name: '每日打卡 + 跟读打分',
    summary: '给英语学习 App 做每日打卡与跟读打分，让用户形成连续学习习惯。',
    background: '现有学习路径缺少即时反馈，用户三天内流失。',
    target_users: [
      { type: '备考学生', description: '每天有固定学习时间', needs: '看到进步与坚持记录' },
      { type: '职场学习者', description: '碎片时间学习', needs: '低门槛的每日任务' },
    ],
    user_stories: [
      {
        id: 'US-001',
        story: '作为学习者，我想要每天完成打卡任务，以便保持学习连续性',
        priority: 'P0',
        acceptance_criteria: [
          '给定用户当天未打卡，当完成 1 个跟读任务，那么记录打卡并展示连续天数',
          '给定用户已完成打卡，当再次完成跟读，那么打卡状态不变，仅累加学习记录',
        ],
        tasks: ['打卡状态机', '连续天数计算'],
        complexity: 'medium',
      },
      {
        id: 'US-002',
        story: '作为学习者，我想要跟读句子并获得发音评分，以便针对性改进',
        priority: 'P0',
        acceptance_criteria: ['给定用户进入跟读页，当点击录音并跟读，那么 3 秒内返回评分与问题音素'],
        tasks: ['接入评分 API', '录音组件'],
        complexity: 'high',
      },
      {
        id: 'US-003',
        story: '作为学习者，我想要查看连续打卡天数和排行榜，以便获得成就感',
        priority: 'P1',
        acceptance_criteria: ['给定用户已打卡，当打开首页，那么展示连续天数与排行榜名次'],
        tasks: ['排行榜接口'],
        complexity: 'low',
      },
    ],
    features: [
      { name: '每日打卡', priority: 'P0', description: '状态机 + 连续天数' },
      { name: '跟读打分', priority: 'P0', description: '录音 + 发音评分' },
    ],
    non_functional: ['性能：评分接口 P95 < 1s', '安全：用户录音仅本地加密存储', '兼容性：iOS 15+ / Android 10+'],
    scope: {
      in_scope: ['打卡状态机', '跟读打分'],
      out_of_scope: ['社交好友', '付费订阅'],
    },
    metrics: [
      { name: '7 日留存', target: '≥ 35%' },
      { name: '接口 P95 延迟', target: '< 1s' },
    ],
    tech: ['前端：React Native', '后端：Node.js', '数据库：PostgreSQL'],
    insights:
      '### 维度一：行业洞察\n语言学习赛道增速放缓，但打卡类机制仍是留存核心。\n\n### 维度四：反直觉判断\n打卡不是功能，是承诺机制。',
    competitive_analysis: '## 竞品分析\n\n| 产品 | 卖点 |\n| --- | --- |\n| 竞品 A | 打卡提醒 |',
    template: 'mobile-app',
    ...overrides,
  }
}

// 精简版合法 prd.json（模拟人工/旧版本产物）。
export function validPrdJson(overrides = {}) {
  return {
    name: 'daily-checkin',
    version: '1.0.0',
    description: '每日打卡 + 跟读打分',
    goal: '让用户形成连续学习习惯',
    user_stories: [
      {
        id: 'US-001',
        story: '作为学习者，我想要每天完成打卡任务，以便保持学习连续性',
        priority: 'P0',
        acceptance_criteria: ['给定用户当天未打卡，当完成 1 个跟读任务，那么记录打卡并展示连续天数'],
        tasks: ['打卡状态机'],
        complexity: 'medium',
      },
      {
        id: 'US-002',
        story: '作为学习者，我想要查看连续打卡天数，以便获得成就感',
        priority: 'P1',
        acceptance_criteria: ['给定用户已打卡，当打开首页，那么展示连续天数'],
        tasks: ['首页展示'],
        complexity: 'low',
      },
    ],
    scope: { in_scope: ['打卡状态机'], out_of_scope: ['社交好友'] },
    non_functional: { performance: 'P95 < 1s', security: '', compatibility: 'iOS 15+' },
    success_metrics: { business: ['7 日留存：≥ 35%'], technical: [] },
    risks: [],
    ...overrides,
  }
}

function typeOf(value) {
  if (Array.isArray(value)) return 'array'
  if (value === null) return 'null'
  if (Number.isInteger(value)) return 'integer'
  return typeof value
}

// 轻量 JSON Schema 断言：覆盖 type/required/properties/items/enum/minItems/additionalProperties。
export function assertMatchesSchema(schema, value, path = '$') {
  if (schema.enum) {
    assert.ok(schema.enum.includes(value), `${path} 应为 enum 之一 ${JSON.stringify(schema.enum)}，实际 ${JSON.stringify(value)}`)
  }
  if (schema.type) {
    const actual = typeOf(value)
    const expected = schema.type === 'number' ? ['number', 'integer'] : [schema.type]
    assert.ok(expected.includes(actual), `${path} 类型应为 ${schema.type}，实际 ${actual}`)
  }
  if (schema.type === 'object') {
    for (const key of schema.required ?? []) {
      assert.ok(Object.hasOwn(value, key), `${path} 缺少必填字段 ${key}`)
    }
    if (schema.properties && schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        assert.ok(Object.hasOwn(schema.properties, key), `${path} 出现未声明字段 ${key}`)
      }
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(value, key)) assertMatchesSchema(child, value[key], `${path}.${key}`)
    }
  }
  if (schema.type === 'array') {
    assert.ok(Array.isArray(value), `${path} 应为数组`)
    if (schema.minItems != null) assert.ok(value.length >= schema.minItems, `${path} 至少 ${schema.minItems} 项`)
    if (schema.items) value.forEach((item, index) => assertMatchesSchema(schema.items, item, `${path}[${index}]`))
  }
  return true
}
