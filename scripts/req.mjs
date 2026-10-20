#!/usr/bin/env node
// Prints requirement text from docs/specs/*.md. Usage: pnpm req <ID|prefix>
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const query = process.argv[2];
if (!query) {
  console.error('usage: pnpm req <REQ-ID|prefix>');
  process.exit(1);
}

const dir = 'docs/specs';
let found = false;
for (const file of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
  for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
    if (line.includes(`**${query}`) || line.includes(`${query}-`)) {
      console.log(`${file}: ${line}`);
      found = true;
    }
  }
}
if (!found) {
  console.error(`no requirement matches ${query}`);
  process.exit(1);
}
