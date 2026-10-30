// kuromoji の語の並びから「名詞＋助詞＋述語」の組を取り出す。
// 集計（corpus/build.mjs）と点検（bin/find-confusion.mjs）で同じ関数を使い、取り出し方をそろえる。
// 「で」「と」「は」「も」は、「自動で」「事前に」のような副詞の働きや主題を受けることが多いので見ない
export const PARTICLES = new Set(["を", "が", "に", "から"])
// 目的語として見る名詞。「こと」「ため」（非自立）、「何」（代名詞）、「事前」（副詞可能）は外す
const CONTENT = new Set(["一般", "サ変接続", "固有名詞", "接尾"])
const isContent = (t, i, tokens) =>
	t?.pos === "名詞" && (CONTENT.has(t.pos_detail_1) || (t.pos_detail_1 === "非自立" && tokens[i - 1]?.pos === "名詞" && tokens[i - 1].pos_detail_1 === "一般"))

// 助詞の直後の述語を、基本形で返す。副詞は 2 語まで飛ばす。
// 「取得する」「取得できる」「取得し」は「取得する」にそろえる（サ変名詞＋する・できる）
function predicateAt(tokens, j) {
	let skipped = 0
	while (tokens[j]?.pos === "副詞" && skipped < 2) {
		j++
		skipped++
	}
	const t = tokens[j]
	if (!t) return null
	if (t.pos === "動詞" && t.pos_detail_1 === "自立") return { verb: t.basic_form, end: j }
	const next = tokens[j + 1]
	if (t.pos === "名詞" && t.pos_detail_1 === "サ変接続" && next?.pos === "動詞" && ["する", "できる", "出来る"].includes(next.basic_form)) {
		return { verb: t.surface_form + "する", end: j + 1 }
	}
	return null
}

// 組を返す。名詞は、続いた名詞の後ろから 1〜3 語をつないだ形をすべて返す
// （「ファイルのロック」なら「ロック」、「トーク」「ン」なら「ン」「トークン」）。
// 照合では、いちばん長く一致した形を使う
export function pairs(tokens) {
	const out = []
	tokens.forEach((t, p) => {
		if (t.pos !== "助詞" || !PARTICLES.has(t.surface_form)) return
		let k = p - 1
		// 「トーク」「ン」の「ン」のように、一般名詞に続く非自立の語は、つないで 1 語として見る
		if (!isContent(tokens[k], k, tokens)) return
		const pred = predicateAt(tokens, p + 1)
		if (!pred) return
		const nouns = []
		for (let n = 1; n <= 3 && k - n + 1 >= 0 && tokens[k - n + 1].pos === "名詞"; n++) {
			nouns.push(tokens.slice(k - n + 1, k + 1).map((u) => u.surface_form).join(""))
		}
		out.push({ nouns, particle: t.surface_form, verb: pred.verb, start: k, end: pred.end })
	})
	return out
}
