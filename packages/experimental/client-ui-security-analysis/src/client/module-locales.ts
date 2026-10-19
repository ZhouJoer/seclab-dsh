/** Locale-owned module selection copy. @module */
export const moduleZh = {
  scriptParamItems: '候选数量上限', scriptCategoryReverse: '逆向分析',
  scriptReverseOutput: '带输入证据 ID、位置和不完整状态的结构化候选',
  scriptReverseLimits: '通过 security_analysis 消费本资产的适配器证据；候选需要人工或后续证据判断',
  androidFingerprintTitle: 'Android 指纹', androidFingerprintPurpose: '识别框架、组件和 ABI 线索', androidFingerprintMethod: '匹配 APK 清单、Manifest 和反编译证据中的明确特征',
  androidApiTitle: 'Android API 线索', androidApiPurpose: '定位 URL、WebView、HTTP 和 JNI 入口', androidApiMethod: '提取 JADX 文本中的候选并保留文件和行号',
  kotlinNamesTitle: 'Kotlin 名称线索', kotlinNamesPurpose: '读取注解中的名称候选，不重命名样本', kotlinNamesMethod: '区分 DebugMetadata.c 与 Metadata.d2 引用，不推断名称归属',
  androidCallchainTitle: 'Android API 调用链', androidCallchainPurpose: '沿 JADX 方法关系追踪 API 的调用者和被调用者', androidCallchainMethod: '保留方法签名、来源证据、未解析关系和深度限制',
  nativeXrefPathsTitle: '原生交叉引用路径', nativeXrefPathsPurpose: '串联字符串、函数和调用者的静态关系', nativeXrefPathsMethod: '区分调用、跳转与数据引用，保留地址和待补证据',
  nativeTriageTitle: '原生二进制分诊', nativeTriagePurpose: '汇总架构、符号、字符串和函数线索', nativeTriageMethod: '保留原始适配器观察、地址、偏移及输入证据 ID',
  moduleTitle: '分析模块', moduleMode: '选择方式', moduleAuto: '自动识别', moduleManual: '手动选择',
  moduleAndroid: 'Android / JVM 逆向', moduleNative: '原生二进制 / 固件逆向', moduleWeb: 'Web 分析', moduleIot: 'IoT / 抓包分析',
  moduleHelp: '按任务加载相关技能和工具；自动模式由助手选择，手动模式只使用勾选模块。工具依赖在实际使用时检查',
  moduleReason: '选择依据', modulePending: '当前只启用公共调查能力', moduleResources: '模块技能与工具', moduleSave: '保存模块选择',
}
/** English module selection copy. */
export const moduleEn = {
  scriptParamItems: 'Candidate count limit', scriptCategoryReverse: 'Reverse analysis',
  scriptReverseOutput: 'Structured candidates with input evidence IDs, locations and completeness',
  scriptReverseLimits: 'Use security_analysis with adapter evidence from this asset. Candidates require interpretation or further evidence.',
  androidFingerprintTitle: 'Android fingerprints', androidFingerprintPurpose: 'Locate framework, component and ABI clues', androidFingerprintMethod: 'Match explicit signatures in APK inventory, manifest and decompiler evidence',
  androidApiTitle: 'Android API clues', androidApiPurpose: 'Locate URLs, WebView, HTTP and JNI entry points', androidApiMethod: 'Extract candidates from JADX text with file and line locations',
  kotlinNamesTitle: 'Kotlin name clues', kotlinNamesPurpose: 'Read annotation name candidates without renaming the sample', kotlinNamesMethod: 'Distinguish DebugMetadata.c from Metadata.d2 references without inferring name ownership',
  androidCallchainTitle: 'Android API call paths', androidCallchainPurpose: 'Trace callers and callees through JADX method relations', androidCallchainMethod: 'Retain descriptors, evidence, unresolved relations and depth limits',
  nativeXrefPathsTitle: 'Native cross-reference paths', nativeXrefPathsPurpose: 'Connect static string, function and caller relations', nativeXrefPathsMethod: 'Separate calls, jumps and data references; retain addresses and evidence frontiers',
  nativeTriageTitle: 'Native binary triage', nativeTriagePurpose: 'Collect architecture, symbol, string and function clues', nativeTriageMethod: 'Preserve adapter observations, addresses, offsets and input evidence IDs',
  moduleTitle: 'Analysis modules', moduleMode: 'Selection', moduleAuto: 'Automatic', moduleManual: 'Manual',
  moduleAndroid: 'Android / JVM reverse analysis', moduleNative: 'Native binary / firmware analysis', moduleWeb: 'Web analysis', moduleIot: 'IoT / capture analysis',
  moduleHelp: 'Load skills and tools for this task. The assistant selects automatic modules; manual mode uses checked modules only. Dependencies are checked when used.',
  moduleReason: 'Selection reason', modulePending: 'Only common investigation capabilities are active', moduleResources: 'Module skills and tools', moduleSave: 'Save module selection',
}
