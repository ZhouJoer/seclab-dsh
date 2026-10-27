---
description: "在独立研究面板中打开不可变的安全材料与证据。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-research-security

[English](README.md) | 中文

## 概述

在材料或证据预览旁使用“大窗口预览”或“加入比较”。资源按项目身份分组。禁用本适配器后动作消失，原安全预览仍可使用。

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

在同一个 Web profile 中同时启用 `research-security`、安全工作台和研究面板。本插件没有额外配置或系统可执行文件依赖。

安全 profile 的源码启动器会选择研究 bundle。历史材料在可拖动、可调整大小的大窗口中打开，小于 768px 时使用全屏阅读。材料保持只读，无需打开聊天。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现说明</summary>

安全 UI 拥有单个 `security.resource.actions` Factory，并由它声明 `security.resource.actions.item`。本适配器通过该插槽贡献按钮，并读取 `projectMaterialDocument` 或 `projectArtifact`；安全 UI 不导入研究实现。参见[Client 入口](src/client/index.tsx)。

材料身份包含项目、资产和快照相对路径。证据身份包含项目、证据和制品摘要。快照同步不会替换已打开的身份。

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

- 文本沿用安全服务的预览上限；截断文本和二进制文档不能作为完整差异输入。PDF 和光栅图片读取快照字节。Office 文件使用可选的本地 Office-to-PDF 服务及其配置上限。其他二进制文件显示字节前缀。
