// textlint のルール。rules.yml の規則を、形態素解析した語の並びに当てる (lib/morph.mjs)。
//
// 設定の options.severity で、当てる規則を選ぶ (error か warning)。prh の辞書と違い、
// 報告ごとに重大度を付けられるので、1 つのルールで両方を扱える。
// 段落 (Paragraph) を単位に当てる。Str を単位にすると、強調やリンクで文が切れて、
// 語の並びが途中で分かれるため。コード (Code、CodeBlock) は当てない。
import { check, loadRules } from "../lib/morph.mjs"

const LEVEL = { warning: 1, error: 2 }

export default function (context, options = {}) {
	const { Syntax, getSource, locator, report } = context
	const want = options.severity ?? "error"
	const rules = loadRules().filter((r) => r.severity === want)
	const run = async (node) => {
		// 段落の元の文字列のうち、インラインのコードを同じ長さの空白に置き換える。位置を変えないため
		let text = getSource(node)
		for (const child of node.children ?? []) {
			if (child.type !== Syntax.Code) continue
			const s = child.range[0] - node.range[0]
			const e = child.range[1] - node.range[0]
			text = text.slice(0, s) + " ".repeat(e - s) + text.slice(e)
		}
		for (const h of await check(text, rules)) {
			report(node, {
				message: `「${h.text}」→ ${h.rule.say}（${h.rule.why}）[${h.rule.id}]`,
				padding: locator.range([h.start, h.end]),
				severity: LEVEL[want],
			})
		}
	}
	return {
		[Syntax.Paragraph]: run,
		[Syntax.Header]: run,
		[Syntax.TableCell]: run,
	}
}
