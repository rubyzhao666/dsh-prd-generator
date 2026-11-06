// 0.4.0 /prd-generator/ 只读页面测试：真实 HTTP server + 临时 DSH_HOME + registry fixtures。
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
  json._meta = {
    generator: 'dsh-prd-generator',
    generator_version: '0.4.0',
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
  const xssJson = makePrdJson((json) => {
    json.title = '<script>alert("title")</script>'
    json.description = '<img src=x onerror=alert(1)>'
    json.user_stories[0].story = '<script>bad()</script> 作为用户，我想要测试'
    json.user_stories[0].acceptance_criteria = ['<script>alert(1)</script> 给定用户，当打开，那么 <b>结果</b>']
    json.assumptions[0].statement = '<script>assumption()</script> 假设'
  })
  const xssDir = writePrd(join(work, 'xss'), xssJson)
  const bigJson = makePrdJson((json) => {
    json.user_stories = [
      {
        id: 'US-001',
        story: '大故事',
        priority: 'P0',
        acceptance_criteria: Array.from({ length: 400 }, () => '<'.repeat(2000)),
        tasks: ['任务'],
      },
    ]
  })
  const bigDir = writePrd(join(work, 'big'), bigJson)

  const entries = [
    entryFor(goodDir, {
      name: '每日打卡 + 跟读打分',
      summary: '给英语学习 App 做每日打卡与跟读打分',
      updatedAt: '2026-04-04T04:04:04.000Z',
      handoff: { exists: true, ready: true, updatedAt: GOOD_AT },
      json: goodJson,
    }),
    entryFor(missingDir, { name: '被移走的 PRD', summary: '目录已经不存在', updatedAt: '2026-04-03T03:03:03.000Z' }),
    entryFor(badDir, { name: '坏掉的 PRD', summary: 'prd.json 损坏', updatedAt: '2026-04-02T02:02:02.000Z' }),
    entryFor(xssDir, {
      name: '<script>alert("row")</script>',
      summary: '<img src=x onerror=alert(1)>',
      updatedAt: '2026-04-01T01:01:01.000Z',
      json: xssJson,
    }),
    entryFor(bigDir, { name: '超大 PRD', summary: '用于验证页面体积上限', updatedAt: '2026-03-31T00:00:00.000Z', json: bigJson }),
  ]
  for (const entry of entries) upsertEntry(entry)
  return { home: process.env.DSH_HOME, work, goodDir, missingDir, badDir, xssDir, bigDir, ids: Object.fromEntries(entries.map((entry) => [entry.name, entry.id])) }
}

test('列表页：空 registry → 200 空状态，页脚给出 registry 路径', async (t) => {
  useHome(t)
  const base = await startServer(t)
  const response = await fetch(`${base}${BASE}/`)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /text\/html/)
  const html = await response.text()
  assert.ok(html.includes('PRD 项目'))
  assert.ok(html.includes('还没有生成过 PRD'))
  assert.ok(html.includes('.prd-empty'))
  assert.ok(html.includes(registryPath()))
  assert.ok(html.includes('prd-path'))
})

test('列表页：统计 / .prd-row / badges / 交接单状态', async (t) => {
  const { ids } = await setup(t)
  const base = await startServer(t)
  const html = await (await fetch(`${base}${BASE}/`)).text()

  assert.ok(html.includes('共 <strong>5</strong> 个 PRD'))
  assert.ok(html.includes('其中 <strong>1</strong> 个可执行'))
  assert.equal((html.match(/class="prd-row"/g) ?? []).length, 5)
  for (const id of Object.values(ids)) assert.ok(html.includes(`data-id="${id}"`), `缺少行 ${id}`)
  assert.ok(html.includes('P0 '))
  assert.ok(html.includes('假设 '))
  assert.ok(html.includes('待确认 '))
  assert.ok(html.includes('交接单：可执行'))
  assert.ok(html.includes('交接单：未生成'))
  assert.ok(html.includes('更新于'))
  // 列表页按 updatedAt 倒序：最新的 good（2026-04-04）应排在第一位
  const firstRow = html.indexOf('class="prd-row"')
  const goodId = ids['每日打卡 + 跟读打分']
  assert.ok(html.slice(firstRow).startsWith(`class="prd-row" data-id="${goodId}"`), '最新记录应排第一')
})

test('详情页：故事 P0→P1→P2 + AC/tasks + 假设表 + 待确认表 + 交接单卡片', async (t) => {
  const { ids } = await setup(t)
  const base = await startServer(t)
  const goodId = ids['每日打卡 + 跟读打分']
  const response = await fetch(`${base}${BASE}/p/${goodId}`)
  assert.equal(response.status, 200)
  const html = await response.text()

  assert.ok(html.includes('每日打卡 + 跟读打分'))
  assert.equal((html.match(/class="prd-story"/g) ?? []).length, 3)
  assert.equal((html.match(/class="prd-ac"/g) ?? []).length, 3)
  assert.equal((html.match(/class="prd-assumption"/g) ?? []).length, 1)
  assert.equal((html.match(/class="prd-question"/g) ?? []).length, 1)
  assert.ok(html.includes('data-id="US-001"'))
  assert.ok(html.includes('data-id="US-002"'))
  assert.ok(html.includes('data-id="US-003"'))
  assert.ok(html.indexOf('US-001') < html.indexOf('US-002'))
  assert.ok(html.indexOf('US-002') < html.indexOf('US-003'))
  assert.ok(html.includes('prd-handoff'))
  assert.ok(html.includes('已生成交接单'))
  assert.ok(html.includes('可执行'))
  assert.ok(html.includes('prd-back'))
  assert.ok(html.includes('prd-path'))
  assert.ok(html.includes('mobile-app'))
  assert.ok(html.includes('假设')) // 假设表标题
  assert.ok(html.includes('待确认问题'))
})

