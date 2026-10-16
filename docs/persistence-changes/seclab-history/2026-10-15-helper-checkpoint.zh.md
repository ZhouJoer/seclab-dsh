---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-15-helper-checkpoint

[English](2026-10-15-helper-checkpoint.md) | 中文

## 概述

记录 Advisor 正常档与积极档，以及积极档进展提醒的消息来源。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-15-helper-checkpoint
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-30-security-budget-source"
    after: "b671cd3f45811e31ade83ccea4d1c370de3dba31f9ffcab0096f46b9419934d8"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-09-30-security-budget-source"
    after: "dfd9985f03091cb7364e0f9cebaa023d38e9734be89e5400af919864d3439603"
    decision: same-version
  - root: "event:helper/policy"
    previous: "2026-10-13-helper"
    after: "2ace9654216e50a8b81b998999e43986a8270ba6027cc473a7d33dc97894f2c8"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-09-30-security-budget-source"
    after: "a1785743fb65a13f89ed52b6b54608e5d249012508846e74e03d67cd525f6d6f"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-09-30-security-budget-source"
    after: "1ef5e6d018e549e4a23d19c73d4d79626df0e6fa394b2abe2ed74b0d06910145"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

可选的 mode 字段使已有策略仍可按正常档读取。旧读取方忽略档位元数据，将 helper-checkpoint 来源及其 JSON 元数据作为来源信息保留，无需 Advisor 插件即可回放已记录的消息。不要求修改 Session 格式版本。

<a id="verification"></a>
## 验证

Advisor 与浏览器测试覆盖档位选择、工具说明替换、提醒开关、旧策略恢复、工具结果保持原样与子代理隔离。headless helper 快照记录积极档提醒。

<a id="dev-note"></a>
## 开发备注

无。
