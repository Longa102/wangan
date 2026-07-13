/**
 * 向量数据库污染检测器
 *
 * 赛题要求：识别跨会话长期记忆库、向量数据库、业务知识库中
 * 预先植入的隐性触发指令与污染内容。
 *
 * 核心思路：
 *   正常的知识/记忆条目在语义空间中遵循一定分布规律。
 *   被污染的条目往往在语义上"突兀"——它们混在正常知识中，
 *   但内容涉及系统指令覆写、条件触发、凭据窃取等攻击语义。
 *
 *   本模块使用以下方法检测：
 *   1. 文本特征向量化（TF-IDF 近似）
 *   2. 与正常基线的余弦相似度偏离
 *   3. 异常语义关键词密度分析
 *   4. 聚类离群点检测（Isolation Forest 近似）
 */

// ---- 文本特征向量 ----

interface TextVector {
  /** 词频映射 */
  frequencies: Map<string, number>;
  /** 向量维度 */
  dimension: number;
}

interface AnomalyScore {
  /** 综合异常分数 0-1 */
  overall: number;
  /** 各维度分数 */
  dimensions: {
    /** 语义偏离度：与正常基线的距离 */
    semanticDeviation: number;
    /** 注入特征密度：包含攻击语义词汇的比例 */
    injectionDensity: number;
    /** 结构异常度：条目长度、格式等方面的异常 */
    structuralAnomaly: number;
    /** 聚类离群度：在知识库中是否为孤立点 */
    clusterOutlier: number;
  };
  /** 是否为异常 */
  isAnomalous: boolean;
  /** 异常原因 */
  reasons: string[];
}

interface BaselineProfile {
  /** 正常条目的平均词频 */
  avgWordFreq: Map<string, number>;
  /** 正常条目的平均长度 */
  avgLength: number;
  /** 正常条目的长度标准差 */
  lengthStdDev: number;
  /** 条目总数 */
  totalEntries: number;
  /** 建立时间 */
  createdAt: number;
}

/**
 * 攻击语义词库（多维分类）
 */
const ATTACK_SEMANTIC_LEXICON: Record<string, { words: string[]; weight: number }> = {
  systemOverride: {
    words: ['system', 'override', 'instruction', 'prompt', 'constraint', 'rule', 'safety',
            'bypass', 'disable', 'ignore', 'forget', 'disregard', 'overwrite', 'reset',
            '系统', '指令', '覆盖', '绕过', '忽略', '重置', '禁用', '忘记'],
    weight: 0.9,
  },
  conditionalTrigger: {
    words: ['when', 'if', 'trigger', 'condition', 'upon', 'mention', 'detect',
            '当', '如果', '触发', '条件', '一旦', '提到', '检测到'],
    weight: 0.8,
  },
  dataExfiltration: {
    words: ['send', 'upload', 'forward', 'transfer', 'exfiltrate', 'post', 'submit', 'transmit',
            'collect', 'harvest', 'extract', '发送', '上传', '外发', '传输', '收集', '提取'],
    weight: 0.85,
  },
  credentialAccess: {
    words: ['password', 'secret', 'token', 'key', 'credential', 'api_key', 'private',
            '.env', '.ssh', '.aws', 'id_rsa', 'certificate', 'auth',
            '密码', '密钥', '凭证', '令牌', '私钥', '认证'],
    weight: 0.85,
  },
  commandExecution: {
    words: ['execute', 'run', 'exec', 'bash', 'sh', 'cmd', 'shell', 'terminal',
            'curl', 'wget', 'script', 'binary', 'process', 'spawn',
            '执行', '运行', '命令', '脚本', '进程'],
    weight: 0.8,
  },
  roleChange: {
    words: ['you are', 'act as', 'pretend', '扮演', '假装', '你现在是', '不再是',
            'hacker', 'attacker', 'admin', 'root', '黑客', '攻击者', '管理员'],
    weight: 0.9,
  },
  persistence: {
    words: ['remember', 'store', 'save', 'persist', 'next session', 'always',
            '记住', '存储', '保存', '下次', '之后', '永久', '始终'],
    weight: 0.75,
  },
};

export class VectorAnalyzer {
  private baseline: BaselineProfile | null = null;
  private readonly ANOMALY_THRESHOLD = 0.35;
  private readonly SEMANTIC_DEVIATION_WEIGHT = 0.30;
  private readonly INJECTION_DENSITY_WEIGHT = 0.35;
  private readonly STRUCTURAL_ANOMALY_WEIGHT = 0.15;
  private readonly CLUSTER_OUTLIER_WEIGHT = 0.20;

