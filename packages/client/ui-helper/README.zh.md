---
description: "在浏览器中配置高级顾问并检查每个会话的调用用量。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-helper

[English](README.md) | 中文

## 概述

选择高级模型、管理原生 ChatGPT 登录，并在对话中查看求助结果。保存设置不会发起推理请求；独立的测试会话使用已保存的配置，并消耗提供方用量。

## 目录

- [使用本包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

security Web 组合将本插件与 [Helper](../../subagent/helper/README.zh.md) 一同挂载。在其他 Web 组合中，将 `@deepseek-ai/dsh-client-ui-helper` 与 Helper 服务及现有对话、插件设置和工作区服务一同挂载。本插件没有配置字段。

点击输入框的“Helper → 配置高级模型 / Codex”，或打开“插件 → Helper · 高级模型 / Codex”。打开配置页保留当前会话及其 Helper 开关。选择已有 API 路由或原生 Codex，选择支持的思考档位，然后保存。切换模型时，如目录提供 `high` 则优先选择；否则须明确选择支持的档位或提供方默认。失效的已保存选项仍会显示，并阻止测试。API 凭据及自定义思考映射在“模型”页面配置。

ChatGPT 控件显示公开账号信息，提供官方登录链接、取消待完成登录及刷新账号和模型目录。认证由 Codex 管理。新建测试会话前须选择工作区；测试仅在该新会话中开启 Helper，主模型不变。

输入框菜单控制当前会话，并显示持久化的次数、状态、耗时和 token 汇总。展开 Helper 工具调用可查看提交材料、建议及所报告的模型信息。API 调用提供完整子代理日志入口。缺失的 token 字段显示“未报告”；历史分页及重连不会按可见卡片重新计算次数。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节——点击展开</summary>

控制器通过共享设置表单暂存偏好，并独立刷新账号与模型目录。卡片将原始工具块与 Helper 会话投影结合，因此原生调用与 PTC 子调用使用同一份持久化事实。本包不发布运行时不变量伴生入口：视图直接派生自所属服务，不维护第二份可变来源。

</details>

-----

<a id="model-experience"></a>
## 模型体验

### 测试会话

#### 模型看到的内容

显式测试操作发送本地化用户消息，要求主模型调用一次 `helper`，只读检查 README 标题。[Helper 服务](../../subagent/helper/README.zh.md#model-experience)负责工具指令。

#### Token 影响

测试消耗一个主模型轮次和所选专家的求助用量。保存偏好不发送模型请求。

#### KV Cache 影响

测试创建独立会话和请求前缀，不向已有工作会话追加内容。

## 已知限制与待办
<a id="known-limitations-and-deferred-work"></a>

浏览器只能展示所选后端提供的事实。

- Codex 的中间工具活动没有 DSH 子代理日志视图。
- 账号与模型目录错误需要明确刷新或修复配置。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
