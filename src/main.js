const { app, BrowserWindow, globalShortcut, ipcMain, dialog, systemPreferences } = require('electron');
const path = require('path');
const Store = require('electron-store');
const geminiService = require('./services/gemini');
const MeetService = require('./services/meets');

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
const meetService = new MeetService();

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

  // Attempt to initialize MeetService on startup with a stored key
  const assemblyAiApiKey = store.get('assemblyAiApiKey');
  if (assemblyAiApiKey) {
    console.log('Main: Initializing MeetService with stored API key.');
    meetService.init(assemblyAiApiKey);
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
// Forward MeetService events to the renderer process with enhanced logging
meetService.on('status', (status) => {
  console.log(`[${new Date().toISOString()}] MeetService status:`, status);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('meet-status-update', status);
  }
});

meetService.on('transcript', (transcript) => {
  console.log(`[${new Date().toISOString()}] MeetService transcript:`, 
    `${transcript.text.substring(0, 50)}${transcript.text.length > 50 ? '...' : ''}`);
  
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('meet-transcript-update', {
      ...transcript,
      timestamp: transcript.timestamp || new Date().toISOString()
    });
  }
});

meetService.on('session_ended', (sessionData) => {
  console.log(`[${new Date().toISOString()}] MeetService session ended:`, sessionData.sessionId);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('meet-session-ended', sessionData);
  }
});

meetService.on('error', (error) => {
  const errorMessage = error.message || String(error);
  console.error(`[${new Date().toISOString()}] MeetService error:`, errorMessage);
  
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('meet-error', {
      message: errorMessage,
      timestamp: new Date().toISOString(),
      stack: error.stack
    });
  }
});

app.whenReady().then(async () => {
  if (process.platform === 'darwin') { // macOS specific
    const microphoneAccess = await systemPreferences.askForMediaAccess('microphone');
    if (!microphoneAccess) {
      dialog.showErrorBox('Microphone Access Denied', 'You must allow microphone access in System Preferences to use the voice features.');
    }
  }
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
    store.set('geminiApiKey', apiKey); // Persist the key
    console.log('Main: Gemini API key saved.');
    return geminiService.setApiKey(apiKey);
  } catch (error) {
    console.error('Error setting Gemini API key:', error);
    return false;
  }
});

ipcMain.handle('get-gemini-api-key', () => {
  return store.get('geminiApiKey');
});

ipcMain.handle('send-message-to-gemini', async (event, message) => {
  try {
    return await geminiService.sendMessage(message);
  } catch (error) {
    console.error('Error sending message to Gemini:', error.message);
    throw new Error(error.message || 'An unknown error occurred.');
  }
});


// Handle Gemini prompts from both chat and meets views
ipcMain.on('gemini-prompt', async (event, { view, prompt, sessionId }) => {
  const isMeet = view === 'meets';
  console.log(`[${new Date().toISOString()}] Gemini prompt received for ${view} view (${isMeet ? 'meet' : 'chat'})`);
  
  try {
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      throw new Error('Empty or invalid prompt');
    }
    
    console.log(`[${new Date().toISOString()}] Sending to Gemini ${isMeet ? 'meet' : 'chat'}: "${prompt.substring(0, 50)}${prompt.length > 50 ? '...' : ''}"`);
    
    const startTime = Date.now();
    const response = await geminiService.sendMessage(prompt, { isMeet });
    const responseTime = Date.now() - startTime;
    
    console.log(`[${new Date().toISOString()}] Gemini ${isMeet ? 'meet' : 'chat'} response received in ${responseTime}ms`);
    
    event.sender.send('gemini-response', { 
      view, 
      response,
      sessionId,
      timestamp: new Date().toISOString(),
      responseTime
    });
    
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error processing Gemini ${isMeet ? 'meet' : 'chat'} prompt:`, error);
    
    event.sender.send('gemini-response', { 
      view, 
      response: `Error: ${error.message || 'Failed to process your request'}`, 
      sessionId,
      timestamp: new Date().toISOString(),
      error: true
    });
  }
});
ipcMain.handle('set-gemini-api-key', async (event, apiKey) => {
  try {
      console.log('Setting Gemini API key...');
      await geminiService.setApiKey(apiKey);
      console.log('Gemini API key set successfully');
      return true;
  } catch (error) {
      console.error('Error setting Gemini API key:', error);
      return false;
  }
});

ipcMain.handle('clear-gemini-conversation', () => {
  geminiService.clearConversation();
  return true;
});

ipcMain.handle('get-gemini-status', () => {
  return geminiService.isInitialized;
});

// AssemblyAI related IPC handlers
ipcMain.handle('set-assemblyai-api-key', (event, apiKey) => {
  try {
    store.set('assemblyAiApiKey', apiKey);
    console.log('Main: AssemblyAI API key saved.');
    return meetService.init(apiKey); // Initialize service with the new key
  } catch (error) {
    console.error('Error setting AssemblyAI API key:', error);
    return false;
  }
});

ipcMain.handle('get-assemblyai-api-key', () => {
  return store.get('assemblyAiApiKey');
});

// Meet service controls
ipcMain.on('start-meet', async () => {
  try {
    console.log(`[${new Date().toISOString()}] Starting meet service...`);
    await meetService.start();
    console.log(`[${new Date().toISOString()}] Meet service started successfully`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error starting meet service:`, error);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('meet-error', {
        message: `Failed to start meet: ${error.message}`,
        timestamp: new Date().toISOString()
      });
    }
  }
});

ipcMain.on('stop-meet', async () => {
  try {
    console.log(`[${new Date().toISOString()}] Stopping meet service...`);
    await meetService.stop();
    console.log(`[${new Date().toISOString()}] Meet service stopped successfully`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error stopping meet service:`, error);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('meet-error', {
        message: `Error stopping meet: ${error.message}`,
        timestamp: new Date().toISOString()
      });
    }
  }
});

// Clean up on quit
app.on('will-quit', () => {
  // Unregister all shortcuts
  globalShortcut.unregisterAll();
});
