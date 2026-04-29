import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { renderDocPages } from '../src/tools/generate-doc-pages.js';

describe('themed documentation pages', () => {
  it('matches the generated Markdown-backed HTML pages', async () => {
    const pages = await renderDocPages();

    for (const page of pages) {
      const actual = readFileSync(page.output, 'utf8');
      expect(actual).toBe(page.html);
    }
  });

  it('links the landing page to themed docs instead of raw Markdown', () => {
    const index = readFileSync('docs/index.html', 'utf8');

    expect(index).toContain('href="/resource-coverage.html"');
    expect(index).toContain('href="/golden-fixtures.html"');
    expect(index).toContain('href="/live-aws-tests.html"');
    expect(index).toContain('href="/schema-gaps.html"');
    expect(index).not.toContain('href="/resource-coverage.md"');
    expect(index).not.toContain('href="/golden-fixtures.md"');
    expect(index).not.toContain('href="/live-aws-tests.md"');
    expect(index).not.toContain('href="/schema-gaps.md"');
  });
});
