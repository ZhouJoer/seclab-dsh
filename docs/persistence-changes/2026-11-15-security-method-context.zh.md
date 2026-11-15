---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-15-security-method-context

[English](2026-11-15-security-method-context.md) | 中文

## 概述

在 user/message 上下文中记录自动提供的安全调查方法与所选模块入口方法。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-15-security-method-context
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-11-07-helper-output-recovery"
    after: "52927bcd06f70d6d9eaf1808c2ffb0070957912ad622b6df3cdc0b71d7a3d4a3"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-11-07-helper-output-recovery"
    after: "cd7e1458bfb5d75f2da7fdd883e83f55ef84312774fe5cd292547dfb199352cc"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-11-07-helper-output-recovery"
    after: "0e2ce831ecc0bbe811ea917eeb51317c5a53c431160ff33b29952a0161e13cda"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-11-07-helper-output-recovery"
    after: "8922edb52da6b100465e8cff4265ebc22b9b5c825f2b63dfd3419da9211da34b"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

新增 security-method 判别值标识指令消息来源，name 和 form 字段必填。已有来源的字段和含义不变。新读取方接受不含自动方法消息的旧日志，并从已有显式技能注入及成功完整的技能结果恢复已保留方法状态。旧读取方保留完整消息文本，将未知来源作为不透明上下文处理，不会将其误认为用户命令、skill 工具调用或权限。Session 格式版本保持不变。

<a id="verification"></a>
## 验证

security-analysis 的 Loader、方法与模块测试共172项通过，沿用3项既有跳过，覆盖任务工作前提供方法、所选入口方法、显式加载去重、种子日志重放、压缩后恢复、精确适配器路由和辅助 Shell 权限不变。无密钥 security-native-citations 场景断言两条自动方法消息均出现在第一次工具调用前。

<a id="dev-note"></a>
## 开发备注

无。
