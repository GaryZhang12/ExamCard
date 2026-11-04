/* SPDX-License-Identifier: Apache-2.0 */
/* ExamCard 1.1.0 · plan review scheduler (pure, no DB writes). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PlanScheduler = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  var INTERVALS = [1, 3, 7];
  var REVIEW_MINUTES = 15;
  var RECALL_MINUTES = 5;
  var DEFAULT_MAX_MINUTES = 25;
  function dayNumber(s) {
    var p = String(s || '').split('-').map(Number);
    if (p.length !== 3 || !p[0] || !p[1] || !p[2]) return null;
    return Math.floor(Date.UTC(p[0], p[1] - 1, p[2]) / 86400000);
  }
  function dayKey(n) {
    var d = new Date(n * 86400000);
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  function addDays(date, n) { var d = dayNumber(date); return d == null ? null : dayKey(d + n); }
  function reviewKey(task, interval) { return 'plan-review:' + String((task && (task.id || task.taskId)) || '') + ':d' + interval; }
  function reviewTasks(task, options) {
    options = options || {};
    if (!task) return [];
    var base = task.date || task.dueDate || options.date;
    if (!base) return [];
    return INTERVALS.map(function (n) {
      var due = addDays(base, n);
      return {
        taskId: reviewKey(task, n),
        reviewKey: reviewKey(task, n),
        title: '间隔复测 D+' + n + ' · ' + String(task.title || task.topic || '背诵任务'),
        type: 'retest',
        taskType: 'retest',
        date: due,
        dueDate: due,
        time: null,
        priority: task.priority === 'high' ? 'high' : 'normal',
        planMinutes: REVIEW_MINUTES,
        planQuestions: 0,
        status: 'pending',
        sourceTaskId: task.id || task.taskId || null,
        sourceTopic: task.topic || task.title || null,
        memorization: task.memorization ? JSON.parse(JSON.stringify(task.memorization)) : null,
        reviewedAt: null
      };
    }).filter(function (x) { return !!x.date; });
  }
  function dueReviews(tasks, date, options) {
    options = options || {};
    var maxMinutes = Number(options.maxMinutes) > 0 ? Number(options.maxMinutes) : DEFAULT_MAX_MINUTES;
    var due = (tasks || []).filter(function (t) {
      return t && t.status !== 'completed' && t.status !== 'cancelled' && t.reminderStatus !== 'skipped' && t.reminderStatus !== 'closed' && (t.taskType === 'retest' || t.type === 'retest') && t.dueDate && t.dueDate <= date;
    }).sort(function (a, b) { return String(a.dueDate).localeCompare(String(b.dueDate)) || String(a.title).localeCompare(String(b.title)); });
    var chosen = [], minutes = 0, deferred = [];
    due.forEach(function (t) {
      var m = Number(t.planMinutes);
      if (!isFinite(m) || m < 0) m = REVIEW_MINUTES;
      if (minutes + m <= maxMinutes) { chosen.push(t); minutes += m; }
      else deferred.push(t);
    });
    return { date: date, due: due, selected: chosen, deferred: deferred, totalMinutes: minutes, maxMinutes: maxMinutes, recallMinutes: chosen.length ? Math.min(RECALL_MINUTES, maxMinutes - minutes) : 0 };
  }
  function workload(tasks, date) {
    var list = (tasks || []).filter(function (t) { return t && t.date === date; });
    return {
      date: date,
      tasks: list.length,
      plannedMinutes: list.reduce(function (n, t) { return n + (Number(t.planMinutes) || 0); }, 0),
      completedMinutes: list.reduce(function (n, t) { return n + (t.status === 'completed' ? (Number(t.actualMinutes) || 0) : 0); }, 0),
      completed: list.filter(function (t) { return t.status === 'completed'; }).length
    };
  }
  return { INTERVALS: INTERVALS, REVIEW_MINUTES: REVIEW_MINUTES, RECALL_MINUTES: RECALL_MINUTES, DEFAULT_MAX_MINUTES: DEFAULT_MAX_MINUTES, addDays: addDays, reviewKey: reviewKey, reviewTasks: reviewTasks, dueReviews: dueReviews, workload: workload };
});
