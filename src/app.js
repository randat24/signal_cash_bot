import {
  STATUSES, DIRECTIONS, normalizeSignal, validateSignal, computeMetrics, computeStats,
  toCSV, parseCSV, mergeSignals, newId, localNow,
} from './core.js';
import { loadFromSheet, saveToSheet } from './sheets.js';

const KEYS = { signals: 'signalcash.signals', settings: 'signalcash.settings', theme: 'signalcash.theme' };
const MARKETS = { crypto: 'Крипта', stocks: 'Акции', forex: 'Форекс', futures: 'Фьючерсы', other: 'Другое' };

const $ = (sel, root = document) => root.querySelector(sel);

// ---------- хранилище ----------

function readStore(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    toast('Не удалось сохранить в браузере — экспортируйте данные в CSV', true);
  }
}

const state = {
  signals: readStore(KEYS.signals, []).map(normalizeSignal),
  settings: { url: '', token: '', autoSync: false, ...readStore(KEYS.settings, {}) },
  sort: { key: 'date', dir: 'desc' },
  filters: { search: '', status: '', direction: '' },
};

// ---------- форматирование ----------

const nf = (opts) => new Intl.NumberFormat('ru-RU', opts);
const priceFmt = nf({ maximumFractionDigits: 8 });
const fixed2 = nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtPrice = (v) => (v === null ? '—' : priceFmt.format(v));
const fmtSigned = (v, suffix = '') => (v === null ? '—' : `${v > 0 ? '+' : ''}${fixed2.format(v)}${suffix}`);
const fmtRR = (v) => (v === null ? '—' : `1 : ${fixed2.format(v)}`);
const tone = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');

function fmtDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value || '—';
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(message, isError = false) {
  const el = document.createElement('div');
  el.className = `toast${isError ? ' error' : ''}`;
  el.textContent = message;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), isError ? 6000 : 3000);
}

// ---------- рендер ----------

function renderStats() {
  const s = computeStats(state.signals);
  const pf = s.profitFactor === null ? '—' : s.profitFactor === Infinity ? '∞' : fixed2.format(s.profitFactor);
  const cards = [
    ['Сигналов', s.total, `открыто: ${s.open}`, ''],
    ['Win rate', s.winRate === null ? '—' : `${fixed2.format(s.winRate)}%`, `${s.wins} в плюс / ${s.losses} в минус`, ''],
    ['P&L', fmtSigned(s.pnlUsd, ' $'), `закрыто: ${s.closed}`, tone(s.pnlUsd)],
    ['Средний результат', fmtSigned(s.avgPnlPct, '%'), 'на закрытую сделку', tone(s.avgPnlPct)],
    ['Средний R', fmtSigned(s.avgR, 'R'), 'прибыль в долях риска', tone(s.avgR)],
    ['Profit factor', pf, 'прибыль / убыток', ''],
  ];
  $('#stats').innerHTML = cards.map(([label, value, hint, cls]) => `
    <div class="stat">
      <div class="label">${esc(label)}</div>
      <div class="value ${cls}">${esc(value)}</div>
      <div class="hint">${esc(hint)}</div>
    </div>`).join('');
}

function visibleSignals() {
  const { search, status, direction } = state.filters;
  const q = search.trim().toLowerCase();
  const rows = state.signals
    .filter((s) => (!status || s.status === status) && (!direction || s.direction === direction))
    .filter((s) => !q || `${s.ticker} ${s.source} ${s.note}`.toLowerCase().includes(q))
    .map((s) => ({ s, m: computeMetrics(s) }));

  const { key, dir } = state.sort;
  const val = ({ s, m }) => (key in m ? m[key] : s[key]);
  rows.sort((a, b) => {
    const va = val(a), vb = val(b);
    if (va === vb) return 0;
    if (va === null || va === '') return 1; // пустые всегда внизу
    if (vb === null || vb === '') return -1;
    const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'ru');
    return dir === 'asc' ? cmp : -cmp;
  });
  return rows;
}

