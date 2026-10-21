#!/usr/bin/env node
// Lists MUST requirements with no test citing the ID. --strict exits 1 if any.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Process and tooling requirements (DX, TST) are verified by the toolchain, not by unit tests.
const IGNORED_AREAS = /^REQ-(DX|TST)-/;

const strict = process.argv.includes('--strict');

function walk(dir, pred, out = []) {
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, pred, out);
    else if (pred(p)) out.push(p);
  }
  return out;
}

const specLines = walk('docs/specs', (p) => p.endsWith('.md')).flatMap((f) =>
  readFileSync(f, 'utf8').split('\n'),
);
const musts = new Set();
for (const line of specLines) {
  const m = line.match(/\*\*(REQ-[A-Z]+-\d+) \(MUST\)\*\*/);
  if (m && !/reserved/i.test(line)) musts.add(m[1]);
}

const tests = [
  ...walk('test', (p) => p.endsWith('.ts')),
  ...walk('src', (p) => p.endsWith('.spec.ts')),
]
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

const missing = [...musts]
  .filter((id) => !IGNORED_AREAS.test(id) && !tests.includes(id))
  .sort();
if (missing.length)
  console.log(`${missing.length} MUST without tests:\n${missing.join('\n')}`);
else console.log('all MUST requirements covered');
if (strict && missing.length) process.exit(1);
