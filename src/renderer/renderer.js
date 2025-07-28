const { ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const titleBar = document.querySelector('.title-bar');

    // View Buttons
    const settingsBtn = document.getElementById('settings-btn');
    const chatBtn = document.getElementById('chat-btn');
    const meetsBtn = document.getElementById('meets-btn');

    // Views
    const settingsView = document.getElementById('settings-view');
    const chatView = document.getElementById('chat-view');
    const meetsView = document.getElementById('meets-view');

    // Settings Elements
    const opacitySlider = document.getElementById('opacity-slider');
    const opacityValue = document.getElementById('opacity-value');
    const alwaysOnTopBtn = document.getElementById('always-on-top-btn');
    const geminiApiKeyInput = document.getElementById('gemini-api-key-input');
    const saveGeminiApiKeyBtn = document.getElementById('save-gemini-api-key-btn');
    const geminiApiKeyStatus = document.getElementById('gemini-api-key-status');
    const assemblyAiApiKeyInput = document.getElementById('assemblyai-api-key-input');
    const saveAssemblyAiApiKeyBtn = document.getElementById('save-assemblyai-api-key-btn');
    const assemblyAiApiKeyStatus = document.getElementById('assemblyai-api-key-status');

    // Chat Elements
    const chatInput = document.getElementById('chat-input');
    const sendMessageBtn = document.getElementById('send-message');
    const chatMessages = document.getElementById('chat-messages');

    // Meet Elements
    const meetStartButton = document.getElementById('meet-start-button');
    const meetStopButton = document.getElementById('meet-stop-button');
    const meetStatus = document.getElementById('meet-status');
    const meetsChatContainer = document.getElementById('meets-chat-container');
    const meetsChatInput = document.getElementById('meets-chat-input');
    const meetsSendMessageBtn = document.getElementById('meets-send-message');

    // --- State ---
    let isDragging = false;
    let offsetX, offsetY;
    let isListening = false;
    let finalTranscript = '';

    // --- Initial Setup ---
    if (typeof marked !== 'undefined') {
        marked.setOptions({ breaks: true, gfm: true });
    }
    initializeApp();

    function initializeApp() {
        switchView('settings'); // Default view is now Settings
        checkGeminiStatus();
        ipcRenderer.invoke('get-opacity').then(opacity => {
            opacitySlider.value = opacity * 100;
            opacityValue.textContent = opacity * 100;
            document.body.style.opacity = opacity;
        });
        ipcRenderer.invoke('get-always-on-top').then(isAlwaysOnTop => {
            alwaysOnTopBtn.textContent = isAlwaysOnTop ? 'Disable Always on Top' : 'Enable Always on Top';
        });
        ipcRenderer.invoke('get-assemblyai-api-key').then(apiKey => {
            if (apiKey) assemblyAiApiKeyInput.value = apiKey;
        });
        ipcRenderer.invoke('get-gemini-api-key').then(apiKey => {
            if (apiKey) geminiApiKeyInput.value = apiKey;
        });
        document.querySelectorAll('input, textarea, button').forEach(el => {
            el.style.webkitAppRegion = 'no-drag';
        });
    }

    // --- Event Listeners ---

    // Meet Controls
    meetStartButton.addEventListener('click', () => {
        ipcRenderer.send('start-meet');
    });

    meetStopButton.addEventListener('click', () => {
        ipcRenderer.send('stop-meet');
    });

    // View Switching
    settingsBtn.addEventListener('click', () => switchView('settings'));
    chatBtn.addEventListener('click', () => switchView('chat'));
    meetsBtn.addEventListener('click', () => switchView('meets'));

    // Settings
    opacitySlider.addEventListener('input', (e) => {
        const opacity = e.target.value / 100;
        opacityValue.textContent = e.target.value;
        document.body.style.opacity = opacity;
        ipcRenderer.send('update-opacity', opacity);
    });
    alwaysOnTopBtn.addEventListener('click', () => ipcRenderer.send('toggle-always-on-top'));

    // API Keys
    saveGeminiApiKeyBtn.addEventListener('click', async () => {
        const success = await ipcRenderer.invoke('set-gemini-api-key', geminiApiKeyInput.value.trim());
        updateApiKeyStatus(geminiApiKeyStatus, success, 'Gemini');
    });
    saveAssemblyAiApiKeyBtn.addEventListener('click', async () => {
        const success = await ipcRenderer.invoke('set-assemblyai-api-key', assemblyAiApiKeyInput.value.trim());
        updateApiKeyStatus(assemblyAiApiKeyStatus, success, 'AssemblyAI');
    });

    // Chat
    if (chatInput) {
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendChatMessage();
            }
        });
    }

    if (sendMessageBtn) {
        sendMessageBtn.addEventListener('click', sendChatMessage);
    }

    // Meets Chat
    if (meetsChatInput) {
        meetsChatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMeetsChatMessage();
            }
        });
    }

    if (meetsSendMessageBtn) {
        meetsSendMessageBtn.addEventListener('click', sendMeetsChatMessage);
    }

    // Window Dragging
    titleBar.addEventListener('mousedown', (e) => {
        if (e.target.closest('.action-btn')) return;
        isDragging = true;
        offsetX = e.clientX;
        offsetY = e.clientY;
        document.addEventListener('mousemove', handleDrag);
        document.addEventListener('mouseup', stopDrag);
    });

    // --- IPC Handlers ---
    ipcRenderer.on('update-always-on-top-status', (event, isAlwaysOnTop) => {
        alwaysOnTopBtn.textContent = isAlwaysOnTop ? 'Disable Always on Top' : 'Enable Always on Top';
    });
    
    // This handler now correctly manages the start/stop button states.
    ipcRenderer.on('meet-status-update', (event, status) => {
        meetStatus.textContent = `Status: ${status}`;
        isListening = (status === 'listening');
        if (isListening) {
            meetStartButton.disabled = true;
            meetStopButton.disabled = false;
        } else {
            meetStartButton.disabled = false;
            meetStopButton.disabled = true;
        }
    });

    // Handle transcript updates from the meet service
    ipcRenderer.on('meet-transcript-update', (event, transcript) => {
        try {
            console.log('Received transcript update:', transcript);
            
            if (transcript.message_type === 'FinalTranscript' && transcript.text && transcript.text.trim()) {
                const transcriptText = transcript.text.trim();
                console.log(`Processing transcript: "${transcriptText}"`);
                
                // Add user's transcribed message to the chat
                addMessage(transcriptText, 'user', meetsChatContainer);
                
                // If there's a response from the meet service, add it to the chat
                if (transcript.response) {
                    console.log('Adding meet service response to chat');
                    addMessage(transcript.response, 'ai', meetsChatContainer, true);
                }
            }
        } catch (error) {
            console.error('Error processing transcript:', error);
            meetStatus.textContent = `Error: ${error.message}`;
            
            // Show error in chat as well
            addMessage(`Error processing transcript: ${error.message}`, 'error', meetsChatContainer);
        }
    });
    
    // Handle Gemini responses for both chat and meet views
    ipcRenderer.on('gemini-response', (event, { view, response, error, sessionId }) => {
        try {
            console.log(`[RENDERER] Received Gemini response payload:`, { view, response, error, sessionId });

            const container = view === 'chat' ? chatMessages : meetsChatContainer;
            if (!container) {
                console.error(`[RENDERER] Container not found for view: ${view}`);
                return;
            }

            if (error) {
                console.error('[RENDERER] Gemini API Error:', error);
                addMessage(`Error: ${response || 'Failed to get response from Gemini'}`, 'error', container);
                return;
            }

            if (!response) {
                console.warn('[RENDERER] Empty response from Gemini');
                addMessage('Received an empty response from Gemini.', 'ai', container);
                return;
            }

            console.log(`[RENDERER] Adding AI response to ${container.id}:`, response);
            addMessage(response, 'ai', container, true);

        } catch (e) {
            console.error('[RENDERER] Fatal error in gemini-response handler:', e);
            const container = view === 'chat' ? chatMessages : meetsChatContainer;
            if (container) {
                addMessage(`Error displaying response: ${e.message}`, 'error', container);
            }
        }
    });

    // Handle meet service errors
    ipcRenderer.on('meet-error', (event, error) => {
        console.error('Meet service error:', error);
        meetStatus.textContent = `Error: ${error.message || error}`;
        isListening = false;
        // Correctly reset button states
        meetStartButton.disabled = false;
        meetStopButton.disabled = true;
        
        // Show error in chat as well
        addMessage(`Error: ${error.message || 'An error occurred with the voice service'}`, 'error', meetsChatContainer);
    });

    // --- Core Functions ---
    function switchView(viewName) {
        document.querySelectorAll('.view').forEach(view => {
            view.classList.remove('active');
            view.style.display = 'none';
        });
        
        document.querySelectorAll('.action-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        
        const view = document.getElementById(`${viewName}-view`);
        const button = document.getElementById(`${viewName}-btn`);
        
        if (view) {
            view.classList.add('active');
            view.style.display = 'block';
        }
        if (button) {
            button.classList.add('active');
        }
        
        if (viewName === 'chat') {
            setTimeout(() => {
                const input = document.getElementById('chat-input');
                if (input) input.focus();
            }, 0);
        } else if (viewName === 'meets') {
            setTimeout(() => {
                const input = document.getElementById('meets-chat-input');
                if (input) input.focus();
            }, 0);
        }
    }

    function sendChatMessage() {
        const message = chatInput.value.trim();
        if (!message) return;

        addMessage(message, 'user', chatMessages);
        chatInput.value = '';
        autoResizeTextarea(chatInput);

        ipcRenderer.send('gemini-prompt', {
            view: 'chat',
            prompt: message,
            sessionId: 'chat-session-' + Date.now()
        });
    }

    function sendMeetsChatMessage() {
        const message = meetsChatInput.value.trim();
        if (!message) return;
        
        addMessage(message, 'user', meetsChatContainer);
        meetsChatInput.value = '';
        autoResizeTextarea(meetsChatInput);
        
        ipcRenderer.send('gemini-prompt', { 
            view: 'meets',
            prompt: message,
            sessionId: 'meet-session-' + Date.now()
        });
    }

    // --- Helper Functions ---
    function addMessage(text, type, container, isMarkdown = false) {
        if (!container) {
            console.error('Cannot add message: Container is null or undefined');
            return;
        }
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}-message`;
        
        try {
            const timestamp = new Date().toLocaleTimeString();
            const timestampSpan = document.createElement('span');
            timestampSpan.className = 'message-timestamp';
            timestampSpan.textContent = `[${timestamp}] `;
            messageDiv.appendChild(timestampSpan);
            
            const contentSpan = document.createElement('span');
            contentSpan.className = 'message-content';
            
            if (isMarkdown) {
                contentSpan.innerHTML = renderMarkdown(text);
                addCopyButtons(contentSpan);
            } else {
                contentSpan.textContent = text;
            }
            
            messageDiv.appendChild(contentSpan);
            container.appendChild(messageDiv);
            
            container.scrollTop = container.scrollHeight;
            
            console.log(`Added ${type} message to ${container.id || 'unknown-container'}`);
        } catch (error) {
            console.error('Error adding message:', error);
            messageDiv.textContent = text;
            container.appendChild(messageDiv);
        }
    }

    function renderMarkdown(text) {
        if (typeof marked === 'undefined') return text;
        const html = marked.parse(text);
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        if (typeof hljs !== 'undefined') {
            tempDiv.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
        }
        return tempDiv.innerHTML;
    }

    function addCopyButtons(container) {
        container.querySelectorAll('pre').forEach(pre => {
            if (pre.querySelector('.copy-btn')) return;
            const copyBtn = document.createElement('button');
            copyBtn.className = 'copy-btn';
            copyBtn.textContent = 'Copy';
            copyBtn.addEventListener('click', () => {
                const code = pre.querySelector('code').innerText;
                navigator.clipboard.writeText(code).then(() => {
                    copyBtn.textContent = 'Copied!';
                    setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
                });
            });
            pre.appendChild(copyBtn);
        });
    }

    function autoResizeTextarea(textarea) {
        textarea.style.height = 'auto';
        textarea.style.height = `${textarea.scrollHeight}px`;
    }

    function updateApiKeyStatus(element, success, serviceName) {
        element.textContent = success ? `${serviceName} API key saved!` : `Failed to save ${serviceName} key.`;
        element.className = `status-message ${success ? 'success' : 'error'}`;
    }

    async function checkGeminiStatus() {
        const isReady = await ipcRenderer.invoke('get-gemini-status');
        updateApiKeyStatus(geminiApiKeyStatus, isReady, 'Gemini');
    }

    function handleDrag(e) {
        if (!isDragging) return;
        ipcRenderer.send('window-move', { x: e.screenX - offsetX, y: e.screenY - offsetY });
    }

    function stopDrag() {
        isDragging = false;
        document.removeEventListener('mousemove', handleDrag);
        document.removeEventListener('mouseup', stopDrag);
    }
});