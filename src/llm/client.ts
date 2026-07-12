/**
 * LLM 客户端 — Anthropic API 封装
 * 负责人：C
 *
 * 设计原则：
 *   - API 不可用时自动降级，不阻断主流程
 *   - 所有 LLM 调用都有超时和重试
 *   - 错误时返回 null，上游代码 fallback 到规则引擎
 */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-5';
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TIMEOUT_MS = 30000;

export interface LlmOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export class LlmClient {
  private apiKey: string | null;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.ANTHROPIC_API_KEY ?? null;
  }

  /**
   * 是否可用
   */
  isAvailable(): boolean {
    return this.apiKey !== null && this.apiKey.length > 0;
  }

  /**
   * 发送 prompt，返回文本响应。失败返回 null。
   */
  async complete(
    systemPrompt: string,
    userMessage: string,
    options: LlmOptions = {}
  ): Promise<string | null> {
    if (!this.isAvailable()) return null;

    const model = options.model ?? DEFAULT_MODEL;
    const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    const temperature = options.temperature ?? 0;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

      const response = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey!,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          temperature,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        console.error(`[LLM] API error ${response.status}: ${response.statusText}`);
        return null;
      }

      const data = await response.json() as {
        content: Array<{ type: string; text?: string }>;
      };

      // 提取文本内容
      const textBlocks = data.content?.filter(c => c.type === 'text') ?? [];
      return textBlocks.map(c => c.text ?? '').join('\n') || null;

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[LLM] Request failed: ${msg}`);
      return null;
    }
  }

  /**
   * 发送 prompt 并解析 JSON 响应。失败返回 null。
   */
  async completeJson<T>(
    systemPrompt: string,
    userMessage: string,
    options: LlmOptions = {}
  ): Promise<T | null> {
    const text = await this.complete(systemPrompt, userMessage, options);
    if (!text) return null;

    try {
      // 尝试从响应中提取 JSON（可能被 markdown 代码块包裹）
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : text.trim();
      return JSON.parse(jsonStr) as T;
    } catch {
      console.error(`[LLM] Failed to parse JSON from response: ${text.slice(0, 200)}`);
      return null;
    }
  }
}

/** 全局单例 */
let defaultClient: LlmClient | null = null;

export function getLlmClient(): LlmClient {
  if (!defaultClient) {
    defaultClient = new LlmClient();
  }
  return defaultClient;
}
