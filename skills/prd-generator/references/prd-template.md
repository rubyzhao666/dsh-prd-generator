# PRD 对象字段与内容要求

`prd_write` 接收的就是本文描述的 `prd` 对象。工具会把它确定性地渲染成 `prd.md`（10 章）、`prd.json`（Ralph 兼容）、`acceptance.md`（勾选清单）和两张 Mermaid 图。
所以你只需要把**内容**写好：字段该有的都有、故事能验收、范围说得清。

## 字段清单

```json
{
  "name": "每日打卡 + 跟读打分",
  "summary": "给英语学习 App 做每日打卡与跟读打分，让用户形成连续学习习惯。",
  "background": "为什么现在做、解决什么痛点、当前替代方案的问题（Markdown）",
  "target_users": [
    { "type": "备考学生", "description": "每天固定学习 30 分钟", "needs": "看到连续天数与进步" }
  ],
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
  "features": [{ "name": "每日打卡", "priority": "P0", "description": "状态机 + 连续天数" }],
  "non_functional": ["性能：评分接口 P95 < 1s", "兼容性：iOS 15+ / Android 10+"],
  "scope": { "in_scope": ["打卡状态机"], "out_of_scope": ["社交好友"] },
  "metrics": [{ "name": "7 日留存", "target": "≥ 35%" }],
  "tech": ["前端：React Native", "后端：Node.js", "数据库：PostgreSQL"],
  "insights": "### 维度一：行业洞察\n…",
  "competitive_analysis": "## 竞品分析\n…",
  "template": "mobile-app",
  "assumptions": [
    {
      "id": "A1",
      "statement": "假设目标用户每天至少有 10 分钟连续学习时间",
      "source": "inference",
      "impact": "blocks-p0",
      "affects": ["US-001"],
      "evidence": "用户提到主要在通勤时学习"
    }
  ],
  "open_questions": [
    {
      "id": "Q1",
      "question": "发音评分服务的预算上限是多少？",
      "blocks": ["US-002"],
      "default_assumption": "A2",
      "owner": "产品负责人"
    }
  ]
}
```

## 各字段的质量标准

| 字段 | 要求 | 差的做法 |
| --- | --- | --- |
| `name` | 用户能一眼看懂的功能名，不要代号 | 「项目 A」「新功能」 |
| `summary` | 一句话讲清：是什么 + 给谁 + 解决什么 | 「提升用户体验」 |
| `background` | 为什么现在做；用户现在怎么绕过去的；不做的代价 | 复述需求原文 |
| `target_users` | 每类用户写清「是谁 + 场景 + 核心需求」，2–4 类 | 「所有用户」 |
| `user_stories` | 每条可独立验收；角色来自真实用户类型；`P0` 是 MVP 底线 | 「作为用户我想要一切」 |
| `acceptance_criteria` | 给定/当/那么，一条只验证一件事，可判定真假 | 「功能正常」「体验流畅」 |
| `tasks` | 2–5 条能直接派给开发的任务 | 留空，或写成「开发功能」 |
| `features` | 围绕故事拆出的可交付功能点，带优先级 | 把用户故事改个说法 |
| `non_functional` | 性能 / 安全 / 兼容性等，有数字给数字 | 「要快」「要安全」 |
| `scope` | `in_scope` = P0 覆盖的交付物；`out_of_scope` 明确写不做 | 只有一个「MVP」不拆分 |
| `metrics` | 可量化、有目标值、有统计口径 | 「DAU 增加」 |
| `tech` | 技术栈 / 关键依赖 / 外部服务 / 主要技术风险 | 罗列一堆框架名 |
| `insights` | 六维度洞察分析，有判断、有推理 | 行业新闻复述 |
| `competitive_analysis` | 只写真实搜到的竞品，带来源 | 编造竞品数据 |
| `template` | 选一个专项模板，决定内容检查项 | 乱填或不填 |
| `assumptions` | AI 替用户做的每个决定都记录；`source` 与 `impact` 如实标；`blocks-p0` 写依据 | 一个假设都不写，或把「用户明确说的」标成 inference |
| `open_questions` | 一条问题一件事；影响 P0 的必须给 `default_assumption`；写明 owner | 把待确认问题藏进正文，或给了默认假设却不写 |

## 用户故事写法

**推荐句式**：作为 [具体角色]，我想要 [可观察的能力]，以便 [获得的价值]。

- 一条故事 = 一个用户可以独立验收的能力，不要塞进多个功能。
- 「以便」后面写**用户价值**，不是实现方式。
- 优先级只按 MVP 必要性分：P0 少了不能发布；P1 下个迭代第一批；P2 长期。
- 先列 P0，再列 P1/P2；P0 数量控制在 3–6 条，多了说明 MVP 没收窄。

## 验收标准的判定标尺

好的验收标准满足三条：**可判定**（能说清通过/不通过）、**单一**（一条只验证一件事）、**有前提**（写清了前置状态）。

| 差 | 好 |
| --- | --- |
| 打卡功能正常 | 给定用户当天未打卡，当完成 1 个跟读任务，那么系统记录打卡并展示连续天数为 1 |
| 首页好看 | 给定用户已打卡，当打开首页，那么首屏展示连续天数、今日任务与排行榜入口，且 1s 内完成渲染 |
| 支持分享 | 给定用户完成打卡，当点击「分享」并选择微信，那么生成含连续天数的分享图并调起微信分享面板 |
| 用户不能重复打卡 | 给定用户当天已完成打卡，当再次完成跟读任务，那么打卡状态不变，仅累加学习记录（不重复加连续天数） |

格式：`给定 [前置条件]，当 [操作/触发]，那么 [可观察的结果]`。英文场景可写 `Given …, When …, Then …`。

