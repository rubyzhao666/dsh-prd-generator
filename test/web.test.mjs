// 0.5.0 /prd-generator/ 项目工作台测试：SPA 壳 + JSON API + 旧路由兼容 + 错误边界。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BASE, MAX_PAGE_BYTES, createHandler } from '../lib/web.js'
import { entryId, registryPath, statsForRegistry, upsertEntry } from '../lib/registry.js'
import { prdJsonWithLedger } from './helpers.mjs'

const GOOD_AT = '2026-04-01T00:00:00.000Z'

function useHome(t) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-prd-web-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  })
  return home
}

async function startServer(t) {
  const server = http.createServer(createHandler())
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    server.closeAllConnections?.()
    await new Promise((resolve) => server.close(resolve))
  })
  const { port } = server.address()
  return `http://127.0.0.1:${port}`
}

function makePrdJson(mutator) {
  const json = prdJsonWithLedger()
  json.title = '每日打卡 + 跟读打分'
  json.description = '给英语学习 App 做每日打卡与跟读打分'
  json._meta = {
    generator: 'dsh-prd-generator',
    generator_version: '0.5.0',
    template: 'mobile-app',
    generated_at: GOOD_AT,
  }
  json.user_stories.push({
    id: 'US-003',
    story: '作为学习者，我想要查看排行榜，以便获得成就感',
    priority: 'P2',
    acceptance_criteria: ['给定用户已打卡，当打开排行榜，那么展示本周榜单'],
    tasks: ['排行榜接口'],
    complexity: 'low',
  })
  json.scope = { in_scope: ['打卡状态机', '跟读打分'], out_of_scope: ['社交好友', '付费订阅'] }
  if (mutator) mutator(json)
  return json
}

function writePrd(dir, json) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'prd.json'), `${JSON.stringify(json, null, 2)}\n`, 'utf8')
  return dir
}

function entryFor(dir, { name, summary, updatedAt = GOOD_AT, handoff = null, json = null } = {}) {
  return {
    id: entryId(dir),
    dir,
    name,
    summary,
    generatedAt: GOOD_AT,
    updatedAt,
    stats: statsForRegistry(json ?? { user_stories: [] }),
    handoff,
  }
}

async function setup(t) {
  useHome(t)
  const work = mkdtempSync(join(tmpdir(), 'dsh-prd-web-docs-'))
  const goodJson = makePrdJson()
  const goodDir = writePrd(join(work, 'good'), goodJson)
  writeFileSync(join(goodDir, 'handoff.md'), '# 执行交接单\n', 'utf8')
  const missingDir = join(work, 'gone')
  const badDir = join(work, 'bad')
  mkdirSync(badDir, { recursive: true })
  writeFileSync(join(badDir, 'prd.json'), '{ this is not json', 'utf8')
  const pendingJson = makePrdJson((json) => {
    json.user_stories[0].tasks = []
  })
  const pendingDir = writePrd(join(work, 'pending'), pendingJson)
  writeFileSync(join(pendingDir, 'handoff.md'), '# handoff\n', 'utf8')
  const plainDir = writePrd(join(work, 'plain'), makePrdJson())

  const entries = [
    entryFor(goodDir, {
      name: '每日打卡 + 跟读打分',
      summary: '给英语学习 App 做每日打卡与跟读打分',
      updatedAt: '2026-04-04T04:04:04.000Z',
      handoff: { exists: true, ready: true, updatedAt: GOOD_AT },
      json: goodJson,
    }),
    entryFor(pendingDir, {
      name: '待确认的 PRD',
      summary: 'P0 缺 tasks',
      updatedAt: '2026-04-03T03:03:03.000Z',
      handoff: { exists: true, ready: false, updatedAt: GOOD_AT },
      json: pendingJson,
    }),
    entryFor(plainDir, {
      name: '还没交接的 PRD',
      summary: '有 open questions，但还没生成交接单',
      updatedAt: '2026-04-02T02:02:02.000Z',
      handoff: null,
      json: { ...prdJsonWithLedger(), open_questions: [{ id: 'Q1', question: '要离线吗？' }] },
    }),
    entryFor(missingDir, { name: '被移走的 PRD', summary: '目录已经不存在', updatedAt: '2026-04-01T01:01:01.000Z' }),
    entryFor(badDir, { name: '坏掉的 PRD', summary: 'prd.json 损坏', updatedAt: '2026-03-31T00:00:00.000Z' }),
  ]
  for (const entry of entries) upsertEntry(entry)
  return {
    work,
    goodDir,
    missingDir,
    badDir,
    pendingDir,
    ids: Object.fromEntries(entries.map((entry) => [entry.name, entry.id])),
  }
}

