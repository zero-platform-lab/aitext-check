#!/usr/bin/env node
// aitext-check — 日本語の文章を規則ベースで校正する CLI。内包の設定で textlint を回す。
//
//   aitext-check [paths...]          語彙（prh 辞書）。既定の対象は docs と README.md
//   aitext-check --prose [paths...]  書き方（ja-technical-writing）。文書だけに適用する
//   aitext-check --warn [paths...]   気をつける語（止めない・warning）
//   printf '%s' "$文" | aitext-check --prose -   標準入力を流し込む
//
// 規則パッケージと prh 辞書はこのパッケージの依存・同梱物なので、textlint は必ず
// このパッケージのディレクトリを cwd にして起動する。対象のパスは、呼び出し元の
// cwd を基準に絶対パスへ直してから渡す。こうすると、規則の解決と辞書の参照は
// パッケージ側、検査する file は利用側、と両立する。
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const require = createRequire(import.meta.url)
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
const args = ["-c", CONFIG[mode]]

if (argv[0] === "-") {
	argv.shift()
	args.push("--stdin", "--stdin-filename", "流し込み.md")
} else {
	const targets = (argv.length ? argv : ["docs", "README.md"]).map((t) => path.resolve(userCwd, t))
	// 書き方の規則から外す file は、利用側 repo の .textlintignore.prose を使う。
	if (mode === "prose") {
		const ignore = path.resolve(userCwd, ".textlintignore.prose")
		if (existsSync(ignore)) args.push("--ignore-path", ignore)
	}
	args.push(...targets)
}

const res = spawnSync(process.execPath, [textlintBin, ...args], { cwd: pkgRoot, stdio: "inherit" })
process.exit(res.status ?? 1)
