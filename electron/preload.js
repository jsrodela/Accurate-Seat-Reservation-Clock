const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('env', { version: '0.3.0' });
