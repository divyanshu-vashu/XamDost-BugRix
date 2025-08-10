const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const Store = require('electron-store');
const { meetPrompt } = require('./prompt');

// Centralized configuration for easier management
const config = {
  modelName: 'gemini-2.5-flash', // Using 1.5 flash for better performance and context
  maxRetries: 3,
  retryDelay: 1000,
  maxOutputTokens: 4096, // Increased token limit for comprehensive answers
  temperature: 0.7,
  topP: 0.95,
  topK: 40,
  safetySettings: [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  ],
};

const store = new Store();

class GeminiService {
  #genAI = null;
  #model = null;
  #chatSession = null;
  #isInitialized = false;
  #initializationPromise = null;

  constructor() {
    // Eagerly start the initialization process on instantiation
    this.initialize().catch(() => {
      // Error is logged within the initialize method, no need to handle here
    });
  }

  /**
   * Ensures the service is initialized, performing initialization if needed.
   * This method is safe to call multiple times.
   * @returns {Promise<boolean>} A promise that resolves to true if initialized successfully.
   */
  async initialize() {
    if (!this.#initializationPromise) {
      this.#initializationPromise = this._performInitialization();
    }
    return this.#initializationPromise;
  }

  /**
   * The core initialization logic. Do not call directly; use initialize().
   * @private
   */
  async _performInitialization() {
    try {
      const apiKey = store.get('geminiApiKey');
      if (!apiKey) {
        throw new Error('Gemini API key is not set. Please add it in the settings.');
      }

      console.log('Initializing Gemini service...');
      this.#genAI = new GoogleGenerativeAI(apiKey);
      this.#model = this.#genAI.getGenerativeModel({
        model: config.modelName,
        generationConfig: {
          maxOutputTokens: config.maxOutputTokens,
          temperature: config.temperature,
          topP: config.topP,
          topK: config.topK,
        },
        safetySettings: config.safetySettings,
        systemInstruction: {
            role: 'model',
            parts: [{ text: meetPrompt }],
        },
      });

