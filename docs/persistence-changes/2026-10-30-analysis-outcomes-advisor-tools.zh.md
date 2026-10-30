---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-30-analysis-outcomes-advisor-tools

[English](2026-10-30-analysis-outcomes-advisor-tools.md) | 中文

## 概述

将已保存任务结论与用户触发的报告发布分离，增加明确的调查引用，并保留有界的原生 advisor 工具记录。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-30-analysis-outcomes-advisor-tools
baseline: false
changes:
  - root: "event:helper/codex-trace"
    previous: null
    after: "f12574b201f3c42fb53289c254bcdb9c66ef94a9810094ebae794679f8be6f17"
    decision: same-version
  - root: "event:subagent-codex/tool"
    previous: null
    after: "f027250e1441d585d0155fab972fbe39e7bda9bb22d0c7cf3d01a93a3eb6874d"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有任务完成状态与报告仍可读取，旧数据可以缺少新增的调查引用。旧版严格安全记录读取器会拒绝新的 saved 状态，不会误当作已发布。新的 helper/codex-trace 和 subagent-codex/tool 会话事件判别值标识审计记录，不代表工具执行或模型消息。不认识必读事件的读取器会拒绝该会话，不会将其载荷按其他事件解释。新版读取器保留已有事件。判别值可以防止不安全解释，无需改变会话信封版本。

<a id="verification"></a>
## 验证

安全工作台、调查图、helper 咨询、Codex 协议生命周期及有界工具记录共 181 项聚焦测试通过，覆盖报告重试／取消、发布前保存结论、旧报告引用、原生记录关联及父模型消息保持不变。

<a id="dev-note"></a>
## 开发备注

无。
