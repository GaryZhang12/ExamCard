/* SPDX-License-Identifier: Apache-2.0 */
/* WP10 Stage B isolated Electron transaction/undo/UI acceptance.
   Original synthetic data only; no real profile, PDF or Fenbi credentials. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { launch } = require('./launch.cjs');
const isEnvironmentDenial = require('./p2-ui-skip-policy.cjs');
const F = require('../app/review-exchange-format.js');

const root = path.resolve(__dirname, '..');
const reportPath = path.join(root, 'reports/wp10-review-exchange-ui.json');
const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/wp10-mixed-golden.json'), 'utf8'));
const FIXED_NOW = Date.UTC(2026, 10, 3, 2, 0, 0);
let c;
const checks = [];
function writeReport(data) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(data, null, 2));
}
function writeSkip(data) {
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(reportPath, 'utf8')); } catch (e) {}
  if (prev && prev.status !== 'skip' && prev.profile) fs.writeFileSync(path.join(root, 'reports/wp10-review-exchange-ui-dsh-skip.json'), JSON.stringify(data, null, 2));
  else writeReport(data);
}
function freezeDateScript(fixed) {
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...args) { if (args.length === 0) super(fixed); else super(...args); }
    static now() { return fixed; }
  }
  window.Date = FixedDate;
}
async function previewText(page, text) {
  return page.evaluate(async (t) => {
    try {
      const f = new File([t], 'review-exchange.json', { type: 'application/json' });
      const r = await ReviewExchange.preview(f);
      window.__rxToken = r.token;
      window.__rxPlan = r.plan;
      return { ok: true, plan: r.plan };
    } catch (e) {
      return { ok: false, error: e.message, details: e.details || null };
    }
  }, text);
}
async function commitStored(page, allow) {
  return page.evaluate(async (a) => {
    try { return { ok: true, result: await ReviewExchange.commit(window.__rxToken, { allowReimport: !!a }) }; }
    catch (e) { return { ok: false, code: e.code, error: e.message, details: e.details || null }; }
  }, !!allow);
}
function batchText(id, activities, reviews, corrections) {
  return JSON.stringify({
    schema: F.SCHEMA, batch_id: id,
    source: { kind: 'chatgpt', ref: 'wp10-synthetic-producer', label: '原创合成验收' },
    generated_at: '2026-11-03T10:00:00+08:00',
    activities: activities || [], reviews: reviews || [], corrections: corrections || [],
    notes: '仅隔离合成测试；无真实用户数据。'
  });
}
async function targetObj(type, rec) {
  if (type === 'studyLog') return { type, namespace: 'ec-store:studyLogs', id: rec.id, expected_revision: Number(rec.revision || 0), expected_hash: await F.contentHashFor('studyLog', rec) };
  if (type === 'learningTask') return { type, namespace: 'ec-store:learningTasks', id: rec.id, expected_updated_at: Number(rec.updatedAt || 0), expected_hash: await F.contentHashFor('learningTask', rec) };
  if (type === 'gradingRecord') return { type, namespace: 'ec-store:gradingRecords', id: rec.attemptId, expected_hash: await F.contentHashFor('gradingRecord', rec) };
  if (type === 'bankAttempt') return { type, namespace: 'ec-store:bankAttempts', id: rec.id, expected_hash: await F.contentHashFor('bankAttempt', rec) };
  if (type === 'essayReview') return { type, namespace: 'ec-store:essayReviews', id: rec.id, expected_hash: await F.contentHashFor('essayReview', rec) };
  throw new Error('unsupported target ' + type);
}
function activity(overrides) {
  return Object.assign({
    activity_id: 'synthetic-new-1', kind: 'manual', assessment: 'objective', date: '2026-11-02',
    content: '原创合成新活动', module: '数量关系', practice_type: null, question_count: 2, correct_count: 1,
    duration_precision: 'unknown', duration_unit: 'seconds', groups: [], wrong_questions: [], essay_scores: []
  }, overrides || {});
}
async function batchActivityTarget(act) {
  const temp = {
    schema: F.SCHEMA, batch_id: 'tmp-' + act.activity_id, source: { kind: 'chatgpt', ref: 'tmp' }, generated_at: '2026-11-03T10:00:00+08:00',
    activities: [act], reviews: [{ review_id: 'tmp-review', target: { type: 'batchActivity', namespace: 'batch:activity', id: act.activity_id, expected_revision: 0, expected_hash: 'sha256:' + '0'.repeat(64) }, summary: 'tmp', reviewed_at: '2026-11-03T10:00:00+08:00' }], corrections: []
  };
  const p = await F.parseText(JSON.stringify(temp));
  assert.equal(p.ok, true, JSON.stringify(p.errors));
  return { type: 'batchActivity', namespace: 'batch:activity', id: act.activity_id, expected_revision: 0, expected_hash: await F.contentHashFor('batchActivity', p.value.activities[0]) };
}
async function makeValidatedBatch(id, acts, reviewSpecs, corrections) {
  const reviews = [];
  for (const r of reviewSpecs || []) reviews.push({ review_id: r.review_id, target: r.target, summary: r.summary || '原创合成复盘', reviewed_at: '2026-11-03T10:00:00+08:00', primary_cause: r.primary_cause || '', secondary_causes: r.secondary_causes || [], knowledge_points: r.knowledge_points || [], next_actions: r.next_actions || [], note: r.note || '' });
  const text = batchText(id, acts, reviews, corrections || []);
  const p = await F.parseText(text);
  assert.equal(p.ok, true, 'batch validation: ' + JSON.stringify(p.errors));
  return text;
}
(async () => {
  try {
    c = await launch();
    const page = c.page;
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(String(e)));
    page.setDefaultTimeout(15000);
    await page.evaluate(freezeDateScript, FIXED_NOW);

    // 1. Import Work's synthetic mixed golden batch through the real module.
    const goldenPreview = await previewText(page, JSON.stringify(golden));
    assert.equal(goldenPreview.ok, true, JSON.stringify(goldenPreview));
    assert.equal(goldenPreview.plan.status, 'ready');
    assert.equal(goldenPreview.plan.counts.activities, 6);
    const goldenCommit = await commitStored(page, false);
    assert.equal(goldenCommit.ok, true, JSON.stringify(goldenCommit));
    const goldenStats = await page.evaluate(async () => {
      const logs = await DiagnosisStore.listStudyLogs();
      const summary = StudyLog.summarize(logs);
      const trend = await TrendEngine.load({ now: Date.UTC(2026, 10, 3), days: 7 });
      return {
        subtotal: [summary.objective.subtotal.correct, summary.objective.subtotal.questions, summary.objective.subtotal.accuracy],
        retest: [summary.objective.categories.retest.correct, summary.objective.categories.retest.questions],
        unclassified: [summary.objective.categories.unclassified.correct, summary.objective.categories.unclassified.questions],
        comprehensive: [summary.objective.categories.comprehensive.correct, summary.objective.categories.comprehensive.questions],
        overall: [summary.objective.total.correct, summary.objective.total.questions, summary.objective.total.accuracy],
        trendOverall: [trend.overall.correct, trend.overall.questions],
        essays: summary.essays.map(e => (e.scores || []).map(s => s.score)),
        batches: (await ReviewExchange.listBatches()).length
      };
    });
    assert.deepEqual(goldenStats.subtotal, [30, 48, 62.5]);
    assert.deepEqual(goldenStats.retest, [12, 18]);
    assert.deepEqual(goldenStats.unclassified, [18, 30]);
    assert.deepEqual(goldenStats.comprehensive, [11, 15]);
    assert.deepEqual(goldenStats.overall, [41, 63, 65.1]);
    assert.deepEqual(goldenStats.trendOverall, [41, 63]);
    assert.deepEqual(goldenStats.essays[0], [7, 9]);
    assert.equal(goldenStats.batches, 1);
    checks.push('golden mixed batch imports atomically; 30/48, 12/18, 18/30, 11/15, 41/63, essays 7/9');

    // 2. Seed explicit targets after stats baseline.
    const seeded = await page.evaluate(async () => {
      const saved = await DiagnosisStore.saveStudyLogs([{
        schema: 'examcard.study-log/v2', id: 'rx-target-seed', kind: 'external', source: 'synthetic',
        externalId: 'rx-target-1', date: '2026-11-02', assessment: 'objective', status: 'active',
        content: '目标外部活动', module: '判断推理', practiceType: 'retest', questionCount: 6, correctCount: 5,
        durationPrecision: 'unknown', durationUnit: 'seconds', groups: [], wrongQuestions: [], essayScores: [], note: ''
      }], { reason: 'WP10 Stage B target seed' });
      const log = saved[0];
      window.__rxTargetId = log.id;
      window.__rxTargetRevision = log.revision;
      const task = await LearningStore.saveTask({
        title: '合成复测任务', date: '2026-11-03', type: 'retest', status: 'pending', retestMode: 'original', retestInterval: 1,
        retestOrigin: { type: 'external', source: 'synthetic', externalId: 'rx-target-1', logId: log.id, errorDate: '2026-11-02' },
        retestResults: [], retestHistory: []
      });
      await ExamStore.putGradingRecord({ attemptId: 'att-rx', sessionId: 's-rx', examId: 'e-rx', examName: '合成批改', gradedAt: Date.UTC(2026, 10, 2, 2), gradingStatus: 'graded', summary: { total: 3 }, config: {}, details: [] });
      await EssayStore.saveReview({ id: 'er-rx', sessionId: 'es-rx', examId: 'ee-rx', overall: { totalScore: 7, maxScore: 10, summary: '合成申论' }, importedAt: Date.UTC(2026, 10, 2, 2), prompts: [] });
      return {
        log: log, targetId: log.id,
        task: (await LearningStore.listTasks()).find(x => x.id === task.id),
        grade: await ExamStore.getGradingRecord('att-rx'),
        essay: await EssayStore.getReview('er-rx')
      };
    });
    assert.ok(seeded.log, 'seed studyLog');
    assert.ok(seeded.task, 'seed learningTask');
    assert.ok(seeded.grade, 'seed gradingRecord');
    assert.ok(seeded.essay, 'seed essayReview');

    // 3. Preview creates no writes; opaque token required.
    const beforePreview = await page.evaluate(async () => ({ batches: (await ReviewExchange.listBatches()).length, logs: (await DiagnosisStore.listStudyLogs()).length }));
    const batchA = await makeValidatedBatch('wp10-batch-a', [activity({ activity_id: 'a-new-1' })], [], []);
    const pA = await previewText(page, batchA);
    assert.equal(pA.ok, true, JSON.stringify(pA));
    assert.equal(pA.plan.status, 'ready');
    const afterPreview = await page.evaluate(async () => ({ batches: (await ReviewExchange.listBatches()).length, logs: (await DiagnosisStore.listStudyLogs()).length }));
    assert.deepEqual(afterPreview, beforePreview, 'preview must be zero-write');
    const bogus = await page.evaluate(async () => { try { await ReviewExchange.commit('not-a-real-token', {}); return 'unexpected'; } catch (e) { return e.code; } });
    assert.equal(bogus, 'preview-missing');
    const cA = await commitStored(page, false);
    assert.equal(cA.ok, true, JSON.stringify(cA));
    checks.push('preview zero-write, opaque token, real commit');

    const batchAct = activity({ activity_id: 'a-batch-target', content: '同批 activity 目标' });
    const batchActTarget = await batchActivityTarget(batchAct);
    const batchActText = await makeValidatedBatch('wp10-batch-activity-target', [batchAct], [{ review_id: 'review-batch-activity', target: batchActTarget, summary: '同批活动复盘' }], []);
    const pBat = await previewText(page, batchActText);
    assert.equal(pBat.ok, true, JSON.stringify(pBat));
    assert.equal(pBat.plan.status, 'ready');
    assert.equal((await commitStored(page, false)).ok, true);
    const batEntity = await page.evaluate(async () => (await ReviewExchange.listEntitiesForTarget('batchActivity', 'a-batch-target')).length);
    assert.equal(batEntity, 1);

    // 4. Source bytes changed after preview => explicit invalidation.
    const sourceChanged = await page.evaluate(async (text) => {
      const enc = new TextEncoder();
      window.__rxChangedBytes = enc.encode(text);
      const src = { name: 'changed.json', size: window.__rxChangedBytes.byteLength, arrayBuffer: async () => window.__rxChangedBytes.slice() };
      const r = await ReviewExchange.preview(src);
      window.__rxChangedToken = r.token;
      window.__rxChangedBytes = enc.encode(text + ' ');
      try { await ReviewExchange.commit(window.__rxChangedToken, {}); return 'unexpected'; }
      catch (e) { return e.code; }
    }, await makeValidatedBatch('wp10-batch-source-change', [activity({ activity_id: 'a-source-change' })], [], []));
    assert.equal(sourceChanged, 'source-changed');

    // 5. Target edited after preview => commit rejects with no batch/log.
    const batchTargetReview = await makeValidatedBatch('wp10-batch-target-edit', [], [{ review_id: 'review-edit', target: await targetObj('studyLog', seeded.log), summary: '目标编辑测试' }], []);
    const pt = await previewText(page, batchTargetReview);
    assert.equal(pt.ok, true, JSON.stringify(pt));
    const targetEdit = await page.evaluate(async () => {
      await DiagnosisStore.updateStudyLog(window.__rxTargetId, { note: 'preview 后用户修改' }, { expectedRevision: window.__rxTargetRevision, reason: 'WP10 preview change test' });
      try { await ReviewExchange.commit(window.__rxToken, {}); return 'unexpected'; }
      catch (e) { return e.code; }
    });
    assert.equal(targetEdit, 'target-changed');
    const noTargetEditBatch = await page.evaluate(async () => (await ReviewExchange.listBatches()).some(b => b.batchId === 'wp10-batch-target-edit'));
    assert.equal(noTargetEditBatch, false);

    // 6. Full target/review/correction batch: two review IDs same target, task/grading/essay targets and correction audit.
    const currentTarget = await page.evaluate(async () => { const l = (await DiagnosisStore.listStudyLogs()).find(x => x.id === window.__rxTargetId); return l; });
    const targetTask = await page.evaluate(async () => (await LearningStore.listTasks()).find(x => x.id === 'tmp' ) || (await LearningStore.listTasks())[0]);
    const targetGrade = await page.evaluate(async () => ExamStore.getGradingRecord('att-rx'));
    const targetEssay = await page.evaluate(async () => EssayStore.getReview('er-rx'));
    const reviewTargetLog = await targetObj('studyLog', currentTarget);
    const batchFull = await makeValidatedBatch('wp10-batch-full', [activity({ activity_id: 'a-full-1', content: '同批合成活动' })], [
      { review_id: 'review-1', target: reviewTargetLog, summary: '同一目标的第一条复盘' },
      { review_id: 'review-2', target: reviewTargetLog, summary: '同一目标的第二条复盘' },
      { review_id: 'review-task', target: await targetObj('learningTask', targetTask), summary: '任务复盘' },
      { review_id: 'review-grade', target: await targetObj('gradingRecord', targetGrade), summary: '批改复盘' },
      { review_id: 'review-essay', target: await targetObj('essayReview', targetEssay), summary: '申论复盘' }
    ], [{ target: reviewTargetLog, reason: '合成更正：保留审计', fields: { content: '更正后的目标外部活动', note: 'correction' } }]);
    const pf = await previewText(page, batchFull);
    assert.equal(pf.ok, true, JSON.stringify(pf));
    assert.equal(pf.plan.counts.reviews, 5);
    assert.equal(pf.plan.counts.corrections, 1);
    const originalRaw = await page.evaluate(async () => ({ grade: await ExamStore.getGradingRecord('att-rx'), essay: await EssayStore.getReview('er-rx') }));
    const cf = await commitStored(page, false);
    assert.equal(cf.ok, true, JSON.stringify(cf));
    const afterRaw = await page.evaluate(async () => ({ grade: await ExamStore.getGradingRecord('att-rx'), essay: await EssayStore.getReview('er-rx') }));
    assert.deepEqual(afterRaw, originalRaw, 'raw gradingRecord/essayReview must remain read-only');
    const fullState = await page.evaluate(async () => {
      const l = (await DiagnosisStore.listStudyLogs()).find(x => x.id === window.__rxTargetId);
      const entities = await ReviewExchange.listEntitiesForTarget('studyLog', window.__rxTargetId);
      const batch = await ReviewExchange.getBatch('wp10-batch-full');
      return { content: l.content, revision: l.revision, revisions: l.revisions.length, lastAction: l.revisions[l.revisions.length - 1].action, entities: entities.length, batchReviews: batch.reviews.length };
    });
    assert.equal(fullState.content, '更正后的目标外部活动');
    assert.equal(fullState.revision, 3);
    assert.equal(fullState.revisions, 3);
    assert.equal(fullState.lastAction, 'update');
    assert.equal(fullState.entities, 2);
    assert.equal(fullState.batchReviews, 5);
    checks.push('5 reviews/2 same-target reviews, all typed targets, correction audit');

    // 7. Same target multiple review IDs persist; same review ID changed summary conflicts.
    const conflictLog = await page.evaluate(async () => (await DiagnosisStore.listStudyLogs()).find(x => x.id === window.__rxTargetId));
    const conflictTarget = await targetObj('studyLog', conflictLog);
    const dupReviewText = await makeValidatedBatch('wp10-batch-review-conflict', [], [{ review_id: 'review-1', target: conflictTarget, summary: '改过的摘要' }], []);
    const dupReview = await previewText(page, dupReviewText);
    assert.equal(dupReview.ok, true);
    assert.equal(dupReview.plan.status, 'blocked');
    assert.ok(dupReview.plan.blockers.some(b => /review_id/.test(b.path)));

    // 7a. Separate correction target: undo restores business before, keeps current audit and increments revision.
    const corrSetup = await makeValidatedBatch('wp10-batch-corr-setup', [activity({ activity_id: 'a-corr-target', content: '更正审计目标' })], [], []);
    assert.equal((await previewText(page, corrSetup)).ok, true);
    assert.equal((await commitStored(page, false)).ok, true);
    const corrLog = await page.evaluate(async () => { const b = await ReviewExchange.getBatch('wp10-batch-corr-setup'); return (await DiagnosisStore.listStudyLogs()).find(x => x.id === b.activities[0].studyLogId); });
    const corrTarget = await targetObj('studyLog', corrLog);
    const correctionText = await makeValidatedBatch('wp10-batch-correction-undo', [], [], [{ target: corrTarget, reason: '合成更正撤销审计', fields: { content: '更正审计后的内容' } }]);
    assert.equal((await previewText(page, correctionText)).ok, true);
    assert.equal((await commitStored(page, false)).ok, true);
    const corrAfter = await page.evaluate(async () => { const b = await ReviewExchange.getBatch('wp10-batch-corr-setup'); const l = (await DiagnosisStore.listStudyLogs()).find(x => x.id === b.activities[0].studyLogId); return l; });
    const corrUndo = await page.evaluate(async () => ReviewExchange.undo('wp10-batch-correction-undo'));
    assert.equal(corrUndo.status, 'undone');
    const corrState = await page.evaluate(async () => {
      const b = await ReviewExchange.getBatch('wp10-batch-corr-setup');
      const l = (await DiagnosisStore.listStudyLogs()).find(x => x.id === b.activities[0].studyLogId);
      return { content: l.content, source: l.source, externalId: l.externalId, revision: l.revision, revisions: l.revisions.length, last: l.revisions[l.revisions.length - 1] };
    });
    assert.equal(corrState.content, '更正审计目标');
    assert.equal(corrState.source, corrAfter.source);
    assert.equal(corrState.externalId, corrAfter.externalId);
    assert.equal(corrState.revision, corrAfter.revision + 1);
    assert.equal(corrState.revisions, corrAfter.revisions.length + 1);
    assert.equal(corrState.last.action, 'undo');
    checks.push('correction undo restores business fields, preserves identity/revisions, appends undo audit');

    // 8. Semantic duplicate with another batch ID is duplicateOf, zero writes.
    const beforeDup = await page.evaluate(async () => (await ReviewExchange.listBatches()).length);
    const duplicateText = await makeValidatedBatch('wp10-batch-full-copy', [activity({ activity_id: 'a-full-1', content: '同批合成活动' })], [
      { review_id: 'review-1', target: reviewTargetLog, summary: '同一目标的第一条复盘' },
      { review_id: 'review-2', target: reviewTargetLog, summary: '同一目标的第二条复盘' },
      { review_id: 'review-task', target: await targetObj('learningTask', targetTask), summary: '任务复盘' },
      { review_id: 'review-grade', target: await targetObj('gradingRecord', targetGrade), summary: '批改复盘' },
      { review_id: 'review-essay', target: await targetObj('essayReview', targetEssay), summary: '申论复盘' }
    ], [{ target: reviewTargetLog, reason: '合成更正：保留审计', fields: { content: '更正后的目标外部活动', note: 'correction' } }]);
    const dup = await previewText(page, duplicateText);
    assert.equal(dup.ok, true);
    assert.equal(dup.plan.status, 'duplicate');
    const dupCommit = await commitStored(page, false);
    assert.equal(dupCommit.ok, true);
    assert.equal(dupCommit.result.status, 'duplicate');
    const afterDup = await page.evaluate(async () => (await ReviewExchange.listBatches()).length);
    assert.equal(afterDup, beforeDup);

    // 9. Transaction failure injection: abort leaves no batch/index/entity/log.
    const failBatch = await makeValidatedBatch('wp10-batch-tx-fail', [activity({ activity_id: 'a-tx-fail' })], [], []);
    const failPreview = await previewText(page, failBatch);
    assert.equal(failPreview.ok, true, JSON.stringify(failPreview));
    const failResult = await page.evaluate(async () => {
      const before = { batches: (await ReviewExchange.listBatches()).length, logs: (await DiagnosisStore.listStudyLogs()).length };
      const orig = IDBObjectStore.prototype.put;
      let n = 0;
      IDBObjectStore.prototype.put = function (...args) {
        n++;
        if (n === 2) throw new Error('INJECTED_MID_TRANSACTION_FAILURE');
        return orig.apply(this, args);
      };
      let code = null;
      try { await ReviewExchange.commit(window.__rxToken, {}); } catch (e) { code = e.code || e.message; }
      IDBObjectStore.prototype.put = orig;
      const after = { batches: (await ReviewExchange.listBatches()).length, logs: (await DiagnosisStore.listStudyLogs()).length };
      return { before, after, code, hasBatch: (await ReviewExchange.listBatches()).some(b => b.batchId === 'wp10-batch-tx-fail') };
    });
    assert.equal(failResult.hasBatch, false);
    assert.deepEqual(failResult.after, failResult.before);
    assert.ok(failResult.code);

    // 10. Epoch/stop invalidates old token; no write.
    const epochBatch = await makeValidatedBatch('wp10-batch-epoch', [activity({ activity_id: 'a-epoch' })], [], []);
    const epochPreview = await previewText(page, epochBatch);
    assert.equal(epochPreview.ok, true);
    const epochResult = await page.evaluate(async () => {
      const before = (await ReviewExchange.listBatches()).length;
      ReviewExchange.stopForClear('synthetic epoch test');
      let code = null;
      try { await ReviewExchange.commit(window.__rxToken, {}); } catch (e) { code = e.code; }
      ReviewExchange.resumeMaintenance();
      return { code, before, after: (await ReviewExchange.listBatches()).length };
    });
    assert.equal(epochResult.after, epochResult.before);
    assert.ok(epochResult.code);

    // 11. Undo A with task origin reference is rejected; after task deletion it succeeds.
    const undoTaskBatch = await makeValidatedBatch('wp10-batch-task-ref', [activity({ activity_id: 'a-task-ref' })], [], []);
    const pTask = await previewText(page, undoTaskBatch);
    assert.equal(pTask.ok, true);
    assert.equal((await commitStored(page, false)).ok, true);
    const taskRef = await page.evaluate(async () => {
      const b = await ReviewExchange.getBatch('wp10-batch-task-ref');
      const log = (await DiagnosisStore.listStudyLogs()).find(x => x.id === b.activities[0].studyLogId);
      const t = await LearningStore.saveTask({ title: '后建复测引用', date: '2026-11-04', type: 'retest', status: 'pending', retestMode: 'original', retestInterval: 1, retestOrigin: { type: 'manual', source: 'manual', externalId: null, logId: log.id, errorDate: '2026-11-02' }, retestResults: [], retestHistory: [] });
      let code = null;
      try { await ReviewExchange.undo('wp10-batch-task-ref'); } catch (e) { code = e.code; }
      await LearningStore.deleteTask(t.id);
      return { code, logId: log.id };
    });
    assert.equal(taskRef.code, 'undo-conflict');
    const undoTaskOk = await page.evaluate(async () => ReviewExchange.undo('wp10-batch-task-ref'));
    assert.equal(undoTaskOk.status, 'undone');
    const taskLogDeleted = await page.evaluate(async () => { const l = (await DiagnosisStore.listStudyLogs()).find(x => x.id === window.__rxTargetId); return !!l; });
    assert.equal(taskLogDeleted, true);

    // 12. B active reference blocks A; after B undo A is safe; B undone refs do not lock.
    const refABatchText = await makeValidatedBatch('wp10-batch-ref-a', [activity({ activity_id: 'a-ref-a', external_id: undefined })], [], []);
    const pRefA = await previewText(page, refABatchText);
    assert.equal(pRefA.ok, true);
    assert.equal((await commitStored(page, false)).ok, true);
    const refLog = await page.evaluate(async () => { const b = await ReviewExchange.getBatch('wp10-batch-ref-a'); return (await DiagnosisStore.listStudyLogs()).find(x => x.id === b.activities[0].studyLogId); });
    const refTarget = await targetObj('studyLog', refLog);
    const refBBatchText = await makeValidatedBatch('wp10-batch-ref-b', [], [{ review_id: 'review-ref-b', target: refTarget, summary: 'B 引用 A' }], []);
    const pRefB = await previewText(page, refBBatchText);
    assert.equal(pRefB.ok, true);
    assert.equal((await commitStored(page, false)).ok, true);
    const undoABlocked = await page.evaluate(async () => { try { await ReviewExchange.undo('wp10-batch-ref-a'); return 'unexpected'; } catch (e) { return e.code; } });
    assert.equal(undoABlocked, 'undo-conflict');
    const undoB = await page.evaluate(async () => ReviewExchange.undo('wp10-batch-ref-b'));
    assert.equal(undoB.status, 'undone');
    const undoA = await page.evaluate(async () => ReviewExchange.undo('wp10-batch-ref-a'));
    assert.equal(undoA.status, 'undone');
    checks.push('undo blocks task/B active references; B undo releases A');

    // 12a. B noop activity referencing A's stable studyLog also blocks A.
    const noopAText = await makeValidatedBatch('wp10-batch-noop-a', [activity({ activity_id: 'a-noop-a', content: 'noop 依赖 A' })], [], []);
    assert.equal((await previewText(page, noopAText)).ok, true);
    assert.equal((await commitStored(page, false)).ok, true);
    let noopBText = await makeValidatedBatch('wp10-batch-noop-b', [activity({ activity_id: 'a-noop-a', content: 'noop 依赖 A' })], [], []);
    const noopBObj = JSON.parse(noopBText); noopBObj.notes = 'B 独立批次包装，用于依赖测试'; noopBText = JSON.stringify(noopBObj);
    const noopPreview = await previewText(page, noopBText);
    assert.equal(noopPreview.ok, true);
    assert.equal(noopPreview.plan.activities[0].action, 'noop');
    assert.equal((await commitStored(page, false)).ok, true);
    const noopBlocked = await page.evaluate(async () => { try { await ReviewExchange.undo('wp10-batch-noop-a'); return 'unexpected'; } catch (e) { return e.code; } });
    assert.equal(noopBlocked, 'undo-conflict');
    assert.equal((await page.evaluate(async () => ReviewExchange.undo('wp10-batch-noop-b'))).status, 'undone');
    assert.equal((await page.evaluate(async () => ReviewExchange.undo('wp10-batch-noop-a'))).status, 'undone');

    // 12b. Mutation guard: concurrent commits never open two write transactions.
    const concurrentPreviews = await page.evaluate(async (texts) => {
      const tokens = [];
      for (const t of texts) { const f = new File([t], 'concurrent.json', { type: 'application/json' }); const r = await ReviewExchange.preview(f); tokens.push(r.token); }
      const before = (await ReviewExchange.listBatches()).length;
      const results = await Promise.allSettled(tokens.map(t => ReviewExchange.commit(t, {})));
      return { before, after: (await ReviewExchange.listBatches()).length, outcomes: results.map(x => x.status === 'fulfilled' ? { ok: true, status: x.value.status } : { ok: false, code: x.reason && x.reason.code }) };
    }, [
      await makeValidatedBatch('wp10-batch-concurrent-a', [activity({ activity_id: 'a-concurrent-a' })], [], []),
      await makeValidatedBatch('wp10-batch-concurrent-b', [activity({ activity_id: 'a-concurrent-b' })], [], [])
    ]);
    assert.equal(concurrentPreviews.after, concurrentPreviews.before + 1);
    assert.equal(concurrentPreviews.outcomes.filter(x => x.ok).length, 1);
    assert.ok(concurrentPreviews.outcomes.some(x => !x.ok && x.code === 'busy'));
    checks.push('mutation guard rejects concurrent commit before a second write transaction');

    // 13. Reimport an undone batch requires explicit new batch identity.
    const pReimport = await previewText(page, refABatchText);
    assert.equal(pReimport.ok, true);
    assert.equal(pReimport.plan.status, 'previously-undone');
    const forbidden = await commitStored(page, false);
    assert.equal(forbidden.ok, false);
    assert.equal(forbidden.code, 'previously-undone');
    const reimported = await commitStored(page, true);
    assert.equal(reimported.ok, true, JSON.stringify(reimported));
    assert.notEqual(reimported.result.batchId, 'wp10-batch-ref-a');

    // 14. v5 bank target is unavailable and does not upgrade.
    const bankTargetV5 = { type: 'bankAttempt', namespace: 'ec-store:bankAttempts', id: 'synthetic-bank', expected_hash: 'sha256:' + 'a'.repeat(64) };
    const bankBatchText = await makeValidatedBatch('wp10-batch-bank-v5', [], [{ review_id: 'review-bank-v5', target: bankTargetV5, summary: 'v5 题库不可用' }], []);
    const bankV5 = await previewText(page, bankBatchText);
    assert.equal(bankV5.ok, true);
    assert.equal(bankV5.plan.status, 'blocked');
    assert.ok(bankV5.plan.blockers.some(b => /v5|题库/.test(b.message)));
    const dbV5 = await page.evaluate(async () => ExamStore.withDb(d => ({ version: d.version, stores: d.objectStoreNames.length })));
    assert.deepEqual([dbV5.version, dbV5.stores], [5, 22]);

    const context = await page.evaluate(async () => ReviewExchange.exportContext());
    assert.ok(context.context.targetCatalog.length > 0);
    assert.ok(context.context.targetCatalog.some(t => t.target && t.target.type === 'studyLog' && /^sha256:[0-9a-f]{64}$/.test(t.target.expected_hash)));
    const templateCheck = await F.parseText(JSON.stringify(context.template));
    assert.equal(templateCheck.ok, true, JSON.stringify(templateCheck.errors));
    assert.ok(context.template.reviews.length >= 1);
    assert.ok(/^sha256:[0-9a-f]{64}$/.test(context.template.reviews[0].target.expected_hash));
    assert.notEqual(context.template.reviews[0].target.expected_hash, 'sha256:' + '0'.repeat(64));

    // 15. Real UI: file -> preview -> cancel zero write -> confirm -> batch detail -> target reviews.
    const uiTargetLog = await page.evaluate(async () => (await DiagnosisStore.listStudyLogs()).find(x => x.id === window.__rxTargetId));
    const uiReviewTarget = await targetObj('studyLog', uiTargetLog);
    const longSummary = 'UI 长摘要完整阅读。'.repeat(70) + '\n摘要结束标记-SUMMARY-END';
    const longAction = '下一步训练建议。'.repeat(24) + '建议结束标记-ACTION-END';
    const uiBatchText = await makeValidatedBatch('wp10-batch-ui', [activity({ activity_id: 'a-ui', content: 'UI 合成活动' })], [{
      review_id: 'review-ui', target: uiReviewTarget, summary: longSummary,
      primary_cause: '主因结束标记-PRIMARY-END', secondary_causes: ['次要原因结束标记-CAUSE-END'],
      knowledge_points: ['知识点结束标记-KP-END'], next_actions: [longAction], note: '备注结束标记-NOTE-END'
    }], []);
    await page.evaluate(async () => { await AppShell.navigate('learn-records'); await LearningApp.open('records'); });
    await page.waitForSelector('#reviewExchangePanel');
    const beforeUi = await page.evaluate(async () => (await ReviewExchange.listBatches()).length);
    await page.locator('#rxFile').setInputFiles({ name: 'review-ui.json', mimeType: 'application/json', buffer: Buffer.from(uiBatchText) });
    await page.waitForSelector('#learnModalRoot .learn-modal');
    await page.locator('#learnModalRoot [data-cancel]').click();
    const afterCancel = await page.evaluate(async () => (await ReviewExchange.listBatches()).length);
    assert.equal(afterCancel, beforeUi);
    await page.locator('#rxFile').setInputFiles({ name: 'review-ui.json', mimeType: 'application/json', buffer: Buffer.from(uiBatchText) });
    await page.waitForSelector('#learnModalRoot [data-rx-commit]');
    await page.locator('#learnModalRoot [data-rx-commit]').click();
    await page.waitForFunction(() => !document.querySelector('#learnModalRoot .learn-modal'));
    const afterUiCommit = await page.evaluate(async () => (await ReviewExchange.listBatches()).length);
    assert.equal(afterUiCommit, beforeUi + 1);
    await page.locator('#rxBatchList').click();
    await page.waitForSelector('#learnModalRoot [data-rx-batch="wp10-batch-ui"]');
    await page.locator('#learnModalRoot [data-rx-batch="wp10-batch-ui"]').click();
    await page.waitForFunction(() => /复盘批次详情/.test(document.querySelector('#learnModalRoot')?.textContent || ''));
    assert.match(await page.locator('#learnModalRoot').textContent(), /UI 长摘要/);
    await page.locator('#learnModalRoot [data-rx-review-detail]').first().click();
    await page.waitForSelector('[data-rx-review-body]');
    await page.waitForFunction(() => /SUMMARY-END/.test(document.querySelector('[data-rx-review-body]')?.textContent || ''));
    const batchFullText = await page.locator('[data-rx-review-body]').textContent();
    for (const marker of ['SUMMARY-END', 'PRIMARY-END', 'CAUSE-END', 'KP-END', 'ACTION-END', 'NOTE-END', '2026-11-03T10:00:00+08:00', 'wp10-synthetic-producer', seeded.targetId]) assert.ok(batchFullText.includes(marker), marker);
    assert.equal(await page.locator('[data-rx-review-body]').isVisible(), true);
    await page.locator('#learnModalRoot [data-cancel]').click();
    await page.evaluate(async () => { await LearningApp.reloadIfOpen(); });
    const targetReviewSelector = '[data-log-reviews="' + seeded.targetId + '"]';
    await page.waitForSelector(targetReviewSelector);
    await page.locator(targetReviewSelector).click();
    await page.waitForSelector('#learnModalRoot .learn-modal');
    assert.match(await page.locator('#learnModalRoot').textContent(), /UI 长摘要/);
    await page.locator('#learnModalRoot [data-rx-review-detail]').first().click();
    await page.waitForSelector('[data-rx-review-body]');
    await page.waitForFunction(() => /SUMMARY-END/.test(document.querySelector('[data-rx-review-body]')?.textContent || ''));
    const relatedFullText = await page.locator('[data-rx-review-body]').textContent();
    for (const marker of ['SUMMARY-END', 'PRIMARY-END', 'CAUSE-END', 'KP-END', 'ACTION-END', 'NOTE-END', '2026-11-03T10:00:00+08:00', 'wp10-synthetic-producer', seeded.targetId]) assert.ok(relatedFullText.includes(marker), marker);
    await page.locator('#learnModalRoot [data-cancel]').click();
    checks.push('real AppShell file preview/cancel/confirm, batch/related full review detail, target review link');

    // 16. XSS text is escaped, no script/request executes.
    const xssTargetLog = await page.evaluate(async () => (await DiagnosisStore.listStudyLogs()).find(x => x.id === window.__rxTargetId));
    const xssTarget = await targetObj('studyLog', xssTargetLog);
    const xssBatch = await makeValidatedBatch('wp10-batch-xss', [activity({ activity_id: 'a-xss' })], [{ review_id: 'review-xss', target: xssTarget, summary: '<img src=x onerror="window.__rxXss=1">恶意摘要', primary_cause: '<script>window.__rxXss=2</script>' }], []);
    await page.evaluate(async () => { await AppShell.navigate('learn-records'); await LearningApp.open('records'); });
    await page.locator('#rxFile').setInputFiles({ name: 'review-xss.json', mimeType: 'application/json', buffer: Buffer.from(xssBatch) });
    await page.waitForSelector('#learnModalRoot .learn-modal');
    assert.equal(await page.locator('#learnModalRoot img[src="x"]').count(), 0);
    assert.equal(await page.evaluate(() => window.__rxXss || 0), 0);
    await page.locator('#learnModalRoot [data-rx-commit]').click();
    await page.waitForFunction(() => !document.querySelector('#learnModalRoot .learn-modal'));
    await page.evaluate(async () => { await LearningApp.reloadIfOpen(); });
    await page.locator('#rxBatchList').click();
    await page.waitForSelector('#learnModalRoot [data-rx-batch="wp10-batch-xss"]');
    await page.locator('#learnModalRoot [data-rx-batch="wp10-batch-xss"]').click();
    await page.waitForSelector('#learnModalRoot [data-rx-review-detail]');
    await page.locator('#learnModalRoot [data-rx-review-detail]').first().click();
    await page.waitForSelector('[data-rx-review-body]');
    assert.equal(await page.locator('[data-rx-review-body] img').count(), 0);
    assert.equal(await page.evaluate(() => window.__rxXss || 0), 0);
    assert.match(await page.locator('[data-rx-review-body]').textContent(), /<img src=x/);
    await page.locator('#learnModalRoot [data-cancel]').click();

    // 17. v6 upgrade and bankAttempt target; then backup restore preserves batch evidence.
    const upgraded = await page.evaluate(async () => {
      const oldSave = window.gdDesktop && gdDesktop.saveFile;
      if (window.gdDesktop) gdDesktop.saveFile = async () => ({ ok: true, filePath: 'synthetic-wp10-backup.json' });
      window.confirm = () => true;
      try {
        const r = await BankMigration.upgrade();
        const db = await ExamStore.open();
        await new Promise((resolve, reject) => {
          const tx = db.transaction('bankAttempts', 'readwrite');
          tx.objectStore('bankAttempts').put({ id: 'ba-rx', sessionId: 'ba-rx', practiceSetId: 'ps-rx', submittedAt: Date.UTC(2026, 10, 3, 1), results: [], graded: 0, correct: 0 });
          tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
        });
        return { upgraded: r, version: db.version, stores: db.objectStoreNames.length };
      } finally { if (window.gdDesktop) gdDesktop.saveFile = oldSave; }
    });
    assert.equal(upgraded.version, 6);
    assert.equal(upgraded.stores, 28);
    const bank = await page.evaluate(async () => ExamStore.withDb(db => new Promise((resolve, reject) => {
      const tx = db.transaction('bankAttempts', 'readonly'); const r = tx.objectStore('bankAttempts').get('ba-rx'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    })));
    const bankTarget = await targetObj('bankAttempt', bank);
    const bankV6Text = await makeValidatedBatch('wp10-batch-bank-v6', [], [{ review_id: 'review-bank-v6', target: bankTarget, summary: 'v6 题库复盘' }], []);
    const bankV6Preview = await previewText(page, bankV6Text);
    assert.equal(bankV6Preview.ok, true);
    assert.equal(bankV6Preview.plan.status, 'ready');
    assert.equal((await commitStored(page, false)).ok, true);
    checks.push('v5 bank target blocked without upgrade; v6/28 bankAttempt target commits');

    const backup = await page.evaluate(async () => ExamBackup.createBackup());
    const restored = await page.evaluate(async b => {
      await ExamStore.clearUserData();
      const afterClear = (await ReviewExchange.listBatches()).length;
      await ExamBackup.restoreBackup(b);
      return { afterClear, afterRestore: (await ReviewExchange.listBatches()).length, db: await ExamStore.withDb(d => ({ version: d.version, stores: d.objectStoreNames.length })) };
    }, backup);
    assert.equal(restored.afterClear, 0);
    assert.ok(restored.afterRestore >= 1);
    assert.deepEqual([restored.db.version, restored.db.stores], [6, 28]);
    checks.push('clear/restore maintenance preserves batch evidence; DB remains v6/28');

    assert.equal(pageErrors.length, 0, 'renderer page errors: ' + pageErrors.join(' | '));
    writeReport({ status: 'pass', profile: c.profile, info: c.info, checks, db: { version: 6, stores: 28 }, pageExceptions: pageErrors.length });
    console.log('PASS WP10 Stage B:', checks.length, 'checks');
  } catch (e) {
    const detail = String(e && e.stack || e);
    if (isEnvironmentDenial(detail)) {
      writeSkip({ status: 'skip', reason: 'DSH cannot spawn Electron; Work must run this Stage B test with normal permissions.', error: detail.split('\n').slice(0, 8).join('\n'), checks });
      console.log('SKIP WP10 Stage B Electron:', detail.split('\n')[0]);
    } else {
      writeReport({ status: 'fail', profile: c && c.profile, checks, error: detail, pageExceptions: [] });
      console.error(e);
      process.exitCode = 1;
    }
  } finally {
    if (c) await c.app.close().catch(() => {});
  }
})();

