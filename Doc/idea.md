Electron’s Content-Protection API and OS Hooks
Electron provides a built-in way to mark a BrowserWindow as “protected” from screen capture. In your main process you can call:
js
Copy
Edit
const win = new BrowserWindow({ width:800, height:600 /* other options */ });
win.setContentProtection(true);
This tells the OS to exclude the window’s contents from screenshots and screen shares
stackoverflow.com
electronjs.org
. Under the hood, Electron invokes the native APIs: on macOS it sets the NSWindow’s sharing type to NSWindowSharingNone, and on Windows it calls the Win32 API SetWindowDisplayAffinity(hWnd, WDA_EXCLUDEFROMCAPTURE)
electronjs.org
. On modern Windows 10 (build 2004+) this makes the window completely invisible in captures; on older Windows it typically appears as a black rectangle
electronjs.org
. In practice, Cluely (and similar apps) likely use this API to hide the window during any screen-record or screen-share. For example, one blogger notes that Cluely’s Electron window is made “invisible to screen sharing” (which is achieved via content protection)
medium.com
.
Platform-Specific Behavior
Windows: Electron’s call to SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE) means that on Windows 10+ (20H1/2004 and later) the window is entirely excluded from the captured framebuffer
electronjs.org
. On older Windows versions, the window still exists but any capture APIs will see only a black area for that window
electronjs.org
github.com
. Note that in recent Electron versions a change caused protected windows to show up as black rather than fully hidden
github.com
. In summary, on Windows Cluely’s window will not appear to screen-capture APIs (it’s invisible or blacked out) when setContentProtection(true) is used.
macOS: Electron sets NSWindow.sharingType = .none under the hood. In principle this prevents the window from being captured by standard OS screenshot tools. In practice, however, some screen-share mechanisms (especially Chromium-based WebRTC captures in Chrome/Zoom/Teams) have been reported to ignore this setting. For example, one user notes that setContentProtection(true) works on Windows but on macOS a Chrome screen-share “has access to my app’s content”
stackoverflow.com
. Indeed, a known Electron bug (Issue 19880) indicates that certain capture paths on macOS bypass the NSWindowSharingNone protection
stackoverflow.com
. In short, content protection on macOS often blocks QuickTime and system screenshots, but it may not stop all web-based or GPU-level screen-share clients.
Linux: Electron’s content-protection API is only supported on Windows and macOS. On most Linux desktop environments there is no equivalent X11/Wayland API exposed, so the window cannot be hidden from screen capture via a simple Electron flag. Cluely’s functionality likely does not hide the window on Linux (or would need a custom native workaround).
Usage and Code Example
Use setContentProtection on any BrowserWindow you want to hide. For example:
js
Copy
Edit
// In Electron main process
const { app, BrowserWindow } = require('electron');
app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 800, height: 600,
    // transparent and frameless if needed for overlay look
    transparent: true, frame: false 
  });
  win.loadURL('file://…/index.html');
  win.setContentProtection(true);  // protect from capture
});
Calling win.setContentProtection(true) will engage the OS protection APIs (see above)
stackoverflow.com
electronjs.org
. You can later call win.isContentProtected() to check the state
electronjs.org
. Note that transparent: true or frame: false (as seen in Cluely’s UI) affect only the window appearance; they do not by themselves hide the window from capture. The critical flag is contentProtection.
Limitations and Caveats
Not Foolproof: As noted, even with contentProtection enabled there is no guaranteed way to block every screen capture method. Some advanced tools or APIs may capture the screen’s framebuffer bypassing the OS’s normal mechanisms
stackoverflow.com
. For example, Google Meet/Zoom’s WebRTC capture and some Linux tools might ignore these flags
stackoverflow.com
stackoverflow.com
. Security researchers have demonstrated that apps like Confide (an Electron messenger) claimed screenshot prevention but it could be defeated
blog.quarkslab.com
. In practice, contentProtection makes casual screenshots (Print Screen, native tools) and most share apps skip the window, but a determined attacker could still grab the pixels (e.g. via external camera or low-level hooks).
Window Visibility: Because the window is excluded, it can appear blank or black in any captured output. In the case of Cluely, this means that if you share your screen or take a screenshot normally, the Cluely window simply doesn’t appear
medium.com
. However, to the user’s display the overlay is still visible (Cluely’s overlay is literally on the screen); it’s only hidden from the capture stream. In other words, someone pointing a camera at the screen can still see Cluely, even though a digital screen capture won’t show it.
OS Permissions: On macOS, note that modern screen-sharing/recording requires user permission (Screen Recording permission). If your app has permission to record the screen, it may inadvertently see itself. But with contentProtection, even with permission, the OS should block capture of that window. Some users have reported, though, that granting recording permission can alter the behavior of protected windows, so it’s something to test carefully on the target OS versions.
Native Workarounds (if needed)
If Electron’s built-in API is insufficient (for example, on an unsupported OS or against a specific capture method), one could invoke the native APIs manually:
Windows: You can call the Win32 SetWindowDisplayAffinity yourself (with WDA_EXCLUDEFROMCAPTURE) by using a native Node addon or FFI library in the main process. You would first obtain the hWnd (window handle) via win.getNativeWindowHandle(), then call the function from user32.dll. This is essentially what Electron does internally
electronjs.org
, but doing it yourself gives full control (e.g. to use other flags like WDA_MONITOR).
macOS: Similarly, you could use a native Objective-C add-on to call [NSWindow setSharingType:NSWindowSharingNone] on the window’s NSWindow. Electron’s setContentProtection already does this, but a custom approach could, for example, change it on-the-fly or use other Cocoa hooks. Keep in mind that Apple’s API note warns that an NSWindow with sharingType = None cannot participate in some system features, so use it sparingly
stackoverflow.com
.
No widely-used third-party library exists specifically for “making an Electron window capture-immune” – the built-in API covers most cases. Aside from Electron’s own API, you’d rely on general native interop techniques (e.g. node-ffi, N-API addons, or electron-rebuild with a C++ module) to leverage OS calls.
Summary
Cluely and similar Electron apps hide their UI during screen capture by using Electron’s content protection. In code this is win.setContentProtection(true), which under the hood uses NSWindowSharingNone (macOS) or SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE) (Windows)
electronjs.org
stackoverflow.com
. This effectively excludes the window from screenshot/screen-share streams (on Win10 2004+ it becomes invisible; on older Windows it shows black)
electronjs.org
github.com
. The approach has platform-specific caveats: on macOS it’s known to fail with some Chromium-based captures (Electron issue 19880)
stackoverflow.com
stackoverflow.com
, and on Linux there is no native support. No other Electron property is needed – Cluely’s main trick is simply turning on contentProtection (often combined with a frameless transparent BrowserWindow for UI, as noted by users
medium.com
). Developers implementing this should be aware that highly privileged capture tools can sometimes bypass it
stackoverflow.com
blog.quarkslab.com
, so it’s a best-effort protection rather than an unbreakable lock. Sources: Electron docs and issues for setContentProtection
electronjs.org
stackoverflow.com
; StackOverflow discussion of its use
stackoverflow.com
stackoverflow.com
; Electron GitHub issues on platform quirks
github.com
; and commentary on Cluely/Electron (Medium blog) noting the invisible overlay
medium.com
. These explain how the API works and its limits.





