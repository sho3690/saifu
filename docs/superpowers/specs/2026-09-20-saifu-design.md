# 財布 SAIFU — 設計メモ（2026-09-20）

## 目的
個人ひとりの金銭管理。iPhone のホーム画面から開いて、5秒で支出を記録し、「今月あといくら使えるか」を一目で知る。

## 方針
- 素の HTML / CSS / JS の PWA。ビルド不要。GitHub Pages（`sho3690/saifu`、main ブランチ直下）で公開。
- データは端末の localStorage（キー `saifu.v1`）だけ。外部送信なし・認証なし。リポジトリに個人データは入れない。
- 見た目は `~/.claude/design-system.md`（落ち着いた中立色＋控えめな青）。ダークモードは端末設定に追従。

## 画面
| 画面 | 役割 |
|---|---|
| 記録 | 金額 → メモ（分類を自動推定）→ 分類 → 日付 → 記録する。上部に「今月あと ¥…」の帯 |
| 今月 | 残額（最大の数字）、案内文「あと◯日、1日 ¥◯まで」、予算/支出/収入、ペース図、分類ごとの内訳、月送り |
| 履歴 | 月ごと・日ごとの一覧。検索。行を押すと編集シート（削除もここ） |
| 設定 | 月予算、固定費（毎月自動で計上）、書き出し（JSON/CSV）・読み込み・全削除、このアプリについて |

## データ
```
{ version: 1,
  budget: 100000,
  tx: [{ id, type: 'expense'|'income', amount, category, memo, date: 'YYYY-MM-DD', createdAt, recurringId? }],
  recurring: [{ id, name, amount, category, day, type }],
  learned: { '<メモを正規化した文字列>': '<分類>' } }
```

## ロジック（logic.js、純粋関数。test/ で検証）
- `todayKey(now)`: 一日の区切りは朝7時。0〜6時台は前日扱い。
- `inferCategory(memo, learned)`: 学習済み → キーワード辞書の順で分類と種別（収入語なら income）を推定。
- `summarize(txs, month, budget, today)`: 支出・収入・残額・残り日数・1日あたり・分類別・日別累計。
- `applyRecurring(state, month)`: 固定費を当月分だけ、まだ無ければ追加（冪等）。
- `formatYen`, `toCSV`, `parseImport`（読み込み時の検証）。

## 検品
- node --test でロジック。Playwright（node 直叩き）で 1280 幅と 390 幅、スクロール前後、ライト/ダークのスクショ。
- design-refine の contrast.py / lint.sh を clean にする。