test('SPA 壳：200、内联 CSS/JS、主题桥与动作桥字符串、无外部资源', async (t) => {
  useHome(t)
  const base = await startServer(t)
  const response = await fetch(`${base}${BASE}/`)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /text\/html/)
  const html = await response.text()

  assert.ok(html.includes('PRD Creator'))
  assert.ok(html.includes('id="topbar"'))
  assert.ok(html.includes('id="toolbar"'))
  assert.ok(html.includes('id="view"'))
  assert.ok(html.includes('<style>') && html.includes('<script>'))
  // 页面 ↔ client 的动作桥（内联在 app.js 里）
  assert.ok(html.includes('prd-generator:ready'))
  assert.ok(html.includes('prd-generator:theme'))
  assert.ok(html.includes('prd-generator:start-session'))
  assert.ok(html.includes('prd-generator:session-started'))
  assert.ok(html.includes('prd-generator:session-failed'))
  // DOM 契约类名 / 数据键
  for (const token of [
    'topbar',
    'toolbar',
    'chip',
    'card-title',
    'tabpanel',
    'data-tab',
    'data-act="new-prd"',
    'data-act="gen-handoff"',
    'handoff-hero',
    'statbar',
    'toast',
    'skeleton',
    'empty',
  ]) {
    assert.ok(html.includes(token), `SPA 壳缺少 ${token}`)
  }
  // 主题 token 与响应式
  assert.ok(html.includes('--bg: #f6f4ef'))
  assert.ok(html.includes('data-theme'))
  assert.ok(html.includes('@media (max-width: 640px)'))
  // 无外部资源
  assert.ok(!/<link/i.test(html), '不应有 <link>')
  assert.ok(!/src\s*=\s*["']https?:/i.test(html), '不应有外部 src')
  assert.ok(!/https?:\/\//.test(html), '不应出现外部 URL')
  assert.ok(!/@import/i.test(html))

  const head = await fetch(`${base}${BASE}/`, { method: 'HEAD' })
  assert.equal(head.status, 200)
  assert.match(head.headers.get('content-type'), /text\/html/)
  assert.equal((await head.text()).length, 0)
})

test('API /api/prds：列表形状、排序、统计（total / ready / pending）', async (t) => {
  await setup(t)
  const base = await startServer(t)
  const response = await fetch(`${base}${BASE}/api/prds`)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /application\/json/)
  const data = await response.json()

  assert.equal(data.entries.length, 5)
  // ready=1（good）；pending=3（good 有 openQuestions + pending ready=false + plain 有 openQuestions）
  assert.deepEqual(data.stats, { total: 5, ready: 1, pending: 3 })
  const updated = data.entries.map((entry) => entry.updatedAt)
  assert.deepEqual(updated, [...updated].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)))
  const first = data.entries[0]
  for (const key of ['id', 'dir', 'name', 'summary', 'generatedAt', 'updatedAt', 'stats', 'handoff']) {
    assert.ok(Object.hasOwn(first, key), `entry 缺少 ${key}`)
  }
  assert.equal(first.name, '每日打卡 + 跟读打分')
})

test('API /api/prds/<id>：prd 结构化 + handoff 评估 + 文件清单', async (t) => {
  const { ids } = await setup(t)
  const base = await startServer(t)
  const response = await fetch(`${base}${BASE}/api/prds/${ids['每日打卡 + 跟读打分']}`)
  assert.equal(response.status, 200)
  const data = await response.json()

  assert.equal(data.entry.id, ids['每日打卡 + 跟读打分'])
  assert.equal(data.error, undefined)
  assert.equal(data.prd.name, '每日打卡 + 跟读打分')
  assert.equal(data.prd.summary, '给英语学习 App 做每日打卡与跟读打分')
  assert.equal(data.prd.template, 'mobile-app')
  assert.equal(data.prd.user_stories.length, 3)
  assert.deepEqual(
    data.prd.user_stories.map((story) => story.priority),
    ['P0', 'P1', 'P2'],
  )
  assert.ok(data.prd.user_stories[0].acceptance_criteria.length >= 1)
  assert.ok(data.prd.user_stories[0].tasks.length >= 1)
  assert.equal(data.prd.assumptions.length, 1)
  assert.equal(data.prd.open_questions.length, 1)
  assert.deepEqual(data.prd.scope.out_of_scope, ['社交好友', '付费订阅'])
  assert.equal(data.stats.stories, 3)
  assert.equal(data.stats.acceptanceCriteria, 3)
  assert.equal(data.stats.p0, 1)
  assert.equal(data.stats.p1, 1)
  assert.equal(data.stats.p2, 1)
  assert.equal(data.stats.assumptions, 1)
  assert.equal(data.stats.openQuestions, 1)
  assert.equal(data.stats.inScope, 2)
  assert.equal(data.stats.outOfScope, 2)

  assert.equal(data.handoff.exists, true)
  assert.equal(data.handoff.ready, true)
  assert.deepEqual(data.handoff.blockers, [])
  assert.ok(Array.isArray(data.handoff.warnings))
  assert.ok(data.handoff.path.endsWith('handoff.md'))

  assert.equal(data.files.length, 6)
  const file = (name) => data.files.find((item) => item.name === name)
  assert.equal(file('prd.json').exists, true)
  assert.equal(file('handoff.md').exists, true)
  assert.equal(file('prd.md').exists, false)
  assert.ok(file('prd.json').path.endsWith('prd.json'))
})

