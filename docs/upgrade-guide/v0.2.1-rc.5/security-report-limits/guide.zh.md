---
kind: upgrade-guide
description: "Host 扩展直接从控制器选项读取安全报告的上限。"
---

# 从控制器选项读取报告上限

[English](guide.md) | 中文

## 变更

使用 `SecurityController.options.reportLimits` 的 Host 扩展现在直接从 `options` 读取 `reportMaxFindings` 和 `maxOutputBytes`。这两个字段也对应现有的部署配置项。

## 迁移

1. 将 `options.reportLimits.maxFindings` 替换为 `options.reportMaxFindings`，将 `options.reportLimits.outputBytes` 替换为 `options.maxOutputBytes`。
2. 如果扩展自行构造控制器选项，请提供这两个数值上限。运行扩展的类型检查，并按配置的上限发布一份报告。
