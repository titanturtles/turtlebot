const mysql = require('mysql2/promise');

class Database {
  constructor(mysqlConfig) {
    this.mysqlConfig = mysqlConfig;
    this.pool = null;
  }

  async connect() {
    try {
      this.pool = mysql.createPool({
        host: this.mysqlConfig.host,
        port: this.mysqlConfig.port || 3306,
        user: this.mysqlConfig.user,
        password: this.mysqlConfig.password,
        database: this.mysqlConfig.database,
        waitForConnections: true,
        connectionLimit: 5
      });
      await this.pool.query('SELECT 1');
      await this._ensureTables();
      await this._ensureCommunityTables();
      console.log('Connected to MySQL');
      return true;
    } catch (error) {
      console.error('Failed to connect to MySQL:', error.message);
      throw error;
    }
  }

  async _ensureTables() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS user_stats (
        username VARCHAR(191) PRIMARY KEY,
        user_id BIGINT NOT NULL,
        easy INT NOT NULL DEFAULT 0,
        medium INT NOT NULL DEFAULT 0,
        hard INT NOT NULL DEFAULT 0,
        total_score INT NOT NULL DEFAULT 0,
        easy_weight INT NOT NULL DEFAULT 150,
        medium_weight INT NOT NULL DEFAULT 300,
        hard_weight INT NOT NULL DEFAULT 600,
        last_updated DATETIME NOT NULL
      )
    `);
    // Cisco practice progress already announced (level NAMES, so renumbering is harmless)
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS cisco_practice (
        team VARCHAR(191) NOT NULL,
        practice_id VARCHAR(191) NOT NULL,
        cleared JSON NOT NULL,
        done INT NOT NULL DEFAULT 0,
        total INT NOT NULL DEFAULT 0,
        last_updated DATETIME NOT NULL,
        PRIMARY KEY (team, practice_id)
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS team_stats (
        teamname VARCHAR(191) PRIMARY KEY,
        team_id BIGINT NOT NULL,
        team_score INT NOT NULL DEFAULT 0,
        members JSON NOT NULL,
        last_updated DATETIME NOT NULL
      )
    `);
  }

  async _ensureCommunityTables() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS discord_links (
        discord_id VARCHAR(32) PRIMARY KEY,
        name VARCHAR(191) NOT NULL,
        team VARCHAR(191) NULL,
        linked_at DATETIME NOT NULL
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS community_submissions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        image_hash CHAR(64) NOT NULL UNIQUE,
        discord_id VARCHAR(32) NOT NULL,
        user_key VARCHAR(191) NOT NULL,
        user_name VARCHAR(191) NOT NULL,
        team VARCHAR(191) NULL,
        image_name VARCHAR(191) NULL,
        image_key VARCHAR(191) NULL,
        score DOUBLE NULL,
        max_score DOUBLE NULL,
        found_vulns INT NULL,
        total_vulns INT NULL,
        penalties DOUBLE NULL,
        elapsed_seconds INT NULL,
        verdict VARCHAR(16) NOT NULL,
        reasons JSON NOT NULL,
        image_file VARCHAR(255) NULL,
        message_url VARCHAR(255) NULL,
        created_at DATETIME NOT NULL,
        INDEX idx_image_key (image_key)
      )
    `);
    // added later: which kind of report this is (cyberpatriot/packet_tracer/other); NULL for
    // rows inserted before this column existed, which judge()/the feed treat as cyberpatriot.
    // MySQL has no "ADD COLUMN IF NOT EXISTS", so check information_schema first.
    const [[{ n }]] = await this.pool.query(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'community_submissions' AND COLUMN_NAME = 'kind'`);
    if (!n) await this.pool.query('ALTER TABLE community_submissions ADD COLUMN kind VARCHAR(16) NULL');
  }

  async getDiscordLink(discordId) {
    const [rows] = await this.pool.query('SELECT * FROM discord_links WHERE discord_id = ?', [discordId]);
    return rows[0] || null;
  }

  async setDiscordLink(discordId, name, team) {
    await this.pool.query(
      `INSERT INTO discord_links (discord_id, name, team, linked_at) VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE name = VALUES(name), team = VALUES(team), linked_at = NOW()`,
      [discordId, name, team || null]);
    // re-key this person's earlier submissions so the scoreboard shows one entry, not one per name
    await this.pool.query(
      `UPDATE community_submissions SET user_key = ?, user_name = ?, team = ? WHERE discord_id = ?`,
      [`${team || ''}/${name}`.toLowerCase(), name, team || null, discordId]);
  }

  async getSubmissionByHash(hash) {
    const [rows] = await this.pool.query('SELECT * FROM community_submissions WHERE image_hash = ?', [hash]);
    return rows[0] || null;
  }

  // rows already stored for a Discord message (message_url ends in /<message id>)
  async countSubmissionsForMessage(messageId) {
    const [rows] = await this.pool.query(
      'SELECT COUNT(*) AS n FROM community_submissions WHERE message_url LIKE ?', ['%/' + String(messageId).replace(/\D/g, '')]);
    return Number(rows[0].n);
  }

  async getSubmissionsForImage(imageKey) {
    const [rows] = await this.pool.query(
      'SELECT * FROM community_submissions WHERE image_key = ? ORDER BY created_at', [imageKey]);
    return rows;
  }

  async getAllSubmissions() {
    const [rows] = await this.pool.query('SELECT * FROM community_submissions ORDER BY created_at');
    return rows;
  }

  async insertSubmission(s) {
    await this.pool.query(
      `INSERT INTO community_submissions
        (image_hash, discord_id, user_key, user_name, team, image_name, image_key, score, max_score,
         found_vulns, total_vulns, penalties, elapsed_seconds, verdict, reasons, image_file, message_url, created_at, kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, NOW()), ?)`,
      [s.imageHash, s.discordId, s.userKey, s.userName, s.team || null, s.imageName, s.imageKey, s.score,
        s.maxScore, s.foundVulns, s.totalVulns, s.penalties, s.elapsedSeconds, s.verdict,
        JSON.stringify(s.reasons || []), s.imageFile || null, s.messageUrl || null, s.createdAt || null, s.kind || null]);
  }

  async disconnect() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      console.log('Disconnected from MySQL');
    }
    return true;
  }

  async getUserStats(username) {
    const [rows] = await this.pool.query('SELECT * FROM user_stats WHERE username = ?', [username.toLowerCase()]);
    return rows[0] || null;
  }

  async getAllUserStats() {
    const [rows] = await this.pool.query('SELECT * FROM user_stats');
    return rows;
  }

  async upsertUserStats(stats) {
    await this.pool.query(
      `INSERT INTO user_stats
         (username, user_id, easy, medium, hard, total_score, easy_weight, medium_weight, hard_weight, last_updated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         user_id = VALUES(user_id), easy = VALUES(easy), medium = VALUES(medium), hard = VALUES(hard),
         total_score = VALUES(total_score), easy_weight = VALUES(easy_weight),
         medium_weight = VALUES(medium_weight), hard_weight = VALUES(hard_weight), last_updated = NOW()`,
      [
        stats.username.toLowerCase(), stats.userId, stats.easy, stats.medium, stats.hard,
        stats.totalScore, stats.easyWeight, stats.mediumWeight, stats.hardWeight
      ]
    );
  }

  async ciscoRowCount() {
    const [rows] = await this.pool.query('SELECT COUNT(*) AS n FROM cisco_practice');
    return Number(rows[0].n);
  }

  async getCiscoProgress(team, practiceId) {
    const [rows] = await this.pool.query(
      'SELECT * FROM cisco_practice WHERE team = ? AND practice_id = ?', [team, practiceId]);
    if (!rows[0]) return null;
    const cleared = typeof rows[0].cleared === 'string' ? JSON.parse(rows[0].cleared) : rows[0].cleared;
    return { ...rows[0], cleared: cleared || [] };
  }

  async upsertCiscoProgress(team, practiceId, cleared, done, total) {
    await this.pool.query(
      `INSERT INTO cisco_practice (team, practice_id, cleared, done, total, last_updated)
       VALUES (?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE cleared = VALUES(cleared), done = VALUES(done), total = VALUES(total),
         last_updated = NOW()`,
      [team, practiceId, JSON.stringify(cleared), done, total]
    );
  }

  async getTeamStats(teamname) {
    const [rows] = await this.pool.query('SELECT * FROM team_stats WHERE teamname = ?', [teamname.toLowerCase()]);
    if (!rows[0]) return null;
    return { ...rows[0], members: JSON.parse(rows[0].members || '[]') };
  }

  async getAllTeamStats() {
    const [rows] = await this.pool.query('SELECT * FROM team_stats');
    return rows.map((row) => ({ ...row, members: JSON.parse(row.members || '[]') }));
  }

  async upsertTeamStats(stats) {
    await this.pool.query(
      `INSERT INTO team_stats (teamname, team_id, team_score, members, last_updated)
       VALUES (?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         team_id = VALUES(team_id), team_score = VALUES(team_score), members = VALUES(members), last_updated = NOW()`,
      [stats.teamname.toLowerCase(), stats.teamId, stats.team_score, JSON.stringify(stats.members || [])]
    );
  }
}

module.exports = Database;
