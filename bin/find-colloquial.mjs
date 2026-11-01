#!/usr/bin/env node
// 取得・算出・作成などを口語の動詞で書いた箇所を、形態素解析（kuromoji）で見つける。
//
// 「割合を出した」「本文を取らない」「ロックを取って」「データから作りました」「作品が混ざる」のように、
// 集計や取得の説明を口語の動詞で書くと、説明文の中で文体が揺れる。書き言葉の
// 「算出する」「取得する」「作成する」「含まれる」にする。
//
// 動詞は基本形で見るので、「出した」「取らない」「作りました」のどれにも警告を出す。
// words.md の辞書（prh）は表記で見るので、「取る」には警告を出しても「取った」「取らない」には出さない。
//
// 動詞だけでは警告を出さない。「キーを作る」「警告を出す」「責任を取る」は正しい。動詞と同じ節に、
// 下の RULES の名詞があり、その名詞のすぐ後が助詞（を・が・は・も・と・から）のときだけ警告を出す。
// 「データのディレクトリを作り」のように、名詞が別の名詞を修飾しているときは出さない。
// 節は、読点以外の記号と、自立した動詞・形容詞で区切る。
//
// 2026-10-30 に、手元の Markdown 958 ファイルに実行して絞った。動詞だけで警告を出すと 9,215 件、
// 名詞を数値やデータに限っても 213 件で、多くは「値を作る」（Rust の説明）のような正しい文だった。
// 組み合わせを下の RULES に絞ると 26 件になり、そのうち 19 件は「合計を出す」「ログを取る」のように
// 直してよい文だった。残りの 7 件は、名詞が修飾語だった 5 件と小説の設定メモの 2 件で、
// 修飾語の 5 件は「名詞のすぐ後が助詞」の条件で外した。
// その後、作者の指摘で「ロック」「トークン」「設定」「許可」「一覧」「スナップショット」「鍵」を取る形を加えた。
// どれも「取得する」が定着した用語である。「責任を取る」「0 から 1 の値を取る」は正しいので加えない。
//
//   node bin/find-colloquial.mjs <file.md>...
//
// aitext-check --warn が、textlint の後に実行する。count-dewanaku.mjs と同じく、
// 警告を出すだけで、終了コードは常に 0（チェックを失敗扱いにしない）。
// コードの中（`...`）とコードブロックは見ない。<!-- textlint-disable --> の範囲も見ない。
import { readFileSync, existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { parse } from "@textlint/markdown-to-ast"
import { tokenize } from "kuromojin"

const RULES = [
	{ verb: ["出す"], noun: ["割合", "比率", "率", "平均", "中央値", "合計", "相関", "分散", "偏差", "件数", "数", "差", "指標", "統計", "最大", "最小", "最大値", "最小値"], to: "算出する" },
	// 「取る」の終止形は words.md の辞書が警告を出すので、ここでは活用した形（取った・取らない）だけを見る
	{ verb: ["取る"], noun: ["データ", "情報", "本文", "統計", "ログ", "記録", "ロック", "トークン", "設定", "許可", "一覧", "スナップショット", "鍵"], to: "取得する", skip: "取る" },
	// 「データを作る」はテストの見本などで正しく使うので、元にしたデータを示す「から」の形だけを見る
	{ verb: ["作る"], noun: ["データ", "集計", "統計"], to: "作成する", after: ["から"] },
	{ verb: ["混ざる", "混じる"], noun: ["作品", "データ", "値", "件数", "記録"], to: "含まれる" },
]
const AFTER_NOUN = new Set(["を", "が", "は", "も", "と", "から"])

// 続いた名詞（kuromoji は「トークン」を「トーク」「ン」に、「誤差率」を「誤差」「率」に分ける）をつないで、
// RULES の名詞で終わるかを見る。1 字の名詞（数・差・率）は、最後の語がその字だけのときに限る。
// 「関数」「変数」は 1 語なので、「数」では終わっても警告を出さない
function endsWithNoun(chunk, nouns) {
	const s = chunk.map((u) => u.surface_form).join("")
	return nouns.some((w) => s.endsWith(w) && (w.length > 1 || chunk.at(-1).surface_form === w))
}

// 2 つの口語の動詞を並べた形。名詞を問わず警告を出す
const PAIRS = [{ re: /足したり消したり|消したり足したり/, to: "追加・削除する" }]

function* walk(node) {
	if (node.type === "Html" || node.type === "Paragraph" || node.type === "Header") yield node
	if (node.type === "Paragraph" || node.type === "Header") return
	for (const c of node.children || []) yield* walk(c)
}
function textOf(node) {
	if (node.type === "Str") return node.value
	if (node.type === "Code") return "＿".repeat(node.value.length + 2)
	return (node.children || []).map(textOf).join("")
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
		const para = textOf(n)
		let offset = 0
		for (const sentence of para.split(/(?<=[。！？?])/)) {
			const line = n.loc.start.line + (para.slice(0, offset).match(/\n/g) || []).length
			offset += sentence.length
			for (const p of PAIRS) {
				const m = sentence.match(p.re)
				if (m) found.push({ line, word: m[0], to: p.to })
			}
			const tokens = await tokenize(sentence)
			let start = 0
			tokens.forEach((t, i) => {
				// 「割合を、四半期ごとに出した」のように、目的語と動詞の間に読点が入ることがあるので、読点では区切らない
				if (t.pos === "記号" && t.surface_form !== "、") start = i + 1
				// 「データは無く、休みを取った」のように、形容詞でも節が切れる
				if (t.pos === "形容詞" && t.pos_detail_1 === "自立") start = i + 1
				if (t.pos !== "動詞") return
				const rule = RULES.find((r) => r.verb.includes(t.basic_form))
				if (rule && t.surface_form !== rule.skip) {
					// 動詞に近い名詞から探す。名詞のすぐ後が助詞のときだけ見る
					const after = new Set(rule.after ?? AFTER_NOUN)
					for (let j = i - 1; j >= start; j--) {
						if (tokens[j].pos !== "名詞" || !after.has(tokens[j + 1]?.surface_form)) continue
						let k = j
						while (k > start && tokens[k - 1].pos === "名詞") k--
						if (!endsWithNoun(tokens.slice(k, j + 1), rule.noun)) continue
						found.push({ line, word: tokens.slice(k, i + 1).map((u) => u.surface_form).join(""), to: rule.to })
						break
					}
				}
				if (t.pos_detail_1 === "自立") start = i + 1
			})
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
	for (const f of found) console.log(`  ${f.line}:1  warning  「${f.word}」: 書き方: 口語。説明文では、書き言葉の「${f.to}」にする  colloquial-verb`)
	total += found.length
}
if (total) console.log(`\n✖ 取得・算出などを口語の動詞で書いた箇所が ${total} 個（warning。失敗扱いにしない）\n`)
