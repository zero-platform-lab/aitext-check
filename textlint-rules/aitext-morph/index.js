// textlint のルール。rules.yml の規則を、形態素解析した語の並びに当てる (lib/morph.mjs)。
//
// 設定の options.levels で、当てる規則を選ぶ (error、warning、またはその配列)。prh の辞書と違い、
// 報告ごとに重大度を付けられるので、1 つのルールで両方を扱える。
// 項目の名前を severity にしない。textlint がルール全体の重大度として読む予約語で、配列を渡すと何も報告しなくなった。
//
// 段落・見出し・表のセルを単位に当てる。Str を単位にすると、強調やリンクで文が切れて、
// 語の並びが途中で分かれるため。インラインのコードは当てない。
// 箇条書きの中の段落は「箇条書き」として扱う (規則の where で選ぶ)。
//
// count のある規則は、1 つずつは報告しない。節 (見出しから次の見出しまで) ごとに数え、
// min 回以上あった節の見出しの行で 1 回だけ報告する。見出しの無い先頭の節は、文書の先頭で報告する。
import { check, loadRules } from "../../lib/morph.mjs"

const LEVEL = { warning: 1, error: 2 }

export default function (context, options = {}) {
	const { Syntax, getSource, locator, report } = context
	const wants = [options.levels ?? "error"].flat()
	const rules = loadRules().filter((r) => wants.includes(r.severity))
	const counted = rules.filter((r) => r.count)
	const single = rules.filter((r) => !r.count)

	let listDepth = 0
	let section = null // 今いる節の見出し (null は文書の先頭)
	let doc = null
	const pending = []
	const counts = new Map() // 規則 → (節 → 当たった文字列の配列)

	const where = (node) => {
		if (node.type === Syntax.Header) return "見出し"
		if (node.type === Syntax.TableCell) return "表"
		return listDepth > 0 ? "箇条書き" : "段落"
	}

	const run = (node) => {
		// 場所と節は、await の前に決めておく (後に回すと、走査が先へ進んでしまう)
		const place = where(node)
		const sec = section
		// Promise を textlint に返す。返さないと、textlint は解析が終わる前にチェックを終える
		const p = (async () => {
				// 元の文字列のうち、インラインのコードを同じ長さの空白に置き換える。位置を変えないため
				let text = getSource(node)
				for (const child of node.children ?? []) {
					if (child.type !== Syntax.Code) continue
					const s = child.range[0] - node.range[0]
					const e = child.range[1] - node.range[0]
					text = text.slice(0, s) + " ".repeat(e - s) + text.slice(e)
				}
				// 表のセルの元の文字列は、区切りの | を含む。kuromoji は | を名詞にするので、セルの終わりが
				// 文の終わりに見えなくなる。同じ長さの空白に置き換える
				if (node.type === Syntax.TableCell) text = text.replace(/^\|/, " ").replace(/\|\s*$/, (m) => " ".repeat(m.length))
				// 見出しの # も外す
				if (node.type === Syntax.Header) text = text.replace(/^#+/, (m) => " ".repeat(m.length))

				for (const h of await check(text, single, place)) {
					report(node, {
						message: `「${h.text}」→ ${h.rule.say}（${h.rule.why}）${h.rule.judge === "llm" ? "（文脈で判断）" : ""}[${h.rule.id}]`,
						padding: locator.range([h.start, h.end]),
						severity: LEVEL[h.rule.severity],
					})
				}
				for (const h of await check(text, counted, place)) {
					if (!counts.has(h.rule)) counts.set(h.rule, new Map())
					const bySec = counts.get(h.rule)
					if (!bySec.has(sec)) bySec.set(sec, [])
					bySec.get(sec).push(h.text)
				}
			})()
		pending.push(p)
		return p
	}

	return {
		[Syntax.Document](node) {
			doc = node
		},
		[Syntax.ListItem]() {
			listDepth++
		},
		[`${Syntax.ListItem}:exit`]() {
			listDepth--
		},
		[Syntax.Header](node) {
			section = node
			return run(node)
		},
		[Syntax.Paragraph]: run,
		[Syntax.TableCell]: run,
		async [`${Syntax.Document}:exit`]() {
			await Promise.all(pending)
			for (const [rule, bySec] of counts) {
				for (const [sec, texts] of bySec) {
					if (texts.length < rule.count.min) continue
					report(sec ?? doc, {
						message: `この節に${rule.say}が ${texts.length} 回ある (${rule.count.min} 回以上で報告。例: ${texts
							.slice(0, 3)
							.map((t) => `「${t}」`)
							.join("")})（${rule.why}）${rule.judge === "llm" ? "（文脈で判断）" : ""}[${rule.id}]`,
						severity: LEVEL[rule.severity],
					})
				}
			}
		},
	}
}
