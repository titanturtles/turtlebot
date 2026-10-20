# PicoCTF Discord Bot

A Node.js Discord bot that automatically tracks PicoCTF gym statistics for multiple users and posts updates to Discord.

## Features

- **Automatic User Tracking**: Store user IDs in CSV and fetch from PicoCTF API if needed
- **Weighted Score Calculation**: Easy (150pts), Medium (300pts), Hard (600pts)
- **Change Detection**: Only posts updates when stats change
- **Database Persistence**: Stores user stats in MySQL
- **Scheduled Updates**: Fetches stats every 15 minutes (configurable)
- **Daily Leaderboard**: Posts a scoreboard at a specified time daily
- **Discord Notifications**: Real-time notifications when users make progress
- **Configuration**: All parameters in `config.json`
- **Practice leaderboard**: Follows the TitanTurtles scoreboard's practice progress — Cisco
  Packet Tracer modules plus Windows/Linux hardening (see below)

## Practice updates

Every `cisco.updateIntervalMinutes` (default 10) the bot reads the scoreboard's
`/practice.json` (the same data as its public Practice page) and posts:

- **Level cleared**: when a team clears new practice levels (one post per team and practice),
  labelled by category (Cisco / Windows / Linux).
- **Module complete**: a gold post when a team clears every level of a practice module.
- **Daily board**: a Practice Leaderboard covering all categories, listing **every team with any
  non-zero progress** (ranked by levels cleared, then modules completed), with a per-category
  breakdown when more than one category has clears, right after the daily PicoCTF scoreboard.

What it has announced is kept in the MySQL table `cisco_practice` by level *name*, so a restart
or renumbered levels never repeat old posts. On the very first run (empty table) it records the
current state without posting. At most 20 posts per cycle, then a one-line summary.

All `cisco` settings are optional: `enabled` (default true), `feedUrl` (default
`https://scoreboard.titanturtles.xyz/practice.json`), `updateIntervalMinutes` (10), `dailyTop`
(optional cap on how many teams the daily board lists; `0`/omitted = list all non-zero teams),
`channelId` (default: the main `discord.channelId`).

## Prerequisites

- Node.js 16+
- MySQL instance running locally or remotely
- Discord Bot Token
- Discord Channel ID and Guild ID

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd picoctf-discord-bot
```

2. Install dependencies:
```bash
npm install
```

3. Configure the bot:
   - Edit `config.json` with your settings:
     - Add your Discord bot token
     - Set channel ID and guild ID
     - Configure MySQL connection details
     - Adjust scoring weights if needed
     - Set daily post time and timezone

4. Add users to track:
   - Edit `data/users.csv` with format: `username,id`
   - Leave the `id` field empty if you want the bot to fetch it from PicoCTF

## Configuration (config.json)

```json
{
  "discord": {
    "token": "YOUR_DISCORD_BOT_TOKEN",
    "channelId": "YOUR_CHANNEL_ID",
    "guildId": "YOUR_GUILD_ID"
  },
  "mysql": {
    "host": "localhost",
    "port": 3306,
    "user": "turtlebot",
    "password": "YOUR_MYSQL_PASSWORD",
    "database": "picoctf_bot"
  },
  "picoctf": {
    "apiBaseUrl": "https://learn.cylabacademy.org/api",
    "username": "",
    "password": "",
    "profileDir": "./data/puppeteer-profile",
    "headless": true
  },
  "csv": {
    "filePath": "./data/users.csv",
    "encoding": "utf8"
  },
  "scoring": {
    "easy": 150,
    "medium": 300,
    "hard": 600
  },
  "scheduler": {
    "updateIntervalMinutes": 15,
    "dailyPostTime": "18:00",
    "timezone": "America/New_York"
  },
  "features": {
    "updateOnChange": true,
    "postDailyScores": true,
    "verbose": true
  }
}
```

## CSV Format

Create `data/users.csv` with the following format:

```csv
username,id
player1,
player2,
player3,12345
```

- Leave `id` blank to auto-fetch from PicoCTF API
- The bot will automatically update the CSV with fetched IDs

## Running the Bot

Development mode (with auto-restart):
```bash
npm run dev
```

Production mode:
```bash
npm start
```

## How It Works

1. **Initialization**: Bot connects to MySQL and Discord, then launches a headless
   browser session (picoCTF/CyLab sits behind Cloudflare, so stats are fetched via
   an authenticated in-page `fetch`, not a plain HTTP client)
2. **User Lookup**: For each user in CSV:
   - Check if ID exists in CSV
   - If not, fetch from the picoCTF API and save to CSV
3. **Stats Fetching**: Every `updateIntervalMinutes`:
   - Fetch gym stats from the picoCTF API for each user
   - Calculate weighted score
   - Compare with stored stats
   - If changed: Update MySQL and post to Discord
4. **Daily Scoreboard**: At configured time:
   - Fetch all user stats from MySQL
   - Sort by total score
   - Post leaderboard embed to Discord

## Score Calculation

Total Score = (Easy Challenges × 150) + (Medium Challenges × 300) + (Hard Challenges × 600)

## Database Schema

Each user record stores:
- `username`: User's PicoCTF username (lowercase)
- `userId`: User's numeric ID from PicoCTF
- `easy`: Number of easy challenges solved
- `medium`: Number of medium challenges solved
- `hard`: Number of hard challenges solved
- `totalScore`: Calculated weighted score
- `lastUpdated`: Timestamp of last update
- `timestamps`: Created and updated timestamps

## Error Handling

- Failed API requests are logged and retried in the next cycle
- Missing users are skipped with a warning
- Database connection failures prevent bot startup
- Discord connection failures are logged but bot continues

## Troubleshooting

### Bot won't start
- Check MySQL is running: `systemctl status mysql`
- Verify Discord token is valid
- Check channel ID and guild ID are correct

### Users not updating
- Verify usernames match exactly (case-insensitive matching in code)
- Check picoCTF/CyLab connectivity with `node scripts/probe-api.js` (a plain `curl`
  won't work — Cloudflare blocks non-browser requests, which is why this bot drives
  a real headless browser instead of a simple HTTP client)
- Check MySQL connection details in `config.json`

### No messages in Discord
- Verify bot has message permissions in the channel
- Check channel ID is correct
- Verify bot is in the server

## Logging

Set `"verbose": true` in config.json to see detailed logs of:
- User updates
- Discord notifications
- Database operations
- Scheduled task execution

## License

ISC
