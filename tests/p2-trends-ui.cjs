/* SPDX-License-Identifier: Apache-2.0 */
/* ExamCard 1.2.0 P2 WP09 isolated Electron/Playwright acceptance.
   Real AppShell, real IndexedDB, real v5/22 -> v6/28 migration, isolated
   temporary profile from tests/launch.cjs. Never uses --no-sandbox and never
   overwrites Work's existing P1 reports. A host sandbox that cannot spawn
   Electron reports SKIP (not PASS). */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { launch } = require('./launch.cjs');
const isEnvironmentDenial = require('./p2-ui-skip-policy.cjs');

const root = path.resolve(__dirname, '..');
const reportPath = path.join(root, 'reports/p2-trends-ui.json');
const screenshotPath = path.join(root, 'reports/p2-trends-ui.png');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/external-practice-2026-11-02.json'), 'utf8'));
const div19 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/external-practice-2026-11-02-div19.json'), 'utf8')).records[0];
const FIXED_NOW = Date.UTC(2026, 10, 3, 2, 0, 0); // 2026-11-03 10:00 Asia/Shanghai

function writeReport(data) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(data, null, 2));
}
function writeSkipReport(data) {
  // Never overwrite a normal-permission UI PASS/FAIL with a DSH-only SKIP.
  let previous = null;
  try { previous = JSON.parse(fs.readFileSync(reportPath, 'utf8')); } catch (e) { previous = null; }
  if (previous && previous.status !== 'skip' && previous.profile) {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(path.join(root, 'reports/p2-trends-ui-dsh-skip.json'), JSON.stringify(data, null, 2));
  } else {
    writeReport(data);
  }
}
async function waitTrend(page, days) {
  await page.waitForSelector('#diagTrendReport[data-days="' + days + '"]');
  await page.waitForFunction((d) => {
    const host = document.querySelector('#diagTrendReport');
    return host && host.getAttribute('data-days') === String(d) && !/正在按只读快照计算/.test(host.textContent);
  }, days);
}
async function trendText(page) {
  return page.locator('#diagTrendReport').textContent();
}
async function waitLearnSummary(page, days) {
  await page.waitForFunction((d) => {
    const h = document.querySelector('#learnTrendSummary');
    return h && h.getAttribute('data-days') === String(d) && !/正在按只读快照计算/.test(h.textContent);
  }, days);
}

