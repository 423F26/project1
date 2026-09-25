# Agile

This directory is the project record for product and sprint work. Before starting scoped work, agents must read the [Product Backlog](PRODUCT_BACKLOG.md) and the relevant sprint's `GOAL.md` and `BACKLOG.md`, then explicitly acknowledge that review in their first task update.

When a task changes state, scope, maintainer, or sprint, update its matching product-backlog and sprint-backlog rows in the same change. Update the sprint goal when the task changes the sprint objective.

## Burndown chart

Open the [project burndown workbook](BURNDOWN.xlsx). It contains a chart for each of five sprints, with dates on the x-axis and remaining work units on the y-axis. Sprint 1 and Sprint 2 workbook copies are in [sprint1](sprint1/BURNDOWN.xlsx) and [sprint2](sprint2/BURNDOWN.xlsx). Keep the project workbook as the shared source. Create later sprint folders and workbook copies as those sprints begin.

The `Backlog` sheet is seeded from `PRODUCT_BACKLOG.md`. Enter each task's estimated work units in the yellow cells. Add the sprint start and end dates on the `Burndown` sheet. Sprint 2 dates are prefilled from its goal. Sprint 1 dates are blank because its goal does not record them. The `Work Log` sheet accepts a date, backlog task ID, accomplishment, and work units completed. It derives the sprint from the task ID and recalculates actual remaining work. Charts update as estimates and log entries change. Enter log dates oldest to newest. Up to 200 log entries are reserved.

Work-unit estimates and log rows are shared project data, not hours or individual performance records. An agent can add a work-log entry when an accomplishment, date, and work-unit amount are known. Do not guess work units. If the Markdown backlog changes, update the matching rows on the workbook's `Backlog` sheet. The sprint copies are for that sprint's chart view; use the project workbook to keep shared estimates and work-log entries together.
