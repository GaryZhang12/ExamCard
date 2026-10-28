const { _electron } = require('../scripts/test-deps.cjs')('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
exports.launch = async function (options = {}) {
  const root = path.resolve(__dirname, '..');
  const target = path.resolve(process.env.EXAMCARD_APP_ROOT || root);
  const profile = options.profile || fs.mkdtempSync(path.join(os.tmpdir(), 'examcard-work-test-'));
  if (path.dirname(profile) !== os.tmpdir() || !path.basename(profile).startsWith('examcard-work-test-')) throw new Error('Unsafe test profile');
  const env = { ...process.env, GD_USER_DATA_DIR: profile, GD_AUTO_SAVE_DIR: path.join(profile, 'exports') };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: process.env.EXAMCARD_ELECTRON || require('electron'),
    args: process.env.EXAMCARD_PACKAGED === '1' ? [] : [target], env, timeout: 30000, cwd: target });
  const info = await app.evaluate(({ app, screen }) => ({ version: app.getVersion(), userData: app.getPath('userData'), electron: process.versions.electron,
    sandbox: app.commandLine.hasSwitch('no-sandbox'), displays: screen.getAllDisplays().map(d => ({ size: d.size, scaleFactor: d.scaleFactor })) }));
  assert.equal(path.resolve(info.userData), path.resolve(profile), 'Must never use the real profile');
  assert.equal(info.sandbox, false, 'Regression suite requires standard sandbox settings');
  const page = await app.firstWindow();
  page.setDefaultTimeout(7000);
  await page.waitForSelector('[data-nav="home"]');
  await page.evaluate(() => ExamStore.withDb(db => Promise.resolve(db.name)));
  return { app, page, info, profile, root, target };
};