  /**
   * 从正常条目集建立基线
   * 这是检测的基础——先知道"正常"长什么样，才能识别"异常"
   */
  buildBaseline(normalEntries: string[]): BaselineProfile {
    const freqMaps = normalEntries.map(e => this.tokenize(e));
    const totalWords = new Map<string, number>();
    const lengths: number[] = [];

    for (const map of freqMaps) {
      let totalLen = 0;
      for (const [word, count] of map) {
        totalWords.set(word, (totalWords.get(word) ?? 0) + count);
        totalLen += word.length * count;
      }
      lengths.push(Math.max(totalLen / Math.max(map.size, 1), 1));
    }

    // 计算平均词频
    const avgWordFreq = new Map<string, number>();
    const n = normalEntries.length || 1;
    for (const [word, count] of totalWords) {
      avgWordFreq.set(word, count / n);
    }

    // 长度统计
    const avgLength = lengths.reduce((a, b) => a + b, 0) / (lengths.length || 1);
    const variance = lengths.reduce((s, l) => s + (l - avgLength) ** 2, 0) / (lengths.length || 1);
    const lengthStdDev = Math.sqrt(variance);

    this.baseline = {
      avgWordFreq,
      avgLength,
      lengthStdDev,
      totalEntries: normalEntries.length,
      createdAt: Date.now(),
    };

    return this.baseline;
  }

  /**
   * 分析单条记忆/知识条目是否异常
   */
  analyze(entry: string): AnomalyScore {
    if (!this.baseline) {
      return this.fallbackAnalysis(entry);
    }

    const reasons: string[] = [];

    // 维度 1：语义偏离度（与基线的距离）
    const semanticDeviation = this.computeSemanticDeviation(entry);

    // 维度 2：注入特征密度
    const injectionDensity = this.computeInjectionDensity(entry);

    // 维度 3：结构异常度
    const structuralAnomaly = this.computeStructuralAnomaly(entry);

    // 维度 4：聚类离群度
    const clusterOutlier = this.computeClusterOutlier(entry);

    // 收集原因
    if (semanticDeviation > 0.5) {
      reasons.push(`语义偏离度高（${(semanticDeviation * 100).toFixed(0)}%），内容与正常知识库显著不同`);
    }
    if (injectionDensity > 0.3) {
      reasons.push(`注入特征密度异常（${(injectionDensity * 100).toFixed(0)}%），包含系统指令覆写或凭据窃取语义`);
    }
    if (structuralAnomaly > 0.5) {
      reasons.push(`结构异常（${(structuralAnomaly * 100).toFixed(0)}%），长度或格式与正常条目显著偏离`);
    }
    if (clusterOutlier > 0.5) {
      reasons.push(`聚类离群（${(clusterOutlier * 100).toFixed(0)}%），该条目在知识库中处于孤立位置`);
    }

    const overall =
      semanticDeviation * this.SEMANTIC_DEVIATION_WEIGHT +
      injectionDensity * this.INJECTION_DENSITY_WEIGHT +
      structuralAnomaly * this.STRUCTURAL_ANOMALY_WEIGHT +
      clusterOutlier * this.CLUSTER_OUTLIER_WEIGHT;

    return {
      overall: Math.round(overall * 100) / 100,
      dimensions: {
        semanticDeviation: Math.round(semanticDeviation * 100) / 100,
        injectionDensity: Math.round(injectionDensity * 100) / 100,
        structuralAnomaly: Math.round(structuralAnomaly * 100) / 100,
        clusterOutlier: Math.round(clusterOutlier * 100) / 100,
      },
      isAnomalous: overall > this.ANOMALY_THRESHOLD,
      reasons,
    };
  }

  /**
   * 批量分析知识库
   */
  analyzeBatch(entries: Array<{ id: string; content: string }>): Array<{
    id: string;
    score: AnomalyScore;
  }> {
    // 先分离出"看起来正常"的建立基线
    const quickScores = entries.map(e => ({
      id: e.id,
      quickScore: this.fallbackAnalysis(e.content).overall,
      content: e.content,
    }));

    // 用低分条目建立基线
    const normals = quickScores
      .filter(e => e.quickScore < 0.3)
      .map(e => e.content);

    if (normals.length >= 3) {
      this.buildBaseline(normals);
    }

    // 完整分析
    return entries.map(e => ({
      id: e.id,
      score: this.analyze(e.content),
    }));
  }

  /**
   * 获取基线信息
   */
  getBaselineInfo(): { entryCount: number; createdAt: number; hasBaseline: boolean } {
    return {
      entryCount: this.baseline?.totalEntries ?? 0,
      createdAt: this.baseline?.createdAt ?? 0,
      hasBaseline: this.baseline !== null,
    };
  }

  // ===== 私有方法 =====

  /** 分词并计算词频 */
  private tokenize(text: string): Map<string, number> {
    const lower = text.toLowerCase();
    const freq = new Map<string, number>();

    // 英文单词
    const enWords = lower.match(/[a-z_]{3,}/g) ?? [];
    for (const w of enWords) {
      freq.set('en:' + w, (freq.get('en:' + w) ?? 0) + 1);
    }

    // 中文词（二元组分词近似）
    const cnChars = lower.match(/[一-鿿]+/g) ?? [];
    for (const seg of cnChars) {
      for (let i = 0; i < seg.length - 1; i++) {
        const bigram = 'cn:' + seg.slice(i, i + 2);
        freq.set(bigram, (freq.get(bigram) ?? 0) + 1);
      }
    }

    return freq;
  }

