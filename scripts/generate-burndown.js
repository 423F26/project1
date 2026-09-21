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
  return lines.slice(2).filter((line) => !/^\s*\|\s*$/.test(line)).map((line) => {
    const values = row(line);
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
function dayOffset(start, date) { return Math.round((date - start) / 86_400_000); }
function xml(value) { return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]); }

function readSprint(sprintDir, productTasks) {
  const name = sprintDir.name;
  const label = name.replace(/^sprint/i, 'Sprint ');
  const path = sprintDir.path;
  const goalPath = join(path, 'GOAL.md');
  const backlogPath = join(path, 'BACKLOG.md');
  if (!existsSync(goalPath) || !existsSync(backlogPath)) throw new ValidationError(`${name}: GOAL.md and BACKLOG.md are required`);
  const goal = readFileSync(goalPath, 'utf8');
  const startMatch = goal.match(/^\s*-\s*Start:\s*(\S+)\s*$/mi);
  const endMatch = goal.match(/^\s*-\s*End:\s*(\S+)\s*$/mi);
  if (!startMatch || !endMatch) throw new ValidationError(`${goalPath}: include '- Start: YYYY-MM-DD' and '- End: YYYY-MM-DD'`);
  const start = parseDate(startMatch[1], `${goalPath} start`);
  const end = parseDate(endMatch[1], `${goalPath} end`);
  if (end < start) throw new ValidationError(`${goalPath}: end precedes start`);

  const rows = markdownTable(readFileSync(backlogPath, 'utf8'), backlogPath);
  const seen = new Set();
  const tasks = rows.map((row) => {
    const task = row.Task;
    if (!/^#\d+$/.test(task)) throw new ValidationError(`${backlogPath}: invalid task ID '${task}'`);
    if (!productTasks.has(task)) throw new ValidationError(`${backlogPath}: unknown task ${task}`);
    if (seen.has(task)) throw new ValidationError(`${backlogPath}: duplicate task ${task}`);
    seen.add(task);
    const completed = row.Completed ? parseDate(row.Completed, `${backlogPath} ${task} completion`) : null;
    if (completed && (completed < start || completed > end)) throw new ValidationError(`${backlogPath}: ${task} completion falls outside the sprint`);
    return { ...row, completed };
  });
  return { name, label, start, end, tasks };
}

function loadAgile(agileDir) {
  const productPath = join(agileDir, 'PRODUCT_BACKLOG.md');
  const productRows = markdownTable(readFileSync(productPath, 'utf8'), productPath);
  const productTasks = new Map();
  for (const row of productRows) {
    if (!/^#\d+$/.test(row.Task)) throw new ValidationError(`${productPath}: invalid task ID '${row.Task}'`);
    if (!/^S\d+$/i.test(row.Sprint)) throw new ValidationError(`${productPath}: ${row.Task} has an invalid sprint '${row.Sprint}'`);
    if (productTasks.has(row.Task)) throw new ValidationError(`${productPath}: duplicate task ${row.Task}`);
    productTasks.set(row.Task, row);
  }
  const sprintDirs = readdirSync(agileDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^sprint\d+$/i.test(entry.name))
    .map((entry) => ({ name: entry.name, path: join(agileDir, entry.name) }))
    .sort((left, right) => Number(left.name.match(/\d+/)[0]) - Number(right.name.match(/\d+/)[0]));
  const sprints = sprintDirs.map((directory) => readSprint(directory, productTasks));
  const byName = new Map(sprints.map((sprint) => [sprint.name.toLowerCase(), sprint]));
  for (const row of productTasks.values()) {
    const sprint = byName.get(`sprint${row.Sprint.match(/\d+/)[0]}`);
    if (!sprint) throw new ValidationError(`${productPath}: ${row.Task} references missing ${row.Sprint}`);
    if (!sprint.tasks.some((task) => task.Task === row.Task)) throw new ValidationError(`${sprint.name}/BACKLOG.md: missing product-assigned ${row.Task}`);
  }
  for (const sprint of sprints) {
    for (const task of sprint.tasks) {
      const assigned = productTasks.get(task.Task).Sprint.toLowerCase();
      const expected = `s${sprint.name.match(/\d+/)[0]}`;
      if (assigned !== expected && !task.completed) throw new ValidationError(`${sprint.name}/BACKLOG.md: carried task ${task.Task} must have a completion date`);
    }
  }
  return sprints;
}

function pointsFor(sprint, x, y) {
  const span = dayOffset(sprint.start, sprint.end) || 1;
  const coordinate = (date, remaining) => [x + (dayOffset(sprint.start, date) / span) * 720, y + 150 - (remaining / Math.max(sprint.tasks.length, 1)) * 110];
  let remaining = sprint.tasks.length;
  const points = [coordinate(sprint.start, remaining)];
  const completions = new Map();
  for (const task of sprint.tasks.filter((task) => task.completed)) {
    const date = dateText(task.completed);
    completions.set(date, [...(completions.get(date) ?? []), task]);
  }
  for (const [date, tasks] of [...completions.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const completion = parseDate(date, 'completion');
    points.push(coordinate(completion, remaining));
    remaining -= tasks.length;
    points.push(coordinate(completion, remaining));
  }
  points.push(coordinate(sprint.end, remaining));
  return { points, completions };
}

function renderSprint(sprint, index) {
  const top = 20 + index * 230;
  const x = 150;
  const { points, completions } = pointsFor(sprint, x, top);
  const total = sprint.tasks.length;
  const pointText = points.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
  const markers = [...completions.entries()].flatMap(([date, tasks]) => {
    const day = dayOffset(sprint.start, parseDate(date, 'completion'));
    const span = dayOffset(sprint.start, sprint.end) || 1;
    const markerX = x + (day / span) * 720;
    return `<circle cx="${markerX.toFixed(1)}" cy="${top + 165}" r="4" fill="#136f63"/><text x="${markerX.toFixed(1)}" y="${top + 183}" text-anchor="middle">${xml(tasks.map((task) => task.Task).join(', '))}</text>`;
  }).join('');
  const noCompletions = completions.size === 0 ? `<text x="${x + 360}" y="${top + 105}" text-anchor="middle" class="notice">No completed tasks recorded</text>` : '';
  return `<g><text x="30" y="${top + 28}" class="title">${xml(sprint.label)}</text><text x="30" y="${top + 47}">${dateText(sprint.start)} to ${dateText(sprint.end)} · ${total} task${total === 1 ? '' : 's'}</text><line x1="${x}" y1="${top + 40}" x2="${x}" y2="${top + 150}" class="axis"/><line x1="${x}" y1="${top + 150}" x2="${x + 720}" y2="${top + 150}" class="axis"/><text x="${x - 12}" y="${top + 44}" text-anchor="end">${total}</text><text x="${x - 12}" y="${top + 154}" text-anchor="end">0</text><text x="${x}" y="${top + 204}" text-anchor="start">${dateText(sprint.start)}</text><text x="${x + 720}" y="${top + 204}" text-anchor="end">${dateText(sprint.end)}</text><line x1="${x}" y1="${top + 40}" x2="${x + 720}" y2="${top + 150}" class="ideal"/><polyline points="${pointText}" class="actual"/>${markers}${noCompletions}<text x="${x + 550}" y="${top + 28}" class="legend">— actual · ┄ ideal</text></g>`;
}

function renderSvg(sprints) {
  const height = Math.max(100, 20 + sprints.length * 230);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="920" height="${height}" viewBox="0 0 920 ${height}" role="img" aria-labelledby="title description"><title id="title">Agile sprint burndown chart</title><desc id="description">Remaining tasks per sprint, generated from Agile backlog records.</desc><style>text{font:12px system-ui,sans-serif;fill:#24313d}.title{font-size:16px;font-weight:700}.legend{fill:#536471}.axis{stroke:#94a3b8;stroke-width:1}.ideal{stroke:#94a3b8;stroke-width:2;stroke-dasharray:5 4}.actual{fill:none;stroke:#136f63;stroke-width:3}.notice{fill:#8a4b08;font-weight:600}</style><rect width="100%" height="100%" fill="#fff"/>${sprints.map(renderSprint).join('')}</svg>\n`;
}

function generate(root = process.cwd()) {
  const agileDir = join(resolve(root), 'docs', 'agile');
  const svg = renderSvg(loadAgile(agileDir));
  const output = join(agileDir, 'BURNDOWN.svg');
  mkdirSync(agileDir, { recursive: true });
  writeFileSync(output, svg);
  return output;
}

if (require.main === module) {
  try { console.log(`Generated ${generate()}`); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { ValidationError, generate, loadAgile, renderSvg };
