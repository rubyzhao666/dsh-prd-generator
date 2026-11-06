// G2 验收标准 1–7：prd_handoff（执行前门禁 + handoff.md）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { prdCheckTool, prdHandoffTool, prdWriteTool } from '../lib/tools.js'
import {
  assertMatchesSchema,
  makeTmpDir,
  prdJsonWithLedger,
  prdWithLedger,
  validPrdJson,
} from './helpers.mjs'

const CHAPTERS = [
  '## 1. 执行前必须确认（blockers）',
  '## 2. 已采用的默认假设（执行时不得自行更改）',
  '## 3. 不要做的事（out of scope）',
  '## 4. 执行顺序与任务（按 P0 → P1 → P2）',
  '## 5. 验收门禁（交付即验收）',
  '## 6. 生成信息',
]

async function handoffDir(json) {
  const dir = await makeTmpDir()
  await writeFile(join(dir, 'prd.json'), `${JSON.stringify(json, null, 2)}\n`, 'utf8')
  return dir
}

const codesOf = (items) => items.map((item) => item.code)

test('验收 1：完整账本 + P0 有 tasks/AC/默认假设 → ready=true、blockers 空、handoff.md 正常生成', async () => {
  const dir = await makeTmpDir()
  await prdWriteTool.execute({ dir, prd: prdWithLedger() })
  const jsonBefore = await readFile(join(dir, 'prd.json'), 'utf8')

  const value = await prdHandoffTool.execute({ path: dir })
  assertMatchesSchema(prdHandoffTool.output.schema, value)
  assert.equal(value.ok, true)
  assert.equal(value.ready, true)
  assert.deepEqual(value.blockers, [])
  assert.deepEqual(value.warnings, [])
  assert.equal(value.docName, '每日打卡 + 跟读打分')
  assert.equal(value.path, join(dir, 'prd.json'))
  assert.equal(value.handoffPath, join(dir, 'handoff.md'))
  assert.deepEqual(value.stats, { stories: 3, p0: 2, assumptions: 3, openQuestions: 2, acceptanceCriteria: 4 })

  const md = await readFile(value.handoffPath, 'utf8')
  assert.equal(md, value.checklist)
  assert.ok(md.startsWith('# 执行交接单：每日打卡 + 跟读打分'))
  assert.ok(md.includes('门禁结论：可执行'))
  for (const heading of CHAPTERS) assert.ok(md.includes(heading), `handoff.md 缺少章节 ${heading}`)

  // 第 1 章：无 blocker
  assert.ok(md.includes('- 无 blockers'))
  // 第 2 章：假设格式与依据
  assert.ok(md.includes('- A1（inference，blocks-p0）：假设目标用户每天至少有 10 分钟连续学习时间 — 依据：'))
  assert.ok(md.includes('- A2（industry，changes-scope）：假设发音评分使用第三方 API，不自研声学模型 — 依据：未提供，执行前补充'))
  // 第 3 章：out of scope
  assert.ok(md.includes('- 社交好友'))
  assert.ok(md.includes('- 付费订阅'))
  // 第 4 章：P0 → P1 顺序 + 任务/验收格式
  assert.ok(md.includes('### US-001 · P0 ·'))
  assert.ok(md.includes('- 任务：1) 打卡状态机 2) 连续天数计算'))
  assert.ok(md.includes('- 验收：- [ ] 给定用户当天未打卡'))
  assert.ok(md.indexOf('### US-002') < md.indexOf('### US-003'), 'P0 故事应排在 P1 之前')
  // 第 5/6 章
  assert.ok(md.includes('全部 P0 故事的验收标准逐条通过；共 4 条 AC'))
  assert.ok(md.includes('有 blockers 时不得开工；当前无 blocker，可执行。'))
  assert.ok(md.includes('- generator：dsh-prd-generator v'))
  assert.ok(md.includes('故事与 AC 统计：3 条故事（P0 2 / P1 1 / P2 0）· 4 条验收标准'))

  // prd.json 未被修改
  assert.equal(await readFile(join(dir, 'prd.json'), 'utf8'), jsonBefore)
})