test('API 详情：目录缺失 → 200 {error:missing}；坏 prd.json → 200 {error:invalid}', async (t) => {
  const { ids } = await setup(t)
  const base = await startServer(t)

  const missing = await fetch(`${base}${BASE}/api/prds/${ids['被移走的 PRD']}`)
  assert.equal(missing.status, 200)
  const missingData = await missing.json()
  assert.equal(missingData.error, 'missing')
  assert.ok(missingData.message.includes('prd.json'))
  assert.equal(missingData.entry.id, ids['被移走的 PRD'])

  const bad = await fetch(`${base}${BASE}/api/prds/${ids['坏掉的 PRD']}`)
  assert.equal(bad.status, 200)
  const badData = await bad.json()
  assert.equal(badData.error, 'invalid')
  assert.match(badData.message, /JSON|解析/)
})

test('404 / 405 / 旧路由 302 / HEAD', async (t) => {
  const { ids } = await setup(t)
  const base = await startServer(t)
  const goodId = ids['每日打卡 + 跟读打分']

  for (const path of [
    `${BASE}/api/prds/000000000000`,
    `${BASE}/api/prds/not-hex`,
    `${BASE}/api/prds/..%2F..%2Fetc`,
    `${BASE}/api/unknown`,
    `${BASE}/unknown`,
    `${BASE}/p/not-hex`,
  ]) {
    const response = await fetch(base + path)
    assert.equal(response.status, 404, `${path} 应为 404`)
    assert.match(response.headers.get('content-type'), /application\/json/)
  }

  const legacy = await fetch(`${base}${BASE}/p/${goodId}`, { redirect: 'manual' })
  assert.equal(legacy.status, 302)
  assert.equal(legacy.headers.get('location'), `${BASE}/#/p/${goodId}`)

  const posted = await fetch(`${base}${BASE}/api/prds`, { method: 'POST', body: 'x' })
  assert.equal(posted.status, 405)
  assert.match(posted.headers.get('allow'), /GET/)

  const head = await fetch(`${base}${BASE}/api/prds`, { method: 'HEAD' })
  assert.equal(head.status, 200)
  assert.equal((await head.text()).length, 0)
})

test('XSS：API 返回原始数据（前端负责转义），SPA 壳不含服务端拼接的任何数据', async (t) => {
  await setup(t)
  const xssDir = join(mkdtempSync(join(tmpdir(), 'dsh-prd-xss-')), 'xss')
  const xssJson = makePrdJson((json) => {
    json.title = '<script>alert("title")</script>'
    json.description = '<img src=x onerror=alert(1)>'
    json.user_stories[0].acceptance_criteria = ['<script>alert(1)</script> 给定条件']
  })
  writePrd(xssDir, xssJson)
  upsertEntry(
    entryFor(xssDir, {
      name: '<script>alert("row")</script>',
      summary: '<img src=x>',
      updatedAt: GOOD_AT,
      json: xssJson,
    }),
  )
  const base = await startServer(t)

  const listData = await (await fetch(`${base}${BASE}/api/prds`)).json()
  assert.ok(
    listData.entries.some((entry) => entry.name === '<script>alert("row")</script>'),
    'API 原样返回数据（前端负责转义）',
  )

  const detailData = await (await fetch(`${base}${BASE}/api/prds/${entryId(xssDir)}`)).json()
  assert.equal(detailData.prd.user_stories[0].acceptance_criteria[0], '<script>alert(1)</script> 给定条件')

  // 壳是静态的：服务端不拼接 registry/prd 数据；前端 app.js 内置 esc() 转义映射
  const shell = await (await fetch(`${base}${BASE}/`)).text()
  assert.ok(!shell.includes('alert("row")'))
  assert.ok(shell.includes('&amp;'), 'app.js 的 esc() 转义映射应内联在页面里')
})

test('registry 损坏时 API 仍 200（空列表）', async (t) => {
  useHome(t)
  mkdirSync(join(process.env.DSH_HOME, 'prd-generator'), { recursive: true })
  writeFileSync(registryPath(), '{ broken', 'utf8')
  const base = await startServer(t)
  const data = await (await fetch(`${base}${BASE}/api/prds`)).json()
  assert.deepEqual(data.entries, [])
  assert.deepEqual(data.stats, { total: 0, ready: 0, pending: 0 })
})

test('prd.json 超过 2MB → 200 {error:invalid}（不 500）', async (t) => {
  useHome(t)
  const dir = join(mkdtempSync(join(tmpdir(), 'dsh-prd-big-')), 'big')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'prd.json'), JSON.stringify({ name: 'big', padding: 'x'.repeat(MAX_PAGE_BYTES + 10) }), 'utf8')
  upsertEntry(entryFor(dir, { name: '超大 PRD', summary: '超过 2MB', updatedAt: GOOD_AT }))
  const base = await startServer(t)
  const response = await fetch(`${base}${BASE}/api/prds/${entryId(dir)}`)
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.equal(data.error, 'invalid')
  assert.match(data.message, /2MB|字节/)
})
