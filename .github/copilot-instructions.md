# Repository-wide instructions for automated development

Read and follow [`AGENTS.md`](../AGENTS.md) on this branch before editing. It is the mandatory policy for all old and new X Reply Helper / Reply Copilot work, including CI budget controls, `ci-lite:` intermediate commits, atomic batch pushes, exact-SHA release CI, non-deploying workflows, and D1/payment safety.

Never assume the default `main` branch is the current application code. Preserve other concurrent chats' feature branches. A `ci-lite:` commit is not release-eligible and never replaces a successful full Push CI on the exact final SHA.

Canonical cross-chat policy: https://app.notion.com/p/415c089052a381f0b031e1e9ab0283d3
