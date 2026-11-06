# dsh-prd-generator

> A PRD generator plugin for DeepSeek Harness: **clarify → insight analysis → PRD → ralph-compatible prd.json → acceptance checklist**, five files in one pipeline.

Ported from [rubyzhao666/prd-generator](https://github.com/rubyzhao666/prd-generator) (MIT) into a DSH plugin.
The upstream project supplies the PRD method, templates and prompts; this plugin turns them into a DSH workflow where **the session model does the thinking and writing**, while two deterministic tools do strict validation and file output.

## Three-step pipeline

```
① Clarify (ask 3–5 key questions in one go)
        ↓
② Write the PRD (six-dimension insight analysis → pick a template → optional web_search competitor research → assemble the prd object)
        ↓
③ prd_write outputs 5 files → prd_check until ok → summarize for the user
```

## Capabilities

### Tools

| Tool | What it does |
| --- | --- |
| `prd_write` | Writes a structured `prd` object into 5 files: `prd.md` (9 chapters), `prd.json` (snarktank/ralph compatible), `acceptance.md` (P0/P1/P2 grouped Given-When-Then checklist), `mindmap.mmd`, `flowchart.mmd`. Strict validation: missing `name` / `summary` / `user_stories`, or a story without `acceptance_criteria`, fails with a field-by-field explanation. |
| `prd_check` | Validates an existing `prd.json`: JSON syntax, schema, at least 1 AC per story, at least 1 P0, non-empty `scope.in_scope`, unique story ids. Returns `{ok, errors, warnings, stats}` with actionable messages. |

### Skill: `prd-generator`

Bundled with the plugin. It loads when the user says things like "write a PRD", "product requirements", "feature planning" or "acceptance criteria". Workflow:

1. **Clarify** — ask 3–5 essential questions at once (skip and state assumptions when the user already gave enough);
2. **Insight analysis** — six dimensions: industry, user pain points, competitor blind spots, counter-intuitive judgments, risks, growth levers;
3. **Pick a template** — web-app / mobile-app / api / backend / general, and fold its checklists into the PRD fields;
4. **Competitor research** (optional) — use DSH's `web_search`, produce a sourced comparison;
5. **Assemble `prd` → `prd_write` → `prd_check` → fix until ok → summarize**.

All method docs and templates live under `skills/prd-generator/references/` (`prd-template.md`, `insight-analysis.md`, `competitive-analysis.md`, `ralph-json-format.md`, `mermaid-export.md`, `templates/{web-app,mobile-app,api,backend}.md`).

## Install

Install via the DSH plugin market, or as a local bundle through DSH's plugin manager (the plugin never installs itself):

```bash
cd /path/to/dsh-prd-generator
npm pack --dry-run      # inspect the published contents
```

After installing, `prd_write` / `prd_check` appear in the tool list and `prd-generator` appears in the skill list.

## Usage

### In conversation

> Write a PRD for a "daily check-in + read-aloud scoring" feature in an English-learning app.

The model loads the `prd-generator` skill, asks a few clarifying questions, then generates the full PRD and acceptance checklist.

### Direct tool calls (scripts / other agents)

```jsonc
// prd_write
{
  "dir": "/Users/me/Documents/PKM/prd-daily-checkin",
  "prd": {
    "name": "Daily check-in + read-aloud scoring",
    "summary": "A daily check-in and pronunciation-scoring loop that builds a learning habit.",
    "user_stories": [{
      "id": "US-001",
      "story": "As a learner, I want to finish a daily check-in task so that I keep a streak.",
      "priority": "P0",
      "acceptance_criteria": ["Given the user has not checked in today, when they finish one reading task, then the streak is recorded and shown as 1"],
      "tasks": ["Check-in state machine", "Streak calculation"],
      "complexity": "medium"
    }],
    "scope": { "in_scope": ["Check-in state machine"], "out_of_scope": ["Social friends"] },
    "template": "mobile-app"
  },
  "formats": ["md", "json", "acceptance", "mindmap", "flowchart"]  // optional, defaults to all
}
```

```jsonc
// prd_check
{ "path": "/Users/me/Documents/PKM/prd-daily-checkin" }
```

### Manual smoke test

```bash
node scripts/smoke.mjs                 # writes to a system temp directory
node scripts/smoke.mjs /tmp/prd-demo   # writes to a given directory
```

## Generated files

| File | Contents | Purpose |
| --- | --- | --- |
| `prd.md` | 9 chapters: overview / user stories / features / acceptance criteria / non-functional / technical / MVP scope / success metrics / insights | Review and archival |
| `prd.json` | snarktank/ralph-compatible structure + `_meta` | Execution by AI coding agents (Ralph) |
| `acceptance.md` | P0/P1/P2 groups, Given-When-Then checkbox list per story | Self-testing and acceptance |
| `mindmap.mmd` | Mermaid mind map | Render in GitHub / Obsidian / Feishu / VS Code |
| `flowchart.mmd` | Mermaid user flow (P0 main path + later iterations + out-of-scope) | Walkthroughs in reviews |

Priorities: **P0 = must ship for MVP; P1 = first iteration after MVP; P2 = long term.**

## Data and network

- **No `$DSH_HOME` writes**: the plugin is stateless and only writes into the `dir` (absolute path) given by the caller. Missing directories are created; same-named files are overwritten.
- **Zero runtime dependencies, pure ESM**: only Node built-ins, no `dependencies`.
- **No API keys, no secrets**: `prd_write` / `prd_check` are fully local; optional competitor research uses DSH's `web_search` from the session model.
- Configuration: none.

## Development and tests

```bash
node --check lib/index.js
node --check lib/tools.js
node --test test/*.test.mjs
npm pack --dry-run
```

Coverage: fake-ctx registration (tools + skill), `prd_write` end-to-end (content assertions for all 5 files, format subsets, overwrite, auto-filled ids/priorities), `prd_check` end-to-end (missing AC / missing P0 / empty `in_scope` / duplicate ids / invalid JSON, and more), plus `output.schema` conformance.

## License

MIT. Upstream [prd-generator](https://github.com/rubyzhao666/prd-generator) is copyright its authors; the DSH plugin adaptation is covered in [LICENSE](./LICENSE).
