# dsh-prd-generator

> 给 DeepSeek Harness 的 PRD 生成插件：**需求澄清 → 洞察分析 → PRD → prd.json（Ralph 兼容）→ 验收清单**，一条流水线出齐 5 个文件。

基于 [rubyzhao666/prd-generator](https://github.com/rubyzhao666/prd-generator)（MIT）改造成 DSH 插件：
上游提供 PRD 方法论、模板与提示词；本插件把它们变成**会话模型 + 两个确定性工具**的 DSH 工作流——模型负责分析、写作和拍判断，工具负责严格校验与落盘。

## 三步流水线

```
① 澄清（一次问 3–5 个关键问题）
        ↓
② PRD 写作（六维度洞察 → 选专项模板 → 可选 web_search 竞品分析 → 组装 prd 对象）
        ↓
③ prd_write 落盘 5 个文件 → prd_check 校验到 ok → 给用户摘要
```

## 能力

### 工具

| 工具 | 作用 |
| --- | --- |
| `prd_write` | 把结构化 `prd` 对象写成 5 个文件：`prd.md`（9 章）、`prd.json`（snarktank/ralph 兼容）、`acceptance.md`（P0/P1/P2 分组 + Given-When-Then 勾选清单）、`mindmap.mmd`、`flowchart.mmd`。严格校验：缺 `name` / `summary` / `user_stories` 或任一故事的 `acceptance_criteria` 会直接报错并逐条说明缺什么。 |
| `prd_check` | 校验已有 `prd.json`：JSON 合法、schema、每条故事 AC ≥ 1、至少 1 条 P0、`scope.in_scope` 非空、故事 id 唯一。返回 `{ok, errors, warnings, stats}`，错误信息可直接指导修复。 |

### Skill：`prd-generator`

随包提供，用户说「写 PRD」「产品需求文档」「需求文档」「功能规划」「验收标准」等时自动加载。工作流：

1. **澄清**：一次问 3–5 个最关键的问题（用户已给足信息就跳过并说明假设）；
2. **洞察分析**：按六维度（行业洞察 / 用户痛点深挖 / 竞品盲区 / 反直觉判断 / 风险预判 / 增长杠杆）产出有判断的内容；
3. **选模板**：Web 应用 / 移动端 / API / 后端服务 / 通用，把专项要求拆进 PRD 字段；
4. **竞品分析**（可选）：用 DSH 的 `web_search` 搜真实竞品，输出带来源的对比报告；
5. **组装 `prd` 对象 → `prd_write` → `prd_check` → 修到通过 → 给用户摘要**。

方法论与模板都在 `skills/prd-generator/references/`：

```
references/
├── prd-template.md          # prd 对象字段与质量标准
├── insight-analysis.md      # 六维度洞察分析
├── competitive-analysis.md  # 竞品搜索与报告模板
├── ralph-json-format.md     # prd.json 结构、字段映射、Ralph 执行方式
├── mermaid-export.md        # 两张 Mermaid 图的生成规则
└── templates/
    ├── web-app.md
    ├── mobile-app.md
    ├── api.md
    └── backend.md
```

## 安装

在 DeepSeek Harness 里用插件市场安装，或把本目录作为本地 bundle 安装（由 DSH 的插件管理器完成，插件本身不会自我安装）：

```bash
# 目录形态（可发布 npm 包）
cd /path/to/dsh-prd-generator
npm pack --dry-run      # 检查打包内容
```

安装后：

- 工具列表里出现 `prd_write` / `prd_check`；
- skill 列表里出现 `prd-generator`。

## 使用

### 对话里直接说

> 帮我写个 PRD：给英语学习 App 做一个「每日打卡 + 跟读打分」功能

模型会加载 `prd-generator` skill，先问几个澄清问题，然后生成完整的 PRD 与验收清单。

### 直接调用工具（脚本/其他 agent）

```jsonc
// prd_write
{
  "dir": "/Users/me/Documents/PKM/prd-daily-checkin",
  "prd": {
    "name": "每日打卡 + 跟读打分",
    "summary": "给英语学习 App 做每日打卡与跟读打分，让用户形成连续学习习惯。",
    "user_stories": [{
      "id": "US-001",
      "story": "作为学习者，我想要每天完成打卡任务，以便保持学习连续性",
      "priority": "P0",
      "acceptance_criteria": ["给定用户当天未打卡，当完成 1 个跟读任务，那么记录打卡并展示连续天数"],
      "tasks": ["打卡状态机", "连续天数计算"],
      "complexity": "medium"
    }],
    "scope": { "in_scope": ["打卡状态机"], "out_of_scope": ["社交好友"] },
    "template": "mobile-app"
  },
  "formats": ["md", "json", "acceptance", "mindmap", "flowchart"]  // 可省略 = 全部
}
```

```jsonc
// prd_check
{ "path": "/Users/me/Documents/PKM/prd-daily-checkin" }
```

### 手动冒烟

```bash
node scripts/smoke.mjs                 # 写到系统临时目录
node scripts/smoke.mjs /tmp/prd-demo   # 写到指定目录
```

## 生成的文件

| 文件 | 内容 | 用途 |
| --- | --- | --- |
| `prd.md` | 9 章：功能概览 / 用户故事 / 功能详情 / 验收标准 / 非功能需求 / 技术考虑 / MVP 范围 / 成功指标 / 洞察与判断 | 给人读、评审、存档 |
| `prd.json` | snarktank/ralph 兼容结构 + `_meta` | 给 AI coding agent（Ralph）执行 |
| `acceptance.md` | 按 P0/P1/P2 分组，每条故事一组 Given-When-Then 勾选清单 | 开发自测、验收、转测试用例 |
| `mindmap.mmd` | Mermaid 思维导图 | GitHub / Obsidian / 飞书 / VS Code 渲染 |
| `flowchart.mmd` | Mermaid 用户流程图（P0 主线 + 后续迭代 + 明确不做） | 评审时讲流程 |

优先级约定：**P0 = MVP 必须完成（阻塞发布）；P1 = MVP 后第一个迭代；P2 = 长期规划。**

## 数据位置与网络

- **不写 `$DSH_HOME`**：本插件无状态、无缓存，只往调用方指定的 `dir`（绝对路径）写文件；目录不存在会自动创建，同名文件会被覆盖。
- **零运行时依赖、纯 ESM**：只 import Node 内置模块，没有 `dependencies`。
- **不需要任何 API key、不写死密钥**：`prd_write` / `prd_check` 纯本地；可选的竞品搜索由会话模型调用 DSH 的 `web_search` 完成。
- 配置文件：无。

## 开发与测试

```bash
node --check lib/index.js
node --check lib/tools.js
node --test test/*.test.mjs
npm pack --dry-run
```

测试覆盖：假 ctx 注册（工具 + skill）、`prd_write` 端到端（5 个文件内容断言、格式子集、覆盖写、自动补 id/优先级）、`prd_check` 端到端（缺 AC / 缺 P0 / `in_scope` 空 / id 重复 / 非法 JSON 等坏例子）、以及各自 `output.schema` 一致性。

## 许可

MIT。上游 [prd-generator](https://github.com/rubyzhao666/prd-generator) 版权归上游作者所有；本次 DSH 插件改造的版权见 [LICENSE](./LICENSE)。
