# aitext-check

AI が書いた日本語の文章を、規則ベースで校正する textlint 一式です。意味を読む AI 校正ではありません。辞書と規則で機械的に適用します。

## 何を見るか

- **語彙**: prh の辞書（`prh-error.yml`）で、避けたい語を推奨語へ。既定の対象は `docs` と `README.md`。
- **書き方**: `ja-technical-writing` の規則（文の長さ・句点など）。文書だけに適用する。
- **気をつける語**: 正しい使い方もある語（`prh-warn.yml`）。止めずに warning を出す。

指摘するだけで直しません（`--fix` は持たない）。直すのは書き手です。

## 使い方

依存として入れて、スクリプトから呼びます。

```jsonc
// package.json
"devDependencies": {
  "aitext-check": "github:zero-platform-lab/aitext-check"
},
"scripts": {
  "lint:ja": "aitext-check docs README.md",
  "lint:ja:prose": "aitext-check --prose docs"
}
```

```sh
aitext-check docs README.md          # 語彙
aitext-check --prose docs            # 書き方
aitext-check --warn docs README.md   # 気をつける語
printf '%s' "$文" | aitext-check --prose -   # 標準入力を流し込む
```

対象を省くと `docs` と `README.md` を見ます。書き方の対象から外す file は、利用側 repo の `.textlintignore.prose` に並べます。

## 辞書に語を足す

語の一覧は `words.md` の表だけにあります。表に 1 行足してから、辞書を作り直します。手で `prh-*.yml` を直しません。

```sh
node build-prh.mjs           # 作り直す
node build-prh.mjs --check   # いまの file と同じかだけ見る
```

## 中身

- `words.md` — 語の一覧（辞書の出所）。
- `prh-error.yml` / `prh-warn.yml` — `words.md` から作った prh の辞書。
- `.textlintrc.yml` / `.textlintrc.prose.yml` / `.textlintrc.warn.yml` — textlint の設定。
- `build-prh.mjs` — `words.md` から辞書を作る。
- `bin/cli.mjs` — 内包の設定で textlint を回す CLI。

規則そのもの（textlint 本体・prh・ja-technical-writing）は npm の依存です。ここには複製していません。
