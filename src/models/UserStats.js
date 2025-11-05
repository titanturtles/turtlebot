const mongoose = require('mongoose');

const userStatsSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true
    },
    userId: {
      type: Number,
      required: true
    },
    easy: {
      type: Number,
      default: 0
    },
    medium: {
      type: Number,
      default: 0
    },
    hard: {
      type: Number,
      default: 0
    },
    totalScore: {
      type: Number,
      default: 0
    },
    lastUpdated: {
      type: Date,
      default: Date.now
    },
    easyWeight: {
      type: Number,
      default: 150
    },
    mediumWeight: {
      type: Number,
      default: 300
    },
    hardWeight: {
      type: Number,
      default: 600
    }
  },
  { timestamps: true }
);

// Calculate total score before saving
userStatsSchema.pre('save', function (next) {
  this.totalScore =
    (this.easy * this.easyWeight) +
    (this.medium * this.mediumWeight) +
    (this.hard * this.hardWeight);
  this.lastUpdated = new Date();
  next();
});

module.exports = mongoose.model('UserStats', userStatsSchema);
