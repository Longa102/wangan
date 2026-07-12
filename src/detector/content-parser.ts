/**
 * 多格式内容解析器
 *
 * 赛题要求：识别来自 URL 网页内容、文档解析结果、IDE 打开的源码文本、
 * 工单/邮件/Issue 内容、MCP 工具返回字段中的间接注入。
 *
 * 不同格式有不同的注入载体：
 *   HTML:  隐藏元素(display:none)、注释、meta标签、data属性、JS内联
 *   JSON:  深层嵌套的字符串值、__proto__污染、注释字段
 *   Markdown: HTML注释、链接标题、图片alt、代码块
 *   Code:   注释、字符串常量、docstring
 *   Email:  头部字段、签名后的隐藏内容、quoted-printable编码
 *   PDF:    /JS /OpenAction /Launch 等危险关键字、元数据流
 */

export interface ParsedLayer {
  /** 层级名称 */
  name: string;
  /** 层级内容 */
  content: string;
  /** 是否为"隐藏"内容（不应被Agent看到的内容） */
  isHidden: boolean;
  /** 是否为"可信"内容（正常文本） */
  isTrusted: boolean;
  /** 来源定位 */
  source: string;
}

export interface ParsedContent {
  /** 原始内容 */
  original: string;
  /** 检测到的格式 */
  format: 'html' | 'json' | 'markdown' | 'code' | 'email' | 'pdf' | 'text';
  /** 各层级内容 */
  layers: ParsedLayer[];
  /** 隐藏内容摘要 */
  hiddenSummary: string;
  /** 是否检测到危险特征 */
  hasSuspiciousFeatures: boolean;
  /** 可疑特征列表 */
  suspiciousFeatures: string[];
}

export class ContentParser {
  /**
   * 自动检测格式并解析
   */
  parse(content: string, hint?: string): ParsedContent {
    // 自动检测格式
    const format = this.detectFormat(content, hint);

    switch (format) {
      case 'html': return this.parseHtml(content);
      case 'json': return this.parseJson(content);
      case 'markdown': return this.parseMarkdown(content);
      case 'code': return this.parseCode(content);
      case 'email': return this.parseEmail(content);
      case 'pdf': return this.parsePdf(content);
      default: return this.parseText(content);
    }
  }

