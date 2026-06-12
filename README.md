# TCK Reps for SAT (Demo)

TCK Reps シリーズの SAT 版。Digital SAT® Reading & Writing 形式の演習を提供する静的 Web アプリ。

- デプロイ: GitHub Pages(ビルドステップなし)
- 認証/成績ログ: TCK Workshop 共通の GAS バックエンド(`tck_demo_user` セッションを TOEFL Reps Demo と共有)
- 出題: `data/*.json` の問題バンクを 1 モジュール = 27 問 / 32 分で動的レンダリング
- 受験ツール: ハイライト(3色)+メモ / 1行集中 / タイマー非表示 / 選択肢消去 / フラグ / 問題ナビゲータ / 文字サイズ / 最終チェック画面 — 状態はすべて復元可能
- スコアリング: raw / % を表示。スケールスコアは `config.js` の `rawToScaled` テーブルが設定されているときのみ(捏造しない)

## ローカル確認

```
npx http-server -p 8080 -c-1
# → http://localhost:8080
```

## ディレクトリ

```
/index.html                    # ランディング
/login.html                    # ログイン/サインアップ(規約同意つき)
/menu.html                     # モジュール選択
/privacy.html, /terms.html     # プライバシーポリシー / 利用規約
/sat/test1.html                # Full Test 1 — Module 1(演習)
/sat/test1-results.html        #   └ 結果 + Review
/sat/test1-m2.html             # Full Test 1 — Module 2(演習)
/sat/test1-m2-results.html     #   └ 結果 + Review
/sat/app.js                    # 演習エンジン(状態機械 + 受験ツール)
/sat/results.js                # 結果レンダラ
/sat/style.css                 # 演習画面 CSS
/data/test1.json               # Module 1 バンク(27問)
/data/test1-m2.json            # Module 2 バンク(27問)
/scripts/verify_bank.js        # バンクの機械検証(レター配分・語数・DUP 等)
/config.js                     # 閾値、rawToScaled、表示設定
/css/common.css                # TCK Workshop 共通デザイントークン
/js/auth.js, /js/api.js        # TCK Reps と共有
```

## 問題バンク

スキーマと作問規則は `sat-english-practice-app` skill(v2)と「SAT R&W Full-Test Generation Prompt v3.0」を正とする。バンク追加時は必ず:

```
node scripts/verify_bank.js data/<bank>.json   # RESULT: PASS になるまで修正
```

## クレジット

SAT® is a registered trademark of the College Board, which is not affiliated with and does not endorse this product.
