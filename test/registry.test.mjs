// 0.4.0 registry 单测：$DSH_HOME/prd-generator/registry.json 的读写/容错/原子写。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  MAX_ENTRIES,
  entryFromPrd,
  entryId,
  listEntries,
  readEntry,
  registryPath,
  statsForRegistry,
  upsertEntry,
  upsertHandoffEntry,
} from '../lib/registry.js'
import { prdJsonWithLedger, prdWithLedger } from './helpers.mjs'

function useHome(t) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-prd-registry-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  })
  return home
}

function makeEntry(dir, overrides = {}) {
  const generatedAt = overrides.updatedAt ?? '2026-01-01T00:00:00.000Z'
  return {
    id: entryId(dir),
    dir,
    name: '每日打卡',
    summary: '一句话描述',
    generatedAt,
    updatedAt: generatedAt,
    stats: { stories: 2, p0: 1, acceptanceCriteria: 3, assumptions: 1, openQuestions: 1 },
    handoff: null,
    ...overrides,
  }
}

test('entryId = sha1(dir) 前 12 位 hex（稳定且不同目录不同 id）', () => {
  const a = entryId('/Users/me/prd-a')
  const b = entryId('/Users/me/prd-b')
  assert.match(a, /^[0-9a-f]{12}$/)
  assert.equal(a, entryId('/Users/me/prd-a'))
  assert.notEqual(a, b)
})

test('upsert → list → readEntry：字段往返正确，registry 文件结构 version 1', (t) => {
  useHome(t)
  const entry = makeEntry('/tmp/prd-one')
  upsertEntry(entry)

  assert.ok(existsSync(registryPath()))
  const parsed = JSON.parse(readFileSync(registryPath(), 'utf8'))
  assert.equal(parsed.version, 1)
  assert.equal(parsed.entries.length, 1)

  const listed = listEntries()
  assert.equal(listed.length, 1)
  assert.deepEqual(listed[0], entry)
  assert.deepEqual(readEntry(entryId('/tmp/prd-one')), entry)
  assert.equal(readEntry('aaaaaaaaaaaa'), null)
})

test('同 id 覆盖：不产生重复，updatedAt 更新；handoff 可随更新变化', (t) => {
  useHome(t)
  const dir = '/tmp/prd-overwrite'
  const first = makeEntry(dir)
  upsertEntry(first)
  const second = makeEntry(dir, {
    updatedAt: '2026-02-02T00:00:00.000Z',
    stats: { stories: 3, p0: 2, acceptanceCriteria: 5, assumptions: 0, openQuestions: 0 },
    handoff: { exists: true, ready: false, updatedAt: '2026-02-02T00:00:00.000Z' },
  })
  upsertEntry(second)
  const entries = listEntries()
  assert.equal(entries.length, 1)
  assert.equal(entries[0].updatedAt, '2026-02-02T00:00:00.000Z')
  assert.equal(entries[0].stats.p0, 2)
  assert.deepEqual(entries[0].handoff, { exists: true, ready: false, updatedAt: '2026-02-02T00:00:00.000Z' })
})

test('list 按 updatedAt 倒序；最多保留 200 条（旧的被裁剪）', (t) => {
  useHome(t)
  const total = MAX_ENTRIES + 5
  for (let i = 0; i < total; i += 1) {
    const updatedAt = new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString()
    upsertEntry(makeEntry(`/tmp/prd-cap-${i}`, { generatedAt: updatedAt, updatedAt }))
  }
  const listed = listEntries()
  assert.equal(listed.length, MAX_ENTRIES)
  // 最新的在最前；最早 5 条被裁掉
  assert.equal(listed[0].dir, `/tmp/prd-cap-${total - 1}`)
  assert.equal(listed.at(-1).dir, `/tmp/prd-cap-${total - MAX_ENTRIES}`)
  const file = JSON.parse(readFileSync(registryPath(), 'utf8'))
  assert.equal(file.entries.length, MAX_ENTRIES)
})

