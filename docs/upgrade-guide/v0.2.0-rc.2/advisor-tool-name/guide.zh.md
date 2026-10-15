---
kind: upgrade-guide
description: "模型工具调用中的 helper 更名为 advisor。"
---

# 使用 advisor 咨询专家

[English](guide.md) | 中文

## 变更

模型可见的 `helper` 工具更名为 `advisor`。Web 控件使用 Advisor 名称，并提供正常档与积极档。明确指定旧工具名的提示词和脚本需要使用新名称。已有咨询记录仍可读取。

## 迁移

1. 将专家咨询提示词和工具调用中的 `helper` 替换为 `advisor`，工具参数保持原样。
2. 使用 `/advisor normal`、`/advisor proactive` 或 `/advisor off` 选择当前会话策略。`/advisor on` 选择正常档；`/helper` 仍是命令别名。保留已有 `helper` 配置键与包引用。
3. 打开 Web Advisor 菜单并选择档位，确认下一次模型请求提供 `advisor`，且历史咨询卡片仍可查看。
