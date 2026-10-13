#!/usr/bin/env node
// 規則を書くときの補助。文を形態素解析した結果と、rules.yml の規則が当たる箇所を出す。
//
//   node bin/morph.mjs "ログから落とす" "エラーを見落とす"
import { check, loadRules, show } from "../lib/morph.mjs"

const rules = loadRules()
for (const text of process.argv.slice(2)) {
	console.log(text)
	console.log("  " + (await show(text)))
	for (const h of await check(text, rules)) console.log(`  当たる: ${h.rule.id}「${h.text}」→ ${h.rule.say}`)
}
