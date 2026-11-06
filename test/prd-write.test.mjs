// prd_write 端到端测试：生成 5 个文件、断言内容、覆盖错误路径。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { prdWriteTool } from '../lib/tools.js'
import { makeTmpDir, validPrd } from './helpers.mjs'

const read = (dir, fileName) => readFile(join(dir, fileName), 'utf8')

test('生成全部 5 个文件，内容符合 GUIDE §8.2', async () => {
  const dir = await makeTmpDir()
  const value = await prdWriteTool.execute({ dir, prd: validPrd() })

  assert.equal(value.ok, true)
  assert.equal(value.dir, dir)
  assert.deepEqual(
    value.files.map((file) => file.format),
    ['md', 'json', 'acceptance', 'mindmap', 'flowchart'],
  )
  assert.deepEqual(value.stats, {
    stories: 3,
    acceptanceCriteria: 4,
    p0: 2,
    p1: 1,
    p2: 0,
    features: 2,
    inScope: 2,
    outOfScope: 2,
  })

  for (const file of value.files) {
    assert.ok(file.path.startsWith(dir), `${file.path} 应位于输出目录内`)
    assert.ok(file.bytes > 100, `${file.path} 内容过短`)
    const info = await stat(file.path)
    assert.ok(info.isFile())
  }

  // ---- prd.md：9 章 ----
  const md = await read(dir, 'prd.md')
  assert.match(md, /^# 每日打卡 \+ 跟读打分 · PRD/)
  for (const chapter of [
    '## 1. 功能概览',
    '## 2. 用户故事',
    '## 3. 功能详情',
    '## 4. 验收标准',
    '## 5. 非功能需求',
    '## 6. 技术考虑',
    '## 7. MVP 范围定义',
    '## 8. 成功指标',
    '## 9. 洞察与判断',
  ]) {
    assert.ok(md.includes(chapter), `prd.md 缺少章节 ${chapter}`)
  }
  assert.ok(md.includes('US-001'))
  assert.ok(md.includes('给定用户当天未打卡'))
  assert.ok(md.includes('维度一：行业洞察'))
  assert.ok(md.includes('竞品分析'))
  assert.ok(md.includes('MVP 后第一个迭代'))

  // ---- prd.json：Ralph 兼容结构 ----
  const json = JSON.parse(await read(dir, 'prd.json'))
  assert.equal(json.name, '每日打卡-跟读打分')
  assert.equal(json.title, '每日打卡 + 跟读打分')
  assert.equal(json.version, '1.0.0')
  assert.equal(json.description, validPrd().summary)
  assert.equal(json.user_stories.length, 3)
  assert.deepEqual(json.user_stories[0], validPrd().user_stories[0])
  assert.deepEqual(json.scope, validPrd().scope)
  assert.equal(json.tech_requirements.frontend.stack, '前端：React Native')
  assert.equal(json.tech_requirements.backend.stack, '后端：Node.js')
  assert.deepEqual(json.tech_requirements.database.schema, ['数据库：PostgreSQL'])
  assert.equal(json.non_functional.performance, '性能：评分接口 P95 < 1s')
  assert.ok(json.success_metrics.business.some((item) => item.includes('7 日留存')))
  assert.ok(json.success_metrics.technical.some((item) => item.includes('P95')))
  assert.equal(json._meta.generator, 'dsh-prd-generator')
  assert.equal(json._meta.template, 'mobile-app')
  assert.ok(!Number.isNaN(Date.parse(json._meta.generated_at)))

  // ---- acceptance.md：P0/P1/P2 分组 + Given-When-Then 勾选清单 ----
  const acceptance = await read(dir, 'acceptance.md')
  assert.ok(acceptance.includes('## 汇总'))
  assert.ok(acceptance.includes('## P0 · 必须完成（阻塞 MVP）'))
  assert.ok(acceptance.includes('## P1 · MVP 后第一个迭代'))
  assert.ok(acceptance.includes('## P2 · 长期规划'))
  const checkboxes = acceptance.match(/^- \[ \] 给定/gm) ?? []
  assert.equal(checkboxes.length, 4, `acceptance.md 应有 4 个勾选项，实际 ${checkboxes.length}`)
  assert.ok(acceptance.includes('US-001'))
  assert.ok(acceptance.includes('实现要点'))

  // ---- mermaid ----
  const mindmap = await read(dir, 'mindmap.mmd')
  assert.match(mindmap, /^mindmap\n {2}root\(\(/)
  assert.ok(mindmap.includes('US-001'))
  assert.ok(mindmap.includes('MVP 范围'))

  const flowchart = await read(dir, 'flowchart.mmd')
  assert.match(flowchart, /^flowchart TD\n/)
  assert.ok(flowchart.includes('Gate'))
  assert.ok(flowchart.includes('Launch'))
  assert.ok(flowchart.includes('明确不做'))
  assert.match(flowchart, /class N1,N2 p0;/)
})

test('formats 子集只生成指定文件；重复调用覆盖同名文件', async () => {
  const dir = await makeTmpDir()
  const onlyMd = await prdWriteTool.execute({ dir, prd: validPrd(), formats: ['md'] })
  assert.deepEqual(onlyMd.files.map((file) => file.format), ['md'])
  assert.equal(onlyMd.replaced, 0)
  await assert.rejects(stat(join(dir, 'prd.json')), { code: 'ENOENT' })
  const md = await read(dir, 'prd.md')
  assert.ok(!md.includes('`prd.json`（snarktank/ralph 兼容）'), '只生成 md 时不应把 prd.json 列为配套文件')
  assert.ok(md.includes('`flowchart.mmd`') === false)

  const all = await prdWriteTool.execute({ dir, prd: validPrd() })
  assert.equal(all.replaced, 1, '第二次运行应报告覆盖 1 个同名文件')
  const again = await prdWriteTool.execute({ dir, prd: validPrd() })
  assert.equal(again.replaced, 5)
})

test('dir 已存在但不是目录时报可操作错误', async () => {
  const base = await makeTmpDir()
  const filePath = join(base, 'not-a-dir')
  await writeFile(filePath, 'x', 'utf8')
  await assert.rejects(() => prdWriteTool.execute({ dir: filePath, prd: validPrd() }), /dir 已存在但不是目录/)
})

test('目录不存在时自动创建（支持多级目录）', async () => {
  const base = await makeTmpDir()
  const dir = join(base, 'nested', 'prd-demo')
  const value = await prdWriteTool.execute({ dir, prd: validPrd() })
  assert.equal(value.files.length, 5)
  assert.ok((await stat(dir)).isDirectory())
})

test('缺失 id / 优先级时自动补全并给 warning，但仍能生成', async () => {
  const dir = await makeTmpDir()
  const prd = validPrd()
  delete prd.user_stories[0].id
  delete prd.user_stories[1].priority
  const value = await prdWriteTool.execute({ dir, prd })
  assert.equal(value.ok, true)
  assert.ok(value.warnings.some((warning) => warning.includes('自动分配 US-001')))
  assert.ok(value.warnings.some((warning) => warning.includes('按 P1 处理')))
  const json = JSON.parse(await read(dir, 'prd.json'))
  assert.equal(json.user_stories[0].id, 'US-001')
  assert.equal(json.user_stories[1].priority, 'P1')
})

test('严格校验：缺 name / summary / user_stories / AC 都报错且不写文件', async () => {
  const base = await makeTmpDir()
  const cases = [
    { mutate: (prd) => delete prd.name, pattern: /prd\.name 缺失/ },
    { mutate: (prd) => delete prd.summary, pattern: /prd\.summary 缺失/ },
    { mutate: (prd) => delete prd.user_stories, pattern: /prd\.user_stories 缺失/ },
    { mutate: (prd) => { prd.user_stories = [] }, pattern: /prd\.user_stories 为空/ },
    {
      mutate: (prd) => { prd.user_stories[1].acceptance_criteria = [] },
      pattern: /prd\.user_stories\[1\]（US-002）\.acceptance_criteria 缺失/,
    },
    {
      mutate: (prd) => { prd.user_stories[0].acceptance_criteria = ['  ', ''] },
      pattern: /acceptance_criteria 全是空白/,
    },
    { mutate: (prd) => { prd.user_stories[0].id = 'US-002' }, pattern: /id 与 .* 重复/ },
    { mutate: (prd) => { prd.user_stories[0].priority = 'P3' }, pattern: /priority 是 "P3"/ },
  ]
  for (const [index, item] of cases.entries()) {
    const dir = join(base, `case-${index}`)
    const prd = validPrd()
    item.mutate(prd)
    await assert.rejects(() => prdWriteTool.execute({ dir, prd }), item.pattern, `case ${index} 未按预期报错`)
    await assert.rejects(stat(dir), { code: 'ENOENT' }, `case ${index} 校验失败时不应创建目录`)
  }
})

test('参数错误信息可操作：dir 缺失/相对路径、formats 非法、prd 非对象', async () => {
  await assert.rejects(
    () => prdWriteTool.execute({ dir: '', prd: validPrd() }),
    /dir 缺失或为空：.*working_directory/,
  )
  await assert.rejects(() => prdWriteTool.execute({ dir: 'relative/path', prd: validPrd() }), /dir 必须是绝对路径.*relative\/path/)
  await assert.rejects(
    () => prdWriteTool.execute({ dir: '/tmp/x', prd: validPrd(), formats: ['pdf'] }),
    /不支持的格式 "pdf".*md \/ json/s,
  )
  await assert.rejects(() => prdWriteTool.execute({ dir: '/tmp/x', prd: validPrd(), formats: [] }), /formats 必须是非空数组/)
  await assert.rejects(() => prdWriteTool.execute({ dir: '/tmp/x', prd: 'not-an-object' }), /prd 必须是 JSON 对象/)
})

test('未知字段/非法可选值给 warning 而不是静默丢弃', async () => {
  const dir = await makeTmpDir()
  const prd = validPrd({ template: 'desktop-app', version: '2.0.0' })
  const value = await prdWriteTool.execute({ dir, prd })
  assert.ok(value.warnings.some((warning) => warning.includes('template') && warning.includes('general')))
  assert.ok(value.warnings.some((warning) => warning.includes('未识别的字段') && warning.includes('version')))
  const json = JSON.parse(await read(dir, 'prd.json'))
  assert.equal(json._meta.template, 'general')
})

test('render 文本包含路径、统计和下一步提示', async () => {
  const dir = await makeTmpDir()
  const value = await prdWriteTool.execute({ dir, prd: validPrd() })
  const rendered = prdWriteTool.output.render({}, value)[0].text
  assert.ok(rendered.includes(dir))
  assert.ok(rendered.includes('3 条用户故事（P0 2 / P1 1 / P2 0）'))
  assert.ok(rendered.includes('4 条验收标准'))
  assert.ok(rendered.includes('prd_check'))
  assert.ok(rendered.includes('prd.md'))
})
