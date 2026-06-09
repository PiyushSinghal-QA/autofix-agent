'use strict';

const STAGES = [
  { key: 'detected', label: 'Detected' },
  { key: 'carded', label: 'Carded' },
  { key: 'branched', label: 'Branched' },
  { key: 'ai-fix', label: 'AI fix' },
  { key: 'validating', label: 'Validating' },
  { key: 'pr-opened', label: 'PR opened' },
];

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const time = (ts) => { try { return new Date(ts).toLocaleTimeString(); } catch { return ''; } };

let running = false;
let source = null;
let nodes = {};
let currentJobId = null;
const bugCards = {};

// ── Bootstrap ────────────────────────────────────────────────────────
async function init() {
  $('#scanBtn').addEventListener('click', scanBaseline);
  $('#clearIssues').addEventListener('click', clearIssues);
  await loadConfig();
  await loadHealth();
  await loadIssues();
  await loadHistory();
  await loadReport();
  setInterval(() => { loadReport(); loadIssues(); }, 4000); // reflect fresh pushes from checkout-e2e
}

async function loadReport() {
  try {
    const r = await (await fetch('./api/report')).json();
    const node = $('#reportSub');
    if (!node) return;
    node.textContent = r
      ? `${r.branch} · ${r.passed}/${r.totalTests} passed · ${r.failed} failing · ${new Date(r.receivedAt).toLocaleTimeString()}`
      : 'no runs yet';
  } catch { /* no report yet */ }
}

async function loadConfig() {
  try {
    const c = await (await fetch('./api/config')).json();
    const chips = $('#configChips');
    chips.innerHTML = '';
    chips.append(chip(`AI: <b>${esc(c.aiProvider)}</b>`, c.aiProvider === 'mock'));
    chips.append(chip(`DRY_RUN: <b>${esc(String(c.dryRun))}</b>`, !c.dryRun));
    chips.append(chip(`repo: <b>${esc(c.repository)}</b>`, false));
  } catch (e) { /* ignore */ }
}

function chip(html, warn) {
  return el('span', 'chip' + (warn ? ' warn' : ''), `<span class="led"></span>${html}`);
}

async function clearIssues() {
  const btn = $('#clearIssues');
  if (btn) btn.disabled = true;
  try { await fetch('./api/issues/clear', { method: 'POST' }); } catch { /* ignore */ }
  await loadReport();
  await loadIssues();
  if (btn) btn.disabled = false;
}

async function loadIssues() {
  const list = $('#bugList');
  try {
    const issues = await (await fetch('./api/issues')).json();
    for (const k of Object.keys(bugCards)) delete bugCards[k];
    if (!Array.isArray(issues) || !issues.length) {
      list.innerHTML = '<div class="muted">No issues found yet — run <code>checkout-e2e</code> and it will push results here.</div>';
      return;
    }
    list.innerHTML = '';
    for (const it of issues) list.append(issueCard(it));
    loadHealth(); // paints status pills (open / in review / fixed) onto the cards
  } catch {
    list.innerHTML = '<div class="muted">Failed to load issues.</div>';
  }
}

function issueCard(b) {
  const id = b.bugId || b.id;
  const card = el('div', 'bug');
  card.dataset.bug = id;
  card.append(el('div', 'bug-top',
    `<span class="sev ${esc(b.severity)}">${esc(b.severity)}</span>` +
    `<span class="bug-title">${esc(b.title)}</span>` +
    `<span class="bug-status open" data-status>open</span>`));
  const seen = b.runs
    ? `<span class="seen">seen in <b>${esc(b.runs)}</b> run(s) · last ${esc(new Date(b.lastSeen).toLocaleTimeString())}</span>`
    : '';
  card.append(el('div', 'bug-meta',
    `<span><code>${esc(b.category)}</code> · branch <code>${esc(b.branch)}</code></span>` +
    `<span>fails: <code>${esc(b.failingTest)}</code></span>` +
    seen));
  const actions = el('div', 'bug-actions');
  const btn = el('button', 'trigger', 'Trigger AutoFix');
  btn.dataset.bug = id;
  btn.addEventListener('click', () => trigger(id));
  actions.append(btn);
  card.append(actions);
  bugCards[id] = card;
  return card;
}

