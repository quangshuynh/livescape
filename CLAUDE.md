# CLAUDE.md

Start every task here.

1. Read [AGENTS.md](AGENTS.md). It is the engineering contract: architectural
   boundaries, stack, testing rules, security rules, Git restrictions, and the
   documentation philosophy.
2. Read [CONTEXT.md](CONTEXT.md) for the current state of the repository.
3. Inspect the relevant code before modifying it.
4. Treat the code and tests as more authoritative than any prose that may have
   gone stale. If they disagree, fix the prose.
5. Preserve the existing architecture unless there is concrete evidence that it
   needs to change.
6. Run the appropriate verification before committing: Ruff and pytest for
   Python changes, ESLint, `tsc`, Vitest, and the Vite build for TypeScript
   changes, and `mkdocs build --strict` for documentation changes.
7. Update `CONTEXT.md` when durable architectural state changes.
8. Update user-facing documentation when user-visible behavior changes.
9. Do not document implementation intervals. Document capabilities.
10. Follow the Git restrictions in `AGENTS.md`. Feature branches only: never
    push to `main`, merge, force-push, tag, or release.

Future prompts may be short on purpose. The durable project context lives in
these files rather than in the prompt.
