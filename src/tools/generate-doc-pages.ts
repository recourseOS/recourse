import { readFile, writeFile } from 'fs/promises';

interface DocPage {
  source: string;
  output: string;
  title: string;
  description: string;
}

const docPages: DocPage[] = [
  {
    source: 'docs/resource-coverage.md',
    output: 'docs/resource-coverage.html',
    title: 'Resource Coverage',
    description: 'Which resources get deterministic rules vs semantic fallback. Agents can check source to know which verdict type they received.',
  },
  {
    source: 'docs/golden-fixtures.md',
    output: 'docs/golden-fixtures.html',
    title: 'Golden Evaluation Fixtures',
    description: 'Stable fixtures that validate the consequence contract. Use these to verify agent integration.',
  },
  {
    source: 'docs/live-aws-tests.md',
    output: 'docs/live-aws-tests.html',
    title: 'Live AWS Tests',
    description: 'Collect read-only AWS evidence to give agents accurate recovery data. No mutations, just reads.',
  },
  {
    source: 'docs/schema-gaps.md',
    output: 'docs/schema-gaps.html',
    title: 'Classifier Notes',
    description: 'How unknown resources get classified. Agents should check source to distinguish rules from semantic fallback.',
  },
  {
    source: 'docs/agent-interface.md',
    output: 'docs/agent-interface.html',
    title: 'Agent Interface',
    description: 'The consequence report schema agents consume. Structured fields, example prompts, and reasoning patterns.',
  },
  {
    source: 'docs/mcp-setup.md',
    output: 'docs/mcp-setup.html',
    title: 'MCP Setup',
    description: 'Add RecourseOS to your agent tool list. One config block, then your agent can call recourse.evaluate before any destructive action.',
  },
];

function getEyebrow(output: string): string {
  const eyebrows: Record<string, string> = {
    'docs/resource-coverage.html': 'coverage reference',
    'docs/golden-fixtures.html': 'test fixtures',
    'docs/live-aws-tests.html': 'evidence collection',
    'docs/schema-gaps.html': 'classifier behavior',
    'docs/agent-interface.html': 'schema reference',
    'docs/mcp-setup.html': 'agent integration',
  };
  return eyebrows[output] || 'documentation';
}

export async function renderDocPages(pages = docPages): Promise<Array<{ output: string; html: string }>> {
  const rendered = [];
  for (const page of pages) {
    const markdown = await readFile(page.source, 'utf8');
    rendered.push({
      output: page.output,
      html: renderDocPage(page, markdown),
    });
  }
  return rendered;
}

