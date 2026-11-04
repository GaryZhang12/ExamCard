/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright 2026 ExamCard contributors */
/* WP10 Stage B: structured review exchange preview/commit/undo.
   Pure parsing lives in review-exchange-format.js. This file owns IDB reads/writes,
   an opaque in-memory preview map, one-copy transaction plans and lifecycle epoch. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReviewExchange = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';
  var F = root.ReviewExchangeFormat;
  var SL = root.StudyLog;
  var INDEX_KEY = 'reviewExchangeIndex';
  var BATCH_PREFIX = 'reviewExchangeBatch:';
  var ENTITY_PREFIX = 'reviewExchangeEntity:';
  var FINGERPRINT_PREFIX = 'reviewExchangeFingerprint:';
  var REF_PREFIX = 'reviewExchangeRef:';
  var CORRECTION_FIELDS = {
    content: 'content', date: 'date', module: 'module', topic: 'topic',
    knowledge_point: 'knowledgePoint', question_count: 'questionCount',
    correct_count: 'correctCount', duration_seconds: 'durationSeconds',
    duration_minutes: 'durationMinutes', duration_precision: 'durationPrecision',
    duration_unit: 'durationUnit', groups: 'groups', wrong_questions: 'wrongQuestions',
    essay_scores: 'essayScores', note: 'note'
  };
  var state = { epoch: 1, previews: new Map(), activeTx: null, mutationGuard: null, maintenance: false, maintenanceCount: 0, lastPreviewSeq: 0 };
  var cancelledCode = 'review-exchange-cancelled';

  function err(code, message, details) {
    var e = new Error(message || code);
    e.code = code;
    if (details) e.details = details;
    return e;
  }
  function isCancelled(e) { return !!(e && (e.code === cancelledCode || e.cancelled === true)); }
  function nowMs() { return Date.now(); }
  function uid() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
    return 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function deepFreeze(v) {
    if (!v || typeof v !== 'object' || Object.isFrozen(v)) return v;
    Object.freeze(v);
    Object.keys(v).forEach(function (k) { deepFreeze(v[k]); });
    return v;
  }
  function hashId(s) { return 'sha256:' + String(s).replace(/^sha256:/, ''); }
  function hexOf(hash) { return String(hash).replace(/^sha256:/, ''); }
  function randomToken() { return uid(); }
  function assertDeps() {
    if (!F) throw err('format-missing', '复盘格式模块未加载');
    if (!SL) throw err('studylog-missing', '学习记录模型未加载');
    if (!root.ExamStore) throw err('store-missing', '数据库模块未加载');
  }
  function reqp(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('IndexedDB 请求失败')); };
    });
  }
  function txDone(tx) {
    return new Promise(function (resolve, reject) {
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error || new Error('IndexedDB 事务失败')); };
      tx.onabort = function () { reject(tx.error || err('aborted', '事务已取消')); };
    });
  }
  async function openDb() {
    if (!root.ExamStore || !root.ExamStore.open) throw err('store-missing', '数据库模块未加载');
    return root.ExamStore.open();
  }
  async function getAll(db, store) {
    var tx = db.transaction(store, 'readonly');
    return reqp(tx.objectStore(store).getAll());
  }
  async function getOne(db, store, key) {
    var tx = db.transaction(store, 'readonly');
    return reqp(tx.objectStore(store).get(key));
  }
  async function getMeta(db, key) {
    var tx = db.transaction('meta', 'readonly');
    var row = await reqp(tx.objectStore('meta').get(key));
    return row ? row.value : null;
  }
  async function setMeta(db, key, value) {
    var tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put({ key: key, value: value });
    await txDone(tx);
  }
  async function readPrefix(db, prefix) {
    var tx = db.transaction('meta', 'readonly');
    var out = [];
    return new Promise(function (resolve, reject) {
      var range = IDBKeyRange.bound(prefix, prefix + '\uffff');
      var r = tx.objectStore('meta').openCursor(range);
      r.onerror = function () { reject(r.error); };
      r.onsuccess = function () {
        var cur = r.result;
        if (!cur) { resolve(out); return; }
        out.push({ key: cur.key, value: cur.value });
        cur.continue();
      };
    });
  }
  function storeList(db, includeBank) {
    var names = ['meta', 'studyLogs', 'learningTasks', 'gradingRecords', 'essayReviews'];
    if (includeBank && db.objectStoreNames.contains('bankAttempts')) names.push('bankAttempts');
    return names;
  }
  function includeBankForTargets(targets, db) {
    return targets.some(function (t) { return t.type === 'bankAttempt'; });
  }

  function readSourceBytes(source) {
    if (!source) return Promise.reject(err('source-missing', '没有可读取的源文件'));
    if (source.file && typeof source.file.arrayBuffer === 'function') {
      return source.file.arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
    }
    if (typeof source.arrayBuffer === 'function') {
      return source.arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
    }
    if (source.bytes && source.bytes.buffer && typeof source.bytes.byteLength === 'number') {
      return Promise.resolve(new Uint8Array(source.bytes.buffer, source.bytes.byteOffset || 0, source.bytes.byteLength).slice());
    }
    if (source.buffer && typeof source.byteLength === 'number') {
      return Promise.resolve(new Uint8Array(source.buffer, source.byteOffset || 0, source.byteLength).slice());
    }
    return Promise.reject(err('source-missing', '源文件不可读取；请重新选择文件'));
  }

  function externalKeyOf(log) {
    return log && log.source && log.externalId ? SL.externalKeyFor(log.source, log.externalId) : null;
  }
  function activitySemantic(rec) {
    var c = SL.auditSnapshot(rec);
    ['id', 'createdAt', 'updatedAt', 'revision', 'revisions', 'externalKey', 'deletedAt', 'deletedReason'].forEach(function (k) { delete c[k]; });
    c.status = 'active';
    return F.canonicalize(c);
  }
  function businessSnapshot(rec) { return SL.auditSnapshot(rec); }
  function studyLogPatchFromCorrection(fields) {
    var out = {};
    Object.keys(fields || {}).forEach(function (k) {
      var camel = CORRECTION_FIELDS[k];
      if (!camel) return;
      if (k === 'groups') out[camel] = (fields[k] || []).map(function (g) { return { label: g.label, questionCount: g.question_count, correctCount: g.correct_count, durationSeconds: g.duration_seconds }; });
      else if (k === 'wrong_questions') out[camel] = (fields[k] || []).map(function (w) {
        return {
          questionNo: w.question_no, questionType: w.question_type, knowledgePoint: w.knowledge_point,
          primaryCause: w.primary_cause, secondaryCauses: (w.secondary_causes || []).slice(),
          method: w.method, logicSymbols: w.logic_symbols, reasoning: w.reasoning,
          retestHistory: (w.retest_history || []).map(function (h) { return { date: h.date, status: h.status, score: h.score, maxScore: h.max_score, note: h.note }; })
        };
      });
      else if (k === 'essay_scores') out[camel] = (fields[k] || []).map(function (s) { return { round: s.round, score: s.score, maxScore: s.max_score, reviewedAt: s.reviewed_at, reviewer: s.reviewer, note: s.note }; });
      else out[camel] = fields[k];
    });
    return out;
  }
  function businessPatchFromSnapshot(snapshot) {
    var out = {};
    Object.keys(CORRECTION_FIELDS).forEach(function (snake) {
      var camel = CORRECTION_FIELDS[snake];
      if (snapshot && Object.prototype.hasOwnProperty.call(snapshot, camel)) out[camel] = clone(snapshot[camel]);
    });
    return out;
  }
  async function stableStudyLogId(activity, sourceNs) {
    var identity = F.activityIdentity(activity, sourceNs);
    var h = await F.payloadSha256(new TextEncoder().encode(identity));
    return 'rx-' + (activity.kind === 'external' ? 'e-' : 'm-') + hexOf(h).slice(0, 48);
  }
  function occurredCreatedAt(activity, fallback) {
    if (!activity || !activity.occurred_at) return fallback;
    var t = Date.parse(activity.occurred_at);
    return isFinite(t) ? t : fallback;
  }
  function materializeStudyLog(activity, id, now) {
    var mapped = F.toStudyLog(activity);
    mapped.id = id;
    mapped.status = 'active';
    mapped.createdAt = occurredCreatedAt(activity, now);
    return SL.assertValid(mapped, { now: now });
  }
  async function ownerBatchFor(db, type, id, revision) {
    if (type !== 'studyLog') return null;
    var index = await getMeta(db, INDEX_KEY);
    var list = (index && Array.isArray(index.batches) ? index.batches : []).slice().sort(function (a, b) { return (b.importedAt || 0) - (a.importedAt || 0); });
    for (var i = 0; i < list.length; i++) {
      var b = await getMeta(db, BATCH_PREFIX + list[i].batchId);
      if (!b || (b.status !== 'committed' && b.status !== 'undone')) continue;
      var found = (b.operations || []).some(function (op) {
        return op.studyLogId === id && (op.type === 'create' || op.type === 'revive' || (op.type === 'correction' && op.afterRevision === revision));
      });
      if (found) return b;
    }
    return null;
  }
  async function refHashFor(target) {
    return F.payloadSha256(new TextEncoder().encode(F.targetIdentity(target)));
  }

  function publicError(e) {
    if (!e) return { code: 'unknown', message: '未知错误' };
    return { code: e.code || 'error', message: e.message || String(e), details: e.details || null };
  }
  function assertEpoch(epoch, code) {
    if (state.maintenance) throw err(cancelledCode, '正在恢复/清空数据，复盘操作已取消');
    if (epoch != null && epoch !== state.epoch) throw err(cancelledCode, '复盘预览已失效，请重新选择文件');
  }

  // -------- preview -------------------------------------------------------
  async function preview(source, options) {
    assertDeps();
    if (state.maintenance) throw err(cancelledCode, '正在恢复/清空数据，暂不能导入');
    var epoch = state.epoch;
    var now = nowMs();
    var bytes = await readSourceBytes(source);
    var parsed = await F.parseBytes(bytes, options);
    if (!parsed.ok) throw err('format-invalid', '复盘 JSON 校验失败', parsed.errors);
    var db = await openDb();
    assertEpoch(epoch);
    var plan = await buildPlan(db, parsed, source, now, epoch);
    assertEpoch(epoch);
    var token = randomToken();
    var sourceFile = source && typeof source.arrayBuffer === 'function' && typeof source.name === 'string' ? source : (source.file || null);
    var entry = {
      token: token, epoch: epoch, createdAt: now,
      sourceRef: sourceFile ? { file: sourceFile, name: sourceFile.name || '', size: sourceFile.size, lastModified: sourceFile.lastModified } : { bytes: bytes.slice(), name: source.name || '' },
      payloadSha256: parsed.payloadSha256,
      semanticFingerprint: parsed.semanticFingerprint,
      plan: plan
    };
    state.previews.set(token, entry);
    return { ok: true, token: token, plan: publicPlan(entry.plan) };
  }
  function publicPlan(p) {
    return {
      status: p.status, canCommit: p.canCommit, requiresReimport: !!p.requiresReimport,
      blockers: p.blockers, duplicateOf: p.duplicateOf || null,
      batchId: p.batchId, fingerprint: p.fingerprint, payloadSha256: p.payloadSha256,
      source: p.source, generatedAt: p.generatedAt, counts: p.counts,
      activities: p.activities.map(function (a) {
        return { activity_id: a.activity_id, kind: a.kind, source: a.source || null, external_id: a.external_id || null,
          studyLogId: a.studyLogId, action: a.action, activityHash: a.activityHash, existingId: a.existingId || null,
          content: a.content, module: a.module, date: a.date };
      }),
      reviews: p.reviews.map(function (r) {
        return { review_id: r.review_id, target: r.target, summary: r.summary, primary_cause: r.primary_cause,
          secondary_causes: r.secondary_causes, reviewed_at: r.reviewed_at, entityKey: r.entityKey,
          sourceBatchId: r.sourceBatchId || null, action: r.action };
      }),
      corrections: p.corrections.map(function (c) {
        return { correction_id: c.correction_id || null, target: c.target, reason: c.reason,
          fields: c.fields, beforeRevision: c.beforeRevision, afterRevision: c.afterRevision, action: c.action };
      }),
      previouslyUndone: !!p.previouslyUndone, supersedesUndoneBatchId: p.supersedesUndoneBatchId || null
    };
  }

  async function buildPlan(db, parsed, source, now, epoch) {
    var p = {
      batchId: parsed.value.batch_id,
      producerBatchId: parsed.value.batch_id,
      source: parsed.value.source,
      generatedAt: parsed.value.generated_at,
      payloadSha256: parsed.payloadSha256,
      fingerprint: parsed.semanticFingerprint,
      normalized: parsed.value,
      blockers: [], activities: [], reviews: [], corrections: [],
      counts: { activities: 0, newActivities: 0, noopActivities: 0, reviveActivities: 0, reviews: 0, corrections: 0 },
      canCommit: true, status: 'ready', duplicateOf: null, previouslyUndone: false
    };
    var index = await getMeta(db, INDEX_KEY);
    var oldBatch = await getMeta(db, BATCH_PREFIX + p.batchId);
    var fp = await getMeta(db, FINGERPRINT_PREFIX + p.fingerprint);
    if (oldBatch) {
      if (oldBatch.semanticFingerprint === p.fingerprint) {
        if (oldBatch.status === 'committed') { p.status = 'duplicate'; p.duplicateOf = oldBatch.batchId; p.canCommit = false; }
        else if (oldBatch.status === 'undone') { p.status = 'previously-undone'; p.previouslyUndone = true; p.supersedesUndoneBatchId = oldBatch.batchId; p.canCommit = false; }
      } else if (oldBatch.status === 'committed') {
        p.blockers.push({ path: 'batch_id', message: '同一 batch_id 已存在不同语义内容' });
      } else if (oldBatch.status === 'undone') {
        p.previouslyUndone = true; p.supersedesUndoneBatchId = oldBatch.batchId;
      }
    }
    if (fp && fp.batchId !== p.batchId) {
      if (fp.status === 'committed') { p.status = 'duplicate'; p.duplicateOf = fp.batchId; p.canCommit = false; }
      else if (fp.status === 'undone') { p.previouslyUndone = true; p.supersedesUndoneBatchId = fp.batchId; if (p.status === 'ready') p.status = 'previously-undone'; p.canCommit = false; }
    }
    if (p.blockers.length) { p.canCommit = false; p.status = 'blocked'; return deepFreeze(p); }
    if (p.status === 'duplicate') return deepFreeze(p);

    var logs = await getAll(db, 'studyLogs');
    var tasks = await getAll(db, 'learningTasks');
    var logById = new Map(), logByExt = new Map();
    logs.forEach(function (l) {
      if (!l || !l.id) return;
      logById.set(l.id, l);
      var k = externalKeyOf(l);
      if (k) {
        if (!logByExt.has(k)) logByExt.set(k, []);
        logByExt.get(k).push(l);
      }
    });
    var targetCache = new Map();
    async function readTarget(store, key) {
      var ck = store + '\u0000' + key;
      if (!targetCache.has(ck)) targetCache.set(ck, await getOne(db, store, key));
      return targetCache.get(ck);
    }
    async function targetSnapshot(t, path) {
      if (!t || typeof t !== 'object') return { error: 'target 缺失' };
      if (t.type === 'batchActivity') {
        var a = p.activities.filter(function (x) { return x.activity_id === t.id; })[0];
        if (!a) return { error: 'batchActivity 不存在于本批 activities' };
        var ah = a.activityHash;
        if (t.expected_hash !== ah) return { error: 'batchActivity expected_hash 不匹配（禁止零 hash/猜测）' };
        return { record: a.activity, canonical: F.canonicalize(a.activity), revision: 0, updatedAt: null, hash: ah, sourceBatchId: null };
      }
      if (t.type === 'studyLog') {
        var l = logById.get(t.id);
        if (!l) return { error: 'studyLog 目标不存在' };
        if (l.status === 'deleted' || l.deletedAt != null) return { error: 'studyLog 目标已删除' };
        if (Number(l.revision || 0) !== Number(t.expected_revision)) return { error: 'studyLog expected_revision 不匹配' };
        var h = await F.contentHashFor('studyLog', l);
        if (h !== t.expected_hash) return { error: 'studyLog expected_hash 不匹配' };
        var owner = await ownerBatchFor(db, 'studyLog', t.id, Number(l.revision || 0));
        return { record: l, canonical: F.canonicalize(l), revision: Number(l.revision || 0), updatedAt: null, hash: h, sourceBatchId: owner ? owner.batchId : null };
      }
      if (t.type === 'learningTask') {
        var task = tasks.filter(function (x) { return x.id === t.id; })[0];
        if (!task) return { error: 'learningTask 目标不存在' };
        if (Number(task.updatedAt || 0) !== Number(t.expected_updated_at)) return { error: 'learningTask expected_updated_at 不匹配' };
        var th = await F.contentHashFor('learningTask', task);
        if (th !== t.expected_hash) return { error: 'learningTask expected_hash 不匹配' };
        return { record: task, canonical: F.canonicalize(task), revision: null, updatedAt: Number(task.updatedAt || 0), hash: th, sourceBatchId: null };
      }
      var store = t.type === 'gradingRecord' ? 'gradingRecords' : t.type === 'bankAttempt' ? 'bankAttempts' : 'essayReviews';
      if (t.type === 'bankAttempt' && !db.objectStoreNames.contains('bankAttempts')) return { error: 'v5/22 题库不可用；bankAttempt target 不允许，且不会自动升级' };
      var rec = await readTarget(store, t.id);
      if (!rec) return { error: targetLabel(t.type) + ' 目标不存在' };
      var h2 = await F.contentHashFor(t.type, rec);
      if (h2 !== t.expected_hash) return { error: targetLabel(t.type) + ' expected_hash 不匹配' };
      return { record: rec, canonical: F.canonicalize(rec), revision: null, updatedAt: null, hash: h2, sourceBatchId: null };
    }
    function targetLabel(type) { return type; }

    // activities
    for (var i = 0; i < p.normalized.activities.length; i++) {
      var a = p.normalized.activities[i];
      var path = 'activities[' + i + ']';
      var sid = await stableStudyLogId(a, p.source);
      var extKey = a.kind === 'external' ? SL.externalKeyFor(a.source, a.external_id) : null;
      var existing = null;
      if (a.kind === 'external') {
        var matches = logByExt.get(extKey) || [];
        if (matches.length > 1) { p.blockers.push({ path: path + '.external_id', message: '同一 source+external_id 存在多条记录，拒绝猜测' }); continue; }
        existing = matches[0] || null;
      } else {
        existing = logById.get(sid) || null;
      }
      var action = 'create', existingId = null, revive = false, beforeRevision = null;
      if (existing) {
        // Compare business content, not the app-generated id/audit fields.
        var tmp = materializeStudyLog(a, sid, now);
        var same = F.canonicalize(activitySemantic(existing)) === F.canonicalize(activitySemantic(tmp));
        if (existing.status === 'deleted' || existing.deletedAt != null) {
          var owner = await ownerBatchFor(db, 'studyLog', existing.id, Number(existing.revision || 0));
          if (same && owner && owner.status === 'undone') { action = 'revive'; existingId = existing.id; revive = true; beforeRevision = Number(existing.revision || 0); p.previouslyUndone = true; p.supersedesUndoneBatchId = p.supersedesUndoneBatchId || owner.batchId; p.counts.reviveActivities++; }
          else { p.blockers.push({ path: path, message: '已删除的 same-identity 记录不能静默复活；只有显式撤销批次的重新导入可处理' }); continue; }
        } else if (same) {
          action = 'noop'; existingId = existing.id; p.counts.noopActivities++;
        } else {
          p.blockers.push({ path: path, message: '相同 source+externalId / manual 身份已存在不同内容' }); continue;
        }
      }
      var activityHash = await F.contentHashFor('batchActivity', a);
      var activityOwner = null, activityLogHash = null, activityRefHash = null;
      if (existing) {
        activityOwner = await ownerBatchFor(db, 'studyLog', existing.id, Number(existing.revision || 0));
        activityLogHash = await F.contentHashFor('studyLog', existing);
        activityRefHash = await refHashFor({ type: 'studyLog', namespace: 'ec-store:studyLogs', id: existing.id });
      }
      p.activities.push({
        activity_id: a.activity_id, kind: a.kind, source: a.source || null, external_id: a.external_id || null,
        activity: a, studyLogId: existingId || sid, existingId: existingId, action: action, revive: revive,
        beforeRevision: beforeRevision,
        sourceBatchId: activityOwner ? activityOwner.batchId : null,
        studyLogHash: activityLogHash, refHash: activityRefHash,
        activityHash: activityHash, expectedHash: 'sha256:' + '0'.repeat(64),
        content: a.content, module: a.module, date: a.date
      });
      if (action === 'create') p.counts.newActivities++;
    }

    // corrections (validate pre-review snapshots)
    for (var ci = 0; ci < p.normalized.corrections.length; ci++) {
      var c = p.normalized.corrections[ci];
      var cpath = 'corrections[' + ci + ']';
      var snap = await targetSnapshot(c.target, cpath + '.target');
      if (snap.error) { p.blockers.push({ path: cpath + '.target', message: snap.error }); continue; }
      var current = snap.record;
      if (!current || current.status === 'deleted' || current.deletedAt != null) { p.blockers.push({ path: cpath + '.target', message: 'correction 目标不可用' }); continue; }
      var patch = studyLogPatchFromCorrection(c.fields);
      var after;
      try { after = SL.applyUpdate(current, patch, { expectedRevision: Number(c.target.expected_revision), reason: c.reason, now: now }); }
      catch (e) { p.blockers.push({ path: cpath, message: e.message }); continue; }
      p.corrections.push({ correction_id: c.correction_id || null, target: c.target, reason: c.reason, fields: c.fields,
        patch: patch, before: current, beforeBusiness: businessSnapshot(current), beforeRevision: Number(current.revision || 0),
        after: after, afterRevision: Number(after.revision || 0), targetCanonical: snap.canonical,
        sourceBatchId: snap.sourceBatchId || null });
      p.counts.corrections++;
    }

    // reviews; target snapshots are pre-correction by definition
    for (var ri = 0; ri < p.normalized.reviews.length; ri++) {
      var r = p.normalized.reviews[ri];
      var rpath = 'reviews[' + ri + ']';
      var rs = await targetSnapshot(r.target, rpath + '.target');
      if (rs.error) { p.blockers.push({ path: rpath + '.target', message: rs.error }); continue; }
      var entityId = hexOf(await F.reviewEntityKey(p.source, r.review_id));
      var entityKey = ENTITY_PREFIX + entityId;
      var existingEntity = await getMeta(db, entityKey);
      if (existingEntity && p.status !== 'duplicate') {
        p.blockers.push({ path: rpath + '.review_id', message: '同一 producer + review_id 已存在；改内容/目标必须人工处理，不能覆盖' });
        continue;
      }
      var refHash = await refHashFor(r.target);
      p.reviews.push({ review_id: r.review_id, target: r.target, summary: r.summary, primary_cause: r.primary_cause,
        secondary_causes: r.secondary_causes, knowledge_points: r.knowledge_points, next_actions: r.next_actions,
        reviewed_at: r.reviewed_at, note: r.note, entityId: entityId, entityKey: entityKey,
        targetCanonical: rs.canonical, targetHash: rs.hash, targetUpdatedAt: rs.updatedAt,
        sourceBatchId: rs.sourceBatchId || null, refHash: refHash, action: 'create' });
      p.counts.reviews++;
    }
    // Add ref hashes for corrections too.
    for (var cj = 0; cj < p.corrections.length; cj++) p.corrections[cj].refHash = await refHashFor(p.corrections[cj].target);

    if (p.previouslyUndone && p.activities.some(function (a) { return a.action === 'revive'; })) {
      // explicit reimport is required; handled by commit's allowReimport flag
      p.counts.reviveActivities = p.activities.filter(function (a) { return a.action === 'revive'; }).length;
    }
    if (p.blockers.length) { p.status = 'blocked'; p.canCommit = false; }
    else if (p.status === 'duplicate') p.canCommit = false;
    else if (p.previouslyUndone) { p.status = 'previously-undone'; p.canCommit = false; }
    else p.canCommit = true;
    p.counts.activities = p.activities.length;
    return deepFreeze(p);
  }

  // -------- commit --------------------------------------------------------
  async function commit(token, options) {
    if (state.mutationGuard) throw err('busy', '另一个复盘事务正在进行，请稍后重试');
    state.mutationGuard = 'commit:' + token;
    try { return await commitInner(token, options); }
    finally { if (state.mutationGuard === 'commit:' + token) state.mutationGuard = null; }
  }
  async function commitInner(token, options) {
    assertDeps();
    options = options || {};
    var entry = state.previews.get(token);
    if (!entry) throw err('preview-missing', '预览 token 不存在或已失效；请重新选择文件');
    assertEpoch(entry.epoch);
    if (state.activeTx) throw err('busy', '另一个复盘事务正在进行');
    var bytes = await readSourceBytes(entry.sourceRef);
    var parsed = await F.parseBytes(bytes, options);
    if (!parsed.ok) throw err('source-invalid', '源文件重新解析失败；预览已失效', parsed.errors);
    if (parsed.payloadSha256 !== entry.payloadSha256 || parsed.semanticFingerprint !== entry.semanticFingerprint) {
      state.previews.delete(token);
      throw err('source-changed', '源文件字节或语义已变化；请重新预览');
    }
    assertEpoch(entry.epoch);
    var plan = entry.plan;
    if (plan.status === 'duplicate') { state.previews.delete(token); return { ok: true, status: 'duplicate', batchId: plan.duplicateOf }; }
    if (plan.blockers.length) throw err('plan-blocked', '预览存在冲突，不能提交', plan.blockers);
    if (plan.previouslyUndone && !options.allowReimport) throw err('previously-undone', '该批次/语义内容以前已撤销；请明确以新批次重新预览导入');
    if (!plan.canCommit && !(plan.previouslyUndone && options.allowReimport)) throw err('plan-not-ready', '预览未就绪');

    var db = await openDb();
    var includeBank = includeBankForTargets(plan.reviews.map(function (r) { return r.target; }).concat(plan.corrections.map(function (c) { return c.target; })), db) || db.objectStoreNames.contains('bankAttempts');
    var stores = storeList(db, includeBank);
    var finalBatchId = plan.batchId;
    var supersedes = plan.supersedesUndoneBatchId || null;
    if (options.allowReimport && plan.previouslyUndone) {
      finalBatchId = makeReimportBatchId(plan.batchId);
      supersedes = plan.supersedesUndoneBatchId || plan.duplicateOf || plan.batchId;
    }
    var commitAt = nowMs();
    var askKeys = {
      meta: [INDEX_KEY, BATCH_PREFIX + finalBatchId, FINGERPRINT_PREFIX + plan.fingerprint].concat(plan.reviews.map(function (r) { return r.entityKey; }))
    };
    var readStore = function (type) { return type === 'gradingRecord' ? 'gradingRecords' : type === 'bankAttempt' ? 'bankAttempts' : type === 'essayReview' ? 'essayReviews' : null; };
    var targetKeys = { gradingRecords: [], bankAttempts: [], essayReviews: [] };
    plan.reviews.forEach(function (r) { var s = readStore(r.target.type); if (s) targetKeys[s].push(r.target.id); });
    plan.corrections.forEach(function (c) { /* studyLogs read as getAll */ });

    return new Promise(function (resolve, reject) {
      var tx;
      try { tx = db.transaction(stores, 'readwrite'); }
      catch (e) { reject(e); return; }
      state.activeTx = tx;
      var settled = false;
      function fail(e) {
        if (settled) return;
        settled = true;
        state.activeTx = null;
        try { tx.abort(); } catch (_) {}
        reject(e);
      }
      tx.onabort = function () { if (!settled) { settled = true; state.activeTx = null; reject(tx.error || err('aborted', '事务已回滚，未写入')); } };
      tx.onerror = function () { if (!settled) { settled = true; state.activeTx = null; reject(tx.error || err('tx-error', '事务失败，未写入')); } };
      tx.oncomplete = function () {
        if (settled) return;
        settled = true; state.activeTx = null;
        if (state.epoch !== entry.epoch) { reject(err(cancelledCode, '事务完成前 epoch 已变化；请重新核对批次')); return; }
        state.previews.delete(token);
        resolve(resultOverride || { ok: true, status: 'committed', batchId: finalBatchId });
      };
      var data = { meta: {}, logs: null, tasks: null, targets: {} };
      var resultOverride = null;
      var pending = 0;
      function done() {
        if (--pending > 0) return;
        try { processCommit(); } catch (e) { fail(e); }
      }
      function ask(request, apply) {
        pending++;
        request.onsuccess = function () { apply(request.result); done(); };
        request.onerror = function () { fail(request.error || err('read-error', '读取目标失败')); };
      }
      try {
        ask(tx.objectStore('studyLogs').getAll(), function (v) { data.logs = v || []; });
        ask(tx.objectStore('learningTasks').getAll(), function (v) { data.tasks = v || []; });
        askKeys.meta.forEach(function (key) { ask(tx.objectStore('meta').get(key), function (v) { data.meta[key] = v ? v.value : null; }); });
        Object.keys(targetKeys).forEach(function (store) {
          if (!stores.includes(store)) return;
          targetKeys[store].forEach(function (key) {
            if (!key) return;
            ask(tx.objectStore(store).get(key), function (v) { data.targets[store + '\u0000' + key] = v || null; });
          });
        });
      } catch (e) { fail(e); return; }
      if (!pending) { try { processCommit(); } catch (e) { fail(e); } }

      function processCommit() {
        assertEpoch(entry.epoch);
        var index = data.meta[INDEX_KEY] || { schema: 'examcard.review-exchange-index/v1', batches: [] };
        var oldBatch = data.meta[BATCH_PREFIX + finalBatchId];
        var fp = data.meta[FINGERPRINT_PREFIX + plan.fingerprint];
        if (oldBatch) {
          if (oldBatch.semanticFingerprint === plan.fingerprint && oldBatch.status === 'committed') {
            resultOverride = { ok: true, status: 'duplicate', batchId: oldBatch.batchId };
            return;
          }
          throw err('batch-race', '批次在预览后已被写入，请刷新后重新预览');
        }
        if (fp && fp.status === 'committed' && fp.batchId !== finalBatchId) {
          resultOverride = { ok: true, status: 'duplicate', batchId: fp.batchId };
          return;
        }
        if (fp && fp.status === 'undone' && !options.allowReimport) throw err('previously-undone', '该语义批次已撤销，请明确新批次重导');
        if (plan.previouslyUndone && !options.allowReimport) throw err('previously-undone', '该批次已撤销，请明确新批次重导');

        var logs = data.logs || [];
        var logById = new Map(), logByExt = new Map();
        logs.forEach(function (l) { if (l && l.id) { logById.set(l.id, l); var k = externalKeyOf(l); if (k) { if (!logByExt.has(k)) logByExt.set(k, []); logByExt.get(k).push(l); } } });
        var taskById = new Map();
        (data.tasks || []).forEach(function (t) { if (t && t.id) taskById.set(t.id, t); });

        // Recheck/choose activity actions against current transaction snapshot.
        // plan is deeply frozen; clone its entries before recording a race no-op.
        var activityWrites = [], plannedActivities = plan.activities.map(function (a) { return Object.assign({}, a); });
        plannedActivities.forEach(function (a) {
          var existing = null;
          if (a.kind === 'external') {
            var arr = logByExt.get(SL.externalKeyFor(a.source, a.external_id)) || [];
            if (arr.length > 1) throw err('ambiguous-external', '同一 external 身份存在多条记录');
            existing = arr[0] || null;
          } else {
            existing = logById.get(a.studyLogId) || null;
          }
          if (a.action === 'create') {
            if (existing) {
              if (existing.status === 'deleted' || existing.deletedAt != null) throw err('identity-conflict', '预览后 same-identity 记录已被删除：' + a.activity_id);
              var tmp = materializeStudyLog(a.activity, a.studyLogId, commitAt);
              if (F.canonicalize(activitySemantic(existing)) !== F.canonicalize(activitySemantic(tmp))) throw err('identity-conflict', '预览后出现 same-identity 不同内容：' + a.activity_id);
              a.action = 'noop'; a.existingId = existing.id; a.studyLogId = existing.id; return;
            }
            var rec = materializeStudyLog(a.activity, a.studyLogId, commitAt);
            activityWrites.push({ action: 'create', record: rec, plan: a });
          } else if (a.action === 'noop') {
            if (!existing || existing.status === 'deleted' || existing.deletedAt != null || F.canonicalize(activitySemantic(existing)) !== F.canonicalize(activitySemantic(materializeStudyLog(a.activity, a.studyLogId, commitAt)))) throw err('identity-conflict', '预览后 noop 活动已变化：' + a.activity_id);
          } else if (a.action === 'revive') {
            if (!existing || existing.status !== 'deleted' || existing.deletedAt == null ||
                Number(existing.revision || 0) !== Number(a.beforeRevision)) {
              throw err('revive-conflict', '预览后已删除活动发生变化：' + a.activity_id);
            }
            var revived = SL.applyUpdate(existing, {}, { expectedRevision: Number(existing.revision || 0), reason: '明确以新批次重新导入已撤销活动', now: commitAt });
            activityWrites.push({ action: 'revive', record: revived, plan: a });
          }
        });

        // Validate review snapshots against pre-correction/current state.
        var reviewWrites = [];
        plan.reviews.forEach(function (r) {
          var snap;
          if (r.target.type === 'batchActivity') {
            var a = plan.activities.filter(function (x) { return x.activity_id === r.target.id; })[0];
            if (!a) throw err('target-missing', 'batchActivity 不存在');
            snap = { canonical: F.canonicalize(a.activity), revision: 0, updatedAt: null, record: a.activity };
          } else if (r.target.type === 'studyLog') {
            var l = logById.get(r.target.id);
            if (!l || l.status === 'deleted' || l.deletedAt != null) throw err('target-missing', 'studyLog 目标不存在');
            if (Number(l.revision || 0) !== Number(r.target.expected_revision)) throw err('target-changed', 'studyLog revision 已变化');
            snap = { canonical: F.canonicalize(l), revision: Number(l.revision || 0), updatedAt: null, record: l };
          } else if (r.target.type === 'learningTask') {
            var t = taskById.get(r.target.id);
            if (!t) throw err('target-missing', 'learningTask 目标不存在');
            if (Number(t.updatedAt || 0) !== Number(r.target.expected_updated_at)) throw err('target-changed', 'learningTask updatedAt 已变化');
            snap = { canonical: F.canonicalize(t), revision: null, updatedAt: Number(t.updatedAt || 0), record: t };
          } else {
            var store = readStore(r.target.type);
            var rec = data.targets[store + '\u0000' + r.target.id];
            if (!rec) throw err('target-missing', r.target.type + ' 目标不存在');
            snap = { canonical: F.canonicalize(rec), revision: null, updatedAt: null, record: rec };
          }
          if (snap.canonical !== r.targetCanonical) throw err('target-changed', '复盘目标内容已变化：' + r.target.type + '/' + r.target.id);
          var existingEntity = data.meta[r.entityKey];
          if (existingEntity) throw err('review-id-conflict', '同一 producer + review_id 已存在：' + r.review_id);
          reviewWrites.push(r);
        });

        // Validate corrections after review snapshots (reviews intentionally see pre-correction state).
        var correctionWrites = [];
        plan.corrections.forEach(function (c) {
          var cur = logById.get(c.target.id);
          if (!cur || cur.status === 'deleted' || cur.deletedAt != null) throw err('target-missing', 'correction 目标不存在');
          if (Number(cur.revision || 0) !== Number(c.beforeRevision)) throw err('target-changed', 'correction 目标 revision 已变化');
          if (F.canonicalize(cur) !== c.targetCanonical) throw err('target-changed', 'correction 目标内容已变化');
          var after = SL.applyUpdate(cur, c.patch, { expectedRevision: Number(c.target.expected_revision), reason: c.reason, now: commitAt });
          correctionWrites.push({ c: c, after: after });
        });

        // Writes happen only after every read/revalidation above.
        var operations = [];
        activityWrites.forEach(function (w) {
          tx.objectStore('studyLogs').put(w.record);
          operations.push({ type: w.action, studyLogId: w.record.id, activityId: w.plan.activity_id,
            beforeRevision: w.action === 'revive' ? Number(w.plan.beforeRevision || 0) : null,
            appliedRevision: Number(w.record.revision || 0), afterHash: null });
        });
        correctionWrites.forEach(function (w) {
          tx.objectStore('studyLogs').put(w.after);
          operations.push({ type: 'correction', studyLogId: w.after.id, correctionId: w.c.correction_id || null,
            beforeBusiness: w.c.beforeBusiness, beforeRevision: w.c.beforeRevision,
            appliedRevision: Number(w.after.revision || 0), targetTuple: w.c.target, fields: w.c.fields,
            reason: w.c.reason });
        });
        var entities = [], references = [];
        function addRef(ref) {
          if (references.some(function (x) { return x.refKey === ref.refKey; })) return;
          references.push(ref);
          tx.objectStore('meta').put({ key: ref.refKey, value: ref });
        }
        reviewWrites.forEach(function (r) {
          var entity = {
            schema: 'examcard.review-exchange-entity/v1', entityId: r.entityId,
            sourceNamespace: { kind: plan.source.kind, ref: plan.source.ref, label: plan.source.label || '' },
            reviewId: r.review_id, targetNamespace: r.target.namespace, targetType: r.target.type, targetId: r.target.id,
            targetRevision: r.target.expected_revision == null ? null : Number(r.target.expected_revision),
            targetUpdatedAt: r.target.expected_updated_at == null ? null : Number(r.target.expected_updated_at),
            targetHash: r.targetHash, sourceBatchId: r.sourceBatchId || null, summary: r.summary, primaryCause: r.primary_cause || '',
            secondaryCauses: r.secondary_causes || [], knowledgePoints: r.knowledge_points || [], nextActions: r.next_actions || [],
            reviewedAt: r.reviewed_at, note: r.note || '', status: 'active', revision: 0, revisions: [],
            createdByBatch: finalBatchId, createdAt: commitAt, updatedAt: commitAt
          };
          tx.objectStore('meta').put({ key: r.entityKey, value: entity });
          entities.push(entity);
          var refKey = REF_PREFIX + hexOf(r.refHash) + ':' + finalBatchId;
          var ref = { schema: 'examcard.review-exchange-ref/v1', refKey: refKey, batchId: finalBatchId,
            targetType: r.target.type, targetId: r.target.id, targetHash: r.targetHash,
            sourceBatchId: r.sourceBatchId || null, entityKey: r.entityKey, createdAt: commitAt, status: 'active' };
          addRef(ref);
        });
        plannedActivities.forEach(function (a) {
          if (a.action !== 'noop' || !a.existingId || !a.refHash) return;
          var refKey = REF_PREFIX + hexOf(a.refHash) + ':' + finalBatchId;
          var ref = { schema: 'examcard.review-exchange-ref/v1', refKey: refKey, batchId: finalBatchId,
            targetType: 'studyLog', targetId: a.existingId, targetHash: a.studyLogHash,
            sourceBatchId: a.sourceBatchId || null, entityKey: null, createdAt: commitAt, status: 'active' };
          addRef(ref);
        });
        plan.corrections.forEach(function (c) {
          var refKey = REF_PREFIX + hexOf(c.refHash) + ':' + finalBatchId;
          if (references.some(function (x) { return x.refKey === refKey; })) return;
          var ref = { schema: 'examcard.review-exchange-ref/v1', refKey: refKey, batchId: finalBatchId,
            targetType: 'studyLog', targetId: c.target.id, targetHash: c.target.expected_hash,
            sourceBatchId: c.sourceBatchId || null, entityKey: null, createdAt: commitAt, status: 'active' };
          addRef(ref);
        });
        var batch = {
          schema: 'examcard.review-exchange-batch/v1', batchId: finalBatchId,
          producerBatchId: plan.producerBatchId, source: plan.source,
          generatedAt: plan.generatedAt, importedAt: commitAt,
          payloadSha256: plan.payloadSha256, semanticFingerprint: plan.fingerprint,
          status: 'committed', counts: plan.counts,
          operations: operations,
          activities: plannedActivities.map(function (a) {
            return { activityId: a.activity_id, kind: a.kind, source: a.source || null, externalId: a.external_id || null,
              studyLogId: a.studyLogId, action: a.action, activityHash: a.activityHash, activity: clone(a.activity) };
          }),
          payload: clone(plan.normalized),
          reviews: entities.map(function (e) { return { entityKey: ENTITY_PREFIX + e.entityId, reviewId: e.reviewId,
            targetType: e.targetType, targetId: e.targetId, targetHash: e.targetHash, summary: e.summary, status: 'active' }; }),
          corrections: plan.corrections.map(function (c) { return { correctionId: c.correction_id || null, target: c.target,
            reason: c.reason, fields: c.fields, beforeBusiness: c.beforeBusiness, beforeRevision: c.beforeRevision, afterRevision: c.afterRevision }; }),
          references: references,
          supersedesUndoneBatchId: supersedes,
          undoRevision: null, undoneAt: null, undoReason: null
        };
        tx.objectStore('meta').put({ key: BATCH_PREFIX + finalBatchId, value: batch });
        tx.objectStore('meta').put({ key: FINGERPRINT_PREFIX + plan.fingerprint, value: {
          schema: 'examcard.review-exchange-fingerprint/v1', status: 'committed', batchId: finalBatchId,
          firstImportedAt: commitAt, payloadSha256: plan.payloadSha256, supersedesUndoneBatchId: supersedes
        } });
        if (!Array.isArray(index.batches)) index.batches = [];
        index.schema = 'examcard.review-exchange-index/v1';
        index.batches = index.batches.filter(function (x) { return x && x.batchId !== finalBatchId; });
        index.batches.push({ batchId: finalBatchId, producerBatchId: plan.producerBatchId, status: 'committed',
          source: plan.source, importedAt: commitAt, counts: plan.counts,
          payloadSha256: plan.payloadSha256, semanticFingerprint: plan.fingerprint, undoRevision: null });
        tx.objectStore('meta').put({ key: INDEX_KEY, value: index });
      }
    });
  }
  function makeReimportBatchId(base) {
    var b = String(base || 'review');
    var suffix = '-reimport-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    if (b.length + suffix.length > 160) b = b.slice(0, 160 - suffix.length);
    return b + suffix;
  }

  // -------- undo ----------------------------------------------------------
  async function undo(batchId, options) {
    if (state.mutationGuard) throw err('busy', '另一个复盘事务正在进行，请稍后重试');
    state.mutationGuard = 'undo:' + batchId;
    try { return await undoInner(batchId, options); }
    finally { if (state.mutationGuard === 'undo:' + batchId) state.mutationGuard = null; }
  }
  async function undoInner(batchId, options) {
    assertDeps();
    options = options || {};
    if (state.maintenance) throw err(cancelledCode, '正在恢复/清空数据，暂不能撤销');
    if (!batchId) throw err('batch-missing', '缺少批次 ID');
    var epoch = state.epoch;
    var db = await openDb();
    var batch = await getMeta(db, BATCH_PREFIX + batchId);
    if (!batch) return { ok: true, status: 'not-found' };
    if (batch.status === 'undone') return { ok: true, status: 'already-undone', batchId: batchId };
    if (batch.status !== 'committed') throw err('batch-not-active', '批次不在可撤销状态');
    var logs = await getAll(db, 'studyLogs');
    var currentById = new Map(logs.map(function (l) { return [l.id, l]; }));
    var affected = affectedStudyLogs(batch);
    affected.forEach(function (x) { var l = currentById.get(x.id); if (l) { x.source = l.source || null; x.externalId = l.externalId || null; } });
    var affectedIds = new Set(affected.map(function (x) { return x.id; }));
    var affectedExt = new Set(affected.filter(function (x) { return x.source && x.externalId; }).map(function (x) { return SL.externalKeyFor(x.source, x.externalId); }));
    var blockers = [];
    (await getAll(db, 'learningTasks')).forEach(function (t) {
      if (!t) return;
      var origin = t.retestOrigin || {};
      if (origin.logId && affectedIds.has(origin.logId)) blockers.push({ path: 'learningTasks/' + t.id, message: 'task.retestOrigin.logId 引用本批活动' });
      if (origin.source && origin.externalId && affectedExt.has(SL.externalKeyFor(origin.source, origin.externalId))) blockers.push({ path: 'learningTasks/' + t.id, message: 'task.retestOrigin.source/externalId 引用本批活动' });
      (t.retestResults || []).forEach(function (r, i) {
        if (!r) return;
        if ((r.logId && affectedIds.has(r.logId)) || (r.studyLogId && affectedIds.has(r.studyLogId))) blockers.push({ path: 'learningTasks/' + t.id + '.retestResults[' + i + ']', message: '复测结果引用本批活动' });
        if (r.source && r.externalId && affectedExt.has(SL.externalKeyFor(r.source, r.externalId))) blockers.push({ path: 'learningTasks/' + t.id + '.retestResults[' + i + ']', message: '复测结果引用本批 external 身份' });
      });
      if (t.studyLogId && affectedIds.has(t.studyLogId)) blockers.push({ path: 'learningTasks/' + t.id, message: '任务引用本批学习记录' });
    });
    batch.operations.forEach(function (op) {
      if (op.type === 'create' || op.type === 'revive') {
        var l = currentById.get(op.studyLogId);
        if (!l || l.status === 'deleted' || Number(l.revision || 0) !== Number(op.appliedRevision)) blockers.push({ path: 'studyLogs/' + op.studyLogId, message: '活动已被后续编辑/删除，不能撤销' });
      } else if (op.type === 'correction') {
        var c = currentById.get(op.studyLogId);
        if (!c || c.status === 'deleted' || Number(c.revision || 0) !== Number(op.appliedRevision)) blockers.push({ path: 'studyLogs/' + op.studyLogId, message: '更正目标已被后续编辑/删除，不能撤销' });
      }
    });
    if (blockers.length) throw err('undo-conflict', '批次存在后续引用或修改，整批撤销已拒绝', blockers);

    if (state.epoch !== epoch) throw err(cancelledCode, '撤销 epoch 已变化；请重新读取批次');
    // One readwrite transaction: live refs/tasks/current revisions are checked and all writes happen here.
    return new Promise(function (resolve, reject) {
      if (state.epoch !== epoch) { reject(err(cancelledCode, '撤销 epoch 已变化')); return; }
      var stores = storeList(db, db.objectStoreNames.contains('bankAttempts'));
      var tx;
      try { tx = db.transaction(stores, 'readwrite'); } catch (e) { reject(e); return; }
      state.activeTx = tx;
      var settled = false;
      var resultOverride = null;
      function fail(e) { if (settled) return; settled = true; state.activeTx = null; try { tx.abort(); } catch (_) {} reject(e); }
      tx.onabort = function () { if (!settled) { settled = true; state.activeTx = null; reject(tx.error || err('aborted', '撤销事务已回滚')); } };
      tx.onerror = function () { if (!settled) { settled = true; state.activeTx = null; reject(tx.error || err('tx-error', '撤销事务失败')); } };
      tx.oncomplete = function () { if (settled) return; settled = true; state.activeTx = null; resolve(resultOverride || { ok: true, status: 'undone', batchId: batchId }); };
      var data = { meta: {}, logs: null, tasks: null, refs: [] };
      var pending = 0;
      function done() { if (--pending > 0) return; try { processUndo(); } catch (e) { fail(e); } }
      function ask(req, apply) { pending++; req.onsuccess = function () { apply(req.result); done(); }; req.onerror = function () { fail(req.error); }; }
      try {
        ask(tx.objectStore('studyLogs').getAll(), function (v) { data.logs = v || []; });
        ask(tx.objectStore('learningTasks').getAll(), function (v) { data.tasks = v || []; });
        [INDEX_KEY, BATCH_PREFIX + batchId, FINGERPRINT_PREFIX + batch.semanticFingerprint].forEach(function (key) {
          ask(tx.objectStore('meta').get(key), function (v) { data.meta[key] = v ? v.value : null; });
        });
        (batch.reviews || []).forEach(function (r) {
          var ekey = r.entityKey || (r.entityId ? ENTITY_PREFIX + r.entityId : null);
          if (ekey) ask(tx.objectStore('meta').get(ekey), function (v) { data.meta[ekey] = v ? v.value : null; });
        });
        (batch.references || []).forEach(function (ref) {
          if (ref.refKey) ask(tx.objectStore('meta').get(ref.refKey), function (v) { data.meta[ref.refKey] = v ? v.value : null; });
        });
        // Read all current refs inside the transaction; this closes the TOCTOU window
        // between the preview/undo precheck and the transaction.
        pending++;
        var refReq = tx.objectStore('meta').openCursor(IDBKeyRange.bound(REF_PREFIX, REF_PREFIX + '\uffff'));
        refReq.onerror = function () { fail(refReq.error); };
        refReq.onsuccess = function () {
          var cur = refReq.result;
          if (!cur) { done(); return; }
          data.refs.push(cur.value && cur.value.value);
          cur.continue();
        };
      } catch (e) { fail(e); return; }
      if (!pending) { try { processUndo(); } catch (e) { fail(e); } }
      function processUndo() {
        if (state.epoch !== epoch) throw err(cancelledCode, '撤销 epoch 已变化');
        var liveBatch = data.meta[BATCH_PREFIX + batchId];
        if (!liveBatch) throw err('batch-missing', '批次不存在');
        if (liveBatch.status === 'undone') { resultOverride = { ok: true, status: 'already-undone', batchId: batchId }; return; }
        if (liveBatch.status !== 'committed') throw err('batch-not-active', '批次不在可撤销状态');
        var now = nowMs();
        var logsMap = new Map((data.logs || []).map(function (l) { return [l.id, l]; }));
        var fresh = [];
        (data.tasks || []).forEach(function (t) {
          var origin = t.retestOrigin || {};
          if (origin.logId && affectedIds.has(origin.logId)) fresh.push({ path: 'learningTasks/' + t.id, message: '复测任务引用本批活动' });
          if (origin.source && origin.externalId && affectedExt.has(SL.externalKeyFor(origin.source, origin.externalId))) fresh.push({ path: 'learningTasks/' + t.id, message: '复测任务引用本批 external 身份' });
          (t.retestResults || []).forEach(function (r, i) {
            if (!r) return;
            if ((r.logId && affectedIds.has(r.logId)) || (r.studyLogId && affectedIds.has(r.studyLogId))) fresh.push({ path: 'learningTasks/' + t.id + '.retestResults[' + i + ']', message: '复测结果引用本批活动' });
            if (r.source && r.externalId && affectedExt.has(SL.externalKeyFor(r.source, r.externalId))) fresh.push({ path: 'learningTasks/' + t.id + '.retestResults[' + i + ']', message: '复测结果引用本批 external 身份' });
          });
        });
        (data.refs || []).forEach(function (ref) {
          if (!ref || ref.batchId === batchId) return;
          if (ref.targetType === 'studyLog' && affectedIds.has(ref.targetId)) fresh.push({ path: 'reviewExchangeRef/' + ref.batchId, message: '后续活跃批次引用本批学习记录' });
        });
        if (fresh.length) throw err('undo-conflict', '撤销事务内发现后续引用，整批拒绝', fresh);
        liveBatch.operations.forEach(function (op) {
          if (op.type === 'create') {
            var l = logsMap.get(op.studyLogId);
            if (!l || l.status === 'deleted' || Number(l.revision || 0) !== Number(op.appliedRevision)) throw err('undo-conflict', '活动已被后续修改：' + op.studyLogId);
            tx.objectStore('studyLogs').put(SL.applyDelete(l, { expectedRevision: Number(l.revision || 0), reason: '撤销复盘批次 ' + batchId, now: now }));
          } else if (op.type === 'revive') {
            var lr = logsMap.get(op.studyLogId);
            if (!lr || lr.status === 'deleted' || Number(lr.revision || 0) !== Number(op.appliedRevision)) throw err('undo-conflict', '重新导入活动已被后续修改：' + op.studyLogId);
            tx.objectStore('studyLogs').put(SL.applyDelete(lr, { expectedRevision: Number(lr.revision || 0), reason: '撤销复盘批次（重新导入）' + batchId, now: now }));
          } else if (op.type === 'correction') {
            var cur = logsMap.get(op.studyLogId);
            if (!cur || cur.status === 'deleted' || Number(cur.revision || 0) !== Number(op.appliedRevision)) throw err('undo-conflict', '更正目标已被后续修改：' + op.studyLogId);
            var restored = SL.applyUpdate(cur, businessPatchFromSnapshot(op.beforeBusiness), { expectedRevision: Number(cur.revision || 0), reason: '撤销复盘批次更正 ' + batchId, now: now });
            if (restored.revisions && restored.revisions.length) {
              var last = restored.revisions[restored.revisions.length - 1];
              last.action = 'undo'; last.reason = '撤销复盘批次更正 ' + batchId;
            }
            tx.objectStore('studyLogs').put(restored);
          }
        });
        (liveBatch.reviews || []).forEach(function (r) {
          var ekey = r.entityKey || (r.entityId ? ENTITY_PREFIX + r.entityId : null);
          if (!ekey) return;
          var entity = data.meta[ekey];
          if (!entity) throw err('undo-conflict', '复盘实体缺失：' + ekey);
          if (entity.status === 'undone') return;
          if (entity.createdByBatch !== batchId) throw err('undo-conflict', '复盘实体不属于本批，拒绝删除');
          entity.status = 'undone'; entity.revision = Number(entity.revision || 0) + 1;
          entity.revisions = Array.isArray(entity.revisions) ? entity.revisions : [];
          entity.revisions.push({ at: now, action: 'undo', reason: '撤销复盘批次 ' + batchId, beforeBatch: batchId });
          entity.updatedAt = now;
          tx.objectStore('meta').put({ key: ekey, value: entity });
        });
        (liveBatch.references || []).forEach(function (ref) {
          if (!ref.refKey) return;
          var row = data.meta[ref.refKey];
          if (row && row.batchId === batchId) tx.objectStore('meta').delete(ref.refKey);
        });
        liveBatch.status = 'undone';
        liveBatch.undoneAt = now;
        liveBatch.undoRevision = Number(liveBatch.undoRevision || 0) + 1;
        liveBatch.undoReason = options.reason || '用户撤销复盘批次';
        tx.objectStore('meta').put({ key: BATCH_PREFIX + batchId, value: liveBatch });
        var idx = data.meta[INDEX_KEY];
        if (idx && Array.isArray(idx.batches)) {
          idx.batches.forEach(function (s) { if (s.batchId === batchId) { s.status = 'undone'; s.undoRevision = liveBatch.undoRevision; s.undoneAt = now; } });
          tx.objectStore('meta').put({ key: INDEX_KEY, value: idx });
        }
        var fkey = FINGERPRINT_PREFIX + liveBatch.semanticFingerprint;
        var fp = data.meta[fkey];
        if (fp && fp.batchId === batchId) { fp.status = 'undone'; fp.undoneAt = now; fp.undoneBatchId = batchId; tx.objectStore('meta').put({ key: fkey, value: fp }); }
      }
    });
  }
  function affectedStudyLogs(batch) {
    var map = new Map();
    (batch.operations || []).forEach(function (op) {
      if (!op.studyLogId) return;
      if (op.type === 'create' || op.type === 'revive') map.set(op.studyLogId, { id: op.studyLogId, source: null, externalId: null });
      if (op.type === 'correction') map.set(op.studyLogId, { id: op.studyLogId, source: null, externalId: null });
    });
    // external keys from batch activities
    (batch.activities || []).forEach(function (a) {
      if (a.source && a.externalId && map.has(a.studyLogId)) {
        var x = map.get(a.studyLogId); x.source = a.source; x.externalId = a.externalId;
      }
    });
    return Array.from(map.values());
  }

  async function listBatches() {
    var db = await openDb();
    var index = await getMeta(db, INDEX_KEY);
    return (index && Array.isArray(index.batches) ? index.batches : []).slice().sort(function (a, b) { return (b.importedAt || 0) - (a.importedAt || 0); });
  }
  async function getBatch(id) {
    var db = await openDb();
    return getMeta(db, BATCH_PREFIX + id);
  }
  async function listEntitiesForTarget(type, id) {
    var db = await openDb();
    var rows = await readPrefix(db, ENTITY_PREFIX);
    return rows.map(function (x) { return x.value && x.value.value; }).filter(function (e) { return e && e.targetType === type && e.targetId === id; });
  }
  function cancelPreview(token) { if (token) state.previews.delete(token); }
  function cancelPending(reason) {
    state.epoch++;
    state.previews.clear();
    var tx = state.activeTx;
    if (tx) { try { tx.abort(); } catch (e) {} state.activeTx = null; }
    return reason || '';
  }
  function stopForClear(reason) {
    state.maintenanceCount++;
    state.maintenance = true;
    return cancelPending(reason || '维护');
  }
  function resumeMaintenance() {
    state.maintenanceCount = Math.max(0, state.maintenanceCount - 1);
    state.maintenance = state.maintenanceCount > 0;
  }

  async function exportContext() {
    var db = await openDb();
    var logs = await getAll(db, 'studyLogs');
    var tasks = await getAll(db, 'learningTasks');
    var grades = await getAll(db, 'gradingRecords');
    var essays = await getAll(db, 'essayReviews');
    var banks = db.objectStoreNames.contains('bankAttempts') ? await getAll(db, 'bankAttempts') : [];
    var targets = [];
    for (const l of logs) {
      if (!l || l.status === 'deleted' || l.deletedAt != null) continue;
      targets.push({ label: [l.date, l.module, l.content].filter(Boolean).join(' · ').slice(0, 200), target: { type: 'studyLog', namespace: 'ec-store:studyLogs', id: l.id, expected_revision: Number(l.revision || 0),
        expected_hash: await F.contentHashFor('studyLog', l) } });
    }
    for (const t of tasks) {
      if (!t) continue;
      targets.push({ label: [t.date, t.title].filter(Boolean).join(' · ').slice(0, 200), target: { type: 'learningTask', namespace: 'ec-store:learningTasks', id: t.id, expected_updated_at: Number(t.updatedAt || 0),
        expected_hash: await F.contentHashFor('learningTask', t) } });
    }
    for (const g of grades) {
      if (!g || !g.attemptId) continue;
      targets.push({ label: [g.gradedAt ? new Date(g.gradedAt).toISOString().slice(0, 10) : '', g.examName || ''].filter(Boolean).join(' · ').slice(0, 200), target: { type: 'gradingRecord', namespace: 'ec-store:gradingRecords', id: g.attemptId,
        expected_hash: await F.contentHashFor('gradingRecord', g) } });
    }
    for (const b of banks) {
      if (!b || !b.id) continue;
      targets.push({ label: [b.submittedAt ? new Date(b.submittedAt).toISOString().slice(0, 10) : '', b.practiceSetId || ''].filter(Boolean).join(' · ').slice(0, 200), target: { type: 'bankAttempt', namespace: 'ec-store:bankAttempts', id: b.id,
        expected_hash: await F.contentHashFor('bankAttempt', b) } });
    }
    for (const e of essays) {
      if (!e || !e.id) continue;
      targets.push({ label: [e.importedAt ? new Date(e.importedAt).toISOString().slice(0, 10) : '', (e.overall && e.overall.totalScore != null ? e.overall.totalScore : '')].filter(Boolean).join(' · ').slice(0, 200), target: { type: 'essayReview', namespace: 'ec-store:essayReviews', id: e.id,
        expected_hash: await F.contentHashFor('essayReview', e) } });
    }
    var first = targets[0] || null;
    var generatedAt = new Date().toISOString();
    var template = {
      schema: F.SCHEMA, batch_id: 'chatgpt-review-' + generatedAt.slice(0, 10) + '-' + uid().slice(0, 8),
      source: { kind: 'chatgpt', ref: 'examcard-context-' + generatedAt.replace(/[^0-9]/g, '').slice(0, 14), label: 'ExamCard 上下文导出' },
      generated_at: generatedAt, activities: [], reviews: [], corrections: [], notes: '在 target_catalog 中选择目标，填入 review 后按 schema 校验。'
    };
    if (first) {
      template.reviews.push({
        review_id: 'review-1',
        target: clone(first.target),
        summary: '请在导入前替换为真实复盘摘要；本模板只使用导出时的真实目标 hash。',
        reviewed_at: generatedAt
      });
    }
    return {
      context: { schema: 'examcard.review-exchange-context/v1', generatedAt: generatedAt,
        appVersion: root.ExamBackup && ExamBackup.APP_VERSION || null,
        dbVersion: db.version, targetCatalog: targets,
        notes: '仅本机主动保存；不自动上传；不含 PDF Blob。targetCatalog 的 target 字段可直接用于 reviews[].target；label 只展示。' },
      template: template,
      guide: '选择 target_catalog 的真实目标；同批 activity 的 expected_hash 在预览界面计算，不能用零 hash。'
    };
  }

  root.ReviewExchange = {
    preview: preview, commit: commit, undo: undo,
    listBatches: listBatches, getBatch: getBatch, listEntitiesForTarget: listEntitiesForTarget,
    cancelPreview: cancelPreview, cancelPending: cancelPending,
    stopForClear: stopForClear, resumeMaintenance: resumeMaintenance,
    isCancelled: isCancelled, exportContext: exportContext,
    isBlockedError: function (e) { return !!(e && (e.code === 'undo-conflict' || e.code === 'plan-blocked')); },
    _test: { stableStudyLogId: stableStudyLogId, businessSnapshot: businessSnapshot,
      studyLogPatchFromCorrection: studyLogPatchFromCorrection, businessPatchFromSnapshot: businessPatchFromSnapshot,
      activitySemantic: activitySemantic, refHashFor: refHashFor, makeReimportBatchId: makeReimportBatchId,
      CORRECTION_FIELDS: CORRECTION_FIELDS }
  };
  return root.ReviewExchange;
});