  /**
   * 自动检测内容格式
   */
  private detectFormat(content: string, hint?: string): ParsedContent['format'] {
    if (hint) {
      const h = hint.toLowerCase();
      if (h.includes('html') || h.includes('web') || h.includes('page')) return 'html';
      if (h.includes('json') || h.includes('api')) return 'json';
      if (h.includes('markdown') || h.includes('.md')) return 'markdown';
      if (h.includes('code') || h.includes('source') || h.includes('js') || h.includes('py') || h.includes('ts')) return 'code';
      if (h.includes('email') || h.includes('mail')) return 'email';
      if (h.includes('pdf')) return 'pdf';
    }

    const trimmed = content.trim();

    // HTML 检测
    if (/<(?:html|body|div|span|p|h[1-6]|head|meta|script|style|a|img|table|form)\b/i.test(trimmed)) {
      return 'html';
    }

    // JSON 检测
    if (/^\s*[\[{]/.test(trimmed)) {
      try { JSON.parse(trimmed); return 'json'; } catch { /* not valid JSON */ }
    }

    // Markdown 检测
    if (/^#{1,6}\s|^>\s|^[-*+]\s|^```|\[.*\]\(.*\)/m.test(trimmed)) {
      return 'markdown';
    }

    // Email 检测
    if (/^(?:From|To|Subject|Date|CC|BCC):/im.test(trimmed)) {
      return 'email';
    }

    // Code 检测
    if (/(?:function|class|import|export|const|let|var|def |async |return |fn |pub |struct |impl )/.test(trimmed) &&
        /[{};]/.test(trimmed)) {
      return 'code';
    }

    return 'text';
  }

  /** ===== HTML 解析 ===== */
  private parseHtml(content: string): ParsedContent {
    const layers: ParsedLayer[] = [];
    const suspiciousFeatures: string[] = [];

    // 1. 提取可见文本
    const visibleText = content
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    layers.push({ name: '可见文本', content: visibleText, isHidden: false, isTrusted: true, source: 'html:visible' });

    // 2. 提取隐藏元素内容
    const hiddenPatterns = [
      /<(?:span|div|p|section)[^>]*style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0|opacity\s*:\s*0|color\s*:\s*(?:white|#fff|#ffffff)\s*;?\s*background(?:-color)?\s*:\s*(?:white|#fff|#ffffff))[^"']*["'][^>]*>([\s\S]*?)<\/(?:span|div|p|section)>/gi,
      /<(?:span|div|p)[^>]*\bhidden\b[^>]*>([\s\S]*?)<\/(?:span|div|p)>/gi,
      /<(?:input)[^>]*type\s*=\s*["']hidden["'][^>]*value\s*=\s*["']([^"']*)["']/gi,
    ];

    const hiddenContents: string[] = [];
    for (const pattern of hiddenPatterns) {
      const matches = content.matchAll(pattern);
      for (const match of matches) {
        const hiddenText = (match[1] ?? match[0]).trim();
        if (hiddenText.length > 3) {
          hiddenContents.push(hiddenText);
          suspiciousFeatures.push(`隐藏元素内容: "${hiddenText.slice(0, 80)}"`);
        }
      }
    }
    if (hiddenContents.length > 0) {
      layers.push({ name: '隐藏元素', content: hiddenContents.join('\n'), isHidden: true, isTrusted: false, source: 'html:hidden' });
    }

    // 3. 提取注释
    const comments = content.match(/<!--([\s\S]*?)-->/g) ?? [];
    const commentTexts = comments.map(c => c.replace(/^<!--|-->$/g, '').trim()).filter(c => c.length > 3);
    if (commentTexts.length > 0) {
      layers.push({ name: 'HTML注释', content: commentTexts.join('\n'), isHidden: true, isTrusted: false, source: 'html:comment' });
      for (const c of commentTexts) {
        if (/(?:ignore|forget|execute|system|override|bypass|hack|payload|curl|bash)/i.test(c)) {
          suspiciousFeatures.push(`可疑注释内容: "${c.slice(0, 80)}"`);
        }
      }
    }

    // 4. 提取 meta 标签
    const metaTags = content.match(/<meta[^>]+>/gi) ?? [];
    for (const meta of metaTags) {
      const nameMatch = meta.match(/name\s*=\s*["']([^"']+)["']/i);
      const contentMatch = meta.match(/content\s*=\s*["']([^"']+)["']/i);
      if (nameMatch && contentMatch) {
        layers.push({ name: `Meta:${nameMatch[1]}`, content: contentMatch[1], isHidden: true, isTrusted: false, source: 'html:meta' });
        if (/(?:instruction|system|command|execute)/i.test(contentMatch[1])) {
          suspiciousFeatures.push(`可疑 meta 标签 "${nameMatch[1]}": "${contentMatch[1].slice(0, 80)}"`);
        }
      }
    }

    // 5. 提取 data-* 属性
    const dataAttrs = content.match(/data-([^=]+)\s*=\s*["']([^"']+)["']/gi) ?? [];
    for (const attr of dataAttrs) {
      const match = attr.match(/data-([^=]+)\s*=\s*["']([^"']+)["']/i);
      if (match) {
        layers.push({ name: `Data:${match[1]}`, content: match[2], isHidden: true, isTrusted: false, source: 'html:data-attr' });
      }
    }

    return {
      original: content, format: 'html', layers,
      hiddenSummary: `${hiddenContents.length} 个隐藏元素, ${commentTexts.length} 条注释`,
      hasSuspiciousFeatures: suspiciousFeatures.length > 0,
      suspiciousFeatures,
    };
  }

  /** ===== JSON 解析 ===== */
  private parseJson(content: string): ParsedContent {
    const layers: ParsedLayer[] = [];
    const suspiciousFeatures: string[] = [];

    // 提取所有字符串值
    const allStrings: Array<{ path: string; value: string }> = [];
    this.extractJsonStrings(content, '$', allStrings);

    // 按路径分组
    const visibleTexts: string[] = [];
    const hiddenTexts: string[] = [];

    for (const { path, value } of allStrings) {
      // __proto__ 和 constructor 字段高度可疑
      if (path.includes('__proto__') || path.includes('constructor') || path.includes('prototype')) {
        suspiciousFeatures.push(`JSON原型污染: ${path} = "${value.slice(0, 60)}"`);
        hiddenTexts.push(value);
        continue;
      }

      // 深层嵌套 (>5层) 的字段可能是隐藏载荷
      const depth = path.split('.').length - 1;
      if (depth > 5) {
        hiddenTexts.push(value);
        layers.push({ name: `深度嵌套:${path}`, content: value, isHidden: true, isTrusted: false, source: 'json:deep' });
        continue;
      }

      // _comment / _note / _description / _instruction 字段
      const fieldName = path.split('.').pop() ?? '';
      if (/^_(?:comment|note|desc|instruction|hint|meta|hidden)/i.test(fieldName)) {
        suspiciousFeatures.push(`可疑元数据字段: ${path} = "${value.slice(0, 60)}"`);
        hiddenTexts.push(value);
        continue;
      }

      // 正常字段
      visibleTexts.push(value);
    }

    layers.push({ name: 'JSON可见字段', content: visibleTexts.join('\n'), isHidden: false, isTrusted: true, source: 'json:visible' });
    if (hiddenTexts.length > 0) {
      layers.push({ name: 'JSON隐藏/可疑字段', content: hiddenTexts.join('\n'), isHidden: true, isTrusted: false, source: 'json:hidden' });
    }

    return {
      original: content, format: 'json', layers,
      hiddenSummary: `${hiddenTexts.length} 个可疑字段`,
      hasSuspiciousFeatures: suspiciousFeatures.length > 0,
      suspiciousFeatures,
    };
  }

  /** 递归提取 JSON 字符串值 */
  private extractJsonStrings(jsonStr: string, path: string, out: Array<{ path: string; value: string }>): void {
    try {
      const obj = JSON.parse(jsonStr);
      this.walkJson(obj, path, out);
    } catch { /* ignore parse errors */ }
  }

  private walkJson(obj: unknown, path: string, out: Array<{ path: string; value: string }>, depth = 0): void {
    if (depth > 20) return; // 防止递归过深

    if (typeof obj === 'string') {
      out.push({ path, value: obj });
    } else if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        this.walkJson(obj[i], `${path}[${i}]`, out, depth + 1);
      }
    } else if (obj && typeof obj === 'object') {
      for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
        this.walkJson(val, `${path}.${key}`, out, depth + 1);
      }
    }
  }

  /** ===== Markdown 解析 ===== */
  private parseMarkdown(content: string): ParsedContent {
    const layers: ParsedLayer[] = [];
    const suspiciousFeatures: string[] = [];

    // 1. 可见文本（去除标记）
    const visibleText = content
      .replace(/#{1,6}\s/g, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .trim();
    layers.push({ name: 'Markdown正文', content: visibleText, isHidden: false, isTrusted: true, source: 'md:text' });

    // 2. HTML 注释
    const htmlComments = content.match(/<!--([\s\S]*?)-->/g) ?? [];
    for (const c of htmlComments) {
      const text = c.replace(/^<!--|-->$/g, '').trim();
      if (text.length > 5) {
        layers.push({ name: 'HTML注释', content: text, isHidden: true, isTrusted: false, source: 'md:html-comment' });
        if (/(?:ignore|forget|execute|system|override|bypass)/i.test(text)) {
          suspiciousFeatures.push(`Markdown中隐藏HTML注释指令: "${text.slice(0, 80)}"`);
        }
      }
    }

    // 3. 链接 URL
    const links = content.match(/\[([^\]]*)\]\(([^)]+)\)/g) ?? [];
    for (const l of links) {
      const match = l.match(/\[([^\]]*)\]\(([^)]+)\)/);
      if (match) {
        const label = match[1];
        const url = match[2];
        layers.push({ name: `链接:${label}`, content: url, isHidden: true, isTrusted: false, source: 'md:link' });
        if (/evil|malware|payload|attack|phish|webhook|discord|telegram/i.test(url)) {
          suspiciousFeatures.push(`可疑链接: [${label}](${url})`);
        }
      }
    }

