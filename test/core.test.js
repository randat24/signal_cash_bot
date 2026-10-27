import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSignal, validateSignal, computeMetrics, computeStats, toCSV, parseCSV, mergeSignals, toNumber,
} from '../src/core.js';

const sig = (o) => normalizeSignal({ ticker: 'btcusdt', entry: 100, stopLoss: 90, takeProfit: 130, size: 1000, ...o });

test('toNumber понимает запятую и пробелы', () => {
  assert.equal(toNumber('1 234,5'), 1234.5);
  assert.equal(toNumber(''), null);
  assert.equal(toNumber('abc'), null);
});

test('normalizeSignal приводит поля', () => {
  const s = sig({ direction: 'SHORT', status: 'TP' });
  assert.equal(s.ticker, 'BTCUSDT');
  assert.equal(s.direction, 'short');
  assert.equal(s.status, 'tp');
  assert.ok(s.id);
  assert.equal(normalizeSignal({ status: 'weird' }).status, 'open');
});

test('validateSignal проверяет уровни для LONG и SHORT', () => {
  assert.deepEqual(validateSignal(sig()), []);
  assert.equal(validateSignal(sig({ stopLoss: 110 })).length, 1);
  assert.deepEqual(validateSignal(sig({ direction: 'short', stopLoss: 110, takeProfit: 80 })), []);
  assert.equal(validateSignal(normalizeSignal({})).length, 2);
});

test('computeMetrics: LONG по тейку', () => {
  const m = computeMetrics(sig({ status: 'tp' }));
  assert.equal(m.riskReward, 3);
  assert.equal(m.riskPct, 10);
  assert.equal(m.pnlPct, 30);
  assert.equal(m.pnlUsd, 300);
  assert.equal(m.r, 3);
});

test('computeMetrics: SHORT по стопу и открытый сигнал', () => {
  const m = computeMetrics(sig({ direction: 'short', stopLoss: 110, takeProfit: 80, status: 'sl' }));
  assert.equal(m.pnlPct, -10);
  assert.equal(m.r, -1);
  assert.equal(computeMetrics(sig()).pnlPct, null);
});

test('computeMetrics: ручное закрытие по цене выхода', () => {
  const m = computeMetrics(sig({ status: 'closed', exitPrice: 105 }));
  assert.equal(m.pnlPct, 5);
  assert.equal(m.r, 0.5);
});

test('computeStats', () => {
  const st = computeStats([
    sig({ status: 'tp' }), sig({ status: 'sl' }), sig({ status: 'sl' }), sig(), sig({ status: 'cancelled' }),
  ]);
  assert.equal(st.total, 5);
  assert.equal(st.open, 1);
  assert.equal(st.closed, 3);
  assert.equal(st.wins, 1);
  assert.equal(st.losses, 2);
  assert.equal(Math.round(st.winRate), 33);
  assert.equal(st.pnlUsd, 100);
  assert.equal(st.profitFactor, 1.5);
  assert.equal(st.avgR, 1 / 3);
});

test('CSV: экспорт и импорт туда-обратно, кавычки и ;', () => {
  const list = [sig({ note: 'вход, "по рынку"\nвторая строка', source: 'TG' }), sig({ direction: 'short', stopLoss: 110, takeProfit: 80 })];
  assert.deepEqual(parseCSV(toCSV(list)), list);
  const semi = parseCSV('﻿ticker;entry;direction\nETH;2500,5;short\n');
  assert.equal(semi[0].ticker, 'ETH');
  assert.equal(semi[0].entry, 2500.5);
  assert.equal(semi[0].direction, 'short');
});

test('mergeSignals заменяет по id', () => {
  const a = sig({ id: '1' }), b = sig({ id: '2' });
  const merged = mergeSignals([a, b], [sig({ id: '2', ticker: 'eth' })]);
  assert.equal(merged.length, 2);
  assert.equal(merged[1].ticker, 'ETH');
});
