# Production Hub — PM Evaluation

**Project:** avantis-osc (Production Hub)
**Date:** February 9, 2026
**Evaluator:** Claude (PM Review)
**Verdict:** Ship-ready for controlled environments. Strong foundation, clear growth path.

---

## Executive Summary

Production Hub is a TypeScript/Node.js application that turns a single QLab GO button into coordinated control of an entire live production booth — audio console (Allen & Heath Avantis), lighting desk (ChamSys QuickQ 20), PTZ cameras (VISCA), streaming software (OBS Studio), and real-time rendering (TouchDesigner). One UDP port in, five protocols out.

The architecture is clean, the core engine is heavily tested, and the dependency footprint is minimal. It's the kind of project that clearly came from someone who actually runs shows — the design decisions reflect real booth constraints, not theoretical patterns. That said, there are gaps that would bite you in a production setting if left unaddressed.

**Overall score: 8.2 / 10** — solid work with a clear path to excellent.

---

## What's Working Well

**Architecture is the standout.** The prefix-based routing design (longest match first) means adding a new device is just implementing an interface and dropping a config block. The DeviceDriver contract is clean — all five drivers follow the same lifecycle pattern (connect, disconnect, handleOSC, feedback events). The hub owns the OSC server and fade engine; drivers just speak their native protocols. This separation of concerns will scale.

**The fade engine is production-grade.** 50Hz interpolation with four easing curves (linear, s-curve, ease-in, ease-out), concurrent fades across different strips, proper cancel/snap behavior. This is the piece that makes crossfades between cues feel smooth rather than jarring. The 739 lines of tests covering 50 cases give me confidence this won't glitch mid-show.

**MIDI protocol handling is thorough.** 72 tests covering all eight strip types, NRPN message building, channel mapping edge cases (the 1-48 vs 49-64 input split on the Avantis). The streaming MIDI parser handles running status and NRPN accumulation correctly. This is the hardest part of the Avantis integration and it's the best-tested piece of the whole project.

**Dependency discipline is excellent.** Four production dependencies: osc, ws, easymidi, yaml. No Express, no framework bloat. For a tool that needs to start fast and stay stable during a three-hour show, this matters.

**Operational readiness features are thoughtful.** Health check endpoint, pre-show systems check (probes external targets over TCP/UDP), dashboard, graceful shutdown on SIGINT/SIGTERM, watchdog integration via systemd service scripts. These are the features that separate "works on my laptop" from "runs the Sunday service."

---

## What Needs Attention

### Critical: OBS Driver Has Zero Tests

The OBS WebSocket driver is 472 lines of code handling SHA256 challenge-response authentication, JSON-RPC message framing, WebSocket reconnection, and scene/stream/record control. None of it is tested. This is the highest-risk gap in the project.

The auth flow in particular — computing SHA256 over password + salt, then SHA256 over that + challenge — is exactly the kind of thing that breaks silently when OBS updates their WebSocket protocol version. A test suite here would take 3-4 hours and would cover the most likely failure mode in production.

**Risk level:** High. If OBS auth breaks, your stream goes down and there's no automated way to catch it before showtime.

### Significant: Known Issues Are Documented But Not Tracked

The CLAUDE.md file lists six known issues, which is good transparency, but they're sitting in a markdown file rather than being tracked as actionable work items. A few of these are real operational risks:

- **VISCA preset mask truncates at 127** — the code does `presetNum & 0x7f` but validation allows 0-255. If someone programs preset 200 on their PTZ camera, it'll silently recall the wrong preset. That's a bad surprise during a show.
- **No message queuing on reconnect** — when OBS or VISCA drivers disconnect, messages are silently dropped. The reconnect queue module exists in the codebase but isn't wired into all drivers yet.
- **Cold-start fade fallback** — fades assume startValue of 0 if no feedback has arrived from the desk. If you fire a fade before the Avantis reports back, it'll jump the fader to 0 first. Audible glitch.

### Moderate: Driver Test Coverage Is Uneven

The core is well-tested (fade engine: 50 tests, MIDI protocol: 72, hub routing: 36, MIDI parser: 33). But the relay drivers (ChamSys: 4 tests, TouchDesigner: 5, VISCA: 5) have minimal coverage. These are simpler components, but connection/disconnection edge cases and UDP send failures deserve at least smoke tests.

### Minor: Single Git Commit

The entire project history is one commit: "Initial commit: Avantis OSC bridge." This means there's no traceability for when features were added, no ability to bisect regressions, and the commit message references the original single-device bridge rather than the current multi-device hub. Going forward, atomic commits per feature/fix would significantly improve maintainability.

### Minor: Test Runner Inconsistency

The package.json lists vitest as a devDependency, but the actual tests use Node's built-in test runner (`node:test`). The test scripts chain ts-node invocations. This works but is fragile — if one test file in the chain fails, the rest don't run. A proper test runner config would give parallel execution and better failure reporting.

---

## Metrics at a Glance

| Metric | Value |
|--------|-------|
| Source code | ~4,900 lines across 21 files |
| Test code | ~3,100 lines across 9 files |
| Test-to-source ratio | 64% |
| Test cases | 243 total, all passing |
| TypeScript strict mode | Yes |
| Type check | Clean (zero errors) |
| Production dependencies | 4 |
| Device drivers | 5 (Avantis, ChamSys, OBS, VISCA, TouchDesigner) |
| Protocols handled | 5 (MIDI TCP, OSC UDP, WebSocket, VISCA TCP, OSC relay) |
| Git commits | 1 |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| OBS auth failure (untested) | Medium | High (stream down) | Write OBS driver tests |
| VISCA preset truncation | Low | High (wrong camera shot) | Fix bitmask or tighten validation |
| Cold-start fade jump | Medium | Medium (audible glitch) | Query desk state on connect |
| Message drop during reconnect | Low | Medium (missed cue) | Wire reconnect queue into all TCP drivers |
| Single-threaded jitter under load | Low | Low (fade stutter) | Acceptable for typical show load |

---

## Recommendations — Prioritized

**Do now (before next production use):**

1. Write OBS driver tests — focus on auth handshake and reconnection logic
2. Fix the VISCA preset bitmask (either `& 0xFF` or tighten validation to 0-127)
3. Move the six known issues from CLAUDE.md into tracked issues (GitHub Issues, a board, whatever you use)

**Do soon (next development cycle):**

4. Expand driver test coverage — 15-20 tests each for VISCA, ChamSys, TouchDesigner
5. Wire reconnect queue into OBS and VISCA drivers for message buffering during disconnects
6. Address cold-start fade behavior — either query desk state on connect or document the constraint for operators
7. Start using atomic git commits going forward

**Do eventually (quality of life):**

8. Extract the duplicated arg helpers into the shared osc-args.ts (partially done already)
9. Clean up the hub.ts monkey-patch on oscServer.start()
10. Add rate limiting on the OSC listener for public/semi-public booth environments
11. Consider integration tests that spin up the hub with mock drivers end-to-end

---

## Bottom Line

This is a well-built tool made by someone who understands both the engineering and the production workflow. The architecture will scale to more devices, the core math is solid, and the operational features (health checks, systems probe, watchdog) show maturity beyond a v1.

The main gap is test coverage on the edges — particularly OBS — and a handful of known bugs that could cause real problems during a show. None of these are architectural issues; they're all incremental fixes that would take a focused day or two.

If I were greenlighting this for a production environment, I'd gate it on items 1-3 above. Everything else can ship and improve iteratively.
