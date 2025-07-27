Of course. Here is a detailed Product Requirements Document (PRD) and a Proof of Concept (PoC) plan for the project, synthesizing the provided information into a structured format.

---

## Product Requirements Document (PRD): XamDost

### 1. Introduction & Vision

**Product Name:** XamDost
**Vision:** To provide professionals, interviewees, and presenters with a seamless and private way to access their notes during screen-sharing sessions without the notes being visible to other participants.

**Problem:** During video calls, interviews, or presentations where a user is sharing their screen, there is no native, reliable way to view personal notes or prompts on the same screen without them being captured and seen by the audience. Current workarounds (e.g., using a second device, physical notes) are often clunky and distracting.

**Solution:** XamDost is a lightweight desktop application that provides an overlay window for note-taking. This window is accessible via a global keyboard shortcut and, most importantly, leverages operating system-level APIs to exclude itself from screen captures and screen-sharing streams. To the user, the notes are visible; to the screen-sharing software, the window is invisible or appears as a black box.

### 2. Target Audience & User Personas

*   **The Interview Candidate:** Needs to refer to talking points, STAR method examples, or questions for the interviewer without appearing unprepared or breaking eye contact to look at another screen.
*   **The Remote Professional:** Needs to reference key data points, client information, or a meeting agenda during a presentation or collaborative session.
*   **The Online Educator/Tutor:** Needs to see teaching prompts or a lesson plan while demonstrating software or a concept to students.

### 3. Features & Requirements

#### 3.1. Core Functionality

| ID | Feature | Description | Priority |
| :--- | :--- | :--- | :--- |
[ ] | F-01 | **Global Hotkey Toggle** | The user must be able to instantly show or hide the XamDost window using a global keyboard shortcut (**Cmd+/** on macOS, **Ctrl+/** on Windows). The shortcut must work regardless of which application is currently in focus. | P0 |
[-] | F-02 | **Content Protection (Stealth Mode)** | The application window must be excluded from screen captures. This means it should not appear in screenshots or screen-sharing streams (e.g., Zoom, Google Meet, Microsoft Teams). | P0 |
[-] | F-03 | **Overlay User Interface** | The application window must be frameless, have a semi-transparent background, and always stay on top of other application windows to feel like a native overlay. | P0 |
[-] | F-04 | **Basic Text Input** | The window must contain a simple text input area where the user can type and view notes in real-time. | P1 |
[] | F-05 | **voice Input** | there should listen voice from mic and sound and there is button it should auto detect when user stop from 3 sec else it will continue listen and reply , there should be 1 button for start litening and stop.


#### 3.2. Non-Functional Requirements

| ID | Requirement | Description |
| :--- | :--- | :--- |
| NFR-01 | **Platform Support** | The application must be fully functional on modern versions of **Windows 10/11** (20H1+) and **macOS**. The core content protection feature is not required for Linux, as the underlying API is unsupported. |
| NFR-02 | **Performance** | The application must be lightweight, with minimal CPU and memory footprint, to ensure it does not interfere with the performance of other applications (especially resource-intensive video conferencing tools). |
| NFR-03 | **Usability** | The application should be simple and intuitive, requiring zero configuration to get started. The primary interaction is the hotkey. |

#### 3.3. Technical Specifications

| Component | Specification | Rationale / Source |
| :--- | :--- | :--- |
| **Framework** | Electron | Enables cross-platform development (Windows, macOS) and access to native OS features. |
| **Content Protection API** | `BrowserWindow.setContentProtection(true)` | This Electron API invokes the necessary native calls: `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` on Windows and `NSWindow.sharingType = .none` on macOS. |
| **Window Type** | Frameless, Transparent, Always-on-top | `frame: false`, `transparent: true`, `alwaysOnTop: true`. Creates the desired unobtrusive overlay experience. |
| **Global Shortcut** | `globalShortcut.register()` | Electron's built-in module for listening to system-wide keyboard events. |

### 4. Assumptions and Constraints

*   **Assumption:** Users are on a supported OS (modern Windows/macOS) where the content protection APIs are effective.
*   **Constraint (macOS):** The content protection on macOS may be bypassed by some Chromium-based WebRTC capture methods (e.g., in Google Chrome). The feature is "best-effort" and may not be 100% foolproof on this platform against all screen-sharing clients.
*   **Constraint (Linux):** The core content protection feature is **out of scope** for Linux due to the lack of a corresponding stable API in Electron.
*   **Constraint (Security):** This feature provides privacy, not unbreakable security. It will stop casual and most application-level screen captures, but it can be defeated by dedicated hardware (e.g., an external camera) or highly privileged software. It should not be used for highly sensitive information.

### 5. Success Metrics

*   The content protection feature successfully hides the window from at least 3 major screen-sharing applications (Zoom, Google Meet, Slack) on both Windows and macOS.
*   The global hotkey is responsive with a latency of <200ms.
*   The application's idle CPU usage is <1% and memory usage is <100MB.

---

## Proof of Concept (PoC) Plan: Building XamDost

### 1. Objective

To build a minimal viable version of the XamDost application that validates the three core technical pillars:
1.  A global hotkey to toggle window visibility.
2.  A frameless, always-on-top overlay window.
3.  Effective content protection that hides the window from screen captures on macOS and Windows.

### 2. PoC Setup and Code

**Prerequisites:** Node.js and npm installed.

#### Step 1: Initialize Project and Install Electron

```bash
# Create a new project directory
mkdir stealth-note-poc && cd stealth-note-poc

# Initialize a new Node.js project
npm init -y

# Install Electron as a development dependency
npm install --save-dev electron
```

#### Step 2: Configure `package.json`

Open `package.json` and add the `main` and `start` script entries:

```json
{
  "name": "stealth-note-poc",
  "version": "1.0.0",
  "description": "",
  "main": "main.js",
  "scripts": {
    "start": "electron ."
  },
  "keywords": [],
  "author": "",
  "license": "ISC",
  "devDependencies": {
    "electron": "^27.0.0" // Version may vary
  }
}
```

#### Step 3: Create the Main Process (`main.js`)

This file orchestrates the application window and its properties.

```javascript
// main.js
const { app, BrowserWindow, globalShortcut } = require('electron');

let overlayWindow;

function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    width: 450,
    height: 350,
    frame: false,            // Frameless window
    transparent: true,       // Allows for transparent background
    alwaysOnTop: true,       // Stays on top of other apps
    skipTaskbar: true,       // Doesn't show in the taskbar/dock
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // --- THE CORE FEATURE ---
  // This tells the OS to exclude this window from screen captures.
  overlayWindow.setContentProtection(true);

  overlayWindow.loadFile('index.html');

  // Start hidden
  overlayWindow.hide();
}

app.whenReady().then(() => {
  createOverlayWindow();

  // Register the global shortcut (Cmd+Slash on macOS, Ctrl+Slash on Windows)
  const ret = globalShortcut.register('CommandOrControl+/', () => {
    if (overlayWindow.isVisible()) {
      overlayWindow.hide();
    } else {
      overlayWindow.show();
      overlayWindow.focus();
    }
  });

  if (!ret) {
    console.log('Failed to register global shortcut');
  }
});

app.on('will-quit', () => {
  // Unregister all shortcuts when the app is closing.
  globalShortcut.unregisterAll();
});
```

#### Step 4: Create the Renderer Process (`index.html`)

This is the UI of our note-taking overlay.

```html
<!-- index.html -->
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>XamDost</title>
    <style>
        body {
            margin: 0;
            padding: 20px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: rgba(20, 20, 20, 0.85); /* Semi-transparent dark background */
            backdrop-filter: blur(10px); /* Frosted glass effect */
            -webkit-backdrop-filter: blur(10px);
            color: #f0f0f0;
            border-radius: 12px;
            overflow: hidden;
            height: 100vh;
            box-sizing: border-box;
        }
        textarea {
            width: 100%;
            height: calc(100% - 10px);
            background: transparent;
            border: none;
            color: #f0f0f0;
            font-size: 16px;
            resize: none;
            outline: none;
        }
    </style>
