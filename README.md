# Pi Local Policy

[![npm version](https://img.shields.io/npm/v/pi-local-policy)](https://www.npmjs.com/package/pi-local-policy)

[English](README.md) | [Русский](docs/i18n/ru/README.md) | [简体中文](docs/i18n/zh-CN/README.md)

Local access rules for [Pi Coding Agent](https://pi.dev/): routine work inside a project runs automatically, selected external actions require approval, and unknown tools are blocked.

The extension checks actual tool calls in code. It does not call a model to make access decisions. File operations and commands use macOS Seatbelt isolation through `sandbox-exec`.

**Status: experimental macOS release.** This is an additional restriction layer for model tools, not a virtual machine or a guarantee against every bypass. Pi and installed extensions remain trusted code. Before using it, read the [security boundaries](#security-boundaries) and [SECURITY.md](.github/SECURITY.md).

English is the default language for documentation and user-facing messages. Russian and Simplified Chinese documentation translations are available through the links above. The English documents are the canonical reference; these translations do not add a runtime language-switching feature.

## What it is for

Pi can read source materials, create reports, run local data processing, and execute tests on its own. You do not need to approve every pipe or file read.

Example task:

> Research approaches to evaluating research agents using public text sources. Save the sources to sources.md, a comparison of approaches to comparison.md, and conclusions and open questions to report.md. Cite a source for every substantial conclusion.

If search is available and the materials are ordinary text pages, this workflow can run without approval dialogs. Installing packages from the network, using the browser, and connecting new tools follow different rules.

The extension does not install Jev or use it to check commands. Pi's main model, the search service, and other connected services may still consume API usage or incur costs.

## Default rules

| Action | Behavior |
| --- | --- |
| Read, search, create, and edit ordinary project files | Automatic |
| Local commands, pipes, data processing, and tests | Automatic, inside Seatbelt, without network access |
| Read an additionally permitted directory | Automatic, read-only |
| Fetch a public text page through `web_fetch` | Automatic, without login or cookies |
| Search through the supported `web_search` extension | Automatic, if installed separately |
| Run one network-enabled command through `network_bash` | Approval for that specific invocation |
| Perform a supported browser action | Approval for each invocation |
| Use an unknown tool, including MCP or a subagent | Blocked |
| Read known secret paths | Blocked |
| Write outside the project and temporary workspace | Blocked |
| Modify `.git`, `.pi`, `.agents`, or protected instruction files | Blocked |
| Run explicitly recognized system, privileged, or destructive Git commands | Blocked |

**Ordinary files inside the project can be changed and deleted without approval.** The extension restricts the scope of access but does not assess the value of each edit. Use a separate working copy and backups for important materials.

## Requirements

- macOS with `/usr/bin/sandbox-exec` available.
- Pi from the `@earendil-works/pi-coding-agent` package, version **1.0.3**. Compatibility with other versions is not claimed: this extension uses the extension and codemode APIs from that version.
- Node.js **22.19 or newer**; the initial verification used Node.js **24.15.0**.
- An existing, dedicated project directory.
- For `grep` and `find`, a ripgrep binary at `<agent-dir>/bin/rg`, `/opt/homebrew/bin/rg`, `/usr/local/bin/rg`, or `/usr/bin/rg`. A fresh Pi profile may not contain one: install it separately, for example with `brew install ripgrep`. The extension does not download it automatically or search an inherited `PATH`.

Linux and Windows are not supported. If Seatbelt cannot start, file operations and commands do not fall back to ordinary unrestricted execution.

`web_search` and browser tools **are not included in this repository**. The policy recognizes them by name and source extension path. These capabilities are unavailable without the corresponding extension. See [additional tools](#additional-tools) for configuration details.

## Installation

Install through Pi's package manager on a supported Mac:

```sh
pi install npm:pi-local-policy@0.1.0
```

This installs a community Pi package from npm. It is not an official Pi-maintained or security-audited extension. The package's `pi-package` keyword makes it eligible for discovery in the [Pi package directory](https://pi.dev/packages).

**Use one installation source only.** If an older copy is already loaded from `<agent-dir>/extensions/local-policy`, remove that installation before adding the npm package. For a copy managed by this repository's script, use the removal procedure below. For an unmanaged copy, back it up and remove its registration and auto-discovered extension directory. Do not load a flat manual copy and the npm package together.

Before reloading, disable other extensions that register overlapping tools or independently approve the same actions. In particular, disable an existing `bash-guard` and the original `web-fetch`; the package supplies its own `web_fetch`. Review Jev and any other approval handlers separately. **`pi install` does not make these configuration changes.** Duplicate registrations or access handlers can block tools or add dialogs.

The agent directory is `PI_CODING_AGENT_DIR` when set, otherwise `~/.pi/agent`. Use the same environment setting for installation and the Pi process when working with a separate profile. Package installation does not create a project or grant access to your entire home directory.

In Pi, run:

```text
/reload
/local-policy
```

Check `Root` and select an existing dedicated project if needed:

```text
/local-policy root /absolute/path/to/project
/reload
/local-policy
```

A successful Seatbelt check displays `Local policy: AUTO`. `BLOCKED` means you need to inspect the error message, working directory, configuration, and availability of system isolation. Test an ordinary file read or local command in a disposable project before using valuable materials.

### Optional manual installation from source

For a reviewed checkout of [the source repository](https://github.com/happyer29/pi-local-policy), the local management scripts remain available. This is an alternative to npm installation; do not combine them in one profile.

Open a terminal in the repository directory and preview the plan, then apply it:

```sh
node scripts/install.mjs
node scripts/install.mjs --apply
```

For a separate profile, pass `--agent-dir /absolute/path/to/agent` to both commands. This argument alone does not set `PI_CODING_AGENT_DIR` for the Pi process.

The installer copies runtime files into `<agent-dir>/extensions/local-policy`, saves backups and installation records, and registers the extension in `settings.json` while preserving other settings. It excludes the standard `extensions/bash-guard/index.ts` and `extensions/web-fetch/index.ts` paths and replaces a selected built-in `codemode` in `defaultTools` with `local_codemode`. Other handlers require separate review. The source files of excluded extensions stay in place.

If the target contains an older unmanaged `local-policy`, the installer archives it and preserves its `config.json`. It does not merge tool implementations. Reinstalling over an existing managed installation is prohibited. The plan displays the exact changes; installation does not download dependencies, call models, or perform Git operations. Run `/reload` and check `/local-policy` afterward.

## Selecting a project and source materials

By default, the project root is Pi's working directory. Relative tool paths are resolved from the selected root.

If Pi was started from your home directory, or you want to work in another project:

```text
/local-policy root /absolute/path/to/project
/reload
/local-policy
```

The directory must already exist. `/`, the entire home directory, general `Documents`, `Desktop`, and `Downloads` directories, major system and shared toolchain directories, credential directories, agent configuration directories, and `.git` are not accepted as a project root. A dedicated research directory inside `Documents` is suitable.

The selected root is a trusted write grant. The check does not recognize every system or valuable directory: select only a dedicated project working directory.

Additional materials can be connected read-only:

```text
/local-policy allow-read /absolute/path/to/source-materials
```

This does not permit changes to the connected materials or override protection for known secret paths. Select the specific directories needed for the task.

The root and `allow-read` grants are saved in the current Pi session branch and restored after it reloads. They are not global grants for every new chat. There is currently no command to revoke a single `allow-read` grant; start a new session for a clean set of permissions.

Available commands:

| Pi command | Purpose |
| --- | --- |
| `/local-policy` | Show status, root, and counters |
| `/local-policy status` | Show the same status |
| `/local-policy root /absolute/project` | Select this session's working project |
| `/local-policy allow-read /absolute/folder` | Add read-only access |

These are user commands. The model cannot grant itself permission through an ordinary tool call.

## Model tools

Pi chooses tools to match the task. Usually, describing the desired result in ordinary language is enough.

| Name | Implementation and limits |
| --- | --- |
| `read` | Reads permitted files through an isolated process; retains support for common image formats |
| `write`, `edit` | Writes and edits only in the project and temporary workspace; protected paths are excluded |
| `grep`, `find`, `ls` | Searches and lists permitted files; hides or skips protected paths |
| `bash` | `/bin/bash --noprofile --norc` inside Seatbelt, without network access or user shell startup files |
| `network_bash` | The same file isolation, with network access after approval of one invocation |
| `web_fetch` | Public HTTP(S) GET with address and redirect checks, without authentication |
| `local_codemode` | Groups tool calls; every nested action is checked |

The names `read`, `write`, `edit`, `grep`, `find`, `ls`, `bash`, and `web_fetch` replace the standard implementations. If another extension registers a tool with the same name and its source does not match the expected source, the policy blocks it instead of running the original implementation.

The built-in `codemode` is blocked because, in the tested Pi version, it exposes helper model APIs outside the ordinary tool path. `local_codemode` is created with `models: false`: action grouping remains available, while the direct helper model API is not provided.

### Local commands

Examples of tasks without approval prompts:

> Read the Markdown files in the project, find contradictions, and write a list to findings.md.

> Process a local CSV using existing tools and save a summary table in the project.

> Run the local tests and fix the discovered bug.

Processes receive a fresh temporary `HOME`, `TMPDIR`, and cache directories for each invocation. Most environment variables are not passed through. In particular, ordinary API keys, the SSH agent, shell startup settings, and user Git configuration are not passed through. Commands may behave differently from your usual user shell.

Dependencies that need existing files outside permitted roots, a user-specific Python installation, service login, or network access may not work automatically. Do not assume every program failure is a policy bug. First check which resources the program actually needs.

Save final results in the project: temporary directories are not long-term storage. The current version does not automatically clean up temporary workspaces.

### A command with network access

When a task really requires networking from the shell, the model can call `network_bash`. You see the specific command, and approval applies only to that invocation. Rejection, cancellation, or the absence of an approval interface means the command does not run.

After approval, the process and its children have network access, including access to local and private addresses. File restrictions and the sanitized environment remain in effect. **An approved network command can send any project or connected-directory materials it can access over the network.** Approval does not inspect the content and destination of every subsequent network request.

Ordinary computer credentials do not become available after approval. Authenticated publishing and deployment may require a separate trusted tool. The extension has no unrestricted fallback executor.

### Public sources

`web_fetch` accepts public HTTP(S) URLs on standard ports and checks DNS and every redirect. The connection address is pinned after validation. Local, private, and reserved addresses, URLs with a username or password, and recognized authentication parameters are rejected.

HTML, plain text, Markdown, and JSON are supported. Limits: up to 2 MiB of response data, up to five redirects, and 15 seconds per request. Page JavaScript is not executed. HTML is converted to simplified text.

PDF, archives, arbitrary binary formats, and compressed responses are not currently supported. Some sites require a browser or login. A local PDF can be processed separately by an available program in the project, but this extension does not include a research PDF pipeline.

Fetching a public page still makes a network request to a third-party site. Search queries and URLs should not be treated as a private channel for secret data.

### Additional tools

By default, exact paths inside the agent directory are checked:

- `web_search` is allowed automatically if its source is `extensions/web-search/index.ts`. A different reviewed package location requires an explicit `readTools` grant below.
- `browser_goto`, `browser_eval`, `browser_console`, `browser_network`, `browser_fill`, `browser_click`, `browser_screenshot`, and `browser_close` require approval if their source is `extensions/browser/index.ts`.
- The standard Pi tools `ask_user_question` and `quiz` are allowed for communication with the user.
- Other tools, including MCP and subagents, are blocked until explicitly configured.

The path check confirms the registration source but does not assess the safety of third-party extension code. `web_search`, the browser, and explicitly connected external tools execute in their own trusted extensions; the file isolation of `bash` does not automatically apply to them. Review these extensions before connecting them.

Create or edit the persistent user configuration at `<agent-dir>/local-policy.json` (normally `~/.pi/agent/local-policy.json`). Keep personal grants here so package updates do not overwrite them:

```json
{
  "version": 1,
  "readRoots": [],
  "readTools": {},
  "askTools": {}
}
```

- `readRoots` adds permanent read grants for every session in this profile. Protected secret paths remain excluded.
- `readTools` currently accepts only `web_search`, mapped to the exact absolute path of its source extension, and permits automatic search execution. This is a trust grant to host extension code, **not** a sandbox or proof that the tool is read-only. Use it only after reviewing the extension. For example, an independently installed search extension at a nonstandard package path can be explicitly trusted with `"readTools": { "web_search": "/absolute/path/to/reviewed/search/index.ts" }`. Other tool names in `readTools` are rejected.
- `askTools` uses the same exact-name/exact-source format, but every invocation asks for approval. For example: `"askTools": { "example_tool": "/absolute/path/to/reviewed/extension/index.ts" }`. This illustrates the format; do not add a nonexistent tool. Conflicting grants are rejected.

The persistent file is used as a complete configuration, without merging package defaults. When it is absent, the extension falls back to its adjacent `config.json` (`src/config.json` in a package, or `config.json` in a legacy flat manual installation). Do not store new personal grants in the npm package directory. After editing, run `/reload`. Invalid configuration causes blocking rather than disabling the rules.

## Security boundaries

The policy controls model actions through tools and the verified nested codemode call path. It does not isolate the entire Pi process.

- **Pi, installed extensions, and user configuration are trusted.** An extension with arbitrary code can act outside the checked path. Checking a tool's name and source does not make a malicious extension safe.
- **User commands entered with `!` use the user's shell.** They do not become restricted model commands.
- **The file system is restricted; content is not fully classified.** A secret inside an ordinary `notes.md` remains readable project data. Path filters and checks for some token formats do not replace secret management.
- **Metadata is not fully hidden.** Seatbelt permits file metadata reads so programs can function. System and toolchain directories are readable according to the permitted rules. Detailed roots are listed in `src/sandbox.mjs`.
- **Connected materials and web pages can contain malicious instructions.** The extension does not determine source reliability or eliminate prompt injection. Restrictions apply to subsequent tool calls.
- **Git is protected against writes.** `git status`, `diff`, and `log` are usually available; run `git add`, commits, branch changes, and other operations that write to `.git` manually. Ordinary working-copy files can still be modified.
- **There is no automatic privilege escalation.** A Seatbelt failure, a disallowed path, or an unknown tool returns an error. There is no automatic switch to an unrestricted executor.

For implementation details, see [docs/architecture.md](docs/architecture.md). For vulnerability reporting and the trust model, see [SECURITY.md](.github/SECURITY.md).

## Updating and removal

For the npm installation, use Pi's package manager. This README installs a pinned version deliberately: review the next release, then install its explicit version (for example, `pi install npm:pi-local-policy@0.1.1` once that release exists). Do not run the manual installer over a package-managed installation.

To remove the npm package:

```sh
pi remove npm:pi-local-policy
```

Then run `/reload`. Review any conflict exclusions you added separately: package removal does not restore them. Your `<agent-dir>/local-policy.json` is a user-owned file and is not removed with the package. Keep or remove it manually as needed.

### Removing a script-managed installation

From a reviewed source checkout, preview and apply:

```sh
node scripts/uninstall.mjs
node scripts/uninstall.mjs --apply
```

For a separate profile, add `--agent-dir /absolute/path/to/agent` to both commands. These scripts remove only their own managed installation; they do not uninstall an npm package or arbitrary unmanaged copies.

Removal unregisters the managed extension and archives its files and configuration. The `extensions` and `defaultTools` settings fields are restored only if the corresponding field still matches the post-install snapshot. If a field changed later, only this extension's `local-policy`/`local_codemode` references are removed; other entries are preserved and a warning is displayed. Earlier conflict exclusions may then need manual review.

If installation replaced a pre-existing unmanaged `local-policy` directory, removal restores it from the original archive. The preview shows `restorePreviousExtension`; if that archive is missing, removal stops. Backups remain available. Run `/reload` afterward.

A managed manual installation cannot be updated in place: remove it first, review the new source, then install it. To migrate to npm, make sure the old flat extension and its registration are no longer loaded before running `pi install`. Move reviewed legacy grants from the archived `config.json` into `<agent-dir>/local-policy.json` before migration. The persistent configuration takes precedence over packaged or legacy defaults and survives package updates.

## Development and tests

For development, install dependencies without running lifecycle scripts:

```sh
npm ci --ignore-scripts
npm test
```

The repository includes `package-lock.json` for reproducible development installations. The Pi SDK package family is pinned to the tested **1.0.3** versions for integration tests; use `npm ci` to preserve that dependency set. These development pins do not replace the runtime dependencies bundled by your installed Pi host.

`npm test` runs portable tests for policy decisions, public fetching, profile generation, and extension checks through the real Pi loader. `web_fetch` network behavior is tested with DNS and HTTP mocks; tests do not call models or use real keys.

Native tests use the installed Pi development dependency. To test a specific external installation, set `PI_CODING_AGENT_ROOT` to the absolute directory path of the `@earendil-works/pi-coding-agent` package. If Pi is not installed, native integration checks are skipped: such a run only checks the available portion. An explicitly configured but invalid path or an incompatible SDK must cause a failure.

On macOS, also run the real Seatbelt checks:

```sh
npm run test:sandbox
```

They check file restrictions, synthetic secrets, symlinks, child processes, environment sanitization, network denial, cancellation, and an ordinary workflow through Pi tools. They require permission to run `sandbox-exec`: an additional outer sandbox may prohibit nested Seatbelt.

Skipped isolation tests, or an environment that prohibits running them, do not confirm that isolation works in that environment. Passing tests also do not prove the absence of every bypass.

Releases are published manually to npm. CI runs tests and release checks; it does not publish automatically. The npm package has an explicit file allowlist and contains runtime code, documentation, license, and the optional management scripts, not local user settings or test fixtures.

Before preparing a publication, check the release contents:

```sh
npm run check:release
npm run check:package
```

## Repository contents

```text
pi-local-policy/
├── README.md                 # English entry point
├── LICENSE
├── package.json
├── src/                      # Extension runtime and default configuration
├── scripts/                  # Installation, removal, and release checks
├── tests/                    # Automated checks
├── docs/
│   ├── architecture.md       # English architecture
│   └── i18n/
│       ├── ru/               # Complete Russian documentation
│       └── zh-CN/            # Complete Simplified Chinese documentation
└── .github/                  # CI, security policy, and contribution guide
```

The Pi package loads `src/index.ts` and keeps the source layout intact. The optional manual installer instead copies the contents of `src/` directly into `<agent-dir>/extensions/local-policy/`, without a nested `src/` directory. Run source-management and check commands from the repository root.

| File or directory | Purpose |
| --- | --- |
| `src/index.ts` | Tool registration, call handler, approvals, and Pi commands |
| `src/policy.mjs` | Decisions about paths, tool names and sources, and selected command checks |
| `src/sandbox.mjs` | Seatbelt profile, environment, and process execution |
| `src/fs-worker.mjs` | File operations inside an isolated process |
| `src/public-fetch.mjs` | Restricted public HTTP(S) fetching |
| `src/config.json` | Packaged fallback defaults; personal grants belong in `<agent-dir>/local-policy.json` |
| `scripts/` | Local installation and removal |
| `tests/` | Automated checks |
| `README.md`, `.github/SECURITY.md`, `.github/CONTRIBUTING.md` | Canonical English usage, security, and contribution documents |
| `docs/architecture.md` | Canonical English component design and boundaries |
| `docs/i18n/ru/`, `docs/i18n/zh-CN/` | Complete Russian and Simplified Chinese documentation, including translated READMEs |

The repository must not contain user Pi settings, sessions, API keys, local backups, or research materials.

## License

The code is distributed under the [MIT](LICENSE) license. The software is provided without warranties; see the license file for the full terms.
