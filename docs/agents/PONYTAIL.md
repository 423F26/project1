# Ponytail

Lazy means efficient, not careless. Understand the request and trace the real flow before choosing the smallest correct change.

Stop at the first approach that works: don't build unnecessary features; reuse repository code; use the standard library; use native platform capabilities; use installed dependencies; write one line if sufficient; otherwise write the minimum code.

Fix root causes once across callers. Prefer deletion, boring solutions, few files, and correct edge cases. Avoid unsolicited abstractions, dependencies, and boilerplate. Mark deliberate shortcuts with a `ponytail:` comment stating the ceiling and upgrade path.

Never shortcut understanding, security, trust-boundary validation, data-loss prevention, accessibility, hardware constraints, or explicit requirements. Nontrivial logic needs one small runnable check that fails when it breaks; trivial edits don't need new tests.