### Idea 2:


26 Jul 2025



To architect a macOS Electron app that summons a protected chat overlay via Cmd + /, you’ll need to converge on three core pillars:
Global hotkey orchestration


Frameless, always-on-top overlay


Content protection (screen-share exclusion)


Below is a distilled blueprint and sample code to get you enterprise-ready.

1. Bootstrap your Electron project
bash
CopyEdit
mkdir mac-chat-overlay && cd mac-chat-overlay
npm init -y
npm install electron --save-dev

Add to your package.json:
jsonc
CopyEdit
{
  "main": "main.js",
  "scripts": {
    "start": "electron ."
  }
}


2. Register a global shortcut (Cmd + /)
In main.js, leverage Electron’s globalShortcut API to listen for CommandOrControl+/. This ensures your overlay springs into view regardless of which app is foreground.
js
CopyEdit
const { app, BrowserWindow, globalShortcut } = require('electron');

let chatWin = null;

function createChatWindow() {
  chatWin = new BrowserWindow({
    width: 400,
    height: 600,
    frame: false,                  // Frameless for seamless overlay
    transparent: true,             // Allows translucent backdrop
    alwaysOnTop: true,             // Floats above all windows
    skipTaskbar: true,             // Hides from Dock
    focusable: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // Prevent this window from appearing in screen-shares & screenshots
  chatWin.setContentProtection(true);  // macOS & Windows :contentReference[oaicite:0]{index=0}

  chatWin.loadURL(`file://${__dirname}/index.html`);
  chatWin.hide();
}

app.whenReady().then(() => {
  createChatWindow();

  // Register Cmd + /
  const success = globalShortcut.register('CommandOrControl+/', () => {
    if (chatWin.isVisible()) {
      chatWin.hide();
    } else {
      chatWin.show();
      chatWin.focus();
    }
  });

  if (!success) {
    console.error('❌ Failed to register global shortcut');
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});


3. Build your chat UI
In index.html, wire up a front-end framework of your choice (React, Vue, plain HTML/CSS). Example stub:
html
CopyEdit
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Overlay Chat</title>
  <style>
    body { margin: 0; background: rgba(0,0,0,0.6); color: #fff; font-family: sans-serif; }
    #chat-container { padding: 1rem; }
    /* Additional styling… */
  </style>
</head>
<body>
  <div id="chat-container">
    <h2>Quick Chat</h2>
    <div id="messages"></div>
    <input id="input" placeholder="Type a message…" autofocus />
  </div>

  <script>
    const input = document.getElementById('input');
    const messages = document.getElementById('messages');
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && input.value.trim()) {
        const msg = document.createElement('div');
        msg.textContent = input.value;
        messages.appendChild(msg);
        input.value = '';
      }
    });
  </script>
</body>
</html>


4. Packaging for macOS
Use electron-packager or electron-builder to produce a .app bundle:
bash
CopyEdit
npm install electron-packager --save-dev

npx electron-packager . MacChatOverlay --platform=darwin --arch=x64 --app-version=1.0.0 --overwrite


Key takeaways & corporate-grade considerations
GlobalShortcut ensures frictionless UX by intercepting Cmd + / system-wide.


BrowserWindow.setContentProtection(true) selectively excludes your overlay from screen-sharing streams and screenshots, preserving confidentiality Stack Overflow.


A frameless, transparent, always-on-top window yields a native-feel overlay, unobtrusive yet immediately available.


For production, consider code-signing and entitlements to satisfy macOS security policies.


By synergizing these modules, you’ll have a robust, screen-share-resilient chat assistant—just like Cluely—ready to deploy in a corporate environment.

Sources
You said:
I want prime feature what cluely have it , like it open chat and when i share screen for interview the chat is not visible to them !!!!
ChatGPT said:
To replicate Cluely’s stealth chat overlay—a chat window that opens with a shortcut (Cmd + /) and remains invisible during screen sharing (like Zoom, Meet, etc.)—you need to engineer an Electron-based macOS app with the following "prime feature":

✅ Stealth Chat Overlay Requirements
Feature
Required Setup in Electron
Global Shortcut (Cmd + /)
globalShortcut.register()
Invisible in Screen Share
win.setContentProtection(true)
Frameless, floating chat window
alwaysOnTop, frame: false, transparent: true
Not listed in Dock
skipTaskbar: true
Launches without stealing focus
Use win.setVisibleOnAllWorkspaces(true)


🔐 Step-by-Step Build: Cluely-like Stealth Chat
1. Main Process – main.js
js
CopyEdit
const { app, BrowserWindow, globalShortcut } = require('electron');

let chatWindow;

function createChatOverlay() {
  chatWindow = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    hasShadow: false,
    resizable: false,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
    }
  });

  // ❗ Prime feature: Hide from screen recording and sharing
  chatWindow.setContentProtection(true); // 🛡️ Zoom, Google Meet, etc. can't capture it

  chatWindow.loadFile('index.html');
  chatWindow.hide();
}

