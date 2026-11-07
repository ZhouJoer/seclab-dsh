---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-07-helper-output-recovery

[English](2026-11-07-helper-output-recovery.md) | 中文

## 概述

新增 helper-output-recovery 提示来源，引用此前未完整交付的 assistant 消息序号。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-07-helper-output-recovery
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-18-automatic-advisor-jev"
    after: "3ce401e2cc3b30f89d53c935221b81e6098c06ab7b265b931213d73b4733423a"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-18-automatic-advisor-jev"
    after: "7b75661c8a19ea6c4eff838314f1c33d84e30cd9acd5c9bbb18bdfce7b2146ff"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-18-automatic-advisor-jev"
    after: "fa1065e78d8ee7e339de44498ff81ebe4005b56e8a8c245938db27c603e77974"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-18-automatic-advisor-jev"
    after: "5093f651a360050c3d82b60fa7161f96b454bd35171ff6828905497e55c3bc98"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

既有来源种类和事件字段的含义不变。新增种类使用现有 notice 形式；旧读取方通过可扩展消息来源表示保留文本，不会据此推断研究成功。新读取方接受不含该种类的历史消息，仅从已记录的恢复提示及其后续响应重建恢复状态。不会重写已有 Session 代际或已定稿记录。

<a id="verification"></a>
## 验证

Helper 单元与 Loader 测试通过（39 项），覆盖一次恢复、重复截断、空输出、取消、工具拒绝、父子隔离、回放及用户消息优先级。安全工作台 Loader 测试通过（3 项），覆盖预算封闭后的交付和普通内部继续消息的抑制。

<a id="dev-note"></a>
## 开发备注

无。