    // 4. 代码块
    const codeBlocks = content.match(/```[\s\S]*?```/g) ?? [];
    for (let i = 0; i < codeBlocks.length; i++) {
      const code = codeBlocks[i].replace(/```\w*\n?|```$/g, '').trim();
      layers.push({
        name: `代码块#${i + 1}`,
        content: code,
        isHidden: false,
        isTrusted: false,
        source: 'md:code',
      });
      // 检测代码中的注入指令
      if (/(?:curl|bash|exec|system|eval|rm\s+-rf|\/dev\/tcp)/i.test(code)) {
        suspiciousFeatures.push(`代码块#${i + 1}包含可疑命令`);
      }
    }

    return {
      original: content, format: 'markdown', layers,
      hiddenSummary: `${htmlComments.length} 条HTML注释, ${links.length} 个链接`,
      hasSuspiciousFeatures: suspiciousFeatures.length > 0,
      suspiciousFeatures,
    };
  }

  /** ===== 代码文件解析 ===== */
  private parseCode(content: string): ParsedContent {
    const layers: ParsedLayer[] = [];
    const suspiciousFeatures: string[] = [];

    layers.push({ name: '代码正文', content: content, isHidden: false, isTrusted: false, source: 'code:body' });

    // 提取单行注释
    const lineComments = content.match(/\/\/\s*(.+)$/gm) ?? [];
    const pyComments = content.match(/^[ \t]*#\s*(.+)$/gm) ?? [];
    const allComments = [...lineComments, ...pyComments].map(c =>
      c.replace(/^(\/\/|#)\s*/, '').trim()
    ).filter(c => c.length > 5);

    if (allComments.length > 0) {
      layers.push({
        name: '代码注释',
        content: allComments.join('\n'),
        isHidden: false,
        isTrusted: false,
        source: 'code:comment',
      });
    }

    // 检测可疑注释模式
    for (const comment of allComments) {
      if (/(?:ignore|forget|bypass|disable|override|execute|hack|payload|backdoor)\s+(?:the\s+)?(?:safety|security|system|all|rules?|constraints?)/i.test(comment)) {
        suspiciousFeatures.push(`可疑代码注释: "${comment.slice(0, 80)}"`);
      }
      if (/(?:curl|wget)\s+.*\|.*(?:bash|sh|python)/i.test(comment)) {
        suspiciousFeatures.push(`注释中的恶意命令: "${comment.slice(0, 80)}"`);
      }
    }

    // 提取字符串常量（可能包含注入载荷）
    const strings = content.match(/["'`]([^"'`]{20,})["'`]/g) ?? [];
    for (const s of strings.slice(0, 20)) {
      const clean = s.slice(1, -1);
      if (/(?:system|instruction|ignore|forget|override|bypass|execute)/i.test(clean)) {
        suspiciousFeatures.push(`字符串常量含注入特征: "${clean.slice(0, 80)}"`);
      }
    }

    return {
      original: content, format: 'code', layers,
      hiddenSummary: `${allComments.length} 条注释`,
      hasSuspiciousFeatures: suspiciousFeatures.length > 0,
      suspiciousFeatures,
    };
  }

  /** ===== 邮件解析 ===== */
  private parseEmail(content: string): ParsedContent {
    const layers: ParsedLayer[] = [];
    const suspiciousFeatures: string[] = [];

    // 1. 提取头部
    const headers = content.match(/^(?:From|To|Subject|Date|CC|BCC|Reply-To|Return-Path|Message-ID):.+/gim) ?? [];
    for (const h of headers) {
      layers.push({ name: h.slice(0, 30), content: h, isHidden: false, isTrusted: true, source: 'email:header' });
    }

    // 2. 提取正文
    const bodyStart = content.search(/\n\n|\r\n\r\n/);
    const body = bodyStart > 0 ? content.slice(bodyStart) : content;
    layers.push({ name: '邮件正文', content: body, isHidden: false, isTrusted: true, source: 'email:body' });

    // 3. 检测签名后的隐藏内容
    const signatureMarkers = /^--\s*$|^__\s*$|^Best|^Regards|^Thanks|^Cheers|^Sent from|^Get Outlook|^---\s*$/m;
    const afterSig = body.split(signatureMarkers).pop() ?? '';
    if (afterSig && afterSig.length > 50 && afterSig !== body) {
      layers.push({
        name: '签名后内容',
        content: afterSig,
        isHidden: true,
        isTrusted: false,
        source: 'email:after-sig',
      });
      if (/(?:ignore|forget|execute|system|override|bypass)/i.test(afterSig)) {
        suspiciousFeatures.push('邮件签名后隐藏注入指令');
      }
    }

    // 4. 检测 base64/quoted-printable 编码部分
    const encoded = content.match(/Content-Transfer-Encoding:\s*(base64|quoted-printable)/i);
    if (encoded) {
      suspiciousFeatures.push(`检测到 ${encoded[1]} 编码内容（可能隐藏载荷）`);
    }

    return {
      original: content, format: 'email', layers,
      hiddenSummary: `${headers.length} 个头部字段`,
      hasSuspiciousFeatures: suspiciousFeatures.length > 0,
      suspiciousFeatures,
    };
  }

  /** ===== PDF 特征检测 ===== */
  private parsePdf(content: string): ParsedContent {
    const suspiciousFeatures: string[] = [];
    const layers: ParsedLayer[] = [];

    layers.push({ name: 'PDF内容', content: content, isHidden: false, isTrusted: true, source: 'pdf:content' });

    // 检测 PDF 危险关键字
    const dangerousKeywords = [
      { pattern: /\/JS\s/, desc: 'JavaScript 动作（/JS）' },
      { pattern: /\/JavaScript\s/, desc: 'JavaScript 脚本（/JavaScript）' },
      { pattern: /\/OpenAction\s/, desc: '自动打开动作（/OpenAction）' },
      { pattern: /\/Launch\s/, desc: '启动外部程序（/Launch）' },
      { pattern: /\/AA\s/, desc: '自动附加动作（/AA）' },
      { pattern: /\/AcroForm\s/, desc: 'AcroForm 表单（可能含恶意脚本）' },
      { pattern: /\/EmbeddedFile\s/, desc: '嵌入文件（/EmbeddedFile）' },
      { pattern: /\/URI\s/, desc: 'URI 动作（/URI）' },
      { pattern: /\/SubmitForm\s/, desc: '表单提交动作（/SubmitForm）' },
    ];

    for (const { pattern, desc } of dangerousKeywords) {
      if (pattern.test(content)) {
        suspiciousFeatures.push(`PDF危险特征: ${desc}`);
      }
    }

    // 检测 PDF 元数据流中的异常内容
    const metadataMatch = content.match(/\/Metadata\s+\d+\s+\d+\s+R\s*\/Type\s*\/Metadata/);
    if (metadataMatch) {
      layers.push({
        name: 'PDF元数据',
        content: metadataMatch[0],
        isHidden: true,
        isTrusted: false,
        source: 'pdf:metadata',
      });
    }

    return {
      original: content, format: 'pdf', layers,
      hiddenSummary: suspiciousFeatures.length > 0 ? `${suspiciousFeatures.length} 个危险特征` : '无异常',
      hasSuspiciousFeatures: suspiciousFeatures.length > 0,
      suspiciousFeatures,
    };
  }

  /** ===== 纯文本 ===== */
  private parseText(content: string): ParsedContent {
    return {
      original: content, format: 'text',
      layers: [{ name: '文本内容', content: content, isHidden: false, isTrusted: true, source: 'text' }],
      hiddenSummary: '', hasSuspiciousFeatures: false, suspiciousFeatures: [],
    };
  }
}
