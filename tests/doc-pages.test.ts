import { existsSync, readFileSync } from 'fs';
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
    expect(index).toContain('href="/agent-interface.html"');
    expect(index).toContain('href="/mcp-setup.html"');
    expect(index).not.toContain('href="/resource-coverage.md"');
    expect(index).not.toContain('href="/golden-fixtures.md"');
    expect(index).not.toContain('href="/live-aws-tests.md"');
    expect(index).not.toContain('href="/schema-gaps.md"');
    expect(index).not.toContain('href="/agent-interface.md"');
    expect(index).not.toContain('href="/mcp-setup.md"');
  });

  it('keeps local site links and table-of-content anchors resolvable', async () => {
    const pages = ['docs/index.html', ...(await renderDocPages()).map(page => page.output)];

    for (const page of pages) {
      const html = readFileSync(page, 'utf8');
      const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(match => match[1]);

      for (const href of hrefs) {
        if (href.startsWith('https://')) continue;
        if (href.startsWith('#')) {
          expect(html, `${page} missing anchor ${href}`).toContain(`id="${href.slice(1)}"`);
          continue;
        }

        if (href.startsWith('/')) {
          const target = href === '/' ? 'docs/index.html' : `docs/${href.slice(1)}`;
          expect(existsSync(target), `${page} links to missing ${href}`).toBe(true);
        }
      }
    }
  });
});
