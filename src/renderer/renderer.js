const { ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const titleBar = document.querySelector('.title-bar');

    // View Buttons
    const settingsBtn = document.getElementById('settings-btn');
    const meetsBtn = document.getElementById('meets-btn');

    // Views
    const settingsView = document.getElementById('settings-view');
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
    
    // Listen for Gemini responses
    ipcRenderer.on('gemini-response', (event, { response, error, view, messageId }) => {
        if (view !== 'meets') return;
        
        console.log('Gemini response received in renderer:', {
            messageId,
            hasResponse: !!response,
            responseType: typeof response,
            preview: response ? String(response).substring(0, 100) + '...' : 'empty'
        });
        
        // Remove typing indicator
        const typingIndicator = document.querySelector('.typing-indicator');
        if (typingIndicator && typingIndicator.parentElement) {
            typingIndicator.parentElement.remove();
        }
        
        try {
            if (error) {
                console.error('Error from Gemini:', error);
                addMessage(`Error: ${error.message || 'Unknown error'}`, 'error', meetsChatContainer);
            } else if (response) {
                // Ensure response is a string
                const responseText = typeof response === 'string' ? response : JSON.stringify(response);
                console.log('Adding message to chat:', { length: responseText.length, preview: responseText.substring(0, 50) });
                addMessage(responseText, 'ai', meetsChatContainer, true);
            } else {
                console.error('Empty response from Gemini');
                addMessage('Error: Received empty response from Gemini', 'error', meetsChatContainer);
            }
        } catch (err) {
            console.error('Error processing Gemini response:', err);
            addMessage(`Error displaying response: ${err.message}`, 'error', meetsChatContainer);
        }
        
        // Ensure scroll to bottom
        meetsChatContainer.scrollTop = meetsChatContainer.scrollHeight;
    });
    
    // Set up initial view
    document.addEventListener('DOMContentLoaded', () => {
        // Show meets view by default
        switchView('meets');
        
        // Initialize API key status
        checkGeminiStatus();
    });

    // Meet Controls
    meetStartButton.addEventListener('click', () => {
        ipcRenderer.send('start-meet');
    });

    meetStopButton.addEventListener('click', () => {
        ipcRenderer.send('stop-meet');
    });

    // View Switching
    settingsBtn.addEventListener('click', () => switchView('settings'));
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

    // Meets Chat
    function sendMeetsChatMessage() {
        const message = meetsChatInput.value.trim();
        if (!message) return;
        
        try {
            // Add user message to chat
            addMessage(message, 'user', meetsChatContainer);
            
            // Clear input and reset height
            meetsChatInput.value = '';
            meetsChatInput.style.height = 'auto';
            
            // Generate a unique ID for this message chain
            const messageId = Date.now().toString();
            
            // Show typing indicator
            const typingIndicator = document.createElement('div');
            typingIndicator.className = 'typing-indicator';
            typingIndicator.id = `typing-${messageId}`;
            typingIndicator.innerHTML = `
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            `;
            
            const messageElement = document.createElement('div');
            messageElement.className = 'message ai-message';
            messageElement.id = `message-${messageId}`;
            messageElement.appendChild(typingIndicator);
            meetsChatContainer.appendChild(messageElement);
            meetsChatContainer.scrollTop = meetsChatContainer.scrollHeight;
            
            // Send message to main process
            ipcRenderer.send('gemini-prompt', {
                prompt: message,
                view: 'meets',
                messageId: messageId
            });
            
            // Set a timeout to show a message if the response takes too long
            const timeoutId = setTimeout(() => {
                const indicator = document.getElementById(`typing-${messageId}`);
                if (indicator && !indicator.querySelector('.typing-timeout')) {
                    const timeoutMsg = document.createElement('div');
                    timeoutMsg.className = 'typing-timeout';
                    timeoutMsg.textContent = 'Getting response...';
                    indicator.appendChild(timeoutMsg);
                }
            }, 5000); // Show after 5 seconds
            
            // Clean up timeout when response is received
            const cleanup = () => {
                clearTimeout(timeoutId);
                ipcRenderer.off(`gemini-response-${messageId}`, cleanup);
            };
            
            ipcRenderer.once(`gemini-response-${messageId}`, cleanup);
            
        } catch (error) {
            console.error('Error sending message:', error);
            addMessage('Failed to send message. Please try again.', 'error', meetsChatContainer);
        }
    }

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
    
    // Handle Gemini responses for meet view
    ipcRenderer.on('gemini-response', (event, { view, response, error, sessionId }) => {
        try {
            console.log(`[RENDERER] Received Gemini response payload:`, { view, response, error, sessionId });

            if (view !== 'meets') {
                console.warn(`[RENDERER] Ignoring response for unsupported view: ${view}`);
                return;
            }

            if (error) {
                console.error('[RENDERER] Gemini API Error:', error);
                addMessage(`Error: ${response || 'Failed to get response from Gemini'}`, 'error', meetsChatContainer);
                return;
            }

            if (!response) {
                console.warn('[RENDERER] Empty response from Gemini');
                addMessage('Received an empty response from Gemini.', 'ai', meetsChatContainer);
                return;
            }

            console.log(`[RENDERER] Adding AI response to meets chat`);
            addMessage(response, 'ai', meetsChatContainer, true);

        } catch (e) {
            console.error('[RENDERER] Fatal error in gemini-response handler:', e);
            addMessage(`Error displaying response: ${e.message}`, 'error', meetsChatContainer);
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
        // Hide all views
        document.querySelectorAll('.view').forEach(view => {
            view.style.display = 'none';
        });

        // Remove active class from all buttons
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.remove('active');
        });

        // Show selected view and set active button
        switch (viewName) {
            case 'settings':
                settingsView.style.display = 'block';
                settingsBtn.classList.add('active');
                document.title = 'BugRix - Settings';
                break;
            case 'meets':
                meetsView.style.display = 'flex';
                meetsBtn.classList.add('active');
                document.title = 'BugRix - Meets';
                // Focus the meets chat input when switching to meets view
                if (meetsChatInput) {
                    setTimeout(() => meetsChatInput.focus(), 100);
                }
                break;
        }
    }

    function addMessage(text, type, container, isMarkdown = false) {
        console.log(`addMessage called:`, { 
            type, 
            textLength: text?.length,
            textPreview: text ? String(text).substring(0, 50) + '...' : 'undefined',
            isMarkdown,
            containerId: container?.id
        });

        if (!container) {
            console.error('Cannot add message: Container is null or undefined');
            return null;
        }
        
        // Ensure text is a non-empty string
        if (text === null || text === undefined) {
            console.warn('Received null/undefined text, converting to empty string');
            text = '';
        } else if (typeof text !== 'string') {
            console.warn('Received non-string text, converting to string:', text);
            text = String(text);
        }
        
        // Create message container
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}-message`;
        
        try {
            // Add timestamp
            const timestamp = new Date().toLocaleTimeString();
            const timestampSpan = document.createElement('span');
            timestampSpan.className = 'message-timestamp';
            timestampSpan.textContent = `[${timestamp}] `;
            messageDiv.appendChild(timestampSpan);
            
            // Create content container
            const contentSpan = document.createElement('div');
            contentSpan.className = 'message-content';
            
            // Check if this looks like a code block or markdown
            const isLikelyCode = text.trim().startsWith('```') || 
                               (text.includes('\n') && text.trim().length > 0) || 
                               (text.includes('  ') && text.trim().length > 0) ||
                               (text.includes('{') && text.includes('}')) ||
                               (text.includes('(') && text.includes(')') && text.includes(';'));
            
            // Always try to render as markdown if it's from AI or explicitly requested
            if (isMarkdown || type === 'ai' || isLikelyCode) {
                console.log('Rendering as markdown');
                const rendered = renderMarkdown(text);
                console.log('Rendered content:', { 
                    originalLength: text.length, 
                    renderedLength: rendered.length,
                    preview: rendered.substring(0, 100) + '...'
                });
                contentSpan.innerHTML = rendered || '[Empty response]';
                addCopyButtons(contentSpan);
            } else {
                console.log('Rendering as plain text');
                // For plain text, preserve line breaks and basic formatting
                const formattedText = text
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/\n/g, '<br>');
                contentSpan.innerHTML = formattedText || '[Empty message]';
            }
            
            // Add to DOM
            messageDiv.appendChild(contentSpan);
            container.appendChild(messageDiv);
            
            // Scroll to bottom and ensure message is visible
            container.scrollTop = container.scrollHeight;
            messageDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            
            console.log(`Successfully added ${type} message (${text.length} chars) to ${container.id || 'unknown-container'}`);
            
        } catch (error) {
            console.error('Error adding message:', error);
            // Fallback to simple text display
            messageDiv.textContent = `[Error displaying message: ${error.message}]\n${text || '[No message content]'}`;
            container.appendChild(messageDiv);
        }
        
        return messageDiv;
    }

    function renderMarkdown(text) {
        if (!text) return '';
    
        // Ensure the 'marked' library is available
        if (typeof marked === 'undefined') {
            console.warn('marked.js is not available. Rendering as plain text.');
            // Fallback to simple text with line breaks
            return text.replace(/&/g, '&amp;')
                       .replace(/</g, '&lt;')
                       .replace(/>/g, '&gt;')
                       .replace(/\n/g, '<br>');
        }
    
        try {
            // Configure marked to use highlight.js for syntax highlighting
            marked.setOptions({
                highlight: function(code, lang) {
                    // Check if highlight.js and the language are available
                    if (typeof hljs !== 'undefined') {
                        const language = hljs.getLanguage(lang) ? lang : 'plaintext';
                        try {
                            // Return the highlighted code
                            return hljs.highlight(code, { language, ignoreIllegals: true }).value;
                        } catch (e) {
                            // Fallback to auto-detection on error
                            return hljs.highlightAuto(code).value;
                        }
                    }
                    // If hljs is not available, return the code un-highlighted but escaped
                    return code;
                },
                breaks: true, // Render line breaks as <br>
                gfm: true     // Enable GitHub Flavored Markdown
            });
    
            // Let marked.js parse the entire text. It will correctly identify and
            // process paragraphs, lists, and code blocks according to markdown rules.
            const html = marked.parse(text);

            // Marked's highlight callback should handle all cases, but as a safety net,
            // we can manually highlight any code blocks that might have been missed.
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html;
            if (typeof hljs !== 'undefined') {
                tempDiv.querySelectorAll('pre code:not(.hljs)').forEach(block => {
                    hljs.highlightElement(block);
                });
            }

            return tempDiv.innerHTML;
    
        } catch (error) {
            console.error('Error rendering markdown:', error);
            // In case of a parsing error, fallback to displaying the raw text safely
            return `<pre><code>${text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`;
        }
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