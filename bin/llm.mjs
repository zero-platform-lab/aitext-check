// aitext-check --llm: ローカル LLM（Ollama）に文書を読ませて、ルールでは見つけにくい問題を指摘させる。
//
//   aitext-check --llm [オプション] <paths...>
//     --model <名前>   Ollama のモデル（既定: 環境変数 AITEXT_LLM_MODEL、なければ qwen3.6:35b-a3b-q8_0。比べたときに使ったモデル）
//     --url <URL>      Ollama の URL（既定: 環境変数 AITEXT_LLM_URL、なければ http://localhost:11434）
//     --fast           考える過程（thinking）を使わない。速いが、外れの指摘が増える
//     --max <件数>     1 ファイルあたりの指摘の上限（既定: 8）
//     --tree           段落ごとにロジックツリーに分解させ、どの論点も支えない文（不要）と、
//                      ほかの文と同じ内容の文（重複）、段落の分け方を出す（llm/tree-prompt.md）
//     --min <文の数>   --tree で読ませる段落の最小の文の数（既定: 4）
//
// 前提: 利用側のリポジトリの .aitext-llm.md に、用語や仕組みの事実を書いておくと、指示に含める。
// LLM に読み違えさせないため（「並べ替えるとファイル名が変わる」「↑↓ は画面のボタン」など）。
//
// 指摘するだけで、ファイルは直さない。LLM が書いた「方向」の文は、aitext-check の語彙と
// 気をつける語句のルールでチェックし、当たったら一緒に表示する。
// 指示の決め方と、条件を変えて比べた結果は llm.md にある。
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { parse } from "@textlint/markdown-to-ast"

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, "..")

const argv = process.argv.slice(2)
const opt = {
	model: process.env.AITEXT_LLM_MODEL || "qwen3.6:35b-a3b-q8_0",
	url: (process.env.AITEXT_LLM_URL || "http://localhost:11434").replace(/\/$/, ""),
	think: true,
	max: 8,
	tree: false,
	min: 4,
}
const files = []
for (let i = 0; i < argv.length; i++) {
	const a = argv[i]
	if (a === "--llm") continue
	else if (a === "--model") opt.model = argv[++i]
	else if (a === "--url") opt.url = argv[++i].replace(/\/$/, "")
	else if (a === "--fast") opt.think = false
	else if (a === "--max") opt.max = Number(argv[++i]) || 8
	else if (a === "--tree") opt.tree = true
	else if (a === "--min") opt.min = Number(argv[++i]) || 4
	else files.push(a)
}
if (files.length === 0) {
	// 1 ファイルに数分から 20 分かかるので、既定の対象（.md すべて）は使わない
	console.error("対象のファイルを指定してください（例: aitext-check --llm docs/spec.md）")
	process.exit(2)
}

const contextPath = path.resolve(".aitext-llm.md")
const context = existsSync(contextPath)
	? "前提（これらは正しい事実なので、指摘しない）:\n" + readFileSync(contextPath, "utf8").replace(/^#.*\n+/m, "").trim()
	: ""
const promptOf = (name) =>
	readFileSync(path.join(pkgRoot, "llm", name), "utf8")
		.replace("{{前提}}", context)
		.replace("{{件数}}", String(opt.max))
		.replace(/\n{3,}/g, "\n\n")

// 「方向」の文を aitext-check の語彙と気をつける語句でチェックする
function ruleHits(text) {
	const hits = []
	for (const mode of [[], ["--warn"]]) {
		const r = spawnSync(process.execPath, [path.join(here, "cli.mjs"), ...mode, "-"], { input: text, encoding: "utf8" })
		for (const l of (r.stdout || "").split("\n")) {
			const m = /^\s*\d+:\d+\s+✓?\s*(?:error|warning)\s+(.+?)\s+prh\s*$/.exec(l.replace(/\x1b\[[0-9;]*m/g, ""))
			if (m) hits.push(m[1].replace(/\s+/g, " "))
		}
	}
	return hits
}

// Ollama に送り、返ってきた本文を返す。label は進み具合の表示に使う。format に "json" を渡すと JSON だけを返させる
async function chat(system, user, label, format) {
	const started = Date.now()
	// 少しずつ返してもらう（stream）。全部書き終わるまで何も返さない形にすると、Node.js の fetch は
	// ヘッダーを 5 分待ったところで接続を切る（UND_ERR_HEADERS_TIMEOUT）
	const r = await fetch(`${opt.url}/api/chat`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			model: opt.model,
			stream: true,
			think: opt.think,
			...(format ? { format } : {}),
			options: { temperature: 0.2, num_ctx: 32768 },
			messages: [
				{ role: "system", content: system },
				{ role: "user", content: user },
			],
		}),
		signal: AbortSignal.timeout(60 * 60 * 1000),
	})
	if (!r.ok) throw new Error(`HTTP ${r.status} ${await r.text()}`)
	let out = "", buf = "", phase = ""
	const decoder = new TextDecoder()
	for await (const chunk of r.body) {
		buf += decoder.decode(chunk, { stream: true })
		let nl
		while ((nl = buf.indexOf("\n")) >= 0) {
			const line = buf.slice(0, nl).trim()
			buf = buf.slice(nl + 1)
			if (!line) continue
			const part = JSON.parse(line)
			if (part.error) throw new Error(part.error)
			const now = part.message?.thinking ? "考えています" : part.message?.content ? "書いています" : phase
			if (now !== phase) {
				phase = now
				process.stderr.write(`${label}: ${phase}（${Math.round((Date.now() - started) / 1000)} 秒）\n`)
			}
			out += part.message?.content || ""
		}
	}
	return { out: out.trim(), seconds: Math.round((Date.now() - started) / 1000) }
}

