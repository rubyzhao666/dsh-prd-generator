// F2 验收标准 1–6：假设与待确认问题账本（0.2.0）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { prdCheckTool, prdWriteTool } from '../lib/tools.js'
import { blockingQuestionsWithoutDefault } from '../lib/prd/schema.js'
import { assertMatchesSchema, makeTmpDir, prdWithLedger, validPrd, validPrdJson } from './helpers.mjs'

const read = (dir, fileName) => readFile(join(dir, fileName), 'utf8')

// 取 acceptance.md 里某个故事小节（从 `### US-xxx` 到下一个 `###`）。
function storySection(acceptance, storyId) {
  const parts = acceptance.split(/\n### /)
  return parts.find((part) => part.startsWith(`${storyId}\n`) || part.startsWith(`${storyId} `) || part.startsWith(`${storyId}\r\n`)) ?? ''
}

test('验收 1（向后兼容）：不传 assumptions/open_questions 仍可写；prd_check 给 warning 而非 crash', async () => {
  const dir = await makeTmpDir()
  const value = await prdWriteTool.execute({ dir, prd: validPrd() })
  assertMatchesSchema(prdWriteTool.output.schema, value)
  assert.equal(value.stats.assumptions, 0)
  assert.equal(value.stats.openQuestions, 0)

  const json = JSON.parse(await read(dir, 'prd.json'))
  assert.deepEqual(json.assumptions, [])
  assert.deepEqual(json.open_questions, [])
  assert.equal(json._meta.assumption_count, 0)
  assert.equal(json._meta.open_question_count, 0)

  const md = await read(dir, 'prd.md')
  assert.ok(md.includes('## 10. 假设与待确认'))
  assert.ok(md.includes('本次未提供 assumptions'))

  const checked = await prdCheckTool.execute({ path: dir })
  assert.equal(checked.ok, true, checked.errors.join('\n'))
  assert.deepEqual(checked.errors, [])
  const warning = checked.warnings.find((item) => item.includes('assumptions 为空'))
  assert.ok(warning, `应提示 assumptions 为空，实际：${checked.warnings.join(' | ')}`)
  assert.ok(warning.includes('source=user'), 'warning 应说明「若全部来自用户原话就写 source=user 的假设」')

  // render 文本里给模型「假设 N 条 / 待确认 M 条」
  const writeRender = prdWriteTool.output.render({}, value)[0].text
  assert.ok(writeRender.includes('假设 0 条 / 待确认 0 条'))
  const checkRender = prdCheckTool.output.render({}, checked)[0].text
  assert.ok(checkRender.includes('假设 0 条 / 待确认 0 条'))
})

test('验收 2（三产物渲染）：prd.md 第 10 章 + 第 2 章依赖列、prd.json 顶层字段、acceptance 标记', async () => {
  const dir = await makeTmpDir()
  const prd = prdWithLedger()
  const value = await prdWriteTool.execute({ dir, prd })
  assertMatchesSchema(prdWriteTool.output.schema, value)
  assert.equal(value.stats.assumptions, 3)
  assert.equal(value.stats.openQuestions, 2)

  // ---- prd.md ----
  const md = await read(dir, 'prd.md')
  assert.ok(md.includes('## 10. 假设与待确认（Assumptions & Open Questions）'))
  assert.ok(md.includes('### 10.1 假设（Assumptions）'))
  assert.ok(md.includes('### 10.2 待确认问题（Open Questions）'))
  assert.ok(md.includes('| ID | 陈述 | 来源 | 影响 | 受影响故事 | 依据 |'))
  assert.ok(md.includes('| ID | 问题 | 阻塞故事 | 默认假设 | 负责人 |'))
  for (const id of ['A1', 'A2', 'A3', 'Q1', 'Q2']) assert.ok(md.includes(id), `prd.md 缺少 ${id}`)
  assert.ok(md.includes('推断（inference）'))
  assert.ok(md.includes('行业惯例（industry）'))
  assert.ok(md.includes('用户原话（user）'))
  assert.ok(md.includes('阻塞 P0（blocks-p0）'))
  assert.ok(md.includes('改变范围（changes-scope）'))

  // 第 2 章「依赖假设」列
  assert.ok(md.includes('| ID | 用户故事 | 优先级 | 复杂度 | 依赖假设 |'))
  const storyRow = (id) => md.split('\n').find((line) => line.startsWith(`| ${id} |`)) ?? ''
  assert.ok(storyRow('US-001').includes('A1'))
  assert.ok(!storyRow('US-001').includes('A2'))
  assert.ok(storyRow('US-002').includes('A2'))
  assert.ok(storyRow('US-003').includes('A3'))

  // ---- prd.json ----
  const rawJson = await read(dir, 'prd.json')
  assert.ok(!rawJson.includes('undefined'), 'prd.json 不应出现 undefined')
  const json = JSON.parse(rawJson)
  assert.equal(json.assumptions.length, 3)
  assert.deepEqual(json.assumptions[0], {
    id: 'A1',
    statement: '假设目标用户每天至少有 10 分钟连续学习时间',
    source: 'inference',
    impact: 'blocks-p0',
    affects: ['US-001'],
    evidence: '用户提到主要在通勤时学习，单次 10–15 分钟',
  })
  assert.equal(Object.hasOwn(json.assumptions[1], 'evidence'), false, '可选字段为空时应省略，而不是 undefined/null')
  assert.deepEqual(json.open_questions[0], {
    id: 'Q1',
    question: '发音评分服务的预算上限是多少？',
    blocks: ['US-002'],
    default_assumption: 'A2',
    owner: '产品负责人',
  })
  assert.equal(json.open_questions[1].default_assumption, '首版不做离线，弱网下允许补卡')
  assert.equal(json._meta.assumption_count, 3)
  assert.equal(json._meta.open_question_count, 2)

  // ---- acceptance.md ----
  const acceptance = await read(dir, 'acceptance.md')
  assert.ok(storySection(acceptance, 'US-001').includes('- 依赖假设：A1（inference，blocks-p0）'))
  assert.ok(storySection(acceptance, 'US-001').includes('- ⚠ 待确认：Q2 — 首版是否需要支持离线打卡？'))
  assert.ok(storySection(acceptance, 'US-002').includes('- 依赖假设：A2（industry，changes-scope）'))
  assert.ok(storySection(acceptance, 'US-002').includes('- ⚠ 待确认：Q1 — 发音评分服务的预算上限是多少？'))
  assert.ok(storySection(acceptance, 'US-003').includes('- 依赖假设：A3（user，minor）'))

  // ---- prd_check ----
  const checked = await prdCheckTool.execute({ path: dir })
  assertMatchesSchema(prdCheckTool.output.schema, checked)
  assert.equal(checked.ok, true, checked.errors.join('\n'))
  assert.deepEqual(checked.errors, [])
  assert.deepEqual(checked.warnings, [])
  assert.equal(checked.stats.assumptions, 3)
  assert.equal(checked.stats.openQuestions, 2)
})

test('验收 3（严格校验）：非法 source/impact、重复 id、悬空 affects/blocks → 逐条报错且不落盘', async () => {
  const base = await makeTmpDir()
  const cases = [
    { name: 'bad-source', mutate: (prd) => { prd.assumptions[0].source = 'guess' }, pattern: /source 是 "guess".*user \/ inference \/ industry/s },
    { name: 'bad-impact', mutate: (prd) => { prd.assumptions[0].impact = 'fatal' }, pattern: /impact 是 "fatal".*blocks-p0 \/ changes-scope \/ minor/s },
    { name: 'dup-assumption-id', mutate: (prd) => { prd.assumptions[1].id = 'A1' }, pattern: /id "A1" 重复/ },
    { name: 'cross-list-dup-id', mutate: (prd) => { prd.open_questions[0].id = 'A1' }, pattern: /id "A1" 重复/ },
    { name: 'dangling-affects', mutate: (prd) => { prd.assumptions[0].affects = ['US-999'] }, pattern: /affects 引用了不存在的用户故事 id：US-999/ },
    { name: 'dangling-blocks', mutate: (prd) => { prd.open_questions[0].blocks = ['US-999'] }, pattern: /blocks 引用了不存在的用户故事 id：US-999/ },
    { name: 'missing-statement', mutate: (prd) => { delete prd.assumptions[0].statement }, pattern: /statement 缺失/ },
    { name: 'missing-question', mutate: (prd) => { delete prd.open_questions[0].question }, pattern: /question 缺失/ },
    { name: 'missing-assumption-id', mutate: (prd) => { delete prd.assumptions[0].id }, pattern: /\.id 缺失/ },
    { name: 'missing-source', mutate: (prd) => { delete prd.assumptions[0].source }, pattern: /source 缺失/ },
    { name: 'missing-impact', mutate: (prd) => { delete prd.assumptions[0].impact }, pattern: /impact 缺失/ },
    { name: 'assumptions-not-array', mutate: (prd) => { prd.assumptions = 'A1' }, pattern: /assumptions 必须是数组/ },
    { name: 'open-questions-not-array', mutate: (prd) => { prd.open_questions = { id: 'Q1' } }, pattern: /open_questions 必须是数组/ },
    { name: 'affects-not-array', mutate: (prd) => { prd.assumptions[0].affects = 'US-001' }, pattern: /affects 必须是字符串数组/ },
    { name: 'blocks-not-array', mutate: (prd) => { prd.open_questions[0].blocks = 'US-001' }, pattern: /blocks 必须是字符串数组/ },
  ]
  for (const item of cases) {
    const dir = join(base, item.name)
    const prd = prdWithLedger()
    item.mutate(prd)
    await assert.rejects(() => prdWriteTool.execute({ dir, prd }), item.pattern, `${item.name} 未按预期报错`)
    await assert.rejects(stat(dir), { code: 'ENOENT' }, `${item.name} 校验失败时不应创建输出目录`)
  }
})

test('验收 4（P0 阻塞硬规则）：无默认假设 → error；补 default_assumption 后通过', async () => {
  const dir = await makeTmpDir()
  const prd = prdWithLedger()
  // 去掉覆盖 US-001 的 A1；US-001 是 P0，被 Q1 阻塞且 Q1 没有默认假设。
  prd.assumptions = prd.assumptions.filter((item) => item.id !== 'A1')
  prd.open_questions = [
    { id: 'Q1', question: '首版是否需要支持离线打卡？', blocks: ['US-001'], owner: '用户' },
    { id: 'Q2', question: '排行榜是否要做好友榜？', blocks: ['US-003'], owner: '用户' }, // P1，不触发硬规则
  ]
  await prdWriteTool.execute({ dir, prd })

  let checked = await prdCheckTool.execute({ path: dir })
  assert.equal(checked.ok, false)
  const error = checked.errors.find((item) => item.includes('P0 故事 US-001'))
  assert.ok(error, `应有 P0 阻塞 error，实际：${checked.errors.join(' | ')}`)
  assert.ok(error.includes('Q1'))
  assert.ok(error.includes('默认假设'))
  assert.ok(error.includes('降级'))
  assert.ok(!checked.errors.some((item) => item.includes('P0 故事 US-003')), 'P1 被阻塞不应报 error')

  // acceptance.md：该 P0 故事标题带 ⚠ 待确认
  const acceptance = await read(dir, 'acceptance.md')
  assert.ok(acceptance.includes('### US-001 ⚠ 待确认'))
  assert.ok(acceptance.includes('- ⚠ 待确认：Q1 — 首版是否需要支持离线打卡？'))

  // 补 default_assumption → 重新生成 → 通过（该故事标题不再带 ⚠）
  prd.open_questions[0].default_assumption = '首版不做离线，弱网下允许补卡'
  await prdWriteTool.execute({ dir, prd })
  checked = await prdCheckTool.execute({ path: dir })
  assert.equal(checked.ok, true, checked.errors.join('\n'))
  assert.deepEqual(checked.errors, [])
  const acceptanceAfter = await read(dir, 'acceptance.md')
  assert.ok(!acceptanceAfter.includes('### US-001 ⚠ 待确认'))
  assert.ok(acceptanceAfter.includes('- ⚠ 待确认：Q1 — 首版是否需要支持离线打卡？'))
})

test('验收 4 补充：P0 被阻塞但 assumptions[].affects 覆盖该故事 → 不报 error', async () => {
  const dir = await makeTmpDir()
  const prd = prdWithLedger()
  prd.assumptions = [
    { id: 'A1', statement: '假设首版不做离线', source: 'inference', impact: 'blocks-p0', affects: ['US-001'], evidence: '竞品首版也都不支持离线' },
  ]
  prd.open_questions = [{ id: 'Q1', question: '是否需要离线打卡？', blocks: ['US-001'], owner: '用户' }]
  await prdWriteTool.execute({ dir, prd })
  const checked = await prdCheckTool.execute({ path: dir })
  assert.equal(checked.ok, true, checked.errors.join('\n'))
  assert.deepEqual(checked.errors, [])
})

test('验收 5（旧格式兼容）：旧版 prd.json 无新字段仍可 check（warning 而非 crash）', async () => {
  const dir = await makeTmpDir()
  await writeFile(join(dir, 'prd.json'), `${JSON.stringify(validPrdJson(), null, 2)}\n`, 'utf8')
  const checked = await prdCheckTool.execute({ path: dir })
  assert.equal(checked.ok, true)
  assert.deepEqual(checked.errors, [])
  assert.ok(checked.warnings.some((item) => item.includes('assumptions 为空')))
  assert.equal(checked.stats.assumptions, 0)
  assert.equal(checked.stats.openQuestions, 0)

  // 手工塞坏类型也不 crash，只给 warning
  const broken = { ...validPrdJson(), assumptions: 'oops', open_questions: { id: 'Q1' } }
  await writeFile(join(dir, 'prd.json'), JSON.stringify(broken), 'utf8')
  const checkedBroken = await prdCheckTool.execute({ path: dir })
  assert.equal(checkedBroken.ok, true)
  assert.ok(checkedBroken.warnings.some((item) => item.includes('assumptions 不是数组')))
  assert.ok(checkedBroken.warnings.some((item) => item.includes('open_questions 不是数组')))
})

test('验收 6（acceptance.md 可读性）：能看出哪条验收依赖哪个假设/被哪个问题阻塞', async () => {
  const dir = await makeTmpDir()
  await prdWriteTool.execute({ dir, prd: prdWithLedger() })
  const acceptance = await read(dir, 'acceptance.md')
  const json = JSON.parse(await read(dir, 'prd.json'))

  // 每条「依赖假设」都能在 prd.json 的 affects 里找到依据
  for (const assumption of json.assumptions) {
    for (const storyId of assumption.affects) {
      const section = storySection(acceptance, storyId)
      assert.ok(
        section.includes(`- 依赖假设：${assumption.id}（${assumption.source}，${assumption.impact}）`),
        `${storyId} 小节应写明依赖 ${assumption.id}`,
      )
    }
  }
  // 每个被阻塞故事都能在 acceptance.md 看到「⚠ 待确认：Qx — 问题」
  for (const question of json.open_questions) {
    for (const storyId of question.blocks) {
      assert.ok(
        storySection(acceptance, storyId).includes(`- ⚠ 待确认：${question.id} — ${question.question}`),
        `${storyId} 小节应写明被 ${question.id} 阻塞`,
      )
    }
  }
  // 没有假设/问题的故事不出现多余标记
  assert.ok(!storySection(acceptance, 'US-003').includes('- ⚠ 待确认：'))
})

test('prd_check warning：impact=blocks-p0 的假设缺 evidence 时提示补依据', async () => {
  const dir = await makeTmpDir()
  const prd = prdWithLedger()
  prd.assumptions[0].evidence = '' // A1 是 blocks-p0
  await prdWriteTool.execute({ dir, prd })
  const checked = await prdCheckTool.execute({ path: dir })
  assert.equal(checked.ok, true)
  assert.ok(checked.warnings.some((item) => item.includes('impact=blocks-p0') && item.includes('evidence')))
})

test('账本 helper：blockingQuestionsWithoutDefault 覆盖默认假设 / affects 覆盖 / 未兜底三种情况', () => {
  const base = {
    user_stories: [],
    assumptions: [
      { id: 'A1', statement: 'x', source: 'inference', impact: 'blocks-p0', affects: ['US-001'], evidence: 'e' },
    ],
    open_questions: [
      { id: 'Q1', question: 'q1', blocks: ['US-001'], default_assumption: '' },
      { id: 'Q2', question: 'q2', blocks: ['US-002'], default_assumption: '' },
      { id: 'Q3', question: 'q3', blocks: ['US-003'], default_assumption: 'A1' },
    ],
  }
  // US-001 被 A1 覆盖 → 即使 Q1 无默认假设也不报
  assert.deepEqual(blockingQuestionsWithoutDefault(base, 'US-001'), [])
  // US-002 无覆盖、Q2 无默认假设 → 报
  assert.deepEqual(blockingQuestionsWithoutDefault(base, 'US-002').map((item) => item.id), ['Q2'])
  // US-003 的 Q3 有默认假设 → 不报
  assert.deepEqual(blockingQuestionsWithoutDefault(base, 'US-003'), [])
  // 没被任何问题阻塞的故事 → 不报
  assert.deepEqual(blockingQuestionsWithoutDefault(base, 'US-404'), [])
})
