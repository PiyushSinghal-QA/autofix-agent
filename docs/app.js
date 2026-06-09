/*
 * AutoFix — Live Status (read-only).
 * Pulls everything from the public GitHub REST API, client-side. No backend,
 * no token: this is a static page on GitHub Pages that reflects the real repo.
 */
const OWNER = 'PiyushSinghal-QA';
const REPO = 'checkout-service';
const WORKFLOW = 'autofix.yml';
const API = 'https://api.github.com';
const REFRESH_MS = 5 * 60 * 1000; // gentle auto-refresh (unauthenticated API = 60 req/hr/IP)

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function gh(path) {
  const res = await fetch(`${API}${path}`, { headers: { Accept: 'application/vnd.github+json' } });
  if (res.status === 403 && res.headers.get('X-RateLimit-Remaining') === '0') {
    const reset = Number(res.headers.get('X-RateLimit-Reset')) * 1000;
    throw new Error(`GitHub API rate limit reached (unauthenticated, 60/hr). Try again around ${new Date(reset).toLocaleTimeString()}.`);
  }
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${path}`);
  return res.json();
}

function relTime(iso) {
  if (!iso) return '';
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

/** Decode a GitHub Contents API base64 blob. */
function decodeContent(payload) {
  const b64 = (payload.content || '').replace(/\n/g, '');
  return decodeURIComponent(escape(atob(b64)));
}

async function fetchRegistry() {
  try {
    const payload = await gh(`/repos/${OWNER}/${REPO}/contents/bugs/registry.json`);
    return JSON.parse(decodeContent(payload)).bugs || [];
  } catch {
    return []; // catalogue is best-effort; the live activity below is the point
  }
}
const fetchPRs = () => gh(`/repos/${OWNER}/${REPO}/pulls?state=all&per_page=50&sort=created&direction=desc`);
const fetchRuns = () => gh(`/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=10`);

/** Classify a bug's fix status from the PRs that target its branch. */
function fixStatus(bug, prs) {
  // Fixes branch off main now, so identify a bug's PRs by their fix/<id>- head.
  const mine = prs.filter((p) => (p.head?.ref || '').startsWith(`fix/${bug.id}-`));
  if (mine.some((p) => p.merged_at)) {
    const pr = mine.find((p) => p.merged_at);
    return { cls: 'merged', label: `Fix merged · #${pr.number}`, url: pr.html_url };
  }
  const open = mine.find((p) => p.state === 'open');
  if (open) return { cls: 'open', label: `PR #${open.number} open`, url: open.html_url };
  if (mine.length) return { cls: 'closed', label: `Fix closed · #${mine[0].number}`, url: mine[0].html_url };
  return { cls: 'none', label: 'Awaiting fix', url: null };
}

function renderBugs(bugs, prs) {
  $('bugCount').textContent = bugs.length ? `${bugs.length} seeded` : '';
  if (!bugs.length) {
    $('bugList').innerHTML = '<div class="muted">Defect catalogue unavailable (could not read bugs/registry.json).</div>';
    return;
  }
  const order = { high: 0, medium: 1, low: 2 };
  bugs.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));
  $('bugList').innerHTML = bugs
    .map((b) => {
      const fx = fixStatus(b, prs);
      const pill = fx.url
        ? `<a class="fix ${fx.cls}" href="${esc(fx.url)}" target="_blank" rel="noopener">${esc(fx.label)}</a>`
        : `<span class="fix ${fx.cls}">${esc(fx.label)}</span>`;
      return `
      <div class="bug">
        <div class="bug-top">
          <span class="sev ${esc(b.severity)}">${esc(b.severity)}</span>
          <span class="bug-title">${esc(b.title)}</span>
          ${pill}
        </div>
        <div class="bug-desc">${esc(b.description)}</div>
        <div class="bug-meta">
          <span class="tag">${esc(b.category)}</span>
          <span class="tag">file <b>${esc((b.files && b.files[0]) || '—')}</b></span>
          <span class="tag">test <b>${esc(b.failingTest)}</b></span>
        </div>
      </div>`;
    })
    .join('');
  return bugs;
}

