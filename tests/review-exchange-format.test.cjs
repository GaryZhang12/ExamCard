/* SPDX-License-Identifier: Apache-2.0 */
/* WP10 Stage A pure format/schema tests. No IndexedDB, no Electron, no writes. */
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
for (const file of ['study-log.js', 'review-exchange-format.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'app', file), 'utf8'), context, { filename: file });
}
const StudyLog = context.StudyLog;
const F = context.ReviewExchangeFormat;
const bareContext = {
  console, Date, Math, JSON, Number, String, Object, Array, Promise, Map, Set, RegExp, Error,
  Uint8Array, ArrayBuffer, TextEncoder, TextDecoder, isFinite, parseInt, parseFloat,
  crypto: globalThis.crypto
};
bareContext.window = bareContext; bareContext.globalThis = bareContext;
vm.createContext(bareContext);
vm.runInContext(fs.readFileSync(path.join(root, 'app/review-exchange-format.js'), 'utf8'), bareContext, { filename: 'review-exchange-format-bare.js' });
const BareF = bareContext.ReviewExchangeFormat;
const templateText = fs.readFileSync(path.join(root, 'templates/review-exchange-v1.template.json'), 'utf8');
const template = JSON.parse(templateText);
function clone(v) { return JSON.parse(JSON.stringify(v)); }
async function parse(obj) { return F.parseText(JSON.stringify(obj)); }
function minimalActivity(overrides) {
  return Object.assign({
    activity_id: 'manual-1', kind: 'manual', assessment: 'objective', date: '2026-11-02',
    content: '合成记录', practice_type: null, question_count: 2, correct_count: null,
    duration_precision: 'unknown', duration_unit: 'seconds'
  }, overrides || {});
}
function baseReview(overrides) {
  return Object.assign({
    review_id: 'review-1',
    target: {
      type: 'batchActivity', namespace: 'batch:activity', id: 'manual-1',
      expected_revision: 0,
      expected_hash: 'sha256:' + '0'.repeat(64)
    },
    summary: '合成复盘', reviewed_at: '2026-11-02T16:15:00.000Z'
  }, overrides || {});
}
let Ajv2020 = null;
try {
  const pnpm = path.join(root, 'node_modules/.pnpm');
  const ajvDir = fs.existsSync(pnpm) ? fs.readdirSync(pnpm).filter(n => /^ajv@/.test(n)).sort().pop() : null;
  if (ajvDir) Ajv2020 = require(path.join(pnpm, ajvDir, 'node_modules/ajv/dist/2020'));
} catch (e) { Ajv2020 = null; }
const schema = JSON.parse(fs.readFileSync(path.join(root, 'schemas/review-exchange-v1.schema.json'), 'utf8'));

test('template parses, matches schema, maps to actual StudyLog validation and has no generated audit fields', async () => {
  const r = await F.parseText(templateText);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.match(r.payloadSha256, /^sha256:[0-9a-f]{64}$/);
  assert.match(r.semanticFingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.equal(r.value.batch_id, template.batch_id);
  assert.equal(r.value.activities.length, 2);
  assert.equal(r.value.reviews.length, 1);
  assert.equal(r.value.activities[0].createdAt, undefined);
  assert.equal(r.value.activities[0].revision, undefined);
  assert.equal(r.value.activities[0].source, undefined, 'manual activity has no source identity field');
  assert.equal(r.value.activities[1].source, 'fenbi');
  for (const a of r.value.activities) {
    assert.doesNotThrow(() => StudyLog.assertValid(F.toStudyLog(a)));
  }
  if (Ajv2020) {
    const validate = new Ajv2020({ strict: false, allowUnionTypes: true }).compile(schema);
    assert.equal(validate(template), true, JSON.stringify(validate.errors));
    assert.equal(validate(r.value), true, JSON.stringify(validate.errors));
  } else {
    assert.ok(true, 'Ajv not installed; schema check skipped');
  }
});

test('UTF-8 BOM changes payload bytes but not semantic fingerprint; UTF-16 BOM is rejected', async () => {
  const plain = new TextEncoder().encode(templateText);
  const withBom = new Uint8Array(plain.length + 3);
  withBom.set([0xEF, 0xBB, 0xBF], 0); withBom.set(plain, 3);
  const a = await F.parseBytes(plain);
  const b = await F.parseBytes(withBom);
  assert.equal(a.ok, true, JSON.stringify(a.errors));
  assert.equal(b.ok, true, JSON.stringify(b.errors));
  assert.notEqual(a.payloadSha256, b.payloadSha256, 'payload hash covers raw UTF-8 bytes including BOM');
  assert.equal(a.semanticFingerprint, b.semanticFingerprint, 'BOM is not semantic content');
  const utf16 = await F.parseBytes(new Uint8Array([0xFF, 0xFE, 0x7B, 0x00]));
  assert.equal(utf16.ok, false);
  assert.match(utf16.errors[0].message, /UTF-16/);
});

test('semantic fingerprint excludes batch_id/generated_at/source.label and row order; content changes it', async () => {
  const a = await F.parseText(templateText);
  const moved = clone(template);
  moved.batch_id = 'another-batch';
  moved.generated_at = '2026-11-03T01:02:03.000Z';
  moved.source.label = '另一台机器/另一个封装';
  moved.activities.reverse();
  moved.notes = template.notes;
  const b = await parse(moved);
  assert.equal(b.ok, true, JSON.stringify(b.errors));
  assert.equal(a.semanticFingerprint, b.semanticFingerprint);
  assert.notEqual(a.payloadSha256, b.payloadSha256);
  const changed = clone(template);
  changed.activities[0].content = changed.activities[0].content + '（改）';
  const c = await parse(changed);
  assert.notEqual(a.semanticFingerprint, c.semanticFingerprint);
  const again = await F.parseText(templateText);
  assert.equal(a.semanticFingerprint, again.semanticFingerprint, 'no Date.now/default app fields may affect the fingerprint');
  assert.equal(a.semantic.source.label, undefined);
});

test('review identity is producer namespace + review_id; multiple reviews on one target coexist', async () => {
  const sameTarget = clone(template);
  sameTarget.reviews.push(Object.assign(clone(template.reviews[0]), { review_id: 'review-manual-speed-002' }));
  const r = await parse(sameTarget);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const k1 = await F.reviewEntityKey(r.value.source, 'review-manual-speed-001');
  const k2 = await F.reviewEntityKey(r.value.source, 'review-manual-speed-002');
  assert.notEqual(k1, k2);
  assert.equal(F.targetIdentity(r.value.reviews[0].target), F.targetIdentity(r.value.reviews[1].target));
  const otherSource = await F.reviewEntityKey({ kind: 'chatgpt', ref: 'a::b::__proto__' }, 'review-manual-speed-001');
  const another = await F.reviewEntityKey({ kind: 'chatgpt', ref: 'a' }, 'b::__proto__:review-manual-speed-001');
  assert.notEqual(otherSource, another);
  const ma = F.activityIdentity({ kind: 'manual', activity_id: 'id', source: null, external_id: null }, { kind: 'chatgpt', ref: 'same-ref' });
  const mb = F.activityIdentity({ kind: 'manual', activity_id: 'id', source: null, external_id: null }, { kind: 'other', ref: 'same-ref' });
  assert.notEqual(ma, mb, 'manual identity includes producer kind and ref');
  const proto = clone(template);
  proto.source.ref = '__proto__';
  proto.reviews[0].review_id = '__proto__';
  const p = await parse(proto);
  assert.equal(p.ok, true, JSON.stringify(p.errors));
  assert.equal(Object.prototype.polluted, undefined);
  const dup = clone(template);
  dup.reviews.push(Object.assign(clone(template.reviews[0]), { target: { type: 'studyLog', namespace: 'ec-store:studyLogs', id: 's1', expected_revision: 1, expected_hash: 'sha256:' + '1'.repeat(64) } }));
  const d = await parse(dup);
  assert.equal(d.ok, false);
  assert.ok(d.errors.some(e => /review_id/.test(e.path) && /重复/.test(e.message)));
});

test('typed target whitelist is exact; each supported target has the real store/version/hash contract', async () => {
  const valid = {
    studyLog: { type: 'studyLog', namespace: 'ec-store:studyLogs', id: 'log-1', expected_revision: 3, expected_hash: 'sha256:' + 'a'.repeat(64) },
    learningTask: { type: 'learningTask', namespace: 'ec-store:learningTasks', id: 'task-1', expected_updated_at: 1793584800000, expected_hash: 'sha256:' + 'b'.repeat(64) },
    gradingRecord: { type: 'gradingRecord', namespace: 'ec-store:gradingRecords', id: 'att-1', expected_hash: 'sha256:' + 'c'.repeat(64) },
    bankAttempt: { type: 'bankAttempt', namespace: 'ec-store:bankAttempts', id: 'ba-1', expected_hash: 'sha256:' + 'd'.repeat(64) },
    essayReview: { type: 'essayReview', namespace: 'ec-store:essayReviews', id: 'er-1', expected_hash: 'sha256:' + 'e'.repeat(64) },
    batchActivity: { type: 'batchActivity', namespace: 'batch:activity', id: 'manual-1', expected_revision: 0, expected_hash: 'sha256:' + 'f'.repeat(64) }
  };
  for (const [type, target] of Object.entries(valid)) {
    const obj = clone(template);
    obj.reviews[0].target = target;
    const r = await parse(obj);
    assert.equal(r.ok, true, type + ': ' + JSON.stringify(r.errors));
    assert.equal(F.TARGETS[type].store.length > 0, true);
    assert.equal(F.TARGETS[type].namespace, target.namespace);
  }
  const invalid = [
    { type: 'session', namespace: 'ec-store:sessions', id: 's', expected_hash: 'sha256:' + '0'.repeat(64) },
    { type: 'studyLog', namespace: 'ec-store:studyLogs', id: 's', expected_revision: 1, expected_updated_at: 1, expected_hash: 'sha256:' + '0'.repeat(64) },
    { type: 'studyLog', namespace: 'wrong', id: 's', expected_revision: 1, expected_hash: 'sha256:' + '0'.repeat(64) },
    { type: 'learningTask', namespace: 'ec-store:learningTasks', id: 't', expected_updated_at: 0, expected_hash: 'sha256:' + '0'.repeat(64) },
    { type: 'gradingRecord', namespace: 'ec-store:gradingRecords', id: 'g', expected_revision: 1, expected_hash: 'sha256:' + '0'.repeat(64) },
    { type: 'batchActivity', namespace: 'batch:activity', id: 'a', expected_revision: 1, expected_hash: 'sha256:' + '0'.repeat(64) }
  ];
  for (const target of invalid) {
    const obj = clone(template);
    obj.reviews[0].target = target;
    const r = await parse(obj);
    assert.equal(r.ok, false, JSON.stringify(target));
    assert.ok(r.errors.some(e => e.path.indexOf('$.reviews[0].target') === 0));
  }
});

test('activities accept existing manual null practice type and external identity; unknown values stay null', async () => {
  const obj = clone(template);
  obj.activities[0].correct_count = null;
  obj.activities[0].duration_seconds = null;
  obj.activities[0].duration_minutes = null;
  obj.activities[0].duration_precision = 'unknown';
  obj.activities[0].practice_type = null;
  const r = await parse(obj);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.value.activities[0].correct_count, null);
  assert.equal(r.value.activities[0].practice_type, null);
  assert.equal(r.value.activities[0].duration_seconds, null);
  assert.equal(r.value.activities[0].duration_precision, 'unknown');
  assert.equal(r.value.activities[0].source, undefined);
  assert.equal(r.value.activities[1].source, 'fenbi');
  assert.doesNotThrow(() => StudyLog.assertValid(F.toStudyLog(r.value.activities[0])));

  const badExternal = clone(template);
  badExternal.activities[1].practice_type = null;
  const be = await parse(badExternal);
  assert.equal(be.ok, false);
  assert.ok(be.errors.some(e => /practice_type/.test(e.path)));

  const missingSource = clone(template);
  delete missingSource.activities[1].source;
  const ms = await parse(missingSource);
  assert.equal(ms.ok, false);
  assert.ok(ms.errors.some(e => /source/.test(e.path)));

  const manualSource = clone(template);
  manualSource.activities[0].source = 'fenbi';
  const msource = await parse(manualSource);
  assert.equal(msource.ok, false);
  assert.ok(msource.errors.some(e => /source/.test(e.path)));
});

test('duplicate activity/review/correction IDs, external keys and correction targets return concrete paths', async () => {
  const dupAct = clone(template);
  dupAct.activities.push(clone(dupAct.activities[0]));
  const a = await parse(dupAct);
  assert.equal(a.ok, false);
  assert.ok(a.errors.some(e => /activities\[\d+\]\.activity_id/.test(e.path)));

  const dupExt = clone(template);
  dupExt.activities.push(Object.assign(clone(dupExt.activities[1]), { activity_id: 'external-copy' }));
  const e = await parse(dupExt);
  assert.equal(e.ok, false);
  assert.ok(e.errors.some(x => /source\+external_id/.test(x.message)));

  const dupReview = clone(template);
  dupReview.reviews.push(clone(dupReview.reviews[0]));
  const r = await parse(dupReview);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(x => /reviews\[1\]\.review_id/.test(x.path)));

  const dupCorrection = clone(template);
  const corr = {
    correction_id: 'corr-1',
    target: { type: 'studyLog', namespace: 'ec-store:studyLogs', id: 'log-1', expected_revision: 1, expected_hash: 'sha256:' + '1'.repeat(64) },
    reason: '更正', fields: { note: 'x' }
  };
  dupCorrection.corrections = [corr, Object.assign(clone(corr), { correction_id: 'corr-2' })];
  const c = await parse(dupCorrection);
  assert.equal(c.ok, false);
  assert.ok(c.errors.some(x => /corrections\[1\]\.target/.test(x.path)));
});

