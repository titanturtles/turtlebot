const config = require('../config.json');
const CSVManager = require('./modules/csvManager');
const CSVTeamsManager = require('./modules/csvTeamsManager');
const PicoCTFApi = require('./modules/picoctfApi');
const Database = require('./modules/database');
const DiscordBot = require('./modules/discordBot');
const ScoreCalculator = require('./modules/scoreCalculator');
const DataManager = require('./modules/dataManager');
const Scheduler = require('./modules/scheduler');
const CiscoPractice = require('./modules/ciscoPractice');

class PicoCTFBot {
  constructor(config) {
    this.config = config;
    this.csvManager = new CSVManager(config.csv.filePath);
    this.csvTeamsManager = new CSVTeamsManager(config.csv.teamFilePath);
    this.picoctfApi = new PicoCTFApi(config.picoctf);
    this.database = new Database(config.mysql);
    this.discordBot = new DiscordBot(config.discord.token, config);
    this.scoreCalculator = new ScoreCalculator(config.scoring);
    this.dataManager = new DataManager(this.csvManager, this.csvTeamsManager, this.picoctfApi, this.database, this.scoreCalculator, config);
    this.scheduler = new Scheduler(config);
    // Cisco Packet Tracer practice updates from the scoreboard (on unless cisco.enabled is false)
    this.cisco = (config.cisco || {}).enabled === false ? null
      : new CiscoPractice(this.database, this.discordBot, config);
    this.recentUpdates = new Set(); // Track recent updates to avoid duplicates
    this.updateInProgress = false;
  }

  async initialize() {
    try {
      console.log('Initializing PicoCTF Discord Bot...');

      // Connect to MySQL
      await this.database.connect();

      // Launch headless browser session for picoCTF
      await this.picoctfApi.init();

      // Initialize Discord Bot
      await this.discordBot.initialize();

      // Validate and populate missing user IDs
      await this.validateUserIds();

      // Schedule update task
      this.scheduler.scheduleUpdateTask(
        () => this.runScheduledUpdates(),
        this.config.scheduler.updateIntervalMinutes
      );

      // Cisco practice: one HTTP request, no browser, so it can poll more often
      if (this.cisco) {
        this.scheduler.scheduleUpdateTask(
          () => this.updateCiscoPractice(),
          (this.config.cisco && this.config.cisco.updateIntervalMinutes) || 10
        );
      }

      // Schedule daily scoreboard post
      this.scheduler.scheduleDailyTask(
        () => this.postDailyScoreboard(),
        this.config.scheduler.dailyPostTime,
        this.config.scheduler.timezone
      );

      console.log('Bot initialized successfully!');
      console.log(`Configuration loaded:`);
      console.log(`  - Discord Channel: ${this.config.discord.channelId}`);
      console.log(`  - MySQL: ${this.config.mysql.user}@${this.config.mysql.host}:${this.config.mysql.port || 3306}/${this.config.mysql.database}`);
      console.log(`  - Update Interval: ${this.config.scheduler.updateIntervalMinutes} minutes`);
      console.log(`  - Daily Scoreboard: ${this.config.scheduler.dailyPostTime} ${this.config.scheduler.timezone}`);

      // this.updateAllUsers(); // Initial update on startup
      // this.updateAllTeams(); // Initial update on startup

      // this.postDailyScoreboard(); // Initial scoreboard post on startup

    } catch (error) {
      console.error('Failed to initialize bot:', error.message);
      process.exit(1);
    }
  }

  async validateUserIds() {
    try {
      if (this.config.features.verbose) {
        console.log('Validating user IDs in CSV...');
      }

      const users = await this.csvManager.readUsers();

      if (users.length === 0) {
        console.warn('No users found in CSV file');
        return;
      }

      let missingCount = 0;
      let usersToUpdate = [];

      // Check for users with missing IDs
      for (const user of users) {
        // if (!user.id || user.id.trim() === '') {
          if (this.config.features.verbose) {
            console.log(`  - Fetching ID for user: ${user.username}`);
          }

          try {
            // const userId = await this.picoctfApi.getUserId(user.username);
            const userInfo = await this.picoctfApi.getUserInfo(user.username);
            // if (this.config.features.verbose) {
            //   console.log(`    ✓ User info ${JSON.stringify(userInfo)}`);
            // }

            // Wait 2 seconds before next API call
            await new Promise(resolve => setTimeout(resolve, 2000));

            const userId = userInfo ? userInfo.id : null;
            const eventParticipation = userInfo ? userInfo.event_participation : null;
            if (eventParticipation) {
              for (const event of eventParticipation) {
                if (event.event_id === 79) {
                  const teamId = event.team_id;
                  const teamName = event.team_name;
                  if (teamId && teamName) {
                    if (this.config.features.verbose) {
                      console.log(`    ✓ User participated in picoCTF 2026, team ${teamName} (ID: ${teamId})`);
                    }
                    await this.csvTeamsManager.addTeam(teamName, teamId);
                  }
                  break;
                }
              }
            }

            if (userId) {
              usersToUpdate.push({ username: user.username, id: userId });
              missingCount++;
              if (this.config.features.verbose) {
                console.log(`    ✓ Found ID: ${userId}`);
              }
            } else {
              console.warn(`    ✗ Could not find user ID for ${user.username}`);
            }
          } catch (error) {
            console.warn(`    ✗ Error fetching ID for ${user.username}: ${error.message}`);
          }
        // }
      }

      // Update CSV with fetched IDs
      if (usersToUpdate.length > 0) {
        for (const userUpdate of usersToUpdate) {
          await this.csvManager.updateUser(userUpdate.username, userUpdate.id);
        }
        console.log(`Updated ${usersToUpdate.length} user IDs in CSV`);
      }

      if (this.config.features.verbose) {
        console.log(`User ID validation complete (${missingCount} IDs fetched)`);
      }
    } catch (error) {
      console.error('Error validating user IDs:', error.message);
    }
  }

