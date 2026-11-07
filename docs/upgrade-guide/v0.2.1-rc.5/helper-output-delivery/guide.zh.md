---
kind: upgrade-guide
description: "Helper API 咨询具有显式输出上限，并拒绝不完整答案。"
---

# 配置 Helper API 输出与交付恢复

[English](guide.md) | 中文

## 变更

手动 API 咨询现在使用 `apiMaxTokens`（默认 32768，包含提供方计入的推理 tokens），而不是模型的完整输出额度。截断或完成时为空的答案会使咨询失败。主模型不再在第一次工具结果后收到咨询提醒。积极模式指导要求先执行检查，再围绕仍未解决的具体问题咨询。

## 迁移

1. 在配置方案的 `cordis.patch.yml` 中，为 `@deepseek-ai/dsh-helper` 行设置所需且受支持的 `apiMaxTokens` 输出额度。检查是否有调用方把部分文本当成完整答案。
2. 若要在输出上限结束或空完成后允许一次无工具交付请求，设置 `apiRecoveryEnabled: true`，将 `apiRecoveryReasoningEffort` 设为所选模型支持的档位，并通过 `apiRecoveryMaxTokens` 指定交付额度。默认值依次为 `false`、`low` 和 8192。恢复依据已有证据交付，不能执行提议的检查；不会重试网络错误、拒绝、取消或结果未知的调用。自动调用方通过自己的 `ApiConsultationOptions.recovery` 配置恢复；省略表示该次调用禁用恢复。
3. 确认截断分析保留了原失败回合。若运行恢复，子 Session 包含 `helper-output-recovery` 提示和至多一次无工具交付请求。只有完整且非空的交付才能完成咨询；再次不完整仍为错误。没有可用答案的咨询不能建立已验证结论。详见 [Helper README](../../../../packages/subagent/helper/README.zh.md)。
