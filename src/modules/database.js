const mongoose = require('mongoose');

class Database {
  constructor(mongoUri, config) {
    this.mongoUri = mongoUri;
    this.config = config;
  }

  async connect() {
    try {
      await mongoose.connect(this.mongoUri, {
        useNewUrlParser: true,
        useUnifiedTopology: true
      });
      console.log('Connected to MongoDB');
      return true;
    } catch (error) {
      console.error('Failed to connect to MongoDB:', error.message);
      throw error;
    }
  }

  async disconnect() {
    try {
      await mongoose.disconnect();
      console.log('Disconnected from MongoDB');
      return true;
    } catch (error) {
      console.error('Failed to disconnect from MongoDB:', error.message);
      throw error;
    }
  }

  getConnection() {
    return mongoose.connection;
  }
}

module.exports = Database;
