/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright 2026 ExamCard contributors */
/* ExamCard V3.1 · 完整数据备份 / 隔离恢复（覆盖 IndexedDB 全部表，含 Blob 与校验） */
(function (root) {
  'use strict';

  var DB_NAME = 'gd_exam_v2';
  var FORMAT = 'ExamCardBackup';
  var FORMAT_VERSION = 1;
  var APP_VERSION = '1.0.0';

  function BackupError(message, detail) {
    var e = new Error(message);
    e.name = 'BackupError';
    e.detail = detail || null;
    return e;
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME);
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(BackupError('无法打开 IndexedDB：' + (req.error && req.error.message))); };
      req.onblocked = function () { reject(BackupError('IndexedDB 被其他连接阻塞，请关闭其他应用窗口后重试')); };
    });
  }

  function reqPromise(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function txDone(tx) {
    return new Promise(function (resolve, reject) {
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error || new Error('IndexedDB 事务失败')); };
      tx.onabort = function () { reject(tx.error || new Error('IndexedDB 事务中止')); };
    });
  }

  function bytesToBase64(bytes) {
    var chunks = [];
    var step = 0x8000;
    for (var i = 0; i < bytes.length; i += step) {
      chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + step)));
    }
    return btoa(chunks.join(''));
  }

  function base64ToBytes(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function bufferToBytes(buf) {
    if (buf instanceof Uint8Array) return buf;
    return new Uint8Array(buf);
  }

  async function sha256Bytes(bytes) {
    if (!root.crypto || !root.crypto.subtle) throw BackupError('运行环境不支持 Web Crypto SHA-256，无法生成/校验备份');
    var digest = await root.crypto.subtle.digest('SHA-256', bytes);
    return Array.prototype.map.call(new Uint8Array(digest), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  async function sha256Text(text) {
    return sha256Bytes(new TextEncoder().encode(String(text)));
  }

  function canonical(value) {
    if (value === null || value === undefined) return 'null';
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (typeof value === 'object') {
      return '{' + Object.keys(value).sort().filter(function (k) { return value[k] !== undefined; }).map(function (k) {
        return JSON.stringify(k) + ':' + canonical(value[k]);
      }).join(',') + '}';
    }
    if (typeof value === 'number' && !isFinite(value)) return JSON.stringify(String(value));
    return JSON.stringify(value);
  }

  async function serializeValue(value, seen) {
    seen = seen || new WeakSet();
    if (value === null || value === undefined) return value;
    if (typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!isFinite(value)) return { __gdType: 'Number', value: String(value) };
      return value;
    }
    if (typeof value === 'bigint') return { __gdType: 'BigInt', value: value.toString() };
    if (value instanceof Date) return { __gdType: 'Date', value: value.toISOString() };
    if (typeof Blob !== 'undefined' && value instanceof Blob) {
      var buf = await value.arrayBuffer();
      var bytes = new Uint8Array(buf);
      var hash = await sha256Bytes(bytes);
      return { __gdType: 'Blob', mimeType: value.type || '', size: value.size, sha256: hash, data: bytesToBase64(bytes) };
    }
    if (value instanceof ArrayBuffer) {
      var abytes = new Uint8Array(value);
      return { __gdType: 'ArrayBuffer', size: abytes.length, sha256: await sha256Bytes(abytes), data: bytesToBase64(abytes) };
    }
    if (ArrayBuffer.isView(value)) {
      var tbytes = bufferToBytes(value);
      return { __gdType: 'TypedArray', kind: value.constructor.name, size: tbytes.length, sha256: await sha256Bytes(tbytes), data: bytesToBase64(tbytes) };
    }
    if (typeof value === 'object') {
      if (seen.has(value)) throw BackupError('数据存在循环引用，无法备份');
      seen.add(value);
      if (Array.isArray(value)) {
        var arr = [];
        for (var i = 0; i < value.length; i++) arr.push(await serializeValue(value[i], seen));
        seen.delete(value);
        return arr;
      }
      var out = {};
      var keys = Object.keys(value);
      for (var j = 0; j < keys.length; j++) {
        if (value[keys[j]] === undefined) continue;
        out[keys[j]] = await serializeValue(value[keys[j]], seen);
      }
      seen.delete(value);
      return out;
    }
    return String(value);
  }

  function deserializeValue(value) {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) return value.map(deserializeValue);
    if (typeof value === 'object') {
      if (value.__gdType === 'Blob') {
        var bytes = base64ToBytes(value.data);
        if (bytes.length !== value.size) throw BackupError('Blob 大小校验失败（备份损坏）');
        var blob = new Blob([bytes], { type: value.mimeType || '' });
        if (typeof value.sha256 === 'string' && value.sha256.length) {
          // 同步阶段无法等待摘要；由 validateBackup 做异步复核
          blob.__gdExpectedSha256 = value.sha256;
        }
        return blob;
      }
      if (value.__gdType === 'ArrayBuffer') return base64ToBytes(value.data).buffer;
      if (value.__gdType === 'TypedArray') return base64ToBytes(value.data);
      if (value.__gdType === 'Date') return new Date(value.value);
      if (value.__gdType === 'Number') return Number(value.value);
      if (value.__gdType === 'BigInt') return BigInt(value.value);
      var out = {};
      Object.keys(value).forEach(function (k) { out[k] = deserializeValue(value[k]); });
      return out;
    }
    return value;
  }

  function primaryKeyOf(record, keyPath) {
    if (Array.isArray(keyPath)) return keyPath.map(function (k) { return String(record[k]); }).join('\u0001');
    return String(record[keyPath]);
  }

  async function checksumsForRecords(records, keyPath, storeName) {
    var serialized = [];
    for (var i = 0; i < records.length; i++) serialized.push(await serializeValue(records[i]));
    serialized.sort(function (a, b) {
      return primaryKeyOf(a, keyPath) < primaryKeyOf(b, keyPath) ? -1 : 1;
    });
    var perRecord = {};
    for (var j = 0; j < serialized.length; j++) {
      var key = primaryKeyOf(serialized[j], keyPath);
      if (Object.prototype.hasOwnProperty.call(perRecord, key)) throw BackupError('IndexedDB 表 ' + storeName + ' 存在重复主键：' + key);
      perRecord[key] = await sha256Text(canonical(serialized[j]));
    }
    var digest = await sha256Text(canonical(serialized));
    return { serialized: serialized, perRecord: perRecord, digest: digest };
  }
  async function storeChecksums(store, keyPath) {
    var records = await reqPromise(store.getAll());
    return checksumsForRecords(records, keyPath, store.name);
  }

  async function createBackup() {
    var db = await openDb();
    try {
      var storeNames = Array.prototype.slice.call(db.objectStoreNames);
      var schema = [];
      var stores = {};
      var counts = {};
      var checksums = {};
      var recordChecksums = {};
      // 所有 getAll 在同一 readonly 事务中排队，保证多表快照来自同一致时点。
      var tx = db.transaction(storeNames, 'readonly');
      var reads = [], infos = {};
      for (var i = 0; i < storeNames.length; i++) {
        var name = storeNames[i];
        var store = tx.objectStore(name);
        var info = { name: name, keyPath: store.keyPath, autoIncrement: !!store.autoIncrement, indexes: [] };
        for (var j = 0; j < store.indexNames.length; j++) {
          var idx = store.index(store.indexNames[j]);
          info.indexes.push({ name: idx.name, keyPath: idx.keyPath, unique: !!idx.unique, multiEntry: !!idx.multiEntry });
        }
        schema.push(info); infos[name] = info;
        reads.push(reqPromise(store.getAll()));
      }
      var snapshots = await Promise.all(reads);
      for (var k = 0; k < storeNames.length; k++) {
        var n = storeNames[k];
        var result = await checksumsForRecords(snapshots[k], infos[n].keyPath, n);
        stores[n] = result.serialized;
        counts[n] = result.serialized.length;
        checksums[n] = result.digest;
        recordChecksums[n] = result.perRecord;
      }
      var base = {
        format: FORMAT,
        formatVersion: FORMAT_VERSION,
        appVersion: APP_VERSION,
        dbName: DB_NAME,
        dbVersion: db.version,
        createdAt: new Date().toISOString(),
        schema: schema,
        counts: counts,
        stores: stores,
        checksums: checksums,
        recordChecksums: recordChecksums,
        integrityAlgorithm: 'SHA-256'
      };
      base.integrity = await sha256Text(canonical({
        format: base.format,
        formatVersion: base.formatVersion,
        dbVersion: base.dbVersion,
        schema: base.schema,
        counts: base.counts,
        checksums: base.checksums,
        recordChecksums: base.recordChecksums,
        stores: base.stores
      }));
      return base;
    } finally {
      db.close();
    }
  }

  async function assertBackupStoreCompatibility(backup) {
    var db = await openDb();
    try {
      var currentStores = Array.prototype.slice.call(db.objectStoreNames);
      var backupStoreNames = Object.keys(backup.stores || {});
      var unknownStores = backupStoreNames.filter(function (name) { return currentStores.indexOf(name) < 0; });
      if (unknownStores.length) throw BackupError('备份包含当前版本未知的数据表：' + unknownStores.join('、') + '。已拒绝恢复，当前数据未修改。', { unknownStores: unknownStores });
      var missingStores = currentStores.filter(function (name) { return !Object.prototype.hasOwnProperty.call(backup.stores, name); });
      if (missingStores.length) throw BackupError('备份不完整：缺少当前版本的数据表 ' + missingStores.join('、') + '。没有执行任何写入，当前数据未修改。', { missingStores: missingStores, currentDbVersion: db.version, backupDbVersion: backup.dbVersion });
      return { currentStores: currentStores, dbVersion: db.version };
    } finally { db.close(); }
  }

  async function verifyBackupIntegrity(backup) {
    if (!backup || typeof backup !== 'object') throw BackupError('不是有效的备份对象');
    if (backup.format !== FORMAT) throw BackupError('不是 ExamCard 备份文件');
    if (backup.formatVersion !== FORMAT_VERSION) throw BackupError('不支持的备份格式版本：' + backup.formatVersion);
    if (!backup.stores || typeof backup.stores !== 'object') throw BackupError('备份缺少 stores');
    if (!backup.counts || !backup.checksums || !backup.recordChecksums) throw BackupError('备份缺少完整性信息');
    if (!Number.isInteger(backup.dbVersion) || backup.dbVersion < 1) throw BackupError('备份缺少有效的 IndexedDB 版本');
    if (typeof backup.integrity !== 'string' || !backup.integrity.length) throw BackupError('备份缺少整体校验值');
    await assertBackupStoreCompatibility(backup);

    var digest = await sha256Text(canonical({
      format: backup.format,
      formatVersion: backup.formatVersion,
      dbVersion: backup.dbVersion,
      schema: backup.schema,
      counts: backup.counts,
      checksums: backup.checksums,
      recordChecksums: backup.recordChecksums,
      stores: backup.stores
    }));
    if (digest !== backup.integrity) throw BackupError('备份整体校验失败：文件可能被修改或损坏');

    var db = await openDb();
    try {
      if (backup.dbVersion > db.version) throw BackupError('备份来自更新版本（v' + backup.dbVersion + '），当前应用仅支持升级到 v' + db.version);
      var currentStores = Array.prototype.slice.call(db.objectStoreNames);
      var backupStoreNames = Object.keys(backup.stores);
      var unknownStores = backupStoreNames.filter(function (name) { return currentStores.indexOf(name) < 0; });
      if (unknownStores.length) throw BackupError('备份包含当前版本未知的数据表：' + unknownStores.join('、') + '。已拒绝恢复，当前数据未修改。', { unknownStores: unknownStores });
      // A backup must contain every current table. Older/incomplete backups are rejected
      // before any readwrite transaction; no table is cleared and no partial restore occurs.
      var missingStores = currentStores.filter(function (name) { return !Object.prototype.hasOwnProperty.call(backup.stores, name); });
      if (missingStores.length) throw BackupError('备份不完整：缺少当前版本的数据表 ' + missingStores.join('、') + '。没有执行任何写入，当前数据未修改。', { missingStores: missingStores, currentDbVersion: db.version, backupDbVersion: backup.dbVersion });
      var schemaNames = (backup.schema || []).map(function (x) { return x && x.name; }).filter(Boolean);
      var schemaMissing = backupStoreNames.filter(function (name) { return schemaNames.indexOf(name) < 0; });
      if (schemaMissing.length) throw BackupError('备份缺少数据表结构元数据：' + schemaMissing.join('、') + '。已拒绝恢复。', { missingStores: schemaMissing });
      var summary = {};
      for (var i = 0; i < Object.keys(backup.stores).length; i++) {
        var name = Object.keys(backup.stores)[i];
        var records = backup.stores[name];
        if (!Array.isArray(records)) throw BackupError('数据表 ' + name + ' 格式错误');
        if (backup.counts[name] !== records.length) throw BackupError('数据表 ' + name + ' 记录数不一致');
        var storeInfo = (backup.schema || []).filter(function (x) { return x.name === name; })[0];
        if (!storeInfo || !storeInfo.keyPath) throw BackupError('备份缺少数据表 ' + name + ' 的结构元数据');
        var seenKeys = {};
        var sorted = records.slice().sort(function (a, b) {
          var ka = primaryKeyOf(a, storeInfo.keyPath), kb = primaryKeyOf(b, storeInfo.keyPath);
          return ka < kb ? -1 : ka > kb ? 1 : 0;
        });
        for (var j = 0; j < sorted.length; j++) {
          var rec = sorted[j];
          var key = primaryKeyOf(rec, storeInfo.keyPath);
          if (seenKeys[key]) throw BackupError('数据表 ' + name + ' 存在重复主键：' + key);
          seenKeys[key] = true;
          var expected = backup.recordChecksums[name] && backup.recordChecksums[name][key];
          var actual = await sha256Text(canonical(rec));
          if (!expected || expected !== actual) throw BackupError('数据表 ' + name + ' 的记录 ' + key + ' 校验失败');
          // 校验 Blob/ArrayBuffer 内容摘要
          await verifySerializedBlobs(rec, name, key);
        }
        var storeDigest = await sha256Text(canonical(sorted));
        if (backup.checksums[name] !== storeDigest) throw BackupError('数据表 ' + name + ' 整体校验失败');
        summary[name] = sorted.length;
      }
      return { ok: true, dbVersion: backup.dbVersion, counts: summary };
    } finally {
      db.close();
    }
  }

  async function verifySerializedBlobs(value, storeName, key) {
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i++) await verifySerializedBlobs(value[i], storeName, key);
      return;
    }
    if (value.__gdType === 'Blob' || value.__gdType === 'ArrayBuffer' || value.__gdType === 'TypedArray') {
      var bytes = base64ToBytes(value.data);
      if (typeof value.size === 'number' && bytes.length !== value.size) throw BackupError('表 ' + storeName + ' 记录 ' + key + ' 的二进制大小校验失败');
      if (value.sha256) {
        var actual = await sha256Bytes(bytes);
        if (actual !== value.sha256) throw BackupError('表 ' + storeName + ' 记录 ' + key + ' 的二进制内容校验失败');
      }
      return;
    }
    var keys = Object.keys(value);
    for (var j = 0; j < keys.length; j++) await verifySerializedBlobs(value[keys[j]], storeName, key);
  }

  async function validateBackup(backup) {
    return verifyBackupIntegrity(backup);
  }

  async function restoreBackup(backup) {
    var info = await verifyBackupIntegrity(backup);
    var decoded = {};
    Object.keys(backup.stores).forEach(function (name) {
      decoded[name] = backup.stores[name].map(deserializeValue);
    });
    var db = await openDb();
    try {
      var currentStores = Array.prototype.slice.call(db.objectStoreNames);
      Object.keys(decoded).forEach(function (name) {
        if (currentStores.indexOf(name) < 0) throw BackupError('当前数据库缺少表：' + name);
      });
      var tx = db.transaction(currentStores, 'readwrite');
      currentStores.forEach(function (name) { tx.objectStore(name).clear(); });
      Object.keys(decoded).forEach(function (name) {
        var store = tx.objectStore(name);
        decoded[name].forEach(function (rec) { store.put(rec); });
      });
      await txDone(tx);
      return { ok: true, dbVersion: info.dbVersion, counts: info.counts };
    } finally {
      db.close();
    }
  }

  async function getStoreCounts() {
    var db = await openDb();
    try {
      var out = {};
      var names = Array.prototype.slice.call(db.objectStoreNames);
      for (var i = 0; i < names.length; i++) {
        var tx = db.transaction(names[i], 'readonly');
        out[names[i]] = await reqPromise(tx.objectStore(names[i]).count());
      }
      return out;
    } finally {
      db.close();
    }
  }

  /* ============================ UI ============================ */

  function initUi() {
    var view = document.getElementById('libraryView');
    if (!view || document.getElementById('dataBackupPanel')) return;
    var style = document.createElement('style');
    style.textContent = [
      '.data-safety{max-width:1180px;margin:0 auto 14px;background:#fff;border:1px solid var(--line);border-radius:10px;padding:10px 14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;box-shadow:var(--shadow)}',
      '.data-safety .ds-title{font-weight:800;font-size:13px;color:var(--ink)}',
      '.data-safety .ds-status{font-size:12px;color:var(--muted);flex:1;min-width:220px}',
      '.data-safety .ds-note{font-size:11px;color:var(--muted);flex-basis:100%;line-height:1.6}',
      '.gd-backup-mask{position:fixed;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;z-index:10000;padding:18px}',
      '.gd-backup-modal{background:#fff;border-radius:12px;padding:18px 20px;width:min(620px,95vw);box-shadow:0 18px 60px rgba(15,23,42,.35)}',
      '.gd-backup-modal h3{margin:0 0 10px;font-size:17px}',
      '.gd-backup-modal p{font-size:13px;line-height:1.7;color:var(--ink-2);margin:6px 0}',
      '.gd-backup-modal .btns{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}'
    ].join('\n');
    document.head.appendChild(style);

    var panel = document.createElement('div');
    panel.className = 'data-safety';
    panel.id = 'dataBackupPanel';
    panel.innerHTML =
      '<span class="ds-title">数据安全</span>' +
      '<button class="btn" id="dataBackupBtn">导出完整备份</button>' +
      '<button class="btn" id="dataRestoreBtn">从备份恢复</button>' +
      '<input type="file" id="dataRestoreInput" accept=".json,application/json" class="hidden">' +
      '<span class="ds-status" id="dataBackupStatus">备份覆盖全部 IndexedDB 表（含 PDF Blob），恢复前会校验完整性。</span>' +
      '<span class="ds-note">恢复会覆盖当前所有本地数据。恢复前请先导出备份；正式版数据目录不会被自动迁移。</span>';
    var head = view.querySelector('.library-head');
    if (head && head.parentNode) head.parentNode.insertBefore(panel, head.nextSibling);

    var status = document.getElementById('dataBackupStatus');
    document.getElementById('dataBackupBtn').addEventListener('click', async function () {
      var btn = this;
      btn.disabled = true;
      status.textContent = '正在读取全部表并生成校验（含 PDF Blob）…';
      try {
        var backup = await createBackup();
        var text = JSON.stringify(backup);
        var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
        var d = new Date();
        var p = function (n) { return String(n).padStart(2, '0'); };
        var name = 'ExamCard_完整备份_' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '.json';
        var a = document.createElement('a');
        a.download = name;
        a.href = URL.createObjectURL(blob);
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
        var total = Object.keys(backup.counts).reduce(function (sum, k) { return sum + backup.counts[k]; }, 0);
        status.textContent = '已导出完整备份：' + total + ' 条记录，' + Object.keys(backup.counts).length + ' 张表，SHA-256 ' + backup.integrity.slice(0, 16) + '…';
      } catch (err) {
        status.textContent = '备份失败：' + (err && err.message ? err.message : err);
      } finally {
        btn.disabled = false;
      }
    });

    document.getElementById('dataRestoreBtn').addEventListener('click', function () {
      document.getElementById('dataRestoreInput').click();
    });
    document.getElementById('dataRestoreInput').addEventListener('change', async function (e) {
      var file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      status.textContent = '正在读取并校验备份…';
      try {
        var text = await file.text();
        var backup = JSON.parse(text);
        var info = await validateBackup(backup);
        var total = Object.keys(info.counts).reduce(function (sum, k) { return sum + info.counts[k]; }, 0);
        showRestoreConfirm(backup, info, total, file.name);
      } catch (err) {
        status.textContent = '备份校验失败：' + (err && err.message ? err.message : err);
      }
    });
  }

  function showRestoreConfirm(backup, info, total, filename) {
    var mask = document.createElement('div');
    mask.className = 'gd-backup-mask';
    mask.id = 'dataRestoreModal';
    mask.innerHTML = '<div class="gd-backup-modal"><h3>确认恢复完整备份</h3>' +
      '<p>备份文件：<b>' + escapeHtml(filename) + '</b></p>' +
      '<p>创建时间：' + escapeHtml(backup.createdAt || '未知') + '；格式版本：' + escapeHtml(String(backup.formatVersion)) + '；数据库版本：v' + escapeHtml(String(backup.dbVersion)) + '</p>' +
      '<p>将恢复 <b>' + Object.keys(info.counts).length + ' 张表 / ' + total + ' 条记录</b>，包含 PDF Blob。</p>' +
      '<p style="color:#b42318"><b>这会覆盖当前所有本地试卷、答案、会话和成绩。</b>建议先导出当前完整备份。</p>' +
      '<div class="btns"><button class="btn" id="dataRestoreCancel">取消</button><button class="btn danger" id="dataRestoreConfirm">确认覆盖并恢复</button></div></div>';
    document.body.appendChild(mask);
    document.getElementById('dataRestoreCancel').addEventListener('click', function () { mask.remove(); });
    document.getElementById('dataRestoreConfirm').addEventListener('click', async function () {
      var btn = this;
      btn.disabled = true;
      btn.textContent = '正在恢复…';
      try {
        await restoreBackup(backup);
        document.getElementById('dataBackupStatus').textContent = '恢复成功，正在重新加载应用…';
        mask.remove();
        setTimeout(function () { window.location.reload(); }, 800);
      } catch (err) {
        document.getElementById('dataBackupStatus').textContent = '恢复失败（数据未被覆盖）：' + (err && err.message ? err.message : err);
        mask.remove();
      }
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  root.ExamBackup = {
    createBackup: createBackup,
    validateBackup: validateBackup,
    restoreBackup: restoreBackup,
    getStoreCounts: getStoreCounts,
    FORMAT: FORMAT,
    FORMAT_VERSION: FORMAT_VERSION,
    APP_VERSION: APP_VERSION
  };
  document.addEventListener('DOMContentLoaded', function () { if (!root.AppShell) initUi(); });
})(typeof window !== 'undefined' ? window : globalThis);
