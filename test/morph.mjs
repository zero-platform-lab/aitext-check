#!/usr/bin/env node
// rules.yml の規則を、それぞれの ok と ng の文で確かめる。
//   ng の文: その規則が当たること
//   ok の文: その規則も、ほかのどの規則も当たらないこと
// ok をほかの規則にも通すのは、新しい規則が別の規則の正しい使い方を壊さないかを見るため。
//
// 例文は、その規則の where の最初の場所 (書いていなければ段落) にあるものとして当てる。
// count のある規則 (節に何回以上で報告するもの) は、ほかの規則の ok には通さない。
// 1 回当たっても報告にはならないので、例文の語句に当たっても誤検出ではない。
import { check, loadRules } from "../lib/morph.mjs"

const rules = loadRules()
const others = rules.filter((r) => !r.count)
let failed = 0
for (const rule of rules) {
	const place = rule.where?.[0] ?? "段落"
	for (const text of rule.ng ?? []) {
		const hits = await check(text, [rule], place)
		if (hits.length === 0) {
			console.log(`見落とし: ${rule.id} が「${text}」に当たらない`)
			failed++
		}
	}
	for (const text of rule.ok ?? []) {
		const hits = [...(await check(text, [rule], place)), ...(await check(text, others.filter((r) => r !== rule), place))]
		for (const h of hits) {
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