## 假设与待确认账本（assumptions / open_questions）

0.2.0 起，`prd` 对象可以（也强烈建议）带两个账本字段。它们会渲染进三份产物：

- `prd.md` 第 10 章（假设表 + 待确认表），第 2 章用户故事表新增「依赖假设」列；
- `prd.json` 顶层 `assumptions` / `open_questions`，`_meta` 带 `assumption_count` / `open_question_count`；
- `acceptance.md` 受影响故事下标「依赖假设」，被阻塞故事下标「⚠ 待确认」。

### assumptions（AI 替用户做的决定）

| 字段 | 必填 | 取值 / 说明 |
| --- | --- | --- |
| `id` | ✅ | 唯一，建议 `A1`、`A2`；与 `open_questions` 的 id 全局不重复 |
| `statement` | ✅ | 一句话写清你替用户决定了什么，要具体到可验证 |
| `source` | ✅ | `user`（用户原话）/ `inference`（你推断的）/ `industry`（行业默认做法） |
| `impact` | ✅ | `blocks-p0`（不确定就没法做 P0）/ `changes-scope`（改变了 MVP 范围）/ `minor`（影响较小） |
| `affects` | | 受影响的用户故事 id 数组，**必须是真实存在的故事 id** |
| `evidence` | | 依据：用户原话 / 搜索结果 / 行业惯例说明；`impact=blocks-p0` 时强烈建议写 |

质量标准：

- 一条假设只对应一个决定；「假设用户会喜欢」不是假设，是愿望。
- 用户已经明确说过的，`source` 写 `user`；你补的写 `inference`；抄行业默认做法的写 `industry`。
- `impact` 要诚实：影响 P0 可行性的必须写 `blocks-p0`，不要为了好看都写 `minor`。

### open_questions（待确认问题）

| 字段 | 必填 | 取值 / 说明 |
| --- | --- | --- |
| `id` | ✅ | 唯一，建议 `Q1`、`Q2` |
| `question` | ✅ | 一条一个问题，最好带背景和选项 |
| `blocks` | | 被阻塞的用户故事 id 数组，**必须是真实存在的故事 id** |
| `default_assumption` | | 默认假设：`assumptions` 里的 id（如 `"A2"`）或直接一句话；P0 被阻塞时**必须**给 |
| `owner` | | 谁来回答（用户 / 法务 / 老板 / 产品负责人…） |

### 硬规则（prd_check 会判）

1. 任一 P0 故事被 `open_questions[].blocks` 阻塞，且既无 `default_assumption`、也无 `affects` 覆盖它的假设 → **error**：`P0 故事 US-xxx 依赖未确认问题 Q1，必须先给默认假设或降级`。
2. `assumptions` 为空 → **warning**：「AI 生成的 PRD 必须显式记录假设；若全部来自用户原话，请写明 source=user 的假设」。
3. `impact=blocks-p0` 但 `evidence` 为空 → **warning**：补依据，否则评审无法判断该假设是否成立。
4. `prd_write` 会严格拒绝：非法 `source`/`impact`、重复 id、`affects`/`blocks` 引用不存在的故事。

### 例子

```jsonc
"assumptions": [
  { "id": "A1", "statement": "假设首版仅支持 iOS", "source": "inference", "impact": "blocks-p0",
    "affects": ["US-001"], "evidence": "用户团队只有 iOS 开发者" },
  { "id": "A2", "statement": "假设评分服务按调用量付费", "source": "industry", "impact": "changes-scope",
    "affects": ["US-002"] }
],
"open_questions": [
  { "id": "Q1", "question": "评分服务预算上限？", "blocks": ["US-002"],
    "default_assumption": "A2", "owner": "产品负责人" }
]
```

## 专项模板与 10 章内容

`prd.md` 固定 10 章，专项模板不新增章节，而是让对应专项内容落到正确章节：

| 章节 | 写什么 | 专项模板补充点 |
| --- | --- | --- |
| 1. 功能概览 | background / target_users | — |
| 2. 用户故事 | user_stories 表格 + 「依赖假设」列 | — |
| 3. 功能详情 | features + 明确不做 | Web：页面清单；App：导航结构 |
| 4. 验收标准 | 每条故事 Given-When-Then | API：错误码 / 幂等；App：离线 |
| 5. 非功能需求 | non_functional | 性能、安全、兼容性、可访问性 |
| 6. 技术考虑 | tech | API：协议/认证/限流；后端：架构/数据模型 |
| 7. MVP 范围 | scope | — |
| 8. 成功指标 | metrics | — |
| 9. 洞察与判断 | insights + competitive_analysis | — |
| 10. 假设与待确认 | assumptions + open_questions | — |

## 生成前自检

1. `name` / `summary` / `user_stories` 都在，且每条故事有 `story` + `priority` + `acceptance_criteria`；
2. 至少 1 条 P0；`scope.in_scope` 至少 1 条，且能被 P0 覆盖；
3. 每个 `id` 唯一（`US-001` 递增）；
4. AC 全部通过「可判定 / 单一 / 有前提」三条；
5. `tasks` 每条故事 2–5 条；
6. `insights` 六个维度齐全，且有具体判断而不是资料复述；
7. 你替用户做的决定都进了 `assumptions`（每条有 `source`；`blocks-p0` 有 `evidence`）；
8. 每条被 `blocks` 的 P0 故事都有 `default_assumption` 或被某条假设 `affects` 覆盖；
9. `affects` / `blocks` 里的故事 id 都真实存在，假设与问题的 id 没有重复。

## 生成之后

- 用 `prd_check` 校验；`errors` 必须清零，`warnings` 尽量清零。
- 需求变化时更新 `prd` 对象重新 `prd_write`，不要手改生成文件（会被覆盖）。
