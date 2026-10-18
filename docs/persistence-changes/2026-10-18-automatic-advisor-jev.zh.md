---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-18-automatic-advisor-jev

[English](2026-10-18-automatic-advisor-jev.md) | 中文

## 概述

新增自动 Advisor 咨询与 Jev 进展决策的日志记录。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-18-automatic-advisor-jev
baseline: false
changes:
  - root: "event:advisor-jev/end"
    previous: null
    after: "20686cb8d3c4c9695cffa1b977d4359ade0a49a3c602819f651c30746b32537c"
    decision: same-version
  - root: "event:advisor-jev/start"
    previous: null
    after: "956fc811a25eb128e0fefdd69935e13c6cd885466428eb69181304eb247a79ff"
    decision: same-version
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-16-upstream-alpha4-security"
    after: "db9ea24689cc6db48459f61cecc6007aeaa308814ba819273a7427f561a1da07"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-16-upstream-alpha4-security"
    after: "d79f11c2c65107b317578fd73abead61f13c28ca559b903f34e3e70591ff5fbe"
    decision: same-version
  - root: "event:helper/auto-end"
    previous: null
    after: "7d14e49021273336b473a38d2a4ec06eabcedb9fd278522e0d8929c85c6a3364"
    decision: same-version
  - root: "event:helper/auto-start"
    previous: null
    after: "5213af0084150cd0c98f10f85cea07da08266983306dbd8b5509ea79e697d08c"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-16-upstream-alpha4-security"
    after: "abb3ee6648311fecc43e4592024f502e360b5eebaccc3a067f1b9c35f46e740d"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-16-upstream-alpha4-security"
    after: "5a61344a559e3bdbfdde55ae454c4f9cc58db83fa29eff86b6cb69250f00b0c7"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

现有 helper/start 与 helper/end 载荷保持不变。新增 helper/auto-start、helper/auto-end、advisor-jev/start 和 advisor-jev/end 判别项为必读事件，旧读取器拒绝读取，避免静默丢失模型可见建议。新读取器继续支持既有日志。Helper 投影状态版本 3 重建缓存状态，不修改已发布代次。

<a id="verification"></a>
## 验证

Jev Loader、策略测试及既有 Helper 测试通过；advisor-jev SDK 手写场景已通过构建后的 dsh SDK profile 刷新。

<a id="dev-note"></a>
## 开发备注

无。
