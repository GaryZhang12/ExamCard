/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright 2026 ExamCard contributors */
/* V2 PDF 阅读器：本地 PDF.js 按需渲染单页 + 题目坐标定位 + 缩放/翻页/手工修正定位 */
(function (root) {
  'use strict';

  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

  function PdfViewer(options) {
    this.viewportEl = options.viewportEl;
    this.canvasEl = options.canvasEl;
    this.markerEl = options.markerEl;
    this.onPageChange = options.onPageChange || function () {};
    this.onStatus = options.onStatus || function () {};
    this.doc = null;
    this.page = 1;
    this.pageCount = 0;
    this.zoom = 1;
    this.pageWidth = 0;
    this.pageHeight = 0;
    this.renderSeq = 0;
    this.renderTask = null;
    this.clickHandler = null;
    this._bindClick();
  }

  PdfViewer.prototype._bindClick = function () {
    var self = this;
    this.canvasEl.addEventListener('click', function (ev) {
      if (!self.clickHandler || !self.pageHeight) return;
      var rect = self.canvasEl.getBoundingClientRect();
      var yRatio = clamp((ev.clientY - rect.top) / rect.height, 0, 1);
      var xRatio = clamp((ev.clientX - rect.left) / rect.width, 0, 1);
      self.clickHandler({ page: self.page, yRatio: yRatio, xRatio: xRatio });
    });
  };

  PdfViewer.prototype.setClickHandler = function (fn) {
    this.clickHandler = fn;
    this.canvasEl.style.cursor = fn ? 'crosshair' : 'default';
  };

  PdfViewer.prototype.load = async function (data) {
    this._destroyDoc();
    var task = pdfjsLib.getDocument({ data: data });
    this.doc = await task.promise;
    this.pageCount = this.doc.numPages;
    this.page = 1;
    this.currentYRatio = 0;
    await this.render();
    this.onPageChange(this.page, this.pageCount);
  };

  PdfViewer.prototype._destroyDoc = function () {
    if (this.doc) {
      try { this.doc.destroy(); } catch (e) { /* ignore */ }
      this.doc = null;
    }
  };

  PdfViewer.prototype.fitWidth = function () {
    var w = this.viewportEl.clientWidth - 24;
    return Math.max(240, w);
  };

  PdfViewer.prototype.setZoom = function (z) {
    var y = this.currentYRatio || 0;
    this.zoom = clamp(Math.round(z * 10) / 10, 0.5, 2.5);
    this.render(y);
  };

  PdfViewer.prototype.zoomIn = function () { this.setZoom(this.zoom + 0.1); };
  PdfViewer.prototype.zoomOut = function () { this.setZoom(this.zoom - 0.1); };
  PdfViewer.prototype.fit = function () { this.currentYRatio = this.currentYRatio || 0; this.zoom = 1; this.render(this.currentYRatio); };

  PdfViewer.prototype.getCurrentYRatio = function () {
    if (!this.pageHeight) return 0;
    var top = this.viewportEl.scrollTop + 40;
    return clamp(top / this.pageHeight, 0, 1);
  };

  PdfViewer.prototype.render = async function (anchorYRatio) {
    if (!this.doc) return;
    var seq = ++this.renderSeq;
    if (this.renderTask) {
      try { this.renderTask.cancel(); } catch (e) { /* ignore */ }
      this.renderTask = null;
    }
    var page = await this.doc.getPage(this.page);
    if (seq !== this.renderSeq) return;
    var base = page.getViewport({ scale: 1 });
    this.pageWidth = base.width;
    this.pageHeight = base.height;
    var cssWidth = this.fitWidth() * this.zoom;
    var scale = cssWidth / base.width;
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    var vp = page.getViewport({ scale: scale * dpr });
    this.canvasEl.width = Math.max(1, Math.floor(vp.width));
    this.canvasEl.height = Math.max(1, Math.floor(vp.height));
    this.canvasEl.style.width = Math.floor(cssWidth) + 'px';
    this.canvasEl.style.height = Math.floor(base.height * scale) + 'px';
    var ctx = this.canvasEl.getContext('2d', { alpha: false });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, this.canvasEl.width, this.canvasEl.height);
    var renderTask = page.render({ canvasContext: ctx, viewport: vp });
    this.renderTask = renderTask;
    try {
      await renderTask.promise;
    } catch (e) {
      if (e && e.name === 'RenderingCancelledException') return;
      throw e;
    }
    if (seq !== this.renderSeq) return;
    this.renderTask = null;
    var displayH = this.canvasEl.getBoundingClientRect().height || (base.height * scale);
    var scrollTo = (anchorYRatio == null ? 0 : anchorYRatio) * displayH - 36;
    this.viewportEl.scrollTop = Math.max(0, scrollTo);
    this.currentYRatio = anchorYRatio == null ? 0 : anchorYRatio;
    this._updateMarker();
    this.onStatus('第 ' + this.page + ' / ' + this.pageCount + ' 页');
  };

  PdfViewer.prototype.showPage = async function (n, yRatio) {
    if (!this.doc) return;
    this.page = clamp(Math.round(n), 1, this.pageCount);
    this.currentYRatio = (yRatio == null ? 0 : yRatio);
    await this.render(this.currentYRatio);
    this.onPageChange(this.page, this.pageCount);
  };

  PdfViewer.prototype.showQuestion = async function (q) {
    if (!this.doc || !q) return;
    await this.showPage(q.page, q.yRatio);
    this.flashMarker();
  };

  PdfViewer.prototype._updateMarker = function () {
    if (!this.markerEl) return;
    var h = this.canvasEl.getBoundingClientRect().height;
    if (!h) { this.markerEl.style.display = 'none'; return; }
    this.markerEl.style.display = 'block';
    this.markerEl.style.top = Math.round((this.currentYRatio || 0) * h) + 'px';
  };

  PdfViewer.prototype.flashMarker = function () {
    var self = this;
    this.markerEl.classList.add('flash');
    setTimeout(function () { self.markerEl.classList.remove('flash'); }, 1500);
  };

  PdfViewer.prototype.nextPage = function () { if (this.page < this.pageCount) return this.showPage(this.page + 1, 0); };
  PdfViewer.prototype.prevPage = function () { if (this.page > 1) return this.showPage(this.page - 1, 0); };

  PdfViewer.prototype.destroy = function () { this._destroyDoc(); };

  root.PdfViewer = PdfViewer;
})(typeof window !== 'undefined' ? window : globalThis);
