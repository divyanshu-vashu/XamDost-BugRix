const { GoogleGenerativeAI } = require('@google/generative-ai');
const Store = require('electron-store');

const store = new Store();

class GeminiService {
  constructor() {
    this.chat = null;
    this.initializeAI();
  }

  initializeAI() {
    const apiKey = store.get('geminiApiKey');
    if (apiKey) {
      try {
        this.genAI = new GoogleGenerativeAI(apiKey);
        this.model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        this.chat = this.model.startChat({
          history: [],
          generationConfig: {
            maxOutputTokens: 1000,
          },
        });
        this.isInitialized = true;
      } catch (error) {
        console.error('Error initializing Gemini:', error);
        this.isInitialized = false;
      }
    } else {
      this.isInitialized = false;
    }
  }

  setApiKey(apiKey) {
    store.set('geminiApiKey', apiKey);
    this.initializeAI();
    return this.isInitialized;
  }

  async sendMessage(message) {
    if (!this.isInitialized || !this.chat) {
      throw new Error('Gemini AI is not initialized. Please set a valid API key.');
    }

    try {
      const result = await this.chat.sendMessage(message);
      const response = await result.response;
      const text = response.text();
      return text;
    } catch (error) {
      console.error('Error sending message to Gemini:', error);
      throw error;
    }
  }

  clearConversation() {
    if (this.isInitialized) {
      this.chat = this.model.startChat({
        history: [],
        generationConfig: {
          maxOutputTokens: 1000,
        },
      });
    }
  }
}

module.exports = new GeminiService();
