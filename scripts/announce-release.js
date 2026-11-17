#!/usr/bin/env node
// Announce a released Weekly Sprint answer key / walkthrough in Discord.
// Usage: node scripts/announce-release.js <week> "<topic>" [--send]
//   e.g. node scripts/announce-release.js 2 "Password & Policy" --send
// Without --send it only prints the embed. Posts to config.cisco.channelId, else discord.channelId.
const { EmbedBuilder } = require('discord.js');
const DiscordBot = require('../src/modules/discordBot');
const config = require('../config.json');

const SITE = 'https://ciscocp19.titanturtles.xyz';
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const send = process.argv.includes('--send');
const [week, topic] = args;
if (!week || !topic) { console.error('usage: announce-release.js <week> "<topic>" [--send]'); process.exit(1); }

const embed = new EmbedBuilder()
  .setColor(0x1ba0e2)
  .setTitle(`📘 Week ${week} answer keys & walkthroughs released`)
  .setDescription(
    `The Week ${week} (${topic}) answer keys and walkthroughs are out, for Basic and Advanced, Linux and Windows.\n\n` +
    `Points scored **before** the release counted **double (×2)** on the Weekly Sprint board; points after count once.\n\n` +
    `👉 ${SITE}/answer-keys/\n` +
    `Weekly plan: ${SITE}/weekly/`)
  .setTimestamp();

(async () => {
  const channelId = (config.cisco || {}).channelId || config.discord.channelId;
  if (!send) { console.log(JSON.stringify(embed.toJSON(), null, 2), '\nchannel:', channelId, '\n(dry run; pass --send)'); return; }
  const bot = new DiscordBot(config.discord.token, config);
  await bot.initialize();
  const ok = await bot.sendEmbed(embed, channelId);
  console.log(ok === false ? 'FAILED to send' : `sent to channel ${channelId}`);
  await bot.destroy();
  process.exit(ok === false ? 1 : 0);
})().catch((e) => { console.error(e.message); process.exit(1); });
