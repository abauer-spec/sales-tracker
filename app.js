'use strict';

/* ── CONFIG ──────────────────────────────────────────────────────
   Change API_BASE to your deployed Worker URL.
   For local dev: 'http://localhost:8787'
───────────────────────────────────────────────────────────────── */
// const API_BASE = 'http://localhost:8787'; // ← REPLACE WITH YOUR WORKER URL
const API_BASE = 'https://sales-tracker.bauer-spec.workers.dev';

/* ── STATE ───────────────────────────────────────────────────── */
let dashData     = null;
let allAgents    = [];
let sortField    = 'today';
let goalValue    = parseInt(localStorage.getItem('salesGoal') || '0', 10);
let seenTxIds    = new Set(JSON.parse(localStorage.getItem('seenTxIds') || '[]'));
let pollingTimer = null;

/* ── CLOCK ───────────────────────────────────────────────────── */
function startClock() {
  // topbar clock (dashboard)
  const timeEl = document.getElementById('clock-time');
  const dateEl = document.getElementById('clock-date');
  // sidebar clock (admin)
  const sTimeEl = document.getElementById('s-clock-time');
  const sDateEl = document.getElementById('s-clock-date');

  function tick() {
    const now = new Date();
    const t = now.toLocaleTimeString('ru-RU');
    const d = now.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });
    if (timeEl)  timeEl.textContent = t;
    if (dateEl)  dateEl.textContent = d;
    if (sTimeEl) sTimeEl.textContent = t;
    if (sDateEl) sDateEl.textContent = d;
  }
  tick();
  setInterval(tick, 1000);
}

/* ── API HELPERS ─────────────────────────────────────────────── */
async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(API_BASE + path, opts);
  if (!r.ok) throw new Error((await r.json()).error || r.statusText);
  return r.json();
}

/* ── FORMAT ──────────────────────────────────────────────────── */
const fmt = n => n.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽';

/* ── DASHBOARD ───────────────────────────────────────────────── */
async function loadDashboard(silent = false) {
  try {
    const data = await api('/api/dashboard');
    const isFirstLoad = dashData === null;
    dashData = data;

    const todayEl = document.getElementById('stat-today');
    const monthEl = document.getElementById('stat-month');
    const badgeEl = document.getElementById('dash-date-badge');
    if (todayEl) todayEl.textContent = fmt(data.today || 0);
    if (monthEl) monthEl.textContent = fmt(data.month || 0);
    if (badgeEl) badgeEl.textContent = data.serverTime || '';

    const monsterEl     = document.getElementById('stat-monster');
    const monsterNameEl = document.getElementById('stat-monster-name');
    if (monsterEl && monsterNameEl) {
      if (data.monster) {
        monsterEl.textContent     = fmt(data.monster.today);
        monsterNameEl.textContent = data.monster.name;
      } else {
        monsterEl.textContent     = '—';
        monsterNameEl.textContent = 'нет данных';
      }
    }

    const hasToday = data.agents.some(a => a.today > 0);
    sortField = hasToday ? 'today' : 'month';
    renderTable(data.agents);
    updateSortUI();
    updateGoal(data.today || 0);
    checkNewTransactions(data.lastTransactions || [], isFirstLoad);
  } catch (e) {
    if (!silent) toast('Ошибка загрузки данных', 'error');
  }
}

function renderTable(agents) {
  const tbody = document.getElementById('agents-tbody');
  if (!tbody) return;
  const sorted = [...agents].sort((a, b) => b[sortField] - a[sortField]);
  const monsterId = dashData?.monster?.id;
  if (!sorted.length) {
    tbody.innerHTML = '<tr class="loading-row"><td colspan="3">Нет агентов</td></tr>';
    return;
  }
  tbody.innerHTML = sorted.map(a => {
    const isMonster   = a.id === monsterId && a.today > 0;
    const todayClass  = a.today > 0 ? 'amount-today' : 'amount-zero';
    const monthClass  = a.month > 0 ? 'amount-month' : 'amount-zero';
    return `<tr class="${isMonster ? 'monster-row' : ''}" data-id="${a.id}">
      <td class="agent-name">
        ${escHtml(a.name)}
        ${isMonster ? '<span class="monster-badge">🔥 Monster</span>' : ''}
      </td>
      <td class="${todayClass}">${a.today > 0 ? fmt(a.today) : '—'}</td>
      <td class="${monthClass}">${a.month > 0 ? fmt(a.month) : '—'}</td>
    </tr>`;
  }).join('');
}

