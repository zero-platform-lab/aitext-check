#!/usr/bin/env node
// 意味の広い英語の動詞を、意味の広い日本語の動詞に直訳した箇所を、コーパスの頻度で見つける。
//
// 「ロックを取って」（get）、「設定を変えたら」（change）、「関数を呼んで」（call）のように、
// 英語の広い動詞を日本語の広い動詞に置き換えると、日本語を母語とする人が書いた文書では
// あまり使わない組になる。書いた「名詞＋助詞＋動詞」の件数を、同じ名詞と助詞の定着した動詞
// （「取得する」「変更する」「呼び出す」）の件数とコーパスで比べ、定着した動詞のほうが多ければ示す。
//
// 比べる動詞の組は corpus/confusion.md の表に書く（LanguageTool の ConfusionProbabilityRule と同じく、
// 人が決めた組の中だけで比べる）。コーパスは日本語版 Wikipedia で、DB は corpus/build.mjs で手元に作る。
// DB はリポジトリに入れない。DB が無いとき、node:sqlite の無い Node（22.13 より前）のときは何もしない。
//
// 2026-10-30 に、見本（直された文 8 文、直してはいけない文 7 文）で閾値を決めた。定着した動詞の
// 件数の合計が、書いた動詞の 1.5 倍以上で、かつ 3 件以上なら示す。公開する文章では不自然な 1 文で
// 読む人の信頼を失うので、誤検出より見落としを減らす側に寄せた。2 倍では「割合を出しました」を
// 見つけられなかった（「表示する」8 件と「算出する」3 件の合計 11 件に対し、「出す」7 件）。
// 1.5 倍にして増えた警告は、手元の文書 9 ファイルで「辞書を作る」の 1 件だった。合計で比べるのは、
// この「割合を」のように、定着した動詞の件数が割れるため。
//
//   node bin/find-confusion.mjs <file.md>...
//
// aitext-check --warn が、textlint の後に実行する。find-colloquial.mjs と同じく、
// 警告を出すだけで、終了コードは常に 0（チェックを失敗扱いにしない）。
// コードの中（`...`）とコードブロック、表、「」の中（悪い例や語の名前を引いた箇所）は見ない。
// <!-- textlint-disable --> の範囲も見ない。
import { readFileSync, existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { parse } from "@textlint/markdown-to-ast"
import { tokenize } from "kuromojin"
import { defaultDbPath, readConfusion } from "../corpus/confusion.mjs"
import { pairs } from "../corpus/pairs.mjs"

const RATIO = 1.5
const MIN = 3

const dbPath = defaultDbPath()
if (!existsSync(dbPath)) process.exit(0)
let DatabaseSync
try {
	;({ DatabaseSync } = await import("node:sqlite"))
} catch {
	process.exit(0)
}
const db = new DatabaseSync(dbPath, { readOnly: true })
const stmt = db.prepare("SELECT n FROM pair WHERE noun = ? AND particle = ? AND verb = ?")
const count = (noun, particle, verb) => stmt.get(noun, particle, verb)?.n ?? 0
const sets = readConfusion()

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
		// 「」の中は同じ長さの記号に置き換え、行の数え方を変えない
		const para = textOf(n).replace(/「[^「」]*」/g, (m) => m.replace(/[^\n]/g, "＿"))
		let offset = 0
		for (const sentence of para.split(/(?<=[。！？?])/)) {
			const line = n.loc.start.line + (para.slice(0, offset).match(/\n/g) || []).length
			offset += sentence.length
			const tokens = await tokenize(sentence)
			for (const p of pairs(tokens)) {
				const alts = sets.get(p.verb)
				if (!alts) continue
				// いちばん長い名詞の形のうち、コーパスに出てくるものを使う（「トーク」「ン」なら「トークン」）
				const noun = [...p.nouns].reverse().find((x) => [p.verb, ...alts].some((v) => count(x, p.particle, v) > 0))
				if (!noun) continue
				const mine = count(noun, p.particle, p.verb)
				const ranked = alts.map((v) => ({ v, c: count(noun, p.particle, v) })).filter((r) => r.c > 0).sort((a, b) => b.c - a.c)
				const total = ranked.reduce((sum, r) => sum + r.c, 0)
				if (total < MIN || total < RATIO * Math.max(mine, 1)) continue
				// p.start は名詞の最後の語を指す。使った名詞の長さだけ前へ戻す
				const word = tokens.slice(p.start - p.nouns.indexOf(noun), p.end + 1).map((t) => t.surface_form).join("")
				found.push({ line, word, written: `${noun}${p.particle}${p.verb}`, mine, ranked })
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
		const alts = f.ranked.map((r) => `「${r.v}」${r.c} 件`).join("、")
		console.log(`  ${f.line}:1  warning  「${f.word}」: 書き方: 直訳。コーパスでは「${f.written}」${f.mine} 件に対し、${alts}。定着した動詞にする  corpus-verb`)
	}
	total += found.length
}
if (total) console.log(`\n✖ コーパスで定着した動詞と違う動詞が ${total} 個（warning。失敗扱いにしない）\n`)
