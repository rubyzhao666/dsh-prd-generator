// 渲染 mindmap.mmd（思维导图）与 flowchart.mmd（用户流程）。纯函数，输出 Mermaid 源码。

import { PRIORITIES, extractHeadings, oneLine } from './schema.js'

const PRIORITY_SHORT = { P0: 'P0 必须完成', P1: 'P1 迭代', P2: 'P2 长期' }

// Mermaid mindmap 的节点文本会被当成形状/图标语法解析，去掉会误判的字符。
function mindmapText(value, max = 48) {
  return oneLine(value, max)
    .replace(/</g, '＜')
    .replace(/>/g, '＞')
    .replace(/[()[\]{}`"'|#]/g, '')
    .replace(/[:;]/g, '·')
    .replace(/\s+/g, ' ')
    .trim()
}

function flowText(value, max = 44) {
  return oneLine(value, max)
    .replace(/["`]/g, "'")
    .replace(/\|/g, '｜')
    .replace(/\r?\n/g, ' ')
}

export function renderMindmap(prd) {
  const lines = ['mindmap', `  root((${mindmapText(prd.name, 40)}))`]
  const add = (depth, text) => {
    lines.push(`${'  '.repeat(depth)}${text}`)
  }

  add(2, '功能概览')
  add(3, mindmapText(prd.summary, 56))
  if (prd.target_users.length) {
    add(3, '目标用户')
    for (const user of prd.target_users) {
      const text = [user.type, user.description || user.needs].filter(Boolean).join(' · ')
      add(4, mindmapText(text || '未命名用户', 48))
    }
  } else {
    add(3, '（未提供）')
  }

  add(2, '用户故事')
  let priorityGroups = 0
  for (const priority of PRIORITIES) {
    const stories = prd.user_stories.filter((story) => story.priority === priority)
    if (!stories.length) continue
    priorityGroups += 1
    add(3, PRIORITY_SHORT[priority])
    for (const story of stories) add(4, mindmapText(`${story.id} ${story.story}`, 46))
  }
  if (!priorityGroups) add(3, '（未提供）')

  add(2, '功能详情')
  if (prd.features.length) {
    for (const feature of prd.features) add(3, mindmapText(`${feature.name}（${feature.priority}）`, 44))
  } else {
    add(3, '（未提供）')
  }

  add(2, 'MVP 范围')
  add(3, 'In Scope · 做')
  if (prd.scope.in_scope.length) {
    for (const item of prd.scope.in_scope) add(4, mindmapText(item, 44))
  } else {
    add(4, '（未提供）')
  }
  add(3, 'Out of Scope · 不做')
  if (prd.scope.out_of_scope.length) {
    for (const item of prd.scope.out_of_scope) add(4, mindmapText(item, 44))
  } else {
    add(4, '（未提供）')
  }

  add(2, '成功指标')
  if (prd.metrics.length) {
    for (const metric of prd.metrics) add(3, mindmapText(`${metric.name} · ${metric.target || '目标待定'}`, 44))
  } else {
    add(3, '（未提供）')
  }

  add(2, '技术考虑')
  if (prd.tech.length) {
    for (const item of prd.tech) add(3, mindmapText(item, 44))
  } else {
    add(3, '（未提供）')
  }

  add(2, '洞察与判断')
  const headings = extractHeadings(prd.insights)
  if (headings.length) {
    for (const heading of headings) add(3, mindmapText(heading, 40))
  } else {
    add(3, '见 prd.md 第 9 章')
  }

  lines.push('')
  return lines.join('\n')
}

export function renderFlowchart(prd) {
  const lines = ['flowchart TD']
  const p0 = prd.user_stories.filter((story) => story.priority === 'P0')
  const p1 = prd.user_stories.filter((story) => story.priority === 'P1')
  const p2 = prd.user_stories.filter((story) => story.priority === 'P2')
  const mainStories = p0.length ? p0 : [...p1, ...p2]
  const postStories = p0.length ? [...p1, ...p2] : []

  lines.push(`    Start(["开始：${flowText(prd.name, 30)}"])`)
  let nodeCount = 0
  const addNode = (label) => {
    nodeCount += 1
    const id = `N${nodeCount}`
    lines.push(`    ${id}["${flowText(label)}"]`)
    return id
  }

  const p0NodeIds = []
  let previous = 'Start'
  for (const story of mainStories) {
    const id = addNode(`${story.id} ${story.story}`)
    lines.push(`    ${previous} --> ${id}`)
    if (p0.includes(story)) p0NodeIds.push(id)
    previous = id
  }

  if (p0.length) {
    lines.push(`    ${previous} --> Gate{"P0 验收全部通过？"}`)
    lines.push('    Gate -->|是| Launch(["发布 MVP"])')
    lines.push('    Gate -->|否| Fix["按 acceptance.md 逐条修复"]')
    lines.push('    Fix --> Gate')
  } else {
    lines.push(`    ${previous} --> Launch(["发布 MVP（未标 P0，建议先补）"])`)
  }

  // MVP 之后的故事用虚线表示迭代，串成一条链。
  previous = 'Launch'
  for (const story of postStories) {
    const id = addNode(`${story.id} ${story.story}`)
    lines.push(`    ${previous} -.-> ${id}`)
    previous = id
  }

  // 明确不做的范围：从 MVP 发布后分叉成虚线。
  const outOfScope = prd.scope.out_of_scope.slice(0, 5)
  outOfScope.forEach((item, index) => {
    lines.push(`    Out${index + 1}["${flowText(item, 36)}"]`)
    lines.push(`    Launch -. 明确不做 .-> Out${index + 1}`)
  })
  if (prd.scope.out_of_scope.length > outOfScope.length) {
    lines.push(`    OutMore["等 ${prd.scope.out_of_scope.length - outOfScope.length} 项（见 prd.md 第 7 章）"]`)
    lines.push('    Launch -. 明确不做 .-> OutMore')
  }

  if (p0NodeIds.length) {
    lines.push('    classDef p0 fill:#ffebe9,stroke:#d1242f,color:#1f2328;')
    lines.push(`    class ${p0NodeIds.join(',')} p0;`)
  }

  lines.push('')
  return lines.join('\n')
}
