/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright 2026 ExamCard contributors */
/* V3.1 本地存储：IndexedDB v2（兼容 v1 数据 + 稳定 questionId / ExamProfile / StandardAnswerSet / 批改记录） */
(function (root) {
  'use strict';

  var DB_NAME = 'gd_exam_v2';
  var DB_VERSION = 5;
  var SCHEMA_VERSION = 5;
  var MODEL_VERSION = 2;
  var dbPromise = null;

  /* ---------------- IndexedDB 基础 ---------------- */

  function openRaw() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      var blocked = false;
      req.onupgradeneeded = function () {
        var db = req.result;
        var tx = req.transaction;

        if (!db.objectStoreNames.contains('exams')) {
          var exams = db.createObjectStore('exams', { keyPath: 'id' });
          exams.createIndex('profileId', 'profileId', { unique: false });
        } else {
          var exStore = tx.objectStore('exams');
          if (!exStore.indexNames.contains('profileId')) exStore.createIndex('profileId', 'profileId', { unique: false });
        }
        if (!db.objectStoreNames.contains('pdfs')) db.createObjectStore('pdfs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('sessions')) {
          var sessions = db.createObjectStore('sessions', { keyPath: 'id' });
          sessions.createIndex('examId', 'examId', { unique: false });
          sessions.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('answers')) db.createObjectStore('answers', { keyPath: 'examId' });
        if (!db.objectStoreNames.contains('attempts')) {
          var attempts = db.createObjectStore('attempts', { keyPath: 'sessionId' });
          attempts.createIndex('examId', 'examId', { unique: false });
          attempts.createIndex('submittedAt', 'submittedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });

        if (!db.objectStoreNames.contains('questions')) {
          var questions = db.createObjectStore('questions', { keyPath: 'id' });
          questions.createIndex('examId', 'examId', { unique: false });
          questions.createIndex('module', 'module', { unique: false });
          questions.createIndex('number', 'number', { unique: false });
        }
        if (!db.objectStoreNames.contains('examProfiles')) {
          var profiles = db.createObjectStore('examProfiles', { keyPath: 'id' });
          profiles.createIndex('examType', 'examType', { unique: false });
        }
        if (!db.objectStoreNames.contains('standardAnswerSets')) {
          var sets = db.createObjectStore('standardAnswerSets', { keyPath: 'id' });
          sets.createIndex('examId', 'examId', { unique: false });
          sets.createIndex('examVersion', ['examId', 'version'], { unique: false });
        }
        if (!db.objectStoreNames.contains('gradingRecords')) {
          var grading = db.createObjectStore('gradingRecords', { keyPath: 'attemptId' });
          grading.createIndex('sessionId', 'sessionId', { unique: false });
          grading.createIndex('examId', 'examId', { unique: false });
          grading.createIndex('gradedAt', 'gradedAt', { unique: false });
        }

        if (!db.objectStoreNames.contains('essayExams')) {
          db.createObjectStore('essayExams', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('essayMaterials')) {
          var em = db.createObjectStore('essayMaterials', { keyPath: 'id' });
          em.createIndex('examId', 'examId', { unique: false });
        }
        if (!db.objectStoreNames.contains('essaySessions')) {
          var es = db.createObjectStore('essaySessions', { keyPath: 'id' });
          es.createIndex('examId', 'examId', { unique: false });
          es.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('essayAnswerVersions')) {
          var ev = db.createObjectStore('essayAnswerVersions', { keyPath: 'id' });
          ev.createIndex('sessionId', 'sessionId', { unique: false });
          ev.createIndex('promptId', 'promptId', { unique: false });
          ev.createIndex('sessionPrompt', ['sessionId', 'promptId'], { unique: false });
          ev.createIndex('createdAt', 'createdAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('essayReviews')) {
          var er = db.createObjectStore('essayReviews', { keyPath: 'id' });
          er.createIndex('sessionId', 'sessionId', { unique: false });
          er.createIndex('examId', 'examId', { unique: false });
          er.createIndex('importedAt', 'importedAt', { unique: false });
        }

        if (!db.objectStoreNames.contains('knowledgeTags')) {
          var kt = db.createObjectStore('knowledgeTags', { keyPath: 'id' });
          kt.createIndex('examType', 'examType', { unique: false });
          kt.createIndex('moduleName', 'moduleName', { unique: false });
          kt.createIndex('parentId', 'parentId', { unique: false });
          kt.createIndex('enabled', 'enabled', { unique: false });
        }
        if (!db.objectStoreNames.contains('questionTags')) {
          var qt = db.createObjectStore('questionTags', { keyPath: 'id' });
          qt.createIndex('questionId', 'questionId', { unique: false });
          qt.createIndex('tagId', 'tagId', { unique: false });
          qt.createIndex('examId', 'examId', { unique: false });
        }
        if (!db.objectStoreNames.contains('studyLogs')) {
          var sl = db.createObjectStore('studyLogs', { keyPath: 'id' });
          sl.createIndex('date', 'date', { unique: false });
          sl.createIndex('createdAt', 'createdAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('textbooks')) {
          var tb = db.createObjectStore('textbooks', { keyPath: 'id' });
          tb.createIndex('name', 'name', { unique: false });
          tb.createIndex('year', 'year', { unique: false });
        }
        if (!db.objectStoreNames.contains('textbookChapters')) {
          var tc = db.createObjectStore('textbookChapters', { keyPath: 'id' });
          tc.createIndex('textbookId', 'textbookId', { unique: false });
          tc.createIndex('parentId', 'parentId', { unique: false });
        }
        if (!db.objectStoreNames.contains('courses')) {
          var co = db.createObjectStore('courses', { keyPath: 'id' });
          co.createIndex('chapterId', 'chapterId', { unique: false });
          co.createIndex('status', 'status', { unique: false });
        }
        if (!db.objectStoreNames.contains('learningTasks')) {
          var lt = db.createObjectStore('learningTasks', { keyPath: 'id' });
          lt.createIndex('date', 'date', { unique: false });
          lt.createIndex('dueDate', 'dueDate', { unique: false });
          lt.createIndex('status', 'status', { unique: false });
          lt.createIndex('type', 'type', { unique: false });
        }
      };
      req.onblocked = function () {
        blocked = true;
        reject(new Error('IndexedDB 升级被其他页面连接阻塞，请关闭其他应用窗口后重试'));
      };
      req.onsuccess = function () {
        var db = req.result;
        if (blocked) { db.close(); return; }
        db.onversionchange = function () {
          try { db.close(); } catch (e) { /* ignore */ }
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = function () { reject(req.error || new Error('无法打开 IndexedDB')); };
    });
  }

  function txDone(tx) {
    return new Promise(function (resolve, reject) {
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error || new Error('IndexedDB 事务失败')); };
      tx.onabort = function () { reject(tx.error || new Error('IndexedDB 事务中止')); };
    });
  }

  function get(db, storeName, key) {
    return new Promise(function (resolve, reject) {
      var req = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function getAll(db, storeName) {
    return new Promise(function (resolve, reject) {
      var req = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
      req.onsuccess = function () { resolve(req.result || []); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function getAllByIndex(db, storeName, indexName, key) {
    return new Promise(function (resolve, reject) {
      var req = db.transaction(storeName, 'readonly').objectStore(storeName).index(indexName).getAll(key);
      req.onsuccess = function () { resolve(req.result || []); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function putOne(db, storeName, value) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value);
      tx.oncomplete = function () { resolve(value); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error || new Error('IndexedDB 事务中止')); };
    });
  }

  function deleteOne(db, storeName, key) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  }

  /* ---------------- 通用 ---------------- */

  function sha256Text(text) {
    if (!root.crypto || !root.crypto.subtle) throw new Error('运行环境不支持 Web Crypto SHA-256');
    return root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text))).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    });
  }

  function canonical(value) {
    if (value === null || value === undefined) return 'null';
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (typeof value === 'object') {
      return '{' + Object.keys(value).sort().map(function (k) { return JSON.stringify(k) + ':' + canonical(value[k]); }).join(',') + '}';
    }
    return JSON.stringify(value);
  }

  function cleanIdPart(s) { return String(s).replace(/[^a-zA-Z0-9_-]/g, '_'); }

  function makeQuestionId(examId, n, suffix) {
    return 'q-' + cleanIdPart(examId) + '-' + cleanIdPart(n) + (suffix ? ('-' + suffix) : '');
  }

  var DEFAULT_PROFILES = [
    { id: 'gd', name: '广东省考', examType: 'guangdong', builtIn: true, rules: null },
    { id: 'sz', name: '深圳市考', examType: 'shenzhen', builtIn: true, rules: null },
    { id: 'unknown', name: '未识别/自定义考试', examType: 'unknown', builtIn: true, rules: null }
  ];

  function profileForExam(exam) {
    if (exam && exam.profileId) return exam.profileId;
    // 仅内置的广东省考卷明确归类；导入卷不自动猜测考试类型，保留 unknown 待人工确认。
    if (exam && exam.source === 'builtin') return 'gd';
    return 'unknown';
  }

  function normalizeExamModel(exam) {
    var out = Object.assign({}, exam);
    out.profileId = profileForExam(out);
    out.examType = out.profileId;
    out.modelVersion = MODEL_VERSION;
    var qs = Array.isArray(out.questions) ? out.questions : [];
    var seenIds = {};
    var seenNums = {};
    out.questions = qs.map(function (q, idx) {
      var n = (q && q.n != null) ? q.n : (idx + 1);
      var qid = q && (q.questionId || q.id);
      var needsReview = false;
      if (!qid || typeof qid !== 'string' || !qid.trim()) {
        qid = makeQuestionId(out.id, n, '');
        needsReview = true;
      }
      if (seenIds[qid]) { qid = makeQuestionId(out.id, n, 'd' + idx); needsReview = true; }
      if (seenNums[String(n)]) needsReview = true;
      seenIds[qid] = true;
      seenNums[String(n)] = true;
      var qq = Object.assign({}, q);
      qq.n = n;
      qq.questionId = qid;
      qq.questionNumber = n;
      qq.idSource = q && q.idSource ? q.idSource : (needsReview ? 'derived-needs-review' : 'derived');
      qq.needsReview = !!(q && q.needsReview) || needsReview;
      qq.modelVersion = MODEL_VERSION;
      return qq;
    });
    return out;
  }

  function questionRecord(exam, q) {
    return {
      id: q.questionId,
      examId: exam.id,
      number: q.n,
      questionNumber: q.questionNumber != null ? q.questionNumber : q.n,
      type: q.type || 'single',
      module: q.module || '未分类',
      page: q.page || 1,
      yRatio: q.yRatio == null ? 0 : q.yRatio,
      xRatio: q.xRatio == null ? 0 : q.xRatio,
      preview: q.preview || '',
      options: Array.isArray(q.options) ? q.options : [],
      optionStatus: q.optionStatus || 'n/a',
      issues: Array.isArray(q.issues) ? q.issues : [],
      reviewStatus: q.reviewStatus || 'ok',
      manualEdited: !!q.manualEdited,
      source: q.source || null,
      copyright: q.copyright || null,
      idSource: q.idSource || 'derived',
      needsReview: !!q.needsReview,
      modelVersion: MODEL_VERSION,
      updatedAt: Date.now()
    };
  }

  /* ---------------- 迁移 ---------------- */

  async function ensureProfiles(db) {
    var existing = await getAll(db, 'examProfiles');
    var map = {};
    existing.forEach(function (p) { map[p.id] = p; });
    var tx = db.transaction('examProfiles', 'readwrite');
    var store = tx.objectStore('examProfiles');
    DEFAULT_PROFILES.forEach(function (p) {
      if (!map[p.id]) store.put(Object.assign({ createdAt: Date.now() }, p));
    });
    await txDone(tx);
  }

  async function migrateExams(db) {
    var exams = await getAll(db, 'exams');
    if (!exams.length) return;
    var tx = db.transaction(['exams', 'questions'], 'readwrite');
    var examStore = tx.objectStore('exams');
    var qStore = tx.objectStore('questions');
    exams.forEach(function (exam) {
      var normalized = normalizeExamModel(exam);
      normalized.updatedAt = normalized.updatedAt || Date.now();
      examStore.put(normalized);
      normalized.questions.forEach(function (q) { qStore.put(questionRecord(normalized, q)); });
    });
    await txDone(tx);
  }

  async function migrateStandardAnswers(db) {
    var records = await getAll(db, 'answers');
    var sets = await getAll(db, 'standardAnswerSets');
    if (!records.length) return;
    var byExam = {};
    sets.forEach(function (s) {
      if (!byExam[s.examId]) byExam[s.examId] = [];
      byExam[s.examId].push(s);
    });
    for (var i = 0; i < records.length; i++) {
      var rec = records[i];
      var list = (byExam[rec.examId] || []).slice().sort(function (a, b) { return a.version - b.version; });
      if (rec.currentSetId && list.some(function (s) { return s.id === rec.currentSetId; })) continue;
      if (!list.length) {
        var answers = rec.answers || {};
        var explanations = rec.explanations || {};
        var source = rec.source || null;
        var checksum = await sha256Text(canonical({ examId: rec.examId, version: 1, answers: answers, explanations: explanations }));
        var set = {
          id: 'std-' + cleanIdPart(rec.examId) + '-v1',
          examId: rec.examId,
          version: 1,
          answers: answers,
          explanations: explanations,
          source: source,
          checksum: checksum,
          createdAt: rec.updatedAt || Date.now(),
          previousSetId: null,
          modelVersion: MODEL_VERSION
        };
        await putOne(db, 'standardAnswerSets', set);
        await putOne(db, 'answers', Object.assign({}, rec, {
          currentSetId: set.id,
          version: 1,
          answers: answers,
          explanations: explanations,
          source: source,
          updatedAt: rec.updatedAt || Date.now()
        }));
      } else {
        var latest = list[list.length - 1];
        await putOne(db, 'answers', Object.assign({}, rec, {
          currentSetId: latest.id,
          version: latest.version,
          answers: latest.answers || rec.answers || {},
          explanations: latest.explanations || rec.explanations || {},
          source: latest.source || rec.source || null
        }));
      }
    }
  }

  async function runMigrations(db) {
    var meta = await get(db, 'meta', 'migration.v2');
    if (meta && meta.value && meta.value.status === 'complete') return;
    var startedAt = Date.now();
    await putOne(db, 'meta', { key: 'migration.v2', value: { status: 'running', dbVersion: DB_VERSION, startedAt: startedAt } });
    try {
      await ensureProfiles(db);
      await migrateExams(db);
      await migrateStandardAnswers(db);
      await putOne(db, 'meta', {
        key: 'migration.v2',
        value: {
          status: 'complete',
          dbVersion: DB_VERSION,
          schemaVersion: SCHEMA_VERSION,
          modelVersion: MODEL_VERSION,
          startedAt: startedAt,
          completedAt: Date.now()
        }
      });
    } catch (err) {
      await putOne(db, 'meta', {
        key: 'migration.v2',
        value: {
          status: 'failed',
          dbVersion: DB_VERSION,
          startedAt: startedAt,
          failedAt: Date.now(),
          error: (err && err.message) ? err.message : String(err)
        }
      }).catch(function () {});
      throw err;
    }
  }

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = openRaw().then(async function (db) {
      try {
        await runMigrations(db);
        return db;
      } catch (err) {
        try { db.close(); } catch (e) { /* ignore */ }
        throw err;
      }
    }).catch(function (err) {
      dbPromise = null;
      throw err;
    });
    return dbPromise;
  }

  async function withDb(fn) {
    var db = await open();
    return fn(db);
  }

  /* ---------------- 公开 API ---------------- */

  var api = {
    open: open,
    close: function () {
      if (!dbPromise) return;
      var p = dbPromise;
      dbPromise = null;
      p.then(function (db) { try { db.close(); } catch (e) {} }).catch(function () {});
    },
    withDb: withDb,
    getSchemaInfo: async function () {
      var db = await open();
      var meta = await get(db, 'meta', 'migration.v2');
      return {
        dbName: DB_NAME,
        dbVersion: db.version,
        schemaVersion: SCHEMA_VERSION,
        modelVersion: MODEL_VERSION,
        stores: Array.prototype.slice.call(db.objectStoreNames),
        migration: meta ? meta.value : null
      };
    },

    /* 试卷 */
    async listExams() {
      return withDb(async function (db) {
        var all = await getAll(db, 'exams');
        return all.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
      });
    },
    async getExam(id) {
      return withDb(function (db) { return get(db, 'exams', id); });
    },
    async putExam(exam) {
      return withDb(async function (db) {
        var normalized = normalizeExamModel(exam);
        if (!normalized.id) throw new Error('试卷缺少 id');
        normalized.createdAt = normalized.createdAt || Date.now();
        normalized.updatedAt = Date.now();
        var tx = db.transaction(['exams', 'questions'], 'readwrite');
        tx.objectStore('exams').put(normalized);
        var qStore = tx.objectStore('questions');
        normalized.questions.forEach(function (q) { qStore.put(questionRecord(normalized, q)); });
        await txDone(tx);
        return normalized;
      });
    },
    async putExamPdf(examId, blob) {
      return withDb(function (db) { return putOne(db, 'pdfs', { id: examId, blob: blob, savedAt: Date.now() }); });
    },
    async getExamPdf(examId) {
      return withDb(async function (db) {
        var rec = await get(db, 'pdfs', examId);
        return rec ? rec.blob : null;
      });
    },
    async deleteExam(examId) {
      return withDb(async function (db) {
        var questions = await getAllByIndex(db, 'questions', 'examId', examId);
        var sessions = await getAllByIndex(db, 'sessions', 'examId', examId);
        var attempts = await getAllByIndex(db, 'attempts', 'examId', examId);
        var sets = await getAllByIndex(db, 'standardAnswerSets', 'examId', examId);
        var grades = await getAllByIndex(db, 'gradingRecords', 'examId', examId);
        var tx = db.transaction(['exams', 'questions', 'pdfs', 'sessions', 'attempts', 'answers', 'standardAnswerSets', 'gradingRecords'], 'readwrite');
        tx.objectStore('exams').delete(examId);
        tx.objectStore('pdfs').delete(examId);
        tx.objectStore('answers').delete(examId);
        questions.forEach(function (q) { tx.objectStore('questions').delete(q.id); });
        sessions.forEach(function (s) { tx.objectStore('sessions').delete(s.id); });
        attempts.forEach(function (a) { tx.objectStore('attempts').delete(a.sessionId); });
        sets.forEach(function (s) { tx.objectStore('standardAnswerSets').delete(s.id); });
        grades.forEach(function (g) { tx.objectStore('gradingRecords').delete(g.attemptId); });
        await txDone(tx);
      });
    },

    /* 题目 */
    async getQuestion(id) { return withDb(function (db) { return get(db, 'questions', id); }); },
    async listQuestionsForExam(examId) {
      return withDb(async function (db) {
        var list = await getAllByIndex(db, 'questions', 'examId', examId);
        return list.sort(function (a, b) { return a.questionNumber - b.questionNumber; });
      });
    },

    /* ExamProfile */
    async listExamProfiles() { return withDb(function (db) { return getAll(db, 'examProfiles'); }); },
    async getExamProfile(id) { return withDb(function (db) { return get(db, 'examProfiles', id); }); },
    async putExamProfile(profile) {
      return withDb(async function (db) {
        var rec = Object.assign({}, profile);
        if (!rec.id) throw new Error('考试配置缺少 id');
        rec.updatedAt = Date.now();
        await putOne(db, 'examProfiles', rec);
        return rec;
      });
    },

    /* 会话 */
    async putSession(session) { return withDb(function (db) { return putOne(db, 'sessions', session); }); },
    async getSession(id) { return withDb(function (db) { return get(db, 'sessions', id); }); },
    async listSessionsForExam(examId) {
      return withDb(async function (db) {
        var all = await getAllByIndex(db, 'sessions', 'examId', examId);
        return all.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
      });
    },
    async deleteSession(id) { return withDb(function (db) { return deleteOne(db, 'sessions', id); }); },

    /* 标准答案集 */
    async putStd(examId, std) {
      return withDb(async function (db) {
        var sets = await getAllByIndex(db, 'standardAnswerSets', 'examId', examId);
        var current = await get(db, 'answers', examId);
        var maxVersion = 0;
        sets.forEach(function (s) { if (s.version > maxVersion) maxVersion = s.version; });
        if (!maxVersion && current && current.version) maxVersion = current.version;
        var version = maxVersion + 1;
        var answers = (std && std.answers) || {};
        var explanations = (std && std.explanations) || {};
        var source = (std && std.source) || null;
        var checksum = await sha256Text(canonical({ examId: examId, version: version, answers: answers, explanations: explanations }));
        var set = {
          id: 'std-' + cleanIdPart(examId) + '-v' + version,
          examId: examId,
          version: version,
          answers: answers,
          explanations: explanations,
          source: source,
          checksum: checksum,
          createdAt: Date.now(),
          previousSetId: current && current.currentSetId ? current.currentSetId : null,
          modelVersion: MODEL_VERSION
        };
        var tx = db.transaction(['standardAnswerSets', 'answers'], 'readwrite');
        tx.objectStore('standardAnswerSets').put(set);
        tx.objectStore('answers').put({
          examId: examId,
          currentSetId: set.id,
          version: version,
          answers: answers,
          explanations: explanations,
          source: source,
          updatedAt: Date.now()
        });
        await txDone(tx);
        return set;
      });
    },
    async getStd(examId) {
      return withDb(async function (db) {
        var current = await get(db, 'answers', examId);
        if (!current) return null;
        if (current.currentSetId) {
          var set = await get(db, 'standardAnswerSets', current.currentSetId);
          if (set) {
            return {
              answers: set.answers || {},
              explanations: set.explanations || {},
              source: set.source || null,
              setId: set.id,
              version: set.version,
              createdAt: set.createdAt,
              checksum: set.checksum
            };
          }
        }
        return {
          answers: current.answers || {},
          explanations: current.explanations || {},
          source: current.source || null,
          setId: null,
          version: current.version || null
        };
      });
    },
    async listStdVersions(examId) {
      return withDb(async function (db) {
        var sets = await getAllByIndex(db, 'standardAnswerSets', 'examId', examId);
        return sets.sort(function (a, b) { return b.version - a.version; });
      });
    },
    async deleteStd(examId) {
      // 保留历史答案集，只清除当前指向；新版本继续递增，避免历史成绩失去来源。
      return withDb(function (db) { return deleteOne(db, 'answers', examId); });
    },

    /* 旧 attempts（兼容） */
    async putAttempt(attempt) { return withDb(function (db) { return putOne(db, 'attempts', attempt); }); },
    async getAttempt(sessionId) { return withDb(function (db) { return get(db, 'attempts', sessionId); }); },
    async listAttemptsForExam(examId) {
      return withDb(async function (db) {
        var all = await getAllByIndex(db, 'attempts', 'examId', examId);
        return all.sort(function (a, b) { return (b.submittedAt || 0) - (a.submittedAt || 0); });
      });
    },

    /* 批改记录（批次 C 使用；B 只建表） */
    async putGradingRecord(record) { return withDb(function (db) { return putOne(db, 'gradingRecords', record); }); },
    async getGradingRecord(attemptId) { return withDb(function (db) { return get(db, 'gradingRecords', attemptId); }); },
    async listGradingRecordsForSession(sessionId) {
      return withDb(async function (db) {
        var all = await getAllByIndex(db, 'gradingRecords', 'sessionId', sessionId);
        return all.sort(function (a, b) { return (a.gradedAt || 0) - (b.gradedAt || 0); });
      });
    },
    async listGradingRecordsForExam(examId) {
      return withDb(async function (db) {
        var all = await getAllByIndex(db, 'gradingRecords', 'examId', examId);
        return all.sort(function (a, b) { return (b.gradedAt || 0) - (a.gradedAt || 0); });
      });
    },

    /* 全量清空用户学习数据：保留考试类型配置与升级元数据，其他 store 在同一事务中清空。 */
    async clearUserData() {
      if (root.TextbookImport && root.TextbookImport.stopForClear) await root.TextbookImport.stopForClear();
      return withDb(async function (db) {
        var stores = Array.prototype.slice.call(db.objectStoreNames);
        if (stores.indexOf('examProfiles') < 0 || stores.indexOf('meta') < 0) throw new Error('数据库结构不完整，无法安全清空');
        var migration = await get(db, 'meta', 'migration.v2');
        var tx = db.transaction(stores, 'readwrite');
        stores.forEach(function (name) {
          if (name === 'examProfiles') return;
          tx.objectStore(name).clear();
        });
        if (migration) tx.objectStore('meta').put(migration);
        await txDone(tx);
        return {
          stores: stores,
          preserved: ['examProfiles', 'meta:migration.v2'],
          clearedStores: stores.filter(function (name) { return name !== 'examProfiles' && name !== 'meta'; }).concat(['meta (except migration.v2)'])
        };
      });
    },
    /* 元数据 */
    async getMeta(key) { return withDb(async function (db) { var r = await get(db, 'meta', key); return r ? r.value : null; }); },
    async setMeta(key, value) { return withDb(function (db) { return putOne(db, 'meta', { key: key, value: value }); }); },
    async removeMeta(key) { return withDb(function (db) { return deleteOne(db, 'meta', key); }); }
  };

  root.ExamStore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