test('验收 2：四类 blocker 各一条 → ready=false、code 正确、handoff.md 第 1 章以勾选项列出', async () => {
  const cases = [
    {
      code: 'P0_BLOCKED_BY_OPEN_QUESTION',
      mutate(json) {
        json.assumptions = [{ id: 'A1', statement: '只做 iOS', source: 'inference', impact: 'minor', affects: [] }]
        json.open_questions = [{ id: 'Q1', question: '首版是否要 Android？', blocks: ['US-001'], owner: '用户' }]
      },
      refsIncludes: ['US-001', 'Q1'],
    },
    {
      code: 'P0_WITHOUT_TASKS',
      mutate(json) {
        json.user_stories[0].tasks = []
      },
      refsIncludes: ['US-001'],
    },
    {
      code: 'P0_WITHOUT_ACCEPTANCE',
      mutate(json) {
        json.user_stories[0].acceptance_criteria = []
      },
      refsIncludes: ['US-001'],
    },
    {
      code: 'BLOCKS_P0_ASSUMPTION_WITHOUT_EVIDENCE',
      mutate(json) {
        json.assumptions = [
          { id: 'A1', statement: '只做 iOS', source: 'inference', impact: 'blocks-p0', affects: ['US-001'] },
        ]
        json.open_questions = [
          { id: 'Q1', question: 'Android?', blocks: ['US-001'], default_assumption: 'A1', owner: '用户' },
        ]
      },
      refsIncludes: ['A1'],
    },
  ]

  for (const item of cases) {
    const json = prdJsonWithLedger()
    item.mutate(json)
    const dir = await handoffDir(json)
    const value = await prdHandoffTool.execute({ path: dir })
    assertMatchesSchema(prdHandoffTool.output.schema, value)
    assert.equal(value.ok, false, `${item.code}: ok 应跟随 ready`)
    assert.equal(value.ready, false, `${item.code}: ready 应为 false`)
    assert.deepEqual(codesOf(value.blockers), [item.code], `${item.code}: 应只命中该 blocker`)
    const blocker = value.blockers[0]
    assert.ok(blocker.message.length > 10)
    assert.ok(Array.isArray(blocker.refs))
    for (const ref of item.refsIncludes) assert.ok(blocker.refs.includes(ref), `${item.code}: refs 应含 ${ref}`)

    const md = await readFile(value.handoffPath, 'utf8')
    assert.ok(md.includes(`- [ ] ${blocker.message}`), `${item.code}: handoff.md 第 1 章应以勾选项列出 blocker`)
    assert.ok(md.includes('门禁结论：需先确认'))
  }
})

test('验收 3：三类 warning 各一条 → ready 仍为 true、code 正确', async () => {
  const cases = [
    {
      code: 'OPEN_QUESTION_WITHOUT_OWNER',
      mutate(json) {
        json.assumptions = [{ id: 'A1', statement: '只做 iOS', source: 'inference', impact: 'minor', affects: [] }]
        json.open_questions = [{ id: 'Q1', question: 'Android 什么时候做？' }]
      },
      refsIncludes: ['Q1'],
    },
    {
      code: 'NON_P0_BLOCKED',
      mutate(json) {
        json.assumptions = [{ id: 'A1', statement: '只做 iOS', source: 'inference', impact: 'minor', affects: [] }]
        json.open_questions = [{ id: 'Q1', question: '排行榜要好友榜吗？', blocks: ['US-002'], owner: '用户' }]
      },
      refsIncludes: ['US-002', 'Q1'],
    },
    {
      code: 'NO_ASSUMPTIONS',
      mutate(json) {
        json.assumptions = []
        json.open_questions = []
      },
      refsIncludes: [],
    },
  ]

  for (const item of cases) {
    const json = prdJsonWithLedger()
    item.mutate(json)
    const dir = await handoffDir(json)
    const value = await prdHandoffTool.execute({ path: dir })
    assert.equal(value.ready, true, `${item.code}: warning 不阻塞`)
    assert.deepEqual(value.blockers, [], `${item.code}: 不应有 blocker`)
    assert.deepEqual(codesOf(value.warnings), [item.code], `${item.code}: 应只命中该 warning`)
    const warning = value.warnings[0]
    for (const ref of item.refsIncludes) assert.ok(warning.refs.includes(ref))
    const md = await readFile(value.handoffPath, 'utf8')
    assert.ok(md.includes(`> - ${item.code}：`), `${item.code}: handoff.md 第 1 章应附警告`)
  }
})

