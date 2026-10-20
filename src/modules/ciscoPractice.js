const { EmbedBuilder } = require('discord.js');

// Practice progress from the TitanTurtles scoreboard's /practice.json (the same data as its
// public Practice page): Cisco Packet Tracer modules plus the Windows and Linux hardening
// practices, all in one leaderboard. Each update cycle it posts when a team clears new practice
// levels, a bigger post when a team completes a whole module, and it builds the practice section
// of the daily leaderboard. What it has already seen is kept in MySQL (cisco_practice) by level
// NAME, so restarts and level renumbering never re-announce old clears. The very first run only
// records the current state.
const DEFAULT_FEED = 'https://scoreboard.titanturtles.xyz/practice.json';
const MAX_POSTS_PER_CYCLE = 20;
const GOLD = 0xf1c40f;

// Practice categories, keyed by the feed's `kind` ("" counts as cisco).
const CATEGORIES = {
  cisco: { label: 'Cisco', emoji: '🧩', color: 0x1ba0e2 },
  windows: { label: 'Windows', emoji: '🪟', color: 0x357ec7 },
  linux: { label: 'Linux', emoji: '🐧', color: 0xe9573f },
};
const CATEGORY_ORDER = ['cisco', 'windows', 'linux'];
const BRAND = CATEGORIES.cisco.color;
const categoryOf = (kind) => CATEGORIES[kind] || CATEGORIES.cisco;
// A team's progress on one practice as a fraction of its levels. The scoreboard sends `progress`
// (partial levels counted — 75% of a level = 0.75); fall back to the integer cleared count for an
// older feed. `done` stays the whole-level count used for "module complete".
const progOf = (p) => (typeof p.progress === 'number' ? p.progress : p.done);
// Format a fractional level count: whole numbers stay plain ("3"), fractions trim ("0.75", "2.5").
const fmtNum = (n) => String(Math.round(n * 100) / 100);

class CiscoPractice {
  constructor(database, discordBot, config) {
    this.db = database;
    this.discord = discordBot;
    this.cfg = config.cisco || {};
    this.feedUrl = this.cfg.feedUrl || DEFAULT_FEED;
    this.siteUrl = this.feedUrl.replace(/\/practice\.json$/, '');
    this.verbose = !!(config.features && config.features.verbose);
  }

  async fetchFeed() {
    const res = await fetch(this.feedUrl, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`practice feed HTTP ${res.status}`);
    return res.json();
  }

  // levels a team has cleared in one practice, as names (stable across renumbering)
  static clearedNames(practice, tp) {
    const byNum = new Map(practice.levels.map((l) => [l.level, l.name]));
    return tp.cleared.map((n) => byNum.get(n)).filter(Boolean);
  }

  async update() {
    const feed = await this.fetchFeed();
    const practices = new Map(feed.practices.map((p) => [p.id, p]));
    const firstRun = (await this.db.ciscoRowCount()) === 0;
    const posts = [];

    for (const team of feed.teams) {
      for (const tp of team.practices) {
        const practice = practices.get(tp.id);
        if (!practice) continue;
        const names = CiscoPractice.clearedNames(practice, tp);
        const prev = await this.db.getCiscoProgress(team.team, tp.id);
        const seen = new Set(prev ? prev.cleared : []);
        const newly = names.filter((n) => !seen.has(n));
        await this.db.upsertCiscoProgress(team.team, tp.id, names, tp.done, tp.total);
        if (firstRun || newly.length === 0) continue;

        const complete = tp.total > 0 && tp.done === tp.total;
        const wasComplete = prev && prev.total > 0 && prev.done === prev.total && prev.total === tp.total;
        posts.push(complete && !wasComplete
          ? this.moduleCompleteEmbed(team.team, practice, newly)
          : this.levelClearedEmbed(team.team, practice, newly, tp));
      }
    }

    if (firstRun) {
      console.log(`Cisco practice: first run, recorded ${feed.teams.length} teams' progress without posting`);
      return 0;
    }
    for (const embed of posts.slice(0, MAX_POSTS_PER_CYCLE)) {
      await this.discord.sendEmbed(embed, this.cfg.channelId);
    }
    if (posts.length > MAX_POSTS_PER_CYCLE) {
      await this.discord.sendMessage(
        `…and ${posts.length - MAX_POSTS_PER_CYCLE} more practice updates. See ${this.siteUrl}/practice`,
        this.cfg.channelId);
    }
    if (this.verbose) console.log(`Cisco practice: ${posts.length} update(s) posted`);
    return posts.length;
  }

