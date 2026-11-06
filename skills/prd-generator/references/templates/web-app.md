# Web 应用专项 PRD 模板

针对前端 Web 应用（React/Vue/Next.js 等）的专项 PRD 模板。

> 用法（DSH 版）：确认项目类型后读本文，把 UI/UX、页面清单、组件、状态管理、性能、兼容性、可访问性等专项要求拆进 `features` / `non_functional` / `tech`，对应的交互细节写进故事的验收标准。
> prd.md 固定 10 章，不需要为模板另开章节：把下面检查项落到 `prd` 对象的对应字段即可。

---

## 专属章节

### UI/UX 设计要求
- 设计风格：[例如：极简风 / 企业级 / 科技感]
- 配色方案：[主色 / 辅助色 / 中性色]
- 响应式断点：桌面 ≥ 1024px / 平板 768-1023px / 手机 < 768px
- 设计参考：[竞品 / 设计系统链接]

### 页面清单

| 页面名称 | 路由 | 核心功能 | 优先级 |
|---------|------|----------|--------|
| 首页 | `/` | 功能入口、概览 | P0 |
| 列表页 | `/items` | 数据列表、筛选、搜索 | P0 |
| 详情页 | `/items/:id` | 单条数据详情、操作 | P0 |
| 设置页 | `/settings` | 用户配置 | P1 |

### 组件设计
```
/src
├── components/
│   ├── ui/          # 基础组件（Button, Input, Card...）
│   ├── layout/      # 布局组件（Header, Sidebar, Footer...）
│   └── features/    # 业务组件
├── pages/           # 页面组件
├── hooks/           # 自定义 Hooks
└── services/        # API 调用
```

### 状态管理
- 方案：React Context / Redux Toolkit / Zustand / Jotai
- 全局状态：[例如：用户信息、主题切换、加载状态]
- 服务端状态：React Query / SWR / RTK Query

### 交互细节
- 加载状态：Skeleton 占位 / Loading Spinner
- 错误处理：错误边界 / 重试按钮 / 友好提示
- 空状态：Empty State 插画 + 引导操作
- 表单：输入校验 / 实时反馈 / 提交防重复

### 性能要求
- 首屏加载：LCP < 2.5s
- 页面切换：FID < 100ms
- 包体积：gzip 后 < 150KB
- 懒加载：路由级 + 组件级 Code Splitting

### 浏览器兼容性
- ✅ Chrome（最新 2 个版本）
- ✅ Firefox（最新 2 个版本）
- ✅ Safari（最新 2 个版本）
- ⚠️ Edge（最新 2 个版本）
- ❌ IE 全部

### 可访问性 (A11y)
- 支持键盘导航（Tab/Enter/Esc）
- 语义化 HTML 标签
- 图片 alt 属性
- 颜色对比度 ≥ 4.5:1
- 屏幕阅读器兼容
