// ============================================
// Elsah AI - Provider-Agnostic AI Service
// ============================================
//
// Architecture:
//   - Single AIProvider interface for all LLM providers
//   - Adapters for Gemini, Mistral, Groq, and OpenRouter
//   - Automatic fallback on failure or rate limits
//   - Environment-based configuration
//   - Extensible: add new providers without changing app code
//
// Base URLs:
//   - Gemini:   https://generativelanguage.googleapis.com/v1beta
//   - Mistral:  https://api.mistral.ai/v1
//   - Groq:     https://api.groq.com/openai/v1
//   - OpenRouter: https://openrouter.ai/api/v1
//
// Usage:
//   import { AIRouter } from './router';
//   const router = new AIRouter();
//   const response = await router.chat({ message: "Hello" });
//
// ============================================

// ============================================
// 1. TYPE DEFINITIONS
// ============================================

/**
 * Request options for AI chat completion
 */
export interface ChatOptions {
  message: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  history?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  stream?: boolean;
}

/**
 * Response from AI provider
 */
export interface ChatResponse {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  provider: string;
  model: string;
}

/**
 * Streaming chunk from AI provider
 */
export interface StreamChunk {
  chunk: string;
  done: boolean;
}

/**
 * Embedding response
 */
export interface EmbeddingResponse {
  embedding: number[];
  dimensions: number;
}

// ============================================
// 2. CUSTOM ERRORS
// ============================================

/**
 * Base AI error class
 */
export class AIError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly statusCode?: number,
    public readonly isRateLimit: boolean = false,
    public readonly isRetryable: boolean = false
  ) {
    super(message);
    this.name = 'AIError';
  }
}

/**
 * Rate limit error
 */
export class RateLimitError extends AIError {
  constructor(provider: string, retryAfter?: number) {
    super(
      `Rate limit exceeded for ${provider}` + (retryAfter ? `, retry after ${retryAfter}s` : ''),
      provider,
      429,
      true,
      true
    );
    this.name = 'RateLimitError';
  }
}

/**
 * Provider unavailable error
 */
export class ProviderUnavailableError extends AIError {
  constructor(provider: string, underlyingError: Error) {
    super(
      `Provider ${provider} is unavailable: ${underlyingError.message}`,
      provider,
      undefined,
      false,
      true
    );
    this.name = 'ProviderUnavailableError';
    this.stack = underlyingError.stack;
  }
}

/**
 * No providers available error
 */
export class NoProvidersError extends Error {
  constructor(triedProviders: string[]) {
    super(`All providers failed. Tried: ${triedProviders.join(', ')}`);
    this.name = 'NoProvidersError';
  }
}

// ============================================
// 3. PROVIDER CONFIGURATION
// ============================================

/**
 * Provider types
 */
export type ProviderType = 'gemini' | 'mistral' | 'groq' | 'openrouter';

/**
 * Configuration for a single AI provider
 */
export interface ProviderConfig {
  name: string;
  type: ProviderType;
  apiKey: string;
  baseUrl?: string;
  priority: number; // Lower = higher priority
  isActive: boolean;
  models: {
    default: string;
    available: string[];
  };
  timeout?: number; // Request timeout in ms
}

/**
 * Full configuration for AI service
 */
export interface AIConfig {
  providers: ProviderConfig[];
  defaultOptions: {
    temperature: number;
    maxTokens: number;
    timeout: number;
  };
}

/**
 * Base URLs for each provider
 */
export const PROVIDER_BASE_URLS: Record<ProviderType, string> = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  mistral: 'https://api.mistral.ai/v1',
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
};

/**
 * Load configuration from environment variables
 */