function toggleSort(field) {
  sortField = field;
  if (dashData) renderTable(dashData.agents);
  updateSortUI();
}
function updateSortUI() {
  const thToday = document.getElementById('th-today');
  const thMonth = document.getElementById('th-month');
  const hint    = document.getElementById('sort-hint');
  if (thToday) thToday.classList.toggle('sorted', sortField === 'today');
  if (thMonth) thMonth.classList.toggle('sorted', sortField === 'month');
  if (hint)    hint.textContent = sortField === 'today' ? 'Сортировка: сегодня ↓' : 'Сортировка: месяц ↓';
}

/* ── GOAL ────────────────────────────────────────────────────── */
function setGoal() {
  const input = document.getElementById('goal-input');
  const v = parseInt(input?.value, 10);
  if (!v || v < 0) return toast('Введите корректную цель', 'error');
  goalValue = v;
  localStorage.setItem('salesGoal', v);
  if (input) input.value = '';
  updateGoal(dashData?.today || 0);
  showCurrentGoalInAdmin();
  toast('Цель обновлена: ' + fmt(v), 'success');
}

function showCurrentGoalInAdmin() {
  const el = document.getElementById('goal-current-display');
  if (!el) return;
  el.textContent = goalValue ? 'Текущая цель: ' + fmt(goalValue) : 'Цель не задана';
}

function updateGoal(collected) {
  const target  = goalValue;
  const targetEl = document.getElementById('goal-target');
  const leftEl   = document.getElementById('goal-left');
  const bar      = document.getElementById('goal-bar');
  if (targetEl) targetEl.textContent = target ? fmt(target) : 'не задана';
  const left = Math.max(0, target - collected);
  if (leftEl) {
    leftEl.textContent  = target ? (left === 0 ? '✓ Цель выполнена!' : fmt(left)) : '—';
    leftEl.style.color  = left === 0 && target ? 'var(--green)' : target ? 'var(--accent2)' : 'var(--text3)';
  }
  const pct = target ? Math.min(100, (collected / target) * 100) : 0;
  if (bar) {
    bar.style.width = pct + '%';
    bar.className   = 'progress-fill' + (pct >= 100 ? ' over' : '');
  }
}

/* ── POLLING & CELEBRATION ───────────────────────────────────── */
function checkNewTransactions(txList, isFirstLoad) {
  if (isFirstLoad) {
    txList.forEach(tx => seenTxIds.add(tx.id));
    saveSeen();
    return;
  }
  const newOnes = txList.filter(tx => !seenTxIds.has(tx.id));
  if (newOnes.length > 0) {
    const latest = newOnes[0];
    newOnes.forEach(tx => seenTxIds.add(tx.id));
    saveSeen();
    triggerCelebration(latest);
  }
}
function saveSeen() {
  const arr = [...seenTxIds].slice(-200);
  seenTxIds = new Set(arr);
  localStorage.setItem('seenTxIds', JSON.stringify(arr));
}
function startPolling() {
  pollingTimer = setInterval(() => loadDashboard(true), 4000);
}

/* ── CELEBRATION ─────────────────────────────────────────────── */
function triggerCelebration(tx) {
  const isMonster = dashData?.monster?.id === tx.agent_id && tx.today > 0;
  const overlay   = document.getElementById('cel-overlay');
  const popup     = document.getElementById('cel-popup');
  if (!overlay || !popup) return;

  document.getElementById('cel-agent').textContent  = tx.agent_name;
  document.getElementById('cel-amount').textContent = fmt(tx.amount);
  document.getElementById('cel-emoji').textContent  = isMonster ? '👑' : '🎉';

  const monLabel = document.getElementById('cel-monster-label');
  if (isMonster) {
    monLabel.style.display = 'block';
    popup.classList.add('monster');
    spawnParticles(popup);
  } else {
    monLabel.style.display = 'none';
    popup.classList.remove('monster');
    popup.querySelectorAll('.particle').forEach(p => p.remove());
  }

  overlay.classList.add('show');
  fireConfetti(isMonster);
  playSound(isMonster);
}

function closePopup(e, force = false) {
  if (!force && e && e.target !== document.getElementById('cel-overlay')) return;
  document.getElementById('cel-overlay').classList.remove('show');
}

function fireConfetti(isMonster) {
  const colors = isMonster
    ? ['#f59e0b', '#fcd34d', '#fef08a', '#ffffff', '#f97316']
    : ['#3b82f6', '#22d3a0', '#a855f7', '#f43f5e', '#60a5fa'];
  confetti({ particleCount: 120, spread: 80, origin: { y: 0.55 }, colors, scalar: 1.1 });
  setTimeout(() => confetti({ particleCount: 60, spread: 100, origin: { y: 0.45 }, colors, angle: 60  }), 300);
  setTimeout(() => confetti({ particleCount: 60, spread: 100, origin: { y: 0.45 }, colors, angle: 120 }), 500);
}