test('corrections only touch whitelisted studyLog business fields; identity/audit fields are rejected', async () => {
  const base = clone(template);
  base.corrections = [{
    correction_id: 'corr-ok',
    target: { type: 'studyLog', namespace: 'ec-store:studyLogs', id: 'log-1', expected_revision: 2, expected_hash: 'sha256:' + '2'.repeat(64) },
    reason: '用户确认题量',
    fields: { content: '更正后内容', question_count: 6, correct_count: 5, note: '有审计' }
  }];
  const ok = await parse(base);
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.equal(ok.value.corrections[0].fields.question_count, 6);
  const optionalId = clone(base);
  delete optionalId.corrections[0].correction_id;
  const oi = await parse(optionalId);
  assert.equal(oi.ok, true, JSON.stringify(oi.errors));
  assert.equal(oi.value.corrections[0].correction_id, undefined);
  if (Ajv2020) {
    const validate = new Ajv2020({ strict: false, allowUnionTypes: true }).compile(schema);
    assert.equal(validate(oi.value), true, JSON.stringify(validate.errors));
  }
  for (const field of ['id', 'source', 'external_id', 'externalId', 'status', 'revision', 'revisions', 'createdAt', 'updatedAt', 'task_id', 'practice_type']) {
    const obj = clone(base);
    obj.corrections[0].fields = { [field]: field === 'question_count' ? 1 : 'x' };
    const r = await parse(obj);
    assert.equal(r.ok, false, field);
    assert.ok(r.errors.some(e => e.path.indexOf('$.corrections[0].fields.' + field) === 0), field + ' path');
  }
  const wrongTarget = clone(base);
  wrongTarget.corrections[0].target = { type: 'learningTask', namespace: 'ec-store:learningTasks', id: 't', expected_updated_at: 1, expected_hash: 'sha256:' + '3'.repeat(64) };
  const wt = await parse(wrongTarget);
  assert.equal(wt.ok, false);
  assert.ok(wt.errors.some(e => /target\.type/.test(e.path)));
  const empty = clone(base); empty.corrections[0].fields = {};
  assert.equal((await parse(empty)).ok, false);
});

