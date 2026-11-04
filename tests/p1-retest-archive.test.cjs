/* SPDX-License-Identifier: Apache-2.0 */
/* P1 WP06 retest model and WP07 archive validation helpers (no DB writes). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const context = { console, Date, Math, JSON, Number, String, Object, Array, Promise, Map, Set, RegExp, Error, Uint8Array, crypto: globalThis.crypto };
context.window = context; context.globalThis = context;
vm.createContext(context);
for (const file of ['retest-scheduler.js', 'review-archive.js']) vm.runInContext(fs.readFileSync(path.join(root, 'app', file), 'utf8'), context, { filename: file });
const Retest = context.RetestScheduler;
const Archive = context.ReviewArchive;

const externalLog = {
  kind: 'external', status: 'active', source: 'a::b', externalId: 'c::d', date: '2026-11-02',
  module: '判断推理', knowledgePoint: '削弱论证', wrongQuestions: [{
    questionNo: '3::4', knowledgePoint: '削弱论证', primaryCause: '逻辑方向错误',
    secondaryCauses: ['方法选择错误'], method: '先写论点', logicSymbols: 'P→Q', reasoning: '合成推理'
  }]
};
const engine = { wrongs: [{ qid: 'q-stable-1', n: 5, lastWrongDate: '2026-11-02', subject: '数量关系', tags: ['工程问题'], examId: 'exam-1', attempts: [{ attemptId: 'att-1' }] }] };

test('D+1/D+3/D+7 use the real error date and support internal + external identities', () => {
  const origins = Retest.buildOrigins({ studyLogs: [externalLog], engine });
  assert.equal(origins.length, 2);
  const planned = Retest.plan(origins, {});
  assert.equal(planned.tasks.length, 6);
  assert.deepEqual([...new Set(planned.tasks.map(t => t.dueDate))].sort(), ['2026-11-03', '2026-11-05', '2026-11-09']);
  assert.equal(new Set(planned.tasks.map(t => t.reviewKey)).size, 6);
  assert.ok(planned.tasks.some(t => t.retestOrigin.type === 'internal' && t.retestOrigin.questionId === 'q-stable-1'));
  assert.ok(planned.tasks.some(t => t.retestOrigin.type === 'external' && t.retestOrigin.source === 'a::b' && t.retestOrigin.externalId === 'c::d' && t.retestOrigin.questionNo === '3::4'));
  assert.ok(planned.tasks.every(t => t.status === 'pending' && t.mastery === 'unverified'));
  assert.ok(planned.tasks.every(t => t.title.startsWith('D+') && t.retestMode === 'original'));
  const other = Retest.buildOrigins({ studyLogs: [{ ...externalLog, externalId: 'c', source: 'a', date: '2026-11-02' }] });
  assert.notEqual(planned.tasks[0].retestOrigin.externalId, other[0].externalId);
  const sameExternal = Retest.buildOrigins({ studyLogs: [externalLog, { ...externalLog, source: 'a', externalId: 'b::c::d' }] });
  assert.equal(sameExternal.length, 2, 'separator-ambiguous identities must remain distinct');
});

test('internal lastWrongAt converts to Asia/Shanghai at new-plan boundary, independent of host TZ', () => {
  // 2026-11-03 00:00 Asia/Shanghai; on a UTC host the old local dateOf path
  // would produce 2026-11-02, which is exactly the Work counterexample.
  const shanghaiMidnight = Date.UTC(2026, 10, 2, 16, 0, 0);
  const base = {
    qid: 'q-tz-internal', n: 7, subject: '判断推理', tags: ['削弱论证'], examId: 'exam-tz',
    lastWrongDate: '2026-11-02', attempts: [{ attemptId: 'att-tz' }]
  };
  assert.equal(new Date(shanghaiMidnight).toISOString().slice(0, 10), '2026-11-02', 'UTC date is still 11/2');
  const atMidnight = Retest.buildOrigins({ engine: { wrongs: [{ ...base, lastWrongAt: shanghaiMidnight }] } });
  assert.equal(atMidnight.length, 1);
  assert.equal(atMidnight[0].errorDate, '2026-11-03', 'must use Asia/Shanghai, not host local/UTC date');
  assert.equal(atMidnight[0].errorDateSource, Retest.ERROR_DATE_SOURCE.internalTimestamp);
  assert.equal(atMidnight[0].lastWrongAt, shanghaiMidnight);
  assert.deepEqual(
    [...Retest.plan(atMidnight, {}).tasks.map(t => t.dueDate)].sort(),
    ['2026-11-04', '2026-11-06', '2026-11-10']
  );

  const justBefore = Retest.buildOrigins({ engine: { wrongs: [{ ...base, lastWrongAt: shanghaiMidnight - 1 }] } });
  assert.equal(justBefore[0].errorDate, '2026-11-02');
  assert.deepEqual(
    [...Retest.plan(justBefore, {}).tasks.map(t => t.dueDate)].sort(),
    ['2026-11-03', '2026-11-05', '2026-11-09']
  );

  // A timestamp is sufficient even when the host-local lastWrongDate is absent.
  const noHostDate = Retest.buildOrigins({ engine: { wrongs: [{ ...base, lastWrongDate: null, lastWrongAt: shanghaiMidnight }] } });
  assert.equal(noHostDate.length, 1);
  assert.equal(noHostDate[0].errorDate, '2026-11-03');
  assert.equal(noHostDate[0].errorDateSource, Retest.ERROR_DATE_SOURCE.internalTimestamp);

  // Only truly timestamp-less legacy data falls back to the explicit date and
  // is marked as compatibility data; external explicit dates are never shifted.
  const legacy = Retest.buildOrigins({ engine: { wrongs: [{ ...base, lastWrongAt: 0 }] } });
  assert.equal(legacy[0].errorDate, '2026-11-02');
  assert.equal(legacy[0].errorDateSource, Retest.ERROR_DATE_SOURCE.internalLegacyDate);
  const external = Retest.buildOrigins({ studyLogs: [externalLog] })[0];
  assert.equal(external.errorDate, '2026-11-02');
  assert.equal(external.errorDateSource, Retest.ERROR_DATE_SOURCE.externalDate);
  assert.equal(external.lastWrongAt, null);
  assert.equal(Retest.shanghaiDayFromTimestamp('2026-11-02T16:00:00Z'), '2026-11-03');
});

test('generation is idempotent and a later error date is an independent cycle', () => {
  const first = Retest.plan(Retest.buildOrigins({ studyLogs: [externalLog], engine }), {});
  const again = Retest.plan(Retest.buildOrigins({ studyLogs: [externalLog], engine }), { existingTasks: first.tasks });
  assert.equal(again.tasks.length, 0);
  assert.equal(again.skipped, 6);
  const later = Retest.buildOrigins({ studyLogs: [{ ...externalLog, date: '2026-11-04' }] });
  const next = Retest.plan(later, { existingTasks: first.tasks });
  assert.equal(next.tasks.length, 3);
  assert.ok(next.tasks.every(t => t.dueDate >= '2026-11-05' && t.retestOrigin.errorDate === '2026-11-04'));
  assert.ok(next.tasks.every(t => first.tasks.every(old => old.reviewKey !== t.reviewKey)));
});

test('advance, postpone, skip and close keep history; similar validation is explicit and separate', () => {
  const task = Retest.plan(Retest.buildOrigins({ studyLogs: [externalLog] }), {}).tasks[0];
  const postponed = Retest.actionTask(task, 'postpone', { date: '2026-11-06', reason: '当天有事' });
  assert.equal(postponed.dueDate, '2026-11-06');
  assert.equal(postponed.retestHistory.at(-1).action, 'postpone');
  assert.equal(postponed.retestHistory.at(-1).fromDate, '2026-11-03');
  const skipped = Retest.actionTask(task, 'skip', { reason: '先跳过' });
  assert.equal(skipped.reminderStatus, 'skipped');
  assert.equal(skipped.retestHistory.at(-1).action, 'skip');
  const closed = Retest.actionTask(task, 'close', {});
  assert.equal(closed.reminderStatus, 'closed');
  const similar = Retest.similarTask(task.retestOrigin, [task], { interval: 3 });
  assert.equal(similar.retestMode, 'similar');
  assert.notEqual(similar.reviewKey, task.reviewKey);
  assert.equal(Retest.similarTask(task.retestOrigin, [task, similar], { interval: 3 }), null);
  const a = Retest.recordResult(task, { date: '2026-11-03', correctCount: 1, questionCount: 1, note: '原题正确' }, { now: Date.UTC(2026, 10, 3, 2) });
  const b = Retest.recordResult(a, { date: '2026-11-05', correctCount: 0, questionCount: 1, note: '再次错误' }, { now: Date.UTC(2026, 10, 5, 2) });
  assert.equal(b.retestResults.length, 2);
  assert.equal(b.retestResults[0].note, '原题正确');
  assert.equal(b.retestResults[1].note, '再次错误');
  assert.equal(b.mastery, 'unverified', 'one correct answer must not auto-master');
});

test('retest result uses actual Asia/Shanghai completion date, not the planned due date', () => {
  const task = Retest.plan(Retest.buildOrigins({ studyLogs: [externalLog] }), {}).tasks
    .find(t => t.retestInterval === 3);
  // 2026-11-06 10:00 Asia/Shanghai; the D+3 plan was 2026-11-05.
  const now = Date.UTC(2026, 10, 6, 2, 0, 0);
  const late = Retest.recordResult(task, { questionCount: 1, correctCount: 1, note: '晚一天做' }, { now });
  assert.equal(late.dueDate, '2026-11-05', 'planned due date is preserved');
  assert.equal(late.retestResults[0].date, '2026-11-06', 'actual date is the real completion day');
  assert.equal(late.retestResults[0].dueDate, '2026-11-05');
  assert.equal(late.retestResults[0].errorDate, '2026-11-02');
  assert.equal(late.retestResults[0].at, now, 'raw timestamp is preserved');
  assert.equal(late.retestHistory.at(-1).actualDate, '2026-11-06');
  assert.equal(late.retestHistory.at(-1).plannedDate, '2026-11-05');
  assert.equal(late.retestHistory.at(-1).errorDate, '2026-11-02');

  const early = Retest.recordResult(task, { date: '2026-11-04', questionCount: 1, correctCount: 0 }, { now });
  assert.equal(early.retestResults[0].date, '2026-11-04', 'explicit user-supplied actual date is kept');
  assert.equal(early.retestResults[0].dueDate, '2026-11-05');

  assert.throws(() => Retest.recordResult(task, { date: '2026-11-07' }, { now }), /不能晚于今天/);
  assert.throws(() => Retest.recordResult(task, { date: '2026-02-30' }, { now }), /YYYY-MM-DD/);

  // 2026-11-05 17:30 UTC is already 2026-11-06 in Shanghai.
  const boundary = Retest.recordResult(task, {}, { now: Date.UTC(2026, 10, 5, 17, 30, 0) });
  assert.equal(boundary.retestResults[0].date, '2026-11-06');
});

test('archive add is cancelled across the file-read await and maintenance blocks new writes', async () => {
  const meta = { title: '取消测试', date: '2026-11-02' };
  let releaseRead;
  let started = false;
  const pending = Archive.add({
    name: 'cancel.pdf', size: 10,
    arrayBuffer: async () => {
      started = true;
      await new Promise(resolve => { releaseRead = resolve; });
      return new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10, 10]).buffer;
    }
  }, meta).then(
    () => ({ written: true }),
    e => ({ written: false, code: e.code, cancelled: Archive.isCancelled(e), message: e.message })
  );
  for (let i = 0; i < 50 && !started; i++) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(started, true);
  Archive.stopForClear('恢复备份');
  releaseRead();
  const outcome = await pending;
  assert.equal(outcome.written, false);
  assert.equal(outcome.code, 'REVIEW_ARCHIVE_CANCELLED');
  assert.equal(outcome.cancelled, true);
  assert.match(outcome.message, /未写入/);

  // A brand-new write during the destructive maintenance window is rejected.
  const blocked = await Archive.add({ name: 'x.pdf', size: 1, arrayBuffer: async () => new ArrayBuffer(1) }, meta)
    .then(() => ({ written: true }), e => ({ written: false, code: e.code }));
  assert.equal(blocked.written, false);
  assert.equal(blocked.code, 'REVIEW_ARCHIVE_CANCELLED');
  Archive.resumeMaintenance('恢复备份');
});

test('a %PDF header alone is not success: PDF.js rejection happens before any DB write', async () => {
  context.pdfjsLib = { getDocument: () => ({ promise: Promise.reject(new Error('Invalid PDF structure')) }) };
  context.ExamStore = { withDb: () => { throw new Error('DB must not be touched for a bad PDF'); } };
  const bytes = new TextEncoder().encode('%PDF-1.4\nnot really a pdf\n%%EOF');
  await assert.rejects(
    Archive.add({ name: 'bad.pdf', size: bytes.length, arrayBuffer: async () => bytes.buffer }, { title: '坏 PDF', date: '2026-11-02' }),
    /PDF 无法打开|损坏/
  );
  delete context.ExamStore;
  delete context.pdfjsLib;
});

test('archive metadata validates dates/title/points and search matches knowledge and date', () => {
  const meta = Archive.validateMeta({ title: ' 2026-11-02 复盘 ', date: '2026-11-02', topics: ['资料分析'], keywords: ['审题', '估算'], knowledgePoints: ['增长率'] });
  assert.equal(meta.title, '2026-11-02 复盘');
  assert.deepEqual(Array.from(meta.topics), ['资料分析']);
  assert.deepEqual(Array.from(meta.knowledgePoints), ['增长率']);
  assert.throws(() => Archive.validateMeta({ title: 'x', date: '2026-02-30' }), /日期/);
  assert.throws(() => Archive.validateMeta({ title: '', date: '2026-11-02' }), /标题/);
  assert.equal(Archive.matches(meta, { date: '2026-11-02', text: '增长率' }), true);
  assert.equal(Archive.matches(meta, { date: '2026-11-03', text: '增长率' }), false);
  assert.equal(Archive.matches(meta, { text: '审题' }), true);
});