test('验收 4：write=false 不写文件；write=true 写同目录、覆盖旧文件、内容含六章；原子写无临时文件残留', async () => {
  const dir = await handoffDir(prdJsonWithLedger())

  const noWrite = await prdHandoffTool.execute({ path: dir, write: false })
  assertMatchesSchema(prdHandoffTool.output.schema, noWrite)
  assert.equal(Object.hasOwn(noWrite, 'handoffPath'), false)
  assert.ok(!(await readdir(dir)).includes('handoff.md'))
  for (const heading of CHAPTERS) assert.ok(noWrite.checklist.includes(heading))

  await assert.rejects(() => prdHandoffTool.execute({ path: dir, write: 'yes' }), /write 必须是布尔值/)

  const written = await prdHandoffTool.execute({ path: dir, write: true })
  assert.equal(written.handoffPath, join(dir, 'handoff.md'))
  assert.equal(await readFile(written.handoffPath, 'utf8'), written.checklist)

  // 覆盖旧文件
  const jsonBefore = await readFile(join(dir, 'prd.json'), 'utf8')
  await writeFile(join(dir, 'handoff.md'), 'OLD CONTENT\n', 'utf8')
  const again = await prdHandoffTool.execute({ path: dir })
  const content = await readFile(join(dir, 'handoff.md'), 'utf8')
  assert.ok(!content.includes('OLD CONTENT'))
  assert.equal(content, again.checklist)
  assert.equal(await readFile(join(dir, 'prd.json'), 'utf8'), jsonBefore, 'handoff 不应修改 prd.json')

  const files = await readdir(dir)
  assert.ok(!files.some((file) => file.startsWith('.handoff.md.tmp')), '原子写不应残留临时文件')
  assert.deepEqual(files.sort(), ['handoff.md', 'prd.json'])
})

test('验收 5：path 传目录 / 文件均可；不存在、坏 JSON、缺 prd.json 等错误可操作', async () => {
  const dir = await handoffDir(prdJsonWithLedger())
  const byDir = await prdHandoffTool.execute({ path: dir, write: false })
  const byFile = await prdHandoffTool.execute({ path: join(dir, 'prd.json'), write: false })
  assert.equal(byDir.ready, true)
  assert.equal(byFile.ready, true)
  assert.equal(byDir.path, join(dir, 'prd.json'))
  assert.equal(byFile.path, join(dir, 'prd.json'))

  await assert.rejects(
    () => prdHandoffTool.execute({ path: '/tmp/dsh-handoff-does-not-exist-12345' }),
    /找不到路径.*prd_write/s,
  )

  const empty = await makeTmpDir()
  await assert.rejects(() => prdHandoffTool.execute({ path: empty }), /目录里没有 prd\.json.*prd_write/s)

  const badJson = await makeTmpDir()
  await writeFile(join(badJson, 'prd.json'), '{ "name": "x",, }', 'utf8')
  await assert.rejects(() => prdHandoffTool.execute({ path: badJson }), /不是合法 JSON.*prd_write/s)

  const arrayJson = await makeTmpDir()
  await writeFile(join(arrayJson, 'prd.json'), '[]', 'utf8')
  await assert.rejects(() => prdHandoffTool.execute({ path: arrayJson }), /顶层必须是 JSON 对象/)

  const mdDir = await makeTmpDir()
  await writeFile(join(mdDir, 'prd.md'), '# x', 'utf8')
  await assert.rejects(() => prdHandoffTool.execute({ path: join(mdDir, 'prd.md') }), /不是 prd\.json/)

  await assert.rejects(() => prdHandoffTool.execute({ path: 'prd.json' }), /必须是绝对路径/)
  await assert.rejects(() => prdHandoffTool.execute({ path: '' }), /path 缺失或为空/)
})

