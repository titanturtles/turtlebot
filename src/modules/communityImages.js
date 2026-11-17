// #homework-submission: read community-image score-report screenshots, judge, store, announce.
// Attachments need no privileged intent; message *text* is only visible when the bot is
// mentioned (no MESSAGE_CONTENT intent), so linking uses "@turtlebot link <name> [team]".
const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const sr = require('./scoreReport');
const { rankFor } = require('./communityFeed');

const MAX_BYTES = 8 * 1024 * 1024;
const EXTS = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
const COLORS = { ok: 0x2ecc71, suspicious: 0xf1c40f, unreadable: 0x95a5a6 };
const EMOJI = { ok: '✅', suspicious: '⚠️', unreadable: '❓', duplicate: '♻️' };

class CommunityImages {
  // deps: database, discordBot, config.community; fetchImage/read injectable for tests
  constructor(database, discordBot, cfg, deps = {}) {
    this.db = database;
    this.bot = discordBot;
    this.cfg = cfg || {};
    this.dataDir = this.cfg.dataDir || path.join(__dirname, '..', '..', 'data', 'community');
    this.fetchImage = deps.fetchImage || defaultFetch;
    this.read = deps.read || ((buf, ext) => sr.readScoreReport(buf, ext, {
      bin: this.cfg.claudeBin || 'claude', model: this.cfg.model || 'haiku', timeoutMs: this.cfg.timeoutMs }));
    this.channels = {};
    this.queue = Promise.resolve(); // one vision call at a time
  }

  attach() {
    this.bot.client.on('messageCreate', (m) => {
      this.queue = this.queue.then(() => this.onMessage(m)).catch((e) => console.error('community:', e.message));
    });
  }

  // channel id from config, else look up by name in the guild (cached)
  async channelId(kind, defaultName) {
    const id = this.cfg[kind + 'ChannelId'];
    if (id) return id;
    if (this.channels[kind]) return this.channels[kind];
    const name = this.cfg[kind + 'ChannelName'] || defaultName;
    const guild = await this.bot.client.guilds.fetch(this.bot.config.discord.guildId);
    const chans = await guild.channels.fetch();
    const c = chans.find((x) => x && x.name === name && x.isTextBased && x.isTextBased());
    if (!c) throw new Error(`channel #${name} not found`);
    return (this.channels[kind] = c.id);
  }

  async onMessage(m) {
    if (!m || m.author?.bot) return;
    const subId = await this.channelId('submission', 'homework-submission');
    if (m.channelId !== subId) return;
    const link = /\blink\s+(\S+)(?:\s+(.+))?$/i.exec((m.content || '').replace(/<@!?\d+>/g, '').trim());
    if (link && m.mentions?.users?.has(this.bot.client.user.id)) {
      await this.db.setDiscordLink(m.author.id, link[1].slice(0, 100), (link[2] || '').trim().slice(0, 100) || null);
      return m.reply(`Linked you as **${link[1]}**${link[2] ? ` (team **${link[2].trim()}**)` : ''}.`);
    }
    const atts = [...(m.attachments?.values() || [])].filter((a) => EXTS[(a.contentType || '').split(';')[0]]);
    for (const a of atts.slice(0, 3)) await this.handleAttachment(m, a);
  }

  async identify(m) {
    const link = await this.db.getDiscordLink(m.author.id);
    const display = m.member?.displayName || m.author.username;
    return link
      ? { name: link.name, team: link.team, linked: true, key: `${link.team || ''}/${link.name}`.toLowerCase() }
      : { name: display, team: null, linked: false, key: `discord:${m.author.id}` };
  }

