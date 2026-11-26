#!/usr/bin/env node
// Re-read #homework-submission screenshots that were stored as 'unreadable', in case the vision
// prompt understands more now than when they were first read (e.g. Packet Tracer support added
// later). Usage: node scripts/retry-unreadable.js [--days 7]
// Silent: reads + stores (replaces the old unreadable row), no replies/reactions/announcements.
const config = require('../config.json');
const Database = require('../src/modules/database');
const DiscordBot = require('../src/modules/discordBot');
const CommunityImages = require('../src/modules/communityImages');

const argv = process.argv.slice(2);
const di = argv.indexOf('--days');
const days = di >= 0 ? Number(argv[di + 1]) : 7;
if (!(days > 0)) { console.error('--days must be a positive number'); process.exit(1); }

(async () => {
  const db = new Database(config.mysql);
  const bot = new DiscordBot(config.discord.token, config);
  const ci = new CommunityImages(db, bot, config.community || {});
  await db.connect();
  await bot.initialize();
  let code = 0;
  try {
    console.log(`Retrying 'unreadable' submissions from the last ${days} day(s)`);
    const s = await ci.retryUnreadable(days, { log: (l) => console.log(l) });
    console.log('\nSummary:', JSON.stringify(s));
    console.log(`messages ${s.messages}, rows checked ${s.checked}, fixed ${s.fixed}, `
      + `still unreadable ${s.stillUnreadable}, attachment(s) gone ${s.gone}, errors ${s.errors}`);
    if (s.errors) code = 2; // re-run to retry the errored ones
  } catch (e) { console.error(e.message); code = 1; }
  await bot.destroy();
  await db.disconnect();
  process.exit(code);
})().catch((e) => { console.error(e.message); process.exit(1); });