test('损坏 JSON / 结构异常 → listEntries 返回 []（不崩）', (t) => {
  const home = useHome(t)
  const dir = join(home, 'prd-generator')
  mkdirSync(dir, { recursive: true })

  writeFileSync(registryPath(), '{ not json', 'utf8')
  assert.deepEqual(listEntries(), [])

  writeFileSync(registryPath(), '[]', 'utf8')
  assert.deepEqual(listEntries(), [])

  writeFileSync(registryPath(), JSON.stringify({ version: 1, entries: 'nope' }), 'utf8')
  assert.deepEqual(listEntries(), [])
})

test('坏 entry 跳过：缺字段 / 类型不对（含 handoff 非法）不影响其它条目', (t) => {
  useHome(t)
  const dir = join(process.env.DSH_HOME, 'prd-generator')
  mkdirSync(dir, { recursive: true })
  const good = makeEntry('/tmp/prd-good')
  const badEntries = [
    null,
    { ...good, id: 'not-hex' },
    { ...good, stats: { stories: 'x' } },
    { ...good, updatedAt: 'not-a-date' },
    { ...good, handoff: { exists: 'yes' } },
    { ...good, dir: '' },
  ]
  writeFileSync(registryPath(), JSON.stringify({ version: 1, entries: [good, ...badEntries] }), 'utf8')
  const listed = listEntries()
  assert.equal(listed.length, 1)
  assert.equal(listed[0].id, good.id)
})

test('原子写：写完后没有临时文件残留，文件是合法 JSON', (t) => {
  useHome(t)
  upsertEntry(makeEntry('/tmp/prd-atomic'))
  const files = readdirSync(join(process.env.DSH_HOME, 'prd-generator'))
  assert.ok(!files.some((name) => name.includes('.tmp')), `不应残留临时文件：${files.join(',')}`)
  assert.deepEqual(files, ['registry.json'])
  JSON.parse(readFileSync(registryPath(), 'utf8'))
})

test('非法 entry 调 upsertEntry 抛错（带字段说明）', (t) => {
  useHome(t)
  assert.throws(() => upsertEntry({ id: 'x' }), /生成记录不合法/)
})

test('statsForRegistry / entryFromPrd：统计与 handoff 初始值', (t) => {
  useHome(t)
  const prd = prdWithLedger()
  const stats = statsForRegistry(prd)
  assert.deepEqual(stats, { stories: 3, p0: 2, acceptanceCriteria: 4, assumptions: 3, openQuestions: 2 })

  const generatedAt = '2026-03-03T03:03:03.000Z'
  const entry = entryFromPrd({ dir: '/tmp/prd-from-prd', prd, generatedAt })
  assert.equal(entry.id, entryId('/tmp/prd-from-prd'))
  assert.equal(entry.name, prd.name)
  assert.equal(entry.summary, prd.summary)
  assert.equal(entry.generatedAt, generatedAt)
  assert.equal(entry.updatedAt, generatedAt)
  assert.equal(entry.handoff, null)
  assert.deepEqual(entry.stats, stats)
})

test('upsertHandoffEntry：无记录时按 dir 新建，有记录时更新 handoff/stats', (t) => {
  useHome(t)
  const dir = '/tmp/prd-handoff-entry'
  const json = prdJsonWithLedger()
  const updatedAt = '2026-04-04T04:04:04.000Z'
  const created = upsertHandoffEntry({ dir, prdJson: json, ready: false, updatedAt, generatedAt: updatedAt })
  assert.equal(created.id, entryId(dir))
  assert.equal(created.name, json.name) // prd.json 没有 title
  assert.equal(created.summary, json.description)
  assert.deepEqual(created.handoff, { exists: true, ready: false, updatedAt })
  assert.equal(created.stats.stories, 2)

  const existing = listEntries()[0]
  const updated = upsertHandoffEntry({
    dir,
    prdJson: { ...json, description: '新描述' },
    ready: true,
    updatedAt: '2026-05-05T05:05:05.000Z',
    generatedAt: updatedAt,
  })
  assert.equal(updated.id, existing.id)
  assert.equal(updated.summary, '新描述')
  assert.equal(updated.handoff.ready, true)
  assert.equal(listEntries().length, 1)
})
