const test = require('node:test');
const assert = require('node:assert');
const sr = require('../src/modules/scoreReport');
const { buildFeed, rankFor } = require('../src/modules/communityFeed');
const CommunityImages = require('../src/modules/communityImages');

// 1x1 PNG standing in for a sample screenshot
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHBCzdQAAAABJRU5ErkJggg==', 'base64');

test('parseElapsed handles clock and word formats', () => {
  assert.strictEqual(sr.parseElapsed('01:02:03'), 3723);
  assert.strictEqual(sr.parseElapsed('12:30'), 750);
  assert.strictEqual(sr.parseElapsed('1h 5m'), 3900);
  assert.strictEqual(sr.parseElapsed('45 minutes'), 2700);
  assert.strictEqual(sr.parseElapsed('soon'), null);
});

test('parseVisionJson tolerates fences and chatter', () => {
  const o = sr.parseVisionJson('Here:\n```json\n{"score": 80, "image_name": "Ubuntu 22"}\n```');
  assert.strictEqual(o.score, 80);
  assert.throws(() => sr.parseVisionJson('nothing'));
});

const rep = (o) => sr.normalizeReport({ readable: true, image_name: 'Ubuntu 22 Practice', score: 70, max_score: 100,
  found_vulns: 10, total_vulns: 20, elapsed: '01:10:00', tampered: false, ...o });

test('judge: reasonable report is ok', () => {
  assert.strictEqual(sr.judge(rep({}), [], 'a').verdict, 'ok');
});
test('judge: high score in minutes is suspicious', () => {
  const j = sr.judge(rep({ score: 95, elapsed: '00:04:00' }), [], 'a');
  assert.strictEqual(j.verdict, 'suspicious');
  assert.match(j.reasons[0], /implausibly fast/);
});
test('judge: tampered, impossible and unreadable', () => {
  assert.strictEqual(sr.judge(rep({ tampered: true, notes: 'font mismatch' }), [], 'a').verdict, 'suspicious');
  assert.strictEqual(sr.judge(rep({ score: 130 }), [], 'a').verdict, 'suspicious');
  assert.strictEqual(sr.judge(rep({ found_vulns: 25, total_vulns: 20 }), [], 'a').verdict, 'suspicious');
  assert.strictEqual(sr.judge(sr.normalizeReport({ readable: false }), [], 'a').verdict, 'unreadable');
});
test('judge: same score+time again, or better score with less time', () => {
  const hist = [{ user_key: 'a', score: 70, elapsed_seconds: 4200, verdict: 'ok' }];
  assert.strictEqual(sr.judge(rep({}), hist, 'a').verdict, 'suspicious');
  assert.strictEqual(sr.judge(rep({ score: 80, elapsed: '00:50:00' }), hist, 'a').verdict, 'suspicious');
  assert.strictEqual(sr.judge(rep({}), hist, 'b').verdict, 'ok');
});

test('readScoreReport passes the image to claude and cleans up', async () => {
  let seen;
  const r = await sr.readScoreReport(PNG, '.png', {
    exec: async (args, input) => { seen = { args, input }; return '{"readable":true,"image_name":"X","score":10,"elapsed":"10:00"}'; } });
  assert.strictEqual(r.score, 10);
  assert.strictEqual(r.elapsedSeconds, 600);
  assert.ok(seen.args.includes('-p') && seen.args.includes('Read'));
  const file = /saved at (\S+)\./.exec(seen.input)[1];
  assert.ok(!require('fs').existsSync(file));
});

const row = (o) => ({ image_hash: Math.random().toString(16).slice(2).padEnd(64, '0'), user_name: 'u', team: null,
  image_name: 'Ubuntu', image_key: 'ubuntu', score: 50, elapsed_seconds: 3600, verdict: 'ok', reasons: '[]',
  created_at: new Date(), ...o });

test('feed ranks best per owner, skips unreadable, keeps suspicious unranked', () => {
  const rows = [row({ user_name: 'a', score: 60 }), row({ user_name: 'a', score: 80 }), row({ user_name: 'b', score: 70 }),
    row({ user_name: 'c', score: 99, verdict: 'suspicious' }), row({ user_name: 'd', verdict: 'unreadable' })];
  const f = buildFeed(rows);
  assert.strictEqual(f.images.length, 1);
  const e = Object.fromEntries(f.images[0].entries.map((x) => [x.user, x]));
  assert.strictEqual(e.a.rank, 1); assert.strictEqual(e.a.best.score, 80); assert.strictEqual(e.a.submissions, 2);
  assert.strictEqual(e.b.rank, 2);
  assert.strictEqual(e.c.rank, null);
  assert.ok(!e.d);
  assert.deepStrictEqual(rankFor(rows, rows[2]), { rank: 2, of: 2 });
});

