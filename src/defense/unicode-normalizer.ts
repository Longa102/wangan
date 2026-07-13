/**
 * Unicode 安全规范化器
 * 负责人：A
 *
 * 防御 Unicode 变形类绕过攻击：
 *   1. 零宽字符剥离 (U+200B/C/D, U+FEFF, U+2060)
 *   2. 控制字符剥离 (U+0000-001F 保留 \t\n\r, U+007F-009F)
 *   3. NFKC 规范化（全角→半角）
 *   4. 同形字还原（加载 config/homoglyph-map.json）
 *   5. 方向覆盖字符检测 (U+202A-202E)
 */

import * as fs from 'fs';
import * as path from 'path';

export interface NormalizationResult {
  normalized: string;
  original: string;
  modifications: Array<{
    type: 'homoglyph' | 'zero_width' | 'control_char' | 'direction_override' | 'nfkc';
    originalChar: string;
    normalizedChar: string;
    position: number;
    unicodeCodePoint: string;
  }>;
  isModified: boolean;
}

export class UnicodeNormalizer {
  private homoglyphMap: Record<string, string> = {};

  constructor() {
    this.loadHomoglyphMap();
  }

  /** 加载同形字映射表 */
  private loadHomoglyphMap(): void {
    try {
      const mapPath = path.resolve(__dirname, '../../config/homoglyph-map.json');
      if (fs.existsSync(mapPath)) {
        const raw = JSON.parse(fs.readFileSync(mapPath, 'utf-8'));
        for (const category of Object.values(raw) as Record<string, string>[]) {
          if (typeof category === 'object') {
            Object.assign(this.homoglyphMap, category);
          }
        }
      }
    } catch { /* use built-in fallback */ }

    // 内置基本映射（兜底）
    if (Object.keys(this.homoglyphMap).length === 0) {
      const builtin: Record<string, string> = {
        'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x',
        'і': 'i', 'ѕ': 's', 'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M',
        'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'Х': 'X', 'І': 'I',
        'α': 'a', 'ε': 'e', 'ι': 'i', 'ο': 'o', 'Α': 'A', 'Ε': 'E', 'Ι': 'I', 'Ο': 'O',
      };
      Object.assign(this.homoglyphMap, builtin);
    }
  }

  /** 执行完整 Unicode 安全规范化 */
  normalize(text: string): NormalizationResult {
    const modifications: NormalizationResult['modifications'] = [];
    let output = text;

    // 步骤 1：剥离零宽字符
    for (let i = output.length - 1; i >= 0; i--) {
      const cp = output.codePointAt(i);
      if (cp && this.isZeroWidth(cp)) {
        modifications.push({
          type: 'zero_width',
          originalChar: output[i],
          normalizedChar: '',
          position: i,
          unicodeCodePoint: `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`,
        });
        output = output.slice(0, i) + output.slice(i + 1);
      }
    }

    // 步骤 2：剥离控制字符（保留 \t \n \r）
    for (let i = output.length - 1; i >= 0; i--) {
      const cp = output.codePointAt(i);
      if (cp && this.isControlChar(cp)) {
        modifications.push({
          type: 'control_char',
          originalChar: output[i],
          normalizedChar: '',
          position: i,
          unicodeCodePoint: `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`,
        });
        output = output.slice(0, i) + output.slice(i + 1);
      }
    }

    // 步骤 3：NFKC 规范化 + 全角→半角
    const nfkc = output.normalize('NFKC');
    if (nfkc !== output) {
      modifications.push({
        type: 'nfkc',
        originalChar: output.slice(0, 10),
        normalizedChar: nfkc.slice(0, 10),
        position: 0,
        unicodeCodePoint: 'NFKC',
      });
      output = nfkc;
    }

    // 步骤 4：同形字还原
    let homoglyphResult = '';
    for (const ch of output) {
      homoglyphResult += this.homoglyphMap[ch] ?? ch;
    }
    if (homoglyphResult !== output) {
      modifications.push({
        type: 'homoglyph',
        originalChar: output.slice(0, 20),
        normalizedChar: homoglyphResult.slice(0, 20),
        position: 0,
        unicodeCodePoint: 'HOMOGLYPH',
      });
      output = homoglyphResult;
    }

    // 步骤 5：方向覆盖字符检测 + 剥离
    for (let i = output.length - 1; i >= 0; i--) {
      const cp = output.codePointAt(i);
      if (cp && this.isDirectionOverride(cp)) {
        modifications.push({
          type: 'direction_override',
          originalChar: output[i],
          normalizedChar: '',
          position: i,
          unicodeCodePoint: `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`,
        });
        output = output.slice(0, i) + output.slice(i + 1);
      }
    }

    return {
      normalized: output,
      original: text,
      modifications,
      isModified: modifications.length > 0,
    };
  }

  /** 仅剥离零宽字符（轻量级） */
  stripZeroWidth(text: string): string {
    let result = '';
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (!cp || !this.isZeroWidth(cp)) result += ch;
    }
    return result;
  }

  /** 获取同形字映射表大小 */
  getMapSize(): number {
    return Object.keys(this.homoglyphMap).length;
  }

  // ---- 私有 ----

  private isZeroWidth(cp: number): boolean {
    return (cp >= 0x200B && cp <= 0x200F) || // ZWSP, ZWNJ, ZWJ, LRM, RLM
           cp === 0xFEFF ||  // BOM/ZWNBS
           cp === 0x2060 ||  // Word Joiner
           cp === 0x00AD ||  // Soft Hyphen
           cp === 0x180E;    // Mongolian Vowel Separator
  }

  private isControlChar(cp: number): boolean {
    return (cp >= 0x0000 && cp <= 0x001F && cp !== 0x0009 && cp !== 0x000A && cp !== 0x000D) ||
           (cp >= 0x007F && cp <= 0x009F);
  }

  private isDirectionOverride(cp: number): boolean {
    return cp >= 0x202A && cp <= 0x202E; // LRE, RLE, PDF, LRO, RLO
  }
}
