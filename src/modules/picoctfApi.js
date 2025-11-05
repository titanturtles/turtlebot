const axios = require('axios');

class PicoCTFApi {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.axiosInstance = axios.create({
      baseURL: baseUrl,
      timeout: 10000
    });
  }

  async getUserId(username) {
    try {
      const response = await this.axiosInstance.get(`/users/${username}/`);
      return response.data.id;
    } catch (error) {
      if (error.response?.status === 404) {
        return null; // User not found
      }
      throw new Error(`Failed to fetch user ID for ${username}: ${error.message}`);
    }
  }

  async getGymStats(userId) {
    try {
      const response = await this.axiosInstance.get(`/users/${userId}/gym_stats/`);
      // console.log(response.data);
      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        return null; // User or stats not found
      }
      throw new Error(`Failed to fetch gym stats for user ${userId}: ${error.message}`);
    }
  }

  async getUserInfo(username) {
    try {
      const response = await this.axiosInstance.get(`/users/${username}/`);
      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        return null;
      }
      throw new Error(`Failed to fetch user info for ${username}: ${error.message}`);
    }
  }
}

module.exports = PicoCTFApi;