test('null, empty, boolean, array and object numerics are never coerced to zero/new; real zero survives', async () => {
  const base = clone(template);
  base.activities[0].question_count = null;
  base.activities[0].correct_count = null;
  base.activities[0].practice_type = null;
  const nulls = await parse(base);
  assert.equal(nulls.ok, true, JSON.stringify(nulls.errors));
  assert.equal(nulls.value.activities[0].correct_count, null);
  assert.equal(nulls.value.activities[0].practice_type, null);
  const zero = clone(base);
  zero.activities[0].question_count = 6; zero.activities[0].correct_count = 0;
  const z = await parse(zero);
  assert.equal(z.value.activities[0].correct_count, 0);
  for (const bad of [true, false, [], [0], {}, '3']) {
    const obj = clone(base);
    obj.activities[0].question_count = bad;
    const r = await parse(obj);
    assert.equal(r.ok, false, 'question_count ' + JSON.stringify(bad));
  }
  const nan = clone(base);
  nan.activities[0].question_count = NaN;
  assert.equal(F.normalize(nan).ok, false, 'NaN must be rejected without JSON round-trip coercion');
  const essayZero = clone(template);
  essayZero.activities.push(minimalActivity({
    activity_id: 'manual-essay', assessment: 'essay', content: '申论', practice_type: null,
    question_count: null, correct_count: null,
    essay_scores: [{ round: 'first', score: 0, max_score: 10 }]
  }));
  const ez = await parse(essayZero);
  assert.equal(ez.ok, true, JSON.stringify(ez.errors));
  assert.equal(ez.value.activities[2].essay_scores[0].score, 0);
  const zeroMax = clone(essayZero);
  zeroMax.activities[2].essay_scores = [{ round: 'first', score: 0, max_score: 0 }];
  assert.equal((await parse(zeroMax)).ok, false);
  const boolScore = clone(essayZero);
  boolScore.activities[2].essay_scores = [{ round: 'first', score: [], max_score: 10 }];
  assert.equal((await parse(boolScore)).ok, false);
});

