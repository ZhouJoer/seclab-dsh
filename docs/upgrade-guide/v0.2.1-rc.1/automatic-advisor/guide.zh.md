---
kind: upgrade-guide
description: "自动 Advisor 记录需要能识别新增事件类型的读取器。"
---

# 自动 Advisor 会话读取器

[English](guide.md) | 中文

## 变更

启用可选 Jev bundle 会写入必读的自动咨询与评估事件。旧读取器拒绝包含这些事件的会话。Helper 投影条目现在可以使用 `consultationId` 而非工具 `callId` 标识咨询。默认关闭配置不会写入新增自动咨询事件。

## 迁移

1. 启用 bundle 前同步升级会话读取器和 SDK 运行时。参见[持久化确认记录](../../../persistence-changes/2026-10-18-automatic-advisor-jev.zh.md)。
2. `HelperState.calls` 消费方必须通过 `consultationId` 区分自动条目，不能假定每次咨询都有工具调用。
3. 运行一次已配置的咨询，确认读取器能接受 `helper/auto-start` 和含已记录答案的 `helper/auto-end`。
