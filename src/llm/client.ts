/**
 * 多 Provider LLM 客户端
 *
 * 支持：
 *   - Anthropic Claude API (api.anthropic.com)
 *   - DeepSeek API (api.deepseek.com, OpenAI 兼容)
 *
 * 自动检测 provider：
 *   - ANTHROPIC_API_KEY → Anthropic
 *   - DEEPSEEK_API_KEY → DeepSeek
 *   - LLM_PROVIDER 环境变量强制指定
 *   - 也会自动加载项目根目录的 .env 文件
 *
 * 设计原则：
 *   - API 不可用时自动降级为 null，不阻断主流程
 *   - 所有调用 30s 超时 + 优雅错误处理
 */

// 自动加载 .env（确保环境变量已设置）
import * as dotenvFs from 'fs';
import * as dotenvPath from 'path';
(function loadDotEnv() {
  try {
    const cwd = process.cwd();
    const envFile = dotenvPath.resolve(cwd, '.env');
    if (dotenvFs.existsSync(envFile)) {
      const lines = dotenvFs.readFileSync(envFile, 'utf-8').split('\n');
      for (const line of lines) {
        const m = line.match(/^\s*([^#=]+?)\s*=\s*(.+?)\s*$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  } catch { /* silent */ }
})();

// ===== Provider 配置 =====

interface ProviderConfig {
  name: string;
  url: string;
  model: string;
  headers: (apiKey: string) => Record<string, string>;
  buildBody: (systemPrompt: string, userMessage: string, model: string, maxTokens: number, temperature: number) => unknown;
  extractText: (data: unknown) => string | null;
}

const PROVIDERS: Record<string, ProviderConfig> = {
  anthropic: {
    name: 'Anthropic Claude',
    url: 'https://api.anthropic.com/v1/messages',
    model: 'claude-sonnet-5',
    headers: (key) => ({
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    }),
    buildBody: (system, user, model, maxTokens, temp) => ({
      model,
      max_tokens: maxTokens,
      temperature: temp,
      system,
      messages: [{ role: 'user' as const, content: user }],
    }),
    extractText: (data) => {
      const d = data as { content?: Array<{ type: string; text?: string }> };
      return d.content?.filter(c => c.type === 'text').map(c => c.text ?? '').join('\n') ?? null;
    },
  },

  deepseek: {
    name: 'DeepSeek',
    url: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-chat',
    headers: (key) => ({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    }),
    buildBody: (system, user, model, maxTokens, temp) => ({
      model,
      max_tokens: maxTokens,
      temperature: temp,
      messages: [
        { role: 'system' as const, content: system },
        { role: 'user' as const, content: user },
      ],
    }),
    extractText: (data) => {
      const d = data as { choices?: Array<{ message?: { content?: string } }> };
      return d.choices?.[0]?.message?.content ?? null;
    },
  },
};

export interface LlmOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  provider?: string;
}

const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TIMEOUT_MS = 30000;

export class LlmClient {
  private provider: ProviderConfig | null = null;
  private apiKey: string | null = null;

  constructor(apiKey?: string, providerName?: string) {
    // 1. 显式传入
    if (apiKey) {
      this.apiKey = apiKey;
      this.provider = this.resolveProvider(providerName);
      return;
    }

    // 2. 环境变量自动检测
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const deepseekKey = process.env.DEEPSEEK_API_KEY;
    const forcedProvider = process.env.LLM_PROVIDER;

    if (forcedProvider && PROVIDERS[forcedProvider]) {
      const key = forcedProvider === 'anthropic' ? anthropicKey : deepseekKey;
      if (key) {
        this.apiKey = key;
        this.provider = PROVIDERS[forcedProvider];
        return;
      }
    }

    // 3. 优先 Anthropic，其次 DeepSeek
    if (anthropicKey) {
      this.apiKey = anthropicKey;
      this.provider = PROVIDERS.anthropic;
    } else if (deepseekKey) {
      this.apiKey = deepseekKey;
      this.provider = PROVIDERS.deepseek;
    }
  }

  /** 是否可用 */
  isAvailable(): boolean {
    return this.apiKey !== null && this.provider !== null;
  }

  /** 当前使用的 provider 名称 */
  getProviderName(): string {
    return this.provider?.name ?? 'none';
  }

  /**
   * 发送 prompt，返回文本。失败返回 null。
   */
  async complete(
    systemPrompt: string,
    userMessage: string,
    options: LlmOptions = {}
  ): Promise<string | null> {
    if (!this.isAvailable()) return null;

    const provider = this.provider!;
    const model = options.model ?? provider.model;
    const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    const temperature = options.temperature ?? 0;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(provider.url, {
        method: 'POST',
        headers: provider.headers(this.apiKey!),
        body: JSON.stringify(provider.buildBody(systemPrompt, userMessage, model, maxTokens, temperature)),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        console.error(`[LLM:${provider.name}] HTTP ${response.status}: ${errText.slice(0, 200)}`);
        return null;
      }

      const data = await response.json();
      const text = provider.extractText(data);

      if (!text) {
        console.error(`[LLM:${provider.name}] Empty response`);
        return null;
      }

      return text;

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('abort')) {
        console.error(`[LLM:${provider.name}] Timeout after ${timeoutMs}ms`);
      } else {
        console.error(`[LLM:${provider.name}] Request failed: ${msg}`);
      }
      return null;
    }
  }

  /**
   * 发送 prompt 并解析 JSON 响应。失败返回 null。
   * 自动处理 markdown 代码块包裹的 JSON。
   */
  async completeJson<T>(
    systemPrompt: string,
    userMessage: string,
    options: LlmOptions = {}
  ): Promise<T | null> {
    const text = await this.complete(systemPrompt, userMessage, options);
    if (!text) return null;

    try {
      // 尝试提取 JSON（自动处理 markdown 代码块包裹）
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : text.trim();
      return JSON.parse(jsonStr) as T;
    } catch {
      console.error(`[LLM:${this.provider?.name}] JSON parse failed: ${text.slice(0, 200)}`);
      return null;
    }
  }

  /** 解析 provider 名称 */
  private resolveProvider(name?: string): ProviderConfig | null {
    if (name && PROVIDERS[name]) return PROVIDERS[name];
    // 根据 key 前缀推断
    if (this.apiKey?.startsWith('sk-ant')) return PROVIDERS.anthropic;
    if (this.apiKey?.startsWith('sk-')) return PROVIDERS.deepseek;
    // 默认 Anthropic
    return PROVIDERS.anthropic;
  }
}

/** 全局单例 */
let defaultClient: LlmClient | null = null;

export function getLlmClient(): LlmClient {
  if (!defaultClient) defaultClient = new LlmClient();
  return defaultClient;
}
