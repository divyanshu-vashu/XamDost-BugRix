Yes, you absolutely can! Your analogy to React is a great one. While it's not *literally* a single line of code, it's a "one-line" configuration change in your `main.js` that enables your CSS to automatically handle dark mode.

The process has two simple parts:

1.  **Tell Electron to follow the OS theme** (This is your "one-liner").
2.  **Add CSS rules** that apply dark styles when the OS is in dark mode.

---

### Part 1: The "One-Liner" in `main.js`

You just need to import `nativeTheme` from Electron and set its `themeSource` to `'system'`. This tells your application to respect the user's OS-level light/dark mode setting.

Open your `main.js` file and make this one addition. The best place is right before you create your window.

```javascript
const { app, BrowserWindow, globalShortcut, ipcMain, dialog, systemPreferences, nativeTheme } = require('electron'); // 1. Import nativeTheme
const path = require('path');
// ... rest of your require statements

// ...

function createWindow() {
  // 2. Add this one line before creating the window
  nativeTheme.themeSource = 'system';

  const { width, height, x, y } = store.get('windowBounds');
  
  // Create the browser window.
  mainWindow = new BrowserWindow({
    // ... all your window settings
  });

  // ... rest of your createWindow function
}

// ... rest of your main.js file
```

That's it for the main process! This one line enables the `@media (prefers-color-scheme: dark)` CSS query in your renderer process.

---

### Part 2: The CSS Magic in `styles.css`

Now, you just need to tell your app what it should look like in dark mode. You do this in your `src/renderer/styles.css` file using a standard CSS media query.

The best practice is to define your colors using CSS variables.

```css
/* src/renderer/styles.css */

/* --- Default Light Mode Variables --- */
:root {
  --background-primary: #ffffff;
  --background-secondary: #f8f9fa;
  --text-primary: #212529;
  --text-secondary: #6c757d;
  --border-color: #e9ecef;
  --accent-color: #4a90e2;
  --accent-color-hover: #3a7bc8;
}

/* --- Dark Mode Overrides (This is where the magic happens) --- */
@media (prefers-color-scheme: dark) {
  :root {
    --background-primary: #2c3e50; /* Dark blue-grey */
    --background-secondary: #34495e; /* Lighter dark blue-grey */
    --text-primary: #ecf0f1;     /* Light grey */
    --text-secondary: #bdc3c7;   /* Medium grey */
    --border-color: #4a627a;
    --accent-color: #5dade2;       /* Lighter blue for better contrast */
    --accent-color-hover: #85c1e9;
  }
}


/* --- Apply the variables to your elements --- */

body {
  background-color: var(--background-primary);
  color: var(--text-primary);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
  margin: 0;
  padding: 0;
}

#app {
  background-color: var(--background-primary);
  /* ... etc */
}

/* Example for a button */
.meet-toggle {
  background-color: var(--accent-color);
  color: white;
  /* ... */
}
.meet-toggle:hover {
  background-color: var(--accent-color-hover);
}

/* Example for a message box */
.ai-message {
  background-color: var(--background-secondary);
  color: var(--text-primary);
  /* ... */
}
```

### How It Works

1.  The `nativeTheme.themeSource = 'system';` line in `main.js` tells the Chromium window to follow the OS theme.
2.  When you switch your Mac to Dark Mode, the Chromium window tells your CSS that `prefers-color-scheme` is now `dark`.
3.  Your CSS media query `@media (prefers-color-scheme: dark)` automatically activates.
4.  It overrides the root CSS variables with your new dark mode colors.
5.  Since all your elements use these variables (`var(--background-primary)`, etc.), your entire UI instantly updates to the dark theme without any extra JavaScript.

This is the modern, clean, and professional way to implement dark mode in an Electron app.