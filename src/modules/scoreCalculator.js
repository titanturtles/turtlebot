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

  hasChanged(oldStats, newStats) {
    if (!oldStats) return true;

    return (
      oldStats.easy !== newStats.easy ||
      oldStats.medium !== newStats.medium ||
      oldStats.hard !== newStats.hard
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
}

module.exports = ScoreCalculator;
