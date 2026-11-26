// JSON feed of community-image score reports for the Sarpedon scoreboard (like /practice.json),
// plus the stored screenshots as thumbnails. Bound to localhost by default; Sarpedon proxies it.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ownerOf = (r) => r.team || r.user_name;
// better = higher score, then less time
const better = (a, b) => a.score > b.score || (a.score === b.score && (a.elapsed_seconds ?? Infinity) < (b.elapsed_seconds ?? Infinity));

// rows: community_submissions rows. Rank only counts verdict 'ok' entries.
function buildFeed(rows) {
  const byImage = new Map();
  for (const r of rows) {
    if (r.verdict === 'unreadable' || !r.image_key) continue;
    if (!byImage.has(r.image_key)) byImage.set(r.image_key, []);
    byImage.get(r.image_key).push(r);
  }
  const images = [];
  for (const [key, list] of byImage) {
    const owners = new Map();
    for (const r of list) {
      const o = ownerOf(r);
      const e = owners.get(o) || { owner: o, user: r.user_name, team: r.team || null, best: null, latest: null, submissions: 0 };
      e.submissions++;
      if (!e.best || better(r, e.best)) e.best = r;
      if (!e.latest || new Date(r.created_at) >= new Date(e.latest.created_at)) e.latest = r;
      owners.set(o, e);
    }
    const entries = [...owners.values()];
    const ranked = entries.filter((e) => e.best.verdict === 'ok').sort((a, b) => (better(a.best, b.best) ? -1 : 1));
    const pub = (r) => ({
      score: r.score, max_score: r.max_score, found_vulns: r.found_vulns, total_vulns: r.total_vulns,
      penalties: r.penalties, elapsed_seconds: r.elapsed_seconds, verdict: r.verdict, kind: r.kind || null,
      reasons: typeof r.reasons === 'string' ? JSON.parse(r.reasons) : (r.reasons || []),
      thumb: r.image_file ? `/community/img/${r.image_hash}` : null,
      submitted: new Date(r.created_at).toISOString()
    });
    images.push({
      image: list[0].image_name, key,
      entries: entries.map((e) => ({
        user: e.user, team: e.team, submissions: e.submissions,
        rank: ranked.indexOf(e) + 1 || null, best: pub(e.best), latest: pub(e.latest)
      })).sort((a, b) => (a.rank || 1e9) - (b.rank || 1e9))
    });
  }
  images.sort((a, b) => a.image.localeCompare(b.image));
  return { generated: new Date().toISOString(), images };
}

// rank (1-based) of `row`'s owner among ok submissions for the image, and number of ranked owners
function rankFor(rows, row) {
  const feed = buildFeed(rows);
  const img = feed.images.find((i) => i.key === row.image_key);
  if (!img) return { rank: null, of: 0 };
  const me = img.entries.find((e) => e.user === row.user_name && e.team === (row.team || null));
  return { rank: me ? me.rank : null, of: img.entries.filter((e) => e.rank).length };
}

function startFeedServer({ database, dataDir, host = '127.0.0.1', port = 8098 }) {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url === '/community.json') {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify(buildFeed(await database.getAllSubmissions())));
      }
      const m = /^\/community\/img\/([0-9a-f]{64})$/.exec(req.url || '');
      if (m) {
        const row = await database.getSubmissionByHash(m[1]);
        if (!row || !row.image_file) { res.statusCode = 404; return res.end('not found'); }
        const file = path.join(dataDir, path.basename(row.image_file));
        res.setHeader('Content-Type', /\.jpe?g$/i.test(file) ? 'image/jpeg' : /\.webp$/i.test(file) ? 'image/webp' : 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return fs.createReadStream(file).on('error', () => { res.statusCode = 404; res.end(); }).pipe(res);
      }
      res.statusCode = 404; res.end('not found');
    } catch (e) {
      console.error('community feed error:', e.message);
      res.statusCode = 500; res.end('error');
    }
  });
  server.listen(port, host, () => console.log(`Community feed on http://${host}:${port}/community.json`));
  return server;
}

module.exports = { buildFeed, rankFor, startFeedServer };