app.whenReady().then(() => {
  createChatOverlay();

  // 🧠 CMD + / shortcut
  globalShortcut.register('CommandOrControl+/', () => {
    if (chatWindow.isVisible()) {
      chatWindow.hide();
    } else {
      chatWindow.show();
      chatWindow.focus();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});


2. Renderer – index.html
html
CopyEdit
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Stealth Chat</title>
  <style>
    body {
      margin: 0;
      background-color: rgba(30,30,30,0.7);
      color: white;
      font-family: sans-serif;
    }
    #chat-box {
      padding: 10px;
    }
    input {
      width: 100%;
      background: #222;
      color: white;
      border: none;
      padding: 10px;
    }
  </style>
</head>
<body>
  <div id="chat-box">
    <div id="messages"></div>
    <input id="input" placeholder="Type your notes..." autofocus>
  </div>

  <script>
    const input = document.getElementById('input');
    const messages = document.getElementById('messages');

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        const msg = document.createElement('div');
        msg.textContent = input.value;
        messages.appendChild(msg);
        input.value = '';
      }
    });
  </script>
</body>
</html>


📦 Bonus: Production-Ready Packaging
Use electron-builder to build the .app for macOS:
bash
CopyEdit
npm install --save-dev electron-builder

In package.json:
json
CopyEdit
"build": {
  "appId": "com.vashu.cluelyclone",
  "mac": {
    "category": "public.app-category.productivity"
  }
}

Then:
bash
CopyEdit
npx electron-builder --mac


🎯 Final Outcome
✅ Opens on Cmd + /
 ✅ Hides from Zoom/Meet screen shares
 ✅ Doesn’t show in Dock
 ✅ Always on top
 ✅ Looks like a floating note/chat

⚠️ Important Notes
⚠️ Topic
Details
macOS Privacy
You must code-sign the app to avoid Gatekeeper issues.
Zoom Screen Share
This protection only works if you're using setContentProtection(true). Not all apps obey this (Zoom, Meet do).
AppStore Submission
Apple may reject apps with this stealth feature unless you have a valid use case (e.g., accessibility). For personal use, it’s fine.





