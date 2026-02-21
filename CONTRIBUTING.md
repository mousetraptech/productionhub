# Contributing to Production Hub

Thanks for your interest in contributing. Production Hub is a live production tool used in real venues every week — reliability is not optional. Please read this before opening issues or PRs.

## Reporting Issues

**Bug reports:** Include what you expected, what happened, and steps to reproduce. Device type and firmware version help a lot (e.g., "Avantis V1.10", "QuickQ 20 V2.1").

**Feature requests:** Describe the problem you're trying to solve, not just the solution you want. Context about your production setup helps us understand the use case.

## Submitting Pull Requests

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `npx tsc --noEmit` (backend) and `cd ui && npx tsc --noEmit` (frontend) — both must pass
4. Run `npm test` — all 233+ tests must pass. Don't break existing tests.
5. Add tests for new functionality
6. Open a PR against `main`

Keep PRs focused. One feature or fix per PR. If you're making a big change, open an issue first so we can discuss the approach.

## Code Style

- TypeScript in strict mode
- Tests use Node's built-in test runner (`node --test`)
- Follow existing patterns — look at how similar things are done before inventing new ones
- Protocol code (MIDI, OSC, VISCA, WebSocket) should be defensive about malformed input

## What We're Looking For

- Bug fixes with regression tests
- New device drivers (follow the `DeviceDriver` interface)
- Improvements to the cue engine or fade engine
- Better error handling and reconnection logic
- Documentation improvements

## What Probably Won't Get Merged

- Large refactors without prior discussion
- Changes that add external dependencies where they're not needed
- Features that compromise reliability for convenience
- Code without tests

## Code of Conduct

This project follows the [Contributor Covenant v2.1](CODE_OF_CONDUCT.md). Be decent.

## License

By contributing, you agree that your contributions will be licensed under the [GNU General Public License v3.0](LICENSE).
