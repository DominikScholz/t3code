---
name: test-t3-app
description: Test T3 Code through its built-in Browser and Device panels against isolated development state. Use for UI verification, pairing recovery, and test fixtures.
---

# Test T3 Code

Use T3's built-in panels for verification. If the required T3 tools are absent
or the panel reports unavailable, explain the blocker and stop verification.
Do not install or switch to another automation system.

## Start the app

Reuse this task's healthy dev server. Otherwise run `vp run dev` from the
repository root and retain its terminal session. Use the worktree's ignored
`.t3` state and read the actual ports and pairing URL from the dev-runner output.
Never run against `~/.t3/userdata` or set `VITE_HTTP_URL` or `VITE_WS_URL`.

Test with meaningful project and thread data. Read
[references/sqlite-fixtures.md](references/sqlite-fixtures.md) only when
inspecting or seeding SQLite. Stop the test server before direct fixture writes.

## Use the T3 panels

For web, call `preview_status`, then `preview_open` if the Browser panel is
closed. Navigate to the complete startup pairing URL once with
`preview_navigate`, then use `preview_snapshot` and T3's interaction tools.
If the token was consumed or expired, run `node apps/server/src/bin.ts pair`
for a fresh one. Keep using the same tab.

For mobile, call `device_list`, then `device_open` with the selected host and
device IDs. T3 boots the device and shows its live stream in the Device panel.
Follow the returned `quickStart`, using the exact `agentDevice.command` and
all `targetArgs` on every command. Use `device_screenshot` to inspect the screen.
See [test-t3-mobile](../test-t3-mobile/SKILL.md) for launching and pairing T3 Code
Dev. T3 owns device tooling and connections.

## Verify and retain

Exercise the affected flow and capture the state that proves it works. Keep
the server, state, and panel available while the user inspects or iterates.
An assistant turn ending is not teardown. Stop only processes you started,
using retained terminal sessions or captured PIDs.

When sharing is requested, start with `vp run dev --share` and give the user
a fresh complete pairing URL that you have not consumed. Keep other credentials
out of screenshots, commits, and replies.