test('unknown fields, proto object keys, invalid dates/timestamps/hashes and no-first essay are path errors', async () => {
  const unknown = clone(template); unknown.extra = true;
  const u = await parse(unknown);
  assert.equal(u.ok, false);
  assert.ok(u.errors.some(e => e.path === '$.extra' && /未知字段/.test(e.message)));

  const proto = JSON.parse(templateText);
  Object.defineProperty(proto.activities[0], '__proto__', { value: { polluted: true }, enumerable: true, configurable: true });
  const p = await F.parseText(JSON.stringify(proto));
  assert.equal(p.ok, false);
  assert.ok(p.errors.some(e => /__proto__/.test(e.path)));
  assert.equal(Object.prototype.polluted, undefined);

  const badDate = clone(template); badDate.activities[0].date = '2026-02-30';
  assert.equal((await parse(badDate)).ok, false);
  const badTime = clone(template); badTime.generated_at = 'not-a-time';
  assert.equal((await parse(badTime)).ok, false);
  const badHash = clone(template); badHash.reviews[0].target.expected_hash = 'sha256:bad';
  assert.equal((await parse(badHash)).ok, false);
  const noFirst = clone(template); noFirst.activities.push(minimalActivity({ activity_id: 'e2', assessment: 'essay', content: '申论', practice_type: null, question_count: null, correct_count: null, essay_scores: [{ round: 'reevaluation', score: 9, max_score: 10 }] }));
  const nf = await parse(noFirst);
  assert.equal(nf.ok, false);
  assert.ok(nf.errors.some(e => /essay_scores/.test(e.path)));
});

