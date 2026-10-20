# Pi Local Policy architecture

[English](architecture.md) | [Русский](i18n/ru/architecture.md) | [简体中文](i18n/zh-CN/architecture.md)

This document describes the current implementation, not a universal sandbox mechanism for all Pi capabilities. Compatibility is tied to the tested SDK version. General installation and usage instructions are in [README.md](../README.md); the trust model is in [SECURITY.md](../.github/SECURITY.md).

English is the default documentation and user-facing message language. This English document is the canonical reference for the Russian and Simplified Chinese translations linked above.

## Call path

```text
User task
        ↓
Pi's main model
        ↓
Tool call / nested local_codemode call
        ↓
tool_call: name + registration source + arguments
        ├── unknown or prohibited → error
        ├── trusted search source → automatic external handler
        ├── external approved tool → approval for one invocation
        └── permitted tool owned by this extension
                 ├── file operation → fs-worker in Seatbelt
                 ├── bash → process in Seatbelt without network access
                 ├── network_bash → approval → Seatbelt with network access
                 └── web_fetch → restricted public HTTP(S) GET
```

The diagram does not cover arbitrary actions performed by Pi's own code or third-party extensions: they belong to the trusted part of the system.

## 1. Tool call and source checks

`src/index.ts` registers this extension's tools and a `tool_call` handler. `src/policy.mjs` checks the tool name and the exact path of the file that registered it. Matching the name `bash` alone is insufficient: the expected handler from this extension must be used.

This allows execution to be refused when names conflict. Such a check does not verify that the file on disk is unchanged or isolate third-party extensions.

File tools undergo additional path checks. For `bash`, selected explicitly prohibited command forms are checked. An error in the checking handler becomes a block. An unknown tool does not gain access automatically.

Command-text checks are supplementary. They are not a full shell parser and do not try to prove that any script is safe. The macOS Seatbelt profile provides the actual access restrictions for this extension's commands and their child processes.

## 2. Paths and workspace

Paths are made absolute, resolving existing symlinks. For a file that does not yet exist, the nearest existing parent is checked. Both the original and resolved paths are checked.

Ordinary data can be read in the project, temporary workspace, and additionally permitted roots. Writes are allowed in the project and temporary workspace. Known secret paths are excluded regardless of general grants. Writes to `.git`, agent directories, and known instruction files are prohibited.

Besides user-provided sources, trusted read roots include extension files, Pi skill and extension directories, required runtime directories, and registered full command-output files. The profile itself permits reading required system and toolchain directories. This is not a promise to hide the entire file system or its metadata.

The session root and additional grants are recorded in a custom entry in the Pi branch. After reload, the latest applicable entry in the current branch is read.

Persistent profile configuration is read from `<agent-dir>/local-policy.json`. If it exists, it replaces the adjacent packaged or legacy `config.json` completely; it is not merged. A malformed persistent file blocks execution rather than falling back to defaults. The npm package loads `src/index.ts`; manual installation uses a flat runtime directory. Both use the same profile-level configuration location, so user grants can survive package updates. Configuration is user-controlled trusted input.

Optional `readTools` accepts only an exact source mapping for `web_search`, permitting its reviewed host handler to run automatically outside Seatbelt. `askTools` allows exact source mappings for approved external handlers; each invocation requires UI approval. Neither mapping isolates an external extension.

## 3. File operations

Standard Pi tool definitions are used for parameter and result compatibility where possible. File contents are read and written by `src/fs-worker.mjs`, launched through `runSandbox`; JSON input is passed through stdin. The preliminary path check is not the only restriction: the system policy also applies when the actual operation occurs.

`grep` and `find` run ripgrep inside Seatbelt. Its executable is resolved only from `<agent-dir>/bin/rg` and fixed Homebrew/system paths; a missing binary is reported instead of being downloaded automatically. Errors caused by skipped protected files are not presented as proof that the searched-for data does not exist: search results may be incomplete. `ls` filters entries according to read rules.

## 4. Processes and temporary directories

`src/sandbox.mjs` builds a deny-default profile. It then permits necessary process operations, reads from permitted roots, writes to the project and temporary workspace, and limited system resources. Explicit denials for protected paths apply on top of general grants.

Each invocation gets a fresh temporary working directory with its own `HOME`, `TMPDIR`, XDG directories, and npm cache. Trusted code creates the structure outside the project; older processes that remain accessible must not be able to control new parent directories through symlinks. Previous temporary session results remain readable, but do not become a new shared writable area.

The environment is built from an allowlist. User shell configurations, API keys, the SSH agent, `NODE_OPTIONS`, `BASH_ENV`, and loader variables are not inherited. Git does not receive ordinary system or user configuration, and interactive credential prompts are disabled.

Execution uses `/bin/bash --noprofile --norc`. Cancellation and timeout terminate the process group. There is no alternative execution without Seatbelt if initialization fails. Retained output size is limited, but there is no comprehensive CPU, RAM, or disk quota system.

Processes can execute programs accessible under the profile rules. Isolation does not mean that only a predefined list of safe programs is allowed.

## 5. Network access and approval

Ordinary `bash` starts with network access denied. Before running, `network_bash` displays the command in Pi's UI. Approval is not remembered for future calls; dialogs are serialized. Missing UI, cancellation, dialog timeout, or detected secrets in arguments cause rejection.

After approval, networking is enabled for the process and its descendants, including local and private addresses. Other restrictions remain. This is permission to execute a command with networking, not approval of each future HTTP request. The process can send data it can read. Host credentials are deliberately not provided.

For trusted external tools in `askTools`, approval covers one invocation of their own handler. Those handlers do not run inside this extension's Seatbelt. Browser actions, in particular, have the permissions of the installed browser extension.

## 6. Public fetching

`src/public-fetch.mjs` uses HTTP(S) GET without user-supplied headers, cookies, authentication, proxies, or reused connections. The URL is checked before connecting. All DNS answers must be permitted public addresses; the connection address is pinned in the specific request's `lookup`. Each redirect repeats the same process.

Fetching has an overall timeout and limits on response size and number of redirects. A limited set of text MIME types is supported. HTML is cleaned through a simplified conversion, without executing JavaScript. This is not a full browser or a universal document parser.

The checks restrict request destinations, not the reliability of returned content. Page text remains untrusted source data for the model.

## 7. Codemode

The standard codemode in the tested Pi version provides a helper `models` namespace. For this extension, it is created with `models: false` and registered as `local_codemode`.

Available nested tools exclude the standard `codemode` and recursive `local_codemode`. Nested call execution is passed to the standard `ctx.executeTool` to preserve the `tool_call` path and access rules. The standard `codemode` is also prohibited by the policy handler and removed from active tools.

This does not prohibit Pi's main model calls. It removes a separate helper model-call path from codemode.

## 8. What the tests check

- Decisions about paths, symlinks, protected names, and roots.
- Decisions about tool names and sources, including spoofing a tool owned by this extension and explicit trusted search sources.
- The environment and Seatbelt profile generation.
- Public page fetching using mocked DNS and HTTP: addresses, redirects, cancellation, timeouts, response size, and response type.
- Extension loading through the real Pi loader, handling through ExtensionRunner, and ordinary tool dispatch.
- Nested codemode calls without calling a model.
- In a separate macOS run: actual reads, writes, sentinel secrets, symlinks, network denial, child processes, cancellation, and an ordinary workflow.

The tests do not replace an independent audit, cover arbitrary malicious extension code, or prove that macOS or Pi has no vulnerabilities.