/* ── SOUND ───────────────────────────────────────────────────── */
function playSound(isMonster) {
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);

    const bufLen = ctx.sampleRate * 1.2;
    const buf    = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data   = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) {
      const t   = i / ctx.sampleRate;
      const env = Math.sin(Math.PI * t / 1.2) * (1 - t / 1.5);
      data[i]   = (Math.random() * 2 - 1) * env * .7;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = isMonster ? 2200 : 1600;
    bp.Q.value = .6;
    src.connect(bp);
    bp.connect(gain);
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(.8, ctx.currentTime + .08);
    gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + 1.1);

    if (isMonster) {
      ['C5','E5','G5','C6'].forEach((note, i) => {
        const osc = ctx.createOscillator();
        const g2  = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = noteToHz(note);
        osc.connect(g2); g2.connect(ctx.destination);
        g2.gain.setValueAtTime(0, ctx.currentTime + i * .06);
        g2.gain.linearRampToValueAtTime(.18, ctx.currentTime + i * .06 + .04);
        g2.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + i * .06 + .8);
        osc.start(ctx.currentTime + i * .06);
        osc.stop(ctx.currentTime + i * .06 + .9);
      });
    } else {
      const osc = ctx.createOscillator();
      const g2  = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      osc.connect(g2); g2.connect(ctx.destination);
      g2.gain.setValueAtTime(0, ctx.currentTime);
      g2.gain.linearRampToValueAtTime(.22, ctx.currentTime + .03);
      g2.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + .5);
      osc.start(); osc.stop(ctx.currentTime + .55);
    }

    src.start(); src.stop(ctx.currentTime + 1.2);
    setTimeout(() => ctx.close(), 1500);
  } catch(e) { /* AudioContext blocked */ }
}

function noteToHz(note) {
  return { C4:261.63,E4:329.63,G4:392,C5:523.25,E5:659.25,G5:783.99,C6:1046.5 }[note] || 440;
}

/* ── GOLDEN PARTICLES ────────────────────────────────────────── */
function spawnParticles(popup) {
  popup.querySelectorAll('.particle').forEach(p => p.remove());
  for (let i = 0; i < 12; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const size = 4 + Math.random() * 6;
    p.style.cssText = `
      width:${size}px; height:${size}px;
      background: rgba(245,${158 + Math.random()*60|0},11,${.6+Math.random()*.4});
      left: ${10 + Math.random() * 80}%;
      bottom: ${Math.random() * 30}%;
      animation-duration: ${1.2 + Math.random() * 1.5}s;
      animation-delay: ${Math.random() * .8}s;
    `;
    popup.appendChild(p);
  }
}

/* ── ADMIN DATA ──────────────────────────────────────────────── */
async function loadAdminData() {
  await loadAgents();
  await loadAdminTx();
  showCurrentGoalInAdmin();
}

async function loadAgents() {
  try {
    allAgents = await api('/api/agents');
    renderAgentsList();
    renderAgentSelect();
  } catch(e) { toast('Ошибка загрузки агентов', 'error'); }
}

function renderAgentsList() {
  const el = document.getElementById('agents-admin-list');
  if (!el) return;
  if (!allAgents.length) { el.innerHTML = '<p style="color:var(--text3);font-size:.85rem">Нет агентов</p>'; return; }
  el.innerHTML = allAgents.map(a => `
    <div class="agent-chip">
      <span>${escHtml(a.name)}</span>
      <button class="btn btn-danger btn-sm" onclick="deleteAgent(${a.id}, '${escAttr(a.name)}')">✕</button>
    </div>
  `).join('');
}

function renderAgentSelect() {
  const sel = document.getElementById('sale-agent');
  if (!sel) return;
  sel.innerHTML = '<option value="">Выберите агента...</option>' +
    allAgents.map(a => `<option value="${a.id}">${escHtml(a.name)}</option>`).join('');
}

async function loadAdminTx() {
  try {
    const txs = await api('/api/transactions/all');
    renderAdminTx(txs);
  } catch(e) {}
}

function renderAdminTx(txs) {
  const el = document.getElementById('admin-tx-list');
  if (!el) return;
  if (!txs.length) { el.innerHTML = '<p style="color:var(--text3);font-size:.85rem">Нет транзакций</p>'; return; }
  el.innerHTML = txs.slice(0, 20).map(tx => `
    <div class="tx-item">
      <div class="tx-info">
        <div class="tx-agent">${escHtml(tx.agent_name)} · <span class="mono" style="font-size:.8rem;color:var(--text3)">#${tx.id}</span></div>
        <div class="tx-date">${tx.date}</div>
      </div>
      <div class="tx-amount">${fmt(tx.amount)}</div>
      <div class="tx-actions">
        <button class="btn btn-ghost btn-sm" onclick="openEditTx(${tx.id},${tx.amount},'${tx.date}')">✏</button>
        <button class="btn btn-danger btn-sm" onclick="deleteTx(${tx.id})">✕</button>
      </div>
    </div>
  `).join('');
}

