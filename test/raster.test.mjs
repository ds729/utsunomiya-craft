import test from 'node:test';
import assert from 'node:assert/strict';
import { fillPolygon, strokePolyline } from '../tools/lib/raster.mjs';

const grid = (w, h) => { const a = new Uint8Array(w * h); return { a, set: (i, j) => { a[j * w + i]++; } }; };
const sum = (a) => a.reduce((s, v) => s + v, 0);

test('fillPolygon: 正方形はちょうど面積分のセルを塗る', () => {
  const { a, set } = grid(10, 10);
  const n = fillPolygon([[[2, 2], [6, 2], [6, 5], [2, 5]]], 10, 10, set);
  assert.equal(n, 12);
  assert.equal(sum(a), 12);
  assert.equal(a[2 * 10 + 2], 1);
  assert.equal(a[5 * 10 + 2], 0);
  assert.ok(a.every((v) => v <= 1), '二重塗りしない');
});

test('fillPolygon: 偶奇規則で内周が穴になる（向き不問）', () => {
  const { a, set } = grid(10, 10);
  const outer = [[0, 0], [8, 0], [8, 8], [0, 8]];
  const inner = [[2, 2], [2, 6], [6, 6], [6, 2]]; // outer と同じ回転方向でも穴になる
  fillPolygon([outer, inner.slice().reverse()], 10, 10, set);
  assert.equal(sum(a), 64 - 16);
  assert.equal(a[3 * 10 + 3], 0);
});

test('fillPolygon: 範囲外にはみ出しても落ちない（クリップ）', () => {
  const { a, set } = grid(4, 4);
  fillPolygon([[[-5, -5], [10, -5], [10, 10], [-5, 10]]], 4, 4, set);
  assert.equal(sum(a), 16);
});

test('fillPolygon: 三角形', () => {
  const { a, set } = grid(10, 10);
  fillPolygon([[[0, 0], [10, 0], [0, 10]]], 10, 10, set);
  assert.equal(sum(a), 45); // セル中心 (i+.5)+(j+.5) < 10 ⇔ i+j ≤ 8
});

test('strokePolyline: 幅と長さに応じたセル数、折れ線の重複なし', () => {
  const { a, set } = grid(20, 20);
  strokePolyline([[2, 10], [12, 10], [12, 18]], 4, 20, 20, set);
  assert.ok(a.every((v) => v <= 1));
  assert.equal(a[10 * 20 + 7], 1);
  assert.equal(a[13 * 20 + 7], 0);
  assert.equal(a[15 * 20 + 12], 1);
});

test('strokePolyline: 幅1の水平線は1セル幅', () => {
  const { a, set } = grid(10, 10);
  strokePolyline([[0, 5.5], [10, 5.5]], 1, 10, 10, set);
  assert.equal(sum(a), 10);
});
