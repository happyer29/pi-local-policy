# Pi Local Policy

[English](../../../README.md) | [Русский](../ru/README.md) | **简体中文**

为 [Pi Coding Agent](https://pi.dev/) 提供本地访问规则：项目内的日常工作自动执行，部分外部操作需要确认，未知工具则被阻止。

扩展通过代码检查实际的工具调用，不会调用模型来决定访问权限。文件操作和命令通过 `sandbox-exec` 在 macOS Seatbelt 中隔离执行。

英文是项目文档和界面消息的默认语言，英文文档为基准版本，同时提供俄文和简体中文文档译本。文档翻译不代表扩展提供运行时语言切换功能。

**状态：适用于 macOS 的实验版本。** 这是针对模型工具的额外限制层，并非虚拟机，也不保证防止所有绕过方式。Pi 和已安装的扩展仍属于受信任代码。使用前请阅读[防护边界](#防护边界)和 [SECURITY.md](SECURITY.md)。

## 用途

Pi 可以自主阅读资料、创建报告、运行本地数据处理和测试，无需为每个管道或每次文件读取进行确认。

任务示例：

> 根据公开的文本资料，研究评估研究型智能体的方法。将来源保存到 sources.md，方法对比保存到 comparison.md，结论和待解决问题保存到 report.md。为每项重要结论注明来源。

如果搜索可用，且资料以普通文本页面提供，这个流程可以不出现确认对话框。从网络安装软件包、使用浏览器以及接入新工具则遵循其他规则。

该扩展不会安装 Jev，也不使用 Jev 检查命令。Pi 的主模型、搜索服务及其他已连接的服务仍可能消耗 API 额度或产生费用。

## 默认规则

| 操作 | 行为 |
| --- | --- |
| 读取、搜索、创建和编辑项目中的普通文件 | 自动执行 |
| 本地命令、管道、数据处理和测试 | 在 Seatbelt 中自动执行，无网络 |
| 读取额外获准的文件夹 | 自动执行，只读 |
| 通过 `web_fetch` 获取公开文本页面 | 自动执行，无登录和 cookies |
| 通过受支持的 `web_search` 扩展搜索 | 单独安装该扩展后自动执行 |
| 通过 `network_bash` 运行一条联网命令 | 确认这一次具体调用 |
| 受支持的浏览器操作 | 每次调用均需确认 |
| 未知工具，包括 MCP 或子智能体工具 | 阻止 |
| 读取已知的敏感信息路径 | 阻止 |
| 在项目和临时工作区之外写入 | 阻止 |
| 修改 `.git`、`.pi`、`.agents` 及受保护的指令文件 | 阻止 |
| 明确识别出的系统、特权及破坏性 Git 命令 | 阻止 |

**项目内的普通文件可以在无需确认的情况下被修改和删除。** 扩展限制访问范围，但不评估每项修改的价值。对于重要资料，请使用独立工作副本并保留备份。

## 要求

- macOS，且 `/usr/bin/sandbox-exec` 可用。
- `@earendil-works/pi-coding-agent` 软件包中的 Pi **1.0.3**。目前不声明兼容其他版本：实现使用了这一版本的扩展 API 和 codemode API。
- Node.js **22.19 或更新版本**；最初验证使用 Node.js **24.15.0**。
- 已存在的独立项目文件夹。
- `grep` 和 `find` 需要位于 `<agent-dir>/bin/rg`、`/opt/homebrew/bin/rg`、`/usr/local/bin/rg` 或 `/usr/bin/rg` 的 ripgrep 可执行文件。新 Pi 配置目录可能没有该文件：请另行安装，例如运行 `brew install ripgrep`。扩展不会自动下载它，也不会搜索继承的 `PATH`。

不支持 Linux 和 Windows。如果 Seatbelt 无法启动，文件操作和命令不会退回普通的无限制执行模式。

`web_search` 和浏览器工具**不包含在此仓库中**。策略通过工具名称和源扩展路径识别它们。没有相应扩展，就不会提供这些功能。详情见[其他工具](#其他工具)。

## 安装

在受支持的 Mac 上，通过 Pi 的包管理器安装：

```sh
pi install npm:pi-local-policy@0.1.0
```

这是通过 npm 分发的 Pi 社区软件包，并非由 Pi 官方团队维护，也未经过独立安全审计。`pi-package` 关键字使该软件包可被 [Pi 软件包目录](https://pi.dev/packages)发现。

**仅使用一种安装来源。** 如果已有从 `<agent-dir>/extensions/local-policy` 加载的旧副本，请先移除它，再安装 npm 软件包。对于由本仓库脚本管理的副本，请使用下文的卸载流程。对于非受管理副本，请先备份，再删除其注册项及会被自动发现的扩展文件夹。不要同时加载手动副本和 npm 软件包。

重新加载前，请禁用注册同名工具或自行确认相同操作的其他扩展。尤其要禁用现有的 `bash-guard` 和原有 `web-fetch`：此软件包提供自己的 `web_fetch`。请另行检查 Jev 及其他确认处理器。**`pi install` 不会替你修改这些设置。** 重复注册和访问处理器可能阻止工具或增加对话框。

智能体目录取自 `PI_CODING_AGENT_DIR`；未设置时使用 `~/.pi/agent`。使用独立配置目录时，安装和运行 Pi 应使用相同的环境变量值。安装软件包不会创建项目，也不会授予整个主目录的访问权限。

在 Pi 中运行：

```text
/reload
/local-policy
```

检查 `Root`，必要时选择已存在的独立项目：

```text
/local-policy root /absolute/path/to/project
/reload
/local-policy
```

Seatbelt 检查成功后会显示 `Local policy: AUTO`。`BLOCKED` 表示需要检查错误消息、工作文件夹、配置及系统隔离是否可用。处理重要资料前，请先在临时测试项目中验证普通文件读取或本地命令。

### 可选：从源代码手动安装

经过检查的[源代码仓库](https://github.com/happyer29/pi-local-policy)仍提供本地管理脚本。这是 npm 安装的替代方案；不要在同一配置目录中混用两者。

在仓库根目录打开终端，先查看计划，再应用：

```sh
node scripts/install.mjs
node scripts/install.mjs --apply
```

使用独立配置目录时，在两条命令后都添加 `--agent-dir /absolute/path/to/agent`。该参数本身不会为 Pi 进程设置 `PI_CODING_AGENT_DIR`。

安装程序会将运行时文件复制到 `<agent-dir>/extensions/local-policy`，保存备份和安装记录，并在保留其他设置的同时向 `settings.json` 注册扩展。它会排除标准路径 `extensions/bash-guard/index.ts` 和 `extensions/web-fetch/index.ts`，并将 `defaultTools` 中选中的内置 `codemode` 替换为 `local_codemode`。其他处理器需要单独检查。被排除扩展的源文件会保留。

如果目标文件夹存在旧的非受管理 `local-policy`，安装程序会将其归档并保留 `config.json`，不会合并工具实现。禁止覆盖已由脚本管理的安装。计划会显示确切变更；安装程序不会下载依赖、调用模型或执行 Git 操作。安装后运行 `/reload`，并检查 `/local-policy`。

## 选择项目和资料

默认项目根目录取自 Pi 的工作目录。工具使用的相对路径以所选根目录为基准。

如果 Pi 从主目录启动，或需要处理其他项目：

```text
/local-policy root /absolute/path/to/project
/reload
/local-policy
```

该文件夹必须已存在。不能选择 `/`、整个主目录、顶层的 `Documents`、`Desktop`、`Downloads`、主要系统目录和通用工具目录、凭据目录、智能体配置目录或 `.git` 作为工作项目。可以使用 `Documents` 内的独立研究文件夹。

所选根目录是一项受信任的写入授权。检查无法识别所有系统目录或重要目录：请只选择独立的项目工作文件夹。

可以以只读方式接入其他资料：

```text
/local-policy allow-read /absolute/path/to/source-materials
```

这不会允许修改所接入的资料，也不会取消对已知敏感信息路径的保护。请只选择任务所需的具体文件夹。

根目录和 `allow-read` 授权保存在当前 Pi 会话分支中，并在重新加载后恢复。它们不是适用于所有新聊天的全局权限。目前没有单独撤销某项 `allow-read` 的命令；如需全新的权限集合，请开始新会话。

可用命令：

| Pi 命令 | 用途 |
| --- | --- |
| `/local-policy` | 显示状态、根目录和计数器 |
| `/local-policy status` | 显示相同状态 |
| `/local-policy root /absolute/project` | 为当前会话选择工作项目 |
| `/local-policy allow-read /absolute/folder` | 添加只读访问权限 |

这些是用户命令。模型不能通过普通工具调用为自己授权。

## 模型工具

Pi 根据任务自行选择工具。通常只需用自然语言说明希望得到的结果。

| 名称 | 实现与限制 |
| --- | --- |
| `read` | 通过隔离进程读取允许的文件；保留对常见图像的支持 |
| `write`, `edit` | 仅能在项目和临时区域中写入和编辑；受保护路径除外 |
| `grep`, `find`, `ls` | 搜索和查看允许的文件；隐藏或跳过受保护路径 |
| `bash` | 在 Seatbelt 中运行 `/bin/bash --noprofile --norc`，无网络，不读取用户 shell 启动文件 |
| `network_bash` | 文件隔离规则相同，在确认一次调用后启用网络 |
| `web_fetch` | 公开 HTTP(S) GET，检查地址和重定向，不使用身份验证 |
| `local_codemode` | 将工具调用组合执行；每个嵌套操作均经过检查 |

`read`、`write`、`edit`、`grep`、`find`、`ls`、`bash` 和 `web_fetch` 这些名称替换原有实现。如果另一个扩展注册了同名工具且来源与预期不符，策略会阻止它，而不会运行原有实现。

内置 `codemode` 被阻止，因为经验证的 Pi 版本在常规工具调用路径之外提供辅助模型 API。`local_codemode` 使用 `models: false` 创建：保留操作组合能力，但不暴露直接的辅助模型 API。

### 本地命令

无需确认的任务示例：

> 阅读项目中的 Markdown 文件，找出矛盾，并将清单写入 findings.md。

> 使用现有工具处理本地 CSV，并将汇总表保存到项目中。

> 运行本地测试并修复发现的错误。

每次调用都会为进程提供新的临时 `HOME`、`TMPDIR` 和缓存目录。大多数环境变量不会传入。特别是常见 API 密钥、SSH agent、shell 启动设置和用户 Git 配置都不会传入。因此，命令行为可能与你平时使用的 shell 不同。

需要访问允许根目录之外的现有文件、用户 Python 环境、服务登录或网络的依赖，可能无法自动运行。不能把所有程序失败都视为策略错误。请先确认程序实际需要哪些资源。

请将最终结果保存到项目中：临时目录不是长期存储。当前版本不会自动清理临时工作区。

### 联网命令

当任务确实需要通过 shell 访问网络时，模型可以调用 `network_bash`。你会看到具体命令，授权仅对这一次调用有效。拒绝、取消或没有确认界面，都意味着命令不会执行。

授权后，整个进程及其子进程都可以使用网络，包括访问本地和私有地址。文件限制和经过清理的环境仍然生效。**获准的联网命令可以发送它能访问的任何项目资料或已接入文件夹中的资料。** 确认操作并不等于检查每次后续网络请求的内容和目标。

确认后，电脑中常规的凭据仍不会变得可用。需要身份验证的发布和部署可能需要单独的受信任工具。扩展没有无限制执行的备用路径。

### 公开来源

`web_fetch` 接受使用标准端口的公开 HTTP(S) URL，并检查 DNS 和每次重定向。验证后会固定连接地址。本地、私有和保留地址，以及包含用户名、密码或已识别身份验证参数的 URL 会被拒绝。

支持 HTML、纯文本、Markdown 和 JSON。限制为：响应最多 2 MiB、最多五次重定向、每次请求 15 秒。不会执行页面 JavaScript。HTML 会被转换为简化文本。

目前不支持 PDF、压缩包、任意二进制格式或压缩响应。部分网站需要浏览器或登录。项目内的本地 PDF 可以另行使用可用程序处理，但这里没有内置的研究型 PDF 流水线。

请求公开页面仍然是在访问第三方网站。不要把搜索查询或 URL 当作传递秘密数据的私有通道。

### 其他工具

默认检查智能体目录内的精确路径：

- `web_search` 的来源为 `extensions/web-search/index.ts` 时，允许自动执行。其他经过检查的软件包路径需要下文中明确的 `readTools` 授权。
- `browser_goto`、`browser_eval`、`browser_console`、`browser_network`、`browser_fill`、`browser_click`、`browser_screenshot`、`browser_close` 的来源为 `extensions/browser/index.ts` 时，每次调用需要确认。
- Pi 的标准工具 `ask_user_question` 和 `quiz` 可用于与用户交流。
- 其他工具，包括 MCP 和子智能体工具，在显式配置前会被阻止。

路径检查确认的是注册来源，并不分析第三方扩展代码是否安全。`web_search`、浏览器和显式接入的外部工具由各自的受信任扩展执行；`bash` 的文件隔离不会自动应用到它们。接入前请检查这些扩展。

请创建或编辑持久用户配置 `<agent-dir>/local-policy.json`（通常为 `~/.pi/agent/local-policy.json`）。将个人授权保存在这里，避免软件包更新将其覆盖：

```json
{
  "version": 1,
  "readRoots": [],
  "readTools": {},
  "askTools": {}
}
```

- `readRoots` 为该配置目录的全部会话添加持久只读授权。受保护的敏感信息路径仍然被排除。
- `readTools` 当前仅接受 `web_search`，映射到源扩展的精确绝对路径后，允许自动搜索。这是对 Pi 宿主进程中扩展代码的信任授权，**不是**沙箱，也不保证该工具只读。请仅在检查扩展后使用。例如，非标准软件包路径中的搜索扩展可显式授权为：`"readTools": { "web_search": "/absolute/path/to/reviewed/search/index.ts" }`。`readTools` 中的其他工具名称会被拒绝。
- `askTools` 使用相同的精确名称及来源格式，但每次调用都需要确认。例如：`"askTools": { "example_tool": "/absolute/path/to/reviewed/extension/index.ts" }`。这只是格式示例；不要添加不存在的工具。相互冲突的授权会被拒绝。

持久文件作为完整配置使用，不与软件包默认值合并。不存在该文件时，扩展会回退读取相邻的 `config.json`（软件包中的 `src/config.json`，或旧版扁平手动安装中的 `config.json`）。不要将新的个人授权保存在 npm 软件包目录内。编辑后运行 `/reload`。无效配置会导致阻止执行，而不是关闭规则。

## 防护边界

策略用于控制模型通过工具及已验证的 codemode 嵌套调用路径执行的操作。它不隔离整个 Pi 进程。

- **Pi、已安装的扩展和用户配置受到信任。** 拥有任意代码能力的扩展可以在检查路径之外执行操作。检查工具名称和来源并不能使恶意扩展变得安全。
- **用户通过 `!` 输入的命令属于用户 shell。** 它们不会变成受限制的模型命令。
- **文件系统访问受限，但内容不会被完整分类。** 普通 `notes.md` 中的秘密仍是可读取的项目数据。路径过滤和部分令牌格式检测不能替代秘密管理。
- **元数据不会完全隐藏。** Seatbelt 允许读取文件元数据以支持程序运行。根据允许规则，系统和工具目录可被读取。详细根目录列在 `src/sandbox.mjs` 中。
- **接入的资料和网页可能包含恶意指令。** 扩展不判断来源可信度，也不能消除 prompt injection。限制会应用到后续工具调用。
- **Git 写入受到保护。** `git status`、`diff`、`log` 通常可用；`git add`、提交、切换分支及其他写入 `.git` 的操作请手动执行。工作副本中的普通文件仍可被修改。
- **不会自动提升权限。** Seatbelt 失败、未授权路径或未知工具会返回错误，不会自行切换到无限制执行器。

更详细的实现见 [docs/architecture.md](architecture.md)，问题报告流程和信任模型见 [SECURITY.md](SECURITY.md)。

## 更新与卸载

npm 安装请使用 Pi 的包管理器。本 README 特意固定安装版本：请先检查下一版，再指定其完整版本号安装（例如，待相应版本发布后运行 `pi install npm:pi-local-policy@0.1.1`）。不要在包管理器安装之上运行手动安装程序。

卸载 npm 软件包：

```sh
pi remove npm:pi-local-policy
```

然后运行 `/reload`。请另行检查自己添加的扩展冲突排除项：卸载软件包不会恢复它们。`<agent-dir>/local-policy.json` 是用户自己的文件，不会随软件包删除。请按需保留或手动删除。

### 卸载脚本管理的安装

在经过检查的源代码副本中查看并应用计划：

```sh
node scripts/uninstall.mjs
node scripts/uninstall.mjs --apply
```

使用独立配置目录时，在两条命令后都添加 `--agent-dir /absolute/path/to/agent`。这些脚本只卸载自己管理的安装，不卸载 npm 软件包或任意非受管理副本。

卸载会取消受管理扩展的注册，并归档其文件和配置。只有当 `extensions` 和 `defaultTools` 的对应字段仍与安装后快照一致时，才恢复该字段。如果字段后来发生变更，则仅删除自身的 `local-policy`/`local_codemode` 引用，保留其他条目并显示警告。此前的冲突排除项可能需要手动检查。

如果安装时替换了既有的非受管理 `local-policy` 文件夹，卸载将从原始归档恢复它。预览会显示 `restorePreviousExtension`；如果缺少归档，卸载将停止。备份会保留。完成后运行 `/reload`。

脚本管理的手动安装不支持原位更新：请先卸载，检查新源码后再安装。迁移到 npm 时，先确保旧的扁平扩展目录及其注册项不再加载，再运行 `pi install`。迁移前，将归档 `config.json` 中经过检查的旧授权移至 `<agent-dir>/local-policy.json`。持久配置优先于软件包或旧版默认值，并会在软件包更新后保留。

## 开发与测试

开发时，在不运行生命周期脚本的情况下安装依赖：

```sh
npm ci --ignore-scripts
npm test
```

仓库包含 `package-lock.json`，以支持可复现的开发依赖安装。用于集成测试的 Pi SDK 系列软件包固定为已验证的 **1.0.3** 版本；请使用 `npm ci` 保留此依赖集合。这些开发版本固定不会替换已安装 Pi 宿主随附的运行时依赖。

`npm test` 运行可跨平台执行的策略、公开页面获取、配置文件生成测试，以及通过真实 Pi 加载器进行的扩展检查。`web_fetch` 的网络行为使用 DNS 和 HTTP 模拟进行测试；测试不调用模型，也不使用真实密钥。

原生集成测试使用作为开发依赖安装的 Pi。要检查某个外部安装，可以设置 `PI_CODING_AGENT_ROOT`，其值应为 `@earendil-works/pi-coding-agent` 软件包目录的绝对路径。如果未安装 Pi，原生集成检查会被跳过：这种运行只能验证可用部分。显式指定但无效的路径，或不兼容的 SDK，应导致失败。

在 macOS 上，还应运行真实的 Seatbelt 检查：

```sh
npm run test:sandbox
```

这些检查验证文件限制、合成秘密、符号链接、子进程、环境清理、网络禁用、取消操作，以及通过 Pi 工具执行普通工作流程。它们需要允许启动 `sandbox-exec`；额外的外层沙箱可能禁止嵌套 Seatbelt。

如果隔离测试被跳过，或环境阻止其运行，这并不能证明该环境中的隔离有效。测试成功也不能证明不存在任何绕过方式。

发行版通过手动方式发布到 npm。CI 运行测试和发布文件检查，不会自动发布。npm 软件包使用明确的文件允许列表，包含运行时代码、文档、许可证及可选管理脚本，不包含本地用户设置或测试数据。

准备发布前，检查发布文件组成：

```sh
npm run check:release
npm run check:package
```

## 仓库内容

```text
pi-local-policy/
├── README.md                 # 英文入口文档
├── LICENSE
├── package.json
├── src/                      # 扩展运行时代码及默认配置
├── scripts/                  # 安装、卸载及发布内容检查
├── tests/                    # 自动化检查
├── docs/
│   ├── architecture.md       # 英文架构文档
│   └── i18n/
│       ├── ru/               # 完整俄文文档
│       └── zh-CN/            # 完整简体中文文档
└── .github/                  # CI、安全策略及贡献指南
```

Pi 软件包加载 `src/index.ts`，保留源码目录结构。可选手动安装程序则将 `src/` 内容直接复制到 `<agent-dir>/extensions/local-policy/`，不带嵌套 `src/` 目录。源码安装管理和检查命令均在仓库根目录运行。

| 文件或目录 | 用途 |
| --- | --- |
| `src/index.ts` | 工具注册、调用处理、确认和 Pi 命令 |
| `src/policy.mjs` | 路径、工具名称和来源的决策，以及部分命令检查 |
| `src/sandbox.mjs` | Seatbelt 配置、环境和进程启动 |
| `src/fs-worker.mjs` | 隔离进程内的文件操作 |
| `src/public-fetch.mjs` | 受限制的公开 HTTP(S) 获取 |
| `src/config.json` | 软件包回退默认值；个人授权应写入 `<agent-dir>/local-policy.json` |
| `scripts/` | 本地安装和卸载 |
| `tests/` | 自动化检查 |
| `README.md`, `.github/SECURITY.md`, `.github/CONTRIBUTING.md` | 英文基准版本的使用、安全和贡献文档 |
| `docs/architecture.md` | 英文基准版本的组件实现和边界说明 |
| `docs/i18n/ru/`, `docs/i18n/zh-CN/` | 完整俄文和简体中文文档，包括 README 译本 |

仓库不应包含用户 Pi 设置、会话、API 密钥、本地备份或研究资料。

## 许可证

代码依据 [MIT](../../../LICENSE) 许可证发布。软件不提供保证；完整条款见许可证文件。
