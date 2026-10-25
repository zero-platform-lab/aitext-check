#!/usr/bin/env node
// 体言止めの文を、節（見出しから次の見出しまで）ごとに数える。
//
// 体言止めが 1 節に 3 回以上あると、述語を省いた行が並び、何をしたのか・どうなったのかを
// 読む側が補うことになる（「両方リリース完了。」「重複も解消。」）。上限を超えた節を、
// その節の見出しの行で警告する。
//
//   node bin/count-taigen.mjs [--max N] <file.md>...   既定の N は 2（3 回以上で警告）
//
// 体言止めの文: 「。」で終わり、「。」の前の語が名詞（形容動詞の語幹の「必要」「可能」も含む）の文。
// 末尾の括弧書き（「…を使う（確かめた）。」）は外してから見る。括弧と「」の中の「。」では文を区切らない。
// 次は数えない。
//
//   「。」で終わらない行   箇条書きの見出し語や表の代わりの行（「- kuromoji 0.1.2」）
//   「こと。」             決まりを書く形（「混同しないこと。」）
//   「とおり。」           「次のとおり。」
//
// 2026-10-25 に、手元の Markdown 302 ファイルと、過去の返答 300 件で数えた。文書は 4,847 節のうち
// 198 節、返答は 503 節のうち 6 節に出た。返答の 6 件は、どれも述語を省いて詰めた返答だった
// （「方針確定（外のまま）。」「病的エッジなので受容。」）。
//
// aitext-check --warn が、textlint の後に実行する。count-dewanaku.mjs と同じく、
// 警告を出すだけで、終了コードは常に 0（チェックを失敗扱いにしない）。
// コードの中（`...`）とコードブロック、表は見ない。<!-- textlint-disable --> の範囲も見ない。
import { readFileSync, existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { parse } from "@textlint/markdown-to-ast"
import { tokenize } from "kuromojin"

const argv = process.argv.slice(2)
let max = 2
const i = argv.indexOf("--max")
if (i !== -1) {
	max = Number(argv[i + 1])
	argv.splice(i, 2)
}

const NOT_COUNTED = new Set(["こと", "とおり", "通り"])

function textOf(node) {
	if (node.type === "Str") return node.value
	if (node.type === "Code") return "＿"
	return (node.children || []).map(textOf).join("")
}

// 木をたどり、見出しと段落、HTML のコメントを出てきた順に返す。表とコードブロックには入らない
function* walk(node) {
	if (node.type === "Header" || node.type === "Paragraph" || node.type === "Html") {
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
		else if (c === "。" && depth === 0) {
			out.push(cur.trim())
			cur = ""
		}
	}
	return out
}

async function isTaigen(sentence) {
	const body = sentence.replace(/。$/, "").replace(/[（(][^（）()]*[）)]$/, "")
	const tokens = await tokenize(body)
	const last = tokens[tokens.length - 1]
	return last && last.pos === "名詞" && !NOT_COUNTED.has(last.surface_form)
}

async function find(text) {
	const found = []
	let disabled = false
	let sec = { line: 1, title: "（先頭）", list: [] }
	const flush = () => sec.list.length > max && found.push(sec)
	for (const n of walk(parse(text))) {
		if (n.type === "Html") {
			if (/textlint-disable(?!-)/.test(n.value)) disabled = true
			if (/textlint-enable/.test(n.value)) disabled = false
			continue
		}
		if (n.type === "Header") {
			flush()
			sec = { line: n.loc.start.line, title: textOf(n), list: [] }
			continue
		}
		if (disabled) continue
		for (const s of sentences(textOf(n))) if (await isTaigen(s)) sec.list.push(s)
	}
	flush()
	return found
}

let total = 0
for (const file of argv.filter((f) => f.endsWith(".md") && existsSync(f))) {
	const found = await find(readFileSync(file, "utf8"))
	if (!found.length) continue
	// 標準入力から読み込んだ文は、一時ファイルの名前ではなく textlint と同じ名前で出す
	const shown = path.resolve(file).startsWith(os.tmpdir()) ? path.basename(file) : file
	console.log(`\n${shown}`)
	for (const s of found) {
		// 直す文を探せるように、文の終わりを 3 つまで引く
		const ends = s.list.slice(0, 3).map((t) => `「${t.length > 15 ? "…" + t.slice(-15) : t}」`).join("")
		console.log(`  ${s.line}:1  warning  節「${s.title}」に体言止めの文が ${s.list.length} 個ある（${ends}など）。${max + 1} 個以上なら、動詞や「です」「である」で終わる文に書き換え、何をしたか・どうなったかを書く  taigen-per-section`)
	}
	total += found.length
}
if (total) console.log(`\n✖ 体言止めの多い節が ${total} 個（warning。失敗扱いにしない）\n`)