function renderPRs(prs) {
  const fixes = prs.filter((p) => (p.head?.ref || '').startsWith('fix/'));
  $('prCount').textContent = fixes.length ? `${fixes.length} total` : '';
  $('prList').innerHTML = fixes.length
    ? fixes
        .slice(0, 12)
        .map((p) => {
          const state = p.merged_at ? 'merged' : p.state; // open | closed | merged
          return `
        <a class="row" href="${esc(p.html_url)}" target="_blank" rel="noopener">
          <span class="state ${state}">${state}</span>
          <div class="main">
            <div class="ttl">#${p.number} · ${esc(p.title)}</div>
            <div class="sub">${esc(p.head.ref)} → ${esc(p.base.ref)} · by ${esc(p.user?.login || 'unknown')}</div>
          </div>
          <span class="when">${relTime(p.created_at)}</span>
        </a>`;
        })
        .join('')
    : '<div class="muted">No fix pull requests yet — dispatch the AutoFix workflow to open one.</div>';
  return fixes;
}

function runDot(r) {
  if (r.status !== 'completed') return 'run';
  return r.conclusion === 'success' ? 'ok' : 'bad';
}
function renderRuns(runs) {
  $('runList').innerHTML = runs.length
    ? runs
        .map((r) => {
          const label = r.status === 'completed' ? r.conclusion : r.status.replace('_', ' ');
          return `
        <a class="row" href="${esc(r.html_url)}" target="_blank" rel="noopener">
          <span class="dot ${runDot(r)}"></span>
          <div class="main">
            <div class="ttl">${esc(r.display_title || r.name)} · run #${r.run_number}</div>
            <div class="sub">${esc(label)} · ${esc(r.event)} on ${esc(r.head_branch)}</div>
          </div>
          <span class="when">${relTime(r.created_at)}</span>
        </a>`;
        })
        .join('')
    : '<div class="muted">No AutoFix runs recorded yet.</div>';
  return runs;
}

function renderSummary(bugs, fixes, runs) {
  $('sBugs').textContent = bugs.length || '0';
  $('sOpen').textContent = fixes.filter((p) => p.state === 'open' && !p.merged_at).length;
  $('sMerged').textContent = fixes.filter((p) => p.merged_at).length;
  const last = runs[0];
  if (!last) {
    $('sRun').innerHTML = '<span class="run">none</span>';
    $('sRun').classList.add('sm');
  } else if (last.status !== 'completed') {
    $('sRun').innerHTML = '<span class="run">running</span>';
    $('sRun').classList.add('sm');
  } else {
    const ok = last.conclusion === 'success';
    $('sRun').innerHTML = `<span class="${ok ? 'ok' : 'bad'}">${ok ? 'passed' : 'failed'}</span>`;
    $('sRun').classList.add('sm');
  }
}

let loading = false;
async function loadAll() {
  if (loading) return;
  loading = true;
  $('refreshBtn').disabled = true;
  $('banner').classList.add('hidden');
  try {
    const [bugs, prs, runsRes] = await Promise.all([fetchRegistry(), fetchPRs(), fetchRuns()]);
    const runs = runsRes.workflow_runs || [];
    renderBugs(bugs, prs);
    const fixes = renderPRs(prs);
    renderRuns(runs);
    renderSummary(bugs, fixes, runs);
    $('updated').textContent = `updated ${new Date().toLocaleTimeString()}`;
  } catch (e) {
    const b = $('banner');
    b.textContent = e.message || 'Failed to load data from GitHub.';
    b.classList.remove('hidden');
  } finally {
    loading = false;
    $('refreshBtn').disabled = false;
  }
}

$('refreshBtn').addEventListener('click', loadAll);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') loadAll();
});
setInterval(() => {
  if (document.visibilityState === 'visible') loadAll();
}, REFRESH_MS);
loadAll();
