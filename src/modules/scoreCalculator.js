class ScoreCalculator {
  constructor(weights) {
    this.weights = {
      easy: weights.easy || 150,
      medium: weights.medium || 300,
      hard: weights.hard || 600
    };
  }

  calculateScore(gymStats) {
    if (!gymStats) {
      return {
        easy: 0,
        medium: 0,
        hard: 0,
        totalScore: 0
      };
    }

    const stats = {
      easy: parseInt(gymStats.by_difficulty['1'].solved) || 0,
      medium: parseInt(gymStats.by_difficulty['2'].solved) || 0,
      hard: parseInt(gymStats.by_difficulty['3'].solved) || 0
    };

    stats.totalScore =
      (stats.easy * this.weights.easy) +
      (stats.medium * this.weights.medium) +
      (stats.hard * this.weights.hard);

    console.log(`Calculated Score - Easy: ${stats.easy}, Medium: ${stats.medium}, Hard: ${stats.hard}, Total: ${stats.totalScore}`);
    
    return stats;
  }

  compCalculateScore(compStats) {
    if (!compStats) {
      return {
        team_score: 0,
        members: []
      };
    }

    const stats = {
      team_score: parseInt(compStats.team_score) || 0,
      members: compStats.members || []
    };

    console.log(`Calculated Score - Team Score: ${stats.team_score}, Members: ${stats.members.length}`);
    
    return stats;
  }

  hasChanged(oldStats, newStats) {
    if (!oldStats) return true;

    return (
      oldStats.easy !== newStats.easy ||
      oldStats.medium !== newStats.medium ||
      oldStats.hard !== newStats.hard
    );
  }

  compHasChanged(oldStats, newStats) {
    if (!oldStats && newStats.team_score !== 0) return true;
    var old_score = oldStats ? oldStats.team_score : 0;
    console.log("old and new", oldStats, newStats);
    return (
      old_score !== newStats.team_score
    );
  }

  getScoreDifference(oldStats, newStats) {
    if (!oldStats) {
      return {
        easy: newStats.easy,
        medium: newStats.medium,
        hard: newStats.hard,
        totalScore: newStats.totalScore
      };
    }

    return {
      easy: newStats.easy - oldStats.easy,
      medium: newStats.medium - oldStats.medium,
      hard: newStats.hard - oldStats.hard,
      totalScore: newStats.totalScore - oldStats.totalScore
    };
  }

  compGetScoreDifference(oldStats, newStats) {
    if (!oldStats) {
      return {
        team_score: newStats.team_score
      };
    }

    return {
      team_score: newStats.team_score - oldStats.team_score,
    };
  }

}

module.exports = ScoreCalculator;
