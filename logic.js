// 財布 SAIFU — 画面に依存しない計算だけを集めたファイル。test/ で検証する。

export const EXPENSE_CATEGORIES = ['食費', '交通', '買い物', '趣味・娯楽', '交際費', '医療・健康', '住居・光熱', '通信', 'その他'];
export const INCOME_CATEGORIES = ['給与', '副収入', 'その他収入'];

// メモの言葉 → 分類。上にあるものほど優先。
const KEYWORDS = [
  ['給与', 'income', ['給料', '給与', '月給', '賞与', 'ボーナス', '手当']],
  ['副収入', 'income', ['副業', '売上', 'メルカリ', 'フリマ', '配当', '利息', '還付', 'キャッシュバック', 'ポイント']],
  ['住居・光熱', 'expense', ['家賃', '管理費', '電気', 'ガス', '水道', '光熱', '住宅', 'ローン', '火災保険']],
  ['通信', 'expense', ['スマホ', '携帯', '通信', 'wifi', 'wi-fi', '光回線', 'docomo', 'ドコモ', 'au', 'softbank', 'ソフトバンク', '楽天モバイル', 'ahamo', 'povo', 'サブスク', 'netflix', 'spotify', 'youtube', 'icloud', 'apple', 'google']],
  ['交通', 'expense', ['電車', 'バス', 'タクシー', 'suica', 'pasmo', '定期', '新幹線', '飛行機', '航空', 'ガソリン', '駐車', '高速', 'etc', 'レンタカー', '切符', '乗車']],
  ['医療・健康', 'expense', ['病院', '医院', 'クリニック', '薬', 'ドラッグ', 'マツキヨ', '歯医者', '歯科', '診察', 'ジム', 'サプリ', 'マッサージ', '整体']],
  ['交際費', 'expense', ['飲み会', '居酒屋', 'バー', 'ビール', '飲み', '宴会', '歓迎会', '送別会', 'お祝い', 'ご祝儀', '香典', 'プレゼント', '贈り物', 'お土産']],
  ['趣味・娯楽', 'expense', ['ゴルフ', '映画', 'ゲーム', '本', '書籍', 'kindle', '漫画', 'ライブ', 'コンサート', '旅行', 'ホテル', '温泉', '釣り', 'カラオケ', '観戦', 'チケット', '趣味']],
  ['食費', 'expense', ['コンビニ', 'セブン', 'ローソン', 'ファミマ', 'スーパー', '弁当', 'ランチ', '昼', '夕食', '夜ご飯', '朝食', 'カフェ', 'スタバ', 'コーヒー', 'パン', '食', 'ごはん', 'ラーメン', '牛丼', 'マック', 'すき家', '吉野家', '寿司', '焼肉', 'ピザ', 'uber', '出前', '飲料', '水', 'お菓子']],
  ['買い物', 'expense', ['amazon', 'アマゾン', '楽天', 'ユニクロ', '服', '靴', '洋服', '無印', 'ニトリ', 'ヨドバシ', 'ビック', '家電', '日用品', '雑貨', '100均', 'ダイソー', 'メガネ', '化粧', 'シャンプー', '洗剤']],
];

