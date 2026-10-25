#!/usr/bin/env node
// 動詞を名詞として使った箇所を、形態素解析（kuromoji）で見つける。
//
// 「漏れを言われない」「作り損ないを避ける」「引っかかりを出した」のように、動詞の
// 連用形をそのまま名詞にして助詞を付けた書き方を指す。words.md の決まりごと 1a の
// 「動詞を短く名詞にして語句を作らない」を、辞書に無い語にも広げる。
// 辞書（prh）は語を 1 つずつ書くので、書いていない語は見つけられない。
//
//   node bin/find-nominal.mjs <file.md>...
//
// 見つけるのは、kuromoji が「動詞・自立・連用形」とした語の直後に、名詞に付く助詞
// （を・が・の・は・も・へ・と・で・に・や・から・まで）か句点が来る箇所。
// kuromoji の辞書が名詞として持っている語（「漏れ」「置き場」「見張り」）は当たらない。
// それらは words.md の表で個別に指摘する。
//
// 動詞として正しい次の形は外す。
//   - 「見に行く」「取りに来る」: 連用形 + に + 行く・来る（目的）
//   - 「読みもしない」「書きはする」: 連用形 + も・は + する
//
// aitext-check --warn が、textlint の後に実行する。count-dewanaku.mjs と同じく、
// 警告を出すだけで、終了コードは常に 0（チェックを失敗扱いにしない）。
// コードの中（`...`）とコードブロックは見ない。Markdown の解析器が Str として渡さないため。
// <!-- textlint-disable --> の範囲も見ない。words.md のように、例を並べた表を外すため。
import { readFileSync, existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { parse } from "@textlint/markdown-to-ast"
import { tokenize } from "kuromojin"

const PARTICLE = new Set(["を", "が", "の", "は", "も", "へ", "と", "で", "に", "や", "から", "まで"])

const isVerbStem = (t) => t.pos === "動詞" && t.pos_detail_1 === "自立" && t.conjugated_form === "連用形"
const isStemLike = (t) => t.pos === "名詞" && ["一般", "接尾"].includes(t.pos_detail_1) && /^[一-龠々]+[いきぎしじちにひびみりえけげせぜてでねべめれ]$/.test(t.surface_form)

// 動詞から作った名詞のうち、辞書にあり、名詞として定着している語。当たっても外す
const ESTABLISHED = new Set([
	"終わり", "始まり", "違い", "流れ", "動き", "働き", "争い", "疑い", "誤り", "残り", "答え", "考え", "教え", "支払い", "取り扱い", "問い合わせ", "書き込み", "読み込み", "組み合わせ", "見積もり", "申し込み", "手続き", "割り当て", "受け付け", "引き継ぎ", "振る舞い", "使い", "代わり", "集まり", "決まり", "生まれ", "晴れ", "遅れ", "揺れ", "ずれ", "ぶれ",
	// 技術文書で定着している語
	"並べ替え", "置き換え", "書き換え", "埋め込み", "立ち上げ", "係り受け", "待ち受け", "読み上げ", "切り戻し", "切り替え", "なりすまし", "抜け漏れ", "住み分け", "棲み分け",
	"任せ", "越し", "あり", "なし", "おわり", "ふるまい", "ねらい", "つまずき", "重なり", "収まり", "ゆれ",
])

// 木をたどり、文字列と HTML のコメントを出てきた順に返す
function* walk(node) {
	if (node.type === "Str" || node.type === "Html") yield node
	for (const c of node.children || []) yield* walk(c)
}

async function find(text) {
	const found = []
	let disabled = false
	for (const n of walk(parse(text))) {
		if (n.type === "Html") {
			if (/textlint-disable(?!-)/.test(n.value)) disabled = true
			if (/textlint-enable/.test(n.value)) disabled = false
			continue
		}
		if (disabled) continue
		const tokens = await tokenize(n.value)
		for (let i = 0; i < tokens.length; i++) {
			// 語の範囲: 動詞の連用形か、それに見える名詞（漢字の後に「み」「し」「え」などの仮名）が
			// 続く間。kuromoji は「読み返し」を「読み（名詞）+ 返し（接尾）」に、「読み違え」を
			// 「読み（動詞）+ 違え（動詞）」に分けるので、どちらも 1 語として扱う
			let j = i
			while (j < tokens.length && (isVerbStem(tokens[j]) || isStemLike(tokens[j]))) j++
			if (j === i) continue
			const run = tokens.slice(i, j)
			const start = i
			i = j - 1
			// 直前が名詞なら、名詞の後ろに付いた語（「初見」「裏取り」「リージョン越え」「勢い任せ」）なので外す
			const prev = tokens[start - 1]
			if (prev && prev.pos === "名詞" && prev.pos_detail_1 !== "代名詞") continue
			// 直前が漢字・英数字・空白・閉じ括弧でも、名詞の後ろに付いた語（「直置き」「ARO 任せ」「SSH 越し」）として外す
			if (prev && /[一-龠々A-Za-z0-9 )）]$/.test(prev.surface_form)) continue
			// 1 文字の語（「見」「し」）は、ほとんどが kuromoji の切り誤りなので外す
			if (run.length === 1 && run[0].surface_form.length === 1) continue
			// 動詞が 1 つも無く、名詞 1 つだけなら、辞書にある名詞（「漏れ」「取り違え」）なので外す
			if (!run.some(isVerbStem) && run.length < 2) continue
			const word = run.map((t) => t.surface_form).join("")
			if (ESTABLISHED.has(word)) continue
			const next = tokens[j]
			const after = tokens[j + 1]
			const isParticle = next && next.pos === "助詞" && PARTICLE.has(next.surface_form)
			const isEnd = next && next.surface_form === "。"
			if (!isParticle && !isEnd) continue
			if (next.surface_form === "に" && after && ["行く", "来る"].includes(after.basic_form)) continue
			if (["も", "は"].includes(next.surface_form) && after && after.basic_form === "する") continue
			const offset = tokens[start].word_position - 1
			const line = n.loc.start.line + (n.value.slice(0, offset).match(/\n/g) || []).length
			const lastNl = n.value.lastIndexOf("\n", offset - 1)
			const column = lastNl === -1 ? n.loc.start.column + offset + 1 : offset - lastNl
			found.push({ line, column, word, particle: next.surface_form })
		}
	}
	return found
}

let total = 0
for (const file of process.argv.slice(2).filter((f) => f.endsWith(".md") && existsSync(f))) {
	const found = await find(readFileSync(file, "utf8"))
	if (!found.length) continue
	// 標準入力から読み込んだ文は、一時ファイルの名前ではなく textlint と同じ名前で出す
	const shown = path.resolve(file).startsWith(os.tmpdir()) ? path.basename(file) : file
	console.log(`\n${shown}`)
	for (const f of found) {
		console.log(`  ${f.line}:${f.column}  warning  「${f.word}${f.particle}」: 動詞を名詞として使っていないか確認。動詞のまま文にするか（「見落としが無い」→「見落としていない」）、定着した語にする  verb-as-noun`)
	}
	total += found.length
}
if (total) console.log(`\n✖ 動詞を名詞として使った箇所が ${total} 個（warning。失敗扱いにしない）\n`)
