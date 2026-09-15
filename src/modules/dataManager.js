class DataManager {
  constructor(csvManager, csvTeamsManager, picoctfApi, database, scoreCalculator, config) {
    this.csvManager = csvManager;
    this.csvTeamsManager = csvTeamsManager;
    this.picoctfApi = picoctfApi;
    this.database = database;
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

  async getTeamId(teamname) {
    // Team IDs are discovered via each member's event_participation (see
    // validateUserIds in index.js) — there is no CyLab endpoint to look up
    // a team by name, so if it's not already in the CSV we can't resolve it.
    return this.csvTeamsManager.getTeamId(teamname);
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
      let userRecord = await this.database.getUserStats(username);

      let oldStats = null;
      let hasChanged = false;
      let difference = null;

      if (userRecord) {
        oldStats = {
          easy: userRecord.easy,
          medium: userRecord.medium,
          hard: userRecord.hard,
          totalScore: userRecord.total_score
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
        await this.database.upsertUserStats({
          username: username.toLowerCase(),
          userId: userId,
          easy: newStats.easy,
          medium: newStats.medium,
          hard: newStats.hard,
          totalScore: newStats.totalScore,
          easyWeight: this.config.scoring.easy,
          mediumWeight: this.config.scoring.medium,
          hardWeight: this.config.scoring.hard
        });

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

  async compFetchAndUpdateStats(teamName) {
    try {
      // Get team ID
      const teamId = await this.getTeamId(teamName);

      if (!teamId) {
        console.warn(`Could not find team ID for ${teamName}`);
        return { success: false, reason: 'Team not found' };
      }

      // Fetch team competition stats
      const compStats = await this.picoctfApi.getTeamCompStats(teamId);

      // Wait 2 seconds before next API call
      await this.delay(2000);

      if (!compStats) {
        console.warn(`Could not fetch team competition stats for ${teamName}`);
        return { success: false, reason: 'Team competition stats not found' };
      }

      // Calculate score
      const newStats = this.scoreCalculator.compCalculateScore(compStats);

      console.log(`Fetched stats for ${teamName}:`, newStats);

      // Get old stats from database
      let teamRecord = await this.database.getTeamStats(teamName);

      let oldStats = null;
      let hasChanged = false;
      let difference = null;

      if (teamRecord) {
        oldStats = {
          team_score: teamRecord.team_score,
          members: teamRecord.members
        };

        hasChanged = this.scoreCalculator.compHasChanged(oldStats, newStats);

        if (hasChanged) {
          difference = this.scoreCalculator.compGetScoreDifference(oldStats, newStats);
        }
      } else {
        // First time tracking this team
        hasChanged = true;
        oldStats = {
          team_score: 0,
          members: []
        };
        difference = newStats;
      }

      // Update database only if there's a change
      if (hasChanged) {
        await this.database.upsertTeamStats({
          teamname: teamName.toLowerCase(),
          teamId: teamId,
          team_score: newStats.team_score,
          members: newStats.members
        });

        console.log(`Updated ${teamName}: Team Score=${newStats.team_score}, Members=${newStats.members.length}`);

        return {
          success: true,
          hasChanged: true,
          teamname: teamName,
          oldStats: oldStats,
          newStats: newStats,
          difference: difference
        };
      } else {
        console.log(`No changes for ${teamName}`);
        return {
          success: true,
          hasChanged: false,
          teamname: teamName
        };
      }
    } catch (error) {
      console.error(`Error fetching stats for ${teamName}:`, error.message);
      return { success: false, reason: error.message };
    }
  }

  async getAllUserStats() {
    try {
      const users = await this.csvManager.readUsers();
      const stats = [];

      for (const user of users) {
        const userStat = await this.database.getUserStats(user.username);
        if (userStat) {
          stats.push({
            username: userStat.username,
            easy: userStat.easy,
            medium: userStat.medium,
            hard: userStat.hard,
            totalScore: userStat.total_score
          });
        }
      }

      return stats;
    } catch (error) {
      console.error('Error fetching all user stats:', error.message);
      return [];
    }
  }

  async getAllTeamStats() {
    try {
      const teams = await this.csvTeamsManager.readTeams();
      const stats = [];

      for (const team of teams) {
        const teamStat = await this.database.getTeamStats(team.teamname);
        if (teamStat) {
          stats.push({
            teamname: teamStat.teamname,
            team_score: teamStat.team_score,
            members: teamStat.members
          });
        }
      }

      return stats;
    } catch (error) {
      console.error('Error fetching all team stats:', error.message);
      return [];
    }
  }

}


module.exports = DataManager;
