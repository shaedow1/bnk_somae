// 댓글 API — GitHub 저장소(db 브랜치의 data/comments.json)를 DB로 사용
// GITHUB_TOKEN 환경변수(Contents: Read and write 권한 PAT) 필요
const REPO = "shaedow1/bnk_somae";
const BRANCH = "db";
const FILE = "data/comments.json";

const gh = (path, opts = {}) => fetch("https://api.github.com" + path, {
  ...opts,
  headers: {
    "Authorization": "Bearer " + process.env.GITHUB_TOKEN,
    "Accept": "application/vnd.github+json",
    "User-Agent": "bnk-somae-comments",
    ...(opts.headers || {}),
  },
});

async function readFile() {
  const r = await gh(`/repos/${REPO}/contents/${FILE}?ref=${BRANCH}&t=` + Date.now());
  if (r.status === 404) return { data: {}, sha: null };
  if (!r.ok) throw new Error("github read " + r.status);
  const j = await r.json();
  return { data: JSON.parse(Buffer.from(j.content, "base64").toString("utf8") || "{}"), sha: j.sha };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!process.env.GITHUB_TOKEN) return res.status(500).json({ error: "GITHUB_TOKEN env var not set" });
  try {
    if (req.method === "GET") {
      const { data } = await readFile();
      return res.status(200).json(data);
    }
    if (req.method === "POST") {
      const { k, name, text } = req.body || {};
      if (typeof k !== "string" || !/^q[0-9a-z]{1,16}$/.test(k)) return res.status(400).json({ error: "bad key" });
      const nm = String(name || "익명").trim().slice(0, 20) || "익명";
      const tx = String(text || "").trim().slice(0, 1000);
      if (!tx) return res.status(400).json({ error: "empty text" });
      const time = new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 16); // KST
      for (let attempt = 0; attempt < 3; attempt++) {
        const { data, sha } = await readFile();
        (data[k] = data[k] || []).push({ name: nm, text: tx, time });
        const body = {
          message: "comment: " + k,
          content: Buffer.from(JSON.stringify(data)).toString("base64"),
          branch: BRANCH,
        };
        if (sha) body.sha = sha;
        const w = await gh(`/repos/${REPO}/contents/${FILE}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (w.ok) return res.status(200).json({ list: data[k] });
        if (w.status !== 409 && w.status !== 422) {
          const detail = await w.text().catch(() => "");
          throw new Error("github write " + w.status + ": " + detail.slice(0, 300));
        }
        // 동시 저장 충돌 → 다시 읽어서 재시도
      }
      return res.status(503).json({ error: "conflict" });
    }
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    return res.status(502).json({ error: String((e && e.message) || e) });
  }
};
