# Kun's agent instructions

These are common instructions for Kun's agents across all scenarios.

## General Guidelines

- Never use the em dash "—". Use plain dash "--" instead.
- When writing commit messages, NEVER auto-add your agent name as co-author.
- Never manually modify CHANGELOG.md files or any files that are marked as auto-generated.
- When writing or substantially editing long Markdown files, put each full sentence on its own line.
  Preserve normal Markdown structure, but avoid wrapping multiple sentences onto one physical line.
- When making technical decisions, do not give much weight to development cost.
  Instead, prefer quality, simplicity, robustness, scalability, and long term maintainability.
- When doing bug fixes, always start with reproducing the bug in an E2E setting as closely aligned with how an end user would use it.
  This makes sure you find the real problem so your fix will actually solve it.
- When end-to-end testing a product, be picky about the UI you see and be obsessed with pixel perfection.
  If something clearly looks off, even if it is not directly related to what you are working on, try to get it fixed along the way.
- Apply that same high standard to engineering excellence: lint, test failures, and test flakiness.
  If you see one, even if it is not caused by what you are working on right now, still get it fixed.
- Use a worktree when dealing with massive projects with slow build/compile times, running concurrent tests across different branches, or using parallel AI coding agents (like Claude Code or Cursor) that require isolated file workspaces.
- Whenever the user asks to work on a new feature or to implement something, create a new worktree before starting.
  Name it after the work itself, for example `api-change-migrations`.
- When the work in a worktree is done (its PR is merged), remove the worktree and delete its branch, both locally and on the remote.
  Before removing, confirm the worktree is clean and its commits are on the default branch, so no unmerged work is lost.
  Never remove a worktree or branch that belongs to another session.
