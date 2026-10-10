# aitext-check

日本語の文章（主に技術文章）を、ルールベースで校正する textlint の設定一式です。AI が意味を読んで直すツールではありません。辞書とルールを機械的に適用して、問題のある箇所を指摘します。

## チェックする内容

- **語彙**: 修正すべき語句を見つけて、推奨する語句を示します（prh の辞書 `prh-error.yml`）
- **書き方**: 文の長さや句点などを確かめます（`ja-technical-writing` のルール）。文書にだけ使います
- **気をつける語句**: 正しい使い方と誤った使い方の両方がある語句を見つけて、warning を出します（`prh-warn.yml`）。チェックは失敗扱いにしません

指摘するだけで、自動では直しません（`--fix` には対応していません）。直すのは書き手です。

語彙と書き方のチェックの後に、ローカル LLM（Ollama）に文書を読ませるモードもあります（`--llm`）。主語のねじれや、1 つの文に多すぎる情報のような、ルールでは見つけにくい問題を指摘させます。詳しくは [llm.md](llm.md) を見てください。

## 使い方

利用する側のリポジトリの `package.json` で、aitext-check を devDependencies に追加し、npm scripts から呼び出します。

```jsonc
// package.json
"devDependencies": {
  "aitext-check": "github:zero-platform-lab/aitext-check"
},
"scripts": {
  "lint:ja": "aitext-check",
  "lint:ja:prose": "aitext-check --prose",
  "lint:ja:warn": "aitext-check --warn"
}
```

```sh
aitext-check                         # 語彙（リポジトリの .md すべて）
aitext-check docs README.md          # 語彙（対象を指定する）
aitext-check --prose                 # 書き方
aitext-check --warn                  # 気をつける語句
printf '%s' "$文" | aitext-check --prose -   # 標準入力から読み込む
aitext-check --llm docs/spec.md      # ローカル LLM で読む（対象は必ず指定する）
```

対象を省略すると、リポジトリの `.md` ファイルすべてをチェックします。

- git のリポジトリの中: git が管理しているファイル（`.gitignore` で除外したファイルは含まない）
- それ以外: カレントディレクトリより下のファイル（`node_modules` と、`.` で始まるディレクトリは除く）

チェックから外すファイルは、利用する側のリポジトリの `.textlintignore` に書きます。書き方のチェックだけから外すファイルは、`.textlintignore.prose` に書きます。

## 辞書に語句を追加する

語句の一覧は、`words.md` の表にだけあります。表に 1 行追加してから、辞書を作り直します。`prh-*.yml` は手で編集しません。

```sh
node build-prh.mjs           # 辞書を作り直す
node build-prh.mjs --check   # 辞書が words.md と一致しているかだけを確かめる
```

## ファイル構成

- `words.md`: 語句の一覧（辞書の元データ）
- `prh-error.yml`、`prh-warn.yml`: `words.md` から作った prh の辞書
- `.textlintrc.yml`、`.textlintrc.prose.yml`、`.textlintrc.warn.yml`: textlint の設定
- `build-prh.mjs`: `words.md` から辞書を作るスクリプト
- `bin/cli.mjs`: 同梱の設定で textlint を実行する CLI
- `bin/llm.mjs`、`llm/prompt.md`: ローカル LLM で読むモードと、その指示文
- `llm.md`: ローカル LLM で読むモードの使い方と、指示の決め方の根拠

ルールの本体（textlint、prh、ja-technical-writing）は npm の依存パッケージです。このリポジトリには含めていません。
