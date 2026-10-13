// 形態素解析した語の並びに、rules.yml の規則を当てる。
//
// 規則は文字列ではなく語の単位で当てる。「落とす」の規則は「見落とす」に当たらない
// (kuromoji は「見落とす」を 1 語にする)。文字列の置換で複合語を割った失敗を防ぐため。
//
// 語の条件 (match・before・after の 1 要素) に書ける項目:
//   base     原形。「落とし」「落とした」はどれも「落とす」になる
//   surface  書いてあるとおりの形
//   pos      品詞 (名詞・動詞・助詞 など)
//   pos1     品詞の細分類 (自立・接尾・格助詞 など)
// 値は文字列か、文字列の配列 (どれかに一致すればよい)。
//
// 規則は、語の条件を並べた match を 1 つ持つ。言い方が何通りかあるときは、match の代わりに
// matches に並びを複数書く (どれかに合えば当てる)。
//
// 空白 (英字と日本語のあいだの半角スペースなど) は、語の並びから外してから当てる。
// 「textlint の規則」と「textlintの規則」に同じ規則を当てるため。
//
// 規則に書ける前後の条件:
//   before / after          直前・直後の語がこの条件に合うときだけ当てる
//   not_before / not_after  直前・直後の語がこの条件に合うときは当てない
// どれも語の条件の配列で、どれか 1 つに合えばよい。
// 前後の条件には { edge: true } も書ける。文 (段落や表のセル) の始まり・終わりで、前後に語が無いときに合う。
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import yaml from "js-yaml"
import { tokenize } from "kuromojin"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
export const RULES_FILE = path.join(ROOT, "rules.yml")

const FIELDS = { base: "basic_form", surface: "surface_form", pos: "pos", pos1: "pos_detail_1" }

export function loadRules(file = RULES_FILE) {
	const rules = yaml.load(readFileSync(file, "utf8")) ?? []
	const ids = new Set()
	for (const r of rules) {
		if (!r.id) throw new Error(`規則に id が無い: ${JSON.stringify(r)}`)
		if (ids.has(r.id)) throw new Error(`規則の id が重複している: ${r.id}`)
		ids.add(r.id)
		if (!!r.match === !!r.matches) throw new Error(`${r.id}: match と matches のどちらか一方だけを書く`)
		r.seqs = r.matches ?? [r.match]
		if (r.seqs.some((s) => !Array.isArray(s) || s.length === 0)) throw new Error(`${r.id}: 語の並びが空か、配列でない`)
		for (const cond of r.seqs.flat()) {
			for (const k of Object.keys(cond)) if (!(k in FIELDS)) throw new Error(`${r.id}: 語の条件に知らない項目がある: ${k}`)
		}
		for (const cond of [...(r.before ?? []), ...(r.after ?? []), ...(r.not_before ?? []), ...(r.not_after ?? [])]) {
			for (const k of Object.keys(cond)) if (!(k in FIELDS) && k !== "edge") throw new Error(`${r.id}: 前後の条件に知らない項目がある: ${k}`)
		}
	}
	return rules
}

// 1 語が条件に合うか。基本形が * の語 (辞書に無い語) は、書いてあるとおりの形を原形とみなす。
function fits(token, cond) {
	if (!token) return false
	for (const [k, want] of Object.entries(cond)) {
		let have = token[FIELDS[k]]
		if (k === "base" && have === "*") have = token.surface_form
		if (!(Array.isArray(want) ? want : [want]).includes(have)) return false
	}
	return true
}
const anyFits = (token, conds) => (conds ?? []).some((c) => (c.edge ? !token : fits(token, c)))

// 語の並びに 1 つの規則を当てる。当たった箇所を、文字の位置 (0 始まり) で返す。
// 同じ位置に複数の並びが当たったときは、1 つにまとめる。
export function matchRule(tokens, rule) {
	const hits = new Map()
	for (const seq of rule.seqs) {
		const n = seq.length
		for (let i = 0; i + n <= tokens.length; i++) {
			if (!seq.every((c, j) => fits(tokens[i + j], c))) continue
			const prev = tokens[i - 1]
			const next = tokens[i + n]
			if (rule.before && !anyFits(prev, rule.before)) continue
			if (rule.after && !anyFits(next, rule.after)) continue
			if (anyFits(prev, rule.not_before) || anyFits(next, rule.not_after)) continue
			const start = tokens[i].word_position - 1
			const last = tokens[i + n - 1]
			const end = last.word_position - 1 + last.surface_form.length
			hits.set(`${start}:${end}`, { start, end })
		}
	}
	return [...hits.values()]
}

const isSpace = (t) => t.pos === "記号" && t.pos_detail_1 === "空白"

// 文に規則をすべて当てる。
export async function check(text, rules) {
	const tokens = (await tokenize(text)).filter((t) => !isSpace(t))
	const out = []
	for (const rule of rules) {
		for (const h of matchRule(tokens, rule)) out.push({ ...h, rule, text: text.slice(h.start, h.end) })
	}
	return out.sort((a, b) => a.start - b.start)
}

// 解析した語の並びを、人が読める形にする (規則を書くときに使う)。
export async function show(text) {
	const tokens = await tokenize(text)
	return tokens
		.map((t) => `${t.surface_form}[${t.basic_form === "*" ? t.surface_form : t.basic_form}/${t.pos}${t.pos_detail_1 === "*" ? "" : "-" + t.pos_detail_1}]`)
		.join(" ")
}
