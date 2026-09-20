import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  todayKey, monthOf, shiftMonth, daysInMonth, monthLabel,
  inferCategory, normalizeMemo, learnCategory,
  summarize, applyRecurring, formatYen, toCSV, parseImport, newId,
  EXPENSE_CATEGORIES, INCOME_CATEGORIES,
} from '../logic.js';

// ---- 日付 ----
test('todayKey: 朝7時より前は前日扱い', () => {
  assert.equal(todayKey(new Date(2026, 8, 21, 3, 30)), '2026-09-20');
  assert.equal(todayKey(new Date(2026, 8, 21, 7, 0)), '2026-09-21');
  assert.equal(todayKey(new Date(2026, 8, 21, 23, 59)), '2026-09-21');
});
test('todayKey: 月初の深夜は前月末', () => {
  assert.equal(todayKey(new Date(2026, 9, 1, 1, 0)), '2026-09-30');
});
test('monthOf / shiftMonth / daysInMonth / monthLabel', () => {
  assert.equal(monthOf('2026-09-20'), '2026-09');
  assert.equal(shiftMonth('2026-09', -1), '2026-08');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(daysInMonth('2026-02'), 28);
  assert.equal(daysInMonth('2028-02'), 29);
  assert.equal(monthLabel('2026-09'), '2026年9月');
});

// ---- 分類の推定 ----
test('inferCategory: 辞書のキーワードで分類する', () => {
  assert.deepEqual(inferCategory('セブンでコーヒー', {}), { category: '食費', type: 'expense' });
  assert.deepEqual(inferCategory('タクシー', {}), { category: '交通', type: 'expense' });
  assert.deepEqual(inferCategory('ゴルフ練習場', {}), { category: '趣味・娯楽', type: 'expense' });
  assert.deepEqual(inferCategory('amazon 充電ケーブル', {}), { category: '買い物', type: 'expense' });
});
test('inferCategory: 収入語なら type=income', () => {
  assert.deepEqual(inferCategory('9月分 給料', {}), { category: '給与', type: 'income' });
});
test('inferCategory: 分からなければ null', () => {
  assert.equal(inferCategory('', {}), null);
  assert.equal(inferCategory('xyz', {}), null);
});
test('inferCategory: 学習済みが辞書より優先', () => {
  const learned = learnCategory({}, 'セブン', '買い物');
  assert.deepEqual(inferCategory('セブン', learned), { category: '買い物', type: 'expense' });
  assert.deepEqual(inferCategory('  セブン ', learned), { category: '買い物', type: 'expense' });
});
test('normalizeMemo: 空白と全角半角をそろえる', () => {
  assert.equal(normalizeMemo(' Ａｍａｚｏｎ　Prime '), 'amazon prime');
});
test('learnCategory: 空メモは学習しない', () => {
  assert.deepEqual(learnCategory({}, '   ', '食費'), {});
});
test('カテゴリ一覧', () => {
  assert.ok(EXPENSE_CATEGORIES.includes('食費'));
  assert.ok(EXPENSE_CATEGORIES.includes('その他'));
  assert.ok(INCOME_CATEGORIES.includes('給与'));
});