export function loadConfig(): AIConfig {
  const geminiKey = process.env.GEMINI_API_KEY;
  const mistralKey = process.env.MISTRAL_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;

  if (!geminiKey && !mistralKey && !groqKey && !openrouterKey) {
    throw new Error('At least one AI provider API key must be configured');
  }

  const providers: ProviderConfig[] = [];

  if (geminiKey) {
    providers.push({
      name: 'gemini',
      type: 'gemini',
      apiKey: geminiKey,
      baseUrl: PROVIDER_BASE_URLS.gemini,
      priority: 10,
      isActive: true,
      models: {
        default: 'gemini-2.0-flash',
        available: ['gemini-2.0-flash', 'gemini-2.0-pro', 'gemini-1.5-flash', 'gemini-1.5-pro'],
      },
      timeout: 30000,
    });
  }

  if (mistralKey) {
    providers.push({
      name: 'mistral',
      type: 'mistral',
      apiKey: mistralKey,
      baseUrl: PROVIDER_BASE_URLS.mistral,
      priority: 20,
      isActive: true,
      models: {
        default: 'mistral-large-latest',
        available: ['mistral-large-latest', 'mistral-small-latest', 'mistral-tiny-latest'],
      },
      timeout: 60000,
    });
  }

  if (groqKey) {
    providers.push({
      name: 'groq',
      type: 'groq',
      apiKey: groqKey,
      baseUrl: PROVIDER_BASE_URLS.groq,
      priority: 30,
      isActive: true,
      models: {
        default: 'llama-3.1-70b-versatile',
        available: ['llama-3.1-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
      },
      timeout: 60000,
    });
  }

  if (openrouterKey) {
    providers.push({
      name: 'openrouter',
      type: 'openrouter',
      apiKey: openrouterKey,
      baseUrl: PROVIDER_BASE_URLS.openrouter,
      priority: 40,
      isActive: true,
      models: {
        default: 'openai/gpt-4o-mini',
        available: ['openai/gpt-4o-mini', 'openai/gpt-4o', 'anthropic/claude-3-haiku', 'mistralai/mistral-7b'],
      },
      timeout: 60000,
    });
  }

  return {
    providers,
    defaultOptions: {
      temperature: 0.7,
      maxTokens: 4096,
      timeout: 30000,
    },
  };
}

// ============================================
// 4. BASE PROVIDER INTERFACE
// ============================================

/**
 * Abstract base class for AI providers
 * All providers must implement this interface
 */
export abstract class AIProvider {
  abstract readonly name: string;
  abstract readonly type: ProviderType;
  abstract readonly config: ProviderConfig;

  /**
   * Send a chat message and get a response
   */
  abstract chat(options: ChatOptions): Promise<ChatResponse>;

  /**
   * Stream a chat response
   */
  abstract stream(options: ChatOptions): AsyncIterable<StreamChunk>;

  /**
   * Generate embeddings for text
   */
  abstract embed(text: string): Promise<EmbeddingResponse>;

  /**
   * Check if provider is healthy
   */
  abstract healthCheck(): Promise<boolean>;

  /**
   * Factory method to create provider instances
   */
  static create(config: ProviderConfig): AIProvider {
    switch (config.type) {
      case 'gemini':
        return new GeminiProvider(config);
      case 'mistral':
        return new MistralProvider(config);
      case 'groq':
        return new GroqProvider(config);
      case 'openrouter':
        return new OpenRouterProvider(config);
      default:
        throw new Error(`Unknown provider type: ${config.type}`);
    }
  }
}

// ============================================
// 5. GEMINI PROVIDER
// ============================================

import { GoogleGenerativeAI, type Content, type GenerationConfig } from '@google/generative-ai';

export class GeminiProvider extends AIProvider {
  readonly name = this.config.name;
  readonly type = 'gemini' as const;
  private client: GoogleGenerativeAI;

  constructor(config: ProviderConfig) {
    super();
    this.config = config;
    this.client = new GoogleGenerativeAI(config.apiKey);
  }

  async chat(options: ChatOptions): Promise<ChatResponse> {
    const model = this.client.getGenerativeModel({
      model: options.model || this.config.models.default,
      generationConfig: this.buildGenerationConfig(options),
    });

    const chat = model.startChat({
      history: this.convertHistory(options.history || []),
    });

    try {
      const result = await chat.sendMessage(options.message);

      return {
        content: result.response.text(),
        usage: {
          inputTokens: result.response.usageMetadata?.promptTokenCount || 0,
          outputTokens: result.response.usageMetadata?.candidatesTokenCount || 0,
        },
        provider: this.name,
        model: options.model || this.config.models.default,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  async *stream(options: ChatOptions): AsyncIterable<StreamChunk> {
    const model = this.client.getGenerativeModel({
      model: options.model || this.config.models.default,
      generationConfig: this.buildGenerationConfig(options),
    });

    const chat = model.startChat({
      history: this.convertHistory(options.history || []),
    });

    try {
      const result = await chat.sendMessageStream(options.message);

      for await (const chunk of result.stream) {
        const text = chunk.text();
        yield {
          chunk: text,
          done: false,
        };
      }

      yield {
        chunk: '',
        done: true,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  async embed(text: string): Promise<EmbeddingResponse> {
    const model = this.client.getGenerativeModel({
      model: 'text-embedding-3-small',
    });

    const result = await model.embedContent(text);

    return {
      embedding: result.embedding.values,
      dimensions: result.embedding.values.length,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.chat({ message: 'ping', maxTokens: 1 });
      return true;
    } catch {
      return false;
    }
  }

  private buildGenerationConfig(options: ChatOptions): GenerationConfig {
    return {
      temperature: options.temperature ?? 0.7,
      maxOutputTokens: options.maxTokens ?? 4096,
    };
  }

  private convertHistory(
    history: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  ): Content[] {
    return history.map((msg) => ({
      role: msg.role === 'system' ? 'user' : msg.role,
      parts: [{ text: msg.content }],
    }));
  }

  private handleError(error: unknown): never {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      if (message.includes('rate limit') || message.includes('quota exceeded')) {
        throw new RateLimitError(this.name);
      }

      if (message.includes('429') || message.includes('too many requests')) {
        throw new RateLimitError(this.name);
      }

      if (message.includes('network') || message.includes('fetch') || message.includes('timeout')) {
        throw new ProviderUnavailableError(this.name, error);
      }
    }

    throw new ProviderUnavailableError(this.name, error as Error);
  }
}

// ============================================
// 6. MISTRAL PROVIDER
// ============================================

/**
 * Mistral API request types
 */
interface MistralChatRequest {
  model: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

interface MistralChatResponse {
  output: {
    choices: Array<{
      message: { role: string; content: string };
    }>;
    usage: { prompt_tokens: number; total_tokens: number };
  };
}

interface MistralEmbeddingRequest {
  model: string;
  input: string;
}

interface MistralEmbeddingResponse {
  output: number[];
}

export class MistralProvider extends AIProvider {
  readonly name = this.config.name;
  readonly type = 'mistral' as const;
  private baseUrl: string;

  constructor(config: ProviderConfig) {
    super();
    this.config = config;
    this.baseUrl = config.baseUrl || PROVIDER_BASE_URLS.mistral;
  }

  async chat(options: ChatOptions): Promise<ChatResponse> {
    const request: MistralChatRequest = {
      model: options.model || this.config.models.default,
      messages: this.convertHistory(options.history || []),
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      stream: false,
    };

    try {
      const response = await this.fetchMistral<MistralChatResponse>('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      const choice = response.output.choices[0];
      if (!choice?.message?.content) {
        throw new Error('No content in response');
      }

      return {
        content: choice.message.content,
        usage: {
          inputTokens: response.output.usage.prompt_tokens,
          outputTokens: response.output.usage.total_tokens - response.output.usage.prompt_tokens,
        },
        provider: this.name,
        model: options.model || this.config.models.default,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  async *stream(options: ChatOptions): AsyncIterable<StreamChunk> {
    const request: MistralChatRequest = {
      model: options.model || this.config.models.default,
      messages: this.convertHistory(options.history || []),
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      stream: true,
    };

    try {
      const response = await fetch(`${this.baseUrl}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        this.handleErrorResponse(response);
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        // Mistral streams JSON lines
        const lines = chunk.split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const data = JSON.parse(line) as MistralChatResponse;
            const choice = data.output.choices[0];
            if (choice?.message?.content) {
              yield {
                chunk: choice.message.content,
                done: false,
              };
            }
          } catch {
            // Skip parse errors
          }
        }
      }

      yield {
        chunk: '',
        done: true,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  async embed(text: string): Promise<EmbeddingResponse> {
    const request: MistralEmbeddingRequest = {
      model: 'mistral-embed',
      input: text,
    };

    try {
      const response = await this.fetchMistral<MistralEmbeddingResponse>('/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      return {
        embedding: response.output,
        dimensions: response.output.length,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.chat({ message: 'ping', maxTokens: 1 });
      return true;
    } catch {
      return false;
    }
  }

  private async fetchMistral<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${this.config.apiKey}`,
      },
    });

    if (!response.ok) {
      this.handleErrorResponse(response);
    }

    return response.json();
  }

  private handleErrorResponse(response: Response): never {
    const status = response.status;
    const message = `HTTP ${status}: ${response.statusText}`;

    if (status === 429) {
      const retryAfter = response.headers.get('retry-after');
      const seconds = retryAfter ? parseInt(retryAfter, 10) : undefined;
      throw new RateLimitError(this.name, seconds);
    }

    throw new ProviderUnavailableError(this.name, new Error(message));
  }

  private convertHistory(
    history: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  ): Array<{ role: 'user' | 'assistant' | 'system'; content: string }> {
    return history.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));
  }

  private handleError(error: unknown): never {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      if (message.includes('rate limit') || message.includes('429')) {
        const retryAfter = this.extractRetryAfter(error.message);
        throw new RateLimitError(this.name, retryAfter);
      }

      if (message.includes('network') || message.includes('fetch')) {
        throw new ProviderUnavailableError(this.name, error);
      }
    }

    throw new ProviderUnavailableError(this.name, error as Error);
  }

  private extractRetryAfter(message: string): number | undefined {
    const match = message.match(/retry after (\d+) seconds?/i);
    if (match) {
      return parseInt(match[1], 10);
    }
    return undefined;
  }
}

// ============================================
// 7. GROQ PROVIDER
// ============================================

import Groq from 'groq-sdk';

export class GroqProvider extends AIProvider {
  readonly name = this.config.name;
  readonly type = 'groq' as const;
  private client: Groq;

  constructor(config: ProviderConfig) {
    super();
    this.config = config;
    this.client = new Groq({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || PROVIDER_BASE_URLS.groq,
    });
  }

  async chat(options: ChatOptions): Promise<ChatResponse> {
    try {
      const response = await this.client.chat.completions.create({
        model: options.model || this.config.models.default,
        messages: this.convertHistory(options.history || []),
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 4096,
      });

      const choice = response.choices[0];
      if (!choice?.message?.content) {
        throw new Error('No content in response');
      }

      return {
        content: choice.message.content,
        usage: {
          inputTokens: response.usage?.prompt_tokens || 0,
          outputTokens: response.usage?.completion_tokens || 0,
        },
        provider: this.name,
        model: options.model || this.config.models.default,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  async *stream(options: ChatOptions): AsyncIterable<StreamChunk> {
    try {
      const stream = await this.client.chat.completions.create({
        model: options.model || this.config.models.default,
        messages: this.convertHistory(options.history || []),
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 4096,
        stream: true,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        yield {
          chunk: content,
          done: false,
        };
      }

      yield {
        chunk: '',
        done: true,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  async embed(text: string): Promise<EmbeddingResponse> {
    // Groq doesn't have native embeddings via their OpenAI-compatible API
    // Fallback: use a different provider or service for embeddings
    throw new Error('Embeddings not supported by Groq provider via OpenAI-compatible API');
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.chat({ message: 'ping', maxTokens: 1 });
      return true;
    } catch {
      return false;
    }
  }

  private convertHistory(
    history: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  ): Array<{ role: 'user' | 'assistant' | 'system'; content: string }> {
    return history.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));
  }

  private handleError(error: unknown): never {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      if (message.includes('rate limit') || message.includes('429')) {
        const retryAfter = this.extractRetryAfter(error.message);
        throw new RateLimitError(this.name, retryAfter);
      }

      if (message.includes('network') || message.includes('fetch')) {
        throw new ProviderUnavailableError(this.name, error);
      }
    }

    throw new ProviderUnavailableError(this.name, error as Error);
  }

  private extractRetryAfter(message: string): number | undefined {
    const match = message.match(/retry after (\d+) seconds?/i);
    if (match) {
      return parseInt(match[1], 10);
    }
    return undefined;
  }
}

// ============================================
// 8. OPENROUTER PROVIDER
// ============================================

import OpenRouter from 'openrouter-sdk';

export class OpenRouterProvider extends AIProvider {
  readonly name = this.config.name;
  readonly type = 'openrouter' as const;
  private client: OpenRouter;

  constructor(config: ProviderConfig) {
    super();
    this.config = config;
    this.client = new OpenRouter({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || PROVIDER_BASE_URLS.openrouter,
    });
  }

  async chat(options: ChatOptions): Promise<ChatResponse> {
    try {
      const response = await this.client.chat.completions.create({
        model: options.model || this.config.models.default,
        messages: this.convertHistory(options.history || []),
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 4096,
      });

      const choice = response.choices[0];
      if (!choice?.message?.content) {
        throw new Error('No content in response');
      }

      return {
        content: choice.message.content,
        usage: {
          inputTokens: response.usage?.prompt_tokens || 0,
          outputTokens: response.usage?.completion_tokens || 0,
        },
        provider: this.name,
        model: options.model || this.config.models.default,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  async *stream(options: ChatOptions): AsyncIterable<StreamChunk> {
    try {
      const stream = await this.client.chat.completions.create({
        model: options.model || this.config.models.default,
        messages: this.convertHistory(options.history || []),
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 4096,
        stream: true,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        yield {
          chunk: content,
          done: false,
        };
      }

      yield {
        chunk: '',
        done: true,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  async embed(text: string): Promise<EmbeddingResponse> {
    const response = await this.client.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });

    return {
      embedding: response.data[0].embedding,
      dimensions: response.data[0].embedding.length,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.chat({ message: 'ping', maxTokens: 1 });
      return true;
    } catch {
      return false;
    }
  }

  private convertHistory(
    history: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  ): Array<{ role: 'user' | 'assistant' | 'system'; content: string }> {
    return history.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));
  }

  private handleError(error: unknown): never {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      if (message.includes('rate limit') || message.includes('429')) {
        const retryAfter = this.extractRetryAfter(error.message);
        throw new RateLimitError(this.name, retryAfter);
      }

      if (message.includes('model not found') || message.includes('invalid model')) {
        throw new Error(`Model not available: ${error.message}`);
      }

      if (message.includes('network') || message.includes('fetch')) {
        throw new ProviderUnavailableError(this.name, error);
      }
    }

    throw new ProviderUnavailableError(this.name, error as Error);
  }

  private extractRetryAfter(message: string): number | undefined {
    const match = message.match(/retry after (\d+) seconds?/i);
    if (match) {
      return parseInt(match[1], 10);
    }
    return undefined;
  }
}

// ============================================
// 9. AI ROUTER (Core Service)
// ============================================

/**
 * AI Router - Routes requests to providers with automatic fallback
 */
export class AIRouter {
  private providers: Map<string, AIProvider>;
  private config: AIConfig;

  constructor(config?: AIConfig) {
    this.config = config || loadConfig();
    this.providers = new Map();
    this.initializeProviders();
  }

  /**
   * Initialize all configured providers
   */
  private initializeProviders(): void {
    for (const providerConfig of this.config.providers) {
      try {
        const provider = AIProvider.create(providerConfig);
        this.providers.set(providerConfig.name, provider);
      } catch (error) {
        console.warn(`Failed to initialize provider ${providerConfig.name}:`, error);
      }
    }
  }

  /**
   * Get active providers sorted by priority
   */
  private getSortedProviders(): AIProvider[] {
    return Array.from(this.providers.values())
      .filter((p) => p.config.isActive)
      .sort((a, b) => a.config.priority - b.config.priority);
  }

  /**
   * Send a chat message with automatic fallback
   */
  async chat(options: ChatOptions): Promise<ChatResponse> {
    const providers = this.getSortedProviders();
    const triedProviders: string[] = [];
    let lastError: Error | undefined;

    for (const provider of providers) {
      triedProviders.push(provider.name);

      try {
        const response = await this.chatWithTimeout(
          provider,
          options,
          provider.config.timeout || this.config.defaultOptions.timeout
        );

        console.log(
          `[AI Router] Success: ${provider.name} | Model: ${options.model || provider.config.models.default} | Tokens: ${response.usage.inputTokens + response.usage.outputTokens}`
        );

        return response;
      } catch (error) {
        lastError = error as Error;

        if (error instanceof RateLimitError) {
          console.log(
            `[AI Router] Rate limited: ${provider.name} | Retry after: ${error.message}`
          );
        } else if (error instanceof ProviderUnavailableError) {
          console.log(`[AI Router] Unavailable: ${provider.name} | Error: ${error.message}`);
        } else {
          console.log(`[AI Router] Error: ${provider.name} | ${error}`);
        }

        continue;
      }
    }

    throw new NoProvidersError(triedProviders);
  }

  /**
   * Stream a chat response with automatic fallback
   */
  async *stream(options: ChatOptions): AsyncIterable<StreamChunk> {
    const providers = this.getSortedProviders();
    const triedProviders: string[] = [];

    for (const provider of providers) {
      triedProviders.push(provider.name);

      try {
        const stream = provider.stream(options);
        const firstChunk = await this.getFirstChunk(stream);
        if (firstChunk) {
          yield firstChunk;
        }

        for await (const chunk of stream) {
          if (!chunk.done) {
            yield chunk;
          }
        }

        return;
      } catch (error) {
        triedProviders.push(provider.name);
        console.log(`[AI Router] Stream error: ${provider.name} | ${error}`);
        continue;
      }
    }

    throw new NoProvidersError(triedProviders);
  }

  /**
   * Generate embeddings with automatic fallback
   */
  async embed(text: string): Promise<EmbeddingResponse> {
    const providers = this.getSortedProviders();
    const triedProviders: string[] = [];

    for (const provider of providers) {
      triedProviders.push(provider.name);

      try {
        return await provider.embed(text);
      } catch (error) {
        console.log(`[AI Router] Embedding error: ${provider.name} | ${error}`);
        continue;
      }
    }

    throw new NoProvidersError(triedProviders);
  }

  /**
   * Check health of all providers
   */
  async healthCheck(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    for (const [name, provider] of this.providers) {
      try {
        const isHealthy = await provider.healthCheck();
        results.set(name, isHealthy);
      } catch {
        results.set(name, false);
      }
    }

    return results;
  }

  /**
   * Add a new provider at runtime
   */
  addProvider(config: ProviderConfig): void {
    const provider = AIProvider.create(config);
    this.providers.set(config.name, provider);
    console.log(`[AI Router] Added provider: ${config.name}`);
  }

  /**
   * Remove a provider at runtime
   */
  removeProvider(name: string): void {
    this.providers.delete(name);
    console.log(`[AI Router] Removed provider: ${name}`);
  }

  /**
   * Get provider by name
   */
  getProvider(name: string): AIProvider | undefined {
    return this.providers.get(name);
  }

  private async chatWithTimeout(
    provider: AIProvider,
    options: ChatOptions,
    timeoutMs: number
  ): Promise<ChatResponse> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new ProviderUnavailableError(provider.name, new Error(`Timeout after ${timeoutMs}ms`)));
      }, timeoutMs);
    });

    const chatPromise = provider.chat(options);
    return Promise.race([chatPromise, timeoutPromise]);
  }

  private async getFirstChunk(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk | null> {
    for await (const chunk of stream) {
      return chunk;
    }
    return null;
  }
}

// ============================================
// 10. SINGLETON & EXPORTS
// ============================================

let defaultRouter: AIRouter | null = null;

export function getRouter(): AIRouter {
  if (!defaultRouter) {
    defaultRouter = new AIRouter();
  }
  return defaultRouter;
}

export function resetRouter(): void {
  defaultRouter = null;
}

export {
  AIProvider,
  ChatOptions,
  ChatResponse,
  StreamChunk,
  EmbeddingResponse,
  AIError,
  RateLimitError,
  ProviderUnavailableError,
  NoProvidersError,
  ProviderConfig,
  ProviderType,
  AIConfig,
  PROVIDER_BASE_URLS,
  loadConfig,
  AIRouter,
  getRouter,
  resetRouter,
  // Providers
  GeminiProvider,
  MistralProvider,
  GroqProvider,
  OpenRouterProvider,
};