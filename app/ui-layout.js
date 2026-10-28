/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright 2026 ExamCard contributors */
/* Shared dialog keyboard/focus constraints; native HTML, no UI framework. */
(function () {
  'use strict';
  var selector = '.modal, .learn-modal, .essay-modal, .diag-modal, .bank-modal';
  var tracked = new Map();
  function visible(el) { return el && el.isConnected && el.getClientRects().length; }
  function controls(dialog) { return Array.from(dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')).filter(visible); }
  function sync() {
    tracked.forEach(function (opener, dialog) {
      if (!visible(dialog)) {
        tracked.delete(dialog);
        if (visible(opener)) opener.focus();
      }
    });
    document.querySelectorAll(selector).forEach(function (dialog) {
      if (!visible(dialog) || tracked.has(dialog)) return;
      tracked.set(dialog, document.activeElement);
      dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
      var h = dialog.querySelector('h3,h2');
      if (h) { if (!h.id) h.id = 'dialog-title-' + Math.random().toString(36).slice(2); dialog.setAttribute('aria-labelledby', h.id); }
      dialog.tabIndex = -1;
      var initial = controls(dialog).find(function (el) { return !el.matches('.danger'); });
      (initial || dialog).focus();
    });
  }
  document.addEventListener('keydown', function (event) {
    var dialogs = Array.from(document.querySelectorAll(selector)).filter(visible);
    if (!dialogs.length) return;
    var dialog = dialogs[dialogs.length - 1];
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation();
      if (dialog.querySelector('[data-busy], [aria-busy="true"]')) return;
      var root = dialog.closest('#modalRoot,#learnModalRoot,#essayModalRoot,#diagModalRoot,#bankModalRoot');
      if (root) root.innerHTML = '';
      sync();
    } else if (event.key === 'Tab') {
      var items = controls(dialog), first = items[0], last = items[items.length - 1];
      if (!items.length) { event.preventDefault(); dialog.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }
  }, true);
  function init() { new MutationObserver(sync).observe(document.body, { childList: true, subtree: true }); sync(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
