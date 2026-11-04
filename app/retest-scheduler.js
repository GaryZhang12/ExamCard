/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright 2026 ExamCard contributors */
/* ExamCard 1.2.0 P1 · D+1/D+3/D+7 retest scheduler.
   Pure model: external identities are JSON tuples, internal questions keep their
   stable questionId. The caller persists tasks; nothing is auto-completed. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RetestScheduler = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  var VERSION = 'examcard.retest/v1';
  var INTERVALS = [1, 3, 7];
  var MODES = ['original', 'similar'];
  var REMINDER_STATUSES = ['active', 'skipped', 'closed'];
  var ERROR_DATE_SOURCE = {
    internalTimestamp: 'internal-lastWrongAt-shanghai',
    internalLegacyDate: 'internal-legacy-explicit-date',
    externalDate: 'external-explicit-date'
  };
  var ERROR_DATE_SOURCE_LABEL = {
    'internal-lastWrongAt-shanghai': '内部题：lastWrongAt 原始时间戳按 Asia/Shanghai 转换',
    'internal-legacy-explicit-date': '内部旧数据：无时间戳，兼容显式错误日期',
    'external-explicit-date': '外部练习：原始 date 为显式日期，不转换'
  };
  function errorDateSourceLabel(source) { return ERROR_DATE_SOURCE_LABEL[source] || (clean(source) ? ('来源：' + clean(source)) : '未标注日期来源'); }
  function dayKey(d) { return d.toISOString().slice(0, 10); }
  function timestampValue(v) {
    if (v == null || v === '') return null;
    var n = typeof v === 'number' ? v : Number(v);
    if (!isFinite(n) || n <= 0) {
      if (typeof v === 'string') {
        var parsed = Date.parse(v);
        if (isFinite(parsed) && parsed > 0) n = parsed; else return null;
      } else return null;
    }
    return n;
  }
  // 只用于新建复测计划的边界转换；不改写诊断历史/旧 attempt 的日期字段。
  function shanghaiDayFromTimestamp(ts) {
    var n = timestampValue(ts);
    if (n == null) return null;
    return dayKey(new Date(n + 8 * 3600 * 1000));
  }
  function dayNumber(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return null;
    var d = new Date(String(s) + 'T00:00:00Z');
    return isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : Math.floor(d.getTime() / 86400000);
  }
  function addDays(date, n) {
    var d = dayNumber(date);
    return d == null ? null : dayKey(new Date((d + n) * 86400000));
  }
  function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function uniqueStrings(v) {
    var out = [];
    (Array.isArray(v) ? v : []).forEach(function (x) {
      var s = clean(x);
      if (s && out.indexOf(s) < 0) out.push(s);
    });
    return out;
  }
  function internalIdentity(origin) {
    return ['internal', clean(origin.questionId)];
  }
  function externalIdentity(origin) {
    return ['external', clean(origin.source), clean(origin.externalId), clean(origin.questionNo)];
  }
  function identityFor(origin) {
    if (!origin) return null;
    if (origin.type === 'internal' && origin.questionId) return internalIdentity(origin);
    if (origin.type === 'external' && origin.source && origin.externalId && origin.questionNo) return externalIdentity(origin);
    return null;
  }
  function originKey(origin) {
    var id = identityFor(origin);
    return id ? 'retest-origin:' + JSON.stringify(id) : null;
  }
  function cycleKey(origin) {
    var id = identityFor(origin);
    return id && origin.errorDate ? 'retest-v1:' + JSON.stringify(id.concat([origin.errorDate])) : null;
  }
  function originLabel(origin) {
    if (!origin) return '错题';
    if (origin.type === 'external') return (origin.knowledgePoint || origin.module || '外部错题') + ' · 第 ' + origin.questionNo + ' 题';
    return (origin.knowledgePoint || origin.subject || 'EC 内部题') + (origin.questionNo != null ? ' · 第 ' + origin.questionNo + ' 题' : '');
  }
  function normalizeOrigin(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var type = raw.type === 'external' ? 'external' : raw.type === 'internal' ? 'internal' : null;
    if (!type) return null;
    var origin = {
      type: type,
      errorDate: raw.errorDate,
      knowledgePoint: clean(raw.knowledgePoint),
      module: clean(raw.module),
      subject: clean(raw.subject),
      questionNo: raw.questionNo == null ? null : String(raw.questionNo),
      primaryCause: clean(raw.primaryCause),
      secondaryCauses: uniqueStrings(raw.secondaryCauses),
      method: clean(raw.method),
      logicSymbols: clean(raw.logicSymbols),
      reasoning: clean(raw.reasoning),
      title: clean(raw.title),
      tags: uniqueStrings(raw.tags),
      errorDateSource: clean(raw.errorDateSource) || (type === 'external' ? ERROR_DATE_SOURCE.externalDate : ''),
      lastWrongAt: timestampValue(raw.lastWrongAt)
    };
    if (type === 'internal') {
      origin.questionId = clean(raw.questionId);
      origin.examId = raw.examId == null ? null : String(raw.examId);
      origin.attemptId = raw.attemptId == null ? null : String(raw.attemptId);
    } else {
      origin.source = clean(raw.source);
      origin.externalId = clean(raw.externalId);
      origin.logId = raw.logId == null ? null : String(raw.logId);
    }
    if (!cycleKey(origin)) return null;
    if (!origin.errorDate || dayNumber(origin.errorDate) == null) return null;
    return origin;
  }
  function buildOrigins(input) {
    input = input || {};
    var seen = Object.create(null), origins = [];
    function add(raw) {
      var o = normalizeOrigin(raw);
      if (!o) return;
      var k = cycleKey(o);
      if (seen[k]) return;
      seen[k] = true;
      origins.push(o);
    }
    (input.origins || []).forEach(add);
    (input.engine && input.engine.wrongs || []).forEach(function (w) {
      if (!w || !w.qid) return;
      var timestamp = timestampValue(w.lastWrongAt);
      // 内部错题：原始时间戳优先，并且必须按 Asia/Shanghai 解释。
      // w.lastWrongDate 由 DiagnosisEngine 在主机本地时区生成，不能直接用于
      // 新计划；只有完全没有有效时间戳的旧数据才兼容显式日期并注明来源。
      var errorDate = timestamp != null ? shanghaiDayFromTimestamp(timestamp) : (dayNumber(w.lastWrongDate) != null ? w.lastWrongDate : null);
      if (!errorDate) return;
      add({
        type: 'internal', questionId: w.qid, errorDate: errorDate,
        errorDateSource: timestamp != null ? ERROR_DATE_SOURCE.internalTimestamp : ERROR_DATE_SOURCE.internalLegacyDate,
        lastWrongAt: timestamp,
        examId: w.examId, subject: w.subject || (w.question && w.question.module),
        questionNo: w.n, knowledgePoint: (w.tags || []).join(' / '),
        tags: w.tags, attemptId: w.attempts && w.attempts.length ? w.attempts[w.attempts.length - 1].attemptId : null,
        title: w.examName ? (w.examName + ' · 第 ' + w.n + ' 题') : ('EC 题 ' + w.qid)
      });
    });
    (input.studyLogs || []).forEach(function (log) {
      if (!log || log.status === 'deleted' || log.deletedAt != null) return;
      if (log.kind !== 'external' || !log.source || !log.externalId || !log.date) return;
      (log.wrongQuestions || []).forEach(function (w) {
        if (!w || w.questionNo == null) return;
        add({
          type: 'external', source: log.source, externalId: log.externalId,
          questionNo: w.questionNo, errorDate: log.date, errorDateSource: ERROR_DATE_SOURCE.externalDate, logId: log.id,
          module: log.module, knowledgePoint: w.knowledgePoint || log.knowledgePoint,
          primaryCause: w.primaryCause, secondaryCauses: w.secondaryCauses,
          method: w.method, logicSymbols: w.logicSymbols, reasoning: w.reasoning,
          title: (log.content || log.topic || '外部练习') + ' · 第 ' + w.questionNo + ' 题'
        });
      });
    });
    origins.sort(function (a, b) {
      return String(a.errorDate).localeCompare(String(b.errorDate)) || String(originLabel(a)).localeCompare(String(originLabel(b)), 'zh');
    });
    return origins;
  }
  function taskIdFor(origin, interval, mode) {
    return 'rt-' + JSON.stringify([identityFor(origin), origin.errorDate, interval, mode || 'original']);
  }
  function reviewKeyFor(origin, interval, mode) {
    return 'retest-v1:' + JSON.stringify([identityFor(origin), origin.errorDate, interval, mode || 'original']);
  }
  function taskFor(origin, interval, options) {
    options = options || {};
    var mode = options.mode === 'similar' ? 'similar' : 'original';
    var due = addDays(origin.errorDate, interval);
    if (!due) return null;
    var reviewKey = reviewKeyFor(origin, interval, mode);
    return {
      id: reviewKey,
      reviewKey: reviewKey,
      type: 'retest',
      taskType: 'retest',
      title: 'D+' + interval + ' ' + (mode === 'similar' ? '同类新题验证' : '原题复测') + ' · ' + originLabel(origin),
      date: due,
      dueDate: due,
      time: null,
      priority: 'normal',
      planMinutes: options.minutes == null ? 15 : options.minutes,
      planQuestions: options.questions == null ? 1 : options.questions,
      status: 'pending',
      source: VERSION,
      retestOrigin: origin,
      retestMode: mode,
      retestInterval: interval,
      reminderStatus: 'active',
      mastery: 'unverified',
      retestHistory: [],
      retestResults: [],
      questionIds: origin.type === 'internal' ? [origin.questionId] : [],
      knowledgePoint: origin.knowledgePoint || null,
      module: origin.module || null,
      notes: '由错误日期 ' + origin.errorDate + ' 生成（' + errorDateSourceLabel(origin.errorDateSource) + '）；计划生成不等于完成，一次答对不自动掌握。'
    };
  }
  function plan(origins, options) {
    options = options || {};
    var existing = options.existingTasks || [];
    var existingKeys = Object.create(null);
    existing.forEach(function (t) { if (t && t.reviewKey) existingKeys[t.reviewKey] = true; });
    var tasks = [], skipped = 0;
    (origins || []).forEach(function (raw) {
      var origin = normalizeOrigin(raw);
      if (!origin) return;
      INTERVALS.forEach(function (n) {
        var t = taskFor(origin, n, options);
        if (!t) return;
        if (existingKeys[t.reviewKey]) { skipped++; return; }
        existingKeys[t.reviewKey] = true;
        tasks.push(t);
      });
    });
    return { version: VERSION, intervals: INTERVALS, tasks: tasks, skipped: skipped };
  }
  function similarTask(origin, existingTasks, options) {
    var normalized = normalizeOrigin(origin);
    if (!normalized) return null;
    var interval = Number(options && options.interval);
    if (INTERVALS.indexOf(interval) < 0) interval = 1;
    var t = taskFor(normalized, interval, Object.assign({}, options, { mode: 'similar' }));
    if (!t) return null;
    var exists = (existingTasks || []).some(function (x) { return x && x.reviewKey === t.reviewKey; });
    return exists ? null : t;
  }
  function actionTask(task, action, options) {
    options = options || {};
    if (!task) throw new Error('复测任务不存在');
    if (['advance', 'postpone', 'skip', 'close'].indexOf(action) < 0) throw new Error('未知复测操作');
    var next = JSON.parse(JSON.stringify(task));
    var now = options.now == null ? Date.now() : Number(options.now);
    var fromDue = next.dueDate || next.date || null;
    var toDue = fromDue;
    if (action === 'advance' || action === 'postpone') {
      if (options.date != null) {
        if (dayNumber(options.date) == null) throw new Error('新日期必须为 YYYY-MM-DD');
        toDue = options.date;
      } else {
        toDue = addDays(fromDue, action === 'advance' ? -1 : 1);
      }
      if (!toDue) throw new Error('复测日期无效');
      next.date = toDue;
      next.dueDate = toDue;
      next.reminderStatus = 'active';
    } else {
      next.reminderStatus = action === 'skip' ? 'skipped' : 'closed';
    }
    next.retestHistory = Array.isArray(next.retestHistory) ? next.retestHistory : [];
    next.retestHistory.push({
      at: now, action: action, fromDate: fromDue, toDate: toDue,
      reason: clean(options.reason) || (action === 'advance' ? '提前复测' : action === 'postpone' ? '推迟复测' : action === 'skip' ? '跳过本次' : '关闭提醒')
    });
    next.updatedAt = now;
    return next;
  }
  function shanghaiDay(now) {
    return new Date(Number(now) + 8 * 3600 * 1000).toISOString().slice(0, 10);
  }
  function countOrNull(v, label) {
    if (v == null || v === '') return null;
    var n = Number(v);
    if (!isFinite(n) || n < 0 || Math.floor(n) !== n) throw new Error(label + '必须是非负整数');
    return n;
  }
  function recordResult(task, result, options) {
    options = options || {};
    if (!task) throw new Error('复测任务不存在');
    var next = JSON.parse(JSON.stringify(task));
    var now = options.now == null ? Date.now() : Number(options.now);
    if (!isFinite(now) || now <= 0) throw new Error('复测完成时间无效');
    var todaySh = shanghaiDay(now);
    // 实际完成日期必须来自用户明确填写或真实完成时刻（Asia/Shanghai），
    // 不能沿用计划的 dueDate/date 把提前/晚做归到计划日，更不能伪造未来成绩。
    var actualDate = clean(result && result.date);
    if (!actualDate) actualDate = todaySh;
    if (dayNumber(actualDate) == null) throw new Error('实际完成日期必须为 YYYY-MM-DD');
    if (actualDate > todaySh) throw new Error('实际完成日期不能晚于今天（Asia/Shanghai）');
    var dueDate = next.dueDate || next.date || null;
    var errorDate = next.retestOrigin && next.retestOrigin.errorDate || null;
    var correctCount = countOrNull(result && result.correctCount, '实际正确题数');
    var questionCount = countOrNull(result && result.questionCount, '实际题量');
    if (correctCount != null && questionCount != null && correctCount > questionCount) throw new Error('实际正确题数不能超过实际题量');
    var row = {
      at: now, date: actualDate, dueDate: dueDate, errorDate: errorDate,
      mode: next.retestMode || 'original',
      correctCount: correctCount,
      questionCount: questionCount,
      score: result && result.score != null ? Number(result.score) : null,
      maxScore: result && result.maxScore != null ? Number(result.maxScore) : null,
      note: clean(result && result.note)
    };
    next.retestResults = Array.isArray(next.retestResults) ? next.retestResults : [];
    next.retestResults.push(row);
    next.retestHistory = Array.isArray(next.retestHistory) ? next.retestHistory : [];
    next.retestHistory.push({
      at: now, action: 'result', fromDate: dueDate, toDate: actualDate,
      plannedDate: dueDate, actualDate: actualDate, errorDate: errorDate,
      mode: row.mode, note: row.note
    });
    // 计划日期保持原值；实际完成日期只写入成绩/历史，互不覆盖。
    next.mastery = 'unverified';
    next.updatedAt = now;
    return next;
  }
  return {
    VERSION: VERSION, INTERVALS: INTERVALS, MODES: MODES, REMINDER_STATUSES: REMINDER_STATUSES,
    ERROR_DATE_SOURCE: ERROR_DATE_SOURCE, errorDateSourceLabel: errorDateSourceLabel,
    addDays: addDays, shanghaiDay: shanghaiDay, shanghaiDayFromTimestamp: shanghaiDayFromTimestamp, timestampValue: timestampValue,
    identityFor: identityFor, originKey: originKey, cycleKey: cycleKey,
    buildOrigins: buildOrigins, taskFor: taskFor, plan: plan, similarTask: similarTask,
    actionTask: actionTask, recordResult: recordResult
  };
});
