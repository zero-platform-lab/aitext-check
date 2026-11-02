#!/usr/bin/env node
// 書き言葉の漢語にできる和語を、形態素解析（kuromoji）で見つける。
//
// 語の表は wago.md にある。kuromoji の基本形と品詞が表の行と一致した語に警告を出す。
// 活用した形（「決めた」「決めて」）も基本形で照合するので、正規表現で活用を書き並べなくてよい。
// 複合語（「作り直す」）は kuromoji が別の基本形にするので当たらない。kuromoji が 2 語に分ける
// 複合動詞（「決め直す」→「決め」+「直す」）は、連用形の後に動詞が続く形として外す。
//
//   node bin/find-wago.mjs <file.md>...
//
// aitext-check --warn が、textlint の後に実行する。find-nominal.mjs と同じく、
// 警告を出すだけで、終了コードは常に 0（チェックを失敗扱いにしない）。
// コードの中（`...`）とコードブロック、<!-- textlint-disable --> の範囲は見ない。
import { readFileSync, existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "@textlint/markdown-to-ast"
import { tokenize } from "kuromojin"

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")

// wago.md の表を「基本形\t品詞」→ 行 の Map にする
function readTable() {
	const table = new Map()
	for (const line of readFileSync(path.join(ROOT, "wago.md"), "utf8").split("\n")) {
		const cells = line.split("|").map((c) => c.trim())
		if (cells.length < 7 || cells[1] === "和語" || /^-+$/.test(cells[1])) continue
		const [, word, pos, written, reply, paper] = cells
		table.set(`${word}\t${pos}`, { word, written, reply, paper })
	}
	return table
}

function* walk(node) {
	if (node.type === "Str" || node.type === "Html") yield node
	for (const c of node.children || []) yield* walk(c)
}

async function find(text, table) {
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
			const t = tokens[i]
			const row = table.get(`${t.basic_form}\t${t.pos}`)
			if (!row) continue
			// 連用形のすぐ後に動詞が続く形は、複合動詞（「決め直す」「数え始める」）なので外す。
			// kuromoji は後ろの動詞を「非自立」とすることが多いので、自立かどうかは見ない
			const next = tokens[i + 1]
			if (t.conjugated_form === "連用形" && next && next.pos === "動詞") continue
			// 複合動詞の後ろの語（「数え始める」の「始める」）も外す
			const prev = tokens[i - 1]
			if (t.pos === "動詞" && prev && prev.pos === "動詞" && prev.conjugated_form === "連用形") continue
			const offset = t.word_position - 1
			const line = n.loc.start.line + (n.value.slice(0, offset).match(/\n/g) || []).length
			const lastNl = n.value.lastIndexOf("\n", offset - 1)
			const column = lastNl === -1 ? n.loc.start.column + offset + 1 : offset - lastNl
			found.push({ line, column, surface: t.surface_form, row })
		}
	}
	return found
}

const table = readTable()
let total = 0
for (const file of process.argv.slice(2).filter((f) => f.endsWith(".md") && existsSync(f))) {
	const found = await find(readFileSync(file, "utf8"), table)
	if (!found.length) continue
	const shown = path.resolve(file).startsWith(os.tmpdir()) ? path.basename(file) : file
	console.log(`\n${shown}`)
	for (const f of found) {
		console.log(`  ${f.line}:${f.column}  warning  「${f.surface}」: 書き方: 要注意。書き言葉の文書なら「${f.row.written}」にできないか確認（「${f.row.word}」を使った割合は、返答の記録で ${f.row.reply}、情報通信白書とるりまで ${f.row.paper}）  wago`)
	}
	total += found.length
}
if (total) console.log(`\n✖ 書き言葉にできる和語が ${total} 個（warning。失敗扱いにしない）\n`)
