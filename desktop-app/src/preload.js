const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('relayApi', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveNickname: (nickname) => ipcRenderer.invoke('save-nickname', nickname),
  onStatus: (callback) => {
    ipcRenderer.on('status-update', (_event, status) => callback(status));
  },
});
