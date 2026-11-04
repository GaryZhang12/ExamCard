/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright 2026 ExamCard contributors */
/* ExamCard 1.2.0 P0 · 学习记录/外部练习纯数据模型（复用 studyLogs，不新增表） */
(function (root) {
  'use strict';

  var SCHEMA = 'examcard.study-log/v2';
  var BATCH_SCHEMA = 'examcard.study-log-batch/v1';
  var KINDS = ['manual', 'external'];
  var ASSESSMENTS = ['objective', 'essay'];
  var PRACTICE_TYPES = ['new', 'retest', 'comprehensive', 'mock'];
  var PRECISIONS = ['exact', 'estimated', 'unknown'];
  var RETEST_STATUSES = ['not_required', 'pending', 'scheduled', 'passed', 'failed'];
  var CAUSE_SUGGESTIONS = ['审题错误', '知识点缺失', '方法选择错误', '逻辑方向错误', '计算或估算错误', '时间分配不足', '注意力或计算耐心问题', '申论要点遗漏', '申论表述不规范'];
  var OBJECTIVE_LABEL = { new: '专项新题', retest: '错题复测', comprehensive: '综合练习', mock: '模考', unclassified: '未分类' };
  var PRECISION_LABEL = { exact: '精确', estimated: '估算', unknown: '未知' };
  var ASSESSMENT_LABEL = { objective: '客观题', essay: '申论' };
  var RETEST_LABEL = { not_required: '无需复测', pending: '待复测', scheduled: '已安排', passed: '已通过', failed: '未通过' };
  var FIELD_KEYS = [
    'schema', 'id', 'kind', 'assessment', 'status', 'date', 'content', 'module', 'topic', 'knowledgePoint',
    'practiceType', 'questionCount', 'correctCount', 'questions', 'correct',
    'durationSeconds', 'durationMinutes', 'durationMin', 'durationPrecision', 'durationUnit',
    'source', 'externalId', 'externalKey', 'reportRef', 'taskId', 'retestStatus',
    'groups', 'wrongQuestions', 'essayScores', 'note', 'createdAt', 'updatedAt', 'revision', 'revisions',
    'deletedAt', 'deletedReason', 'duplicate', 'existingId'
  ];
  var GROUP_KEYS = ['label', 'questionCount', 'correctCount', 'durationSeconds'];
  var WRONG_KEYS = ['questionNo', 'questionType', 'knowledgePoint', 'primaryCause', 'secondaryCauses', 'method', 'logicSymbols', 'reasoning', 'retestHistory', 'wrongKey', 'source', 'externalId'];
  var RETEST_KEYS = ['date', 'status', 'note', 'score', 'maxScore'];
  var ESSAY_KEYS = ['round', 'score', 'maxScore', 'reviewedAt', 'reviewer', 'note'];

  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function isDate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false;
    var d = new Date(String(s) + 'T00:00:00Z');
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }
  function isFiniteNumber(n) { return typeof n === 'number' && isFinite(n); }
  function isInt(n) { return isFiniteNumber(n) && Math.floor(n) === n; }
  function err(list, path, message) { list.push({ path: path, message: message }); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function dateToday() { return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10); }
  function nowIso() { return new Date().toISOString(); }
  function uid() { return 'log-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }
  function conflictError(message) {
    var e = new Error(message);
    e.code = 'STUDY_LOG_CONFLICT';
    return e;
  }

  function checkUnknown(obj, allowed, path, errors) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
    Object.keys(obj).forEach(function (k) {
      if (allowed.indexOf(k) < 0) err(errors, path ? path + '.' + k : k, '未知字段');
    });
  }

  function readText(value, path, errors, max, options) {
    options = options || {};
    if (value == null) return '';
    if (typeof value !== 'string') { err(errors, path, '必须为文本'); return ''; }
    if (value.length > max) err(errors, path, '文本过长（最多 ' + max + ' 字）');
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) err(errors, path, '文本含不支持字符');
    var s = options.token ? value.trim() : value.replace(/\r\n?/g, '\n');
    if (!options.multiline) s = s.replace(/\s+/g, ' ').trim();
    else s = s.trim();
    return s;
  }

  function readNumber(value, path, errors, options) {
    options = options || {};
    if (value == null || value === '') return null;
    if (typeof value !== 'number' || !isFinite(value)) { err(errors, path, options.integer ? '必须为有限整数' : '必须为有限数字'); return null; }
    if (options.integer && Math.floor(value) !== value) { err(errors, path, '必须为整数'); return null; }
    if (value < (options.min == null ? -Infinity : options.min)) { err(errors, path, '不能小于 ' + options.min); return null; }
    if (options.max != null && value > options.max) { err(errors, path, '不能大于 ' + options.max); return null; }
    return value;
  }

  function normalizeArray(value, path, errors) {
    if (value == null) return [];
    if (!Array.isArray(value)) { err(errors, path, '必须为数组'); return []; }
    return value;
  }

  function normalizeCauseList(value, path, errors) {
    var list = normalizeArray(value, path, errors);
    var out = [];
    list.forEach(function (v, i) {
      if (typeof v !== 'string' || !v.trim()) { err(errors, path + '[' + i + ']', '错因必须为非空文本'); return; }
      var s = v.replace(/\s+/g, ' ').trim();
      if (s.length > 120) { err(errors, path + '[' + i + ']', '错因文本过长'); return; }
      if (out.indexOf(s) < 0) out.push(s);
    });
    return out;
  }

  function normalizeGroups(value, errors) {
    var list = normalizeArray(value, 'groups', errors);
    var out = [];
    list.forEach(function (g, i) {
      var p = 'groups[' + i + ']';
      if (!g || typeof g !== 'object' || Array.isArray(g)) { err(errors, p, '应为对象'); return; }
      checkUnknown(g, GROUP_KEYS, p, errors);
      var label = readText(g.label, p + '.label', errors, 120) || ('第 ' + (i + 1) + ' 组');
      var q = readNumber(g.questionCount, p + '.questionCount', errors, { integer: true, min: 0 });
      var c = readNumber(g.correctCount, p + '.correctCount', errors, { integer: true, min: 0 });
      var sec = readNumber(g.durationSeconds, p + '.durationSeconds', errors, { min: 0 });
      if (c != null && q != null && c > q) err(errors, p + '.correctCount', '正确数不能大于题量');
      out.push({ label: label, questionCount: q, correctCount: c, durationSeconds: sec });
    });
    return out;
  }

  function externalKeyFor(source, externalId) {
    return 'v2:' + JSON.stringify([String(source == null ? '' : source), String(externalId == null ? '' : externalId)]);
  }
  function externalKeyOf(rec) {
    if (!rec || typeof rec !== 'object') return null;
    if (rec.source && rec.source !== 'manual' && rec.externalId != null && String(rec.externalId).trim() !== '') return externalKeyFor(rec.source, rec.externalId);
    // Compatibility for legacy rows that only retained the old concatenated key.
    // Rows with source/externalId never use this branch, so the old ambiguous
    // "a::b" + "c" collision cannot be resurrected for new/edited records.
    return rec.externalKey ? String(rec.externalKey) : null;
  }
  function wrongKeyFor(source, externalId, questionNo) {
    return 'w2:' + JSON.stringify([String(source == null ? '' : source), String(externalId == null ? '' : externalId), String(questionNo == null ? '' : questionNo)]);
  }

  function normalizeWrongQuestions(value, errors, ctx) {
    var list = normalizeArray(value, 'wrongQuestions', errors);
    var out = [], seen = new Map();
    list.forEach(function (w, i) {
      var p = 'wrongQuestions[' + i + ']';
      if (!w || typeof w !== 'object' || Array.isArray(w)) { err(errors, p, '应为对象'); return; }
      checkUnknown(w, WRONG_KEYS, p, errors);
      var no;
      if (typeof w.questionNo === 'number' && isFinite(w.questionNo)) no = String(w.questionNo);
      else if (typeof w.questionNo === 'string') no = w.questionNo.trim();
      else { err(errors, p + '.questionNo', '外部题号必须为文本或数字'); no = ''; }
      if (!no) { err(errors, p + '.questionNo', '外部题号不能为空'); return; }
      if (no.length > 80) err(errors, p + '.questionNo', '外部题号过长');
      var wrongKey = wrongKeyFor(ctx.source, ctx.externalId, no);
      if (seen.has(wrongKey)) { err(errors, p + '.questionNo', '同一外部练习内题号重复'); return; }
      seen.set(wrongKey, true);
      var primary = readText(w.primaryCause, p + '.primaryCause', errors, 120);
      if (!primary) err(errors, p + '.primaryCause', '主要错因不能为空');
      var secondary = normalizeCauseList(w.secondaryCauses, p + '.secondaryCauses', errors);
      if (secondary.indexOf(primary) >= 0) err(errors, p + '.secondaryCauses', '次要错因不能与主要错因相同');
      var type = readText(w.questionType, p + '.questionType', errors, 40);
      if (type && ['single', 'multi', 'judge', 'other'].indexOf(type) < 0) err(errors, p + '.questionType', '题型必须为 single/multi/judge/other');
      var retestHistory = normalizeArray(w.retestHistory, p + '.retestHistory', errors).map(function (h, j) {
        var hp = p + '.retestHistory[' + j + ']';
        if (!h || typeof h !== 'object' || Array.isArray(h)) { err(errors, hp, '应为对象'); return null; }
        checkUnknown(h, RETEST_KEYS, hp, errors);
        if (!isDate(h.date)) err(errors, hp + '.date', '复测日期必须为 YYYY-MM-DD');
        if (h.status != null && ['passed', 'failed', 'pending'].indexOf(h.status) < 0) err(errors, hp + '.status', '复测状态必须为 passed/failed/pending');
        var score = readNumber(h.score, hp + '.score', errors, { min: 0 });
        var maxScore = readNumber(h.maxScore, hp + '.maxScore', errors, { min: 0 });
        if (score != null && maxScore != null && score > maxScore) err(errors, hp + '.score', '分数不能大于满分');
        return {
          date: h.date || null,
          status: h.status || 'pending',
          score: score,
          maxScore: maxScore,
          note: readText(h.note, hp + '.note', errors, 1000)
        };
      }).filter(Boolean);
      out.push({
        wrongKey: wrongKey,
        questionNo: no,
        questionType: type || 'other',
        knowledgePoint: readText(w.knowledgePoint, p + '.knowledgePoint', errors, 300),
        primaryCause: primary,
        secondaryCauses: secondary,
        method: readText(w.method, p + '.method', errors, 2000, { multiline: true }),
        logicSymbols: readText(w.logicSymbols, p + '.logicSymbols', errors, 2000, { multiline: true }),
        reasoning: readText(w.reasoning, p + '.reasoning', errors, 5000, { multiline: true }),
        retestHistory: retestHistory,
        source: ctx.source || null,
        externalId: ctx.externalId || null
      });
    });
    return out;
  }

  function normalizeEssayScores(value, errors) {
    var list = normalizeArray(value, 'essayScores', errors);
    if (!list.length) err(errors, 'essayScores', '申论记录至少需要一个评分');
    var out = [], seen = {};
    list.forEach(function (s, i) {
      var p = 'essayScores[' + i + ']';
      if (!s || typeof s !== 'object' || Array.isArray(s)) { err(errors, p, '应为对象'); return; }
      checkUnknown(s, ESSAY_KEYS, p, errors);
      var round = s.round == null ? 'first' : String(s.round);
      if (round !== 'first' && round !== 'reevaluation') err(errors, p + '.round', '评分轮次必须为 first/reevaluation');
      if (seen[round]) err(errors, p + '.round', '首次评分和复评各最多一条');
      seen[round] = true;
      var score = readNumber(s.score, p + '.score', errors, { min: 0 });
      var maxScore = readNumber(s.maxScore, p + '.maxScore', errors, { min: 0 });
      if (score == null) err(errors, p + '.score', '分数必须为非负数字');
      if (maxScore == null || maxScore <= 0) err(errors, p + '.maxScore', '满分必须为正数');
      if (score != null && maxScore != null && score > maxScore) err(errors, p + '.score', '分数不能大于满分');
      out.push({
        round: round,
        score: score,
        maxScore: maxScore,
        reviewedAt: s.reviewedAt == null ? null : String(s.reviewedAt),
        reviewer: readText(s.reviewer, p + '.reviewer', errors, 200),
        note: readText(s.note, p + '.note', errors, 2000)
      });
    });
    if (list.length && !seen.first) err(errors, 'essayScores', '申论评分必须保留首次评分');
    out.sort(function (a, b) { return a.round === 'first' ? -1 : b.round === 'first' ? 1 : 0; });
    return out;
  }

  function durationFromInput(raw, errors) {
    var precision = raw.durationPrecision;
    if (precision != null && PRECISIONS.indexOf(precision) < 0) err(errors, 'durationPrecision', '时间精度必须为 exact/estimated/unknown');
    if (PRECISIONS.indexOf(precision) < 0) precision = null;
    var unit = raw.durationUnit;
    if (unit != null && unit !== 'seconds' && unit !== 'minutes') err(errors, 'durationUnit', '时间单位必须为 seconds/minutes');
    if (unit !== 'minutes' && unit !== 'seconds') unit = (raw.durationSeconds == null && (raw.durationMinutes != null || raw.durationMin != null)) ? 'minutes' : 'seconds';
    var seconds = readNumber(raw.durationSeconds, 'durationSeconds', errors, { min: 0 });
    var minutes = readNumber(raw.durationMinutes, 'durationMinutes', errors, { min: 0 });
    if (minutes == null && raw.durationMin != null && raw.durationMin !== '') minutes = readNumber(raw.durationMin, 'durationMin', errors, { min: 0 });
    if (seconds != null && minutes != null && Math.abs(seconds - minutes * 60) > 0.01) err(errors, 'durationSeconds', '秒数与分钟数不一致');
    if (precision == null) {
      if (seconds != null) precision = 'exact';
      else if (minutes != null) precision = 'estimated';
      else precision = 'unknown';
    }
    if (precision === 'unknown') {
      if (seconds != null || minutes != null) err(errors, 'durationPrecision', '未知用时不能同时填写时长');
      return { durationSeconds: null, durationMinutes: null, durationPrecision: 'unknown', durationUnit: unit };
    }
    if (seconds == null && minutes == null) err(errors, 'durationPrecision', '时间精度不是未知时必须填写时长');
    if (precision === 'exact' && raw.durationSeconds != null && seconds != null && Math.floor(seconds) !== seconds) err(errors, 'durationSeconds', '精确秒数必须为整数');
    if (seconds == null && minutes != null && isFiniteNumber(minutes)) seconds = minutes * 60;
    if (minutes == null && seconds != null && isFiniteNumber(seconds)) minutes = seconds / 60;
    return { durationSeconds: seconds, durationMinutes: minutes, durationPrecision: precision, durationUnit: unit };
  }

  function normalize(raw, options) {
    options = options || {};
    var errors = [];
    var src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) err(errors, '$', '记录必须是对象');
    checkUnknown(src, FIELD_KEYS, '', errors);
    if (has(src, 'schema') && src.schema != null && src.schema !== SCHEMA) err(errors, 'schema', '不支持的记录 schema：' + String(src.schema));
    if (has(src, 'revisions') && !options.internal) {
      if (!Array.isArray(src.revisions) || src.revisions.length) err(errors, 'revisions', '审计历史只能由系统生成，不能通过导入伪造或删除');
    }
    if (src.kind != null && KINDS.indexOf(src.kind) < 0) err(errors, 'kind', '记录类型必须为 manual/external');
    if (src.assessment != null && ASSESSMENTS.indexOf(src.assessment) < 0) err(errors, 'assessment', '考核类型必须为 objective/essay');
    var kind = src.kind === 'external' ? 'external' : 'manual';
    var assessment = src.assessment === 'essay' ? 'essay' : 'objective';
    var id = null;
    if (src.id != null) {
      if (typeof src.id !== 'string' || !src.id || src.id.length > 160) err(errors, 'id', '记录 ID 必须为不超过 160 字的非空文本');
      else id = src.id;
    }
    var date = src.date == null ? dateToday() : src.date;
    if (typeof date !== 'string' || !isDate(date)) err(errors, 'date', '日期必须为 YYYY-MM-DD');
    date = String(date || '');
    var content = readText(src.content, 'content', errors, 3000);
    if (!content) err(errors, 'content', '学习内容不能为空');
    var duration = durationFromInput(src, errors);
    var questions = readNumber(src.questionCount != null ? src.questionCount : src.questions, 'questionCount', errors, { integer: true, min: 0 });
    var correct = readNumber(src.correctCount != null ? src.correctCount : src.correct, 'correctCount', errors, { integer: true, min: 0 });
    if (correct != null && questions != null && correct > questions) err(errors, 'correctCount', '正确数不能大于题量');
    if (correct != null && questions == null) err(errors, 'correctCount', '填写正确数前必须填写题量');
    var source = readText(src.source, 'source', errors, 120, { token: true });
    var externalId = readText(src.externalId, 'externalId', errors, 120, { token: true });
    if (kind === 'external') {
      if (!source) err(errors, 'source', '外部练习来源不能为空');
      if (!externalId) err(errors, 'externalId', '外部练习 ID 不能为空');
    } else {
      source = 'manual';
      externalId = '';
    }
    var practiceType = src.practiceType == null || src.practiceType === '' ? null : String(src.practiceType);
    if (kind === 'external' && assessment === 'objective' && PRACTICE_TYPES.indexOf(practiceType) < 0) err(errors, 'practiceType', '练习类型必须为 new/retest/comprehensive/mock');
    if (kind === 'manual' && practiceType != null && PRACTICE_TYPES.indexOf(practiceType) < 0) err(errors, 'practiceType', '练习类型无效');
    var retestStatus = src.retestStatus == null ? null : String(src.retestStatus);
    if (retestStatus != null && RETEST_STATUSES.indexOf(retestStatus) < 0) err(errors, 'retestStatus', '复测状态无效');
    var reportRef = readText(src.reportRef, 'reportRef', errors, 2000, { multiline: true });
    var taskId = null;
    if (src.taskId != null && src.taskId !== '') {
      if (typeof src.taskId !== 'string' || !src.taskId.trim() || src.taskId.length > 160) err(errors, 'taskId', '任务关联 ID 无效');
      else taskId = src.taskId.trim();
    }
    var note = readText(src.note, 'note', errors, 4000, { multiline: true });
    var groups = normalizeGroups(src.groups, errors);
    var wrongQuestions = normalizeWrongQuestions(src.wrongQuestions, errors, { source: source, externalId: externalId });
    var essayScores = assessment === 'essay' ? normalizeEssayScores(src.essayScores, errors) : [];
    if (assessment === 'essay') {
      if (questions != null || correct != null) err(errors, 'assessment', '申论评分不能转换为题数/正确数');
      if (practiceType != null) err(errors, 'practiceType', '申论记录不使用客观题练习类型');
      questions = null; correct = null; practiceType = null;
    }
    if (groups.length) {
      var groupQ = 0, groupC = 0, groupSec = 0, knownQ = true, knownC = true, knownSec = true;
      groups.forEach(function (g) {
        if (g.questionCount == null) knownQ = false; else groupQ += g.questionCount;
        if (g.correctCount == null) knownC = false; else groupC += g.correctCount;
        if (g.durationSeconds == null) knownSec = false; else groupSec += g.durationSeconds;
      });
      if (questions != null && knownQ && groupQ !== questions) err(errors, 'groups', '分组题量合计必须等于总题量');
      if (correct != null && knownC && groupC !== correct) err(errors, 'groups', '分组正确数合计必须等于总正确数');
      if (duration.durationSeconds != null && knownSec && Math.abs(groupSec - duration.durationSeconds) > 0.01) err(errors, 'groups', '分组用时合计必须等于总用时');
    }
    var status = src.status == null ? 'active' : String(src.status);
    if (status !== 'active' && status !== 'deleted') err(errors, 'status', '状态必须为 active/deleted');
    if (status === 'deleted' && !options.internal) err(errors, 'status', '导入记录不能设置为已删除');
    var createdAt = src.createdAt == null ? Date.now() : readNumber(src.createdAt, 'createdAt', errors, { min: 0 });
    var revision = src.revision == null ? 0 : readNumber(src.revision, 'revision', errors, { integer: true, min: 0 });
    var revisions = options.internal && Array.isArray(src.revisions) ? clone(src.revisions) : [];
    var rec = {
      schema: SCHEMA,
      id: id,
      kind: kind,
      assessment: assessment,
      status: status,
      date: date,
      content: content,
      module: readText(src.module, 'module', errors, 300),
      topic: readText(src.topic, 'topic', errors, 300),
      knowledgePoint: readText(src.knowledgePoint, 'knowledgePoint', errors, 300),
      practiceType: practiceType,
      questionCount: questions,
      correctCount: correct,
      durationSeconds: duration.durationSeconds,
      durationMinutes: duration.durationMinutes,
      durationMin: duration.durationMinutes,
      durationPrecision: duration.durationPrecision,
      durationUnit: duration.durationUnit,
      questions: questions,
      correct: correct,
      source: source,
      externalId: kind === 'external' ? externalId : null,
      externalKey: kind === 'external' && source && externalId ? externalKeyFor(source, externalId) : null,
      reportRef: reportRef,
      taskId: taskId,
      retestStatus: retestStatus,
      groups: groups,
      wrongQuestions: wrongQuestions,
      essayScores: essayScores,
      note: note,
      createdAt: createdAt == null ? Date.now() : createdAt,
      updatedAt: options.now == null ? Date.now() : Number(options.now),
      revision: revision == null ? 0 : revision,
      revisions: revisions,
      deletedAt: src.deletedAt == null ? null : readNumber(src.deletedAt, 'deletedAt', errors, { min: 0 }),
      deletedReason: readText(src.deletedReason, 'deletedReason', errors, 1000, { multiline: true })
    };
    return { value: rec, errors: errors };
  }

  function assertValid(raw, options) {
    var out = normalize(raw, options);
    if (out.errors.length) {
      var e = new Error('学习记录校验失败：' + out.errors[0].path + '：' + out.errors[0].message);
      e.details = out.errors;
      throw e;
    }
    return out.value;
  }

  function normalizeMany(rawList, options) {
    if (!Array.isArray(rawList) || !rawList.length) {
      var e = new Error('批量记录必须为非空数组');
      e.details = [{ path: '$', message: '批量记录必须为非空数组' }];
      throw e;
    }
    var values = [];
    var errors = [];
    var ids = {};
    rawList.forEach(function (raw, i) {
      var out = normalize(raw, options);
      if (out.errors.length) errors.push.apply(errors, out.errors.map(function (x) { return { path: 'records[' + i + '].' + x.path, message: x.message }; }));
      if (out.value.id) {
        if (ids[out.value.id]) errors.push({ path: 'records[' + i + '].id', message: '批次内记录 ID 重复' });
        ids[out.value.id] = true;
      }
      values.push(out.value);
    });
    if (errors.length) {
      var errObj = new Error('批量记录校验失败：共 ' + errors.length + ' 项');
      errObj.details = errors;
      throw errObj;
    }
    return values;
  }

  function parseBatch(text) {
    var obj;
    try { obj = JSON.parse(String(text || '')); } catch (e) {
      var ep = new Error('JSON 解析失败：' + e.message);
      ep.details = [{ path: '$', message: 'JSON 语法错误' }];
      throw ep;
    }
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      if (obj.schema != null && obj.schema !== BATCH_SCHEMA && obj.schema !== SCHEMA) {
        var es = new Error('不支持的批量记录 schema：' + obj.schema);
        es.details = [{ path: 'schema', message: '仅支持 ' + BATCH_SCHEMA + ' 或 ' + SCHEMA }];
        throw es;
      }
      var topKeys = Object.keys(obj).filter(function (k) { return ['schema', 'records', 'studyLogs', 'exportedAt', 'note'].indexOf(k) < 0; });
      if (topKeys.length) {
        var eu = new Error('批量记录包含未知字段');
        eu.details = topKeys.map(function (k) { return { path: k, message: '未知字段' }; });
        throw eu;
      }
    }
    var list = Array.isArray(obj) ? obj : (obj && (Array.isArray(obj.records) ? obj.records : Array.isArray(obj.studyLogs) ? obj.studyLogs : null));
    if (!list) {
      var em = new Error('批量记录 JSON 必须是数组，或 {records:[...]}');
      em.details = [{ path: '$', message: '缺少 records 数组' }];
      throw em;
    }
    return normalizeMany(list, { now: Date.now() });
  }

  function auditSnapshot(rec) {
    var c = clone(rec);
    delete c.revisions;
    delete c.duplicate;
    delete c.existingId;
    return c;
  }

  function checkLock(old, options) {
    var expectedRevision = options.expectedRevision;
    var expectedUpdatedAt = options.expectedUpdatedAt;
    var actualRevision = Number(old.revision) || 0;
    if (expectedRevision != null && Number(expectedRevision) !== actualRevision) {
      throw conflictError('学习记录已被其他编辑更新（版本 ' + actualRevision + '，提交版本 ' + expectedRevision + '），请刷新后重试');
    }
    if (expectedUpdatedAt != null && old.updatedAt != null && Number(expectedUpdatedAt) !== Number(old.updatedAt)) {
      throw conflictError('学习记录已被其他编辑更新，请刷新后重试');
    }
  }

  function applyUpdate(old, patch, options) {
    options = options || {};
    if (!old || !old.id) throw new Error('原学习记录不存在');
    checkLock(old, options);
    var merged = Object.assign({}, old, patch || {});
    merged.id = old.id;
    merged.createdAt = old.createdAt;
    merged.status = 'active';
    merged.deletedAt = null;
    merged.deletedReason = '';
    merged.updatedAt = options.now == null ? Date.now() : Number(options.now);
    merged.revisions = Array.isArray(old.revisions) ? clone(old.revisions) : [];
    var normalized = assertValid(merged, { now: merged.updatedAt, internal: true });
    normalized.id = old.id;
    normalized.createdAt = old.createdAt;
    normalized.revision = (Number(old.revision) || 0) + 1;
    normalized.revisions = Array.isArray(old.revisions) ? clone(old.revisions) : [];
    normalized.revisions.push({
      at: merged.updatedAt,
      action: 'update',
      reason: readText(options.reason, 'reason', [], 1000) || '修改学习记录',
      before: auditSnapshot(old),
      after: auditSnapshot(normalized)
    });
    return normalized;
  }

  function applyDelete(old, options) {
    options = options || {};
    if (!old || !old.id) throw new Error('原学习记录不存在');
    if (old.status === 'deleted') throw new Error('学习记录已删除');
    checkLock(old, options);
    var at = options.now == null ? Date.now() : Number(options.now);
    var next = Object.assign({}, old, {
      status: 'deleted',
      deletedAt: at,
      updatedAt: at,
      deletedReason: readText(options.reason, 'reason', [], 1000) || '删除学习记录'
    });
    next.revision = (Number(old.revision) || 0) + 1;
    next.revisions = Array.isArray(old.revisions) ? clone(old.revisions) : [];
    next.revisions.push({
      at: at,
      action: 'delete',
      reason: next.deletedReason,
      before: auditSnapshot(old),
      after: null
    });
    return next;
  }

  function average(parts, key) {
    var n = 0, total = 0;
    parts.forEach(function (x) { if (x[key] != null) { n++; total += x[key]; } });
    return n ? total / n : null;
  }

  function blankCategory(key) {
    return {
      key: key, label: OBJECTIVE_LABEL[key] || key, activities: 0,
      questions: 0, correct: 0, incorrect: 0,
      knownQuestions: 0, unknownCorrect: 0, unknownQuestions: 0,
      accuracy: null, durationSeconds: null, exactSeconds: 0, estimatedSeconds: 0, unknownDuration: 0
    };
  }

  function addToCategory(c, rec) {
    var q = rec.questionCount;
    var correct = rec.correctCount;
    c.activities++;
    if (q != null) c.questions += q; else c.unknownQuestions++;
    if (correct != null && q != null) {
      c.correct += correct;
      c.incorrect += q - correct;
      c.knownQuestions += q;
    } else {
      c.unknownCorrect++;
      if (q != null) c.unknownQuestions += q;
    }
    var sec = rec.durationSeconds;
    if (sec == null && rec.durationMinutes != null) sec = rec.durationMinutes * 60;
    if (sec != null) {
      c.durationSeconds = (c.durationSeconds || 0) + sec;
      if (rec.durationPrecision === 'exact') c.exactSeconds += sec;
      else c.estimatedSeconds += sec;
    } else c.unknownDuration++;
  }

  function finishCategory(c) {
    c.accuracy = c.knownQuestions > 0 && c.unknownCorrect === 0 ? Math.round(c.correct / c.knownQuestions * 1000) / 10 : null;
    return c;
  }

  function summarize(logs) {
    var list = (logs || []).filter(function (l) { return l && l.status !== 'deleted' && l.deletedAt == null; });
    var byKey = new Map();
    var unique = [];
    list.forEach(function (l) {
      var key = externalKeyOf(l);
      if (!key) { unique.push(l); return; }
      if (!byKey.has(key)) { byKey.set(key, unique.length); unique.push(l); return; }
      var idx = byKey.get(key);
      if ((Number(l.updatedAt) || 0) > (Number(unique[idx].updatedAt) || 0)) unique[idx] = l;
    });
    var categories = {};
    ['new', 'retest', 'comprehensive', 'mock', 'unclassified'].forEach(function (k) { categories[k] = blankCategory(k); });
    var essays = [];
    var wrongMap = new Map();
    var linkedTaskIds = Object.create(null);
    var manualCount = 0;
    var durationSeconds = 0;
    var unknownDuration = 0;
    unique.forEach(function (l) {
      if (l.kind !== 'external') manualCount++;
      if (l.taskId) linkedTaskIds[l.taskId] = true;
      var sec = l.durationSeconds;
      if (sec == null && l.durationMinutes != null) sec = l.durationMinutes * 60;
      if (sec != null) durationSeconds += sec; else unknownDuration++;
      (l.wrongQuestions || []).forEach(function (w) {
        var key = wrongKeyFor(l.source, l.externalId, w.questionNo);
        var row = Object.assign({}, w, {
          wrongKey: key, logId: l.id, date: l.date, source: l.source || w.source || null,
          externalId: l.externalId || w.externalId || null, assessment: l.assessment
        });
        if (!wrongMap.has(key) || (Number(l.updatedAt) || 0) > (Number(wrongMap.get(key).logUpdatedAt) || 0)) {
          row.logUpdatedAt = Number(l.updatedAt) || 0;
          wrongMap.set(key, row);
        }
      });
      if (l.assessment === 'essay') {
        essays.push({
          id: l.id, date: l.date, source: l.source, externalId: l.externalId, content: l.content,
          module: l.module, topic: l.topic, scores: (l.essayScores || []).slice(),
          durationSeconds: sec, durationPrecision: l.durationPrecision, taskId: l.taskId
        });
        return;
      }
      // Manual objective records are a real source too (e.g. a user-entered
      // speed drill with no confirmed practice type). Keep them in the same
      // objective categories, but never guess them into new/retest. Pure text
      // notes without objective counts/type are not objective activities.
      if (l.kind !== 'external' && l.questionCount == null && l.questions == null && l.correctCount == null && l.correct == null && l.practiceType == null) return;
      var categoryKey = PRACTICE_TYPES.indexOf(l.practiceType) >= 0 ? l.practiceType : 'unclassified';
      addToCategory(categories[categoryKey], l);
    });
    Object.keys(categories).forEach(function (k) { finishCategory(categories[k]); });
    function mergeCategoryInto(dest, c) {
      dest.activities += c.activities;
      dest.questions += c.questions;
      dest.correct += c.correct;
      dest.incorrect += c.incorrect;
      dest.knownQuestions += c.knownQuestions;
      dest.unknownCorrect += c.unknownCorrect;
      dest.unknownQuestions += c.unknownQuestions;
      dest.durationSeconds = (dest.durationSeconds || 0) + (c.durationSeconds || 0);
      dest.exactSeconds += c.exactSeconds;
      dest.estimatedSeconds += c.estimatedSeconds;
      dest.unknownDuration += c.unknownDuration;
    }
    var total = blankCategory('total');
    total.label = '客观题合计（外部+手动）';
    ['new', 'retest', 'comprehensive', 'mock', 'unclassified'].forEach(function (k) {
      mergeCategoryInto(total, categories[k]);
    });
    if (total.durationSeconds == null) total.durationSeconds = 0;
    finishCategory(total);
    // Explicit directed-practice subtotal: new + retest + unclassified.
    // Comprehensive/mock stay outside. Unclassified is shown, never renamed.
    var subtotal = blankCategory('subtotal');
    subtotal.label = '客观练习小计（不含综合/模考）';
    ['new', 'retest', 'unclassified'].forEach(function (k) {
      mergeCategoryInto(subtotal, categories[k]);
    });
    if (subtotal.durationSeconds == null) subtotal.durationSeconds = 0;
    finishCategory(subtotal);
    subtotal.unclassifiedQuestions = categories.unclassified.questions;
    subtotal.unclassifiedActivities = categories.unclassified.activities;
    subtotal.components = {
      new: categories.new, retest: categories.retest, unclassified: categories.unclassified
    };
    essays.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)); });
    var wrongs = Array.from(wrongMap.values()).map(function (w) { var x = Object.assign({}, w); delete x.logUpdatedAt; return x; });
    return {
      schema: SCHEMA,
      activeCount: unique.length,
      manualCount: manualCount,
      externalCount: unique.length - manualCount,
      objective: { categories: categories, subtotal: subtotal, total: total },
      essays: essays,
      wrongQuestions: wrongs,
      linkedTaskIds: linkedTaskIds,
      durationSeconds: durationSeconds,
      unknownDuration: unknownDuration
    };
  }

  function formatDuration(rec) {
    if (!rec || rec.durationPrecision === 'unknown' || (rec.durationSeconds == null && rec.durationMinutes == null)) return '用时未知';
    var sec = rec.durationSeconds != null ? Number(rec.durationSeconds) : Number(rec.durationMinutes) * 60;
    if (!isFiniteNumber(sec) || sec < 0) return '用时未知';
    if (rec.durationUnit === 'minutes' || (rec.durationMinutes != null && rec.durationSeconds != null && !Number.isInteger(rec.durationSeconds))) {
      var min = rec.durationMinutes != null ? Number(rec.durationMinutes) : sec / 60;
      return (Math.round(min * 100) / 100) + ' 分钟';
    }
    var m = Math.floor(sec / 60), s = Math.round(sec % 60);
    if (s === 60) { m++; s = 0; }
    return (m ? m + ' 分 ' : '') + s + ' 秒';
  }

  function formatAccuracy(v) { return v == null ? '—' : (Math.round(v * 10) / 10) + '%'; }
  function formatPrecision(v) { return PRECISION_LABEL[v] || '未标注'; }

  root.StudyLog = {
    SCHEMA: SCHEMA, BATCH_SCHEMA: BATCH_SCHEMA, KINDS: KINDS, ASSESSMENTS: ASSESSMENTS, PRACTICE_TYPES: PRACTICE_TYPES,
    PRECISIONS: PRECISIONS, RETEST_STATUSES: RETEST_STATUSES, CAUSE_SUGGESTIONS: CAUSE_SUGGESTIONS,
    OBJECTIVE_LABEL: OBJECTIVE_LABEL, PRECISION_LABEL: PRECISION_LABEL, ASSESSMENT_LABEL: ASSESSMENT_LABEL, RETEST_LABEL: RETEST_LABEL,
    externalKeyFor: externalKeyFor, externalKeyOf: externalKeyOf, wrongKeyFor: wrongKeyFor,
    uid: uid, isDate: isDate, normalize: normalize, assertValid: assertValid, normalizeMany: normalizeMany,
    parseBatch: parseBatch, auditSnapshot: auditSnapshot, applyUpdate: applyUpdate, applyDelete: applyDelete,
    summarize: summarize, formatDuration: formatDuration, formatAccuracy: formatAccuracy, formatPrecision: formatPrecision,
    today: dateToday, nowIso: nowIso, average: average
  };
})(typeof window !== 'undefined' ? window : globalThis);
