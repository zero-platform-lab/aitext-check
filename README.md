# aitext-check

日本語の文章（主に技術文章）を、ルールベースで校正する textlint の設定一式です。AI が意味を読んで直すツールではありません。辞書とルールを機械的に適用して、問題のある箇所を指摘します。

## チェックする内容

- **語彙**: 修正すべき語句を見つけて、推奨する語句を示します（prh の辞書 `prh-error.yml`）
- **書き方**: 文の長さや句点などを確かめます（`ja-technical-writing` のルール）。文書にだけ使います
- **気をつける語句**: 正しい使い方と誤った使い方の両方がある語句を見つけて、warning を出します（`prh-warn.yml`）。チェックは失敗扱いにしません
  - 書き言葉の技術文章に合わない書き方（口語、動詞の名詞化、冗長な言い回し）も、ここで見つけて書き言葉の候補を示します（`じゃない` → `ではない`、`確認を行う` → `確認する`）
  - 「A ではなく B」が 3 回以上ある節も、その節の見出しの行に警告を出します（`bin/count-dewanaku.mjs`）
  - 体言止めの文（「両方リリース完了。」）が 3 個以上ある節も、その節の見出しの行に警告を出します（`bin/count-taigen.mjs`）。「こと。」「次のとおり。」と、「。」で終わらない箇条書きの行は数えません
  - 動詞を名詞として使った箇所（「作り損ないを避ける」「引っかかりを出した」）も、形態素解析で見つけて出します（`bin/find-nominal.mjs`）。辞書に書いていない語も見つけます
  - 数値やデータの扱いを口語の動詞で書いた箇所（「割合を出した」「本文を取らない」「データから作りました」「作品が混ざる」）も、形態素解析で見つけて「算出する」「取得する」「作成する」「含まれる」を示します（`bin/find-colloquial.mjs`）。動詞を基本形で見るので、辞書では見つけられない活用した形（「取った」「取らない」）も見つけます。「キーを作る」「警告を出す」のような正しい文に当てないように、動詞と同じ節に数値やデータを表す名詞があるときだけ出します
  - 意味の広い英語の動詞を日本語の広い動詞に直訳した箇所（「ロックを取って」「設定を変えたら」「関数を呼んで」）も、日本語版 Wikipedia での件数を比べて見つけ、定着した動詞（「取得する」「変更する」「呼び出す」）を示します（`bin/find-confusion.mjs`）。手元でコーパスの DB を作成したときだけ動きます（[コーパスの DB を作成する](#コーパスの-db-を作成する)）
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

`--reply` のときは、番号を振らずに 2 つ以上の質問をしている箇所にも warning を出します（`bin/find-questions.mjs`）。返答を確かめる Claude Code のフックは、責任を避ける書き方、動詞を名詞にした語、番号の無い質問、比喩の語（`words.md` の「返答でも止める比喩の語」）、口語の動詞で書いた数値やデータの扱いの警告で返答を止めます。番号があれば、読む人は「1 はこう、2 はこう」と番号で返事ができます。

対象を省略すると、リポジトリの `.md` ファイルすべてをチェックします。

- git のリポジトリの中: git が管理しているファイル（`.gitignore` で除外したファイルは含まない）
- それ以外: カレントディレクトリより下のファイル（`node_modules` と、`.` で始まるディレクトリは除く）

チェックから外すファイルは、利用する側のリポジトリの `.textlintignore` に書きます。書き方のチェックだけから外すファイルは、`.textlintignore.prose` に書きます。

### プロジェクト固有の語句

製品名の表記のように、このパッケージの辞書に入れられない語句は、利用する側のリポジトリに prh の形式で置きます。同梱の辞書に追加して読み込みます。

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

## コーパスの DB を作成する

`bin/find-confusion.mjs` は、書いた「名詞＋助詞＋動詞」の件数を、同じ名詞と助詞の定着した動詞の件数と比べます。比べる動詞の組は `corpus/confusion.md` の表にあり、件数は日本語版 Wikipedia から数えます。件数の DB はリポジトリに入れないので、使う人が手元で作成します。DB が無いときは、この点検だけを飛ばします。

DB を作成するには、Node 22.13 以降（`node:sqlite` を使うため）、`bzcat`、ディスクの空き 10 GB ほど（ダンプの 4.7 GB と、取り出した本文の 4 GB）が要ります。

```sh
curl -LO https://dumps.wikimedia.org/jawiki/latest/jawiki-latest-pages-articles.xml.bz2
node corpus/build.mjs jawiki-latest-pages-articles.xml.bz2
```

DB は `~/.cache/aitext-check/corpus.db` に保存します。別の場所に置くときは、環境変数 `AITEXT_CORPUS_DB` で指定します。8 コアの機械では、記事の地の文の取り出しに約 13 分、件数の集計に約 18 分かかりました。`corpus/confusion.md` の表を直したら、DB を作成し直します。

Wikipedia の本文は CC BY-SA 4.0 と GFDL で公開されています。DB に入るのは組の件数だけです。このリポジトリは、DB も取り出した本文も配布しません。

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
- `build-prh.mjs`: `words.md` から辞書を作成するスクリプト
- `bin/cli.mjs`: 同梱の設定で textlint を実行する CLI
- `bin/count-dewanaku.mjs`: 「ではなく」を節ごとに数えるスクリプト（`--warn` が textlint の後に実行する）
- `bin/count-taigen.mjs`: 体言止めの文を、形態素解析で節ごとに数えるスクリプト（`--warn` が textlint の後に実行する）
- `bin/find-nominal.mjs`: 動詞を名詞として使った箇所を、形態素解析で見つけるスクリプト（`--warn` が textlint の後に実行する）
- `bin/find-avoidance.mjs`: 責任を避ける書き方を、文の組み立てと箇条書きの長さから見つけるスクリプト（`--warn` が textlint の後に実行する）
- `bin/find-colloquial.mjs`: 数値やデータの扱いを口語の動詞で書いた箇所を、形態素解析で見つけるスクリプト（`--warn` が textlint の後に実行する）
- `bin/find-questions.mjs`: 返答の中で、番号を振らずに 2 つ以上の質問をしている箇所を見つけるスクリプト（`--warn --reply` が textlint の後に実行する）
- `test/`: 気をつける語句のうち文体を指摘する行の試験（`npm run test:style`）
- `bin/llm.mjs`、`llm/prompt.md`: ローカル LLM で読むモードと、その指示文
- `llm.md`: ローカル LLM で読むモードの使い方と、指示の決め方の根拠

ルールの本体（textlint、prh、ja-technical-writing）は npm の依存パッケージです。このリポジトリには含めていません。
