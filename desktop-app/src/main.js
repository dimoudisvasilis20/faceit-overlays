const { app, Tray, Menu, BrowserWindow, ipcMain, nativeImage } = require('electron');
const path = require('node:path');
const { getConfig, setNickname } = require('./store');
const { tick, resetPlayerIdCache } = require('./relay');

const TICK_INTERVAL_MS = 10_000;

let tray = null;
let settingsWindow = null;
let lastStatus = 'Waiting for nickname...';
let timer = null;

function openSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 480,
    height: 420,
    resizable: false,
    title: 'FACEIT Overlay Relay',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
  settingsWindow.webContents.on('did-finish-load', () => {
    settingsWindow?.webContents.send('status-update', lastStatus);
  });
}

function updateStatus(status) {
  lastStatus = status;
  tray?.setToolTip(`FACEIT Overlay Relay - ${status}`);
  settingsWindow?.webContents.send('status-update', status);
}

async function runTick() {
  const config = getConfig();
  if (!config.nickname) {
    updateStatus('Waiting for nickname...');
    return;
  }
  try {
    const status = await tick(config);
    updateStatus(status);
  } catch (err) {
    updateStatus(`Error: ${err.message}`);
  }
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: lastStatus, enabled: false },
    { type: 'separator' },
    { label: 'Settings...', click: openSettingsWindow },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
}

function refreshTrayMenu() {
  tray?.setContextMenu(buildTrayMenu());
}

app.whenReady().then(() => {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.png'));
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('FACEIT Overlay Relay');
  tray.on('click', openSettingsWindow);
  refreshTrayMenu();

  const config = getConfig();
  if (!config.nickname) {
    openSettingsWindow();
  }

  runTick();
  timer = setInterval(runTick, TICK_INTERVAL_MS);

  // Windows only needs a tray icon; keep the app alive without a dock/taskbar window.
  app.on('window-all-closed', () => {
    // Do nothing - stay running in the tray.
  });
});

ipcMain.handle('get-config', () => getConfig());

ipcMain.handle('save-nickname', (_event, nickname) => {
  resetPlayerIdCache();
  const config = setNickname(nickname);
  runTick();
  refreshTrayMenu();
  return config;
});

app.on('before-quit', () => {
  if (timer) clearInterval(timer);
});
