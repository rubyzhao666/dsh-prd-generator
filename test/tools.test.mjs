// 0.4.0 工具 × registry 集成：prd_write 写记录、prd_handoff 更新 handoff 状态。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { prdHandoffTool, prdWriteTool } from '../lib/tools.js'
import { entryId, listEntries, registryPath } from '../lib/registry.js'
import {
  assertMatchesSchema,
  makeTmpDir,
  prdJsonWithLedger,
  prdWithLedger,
  validPrd,
} from './helpers.mjs'

// helpers 已把 DSH_HOME 指向临时目录；需要独立隔离时用这个。
function freshHome(t) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-prd-tools-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  })
  return home
}

test('prd_write 成功后写入 registry：字段/统计正确，重复写不产生重复记录', async (t) => {
  freshHome(t)
  const dir = await makeTmpDir()
  const value = await prdWriteTool.execute({ dir, prd: validPrd() })
  assertMatchesSchema(prdWriteTool.output.schema, value)

  assert.equal(registryPath(), join(process.env.DSH_HOME, 'prd-generator', 'registry.json'))
  let entries = listEntries()
  assert.equal(entries.length, 1)
  const entry = entries[0]
  assert.equal(entry.id, entryId(dir))
  assert.equal(entry.dir, dir)
  assert.equal(entry.name, validPrd().name)
  assert.equal(entry.summary, validPrd().summary)
  assert.deepEqual(entry.stats, { stories: 3, p0: 2, acceptanceCriteria: 4, assumptions: 0, openQuestions: 0 })
  assert.equal(entry.handoff, null)

  // 同目录重新生成：覆盖同一条，handoff 归 null
  await prdWriteTool.execute({ dir, prd: validPrd() })
  entries = listEntries()
  assert.equal(entries.length, 1)
  assert.equal(entries[0].handoff, null)
})

test('prd_handoff（write=true）更新 handoff.ready/stats；write=false 不更新', async (t) => {
  freshHome(t)
  const dir = await makeTmpDir()
  await prdWriteTool.execute({ dir, prd: prdWithLedger() })
  const before = listEntries()[0]
  assert.equal(before.handoff, null)

  const noWrite = await prdHandoffTool.execute({ path: dir, write: false })
  assert.equal(noWrite.ready, true)
  assert.equal(listEntries()[0].handoff, null, 'write=false 时不应更新 registry')

  const written = await prdHandoffTool.execute({ path: dir })
  assert.equal(written.ready, true)
  const entry = listEntries()[0]
  assert.equal(entry.id, before.id)
  assert.equal(entry.handoff.exists, true)
  assert.equal(entry.handoff.ready, true)
  assert.equal(typeof entry.handoff.updatedAt, 'string')
  assert.deepEqual(entry.stats, { stories: 3, p0: 2, acceptanceCriteria: 4, assumptions: 3, openQuestions: 2 })
  assert.equal(listEntries().length, 1)
})

test('prd_handoff ready=false 时 registry 记录 handoff.ready=false', async (t) => {
  freshHome(t)
  const dir = await makeTmpDir()
  const json = prdJsonWithLedger()
  json.user_stories[0].tasks = []
  await writeFile(join(dir, 'prd.json'), `${JSON.stringify(json, null, 2)}\n`, 'utf8')

  const result = await prdHandoffTool.execute({ path: dir })
  assert.equal(result.ready, false)
  const entry = listEntries()[0]
  assert.equal(entry.handoff.ready, false)
  assert.equal(entry.stats.stories, 2)
})

test('registry 里没有记录时，prd_handoff 按 dir 新建一条', async (t) => {
  freshHome(t)
  const dir = await makeTmpDir()
  const json = prdJsonWithLedger()
  json.description = '手工写入的 prd.json'
  await writeFile(join(dir, 'prd.json'), `${JSON.stringify(json, null, 2)}\n`, 'utf8')
  assert.equal(listEntries().length, 0)

  const result = await prdHandoffTool.execute({ path: dir })
  assert.equal(result.ready, true)
  const entries = listEntries()
  assert.equal(entries.length, 1)
  const entry = entries[0]
  assert.equal(entry.dir, dir)
  assert.equal(entry.name, json.name)
  assert.equal(entry.summary, '手工写入的 prd.json')
  assert.equal(entry.handoff.ready, true)
  assert.equal(entry.stats.stories, 2)
})

test('registry 写入失败不影响 prd_write 主流程（只加 warning）', async (t) => {
  const base = await makeTmpDir()
  const notADir = join(base, 'not-a-dir')
  await writeFile(notADir, 'x', 'utf8')
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = notADir
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  })

  const dir = await makeTmpDir()
  const value = await prdWriteTool.execute({ dir, prd: validPrd() })
  assert.equal(value.ok, true)
  assert.ok(value.warnings.some((warning) => warning.includes('写入 PRD 项目记录失败')), '应提示 registry 写失败')
  const json = JSON.parse(await readFile(join(dir, 'prd.json'), 'utf8'))
  assert.ok(json.name)
})

test('registry 写入失败不影响 prd_handoff 门禁结果（warnings 加 REGISTRY_WRITE_FAILED）', async (t) => {
  const base = await makeTmpDir()
  const notADir = join(base, 'not-a-dir')
  await writeFile(notADir, 'x', 'utf8')
  const dir = await makeTmpDir()
  const json = prdJsonWithLedger()
  await writeFile(join(dir, 'prd.json'), `${JSON.stringify(json, null, 2)}\n`, 'utf8')

  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = notADir
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  })

  const result = await prdHandoffTool.execute({ path: dir })
  assert.equal(result.ready, true)
  assert.ok(result.warnings.some((warning) => warning.code === 'REGISTRY_WRITE_FAILED'))
})
