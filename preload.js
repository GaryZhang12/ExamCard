/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright 2026 ExamCard contributors */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// 仅暴露最小桌面能力：保存导出文件（主进程弹“另存为”对话框并写盘）
contextBridge.exposeInMainWorld('gdDesktop', {
  saveFile: (defaultName, bytes) => ipcRenderer.invoke('gd:save-file', String(defaultName || 'export.bin'), bytes),
  getInfo: () => ipcRenderer.invoke('gd:get-info')
});
