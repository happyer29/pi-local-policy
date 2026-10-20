# 参与贡献

[English](../../../.github/CONTRIBUTING.md) | [Русский](../ru/CONTRIBUTING.md) | **简体中文**

讨论变更时，请围绕工具行为及其边界展开：自动执行、确认一次调用，或阻止执行。权限变更应举例说明用户将能够做什么，以及哪些操作仍然禁止。

英文是文档和界面消息的默认语言，英文文档为基准版本。修改英文原文时，请同步更新上方链接中的俄文和简体中文译本。文档翻译不代表扩展提供运行时语言切换功能。

## 本地验证

```sh
npm ci --ignore-scripts
npm test
npm run check:release
npm run check:package
```

在 macOS 上还应运行：

```sh
npm run test:sandbox
```

原生集成测试从开发依赖或 `PI_CODING_AGENT_ROOT` 获取 Pi。由于缺少 SDK 而跳过测试，并不能证明兼容性。已配置但损坏的 SDK 应导致失败。真实 Seatbelt 测试需要允许启动 `sandbox-exec`，且不能有禁止此操作的外层沙箱。

请只使用临时目录和模拟秘密。测试不得调用模型、发布数据、使用用户身份验证信息，或修改正在使用的 Pi 安装。

## 代码分区

- `src/policy.mjs`：路径、工具和部分命令模式的纯决策逻辑。
- `src/sandbox.mjs`：Seatbelt 配置、清理后的环境、子进程及执行限制。
- `src/index.ts`：Pi API、工具注册和检查、确认 UI、会话设置。
- `src/public-fetch.mjs`：公开 HTTP(S)、DNS、重定向、下载大小和时间限制。
- `scripts/management.mjs`：带变更计划和备份的安装与卸载。

不要仅凭工具名称就默认允许新工具。请说明其注册来源、可访问资源、没有 UI 时的行为，以及嵌套调用路径。安全变更应附带针对实际边界的检查，而不只是重复实现逻辑。

请使 README、信任模型和测试与实际行为保持一致。不要声称能够防止所有绕过，或兼容未经验证的版本。添加文件时，请更新 `scripts/check-release.mjs` 中的显式发布列表。

发布通过手动方式完成；CI 在 macOS 上运行检查，不会自动发布。发布前，请检查 `npm pack --dry-run` 的文件清单，运行 `npm run check:release`、受支持 macOS 上的完整测试，并在新配置目录中验证打包产物的安装。将个人授权保存在软件包之外的 `<agent-dir>/local-policy.json`。软件包不得包含凭据或本地设置。安全问题报告见 [SECURITY.md](SECURITY.md)。安装和使用说明见 [README.md](README.md)。
