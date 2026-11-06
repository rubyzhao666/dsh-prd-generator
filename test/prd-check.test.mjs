// prd_check 端到端测试：合法输入、坏例子（缺 AC / 缺 P0 / in_scope 空 / id 重复 / JSON 坏 / 路径错）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { prdCheckTool, prdWriteTool } from '../lib/tools.js'
import { makeTmpDir, validPrd, validPrdJson, assertMatchesSchema } from './helpers.mjs'

async function writeJson(dir, json) {
  await writeFile(join(dir, 'prd.json'), `${JSON.stringify(json, null, 2)}\n`, 'utf8')
  return dir
}

test('prd_write 产物可以通过 prd_check（目录参数）', async () => {
  const dir = await makeTmpDir()
  await prdWriteTool.execute({ dir, prd: validPrd() })
  const value = await prdCheckTool.execute({ path: dir })
  assert.equal(value.ok, true)
  assert.deepEqual(value.errors, [])
  assert.deepEqual(value.warnings, [])
  assert.deepEqual(value.stats, {
    stories: 3,
    acceptanceCriteria: 4,
    p0: 2,
    p1: 1,
    p2: 0,
    inScope: 2,
    outOfScope: 2,
  })
  assert.equal(value.path, join(dir, 'prd.json'))
  const rendered = prdCheckTool.output.render({}, value)[0].text
  assert.ok(rendered.includes('✅'))
  assert.ok(rendered.includes('prd.md'))
})

test('也接受 prd.json 文件绝对路径；render 输出可读摘要', async () => {
  const dir = await makeTmpDir()
  await writeJson(dir, validPrdJson())
  const value = await prdCheckTool.execute({ path: join(dir, 'prd.json') })
  assert.equal(value.ok, true)
  assert.equal(value.stats.stories, 2)
  const rendered = prdCheckTool.output.render({}, value)[0].text
  assert.ok(rendered.includes('2 条用户故事（P0 1 / P1 1 / P2 0）'))
  assert.ok(rendered.includes('2 条验收标准'))
})

test('坏例子：某条故事缺 acceptance_criteria → ok=false 且指出位置与修法', async () => {
  const dir = await makeTmpDir()
  const json = validPrdJson()
  json.user_stories[1].acceptance_criteria = []
  await writeJson(dir, json)
  const value = await prdCheckTool.execute({ path: dir })
  assert.equal(value.ok, false)
  assert.ok(value.errors.some((error) => error.includes('user_stories[1]') && error.includes('acceptance_criteria')))
  assert.ok(value.errors.some((error) => error.includes('US-002')))
  const rendered = prdCheckTool.output.render({}, value)[0].text
  assert.ok(rendered.includes('❌'))
  assert.ok(rendered.includes('推荐修法'))
  assert.ok(rendered.includes('prd_write'))
})

test('坏例子：没有 P0 → 报错说明 MVP 无法界定', async () => {
  const dir = await makeTmpDir()
  const json = validPrdJson()
  json.user_stories.forEach((story) => { story.priority = 'P1' })
  await writeJson(dir, json)
  const value = await prdCheckTool.execute({ path: dir })
  assert.equal(value.ok, false)
  assert.ok(value.errors.some((error) => error.includes('没有 P0 用户故事') && error.includes('MVP')))
})

test('坏例子：scope.in_scope 为空 → 报错说明要写 MVP 做什么', async () => {
  const dir = await makeTmpDir()
  const json = validPrdJson()
  json.scope.in_scope = []
  await writeJson(dir, json)
  const value = await prdCheckTool.execute({ path: dir })
  assert.equal(value.ok, false)
  assert.ok(value.errors.some((error) => error.includes('scope.in_scope')))
})

test('坏例子：用户故事 id 重复 → 指出重复 id', async () => {
  const dir = await makeTmpDir()
  const json = validPrdJson()
  json.user_stories[1].id = 'US-001'
  await writeJson(dir, json)
  const value = await prdCheckTool.execute({ path: dir })
  assert.equal(value.ok, false)
  assert.ok(value.errors.some((error) => error.includes('id 重复') && error.includes('US-001')))
})

