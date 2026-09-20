// 財布 SAIFU — 画面のつなぎ込み。計算は logic.js に任せる。
import {
  todayKey, monthOf, shiftMonth, daysInMonth, monthLabel, dateLabel,
  inferCategory, learnCategory, summarize, applyRecurring,
  formatYen, toCSV, parseImport, newId,
  EXPENSE_CATEGORIES, INCOME_CATEGORIES,
} from './logic.js';

const KEY = 'saifu.v1';
const DEFAULT = () => ({ version: 1, budget: 100000, tx: [], recurring: [], learned: {} });
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const digits = s => String(s ?? '').normalize('NFKC').replace(/[^0-9]/g, '');
const withCommas = s => (s ? Number(s).toLocaleString('ja-JP') : '');

// ---- 保存と読み込み ----
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT();
    return parseImport(raw);
  } catch {
    return DEFAULT();
  }
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    toast('保存できませんでした。端末の空き容量を確認してください。');
  }
}

let state = load();
const view = {
  screen: 'record',
  month: monthOf(todayKey()),
  histMonth: monthOf(todayKey()),
  search: '',
  editingId: null,
  autoPicked: null, // メモから自動で選んだ分類
};
let undo = null;

// 固定費を当月に計上（開いたときと、月をまたいで戻ってきたとき）
function postRecurring() {
  const next = applyRecurring(state, monthOf(todayKey()));
  if (next !== state) { state = next; save(); }
}

// ---- 共通部品 ----
let toastTimer = null;
function toast(text, action) {
  const el = $('toast'), btn = $('toast-action');
  $('toast-text').textContent = text;
  if (action) { btn.textContent = action.label; btn.hidden = false; btn.onclick = () => { hideToast(); action.fn(); }; }
  else { btn.hidden = true; btn.onclick = null; }
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, action ? 6000 : 3000);
}
function hideToast() { $('toast').classList.remove('is-on'); }

function confirmDialog({ title, body, ok }) {
  return new Promise(resolve => {
    const dlg = $('confirm-dialog');
    $('confirm-title').textContent = title;
    $('confirm-body').textContent = body;
    $('confirm-ok').textContent = ok;
    const done = v => { dlg.close(); resolve(v); };
    $('confirm-ok').onclick = () => done(true);
    $('confirm-cancel').onclick = () => done(false);
    dlg.oncancel = e => { e.preventDefault(); done(false); };
    dlg.showModal();
  });
}

function chipsHTML(prefix, type, selected) {
  const list = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const pick = list.includes(selected) ? selected : list[0];
  return list.map(c => `<label class="chip"><input type="radio" name="${prefix}category" value="${esc(c)}"${c === pick ? ' checked' : ''}>${esc(c)}</label>`).join('');
}
function checkedValue(form, name) {
  const el = form.querySelector(`input[name="${name}"]:checked`);
  return el ? el.value : null;
}
function amountRow(t) {
  const sign = t.type === 'income' ? '+' : '-';
  return `<span class="tx-amount num${t.type === 'income' ? ' is-income' : ''}">${sign}${esc(formatYen(t.amount))}</span>`;
}
function txRowHTML(t) {
  const title = t.memo || t.category;
  const meta = t.memo ? t.category : '';
  const tag = t.recurringId ? '<span class="tag">固定費</span>' : '';
  return `<button class="tx-row" type="button" data-edit="${esc(t.id)}" aria-label="${esc(title)} ${esc(formatYen(t.amount))} を直す">
    <span class="tx-memo">${esc(title)}${tag}</span>
    <span class="tx-meta">${esc(meta)}</span>
    ${amountRow(t)}
  </button>`;
}
const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0));

