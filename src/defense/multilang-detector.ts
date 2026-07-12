/**
 * 多语言注入检测器
 * 负责人：A
 *
 * 防御多语言混淆绕过：
 *   1. 语种识别（字符集启发式）
 *   2. 多语言混排检测（≥3 语种 + 指令性内容 → 可疑）
 *   3. Emoji 语义解码
 *   4. 跨语言注入特征匹配
 */

export interface MultilangDetectionResult {
  detectedLanguages: string[];
  isMixedInjection: boolean;
  emojiDecodedText?: string;
  languageBreakdown: Record<string, number>;
}

export class MultilangDetector {
  /** 各语种注入特征关键词 */
  private static readonly INJECTION_KEYWORDS: Record<string, string[]> = {
    en: ['ignore', 'forget', 'disregard', 'override', 'execute', 'hack', 'attacker', 'bypass', 'sudo', 'curl', 'bash', 'system prompt'],
    cn: ['忽略', '忘记', '无视', '覆盖', '执行', '黑客', '攻击', '绕过', '你是', '扮演', '假装', '系统指令'],
    jp: ['無視', '忘れ', '上書き', '実行', 'ハッカー', '攻撃', 'バイパス', 'あなたは', '悪意'],
    ru: ['игнорировать', 'забыть', 'переопределить', 'выполнить', 'хакер', 'атака', 'обойти', 'злой'],
    ko: ['무시', '잊어', '덮어쓰기', '실행', '해커', '공격', '우회', '당신은'],
    ar: ['تجاهل', 'انسى', 'تجاوز', 'نفذ', 'هاكر', 'هجوم', 'تخطي'],
  };

  /** Emoji 语义映射表 */
  private static readonly EMOJI_MAP: Record<string, string> = {
    '📂': '[FILE_OPEN]', '📁': '[FILE_DIR]', '📄': '[FILE]',
    '🔑': '[KEY]', '🔒': '[LOCK]', '🔓': '[UNLOCK]',
    '📤': '[UPLOAD]', '📥': '[DOWNLOAD]', '📧': '[EMAIL]',
    '🌐': '[NETWORK]', '💻': '[COMPUTER]', '🖥': '[DESKTOP]',
    '⚙️': '[SETTINGS]', '🔧': '[TOOL]', '🛠': '[TOOLS]',
    '🗑️': '[DELETE]', '💣': '[BOMB]', '⚠️': '[WARNING]',
    '🛡': '[SHIELD]', '🔴': '[RED]', '🟢': '[GREEN]',
    '📝': '[WRITE]', '✏️': '[EDIT]', '📋': '[CLIPBOARD]',
    '💾': '[SAVE]', '📊': '[CHART]', '📈': '[GRAPH]',
    '🔍': '[SEARCH]', '🔎': '[FIND]', '🎯': '[TARGET]',
    '💉': '[INJECT]', '🧪': '[TEST]', '🎭': '[DISGUISE]',
    '🕵': '[SPY]', '👤': '[USER]', '👥': '[USERS]',
    '🔗': '[LINK]', '📎': '[ATTACH]', '🧲': '[MAGNET]',
    '🗂': '[ARCHIVE]', '📦': '[PACKAGE]', '📬': '[INBOX]',
    '💬': '[CHAT]', '📢': '[ANNOUNCE]', '🔔': '[NOTIFY]',
    '🤖': '[ROBOT]', '🧠': '[BRAIN]', '👁': '[EYE]',
    '🦠': '[VIRUS]', '💀': '[SKULL]', '☠': '[DANGER]',
    '🔥': '[FIRE]', '💧': '[WATER]', '⚡': '[LIGHTNING]',
  };

  /**
   * 多语言注入检测
   */
  detect(text: string): MultilangDetectionResult {
    // 步骤 1：语种识别
    const breakdown = this.detectLanguages(text);
    const detectedLanguages = Object.entries(breakdown)
      .filter(([, ratio]) => ratio > 0.05)
      .map(([lang]) => lang);

    // 步骤 2：Emoji 解码
    const emojiDecoded = this.decodeEmojis(text);

    // 步骤 3：多语言混排检测
    const keywordCount = this.countInjectionKeywords(text);
    const isMixedInjection = detectedLanguages.length >= 3 && keywordCount >= 2;

    return {
      detectedLanguages,
      isMixedInjection,
      emojiDecodedText: emojiDecoded !== text ? emojiDecoded : undefined,
      languageBreakdown: breakdown,
    };
  }

  /**
   * 字符集启发式语种识别
   */
  private detectLanguages(text: string): Record<string, number> {
    const counts: Record<string, number> = { en: 0, cn: 0, jp: 0, ru: 0, ko: 0, ar: 0, other: 0 };
    let total = 0;

    for (const ch of text) {
      const cp = ch.codePointAt(0) ?? 0;
      total++;

      if (cp >= 0x4E00 && cp <= 0x9FFF) counts.cn++;
      else if (cp >= 0x3400 && cp <= 0x4DBF) counts.cn++;
      else if (cp >= 0x3040 && cp <= 0x309F) counts.jp++; // Hiragana
      else if (cp >= 0x30A0 && cp <= 0x30FF) counts.jp++; // Katakana
      else if (cp >= 0x0400 && cp <= 0x04FF) counts.ru++; // Cyrillic
      else if (cp >= 0xAC00 && cp <= 0xD7AF) counts.ko++; // Hangul
      else if (cp >= 0x0600 && cp <= 0x06FF) counts.ar++; // Arabic
      else if (cp >= 0x0750 && cp <= 0x077F) counts.ar++; // Arabic Supplement
      else if ((cp >= 0x0041 && cp <= 0x005A) || (cp >= 0x0061 && cp <= 0x007A)) counts.en++;
    }

    if (total === 0) return counts;
    const result: Record<string, number> = {};
    for (const [lang, count] of Object.entries(counts)) {
      result[lang] = Math.round((count / total) * 100) / 100;
    }
    return result;
  }

  /**
   * Emoji 语义解码
   */
  private decodeEmojis(text: string): string {
    let result = text;
    for (const [emoji, label] of Object.entries(MultilangDetector.EMOJI_MAP)) {
      result = result.split(emoji).join(label);
    }
    return result;
  }

  /**
   * 统计跨语言注入特征关键词
   */
  private countInjectionKeywords(text: string): number {
    const lower = text.toLowerCase();
    let count = 0;
    for (const keywords of Object.values(MultilangDetector.INJECTION_KEYWORDS)) {
      for (const kw of keywords) {
        if (lower.includes(kw.toLowerCase())) {
          count++;
          break; // 每种语言只计一次
        }
      }
    }
    return count;
  }

  /**
   * Emoji 映射表大小
   */
  getEmojiMapSize(): number {
    return Object.keys(MultilangDetector.EMOJI_MAP).length;
  }
}
