#!/usr/bin/env node
// Prints requirement text and acceptance blocks from docs/specs/*.md. Usage: pnpm req <ID|prefix>
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const query = process.argv[2];
if (!query) {
  console.error('usage: pnpm req <REQ-ID|prefix>');
  process.exit(1);
}

/** IDs named by an acceptance header: `REQ-ALR-010 to 013` covers 010, 011, 012, 013. */
function headerIds(header) {
  const ids = [];
  const range = header.match(/(REQ-[A-Z]+)-(\d+) to (\d+)/);
  if (range) {
    const [, prefix, from, to] = range;
    for (let n = Number(from); n <= Number(to); n++) {
      ids.push(`${prefix}-${String(n).padStart(from.length, '0')}`);
    }
  }
  return ids.concat(header.match(/REQ-[A-Z]+-\d+/g) ?? []);
}

const matches = (id) => id === query || id.startsWith(`${query}-`);

const dir = 'docs/specs';
let found = false;
for (const file of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
  const lines = readFileSync(join(dir, file), 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const requirement = line.match(/^- \*\*(REQ-[A-Z]+-\d+)/);
    if (requirement && matches(requirement[1])) {
      console.log(`${file}: ${line}`);
      found = true;
      continue;
    }
    if (line.startsWith('> **Acceptance') && headerIds(line).some(matches)) {
      console.log();
      for (; i < lines.length && lines[i].startsWith('>'); i++)
        console.log(lines[i]);
      console.log();
      found = true;
    }
  }
}
if (!found) {
  console.error(`no requirement matches ${query}`);
  process.exit(1);
}