// 文書全体を読ませ、指摘を Markdown で書かせる
async function reviewDocument(f, doc) {
	process.stderr.write(`${f}: ${opt.model} に送りました（${opt.think ? "数分から 20 分" : "数分"}ほどかかります）\n`)
	const { out, seconds } = await chat(promptOf("prompt.md"), "文書:\n\n" + doc, f)
	const lines = [`## ${f}（${seconds} 秒）`, ""]
	for (const l of out.split("\n")) {
		lines.push(l)
		const m = /^\s*-\s*方向[:：]\s*(.+)$/.exec(l)
		if (m) {
			const hits = ruleHits(m[1])
			if (hits.length) lines.push(`  - aitext-check: ${hits.join(" / ")}`)
		}
	}
	return lines.join("\n") + "\n"
}

function textOf(node) {
	if (node.type === "Str") return node.value
	if (node.type === "Code") return "`" + node.value + "`"
	return (node.children || []).map(textOf).join("")
}

// 段落を出てきた順に返す。表とコードブロックには入らない。<!-- textlint-disable --> の範囲は返さない
function paragraphs(doc) {
	const out = []
	let disabled = false
	const walk = (node) => {
		if (node.type === "Html") {
			if (/textlint-disable(?!-)/.test(node.value)) disabled = true
			if (/textlint-enable/.test(node.value)) disabled = false
			return
		}
		if (node.type === "Paragraph") {
			if (!disabled) out.push({ line: node.loc.start.line, text: textOf(node).replace(/\s*\n\s*/g, "") })
			return
		}
		if (node.type === "Table" || node.type === "CodeBlock") return
		for (const c of node.children || []) walk(c)
	}
	walk(parse(doc))
	return out
}

// 段落を文に分ける。括弧と「」の中の「。」では区切らない（count-paragraph.mjs と同じ）
function sentences(para) {
	const out = []
	let depth = 0
	let cur = ""
	for (const c of para) {
		cur += c
		if ("（(「".includes(c)) depth++
		else if ("）)」".includes(c) && depth > 0) depth--
		else if ("。！？".includes(c) && depth === 0) {
			out.push(cur.trim())
			cur = ""
		}
	}
	if (cur.trim()) out.push(cur.trim())
	return out
}

// ロジックツリーの JSON を、スマートフォンでも読める字下げの文に直す。文の番号には本文を添える
function formatTree(tree, sents) {
	const quote = (id) => {
		const s = sents[Number(String(id).replace(/^S/, "")) - 1]
		return s ? `${id}「${s.length > 40 ? s.slice(0, 40) + "…" : s}」` : String(id)
	}
	const lines = [`- 結論：${tree.conclusion ?? ""}`]
	for (const p of tree.points ?? []) lines.push(`  - ${p.name}：${(p.sentences ?? []).join("、")}`)
	if (tree.issues?.length) {
		lines.push("- 指摘：")
		for (const i of tree.issues) lines.push(`  - ${i.type}：${quote(i.sentence)}${i.with ? `（${i.with} と重複）` : ""}。${i.reason ?? ""}`)
	}
	// 段落の分け方は、7 文以上の段落にだけ出す（count-paragraph.mjs の警告と同じ基準）。短い段落でも分ける案を出し、分けすぎになるため
	const paras = tree.paragraphs ?? []
	if (sents.length >= 7 && paras.length > 1) lines.push(`- 段落の分け方：${paras.map((p) => p.join("・")).join(" ／ ")}`)
	return lines.join("\n")
}

// 段落ごとにロジックツリーに分解させる
async function reviewTree(f, doc) {
	const targets = paragraphs(doc)
		.map((p) => ({ ...p, sents: sentences(p.text) }))
		.filter((p) => p.sents.length >= opt.min && /[ぁ-ん]/.test(p.text))
	process.stderr.write(`${f}: ${opt.min} 文以上の段落 ${targets.length} 個を、1 つずつ ${opt.model} に送ります\n`)
	const system = promptOf("tree-prompt.md")
	const lines = []
	for (const p of targets) {
		const label = `${f}:${p.line}`
		const user = "段落:\n\n" + p.sents.map((s, i) => `S${i + 1}: ${s}`).join("\n")
		const { out, seconds } = await chat(system, user, label, "json")
		let tree
		try {
			tree = JSON.parse(out)
		} catch {
			lines.push(`## ${label}（${p.sents.length} 文、${seconds} 秒）`, "", "JSON として読めない答えが返りました:", "", out, "")
			continue
		}
		lines.push(`## ${label}（${p.sents.length} 文、${seconds} 秒）`, "", formatTree(tree, p.sents), "")
	}
	return lines.join("\n")
}

let failed = false
for (const f of files) {
	const doc = readFileSync(path.resolve(f), "utf8")
	try {
		console.log(opt.tree ? await reviewTree(f, doc) : await reviewDocument(f, doc))
	} catch (e) {
		console.error(`${f}: Ollama（${opt.url}）から結果を受け取れませんでした: ${e.cause?.code || e.message}`)
		failed = true
	}
}
process.exit(failed ? 1 : 0)
