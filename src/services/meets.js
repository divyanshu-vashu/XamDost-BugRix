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
        if (!this.assembly) {
            this.emit('error', 'AssemblyAI is not initialized.');
            return;
        }

        this.isListening = true;
        this.emit('status', 'connecting');
        console.log('Starting transcription using the example configuration...');

        try {
            this.transcriber = this.assembly.streaming.transcriber({
                sampleRate: 16_000,
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

            // This handles the transcript and sends it to your app's Gemini flow
            this.transcriber.on('transcript.final', async (turn) => {
                if (turn.text && turn.text.trim()) {
                    const transcriptText = turn.text.trim();
                    console.log(`[${new Date().toISOString()}] [Session ${this.sessionId}] Transcript:`, transcriptText);
                    
                    try {
                        // Get Gemini response for the transcript
                        const response = await geminiService.sendMessage(transcriptText, { isMeet: true });
                        
                        // Emit the transcript event to the main process
                        this.emit('transcript', {
                            message_type: 'FinalTranscript',
                            text: transcriptText,
                            response: response,
                            sessionId: this.sessionId,
                            timestamp: new Date().toISOString()
                        });
                        
                        // Also emit a status update
                        this.emit('status', 'transcript_processed');
                    } catch (error) {
                        console.error(`[${new Date().toISOString()}] Error processing transcript with Gemini:`, error);
                        this.emit('error', {
                            message: 'Failed to process transcript with Gemini',
                            error: error.message,
                            timestamp: new Date().toISOString()
                        });
                    }
                }
            });

            // --- Connect and Record ---
            console.log(`[${new Date().toISOString()}] Connecting to AssemblyAI...`);
            await this.transcriber.connect();
            console.log(`[${new Date().toISOString()}] Connected to AssemblyAI. Starting local recording...`);

            // Configure audio recording
            const recordConfig = {
                channels: 1,
                sampleRate: 16000,
                audioType: 'wav',
                verbose: true,
                threshold: 0.5, // Silence threshold
                silence: '1.0'  // Seconds of silence before ending
            };
            
            console.log(`[${new Date().toISOString()}] Starting audio recording with config:`, recordConfig);
            
            try {
                this.recordingProcess = recorder.record(recordConfig);
                console.log(`[${new Date().toISOString()}] Audio recording started successfully`);
            } catch (error) {
                console.error(`[${new Date().toISOString()}] Failed to start recording:`, error);
                throw new Error(`Failed to start recording: ${error.message}`);
            }
            
            if (!this.recordingProcess) {
                throw new Error("Failed to start recording. No recording process was created.");
            }

            // Handle recording stream errors
            const audioStream = this.recordingProcess.stream();
            audioStream.on('error', (err) => {
                console.error(`[${new Date().toISOString()}] Recording stream error:`, err);
                this.emit('error', `Recording stream error: ${err.message}`);
                this.stop().catch(console.error);
            });

            // Pipe audio to AssemblyAI
            console.log(`[${new Date().toISOString()}] Piping audio stream to AssemblyAI...`);
            try {
                const webStream = Readable.toWeb(audioStream);
                await webStream.pipeTo(this.transcriber.stream());
                console.log(`[${new Date().toISOString()}] Audio stream piping completed`);
            } catch (error) {
                console.error(`[${new Date().toISOString()}] Error piping audio stream:`, error);
                this.emit('error', `Stream piping error: ${error.message}`);
                await this.stop();
            }

        } catch (error) {
            console.error('Error in start method:', error);
            this.emit('error', `Start Error: ${error.message}`);
            this.stop();
        }
    }

    async stop() {
        if (!this.isListening && !this.recordingProcess && !this.transcriber) {
            console.log(`[${new Date().toISOString()}] No active transcription to stop`);
            return;
        }
        
        console.log(`[${new Date().toISOString()}] Stopping transcription...`);
        this.isListening = false;

        try {
            // Stop the recording process first
            if (this.recordingProcess) {
                console.log(`[${new Date().toISOString()}] Stopping audio recording...`);
                await new Promise((resolve) => {
                    this.recordingProcess.stop();
                    this.recordingProcess = null;
                    console.log(`[${new Date().toISOString()}] Audio recording stopped`);
                    resolve();
                });
            }
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error stopping recording:`, error);
        }

        try {
            // Then close the transcriber connection
            if (this.transcriber) {
                console.log(`[${new Date().toISOString()}] Closing transcriber connection...`);
                await this.transcriber.close();
                this.transcriber = null;
                console.log(`[${new Date().toISOString()}] Transcriber connection closed`);
            }
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error closing transcriber:`, error);
        }

        this.emit('status', 'idle');
        console.log(`[${new Date().toISOString()}] Transcription service fully stopped`);
        
        // Emit session end event
        this.emit('session_ended', { 
            sessionId: this.sessionId,
            timestamp: new Date().toISOString() 
        });
    }
}

module.exports = MeetService;