# aitext-check

日本語の文章（主に技術文章）を、ルールベースで校正する textlint の設定一式です。AI が意味を読んで直すツールではありません。辞書とルールを機械的に適用して、問題のある箇所を指摘します。

## チェックする内容

- **語彙**: 修正すべき語句を見つけて、推奨する語句を示します（prh の辞書 `prh-error.yml`）
- **書き方**: 文の長さや句点などを確かめます（`ja-technical-writing` のルール）。文書にだけ使います
- **気をつける語句**: 正しい使い方と誤った使い方の両方がある語句を見つけて、warning を出します（`prh-warn.yml`）。チェックは失敗扱いにしません
  - 書き言葉の技術文章に合わない書き方（口語、動詞の名詞化、冗長な言い回し）も、ここで見つけて書き言葉の候補を示します（`じゃない` → `ではない`、`確認を行う` → `確認する`）
  - 「A ではなく B」が 3 回以上ある節も、その節の見出しの行に出します（`bin/count-dewanaku.mjs`）
  - 動詞を名詞として使った箇所（「作り損ないを避ける」「引っかかりを出した」）も、形態素解析で見つけて出します（`bin/find-nominal.mjs`）。辞書に書いていない語も見つけます
  - 責任を避ける書き方も見つけます。決まった言い回しは辞書で、語の組み合わせや文書の形で出るものは `bin/find-avoidance.mjs` で見つけます
    - 根拠の無い判定: 「要件を満たした」「対応済み」
    - 確かめる人を書かない: 「確かめていない」「未確認」
    - 読む人に作業を渡す: 「ここからはあなたの作業です」
    - 指示のせいにする: 「指示どおり」
    - 自分の意図で、相手の受け取り方を否定する: 「嫌がらせではない」
    - 答えが決まっているのに選ばせる: 「作りますか？」
    - 全部出す: 「全部」「すべて」が「出す」「並べる」に係る文（「リポジトリを全部出した」）
    - 標準であることを理由にする: 「標準的なやり方なので」
    - 確かめていない見込みを根拠にする: 「はず」で終わる文
    - 確かめた範囲より広く判定する: 「確かめたので、要件は満たしています」
    - 全部並べる: 項目が 10 個以上の箇条書き
  - 確かめずに言い切る書き方（「トークンの期限は 366 日です」）は、言い回しに表れないので見つけられません

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
printf '%s' "$返答" | aitext-check --warn --reply -   # AI の返答を読む。「」の中は読まない
aitext-check --llm docs/spec.md      # ローカル LLM で読む（対象は必ず指定する）
```

`--reply` は、AI の返答を Claude Code のフックなどで確かめるときに使います。返答では、検出する語そのもの（「未確認」）を「」で引いて説明することが多いので、「」の中を読みません。文書では「」の中にも直すべき文が入るので、文書には使いません。

対象を省略すると、リポジトリの `.md` ファイルすべてをチェックします。

- git のリポジトリの中: git が管理しているファイル（`.gitignore` で除外したファイルは含まない）
- それ以外: カレントディレクトリより下のファイル（`node_modules` と、`.` で始まるディレクトリは除く）

チェックから外すファイルは、利用する側のリポジトリの `.textlintignore` に書きます。書き方のチェックだけから外すファイルは、`.textlintignore.prose` に書きます。

### プロジェクト固有の語句

製品名の表記のように、このパッケージの辞書に入れられない語句は、利用する側のリポジトリに prh の形式で置きます。同梱の辞書に足して読みます。

| ファイル | 足す先 | 重大度 |
|---|---|---|
| `aitext-words.yml` | 語彙 (`aitext-check`) | error |
| `aitext-words.warn.yml` | 気をつける語句 (`aitext-check --warn`) | warning |

```yaml
# aitext-words.warn.yml
version: 1
rules:
  - expected: Entra ID (旧称を指す文脈か、外部資料の引用でなければ Entra ID)
    pattern: Azure AD
    severity: warning
```

書き方のチェック (`--prose`) は語句の辞書を使わないので、足す先はありません。

## 辞書に語句を追加する

語句の一覧は、`words.md` の表にだけあります。表に 1 行追加してから、辞書を作り直します。`prh-*.yml` は手で編集しません。

```sh
node build-prh.mjs           # 辞書を作り直す
node build-prh.mjs --check   # 辞書が words.md と一致しているかだけを確かめる
```

文体を指摘する行（`words.md` の「文体を指摘する行」）を直したときは、試験も実行します。見落としていないこと、誤検出していないこと、「ではなく」を数えた結果が合うことを確かめます。

```sh
npm run test:style
```

## ファイル構成

- `words.md`: 語句の一覧（辞書の元データ）
- `prh-error.yml`、`prh-warn.yml`: `words.md` から作った prh の辞書
- `.textlintrc.yml`、`.textlintrc.prose.yml`、`.textlintrc.warn.yml`: textlint の設定
- `build-prh.mjs`: `words.md` から辞書を作るスクリプト
- `bin/cli.mjs`: 同梱の設定で textlint を実行する CLI
- `bin/count-dewanaku.mjs`: 「ではなく」を節ごとに数えるスクリプト（`--warn` が textlint の後に実行する）
- `bin/find-nominal.mjs`: 動詞を名詞として使った箇所を、形態素解析で見つけるスクリプト（`--warn` が textlint の後に実行する）
- `bin/find-avoidance.mjs`: 責任を避ける書き方を、文の組み立てと箇条書きの長さから見つけるスクリプト（`--warn` が textlint の後に実行する）
- `test/`: 気をつける語句のうち文体を指摘する行の試験（`npm run test:style`）
- `bin/llm.mjs`、`llm/prompt.md`: ローカル LLM で読むモードと、その指示文
- `llm.md`: ローカル LLM で読むモードの使い方と、指示の決め方の根拠

ルールの本体（textlint、prh、ja-technical-writing）は npm の依存パッケージです。このリポジトリには含めていません。
