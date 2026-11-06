// 0.5.0 浏览器半边（lib/client.js）：vm 沙盒加载 + mock ctx（slots/theme/uiWorkspace）。
// 覆盖：slot 注册、theme 推送、start-session → uiWorkspace.startSession、非法消息忽略、回执、卸载清理。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CLIENT_PATH = fileURLToPath(new URL('../lib/client.js', import.meta.url))
const CLIENT_CODE = readFileSync(CLIENT_PATH, 'utf8')
const ORIGIN = 'http://127.0.0.1:4000'

function loadSandbox() {
  let loaded = null
  const listeners = []
  const sandbox = {
    console,
    location: { origin: ORIGIN },
    addEventListener(type, fn) {
      listeners.push({ type, fn })
    },
    removeEventListener(type, fn) {
      const index = listeners.findIndex((item) => item.type === type && item.fn === fn)
      if (index >= 0) listeners.splice(index, 1)
    },
    window: {
      __ModuleLoader__: {
        load(options) {
          loaded = options
        },
      },
    },
  }
  vm.createContext(sandbox)
  vm.runInContext(CLIENT_CODE, sandbox)
  assert.ok(loaded, 'client.js 应调用 window.__ModuleLoader__.load')
  return { loaded, listeners }
}

function makeReact() {
  const refs = []
  const effects = []
  return {
    refs,
    effects,
    createElement(type, props, ...children) {
      return { type, props: props || {}, children }
    },
    useRef(initial) {
      const ref = { current: initial }
      refs.push(ref)
      return ref
    },
    useEffect(fn) {
      effects.push(fn)
    },
  }
}

function setup() {
  const { loaded, listeners } = loadSandbox()
  const react = makeReact()
  const module = loaded.factory(() => react)
  const registered = []
  const sessionCalls = []
  const themeHandlers = []
  const theme = {
    getTheme: () => ({ active: { colorScheme: 'dark' } }),
  }
  const ctx = {
    inject(services, callback) {
      if (!Array.isArray(services) || !services.includes('theme')) return
      callback({
        theme,
        on(event, handler) {
          themeHandlers.push({ event, handler })
        },
      })
    },
    slots: {
      inject(name, factory) {
        factory()
      },
      register(def, component) {
        registered.push({ def, component })
      },
    },
    uiWorkspace: {
      startSession(...args) {
        sessionCalls.push(args)
      },
    },
  }
  module.apply(ctx)
  return { module, loaded, listeners, react, registered, sessionCalls, themeHandlers, ctx }
}

function mountPanel(result) {
  const main = result.registered.find((item) => item.def.name === 'main')
  assert.ok(main, '缺少 main slot 注册')
  const panel = main.component()
  const messages = []
  const frame = {
    contentWindow: {
      postMessage(data, origin) {
        messages.push({ data, origin })
      },
    },
  }
  const ref = result.react.refs[0]
  ref.current = frame
  const cleanups = result.react.effects.map((fn) => fn())
  return { panel, frame, messages, cleanups }
}

function dispatch(result, frame, data, overrides = {}) {
  const listener = result.listeners.find((item) => item.type === 'message')
  assert.ok(listener, 'client 应注册 message 监听')
  listener.fn({ source: frame.contentWindow, origin: ORIGIN, data, ...overrides })
}

const themeMessages = (messages) => messages.filter((item) => item.data && item.data.type === 'prd-generator:theme')

test('package.json：暴露 ./client、dsh.client 为 web 平台；client.js 通过 node --check', () => {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
  assert.equal(pkg.exports['./client'], './lib/client.js')
  assert.deepEqual(pkg.dsh.client, { platform: 'web', inject: [] })
  assert.ok(pkg.files.includes('lib'))
  execFileSync(process.execPath, ['--check', CLIENT_PATH], { stdio: 'pipe' })
})

test('ModuleLoader 契约：id / isPlugin / inject（slots + uiWorkspace）/ apply', () => {
  const { loaded } = loadSandbox()
  assert.equal(loaded.id, 'dsh-prd-generator')
  const module = loaded.factory(() => makeReact())
  assert.equal(module.isPlugin, true)
  assert.deepEqual([...module.inject], ['slots', 'uiWorkspace'])
  assert.equal(typeof module.apply, 'function')
})

test('侧栏注册：sidebar.panellist id=prd-generator order=9 label=PRD Creator + 内联图标；main iframe', () => {
  const result = setup()
  const sidebar = result.registered.find((item) => item.def.name === 'sidebar.panellist')
  assert.ok(sidebar, '缺少 sidebar.panellist 注册')
  assert.equal(sidebar.def.id, 'prd-generator')
  assert.equal(sidebar.def.order, 9)
  assert.equal(sidebar.def.label(), 'PRD Creator')
  const icon = sidebar.component({ size: 20 })
  assert.equal(icon.type, 'svg')
  assert.equal(icon.props.width, 20)
  assert.equal(icon.props.height, 20)
  assert.equal(icon.props.stroke, 'currentColor')

  const main = result.registered.find((item) => item.def.name === 'main')
  assert.equal(main.def.key, 'prd-generator')
  const panel = main.component()
  assert.equal(panel.type, 'iframe')
  assert.equal(panel.props.src, '/prd-generator/')
  assert.equal(panel.props.title, 'PRD Creator')
})