test('验收 6：旧版 prd.json（无账本）不崩，ready 由 P0 tasks/AC 决定，warning 含 NO_ASSUMPTIONS', async () => {
  const dir = await handoffDir(validPrdJson())
  const value = await prdHandoffTool.execute({ path: dir })
  assert.equal(value.ready, true)
  assert.deepEqual(value.blockers, [])
  assert.deepEqual(codesOf(value.warnings), ['NO_ASSUMPTIONS'])
  assert.ok(value.checklist.includes('未记录任何假设'))
  assert.ok(value.checklist.includes('NO_ASSUMPTIONS'))

  // 旧版里 P0 缺 tasks → ready=false 且是 P0_WITHOUT_TASKS
  const json = validPrdJson()
  json.user_stories[0].tasks = []
  const dir2 = await handoffDir(json)
  const broken = await prdHandoffTool.execute({ path: dir2 })
  assert.equal(broken.ready, false)
  assert.deepEqual(codesOf(broken.blockers), ['P0_WITHOUT_TASKS'])
  assert.deepEqual(codesOf(broken.warnings), ['NO_ASSUMPTIONS'])

  // 旧版里 P0 缺验收标准 → P0_WITHOUT_ACCEPTANCE
  const json2 = validPrdJson()
  json2.user_stories[0].acceptance_criteria = []
  const dir3 = await handoffDir(json2)
  const broken2 = await prdHandoffTool.execute({ path: dir3 })
  assert.equal(broken2.ready, false)
  assert.deepEqual(codesOf(broken2.blockers), ['P0_WITHOUT_ACCEPTANCE'])
})

test('验收 7：prd_handoff 不回归 prd_write / prd_check，且不改动其它产物', async () => {
  const dir = await makeTmpDir()
  await prdWriteTool.execute({ dir, prd: prdWithLedger() })
  const before = new Map()
  for (const file of await readdir(dir)) before.set(file, await readFile(join(dir, file), 'utf8'))

  const checkedBefore = await prdCheckTool.execute({ path: dir })
  const handoff = await prdHandoffTool.execute({ path: dir })
  assert.equal(handoff.ready, true)

  const checkedAfter = await prdCheckTool.execute({ path: dir })
  assert.deepEqual(checkedAfter, checkedBefore, 'prd_check 结果不应受 prd_handoff 影响')

  for (const [file, content] of before) assert.equal(await readFile(join(dir, file), 'utf8'), content, `${file} 不应被修改`)
  const files = await readdir(dir)
  assert.deepEqual(files.sort(), [...before.keys(), 'handoff.md'].sort())
})

test('prd_handoff 的 blocker/warning 结构符合 output.schema（含 write=false）', async () => {
  const json = prdJsonWithLedger()
  json.user_stories[0].acceptance_criteria = []
  json.assumptions = []
  const dir = await handoffDir(json)
  const value = await prdHandoffTool.execute({ path: dir, write: false })
  assertMatchesSchema(prdHandoffTool.output.schema, value)
  assert.deepEqual(codesOf(value.blockers), ['P0_WITHOUT_ACCEPTANCE'])
  assert.deepEqual(codesOf(value.warnings), ['NO_ASSUMPTIONS'])
  for (const item of [...value.blockers, ...value.warnings]) {
    assert.equal(typeof item.code, 'string')
    assert.equal(typeof item.message, 'string')
    assert.ok(Array.isArray(item.refs))
  }
})
