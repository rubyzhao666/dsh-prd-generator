// PRD Creator · DeepSeek Harness 插件：浏览器半边
//   - 左侧栏加一个「PRD 项目」入口；主区域显示 /prd-generator/（iframe，服务端渲染，无构建）
//   - 页面只读：看本机生成过的 PRD 列表与详情；写 PRD / 校验 / 交接仍在对话里完成
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

    // 主区域面板：铺满的 iframe，页面由 Host 的 /prd-generator/ 提供
    function PrdPanel() {
      return h('iframe', {
        src: SRC,
        title: 'PRD 项目',
        allow: 'fullscreen',
        style: { width: '100%', height: '100%', border: 0, display: 'block' },
      })
    }

    function apply(ctx) {
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          { name: 'sidebar.panellist', id: PANEL, order: 9, label: () => 'PRD 项目' },
          PrdIcon,
        ),
      )
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL }, PrdPanel))
    }

    exports.isPlugin = true
    exports.inject = ['slots']
    exports.apply = apply
    return module.exports
  },
})
