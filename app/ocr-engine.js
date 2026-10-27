/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright 2026 ExamCard contributors */
/* ExamCard V5.0-rc2 · 本地离线 OCR（Tesseract.js，资源随应用分发） */
(function (root) {
  'use strict';
  var workerPromise = null;
  var worker = null;
  var busy = false;
  function assetUrl(name) {
    var base = new URL('ocr/', window.location.href);
    return new URL(name, base).href.replace(/\/$/, '');
  }
  function createWorker(onProgress) {
    if (workerPromise) return workerPromise;
    if (typeof Tesseract === 'undefined') return Promise.reject(new Error('OCR 引擎脚本未加载'));
    var base = new URL('ocr/', window.location.href).href;
    workerPromise = Tesseract.createWorker(['chi_sim', 'eng'], 1, {
      workerPath: base + 'worker.min.js',
      corePath: base,
      langPath: base,
      cacheMethod: 'write',
      logger: function (m) { if (onProgress) onProgress(m); }
    }).then(async function (w) {
      worker = w;
      try { await w.setParameters({ preserve_interword_spaces: '1', tessedit_pageseg_mode: '11', user_defined_dpi: '300' }); } catch (e) { console.warn('OCR params', e); }
      return w;
    }).catch(function (e) { workerPromise = null; throw e; });
    return workerPromise;
  }
  async function recognizeCanvas(canvas, onProgress) {
    if (busy) throw new Error('OCR 正忙，请稍后重试');
    busy = true;
    try {
      var w = await createWorker(onProgress);
      var r = await w.recognize(canvas, { preserve_interword_spaces: '1', tessedit_pageseg_mode: '11' }, { text: true, blocks: true });
      return { text: r.data.text || '', words: r.data.words || [], blocks: r.data.blocks || [], confidence: r.data.confidence, source: 'ocr', engine: 'tesseract.js' };
    } finally { busy = false; }
  }
  async function renderPdfPage(pdfDoc, pageNo, scale) {
    var page = await pdfDoc.getPage(pageNo);
    var viewport = page.getViewport({ scale: scale || 2 });
    var canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    await page.render({ canvasContext: ctx, viewport: viewport }).promise;
    if (page.cleanup) { try { page.cleanup(); } catch (e) { /* ignore */ } }
    return canvas;
  }
  async function recognizePdfPage(pdfDoc, pageNo, opts) {
    opts = opts || {};
    var canvas = await renderPdfPage(pdfDoc, pageNo, opts.scale || 2);
    try {
      var r = await recognizeCanvas(canvas, opts.onProgress);
      r.page = pageNo;
      return r;
    } finally {
      canvas.width = 1; canvas.height = 1;
    }
  }
  async function terminate() {
    if (worker) { try { await worker.terminate(); } catch (e) { /* ignore */ } }
    worker = null; workerPromise = null; busy = false;
  }
  function isAvailable() { return typeof Tesseract !== 'undefined' && typeof pdfjsLib !== 'undefined'; }
  root.OcrEngine = { recognizeCanvas: recognizeCanvas, recognizePdfPage: recognizePdfPage, renderPdfPage: renderPdfPage, terminate: terminate, cancel: terminate, isAvailable: isAvailable };
})(typeof window !== 'undefined' ? window : globalThis);
