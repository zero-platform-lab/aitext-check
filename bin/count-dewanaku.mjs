#!/usr/bin/env node
// 「A ではなく B」を、節（見出しから次の見出しまで）ごとに数える。
//
// 1 節に 3 回以上あると、対比ばかりの文章になる。読む側は「では何なのか」を毎回
// 組み立て直すことになる。上限を超えた節を、その節の見出しの行で警告する。
//
//   node bin/count-dewanaku.mjs [--max N] <file.md>...   既定の N は 2（3 回以上で警告）
//
// aitext-check --warn が、textlint の後に実行する。textlint の規則にしていないのは、
// ルールのディレクトリ（--rulesdir）から読み込んだ規則には、設定ファイルの値（上限と
// severity）が渡らなかったため（2026-10-09 に textlint 15.8 で確かめた）。
// 警告を出すだけで、終了コードは常に 0（チェックを失敗扱いにしない）。
// コードの中（`...`）とコードブロックは数えない。Markdown の解析器が Str として渡さないため。
import { readFileSync, existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { parse } from "@textlint/markdown-to-ast"

const argv = process.argv.slice(2)
let max = 2
const i = argv.indexOf("--max")
if (i !== -1) {
	max = Number(argv[i + 1])
	argv.splice(i, 2)
}

// 木をたどり、見出しと文字列を出てきた順に返す。見出しの中の文字列は、その節に数えない
function* walk(node) {
	if (node.type === "Header" || node.type === "Str") yield node
	if (node.type === "Header") return
	for (const c of node.children || []) yield* walk(c)
}

let total = 0
for (const file of argv.filter((f) => f.endsWith(".md") && existsSync(f))) {
	const ast = parse(readFileSync(file, "utf8"))
	const found = []
	let sec = { line: 1, title: "（先頭）", count: 0 }
	const flush = () => sec.count > max && found.push(sec)
	for (const n of walk(ast)) {
		if (n.type === "Header") {
			flush()
			sec = { line: n.loc.start.line, title: (n.children || []).map((c) => c.value || "").join(""), count: 0 }
		} else {
			sec.count += (n.value.match(/ではなく/g) || []).length
		}
	}
	flush()
	if (found.length) {
		// 標準入力から読み込んだ文は、一時ファイルの名前ではなく textlint と同じ名前で出す
		const shown = path.resolve(file).startsWith(os.tmpdir()) ? path.basename(file) : file
		console.log(`\n${shown}`)
		for (const s of found) {
			console.log(`  ${s.line}:1  warning  節「${s.title}」に「ではなく」が ${s.count} 回ある（${max + 1} 回以上なら、「B である」と言い切る形に書き換える）  dewanaku-per-section`)
		}
		total += found.length
	}
}
if (total) console.log(`\n✖ 「ではなく」の多い節が ${total} 個（warning。失敗扱いにしない）\n`)