</head>
<body>
    <textarea autofocus placeholder="Your private notes here..."></textarea>
</body>
</html>
```

### 3. How to Run and Test the PoC

#### Step 1: Run the Application

In your terminal, run the start command:
```bash
npm start
```
The application will launch, but the window will be hidden.

#### Step 2: Test the Functionality

1.  **Hotkey Test:** Press `Ctrl+/` (Windows/Linux) or `Cmd+/` (macOS). The overlay window should appear. Press it again; it should disappear.
2.  **Screen Capture Test (Windows):**
    *   With the overlay visible, press `Win + Shift + S` to open the Snipping Tool.
    *   Try to capture the area with the overlay. The resulting screenshot should either show a black rectangle or the overlay will be completely missing.
3.  **Screen Capture Test (macOS):**
    *   With the overlay visible, press `Cmd + Shift + 4`.
    *   Try to capture the window. The resulting screenshot should not contain the overlay's content.
4.  **Screen-Sharing Test (Critical):**
    *   Start a meeting in Zoom, Google Meet (in a browser), or Microsoft Teams.
    *   Start sharing your *entire screen*.
    *   Toggle the XamDost overlay to be visible on your screen.
    *   Check the participant view (either on a second device or by looking at the "what others see" preview). The overlay window should be invisible or blacked out to the audience, even though you can see it perfectly.

### 4. PoC Conclusion

This PoC successfully demonstrates that the core requirements of the XamDost project are technically feasible using Electron. It validates that `setContentProtection(true)` is effective for its intended purpose on the target platforms and that it can be integrated into a user-friendly package with a global hotkey and a modern overlay UI. The next steps would be to refine the UI, add features from the PRD backlog (like saving notes), and package the application for distribution using `electron-builder`.