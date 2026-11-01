// Wikipedia の XML ダンプ（標準入力）から、記事（ns 0、転送ページを除く）の地の文を取り出し、
// 記事の番号で N 個のファイルに振り分けて書く。箇条書き・表・見出し・テンプレートは外す。
// corpus/build.mjs が呼び出す。単独で実行するときは次のとおり。
//   bzcat jawiki.xml.bz2 | node extract-wiki.mjs <出力ディレクトリ> <N>
import { createWriteStream, mkdirSync } from "node:fs"
import path from "node:path"
import readline from "node:readline"

const [outDir, shards = "8"] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })
const outs = Array.from({ length: Number(shards) }, (_, i) => createWriteStream(path.join(outDir, `wiki-${i}.txt`)))

const decode = (s) =>
	s
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
		.replace(/&amp;/g, "&")

// 入れ子を内側から外す
function stripNested(s, re) {
	let prev
	do {
		prev = s
		s = s.replace(re, "")
	} while (s !== prev)
	return s
}

function clean(wiki) {
	let s = decode(wiki)
	s = s.replace(/<!--[\s\S]*?-->/g, "")
	s = s.replace(/<ref[^>]*\/>/g, "").replace(/<ref[\s\S]*?<\/ref>/g, "")
	s = s.replace(/<(math|code|pre|syntaxhighlight|source|gallery|timeline|score)[\s\S]*?<\/\1>/g, "")
	s = stripNested(s, /\{\{[^{}]*\}\}/g)
	s = stripNested(s, /\{\|[^{}]*?\|\}/g)
	s = s.replace(/\[\[(?:ファイル|画像|File|Image|Category|カテゴリ):[^\[\]]*(?:\[\[[^\]]*\]\][^\[\]]*)*\]\]/gi, "")
	s = s.replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1").replace(/\[\[([^\]]*)\]\]/g, "$1")
	s = s.replace(/\[https?:[^\s\]]*\s*([^\]]*)\]/g, "$1")
	s = s.replace(/'{2,}/g, "").replace(/<[^>]+>/g, "")
	return s
		.split("\n")
		.filter((l) => l && !/^[=*#:;|!{}\s]/.test(l))
		.join("\n")
}

let ns = null
let redirect = false
let inText = false
let buf = []
let articles = 0
function finish() {
	inText = false
	if (ns === "0" && !redirect) {
		const text = clean(buf.join("\n"))
		if (text) outs[articles % outs.length].write(text + "\n")
		if (++articles % 100000 === 0) process.stderr.write(`${articles} 記事\n`)
	}
	buf = []
}
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
for await (const line of rl) {
	if (inText) {
		const end = line.indexOf("</text>")
		if (end === -1) {
			buf.push(line)
			continue
		}
		buf.push(line.slice(0, end))
		finish()
		continue
	}
	const t = line.trimStart()
	if (t.startsWith("<page>")) {
		ns = null
		redirect = false
	} else if (t.startsWith("<ns>")) ns = t.slice(4, t.indexOf("</ns>"))
	else if (t.startsWith("<redirect")) redirect = true
	else if (t.startsWith("<text")) {
		const open = t.indexOf(">")
		if (t[open - 1] === "/") continue
		const rest = t.slice(open + 1)
		const end = rest.indexOf("</text>")
		if (end !== -1) {
			buf = [rest.slice(0, end)]
			finish()
		} else {
			buf = [rest]
			inText = true
		}
	}
}
for (const o of outs) o.end()
process.stderr.write(`${articles} 記事\n`)
