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
| `prd_write` | 把结构化 `prd` 对象写成 5 个文件：`prd.md`（10 章）、`prd.json`（snarktank/ralph 兼容）、`acceptance.md`（P0/P1/P2 分组 + Given-When-Then 勾选清单）、`mindmap.mmd`、`flowchart.mmd`。严格校验：缺 `name` / `summary` / `user_stories` 或任一故事的 `acceptance_criteria` 会直接报错并逐条说明缺什么；**假设账本**（`assumptions` / `open_questions`）会校验 id 唯一、`source`/`impact` 枚举、`affects`/`blocks` 引用存在。 |
| `prd_check` | 校验已有 `prd.json`：JSON 合法、schema、每条故事 AC ≥ 1、至少 1 条 P0、`scope.in_scope` 非空、故事 id 唯一；并校验假设账本——**P0 故事被未确认问题阻塞且无默认假设时报 error**，`assumptions` 为空 / `blocks-p0` 假设缺证据时报 warning。返回 `{ok, errors, warnings, stats}`，错误信息可直接指导修复。 |

### Skill：`prd-generator`

随包提供，用户说「写 PRD」「产品需求文档」「需求文档」「功能规划」「验收标准」等时自动加载。工作流：

1. **澄清**：一次问 3–5 个最关键的问题；澄清答案直接产出 `assumptions`（AI 替用户做的决定）与 `open_questions`（待用户拍板）两个清单；
2. **洞察分析**：按六维度（行业洞察 / 用户痛点深挖 / 竞品盲区 / 反直觉判断 / 风险预判 / 增长杠杆）产出有判断的内容；
3. **选模板**：Web 应用 / 移动端 / API / 后端服务 / 通用，把专项要求拆进 PRD 字段；
4. **竞品分析**（可选）：用 DSH 的 `web_search` 搜真实竞品，输出带来源的对比报告；
5. **组装 `prd` 对象（含两个账本字段）→ `prd_write` → `prd_check` → 修到通过 → 给用户摘要（含「假设 N 条 / 待确认 M 条」）**。

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

## 假设与待确认账本（0.2.0）

实测发现：AI 在对话里列的「我替你做的 5 条假设」，文件一分享就全丢了。0.2.0 把它们变成**随文件走、可被 `prd_check` 校验**的结构化账本：

| 字段 | 作用 |
| --- | --- |
| `assumptions` | AI 替用户做的每个决定：`id`、`statement`、`source`（user/inference/industry）、`impact`（blocks-p0/changes-scope/minor）、`affects`（受影响的用户故事）、`evidence`（依据） |
| `open_questions` | 待用户确认的问题：`id`、`question`、`blocks`（被阻塞的用户故事）、`default_assumption`（默认假设）、`owner`（谁来回答） |

三份产物都会体现：

- `prd.md`：第 2 章用户故事表新增「依赖假设」列；第 10 章「假设与待确认」给出假设表 + 待确认表；
- `prd.json`：顶层 `assumptions` / `open_questions`，`_meta` 带 `assumption_count` / `open_question_count`；
- `acceptance.md`：受影响故事标注 `- 依赖假设：A1（inference，blocks-p0）`，被阻塞故事标注 `- ⚠ 待确认：Q1 — <问题>`，P0 被阻塞且无默认假设时标题带 `⚠ 待确认`。

`prd_check` 硬规则：**任一 P0 故事被未确认问题阻塞、且既无 `default_assumption` 也无 `affects` 覆盖它的假设 → error**（提示必须先给默认假设或降级）；`assumptions` 为空、`impact=blocks-p0` 缺 `evidence` → warning。旧版 `prd.json`（没有这两个字段）仍可校验，只会得到「assumptions 为空」warning，不会 crash。

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
    "template": "mobile-app",
    "assumptions": [{
      "id": "A1",
      "statement": "假设首版只做打卡 + 跟读，不做社交",
      "source": "inference",
      "impact": "changes-scope",
      "affects": ["US-001"]
    }],
    "open_questions": [{
      "id": "Q1",
      "question": "连续天数按自然日还是学习日计算？",
      "blocks": ["US-001"],
      "default_assumption": "按自然日计算",
      "owner": "用户"
    }]
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
| `prd.md` | 10 章：功能概览 / 用户故事（含依赖假设列）/ 功能详情 / 验收标准 / 非功能需求 / 技术考虑 / MVP 范围 / 成功指标 / 洞察与判断 / 假设与待确认 | 给人读、评审、存档 |
| `prd.json` | snarktank/ralph 兼容结构 + `assumptions` / `open_questions` + `_meta`（含假设/待确认计数） | 给 AI coding agent（Ralph）执行 |
| `acceptance.md` | 按 P0/P1/P2 分组，每条故事一组 Given-When-Then 勾选清单；受影响故事标注依赖假设、被阻塞故事标注「⚠ 待确认」 | 开发自测、验收、转测试用例 |
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

测试覆盖：假 ctx 注册（工具 + skill）、`prd_write` 端到端（5 个文件内容断言、格式子集、覆盖写、自动补 id/优先级）、`prd_check` 端到端（缺 AC / 缺 P0 / `in_scope` 空 / id 重复 / 非法 JSON 等坏例子）、**假设与待确认账本（F2 验收标准 1–6：向后兼容、三产物渲染、非法账本不落盘、P0 阻塞硬规则、旧格式兼容、acceptance 可读性）**、以及各自 `output.schema` 一致性。

## 许可

MIT。上游 [prd-generator](https://github.com/rubyzhao666/prd-generator) 版权归上游作者所有；本次 DSH 插件改造的版权见 [LICENSE](./LICENSE)。
