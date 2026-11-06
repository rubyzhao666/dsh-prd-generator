// 0.4.0 浏览器半边（lib/client.js）静态 + 加载器沙盒测试：左侧栏「PRD 项目」入口。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CLIENT_PATH = fileURLToPath(new URL('../lib/client.js', import.meta.url))
const CLIENT_CODE = readFileSync(CLIENT_PATH, 'utf8')

function reactStub() {
  const createElement = (type, props, ...children) => ({ type, props: props ?? {}, children })
  return { createElement }
}

// 模拟 DSH Web 的 window.__ModuleLoader__ 环境，拿到 factory 产物。
function loadClientModule() {
  let captured = null
  const windowStub = {
    __ModuleLoader__: {
      load(options) {
        captured = options
      },
    },
  }
  // eslint-disable-next-line no-new-func
  new Function('window', 'require', CLIENT_CODE)(windowStub, () => reactStub())
  assert.ok(captured, 'client.js 应调用 window.__ModuleLoader__.load')
  return captured
}

test('package.json：暴露 ./client 且带 dsh.client（web 平台）', () => {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
  assert.equal(pkg.exports['./client'], './lib/client.js')
  assert.deepEqual(pkg.dsh.client, { platform: 'web', inject: [] })
  assert.ok(pkg.files.includes('lib'))
  assert.equal(typeof pkg.version, 'string')
})

test('client.js 通过 node --check（语法合法）', () => {
  execFileSync(process.execPath, ['--check', CLIENT_PATH], { stdio: 'pipe' })
})

test('ModuleLoader 契约：id / isPlugin / inject / apply', () => {
  const loaded = loadClientModule()
  assert.equal(loaded.id, 'dsh-prd-generator')
  const module = loaded.factory(() => reactStub())
  assert.equal(module.isPlugin, true)
  assert.deepEqual(module.inject, ['slots'])
  assert.equal(typeof module.apply, 'function')
})

test('侧栏注册：sidebar.panellist id=prd-generator order=9 label=PRD 项目 + 内联图标', () => {
  const module = loadClientModule().factory(() => reactStub())
  const injects = []
  const registrations = []
  const ctx = {
    slots: {
      inject(name, factory) {
        injects.push(name)
        factory()
      },
      register(def, component) {
        registrations.push({ def, component })
      },
    },
  }
  module.apply(ctx)
  assert.deepEqual(injects.sort(), ['main', 'sidebar.panellist'])

  const sidebar = registrations.find((item) => item.def.name === 'sidebar.panellist')
  assert.ok(sidebar, '缺少 sidebar.panellist 注册')
  assert.equal(sidebar.def.id, 'prd-generator')
  assert.equal(sidebar.def.order, 9)
  assert.equal(sidebar.def.label(), 'PRD 项目')

  const icon = sidebar.component({ size: 20 })
  assert.equal(icon.type, 'svg')
  assert.equal(icon.props.width, 20)
  assert.equal(icon.props.height, 20)
  assert.equal(icon.props.stroke, 'currentColor')
  assert.ok(Array.isArray(icon.children) && icon.children.length >= 2, '图标应为内联 SVG path')

  const main = registrations.find((item) => item.def.name === 'main')
  assert.ok(main, '缺少 main 注册')
  assert.equal(main.def.key, 'prd-generator')
  const panel = main.component()
  assert.equal(panel.type, 'iframe')
  assert.equal(panel.props.src, '/prd-generator/')
  assert.equal(panel.props.title, 'PRD 项目')
})

test('client.js 无外部资源（无 http(s) 外链 / 无 script src）', () => {
  assert.ok(!/https?:\/\//i.test(CLIENT_CODE), 'client.js 不应引用外部 URL')
  assert.ok(!/src\s*:\s*['"]https?:/i.test(CLIENT_CODE))
  assert.ok(!/<script/i.test(CLIENT_CODE))
})
