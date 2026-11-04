/* SPDX-License-Identifier: Apache-2.0 */
/* Portable WP09 mixed-classification regression derived from Work's isolated
   run. It stores only reconstructed numbers/classifications/SHA in the local
   fixture; it never copies the private PDF and never uses a hard-coded user
   home or drive path. Real AppShell + isolated temporary profile. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { launch } = require('./launch.cjs');
const isEnvironmentDenial = require('./p2-ui-skip-policy.cjs');

const root = path.resolve(__dirname, '..');
const reportPath = path.join(root, 'reports/real-report-classification-ui.json');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/real-report-classification.json'), 'utf8'));
const FIXED_NOW = Date.UTC(2026, 10, 3, 2, 0, 0); // 2026-11-03 10:00 Asia/Shanghai
const shots = {
  trends: path.join(root, 'reports/real-report-classification-trends.png'),
  feedback: path.join(root, 'reports/real-report-classification-feedback.png'),
  records: path.join(root, 'reports/real-report-classification-records.png')
};
let c;
let checks = [];
function writeReport(data) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(data, null, 2));
}
function writeSkipReport(data) {
  let previous = null;
  try { previous = JSON.parse(fs.readFileSync(reportPath, 'utf8')); } catch (e) { previous = null; }
  if (previous && previous.status !== 'skip' && previous.profile) {
    fs.writeFileSync(path.join(root, 'reports/real-report-classification-ui-dsh-skip.json'), JSON.stringify(data, null, 2));
  } else {
    writeReport(data);
  }
}
async function waitTrend(page) {
  await page.waitForSelector('#diagTrendReport[data-from]');
  await page.waitForFunction(() => {
    const host = document.querySelector('#diagTrendReport');
    return host && host.getAttribute('data-from') && !/正在按只读快照计算/.test(host.textContent);
  });
}
(async () => {
  try {
    c = await launch();
    const p = c.page;
    const pageErrors = [];
    p.on('pageerror', e => pageErrors.push(String(e)));
    await p.evaluate((fixed) => {
      const RealDate = Date;
      class FixedDate extends RealDate {
        constructor(...args) { if (args.length === 0) super(fixed); else super(...args); }
        static now() { return fixed; }
      }
      window.Date = FixedDate;
    }, FIXED_NOW);

    await p.evaluate(async records => {
      await DiagnosisStore.saveStudyLogs(records, { reason: 'portable WP09 real-report-derived mixed classification' });
    }, fixture.records);
    const before = await p.evaluate(async () => JSON.stringify(await DiagnosisStore.listStudyLogs()));
    checks.push('isolated temporary userData; six reconstructed records saved through StudyLog validation');

    await p.locator('[data-nav="diagnosis-trends"]').click();
    await waitTrend(p);
    const state = await p.evaluate(async () => {
      const r = await TrendEngine.load({ now: Date.UTC(2026, 10, 3), days: 7 });
      const host = document.getElementById('diagTrendReport');
      return {
        header: host.querySelector('.diag-grid').textContent,
        overall: r.overall,
        practiceTypes: r.practiceTypes,
        essays: r.essays.map(e => ({ score: e.score, max: e.maxScore, round: e.round }))
      };
    });
    assert.deepEqual([state.practiceTypes.retest.correct, state.practiceTypes.retest.questions], [12, 18]);
    assert.deepEqual([state.practiceTypes.unclassified.correct, state.practiceTypes.unclassified.questions], [18, 30]);
    assert.equal(state.practiceTypes.new.questions, 0);
    assert.deepEqual([state.practiceTypes.subtotal.correct, state.practiceTypes.subtotal.questions, state.practiceTypes.subtotal.accuracy], [30, 48, 62.5]);
    assert.deepEqual([state.practiceTypes.comprehensive.correct, state.practiceTypes.comprehensive.questions], [11, 15]);
    assert.deepEqual([state.overall.correct, state.overall.questions, state.overall.accuracy], [41, 63, 65.1]);
    assert.match(state.header, /30\s*\/\s*48/);
    assert.match(state.header, /未分类/);
    assert.ok(state.essays.some(x => x.round === 'first' && x.score === 7));
    assert.ok(state.essays.some(x => x.round === 'reevaluation' && x.score === 9));
    await p.screenshot({ path: shots.trends });
    checks.push('trends: 30/48=62.5%, retest 12/18, unclassified 18/30, comprehensive 11/15, overall 41/63, essay 7/9');

    await p.evaluate(async () => { await AppShell.navigate('learn-feedback'); await LearningApp.open('feedback'); });
    await p.waitForFunction(() => {
      const h = document.getElementById('learnTrendSummary');
      return h && h.getAttribute('data-from') && !/正在/.test(h.textContent);
    });
    assert.equal(await p.locator('#learnRoot').isVisible(), true);
    const feedback = await p.locator('#learnTrendSummary').textContent();
    assert.match(feedback, /30\s*\/\s*48/);
    assert.match(feedback, /62\.5/);
    assert.match(feedback, /未分类/);
    await p.screenshot({ path: shots.feedback });
    checks.push('learn-feedback: visible AppShell summary uses the same subtotal, not 专项=新题');

    await p.evaluate(async () => { await AppShell.navigate('learn-records'); await LearningApp.open('records'); });
    await p.waitForSelector('.p0-stats-card');
    assert.equal(await p.locator('#learnRoot').isVisible(), true);
    const records = await p.locator('.p0-stats-card').textContent();
    assert.match(records, /30\s*\/\s*48/);
    assert.match(records, /62\.5/);
    assert.doesNotMatch(records, /专项=新题/);
    await p.screenshot({ path: shots.records });
    checks.push('learn-records: visible stats show 30/48=62.5%, no 专项=新题 equation');

    const after = await p.evaluate(async () => JSON.stringify(await DiagnosisStore.listStudyLogs()));
    assert.equal(after, before, 'read-only stats must not rewrite classifications, groups, grades or audits');
    assert.equal(pageErrors.length, 0, 'renderer page errors: ' + pageErrors.join(' | '));
    const db = await p.evaluate(async () => ExamStore.withDb(d => ({ version: d.version, stores: d.objectStoreNames.length })));
    writeReport({
      status: 'pass',
      scope: fixture.scope,
      sourcePdfSha256: fixture.sourcePdfSha256,
      expected: fixture.expected,
      profile: c.profile,
      info: c.info,
      recordsUnchanged: true,
      db,
      checks,
      screenshots: Object.keys(shots).map(k => 'reports/' + path.basename(shots[k])),
      pageExceptions: pageErrors.length
    });
    console.log('PASS portable real-report-derived mixed classification:', checks.length, 'checks');
  } catch (e) {
    const detail = String(e && e.stack || e);
    if (isEnvironmentDenial(detail)) {
      writeSkipReport({
        status: 'skip',
        reason: 'DSH host cannot spawn Electron/Chromium; Work must run this portable test in a normal-permission Windows session.',
        error: detail.split('\n').slice(0, 8).join('\n'),
        profile: null
      });
      console.log('SKIP portable real-report classification UI:', detail.split('\n')[0]);
    } else {
      writeReport({ status: 'fail', profile: c && c.profile, checks, error: detail });
      console.error(e);
      process.exitCode = 1;
    }
  } finally {
    if (c) await c.app.close().catch(() => {});
  }
})();
