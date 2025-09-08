const { app, BrowserWindow } = require('electron');
const path = require('path');

function create() {
  const win = new BrowserWindow({
    width: 560,
    height: 700,
    resizable: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true
    }
  });
  win.loadFile(path.join(__dirname, 'renderer.html'));
}

app.whenReady().then(() => {
  create();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) create();
  });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
