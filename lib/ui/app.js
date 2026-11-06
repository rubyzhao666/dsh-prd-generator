// PRD Creator · 项目工作台（0.5.0）
// 浏览器侧单页应用：无构建、无外部资源；数据来自 /prd-generator/api/*。
// 动作按钮不直接执行工具，而是 postMessage 给外层 client → 开新会话并填入提示词。
(() => {
  'use strict'

  const BASE = (document.body && document.body.dataset && document.body.dataset.base) || '/prd-generator'
  const $ = (sel, root = document) => root.querySelector(sel)
  const esc = (value) =>
    String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[ch])

  const ICONS = {
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M8.5 13.5l2 2 4-4"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 20 20"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 6.1"/><path d="M20 4v7h-7"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  }

  const state = {
    entries: [],
    stats: { total: 0, ready: 0, pending: 0 },
    q: '',
    filter: 'all',
    sort: 'updated',
    route: 'list',
    detailId: null,
    detail: null,
    detailError: null,
    tab: 'stories',
    loading: true,
    theme: 'light',
    listSeq: 0,
    detailSeq: 0,
  }

  const root = {
    topbar: null,
    toolbar: null,
    view: null,
    toast: null,
  }

  // ---------------- 主题 ----------------

  function setTheme(scheme) {
    state.theme = scheme === 'dark' ? 'dark' : 'light'
    document.documentElement.dataset.theme = state.theme
  }

  function initTheme() {
    let dark = false
    try {
      if (window.parent !== window && window.parent.document.body) {
        dark = window.parent.document.body.hasAttribute('data-ds-dark-theme')
      }
    } catch {
      dark = false
    }
    if (!dark) {
      try {
        dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      } catch {
        dark = false
      }
    }
    setTheme(dark ? 'dark' : 'light')
  }

  function announceReady(attempt = 0) {
    try {
      if (window.parent !== window) window.parent.postMessage({ type: 'prd-generator:ready' }, location.origin)
    } catch {
      // 单独打开页面时没有 parent，忽略
    }
    if (attempt < 3) window.setTimeout(() => announceReady(attempt + 1), 400 + attempt * 600)
  }

  function onMessage(event) {
    if (event.source !== window.parent) return
    if (event.origin !== location.origin) return
    const message = event.data
    if (!message || typeof message !== 'object') return
    if (message.type === 'prd-generator:theme') {
      setTheme(message.scheme)
    } else if (message.type === 'prd-generator:session-started') {
      showToast('已在新会话里填入提示词，补完发送即可')
    } else if (message.type === 'prd-generator:session-failed') {
      showToast(`启动新会话失败：${message.message || '未知错误'}`, true)
    }
  }

  // ---------------- toast / 剪贴板 / 动作桥 ----------------

  let toastTimer = null
  function showToast(text, isError) {
    const el = root.toast
    if (!el) return
    el.textContent = text
    el.classList.toggle('error', Boolean(isError))
    el.classList.add('show')
    if (toastTimer) window.clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => el.classList.remove('show'), 2800)
  }

  async function copyText(text, label) {
    const value = String(text == null ? '' : text)
    if (!value) {
      showToast('没有可复制的内容', true)
      return
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(value)
      } else {
        const area = document.createElement('textarea')
        area.value = value
        area.setAttribute('readonly', '')
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        document.execCommand('copy')
        area.remove()
      }
      showToast(`已复制${label ? '：' + label : ''}`)
    } catch {
      showToast('复制失败，请手动选择复制', true)
    }
  }

  function startSession(prompt, label) {
    const text = String(prompt == null ? '' : prompt).trim()
    if (!text) {
      showToast('提示词为空，无法启动会话', true)
      return
    }
    if (text.length > 4000) {
      showToast('提示词超过 4000 字，已截断到前 4000 字', true)
    }
    const payload = text.slice(0, 4000)
    try {
      if (window.parent === window) {
        copyText(payload, '提示词（未在 DSH 中运行，已复制）')
        return
      }
      window.parent.postMessage({ type: 'prd-generator:start-session', prompt: payload, label: label || '' }, location.origin)
      showToast('正在新会话里填入提示词…')
    } catch {
      showToast('无法连接 DSH 会话，请直接在对话框里说', true)
    }
  }

  // ---------------- API ----------------

  async function api(path) {
    const response = await fetch(path, { headers: { accept: 'application/json' } })
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`)
      error.status = response.status
      throw error
    }
    return response.json()
  }

  async function loadList(options = {}) {
    const seq = ++state.listSeq
    if (!options.silent) state.loading = true
    state.error = null
    if (!options.silent) render()
    try {
      const data = await api(`${BASE}/api/prds`)
      if (seq !== state.listSeq) return
      state.entries = Array.isArray(data.entries) ? data.entries : []
      state.stats = data.stats || { total: state.entries.length, ready: 0, pending: 0 }
      state.loading = false
      render()
    } catch (error) {
      if (seq !== state.listSeq) return
      state.loading = false
      state.error = error.status === 404 ? 'not-found' : 'load-failed'
      render()
    }
  }

  async function loadDetail(id) {
    const seq = ++state.detailSeq
    state.detailId = id
    state.detail = null
    state.detailError = null
    state.loading = true
    state.tab = 'stories'
    render()
    try {
      const data = await api(`${BASE}/api/prds/${encodeURIComponent(id)}`)
      if (seq !== state.detailSeq) return
      state.loading = false
      state.detail = data
      render()
    } catch (error) {
      if (seq !== state.detailSeq) return
      state.loading = false
      if (error.status === 404) state.detailError = 'not-found'
      else if (error.status === 405) state.detailError = 'method'
      else state.detailError = 'load-failed'
      render()
    }
  }

  // ---------------- 路由 ----------------

  function parseHash() {
    const hash = String(location.hash || '')
    const match = hash.match(/^#\/p\/([0-9a-f]{12})\/?$/)
    return match ? { route: 'detail', id: match[1] } : { route: 'list' }
  }

  function applyRoute() {
    const parsed = parseHash()
    if (parsed.route === 'detail') {
      state.route = 'detail'
      if (state.detailId !== parsed.id || !state.detail) loadDetail(parsed.id)
      else render()
    } else {
      state.route = 'list'
      state.detailId = null
      state.detail = null
      state.detailError = null
      render()
      if (!state.entries.length && !state.error) loadList()
    }
  }

  function openDetail(id) {
    if (!id) return
    location.hash = `#/p/${encodeURIComponent(id)}`
  }

  function goList() {
    if (location.hash) location.hash = ''
    else applyRoute()
  }

  // ---------------- 提示词 ----------------

  const NEW_PRD_PROMPT =
    '帮我写个需求文档。先问我不超过 3 个最关键的问题（一次问完），然后直接生成 PRD 和验收清单，存到我的工作区。\n有些地方我可能没想清楚：先按合理假设写，但要把「你替我做的假设」和「需要我确认的问题」单独列出来。\n\n我的需求是：'

  function promptImprove(dir) {
    return `帮我完善这份 PRD（目录：${dir}）：先通读一遍，指出缺失或不够清楚的地方，补齐后重新检查一遍；最后告诉我你改了哪些地方、还有哪些需要我确认的问题。`
  }

  function promptHandoff(dir) {
    return `帮我为这份 PRD 做一份「执行交接单」（目录：${dir}）：检查它现在能不能直接交给开发或 AI 写代码。\n不能开工的地方用大白话列出来；能开工的话给我一份交接单，写清先做什么、做完怎么验收。`
  }

  function promptBlockers(dir, blockers) {
    const lines = (blockers || [])
      .map((item, index) => `${index + 1}. [${item.code}] ${item.message}${item.refs && item.refs.length ? `（相关：${item.refs.join(' / ')}）` : ''}`)
      .join('\n')
    return `帮我处理这份 PRD 里还不能开工的问题（目录：${dir}）：\n${lines}\n逐条告诉我需要我确认或补充什么；处理完再检查一遍能不能开工。`
  }

  // ---------------- 数据视图 ----------------

  function matchesQuery(entry, query) {
    if (!query) return true
    const text = `${entry.name || ''} ${entry.summary || ''} ${entry.dir || ''}`.toLowerCase()
    return text.includes(query.toLowerCase())
  }

  function handoffState(entry) {
    if (!entry.handoff || !entry.handoff.exists) return 'none'
    return entry.handoff.ready === true ? 'ready' : entry.handoff.ready === false ? 'pending' : 'unknown'
  }

  function filteredEntries() {
    let list = state.entries.filter((entry) => matchesQuery(entry, state.q))
    if (state.filter === 'ready') list = list.filter((entry) => handoffState(entry) === 'ready')
    else if (state.filter === 'pending') list = list.filter((entry) => handoffState(entry) === 'pending' || (entry.stats && entry.stats.openQuestions > 0))
    else if (state.filter === 'no-handoff') list = list.filter((entry) => handoffState(entry) === 'none')
    const sorted = [...list]
    if (state.sort === 'name') sorted.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN'))
    else if (state.sort === 'oldest') sorted.sort((a, b) => String(a.updatedAt || '').localeCompare(String(b.updatedAt || '')))
    else sorted.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    return sorted
  }

  function shortTime(value) {
    if (!value) return '未知时间'
    const time = Date.parse(value)
    if (Number.isNaN(time)) return String(value)
    const date = new Date(time)
    const pad = (n) => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  }

  function handoffBadge(entry) {
    const kind = handoffState(entry)
    if (kind === 'ready') return '<span class="badge ok">交接单：可执行</span>'
    if (kind === 'pending') return '<span class="badge warn">交接单：需先确认</span>'
    if (kind === 'unknown') return '<span class="badge muted">交接单：状态未知</span>'
    return '<span class="badge muted">交接单：未生成</span>'
  }

  // ---------------- 渲染：顶栏 / 工具栏 ----------------

  function renderTopbar() {
    const { total, ready, pending } = state.stats
    root.topbar.innerHTML = `
  <div class="brand-mark">${ICONS.doc}</div>
  <div class="brand-copy">
    <h1>PRD Creator</h1>
    <div class="brand-sub">
      <span>共 <b>${esc(total)}</b> 个 PRD</span>
      <span>可执行 <b>${esc(ready)}</b></span>
      <span>待确认 <b>${esc(pending)}</b></span>
    </div>
  </div>
  <div class="topbar-actions">
    <button class="btn ghost" type="button" data-act="refresh" title="刷新列表">${ICONS.refresh}刷新</button>
    <button class="btn primary" type="button" data-act="new-prd">${ICONS.plus}新建 PRD</button>
  </div>`
  }

  function renderToolbar() {
    if (state.route !== 'list') {
      root.toolbar.innerHTML = ''
      root.toolbar.style.display = 'none'
      return
    }
    root.toolbar.style.display = ''
    const chips = [
      ['all', '全部'],
      ['ready', '可执行'],
      ['pending', '待确认'],
      ['no-handoff', '未生成交接单'],
    ]
      .map(
        ([key, label]) =>
          `<button class="chip" type="button" data-filter="${key}" aria-pressed="${state.filter === key}">${label}</button>`,
      )
      .join('')
    root.toolbar.innerHTML = `
  <label class="search">
    ${ICONS.search}
    <input id="q" type="search" placeholder="搜索名称 / 摘要…" autocomplete="off" value="${esc(state.q)}">
    <span class="kbd">/</span>
  </label>
  <div class="chips" role="group" aria-label="筛选">${chips}</div>
  <select class="select" id="sort" aria-label="排序">
    <option value="updated"${state.sort === 'updated' ? ' selected' : ''}>最近更新</option>
    <option value="oldest"${state.sort === 'oldest' ? ' selected' : ''}>最早更新</option>
    <option value="name"${state.sort === 'name' ? ' selected' : ''}>名称 A→Z</option>
  </select>`
    const input = $('#q', root.toolbar)
    if (input) {
      input.addEventListener('input', () => {
        state.q = input.value.trim()
        renderList()
      })
    }
    const sort = $('#sort', root.toolbar)
    if (sort) sort.addEventListener('change', () => { state.sort = sort.value; renderList() })
    root.toolbar.querySelectorAll('[data-filter]').forEach((button) => {
      button.addEventListener('click', () => {
        state.filter = button.dataset.filter
        root.toolbar.querySelectorAll('[data-filter]').forEach((item) => item.setAttribute('aria-pressed', String(item.dataset.filter === state.filter)))
        renderList()
      })
    })
  }

  // ---------------- 渲染：列表 ----------------

  function renderList() {
    if (state.route !== 'list') return
    const region = root.view
    if (state.loading && !state.entries.length) {
      root.view.innerHTML = `<div class="list">${'<div class="skeleton"><div class="skeleton-line w40"></div><div class="skeleton-line w70"></div><div class="skeleton-line w55"></div></div>'.repeat(3)}</div>`
      return
    }
    if (state.error === 'load-failed') {
      region.innerHTML = `<div class="error-card"><h2>加载失败</h2><p>读不到 PRD 项目列表，请稍后重试。</p><button class="btn" type="button" data-act="refresh">重试</button></div>`
      return
    }
    if (!state.entries.length) {
      region.innerHTML = `<div class="empty">
  <h2>还没有生成过 PRD</h2>
  <p>对 DSH 说一句：「帮我写个需求文档：…」，生成后会自动出现在这里。</p>
  <p class="small">也可以点下面的按钮，在新会话里开始。</p>
  <button class="btn primary" type="button" data-act="new-prd">${ICONS.plus}新建 PRD</button>
</div>`
      return
    }
    const entries = filteredEntries()
    if (!entries.length) {
      region.innerHTML = `<div class="empty"><h2>没有匹配的 PRD</h2><p>换个关键词或筛选条件试试。</p><button class="btn" type="button" data-act="clear-filter">清除筛选</button></div>`
      return
    }
    const cards = entries
      .map((entry) => {
        const stats = entry.stats || {}
        const badges = [
          `<span class="badge accent">P0 <b>${esc(stats.p0 || 0)}</b></span>`,
          `<span class="badge">假设 <b>${esc(stats.assumptions || 0)}</b></span>`,
          `<span class="badge">待确认 <b>${esc(stats.openQuestions || 0)}</b></span>`,
          handoffBadge(entry),
        ].join('')
        return `<article class="card" data-id="${esc(entry.id)}" tabindex="0" role="button" aria-label="打开 ${esc(entry.name || '未命名 PRD')}">
  <div class="card-main">
    <div class="card-title">${esc(entry.name || '未命名 PRD')}</div>
    <div class="card-summary">${esc(entry.summary || '（无一句话描述）')}</div>
    <div class="card-meta">${badges}</div>
    <div class="card-meta">
      <span class="row-meta">更新于 ${esc(shortTime(entry.updatedAt))}</span>
      <span class="row-meta"><code title="${esc(entry.dir)}">${esc(entry.dir)}</code></span>
    </div>
  </div>
  <div class="card-side">
    <div class="card-actions">
      <button class="btn ghost small" type="button" data-act="copy-dir" data-dir="${esc(entry.dir)}" title="复制目录路径">${ICONS.copy}复制路径</button>
    </div>
    <span class="muted" aria-hidden="true">${ICONS.arrow}</span>
  </div>
</article>`
      })
      .join('\n')
    region.innerHTML = `<div class="list">${cards}</div>`
  }

  // ---------------- 渲染：详情 ----------------

  function statBar(stats) {
    const items = [
      ['故事', stats.stories],
      ['验收标准', stats.acceptanceCriteria],
      ['P0', stats.p0],
      ['P1', stats.p1],
      ['P2', stats.p2],
      ['假设', stats.assumptions],
      ['待确认', stats.openQuestions],
    ]
    return `<div class="statbar">${items
      .map(([key, value]) => `<div class="stat"><div class="k">${key}</div><div class="v">${esc(value || 0)}</div></div>`)
      .join('')}</div>`
  }

  function storyGroups(prd) {
    const stories = Array.isArray(prd.user_stories) ? prd.user_stories : []
    const groups = [
      ['P0', 'P0 · 必须完成'],
      ['P1', 'P1 · 下一个迭代'],
      ['P2', 'P2 · 长期规划'],
    ]
    const known = groups.map(([key]) => key)
    const renderStory = (story) => {
      const ac = (story.acceptance_criteria || []).map((item) => `<li class="ac"><span class="box"></span><span>${esc(item)}</span></li>`).join('')
      const tasks = (story.tasks || []).map((item) => `<li class="task">${esc(item)}</li>`).join('')
      return `<article class="story" data-id="${esc(story.id)}">
  <div class="story-head"><span class="story-id">${esc(story.id)}</span><span class="badge">${esc(story.priority || '—')}</span>${story.complexity ? `<span class="badge muted">复杂度 ${esc(story.complexity)}</span>` : ''}</div>
  <p class="story-text">${esc(story.story || '（未写用户故事）')}</p>
  <ul class="ac-list">${ac || '<li class="ac muted">（没有验收标准）</li>'}</ul>
  ${tasks ? `<ul class="task-list">${tasks}</ul>` : ''}
</article>`
    }
    const sections = []
    for (const [key, label] of groups) {
      const list = stories.filter((story) => String(story.priority || '').toUpperCase() === key)
      if (!list.length) continue
      sections.push(`<div class="section-title"><h2>${label}</h2><span class="count">${list.length} 条</span></div>${list.map(renderStory).join('')}`)
    }
    const others = stories.filter((story) => !known.includes(String(story.priority || '').toUpperCase()))
    if (others.length) sections.push(`<div class="section-title"><h2>未标注优先级</h2><span class="count">${others.length} 条</span></div>${others.map(renderStory).join('')}`)
    return sections.join('') || '<div class="empty"><h2>没有用户故事</h2><p>回到对话让模型补 prd.user_stories。</p></div>'
  }

  function ledgerPanel(prd) {
    const assumptions = Array.isArray(prd.assumptions) ? prd.assumptions : []
    const questions = Array.isArray(prd.open_questions) ? prd.open_questions : []
    const sourceLabels = { user: '用户原话', inference: '推断', industry: '行业惯例' }
    const impactLabels = { 'blocks-p0': '阻塞 P0', 'changes-scope': '改变范围', minor: '影响较小' }
    const assumptionTable = assumptions.length
      ? `<div class="table-wrap"><table class="grid">
  <thead><tr><th>ID</th><th>陈述</th><th>来源</th><th>影响</th><th>涉及故事</th><th>依据</th></tr></thead>
  <tbody>${assumptions
    .map(
      (item) => `<tr class="assumption"><td class="mono">${esc(item.id)}</td><td class="wrap">${esc(item.statement)}</td><td><span class="pill">${esc(sourceLabels[item.source] || item.source || '—')}</span></td><td><span class="pill ${item.impact === 'blocks-p0' ? 'warn' : ''}">${esc(impactLabels[item.impact] || item.impact || '—')}</span></td><td>${esc((item.affects || []).join('、') || '—')}</td><td class="wrap muted">${esc(item.evidence || '—')}</td></tr>`,
    )
    .join('')}</tbody></table></div>`
      : '<div class="empty"><h2>没有记录假设</h2><p>回到对话让模型把「替你做的决定」补进 assumptions。</p></div>'
    const questionTable = questions.length
      ? `<div class="table-wrap"><table class="grid">
  <thead><tr><th>ID</th><th>问题</th><th>阻塞故事</th><th>默认假设</th><th>负责人</th></tr></thead>
  <tbody>${questions
    .map(
      (item) => `<tr class="question"><td class="mono">${esc(item.id)}</td><td class="wrap">${esc(item.question)}</td><td>${esc((item.blocks || []).join('、') || '—')}</td><td class="wrap">${esc(item.default_assumption || '—')}</td><td>${esc(item.owner || '—')}</td></tr>`,
    )
    .join('')}</tbody></table></div>`
      : '<div class="empty"><h2>没有待确认问题</h2><p>很好，当前没有需要用户拍板的问题。</p></div>'
    return `<div class="section-title"><h2>假设</h2><span class="count">${assumptions.length} 条</span></div>${assumptionTable}
<div class="section-title"><h2>待确认问题</h2><span class="count">${questions.length} 条</span></div>${questionTable}`
  }

  function handoffPanel(entry, handoff) {
    const dir = entry.dir
    if (!handoff || !handoff.exists) {
      return `<div class="handoff-hero">
  <div class="handoff-status"><span class="dot"></span>还没有生成交接单</div>
  <p class="muted small" style="margin:8px 0 0">交给 Ralph / AI coding agent 之前，先让模型做一次执行前门禁。</p>
  <div class="detail-actions"><button class="btn primary" type="button" data-act="gen-handoff">生成交接单</button></div>
</div>`
    }
    const blockers = Array.isArray(handoff.blockers) ? handoff.blockers : []
    const warnings = Array.isArray(handoff.warnings) ? handoff.warnings : []
    const ready = handoff.ready === true
    const issue = (item, kind) => `<li class="issue ${kind}"><span class="code">${esc(item.code)}</span>${esc(item.message)}${item.refs && item.refs.length ? `<div class="refs">相关：${esc(item.refs.join(' / '))}</div>` : ''}</li>`
    return `<div class="handoff-hero ${ready ? 'ok' : 'warn'}">
  <div class="handoff-status"><span class="dot"></span>${ready ? '可执行（ready=true）' : `需先确认（${blockers.length} 个 blocker）`}</div>
  <div class="handoff-path">交接单：<code>${esc(handoff.path)}</code></div>
  ${blockers.length ? `<div class="section-title" style="margin-top:14px"><h2>Blockers</h2><span class="count">${blockers.length} 条</span></div><ul class="issue-list">${blockers.map((item) => issue(item, 'blocker')).join('')}</ul>` : ''}
  ${warnings.length ? `<div class="section-title" style="margin-top:14px"><h2>Warnings</h2><span class="count">${warnings.length} 条</span></div><ul class="issue-list">${warnings.map((item) => issue(item, 'warning')).join('')}</ul>` : ''}
  <div class="detail-actions">
    <button class="btn ghost" type="button" data-act="gen-handoff">更新交接单</button>
    ${blockers.length ? `<button class="btn primary" type="button" data-act="handle-blockers">在对话里处理 blockers</button>` : ''}
    <button class="btn ghost" type="button" data-act="copy-handoff" data-copy="${esc(handoff.path)}">复制交接单路径</button>
  </div>
</div>`
  }

  function filesPanel(detail) {
    const files = Array.isArray(detail.files) ? detail.files : []
    const rows = files
      .map(
        (file) => `<div class="file-row${file.exists ? '' : ' missing'}">
  <span class="name">${esc(file.name)}</span>
  <span class="path" title="${esc(file.path)}">${esc(file.path)}</span>
  <button class="btn ghost small" type="button" data-act="copy-file" data-copy="${esc(file.path)}" ${file.exists ? '' : 'disabled'}>${ICONS.copy}复制</button>
</div>`,
      )
      .join('')
    return `<div class="files">${rows || '<div class="empty"><h2>没有文件</h2></div>'}</div>
<p class="muted small" style="margin-top:10px">共 ${files.length} 个文件；「不存在」的可能还没生成（交接单要先点上面的「生成/更新交接单」）。</p>`
  }

  function detailHeader(entry, prd, extra) {
    const dir = entry.dir || ''
    const prdJsonPath = `${dir}/prd.json`
    return `<button class="back" type="button" data-act="back">${ICONS.back}返回项目列表</button>
<header class="detail-head">
  <h1>${esc(prd.name || entry.name || '未命名 PRD')}</h1>
  <p class="detail-summary">${esc(prd.summary || entry.summary || '')}</p>
  <div class="detail-meta">
    <span>生成时间 ${esc(shortTime(prd.generatedAt || entry.generatedAt))}</span>
    ${prd.template ? `<span>模板 <code>${esc(prd.template)}</code></span>` : ''}
    <span>目录 <code title="${esc(dir)}">${esc(dir)}</code></span>
  </div>
  <div class="detail-actions">
    <button class="btn primary" type="button" data-act="improve">完善这份 PRD</button>
    <button class="btn" type="button" data-act="gen-handoff">生成 / 更新交接单</button>
    <button class="btn ghost" type="button" data-act="copy-dir">${ICONS.copy}复制目录路径</button>
    <button class="btn ghost" type="button" data-act="copy-json">${ICONS.copy}复制 prd.json 路径</button>
  </div>
</header>
${extra || ''}`
  }

  function renderDetail() {
    const region = root.view
    const entry = state.detail && state.detail.entry ? state.detail.entry : { id: state.detailId, dir: '', name: '', summary: '' }
    if (state.loading) {
      region.innerHTML = `<button class="back" type="button" data-act="back">${ICONS.back}返回项目列表</button>
<div class="skeleton"><div class="skeleton-line w40"></div><div class="skeleton-line w70"></div><div class="skeleton-line w55"></div></div>`
      return
    }
    if (state.detailError) {
      const message =
        state.detailError === 'not-found'
          ? '这个 PRD 记录不存在，可能已被删除或 id 有误。'
          : state.detailError === 'method'
            ? '接口不允许该请求方法。'
            : '加载详情失败，请稍后重试。'
      region.innerHTML = `<button class="back" type="button" data-act="back">${ICONS.back}返回项目列表</button>
<div class="error-card"><h2>无法打开 PRD</h2><p>${esc(message)}</p><button class="btn" type="button" data-act="refresh">重试</button></div>`
      return
    }
    const detail = state.detail
    if (!detail) return
    if (detail.error) {
      const isMissing = detail.error === 'missing'
      region.innerHTML = `${detailHeader(entry, { name: entry.name, summary: entry.summary, generatedAt: entry.generatedAt }, '')}
<div class="error-card">
  <h2>${isMissing ? 'PRD 目录不存在' : 'prd.json 读取失败'}</h2>
  <p>${esc(detail.message || '未知原因')}</p>
  <p class="small">目录：<code>${esc(entry.dir || '')}</code></p>
  <p class="small">可能被移动/删除，或文件损坏。回到对话重新运行「写 PRD」即可生成新文件；旧的生成记录可返回列表查看其它 PRD。</p>
  <div class="detail-actions"><button class="btn" type="button" data-act="back">返回列表</button><button class="btn ghost" type="button" data-act="gen-handoff">试试生成交接单</button></div>
</div>`
      return
    }
    const prd = detail.prd || {}
    const tabs = [
      ['stories', '故事'],
      ['ledger', '假设与待确认'],
      ['handoff', '交接单'],
      ['files', '文件'],
    ]
      .map(
        ([key, label]) =>
          `<button class="tab" type="button" role="tab" data-tab="${key}" aria-selected="${state.tab === key}">${label}</button>`,
      )
      .join('')
    let panel = ''
    if (state.tab === 'ledger') panel = ledgerPanel(prd)
    else if (state.tab === 'handoff') panel = handoffPanel(entry, detail.handoff)
    else if (state.tab === 'files') panel = filesPanel(detail)
    else panel = storyGroups(prd)
    region.innerHTML = `${detailHeader(entry, prd, statBar(detail.stats || {}))}
<div class="tabs" role="tablist">${tabs}</div>
<div class="tabpanel" role="tabpanel">${panel}</div>`
  }

  function render() {
    renderTopbar()
    renderToolbar()
    if (state.route === 'detail') renderDetail()
    else renderList()
  }

  // ---------------- 事件 ----------------

  function onGlobalClick(event) {
    const actionEl = event.target.closest('[data-act]')
    if (actionEl) {
      const act = actionEl.dataset.act
      const entry = state.detail && state.detail.entry ? state.detail.entry : null
      if (act === 'new-prd') startSession(NEW_PRD_PROMPT, '新建 PRD')
      else if (act === 'refresh') {
        loadList({ silent: false })
        if (state.route === 'detail' && state.detailId) loadDetail(state.detailId)
      } else if (act === 'copy-dir') copyText(actionEl.dataset.dir || (entry && entry.dir), '目录路径')
      else if (act === 'copy-json') copyText(entry ? `${entry.dir}/prd.json` : '', 'prd.json 路径')
      else if (act === 'copy-file' || act === 'copy-handoff') copyText(actionEl.dataset.copy, '路径')
      else if (act === 'improve' && entry) startSession(promptImprove(entry.dir), '完善 PRD')
      else if (act === 'gen-handoff' && entry) startSession(promptHandoff(entry.dir), '生成交接单')
      else if (act === 'handle-blockers' && entry) {
        const blockers = state.detail && state.detail.handoff ? state.detail.handoff.blockers || [] : []
        startSession(promptBlockers(entry.dir, blockers), '处理 blockers')
      } else if (act === 'back') goList()
      else if (act === 'clear-filter') {
        state.q = ''
        state.filter = 'all'
        render()
      }
      return
    }
    const tab = event.target.closest('[data-tab]')
    if (tab) {
      state.tab = tab.dataset.tab
      renderDetail()
      return
    }
    const card = event.target.closest('.card[data-id]')
    if (card) openDetail(card.dataset.id)
  }

  function onKeydown(event) {
    if (event.key === '/' && state.route === 'list') {
      const active = document.activeElement
      const typing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')
      if (!typing) {
        event.preventDefault()
        const input = $('#q')
        if (input) input.focus()
      }
      return
    }
    if (event.key === 'Escape') {
      if (state.route === 'detail') goList()
      else if (document.activeElement && document.activeElement.tagName === 'INPUT') document.activeElement.blur()
      return
    }
    if ((event.key === 'Enter' || event.key === ' ') && event.target && event.target.classList && event.target.classList.contains('card')) {
      event.preventDefault()
      openDetail(event.target.dataset.id)
    }
  }

  function boot() {
    root.topbar = $('#topbar')
    root.toolbar = $('#toolbar')
    root.view = $('#view')
    root.toast = $('#toast')
    initTheme()
    window.addEventListener('message', onMessage)
    window.addEventListener('hashchange', applyRoute)
    document.addEventListener('click', onGlobalClick)
    document.addEventListener('keydown', onKeydown)
    render()
    loadList()
    applyRoute()
    announceReady()
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()
