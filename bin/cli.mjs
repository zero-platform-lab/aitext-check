#!/usr/bin/env node
// aitext-check: 日本語の文章をルールベースで校正する CLI。同梱の設定で textlint を実行する。
//
//   aitext-check [paths...]          語彙（prh 辞書）。既定の対象はリポジトリの .md すべて
//   aitext-check --prose [paths...]  書き方（ja-technical-writing）。文書だけに適用する
//   aitext-check --warn [paths...]   気をつける語句（warning を出すだけで、失敗扱いにしない）。
//                                    「ではなく」が 3 回以上ある節も出す（bin/count-dewanaku.mjs）。
//                                    体言止めの文が 3 個以上ある節も出す（bin/count-taigen.mjs）。
//                                    動詞を名詞として使った箇所も、形態素解析で出す（bin/find-nominal.mjs）
//                                    責任を避ける書き方も、文の組み立てから出す（bin/find-avoidance.mjs）
//                                    数値やデータの扱いを口語の動詞で書いた箇所も出す（bin/find-colloquial.mjs）
//   printf '%s' "$文" | aitext-check --prose -   標準入力から読み込む
//   aitext-check --llm <paths...>    ローカル LLM（Ollama）で読む（bin/llm.mjs、llm.md）
//   printf '%s' "$返答" | aitext-check --warn --reply -   返答を読む。「」の中は読まない
//                                    番号を振らずに 2 つ以上の質問をしている箇所も出す（bin/find-questions.mjs）
//
// **プロジェクト固有の語句は、利用側のリポジトリに置く。** 製品名の表記のように、
// このパッケージの辞書に入れられない語句は、利用側に prh の形式で書けば同梱の辞書に
// 足して読む（`aitext-words.yml` が語彙、`aitext-words.warn.yml` が気をつける語句）。
//
// textlint は利用側のディレクトリ（呼び出し元のカレントディレクトリ）で起動する。
// 対象のパスと .textlintignore は、利用側を基準に解釈されるようにするため。
// ルールのパッケージは、このパッケージの依存として入っている場所（--rules-base-directory）
// から、prh の辞書は設定ファイルの場所から読み込む。
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs"
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
}
// 返答を読むときは、「」の中を読まない。返答では、検出する語そのもの（「未確認」）を引いて
// 説明することが多いため。文書では「」の中にも直すべき文が入るので、--reply のときだけにする
let reply = false
if (mode === "warn" && argv[0] === "--reply") {
	reply = true
	argv.shift()
}

const CONFIG = {
	vocab: ".textlintrc.yml",
	prose: ".textlintrc.prose.yml",
	warn: ".textlintrc.warn.yml",
}

// 利用側のリポジトリに置く、プロジェクト固有の辞書。prh の形式で書く。
// 書き方のルール（--prose）は語句の辞書を使わないので、足す先は語彙と気をつける語句だけ。
const LOCAL_DICT = {
	vocab: "aitext-words.yml",
	warn: "aitext-words.warn.yml",
}

// 設定ファイルは同梱のものを使う。利用側の辞書があるときだけ、rulePaths に 1 行足したものを
// 一時ファイルに書き出す。**同梱の辞書のパスも絶対パスに直す。** prh は rulePaths を設定
// ファイルの場所から解決するので、一時ファイルに書くと `./prh-error.yml` が見つからなくなる
let configPath = path.join(pkgRoot, CONFIG[mode])
let tmpConfigDir = null
const localDict = LOCAL_DICT[mode] ? path.join(userCwd, LOCAL_DICT[mode]) : null
if (localDict && existsSync(localDict)) {
	const text = readFileSync(configPath, "utf8")
		.replace(/^(\s*)-\s*\.\/(\S+\.yml)\s*$/gm, (_, indent, f) => `${indent}- ${JSON.stringify(path.join(pkgRoot, f))}`)
		.replace(/^(\s*rulePaths:\s*)$/m, (m) => `${m}\n      - ${JSON.stringify(localDict)}`)
	tmpConfigDir = mkdtempSync(path.join(os.tmpdir(), "aitext-check-config-"))
	configPath = path.join(tmpConfigDir, CONFIG[mode])
	writeFileSync(configPath, text)
}
const args = ["-c", configPath, "--rules-base-directory", rulesDir]

// 「」の中の文字を ＿ にする。改行は残し、警告の行番号を変えない
function maskQuotes(text) {
	let depth = 0
	return text.split("").map((c) => {
		if (c === "「") {
			depth++
			return c
		}
		if (c === "」" && depth > 0) {
			depth--
			return c
		}
		return depth > 0 && c !== "\n" ? "＿" : c
	}).join("")
}

// 気をつける語句では、textlint の後に「ではなく」を節ごとに数える。標準入力の文は 2 回読むので、
// 一時ファイルに書いておく
let targets = []
let stdinText = null
if (argv[0] === "-") {
	argv.shift()
	args.push("--stdin", "--stdin-filename", "標準入力.md")
	if (mode === "warn") stdinText = readFileSync(0, "utf8")
	if (reply) stdinText = maskQuotes(stdinText)
	// 「-」の後ろのオプション（--format json など）も textlint に渡す
	args.push(...argv)
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

// 「ではなく」と体言止めの数え上げ、動詞を名詞として使った箇所、責任を避ける書き方、口語の動詞で書いた数値やデータの扱い。--format で出力の形式を変えたとき（JSON など）は、形式が混ざるので出さない
if (mode === "warn" && !argv.includes("--format") && !argv.includes("-f")) {
	let tmp = null
	let files = targets.filter((t) => t.endsWith(".md"))
	if (stdinText !== null) {
		tmp = mkdtempSync(path.join(os.tmpdir(), "aitext-check-"))
		files = [path.join(tmp, "標準入力.md")]
		writeFileSync(files[0], stdinText)
	}
	spawnSync(process.execPath, [path.join(pkgRoot, "bin", "count-dewanaku.mjs"), ...files], { cwd: userCwd, stdio: "inherit" })
	spawnSync(process.execPath, [path.join(pkgRoot, "bin", "count-taigen.mjs"), ...files], { cwd: userCwd, stdio: "inherit" })
	spawnSync(process.execPath, [path.join(pkgRoot, "bin", "find-nominal.mjs"), ...files], { cwd: userCwd, stdio: "inherit" })
	spawnSync(process.execPath, [path.join(pkgRoot, "bin", "find-avoidance.mjs"), ...files], { cwd: userCwd, stdio: "inherit" })
	spawnSync(process.execPath, [path.join(pkgRoot, "bin", "find-colloquial.mjs"), ...files], { cwd: userCwd, stdio: "inherit" })
	// 返答を読むときだけ、番号を振らずに 2 つ以上の質問をしている箇所も出す
	if (reply) spawnSync(process.execPath, [path.join(pkgRoot, "bin", "find-questions.mjs"), ...files], { cwd: userCwd, stdio: "inherit" })
	if (tmp) rmSync(tmp, { recursive: true, force: true })
}
if (tmpConfigDir) rmSync(tmpConfigDir, { recursive: true, force: true })
process.exit(res.status ?? 1)