// ── Health ───────────────────────────────────────────────────────────
const STATUS_LABEL = { open: 'open', 'in-progress': 'fixing…', 'fix-proposed': 'in review', 'pr-open': 'PR open', resolved: 'resolved' };

async function loadHealth() {
  try {
    const h = await (await fetch('./api/health')).json();
    renderHealth(h);
    for (const b of h.bugs) applyBugStatus(b);
  } catch (e) { /* ignore */ }
}

function renderHealth(h) {
  const badge = $('#healthBadge');
  badge.className = 'health-badge ' + h.status;
  badge.textContent = h.status;
  $('#healthRepo').textContent = h.repository;
  $('#healthSub').textContent =
    `${h.open + h.inProgress} open · ${h.proposed} in review · ${h.prOpen} PR open · ${h.resolved} resolved`;
  $('#healthSev').innerHTML =
    sevchip('high', h.bySeverity.high) + sevchip('medium', h.bySeverity.medium) + sevchip('low', h.bySeverity.low);
  if (h.baseline) renderBaseline(h.baseline);
}

const sevchip = (sev, n) => `<span class="sevchip">${esc(sev)} <b>${esc(n)}</b></span>`;

function applyBugStatus(b) {
  const card = bugCards[b.id];
  if (!card) return;
  const pill = card.querySelector('[data-status]');
  pill.className = 'bug-status ' + b.status;
  pill.textContent = STATUS_LABEL[b.status] || b.status;
  let prEl = card.querySelector('.bug-pr');
  if (b.pr) {
    if (!prEl) { prEl = el('div', 'bug-pr'); card.querySelector('.bug-meta').append(prEl); }
    prEl.innerHTML = `PR <a href="${esc(b.pr.url)}" target="_blank" rel="noreferrer">#${esc(b.pr.number)}</a>`;
  } else if (prEl) { prEl.remove(); }
}

async function scanBaseline() {
  const btn = $('#scanBtn');
  btn.disabled = true; btn.textContent = 'Running suite…';
  try {
    const r = await (await fetch('./api/health/scan', { method: 'POST' })).json();
    renderBaseline(r);
  } catch (e) {
    $('#baselineResult').textContent = 'scan failed';
  } finally {
    btn.disabled = false; btn.textContent = 'Run baseline check';
  }
}

function renderBaseline(r) {
  const node = $('#baselineResult');
  node.className = 'baseline-result ' + (r.ok ? 'ok' : 'bad');
  node.innerHTML = `main suite: <b>${esc(r.passed)}/${esc(r.total)} ${r.ok ? 'green' : 'failing'}</b> · ${(r.durationMs / 1000).toFixed(1)}s`;
}

async function loadHistory() {
  const box = $('#history');
  try {
    const jobs = await (await fetch('./api/jobs')).json();
    if (!jobs.length) { box.innerHTML = '<div class="muted">No AutoFix jobs yet — hit “Trigger AutoFix” on an issue.</div>'; return; }
    box.innerHTML = '';
    for (const j of jobs.slice(0, 8)) {
      const row = el('div', 'run-row');
      const pr = j.pr ? `<a href="${esc(j.pr.url)}" target="_blank" rel="noreferrer">PR #${esc(j.pr.number)}</a>` : '';
      const status = j.status === 'awaiting-approval' ? 'running' : j.status;
      row.innerHTML = `<span class="pill ${esc(status)}">${esc(j.status)}</span><span class="rtitle">${esc(j.bugId)}</span>${pr}`;
      box.append(row);
    }
  } catch (e) { /* ignore */ }
}

// ── Trigger + stream ─────────────────────────────────────────────────
function setRunning(on) {
  running = on;
  document.querySelectorAll('button.trigger').forEach((b) => (b.disabled = on));
}

