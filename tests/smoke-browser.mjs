import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const server = spawn('node', ['server.js'], { env: { ...process.env, NODE_ENV: 'development', PORT: '3998', DB_PATH: 'data/smoke.db', BASE_URL: 'http://localhost:3998', SANDBOX_ENABLED: '0' }, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1200));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
const errors = [];
async function shoot(lang, out, out2) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: lang === 'ar' ? 'ar-TN' : 'fr-FR' });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(lang + ' PAGEERROR ' + e.message));
  await page.goto('http://localhost:3998/', { waitUntil: 'load' });
  await page.evaluate((l) => { localStorage.setItem('lang', l); localStorage.setItem('kifeh_country', 'TN'); }, lang);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(900);
  await page.screenshot({ path: out });
  await page.goto('http://localhost:3998/declare.html', { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.click('[data-type="fire"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: out2 });
  console.log(lang, 'dir =', await page.evaluate(() => document.documentElement.dir));
  await ctx.close();
}
await shoot('fr', '/tmp/home-fr.png', '/tmp/declare-fr.png');
await shoot('ar', '/tmp/home-ar.png', '/tmp/declare-ar.png');
console.log('ERRORS:', JSON.stringify(errors));
await browser.close(); server.kill();