function renderRows() {
  const rows = visibleSignals();
  $('#rows').innerHTML = rows.map(({ s, m }) => `
    <tr data-id="${esc(s.id)}">
      <td data-label="Дата">${esc(fmtDate(s.date))}</td>
      <td data-label="Тикер"><span class="ticker">${esc(s.ticker)}</span>
        <span class="sub">${esc([MARKETS[s.market] || s.market, s.source].filter(Boolean).join(' · '))}</span></td>
      <td data-label="Направление"><span class="tag ${s.direction}">${DIRECTIONS[s.direction]}</span></td>
      <td class="num" data-label="Вход">${fmtPrice(s.entry)}</td>
      <td class="num" data-label="SL / TP"><span class="neg">${fmtPrice(s.stopLoss)}</span> / <span class="pos">${fmtPrice(s.takeProfit)}</span></td>
      <td class="num" data-label="Выход">${fmtPrice(s.exitPrice)}</td>
      <td class="num" data-label="R:R">${fmtRR(m.riskReward)}</td>
      <td class="num ${tone(m.pnlPct)}" data-label="Результат">${fmtSigned(m.pnlPct, '%')}${m.r !== null ? `<span class="sub">${fmtSigned(m.r, 'R')}</span>` : ''}</td>
      <td class="num ${tone(m.pnlUsd)}" data-label="P&amp;L $">${fmtSigned(m.pnlUsd)}</td>
      <td data-label="Статус"><span class="tag s-${s.status}">${STATUSES[s.status]}</span></td>
      <td class="cell-actions"><div class="row-actions">
        <button class="icon-btn" type="button" data-action="edit" title="Редактировать" aria-label="Редактировать ${esc(s.ticker)}">✎</button>
        <button class="icon-btn" type="button" data-action="copy" title="Дублировать" aria-label="Дублировать ${esc(s.ticker)}">⧉</button>
        <button class="icon-btn" type="button" data-action="delete" title="Удалить" aria-label="Удалить ${esc(s.ticker)}">✕</button>
      </div></td>
    </tr>`).join('');

  const empty = $('#empty');
  empty.hidden = rows.length > 0;
  if (!rows.length && state.signals.length) {
    empty.innerHTML = '<p><strong>Ничего не найдено.</strong></p><p class="muted">Измените поиск или фильтры.</p>';
  } else if (!rows.length) {
    empty.innerHTML = `<p><strong>Сигналов пока нет.</strong></p>
      <p class="muted">Добавьте первый сигнал, импортируйте CSV или подключите Google Таблицу.</p>
      <button class="btn primary" type="button" data-action="new">+ Новый сигнал</button>`;
  }

  document.querySelectorAll('th[data-sort]').forEach((th) => {
    th.tabIndex = 0;
    if (th.dataset.sort === state.sort.key) th.setAttribute('aria-sort', state.sort.dir === 'asc' ? 'ascending' : 'descending');
    else th.removeAttribute('aria-sort');
  });

  $('#sources').innerHTML = [...new Set(state.signals.map((s) => s.source).filter(Boolean))]
    .map((src) => `<option value="${esc(src)}">`).join('');
}

function render() {
  renderStats();
  renderRows();
}

// ---------- изменения и синхронизация ----------

let syncTimer;

function commit(signals) {
  state.signals = signals;
  writeStore(KEYS.signals, signals);
  render();
  if (state.settings.url && state.settings.autoSync) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => push(true), 800);
  }
}

function setSyncState(text) {
  $('#sync-state').textContent = text;
}

async function push(silent = false) {
  if (!state.settings.url) return toast('Сначала укажите URL веб-приложения', true);
  setSyncState('Отправка в таблицу…');
  try {
    await saveToSheet(state.settings, state.signals);
    setSyncState(`Таблица обновлена в ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`);
    if (!silent) toast(`Отправлено сигналов: ${state.signals.length}`);
  } catch (e) {
    setSyncState('Ошибка синхронизации');
    toast(`Не удалось отправить: ${e.message}`, true);
  }
}

