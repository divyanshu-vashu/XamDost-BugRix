const { GoogleGenerativeAI } = require('@google/generative-ai');
const Store = require('electron-store');
const store = new Store();
const { meetPrompt } = require('./prompt');

class GeminiService {
  constructor() {
    this.chat = null;
    this.meetChat = null;
    this.genAI = null;
    this.model = null;
    this.isInitialized = false;
    // Start initialization immediately and store the promise.
    // Methods that depend on initialization will await this promise.
    this.initializationPromise = this.initializeAI();
  }

  async initializeAI() {
    const apiKey = store.get('geminiApiKey');
    if (!apiKey) {
      this.isInitialized = false;
      console.log('GeminiService: No API key found.');
      return; // Initialization is "complete" but service is not ready.
    }

    try {
      this.genAI = new GoogleGenerativeAI(apiKey);
      this.model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      
      // Initialize both chat types
      this.initializeChat();
      await this.initializeMeetChat(); // This is async and must be awaited

      this.isInitialized = true;
      console.log('GeminiService: Successfully initialized.');
    } catch (error) {
      console.error('Error initializing Gemini:', error);
      this.isInitialized = false;
      // Throwing error here will cause initializationPromise to reject,
      // which is correct behavior.
      throw error;
    }
  }

  initializeChat() {
    if (!this.model) throw new Error('Gemini model not available for chat initialization.');
    try {
      this.chat = this.model.startChat({
        history: [],
        generationConfig: {
          maxOutputTokens: 1000,
        },
      });
      console.log('GeminiService: Regular chat initialized.');
    } catch (error) {
      console.error('Error initializing chat:', error);
      throw error;
    }
  }

  async initializeMeetChat() {
    if (!this.model) throw new Error('Gemini model not available for meet chat initialization.');
    try {
      this.meetChat = this.model.startChat({
        history: [],
        generationConfig: {
          maxOutputTokens: 1000,
        },
      });
      
      // Send the system prompt to set the context for the meet chat
      await this.meetChat.sendMessage(meetPrompt);
      console.log('GeminiService: Meet chat initialized with system prompt.');
    } catch (error) {
      console.error('Error initializing meet chat:', error);
      throw error;
    }
  }
  
  async setApiKey(apiKey) {
    store.set('geminiApiKey', apiKey);
    
    // Re-initialize and replace the initialization promise.
    // Subsequent calls will wait on this new promise.
    this.initializationPromise = this.initializeAI();

    try {
      await this.initializationPromise;
      return true; // Return true on successful initialization
    } catch (error) {
      // The error is already logged in initializeAI
      return false; // Return false on failure
    }
  }

  async sendMessage(message, options = {}) {
    // Wait for any ongoing initialization to complete.
    await this.initializationPromise;

    if (!this.isInitialized) {
      throw new Error('Gemini AI is not initialized. Please set a valid API key.');
    }

    const { isMeet = false } = options;
    const chatInstance = isMeet ? this.meetChat : this.chat;

    if (!chatInstance) {
      throw new Error(isMeet ? 'Meet chat is not initialized' : 'Chat is not initialized');
    }

    try {
      const result = await chatInstance.sendMessage(message);
      const response = await result.response;
      const text = response.text();
      return text;
    } catch (error) {
      console.error(`Error sending message to Gemini ${isMeet ? 'meet' : 'chat'}:`, error);
      throw error;
    }
  }

  async clearConversation(options = {}) {
    // Wait for initialization to be sure the model is available.
    await this.initializationPromise;

    if (!this.isInitialized) return;

    const { isMeet = false } = options;
    
    try {
      if (isMeet) {
        await this.initializeMeetChat();
      } else {
        this.initializeChat();
      }
    } catch (error) {
      console.error(`Error clearing ${isMeet ? 'meet' : 'chat'} conversation:`, error);
      throw error;
    }
  }
}

module.exports = new GeminiService();