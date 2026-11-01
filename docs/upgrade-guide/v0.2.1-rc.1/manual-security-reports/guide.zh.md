---
kind: upgrade-guide
description: "安全任务完成只保存结论，不再自动发布报告。"
---

# 显式生成安全报告

[English](guide.md) | 中文

## 变更

`security_command` 的 `complete-task` 动作保存已验证结论，完成状态为 `saved`，不再发布报告。已有报告仍可读取。实验性安全工作台的消费方需要接受 `saved` 状态，以及已保存结论与报告上可选的检查点／证据引用。

## 迁移

1. 使用 `security_complete` 或 `complete-task` 提交结果和证据，不再从该回执期待报告标识。
2. 通过报告区控件生成报告，或在用户明确要求后调用 `security_command` 的 `report` 动作。
3. 确认提交只显示已保存结论而没有报告；手动生成后返回报告链接。发布失败保留提交以便重试。
