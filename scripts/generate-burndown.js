'use strict';

const { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
class ValidationError extends Error {}

function markdownTable(markdown, filename) {
  const lines = markdown.split(/\r?\n/).filter((line) => /^\s*\|/.test(line));
  if (lines.length < 2) return [];
  const row = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((value) => value.trim());
  const headers = row(lines[0]);
  if (!headers.includes('Task')) throw new ValidationError(`${filename}: table must include a Task column`);
  return lines.slice(2).map(row).map((values) => {
    if (values.length !== headers.length) throw new ValidationError(`${filename}: malformed table row`);
    return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  });
}
function parseDate(value, context) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ValidationError(`${context}: expected YYYY-MM-DD`);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new ValidationError(`${context}: invalid date`);
  return date;
}
function dateText(date) { return date.toISOString().slice(0, 10); }
function offset(start, date) { return Math.round((date - start) / 86_400_000); }
function addDays(date, days) { return new Date(date.valueOf() + days * 86_400_000); }
function xml(value) { return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]); }

function readSprint(directory, productTasks) {
  const goalPath = join(directory.path, 'GOAL.md'); const backlogPath = join(directory.path, 'BACKLOG.md');
  if (!existsSync(goalPath) || !existsSync(backlogPath)) throw new ValidationError(`${directory.name}: GOAL.md and BACKLOG.md are required`);
  const goal = readFileSync(goalPath, 'utf8');
  const startMatch = goal.match(/^\s*-\s*Start:\s*(\S+)\s*$/mi); const endMatch = goal.match(/^\s*-\s*End:\s*(\S+)\s*$/mi);
  if (!startMatch || !endMatch) throw new ValidationError(`${goalPath}: include '- Start: YYYY-MM-DD' and '- End: YYYY-MM-DD'`);
  const start = parseDate(startMatch[1], `${goalPath} start`); const end = parseDate(endMatch[1], `${goalPath} end`);
  if (end < start) throw new ValidationError(`${goalPath}: end precedes start`);
  const seen = new Set();
  const tasks = markdownTable(readFileSync(backlogPath, 'utf8'), backlogPath).map((row) => {
    if (!/^#\d+$/.test(row.Task)) throw new ValidationError(`${backlogPath}: invalid task ID '${row.Task}'`);
    if (!productTasks.has(row.Task)) throw new ValidationError(`${backlogPath}: unknown task ${row.Task}`);
    if (seen.has(row.Task)) throw new ValidationError(`${backlogPath}: duplicate task ${row.Task}`);
    seen.add(row.Task);
    const added = row.Added ? parseDate(row.Added, `${backlogPath} ${row.Task} added`) : start;
    const completed = row.Completed ? parseDate(row.Completed, `${backlogPath} ${row.Task} completion`) : null;
    if (added < start || added > end) throw new ValidationError(`${backlogPath}: ${row.Task} added date falls outside the sprint`);
    if (completed && (completed < start || completed > end)) throw new ValidationError(`${backlogPath}: ${row.Task} completion falls outside the sprint`);
    if (completed && completed < added) throw new ValidationError(`${backlogPath}: ${row.Task} completion precedes its added date`);
    return { ...row, added, completed };
  });
  return { name: directory.name, label: directory.name.replace(/^sprint/i, 'Sprint '), start, end, tasks };
}

function loadAgile(agileDir) {
  const productPath = join(agileDir, 'PRODUCT_BACKLOG.md'); const productTasks = new Map();
  for (const row of markdownTable(readFileSync(productPath, 'utf8'), productPath)) {
    if (!/^#\d+$/.test(row.Task) || !/^S\d+$/i.test(row.Sprint)) throw new ValidationError(`${productPath}: invalid task or sprint`);
    if (productTasks.has(row.Task)) throw new ValidationError(`${productPath}: duplicate task ${row.Task}`); productTasks.set(row.Task, row);
  }
  const sprints = readdirSync(agileDir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && /^sprint\d+$/i.test(entry.name)).map((entry) => readSprint({ name: entry.name, path: join(agileDir, entry.name) }, productTasks)).sort((a, b) => Number(a.name.match(/\d+/)[0]) - Number(b.name.match(/\d+/)[0]));
  const byName = new Map(sprints.map((sprint) => [sprint.name.toLowerCase(), sprint]));
  for (const row of productTasks.values()) {
    const sprint = byName.get(`sprint${row.Sprint.match(/\d+/)[0]}`);
    if (!sprint || !sprint.tasks.some((task) => task.Task === row.Task)) throw new ValidationError(`${row.Task}: missing product-assigned sprint entry`);
  }
  for (const sprint of sprints) for (const task of sprint.tasks) if (productTasks.get(task.Task).Sprint.toLowerCase() !== `s${sprint.name.match(/\d+/)[0]}` && !task.completed) throw new ValidationError(`${sprint.name}: carried ${task.Task} must have a completion date`);
  return sprints;
}

function timeline(sprint) {
  const events = new Map(); const add = (date, type, task) => { const key = dateText(date); const event = events.get(key) ?? { added: [], completed: [] }; event[type].push(task); events.set(key, event); };
  for (const task of sprint.tasks) { if (task.added > sprint.start) add(task.added, 'added', task); if (task.completed) add(task.completed, 'completed', task); }
  let remaining = sprint.tasks.filter((task) => task.added <= sprint.start).length; const points = [{ date: sprint.start, remaining }]; const changes = [];
  for (const [day, event] of [...events.entries()].sort(([a], [b]) => a.localeCompare(b))) { const date = parseDate(day, 'event'); points.push({ date, remaining }); if (event.added.length) { remaining += event.added.length; changes.push({ date, type: 'added', tasks: event.added }); points.push({ date, remaining }); } if (event.completed.length) { remaining -= event.completed.length; changes.push({ date, type: 'completed', tasks: event.completed }); points.push({ date, remaining }); } }
  points.push({ date: sprint.end, remaining }); return { events, points, changes };
}
function flatPeriods(sprint, events) { const dates = [...events.keys()].map((value) => parseDate(value, 'event')).sort((a, b) => a - b); const periods = []; let cursor = sprint.start; for (const date of dates) { if (offset(cursor, date) > 1) periods.push([cursor, addDays(date, -1)]); cursor = date; } if (offset(cursor, sprint.end) >= 1) periods.push([cursor, sprint.end]); return periods; }

function renderSprint(sprint, index) {
  const top = 25 + index * 405; const left = 180; const right = 870; const chartTop = top + 70; const bottom = top + 210; const span = offset(sprint.start, sprint.end) || 1;
  const { events, points, changes } = timeline(sprint); const maximum = Math.max(sprint.tasks.length, ...points.map((point) => point.remaining), 1); const initial = sprint.tasks.filter((task) => task.added <= sprint.start).length;
  const coordinate = ({ date, remaining }) => [left + (offset(sprint.start, date) / span) * (right - left), bottom - (remaining / maximum) * 120]; const actual = points.map((point) => coordinate(point).map((value) => value.toFixed(1)).join(',')).join(' ');
  const markers = changes.map((change) => { const x = coordinate({ date: change.date, remaining: 0 })[0]; return `<circle cx="${x.toFixed(1)}" cy="${bottom + 12}" r="4" class="${change.type}"/><text x="${x.toFixed(1)}" y="${bottom + 29}" text-anchor="middle">${change.type === 'added' ? '+' : '−'}${xml(change.tasks.map((task) => task.Task).join(','))}</text>`; }).join('');
  const added = changes.filter((change) => change.type === 'added'); const completed = changes.filter((change) => change.type === 'completed'); const flat = flatPeriods(sprint, events);
  const scopeNote = added.length ? `Scope increases: ${added.map((change) => `+${change.tasks.map((task) => task.Task).join(',')} on ${dateText(change.date)}`).join('; ')}.` : 'Scope: no additions after the sprint started.';
  const progressNote = completed.length ? `Progress: ${completed.map((change) => `${change.tasks.map((task) => task.Task).join(',')} completed ${dateText(change.date)}`).join('; ')}.` : 'Progress: no completed tasks recorded.';
  const flatNote = flat.length ? `Flat periods: ${flat.map(([start, end]) => `${dateText(start)}–${dateText(end)} (no recorded scope or completion change)`).join('; ')}.` : 'Flat periods: none recorded.';
  return `<g><text x="30" y="${top + 25}" class="title">${xml(sprint.label)} burndown</text><text x="30" y="${top + 47}">Time period: ${dateText(sprint.start)} to ${dateText(sprint.end)} (inclusive)</text><line x1="${left}" y1="${chartTop}" x2="${left}" y2="${bottom}" class="axis"/><line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" class="axis"/><text x="${left - 14}" y="${chartTop + 4}" text-anchor="end">${maximum}</text><text x="${left - 14}" y="${bottom + 4}" text-anchor="end">0</text><text x="55" y="${chartTop + 75}" text-anchor="middle" transform="rotate(-90 55 ${chartTop + 75})" class="axis-label">Remaining tasks</text><text x="${left}" y="${bottom + 53}">${dateText(sprint.start)}</text><text x="${right}" y="${bottom + 53}" text-anchor="end">${dateText(sprint.end)}</text><text x="${(left + right) / 2}" y="${bottom + 78}" text-anchor="middle" class="axis-label">Date</text><line x1="${left}" y1="${bottom - (initial / maximum) * 120}" x2="${right}" y2="${bottom}" class="ideal"/><polyline points="${actual}" class="actual"/>${markers}<text x="${right - 170}" y="${top + 25}" class="legend">— actual · ┄ ideal</text><text x="30" y="${top + 300}" class="notes-title">Advisor notes</text><text x="30" y="${top + 323}" class="note">Remaining work = tasks added on/before a date minus tasks completed on/before it. Initial scope: ${initial} tasks.</text><text x="30" y="${top + 346}" class="note">${xml(scopeNote)}</text><text x="30" y="${top + 369}" class="note">${xml(progressNote)}</text><text x="30" y="${top + 392}" class="note">${xml(flatNote)}</text></g>`;
}
function renderSvg(sprints) { const visible = sprints.filter((sprint) => sprint.tasks.some((task) => task.completed)); const height = Math.max(140, 25 + visible.length * 430); const body = visible.length ? visible.map(renderSprint).join('') : '<text x="30" y="60">No sprint has recorded completed work.</text>'; return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="920" height="${height}" viewBox="0 0 920 ${height}" role="img" aria-labelledby="title description"><title id="title">Agile sprint burndown chart</title><desc id="description">Remaining task count for sprints with recorded completed work.</desc><style>text{font:12px system-ui,sans-serif;fill:#24313d}.title{font-size:18px;font-weight:700}.axis-label,.notes-title{font-weight:700}.notes-title{font-size:14px}.note{font-size:11px}.legend{fill:#536471}.axis{stroke:#94a3b8}.ideal{stroke:#94a3b8;stroke-width:2;stroke-dasharray:5 4}.actual{fill:none;stroke:#136f63;stroke-width:3}.added{fill:#a16207}.completed{fill:#136f63}</style><rect width="100%" height="100%" fill="#fff"/>${body}</svg>\n`; }
function generate(root = process.cwd()) { const agileDir = join(resolve(root), 'docs', 'agile'); const output = join(agileDir, 'BURNDOWN.svg'); mkdirSync(agileDir, { recursive: true }); writeFileSync(output, renderSvg(loadAgile(agileDir))); return output; }
if (require.main === module) { try { console.log(`Generated ${generate()}`); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { ValidationError, generate, loadAgile, renderSvg, timeline };
