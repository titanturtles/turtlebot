const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { createObjectCsvWriter } = require('csv-writer');

class CSVManager {
  constructor(filePath) {
    this.filePath = filePath;
    this.ensureFileExists();
  }

  ensureFileExists() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, 'username,id\n', 'utf8');
    }
  }

  async readUsers() {
    return new Promise((resolve, reject) => {
      const users = [];
      fs.createReadStream(this.filePath)
        .pipe(csv())
        .on('data', (data) => {
          if (data.username) {
            users.push({
              username: data.username.trim(),
              id: data.id ? data.id.trim() : ''
            });
          }
        })
        .on('end', () => resolve(users))
        .on('error', reject);
    });
  }

  async addUser(username, id) {
    const users = await this.readUsers();
    const userExists = users.some(u => u.username.toLowerCase() === username.toLowerCase());

    if (userExists) {
      return false; // User already exists
    }

    users.push({ username, id });
    await this.writeUsers(users);
    return true;
  }

  async updateUser(username, id) {
    const users = await this.readUsers();
    const userIndex = users.findIndex(u => u.username.toLowerCase() === username.toLowerCase());

    if (userIndex === -1) {
      return false; // User not found
    }

    users[userIndex].id = id;
    await this.writeUsers(users);
    return true;
  }

  async getUserId(username) {
    const users = await this.readUsers();
    const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
    return user ? user.id : null;
  }

  async writeUsers(users) {
    const writer = createObjectCsvWriter({
      path: this.filePath,
      header: [
        { id: 'username', title: 'username' },
        { id: 'id', title: 'id' }
      ]
    });

    await writer.writeRecords(users);
  }

  async removeUser(username) {
    const users = await this.readUsers();
    const filteredUsers = users.filter(u => u.username.toLowerCase() !== username.toLowerCase());

    if (users.length === filteredUsers.length) {
      return false; // User not found
    }

    await this.writeUsers(filteredUsers);
    return true;
  }
}

module.exports = CSVManager;
