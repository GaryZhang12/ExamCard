/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright 2026 ExamCard contributors */
/* ExamCard V5.0-rc2 · 教材目录 PDF 批量导入 + 离线 OCR + 人工校正 */
(function (root) {
  'use strict';
  var state = { open: false, tasks: [], active: 0, range: '1-10', busy: false, error: '', draft: null, drafts: [], runningTask: null, stopEpoch: 0, activeRun: null, queueCount: 0 };
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(m) { var e = document.createElement('div'); e.className = 'learn-toast'; e.textContent = m; document.body.appendChild(e); setTimeout(function () { e.remove(); }, 3000); }
  function uid(p) { return p + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6); }
  async function sha256(buf) { try { var d = await crypto.subtle.digest('SHA-256', buf); return Array.prototype.map.call(new Uint8Array(d), function (b) { return b.toString(16).padStart(2, '0'); }).join(''); } catch (e) { return null; } }
  function parseRanges(s, max) {
    var out = [], seen = {};
    var input = String(s || '').trim().replace(/\s*-\s*/g, '-');
    if (!input) throw new Error('请填写目录 PDF 页范围（1-' + max + '）');
    input.split(/[,，;；\s]+/).forEach(function (part) {
      var m = /^(\d+)(?:-(\d+))?$/.exec(part);
      var a = m ? Number(m[1]) : 0, b = m ? Number(m[2] || m[1]) : 0;
      if (!m || !Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 1 || b < a || b > max) throw new Error('无效 PDF 页范围“' + part + '”，请输入 1-' + max + ' 内递增页码');
      for (var i = a; i <= b; i++) if (!seen[i]) { seen[i] = 1; out.push(i); }
    });
    return out;
  }
  function cleanLine(s) {
    return String(s || '').replace(/\u00a0/g, ' ').replace(/[.．·…]{3,}/g, '  ').replace(/\s+/g, ' ').trim();
  }
  function extractPage(s) {
    var s0 = cleanLine(s);
    var m = /(\d{1,4}|[ivxlcdm]{1,8})\s*$/.exec(s0);
    if (!m) return { title: s0, page: null };
    var title = s0.slice(0, m.index).replace(/[.．·…\s]+$/, '').trim();
    if (!title || /^[\d.．·…\s]+$/.test(title)) return { title: s0, page: null };
    return { title: title, page: m[1] };
  }
  function levelOf(title, x, prev) {
    if (/^第[一二三四五六七八九十百\d]+[篇编]/.test(title)) return 0;
    if (/^第[一二三四五六七八九十百\d]+章/.test(title)) return 1;
    if (/^第[一二三四五六七八九十百\d]+节/.test(title)) return 2;
    if (/^[一二三四五六七八九十]+[、.]/.test(title)) return 3;
    if (/^（[一二三四五六七八九十]+）|^\([一二三四五六七八九十]+\)/.test(title)) return 4;
    var num = /^(\d+(?:\.\d+)*)[、.\s]/.exec(title);
    if (num) return Math.min(4, num[1].split('.').length);
    if (/^\d+[、.]/.test(title)) return 3;
    if (prev && x > (prev.x || 0) + 24) return Math.min(4, (prev.level || 1) + 1);
    return prev ? prev.level : 1;
  }
  function looksNoise(title) {
    var chars = title.replace(/[^\u4e00-\u9fff]/g, '');
    if (!chars.length) return true;
    if (/^(目录|目 录|前言|序言|附录|参考文献)$/.test(title)) return true;
    return false;
  }
  function normTitle(s) { return cleanLine(s).replace(/\s+/g, '').toLowerCase(); }
  function titleQuality(title) {
    var s = String(title || '');
    if (/[\uFFFD\u0000-\u001f]/.test(s)) return '含乱码/控制字符';
    if (/(.)\1{4,}/.test(s)) return '重复字符异常';
    if (s.length > 60) return '标题过长，疑似拆行或乱码';
    var cjk = (s.match(/[\u4e00-\u9fff]/g) || []).length;
    var latin = (s.match(/[A-Za-z]/g) || []).length;
    if (!cjk) return '不含中文，疑似页眉/乱码';
    if (/[A-Za-z]{6,}/.test(s) && latin > cjk * 0.6) return '中英混杂，疑似乱码';
    return null;
  }
  function pageQuality(page) {
    if (!page) return '页码未识别';
    if (!/^(\d{1,4}|[ivxlcdm]{1,8})$/i.test(String(page))) return '页码格式异常';
    return null;
  }
  function addIssue(e, message) { if (message && e.issues.indexOf(message) < 0) e.issues.push(message); }
  function parseDirectory(lines, method) {
    var entries = [], order = 0;
    var textPages = {};
    lines.forEach(function (ln) {
      var k = normTitle(cleanLine(ln.text));
      if (!k || k.length < 2) return;
      if (!textPages[k]) textPages[k] = {};
      textPages[k][ln.page || 0] = true;
    });
    for (var li = 0; li < lines.length; li++) {
      var ln = lines[li];
      var title = cleanLine(ln.text);
      if (!title) continue;
      if (ln.w && ln.w > 800 && (ln.h || 0) < 18) continue;
      if (/^[\d\s.．·…ivxlcdm]+$/i.test(title)) {
        var prevEntry = entries[entries.length - 1];
        if (prevEntry && !prevEntry.printedPage && prevEntry.pdfPage != null && prevEntry.pdfPage === ln.page &&
            prevEntry.sourceLine === li - 1 && prevEntry.column === ln.column &&
            Number.isFinite(ln.x) && ln.x > prevEntry.lineX && Math.abs((ln.y || 0) - prevEntry.lineY) <= 35 &&
            /^(\d{1,4}|[ivxlcdm]{1,8})$/i.test(title)) prevEntry.printedPage = title.trim();
        continue;
      }
      if (/^[eE][eE\s]+$/.test(title)) continue;
      if (looksNoise(title)) continue;
      var hasPattern = /第[一二三四五六七八九十百\d]+[篇编章节]|^[一二三四五六七八九十]+[、.]|^（[一二三四五六七八九十]+）|^\d+(?:\.\d+)+|^\d+[、.]/.test(title);
      var hasCjk = /[\u4e00-\u9fff]/.test(title);
      if (!hasPattern && !hasCjk) continue;
      // Drop a non-structural running header/footer repeated on 3+ pages; real
      // repeated chapter titles still carry a chapter pattern and are deduped later.
      var repeatKey = normTitle(title);
      if (!hasPattern && textPages[repeatKey] && Object.keys(textPages[repeatKey]).length >= 3) continue;
      var p = extractPage(title);
      if (!p.title || p.title.length < 2) continue;
      if (!hasPattern && !p.page) continue;
      var lv = levelOf(p.title, ln.x || 0, entries[entries.length - 1]);
      var e = { tmpId: uid('toc'), rawText: title, title: p.title, level: lv, parentTmpId: null, order: order++, printedPage: p.page, pdfPage: ln.page || null, lineY: ln.y || 0, lineX: ln.x || 0, column: ln.column, method: method, confidence: method === 'ocr' ? (ln.confidence || null) : null, confidenceSource: method === 'ocr' ? 'tesseract.js' : 'text-layer', issues: [], confirmed: false, sourceLine: li };
      if (!p.page) addIssue(e, '页码未识别');
      if (method === 'ocr') addIssue(e, 'OCR 结果需人工确认');
      entries.push(e);
    }
    return entries;
  }

  function finalizeDirectory(entries, method) {
    // Physical reading order is evidence. Printed page OCR is an attribute,
    // never a sorting key used to infer a different parent tree.
    entries = entries.slice();
    var kept = [], stack = [], strongSeen = {}, weakSeen = {};
    var quality = { valid: 0, autoMerged: 0, weakDuplicates: 0, abnormalTitles: 0, levelConflicts: 0, pageIssues: 0, method: method };
    var prevPage = null;
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var lv = Math.max(0, Math.min(4, Number(e.level) || 0));
      while (stack.length > lv) stack.pop();
      var parent = null;
      for (var s = stack.length - 1; s >= 0; s--) { if (stack[s]) { parent = stack[s]; break; } }
      var path = stack.filter(Boolean).map(function (x) { return normTitle(x.title); }).join('/');
      var key = path + '|' + lv + '|' + normTitle(e.title) + '|' + (e.printedPage || '');
      if (e.printedPage && strongSeen[key]) {
        quality.autoMerged++;
        e.duplicateOf = strongSeen[key].tmpId;
        e.issues.push('重复条目（同路径/同标题/同印刷页/同层级），已合并');
        continue;
      }
      if (e.printedPage) strongSeen[key] = e;
      var weakKey = path + '|' + lv + '|' + normTitle(e.title);
      if (weakSeen[weakKey]) {
        quality.weakDuplicates++;
        e.duplicateOf = weakSeen[weakKey].tmpId;
        addIssue(e, '疑似重复（同父级/同标题），请确认');
      } else {
        weakSeen[weakKey] = e;
      }
      e.level = lv;
      e.parentTmpId = parent ? parent.tmpId : null;
      if (lv > 1 && !parent) { quality.levelConflicts++; addIssue(e, '层级缺少父章节，请确认'); }
      if (parent && parent.level >= lv) { quality.levelConflicts++; addIssue(e, '层级冲突：父级不低于当前层级'); }
      if (parent && lv > parent.level + 1) { quality.levelConflicts++; addIssue(e, '层级跳跃，请确认父子关系'); }
      var tq = titleQuality(e.title);
      if (tq) { quality.abnormalTitles++; addIssue(e, tq); }
      var pq = pageQuality(e.printedPage);
      if (pq) { quality.pageIssues++; addIssue(e, pq); }
      if (!e.pdfPage) { quality.pageIssues++; addIssue(e, 'PDF 页码未记录'); }
      if (e.printedPage && prevPage && /^\d+$/.test(e.printedPage) && /^\d+$/.test(prevPage) && Number(e.printedPage) < Number(prevPage)) { quality.pageIssues++; addIssue(e, '印刷页顺序异常'); }
      if (e.printedPage && /^\d+$/.test(e.printedPage)) prevPage = e.printedPage;
      if (e.issues.length) e.confirmed = false;
      e.order = kept.length;
      stack[lv] = e;
      stack.length = lv + 1;
      kept.push(e);
    }
    quality.valid = kept.length;
    return { entries: kept, quality: quality };
  }

  function directorySignature(entries) {
    return JSON.stringify(entries.map(function (e) { return [e.tmpId, e.title, e.parentTmpId, e.level, e.printedPage, e.pdfPage, e.method]; }));
  }
  function validateDirectory(entries, method) {
    var q = { valid: entries.length, autoMerged: 0, weakDuplicates: 0, abnormalTitles: 0, levelConflicts: 0, pageIssues: 0, method: method, errors: [] };
    var byId = Object.create(null), duplicates = Object.create(null);
    entries.forEach(function (e) {
      e.issues = [];
      if (!e.tmpId || byId[e.tmpId]) { q.errors.push('章节 ID 缺少或重复'); q.levelConflicts++; }
      byId[e.tmpId] = e;
    });
    entries.forEach(function (e) {
      function structural(message) { q.errors.push(message + '：' + e.title); q.levelConflicts++; addIssue(e, message); }
      if (!String(e.title || '').trim()) { q.errors.push('存在空标题章节'); addIssue(e, '标题不能为空'); }
      if (!Number.isInteger(e.level) || e.level < 0 || e.level > 4) structural('层级无效');
      var parent = e.parentTmpId ? byId[e.parentTmpId] : null;
      if (e.parentTmpId && !parent) structural('父章节不存在');
      if (!parent && e.level > 1) structural('层级缺少父章节');
      if (parent && (parent.level >= e.level || e.level > parent.level + 1)) structural('父子层级冲突');
      var seen = Object.create(null), cur = e;
      while (cur) {
        if (seen[cur.tmpId]) { structural('章节父子关系存在循环或自引用'); break; }
        seen[cur.tmpId] = true; cur = cur.parentTmpId ? byId[cur.parentTmpId] : null;
      }
      var key = JSON.stringify([e.parentTmpId || null, e.level, normTitle(e.title)]);
      if (duplicates[key]) { q.weakDuplicates++; addIssue(e, '疑似重复（同父级/同标题），请确认'); }
      duplicates[key] = true;
      var tq = titleQuality(e.title); if (tq) { q.abnormalTitles++; addIssue(e, tq); }
      var pq = pageQuality(e.printedPage); if (pq) { q.pageIssues++; addIssue(e, pq); }
      if (!e.pdfPage) { q.pageIssues++; addIssue(e, 'PDF 页码未记录'); }
      if (e.method === 'ocr') addIssue(e, 'OCR 结果需人工确认');
    });
    q.needsReview = q.weakDuplicates + q.abnormalTitles + q.pageIssues > 0 || method === 'ocr';
    return q;
  }
  function refreshTaskQuality(t) {
    var merged = t.quality && t.quality.autoMerged || 0;
    t.quality = validateDirectory(t.entries || [], t.method);
    t.quality.autoMerged = merged;
    if (t.qualityAckSignature !== directorySignature(t.entries || [])) t.qualityAckSignature = null;
    return t.quality;
  }

  function detectReliableText(lines) {
    var text = lines.map(function (x) { return x.text; }).join('');
    var cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    var headings = lines.filter(function (x) { return /第[一二三四五六七八九十百\d]+[篇编章节]|^[一二三四五六七八九十]+[、.]/.test(cleanLine(x.text)); }).length;
    var pages = new Set(lines.map(function (x) { return x.page; }));
    var lastY = Object.create(null);
    var badOrder = lines.some(function (ln) {
      var key = ln.page + ':' + (ln.column || 0), previous = lastY[key];
      lastY[key] = ln.y;
      return previous != null && ln.y > previous + 40;
    });
    var reasons = [];
    if (cjk < 20) reasons.push('中文字符不足');
    if (headings < 2) reasons.push('目录标题行不足');
    if (badOrder) reasons.push('文字顺序异常');
    return { reliable: reasons.length === 0, reasons: reasons, cjk: cjk, headings: headings, pages: pages.size };
  }
  function ocrLines(result, page) {
    var out = [];
    (result.blocks || []).forEach(function (b) {
      (b.paragraphs || []).forEach(function (p) {
        (p.lines || []).forEach(function (ln) {
          var text = cleanLine(ln.text);
          if (!text) return;
          out.push({ text: text, x: ln.bbox ? ln.bbox.x0 : 0, y: ln.bbox ? ln.bbox.y0 : 0, w: ln.bbox ? (ln.bbox.x1 - ln.bbox.x0) : 0, h: ln.bbox ? (ln.bbox.y1 - ln.bbox.y0) : 0, page: page, confidence: result.confidence, source: 'ocr' });
        });
      });
    });
    if (!out.length) (result.text || '').split(/\n+/).forEach(function (t) { if (cleanLine(t)) out.push({ text: cleanLine(t), x: 0, y: 0, page: page, source: 'ocr' }); });
    return out;
  }
  async function textLinesForPage(doc, pageNo) {
    var page = await doc.getPage(pageNo); var content = await page.getTextContent(); var vp = page.getViewport({ scale: 1 });
    var items = [];
    (content.items || []).forEach(function (it) {
      if (!it.str || !it.str.trim()) return;
      items.push({ text: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0 });
    });
    items.sort(function (a, b) { return b.y - a.y || a.x - b.x; });
    var rows = [];
    items.forEach(function (it) {
      var row = null;
      for (var r = rows.length - 1; r >= 0; r--) { if (Math.abs(rows[r].y - it.y) <= 5) { row = rows[r]; break; } }
      if (!row) { row = { y: it.y, items: [] }; rows.push(row); }
      row.items.push(it);
    });
    rows.sort(function (a, b) { return b.y - a.y; });
    var lines = [];
    rows.forEach(function (row) {
      row.items.sort(function (a, b) { return a.x - b.x; });
      var seg = null;
      for (var i = 0; i < row.items.length; i++) {
        var it = row.items[i];
        if (!seg || (it.x - seg.lastX) > 32) {
          seg = { text: it.text, x: it.x, y: row.y, page: pageNo, width: vp.width, lastX: it.x + (it.w || 0) };
          lines.push(seg);
        } else {
          seg.text += it.text;
          seg.lastX = it.x + (it.w || 0);
          seg.x = Math.min(seg.x, it.x);
        }
      }
    });
    // Only establish columns from repeated title positions, not printed page
    // values. Page-number fragments follow their physical column.
    var titleXs = lines.filter(function (l) { return /[\u4e00-\u9fff]/.test(l.text); }).map(function (l) { return l.x; });
    if (titleXs.length >= 4) {
      var leftX = Math.min.apply(null, titleXs), right = titleXs.filter(function (x) { return x - leftX > vp.width * 0.35; });
      if (right.length >= 2 && titleXs.length - right.length >= 2) {
        var splitX = Math.min.apply(null, right) - 12;
        lines.forEach(function (l) { l.column = l.x >= splitX ? 1 : 0; });
        lines.sort(function (a, b) { return a.column - b.column || b.y - a.y || a.x - b.x; });
      }
    }
    if (page.cleanup) { try { page.cleanup(); } catch (e) {} }
    return lines;
  }
  function draftKey(task) { return task.id; }
  function draftSnapshot(task) {
    return { at: Date.now(), key: draftKey(task), fileName: task.name, entries: task.entries, rawText: task.rawText, method: task.method, range: task.range, textInfo: task.textInfo, quality: task.quality || null, hash: task.hash || null };
  }
  async function refreshDraftIndex() {
    try {
      var list = await ExamStore.getMeta('ocrDrafts');
      state.drafts = Array.isArray(list) ? list : [];
    } catch (e) { state.drafts = []; }
  }
  async function persistDraft(task, force) {
    if (!force && (task.cancelled || task.epoch !== state.stopEpoch)) return false;
    var snap = draftSnapshot(task);
    var list = state.drafts.slice().filter(function (d) { return d.key !== snap.key; });
    list.unshift(snap);
    state.drafts = list.slice(0, 8);
    await ExamStore.setMeta('ocrDrafts', state.drafts);
    await ExamStore.setMeta('ocrDraft:last', snap);
    return true;
  }
  async function removeDraft(task) {
    var key = draftKey(task);
    state.drafts = state.drafts.filter(function (d) { return d.key !== key; });
    await ExamStore.setMeta('ocrDrafts', state.drafts);
    var last = await ExamStore.getMeta('ocrDraft:last');
    if (last && last.key === key) await ExamStore.removeMeta('ocrDraft:last');
  }
  function isStale(task) { return task.cancelled || task.epoch !== state.stopEpoch; }
  async function processTask(task) {
    if (task.running) return;
    if (task.cancelled) { task.status = 'cancelled'; task.message = '已取消，未保存结果'; render(); return; }
    task.epoch = state.stopEpoch;
    task.running = true; task.cancelled = false; task.status = 'loading'; task.message = '读取 PDF…'; task.entries = []; task.progress = 0; state.error = ''; state.runningTask = task; render();
    try {
      task.hash = task.hash || await sha256(task.buf);
      if (isStale(task)) throw new Error('已取消');
      var doc = await pdfjsLib.getDocument({ data: new Uint8Array(task.buf).slice() }).promise;
      if (isStale(task)) throw new Error('已取消');
      task.pages = doc.numPages;
      var selected = parseRanges(task.range, doc.numPages);
      task.message = '提取目录文字…'; render();
      var allLines = [];
      for (var i = 0; i < selected.length; i++) {
        if (isStale(task)) throw new Error('已取消');
        allLines = allLines.concat(await textLinesForPage(doc, selected[i]));
        if (isStale(task)) throw new Error('已取消');
      }
      if (isStale(task)) throw new Error('已取消');
      var reliable = detectReliableText(allLines);
      task.textInfo = reliable;
      if (reliable.reliable) {
        task.method = 'text'; task.message = '已读取目录文字'; var textResult = finalizeDirectory(parseDirectory(allLines, 'text'), 'text'); task.entries = textResult.entries; task.quality = textResult.quality;
      } else {
        if (!root.OcrEngine || !OcrEngine.isAvailable()) throw new Error('扫描识别不可用，请重新安装或选择文字版 PDF');
        task.method = 'ocr'; task.entries = []; var ocrTexts = []; var ocrAllLines = [];
        for (var j = 0; j < selected.length; j++) {
          if (isStale(task)) throw new Error('已取消');
          task.message = '识别第 ' + (j + 1) + '/' + selected.length + ' 页'; task.progress = Math.round((j / selected.length) * 100); render();
          var r = await OcrEngine.recognizePdfPage(doc, selected[j], { scale: 2, onProgress: function (m) { if (m.status === 'recognizing text' && !isStale(task)) { task.message = '识别第 ' + (j + 1) + '/' + selected.length + ' 页 ' + Math.round((m.progress || 0) * 100) + '%'; render(); } } });
          if (isStale(task)) throw new Error('已取消');
          ocrTexts.push(r.text || '');
          ocrAllLines = ocrAllLines.concat(ocrLines(r, selected[j]));
        }
        if (isStale(task)) throw new Error('已取消');
        var ocrResult = finalizeDirectory(parseDirectory(ocrAllLines, 'ocr'), 'ocr');
        task.entries = ocrResult.entries; task.quality = ocrResult.quality;
        task.entries.forEach(function (e) { e.method = 'ocr'; if (e.issues.indexOf('请核对识别结果') < 0) e.issues.push('请核对识别结果'); });
        allLines = ocrTexts.join('\n').split(/\n+/).map(function (x) { return { text: x, page: null }; });
      }
      if (isStale(task)) throw new Error('已取消');
      task.rawText = allLines.map(function (x) { return x.text; }).join('\n');
      task.entries = task.entries.map(function (e, idx) { e.order = idx; return e; });
      if (isStale(task)) throw new Error('已取消');
      task.status = 'ready'; task.message = '识别完成，请核对'; task.progress = 100;
      if (isStale(task)) throw new Error('已取消');
      try { var books = await LearningStore.listTextbooks(); task.duplicates = books.filter(function (b) { return task.hash && (b.sourcePdfHash === task.hash || (b.sourcePdfs || []).some(function (p) { return p.hash === task.hash; })); }).slice(0, 5); } catch (e) { task.duplicates = []; }
      if (isStale(task)) throw new Error('已取消');
      await persistDraft(task);
      render();
    } catch (e) {
      if (task.cancelled || task.epoch !== state.stopEpoch) { task.cancelled = true; task.status = 'cancelled'; task.message = '已取消，未保存结果'; task.progress = 0; }
      else { task.status = 'error'; task.message = e.message || String(e); }
      render();
    } finally {
      task.running = false;
      if (state.runningTask === task) state.runningTask = null;
    }
  }
  function processFiles(files) {
    if (state.busy) { toast('正在处理其他文件，请稍候'); return Promise.resolve(); }
    var epoch = state.stopEpoch;
    state.busy = true; state.queueCount = files.length;
    var run = (async function () {
      try {
        for (var i = 0; i < files.length; i++) {
          if (epoch !== state.stopEpoch) break;
          var f = files[i];
          var buf = await f.arrayBuffer();
          if (epoch !== state.stopEpoch) break;
          var task = { id: uid('job'), name: f.name, size: f.size, buf: buf, range: state.range, status: 'queued', message: '等待处理', progress: 0, entries: [], method: '', cancelled: false, running: false, epoch: epoch };
          state.tasks.push(task); state.active = state.tasks.length - 1; render();
          await processTask(task);
          if (epoch !== state.stopEpoch) break;
        }
      } finally {
        if (epoch === state.stopEpoch) state.busy = false;
        state.queueCount = 0;
        if (state.activeRun === run) state.activeRun = null;
        if (root.OcrEngine) { try { await OcrEngine.terminate(); } catch (e) {} }
        render();
      }
    })();
    state.activeRun = run;
    return run;
  }

  function stopAll() {
    state.stopEpoch++;
    if (state.runningTask) state.runningTask.cancelled = true;
    var p = state.activeRun;
    try { if (root.OcrEngine && OcrEngine.terminate) { var term = OcrEngine.terminate(); if (term && term.catch) term.catch(function () {}); } } catch (e) {}
    return Promise.resolve(p).catch(function () {}).then(function () {
      state.busy = false; state.runningTask = null; state.activeRun = null; state.queueCount = 0;
    });
  }

  async function beforeLeave() {
    var active = state.tasks[state.active];
    var hasWork = state.busy || state.queueCount > 0 || (active && active.entries && active.entries.length > 0);
    if (!hasWork) return true;
    var msg = state.busy
      ? '正在识别教材目录。离开会取消当前识别和后续教材队列，未完成的识别结果不会写入。确定离开？'
      : '当前目录草稿尚未确认。离开前会按现有机制保存草稿，然后返回教材列表。确定离开？';
    if (!window.confirm(msg)) return false; // cancel: keep page and state unchanged
    if (active && active.status === 'ready' && active.entries && active.entries.length) {
      try {
        var saved = await persistDraft(active, true);
        if (!saved) { toast('草稿保存失败，已保留当前页面'); return false; }
      } catch (e) { toast('草稿保存失败：' + (e.message || e)); return false; }
    }
    await stopAll();
    return true;
  }

  async function stopForClear() {
    await stopAll();
    state.tasks = []; state.active = 0; state.draft = null; state.drafts = [];
    state.busy = false; state.runningTask = null; state.activeRun = null; state.queueCount = 0;
    state.open = false;
    var r = $('tocRoot'); if (r) r.classList.add('hidden');
  }

  function finishLeave() {
    state.open = false;
    var r = $('tocRoot'); if (r) r.classList.add('hidden');
  }

  async function requestLeave() {
    if (!(await beforeLeave())) return;
    state.open = false;
    var r = $('tocRoot'); if (r) r.classList.add('hidden');
    if (root.AppShell && AppShell.detachToc) AppShell.detachToc();
  }

  function build() {
    if ($('tocRoot')) return;
    var w = document.createElement('div'); w.id = 'tocRoot'; w.className = 'toc-root hidden';
    w.innerHTML = '<header class="learn-top"><div class="learn-brand"><img src="assets/examcard-wordmark.png"><span class="t">教材目录导入</span><span class="v">OCR</span></div><div class="learn-actions"><button id="tocClose" class="learn-btn ghost">返回教材</button></div></header><main id="tocBody" class="learn-body"></main>';
    document.body.appendChild(w);
    $('tocClose').addEventListener('click', requestLeave);
  }
  function open() {
    build(); state.open = true; $('tocRoot').classList.remove('hidden');
    if (root.AppShell && AppShell.attachToc) AppShell.attachToc();
    Promise.all([ExamStore.getMeta('ocrDraft:last'), LearningStore.listTextbooks(), ExamStore.getMeta('ocrDrafts')]).then(function (r) {
      state.draft = r[0]; state.textbooks = r[1] || []; state.drafts = Array.isArray(r[2]) ? r[2] : []; render();
    }).catch(function () { render(); });
  }
  function close() { state.open = false; var r = $('tocRoot'); if (r) r.classList.add('hidden'); if (root.AppShell && AppShell.detachToc) AppShell.detachToc(); }

  function methodLabel(m) { return m === 'text' ? '文字目录' : m === 'ocr' ? '扫描识别' : '待识别'; }
  function statusLabel(s) { return { queued: '等待', loading: '处理中', ready: '待核对', error: '失败', cancelled: '已取消' }[s] || s; }
  function render() {
    var html = '<div class="learn-card"><div class="learn-filter"><input id="tocFiles" type="file" accept=".pdf,application/pdf" multiple class="hidden"><button id="tocPick" class="learn-btn primary">选择教材 PDF（可多选）</button><label>目录页范围<input id="tocRange" class="learn-input" value="' + esc(state.range) + '" placeholder="1-5,8"></label><span class="learn-note">选择教材 PDF，识别并整理目录。</span></div></div>';
    var drafts = state.drafts || [];
    if (!drafts.length && state.draft && state.draft.entries && state.draft.entries.length) drafts = [state.draft];
    if (drafts.length) html += '<div class="learn-card"><div class="learn-filter"><b>未完成的草稿</b><span class="learn-note">恢复后可继续核对</span></div><div class="learn-actions-row">' + drafts.slice(0, 8).map(function (d, i) { return '<button class="learn-btn" data-toc-draft="' + i + '">' + esc(d.fileName || '未命名') + '（' + ((d.entries || []).length) + ' 条）</button>'; }).join('') + '</div></div>';
    html += '<div class="learn-split"><div class="learn-book-list">' + (state.tasks.length ? state.tasks.map(function (t, i) {
      return '<div class="learn-book' + (i === state.active ? ' active' : '') + '" data-toc-task="' + i + '"><b>' + esc(t.name) + '</b><div class="learn-sub">' + Math.round(t.size / 1024) + ' KB · ' + (t.pages || '?') + ' 页</div><div class="learn-sub">' + esc(methodLabel(t.method)) + ' · ' + esc(statusLabel(t.status)) + '</div><div class="learn-sub">' + esc(t.message || '') + '</div><div class="learn-actions-row">' + (t.status === 'error' || t.status === 'cancelled' ? '<button class="learn-btn" data-toc-retry="' + i + '">重试</button>' : '') + ((t.status === 'queued' || t.status === 'loading') ? '<button class="learn-btn" data-toc-cancel="' + i + '">取消</button>' : '') + '</div></div>';
    }).join('') : '<div class="learn-empty">尚未选择文件</div>') + '</div><div class="learn-book-detail">' + renderActive() + '</div></div>';
    $('tocBody').innerHTML = html;
    $('tocPick').addEventListener('click', function () { $('tocFiles').click(); });
    $('tocFiles').addEventListener('change', function () { var fs = [].slice.call(this.files || []); this.value = ''; if (fs.length) processFiles(fs); });
    $('tocRange').addEventListener('change', function () { state.range = this.value; });
    $('tocBody').querySelectorAll('[data-toc-draft]').forEach(function (b) { b.addEventListener('click', function () { restoreDraft(Number(b.getAttribute('data-toc-draft'))); }); });
    $('tocBody').querySelectorAll('[data-toc-task]').forEach(function (el) { el.addEventListener('click', function (e) { if (e.target.closest('button')) return; state.active = Number(el.getAttribute('data-toc-task')); render(); }); });
    $('tocBody').querySelectorAll('[data-toc-cancel]').forEach(function (b) { b.addEventListener('click', function () { var t = state.tasks[+b.getAttribute('data-toc-cancel')]; if (!t) return; t.cancelled = true; t.status = 'cancelled'; t.message = '已取消，未保存结果'; stopAll().catch(function (err) { toast('取消失败：' + (err.message || err)); }); render(); }); });
    $('tocBody').querySelectorAll('[data-toc-retry]').forEach(function (b) { b.addEventListener('click', function () { var t = state.tasks[+b.getAttribute('data-toc-retry')]; if (!t) return; if (t.running || state.busy) { toast('当前任务结束后再重试'); return; } t.cancelled = false; t.status = 'queued'; processTask(t); }); });
    wireActive();
  }

  function renderActive() {
    var t = state.tasks[state.active];
    if (!t) return '<div class="learn-empty">选择 PDF 后显示识别预览</div>';
    if (t.status !== 'ready') return '<div class="learn-empty">' + esc(t.message || '处理中…') + '</div>';
    var q = refreshTaskQuality(t);
    var canvas = '<div class="toc-preview"><canvas id="tocCanvas"></canvas><div class="learn-note">左侧为目录页预览（当前第 ' + (t.entries[0] && t.entries[0].pdfPage || 1) + ' 页）。</div></div>';
    var rows = t.entries.map(function (e, i) {
      return '<tr data-toc-row="' + i + '"><td>' + (i + 1) + '</td><td><input class="learn-input" data-toc-title="' + i + '" value="' + esc(e.title) + '"></td><td><select class="learn-select" data-toc-parent="' + i + '"><option value="">无</option>' + t.entries.map(function (x, xi) { return xi === i ? '' : '<option value="' + esc(x.tmpId) + '"' + (e.parentTmpId === x.tmpId ? ' selected' : '') + '>' + esc((x.title || '未命名').slice(0, 16)) + '</option>'; }).join('') + '</select></td><td><select class="learn-select" data-toc-level="' + i + '">' + [0, 1, 2, 3, 4].map(function (l) { return '<option value="' + l + '"' + (e.level === l ? ' selected' : '') + '>' + ['篇/编', '章', '节', '一、', '（一）/小节'][l] + '</option>'; }).join('') + '</select></td><td><input class="learn-input" data-toc-page="' + i + '" value="' + esc(e.printedPage || '') + '" placeholder="印刷页"></td><td>' + esc(e.pdfPage || '') + '</td><td><span class="learn-badge ' + (e.issues.length ? 'warn' : 'ok') + '">' + (e.issues.length ? '待确认' : '正常') + '</span></td><td><button class="learn-btn" data-toc-del="' + i + '">删除</button></td></tr>';
    }).join('');
    var qIssues = (q.weakDuplicates || 0) + (q.levelConflicts || 0) + (q.abnormalTitles || 0) + (q.pageIssues || 0);
    var qHtml = '<div class="learn-card" style="margin-bottom:10px"><div class="learn-actions-row"><b>目录质量检查</b><span class="learn-badge ' + (qIssues || q.needsReview ? 'warn' : 'ok') + '">' + (qIssues || q.needsReview ? '待核对' : '通过') + '</span></div><div class="learn-sub">有效章节 ' + (q.valid || 0) + ' · 自动合并重复 ' + (q.autoMerged || 0) + ' · 疑似重复 ' + (q.weakDuplicates || 0) + ' · 异常标题 ' + (q.abnormalTitles || 0) + ' · 层级冲突 ' + (q.levelConflicts || 0) + ' · 页码异常 ' + (q.pageIssues || 0) + '</div>' + (q.errors.length ? '<div class="learn-warn">请先修正：' + q.errors.map(esc).join('；') + '</div>' : '') + (q.needsReview ? '<label class="learn-check"><input type="checkbox" id="tocQualityAck"' + (t.qualityAckSignature === directorySignature(t.entries) ? ' checked' : '') + '> 我已核对当前目录的识别、重复、标题及页码问题，确认按当前内容导入</label>' : '') + '</div>';
    return '<div class="toc-workspace">' + canvas + '<div class="toc-editor"><div class="learn-actions-row"><b>识别结果（' + t.entries.length + ' 条，' + esc(t.method) + '）</b><button id="tocAdd" class="learn-btn">＋ 添加章节</button><button id="tocConfirmAll" class="learn-btn">全部确认</button><button id="tocSaveDraft" class="learn-btn">保存草稿</button><button id="tocExport" class="learn-btn">导出识别 JSON</button></div>' + qHtml +
      (t.duplicates && t.duplicates.length ? '<div class="learn-warn">疑似已有教材（仅提示，不自动合并）：' + t.duplicates.map(function (b) { return esc(b.name); }).join('、') + '。请人工判断是否为新版本。</div>' : '') +
      '<div class="toc-table-wrap"><table class="learn-table"><thead><tr><th>#</th><th>标题</th><th>父级</th><th>层级</th><th>印刷页</th><th>PDF页</th><th>状态</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="learn-card" style="margin-top:10px"><h3>原始识别文本</h3><textarea id="tocRaw" class="learn-textarea" readonly>' + esc((t.rawText || '').slice(0, 4000)) + '</textarea></div>' +
      '<div class="learn-card"><h3>确认入库</h3><div class="learn-filter"><label>目标<select id="tocTarget" class="learn-select"><option value="new">建立新教材</option>' + state.textbooks.map(function (b) { return '<option value="' + esc(b.id) + '">合并到：' + esc(b.name) + '</option>'; }).join('') + '</select></label><label>模式<select id="tocMode" class="learn-select"><option value="merge">合并（默认，不删除现有）</option><option value="replace">明确覆盖（先快照）</option></select></label><button id="tocImport" class="learn-btn primary">确认导入</button></div><div class="learn-note">默认合并：按章节 ID/标题匹配，不删除既有章节；无法匹配的保留为新增。覆盖会先写快照；被课程/任务引用的旧章节会保留。</div></div></div></div>';
  }

  async function drawPreview(t) {
    var cv = $('tocCanvas'); if (!cv) return;
    try {
      var doc = await pdfjsLib.getDocument({ data: new Uint8Array(t.buf).slice() }).promise;
      var pageNo = (t.entries.find(function (e) { return e.pdfPage; }) || {}).pdfPage || 1;
      var page = await doc.getPage(pageNo); var vp = page.getViewport({ scale: 1.1 });
      cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
      await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      if (page.cleanup) page.cleanup(); doc.destroy();
    } catch (e) { cv.width = 1; cv.height = 1; }
  }

  function wireActive() {
    var t = state.tasks[state.active];
    if (!t || t.status !== 'ready') return;
    drawPreview(t);
    function edited() {
      t.qualityAckSignature = null;
      var target = $('tocTarget').value, mode = $('tocMode').value;
      var scroll = $('tocBody').scrollTop, tableScroll = $('tocBody').querySelector('.toc-table-wrap').scrollTop;
      render();
      $('tocTarget').value = target; $('tocMode').value = mode;
      $('tocBody').scrollTop = scroll; $('tocBody').querySelector('.toc-table-wrap').scrollTop = tableScroll;
    }
    $('tocBody').querySelectorAll('[data-toc-title]').forEach(function (el) { el.addEventListener('change', function () { t.entries[+el.getAttribute('data-toc-title')].title = this.value.trim(); edited(); }); });
    $('tocBody').querySelectorAll('[data-toc-level]').forEach(function (el) { el.addEventListener('change', function () { t.entries[+el.getAttribute('data-toc-level')].level = +this.value; edited(); }); });
    $('tocBody').querySelectorAll('[data-toc-parent]').forEach(function (el) { el.addEventListener('change', function () { t.entries[+el.getAttribute('data-toc-parent')].parentTmpId = this.value || null; edited(); }); });
    $('tocBody').querySelectorAll('[data-toc-page]').forEach(function (el) { el.addEventListener('change', function () { t.entries[+el.getAttribute('data-toc-page')].printedPage = this.value.trim(); edited(); }); });
    $('tocBody').querySelectorAll('[data-toc-del]').forEach(function (b) { b.addEventListener('click', function () { t.entries.splice(+b.getAttribute('data-toc-del'), 1); render(); }); });
    if ($('tocAdd')) $('tocAdd').addEventListener('click', function () { t.entries.push({ tmpId: uid('toc'), rawText: '', title: '新增章节', level: 2, parentTmpId: null, order: t.entries.length, printedPage: '', pdfPage: null, method: t.method, issues: ['人工添加'], confirmed: false }); render(); });
    if ($('tocQualityAck')) $('tocQualityAck').addEventListener('change', function () { t.qualityAckSignature = this.checked ? directorySignature(t.entries) : null; });
    if ($('tocConfirmAll')) $('tocConfirmAll').addEventListener('click', function () { refreshTaskQuality(t); if (t.quality.errors.length) { toast('请先修正目录结构错误'); return; } t.entries.forEach(function (e) { e.confirmed = true; }); t.qualityAckSignature = directorySignature(t.entries); render(); toast('已确认当前目录'); });
    if ($('tocSaveDraft')) $('tocSaveDraft').addEventListener('click', async function () { await persistDraft(t); toast('草稿已保存'); });

    if ($('tocExport')) $('tocExport').addEventListener('click', function () { var b = new Blob([JSON.stringify({ schema: 'examcard.toc-recognition/v1', fileName: t.name, hash: t.hash, method: t.method, range: t.range, textInfo: t.textInfo, duplicates: t.duplicates || [], entries: t.entries, rawText: t.rawText }, null, 2)], { type: 'application/json' }); var a = document.createElement('a'); a.download = 'ExamCard_OCR_recognition_' + Date.now() + '.json'; a.href = URL.createObjectURL(b); document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 3000); });
    if ($('tocImport')) $('tocImport').addEventListener('click', async function () { await confirmImport(t); });
  }

  async function confirmImport(t) {
    if (t.saving || isStale(t)) return;
    var target = $('tocTarget').value, mode = $('tocMode').value;
    if (!t.entries.length) { toast('没有可导入章节'); return; }
    var bad = t.entries.filter(function (e) { return !e.title; });
    if (bad.length) { toast('存在空标题章节'); return; }
    var q = refreshTaskQuality(t);
    if (q.errors.length) { toast('请修正目录结构：' + q.errors[0]); return; }
    if (q.needsReview && t.qualityAckSignature !== directorySignature(t.entries)) { toast('请先核对并确认当前目录质量问题'); return; }
    if (mode === 'replace' && !confirm('覆盖会先保存快照，但可能影响已有章节。确认继续？')) return;
    var entries = t.entries.map(function (e) {
      return { id: e.tmpId, textbookId: target === 'new' ? 'imported-book' : target, parentId: e.parentTmpId || null, title: e.title, level: e.level, order: e.order, printedPage: e.printedPage || null, pdfPage: e.pdfPage || null, progressPercent: 0, progressNote: '', tagIds: [], source: e.method, sourcePdfHash: t.hash || null, rawText: e.rawText || '', issues: e.issues, confirmed: e.confirmed };
    });
    var catalog = { textbooks: [{ id: 'imported-book', name: t.name.replace(/\.pdf$/i, ''), publisher: '', edition: '', year: null, source: 'PDF OCR 导入', notes: '用户导入，待核对', sourcePdfHash: t.hash || null, sourcePdfName: t.name || null, sourceRange: t.range || null }], chapters: entries };
    t.saving = true;
    try {
      var r = await LearningStore.importCatalog(catalog, { mode: target === 'new' ? 'new' : mode, targetTextbookId: target === 'new' ? null : target });
      await removeDraft(t);
      state.tasks.splice(state.active, 1); state.active = 0;
      toast('导入完成：新增 ' + r.created + '，更新 ' + r.updated + '，保留引用 ' + r.retainedReferenced);
      if (root.LearningApp) await LearningApp.reloadIfOpen();
      render();
    } catch (e) { toast('导入失败：' + (e.message || e)); }
    finally { t.saving = false; }
  }

  function restoreDraft(index) {
    var list = (state.drafts && state.drafts.length) ? state.drafts : (state.draft ? [state.draft] : []);
    var d = typeof index === 'number' ? list[index] : list[0];
    if (!d) return;
    var t = { id: uid('job'), epoch: state.stopEpoch, name: d.fileName || '恢复的草稿', size: 0, buf: null, range: d.range || state.range, status: 'ready', message: '从草稿恢复，请核对', progress: 100, entries: d.entries || [], rawText: d.rawText || '', method: d.method || 'ocr', textInfo: d.textInfo || {}, quality: d.quality || null, hash: d.hash || null, duplicates: [] };
    state.tasks.push(t); state.active = state.tasks.length - 1; render();
  }

  root.TextbookImport = { open: open, close: close, beforeLeave: beforeLeave, finishLeave: finishLeave, requestLeave: requestLeave, stopForClear: stopForClear, _internal: { parseDirectory: parseDirectory, finalizeDirectory: finalizeDirectory, validateDirectory: validateDirectory, detectReliableText: detectReliableText, parseRanges: parseRanges, titleQuality: titleQuality, pageQuality: pageQuality } };
})(typeof window !== 'undefined' ? window : globalThis);
