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
        console.log('Starting transcription...');

        try {
            this.transcriber = this.assembly.streaming.transcriber({
                sampleRate: 16_000,
                // --- KEY CHANGE ---
                // We no longer need this, as the new model handles it.
                // end_utterance_silence_threshold: 700,
                formatTurns: true,
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

            // --- THE MAIN FIX ---
            // Listen for 'turn' events and check for the end of an utterance.
            this.transcriber.on('turn', async (turn) => {
                // For debugging, you can log every partial turn.
                // if (turn.transcript) {
                //     console.log("Partial Turn:", turn.transcript);
                // }

                // Process the turn only when it's considered complete.
                if (turn.end_of_turn && turn.transcript && turn.transcript.trim()) {
                    const transcriptText = turn.transcript.trim();
                    console.log(`[FINALIZED TURN]:`, transcriptText);
                    
                    try {
                        const response = await geminiService.sendMessage(transcriptText, { isMeet: true });
                        this.emit('transcript', {
                            message_type: 'FinalTranscript', // We keep this for consistency in the renderer
                            text: transcriptText,
                            response: response,
                            sessionId: this.sessionId,
                            timestamp: new Date().toISOString()
                        });
                        this.emit('status', 'transcript_processed');
                    } catch (error) {
                        console.error(`Error processing transcript with Gemini:`, error);
                        this.emit('error', {
                            message: 'Failed to process transcript with Gemini',
                            error: error.message,
                            timestamp: new Date().toISOString()
                        });
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
        if (!this.isListening && !this.recordingProcess && !this.transcriber) {
            return;
        }
        
        console.log(`Stopping transcription...`);
        this.isListening = false;

        if (this.recordingProcess) {
            this.recordingProcess.stop();
            this.recordingProcess = null;
        }

        if (this.transcriber && this.transcriber.status !== 'closed') {
            await this.transcriber.close();
            this.transcriber = null;
        }

        this.emit('status', 'idle');
        console.log(`Transcription service fully stopped`);
        
        this.emit('session_ended', { 
            sessionId: this.sessionId,
            timestamp: new Date().toISOString() 
        });
    }
}

module.exports = new MeetService();