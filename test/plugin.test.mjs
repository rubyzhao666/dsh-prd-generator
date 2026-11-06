// 插件形状测试：不依赖 DSH 进程，用假 ctx 记录注册结果。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { apply, inject, name } from '../lib/index.js'
import { TOOLS } from '../lib/tools.js'
import { assertMatchesSchema, fakeCtx, makeTmpDir, validPrd } from './helpers.mjs'

const PLUGIN_ROOT = fileURLToPath(new URL('..', import.meta.url))

test('exports a host plugin shape', () => {
  assert.equal(name, 'prd-generator')
  assert.ok(Array.isArray(inject))
  assert.deepEqual(inject, ['tools', 'skills'])
  assert.equal(typeof apply, 'function')
})

test('plugin id / package name / cordis patch id 三者一致', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.equal(pkg.name, 'dsh-prd-generator')
  assert.ok(patch.includes('id: prd-generator'), 'cordis.patch.yml 缺少 id: prd-generator')
  assert.ok(patch.includes("name: 'dsh-prd-generator'"), 'cordis.patch.yml 缺少包名')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dependencies, undefined, '不允许有运行时 dependencies')
})

test('registers every tool with the expected contract', () => {
  const { ctx, tools } = fakeCtx()
  apply(ctx)
  assert.deepEqual([...tools.keys()].sort(), ['prd_check', 'prd_handoff', 'prd_write'])
  for (const tool of TOOLS) {
    const registered = tools.get(tool.name)
    assert.ok(registered, `missing tool ${tool.name}`)
    assert.match(tool.name, /^[a-z][a-z0-9_]+$/)
    assert.ok(tool.description.length > 40, `${tool.name} 的 description 太短，模型判断不了何时调用`)
    assert.equal(tool.parameters.type, 'object')
    assert.equal(tool.parameters.additionalProperties, false)
    assert.ok(Array.isArray(tool.parameters.required) && tool.parameters.required.length > 0)
    assert.equal(tool.output.schema.type, 'object')
    assert.equal(typeof tool.output.render, 'function')
    assert.equal(typeof tool.execute, 'function')
    assert.ok(tool.timeoutMs >= 10_000)
  }
})

test('registers the bundled prd-generator skill', async () => {
  const { ctx, providers } = fakeCtx()
  apply(ctx)
  assert.equal(providers.length, 1)
  assert.equal(providers[0].name, 'prd-generator')
  const listed = await providers[0].list()
  assert.equal(listed.length, 1)
  const [skill] = listed
  assert.equal(skill.name, 'prd-generator')
  assert.match(skill.name, /^[a-z0-9-]+$/)
  assert.ok(skill.description.length > 20, 'skill description 太短')
  assert.equal(skill.invocation.modelInvocable, true)
  assert.equal(skill.invocation.userInvocable, true)

  const detail = await providers[0].get(skill)
  assert.ok(detail.content.includes('prd_write'), 'SKILL.md 正文必须提到 prd_write')
  assert.ok(detail.content.includes('prd_check'), 'SKILL.md 正文必须提到 prd_check')
  // 正文里引用的 references 必须真实存在
  for (const reference of [
    'references/prd-template.md',
    'references/insight-analysis.md',
    'references/competitive-analysis.md',
    'references/ralph-json-format.md',
    'references/mermaid-export.md',
    'references/templates/web-app.md',
    'references/templates/mobile-app.md',
    'references/templates/api.md',
    'references/templates/backend.md',
  ]) {
    assert.ok(detail.content.includes(reference), `SKILL.md 未引用 ${reference}`)
  }
  assert.ok(!detail.content.includes('<SKILL_ROOT>'), 'provider 应替换 <SKILL_ROOT>')
})

test('prd_write 返回值符合 output.schema（happy path）', async () => {
  const { prdWriteTool } = await import('../lib/tools.js')
  const dir = await makeTmpDir()
  const value = await prdWriteTool.execute({ dir, prd: validPrd() })
  assertMatchesSchema(prdWriteTool.output.schema, value)
  assert.equal(value.ok, true)
  assert.equal(value.files.length, 5)
  const rendered = prdWriteTool.output.render({}, value)
  assert.equal(rendered[0].type, 'text')
  assert.ok(rendered[0].text.includes('prd_check'), 'render 应提示下一步 prd_check')
})

test('prd_check 返回值符合 output.schema（happy path）', async () => {
  const { prdCheckTool, prdWriteTool } = await import('../lib/tools.js')
  const dir = await makeTmpDir()
  await prdWriteTool.execute({ dir, prd: validPrd() })
  const value = await prdCheckTool.execute({ path: dir })
  assertMatchesSchema(prdCheckTool.output.schema, value)
  assert.equal(value.ok, true)
  assert.deepEqual(value.errors, [])
})

test('package files 覆盖运行所需文件', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  for (const entry of ['lib', 'skills', 'locale/*.json', 'cordis.patch.yml', 'icon.svg', 'README.md', 'README.en.md', 'LICENSE']) {
    assert.ok(pkg.files.includes(entry), `package.json files 缺少 ${entry}`)
  }
  // PLUGIN_ROOT 只用于本测试的相对路径基线，确保解析正常
  assert.ok(PLUGIN_ROOT.endsWith('/'))
})
