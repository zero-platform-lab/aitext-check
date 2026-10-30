// corpus/build.mjs（DB を作る）と bin/find-confusion.mjs（DB で比べる）が使う、表と DB の場所。
// node:sqlite を読み込まないので、Node 22.13 より古い Node でも読み込める
import { readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))

export function defaultDbPath() {
	return process.env.AITEXT_CORPUS_DB || path.join(os.homedir(), ".cache", "aitext-check", "corpus.db")
}

// confusion.md の表から、口語の動詞 → 定着した動詞の一覧を返す
export function readConfusion(file = path.join(HERE, "confusion.md")) {
	const sets = new Map()
	for (const line of readFileSync(file, "utf8").split("\n")) {
		const cells = line.split("|").map((c) => c.trim())
		if (cells.length < 4 || !/[ぁ-ん]/.test(cells[2]) || cells[2] === "口語の動詞") continue
		for (const v of cells[2].split("、")) sets.set(v, cells[3].split("、"))
	}
	return sets
}
