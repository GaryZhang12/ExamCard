/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright 2026 ExamCard contributors */
/* ExamCard V4.2 · 题库管理 UI（题目筛选/编辑/批量标签/PDF定位/考试配置/导入质量） */
(function (root) {
  'use strict';
  var state = { open: false, tab: 'questions', exams: [], tags: [], profiles: [], qTags: {}, filter: { examType: '', year: '', examId: '', module: '', type: '', search: '', unlabelled: false, anomalies: false }, selected: {}, pendingLoc: null };
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(msg) { var old = document.querySelector('.bank-toast'); if (old) old.remove(); var el = document.createElement('div'); el.className = 'bank-toast'; el.textContent = msg; document.body.appendChild(el); setTimeout(function () { el.remove(); }, 2800); }
  function qid(q) { return q.questionId || q.id; }
  function tagsOf(id) { return state.qTags[id] || []; }
  function tagName(id) { var t = state.tags.filter(function (x) { return x.id === id; })[0]; return t ? t.name : id; }
  function download(name, text) { var b = new Blob([text], { type: 'application/json;charset=utf-8' }); var a = document.createElement('a'); a.download = name; a.href = URL.createObjectURL(b); document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 3000); }
  function parseOptions(text) {
    var out = [], seen = {};
    String(text || '').split(/[|｜]/).forEach(function (p) {
      var m = /^\s*([A-D])\s*[.．、:：)）]?\s*(.*)$/.exec(p);
      if (!m || seen[m[1]]) return; seen[m[1]] = true; out.push({ key: m[1], text: (m[2] || '').trim() });
    });
    return out;
  }

  function buildRoot() {
    if ($('bankRoot')) return;
    var w = document.createElement('div'); w.id = 'bankRoot'; w.className = 'bank-root hidden';
    w.innerHTML = '<header class="bank-top"><div class="bank-brand"><img src="assets/examcard-wordmark.png"><span class="t">题库管理</span></div>' +
      '<div class="bank-tabs">' + [['questions', '题目管理'], ['profiles', '考试配置'], ['quality', '导入质量']].map(function (x) { return '<button data-btab="' + x[0] + '"' + (x[0] === 'questions' ? ' class="active"' : '') + '>' + x[1] + '</button>'; }).join('') + '</div>' +
      '<div class="bank-actions"><button id="bankClose" class="bank-btn ghost">关闭</button></div></header>' +
      '<main id="bankBody" class="bank-body"></main><div id="bankModalRoot"></div>';
    document.body.appendChild(w);
    $('bankClose').addEventListener('click', close);
    w.querySelectorAll('[data-btab]').forEach(function (b) { b.addEventListener('click', function () { state.tab = b.getAttribute('data-btab'); w.querySelectorAll('[data-btab]').forEach(function (x) { x.classList.toggle('active', x === b); }); render(); }); });
  }
  function open(tab) {
    if (typeof tab === 'string') state.tab = tab;
    if (!root.ExamStore) return;
    var examView = $('examView'); if (examView && !examView.classList.contains('hidden')) { toast('请先返回试卷库，再打开题库管理'); return; }
    buildRoot(); state.open = true; $('bankRoot').classList.remove('hidden'); document.querySelectorAll('[data-btab]').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-btab') === state.tab); }); load();
  }
  function close() { state.open = false; var r = $('bankRoot'); if (r) r.classList.add('hidden'); }
  async function load() {
    try {
      await DiagnosisStore.ensureModuleTags();
      state.exams = await ExamStore.listExams();
      state.tags = await DiagnosisStore.listTags();
      state.profiles = await ExamStore.listExamProfiles();
      var qt = await DiagnosisStore.getAllQuestionTags();
      state.qTags = {}; qt.forEach(function (x) { (state.qTags[x.questionId] = state.qTags[x.questionId] || []).push(x.tagId); });
      render();
    } catch (e) { console.error(e); $('bankBody').innerHTML = '<div class="bank-empty">题库加载失败：' + esc(e.message) + '</div>'; }
  }

  function allRows() {
    var rows = [];
    state.exams.forEach(function (exam) {
      (exam.questions || []).forEach(function (q) { rows.push({ exam: exam, q: q, id: qid(q) }); });
    });
    return rows;
  }
  function filteredRows() {
    var f = state.filter, s = f.search.trim().toLowerCase();
    return allRows().filter(function (r) {
      if (f.examType && (r.exam.profileId || 'unknown') !== f.examType) return false;
      if (f.year && String(r.exam.year || '') !== String(f.year)) return false;
      if (f.examId && r.exam.id !== f.examId) return false;
      if (f.module && r.q.module !== f.module) return false;
      if (f.type && r.q.type !== f.type) return false;
      if (f.unlabelled && tagsOf(r.id).length) return false;
      if (f.anomalies && !((r.q.issues || []).length || r.q.reviewStatus === 'needs-confirm')) return false;
      if (s) {
        var hay = [r.q.preview, r.q.module, r.q.n, (r.q.options || []).map(function (x) { return x.key + x.text; }).join(' '), r.exam.name].join(' ').toLowerCase();
        if (hay.indexOf(s) < 0) return false;
      }
      return true;
    });
  }

  function render() {
    if (!state.engine && false) return;
    if (state.tab === 'questions') renderQuestions();
    else if (state.tab === 'profiles') renderProfiles();
    else renderQuality();
  }

  function renderQuestions() {
    var rows = filteredRows();
    var all = allRows();
    var unlabelled = all.filter(function (r) { return !tagsOf(r.id).length; }).length;
    var anomalies = all.filter(function (r) { return (r.q.issues || []).length || r.q.reviewStatus === 'needs-confirm'; }).length;
    var years = Array.from(new Set(state.exams.map(function (e) { return e.year; }).filter(Boolean))).sort();
    var modules = Array.from(new Set(all.map(function (r) { return r.q.module; }))).sort();
    var selected = Object.keys(state.selected).length;
    var html = '<div class="bank-grid">' +
      '<div class="bank-stat"><div class="k">试卷</div><div class="v">' + state.exams.length + '</div></div>' +
      '<div class="bank-stat"><div class="k">题目</div><div class="v">' + all.length + '</div></div>' +
      '<div class="bank-stat"><div class="k">未标注知识点</div><div class="v">' + unlabelled + '</div></div>' +
      '<div class="bank-stat"><div class="k">识别异常</div><div class="v">' + anomalies + '</div></div>' +
      '<div class="bank-stat"><div class="k">已选</div><div class="v">' + selected + '</div></div></div>';
    html += '<div class="bank-card"><div class="bank-filter">' +
      '<select id="bankFExamType" class="bank-select"><option value="">全部考试类型</option>' + state.profiles.map(function (p) { return '<option value="' + esc(p.id) + '"' + (state.filter.examType === p.id ? ' selected' : '') + '>' + esc(p.name || p.id) + '</option>'; }).join('') + '</select>' +
      '<select id="bankFYear" class="bank-select"><option value="">全部年份</option>' + years.map(function (y) { return '<option' + (String(state.filter.year) === String(y) ? ' selected' : '') + '>' + esc(y) + '</option>'; }).join('') + '</select>' +
      '<select id="bankFExam" class="bank-select"><option value="">全部试卷</option>' + state.exams.map(function (e) { return '<option value="' + esc(e.id) + '"' + (state.filter.examId === e.id ? ' selected' : '') + '>' + esc(e.name) + '</option>'; }).join('') + '</select>' +
      '<select id="bankFModule" class="bank-select"><option value="">全部模块</option>' + modules.map(function (m) { return '<option' + (state.filter.module === m ? ' selected' : '') + '>' + esc(m) + '</option>'; }).join('') + '</select>' +
      '<select id="bankFType" class="bank-select"><option value="">全部题型</option><option value="single"' + (state.filter.type === 'single' ? ' selected' : '') + '>单选</option><option value="judge"' + (state.filter.type === 'judge' ? ' selected' : '') + '>判断</option><option value="multi"' + (state.filter.type === 'multi' ? ' selected' : '') + '>多选</option></select>' +
      '<input id="bankFSearch" class="bank-input" placeholder="搜索题干/选项/模块/试卷" value="' + esc(state.filter.search) + '">' +
      '<label class="bank-check"><input id="bankFUnlab" type="checkbox"' + (state.filter.unlabelled ? ' checked' : '') + '> 未标注</label>' +
      '<label class="bank-check"><input id="bankFAnom" type="checkbox"' + (state.filter.anomalies ? ' checked' : '') + '> 识别异常</label>' +
      '</div><div class="bank-actions-row"><button id="bankSelectAll" class="bank-btn">全选筛选结果</button><button id="bankClearSel" class="bank-btn">清空选择</button><button id="bankBatchTag" class="bank-btn primary">批量标注知识点</button><button id="bankBatchType" class="bank-btn">批量归入考试类型</button><button id="bankExamMeta" class="bank-btn">编辑试卷信息</button><span class="bank-note">编辑只改显示/标签/元数据，不改变 questionId，不改写历史成绩。</span></div>' +
      '<div class="bank-table-wrap"><table class="bank-table"><thead><tr><th><input type="checkbox" id="bankCheckAll"></th><th>试卷</th><th>题号</th><th>题型</th><th>模块</th><th>题干/选项</th><th>知识点</th><th>识别状态</th><th>来源/版权</th><th>操作</th></tr></thead><tbody>' +
      rows.slice(0, 500).map(function (r) {
        var q = r.q, id = r.id;
        var st = q.manualEdited ? '人工修正' : (q.reviewStatus === 'needs-confirm' ? '待确认' : '正常');
        var issues = (q.issues || []).map(function (x) { return x.message || x.code; }).join('；');
        return '<tr><td><input type="checkbox" data-bsel="' + esc(id) + '"' + (state.selected[id] ? ' checked' : '') + '></td>' +
          '<td>' + esc(r.exam.name) + '</td><td>' + esc(q.n) + '</td><td>' + esc(q.type) + '</td><td>' + esc(q.module) + '</td>' +
          '<td><div class="bank-preview">' + esc((q.preview || '').slice(0, 90)) + '<div class="bank-sub">' + esc((q.options || []).map(function (o) { return o.key + '、' + o.text; }).join(' | ').slice(0, 120)) + '</div></div></td>' +
          '<td>' + (tagsOf(id).length ? tagsOf(id).map(function (t) { return '<span class="bank-badge tag">' + esc(tagName(t)) + '</span>'; }).join('') : '<span class="bank-badge">未标注</span>') + '</td>' +
          '<td><span class="bank-badge ' + (st === '正常' ? 'ok' : 'warn') + '">' + esc(st) + '</span>' + (issues ? '<div class="bank-sub">' + esc(issues) + '</div>' : '') + '</td>' +
          '<td><div class="bank-sub">' + esc(q.source || r.exam.paperSource || '') + '<br>' + esc(q.copyright || r.exam.copyright || '未填写版权') + '</div></td>' +
          '<td><button class="bank-btn" data-bedit="' + esc(id) + '" data-exam="' + esc(r.exam.id) + '">编辑</button> <button class="bank-btn" data-bpdf="' + esc(id) + '" data-exam="' + esc(r.exam.id) + '">原题</button></td></tr>';
      }).join('') + '</tbody></table>' + (rows.length > 500 ? '<div class="bank-note">仅显示前 500 条，请使用筛选缩小范围。</div>' : '') + '</div></div>';
    $('bankBody').innerHTML = html;
    ['bankFExamType', 'bankFYear', 'bankFExam', 'bankFModule', 'bankFType'].forEach(function (id) {
      var el = $(id); if (el) el.addEventListener('change', function () {
        state.filter[{ bankFExamType: 'examType', bankFYear: 'year', bankFExam: 'examId', bankFModule: 'module', bankFType: 'type' }[id]] = this.value; render();
      });
    });
    $('bankFSearch').addEventListener('input', function () { state.filter.search = this.value; render(); });
    $('bankFUnlab').addEventListener('change', function () { state.filter.unlabelled = this.checked; render(); });
    $('bankFAnom').addEventListener('change', function () { state.filter.anomalies = this.checked; render(); });
    $('bankSelectAll').addEventListener('click', function () { rows.forEach(function (r) { state.selected[r.id] = true; }); render(); });
    $('bankClearSel').addEventListener('click', function () { state.selected = {}; render(); });
    $('bankCheckAll').addEventListener('change', function () { var on = this.checked; rows.forEach(function (r) { state.selected[r.id] = on; }); render(); });
    $('bankBody').querySelectorAll('[data-bsel]').forEach(function (cb) { cb.addEventListener('change', function () { state.selected[cb.getAttribute('data-bsel')] = cb.checked; }); });
    $('bankBody').querySelectorAll('[data-bedit]').forEach(function (b) { b.addEventListener('click', function () { openQuestionEdit(b.getAttribute('data-bedit')); }); });
    $('bankBody').querySelectorAll('[data-bpdf]').forEach(function (b) { b.addEventListener('click', function () { openPdf(b.getAttribute('data-bpdf'), b.getAttribute('data-exam')); }); });
    $('bankBatchTag').addEventListener('click', batchTag);
    $('bankBatchType').addEventListener('click', batchType);
    $('bankExamMeta').addEventListener('click', function () { var eid = state.filter.examId || (state.exams[0] && state.exams[0].id); if (!eid) { toast('没有可编辑的试卷'); return; } openExamMeta(eid); });
  }

  function openExamMeta(examId) {
    var exam = state.exams.filter(function (e) { return e.id === examId; })[0]; if (!exam) return;
    openModal('<h3>编辑试卷信息</h3><div class="bank-form-row"><label>名称<input id="bankExName" class="bank-input" value="' + esc(exam.name) + '"></label><label>年份<input id="bankExYear" type="number" class="bank-input" value="' + (exam.year || '') + '"></label><label>考试类型<select id="bankExProfile" class="bank-select">' + state.profiles.map(function (p) { return '<option value="' + esc(p.id) + '"' + ((exam.profileId || 'unknown') === p.id ? ' selected' : '') + '>' + esc(p.name || p.id) + '</option>'; }).join('') + '</select></label></div>' +
      '<div class="bank-form-row"><label>试卷来源<input id="bankExSource" class="bank-input" value="' + esc(exam.paperSource || exam.source || '') + '"></label><label>版权说明<input id="bankExCopyright" class="bank-input" value="' + esc(exam.copyright || '') + '"></label></div>' +
      '<div class="bank-note">修改元数据/考试归类不会改变题目 questionId 或历史批改快照。</div><div class="actions"><button class="bank-btn" data-cancel>取消</button><button class="bank-btn primary" data-ok>保存</button></div>');
    wireModal(async function () {
      exam.name = $('bankExName').value.trim() || exam.name;
      exam.year = parseInt($('bankExYear').value, 10) || null;
      exam.profileId = $('bankExProfile').value; exam.examType = exam.profileId;
      exam.paperSource = $('bankExSource').value.trim(); exam.copyright = $('bankExCopyright').value.trim();
      await ExamStore.putExam(exam); closeModal(); await load(); toast('试卷信息已保存');
    });
  }

  function selectedRows() { var all = allRows(); return all.filter(function (r) { return state.selected[r.id]; }); }

  function openQuestionEdit(id) {
    var r = allRows().filter(function (x) { return x.id === id; })[0]; if (!r) return;
    var q = JSON.parse(JSON.stringify(r.q));
    var optionsText = (q.options || []).map(function (o) { return o.key + '、' + o.text; }).join(' | ');
    openModal('<h3>编辑题目 · ' + esc(r.exam.name) + '</h3><div class="bank-note">questionId：<code>' + esc(id) + '</code>（不会改变）</div>' +
      '<div class="bank-form-row"><label>题号<input id="bankEqN" type="number" class="bank-input" value="' + esc(q.n) + '"></label><label>题型<select id="bankEqType" class="bank-select"><option value="single"' + (q.type === 'single' ? ' selected' : '') + '>单选</option><option value="judge"' + (q.type === 'judge' ? ' selected' : '') + '>判断</option><option value="multi"' + (q.type === 'multi' ? ' selected' : '') + '>多选</option></select></label><label>模块<input id="bankEqModule" class="bank-input" value="' + esc(q.module) + '"></label><label>页码<input id="bankEqPage" type="number" class="bank-input" value="' + esc(q.page) + '"></label><label>纵向位置%<input id="bankEqY" type="number" step="0.1" class="bank-input" value="' + ((q.yRatio || 0) * 100).toFixed(1) + '"></label></div>' +
      '<div class="bank-form-row"><label>来源<input id="bankEqSource" class="bank-input" value="' + esc(q.source || '') + '"></label><label>版权说明<input id="bankEqCopyright" class="bank-input" value="' + esc(q.copyright || '') + '"></label></div>' +
      '<div class="bank-form-row"><label style="flex:1">选项（A、... | B、...）<input id="bankEqOptions" class="bank-input" value="' + esc(optionsText) + '"></label></div>' +
      '<div class="bank-form-row"><label style="flex:1">题干预览<input id="bankEqPreview" class="bank-input" value="' + esc(q.preview || '') + '"></label></div>' +
      '<div class="bank-form-row"><label style="flex:1">知识点<div id="bankEqTags" class="bank-taglist">' + state.tags.map(function (t) { return '<label class="bank-check"><input type="checkbox" value="' + esc(t.id) + '"' + (tagsOf(id).indexOf(t.id) >= 0 ? ' checked' : '') + '> ' + esc(t.name) + (t.enabled === false ? '（停用）' : '') + '</label>'; }).join('') + '</div></label></div>' +
      '<div class="bank-actions-row"><button class="bank-btn" id="bankEqPdf">查看/修正原题位置</button><span class="bank-note">修改题号/题型/模块只影响题库显示；历史批改快照保持不变。</span></div>' +
      '<div class="actions"><button class="bank-btn" data-cancel>取消</button><button class="bank-btn primary" data-ok>保存</button></div>', true);
    wireModal(function () {
      q.n = Number($('bankEqN').value) || q.n;
      q.type = $('bankEqType').value;
      q.module = $('bankEqModule').value.trim() || q.module;
      q.page = Number($('bankEqPage').value) || q.page;
      q.yRatio = Math.max(0, Math.min(1, (Number($('bankEqY').value) || 0) / 100));
      q.source = $('bankEqSource').value.trim(); q.copyright = $('bankEqCopyright').value.trim();
      q.options = parseOptions($('bankEqOptions').value); q.preview = $('bankEqPreview').value;
      var tagIds = [].slice.call($('bankEqTags').querySelectorAll('input:checked')).map(function (x) { return x.value; });
      var exam = JSON.parse(JSON.stringify(r.exam));
      var idx = exam.questions.findIndex(function (x) { return qid(x) === id; });
      exam.questions[idx] = q;
      ExamStore.putExam(exam).then(function () { return DiagnosisStore.setQuestionTags(id, exam.id, tagIds); }).then(function () { closeModal(); load(); toast('题目已保存（questionId 不变）'); }).catch(function (e) { toast('保存失败：' + (e.message || e)); });
    });
    $('bankEqPdf').addEventListener('click', function () { openPdf(id, r.exam.id); });
  }

  async function openPdf(id, examId) {
    var exam = state.exams.filter(function (e) { return e.id === examId; })[0]; if (!exam) return;
    var q = exam.questions.filter(function (x) { return qid(x) === id; })[0]; if (!q) return;
    openModal('<h3>原题位置 · 第 ' + esc(q.n) + ' 题</h3><div class="bank-note">页码 ' + esc(q.page) + '；点击 PDF 设置纵向位置，保存后写入题库（不改原始 PDF）。</div><div style="overflow:auto;max-height:70vh;text-align:center"><canvas id="bankPdfCanvas" style="max-width:100%;box-shadow:0 2px 12px rgba(0,0,0,.15)"></canvas></div><div class="actions"><button class="bank-btn" data-cancel>关闭</button><button class="bank-btn primary" id="bankLocSave">保存位置</button></div>', true);
    var maskRoot = $('bankModalRoot');
    maskRoot.querySelector('[data-cancel]').addEventListener('click', closeModal);
    try {
      var blob = await ExamStore.getExamPdf(exam.id); var buf = await blob.arrayBuffer();
      var pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
      var page = await pdf.getPage(q.page || 1); var viewport = page.getViewport({ scale: 1.5 });
      var canvas = $('bankPdfCanvas'); canvas.width = viewport.width; canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise; pdf.destroy();
      state.pendingLoc = { page: q.page, yRatio: q.yRatio || 0, xRatio: q.xRatio || 0 };
      canvas.addEventListener('click', function (e) {
        var rect = canvas.getBoundingClientRect();
        state.pendingLoc.yRatio = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
        state.pendingLoc.xRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        var ctx = canvas.getContext('2d'); ctx.fillStyle = 'rgba(37,99,235,.85)'; ctx.beginPath(); ctx.arc((e.clientX - rect.left), (e.clientY - rect.top), 7, 0, Math.PI * 2); ctx.fill();
        toast('位置已选：' + (state.pendingLoc.yRatio * 100).toFixed(1) + '%，点击保存');
      });
      $('bankLocSave').addEventListener('click', async function () {
        var ex = JSON.parse(JSON.stringify(exam)); var qq = ex.questions.filter(function (x) { return qid(x) === id; })[0];
        qq.page = state.pendingLoc.page; qq.yRatio = state.pendingLoc.yRatio; qq.xRatio = state.pendingLoc.xRatio;
        await ExamStore.putExam(ex); closeModal(); await load(); toast('原题位置已保存');
      });
    } catch (e) { toast('PDF 加载失败：' + (e.message || e)); }
  }

  async function batchTag() {
    var rows = selectedRows(); if (!rows.length) { toast('请先选择题目'); return; }
    openModal('<h3>批量标注知识点 · ' + rows.length + ' 题</h3><div class="bank-note">将追加所选标签；不会移除已有标签。</div><div class="bank-taglist">' + state.tags.map(function (t) { return '<label class="bank-check"><input type="checkbox" value="' + esc(t.id) + '"> ' + esc(t.name) + '</label>'; }).join('') + '</div><div class="actions"><button class="bank-btn" data-cancel>取消</button><button class="bank-btn primary" data-ok>应用</button></div>', true);
    wireModal(async function () {
      var ids = [].slice.call($('bankModalRoot').querySelectorAll('input[type=checkbox]:checked')).map(function (x) { return x.value; });
      for (var i = 0; i < rows.length; i++) { var cur = tagsOf(rows[i].id); await DiagnosisStore.setQuestionTags(rows[i].id, rows[i].exam.id, Array.from(new Set(cur.concat(ids)))); }
      closeModal(); state.selected = {}; await load(); toast('批量标注完成');
    });
  }

  async function batchType() {
    var rows = selectedRows(); if (!rows.length) { toast('请先选择题目'); return; }
    var exams = Array.from(new Set(rows.map(function (r) { return r.exam.id; })));
    openModal('<h3>批量归入考试类型</h3><div class="bank-note">将影响 ' + exams.length + ' 张试卷的 ExamProfile；不改变题目/历史成绩。</div><select id="bankBatchProfile" class="bank-select">' + state.profiles.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name || p.id) + '</option>'; }).join('') + '</select><div class="actions"><button class="bank-btn" data-cancel>取消</button><button class="bank-btn primary" data-ok>应用</button></div>');
    wireModal(async function () {
      var pid = $('bankBatchProfile').value;
      for (var i = 0; i < exams.length; i++) {
        var ex = state.exams.filter(function (e) { return e.id === exams[i]; })[0];
        if (ex) { ex.profileId = pid; ex.examType = pid; await ExamStore.putExam(ex); }
      }
      closeModal(); await load(); toast('考试类型已更新');
    });
  }

  function renderProfiles() {
    var html = '<div class="bank-card"><h3>考试配置 · 广东/深圳独立</h3><div class="bank-note">时长、模块、规则空白表示未配置，不冒充官方标准；配置来自真实资料或用户输入。</div><table class="bank-table"><thead><tr><th>ID</th><th>名称</th><th>类型</th><th>完整模拟时长</th><th>模块顺序</th><th>说明</th><th>操作</th></tr></thead><tbody>' +
      state.profiles.map(function (p) {
        var rules = p.rules || {};
        return '<tr><td>' + esc(p.id) + '</td><td>' + esc(p.name || '') + '</td><td>' + esc(p.examType || '') + '</td><td>' + (rules.durationMin != null ? esc(rules.durationMin) + ' 分钟' : '未配置') + '</td><td>' + esc((p.moduleOrder || []).join(' → ') || '未配置') + '</td><td>' + esc(rules.notes || '') + '</td><td><button class="bank-btn" data-bprofile="' + esc(p.id) + '">编辑配置</button></td></tr>';
      }).join('') + '</tbody></table></div>';
    $('bankBody').innerHTML = html;
    $('bankBody').querySelectorAll('[data-bprofile]').forEach(function (b) { b.addEventListener('click', function () { editProfile(b.getAttribute('data-bprofile')); }); });
  }

  function editProfile(id) {
    var p = state.profiles.filter(function (x) { return x.id === id; })[0] || { id: id, name: '', examType: id, rules: {}, moduleOrder: [] };
    var rules = p.rules || {};
    openModal('<h3>考试配置 · ' + esc(p.id) + '</h3><div class="bank-form-row"><label>名称<input id="bankPName" class="bank-input" value="' + esc(p.name) + '"></label><label>类型<input id="bankPType" class="bank-input" value="' + esc(p.examType) + '"></label><label>完整模拟时长（分钟，留空=未配置）<input id="bankPDuration" type="number" class="bank-input" value="' + (rules.durationMin != null ? esc(rules.durationMin) : '') + '"></label></div>' +
      '<div class="bank-form-row"><label style="flex:1">模块顺序（每行一个名称）<textarea id="bankPOrder" class="bank-textarea">' + esc((p.moduleOrder || []).join('\n')) + '</textarea></label></div>' +
      '<div class="bank-form-row"><label style="flex:1">规则/来源说明<textarea id="bankPNotes" class="bank-textarea">' + esc(rules.notes || '') + '</textarea></label></div>' +
      '<div class="bank-note">将当前试卷归入此配置：</div><div class="bank-taglist">' + state.exams.map(function (e) { return '<label class="bank-check"><input type="checkbox" value="' + esc(e.id) + '"' + ((e.profileId || 'unknown') === p.id ? ' checked' : '') + '> ' + esc(e.name) + '</label>'; }).join('') + '</div>' +
      '<div class="actions"><button class="bank-btn" data-cancel>取消</button><button class="bank-btn primary" data-ok>保存配置</button></div>', true);
    wireModal(async function () {
      var duration = $('bankPDuration').value.trim();
      var rec = Object.assign({}, p, {
        name: $('bankPName').value.trim() || p.id, examType: $('bankPType').value.trim() || p.examType,
        moduleOrder: $('bankPOrder').value.split(/\n|,/).map(function (x) { return x.trim(); }).filter(Boolean),
        rules: Object.assign({}, rules, { durationMin: duration ? Number(duration) : null, notes: $('bankPNotes').value.trim() })
      });
      await ExamStore.putExamProfile(rec);
      var checked = [].slice.call($('bankModalRoot').querySelectorAll('.bank-taglist input[type=checkbox]:checked')).map(function (x) { return x.value; });
      for (var i = 0; i < state.exams.length; i++) {
        var ex = state.exams[i];
        var should = checked.indexOf(ex.id) >= 0;
        if (should) { ex.profileId = rec.id; ex.examType = rec.id; await ExamStore.putExam(ex); }
        else if ((ex.profileId || 'unknown') === rec.id && rec.id !== 'unknown') { ex.profileId = 'unknown'; ex.examType = 'unknown'; await ExamStore.putExam(ex); }
      }
      closeModal(); await load(); toast('考试配置已保存');
    });
  }

  function renderQuality() {
    var html = '<div class="bank-card"><h3>导入质量报告</h3><div class="bank-note">只展示真实识别/人工修正统计，不计算虚假准确率。旧内置卷无导入报告时显示“无报告”。</div><table class="bank-table"><thead><tr><th>试卷</th><th>页数</th><th>题数</th><th>题号异常</th><th>选项异常</th><th>页码异常</th><th>人工修正</th><th>未确认</th><th>重复风险</th><th>操作</th></tr></thead><tbody>' +
      state.exams.map(function (e) {
        var r = e.importReport || null;
        return '<tr><td>' + esc(e.name) + '</td><td>' + esc(r ? r.pageCount : e.pageCount) + '</td><td>' + esc(r ? r.importedCount : (e.questions || []).length) + '</td><td>' + (r ? esc(r.numberWarnings) : '—') + '</td><td>' + (r ? esc(r.optionMissing) : '—') + '</td><td>' + (r ? esc(r.pageWarnings) : '—') + '</td><td>' + (r ? esc(r.manualCorrections) : '—') + '</td><td>' + (r ? esc(r.unresolvedIssues) : '—') + '</td><td>' + (r ? ('相同文件 ' + r.duplicateRisk.exact + ' / 相似 ' + r.duplicateRisk.similar + ' / 相似题 ' + r.duplicateRisk.similarQuestions) : '—') + '</td><td><button class="bank-btn" data-bquality="' + esc(e.id) + '">导出 JSON</button></td></tr>';
      }).join('') + '</tbody></table></div>';
    $('bankBody').innerHTML = html;
    $('bankBody').querySelectorAll('[data-bquality]').forEach(function (b) { b.addEventListener('click', function () { var e = state.exams.filter(function (x) { return x.id === b.getAttribute('data-bquality'); })[0]; if (!e) return; if (!e.importReport) { toast('该试卷没有导入质量报告'); return; } download('ExamCard_导入质量_' + (e.name || 'exam').replace(/[\\/:*?"<>|\s]+/g, '_') + '.json', JSON.stringify(e.importReport, null, 2)); }); });
  }

  function openModal(html, wide) {
    $('bankModalRoot').innerHTML = '<div class="bank-mask"><div class="bank-modal" style="' + (wide ? 'width:min(1000px,96vw)' : '') + '">' + html + '</div></div>';
    $('bankModalRoot').firstElementChild.addEventListener('click', function (e) { if (e.target === e.currentTarget) closeModal(); });
  }
  function closeModal() { $('bankModalRoot').innerHTML = ''; }
  function wireModal(onOk) {
    var r = $('bankModalRoot'); var c = r.querySelector('[data-cancel]'); if (c) c.addEventListener('click', closeModal);
    var o = r.querySelector('[data-ok]'); if (o) o.addEventListener('click', function () { onOk(o); });
  }
  function init() { var b = document.getElementById('bankBtn'); if (b) b.addEventListener('click', open); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  root.QuestionBank = { open: open, close: close };
})(typeof window !== 'undefined' ? window : globalThis);
