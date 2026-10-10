#!/usr/bin/env node
// aitext-check — 日本語の文章を規則ベースで校正する CLI。内包の設定で textlint を回す。
//
//   aitext-check [paths...]          語彙（prh 辞書）。既定の対象はリポジトリの .md すべて
//   aitext-check --prose [paths...]  書き方（ja-technical-writing）。文書だけに適用する
//   aitext-check --warn [paths...]   気をつける語（止めない・warning）
//   printf '%s' "$文" | aitext-check --prose -   標準入力を流し込む
//
// textlint は利用側のディレクトリ（呼び出し元のカレントディレクトリ）で起動する。
// 対象のパスと .textlintignore は、利用側を基準に解釈されるようにするため。
// ルールのパッケージは、このパッケージの依存として入っている場所（--rules-base-directory）
// から、prh の辞書は設定ファイルの場所から読み込む。
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { existsSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

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

const CONFIG = {
	vocab: ".textlintrc.yml",
	prose: ".textlintrc.prose.yml",
	warn: ".textlintrc.warn.yml",
}
const args = ["-c", path.join(pkgRoot, CONFIG[mode]), "--rules-base-directory", rulesDir]

if (argv[0] === "-") {
	argv.shift()
	args.push("--stdin", "--stdin-filename", "標準入力.md")
} else {
	const targets = argv.length ? argv : markdownFiles(userCwd)
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
	stdio: ["inherit", "pipe", "inherit"],
	env: { ...process.env, ...color },
	encoding: "utf8",
	maxBuffer: 64 * 1024 * 1024,
})
const plain = (l) => l.replace(/\x1b\[[0-9;]*m/g, "")
const shown = (res.stdout ?? "").split("\n").filter((l) => !/fixable problems?\.?$|^Try to run: \$ textlint --fix/.test(plain(l).trim()))
process.stdout.write(shown.join("\n"))
process.exit(res.status ?? 1)
