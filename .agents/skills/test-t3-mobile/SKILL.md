---
name: test-t3-mobile
description: Test T3 Code Mobile on an iOS Simulator or Android Emulator through T3's Device panel and its pinned AgentDevice CLI. Use for mobile UI and native verification against isolated T3 state. Requires T3 device tools; stop device verification when the hub or agent access is unavailable.
---

# Test T3 Mobile

Use T3 Code's device hub for discovery, booting, and live viewing. Use its
AgentDevice launcher for app navigation and UI control. Follow
[`test-t3-app`](../test-t3-app/SKILL.md) for isolated state, pairing semantics,
fixtures, and retaining the test environment across iterations.

## Require the Device panel

1. Confirm the `t3-code` MCP exposes `device_list`, `device_open`, and
   `device_screenshot`, then call `device_list`.
2. Choose one explicit `hostId` and `deviceId` for the affected platform. For a
   cross-platform change, use one representative available simulator or emulator.
3. Call `device_open` with both IDs. It boots the device, starts the live stream,
   and attaches it to this thread's Device panel.
4. Retain `agentDevice.command`, every item in `agentDevice.targetArgs`, and the
   returned `quickStart`. Use that exact executable and all target arguments on
   every command, including `--config` and `--session`. Login shells can reset
   PATH, and opening another device does not retarget an earlier command.

If the tools are missing, the hub or agent access is disabled, the selected
host/platform is unavailable, or `device_open` fails, report the exact blocker
and stop device verification. The user can enable Device hub and Agent device
access in T3's Device panel setup or Settings > Integrations, including any
project override. Resume only when the tools work. Continue independent code
checks if useful, without claiming a device pass.

Do not install iOS/Codex plugins, attach XcodeBuildMCP, start a separate device
hub or AgentDevice daemon, create another connection config, stream a simulator
in a browser, or fall back to direct `simctl`, `adb`, or desktop UI automation.
T3 owns the device toolchain and its connections.

## Ensure the native client

Run from the checkout being tested on the selected device host:

```bash
node scripts/mobile-native-client.ts ensure <ios|android> <device-id>
```

This helper checks the local Expo fingerprint and installed binary, then builds
and installs a development client when needed. Authorized mobile verification
includes this build step. Use `check` instead only when the user prohibits
rebuilding or requests a read-only decision. Do not infer compatibility from a
JavaScript-only diff or a recent install. On hosts requiring `agent-job`, run
the helper through that queue.

For an SSH device host, use a matching checkout there. T3 routes discovery,
streaming, and AgentDevice control; it does not sync code or arrange builds and
Metro networking. Report missing host prerequisites rather than switching
device tooling. The native-client helper may use platform build/install tools
internally; use AgentDevice for interactive device operations.

## Start the backend and Metro

Use one isolated backend with meaningful seeded projects, following
`test-t3-app`. For mobile alone, run:

```bash
node apps/server/src/bin.ts serve --host 127.0.0.1 --port <server-port> \
  --base-dir <base-dir> --no-browser
```

If web dev is already running, reuse its backend and base directory. Never run
two backends over the same state. Use these backend origins when the backend
and device host are the same machine:

| Device           | Backend origin                   |
| ---------------- | -------------------------------- |
| iOS Simulator    | `http://127.0.0.1:<server-port>` |
| Android Emulator | `http://10.0.2.2:<server-port>`  |

For a remote device host, use an origin reachable from that host, such as the
shared tailnet origin. Loopback refers to the device host, not the agent's
machine. Metro must also be reachable from the device.

After `ensure` succeeds, run `vp run dev:client` from `apps/mobile`. Reuse a
healthy Metro only when its worktree, development variant, scheme, and port
match. If its port is occupied by another task, choose a free port:

```bash
APP_VARIANT=development vp exec expo start --dev-client --scheme t3code-dev \
  --lan --port <metro-port>
```

Use the printed LAN development-client URL reachable from the device. Open it
with the returned executable and target arguments:

```bash
"$agent_device_command" open com.t3tools.t3code.dev '<printed-dev-client-url>' \
  "${agent_device_target_args[@]}"
```

Here `$agent_device_command` is `agentDevice.command`, and the Bash array
`agent_device_target_args` contains every returned target argument verbatim.
Confirm the loaded bundle belongs to this checkout and Metro port. Resolve
networking on the selected host if it cannot connect; do not add an automation
fallback.

## Pair through the existing route

Run the bundled helper from the repository root:

```bash
.agents/skills/test-t3-mobile/scripts/pair-client.sh \
  <server-port> <base-dir> <device-reachable-backend-origin> \
  "$agent_device_command" "${agent_device_target_args[@]}"
```

It mints a fresh credential against the exact backend state, then uses
AgentDevice to open
`t3code-dev://connections/new?pairingUrl=<encoded-url>&autoConnect=1` in
`com.t3tools.t3code.dev`. The development route submits once and returns to
Home. Verify the seeded projects appear before testing the affected flow.

Create a different credential for each client or failed pairing attempt. Do
not type credentials through device keyboard automation or expose them in
screenshots, commits, or final responses.

## Drive and verify

Follow the returned `quickStart`. The usual loop is `snapshot -i`, `click @eN`
or `fill @eN "text"`, then a fresh snapshot to verify the result. Refresh refs
after navigation and layout changes. Use the returned executable's `help
workflow`, `help react-native`, or `<command> --help` for guidance matched to
T3's installed version. First iOS use can build an XCTest runner and take a
couple of minutes; Android installs its snapshot helper on first use.

Keep the user watching the same device in the Device panel. Use
`device_screenshot` with both IDs to inspect the screen, or AgentDevice
`screenshot <path>` with all target arguments to save evidence. Exercise only
the affected flow unless platform or screen-size differences matter. Confirm
the intended environment and final state, not just an open or disconnected app.

Keep the backend, Metro, and device attached while iterating. At teardown,
remove the disposable connection from T3 Code Dev, close the AgentDevice session
with its retained target arguments, and call `device_close` with both IDs.
Leave shutdown off unless the task owns the booted device and no one needs it.
Stop only your backend and Metro processes; T3 owns hub and stream cleanup.

AgentDevice's [command reference](https://oss.callstack.com/agent-device/docs/commands)
explains the CLI. The `device_open` result and installed CLI help are the
authority for this T3 environment.
