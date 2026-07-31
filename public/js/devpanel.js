'use strict';
// ── Dev debug panel ────────────────────────────────────────────────────────────
// Small "DEV" button in the bottom-right corner, only rendered when the server
// was started with -developer (checked via /api/dev/status). Opens a drawer
// listing every aiChat() call (system/user prompt, response, timing, caller) —
// logged server-side once in ai.js, not by any individual feature.
import { api } from './api.js';

const MAX_CLIENT_ENTRIES = 200;
const POLL_MS = 2000;

let enabled  = false;
let open     = false;
let lastId   = 0;
let entries  = [];
let elBtn, elBadge, elDrawer, elList;

function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('ru-RU', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function escapeHtml(s) {
  return (s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderBadge() {
  elBadge.textContent = entries.length > 99 ? '99+' : String(entries.length);
}

const ROLE_LABEL = { system: 'SYSTEM', user: 'USER', assistant: 'ASSISTANT', tool: 'TOOL RESULT' };

// One message → its label + displayed body. Assistant turns that only carry a
// tool_calls request (no content, e.g. mid tool-calling round-trip) show the call
// itself instead of rendering as a blank pre block.
function messageBody(m) {
  if (m.content) return m.content;
  if (m.tool_calls?.length) {
    return m.tool_calls.map(tc => `→ ${tc.function?.name ?? '?'}(${tc.function?.arguments ?? ''})`).join('\n');
  }
  return '(empty)';
}

function messagesHtml(messages) {
  return (messages ?? []).map(m => `
        <div class="devp-row-label devp-row-label-${escapeHtml(m.role)}">${ROLE_LABEL[m.role] ?? m.role.toUpperCase()}</div>
        <pre>${escapeHtml(messageBody(m))}</pre>`
  ).join('');
}

function rowHtml(e) {
  const out = e.ok === false ? `ERROR: ${e.error}` : (e.response ?? '');

  // Native tool calling (aiChatTools, see server/engine/ai.js/tools.js) — show
  // whether a tool was actually invoked this call, not just that tools were offered.
  let toolsBadge = '';
  if (e.tools) {
    const called = e.toolsCalled?.length;
    toolsBadge = called
      ? `<span class="devp-row-json devp-row-tools-called" title="${escapeHtml(e.toolsCalled.join(', '))}">TOOLS→${escapeHtml(e.toolsCalled.join(', '))}</span>`
      : `<span class="devp-row-json devp-row-tools-none" title="Offered: ${escapeHtml((e.toolsOffered ?? []).join(', '))}">TOOLS (not called)</span>`;
  }

  return `
    <div class="devp-row ${e.ok === false ? 'devp-row-err' : ''}" data-id="${e.id}">
      <div class="devp-row-head">
        <span class="devp-row-time">${fmtTime(e.ts)}</span>
        <span class="devp-row-ms">${e.ms}ms</span>
        <span class="devp-row-model">${escapeHtml(e.provider)}/${escapeHtml(e.model ?? '?')}</span>
        ${e.jsonMode ? '<span class="devp-row-json">JSON</span>' : ''}
        ${toolsBadge}
        <span class="devp-row-caller">${escapeHtml(e.caller ?? '')}</span>
      </div>
      <div class="devp-row-body hidden">
        ${messagesHtml(e.messages)}
        <div class="devp-row-label devp-row-label-response">${e.ok === false ? 'ERROR' : 'RESPONSE'}</div>
        <pre>${escapeHtml(out)}</pre>
      </div>
    </div>`;
}

function renderList() {
  elList.innerHTML = entries.slice().reverse().map(rowHtml).join('');
}

function toggleDrawer() {
  open = !open;
  elDrawer.classList.toggle('devp-drawer-open', open);
  if (open) renderList();
}

async function poll() {
  try {
    const data = await api('GET', `/api/dev/log?since=${lastId}`);
    if (data.entries?.length) {
      entries.push(...data.entries);
      lastId = entries[entries.length - 1].id;
      if (entries.length > MAX_CLIENT_ENTRIES) entries.splice(0, entries.length - MAX_CLIENT_ENTRIES);
      renderBadge();
      if (open) renderList();
    }
  } catch { /* dev endpoint unreachable — ignore */ }
}

function buildDom() {
  elBtn = document.createElement('button');
  elBtn.id = 'devp-btn';
  elBtn.type = 'button';
  elBtn.innerHTML = 'DEV <span id="devp-badge" class="devp-badge">0</span>';
  elBadge = elBtn.querySelector('#devp-badge');

  elDrawer = document.createElement('div');
  elDrawer.id = 'devp-drawer';
  elDrawer.innerHTML = `
    <div id="devp-drawer-head">
      <span>AI лог</span>
      <button id="devp-clear" type="button">Очистить</button>
      <button id="devp-close" type="button">×</button>
    </div>
    <div id="devp-list"></div>`;
  elList = elDrawer.querySelector('#devp-list');

  document.body.appendChild(elBtn);
  document.body.appendChild(elDrawer);

  elBtn.addEventListener('click', toggleDrawer);
  elDrawer.querySelector('#devp-close').addEventListener('click', toggleDrawer);
  elDrawer.querySelector('#devp-clear').addEventListener('click', async () => {
    await api('POST', '/api/dev/log/clear');
    entries = []; lastId = 0;
    renderBadge(); renderList();
  });
  elList.addEventListener('click', ev => {
    ev.target.closest('.devp-row')?.querySelector('.devp-row-body')?.classList.toggle('hidden');
  });
}

export async function initDevPanel() {
  try {
    const status = await api('GET', '/api/dev/status');
    enabled = !!status.enabled;
  } catch { enabled = false; }
  if (!enabled) return;

  buildDom();
  poll();
  setInterval(poll, POLL_MS);
}
