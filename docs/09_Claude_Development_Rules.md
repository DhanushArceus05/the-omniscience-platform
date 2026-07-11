# Claude Development Rules

Version: 1.0
Status: Approved

1. Implement only the current approved phase.
2. Never redesign approved architecture without approval.
3. Continue from the supplied repository after Phase 0; never regenerate from scratch.
4. Strict TypeScript; no unjustified `any`.
5. No placeholders, hardcoded secrets or silent failures.
6. Validate every boundary and AI output.
7. Request capabilities, not provider names.
8. Use OmniProvider, OmniModel Manager and OmniCore.
9. Premium responsive UI with all states.
10. Tests for success, failure, edge and security-sensitive cases.
11. Update docs, migrations, env examples and commands.
12. Return changed-files summary, setup commands, tests run, limitations and commit message.
13. Never claim tests passed unless executed.
14. Production over demo; future compatibility over shortcuts.
