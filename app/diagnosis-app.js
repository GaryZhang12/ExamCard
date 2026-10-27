/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright 2026 ExamCard contributors */
/* ExamCard V4.1 · 学习诊断 UI（标签/诊断/错题本/趋势/学习记录/报告） */
(function (root) {
  'use strict';
  var state = { open: false, tab: 'overview', engine: null, logs: [], exams: [], tags: [], activeExamId: null, filter: { examId: '', module: '', tagId: '', days: '', repeated: false }, selected: {}, chartModule: '' };
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pct(v) { return v == null ? '—' : (Math.round(v * 10) / 10) + '%'; }
  function sec(v) { return v == null ? '—' : (Math.round(v * 10) / 10) + 's'; }
  function dateStr(ts) { if (!ts) return '—'; var d = new Date(ts); return d.toLocaleString(); }
  function toast(msg) { var old = document.querySelector('.diag-toast'); if (old) old.remove(); var el = document.createElement('div'); el.className = 'diag-toast'; el.textContent = msg; document.body.appendChild(el); setTimeout(function () { el.remove(); }, 2800); }
  function download(name, text, type) {
    var blob = new Blob([text], { type: type || 'application/json;charset=utf-8' });
    var a = document.createElement('a'); a.download = name; a.href = URL.createObjectURL(blob);
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
  }

  function buildRoot() {
    if ($('diagRoot')) return;
    var w = document.createElement('div');
    w.id = 'diagRoot'; w.className = 'diag-root hidden';
    w.innerHTML = '<main id="diagBody" class="diag-body"></main><div id="diagModalRoot"></div>';
    document.body.appendChild(w);
    $('diagModalRoot').addEventListener('click', function (e) { if (e.target === $('diagModalRoot').firstElementChild) closeModal(); });
  }
  function open(tab) {
    if (typeof tab === 'string') state.tab = tab;
    if (!root.DiagnosisEngine || !root.DiagnosisStore) { toast('诊断模块未加载'); return; }
    var examView = $('examView');
    if (examView && !examView.classList.contains('hidden')) { toast('请先返回行测试卷库，再打开学习诊断'); return; }
    buildRoot(); state.open = true; $('diagRoot').classList.remove('hidden'); refresh();
  }
  function close() { state.open = false; var r = $('diagRoot'); if (r) r.classList.add('hidden'); }

  async function refresh() {
    if (!state.open) return;
    try {
      await DiagnosisStore.ensureModuleTags();
      state.engine = await DiagnosisEngine.load();
      state.logs = await DiagnosisStore.listStudyLogs();
      state.tags = await DiagnosisStore.listTags();
      state.exams = await DiagnosisStore.getAllExams();
      if (!state.activeExamId && state.exams.length) state.activeExamId = state.exams[0].id;
      render();
    } catch (e) { console.error(e); $('diagBody').innerHTML = '<div class="diag-warn">诊断数据加载失败：' + esc(e.message || e) + '</div>'; }
  }

  function render() {
    if (!state.engine) return;
    if (state.tab === 'overview') renderOverview();
    else if (state.tab === 'knowledge') renderKnowledge();
    else if (state.tab === 'wrong') renderWrong();
    else if (state.tab === 'trends') renderTrends();
    else if (state.tab === 'logs') renderLogs();
  }

  function stat(k, v, s) { return '<div class="diag-stat"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div>' + (s ? '<div class="s">' + esc(s) + '</div>' : '') + '</div>'; }

  function renderOverview() {
    var e = state.engine, o = e.overview;
    var notes = e.dataNotes.map(function (n) { return '<div class="diag-note">' + esc(n) + '</div>'; }).join('');
    var html = '<div class="diag-actions-row"><button id="diagExportOverview" class="diag-btn primary">导出诊断报告</button><span class="diag-note" style="margin:0">只导出真实作答与标签数据，不虚构学习时长。</span></div><div class="diag-grid">' +
      stat('练习次数', o.attemptCount, o.dateRange ? o.dateRange.from + ' ~ ' + o.dateRange.to : '暂无') +
      stat('作答题数', o.answered, '总记录 ' + o.questions) +
      stat('正确 / 错误', o.correct + ' / ' + o.incorrect, '正确率 ' + pct(o.accuracy)) +
      stat('平均每题用时', sec(o.avgSeconds), '作答计时') +
      stat('未作答', o.unanswered, '未批改 ' + o.unverified) +
      stat('疑问 / 超时', o.uncertain + ' / ' + o.overtime, '超时基于现有时间标准') +
      '</div>' + notes;
    if (!o.attemptCount) {
      html += '<div class="diag-empty" style="margin-top:12px">还没有可诊断的批改记录。完成行测练习并交卷后，这里会基于不可变快照生成统计。</div>';
      $('diagBody').innerHTML = html; return;
    }
    html += '<div class="diag-card"><h3>最近表现</h3><div class="diag-grid">' +
      stat('最近 5 次正确率', pct(e.recentCompare.current), e.recentCompare.currentAttempts + ' 次样本') +
      stat('此前 5 次正确率', pct(e.recentCompare.previous), e.recentCompare.previousAttempts + ' 次样本') +
      stat('变化', e.recentCompare.delta == null ? '数据不足' : (e.recentCompare.delta > 0 ? '+' : '') + e.recentCompare.delta + ' 个百分点', '仅比较已批改快照') + '</div></div>';
    if (e.weak.length) {
      html += '<div class="diag-card"><h3>需要关注 <span class="diag-badge warn">基于样本，不构成能力评分</span></h3><table class="diag-table"><thead><tr><th>类型</th><th>知识点/模块</th><th>指标</th><th>样本</th><th>会话数</th></tr></thead><tbody>' +
        e.weak.map(function (w) { return '<tr><td>' + esc({ accuracy: '正确率偏低', time: '平均耗时偏高', repeat: '反复出错', 'module-errors': '模块错误较多' }[w.type] || w.type) + '</td><td>' + esc(w.name) + '</td><td>' + (w.type === 'time' ? sec(w.value) : w.type === 'accuracy' ? pct(w.value) : esc(w.value)) + '</td><td>' + esc(w.sample) + '</td><td>' + esc(w.sessionCount) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    } else {
      html += '<div class="diag-card"><h3>需要关注</h3><div class="diag-empty">暂无满足最小样本的弱项结论。知识点样本不足 3 题时不会判定薄弱。</div></div>';
    }
    html += '<div class="diag-card"><h3>模块表现</h3><table class="diag-table"><thead><tr><th>模块</th><th>题次</th><th>答对</th><th>答错</th><th>未核实</th><th>正确率</th><th>平均用时</th></tr></thead><tbody>' +
      e.modules.map(function (m) { return '<tr><td>' + esc(m.key) + '</td><td>' + m.total + '</td><td>' + m.correct + '</td><td>' + m.incorrect + '</td><td>' + m.unverified + '</td><td>' + pct(m.accuracy) + '</td><td>' + sec(m.avgSeconds) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    html += '<div class="diag-card"><h3>知识点表现</h3>' + (e.knowledge.length ? '<table class="diag-table"><thead><tr><th>知识点</th><th>题次</th><th>正确/错误</th><th>正确率</th><th>平均用时</th><th>会话数</th></tr></thead><tbody>' +
      e.knowledge.map(function (k) { return '<tr><td>' + esc(k.name) + (k.isUntagged ? ' <span class="diag-badge">未标注</span>' : '') + '</td><td>' + k.total + '</td><td>' + k.correct + ' / ' + k.incorrect + '</td><td>' + pct(k.accuracy) + '</td><td>' + sec(k.avgSeconds) + '</td><td>' + k.sessionCount + '</td></tr>'; }).join('') + '</tbody></table>' : '<div class="diag-empty">尚未建立知识点标签，或还没有带标签的作答。</div>') + '</div>';
    $('diagBody').innerHTML = html;
    var ex = $('diagExportOverview');
    if (ex) ex.addEventListener('click', exportReport);
  }

  function tagUsage(tagId) {
    var n = 0; var q = state.engine && state.engine.qTags || {};
    Object.keys(q).forEach(function (k) { if (q[k].indexOf(tagId) >= 0) n++; });
    return n;
  }

  function renderKnowledge() {
    var tags = state.tags || [];
    var search = (state.tagSearch || '').toLowerCase();
    var shownTags = search ? tags.filter(function (t) { return (t.name + ' ' + (t.moduleName || '') + ' ' + (t.description || '')).toLowerCase().indexOf(search) >= 0; }) : tags;
    var exam = state.exams.filter(function (x) { return x.id === state.activeExamId; })[0] || state.exams[0];
    var qTags = state.engine.qTags || {};
    var questions = exam ? (exam.questions || []) : [];
    var unlabelled = questions.filter(function (q) { return !qTags[q.questionId || q.id]; }).length;
    var html = '<div class="diag-card"><h3>知识点标签 <span class="diag-badge">人工维护；不会改动 questionId / 历史成绩</span></h3>' +
      '<div class="diag-actions-row"><button id="diagNewTag" class="diag-btn primary">＋ 新建知识点</button><input id="diagTagSearch" class="diag-input" placeholder="搜索标签名称/模块/说明" value="' + esc(state.tagSearch || '') + '"><span class="diag-note" style="margin:0">当前试卷未标注题目：' + unlabelled + ' / ' + questions.length + '。</span></div>' +
      (shownTags.length ? '<table class="diag-table"><thead><tr><th>标签</th><th>考试类型</th><th>模块</th><th>父级</th><th>使用次数</th><th>状态</th><th>说明</th><th>操作</th></tr></thead><tbody>' +
        shownTags.map(function (t) { return '<tr><td>' + esc(t.name) + '</td><td>' + esc(t.examType) + '</td><td>' + esc(t.moduleName) + '</td><td>' + esc((tags.filter(function (x) { return x.id === t.parentId; })[0] || {}).name || '—') + '</td><td>' + tagUsage(t.id) + '</td><td>' + (t.enabled === false ? '停用' : '启用') + '</td><td>' + esc(t.description || '') + '</td><td><button class="diag-btn" data-edit-tag="' + esc(t.id) + '">编辑</button> <button class="diag-btn danger" data-del-tag="' + esc(t.id) + '">删除</button></td></tr>'; }).join('') + '</tbody></table>' : '<div class="diag-empty">' + (search ? '没有匹配的标签。' : '暂无标签，点击“新建知识点”。') + '</div>') + '</div>';
    html += '<div class="diag-card"><h3>题目标注</h3><div class="diag-filter"><label>试卷 <select id="diagTagExam" class="diag-select">' + state.exams.map(function (x) { return '<option value="' + esc(x.id) + '"' + (exam && x.id === exam.id ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select></label><span class="diag-note" style="margin:0">未标注题目明确显示“未标注”。</span></div>' +
      (questions.length ? '<div class="diag-qlist"><table class="diag-table"><thead><tr><th>题号</th><th>模块</th><th>题干</th><th>标签</th><th>操作</th></tr></thead><tbody>' +
        questions.map(function (q) {
          var qid = q.questionId || q.id; var ids = qTags[qid] || [];
          return '<tr><td>' + esc(q.n) + '</td><td>' + esc(q.module) + '</td><td>' + esc((q.preview || '').slice(0, 60)) + '</td><td>' + (ids.length ? ids.map(function (id) { var t = tags.filter(function (x) { return x.id === id; })[0]; return '<span class="diag-badge tag">' + esc(t ? t.name : id) + '</span>'; }).join('') : '<span class="diag-badge">未标注</span>') + '</td><td><button class="diag-btn" data-tag-q="' + esc(qid) + '" data-exam="' + esc(exam.id) + '">标注</button></td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="diag-empty">该试卷没有题目。</div>') + '</div>';
    $('diagBody').innerHTML = html;
    if ($('diagTagSearch')) $('diagTagSearch').addEventListener('input', function () { state.tagSearch = this.value; renderKnowledge(); setTimeout(function () { var e = $('diagTagSearch'); if (e) { e.focus(); e.setSelectionRange(e.value.length, e.value.length); } }, 0); });
    if ($('diagTagExam')) $('diagTagExam').addEventListener('change', function () { state.activeExamId = this.value; renderKnowledge(); });
    if ($('diagNewTag')) $('diagNewTag').addEventListener('click', function () { openTagModal(null); });
    $('diagBody').querySelectorAll('[data-edit-tag]').forEach(function (b) { b.addEventListener('click', function () { openTagModal(tags.filter(function (t) { return t.id === b.getAttribute('data-edit-tag'); })[0]); }); });
    $('diagBody').querySelectorAll('[data-del-tag]').forEach(function (b) {
      var tid = b.getAttribute('data-del-tag'); var usage = tagUsage(tid);
      b.addEventListener('click', function () { confirmModal('删除知识点', '该标签当前关联 ' + usage + ' 道题。删除会移除题目标注，但不会改动历史成绩。确定？', async function () { await DiagnosisStore.deleteTag(tid); await refresh(); }); });
    });
    $('diagBody').querySelectorAll('[data-tag-q]').forEach(function (b) { b.addEventListener('click', function () { openQuestionTagModal(b.getAttribute('data-tag-q'), b.getAttribute('data-exam')); }); });
  }

  function openTagModal(tag) {
    tag = tag || { name: '', examType: 'gd', moduleName: '', parentId: null, description: '', enabled: true };
    var tags = state.tags || [];
    openModal('<h3>' + (tag.id ? '编辑知识点' : '新建知识点') + '</h3>' +
      '<div class="row"><label>名称<input id="diagTagName" class="diag-input" value="' + esc(tag.name) + '"></label>' +
      '<label>考试类型<select id="diagTagExamType" class="diag-select"><option value="gd"' + (tag.examType === 'gd' ? ' selected' : '') + '>广东省考</option><option value="sz"' + (tag.examType === 'sz' ? ' selected' : '') + '>深圳市考</option><option value="all"' + (tag.examType === 'all' ? ' selected' : '') + '>通用</option></select></label>' +
      '<label>模块<input id="diagTagModule" class="diag-input" value="' + esc(tag.moduleName || '') + '" placeholder="如：资料分析"></label></div>' +
      '<div class="row"><label>父级<select id="diagTagParent" class="diag-select"><option value="">无</option>' + tags.filter(function (t) { return !tag.id || t.id !== tag.id; }).map(function (t) { return '<option value="' + esc(t.id) + '"' + (tag.parentId === t.id ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('') + '</select></label>' +
      '<label>状态<select id="diagTagEnabled" class="diag-select"><option value="1"' + (tag.enabled !== false ? ' selected' : '') + '>启用</option><option value="0"' + (tag.enabled === false ? ' selected' : '') + '>停用</option></select></label></div>' +
      '<div class="row"><label>说明<textarea id="diagTagDesc" class="diag-textarea">' + esc(tag.description || '') + '</textarea></label></div>' +
      '<div class="actions"><button class="diag-btn" data-cancel>取消</button><button class="diag-btn primary" data-ok>保存</button></div>', true);
    var rootM = $('diagModalRoot');
    rootM.querySelector('[data-cancel]').addEventListener('click', closeModal);
    rootM.querySelector('[data-ok]').addEventListener('click', async function () {
      try {
        await DiagnosisStore.saveTag(Object.assign({}, tag, {
          name: $('diagTagName').value, examType: $('diagTagExamType').value,
          moduleName: $('diagTagModule').value.trim(), parentId: $('diagTagParent').value || null,
          description: $('diagTagDesc').value, enabled: $('diagTagEnabled').value === '1'
        }));
        closeModal(); await refresh(); toast('知识点已保存');
      } catch (e) { toast(e.message || e); }
    });
  }

  function openQuestionTagModal(qid, examId) {
    var tags = state.tags.filter(function (t) { return t.enabled !== false; });
    var current = (state.engine.qTags[qid] || []);
    var exam = state.exams.filter(function (e) { return e.id === examId; })[0] || {};
    var q = (exam.questions || []).filter(function (x) { return (x.questionId || x.id) === qid; })[0] || {};
    var html = '<h3>标注题目 · 第 ' + esc(q.n) + ' 题</h3><div class="diag-note">模块：' + esc(q.module || '') + '。同一题可多选；保存只改标签，不改 questionId 或历史成绩。</div>';
    html += '<div class="diag-tag-list" style="display:block">' + (tags.length ? tags.map(function (t) {
      return '<label class="diag-check"><input type="checkbox" value="' + esc(t.id) + '"' + (current.indexOf(t.id) >= 0 ? ' checked' : '') + '> ' + esc(t.name) + ' <span class="diag-badge">' + esc(t.moduleName || '') + '</span></label>';
    }).join('') : '<div class="diag-empty">没有可用标签，请先在“知识点”新建。</div>') + '</div>';
    html += '<div class="actions"><button class="diag-btn" data-cancel>取消</button><button class="diag-btn primary" data-ok>保存标注</button></div>';
    openModal(html, true);
    var rootM = $('diagModalRoot');
    rootM.querySelector('[data-cancel]').addEventListener('click', closeModal);
    rootM.querySelector('[data-ok]').addEventListener('click', async function () {
      var ids = [].slice.call(rootM.querySelectorAll('input[type=checkbox]:checked')).map(function (x) { return x.value; });
      await DiagnosisStore.setQuestionTags(qid, examId, ids);
      closeModal(); await refresh(); toast('题目标注已保存');
    });
  }

  function wrongLabel(s) { return { not_retested: '尚未复测', correct: '最近复测正确', incorrect: '最近复测错误' }[s] || s || '尚未复测'; }

  function filteredWrongs() {
    var f = state.filter;
    return (state.engine.wrongs || []).filter(function (w) {
      if (f.examId && w.examId !== f.examId) return false;
      if (f.module && w.subject !== f.module) return false;
      if (f.tagId && w.tags.indexOf(f.tagId) < 0) return false;
      if (f.repeated && !w.repeated) return false;
      if (f.days && w.lastWrongAt && Date.now() - w.lastWrongAt > Number(f.days) * 86400000) return false;
      return true;
    });
  }

  function renderWrong() {
    var e = state.engine;
    var wrongs = filteredWrongs();
    var modules = Array.from(new Set(e.wrongs.map(function (w) { return w.subject; })));
    var html = '<div class="diag-card"><h3>错题本 <span class="diag-badge">按 questionId 聚合；同一题可多次错误/复测</span></h3>' +
      '<div class="diag-filter">' +
      '<label>试卷<select id="diagFExam" class="diag-select"><option value="">全部</option>' + state.exams.map(function (x) { return '<option value="' + esc(x.id) + '"' + (state.filter.examId === x.id ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select></label>' +
      '<label>模块<select id="diagFModule" class="diag-select"><option value="">全部</option>' + modules.map(function (m) { return '<option' + (state.filter.module === m ? ' selected' : '') + '>' + esc(m) + '</option>'; }).join('') + '</select></label>' +
      '<label>知识点<select id="diagFTag" class="diag-select"><option value="">全部</option>' + state.tags.map(function (t) { return '<option value="' + esc(t.id) + '"' + (state.filter.tagId === t.id ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('') + '</select></label>' +
      '<label>最近<input id="diagFDays" type="number" min="1" class="diag-input" style="width:70px" value="' + esc(state.filter.days || '') + '"> 天</label>' +
      '<label><input id="diagFRepeat" type="checkbox"' + (state.filter.repeated ? ' checked' : '') + '> 只看反复错误</label>' +
      '</div><div class="diag-actions-row"><button id="diagRetestSelected" class="diag-btn primary">复测选中（同一试卷）</button><button id="diagRetestAll" class="diag-btn">复测筛选结果</button><span class="diag-note" style="margin:0">复测独立保存成绩，不覆盖原始 Attempt。</span></div>' +
      (wrongs.length ? '<table class="diag-table"><thead><tr><th><input type="checkbox" id="diagCheckAll"></th><th>试卷</th><th>题号</th><th>模块</th><th>标签</th><th>错误次数</th><th>最近错误</th><th>复测状态</th><th>操作</th></tr></thead><tbody>' +
        wrongs.map(function (w) {
          return '<tr><td><input type="checkbox" data-wrong-select="' + esc(w.qid) + '"' + (state.selected[w.qid] ? ' checked' : '') + '></td><td>' + esc(w.examName) + '</td><td>' + esc(w.n) + '</td><td>' + esc(w.subject) + '</td><td>' + (w.tags.length ? w.tags.map(function (id) { var t = state.tags.filter(function (x) { return x.id === id; })[0]; return '<span class="diag-badge tag">' + esc(t ? t.name : id) + '</span>'; }).join('') : '<span class="diag-badge">未标注</span>') + '</td><td>' + w.wrongCount + '</td><td>' + esc(w.lastWrongDate) + '</td><td><span class="diag-badge ' + (w.retestStatus === 'correct' ? 'ok' : w.retestStatus === 'incorrect' ? 'err' : '') + '">' + esc(wrongLabel(w.retestStatus)) + '</span></td><td><button class="diag-btn" data-wrong-view="' + esc(w.qid) + '">定位原题</button> <button class="diag-btn" data-wrong-history="' + esc(w.qid) + '">历史</button> <button class="diag-btn" data-wrong-retest="' + esc(w.qid) + '">复测</button></td></tr>';
        }).join('') + '</tbody></table>' : '<div class="diag-empty">暂无错题记录。</div>') + '</div>';
    $('diagBody').innerHTML = html;
    $('diagFExam').addEventListener('change', function () { state.filter.examId = this.value; renderWrong(); });
    $('diagFModule').addEventListener('change', function () { state.filter.module = this.value; renderWrong(); });
    $('diagFTag').addEventListener('change', function () { state.filter.tagId = this.value; renderWrong(); });
    $('diagFDays').addEventListener('change', function () { state.filter.days = this.value; renderWrong(); });
    $('diagFRepeat').addEventListener('change', function () { state.filter.repeated = this.checked; renderWrong(); });
    if ($('diagCheckAll')) $('diagCheckAll').addEventListener('change', function () { var on = this.checked; wrongs.forEach(function (w) { state.selected[w.qid] = on; }); renderWrong(); });
    $('diagBody').querySelectorAll('[data-wrong-select]').forEach(function (cb) { cb.addEventListener('change', function () { state.selected[cb.getAttribute('data-wrong-select')] = cb.checked; }); });
    $('diagBody').querySelectorAll('[data-wrong-view]').forEach(function (b) { b.addEventListener('click', function () { viewOriginal(wrongs.filter(function (w) { return w.qid === b.getAttribute('data-wrong-view'); })[0]); }); });
    $('diagBody').querySelectorAll('[data-wrong-history]').forEach(function (b) { b.addEventListener('click', function () { showWrongHistory(wrongs.filter(function (w) { return w.qid === b.getAttribute('data-wrong-history'); })[0]); }); });
    $('diagBody').querySelectorAll('[data-wrong-retest]').forEach(function (b) { b.addEventListener('click', function () { startRetest(wrongs.filter(function (w) { return w.qid === b.getAttribute('data-wrong-retest'); })); }); });
    $('diagRetestSelected').addEventListener('click', function () { startRetest(wrongs.filter(function (w) { return state.selected[w.qid]; })); });
    $('diagRetestAll').addEventListener('click', function () { startRetest(wrongs); });
  }

  function showWrongHistory(w) {
    if (!w) return;
    var rows = (w.attempts || []).map(function (a) { return '<tr><td>' + esc(a.date) + '</td><td>' + esc(a.sessionId) + '</td><td>错误</td><td>' + esc(dateStr(a.gradedAt)) + '</td></tr>'; }).join('');
    var retests = (w.retests || []).map(function (r) { return '<tr><td>' + esc(r.date) + '</td><td>' + esc(r.sessionId) + '</td><td>' + esc({ correct: '正确', incorrect: '错误', unanswered: '未作答', unverified: '未核对' }[r.status] || r.status) + '</td><td>' + esc(dateStr(r.gradedAt)) + '</td></tr>'; }).join('');
    openModal('<h3>错题历史 · ' + esc(w.examName) + ' · 第' + esc(w.n) + '题</h3><div class="diag-note">同一 questionId 可多次错误；复测成绩独立保存，不回写原始 Attempt。</div>' +
      '<h3 style="font-size:14px">历次错误</h3>' + (rows ? '<table class="diag-table"><thead><tr><th>日期</th><th>会话</th><th>结果</th><th>时间</th></tr></thead><tbody>' + rows + '</tbody></table>' : '<div class="diag-empty">无</div>') +
      '<h3 style="font-size:14px;margin-top:12px">复测记录</h3>' + (retests ? '<table class="diag-table"><thead><tr><th>日期</th><th>复测会话</th><th>结果</th><th>时间</th></tr></thead><tbody>' + retests + '</tbody></table>' : '<div class="diag-empty">尚未复测</div>') +
      '<div class="actions"><button class="diag-btn" data-cancel>关闭</button></div>', true);
    $('diagModalRoot').querySelector('[data-cancel]').addEventListener('click', closeModal);
  }

  async function viewOriginal(w) {
    if (!w) return;
    openModal('<h3>原题位置 · ' + esc(w.examName) + ' · 第' + esc(w.n) + '题</h3><div class="diag-note">' + esc(w.subject) + ' · 页码 ' + esc((w.question && w.question.page) || '?') + '</div><div style="overflow:auto;max-height:70vh;text-align:center"><canvas id="diagPdfCanvas" style="max-width:100%;box-shadow:0 2px 12px rgba(0,0,0,.15)"></canvas></div><div class="actions"><button class="diag-btn" data-cancel>关闭</button></div>', true);
    $('diagModalRoot').querySelector('[data-cancel]').addEventListener('click', closeModal);
    try {
      var blob = await ExamStore.getExamPdf(w.examId);
      if (!blob) throw new Error('未找到原试卷 PDF');
      var buf = await blob.arrayBuffer();
      var pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
      var pageNo = (w.question && w.question.page) || 1;
      var page = await pdf.getPage(pageNo);
      var viewport = page.getViewport({ scale: 1.5 });
      var canvas = $('diagPdfCanvas');
      canvas.width = viewport.width; canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
      var ratio = (w.question && w.question.yRatio) || 0;
      var wrap = canvas.parentElement; wrap.scrollTop = Math.max(0, canvas.height * ratio - 80);
      pdf.destroy();
    } catch (e) { toast('PDF 定位失败：' + (e.message || e)); }
  }

  async function startRetest(rows) {
    rows = (rows || []).filter(Boolean);
    if (!rows.length) { toast('请选择错题'); return; }
    var exams = Array.from(new Set(rows.map(function (w) { return w.examId; })));
    if (exams.length > 1) { toast('一次复测只能选择一个试卷，请先按试卷筛选'); return; }
    if (!root.__GD_V2__ || !root.__GD_V2__.startRetest) { toast('行测答题组件未就绪'); return; }
    var w0 = rows[0];
    var qids = rows.map(function (w) { return w.qid; });
    var ns = rows.map(function (w) { return w.n; });
    var source = (w0.attempts && w0.attempts[w0.attempts.length - 1] || {}).sessionId || null;
    try {
      close();
      await root.__GD_V2__.startRetest(w0.examId, ns, source, qids);
      toast('已开始错题复测；成绩将独立保存');
    } catch (e) { console.error(e); toast('开始复测失败：' + (e.message || e)); }
  }

  function renderTrends() {
    var e = state.engine, trends = e.trends || [];
    var modules = e.modules.map(function (m) { return m.key; });
    if (!state.chartModule && modules.length) state.chartModule = modules[0];
    var html = '<div class="diag-card"><h3>历史趋势 <span class="diag-badge">样本量/统计区间见下表</span></h3>';
    if (!trends.length) {
      html += '<div class="diag-empty">暂无可绘制的趋势数据。旧版仅有 summary 的记录不补造逐题曲线。</div></div>';
      $('diagBody').innerHTML = html; return;
    }
    var maxAcc = 100;
    var w = 760, h = 210, pad = 34;
    var pts = trends.map(function (t, i) {
      var x = pad + (trends.length === 1 ? (w - pad * 2) / 2 : i * (w - pad * 2) / (trends.length - 1));
      var y = h - pad - (t.accuracy == null ? 0 : t.accuracy / maxAcc) * (h - pad * 2);
      return { x: x, y: y, t: t };
    });
    var path = pts.map(function (p, i) { return (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1); }).join(' ');
    html += '<div class="diag-note">数据区间：' + esc(trends[0].date) + ' ~ ' + esc(trends[trends.length - 1].date) + '；仅统计有逐题快照的会话。正确率分母 = 已核实作答（正确+错误）。</div>' +
      '<svg class="diag-chart" viewBox="0 0 ' + w + ' ' + h + '"><line x1="' + pad + '" y1="' + (h - pad) + '" x2="' + (w - pad) + '" y2="' + (h - pad) + '" stroke="#cbd5e1"></line><line x1="' + pad + '" y1="' + pad + '" x2="' + pad + '" y2="' + (h - pad) + '" stroke="#cbd5e1"></line>' +
      '<path d="' + path + '" fill="none" stroke="#2563eb" stroke-width="3"></path>' +
      pts.map(function (p) { return '<circle cx="' + p.x + '" cy="' + p.y + '" r="4" fill="#2563eb"></circle><text x="' + p.x + '" y="' + (p.y - 9) + '" font-size="10" text-anchor="middle" fill="#475569">' + (p.t.accuracy == null ? '—' : p.t.accuracy + '%') + '</text>'; }).join('') + '</svg>';
    html += '<table class="diag-table" style="margin-top:10px"><thead><tr><th>日期</th><th>练习次数</th><th>正确</th><th>错误</th><th>正确率</th><th>平均每题用时</th></tr></thead><tbody>' + trends.map(function (t) { return '<tr><td>' + esc(t.date) + '</td><td>' + t.attempts + '</td><td>' + t.correct + '</td><td>' + t.incorrect + '</td><td>' + pct(t.accuracy) + '</td><td>' + sec(t.avgSeconds) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    html += '<div class="diag-card"><h3>模块当前表现</h3><table class="diag-table"><thead><tr><th>模块</th><th>题次</th><th>正确率</th><th>平均用时</th><th>样本会话</th></tr></thead><tbody>' + e.modules.map(function (m) { return '<tr><td>' + esc(m.key) + '</td><td>' + m.total + '</td><td>' + pct(m.accuracy) + '</td><td>' + sec(m.avgSeconds) + '</td><td>' + m.sessionCount + '</td></tr>'; }).join('') + '</tbody></table><div class="diag-note">按日期分模块曲线的数据量可能不足；模块当前表现按全部已批改快照汇总，不编造时间曲线。</div></div>';
    html += '<div class="diag-card"><h3>模块近期变化</h3><table class="diag-table"><thead><tr><th>模块</th><th>最近 3 次正确率</th><th>此前 3 次正确率</th><th>变化</th><th>样本（题）</th></tr></thead><tbody>' + (e.moduleTrends || []).map(function (m) { return '<tr><td>' + esc(m.module) + '</td><td>' + pct(m.recent.accuracy) + '</td><td>' + pct(m.previous.accuracy) + '</td><td>' + (m.delta == null ? '数据不足' : (m.delta > 0 ? '+' : '') + m.delta + ' 个百分点') + '</td><td>' + m.recent.sample + ' / ' + m.previous.sample + '</td></tr>'; }).join('') + '</tbody></table><div class="diag-note">样本按会话计数；不足两个窗口时不判定改善/下降。</div></div>';
    html += '<div class="diag-card"><h3>知识点表现变化</h3>' + ((e.knowledgeTrends || []).length ? '<table class="diag-table"><thead><tr><th>知识点</th><th>最近 3 次正确率</th><th>此前 3 次正确率</th><th>变化</th><th>样本（题）</th></tr></thead><tbody>' + e.knowledgeTrends.map(function (k) { return '<tr><td>' + esc(k.name) + '</td><td>' + pct(k.recent.accuracy) + '</td><td>' + pct(k.previous.accuracy) + '</td><td>' + (k.delta == null ? '数据不足' : (k.delta > 0 ? '+' : '') + k.delta + ' 个百分点') + '</td><td>' + k.recent.sample + ' / ' + k.previous.sample + '</td></tr>'; }).join('') + '</tbody></table>' : '<div class="diag-empty">暂无带标签的跨会话数据；先完成题目标注并做多次练习。</div>') + '</div>';
    html += '<div class="diag-card"><h3>错题复测前后对比</h3>' + (e.retestCompare.length ? '<table class="diag-table"><thead><tr><th>复测日期</th><th>来源会话</th><th>来源错误数</th><th>复测正确</th><th>复测错误</th><th>题数</th></tr></thead><tbody>' + e.retestCompare.map(function (r) { return '<tr><td>' + esc(r.date) + '</td><td>' + esc(r.sourceSessionId || '—') + '</td><td>' + (r.beforeWrong == null ? '—' : r.beforeWrong) + '</td><td>' + r.retestCorrect + '</td><td>' + r.retestWrong + '</td><td>' + r.total + '</td></tr>'; }).join('') + '</tbody></table>' : '<div class="diag-empty">还没有复测记录。错题本中可发起复测。</div>') + '</div>';
    $('diagBody').innerHTML = html;
  }

  function diagnosisEvents() {
    var events = [];
    var attempts = (state.engine && state.engine.attempts) || [];
    attempts.forEach(function (a) {
      var s = (a.record && a.record.summary) || {};
      events.push({
        at: a.gradedAt || 0,
        date: a.date || dateStr(a.gradedAt),
        type: a.retest ? '错题复测诊断' : '行测练习诊断',
        scope: a.exam && a.exam.name || '未命名试卷',
        summary: '共 ' + (s.total == null ? '—' : s.total) + ' 题 · 正确 ' + (s.correct == null ? 0 : s.correct) + ' · 错误 ' + (s.incorrect == null ? 0 : s.incorrect) + ' · 正确率 ' + (s.accuracy == null ? '—' : s.accuracy + '%'),
        sessionId: a.record && a.record.sessionId || ''
      });
    });
    var wrongs = (state.engine && state.engine.wrongs) || [];
    wrongs.forEach(function (w) {
      events.push({
        at: w.lastWrongAt || 0,
        date: w.lastWrongDate || dateStr(w.lastWrongAt),
        type: '错题诊断',
        scope: (w.examName || '未命名试卷') + ' · 第' + w.n + '题',
        summary: '累计错误 ' + w.wrongCount + ' 次 · ' + (w.retestStatus === 'correct' ? '最近复测正确' : w.retestStatus === 'incorrect' ? '最近复测错误' : '尚未复测'),
        sessionId: ''
      });
    });
    events.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    return events;
  }
  function renderLogs() {
    var events = diagnosisEvents();
    var html = '<div class="diag-log-toolbar"><button id="diagExportEvents" class="diag-btn"' + (events.length ? '' : ' disabled') + '>导出诊断日志</button></div>';
    if (!events.length) {
      html += '<div class="diag-empty-state"><div class="diag-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h11l5 5v11H4z"/><path d="M15 4v5h5"/><path d="M8 13h8M8 17h5"/></svg></div><h3>暂无诊断记录</h3><p>完成练习并提交批改后，诊断结果将显示在这里。</p><button id="diagStartPractice" class="diag-btn primary">开始行测训练</button></div>';
    } else {
      html += '<div class="diag-card diag-log-card"><table class="diag-table"><thead><tr><th>日期</th><th>来源试卷 / 练习</th><th>诊断类别</th><th>关键诊断结果</th></tr></thead><tbody>' + events.slice(0, 200).map(function (ev) {
        return '<tr><td>' + esc(ev.date || '—') + '</td><td>' + esc(ev.scope || '—') + '</td><td><span class="diag-badge tag">' + esc(ev.type || '—') + '</span></td><td>' + esc(ev.summary || '—') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    }
    $('diagBody').innerHTML = html;
    if (events.length) {
      var ex = $('diagExportEvents');
      if (ex) ex.addEventListener('click', function () {
        download('ExamCard_诊断日志_' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify({ schema: 'examcard.diagnosis-events/v1', generatedAt: new Date().toISOString(), events: events }, null, 2));
        toast('诊断日志已导出');
      });
    }
    var start = $('diagStartPractice');
    if (start) start.addEventListener('click', function () {
      var b = document.querySelector('#appRail [data-nav="library"]');
      if (b) b.click();
    });
  }

  async function exportReport() {
    try {
      var report = DiagnosisEngine.report(state.engine, state.logs);
      download('ExamCard_学习诊断_' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(report, null, 2), 'application/json;charset=utf-8');
      toast('诊断报告已导出');
    } catch (e) { toast('导出失败：' + (e.message || e)); }
  }

  function openModal(html, wide) {
    $('diagModalRoot').innerHTML = '<div class="diag-modal-mask"><div class="diag-modal" style="' + (wide ? 'width:min(1000px,96vw)' : '') + '">' + html + '</div></div>';
    $('diagModalRoot').firstElementChild.addEventListener('click', function (e) { if (e.target === e.currentTarget) closeModal(); });
  }
  function closeModal() { if ($('diagModalRoot')) $('diagModalRoot').innerHTML = ''; }
  function confirmModal(title, msg, onOk) {
    openModal('<h3>' + esc(title) + '</h3><div class="diag-warn">' + esc(msg) + '</div><div class="actions"><button class="diag-btn" data-cancel>取消</button><button class="diag-btn danger" data-ok>确认</button></div>');
    var r = $('diagModalRoot'); r.querySelector('[data-cancel]').addEventListener('click', closeModal); r.querySelector('[data-ok]').addEventListener('click', function () { closeModal(); onOk(); });
  }

  function init() { var b = document.getElementById('diagnosisBtn'); if (b) b.addEventListener('click', open); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  root.DiagnosisApp = { open: open, close: close };
})(typeof window !== 'undefined' ? window : globalThis);
