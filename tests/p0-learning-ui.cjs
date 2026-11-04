/* SPDX-License-Identifier: Apache-2.0 */
/* 1.2.0 P0 isolated Electron/Playwright acceptance.
   Uses the existing tests/launch.cjs (never --no-sandbox) and a fresh temporary
   profile. SKIP is reserved for a host sandbox that cannot spawn Electron at all;
   missing files, bad data, failed assertions and page exceptions are FAIL. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { launch } = require('./launch.cjs');

const root = path.resolve(__dirname, '..');
const reportPath = path.join(root, 'reports/p0-learning-ui.json');
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/external-practice-2026-11-02.json'));
const fixture19 = fs.readFileSync(path.join(__dirname, 'fixtures/external-practice-2026-11-02-div19.json'));
const planFile = path.join(root, 'docs/plan-2026-11-03-synthetic.json');

function writeReport(data) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(data, null, 2));
}
async function waitModal(page) {
  await page.waitForSelector('#learnModalRoot .learn-modal');
  await page.waitForFunction(() => !!document.querySelector('#learnModalRoot [data-ok]'));
}
async function waitModalGone(page) {
  await page.waitForFunction(() => !document.querySelector('#learnModalRoot [data-ok]'));
  await page.waitForFunction(() => !document.querySelector('#learnModalRoot .learn-mask'));
}
async function modalText(page) {
  return page.evaluate(() => (document.querySelector('#learnModalRoot') || {}).textContent || '');
}
async function clickOk(page) {
  await page.locator('#learnModalRoot [data-ok]').click();
}
async function clickCancel(page) {
  await page.locator('#learnModalRoot [data-cancel]').click();
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
      // Only the documented host-sandbox spawn/mojo denial is a SKIP. Missing
      // Playwright, a bad profile, or a test assertion must remain a FAIL.
      if (/spawn EPERM|platform_channel|Electron CDP did not become ready|拒绝访问/i.test(detail)) {
        writeReport({
          status: 'skip',
          reason: 'DSH host sandbox blocks spawning Electron/Chromium (spawn EPERM / platform-channel denied). No isolated UI process was created. Run this same test in a normal-permission Windows session.',
          error: detail.split('\n').slice(0, 8).join('\n'),
          profile: null,
          checks: []
        });
        console.log('SKIP Electron UI blocked by host sandbox:', detail.split('\n')[0]);
        return;
      }
      writeReport({ status: 'fail', phase: 'launch', error: detail });
      throw e;
    }
    const { page } = c;
    page.setDefaultTimeout(10000);
    page.on('pageerror', e => pageErrors.push(String(e)));
    await page.waitForSelector('[data-nav="home"]');
    const profileInfo = await c.app.evaluate(({ app }) => ({ userData: app.getPath('userData'), sandbox: app.commandLine.hasSwitch('no-sandbox') }));
    assert.equal(path.resolve(profileInfo.userData), path.resolve(c.profile), 'must use the isolated temporary profile');
    assert.equal(profileInfo.sandbox, false, 'tests must not use --no-sandbox');
    checks.push('isolated temporary userData=' + c.profile + '; sandbox=false');

    // Upgrade the isolated fresh v5 database through the existing backup-gated
    // v6 migration so the 28-table backup/restore check is meaningful.
    const migrated = await page.evaluate(async () => {
      window.confirm = () => true;
      const before = await ExamBackup.createBackup();
      const result = await BankMigration.upgrade();
      const after = await ExamBackup.createBackup();
      return {
        beforeVersion: before.dbVersion,
        beforeStores: Object.keys(before.stores).length,
        afterVersion: after.dbVersion,
        afterStores: after.stores ? Object.keys(after.stores).length : null,
        result
      };
    });
    assert.equal(migrated.beforeVersion, 5);
    assert.equal(migrated.beforeStores, 22);
    assert.equal(migrated.afterVersion, 6);
    assert.equal(migrated.afterStores, 28);
    checks.push('backup-gated v5/22 -> v6/28 migration completed on isolated profile');

    // Seed an immutable internal attempt. External-study imports must never
    // touch attempts, questionIds or gradingRecords.
    await page.evaluate(async () => {
      const db = await ExamStore.open();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('attempts', 'readwrite');
        tx.objectStore('attempts').put({ sessionId: 'p0-internal-attempt', examId: 'p0-synthetic-exam', date: '2026-11-02', summary: { questions: 10, correct: 7 } });
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('attempt seed aborted'));
      });
    });
    const attemptBefore = await page.evaluate(async () => JSON.stringify((await DiagnosisStore.getAllAttemptsLegacy()).find(x => x.sessionId === 'p0-internal-attempt')));

    // --- WP01: plan import, duplicate import, completed actual protection ---
    await page.evaluate(async () => { await AppShell.navigate('learn-plans'); await LearningApp.open('plans'); });
    await page.waitForSelector('#learnPlanFile', { state: 'attached' });
    await page.setInputFiles('#learnPlanFile', planFile);
    await waitModal(page);
    assert.match(await modalText(page), /合成代表计划/);
    assert.match(await modalText(page), /新增\s*4/);
    await clickOk(page);
    await waitModalGone(page);
    let planCount = await page.evaluate(() => LearningStore.listTasks().then(xs => xs.filter(x => x.planId === 'synthetic-20261103-study').length));
    assert.equal(planCount, 4);
    checks.push('synthetic plan imported: 4 tasks');

    await page.evaluate(async () => { await AppShell.navigate('learn-plans'); await LearningApp.open('plans'); });
    await page.waitForSelector('#learnPlanFile', { state: 'attached' });
    await page.setInputFiles('#learnPlanFile', planFile);
    await waitModal(page);
    assert.match(await modalText(page), /未变化\s*4/);
    await clickOk(page);
    await waitModalGone(page);
    planCount = await page.evaluate(() => LearningStore.listTasks().then(xs => xs.filter(x => x.planId === 'synthetic-20261103-study').length));
    assert.equal(planCount, 4);
    checks.push('duplicate plan import creates no duplicate tasks');

    await page.evaluate(async () => {
      const ts = await LearningStore.listTasks();
      const t = ts.find(x => x.planTaskId === 'synthetic-20261103-zl');
      t.status = 'completed'; t.actualMinutes = 60; t.actualQuestions = 20; t.actualCorrect = 15; t.actualSource = 'manual';
      await LearningStore.saveTask(t);
    });
    await page.evaluate(async () => { await AppShell.navigate('learn-plans'); await LearningApp.open('plans'); });
    await page.waitForSelector('#learnPlanFile', { state: 'attached' });
    await page.waitForFunction(() => document.getElementById('learnBody').textContent.includes('已完成任务（1）'));
    await page.setInputFiles('#learnPlanFile', planFile);
    await waitModal(page);
    assert.match(await modalText(page), /已完成，跳过更新/);
    await clickOk(page);
    await waitModalGone(page);
    const protectedTask = await page.evaluate(async () => {
      const t = (await LearningStore.listTasks()).find(x => x.planTaskId === 'synthetic-20261103-zl');
      return { status: t.status, actualMinutes: t.actualMinutes, actualQuestions: t.actualQuestions, actualCorrect: t.actualCorrect };
    });
    assert.deepEqual(JSON.parse(JSON.stringify(protectedTask)), { status: 'completed', actualMinutes: 60, actualQuestions: 20, actualCorrect: 15 });
    checks.push('completed task actuals survive plan re-import');

    // Invalid plan field returns a visible path and writes nothing.
    const invalidPlan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
    invalidPlan.plan_id = 'synthetic-invalid-p0';
    invalidPlan.mystery = true;
    invalidPlan.tasks[0].priority = 'urgent';
    await page.evaluate(async () => { await AppShell.navigate('learn-plans'); await LearningApp.open('plans'); });
    await page.waitForSelector('#learnPlanFile', { state: 'attached' });
    await page.setInputFiles('#learnPlanFile', { name: 'invalid-plan.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invalidPlan)) });
    await page.waitForSelector('#learnModalRoot .learn-modal');
    await page.waitForFunction(() => /plan\.mystery/.test(document.querySelector('#learnModalRoot').textContent));
    const invalidText = await modalText(page);
    assert.match(invalidText, /plan\.mystery/);
    assert.match(invalidText, /tasks\[0\]\.priority/);
    await clickCancel(page);
    await page.waitForFunction(() => !document.querySelector('#learnModalRoot .learn-mask'));
    const invalidCount = await page.evaluate(() => LearningStore.listTasks().then(xs => xs.filter(x => x.planId === 'synthetic-invalid-p0').length));
    assert.equal(invalidCount, 0);
    checks.push('unknown plan fields/invalid priority show paths and write zero tasks');

    // --- WP02/WP03/WP05: external 19/30 -> 18/30, batch preview, statistics ---
    await page.evaluate(async () => { await AppShell.navigate('learn-records'); await LearningApp.open('records'); });
    await page.waitForSelector('#learnExternalFile', { state: 'attached' });
    await page.setInputFiles('#learnExternalFile', { name: 'external-practice-19.json', mimeType: 'application/json', buffer: fixture19 });
    await waitModal(page);
    assert.match(await modalText(page), /新增\s*1/);
    await clickOk(page);
    await waitModalGone(page);
    await page.waitForFunction(() => document.querySelectorAll('[data-log-row]').length === 1);
    const originalId = await page.evaluate(async () => (await DiagnosisStore.listStudyLogs())[0].id);

    await page.locator('[data-log-edit]').first().click();
    await page.waitForSelector('#learnLogCorrect');
    await page.locator('#learnLogCorrect').fill('18');
    await page.locator('#learnLogContent').fill('三位数除法训练（合成验收：18/30，980 秒）');
    await page.locator('#learnLogDurationValue').fill('980');
    await page.locator('#learnLogDurationUnit').selectOption('seconds');
    await page.locator('#learnLogPrecision').selectOption('exact');
    await page.locator('#learnLogGroups').fill(JSON.stringify([
      { label: '第一组', questionCount: 10, correctCount: 7, durationSeconds: 235 },
      { label: '第二组', questionCount: 10, correctCount: 6, durationSeconds: 389 },
      { label: '第三组', questionCount: 10, correctCount: 5, durationSeconds: 356 }
    ], null, 2));
    await page.locator('#learnLogReason').fill('历史 19/30 更正为 18/30');
    await clickOk(page);
    await waitModalGone(page);
    await page.waitForFunction(() => document.querySelector('[data-log-row]') && document.querySelector('[data-log-row]').textContent.includes('18/30'));
    const corrected = await page.evaluate(async () => {
      const logs = await DiagnosisStore.listStudyLogs();
      const x = logs[0];
      return {
        id: x.id, count: logs.length, correct: x.correctCount, seconds: x.durationSeconds,
        revision: x.revision, revisions: x.revisions.length,
        before: x.revisions.at(-1).before.correctCount, after: x.revisions.at(-1).after.correctCount,
        reason: x.revisions.at(-1).reason, groups: x.groups.length
      };
    });
    assert.equal(corrected.id, originalId, 'correction keeps the original record id');
    assert.equal(corrected.count, 1, 'correction must not insert a duplicate row');
    assert.equal(corrected.correct, 18);
    assert.equal(corrected.seconds, 980);
    assert.equal(corrected.revision, 2);
    assert.equal(corrected.revisions, 2);
    assert.equal(corrected.before, 19);
    assert.equal(corrected.after, 18);
    assert.match(corrected.reason, /19\/30/);
    assert.equal(corrected.groups, 3);
    checks.push('19/30 corrected in place to 18/30 with stable id, 980s, groups and before/after audit');

    await page.setInputFiles('#learnExternalFile', { name: 'external-practice-final.json', mimeType: 'application/json', buffer: fixture });
    await waitModal(page);
    assert.match(await modalText(page), /新增\s*5/);
    await clickOk(page);
    await waitModalGone(page);
    await page.waitForFunction(() => document.querySelectorAll('[data-log-row]').length === 6);
    const statsText = await page.locator('#learnBody').textContent();
    assert.match(statsText, /30\/48/);
    assert.match(statsText, /62\.5%/);
    assert.match(statsText, /错 18/);
    assert.match(statsText, /15 题 · 正确未知/);
    assert.match(statsText, /首次 7\/10/);
    assert.match(statsText, /复评 9\/10/);
    assert.doesNotMatch(statsText, /9 题/);
    checks.push('objective 30/48=62.5% with incorrect=18; comprehensive 15 separate; essay 7/10 and 9/10 visible and not converted to 9 questions');

    await page.setInputFiles('#learnExternalFile', { name: 'external-practice-final.json', mimeType: 'application/json', buffer: fixture });
    await waitModal(page);
    assert.match(await modalText(page), /重复/);
    assert.equal(await page.locator('#learnModalRoot [data-ok]').isDisabled(), true);
    await clickCancel(page);
    await waitModalGone(page);
    checks.push('repeat external import is detected as duplicate and cannot be confirmed');

    await page.locator('[data-log-row]').filter({ hasText: '判断推理专项' }).first().locator('[data-log-wrong]').click();
    await page.waitForSelector('#learnModalRoot .learn-modal');
    const wrongText = await modalText(page);
    assert.match(wrongText, /削弱论证/);
    assert.match(wrongText, /逻辑方向/);
    assert.match(wrongText, /P→Q/);
    await clickCancel(page);
    await waitModalGone(page);
    checks.push('external wrong-question source, causes, logic symbols and method are visible');

    // --- WP02: manual add/edit/delete, batch add, stale edit and fault injection ---
    await page.locator('#learnNewLog').click();
    await page.waitForSelector('#learnLogContent');
    await page.locator('#learnLogContent').fill('手动验收记录');
    await page.locator('#learnLogDate').fill('2026-11-02');
    await page.locator('#learnLogQuestions').fill('2');
    await page.locator('#learnLogCorrect').fill('1');
    await page.locator('#learnLogDurationValue').fill('90');
    await page.locator('#learnLogDurationUnit').selectOption('seconds');
    await page.locator('#learnLogPrecision').selectOption('exact');
    await clickOk(page);
    await waitModalGone(page);
    await page.waitForFunction(() => [...document.querySelectorAll('[data-log-row]')].some(r => r.textContent.includes('手动验收记录')));
    const manualRow = page.locator('[data-log-row]').filter({ hasText: '手动验收记录' }).first();
    await manualRow.locator('[data-log-edit]').click();
    await page.waitForSelector('#learnLogCorrect');
    await page.locator('#learnLogCorrect').fill('2');
    await page.locator('#learnLogReason').fill('手动记录更正');
    await clickOk(page);
    await waitModalGone(page);
    const manual = await page.evaluate(async () => {
      const x = (await DiagnosisStore.listStudyLogs()).find(x => x.content === '手动验收记录');
      return { id: x.id, correct: x.correctCount, revision: x.revision, revisions: x.revisions.length, before: x.revisions.at(-1).before.correctCount, after: x.revisions.at(-1).after.correctCount };
    });
    assert.equal(manual.correct, 2);
    assert.equal(manual.revision, 2);
    assert.equal(manual.revisions, 2);
    assert.equal(manual.before, 1);
    assert.equal(manual.after, 2);

    const stale = await page.evaluate(async (args) => {
      try {
        await DiagnosisStore.updateStudyLog(args.id, { correctCount: 1 }, { reason: '过期编辑', expectedRevision: args.revision - 1 });
        return { ok: true };
      } catch (e) { return { ok: false, code: e.code, message: e.message }; }
    }, { id: manual.id, revision: manual.revision });
    assert.equal(stale.ok, false);
    assert.equal(stale.code, 'STUDY_LOG_CONFLICT');
    assert.match(stale.message, /刷新/);
    const afterStale = await page.evaluate(async id => (await DiagnosisStore.getStudyLog(id)).correctCount, manual.id);
    assert.equal(afterStale, 2, 'stale edit must not change the newer record');

    // Batch manual add.
    const beforeBatch = await page.evaluate(async () => (await DiagnosisStore.listStudyLogs()).length);
    await page.locator('#learnBatchLog').click();
    await page.waitForSelector('#learnBatchText');
    await clickOk(page);
    await waitModalGone(page);
    const afterBatch = await page.evaluate(async () => (await DiagnosisStore.listStudyLogs()).length);
    assert.equal(afterBatch, beforeBatch + 2);
    checks.push('manual add/edit audit, stale-edit rejection and batch add work');

    // Delete confirmation is required and soft-delete keeps the audit trail.
    await page.locator('[data-log-row]').filter({ hasText: '手动验收记录' }).first().locator('[data-log-delete]').click();
    await page.waitForSelector('#learnDeleteReason');
    await page.locator('#learnDeleteReason').fill('测试删除原因');
    await clickOk(page);
    await waitModalGone(page);
    await page.waitForFunction(() => ![...document.querySelectorAll('[data-log-row]')].some(r => r.textContent.includes('手动验收记录')));
    const deleted = await page.evaluate(async id => {
      const x = await DiagnosisStore.getStudyLog(id);
      return { status: x.status, deletedAt: x.deletedAt, revisions: x.revisions.length, action: x.revisions.at(-1).action, reason: x.revisions.at(-1).reason };
    }, manual.id);
    assert.equal(deleted.status, 'deleted');
    assert.ok(deleted.deletedAt);
    assert.equal(deleted.revisions, 3);
    assert.equal(deleted.action, 'delete');
    assert.equal(deleted.reason, '测试删除原因');
    checks.push('delete requires confirmation and is soft with audit history retained');

    // Inject an IndexedDB put failure during a two-row batch: no partial rows.
    const batchFailure = await page.evaluate(async () => {
      const before = (await DiagnosisStore.listStudyLogs()).length;
      const original = IDBObjectStore.prototype.put;
      let n = 0;
      IDBObjectStore.prototype.put = function (v) { n++; if (n === 2) throw new Error('injected batch failure'); return original.call(this, v); };
      let error = null;
      try {
        await DiagnosisStore.saveStudyLogs([
          { date: '2026-11-02', content: '事务失败一', durationPrecision: 'unknown' },
          { date: '2026-11-02', content: '事务失败二', durationPrecision: 'unknown' }
        ], { reason: '故障注入' });
      } catch (e) { error = e.message; } finally { IDBObjectStore.prototype.put = original; }
      const rows = await DiagnosisStore.listStudyLogs();
      return { before, after: rows.length, error, partial: rows.some(x => x.content === '事务失败一' || x.content === '事务失败二') };
    });
    assert.equal(batchFailure.after, batchFailure.before);
    assert.equal(batchFailure.partial, false);
    assert.match(batchFailure.error, /failure/);

    // Inject an audit/put failure during a single edit: content and audit stay unchanged.
    const auditFailure = await page.evaluate(async id => {
      const log = await DiagnosisStore.getStudyLog(id);
      const before = JSON.stringify(log.revisions);
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function () { throw new Error('injected audit failure'); };
      let error = null;
      try {
        await DiagnosisStore.updateStudyLog(id, { note: '合法更改用于写入故障注入' }, { reason: '不得写入', expectedRevision: log.revision });
      } catch (e) { error = e.message; } finally { IDBObjectStore.prototype.put = original; }
      const after = await DiagnosisStore.getStudyLog(id);
      return { error, beforeRevision: log.revision, afterRevision: after.revision, sameAudit: before === JSON.stringify(after.revisions), correct: after.correctCount };
    }, originalId);
    assert.match(auditFailure.error, /failure/);
    assert.equal(auditFailure.sameAudit, true);
    assert.equal(auditFailure.beforeRevision, auditFailure.afterRevision);
    assert.equal(auditFailure.correct, 18);
    checks.push('batch and single-edit IndexedDB fault injection leave zero partial rows and no partial audit');

    const attemptAfter = await page.evaluate(async () => JSON.stringify((await DiagnosisStore.getAllAttemptsLegacy()).find(x => x.sessionId === 'p0-internal-attempt')));
    assert.equal(attemptAfter, attemptBefore, 'external-study imports must not modify internal attempts');
    checks.push('internal attempt is byte-for-byte unchanged after external-study imports/edits');

    // Same-day software session deduplication (second task must not copy it).
    const dedupe = await page.evaluate(() => {
      const engine = { attempts: [
        { id: 'a1', date: '2026-11-02', record: { sessionId: 's1' }, details: [{ status: 'correct', elapsed: 60 }] },
        { id: 'a2', date: '2026-11-02', record: { sessionId: 's2' }, details: [{ status: 'incorrect', elapsed: 30 }] }
      ] };
      const first = LearningEngine.softwareForDate(engine, '2026-11-02');
      const second = LearningEngine.softwareForDate(engine, '2026-11-02', first.sessionIds);
      return { firstQ: first.questions, secondQ: second.questions, secondExcluded: second.excluded };
    });
    assert.equal(dedupe.firstQ, 2);
    assert.equal(dedupe.secondQ, 0);
    assert.equal(dedupe.secondExcluded, 2);
    checks.push('second same-day task excludes sessions already consumed by the first task');

    // --- Essay result: hasScore scope + all retained reviews visible, no 9-question conversion ---
    await page.evaluate(async () => {
      const exam = {
        id: 'p0-essay', title: 'P0 申论评分历史（合成）', year: '2026',
        prompts: [{ id: 'p0-essay-p1', number: 1, type: 'summary', score: 10 }]
      };
      await EssayStore.saveExam(exam, new Blob(['%PDF-1.4 synthetic'], { type: 'application/pdf' }), 1);
      await EssayStore.putSession({ id: 'p0-essay-session', examId: 'p0-essay', status: 'submitted', submittedAt: Date.now(), drafts: { 'p0-essay-p1': { text: '合成申论作答' } } });
      await EssayStore.saveReview({
        id: 'p0-review-first', examId: 'p0-essay', sessionId: 'p0-essay-session', importedAt: 1000,
        overall: { totalScore: 7, maxScore: 10, summary: '首次评分' },
        prompts: [{ promptId: 'p0-essay-p1', number: 1, score: 7, maxScore: 10, comments: '首次' }]
      });
      await EssayStore.saveReview({
        id: 'p0-review-second', examId: 'p0-essay', sessionId: 'p0-essay-session', importedAt: 2000,
        overall: { totalScore: 9, maxScore: 10, summary: '复评' },
        prompts: [{ promptId: 'p0-essay-p1', number: 1, score: 9, maxScore: 10, comments: '复评' }]
      });
    });
    await page.evaluate(() => EssayApp.open());
    await page.waitForSelector('[data-act="result"]');
    await page.locator('[data-act="result"]').click();
    await page.waitForSelector('#essayResultView:not(.hidden)');
    const essayText = await page.locator('#essayReviews').textContent();
    assert.match(essayText, /首次评分/);
    assert.match(essayText, /复评/);
    assert.match(essayText, /7\s*\/\s*10/);
    assert.match(essayText, /9\s*\/\s*10/);
    const resultStats = await page.locator('#essayResultStats').textContent();
    assert.match(resultStats, /总分/);
    assert.match(resultStats, /10/);
    assert.doesNotMatch(resultStats, /9 题/);
    assert.equal(pageErrors.length, 0, 'no renderer page errors: ' + pageErrors.join(' | '));
    await page.evaluate(() => EssayApp.close());
    checks.push('essay result renders hasScore and both 7/10 and 9/10 reviews without converting 9 to 9 questions');

    // --- 28-table backup/restore retains the new studyLog fields ---
    const backupResult = await page.evaluate(async () => {
      const beforeLogs = await DiagnosisStore.listStudyLogs();
      const division = beforeLogs.find(x => x.externalId === 'synthetic-20261102-cf');
      const manual = beforeLogs.find(x => x.content === '手动验收记录');
      const backup = await ExamBackup.createBackup();
      const studyRows = backup.stores.studyLogs;
      const divisionSerialized = studyRows.find(x => x.id === division.id);
      // Remove a row after the backup, then restore and prove the row and all
      // new fields come back from the 28-table snapshot.
      await new Promise((resolve, reject) => {
        const dbPromise = ExamStore.open();
        dbPromise.then(db => {
          const tx = db.transaction('studyLogs', 'readwrite');
          tx.objectStore('studyLogs').delete(division.id);
          tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('delete aborted'));
        }).catch(reject);
      });
      const missingAfterDelete = !(await DiagnosisStore.getStudyLog(division.id));
      await ExamBackup.restoreBackup(backup);
      const restored = await DiagnosisStore.getStudyLog(division.id);
      const manualRestored = manual ? await DiagnosisStore.getStudyLog(manual.id) : null;
      return {
        stores: Object.keys(backup.stores).length,
        dbVersion: backup.dbVersion,
        studyCount: studyRows.length,
        serializedHasGroups: Array.isArray(divisionSerialized.groups) && divisionSerialized.groups.length === 3,
        serializedHasWrongs: Array.isArray(divisionSerialized.wrongQuestions),
        serializedHasAudit: Array.isArray(divisionSerialized.revisions) && divisionSerialized.revisions.length >= 1,
        serializedHasEssay: studyRows.some(x => Array.isArray(x.essayScores) && x.essayScores.length === 2),
        missingAfterDelete,
        restored: !!restored,
        restoredCorrect: restored && restored.correctCount,
        restoredSeconds: restored && restored.durationSeconds,
        restoredGroups: restored && restored.groups.length,
        restoredRevisions: restored && restored.revisions.length,
        manualRestored: !!manualRestored,
        manualStatus: manualRestored && manualRestored.status
      };
    });
    assert.equal(backupResult.dbVersion, 6);
    assert.equal(backupResult.stores, 28);
    assert.ok(backupResult.studyCount >= 7);
    assert.equal(backupResult.serializedHasGroups, true);
    assert.equal(backupResult.serializedHasWrongs, true);
    assert.equal(backupResult.serializedHasAudit, true);
    assert.equal(backupResult.serializedHasEssay, true);
    assert.equal(backupResult.missingAfterDelete, true);
    assert.equal(backupResult.restored, true);
    assert.equal(backupResult.restoredCorrect, 18);
    assert.equal(backupResult.restoredSeconds, 980);
    assert.equal(backupResult.restoredGroups, 3);
    assert.equal(backupResult.restoredRevisions, 2);
    assert.equal(backupResult.manualRestored, true);
    assert.equal(backupResult.manualStatus, 'deleted', 'restore includes the soft-deleted audit row from the snapshot');
    checks.push('28-table backup/restore retains groups, wrong questions, audits, essay scores and deleted rows');

    await page.screenshot({ path: path.join(root, 'reports/p0-learning-ui.png') });
    assert.equal(pageErrors.length, 0, 'renderer page errors: ' + pageErrors.join(' | '));
    writeReport({
      status: 'pass',
      profile: c.profile,
      checks,
      stats: { objective: '30/48=62.5%', incorrect: 18, comprehensive: '15 separate', essay: ['7/10', '9/10'] },
      db: { version: 6, stores: 28 },
      pageExceptions: pageErrors.length,
      screenshot: 'reports/p0-learning-ui.png'
    });
    console.log('PASS P0 learning Electron UI:', checks.length, 'checks');
  } catch (e) {
    writeReport({
      status: 'fail',
      profile: c && c.profile,
      checks,
      pageExceptions: pageErrors,
      error: String(e && e.stack || e)
    });
    throw e;
  } finally {
    if (c) await c.app.close().catch(() => {});
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
