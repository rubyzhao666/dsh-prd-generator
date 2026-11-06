// PRD Creator · DeepSeek Harness 插件：浏览器半边（0.5.0）
//   - 左侧栏「PRD Creator」入口；主区域是 /prd-generator/ 项目工作台（iframe，无前端构建）
//   - 把 DSH 明暗主题转发给页面；页面点动作按钮时开新会话并填入提示词（不直接执行工具）
//   - 页面只读：看本机生成过的 PRD、搜索/筛选/详情；写 PRD / 校验 / 交接仍在对话里完成
window.__ModuleLoader__.load({
  id: 'dsh-prd-generator',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const PANEL = 'prd-generator'
    const SRC = '/prd-generator/'
    const MAX_PROMPT = 4000

    // 侧栏图标：文档 + 勾选（内联 SVG，跟随侧栏 currentColor）
    function PrdIcon(props) {
      const size = (props && props.size) || 18
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        h('path', { d: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z' }),
        h('path', { d: 'M14 3v5h5' }),
        h('path', { d: 'M8.5 13.5l2 2 4-4' }),
      )
    }

    function apply(ctx) {
      // 记录当前 iframe；主题变化 / iframe 加载时把 prd-generator:theme 发给页面。
      const frames = new Set()
      let scheme = null

      function postTheme(frame) {
        if (!frame || !frame.contentWindow || !scheme) return
        try {
          frame.contentWindow.postMessage({ type: 'prd-generator:theme', scheme }, location.origin)
        } catch {
          // iframe 可能已经卸载，忽略
        }
      }

      function readScheme(snapshot) {
        if (!snapshot) return null
        if (snapshot.active && typeof snapshot.active.colorScheme === 'string') return snapshot.active.colorScheme
        if (typeof snapshot.colorScheme === 'string') return snapshot.colorScheme
        return null
      }

      ctx.inject(['theme'], (c) => {
        if (!c || !c.theme) return
        const push = (snapshot) => {
          const next = readScheme(snapshot)
          if (!next) return
          scheme = next === 'dark' ? 'dark' : 'light'
          frames.forEach(postTheme)
        }
        push(c.theme.getTheme())
        if (typeof c.on === 'function') c.on('theme/change', push)
      })

      function PrdPanel() {
        const ref = React.useRef(null)
        React.useEffect(() => {
          const frame = ref.current
          if (!frame) return undefined
          frames.add(frame)
          postTheme(frame)

          function reply(target, message) {
            try {
              target.contentWindow.postMessage(message, location.origin)
            } catch {
              // 页面可能已卸载，忽略
            }
          }

          function onMessage(event) {
            const current = ref.current
            if (!current || !current.contentWindow) return
            if (event.source !== current.contentWindow) return
            if (event.origin !== location.origin) return
            const message = event.data
            if (!message || typeof message !== 'object') return

            // 页面加载完成 → 回发当前主题
            if (message.type === 'prd-generator:ready') {
              postTheme(current)
              return
            }
            // 动作按钮 → 开新会话（带提示词），并回执
            if (message.type !== 'prd-generator:start-session') return
            const prompt = typeof message.prompt === 'string' ? message.prompt.trim() : ''
            if (!prompt || prompt.length > MAX_PROMPT) {
              reply(current, {
                type: 'prd-generator:session-failed',
                message: !prompt ? '提示词为空' : `提示词超过 ${MAX_PROMPT} 字`,
              })
              return
            }
            const label = typeof message.label === 'string' ? message.label.slice(0, 80) : ''
            try {
              ctx.uiWorkspace.startSession(undefined, { prompt, whenDraftExists: 'replace' })
              reply(current, { type: 'prd-generator:session-started', label })
            } catch (error) {
              reply(current, {
                type: 'prd-generator:session-failed',
                message: String(error && error.message ? error.message : error),
              })
            }
          }

          addEventListener('message', onMessage)
          return () => {
            removeEventListener('message', onMessage)
            frames.delete(frame)
          }
        }, [])

        return h('iframe', {
          ref,
          src: SRC,
          title: 'PRD Creator',
          allow: 'fullscreen',
          onLoad: (event) => postTheme(event.currentTarget),
          style: { width: '100%', height: '100%', border: 0, display: 'block' },
        })
      }

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          { name: 'sidebar.panellist', id: PANEL, order: 9, label: () => 'PRD Creator' },
          PrdIcon,
        ),
      )
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL }, PrdPanel))
    }

    exports.isPlugin = true
    exports.inject = ['slots', 'uiWorkspace']
    exports.apply = apply
    return module.exports
  },
})