test('详情页：目录不存在 / 坏 prd.json → 200 友好错误（不 500）', async (t) => {
  const { ids } = await setup(t)
  const base = await startServer(t)

  const missing = await fetch(`${base}${BASE}/p/${ids['被移走的 PRD']}`)
  assert.equal(missing.status, 200)
  const missingHtml = await missing.text()
  assert.ok(missingHtml.includes('PRD 文件不可读'))
  assert.ok(missingHtml.includes('prd-back'))
  assert.ok(missingHtml.includes('prd-error'))

  const bad = await fetch(`${base}${BASE}/p/${ids['坏掉的 PRD']}`)
  assert.equal(bad.status, 200)
  const badHtml = await bad.text()
  assert.ok(badHtml.includes('PRD 文件不可读'))
  assert.ok(/JSON|Unexpected|解析/.test(badHtml))
})

test('未知 id / 路径穿越 → 404；POST → 405；HEAD 有状态无 body', async (t) => {
  await setup(t)
  const base = await startServer(t)
  for (const path of [
    `${BASE}/p/000000000000`,
    `${BASE}/p/..%2F..%2Fetc`,
    `${BASE}/p/%2e%2e%2f%2e%2e%2fetc`,
    `${BASE}/p/not-hex`,
    `${BASE}/p/`,
    `${BASE}/unknown`,
    `${BASE}/../etc/passwd`,
  ]) {
    const response = await fetch(base + path)
    assert.equal(response.status, 404, `${path} 应为 404`)
  }

  const posted = await fetch(`${base}${BASE}/`, { method: 'POST', body: 'x' })
  assert.equal(posted.status, 405)
  assert.match(posted.headers.get('allow'), /GET/)
  assert.ok((await posted.text()).includes('只读'))

  const head = await fetch(`${base}${BASE}/`, { method: 'HEAD' })
  assert.equal(head.status, 200)
  assert.match(head.headers.get('content-type'), /text\/html/)
  assert.equal((await head.text()).length, 0)
})

test('XSS：name/summary/故事/AC/假设里的 HTML 全部转义，页面无 <script>', async (t) => {
  const { ids } = await setup(t)
  const base = await startServer(t)
  const listHtml = await (await fetch(`${base}${BASE}/`)).text()
  const xssDetail = await (await fetch(`${base}${BASE}/p/${ids['<script>alert("row")</script>']}`)).text()

  for (const html of [listHtml, xssDetail]) {
    assert.ok(!/<script/i.test(html), '页面不应出现 <script')
    assert.ok(!/<img/i.test(html), '页面不应出现 <img')
    assert.ok(html.includes('&lt;script&gt;'), '动态文本应被 HTML 转义')
  }
  assert.ok(xssDetail.includes('&lt;b&gt;结果&lt;/b&gt;'))
})

test('页面无外部资源（无 script/link/外链 URL/外部字体）', async (t) => {
  const { ids } = await setup(t)
  const base = await startServer(t)
  for (const path of [`${BASE}/`, `${BASE}/p/${ids['每日打卡 + 跟读打分']}`]) {
    const html = await (await fetch(base + path)).text()
    assert.ok(!/<script/i.test(html), 'no <script>')
    assert.ok(!/<link/i.test(html), 'no <link>')
    assert.ok(!/https?:\/\//i.test(html), 'no external URL')
    assert.ok(!/@import/i.test(html), 'no @import')
    assert.ok(!/url\(\s*['"]?https?:/i.test(html), 'no external css url')
  }
})

test('超大 PRD：详情页 ≤ 2MB 且带截断说明', async (t) => {
  const { ids } = await setup(t)
  const base = await startServer(t)
  const response = await fetch(`${base}${BASE}/p/${ids['超大 PRD']}`)
  assert.equal(response.status, 200)
  const html = await response.text()
  assert.ok(Buffer.byteLength(html, 'utf8') <= MAX_PAGE_BYTES, `页面超过 2MB：${Buffer.byteLength(html, 'utf8')}`)
  assert.ok(html.includes('prd-truncated') && /截断|仅显示/.test(html), '应有截断说明')
})

test('registry 文件损坏时列表页仍 200（空状态，不崩）', async (t) => {
  useHome(t)
  mkdirSync(join(process.env.DSH_HOME, 'prd-generator'), { recursive: true })
  writeFileSync(registryPath(), '{ broken registry', 'utf8')
  const base = await startServer(t)
  const response = await fetch(`${base}${BASE}/`)
  assert.equal(response.status, 200)
  const html = await response.text()
  assert.ok(html.includes('还没有生成过 PRD'))
})
