---
kind: upgrade-guide
description: "安全专用分析操作现在要求先选择任务模块。"
---

# 安全分析模块

[English](guide.md) | 中文

## 变更

安全专用技能和工具要求任务已启用相应模块。缺少 `moduleSelection` 的旧任务仍可读取，默认以自动模式提供公共调查能力。此前直接调用专用 provider 的集成需要先选择模块。包含模块选择或 JAR 资产的已保存任务需要更新后的安全插件；旧版严格读取器可能拒绝这些记录。Session 格式不变。 `security_scope` 会拒绝未知记录类型；材料使用 `asset`，任务使用 `engagement`，省略 `kind` 可列出所有类型。

## 迁移

1. 打开任务，使用自动识别，或在任务详情手动选择模块。
2. 模型或命令集成先读取 `security_capabilities`，再使用最新修订号提交 `security_command`，action 为 `modules`，selection 为 `{mode:"auto",modules:["reverse.android"],reason:"Imported APK"}`。手动选择由操作者管理。
3. 调用专用适配器前检查活动资源目录。JNI 调查可组合 `reverse.android` 和 `reverse.native`。已有执行审批及仅适配器模式的 Shell 限制仍然生效。
