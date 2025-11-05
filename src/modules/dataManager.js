const UserStats = require('../models/UserStats');

class DataManager {
  constructor(csvManager, picoctfApi, scoreCalculator, config) {
    this.csvManager = csvManager;
    this.picoctfApi = picoctfApi;
    this.scoreCalculator = scoreCalculator;
    this.config = config;
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async getUserId(username) {
    // First, check CSV
    let userId = await this.csvManager.getUserId(username);

    if (!userId) {
      // If not in CSV, fetch from API
      userId = await this.picoctfApi.getUserId(username);

      // Wait 2 seconds before next API call
      await this.delay(2000);

      if (userId) {
        // Add to CSV
        await this.csvManager.addUser(username, userId);
        console.log(`Added user ${username} with ID ${userId} to CSV`);
      }
    }

    return userId;
  }

  async fetchAndUpdateUserStats(username) {
    try {
      // Get user ID
      const userId = await this.getUserId(username);

      if (!userId) {
        console.warn(`Could not find user ID for ${username}`);
        return { success: false, reason: 'User not found' };
      }

      // Fetch gym stats
      const gymStats = await this.picoctfApi.getGymStats(userId);

      // Wait 2 seconds before next API call
      await this.delay(2000);

      if (!gymStats) {
        console.warn(`Could not fetch gym stats for ${username}`);
        return { success: false, reason: 'Gym stats not found' };
      }

      // Calculate score
      const newStats = this.scoreCalculator.calculateScore(gymStats);

      console.log(`Fetched stats for ${username}:`, newStats);

      // Get old stats from database
      let userRecord = await UserStats.findOne({ username: username.toLowerCase() });

      let oldStats = null;
      let hasChanged = false;
      let difference = null;

      if (userRecord) {
        oldStats = {
          easy: userRecord.easy,
          medium: userRecord.medium,
          hard: userRecord.hard,
          totalScore: userRecord.totalScore
        };

        hasChanged = this.scoreCalculator.hasChanged(oldStats, newStats);

        if (hasChanged) {
          difference = this.scoreCalculator.getScoreDifference(oldStats, newStats);
        }
      } else {
        // First time tracking this user
        hasChanged = true;
        oldStats = {
          easy: 0,
          medium: 0,
          hard: 0,
          totalScore: 0
        };
        difference = newStats;
      }

      // Update database only if there's a change
      if (hasChanged) {
        const updatedRecord = await UserStats.findOneAndUpdate(
          { username: username.toLowerCase() },
          {
            username: username.toLowerCase(),
            userId: userId,
            easy: newStats.easy,
            medium: newStats.medium,
            hard: newStats.hard,
            totalScore: newStats.totalScore,
            easyWeight: this.config.scoring.easy,
            mediumWeight: this.config.scoring.medium,
            hardWeight: this.config.scoring.hard,
            lastUpdated: new Date()
          },
          { upsert: true, new: true }
        );

        console.log(`Updated ${username}: Easy=${newStats.easy}, Medium=${newStats.medium}, Hard=${newStats.hard}, Score=${newStats.totalScore}`);

        return {
          success: true,
          hasChanged: true,
          username: username,
          oldStats: oldStats,
          newStats: newStats,
          difference: difference
        };
      } else {
        console.log(`No changes for ${username}`);
        return {
          success: true,
          hasChanged: false,
          username: username
        };
      }
    } catch (error) {
      console.error(`Error fetching stats for ${username}:`, error.message);
      return { success: false, reason: error.message };
    }
  }

  async getAllUserStats() {
    try {
      const users = await this.csvManager.readUsers();
      const stats = [];

      for (const user of users) {
        const userStat = await UserStats.findOne({ username: user.username.toLowerCase() });
        if (userStat) {
          stats.push({
            username: userStat.username,
            easy: userStat.easy,
            medium: userStat.medium,
            hard: userStat.hard,
            totalScore: userStat.totalScore
          });
        }
      }

      return stats;
    } catch (error) {
      console.error('Error fetching all user stats:', error.message);
      return [];
    }
  }
}

module.exports = DataManager;
