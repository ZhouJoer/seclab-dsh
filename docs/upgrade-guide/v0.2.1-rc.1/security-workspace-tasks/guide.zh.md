---
kind: upgrade-guide
description: "安全工作区任务使用原生源码工具与直接提交的报告，取消自动目录快照。"
---

# 安全工作区任务

[English](guide.md) | 中文

## 变更

新建分析继承工作区环境并打开空白原生会话。首页选择安全分析模式后，首次发送也会在任何模型请求或工具调用前创建并关联任务。缺少配置时阻止发送并保留草稿。普通模式不会自动创建安全任务。任务可以在第一条用户消息之前存在。保存的记录可包含主 Session 身份与轻量工作区目标。旧版本使用严格记录校验，无法读取这些新字段。

自定义 Client ISessions 实现必须提供 registerPresentation() 与 renameDisplayTitle()。展示源覆盖业务对象拥有的名称，并保留已关联的空白会话身份；原始 Session 标题保持不变。任务目录现在包含关联会话，供精确导航使用。

任务记录还可包含可选的已保存成果和报告交付状态，报告记录可包含用于复用的材料指纹。当前 reader 接受缺少这些字段的旧记录；旧版严格 reader 拒绝带新字段的记录。Host 与 Client 须保持同版本，降级前恢复升级前的存储备份。

自动递归采集和强制进度检查点已移除。源码调查使用原生文件工具。安全 Web profile 提供目标工作区，不再注入本机 Harness 实现仓库。`complete-task` 接受分析者撰写的报告内容与引用；Host 校验已保存的观察并排版报告，不再发起一次模型请求。历史快照、证据和报告保持可读。

## 迁移

1. 同时升级 Host 与 Client。已有任务保持可读并保留当前材料，历史会话不会被重命名。
2. 在首页选择安全分析模式，直接使用工作区默认值发送，或展开**配置**保存本次任务设置。只有**设为工作区默认**会更新默认值。取消和恢复操作保留当前模式。**新建分析**创建关联的空白聊天，不发送消息。重新开始沿用当前任务配置、工具偏好、Advisor 开关与模式及授权有效期。提及 URL 不会登记目标。工作区配置和首次发送配置使用 `security_workspace_intake_v2`；旧域保持原样，不自动导入。按需重新设置工作区默认值，并将显式存储路由改为新域名。
3. 从 security-workbench 配置中移除 `workspaceMaterials`、`analysisProgressCalls`、`reportInputBytes`、`reportOutputTokens`、`reportMaxChars` 与 `reportMaxLessons`。保留 `reportMaxFindings` 控制正文发现数量，以及 `maxOutputBytes` 控制输出上限。将自定义 `refreshWorkspaceMaterials` 调用替换为原生工作区文件浏览器。
4. 通过 `complete-task` 提交报告内容与源码位置，已有 `evidenceIds` 仍可使用。`report` 重新发布已保存提交，不重跑分析。确认源码任务无需材料同步便可开始，报告引用保留原始片段。
5. 升级前备份安全工作台存储。返回旧版本时恢复该备份，不要用旧读取器打开新写入的任务记录。
