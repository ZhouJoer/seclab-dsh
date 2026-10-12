---
kind: upgrade-guide
description: 工具安装文件在保存后使用带版本的分环境映射。
---

# 安全工具安装文件

[English](guide.md) | 中文

## 变更

工具箱和 CLI 保存包含 installations、bindings 字段的 version 1 安装文件。读取兼容旧的本机扁平映射，但读写旧映射的外部脚本需要采用带版本的格式。既有 Shell 历史和 Session 数据不变。

## 迁移

1. 保留现有 toolConfiguration.path 文件，无需手动转换。toolConfiguration.environmentId 指定旧文件所属的本机环境。
2. 将外部读取方改为访问 installations[environmentId][toolId]。每项安装包含 command、prefixArgs 和 versionArgs。写入 bindings[toolId] 选择固定环境；r2ghidra 使用 radare2 的绑定。
3. 自定义 profile 显式设置 toolAdapters.bindings，并在项目中授权相应环境。内置 security profile 提供本机默认绑定。
4. 刷新工具箱，检测并保存安装，然后调用专用分析工具。确认出现证据和已确认活动次数。[配置行为](../../../../packages/experimental/security-analysis/README.zh.md#configure-analysis-providers)说明限额和 Docker 所有权。
