/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright 2026 ExamCard contributors */
/* ExamCard 1.2.0 P0 · 粉笔/外部练习批量 JSON 解析、校验、预览去重 */
(function (root) {
  'use strict';
  var SCHEMA = 'examcard.external-practice/v1';
  var BATCH_SCHEMA = 'examcard.external-practice-batch/v1';
  var TOP_KEYS = ['schema', 'source', 'records', 'practices', 'exportedAt', 'note'];

  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function canonical(v) {
    if (v == null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
    return '{' + Object.keys(v).sort().map(function (k) {
      if (v[k] === undefined) return '';
      return JSON.stringify(k) + ':' + canonical(v[k]);
    }).filter(Boolean).join(',') + '}';
  }
  function signature(rec) {
    return canonical({
      kind: rec.kind, assessment: rec.assessment, date: rec.date, content: rec.content,
      module: rec.module, topic: rec.topic, knowledgePoint: rec.knowledgePoint,
      practiceType: rec.practiceType, questionCount: rec.questionCount, correctCount: rec.correctCount,
      durationSeconds: rec.durationSeconds, durationMinutes: rec.durationMinutes,
      durationPrecision: rec.durationPrecision, durationUnit: rec.durationUnit,
      source: rec.source, externalId: rec.externalId, reportRef: rec.reportRef, taskId: rec.taskId,
      retestStatus: rec.retestStatus, groups: rec.groups, wrongQuestions: rec.wrongQuestions,
      essayScores: rec.essayScores, note: rec.note
    });
  }
  function parse(text) {
    var obj;
    try { obj = JSON.parse(String(text || '')); } catch (e) {
      var pe = new Error('外部练习 JSON 解析失败：' + e.message);
      pe.details = [{ path: '$', message: 'JSON 语法错误' }];
      throw pe;
    }
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      var isSingleRecord = obj.source && obj.externalId && !Array.isArray(obj.records) && !Array.isArray(obj.practices);
      if (!isSingleRecord && obj.schema != null && obj.schema !== BATCH_SCHEMA && obj.schema !== SCHEMA) {
        var se = new Error('不支持的外部练习 schema：' + String(obj.schema));
        se.details = [{ path: 'schema', message: '仅支持 ' + BATCH_SCHEMA + ' 或 ' + SCHEMA }];
        throw se;
      }
      if (!isSingleRecord) {
        var unknown = Object.keys(obj).filter(function (k) { return TOP_KEYS.indexOf(k) < 0; });
        if (unknown.length) {
          var ue = new Error('外部练习 JSON 包含未知顶层字段');
          ue.details = unknown.map(function (k) { return { path: k, message: '未知字段' }; });
          throw ue;
        }
      }
    }
    var list = null;
    if (Array.isArray(obj)) list = obj;
    else if (obj && Array.isArray(obj.records)) list = obj.records;
    else if (obj && Array.isArray(obj.practices)) list = obj.practices;
    else if (obj && typeof obj === 'object' && obj.source && obj.externalId) list = [obj];
    if (!list) {
      var me = new Error('外部练习 JSON 必须是数组，或 {schema, records/practices:[...]}');
      me.details = [{ path: '$', message: '缺少 records/practices 数组' }];
      throw me;
    }
    if (!list.length) {
      var ee = new Error('外部练习 JSON 至少需要一条记录');
      ee.details = [{ path: '$', message: '记录数组为空' }];
      throw ee;
    }
    return list;
  }
  function normalizeRecord(raw, index) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { value: null, errors: [{ path: 'records[' + index + ']', message: '记录必须是对象' }] };
    }
    var input = clone(raw);
    var inferredAssessment = input.assessment === 'essay' || (input.assessment == null && Array.isArray(input.essayScores)) ? 'essay' : 'objective';
    delete input.id;
    delete input.schema;
    delete input.createdAt;
    delete input.updatedAt;
    delete input.revision;
    delete input.revisions;
    delete input.status;
    delete input.deletedAt;
    delete input.deletedReason;
    delete input.externalKey;
    delete input.duplicate;
    delete input.existingId;
    input.kind = 'external';
    input.assessment = inferredAssessment;
    var out = root.StudyLog.normalize(input, { now: Date.now() });
    return out;
  }
  function keyOf(rec) {
    return root.StudyLog.externalKeyOf(rec);
  }
  function prepare(rawList, existingLogs) {
    if (!Array.isArray(rawList) || !rawList.length) {
      var e = new Error('没有可导入的外部练习记录');
      e.details = [{ path: '$', message: '记录数组为空' }];
      throw e;
    }
    var existing = (existingLogs || []).filter(function (x) { return x && x.status !== 'deleted'; });
    var byKey = new Map();
    existing.forEach(function (x) {
      var k = keyOf(x);
      if (!k) return;
      var old = byKey.get(k);
      if (!old || (Number(x.updatedAt) || 0) > (Number(old.updatedAt) || 0)) byKey.set(k, x);
    });
    var errors = [], rows = [], seen = new Map();
    rawList.forEach(function (raw, i) {
      var out = normalizeRecord(raw, i);
      var rec = out.value;
      if (out.errors.length) {
        out.errors.forEach(function (x) { errors.push({ path: 'records[' + i + '].' + x.path, message: x.message }); });
        rows.push({ index: i, record: rec || raw, duplicate: 'error' });
        return;
      }
      var k = keyOf(rec);
      if (k && seen.has(k)) {
        errors.push({ path: 'records[' + i + '].externalId', message: '同一批次中 source + externalId 重复' });
        rows.push({ index: i, record: rec, duplicate: 'duplicate-batch' });
        return;
      }
      if (k) seen.set(k, true);
      var dup = null;
      if (k && byKey.has(k)) {
        var old = byKey.get(k);
        dup = signature(old) === signature(rec) ? 'same' : 'changed';
        rec.duplicate = dup;
        rec.existingId = old.id;
        rec.existingUpdatedAt = old.updatedAt || null;
      } else {
        rec.duplicate = 'new';
      }
      rows.push({ index: i, record: rec, duplicate: rec.duplicate, existingId: rec.existingId || null });
    });
    var newRecords = rows.filter(function (r) { return r.duplicate === 'new'; }).map(function (r) {
      var copy = clone(r.record);
      delete copy.duplicate;
      delete copy.existingId;
      delete copy.existingUpdatedAt;
      return copy;
    });
    var same = rows.filter(function (r) { return r.duplicate === 'same'; });
    var changed = rows.filter(function (r) { return r.duplicate === 'changed'; });
    var batchDup = rows.filter(function (r) { return r.duplicate === 'duplicate-batch'; });
    return {
      schema: BATCH_SCHEMA,
      rows: rows,
      records: rows.map(function (r) { return r.record; }),
      newRecords: newRecords,
      errors: errors,
      duplicates: rows.filter(function (r) { return r.duplicate !== 'new' && r.duplicate !== 'error'; }),
      conflicts: changed.map(function (r) {
        return { index: r.index, existingId: r.existingId || null, source: r.record.source, externalId: r.record.externalId, reason: '同一 source + externalId 已存在且内容不同，已跳过，不会覆盖' };
      }),
      summary: {
        total: rows.length,
        newCount: newRecords.length,
        duplicateCount: same.length + changed.length + batchDup.length,
        sameCount: same.length,
        changedCount: changed.length,
        batchDuplicateCount: batchDup.length,
        errorCount: errors.length,
        objective: newRecords.filter(function (r) { return r.assessment !== 'essay'; }).length,
        essay: newRecords.filter(function (r) { return r.assessment === 'essay'; }).length
      }
    };
  }
  function template() {
    return {
      schema: BATCH_SCHEMA,
      source: 'fenbi',
      note: '合成模板；只用于展示字段，不代表真实成绩或真实计划。',
      records: [
        {
          source: 'fenbi', externalId: 'example-20261102-01', date: '2026-11-02',
          assessment: 'objective', practiceType: 'new', module: '资料分析', topic: '专项练习',
          knowledgePoint: '增长率', content: '资料分析专项练习', questionCount: 6, correctCount: 5,
          durationSeconds: 300, durationPrecision: 'exact', durationUnit: 'seconds',
          reportRef: '粉笔报告：可选', taskId: null, retestStatus: 'not_required',
          groups: [], wrongQuestions: [
            { questionNo: '3', questionType: 'single', knowledgePoint: '增长率', primaryCause: '审题错误', secondaryCauses: ['计算或估算错误'], method: '', logicSymbols: '', reasoning: '人工复盘记录', retestHistory: [] }
          ]
        },
        {
          source: 'fenbi', externalId: 'example-20261102-essay', date: '2026-11-02',
          assessment: 'essay', module: '申论', topic: '申论小题', content: '申论小题写作',
          questionCount: null, correctCount: null, durationSeconds: null, durationPrecision: 'unknown', durationUnit: 'seconds',
          essayScores: [
            { round: 'first', score: 7, maxScore: 10, reviewer: 'ChatGPT', note: '首次评分' },
            { round: 'reevaluation', score: 9, maxScore: 10, reviewer: 'ChatGPT', note: '修改后复评' }
          ],
          wrongQuestions: []
        }
      ]
    };
  }
  root.ExternalPractice = {
    SCHEMA: SCHEMA, BATCH_SCHEMA: BATCH_SCHEMA,
    parse: parse, prepare: prepare, signature: signature, template: template
  };
})(typeof window !== 'undefined' ? window : globalThis);
