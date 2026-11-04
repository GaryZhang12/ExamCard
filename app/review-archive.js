/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright 2026 ExamCard contributors */
/* ExamCard 1.2.0 P1 · Learning-review PDF archive.
   Stores an independent PDF copy and metadata in the existing meta store so the
   original file is never moved or overwritten and the 28-table backup already
   covers the archive. No new IndexedDB table is required. */
(function (root) {
  'use strict';
  var SCHEMA = 'examcard.review-report/v1';
  var INDEX_KEY = 'reviewReportsIndex';
  var RECORD_PREFIX = 'reviewReport:';
  var MAX_BYTES = 40 * 1024 * 1024;

  /* Cancellation epoch. Any await that can outlive the UI (file.arrayBuffer,
     SHA-256, PDF.js open, IndexedDB open/transaction) captures the epoch at
     start and verifies it again at each boundary. Clear/restore/close increments
     the epoch, so a delayed archive write cannot land after data replacement.
     `maintenance` additionally blocks brand-new writes while a destructive
     transaction is being prepared/executed. */
  var lifecycle = { epoch: 0, maintenance: null, transactions: [] };

  function cancellation(reason) {
    var e = new Error('归档操作已取消' + (reason ? '（' + reason + '）' : '') + '；未写入任何数据');
    e.name = 'ReviewArchiveCancelled';
    e.code = 'REVIEW_ARCHIVE_CANCELLED';
    return e;
  }
  function isCancelled(err) { return !!(err && err.code === 'REVIEW_ARCHIVE_CANCELLED'); }
  function epoch() { return lifecycle.epoch; }
  function cancelPending(reason) {
    lifecycle.epoch++;
    // 已启动的归档事务也立即中止；不能只依赖事件回调里的 epoch 检查，
    // 否则“保存后马上关闭/切换/恢复”仍可能让已排队事务提交。
    var txs = lifecycle.transactions.slice();
    lifecycle.transactions.length = 0;
    txs.forEach(function (tx) { try { tx.abort(); } catch (e) { /* already finished */ } });
    return lifecycle.epoch;
  }
  function stopForClear(reason) {
    lifecycle.maintenance = clean(reason) || '数据恢复或清空';
    return cancelPending(lifecycle.maintenance);
  }
  function resumeMaintenance(reason) {
    if (!lifecycle.maintenance) return;
    if (reason && lifecycle.maintenance !== clean(reason)) return;
    lifecycle.maintenance = null;
  }
  function ensureActive(token, phase) {
    if (lifecycle.maintenance) throw cancellation(lifecycle.maintenance);
    if (token != null && token !== lifecycle.epoch) throw cancellation(phase || '界面已关闭或数据已更换');
  }

  function reqp(req) { return new Promise(function (res, rej) { req.onsuccess = function () { res(req.result); }; req.onerror = function () { rej(req.error); }; }); }
  function withDb(fn) { return root.ExamStore.withDb(fn); }
  function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function listClean(v) {
    var out = [];
    (Array.isArray(v) ? v : String(v || '').split(/[,，、\s]+/)).forEach(function (x) {
      var s = clean(x);
      if (s && out.indexOf(s) < 0) out.push(s);
    });
    return out;
  }
  function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && new Date(String(s) + 'T00:00:00Z').toISOString().slice(0, 10) === s; }
  function uid() { return 'report-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }
  async function sha256(bytes) {
    if (!root.crypto || !root.crypto.subtle) throw new Error('当前环境不支持 SHA-256，无法归档报告');
    var digest = await root.crypto.subtle.digest('SHA-256', bytes);
    return Array.prototype.map.call(new Uint8Array(digest), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  function validateMeta(meta) {
    meta = meta || {};
    var title = clean(meta.title);
    if (!title) throw new Error('报告标题不能为空');
    if (title.length > 300) throw new Error('报告标题过长');
    var date = clean(meta.date);
    if (!isDate(date)) throw new Error('报告日期必须为 YYYY-MM-DD');
    var topics = listClean(meta.topics);
    var keywords = listClean(meta.keywords);
    var knowledgePoints = listClean(meta.knowledgePoints);
    if (topics.length > 30 || keywords.length > 50 || knowledgePoints.length > 50) throw new Error('专题/关键词/知识点数量过多');
    return {
      title: title, date: date, topics: topics, keywords: keywords, knowledgePoints: knowledgePoints,
      note: clean(meta.note).slice(0, 2000)
    };
  }
  async function assertPdfOpenable(bytes, token) {
    var lib = root.pdfjsLib;
    if (!lib || typeof lib.getDocument !== 'function') throw new Error('PDF.js 校验组件未加载，拒绝写入未经打开的 PDF');
    // getDocument 可能把数据转移给 worker；用副本校验，保留 bytes 供 Blob 归档。
    var task = null;
    var doc = null;
    try {
      task = lib.getDocument({ data: bytes.slice() });
      doc = await task.promise;
      ensureActive(token, 'PDF 打开期间数据已更换');
      if (!doc || !Number(doc.numPages) || doc.numPages < 1) throw new Error('PDF 没有可读取的页面');
      await doc.getPage(1);
      ensureActive(token, 'PDF 校验期间数据已更换');
    } catch (e) {
      if (isCancelled(e)) throw e;
      throw new Error('PDF 无法打开或已损坏：' + (e && e.message ? e.message : e));
    } finally {
      if (doc) { try { doc.destroy(); } catch (e) { /* ignore */ } }
      else if (task && typeof task.destroy === 'function') { try { task.destroy(); } catch (e) { /* ignore */ } }
    }
  }

  async function readPdf(file, token) {
    ensureActive(token);
    if (!file || typeof file.arrayBuffer !== 'function') throw new Error('请选择 PDF 文件');
    if (Number(file.size) > MAX_BYTES) throw new Error('PDF 超过 40MB，无法归档');
    var bytes = new Uint8Array(await file.arrayBuffer());
    ensureActive(token, '读取文件期间界面已关闭');
    if (bytes.length < 5 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== '%PDF') throw new Error('所选文件不是 PDF');
    var hash = await sha256(bytes);
    ensureActive(token, '计算哈希期间界面已关闭');
    // 只有 %PDF 标头不能证明文件可用：必须让既有 PDF.js 真正打开并读取首页。
    await assertPdfOpenable(bytes, token);
    ensureActive(token, 'PDF 校验完成后界面已关闭');
    return { bytes: bytes, size: bytes.length, sha256: hash, originalName: clean(file.name).slice(0, 300) };
  }
  async function list() {
    return withDb(async function (db) {
      var rec = await reqp(db.transaction('meta', 'readonly').objectStore('meta').get(INDEX_KEY));
      var arr = rec && Array.isArray(rec.value) ? rec.value : [];
      return arr.slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)) || String(b.title).localeCompare(String(a.title), 'zh'); });
    });
  }
  async function get(id) {
    return withDb(function (db) { return reqp(db.transaction('meta', 'readonly').objectStore('meta').get(RECORD_PREFIX + String(id))); });
  }
  async function add(file, meta) {
    var token = epoch();
    ensureActive(token);
    var info = await readPdf(file, token);
    var validated = validateMeta(meta);
    ensureActive(token, '写入前数据已更换');
    var now = Date.now();
    var id = uid();
    var blob = new Blob([info.bytes], { type: 'application/pdf' });
    var record = {
      key: RECORD_PREFIX + id,
      value: {
        schema: SCHEMA, id: id, title: validated.title, date: validated.date,
        topics: validated.topics, keywords: validated.keywords, knowledgePoints: validated.knowledgePoints,
        note: validated.note, originalName: info.originalName, size: info.size, sha256: info.sha256,
        blob: blob, createdAt: now, updatedAt: now
      }
    };
    var entry = null;
    await withDb(function (db) {
      // withDb 的 open() 本身是 await；进入事务前再核验一次 epoch。
      ensureActive(token, '打开数据库期间界面已关闭');
      return new Promise(function (resolve, reject) {
        var tx;
        try { tx = db.transaction('meta', 'readwrite'); }
        catch (e) { reject(e); return; }
        lifecycle.transactions.push(tx);
        var settled = false, writeError = null;
        function releaseTx() {
          var i = lifecycle.transactions.indexOf(tx);
          if (i >= 0) lifecycle.transactions.splice(i, 1);
        }
        function finish(err, value) {
          if (settled) return;
          settled = true;
          releaseTx();
          if (err) reject(err); else resolve(value);
        }
        function abortWith(err) {
          writeError = err;
          try { tx.abort(); } catch (e) { /* ignore */ }
          finish(err);
        }
        // 先挂事务事件，保证 aborted 的延迟回写不会错过回调。
        var cancelledNow = function () { return lifecycle.maintenance || token !== lifecycle.epoch; };
        tx.oncomplete = function () { finish(null, entry); };
        tx.onerror = function () { finish(writeError || (cancelledNow() ? cancellation('归档写入事务已取消') : (tx.error || new Error('归档写入事务失败')))); };
        tx.onabort = function () { finish(writeError || (cancelledNow() ? cancellation('归档写入事务已取消') : (tx.error || cancellation('归档写入事务已中止')))); };
        try {
          ensureActive(token, '写入事务开始前数据已更换');
        } catch (e) { abortWith(e); return; }
        var store = tx.objectStore('meta');
        var indexReq = store.get(INDEX_KEY);
        indexReq.onsuccess = function () {
          try {
            // 事务边界守卫：读取索引等待期间可能发生恢复/清空/关闭。
            if (lifecycle.maintenance || token !== lifecycle.epoch) throw cancellation('归档写入前数据已更换');
            var arr = indexReq.result && Array.isArray(indexReq.result.value) ? indexReq.result.value.slice() : [];
            var existing = arr.filter(function (x) { return x.sha256 === info.sha256 && x.date === validated.date; })[0];
            if (existing) id = existing.id;
            entry = {
              id: id, schema: SCHEMA, title: validated.title, date: validated.date,
              topics: validated.topics, keywords: validated.keywords, knowledgePoints: validated.knowledgePoints,
              note: validated.note, originalName: info.originalName, size: info.size, sha256: info.sha256,
              createdAt: existing ? existing.createdAt : now, updatedAt: now
            };
            arr = arr.filter(function (x) { return x.id !== id; });
            arr.push(entry);
            record.key = RECORD_PREFIX + id;
            record.value.id = id;
            record.value.createdAt = existing ? existing.createdAt : now;
            // Blob 记录与索引在同一个 readwrite 事务中；任一 put 失败都会
            // 中止事务，不能留下只有 Blob 或只有索引的半套归档。
            store.put(record);
            store.put({ key: INDEX_KEY, value: arr });
          } catch (e) {
            abortWith(e);
          }
        };
        indexReq.onerror = function () { abortWith(indexReq.error || new Error('读取归档索引失败')); };
      });
    });
    return record.value;
  }
  async function updateMeta(id, meta) {
    var token = epoch();
    ensureActive(token);
    var validated = validateMeta(meta);
    return withDb(function (db) {
      ensureActive(token, '更新前数据已更换');
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('meta', 'readwrite');
        var store = tx.objectStore('meta');
        var recReq = store.get(RECORD_PREFIX + String(id));
        var value = null;
        recReq.onsuccess = function () {
          var rec = recReq.result;
          if (!rec || !rec.value) { try { tx.abort(); } catch (e) {} return; }
          value = Object.assign({}, rec.value, validated, { updatedAt: Date.now() });
          store.put({ key: rec.key, value: value });
          var idxReq = store.get(INDEX_KEY);
          idxReq.onsuccess = function () {
            var arr = idxReq.result && Array.isArray(idxReq.result.value) ? idxReq.result.value.slice() : [];
            arr = arr.map(function (x) { return x.id === id ? Object.assign({}, x, validated, { updatedAt: value.updatedAt }) : x; });
            store.put({ key: INDEX_KEY, value: arr });
          };
          idxReq.onerror = function () { try { tx.abort(); } catch (e) {} };
        };
        recReq.onerror = function () { try { tx.abort(); } catch (e) {} };
        tx.oncomplete = function () { if (value) resolve(value); else reject(new Error('报告归档不存在')); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error || new Error('归档更新事务已中止')); };
      });
    });
  }
  async function remove(id) {
    var token = epoch();
    ensureActive(token);
    return withDb(function (db) {
      ensureActive(token, '删除前数据已更换');
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('meta', 'readwrite');
        var store = tx.objectStore('meta');
        var idxReq = store.get(INDEX_KEY);
        idxReq.onsuccess = function () {
          var arr = idxReq.result && Array.isArray(idxReq.result.value) ? idxReq.result.value : [];
          store.delete(RECORD_PREFIX + String(id));
          store.put({ key: INDEX_KEY, value: arr.filter(function (x) { return x.id !== id; }) });
        };
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error || new Error('归档删除事务已中止')); };
      });
    });
  }
  function matches(entry, query) {
    query = query || {};
    if (query.date && entry.date !== query.date) return false;
    var q = clean(query.text).toLowerCase();
    if (!q) return true;
    return [entry.title, entry.date, (entry.topics || []).join(' '), (entry.keywords || []).join(' '), (entry.knowledgePoints || []).join(' '), entry.note]
      .join(' ').toLowerCase().indexOf(q) >= 0;
  }
  async function search(query) {
    var arr = await list();
    return arr.filter(function (x) { return matches(x, query); });
  }
  async function inspect(file) {
    var info = await readPdf(file, epoch());
    return { size: info.size, sha256: info.sha256, originalName: info.originalName, pdf: true };
  }
  root.ReviewArchive = {
    SCHEMA: SCHEMA, INDEX_KEY: INDEX_KEY, RECORD_PREFIX: RECORD_PREFIX, MAX_BYTES: MAX_BYTES,
    validateMeta: validateMeta, list: list, get: get, add: add, updateMeta: updateMeta, remove: remove,
    search: search, matches: matches, inspect: inspect,
    epoch: epoch, cancelPending: cancelPending, stopForClear: stopForClear,
    resumeMaintenance: resumeMaintenance, isCancelled: isCancelled
  };
})(typeof window !== 'undefined' ? window : globalThis);
