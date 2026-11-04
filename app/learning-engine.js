/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright 2026 ExamCard contributors */
/* ExamCard V5 · 学习计划反馈与 ChatGPT 数据包 */
(function (root) {
  'use strict';
  function dateOf(ts) { if (!ts) return ''; var n = typeof ts === 'number' ? ts : Date.parse(String(ts)); return isFinite(n) ? new Date(n + 8 * 3600 * 1000).toISOString().slice(0, 10) : ''; }
  function today() { return dateOf(Date.now()); }
  function addDays(dateStr, n) { var p = String(dateStr).split('-').map(Number); var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)); return d.toISOString().slice(0, 10); }
  function rangeDays(days) { var end = today(); return { from: addDays(end, -(days - 1)), to: end }; }
  function inRange(date, r) { return date && date >= r.from && date <= r.to; }

  async function load() {
    var engine = await DiagnosisEngine.load();
    var results = await Promise.all([LearningStore.listTextbooks(), LearningStore.listChapters(), LearningStore.listCourses(), LearningStore.listTasks(), DiagnosisStore.listStudyLogs()]);
    return { engine: engine, textbooks: results[0], chapters: results[1], courses: results[2], tasks: results[3], studyLogs: results[4] };
  }

  function softwareForDate(engine, date, excludeSessionIds) {
    var questions = 0, correct = 0, incorrect = 0, seconds = 0, attempts = 0, retests = 0, excluded = 0;
    var excludedSet = Object.create(null);
    (excludeSessionIds || []).forEach(function (id) { if (id) excludedSet[id] = true; });
    var sessionIds = [];
    (engine.attempts || []).forEach(function (a) {
      if (a.date !== date) return;
      if (a.record && excludedSet[a.record.sessionId]) { excluded++; return; }
      if (a.id && excludedSet[a.id]) { excluded++; return; }
      if (a.sessionId && excludedSet[a.sessionId]) { excluded++; return; }
      attempts++;
      var sid = (a.record && a.record.sessionId) || a.sessionId || a.id;
      if (sid) sessionIds.push(sid);
      if (a.retest) retests++;
      (a.details || []).forEach(function (d) {
        if (d.status === 'unanswered') return;
        questions++; seconds += d.elapsed || 0;
        if (d.status === 'correct') correct++; else if (d.status === 'incorrect') incorrect++;
      });
    });
    return { attempts: attempts, questions: questions, correct: correct, incorrect: incorrect, minutes: seconds ? Math.round(seconds / 6) / 10 : 0, retests: retests, accuracy: (correct + incorrect) ? Math.round(correct / (correct + incorrect) * 1000) / 10 : null, excluded: excluded, sessionIds: sessionIds };
  }

  function feedback(data, days) {
    days = days || 30;
    var range = rangeDays(days);
    var scopedLogs = (data.studyLogs || []).filter(function (l) { return l && l.status !== 'deleted' && inRange(l.date, range); });
    var logSummary = root.StudyLog ? root.StudyLog.summarize(scopedLogs) : { objective: { categories: {}, total: {} }, essays: [], wrongQuestions: [], linkedTaskIds: {} };
    var linkedTaskIds = logSummary.linkedTaskIds || {};
    var tasks = (data.tasks || []).filter(function (t) { return inRange(t.date, range) || inRange(t.dueDate, range); });
    var completed = tasks.filter(function (t) { return t.status === 'completed'; });
    var plannedCount = tasks.length;
    var completionRate = plannedCount ? Math.round(completed.length / plannedCount * 1000) / 10 : null;
    var actual = { minutes: 0, questions: 0, correct: 0, externalMinutes: 0, softwareMinutes: 0, manualTasks: 0, softwareTasks: 0, linkedTasksSkipped: 0 };
    completed.forEach(function (t) {
      if (t.id && linkedTaskIds[t.id]) { actual.linkedTasksSkipped++; return; }
      var m = Number(t.actualMinutes) || 0, q = Number(t.actualQuestions) || 0, c = Number(t.actualCorrect) || 0;
      actual.minutes += m; actual.questions += q; actual.correct += c;
      if (t.actualSource === 'software') { actual.softwareMinutes += m; actual.softwareTasks++; }
      else { actual.externalMinutes += m; actual.manualTasks++; }
    });
    var daily = {};
    var d = range.from;
    while (d <= range.to) { daily[d] = { date: d, planned: 0, completed: 0, actualMinutes: 0, actualQuestions: 0, software: softwareForDate(data.engine, d) }; d = addDays(d, 1); }
    tasks.forEach(function (t) { if (!daily[t.date]) return; daily[t.date].planned++; if (t.status === 'completed') daily[t.date].completed++; });
    completed.forEach(function (t) {
      if (!daily[t.date] || (t.id && linkedTaskIds[t.id])) return;
      daily[t.date].actualMinutes += Number(t.actualMinutes) || 0;
      daily[t.date].actualQuestions += Number(t.actualQuestions) || 0;
    });
    var dailyRows = Object.keys(daily).sort().map(function (k) { var x = daily[k]; x.completionRate = x.planned ? Math.round(x.completed / x.planned * 1000) / 10 : null; return x; });

    var weekly = {};
    tasks.forEach(function (t) {
      var d0 = new Date(t.date + 'T00:00:00Z'); var dow = (d0.getUTCDay() + 6) % 7; var ws = addDays(t.date, -dow);
      if (!weekly[ws]) weekly[ws] = { weekStart: ws, planned: 0, completed: 0, actualMinutes: 0, actualQuestions: 0 };
      weekly[ws].planned++;
      if (t.status === 'completed') {
        weekly[ws].completed++;
        if (!(t.id && linkedTaskIds[t.id])) {
          weekly[ws].actualMinutes += Number(t.actualMinutes) || 0;
          weekly[ws].actualQuestions += Number(t.actualQuestions) || 0;
        }
      }
    });
    var weeklyRows = Object.keys(weekly).sort().map(function (k) { var w = weekly[k]; w.completionRate = w.planned ? Math.round(w.completed / w.planned * 1000) / 10 : null; return w; });

    var software = { questions: 0, correct: 0, incorrect: 0, minutes: 0, attempts: 0, retests: 0 };
    (data.engine.attempts || []).forEach(function (a) {
      if (!inRange(a.date, range)) return; software.attempts++; if (a.retest) software.retests++;
      (a.details || []).forEach(function (d) { if (d.status === 'unanswered') return; software.questions++; software.minutes += d.elapsed || 0; if (d.status === 'correct') software.correct++; else if (d.status === 'incorrect') software.incorrect++; });
    });
    software.minutes = software.minutes ? Math.round(software.minutes / 6) / 10 : 0;
    software.accuracy = (software.correct + software.incorrect) ? Math.round(software.correct / (software.correct + software.incorrect) * 1000) / 10 : null;

    var trends = (data.engine.trends || []).filter(function (t) { return inRange(t.date, range); });
    var accuracyChange = (trends.length >= 2 && trends[0].accuracy != null && trends[trends.length - 1].accuracy != null) ? Math.round((trends[trends.length - 1].accuracy - trends[0].accuracy) * 10) / 10 : null;
    var retestTasks = tasks.filter(function (t) { return t.type === 'retest'; });
    var retestDone = retestTasks.filter(function (t) { return t.status === 'completed'; });
    var courseMinutes = (data.courses || []).reduce(function (s, c) { return s + (Number(c.learnedMin) || 0); }, 0);
    var textbookProgress = (data.chapters || []).map(function (c) { return Number(c.progressPercent) || 0; });
    var avgProgress = textbookProgress.length ? Math.round(textbookProgress.reduce(function (a, b) { return a + b; }, 0) / textbookProgress.length * 10) / 10 : null;

    return {
      range: range, days: days,
      plan: { total: plannedCount, completed: completed.length, completionRate: completionRate, tasks: tasks },
      actual: {
        minutes: actual.minutes, questions: actual.questions, correct: actual.correct,
        externalMinutes: actual.externalMinutes, softwareMinutes: actual.softwareMinutes,
        manualTasks: actual.manualTasks, softwareTasks: actual.softwareTasks, linkedTasksSkipped: actual.linkedTasksSkipped
      },
      external: logSummary.objective,
      essays: logSummary.essays,
      externalWrongQuestions: logSummary.wrongQuestions,
      linkedTaskIds: linkedTaskIds,
      software: software,
      accuracyChange: accuracyChange,
      weak: data.engine.weak || [],
      knowledge: data.engine.knowledge || [],
      retest: { planned: retestTasks.length, completed: retestDone.length, softwareRetestSessions: software.retests, comparison: data.engine.retestCompare || [] },
      courses: data.courses || [], courseLearnedMinutes: courseMinutes,
      textbooks: data.textbooks || [], chapters: data.chapters || [], textbookAvgProgress: avgProgress,
      daily: dailyRows, weekly: weeklyRows,
      planVsActual: tasks.map(function (t) {
        return { id: t.id, title: t.title, type: t.type, taskType: t.taskType || null, planMode: t.planMode || null, module: t.module || null, knowledgePoint: t.knowledgePoint || null, date: t.date, status: t.status, planMinutes: t.planMinutes, actualMinutes: t.actualMinutes, planQuestions: t.planQuestions, actualQuestions: t.actualQuestions, actualSource: t.actualSource || null };
      }),
      dataNotes: [
        '计划完成量来自用户任务标记；未完成/已完成状态不自动推断。',
        '软件练习题数/正确率来自不可变 gradingRecords 快照；同一会话只取最新批改。',
        '外部练习与申论评分来自学习记录；带 taskId 的外部活动不重复计入任务实际汇总。',
        '专项/综合/复测/模考分开展示；专项新题仅 new 标签，不等于全部专项。',
        '客观练习小计 = 新题+复测+未分类（排除综合/模考），手动 objective 也纳入；未分类明确显示，不猜成新题/复测。',
        '申论分数不转换为题数；活动级 logId 不等于逐评分同一。',
        '计划完成率不等于正确率或能力评分；样本不足时不做强结论。'
      ]
    };
  }

  function packageData(data, fb) {
    var diagnosis = DiagnosisEngine.report(data.engine, data.studyLogs || []);
    return {
      schema: 'examcard.learning-feedback/v1', schemaVersion: 'v5.0', generatedAt: new Date().toISOString(),
      range: fb.range,
      methodology: {
        plan: '用户创建的任务与用户标记的完成状态；创建任务不等于完成。',
        actual: '任务实际值：软件类可由真实练习会话带入，外部类由用户手动确认；已关联外部活动的任务不重复汇总。',
        external: '外部练习来自用户主动导入的 studyLogs；按 source + externalId 去重，专项/综合/复测/模考分开。',
        essay: '申论评分来自外部学习记录或已导入评分结果；首次评分与复评独立保留，不转换为题数。',
        software: '行测逐题数据来自 gradingRecords 快照；申论评分数据来自已导入评分结果。',
        accuracy: '正确率 = 正确 / 总题量（仅对已填写总题量的外部客观题）；未知不按 0 处理。'
      },
      learning: {
        plan: { total: fb.plan.total, completed: fb.plan.completed, completionRate: fb.plan.completionRate },
        actual: fb.actual,
        external: fb.external,
        essays: fb.essays,
        externalWrongQuestions: fb.externalWrongQuestions,
        software: fb.software,
        accuracyChange: fb.accuracyChange,
        daily: fb.daily, weekly: fb.weekly,
        planVsActual: fb.planVsActual,
        tasks: fb.plan.tasks,
        recentMocks: fb.plan.tasks.filter(function (x) { return x.type === 'mock'; }),
        courses: fb.courses, courseLearnedMinutes: fb.courseLearnedMinutes,
        textbooks: fb.textbooks, chapters: fb.chapters, textbookAvgProgress: fb.textbookAvgProgress,
        retest: fb.retest
      },
      diagnosis: diagnosis,
      knowledge: { knowledge: fb.knowledge, weak: fb.weak },
      dataLimitations: fb.dataNotes,
      disclaimer: '本数据包仅供用户手动提交外部工具分析，不自动上传；学习计划/外部学习记录为用户记录，不代表软件验证。'
    };
  }

  async function exportPackage(days) {
    var data = await load(); var fb = feedback(data, days); return packageData(data, fb);
  }

  root.LearningEngine = { load: load, feedback: feedback, packageData: packageData, exportPackage: exportPackage, softwareForDate: softwareForDate, today: today };
})(typeof window !== 'undefined' ? window : globalThis);
