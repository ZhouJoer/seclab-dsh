/** Locale-owned research controls and recoverable failure copy. @module */
export const NS = 'research-workbench'
/** English research surface labels. */
export const en = {
  textOnly: 'Only text resources can be compared', previewUnavailable: 'Enable the document preview plugin to read this PDF', missingFonts: 'Some fonts are unavailable: {fonts}',
  dock: 'Dock in bottom panel', split: 'Split panel',
  wrap: 'Wrap lines', unwrap: 'Preserve columns', title: 'Research', files: 'Working files', close: 'Close', collapse: 'Collapse', fullscreen: 'Fullscreen', restore: 'Restore',
  empty: 'Open a material or choose a working file', noSession: 'Open a conversation to browse working files',
  edit: 'Edit', save: 'Save', discard: 'Discard changes', cancel: 'Cancel', dirty: 'Unsaved changes', confirmClose: 'Save changes before closing?',
  refresh: 'Refresh', compare: 'Use as comparison baseline', comparing: 'Comparison baseline', clearCompare: 'Clear comparison', draftDiff: 'Compare draft',
  incomplete: 'Limited preview — full comparison and editing are unavailable', unavailable: 'The source plugin is unavailable',
  failed: 'Could not load this content. Retry or inspect the details.', retry: 'Retry', details: 'Details', saved: 'File saved',
  saveFailed: 'Save failed or its outcome is unknown. Your draft is retained; compare with the current file before retrying.',
  storage: 'Draft recovery could not be stored. Keep this page open and save or copy your changes.',
  copy: 'Copy', copied: 'Copied', find: 'Find in text', reference: 'Add selection to conversation', referenceFailed: 'The conversation draft changed. Select the text and try again.',
  selection: 'Select text to reference', readonly: 'Read-only', current: 'Open current working file', loading: 'Loading',
  parent: 'Parent directory', tree: 'Files', height: 'Research panel height', groups: 'Source group',
  invalidJson: 'Invalid JSON record', raw: 'Source text', records: 'Records', baseline: 'Saved version', noChanges: 'No differences',
  previous: 'Previous match', next: 'Next match', line: 'Line',
} as const
/** Simplified Chinese research surface labels. */
export const zh: Record<keyof typeof en, string> = {
  textOnly: '仅支持文本材料比较', previewUnavailable: '请启用文档预览插件以阅读此 PDF', missingFonts: '缺少部分字体：{fonts}',
  dock: '停靠到底部面板', split: '拆分面板',
  wrap: '自动换行', unwrap: '保留列宽', title: '研究面板', files: '工作文件', close: '关闭', collapse: '收起', fullscreen: '全屏', restore: '恢复',
  empty: '从材料打开内容，或选择工作文件', noSession: '打开对话后可浏览工作文件',
  edit: '编辑', save: '保存', discard: '放弃修改', cancel: '取消', dirty: '未保存修改', confirmClose: '关闭前保存修改？',
  refresh: '刷新', compare: '设为对比基线', comparing: '对比基线', clearCompare: '清除对比', draftDiff: '比较草稿',
  incomplete: '当前为受限预览，无法完整对比或编辑', unavailable: '此资源插件未启用',
  failed: '内容读取失败，可重试或查看详情', retry: '重试', details: '详情', saved: '文件已保存',
  saveFailed: '保存失败或结果尚不明确，草稿已保留，请与当前文件对比后重试',
  storage: '草稿恢复数据保存失败，请保持页面打开并保存或复制修改',
  copy: '复制', copied: '已复制', find: '查找文本', reference: '将选段加入对话', referenceFailed: '对话草稿已变化，请重新选择文本后添加',
  selection: '选择要引用的文本', readonly: '只读', current: '打开当前工作文件', loading: '正在加载',
  parent: '上级目录', tree: '文件', height: '研究面板高度', groups: '来源分组',
  invalidJson: 'JSON 记录无效', raw: '原文', records: '记录', baseline: '保存版本', noChanges: '没有差异',
  previous: '上一处', next: '下一处', line: '行',
}
