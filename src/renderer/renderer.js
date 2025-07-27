const { ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded');

    // DOM elements
    const noteTextarea = document.getElementById('note');
    const settingsBtn = document.getElementById('settings-btn');
    const settingsPanel = document.getElementById('settings-panel');
    const opacitySlider = document.getElementById('opacity-slider');
    const opacityValue = document.getElementById('opacity-value');
    const alwaysOnTopBtn = document.getElementById('always-on-top-btn');
    const alwaysOnTopStatus = document.getElementById('always-on-top-status');
    const modeToggleBtn = document.getElementById('mode-toggle');
    const notesView = document.getElementById('notes-view');
    const chatView = document.getElementById('chat-view');
    const chatInput = document.getElementById('chat-input');
    const sendMessageBtn = document.getElementById('send-message');
    const chatMessages = document.getElementById('chat-messages');
    const geminiApiKeyInput = document.getElementById('gemini-api-key');
    const saveApiKeyBtn = document.getElementById('save-api-key');
    const apiKeyStatus = document.getElementById('api-key-status');
    const titleBar = document.querySelector('.title-bar');

    let isChatMode = false;
    let isDragging = false;
    let offsetX, offsetY;

    // Configure marked.js for better markdown parsing
    if (typeof marked !== 'undefined') {
        marked.setOptions({
            breaks: true,
            gfm: true,
            sanitize: false,
            smartLists: true,
            smartypants: false
        });
    }

    // Load initial state from main process
    ipcRenderer.on('load-notes', (event, notes) => {
        console.log('Renderer: Received notes:', notes);
        noteTextarea.value = notes;
    });

    ipcRenderer.on('update-opacity', (event, opacity) => {
        console.log('Renderer: Received opacity:', opacity);
        const opacityPercentage = Math.round(parseFloat(opacity) * 100) || 90;
        opacitySlider.value = opacityPercentage;
        opacityValue.textContent = opacityPercentage;
        document.body.style.opacity = opacity;
    });

    ipcRenderer.on('update-always-on-top-status', (event, isAlwaysOnTop) => {
        console.log('Renderer: Received always-on-top status:', isAlwaysOnTop);
        alwaysOnTopStatus.textContent = isAlwaysOnTop ? 'On' : 'Off';
    });

    // Save notes as user types
    noteTextarea.addEventListener('input', (e) => {
        console.log('Note textarea input:', e.target.value);
        ipcRenderer.send('save-notes', e.target.value);
    });

    // Log chat input
    chatInput.addEventListener('input', (e) => {
        console.log('Chat input:', e.target.value);
    });

    // Toggle settings panel
    settingsBtn.addEventListener('click', () => {
        settingsPanel.classList.toggle('visible');
    });

    // Handle opacity change
    opacitySlider.addEventListener('input', (e) => {
        const opacity = e.target.value;
        console.log('Opacity:', opacity);
        opacityValue.textContent = opacity;
        document.body.style.opacity = opacity / 100;
        ipcRenderer.send('update-opacity', opacity / 100);
    });

    // Toggle always on top
    alwaysOnTopBtn.addEventListener('click', () => {
        ipcRenderer.send('toggle-always-on-top');
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        console.log('Keydown:', e.key, 'Meta:', e.metaKey, 'Ctrl:', e.ctrlKey);
        // Cmd+T to toggle mode
        if (e.key === 't' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            console.log('Toggling view');
            toggleView();
        }
        // Cmd+, to open settings
        else if (e.key === ',' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            console.log('Toggling settings');
            settingsPanel.classList.toggle('visible');
        }
        // Close settings panel with Escape
        else if (e.key === 'Escape' && settingsPanel.classList.contains('visible')) {
            settingsPanel.classList.remove('visible');
        }
        // Enter to send message in chat
        else if (e.key === 'Enter' && !e.shiftKey && isChatMode && e.target === chatInput) {
            e.preventDefault();
            sendMessageBtn.click();
        }
    });

    // Make window draggable
    titleBar.addEventListener('mousedown', (e) => {
        // We check if the target is not a button to avoid conflicts
        if (e.target.closest('.action-btn')) {
            return;
        }
        console.log('Title bar clicked, starting drag:', e.target);
        isDragging = true;
        offsetX = e.clientX;
        offsetY = e.clientY;
        document.addEventListener('mousemove', handleDrag);
        document.addEventListener('mouseup', stopDrag);
    });

    function handleDrag(e) {
        if (!isDragging) return;
        const { screenX, screenY } = e;
        ipcRenderer.send('window-move', {
            x: screenX - offsetX,
            y: screenY - offsetY
        });
    }

    function stopDrag() {
        isDragging = false;
        document.removeEventListener('mousemove', handleDrag);
        document.removeEventListener('mouseup', stopDrag);
    }

    // Prevent text selection while dragging
    document.addEventListener('selectstart', (e) => {
        if (isDragging) {
            e.preventDefault();
            return false;
        }
    });

    // Handle window resize
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            const { width, height } = document.body.getBoundingClientRect();
            ipcRenderer.send('window-resize', { width, height });
        }, 100);
    });

    // Listen for focus events from main process
    ipcRenderer.on('window-focused', () => {
        console.log('Renderer: Window focused');
        noteTextarea.focus(); // Try forcing focus on the textarea
    });

    function toggleView() {
        isChatMode = !isChatMode;
        if (isChatMode) {
            notesView.classList.remove('active');
            chatView.classList.add('active');
            modeToggleBtn.textContent = '📝';
            chatInput.focus();
        } else {
            chatView.classList.remove('active');
            notesView.classList.add('active');
            modeToggleBtn.textContent = '💬';
            noteTextarea.focus();
        }
    }
    
    if (modeToggleBtn) {
        modeToggleBtn.addEventListener('click', toggleView);
    }

    // Send message to Gemini
    sendMessageBtn.addEventListener('click', async () => {
        const message = chatInput.value.trim();
        if (!message) return;

        console.log('Renderer: Sending message:', message);
        appendMessage(message, 'user-message');
        chatInput.value = '';
        chatInput.style.height = 'auto'; // Reset height

        // Show typing indicator
        const typingIndicator = appendTypingIndicator();

        try {
            const response = await ipcRenderer.invoke('send-message-to-gemini', message);
            console.log('Renderer: Received response:', response);
            
            // Remove typing indicator
            removeTypingIndicator(typingIndicator);
            
            // Append AI response with markdown rendering
            appendMessage(response, 'ai-message', true);
        } catch (error) {
            console.error('Renderer: Error sending message:', error.message);
            
            // Remove typing indicator
            removeTypingIndicator(typingIndicator);
            
            appendMessage(`Error: ${error.message}`, 'error-message');
        }
    });

    // Save API Key
    saveApiKeyBtn.addEventListener('click', async () => {
        const apiKey = geminiApiKeyInput.value.trim();
        if (!apiKey) {
            apiKeyStatus.textContent = 'Please enter an API key.';
            apiKeyStatus.className = 'status-message error';
            return;
        }

        try {
            const success = await ipcRenderer.invoke('set-api-key', apiKey);
            if (success) {
                apiKeyStatus.textContent = 'API Key saved and verified!';
                apiKeyStatus.className = 'status-message success';
            } else {
                throw new Error('Invalid API Key.');
            }
        } catch (error) {
            apiKeyStatus.textContent = `Error: ${error.message}`;
            apiKeyStatus.className = 'status-message error';
        }
    });

    // Function to render markdown content
    function renderMarkdown(text) {
        if (typeof marked === 'undefined') {
            return text; // Fallback to plain text if marked.js is not available
        }

        try {
            let html = marked.parse(text);
            
            // Add syntax highlighting if highlight.js is available
            if (typeof hljs !== 'undefined') {
                // Find code blocks and highlight them
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = html;
                
                const codeBlocks = tempDiv.querySelectorAll('pre code');
                codeBlocks.forEach(block => {
                    // Try to detect language or use auto-detection
                    const result = hljs.highlightAuto(block.textContent);
                    block.innerHTML = result.value;
                    block.classList.add('hljs');
                });
                
                html = tempDiv.innerHTML;
            }
            
            return html;
        } catch (error) {
            console.error('Error rendering markdown:', error);
            return text; // Fallback to plain text
        }
    }

    // Function to add copy buttons to code blocks
    function addCopyButtons(messageElement) {
        const codeBlocks = messageElement.querySelectorAll('pre');
        codeBlocks.forEach((pre, index) => {
            const container = document.createElement('div');
            container.className = 'code-block-container';
            
            const copyButton = document.createElement('button');
            copyButton.className = 'copy-button';
            copyButton.textContent = 'Copy';
            copyButton.onclick = () => {
                const code = pre.querySelector('code') || pre;
                navigator.clipboard.writeText(code.textContent).then(() => {
                    copyButton.textContent = 'Copied!';
                    setTimeout(() => {
                        copyButton.textContent = 'Copy';
                    }, 2000);
                }).catch(err => {
                    console.error('Failed to copy:', err);
                });
            };
            
            // Wrap the pre element
            pre.parentNode.insertBefore(container, pre);
            container.appendChild(pre);
            container.appendChild(copyButton);
        });
    }

    function appendMessage(text, type, isMarkdown = false) {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message', type);
        
        const contentDiv = document.createElement('div');
        contentDiv.classList.add('message-content');
        
        if (isMarkdown && type === 'ai-message') {
            // Render markdown for AI messages
            contentDiv.innerHTML = renderMarkdown(text);
            
            // Add copy buttons to code blocks after rendering
            addCopyButtons(contentDiv);

        } else {
            // Plain text for user messages and errors
            contentDiv.textContent = text;
        }
        
        messageDiv.appendChild(contentDiv);
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        
        return messageDiv;
    }

    function appendTypingIndicator() {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message', 'ai-message', 'typing-indicator');
        
        const contentDiv = document.createElement('div');
        contentDiv.classList.add('message-content');
        contentDiv.innerHTML = '<em>AI is typing...</em>';
        
        messageDiv.appendChild(contentDiv);
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        return messageDiv;
    }

    function removeTypingIndicator(typingIndicator) {
        if (typingIndicator && typingIndicator.parentNode) {
            typingIndicator.parentNode.removeChild(typingIndicator);
        }
    }

    // Auto-resize chat input
    chatInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });

    // Initialize highlight.js if available
    if (typeof hljs !== 'undefined') {
        hljs.configure({
            ignoreUnescapedHTML: true
        });
    }
});