test('Work independent regressions: input immutable, source proto key, leap day, no locale sorting', async () => {
  const input = clone(template);
  const before = JSON.stringify(input);
  const r = await parse(input);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(JSON.stringify(input), before, 'format validation must not mutate original input');

  const leap = clone(template);
  leap.generated_at = '2028-02-29T10:00:00+08:00';
  assert.equal((await parse(leap)).ok, true, 'valid leap day must remain valid');

  const proto = JSON.parse(templateText);
  Object.defineProperty(proto.source, '__proto__', { value: { polluted: true }, enumerable: true, configurable: true });
  const p = await F.parseText(JSON.stringify(proto));
  assert.equal(p.ok, false);
  assert.ok(p.errors.some(e => /__proto__/.test(e.path)));
  assert.equal(Object.prototype.polluted, undefined);

  const sorted = clone(template);
  sorted.activities.push({
    activity_id: '中文', kind: 'manual', assessment: 'objective', date: '2026-11-02',
    content: '中文活动', practice_type: null, question_count: 2, correct_count: null,
    duration_precision: 'unknown'
  });
  const sr = await parse(sorted);
  assert.equal(sr.ok, true, JSON.stringify(sr.errors));
  const originalLocaleCompare = context.String.prototype.localeCompare;
  context.String.prototype.localeCompare = function () { throw new Error('HOST_LOCALE_COMPARATOR_USED'); };
  try {
    assert.doesNotThrow(() => F.semanticPayload(sr.value));
  } finally {
    context.String.prototype.localeCompare = originalLocaleCompare;
  }
});

