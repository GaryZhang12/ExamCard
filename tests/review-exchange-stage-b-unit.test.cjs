/* SPDX-License-Identifier: Apache-2.0 */
/* WP10 Stage B pure identity/planning helpers; no IDB/Electron. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const context = {
  console, Date, Math, JSON, Number, String, Object, Array, Promise, Map, Set, RegExp, Error,
  Uint8Array, ArrayBuffer, TextEncoder, TextDecoder, isFinite, parseInt, parseFloat,
  crypto: globalThis.crypto
};
context.window = context; context.globalThis = context;
vm.createContext(context);
for (const file of ['study-log.js', 'review-exchange-format.js', 'review-exchange.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'app', file), 'utf8'), context, { filename: file });
}
const F = context.ReviewExchangeFormat;
const RX = context.ReviewExchange;
const H = RX._test;

test('manual/external stable studyLog IDs use producer/global identity and never raw activity_id', async () => {
  const a = { kind: 'manual', activity_id: 'a', source: null, external_id: null };
  const b = { kind: 'manual', activity_id: 'a', source: null, external_id: null };
  const c = { kind: 'external', activity_id: 'a', source: 'fenbi', external_id: 'e1' };
  const id1 = await H.stableStudyLogId(a, { kind: 'chatgpt', ref: 'same' });
  const id2 = await H.stableStudyLogId(b, { kind: 'chatgpt', ref: 'same' });
  const id3 = await H.stableStudyLogId(b, { kind: 'other', ref: 'same' });
  const id4 = await H.stableStudyLogId(c, { kind: 'chatgpt', ref: 'same' });
  assert.equal(id1, id2);
  assert.notEqual(id1, id3);
  assert.notEqual(id1, id4);
  assert.notEqual(id1, 'a');
  assert.match(id1, /^rx-m-[0-9a-f]{48}$/);
  assert.match(id4, /^rx-e-[0-9a-f]{48}$/);
});

test('activity semantic comparison ignores app id/audit but detects business changes', () => {
  const base = {
    schema: 'examcard.study-log/v2', id: 'rx-m-1', kind: 'manual', assessment: 'objective', status: 'active',
    date: '2026-11-02', content: '18/30', module: '数量关系', practiceType: null,
    questionCount: 30, correctCount: 18, source: 'manual', externalId: null,
    createdAt: 1, updatedAt: 2, revision: 3, revisions: [{ x: 1 }], deletedAt: null
  };
  const a = H.activitySemantic(base);
  const b = H.activitySemantic(Object.assign({}, base, { id: 'rx-m-2', createdAt: 9, updatedAt: 8, revision: 9, revisions: [] }));
  assert.equal(a, b);
  const c = H.activitySemantic(Object.assign({}, base, { correctCount: 19 }));
  assert.notEqual(a, c);
});

test('correction mapping only allows frozen business fields and preserves null', () => {
  const patch = H.studyLogPatchFromCorrection({
    content: 'x', date: '2026-11-03', knowledge_point: 'kp', question_count: 6, correct_count: null,
    duration_precision: 'unknown', duration_seconds: null, duration_minutes: null,
    groups: [{ label: 'g', question_count: 6, correct_count: null, duration_seconds: null }],
    wrong_questions: [{ question_no: '1', primary_cause: '审题错误' }],
    essay_scores: [{ round: 'first', score: 7, max_score: 10, reviewed_at: null }]
  });
  assert.equal(patch.knowledgePoint, 'kp');
  assert.equal(patch.questionCount, 6);
  assert.equal(patch.correctCount, null);
  assert.equal(patch.durationPrecision, 'unknown');
  assert.equal(patch.durationSeconds, null);
  assert.equal(patch.groups[0].questionCount, 6);
  assert.equal(patch.wrongQuestions[0].questionNo, '1');
  assert.equal(patch.essayScores[0].maxScore, 10);
  assert.equal(Object.prototype.hasOwnProperty.call(patch, 'source'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(patch, 'id'), false);
});

test('undo business patch preserves only business fields and excludes identity/audit/version', () => {
  const snap = {
    id: 'x', source: 'fenbi', externalId: 'e', createdAt: 1, updatedAt: 2, revision: 3, revisions: [],
    content: 'a', date: '2026-11-02', module: 'm', topic: 't', knowledgePoint: 'k',
    questionCount: 2, correctCount: 1, durationSeconds: 10, durationMinutes: 1 / 6,
    durationPrecision: 'exact', durationUnit: 'seconds', groups: [], wrongQuestions: [], essayScores: [], note: ''
  };
  const patch = H.businessPatchFromSnapshot(snap);
  assert.equal(patch.content, 'a');
  assert.equal(patch.knowledgePoint, 'k');
  for (const key of ['id', 'source', 'externalId', 'createdAt', 'updatedAt', 'revision', 'revisions']) {
    assert.equal(Object.prototype.hasOwnProperty.call(patch, key), false, key);
  }
});

test('overlapping maintenance stops require paired resumes before preview', async () => {
  context.ExamStore = {};
  RX.stopForClear('A');
  RX.stopForClear('B');
  RX.resumeMaintenance('A');
  await assert.rejects(RX.preview({ bytes: new TextEncoder().encode('{}') }), RegExp('恢复/清空数据'));
  RX.resumeMaintenance('B');
  assert.doesNotThrow(() => { RX.resumeMaintenance('extra'); });
});

test('reimport batch identity is new, bounded and opaque; target ref hash is stable', async () => {
  const a = H.makeReimportBatchId('producer-batch');
  const b = H.makeReimportBatchId('producer-batch');
  assert.notEqual(a, b);
  assert.ok(a.startsWith('producer-batch-reimport-'));
  assert.ok(a.length <= 160);
  const target = { type: 'studyLog', namespace: 'ec-store:studyLogs', id: 'log-1' };
  const h1 = await H.refHashFor(target);
  const h2 = await H.refHashFor(Object.assign({}, target, { expected_revision: 99 }));
  assert.equal(h1, h2);
  assert.match(h1, /^sha256:[0-9a-f]{64}$/);
});