// ---- 記録 ----
function renderStrip() {
  const s = summarize(state.tx, monthOf(todayKey()), state.budget, todayKey());
  $('strip').classList.toggle('is-over', s.over);
  $('strip-amount').textContent = formatYen(s.remaining);
  $('strip-hint').textContent = s.over
    ? `予算を ${formatYen(-s.remaining)} 超えています`
    : `あと${s.daysLeft}日、1日 ${formatYen(s.perDay)} まで`;
}
function renderRecordChips(selected) {
  const form = $('form-record');
  $('chips').innerHTML = chipsHTML('', checkedValue(form, 'type'), selected);
}
function resetRecordForm() {
  const form = $('form-record');
  form.reset();
  $('amount').value = '';
  $('amount').removeAttribute('aria-invalid');
  $('amount-error').textContent = '';
  $('memo-hint').textContent = '書くと分類を自動で選びます。';
  $('date').value = todayKey();
  view.autoPicked = null;
  renderRecordChips();
}
function onMemoInput() {
  const memo = $('memo').value;
  const form = $('form-record');
  const s = inferCategory(memo, state.learned);
  if (!s) {
    if (view.autoPicked) { $('memo-hint').textContent = '書くと分類を自動で選びます。'; }
    return;
  }
  const current = checkedValue(form, 'type');
  if (s.type !== current) {
    form.querySelector(`input[name="type"][value="${s.type}"]`).checked = true;
  }
  renderRecordChips(s.category);
  view.autoPicked = s.category;
  $('memo-hint').textContent = `メモから「${s.type === 'income' ? '収入・' : ''}${s.category}」を選びました。違うときは分類を押し直してください。`;
}
function readAmount(input, errorEl) {
  const n = Number(digits(input.value));
  if (!n || n <= 0) {
    errorEl.textContent = '金額を1円以上の数字で入力してください。';
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    return null;
  }
  errorEl.textContent = '';
  input.removeAttribute('aria-invalid');
  return n;
}
function onRecordSubmit(e) {
  e.preventDefault();
  const form = $('form-record');
  const amount = readAmount($('amount'), $('amount-error'));
  if (amount === null) return;
  const type = checkedValue(form, 'type');
  const category = checkedValue(form, 'category');
  const memo = $('memo').value.trim();
  const date = $('date').value || todayKey();
  const t = { id: newId(), type, amount, category, memo, date, createdAt: Date.now() };
  state.tx.push(t);
  if (memo) state.learned = learnCategory(state.learned, memo, category);
  save();
  undo = { label: '取り消す', fn: () => { state.tx = state.tx.filter(x => x.id !== t.id); save(); render(); toast('記録を取り消しました'); } };
  toast(`記録しました  ${type === 'income' ? '+' : ''}${formatYen(amount)} ${category}`, undo);
  resetRecordForm();
  render();
  $('amount').focus();
}

// ---- 今月 ----
function guideText(s, isCurrent, isPast) {
  if (isPast) {
    return s.over
      ? `この月は ${formatYen(s.spent)} 使い、予算を ${formatYen(-s.remaining)} 超えました。`
      : `この月は ${formatYen(s.spent)} 使い、${formatYen(s.remaining)} 残しました。`;
  }
  if (!isCurrent) return `まだ先の月です。予算は ${formatYen(s.budget)} です。`;
  if (s.count === 0) return `まだ記録がありません。今月の予算は ${formatYen(s.budget)} です。`;
  if (s.over) return `予算を ${formatYen(-s.remaining)} 超えています。あと${s.daysLeft}日は出費を控えめに。`;
  if (s.daysLeft <= 1) return `今日で月末です。あと ${formatYen(s.remaining)} 使えます。`;
  return `あと${s.daysLeft}日。1日 ${formatYen(s.perDay)} まで使えます。`;
}
function renderMonth() {
  const today = todayKey();
  const cur = monthOf(today);
  const m = view.month;
  const s = summarize(state.tx, m, state.budget, today);
  const isCurrent = m === cur, isPast = m < cur;
  $('month-title').textContent = monthLabel(m);
  $('month-current-wrap').hidden = isCurrent;
  $('hero-label').textContent = isPast ? '残した額' : 'のこり';
  $('hero-amount').textContent = formatYen(s.remaining);
  $('hero-amount').classList.toggle('is-over', s.over);
  $('hero-guide').textContent = guideText(s, isCurrent, isPast);
  $('fig-budget').textContent = formatYen(s.budget);
  $('fig-spent').textContent = formatYen(s.spent);
  $('fig-income').textContent = formatYen(s.income);
  renderChart(s, isCurrent ? Number(today.slice(8, 10)) : isPast ? s.daysInMonth : 0);

  const cats = $('cats');
  if (s.byCategory.length === 0) {
    cats.innerHTML = '<li class="help">支出の記録が入ると、分類ごとの内訳が出ます。</li>';
  } else {
    cats.innerHTML = s.byCategory.map(c => `<li>
      <div class="cat-row">
        <span class="cat-name">${esc(c.category)}</span>
        <span class="cat-amount num">${esc(formatYen(c.amount))}<small>${Math.round(c.ratio * 100)}%</small></span>
        <div class="bar" role="img" aria-label="${esc(c.category)} は支出の${Math.round(c.ratio * 100)}%"><span style="width:${Math.max(1, c.ratio * 100)}%"></span></div>
      </div></li>`).join('');
  }

  const recent = state.tx.filter(t => monthOf(t.date) === m).sort(byDateDesc).slice(0, 5);
  $('recent').innerHTML = recent.length
    ? recent.map(txRowHTML).join('')
    : `<div class="empty">まだ記録がありません。<br>「記録」から最初の支出を入れてみましょう。<br><button class="btn btn-secondary" type="button" data-go="record">記録する</button></div>`;
}

