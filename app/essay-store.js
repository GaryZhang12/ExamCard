/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright 2026 ExamCard contributors */
/* ExamCard V4.0 · 申论数据层（复用 ExamStore 的 IndexedDB v3 连接） */
(function (root) {
  'use strict';

  var TYPES = [
    { id: 'summary', label: '归纳概括' },
    { id: 'analysis', label: '综合分析' },
    { id: 'measure', label: '提出对策' },
    { id: 'implement', label: '贯彻执行' },
    { id: 'essay', label: '议论文' },
    { id: 'other', label: '待确认/其他' }
  ];

  function uid(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

  async function withDb(fn) { return root.ExamStore.withDb(fn); }

  async function getAll(store) {
    return withDb(function (db) {
      return new Promise(function (resolve, reject) {
        var req = db.transaction(store, 'readonly').objectStore(store).getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  async function get(store, key) {
    return withDb(function (db) {
      return new Promise(function (resolve, reject) {
        var req = db.transaction(store, 'readonly').objectStore(store).get(key);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  async function put(store, value) {
    return withDb(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value);
        tx.oncomplete = function () { resolve(value); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  async function del(store, key) {
    return withDb(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).delete(key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  async function byIndex(store, index, key) {
    return withDb(function (db) {
      return new Promise(function (resolve, reject) {
        var req = db.transaction(store, 'readonly').objectStore(store).index(index).getAll(key);
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  var api = {
    TYPES: TYPES,
    uid: uid,

    async listExams() {
      var list = await getAll('essayExams');
      return list.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    },
    async getExam(id) { return get('essayExams', id); },
    async saveExam(exam, materialBlob, pageCount) {
      exam.id = exam.id || uid('essay-exam');
      exam.createdAt = exam.createdAt || Date.now();
      exam.updatedAt = Date.now();
      exam.prompts = (exam.prompts || []).map(function (p) {
        p.id = p.id || uid('essay-p');
        return p;
      });
      exam.materialId = exam.id;
      var saved = clone(exam);
      var material = { id: exam.id, examId: exam.id, blob: materialBlob, pageCount: pageCount || 1, savedAt: Date.now() };
      await withDb(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(['essayExams', 'essayMaterials'], 'readwrite');
          tx.objectStore('essayExams').put(saved);
          tx.objectStore('essayMaterials').put(material);
          tx.oncomplete = function () { resolve(); };
          tx.onerror = function () { reject(tx.error); };
          tx.onabort = function () { reject(tx.error || new Error('申论试卷创建失败')); };
        });
      });
      return exam;
    },
    async getMaterial(examId) {
      var rec = await get('essayMaterials', examId);
      return rec ? rec.blob : null;
    },
    async getMaterialInfo(examId) { return get('essayMaterials', examId); },
    async deleteExam(examId) {
      // Read IDs first, then remove all dependent rows in one readwrite transaction.
      // A failure aborts the whole transaction instead of leaving a partially deleted exam.
      var sessions = await byIndex('essaySessions', 'examId', examId);
      var reviews = await byIndex('essayReviews', 'examId', examId);
      var versions = [];
      for (var i = 0; i < sessions.length; i++) {
        var vs = await byIndex('essayAnswerVersions', 'sessionId', sessions[i].id);
        versions = versions.concat(vs);
      }
      await withDb(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(['essayExams', 'essayMaterials', 'essaySessions', 'essayAnswerVersions', 'essayReviews'], 'readwrite');
          versions.forEach(function (v) { tx.objectStore('essayAnswerVersions').delete(v.id); });
          sessions.forEach(function (s) { tx.objectStore('essaySessions').delete(s.id); });
          reviews.forEach(function (r) { tx.objectStore('essayReviews').delete(r.id); });
          tx.objectStore('essayExams').delete(examId);
          tx.objectStore('essayMaterials').delete(examId);
          tx.oncomplete = function () { resolve(); };
          tx.onerror = function () { reject(tx.error || new Error('删除申论试卷失败')); };
          tx.onabort = function () { reject(tx.error || new Error('删除申论试卷事务已中止，数据未修改')); };
        });
      });
    },

    async putSession(session) { return put('essaySessions', clone(session)); },
    async getSession(id) { return get('essaySessions', id); },
    async listSessionsForExam(examId) {
      var list = await byIndex('essaySessions', 'examId', examId);
      return list.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    },
    async deleteSession(id) {
      var vs = await byIndex('essayAnswerVersions', 'sessionId', id);
      for (var i = 0; i < vs.length; i++) await del('essayAnswerVersions', vs[i].id);
      var reviews = await byIndex('essayReviews', 'sessionId', id);
      for (var j = 0; j < reviews.length; j++) await del('essayReviews', reviews[j].id);
      return del('essaySessions', id);
    },

    async saveVersion(version) {
      version.id = version.id || uid('essay-ver');
      version.createdAt = version.createdAt || Date.now();
      await put('essayAnswerVersions', clone(version));
      return version;
    },
    async listVersions(sessionId, promptId) {
      var list = promptId ? await byIndex('essayAnswerVersions', 'sessionPrompt', [sessionId, promptId]) : await byIndex('essayAnswerVersions', 'sessionId', sessionId);
      return list.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    },
    async getVersion(id) { return get('essayAnswerVersions', id); },
    async deleteVersion(id) { return del('essayAnswerVersions', id); },

    async saveReview(review) {
      review.id = review.id || uid('essay-review');
      review.importedAt = review.importedAt || Date.now();
      await put('essayReviews', clone(review));
      return review;
    },
    async getReview(id) { return get('essayReviews', id); },
    async listReviews(sessionId) {
      var list = await byIndex('essayReviews', 'sessionId', sessionId);
      return list.sort(function (a, b) { return (b.importedAt || 0) - (a.importedAt || 0); });
    }
  };

  root.EssayStore = api;
})(typeof window !== 'undefined' ? window : globalThis);