test('坏例子：非法 JSON → ok=false（不抛错）并给修复建议', async () => {
  const dir = await makeTmpDir()
  await writeFile(join(dir, 'prd.json'), '{ "name": "x",, }', 'utf8')
  const value = await prdCheckTool.execute({ path: dir })
  assert.equal(value.ok, false)
  assert.ok(value.errors.some((error) => error.includes('不是合法 JSON')))
  assert.ok(value.errors.some((error) => error.includes('prd_write')))
  assert.deepEqual(value.stats, { stories: 0, acceptanceCriteria: 0, p0: 0, p1: 0, p2: 0, inScope: 0, outOfScope: 0 })
})

test('坏例子：顶层不是对象 / user_stories 不是数组', async () => {
  const dirA = await makeTmpDir()
  await writeJson(dirA, ['not', 'an', 'object'])
  const resultA = await prdCheckTool.execute({ path: dirA })
  assert.equal(resultA.ok, false)
  assert.ok(resultA.errors[0].includes('顶层必须是 JSON 对象'))

  const dirB = await makeTmpDir()
  await writeJson(dirB, validPrdJson({ user_stories: 'nope' }))
  const resultB = await prdCheckTool.execute({ path: dirB })
  assert.equal(resultB.ok, false)
  assert.ok(resultB.errors.some((error) => error.includes('user_stories 缺失或为空')))
})

test('坏例子：字段类型错误 / 缺 priority / 非 GWT 格式 → 给 warning，不阻塞', async () => {
  const dir = await makeTmpDir()
  const json = validPrdJson()
  delete json.user_stories[0].tasks
  delete json.user_stories[0].complexity
  json.user_stories[1].acceptance_criteria = ['用户可以看到连续天数']
  await writeJson(dir, json)
  const value = await prdCheckTool.execute({ path: dir })
  assert.equal(value.ok, true)
  assert.ok(value.warnings.some((warning) => warning.includes('tasks 为空')))
  assert.ok(value.warnings.some((warning) => warning.includes('complexity 缺失')))
  assert.ok(value.warnings.some((warning) => warning.includes('不是「给定…，当…，那么…」格式')))
})

test('坏例子：缺 scope / 缺 non_functional / 缺 success_metrics', async () => {
  const dir = await makeTmpDir()
  const json = validPrdJson()
  delete json.scope
  delete json.non_functional
  delete json.success_metrics
  await writeJson(dir, json)
  const value = await prdCheckTool.execute({ path: dir })
  assert.equal(value.ok, false)
  assert.ok(value.errors.some((error) => error.includes('scope 缺失')))
  assert.ok(value.warnings.some((warning) => warning.includes('non_functional 为空')))
  assert.ok(value.warnings.some((warning) => warning.includes('success_metrics 为空')))
})

test('支持 ~/ 形式的路径展开', async () => {
  await assert.rejects(
    () => prdCheckTool.execute({ path: '~/dsh-prd-not-exist-12345' }),
    (error) => error.message.includes('找不到路径') && error.message.includes(process.env.HOME ?? '~'),
  )
})

test('路径错误信息可操作：不存在 / 目录无 prd.json / 传了 md 文件 / 相对路径', async () => {
  await assert.rejects(
    () => prdCheckTool.execute({ path: '/tmp/dsh-prd-does-not-exist-12345' }),
    /找不到路径.*prd_write/s,
  )
  const emptyDir = await makeTmpDir()
  await assert.rejects(() => prdCheckTool.execute({ path: emptyDir }), /目录里没有 prd.json/)
  const dir = await makeTmpDir()
  await prdWriteTool.execute({ dir, prd: validPrd() })
  await assert.rejects(() => prdCheckTool.execute({ path: join(dir, 'prd.md') }), /不是 prd\.json/)
  await assert.rejects(() => prdCheckTool.execute({ path: 'prd.json' }), /path 必须是绝对路径/)
  await assert.rejects(() => prdCheckTool.execute({ path: '' }), /path 缺失或为空/)
})

test('prd_check 返回值始终符合 output.schema（含失败路径）', async () => {
  const dir = await makeTmpDir()
  const json = validPrdJson()
  json.user_stories = []
  await writeJson(dir, json)
  const value = await prdCheckTool.execute({ path: dir })
  assertMatchesSchema(prdCheckTool.output.schema, value)
  assert.equal(value.ok, false)
})
