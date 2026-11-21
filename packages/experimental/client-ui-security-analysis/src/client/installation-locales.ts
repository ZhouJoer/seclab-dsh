/** Operator installation management labels. @module */
export const installationZh = {
  installationManage: '安装与维护工具', installationRoot: '统一安装目录', installationRootHelp: '后续工具安装到此目录，可跨项目复用。更改目录不会移动或删除已有工具。',
  installationChooseDirectory: '选择目录', installationSaveRoot: '保存安装目录', installationChooseCurrent: '使用此目录', installationParent: '上一级',
  installationRecipe: '工具包', installationAction: '操作', installationInstall: '安装', installationRepair: '修复', installationUpgrade: '更新',
  installationPreview: '预览安装计划', installationConfirm: '确认并执行', installationDiscard: '关闭预览', installationReview: '核对安装计划',
  installationDestination: '目标目录', installationVersion: '版本', installationSteps: '执行步骤',
  installationConsent: '我已核对工具、来源、目标目录和执行步骤', installationExceptions: '额外授权', installationHistory: '安装记录',
  installationOwned: '共享安装', installationRemove: '预览清理', installationLogs: '日志与诊断', installationCancel: '取消安装', installationReconcile: '重新检查结果',
  installationRefresh: '刷新记录', installationEmpty: '还没有安装记录', installationNoRecipes: '此环境没有自动安装工具包，可在工具目录中配置已有安装',
  installationNoRoot: '请先选择统一安装目录', installationLogGap: '较早的日志已超过保留上限', installationReadOnly: '当前管理器为只读',
  installationActionError: '操作未完成，请查看详情并重试', installationFinished: '安装状态已更新',
  installationErrorDetails: '查看错误详情', installationBrowse: '浏览安装目录', installationPrivate: 'DSH 管理', installationExternal: '外部管理', installationSystem: '系统组件',
  installationPlanned: '等待执行', installationPreparing: '准备中', installationInstalling: '安装中', installationVerifying: '验证中',
  installationCommitting: '保存选择中', installationCancelling: '正在取消', installationCompleted: '已完成', installationCancelled: '已取消',
  installationFailed: '失败', installationInterrupted: '意外中断', installationUnknown: '结果待确认', installationUnbound: '已安装，选择未保存',
}

/** English labels share the complete Chinese key set. */
export const installationEn: Record<keyof typeof installationZh, string> = {
  installationManage: 'Install and maintain tools', installationRoot: 'Shared installation directory', installationRootHelp: 'Future tools install here and can be reused across projects. Changing this directory does not move or remove existing tools.',
  installationChooseDirectory: 'Choose directory', installationSaveRoot: 'Save installation directory', installationChooseCurrent: 'Use this directory', installationParent: 'Parent directory',
  installationRecipe: 'Tool package', installationAction: 'Action', installationInstall: 'Install', installationRepair: 'Repair', installationUpgrade: 'Upgrade',
  installationPreview: 'Preview installation', installationConfirm: 'Confirm and apply', installationDiscard: 'Close preview', installationReview: 'Review installation plan',
  installationDestination: 'Destination', installationVersion: 'Version', installationSteps: 'Execution steps',
  installationConsent: 'I reviewed the tools, sources, destination and execution steps', installationExceptions: 'Additional permissions', installationHistory: 'Installation history',
  installationOwned: 'Shared installations', installationRemove: 'Preview removal', installationLogs: 'Logs and diagnostics', installationCancel: 'Cancel installation', installationReconcile: 'Reconcile outcome',
  installationRefresh: 'Refresh history', installationEmpty: 'No installation history yet', installationNoRecipes: 'No automated recipe is available for this environment. Configure an existing installation in the tool directory.',
  installationNoRoot: 'Choose a shared installation directory first', installationLogGap: 'Earlier logs exceeded the retention limit', installationReadOnly: 'This manager is read-only',
  installationActionError: 'The action did not finish. Review the details and retry.', installationFinished: 'Installation status updated',
  installationErrorDetails: 'View error details', installationBrowse: 'Browse installation directories', installationPrivate: 'Managed by DSH', installationExternal: 'Externally managed', installationSystem: 'System component',
  installationPlanned: 'Queued', installationPreparing: 'Preparing', installationInstalling: 'Installing', installationVerifying: 'Verifying',
  installationCommitting: 'Saving selections', installationCancelling: 'Cancelling', installationCompleted: 'Completed', installationCancelled: 'Cancelled',
  installationFailed: 'Failed', installationInterrupted: 'Interrupted', installationUnknown: 'Outcome uncertain', installationUnbound: 'Installed; selection not saved',
}
