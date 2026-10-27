/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright 2026 ExamCard contributors */
/* ExamCard V4.1 · 诊断计算：只读取不可变 snapshots，按会话取最新已批改版本 */
(function (root) {
  'use strict';
  var clone = function (v) { return v == null ? v : JSON.parse(JSON.stringify(v)); };
  function dateOf(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function acc(correct, incorrect) { return (correct + incorrect) ? Math.round(correct * 1000 / (correct + incorrect)) / 10 : null; }
  function qidOf(exam, n) {
    var q = (exam.questions || []).filter(function (x) { return Number(x.n) === Number(n); })[0];
    if (!q) return null;
    return q.questionId || q.id || ('q-' + exam.id + '-' + n);
  }
  function qOf(exam, n) { return (exam.questions || []).filter(function (x) { return Number(x.n) === Number(n); })[0] || null; }

  function loadData() {
    return Promise.all([
      root.DiagnosisStore.getAllGradingRecords(),
      root.DiagnosisStore.getAllExams(),
      root.DiagnosisStore.listTags(),
      root.DiagnosisStore.getAllQuestionTags(),
      root.DiagnosisStore.getAllAttemptsLegacy(),
      root.DiagnosisStore.getAllSessions(),
      root.DiagnosisStore.listStudyLogs()
    ]).then(function (arr) {
      return { records: arr[0], exams: arr[1], tags: arr[2], questionTags: arr[3], legacyAttempts: arr[4], sessions: arr[5], studyLogs: arr[6] };
    });
  }

  function compute(data) {
    var examMap = {};
    (data.exams || []).forEach(function (e) { examMap[e.id] = e; });
    var tagMap = {};
    (data.tags || []).forEach(function (t) { tagMap[t.id] = t; });
    var qTags = {};
    (data.questionTags || []).forEach(function (qt) {
      if (!qTags[qt.questionId]) qTags[qt.questionId] = [];
      if (tagMap[qt.tagId] && tagMap[qt.tagId].enabled !== false) qTags[qt.questionId].push(qt.tagId);
    });
    var sessionMap = {};
    (data.sessions || []).forEach(function (s) { sessionMap[s.id] = s; });

    // 同一会话按最新“已批改”快照取一次，r1/r2 不重复计入练习次数。
    var bySession = {};
    (data.records || []).forEach(function (r) {
      if (!r || r.gradingStatus !== 'graded' || !r.summary || !r.details) return;
      if (!bySession[r.sessionId] || (r.gradedAt || 0) > (bySession[r.sessionId].gradedAt || 0)) bySession[r.sessionId] = r;
    });
    var records = Object.keys(bySession).map(function (k) { return bySession[k]; }).sort(function (a, b) { return (a.gradedAt || 0) - (b.gradedAt || 0); });

    var attempts = records.map(function (r) {
      var exam = examMap[r.examId] || { id: r.examId, name: r.examName || '', questions: [] };
      var details = (r.details || []).map(function (d) {
        var q = qOf(exam, d.question_id);
        var qid = qidOf(exam, d.question_id) || ('missing:' + r.examId + ':' + d.question_id);
        var tags = qTags[qid] || [];
        return {
          n: d.question_id, qid: qid, subject: d.subject || (q && q.module) || '未分类',
          type: d.question_type || (q && q.type) || '', status: d.grading_status,
          isCorrect: d.is_correct, elapsed: Number(d.elapsed_seconds) || 0,
          overtime: !!d.overtime, uncertain: !!d.marked_uncertain,
          tags: tags.slice(), q: q, explanation: d.explanation || ''
        };
      });
      var cfg = r.config || (sessionMap[r.sessionId] && sessionMap[r.sessionId].config) || {};
      return {
        id: r.attemptId, record: r, exam: exam, date: dateOf(r.gradedAt), gradedAt: r.gradedAt,
        config: cfg, retest: !!(cfg.retest || cfg.sourceSessionId),
        details: details
      };
    });
    var legacySessions = {};
    (data.legacyAttempts || []).forEach(function (a) { if (!bySession[a.sessionId]) legacySessions[a.sessionId] = true; });
    var legacyCount = Object.keys(legacySessions).length;

    var allDetails = [];
    attempts.forEach(function (a) { a.details.forEach(function (d) { allDetails.push({ attempt: a, detail: d }); }); });
    var answered = allDetails.filter(function (x) { return x.detail.status !== 'unanswered'; }).length;
    var correct = allDetails.filter(function (x) { return x.detail.status === 'correct'; }).length;
    var incorrect = allDetails.filter(function (x) { return x.detail.status === 'incorrect'; }).length;
    var unverified = allDetails.filter(function (x) { return x.detail.status === 'unverified'; }).length;
    var unanswered = allDetails.filter(function (x) { return x.detail.status === 'unanswered'; }).length;
    var uncertain = allDetails.filter(function (x) { return x.detail.uncertain; }).length;
    var overtime = allDetails.filter(function (x) { return x.detail.overtime; }).length;
    var totalElapsed = allDetails.reduce(function (s, x) { return s + (x.detail.elapsed || 0); }, 0);
    var overview = {
      attemptCount: attempts.length,
      dateRange: attempts.length ? { from: attempts[0].date, to: attempts[attempts.length - 1].date } : null,
      questions: allDetails.length, answered: answered, correct: correct, incorrect: incorrect,
      unverified: unverified, unanswered: unanswered, uncertain: uncertain, overtime: overtime,
      accuracy: acc(correct, incorrect), avgSeconds: answered ? Math.round(totalElapsed / answered * 10) / 10 : null,
      legacyCount: legacyCount, legacyExcluded: true
    };

    function groupBy(keyFn) {
      var map = {};
      allDetails.forEach(function (x) {
        var keys = keyFn(x);
        keys.forEach(function (k) {
          if (!map[k]) map[k] = { key: k, total: 0, answered: 0, correct: 0, incorrect: 0, unverified: 0, unanswered: 0, seconds: 0, overtime: 0, uncertain: 0, sessions: {}, lastWrongAt: null };
          var g = map[k];
          g.total++; if (x.detail.status !== 'unanswered') g.answered++;
          if (x.detail.status === 'correct') g.correct++;
          else if (x.detail.status === 'incorrect') { g.incorrect++; g.lastWrongAt = Math.max(g.lastWrongAt || 0, x.attempt.gradedAt || 0); }
          else if (x.detail.status === 'unverified') g.unverified++;
          else if (x.detail.status === 'unanswered') g.unanswered++;
          if (x.detail.uncertain) g.uncertain++;
          if (x.detail.overtime) g.overtime++;
          g.seconds += x.detail.elapsed || 0;
          g.sessions[x.attempt.record.sessionId] = true;
        });
      });
      return Object.keys(map).map(function (k) {
        var g = map[k]; g.accuracy = acc(g.correct, g.incorrect);
        g.avgSeconds = g.answered ? Math.round(g.seconds / g.answered * 10) / 10 : null;
        g.sessionCount = Object.keys(g.sessions).length; delete g.sessions;
        return g;
      });
    }

    var modules = groupBy(function (x) { return [x.detail.subject || '未分类']; }).sort(function (a, b) { return b.incorrect - a.incorrect || b.total - a.total; });
    var knowledge = groupBy(function (x) { return x.detail.tags.length ? x.detail.tags : ['__untagged__']; }).map(function (g) {
      var tag = tagMap[g.key];
      return Object.assign(g, { tagId: g.key, name: tag ? tag.name : '未标注', moduleName: tag ? (tag.moduleName || '') : '', isUntagged: g.key === '__untagged__' });
    }).sort(function (a, b) { return b.incorrect - a.incorrect || (a.accuracy == null ? 101 : a.accuracy) - (b.accuracy == null ? 101 : b.accuracy); });

    var recent = attempts.slice(-5).map(function (a) { return { date: a.date, accuracy: a.record.summary.accuracy, attempts: 1, correct: a.record.summary.correct, incorrect: a.record.summary.incorrect }; });
    var recentFive = attempts.slice(-5);
    var prevFive = attempts.slice(-10, -5);
    function avgAcc(list) {
      var c = 0, i = 0; list.forEach(function (a) { c += a.record.summary.correct || 0; i += a.record.summary.incorrect || 0; });
      return acc(c, i);
    }
    var recentCompare = { current: avgAcc(recentFive), previous: avgAcc(prevFive), currentAttempts: recentFive.length, previousAttempts: prevFive.length, delta: null };
    if (recentCompare.current != null && recentCompare.previous != null) recentCompare.delta = Math.round((recentCompare.current - recentCompare.previous) * 10) / 10;

    var overallAvg = overview.avgSeconds;
    var weak = [];
    knowledge.forEach(function (k) {
      if (k.isUntagged || k.sessionCount < 2) return;
      if (k.correct + k.incorrect >= 3 && k.accuracy != null && k.accuracy < 60) weak.push({ type: 'accuracy', key: k.tagId, name: k.name, value: k.accuracy, sample: k.correct + k.incorrect, sessionCount: k.sessionCount });
      if (overallAvg && k.avgSeconds && k.answered >= 3 && k.avgSeconds > overallAvg * 1.5) weak.push({ type: 'time', key: k.tagId, name: k.name, value: k.avgSeconds, sample: k.answered, sessionCount: k.sessionCount });
      if (k.incorrect >= 2 && k.sessionCount >= 2) weak.push({ type: 'repeat', key: k.tagId, name: k.name, value: k.incorrect, sample: k.correct + k.incorrect, sessionCount: k.sessionCount });
    });
    modules.forEach(function (m) { if (m.incorrect >= 3) weak.push({ type: 'module-errors', key: m.key, name: m.key, value: m.incorrect, sample: m.correct + m.incorrect, sessionCount: m.sessionCount }); });

    // 错题本：按 questionId 聚合所有最新会话中的错误。
    var wrongMap = {};
    attempts.forEach(function (a) {
      a.details.forEach(function (d) {
        if (d.status !== 'incorrect') return;
        if (!wrongMap[d.qid]) wrongMap[d.qid] = { qid: d.qid, n: d.n, examId: a.exam.id, examName: a.exam.name, subject: d.subject, tags: d.tags.slice(), wrongCount: 0, attempts: [], lastWrongAt: 0, question: d.q };
        var w = wrongMap[d.qid];
        w.wrongCount++; w.lastWrongAt = Math.max(w.lastWrongAt, a.gradedAt || 0);
        w.attempts.push({ sessionId: a.record.sessionId, attemptId: a.id, date: a.date, gradedAt: a.gradedAt });
        w.tags = Array.from(new Set(w.tags.concat(d.tags)));
      });
    });
    var retestAttempts = attempts.filter(function (a) { return a.retest; });
    var wrongs = Object.keys(wrongMap).map(function (k) {
      var w = wrongMap[k]; w.lastWrongDate = dateOf(w.lastWrongAt);
      var recentRetest = null;
      w.retests = [];
      retestAttempts.forEach(function (a) {
        if ((a.config.sourceSessionId && !w.attempts.some(function (x) { return x.sessionId === a.config.sourceSessionId; }))) return;
        a.details.forEach(function (d) {
          if (d.qid !== w.qid) return;
          var item = { status: d.status, date: a.date, gradedAt: a.gradedAt, attemptId: a.id, sessionId: a.record.sessionId };
          w.retests.push(item);
          if (!recentRetest || (a.gradedAt || 0) > (recentRetest.gradedAt || 0)) recentRetest = item;
        });
      });
      w.retests.sort(function (a, b) { return (a.gradedAt || 0) - (b.gradedAt || 0); });
      w.retest = recentRetest;
      w.retestStatus = !recentRetest ? 'not_retested' : (recentRetest.status === 'correct' ? 'correct' : recentRetest.status === 'incorrect' ? 'incorrect' : recentRetest.status);
      w.repeated = w.wrongCount >= 2;
      return w;
    }).sort(function (a, b) { return b.lastWrongAt - a.lastWrongAt; });

    // 趋势按日期聚合；仅包含有快照的会话。
    var trendMap = {};
    attempts.forEach(function (a) {
      if (!trendMap[a.date]) trendMap[a.date] = { date: a.date, attempts: 0, correct: 0, incorrect: 0, answered: 0, seconds: 0 };
      var t = trendMap[a.date]; t.attempts++; t.correct += a.record.summary.correct || 0; t.incorrect += a.record.summary.incorrect || 0;
      a.details.forEach(function (d) { if (d.status !== 'unanswered') { t.answered++; t.seconds += d.elapsed || 0; } });
    });
    var trends = Object.keys(trendMap).sort().map(function (k) {
      var t = trendMap[k]; t.accuracy = acc(t.correct, t.incorrect); t.avgSeconds = t.answered ? Math.round(t.seconds / t.answered * 10) / 10 : null; return t;
    });

    var retestCompare = retestAttempts.map(function (a) {
      var source = attempts.filter(function (x) { return x.record.sessionId === a.config.sourceSessionId; })[0];
      var beforeWrong = source ? source.details.filter(function (d) { return d.status === 'incorrect'; }).length : null;
      var nowCorrect = a.details.filter(function (d) { return d.status === 'correct'; }).length;
      var nowWrong = a.details.filter(function (d) { return d.status === 'incorrect'; }).length;
      return { date: a.date, sourceSessionId: a.config.sourceSessionId || null, retestSessionId: a.record.sessionId, attemptId: a.id, beforeWrong: beforeWrong, retestCorrect: nowCorrect, retestWrong: nowWrong, total: a.details.length };
    });

    function attemptAccuracy(list) {
      var c = 0, w = 0;
      list.forEach(function (a) { (a.details || []).forEach(function (d) { if (d.status === 'correct') c++; else if (d.status === 'incorrect') w++; }); });
      return { correct: c, incorrect: w, accuracy: acc(c, w), attempts: list.length, sample: c + w };
    }
    var moduleTrends = modules.map(function (m) {
      var list = attempts.filter(function (a) { return a.details.some(function (d) { return d.subject === m.key; }); });
      var recent = attemptAccuracy(list.slice(-3));
      var previous = attemptAccuracy(list.slice(-6, -3));
      var delta = (recent.accuracy != null && previous.accuracy != null) ? Math.round((recent.accuracy - previous.accuracy) * 10) / 10 : null;
      return { module: m.key, recent: recent, previous: previous, delta: delta };
    });
    var knowledgeTrends = (data.tags || []).filter(function (tag) { return tag.enabled !== false; }).map(function (tag) {
      var list = attempts.filter(function (a) { return a.details.some(function (d) { return d.tags.indexOf(tag.id) >= 0; }); });
      var recent = attemptAccuracy(list.slice(-3));
      var previous = attemptAccuracy(list.slice(-6, -3));
      var delta = (recent.accuracy != null && previous.accuracy != null) ? Math.round((recent.accuracy - previous.accuracy) * 10) / 10 : null;
      return { tagId: tag.id, name: tag.name, recent: recent, previous: previous, delta: delta };
    }).filter(function (x) { return x.recent.sample > 0 || x.previous.sample > 0; });

    return {
      computedAt: Date.now(),
      overview: overview, attempts: attempts, modules: modules, knowledge: knowledge,
      weak: weak, recentCompare: recentCompare, trends: trends, moduleTrends: moduleTrends,
      knowledgeTrends: knowledgeTrends, wrongs: wrongs,
      retestCompare: retestCompare, tags: data.tags, tagMap: tagMap,
      studyLogs: data.studyLogs || [], qTags: qTags,
      dataNotes: [
        attempts.length < 3 ? '练习次数少于 3 次，诊断仅供参考。' : null,
        knowledge.some(function (k) { return !k.isUntagged && k.correct + k.incorrect < 3; }) ? '部分知识点样本不足 3 题，未列为弱项结论。' : null,
        legacyCount ? '旧版仅有汇总的 ' + legacyCount + ' 条记录未纳入逐题/知识点统计。' : null
      ].filter(Boolean)
    };
  }

  async function load() {
    var data = await loadData();
    return compute(data);
  }

  function report(engine, logs) {
    var o = engine.overview;
    return {
      schema: 'examcard.diagnosis/v1',
      schemaVersion: 'v4.1',
      generatedAt: new Date().toISOString(),
      dataRange: o.dateRange,
      methodology: {
        source: 'V3.1 immutable gradingRecords snapshots',
        dedupe: '同一会话仅取最新已批改快照，r1/r2 不重复计为两次练习',
        accuracy: 'correct / (correct + incorrect)；unanswered/unverified 不计入分母',
        legacy: '旧版仅有 summary 的记录不参与逐题/知识点统计',
        knowledgeTags: '仅使用用户手动关联标签；未标注题目归入“未标注”',
        sampleWarning: '知识点样本不足 3 题不判定为掌握/薄弱结论'
      },
      overview: o,
      practiceSummary: engine.attempts.map(function (a) {
        return { date: a.date, sessionId: a.record.sessionId, examId: a.exam.id, examName: a.exam.name, total: a.record.summary.total, correct: a.record.summary.correct, incorrect: a.record.summary.incorrect, accuracy: a.record.summary.accuracy, retest: a.retest, config: a.config };
      }),
      modules: engine.modules,
      moduleTrends: engine.moduleTrends,
      knowledge: engine.knowledge,
      knowledgeTrends: engine.knowledgeTrends,
      weak: engine.weak,
      frequentWrongs: engine.wrongs.slice(0, 30).map(function (w) { return { qid: w.qid, n: w.n, examId: w.examId, subject: w.subject, wrongCount: w.wrongCount, lastWrongAt: w.lastWrongAt, retestStatus: w.retestStatus, tags: w.tags }; }),
      retest: engine.retestCompare,
      studyLogs: logs || engine.studyLogs,
      limitations: engine.dataNotes,
      disclaimer: '本报告不含推断的学习课程/章节/视频进度；知识点标签为人工维护，未标注题目不推断知识点。'
    };
  }

  root.DiagnosisEngine = { load: load, compute: compute, report: report, dateOf: dateOf };
})(typeof window !== 'undefined' ? window : globalThis);
