/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright 2026 ExamCard contributors */
/*!
 * 广东省考智能答题卡 V2 — 标准答案导入模块（answer-io.js）
 * ------------------------------------------------------------------
 * 全局 UMD：
 *   浏览器：<script src="answer-io.js"></script> 后使用 window.AnswerIO
 *   Node  ：const AnswerIO = require('./answer-io.js')
 *
 * 依赖：解析 XLSX 时需要全局 XLSX（libs/xlsx.full.min.js / SheetJS）；
 *       其余格式（CSV / JSON / PDF 文本行）零依赖。
 *
 * 对外 API：
 *   AnswerIO.parseFile(file, exam, ctx) -> Promise<{rows, issues, source}>
 *   AnswerIO.finalize(rows, exam[, sourceOverride]) -> {answers, explanations, verifiedNumbers, coverage, issues, source}
 *   AnswerIO.normAnswer(raw, type)、normJudge(raw)、normType(t)
 *   AnswerIO.validateRows(rows, exam) -> {rows, issues, stats, total}
 *   AnswerIO.getExamQuestions(exam) -> [{n, type, module, page}]
 *   AnswerIO.splitCsvLine(line) -> string[]
 *   AnswerIO.STATUS / RELIABILITY / VERSION
 *
 * 数据结构约定（与 V2 task-2 / task-3 保持一致）：
 *   exam = {
 *     id, name, year,
 *     questions: [{ n, type:'single'|'judge'|'multi', module, page, ... }],
 *     modules:   [{ name, start, end, page }]        // 可选，questions 缺字段时回退
 *   }
 *   rows = [{ n, answerRaw, answerNorm, explanation, status, message }]
 *     status ∈ 'ok' | 'missing' | 'duplicate' | 'invalid' | 'type_conflict'
 *   parseFile 的 issues 覆盖全部非 ok 题目 + 解析告警；finalize 只写入 status==='ok' 的答案。
 */
