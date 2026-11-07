---
kind: upgrade-guide
description: "无工具 Helper API 咨询会拒绝移除必需顾问职责段的系统提示覆盖。"
---

# 在组合系统提示中保留无工具 Helper 职责

[English](guide.md) | 中文

## 变更

Host 插件通过 `helper.consultAutomatically` 指定 `toolAccess: 'none'` 时，以前只依靠 user 角色的顾问指令，同时继承部署的系统提示。此类调用现在保留原策略，并在末尾追加系统职责段，将执行和任务完成交由父代理负责。若完整提示或组装覆盖移除了该段，咨询会在模型推理前失败并释放子代理。只读 API 咨询、手动 Advisor 调用和 Codex 咨询保持不变。

## 迁移

1. 检查对无工具 API 子代理生效的提示贡献。在适用的 `agent.cordis.yml` 中，将 `@deepseek-ai/dsh-persona` 行的 `config.complete` 设为 `false`，并将必需策略保留在 `config.prefix` 或 `config.suffix` 中。自定义 `systemPrompt.section()` 注册应移除 `complete: true`，同时保留原文。自定义 `system-prompt/assemble` 监听器应继续委托后续监听器，并保留 Helper 职责段。
2. 若部署必须使用精确的完整提示，应停止在该配置下请求无工具咨询。不要为了使咨询运行而移除授权或安全策略。
3. 确认无工具子代理记录的 `system/message` 保留部署策略，并以 `Advisor role for this consultation` 职责段结束；请求仍不包含工具。冲突配置会记录失败的子代理回合，诊断包含 `Tool-free Advisor requires its final system role`，父代理的 `helper/auto-end` 事件状态为错误；不会发送推理请求。咨询行为详见 [Helper README](../../../../packages/subagent/helper/README.zh.md)。