test('bare and StudyLog-loaded format layers accept/reject the same contract cases', async () => {
  const valid = clone(template);
  valid.activities[0].practice_type = null;
  assert.equal(F.validate(valid).ok, true);
  assert.equal(BareF.validate(valid).ok, true);
  const unclassified = clone(valid);
  unclassified.activities[0].practice_type = 'unclassified';
  assert.equal(F.validate(unclassified).ok, false);
  assert.equal(BareF.validate(unclassified).ok, false);
  const badGroup = clone(valid);
  badGroup.activities[0].groups = [{ label: 'g'.repeat(121) }];
  assert.equal(F.validate(badGroup).ok, false);
  assert.equal(BareF.validate(badGroup).ok, false);
  const nullArray = clone(valid);
  nullArray.activities[0].groups = null;
  assert.equal(F.validate(nullArray).ok, false);
  assert.equal(BareF.validate(nullArray).ok, false);
});

test('real calendar timestamps, optional null shape, review array caps and StudyLog-aligned text limits are strict', async () => {
  for (const field of ['generated_at', 'occurred_at', 'reviewed_at']) {
    const obj = clone(template);
    if (field === 'generated_at') obj.generated_at = '2026-02-30T10:00:00Z';
    else if (field === 'occurred_at') obj.activities[0].occurred_at = '2026-02-30T10:00:00Z';
    else obj.reviews[0].reviewed_at = '2026-02-30T10:00:00Z';
    const r = await parse(obj);
    assert.equal(r.ok, false, field + ' must not roll 2026-02-30 into March');
    assert.ok(r.errors.some(e => e.path.indexOf(field) >= 0), field + ' path');
  }
  const nulls = clone(template);
  nulls.source.label = null;
  nulls.notes = null;
  nulls.activities[0].module = null;
  nulls.activities[0].groups = null;
  nulls.activities[0].wrong_questions = null;
  nulls.activities[0].essay_scores = null;
  nulls.reviews[0].primary_cause = null;
  nulls.reviews[0].knowledge_points = null;
  nulls.reviews[0].next_actions = null;
  const nr = await parse(nulls);
  assert.equal(nr.ok, false);
  for (const suffix of ['source.label', 'notes', 'module', 'groups', 'wrong_questions', 'essay_scores', 'primary_cause', 'knowledge_points', 'next_actions']) {
    assert.ok(nr.errors.some(e => e.path.indexOf(suffix) >= 0), 'null shape path ' + suffix);
  }
  const allowedNulls = clone(template);
  allowedNulls.activities[0].task_id = null;
  allowedNulls.activities[0].retest_status = null;
  allowedNulls.activities[0].practice_type = null;
  allowedNulls.activities[0].occurred_at = null;
  const an = await parse(allowedNulls);
  assert.equal(an.ok, true, JSON.stringify(an.errors));
  const caps = clone(template);
  caps.reviews[0].next_actions = Array(31).fill('action');
  caps.reviews[0].secondary_causes = Array(21).fill('cause');
  caps.reviews[0].knowledge_points = Array(31).fill('point');
  const cap = await parse(caps);
  assert.equal(cap.ok, false);
  assert.ok(cap.errors.some(e => /next_actions/.test(e.path)));
  assert.ok(cap.errors.some(e => /secondary_causes/.test(e.path)));
  assert.ok(cap.errors.some(e => /knowledge_points/.test(e.path)));
  const longTexts = clone(template);
  longTexts.activities[0].groups = [{ label: 'g'.repeat(121) }];
  longTexts.activities[0].wrong_questions = [{ question_no: '1', primary_cause: 'p'.repeat(121) }];
  const lt = await parse(longTexts);
  assert.equal(lt.ok, false);
  assert.ok(lt.errors.some(e => /groups\[0\]\.label/.test(e.path)));
  assert.ok(lt.errors.some(e => /wrong_questions\[0\]\.primary_cause/.test(e.path)));
});

