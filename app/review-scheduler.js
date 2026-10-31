/* SPDX-License-Identifier: Apache-2.0 */
/* ExamCard 1.1.0 · minimal D+1/D+3/D+7 review-task planner.
 * Pure scheduling only; tasks are created by the caller after user action. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReviewScheduler = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  var VERSION = 'bank-review-v1';
  var INTERVALS = [1, 3, 7];
  var CATEGORIES = [
    { name: '政治理论', re: /政治理论|习近平|党的二十大|中国式现代化|马克思主义|中国特色社会主义/ },
    { name: '广东省情', re: /广东省情|广东|粤港澳|大湾区|前海|深圳特色/ },
    { name: '申论表达', re: /申论|归纳概括|综合分析|提出对策|贯彻执行|议论文|表达/ }
  ];
  function dayKey(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function addDays(date, n) { var d = new Date(date.getTime()); d.setDate(d.getDate() + n); return d; }
  function categoryOf(tags) {
    var found = [];
    (tags || []).forEach(function (tag) { CATEGORIES.forEach(function (c) { if (c.re.test(tag) && found.indexOf(c.name) < 0) found.push(c.name); }); });
    return found[0] || null;
  }
  function plan(items, options) {
    options = options || {};
    var start = options.startDate ? new Date(options.startDate + 'T00:00:00') : new Date();
    if (isNaN(start.getTime())) start = new Date();
    var byDay = {};
    (items || []).forEach(function (item) {
      if (!item || !item.bankQuestionId) return;
      var cat = categoryOf(item.tags);
      if (!cat) return;
      (byDay[cat] = byDay[cat] || []).push({ bankQuestionId: item.bankQuestionId, tags: item.tags || [], lastWrongAt: item.lastAt || item.lastWrongAt || null });
    });
    var tasks = [];
    Object.keys(byDay).sort().forEach(function (cat) {
      var list = byDay[cat].slice().sort(function (a, b) { return String(a.bankQuestionId).localeCompare(String(b.bankQuestionId)); });
      INTERVALS.forEach(function (days) {
        var due = addDays(start, days);
        var ids = list.map(function (x) { return x.bankQuestionId; });
        tasks.push({
          reviewKey: VERSION + ':' + cat + ':' + dayKey(due),
          type: 'retest',
          title: '间隔复习 D+' + days + ' · ' + cat,
          date: dayKey(due),
          dueDate: dayKey(due),
          tagIds: [cat],
          bankQuestionIds: ids,
          reason: '错题/薄弱知识点间隔复习',
          intervalDays: days,
          source: 'bank-review-v1'
        });
      });
    });
    tasks.sort(function (a, b) { return a.date.localeCompare(b.date) || a.title.localeCompare(b.title); });
    return { version: VERSION, intervals: INTERVALS, tasks: tasks };
  }
  return { VERSION: VERSION, INTERVALS: INTERVALS, categories: CATEGORIES, plan: plan };
});
