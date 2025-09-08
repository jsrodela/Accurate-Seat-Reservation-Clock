import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('api', {
  getState: ()=> ipcRenderer.invoke('get-state'),
  setConfig: (cfg)=> ipcRenderer.send('set-config', cfg),
  onTick: (cb)=> ipcRenderer.on('tick', cb)
});
