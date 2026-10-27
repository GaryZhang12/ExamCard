/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright 2026 ExamCard contributors */
/*!
 * 广东省考智能答题卡 V2 — 批改 + GPT 诊断导出模块（grade-export.js）
 * ------------------------------------------------------------------
 * 全局 UMD：
 *   浏览器：<script src="grade-export.js"></script> 后使用 window.GradeExport
 *   Node  ：const GradeExport = require('./grade-export.js')
 *
 * 依赖：buildDiagnosisZip 需要全局 fflate（libs/fflate.umd.js / zipSync、strToU8）；
 *       其余 API 零依赖。
 *
 * 对外 API：
 *   GradeExport.grade(exam, session, std, options) -> { summary, details }
 *   GradeExport.buildAttemptCSV(exam, session, std) -> string
 *   GradeExport.buildSummaryJSON(exam, session, std) -> string
 *   GradeExport.buildWrongQuestionsCSV(exam, session, std) -> string
 *   GradeExport.buildDiagnosisZip(exam, session, std) -> Uint8Array
 *   GradeExport.normAnswer / normType / getExamQuestions / ATTEMPT_CSV_HEADER / SCHEMA_VERSION
 *
 * 批改口径（重要）：
 *   未作答                          -> grading_status='unanswered'，is_correct=null
 *   有作答但该题没有标准答案          -> grading_status='unverified'，is_correct=null（绝不算错）
 *   有作答且存在标准答案              -> correct / incorrect
 *   多选必须选项集合完全一致          -> 'AC' 与 'CA' 判对；'AC' 与 'A' 判错
 *   accuracy = correct / verified_answered × 100（0-100，保留 1 位小数；无已核实作答时为 null）
 *
 * std 支持两种形态：
 *   AnswerIO.finalize(...) 的结果 { answers, explanations, source, ... }
 *   或直接传 { 题号: 答案 } 映射
 */
