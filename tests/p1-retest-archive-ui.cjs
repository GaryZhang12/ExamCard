/* SPDX-License-Identifier: Apache-2.0 */
/* P1 WP06 retest UI + WP07 review-PDF archive UI. Isolated Playwright Electron
   profile. Uses only the repository fixture PDF; the real user report is not
   copied or committed. Work runs this in a normal-permission session. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { launch } = require('./launch.cjs');

const root = path.resolve(__dirname, '..');
const reportPath = path.join(root, 'reports/p1-retest-archive-ui.json');
const fixturePdf = path.join(__dirname, 'fixtures/original20.pdf');
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function writeReport(data) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(data, null, 2));
}
async function waitModal(page) {
  await page.waitForSelector('#learnModalRoot .learn-modal');
}
async function waitModalGone(page) {
  await page.waitForFunction(() => !document.querySelector('#learnModalRoot .learn-mask'));
}
async function openLearning(page, route, tab) {
  await page.evaluate(async ({ route, tab }) => { await AppShell.navigate(route); await LearningApp.open(tab); }, { route, tab });
}

(async () => {
  let c = null;
  const checks = [];
  const beforePdfHash = sha256File(fixturePdf);
  try {
    try { c = await launch(); } catch (e) {
      const detail = String(e && e.stack || e);
      if (/spawn EPERM|platform_channel|拒绝访问/i.test(detail)) {
        writeReport({ status: 'skip', reason: 'DSH host sandbox blocks spawning Electron (spawn EPERM); no isolated UI process was created. Work must run this in a normal-permission session.', error: detail.split('\n').slice(0, 8).join('\n'), checks: [] });
        console.log('SKIP P1 Electron UI blocked by host sandbox');
        return;
      }
      writeReport({ status: 'fail', phase: 'launch', error: detail, checks });
      throw e;
    }
    const { page } = c;
    page.setDefaultTimeout(10000);
    // A fresh profile starts at the supported v5/22 layout. Use the existing
    // full-backup gate (BankMigration.upgrade) to reach v6/28; never force a
    // migration or change DB_VERSION just to satisfy the archive assertions.
    const beforeUpgrade = await page.evaluate(async () => {
      const db = await ExamStore.open();
      return { version: db.version, stores: db.objectStoreNames.length };
    });
    assert.equal(beforeUpgrade.version, 5);
    assert.equal(beforeUpgrade.stores, 22);

    // The archive lives in the existing meta store, so the legacy v5/22 backup
    // must already include its index and Blob. Verify that before upgrading.
    const v5Archive = await page.evaluate(async bytes => {
      const added = await ReviewArchive.add({
        name: 'v5-compat.pdf', size: bytes.length,
        arrayBuffer: async () => new Uint8Array(bytes).buffer
      }, { title: '2026-10-30 v5 兼容归档', date: '2026-10-30', knowledgePoints: ['v5兼容'] });
      const backup = await ExamBackup.createBackup();
      const index = (backup.stores.meta || []).find(x => x.key === 'reviewReportsIndex');
      const record = (backup.stores.meta || []).find(x => x.key === 'reviewReport:' + added.id);
      await ReviewArchive.remove(added.id);
      const missing = !(await ReviewArchive.get(added.id));
      await ExamBackup.restoreBackup(backup);
      const restored = await ReviewArchive.get(added.id);
      return {
        id: added.id, stores: Object.keys(backup.stores).length,
        hasIndex: !!index, hasRecord: !!record, missing,
        restored: !!restored, blobSize: restored && restored.value.blob.size,
        sha256: restored && restored.value.sha256
      };
    }, [...fs.readFileSync(fixturePdf)]);
    assert.equal(v5Archive.stores, 22);
    assert.equal(v5Archive.hasIndex, true);
    assert.equal(v5Archive.hasRecord, true);
    assert.equal(v5Archive.missing, true);
    assert.equal(v5Archive.restored, true);
    assert.ok(v5Archive.blobSize > 0);
    assert.equal(v5Archive.sha256, crypto.createHash('sha256').update(fs.readFileSync(fixturePdf)).digest('hex'));
    checks.push('legacy v5/22 backup already contains review archive index and Blob');

    await page.evaluate(async () => { window.confirm = () => true; await BankMigration.upgrade(); });
    const afterUpgrade = await page.evaluate(async () => {
      const db = await ExamStore.open();
      return { version: db.version, stores: db.objectStoreNames.length };
    });
    assert.equal(afterUpgrade.version, 6);
    assert.equal(afterUpgrade.stores, 28);

    // Seed one external wrong answer dated 2026-11-02. The original error is
    // deliberately a tuple identity with separators.
    await page.evaluate(async () => {
      const rec = StudyLog.assertValid({
        kind: 'external', source: 'fenbi::p1', externalId: 'practice::1', date: '2026-11-02',
        assessment: 'objective', practiceType: 'new', content: 'P1 复测源（合成）',
        module: '判断推理', knowledgePoint: '削弱论证', questionCount: 6, correctCount: 3,
        durationPrecision: 'unknown', durationUnit: 'seconds',
        wrongQuestions: [{
          questionNo: '3::4', questionType: 'single', knowledgePoint: '削弱论证',
          primaryCause: '逻辑方向错误', secondaryCauses: ['方法选择错误'],
          method: '先写论点与论据，再判断削弱方向', logicSymbols: 'P→Q', reasoning: 'P1 合成推理',
          retestHistory: []
        }]
      });
      await DiagnosisStore.saveStudyLogs([rec], { reason: 'P1 WP06 seed' });
    });

    // WP06 generation, idempotence, real error-date intervals.
    await openLearning(page, 'learn-plans', 'plans');
    await page.waitForSelector('#learnGenerateRetests');
    await page.locator('#learnGenerateRetests').click();
    await page.waitForFunction(() => LearningStore.listTasks().then(xs => xs.filter(x => x.reviewKey && x.reviewKey.indexOf('retest-v1:') === 0).length === 3));
    const retests = await page.evaluate(async () => (await LearningStore.listTasks()).filter(x => x.reviewKey && x.reviewKey.indexOf('retest-v1:') === 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map(x => ({
      id: x.id, dueDate: x.dueDate, date: x.date, status: x.status, mastery: x.mastery,
      mode: x.retestMode, interval: x.retestInterval, origin: x.retestOrigin, history: x.retestHistory, results: x.retestResults
    })));
    assert.deepEqual(retests.map(x => x.dueDate), ['2026-11-03', '2026-11-05', '2026-11-09']);
    assert.ok(retests.every(x => x.status === 'pending' && x.mastery === 'unverified' && x.mode === 'original'));
    assert.ok(retests.every(x => x.origin && x.origin.type === 'external' && x.origin.source === 'fenbi::p1' && x.origin.externalId === 'practice::1' && x.origin.questionNo === '3::4'));
    checks.push('D+1/D+3/D+7 generated from 2026-11-02 with external JSON-tuple origin and pending/unverified tasks');

    await page.locator('#learnGenerateRetests').click();
    await page.waitForTimeout(400);
    const count = await page.evaluate(() => LearningStore.listTasks().then(xs => xs.filter(x => x.reviewKey && x.reviewKey.indexOf('retest-v1:') === 0).length));
    assert.equal(count, 3);
    checks.push('retest generation is idempotent');

    // Postpone via visible UI and preserve the original error.
    const firstRetest = retests[0];
    await page.locator('[data-retest-action="postpone"]').first().click();
    await waitModal(page);
    await page.locator('#learnRetestDate').fill('2026-11-06');
    await page.locator('#learnRetestReason').fill('P1 UI 推迟');
    await page.locator('#learnModalRoot [data-ok]').click();
    await waitModalGone(page);
    const postponed = await page.evaluate(async id => (await LearningStore.listTasks()).find(x => x.id === id), firstRetest.id);
    assert.equal(postponed.dueDate, '2026-11-06');
    assert.equal(postponed.retestHistory.at(-1).action, 'postpone');
    assert.equal(postponed.retestHistory.at(-1).fromDate, '2026-11-03');
    assert.equal(postponed.retestOrigin.questionNo, '3::4');
    checks.push('postpone is operable and keeps original error and before/after history');

    // Skip a different retest via visible UI.
    const secondRetest = retests[1];
    const d3Row = page.locator('tr').filter({ hasText: 'D+3 原题复测' }).first();
    await d3Row.locator('[data-retest-action="skip"]').click();
    await waitModal(page);
    await page.locator('#learnRetestReason').fill('P1 UI 跳过');
    await page.locator('#learnModalRoot [data-ok]').click();
    await waitModalGone(page);
    const skipped = await page.evaluate(async id => (await LearningStore.listTasks()).find(x => x.id === id), secondRetest.id);
    assert.equal(skipped.reminderStatus, 'skipped');
    assert.equal(skipped.retestHistory.at(-1).action, 'skip');
    checks.push('skip reminder is operable and retained in history');

    // Similar-new-question task is a distinct explicit mode.
    await page.locator('[data-retest-action="similar"]').first().click();
    await page.waitForFunction(() => LearningStore.listTasks().then(xs => xs.some(x => x.retestMode === 'similar')));
    const similar = await page.evaluate(async () => (await LearningStore.listTasks()).find(x => x.retestMode === 'similar'));
    assert.ok(similar && similar.retestOrigin.questionNo === '3::4');
    assert.ok(retests.every(x => x.id !== similar.reviewKey), 'similar task has its own review key');
    checks.push('original retest and similar-new-question validation are explicit separate modes');

    // Complete the D+7 original retest: actual result recorded separately,
    // plan status completed, and mastery is never auto-set.
    const d7Row = page.locator('tr').filter({ hasText: 'D+7 原题复测' }).first();
    await d7Row.locator('[data-complete-task]').click();
    await waitModal(page);
    await page.locator('#learnActualMin').fill('8');
    await page.locator('#learnActualQ').fill('1');
    await page.locator('#learnActualC').fill('1');
    await page.locator('#learnActualNote').fill('P1 UI 完成复测');
    await page.locator('#learnModalRoot [data-ok]').click();
    await waitModalGone(page);
    const completed = await page.evaluate(async id => (await LearningStore.listTasks()).find(x => x.id === id), retests[2].id);
    const todaySh = await page.evaluate(() => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10));
    assert.equal(completed.status, 'completed');
    assert.equal(completed.retestResults.length, 1);
    assert.equal(completed.retestResults[0].correctCount, 1);
    assert.equal(completed.retestResults[0].date, todaySh, 'actual completion date, not the future D+7 plan date');
    assert.equal(completed.retestResults[0].dueDate, '2026-11-09', 'planned due date remains separate');
    assert.equal(completed.retestResults[0].errorDate, '2026-11-02');
    assert.equal(completed.dueDate, '2026-11-09', 'recording a result must not rewrite the plan');
    assert.equal(completed.mastery, 'unverified');
    await page.locator('.learn-completed-archive > summary').first().click();
    await page.waitForFunction(() => document.querySelector('.learn-completed-archive') && document.querySelector('.learn-completed-archive').open === true);
    const completedRow = page.locator('tr').filter({ hasText: 'D+7 原题复测' }).first();
    await completedRow.locator('[data-retest-history]').click();
    await waitModal(page);
    const historyText = await page.locator('#learnModalRoot').textContent();
    assert.match(historyText, /原始错误日期：2026-11-02/);
    assert.match(historyText, /每次复测成绩/);
    await page.locator('#learnModalRoot [data-cancel]').click();
    await waitModalGone(page);
    checks.push('retest result is recorded separately from plan completion; one correct answer does not auto-master; history is visible');

    // Internal-origin source verification: a raw lastWrongAt must be converted
    // at the new-plan boundary even when the host-local lastWrongDate says 11/2.
    // The history UI exposes the conversion source so this is not silent.
    const internalPlan = await page.evaluate(async () => {
      const shanghaiMidnight = Date.UTC(2026, 10, 2, 16, 0, 0);
      const origins = RetestScheduler.buildOrigins({ engine: { wrongs: [{
        qid: 'q-internal-tz', n: 7, examId: 'exam-internal-tz', examName: '内部时区（合成）',
        subject: '判断推理', tags: ['内部时区来源验证'],
        lastWrongAt: shanghaiMidnight, lastWrongDate: '2026-11-02',
        attempts: [{ attemptId: 'att-internal-tz' }]
      }] } });
      const prepared = RetestScheduler.plan(origins, {});
      for (const t of prepared.tasks) await LearningStore.saveTask(t);
      return prepared.tasks.map(t => ({
        id: t.id, title: t.title, interval: t.retestInterval,
        dueDate: t.dueDate, errorDate: t.retestOrigin.errorDate,
        source: t.retestOrigin.errorDateSource
      }));
    });
    assert.equal(internalPlan.length, 3);
    assert.deepEqual(internalPlan.map(x => x.dueDate).sort(), ['2026-11-04', '2026-11-06', '2026-11-10']);
    assert.ok(internalPlan.every(x => x.errorDate === '2026-11-03' && x.source === 'internal-lastWrongAt-shanghai'));
    // Re-open through the real AppShell plan page before clicking the real
    // history button (not a hidden/modal-only DOM shortcut).
    await openLearning(page, 'learn-plans', 'plans');
    const internalD1 = internalPlan.find(x => x.interval === 1);
    assert.ok(internalD1 && internalD1.id && internalD1.title);
    // The title uses subject/number from originLabel, not the knowledge tag. Do
    // not assert or rewrite the business title: find the real D+1 button by its
    // exact data-retest-history ID in the page, then locate that same button by
    // DOM index so no JSON quotes/IDs are interpolated into a CSS selector.
    const internalD1Index = await page.evaluate(id => {
      const buttons = Array.prototype.slice.call(document.querySelectorAll('button[data-retest-history]'));
      for (let i = 0; i < buttons.length; i++) {
        if (buttons[i].getAttribute('data-retest-history') === id) return i;
      }
      return -1;
    }, internalD1.id);
    assert.ok(internalD1Index >= 0, 'D+1 history button not found: ' + internalD1.title);
    const internalHistoryButton = page.locator('button[data-retest-history]').nth(internalD1Index);
    assert.equal(await internalHistoryButton.count(), 1);
    assert.equal(await internalHistoryButton.getAttribute('data-retest-history'), internalD1.id);
    await internalHistoryButton.click();
    await waitModal(page);
    const internalHistory = await page.locator('#learnModalRoot').textContent();
    assert.match(internalHistory, /原始错误日期：2026-11-03/);
    assert.match(internalHistory, /Asia\/Shanghai/);
    await page.locator('#learnModalRoot [data-cancel]').click();
    await waitModalGone(page);
    checks.push('internal lastWrongAt converts to Asia/Shanghai at plan boundary and source is shown in history UI');

    // WP07: archive a repository-original PDF fixture, metadata, search, open.
    const beforeArchive = await page.evaluate(async () => (await ReviewArchive.list()).length);
    await openLearning(page, 'learn-records', 'reports');
    await page.waitForSelector('#learnImportReport');
    await page.locator('#learnImportReport').click();
    await page.setInputFiles('#learnReportFile', fixturePdf);
    await waitModal(page);
    await page.locator('#learnReportTitle').fill('2026-11-02 广东省考复盘（原创 fixture）');
    await page.locator('#learnReportDateInput').fill('2026-11-02');
    await page.locator('#learnReportTopics').fill('资料分析,判断推理');
    await page.locator('#learnReportKeywords').fill('审题,计算耐心');
    await page.locator('#learnReportKnowledge').fill('增长率,判断推理');
    await page.locator('#learnReportNote').fill('P1 合成归档测试，不是用户真实报告');
    await page.locator('#learnModalRoot [data-ok]').click();
    await waitModalGone(page);
    // The v5 compatibility check intentionally leaves a 10/30 archive in this
    // profile, so the expected row count is dynamic. Use the specific new
    // 11/02 archive ID for every later action instead of `.first()`.
    await page.waitForFunction(expected => document.querySelectorAll('[data-open-report]').length === expected, beforeArchive + 1);
    const archived = await page.evaluate(async () => {
      const list = await ReviewArchive.list();
      const entry = list.find(x => x.date === '2026-11-02' && String(x.title).indexOf('广东省考复盘') >= 0);
      return { list, entry };
    });
    assert.ok(archived.entry, 'the new 2026-11-02 archive must be present');
    assert.equal(archived.list.length, beforeArchive + 1);
    assert.equal(archived.entry.date, '2026-11-02');
    assert.ok(archived.entry.sha256 && archived.entry.sha256.length === 64);
    const stored = await page.evaluate(async id => { const r = await ReviewArchive.get(id); return { size: r.value.size, sha: r.value.sha256, blobSize: r.value.blob.size, type: r.value.blob.type }; }, archived.entry.id);
    assert.ok(stored.blobSize > 0 && stored.type === 'application/pdf');
    assert.equal(stored.sha, sha256File(fixturePdf));
    assert.equal(sha256File(fixturePdf), beforePdfHash, 'original fixture PDF must not be modified');
    checks.push('review PDF archived as an independent persisted Blob with metadata and unchanged source hash');

    await page.locator('#learnReportSearch').fill('判断推理');
    await page.waitForFunction(id => {
      const rows = Array.from(document.querySelectorAll('[data-open-report]'));
      return rows.length === 1 && rows[0].getAttribute('data-open-report') === id;
    }, archived.entry.id);
    await page.locator('#learnReportSearch').fill('');
    await page.locator('[data-open-report="' + archived.entry.id + '"]').click();
    await page.waitForSelector('#learnReportCanvas');
    await page.waitForFunction(() => /第 1 \/ 4 页/.test(document.getElementById('learnReportPageInfo').textContent));
    const reportHash1 = await page.evaluate(async () => {
      const d = document.getElementById('learnReportCanvas').toDataURL();
      return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(d)))].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 16);
    });
    await page.locator('#learnReportNext').click();
    await page.waitForFunction(() => /第 2 \/ 4 页/.test(document.getElementById('learnReportPageInfo').textContent));
    const reportHash2 = await page.evaluate(async () => {
      const d = document.getElementById('learnReportCanvas').toDataURL();
      return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(d)))].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 16);
    });
    assert.notEqual(reportHash1, reportHash2);
    await page.locator('#learnModalRoot [data-cancel]').click();
    await waitModalGone(page);
    checks.push('archived report opens with actual PDF page rendering and page navigation');

    // Canceling the metadata dialog writes nothing.
    const cancelBefore = await page.evaluate(async () => (await ReviewArchive.list()).length);
    await page.locator('#learnImportReport').click();
    await page.setInputFiles('#learnReportFile', fixturePdf);
    await waitModal(page);
    await page.locator('#learnModalRoot [data-cancel]').click();
    await waitModalGone(page);
    assert.equal(await page.evaluate(async () => (await ReviewArchive.list()).length), cancelBefore);
    checks.push('canceling report file dialog/metadata makes no archive write');

    // Learning-record jump to the report by date. The date is the stable key;
    // assert there is exactly one such record link instead of relying on first().
    await openLearning(page, 'learn-records', 'records');
    const reportLinks = page.locator('[data-open-report-date="2026-11-02"]');
    assert.equal(await reportLinks.count(), 1);
    await reportLinks.first().click();
    await page.waitForSelector('#learnReportCanvas');
    await page.waitForFunction(() => /第 1 \/ 4 页/.test(document.getElementById('learnReportPageInfo').textContent));
    await page.locator('#learnModalRoot [data-cancel]').click();
    await waitModalGone(page);
    checks.push('learning record jumps to the archived report by date');

    // 28-table backup/restore covers the meta archive blob.
    const backupCheck = await page.evaluate(async id => {
      const backup = await ExamBackup.createBackup();
      const index = (backup.stores.meta || []).find(x => x.key === 'reviewReportsIndex');
      const rec = (backup.stores.meta || []).find(x => x.key === 'reviewReport:' + id);
      await ReviewArchive.remove(id);
      const missing = !(await ReviewArchive.get(id));
      await ExamBackup.restoreBackup(backup);
      const restored = await ReviewArchive.get(id);
      return { stores: Object.keys(backup.stores).length, hasIndex: !!index, hasRecord: !!rec, missing, restored: !!restored, blobSize: restored && restored.value.blob.size };
    }, archived.entry.id);
    assert.equal(backupCheck.stores, 28);
    assert.equal(backupCheck.hasIndex, true);
    assert.equal(backupCheck.hasRecord, true);
    assert.equal(backupCheck.missing, true);
    assert.equal(backupCheck.restored, true);
    assert.ok(backupCheck.blobSize > 0);
    checks.push('existing 28-table backup/restore includes the review archive metadata and Blob');

    await page.screenshot({ path: path.join(root, 'reports/p1-retest-archive-ui.png') });
    writeReport({ status: 'pass', profile: c.profile, checks, fixturePdfSha256: beforePdfHash, db: { version: 6, stores: 28 } });
    console.log('PASS P1 retest + archive UI:', checks.length, 'checks');
  } catch (e) {
    writeReport({ status: 'fail', profile: c && c.profile, checks, error: String(e && e.stack || e), fixturePdfSha256: beforePdfHash });
    throw e;
  } finally {
    if (c) await c.app.close().catch(() => {});
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