async function trigger(bugId) {
  if (running) return;
  setRunning(true);
  hideReview();
  buildTimeline();
  setBanner('running', `Running — ${bugId}`);
  try {
    const rogue = $('#rogueToggle').checked;
    const autoApprove = $('#autoApprove').checked;
    const res = await (await fetch('./api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bugId, rogue, autoApprove }),
    })).json();
    if (!res.jobId) {
      // e.g. duplicate-PR guard returned 400 with a message
      setBanner('failed', res.message || 'Could not start a fix');
      $('#timeline').classList.add('hidden');
      $('#empty').classList.remove('hidden');
      setRunning(false);
      return;
    }
    currentJobId = res.jobId;
    openStream(res.jobId);
  } catch (e) {
    setBanner('failed', 'Failed to start job');
    setRunning(false);
  }
}

function openStream(jobId) {
  if (source) source.close();
  source = new EventSource(`./api/jobs/${jobId}/stream`);
  source.onmessage = (m) => {
    let ev;
    try { ev = JSON.parse(m.data); } catch { return; }
    handleEvent(ev);
  };
  source.onerror = () => { /* server stream is long-lived; ignore transient errors */ };
}

function closeStream() { if (source) { source.close(); source = null; } }

// ── Timeline ─────────────────────────────────────────────────────────
function buildTimeline() {
  const tl = $('#timeline');
  tl.innerHTML = '';
  nodes = {};
  const tpl = $('#stageTpl');
  for (const s of STAGES) {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.dataset.stage = s.key;
    node.classList.add('pending');
    node.querySelector('.stage-name').textContent = s.label;
    tl.append(node);
    nodes[s.key] = node;
  }
  $('#empty').classList.add('hidden');
  tl.classList.remove('hidden');
}

function setStatus(node, status) {
  if (!node) return;
  if (node.classList.contains('done') && status === 'active') return;
  node.classList.remove('pending', 'active', 'done', 'error');
  node.classList.add(status);
}

function setBanner(cls, text) { const b = $('#jobBanner'); b.className = 'job-banner ' + cls; b.textContent = text; }
function detailEl(node) { return node.querySelector('.stage-detail'); }

function handleEvent(ev) {
  if (ev.stage === 'done') return onDone(ev);
  if (ev.stage === 'failed') return onFailed(ev);
  if (ev.stage === 'awaiting-approval') return onAwaiting(ev);

  const node = nodes[ev.stage];
  if (!node) return;

  if (ev.status === 'start') { setStatus(node, 'active'); node.querySelector('.stage-msg').textContent = ev.message; }
  else if (ev.status === 'success') { setStatus(node, 'done'); node.querySelector('.stage-msg').textContent = ev.message; }
  else if (ev.status === 'error') { setStatus(node, 'error'); node.querySelector('.stage-msg').textContent = ev.message; }
  else if (ev.status === 'info' && node.classList.contains('pending')) setStatus(node, 'active');

  node.querySelector('.stage-time').textContent = time(ev.timestamp);
  renderDetail(ev, node);
}

function renderDetail(ev, node) {
  const d = ev.data || {};
  const detail = detailEl(node);

  if (ev.stage === 'detected' && d.bug) {
    detail.innerHTML =
      `<div class="kv"><span class="tag">severity: ${esc(d.bug.severity)}</span>` +
      `<span class="tag">${esc(d.bug.category)}</span><span class="tag">${esc(d.bug.branch)}</span></div>` +
      (d.bug.logs ? `<div class="logbox">${esc(d.bug.logs)}</div>` : '');
  } else if (ev.stage === 'carded') {
    if (d.card) detail.innerHTML = `<div class="kv">` + (d.card.labels || []).map((l) => `<span class="tag">${esc(l)}</span>`).join('') + `</div>`;
    else if (ev.status === 'info') appendNote(detail, ev.message);
  } else if (ev.stage === 'branched' && d.fixBranch) {
    detail.innerHTML = `<div class="kv"><span class="tag">${esc(d.fixBranch)}</span><span class="tag">base: ${esc(d.baseBranch)}</span></div>`;
  } else if (ev.stage === 'ai-fix') {
    if (d.diff) renderFix(detail, ev);
    else if (ev.status === 'info') appendReasoning(detail, ev.message);
  } else if (ev.stage === 'validating' && d.step) {
    addGate(detail, d.step);
  } else if (ev.stage === 'pr-opened' && d.pullRequest) {
    detail.innerHTML = '';
    detail.append(renderPr(d.pullRequest));
  }
}

