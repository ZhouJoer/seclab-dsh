---
kind: upgrade-guide
description: "安全工具检测变为只读，Python 和工具箱初始化需要核对安装计划后执行。"
---

# 核对安全工具安装计划后再执行

[English](guide.md) | 中文

## 变更

工具箱检测不再保存发现的路径，也不启动受管 Docker 容器。已有可执行文件选择仍可读取。保存检测到的安装和启动环境成为独立的操作者动作。

`pnpm security:python` 原先直接创建环境并保存解释器，现在只打印安装计划。环境位于显式选择的统一安装目录下。`pnpm security:toolbox` 也只打印计划；它要求 `--environment`，通过 `--group` 选择 Kali 工具组，不再接受 `--tag`，也不直接构建基准镜像。

独立的版本 1 安装账本位于 `$DSH_HOME/security/tool-installations`，跨项目保留目录、待核对计划、操作和安装回执。已有 `.dsh/security-tools.json` 选择不会自动导入为受管安装。新路径配置可包含 `temporaryDirectory`，供需要自有运行目录的工具使用；请将该目录与安装一起保留。Session 日志格式不变。

## 迁移

1. 在**工具箱**检测工具，再点击**采用此安装**保存候选项。受管容器停止时，先点击**启动环境**再检测。外部容器仍由操作者启动。显式的**检测并保存**与 CLI `--save` 仍可使用。
2. 选择**安装与维护工具 → 统一安装目录**，或运行 `pnpm security:tools install-root "ABSOLUTE_DIRECTORY"`。更改目录只影响后续安装，不移动已有工具。
3. Python 使用独立 64 位 Python 3.12–3.14 运行 `pnpm security:python --python "ABSOLUTE_PYTHON_PATH"`。Kali 使用 `pnpm security:toolbox --environment ID --group kali-web`；还可选择 `kali-reverse`、`kali-firmware` 和 `kali-network`。基准镜像仍需单独准备构建依赖和差分辅助脚本。
4. 受管 Kali 预览可下载基础镜像并运行自有临时容器，不升级选中的环境。核对打印的来源、校验、目标目录和步骤，运行 `pnpm security:tools install-apply PLAN_ID --digest DIGEST --request-id UNIQUE_ID`，并添加要求的 `--confirm ID`。已有外部 Kali 容器要求 `--confirm external-container`；DSH 不接管其生命周期。必要系统组件需要各自的显式确认。
5. 查看**安装记录**或 `pnpm security:tools install-status`。完成的操作保存已验证选择。选择发布失败时，`installed-unbound` 保留已安装文件；重试前先重新检查记录的操作。不要手动删除被其他项目引用的安装。恢复与清理命令见[工作台指南](../../../user/guide/security-analysis.zh.md)。