// ---- 集計 ----
const tx = [
  { id: 'a', type: 'expense', amount: 1200, category: '食費', memo: '昼', date: '2026-09-02' },
  { id: 'b', type: 'expense', amount: 800, category: '食費', memo: '夜', date: '2026-09-02' },
  { id: 'c', type: 'expense', amount: 3000, category: '交通', memo: '', date: '2026-09-10' },
  { id: 'd', type: 'income', amount: 250000, category: '給与', memo: '', date: '2026-09-25' },
  { id: 'e', type: 'expense', amount: 9999, category: '食費', memo: '先月', date: '2026-08-31' },
];
test('summarize: 当月だけを数える', () => {
  const s = summarize(tx, '2026-09', 100000, '2026-09-20');
  assert.equal(s.spent, 5000);
  assert.equal(s.income, 250000);
  assert.equal(s.remaining, 95000);
  assert.equal(s.daysInMonth, 30);
  assert.equal(s.daysLeft, 11);           // 20日を含めて残り11日
  assert.equal(s.perDay, Math.floor(95000 / 11));
  assert.equal(s.count, 4);
});
test('summarize: 分類別は金額の大きい順、比率つき', () => {
  const s = summarize(tx, '2026-09', 100000, '2026-09-20');
  assert.deepEqual(s.byCategory.map(c => c.category), ['交通', '食費']);
  assert.equal(s.byCategory[0].amount, 3000);
  assert.equal(s.byCategory[0].ratio, 0.6);
});
test('summarize: 日別累計は日数ぶん並ぶ', () => {
  const s = summarize(tx, '2026-09', 100000, '2026-09-20');
  assert.equal(s.cumulative.length, 30);
  assert.equal(s.cumulative[0], 0);
  assert.equal(s.cumulative[1], 2000);
  assert.equal(s.cumulative[9], 5000);
  assert.equal(s.cumulative[29], 5000);
});
test('summarize: 予算超えは残額がマイナスで over=true、perDay は 0', () => {
  const s = summarize(tx, '2026-09', 4000, '2026-09-20');
  assert.equal(s.remaining, -1000);
  assert.equal(s.over, true);
  assert.equal(s.perDay, 0);
});
test('summarize: 過去の月は残り日数 0 で perDay は 0、未来の月は全日', () => {
  assert.equal(summarize(tx, '2026-08', 100000, '2026-09-20').daysLeft, 0);
  assert.equal(summarize(tx, '2026-08', 100000, '2026-09-20').perDay, 0);
  assert.equal(summarize(tx, '2026-10', 100000, '2026-09-20').daysLeft, 31);
});

// ---- 固定費 ----
test('applyRecurring: 当月分を一度だけ追加する', () => {
  const state = {
    tx: [],
    recurring: [{ id: 'r1', name: '家賃', amount: 80000, category: '住居・光熱', day: 27, type: 'expense' }],
  };
  const once = applyRecurring(state, '2026-09');
  assert.equal(once.tx.length, 1);
  assert.equal(once.tx[0].date, '2026-09-27');
  assert.equal(once.tx[0].recurringId, 'r1');
  assert.equal(once.tx[0].memo, '家賃');
  const twice = applyRecurring(once, '2026-09');
  assert.equal(twice.tx.length, 1);
});
test('applyRecurring: 日付は月末に丸める', () => {
  const state = { tx: [], recurring: [{ id: 'r2', name: 'サブスク', amount: 980, category: '通信', day: 31, type: 'expense' }] };
  assert.equal(applyRecurring(state, '2026-02').tx[0].date, '2026-02-28');
});
test('applyRecurring: 固定費が無ければそのまま', () => {
  const state = { tx: [{ id: 'x' }], recurring: [] };
  assert.equal(applyRecurring(state, '2026-09'), state);
});

// ---- 表示・入出力 ----
test('formatYen', () => {
  assert.equal(formatYen(0), '¥0');
  assert.equal(formatYen(1234567), '¥1,234,567');
  assert.equal(formatYen(-500), '-¥500');
});
test('toCSV: ヘッダー + 行、カンマや引用符をエスケープ', () => {
  const csv = toCSV([{ date: '2026-09-02', type: 'expense', amount: 1200, category: '食費', memo: 'a,"b"' }]);
  const lines = csv.split('\n');
  assert.equal(lines[0], '日付,種別,金額,分類,メモ');
  assert.equal(lines[1], '2026-09-02,支出,1200,食費,"a,""b"""');
});
test('parseImport: 正しいデータは受け入れ、壊れたものは捨てる', () => {
  const ok = parseImport(JSON.stringify({ version: 1, budget: 50000, tx: [
    { id: 'a', type: 'expense', amount: 100, category: '食費', memo: 'm', date: '2026-09-01' },
    { id: 'bad', type: 'expense', amount: 'x', category: '食費', memo: '', date: '2026-09-01' },
    { id: 'bad2', type: 'expense', amount: 100, category: '食費', memo: '', date: 'nope' },
  ], recurring: [], learned: { 'x': '食費' } }));
  assert.equal(ok.budget, 50000);
  assert.equal(ok.tx.length, 1);
  assert.deepEqual(ok.learned, { x: '食費' });
  assert.throws(() => parseImport('not json'));
  assert.throws(() => parseImport(JSON.stringify({ hello: 1 })));
});
test('newId: 重複しない文字列', () => {
  const a = newId(), b = newId();
  assert.equal(typeof a, 'string');
  assert.notEqual(a, b);
});
