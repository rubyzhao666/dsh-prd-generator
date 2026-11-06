#!/usr/bin/env node
// 手动冒烟：直接用真实样例跑一遍 prd_write + prd_check + prd_handoff（不依赖 DSH 进程）。
// 用法：node scripts/smoke.mjs [输出目录]
//   不传目录时写到系统临时目录，跑完打印文件路径，可手动打开检查。
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { prdCheckTool, prdHandoffTool, prdWriteTool } from '../lib/tools.js'

const dir = process.argv[2] ? resolve(process.argv[2]) : await mkdtemp(join(tmpdir(), 'dsh-prd-smoke-'))

// 0.4.0：冒烟也写入「PRD 项目」registry；用独立临时 DSH_HOME，避免把临时目录写进真实列表。
process.env.DSH_HOME = await mkdtemp(join(tmpdir(), 'dsh-prd-smoke-home-'))
console.log(`临时 DSH_HOME：${process.env.DSH_HOME}\n`)

const prd = {
  name: '每日打卡 + 跟读打分',
  summary: '给英语学习 App 做每日打卡与跟读打分，让用户形成连续学习习惯。',
  background: '现有学习路径缺少即时反馈，用户三天内流失。打卡是低成本高感知的习惯抓手，但只做统计不做反馈，留存依然会掉。',
  target_users: [
    { type: '备考学生', description: '每天固定学习 30 分钟', needs: '看到连续天数与进步' },
    { type: '职场学习者', description: '通勤碎片时间学习', needs: '低门槛的每日任务' },
  ],
  user_stories: [
    {
      id: 'US-001',
      story: '作为学习者，我想要每天完成打卡任务，以便保持学习连续性',
      priority: 'P0',
      acceptance_criteria: [
        '给定用户当天未打卡，当完成 1 个跟读任务，那么记录打卡并展示连续天数为 1',
        '给定用户已完成打卡，当再次完成跟读任务，那么打卡状态不变，仅累加学习记录',
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
  scope: { in_scope: ['打卡状态机', '跟读打分'], out_of_scope: ['社交好友', '付费订阅'] },
  metrics: [
    { name: '7 日留存', target: '≥ 35%' },
    { name: '接口 P95 延迟', target: '< 1s' },
  ],
  tech: ['前端：React Native', '后端：Node.js', '数据库：PostgreSQL'],
  insights:
    '### 维度一：行业洞察\n语言学习赛道增速放缓，但打卡机制仍是留存核心。\n\n### 维度四：反直觉判断\n打卡不是功能，是承诺机制。',
  competitive_analysis: '## 竞品分析\n\n| 产品 | 卖点 |\n| --- | --- |\n| 竞品 A | 打卡提醒 |',
  template: 'mobile-app',
  // 0.2.0：假设与待确认问题账本（会渲染进 3 个产物并被 prd_check 校验）
  assumptions: [
    {
      id: 'A1',
      statement: '假设目标用户每天至少有 10 分钟连续学习时间',
      source: 'inference',
      impact: 'blocks-p0',
      affects: ['US-001'],
      evidence: '用户提到主要在通勤时学习',
    },
    {
      id: 'A2',
      statement: '假设发音评分使用第三方 API，不自研模型',
      source: 'industry',
      impact: 'changes-scope',
      affects: ['US-002'],
    },
  ],
  open_questions: [
    {
      id: 'Q1',
      question: '发音评分服务的预算上限是多少？',
      blocks: ['US-002'],
      default_assumption: 'A2',
      owner: '产品负责人',
    },
  ],
}

console.log(`输出目录：${dir}\n`)
const written = await prdWriteTool.execute({ dir, prd })
console.log(prdWriteTool.output.render({}, written)[0].text)
console.log('\n--- prd_check ---\n')
const checked = await prdCheckTool.execute({ path: dir })
console.log(prdCheckTool.output.render({}, checked)[0].text)

if (!checked.ok) {
  console.error('\n冒烟失败：prd_check.ok === false')
  process.exitCode = 1
}

console.log('\n--- prd_handoff ---\n')
const handoff = await prdHandoffTool.execute({ path: dir })
console.log(prdHandoffTool.output.render({}, handoff)[0].text)

if (!handoff.ready) {
  console.error('\n冒烟失败：prd_handoff.ready === false')
  process.exitCode = 1
}
