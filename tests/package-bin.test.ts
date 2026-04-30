import { existsSync, readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  version: string;
};

describe('published package bin', () => {
  it('exposes the current CLI version through the package bin', () => {
    expect(existsSync('dist/index.js'), 'dist/index.js must exist; run npm run build before package bin tests').toBe(true);

    const result = spawnSync(process.execPath, ['bin/recourse', '--version'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe(packageJson.version);
  });

  it('includes product commands in the package bin help output', () => {
    expect(existsSync('dist/index.js'), 'dist/index.js must exist; run npm run build before package bin tests').toBe(true);

    const result = spawnSync(process.execPath, ['bin/recourse', '--help'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('preflight');
    expect(result.stdout).toContain('tui');
    expect(result.stdout).toContain('mcp');
    expect(result.stdout).toContain('evaluate');
  });
});
