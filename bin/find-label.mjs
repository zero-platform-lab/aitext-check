#!/usr/bin/env node
// 見出しを、動詞の句に名詞を付けた名札にしている箇所を、形態素解析（kuromoji）で見つける。
//
// 「書いた原稿で確かめる問い」「区切りごとに変えるもの」「36 作で確かめた結果」「障害の選び方」の
// ように、動詞で中身を言いかけて、最後を名詞で閉じた見出しを指す。節の中身ではなく、節の役割を
// 名前にしていて、AI の書いた文書によく出る。中身を言う文にする（「書き終えたら、次の問いに答えてみる」
// 「障害はジャンルに合わせて選ぶ」）。
//
//   node bin/find-label.mjs <file.md>...
//
// 見出しの中で、数だけを書いて何が N つかを言っていない箇所（「6 つを順に決める」）も見つける。
// 文書の題（# の見出し）で、動詞の連用形と読点で 2 つの作業をつないだもの（「題を変え、和語を書き換える」
// 「整理して、索引を追加する」）も見つける。節の見出し（## 以下）と太字には当てない。作業の手順を並べていて、何のための節か（何のための変更か）を言っていないため。
// PR の題も同じ形になりやすいので、pr-title の点検も同じ判定を使う（ユーザーが 2026-11-03 に決めた）。
//
// 見るのは、Markdown の見出しと、太字だけの段落（「**確かめた結果**」）と、行の頭の太字
// （「- **確かめた結果**：…」）。見出しの最後の語が名詞で、次のどちらかなら当てる。
//   - 名詞の直前が、動詞の基本形か、助動詞の基本形（「確かめる問い」「確かめた結果」）
//   - 名詞が「方」で終わり、動詞の連用形から作った語（「選び方」「並べ方」「終わり方」）
// 「使うとき」「迷う場合」のような条件を言う見出しは外す。最後の「こと」は words.md の
// 「〜こと」の行が指摘するので、ここでは外す。
//
// aitext-check --warn が、textlint の後に実行する。find-nominal.mjs と同じく、警告を出すだけで、
// 終了コードは常に 0（チェックを失敗扱いにしない）。<!-- textlint-disable --> の範囲は見ない。
import { readFileSync, existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { parse } from "@textlint/markdown-to-ast"
import { tokenize } from "kuromojin"

// 「〜方」のうち、名詞として定着していて、見出しにしても名札に読めない語
const ESTABLISHED = new Set(["使い方", "考え方", "見方", "味方", "仕方", "やり方"])

// 条件や時を言う名詞。見出しの最後に来ても名札ではない
const CONDITION = new Set(["とき", "時", "場合", "ため", "ところ", "まで", "前", "後", "こと"])

const textOf = (node) => (node.type === "Str" ? node.value : (node.children || []).map(textOf).join(""))

// 見出しと、太字だけの段落と、段落の頭の太字を、出てきた順に返す
function* labels(node, disabled = { on: false }) {
	if (node.type === "Html") {
		if (/textlint-disable(?!-)/.test(node.value)) disabled.on = true
		if (/textlint-enable/.test(node.value)) disabled.on = false
		return
	}
	if (disabled.on) return
	if (node.type === "Header") {
		yield node
		return
	}
	if (node.type === "Paragraph" && node.children?.[0]?.type === "Strong") {
		yield node.children[0]
	}
	for (const c of node.children || []) yield* labels(c, disabled)
}

const isVerbStem = (t) => t.pos === "動詞" && t.conjugated_form === "連用形"

// 見出しの中で、数だけを書いて、何が N つかを言っていない箇所（「6 つを順に決める」）。
// 「次の 3 つを守る」「障害の 3 つ」のように、直前の「の」で何の数かを言っていれば外す
function bareCount(tokens) {
	for (let i = 0; i + 2 < tokens.length; i++) {
		if (tokens[i].pos_detail_1 !== "数" || tokens[i + 1].surface_form !== "つ") continue
		const next = tokens[i + 2]
		if (next.pos !== "助詞" || !["を", "が", "は", "に", "も"].includes(next.surface_form)) continue
		if (tokens[i - 1] && tokens[i - 1].surface_form === "の") continue
		return true
	}
	return false
}

// 動詞の連用形のすぐ後に読点がある箇所（「変え、」「整理して、」）。2 つの作業を並べた見出しになる
function twoTasks(all) {
	for (let i = 0; i + 1 < all.length; i++) {
		if (!isVerbStem(all[i])) continue
		if (all[i + 1].surface_form === "、") return true
		if (["て", "で"].includes(all[i + 1].surface_form) && all[i + 2] && all[i + 2].surface_form === "、") return true
	}
	return false
}

async function judge(text, depth) {
	const all = await tokenize(text.trim())
	// 作業を並べた形を見るのは、文書の題（# の見出し）だけ。節の見出しは「誰の目で語るかを決め、
	// 1 つの場面の中では変えない」のような助言を 2 段で言うことが多く、作業の並びとは限らないため
	if (depth === 1 && twoTasks(all)) return { word: text.trim(), kind: "two-tasks" }
	const tokens = all.filter((t) => t.pos !== "記号")
	if (bareCount(tokens)) return { word: text.trim(), kind: "count" }
	const last = tokens[tokens.length - 1]
	if (!last || last.pos !== "名詞" || CONDITION.has(last.surface_form) || ESTABLISHED.has(last.surface_form)) return null
	const prev = tokens[tokens.length - 2]
	// 「確かめる問い」「確かめた結果」
	if (prev && ["動詞", "助動詞"].includes(prev.pos) && prev.conjugated_form === "基本形") return { word: text.trim(), kind: "label" }
	// 「選び方」（1 語）と「終わり方」（終わり + 方）
	if (/^[一-龠々]+[ぁ-ん]方$/.test(last.surface_form)) return { word: text.trim(), kind: "label" }
	if (last.surface_form === "方" && prev && isVerbStem(prev)) return { word: text.trim(), kind: "label" }
	return null
}

async function find(text) {
	const found = []
	for (const n of labels(parse(text))) {
		const hit = await judge(textOf(n), n.type === "Header" ? n.depth : 0)
		if (hit) found.push({ line: n.loc.start.line, column: n.loc.start.column + 1, ...hit })
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
		if (f.kind === "two-tasks") {
			console.log(`  ${f.line}:${f.column}  warning  「${f.word}」: 見出しで、2 つの作業を「〜し、」「〜して、」でつないでいないか確認。作業を並べず、何のための節かを一言で書く（「題を変え、和語を書き換える」→「チェックで見つけた不自然な日本語を修正する」）  heading-two-tasks`)
		} else if (f.kind === "count") {
			console.log(`  ${f.line}:${f.column}  warning  「${f.word}」: 見出しに数だけを書いていないか確認。見出しは単独で読まれるので、何が N つかを書く（「6 つを順に決める」→「6 つのことを決めておく」）  heading-bare-count`)
		} else {
			console.log(`  ${f.line}:${f.column}  warning  「${f.word}」: 見出しを、動詞の句に名詞を付けた名札にしていないか確認。中身を言う文にする（「書いた原稿で確かめる問い」→「書き終えたら、次の問いに答えてみる」、「障害の選び方」→「障害はジャンルに合わせて選ぶ」）  label-heading`)
		}
	}
	total += found.length
}
if (total) console.log(`\n✖ 名札の見出しが ${total} 個（warning。失敗扱いにしない）\n`)
