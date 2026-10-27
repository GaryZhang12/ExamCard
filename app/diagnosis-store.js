/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright 2026 ExamCard contributors */
/* ExamCard V4.1 · 学习诊断数据层（知识点标签/题目标注/学习打卡；历史批改只读） */
(function (root) {
  'use strict';
  var uid = function (p) { return p + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); };
  var clone = function (v) { return v == null ? v : JSON.parse(JSON.stringify(v)); };

  function withDb(fn) { return root.ExamStore.withDb(fn); }
  function reqP(req) { return new Promise(function (res, rej) { req.onsuccess = function () { res(req.result); }; req.onerror = function () { rej(req.error); }; }); }
  function getAll(db, store) { return reqP(db.transaction(store, 'readonly').objectStore(store).getAll()); }
  function get(db, store, key) { return reqP(db.transaction(store, 'readonly').objectStore(store).get(key)); }
  function put(db, store, value) {
    return new Promise(function (res, rej) {
      var tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value);
      tx.oncomplete = function () { res(value); };
      tx.onerror = function () { rej(tx.error); };
    });
  }
  function del(db, store, key) {
    return new Promise(function (res, rej) {
      var tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = res;
      tx.onerror = function () { rej(tx.error); };
    });
  }
  function byIndex(db, store, index, key) {
    return reqP(db.transaction(store, 'readonly').objectStore(store).index(index).getAll(key));
  }
  function slug(s) { return String(s).replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_').slice(0, 40); }

  var api = {
    uid: uid,
    async listTags() {
      return withDb(async function (db) {
        var all = await getAll(db, 'knowledgeTags');
        return all.sort(function (a, b) { return (a.moduleName || '') === (b.moduleName || '') ? (a.name || '').localeCompare(b.name || '', 'zh') : (a.moduleName || '').localeCompare(b.moduleName || '', 'zh'); });
      });
    },
    async getTag(id) { return withDb(function (db) { return get(db, 'knowledgeTags', id); }); },
    async saveTag(tag) {
      return withDb(async function (db) {
        var rec = clone(tag);
        rec.id = rec.id || uid('kt');
        rec.name = String(rec.name || '').trim();
        if (!rec.name) throw new Error('标签名称不能为空');
        rec.examType = rec.examType || 'all';
        rec.moduleName = rec.moduleName || '';
        rec.parentId = rec.parentId || null;
        rec.description = rec.description || '';
        rec.enabled = rec.enabled !== false;
        rec.updatedAt = Date.now();
        rec.createdAt = rec.createdAt || rec.updatedAt;
        await put(db, 'knowledgeTags', rec);
        return rec;
      });
    },
    async deleteTag(tagId) {
      return withDb(async function (db) {
        var links = await byIndex(db, 'questionTags', 'tagId', tagId);
        var tx = db.transaction(['knowledgeTags', 'questionTags'], 'readwrite');
        tx.objectStore('knowledgeTags').delete(tagId);
        links.forEach(function (l) { tx.objectStore('questionTags').delete(l.id); });
        await new Promise(function (res, rej) { tx.oncomplete = res; tx.onerror = function () { rej(tx.error); }; });
      });
    },
    async ensureModuleTags() {
      return withDb(async function (db) {
        var exams = await getAll(db, 'exams');
        var profiles = {};
        exams.forEach(function (e) { if (e.profileId) profiles[e.profileId] = true; });
        var existing = await getAll(db, 'knowledgeTags');
        var seen = {};
        existing.forEach(function (t) { seen[t.id] = true; });
        var created = [];
        var modules = {};
        exams.forEach(function (e) {
          var et = e.examType || e.profileId || 'unknown';
          var names = [];
          (e.modules || []).forEach(function (m) { names.push(m.name || m.module || ''); });
          if (!names.length) (e.questions || []).forEach(function (q) { if (q.module) names.push(q.module); });
          names.forEach(function (name) {
            if (!name) return;
            var key = et + '|' + name;
            modules[key] = { examType: et, name: name };
          });
        });
        for (var key in modules) {
          var m = modules[key];
          var id = 'kt-' + slug(m.examType) + '-' + slug(m.name);
          if (seen[id]) continue;
          var tag = {
            id: id, name: m.name, examType: m.examType, moduleName: m.name, parentId: null,
            description: '模块分类标签（可继续创建子知识点）', enabled: true, source: 'bootstrap',
            createdAt: Date.now(), updatedAt: Date.now()
          };
          await put(db, 'knowledgeTags', tag);
          seen[id] = true; created.push(tag);
        }
        return created;
      });
    },
    async listQuestionTags(questionId) {
      return withDb(async function (db) {
        if (questionId) return byIndex(db, 'questionTags', 'questionId', questionId);
        return getAll(db, 'questionTags');
      });
    },
    async setQuestionTags(questionId, examId, tagIds) {
      return withDb(async function (db) {
        var old = await byIndex(db, 'questionTags', 'questionId', questionId);
        var tx = db.transaction('questionTags', 'readwrite');
        old.forEach(function (o) { tx.objectStore('questionTags').delete(o.id); });
        (tagIds || []).forEach(function (tagId) {
          tx.objectStore('questionTags').put({ id: questionId + '::' + tagId, questionId: questionId, examId: examId, tagId: tagId, source: 'manual', updatedAt: Date.now() });
        });
        await new Promise(function (res, rej) { tx.oncomplete = res; tx.onerror = function () { rej(tx.error); }; });
        return tagIds || [];
      });
    },
    async listStudyLogs() {
      return withDb(async function (db) {
        var all = await getAll(db, 'studyLogs');
        return all.sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')) || (b.createdAt || 0) - (a.createdAt || 0); });
      });
    },
    async saveStudyLog(log) {
      return withDb(async function (db) {
        var rec = clone(log);
        rec.id = rec.id || uid('log');
        rec.date = rec.date || new Date().toISOString().slice(0, 10);
        rec.content = String(rec.content || '').trim();
        if (!rec.content) throw new Error('学习内容不能为空');
        rec.source = 'manual';
        rec.createdAt = rec.createdAt || Date.now();
        rec.updatedAt = Date.now();
        await put(db, 'studyLogs', rec);
        return rec;
      });
    },
    async deleteStudyLog(id) { return withDb(function (db) { return del(db, 'studyLogs', id); }); },
    async getAllGradingRecords() { return withDb(function (db) { return getAll(db, 'gradingRecords'); }); },
    async getAllAttemptsLegacy() { return withDb(function (db) { return getAll(db, 'attempts'); }); },
    async getAllSessions() { return withDb(function (db) { return getAll(db, 'sessions'); }); },
    async getAllExams() { return withDb(function (db) { return getAll(db, 'exams'); }); },
    async getAllQuestionTags() { return withDb(function (db) { return getAll(db, 'questionTags'); }); },
    async getAllQuestions() { return withDb(function (db) { return getAll(db, 'questions'); }); }
  };
  root.DiagnosisStore = api;
})(typeof window !== 'undefined' ? window : globalThis);
