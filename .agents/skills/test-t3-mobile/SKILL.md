---
name: test-t3-mobile
description: Launch and pair T3 Code Dev for mobile verification through T3's Device panel and returned AgentDevice command.
---

# Test T3 Mobile

Follow [test-t3-app](../test-t3-app/SKILL.md) for the T3 panel workflow and
isolated backend. Keep the device visible in the Device panel and use the
executable and target arguments returned by `device_open` for every operation.
If T3 device access is unavailable, report the blocker and stop verification.

## Launch T3 Code Dev

From the checkout being tested on the selected device host, run:

```bash
node scripts/mobile-native-client.ts ensure <ios|android> <device-id>
```

This reuses a matching native client or builds and installs one. Authorized
mobile verification includes that build step unless the user prohibits it.

Start `vp run dev:client` from `apps/mobile`, or reuse a healthy Metro belonging
to this checkout. Open its printed development-client URL with AgentDevice
`open com.t3tools.t3code.dev <url>` and all returned target arguments.
The device must be able to reach both Metro and the isolated backend.

## Pair and verify

Use the helper from the repository root, with the returned executable and target
arguments stored in `agent_device_command` and the Bash array
`agent_device_target_args`:

```bash
.agents/skills/test-t3-mobile/scripts/pair-client.sh \
  <server-port> <base-dir> <device-reachable-backend-origin> \
  "$agent_device_command" "${agent_device_target_args[@]}"
```

It issues a fresh credential and opens T3 Code Dev's existing pairing route
through AgentDevice. For a backend on the device host, use
`http://127.0.0.1:<server-port>` on iOS or `http://10.0.2.2:<server-port>`
on Android. For a remote backend, use its reachable origin.

Confirm the intended projects appear, exercise the affected flow, and capture
evidence. Retain the app and environment while iterating. At teardown, remove
the disposable connection, close the AgentDevice session, call `device_close`,
and stop only your backend and Metro processes.