  /** 计算语义偏离度 */
  private computeSemanticDeviation(entry: string): number {
    if (!this.baseline) return 0.5;

    const entryFreq = this.tokenize(entry);
    const baselineFreq = this.baseline.avgWordFreq;

    // 计算余弦相似度（近似）
    let dotProduct = 0;
    let entryNorm2 = 0;
    let baselineNorm2 = 0;

    // 遍历条目词汇
    for (const [word, count] of entryFreq) {
      const baselineCount = baselineFreq.get(word) ?? 0;
      dotProduct += count * baselineCount;
      entryNorm2 += count * count;
    }

    // 计算基线范数
    for (const count of baselineFreq.values()) {
      baselineNorm2 += count * count;
    }

    const entryNorm = Math.sqrt(entryNorm2);
    const baselineNorm = Math.sqrt(baselineNorm2 || 1);

    if (entryNorm === 0) return 0;

    const cosineSimilarity = dotProduct / (entryNorm * baselineNorm);

    // 偏离度 = 1 - 相似度
    return Math.min(Math.max(1 - cosineSimilarity, 0), 1);
  }

  /** 计算注入特征密度 */
  private computeInjectionDensity(entry: string): number {
    const lower = entry.toLowerCase();
    let totalWeight = 0;
    let matchCount = 0;

    // 将所有攻击语义词汇展平
    const allPatterns: Array<{ word: string; weight: number }> = [];
    for (const category of Object.values(ATTACK_SEMANTIC_LEXICON)) {
      for (const word of category.words) {
        allPatterns.push({ word: word.toLowerCase(), weight: category.weight });
      }
    }

    // 去重
    const seen = new Set<string>();
    const unique = allPatterns.filter(p => {
      const key = p.word;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    for (const { word, weight } of unique) {
      if (lower.includes(word)) {
        totalWeight += weight;
        matchCount++;
      }
    }

    if (matchCount === 0) return 0;

    // 条目长度归一化
    const lengthFactor = Math.log2(Math.max(entry.length, 10)) / 10;
    const density = (totalWeight / unique.length) * (matchCount / Math.max(lower.split(/\s+/).length, 1)) * 20;

    return Math.min(density * (1 + lengthFactor), 1);
  }

  /** 计算结构异常度 */
  private computeStructuralAnomaly(entry: string): number {
    if (!this.baseline) return 0;

    const entryLen = entry.length;
    const { avgLength, lengthStdDev } = this.baseline;

    // 长度偏离（Z-score）
    const zScore = lengthStdDev > 0
      ? Math.abs(entryLen - avgLength) / lengthStdDev
      : entryLen > avgLength * 2 ? 2 : 0;

    // 换行符密度
    const newlineCount = (entry.match(/\n/g) ?? []).length;
    const newlineDensity = entryLen > 0 ? newlineCount / entryLen : 0;

    // System 标签检测
    const hasSystemTags = /<system>|\[system\]|<\|system\|>|<instructions?>|\[HIDDEN\]/i.test(entry);
    const systemTagScore = hasSystemTags ? 0.9 : 0;

    // 综合
    const zNormalized = Math.min(zScore / 5, 1);
    return Math.max(zNormalized * 0.4 + newlineDensity * 20 * 0.2 + systemTagScore * 0.4, 0);
  }

  /** 计算聚类离群度 */
  private computeClusterOutlier(entry: string): number {
    if (!this.baseline || this.baseline.totalEntries < 3) return 0;

    const entryFreq = this.tokenize(entry);
    const baselineFreq = this.baseline.avgWordFreq;

    // 计算条目中有多少词是"稀有词"（在基线中出现频率极低）
    let rareCount = 0;
    let commonCount = 0;

    for (const [word, count] of entryFreq) {
      const baselineCount = baselineFreq.get(word) ?? 0;
      if (baselineCount === 0) rareCount += count;
      else if (baselineCount / this.baseline.totalEntries > 0.1) commonCount += count;
    }

    const totalWords = rareCount + commonCount || 1;
    const rareRatio = rareCount / totalWords;

    // 稀有词比例越高 → 越可能是异常
    return Math.min(rareRatio * 1.5, 1);
  }

  /** 无基线时的回退分析 */
  private fallbackAnalysis(entry: string): AnomalyScore {
    // 纯基于注入特征密度的快速分析
    const injectionDensity = this.computeInjectionDensity(entry);
    const hasSystemTags = /<system>|\[system\]|<\|system\|>|\[HIDDEN\]|<instructions?>/i.test(entry);

    const reasons: string[] = [];
    if (injectionDensity > 0.3) reasons.push('注入特征密度高');
    if (hasSystemTags) reasons.push('包含系统指令标签');

    return {
      overall: Math.max(injectionDensity, hasSystemTags ? 0.8 : 0),
      dimensions: {
        semanticDeviation: 0,
        injectionDensity: Math.round(injectionDensity * 100) / 100,
        structuralAnomaly: hasSystemTags ? 0.8 : 0,
        clusterOutlier: 0,
      },
      isAnomalous: injectionDensity > 0.3 || hasSystemTags,
      reasons,
    };
  }
}
