const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('env', {
  version: '0.2.0'
});
