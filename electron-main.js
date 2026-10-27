/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright 2026 ExamCard contributors */
'use strict';

/*
 * 广东省考智能答题卡 V3 · Electron 主进程
 * 最小封装：沿用 V2 的静态 HTML/CSS/JS（app/ 目录），不重写业务代码。
 * 桌面增强：
 *  - 原生窗口 + Windows 图标 + 单实例
 *  - 导出文件弹出“另存为”对话框（用户可选择保存位置）
 *  - 拖入 PDF 由 renderer 注入脚本转交给现有导入入口
 *  - 数据保存在 Electron userData（IndexedDB），退出/重开保留
 */

const { app, BrowserWindow, Menu, dialog, session, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_TITLE = 'ExamCard';
const APP_DIR = path.join(__dirname, 'app');
const ICON = path.join(__dirname, 'icon.ico');

app.setName('gd-exam-card-v3');
if (process.env.GD_USER_DATA_DIR) {
  try {
    fs.mkdirSync(process.env.GD_USER_DATA_DIR, { recursive: true });
    app.setPath('userData', path.resolve(process.env.GD_USER_DATA_DIR));
  } catch (e) {
    console.warn('GD_USER_DATA_DIR 设置失败：', e.message);
  }
}
if (process.platform === 'win32') app.setAppUserModelId('com.gary.gdexam.v3');

/* 测试/排障用：仅当显式传入才开远端调试端口，正常启动不开启 */
function getArgValue(prefix) {
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : '';
}

function startupLog(event, detail) {
  try {
    var dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    var line = new Date().toISOString() + '\t' + event + '\tv' + app.getVersion() + '\t' + (detail ? String(detail).replace(/[\r\n]+/g, ' ') : '') + '\n';
    fs.appendFileSync(path.join(dir, 'startup.log'), line, 'utf8');
    try { var st = fs.statSync(path.join(dir, 'startup.log')); if (st.size > 256 * 1024) fs.writeFileSync(path.join(dir, 'startup.log'), line, 'utf8'); } catch (e) {}
  } catch (e) { console.warn('startup log failed', e.message); }
}

const cdpPort = getArgValue('--gd-cdp-port=') || process.env.GD_CDP_PORT || '';
if (cdpPort) app.commandLine.appendSwitch('remote-debugging-port', String(cdpPort));
process.on('uncaughtException', function (err) { startupLog('uncaughtException', err && (err.stack || err.message) || err); console.error(err); });
process.on('unhandledRejection', function (err) { startupLog('unhandledRejection', err && (err.stack || err.message) || err); });

let mainWindow = null;

function uniquePath(dir, fileName) {
  const ext = path.extname(fileName);
  const base = fileName.slice(0, fileName.length - ext.length);
  let p = path.join(dir, fileName);
  let i = 2;
  while (fs.existsSync(p)) {
    p = path.join(dir, `${base}-${i}${ext}`);
    i += 1;
  }
  return p;
}

function filtersFor(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.csv') return [{ name: 'CSV 表格', extensions: ['csv'] }];
  if (ext === '.json') return [{ name: 'JSON 文件', extensions: ['json'] }];
  if (ext === '.zip') return [{ name: 'ZIP 压缩包', extensions: ['zip'] }];
  return [{ name: '所有文件', extensions: ['*'] }];
}

/* 渲染进程导出文件走 IPC + fs + 原生另存为对话框，避免 Chromium blob 下载在部分环境被中断 */
function setupSaveIpc() {
  ipcMain.handle('gd:save-file', async (event, defaultName, data) => {
    try {
      const buf = Buffer.from(data);
      let savePath = '';
      const autoDir = process.env.GD_AUTO_SAVE_DIR;
      if (autoDir) {
        fs.mkdirSync(autoDir, { recursive: true });
        savePath = uniquePath(path.resolve(autoDir), defaultName);
      } else {
        const result = dialog.showSaveDialogSync(mainWindow, {
          title: '保存导出文件',
          buttonLabel: '保存',
          defaultPath: path.join(app.getPath('downloads'), defaultName),
          filters: filtersFor(defaultName)
        });
        if (!result) return { canceled: true };
        savePath = result;
      }
      fs.writeFileSync(savePath, buf);
      return { canceled: false, path: savePath, bytes: buf.length };
    } catch (err) {
      console.error('保存文件失败：', err);
      return { canceled: true, error: err.message };
    }
  });
  ipcMain.handle('gd:get-info', () => ({
    name: APP_TITLE,
    version: app.getVersion(),
    userData: app.getPath('userData')
  }));
}

function setupDownloads(win) {
  session.defaultSession.on('will-download', (event, item) => {
    try {
      console.log('[download] will-download:', item.getFilename(), 'url=', item.getURL());
      let savePath = '';
      const autoDir = process.env.GD_AUTO_SAVE_DIR;
      if (autoDir) {
        fs.mkdirSync(autoDir, { recursive: true });
        savePath = uniquePath(path.resolve(autoDir), item.getFilename());
      } else {
        const result = dialog.showSaveDialogSync(win, {
          title: '保存导出文件',
          buttonLabel: '保存',
          defaultPath: path.join(app.getPath('downloads'), item.getFilename()),
          filters: filtersFor(item.getFilename())
        });
        if (!result) {
          item.cancel();
          return;
        }
        savePath = result;
      }
      item.setSavePath(savePath);
      console.log('[download] save path:', savePath);
      item.once('done', (doneEvent, state) => {
        console.log('[download] done:', state, savePath);
      });
    } catch (err) {
      console.error('下载保存对话框失败：', err);
      try { item.cancel(); } catch (e) { /* ignore */ }
    }
  });
}

async function injectDesktopEnhancements(win) {
  try {
    const code = fs.readFileSync(path.join(__dirname, 'desktop-enhance.js'), 'utf8');
    await win.webContents.executeJavaScript(code, true);
  } catch (err) {
    console.error('注入桌面增强脚本失败：', err);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: APP_TITLE,
    width: 1500,
    height: 950,
    minWidth: 960,
    minHeight: 720,
    center: true,
    show: false,
    icon: ICON,
    backgroundColor: '#eef1f6',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
      devTools: true
    }
  });

  Menu.setApplicationMenu(null);
  mainWindow.setMenuBarVisibility(false);
  setupDownloads(mainWindow);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });

  mainWindow.webContents.on('did-finish-load', () => {
    injectDesktopEnhancements(mainWindow);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('did-fail-load', function (event, code, desc, url) { startupLog('did-fail-load', code + ' ' + desc + ' ' + url); });
  mainWindow.webContents.on('render-process-gone', function (event, details) { startupLog('render-process-gone', JSON.stringify(details)); });
  mainWindow.loadFile(path.join(APP_DIR, 'index.html')).catch((err) => {
    startupLog('loadFile-failed', err && (err.stack || err.message) || err);
    dialog.showErrorBox('启动失败', `无法加载应用页面：\n${err.message}\n\n请确认 app 目录完整。`);
    app.quit();
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  startupLog('second-instance-lock', 'another instance is running');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    startupLog('ready', 'pid=' + process.pid);
    /* 完全离线：阻止应用内 http(s) 请求（本应用只使用 file:// / blob: 资源） */
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*'] },
      (details, callback) => callback({ cancel: true })
    );
    setupSaveIpc();
    createWindow();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
  app.on('child-process-gone', function (event, details) { startupLog('child-process-gone', JSON.stringify(details)); });
}
