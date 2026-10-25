#!/usr/bin/env node
// 責任を避ける書き方のうち、1 語では見つけられないものを、文の組み立てから見つける。
//
// 「確かめていない」「作りますか？」のように言い回しが決まっているものは、words.md の
// 気をつける語句（「書き方: 責任回避。」の行）で見つける。ここで見るのは、語と語の
// 組み合わせや文書の形で出るもの。
//
//   全部出す     「全部」「すべて」と「出す」「並べる」「載せる」が同じ文にある
//                （「読めるリポジトリを全部出した」）。読む人が使う物に絞ったか
//   標準を理由   「標準」「一般的」「定番」などを、「ので」「ため」で理由にしている
//                （「標準的なやり方なので」）。読む人の手間と比べたか
//   はず         「はず」で終わる文（「問題は起きにくいはずです」）。確かめていない見込みを
//                根拠のように書いていないか
//   狭い確認     「確かめた」「通った」「開く」の後に「ので」「から」が続き、同じ文で
//                「満たす」「問題ない」「動く」と判定している（「ページが開くことも
//                確かめたので、要件は満たしています」）。確かめた範囲で言える判定か
//   長い一覧     項目が 10 個以上の箇条書き（手順を 11 個並べた）。全部並べていないか
//
// 動詞は kuromoji の基本形で見るので、「出した」「出しています」「並べました」のどれにも当たる。
//
// 2026-10-25 に、手元の Markdown 308 ファイルに流して絞った。最初は「すべての文書」（名詞の修飾）、
// 「標準出力なので」「標準で入っている」、「でしか動かないので」が当たり、合わせて 200 件ほど出た。
// 絞った後は、全部出す 7、標準を理由 3、はず 3、狭い確認 0、長い一覧 60 件。長い一覧は、用語集や
// 要件の一覧のように正しく長いものも当たる。8 項目では 121 件出たので、10 項目からにした。
//
//   node bin/find-avoidance.mjs <file.md>...
//
// aitext-check --warn が、textlint の後に実行する。count-dewanaku.mjs と同じく、
// 警告を出すだけで、終了コードは常に 0（チェックを失敗扱いにしない）。
// コードの中（`...`）とコードブロックは見ない。<!-- textlint-disable --> の範囲も見ない。
import { readFileSync, existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { parse } from "@textlint/markdown-to-ast"
import { tokenize } from "kuromojin"

const MAX_LIST = 9

const ALL = new Set(["全部", "すべて", "全て", "あらゆる", "残らず", "もれなく", "漏れなく"])
const SHOW = new Set(["出す", "並べる", "載せる", "入れる", "含める", "表示", "列挙", "渡す", "書く", "挙げる"])
// 「標準」などのすぐ後（読点をはさまず 10 字以内）に理由の接続が来るときだけ。「標準で入っている」「非推奨」は当たらない
const STANDARD_REASON = /(?<!非)(標準(?!出力|入力|エラー|ライブラリ)|一般的|定番|よくある|推奨|ベストプラクティス|慣例|王道)[^、。]{0,10}?(なので|なため|だから|ですから|ので|ため)/
const CHECKED = new Set(["確かめる", "確認", "試す", "通る"])
const VERDICT = /(満た|問題(は|が)?(な|あり)|大丈夫|動[きく]|正常|完了|でき(る|ます)|正し)/

const MESSAGE = {
	all: "書き方: 責任回避。漏れを言われないように、全部を出していないか確認。読む人が使う物に絞り、絞った基準を書く",
	standard: "書き方: 責任回避。標準や一般的なやり方であることを、理由にしていないか確認。読む人の手間（操作の回数など）と比べて選んだかを書く",
	hazu: "書き方: 責任回避。確かめていない見込みを、根拠のように書いていないか確認。確かめてから書くか、誰がいつ確かめるかを書く",
	narrow: "書き方: 責任回避。確かめた範囲より広い判定をしていないか確認。確かめたことと、そこから言えることを分けて書く",
	list: (n) => `書き方: 責任回避。箇条書きが ${n} 項目ある。漏れを言われないように、全部並べていないか確認。読む人が実際に使う項目に絞る`,
}

// 段落と箇条書きを、出てきた順に返す。段落の文は、インラインのコードを除いてつなぐ
function* walk(node) {
	if (node.type === "Html" || node.type === "Paragraph" || node.type === "List") yield node
	if (node.type === "Paragraph") return
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
		if (n.type === "List") {
			if (n.children.length > MAX_LIST) found.push({ line: n.loc.start.line, rule: "list", message: MESSAGE.list(n.children.length) })
			continue
		}
		const para = textOf(n)
		let offset = 0
		for (const sentence of para.split(/(?<=[。！？?])/)) {
			const line = n.loc.start.line + (para.slice(0, offset).match(/\n/g) || []).length
			offset += sentence.length
			const tokens = await tokenize(sentence)
			const hit = (rule) => found.push({ line, rule, message: MESSAGE[rule], sentence: sentence.trim() })

			// 「全部」が名詞を修飾する「すべての文書」は外し、動詞に係る「全部出した」「すべて並べる」だけを見る。
			// 「全部出すと、選ぶ手間が増える」のような仮定（動詞の後に「と」「ば」「たら」）は、した事ではないので外す
			const ai = tokens.findIndex((t, i) => ALL.has(t.surface_form) && tokens[i + 1]?.surface_form !== "の")
			if (ai !== -1) {
				const vi = tokens.findIndex((t, i) => i > ai && !["を", "は", "も", "、"].includes(t.surface_form))
				const after = tokens.slice(vi + 1, vi + 3).map((t) => t.surface_form).join("")
				if (vi !== -1 && SHOW.has(tokens[vi].basic_form) && !/^(と|ば|ても|たら|だら)/.test(after)) hit("all")
			}
			if (STANDARD_REASON.test(sentence)) hit("standard")
			if (/はず(です|だ|である)?[。！？]?\s*$/.test(sentence.trim())) hit("hazu")
			// 確かめた語の後に理由の接続（ので・から・ため）があり、その後ろに判定がある
			const ci = tokens.findIndex((t) => CHECKED.has(t.basic_form))
			if (ci !== -1) {
				const rest = tokens.slice(ci + 1)
				// 確かめた語のすぐ後（6 語以内）に理由の接続が来るときだけ
				const ri = rest.slice(0, 6).findIndex((t) => ["ので", "から", "ため"].includes(t.surface_form) || (t.surface_form === "で" && rest[rest.indexOf(t) - 1]?.surface_form === "の"))
				if (ri !== -1 && VERDICT.test(rest.slice(ri + 1).map((t) => t.surface_form).join(""))) hit("narrow")
			}
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
		const quote = f.sentence ? `「${f.sentence.length > 40 ? f.sentence.slice(0, 40) + "…" : f.sentence}」: ` : ""
		console.log(`  ${f.line}:1  warning  ${quote}${f.message}  avoidance-${f.rule}`)
	}
	total += found.length
}
if (total) console.log(`\n✖ 責任を避ける書き方の疑いが ${total} 個（warning。失敗扱いにしない）\n`)
