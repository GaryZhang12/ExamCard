/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright 2026 ExamCard contributors */
/* V3.1 · Attempt 批改快照：每次批改保存可独立解释的历史记录 */
(function (root) {
  'use strict';

  var SNAPSHOT_VERSION = 1;

  function clone(v) {
    return v == null ? v : JSON.parse(JSON.stringify(v));
  }

  function stdId(std) {
    return std && std.setId ? std.setId : null;
  }

  function stdVersion(std) {
    return std && std.version != null ? std.version : null;
  }

  async function save(exam, session, std, grade) {
    if (!exam || !session) throw new Error('缺少试卷或会话');
    var records = await ExamStore.listGradingRecordsForSession(session.id);
    var revision = records.length + 1;
    var previous = records.length ? records[records.length - 1].attemptId : null;
    var summary = grade && grade.summary ? grade.summary : null;
    var details = grade && grade.details ? grade.details : [];
    var record = {
      attemptId: 'att-' + session.id + '-r' + revision,
      sessionId: session.id,
      examId: exam.id,
      examName: exam.name || '',
      standardAnswerSetId: stdId(std),
      standardAnswerVersion: stdVersion(std),
      answerSource: std && std.source ? clone(std.source) : null,
      answers: clone(session.answers || {}),
      marks: clone(session.marks || {}),
      qTime: clone(session.qTime || {}),
      details: clone(details),
      summary: clone(summary),
      total: summary ? summary.total : null,
      answered: summary ? summary.answered : null,
      correct: summary ? summary.correct : null,
      incorrect: summary ? summary.incorrect : null,
      accuracy: summary ? summary.accuracy : null,
      gradedAt: Date.now(),
      gradingRuleVersion: (root.GradeExport && root.GradeExport.SCHEMA_VERSION) || 'gd-exam-diagnosis/v2.0',
      gradingStatus: summary ? 'graded' : 'ungraded',
      config: clone(session.config || {}),
      retestOf: session.config && session.config.sourceSessionId ? session.config.sourceSessionId : null,
      sourceQuestionIds: session.config && Array.isArray(session.config.sourceQuestionIds) ? clone(session.config.sourceQuestionIds) : null,
      revisionOf: previous,
      schemaVersion: SNAPSHOT_VERSION,
      createdAt: Date.now()
    };
    await ExamStore.putGradingRecord(record);
    return record;
  }

  function toStd(record) {
    if (!record) return null;
    var details = Array.isArray(record.details) ? record.details : [];
    if (!details.length) return null;
    var answers = {};
    var explanations = {};
    details.forEach(function (d) {
      if (d && d.correct_answer != null && d.correct_answer !== '') {
        answers[d.question_id] = d.correct_answer;
        if (d.explanation) explanations[d.question_id] = d.explanation;
      }
    });
    return {
      answers: answers,
      explanations: explanations,
      source: record.answerSource || null,
      setId: record.standardAnswerSetId || null,
      version: record.standardAnswerVersion != null ? record.standardAnswerVersion : null
    };
  }

  function summaryOf(record) {
    if (!record || !record.summary) return null;
    return { summary: record.summary, details: record.details || [] };
  }

  root.AttemptSnapshot = {
    SNAPSHOT_VERSION: SNAPSHOT_VERSION,
    save: save,
    toStd: toStd,
    summaryOf: summaryOf
  };
})(typeof window !== 'undefined' ? window : globalThis);
