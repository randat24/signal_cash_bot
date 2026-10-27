// Чистая логика: расчёты по сигналам, статистика, CSV. Без DOM — тестируется в Node.

export const STATUSES = {
  open: 'Открыт',
  tp: 'Тейк-профит',
  sl: 'Стоп-лосс',
  closed: 'Закрыт вручную',
  cancelled: 'Отменён',
};

export const DIRECTIONS = { long: 'LONG', short: 'SHORT' };

export const FIELDS = [
  'id', 'date', 'ticker', 'market', 'direction', 'entry', 'stopLoss',
  'takeProfit', 'exitPrice', 'size', 'status', 'source', 'note',
];

const NUMERIC = ['entry', 'stopLoss', 'takeProfit', 'exitPrice', 'size'];

export function toNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const s = String(value).trim().replace(/\s/g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Текущее локальное время в формате datetime-local: 2026-01-31T09:05
export function localNow(d = new Date()) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Приводит произвольный объект (из формы, CSV, таблицы) к сигналу.
export function normalizeSignal(raw = {}) {
  const s = {};
  for (const f of FIELDS) s[f] = raw[f] ?? '';
  for (const f of NUMERIC) s[f] = toNumber(raw[f]);
  s.id = String(raw.id || newId());
  s.ticker = String(s.ticker).trim().toUpperCase();
  s.market = String(s.market || 'crypto').trim().toLowerCase();
  s.direction = String(s.direction).trim().toLowerCase() === 'short' ? 'short' : 'long';
  s.status = Object.hasOwn(STATUSES, String(s.status).trim().toLowerCase())
    ? String(s.status).trim().toLowerCase()
    : 'open';
  s.date = String(s.date || localNow());
  s.source = String(s.source).trim();
  s.note = String(s.note).trim();
  return s;
}

// Возвращает список ошибок; пустой список — сигнал корректен.
export function validateSignal(s) {
  const errors = [];
  if (!s.ticker) errors.push('Укажите тикер / пару');
  if (!(s.entry > 0)) errors.push('Цена входа должна быть больше нуля');
  for (const [f, label] of [['stopLoss', 'Стоп-лосс'], ['takeProfit', 'Тейк-профит'], ['exitPrice', 'Цена выхода'], ['size', 'Объём']]) {
    if (s[f] !== null && !(s[f] > 0)) errors.push(`${label} должен быть больше нуля`);
  }
  if (s.entry > 0) {
    const long = s.direction === 'long';
    if (s.stopLoss !== null && (long ? s.stopLoss >= s.entry : s.stopLoss <= s.entry)) {
      errors.push(long ? 'Для LONG стоп-лосс должен быть ниже входа' : 'Для SHORT стоп-лосс должен быть выше входа');
    }
    if (s.takeProfit !== null && (long ? s.takeProfit <= s.entry : s.takeProfit >= s.entry)) {
      errors.push(long ? 'Для LONG тейк-профит должен быть выше входа' : 'Для SHORT тейк-профит должен быть ниже входа');
    }
  }
  return errors;
}

// Цена, по которой считаем результат закрытой сделки.
export function effectiveExit(s) {
  if (s.exitPrice !== null) return s.exitPrice;
  if (s.status === 'tp') return s.takeProfit;
  if (s.status === 'sl') return s.stopLoss;
  return null;
}

export function isClosed(s) {
  return s.status === 'tp' || s.status === 'sl' || s.status === 'closed';
}

export function computeMetrics(s) {
  const sign = s.direction === 'short' ? -1 : 1;
  const risk = s.stopLoss !== null ? Math.abs(s.entry - s.stopLoss) : null;
  const reward = s.takeProfit !== null ? Math.abs(s.takeProfit - s.entry) : null;
  const m = {
    riskReward: risk && reward !== null ? reward / risk : null,
    riskPct: risk !== null ? (risk / s.entry) * 100 : null,
    pnlPct: null,
    pnlUsd: null,
    r: null,
  };
  const exit = isClosed(s) ? effectiveExit(s) : null;
  if (exit !== null && s.entry > 0) {
    const move = sign * (exit - s.entry);
    m.pnlPct = (move / s.entry) * 100;
    if (s.size !== null) m.pnlUsd = (s.size * m.pnlPct) / 100;
    if (risk) m.r = move / risk;
  }
  return m;
}

export function computeStats(signals) {
  const stats = {
    total: signals.length, open: 0, closed: 0, wins: 0, losses: 0,
    winRate: null, pnlUsd: 0, avgPnlPct: null, avgR: null, profitFactor: null,
  };
  let pctSum = 0, pctCount = 0, rSum = 0, rCount = 0, grossWin = 0, grossLoss = 0;
  for (const s of signals) {
    if (s.status === 'open') stats.open++;
    const m = computeMetrics(s);
    if (m.pnlPct === null) continue;
    stats.closed++;
    if (m.pnlPct > 0) stats.wins++;
    else if (m.pnlPct < 0) stats.losses++;
    pctSum += m.pnlPct; pctCount++;
    if (m.r !== null) { rSum += m.r; rCount++; }
    if (m.pnlUsd !== null) {
      stats.pnlUsd += m.pnlUsd;
      if (m.pnlUsd > 0) grossWin += m.pnlUsd; else grossLoss -= m.pnlUsd;
    }
  }
  if (stats.wins + stats.losses) stats.winRate = (stats.wins / (stats.wins + stats.losses)) * 100;
  if (pctCount) stats.avgPnlPct = pctSum / pctCount;
  if (rCount) stats.avgR = rSum / rCount;
  if (grossLoss > 0) stats.profitFactor = grossWin / grossLoss;
  else if (grossWin > 0) stats.profitFactor = Infinity;
  return stats;
}

// ---------- CSV ----------

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(signals) {
  const lines = [FIELDS.join(',')];
  for (const s of signals) lines.push(FIELDS.map((f) => csvCell(s[f])).join(','));
  return lines.join('\n');
}

export function parseCSV(text) {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const delim = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (!nonEmpty.length) return [];
  const header = nonEmpty[0].map((h) => h.trim());
  return nonEmpty.slice(1).map((r) => {
    const obj = {};
    header.forEach((h, i) => { obj[h] = r[i] ?? ''; });
    return normalizeSignal(obj);
  });
}

// Объединяет списки по id: записи из incoming заменяют существующие.
export function mergeSignals(existing, incoming) {
  const map = new Map(existing.map((s) => [s.id, s]));
  for (const s of incoming) map.set(s.id, s);
  return [...map.values()];
}