function appendNote(detail, text) {
  let note = detail.querySelector('.note');
  if (!note) { note = el('div', 'muted note'); detail.append(note); }
  note.textContent = text;
}
function reasoningList(detail) {
  let ul = detail.querySelector('.reasoning-list');
  if (!ul) { ul = el('ul', 'reasoning-list'); detail.prepend(ul); }
  return ul;
}
function appendReasoning(detail, line) { reasoningList(detail).append(el('li', 'fresh', esc(line))); }

function renderFix(detail, ev) {
  const d = ev.data;
  const t = d.tokenUsage || { input: 0, output: 0, total: 0 };
  let stats = detail.querySelector('.stats');
  if (!stats) { stats = el('div', 'stats'); detail.append(stats); }
  stats.innerHTML =
    statBox(t.total, 'tokens') + statBox(t.input + '/' + t.output, 'in / out') +
    statBox(d.latencyMs + 'ms', 'latency') + statBox('+' + d.additions + ' / -' + d.deletions, 'lines') +
    statBox(esc(d.provider), 'provider');
  let pre = detail.querySelector('.diff');
  if (!pre) { pre = el('pre', 'diff'); detail.append(pre); }
  pre.innerHTML = highlightDiff(d.diff);
}
const statBox = (n, l) => `<div class="stat"><div class="n">${esc(n)}</div><div class="l">${esc(l)}</div></div>`;

function addGate(detail, step) {
  let gates = detail.querySelector('.gates');
  if (!gates) { gates = el('div', 'gates'); detail.append(gates); }
  const cls = step.skipped ? 'skip' : step.ok ? 'pass' : 'fail';
  const icon = step.skipped ? '–' : step.ok ? '✓' : '✕';
  gates.append(el('div', 'gate ' + cls,
    `<span class="g-icon">${icon}</span><span class="g-name">${esc(step.name)}</span>` +
    `<span class="g-res">${step.skipped ? 'skipped' : step.durationMs + 'ms'}</span>`));
}

function renderPr(pr) {
  const card = el('div', 'pr');
  const head = el('div', 'pr-head');
  head.innerHTML =
    `<span class="pr-merge">${pr.draft ? 'Draft PR' : 'Pull request'}</span>` +
    `<span class="pr-num"><a href="${esc(pr.url)}" target="_blank" rel="noreferrer" style="color:inherit">#${esc(pr.number)}</a></span>` +
    `<span class="pr-flow"><b>${esc(pr.head)}</b> → <b>${esc(pr.base)}</b></span>` +
    `<div class="pr-title">${esc(pr.title)}</div>` +
    `<div class="pr-reviewers">reviewers: <b>${esc((pr.reviewers || []).join(', '))}</b> · <a href="${esc(pr.url)}" target="_blank" rel="noreferrer">${esc(pr.url)}</a></div>`;
  card.append(head);
  const body = el('div', 'pr-body');
  body.innerHTML = mdToHtml(pr.body || '');
  card.append(body);
  return card;
}

// ── Review gate (approve / discard) ──────────────────────────────────
function onAwaiting(ev) {
  STAGES.slice(0, 5).forEach((s) => setStatus(nodes[s.key], 'done'));
  setBanner('awaiting', 'Awaiting approval');
  const branch = ev.data && ev.data.fixBranch ? ev.data.fixBranch : 'the fix branch';
  const rc = $('#reviewControls');
  rc.classList.remove('hidden');
  rc.innerHTML =
    `<div class="rc-title">AI fix ready for review</div>` +
    `<div class="rc-sub">Validated and committed on <code>${esc(branch)}</code>. Approve to open the PR, or discard to drop the branch — nothing ships without your say-so.</div>` +
    `<div class="rc-actions"><button class="approve-btn" id="approveBtn">Approve &amp; open PR</button><button class="discard-btn" id="discardBtn">Discard</button></div>`;
  $('#approveBtn').addEventListener('click', () => decide('approve'));
  $('#discardBtn').addEventListener('click', () => decide('reject'));
  loadHealth();
}

