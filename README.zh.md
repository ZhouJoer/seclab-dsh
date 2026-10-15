---
description: "AI 辅助的安全研究工作台，面向逆向、Web、Android 与 IoT，提供可追溯证据与受控验证。"
---

# SecLab DSH · 安全研究工作台

[English](README.md) | 中文

**围绕安全问题展开调查，让证据可追溯、结论可复核。**

面向逆向、Web、Android 与 IoT 安全研究的 AI 辅助工作台。导入源码、二进制、固件或抓包材料，描述研究问题，与 agent（智能体）协作收集证据、检验假设，并形成可以查看依据的发现。分析者控制调查范围、复核结论，并审批专用的运行时验证计划。

本项目是基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 独立开发的 fork。DSH 与 Cordis 提供 agent 运行时和插件框架；本项目聚焦安全调查、证据管理和分析者的使用体验。

[开始使用](#run) · [高层架构](docs/security-architecture.zh.md) · [使用指南](docs/user/guide/security-analysis.zh.md) · [能力与限制](packages/experimental/security-analysis/README.zh.md) · [路线图](docs/roadmaps/security-analysis.zh.md)

> [!IMPORTANT]
>
> 安全扩展目前处于实验阶段，工具可用性与验证覆盖取决于具体环境。工具调用成功或生成报告不代表漏洞成立；发现必须保留证据、复核依据和不确定性。

## 你可以做什么

- **跨材料调查。** 围绕同一个研究问题，组合源码检查、逆向分析、抓包观察和特定环境中的工具。
- **从结论追溯证据。** 查看材料、检查项、观察、委派任务和独立复核，导出绑定项目修订版本的报告。
- **委派明确的问题。** 让专门的 agent 负责侦察、逆向、Web 分析、公开资料研究和复核，并限定可用资产与工具。
- **控制验证执行。** 审批专用执行计划的具体版本前，检查目标、脚本、预期观察、限制和清理方式。原生分析脚本通过另一条执行路径遵循现有 DSH 权限。
- **复用方法和知识。** 管理工具与环境，使用分析技能和脚本，并在发布可复用知识前进行人工审核。

## 研究案例

### 固件：test1 前端资源恢复

`test1` 围绕 ARM HTTP 服务程序和加密资源包，完成脱壳、实现分析与前端资源恢复。记录中的成果为 **190/190 个前端资源已恢复**，包括 63 个 ASP 页面、27 个 JavaScript 文件和 3 个样式表。本地输出目录包含附带产物，共 192 个文件。

以下截图来自真实的 `test1` 中文工作台。此处的成功范围是资源恢复；完整 HTTP 服务运行与逐资源 GCM 认证标签校验仍是后续工作。历史观察保留“证据不完整”标记，恢复成功不等于漏洞已确认。

#### 分析助手

查看恢复结果、检查交付产物，并在同一任务中继续研究。

![test1 分析助手展示恢复产物与待完成的验证](docs/images/security-workbench/test1-analysis-assistant.jpg)

#### 工作进展

查看已完成的资源恢复方向、阶段结论与明确的后续检查。

![test1 工作进展展示前端资源恢复完成阶段](docs/images/security-workbench/test1-work-progress.jpg)

#### 调查链路

通过关联的研究方向与观察，追溯样本识别、脱壳、清单恢复和资源还原的过程。

![test1 调查链路关联材料、研究方向与观察](docs/images/security-workbench/test1-investigation-chain.jpg)

### Android：旧手机漏洞分析与真机验证

以红米 K30 为对象，结合设备侦察、内核源码比对与启动镜像分析，评估旧版 Android 漏洞。工作台集中保留研究笔记、内核符号、验证代码和阶段结果，便于分析者在上机执行前审阅方法。

记录中的真机测试观察到了释放后使用（UAF）与双重释放信号，测试期间没有崩溃或重启，结束后已清理设备侧测试文件。完整 root 提权尚未执行，需要另行批准。

#### 调查阶段

在调查列表中查看设备侦察、漏洞评估与验证准备的阶段记录。

![Android 调查列表展示设备侦察、漏洞评估与验证准备](docs/images/security-workbench/android-investigation-stages.jpg)

#### 真机验证进展

查看已完成的验证阶段、工具调用情况，以及等待批准的下一步操作。

![Android 工作进展展示真机验证结果与待批准的后续步骤](docs/images/security-workbench/android-device-validation.jpg)

#### 分析总结

在分析助手中阅读最终结论、打开保留的研究产物，并查看设备清理结果。

![Android 分析助手展示保留产物、设备清理结果与最终研究状态](docs/images/security-workbench/android-analysis-summary.jpg)

### Web：多层靶场分析与报告

以本地 Web 靶场为对象，沿入口应用、中间件和数据库展开调查，分析 fastjson 反序列化、OFBiz 未授权文件写入，以及配置凭据泄漏后的数据库访问。工作台将发现与证据关联，并记录三层目标中观察到的旗帜值。

报告汇总评估范围、测试方法、攻击路径、技术发现和待完成检查，修复建议单独展示。三项发现保留“疑似”状态：12 条会话证据均标为不完整，独立复核与经批准的端到端运行验证仍待完成。

#### OSCP 风格报告

按项目修订版本查看报告，检查证据限制，并导出证据包。

![Web 评估报告展示执行摘要、范围、测试方法与证据限制](docs/images/security-workbench/web-assessment-report.jpg)

#### 攻击路径与结果记录

查看入口应用、中间件到数据库的调查路径，以及记录的旗帜值和评估状态。

![OSCP 风格报告展示攻击路径与记录的旗帜值](docs/images/security-workbench/web-oscp-attack-path.jpg)

#### 限制与修复建议

查看尚未完成的检查，以及单独列出的应用、中间件和数据库修复建议。

![OSCP 风格报告展示评估限制与独立的修复建议卡片](docs/images/security-workbench/web-oscp-remediation.jpg)

## 分析场景

工作台可跨材料组合方法。每类场景均依赖已配置工具与可访问目标；[provider 参考](packages/experimental/security-analysis/README.zh.md#configure-analysis-providers)说明支持的操作及其验证限制。

| 场景 | 材料与分析方式 |
|---|---|
| 逆向与 Android | 二进制身份、字符串和字节检查；通过已配置的 Ghidra、JADX、Frida 集成进行静态分析或经批准的运行时观察。 |
| Web 安全 | 源码检查、已采集的 HTTP 证据与显式登记的目标；对发现进行复核，并开展受控 HTTP 或离线验证。 |
| 固件与 IoT | 固件组件、嵌入式 Web 源码和离线抓包；根据证据组合二进制、源码、MQTT、Wi-Fi 与 BLE 分析。离线观察不能证明设备行为。 |
| 漏洞研究 | 实验性的 CVE 重新发现，结合源码分析、经批准的 sanitizer 构建与复现运行；盲测基准仍有待真实模型的端到端验收。 |

## 架构概览

工作台通过安全插件与 profile 扩展现有 DSH agent loop（智能体循环）。[高层设计](docs/security-architecture.zh.md)解释系统分层、调查流程、证据生命周期和执行权限。

| 层次 | 职责 |
|---|---|
| DSH 与 Cordis 底座 | 模型接入、Session 日志、工具、jobs、子进程监督、存储与 Host/Client 通信。 |
| 安全领域与方法 | 项目和资产身份、检查、证据、受角色约束的委派、provider 执行、审批、复核、报告与可复用知识。 |
| 分析工作台 | 任务创建、对话、调查链路、工具与环境管理、进展、证据查看及报告交付。 |

Session 日志保留模型交互与工具结果，独立的项目日志保留领域状态，不可变产物保存导入材料和采集证据。分析者可据此回看调查过程，项目记录不依赖仅从聊天历史中还原。

## Run

使用本仓库包含安全扩展的源码版本。按[开发指南](docs/development.zh.md)安装声明的 Node.js 与 pnpm 版本、安装依赖并构建工作区。[安全使用指南](docs/user/guide/security-analysis.zh.md)维护模型凭据和外部工具配置方式；agent 分析需要已配置的模型，外部工具需单独安装。

### Run from source

在已完成构建的仓库根目录启动安全 profile：

```sh
pnpm security --no-open
```

打开启动器输出的认证链接，安全 profile 默认端口为 `3081`。从 **安全分析** 创建分析任务，选择工作区与材料，描述要研究的问题。在工作台查看进展与证据，审阅验证计划后决定是否批准，并阅读或导出最终报告。

源码启动器加载已构建的工作区插件。修改 Host 或 Client 代码后，需重新构建再重启。上游 `@deepseek-ai/dsh` npm 包与通用 Web profile 提供 DSH 底座；本文介绍的工作台使用本仓库的安全 profile。

## 当前限制

本项目及 DSH 底座处于开发者预览阶段，可能出现破坏兼容性的变更。使用前请阅读[安全说明](SAFETY.zh.md)，仅分析授权范围内的材料与目标。

外部工具支持取决于具体环境：Ghidra 需要准备相应集成，Android 运行时观察需要就绪设备，工具箱中列出的工具可能只支持发现而没有专用执行 provider。静态、模拟与运行时观察具有不同的证据效力。[已知限制](packages/experimental/security-analysis/README.zh.md#known-limitations-and-deferred-work)与[路线图](docs/roadmaps/security-analysis.zh.md)维护具体缺口和待完成的验收。

## 文档与开发

文档基线：`rc0.0.2`（2026-10-13）。[架构文档基线](docs/security-architecture.zh.md#documentation-baseline)说明后续更新的对比方式。

- [安全使用指南](docs/user/guide/security-analysis.zh.md)：任务创建、工具、证据、报告与环境。
- [安全架构](docs/security-architecture.zh.md)与[领域参考](docs/subsystems/security-workbench.zh.md)：插件组合、权限与持久化项目记录。
- [开发指南](docs/development.zh.md)与[DSH 架构](docs/architecture.zh.md)：源码开发与底座服务。
- [参与贡献](CONTRIBUTING.zh.md)与 [AGENTS.md](AGENTS.md)：仓库贡献规范和 agent 指引。

## 上游与致谢

DeepSeek AI 开发了上游 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)，其[文档站](https://deepseek-harness.github.io/deepseek-harness/)介绍通用底座能力。Cordis 提供插件框架。专职委派、资料研究与精简报告借鉴了 PentAGI，具体取舍见[安全设计路线图](docs/roadmaps/security-analysis.zh.md)。

以下引用对应上游 DSH 项目：

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
