---
name: test-t3-app
description: Run and test T3 Code in isolated development state. Use for web UI verification, mobile verification through T3's Device panel and AgentDevice, pairing recovery, and SQLite fixtures. Retain the environment across iterations.
---

# Test T3 Code

For web, use the workflow below. For mobile, follow
[`test-t3-mobile`](../test-t3-mobile/SKILL.md). Mobile verification requires T3's
`device_*` tools and Device panel. If they are unavailable, report the setup
blocker and stop device verification. Do not substitute XcodeBuildMCP, a Codex
iOS plugin, standalone simulator streaming, or raw device automation.

## Start or reuse an isolated environment

Run from the repository root. Reuse the task's healthy dev server and state
before starting another. Otherwise run `vp run dev`, which uses the worktree's
ignored `.t3`. For disposable state, use `mktemp -d /tmp/t3code-test.XXXXXX` and
pass that absolute path with `--home-dir <base-dir>`.

Keep the terminal session and read the actual ports, base directory, and web
origin from the `[dev-runner]` output. Ports can shift. Never start against or
write to `~/.t3/userdata`, and never set `VITE_HTTP_URL` or `VITE_WS_URL` for dev.
Vite proxies the backend through the web origin.

Use meaningful project and thread data. Read
[references/sqlite-fixtures.md](references/sqlite-fixtures.md) when inspecting
or seeding SQLite. Use app commands for behavior tests; direct projection
fixtures belong only in disposable state, with the server stopped before writes.

## Pair the browser

Use the available controlled browser. Do not pass `--browser` to the dev runner,
since an automatically opened page can consume the startup token.

Open the complete startup `/pair#token=...` URL once, preserving its fragment.
Wait for pairing and the redirect, then keep using the same browser context.
Keep credentials out of screenshots and committed files.

If the token expires or was consumed, run `node apps/server/src/bin.ts pair`.
It discovers the worktree's running server. If you used `--home-dir`, pass the
same absolute path as `--base-dir`. Replacement tokens have standard scopes;
Connections management needs the admin-scoped startup URL.

## Share when requested

Start with `vp run dev --share`. Give the user the complete printed pairing URL
when they need to pair. Never consume the token you hand them. If you also need
an authenticated browser, mint a separate token for it.

Before handoff, verify the bare shared origin loads in the controlled browser
when browser use is authorized. Curl alone cannot detect browser-blocked ports.
Do not configure Tailscale serving separately.

## Verify and retain the result

Exercise the affected flow and capture evidence that shows the intended state.
For mobile, keep the selected device visible in this thread's Device panel and
drive it with the exact AgentDevice command returned by `device_open`.

Retain the dev process, state, authenticated client, and fixtures while the user
may inspect the result or request changes. An assistant turn ending is not
teardown. On follow-up turns, reuse the recorded ports and base directory;
restart with the same state if the process exited.

When the testing loop is finished, stop only processes you started, using their
retained terminal sessions or captured PIDs. Remove only disposable paths
created for this task, and preserve useful reproduction state. Mention any
environment left running with its non-secret web origin.