async function decide(action) {
  const a = $('#approveBtn'); const d = $('#discardBtn');
  if (a) a.disabled = true;
  if (d) d.disabled = true;
  setBanner('running', action === 'approve' ? 'Opening PR…' : 'Discarding…');
  try {
    await fetch(`./api/jobs/${currentJobId}/${action}`, { method: 'POST' });
    // pr-opened/done (approve) or failed (reject) will arrive on the open SSE stream
  } catch (e) {
    setBanner('failed', 'Action failed');
  }
}

function hideReview() { const rc = $('#reviewControls'); rc.classList.add('hidden'); rc.innerHTML = ''; }

function onDone(ev) {
  STAGES.forEach((s) => setStatus(nodes[s.key], 'done'));
  const ms = ev.data && ev.data.summary && ev.data.summary.durationMs ? ` · ${ev.data.summary.durationMs}ms` : '';
  setBanner('succeeded', 'AutoFix complete' + ms);
  hideReview(); closeStream(); setRunning(false); loadHistory(); loadHealth();
}

function onFailed(ev) {
  const pending = STAGES.map((s) => nodes[s.key]).find((n) => !n.classList.contains('done'));
  setStatus(pending, 'error');
  const detail = detailEl(pending);
  const v = ev.data && ev.data.violations;
  const box = el('div', 'fail-box');
  if (v && v.length) box.innerHTML = '<b>Patch rejected by policy</b><ul>' + v.map((x) => `<li>${esc(x)}</li>`).join('') + '</ul>';
  else box.innerHTML = esc(ev.message);
  detail.append(box);
  setBanner('failed', (ev.data && ev.data.discarded) ? 'Discarded' : 'AutoFix aborted');
  hideReview(); closeStream(); setRunning(false); loadHistory(); loadHealth();
}

// ── Diff highlighter ─────────────────────────────────────────────────
function highlightDiff(diff) {
  return String(diff).split('\n').map((line) => {
    let cls = '';
    if (/^diff --git|^index |^new file|^deleted file/.test(line)) cls = 'meta';
    else if (/^@@/.test(line)) cls = 'hunk';
    else if (/^\+\+\+|^---/.test(line)) cls = 'meta';
    else if (/^\+/.test(line)) cls = 'add';
    else if (/^-/.test(line)) cls = 'del';
    return `<span class="dl ${cls}">${esc(line) || '&nbsp;'}</span>`;
  }).join('');
}

// ── Tiny markdown (for the simulated PR body) ────────────────────────
function mdToHtml(md) {
  const lines = String(md).split('\n');
  let html = '';
  let i = 0;
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const isDiff = /^```diff/.test(line);
      i++;
      const buf = [];
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      html += isDiff ? `<pre class="diff">${highlightDiff(buf.join('\n'))}</pre>` : `<pre class="diff">${esc(buf.join('\n'))}</pre>`;
      continue;
    }
    if (/^\|.*\|/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\|.*\|/.test(lines[i])) rows.push(lines[i++]);
      html += renderTable(rows, inline);
      continue;
    }
    if (/^###\s+/.test(line)) { html += `<h5>${inline(line.replace(/^###\s+/, ''))}</h5>`; i++; continue; }
    if (/^##\s+/.test(line)) { html += `<h4>${inline(line.replace(/^##\s+/, ''))}</h4>`; i++; continue; }
    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) items.push(lines[i++].replace(/^[-*]\s+/, ''));
      html += '<ul>' + items.map((x) => `<li>${inline(x)}</li>`).join('') + '</ul>';
      continue;
    }
    if (line.trim() === '') { i++; continue; }
    html += `<p>${inline(line)}</p>`;
    i++;
  }
  return html;
}

function renderTable(rows, inline) {
  const cells = (r) => r.split('|').slice(1, -1).map((c) => c.trim());
  const isSep = (r) => cells(r).every((c) => /^:?-+:?$/.test(c));
  let head = '';
  let bodyRows = rows;
  if (rows.length >= 2 && isSep(rows[1])) {
    head = '<tr>' + cells(rows[0]).map((c) => `<th>${inline(c)}</th>`).join('') + '</tr>';
    bodyRows = rows.slice(2);
  }
  const body = bodyRows.filter((r) => !isSep(r)).map((r) => '<tr>' + cells(r).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('');
  return `<table>${head}${body}</table>`;
}

init();
