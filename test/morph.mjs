#!/usr/bin/env node
// rules.yml の規則を、それぞれの ok と ng の文で確かめる。
//   ng の文: その規則が当たること
//   ok の文: その規則も、ほかのどの規則も当たらないこと
// ok をほかの規則にも通すのは、新しい規則が別の規則の正しい使い方を壊さないかを見るため。
import { check, loadRules } from "../lib/morph.mjs"

const rules = loadRules()
let failed = 0
for (const rule of rules) {
	for (const text of rule.ng ?? []) {
		const hits = await check(text, [rule])
		if (hits.length === 0) {
			console.log(`見落とし: ${rule.id} が「${text}」に当たらない`)
			failed++
		}
	}
	for (const text of rule.ok ?? []) {
		for (const h of await check(text, rules)) {
			console.log(`誤検出: ${rule.id} の ok「${text}」に ${h.rule.id} が当たる (「${h.text}」)`)
			failed++
		}
	}
	if (!(rule.ng ?? []).length) {
		console.log(`例文が無い: ${rule.id} に ng の文が無い`)
		failed++
	}
}
console.log(`規則 ${rules.length} 件、失敗 ${failed} 件`)
process.exit(failed ? 1 : 0)
