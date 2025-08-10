
// src/services/meets.js

const { AssemblyAI } = require('assemblyai');
const recorder = require('node-record-lpcm16');
const { Readable } = require('stream');
const { v4: uuidv4 } = require('uuid');
const Store = require('electron-store');
const EventEmitter = require('events');
const geminiService = require('./gemini');

const store = new Store();

class MeetService extends EventEmitter {
    constructor() {
        super();
        this.assembly = null;
        this.transcriber = null;
        this.recordingProcess = null;
        this.isListening = false;
        this.sessionId = null;
    }

    init(apiKey) {
        if (!apiKey) {
            this.emit('error', 'AssemblyAI API key is not set.');
            return false;
        }
        try {
            this.assembly = new AssemblyAI({ apiKey });
            console.log('MeetService initialized with AssemblyAI key.');
            return true;
        } catch (error) {
            this.emit('error', `Failed to initialize AssemblyAI: ${error.message}`);
            return false;
        }
    }

    async start() {
        if (this.isListening) {
            console.log('Already listening.');
            return;
        }
        
        // Reset session ID for new session
        this.sessionId = `session_${Date.now()}`;
        
        if (!this.assembly) {
            const error = new Error('AssemblyAI is not initialized');
            this.emit('error', error.message);
            throw error;
        }
        
        // Reset any existing state
        this.isListening = true;
        this.emit('status', 'connecting');
        console.log(`[${this.sessionId}] Starting transcription...`);
        
        // Initialize Gemini service if not already done
        try {
            // FIX: Changed from initializeAI() to the new initialize() method
            await geminiService.initialize();
        } catch (error) {
            const errMsg = `Failed to initialize Gemini: ${error.message}`;
            console.error(errMsg, error);
            this.emit('error', errMsg);
            this.isListening = false;
            this.emit('status', 'error');
            throw new Error(errMsg);
        }

        try {
            this.transcriber = this.assembly.streaming.transcriber({
                sampleRate: 16_000,
                formatTurns: true,
                end_utterance_silence_threshold: 1050
            });

            // --- Event Handlers ---
            this.transcriber.on('open', ({ sessionId }) => {
                this.sessionId = sessionId || uuidv4();
                console.log(`Session opened with ID: ${this.sessionId}`);
                this.emit('status', 'listening');
            });

            this.transcriber.on('error', (error) => {
                console.error('Transcriber Error:', error);
                this.emit('error', error.message);
                this.stop();
            });

            this.transcriber.on('close', (code, reason) => {
                console.log('Session closed:', code, reason);
                this.emit('status', 'idle');
            });

            // Listen for 'turn' events and check for the end of an utterance
            this.transcriber.on('turn', async (turn) => {
                // Skip if not a complete turn or no transcript
                if (!turn.end_of_turn || !turn.turn_is_formatted || !turn.transcript?.trim()) {
                    return;
                }

                const transcriptText = turn.transcript.trim();
                console.log(`[FINALIZED TURN]: ${transcriptText.substring(0, 100)}${transcriptText.length > 100 ? '...' : ''}`);
                
                // Emit that we're processing the transcript
                this.emit('status', 'processing_transcript');
                
                try {
                    // Process with Gemini
                    const response = await geminiService.sendMessage(transcriptText);
                    
                    // The new geminiService returns null for empty responses, handle this case gracefully.
                    if (response === null) {
                        console.log('Gemini chose not to respond to the transcript. No action taken.');
                        // We can either do nothing or send a specific status. Let's do nothing to keep the UI clean.
                        return;
                    }
                    
                    // Emit the successful response
                    const transcriptData = {
                        message_type: 'FinalTranscript',
                        text: transcriptText,
                        response: response,
                        sessionId: this.sessionId,
                        timestamp: new Date().toISOString()
                    };
                    
                    this.emit('transcript', transcriptData);
                    this.emit('status', 'transcript_processed');
                    
                } catch (error) {
                    console.error('Error processing transcript with Gemini:', error);
                    
                    // Format error response
                    const errorMessage = error.message || 'Unknown error occurred';
                    const errorData = {
                        message: 'Failed to process transcript with Gemini',
                        error: errorMessage,
                        timestamp: new Date().toISOString(),
                        sessionId: this.sessionId,
                        isGeminiError: true
                    };
                    
                    // Emit error event
                    this.emit('error', errorData);
                    
                    // Also emit a transcript event with error info for the UI
                    this.emit('transcript', {
                        message_type: 'Error',
                        text: transcriptText,
                        response: `Error: ${errorMessage}`,
                        sessionId: this.sessionId,
                        timestamp: new Date().toISOString(),
                        isError: true
                    });
                } finally {
                    // Always ensure we're back to listening state after processing
                    if (this.isListening) {
                        this.emit('status', 'listening');
                    }
                }
            });

            await this.transcriber.connect();
            console.log(`Connected to AssemblyAI. Starting local recording...`);

            const recordConfig = {
                channels: 1,
                sampleRate: 16000,
                audioType: 'wav',
                verbose: false, // Can be set to false now
            };
            
            this.recordingProcess = recorder.record(recordConfig);

            const audioStream = this.recordingProcess.stream();
            audioStream.on('error', (err) => {
                console.error(`Recording stream error:`, err);
                this.emit('error', `Recording stream error: ${err.message}`);
                this.stop().catch(console.error);
            });

            console.log(`Piping audio stream to AssemblyAI...`);
            const webStream = Readable.toWeb(audioStream);
            webStream.pipeTo(this.transcriber.stream())
                .then(() => console.log('Piping finished.'))
                .catch(async (error) => {
                    console.error(`Error piping audio stream:`, error);
                    this.emit('error', `Stream piping error: ${error.message}`);
                    await this.stop();
                });

        } catch (error) {
            console.error('Error in start method:', error);
            this.emit('error', `Start Error: ${error.message}`);
            this.stop();
        }
    }

    async stop() {
        // If already stopped, do nothing
        if (!this.isListening && !this.recordingProcess && !this.transcriber) {
            return;
        }
        
        const sessionId = this.sessionId || 'unknown_session';
        console.log(`[${sessionId}] Stopping transcription service...`);
        
        // Update state immediately to prevent new processing
        this.isListening = false;
        
        // Stop recording first
        if (this.recordingProcess) {
            try {
                this.recordingProcess.stop();
                console.log(`[${sessionId}] Audio recording stopped`);
            } catch (error) {
                console.error(`[${sessionId}] Error stopping recording:`, error);
                this.emit('error', `Error stopping recording: ${error.message}`);
            } finally {
                this.recordingProcess = null;
            }
        }
        
        // Close the transcriber
        if (this.transcriber && this.transcriber.status !== 'closed') {
            try {
                await this.transcriber.close();
                console.log(`[${sessionId}] Transcriber connection closed`);
            } catch (error)
{
                console.error(`[${sessionId}] Error closing transcriber:`, error);
                this.emit('error', `Error closing transcriber: ${error.message}`);
            } finally {
                this.transcriber = null;
            }
        }
        
        // Clear any pending operations
        if (this.sessionTimeout) {
            clearTimeout(this.sessionTimeout);
            this.sessionTimeout = null;
        }
        
        // Emit final status
        this.emit('status', 'idle');
        console.log(`[${sessionId}] Transcription service fully stopped`);
        
        // Emit session ended event
        this.emit('session_ended', { 
            sessionId: sessionId,
            timestamp: new Date().toISOString(),
            endedAt: new Date().toISOString()
        });
    }
}

module.exports = new MeetService();