  async handleAttachment(m, att) {
    if (att.size > MAX_BYTES) return m.reply('That screenshot is over 8 MB; please crop or compress it.');
    const buf = await this.fetchImage(att.url);
    const hash = sr.sha256(buf);
    const dup = await this.db.getSubmissionByHash(hash);
    if (dup) {
      await m.react(EMOJI.duplicate).catch(() => {});
      return m.reply(`${EMOJI.duplicate} That exact screenshot was already submitted (${dup.image_name || 'unknown image'}, `
        + `score ${dup.score ?? '?'}). Duplicates are ignored.`);
    }
    const who = await this.identify(m);
    let report;
    try {
      report = await this.read(buf, EXTS[att.contentType.split(';')[0]]);
    } catch (e) {
      console.error('vision failed:', e.message);
      return m.reply('I could not read that screenshot right now (vision step failed). A coach can retry later.');
    }
    const history = report.imageKey ? await this.db.getSubmissionsForImage(report.imageKey) : [];
    const { verdict, reasons } = sr.judge(report, history, who.key);
    let imageFile = null;
    if (verdict !== 'unreadable') {
      fs.mkdirSync(this.dataDir, { recursive: true });
      imageFile = hash + EXTS[att.contentType.split(';')[0]];
      fs.writeFileSync(path.join(this.dataDir, imageFile), buf);
    }
    const row = {
      imageHash: hash, discordId: m.author.id, userKey: who.key, userName: who.name, team: who.team,
      imageName: report.imageName, imageKey: report.imageKey, score: report.score, maxScore: report.maxScore,
      foundVulns: report.foundVulns, totalVulns: report.totalVulns, penalties: report.penalties,
      elapsedSeconds: report.elapsedSeconds, verdict, reasons, imageFile, messageUrl: m.url
    };
    await this.db.insertSubmission(row);
    await m.react(EMOJI[verdict]).catch(() => {});
    await m.reply({ embeds: [this.replyEmbed(report, verdict, reasons, who)] });
    if (verdict === 'ok') await this.announce(row);
  }

  replyEmbed(report, verdict, reasons, who) {
    const e = new EmbedBuilder().setColor(COLORS[verdict])
      .setTitle(`${EMOJI[verdict]} Score report: ${verdict}`)
      .addFields(
        { name: 'Image', value: report.imageName || '?', inline: true },
        { name: 'Score', value: report.score == null ? '?' : `${report.score}/${report.maxScore}`, inline: true },
        { name: 'Time', value: sr.fmtTime(report.elapsedSeconds), inline: true });
    if (report.foundVulns != null) e.addFields({ name: 'Vulns', value: `${report.foundVulns}/${report.totalVulns ?? '?'}`, inline: true });
    if (report.penalties != null) e.addFields({ name: 'Penalties', value: String(report.penalties), inline: true });
    if (reasons.length) e.addFields({ name: verdict === 'suspicious' ? 'Why flagged' : 'Problem', value: reasons.join('\n').slice(0, 1000) });
    const foot = [];
    if (verdict === 'suspicious') foot.push('Flagged for a coach to review. Nothing is removed automatically.');
    if (!who.linked) foot.push('Not linked yet: mention me with "link <your name> [team]" in this channel.');
    if (foot.length) e.setFooter({ text: foot.join(' ') });
    return e;
  }

  async announce(row) {
    const rows = await this.db.getSubmissionsForImage(row.imageKey);
    const me = rows.find((r) => r.image_hash === row.imageHash);
    const { rank, of } = rankFor(rows, me);
    const embed = new EmbedBuilder().setColor(0x3498db)
      .setTitle(`🖼️ Image scoring update: ${row.imageName}`)
      .addFields(
        { name: row.team ? 'Team' : 'User', value: row.team ? `${row.team} (${row.userName})` : row.userName, inline: true },
        { name: 'Score', value: `${row.score}/${row.maxScore}`, inline: true },
        { name: 'Time', value: sr.fmtTime(row.elapsedSeconds), inline: true },
        { name: 'Rank', value: rank ? `#${rank} of ${of}` : 'unranked', inline: true })
      .setTimestamp();
    await this.bot.sendEmbed(embed, await this.channelId('announce', 'ctf-stuff'));
  }
}

async function defaultFetch(url) {
  const u = new URL(url);
  if (!/(^|\.)discordapp\.(com|net)$/.test(u.hostname) && !/(^|\.)discord\.com$/.test(u.hostname)) {
    throw new Error('refusing non-Discord attachment host');
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('attachment too large');
  return buf;
}

module.exports = CommunityImages;
