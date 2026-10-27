/** Bottom tool pages follow the application's active locale. @module */
export const en = {
  agents: 'Subagents', tools: 'Tool statistics', terminal: 'Terminal',
  noSession: 'Select a conversation to inspect its tools', empty: 'No records in this conversation',
  toolsHelp: 'Loaded conversation records, including nested calls. In progress includes argument preparation; average duration uses finished calls with a recorded start time.',
  tool: 'Tool', calls: 'Calls', completed: 'Completed', failed: 'Failed', active: 'In progress', averageDuration: 'Average duration',
  unnamedTool: 'Unrecorded tool name', recorded: 'Recorded',
  elapsed: '{value} ms',
  open: 'Open conversation', newTerminal: 'New terminal', closeTerminal: 'End terminal',
  terminalHelp: 'Start an interactive shell in this conversation’s working directory',
  agentHelp: 'Direct children recorded by the current conversation',
  loading: 'Loading', closeFailed: 'Terminal cleanup failed. Retry ending the terminal.', retry: 'Retry',
} as const
/** Simplified Chinese runtime page labels. */
export const zh: Record<keyof typeof en, string> = {
  agents: '子代理', tools: '工具统计', terminal: '终端',
  noSession: '选择对话后查看工具记录', empty: '当前对话暂无记录',
  toolsHelp: '当前已加载的对话记录，包含嵌套调用。进行中包含参数准备；平均耗时仅计算有起始时间的已结束调用',
  tool: '工具', calls: '调用', completed: '完成', failed: '失败', active: '进行中', averageDuration: '平均耗时',
  unnamedTool: '未记录工具名称', recorded: '已记录',
  elapsed: '{value} 毫秒',
  open: '打开对话', newTerminal: '新建终端', closeTerminal: '结束终端',
  terminalHelp: '在当前对话的工作目录中启动交互式终端',
  agentHelp: '当前对话记录的直接子代理',
  loading: '正在加载', closeFailed: '终端清理失败，请重试结束终端', retry: '重试',
}
declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { 'research-runtime': keyof typeof en } }
