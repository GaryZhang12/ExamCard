/* SPDX-License-Identifier: Apache-2.0 */
/* 1.2.0 P0 pure model/import/schema tests. UI and IndexedDB acceptance live in
   tests/p0-learning-ui.cjs and tests/p0-real-plan-ui.cjs, which use the real
   Electron application and an isolated temporary profile. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
function loadAll(files, globals = {}) {
  const context = {
    console, URL, setTimeout, clearTimeout, Date, Math, JSON, Number, String, Object, Array, Promise,
    isFinite, parseInt, parseFloat, Map, Set, RegExp, Error, Uint8Array, TextEncoder, TextDecoder,
    ...globals
  };
  context.window = context; context.globalThis = context;
  vm.createContext(context);
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(root, 'app', file), 'utf8'), context, { filename: file });
  return context;
}
const ctx = loadAll(['study-log.js', 'external-practice.js', 'daily-plan-import.js', 'pdf-detect.js', 'learning-engine.js'], {
  DiagnosisEngine: { report: function () { return {}; } }
});
const StudyLog = ctx.StudyLog;
const ExternalPractice = ctx.ExternalPractice;
const DailyPlanImport = ctx.DailyPlanImport;
const fixturePath = path.join(root, 'tests/fixtures/external-practice-2026-11-02.json');
const fixture19Path = path.join(root, 'tests/fixtures/external-practice-2026-11-02-div19.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const fixture19 = JSON.parse(fs.readFileSync(fixture19Path, 'utf8'));
const realPlanPath = process.env.EXAMCARD_REAL_PLAN || '';
const realPlanSha = '8b7a1535f2cf08161b2157a134823c8fb391e66d21c7c661e0c49280a047d529';

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('unknown time stays null; exact seconds and fractional minutes are preserved', () => {
  const unknown = StudyLog.assertValid({ date: '2026-11-02', content: '未知用时', durationPrecision: 'unknown', questionCount: 1, correctCount: 1 });
  assert.equal(unknown.durationSeconds, null);
  assert.equal(unknown.durationMinutes, null);
  const seconds = StudyLog.assertValid({ date: '2026-11-02', content: '精确秒', durationSeconds: 980, durationPrecision: 'exact', durationUnit: 'seconds' });
  assert.equal(seconds.durationSeconds, 980);
  assert.equal(seconds.durationMinutes, 980 / 60);
  assert.equal(StudyLog.formatDuration(seconds), '16 分 20 秒');
  const minutes = StudyLog.assertValid({ date: '2026-11-02', content: '小数分钟', durationMinutes: 1.5, durationPrecision: 'exact', durationUnit: 'minutes' });
  assert.equal(minutes.durationSeconds, 90);
  assert.equal(StudyLog.formatDuration(minutes), '1.5 分钟');
  assert.throws(() => StudyLog.assertValid({ date: '2026-11-02', content: '未知但填秒', durationPrecision: 'unknown', durationSeconds: 30 }), /未知用时/);
  assert.throws(() => StudyLog.assertValid({ date: '2026-11-02', content: '精确但空', durationPrecision: 'exact' }), /必须填写时长/);
  assert.throws(() => StudyLog.assertValid({ date: '2026-11-02', content: '秒分不一致', durationSeconds: 60, durationMinutes: 2 }), /不一致/);
});

test('finite non-negative integers and correct <= questions are enforced with paths', () => {
  for (const raw of [
    { questionCount: -1, field: 'questionCount' },
    { questionCount: 1.5, field: 'questionCount' },
    { questionCount: 10, correctCount: 11, field: 'correctCount' },
    { questionCount: '3', field: 'questionCount' },
    { questionCount: 2, correctCount: 1, durationSeconds: Infinity, field: 'durationSeconds' }
  ]) {
    const input = Object.assign({ date: '2026-11-02', content: '类型/范围反例' }, raw);
    delete input.field;
    const out = StudyLog.normalize(input);
    assert.ok(out.errors.some(e => e.path === raw.field), raw.field + ' path missing: ' + JSON.stringify(out.errors));
  }
  assert.throws(() => StudyLog.assertValid({ date: '2026-11-02', content: '正确无题量', correctCount: 2 }), /题量/);
});

test('unknown fields, unsupported schema, imported audit history and duplicate ids are explicit errors', () => {
  const unknown = StudyLog.normalize({ date: '2026-11-02', content: '未知字段', questionCount: 1, mystery: true });
  assert.ok(unknown.errors.some(e => e.path === 'mystery' && /未知字段/.test(e.message)));
  const schema = StudyLog.normalize({ schema: 'examcard.study-log/v1', date: '2026-11-02', content: '旧schema' });
  assert.ok(schema.errors.some(e => e.path === 'schema'));
  const forged = StudyLog.normalize({
    date: '2026-11-02', content: '伪造审计', revisions: [{ at: 1, action: 'create', reason: '伪造' }]
  });
  assert.ok(forged.errors.some(e => e.path === 'revisions' && /不能通过导入/.test(e.message)));
  assert.throws(() => StudyLog.normalizeMany([
    { id: 'same-id', date: '2026-11-02', content: '第一条' },
    { id: 'same-id', date: '2026-11-02', content: '第二条不同内容' }
  ]), e => e.details && e.details.some(d => d.path === 'records[1].id' && /重复/.test(d.message)));
});

test('19/30 -> 18/30 keeps stable id, full audit and 980 seconds', () => {
  const oldRaw = fixture19.records[0];
  const old = StudyLog.assertValid(Object.assign({ id: 'stable-division' }, oldRaw));
  const next = StudyLog.applyUpdate(old, {
    questionCount: 30, correctCount: 18, durationSeconds: 980, durationMinutes: 980 / 60,
    durationPrecision: 'exact', durationUnit: 'seconds',
    groups: [
      { label: '第一组', questionCount: 10, correctCount: 7, durationSeconds: 235 },
      { label: '第二组', questionCount: 10, correctCount: 6, durationSeconds: 389 },
      { label: '第三组', questionCount: 10, correctCount: 5, durationSeconds: 356 }
    ]
  }, { reason: '历史 19/30 更正为 18/30', now: 2000, expectedRevision: 0 });
  assert.equal(next.id, 'stable-division');
  assert.equal(next.correctCount, 18);
  assert.equal(next.durationSeconds, 980);
  assert.equal(next.groups.length, 3);
  assert.equal(next.revision, 1);
  assert.equal(next.revisions.length, 1);
  assert.equal(next.revisions[0].reason, '历史 19/30 更正为 18/30');
  assert.equal(next.revisions[0].before.correctCount, 19);
  assert.equal(next.revisions[0].after.correctCount, 18);
  assert.equal(StudyLog.formatDuration(next), '16 分 20 秒');
});

test('stale edit is rejected instead of silently overwriting a newer revision', () => {
  const old = StudyLog.assertValid({ id: 'locked', date: '2026-11-02', content: '并发编辑', questionCount: 2, correctCount: 1 });
  old.revision = 3;
  old.updatedAt = 1000;
  assert.throws(() => StudyLog.applyUpdate(old, { correctCount: 2 }, {
    reason: '旧编辑', now: 2000, expectedRevision: 2, expectedUpdatedAt: 999
  }), e => e.code === 'STUDY_LOG_CONFLICT');
  const next = StudyLog.applyUpdate(old, { correctCount: 2 }, {
    reason: '正确编辑', now: 2000, expectedRevision: 3, expectedUpdatedAt: 1000
  });
  assert.equal(next.correctCount, 2);
  assert.equal(next.revision, 4);
  assert.equal(next.revisions.length, 1);
});

test('external and wrong-question keys are unambiguous JSON tuples and survive prototype names', () => {
  const base = { kind: 'external', date: '2026-11-02', content: '命名空间', practiceType: 'new', questionCount: 1, correctCount: 1 };
  const a = StudyLog.assertValid(Object.assign({}, base, {
    source: 'a::b', externalId: 'c',
    wrongQuestions: [{ questionNo: '1::2', primaryCause: '审题错误' }]
  }));
  const b = StudyLog.assertValid(Object.assign({}, base, {
    source: 'a', externalId: 'b::c',
    wrongQuestions: [{ questionNo: '1::2', primaryCause: '审题错误' }]
  }));
  assert.notEqual(a.externalKey, b.externalKey);
  assert.notEqual(a.wrongQuestions[0].wrongKey, b.wrongQuestions[0].wrongKey);
  assert.equal(a.externalKey, StudyLog.externalKeyFor('a::b', 'c'));
  assert.equal(StudyLog.externalKeyOf(a), a.externalKey);
  assert.equal(StudyLog.externalKeyOf({ externalKey: 'a::b::c' }), 'a::b::c');
  assert.equal(StudyLog.externalKeyOf({ source: 'a::b', externalId: 'c', externalKey: 'a::b::c' }), a.externalKey,
    'legacy ambiguous key must not override source/externalId');

  const proto1 = StudyLog.assertValid(Object.assign({}, base, { source: '__proto__', externalId: 'constructor' }));
  const proto2 = StudyLog.assertValid(Object.assign({}, base, { source: 'constructor', externalId: '__proto__' }));
  assert.notEqual(proto1.externalKey, proto2.externalKey);
  const summary = StudyLog.summarize([proto1, proto2]);
  assert.equal(summary.objective.categories.new.activities, 2, 'prototype-like keys must not collapse in a plain object map');
  assert.equal(summary.objective.categories.new.questions, 2);
});

test('synthetic 2026-11-02 data totals 30/48=62.5%, incorrect=18, comprehensive 15 separate, essay 7+9', () => {
  const prepared = ExternalPractice.prepare(fixture.records, []);
  assert.equal(prepared.errors.length, 0);
  const roundTrip = StudyLog.normalizeMany(prepared.newRecords);
  assert.equal(roundTrip.length, fixture.records.length, 'normalized import records must be accepted again at the persistence boundary');
  const summary = StudyLog.summarize(prepared.newRecords);
  const c = summary.objective.categories.new;
  assert.equal(c.questions, 48);
  assert.equal(c.correct, 30);
  assert.equal(c.incorrect, 18);
  assert.equal(c.accuracy, 62.5);
  assert.equal(c.unknownCorrect, 0);
  assert.equal(summary.objective.categories.comprehensive.questions, 15);
  assert.equal(summary.objective.categories.comprehensive.activities, 1);
  assert.equal(summary.objective.categories.comprehensive.unknownCorrect, 1);
  assert.equal(summary.objective.categories.comprehensive.accuracy, null);
  assert.equal(summary.objective.total.incorrect, 18);
  assert.equal(summary.objective.total.accuracy, null, 'unknown correct keeps the aggregate percentage unknown');
  assert.equal(summary.essays.length, 1);
  assert.equal(summary.essays[0].scores.map(s => s.round + ':' + s.score + '/' + s.maxScore).join(','), 'first:7/10,reevaluation:9/10');
  assert.equal(summary.essays[0].questionCount, undefined);
  assert.equal(summary.wrongQuestions.length, 6);
  assert.ok(summary.wrongQuestions.every(w => /^w2:/.test(w.wrongKey)));
  assert.ok(summary.wrongQuestions.every(w => w.source === 'fenbi-synthetic'));
});

test('source+externalId duplicate is detected and skipped, never silently inserted twice', () => {
  const first = ExternalPractice.prepare(fixture.records, []);
  const second = ExternalPractice.prepare(fixture.records, first.newRecords);
  assert.equal(second.newRecords.length, 0);
  assert.equal(second.duplicates.length, fixture.records.length);
  assert.ok(second.duplicates.every(d => d.duplicate === 'same'));
  assert.equal(second.summary.sameCount, fixture.records.length);
  assert.equal(second.summary.changedCount, 0);

  const changed = JSON.parse(JSON.stringify(fixture.records));
  changed[0].correctCount = 4;
  const conflict = ExternalPractice.prepare(changed, first.newRecords);
  assert.equal(conflict.newRecords.length, 0);
  assert.equal(conflict.summary.changedCount, 1);
  assert.equal(conflict.conflicts.length, 1);
  assert.ok(/不会覆盖/.test(conflict.conflicts[0].reason));

  const batchDup = ExternalPractice.prepare([
    { source: 's', externalId: 'same', date: '2026-11-02', content: '一', practiceType: 'new', questionCount: 1, correctCount: 1 },
    { source: 's', externalId: 'same', date: '2026-11-02', content: '二', practiceType: 'new', questionCount: 1, correctCount: 1 }
  ], []);
  assert.equal(batchDup.newRecords.length, 1);
  assert.ok(batchDup.errors.some(e => /重复/.test(e.message)));
});

test('external batch returns field paths for wrong types and unknown fields', () => {
  const single = ExternalPractice.parse(JSON.stringify({ source: 'fenbi', externalId: 'one', date: '2026-11-02', content: '单条', practiceType: 'new', questionCount: 1, correctCount: 1 }));
  assert.equal(single.length, 1);
  const prepared = ExternalPractice.prepare([
    { source: 'fenbi', externalId: 'type-bad', date: '2026-11-02', content: '类型反例', practiceType: 'new', questionCount: '6', correctCount: 5 },
    { source: 'fenbi', externalId: 'unknown-field', date: '2026-11-02', content: '未知字段', practiceType: 'new', questionCount: 1, correctCount: 1, mystery: true }
  ], []);
  assert.equal(prepared.newRecords.length, 0);
  assert.ok(prepared.errors.some(e => e.path === 'records[0].questionCount'));
  assert.ok(prepared.errors.some(e => e.path === 'records[1].mystery'));
});

test('batch manual JSON supports fractional minutes and rejects invalid rows with the right paths', () => {
  const ok = StudyLog.parseBatch(JSON.stringify({
    schema: StudyLog.BATCH_SCHEMA,
    records: [{ date: '2026-11-02', content: '批量一', durationMinutes: 1.5, durationPrecision: 'exact', questionCount: 10, correctCount: 7 }]
  }));
  assert.equal(ok.length, 1);
  assert.equal(ok[0].durationSeconds, 90);
  assert.equal(StudyLog.normalizeMany(ok).length, 1, 'parseBatch output must survive a second persistence-boundary validation');
  assert.throws(() => StudyLog.parseBatch(JSON.stringify([{ date: '2026-11-02', content: '坏', questionCount: 3, correctCount: 4 }])), e => {
    assert.ok(e.details && e.details.some(x => x.path === 'records[0].correctCount'));
    return true;
  });
  assert.throws(() => StudyLog.parseBatch(JSON.stringify({ schema: 'examcard.study-log-batch/v0', records: [] })), e => {
    assert.ok(e.details && e.details[0].path === 'schema');
    return true;
  });
  assert.throws(() => StudyLog.parseBatch(JSON.stringify({ records: [], extra: 1 })), e => {
    assert.ok(e.details && e.details.some(x => x.path === 'extra'));
    return true;
  });
  assert.throws(() => StudyLog.parseBatch(JSON.stringify([{ date: '2026-11-02', content: '伪造审计', revisions: [{ at: 1 }] }])), e => {
    assert.ok(e.details && e.details.some(x => x.path === 'records[0].revisions'));
    return true;
  });
});

test('daily-plan schema and runtime templates stay aligned on new strict fields', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(root, 'schemas/daily-plan-v1.schema.json'), 'utf8'));
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.$defs.task.additionalProperties, false);
  ['plan_mode', 'plan_submode'].forEach(k => assert.ok(schema.properties[k], 'missing top field ' + k));
  ['task_type', 'module', 'knowledge_point', 'target_accuracy', 'time_limit_seconds', 'question_count', 'question_set_id', 'memorization'].forEach(k => assert.ok(schema.$defs.task.properties[k], 'missing task field ' + k));
  const template = JSON.parse(DailyPlanImport.jsonTemplate());
  Object.keys(template).forEach(k => assert.ok(schema.properties[k], 'template top field not in schema: ' + k));
  Object.keys(template.tasks[0]).forEach(k => assert.ok(schema.$defs.task.properties[k], 'template task field not in schema: ' + k));
  for (const mode of DailyPlanImport.PLAN_MODES) {
    const p = JSON.parse(DailyPlanImport.planTemplate(mode));
    Object.keys(p).forEach(k => assert.ok(schema.properties[k], mode + ' top field not in schema: ' + k));
    p.tasks.forEach(t => Object.keys(t).forEach(k => assert.ok(schema.$defs.task.properties[k], mode + ' task field not in schema: ' + k)));
    assert.equal(DailyPlanImport.validatePlan(p).length, 0, mode);
  }
});

test('plan prepare detects duplicates, changes and completed-task protection', () => {
  const plan = JSON.parse(fs.readFileSync(path.join(root, 'docs/plan-2026-11-03-synthetic.json'), 'utf8'));
  const first = DailyPlanImport.prepare(plan, {}).records;
  const same = DailyPlanImport.prepare(plan, { tasks: first }).records;
  assert.ok(same.every(r => r.duplicate === 'same'));
  const completed = first.map(r => Object.assign({}, r, { status: 'completed', actualMinutes: 60, actualQuestions: 20, actualCorrect: 15 }));
  const skipped = DailyPlanImport.prepare(plan, { tasks: completed }).records;
  assert.ok(skipped.every(r => r.completed === true));
  const changedPlan = JSON.parse(JSON.stringify(plan));
  changedPlan.tasks[0].topic = '资料分析专项练习（更新）';
  const changed = DailyPlanImport.prepare(changedPlan, { tasks: first }).records;
  assert.equal(changed[0].duplicate, 'changed');
  assert.equal(changed[0].planTaskId, first[0].planTaskId);
});

test('malformed tasks object returns a path-specific task error, not TypeError', () => {
  const p = JSON.parse(fs.readFileSync(path.join(root, 'docs/plan-2026-11-03-synthetic.json'), 'utf8'));
  p.tasks = {};
  assert.throws(() => DailyPlanImport.parseText(JSON.stringify(p), 'bad.json'), e => {
    assert.ok(e.details && e.details.some(x => x.path === 'tasks'));
    assert.ok(!/forEach is not a function/.test(e.message));
    return true;
  });
  const nullTask = JSON.parse(fs.readFileSync(path.join(root, 'docs/plan-2026-11-03-synthetic.json'), 'utf8'));
  nullTask.tasks[1] = null;
  const errors = DailyPlanImport.validatePlan(nullTask);
  assert.ok(errors.some(e => e.path === 'tasks[1]' && /对象/.test(e.message)));
});

test('unknown plan fields and invalid priority are rejected with paths, not silently dropped', () => {
  const p = JSON.parse(fs.readFileSync(path.join(root, 'docs/plan-2026-11-03-synthetic.json'), 'utf8'));
  p.mystery = true;
  p.tasks[0].priority = 'urgent';
  p.tasks[0].unknown_task_field = 'x';
  p.schema_version = 'examcard.daily-plan/v0';
  const errors = DailyPlanImport.validatePlan(p);
  assert.ok(errors.some(e => e.path === 'schema_version'));
  assert.ok(errors.some(e => e.path === 'plan.mystery'));
  assert.ok(errors.some(e => e.path === 'tasks[0].priority'));
  assert.ok(errors.some(e => e.path === 'tasks[0].unknown_task_field'));
});

test('duplicate task_id is rejected even when the content differs', () => {
  const p = JSON.parse(fs.readFileSync(path.join(root, 'docs/plan-2026-11-03-synthetic.json'), 'utf8'));
  p.tasks.push(Object.assign({}, p.tasks[0], { topic: '不同内容' }));
  const errors = DailyPlanImport.validatePlan(p);
  assert.ok(errors.some(e => e.path === 'tasks[4].task_id' && /重复/.test(e.message)));
});

test('explicit per-question type marker wins over section type hint (multi and judge)', () => {
  const base = [
    { text: '第一部分 判断推理', x: 20, y: 760, fontSize: 13 },
    { text: '一、单选题', x: 20, y: 730, fontSize: 12 }
  ];
  const multi = ctx.PdfDetect.detect([{ pageNumber: 1, width: 600, height: 800, lines: base.concat([
    { text: '1.（多选题）下列说法正确的有？', x: 20, y: 700, fontSize: 12 },
    { text: 'A.甲', x: 30, y: 680, fontSize: 12 }, { text: 'B.乙', x: 30, y: 660, fontSize: 12 },
    { text: 'C.丙', x: 30, y: 640, fontSize: 12 }, { text: 'D.丁', x: 30, y: 620, fontSize: 12 }
  ]) }], { name: 'mixed.pdf' });
  assert.equal(multi.questions[0].type, 'multi');
  assert.equal(multi.questions[0].typeStatus, 'confirmed');

  const judge = ctx.PdfDetect.detect([{ pageNumber: 1, width: 600, height: 800, lines: base.concat([
    { text: '2.（判断题）该说法正确。', x: 20, y: 580, fontSize: 12 }
  ]) }], { name: 'judge.pdf' });
  assert.equal(judge.questions[0].type, 'judge');
  assert.equal(judge.questions[0].typeStatus, 'confirmed');

  const single = ctx.PdfDetect.detect([{ pageNumber: 1, width: 600, height: 800, lines: [
    { text: '第一部分 政治理论', x: 20, y: 760, fontSize: 13 },
    { text: '一、多选题', x: 20, y: 730, fontSize: 12 },
    { text: '3.（单选题）只有一项正确。', x: 20, y: 700, fontSize: 12 },
    { text: 'A.甲', x: 30, y: 680, fontSize: 12 }, { text: 'B.乙', x: 30, y: 660, fontSize: 12 },
    { text: 'C.丙', x: 30, y: 640, fontSize: 12 }, { text: 'D.丁', x: 30, y: 620, fontSize: 12 }
  ] }], { name: 'single.pdf' });
  assert.equal(single.questions[0].type, 'single');
  assert.equal(single.questions[0].typeStatus, 'confirmed');
});

test('softwareForDate excludes sessions already consumed by another task', () => {
  const engine = { attempts: [
    { id: 'a1', date: '2026-11-02', record: { sessionId: 's1' }, details: [{ status: 'correct', elapsed: 60 }] },
    { id: 'a2', date: '2026-11-02', record: { sessionId: 's2' }, details: [{ status: 'incorrect', elapsed: 30 }] }
  ] };
  const all = ctx.LearningEngine.softwareForDate(engine, '2026-11-02');
  assert.equal(all.questions, 2);
  assert.equal(all.sessionIds.join(','), 's1,s2');
  const once = ctx.LearningEngine.softwareForDate(engine, '2026-11-02', ['s1']);
  assert.equal(once.questions, 1);
  assert.equal(once.excluded, 1);
  assert.equal(once.sessionIds.join(','), 's2');
  const second = ctx.LearningEngine.softwareForDate(engine, '2026-11-02', ['s1', 's2']);
  assert.equal(second.questions, 0);
  assert.equal(second.excluded, 2, 'a second task cannot copy the same whole-day session');
});

test('synthetic plan fixture validates through runtime and has no fake question set id', () => {
  const plan = JSON.parse(fs.readFileSync(path.join(root, 'docs/plan-2026-11-03-synthetic.json'), 'utf8'));
  assert.equal(DailyPlanImport.validatePlan(plan).length, 0);
  assert.ok(plan.tasks.every(t => t.question_set_id == null || t.question_set_id === ''));
  assert.ok(/合成/.test(plan.title));
});

test('real 2026-11-03 plan source is imported unchanged with 7 tasks, exact times/stages/counts', { skip: !fs.existsSync(realPlanPath) ? 'real plan file unavailable: ' + realPlanPath : false }, () => {
  assert.equal(sha256File(realPlanPath), realPlanSha);
  const text = fs.readFileSync(realPlanPath, 'utf8');
  const plan = DailyPlanImport.parseText(text, path.basename(realPlanPath));
  assert.equal(plan.plan_id, 'gd-2026-11-03-evening-v1');
  assert.equal(plan.tasks.length, 7);
  const prepared = DailyPlanImport.prepare(plan, {}).records;
  assert.equal(prepared.length, 7);
  const plain = JSON.parse(JSON.stringify(prepared));
  assert.deepEqual(plain.map(r => r.title), [
    '工程问题：工作总量、效率与合作工程',
    '平均数与平均数增长量：列式、单位、截位估算',
    '概率入门：古典概型、事件计数；不重复捆绑插空',
    '政治理论多选：百千万工程与城乡融合',
    '削弱、加强与选非：论点关联、必要充分条件',
    '百千万工程背诵：15分钟提纲正文应用＋5分钟闭卷复述',
    '登记真实成绩、逐题用时、错因；未提交标待核实'
  ]);
  assert.deepEqual(plain.map(r => [r.start, r.end, r.planMinutes]), [
    ['19:30', '20:15', 45], ['20:25', '21:10', 45], ['21:20', '22:05', 45],
    ['22:15', '22:40', 25], ['22:40', '23:05', 25], ['23:05', '23:25', 20], ['23:25', '23:30', 5]
  ]);
  assert.deepEqual(plain.map(r => r.planQuestions), [6, 7, 5, 7, 7, null, null]);
  assert.deepEqual(plain.map(r => r.stages.map(s => s.type + ':' + s.minutes).join(',')), [
    'video:15,examples:8,practice:16,review:6',
    'video:12,examples:8,practice:19,review:6',
    'reading:15,examples:8,practice:16,review:6',
    'reading:5,practice:15,review:5',
    'reading:4,practice:15,review:6',
    'reading:15,other:5',
    'review:5'
  ]);
  assert.ok(plain.every(r => r.planSource === 'daily-plan-v1'));
  assert.equal(sha256File(realPlanPath), realPlanSha, 'source file must not be modified');
});

let Ajv2020 = null;
try {
  const pnpm = path.join(root, 'node_modules/.pnpm');
  const ajvDir = fs.existsSync(pnpm) ? fs.readdirSync(pnpm).filter(n => /^ajv@/.test(n)).sort().pop() : null;
  if (ajvDir) Ajv2020 = require(path.join(pnpm, ajvDir, 'node_modules/ajv/dist/2020'));
} catch (e) { Ajv2020 = null; }
test('strict JSON Schema accepts the synthetic plan and all runtime templates', { skip: !Ajv2020 ? 'Ajv not installed' : false }, () => {
  const ajv = new Ajv2020({ strict: false, allowUnionTypes: true });
  const schema = JSON.parse(fs.readFileSync(path.join(root, 'schemas/daily-plan-v1.schema.json'), 'utf8'));
  const validate = ajv.compile(schema);
  assert.equal(validate(JSON.parse(fs.readFileSync(path.join(root, 'docs/plan-2026-11-03-synthetic.json'), 'utf8'))), true, JSON.stringify(validate.errors));
  assert.equal(validate(JSON.parse(DailyPlanImport.jsonTemplate())), true, JSON.stringify(validate.errors));
  for (const mode of DailyPlanImport.PLAN_MODES) {
    assert.equal(validate(JSON.parse(DailyPlanImport.planTemplate(mode))), true, mode + ': ' + JSON.stringify(validate.errors));
  }
});
