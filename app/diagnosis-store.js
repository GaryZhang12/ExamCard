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
      tx.onabort = function () { rej(tx.error || new Error('数据写入事务已中止')); };
    });
  }
  function del(db, store, key) {
    return new Promise(function (res, rej) {
      var tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = res;
      tx.onerror = function () { rej(tx.error); };
      tx.onabort = function () { rej(tx.error || new Error('数据删除事务已中止')); };
    });
  }
  function txDone(tx) {
    return new Promise(function (res, rej) {
      tx.oncomplete = function () { res(); };
      tx.onerror = function () { rej(tx.error || new Error('学习记录事务失败')); };
      tx.onabort = function () { rej(tx.error || new Error('学习记录事务已中止')); };
    });
  }
  function assertStudyLogModel() {
    if (!root.StudyLog) throw new Error('学习记录模型未加载');
  }
  function duplicateExternalKey(all, rec, ownId) {
    var key = root.StudyLog.externalKeyOf(rec);
    if (!key) return null;
    return all.filter(function (x) {
      return x.id !== ownId && x.status !== 'deleted' && root.StudyLog.externalKeyOf(x) === key;
    })[0] || null;
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
    async getStudyLog(id) {
      return withDb(function (db) { return get(db, 'studyLogs', id); });
    },
    async saveStudyLog(log, options) {
      assertStudyLogModel();
      options = options || {};
      var now = Date.now();
      var normalized = root.StudyLog.normalize(log, { now: now });
      if (normalized.errors.length) {
        var ve = new Error('学习记录校验失败：' + normalized.errors[0].path + '：' + normalized.errors[0].message);
        ve.details = normalized.errors;
        throw ve;
      }
      return withDb(async function (db) {
        var tx = db.transaction('studyLogs', 'readwrite');
        var store = tx.objectStore('studyLogs');
        var done = txDone(tx);
        try {
          var all = await reqP(store.getAll());
          var rec = normalized.value;
          var old = rec.id ? await reqP(store.get(rec.id)) : null;
          if (old) {
            if (old.revision != null && options.expectedRevision == null && options.expectedUpdatedAt == null) {
              var lockErr = new Error('保存学习记录必须提供当前版本号，已拒绝静默覆盖');
              lockErr.code = 'STUDY_LOG_CONFLICT';
              throw lockErr;
            }
            rec = root.StudyLog.applyUpdate(old, rec, {
              reason: options.reason || '修改学习记录',
              now: now,
              expectedRevision: options.expectedRevision,
              expectedUpdatedAt: options.expectedUpdatedAt
            });
          } else {
            if (options.expectedRevision != null) {
              var goneErr = new Error('学习记录已被删除或替换，请刷新后重试');
              goneErr.code = 'STUDY_LOG_CONFLICT';
              throw goneErr;
            }
            rec.id = rec.id || root.StudyLog.uid();
            rec.createdAt = rec.createdAt || now;
            rec.updatedAt = now;
            rec.revision = 1;
            rec.revisions = [{ at: now, action: options.action || 'create', reason: String(options.reason || '新增学习记录').trim().slice(0, 1000), after: root.StudyLog.auditSnapshot(rec) }];
          }
          var dup = duplicateExternalKey(all, rec, rec.id);
          if (dup) throw new Error('外部练习已存在：' + rec.source + ' / ' + rec.externalId);
          await reqP(store.put(rec));
          await done;
          return rec;
        } catch (e) {
          try { tx.abort(); } catch (ignore) {}
          await done.catch(function () {});
          throw e;
        }
      });
    },
    async updateStudyLog(id, patch, options) {
      assertStudyLogModel();
      options = options || {};
      if (options.expectedRevision == null && options.expectedUpdatedAt == null) {
        var lockMissing = new Error('编辑学习记录必须提供当前版本号，已拒绝旧编辑静默覆盖');
        lockMissing.code = 'STUDY_LOG_CONFLICT';
        throw lockMissing;
      }
      var now = Date.now();
      return withDb(async function (db) {
        var tx = db.transaction('studyLogs', 'readwrite');
        var store = tx.objectStore('studyLogs');
        var done = txDone(tx);
        try {
          var old = await reqP(store.get(id));
          if (!old) throw new Error('学习记录不存在');
          var rec = root.StudyLog.applyUpdate(old, patch || {}, {
            reason: options.reason || '修改学习记录',
            now: now,
            expectedRevision: options.expectedRevision,
            expectedUpdatedAt: options.expectedUpdatedAt
          });
          var all = await reqP(store.getAll());
          var dup = duplicateExternalKey(all, rec, id);
          if (dup) throw new Error('外部练习已存在：' + rec.source + ' / ' + rec.externalId);
          await reqP(store.put(rec));
          await done;
          return rec;
        } catch (e) {
          try { tx.abort(); } catch (ignore) {}
          await done.catch(function () {});
          throw e;
        }
      });
    },
    async saveStudyLogs(logs, options) {
      assertStudyLogModel();
      options = options || {};
      var now = Date.now();
      var records = root.StudyLog.normalizeMany(logs, { now: now });
      return withDb(async function (db) {
        var tx = db.transaction('studyLogs', 'readwrite');
        var store = tx.objectStore('studyLogs');
        var done = txDone(tx);
        try {
          var all = await reqP(store.getAll());
          var seen = new Map();
          // Validate the full batch before the first put. Even if a later put
          // fails, the transaction aborts and no row or audit is left behind.
          var prepared = records.map(function (rec) {
            var copy = Object.assign({}, rec);
            copy.id = root.StudyLog.uid();
            copy.createdAt = now;
            copy.updatedAt = now;
            copy.revision = 1;
            copy.status = 'active';
            copy.deletedAt = null;
            copy.deletedReason = '';
            copy.revisions = [{ at: now, action: options.action || 'import', reason: String(options.reason || '批量导入学习记录').trim().slice(0, 1000), after: root.StudyLog.auditSnapshot(copy) }];
            var key = root.StudyLog.externalKeyOf(copy);
            if (key) {
              if (seen.has(key) || duplicateExternalKey(all, copy, copy.id)) throw new Error('外部练习已存在：' + copy.source + ' / ' + copy.externalId);
              seen.set(key, true);
            }
            return copy;
          });
          for (var i = 0; i < prepared.length; i++) await reqP(store.put(prepared[i]));
          await done;
          return prepared;
        } catch (e) {
          try { tx.abort(); } catch (ignore) {}
          await done.catch(function () {});
          throw e;
        }
      });
    },
    async deleteStudyLog(id, reason, options) {
      assertStudyLogModel();
      options = options || {};
      return withDb(async function (db) {
        var tx = db.transaction('studyLogs', 'readwrite');
        var store = tx.objectStore('studyLogs');
        var done = txDone(tx);
        try {
          var old = await reqP(store.get(id));
          if (!old) throw new Error('学习记录不存在');
          var rec = root.StudyLog.applyDelete(old, {
            reason: reason || '删除学习记录',
            now: Date.now(),
            expectedRevision: options.expectedRevision,
            expectedUpdatedAt: options.expectedUpdatedAt
          });
          await reqP(store.put(rec));
          await done;
          return rec;
        } catch (e) {
          try { tx.abort(); } catch (ignore) {}
          await done.catch(function () {});
          throw e;
        }
      });
    },
    async getAllGradingRecords() { return withDb(function (db) { return getAll(db, 'gradingRecords'); }); },
    async getAllAttemptsLegacy() { return withDb(function (db) { return getAll(db, 'attempts'); }); },
    async getAllSessions() { return withDb(function (db) { return getAll(db, 'sessions'); }); },
    async getAllExams() { return withDb(function (db) { return getAll(db, 'exams'); }); },
    async getAllQuestionTags() { return withDb(function (db) { return getAll(db, 'questionTags'); }); },
    async getAllQuestions() { return withDb(function (db) { return getAll(db, 'questions'); }); },
    async getAllEssayReviews() { return withDb(function (db) { return getAll(db, 'essayReviews'); }); },
    async getAllEssaySessions() { return withDb(function (db) { return getAll(db, 'essaySessions'); }); },
    async getAllEssayExams() { return withDb(function (db) { return getAll(db, 'essayExams'); }); }
  };
  root.DiagnosisStore = api;
})(typeof window !== 'undefined' ? window : globalThis);
