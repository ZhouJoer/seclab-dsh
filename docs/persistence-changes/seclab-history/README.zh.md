---
description: "保留上游合入前分支中的安全工作台持久化确认记录。"
---

# 安全工作台分支持久化历史

[English](README.md) | 中文

## 摘要

这些确认记录及其 schema 快照保留了上游合入前的分支历史，作为当前线性确认链之外的历史证据。[合入记录](../2026-10-16-upstream-alpha4-security.zh.md)针对上游 schema 确认合并后的新增内容。

## 目录

- [记录](#records)
- [开发者说明](#dev-note)

<a id="records"></a>
## 记录

- [安全分析预算归属](2026-09-30-security-budget-source.zh.md)
- [Advisor 模式与检查点](2026-10-15-helper-checkpoint.zh.md)
- [任务上下文归属](2026-10-16-security-task-context.zh.md)

原始机器声明与完整 after schema 均保持不变。记录中的前驱标识描述原分支，不延伸合入后的历史链。

<a id="dev-note"></a>
## 开发者说明

无。
