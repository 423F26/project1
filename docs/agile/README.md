# Agile

This directory is the project record for product and sprint work. Before starting scoped work, agents must read the [Product Backlog](PRODUCT_BACKLOG.md) and the relevant sprint's `GOAL.md` and `BACKLOG.md`, then explicitly acknowledge that review in their first task update.

When a task changes state, scope, maintainer, or sprint, update its matching product-backlog and sprint-backlog rows in the same change. Update the sprint goal when the task changes the sprint objective. 

## Burndown chart

![Generated task-count burndown chart](BURNDOWN.svg)

Run `npm run agile:burndown` before submitting every sprint, and commit the regenerated `BURNDOWN.svg` with those changes. The generator reads the Product Backlog for each task's current sprint, every sprint `GOAL.md` for `Start` and `End` dates, and every sprint `BACKLOG.md` for task state and its optional `Completed` date.

`Completed` must be a date (`YYYY-MM-DD`) within that sprint. A task counts as remaining until its completed date, regardless of its status text; leave the date blank for incomplete work. The product backlog is authoritative for current assignment, so every product item must appear in its assigned sprint backlog. An earlier, completed sprint entry for a carried task is allowed; the carried entry has its own state and completion date.

The generator rejects malformed dates, unknown or duplicate task IDs, completion dates outside a sprint, and missing product-assigned sprint entries. It uses task count rather than timesheet hours; timesheets are not chart inputs.
