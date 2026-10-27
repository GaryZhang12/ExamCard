/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright 2026 ExamCard contributors */
/* ExamCard V5 · 学习管理数据层：教材/章节/课程/计划任务 */
(function (root) {
  'use strict';
  function uid(prefix) { return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }
  function reqp(req) { return new Promise(function (resolve, reject) { req.onsuccess = function () { resolve(req.result); }; req.onerror = function () { reject(req.error); }; }); }
  function all(db, store) { return reqp(db.transaction(store, 'readonly').objectStore(store).getAll()); }
  function put(db, store, value) { return reqp(db.transaction(store, 'readwrite').objectStore(store).put(value)); }
  function del(db, store, key) { return reqp(db.transaction(store, 'readwrite').objectStore(store).delete(key)); }
  function withDb(fn) { return ExamStore.withDb(fn); }

  async function listTextbooks() { return withDb(function (db) { return all(db, 'textbooks'); }); }
  async function saveTextbook(t) {
    return withDb(async function (db) {
      var rec = Object.assign({}, t);
      if (!rec.id) rec.id = uid('tb');
      rec.createdAt = rec.createdAt || Date.now(); rec.updatedAt = Date.now();
      rec.name = String(rec.name || '').trim();
      if (!rec.name) throw new Error('教材名称不能为空');
      await put(db, 'textbooks', rec); return rec;
    });
  }
  async function deleteTextbook(id) { return withDb(function (db) { return del(db, 'textbooks', id); }); }

  async function listChapters(textbookId) {
    return withDb(async function (db) {
      var list = await all(db, 'textbookChapters');
      return list.filter(function (c) { return !textbookId || c.textbookId === textbookId; });
    });
  }
  async function saveChapter(c) {
    return withDb(async function (db) {
      var rec = Object.assign({}, c);
      if (!rec.id) rec.id = uid('ch');
      rec.createdAt = rec.createdAt || Date.now(); rec.updatedAt = Date.now();
      rec.title = String(rec.title || '').trim();
      if (!rec.textbookId || !rec.title) throw new Error('章节需要教材和标题');
      rec.order = Number(rec.order) || 0;
      rec.progressPercent = Math.max(0, Math.min(100, Number(rec.progressPercent) || 0));
      rec.tagIds = Array.isArray(rec.tagIds) ? rec.tagIds : [];
      await put(db, 'textbookChapters', rec); return rec;
    });
  }
  async function clearChapters() {
    return withDb(function (db) {
      return new Promise(function (resolve, reject) {
        var req = db.transaction('textbookChapters', 'readwrite').objectStore('textbookChapters').clear();
        req.onsuccess = function () { resolve(true); }; req.onerror = function () { reject(req.error); };
      });
    });
  }
  async function deleteChapter(id) {
    return withDb(async function (db) {
      var list = await all(db, 'textbookChapters');
      var children = list.filter(function (c) { return c.parentId === id; });
      for (var i = 0; i < children.length; i++) { children[i].parentId = null; children[i].updatedAt = Date.now(); await put(db, 'textbookChapters', children[i]); }
      await del(db, 'textbookChapters', id);
    });
  }

  async function listCourses() { return withDb(function (db) { return all(db, 'courses'); }); }
  async function saveCourse(c) {
    return withDb(async function (db) {
      var rec = Object.assign({}, c);
      if (!rec.id) rec.id = uid('course');
      rec.createdAt = rec.createdAt || Date.now(); rec.updatedAt = Date.now();
      rec.name = String(rec.name || '').trim();
      if (!rec.name) throw new Error('课程名称不能为空');
      rec.durationMin = rec.durationMin == null || rec.durationMin === '' ? null : Math.max(0, Number(rec.durationMin));
      rec.learnedMin = rec.learnedMin == null || rec.learnedMin === '' ? 0 : Math.max(0, Number(rec.learnedMin));
      rec.tagIds = Array.isArray(rec.tagIds) ? rec.tagIds : [];
      await put(db, 'courses', rec); return rec;
    });
  }
  async function deleteCourse(id) { return withDb(function (db) { return del(db, 'courses', id); }); }

  async function listTasks() { return withDb(function (db) { return all(db, 'learningTasks'); }); }
  async function saveTask(t) {
    return withDb(async function (db) {
      var rec = Object.assign({}, t);
      if (!rec.id) rec.id = uid('task');
      rec.createdAt = rec.createdAt || Date.now(); rec.updatedAt = Date.now();
      rec.title = String(rec.title || '').trim();
      if (!rec.title) throw new Error('任务标题不能为空');
      rec.status = rec.status || 'pending';
      rec.planMinutes = rec.planMinutes == null || rec.planMinutes === '' ? null : Math.max(0, Number(rec.planMinutes));
      rec.planQuestions = rec.planQuestions == null || rec.planQuestions === '' ? null : Math.max(0, Number(rec.planQuestions));
      rec.actualMinutes = rec.actualMinutes == null || rec.actualMinutes === '' ? null : Math.max(0, Number(rec.actualMinutes));
      rec.actualQuestions = rec.actualQuestions == null || rec.actualQuestions === '' ? null : Math.max(0, Number(rec.actualQuestions));
      rec.actualCorrect = rec.actualCorrect == null || rec.actualCorrect === '' ? null : Math.max(0, Number(rec.actualCorrect));
      rec.tagIds = Array.isArray(rec.tagIds) ? rec.tagIds : [];
      rec.questionIds = Array.isArray(rec.questionIds) ? rec.questionIds : [];
      await put(db, 'learningTasks', rec); return rec;
    });
  }
  async function deleteTask(id) { return withDb(function (db) { return del(db, 'learningTasks', id); }); }
  async function applyDailyPlan(plan, records) {
    if (!plan || !plan.plan_id || !Array.isArray(records) || !records.length) throw new Error('没有可导入的计划任务');
    return withDb(async function (db) {
      var tx = db.transaction(['learningTasks', 'meta'], 'readwrite');
      var lt = tx.objectStore('learningTasks'), mt = tx.objectStore('meta');
      var txDone = new Promise(function (res, rej) { tx.oncomplete = res; tx.onerror = function () { rej(tx.error); }; tx.onabort = function () { rej(tx.error || new Error('计划导入事务已中止')); }; });
      try {
        var existing = await reqp(lt.getAll());
        var byKey = {};
        existing.forEach(function (x) { if (x.planId && x.planTaskId) byKey[x.planId + '|' + x.planTaskId] = x; });
        var now = Date.now(), created = 0, updated = 0, unchanged = 0, skippedCompleted = 0;
        for (var i = 0; i < records.length; i++) {
          var r = Object.assign({}, records[i]);
          var old = byKey[plan.plan_id + '|' + r.planTaskId] || null;
          if (old && old.status === 'completed') { skippedCompleted++; continue; }
          if (old && old.planHash === r.planHash && old.taskHash === r.taskHash) { unchanged++; continue; }
          var hist = old && Array.isArray(old.importHistory) ? old.importHistory.slice(-10) : [];
          hist.push({ at: now, action: old ? 'updated' : 'created', planHash: r.planHash, source: r.importSource || r.planSource || 'daily-plan-v1' });
          var rec;
          if (old) {
            rec = Object.assign({}, old, r);
            rec.id = old.id;
            rec.createdAt = old.createdAt || now;
            rec.status = old.status || 'pending';
            rec.completedAt = old.completedAt || null;
            rec.actualMinutes = old.actualMinutes == null ? null : old.actualMinutes;
            rec.actualQuestions = old.actualQuestions == null ? null : old.actualQuestions;
            rec.actualCorrect = old.actualCorrect == null ? null : old.actualCorrect;
            rec.actualSource = old.actualSource || null;
            rec.notes = old.notes || rec.notes || '';
            rec.tagIds = Array.isArray(old.tagIds) ? old.tagIds : (rec.tagIds || []);
            rec.questionIds = Array.isArray(old.questionIds) ? old.questionIds : (rec.questionIds || []);
            rec.stageActuals = Array.isArray(old.stageActuals) ? old.stageActuals : (rec.stageActuals || []);
            rec.courseId = rec.courseId || old.courseId || null;
            rec.textbookId = rec.textbookId || old.textbookId || null;
            rec.chapterId = rec.chapterId || old.chapterId || null;
            rec.examId = rec.examId || old.examId || null;
            rec.planRevision = (old.planRevision || 0) + 1;
            updated++;
          } else {
            rec = Object.assign({}, r);
            rec.status = 'pending';
            rec.completedAt = null;
            rec.actualMinutes = null; rec.actualQuestions = null; rec.actualCorrect = null; rec.actualSource = null;
            rec.stageActuals = Array.isArray(r.stageActuals) ? r.stageActuals : [];
            rec.createdAt = now;
            rec.planRevision = 1;
            created++;
          }
          delete rec.duplicate; delete rec.completed;
          rec.importHistory = hist;
          rec.updatedAt = now;
          rec.importedAt = now;
          await reqp(lt.put(rec));
        }
        var logRec = await reqp(mt.get('dailyPlanImports'));
        var logs = logRec && Array.isArray(logRec.value) ? logRec.value : [];
        logs.unshift({ at: now, planId: plan.plan_id, date: plan.date, title: plan.title, created: created, updated: updated, unchanged: unchanged, skippedCompleted: skippedCompleted });
        await reqp(mt.put({ key: 'dailyPlanImports', value: logs.slice(0, 50) }));
        await txDone;
        return { planId: plan.plan_id, created: created, updated: updated, unchanged: unchanged, skippedCompleted: skippedCompleted };
      } catch (e) {
        try { tx.abort(); } catch (ignore) {}
        throw e;
      }
    });
  }



  async function exportCatalog() {
    var textbooks = await listTextbooks(); var chapters = await listChapters();
    return { schema: 'examcard.textbook-catalog/v1', exportedAt: new Date().toISOString(), textbooks: textbooks, chapters: chapters };
  }
  function normTitle(s) { return String(s || '').replace(/\s+/g, '').trim(); }
  function validateCatalogTree(chapters) {
    var ids = {}, parents = {};
    for (var i = 0; i < chapters.length; i++) {
      var c = chapters[i];
      var id = c && c.id;
      if (!id) continue;
      if (ids[id]) throw new Error('章节 ID 重复：' + id);
      ids[id] = true; parents[id] = c.parentId || null;
    }
    Object.keys(parents).forEach(function (id) {
      if (parents[id] && !ids[parents[id]]) throw new Error('父章节不存在：' + parents[id]);
      var seen = {}; var cur = id;
      while (cur) {
        if (seen[cur]) throw new Error('章节父子关系存在循环：' + id);
        seen[cur] = true; cur = parents[cur] || null;
      }
    });
  }

  async function importCatalog(obj, options) {
    if (!obj || !Array.isArray(obj.textbooks) || !Array.isArray(obj.chapters)) throw new Error('Invalid textbook catalog JSON');
    options = options || {};
    validateCatalogTree(obj.chapters);
    var mode = options.mode || 'new';
    if (['new', 'merge', 'replace'].indexOf(mode) < 0) throw new Error('Unknown import mode');
    if ((mode === 'merge' || mode === 'replace') && !options.targetTextbookId) throw new Error('Merge/replace requires target textbook');
    return withDb(async function (db) {
      var tx = db.transaction(['textbooks', 'textbookChapters', 'courses', 'learningTasks', 'meta'], 'readwrite');
      var txDone = new Promise(function (res, rej) { tx.oncomplete = function () { res(); }; tx.onerror = function () { rej(tx.error); }; tx.onabort = function () { rej(tx.error || new Error('Import transaction aborted')); }; });
      try {
      var tStore = tx.objectStore('textbooks'), cStore = tx.objectStore('textbookChapters');
      var coStore = tx.objectStore('courses'), ltStore = tx.objectStore('learningTasks'), mStore = tx.objectStore('meta');
      var existingBooks = await reqp(tStore.getAll());
      var existingChapters = await reqp(cStore.getAll());
      var courses = await reqp(coStore.getAll());
      var tasks = await reqp(ltStore.getAll());
      var now = Date.now();
      var result = { mode: mode, textbookId: null, created: 0, updated: 0, retainedReferenced: 0, conflicts: [], chapters: 0 };
      var bookMap = {};
      var targetBook = null;

      if (mode === 'new') {
        var sourceBooks = obj.textbooks.length ? obj.textbooks : [{ name: 'Imported textbook' }];
        for (var i = 0; i < sourceBooks.length; i++) {
          var b = sourceBooks[i];
          var rec = { id: uid('tb'), name: String(b.name || 'Imported textbook').trim(), publisher: b.publisher || '', edition: b.edition || '', year: b.year || null, source: b.source || 'catalog-import', notes: b.notes || '', createdAt: now, updatedAt: now };
          await reqp(tStore.put(rec));
          bookMap[b.id || ('__book' + i)] = rec.id;
          if (!result.textbookId) result.textbookId = rec.id;
          result.created++;
        }
      } else {
        targetBook = existingBooks.filter(function (x) { return x.id === options.targetTextbookId; })[0];
        if (!targetBook) throw new Error('Target textbook not found');
        var incoming = obj.textbooks.filter(function (x) { return x.id === options.targetTextbookId; })[0] || obj.textbooks[0] || {};
        var updatedBook = Object.assign({}, targetBook, {
          name: targetBook.name, publisher: incoming.publisher != null ? incoming.publisher : targetBook.publisher,
          edition: incoming.edition != null ? incoming.edition : targetBook.edition,
          year: incoming.year != null ? incoming.year : targetBook.year,
          source: targetBook.source, notes: targetBook.notes, updatedAt: now
        });
        await reqp(tStore.put(updatedBook));
        obj.textbooks.forEach(function (x) { bookMap[x.id] = targetBook.id; });
        result.textbookId = targetBook.id;
        if (mode === 'replace') await reqp(mStore.put({ key: 'catalogSnapshot.' + targetBook.id, value: { at: now, chapters: existingChapters.filter(function (c) { return c.textbookId === targetBook.id; }) } }));
      }

      var oldChaptersOfTarget = mode === 'new' ? [] : existingChapters.filter(function (c) { return c.textbookId === targetBook.id; });
      var usedIds = {};
      var parentMap = {};
      var ordered = obj.chapters.slice().sort(function (a, b) { return (Number(a.order) || 0) - (Number(b.order) || 0); });
      for (var j = 0; j < ordered.length; j++) {
        var ch = ordered[j];
        var tbId = mode === 'new' ? (bookMap[ch.textbookId] || result.textbookId) : targetBook.id;
        var extId = ch.id || ('__ch' + j);
        var match = null;
        if (mode !== 'new') {
          match = oldChaptersOfTarget.filter(function (x) { return x.id === ch.id; })[0] || oldChaptersOfTarget.filter(function (x) { return normTitle(x.title) === normTitle(ch.title) && x.parentId === (parentMap[ch.parentId] || null); })[0];
          if (match && mode === 'merge' && usedIds[match.id]) { result.conflicts.push({ title: ch.title, reason: 'duplicate title/id' }); match = null; }
        }
        var rec = match ? Object.assign({}, match) : {
          id: mode === 'new' ? uid('ch') : (ch.id && !oldChaptersOfTarget.some(function (x) { return x.id === ch.id; }) ? ch.id : uid('ch')),
          textbookId: tbId, createdAt: now
        };
        if (match) { rec.title = ch.title || rec.title; rec.order = Number(ch.order) || 0; rec.updatedAt = now; result.updated++; }
        else { rec.title = String(ch.title || '').trim(); rec.order = Number(ch.order) || 0; rec.progressPercent = Math.max(0, Math.min(100, Number(ch.progressPercent) || 0)); rec.progressNote = ch.progressNote || ''; rec.tagIds = Array.isArray(ch.tagIds) ? ch.tagIds : []; rec.updatedAt = now; result.created++; }
        rec.textbookId = tbId;
        rec.parentId = ch.parentId ? (parentMap[ch.parentId] || null) : null;
        await reqp(cStore.put(rec));
        usedIds[rec.id] = true;
        parentMap[extId] = rec.id;
        result.chapters++;
      }
      for (var k = 0; k < ordered.length; k++) {
        var ch2 = ordered[k]; var key2 = ch2.id || ('__ch' + k);
        var rec2 = await reqp(cStore.get(parentMap[key2]));
        if (!rec2) continue;
        rec2.parentId = ch2.parentId ? (parentMap[ch2.parentId] || null) : null;
        await reqp(cStore.put(rec2));
      }
      if (mode === 'replace') {
        var referenced = {};
        courses.forEach(function (c) { if (c.chapterId) referenced[c.chapterId] = true; });
        tasks.forEach(function (t) { if (t.chapterId) referenced[t.chapterId] = true; });
        var retain = {};
        var oldById = {}; oldChaptersOfTarget.forEach(function (x) { oldById[x.id] = x; });
        Object.keys(referenced).forEach(function (id) {
          var cur = oldById[id];
          while (cur && !retain[cur.id]) { retain[cur.id] = true; cur = cur.parentId ? oldById[cur.parentId] : null; }
        });
        for (var m = 0; m < oldChaptersOfTarget.length; m++) {
          var old = oldChaptersOfTarget[m];
          if (usedIds[old.id]) continue;
          if (retain[old.id]) { result.retainedReferenced++; continue; }
          await reqp(cStore.delete(old.id));
        }
      }
      await txDone;
      return result;
      } catch (e) {
        try { tx.abort(); } catch (ignore) {}
        throw e;
      }
    });
  }

  root.LearningStore = {
    listTextbooks: listTextbooks, saveTextbook: saveTextbook, deleteTextbook: deleteTextbook,
    listChapters: listChapters, saveChapter: saveChapter, deleteChapter: deleteChapter, clearChapters: clearChapters,
    listCourses: listCourses, saveCourse: saveCourse, deleteCourse: deleteCourse,
    listTasks: listTasks, saveTask: saveTask, deleteTask: deleteTask, applyDailyPlan: applyDailyPlan,
    exportCatalog: exportCatalog, importCatalog: importCatalog
  };
})(typeof window !== 'undefined' ? window : globalThis);