(async () => {
  let c = null;
  const checks = [];
  const pageErrors = [];
  try {
    try {
      c = await launch();
    } catch (e) {
      const detail = String(e && e.stack || e);
      if (isEnvironmentDenial(detail)) {
        writeSkipReport({
          status: 'skip',
          reason: 'DSH host sandbox blocks spawning Electron/Chromium (spawn EPERM / platform-channel denied). No isolated UI process was created. Work must run this same test in a normal-permission Windows session.',
          error: detail.split('\n').slice(0, 8).join('\n'),
          profile: null,
          checks: [],
          preservedWorkReports: 'reports/p1-*.json/png were not opened or written'
        });
        console.log('SKIP Electron UI blocked by host sandbox:', detail.split('\n')[0]);
        return;
      }
      writeReport({ status: 'fail', phase: 'launch', error: detail });
      throw e;
    }
    const { page } = c;
    page.setDefaultTimeout(12000);
    page.on('pageerror', e => pageErrors.push(String(e)));
    await page.waitForSelector('[data-nav="home"]');
    const profileInfo = await c.app.evaluate(({ app }) => ({ userData: app.getPath('userData'), sandbox: app.commandLine.hasSwitch('no-sandbox') }));
    assert.equal(path.resolve(profileInfo.userData), path.resolve(c.profile), 'must use isolated temporary profile');
    assert.equal(profileInfo.sandbox, false, 'must not use --no-sandbox');
    checks.push('isolated temporary userData=' + c.profile + '; sandbox=false');

    // Freeze the renderer clock on 2026-11-03 10:00 Shanghai so 7/14/30 windows
    // are deterministic. Product code still uses Date.now normally.
    await page.evaluate((fixed) => {
      const RealDate = Date;
      class FixedDate extends RealDate {
        constructor(...args) { if (args.length === 0) super(fixed); else super(...args); }
        static now() { return fixed; }
      }
      window.Date = FixedDate;
    }, FIXED_NOW);

    // Seed the synthetic 2026-11-02 external activities on the untouched v5/22
    // profile. 19/30 is then corrected through the real audit path to 18/30.
    const seeded = await page.evaluate(async (payload) => {
      const external = payload.fixture.records
        .filter(r => r.externalId !== 'synthetic-20261102-cf')
        .map(r => Object.assign({ kind: 'external' }, r));
      await DiagnosisStore.saveStudyLogs(external, { reason: 'P2 WP09 合成趋势数据' });
      await DiagnosisStore.saveStudyLogs([Object.assign({ kind: 'external' }, payload.div19)], { reason: 'P2 WP09 19/30 原始记录' });
      const raw = (await DiagnosisStore.listStudyLogs()).find(x => x.externalId === 'synthetic-20261102-cf');
      const corrected = await DiagnosisStore.updateStudyLog(raw.id, {
        content: '三位数除法训练（合成验收：18/30，980 秒）',
        questionCount: 30, correctCount: 18, durationSeconds: 980, durationMinutes: 980 / 60,
        durationPrecision: 'exact', durationUnit: 'seconds',
        groups: [
          { label: '第一组', questionCount: 10, correctCount: 7, durationSeconds: 235 },
          { label: '第二组', questionCount: 10, correctCount: 6, durationSeconds: 389 },
          { label: '第三组', questionCount: 10, correctCount: 5, durationSeconds: 356 }
        ]
      }, { expectedRevision: raw.revision, reason: '历史 19/30 更正为 18/30' });
      await DiagnosisStore.saveStudyLogs([{
        kind: 'external', source: 'fenbi-synthetic', externalId: 'p2-old-essay', date: '2026-10-20',
        assessment: 'essay', module: '申论', topic: '旧申论', content: '旧申论窗口样本',
        durationPrecision: 'unknown', essayScores: [{ round: 'first', score: 8, maxScore: 10 }]
      }], { reason: 'P2 WP09 旧窗口申论样本' });
      return {
        count: (await DiagnosisStore.listStudyLogs()).length,
        correctedCorrect: corrected.correctCount,
        correctedRevision: corrected.revision,
        beforeCorrect: corrected.revisions.at(-1).before.correctCount,
        id: raw.id
      };
    }, { fixture, div19 });
    assert.equal(seeded.correctedCorrect, 18);
    assert.equal(seeded.correctedRevision, 2);
    assert.equal(seeded.beforeCorrect, 19);
    checks.push('synthetic external data seeded; 19/30 corrected to 18/30 with before=19 audit');

    // Existing internal EssayStore reviews (7/10 and 9/10) are a separate source.
    // They must be preserved as read-only trend input, not merged semantically
    // with the external studyLog essay.
    await page.evaluate(async () => {
      const db = await ExamStore.open();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(['essayExams', 'essaySessions', 'essayReviews'], 'readwrite');
        tx.objectStore('essayExams').put({ id: 'p2-internal-essay', title: 'P2 合成内部申论', createdAt: Date.UTC(2026, 10, 2, 1), prompts: [] });
        tx.objectStore('essaySessions').put({ id: 'p2-internal-session', examId: 'p2-internal-essay', status: 'submitted', submittedAt: Date.UTC(2026, 10, 2, 2) });
        tx.objectStore('essayReviews').put({ id: 'work-r1', sessionId: 'p2-internal-session', examId: 'p2-internal-essay', source: 'gpt_json', overall: { totalScore: 7, maxScore: 10, summary: '内部首次' }, prompts: [], importedAt: Date.UTC(2026, 10, 2, 2) });
        tx.objectStore('essayReviews').put({ id: 'work-r2', sessionId: 'p2-internal-session', examId: 'p2-internal-essay', source: 'gpt_json', overall: { totalScore: 9, maxScore: 10, summary: '内部复评' }, prompts: [], importedAt: Date.UTC(2026, 10, 2, 3) });
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('essay seed aborted'));
      });
    });
    checks.push('synthetic internal essayReviews 7/10 and 9/10 seeded read-only');

    // v5/22: trends must remain readable, must not force a bank upgrade, and
    // must explicitly report the bank source as unavailable.
    await page.evaluate(async () => { await AppShell.navigate('diagnosis-trends'); });
    await waitTrend(page, 30);
    let text = await trendText(page);
    assert.match(text, /30\s*\/\s*48/);
    assert.match(text, /62\.5%/);
    assert.match(text, /综合/);
    assert.match(text, /15/);
    assert.match(text, /980/);
    assert.match(text, /无真实逐题样本/);
    assert.match(text, /7\s*\/\s*10/);
    assert.match(text, /9\s*\/\s*10/);
    assert.match(text, /内部评分/);
    assert.match(text, /work-r1/);
    assert.match(text, /work-r2/);
    assert.match(text, /首次 \/ 重复 \/ 未知/);
    assert.match(text, /全来源逐日趋势/);
    assert.match(text, /v5\/22|题库不可用|不会触发升级/);
    assert.match(text, /旧申论窗口样本/);
    assert.equal(await page.locator('#diagTrendDaily tbody tr').count(), 30, '30-day table includes every calendar day');
    const dbAfterV5Trend = await page.evaluate(async () => {
      const db = await ExamStore.open();
      return { version: db.version, stores: db.objectStoreNames.length };
    });
    assert.equal(dbAfterV5Trend.version, 5, 'opening trends on v5 must not upgrade the database');
    assert.equal(dbAfterV5Trend.stores, 22);
    const days30 = await page.evaluate(() => ({ from: document.querySelector('#diagTrendReport').getAttribute('data-from'), to: document.querySelector('#diagTrendReport').getAttribute('data-to') }));
    assert.deepEqual(days30, { from: '2026-10-05', to: '2026-11-03' });
    checks.push('v5/22 diagnosis-trends shows 30/48, 980s/no per-question, essay 7/9, comprehensive 15, bank unavailable; DB remains v5/22');

    // Real 7/14/30 switching: old 2026-10-20 essay is only in the 30-day window.
    await page.locator('#diagTrendDays').selectOption('14');
    await waitTrend(page, 14);
    text = await trendText(page);
    assert.match(text, /30\s*\/\s*48/);
    assert.doesNotMatch(text, /旧申论窗口样本/);
    assert.equal(await page.locator('#diagTrendDaily tbody tr').count(), 14);
    assert.deepEqual(await page.evaluate(() => ({ from: document.querySelector('#diagTrendReport').getAttribute('data-from'), to: document.querySelector('#diagTrendReport').getAttribute('data-to') })), { from: '2026-10-21', to: '2026-11-03' });
    await page.locator('#diagTrendDays').selectOption('7');
    await waitTrend(page, 7);
    text = await trendText(page);
    assert.doesNotMatch(text, /旧申论窗口样本/);
    assert.equal(await page.locator('#diagTrendDaily tbody tr').count(), 7);
    assert.deepEqual(await page.evaluate(() => ({ from: document.querySelector('#diagTrendReport').getAttribute('data-from'), to: document.querySelector('#diagTrendReport').getAttribute('data-to') })), { from: '2026-10-28', to: '2026-11-03' });
    await page.locator('#diagTrendDays').selectOption('30');
    await waitTrend(page, 30);
    assert.match(await trendText(page), /旧申论窗口样本/);
    checks.push('real 7/14/30 selector changes report window and excludes the 10/20 sample from 7/14 while keeping it in 30');

    // Real window geometry (not simulated Windows DPI): no horizontal overflow
    // and the selector stays visible at all four requested sizes.
    const geometries = [];
    for (const [width, height] of [[1000, 680], [1366, 768], [1920, 1080], [2560, 1440]]) {
      await c.app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setBounds(size), { width, height });
      await page.waitForTimeout(150);
      const geo = await page.evaluate(() => {
        const sel = document.querySelector('#diagTrendDays');
        const rect = sel && sel.getBoundingClientRect();
        return {
          docClient: document.documentElement.clientWidth, docScroll: document.documentElement.scrollWidth,
          bodyClient: document.body.clientWidth, bodyScroll: document.body.scrollWidth,
          selectVisible: !!rect && rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= window.innerWidth + 1
        };
      });
      assert.ok(geo.docScroll <= geo.docClient + 1, 'document horizontal overflow at ' + width + 'x' + height + ': ' + JSON.stringify(geo));
      assert.ok(geo.bodyScroll <= geo.bodyClient + 1, 'body horizontal overflow at ' + width + 'x' + height + ': ' + JSON.stringify(geo));
      assert.equal(geo.selectVisible, true, 'selector not visible at ' + width + 'x' + height);
      geometries.push(Object.assign({ width, height }, geo));
    }
    checks.push('four actual window sizes have no horizontal overflow and a visible trend selector (' + geometries.map(g => g.width + 'x' + g.height).join(', ') + ')');

    // Keyboard focus must survive the render caused by Home/arrow changes.
    await page.locator('#diagTrendDays').focus();
    await page.keyboard.press('Home');
    await waitTrend(page, 7);
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'diagTrendDays');
    await page.keyboard.press('ArrowDown');
    await waitTrend(page, 14);
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'diagTrendDays');
    await page.keyboard.press('ArrowDown');
    await waitTrend(page, 30);
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'diagTrendDays');
    checks.push('focus remains on #diagTrendDays through Home and two ArrowDown re-renders (7→14→30)');

    // LearningApp learn-feedback entry: same engine, 7/14/30 and explicit jump.
    await page.evaluate(async () => { await AppShell.navigate('learn-feedback'); await LearningApp.open('feedback'); });
    await page.waitForSelector('#learnFeedbackDays');
    await page.waitForFunction(() => {
      const host = document.querySelector('#learnTrendSummary');
      return host && host.getAttribute('data-days') && !/正在按只读快照计算/.test(host.textContent);
    });
    let learnText = await page.locator('#learnTrendSummary').textContent();
    assert.match(learnText, /专项新题/);
    assert.match(learnText, /30\s*\/\s*48/);
    assert.match(learnText, /980/);
    assert.match(learnText, /首次 \/ 重复 \/ 未知/);
    await page.locator('#learnFeedbackDays').selectOption('14');
    await waitLearnSummary(page, 14);
    learnText = await page.locator('#learnTrendSummary').textContent();
    assert.match(learnText, /30\s*\/\s*48/);
    await page.locator('#learnFeedbackDays').selectOption('30');
    await waitLearnSummary(page, 30);
    learnText = await page.locator('#learnTrendSummary').textContent();
    assert.match(learnText, /申论来源评分记录/);
    assert.match(learnText, /内部 2/);
    assert.match(learnText, /外部 3/);
    await page.locator('#learnFeedbackDays').focus();
    await page.keyboard.press('Home');
    await waitLearnSummary(page, 7);
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'learnFeedbackDays');
    await page.keyboard.press('ArrowDown');
    await waitLearnSummary(page, 14);
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'learnFeedbackDays');
    await page.keyboard.press('ArrowDown');
    await waitLearnSummary(page, 30);
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'learnFeedbackDays');
    checks.push('learn-feedback focus remains on #learnFeedbackDays through Home/ArrowDown (7→14→30)');
    await page.locator('#learnOpenTrend').click();
    await page.waitForSelector('#diagTrendReport');
    await waitTrend(page, 30);
    checks.push('learn-feedback 7/14/30 summary renders and opens the full diagnosis-trends page');

    // Leave the module before the explicit test-only v6 upgrade so the later
    // AppShell navigation necessarily rebuilds the report (navigate() is a
    // no-op when the requested module is already current).
    await page.evaluate(async () => { await AppShell.navigate('home'); });
    await page.waitForSelector('#homeView:not(.hidden)');

    // Explicit test-only v6 upgrade (never done by TrendEngine): then seed real
    // bankAttempts/practiceSets and an internal retest plus a D+1 task result.
    const migrated = await page.evaluate(async () => {
      window.confirm = () => true;
      const result = await BankMigration.upgrade();
      const db = await ExamStore.open();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(['practiceSets', 'bankAttempts', 'gradingRecords'], 'readwrite');
        tx.objectStore('practiceSets').put({
          id: 'ps-p2', ids: ['bq-p2'], mode: 'mock', status: 'completed', createdAt: Date.UTC(2026, 10, 2, 2),
          questions: [{ id: 'bq-p2', module: '资料分析', tags: ['增长率'], options: [{ key: 'A', text: '合成' }], answer: 'A', revision: 1 }],
          materials: [], assets: [], filters: {}, seed: 'p2', requested: 1, shortage: 0
        });
        tx.objectStore('bankAttempts').put({
          id: 'ba-p2a', sessionId: 'ba-p2a', practiceSetId: 'ps-p2', submittedAt: Date.UTC(2026, 10, 2, 2),
          results: [{ bankQuestionId: 'bq-p2', correct: true, elapsedMs: 12000, tags: ['增长率'] }], graded: 1, correct: 1
        });
        tx.objectStore('bankAttempts').put({
          id: 'ba-p2b', sessionId: 'ba-p2b', practiceSetId: 'ps-p2', submittedAt: Date.UTC(2026, 10, 2, 3),
          results: [{ bankQuestionId: 'bq-p2', correct: false, elapsedMs: 9000, tags: ['增长率'] }], graded: 1, correct: 0
        });
        tx.objectStore('gradingRecords').put({
          attemptId: 'att-p2-internal', sessionId: 's-p2-internal', examId: 'exam-p2', examName: 'P2 合成内部复测',
          gradedAt: Date.UTC(2026, 10, 2, 3), gradingStatus: 'graded', summary: { total: 3 }, config: { mode: 'retest' },
          details: [
            { question_id: 1, subject: '判断推理', grading_status: 'correct', is_correct: true, elapsed_seconds: 7 },
            { question_id: 2, subject: '判断推理', grading_status: 'correct', is_correct: true, elapsed_seconds: 8 },
            { question_id: 3, subject: '判断推理', grading_status: 'incorrect', is_correct: false, elapsed_seconds: 9 }
          ]
        });
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('seed aborted'));
      });
      await LearningStore.saveTask({
        title: 'D+1 原题复测（合成）', type: 'retest', taskType: 'retest', retestMode: 'original', retestInterval: 1,
        date: '2026-11-03', dueDate: '2026-11-03', status: 'completed', mastery: 'unverified',
        retestOrigin: { type: 'external', source: 'fenbi-synthetic', externalId: 'synthetic-20261102-pd', errorDate: '2026-11-02' },
        retestResults: [{ at: Date.UTC(2026, 10, 3, 2), date: '2026-11-03', dueDate: '2026-11-03', errorDate: '2026-11-02', mode: 'original', correctCount: 1, questionCount: 1, note: '合成实际完成' }]
      });
      const after = await ExamBackup.createBackup();
      return { result, version: after.dbVersion, stores: Object.keys(after.stores).length };
    });
    assert.equal(migrated.version, 6);
    assert.equal(migrated.stores, 28);
    checks.push('explicit test-only backup-gated v5/22 -> v6/28 upgrade completed; bank/internal/task data seeded');

    await page.evaluate(async () => { await AppShell.navigate('diagnosis-trends'); });
    await waitTrend(page, 30);
    text = await trendText(page);
    assert.match(text, /1\.1 题库\s*2\s*次/);
    assert.match(text, /bq-p2/);
    assert.match(text, /D\+1/);
    assert.match(text, /原题/);
    assert.match(text, /2026-11-03/);
    assert.match(text, /真实逐题样本/);
    assert.match(text, /首次作答/);
    assert.match(text, /重复作答/);
    const engineReport = await page.evaluate(async () => {
      const r = await TrendEngine.load({ days: 30, now: Date.UTC(2026, 10, 3, 2) });
      return {
        bankAvailable: r.sources.bank.available,
        bankActivities: r.sources.bank.activities,
        bankIds: r.perQuestionTime.exact.filter(x => x.source === 'bank').map(x => x.bankQuestionId),
        internalExact: r.perQuestionTime.exact.filter(x => x.source === 'software').length,
        firstQuestions: r.sample.firstQuestions,
        repeatQuestions: r.sample.repeatQuestions,
        internalEssays: r.sources.essays.internalReviews,
        essayScores: r.sample.essayScores,
        crossSourceUncertain: r.sources.essays.crossSourceUncertain,
        dailyDays: r.daily.length,
        retestResults: r.retest.results.length,
        retestDate: r.retest.results[0] && r.retest.results[0].date,
        dbVersion: (await ExamStore.open()).version
      };
    });
    assert.equal(engineReport.bankAvailable, true);
    assert.equal(engineReport.bankActivities, 2);
    assert.deepEqual(engineReport.bankIds, ['bq-p2', 'bq-p2']);
    assert.equal(engineReport.internalExact, 3);
    assert.equal(engineReport.firstQuestions, 4);
    assert.equal(engineReport.repeatQuestions, 1);
    assert.equal(engineReport.internalEssays, 2);
    assert.equal(engineReport.essayScores, 5);
    assert.equal(engineReport.crossSourceUncertain, true);
    assert.equal(engineReport.dailyDays, 30);
    assert.equal(engineReport.retestResults, 1);
    assert.equal(engineReport.retestDate, '2026-11-03');
    assert.equal(engineReport.dbVersion, 6);
    checks.push('v6 trends reads bankAttempts by bankQuestionId with first/repeat, internal exact times, internal essays and D+1 actual result');

    await page.screenshot({ path: screenshotPath });
    assert.equal(pageErrors.length, 0, 'renderer page errors: ' + pageErrors.join(' | '));
    writeReport({
      status: 'pass',
      profile: c.profile,
      checks,
      stats: { objective: '30/48=62.5%', comprehensive: '15 unknown separately', time: '980s total / 0 per-question before v6', essay: ['7/10', '9/10'] },
      db: { before: { version: 5, stores: 22 }, after: { version: 6, stores: 28 } },
      pageExceptions: pageErrors.length,
      screenshot: 'reports/p2-trends-ui.png',
      preservedWorkReports: 'reports/p1-*.json/png were not opened or written'
    });
    console.log('PASS P2 WP09 Electron UI:', checks.length, 'checks');
  } catch (e) {
    writeReport({
      status: 'fail',
      profile: c && c.profile,
      checks,
      pageExceptions: pageErrors,
      error: String(e && e.stack || e),
      preservedWorkReports: 'reports/p1-*.json/png were not opened or written'
    });
    throw e;
  } finally {
    if (c) await c.app.close().catch(() => {});
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