(function (root, factory) {
  var api = factory(root);
  if (root) {
    try { root.AnswerIO = api; } catch (e) { /* ignore */ }
  }
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis
  : typeof self !== 'undefined' ? self
    : typeof window !== 'undefined' ? window
      : this, function (root) {
  'use strict';

  var VERSION = '2.0.0';
  var RELIABILITY = 'user_provided_unverified';
  var STATUS = {
    OK: 'ok',
    MISSING: 'missing',
    DUPLICATE: 'duplicate',
    INVALID: 'invalid',
    TYPE_CONFLICT: 'type_conflict'
  };
  var TYPE_LABEL = { single: '单选', judge: '判断', multi: '多选' };

  /* ============================ 通用工具 ============================ */

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

  function rawToString(v) {
    if (v == null) return '';
    if (Array.isArray(v)) {
      return v.map(function (x) { return String(x == null ? '' : x).trim(); })
        .filter(function (x) { return x !== ''; }).join('');
    }
    return String(v).trim();
  }

  function nfkc(v) {
    var s = v == null ? '' : String(v);
    try { if (typeof s.normalize === 'function') s = s.normalize('NFKC'); } catch (e) { /* ignore */ }
    return s;
  }

  function stripBom(s) {
    if (typeof s !== 'string') return '';
    return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s;
  }

  function typeLabel(t) { return TYPE_LABEL[t] || t || ''; }

  function defineHidden(obj, key, value) {
    try {
      Object.defineProperty(obj, key, { value: value, enumerable: false, writable: true, configurable: true });
    } catch (e) {
      try { obj[key] = value; } catch (e2) { /* ignore */ }
    }
  }

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

  var _nodeRequire = (typeof require === 'function') ? require : null;

  /* ============================ 题型 / 答案规范化 ============================ */

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

  // 判断题独有标记（A/B 与单选选项歧义，不视为“判断题标记”）
  function isDistinctJudgeToken(raw) {
    var txt = Array.isArray(raw) ? raw.map(toText).join('') : raw;
    if (!normJudge(txt)) return false;
    var s = nfkc(txt).replace(/[\s\u3000]+/g, '').toUpperCase();
    return !(s === 'A' || s === 'B');
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

  /**
   * 答案规范化（唯一标准形式）：
   *   单选 -> 'A'..'D'（异常输入返回多字母串，供校验识别）
   *   多选 -> 'AC'（大写、去重、升序；与输入顺序无关）
   *   判断 -> '正确' | '错误'（支持 正确/错误/对/错/√/×/T/F/A/B 等）
   */
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

  /**
   * 校验一个“题号 -> 答案”记录。
   * @returns {{answerNorm:string, status:string, message:string}}
   */
  function validateAnswer(raw, declaredType, q) {
    var type = q.type;
    var declared = normType(declaredType);
    if (declared && declared !== type) {
      return {
        answerNorm: normAnswer(raw, type),
        status: STATUS.TYPE_CONFLICT,
        message: '题型冲突：文件标注为' + typeLabel(declared) + '题，试卷第 ' + q.n + ' 题为' + typeLabel(type) + '题'
      };
    }
    if (isBlank(raw)) {
      return { answerNorm: '', status: STATUS.MISSING, message: '第 ' + q.n + ' 题答案为空' };
    }
    var simple = Array.isArray(raw) ? raw.map(toText).join('') : raw;
    if (type === 'judge') {
      var j = normJudge(simple);
      if (j) return { answerNorm: j, status: STATUS.OK, message: '' };
      var letters = cleanChoice(simple).replace(/[^A-D]/g, '');
      if (letters.length >= 2) {
        return {
          answerNorm: '',
          status: STATUS.TYPE_CONFLICT,
          message: '题型冲突：试卷第 ' + q.n + ' 题为判断题，但答案包含多个选项（' + rawToString(raw) + '）'
        };
      }
      return {
        answerNorm: '',
        status: STATUS.INVALID,
        message: '答案无效：判断题无法识别“' + rawToString(raw) + '”（应为 正确/错误/对/错/√/×/T/F/A/B）'
      };
    }
    var s = cleanChoice(simple);
    if (!s) {
      if (isDistinctJudgeToken(simple)) {
        return {
          answerNorm: '',
          status: STATUS.TYPE_CONFLICT,
          message: '题型冲突：试卷第 ' + q.n + ' 题为' + typeLabel(type) + '题，但答案形如判断题（' + rawToString(raw) + '）'
        };
      }
      return {
        answerNorm: '',
        status: STATUS.INVALID,
        message: '答案无效：' + typeLabel(type) + '题答案应为 A-D 中的选项'
      };
    }
    var illegal = s.replace(/[A-D]/g, '');
    if (illegal) {
      if (isDistinctJudgeToken(simple)) {
        return {
          answerNorm: '',
          status: STATUS.TYPE_CONFLICT,
          message: '题型冲突：试卷第 ' + q.n + ' 题为' + typeLabel(type) + '题，但答案形如判断题（' + rawToString(raw) + '）'
        };
      }
      return {
        answerNorm: '',
        status: STATUS.INVALID,
        message: '答案无效：包含非法选项“' + illegal + '”（' + typeLabel(type) + '题仅允许 A-D）'
      };
    }
    var norm = normChoice(s, type);
    if (type === 'single' && norm.length > 1) {
      return {
        answerNorm: norm,
        status: STATUS.TYPE_CONFLICT,
        message: '题型冲突：试卷第 ' + q.n + ' 题为单选题，但答案包含多个选项（' + norm + '）'
      };
    }
    return { answerNorm: norm, status: STATUS.OK, message: '' };
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

  /**
   * 把 exam 归一化为 [{n, type, module, page}]（按题号升序、题号去重）。
   * 优先 exam.questions；若缺失则回退到 exam.modules 的 start/end/typeOverrides（兼容 V1）。
   */
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

  /* ============================ CSV / 表格解析 ============================ */

  function splitCsvLine(line) {
    var out = [];
    var cur = '';
    var inQuotes = false;
    var i, ch;
    line = line == null ? '' : String(line);
    for (i = 0; i < line.length; i++) {
      ch = line.charAt(i);
      if (inQuotes) {
        if (ch === '"') {
          if (line.charAt(i + 1) === '"') { cur += '"'; i++; }
          else inQuotes = false;
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',' || ch === '\t' || ch === '，' || ch === ';' || ch === '；') {
        out.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  }

  function looksLikeHeader(cells) {
    if (!Array.isArray(cells)) return false;
    var hits = 0;
    cells.forEach(function (c) {
      var s = String(c == null ? '' : c).trim();
      if (!s || s.length > 14) return;
      // 去掉括号补充说明与空白后，必须是“表头词”本身，避免把解析文本误判成表头
      var base = s.replace(/[（(].*$/, '').replace(/[\s:：]/g, '').toLowerCase();
      if (/^(题号|序号|答案|标准答案|答案解析|解析|题型|模块|题目|number|num|no|n|answer|key|explanation|analysis|question|question_type|type|module|id)$/.test(base)) {
        hits++;
      }
    });
    return hits >= 1;
  }

  function columnMap(header) {
    var map = { n: -1, answer: -1, explanation: -1, type: -1 };
    (header || []).forEach(function (cell, i) {
      var s = String(cell == null ? '' : cell).trim();
      if (!s) return;
      if (map.explanation < 0 && /解析|explanation|analysis|说明|note/i.test(s)) { map.explanation = i; return; }
      if (map.answer < 0 && /答案|answer|标准答案|key|value/i.test(s)) { map.answer = i; return; }
      if (map.type < 0 && /题型|question_type|^type$/i.test(s)) { map.type = i; return; }
      if (map.n < 0 && /^(题\s*号|序号|number|num|no|n|question|question_id|id)$/i.test(s)) { map.n = i; }
    });
    if (map.n < 0) map.n = 0;
    if (map.answer < 0) map.answer = map.n === 0 ? 1 : 0;
    return map;
  }

  function normalizeRecord(rec) {
    rec = rec || {};
    var n = parseInt(String(rec.n == null ? '' : rec.n).replace(/[^\d]/g, ''), 10);
    return {
      n: isFinite(n) && n > 0 ? n : null,
      answerRaw: rec.answerRaw == null ? '' : rec.answerRaw,
      explanation: rec.explanation == null ? '' : String(rec.explanation).trim(),
      declaredType: rec.declaredType == null ? '' : String(rec.declaredType).trim()
    };
  }

  function recordFromMappedRow(cells, map) {
    var rawN = cells[map.n];
    var n = parseInt(String(rawN == null ? '' : rawN).replace(/[^\d]/g, ''), 10);
    if (!isFinite(n) || n <= 0) return null;
    return normalizeRecord({
      n: n,
      answerRaw: map.answer >= 0 ? cells[map.answer] : '',
      explanation: map.explanation >= 0 ? cells[map.explanation] : '',
      declaredType: map.type >= 0 ? cells[map.type] : ''
    });
  }

  function recordFromHeuristicRow(cells) {
    var arr = (cells || []).map(function (c) { return String(c == null ? '' : c).trim(); });
    while (arr.length && arr[arr.length - 1] === '') arr.pop();
    if (!arr.length) return null;
    if (arr.length === 1) {
      var tokens = arr[0].split(/[\s\u3000]+/).filter(function (x) { return x !== ''; });
      if (tokens.length >= 2) return recordFromHeuristicRow(tokens);
      return null;
    }
    if (/^20\d\d$/.test(arr[0]) && arr.length >= 3) {
      return normalizeRecord({ n: arr[1], answerRaw: arr[2], explanation: arr[3] || '' });
    }
    var nIdx = -1;
    for (var i = 0; i < arr.length && i < 2; i++) {
      if (/^\d{1,3}$/.test(arr[i])) { nIdx = i; break; }
    }
    if (nIdx < 0) return null;
    return normalizeRecord({ n: arr[nIdx], answerRaw: arr[nIdx + 1], explanation: arr[nIdx + 2] || '' });
  }

  function recordsFromTable(table) {
    var records = [];
    var issues = [];
    if (!Array.isArray(table) || !table.length) {
      return { records: records, issues: [{ type: 'parse_error', message: '表格中没有数据' }] };
    }
    var headerMap = null;
    var start = 0;
    if (looksLikeHeader(table[0])) {
      headerMap = columnMap(table[0]);
      start = 1;
    }
    for (var i = start; i < table.length; i++) {
      var cells = table[i];
      if (!Array.isArray(cells) || !cells.length) continue;
      var hasContent = cells.some(function (c) { return String(c == null ? '' : c).trim() !== ''; });
      if (!hasContent) continue;
      var rec = headerMap ? recordFromMappedRow(cells, headerMap) : recordFromHeuristicRow(cells);
      if (!rec || rec.n == null) {
        issues.push({
          type: 'unrecognized_row',
          message: '第 ' + (i + 1) + ' 行无法识别题号/答案：' + String(cells.join(',')).slice(0, 80)
        });
        continue;
      }
      if (isBlank(rec.answerRaw)) continue; // 空答案按“缺失”处理，不生成记录（避免误判重复）
      records.push(rec);
    }
    if (!records.length) {
      issues.push({ type: 'no_valid_records', message: '表格中未识别到“题号 + 答案”记录' });
    }
    return { records: records, issues: issues };
  }

  function recordsFromCsvText(text) {
    var src = stripBom(String(text == null ? '' : text));
    var lines = src.split(/\r?\n/);
    var table = [];
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].trim() === '') continue;
      table.push(splitCsvLine(lines[i]));
    }
    return recordsFromTable(table);
  }

  /* ============================ JSON 解析 ============================ */

  var JSON_META_KEYS = {
    answers: 1, explanations: 1, types: 1, year: 1, examid: 1, exam_id: 1, id: 1, name: 1,
    title: 1, source: 1, schema: 1, schema_version: 1, createdat: 1, importedat: 1,
    confirmed: 1, reliability: 1, coverage: 1, issues: 1, version: 1
  };

  function pickField(row, names) {
    for (var i = 0; i < names.length; i++) {
      var k = names[i];
      if (Object.prototype.hasOwnProperty.call(row, k) && row[k] != null && String(row[k]) !== '') return row[k];
    }
    return undefined;
  }

  function recordsFromAnswerMap(map, explanations, types) {
    var records = [];
    var issues = [];
    var skipped = 0;
    var keys = Object.keys(map || {});
    keys.forEach(function (k) {
      if (!/^\d{1,3}$/.test(String(k).trim())) { skipped++; return; }
      var n = parseInt(k, 10);
      var ans = map[k];
      if (isBlank(ans)) return;
      records.push(normalizeRecord({
        n: n,
        answerRaw: ans,
        explanation: explanations && explanations[k] != null ? explanations[k] : '',
        declaredType: types && types[k] != null ? types[k] : ''
      }));
    });
    if (!records.length) {
      issues.push({
        type: 'no_valid_records',
        message: 'JSON 中未识别到“题号 + 答案”记录' + (skipped ? '（忽略 ' + skipped + ' 个非题号字段）' : '')
      });
    }
    return { records: records, issues: issues };
  }

  function recordsFromJson(data, exam) {
    if (data == null) return { records: [], issues: [{ type: 'parse_error', message: 'JSON 内容为空' }] };
    if (Array.isArray(data)) {
      var records = [];
      var issues = [];
      data.forEach(function (row, idx) {
        if (row == null) return;
        if (typeof row !== 'object' || Array.isArray(row)) {
          if (typeof row === 'string' || typeof row === 'number') {
            var s = String(row).trim();
            if (/^[A-D√×对错TF]{1,4}$/i.test(s)) records.push(normalizeRecord({ n: idx + 1, answerRaw: s }));
          }
          return;
        }
        var n = pickField(row, ['n', 'number', '题号', '序号', 'question_id', 'question', 'no', 'NO', 'id']);
        var ans = pickField(row, ['answer', '答案', '标准答案', 'ans', 'value', 'key']);
        var exp = pickField(row, ['explanation', '解析', '答案解析', 'analysis', '说明', 'note']);
        var typ = pickField(row, ['type', '题型', 'question_type']);
        if (n == null && ans != null) n = idx + 1;
        if (n == null) {
          issues.push({ type: 'unrecognized_row', message: 'JSON 数组第 ' + (idx + 1) + ' 项缺少题号' });
          return;
        }
        if (isBlank(ans)) return;
        records.push(normalizeRecord({
          n: n,
          answerRaw: ans,
          explanation: exp == null ? '' : exp,
          declaredType: typ == null ? '' : typ
        }));
      });
      if (!records.length) issues.push({ type: 'no_valid_records', message: 'JSON 数组中未识别到“题号 + 答案”记录' });
      return { records: records, issues: issues };
    }
    if (typeof data !== 'object') {
      return { records: [], issues: [{ type: 'parse_error', message: 'JSON 顶层必须是数组或对象' }] };
    }
    // 1) { answers: { n: ans }, explanations: {...} }
    if (data.answers && typeof data.answers === 'object' && !Array.isArray(data.answers)) {
      return recordsFromAnswerMap(data.answers, data.explanations, data.types);
    }
    // 2) 按试卷 id / 年份分组的 JSON：{ "2026": {...} } / { "builtin-2026": {...} }
    var groupKeys = Object.keys(data).filter(function (k) {
      return !JSON_META_KEYS[k.toLowerCase()] && data[k] && typeof data[k] === 'object' && !Array.isArray(data[k]);
    });
    if (groupKeys.length) {
      var chosenKey = null;
      var wanted = [String(exam && exam.id), String(exam && exam.year)];
      groupKeys.forEach(function (k) {
        if (chosenKey == null && wanted.indexOf(k) >= 0) chosenKey = k;
      });
      if (chosenKey == null && groupKeys.length === 1) chosenKey = groupKeys[0];
      if (chosenKey == null) {
        return {
          records: [],
          issues: [{
            type: 'ambiguous_json',
            message: 'JSON 包含多套试卷答案（' + groupKeys.join(' / ') + '），无法与当前试卷对应，请只保留当前试卷部分'
          }]
        };
      }
      var group = data[chosenKey] || {};
      if (group.answers && typeof group.answers === 'object') {
        return recordsFromAnswerMap(group.answers, group.explanations, group.types);
      }
      return recordsFromAnswerMap(group, null, null);
    }
    // 3) 扁平 { "1": "A", "2": "B" }
    var exps = (data.explanations && typeof data.explanations === 'object') ? data.explanations : null;
    var typMap = (data.types && typeof data.types === 'object') ? data.types : null;
    return recordsFromAnswerMap(data, exps, typMap);
  }

  function recordsFromJsonText(text, exam) {
    var src = stripBom(String(text == null ? '' : text)).trim();
    var data;
    try {
      data = JSON.parse(src);
    } catch (e) {
      throw new Error('JSON 解析失败：' + e.message);
    }
    return recordsFromJson(data, exam);
  }

  /* ============================ XLSX 解析 ============================ */

  function pickSheetName(wb, exam) {
    var names = (wb && wb.SheetNames) || [];
    if (!names.length) return null;
    var keys = [];
    if (exam) {
      if (exam.year != null) keys.push(String(exam.year));
      if (exam.id != null) keys.push(String(exam.id));
      if (exam.name != null) keys.push(String(exam.name));
    }
    for (var i = 0; i < names.length; i++) {
      for (var j = 0; j < keys.length; j++) {
        if (keys[j] && names[i].indexOf(keys[j]) >= 0) return names[i];
      }
    }
    return names[0];
  }

  async function readBytes(file, ctx) {
    if (ctx && ctx.bytes != null) {
      var b = ctx.bytes;
      if (b instanceof ArrayBuffer) return new Uint8Array(b);
      if (ArrayBuffer.isView(b)) return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
      if (Array.isArray(b)) return new Uint8Array(b);
    }
    if (file == null) throw new Error('未选择文件');
    if (typeof file === 'string') throw new Error('该格式需要二进制文件内容');
    if (typeof file.arrayBuffer === 'function') {
      var ab = await file.arrayBuffer();
      if (ab instanceof ArrayBuffer) return new Uint8Array(ab);
      if (ArrayBuffer.isView(ab)) return new Uint8Array(ab.buffer, ab.byteOffset, ab.byteLength);
      throw new Error('无法读取文件二进制内容');
    }
    if (file instanceof ArrayBuffer) return new Uint8Array(file);
    if (ArrayBuffer.isView(file)) return new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
    throw new Error('无法读取文件内容（需要 File / Blob / ArrayBuffer）');
  }

  function decodeUtf8(bytes) {
    if (typeof TextDecoder !== 'undefined') {
      try { return new TextDecoder('utf-8').decode(bytes); } catch (e) { /* ignore */ }
    }
    var s = '';
    for (var i = 0; i < bytes.length; i++) {
      s += '%' + ('0' + bytes[i].toString(16)).slice(-2);
    }
    try { return decodeURIComponent(s); } catch (e) { return ''; }
  }

  async function readText(file, ctx) {
    if (ctx && typeof ctx.text === 'string') return stripBom(ctx.text);
    if (typeof file === 'string') return stripBom(file);
    if (file == null) throw new Error('未选择文件');
    if (typeof file.text === 'function') return stripBom(await file.text());
    var bytes = await readBytes(file, ctx);
    return stripBom(decodeUtf8(bytes));
  }

  async function recordsFromXlsx(file, exam, ctx) {
    var XLSX = getLib('XLSX', './libs/xlsx.full.min.js');
    if (!XLSX) throw new Error('XLSX 组件未加载：请先引入 libs/xlsx.full.min.js');
    var bytes = await readBytes(file, ctx);
    var wb = XLSX.read(bytes, { type: 'array' });
    var sheetName = pickSheetName(wb, exam);
    if (!sheetName || !wb.Sheets || !wb.Sheets[sheetName]) throw new Error('XLSX 中没有可读取的工作表');
    var aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1, defval: '', raw: false, blankrows: false
    });
    return recordsFromTable(aoa);
  }

  /* ============================ PDF 文本行解析 ============================ */

  function normalizePdfLines(rawLines) {
    var lines = [];
    if (!Array.isArray(rawLines)) return lines;
    rawLines.forEach(function (item) {
      if (item == null) return;
      if (typeof item === 'string') {
        lines.push({ text: item });
        return;
      }
      if (typeof item.text !== 'string') return;
      lines.push({ text: item.text, page: item.page, y: item.y, x: item.x });
    });
    var hasPos = lines.some(function (l) { return l.page != null || l.y != null; });
    if (hasPos) {
      lines.forEach(function (l, i) { l._i = i; });
      lines.sort(function (a, b) {
        var pa = a.page == null ? 0 : a.page;
        var pb = b.page == null ? 0 : b.page;
        if (pa !== pb) return pa - pb;
        // PDF 坐标系 y 轴向上：同一页内 y 越大越靠上
        var ya = a.y == null ? 0 : a.y;
        var yb = b.y == null ? 0 : b.y;
        if (ya !== yb) return yb - ya;
        var xa = a.x == null ? 0 : a.x;
        var xb = b.x == null ? 0 : b.x;
        if (xa !== xb) return xa - xb;
        return a._i - b._i;
      });
    }
    return lines;
  }

  function cleanPdfToken(token) {
    var s = String(token == null ? '' : token).trim();
    s = s.replace(/^[（(【\[]+/, '').replace(/[）)】\]]+$/, '');
    s = s.replace(/^(答案|标准答案|应选|选|是|为|答)[\s:：]*/, '');
    s = s.replace(/[。．.,，、；;:：]+$/, '');
    return s.trim();
  }

  function isAnswerToken(token) {
    var s = cleanPdfToken(token);
    if (!s) return false;
    if (/^[A-D]{1,4}$/i.test(s)) return true;
    return !!normJudge(s);
  }

  function makePdfRecord(n, ansToken) {
    return normalizeRecord({ n: n, answerRaw: cleanPdfToken(ansToken), explanation: '' });
  }

  function expandPdfRange(start, end, rest, issues) {
    if (!(start >= 1) || !(end >= start) || (end - start) > 300) return [];
    var len = end - start + 1;
    var out = [];
    var tokens = String(rest || '').trim().split(/[\s,，、;；]+/).filter(Boolean);
    if (tokens.length === len && tokens.every(isAnswerToken)) {
      for (var i = 0; i < tokens.length; i++) out.push(makePdfRecord(start + i, tokens[i]));
      return out;
    }
    var compact = String(rest || '').replace(/[\s,，、;；]+/g, '');
    if (/^[A-D]+$/i.test(compact) && compact.length === len) {
      for (var j = 0; j < compact.length; j++) out.push(makePdfRecord(start + j, compact.charAt(j)));
      return out;
    }
    var marks = compact.match(/[√✓×✗]|正确|错误|对|错/g);
    if (marks && marks.length === len) {
      for (var k = 0; k < marks.length; k++) out.push(makePdfRecord(start + k, marks[k]));
      return out;
    }
    if (issues) {
      issues.push({
        type: 'unrecognized_row',
        message: 'PDF 答案区间 ' + start + '-' + end + ' 的答案数量无法对应：' + String(rest).slice(0, 60)
      });
    }
    return [];
  }

  function scanPdfPairs(text, lenient) {
    var tokens = String(text || '').split(/[\s,，、;；]+/).filter(Boolean);
    var out = [];
    var i = 0;
    while (i < tokens.length) {
      var tok = tokens[i];
      // 纯题号："3" / "3." / "(3)" / "3、"
      var mNum = tok.match(/^[(（【\[]?(\d{1,3})[)）】\]]?[.．、:：)）]?$/);
      if (mNum) {
        var next = tokens[i + 1];
        if (next != null && isAnswerToken(next)) {
          out.push(makePdfRecord(parseInt(mNum[1], 10), next));
          i += 2;
          continue;
        }
        if (lenient) break;
        return [];
      }
      // 题号+答案连写："3.A" / "3、√" / "1错误"（PDF 提取常把空格吞掉）
      var mPair = tok.match(/^[(（【\[]?(\d{1,3})[)）】\]]?[.．、:：)）]?(.+)$/);
      if (mPair) {
        if (isAnswerToken(mPair[2])) {
          out.push(makePdfRecord(parseInt(mPair[1], 10), mPair[2]));
          i += 1;
          continue;
        }
        if (lenient) break;
        return [];
      }
      if (lenient) break;
      return [];
    }
    return out;
  }

  function parsePdfRecords(lines, issues) {
    var records = [];
    issues = issues || [];
    var numsBuffer = null;

    lines.forEach(function (line) {
      var text = nfkc(line.text).replace(/\u3000/g, ' ').trim();
      if (!text) return;

      // 去掉“参考答案：”“标准答案:”等行首标签
      var label = text.match(/^(参考答案|标准答案|答案|answer\s*key|answers?)[\s:：-]*(.+)$/i);
      if (label) text = label[2].trim();
      if (!text) return;

      // 纯数字行 → 可能是“题号行 + 答案行”的表格排版
      if (/^[\d\s,，、;；]+$/.test(text)) {
        var nums = (text.match(/\d{1,3}/g) || [])
          .map(function (s) { return parseInt(s, 10); })
          .filter(function (n) { return n >= 1 && n <= 300; });
        numsBuffer = nums.length >= 2 ? nums : null;
        return;
      }

      // 上一行是题号、本行是等长答案 → 对齐成记录
      if (numsBuffer) {
        var rowTokens = text.split(/[\s,，、;；]+/).filter(Boolean);
        if (rowTokens.length === numsBuffer.length && rowTokens.every(isAnswerToken)) {
          for (var i = 0; i < numsBuffer.length; i++) records.push(makePdfRecord(numsBuffer[i], rowTokens[i]));
          numsBuffer = null;
          return;
        }
      }

      // 一行内多个“起-止：答案”区间（如 "6-8：AC CA D 9-10：C ABC"）
      var chunks = text.split(/(?=(?:\d{1,3})\s*[-–—~至]\s*\d{1,3})/);
      var parsedRange = false;
      chunks.forEach(function (chunk) {
        var m = chunk.match(/^\s*(\d{1,3})\s*[-–—~至]\s*(\d{1,3})\s*[.．、:：]?\s*(.+)$/);
        if (!m) return;
        var recs = expandPdfRange(parseInt(m[1], 10), parseInt(m[2], 10), m[3], issues);
        if (recs.length) {
          records = records.concat(recs);
          parsedRange = true;
        }
      });
      if (parsedRange) { numsBuffer = null; return; }

      // "1.A 2.B 3.√" 形式（严格匹配整行；宽松匹配允许行尾说明）
      var pairs = scanPdfPairs(text, false);
      if (!pairs.length) pairs = scanPdfPairs(text, true);
      if (pairs.length) { records = records.concat(pairs); numsBuffer = null; return; }

      // "第1题 A"
      var mTitle = text.match(/^第\s*(\d{1,3})\s*题\s*[.．、:：]?\s*(.+)$/);
      if (mTitle) {
        records.push(makePdfRecord(parseInt(mTitle[1], 10), mTitle[2]));
        numsBuffer = null;
        return;
      }

      numsBuffer = null;
    });

    if (!records.length) {
      issues.push({ type: 'no_valid_records', message: 'PDF 文本中未识别到“题号 + 答案”行' });
    }
    return { records: records, issues: issues };
  }

  async function recordsFromPdf(file, exam, ctx) {
    if (!ctx || typeof ctx.extractPdfLines !== 'function') {
      throw new Error('PDF 解析需要 ctx.extractPdfLines(file) 注入（返回 [{text,page,y}] 或 [{text}]）');
    }
    var rawLines = await ctx.extractPdfLines(file);
    if (rawLines == null) throw new Error('PDF 文本提取失败（extractPdfLines 返回空）');
    var issues = [];
    var lines = normalizePdfLines(rawLines);
    return parsePdfRecords(lines, issues);
  }

  /* ============================ 行构造 / 汇总 ============================ */

  function buildRows(records, exam) {
    var questions = getExamQuestions(exam);
    var extraIssues = [];
    var groups = Object.create(null);
    (records || []).forEach(function (rec) {
      if (!rec || rec.n == null) return;
      if (!groups[rec.n]) groups[rec.n] = [];
      groups[rec.n].push(rec);
    });

    var qMap = Object.create(null);
    questions.forEach(function (q) { qMap[q.n] = q; });
    Object.keys(groups).forEach(function (k) {
      var n = Number(k);
      if (!qMap[n]) {
        extraIssues.push({
          type: 'unknown_question',
          n: n,
          message: '文件中的第 ' + n + ' 题不在当前试卷中，已忽略'
        });
      }
    });

    var rows = questions.map(function (q) {
      var list = groups[q.n] || [];
      if (!list.length) {
        return {
          n: q.n, answerRaw: '', answerNorm: '', explanation: '',
          status: STATUS.MISSING, message: '缺少第 ' + q.n + ' 题答案'
        };
      }
      var chosen = list.filter(function (r) { return !isBlank(r.answerRaw); })[0] || list[0];
      var raw = rawToString(chosen.answerRaw);
      var explanation = chosen.explanation == null ? '' : String(chosen.explanation).trim();
      var check = validateAnswer(chosen.answerRaw, chosen.declaredType, q);

      if (list.length > 1) {
        var values = list.map(function (r) { return rawToString(r.answerRaw); })
          .filter(function (v) { return v !== ''; });
        var uniq = values.filter(function (v, i, a) { return a.indexOf(v) === i; });
        return {
          n: q.n,
          answerRaw: raw,
          answerNorm: check.answerNorm,
          explanation: explanation,
          status: STATUS.DUPLICATE,
          message: '第 ' + q.n + ' 题答案重复出现 ' + list.length + ' 次' +
            (uniq.length > 1 ? '（取值：' + uniq.join(' / ') + '）' : '')
        };
      }
      return {
        n: q.n,
        answerRaw: raw,
        answerNorm: check.answerNorm,
        explanation: explanation,
        status: check.status,
        message: check.message
      };
    });
    rows.sort(function (a, b) { return a.n - b.n; });
    return { rows: rows, extraIssues: extraIssues };
  }

  function makeIssues(rows, extraIssues) {
    var out = [];
    (rows || []).forEach(function (r) {
      if (!r || r.status === STATUS.OK) return;
      out.push({ type: r.status, n: r.n, message: r.message || '该题未通过核实' });
    });
    (extraIssues || []).forEach(function (issue) { if (issue) out.push(issue); });
    return out;
  }

  function detectKind(file, ctx) {
    if (ctx && ctx.kind) {
      var k = String(ctx.kind).toLowerCase().replace(/^\./, '');
      var mapped = normKind(k);
      if (mapped) return mapped;
    }
    var name = (file && file.name) || (ctx && ctx.filename) || '';
    var m = /\.([a-z0-9]+)$/i.exec(name);
    var ext = m ? m[1].toLowerCase() : '';
    if (['csv', 'txt', 'tsv'].indexOf(ext) >= 0) return 'csv';
    if (ext === 'json') return 'json';
    if (['xlsx', 'xls', 'xlsm'].indexOf(ext) >= 0) return 'xlsx';
    if (ext === 'pdf') return 'pdf';
    var type = String((file && file.type) || '');
    if (/csv|tab-separated|text\/plain/i.test(type)) return 'csv';
    if (/json/i.test(type)) return 'json';
    if (/spreadsheet|excel/i.test(type)) return 'xlsx';
    if (/pdf/i.test(type)) return 'pdf';
    return '';
  }

  function normKind(k) {
    if (['csv', 'txt', 'tsv', 'text/csv', 'text/plain'].indexOf(k) >= 0) return 'csv';
    if (['json', 'application/json'].indexOf(k) >= 0) return 'json';
    if (['xlsx', 'xls', 'xlsm', 'excel', 'spreadsheet'].indexOf(k) >= 0) return 'xlsx';
    if (['pdf', 'application/pdf'].indexOf(k) >= 0) return 'pdf';
    return '';
  }

  /* ============================ 对外 API ============================ */

  /**
   * 解析标准答案文件。
   * @param {File|Blob|string|ArrayBuffer} file 用户选择的文件（Node 测试可传 {name, text(), arrayBuffer()}）
   * @param {object} exam V2 试卷对象（使用 exam.questions 的 type 作为题型依据）
   * @param {object} ctx  { extractPdfLines(file), kind, filename, text, bytes }
   * @returns {Promise<{rows:Array, issues:Array, source:object}>}
   */
  async function parseFile(file, exam, ctx) {
    ctx = ctx || {};
    var kind = detectKind(file, ctx);
    var filename = (file && file.name) || ctx.filename || '';
    var importedAt = new Date().toISOString();
    var extracted;

    if (kind === 'csv' || kind === 'json') {
      var text = await readText(file, ctx);
      if (!stripBom(String(text)).trim()) throw new Error('文件为空');
      // 容错：扩展名为 csv 但内容其实是 JSON
      if (kind === 'csv') {
        var head = stripBom(String(text)).trim().charAt(0);
        if (head === '{' || head === '[') kind = 'json';
      }
      extracted = kind === 'json'
        ? recordsFromJsonText(text, exam)
        : recordsFromCsvText(text);
    } else if (kind === 'xlsx') {
      extracted = await recordsFromXlsx(file, exam, ctx);
    } else if (kind === 'pdf') {
      extracted = await recordsFromPdf(file, exam, ctx);
    } else {
      throw new Error('不支持的文件类型：' + (filename || String((file && file.type) || '未知')) +
        '（支持 CSV / JSON / XLSX / PDF）');
    }

    var built = buildRows(extracted.records, exam);
    var extraIssues = (extracted.issues || []).concat(built.extraIssues);
    var rows = built.rows;
    var source = {
      kind: kind,
      filename: filename,
      importedAt: importedAt,
      confirmed: false,
      reliability: RELIABILITY
    };
    defineHidden(rows, 'source', source);
    defineHidden(rows, 'issues', extraIssues);
    return { rows: rows, issues: makeIssues(rows, extraIssues), source: source };
  }

  /**
   * 用户确认后生成可写入的标准答案。
   * 仅 status==='ok'（已核实）的题目写入 answers / explanations。
   * @param {Array} rows parseFile 返回的 rows（或人工编辑后的同结构数组）
   * @param {object} exam
   * @param {object} [sourceOverride] 若 rows 经过序列化丢失隐藏的 source，可显式传入
   */
  function finalize(rows, exam, sourceOverride) {
    var list = Array.isArray(rows) ? rows : [];
    var storedIssues = (list.issues && list.issues.length) ? list.issues.slice() : [];
    var storedSource = list.source || null;
    var questions = getExamQuestions(exam);
    var rowMap = Object.create(null);
    list.forEach(function (r) {
      if (!r || r.n == null) return;
      rowMap[Number(r.n)] = r;
    });

    var answers = {};
    var explanations = {};
    var verifiedNumbers = [];
    var issues = [];

    questions.forEach(function (q) {
      var r = rowMap[q.n];
      if (!r) {
        issues.push({ type: STATUS.MISSING, n: q.n, message: '缺少第 ' + q.n + ' 题答案' });
        return;
      }
      if (r.status === STATUS.OK && r.answerNorm) {
        answers[q.n] = r.answerNorm;
        explanations[q.n] = r.explanation == null ? '' : String(r.explanation);
        verifiedNumbers.push(q.n);
      } else {
        issues.push({
          type: r.status || STATUS.INVALID,
          n: q.n,
          message: (typeof r.message === 'string' && r.message) ? r.message : '该题未通过核实'
        });
      }
    });

    issues = issues.concat(storedIssues);
    verifiedNumbers.sort(function (a, b) { return a - b; });

    var total = questions.length;
    var verified = verifiedNumbers.length;
    var src = sourceOverride || storedSource || {};
    var source = {
      kind: src.kind || 'unknown',
      filename: src.filename || '',
      importedAt: src.importedAt || new Date().toISOString(),
      confirmed: true,
      reliability: RELIABILITY
    };

    return {
      answers: answers,
      explanations: explanations,
      verifiedNumbers: verifiedNumbers,
      coverage: {
        verified: verified,
        total: total,
        percent: total ? Math.round((verified / total) * 1000) / 10 : 0,
        ratio: total ? Math.round((verified / total) * 10000) / 10000 : 0
      },
      issues: issues,
      source: source
    };
  }

  /**
   * 对已有 rows 重新校验（可用于导入预览页人工修改答案后刷新状态）。
   */
  function validateRows(rows, exam) {
    var records = [];
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      if (!r || r.n == null) return;
      records.push({
        n: r.n,
        answerRaw: r.answerRaw,
        explanation: r.explanation,
        declaredType: r.declaredType
      });
    });
    var built = buildRows(records, exam);
    var stats = { ok: 0, missing: 0, duplicate: 0, invalid: 0, type_conflict: 0 };
    built.rows.forEach(function (r) {
      if (stats[r.status] == null) stats[r.status] = 0;
      stats[r.status]++;
    });
    return {
      rows: built.rows,
      issues: makeIssues(built.rows, built.extraIssues),
      stats: stats,
      total: getExamQuestions(exam).length
    };
  }

  return {
    VERSION: VERSION,
    RELIABILITY: RELIABILITY,
    STATUS: STATUS,
    parseFile: parseFile,
    finalize: finalize,
    validateRows: validateRows,
    normAnswer: normAnswer,
    normJudge: normJudge,
    normType: normType,
    getExamQuestions: getExamQuestions,
    splitCsvLine: splitCsvLine
  };
});
