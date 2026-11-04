/* SPDX-License-Identifier: Apache-2.0 */
/* Optional P1 WP07 acceptance against the user's real local report, selected
   only by environment/local path. The real PDF is read in place, never copied
   into the repository, modified, or committed. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { launch } = require('./launch.cjs');

const root = path.resolve(__dirname, '..');
const reportPath = path.join(root, 'reports/p1-real-report-ui.json');
const realPath = process.env.EXAMCARD_REAL_REPORT || '';
const expectedSha = '92b28cc02002e7c3f9b2728de19d56d37860d1bc9a5123a732d425c9d5f1d1fe';
function sha(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function writeReport(data) { fs.mkdirSync(path.dirname(reportPath), { recursive: true }); fs.writeFileSync(reportPath, JSON.stringify(data, null, 2)); }

(async () => {
  let c = null;
  const checks = [];
  if (!fs.existsSync(realPath)) {
    writeReport({ status: 'skip', reason: 'EXAMCARD_REAL_REPORT not set or file unavailable', checks: [] });
    console.log('SKIP real report unavailable:', realPath);
    return;
  }
  const before = sha(realPath);
  if (before !== expectedSha) {
    writeReport({ status: 'fail', reason: 'real report SHA-256 mismatch; refusing to archive', expectedSha, actualSha: before, checks });
    throw new Error('real report SHA-256 mismatch');
  }
  try {
    try { c = await launch(); } catch (e) {
      const detail = String(e && e.stack || e);
      if (/spawn EPERM|platform_channel|拒绝访问/i.test(detail)) {
        writeReport({ status: 'skip', reason: 'DSH host sandbox blocks spawning Electron; verified real report SHA only. Work must run in a normal-permission session.', file: realPath, sha256: before, error: detail.split('\n').slice(0, 8).join('\n'), checks: [] });
        console.log('SKIP real-report Electron UI blocked by host sandbox');
        return;
      }
      writeReport({ status: 'fail', phase: 'launch', file: realPath, sha256: before, error: detail, checks });
      throw e;
    }
    const { page } = c;
    page.setDefaultTimeout(12000);
    await page.evaluate(async () => { await AppShell.navigate('learn-plans'); await LearningApp.open('reports'); });
    await page.waitForSelector('#learnImportReport');
    await page.locator('#learnImportReport').click();
    await page.setInputFiles('#learnReportFile', realPath);
    await page.waitForSelector('#learnModalRoot .learn-modal');
    await page.locator('#learnReportTitle').fill('2026-11-02 广东省考学习复盘完整报告');
    await page.locator('#learnReportDateInput').fill('2026-11-02');
    await page.locator('#learnReportKnowledge').fill('资料分析,判断推理,数量关系,言语理解,申论');
    await page.locator('#learnModalRoot [data-ok]').click();
    await page.waitForFunction(() => !document.querySelector('#learnModalRoot .learn-mask'));
    await page.waitForFunction(() => document.querySelectorAll('[data-open-report]').length === 1);
    const rec = await page.evaluate(async () => (await ReviewArchive.list())[0]);
    assert.equal(rec.sha256, before);
    assert.equal(rec.date, '2026-11-02');
    assert.equal(sha(realPath), before, 'original real report must remain unchanged');
    checks.push('real report archived by user-selected local path with matching SHA and unchanged source');
    writeReport({ status: 'pass', file: realPath, sha256: before, profile: c.profile, checks });
    console.log('PASS real-report archive UI');
  } catch (e) {
    writeReport({ status: 'fail', file: realPath, sha256: before, profile: c && c.profile, checks, error: String(e && e.stack || e) });
    throw e;
  } finally {
    if (c) await c.app.close().catch(() => {});
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
