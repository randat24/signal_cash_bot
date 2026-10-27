// Синхронизация с Google Таблицей через веб-приложение Google Apps Script
// (скрипт лежит в google-apps-script/Code.gs, инструкция — в README).

import { normalizeSignal } from './core.js';

function withToken(url, token) {
  if (!token) return url;
  const u = new URL(url);
  u.searchParams.set('token', token);
  return u.toString();
}

async function readJson(res) {
  if (!res.ok) throw new Error(`Таблица ответила ошибкой ${res.status}`);
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error('Таблица вернула не JSON — проверьте, что веб-приложение открыто для «Все»');
  }
  if (data.error) throw new Error(data.error);
  return data;
}

export async function loadFromSheet({ url, token }) {
  const res = await fetch(withToken(url, token), { method: 'GET', redirect: 'follow' });
  const data = await readJson(res);
  return (data.signals || []).map(normalizeSignal);
}

export async function saveToSheet({ url, token }, signals) {
  // text/plain — «простой» запрос без CORS preflight, который Apps Script не поддерживает.
  const res = await fetch(withToken(url, token), {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ signals }),
  });
  return readJson(res);
}
