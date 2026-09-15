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

  async readTeams() {
    return new Promise((resolve, reject) => {
      const teams = [];
      fs.createReadStream(this.filePath)
        .pipe(csv())
        .on('data', (data) => {
          if (data.teamname) {
            teams.push({
              teamname: data.teamname.trim(),
              id: data.id ? data.id.trim() : ''
            });
          }
        })
        .on('end', () => resolve(teams))
        .on('error', reject);
    });
  }

  async addTeam(teamname, id) {
    const teams = await this.readTeams();
    const teamExists = teams.some(t => t.teamname.toLowerCase() === teamname.toLowerCase());

    if (teamExists) {
      return false; // Team already exists
    }

    teams.push({ teamname, id });
    await this.writeTeams(teams);
    return true;
  }

  async updateTeam(teamname, id) {
    const teams = await this.readTeams();
    const teamIndex = teams.findIndex(t => t.teamname.toLowerCase() === teamname.toLowerCase());

    if (teamIndex === -1) {
      return false; // Team not found
    }

    teams[teamIndex].id = id;
    await this.writeTeams(teams);
    return true;
  }

  async getTeamId(teamname) {
    const teams = await this.readTeams();
    const team = teams.find(t => t.teamname.toLowerCase() === teamname.toLowerCase());
    return team ? team.id : null;
  }

  async writeTeams(teams) {
    const writer = createObjectCsvWriter({
      path: this.filePath,
      header: [
        { id: 'teamname', title: 'teamname' },
        { id: 'id', title: 'id' }
      ]
    });

    await writer.writeRecords(teams);
  }

  async removeTeam(teamname) {
    const teams = await this.readTeams();
    const filteredTeams = teams.filter(t => t.teamname.toLowerCase() !== teamname.toLowerCase());

    if (teams.length === filteredTeams.length) {
      return false; // Team not found
    }

    await this.writeTeams(filteredTeams);
    return true;
  }
}

module.exports = CSVManager;