  async runScheduledUpdates() {
    // Users and teams must run sequentially: they share one browser, and it
    // gets closed between cycles because idle Chrome holds too much memory.
    if (this.updateInProgress) {
      console.warn('Previous update cycle still running, skipping this one');
      return;
    }
    this.updateInProgress = true;
    try {
      await this.updateAllUsers();
      await this.updateAllTeams();
    } finally {
      this.updateInProgress = false;
      await this.picoctfApi.close();
      if (this.config.features.verbose) {
        console.log('Browser closed until next update cycle');
      }
    }
  }

  async updateAllUsers() {
    try {
      if (this.config.features.verbose) {
        console.log('Starting user stats update...');
      }

      const users = await this.csvManager.readUsers();

      if (users.length === 0) {
        console.warn('No users found in CSV file');
        return;
      }

      for (const user of users) {
        const result = await this.dataManager.fetchAndUpdateUserStats(user.username);

        if (result.success && result.hasChanged && this.config.features.updateOnChange) {
          // Create update notification
          const embed = this.discordBot.createUpdateEmbed(
            result.username,
            result.oldStats,
            result.newStats,
            result.difference
          );

          // Send to Discord
          await this.discordBot.sendEmbed(embed);

          if (this.config.features.verbose) {
            console.log(`Notified Discord about ${result.username}'s progress`);
          }
        }
      }

      if (this.config.features.verbose) {
        console.log('User stats update completed');
      }
    } catch (error) {
      console.error('Error during user stats update:', error.message);
    }
  }

  async updateAllTeams() {
    try {
      if (this.config.features.verbose) {
        console.log('Starting team stats update...');
      }

      const teams = await this.csvTeamsManager.readTeams();
      if (teams.length === 0) {
        console.warn('No teams found in CSV file');
        return;
      }

      for (const team of teams) {
        const result = await this.dataManager.compFetchAndUpdateStats(team.teamname);

        if (result.success && result.hasChanged && this.config.features.updateOnChange) {
          // Create update notification
          const embed = this.discordBot.createTeamUpdateEmbed(
            result.teamname,
            result.oldStats,
            result.newStats,
            result.difference
          );

          // Send to Discord
          await this.discordBot.sendEmbed(embed);

          if (this.config.features.verbose) {
            console.log(`Notified Discord about ${result.teamname}'s progress`);
          }
        }
      }

      if (this.config.features.verbose) {
        console.log('Team stats update completed');
      }
    } catch (error) {
      console.error('Error during team stats update:', error.message);
    }
  }

  

  async updateCiscoPractice() {
    try {
      await this.cisco.update();
    } catch (error) {
      console.error('Error during Cisco practice update:', error.message);
    }
  }

  async postDailyScoreboard() {
    try {
      if (this.config.features.verbose) {
        console.log('Posting daily scoreboard...');
      }

      const allStats = await this.dataManager.getAllUserStats();

      if (allStats.length === 0) {
        console.warn('No user stats available for scoreboard');
      } else {
        const embed = this.discordBot.createScoreboardEmbed(allStats);
        await this.discordBot.sendEmbed(embed);
      }

      if (this.config.features.verbose) {
        console.log('Daily scoreboard posted');
      }
    } catch (error) {
      console.error('Error posting daily scoreboard:', error.message);
    }

    // Practice leaderboard section (independent of the picoCTF stats)
    if (this.cisco) {
      try {
        await this.discordBot.sendEmbed(await this.cisco.dailyEmbed(), (this.config.cisco || {}).channelId);
      } catch (error) {
        console.error('Error posting practice leaderboard:', error.message);
      }
    }
  }

  async shutdown() {
    try {
      console.log('Shutting down bot...');
      this.scheduler.cancelAll();
      await this.picoctfApi.close();
      await this.discordBot.destroy();
      await this.database.disconnect();
      console.log('Bot shutdown complete');
    } catch (error) {
      console.error('Error during shutdown:', error.message);
    }
  }
}

// Initialize and run the bot
const bot = new PicoCTFBot(config);

bot.initialize().catch((error) => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down...');
  bot.shutdown().then(() => process.exit(0));
});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down...');
  bot.shutdown().then(() => process.exit(0));
});

module.exports = bot;
