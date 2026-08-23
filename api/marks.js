// 학습기록 API — 닉네임별 "알고 있음" 문제 목록을 GitHub 저장소(db 브랜치 data/marks.json)에 저장
const REPO = "shaedow1/bnk_somae";
const BRANCH = "db";
const FILE = "data/marks.json";

const gh = (path, opts = {}) => fetch("https://api.github.com" + path, {
  ...opts,
  headers: {
    "Authorization": "Bearer " + process.env.GITHUB_TOKEN,
    "Accept": "application/vnd.github+json",
    "User-Agent": "bnk-somae-marks",
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
      const name = String((req.query && req.query.name) || "").trim().slice(0, 20);
      if (!name) return res.status(400).json({ error: "name required" });
      const { data } = await readFile();
      return res.status(200).json({ known: data[name] || [] });
    }
    if (req.method === "POST") {
      const { name, known } = req.body || {};
      const nm = String(name || "").trim().slice(0, 20);
      if (!nm) return res.status(400).json({ error: "name required" });
      if (!Array.isArray(known) || known.length > 1000 || known.some(k => typeof k !== "string" || !/^q[0-9a-z]{1,16}$/.test(k)))
        return res.status(400).json({ error: "bad known list" });
      for (let attempt = 0; attempt < 3; attempt++) {
        const { data, sha } = await readFile();
        data[nm] = [...new Set(known)];
        const body = {
          message: "marks: " + nm,
          content: Buffer.from(JSON.stringify(data)).toString("base64"),
          branch: BRANCH,
        };
        if (sha) body.sha = sha;
        const w = await gh(`/repos/${REPO}/contents/${FILE}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (w.ok) return res.status(200).json({ known: data[nm] });
        if (w.status !== 409 && w.status !== 422) {
          const detail = await w.text().catch(() => "");
          throw new Error("github write " + w.status + ": " + detail.slice(0, 300));
        }
      }
      return res.status(503).json({ error: "conflict" });
    }
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    return res.status(502).json({ error: String((e && e.message) || e) });
  }
};