(function (root, factory) {
  var api = factory(root);
  if (root) {
    try { root.GradeExport = api; } catch (e) { /* ignore */ }
  }
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis
  : typeof self !== 'undefined' ? self
    : typeof window !== 'undefined' ? window
      : this, function (root) {
  'use strict';

  var SCHEMA_VERSION = 'gd-exam-diagnosis/v2.0';
  var RELIABILITY = 'user_provided_unverified';

  // attempt_detail.csv 的固定表头（前 13 列，顺序不可变）；后 3 列为允许的诊断扩展列
  var ATTEMPT_CSV_HEADER = [
    'exam_id', 'session_id', 'exam_year', 'question_id', 'subject', 'question_type',
    'user_answer', 'correct_answer', 'grading_status', 'is_correct', 'elapsed_seconds',
    'marked_uncertain', 'answer_source'
  ];
  var ATTEMPT_CSV_EXTRA_HEADER = ['explanation', 'page_stay_seconds', 'overtime'];

  var WRONG_CSV_HEADER = [
    'exam_id', 'session_id', 'exam_year', 'question_id', 'subject', 'question_type',
    'user_answer', 'correct_answer', 'grading_status', 'elapsed_seconds',
    'marked_uncertain', 'overtime', 'explanation'
  ];

  var TYPE_LABEL = { single: '单选', judge: '判断', multi: '多选' };

  var _nodeRequire = (typeof require === 'function') ? require : null;

  /* ============================ 通用工具 ============================ */

  function getLib(name, relPath) {
    var g = root || {};
    try { if (g[name]) return g[name]; } catch (e) { /* ignore */ }
    if (_nodeRequire) {
      try {
        var m = _nodeRequire(relPath);
        if (m) {
          try { g[name] = m; } catch (e) { /* ignore */ }
          return m;
        }
      } catch (e) { /* ignore */ }
    }
    return null;
  }

  function isBlank(v) {
    if (v == null) return true;
    if (Array.isArray(v)) {
      return v.every(function (x) { return String(x == null ? '' : x).trim() === ''; });
    }
    return String(v).trim() === '';
  }

  function toText(v) {
    if (v == null) return '';
    if (Array.isArray(v)) return v.map(function (x) { return x == null ? '' : String(x); }).join('');
    return String(v);
  }

  function nfkc(v) {
    var s = v == null ? '' : String(v);
    try { if (typeof s.normalize === 'function') s = s.normalize('NFKC'); } catch (e) { /* ignore */ }
    return s;
  }

  function num(v) {
    var n = Number(v);
    return isFinite(n) && n > 0 ? n : 0;
  }

  function int(v, fallback) {
    var n = parseInt(v, 10);
    return isFinite(n) ? n : (fallback == null ? 0 : fallback);
  }

  function round1(v) {
    return Math.round(v * 10) / 10;
  }

  function typeLabel(t) { return TYPE_LABEL[t] || t || ''; }

  function toIso(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number' && isFinite(v)) {
      try { return new Date(v).toISOString(); } catch (e) { return null; }
    }
    var d = new Date(v);
    if (isFinite(d.getTime())) return d.toISOString();
    return String(v);
  }

  /* ============================ 题型 / 答案规范化（与 answer-io.js 一致） ============================ */

  function normType(t) {
    if (t == null) return '';
    var s = nfkc(t).toLowerCase().replace(/\s+/g, '');
    if (!s) return '';
    if (s === 'tf' || s === 't/f' || s === 'truefalse' || s === 'true/false') return 'judge';
    if (s.indexOf('judge') >= 0 || s.indexOf('判断') >= 0) return 'judge';
    if (s.indexOf('multiple') >= 0 || s.indexOf('multi') >= 0 ||
        s.indexOf('多选') >= 0 || s.indexOf('多项') >= 0) return 'multi';
    if (s.indexOf('single') >= 0 || s.indexOf('单选') >= 0 || s.indexOf('单项') >= 0) return 'single';
    return '';
  }

  var JUDGE_MAP = {
    '正确': '正确', '对的': '正确', '对': '正确', '√': '正确', '✓': '正确', '✔': '正确', '☑': '正确',
    'T': '正确', 'TRUE': '正确', '是': '正确', 'Y': '正确', 'YES': '正确', '1': '正确', 'A': '正确',
    '错误': '错误', '错的': '错误', '错': '错误', '×': '错误', '✗': '错误', '✘': '错误', '☒': '错误',
    'F': '错误', 'FALSE': '错误', '否': '错误', 'N': '错误', 'NO': '错误', '0': '错误', 'B': '错误'
  };
  var TRIM_PUNCT_RE = /^[\s\u3000（）()【】\[\]「」“”‘’"'。．.，,、；;：:]+|[\s\u3000（）()【】\[\]「」“”‘’"'。．.，,、；;：:]+$/g;

  function normJudge(raw) {
    var s = nfkc(raw).trim();
    if (!s) return '';
    s = s.replace(/[\s\u3000]+/g, '').replace(TRIM_PUNCT_RE, '');
    if (!s) return '';
    var up = s.toUpperCase();
    if (JUDGE_MAP[s]) return JUDGE_MAP[s];
    if (JUDGE_MAP[up]) return JUDGE_MAP[up];
    return '';
  }

  var CHOICE_STRIP_RE = /[\s\u3000,，、;；\/|\\+＋&和及()（）\[\]【】「」“”‘’"'.:：。．]+/g;

  function cleanChoice(raw) {
    return nfkc(raw).toUpperCase().replace(CHOICE_STRIP_RE, '');
  }

  function uniqueSortedLetters(s) {
    var letters = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c >= 'A' && c <= 'D') letters.push(c);
    }
    letters.sort();
    var out = [];
    for (var j = 0; j < letters.length; j++) {
      if (out[out.length - 1] !== letters[j]) out.push(letters[j]);
    }
    return out;
  }

  function normChoice(raw, type) {
    var s = cleanChoice(raw);
    if (!s) return '';
    var letters = uniqueSortedLetters(s);
    if (!letters.length) return '';
    if (type === 'single') return letters.length === 1 ? letters[0] : letters.join('');
    return letters.join('');
  }

  function normAnswer(raw, type) {
    type = normType(type) || 'single';
    if (raw == null) return '';
    if (type === 'judge') {
      if (Array.isArray(raw)) {
        var joined = raw.map(toText).join('');
        var j = normJudge(joined);
        if (j) return j;
        return raw.length ? normJudge(raw[0]) : '';
      }
      return normJudge(raw);
    }
    var text = Array.isArray(raw) ? raw.map(toText).join('') : toText(raw);
    return normChoice(text, type);
  }

  /* ============================ 试卷题目归一化 ============================ */

  function moduleAt(modules, n) {
    if (!Array.isArray(modules)) return '';
    for (var i = 0; i < modules.length; i++) {
      var m = modules[i];
      if (!m) continue;
      var start = parseInt(m.start, 10);
      var end = parseInt(m.end, 10);
      if (isFinite(start) && isFinite(end) && n >= start && n <= end) return String(m.name || '未分类');
    }
    return '';
  }

  function moduleType(modules, n) {
    if (!Array.isArray(modules)) return '';
    for (var i = 0; i < modules.length; i++) {
      var m = modules[i];
      if (!m) continue;
      var start = parseInt(m.start, 10);
      var end = parseInt(m.end, 10);
      if (isFinite(start) && isFinite(end) && n >= start && n <= end) {
        var overrides = m.typeOverrides || {};
        var t = normType(overrides[n] != null ? overrides[n] : overrides[String(n)]);
        return t || normType(m.type);
      }
    }
    return '';
  }

  function getExamQuestions(exam) {
    exam = exam || {};
    var list = [];
    var modules = Array.isArray(exam.modules) ? exam.modules : [];
    if (Array.isArray(exam.questions) && exam.questions.length) {
      exam.questions.forEach(function (q) {
        if (!q) return;
        var rawN = q.n != null ? q.n : (q.question_id != null ? q.question_id : q.number);
        var n = parseInt(rawN, 10);
        if (!isFinite(n) || n <= 0) return;
        var type = normType(q.type) || moduleType(modules, n) || 'single';
        var moduleName = q.module != null && String(q.module).trim() !== ''
          ? String(q.module).trim()
          : (q.subject != null && String(q.subject).trim() !== ''
            ? String(q.subject).trim()
            : (moduleAt(modules, n) || '未分类'));
        list.push({ n: n, type: type, module: moduleName, page: q.page != null ? q.page : null });
      });
    } else if (modules.length) {
      modules.forEach(function (m) {
        if (!m) return;
        var start = parseInt(m.start, 10);
        var end = parseInt(m.end, 10);
        if (!isFinite(start) || !isFinite(end) || end < start) return;
        for (var n = start; n <= end; n++) {
          list.push({
            n: n,
            type: moduleType(modules, n) || (m.typeOverrides && normType(m.typeOverrides[n])) || 'single',
            module: String(m.name || '未分类'),
            page: m.page != null ? m.page : null
          });
        }
      });
    }
    list.sort(function (a, b) { return a.n - b.n; });
    var seen = Object.create(null);
    var uniq = [];
    list.forEach(function (q) {
      if (seen[q.n]) return;
      seen[q.n] = true;
      uniq.push(q);
    });
    return uniq;
  }

  function moduleOrder(exam, details) {
    var order = [];
    if (exam && Array.isArray(exam.modules)) {
      exam.modules.forEach(function (m) {
        if (m && m.name && order.indexOf(String(m.name)) < 0) order.push(String(m.name));
      });
    }
    details.forEach(function (d) {
      if (order.indexOf(d.subject) < 0) order.push(d.subject);
    });
    return order;
  }

  /* ============================ 标准答案 / 会话归一化 ============================ */

  function resolveStd(std) {
    var out = { answers: {}, explanations: {}, source: null, present: false };
    if (!std || typeof std !== 'object') return out;
    if (std.answers && typeof std.answers === 'object' && !Array.isArray(std.answers)) {
      out.answers = std.answers;
      out.explanations = (std.explanations && typeof std.explanations === 'object' && !Array.isArray(std.explanations))
        ? std.explanations : {};
      out.source = (std.source && typeof std.source === 'object') ? std.source : null;
    } else {
      out.answers = std;
      out.explanations = {};
      out.source = null;
    }
    out.present = Object.keys(out.answers).some(function (k) {
      return /^\d+$/.test(k) && !isBlank(out.answers[k]);
    });
    return out;
  }

  function stdValue(std, q) {
    var v = std.answers[q.n];
    if (v == null) v = std.answers[String(q.n)];
    if (isBlank(v)) return '';
    return v;
  }

  function stdNorm(std, q) {
    var v = stdValue(std, q);
    if (isBlank(v)) return '';
    return normAnswer(v, q.type);
  }

  function stdExplanation(std, q) {
    if (!std || !std.explanations) return '';
    var v = std.explanations[q.n];
    if (v == null) v = std.explanations[String(q.n)];
    return v == null ? '' : String(v);
  }

  function hasAnswer(v) {
    if (v == null) return false;
    if (Array.isArray(v)) {
      return v.some(function (x) { return String(x == null ? '' : x).trim() !== ''; });
    }
    return String(v).trim() !== '';
  }

  function qTimeOf(session, n) {
    var out = { answerMs: 0, stayMs: 0 };
    if (!session || !session.qTime) return out;
    var v = session.qTime[n];
    if (v == null) v = session.qTime[String(n)];
    if (v == null) return out;
    if (typeof v === 'number') {
      out.answerMs = Math.max(0, v);
      return out;
    }
    if (typeof v === 'object') {
      var a = v.answerMs != null ? v.answerMs : (v.answer != null ? v.answer : (v.ms != null ? v.ms : 0));
      var s = v.stayMs != null ? v.stayMs : (v.stay != null ? v.stay : (v.pageMs != null ? v.pageMs : 0));
      out.answerMs = num(a);
      out.stayMs = num(s);
    }
    return out;
  }

  function resolveScope(exam, session, options) {
    var all = getExamQuestions(exam);
    if (session && session.config && Array.isArray(session.config.questionIds) && session.config.questionIds.length) {
      var wanted = {};
      session.config.questionIds.forEach(function (n) { wanted[String(n)] = true; });
      var sub = all.filter(function (q) { return wanted[String(q.n)] || wanted[String(q.questionId)]; });
      if (sub.length) return { questions: sub, scope: 'retest', module: '' };
    }
    var moduleName = '';
    var optScope = options ? options.scope : null;
    if (optScope != null && optScope !== '' && optScope !== 'session' && optScope !== 'exam') {
      moduleName = String(optScope);
    } else if ((optScope == null || optScope === 'session') &&
               session && session.config && session.config.module) {
      moduleName = String(session.config.module);
    }
    if (optScope === 'exam') moduleName = '';
    if (moduleName) {
      var sub = all.filter(function (q) { return q.module === moduleName; });
      if (sub.length) return { questions: sub, scope: 'module:' + moduleName, module: moduleName };
    }
    return { questions: all, scope: 'exam', module: '' };
  }

  function resolveOvertime(session, options) {
    var sec = options ? options.overtimeSec : null;
    if (sec == null || sec === '') sec = (session && session.config) ? session.config.overtimeSec : null;
    if (sec == null || sec === '') sec = 90;
    var n = Number(sec);
    if (!isFinite(n)) n = 90;
    if (n < 0) n = 0;
    return { seconds: n, enabled: n > 0 };
  }

  function summaryAnswerSource(std) {
    if (!std.present) {
      return { filename: null, importedAt: null, confirmed: false, reliability: 'none' };
    }
    var s = std.source || {};
    return {
      filename: s.filename != null ? s.filename : null,
      importedAt: s.importedAt != null ? s.importedAt : null,
      confirmed: !!s.confirmed,
      // 导入的标准答案一律标记为“用户提供、未经核实”，绝不允许被写成官方答案
      reliability: RELIABILITY
    };
  }

  /* ============================ 批改核心 ============================ */

  function buildDetail(q, session, std, opts) {
    var answers = (session && session.answers) || {};
    var marks = (session && session.marks) || {};
    var raw = answers[q.n];
    var answered = hasAnswer(raw);
    var userNorm = normAnswer(raw, q.type);
    var userDisplay = answered ? (userNorm || toText(raw)) : '';

    var correctNorm = stdNorm(std, q);
    var hasStd = correctNorm !== '';

    var gradingStatus;
    var isCorrect;
    if (!answered) {
      gradingStatus = 'unanswered';
      isCorrect = null;
    } else if (!hasStd) {
      gradingStatus = 'unverified';
      isCorrect = null;
    } else if (userNorm && userNorm === correctNorm) {
      gradingStatus = 'correct';
      isCorrect = true;
    } else {
      gradingStatus = 'incorrect';
      isCorrect = false;
    }

    var t = qTimeOf(session, q.n);
    var elapsed = Math.max(0, Math.round(t.answerMs / 1000));
    var stay = Math.max(0, Math.round(t.stayMs / 1000));
    var overtime = !!(opts.overtime.enabled && elapsed > opts.overtime.seconds);
    // answer_source：只要该题存在标准答案（无论用户是否作答），都输出标准答案来源；
    // 未导入标准答案（该题没有标准答案）时为空字符串。
    var answerSource = '';
    if (hasStd) {
      var src = std.source || {};
      answerSource = src.filename || src.kind || src.name || 'user_import';
    }

    return {
      question_id: q.n,
      subject: q.module,
      question_type: q.type,
      user_answer: userDisplay,
      correct_answer: hasStd ? correctNorm : '',
      grading_status: gradingStatus,
      is_correct: isCorrect,
      elapsed_seconds: elapsed,
      marked_uncertain: !!marks[q.n] || !!marks[String(q.n)],
      answer_source: answerSource,
      explanation: hasStd ? stdExplanation(std, q) : '',
      page_stay_seconds: stay,
      overtime: overtime
    };
  }

  function buildSummary(exam, session, std, opts, details) {
    var total = details.length;
    var answered = 0;
    var unverified = 0;
    var correct = 0;
    var incorrect = 0;
    var totalAnswerSeconds = 0;
    var totalStaySeconds = 0;
    var wrongNumbers = [];
    var uncertainNumbers = [];
    var overtimeNumbers = [];

    details.forEach(function (d) {
      if (d.grading_status !== 'unanswered') answered++;
      if (d.grading_status === 'unverified') unverified++;
      if (d.grading_status === 'correct') correct++;
      if (d.grading_status === 'incorrect') { incorrect++; wrongNumbers.push(d.question_id); }
      if (d.marked_uncertain) uncertainNumbers.push(d.question_id);
      if (d.overtime) overtimeNumbers.push(d.question_id);
      totalAnswerSeconds += d.elapsed_seconds;
      totalStaySeconds += d.page_stay_seconds;
    });
    var verifiedAnswered = correct + incorrect;
    var accuracy = verifiedAnswered ? round1((correct / verifiedAnswered) * 100) : null;

    var order = moduleOrder(exam, details);
    var moduleStats = [];
    order.forEach(function (name) {
      var list = details.filter(function (d) { return d.subject === name; });
      if (!list.length) return;
      var mTotal = list.length;
      var mAnswered = 0;
      var mVerified = 0;
      var mCorrect = 0;
      var mAnswerSec = 0;
      var mStaySec = 0;
      list.forEach(function (d) {
        if (d.grading_status !== 'unanswered') mAnswered++;
        if (d.grading_status === 'correct' || d.grading_status === 'incorrect') mVerified++;
        if (d.grading_status === 'correct') mCorrect++;
        mAnswerSec += d.elapsed_seconds;
        mStaySec += d.page_stay_seconds;
      });
      moduleStats.push({
        module: name,
        total: mTotal,
        answered: mAnswered,
        verified: mVerified,
        correct: mCorrect,
        accuracy: mVerified ? round1((mCorrect / mVerified) * 100) : null,
        answer_seconds: mAnswerSec,
        page_stay_seconds: mStaySec
      });
    });

    var practiceDate = toIso(session && session.submittedAt) || toIso(session && session.startedAt) ||
      new Date().toISOString();
    var overtimeLabel = opts.overtime.enabled
      ? '单题作答用时超过 ' + opts.overtime.seconds + ' 秒视为超时（overtime=true）'
      : '本次未启用超时判定（overtime 恒为 false）';

    return {
      exam_id: exam && exam.id != null ? exam.id : null,
      exam_name: (exam && (exam.name || exam.title)) || '',
      exam_year: exam && exam.year != null && isFinite(Number(exam.year)) ? Number(exam.year) : null,
      session_id: (session && session.id != null) ? session.id : null,
      practice_date: practiceDate,
      total: total,
      answered: answered,
      unverified: unverified,
      correct: correct,
      incorrect: incorrect,
      verified_answered: verifiedAnswered,
      accuracy: accuracy,
      module_stats: moduleStats,
      wrong_numbers: wrongNumbers,
      uncertain_numbers: uncertainNumbers,
      overtime_numbers: overtimeNumbers,
      total_answer_seconds: totalAnswerSeconds,
      total_page_stay_seconds: totalStaySeconds,
      paused_count: int(session && session.pausedCount, 0),
      paused_seconds: Math.round(num(session && session.pausedMs) / 1000),
      answer_source: summaryAnswerSource(std),
      methodology: {
        schema_version: SCHEMA_VERSION,
        scope: opts.scope,
        standard_answer_reliability: RELIABILITY,
        rules: {
          unanswered: '未作答（空答案）→ grading_status=unanswered，is_correct=null，不计入正确率',
          unverified: '已作答但该题没有标准答案 → grading_status=unverified，绝不算错，不计入正确率',
          correct_incorrect: '仅当该题存在标准答案时才判定 correct / incorrect',
          multi_choice: '多选必须选项集合完全一致；少选、多选、错选均判 incorrect',
          judge: '判断题按 正确/错误 比对；导入时支持 正确/错误/对/错/√/×/T/F/A/B（A=正确，B=错误）',
          accuracy: 'accuracy = correct / verified_answered × 100（保留 1 位小数）；verified_answered=0 时为 null'
        },
        overtime_threshold_seconds: opts.overtime.enabled ? opts.overtime.seconds : null,
        overtime_rule: overtimeLabel,
        timing: 'elapsed_seconds = 单题作答计时 answerMs / 1000 四舍五入；page_stay_seconds = 单题页面停留 stayMs / 1000 四舍五入；总时长 = 各题之和'
      }
    };
  }

  /**
   * 批改。
   * @param {object} exam  V2 试卷 { id, name, year, questions:[{n,type,module}], modules? }
   * @param {object} session { id, examId, config:{mode,timed,durationSec,module,overtimeSec}, answers, marks, qTime, startedAt, submittedAt, pausedCount, pausedMs }
   * @param {object|null} std AnswerIO.finalize(...) 结果或 { 题号: 答案 } 映射；未导入传 null
   * @param {object} [options] { overtimeSec, scope }  scope: 'exam' | 'session' | 模块名
   * @returns {{summary:object, details:Array}}
   */
  function grade(exam, session, std, options) {
    exam = exam || {};
    session = session || {};
    options = options || {};
    var scopeInfo = resolveScope(exam, session, options);
    var stdData = resolveStd(std);
    var opts = {
      scope: scopeInfo.scope,
      overtime: resolveOvertime(session, options)
    };
    var details = scopeInfo.questions.map(function (q) {
      return buildDetail(q, session, stdData, opts);
    });
    var summary = buildSummary(exam, session, stdData, opts, details);
    return { summary: summary, details: details };
  }

  /* ============================ CSV / JSON 导出 ============================ */

  function csvEscape(v) {
    var s = v == null ? '' : String(v);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function csvLine(values) {
    return values.map(csvEscape).join(',');
  }

  function boolText(v) {
    if (v === true) return 'true';
    if (v === false) return 'false';
    return '';
  }

  function gradeToString(g, session) {
    return g;
  }

  function attemptCsvFromGraded(g, session) {
    var s = g.summary;
    var lines = [ATTEMPT_CSV_HEADER.concat(ATTEMPT_CSV_EXTRA_HEADER).join(',')];
    g.details.forEach(function (d) {
      lines.push(csvLine([
        s.exam_id == null ? '' : s.exam_id,
        s.session_id == null ? '' : s.session_id,
        s.exam_year == null ? '' : s.exam_year,
        d.question_id,
        d.subject,
        d.question_type,
        d.user_answer,
        d.correct_answer,
        d.grading_status,
        boolText(d.is_correct),
        d.elapsed_seconds,
        d.marked_uncertain ? 'true' : 'false',
        d.answer_source,
        d.explanation,
        d.page_stay_seconds,
        d.overtime ? 'true' : 'false'
      ]));
    });
    return lines.join('\r\n');
  }

  function wrongCsvFromGraded(g) {
    var s = g.summary;
    var lines = [WRONG_CSV_HEADER.join(',')];
    g.details.forEach(function (d) {
      if (d.grading_status !== 'incorrect') return;
      lines.push(csvLine([
        s.exam_id == null ? '' : s.exam_id,
        s.session_id == null ? '' : s.session_id,
        s.exam_year == null ? '' : s.exam_year,
        d.question_id,
        d.subject,
        d.question_type,
        d.user_answer,
        d.correct_answer,
        d.grading_status,
        d.elapsed_seconds,
        d.marked_uncertain ? 'true' : 'false',
        d.overtime ? 'true' : 'false',
        d.explanation
      ]));
    });
    return lines.join('\r\n');
  }

  function summaryJsonFromGraded(exam, g) {
    var payload = {
      schema_version: SCHEMA_VERSION,
      generated_at: new Date().toISOString(),
      exam: {
        exam_id: g.summary.exam_id,
        exam_name: g.summary.exam_name,
        exam_year: g.summary.exam_year
      },
      summary: g.summary,
      details: g.details
    };
    return JSON.stringify(payload, null, 2);
  }

  function buildReadme(g) {
    var s = g.summary;
    return [
      '广东省考智能答题卡 V2 — GPT 诊断资料包',
      'schema_version: ' + SCHEMA_VERSION,
      '生成时间: ' + new Date().toISOString(),
      '试卷: ' + (s.exam_name || '') + '（exam_id=' + (s.exam_id == null ? '' : s.exam_id) +
        '，year=' + (s.exam_year == null ? '' : s.exam_year) + '）',
      '作答记录: session_id=' + (s.session_id == null ? '' : s.session_id) +
        '，practice_date=' + s.practice_date,
      '',
      '文件说明：',
      '  attempt_detail.csv   全部题目逐题明细（含未作答、未核实）',
      '  exam_summary.json    试卷与批改汇总（summary）及逐题明细（details），机器可直接解析',
      '  wrong_questions.csv  仅错题（grading_status=incorrect）',
      '',
      '批改口径（重要，供 GPT 分析时遵循）：',
      '  - 标准答案由用户导入，来源未经核实（reliability=user_provided_unverified），仅供自测诊断，不代表官方答案。',
      '  - grading_status 取值: correct / incorrect / unverified / unanswered。',
      '  - unverified = 已作答但没有该题标准答案：绝不算错，也不计入正确率。',
      '  - unanswered = 未作答：不计入正确率。',
      '  - accuracy = correct / verified_answered × 100；无已核实作答时为 null。',
      '  - 多选必须选项完全一致（集合相等）；少选、多选、错选均判 incorrect。',
      '  - ' + s.methodology.overtime_rule + '。',
      '  - 计时口径：elapsed_seconds=单题作答毫秒/1000 四舍五入；page_stay_seconds=单题页面停留毫秒/1000 四舍五入。',
      '',
      'CSV 均为 UTF-8 编码（文件本身未加 BOM）。Excel 直接双击若出现乱码，请用“数据→自文本/CSV”导入并选择 UTF-8。',
      ''
    ].join('\n');
  }

  /* 以下 4 个为对外导出函数，签名与 task-2 描述一致 */
  function buildAttemptCSV(exam, session, std, options) {
    return attemptCsvFromGraded(grade(exam, session, std, options), session);
  }

  function buildSummaryJSON(exam, session, std, options) {
    return summaryJsonFromGraded(exam, grade(exam, session, std, options));
  }

  function buildWrongQuestionsCSV(exam, session, std, options) {
    return wrongCsvFromGraded(grade(exam, session, std, options));
  }

  /**
   * 生成 GPT 诊断 zip（Uint8Array）。内含 4 个文件：
   * attempt_detail.csv / exam_summary.json / wrong_questions.csv / README.txt
   */
  function buildDiagnosisZip(exam, session, std, options) {
    var fflate = getLib('fflate', './libs/fflate.umd.js');
    if (!fflate || typeof fflate.zipSync !== 'function') {
      throw new Error('fflate 组件未加载：请先引入 libs/fflate.umd.js');
    }
    var enc = (typeof fflate.strToU8 === 'function')
      ? fflate.strToU8
      : function (str) {
        if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
        throw new Error('当前环境缺少 TextEncoder，无法编码文本');
      };
    var g = grade(exam, session, std, options);
    var files = {
      'attempt_detail.csv': enc(attemptCsvFromGraded(g, session)),
      'exam_summary.json': enc(summaryJsonFromGraded(exam, g)),
      'wrong_questions.csv': enc(wrongCsvFromGraded(g)),
      'README.txt': enc(buildReadme(g))
    };
    return fflate.zipSync(files, { level: 6 });
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    ATTEMPT_CSV_HEADER: ATTEMPT_CSV_HEADER,
    grade: grade,
    buildAttemptCSV: buildAttemptCSV,
    buildSummaryJSON: buildSummaryJSON,
    buildWrongQuestionsCSV: buildWrongQuestionsCSV,
    buildDiagnosisZip: buildDiagnosisZip,
    normAnswer: normAnswer,
    normJudge: normJudge,
    normType: normType,
    getExamQuestions: getExamQuestions
  };
});