async function pull() {
  if (!state.settings.url) return toast('Сначала укажите URL веб-приложения', true);
  setSyncState('Загрузка из таблицы…');
  try {
    const incoming = await loadFromSheet(state.settings);
    state.signals = mergeSignals(state.signals, incoming);
    writeStore(KEYS.signals, state.signals);
    render();
    setSyncState(`Загружено из таблицы: ${incoming.length}`);
    toast(`Загружено сигналов: ${incoming.length}`);
  } catch (e) {
    setSyncState('Ошибка синхронизации');
    toast(`Не удалось загрузить: ${e.message}`, true);
  }
}

// ---------- форма сигнала ----------

const dlgSignal = $('#dlg-signal');
const form = $('#form-signal');

function formToSignal() {
  return normalizeSignal(Object.fromEntries(new FormData(form)));
}

function updatePreview() {
  const s = formToSignal();
  const m = computeMetrics(s);
  const parts = [];
  if (m.riskReward !== null) parts.push(`R:R <b>${fmtRR(m.riskReward)}</b>`);
  if (m.riskPct !== null) parts.push(`Риск <b>${fixed2.format(m.riskPct)}%</b>`);
  if (s.size !== null && m.riskPct !== null) parts.push(`Риск $ <b>${fixed2.format((s.size * m.riskPct) / 100)}</b>`);
  if (s.size !== null && s.takeProfit !== null && s.entry > 0) {
    parts.push(`Цель $ <b class="pos">${fixed2.format((s.size * Math.abs(s.takeProfit - s.entry)) / s.entry)}</b>`);
  }
  if (m.pnlPct !== null) parts.push(`Итог <b class="${tone(m.pnlPct)}">${fmtSigned(m.pnlPct, '%')}</b>`);
  $('#preview').innerHTML = parts.join('');
}

function openForm(signal = null, { copy = false } = {}) {
  form.reset();
  $('#form-errors').innerHTML = '';
  const s = signal ? { ...signal } : normalizeSignal({});
  if (copy) Object.assign(s, { id: newId(), status: 'open', exitPrice: null, date: localNow() });
  $('#dlg-signal-title').textContent = signal && !copy ? `Сигнал ${s.ticker}` : 'Новый сигнал';
  for (const el of form.elements) {
    if (!el.name) continue;
    const v = s[el.name];
    if (el.type === 'radio') el.checked = el.value === v;
    else el.value = v === null || v === undefined ? '' : String(v).slice(0, el.type === 'datetime-local' ? 16 : undefined);
  }
  if (!signal) form.elements.id.value = '';
  updatePreview();
  dlgSignal.showModal();
  form.elements.ticker.focus();
}

form.addEventListener('input', updatePreview);

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const s = formToSignal();
  const errors = validateSignal(s);
  $('#form-errors').innerHTML = errors.map((err) => `<li>${esc(err)}</li>`).join('');
  if (errors.length) return;
  const exists = state.signals.some((x) => x.id === s.id);
  commit(exists ? state.signals.map((x) => (x.id === s.id ? s : x)) : [s, ...state.signals]);
  dlgSignal.close();
  toast(exists ? 'Сигнал обновлён' : 'Сигнал добавлен');
});

// ---------- Google Таблица ----------

const dlgSheets = $('#dlg-sheets');
const formSheets = $('#form-sheets');

function readSheetsForm() {
  const url = formSheets.elements.url.value.trim();
  state.settings = { url, token: formSheets.elements.token.value.trim(), autoSync: formSheets.elements.autoSync.checked };
  writeStore(KEYS.settings, state.settings);
  setSyncState(url ? 'Таблица подключена' : '');
}

