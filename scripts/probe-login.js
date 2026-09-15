const puppeteer = require('puppeteer-extra');
const Stealth = require('puppeteer-extra-plugin-stealth');
puppeteer.use(Stealth());

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  try {
    const page = await browser.newPage();
    await page.goto('https://learn.cylabacademy.org/login', { waitUntil: 'networkidle2', timeout: 60000 });
    const url = page.url();
    const title = await page.title();
    const inputs = await page.$$eval('input', els =>
      els.map(e => ({ name: e.name, id: e.id, type: e.type, placeholder: e.placeholder }))
    );
    const buttons = await page.$$eval('button', els =>
      els.map(e => ({ type: e.type, text: (e.innerText || '').trim().slice(0, 80) }))
    );
    const forms = await page.$$eval('form', els =>
      els.map(e => ({ action: e.action, method: e.method, id: e.id }))
    );
    console.log(JSON.stringify({ url, title, inputs, buttons, forms }, null, 2));
  } catch (e) {
    console.error('PROBE_ERROR:', e.message);
  } finally {
    await browser.close();
  }
})();
