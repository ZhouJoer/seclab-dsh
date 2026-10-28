---
description: "在底部研究面板查看子代理和工具统计，并使用终端。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-research-runtime

[English](README.md) | 中文

## 概述

这个可选插件为研究面板添加子代理、工具统计和终端页面。它使用现有对话和终端服务，不依赖安全工作台或 Git。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在 Web profile 中启用[研究 bundle](../research-workbench-bundle/README.zh.md)并选择对话。子代理列出当前对话记录的直接子代理。打开对话操作通过现有工作区服务导航。

工具统计按工具名称汇总已加载的调用，展示完成、失败、进行中的次数，以及有起始时间时的平均耗时。嵌套调用只计数一次。新建终端会明确在当前对话的工作目录中启动交互式 Shell；结束终端会请求清理进程。清理失败时可以重试。

Office、PDF、图片、HTML 和 Markdown 工作文件通过原生文档预览插件在较大的可拖动、可缩放阅读窗口中打开。窄屏使用原生全屏阅读。底部保留文件列表，安全侧栏保留停靠标签。Office 转换和电子表格支持沿用原生预览提供方；不可变安全资产继续由其来源适配器处理。

禁用加载条目 `research-runtime` 会移除这些页面，保留文件阅读和编辑功能。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现说明</summary>

页面通过 `ctx.researchWorkbench.registerPanel()` 和 `research.panel` slot 注册。注册方保留当前 Session 并订阅组装后的聊天数据。工具统计来自调用和结果元数据，包含嵌套分发，不读取参数或结果正文。

终端使用原生 `terminal.viewport` Factory 渲染。独立的保留方让底部终端不依赖右栏标签；释放插件时移除订阅并释放保留方。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [研究面板](../research-workbench/README.zh.md)
- [原生终端界面](../../client/ui-sidebar-terminal/README.zh.md)
- [终端控制器](../../api/terminal-controller/README.zh.md)

-----

<a id="dev-note"></a>
## 开发备注

无。

-----

<a id="model-experience"></a>
## 模型体验

### 操作员查看

#### 模型看到的内容

通过 `research.panel` 贡献的页面展示现有记录或接受操作员终端输入，不会自动将内容插入模型请求。

#### Token 影响

查看记录和使用操作员终端不增加模型 token。

#### KV Cache 影响

无。本插件不会修改工具定义或提供方请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 统计仅覆盖已加载的对话窗口。进行中包含参数准备。平均耗时包含具有有效起始时间的成功与失败结果。
- 子代理列表描述已记录的直接子代理，不推测实时进程状态。底部终端标签在切换对话时保留，但刷新浏览器后不会恢复。
