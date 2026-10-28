---
kind: upgrade-guide
description: "安全工具命令现在使用已有的 Harness home 安装配置。"
---

# 安全工具配置选择

[English](guide.md) | 中文

## 变更

仓库没有 `.dsh/security-tools.json` 时，`security:tools` 和 `security:doctor` 现在使用已有的 `$DSH_HOME/security/tools.json`，与安全 profile 一致。此前这些命令只选择仓库文件。工具定义和环境声明仍位于仓库 `.dsh` 目录，除非显式覆盖。

## 迁移

1. 运行 `pnpm security:tools list`，在保存安装配置前检查报告的配置路径。
2. 若需独立文件，传入 `--config FILE`；将 profile 的 `toolConfiguration.path` 设为同一绝对路径。显式配置也会将默认同目录定义文件定位到该目录。
3. 按照[安全指南](../../../user/guide/security-analysis.zh.md)初始化 Python 依赖。运行 `pnpm security:doctor python unicorn capstone pefile r2pipe frida`，确认解释器与配置路径。
