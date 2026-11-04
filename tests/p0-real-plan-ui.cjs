/* SPDX-License-Identifier: Apache-2.0 */
/* 1.2.0 P0 real 2026-11-03 daily-plan UI acceptance. Reads the original file
   from EXAMCARD_REAL_PLAN (never copies, edits or packages it), verifies its SHA-256,
   imports through the real Electron UI, and checks duplicate/update protection. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { launch } = require('./launch.cjs');

const root = path.resolve(__dirname, '..');
const reportPath = path.join(root, 'reports/p0-real-plan-ui.json');
const realPath = process.env.EXAMCARD_REAL_PLAN || '';
const expectedSha = '8b7a1535f2cf08161b2157a134823c8fb391e66d21c7c661e0c49280a047d529';
const expectedTitles = [
  '工程问题：工作总量、效率与合作工程',
  '平均数与平均数增长量：列式、单位、截位估算',
  '概率入门：古典概型、事件计数；不重复捆绑插空',
  '政治理论多选：百千万工程与城乡融合',
  '削弱、加强与选非：论点关联、必要充分条件',
  '百千万工程背诵：15分钟提纲正文应用＋5分钟闭卷复述',
  '登记真实成绩、逐题用时、错因；未提交标待核实'
];

function writeReport(data) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(data, null, 2));
}
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
async function waitModal(page) {
  await page.waitForSelector('#learnModalRoot .learn-modal');
  await page.waitForFunction(() => !!document.querySelector('#learnModalRoot [data-ok]'));
}
async function waitModalGone(page) {
  await page.waitForFunction(() => !document.querySelector('#learnModalRoot [data-ok]'));
  await page.waitForFunction(() => !document.querySelector('#learnModalRoot .learn-mask'));
}

(async () => {
  let c = null;
  const checks = [];
  if (!fs.existsSync(realPath)) {
    writeReport({ status: 'skip', reason: 'EXAMCARD_REAL_PLAN not set or file unavailable', checks: [] });
    console.log('SKIP real plan file unavailable:', realPath);
    return;
  }
  const beforeHash = sha256(realPath);
  if (beforeHash !== expectedSha) {
    writeReport({ status: 'fail', reason: 'real plan SHA-256 mismatch; refusing to import unverified input', expectedSha, actualSha: beforeHash, checks });
    throw new Error('real plan SHA-256 mismatch: ' + beforeHash);
  }
  try {
    try {
      c = await launch();
    } catch (e) {
      const detail = String(e && e.stack || e);
      if (/spawn EPERM|platform_channel|拒绝访问/i.test(detail)) {
        writeReport({
          status: 'skip',
          reason: 'DSH host sandbox blocks spawning Electron (spawn EPERM / platform-channel denied). Verified file SHA-256 but no isolated UI process was created. Run in a normal-permission Windows session.',
          file: realPath, sha256: beforeHash, error: detail.split('\n').slice(0, 8).join('\n'), checks: []
        });
        console.log('SKIP real-plan Electron UI blocked by host sandbox');
        return;
      }
      writeReport({ status: 'fail', phase: 'launch', file: realPath, sha256: beforeHash, error: detail, checks });
      throw e;
    }
    const { page } = c;
    page.setDefaultTimeout(10000);

    await page.evaluate(async () => { await AppShell.navigate('learn-plans'); await LearningApp.open('plans'); });
    await page.waitForSelector('#learnPlanFile', { state: 'attached' });
    await page.setInputFiles('#learnPlanFile', { name: path.basename(realPath), mimeType: 'application/json', buffer: fs.readFileSync(realPath) });
    await waitModal(page);
    const preview = await page.locator('#learnModalRoot').textContent();
    assert.match(preview, /11月3日广东省考基础强化计划/);
    assert.match(preview, /gd-2026-11-03-evening-v1|任务数量7/);
    assert.match(preview, /新增\s*7/);
    for (const title of expectedTitles) assert.ok(preview.includes(title), 'preview missing title: ' + title);
    assert.match(preview, /19:30–20:15/);
    assert.match(preview, /听课 15分/);
    assert.match(preview, /教材例题 8分/);
    assert.match(preview, /限时练习 16分/);
    assert.match(preview, /错题复盘 6分/);
    await page.locator('#learnModalRoot [data-ok]').click();
    await waitModalGone(page);

    const imported = await page.evaluate(async () => {
      const ts = (await LearningStore.listTasks()).filter(x => x.planId === 'gd-2026-11-03-evening-v1').sort((a, b) => a.planTaskId.localeCompare(b.planTaskId));
      return ts.map(t => ({
        id: t.id, planTaskId: t.planTaskId, title: t.title, start: t.start, end: t.end,
        planMinutes: t.planMinutes, planQuestions: t.planQuestions, status: t.status,
        stages: t.stages.map(s => s.type + ':' + s.minutes), planSource: t.planSource
      }));
    });
    assert.equal(imported.length, 7);
    assert.deepEqual(imported.map(t => t.title), expectedTitles);
    assert.deepEqual(imported.map(t => [t.start, t.end, t.planMinutes, t.planQuestions]), [
      ['19:30', '20:15', 45, 6], ['20:25', '21:10', 45, 7], ['21:20', '22:05', 45, 5],
      ['22:15', '22:40', 25, 7], ['22:40', '23:05', 25, 7], ['23:05', '23:25', 20, null], ['23:25', '23:30', 5, null]
    ]);
    assert.ok(imported.every(t => t.status === 'pending' && t.planSource === 'daily-plan-v1'));
    assert.deepEqual(imported[0].stages, ['video:15', 'examples:8', 'practice:16', 'review:6']);
    assert.deepEqual(imported[5].stages, ['reading:15', 'other:5']);
    checks.push('original 7-task plan imported with exact titles, times, stages, minutes and question counts; all pending');

    await page.evaluate(async () => { await AppShell.navigate('learn-plans'); await LearningApp.open('plans'); });
    const body = await page.locator('#learnBody').textContent();
    for (const title of expectedTitles) assert.ok(body.includes(title), 'plan list missing title: ' + title);
    assert.match(body, /19:30–20:15/);
    assert.match(body, /45 分钟 \/ 6 题/);
    assert.match(body, /20 分钟 \/ —/);
    checks.push('imported tasks are visible in the real plan UI');

    await page.waitForSelector('#learnPlanFile', { state: 'attached' });
    await page.setInputFiles('#learnPlanFile', { name: path.basename(realPath), mimeType: 'application/json', buffer: fs.readFileSync(realPath) });
    await waitModal(page);
    assert.match(await page.locator('#learnModalRoot').textContent(), /未变化\s*7/);
    await page.locator('#learnModalRoot [data-ok]').click();
    await waitModalGone(page);
    const countAfterDuplicate = await page.evaluate(() => LearningStore.listTasks().then(xs => xs.filter(x => x.planId === 'gd-2026-11-03-evening-v1').length));
    assert.equal(countAfterDuplicate, 7);
    checks.push('duplicate import of the same original file creates no duplicate tasks');

    await page.evaluate(async () => {
      const t = (await LearningStore.listTasks()).find(x => x.planId === 'gd-2026-11-03-evening-v1' && x.planTaskId === 'gd1103-01');
      t.status = 'completed'; t.completedAt = Date.now(); t.actualMinutes = 50; t.actualQuestions = 6; t.actualCorrect = 5; t.actualSource = 'manual';
      await LearningStore.saveTask(t);
    });
    await page.evaluate(async () => { await AppShell.navigate('learn-plans'); await LearningApp.open('plans'); });
    await page.waitForSelector('#learnPlanFile', { state: 'attached' });
    await page.waitForFunction(() => document.getElementById('learnBody').textContent.includes('已完成任务（1）'));
    await page.setInputFiles('#learnPlanFile', { name: path.basename(realPath), mimeType: 'application/json', buffer: fs.readFileSync(realPath) });
    await waitModal(page);
    assert.match(await page.locator('#learnModalRoot').textContent(), /已完成，跳过更新/);
    await page.locator('#learnModalRoot [data-ok]').click();
    await waitModalGone(page);
    const protectedTask = await page.evaluate(async () => {
      const t = (await LearningStore.listTasks()).find(x => x.planId === 'gd-2026-11-03-evening-v1' && x.planTaskId === 'gd1103-01');
      return { status: t.status, actualMinutes: t.actualMinutes, actualQuestions: t.actualQuestions, actualCorrect: t.actualCorrect };
    });
    assert.deepEqual(JSON.parse(JSON.stringify(protectedTask)), { status: 'completed', actualMinutes: 50, actualQuestions: 6, actualCorrect: 5 });
    checks.push('completed actual data survives re-import of the original plan');

    // Same task_id with different content must be an explicit duplicate-ID error,
    // not a silent overwrite. Build this only in memory; the original file is untouched.
    const dup = JSON.parse(fs.readFileSync(realPath, 'utf8'));
    dup.tasks.push(Object.assign({}, dup.tasks[0], { topic: '重复 task_id 的不同内容' }));
    await page.evaluate(async () => { await AppShell.navigate('learn-plans'); await LearningApp.open('plans'); });
    await page.waitForSelector('#learnPlanFile', { state: 'attached' });
    await page.setInputFiles('#learnPlanFile', { name: 'duplicate-task-id.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(dup)) });
    await page.waitForSelector('#learnModalRoot .learn-modal');
    await page.waitForFunction(() => /tasks\[7\]\.task_id/.test(document.querySelector('#learnModalRoot').textContent));
    const dupText = await page.locator('#learnModalRoot').textContent();
    assert.match(dupText, /tasks\[7\]\.task_id/);
    assert.match(dupText, /重复/);
    await page.locator('#learnModalRoot [data-cancel]').click();
    await page.waitForFunction(() => !document.querySelector('#learnModalRoot .learn-mask'));
    const countAfterReject = await page.evaluate(() => LearningStore.listTasks().then(xs => xs.filter(x => x.planId === 'gd-2026-11-03-evening-v1').length));
    assert.equal(countAfterReject, 7, 'rejected duplicate-id file must write no task');
    checks.push('same task_id with different content is rejected with a path and zero writes');

    const afterHash = sha256(realPath);
    assert.equal(afterHash, beforeHash, 'original plan file must not be modified');
    writeReport({
      status: 'pass',
      file: realPath,
      sha256: afterHash,
      profile: c.profile,
      imported: imported.length,
      titles: imported.map(t => t.title),
      checks
    });
    console.log('PASS real 2026-11-03 plan UI:', checks.length, 'checks');
  } catch (e) {
    writeReport({ status: 'fail', file: realPath, sha256: beforeHash, profile: c && c.profile, checks, error: String(e && e.stack || e) });
    throw e;
  } finally {
    if (c) await c.app.close().catch(() => {});
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
