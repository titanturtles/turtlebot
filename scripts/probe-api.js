const PicoCTFApi = require('../src/modules/picoctfApi');

(async () => {
  const api = new PicoCTFApi({
    apiBaseUrl: 'https://learn.cylabacademy.org/api',
    profileDir: './data/puppeteer-profile',
    headless: true
  });
  try {
    await api.init();
    const info = await api.getUserInfo('biajee2020');
    console.log('USER_INFO:', JSON.stringify(info, null, 2).slice(0, 500));
  } catch (e) {
    console.error('FAIL:', e.message);
  } finally {
    await api.close();
  }
})();
