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
