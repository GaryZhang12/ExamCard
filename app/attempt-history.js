/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright 2026 ExamCard contributors */
/* V3.1 · 批改历史与差异对比（只读取 gradingRecords 快照，不重算历史成绩） */
(function (root) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtTime(ts) {
    if (!ts) return '—';
    try { return new Date(ts).toLocaleString(); } catch (e) { return String(ts); }
  }

  function statusText(s) {
    return s === 'graded' ? '已批改' : s === 'ungraded' ? '未批改（无标准答案）' : (s || '未知');
  }

  function gradingText(s) {
    return ({ correct: '正确', incorrect: '错误', unverified: '未核对', unanswered: '未作答' })[s] || (s || '未知');
  }

  function detailMap(record) {
    var map = {};
    (record && record.details || []).forEach(function (d) { map[d.question_id] = d; });
    return map;
  }

  function compare(records) {
    var graded = records.filter(function (r) { return r.gradingStatus === 'graded' && r.summary; });
    if (graded.length < 2) return null;
    var a = graded[graded.length - 2], b = graded[graded.length - 1];
    var ma = detailMap(a), mb = detailMap(b);
    var keys = Object.keys(mb).sort(function (x, y) { return Number(x) - Number(y); });
    var changed = [];
    keys.forEach(function (k) {
      var x = ma[k], y = mb[k];
      if (!x || !y) { changed.push({ n: k, from: x ? gradingText(x.grading_status) : '缺失', to: y ? gradingText(y.grading_status) : '缺失', fromAnswer: x && x.correct_answer, toAnswer: y && y.correct_answer }); return; }
      if (x.grading_status !== y.grading_status || String(x.correct_answer) !== String(y.correct_answer)) {
        changed.push({ n: k, from: gradingText(x.grading_status), to: gradingText(y.grading_status), fromAnswer: x.correct_answer, toAnswer: y.correct_answer });
      }
    });
    return {
      a: a,
      b: b,
      accuracyFrom: a.summary.accuracy,
      accuracyTo: b.summary.accuracy,
      correctFrom: a.summary.correct,
      correctTo: b.summary.correct,
      changed: changed
    };
  }

  function render(records) {
    var rows = records.map(function (r, i) {
      return '<tr>' +
        '<td class="num">' + (i + 1) + '</td>' +
        '<td><code>' + esc(r.attemptId) + '</code></td>' +
        '<td>' + esc(fmtTime(r.gradedAt)) + '</td>' +
        '<td>' + (r.standardAnswerVersion != null ? 'v' + esc(r.standardAnswerVersion) : '—') + '</td>' +
        '<td>' + esc(statusText(r.gradingStatus)) + '</td>' +
        '<td>' + (r.accuracy == null ? '—' : esc(r.accuracy.toFixed(1)) + '%') + '</td>' +
        '<td>' + (r.correct == null ? '—' : esc(r.correct)) + ' / ' + (r.incorrect == null ? '—' : esc(r.incorrect)) + '</td>' +
        '<td>' + esc(r.revisionOf || '—') + '</td>' +
        '</tr>';
    }).join('');

    var cmp = compare(records);
    var diffHtml = '<div class="issue-line warn">至少需要两次已批改记录才能对比。</div>';
    if (cmp) {
      var delta = (cmp.accuracyTo == null || cmp.accuracyFrom == null) ? '—' : (cmp.accuracyTo - cmp.accuracyFrom).toFixed(1) + ' 个百分点';
      diffHtml = '<div class="issue-line ok">最近两次批改：正确率 ' + (cmp.accuracyFrom == null ? '—' : cmp.accuracyFrom.toFixed(1) + '%') + ' → ' +
        (cmp.accuracyTo == null ? '—' : cmp.accuracyTo.toFixed(1) + '%') + '（' + esc(delta) + '），正确题数 ' + esc(cmp.correctFrom) + ' → ' + esc(cmp.correctTo) + '。</div>';
      if (cmp.changed.length) {
        diffHtml += '<table><thead><tr><th>题号</th><th>旧状态 → 新状态</th><th>旧参考答案 → 新参考答案</th></tr></thead><tbody>' +
          cmp.changed.map(function (c) {
            return '<tr><td class="num">' + esc(c.n) + '</td><td>' + esc(c.from) + ' → ' + esc(c.to) + '</td><td>' + esc(c.fromAnswer == null ? '—' : c.fromAnswer) + ' → ' + esc(c.toAnswer == null ? '—' : c.toAnswer) + '</td></tr>';
          }).join('') + '</tbody></table>';
      } else {
        diffHtml += '<div class="issue-line ok">逐题判分状态与参考答案无变化。</div>';
      }
    }
    return '<div class="gd-hist-mask" id="gdHistMask"><div class="gd-hist-box">' +
      '<h3>批改历史（快照）</h3>' +
      '<p class="help-text">历史成绩读取持久化快照，不依赖当前标准答案；修改标准答案不会改写过去的记录。</p>' +
      '<div class="review-wrap"><table><thead><tr><th>#</th><th>Attempt ID</th><th>批改时间</th><th>答案集</th><th>状态</th><th>正确率</th><th>正确 / 错误</th><th>修订自</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<h3 style="margin-top:14px">差异对比</h3>' + diffHtml +
      '<div class="modal-actions"><button class="btn" id="gdHistClose">关闭</button></div>' +
      '</div></div>';
  }

  var style = document.createElement('style');
  style.textContent = [
    '.gd-hist-mask{position:fixed;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;z-index:11000;padding:18px}',
    '.gd-hist-box{background:#fff;border-radius:12px;padding:18px 20px;width:min(980px,96vw);max-height:88vh;overflow:auto;box-shadow:0 18px 60px rgba(15,23,42,.35)}',
    '.gd-hist-box h3{margin:6px 0 10px;font-size:16px}',
    '.gd-hist-box table{width:100%;border-collapse:collapse;font-size:12px}',
    '.gd-hist-box th,.gd-hist-box td{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}',
    '.gd-hist-box .modal-actions{display:flex;justify-content:flex-end;margin-top:14px}'
  ].join('\n');
  document.head.appendChild(style);

  async function show(sessionId) {
    if (!sessionId) return;
    var records = [];
    try { records = await ExamStore.listGradingRecordsForSession(sessionId); } catch (e) { console.error(e); }
    var old = document.getElementById('gdHistMask');
    if (old) old.remove();
    var html = records.length ? render(records) : '<div class="gd-hist-mask" id="gdHistMask"><div class="gd-hist-box"><h3>批改历史</h3><p class="help-text">该会话在 V3.1 之前没有逐题批改快照；V3.1 之后每次交卷/重新批改都会生成一条记录。</p><div class="modal-actions"><button class="btn" id="gdHistClose">关闭</button></div></div></div>';
    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    var node = wrap.firstElementChild;
    document.body.appendChild(node);
    document.getElementById('gdHistClose').addEventListener('click', function () { node.remove(); });
    node.addEventListener('click', function (e) { if (e.target === node) node.remove(); });
  }

  root.AttemptHistory = { show: show };
})(typeof window !== 'undefined' ? window : globalThis);
