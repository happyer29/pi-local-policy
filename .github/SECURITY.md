# Security and trust model

[English](SECURITY.md) | [Русский](../docs/i18n/ru/SECURITY.md) | [简体中文](../docs/i18n/zh-CN/SECURITY.md)

Pi Local Policy is an experimental restriction layer for model tools on macOS. The project has not undergone an independent security audit. Test results describe the scenarios checked; they do not prove the absence of bypasses.

English is the default documentation and user-facing message language. This English document is the canonical reference for the Russian and Simplified Chinese translations linked above.

## Tested version

The current compatibility target is `@earendil-works/pi-coding-agent` **1.0.3**, Node.js **22.19+**, and macOS with `/usr/bin/sandbox-exec`. Other Pi versions, Linux, and Windows are not considered supported runtime environments. macOS may restrict or change Seatbelt availability; execution is blocked if initialization fails.

## What is restricted

- Model tool calls are checked by name, registration source, path, and action type.
- Controlled file operations and processes run under a deny-default Seatbelt profile.
- Writes are allowed in the selected project and current temporary workspace, with additional exclusions for control files and known secret paths.
- Ordinary processes do not receive network access or most host environment variables; child processes inherit the restrictions.
- Nested `local_codemode` calls follow the same checking path.
- Public fetching validates DNS and redirects and pins the validated connection address.
- A checking error, unknown tool, user rejection, or missing UI for a required approval does not trigger unrestricted execution.

## What remains trusted

Pi, Node.js, macOS, installed extension code, and user configuration remain trusted. This extension does not isolate the whole Pi process: an arbitrary extension can execute its own code at load time, in a handler, or outside the ordinary tool path.

Checking an exact source path does not verify an extension's contents. Permitted `web_search` (including a configured `readTools` source), browser, and `askTools` handlers execute in their own host code and do not automatically receive the file isolation of this extension's `bash`. User `!` commands also remain actions performed by the user.

## Significant limitations

- Selecting a project grants permission to modify and delete ordinary files without approval. Restricting the scope is not a substitute for backups.
- The disallowed-root list does not recognize every valuable directory. Choose a dedicated working directory, check `Root` after startup, and avoid broad read grants.
- Secret protection relies on known paths and selected value formats. A key in an ordinary document may remain accessible. Reading file metadata is permitted more broadly than reading file contents.
- An approved `network_bash` receives network access, including local network access, and can send any project or read-root materials it can access. Approving the command does not inspect each subsequent request.
- Public GETs and search queries disclose their URL or query to the corresponding service; GET alone does not guarantee the absence of server-side effects.
- This policy does not eliminate third-party program bugs, malicious instructions from the web or source materials, research inaccuracies, or costs of the main model.
- Temporary workspaces are not cleaned up automatically. Project data and synthetic test files may remain in the user's temporary directory.
- Persistent `<agent-dir>/local-policy.json` grants and fallback package configuration are trusted input. `readTools` permits only explicitly sourced `web_search`, but this source path is not a code audit or an operating-system restriction.
- The installer is a trusted user script. Its path checks do not protect against another host process concurrently modifying installation files.

## Reporting a problem

First reproduce the issue using synthetic files without real keys, personal data, or other people's materials. Include macOS, Node, and Pi versions, the expected restriction, the tool called, and minimal reproduction steps.

For a reproducible boundary bypass, use [private vulnerability reporting](https://github.com/happyer29/pi-local-policy/security/advisories/new) if it is enabled for this repository. Otherwise, arrange a private channel with the maintainer through the project's available contacts. No dedicated security address has been announced yet. Do not attach real tokens, authentication configuration contents, or private sessions to a public issue.
