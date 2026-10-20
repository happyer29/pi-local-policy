# Contributing

[English](CONTRIBUTING.md) | [Русский](../docs/i18n/ru/CONTRIBUTING.md) | [简体中文](../docs/i18n/zh-CN/CONTRIBUTING.md)

Discuss changes in terms of tool behavior and boundaries: automatic execution, approval for one invocation, or blocking. A permission change should include an example of what becomes available to the user and what remains prohibited.

English is the default language for documentation and user-facing messages. The English documents are the canonical reference. Keep the Russian and Simplified Chinese translations linked above aligned with changes to their English originals; documentation translations do not imply a runtime locale switch.

## Local checks

```sh
npm ci --ignore-scripts
npm test
npm run check:release
npm run check:package
```

On macOS, also run:

```sh
npm run test:sandbox
```

Pi for native integration tests comes from the development dependency or `PI_CODING_AGENT_ROOT`. Skipping tests because the SDK is missing does not confirm compatibility. A configured but broken SDK must cause a failure. Real Seatbelt tests require permission to run `sandbox-exec` without an outer sandbox that prohibits it.

Use only temporary directories and synthetic secrets. Tests must not call a model, publish data, use the user's authentication, or change a live Pi installation.

## Code areas

- `src/policy.mjs`: pure decisions about paths, tools, and selected command patterns.
- `src/sandbox.mjs`: Seatbelt profile, sanitized environment, child processes, and execution limits.
- `src/index.ts`: Pi API, tool registration and checking, approval UI, and session settings.
- `src/public-fetch.mjs`: public HTTP(S), DNS, redirects, and fetch size and time limits.
- `scripts/management.mjs`: installation and removal with change previews and backups.

Do not silently allow a new tool based on its name alone. Describe its registration source, accessible resources, behavior without UI, and nested call path. Accompany a security change with a check of a meaningful boundary, rather than merely repeating the implementation.

Keep the README, trust model, and tests consistent with actual behavior. Do not claim protection against every bypass or compatibility with untested versions. When adding a file, update the explicit release list in `scripts/check-release.mjs`.

Release publishing is manual; CI runs checks on macOS and does not publish automatically. Before a release, review the `npm pack --dry-run` file list and run `npm run check:release`, the full supported macOS test suite, and a fresh-profile install from the packed artifact. Keep personal grants in `<agent-dir>/local-policy.json`, outside package contents. Do not include credentials or local settings in the package. See [SECURITY.md](SECURITY.md) for reporting security issues.