// ---- handler end to end with fakes ----
function fakes(readOut) {
  const subs = [], links = {};
  const db = {
    getDiscordLink: async (id) => links[id] || null,
    setDiscordLink: async (id, name, team) => { links[id] = { name, team }; },
    getSubmissionByHash: async (h) => subs.find((s) => s.image_hash === h) || null,
    getSubmissionsForImage: async (k) => subs.filter((s) => s.image_key === k),
    insertSubmission: async (s) => subs.push({ image_hash: s.imageHash, user_key: s.userKey, user_name: s.userName, team: s.team,
      image_name: s.imageName, image_key: s.imageKey, score: s.score, elapsed_seconds: s.elapsedSeconds, verdict: s.verdict,
      reasons: JSON.stringify(s.reasons), created_at: new Date() })
  };
  const sent = [];
  const bot = { client: { on() {}, user: { id: 'BOT' } }, config: { discord: {} }, sendEmbed: async (e, ch) => { sent.push({ e, ch }); } };
  const ci = new CommunityImages(db, bot, { submissionChannelId: 'SUB', announceChannelId: 'ANN', dataDir: require('os').tmpdir() + '/tb-test-' + process.pid },
    { fetchImage: async () => PNG, read: async () => sr.normalizeReport(readOut) });
  return { ci, db, subs, sent, links };
}
const msg = (o = {}) => { const replies = [], reacts = [];
  return { replies, reacts, channelId: 'SUB', author: { id: 'U1', username: 'kid', bot: false }, member: { displayName: 'Kid' },
    content: '', url: 'http://m', mentions: { users: new Map() },
    attachments: new Map([['1', { url: 'https://cdn.discordapp.com/x.png', size: 100, contentType: 'image/png' }]]),
    react: async (e) => reacts.push(e), reply: async (r) => replies.push(r), ...o }; };

test('accepted submission is stored, replied and announced; duplicate hash is ignored', async () => {
  const f = fakes({ readable: true, image_name: 'Ubuntu 22', score: 70, elapsed: '1:10:00' });
  const m = msg();
  await f.ci.onMessage(m);
  assert.strictEqual(f.subs.length, 1);
  assert.strictEqual(f.subs[0].verdict, 'ok');
  assert.deepStrictEqual(m.reacts, ['✅']);
  assert.match(m.replies[0].embeds[0].data.footer.text, /link/); // unlinked user is asked to link
  assert.strictEqual(f.sent.length, 1);
  assert.strictEqual(f.sent[0].ch, 'ANN');
  assert.match(f.sent[0].e.data.title, /Ubuntu 22/);
  const m2 = msg(); await f.ci.onMessage(m2);
  assert.strictEqual(f.subs.length, 1);
  assert.match(m2.replies[0], /already submitted/);
  assert.strictEqual(f.sent.length, 1);
});

test('suspicious submission is stored and flagged but not announced', async () => {
  const f = fakes({ readable: true, image_name: 'Ubuntu 22', score: 98, elapsed: '3:00' });
  const m = msg(); await f.ci.onMessage(m);
  assert.strictEqual(f.subs[0].verdict, 'suspicious');
  assert.deepStrictEqual(m.reacts, ['⚠️']);
  assert.strictEqual(f.sent.length, 0);
});

test('link via mention, other channels and bots are ignored', async () => {
  const f = fakes({ readable: true, image_name: 'U', score: 50, elapsed: '1:00:00' });
  const link = msg({ attachments: new Map(), content: '<@BOT> link alice TeamRed', mentions: { users: new Map([['BOT', {}]]) } });
  await f.ci.onMessage(link);
  assert.deepStrictEqual(f.links.U1, { name: 'alice', team: 'TeamRed' });
  await f.ci.onMessage(msg({ channelId: 'OTHER' }));
  await f.ci.onMessage(msg({ author: { id: 'B', bot: true } }));
  assert.strictEqual(f.subs.length, 0);
  const m = msg(); await f.ci.onMessage(m);
  assert.strictEqual(f.subs[0].team, 'TeamRed');
  assert.match(f.sent[0].e.data.fields[0].value, /TeamRed/);
});

test('vision failure replies without storing', async () => {
  const f = fakes({});
  f.ci.read = async () => { throw new Error('boom'); };
  const m = msg(); await f.ci.onMessage(m);
  assert.strictEqual(f.subs.length, 0);
  assert.match(m.replies[0], /could not read/);
});
