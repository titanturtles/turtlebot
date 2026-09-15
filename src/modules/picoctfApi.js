const path = require('path');
const puppeteer = require('puppeteer-extra');
const Stealth = require('puppeteer-extra-plugin-stealth');

puppeteer.use(Stealth());

class PicoCTFApi {
  constructor(picoctfConfig) {
    const cfg =
      typeof picoctfConfig === 'string'
        ? { apiBaseUrl: picoctfConfig }
        : picoctfConfig || {};

    this.baseUrl = (cfg.apiBaseUrl || 'https://learn.cylabacademy.org/api').replace(/\/+$/, '');
    this.origin = new URL(this.baseUrl).origin;
    this.username = cfg.username || '';
    this.password = cfg.password || '';
    this.userAgent = cfg.userAgent || '';
    this.profileDir = path.resolve(cfg.profileDir || './data/puppeteer-profile');
    this.headless = cfg.headless !== false;
    this.verbose = cfg.verbose !== false;

    this.browser = null;
    this.page = null;
    this._initPromise = null;
  }

  async init() {
    if (this._initPromise) return this._initPromise;
    this._initPromise = this._initInternal().catch((err) => {
      this._initPromise = null;
      throw err;
    });
    return this._initPromise;
  }

  async _initInternal() {
    if (this.verbose) console.log('Launching headless browser for picoCTF...');
    // Cloudflare rejects sessions whose user-agent disagrees with the
    // browser's client hints, so the UA must match the bundled Chromium
    // version and be set via launch flag — page.setUserAgent() gets flagged.
    let userAgent = this.userAgent;
    if (!userAgent) {
      const probe = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
      userAgent = (await probe.userAgent()).replace('HeadlessChrome', 'Chrome');
      await probe.close();
      this.userAgent = userAgent; // cache so relaunches skip the probe
    }
    this.browser = await puppeteer.launch({
      headless: this.headless,
      userDataDir: this.profileDir,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        `--user-agent=${userAgent}`
      ]
    });
    this.page = await this.browser.newPage();
    await this.page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

    // Warm up: hit homepage so Cloudflare cookies settle.
    await this.page.goto(`${this.origin}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });

    let loggedIn = await this._isLoggedIn();
    if (!loggedIn && this.username && this.password) {
      await this._login();
      loggedIn = await this._isLoggedIn();
      if (!loggedIn) throw new Error('picoCTF login appeared to succeed but session is not authenticated');
    }
    if (this.verbose) {
      console.log(loggedIn ? `✓ picoCTF session ready (logged in as ${this.username || 'persisted user'})` : '✓ picoCTF session ready (anonymous)');
    }
  }

  async _isLoggedIn() {
    // Probe the allauth session endpoint inside the page context. It returns
    // 200 when authenticated, 401 otherwise.
    const probe = await this.page.evaluate(async (origin) => {
      try {
        const r = await fetch(`${origin}/api/_allauth/browser/v1/auth/session`, {
          credentials: 'include',
          headers: { Accept: 'application/json' }
        });
        return { status: r.status };
      } catch (e) {
        return { status: 0, error: String(e) };
      }
    }, this.origin);
    return probe.status === 200;
  }

  async _login() {
    if (this.verbose) console.log(`Logging into picoCTF as ${this.username}...`);
    await this.page.goto(`${this.origin}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await this.page.waitForSelector('input#username', { timeout: 30000 });
    await this.page.click('input#username', { clickCount: 3 });
    await this.page.type('input#username', this.username, { delay: 25 });
    await this.page.click('input#password', { clickCount: 3 });
    await this.page.type('input#password', this.password, { delay: 25 });
    await Promise.all([
      this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {}),
      this.page.click('button[type="submit"]')
    ]);
    // Some SPAs don't trigger a full nav — give the SPA a beat.
    await new Promise((r) => setTimeout(r, 2000));
  }

  async _fetch(apiPath) {
    await this.init();
    const url = `${this.baseUrl}${apiPath}`;
    let result;
    try {
      result = await this.page.evaluate(async (u) => {
        try {
          const r = await fetch(u, {
            credentials: 'include',
            headers: { Accept: 'application/json' }
          });
          const body = await r.text();
          return { status: r.status, body };
        } catch (e) {
          return { status: 0, body: '', error: String(e) };
        }
      }, url);
    } catch (e) {
      // Page may have crashed — try once more after re-init.
      await this.close();
      await this.init();
      result = await this.page.evaluate(async (u) => {
        const r = await fetch(u, { credentials: 'include', headers: { Accept: 'application/json' } });
        return { status: r.status, body: await r.text() };
      }, url);
    }
    return result;
  }

  _parse(result, contextMsg) {
    if (result.status === 404) return null;
    if (result.status === 0) throw new Error(`${contextMsg}: in-page fetch failed (${result.error || 'unknown'})`);
    if (result.status >= 400) {
      const snippet = (result.body || '').slice(0, 200);
      throw new Error(`${contextMsg}: HTTP ${result.status} — ${snippet}`);
    }
    try {
      return JSON.parse(result.body);
    } catch (e) {
      throw new Error(`${contextMsg}: response was not JSON (${(result.body || '').slice(0, 120)})`);
    }
  }

  async getUserInfo(username) {
    return this._parse(await this._fetch(`/users/${username}/`), `Failed to fetch user info for ${username}`);
  }

  async getUserId(username) {
    const info = await this.getUserInfo(username);
    return info ? info.id : null;
  }

  async getGymStats(userId) {
    return this._parse(await this._fetch(`/users/${userId}/gym_stats/`), `Failed to fetch gym stats for user ${userId}`);
  }

  async getTeamCompStats(teamId) {
    return this._parse(await this._fetch(`/teams/${teamId}/`), `Failed to fetch team stats for team ${teamId}`);
  }

  async close() {
    if (this.browser) {
      try { await this.browser.close(); } catch (_) {}
    }
    this.browser = null;
    this.page = null;
    this._initPromise = null;
  }
}

module.exports = PicoCTFApi;
