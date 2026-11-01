#!/usr/bin/env node
// 日本語版 Wikipedia のダンプから、「名詞＋助詞＋動詞」の組の件数を数え、SQLite の DB に書く。
// bin/find-confusion.mjs が、この DB で書いた動詞と定着した動詞の件数を比べる。
//
//   node corpus/build.mjs <jawiki-latest-pages-articles.xml.bz2> [出力する DB]
//
// 出力する DB を省くと、環境変数 AITEXT_CORPUS_DB、それも無ければ ~/.cache/aitext-check/corpus.db に書く。
// 手順は次の 3 つ。8 コアの機械で、合わせて 30 分ほどかかる。
//
// 1. bzcat で展開しながら、extract-wiki.mjs が記事の地の文を CPU の数のファイルに振り分ける（約 4 GB）
// 2. ファイルごとに子プロセスを立て、並列に形態素解析して組を数える
// 3. 子プロセスの DB を 1 つに足し合わせ、振り分けたファイルを消す
//
// 数えるのは、confusion.md の表に出てくる動詞の組だけ。表を直したら、DB を作り直す。
import { spawn } from "node:child_process"
import { mkdirSync, readFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { DatabaseSync } from "node:sqlite"
import { tokenize } from "kuromojin"
import { defaultDbPath, readConfusion } from "./confusion.mjs"
import { pairs } from "./pairs.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCHEMA = "CREATE TABLE IF NOT EXISTS pair (noun TEXT, particle TEXT, verb TEXT, n INTEGER, PRIMARY KEY (noun, particle, verb)) WITHOUT ROWID"

// 子プロセス：1 つのファイルの組を数えて、DB に書く
async function count(textFile, dbPath) {
	const verbs = new Set([...readConfusion()].flatMap(([v, alts]) => [v, ...alts]))
	// 表の動詞の頭の漢字を含まない文は、形態素解析をせずに飛ばす（解析が時間の大半を占める）
	const stems = new RegExp(`[${[...new Set([...verbs].map((v) => v[0]))].join("")}]`)
	const counts = new Map()
	for (const para of readFileSync(textFile, "utf8").split("\n")) {
		for (const s of para.split(/(?<=[。！？])/)) {
			if (!/[ぁ-ん]/.test(s) || !stems.test(s)) continue
			for (const p of pairs(await tokenize(s))) {
				if (!verbs.has(p.verb)) continue
				for (const noun of p.nouns) {
					const key = `${noun}\t${p.particle}\t${p.verb}`
					counts.set(key, (counts.get(key) || 0) + 1)
				}
			}
		}
	}
	const db = new DatabaseSync(dbPath)
	db.exec(SCHEMA)
	const ins = db.prepare("INSERT INTO pair VALUES (?, ?, ?, ?)")
	db.exec("BEGIN")
	for (const [k, n] of counts) ins.run(...k.split("\t"), n)
	db.exec("COMMIT")
	db.close()
}

function run(cmd, args, opts = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args, { stdio: "inherit", ...opts })
		child.on("error", reject)
		child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} が ${code} で終わった`))))
	})
}

async function build(dumpPath, dbPath) {
	const work = `${dbPath}.work`
	mkdirSync(work, { recursive: true })
	const n = os.availableParallelism()
	const started = Date.now()
	const elapsed = () => `${Math.round((Date.now() - started) / 60000)} 分`

	process.stderr.write(`1/3 記事の地の文を ${n} 個のファイルに取り出す\n`)
	await new Promise((resolve, reject) => {
		const bz = spawn("bzcat", [dumpPath], { stdio: ["ignore", "pipe", "inherit"] })
		const ex = spawn(process.execPath, [path.join(HERE, "extract-wiki.mjs"), work, String(n)], { stdio: ["pipe", "inherit", "inherit"] })
		bz.stdout.pipe(ex.stdin)
		bz.on("error", reject)
		ex.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`extract-wiki.mjs が ${code} で終わった`))))
	})

	process.stderr.write(`2/3 ${n} 個の子プロセスで組を数える（${elapsed()}）\n`)
	const parts = Array.from({ length: n }, (_, i) => path.join(work, `wiki-${i}`))
	await Promise.all(parts.map((p) => run(process.execPath, [fileURLToPath(import.meta.url), "--count", `${p}.txt`, `${p}.db`])))

	process.stderr.write(`3/3 DB を足し合わせる（${elapsed()}）\n`)
	rmSync(dbPath, { force: true })
	const db = new DatabaseSync(dbPath)
	db.exec(SCHEMA)
	for (const p of parts) {
		db.exec(`ATTACH DATABASE '${p.replace(/'/g, "''")}.db' AS part`)
		db.exec("INSERT INTO pair SELECT * FROM part.pair WHERE true ON CONFLICT (noun, particle, verb) DO UPDATE SET n = n + excluded.n")
		db.exec("DETACH DATABASE part")
	}
	const { kinds, total } = db.prepare("SELECT count(*) AS kinds, sum(n) AS total FROM pair").get()
	db.close()
	rmSync(work, { recursive: true })
	process.stderr.write(`${dbPath} に、組 ${kinds} 種類、${total} 件を書いた（${elapsed()}）\n`)
}

const argv = process.argv.slice(2)
if (argv[0] === "--count") await count(argv[1], argv[2])
else if (argv.length) {
	const dbPath = argv[1] || defaultDbPath()
	mkdirSync(path.dirname(dbPath), { recursive: true })
	await build(argv[0], dbPath)
} else {
	console.error("使い方: node corpus/build.mjs <jawiki-latest-pages-articles.xml.bz2> [出力する DB]")
	process.exit(1)
}