      // Start a new chat session
      this.#chatSession = this.#model.startChat({
        history: [],
      });
      
      console.log('GeminiService: Chat session initialized successfully.');
      this.#isInitialized = true;
      return true;

    } catch (error) {
      console.error('GeminiService: Initialization failed:', error.message);
      // Reset promise to allow re-attempts
      this.#initializationPromise = null;
      this.#isInitialized = false;
      throw error; // Re-throw to propagate the failure
    }
  }

  /**
   * Updates the API key and re-initializes the service.
   * @param {string} apiKey - The new Gemini API key.
   * @returns {Promise<boolean>} True if re-initialization is successful.
   */
  async setApiKey(apiKey) {
    if (!apiKey || typeof apiKey !== 'string') {
        console.error('SetApiKey failed: Invalid API key provided.');
        return false;
    }
    store.set('geminiApiKey', apiKey);
    
    // Reset state to force re-initialization on next call
    this.#isInitialized = false;
    this.#initializationPromise = null;
    
    try {
        await this.initialize();
        console.log('GeminiService: API key updated and service re-initialized.');
        return true;
    } catch(error) {
        console.error(`GeminiService: Failed to re-initialize with new API key: ${error.message}`);
        return false;
    }
  }

  /**
   * Sends a prompt to the Gemini chat and returns the response text.
   * @param {string} prompt - The user's message.
   * @returns {Promise<string|null>} The AI's response text, or null if no response was generated.
   */
  async sendMessage(prompt) {
    await this.initialize();
    if (!this.#isInitialized || !this.#chatSession) {
      throw new Error('Gemini service is not initialized. Please check your API key and network connection.');
    }
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      throw new Error('Prompt cannot be empty.');
    }

    const messageId = `msg_${Date.now()}`;
    console.log(`[${messageId}] Sending to Gemini: "${prompt.substring(0, 100)}..."`);
    
    try {
      const apiCallFn = async () => {
        const result = await this.#chatSession.sendMessage(prompt);
        return result.response;
      };
      
      const response = await this._withRetry(apiCallFn, { taskName: `Gemini API call (${messageId})` });
      
      const text = this._parseResponse(response);

      if (!text) {
        console.log(`[${messageId}] Gemini returned no text content, likely by design (e.g., filler prompt).`);
        return null; // A valid, but empty, response.
      }
      
      console.log(`[${messageId}] Received Gemini response: "${text.substring(0, 100)}..."`);
      return text;

    } catch (error) {
        console.error(`[${messageId}] Failed to get response from Gemini:`, error);
        throw new Error(`Failed to get response from Gemini: ${error.message}`);
    }
  }

  /**
   * Safely parses the response object from the Gemini API.
   * @param {any} response - The `response` object from the API result.
   * @returns {string|null} The extracted text or null.
   * @private
   */
  _parseResponse(response) {
    if (!response) {
      console.warn('Parser received an undefined or null response object.');
      return null;
    }

    if (response.promptFeedback?.blockReason) {
      const { blockReason } = response.promptFeedback;
      console.warn(`Gemini prompt blocked due to ${blockReason}.`);
      throw new Error(`Your prompt was blocked as ${blockReason}. Please rephrase your request.`);
    }

    if (!response.candidates || response.candidates.length === 0) {
      console.warn('Gemini response contained no candidates.');
      return null;
    }

    const candidate = response.candidates[0];

    if (candidate.finishReason === 'SAFETY') {
      console.warn('Gemini response was blocked for safety reasons.');
      throw new Error('The response was blocked due to safety concerns. Please try a different prompt.');
    }

    if (candidate.finishReason !== 'STOP' && candidate.finishReason !== 'MAX_TOKENS') {
      console.warn(`Gemini response finished with unexpected reason: ${candidate.finishReason}`);
    }

    if (!candidate.content?.parts || candidate.content.parts.length === 0 || !candidate.content.parts[0].text) {
      console.log('Gemini response candidate did not contain any text content.');
      return null;
    }

    return candidate.content.parts.map(part => part.text).join('').trim();
  }

  /**
   * A wrapper to retry an async function with exponential backoff for transient errors.
   * @param {Function} fn - The async function to execute.
   * @param {object} options - Configuration for retries.
   * @private
   */
  async _withRetry(fn, { maxRetries = config.maxRetries, delay = config.retryDelay, taskName = 'Operation' } = {}) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (this._isRetryableError(error)) {
          if (attempt < maxRetries) {
            const waitTime = delay * Math.pow(2, attempt);
            console.warn(`${taskName} attempt ${attempt + 1} failed with a retryable error. Retrying in ${waitTime}ms...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }
        } else {
          console.error(`${taskName} failed with a non-retryable error:`, error.message);
          throw error;
        }
      }
    }
    console.error(`${taskName} failed after ${maxRetries} attempts.`);
    throw lastError;
  }
  
  /**
   * Determines if an error is transient and warrants a retry.
   * @param {Error} error - The error object.
   * @returns {boolean} True if the error is retryable.
   * @private
   */
  _isRetryableError(error) {
    const errorCode = error.status || error.code;
    const errorMessage = error.message?.toLowerCase() || '';

    if (errorCode === 429 || errorMessage.includes('rate limit') || errorMessage.includes('quota')) {
      return true;
    }
    if (errorCode >= 500 && errorCode < 600) {
      return true;
    }
    if (errorMessage.includes('network') || errorMessage.includes('fetch failed')) {
      return true;
    }

    return false;
  }

  /**
   * Clears the current conversation history by starting a new chat session.
   * @returns {Promise<boolean>} True if the conversation was cleared.
   */
  async clearConversation() {
    await this.initialize();
    if (!this.#isInitialized) {
      console.warn('Cannot clear conversation: Gemini service is not initialized.');
      return false;
    }
    
    console.log('Clearing Gemini chat conversation...');
    this.#chatSession = this.#model.startChat({ history: [] });
    console.log('Gemini chat conversation cleared.');
    return true;
  }

  /**
   * Gets the initialization status of the service.
   * @returns {boolean}
   */
  get isInitialized() {
      return this.#isInitialized;
  }
}


module.exports = new GeminiService();