// ペース図: 日ごとの累計（実線）と、予算を均等に使ったときの線（点線）
let chartState = null;
function renderChart(s, throughDay) {
  const wrap = $('chart-wrap');
  const W = Math.max(280, Math.floor(wrap.getBoundingClientRect().width || 600));
  const H = 180, padL = 8, padR = 8, padT = 28, padB = 24;
  const n = s.daysInMonth;
  const maxY = Math.max(s.budget, ...s.cumulative, 1) * 1.05;
  const x = d => padL + ((d - 1) / (n - 1)) * (W - padL - padR);
  const y = v => padT + (1 - v / maxY) * (H - padT - padB);
  const gridVals = [0, s.budget / 2, s.budget];
  const grid = gridVals.map(v => `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>`).join('');
  const ref = `<line class="ref" x1="${x(1)}" y1="${y(0).toFixed(1)}" x2="${x(n)}" y2="${y(s.budget).toFixed(1)}"/>`;
  const pts = [];
  for (let d = 1; d <= throughDay; d++) pts.push(`${x(d).toFixed(1)},${y(s.cumulative[d - 1]).toFixed(1)}`);
  const line = pts.length ? `<polyline class="line" points="${pts.join(' ')}"/>` : '';
  const dot = pts.length ? `<circle class="dot" r="4" cx="${x(throughDay).toFixed(1)}" cy="${y(s.cumulative[throughDay - 1]).toFixed(1)}"/>` : '';
  const todayLine = throughDay > 0 && throughDay < n ? `<line class="today" x1="${x(throughDay).toFixed(1)}" x2="${x(throughDay).toFixed(1)}" y1="${padT}" y2="${H - padB}"/>` : '';
  const labels = `
    <text x="${padL}" y="${H - 6}">1日</text>
    <text x="${x(15).toFixed(1)}" y="${H - 6}" text-anchor="middle">15日</text>
    <text x="${W - padR}" y="${H - 6}" text-anchor="end">${n}日</text>
    <text x="${W - padR}" y="${(y(s.budget) - 6).toFixed(1)}" text-anchor="end">予算 ${esc(formatYen(s.budget))}</text>`;
  const readoutDefault = throughDay > 0 ? `${throughDay}日まで ${formatYen(s.cumulative[throughDay - 1])}` : '記録が入るとここに累計が出ます';
  wrap.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" tabindex="0" aria-label="${esc(readoutDefault)}。点線は予算のペース">
    ${grid}${ref}${todayLine}${line}${dot}
    <line class="cursor" id="chart-cursor" x1="0" x2="0" y1="${padT}" y2="${H - padB}" visibility="hidden"/>
    <text class="readout" id="chart-readout" x="${padL}" y="18">${esc(readoutDefault)}</text>
    ${labels}
  </svg>`;
  chartState = { s, throughDay, n, x, W, padL, padR, readoutDefault };
  const svg = wrap.firstElementChild;
  const move = e => {
    if (!chartState.throughDay) return;
    const r = svg.getBoundingClientRect();
    const px = (e.clientX - r.left) * (W / r.width);
    let d = Math.round(1 + ((px - padL) / (W - padL - padR)) * (n - 1));
    d = Math.min(Math.max(1, d), chartState.throughDay);
    $('chart-cursor').setAttribute('x1', x(d).toFixed(1));
    $('chart-cursor').setAttribute('x2', x(d).toFixed(1));
    $('chart-cursor').setAttribute('visibility', 'visible');
    $('chart-readout').textContent = `${d}日まで ${formatYen(s.cumulative[d - 1])}`;
  };
  const leave = () => {
    $('chart-cursor').setAttribute('visibility', 'hidden');
    $('chart-readout').textContent = chartState.readoutDefault;
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', leave);
  svg.addEventListener('pointerup', leave);
}

// ---- 履歴 ----
function renderHistory() {
  const m = view.histMonth;
  const q = view.search.trim().normalize('NFKC').toLowerCase();
  $('history-title').textContent = monthLabel(m);
  let list = state.tx.filter(t => monthOf(t.date) === m);
  if (q) list = list.filter(t => `${t.memo} ${t.category}`.normalize('NFKC').toLowerCase().includes(q));
  list.sort(byDateDesc);
  const spent = list.filter(t => t.type === 'expense').reduce((a, t) => a + t.amount, 0);
  const income = list.filter(t => t.type === 'income').reduce((a, t) => a + t.amount, 0);
  $('history-summary').textContent = list.length
    ? `${list.length}件。支出 ${formatYen(spent)}、収入 ${formatYen(income)}`
    : '';
  const groups = new Map();
  for (const t of list) { if (!groups.has(t.date)) groups.set(t.date, []); groups.get(t.date).push(t); }
  const out = $('history-list');
  if (!list.length) {
    out.innerHTML = `<div class="empty">${q ? 'この言葉に合う記録はありません。' : 'この月の記録はありません。'}</div>`;
    return;
  }
  out.innerHTML = [...groups.entries()].map(([date, items]) => {
    const daySpent = items.filter(t => t.type === 'expense').reduce((a, t) => a + t.amount, 0);
    return `<section class="day-group" aria-label="${esc(dateLabel(date))}">
      <div class="day-head"><h3>${esc(dateLabel(date))}</h3><span class="day-total num">支出 ${esc(formatYen(daySpent))}</span></div>
      ${items.map(txRowHTML).join('')}
    </section>`;
  }).join('');
}

// ---- 編集シート ----
function openEdit(id) {
  const t = state.tx.find(x => x.id === id);
  if (!t) return;
  view.editingId = id;
  const form = $('form-edit');
  form.querySelector(`input[name="e-type"][value="${t.type}"]`).checked = true;
  $('e-amount').value = withCommas(String(t.amount));
  $('e-amount').removeAttribute('aria-invalid');
  $('e-amount-error').textContent = '';
  $('e-memo').value = t.memo || '';
  $('e-date').value = t.date;
  $('e-chips').innerHTML = chipsHTML('e-', t.type, t.category);
  $('edit-dialog').showModal();
}
function onEditTypeChange() {
  const form = $('form-edit');
  $('e-chips').innerHTML = chipsHTML('e-', checkedValue(form, 'e-type'));
}
function onEditSubmit(e) {
  e.preventDefault();
  const t = state.tx.find(x => x.id === view.editingId);
  if (!t) { $('edit-dialog').close(); return; }
  const amount = readAmount($('e-amount'), $('e-amount-error'));
  if (amount === null) return;
  const form = $('form-edit');
  const before = { ...t };
  t.type = checkedValue(form, 'e-type');
  t.amount = amount;
  t.category = checkedValue(form, 'e-category');
  t.memo = $('e-memo').value.trim();
  t.date = $('e-date').value || t.date;
  if (t.memo) state.learned = learnCategory(state.learned, t.memo, t.category);
  save();
  $('edit-dialog').close();
  render();
  toast('保存しました', { label: '元に戻す', fn: () => { Object.assign(t, before); save(); render(); toast('元に戻しました'); } });
}
async function onEditDelete() {
  const t = state.tx.find(x => x.id === view.editingId);
  if (!t) return;
  const ok = await confirmDialog({ title: 'この記録を削除しますか？', body: `${t.memo || t.category} ${formatYen(t.amount)}（${dateLabel(t.date)}）を削除します。`, ok: '削除する' });
  if (!ok) return;
  const idx = state.tx.indexOf(t);
  state.tx.splice(idx, 1);
  save();
  $('edit-dialog').close();
  render();
  toast('削除しました', { label: '元に戻す', fn: () => { state.tx.splice(Math.min(idx, state.tx.length), 0, t); save(); render(); toast('元に戻しました'); } });
}

// ---- 設定 ----
function renderSettings() {
  if (document.activeElement !== $('budget')) $('budget').value = withCommas(String(state.budget));
  const list = $('rec-list');
  list.innerHTML = state.recurring.length
    ? state.recurring.map(r => `<li>
        <span class="rec-name">${esc(r.name)}</span>
        <span class="rec-meta">毎月${r.day}日、${esc(r.category)}${r.type === 'income' ? '（収入）' : ''}、${esc(formatYen(r.amount))}</span>
        <button class="btn btn-tertiary btn-sm" type="button" data-rec-del="${esc(r.id)}" aria-label="${esc(r.name)} を固定費から外す">外す</button>
      </li>`).join('')
    : '<li class="help">固定費はまだありません。</li>';
  const sel = $('rec-category');
  if (!sel.options.length) {
    sel.innerHTML = [...EXPENSE_CATEGORIES.map(c => `<option value="${esc(c)}">${esc(c)}</option>`), ...INCOME_CATEGORIES.map(c => `<option value="${esc(c)}">${esc(c)}（収入）</option>`)].join('');
    sel.value = '住居・光熱';
  }
}
function onBudgetSubmit(e) {
  e.preventDefault();
  const n = Number(digits($('budget').value));
  if (!Number.isFinite(n) || n < 0) { $('budget-error').textContent = '0以上の数字で入力してください。'; $('budget').setAttribute('aria-invalid', 'true'); return; }
  $('budget-error').textContent = ''; $('budget').removeAttribute('aria-invalid');
  state.budget = n;
  save(); render();
  toast(`予算を ${formatYen(n)} にしました`);
}
function onRecSubmit(e) {
  e.preventDefault();
  const name = $('rec-name').value.trim();
  const amount = Number(digits($('rec-amount').value));
  const day = Math.min(31, Math.max(1, Number($('rec-day').value) || 1));
  const category = $('rec-category').value;
  if (!name || !amount) { $('rec-error').textContent = '名前と1円以上の金額を入力してください。'; return; }
  $('rec-error').textContent = '';
  state.recurring.push({ id: newId(), name, amount, category, day, type: INCOME_CATEGORIES.includes(category) ? 'income' : 'expense' });
  postRecurringNow();
  $('form-rec').reset(); $('rec-day').value = '1'; $('rec-category').value = '住居・光熱';
  render();
  toast(`固定費「${name}」を追加しました`);
}
function postRecurringNow() {
  const next = applyRecurring(state, monthOf(todayKey()));
  state = next;
  save();
}
async function onRecDelete(id) {
  const r = state.recurring.find(x => x.id === id);
  if (!r) return;
  const ok = await confirmDialog({ title: `「${r.name}」を固定費から外しますか？`, body: 'すでに記録に入っている分は履歴に残ります。来月から自動で入らなくなります。', ok: '外す' });
  if (!ok) return;
  state.recurring = state.recurring.filter(x => x.id !== id);
  save(); render();
  toast(`「${r.name}」を固定費から外しました`);
}
function download(name, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function onExportJSON() {
  download(`saifu-${todayKey()}.json`, JSON.stringify(state, null, 2), 'application/json');
  toast('控えを書き出しました');
}
function onExportCSV() {
  download(`saifu-${todayKey()}.csv`, '﻿' + toCSV(state.tx), 'text/csv');
  toast('CSVを書き出しました');
}
async function onImportFile(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let data;
  try { data = parseImport(await file.text()); }
  catch { toast('読み込めませんでした。財布で書き出したJSONファイルを選んでください。'); return; }
  const ok = await confirmDialog({ title: '控えから読み込みますか？', body: `${data.tx.length}件の記録を読み込み、今のデータと置き換えます。`, ok: '置き換える' });
  if (!ok) return;
  state = data;
  save();
  postRecurring();
  render();
  toast(`${data.tx.length}件を読み込みました`);
}
async function onWipe() {
  const ok = await confirmDialog({ title: 'すべての記録を削除しますか？', body: '記録・固定費・予算・学習した分類をすべて消します。元に戻せません。先に「控えを書き出す」で保存しておくと安心です。', ok: 'すべて削除する' });
  if (!ok) return;
  state = DEFAULT();
  save(); render();
  toast('すべての記録を削除しました');
}

// ---- 画面切り替え ----
const SCREENS = ['record', 'month', 'history', 'settings'];
function showScreen(name) {
  if (!SCREENS.includes(name)) name = 'record';
  view.screen = name;
  for (const s of SCREENS) $(`screen-${s}`).hidden = s !== name;
  document.querySelectorAll('.nav button').forEach(b => {
    if (b.dataset.screen === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  if (location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
  window.scrollTo({ top: 0 });
  if (name === 'month') renderMonth();
}
function render() {
  $('today-label').textContent = dateLabel(todayKey());
  renderStrip();
  renderMonth();
  renderHistory();
  renderSettings();
}

// ---- 起動 ----
function init() {
  postRecurring();
  resetRecordForm();
  render();
  showScreen((location.hash || '#record').slice(1));

  $('form-record').addEventListener('submit', onRecordSubmit);
  $('form-record').addEventListener('change', e => {
    if (e.target.name === 'type') { renderRecordChips(view.autoPicked); }
    if (e.target.name === 'category') { view.autoPicked = null; }
  });
  $('memo').addEventListener('input', onMemoInput);
  for (const id of ['amount', 'e-amount', 'budget', 'rec-amount']) {
    $(id).addEventListener('input', e => { const d = digits(e.target.value).slice(0, 10); e.target.value = withCommas(d); });
  }
  $('month-prev').addEventListener('click', () => { view.month = shiftMonth(view.month, -1); renderMonth(); });
  $('month-next').addEventListener('click', () => { view.month = shiftMonth(view.month, 1); renderMonth(); });
  $('month-current').addEventListener('click', () => { view.month = monthOf(todayKey()); renderMonth(); });
  $('to-history').addEventListener('click', () => { view.histMonth = view.month; renderHistory(); showScreen('history'); });
  $('hist-prev').addEventListener('click', () => { view.histMonth = shiftMonth(view.histMonth, -1); renderHistory(); });
  $('hist-next').addEventListener('click', () => { view.histMonth = shiftMonth(view.histMonth, 1); renderHistory(); });
  $('search').addEventListener('input', e => { view.search = e.target.value; renderHistory(); });
  document.addEventListener('click', e => {
    const edit = e.target.closest('[data-edit]');
    if (edit) { openEdit(edit.dataset.edit); return; }
    const go = e.target.closest('[data-go]');
    if (go) { showScreen(go.dataset.go); return; }
    const del = e.target.closest('[data-rec-del]');
    if (del) { onRecDelete(del.dataset.recDel); }
  });
  document.querySelectorAll('.nav button').forEach(b => b.addEventListener('click', () => showScreen(b.dataset.screen)));
  window.addEventListener('hashchange', () => showScreen((location.hash || '#record').slice(1)));

  $('form-edit').addEventListener('submit', onEditSubmit);
  $('form-edit').addEventListener('change', e => { if (e.target.name === 'e-type') onEditTypeChange(); });
  $('edit-delete').addEventListener('click', onEditDelete);
  $('edit-close').addEventListener('click', () => $('edit-dialog').close());

  $('form-budget').addEventListener('submit', onBudgetSubmit);
  $('form-rec').addEventListener('submit', onRecSubmit);
  $('export-json').addEventListener('click', onExportJSON);
  $('export-csv').addEventListener('click', onExportCSV);
  $('import-btn').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', onImportFile);
  $('wipe').addEventListener('click', onWipe);

  let resizeTimer = null;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (view.screen === 'month') renderMonth(); }, 150); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { postRecurring(); render(); } });

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}
init();
