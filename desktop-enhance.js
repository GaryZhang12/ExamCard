/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright 2026 ExamCard contributors */
/* 广东省考智能答题卡 V3 · Electron 桌面增强（由主进程在页面加载后注入，不修改 V2 源码） */
(function () {
  'use strict';
  if (window.__GD_DESKTOP_ENHANCED__) return;
  window.__GD_DESKTOP_ENHANCED__ = true;

  var hint = null;
  var toastEl = null;
  var toastTimer = null;

  function ensureHint() {
    if (hint) return hint;
    hint = document.createElement('div');
    hint.id = 'gd-drop-hint';
    hint.textContent = '松开鼠标，导入 PDF 试卷';
    hint.style.cssText = [
      'position:fixed', 'left:50%', 'top:24px', 'transform:translateX(-50%)',
      'z-index:99999', 'padding:12px 22px', 'border-radius:12px',
      'background:rgba(29,78,216,.94)', 'color:#fff', 'font-size:14px',
      'font-weight:700', 'box-shadow:0 10px 30px rgba(0,0,0,.25)',
      'pointer-events:none', 'opacity:0', 'transition:opacity .15s',
      'font-family:"Microsoft YaHei",sans-serif'
    ].join(';');
    document.body.appendChild(hint);
    return hint;
  }

  function showHint(show) {
    var el = ensureHint();
    el.style.opacity = show ? '1' : '0';
  }

  function flash(msg) {
    if (!document.body) return;
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.style.cssText = [
        'position:fixed', 'left:50%', 'bottom:26px', 'transform:translateX(-50%)',
        'z-index:99999', 'padding:10px 20px', 'border-radius:99px',
        'background:rgba(23,32,51,.94)', 'color:#fff', 'font-size:13px',
        'box-shadow:0 6px 20px rgba(0,0,0,.25)', 'pointer-events:none',
        'font-family:"Microsoft YaHei",sans-serif', 'transition:opacity .2s'
      ].join(';');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.style.opacity = '0'; }, 2600);
  }

  function pickPdf(files) {
    if (!files) return null;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (f && (/\.pdf$/i.test(f.name || '') || f.type === 'application/pdf')) return f;
    }
    return null;
  }

  /* 导出文件：拦截 V2 的 <a download> blob 下载，转由主进程弹原生“另存为”并写盘（避免 Chromium 下载被中断/不可选路径） */
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[download]') : null;
    if (!a || !a.href) return;
    if (!window.gdDesktop || typeof window.gdDesktop.saveFile !== 'function') return;
    e.preventDefault();
    e.stopPropagation();
    var defaultName = a.getAttribute('download') || 'export.bin';
    var href = a.href;
    fetch(href).then(function (res) { return res.arrayBuffer(); }).then(function (buf) {
      return window.gdDesktop.saveFile(defaultName, new Uint8Array(buf));
    }).then(function (out) {
      if (!out) return;
      if (out.canceled) {
        flash('已取消保存');
      } else if (out.error) {
        flash('保存失败：' + out.error);
      } else {
        flash('已保存：' + out.path);
      }
    }).catch(function (err) {
      flash('保存失败：' + (err && err.message ? err.message : err));
    });
  }, true);

  window.addEventListener('dragenter', function (e) {
    if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) {
      e.preventDefault();
      showHint(true);
    }
  }, true);

  window.addEventListener('dragover', function (e) {
    if (e.dataTransfer) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, true);

  window.addEventListener('dragleave', function (e) {
    if (!e.relatedTarget) showHint(false);
  }, true);

  window.addEventListener('drop', function (e) {
    e.preventDefault();
    showHint(false);
    var pdf = pickPdf(e.dataTransfer && e.dataTransfer.files);
    if (!pdf) {
      flash('仅支持拖入 PDF 试卷文件');
      return;
    }
    var library = document.getElementById('libraryView');
    if (library && library.classList.contains('hidden')) {
      flash('请先点击「试卷库」再拖入 PDF');
      return;
    }
    var input = document.getElementById('importPdfInput');
    if (!input) {
      flash('导入入口尚未就绪，请稍后重试');
      return;
    }
    try {
      var dt = new DataTransfer();
      dt.items.add(pdf);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      flash('已接收 PDF，正在识别…');
    } catch (err) {
      flash('读取拖入文件失败：' + (err && err.message ? err.message : err));
    }
  }, true);
})();