async function loadAllTx() {
  try {
    const txs = await api('/api/transactions/all');
    renderAdminTx(txs);
  } catch(e) {}
}

/* ── CRUD ────────────────────────────────────────────────────── */
async function createAgent() {
  const name = document.getElementById('new-agent-name').value.trim();
  if (!name) return toast('Введите ФИО агента', 'error');
  try {
    await api('/api/agents', 'POST', { name });
    document.getElementById('new-agent-name').value = '';
    toast('Агент добавлен!', 'success');
    await loadAgents();
  } catch(e) { toast(e.message, 'error'); }
}

async function deleteAgent(id, name) {
  if (!confirm(`Удалить агента "${name}" и все его транзакции?`)) return;
  try {
    await api('/api/agents/' + id, 'DELETE');
    toast('Агент удалён', 'success');
    await loadAgents();
    await loadDashboard();
  } catch(e) { toast(e.message, 'error'); }
}

async function createSale() {
  const agent_id = document.getElementById('sale-agent').value;
  const amount   = parseFloat(document.getElementById('sale-amount').value);
  const date     = document.getElementById('sale-date').value || todayStr();
  if (!agent_id) return toast('Выберите агента', 'error');
  if (!amount || amount <= 0) return toast('Введите сумму', 'error');
  try {
    const tx = await api('/api/transactions', 'POST', { agent_id: +agent_id, amount, date });
    document.getElementById('sale-amount').value = '';
    toast('Продажа добавлена!', 'success');
    seenTxIds.add(tx.id);
    saveSeen();
    await loadDashboard();
    const agent = allAgents.find(a => a.id === +agent_id);
    triggerCelebration({ ...tx, agent_name: agent?.name || 'Агент' });
    await loadAdminTx();
  } catch(e) { toast(e.message, 'error'); }
}

async function deleteTx(id) {
  if (!confirm('Удалить транзакцию #' + id + '?')) return;
  try {
    await api('/api/transactions/' + id, 'DELETE');
    toast('Транзакция удалена', 'success');
    seenTxIds.add(id);
    await loadDashboard();
    await loadAdminTx();
  } catch(e) { toast(e.message, 'error'); }
}

function openEditTx(id, amount, date) {
  document.getElementById('edit-tx-id').value  = id;
  document.getElementById('edit-amount').value = amount;
  document.getElementById('edit-date').value   = date;
  document.getElementById('edit-modal').classList.add('show');
}
function closeModal() {
  document.getElementById('edit-modal').classList.remove('show');
}
async function saveEditTx() {
  const id     = document.getElementById('edit-tx-id').value;
  const amount = parseFloat(document.getElementById('edit-amount').value);
  const date   = document.getElementById('edit-date').value;
  if (!amount || amount <= 0) return toast('Введите сумму', 'error');
  try {
    await api('/api/transactions/' + id, 'PUT', { amount, date });
    closeModal();
    toast('Транзакция обновлена!', 'success');
    await loadDashboard();
    await loadAdminTx();
  } catch(e) { toast(e.message, 'error'); }
}

/* ── RESET ───────────────────────────────────────────────────── */
async function confirmReset(type) {
  const label = type === 'today' ? 'сегодняшние продажи' : 'продажи за месяц';
  if (!confirm(`Вы уверены, что хотите сбросить ${label}? Это действие необратимо!`)) return;
  try {
    await api('/api/reset/' + type, 'POST');
    toast('Данные сброшены', 'success');
    await loadDashboard();
    await loadAdminTx();
  } catch(e) { toast(e.message, 'error'); }
}

/* ── TOAST ───────────────────────────────────────────────────── */
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${type==='success'?'✓':type==='error'?'✕':'ℹ'}</span><span>${escHtml(msg)}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toast-out .3s ease forwards';
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

/* ── UTILS ───────────────────────────────────────────────────── */
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escAttr(s) { return String(s).replace(/'/g, "\\'"); }
function todayStr()  { return new Date().toISOString().slice(0, 10); }

/* ── PAGE DETECT & INIT ──────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  startClock();

  const isAdmin = document.body.dataset.page === 'admin';

  if (isAdmin) {
    // Admin page: load date default + admin data
    const saleDateEl = document.getElementById('sale-date');
    if (saleDateEl) saleDateEl.value = todayStr();
    await loadDashboard(true); // need dashData for monster detection
    await loadAdminData();
  } else {
    // Dashboard page: just load data and start polling
    await loadDashboard();
    startPolling();
  }
});