$('#btn-sheets').addEventListener('click', () => {
  formSheets.elements.url.value = state.settings.url;
  formSheets.elements.token.value = state.settings.token;
  formSheets.elements.autoSync.checked = state.settings.autoSync;
  dlgSheets.showModal();
});

formSheets.addEventListener('submit', (e) => {
  e.preventDefault();
  readSheetsForm();
  dlgSheets.close();
  toast('Настройки сохранены');
});

for (const [id, action] of [['#btn-pull', pull], ['#btn-push', () => push()]]) {
  $(id).addEventListener('click', async (e) => {
    readSheetsForm();
    e.currentTarget.disabled = true;
    try { await action(); } finally { e.currentTarget.disabled = false; }
  });
}

// ---------- прочие действия ----------

document.addEventListener('click', (e) => {
  const closer = e.target.closest('[data-close]');
  if (closer) closer.closest('dialog').close();

  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.closest('tr')?.dataset.id;
  const signal = state.signals.find((s) => s.id === id);
  switch (btn.dataset.action) {
    case 'new': openForm(); break;
    case 'edit': openForm(signal); break;
    case 'copy': openForm(signal, { copy: true }); break;
    case 'delete':
      if (signal && confirm(`Удалить сигнал ${signal.ticker}?`)) {
        commit(state.signals.filter((s) => s.id !== id));
        toast('Сигнал удалён');
      }
      break;
  }
});

$('#btn-new').addEventListener('click', () => openForm());

function sortBy(key) {
  state.sort = state.sort.key === key
    ? { key, dir: state.sort.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: key === 'date' ? 'desc' : 'asc' };
  renderRows();
}

document.querySelector('thead').addEventListener('click', (e) => {
  const th = e.target.closest('th[data-sort]');
  if (th) sortBy(th.dataset.sort);
});
document.querySelector('thead').addEventListener('keydown', (e) => {
  const th = e.target.closest('th[data-sort]');
  if (th && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); sortBy(th.dataset.sort); }
});

for (const [id, key] of [['#f-search', 'search'], ['#f-status', 'status'], ['#f-direction', 'direction']]) {
  $(id).addEventListener('input', (e) => { state.filters[key] = e.target.value; renderRows(); });
}

function closeMenu() {
  $('.menu').open = false;
}

$('#btn-export').addEventListener('click', () => {
  closeMenu();
  const blob = new Blob(['﻿' + toCSV(state.signals)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `signals-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$('#file-import').addEventListener('change', async (e) => {
  closeMenu();
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const incoming = parseCSV(await file.text());
    commit(mergeSignals(state.signals, incoming));
    toast(`Импортировано сигналов: ${incoming.length}`);
  } catch (err) {
    toast(`Не удалось прочитать CSV: ${err.message}`, true);
  }
});

$('#btn-clear').addEventListener('click', () => {
  closeMenu();
  if (state.signals.length && confirm('Удалить все сигналы из этого браузера? Google Таблица не изменится, пока вы не нажмёте «Отправить».')) {
    const auto = state.settings.autoSync;
    state.settings.autoSync = false; // не стираем таблицу случайно
    commit([]);
    state.settings.autoSync = auto;
    toast('Все сигналы удалены');
  }
});

function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

$('#btn-theme').addEventListener('click', () => {
  closeMenu();
  const current = document.documentElement.dataset.theme
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  writeStore(KEYS.theme, next);
});

// ---------- старт ----------

$('#f-status').insertAdjacentHTML('beforeend',
  Object.entries(STATUSES).map(([v, label]) => `<option value="${v}">${label}</option>`).join(''));
form.elements.status.innerHTML = Object.entries(STATUSES).map(([v, label]) => `<option value="${v}">${label}</option>`).join('');
applyTheme(readStore(KEYS.theme, null));
setSyncState(state.settings.url ? 'Таблица подключена' : '');
render();
if (state.settings.url && state.settings.autoSync) pull();
