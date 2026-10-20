#!/usr/bin/env node
// aitext-check: 日本語の文章をルールベースで校正する CLI。同梱の設定で textlint を実行する。
//
//   aitext-check [paths...]          語彙（prh 辞書）。既定の対象はリポジトリの .md すべて
//   aitext-check --prose [paths...]  書き方（ja-technical-writing）。文書だけに適用する
//   aitext-check --warn [paths...]   気をつける語句（warning を出すだけで、失敗扱いにしない）。
//                                    「ではなく」が 3 回以上ある節も出す（bin/count-dewanaku.mjs）
//   printf '%s' "$文" | aitext-check --prose -   標準入力から読み込む
//   aitext-check --llm <paths...>    ローカル LLM（Ollama）で読む（bin/llm.mjs、llm.md）
//
// textlint は利用側のディレクトリ（呼び出し元のカレントディレクトリ）で起動する。
// 対象のパスと .textlintignore は、利用側を基準に解釈されるようにするため。
// ルールのパッケージは、このパッケージの依存として入っている場所（--rules-base-directory）
// から、prh の辞書は設定ファイルの場所から読み込む。
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync, symlinkSync } from "node:fs"
import os from "node:os"
import { fileURLToPath } from "node:url"
import path from "node:path"

// ローカル LLM で読むモードは、別のスクリプトに任せる（終わると、そちらで終了する）
if (process.argv[2] === "--llm") await import("./llm.mjs")

const require = createRequire(import.meta.url)
// ルールのパッケージが入っている node_modules。npm が利用側の node_modules にまとめて
// 置くこともあるので、このパッケージの node_modules とは決め打ちしない
const rulesDir = path.resolve(path.dirname(require.resolve("textlint-rule-preset-ja-technical-writing/package.json")), "..")
const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const userCwd = process.cwd()

// textlint の実行ファイルを、このパッケージの依存として解決する。
const textlintPkgPath = require.resolve("textlint/package.json")
const textlintPkg = require(textlintPkgPath)
const binField = textlintPkg.bin
const binRel = typeof binField === "string" ? binField : binField.textlint
const textlintBin = path.join(path.dirname(textlintPkgPath), binRel)

const argv = process.argv.slice(2)
let mode = "vocab"
if (argv[0] === "--prose") {
	mode = "prose"
	argv.shift()
} else if (argv[0] === "--warn") {
	mode = "warn"
	argv.shift()
} else if (argv[0] === "--morph") {
	mode = "morph"
	argv.shift()
}

const CONFIG = {
	vocab: ".textlintrc.yml",
	prose: ".textlintrc.prose.yml",
	warn: ".textlintrc.warn.yml",
	morph: ".textlintrc.morph.yml",
}
// 形態素解析の規則は、このパッケージの textlint-rules/aitext-morph にあるルールで当てる。
// textlint は設定ファイルのルールを、--rules-base-directory の下の npm パッケージとしてしか探さない
// (--rulesdir で渡すと、設定ファイルの読み込みが失敗し、options と filters が黙って捨てられた)。
// そこで一時ディレクトリに、このルールと、設定が使うフィルターへのリンクを置いて渡す
let rulesBase = rulesDir
let morphBase = null
if (mode === "morph") {
	morphBase = mkdtempSync(path.join(os.tmpdir(), "aitext-check-rules-"))
	symlinkSync(path.join(pkgRoot, "textlint-rules", "aitext-morph"), path.join(morphBase, "textlint-rule-aitext-morph"), "dir")
	symlinkSync(path.join(rulesDir, "textlint-filter-rule-comments"), path.join(morphBase, "textlint-filter-rule-comments"), "dir")
	rulesBase = morphBase
}
const args = ["-c", path.join(pkgRoot, CONFIG[mode]), "--rules-base-directory", rulesBase]

// 気をつける語句では、textlint の後に「ではなく」を節ごとに数える。標準入力の文は 2 回読むので、
// 一時ファイルに書いておく
let targets = []
let stdinText = null
if (argv[0] === "-") {
	argv.shift()
	args.push("--stdin", "--stdin-filename", "標準入力.md")
	if (mode === "warn") stdinText = readFileSync(0, "utf8")
} else {
	targets = argv.length ? argv : markdownFiles(userCwd)
	if (targets.length === 0) {
		console.error("対象の .md ファイルがありません")
		process.exit(1)
	}
	// 対象から外すファイルは、利用側のリポジトリの .textlintignore（書き方のチェックは
	// .textlintignore.prose）に書く。textlint はこのパッケージのディレクトリで起動するので、
	// 渡さないと利用側の .textlintignore が読まれない
	const ignore = mode === "prose" ? ".textlintignore.prose" : ".textlintignore"
	if (existsSync(path.join(userCwd, ignore))) args.push("--ignore-path", ignore)
	args.push(...targets)
}

// 既定の対象: リポジトリの .md ファイルすべて。git のリポジトリの中なら git が管理して
// いるファイル（.gitignore で外したものは除く）、そうでなければカレントディレクトリより
// 下を探す（node_modules と、. で始まるディレクトリは除く）。パスはカレントディレクトリから
function markdownFiles(dir) {
	const git = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "*.md"], { cwd: dir, encoding: "utf8" })
	if (git.status === 0) return git.stdout.split("\0").filter((f) => f && existsSync(path.join(dir, f))).sort()
	return walk(dir).map((p) => path.relative(dir, p))
}
function walk(dir) {
	const out = []
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		if (e.name.startsWith(".") || e.name === "node_modules") continue
		const p = path.join(dir, e.name)
		if (e.isDirectory()) out.push(...walk(p))
		else if (e.isFile() && e.name.endsWith(".md")) out.push(p)
	}
	return out.sort()
}

// 結果の末尾の「✓ N fixable problems. / Try to run: $ textlint --fix」は出さない。
// aitext-check は直さない（--fix に対応していない）ので、案内が誤解を招く
const color = process.stdout.isTTY ? { FORCE_COLOR: "1" } : {}
const res = spawnSync(process.execPath, [textlintBin, ...args], {
	cwd: userCwd,
	stdio: [stdinText === null ? "inherit" : "pipe", "pipe", "inherit"],
	input: stdinText ?? undefined,
	env: { ...process.env, ...color },
	encoding: "utf8",
	maxBuffer: 64 * 1024 * 1024,
})
const plain = (l) => l.replace(/\x1b\[[0-9;]*m/g, "")
const shown = (res.stdout ?? "").split("\n").filter((l) => !/fixable problems?\.?$|^Try to run: \$ textlint --fix/.test(plain(l).trim()))
process.stdout.write(shown.join("\n"))

// 「ではなく」の数え上げ。--format で出力の形式を変えたとき（JSON など）は、形式が混ざるので出さない
if (mode === "warn" && !argv.includes("--format") && !argv.includes("-f")) {
	let tmp = null
	let files = targets.filter((t) => t.endsWith(".md"))
	if (stdinText !== null) {
		tmp = mkdtempSync(path.join(os.tmpdir(), "aitext-check-"))
		files = [path.join(tmp, "標準入力.md")]
		writeFileSync(files[0], stdinText)
	}
	spawnSync(process.execPath, [path.join(pkgRoot, "bin", "count-dewanaku.mjs"), ...files], { cwd: userCwd, stdio: "inherit" })
	if (tmp) rmSync(tmp, { recursive: true, force: true })
}
if (morphBase) rmSync(morphBase, { recursive: true, force: true })
process.exit(res.status ?? 1)
