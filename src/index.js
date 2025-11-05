const config = require('../config.json');
const CSVManager = require('./modules/csvManager');
const PicoCTFApi = require('./modules/picoctfApi');
const Database = require('./modules/database');
const DiscordBot = require('./modules/discordBot');
const ScoreCalculator = require('./modules/scoreCalculator');
const DataManager = require('./modules/dataManager');
const Scheduler = require('./modules/scheduler');

class PicoCTFBot {
  constructor(config) {
    this.config = config;
    this.csvManager = new CSVManager(config.csv.filePath);
    this.picoctfApi = new PicoCTFApi(config.picoctf.apiBaseUrl);
    this.database = new Database(config.mongodb.uri, config);
    this.discordBot = new DiscordBot(config.discord.token, config);
    this.scoreCalculator = new ScoreCalculator(config.scoring);
    this.dataManager = new DataManager(this.csvManager, this.picoctfApi, this.scoreCalculator, config);
    this.scheduler = new Scheduler(config);
    this.recentUpdates = new Set(); // Track recent updates to avoid duplicates
  }

  async initialize() {
    try {
      console.log('Initializing PicoCTF Discord Bot...');

      // Connect to MongoDB
      await this.database.connect();

      // Initialize Discord Bot
      await this.discordBot.initialize();

      // Validate and populate missing user IDs
      await this.validateUserIds();

      // Schedule update task
      this.scheduler.scheduleUpdateTask(
        () => this.updateAllUsers(),
        this.config.scheduler.updateIntervalMinutes
      );

      // Schedule daily scoreboard post
      this.scheduler.scheduleDailyTask(
        () => this.postDailyScoreboard(),
        this.config.scheduler.dailyPostTime,
        this.config.scheduler.timezone
      );

      console.log('Bot initialized successfully!');
      console.log(`Configuration loaded:`);
      console.log(`  - Discord Channel: ${this.config.discord.channelId}`);
      console.log(`  - MongoDB: ${this.config.mongodb.uri}`);
      console.log(`  - Update Interval: ${this.config.scheduler.updateIntervalMinutes} minutes`);
      console.log(`  - Daily Scoreboard: ${this.config.scheduler.dailyPostTime} ${this.config.scheduler.timezone}`);

      this.updateAllUsers(); // Initial update on startup

      this.postDailyScoreboard(); // Initial scoreboard post on startup

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
        if (!user.id || user.id.trim() === '') {
          if (this.config.features.verbose) {
            console.log(`  - Fetching ID for user: ${user.username}`);
          }

          try {
            const userId = await this.picoctfApi.getUserId(user.username);

            // Wait 2 seconds before next API call
            await new Promise(resolve => setTimeout(resolve, 2000));

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
        }
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

  async postDailyScoreboard() {
    try {
      if (this.config.features.verbose) {
        console.log('Posting daily scoreboard...');
      }

      const allStats = await this.dataManager.getAllUserStats();

      if (allStats.length === 0) {
        console.warn('No user stats available for scoreboard');
        return;
      }

      const embed = this.discordBot.createScoreboardEmbed(allStats);
      await this.discordBot.sendEmbed(embed);

      if (this.config.features.verbose) {
        console.log('Daily scoreboard posted');
      }
    } catch (error) {
      console.error('Error posting daily scoreboard:', error.message);
    }
  }

  async shutdown() {
    try {
      console.log('Shutting down bot...');
      this.scheduler.cancelAll();
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
