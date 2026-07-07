// src/services/provider-service.ts
export interface ChatOptions {
  message: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  history?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
}

export interface ChatResponse {
  content: string;
  usage: { inputTokens: number; outputTokens: number };
  provider: string;
  model: string;
}

export type ProviderType = 'gemini' | 'mistral' | 'groq' | 'openrouter';

export interface ProviderConfig {
  name: string;
  type: ProviderType;
  apiKey: string;
  baseUrl?: string;
  priority: number;
  isActive: boolean;
  models: { default: string; available: string[] };
  timeout?: number;
}

export const PROVIDER_BASE_URLS: Record<ProviderType, string> = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  mistral: 'https://api.mistral.ai/v1',
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
};

export function loadConfig() {
  const providers: ProviderConfig[] = [];

  if (process.env.GEMINI_API_KEY) {
    providers.push({
      name: 'gemini', type: 'gemini', apiKey: process.env.GEMINI_API_KEY,
      baseUrl: PROVIDER_BASE_URLS.gemini, priority: 10, isActive: true,
      models: { default: 'gemini-2.0-flash', available: ['gemini-2.0-flash', 'gemini-2.0-pro'] },
      timeout: 30000,
    });
  }

  if (process.env.MISTRAL_API_KEY) {
    providers.push({
      name: 'mistral', type: 'mistral', apiKey: process.env.MISTRAL_API_KEY,
      baseUrl: PROVIDER_BASE_URLS.mistral, priority: 20, isActive: true,
      models: { default: 'mistral-large-latest', available: ['mistral-large-latest'] },
      timeout: 60000,
    });
  }

  if (process.env.GROQ_API_KEY) {
    providers.push({
      name: 'groq', type: 'groq', apiKey: process.env.GROQ_API_KEY,
      baseUrl: PROVIDER_BASE_URLS.groq, priority: 30, isActive: true,
      models: { default: 'llama-3.1-70b-versatile', available: ['llama-3.1-70b-versatile'] },
      timeout: 60000,
    });
  }

  if (process.env.OPENROUTER_API_KEY) {
    providers.push({
      name: 'openrouter', type: 'openrouter', apiKey: process.env.OPENROUTER_API_KEY,
      baseUrl: PROVIDER_BASE_URLS.openrouter, priority: 40, isActive: true,
      models: { default: 'openai/gpt-4o-mini', available: ['openai/gpt-4o-mini'] },
      timeout: 60000,
    });
  }

  return { providers };
}

export abstract class AIProvider {
  abstract readonly name: string;
  abstract readonly type: ProviderType;
  abstract readonly config: ProviderConfig;

  abstract chat(options: ChatOptions): Promise<ChatResponse>;
  abstract stream(options: ChatOptions): AsyncIterable<{ chunk: string; done: boolean }>;
  abstract embed(text: string): Promise<EmbeddingResponse>;
  abstract healthCheck(): Promise<boolean>;

  static create(config: ProviderConfig): AIProvider {
    switch (config.type) {
      case 'gemini': return new GeminiProvider(config);
      case 'mistral': return new MistralProvider(config);
      case 'groq': return new GroqProvider(config);
      case 'openrouter': return new OpenRouterProvider(config);
      default: throw new Error('Unknown provider type: ' + config.type);
    }
  }
}

export class AIRouter {
  private providers: Map<string, AIProvider>;

  constructor(config?: { providers: ProviderConfig[] }) {
    const cfg = config || loadConfig();
    this.providers = new Map();
    for (const pc of cfg.providers) {
      try {
        this.providers.set(pc.name, AIProvider.create(pc));
      } catch (error) {
        console.warn('Failed to init provider ' + pc.name + ':', error);
      }
    }
  }

  async chat(options: ChatOptions): Promise<ChatResponse> {
    const sorted = Array.from(this.providers.values())
      .filter(p => p.config.isActive)
      .sort((a, b) => a.config.priority - b.config.priority);

    let lastError: any;
    for (const provider of sorted) {
      try { return await provider.chat(options); }
      catch (error) { lastError = error; continue; }
    }
    throw new Error('All providers failed: ' + lastError?.message);
  }

  addProvider(config: ProviderConfig): void {
    this.providers.set(config.name, AIProvider.create(config));
  }

  async healthCheck(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    for (const [name, p] of this.providers) {
      try { results.set(name, await p.healthCheck()); }
      catch { results.set(name, false); }
    }
    return results;
  }
}

let defaultRouter: AIRouter | null = null;
export function getRouter(): AIRouter {
  if (!defaultRouter) defaultRouter = new AIRouter();
  return defaultRouter;
}

// Provider implementations would go here
// For now, we export the router
export { AIProvider, ProviderConfig, ProviderType, PROVIDER_BASE_URLS, loadConfig };