  levelClearedEmbed(team, practice, newly, tp) {
    const cat = categoryOf(practice.kind);
    const lines = newly.map((n) => `✅ ${n}`).join('\n');
    return new EmbedBuilder()
      .setColor(cat.color)
      .setTitle(`🐢 ${team} cleared ${newly.length === 1 ? `a ${cat.label} practice level` : `${newly.length} ${cat.label} practice levels`}`)
      .setURL(`${this.siteUrl}/practice/${encodeURIComponent(practice.id)}`)
      .setDescription(`${cat.emoji} **${practice.name}**\n${lines}\n\nProgress: **${fmtNum(progOf(tp))}/${tp.total}** levels`)
      .setTimestamp();
  }

  moduleCompleteEmbed(team, practice, newly) {
    const last = newly.length ? `\nFinal level${newly.length > 1 ? 's' : ''}: ${newly.join(', ')}` : '';
    return new EmbedBuilder()
      .setColor(GOLD)
      .setTitle(`🏆 ${team} completed ${practice.name}!`)
      .setURL(`${this.siteUrl}/practice/${encodeURIComponent(practice.id)}`)
      .setDescription(`All **${practice.levels.length}** levels cleared.${last}`)
      .setTimestamp();
  }

  // Daily leaderboard: teams ranked by practice levels cleared (Cisco + Windows + Linux),
  // then modules completed. When more than one category has clears, each row also shows a
  // per-category breakdown so Windows and Linux progress is visible, not just folded into the total.
  async dailyEmbed() {
    const feed = await this.fetchFeed();
    // dailyTop is an OPTIONAL hard cap; unset (the default) lists every team with non-zero progress.
    const cap = this.cfg.dailyTop > 0 ? this.cfg.dailyTop : Infinity;
    const kindOf = new Map(feed.practices.map((p) => [p.id, p.kind || 'cisco']));
    const totalLevels = feed.practices.reduce((s, p) => s + p.levels.length, 0);

    const rows = feed.teams.map((t) => {
      const byCat = {};
      for (const p of t.practices) {
        const k = kindOf.get(p.id) || 'cisco';
        byCat[k] = (byCat[k] || 0) + progOf(p);
      }
      return {
        team: t.team,
        levels: t.practices.reduce((s, p) => s + progOf(p), 0),
        modules: t.practices.filter((p) => p.total > 0 && p.done === p.total).length,
        byCat,
      };
    }).filter((r) => r.levels > 0)
      .sort((a, b) => b.levels - a.levels || b.modules - a.modules || a.team.localeCompare(b.team));

    // only show the per-category split when the board spans more than one category
    const activeCats = CATEGORY_ORDER.filter((k) => rows.some((r) => r.byCat[k] > 0));
    const showSplit = activeCats.length > 1;
    const breakdown = (r) => activeCats
      .filter((k) => r.byCat[k] > 0)
      .map((k) => `${CATEGORIES[k].emoji} ${fmtNum(r.byCat[k])}`)
      .join(' · ');

    // List every non-zero team. Discord caps an embed description at 4096 chars, so stop short of
    // that (and of an optional dailyTop) and note any remainder with a link to the full board.
    const DESC_BUDGET = 3900;
    let description = '';
    let listed = 0;
    for (const [i, r] of rows.entries()) {
      if (listed >= cap) break;
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      const line = `${medal} **${r.team}** - ${fmtNum(r.levels)} level${r.levels === 1 ? '' : 's'}` +
        (showSplit ? ` (${breakdown(r)})` : '') +
        (r.modules ? ` · ${r.modules} module${r.modules === 1 ? '' : 's'} complete` : '') + '\n';
      if (description.length + line.length > DESC_BUDGET) break;
      description += line;
      listed++;
    }
    const remaining = rows.length - listed;
    if (remaining > 0) description += `…and ${remaining} more — see ${this.siteUrl}/practice\n`;

    // footer: practice count per category present, then level/team totals
    const catCounts = CATEGORY_ORDER
      .map((k) => ({ k, n: feed.practices.filter((p) => (p.kind || 'cisco') === k).length }))
      .filter((c) => c.n > 0)
      .map((c) => `${CATEGORIES[c.k].label} ${c.n}`)
      .join(' · ');

    return new EmbedBuilder()
      .setColor(BRAND)
      .setTitle('🐢 Practice Leaderboard')
      .setURL(`${this.siteUrl}/practice`)
      .setDescription(description || 'No practice levels cleared yet.')
      .setFooter({ text: `${catCounts} · ${totalLevels} levels · ${rows.length} team${rows.length === 1 ? '' : 's'} with clears` })
      .setTimestamp();
  }
}

module.exports = CiscoPractice;
