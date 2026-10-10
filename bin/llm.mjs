// aitext-check --llm: ローカル LLM（Ollama）に文書を読ませて、ルールでは見つけにくい問題を指摘させる。
//
//   aitext-check --llm [オプション] <paths...>
//     --model <名前>   Ollama のモデル（既定: 環境変数 AITEXT_LLM_MODEL、なければ qwen3.6:35b-a3b）
//     --url <URL>      Ollama の URL（既定: 環境変数 AITEXT_LLM_URL、なければ http://localhost:11434）
//     --fast           考える過程（thinking）を使わない。速いが、外れの指摘が増える
//     --max <件数>     1 ファイルあたりの指摘の上限（既定: 8）
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

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, "..")

const argv = process.argv.slice(2)
const opt = {
	model: process.env.AITEXT_LLM_MODEL || "qwen3.6:35b-a3b",
	url: (process.env.AITEXT_LLM_URL || "http://localhost:11434").replace(/\/$/, ""),
	think: true,
	max: 8,
}
const files = []
for (let i = 0; i < argv.length; i++) {
	const a = argv[i]
	if (a === "--llm") continue
	else if (a === "--model") opt.model = argv[++i]
	else if (a === "--url") opt.url = argv[++i].replace(/\/$/, "")
	else if (a === "--fast") opt.think = false
	else if (a === "--max") opt.max = Number(argv[++i]) || 8
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
const system = readFileSync(path.join(pkgRoot, "llm", "prompt.md"), "utf8")
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

let failed = false
for (const f of files) {
	const doc = readFileSync(path.resolve(f), "utf8")
	process.stderr.write(`${f}: ${opt.model} に送りました（${opt.think ? "数分から 20 分" : "数分"}ほどかかります）\n`)
	const started = Date.now()
	// 少しずつ返してもらう（stream）。全部書き終わるまで何も返さない形にすると、Node.js の fetch は
	// ヘッダーを 5 分待ったところで接続を切る（UND_ERR_HEADERS_TIMEOUT）
	let out = ""
	try {
		const r = await fetch(`${opt.url}/api/chat`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				model: opt.model,
				stream: true,
				think: opt.think,
				options: { temperature: 0.2, num_ctx: 32768 },
				messages: [
					{ role: "system", content: system },
					{ role: "user", content: "文書:\n\n" + doc },
				],
			}),
			signal: AbortSignal.timeout(60 * 60 * 1000),
		})
		if (!r.ok) throw new Error(`HTTP ${r.status} ${await r.text()}`)
		let buf = "", phase = ""
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
					process.stderr.write(`${f}: ${phase}（${Math.round((Date.now() - started) / 1000)} 秒）\n`)
				}
				out += part.message?.content || ""
			}
		}
	} catch (e) {
		console.error(`${f}: Ollama（${opt.url}）から結果を受け取れませんでした: ${e.cause?.code || e.message}`)
		failed = true
		continue
	}
	const seconds = Math.round((Date.now() - started) / 1000)
	out = out.trim()
	const lines = [`## ${f}（${seconds} 秒）`, ""]
	for (const l of out.split("\n")) {
		lines.push(l)
		const m = /^\s*-\s*方向[:：]\s*(.+)$/.exec(l)
		if (m) {
			const hits = ruleHits(m[1])
			if (hits.length) lines.push(`  - aitext-check: ${hits.join(" / ")}`)
		}
	}
	console.log(lines.join("\n") + "\n")
}
process.exit(failed ? 1 : 0)
