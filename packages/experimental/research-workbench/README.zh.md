---
description: "在可收起的研究面板中阅读源码材料、比较固定版本并编辑当前工作文件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-research-workbench

[English](README.md) | 中文

## 概述

使用应用底部的研究面板入口。工作文件来自所选对话；安全材料和运行工具由独立可选插件提供。未保存的编辑通过当前浏览器标签页恢复。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

`open(resource, { floating: true })` 无需聊天即可打开大窗口。来源可返回完整的只读 PDF 或光栅图片字节；二进制内容不能编辑，也不能参与文本比较。PDF 使用可选的 `document.pdf` Factory。

-----

<a id="use-this-package"></a>
## 使用本包

在包含文件系统、Session 查询、工作目录、sandbox-policy 和常规客户端服务的 Web profile 中启用本插件。加载配置可设置 `maxTextBytes`（默认 2097152）和 `maxEntries`（默认 2000）。

[研究 bundle](../research-workbench-bundle/README.zh.md)组合文件阅读器和可选运行工具。关闭修改过的标签时选择保存、放弃或取消。选择文本后使用加入对话按钮，可插入带来源的引用而不发送消息。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现说明</summary>

浏览器服务 `researchWorkbench` 注册资源适配器和附加面板，并返回清理函数。单个根 Factory 声明 `research.panel` 与 `research.reference`，由 `shell.bottom` 和 `shell.overlay` 共用。参见[适配类型](src/client/contract.ts)、[视图状态](src/client/store.ts)和[文件服务](src/index.ts)。

`registerPreview()` 为显式打开操作贡献可选阅读器。阅读器返回是否已处理资源；未匹配的资源和比较操作继续使用文本适配器。释放阅读器会移除其路由，不改变现有文本草稿。

读取与保存均解析 Session 当前目录和文件规范身份。保存要求原目录身份、目标身份和版本匹配，再调用 `replaceIfVersion`；不会创建已删除的文件。历史资源适配器不提供保存操作。

文件标签使用原生停靠栏。将标签拖出底部区域可打开能移动和缩放的预览窗口，使用窗口的停靠按钮返回底部。窄屏将阅读器保留在同一个全屏层中。

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

- 只允许编辑当前工作目录内已有的 UTF-8 文本文件。二进制、无效 UTF-8 和混合换行文件保持只读。标记为不完整的预览不能参与完整比较。草稿恢复受浏览器存储容量限制，存储失败会在面板中显示。