export function normalizeMemo(memo) {
  return String(memo || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function inferCategory(memo, learned = {}) {
  const key = normalizeMemo(memo);
  if (!key) return null;
  if (learned[key]) {
    const c = learned[key];
    return { category: c, type: INCOME_CATEGORIES.includes(c) ? 'income' : 'expense' };
  }
  for (const [category, type, words] of KEYWORDS) {
    if (words.some(w => key.includes(w.toLowerCase()))) return { category, type };
  }
  return null;
}

export function learnCategory(learned, memo, category) {
  const key = normalizeMemo(memo);
  if (!key || !category) return learned;
  return { ...learned, [key]: category };
}

// ---- 日付。一日の区切りは朝7時 ----
const pad = n => String(n).padStart(2, '0');
export function todayKey(now = new Date()) {
  const d = new Date(now.getTime() - 7 * 60 * 60 * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function monthOf(dateKey) { return dateKey.slice(0, 7); }
export function shiftMonth(month, n) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
export function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
export function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return `${y}年${m}月`;
}
export function dateLabel(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const w = '日月火水木金土'[new Date(y, m - 1, d).getDay()];
  return `${m}月${d}日（${w}）`;
}

// ---- 集計 ----
export function summarize(txs, month, budget, today) {
  const inMonth = txs.filter(t => monthOf(t.date) === month);
  const n = daysInMonth(month);
  let spent = 0, income = 0;
  const cat = new Map();
  const perDaySpent = new Array(n).fill(0);
  for (const t of inMonth) {
    if (t.type === 'income') { income += t.amount; continue; }
    spent += t.amount;
    cat.set(t.category, (cat.get(t.category) || 0) + t.amount);
    perDaySpent[Number(t.date.slice(8, 10)) - 1] += t.amount;
  }
  const cumulative = [];
  perDaySpent.reduce((acc, v, i) => (cumulative[i] = acc + v), 0);
  const remaining = budget - spent;
  const todayMonth = monthOf(today);
  let daysLeft;
  if (month < todayMonth) daysLeft = 0;
  else if (month > todayMonth) daysLeft = n;
  else daysLeft = n - Number(today.slice(8, 10)) + 1;
  const over = remaining < 0;
  const perDay = daysLeft > 0 && !over ? Math.floor(remaining / daysLeft) : 0;
  const byCategory = [...cat.entries()]
    .map(([category, amount]) => ({ category, amount, ratio: spent ? amount / spent : 0 }))
    .sort((a, b) => b.amount - a.amount);
  return { month, spent, income, remaining, over, budget, daysInMonth: n, daysLeft, perDay, byCategory, cumulative, count: inMonth.length };
}

// ---- 固定費 ----
export function applyRecurring(state, month) {
  if (!state.recurring || state.recurring.length === 0) return state;
  const n = daysInMonth(month);
  const have = new Set(state.tx.filter(t => t.recurringId && monthOf(t.date) === month).map(t => t.recurringId));
  const added = state.recurring
    .filter(r => !have.has(r.id))
    .map(r => ({
      id: newId(),
      type: r.type || 'expense',
      amount: r.amount,
      category: r.category,
      memo: r.name,
      date: `${month}-${pad(Math.min(Math.max(1, r.day || 1), n))}`,
      createdAt: Date.now(),
      recurringId: r.id,
    }));
  if (added.length === 0) return state;
  return { ...state, tx: [...state.tx, ...added] };
}

// ---- 表示・入出力 ----
export function formatYen(n) {
  const abs = Math.abs(Math.round(n)).toLocaleString('ja-JP');
  return (n < 0 ? '-¥' : '¥') + abs;
}

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const csvCell = v => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
export function toCSV(txs) {
  const rows = [['日付', '種別', '金額', '分類', 'メモ']];
  const sorted = [...txs].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const t of sorted) rows.push([t.date, t.type === 'income' ? '収入' : '支出', t.amount, t.category, t.memo || '']);
  return rows.map(r => r.map(csvCell).join(',')).join('\n');
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validTx = t => t && typeof t === 'object'
  && (t.type === 'expense' || t.type === 'income')
  && Number.isFinite(t.amount) && t.amount >= 0
  && typeof t.category === 'string'
  && typeof t.date === 'string' && DATE_RE.test(t.date);

export function parseImport(text) {
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || !Array.isArray(data.tx)) {
    throw new Error('財布の書き出しファイルではありません');
  }
  return {
    version: 1,
    budget: Number.isFinite(data.budget) && data.budget >= 0 ? Math.round(data.budget) : 100000,
    tx: data.tx.filter(validTx).map(t => ({
      id: typeof t.id === 'string' ? t.id : newId(),
      type: t.type,
      amount: Math.round(t.amount),
      category: t.category,
      memo: typeof t.memo === 'string' ? t.memo : '',
      date: t.date,
      createdAt: Number.isFinite(t.createdAt) ? t.createdAt : Date.now(),
      ...(typeof t.recurringId === 'string' ? { recurringId: t.recurringId } : {}),
    })),
    recurring: Array.isArray(data.recurring)
      ? data.recurring.filter(r => r && typeof r.name === 'string' && Number.isFinite(r.amount)).map(r => ({
        id: typeof r.id === 'string' ? r.id : newId(),
        name: r.name,
        amount: Math.round(r.amount),
        category: typeof r.category === 'string' ? r.category : 'その他',
        day: Number.isFinite(r.day) ? Math.min(31, Math.max(1, Math.round(r.day))) : 1,
        type: r.type === 'income' ? 'income' : 'expense',
      }))
      : [],
    learned: data.learned && typeof data.learned === 'object' && !Array.isArray(data.learned)
      ? Object.fromEntries(Object.entries(data.learned).filter(([k, v]) => typeof k === 'string' && typeof v === 'string'))
      : {},
  };
}
