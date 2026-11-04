/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright 2026 ExamCard contributors */
/* ExamCard 1.2.0 WP10 Stage A · review-exchange/v1 pure format layer.
   No IndexedDB access, no writes, no Date.now defaults, no generated IDs.
   The JSON Schema and this validator deliberately share the same exact field
   whitelist; Stage B adds target existence/revision/hash and transactions. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReviewExchangeFormat = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  var VERSION = '1.0';
  var SCHEMA = 'examcard.review-exchange/v1';
  var LIMITS = Object.freeze({
    bytes: 2 * 1024 * 1024,
    activities: 200,
    reviews: 500,
    corrections: 200,
    text: 3000,
    longText: 20000
  });
  var PRACTICE_TYPES = ['new', 'retest', 'comprehensive', 'mock'];
  var TARGET_TYPES = ['studyLog', 'learningTask', 'gradingRecord', 'bankAttempt', 'essayReview', 'batchActivity'];
  var TARGETS = Object.freeze({
    studyLog: { type: 'studyLog', namespace: 'ec-store:studyLogs', store: 'studyLogs', keyPath: 'id', versionField: 'revision', versionRequired: true, hashExcludes: ['revisions', 'revision', 'updatedAt', 'createdAt'] },
    learningTask: { type: 'learningTask', namespace: 'ec-store:learningTasks', store: 'learningTasks', keyPath: 'id', versionField: 'updatedAt', versionRequired: true, hashExcludes: ['updatedAt'] },
    gradingRecord: { type: 'gradingRecord', namespace: 'ec-store:gradingRecords', store: 'gradingRecords', keyPath: 'attemptId', versionField: null, versionRequired: false, hashExcludes: [] },
    bankAttempt: { type: 'bankAttempt', namespace: 'ec-store:bankAttempts', store: 'bankAttempts', keyPath: 'id', versionField: null, versionRequired: false, hashExcludes: [], v6Only: true },
    essayReview: { type: 'essayReview', namespace: 'ec-store:essayReviews', store: 'essayReviews', keyPath: 'id', versionField: null, versionRequired: false, hashExcludes: [] },
    batchActivity: { type: 'batchActivity', namespace: 'batch:activity', store: 'meta', keyPath: 'reviewExchangeBatch:<batchId>.activities[].activity_id', versionField: 'expected_revision', versionRequired: true, hashExcludes: [] }
  });
  var CORRECTION_FIELDS = ['content', 'date', 'module', 'topic', 'knowledge_point', 'question_count', 'correct_count', 'duration_seconds', 'duration_minutes', 'duration_precision', 'duration_unit', 'groups', 'wrong_questions', 'essay_scores', 'note'];
  var FORBIDDEN_KEYS = Object.create(null);
  ['__proto__', 'constructor', 'prototype'].forEach(function (k) { FORBIDDEN_KEYS[k] = true; });

  function add(errors, path, message) { errors.push({ path: path, message: message }); }
  function isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function clean(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
  function isFiniteNumber(v) { return typeof v === 'number' && isFinite(v); }
  function isInteger(v) { return isFiniteNumber(v) && Math.floor(v) === v; }
  function isDateKey(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var d = new Date(s + 'T00:00:00Z');
    return isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }
  function isTimestamp(s) {
    if (typeof s !== 'string' || s.length > 40) return false;
    var m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/.exec(s);
    if (!m) return false;
    if (!isDateKey(m[1])) return false;
    var hh = Number(m[2]), mm = Number(m[3]), ss = Number(m[4]);
    if (hh > 23 || mm > 59 || ss > 59) return false;
    if (m[5] !== 'Z') {
      var oh = Number(m[7]), om = Number(m[8]);
      if (oh > 14 || om > 59 || (oh === 14 && om !== 0)) return false;
    }
    // Date.parse is still checked for a final malformed-offset guard, but the
    // raw calendar/time fields above are never normalized or rolled over.
    return isFinite(Date.parse(s));
  }
  function isHash(s) { return typeof s === 'string' && /^sha256:[0-9a-f]{64}$/.test(s); }
  function isId(s) {
    return typeof s === 'string' && s.length >= 1 && s.length <= 160 && !/[\u0000-\u001f\u007f]/.test(s);
  }
  function isShortId(s) {
    return typeof s === 'string' && s.length >= 1 && s.length <= 120 && !/[\u0000-\u001f\u007f]/.test(s);
  }
  function checkKeys(obj, allowed, path, errors) {
    if (!isPlainObject(obj)) { add(errors, path, '必须为对象'); return false; }
    Object.keys(obj).forEach(function (k) {
      if (FORBIDDEN_KEYS[k]) add(errors, path ? path + '.' + k : k, '禁止的对象属性');
      else if (allowed.indexOf(k) < 0) add(errors, path ? path + '.' + k : k, '未知字段');
    });
    return true;
  }
  function readText(obj, key, path, errors, max, required, nullable) {
    var value = obj[key];
    if (value == null) {
      if (has(obj, key) && value === null && !nullable) { add(errors, path + '.' + key, '不能为 null'); return ''; }
      if (required) add(errors, path + '.' + key, '必填');
      return '';
    }
    if (typeof value !== 'string') { add(errors, path + '.' + key, '必须为文本'); return ''; }
    if (value.length > max) add(errors, path + '.' + key, '文本过长（最多 ' + max + ' 字）');
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) add(errors, path + '.' + key, '文本含不支持字符');
    return value;
  }
  function readId(obj, key, path, errors, required, short) {
    var value = obj[key];
    if (value == null) {
      if (has(obj, key) && value === null) { add(errors, path + '.' + key, '不能为 null'); return null; }
      if (required) add(errors, path + '.' + key, '必填');
      return null;
    }
    var ok = short ? isShortId(value) : isId(value);
    if (!ok) add(errors, path + '.' + key, '必须为 1–' + (short ? 120 : 160) + ' 字且不含控制字符的文本');
    return typeof value === 'string' ? value : null;
  }
  function readNumber(obj, key, path, errors, opts) {
    opts = opts || {};
    var value = obj[key];
    if (value === undefined || value === null) {
      if (opts.required) add(errors, path + '.' + key, '必填');
      return null;
    }
    if (!isFiniteNumber(value)) { add(errors, path + '.' + key, '必须为数字，不能是字符串/数组/对象/布尔'); return null; }
    if (opts.integer && !isInteger(value)) add(errors, path + '.' + key, '必须为整数');
    if (opts.min != null && value < opts.min) add(errors, path + '.' + key, '不能小于 ' + opts.min);
    if (opts.exclusiveMin != null && value <= opts.exclusiveMin) add(errors, path + '.' + key, '必须大于 ' + opts.exclusiveMin);
    return value;
  }
  function readNullableInteger(obj, key, path, errors) { return readNumber(obj, key, path, errors, { integer: true, min: 0 }); }
  function readTimestamp(obj, key, path, errors, required) {
    var value = obj[key];
    if (value == null) { if (required) add(errors, path + '.' + key, '必填'); return null; }
    if (!isTimestamp(value)) add(errors, path + '.' + key, '必须为带时区的 ISO 时间戳');
    return typeof value === 'string' ? value : null;
  }
  function readDate(obj, key, path, errors, required) {
    var value = obj[key];
    if (value == null) { if (required) add(errors, path + '.' + key, '必填'); return null; }
    if (!isDateKey(value)) add(errors, path + '.' + key, '必须为 YYYY-MM-DD');
    return typeof value === 'string' ? value : null;
  }
  function readEnum(obj, key, path, errors, values, required, nullable) {
    var value = obj[key];
    if (value == null) {
      if (has(obj, key) && value === null && !nullable) { add(errors, path + '.' + key, '不能为 null'); return null; }
      if (required) add(errors, path + '.' + key, '必填');
      return null;
    }
    if (values.indexOf(value) < 0) add(errors, path + '.' + key, '必须为 ' + values.join('/'));
    return value;
  }

  function normalizeRetestHistory(list, path, errors) {
    var out = [];
    if (list === undefined) return out;
    if (list === null || !Array.isArray(list)) { add(errors, path, '必须为数组，不能为 null'); return out; }
    if (list.length > 50) add(errors, path, '最多 50 条');
    list.forEach(function (h, i) {
      var p = path + '[' + i + ']';
      if (!checkKeys(h, ['date', 'status', 'score', 'max_score', 'note'], p, errors)) return;
      var date = readDate(h, 'date', p, errors, true);
      var status = has(h, 'status') ? readEnum(h, 'status', p, errors, ['passed', 'failed', 'pending'], false) : 'pending';
      var score = readNumber(h, 'score', p, errors, { min: 0 });
      var max = readNumber(h, 'max_score', p, errors, { min: 0 });
      if (score != null && max != null && score > max) add(errors, p + '.score', '分数不能大于满分');
      out.push({ date: date, status: status || 'pending', score: score, max_score: max, note: readText(h, 'note', p, errors, 1000) });
    });
    return out;
  }
  function normalizeWrongQuestions(list, path, errors) {
    var out = [], seen = Object.create(null);
    if (list === undefined) return out;
    if (list === null || !Array.isArray(list)) { add(errors, path, '必须为数组，不能为 null'); return out; }
    if (list.length > 500) add(errors, path, '最多 500 条');
    list.forEach(function (w, i) {
      var p = path + '[' + i + ']';
      if (!checkKeys(w, ['question_no', 'question_type', 'knowledge_point', 'primary_cause', 'secondary_causes', 'method', 'logic_symbols', 'reasoning', 'retest_history'], p, errors)) return;
      var no = w.question_no;
      if (typeof no === 'number' && isFinite(no)) no = String(no);
      else if (typeof no === 'string') no = no.trim();
      else no = '';
      if (!no) add(errors, p + '.question_no', '题号必须为非空文本或数字');
      else if (no.length > 80) add(errors, p + '.question_no', '题号过长');
      if (no && seen[no]) add(errors, p + '.question_no', '同一活动内题号重复');
      if (no) seen[no] = true;
      var primary = readText(w, 'primary_cause', p, errors, 120, true);
      if (!clean(primary)) add(errors, p + '.primary_cause', '主要错因不能为空');
      var secondary = [];
      if (has(w, 'secondary_causes')) {
        if (w.secondary_causes === null || !Array.isArray(w.secondary_causes)) add(errors, p + '.secondary_causes', '必须为数组，不能为 null');
        else {
          if (w.secondary_causes.length > 10) add(errors, p + '.secondary_causes', '最多 10 条');
          w.secondary_causes.forEach(function (s, j) {
            if (typeof s !== 'string') { add(errors, p + '.secondary_causes[' + j + ']', '必须为文本'); return; }
            if (s.length > 120) add(errors, p + '.secondary_causes[' + j + ']', '文本过长（最多 120 字）');
            if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s)) add(errors, p + '.secondary_causes[' + j + ']', '文本含不支持字符');
            if (!clean(s)) add(errors, p + '.secondary_causes[' + j + ']', '不能为空白');
            else secondary.push(clean(s));
          });
        }
      }
      if (secondary.indexOf(clean(primary)) >= 0) add(errors, p + '.secondary_causes', '次要错因不能与主要错因相同');
      var type = has(w, 'question_type') ? readEnum(w, 'question_type', p, errors, ['single', 'multi', 'judge', 'other'], false) : 'other';
      out.push({
        question_no: no,
        question_type: type || 'other',
        knowledge_point: readText(w, 'knowledge_point', p, errors, 300),
        primary_cause: clean(primary),
        secondary_causes: secondary,
        method: readText(w, 'method', p, errors, 2000),
        logic_symbols: readText(w, 'logic_symbols', p, errors, 2000),
        reasoning: readText(w, 'reasoning', p, errors, 5000),
        retest_history: normalizeRetestHistory(w.retest_history, p + '.retest_history', errors)
      });
    });
    return out;
  }
  function normalizeGroups(list, path, errors) {
    var out = [];
    if (list === undefined) return out;
    if (list === null || !Array.isArray(list)) { add(errors, path, '必须为数组，不能为 null'); return out; }
    if (list.length > 100) add(errors, path, '最多 100 条');
    list.forEach(function (g, i) {
      var p = path + '[' + i + ']';
      if (!checkKeys(g, ['label', 'question_count', 'correct_count', 'duration_seconds'], p, errors)) return;
      var label = readText(g, 'label', p, errors, 120, true);
      if (!clean(label)) add(errors, p + '.label', '分组标签不能为空');
      var q = readNullableInteger(g, 'question_count', p, errors);
      var c = readNullableInteger(g, 'correct_count', p, errors);
      var sec = readNumber(g, 'duration_seconds', p, errors, { min: 0 });
      if (c != null && q != null && c > q) add(errors, p + '.correct_count', '正确数不能大于题量');
      out.push({ label: label, question_count: q, correct_count: c, duration_seconds: sec });
    });
    return out;
  }
  function normalizeEssayScores(list, path, errors) {
    var out = [], seen = Object.create(null);
    if (list == null) { add(errors, path, '申论记录至少需要一个评分'); return out; }
    if (!Array.isArray(list)) { add(errors, path, '必须为数组'); return out; }
    if (!list.length) add(errors, path, '申论记录至少需要一个评分');
    if (list.length > 10) add(errors, path, '最多 10 条');
    list.forEach(function (s, i) {
      var p = path + '[' + i + ']';
      if (!checkKeys(s, ['round', 'score', 'max_score', 'reviewed_at', 'reviewer', 'note'], p, errors)) return;
      var round = readEnum(s, 'round', p, errors, ['first', 'reevaluation'], true);
      if (round && seen[round]) add(errors, p + '.round', '首次评分和复评各最多一条');
      if (round) seen[round] = true;
      var score = readNumber(s, 'score', p, errors, { min: 0, required: true });
      var max = readNumber(s, 'max_score', p, errors, { exclusiveMin: 0, required: true });
      if (score != null && max != null && score > max) add(errors, p + '.score', '分数不能大于满分');
      out.push({
        round: round,
        score: score,
        max_score: max,
        reviewed_at: readTimestamp(s, 'reviewed_at', p, errors, false),
        reviewer: readText(s, 'reviewer', p, errors, 200),
        note: readText(s, 'note', p, errors, 2000)
      });
    });
    if (!seen.first) add(errors, path, '申论评分必须保留首次评分（round=first）');
    return out;
  }

  function normalizeActivity(raw, path, errors) {
    if (!isPlainObject(raw)) { add(errors, path, '必须为对象'); return null; }
    var kind = raw.kind;
    if (kind !== 'manual' && kind !== 'external') { add(errors, path + '.kind', '必须为 manual/external'); return null; }
    var keys = ['activity_id', 'kind', 'assessment', 'date', 'occurred_at', 'content', 'module', 'topic', 'knowledge_point', 'practice_type', 'question_count', 'correct_count', 'duration_seconds', 'duration_minutes', 'duration_precision', 'duration_unit', 'groups', 'wrong_questions', 'essay_scores', 'task_id', 'retest_status', 'report_ref', 'note'];
    if (kind === 'external') keys = keys.concat(['source', 'external_id']);
    checkKeys(raw, keys, path, errors);
    var assessment = readEnum(raw, 'assessment', path, errors, ['objective', 'essay'], true);
    var date = readDate(raw, 'date', path, errors, true);
    var content = readText(raw, 'content', path, errors, 3000, true);
    if (!clean(content)) add(errors, path + '.content', '学习内容不能为空');
    var occurred = readTimestamp(raw, 'occurred_at', path, errors, false);
    var practiceType = has(raw, 'practice_type') ? readEnum(raw, 'practice_type', path, errors, PRACTICE_TYPES, false, true) : null;
    var q = readNullableInteger(raw, 'question_count', path, errors);
    var c = readNullableInteger(raw, 'correct_count', path, errors);
    if (c != null && q == null) add(errors, path + '.correct_count', '填写正确数前必须填写题量');
    if (c != null && q != null && c > q) add(errors, path + '.correct_count', '正确数不能大于题量');
    var precision = readEnum(raw, 'duration_precision', path, errors, ['exact', 'estimated', 'unknown'], true);
    var seconds = readNumber(raw, 'duration_seconds', path, errors, { min: 0 });
    var minutes = readNumber(raw, 'duration_minutes', path, errors, { min: 0 });
    var unit = has(raw, 'duration_unit') ? readEnum(raw, 'duration_unit', path, errors, ['seconds', 'minutes'], false) : (seconds == null && minutes != null ? 'minutes' : 'seconds');
    if (seconds != null && minutes != null && Math.abs(seconds - minutes * 60) > 0.01) add(errors, path + '.duration_seconds', '秒数与分钟数不一致');
    if (precision === 'unknown' && (seconds != null || minutes != null)) add(errors, path + '.duration_precision', '未知用时不能同时填写时长');
    if ((precision === 'exact' || precision === 'estimated') && seconds == null && minutes == null) add(errors, path + '.duration_precision', '时间精度不是未知时必须填写时长');
    if (precision === 'exact' && raw.duration_seconds != null && seconds != null && !isInteger(seconds)) add(errors, path + '.duration_seconds', '精确秒数必须为整数');
    if (precision === 'unknown') { seconds = null; minutes = null; }
    if (seconds == null && minutes != null) seconds = minutes * 60;
    if (minutes == null && seconds != null) minutes = seconds / 60;
    var groups = normalizeGroups(raw.groups, path + '.groups', errors);
    if (groups.length) {
      var gq = 0, gc = 0, gs = 0, kq = true, kc = true, ks = true;
      groups.forEach(function (g) {
        if (g.question_count == null) kq = false; else gq += g.question_count;
        if (g.correct_count == null) kc = false; else gc += g.correct_count;
        if (g.duration_seconds == null) ks = false; else gs += g.duration_seconds;
      });
      if (q != null && kq && gq !== q) add(errors, path + '.groups', '分组题量合计必须等于总题量');
      if (c != null && kc && gc !== c) add(errors, path + '.groups', '分组正确数合计必须等于总正确数');
      if (seconds != null && ks && Math.abs(gs - seconds) > 0.01) add(errors, path + '.groups', '分组用时合计必须等于总用时');
    }
    var wrongs = normalizeWrongQuestions(raw.wrong_questions, path + '.wrong_questions', errors);
    var essays = [];
    if (assessment === 'essay') essays = normalizeEssayScores(raw.essay_scores, path + '.essay_scores', errors);
    else if (has(raw, 'essay_scores') && (raw.essay_scores === null || !Array.isArray(raw.essay_scores) || raw.essay_scores.length)) add(errors, path + '.essay_scores', '客观题记录不能包含申论评分');
    var source = null, externalId = null;
    if (kind === 'external') {
      source = readId(raw, 'source', path, errors, true, true);
      externalId = readId(raw, 'external_id', path, errors, true, true);
      if (assessment === 'objective' && PRACTICE_TYPES.indexOf(practiceType) < 0) add(errors, path + '.practice_type', '外部客观题必须填写 new/retest/comprehensive/mock');
    }
    if (assessment === 'essay') {
      if (practiceType != null) add(errors, path + '.practice_type', '申论记录不使用客观题练习类型');
      if (q != null || c != null) add(errors, path + '.assessment', '申论评分不能转换为题数/正确数');
      if (!essays.length) add(errors, path + '.essay_scores', '申论记录至少需要一个评分');
    }
    var taskId = raw.task_id == null ? null : readId(raw, 'task_id', path, errors, false);
    var retestStatus = has(raw, 'retest_status') ? readEnum(raw, 'retest_status', path, errors, ['not_required', 'pending', 'scheduled', 'passed', 'failed'], false, true) : null;
    var normalized = {
      activity_id: readId(raw, 'activity_id', path, errors, true),
      kind: kind,
      assessment: assessment || 'objective',
      date: date,
      occurred_at: occurred,
      content: content,
      module: readText(raw, 'module', path, errors, 300),
      topic: readText(raw, 'topic', path, errors, 300),
      knowledge_point: readText(raw, 'knowledge_point', path, errors, 300),
      practice_type: practiceType,
      question_count: q,
      correct_count: c,
      duration_seconds: seconds,
      duration_minutes: minutes,
      duration_precision: precision || 'unknown',
      duration_unit: unit || 'seconds',
      groups: groups,
      wrong_questions: wrongs,
      essay_scores: essays,
      task_id: taskId,
      retest_status: retestStatus,
      report_ref: readText(raw, 'report_ref', path, errors, 2000),
      note: readText(raw, 'note', path, errors, 4000)
    };
    if (kind === 'external') {
      normalized.source = source;
      normalized.external_id = externalId;
    }
    if (normalized.occurred_at == null) delete normalized.occurred_at;
    if (kind === 'manual') { delete normalized.source; delete normalized.external_id; }
    // Reuse the real StudyLog business validator when it is loaded. The format
    // layer remains pure; this only reads/validates and never writes.
    if (root.StudyLog && typeof root.StudyLog.normalize === 'function') {
      var mapped = toStudyLog(normalized);
      var sl = root.StudyLog.normalize(mapped, { now: 0 });
      sl.errors.forEach(function (e) {
        add(errors, path + '.' + String(e.path || '').replace(/^\./, '').replace(/questionCount/g, 'question_count').replace(/correctCount/g, 'correct_count').replace(/durationSeconds/g, 'duration_seconds').replace(/durationMinutes/g, 'duration_minutes').replace(/durationPrecision/g, 'duration_precision').replace(/durationUnit/g, 'duration_unit').replace(/wrongQuestions/g, 'wrong_questions').replace(/questionNo/g, 'question_no').replace(/primaryCause/g, 'primary_cause').replace(/secondaryCauses/g, 'secondary_causes').replace(/essayScores/g, 'essay_scores').replace(/maxScore/g, 'max_score').replace(/reviewedAt/g, 'reviewed_at').replace(/taskId/g, 'task_id').replace(/retestStatus/g, 'retest_status').replace(/reportRef/g, 'report_ref'), e.message);
      });
    }
    return normalized;
  }

  function validateTarget(target, path, errors) {
    if (!isPlainObject(target)) { add(errors, path, '必须为对象'); return null; }
    var type = target.type;
    if (TARGET_TYPES.indexOf(type) < 0) { add(errors, path + '.type', '不支持的 typed target：' + String(type)); return null; }
    var meta = TARGETS[type];
    var allowed = ['type', 'namespace', 'id', 'expected_hash'];
    if (type === 'studyLog' || type === 'batchActivity') allowed.push('expected_revision');
    if (type === 'learningTask') allowed.push('expected_updated_at');
    checkKeys(target, allowed, path, errors);
    if (target.namespace !== meta.namespace) add(errors, path + '.namespace', '必须为 ' + meta.namespace);
    readId(target, 'id', path, errors, true);
    if (!isHash(target.expected_hash)) add(errors, path + '.expected_hash', '必须为 sha256:<64 hex>');
    if (type === 'studyLog' || type === 'batchActivity') {
      var rev = readNumber(target, 'expected_revision', path, errors, { integer: true, min: 0, required: true });
      if (type === 'batchActivity' && rev !== 0) add(errors, path + '.expected_revision', 'batchActivity 必须为 0');
    }
    if (type === 'learningTask') readNumber(target, 'expected_updated_at', path, errors, { integer: true, min: 1, required: true });
    var out = { type: type, namespace: meta.namespace, id: target.id, expected_hash: target.expected_hash };
    if (type === 'studyLog' || type === 'batchActivity') out.expected_revision = target.expected_revision;
    if (type === 'learningTask') out.expected_updated_at = target.expected_updated_at;
    return out;
  }

  function normalizeReview(raw, path, errors) {
    if (!isPlainObject(raw)) { add(errors, path, '必须为对象'); return null; }
    checkKeys(raw, ['review_id', 'target', 'summary', 'primary_cause', 'secondary_causes', 'knowledge_points', 'next_actions', 'reviewed_at', 'note'], path, errors);
    var id = readId(raw, 'review_id', path, errors, true);
    var target = validateTarget(raw.target, path + '.target', errors);
    var summary = readText(raw, 'summary', path, errors, 5000, true);
    if (!clean(summary)) add(errors, path + '.summary', '复盘摘要不能为空');
    var secondary = [];
    if (has(raw, 'secondary_causes')) {
      if (raw.secondary_causes === null || !Array.isArray(raw.secondary_causes)) add(errors, path + '.secondary_causes', '必须为数组，不能为 null');
      else {
        if (raw.secondary_causes.length > 10) add(errors, path + '.secondary_causes', '最多 10 条');
        raw.secondary_causes.forEach(function (s, i) {
          if (typeof s !== 'string') { add(errors, path + '.secondary_causes[' + i + ']', '必须为文本'); return; }
          if (s.length > 200) add(errors, path + '.secondary_causes[' + i + ']', '文本过长（最多 200 字）');
          if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s)) add(errors, path + '.secondary_causes[' + i + ']', '文本含不支持字符');
          if (!clean(s)) add(errors, path + '.secondary_causes[' + i + ']', '不能为空白');
          else secondary.push(clean(s));
        });
      }
    }
    function texts(v, name, max, limit) {
      if (v === undefined) return [];
      if (v === null || !Array.isArray(v)) { add(errors, path + '.' + name, '必须为数组，不能为 null'); return []; }
      if (v.length > limit) add(errors, path + '.' + name, '最多 ' + limit + ' 条');
      var out = [];
      v.forEach(function (x, i) {
        if (typeof x !== 'string') { add(errors, path + '.' + name + '[' + i + ']', '必须为文本'); return; }
        if (x.length > max) add(errors, path + '.' + name + '[' + i + ']', '文本过长（最多 ' + max + ' 字）');
        if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(x)) add(errors, path + '.' + name + '[' + i + ']', '文本含不支持字符');
        if (!clean(x)) add(errors, path + '.' + name + '[' + i + ']', '不能为空白');
        else out.push(clean(x));
      });
      return out;
    }
    return {
      review_id: id,
      target: target,
      summary: summary,
      primary_cause: readText(raw, 'primary_cause', path, errors, 200),
      secondary_causes: secondary,
      knowledge_points: texts(raw.knowledge_points, 'knowledge_points', 300, 30),
      next_actions: texts(raw.next_actions, 'next_actions', 1000, 30),
      reviewed_at: readTimestamp(raw, 'reviewed_at', path, errors, true),
      note: readText(raw, 'note', path, errors, 4000)
    };
  }

  function normalizeCorrection(raw, path, errors) {
    if (!isPlainObject(raw)) { add(errors, path, '必须为对象'); return null; }
    checkKeys(raw, ['correction_id', 'target', 'reason', 'fields'], path, errors);
    var id = readId(raw, 'correction_id', path, errors, false);
    var target = validateTarget(raw.target, path + '.target', errors);
    if (target && target.type !== 'studyLog') add(errors, path + '.target.type', 'corrections 只能更正 studyLog');
    var reason = readText(raw, 'reason', path, errors, 2000, true);
    if (!clean(reason)) add(errors, path + '.reason', '更正原因不能为空');
    var f = raw.fields;
    if (!isPlainObject(f)) { add(errors, path + '.fields', '必须为对象'); return null; }
    checkKeys(f, CORRECTION_FIELDS, path + '.fields', errors);
    if (!Object.keys(f).length) add(errors, path + '.fields', '至少一个业务字段');
    var fields = {};
    CORRECTION_FIELDS.forEach(function (k) {
      if (!has(f, k)) return;
      if (k === 'content') {
        fields[k] = readText(f, k, path + '.fields', errors, 3000, true);
        if (!clean(fields[k])) add(errors, path + '.fields.content', '更正内容不能为空');
      }
      else if (k === 'date') fields[k] = readDate(f, k, path + '.fields', errors, true);
      else if (k === 'module' || k === 'topic' || k === 'knowledge_point') fields[k] = readText(f, k, path + '.fields', errors, 300);
      else if (k === 'question_count' || k === 'correct_count') fields[k] = readNullableInteger(f, k, path + '.fields', errors);
      else if (k === 'duration_seconds' || k === 'duration_minutes') fields[k] = readNumber(f, k, path + '.fields', errors, { min: 0 });
      else if (k === 'duration_precision') fields[k] = readEnum(f, k, path + '.fields', errors, ['exact', 'estimated', 'unknown'], true);
      else if (k === 'duration_unit') fields[k] = readEnum(f, k, path + '.fields', errors, ['seconds', 'minutes'], false);
      else if (k === 'groups') fields[k] = normalizeGroups(f[k], path + '.fields.groups', errors);
      else if (k === 'wrong_questions') fields[k] = normalizeWrongQuestions(f[k], path + '.fields.wrong_questions', errors);
      else if (k === 'essay_scores') fields[k] = normalizeEssayScores(f[k], path + '.fields.essay_scores', errors);
      else if (k === 'note') fields[k] = readText(f, k, path + '.fields', errors, 4000);
    });
    var out = { target: target, reason: reason, fields: fields };
    if (id) out.correction_id = id;
    return out;
  }

  function normalizeSource(raw, errors) {
    if (!isPlainObject(raw)) { add(errors, '$.source', '必须为对象'); return null; }
    checkKeys(raw, ['kind', 'ref', 'label'], '$.source', errors);
    var kind = readEnum(raw, 'kind', '$.source', errors, ['chatgpt', 'manual', 'other'], true);
    var ref = readId(raw, 'ref', '$.source', errors, true);
    return { kind: kind, ref: ref, label: readText(raw, 'label', '$.source', errors, 200) };
  }

  function normalize(raw, limits) {
    limits = limits || {};
    var maxActivities = Math.min(limits.activities || LIMITS.activities, LIMITS.activities);
    var maxReviews = Math.min(limits.reviews || LIMITS.reviews, LIMITS.reviews);
    var maxCorrections = Math.min(limits.corrections || LIMITS.corrections, LIMITS.corrections);
    var errors = [];
    if (!isPlainObject(raw)) { add(errors, '$', '交换文件必须是对象'); return { ok: false, errors: errors, value: null }; }
    checkKeys(raw, ['schema', 'batch_id', 'source', 'generated_at', 'activities', 'reviews', 'corrections', 'notes'], '$', errors);
    if (raw.schema !== SCHEMA) add(errors, '$.schema', '必须为 ' + SCHEMA);
    var batchId = readId(raw, 'batch_id', '$', errors, true);
    var source = normalizeSource(raw.source, errors);
    var generatedAt = readTimestamp(raw, 'generated_at', '$', errors, true);
    var activities = [], reviews = [], corrections = [];
    var activityIds = Object.create(null), reviewIds = Object.create(null), correctionIds = Object.create(null), externalKeys = Object.create(null), correctionTargets = Object.create(null);
    if (!Array.isArray(raw.activities)) add(errors, '$.activities', '必须为数组');
    else {
      if (raw.activities.length > maxActivities) add(errors, '$.activities', '最多 ' + maxActivities + ' 条');
      raw.activities.forEach(function (a, i) {
        var n = normalizeActivity(a, '$.activities[' + i + ']', errors);
        if (!n) return;
        if (activityIds[n.activity_id]) add(errors, '$.activities[' + i + '].activity_id', '批次内 activity_id 重复');
        activityIds[n.activity_id] = true;
        if (n.kind === 'external') {
          var key = JSON.stringify([n.source, n.external_id]);
          if (externalKeys[key]) add(errors, '$.activities[' + i + ']', '批次内 source+external_id 重复');
          externalKeys[key] = true;
        }
        activities.push(n);
      });
    }
    if (!Array.isArray(raw.reviews)) add(errors, '$.reviews', '必须为数组');
    else {
      if (raw.reviews.length > maxReviews) add(errors, '$.reviews', '最多 ' + maxReviews + ' 条');
      raw.reviews.forEach(function (r, i) {
        var n = normalizeReview(r, '$.reviews[' + i + ']', errors);
        if (!n) return;
        if (reviewIds[n.review_id]) add(errors, '$.reviews[' + i + '].review_id', '批次内 review_id 重复；同一目标请使用不同 review_id');
        reviewIds[n.review_id] = true;
        reviews.push(n);
      });
    }
    if (!Array.isArray(raw.corrections)) add(errors, '$.corrections', '必须为数组');
    else {
      if (raw.corrections.length > maxCorrections) add(errors, '$.corrections', '最多 ' + maxCorrections + ' 条');
      raw.corrections.forEach(function (c, i) {
        var n = normalizeCorrection(c, '$.corrections[' + i + ']', errors);
        if (!n) return;
        if (n.correction_id) {
          if (correctionIds[n.correction_id]) add(errors, '$.corrections[' + i + '].correction_id', '批次内 correction_id 重复');
          correctionIds[n.correction_id] = true;
        }
        var tk = n.target ? n.target.type + ':' + n.target.namespace + ':' + n.target.id : '';
        if (tk && correctionTargets[tk]) add(errors, '$.corrections[' + i + '].target', '同一目标在一个批次内只能有一条 corrections');
        if (tk) correctionTargets[tk] = true;
        corrections.push(n);
      });
    }
    var notes = readText(raw, 'notes', '$', errors, 20000);
    if (errors.length) return { ok: false, errors: errors, value: null };
    var value = { schema: SCHEMA, batch_id: batchId, source: source, generated_at: generatedAt, activities: activities, reviews: reviews, corrections: corrections, notes: notes };
    return { ok: true, errors: [], value: value };
  }

  function canonicalize(value) {
    function canon(v) {
      if (v === null) return 'null';
      if (typeof v === 'string') return JSON.stringify(v);
      if (typeof v === 'number') { if (!isFinite(v)) throw new Error('canonicalize: 非有限数字'); return String(v); }
      if (typeof v === 'boolean') return v ? 'true' : 'false';
      if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
      if (isPlainObject(v)) {
        var keys = Object.keys(v).sort();
        return '{' + keys.map(function (k) {
          if (FORBIDDEN_KEYS[k]) throw new Error('canonicalize: 禁止的对象属性 ' + k);
          return JSON.stringify(k) + ':' + canon(v[k]);
        }).join(',') + '}';
      }
      throw new Error('canonicalize: 不支持的类型');
    }
    return canon(value);
  }

  function cmpText(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function activitySortKey(a) {
    return a.kind === 'external' ? 'external:' + JSON.stringify([a.source, a.external_id]) : 'manual:' + JSON.stringify([a.activity_id]);
  }
  function semanticPayload(normalized) {
    if (!normalized || !normalized.source) throw new Error('semanticPayload 需要 normalize 后的对象');
    var acts = normalized.activities.slice().sort(function (a, b) { return cmpText(activitySortKey(a), activitySortKey(b)); });
    var revs = normalized.reviews.slice().sort(function (a, b) { return cmpText(String(a.review_id), String(b.review_id)); });
    var cors = normalized.corrections.slice().sort(function (a, b) { return cmpText(String(a.correction_id || targetIdentity(a.target)), String(b.correction_id || targetIdentity(b.target))); });
    return {
      schema: SCHEMA,
      source: { kind: normalized.source.kind, ref: normalized.source.ref },
      activities: acts,
      reviews: revs,
      corrections: cors,
      notes: normalized.notes || ''
    };
  }

  function bytesOf(input) {
    if (input && input.buffer && typeof input.byteLength === 'number') {
      return new Uint8Array(input.buffer, input.byteOffset || 0, input.byteLength);
    }
    if (input instanceof ArrayBuffer || Object.prototype.toString.call(input) === '[object ArrayBuffer]') return new Uint8Array(input);
    if (input instanceof Uint8Array) return input;
    throw new Error('输入必须为 Uint8Array/ArrayBuffer');
  }
  function decodeUtf8(bytes) {
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) throw new Error('不支持 UTF-16 BOM；请使用 UTF-8');
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) throw new Error('不支持 UTF-16 BOM；请使用 UTF-8');
    if (typeof TextDecoder !== 'function') throw new Error('当前环境缺少 TextDecoder');
    var text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    return text;
  }
  function hex(buffer) {
    return Array.prototype.map.call(new Uint8Array(buffer), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  async function sha256Bytes(input) {
    var bytes = bytesOf(input);
    if (!root.crypto || !root.crypto.subtle || !root.crypto.subtle.digest) throw new Error('当前环境缺少 WebCrypto SHA-256');
    var buf = await root.crypto.subtle.digest('SHA-256', bytes);
    return 'sha256:' + hex(buf);
  }
  async function payloadSha256(input) { return sha256Bytes(input); }
  async function semanticFingerprint(normalized) { return sha256Bytes(new TextEncoder().encode(canonicalize(semanticPayload(normalized)))); }
  async function reviewEntityKey(sourceNamespace, reviewId) {
    return sha256Bytes(new TextEncoder().encode(canonicalize({ source: { kind: sourceNamespace.kind, ref: sourceNamespace.ref }, review_id: reviewId })));
  }
  function activityIdentity(activity, sourceNamespace) {
    if (activity.kind === 'external') return 'external:' + JSON.stringify([activity.source, activity.external_id]);
    return 'manual:' + JSON.stringify([sourceNamespace.kind, sourceNamespace.ref, activity.activity_id]);
  }
  function targetIdentity(target) {
    return 'target:' + JSON.stringify([target.type, target.namespace, target.id]);
  }

  function toStudyLog(activity) {
    if (!activity) throw new Error('activity 必须存在');
    var external = activity.kind === 'external';
    return {
      id: activity.activity_id,
      kind: external ? 'external' : 'manual',
      assessment: activity.assessment,
      date: activity.date,
      content: activity.content,
      module: activity.module,
      topic: activity.topic,
      knowledgePoint: activity.knowledge_point,
      practiceType: activity.practice_type,
      questionCount: activity.question_count,
      correctCount: activity.correct_count,
      durationSeconds: activity.duration_seconds,
      durationMinutes: activity.duration_minutes,
      durationPrecision: activity.duration_precision,
      durationUnit: activity.duration_unit,
      groups: (activity.groups || []).map(function (g) { return { label: g.label, questionCount: g.question_count, correctCount: g.correct_count, durationSeconds: g.duration_seconds }; }),
      wrongQuestions: (activity.wrong_questions || []).map(function (w) {
        return {
          questionNo: w.question_no, questionType: w.question_type, knowledgePoint: w.knowledge_point,
          primaryCause: w.primary_cause, secondaryCauses: (w.secondary_causes || []).slice(),
          method: w.method, logicSymbols: w.logic_symbols, reasoning: w.reasoning,
          retestHistory: (w.retest_history || []).map(function (h) { return { date: h.date, status: h.status, score: h.score, maxScore: h.max_score, note: h.note }; })
        };
      }),
      essayScores: (activity.essay_scores || []).map(function (s) { return { round: s.round, score: s.score, maxScore: s.max_score, reviewedAt: s.reviewed_at, reviewer: s.reviewer, note: s.note }; }),
      source: external ? activity.source : 'manual',
      externalId: external ? activity.external_id : null,
      taskId: activity.task_id,
      retestStatus: activity.retest_status,
      reportRef: activity.report_ref,
      note: activity.note
    };
  }

  function contentHashFor(type, record) {
    var meta = TARGETS[type];
    if (!meta) throw new Error('不支持的 target 类型：' + String(type));
    var projected = Object.create(null);
    Object.keys(record || {}).forEach(function (k) {
      if (meta.hashExcludes.indexOf(k) < 0) projected[k] = record[k];
    });
    return sha256Bytes(new TextEncoder().encode(canonicalize(projected)));
  }

  async function parseBytes(input, options) {
    options = options || {};
    var errors = [];
    var bytes;
    try { bytes = bytesOf(input); } catch (e) { return { ok: false, errors: [{ path: '$', message: e.message }], payloadSha256: null }; }
    var maxBytes = Math.min(Number(options.maxBytes) || LIMITS.bytes, LIMITS.bytes);
    if (bytes.length > maxBytes) return { ok: false, errors: [{ path: '$', message: '文件过大（最多 ' + maxBytes + ' 字节）' }], payloadSha256: null };
    var payload;
    try { payload = await payloadSha256(bytes); } catch (e) { return { ok: false, errors: [{ path: '$', message: e.message }], payloadSha256: null }; }
    var text;
    try { text = decodeUtf8(bytes); } catch (e) { return { ok: false, errors: [{ path: '$', message: e.message }], payloadSha256: payload }; }
    var raw;
    try { raw = JSON.parse(text); } catch (e) { return { ok: false, errors: [{ path: '$', message: 'JSON 解析失败：' + e.message }], payloadSha256: payload }; }
    var result = normalize(raw, options);
    if (!result.ok) return { ok: false, errors: result.errors, payloadSha256: payload, raw: raw };
    var fingerprint;
    try { fingerprint = await semanticFingerprint(result.value); } catch (e) { return { ok: false, errors: [{ path: '$', message: e.message }], payloadSha256: payload, raw: raw }; }
    return { ok: true, errors: [], value: result.value, semantic: semanticPayload(result.value), payloadSha256: payload, semanticFingerprint: fingerprint, raw: raw };
  }
  async function parseText(text) {
    return parseBytes(new TextEncoder().encode(String(text == null ? '' : text)));
  }
  function validate(raw) { return normalize(raw); }

  return {
    SCHEMA: SCHEMA, VERSION: VERSION, LIMITS: LIMITS,
    TARGET_TYPES: TARGET_TYPES, TARGETS: TARGETS, CORRECTION_FIELDS: CORRECTION_FIELDS,
    canonicalize: canonicalize, normalize: normalize, validate: validate,
    parseBytes: parseBytes, parseText: parseText,
    payloadSha256: payloadSha256, semanticFingerprint: semanticFingerprint,
    semanticPayload: semanticPayload, contentHashFor: contentHashFor,
    reviewEntityKey: reviewEntityKey, activityIdentity: activityIdentity, targetIdentity: targetIdentity,
    toStudyLog: toStudyLog
  };
});


