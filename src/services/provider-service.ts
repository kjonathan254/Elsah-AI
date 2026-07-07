// src/services/provider-service.ts
// Elsah AI - Provider-Agnostic AI Service
// Base URLs:
//   - Gemini:   https://generativelanguage.googleapis.com/v1beta
//   - Mistral:  https://api.mistral.ai/v1
//   - Groq:     https://api.groq.com/openai/v1
//   - OpenRouter: https://openrouter.ai/api/v1

// ============================================
// 1. TYPE DEFINITIONS
// ============================================

export interface ChatOptions {
  message: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  history?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  stream?: boolean;
}

export interface ChatResponse {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  provider: string;
  model: string;
}

export interface StreamChunk {
  chunk: string;
  done: boolean;
}

export interface EmbeddingResponse {
  embedding: number[];
  dimensions: number;
}

// ============================================
// 2. CUSTOM ERRORS
// ============================================

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

export class RateLimitError extends AIError {
  constructor(provider: string, retryAfter?: number) {
    super(
      'Rate limit exceeded for ' + provider + (retryAfter ? ', retry after ' + retryAfter + 's' : ''),
      provider,
      429,
      true,
      true
    );
    this.name = 'RateLimitError';
  }
}

export class ProviderUnavailableError extends AIError {
  constructor(provider: string, underlyingError: Error) {
    super(
      'Provider ' + provider + ' is unavailable: ' + underlyingError.message,
      provider,
      undefined,
      false,
      true
    );
    this.name = 'ProviderUnavailableError';
    this.stack = underlyingError.stack;
  }
}

export class NoProvidersError extends Error {
  constructor(triedProviders: string[]) {
    super('All providers failed. Tried: ' + triedProviders.join(', '));
    this.name = 'NoProvidersError';
  }
}