test('content hashes are stable across audit/version fields and change with business content', async () => {
  const rec = { id: 'log-1', schema: 'examcard.study-log/v2', kind: 'external', assessment: 'objective', status: 'active', date: '2026-11-02', content: 'A', questionCount: 2, correctCount: 1, source: 's', externalId: 'e', revision: 1, revisions: [{ x: 1 }], createdAt: 1, updatedAt: 2 };
  const h1 = await F.contentHashFor('studyLog', rec);
  const h2 = await F.contentHashFor('studyLog', Object.assign({}, rec, { revision: 9, revisions: [], updatedAt: 999, createdAt: 3 }));
  assert.equal(h1, h2);
  const h3 = await F.contentHashFor('studyLog', Object.assign({}, rec, { content: 'B' }));
  assert.notEqual(h1, h3);
  const task = { id: 't', content: 'x', updatedAt: 1 };
  const t1 = await F.contentHashFor('learningTask', task);
  const t2 = await F.contentHashFor('learningTask', Object.assign({}, task, { updatedAt: 99 }));
  assert.equal(t1, t2);
  assert.match(h1, /^sha256:[0-9a-f]{64}$/);
});

test('size/row/text limits are explicit', async () => {
  assert.equal((await F.parseBytes(new Uint8Array(F.LIMITS.bytes + 1))).ok, false);
  const tooLong = clone(template);
  tooLong.activities[0].content = 'x'.repeat(3001);
  assert.equal((await parse(tooLong)).ok, false);
  const tooMany = clone(template);
  tooMany.activities = Array.from({ length: F.LIMITS.activities + 1 }, (_, i) => minimalActivity({ activity_id: 'a' + i }));
  const tm = await parse(tooMany);
  assert.equal(tm.ok, false);
  assert.ok(tm.errors.some(e => /activities/.test(e.path)));
});

test('validated normalization is schema-valid, and schema/runtime agree on field/type/whitelist cases', async () => {
  const r = await F.parseText(templateText);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  if (!Ajv2020) return;
  const validate = new Ajv2020({ strict: false, allowUnionTypes: true }).compile(schema);
  assert.equal(validate(r.value), true, JSON.stringify(validate.errors));
  const cases = [];
  const unknown = clone(template); unknown.unknown = 1; cases.push([unknown, false]);
  const badTarget = clone(template); badTarget.reviews[0].target.type = 'rawTable'; cases.push([badTarget, false]);
  const badExt = clone(template); badExt.activities[1].practice_type = null; cases.push([badExt, false]);
  const validTarget = clone(template); validTarget.reviews[0].target = { type: 'studyLog', namespace: 'ec-store:studyLogs', id: 'l', expected_revision: 1, expected_hash: 'sha256:' + 'a'.repeat(64) }; cases.push([validTarget, true]);
  for (const [obj, expected] of cases) {
    const rt = await parse(obj);
    const sv = validate(obj);
    assert.equal(rt.ok, expected, JSON.stringify(obj));
    assert.equal(sv, expected, JSON.stringify(validate.errors));
  }
});

test('correction/activity/review validation paths do not accept __proto__ ID values as object keys', async () => {
  const obj = clone(template);
  obj.source.ref = '__proto__';
  obj.activities[0].activity_id = '__proto__';
  obj.reviews[0].review_id = '__proto__';
  obj.reviews[0].target.id = '__proto__';
  const r = await parse(obj);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.value.source.ref, '__proto__');
  assert.equal(Object.prototype.polluted, undefined);
  const bad = clone(template);
  bad.corrections = [{
    correction_id: 'c', target: { type: 'studyLog', namespace: 'ec-store:studyLogs', id: 'l', expected_revision: 1, expected_hash: 'sha256:' + '1'.repeat(64) },
    reason: 'r', fields: JSON.parse('{"__proto__":{"polluted":true}}')
  }];
  const b = await parse(bad);
  assert.equal(b.ok, false);
  assert.ok(b.errors.some(e => /__proto__/.test(e.path)));
});
