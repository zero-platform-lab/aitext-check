#!/usr/bin/env node
// words.md の表から prh 辞書（prh-error.yml / prh-warn.yml）を作る。
//
// 語の一覧は words.md だけにする。手で 2 か所に書くと、片方だけが育つ。
// 辞書を 2 つに分けるのは、重さ（error と warning）を分けるため。textlint の
// severity は規則ごとにしか指定できず、prh の辞書の 1 件ずつには指定できない。
//
//   node build-prh.mjs           作り直す
//   node build-prh.mjs --check   作り直さず、いまの file と同じかだけ見る
//
// 「見る場所」が 全部 でない行は書き出さない。textlint が読むのは文書だけなので、
// 画面にだけ出る語を辞書に入れると、文書の正しい使い方だけが error になる。
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const WORDS = path.join(ROOT, "words.md")
const OUT_BAN = path.join(ROOT, "prh-error.yml")
const OUT_CARE = path.join(ROOT, "prh-warn.yml")

// その見出しの下にある表の行を返す。
function rows(heading) {
	const lines = readFileSync(WORDS, "utf8").split("\n")
	const start = lines.findIndex((l) => l.trim() === `## ${heading}`)
	if (start === -1) {
		console.error(`words.md に「${heading}」の見出しが無い`)
		process.exit(1)
	}
	let end = lines.length
	for (let i = start + 1; i < lines.length; i++) {
		if (lines[i].startsWith("## ")) {
			end = i
			break
		}
	}
	const out = []
	for (const l of lines.slice(start, end)) {
		if (!l.startsWith("|")) continue
		// \| はセルの中の縦棒。一度 \x00 へ退避してから割り、戻すときに | へ直す。
		const safe = l.trim().replace(/^\|/, "").replace(/\|$/, "").replace(/\\\|/g, "\x00")
		const cells = safe.split("|").map((c) => c.trim().replace(/\x00/g, "|"))
		if (cells.length === 0) continue
		const joined = cells.join("")
		if ([...joined].every((ch) => "-: ".includes(ch))) continue // 区切りの行
		if (cells[0] === "書いてはいけない" || cells[0] === "語") continue // 見出しの行
		out.push(cells)
	}
	return out
}

// 表のセルの `…` を外す。
function unquote(s) {
	return s.trim().replace(/^`/, "").replace(/`$/, "").trim()
}

// 正規表現として書いてあるか。丸ごと文字として扱うと当たらない。
function isRegex(pattern) {
	return /[()\[\]|?*+\\^$]/.test(pattern)
}

// 辞書の 1 件。
function entry(pattern, expected, why, severity) {
	const pat = isRegex(pattern) ? `/${pattern}/` : pattern
	const lines = []
	if (why) lines.push(`  # ${why}`)
	lines.push(`  - expected: ${expected}`)
	lines.push(`    pattern: ${pat}`)
	if (severity !== "error") lines.push(`    severity: ${severity}`)
	return lines.join("\n")
}

function head(title) {
	return [
		"# 用語辞書。textlint-rule-prh が読む。",
		"#",
		"# **手で直さない。** `words.md` の表から `build-prh.mjs` が作る。",
		"# 語を足すときは、あちらの表に 1 行足す。",
		"version: 1",
		"rules:",
		"",
		`  # ===== ${title} =====`,
	]
}

// 「見る場所」が 全部 の行だけ返す（3 列目が無い、または 全部）。
function visibleAll(table) {
	return rows(table).filter((c) => c.length < 3 || c[2] === "全部")
}

// 使わない語。見つけたら直す（error）。
function buildBan() {
	const out = head("使わない語 (見つけたら直す)")
	for (const cells of visibleAll("使わない語")) {
		const bad = unquote(cells[0])
		const good = unquote(cells[1])
		const why = cells.length > 3 ? cells[3] : ""
		out.push(entry(bad, good, why, "error"))
	}
	return out.join("\n") + "\n"
}

// 気をつける語。止めない（warning）。expected を pattern と同じにすると prh は
// 何も言わないので、紛れる意味を expected に書いて警告の文言として読ませる。
function buildCare() {
	const out = head("気をつける語 (止めない。正しい使い方もある)")
	for (const cells of visibleAll("気をつける語")) {
		const word = unquote(cells[0])
		const ok = cells.length > 1 ? cells[1] : ""
		const mixed = cells.length > 3 ? cells[3] : ""
		const why = `そのまま使ってよい意味: ${ok} / 紛れる意味: ${mixed}`
		out.push(entry(word, `${word} (${mixed} の意味なら直す)`, why, "warning"))
	}
	return out.join("\n") + "\n"
}

const made = new Map([
	[OUT_BAN, buildBan()],
	[OUT_CARE, buildCare()],
])

if (process.argv.includes("--check")) {
	const stale = [...made]
		.filter(([p, text]) => (existsSync(p) ? readFileSync(p, "utf8") : "") !== text)
		.map(([p]) => path.basename(p))
	if (stale.length) {
		console.error(`${stale.join(" と ")} が words.md と食い違う（build-prh.mjs で作り直す）`)
		process.exit(1)
	}
	console.log("辞書は words.md と合っている")
	process.exit(0)
}

for (const [p, text] of made) writeFileSync(p, text, "utf8")
const ban = visibleAll("使わない語").length
const care = visibleAll("気をつける語").length
const skip = rows("使わない語").length + rows("気をつける語").length - ban - care
console.log(`prh-error.yml (${ban} 件) と prh-warn.yml (${care} 件) を作った（見る場所が 全部 でない ${skip} 件は書き出していない）`)
