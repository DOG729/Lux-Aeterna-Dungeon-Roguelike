'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  invoke:       (url, method, body) => ipcRenderer.invoke('api', url, method, body),
  getWindowInfo: ()                 => ipcRenderer.invoke('window:getInfo'),
  setWindowMode: (mode, w, h)       => ipcRenderer.invoke('window:setMode', mode, w, h),
  quit:          ()                 => ipcRenderer.invoke('app:quit'),
}); 
