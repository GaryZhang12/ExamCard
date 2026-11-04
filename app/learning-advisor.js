/* SPDX-License-Identifier: Apache-2.0 */
/* ExamCard 1.1.0 · explainable study-plan recommendations (pure; never writes). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LearningAdvisor = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  var MIN_SAMPLE = 5;
  function pct(n) { return n == null ? null : Math.round(n * 1000) / 10; }
  function byDate(a, b) { return String(a.date || '').localeCompare(String(b.date || '')) || String(a.id || '').localeCompare(String(b.id || '')); }
  function recommendation(code, title, reason, evidence, confidence, suggested) {
    return { code: code, title: title, reason: reason, evidence: evidence, confidence: confidence, suggested: suggested || null, apply: 'manual' };
  }
  function recommend(input) {
    input = input || {};
    var tasks = (input.tasks || []).slice().sort(byDate);
    var out = [];
    var completed = tasks.filter(function (t) { return t.status === 'completed' && t.actualSource === 'software' && Number(t.actualQuestions) >= MIN_SAMPLE && Number.isFinite(Number(t.actualCorrect)); });
    var withAccuracy = completed.filter(function (t) { return Number(t.actualCorrect) <= Number(t.actualQuestions); });
    var totalQ = withAccuracy.reduce(function (n, t) { return n + Number(t.actualQuestions || 0); }, 0);
    var totalC = withAccuracy.reduce(function (n, t) { return n + Number(t.actualCorrect || 0); }, 0);
    var accuracy = totalQ >= MIN_SAMPLE ? totalC / totalQ : null;
    var verifiedQ = withAccuracy.reduce(function (n, t) { return n + Number(t.actualQuestions || 0); }, 0);
    if (accuracy != null) {
      var evidence = { questions: totalQ, correct: totalC, accuracy: pct(accuracy), verifiedQuestions: verifiedQ, minSample: MIN_SAMPLE, source: verifiedQ ? 'software-or-user-confirmed' : 'user-confirmed-only' };
      if (accuracy < 0.7) out.push(recommendation('foundation_review', '补基础并重做例题', '近期有效作答正确率低于 70%，优先回到基础方法与例题。', evidence, verifiedQ >= MIN_SAMPLE ? 'medium' : 'low', { taskType: 'examples', planMinutes: 30 }));
      else if (accuracy < 0.85) out.push(recommendation('targeted_practice', '针对性强化', '近期正确率在 70%–85%，建议按薄弱知识点做中高难专项练习。', evidence, verifiedQ >= MIN_SAMPLE ? 'medium' : 'low', { taskType: 'practice', planMinutes: 45 }));
      else {
        var timed = withAccuracy.filter(function (t) { return t.timeLimitSeconds != null && t.actualMinutes != null && t.actualMinutes * 60 > t.timeLimitSeconds; });
        if (timed.length) out.push(recommendation('speed_drill', '限时与取舍训练', '正确率已达到 85%，但存在超时任务；优先做速算、限时和取舍策略训练。', Object.assign({}, evidence, { timedTasks: timed.length }), 'medium', { taskType: 'timed_drill', planMinutes: 30, timeLimitSeconds: 1800 }));
        else out.push(recommendation('advance_retest', '进阶与间隔复测', '正确率达到 85% 且限时达标，可以增加复杂题并安排 D+1/D+3/D+7 复测。', evidence, 'medium', { taskType: 'retest', planMinutes: 20 }));
      }
    }
    var mockTasks = tasks.filter(function (t) { return t.taskType === 'mock_exam' && t.status === 'completed' && t.actualQuestions; });
    var recent = mockTasks.slice(-2);
    if (recent.length === 2) {
      var a0 = Number(recent[0].actualCorrect) / Number(recent[0].actualQuestions);
      var a1 = Number(recent[1].actualCorrect) / Number(recent[1].actualQuestions);
      if (a1 + 0.05 < a0) out.push(recommendation('mock_load_review', '排查模考负荷与策略', '最近两次模考正确率下降超过 5 个百分点；建议检查任务负荷、题型难度和休息情况，不直接判定能力下降。', { previousAccuracy: pct(a0), latestAccuracy: pct(a1), sample: 2 }, 'low', { taskType: 'mock_review', planMinutes: 45 }));
    }
    var attempts = input.attempts || [];
    var wrong = {}, repeated = [];
    attempts.forEach(function (a) { (a.results || a.details || []).forEach(function (r) { var id = r.bankQuestionId || r.id; if (!id) return; if (r.correct === false) { wrong[id] = (wrong[id] || 0) + 1; if (wrong[id] >= 2) repeated.push(id); } }); });
    if (repeated.length) out.push(recommendation('repeat_error_review', '重复错误优先复盘', '同一道题或同一知识点出现连续两次以上错误，建议提高错题复盘优先级。', { repeatedQuestionIds: repeated.slice(0, 5), sample: repeated.length }, repeated.length >= 3 ? 'medium' : 'low', { taskType: 'review', planMinutes: 30 }));
    return {
      version: 'learning-advisor/v1',
      minSample: MIN_SAMPLE,
      sample: { questions: totalQ, verifiedQuestions: verifiedQ, accuracy: accuracy == null ? null : pct(accuracy) },
      recommendations: out,
      note: '建议仅供用户接受或拒绝，不自动修改任务、不覆盖人工计划；未确认/未批改数据不进入掌握率结论。'
    };
  }
  return { MIN_SAMPLE: MIN_SAMPLE, recommend: recommend };
});
