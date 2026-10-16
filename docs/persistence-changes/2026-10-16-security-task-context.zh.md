---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-16-security-task-context

[English](2026-10-16-security-task-context.md) | 中文

## 概述

新增 security-task-context 消息来源，标识操作者声明与任务背景。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-16-security-task-context
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-15-helper-checkpoint"
    after: "7fed426009307b1cdd263736102b8fdb6abe133dc145d52f1d94f2d898e4555a"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-15-helper-checkpoint"
    after: "0b76e60e47faba9a3cca29d341baedad6bade0e9c4bd6ed4b2f2c96c9ee817e5"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-15-helper-checkpoint"
    after: "c8fc4d7b08e9c7f7ca96339ee4521c8a07b0c5ebbca028e9fdf73d26de319606"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-15-helper-checkpoint"
    after: "d73f47655ee83ddff7e262062b02c2edc0df46fd0d99b1b7e859e27cc4b14e1c"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

新来源在已有模型可见消息中记录归属信息，不改变其内容和回放语义。已有消息仍然有效，不要求授权声明。Session 投影从事件重建最新快照及其保留状态，不改写历史消息。

<a id="verification"></a>
## 验证

node node_modules/vitest/vitest.mjs run scripts/client-bundle-purity.spec.ts packages/experimental/security-analysis/tests/task-context-projection.spec.ts：43 个测试通过，包含投影重新挂载、压缩移除、到期和清除。

<a id="dev-note"></a>
## 开发备注

无。
