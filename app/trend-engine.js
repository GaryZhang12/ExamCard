/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright 2026 ExamCard contributors */
/* ExamCard 1.2.0 P2 · WP09 只读趋势计算（不持久化、不新增表、不写聚合真相）。
   输入为 IndexedDB 只读快照；日期窗口固定 Asia/Shanghai（+08:00）。
   本模块不调用 BankMigration，不升级数据库；题库不可用时只返回来源说明。 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TrendEngine = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  var SCHEMA = 'examcard.trend-report/v1';
  var VERSION = '1.0';
  var TIMEZONE = 'Asia/Shanghai';
  var OFFSET = 8 * 3600 * 1000;
  var DAY = 86400000;
  var PRACTICE_TYPES = ['new', 'retest', 'comprehensive', 'mock', 'unclassified'];
  var PRACTICE_LABEL = {
    new: '专项新题', retest: '错题复测', comprehensive: '综合练习', mock: '模考', unclassified: '未分类',
    subtotal: '客观练习小计（不含综合/模考）', total: '客观题合计'
  };
  var MODULE_MIN = 5;
  var CAUSE_MIN = 3;
  var TIME_MIN = 3;
  var DEFAULT_BANK_REASON = '独立题库尚未升级到 v6/28；趋势不读取题库且不会触发升级';

  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function clean(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
  function finite(v) { return typeof v === 'number' && isFinite(v); }
  // Only primitive numbers and numeric strings are meaningful. Arrays/objects
  // (including [] and [0]) and booleans must never become 0. A real number 0
  // (or the string "0") stays 0.
  function nullableNumber(v) {
    if (typeof v !== 'number' && typeof v !== 'string') return null;
    if (typeof v === 'string') { v = v.trim(); if (v === '') return null; }
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function intOrNull(v, min) {
    var n = nullableNumber(v);
    if (n == null || Math.floor(n) !== n) return null;
    if (min != null && n < min) return null;
    return n;
  }
  function timestampOf(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) && v > 0 ? v : null;
    if (typeof v === 'string') {
      var s = v.trim();
      if (!s) return null;
      var n = Number(s);
      if (isFinite(n) && n > 0) return n;
      var p = Date.parse(s);
      return isFinite(p) && p > 0 ? p : null;
    }
    return null;
  }
  function dateKey(v) {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    var n = Date.parse(v + 'T00:00:00Z');
    if (!isFinite(n)) return null;
    return new Date(n).toISOString().slice(0, 10) === v ? v : null;
  }
  function dayNumber(date) {
    var d = dateKey(date);
    return d == null ? null : Math.floor(Date.parse(d + 'T00:00:00Z') / DAY);
  }
  function addDays(date, n) {
    var d = dayNumber(date);
    return d == null ? null : new Date((d + n) * DAY).toISOString().slice(0, 10);
  }
  function shanghaiDateOf(ts) {
    var n = timestampOf(ts);
    return n == null ? null : new Date(n + OFFSET).toISOString().slice(0, 10);
  }
  function rangeFor(now, days) {
    var n = timestampOf(now);
    if (n == null) throw new Error('趋势窗口 now 必须为有效时间戳');
    var d = intOrNull(days, 1);
    if (d == null || d > 365) throw new Error('趋势窗口 days 必须为 1–365 的整数');
    var to = shanghaiDateOf(n);
    var from = addDays(to, -(d - 1));
    var startAt = new Date(Date.parse(from + 'T00:00:00Z') - OFFSET).toISOString();
    var endAtExclusive = new Date(Date.parse(addDays(to, 1) + 'T00:00:00Z') - OFFSET).toISOString();
    return { days: d, from: from, to: to, startAt: startAt, endAtExclusive: endAtExclusive };
  }
  function inWindow(date, range) { return !!date && date >= range.from && date <= range.to; }
  function round1(v) { return v == null || !isFinite(v) ? null : Math.round(v * 10) / 10; }
  function round3(v) { return v == null || !isFinite(v) ? null : Math.round(v * 1000) / 1000; }
  function externalKeyFor(source, externalId) {
    return 'ext:' + JSON.stringify([String(source == null ? '' : source), String(externalId == null ? '' : externalId)]);
  }
  function externalKeyOf(log) {
    if (!log || typeof log !== 'object') return null;
    // Legacy rows may predate the kind field but still carry a real external
    // namespace. Use source/externalId whenever present; never use the old
    // ambiguous concatenated externalKey when the tuple is available.
    if (clean(log.source) && clean(log.source) !== 'manual' && log.externalId != null && clean(log.externalId)) {
      return externalKeyFor(clean(log.source), clean(log.externalId));
    }
    if (log.externalKey) return 'legacy:' + String(log.externalKey);
    return log.id ? 'id:' + String(log.id) : null;
  }
  function wrongKeyFor(source, externalId, questionNo) {
    return 'w2:' + JSON.stringify([String(source == null ? '' : source), String(externalId == null ? '' : externalId), String(questionNo == null ? '' : questionNo)]);
  }
  function snapshotOrder(r) {
    return [timestampOf(r && r.gradedAt) || 0, timestampOf(r && r.createdAt) || 0, String(r && r.attemptId || '')];
  }
  function compareSnapshot(a, b) {
    var x = snapshotOrder(a), y = snapshotOrder(b);
    if (x[0] !== y[0]) return x[0] - y[0];
    if (x[1] !== y[1]) return x[1] - y[1];
    return x[2].localeCompare(y[2]);
  }
  function latestBy(rows, keyFn, timeFn, idFn) {
    var map = new Map(), suppressed = 0;
    rows.forEach(function (row) {
      var key = keyFn(row);
      if (!key) return;
      var old = map.get(key);
      if (!old) { map.set(key, row); return; }
      var a = timeFn(row), b = timeFn(old);
      if (a > b || (a === b && String(idFn(row) || '').localeCompare(String(idFn(old) || '')) > 0)) map.set(key, row);
      suppressed++;
    });
    return { rows: Array.from(map.values()), suppressed: suppressed };
  }
  // Build first/repeat classification from ALL history, not just the selected
  // window. The index key identifies one attempt of one stable question; a
  // question's ordinal is deterministic by original timestamp then stable tie
  // breaker. If any entry for that question lacks a timestamp, the whole
  // question is UNKNOWN rather than guessed.
  function buildNoveltyIndex(entries, idOf, timeOf, keyOf, tieOf) {
    var groups = new Map();
    entries.forEach(function (entry) {
      var id = idOf(entry);
      if (!id) return;
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push({ entry: entry, at: timeOf(entry), tie: String(tieOf(entry) || '') });
    });
    var out = new Map();
    groups.forEach(function (list) {
      var reliable = list.every(function (x) { return x.at != null; });
      list.sort(function (a, b) {
        return (a.at == null ? 0 : a.at) - (b.at == null ? 0 : b.at) || a.tie.localeCompare(b.tie);
      });
      list.forEach(function (x, i) {
        out.set(keyOf(x.entry), {
          novelty: reliable ? (i === 0 ? 'first' : 'repeat') : 'unknown',
          priorCount: reliable ? i : null,
          historyCount: list.length,
          noveltySource: reliable ? 'all-history-order' : 'missing-timestamp'
        });
      });
    });
    return out;
  }
  function percentile(sorted, p) {
    if (!sorted.length) return null;
    var idx = Math.ceil(p * sorted.length) - 1;
    idx = Math.max(0, Math.min(sorted.length - 1, idx));
    return sorted[idx];
  }
  function summarySeconds(values) {
    if (!values.length) {
      return { count: 0, meanSeconds: null, p50Seconds: null, p90Seconds: null, minSeconds: null, maxSeconds: null, dataInsufficient: true };
    }
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var sum = sorted.reduce(function (a, b) { return a + b; }, 0);
    return {
      count: sorted.length,
      meanSeconds: round1(sum / sorted.length),
      p50Seconds: round1(percentile(sorted, 0.5)),
      p90Seconds: round1(percentile(sorted, 0.9)),
      minSeconds: round1(sorted[0]),
      maxSeconds: round1(sorted[sorted.length - 1]),
      dataInsufficient: sorted.length < TIME_MIN
    };
  }
  function blankBucket(key, label) {
    return {
      key: key, label: label, activities: 0, questions: 0, known: 0,
      correct: 0, incorrect: 0, unknownQuestions: 0, unknownCorrect: 0,
      unknownActivities: 0, accuracy: null, dataInsufficient: true, sources: Object.create(null)
    };
  }
  function addSample(bucket, questions, correct, unknownQuestions, isActivity, source) {
    if (isActivity) {
      bucket.activities++;
      if (source) bucket.sources[source] = (bucket.sources[source] || 0) + 1;
    }
    if (questions == null) { bucket.unknownActivities++; return; }
    var q = intOrNull(questions, 0);
    if (q == null) { bucket.unknownActivities++; return; }
    var unknown = intOrNull(unknownQuestions, 0);
    if (unknown == null) unknown = correct == null ? q : 0;
    unknown = Math.max(0, Math.min(q, unknown));
    var known = q - unknown;
    bucket.questions += q;
    bucket.unknownQuestions += unknown;
    bucket.unknownCorrect += unknown;
    if (correct == null || !finite(Number(correct))) {
      bucket.unknownQuestions += known;
      bucket.unknownCorrect += known;
      return;
    }
    var c = intOrNull(correct, 0);
    if (c == null || c > known) {
      bucket.unknownQuestions += known;
      bucket.unknownCorrect += known;
      return;
    }
    bucket.correct += c;
    bucket.incorrect += known - c;
    bucket.known += known;
  }
  function finishBucket(bucket, threshold) {
    bucket.name = bucket.key;
    bucket.accuracy = bucket.known > 0 ? round1(bucket.correct * 100 / bucket.known) : null;
    bucket.dataInsufficient = bucket.known < (threshold == null ? 1 : threshold);
    return bucket;
  }
  function bucketFor(map, key, label, threshold) {
    var k = clean(key) || '未分类';
    var b = map.get(k);
    if (!b) { b = blankBucket(k, label || k); map.set(k, b); }
    return b;
  }
  function composeSubtotal(types) {
    var b = blankBucket('subtotal', PRACTICE_LABEL.subtotal);
    ['new', 'retest', 'unclassified'].forEach(function (k) {
      var c = types[k];
      if (!c) return;
      b.activities += c.activities;
      b.questions += c.questions;
      b.known += c.known;
      b.correct += c.correct;
      b.incorrect += c.incorrect;
      b.unknownQuestions += c.unknownQuestions;
      b.unknownCorrect += c.unknownCorrect;
      b.unknownActivities += c.unknownActivities;
      Object.keys(c.sources || {}).forEach(function (s) { b.sources[s] = (b.sources[s] || 0) + c.sources[s]; });
    });
    b.accuracy = b.known > 0 ? round1(b.correct * 100 / b.known) : null;
    b.dataInsufficient = b.known < 1;
    b.components = {
      new: types.new, retest: types.retest, unclassified: types.unclassified
    };
    b.unclassifiedQuestions = types.unclassified.questions;
    b.unclassifiedActivities = types.unclassified.activities;
    return b;
  }

  function normalizeGrading(records, exams, tags, questionTags, sessions, range, acc) {
    var examMap = Object.create(null);
    (exams || []).forEach(function (e) { if (e && e.id) examMap[e.id] = e; });
    var tagMap = Object.create(null);
    (tags || []).forEach(function (t) { if (t && t.id) tagMap[t.id] = t; });
    var qTags = Object.create(null);
    (questionTags || []).forEach(function (qt) {
      if (!qt || !qt.questionId) return;
      if (tagMap[qt.tagId] && tagMap[qt.tagId].enabled === false) return;
      (qTags[qt.questionId] = qTags[qt.questionId] || []).push(qt.tagId);
    });
    var sessionMap = Object.create(null);
    (sessions || []).forEach(function (s) { if (s && s.id) sessionMap[s.id] = s; });

    var graded = [];
    (records || []).forEach(function (r) {
      if (!r || r.gradingStatus !== 'graded' || !r.summary || !Array.isArray(r.details)) return;
      graded.push(r);
      acc.sources.software.snapshots++;
    });
    // Deterministic latest graded snapshot per session. Never add r1+r2 times.
    var bySession = new Map();
    graded.forEach(function (r) {
      var sid = clean(r.sessionId);
      if (!sid) { acc.sources.software.invalidActivities++; return; }
      var old = bySession.get(sid);
      if (!old || compareSnapshot(r, old) > 0) bySession.set(sid, r);
    });
    acc.sources.software.suppressedSnapshots = graded.length - bySession.size;

    var allActivities = [];
    bySession.forEach(function (r) {
      var at = timestampOf(r.gradedAt) || timestampOf(r.createdAt);
      var date = shanghaiDateOf(at);
      if (!date) { acc.sources.software.invalidActivities++; return; }
      var cfg = r.config && typeof r.config === 'object' && Object.keys(r.config).length ? r.config : ((sessionMap[r.sessionId] || {}).config || {});
      var category = 'unclassified';
      if (cfg.retest || cfg.sourceSessionId || cfg.mode === 'retest') category = 'retest';
      else if (cfg.mode === 'full' || cfg.mode === 'mock') category = 'mock';
      else if (cfg.mode === 'practice' || cfg.mode === 'new') category = 'new';
      else if (cfg.mode === 'comprehensive') category = 'comprehensive';
      var retestMode = cfg.retestMode === 'original' || cfg.retestMode === 'similar' ? cfg.retestMode : null;
      var exam = examMap[r.examId] || { id: r.examId, questions: [] };
      var seen = Object.create(null);
      var events = [];
      (r.details || []).forEach(function (d) {
        if (!d) return;
        var questionNo = d.question_id != null ? String(d.question_id) : '';
        if (!questionNo) { acc.sources.software.invalidEvents++; return; }
        if (seen[questionNo]) { acc.sources.software.duplicateEvents++; return; }
        seen[questionNo] = true;
        var examQuestion = (exam.questions || []).filter(function (q) { return Number(q.n) === Number(d.question_id); })[0] || null;
        var stableQuestionId = examQuestion ? (examQuestion.questionId || examQuestion.id || ('q-' + exam.id + '-' + questionNo)) : null;
        var tagIds = qTags[stableQuestionId] || [];
        var tagNames = tagIds.map(function (id) { return (tagMap[id] && tagMap[id].name) || id; }).filter(Boolean);
        var status = d.grading_status;
        var correct = status === 'correct' ? true : status === 'incorrect' ? false
          : (status === 'unanswered' || status === 'unverified') ? null
            : (typeof d.is_correct === 'boolean' ? d.is_correct : null);
        var elapsed = nullableNumber(d.elapsed_seconds);
        if (elapsed != null && elapsed < 0) elapsed = null;
        // A recorded 0 on an unanswered row is the absence of an answer timer,
        // not a real 0-second attempt. Keep it unknown instead of fabricating a
        // zero sample.
        if (elapsed === 0 && status === 'unanswered') elapsed = null;
        events.push({
          questionId: questionNo,
          stableQuestionId: stableQuestionId,
          historyId: stableQuestionId || (r.examId ? String(r.examId) + '|' + questionNo : null),
          correct: correct,
          elapsedSeconds: elapsed,
          module: clean(d.subject) || clean(examQuestion && examQuestion.module) || '未分类',
          tags: tagNames,
          unknownReason: correct == null ? (status || 'unknown') : null
        });
      });
      var questions = events.length;
      var correctCount = events.filter(function (e) { return e.correct === true; }).length;
      var unknownCount = events.filter(function (e) { return e.correct == null; }).length;
      allActivities.push({
        source: 'software', id: r.sessionId, activityId: 'software:' + r.sessionId,
        at: at, date: date, category: category, retestMode: retestMode,
        questions: questions, correct: questions ? correctCount : null, unknownQuestions: unknownCount,
        events: events, durationSeconds: null, durationPrecision: null, wrongs: [], linkedTaskId: null,
        attemptId: r.attemptId || null
      });
    });
    // Classify every question against ALL sessions, including those outside the
    // selected window. Window filtering happens only after this pass.
    var historyEntries = [];
    allActivities.forEach(function (a) {
      a.events.forEach(function (e) {
        if (e.historyId) historyEntries.push({ activity: a, event: e });
      });
    });
    var novelty = buildNoveltyIndex(
      historyEntries,
      function (x) { return x.event.historyId; },
      function (x) { return x.activity.at; },
      function (x) { return String(x.activity.id) + '\u0000' + x.event.questionId; },
      function (x) { return String(x.activity.attemptId || x.activity.id || ''); }
    );
    allActivities.forEach(function (a) {
      a.events.forEach(function (e) {
        if (!e.historyId) {
          e.novelty = 'unknown';
          e.noveltySource = 'no-stable-question-id';
          return;
        }
        var n = novelty.get(String(a.id) + '\u0000' + e.questionId);
        e.novelty = n ? n.novelty : 'unknown';
        e.noveltySource = n ? n.noveltySource : 'missing-history';
        e.historyCount = n ? n.historyCount : null;
        e.priorCount = n ? n.priorCount : null;
      });
    });
    var activities = allActivities.filter(function (a) { return inWindow(a.date, range); });
    acc.sources.software.activities = activities.length;
    return activities;
  }

  function normalizeStudyLogs(logs, range, acc) {
    var active = [];
    (logs || []).forEach(function (l) {
      if (!l || l.status === 'deleted' || l.deletedAt != null) { acc.sources.external.deletedSuppressed++; return; }
      var key = externalKeyOf(l);
      if (!key) { acc.sources.external.invalidActivities++; return; }
      active.push(l);
    });
    var latest = latestBy(active, externalKeyOf,
      function (l) { return timestampOf(l.updatedAt) || timestampOf(l.createdAt) || 0; },
      function (l) { return l.id || ''; });
    acc.sources.external.duplicatesSuppressed = latest.suppressed;
    var rows = latest.rows;

    var external = [], essays = [];
    rows.forEach(function (l) {
      var date = dateKey(l.date) || shanghaiDateOf(l.createdAt) || shanghaiDateOf(l.updatedAt);
      if (!date) { acc.sources.external.invalidActivities++; return; }
      if (!inWindow(date, range)) return;
      var at = timestampOf(l.occurredAt) || timestampOf(l.createdAt) || timestampOf(l.updatedAt);
      var isManual = l.kind === 'manual' || (!l.kind && !(clean(l.source) && clean(l.source) !== 'manual' && clean(l.externalId)));
      if (l.taskId) acc.planLinkedActivities++;
      if (l.assessment === 'essay') {
        essays.push({
          source: isManual ? 'manual' : 'external',
          activityId: (isManual ? 'manual:' : 'external:') + (l.id || ''),
          logId: l.id || null, date: date, at: at,
          content: clean(l.content), module: clean(l.module), topic: clean(l.topic),
          taskId: l.taskId || null,
          scores: (Array.isArray(l.essayScores) ? l.essayScores : []).map(function (s) { return Object.assign({}, s); }),
          dataInsufficient: !(Array.isArray(l.essayScores) && l.essayScores.length)
        });
        return;
      }
      var q = intOrNull(l.questionCount != null ? l.questionCount : l.questions, 0);
      var c = intOrNull(l.correctCount != null ? l.correctCount : l.correct, 0);
      if (q == null || (c != null && c > q)) c = null;
      if (q == null && c != null) c = null;
      var precision = l.durationPrecision;
      if (['exact', 'estimated', 'unknown'].indexOf(precision) < 0) precision = null;
      var seconds = nullableNumber(l.durationSeconds);
      if (seconds == null) {
        var minutes = nullableNumber(l.durationMinutes);
        if (minutes == null) minutes = nullableNumber(l.durationMin);
        seconds = minutes == null ? null : minutes * 60;
      }
      if (seconds != null && seconds < 0) seconds = null;
      if (!precision) precision = seconds != null ? 'estimated' : 'unknown';
      if (precision === 'unknown') seconds = null;
      var tags = [];
      if (clean(l.knowledgePoint)) tags.push(clean(l.knowledgePoint));
      if (!tags.length) tags.push('未标注');
      var practiceType = PRACTICE_TYPES.indexOf(l.practiceType) >= 0 && l.practiceType !== 'unclassified' ? l.practiceType : 'unclassified';
      var wrongs = [];
      (Array.isArray(l.wrongQuestions) ? l.wrongQuestions : []).forEach(function (w) {
        if (!w || w.questionNo == null) return;
        wrongs.push({
          questionNo: String(w.questionNo),
          primaryCause: clean(w.primaryCause),
          secondaryCauses: Array.isArray(w.secondaryCauses) ? w.secondaryCauses.map(clean).filter(Boolean) : [],
          knowledgePoint: clean(w.knowledgePoint),
          source: l.source || null,
          externalId: l.externalId || null,
          logId: l.id || null,
          logUpdatedAt: timestampOf(l.updatedAt) || 0
        });
      });
      if (isManual && q == null && practiceType === 'unclassified') return;
      if (isManual) acc.sources.external.manualActivities++;
      else acc.sources.external.activities++;
      external.push({
        source: isManual ? 'manual' : 'external',
        id: l.id, activityId: (isManual ? 'manual:' : 'external:') + (l.id || ''),
        at: at, date: date,
        category: practiceType,
        retestMode: null,
        questions: q, correct: q == null ? null : c, unknownQuestions: q != null && c == null ? q : 0,
        events: [], durationSeconds: seconds, durationPrecision: precision,
        wrongs: wrongs, linkedTaskId: l.taskId || null,
        module: clean(l.module) || '未分类',
        knowledgeTags: tags,
        questionCountKnown: q != null
      });
    });
    return { activities: external, essays: essays };
  }
  function normalizeBank(input, range, acc) {
    var bank = input && input.bank;
    var available = !(bank && bank.available === false);
    var reason = bank && bank.reason ? String(bank.reason) : DEFAULT_BANK_REASON;
    var attempts = (bank && Array.isArray(bank.attempts)) ? bank.attempts : (Array.isArray(input && input.bankAttempts) ? input.bankAttempts : []);
    var sets = (bank && Array.isArray(bank.sets)) ? bank.sets : (Array.isArray(input && input.practiceSets) ? input.practiceSets : []);
    var questions = (bank && Array.isArray(bank.questions)) ? bank.questions : (Array.isArray(input && input.bankQuestions) ? input.bankQuestions : []);
    if (!available) {
      acc.sources.bank.available = false;
      acc.sources.bank.reason = reason;
      return [];
    }
    acc.sources.bank.available = true;
    acc.sources.bank.reason = null;
    var setMap = Object.create(null), qMap = Object.create(null);
    sets.forEach(function (s) { if (s && s.id) setMap[s.id] = s; });
    questions.forEach(function (q) { if (q && q.id) qMap[q.id] = q; });
    var latest = latestBy(attempts, function (a) { return a && (a.id || a.sessionId) ? String(a.id || a.sessionId) : null; },
      function (a) { return timestampOf(a.submittedAt) || timestampOf(a.createdAt) || 0; },
      function (a) { return a.id || a.sessionId || ''; });
    acc.sources.bank.suppressedAttempts = latest.suppressed;
    acc.sources.bank.attempts = attempts.length;
    // First/repeat index across ALL bank attempts, including attempts outside
    // the selected window. It is keyed by the stable bankQuestionId.
    var historyEntries = [];
    latest.rows.forEach(function (a) {
      var at = timestampOf(a.submittedAt) || timestampOf(a.createdAt);
      var attemptId = String(a.id || a.sessionId);
      var histSeen = Object.create(null);
      (Array.isArray(a.results) ? a.results : []).forEach(function (r) {
        if (!r || !r.bankQuestionId) return;
        var qid = String(r.bankQuestionId);
        if (histSeen[qid]) return;
        histSeen[qid] = true;
        historyEntries.push({ attempt: a, result: r, qid: qid, at: at, attemptId: attemptId });
      });
    });
    var novelty = buildNoveltyIndex(
      historyEntries,
      function (x) { return x.qid; },
      function (x) { return x.at; },
      function (x) { return x.attemptId + '\u0000' + x.qid; },
      function (x) { return x.attemptId; }
    );
    var activities = [];
    latest.rows.forEach(function (a) {
      var at = timestampOf(a.submittedAt) || timestampOf(a.createdAt);
      var date = shanghaiDateOf(at);
      if (!date) { acc.sources.bank.invalidActivities++; return; }
      var set = setMap[a.practiceSetId] || null;
      var assemblyMode = set && set.mode ? String(set.mode) : 'unknown';
      acc.sources.bank.modes[assemblyMode] = (acc.sources.bank.modes[assemblyMode] || 0) + 1;
      if (!set) acc.sources.bank.missingSets++;
      var setQuestions = Object.create(null);
      ((set && set.questions) || []).forEach(function (q) { if (q && q.id) setQuestions[q.id] = q; });
      var category = 'unclassified';
      if (set && PRACTICE_TYPES.indexOf(set.practiceType) >= 0 && set.practiceType !== 'unclassified') category = set.practiceType;
      else if (set && set.mode === 'mock') category = 'mock';
      else if (set && set.mode === 'wrong') category = 'retest';
      // random/unseen/weak only describe assembly order/filters. They are NOT
      // evidence that every question is new; per-question novelty is separate.
      var retestMode = set && (set.retestMode === 'original' || set.retestMode === 'similar') ? set.retestMode : (set && set.mode === 'wrong' ? 'original' : null);
      var seen = Object.create(null);
      var events = [];
      (Array.isArray(a.results) ? a.results : []).forEach(function (r) {
        if (!r || !r.bankQuestionId) { acc.sources.bank.invalidEvents++; return; }
        var qid = String(r.bankQuestionId);
        if (seen[qid]) { acc.sources.bank.duplicateEvents++; return; }
        seen[qid] = true;
        var q = setQuestions[qid] || qMap[qid] || null;
        var tagList = Array.isArray(r.tags) && r.tags.length ? r.tags : ((q && q.tags) || []);
        var correct = r.correct === true ? true : r.correct === false ? false : null;
        var elapsedMs = nullableNumber(r.elapsedMs);
        var elapsed = elapsedMs != null && elapsedMs >= 0 ? elapsedMs / 1000 : null;
        // BankPractice stores elapsedMs=0 for an unvisited/unanswered question.
        // That is not a real 0-second per-question sample.
        if (elapsed === 0 && correct == null && !r.selected) elapsed = null;
        var attemptId = String(a.id || a.sessionId);
        var n = novelty.get(attemptId + '\u0000' + qid);
        events.push({
          questionId: null,
          bankQuestionId: qid,
          correct: correct,
          elapsedSeconds: elapsed,
          module: clean(q && q.module) || '未分类',
          tags: tagList.map(clean).filter(Boolean),
          unknownReason: correct == null ? 'unknown' : null,
          novelty: n ? n.novelty : 'unknown',
          noveltySource: n ? n.noveltySource : 'missing-history',
          historyCount: n ? n.historyCount : null,
          priorCount: n ? n.priorCount : null
        });
      });
      var unknown = events.filter(function (e) { return e.correct == null; }).length;
      activities.push({
        source: 'bank', id: a.id || a.sessionId, activityId: 'bank:' + (a.id || a.sessionId),
        at: at, date: date, category: category, retestMode: retestMode,
        assemblyMode: assemblyMode,
        questions: events.length, correct: events.length ? events.filter(function (e) { return e.correct === true; }).length : null,
        unknownQuestions: unknown, events: events,
        durationSeconds: null, durationPrecision: null, wrongs: [], linkedTaskId: null,
        practiceSetId: a.practiceSetId || null
      });
    });
    activities = activities.filter(function (a) { return inWindow(a.date, range); });
    acc.sources.bank.activities = activities.length;
    return activities;
  }

  function noveltyBucket(acc, novelty) {
    return acc.questionHistory[novelty === 'first' || novelty === 'repeat' ? novelty : 'unknown'];
  }
  function addNoveltySample(acc, novelty, questions, correct, unknown, source, isActivity) {
    var b = noveltyBucket(acc, novelty);
    if (isActivity) { b.activities++; if (source) b.sources[source] = (b.sources[source] || 0) + 1; }
    addSample(b, questions, correct, unknown, false);
  }
  function ensureDaily(acc, date) {
    var d = acc.daily.get(date);
    if (!d) {
      d = {
        date: date, activities: 0, questions: 0, known: 0, correct: 0, incorrect: 0,
        unknownQuestions: 0, accuracy: null, dataInsufficient: true,
        sources: Object.create(null), practiceTypes: Object.create(null),
        duration: { exactSeconds: 0, estimatedSeconds: 0, unknownActivities: 0 },
        novelty: { first: 0, repeat: 0, unknown: 0 },
        essayScores: 0, retestResults: 0
      };
      acc.daily.set(date, d);
    }
    return d;
  }
  function addDaily(acc, activity) {
    var d = ensureDaily(acc, activity.date);
    d.activities++;
    d.sources[activity.source] = (d.sources[activity.source] || 0) + 1;
    var cat = PRACTICE_TYPES.indexOf(activity.category) >= 0 ? activity.category : 'unclassified';
    d.practiceTypes[cat] = (d.practiceTypes[cat] || 0) + 1;
    if (activity.questions == null) {
      d.unknownQuestions += 0;
    } else {
      var q = Math.max(0, activity.questions);
      var unknown = Math.max(0, Math.min(q, activity.unknownQuestions || 0));
      var known = q - unknown;
      var correct = activity.correct == null ? null : Math.max(0, Math.min(known, activity.correct));
      d.questions += q;
      d.unknownQuestions += unknown + (correct == null ? known : 0);
      if (correct != null) { d.correct += correct; d.incorrect += known - correct; d.known += known; }
      if (activity.events && activity.events.length) {
        activity.events.forEach(function (e) {
          d.novelty[e.novelty === 'first' || e.novelty === 'repeat' ? e.novelty : 'unknown']++;
        });
      } else {
        d.novelty.unknown += q;
      }
    }
    if (activity.events && activity.events.length) {
      var exact = 0, missing = 0;
      activity.events.forEach(function (e) {
        if (e.elapsedSeconds != null && finite(e.elapsedSeconds) && e.elapsedSeconds >= 0) exact += e.elapsedSeconds; else missing++;
      });
      if (exact || !missing) d.duration.exactSeconds += exact;
      if (missing) d.duration.unknownActivities++;
    } else if (activity.durationPrecision === 'exact' && activity.durationSeconds != null) {
      d.duration.exactSeconds += activity.durationSeconds;
    } else if (activity.durationPrecision === 'estimated' && activity.durationSeconds != null) {
      d.duration.estimatedSeconds += activity.durationSeconds;
    } else {
      d.duration.unknownActivities++;
    }
  }
  function addActivity(activity, range, acc) {
    var questions = activity.questions;
    var correct = activity.correct;
    var unknown = activity.unknownQuestions || 0;
    if (questions == null) unknown = 0;

    // overall and practice type count an activity exactly once.
    addSample(acc.total, questions, correct, unknown, true, activity.source);
    var cat = PRACTICE_TYPES.indexOf(activity.category) >= 0 ? activity.category : 'unclassified';
    addSample(acc.practice[cat], questions, correct, unknown, true, activity.source);
    addDaily(acc, activity);

    // First/repeat/unknown is a per-question history dimension, independent of
    // the practice-type intent. Stable ids are required; aggregate external
    // activities cannot be assigned a question-level history.
    if (activity.events && activity.events.length) {
      var usedNovelty = Object.create(null);
      activity.events.forEach(function (e) {
        var n = e.novelty === 'first' || e.novelty === 'repeat' ? e.novelty : 'unknown';
        if (!usedNovelty[n]) {
          usedNovelty[n] = true;
          var nb = noveltyBucket(acc, n);
          nb.activities++;
          nb.sources[activity.source] = (nb.sources[activity.source] || 0) + 1;
        }
        addSample(noveltyBucket(acc, n), 1, e.correct === true ? 1 : (e.correct === false ? 0 : null), e.correct == null ? 1 : 0, false);
      });
    } else {
      addNoveltySample(acc, 'unknown', questions, correct, unknown, activity.source, true);
    }

    // module / knowledge groups: software/bank per question, external/manual aggregate.
    var moduleGroups = new Map(), knowledgeGroups = new Map();
    if (activity.events && activity.events.length) {
      activity.events.forEach(function (e) {
        var m = bucketFor(moduleGroups, e.module || '未分类', e.module || '未分类');
        addSample(m, 1, e.correct === true ? 1 : (e.correct === false ? 0 : null), e.correct == null ? 1 : 0, false);
        var tags = (e.tags && e.tags.length) ? e.tags : ['未标注'];
        Array.from(new Set(tags)).forEach(function (tag) {
          var k = bucketFor(knowledgeGroups, tag, tag);
          addSample(k, 1, e.correct === true ? 1 : (e.correct === false ? 0 : null), e.correct == null ? 1 : 0, false);
        });
      });
    } else {
      var moduleName = clean(activity.module) || '未分类';
      addSample(bucketFor(moduleGroups, moduleName, moduleName), questions, correct, unknown, false);
      var tags = (activity.knowledgeTags && activity.knowledgeTags.length) ? activity.knowledgeTags : ['未标注'];
      Array.from(new Set(tags)).forEach(function (tag) {
        addSample(bucketFor(knowledgeGroups, tag, tag), questions, correct, unknown, false);
      });
    }
    moduleGroups.forEach(function (group, key) {
      var b = bucketFor(acc.modules, key, key);
      addSample(b, group.questions, group.correct, group.unknownQuestions, true, activity.source);
    });
    knowledgeGroups.forEach(function (group, key) {
      var b = bucketFor(acc.knowledge, key, key);
      addSample(b, group.questions, group.correct, group.unknownQuestions, true, activity.source);
    });

    // per-question time: only real per-question fields.
    if (activity.events && activity.events.length) {
      var exactCount = 0, missing = 0;
      activity.events.forEach(function (e) {
        if (e.elapsedSeconds != null && finite(e.elapsedSeconds) && e.elapsedSeconds >= 0) {
          acc.perQuestion.exact.push({
            source: activity.source, activityId: activity.activityId, date: activity.date, at: activity.at,
            questionId: e.questionId, bankQuestionId: e.bankQuestionId || null,
            elapsedSeconds: round3(e.elapsedSeconds)
          });
          acc.perQuestion.exactSeconds += e.elapsedSeconds;
          exactCount++;
        } else missing++;
      });
      acc.perQuestion.noPerQuestionCount += missing;
      if (missing) acc.perQuestion.unknownCount += missing;
      if (exactCount) {
        var exactSum = activity.events.reduce(function (sum, e) { return sum + (e.elapsedSeconds != null && finite(e.elapsedSeconds) ? e.elapsedSeconds : 0); }, 0);
        acc.totalDuration.exactSeconds += exactSum;
        acc.totalDuration.activities++;
        acc.totalDuration.bySource[activity.source].activities++;
        acc.totalDuration.bySource[activity.source].exactSeconds += exactSum;
        if (missing) {
          acc.totalDuration.partialExactActivities++;
          acc.totalDuration.bySource[activity.source].partialExactActivities++;
        } else {
          acc.totalDuration.exactActivities++;
          acc.totalDuration.bySource[activity.source].exactActivities++;
        }
      } else if (activity.events.length) {
        acc.totalDuration.unknownActivities++;
        acc.totalDuration.bySource[activity.source].unknownActivities++;
      }
    } else {
      // activity-level duration only; never expand into per-question samples.
      var q = questions == null ? 1 : questions;
      acc.perQuestion.noPerQuestionCount += q;
      if (activity.durationPrecision === 'exact' && activity.durationSeconds != null) {
        acc.totalDuration.exactSeconds += activity.durationSeconds;
        acc.totalDuration.exactActivities++;
        acc.totalDuration.activities++;
        acc.totalDuration.bySource[activity.source].exactSeconds += activity.durationSeconds;
        acc.totalDuration.bySource[activity.source].exactActivities++;
        acc.totalDuration.bySource[activity.source].activities++;
      } else if (activity.durationPrecision === 'estimated' && activity.durationSeconds != null) {
        acc.totalDuration.estimatedSeconds += activity.durationSeconds;
        acc.totalDuration.estimatedActivities++;
        acc.totalDuration.activities++;
        acc.totalDuration.bySource[activity.source].estimatedSeconds += activity.durationSeconds;
        acc.totalDuration.bySource[activity.source].estimatedActivities++;
        acc.totalDuration.bySource[activity.source].activities++;
        if (questions != null && questions > 0) {
          acc.perQuestion.estimated.push({
            source: activity.source, activityId: activity.activityId, date: activity.date, at: activity.at,
            questionCount: questions, durationSeconds: round3(activity.durationSeconds),
            secondsPerQuestion: round3(activity.durationSeconds / questions),
            sampleKind: 'activity-average', precision: 'estimated'
          });
          acc.perQuestion.estimatedQuestions += questions;
        }
      } else {
        acc.perQuestion.unknownCount += q;
        acc.totalDuration.unknownActivities++;
        acc.totalDuration.bySource[activity.source].unknownActivities++;
      }
    }

    // causes: external/manual wrong questions only; de-duplicated later by wrongKey.
    if ((activity.source === 'external' || activity.source === 'manual') && activity.wrongs && activity.wrongs.length) {
      activity.wrongs.forEach(function (w) {
        var key = w.source && w.externalId ? wrongKeyFor(w.source, w.externalId, w.questionNo) : ('log:' + (w.logId || activity.id) + ':' + w.questionNo);
        acc.wrongMap.set(key, {
          key: key, questionNo: w.questionNo, primaryCause: w.primaryCause,
          secondaryCauses: w.secondaryCauses, knowledgePoint: w.knowledgePoint,
          source: w.source, externalId: w.externalId, logId: w.logId, logUpdatedAt: w.logUpdatedAt
        });
      });
    }
    if (activity.source !== 'software' && activity.source !== 'bank' && activity.questions != null && activity.correct != null) {
      var incorrect = activity.questions - activity.correct;
      var recorded = Array.from(new Set((activity.wrongs || []).map(function (w) { return w.questionNo; }))).length;
      if (incorrect > 0) acc.uncausedIncorrect += Math.max(0, incorrect - recorded);
    }
  }

  function finalizeCauses(acc) {
    var map = new Map();
    Array.from(acc.wrongMap.values()).forEach(function (w) {
      var primary = clean(w.primaryCause);
      var secondary = Array.from(new Set((w.secondaryCauses || []).map(clean).filter(Boolean)));
      var causes = [];
      if (primary) causes.push(primary);
      secondary.forEach(function (s) { if (s !== primary && causes.indexOf(s) < 0) causes.push(s); });
      var eventKey = w.key;
      causes.forEach(function (cause) {
        var c = map.get(cause);
        if (!c) { c = { cause: cause, primary: 0, secondary: 0, events: 0, eventKeys: Object.create(null), dataInsufficient: true }; map.set(cause, c); }
        if (!c.eventKeys[eventKey]) { c.eventKeys[eventKey] = true; c.events++; }
        if (cause === primary) c.primary++;
        else c.secondary++;
      });
    });
    var causes = Array.from(map.values()).map(function (c) {
      delete c.eventKeys;
      c.dataInsufficient = c.events < CAUSE_MIN;
      return c;
    }).sort(function (a, b) { return b.events - a.events || b.primary - a.primary || a.cause.localeCompare(b.cause, 'zh'); });
    return {
      causes: causes,
      sample: {
        events: acc.wrongMap.size,
        recordedWrongs: acc.wrongMap.size,
        uncausedIncorrect: acc.uncausedIncorrect,
        dataInsufficient: acc.wrongMap.size < CAUSE_MIN
      }
    };
  }

  function resolveRetestInterval(task) {
    var n = Number(task && task.retestInterval);
    if ([1, 3, 7].indexOf(n) >= 0) return { interval: n, source: 'field' };
    var errorDate = dateKey(task && task.retestOrigin && task.retestOrigin.errorDate);
    var dueDate = dateKey(task && (task.dueDate || task.date));
    var a = dayNumber(errorDate), b = dayNumber(dueDate);
    if (a != null && b != null) {
      var diff = b - a;
      if ([1, 3, 7].indexOf(diff) >= 0) return { interval: diff, source: 'derived' };
    }
    return { interval: 0, source: 'unclassified' };
  }
  function resultSample(row) {
    if (row.questionCount == null || row.correctCount == null) return { questions: row.questionCount, correct: null, unknown: row.questionCount == null ? 0 : row.questionCount };
    if (row.correctCount > row.questionCount) return { questions: row.questionCount, correct: null, unknown: row.questionCount };
    return { questions: row.questionCount, correct: row.correctCount, unknown: 0 };
  }
  function blankInterval(interval, key) {
    var b = blankBucket(key, interval ? 'D+' + interval : '复测间隔未标注');
    b.interval = interval;
    b.planned = 0;
    b.completed = 0;
    b.results = [];
    return b;
  }
  function normalizeRetest(tasks, logs, range, acc) {
    var intervals = {
      d1: blankInterval(1, 'd1'),
      d3: blankInterval(3, 'd3'),
      d7: blankInterval(7, 'd7'),
      unclassified: blankInterval(0, 'unclassified')
    };
    var byMode = {
      original: blankBucket('original', '原题复测'),
      similar: blankBucket('similar', '同类新题'),
      unclassified: blankBucket('unclassified', '复测模式未标注')
    };
    var completedTasks = Object.create(null);
    var linkedActivities = 0;
    var remindersIgnored = 0;
    var taskRows = [];
    (tasks || []).forEach(function (task) {
      if (!task || (!(task.type === 'retest' || task.taskType === 'retest' || task.retestOrigin || Array.isArray(task.retestResults)))) return;
      var iv = resolveRetestInterval(task);
      var bucket = intervals[iv.interval === 1 ? 'd1' : iv.interval === 3 ? 'd3' : iv.interval === 7 ? 'd7' : 'unclassified'];
      var due = dateKey(task.dueDate || task.date);
      if (due && inWindow(due, range)) bucket.planned++;
      if (task.reminderStatus === 'skipped' || task.reminderStatus === 'closed') remindersIgnored++;
      var linked = null;
      (logs || []).forEach(function (l) {
        if (l && l.taskId === task.id) {
          linkedActivities++;
          if (!linked || (dateKey(l.date) && dateKey(task.dueDate || task.date) && l.date === (task.dueDate || task.date))) linked = l;
        }
      });
      var results = Array.isArray(task.retestResults) ? task.retestResults : [];
      results.forEach(function (r) {
        if (!r) return;
        var date = dateKey(r.date);
        if (!date) { acc.sources.retestTasks.missingResultDates++; return; }
        if (!inWindow(date, range)) return;
        var mode = r.mode === 'similar' || r.mode === 'original' ? r.mode : (task.retestMode === 'similar' || task.retestMode === 'original' ? task.retestMode : 'unclassified');
        var correctCount = intOrNull(r.correctCount, 0);
        var questionCount = intOrNull(r.questionCount, 0);
        if (correctCount != null && questionCount != null && correctCount > questionCount) { correctCount = null; questionCount = null; }
        var score = nullableNumber(r.score);
        var maxScore = nullableNumber(r.maxScore);
        if (score != null && score < 0) score = null;
        if (maxScore != null && maxScore <= 0) { maxScore = null; if (score === 0) score = null; }
        if (score != null && maxScore != null && score > maxScore) { score = null; maxScore = null; }
        var row = {
          taskId: task.id || null, interval: iv.interval, intervalSource: iv.source,
          date: date, at: timestampOf(r.at), dueDate: dateKey(r.dueDate) || due || null,
          errorDate: dateKey(r.errorDate) || dateKey(task.retestOrigin && task.retestOrigin.errorDate) || null,
          mode: mode, correctCount: correctCount, questionCount: questionCount,
          score: score,
          maxScore: maxScore,
          note: clean(r.note), linkedLogId: linked ? linked.id : null,
          mastery: task.mastery || 'unverified'
        };
        bucket.results.push(row);
        ensureDaily(acc, date).retestResults++;
        var s = resultSample(row);
        addSample(bucket, s.questions, s.correct, s.unknown, false);
        addSample(byMode[mode === 'original' || mode === 'similar' ? mode : 'unclassified'], s.questions, s.correct, s.unknown, true);
        if (!completedTasks[task.id || date + '|' + mode]) completedTasks[task.id || date + '|' + mode] = true;
        taskRows.push(row);
      });
    });
    ['d1', 'd3', 'd7', 'unclassified'].forEach(function (k) {
      var b = intervals[k];
      b.completed = Array.from(new Set(b.results.map(function (r) { return r.taskId || (r.date + '|' + r.mode); }))).length;
      finishBucket(b, 1);
      b.resultCount = b.results.length;
      b.results.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)) || String(a.taskId || '').localeCompare(String(b.taskId || '')); });
    });
    Object.keys(byMode).forEach(function (k) {
      finishBucket(byMode[k], 1);
      byMode[k].results = byMode[k].activities;
    });
    taskRows.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)) || String(a.taskId || '').localeCompare(String(b.taskId || '')); });
    acc.sources.retestTasks.tasks = (tasks || []).filter(function (t) { return t && (t.type === 'retest' || t.taskType === 'retest' || t.retestOrigin || Array.isArray(t.retestResults)); }).length;
    acc.sources.retestTasks.results = taskRows.length;
    acc.sources.retestTasks.linkedActivities = linkedActivities;
    acc.sources.retestTasks.remindersIgnored = remindersIgnored;
    return {
      byMode: byMode,
      intervals: intervals,
      results: taskRows,
      planned: intervals.d1.planned + intervals.d3.planned + intervals.d7.planned + intervals.unclassified.planned,
      completed: Object.keys(completedTasks).length,
      linkedActivities: linkedActivities,
      remindersIgnored: remindersIgnored,
      mastery: 'unverified',
      dataInsufficient: taskRows.length === 0
    };
  }

  function essayRoundFor(raw, index, orderSource) {
    var explicit = raw && (raw.round === 'first' || raw.round === 'reevaluation' || raw.round === 'additional') ? raw.round : null;
    if (explicit) return { round: explicit, roundSource: 'explicit' };
    if (orderSource === 'import-order' || orderSource === 'array-order') {
      return { round: index === 0 ? 'first' : index === 1 ? 'reevaluation' : 'additional', roundSource: orderSource };
    }
    return { round: 'unclassified', roundSource: 'unverified-order' };
  }
  function makeEssayEvent(base, raw, index, orderCount, orderSource) {
    var score = nullableNumber(raw && raw.score);
    var max = nullableNumber(raw && raw.maxScore);
    // P0's essay model requires a positive maximum. 0/10 is valid; 0/0 is not.
    var valid = score != null && max != null && max > 0 && score >= 0 && score <= max;
    var importedAt = timestampOf(raw && raw.importedAt) || timestampOf(raw && raw.reviewedAt) || base.at;
    var date = raw && dateKey(raw.date);
    if (!date) {
      // External/manual scores belong to the studyLog's explicit activity date;
      // internal review scores belong to their own importedAt date.
      if (base.dateMode === 'activity') date = base.date;
      else date = shanghaiDateOf(importedAt) || base.date;
    }
    if (!date) return null;
    var round = essayRoundFor(raw, index, orderSource);
    return {
      source: base.source, activityId: base.activityId,
      logId: base.logId || null, reviewId: base.reviewId || null, scoreId: raw && (raw.scoreId || raw.externalScoreId || raw.reviewId || null) || null,
      sessionId: base.sessionId || null,
      date: date, at: importedAt, importedAt: importedAt,
      content: base.content, module: base.module, topic: base.topic,
      score: valid ? score : null,
      maxScore: valid ? max : null,
      rawScore: raw && raw.score !== undefined ? raw.score : null,
      rawMaxScore: raw && raw.maxScore !== undefined ? raw.maxScore : null,
      round: round.round, roundSource: round.roundSource,
      order: index, orderCount: orderCount,
      reviewer: clean(raw && raw.reviewer && typeof raw.reviewer === 'object' ? (raw.reviewer.name || raw.reviewer.model || '') : (raw && raw.reviewer)),
      note: clean(raw && raw.note),
      dataInsufficient: !valid,
      crossSourceUncertain: false
    };
  }
  function normalizeEssays(externalEssays, reviews, sessions, exams, allStudyLogs, range, acc) {
    var events = [];
    var externalLogIds = Object.create(null);
    var externalScoreKeys = Object.create(null);
    var externalCount = 0, manualCount = 0;
    // Explicit stable activity links are checked against all active essay logs,
    // not only the in-window subset. An activity link identifies the activity,
    // not an individual score event.
    (allStudyLogs || []).forEach(function (l) {
      if (l && l.assessment === 'essay' && l.status !== 'deleted' && l.deletedAt == null && l.id) externalLogIds[String(l.id)] = true;
    });

    // External/manual studyLogs essay scores: explicit round wins; if a legacy
    // row lacks round, array order is labeled as such, never inferred by score.
    (externalEssays || []).forEach(function (e) {
      if (!e) return;
      if (e.logId) externalLogIds[String(e.logId)] = true;
      var scores = Array.isArray(e.scores) ? e.scores : [];
      var hasExplicit = scores.length > 0 && scores.every(function (s) { return s && (s.round === 'first' || s.round === 'reevaluation'); });
      var orderSource = hasExplicit ? 'explicit' : 'array-order';
      scores.forEach(function (s, i) {
        var event = makeEssayEvent({
          source: e.source, activityId: e.activityId, logId: e.logId,
          content: e.content, module: e.module, topic: e.topic,
          date: e.date, at: e.at, dateMode: 'activity'
        }, s, i, scores.length, orderSource);
        if (!event) return;
        var scoreKey = s && (s.scoreId || s.externalScoreId || s.reviewId || s.id);
        if (e.logId && scoreKey != null && String(scoreKey).trim()) externalScoreKeys[String(e.logId) + '\u0000' + String(scoreKey).trim()] = true;
        if (!inWindow(event.date, range)) return;
        if (e.source === 'manual') manualCount++; else externalCount++;
        events.push(event);
      });
    });

    var sessionMap = Object.create(null), examMap = Object.create(null);
    (sessions || []).forEach(function (s) { if (s && s.id) sessionMap[s.id] = s; });
    (exams || []).forEach(function (x) { if (x && x.id) examMap[x.id] = x; });

    // Internal EssayStore reviews: preserve every distinct review ID and every
    // score. Reviews are grouped only by the explicit sessionId reference.
    var reviewById = new Map();
    (reviews || []).forEach(function (r) {
      if (!r) return;
      var key = r.id ? String(r.id) : '';
      if (key && reviewById.has(key)) {
        var old = reviewById.get(key);
        if ((timestampOf(r.importedAt) || 0) > (timestampOf(old.importedAt) || 0)) reviewById.set(key, r);
        acc.sources.essays.duplicateReviews++;
        return;
      }
      if (key) reviewById.set(key, r); else reviewById.set('anon:' + reviewById.size, r);
    });
    var grouped = new Map();
    reviewById.forEach(function (r) {
      var sid = clean(r.sessionId) || ('review:' + String(r.id || reviewById.size));
      if (!grouped.has(sid)) grouped.set(sid, []);
      grouped.get(sid).push(r);
    });
    var internalCount = 0;
    grouped.forEach(function (list, sid) {
      var reliableOrder = list.every(function (r) { return timestampOf(r.importedAt) != null; });
      list.sort(function (a, b) {
        return (timestampOf(a.importedAt) || 0) - (timestampOf(b.importedAt) || 0) || String(a.id || '').localeCompare(String(b.id || ''));
      });
      list.forEach(function (r, index) {
        var linked = clean(r.logId || r.studyLogId || r.externalLogId);
        var activityLinked = !!(linked && externalLogIds[linked]);
        var exactRefs = [r.externalScoreId, r.sourceScoreId, r.externalReviewId, r.scoreRef, r.id]
          .map(clean).filter(Boolean);
        var exactDedup = activityLinked && exactRefs.some(function (ref) {
          return !!externalScoreKeys[linked + '\u0000' + ref];
        });
        if (exactDedup) {
          acc.sources.essays.linkedExternal++;
          acc.sources.essays.exactScoreDeduped++;
          return;
        }
        if (activityLinked) {
          acc.sources.essays.linkedActivityReviews++;
        }
        var session = sessionMap[r.sessionId] || {};
        var exam = examMap[r.examId] || {};
        var overall = r.overall && typeof r.overall === 'object' ? r.overall : {};
        var base = {
          source: 'internal',
          activityId: 'internal:' + sid,
          reviewId: r.id || null,
          sessionId: r.sessionId || null,
          content: clean(exam.title || exam.name || session.title || '申论评分'),
          module: '申论',
          topic: clean(exam.title || exam.name || ''),
          dateMode: 'imported',
          at: timestampOf(session.submittedAt) || timestampOf(session.updatedAt) || timestampOf(exam.createdAt)
        };
        var event = makeEssayEvent(base, {
          score: overall.totalScore, maxScore: overall.maxScore,
          round: r.round, importedAt: r.importedAt, reviewedAt: r.importedAt,
          reviewer: r.reviewer && (r.reviewer.name || r.reviewer.model) || r.reviewer,
          note: overall.summary
        }, index, list.length, reliableOrder ? 'import-order' : 'unverified-order');
        if (!event) return;
        if (!inWindow(event.date, range)) return;
        if (activityLinked) {
          event.linkedActivityId = linked;
          event.identityNote = 'activity-link-only-not-score-identity';
        }
        internalCount++;
        events.push(event);
      });
    });

    // Only an explicit stable link was removed above. Without one, internal and
    // external essay sources remain separate and are marked uncertain rather
    // than semantically merged into one activity.
    var crossSource = (internalCount > 0 && (externalCount + manualCount) > 0) || (internalCount > 0 && acc.sources.essays.linkedActivityReviews > 0);
    events.forEach(function (e) { e.crossSourceUncertain = crossSource; });
    events.sort(function (a, b) {
      return String(a.date).localeCompare(String(b.date)) || (a.at == null ? 0 : a.at) - (b.at == null ? 0 : b.at)
        || String(a.activityId).localeCompare(String(b.activityId)) || a.order - b.order;
    });
    events.forEach(function (e) { ensureDaily(acc, e.date).essayScores++; });
    acc.sources.essays.internalReviews = internalCount;
    acc.sources.essays.externalScores = externalCount;
    acc.sources.essays.manualScores = manualCount;
    acc.sources.essays.activities = new Set(events.map(function (e) { return e.activityId; })).size;
    acc.sources.essays.crossSourceUncertain = crossSource;
    return events;
  }

  function compute(input) {
    input = input || {};
    var now = timestampOf(input.now == null ? Date.now() : input.now);
    if (now == null) throw new Error('趋势窗口 now 必须为有效时间戳');
    var days = intOrNull(input.days == null ? 30 : input.days, 1);
    if (days == null || days > 365) throw new Error('趋势窗口 days 必须为 1–365 的整数');
    var range = rangeFor(now, days);

    var acc = {
      total: blankBucket('total', '客观题合计'),
      modules: new Map(), knowledge: new Map(),
      questionHistory: {
        first: blankBucket('first', '首次作答'),
        repeat: blankBucket('repeat', '重复作答'),
        unknown: blankBucket('unknown', '历史未知')
      },
      daily: new Map(),
      practice: Object.create(null),
      perQuestion: { exact: [], estimated: [], exactSeconds: 0, estimatedQuestions: 0, noPerQuestionCount: 0, unknownCount: 0 },
      totalDuration: {
        exactSeconds: 0, estimatedSeconds: 0, unknownActivities: 0, exactActivities: 0,
        estimatedActivities: 0, partialExactActivities: 0, activities: 0,
        bySource: {
          software: { exactSeconds: 0, estimatedSeconds: 0, exactActivities: 0, estimatedActivities: 0, partialExactActivities: 0, unknownActivities: 0, activities: 0 },
          external: { exactSeconds: 0, estimatedSeconds: 0, exactActivities: 0, estimatedActivities: 0, partialExactActivities: 0, unknownActivities: 0, activities: 0 },
          manual: { exactSeconds: 0, estimatedSeconds: 0, exactActivities: 0, estimatedActivities: 0, partialExactActivities: 0, unknownActivities: 0, activities: 0 },
          bank: { exactSeconds: 0, estimatedSeconds: 0, exactActivities: 0, estimatedActivities: 0, partialExactActivities: 0, unknownActivities: 0, activities: 0 }
        },
        dataInsufficient: true
      },
      wrongMap: new Map(), uncausedIncorrect: 0,
      sources: {
        software: { available: true, snapshots: 0, activities: 0, suppressedSnapshots: 0, invalidActivities: 0, invalidEvents: 0, duplicateEvents: 0 },
        external: { available: true, activities: 0, manualActivities: 0, duplicatesSuppressed: 0, deletedSuppressed: 0, invalidActivities: 0 },
        bank: { available: true, reason: null, attempts: 0, activities: 0, suppressedAttempts: 0, missingSets: 0, invalidActivities: 0, invalidEvents: 0, duplicateEvents: 0, modes: Object.create(null) },
        retestTasks: { available: true, tasks: 0, results: 0, planned: 0, linkedActivities: 0, remindersIgnored: 0, missingResultDates: 0 },
        essays: { activities: 0, internalReviews: 0, externalScores: 0, manualScores: 0, duplicateReviews: 0, linkedExternal: 0, linkedActivityReviews: 0, exactScoreDeduped: 0, crossSourceUncertain: false }
      },
      planLinkedActivities: 0
    };
    PRACTICE_TYPES.forEach(function (k) { acc.practice[k] = blankBucket(k, PRACTICE_LABEL[k]); });

    var software = normalizeGrading(input.gradingRecords, input.exams, input.knowledgeTags, input.questionTags, input.sessions, range, acc);
    var study = normalizeStudyLogs(input.studyLogs, range, acc);
    var bank = normalizeBank(input, range, acc);
    var activities = software.concat(study.activities, bank);
    activities.forEach(function (a) { addActivity(a, range, acc); });

    var causes = finalizeCauses(acc);
    acc.sources.external.planLinkedActivities = acc.planLinkedActivities;
    var retest = normalizeRetest(input.learningTasks, (input.studyLogs || []).filter(function (l) { return l && l.status !== 'deleted' && l.deletedAt == null; }), range, acc);
    var essays = normalizeEssays(study.essays, input.essayReviews, input.essaySessions, input.essayExams, input.studyLogs, range, acc);

    finishBucket(acc.total, 1);
    Array.from(acc.modules.values()).forEach(function (b) { finishBucket(b, MODULE_MIN); });
    Array.from(acc.knowledge.values()).forEach(function (b) { finishBucket(b, MODULE_MIN); });
    PRACTICE_TYPES.forEach(function (k) { finishBucket(acc.practice[k], 1); });
    acc.practice.total = acc.total;
    acc.practice.subtotal = composeSubtotal(acc.practice);
    ['first', 'repeat', 'unknown'].forEach(function (k) { finishBucket(acc.questionHistory[k], 1); });
    acc.questionHistory.total = acc.total;

    acc.perQuestion.exact.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)) || String(a.source).localeCompare(String(b.source)) || String(a.activityId).localeCompare(String(b.activityId)); });
    acc.perQuestion.estimated.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)) || String(a.source).localeCompare(String(b.source)) || String(a.activityId).localeCompare(String(b.activityId)); });
    acc.totalDuration.exactSeconds = round3(acc.totalDuration.exactSeconds);
    acc.totalDuration.estimatedSeconds = round3(acc.totalDuration.estimatedSeconds);
    Object.keys(acc.totalDuration.bySource).forEach(function (k) {
      var s = acc.totalDuration.bySource[k];
      s.exactSeconds = round3(s.exactSeconds);
      s.estimatedSeconds = round3(s.estimatedSeconds);
    });
    acc.totalDuration.dataInsufficient = acc.totalDuration.activities === 0;
    acc.sources.retestTasks.planned = retest.planned;

    var perQuestion = {
      exact: acc.perQuestion.exact,
      exactSummary: summarySeconds(acc.perQuestion.exact.map(function (x) { return x.elapsedSeconds; })),
      estimated: acc.perQuestion.estimated,
      estimatedQuestions: acc.perQuestion.estimatedQuestions,
      unknownCount: acc.perQuestion.unknownCount,
      noPerQuestionCount: acc.perQuestion.noPerQuestionCount,
      dataInsufficient: acc.perQuestion.exact.length < TIME_MIN,
      timezone: TIMEZONE
    };

    var modules = Array.from(acc.modules.values()).sort(function (a, b) { return b.questions - a.questions || a.name.localeCompare(b.name, 'zh'); });
    var knowledge = Array.from(acc.knowledge.values()).sort(function (a, b) { return b.questions - a.questions || a.name.localeCompare(b.name, 'zh'); });

    // Full-source daily series derived once from the normalized activities.
    // Every calendar day in the window is present; an empty day has null accuracy.
    var daily = [];
    var cursor = range.from;
    while (cursor && cursor <= range.to) {
      var day = ensureDaily(acc, cursor);
      day.accuracy = day.known > 0 ? round1(day.correct * 100 / day.known) : null;
      day.dataInsufficient = day.known === 0;
      Object.keys(day.duration).forEach(function (k) { if (typeof day.duration[k] === 'number') day.duration[k] = round3(day.duration[k]); });
      daily.push(day);
      cursor = addDays(cursor, 1);
    }
    var essayActivities = new Set(essays.map(function (e) { return e.activityId; })).size;

    var report = {
      schema: SCHEMA, version: VERSION, timezone: TIMEZONE,
      generatedAt: new Date(now).toISOString(),
      window: range,
      sample: {
        objectiveActivities: acc.total.activities,
        objectiveEvents: acc.total.questions,
        knownObjectiveEvents: acc.total.known,
        unknownObjectiveQuestions: acc.total.unknownQuestions,
        unknownQuestionActivities: acc.total.unknownActivities,
        perQuestionTimeExact: acc.perQuestion.exact.length,
        perQuestionTimeEstimatedActivities: acc.perQuestion.estimated.length,
        noPerQuestionQuestions: acc.perQuestion.noPerQuestionCount,
        totalDurationActivities: acc.totalDuration.activities,
        retestResults: retest.results.length,
        essays: essays.length,
        essayScores: essays.length,
        essayActivities: essayActivities,
        dailyDays: daily.length,
        firstQuestions: acc.questionHistory.first.questions,
        repeatQuestions: acc.questionHistory.repeat.questions,
        unknownHistoryQuestions: acc.questionHistory.unknown.questions,
        objectiveSubtotalQuestions: acc.practice.subtotal.questions,
        objectiveSubtotalCorrect: acc.practice.subtotal.correct,
        objectiveSubtotalKnown: acc.practice.subtotal.known,
        objectiveSubtotalAccuracy: acc.practice.subtotal.accuracy,
        objectiveSubtotalUnclassifiedQuestions: acc.practice.subtotal.unclassifiedQuestions
      },
      overall: acc.total,
      questionHistory: acc.questionHistory,
      daily: daily,
      modules: modules,
      knowledge: knowledge,
      perQuestionTime: perQuestion,
      totalDuration: acc.totalDuration,
      causes: causes.causes,
      causeSample: causes.sample,
      practiceTypes: acc.practice,
      retest: retest,
      essays: essays,
      sources: acc.sources,
      dataNotes: []
    };
    report.dataNotes = buildNotes(report, acc, activities, study, bank, retest, causes);
    return report;
  }

  function buildNotes(report, acc, activities, study, bank, retest, causes) {
    var notes = new Set();
    function add(s) { if (s) notes.add(String(s)); }
    add('时区：Asia/Shanghai（固定 +08:00）；窗口 ' + report.window.from + '..' + report.window.to + '；原始时间戳保留，派生日期只用于窗口。');
    add('来源：EC 内部快照 ' + acc.sources.software.activities + ' 个会话，外部活动 ' + acc.sources.external.activities + ' 条，手动记录 ' + acc.sources.external.manualActivities + ' 条，独立题库 ' + acc.sources.bank.activities + ' 次；同一活动只计一次。');
    if (acc.sources.software.suppressedSnapshots) add('同一会话的多份批改快照仅取最新 graded 一份；已忽略 ' + acc.sources.software.suppressedSnapshots + ' 份旧快照，绝不把各次用时相加。');
    if (acc.sources.external.duplicatesSuppressed) add('外部 source+externalId 同键仅取 updatedAt 最新一条；已忽略 ' + acc.sources.external.duplicatesSuppressed + ' 条重复记录。');
    if (acc.sources.external.deletedSuppressed) add('已排除 ' + acc.sources.external.deletedSuppressed + ' 条软删除学习记录；其 revisions 审计仍保留，不进入统计。');
    if (acc.sources.software.invalidActivities || acc.sources.external.invalidActivities || acc.sources.bank.invalidActivities) add('有 ' + (acc.sources.software.invalidActivities + acc.sources.external.invalidActivities + acc.sources.bank.invalidActivities) + ' 个活动因日期/身份缺失被跳过，未伪造当天数据。');
    if (!acc.sources.bank.available) add('独立题库不可用：' + acc.sources.bank.reason + '。趋势未升级数据库、未写入旧 22 表，只显示其他来源与不足说明。');
    else add('独立题库来源可用：bankQuestionId 原样保留，与旧 PDF question_id 分开；未映射成 PDF 题目。');
    if (acc.sources.bank.missingSets) add('有 ' + acc.sources.bank.missingSets + ' 次题库练习缺少 practiceSets 快照，模块/标签退回未分类/未标注。');
    add('题库 random/unseen/weak 只是组卷/排序模式，不再等同于新题；首次/重复/未知按全部历史 bankQuestionId 分类，窗口外先前历史也参与，缺失身份或时间戳则标未知。');
    add('客观练习小计（不含综合/模考）= new + retest + unclassified：' + report.practiceTypes.subtotal.questions + ' 题 / 正确 ' + report.practiceTypes.subtotal.correct + '；其中未分类 ' + report.practiceTypes.subtotal.unclassifiedQuestions + ' 题（分类未确认，不猜新题/复测）。综合 ' + report.practiceTypes.comprehensive.questions + ' 题、模考 ' + report.practiceTypes.mock.questions + ' 题不计入该小计。');
    add('练习类型与逐题新旧是两个维度：wrong 组卷中的共享材料也可能带首次题，不按组卷模式推断每题新旧。');
    add('首次 ' + report.questionHistory.first.questions + ' 题、重复 ' + report.questionHistory.repeat.questions + ' 题、历史未知 ' + report.questionHistory.unknown.questions + ' 题；外部/手动活动缺少逐题稳定身份时归未知，不语义猜测。');
    add('未知正确数 ' + report.overall.unknownQuestions + ' 题未按 0、未按错误、未进入正确率分母；已知样本正确率 = correct / known。');
    add('null/空字符串/布尔数值保持未知，不转成 0；真实数字 0 保留（包括题库耗时 0、复测/申论 0 分）。');
    add('无真实逐题样本 ' + report.perQuestionTime.noPerQuestionCount + ' 题；真实逐题样本 ' + report.perQuestionTime.exact.length + ' 条。活动总时长与逐题分布分开' + (report.totalDuration.exactSeconds ? '（本次精确合计 ' + report.totalDuration.exactSeconds + ' 秒）' : '') + '：总时长不拆成逐题样本。');
    add('未作答/未访问的 0 秒记录按未知用时处理，不生成 0 秒逐题样本。');
    add('逐日趋势 ' + report.daily.length + ' 天由同一批规范化活动一次派生，覆盖内部/外部/手动/题库；空日正确率为 null，申论评分与复测实际结果单列，不把提醒日当作答日。');
    if (report.perQuestionTime.estimated.length) add('估算活动 ' + report.perQuestionTime.estimated.length + ' 项，仅以活动级平均每题秒数标注，不与 exact 逐题样本混合。');
    if (report.perQuestionTime.dataInsufficient) add('真实逐题样本少于 ' + TIME_MIN + ' 条，逐题分布标记数据不足，不输出伪精确 p50/p90。');
    if (causes.sample.events) add('错因来自外部/手动 wrongQuestions：' + causes.sample.events + ' 条去重错题；primary/secondary 分开计数，同一题同一原因只计一次。');
    if (causes.sample.uncausedIncorrect) add('另有 ' + causes.sample.uncausedIncorrect + ' 个错误题次未录入结构化错因，未自动归类。');
    if (retest.results.length) add('复测实际结果 ' + retest.results.length + ' 条，仅按 retestResults[].date 落窗；计划/提醒日期不生成成绩，一次正确不自动改写 mastery。');
    else add('窗口内没有可用的复测实际结果；计划/提醒不补造成绩。');
    if (report.essays.length) add('申论评分 ' + report.essays.length + ' 条（活动 ' + acc.sources.essays.activities + ' 个）：内部 essayReviews ' + acc.sources.essays.internalReviews + ' 条、外部 ' + acc.sources.essays.externalScores + ' 条、手动 ' + acc.sources.essays.manualScores + ' 条；保留每条评分与原导入时间，不转换为客观题正确数、不进入客观题分母。');
    if (acc.sources.essays.internalReviews) add('内部 essayReviews 原始 schema 无 round 时按同一 sessionId 的 importedAt 顺序标注首次/复评/后续，roundSource=import-order；缺少 importedAt 时标 unverified-order，不按分数高低猜。');
    if (acc.sources.essays.crossSourceUncertain) add('内部与外部申论同时存在但没有逐评分精确引用：来源分列展示，标记 crossSourceUncertain，不按分数/标题/日期语义猜成同一评分事件。');
    if (acc.sources.essays.linkedActivityReviews) add('有 ' + acc.sources.essays.linkedActivityReviews + ' 条内部评分只有活动级 logId/studyLogId 关联；活动关联不等于逐评分同一，已保留每个 reviewId 与评分，仅标 linkedActivityId，不丢弃后续复评。');
    if (acc.sources.essays.exactScoreDeduped) add('有 ' + acc.sources.essays.exactScoreDeduped + ' 条内部评分带可验证的逐评分精确引用，已与外部评分去重。');
    add('知识点按人工标签/记录 knowledgePoint 统计；一题多标签会分别计入知识点，知识点合计可大于总题数，模块/总览仍按题去重。');
    return Array.from(notes);
  }

  async function readAll(db, names) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(names, 'readonly');
      var out = {}, remaining = names.length;
      names.forEach(function (name) {
        var req = tx.objectStore(name).getAll();
        req.onsuccess = function () { out[name] = req.result; if (--remaining === 0) resolve(out); };
        req.onerror = function () { reject(req.error || new Error('读取失败：' + name)); };
      });
      if (!names.length) resolve(out);
    });
  }

  async function load(options) {
    options = options || {};
    var now = options.now == null ? Date.now() : options.now;
    var days = options.days == null ? 30 : options.days;
    // rangeFor validates now/days before any DB read.
    rangeFor(now, days);
    if (!root.DiagnosisStore || !root.ExamStore) throw new Error('趋势数据层未加载');
    var base = await Promise.all([
      root.DiagnosisStore.getAllGradingRecords(),
      root.DiagnosisStore.getAllExams(),
      root.DiagnosisStore.listTags(),
      root.DiagnosisStore.getAllQuestionTags(),
      root.DiagnosisStore.getAllSessions(),
      root.DiagnosisStore.listStudyLogs(),
      root.LearningStore ? root.LearningStore.listTasks() : Promise.resolve([]),
      root.DiagnosisStore.getAllEssayReviews(),
      root.DiagnosisStore.getAllEssaySessions(),
      root.DiagnosisStore.getAllEssayExams()
    ]);
    var bank = { available: false, reason: DEFAULT_BANK_REASON, attempts: [], sets: [], questions: [] };
    try {
      var db = await root.ExamStore.open();
      var hasBank = db.version === 6 && ['bankAttempts', 'practiceSets'].every(function (n) { return db.objectStoreNames.contains(n); });
      if (hasBank) {
        var names = ['bankAttempts', 'practiceSets'];
        if (db.objectStoreNames.contains('bankQuestions')) names.push('bankQuestions');
        var data = await readAll(db, names);
        bank = {
          available: true, reason: null,
          attempts: data.bankAttempts || [], sets: data.practiceSets || [],
          questions: data.bankQuestions || []
        };
      } else {
        bank.reason = db.version === 6
          ? '当前数据库为 v6 但缺少独立题库 store；趋势不写入、不升级'
          : '独立题库尚未升级到 v6/28（当前 v' + db.version + '/22）；趋势不读取题库且不会触发升级';
      }
    } catch (e) {
      bank = { available: false, reason: '独立题库读取失败，已跳过该来源：' + (e && e.message || e), attempts: [], sets: [], questions: [] };
    }
    return compute({
      now: now, days: days,
      gradingRecords: base[0], exams: base[1], knowledgeTags: base[2], questionTags: base[3],
      sessions: base[4], studyLogs: base[5], learningTasks: base[6],
      essayReviews: base[7], essaySessions: base[8], essayExams: base[9],
      bank: bank
    });
  }

  return {
    SCHEMA: SCHEMA, VERSION: VERSION, TIMEZONE: TIMEZONE,
    PRACTICE_TYPES: PRACTICE_TYPES, PRACTICE_LABEL: PRACTICE_LABEL,
    MODULE_MIN: MODULE_MIN, CAUSE_MIN: CAUSE_MIN, TIME_MIN: TIME_MIN,
    shanghaiDateOf: shanghaiDateOf, rangeFor: rangeFor, externalKeyFor: externalKeyFor,
    wrongKeyFor: wrongKeyFor, compute: compute, load: load
  };
});
