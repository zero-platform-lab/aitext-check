#!/usr/bin/env node
// 返答の中で、番号を振らずに 2 つ以上の質問をしている箇所を見つける。
//
// 質問が 2 つ以上あるときは「1.」「2.」と連番を振る（ユーザーが 2026-10-25 に決めた）。
// 番号があれば、ユーザーは「1 はこう、2 はこう」と番号で返事ができる。番号が無いと、
// どの質問に答えたかを書き分ける手間がかかり、答えの漏れも起きる。
//
//   node bin/find-questions.mjs <file.md>...
//
// 質問の文: 「？」「?」で終わる文と、「ですか。」「ますか。」「ませんか。」「でしょうか。」で終わる文。
// 番号付きの箇条書き（1. 2.）の中の質問は数えない。番号の無い箇条書きと段落の質問を数え、
// 2 つ以上あれば、最初の質問の行に警告を 1 つ出す。
//
// aitext-check --warn --reply が、textlint の後に実行する（返答を読むときだけ）。
// 「」の中は --reply が伏せてから渡すので、引用した質問（「作りますか？」）は数えない。
// 警告を出すだけで、終了コードは常に 0。
import { readFileSync, existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { parse } from "@textlint/markdown-to-ast"

const QUESTION = /(？|\?|(です|ます|ません|でしょう)か。)\s*$/

function textOf(node) {
	if (node.type === "Str") return node.value
	if (node.type === "Code") return "＿".repeat(node.value.length + 2)
	return (node.children || []).map(textOf).join("")
}

// 段落を、番号付きの箇条書きの中かどうかと一緒に返す
function* paragraphs(node, numbered = false) {
	if (node.type === "Paragraph") {
		yield { node, numbered }
		return
	}
	const inNumbered = numbered || (node.type === "List" && node.ordered)
	for (const c of node.children || []) yield* paragraphs(c, inNumbered)
}

function find(text) {
	const questions = []
	for (const { node, numbered } of paragraphs(parse(text))) {
		if (numbered) continue
		const para = textOf(node)
		let offset = 0
		for (const sentence of para.split(/(?<=[。！？?])/)) {
			const line = node.loc.start.line + (para.slice(0, offset).match(/\n/g) || []).length
			offset += sentence.length
			if (QUESTION.test(sentence.trim())) questions.push({ line, sentence: sentence.trim() })
		}
	}
	return questions.length >= 2 ? [{ line: questions[0].line, n: questions.length, sentence: questions[0].sentence }] : []
}

for (const file of process.argv.slice(2).filter((f) => f.endsWith(".md") && existsSync(f))) {
	const found = find(readFileSync(file, "utf8"))
	if (!found.length) continue
	// 標準入力から読み込んだ文は、一時ファイルの名前ではなく textlint と同じ名前で出す
	const shown = path.resolve(file).startsWith(os.tmpdir()) ? path.basename(file) : file
	console.log(`\n${shown}`)
	for (const f of found) {
		const quote = f.sentence.length > 40 ? f.sentence.slice(0, 40) + "…" : f.sentence
		console.log(`  ${f.line}:1  warning  「${quote}」: 書き方: 質問の番号。番号を振らずに質問が ${f.n} 個ある。「1.」「2.」と連番を振り、番号で返事ができるようにする  question-unnumbered`)
	}
}