test('theme：初始推送、theme/change 再推送、onLoad 与 ready 回发', () => {
  const result = setup()
  assert.equal(result.themeHandlers.length, 1, '应订阅 theme/change')
  const { panel, frame, messages } = mountPanel(result)

  // effect 挂载后立即把当前主题推给页面
  assert.equal(themeMessages(messages).at(-1).data.type, 'prd-generator:theme')
  assert.equal(themeMessages(messages).at(-1).data.scheme, 'dark')
  assert.equal(themeMessages(messages).at(-1).origin, ORIGIN)

  // 主题变化 → 再推
  result.themeHandlers[0].handler({ active: { colorScheme: 'light' } })
  assert.equal(themeMessages(messages).at(-1).data.scheme, 'light')

  // iframe onLoad → 推
  const before = themeMessages(messages).length
  panel.props.onLoad({ currentTarget: frame })
  assert.equal(themeMessages(messages).length, before + 1)

  // 页面 ready → 回发
  const beforeReady = themeMessages(messages).length
  dispatch(result, frame, { type: 'prd-generator:ready' })
  assert.equal(themeMessages(messages).length, beforeReady + 1)
  assert.equal(themeMessages(messages).at(-1).data.scheme, 'light')
})

test('start-session：调用 uiWorkspace.startSession 并回执 session-started', () => {
  const result = setup()
  const { frame, messages } = mountPanel(result)

  dispatch(result, frame, { type: 'prd-generator:start-session', prompt: '帮我写个需求文档', label: '新建 PRD' })
  assert.equal(result.sessionCalls.length, 1)
  assert.equal(result.sessionCalls[0][0], undefined)
  assert.equal(result.sessionCalls[0][1].prompt, '帮我写个需求文档')
  assert.equal(result.sessionCalls[0][1].whenDraftExists, 'replace')
  const receipt = messages.find((item) => item.data.type === 'prd-generator:session-started')
  assert.ok(receipt, '应回执 session-started')
  assert.equal(receipt.origin, ORIGIN)
})

test('start-session 失败/非法：空 prompt、超长、非法消息全部忽略或回 failed', () => {
  const result = setup()
  const { frame, messages } = mountPanel(result)

  // 空 prompt → 不调用，只回 failed
  dispatch(result, frame, { type: 'prd-generator:start-session', prompt: '   ' })
  assert.equal(result.sessionCalls.length, 0)
  assert.ok(messages.some((item) => item.data.type === 'prd-generator:session-failed'))

  // 超长 prompt → failed
  dispatch(result, frame, { type: 'prd-generator:start-session', prompt: 'x'.repeat(4001) })
  assert.equal(result.sessionCalls.length, 0)

  // 非字符串 prompt / 非对象消息 / 未知 type / 错误 source / 错误 origin → 忽略
  const before = result.sessionCalls.length
  dispatch(result, frame, { type: 'prd-generator:start-session', prompt: 123 })
  dispatch(result, frame, 'not-an-object')
  dispatch(result, frame, { type: 'prd-generator:unknown', prompt: 'x' })
  dispatch(result, frame, { type: 'prd-generator:start-session', prompt: 'x' }, { source: {} })
  dispatch(result, frame, { type: 'prd-generator:start-session', prompt: 'x' }, { origin: 'http://evil.example' })
  assert.equal(result.sessionCalls.length, before, '非法消息不应触发 startSession')
})

test('startSession 抛错时回执 session-failed 且带 message', () => {
  const result = setup()
  result.ctx.uiWorkspace.startSession = () => {
    throw new Error('boom')
  }
  const { frame, messages } = mountPanel(result)
  dispatch(result, frame, { type: 'prd-generator:start-session', prompt: '帮我写个需求文档' })
  const receipt = messages.find((item) => item.data.type === 'prd-generator:session-failed')
  assert.ok(receipt, '应回执 session-failed')
  assert.match(receipt.data.message, /boom/)
})

test('effect 清理：触发 cleanup 后移除 message 监听', () => {
  const result = setup()
  const { messages, cleanups } = mountPanel(result)
  const beforeMessages = messages.length
  const beforeCalls = result.sessionCalls.length
  for (const cleanup of cleanups) if (typeof cleanup === 'function') cleanup()
  assert.equal(result.listeners.filter((item) => item.type === 'message').length, 0, 'cleanup 应移除 message 监听')
  assert.equal(messages.length, beforeMessages)
  assert.equal(result.sessionCalls.length, beforeCalls)
})

test('client.js 无外部资源（无 http(s) 外链 / 无 script src）', () => {
  assert.ok(!/https?:\/\//i.test(CLIENT_CODE), 'client.js 不应引用外部 URL')
  assert.ok(!/src\s*:\s*['"]https?:/i.test(CLIENT_CODE))
  assert.ok(!/<script/i.test(CLIENT_CODE))
})
