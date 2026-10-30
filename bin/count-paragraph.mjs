#!/usr/bin/env node
// 文の数が多すぎる段落を見つける。
//
// 1 つの段落に、対象・算出の方法・欠測値・期間の注意のように、いくつもの論点を詰めると、
// 読む人はどこで話が変わったのかを自分で探すことになる。論点ごとに段落を分ける
// （1 段落に 1 つの論点を置く、パラグラフ・ライティングの考え方）。
// 上限を超えた段落を、その段落の最初の行で警告する。
//
//   node bin/count-paragraph.mjs [--max N] <file.md>...   既定の N は 6（7 文以上で警告）
//
// 文の区切り方は count-taigen.mjs と同じ。括弧と「」の中の「。」では区切らない。
// 「。」で終わらない最後の文も 1 文と数える。
//
// 2026-10-30 に、手元の Markdown 958 ファイルの、日本語を含む段落 31,700 個で数えた。
// 1〜3 文が 1 万 8 千個で大半を占め、7 文以上は約 290 個（1% ほど）だった。7 文以上の段落の多くは、
// RUNBOOK の注意書き（20 文以上）のように、いくつもの論点を 1 段落に詰めていた。
// 作者が「改行が無くて長すぎる」と直した narou-analysis のグラフの注は、1 段落 13 文だった。
//
// aitext-check --warn が、textlint の後に実行する。count-dewanaku.mjs と同じく、
// 警告を出すだけで、終了コードは常に 0（チェックを失敗扱いにしない）。
// コードの中（`...`）とコードブロック、表は見ない。<!-- textlint-disable --> の範囲も見ない。
import { readFileSync, existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { parse } from "@textlint/markdown-to-ast"

const argv = process.argv.slice(2)
let max = 6
const i = argv.indexOf("--max")
if (i !== -1) {
	max = Number(argv[i + 1])
	argv.splice(i, 2)
}

function textOf(node) {
	if (node.type === "Str") return node.value
	if (node.type === "Code") return "＿"
	return (node.children || []).map(textOf).join("")
}

// 木をたどり、段落と HTML のコメントを出てきた順に返す。表とコードブロックには入らない
function* walk(node) {
	if (node.type === "Paragraph" || node.type === "Html") {
		yield node
		return
	}
	if (node.type === "Table" || node.type === "CodeBlock") return
	for (const c of node.children || []) yield* walk(c)
}

// 段落を文に分ける。括弧と「」の中の「。」では区切らない
function sentences(para) {
	const out = []
	let depth = 0
	let cur = ""
	for (const c of para) {
		cur += c
		if ("（(「".includes(c)) depth++
		else if ("）)」".includes(c) && depth > 0) depth--
		else if ("。！？".includes(c) && depth === 0) {
			out.push(cur.trim())
			cur = ""
		}
	}
	if (cur.trim()) out.push(cur.trim())
	return out
}

function find(text) {
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
		if (!/[ぁ-んァ-ン一-龠]/.test(para)) continue
		const count = sentences(para).length
		if (count > max) found.push({ line: n.loc.start.line, count, length: para.replace(/\s/g, "").length })
	}
	return found
}

let total = 0
for (const file of argv.filter((f) => f.endsWith(".md") && existsSync(f))) {
	const found = find(readFileSync(file, "utf8"))
	if (!found.length) continue
	// 標準入力から読み込んだ文は、一時ファイルの名前ではなく textlint と同じ名前で出す
	const shown = path.resolve(file).startsWith(os.tmpdir()) ? path.basename(file) : file
	console.log(`\n${shown}`)
	for (const f of found) console.log(`  ${f.line}:1  warning  段落に ${f.count} 文（${f.length} 字）ある。${max + 1} 文以上なら、論点ごとに段落を分ける  paragraph-length`)
	total += found.length
}
if (total) console.log(`\n✖ 文の多い段落が ${total} 個（warning。失敗扱いにしない）\n`)
