---
kind: upgrade-guide
description: "Ghidra headless 替代 GUI 桥接、对应工具入口及 provider 配置。"
---

# 使用 Ghidra headless 分析二进制

[English](guide.md) | 中文

## 变更

Ghidra 分析使用 `security_ghidra_headless`。`security_ghidra` GUI 桥接、`ghidra` 工具绑定和 `@deepseek-ai/dsh-experimental-security-analysis/ghidra` 插件已移除。GhidraMCP token、端口与绑定的 GUI 程序不会转换为 headless 配置。Headless 支持固定只读查询，不提供 GUI 数据库编辑的替代操作。

依赖已移除 GUI provider 的任务无法继续通过它执行。请使用 headless 新建任务；不提供历史任务迁移。本次变更不删除任务存储。

Headless 查询保持常驻进程，直到空闲到期、容量淘汰或显式关闭环境。活动项目缓存持续持有租约，直到进程退出；只有正常完成的项目才成为可复用的磁盘缓存。可选分析设置会选择独立会话和缓存。

## 迁移

1. 从 `cordis.yml` 或覆盖配置中移除 `@deepseek-ai/dsh-experimental-security-analysis/ghidra` 插件项及其 `programs` 配置。从工具偏好、自定义工具包以及 `toolAdapters.bindings` 或安装文件的 `bindings` 中移除 `ghidra`。
2. 在**工具箱**安装或选择 **Ghidra headless** 及其兼容 JDK。检测所选安装，并选择本机或受管 Docker 环境。安装管理器保存 Java 可执行文件和固定 Ghidra 启动参数，无需 GUI token 或端口。
3. 新建任务，导入二进制，启用原生二进制模块，并调用 `security_ghidra_headless` 的 `identity` 或 `functions` 等操作。确认返回证据标识样本及 Ghidra 版本。缓存与进程限制见[配置指南](../../../../packages/experimental/security-analysis/README.zh.md#configure-analysis-providers)。
4. 按可用内存设置 `toolAdapters.ghidraHeadless.sessionIdleTimeoutMs` 和 `maxSessions`。相关查询重复传入相同 `analysis` 参数。删除已占用的缓存前等待空闲关闭；进程仍存活时不要手动删除锁。
