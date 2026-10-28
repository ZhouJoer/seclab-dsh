---
description: "组合可独立启停的研究阅读、编辑和可选 运行工具 查看功能。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-research-workbench-bundle

[English](README.md) | 中文

## 概述

向普通 Web profile 添加底部研究面板，无需安全工作台。bundle 包含两个可独立禁用的条目。安全资源动作由独立的 research-security 提供。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

将 `@deepseek-ai/dsh-experimental-research-workbench-bundle` 安装到 profile，并在 `dsh.profile.bundles` 中放在 base 和 Web 应用 bundle 之后，再通过 `dsh --profile <name>` 启动。安全源码启动器会自动包含这个工作区开发依赖。

使用加载条目 ID `research-workbench` 与 `research-runtime` 独立禁用或配置。禁用 运行工具 不影响文件阅读和编辑。安全适配器使用其自己的 `research-security` 条目禁用。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现说明</summary>

[组合补丁](cordis.patch.yml)组合[研究面板](../research-workbench/README.zh.md)和[运行工具 扩展](../research-runtime/README.zh.md)。各包共用本仓库和发布版本，独立声明依赖、配置与测试。不需要 运行工具 submodule。

交互设计参考 [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)。本实现使用原生 Cordis 资源、插槽和子进程服务，没有复制上游实现源码。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [架构](../../../docs/architecture.zh.md)
- [安全工作台](../client-ui-security-analysis/README.zh.md)

-----

<a id="dev-note"></a>
## 开发备注

无。

-----

<a id="model-experience"></a>
## 模型体验

### 操作员研究

#### 模型看到的内容

浏览不会创建模型请求。`research.reference` 将带来源的选段插入操作员输入草稿，显式发送后沿用用户消息记录。

#### Token 影响

仅显式发送的引用占用对话上下文；读取与编辑不增加模型 token。

#### KV Cache 影响

插件不修改模型工具定义或系统提示。提交的用户消息按现有对话路径处理。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 本实验性 bundle 面向 Web 客户端。不包含 Git、独立聊天或独立发布工具。
