/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright 2026 ExamCard contributors */
/* ExamCard · 每日学习计划 JSON/CSV v1 导入引擎（本地，无上传） */
(function (root) {
  'use strict';
  var SCHEMA = 'examcard.daily-plan/v1';
  var TZ = 'Asia/Shanghai';
  var CSV_COLUMNS = [
    'plan_id', 'date', 'timezone', 'exam_type', 'task_id', 'subject', 'topic', 'priority',
    'start', 'end', 'planned_minutes', 'learning_mode',
    'course_topic', 'course_provider', 'course_video_title', 'course_url', 'course_verified',
    'material_name', 'material_chapter', 'material_pages',
    'video_minutes', 'examples_minutes', 'examples_count', 'practice_minutes',
    'practice_question_count', 'question_set_id', 'review_minutes',
    'target_correct', 'target_total', 'require_error_review'
  ];
  var TOP_FIELDS = ['schema_version', 'plan_id', 'date', 'timezone', 'exam_type', 'status', 'title', 'goal', 'mem_suspended', 'schedule', 'tasks'];
  var TASK_FIELDS = ['task_id', 'subject', 'topic', 'priority', 'start', 'end', 'planned_minutes', 'learning_mode', 'course', 'material', 'stages', 'acceptance'];
  var STAGE_TYPES = ['video', 'examples', 'practice', 'review', 'mock', 'reading', 'other'];
  var STATUSES = ['planned', 'active', 'paused', 'completed', 'cancelled'];
  var PRIORITIES = ['high', 'normal', 'low'];
  var MODES = ['course_first', 'mock', 'practice', 'review', 'textbook', 'other'];
  var MODE_LABEL = { course_first: '听课优先', mock: '模考', practice: '刷题', review: '错题复盘', textbook: '教材阅读', other: '其他' };
  var STAGE_LABEL = { video: '听课', examples: '教材例题', practice: '限时练习', review: '错题复盘', mock: '模考', reading: '阅读', other: '其他' };

  function esc(s) { return String(s == null ? '' : s); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function err(list, path, message) { list.push({ path: path, message: message }); }
  function isDate(s) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false; var d = new Date(String(s) + 'T00:00:00Z'); return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; }
  function isTime(s) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || '')); }
  function minutes(s) { var p = String(s || '').split(':').map(Number); return p.length === 2 ? p[0] * 60 + p[1] : NaN; }
  function isInt(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n; }
  function checkUnknown(obj, allowed, path, errors) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { err(errors, path, '应为对象'); return; }
    Object.keys(obj).forEach(function (k) { if (allowed.indexOf(k) < 0) err(errors, path + '.' + k, '未知字段'); });
  }
  function safeUrl(u) {
    if (u == null || u === '') return true;
    try { var x = new URL(String(u)); return x.protocol === 'https:' || x.protocol === 'http:'; } catch (e) { return false; }
  }
  function safeText(s, path, errors, max) {
    if (s != null && (typeof s !== 'string' || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s))) err(errors, path, '文本含不支持字符');
    if (s != null && String(s).length > (max || 4000)) err(errors, path, '文本过长');
  }
  function canonical(v) {
    if (v == null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
    return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canonical(v[k]); }).join(',') + '}';
  }
  function hash(text) {
    var h = 2166136261;
    for (var i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  }
  function stableTaskId(planId, taskId) {
    var raw = 'dp-' + String(planId || '') + '-' + String(taskId || '');
    if (raw.length <= 160) return raw;
    return 'dp-' + hash(raw) + '-' + hash(raw + '|salt');
  }

  function validatePlan(plan) {
    var errors = [];
    checkUnknown(plan, TOP_FIELDS, 'plan', errors);
    if (plan.schema_version !== SCHEMA) err(errors, 'schema_version', '必须为 ' + SCHEMA);
    if (!plan.plan_id || typeof plan.plan_id !== 'string' || plan.plan_id.length > 120) err(errors, 'plan_id', 'plan_id 必填且不超过 120 字符');
    if (!isDate(plan.date)) err(errors, 'date', '日期必须为 YYYY-MM-DD');
    if (plan.timezone !== TZ) err(errors, 'timezone', '时区必须为 ' + TZ);
    if (!plan.exam_type || typeof plan.exam_type !== 'string' || plan.exam_type.length > 40) err(errors, 'exam_type', '考试类别必填');
    if (STATUSES.indexOf(plan.status) < 0) err(errors, 'status', '状态必须为 ' + STATUSES.join('/'));
    if (!plan.title || typeof plan.title !== 'string') err(errors, 'title', '计划标题必填');
    safeText(plan.title, 'title', errors, 300);
    if (typeof plan.goal !== 'string') err(errors, 'goal', '计划目标必须为字符串'); else safeText(plan.goal, 'goal', errors, 2000);
    if (typeof plan.mem_suspended !== 'boolean') err(errors, 'mem_suspended', '必须为布尔值');
    if (!Array.isArray(plan.schedule)) err(errors, 'schedule', '必须为数组');
    if (Array.isArray(plan.schedule)) {
      plan.schedule.forEach(function (b, i) {
        checkUnknown(b, ['start', 'end', 'kind', 'label'], 'schedule[' + i + ']', errors);
        if (!isTime(b.start) || !isTime(b.end)) err(errors, 'schedule[' + i + ']', '开始/结束时间应为 HH:MM');
        else if (minutes(b.end) <= minutes(b.start)) err(errors, 'schedule[' + i + ']', '结束时间必须晚于开始时间');
        if (b.kind && ['task', 'break', 'rest'].indexOf(b.kind) < 0) err(errors, 'schedule[' + i + '].kind', '类型无效');
        safeText(b.label, 'schedule[' + i + '].label', errors, 120);
      });
    }
    if (!Array.isArray(plan.tasks) || !plan.tasks.length) { err(errors, 'tasks', '至少包含一个任务'); return errors; }
    var ids = {};
    var intervals = [];
    plan.tasks.forEach(function (t, i) {
      var p = 'tasks[' + i + ']';
      checkUnknown(t, TASK_FIELDS, p, errors);
      ['task_id','subject','topic','priority','start','end','planned_minutes','learning_mode','course','material','stages','acceptance'].forEach(function (k) { if (!has(t, k)) err(errors, p + '.' + k, '缺少必需字段'); });
      if (!t.task_id || typeof t.task_id !== 'string' || t.task_id.length > 120) err(errors, p + '.task_id', 'task_id 必填且不超过 120 字符');
      if (ids[t.task_id]) err(errors, p + '.task_id', 'task_id 重复');
      ids[t.task_id] = true;
      safeText(t.subject, p + '.subject', errors, 200);
      if (!t.topic || typeof t.topic !== 'string') err(errors, p + '.topic', 'topic 必填'); else safeText(t.topic, p + '.topic', errors, 1000);
      if (PRIORITIES.indexOf(t.priority) < 0) err(errors, p + '.priority', '优先级必须为 high/normal/low');
      if (!isTime(t.start)) err(errors, p + '.start', '开始时间应为 HH:MM');
      if (!isTime(t.end)) err(errors, p + '.end', '结束时间应为 HH:MM');
      if (isTime(t.start) && isTime(t.end)) {
        if (minutes(t.end) <= minutes(t.start)) err(errors, p + '.end', '结束时间必须晚于开始时间');
        else intervals.push({ start: minutes(t.start), end: minutes(t.end), i: i });
      }
      if (!isInt(t.planned_minutes) || t.planned_minutes < 0 || t.planned_minutes > 1440) err(errors, p + '.planned_minutes', '计划分钟应为 0~1440 的整数');
      if (MODES.indexOf(t.learning_mode) < 0) err(errors, p + '.learning_mode', 'learning_mode 无效');
      if (t.course != null) {
        checkUnknown(t.course, ['id', 'topic', 'provider', 'video_title', 'url', 'verified'], p + '.course', errors);
        if (!safeUrl(t.course.url)) err(errors, p + '.course.url', '课程链接仅允许 http/https');
        safeText(t.course.topic, p + '.course.topic', errors, 300);
        safeText(t.course.video_title, p + '.course.video_title', errors, 300);
        if (t.course.verified != null && typeof t.course.verified !== 'boolean') err(errors, p + '.course.verified', 'verified 必须为布尔值');
      }
      if (t.material != null) {
        checkUnknown(t.material, ['name', 'chapter', 'pages', 'textbook_id', 'chapter_id'], p + '.material', errors);
        safeText(t.material.name, p + '.material.name', errors, 300);
        safeText(t.material.chapter, p + '.material.chapter', errors, 300);
        safeText(t.material.pages, p + '.material.pages', errors, 100);
      }
      if (t.stages != null && !Array.isArray(t.stages)) err(errors, p + '.stages', '必须为数组');
      if (Array.isArray(t.stages)) {
        var sum = 0;
        t.stages.forEach(function (s, j) {
          var sp = p + '.stages[' + j + ']';
          checkUnknown(s, ['type', 'minutes', 'count', 'question_set_id'], sp, errors);
          if (STAGE_TYPES.indexOf(s.type) < 0) err(errors, sp + '.type', '阶段类型无效');
          if (!isInt(s.minutes) || s.minutes < 0) err(errors, sp + '.minutes', '阶段分钟应为非负整数'); else sum += s.minutes;
          if (s.count != null && (!isInt(s.count) || s.count < 0)) err(errors, sp + '.count', '数量应为非负整数');
          safeText(s.question_set_id, sp + '.question_set_id', errors, 120);
        });
        if (t.learning_mode === 'course_first') {
          var seq = t.stages.map(function (s) { return s.type; }).join(',');
          if (seq !== 'video,examples,practice,review') err(errors, p + '.stages', 'course_first 阶段必须为 video → examples → practice → review');
          if (isInt(t.planned_minutes) && sum !== t.planned_minutes) err(errors, p + '.stages', '四个阶段分钟合计必须等于 planned_minutes');
        } else if (isInt(t.planned_minutes) && sum !== t.planned_minutes && t.stages.length) {
          err(errors, p + '.stages', '阶段分钟合计必须等于 planned_minutes');
        }
      } else if (t.learning_mode === 'course_first') err(errors, p + '.stages', 'course_first 需要四阶段');
      if (t.acceptance != null) {
        checkUnknown(t.acceptance, ['target_correct', 'target_total', 'require_error_review'], p + '.acceptance', errors);
        var tc = t.acceptance.target_correct, tt = t.acceptance.target_total;
        if (tc != null && (!isInt(tc) || tc < 0)) err(errors, p + '.acceptance.target_correct', '目标正确题数应为非负整数');
        if (tt != null && (!isInt(tt) || tt < 0)) err(errors, p + '.acceptance.target_total', '目标总题数应为非负整数');
        if (tc != null && tt != null && tc > tt) err(errors, p + '.acceptance.target_correct', '目标正确题数不能超过总题数');
        if (t.acceptance.require_error_review != null && typeof t.acceptance.require_error_review !== 'boolean') err(errors, p + '.acceptance.require_error_review', '必须为布尔值');
      }
    });
    intervals.sort(function (a, b) { return a.start - b.start; });
    for (var k = 1; k < intervals.length; k++) if (intervals[k].start < intervals[k - 1].end) err(errors, 'tasks[' + intervals[k].i + ']', '任务时间与另一任务冲突');
    if (Array.isArray(plan.schedule)) {
      plan.schedule.forEach(function (b, bi) {
        if (b.kind === 'break' || b.kind === 'rest') {
          intervals.forEach(function (iv) {
            if (minutes(b.start) < iv.end && minutes(b.end) > iv.start) err(errors, 'schedule[' + bi + ']', '休息时间与任务冲突');
          });
        }
      });
    }
    return errors;
  }

  function normalizePlan(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('计划顶层必须是对象');
    var plan = JSON.parse(JSON.stringify(obj));
    plan.tasks = (plan.tasks || []).map(function (t) {
      var x = Object.assign({}, t);
      x.course = x.course == null ? null : Object.assign({}, x.course);
      x.material = x.material == null ? null : Object.assign({}, x.material);
      x.stages = Array.isArray(x.stages) ? x.stages.map(function (s) { return Object.assign({}, s); }) : x.stages;
      x.acceptance = x.acceptance == null ? null : Object.assign({}, x.acceptance);
      return x;
    });
    return plan;
  }

  function normalizeLegacy(raw) {
    var p = JSON.parse(JSON.stringify(raw || {}));
    if (p.schedule == null) p.schedule = [];
    if (p.schedule && !Array.isArray(p.schedule) && typeof p.schedule === 'object') {
      if (Array.isArray(p.schedule.items)) p.schedule = p.schedule.items;
      else if (Array.isArray(p.schedule.blocks)) p.schedule = p.schedule.blocks;
      else if (p.schedule.start && p.schedule.end) p.schedule = [p.schedule];
      else p.schedule = [];
    }
    var pmap = { 1: 'high', 2: 'normal', 3: 'low', '高': 'high', '中': 'normal', '低': 'low' };
    var emap = { '广东': 'gd', '广东省考': 'gd', 'gd': 'gd', '深圳': 'sz', '深圳市考': 'sz', 'sz': 'sz', '国考': 'national', 'national': 'national' };
    p.exam_type = emap[String(p.exam_type || '').trim()] || p.exam_type;
    (p.tasks || []).forEach(function (task) {
      if (pmap[task.priority] != null) task.priority = pmap[task.priority];
      var modeMap = { 'course-first': 'course_first', 'courseFirst': 'course_first', 'course_first': 'course_first', 'exam': 'mock', 'mock_exam': 'mock' };
      if (modeMap[task.learning_mode]) task.learning_mode = modeMap[task.learning_mode];
      if (Array.isArray(task.stages)) task.stages = task.stages.map(function (s) {
        var out = Object.assign({}, s);
        if (out.minutes == null && out.duration_minutes != null) out.minutes = out.duration_minutes;
        if (out.minutes == null && out.planned_minutes != null) out.minutes = out.planned_minutes;
        if (out.count == null && out.question_count != null) out.count = out.question_count;
        delete out.duration_minutes; delete out.planned_minutes; delete out.question_count;
        return out;
      });
    });
    return p;
  }

  function parseJson(text) {
    var obj;
    try { obj = JSON.parse(text); } catch (e) { var er = new Error('JSON 解析失败：' + e.message); er.details = [{ path: '$', message: 'JSON 语法错误' }]; throw er; }
    return normalizePlan(normalizeLegacy(obj));
  }

  function parseCsvRows(text) {
    var s = String(text || '').replace(/^\uFEFF/, '');
    var rows = [], row = [], field = '', quoted = false;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (quoted) {
        if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
        else field += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && s[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some(function (x) { return String(x).trim() !== ''; })) rows.push(row);
        row = [];
      } else field += ch;
    }
    if (quoted) throw new Error('CSV 引号未闭合');
    if (field !== '' || row.length) { row.push(field); if (row.some(function (x) { return String(x).trim() !== ''; })) rows.push(row); }
    return rows;
  }

  function parseCsv(text) {
    var rows = parseCsvRows(text);
    if (!rows.length) throw new Error('CSV 为空');
    var header = rows[0].map(function (h) { return String(h || '').trim(); });
    if (header.some(function (h) { return !h; })) throw new Error('CSV 表头存在空列');
    var seen = {};
    header.forEach(function (h) { if (seen[h]) throw new Error('CSV 表头重复列：' + h); seen[h] = true; });
    var unknown = header.filter(function (h) { return CSV_COLUMNS.indexOf(h) < 0; });
    if (unknown.length) { var e = new Error('CSV 包含未知列：' + unknown.join('、')); e.details = unknown.map(function (h) { return { path: 'csv.' + h, message: '未知列' }; }); throw e; }
    var required = ['plan_id', 'date', 'timezone', 'exam_type', 'task_id', 'subject', 'topic', 'priority', 'start', 'end', 'planned_minutes', 'learning_mode'];
    required.forEach(function (h) { if (header.indexOf(h) < 0) throw new Error('CSV 缺少必需列：' + h); });
    var objs = [];
    for (var r = 1; r < rows.length; r++) {
      if (rows[r].every(function (x) { return String(x).trim() === ''; })) continue;
      if (rows[r].length !== header.length) throw new Error('CSV 第 ' + (r + 1) + ' 行列数与表头不一致（' + rows[r].length + ' / ' + header.length + '）');
      var o = {};
      header.forEach(function (h, i) { o[h] = rows[r][i] == null ? '' : String(rows[r][i]); });
      objs.push(o);
    }
    if (!objs.length) throw new Error('CSV 没有数据行');
    var planIds = {};
    objs.forEach(function (o) { planIds[o.plan_id] = true; });
    var pids = Object.keys(planIds);
    if (pids.length > 1) throw new Error('v1 一个 CSV 只能包含一个 plan_id；请按计划分文件导入');
    var first = objs[0];
    [['date', first.date], ['timezone', first.timezone], ['exam_type', first.exam_type]].forEach(function (pair) {
      objs.forEach(function (o, i) { if (o[pair[0]] !== pair[1]) throw new Error('CSV 第 ' + (i + 2) + ' 行的 ' + pair[0] + ' 与首行不一致'); });
    });
    var isTrue = function (v) { return /^(true|1|yes|y|是)$/i.test(String(v || '').trim()); };
    var num = function (v) { if (v === '' || v == null) return null; var n = Number(v); return isFinite(n) ? n : NaN; };
    var plan = {
      schema_version: SCHEMA, plan_id: first.plan_id, date: first.date, timezone: first.timezone,
      exam_type: first.exam_type, status: 'planned',
      title: first.date + ' ' + (first.exam_type || '学习') + '计划', goal: '', mem_suspended: false,
      schedule: [], tasks: []
    };
    plan.tasks = objs.map(function (o, i) {
      var t = {
        task_id: o.task_id, subject: o.subject, topic: o.topic, priority: o.priority,
        start: o.start, end: o.end, planned_minutes: num(o.planned_minutes), learning_mode: o.learning_mode,
        course: null, material: null, stages: [], acceptance: {}
      };
      if (o.course_topic || o.course_provider || o.course_video_title || o.course_url) {
        t.course = { topic: o.course_topic || null, provider: o.course_provider || null, video_title: o.course_video_title || null, url: o.course_url || null, verified: isTrue(o.course_verified) };
      }
      if (o.material_name || o.material_chapter || o.material_pages) {
        t.material = { name: o.material_name || null, chapter: o.material_chapter || null, pages: o.material_pages || null };
      }
      var vm = num(o.video_minutes), em = num(o.examples_minutes), pm = num(o.practice_minutes), rm = num(o.review_minutes);
      if ([vm, em, pm, rm].some(function (x) { return x != null; })) {
        t.stages = [
          { type: 'video', minutes: vm || 0 },
          { type: 'examples', minutes: em || 0, count: num(o.examples_count) },
          { type: 'practice', minutes: pm || 0, count: num(o.practice_question_count), question_set_id: o.question_set_id || null },
          { type: 'review', minutes: rm || 0 }
        ];
      } else if (t.learning_mode === 'course_first') {
        throw new Error('CSV 第 ' + (i + 2) + ' 行缺少四阶段分钟');
      }
      if ([t.acceptance.target_correct = num(o.target_correct), t.acceptance.target_total = num(o.target_total), t.acceptance.require_error_review = isTrue(o.require_error_review)][0] == null &&
          t.acceptance.target_total == null && !t.acceptance.require_error_review) t.acceptance = null;
      return t;
    });
    plan = normalizeLegacy(plan);
    var errors = validatePlan(plan);
    if (errors.length) { var ee = new Error('CSV 校验失败：' + errors[0].path + ' ' + errors[0].message); ee.details = errors; throw ee; }
    return plan;
  }

  function parseText(text, filename) {
    var name = String(filename || '').toLowerCase();
    var trimmed = String(text || '').replace(/^\uFEFF/, '').trim();
    if (name.endsWith('.json') || (!name.endsWith('.csv') && trimmed[0] === '{')) {
      var plan = parseJson(text);
      var errors = validatePlan(plan);
      if (errors.length) { var e = new Error('计划校验失败：' + errors[0].path + ' ' + errors[0].message); e.details = errors; throw e; }
      return plan;
    }
    return parseCsv(text);
  }

  function typeForMode(mode) {
    if (mode === 'course_first') return 'course';
    if (mode === 'mock') return 'mock';
    if (mode === 'review') return 'retest';
    if (mode === 'practice') return 'questions';
    if (mode === 'textbook') return 'textbook';
    return 'other';
  }
  function planQuestions(t) {
    var p = (t.stages || []).filter(function (s) { return s.type === 'practice'; })[0];
    if (p && p.count != null) return p.count;
    if (t.acceptance && t.acceptance.target_total != null) return t.acceptance.target_total;
    return null;
  }
  function findCourse(t, courses) {
    if (!t.course) return { course: null, suggestion: null, reason: null };
    if (t.course.id) {
      var byId = courses.filter(function (c) { return c.id === t.course.id; })[0] || null;
      if (byId) return { course: byId, suggestion: null, reason: 'id' };
    }
    var key = String(t.course.video_title || t.course.topic || '').trim();
    if (!key) return { course: null, suggestion: null, reason: null };
    var exact = courses.filter(function (c) { return String(c.name || '').trim() === key; });
    if (exact.length === 1) return { course: exact[0], suggestion: null, reason: 'exact' };
    if (exact.length > 1) return { course: null, suggestion: null, reason: 'ambiguous' };
    var partial = courses.filter(function (c) { var n = String(c.name || '').trim(); return n && (key.indexOf(n) >= 0 || n.indexOf(key) >= 0); });
    return { course: null, suggestion: partial.length === 1 ? partial[0] : null, reason: partial.length > 1 ? 'ambiguous' : (partial.length === 1 ? 'suggest' : null) };
  }
  function findMaterial(t, textbooks, chapters) {
    if (!t.material) return { textbook: null, chapter: null, reason: null };
    var tb = null, ch = null, reason = null;
    if (t.material.textbook_id) {
      tb = textbooks.filter(function (b) { return b.id === t.material.textbook_id; })[0] || null;
      if (tb) reason = 'id';
    }
    if (t.material.chapter_id) {
      ch = chapters.filter(function (c) { return c.id === t.material.chapter_id; })[0] || null;
      if (ch && !tb) { tb = textbooks.filter(function (b) { return b.id === ch.textbookId; })[0] || null; }
      if (ch) reason = 'id';
    }
    if (!tb && t.material.name) {
      var same = textbooks.filter(function (b) { return String(b.name || '').trim() === String(t.material.name).trim(); });
      if (same.length === 1) { tb = same[0]; reason = reason || 'exact'; }
      else if (same.length > 1) reason = 'ambiguous';
    }
    if (tb && !ch && t.material.chapter) {
      var cs = chapters.filter(function (c) { return c.textbookId === tb.id && String(c.title || '').trim() === String(t.material.chapter).trim(); });
      if (cs.length === 1) ch = cs[0];
    }
    return { textbook: tb, chapter: ch, reason: reason };
  }
  function prepare(plan, ctx) {
    ctx = ctx || {};
    var tasks = ctx.tasks || [], textbooks = ctx.textbooks || [], chapters = ctx.chapters || [], courses = ctx.courses || [], exams = ctx.exams || [];
    var warnings = [];
    var records = [];
    var planHash = hash(canonical(plan));
    plan.tasks.forEach(function (t) {
      var existing = tasks.filter(function (x) { return x.planId === plan.plan_id && x.planTaskId === t.task_id; })[0];
      var cm = findCourse(t, courses), course = cm.course;
      var mat = findMaterial(t, textbooks, chapters);
      var questionSet = null;
      var qid = ((t.stages || []).filter(function (s) { return s.type === 'practice'; })[0] || {}).question_set_id || null;
      if (qid) {
        var qExact = exams.filter(function (e) { return e.id === qid; }).length ? exams.filter(function (e) { return e.id === qid; }) : exams.filter(function (e) { return e.name === qid; });
        if (qExact.length === 1) questionSet = qExact[0];
        else if (qExact.length > 1) warnings.push('题目集同名多个，待选择：' + qid);
      }
      if (t.course && !course) {
        if (cm.reason === 'suggest' && cm.suggestion) warnings.push('课程可能匹配：' + (t.course.video_title || t.course.topic || '') + ' → ' + (cm.suggestion.name || '') + '（需手动确认）');
        else if (cm.reason === 'ambiguous') warnings.push('课程同名多个，待选择：' + (t.course.video_title || t.course.topic || ''));
        else warnings.push('课程未关联：' + (t.course.video_title || t.course.topic || ''));
      }
      if (t.material && t.material.name && !mat.textbook) {
        if (mat.reason === 'ambiguous') warnings.push('教材同名多个版本，待选择：' + t.material.name);
        else warnings.push('教材未关联：' + t.material.name);
      }
      if (qid && !questionSet && !warnings.some(function (w) { return w.indexOf('题目集同名多个') >= 0; })) warnings.push('题目集未关联：' + qid);
      var rec = {
        id: existing ? existing.id : stableTaskId(plan.plan_id, t.task_id),
        planId: plan.plan_id, planTaskId: t.task_id, planSchema: SCHEMA,
        planTitle: plan.title, planGoal: plan.goal || '', planDate: plan.date, timezone: plan.timezone,
        examType: plan.exam_type, planStatus: plan.status, memSuspended: !!plan.mem_suspended,
        title: t.topic, subject: t.subject, topic: t.topic, type: typeForMode(t.learning_mode),
        date: plan.date, time: t.start, dueDate: plan.date, priority: t.priority,
        start: t.start, end: t.end, learningMode: t.learning_mode, stages: t.stages || [],
        acceptance: t.acceptance || null, courseInfo: t.course || null, materialInfo: t.material || null,
        planMinutes: t.planned_minutes, planQuestions: planQuestions(t),
        courseId: course ? course.id : null, courseSuggestionId: cm.suggestion ? cm.suggestion.id : null, courseMatchReason: cm.reason,
        textbookId: mat.textbook ? mat.textbook.id : null, materialMatchReason: mat.reason,
        chapterId: mat.chapter ? mat.chapter.id : null, examId: questionSet ? questionSet.id : null,
        planSource: 'daily-plan-v1', planHash: planHash, taskHash: hash(canonical(t)),
        stageActuals: existing && Array.isArray(existing.stageActuals) ? existing.stageActuals : [],
        imports: { source: ctx.source || null, file: ctx.filename || null, at: Date.now() },
        status: existing ? existing.status : 'pending', createdAt: existing ? existing.createdAt : Date.now()
      };
      rec.duplicate = existing ? (existing.taskHash === rec.taskHash && existing.planHash === rec.planHash ? 'same' : 'changed') : 'new';
      rec.completed = !!(existing && existing.status === 'completed');
      records.push(rec);
    });
    return { plan: plan, records: records, warnings: warnings, planHash: planHash };
  }

  function jsonTemplate() {
    var d = new Date(Date.now() + 8 * 3600 * 1000);
    var date = d.toISOString().slice(0, 10);
    var plan = {
      schema_version: SCHEMA, plan_id: 'demo-' + date.replace(/-/g, ''), date: date, timezone: TZ,
      exam_type: 'gd', status: 'planned', title: '每日学习计划示例', goal: '示例计划，可修改日期和内容后导入；不代表真实完成记录。',
      mem_suspended: false, schedule: [],
      tasks: [{
        task_id: 'demo-01', subject: '资料分析', topic: '增长率与比重综合练习', priority: 'high',
        start: '09:00', end: '10:30', planned_minutes: 90, learning_mode: 'course_first',
        course: { topic: '资料分析基础', provider: '示例课程平台', video_title: '增长率与比重', url: 'https://example.com/course/demo', verified: false },
        material: { name: '示例教材', chapter: '第一章 资料分析', pages: null },
        stages: [
          { type: 'video', minutes: 15 },
          { type: 'examples', minutes: 20, count: 5 },
          { type: 'practice', minutes: 40, count: 20, question_set_id: null },
          { type: 'review', minutes: 15 }
        ],
        acceptance: { target_correct: 16, target_total: 20, require_error_review: true }
      }]
    };
    return JSON.stringify(plan, null, 2);
  }

  function planToCsv(plan) {
    var rows = [];
    rows.push(CSV_COLUMNS.join(','));
    (plan.tasks || []).forEach(function (t) {
      var stages = {}; (t.stages || []).forEach(function (s) { stages[s.type] = s; });
      var c = t.course || {}, m = t.material || {}, a = t.acceptance || {};
      var vals = {
        plan_id: plan.plan_id, date: plan.date, timezone: plan.timezone, exam_type: plan.exam_type,
        task_id: t.task_id, subject: t.subject, topic: t.topic, priority: t.priority,
        start: t.start, end: t.end, planned_minutes: t.planned_minutes, learning_mode: t.learning_mode,
        course_topic: c.topic || '', course_provider: c.provider || '', course_video_title: c.video_title || '',
        course_url: c.url || '', course_verified: c.verified ? 'true' : 'false',
        material_name: m.name || '', material_chapter: m.chapter || '', material_pages: m.pages || '',
        video_minutes: stages.video ? stages.video.minutes : '',
        examples_minutes: stages.examples ? stages.examples.minutes : '',
        examples_count: stages.examples && stages.examples.count != null ? stages.examples.count : '',
        practice_minutes: stages.practice ? stages.practice.minutes : '',
        practice_question_count: stages.practice && stages.practice.count != null ? stages.practice.count : '',
        question_set_id: stages.practice && stages.practice.question_set_id || '',
        review_minutes: stages.review ? stages.review.minutes : '',
        target_correct: a.target_correct == null ? '' : a.target_correct,
        target_total: a.target_total == null ? '' : a.target_total,
        require_error_review: a.require_error_review ? 'true' : 'false'
      };
      rows.push(CSV_COLUMNS.map(function (h) { var v = vals[h] == null ? '' : String(vals[h]); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','));
    });
    return '\uFEFF' + rows.join('\r\n') + '\r\n';
  }

  function csvTemplate() { return planToCsv(JSON.parse(jsonTemplate())); }

  root.DailyPlanImport = {
    SCHEMA: SCHEMA, TZ: TZ, CSV_COLUMNS: CSV_COLUMNS, MODE_LABEL: MODE_LABEL, STAGE_LABEL: STAGE_LABEL,
    parseText: parseText, parseJson: parseJson, parseCsv: parseCsv, validatePlan: validatePlan,
    prepare: prepare, jsonTemplate: jsonTemplate, csvTemplate: csvTemplate, planToCsv: planToCsv,
    stableTaskId: stableTaskId, typeForMode: typeForMode
  };
})(typeof window !== 'undefined' ? window : globalThis);
