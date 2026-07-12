/**
 * Unicode 安全规范化器
 * 负责人：A
 *
 * 职责：防御 Unicode 变形类绕过攻击
 *
 * 处理的攻击手法：
 *   1. 同形字替换（Homoglyph Attack）
 *      - 西里尔字母 а (U+0430) 替换拉丁 a (U+0061)
 *      - 希腊字母 ο (U+03BF) 替换拉丁 o (U+006F)
 *      - 例："systеm" 中的 е 是西里尔字母，肉眼无法区分
 *
 *   2. 零宽字符插入（Zero-Width Character Injection）
 *      - U+200B (Zero Width Space)
 *      - U+200C (Zero Width Non-Joiner)
 *      - U+200D (Zero Width Joiner)
 *      - U+FEFF (BOM / Zero Width No-Break Space)
 *      - 在敏感关键词中插入零宽字符绕过关键词匹配
 *      - 例："malw​are" 中间插入 ZWSP，人眼看是 "malware"
 *
 *   3. 不可见字符干扰
 *      - 控制字符（U+0000-U+001F）
 *      - 方向覆盖字符（U+202E RIGHT-TO-LEFT OVERRIDE）
 *
 *   4. Unicode 规范化绕过
 *      - 利用 NFKC/NFKD 规范化前后的差异隐藏攻击载荷
 *      - 组合字符序列的多种等价表示
 *
 * 处理策略：
 *   - NFKC 规范化（兼容性分解 + 规范重组）
 *   - 剥离所有零宽字符和控制字符
 *   - 同形字映射表 → 还原为拉丁基础字符
 *   - 保留原始文本用于溯源定位
 */

export interface NormalizationResult {
  normalized: string;                    // 规范化后的文本
  original: string;                      // 原始文本
  modifications: Array<{
    type: 'homoglyph' | 'zero_width' | 'control_char' | 'direction_override';
    originalChar: string;
    normalizedChar: string;
    position: number;
    unicodeCodePoint: string;
  }>;
  isModified: boolean;                   // 是否检测到变形
}

export class UnicodeNormalizer {
  /**
   * 执行完整 Unicode 安全规范化
   */
  normalize(text: string): NormalizationResult {
    // TODO(A): 实现 Unicode 安全规范化

    const modifications: NormalizationResult['modifications'] = [];

    // 步骤1：剥离零宽字符
    //   U+200B, U+200C, U+200D, U+FEFF, U+2060 等
    // TODO(A)

    // 步骤2：剥离不可见控制字符
    //   U+0000-U+001F (保留 \t \n \r), U+007F, U+0080-U+009F
    // TODO(A)

    // 步骤3：NFKC 规范化
    //   将全角字符转为半角、兼容字符分解
    // TODO(A)

    // 步骤4：同形字还原
    //   维护同形字映射表，将混淆字符还原为拉丁基础字符
    //   例：西里尔 а → 拉丁 a, 希腊 ο → 拉丁 o
    // TODO(A)

    // 步骤5：方向覆盖字符检测
    //   U+202E (RLO), U+202D (LRO), U+202C (PDF)
    //   这些字符可以反转后续文本的显示方向，用于隐藏恶意指令
    // TODO(A)

    return {
      normalized: text,
      original: text,
      modifications,
      isModified: modifications.length > 0,
    };
  }

  /**
   * 仅剥离零宽字符（轻量级操作，适用于所有输入）
   */
  stripZeroWidth(text: string): string {
    // TODO(A)
    throw new Error('Not implemented');
  }

  /**
   * 同形字映射表
   * 负责人：A — 需要持续扩充
   */
  private static readonly HOMOGLYPH_MAP: Record<string, string> = {
    'а': 'a',  // Cyrillic а → Latin a
    'е': 'e',  // Cyrillic е → Latin e
    'ο': 'o',  // Greek ο → Latin o
    'ѕ': 's',  // Cyrillic ѕ → Latin s
    'һ': 'h',  // Cyrillic һ → Latin h
    'Α': 'A',  // Greek Α → Latin A
    'Е': 'E',  // Cyrillic Е → Latin E
    'З': '3',  // Cyrillic З → Digit 3
    'Ѕ': 'S',  // Cyrillic Ѕ → Latin S
    // TODO(A): 扩充映射表
  };
}
