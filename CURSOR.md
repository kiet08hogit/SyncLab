# Using this repo with Cursor

This project includes a **Cursor project rule** so the Karpathy-inspired behavioral guidelines apply automatically when you work here.

Source: [multica-ai/andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills).

## In this repository

1. Open the folder in Cursor.
2. The rule [`.cursor/rules/karpathy-guidelines.mdc`](.cursor/rules/karpathy-guidelines.mdc) is committed with `alwaysApply: true`, so you do not need extra installation steps.
3. In Cursor, you can confirm it under **Settings → Rules** (or the project rules UI), where `karpathy-guidelines` should appear.

## Claude Code vs Cursor

- **Claude Code:** Per-project use can rely on [`CLAUDE.md`](CLAUDE.md).
- **Cursor:** Uses the committed `.cursor/rules/` file. Cursor does not read `CLAUDE.md` by default.

## For contributors

When you change the four principles, keep **[`CLAUDE.md`](CLAUDE.md)** and **[`.cursor/rules/karpathy-guidelines.mdc`](.cursor/rules/karpathy-guidelines.mdc)** in sync.
