#!/usr/bin/env node
// 気をつける語句のうち、文体を指摘する行（口語・名詞化・冗長）の試験。
//
//   style-hit.md   : 口語・名詞化・冗長を含む行。どの行にも文体の警告が出ること（見落としが無いこと）
//   style-clean.md : 書き言葉だけの行。文体の警告が 1 件も出ないこと（誤検出が無いこと）
//   style-sections.md : 「ではなく」の数え上げ。「3 回の節」の見出しの行にだけ警告が出ること
//   nominal-hit.md / nominal-clean.md : 動詞を名詞として使った箇所（bin/find-nominal.mjs）の見落としと誤検出
//   avoidance-hit.md / avoidance-clean.md / avoidance-list.md : 責任を避ける書き方（bin/find-avoidance.mjs）
//
// 気をつける語句には文体以外の行（「落と」「当て」など）もあるので、警告の文で文体の行だけを数える。
// words.md の文体の表を直したら、`npm run test:style` で確かめる。
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const STYLE = /口語。|動詞を名詞にした語句|冗長。|重言。|相対時制。|責任回避。|文書の「書く」。|見えない根拠。/

// --warn を JSON 形式で実行し、文体の警告が出た行番号ごとに警告の文を返す。
function lint(file) {
	const res = spawnSync(process.execPath, [path.join(ROOT, "bin", "cli.mjs"), "--warn", file, "--format", "json"], {
		cwd: ROOT,
		encoding: "utf8",
	})
	const byLine = new Map()
	for (const r of JSON.parse(res.stdout || "[]")) {
		for (const m of r.messages.filter((m) => STYLE.test(m.message))) {
			if (!byLine.has(m.line)) byLine.set(m.line, [])
			byLine.get(m.line).push(m.message)
		}
	}
	return byLine
}

// 本文の行（見出し・空行・冒頭の説明を除く）を、行番号つきで返す。
function bodyLines(file) {
	return readFileSync(path.join(ROOT, file), "utf8")
		.split("\n")
		.map((text, i) => ({ text, line: i + 1 }))
		.filter(({ text }, i) => text.trim() && !text.startsWith("#") && i > 2)
}

let failed = 0
const hit = lint("test/style-hit.md")
for (const { text, line } of bodyLines("test/style-hit.md")) {
	if (!hit.has(line)) {
		console.log(`見落とし  style-hit.md:${line}  ${text}`)
		failed++
	}
}
const clean = lint("test/style-clean.md")
for (const { text, line } of bodyLines("test/style-clean.md")) {
	if (clean.has(line)) {
		console.log(`誤検出  style-clean.md:${line}  ${text}  (${clean.get(line).join(" / ")})`)
		failed++
	}
}
// 「ではなく」の数え上げ。警告の行が、「3 回の節」の見出しの行だけであること
const secFile = path.join(ROOT, "test/style-sections.md")
const sec = spawnSync(process.execPath, [path.join(ROOT, "bin", "count-dewanaku.mjs"), secFile], { encoding: "utf8" })
const warned = [...sec.stdout.matchAll(/^\s+(\d+):1\s+warning/gm)].map((m) => Number(m[1]))
const want = [readFileSync(secFile, "utf8").split("\n").indexOf("## 3 回の節") + 1]
if (JSON.stringify(warned) !== JSON.stringify(want)) {
	console.log(`節の数え上げ  警告の行 ${JSON.stringify(warned)}、期待 ${JSON.stringify(want)}`)
	failed++
}

// 動詞を名詞として使った箇所（形態素解析）。nominal-hit.md のどの行にも当たり、nominal-clean.md のどの行にも当たらないこと
function nominal(file) {
	const res = spawnSync(process.execPath, [path.join(ROOT, "bin", "find-nominal.mjs"), path.join(ROOT, file)], { encoding: "utf8" })
	return new Set([...res.stdout.matchAll(/^\s+(\d+):\d+\s+warning/gm)].map((m) => Number(m[1])))
}
const nomHit = nominal("test/nominal-hit.md")
for (const { text, line } of bodyLines("test/nominal-hit.md")) {
	if (!nomHit.has(line)) {
		console.log(`見落とし  nominal-hit.md:${line}  ${text}`)
		failed++
	}
}
const nomClean = nominal("test/nominal-clean.md")
for (const { text, line } of bodyLines("test/nominal-clean.md")) {
	if (nomClean.has(line)) {
		console.log(`誤検出  nominal-clean.md:${line}  ${text}`)
		failed++
	}
}

// 責任を避ける書き方（bin/find-avoidance.mjs）。avoidance-hit.md のどの行にも当たり、avoidance-clean.md の
// どの行にも当たらないこと。箇条書きの長さは、avoidance-list.md の 10 項目の箇条書きの先頭の行にだけ当たること
function avoidance(file) {
	const res = spawnSync(process.execPath, [path.join(ROOT, "bin", "find-avoidance.mjs"), path.join(ROOT, file)], { encoding: "utf8" })
	return new Set([...res.stdout.matchAll(/^\s+(\d+):\d+\s+warning/gm)].map((m) => Number(m[1])))
}
const avHit = avoidance("test/avoidance-hit.md")
for (const { text, line } of bodyLines("test/avoidance-hit.md")) {
	if (!avHit.has(line)) {
		console.log(`見落とし  avoidance-hit.md:${line}  ${text}`)
		failed++
	}
}
const avClean = avoidance("test/avoidance-clean.md")
for (const { text, line } of bodyLines("test/avoidance-clean.md")) {
	if (avClean.has(line)) {
		console.log(`誤検出  avoidance-clean.md:${line}  ${text}`)
		failed++
	}
}
const listLines = readFileSync(path.join(ROOT, "test/avoidance-list.md"), "utf8").split("\n")
const listWant = [listLines.indexOf("1. 一") + 1]
const listGot = [...avoidance("test/avoidance-list.md")]
if (JSON.stringify(listGot) !== JSON.stringify(listWant)) {
	console.log(`箇条書きの長さ  警告の行 ${JSON.stringify(listGot)}、期待 ${JSON.stringify(listWant)}`)
	failed++
}

const nHit = ["style-hit", "nominal-hit", "avoidance-hit"].reduce((n, f) => n + bodyLines(`test/${f}.md`).length, 0)
const nClean = ["style-clean", "nominal-clean", "avoidance-clean"].reduce((n, f) => n + bodyLines(`test/${f}.md`).length, 0)
console.log(`当たるべき ${nHit} 行、当たってはいけない ${nClean} 行、節の数え上げを確かめた。食い違い ${failed} 件`)
process.exit(failed ? 1 : 0)