export function renderDocPage(page: DocPage, markdown: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>RecourseOS - ${escapeHtml(page.title)}</title>
<meta name="description" content="${escapeHtml(page.description)}" />
<link rel="icon" href="favicon.svg" type="image/svg+xml" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="site.css" />
</head>
<body>
<div class="top-band">
<nav class="container site-nav">
  <a href="/" class="brand" aria-label="RecourseOS home">
    ${brandSvg()}
    <span>
      <span class="brand-name">Recourse<span class="os">OS</span></span>
      <span class="brand-kicker">Consequence layer</span>
    </span>
  </a>
  <div class="links">
    <a href="/">home</a>
    <a href="/resource-coverage.html">coverage</a>
    <a href="/golden-fixtures.html">fixtures</a>
    <a href="/agent-interface.html">agents</a>
    <a href="/mcp-setup.html">mcp</a>
    <a href="/console.html">console</a>
    <a href="https://github.com/recourseOS/recourse">github</a>
  </div>
</nav>
<header class="container doc-header">
  <div class="eyebrow">${getEyebrow(page.output)}</div>
  <h1>${escapeHtml(page.title)}</h1>
  <p class="lede">${escapeHtml(page.description)}</p>
</header>
</div>
<main class="container doc-shell">
  ${renderToc(markdown)}
  <article>
    ${markdownToHtml(markdown)}
  </article>
</main>
</body>
</html>
`;
}

function renderToc(markdown: string): string {
  const links = markdown
    .split('\n')
    .filter(line => line.startsWith('## '))
    .map(line => {
      const title = line.replace(/^## /, '').trim();
      return `<a href="#${slugify(title)}">${inlineMarkdown(title)}</a>`;
    });

  if (!links.length) return '<aside class="toc"><div class="toc-title">On this page</div></aside>';
  return `<aside class="toc"><div class="toc-title">On this page</div>${links.join('')}</aside>`;
}

function markdownToHtml(markdown: string): string {
  const lines = markdown.split('\n');
  const html: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index++;
      continue;
    }

    if (line.startsWith('```')) {
      const codeLines: string[] = [];
      index++;
      while (index < lines.length && !lines[index].startsWith('```')) {
        codeLines.push(lines[index]);
        index++;
      }
      index++;
      html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      continue;
    }

    if (line.startsWith('|') && lines[index + 1]?.startsWith('|')) {
      const tableLines: string[] = [];
      while (index < lines.length && lines[index].startsWith('|')) {
        tableLines.push(lines[index]);
        index++;
      }
      html.push(renderTable(tableLines));
      continue;
    }

    if (line.startsWith('# ')) {
      const text = line.replace(/^# /, '').trim();
      html.push(`<h1 id="${slugify(text)}">${inlineMarkdown(text)}</h1>`);
      index++;
      continue;
    }

    if (line.startsWith('## ')) {
      const text = line.replace(/^## /, '').trim();
      html.push(`<h2 id="${slugify(text)}">${inlineMarkdown(text)}</h2>`);
      index++;
      continue;
    }

    if (line.startsWith('### ')) {
      const text = line.replace(/^### /, '').trim();
      html.push(`<h3 id="${slugify(text)}">${inlineMarkdown(text)}</h3>`);
      index++;
      continue;
    }

    if (line.startsWith('- ')) {
      const items: string[] = [];
      while (index < lines.length && lines[index].startsWith('- ')) {
        items.push(`<li>${inlineMarkdown(lines[index].replace(/^- /, '').trim())}</li>`);
        index++;
      }
      html.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    const paragraph: string[] = [line.trim()];
    index++;
    while (
      index < lines.length
      && lines[index].trim()
      && !lines[index].startsWith('#')
      && !lines[index].startsWith('- ')
      && !lines[index].startsWith('|')
      && !lines[index].startsWith('```')
    ) {
      paragraph.push(lines[index].trim());
      index++;
    }
    html.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`);
  }

  return html.join('\n');
}

function renderTable(lines: string[]): string {
  const rows = lines
    .filter((line, index) => index !== 1 || !/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line))
    .map(line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim()));
  const [head = [], ...body] = rows;
  return `<table><thead><tr>${head.map(cell => `<th>${inlineMarkdown(cell)}</th>`).join('')}</tr></thead><tbody>${body.map(row => `<tr>${row.map(cell => `<td>${inlineMarkdown(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function inlineMarkdown(value: string): string {
  let escaped = escapeHtml(value);
  escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
  escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return escaped;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/`/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function brandSvg(): string {
  return `<svg class="brand-mark" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M50 5 L88.97 27.5 V72.5 L50 95 L11.03 72.5 V27.5 Z" fill="#06110e"/>
      <path d="M50 9.8 L84.8 29.9 V70.1 L50 90.2 L15.2 70.1 V29.9 Z" stroke="#effbf3" stroke-width="5.6" stroke-linejoin="round"/>
      <path d="M34 70 V30 H57.5 C67.2 30 74 36 74 44.6 C74 53.2 67.2 59.2 57.5 59.2 H34" stroke="#effbf3" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M55.5 59.5 L74 70.5" stroke="#effbf3" stroke-width="7" stroke-linecap="round"/>
      <path d="M70 76.5 C82.3 76.5 90.5 68.3 90.5 56.2" stroke="#63e6b8" stroke-width="6.5" stroke-linecap="round"/>
      <path d="M90.5 56.2 L90.5 74.4 L73 74.4" stroke="#63e6b8" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
}

if (process.argv[1]?.endsWith('generate-doc-pages.js')) {
  for (const page of await renderDocPages()) {
    await writeFile(page.output, page.html, 'utf8');
    console.log(`wrote ${page.output}`);
  }
}
