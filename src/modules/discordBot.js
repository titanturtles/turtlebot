const { Client, GatewayIntentBits, ChannelType, EmbedBuilder } = require('discord.js');

class DiscordBot {
  constructor(token, config) {
    this.token = token;
    this.config = config;
    // Discord withholds attachments (and text) from messages that don't mention the bot unless the
    // privileged Message Content intent is on, so reading screenshots needs it enabled in the developer
    // portal AND `community.messageContent: true` here (login fails with "disallowed intents" otherwise).
    const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages];
    if (((config || {}).community || {}).messageContent) intents.push(GatewayIntentBits.MessageContent);
    this.client = new Client({ intents });
    this.ready = false;
  }

  async initialize() {
    return new Promise((resolve, reject) => {
      this.client.once('ready', () => {
        console.log(`Discord bot logged in as ${this.client.user.tag}`);
        this.ready = true;
        resolve();
      });

      this.client.on('error', (error) => {
        console.error('Discord bot error:', error);
      });

      this.client.login(this.token).catch(reject);
    });
  }

  async getChannel(channelId) {
    try {
      const channel = await this.client.channels.fetch(channelId || this.config.discord.channelId);
      if (!channel) {
        throw new Error('Channel not found');
      }
      return channel;
    } catch (error) {
      throw new Error(`Failed to fetch channel: ${error.message}`);
    }
  }

  // channelId is optional (the Cisco practice posts can go to their own channel)
  async sendMessage(content, channelId) {
    try {
      const channel = await this.getChannel(channelId);
      await channel.send(content);
      return true;
    } catch (error) {
      console.error('Failed to send message:', error.message);
      return false;
    }
  }

  async sendEmbed(embed, channelId) {
    try {
      const channel = await this.getChannel(channelId);
      await channel.send({ embeds: [embed] });
      return true;
    } catch (error) {
      console.error('Failed to send embed:', error.message);
      return false;
    }
  }

  createUpdateEmbed(username, oldStats, newStats, difference) {
    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle(`🎉 ${username} has made progress!`)
      .addFields(
        {
          name: 'Easy Challenges',
          value: `${oldStats.easy} → **${newStats.easy}** (+${difference.easy})`,
          inline: true
        },
        {
          name: 'Medium Challenges',
          value: `${oldStats.medium} → **${newStats.medium}** (+${difference.medium})`,
          inline: true
        },
        {
          name: 'Hard Challenges',
          value: `${oldStats.hard} → **${newStats.hard}** (+${difference.hard})`,
          inline: true
        },
        {
          name: 'Total Score',
          value: `${oldStats.totalScore} → **${newStats.totalScore}** (+${difference.totalScore})`,
          inline: false
        }
      )
      .setTimestamp();

    return embed;
  }

  createTeamUpdateEmbed(teamname, oldStats, newStats, difference) {
    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle(`🎉 ${teamname} has made progress!`)
      .addFields(
        {
          name: 'Team Score',
          value: `${oldStats.team_score} → **${newStats.team_score}** (+${difference.team_score})`,
          inline: true
        }
      )
      .setTimestamp();

    return embed;
  }

  createScoreboardEmbed(userScores) {
    const sortedScores = [...userScores].sort((a, b) => b.totalScore - a.totalScore);

    const embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle('📊 PicoCTF Gym Leaderboard')
      .setTimestamp();

    let description = '';
    sortedScores.forEach((user, index) => {
      const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
      description += `${medal} **${user.username}** - ${user.totalScore} pts (${user.easy}E | ${user.medium}M | ${user.hard}H)\n`;
    });

    embed.setDescription(description || 'No user stats available');
    return embed;
  }

  async destroy() {
    try {
      await this.client.destroy();
      console.log('Discord bot disconnected');
      return true;
    } catch (error) {
      console.error('Failed to destroy bot:', error.message);
      return false;
    }
  }

  isReady() {
    return this.ready && this.client.isReady();
  }
}

module.exports = DiscordBot;
