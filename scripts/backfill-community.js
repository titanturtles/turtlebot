#!/usr/bin/env node
// Backfill #homework-submission score-report screenshots into the community scoreboard.
// Usage: node scripts/backfill-community.js [--days 7] [--dry-run] [--send]
//   default      silent: reads + stores (original author and post time), no replies/reactions/announcements
//   --dry-run    only lists what would be read/stored (downloads images, calls no vision, writes nothing)
//   --send       also reply + react on the old messages (never posts #ctf-stuff announcements)
// Idempotent: re-running skips messages already stored and screenshots whose SHA-256 is stored.
const config = require('../config.json');
const Database = require('../src/modules/database');
const DiscordBot = require('../src/modules/discordBot');
const CommunityImages = require('../src/modules/communityImages');

const argv = process.argv.slice(2);
const di = argv.indexOf('--days');
const days = di >= 0 ? Number(argv[di + 1]) : 7;
if (!(days > 0)) { console.error('--days must be a positive number'); process.exit(1); }
const opts = { days, send: argv.includes('--send'), dryRun: argv.includes('--dry-run'), log: (l) => console.log(l) };

(async () => {
  const db = new Database(config.mysql);
  const bot = new DiscordBot(config.discord.token, config);
  const ci = new CommunityImages(db, bot, config.community || {});
  await db.connect();
  await bot.initialize();
  let code = 0;
  try {
    const channel = await bot.client.channels.fetch(await ci.channelId('submission', 'homework-submission'));
    console.log(`Backfilling last ${days} day(s) of #${channel.name}${opts.dryRun ? ' (dry run)' : ''}${opts.send ? ' (--send: replies on)' : ''}`);
    const s = await ci.backfill(channel, opts);
    console.log('\nSummary:', JSON.stringify(s));
    console.log(`messages ${s.messages}, images ${s.images}, read ${s.read} (ok ${s.ok}, suspicious ${s.suspicious}, unreadable ${s.unreadable}), `
      + `duplicates ${s.duplicates}, already-stored ${s.skipped}, vision-failed ${s.failed}, errors ${s.errors}`);
    if (s.failed || s.errors) code = 2; // re-run to retry the failed ones
  } catch (e) { console.error(e.message); code = 1; }
  await bot.destroy();
  await db.disconnect();
  process.exit(code);
})().catch((e) => { console.error(e.message); process.exit(1); });
