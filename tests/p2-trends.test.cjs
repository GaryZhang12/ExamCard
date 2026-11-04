/* SPDX-License-Identifier: Apache-2.0 */
/* ExamCard 1.2.0 P2 WP09 pure trend-engine tests.
   No DB, no UI, no host timezone dependency. The same file is run by
   tests/p2-trends-timezone.cjs under UTC/America-Phoenix/Asia-Shanghai. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const context = {
  console, Date, Math, JSON, Number, String, Object, Array, Promise, Map, Set, RegExp, Error,
  Uint8Array, TextEncoder, TextDecoder, isFinite, parseInt, parseFloat, setTimeout, clearTimeout
};
context.window = context; context.globalThis = context;
vm.createContext(context);
for (const file of ['study-log.js', 'trend-engine.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'app', file), 'utf8'), context, { filename: file });
}
const StudyLog = context.StudyLog;
const Trend = context.TrendEngine;
const isEnvironmentDenial = require('./p2-ui-skip-policy.cjs');

const NOW = Date.UTC(2026, 10, 3, 2, 0, 0); // 2026-11-03 10:00 Asia/Shanghai
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/external-practice-2026-11-02.json'), 'utf8'));
const fixture19 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/external-practice-2026-11-02-div19.json'), 'utf8'));

function log(record, id, now, kind) {
  return StudyLog.assertValid(Object.assign({ kind: kind || 'external', id: id }, record), { now: now == null ? 1000 : now });
}
function goldenLogs(now) {
  return fixture.records.map((r, i) => log(r, 'golden-' + i, now == null ? 1000 : now));
}
function correctedDivision() {
  const old = log(fixture19.records[0], 'stable-division', 1000);
  return StudyLog.applyUpdate(old, {
    questionCount: 30, correctCount: 18, durationSeconds: 980, durationMinutes: 980 / 60,
    durationPrecision: 'exact', durationUnit: 'seconds',
    groups: [
      { label: '第一组', questionCount: 10, correctCount: 7, durationSeconds: 235 },
      { label: '第二组', questionCount: 10, correctCount: 6, durationSeconds: 389 },
      { label: '第三组', questionCount: 10, correctCount: 5, durationSeconds: 356 }
    ]
  }, { reason: '历史 19/30 更正为 18/30', now: 2000, expectedRevision: 0 });
}
function gradingRecord(sessionId, attemptId, at, details, config) {
  return {
    attemptId, sessionId, examId: 'exam-trend', examName: '合成诊断试卷', gradedAt: at,
    gradingStatus: 'graded', summary: { total: details.length }, details, config: config || {}
  };
}

test('golden synthetic 2026-11-02: new 30/48=62.5%, comprehensive 15 unknown, essay 7/9', () => {
  const report = Trend.compute({ now: NOW, days: 7, studyLogs: goldenLogs(), learningTasks: [] });
  assert.equal(report.schema, 'examcard.trend-report/v1');
  assert.equal(report.timezone, 'Asia/Shanghai');
  assert.deepEqual(JSON.parse(JSON.stringify(report.window)), {
    days: 7, from: '2026-10-28', to: '2026-11-03',
    startAt: '2026-10-27T16:00:00.000Z', endAtExclusive: '2026-11-03T16:00:00.000Z'
  });
  const n = report.practiceTypes.new;
  assert.equal(n.questions, 48);
  assert.equal(n.known, 48);
  assert.equal(n.correct, 30);
  assert.equal(n.incorrect, 18);
  assert.equal(n.unknownQuestions, 0);
  assert.equal(n.accuracy, 62.5);
  assert.deepEqual([report.practiceTypes.subtotal.questions, report.practiceTypes.subtotal.correct, report.practiceTypes.subtotal.accuracy], [48, 30, 62.5]);
  const comp = report.practiceTypes.comprehensive;
  assert.equal(comp.questions, 15);
  assert.equal(comp.known, 0);
  assert.equal(comp.correct, 0);
  assert.equal(comp.unknownQuestions, 15);
  assert.equal(comp.accuracy, null);
  assert.equal(comp.dataInsufficient, true);
  assert.equal(report.overall.questions, 63);
  assert.equal(report.overall.known, 48);
  assert.equal(report.overall.correct, 30);
  assert.equal(report.overall.incorrect, 18);
  assert.equal(report.overall.unknownQuestions, 15);
  assert.equal(report.overall.accuracy, 62.5);
  const byName = Object.fromEntries(report.modules.map(m => [m.name, m]));
  assert.deepEqual([byName['资料分析'].correct, byName['资料分析'].incorrect, byName['资料分析'].known, byName['资料分析'].accuracy], [5, 1, 6, 83.3]);
  assert.deepEqual([byName['判断推理'].correct, byName['判断推理'].incorrect, byName['判断推理'].known, byName['判断推理'].accuracy], [3, 3, 6, 50]);
  assert.deepEqual([byName['言语理解与表达'].correct, byName['言语理解与表达'].incorrect, byName['言语理解与表达'].known, byName['言语理解与表达'].accuracy], [4, 2, 6, 66.7]);
  assert.deepEqual([byName['数量关系'].correct, byName['数量关系'].incorrect, byName['数量关系'].known, byName['数量关系'].accuracy], [18, 12, 30, 60]);
  assert.equal(report.essays.length, 2, 'every essay score is preserved as its own event');
  assert.deepEqual(Array.from(report.essays, x => x.round + ':' + x.score), ['first:7', 'reevaluation:9']);
  assert.equal(report.sources.essays.activities, 1);
  assert.equal(report.overall.correct, 30, 'essay 9 must never become 9 objective correct answers');
  assert.equal(report.totalDuration.exactSeconds, 980);
  assert.equal(report.perQuestionTime.exact.length, 0);
  assert.ok(report.perQuestionTime.noPerQuestionCount >= 30);
  assert.equal(report.sample.objectiveActivities, 5);
  assert.equal(report.causeSample.events, 6);
  assert.equal(report.causeSample.uncausedIncorrect, 12);
  assert.ok(report.dataNotes.some(n => /980 秒/.test(n)));
  assert.ok(report.dataNotes.some(n => /未知正确数/.test(n)));
});

test('19/30 correction uses only current 18/30 and keeps before=19 audit; soft delete is excluded with audit', () => {
  const old = log(fixture19.records[0], 'stable-division', 1000);
  const next = correctedDivision();
  assert.equal(next.revisions.length, 1);
  assert.equal(next.revisions[0].before.correctCount, 19);
  assert.equal(next.revisions[0].after.correctCount, 18);
  const report = Trend.compute({ now: NOW, days: 7, studyLogs: [old, next], learningTasks: [] });
  assert.equal(report.practiceTypes.new.questions, 30);
  assert.equal(report.practiceTypes.new.correct, 18);
  assert.equal(report.practiceTypes.new.incorrect, 12);
  assert.equal(report.practiceTypes.new.accuracy, 60);
  assert.equal(report.sources.external.duplicatesSuppressed, 1);

  const deletedOld = log({ source: 'fenbi-synthetic', externalId: 'deleted-example', date: '2026-11-02', assessment: 'objective', practiceType: 'new', content: '删除后不统计', questionCount: 5, correctCount: 5 }, 'deleted-1', 3000);
  const deleted = StudyLog.applyDelete(deletedOld, { reason: '合成删除测试', now: 4000, expectedRevision: 0 });
  const withDeleted = Trend.compute({ now: NOW, days: 7, studyLogs: [next, deleted], learningTasks: [] });
  assert.equal(withDeleted.practiceTypes.new.questions, 30);
  assert.equal(withDeleted.sources.external.deletedSuppressed, 1);
  assert.equal(deleted.status, 'deleted');
  assert.equal(deleted.revisions.length, 1);
  assert.equal(deleted.revisions[0].action, 'delete');
});

test('external source+externalId duplicate, plan task actual and wrongKey are counted once', () => {
  const a = log({ source: 'fenbi', externalId: 'dup', date: '2026-11-02', assessment: 'objective', practiceType: 'new', content: '旧', questionCount: 6, correctCount: 5, wrongQuestions: [{ questionNo: '1', primaryCause: '审题错误' }] }, 'dup-a', 1000);
  const b = log({ source: 'fenbi', externalId: 'dup', date: '2026-11-02', assessment: 'objective', practiceType: 'new', content: '新', questionCount: 6, correctCount: 3, wrongQuestions: [{ questionNo: '1', primaryCause: '审题错误' }] }, 'dup-b', 2000);
  const linked = log({ source: 'fenbi', externalId: 'linked', date: '2026-11-02', assessment: 'objective', practiceType: 'new', content: '计划关联活动', questionCount: 2, correctCount: 1, taskId: 'task-1' }, 'linked-1', 2000);
  const task = { id: 'task-1', type: 'questions', date: '2026-11-02', status: 'completed', actualMinutes: 99, actualQuestions: 50, actualCorrect: 40 };
  const report = Trend.compute({ now: NOW, days: 7, studyLogs: [a, b, linked], learningTasks: [task] });
  assert.equal(report.practiceTypes.new.questions, 8, '6 duplicate rows count once + 2 linked activity');
  assert.equal(report.practiceTypes.new.correct, 4);
  assert.equal(report.practiceTypes.new.incorrect, 4);
  assert.equal(report.sources.external.duplicatesSuppressed, 1);
  assert.equal(report.sources.external.activities, 2);
  assert.equal(report.sources.external.planLinkedActivities, 1);
  assert.equal(report.causeSample.events, 1, 'same wrongKey must not be counted twice');
  assert.equal(report.causes.find(c => c.cause === '审题错误').events, 1);
});

test('980 seconds is total duration only; exact/estimated/unknown layers stay separate', () => {
  const exact = log({ source: 'fenbi-synthetic', externalId: 'exact-980', date: '2026-11-02', assessment: 'objective', practiceType: 'new', content: '980 秒活动', questionCount: 30, correctCount: 18, durationSeconds: 980, durationPrecision: 'exact', durationUnit: 'seconds' }, 'exact-980', 1000);
  const estimated = log({ source: 'fenbi-synthetic', externalId: 'estimated-300', date: '2026-11-02', assessment: 'objective', practiceType: 'new', content: '估算活动', questionCount: 10, correctCount: 5, durationSeconds: 300, durationPrecision: 'estimated', durationUnit: 'seconds' }, 'estimated-300', 1000);
  const unknown = log({ source: 'fenbi-synthetic', externalId: 'unknown-12', date: '2026-11-02', assessment: 'objective', practiceType: 'new', content: '未知用时活动', questionCount: 12, correctCount: 6, durationPrecision: 'unknown' }, 'unknown-12', 1000);
  const software = gradingRecord('s-time', 'att-time', Date.UTC(2026, 10, 2, 2), [
    { question_id: 1, subject: '数量关系', grading_status: 'correct', is_correct: true, elapsed_seconds: 10 },
    { question_id: 2, subject: '数量关系', grading_status: 'correct', is_correct: true, elapsed_seconds: 20 },
    { question_id: 3, subject: '数量关系', grading_status: 'incorrect', is_correct: false, elapsed_seconds: 30 },
    { question_id: 4, subject: '数量关系', grading_status: 'unanswered', is_correct: null }
  ], { mode: 'practice' });
  const report = Trend.compute({ now: NOW, days: 7, studyLogs: [exact, estimated, unknown], gradingRecords: [software], learningTasks: [] });
  assert.equal(report.totalDuration.exactSeconds, 1040, '980 external exact + 60 internal exact');
  assert.equal(report.totalDuration.estimatedSeconds, 300);
  assert.equal(report.perQuestionTime.exact.length, 3);
  assert.deepEqual(Array.from(report.perQuestionTime.exact, x => x.elapsedSeconds), [10, 20, 30]);
  assert.equal(report.perQuestionTime.exactSummary.p50Seconds, 20);
  assert.equal(report.perQuestionTime.exactSummary.p90Seconds, 30);
  assert.equal(report.perQuestionTime.estimated.length, 1);
  assert.equal(report.perQuestionTime.estimated[0].secondsPerQuestion, 30);
  assert.equal(report.perQuestionTime.estimated[0].questionCount, 10);
  assert.equal(report.perQuestionTime.estimated[0].sampleKind, 'activity-average');
  assert.equal(report.perQuestionTime.noPerQuestionCount, 30 + 10 + 12 + 1, '980s/30, estimated/10, unknown/12 and one missing internal elapsed');
  assert.equal(report.perQuestionTime.unknownCount, 13);
  assert.equal(report.perQuestionTime.dataInsufficient, false);
  assert.equal(report.totalDuration.unknownActivities, 1);
  assert.equal(report.overall.unknownQuestions, 1, 'unknown time must not make correct status unknown; only unanswered internal event is unknown');
});

test('essay first/reevaluation stay independent and never enter objective denominator', () => {
  const essay = log({ source: 'fenbi-synthetic', externalId: 'essay-7-9', date: '2026-11-02', assessment: 'essay', module: '申论', content: '申论首次与复评', durationPrecision: 'unknown', essayScores: [{ round: 'first', score: 7, maxScore: 10 }, { round: 'reevaluation', score: 9, maxScore: 10 }] }, 'essay-1', 1000);
  const objective = log({ source: 'fenbi-synthetic', externalId: 'obj-2', date: '2026-11-02', assessment: 'objective', practiceType: 'new', content: '客观 2 题', questionCount: 2, correctCount: 2 }, 'obj-1', 1000);
  const report = Trend.compute({ now: NOW, days: 7, studyLogs: [essay, objective], learningTasks: [] });
  assert.equal(report.practiceTypes.new.questions, 2);
  assert.equal(report.practiceTypes.new.correct, 2);
  assert.equal(report.overall.correct, 2);
  assert.equal(report.essays.length, 2);
  assert.deepEqual(Array.from(report.essays, x => x.round + ':' + x.score), ['first:7', 'reevaluation:9']);
  assert.equal(report.essays[0].dataInsufficient, false);
  assert.equal(report.essays[0].roundSource, 'explicit');
  const invalidRaw = {
    kind: 'external', id: 'essay-bad', source: 'fenbi-synthetic', externalId: 'essay-invalid',
    date: '2026-11-02', assessment: 'essay', module: '申论', content: '坏评分', status: 'active',
    essayScores: [{ round: 'first', score: null, maxScore: 10 }]
  };
  const bad = Trend.compute({ now: NOW, days: 7, studyLogs: [invalidRaw], learningTasks: [] });
  assert.equal(bad.essays[0].score, null);
  assert.equal(bad.essays[0].maxScore, null);
  assert.equal(bad.essays[0].rawScore, null);
  assert.equal(bad.essays[0].dataInsufficient, true);
  assert.equal(bad.overall.correct, 0);
});

test('retest D+1/3/7 uses actual result dates, separates original/similar and never fabricates mastery', () => {
  const tasks = [
    { id: 't1', type: 'retest', retestMode: 'original', retestInterval: 1, dueDate: '2026-11-03', date: '2026-11-03', retestOrigin: { errorDate: '2026-11-02' }, reminderStatus: 'active', mastery: 'unverified', retestResults: [{ at: Date.UTC(2026, 10, 3, 2), date: '2026-11-03', dueDate: '2026-11-03', errorDate: '2026-11-02', mode: 'original', correctCount: 1, questionCount: 1 }] },
    { id: 't2', type: 'retest', retestMode: 'similar', retestInterval: 3, dueDate: '2026-11-05', date: '2026-11-05', retestOrigin: { errorDate: '2026-11-02' }, reminderStatus: 'active', mastery: 'unverified', retestResults: [{ at: Date.UTC(2026, 10, 5, 2), date: '2026-11-05', mode: 'similar', correctCount: 0, questionCount: 1 }] },
    { id: 't3', type: 'retest', retestMode: 'original', retestInterval: 7, dueDate: '2026-11-09', date: '2026-11-09', retestOrigin: { errorDate: '2026-11-02' }, reminderStatus: 'skipped', mastery: 'unverified', retestResults: [] },
    { id: 't4', type: 'retest', retestMode: 'original', retestInterval: 1, dueDate: '2026-11-03', date: '2026-11-03', retestOrigin: { errorDate: '2026-11-02' }, reminderStatus: 'active', mastery: 'unverified', retestResults: [{ date: '2026-11-05', mode: 'original', correctCount: 1, questionCount: 1 }, { dueDate: '2026-11-03', mode: 'original', correctCount: 1, questionCount: 1 }] }
  ];
  const report = Trend.compute({ now: Date.UTC(2026, 10, 6, 2), days: 7, studyLogs: [], learningTasks: tasks });
  assert.equal(report.retest.intervals.d1.planned, 2);
  assert.equal(report.retest.intervals.d1.results.length, 2);
  assert.deepEqual(Array.from(report.retest.intervals.d1.results, r => r.date), ['2026-11-03', '2026-11-05'], 'actual date is kept, not dueDate');
  assert.equal(report.retest.intervals.d3.results[0].date, '2026-11-05');
  assert.equal(report.retest.intervals.d7.results.length, 0);
  assert.equal(report.retest.byMode.original.results, 2);
  assert.equal(report.retest.byMode.similar.results, 1);
  assert.equal(report.retest.byMode.similar.accuracy, 0);
  assert.equal(report.retest.results.some(r => r.taskId === 't3'), false, 'skipped/planned task must not create a result');
  assert.equal(report.sources.retestTasks.missingResultDates, 1);
  assert.equal(report.retest.mastery, 'unverified');
  assert.equal(report.retest.results.every(r => r.mastery === 'unverified'), true);
  assert.equal(report.retest.results[0].dueDate, '2026-11-03');
  assert.equal(report.retest.results[0].errorDate, '2026-11-02');
});

test('empty and small samples return null accuracy and explicit dataInsufficient, not 0%/100%', () => {
  const empty = Trend.compute({ now: NOW, days: 7, studyLogs: [], learningTasks: [] });
  assert.equal(empty.overall.known, 0);
  assert.equal(empty.overall.accuracy, null);
  assert.equal(empty.overall.dataInsufficient, true);
  assert.equal(empty.modules.length, 0);
  assert.equal(empty.perQuestionTime.exactSummary.count, 0);
  assert.equal(empty.perQuestionTime.exactSummary.dataInsufficient, true);
  assert.equal(empty.retest.dataInsufficient, true);
  const small = log({ source: 'fenbi', externalId: 'small', date: '2026-11-02', assessment: 'objective', practiceType: 'new', content: '小样本', questionCount: 2, correctCount: 1 }, 'small', 1000);
  const report = Trend.compute({ now: NOW, days: 7, studyLogs: [small], learningTasks: [] });
  assert.equal(report.modules[0].known, 2);
  assert.equal(report.modules[0].accuracy, 50);
  assert.equal(report.modules[0].dataInsufficient, true);
  assert.equal(report.practiceTypes.new.accuracy, 50);
});

test('Shanghai boundary 15:59:59.999Z vs 16:00:00Z and 1/2-day windows', () => {
  const before = gradingRecord('s-before', 'att-before', Date.parse('2026-11-02T15:59:59.999Z'), [
    { question_id: 1, subject: '资料分析', grading_status: 'correct', is_correct: true, elapsed_seconds: 1 }
  ], { mode: 'practice' });
  const after = gradingRecord('s-after', 'att-after', Date.parse('2026-11-02T16:00:00Z'), [
    { question_id: 1, subject: '资料分析', grading_status: 'correct', is_correct: true, elapsed_seconds: 1 }
  ], { mode: 'practice' });
  assert.equal(Trend.shanghaiDateOf('2026-11-02T15:59:59.999Z'), '2026-11-02');
  assert.equal(Trend.shanghaiDateOf('2026-11-02T16:00:00Z'), '2026-11-03');
  const one = Trend.compute({ now: NOW, days: 1, gradingRecords: [before, after], learningTasks: [] });
  assert.equal(one.overall.activities, 1);
  assert.equal(one.perQuestionTime.exact[0].activityId, 'software:s-after');
  assert.equal(one.window.startAt, '2026-11-02T16:00:00.000Z');
  const two = Trend.compute({ now: NOW, days: 2, gradingRecords: [before, after], learningTasks: [] });
  assert.equal(two.overall.activities, 2);
  assert.deepEqual(Array.from(two.perQuestionTime.exact, x => x.date).sort(), ['2026-11-02', '2026-11-03']);
});

test('7/14/30 windows do not mix old samples; host TZ is irrelevant', () => {
  const recent = log({ source: 'fenbi', externalId: 'recent-essay', date: '2026-11-02', assessment: 'essay', content: '近期申论', durationPrecision: 'unknown', essayScores: [{ round: 'first', score: 7, maxScore: 10 }] }, 'recent', 1000);
  const old = log({ source: 'fenbi', externalId: 'old-essay', date: '2026-10-20', assessment: 'essay', content: '旧申论', durationPrecision: 'unknown', essayScores: [{ round: 'first', score: 8, maxScore: 10 }] }, 'old', 1000);
  const w7 = Trend.compute({ now: NOW, days: 7, studyLogs: [recent, old], learningTasks: [] });
  const w14 = Trend.compute({ now: NOW, days: 14, studyLogs: [recent, old], learningTasks: [] });
  const w30 = Trend.compute({ now: NOW, days: 30, studyLogs: [recent, old], learningTasks: [] });
  assert.deepEqual([w7.essays.length, w14.essays.length, w30.essays.length], [1, 1, 2]);
  assert.deepEqual([w7.window.from, w14.window.from, w30.window.from], ['2026-10-28', '2026-10-21', '2026-10-05']);
  assert.equal(w7.window.to, '2026-11-03');
  assert.equal(w30.essays.find(e => e.score === 8).date, '2026-10-20');
  assert.equal(Object.prototype.hasOwnProperty.call(w7, 'hostTimezone'), false);
});

test('same session uses only latest graded snapshot; unanswered/unverified are unknown, not incorrect', () => {
  const r1 = gradingRecord('s1', 'r1', Date.UTC(2026, 10, 2, 1), [
    { question_id: 1, subject: '判断推理', grading_status: 'correct', is_correct: true, elapsed_seconds: 10 },
    { question_id: 2, subject: '判断推理', grading_status: 'incorrect', is_correct: false, elapsed_seconds: 20 },
    { question_id: 3, subject: '判断推理', grading_status: 'unverified', is_correct: null, elapsed_seconds: 30 }
  ], { mode: 'practice' });
  const r2 = gradingRecord('s1', 'r2', Date.UTC(2026, 10, 2, 2), [
    { question_id: 1, subject: '判断推理', grading_status: 'correct', is_correct: true, elapsed_seconds: 5 },
    { question_id: 2, subject: '判断推理', grading_status: 'unverified', is_correct: null, elapsed_seconds: 5 },
    { question_id: 3, subject: '判断推理', grading_status: 'unanswered', is_correct: null, elapsed_seconds: 0 }
  ], { mode: 'practice' });
  const r3 = { attemptId: 'r3', sessionId: 's1', examId: 'exam-trend', gradedAt: Date.UTC(2026, 10, 2, 3), gradingStatus: 'ungraded', summary: null, details: [] };
  const report = Trend.compute({ now: NOW, days: 7, gradingRecords: [r1, r2, r3], sessions: [], learningTasks: [] });
  assert.equal(report.overall.activities, 1);
  assert.equal(report.overall.questions, 3);
  assert.equal(report.overall.correct, 1);
  assert.equal(report.overall.incorrect, 0);
  assert.equal(report.overall.unknownQuestions, 2);
  assert.equal(report.overall.accuracy, 100);
  assert.equal(report.sources.software.suppressedSnapshots, 1);
  assert.equal(report.totalDuration.exactSeconds, 10, 'r1 60 seconds must not be added; unanswered 0s is unknown');
  assert.deepEqual(Array.from(report.perQuestionTime.exact, x => x.elapsedSeconds), [5, 5]);
  assert.equal(report.perQuestionTime.noPerQuestionCount, 1);
  assert.equal(report.perQuestionTime.unknownCount, 1);
  assert.equal(report.modules[0].dataInsufficient, true, 'known 1 < 5');
});

test('1.1 bank history keeps bankQuestionId, unknown correct and real elapsedMs; v5 unavailable is explicit', () => {
  const bank = {
    available: true,
    attempts: [{
      id: 'ba1', sessionId: 'ba1', practiceSetId: 'ps1', submittedAt: Date.UTC(2026, 10, 2, 2),
      results: [
        { bankQuestionId: 'bq1', correct: true, elapsedMs: 12000, tags: ['除法'] },
        { bankQuestionId: 'bq2', correct: null, elapsedMs: 30000, tags: ['除法'] }
      ], graded: 1, correct: 1
    }],
    sets: [{ id: 'ps1', mode: 'wrong', questions: [{ id: 'bq1', module: '数量关系', tags: ['除法'] }, { id: 'bq2', module: '数量关系', tags: ['除法'] }] }],
    questions: []
  };
  const report = Trend.compute({ now: NOW, days: 7, bank, studyLogs: [], learningTasks: [] });
  assert.equal(report.overall.questions, 2);
  assert.equal(report.overall.correct, 1);
  assert.equal(report.overall.incorrect, 0);
  assert.equal(report.overall.unknownQuestions, 1);
  assert.equal(report.overall.accuracy, 100);
  assert.equal(report.practiceTypes.retest.questions, 2);
  assert.equal(report.perQuestionTime.exact.length, 2);
  assert.deepEqual(Array.from(report.perQuestionTime.exact, x => x.bankQuestionId), ['bq1', 'bq2']);
  assert.deepEqual(Array.from(report.perQuestionTime.exact, x => x.questionId), [null, null]);
  assert.deepEqual(Array.from(report.perQuestionTime.exact, x => x.elapsedSeconds), [12, 30]);
  assert.equal(report.sources.bank.available, true);
  assert.equal(report.sources.bank.activities, 1);
  assert.equal(report.sources.bank.attempts, 1);

  const unavailable = Trend.compute({ now: NOW, days: 7, bank: { available: false, reason: '题库尚未升级到 v6/28（v5/22）' }, studyLogs: [], learningTasks: [] });
  assert.equal(unavailable.sources.bank.available, false);
  assert.match(unavailable.sources.bank.reason, /v5\/22/);
  assert.equal(unavailable.overall.activities, 0);
  assert.ok(unavailable.dataNotes.some(n => /题库不可用/.test(n)));
});

test('PDF question_id and bankQuestionId with the same text remain separate identities', () => {
  const software = gradingRecord('s-same', 'att-same', Date.UTC(2026, 10, 2, 2), [
    { question_id: 'bq1', subject: '数量关系', grading_status: 'correct', is_correct: true, elapsed_seconds: 5 }
  ], { mode: 'practice' });
  const bank = { available: true, attempts: [{ id: 'ba-same', sessionId: 'ba-same', practiceSetId: 'ps-same', submittedAt: Date.UTC(2026, 10, 2, 2), results: [{ bankQuestionId: 'bq1', correct: true, elapsedMs: 6000, tags: ['除法'] }] }], sets: [{ id: 'ps-same', mode: 'mock', questions: [{ id: 'bq1', module: '数量关系', tags: ['除法'] }] }], questions: [] };
  const report = Trend.compute({ now: NOW, days: 7, gradingRecords: [software], bank, learningTasks: [] });
  assert.equal(report.overall.activities, 2);
  assert.equal(report.overall.questions, 2);
  assert.equal(report.practiceTypes.new.questions, 1);
  assert.equal(report.practiceTypes.mock.questions, 1);
  assert.equal(report.perQuestionTime.exact.length, 2);
  assert.equal(report.perQuestionTime.exact.filter(x => x.source === 'software' && x.questionId === 'bq1').length, 1);
  assert.equal(report.perQuestionTime.exact.filter(x => x.source === 'bank' && x.bankQuestionId === 'bq1').length, 1);
});

test('load reads v5 without forcing upgrade and reads v6 bank through read-only transactions', async () => {
  let version = 5;
  let transactions = 0;
  const emptyStores = { bankAttempts: [], practiceSets: [], bankQuestions: [] };
  const v6Stores = {
    bankAttempts: [{ id: 'ba-load', sessionId: 'ba-load', practiceSetId: 'ps-load', submittedAt: Date.UTC(2026, 10, 2, 2), results: [{ bankQuestionId: 'bq-load', correct: true, elapsedMs: 9000, tags: ['除法'] }] }],
    practiceSets: [{ id: 'ps-load', mode: 'wrong', questions: [{ id: 'bq-load', module: '数量关系', tags: ['除法'] }] }],
    bankQuestions: []
  };
  context.DiagnosisStore = {
    getAllGradingRecords: async () => [],
    getAllExams: async () => [],
    listTags: async () => [],
    getAllQuestionTags: async () => [],
    getAllSessions: async () => [],
    listStudyLogs: async () => [],
    getAllEssayReviews: async () => [],
    getAllEssaySessions: async () => [],
    getAllEssayExams: async () => []
  };
  context.LearningStore = { listTasks: async () => [] };
  context.ExamStore = {
    open: async () => ({
      version,
      objectStoreNames: { contains: name => Object.prototype.hasOwnProperty.call(version === 6 ? v6Stores : emptyStores, name) },
      transaction: (names) => {
        transactions++;
        if (version !== 6) throw new Error('v5 must not open a bank transaction');
        return {
          objectStore: (name) => ({
            getAll: () => {
              const req = {};
              setTimeout(() => { req.result = v6Stores[name]; if (req.onsuccess) req.onsuccess(); }, 0);
              return req;
            }
          })
        };
      }
    })
  };
  const v5 = await Trend.load({ now: NOW, days: 7 });
  assert.equal(v5.sources.bank.available, false);
  assert.match(v5.sources.bank.reason, /v5\/22/);
  assert.equal(transactions, 0, 'v5 load must not open bank stores or call an upgrade');
  version = 6;
  const v6 = await Trend.load({ now: NOW, days: 7 });
  assert.equal(v6.sources.bank.available, true);
  assert.equal(v6.sources.bank.activities, 1);
  assert.equal(v6.perQuestionTime.exact[0].bankQuestionId, 'bq-load');
  assert.equal(v6.perQuestionTime.exact[0].elapsedSeconds, 9);
  assert.ok(transactions > 0);
});

test('bank random/unseen/weak are intent modes, not evidence of new questions; first/repeat uses all history', () => {
  const bank = {
    available: true,
    attempts: [
      { id: 'a1', sessionId: 'a1', practiceSetId: 'ps1', submittedAt: Date.UTC(2026, 10, 2, 1), results: [{ bankQuestionId: 'q', correct: true, elapsedMs: 1000, selected: 'A' }] },
      { id: 'a2', sessionId: 'a2', practiceSetId: 'ps2', submittedAt: Date.UTC(2026, 10, 2, 2), results: [{ bankQuestionId: 'q', correct: false, elapsedMs: null, selected: 'B' }] }
    ],
    sets: [{ id: 'ps1', mode: 'unseen', questions: [{ id: 'q', module: '数量关系' }] }, { id: 'ps2', mode: 'unseen', questions: [{ id: 'q', module: '数量关系' }] }],
    questions: []
  };
  const report = Trend.compute({ now: NOW, days: 7, bank, studyLogs: [], learningTasks: [] });
  assert.equal(report.practiceTypes.new.activities, 0, 'unseen mode must not be called new');
  assert.equal(report.practiceTypes.unclassified.questions, 2);
  assert.equal(report.practiceTypes.unclassified.correct, 1);
  assert.equal(report.questionHistory.first.questions, 1);
  assert.equal(report.questionHistory.first.correct, 1);
  assert.equal(report.questionHistory.repeat.questions, 1);
  assert.equal(report.questionHistory.repeat.correct, 0);
  assert.equal(report.questionHistory.repeat.incorrect, 1);
  assert.equal(report.perQuestionTime.exact.length, 1, 'null elapsedMs must not become a 0-second exact sample');
  assert.equal(report.sources.bank.modes.unseen, 2);
});

test('window-out prior bank history and mixed shared-material groups classify per question', () => {
  const out = {
    available: true,
    attempts: [
      { id: 'old', sessionId: 'old', practiceSetId: 'old-set', submittedAt: Date.UTC(2026, 9, 20, 2), results: [{ bankQuestionId: 'q1', correct: true, elapsedMs: 1000, selected: 'A' }] },
      { id: 'now', sessionId: 'now', practiceSetId: 'mix', submittedAt: Date.UTC(2026, 10, 2, 2), results: [
        { bankQuestionId: 'q1', correct: false, elapsedMs: 2000, selected: 'B' },
        { bankQuestionId: 'q2', correct: true, elapsedMs: 3000, selected: 'A' }
      ] }
    ],
    sets: [{ id: 'mix', mode: 'wrong', questions: [{ id: 'q1', module: '判断推理' }, { id: 'q2', module: '判断推理' }] }],
    questions: []
  };
  const report = Trend.compute({ now: NOW, days: 7, bank: out, studyLogs: [], learningTasks: [] });
  assert.equal(report.overall.activities, 1, 'old attempt is outside the window');
  assert.equal(report.overall.questions, 2);
  assert.equal(report.questionHistory.first.questions, 1, 'q2 is first-time even in a wrong-group');
  assert.equal(report.questionHistory.repeat.questions, 1, 'q1 was done before the window');
  assert.equal(report.practiceTypes.retest.questions, 2, 'the group intent stays retest');
  assert.equal(report.questionHistory.repeat.correct, 0);
});

test('internal stable question history uses sessions outside the window; unanswered stays unknown', () => {
  const exam = { id: 'exam-h', questions: [{ n: 1, questionId: 'stable-q' }] };
  const old = gradingRecord('s-old', 'att-old', Date.UTC(2026, 9, 20, 2), [
    { question_id: 1, subject: '判断推理', grading_status: 'correct', is_correct: true, elapsed_seconds: 5 }
  ], { mode: 'practice' });
  const current = gradingRecord('s-now', 'att-now', Date.UTC(2026, 10, 2, 2), [
    { question_id: 1, subject: '判断推理', grading_status: 'unanswered', is_correct: null, elapsed_seconds: 0 }
  ], { mode: 'practice' });
  const report = Trend.compute({ now: NOW, days: 7, gradingRecords: [old, current], exams: [exam], sessions: [], learningTasks: [] });
  assert.equal(report.overall.activities, 1);
  assert.equal(report.questionHistory.first.questions, 0);
  assert.equal(report.questionHistory.repeat.questions, 1);
  assert.equal(report.questionHistory.repeat.unknownQuestions, 1);
  assert.equal(report.overall.incorrect, 0, 'unanswered is not incorrect');
  assert.equal(report.perQuestionTime.exact.length, 0, 'unanswered 0 seconds is unknown');
});

test('nullable bank elapsed, retest score/max and essay score never become 0; real 0 is preserved', () => {
  const bank = {
    available: true,
    attempts: [{ id: 'ba-zero', sessionId: 'ba-zero', practiceSetId: 'ps-zero', submittedAt: Date.UTC(2026, 10, 2, 2), results: [
      { bankQuestionId: 'q-null', correct: true, elapsedMs: null, selected: 'A' },
      { bankQuestionId: 'q-empty', correct: true, elapsedMs: '', selected: 'A' },
      { bankQuestionId: 'q-bool', correct: true, elapsedMs: false, selected: 'A' },
      { bankQuestionId: 'q-arr', correct: true, elapsedMs: [], selected: 'A' },
      { bankQuestionId: 'q-arr0', correct: true, elapsedMs: [0], selected: 'A' },
      { bankQuestionId: 'q-zero', correct: true, elapsedMs: 0, selected: 'A' }
    ] }],
    sets: [{ id: 'ps-zero', mode: 'mock', questions: [
      { id: 'q-null', module: '数量关系' }, { id: 'q-empty', module: '数量关系' },
      { id: 'q-bool', module: '数量关系' }, { id: 'q-arr', module: '数量关系' },
      { id: 'q-arr0', module: '数量关系' }, { id: 'q-zero', module: '数量关系' }
    ] }],
    questions: []
  };
  const tasks = [{ id: 't-zero', type: 'retest', retestInterval: 1, dueDate: '2026-11-02', date: '2026-11-02', retestResults: [
    { date: '2026-11-02', mode: 'original', correctCount: 1, questionCount: 1, score: null, maxScore: null },
    { date: '2026-11-02', mode: 'original', correctCount: 1, questionCount: 1, score: 0, maxScore: 10 },
    { date: '2026-11-02', mode: 'original', correctCount: 1, questionCount: 1, score: 0, maxScore: 0 }
  ] }];
  const essay = {
    kind: 'external', id: 'essay-zero', source: 'fenbi', externalId: 'essay-zero', date: '2026-11-02',
    assessment: 'essay', status: 'active', module: '申论', content: '零分与未知',
    essayScores: [
      { round: 'first', score: 0, maxScore: 10 },
      { round: 'reevaluation', score: null, maxScore: '' },
      { round: 'additional', score: false, maxScore: 10 },
      { round: 'additional', score: [], maxScore: 10 },
      { round: 'additional', score: 0, maxScore: 0 }
    ]
  };
  const report = Trend.compute({ now: NOW, days: 7, bank, learningTasks: tasks, studyLogs: [essay] });
  assert.equal(report.perQuestionTime.exact.length, 1);
  assert.equal(report.perQuestionTime.exact[0].bankQuestionId, 'q-zero');
  assert.equal(report.perQuestionTime.exact[0].elapsedSeconds, 0);
  assert.equal(report.perQuestionTime.noPerQuestionCount, 5);
  assert.equal(report.retest.results[0].score, null);
  assert.equal(report.retest.results[0].maxScore, null);
  assert.equal(report.retest.results[1].score, 0);
  assert.equal(report.retest.results[1].maxScore, 10);
  assert.equal(report.retest.results[2].score, null);
  assert.equal(report.retest.results[2].maxScore, null);
  assert.deepEqual(Array.from(report.essays, e => [e.round, e.score, e.maxScore, e.dataInsufficient]), [
    ['first', 0, 10, false], ['reevaluation', null, null, true], ['additional', null, null, true],
    ['additional', null, null, true], ['additional', null, null, true]
  ]);
  assert.equal(report.essays[4].rawScore, 0);
  assert.equal(report.essays[4].rawMaxScore, 0);
});

test('internal essayReviews are preserved with import-order rounds; >2 scores, cross-source separation and window filtering', () => {
  const t = Date.UTC(2026, 10, 2, 2);
  const reviews = [
    { id: 'r1', sessionId: 's1', examId: 'e1', importedAt: t, overall: { totalScore: 7, maxScore: 10, summary: 'first' } },
    { id: 'r2', sessionId: 's1', examId: 'e1', importedAt: t + 3600000, overall: { totalScore: 9, maxScore: 10, summary: 'second' } },
    { id: 'r3', sessionId: 's1', examId: 'e1', importedAt: t + 7200000, overall: { totalScore: 8, maxScore: 10, summary: 'third' } },
    { id: 'old-r', sessionId: 's1', examId: 'e1', importedAt: Date.UTC(2026, 9, 20, 2), overall: { totalScore: 6, maxScore: 10, summary: 'old' } }
  ];
  const sessions = [{ id: 's1', examId: 'e1' }];
  const exams = [{ id: 'e1', title: '合成内部申论' }];
  const report = Trend.compute({ now: NOW, days: 30, essayReviews: reviews, essaySessions: sessions, essayExams: exams, studyLogs: [], learningTasks: [] });
  assert.equal(report.essays.length, 4);
  assert.deepEqual(Array.from(report.essays, e => [e.reviewId, e.round, e.roundSource, e.score]), [
    ['old-r', 'first', 'import-order', 6], ['r1', 'reevaluation', 'import-order', 7],
    ['r2', 'additional', 'import-order', 9], ['r3', 'additional', 'import-order', 8]
  ]);
  assert.equal(report.sources.essays.internalReviews, 4);
  assert.equal(report.sources.essays.activities, 1);
  assert.equal(report.sample.essayScores, 4);
  const w7 = Trend.compute({ now: NOW, days: 7, essayReviews: reviews, essaySessions: sessions, essayExams: exams, studyLogs: [], learningTasks: [] });
  assert.equal(w7.essays.length, 3);
  assert.equal(w7.essays.every(e => e.reviewId !== 'old-r'), true);

  const external = log({ source: 'fenbi', externalId: 'ext-essay', date: '2026-11-02', assessment: 'essay', content: '外部申论', essayScores: [{ round: 'first', score: 7, maxScore: 10 }, { round: 'reevaluation', score: 9, maxScore: 10 }] }, 'ext-1', 1000);
  const mixed = Trend.compute({ now: NOW, days: 7, essayReviews: reviews.slice(0, 2), essaySessions: sessions, essayExams: exams, studyLogs: [external], learningTasks: [] });
  assert.equal(mixed.sources.essays.internalReviews, 2);
  assert.equal(mixed.sources.essays.externalScores, 2);
  assert.equal(mixed.sources.essays.crossSourceUncertain, true);
  assert.equal(mixed.essays.filter(e => e.source === 'internal').length, 2);
  assert.equal(mixed.essays.filter(e => e.source === 'external').length, 2);
  assert.equal(mixed.overall.correct, 0, 'essays never enter objective denominator');
});

test('activity logId is not a per-score identity: preserve every internal review; only exact score refs dedupe', () => {
  const external = log({ source: 'fenbi', externalId: 'linked-essay', date: '2026-11-02', assessment: 'essay', content: '外部申论', createdAt: Date.UTC(2026, 10, 2, 1), essayScores: [{ round: 'first', score: 7, maxScore: 10 }] }, 'ext-link', Date.UTC(2026, 10, 2, 2));
  const linkedReviews = [
    { id: 'ir1', sessionId: 's-link', examId: 'e-link', logId: 'ext-link', importedAt: Date.UTC(2026, 10, 2, 3), overall: { totalScore: 7, maxScore: 10 } },
    { id: 'ir2', sessionId: 's-link', examId: 'e-link', logId: 'ext-link', importedAt: Date.UTC(2026, 10, 2, 4), overall: { totalScore: 9, maxScore: 10 } }
  ];
  const linked = Trend.compute({ now: NOW, days: 7, essayReviews: linkedReviews, essaySessions: [{ id: 's-link', examId: 'e-link' }], essayExams: [{ id: 'e-link', title: '同活动' }], studyLogs: [external], learningTasks: [] });
  assert.equal(linked.essays.length, 3, 'external 7 plus internal 7 and 9 must all survive');
  assert.deepEqual(Array.from(linked.essays, e => e.source + ':' + e.score), ['external:7', 'internal:7', 'internal:9']);
  assert.equal(linked.essays.filter(e => e.score === 9).length, 1, 'later internal review must not disappear');
  assert.equal(linked.sources.essays.internalReviews, 2);
  assert.equal(linked.sources.essays.linkedActivityReviews, 2);
  assert.equal(linked.sources.essays.exactScoreDeduped, 0);
  assert.equal(linked.sources.essays.crossSourceUncertain, true);
  assert.equal(linked.essays.filter(e => e.source === 'internal').every(e => e.identityNote === 'activity-link-only-not-score-identity'), true);

  // A verifiable per-score external ID is a different case and may dedupe.
  const externalRaw = {
    kind: 'external', id: 'ext-exact', source: 'fenbi', externalId: 'ext-exact-id', date: '2026-11-02',
    assessment: 'essay', status: 'active', content: '外部精确评分',
    essayScores: [{ round: 'first', score: 7, maxScore: 10, scoreId: 'score-7' }]
  };
  const exactReview = { id: 'ir-exact', sessionId: 's-exact', examId: 'e-exact', logId: 'ext-exact', externalScoreId: 'score-7', importedAt: Date.UTC(2026, 10, 2, 3), overall: { totalScore: 7, maxScore: 10 } };
  const exact = Trend.compute({ now: NOW, days: 7, essayReviews: [exactReview], essaySessions: [{ id: 's-exact', examId: 'e-exact' }], essayExams: [{ id: 'e-exact', title: '同评分' }], studyLogs: [externalRaw], learningTasks: [] });
  assert.equal(exact.essays.length, 1);
  assert.equal(exact.sources.essays.exactScoreDeduped, 1);
  assert.equal(exact.sources.essays.internalReviews, 0);

  // Partial external snapshot + internal reviews across windows: the 7-day
  // window keeps the later internal 9 even when the external 7 is outside.
  const oldReview = Object.assign({}, linkedReviews[0], { id: 'ir-old', importedAt: Date.UTC(2026, 9, 20, 3) });
  const w7 = Trend.compute({ now: NOW, days: 7, essayReviews: [oldReview, linkedReviews[1]], essaySessions: [{ id: 's-link', examId: 'e-link' }], essayExams: [{ id: 'e-link', title: '同活动' }], studyLogs: [external], learningTasks: [] });
  assert.equal(w7.essays.some(e => e.source === 'internal' && e.score === 9), true);
  assert.equal(w7.sources.essays.crossSourceUncertain, true);
  const w30 = Trend.compute({ now: NOW, days: 30, essayReviews: [oldReview, linkedReviews[1]], essaySessions: [{ id: 's-link', examId: 'e-link' }], essayExams: [{ id: 'e-link', title: '同活动' }], studyLogs: [external], learningTasks: [] });
  assert.equal(w30.essays.length, 3);
});

test('real-report-derived mixed classification: 30/48 directed subtotal, comprehensive 11/15, overall 41/63', () => {
  // Synthetic reconstruction using the actual report numbers/classifications;
  // no private PDF, no real profile, no Fenbi raw export is copied.
  const zl = log({ source: 'fenbi-synthetic', externalId: 'real-zl', date: '2026-11-02', assessment: 'objective', practiceType: 'retest', module: '资料分析', content: '资料分析错题复测', questionCount: 6, correctCount: 5 }, 'real-zl', 1000);
  const pd = log({ source: 'fenbi-synthetic', externalId: 'real-pd', date: '2026-11-02', assessment: 'objective', practiceType: 'retest', module: '判断推理', content: '判断推理错题复测', questionCount: 6, correctCount: 3 }, 'real-pd', 1000);
  const yy = log({ source: 'fenbi-synthetic', externalId: 'real-yy', date: '2026-11-02', assessment: 'objective', practiceType: 'retest', module: '言语理解与表达', content: '言语理解错题复测', questionCount: 6, correctCount: 4 }, 'real-yy', 1000);
  const calc = log({ source: 'manual', date: '2026-11-02', assessment: 'objective', practiceType: null, module: '数量关系', content: '速算18/30（分类未确认）', questionCount: 30, correctCount: 18, durationSeconds: 980, durationPrecision: 'exact' }, 'real-calc', 1000, 'manual');
  const comp = log({ source: 'fenbi-synthetic', externalId: 'real-comp', date: '2026-11-02', assessment: 'objective', practiceType: 'comprehensive', module: '综合', content: '综合练习11/15', questionCount: 15, correctCount: 11 }, 'real-comp', 1000);
  const essay = log({ source: 'fenbi-synthetic', externalId: 'real-essay', date: '2026-11-02', assessment: 'essay', content: '申论7/9', essayScores: [{ round: 'first', score: 7, maxScore: 10 }, { round: 'reevaluation', score: 9, maxScore: 10 }] }, 'real-essay', 1000);
  const logs = [zl, pd, yy, calc, comp, essay];
  const report = Trend.compute({ now: NOW, days: 30, studyLogs: logs, learningTasks: [] });
  assert.deepEqual([report.practiceTypes.new.questions, report.practiceTypes.new.correct], [0, 0]);
  assert.deepEqual([report.practiceTypes.retest.questions, report.practiceTypes.retest.correct, report.practiceTypes.retest.accuracy], [18, 12, 66.7]);
  assert.deepEqual([report.practiceTypes.unclassified.questions, report.practiceTypes.unclassified.correct, report.practiceTypes.unclassified.accuracy], [30, 18, 60]);
  assert.deepEqual([report.practiceTypes.comprehensive.questions, report.practiceTypes.comprehensive.correct, report.practiceTypes.comprehensive.accuracy], [15, 11, 73.3]);
  assert.deepEqual([report.practiceTypes.subtotal.questions, report.practiceTypes.subtotal.correct, report.practiceTypes.subtotal.accuracy, report.practiceTypes.subtotal.unclassifiedQuestions], [48, 30, 62.5, 30]);
  assert.deepEqual([report.overall.questions, report.overall.correct, report.overall.accuracy], [63, 41, 65.1]);
  assert.deepEqual(Array.from(report.essays, e => e.score), [7, 9]);
  assert.equal(report.sample.objectiveSubtotalCorrect, 30);
  assert.equal(report.sample.objectiveSubtotalQuestions, 48);
  assert.equal(report.daily.find(d => d.date === '2026-11-02').correct, 41);

  // The learning-record summary uses the same source-inclusive subtotal and
  // does not rename unclassified/retest results into new.
  const summary = StudyLog.summarize(logs);
  assert.deepEqual([summary.objective.categories.retest.questions, summary.objective.categories.retest.correct], [18, 12]);
  assert.deepEqual([summary.objective.categories.unclassified.questions, summary.objective.categories.unclassified.correct], [30, 18]);
  assert.deepEqual([summary.objective.categories.comprehensive.questions, summary.objective.categories.comprehensive.correct], [15, 11]);
  assert.deepEqual([summary.objective.subtotal.questions, summary.objective.subtotal.correct, summary.objective.subtotal.accuracy, summary.objective.subtotal.unclassifiedQuestions], [48, 30, 62.5, 30]);
  assert.deepEqual([summary.objective.total.questions, summary.objective.total.correct, summary.objective.total.accuracy], [63, 41, 65.1]);
});

test('daily series covers external and bank sources, empty days null, essays/retests separate', () => {
  const d1 = log({ source: 'fenbi', externalId: 'daily-1', date: '2026-11-01', assessment: 'objective', practiceType: 'new', content: '11/1 外部', questionCount: 5, correctCount: 4, durationSeconds: 300, durationPrecision: 'exact' }, 'daily-1', 1000);
  const d2 = log({ source: 'fenbi', externalId: 'daily-2', date: '2026-11-02', assessment: 'objective', practiceType: 'new', content: '11/2 外部', questionCount: 6, correctCount: 5 }, 'daily-2', 1000);
  const essay = log({ source: 'fenbi', externalId: 'daily-essay', date: '2026-11-02', assessment: 'essay', content: '11/2 申论', essayScores: [{ round: 'first', score: 7, maxScore: 10 }] }, 'daily-essay', 1000);
  const bank = {
    available: true,
    attempts: [{ id: 'daily-bank', sessionId: 'daily-bank', practiceSetId: 'daily-set', submittedAt: Date.UTC(2026, 10, 2, 2), results: [{ bankQuestionId: 'q', correct: true, elapsedMs: 1000, selected: 'A' }] }],
    sets: [{ id: 'daily-set', mode: 'mock', questions: [{ id: 'q', module: '资料分析' }] }], questions: []
  };
  const tasks = [{ id: 'daily-retest', type: 'retest', retestInterval: 1, dueDate: '2026-11-02', date: '2026-11-02', retestResults: [{ date: '2026-11-05', mode: 'original', correctCount: 1, questionCount: 1 }] }];
  const report = Trend.compute({ now: Date.UTC(2026, 10, 6, 2), days: 7, studyLogs: [d1, d2, essay], bank, learningTasks: tasks });
  assert.equal(report.daily.length, 7);
  const byDate = Object.fromEntries(report.daily.map(d => [d.date, d]));
  assert.equal(byDate['2026-10-31'].accuracy, null);
  assert.equal(byDate['2026-11-01'].questions, 5);
  assert.equal(byDate['2026-11-01'].correct, 4);
  assert.equal(byDate['2026-11-01'].sources.external, 1);
  assert.equal(byDate['2026-11-02'].questions, 7);
  assert.equal(byDate['2026-11-02'].correct, 6);
  assert.equal(byDate['2026-11-02'].sources.external, 1);
  assert.equal(byDate['2026-11-02'].sources.bank, 1);
  assert.equal(byDate['2026-11-02'].essayScores, 1);
  assert.equal(byDate['2026-11-02'].novelty.first, 1, 'bank question is first-time');
  assert.equal(byDate['2026-11-02'].novelty.unknown, 6, 'external aggregate has no per-question identity');
  assert.equal(byDate['2026-11-02'].retestResults, 0, 'due date must not become an answer date');
  assert.equal(byDate['2026-11-05'].retestResults, 1);
  assert.equal(report.daily.reduce((n, d) => n + d.questions, 0), report.overall.questions);
  assert.equal(report.daily.reduce((n, d) => n + d.correct, 0), report.overall.correct);
});

test('question history UI policy and UI SKIP policy are explicit', () => {
  assert.equal(isEnvironmentDenial('electron.launch: spawn EPERM'), true);
  assert.equal(isEnvironmentDenial('Error: spawn EACCES'), true);
  assert.equal(isEnvironmentDenial('Electron platform_channel.cc: connection closed'), false, 'generic platform_channel startup failure is FAIL');
  assert.equal(isEnvironmentDenial('Electron CDP did not become ready'), false);
  assert.equal(isEnvironmentDenial('renderer crashed while loading'), false);
  assert.equal(isEnvironmentDenial('AssertionError: expected 30/48'), false);
  assert.equal(isEnvironmentDenial('拒绝访问'), false, 'generic access denial is not enough for SKIP');
  assert.equal(isEnvironmentDenial('sandbox permission denied'), true);
  assert.equal(isEnvironmentDenial('Error: EPERM while launching'), true);
});
