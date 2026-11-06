# prd.json 格式（snarktank/ralph 兼容）

`prd_write` 会自动把 `prd` 对象渲染成 `prd.json`，**你不需要手写这个文件**。本文用于：理解生成结果、排查 `prd_check` 报错、或手工修正/对接 Ralph 时参考。

## 生成结果示例

```json
{
  "name": "daily-checkin",
  "title": "每日打卡 + 跟读打分",
  "version": "1.0.0",
  "description": "给英语学习 App 做每日打卡与跟读打分…",
  "goal": "给英语学习 App 做每日打卡与跟读打分…",
  "user_stories": [
    {
      "id": "US-001",
      "story": "作为学习者，我想要每天完成打卡任务，以便保持学习连续性",
      "priority": "P0",
      "acceptance_criteria": [
        "给定用户当天未打卡，当完成 1 个跟读任务，那么记录打卡并展示连续天数"
      ],
      "tasks": ["打卡状态机", "连续天数计算"],
      "complexity": "medium"
    }
  ],
  "scope": {
    "in_scope": ["打卡状态机", "跟读打分"],
    "out_of_scope": ["社交好友", "付费订阅"]
  },
  "tech_requirements": {
    "frontend": { "stack": "前端：React Native", "components": [] },
    "backend": { "stack": "后端：Node.js", "apis": [] },
    "database": { "schema": ["数据库：PostgreSQL"] },
    "dependencies": []
  },
  "non_functional": {
    "performance": "性能：评分接口 P95 < 1s",
    "security": "安全：用户录音仅本地加密存储",
    "compatibility": "兼容性：iOS 15+ / Android 10+",
    "other": []
  },
  "success_metrics": {
    "business": ["7 日留存：≥ 35%"],
    "technical": ["接口 P95 延迟：< 1s"]
  },
  "risks": [],
  "_meta": {
    "generator": "dsh-prd-generator",
    "generator_version": "0.1.0",
    "generated_at": "2026-01-01T00:00:00.000Z",
    "template": "mobile-app",
    "source_files": ["prd.md", "prd.json", "acceptance.md", "mindmap.mmd", "flowchart.mmd"]
  }
}
```

## 字段来源映射

| prd.json 字段 | 来自 `prd` 对象 | 说明 |
| --- | --- | --- |
| `name` | `name` | 渲染成 slug（保留中英文，空格转 `-`），Ralph 用它标识任务 |
| `title` | `name` | 人类可读原名 |
| `version` | — | 固定 `1.0.0` |
| `description` / `goal` | `summary` | 同一句目标描述 |
| `user_stories[]` | `user_stories` | 原样映射（id/story/priority/acceptance_criteria/tasks/complexity） |
| `scope` | `scope` | 原样映射 |
| `tech_requirements.frontend.stack` | `tech` 中命中前端关键词的条目 | 用「；」连接 |
| `tech_requirements.backend.stack` | `tech` 中命中后端关键词的条目 | 用「；」连接 |
| `tech_requirements.database.schema` | `tech` 中命中数据库关键词的条目 | 字符串数组 |
| `tech_requirements.dependencies` | `tech` 中其余条目 | 字符串数组 |
| `non_functional.performance/security/compatibility` | `non_functional` 按关键词归类 | 用「；」连接，可能为空字符串 |
| `non_functional.other` | 未归类的非功能需求 | 字符串数组 |
| `success_metrics.business` | `metrics` 中非技术类 | 渲染为「名称：目标」 |
| `success_metrics.technical` | `metrics` 中技术类（延迟/可用性/错误率等） | 渲染为「名称：目标」 |
| `risks` | — | 目前固定空数组；风险写进 `insights` 第 9 章 |
| `_meta` | — | 生成器版本、生成时间、模板、本次生成的文件列表 |

## 优先级定义

- **P0** = MVP 必须完成，少一条就不能发布；`prd_check` 要求至少 1 条 P0。
- **P1** = 重要但不阻塞 MVP，MVP 后第一个迭代。
- **P2** = 锦上添花，长期规划。

## Ralph 执行流程

```
prd.md（给人读的需求文档）
    ↓ prd_write 渲染
prd.json（结构化格式）
    ↓ Ralph 读取
    ├─ 取 user_stories[] 中第一个未完成的故事
    ├─ 创建 Git 分支
    ├─ AI coding agent 按 story + tasks + acceptance_criteria 编码
    ├─ 运行测试 / 验收
    └─ 完成后移到下一个 user_story
        ↓
    所有 P0 完成 → MVP 可发布
```

所以对 AI coding agent 真正有用的是这几类字段，写 PRD 时要保证质量：

1. `user_stories[].tasks`：开发任务拆得够具体，agent 才知道先做什么；
2. `user_stories[].acceptance_criteria`：写成可判定的 Given-When-Then，等价于测试用例；
3. `scope.in_scope`：定义「做完」的边界，防止 agent 无限扩张；
4. `complexity`：low / medium / high，用于排期和拆分。

## prd_check 会检查/提示什么

| 检查 | 级别 | 修法 |
| --- | --- | --- |
| JSON 可解析 | error | 重新 `prd_write` 覆盖生成 |
| `user_stories` 非空 | error | 补至少 1 条故事 |
| 每条故事有 `id` 且全局唯一 | error | 改成 `US-001` 递增 |
| 每条故事有 `story` | error | 补「作为…，我想要…，以便…」 |
| 每条故事 `acceptance_criteria` ≥ 1 条 | error | 补 Given-When-Then |
| 至少 1 条 P0 | error | 把最核心的故事标 P0 |
| `scope` 存在且 `in_scope` 非空 | error | 补 MVP 范围 |
| `priority` 只能是 P0/P1/P2 | error | 改正 |
| `tasks` 为空 | warning | 补 2–5 条开发任务 |
| 缺 `complexity` | warning | 补 low/medium/high |
| AC 不是 Given-When-Then 格式 | warning | 按模板改写 |
| `scope.out_of_scope` 为空 | warning | 明确不做什么 |
| 缺 `non_functional` / `success_metrics` | warning | 补充 |

## 手工修改注意

- 如果直接改 `prd.json`，改完必须再跑 `prd_check`；但更推荐改 `prd` 对象后重新 `prd_write`——否则 `prd.md` / `acceptance.md` 会和 `prd.json` 不一致。
- 不要为了通过校验而删掉用户故事或验收标准；先修内容。
