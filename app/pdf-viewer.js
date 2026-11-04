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
    this.continuous = options.continuous === true;
    this.continuousEl = null;
    this.continuousBlocks = [];
    this.continuousTasks = new Map();
    this.continuousObserver = null;
    this._continuousRaf = 0;
    this._blockSeq = Object.create(null);
    this._singleWrap = this.canvasEl.parentElement;
    this._onViewportScroll = this._handleViewportScroll.bind(this);
    this._scrollBound = false;
    this._disposed = false;
    this.loadSeq = 0;
    this._bindScroll();
    this._bindClick();
  }

  /* destroy() is a temporary document/UI teardown (app.js 返回试卷库), while
     dispose() is permanent. The scroll listener belongs to the object lifetime,
     not to a single document, so load() must be able to rebind after destroy(). */
  PdfViewer.prototype._bindScroll = function () {
    if (this._disposed || this._scrollBound) return;
    this.viewportEl.addEventListener('scroll', this._onViewportScroll, { passive: true });
    this._scrollBound = true;
  };

  PdfViewer.prototype._unbindScroll = function () {
    if (!this._scrollBound) return;
    this.viewportEl.removeEventListener('scroll', this._onViewportScroll);
    this._scrollBound = false;
  };

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
    // app.js 的 showLibrary() 会对同一个 viewer 调用 destroy()，随后继续使用
    // 同一个对象 load()。监听必须在这里幂等重绑，否则回库/重新开始后真实滚轮
    // 不再更新当前页（Work WORK_CONTINUOUS_WHEEL_GEOMETRY.json）。
    this._bindScroll();
    var seq = ++this.loadSeq;
    this._destroyDoc();
    this._clearContinuous();
    this.viewportEl.scrollTop = 0;
    var task = pdfjsLib.getDocument({ data: data });
    var doc = await task.promise;
    if (seq !== this.loadSeq || this._disposed) {
      try { doc.destroy(); } catch (e) { /* ignore */ }
      return;
    }
    this.doc = doc;
    this.pageCount = doc.numPages;
    this.page = 1;
    this.currentYRatio = 0;
    if (this.continuous) await this._buildContinuous();
    else await this.render();
    if (seq !== this.loadSeq) return;
    this.onPageChange(this.page, this.pageCount);
  };

  PdfViewer.prototype._destroyDoc = function () {
    this.renderSeq++;
    if (this.renderTask) {
      try { this.renderTask.cancel(); } catch (e) { /* ignore */ }
      this.renderTask = null;
    }
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
    var y = this.getCurrentYRatio();
    var page = this.page;
    this.zoom = clamp(Math.round(z * 10) / 10, 0.5, 2.5);
    if (this.continuous) return this._rebuildContinuous(page, y);
    this.render(y);
  };

  PdfViewer.prototype.refresh = function () {
    var y = this.getCurrentYRatio();
    if (this.continuous) return this._rebuildContinuous(this.page, y);
    return this.render(y);
  };
  PdfViewer.prototype.zoomIn = function () { this.setZoom(this.zoom + 0.1); };
  PdfViewer.prototype.zoomOut = function () { this.setZoom(this.zoom - 0.1); };
  PdfViewer.prototype.fit = function () {
    this.currentYRatio = this.currentYRatio || 0;
    this.zoom = 1;
    if (this.continuous) return this._rebuildContinuous(this.page, this.currentYRatio);
    this.render(this.currentYRatio);
  };

  PdfViewer.prototype.getCurrentYRatio = function () {
    if (this.continuous) {
      var block = this._visibleBlock();
      if (!block) return 0;
      return clamp((this.viewportEl.scrollTop - this._blockTop(block)) / Math.max(1, block.offsetHeight), 0, 1);
    }
    if (!this.pageHeight) return 0;
    var top = this.viewportEl.scrollTop + 40;
    return clamp(top / this.pageHeight, 0, 1);
  };

  PdfViewer.prototype.render = async function (anchorYRatio) {
    var doc = this.doc;
    if (!doc) return;
    var seq = ++this.renderSeq;
    if (this.renderTask) {
      try { this.renderTask.cancel(); } catch (e) { /* ignore */ }
      this.renderTask = null;
    }
    var page = await doc.getPage(this.page);
    if (seq !== this.renderSeq || doc !== this.doc) return;
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
    if (seq !== this.renderSeq || doc !== this.doc) return;
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
    if (this.continuous) {
      await this._showContinuousPage(this.page, this.currentYRatio);
      this.onPageChange(this.page, this.pageCount);
      return;
    }
    await this.render(this.currentYRatio);
    this.onPageChange(this.page, this.pageCount);
  };

  PdfViewer.prototype.showQuestion = async function (q) {
    if (!this.doc || !q) return;
    await this.showPage(q.page, q.yRatio);
    if (this.continuous) this._flashContinuous(q.page, q.yRatio);
    else this.flashMarker();
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

  PdfViewer.prototype.destroy = function () {
    this._unbindScroll();
    this._clearContinuous();
    this._destroyDoc();
  };

  PdfViewer.prototype.dispose = function () {
    this._disposed = true;
    this._unbindScroll();
    this._clearContinuous();
    this._destroyDoc();
  };

  PdfViewer.prototype.setContinuous = async function (enabled) {
    enabled = !!enabled;
    if (enabled === this.continuous) return this.continuous;
    var page = this.page || 1;
    var y = this.continuous ? this.getCurrentYRatio() : (this.currentYRatio || 0);
    this.continuous = enabled;
    if (!this.doc) return this.continuous;
    if (enabled) {
      await this._buildContinuous();
      await this._showContinuousPage(page, y);
    } else {
      this._clearContinuous();
      await this.showPage(page, y);
    }
    return this.continuous;
  };

  PdfViewer.prototype._clearContinuous = function () {
    if (this._continuousRaf) { cancelAnimationFrame(this._continuousRaf); this._continuousRaf = 0; }
    if (this.continuousObserver) { try { this.continuousObserver.disconnect(); } catch (e) {} this.continuousObserver = null; }
    this.continuousTasks.forEach(function (t) { try { t.cancel(); } catch (e) {} });
    this.continuousTasks.clear();
    this._blockSeq = Object.create(null);
    if (this.continuousEl && this.continuousEl.parentNode) this.continuousEl.parentNode.removeChild(this.continuousEl);
    this.continuousEl = null;
    this.continuousBlocks = [];
    if (this._singleWrap) this._singleWrap.style.display = '';
    this.markerEl.style.display = 'none';
  };

  PdfViewer.prototype._fitCssWidth = function () { return Math.max(240, this.fitWidth() * this.zoom); };

  PdfViewer.prototype._buildContinuous = async function () {
    var doc = this.doc;
    if (!doc) return;
    var loadSeq = this.loadSeq;
    this._clearContinuous();
    if (this._singleWrap) this._singleWrap.style.display = 'none';
    var first = await doc.getPage(1);
    if (doc !== this.doc || loadSeq !== this.loadSeq) return;
    var base = first.getViewport({ scale: 1 });
    var cssWidth = this._fitCssWidth();
    var estHeight = Math.max(240, Math.round(base.height * cssWidth / base.width));
    var wrap = document.createElement('div');
    wrap.id = 'pdfContinuous';
    wrap.className = 'pdf-continuous';
    wrap.style.width = Math.floor(cssWidth) + 'px';
    var self = this;
    for (var n = 1; n <= this.pageCount; n++) {
      var block = document.createElement('div');
      block.className = 'pdf-page-block';
      block.setAttribute('data-page', String(n));
      block.style.width = Math.floor(cssWidth) + 'px';
      block.style.height = estHeight + 'px';
      block.addEventListener('click', function (ev) {
        if (!self.clickHandler) return;
        var r = this.getBoundingClientRect();
        self.clickHandler({
          page: Number(this.getAttribute('data-page')),
          yRatio: clamp((ev.clientY - r.top) / Math.max(1, r.height), 0, 1),
          xRatio: clamp((ev.clientX - r.left) / Math.max(1, r.width), 0, 1)
        });
      });
      wrap.appendChild(block);
      this.continuousBlocks.push(block);
    }
    this.viewportEl.appendChild(wrap);
    this.continuousEl = wrap;
    await this._renderContinuousBlock(1);
    if (doc !== this.doc || loadSeq !== this.loadSeq) return;
    this.onStatus('连续滚动 · 第 1 / ' + this.pageCount + ' 页（按需渲染）');
  };

  PdfViewer.prototype._blockTop = function (block) {
    var vr = this.viewportEl.getBoundingClientRect();
    var br = block.getBoundingClientRect();
    return br.top - vr.top + this.viewportEl.scrollTop;
  };

  PdfViewer.prototype._visibleBlock = function () {
    if (!this.continuousBlocks.length) return null;
    var y = this.viewportEl.scrollTop + 8;
    var best = null;
    for (var i = 0; i < this.continuousBlocks.length; i++) {
      var b = this.continuousBlocks[i];
      // offsetTop 的参照是 position:relative 的 #pdfContinuous，而不是滚动
      // 容器；用实际几何换算，避免 padding/包裹层造成差一页的判定。
      var top = this._blockTop(b);
      if (top <= y && top + b.offsetHeight > y) return b;
      if (top > y && !best) best = b;
    }
    return best || this.continuousBlocks[0];
  };

  PdfViewer.prototype._showContinuousPage = async function (page, yRatio) {
    if (!this.continuousBlocks.length) return;
    var doc = this.doc;
    page = clamp(Math.round(page), 1, this.pageCount);
    var block = this.continuousBlocks[page - 1];
    this.page = page;
    this.currentYRatio = yRatio == null ? 0 : yRatio;
    await this._renderContinuousBlock(page);
    if (doc !== this.doc || !this.continuousBlocks[page - 1]) return;
    var top = this._blockTop(block) + (this.currentYRatio || 0) * block.offsetHeight - 20;
    this.viewportEl.scrollTop = Math.max(0, top);
    this.onStatus('连续滚动 · 第 ' + page + ' / ' + this.pageCount + ' 页');
  };

  PdfViewer.prototype._renderContinuousBlock = async function (n) {
    var doc = this.doc;
    if (!doc || !this.continuousBlocks.length) return;
    n = clamp(Math.round(n), 1, this.pageCount);
    var block = this.continuousBlocks[n - 1];
    if (!block) return;
    if (block.dataset.rendered === '1' && block.dataset.width === String(Math.floor(this._fitCssWidth()))) return;
    var seq = (this._blockSeq[n] || 0) + 1;
    this._blockSeq[n] = seq;
    var old = this.continuousTasks.get(n);
    if (old) { try { old.cancel(); } catch (e) {} this.continuousTasks.delete(n); }
    var page = await doc.getPage(n);
    if (this._blockSeq[n] !== seq || doc !== this.doc) return;
    var base = page.getViewport({ scale: 1 });
    var cssWidth = this._fitCssWidth();
    var scale = cssWidth / base.width;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var vp = page.getViewport({ scale: scale * dpr });
    var canvas = block.querySelector('canvas.pdf-page-canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'pdf-page-canvas';
      block.appendChild(canvas);
    }
    canvas.width = Math.max(1, Math.floor(vp.width));
    canvas.height = Math.max(1, Math.floor(vp.height));
    canvas.style.width = Math.floor(cssWidth) + 'px';
    canvas.style.height = Math.floor(base.height * scale) + 'px';
    block.style.width = Math.floor(cssWidth) + 'px';
    block.style.height = Math.floor(base.height * scale) + 'px';
    block.dataset.width = String(Math.floor(cssWidth));
    var ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    var task = page.render({ canvasContext: ctx, viewport: vp });
    this.continuousTasks.set(n, task);
    try { await task.promise; } catch (e) {
      if (e && e.name === 'RenderingCancelledException') return;
      throw e;
    }
    if (this._blockSeq[n] !== seq || doc !== this.doc) return;
    this.continuousTasks.delete(n);
    block.dataset.rendered = '1';
    this._evictFar(n);
    if (this.page === n) this.onStatus('连续滚动 · 第 ' + n + ' / ' + this.pageCount + ' 页');
  };

  PdfViewer.prototype._renderAround = function (n) {
    var self = this;
    [n - 1, n, n + 1].forEach(function (p) {
      if (p >= 1 && p <= self.pageCount) self._renderContinuousBlock(p).catch(function () {});
    });
  };

  PdfViewer.prototype._evictFar = function (current) {
    var self = this;
    this.continuousBlocks.forEach(function (block, i) {
      var n = i + 1;
      if (Math.abs(n - current) <= 3) return;
      var canvas = block.querySelector('canvas.pdf-page-canvas');
      if (canvas) { canvas.width = 0; canvas.height = 0; canvas.remove(); }
      block.dataset.rendered = '';
      delete self._blockSeq[n];
    });
  };

  PdfViewer.prototype._handleViewportScroll = function () {
    if (!this.continuous || !this.continuousBlocks.length) return;
    var self = this;
    if (this._continuousRaf) return;
    this._continuousRaf = requestAnimationFrame(function () {
      self._continuousRaf = 0;
      if (!self.continuous || !self.continuousBlocks.length) return;
      var block = self._visibleBlock();
      if (!block) return;
      var n = Number(block.getAttribute('data-page'));
      self.currentYRatio = clamp((self.viewportEl.scrollTop - self._blockTop(block)) / Math.max(1, block.offsetHeight), 0, 1);
      if (n !== self.page) {
        self.page = n;
        self.onPageChange(n, self.pageCount);
      }
      self._renderAround(n);
    });
  };

  PdfViewer.prototype._flashContinuous = function (page, yRatio) {
    var block = this.continuousBlocks[page - 1];
    if (!block) return;
    var mark = document.createElement('div');
    mark.className = 'pdf-marker flash';
    mark.style.top = Math.round((yRatio || 0) * block.offsetHeight) + 'px';
    block.appendChild(mark);
    setTimeout(function () { try { mark.remove(); } catch (e) {} }, 1800);
  };

  PdfViewer.prototype._rebuildContinuous = async function (page, yRatio) {
    if (!this.continuous || !this.doc) return;
    this._clearContinuous();
    await this._buildContinuous();
    await this._showContinuousPage(page || 1, yRatio || 0);
  };

  root.PdfViewer = PdfViewer;
})(typeof window !== 'undefined' ? window : globalThis);
