#!/usr/bin/env node
// 注意が必要な語句のうち、文体を指摘する行（口語・名詞化・冗長）の試験。
//
//   style-hit.md   : 口語・名詞化・冗長を含む行。どの行にも文体の警告が出ること（見落としが無いこと）
//   style-clean.md : 書き言葉だけの行。文体の警告が 1 件も出ないこと（誤検出が無いこと）
//   style-sections.md : 「ではなく」の数え上げ。「3 回の節」の見出しの行にだけ警告が出ること
//
// 注意が必要な語句には文体以外の行（「落と」「当て」など）もあるので、警告の文で文体の行だけを数える。
// words.md の文体の表を直したら、`npm run test:style` で確かめる。
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const STYLE = /口語。|動詞を名詞にした語句|冗長。/

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

const nHit = bodyLines("test/style-hit.md").length
const nClean = bodyLines("test/style-clean.md").length
console.log(`当たるべき ${nHit} 行、当たってはいけない ${nClean} 行、節の数え上げを確かめた。食い違い ${failed} 件`)
process.exit(failed ? 1 : 0)
