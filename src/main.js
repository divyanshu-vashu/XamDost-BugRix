const { app, BrowserWindow, globalShortcut, ipcMain, dialog } = require('electron');
const path = require('path');
const Store = require('electron-store');
const geminiService = require('./services/gemini');

// Initialize @electron/remote
require('@electron/remote/main').initialize();

// Initialize store
const store = new Store({
  defaults: {
    windowBounds: { width: 400, height: 300, x: 0, y: 0 },
    notes: '',
    isAlwaysOnTop: true,
    opacity: 0.9
  }
});

let mainWindow;

function createWindow() {
  const { width, height, x, y } = store.get('windowBounds');
  
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: width,
    height: height,
    x: x,
    y: y,
    frame: true,
    titleBarStyle: 'hiddenInset', // For macOS traffic lights
    backgroundColor: '#00000000', // Transparent background
    transparent: true,
    hasShadow: false,
    alwaysOnTop: store.get('isAlwaysOnTop'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
      webSecurity: false,          // From the first object
      enableRemoteModule: true,    // From the second object
      nodeIntegrationInWorker: true // From the second object
    },
    skipTaskbar: true
  });

  // Enable @electron/remote for this window
  require('@electron/remote/main').enable(mainWindow.webContents);

  // Load the index.html file
  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

  // Enable content protection to hide from screen capture
  mainWindow.setContentProtection(true); // Temporarily disabled for debugging
  console.log('Content protection DISABLED for debugging.'); 

  // Open the DevTools
  // mainWindow.webContents.openDevTools({ mode: 'detach' });

  // Set up window event listeners
  mainWindow
    // Window state events
    .on('maximize', () => mainWindow.webContents.send('window-maximized'))
    .on('unmaximize', () => mainWindow.webContents.send('window-unmaximized'))
    
    // Save window bounds
    .on('resize', saveWindowBounds)
    .on('move', saveWindowBounds)
    .on('moved', saveWindowBounds)
    .on('resized', saveWindowBounds)
    
    // Window close behavior
    .on('close', (e) => {
      if (!isQuitting) {
        e.preventDefault();
        mainWindow.hide();
        return false;
      }
      return true;
    })
    
    // Content protection
    .on('show', () => mainWindow.setContentProtection(true))
    .on('focus', () => {
      console.log('Main: Window focused');
      // mainWindow.setContentProtection(true); // Temporarily disabled
      mainWindow.webContents.send('window-focused');
    });

  // Register global shortcut (Cmd+/ or Ctrl+/)
  const ret = globalShortcut.register('CommandOrControl+/', () => {
    console.log('Global shortcut triggered');
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  if (!ret) {
    console.log('Global shortcut registration failed');
  }

  // Push initial state to renderer once it's loaded
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('Main: Renderer finished loading. Pushing initial state.');
    mainWindow.webContents.send('load-notes', store.get('notes'));
    mainWindow.webContents.send('update-opacity', store.get('opacity'));
    mainWindow.webContents.send('update-always-on-top-status', store.get('isAlwaysOnTop'));
  });
}

function saveWindowBounds() {
  if (mainWindow) {
    const bounds = mainWindow.getBounds();
    store.set('windowBounds', bounds);
  }
}

// This method will be called when Electron has finished initialization
app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// Save notes when received from renderer
ipcMain.on('save-notes', (event, notes) => {
  store.set('notes', notes);
});

// Update window opacity
ipcMain.on('update-opacity', (event, opacity) => {
  if (mainWindow) {
    mainWindow.setOpacity(opacity);
    store.set('opacity', opacity);
  }
});

// Toggle always on top
ipcMain.on('toggle-always-on-top', async (event) => {
  const isAlwaysOnTop = !store.get('isAlwaysOnTop');
  store.set('isAlwaysOnTop', isAlwaysOnTop);
  mainWindow.setAlwaysOnTop(isAlwaysOnTop, 'floating');
  console.log('Main: Toggled always on top to:', isAlwaysOnTop);
  mainWindow.webContents.send('update-always-on-top-status', isAlwaysOnTop);
});

// Get current opacity
ipcMain.handle('get-opacity', () => {
  return store.get('opacity', 0.9);
});

// Get always on top status
ipcMain.handle('get-always-on-top', () => {
  return store.get('isAlwaysOnTop', true);
});

// Window movement handling
ipcMain.on('window-move', (event, { x, y }) => {
  if (mainWindow && !mainWindow.isMaximized()) {
    mainWindow.setPosition(x, y);
  }
});



ipcMain.on('window-resize', (event, { width, height }) => {
  if (mainWindow) {
    const [currentWidth, currentHeight] = mainWindow.getSize();
    if (Math.abs(currentWidth - width) > 10 || Math.abs(currentHeight - height) > 10) {
      mainWindow.setSize(Math.round(width), Math.round(height));
    }
  }
});

// Gemini AI related IPC handlers
ipcMain.handle('set-api-key', (event, apiKey) => {
  try {
    return geminiService.setApiKey(apiKey);
  } catch (error) {
    console.error('Error setting Gemini API key:', error);
    return false;
  }
});

ipcMain.handle('send-message-to-gemini', async (event, message) => {
  try {
    return await geminiService.sendMessage(message);
  } catch (error) {
    console.error('Error sending message to Gemini:', error.message);
    throw new Error(error.message || 'An unknown error occurred.');
  }
});

ipcMain.handle('clear-gemini-conversation', () => {
  geminiService.clearConversation();
  return true;
});

ipcMain.handle('get-gemini-status', () => {
  return geminiService.isInitialized;
});

// Clean up on quit
app.on('will-quit', () => {
  // Unregister all shortcuts
  globalShortcut.unregisterAll();
});
