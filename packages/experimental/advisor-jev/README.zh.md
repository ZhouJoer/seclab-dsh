---
description: "默认关闭的 Jev 停滞判断与只读 Advisor 自动咨询。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-advisor-jev

[English](README.md) | 中文

## 概述

本实验组合通过 TypeSafe Jev 评估近期工具结果，可在下一次主模型请求前调用已配置的 Advisor。默认关闭，依赖 Helper 服务。仅对已启用积极模式的顶层会话生效。[子代理子系统](../../../docs/subsystems/subagent.zh.md)负责咨询执行。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

将本可选组合与 `@deepseek-ai/dsh-helper` 一起加载。独立配置 Helper 的 API 或 Codex 后端。在 `advisor-jev` 配置行设置 `enabled: true`，通过承载秘密的配置表达式提供 `apiKey`；不要提交真实密钥。将当前会话设为 `/advisor proactive`。关闭状态不发出请求。配置错误在加载时报告。

在已安装本包和 Helper 的 profile 补丁中插入以下配置；`JEV_API_KEY` 从启动进程的环境读取：

```yaml
- insert:
    - id: advisor-jev
      name: '@deepseek-ai/dsh-experimental-advisor-jev'
      config:
        enabled: true
        apiKey: !!js process.env.JEV_API_KEY
```

默认地址为 TypeSafe `systemone` API，固定模型为 `jev-1.13.0`。首次检查需要完成三个含工具调用的步骤；后续检查需要新增三个步骤。同一步内的调用只计一次。每回合最多启动一次自动咨询。路由必须为 `consult_advisor`，概率至少 0.85，置信度至少 0.8。这些实验阈值可配置，尚未使用生产任务校准。

`timeoutMs` 限制 Jev 请求及响应体读取的总时间。`maxRequestBytes` 限制完整序列化请求；`maxResponseBytes` 在解析前限制响应大小。`maxEvidenceCalls` 和 `maxFieldChars` 限制保留证据。超限请求报告判断不可用，不将缺失证据静默视为进展。不重试请求，不启用长上下文。仅接受 HTTPS 地址与回环 HTTP 测试服务；拒绝重定向。

精确的有界请求、判断、用量和终态会写入日志，凭据不会写入。自动咨询使用独立 ID，并纳入 Helper 总计。建议先记录，再交给主模型。停止回合会取消两个提供方；关闭 Advisor 也会取消本插件当前操作。插件卸载会取消并等待其未完成工作。

<a id="understand-the-implementation"></a>
## 理解实现

仅 Host 使用的会话投影将已提交事件折叠为有界的任务和调用／结果证据，并统计已完成的工具步骤、检查和自动咨询。步骤前瀑布先委托，再仅对获准继续的步骤执行判断。回放只重建进展，不调用任何提供方。新回合重置检查和咨询预算。手动咨询重置检查间隔与证据窗口。

Jev 接收封闭选项问题，区分进展、停滞、证据不足和外部阻碍。响应经过验证后才参与策略判断。新排队的人类输入会使正在等待的判断失效。Jev 错误追加日志通知，允许主模型继续或手动咨询。Advisor 失败且子代理已清理完成时也会追加通知；清理失败会向上传播并停止依赖工作。不伪造模型发起的工具调用。

<a id="model-experience"></a>
## 模型体验

### 自动咨询

#### 模型看到什么

主模型保留 `advisor` 工具和积极模式提醒。自动咨询后，它收到建议及验证最小推荐步骤的要求。Jev 仅接收有界证据和路由标准。顾问接收该证据以及检查错误假设、提出可验证下一步的固定问题；已有只读限制继续生效。

#### Token 影响

每次判断发送独立的 Jev 请求。触发的咨询消耗所选 Advisor 提供方额度，返回建议增加主模型输入 token。缺失用量保持缺失；Jev 与 Advisor 用量分别记录。

#### KV Cache 影响

主模型追加建议或失败通知，不改写之前的消息。Jev 请求与每次 Advisor 咨询使用独立上下文。

## 已知限制与后续工作
<a id="known-limitations-and-deferred-work"></a>

- 证据覆盖当前回合的有界片段；没有长期策略摘要或最终答案复核。
- 证据截断可能隐藏决定性观察。结构化结果不证明停滞判断准确，仍需真实任务校准。
- 提供方集成通过本地 HTTP 测试服务验证。真实 TypeSafe 的准确率、延迟和账号可用性需要另行配置 API 测试。
- 配置由 profile 管理，没有专用 Jev 设置页面或恢复后的自动重试。

<a id="dev-note"></a>
### 开发备注

无。
