---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-16-upstream-alpha4-security

[English](2026-10-16-upstream-alpha4-security.md) | 中文

## 概述

在合入后的上游 schema 中确认安全分析预算、任务上下文归属和 Advisor 模式元数据。原分支确认记录与 after schema 保留在 seclab-history/。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-16-upstream-alpha4-security
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-13-user-rpc-principal"
    after: "d54fe1ede2e567e50bc48d52d3defec71ede3de8cd8bd05f4e1928b31357588e"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-13-user-rpc-principal"
    after: "e93e69601800a1ae3e5f2a4c04e06eb368eab92711e79b02de275c757748520e"
    decision: same-version
  - root: "event:helper/policy"
    previous: "2026-10-13-helper"
    after: "2ace9654216e50a8b81b998999e43986a8270ba6027cc473a7d33dc97894f2c8"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-13-user-rpc-principal"
    after: "ee508c910ea1ef6331589e6d6ff84874b9f4b1e4260354c2ad55fc7b8c7127a8"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-13-user-rpc-principal"
    after: "7a9c9a2726f912cd9041b442819cd518767fcd3b5848abbecbea5d51cade20b9"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有日志保持有效。新版读取器保留原有消息内容和归属。旧版读取器无需生产插件即可保留未知归属 kind 及其 JSON 元数据；这些来源不授予权限，也不要求新的回放解释。Advisor mode 为可选，缺失时保持正常模式。已有 Helper 策略、咨询及用量事件仍可读取。上游 V4 定稿检查点和已发布 Session 代际保持不变。

<a id="verification"></a>
## 验证

安全 Loader、分析脚本与报告导出定向回归：116 项通过，2 项跳过。Advisor 单元测试：8 项通过。真实 Web 任务完成 security_scope、security_radare2、security_evidence 和一次成功的 Advisor 咨询，保存了证据并生成最终回复。

<a id="dev-note"></a>
## 开发备注

无。
