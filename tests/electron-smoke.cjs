const { _electron } = require('../scripts/test-deps.cjs')('playwright');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const root = path.resolve(__dirname, '..');
  const profile = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'examcard-work-test-'));
  fs.mkdirSync(profile, { recursive: true });
  const env = { ...process.env, GD_USER_DATA_DIR: profile, GD_AUTO_SAVE_DIR: path.join(profile, 'exports') };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: process.env.EXAMCARD_ELECTRON || require('electron'), args: [...(process.env.EXAMCARD_TEST_NO_SANDBOX === '1' ? ['--no-sandbox'] : []), root], env, timeout: 30000 });
  try {
    console.log(await app.evaluate(({ app }) => ({ version: app.getVersion(), userData: app.getPath('userData'), electron: process.versions.electron })));
    const page = await app.firstWindow();
    await page.waitForSelector('[data-nav="home"]');
    console.log(await page.evaluate(() => ({ title: document.title, state: AppShell.getState ? AppShell.getState() : null, text: document.body.innerText.slice(0, 200) })));
    await page.screenshot({ path: path.join(root, 'reports', 'smoke.png') });
  } finally { await app.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
