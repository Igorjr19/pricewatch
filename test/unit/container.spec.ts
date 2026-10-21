import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');
const dockerfile = read('Dockerfile');
const slimStage = dockerfile.slice(dockerfile.indexOf('AS slim'));

describe('REQ-CNT-001 multi-stage Dockerfile', () => {
  it('has several stages and a slim target without a browser', () => {
    expect(dockerfile.match(/^FROM /gm)?.length).toBeGreaterThan(2);
    expect(dockerfile).toMatch(/^FROM .* AS slim$/m);
    const instructions = dockerfile
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    expect(instructions).not.toMatch(/playwright|chromium/i);
  });
});

describe('REQ-CNT-002 base image and user', () => {
  it('runs on node:24-slim as non-root uid 10001', () => {
    expect(dockerfile).toMatch(/^FROM node:24-slim AS slim$/m);
    expect(slimStage).toMatch(/useradd .*--uid 10001 .*pricewatch/s);
    expect(slimStage).toMatch(/^USER pricewatch$/m);
  });
});

describe('REQ-CNT-003 entrypoint', () => {
  it('uses ENTRYPOINT pricewatch with CMD serve', () => {
    expect(slimStage).toContain('ENTRYPOINT ["pricewatch"]');
    expect(slimStage).toContain('CMD ["serve"]');
  });
});

describe('REQ-CNT-004 data volume', () => {
  it('declares /data and chowns it to pricewatch before dropping privileges', () => {
    expect(slimStage).toMatch(/^VOLUME \/data$/m);
    expect(slimStage).toMatch(/chown pricewatch:pricewatch \/data/);
    expect(slimStage.indexOf('chown')).toBeLessThan(
      slimStage.indexOf('USER pricewatch'),
    );
  });
});

describe('REQ-CNT-005 healthcheck', () => {
  it('calls GET /health on the configured port', () => {
    expect(slimStage).toMatch(/^HEALTHCHECK /m);
    expect(slimStage).toContain('/api/v1/health');
    expect(slimStage).toContain('PW_PORT');
  });
});

describe('REQ-CNT-006 amd64 build', () => {
  it('pins no platform, so the default linux/amd64 build applies', () => {
    expect(dockerfile).not.toMatch(/--platform/);
    expect(dockerfile).not.toMatch(/arm64/);
  });
});

describe('REQ-CNT-009 docker-compose.yml', () => {
  const compose = read('docker-compose.yml');
  it('runs the slim target with a 20 s grace period, ./data and .env', () => {
    expect(compose).toMatch(/^ {2}pricewatch:$/m);
    expect(compose).toMatch(/target: slim/);
    expect(compose).toMatch(/stop_grace_period: 20s/);
    expect(compose).toMatch(/\.\/data:\/data/);
    expect(compose).toMatch(/env_file: \.env/);
  });
});

describe('REQ-CNT-010 .env.example', () => {
  const example = read('.env.example');
  const documented = new Set(example.match(/PW_[A-Z0-9_]+/g));
  const used = new Set(
    read('src/config/config.ts').match(/PW_[A-Z][A-Z0-9_]*\b/g),
  );

  it('documents every variable the config schema reads', () => {
    const missing = [...used].filter(
      (name) => !documented.has(name) && !name.endsWith('_'),
    );
    expect(missing).toEqual([]);
  });

  it('documents the channel variable pattern', () => {
    expect(example).toContain('PW_CHANNEL_');
  });
});

describe('REQ-CNT-011 image tags', () => {
  it('tags only the slim image in the MVP: version and latest', () => {
    const compose = read('docker-compose.yml');
    expect(compose).toContain('image: pricewatch:latest');
    expect(dockerfile).not.toMatch(/AS full/);
  });
});

describe('REQ-DB-001 database access', () => {
  const pkg = JSON.parse(read('package.json'));
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });

  it('uses Drizzle over @libsql/client and no other database driver', () => {
    expect(deps).toContain('drizzle-orm');
    expect(deps).toContain('@libsql/client');
    for (const other of ['pg', 'mysql2', 'better-sqlite3', 'sqlite3'])
      expect(deps).not.toContain(other);
  });

  it('takes the URL from PW_DATABASE_URL', () => {
    expect(read('src/config/config.ts')).toContain('PW_DATABASE_URL');
  });
});

describe('REQ-ADP-010 adapter investigation record', () => {
  const openItems = read('docs/specs/08-scope-and-open-items.md');
  const adapters = [
    ['kabum', 'A6'],
    ['mercadolivre', 'A1'],
  ] as const;

  it.each(adapters)(
    '%s has a real saved fixture and a section 14 entry (%s)',
    (adapter, item) => {
      const manifest = JSON.parse(
        read(`test/fixtures/${adapter}/manifest.json`),
      );
      expect(manifest.fixtures.length).toBeGreaterThan(0);
      const row = openItems.split('\n').find((l) => l.startsWith(`| ${item} `));
      expect(row).toContain(`test/fixtures/${adapter}/`);
    },
  );
});
