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
    description: 'Generated deterministic resource handler coverage for AWS, GCP, Azure, and Azure AD.',
  },
  {
    source: 'docs/golden-fixtures.md',
    output: 'docs/golden-fixtures.html',
    title: 'Golden Evaluation Fixtures',
    description: 'Stable public fixtures that validate evaluator and compiled CLI behavior.',
  },
  {
    source: 'docs/live-aws-tests.md',
    output: 'docs/live-aws-tests.html',
    title: 'Live AWS Tests',
    description: 'Opt-in read-only AWS evidence collection and live validation notes.',
  },
  {
    source: 'docs/schema-gaps.md',
    output: 'docs/schema-gaps.html',
    title: 'Classifier Notes',
    description: 'Feature schema gaps, semantic unknown-resource behavior, and the BitNet-compatible path.',
  },
];

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
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
<style>
  :root {
    --bg: #f4f0e8;
    --bg-deep: #ebe5d8;
    --bg-card: rgba(255, 252, 245, 0.72);
    --ink: #171717;
    --ink-soft: #48443e;
    --ink-faint: #8a8177;
    --rule: #d8d0bf;
    --accent: #c75032;
    --accent-soft: #dd8060;
    --term-bg: #11110e;
    --term-ink: #ece8dc;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: "Inter", system-ui, sans-serif;
    background:
      radial-gradient(circle at 15% 0%, rgba(199, 80, 50, 0.13), transparent 34rem),
      linear-gradient(180deg, #f8f4ec 0%, var(--bg) 42%, #eee7d9 100%);
    color: var(--ink);
    line-height: 1.65;
    min-height: 100vh;
  }
  a { color: inherit; }
  code { font-family: "JetBrains Mono", monospace; }
  .container { max-width: 1040px; margin: 0 auto; padding: 0 32px; }
  nav {
    padding: 26px 0 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-family: "JetBrains Mono", monospace;
    font-size: 12px;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    color: var(--ink);
    text-decoration: none;
  }
  .brand-mark { width: 46px; height: 46px; display: block; }
  .brand-name {
    font-family: "Fraunces", Georgia, serif;
    font-size: 21px;
    line-height: 1;
    font-weight: 600;
    letter-spacing: -0.035em;
  }
  .brand-name .os { color: var(--accent); font-weight: 500; }
  nav .links { display: flex; align-items: center; gap: 18px; }
  nav .links a {
    color: var(--ink-soft);
    text-decoration: none;
    border-bottom: 1px solid transparent;
    padding-bottom: 2px;
  }
  nav .links a:hover { color: var(--ink); border-bottom-color: var(--ink); }
  header { padding: 76px 0 46px; border-bottom: 1px solid var(--rule); }
  .eyebrow {
    font-family: "JetBrains Mono", monospace;
    font-size: 12px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--accent);
    margin-bottom: 18px;
  }
  h1, h2, h3 {
    font-family: "Fraunces", Georgia, serif;
    font-weight: 500;
    letter-spacing: -0.025em;
    line-height: 1.1;
  }
  h1 { font-size: clamp(42px, 7vw, 72px); max-width: 12ch; margin-bottom: 20px; }
  .lede { max-width: 68ch; color: var(--ink-soft); font-size: 18px; }
  .doc-shell {
    display: grid;
    grid-template-columns: 220px minmax(0, 1fr);
    gap: 44px;
    padding: 46px 0 78px;
  }
  .toc {
    position: sticky;
    top: 22px;
    align-self: start;
    font-family: "JetBrains Mono", monospace;
    font-size: 12px;
    color: var(--ink-faint);
  }
  .toc-title { color: var(--accent); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 12px; }
  .toc a { display: block; color: var(--ink-soft); text-decoration: none; margin: 8px 0; }
  .toc a:hover { color: var(--ink); }
  article {
    background: var(--bg-card);
    border: 1px solid var(--rule);
    border-radius: 18px;
    padding: 34px;
    box-shadow: 0 28px 80px -52px rgba(30, 22, 10, 0.42);
  }
  article h1 { display: none; }
  article h2 { font-size: 32px; margin: 30px 0 14px; padding-top: 8px; }
  article h2:first-child { margin-top: 0; }
  article h3 { font-size: 22px; margin: 24px 0 10px; }
  article p { color: var(--ink-soft); margin: 13px 0; }
  article ul { margin: 10px 0 18px 24px; color: var(--ink-soft); }
  article li { margin: 6px 0; }
  article code {
    background: rgba(17, 17, 14, 0.07);
    border: 1px solid rgba(17, 17, 14, 0.08);
    border-radius: 5px;
    padding: 1px 5px;
    font-size: 0.92em;
    color: var(--ink);
  }
  pre {
    background: var(--term-bg);
    color: var(--term-ink);
    border-radius: 12px;
    padding: 18px;
    overflow-x: auto;
    margin: 18px 0;
    font-size: 13px;
    line-height: 1.6;
  }
  pre code { background: transparent; border: 0; color: inherit; padding: 0; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 18px 0 24px;
    background: rgba(255, 252, 245, 0.58);
    border: 1px solid var(--rule);
  }
  th, td {
    text-align: left;
    vertical-align: top;
    border-bottom: 1px solid var(--rule);
    padding: 11px 12px;
    font-size: 14px;
  }
  th {
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--accent);
  }
  tr:last-child td { border-bottom: 0; }
  .source-note {
    margin-top: 26px;
    padding-top: 20px;
    border-top: 1px solid var(--rule);
    color: var(--ink-faint);
    font-size: 13px;
  }
  @media (max-width: 820px) {
    .container { padding: 0 22px; }
    nav { align-items: flex-start; gap: 18px; }
    nav .links { flex-wrap: wrap; justify-content: flex-end; gap: 12px; }
    header { padding-top: 56px; }
    .doc-shell { grid-template-columns: 1fr; gap: 22px; }
    .toc { position: static; }
    article { padding: 24px 20px; }
    h1 { font-size: clamp(40px, 14vw, 58px); }
  }
</style>
</head>
<body>
<nav class="container">
  <a href="/" class="brand" aria-label="RecourseOS home">
    ${brandSvg()}
    <span class="brand-name">Recourse<span class="os">OS</span></span>
  </a>
  <div class="links">
    <a href="/">home</a>
    <a href="/resource-coverage.html">coverage</a>
    <a href="/golden-fixtures.html">fixtures</a>
    <a href="https://github.com/recourseos/recourse">github</a>
  </div>
</nav>
<header class="container">
  <div class="eyebrow">public docs</div>
  <h1>${escapeHtml(page.title)}</h1>
  <p class="lede">${escapeHtml(page.description)}</p>
</header>
<main class="container doc-shell">
  ${renderToc(markdown)}
  <article>
    ${markdownToHtml(markdown)}
    <p class="source-note">Generated from <code>${escapeHtml(page.source)}</code>. Markdown remains available for source review.</p>
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
      <path d="M50 5 L88.97 27.5 V72.5 L50 95 L11.03 72.5 V27.5 Z" fill="#14130f"/>
      <path d="M50 9.8 L84.8 29.9 V70.1 L50 90.2 L15.2 70.1 V29.9 Z" stroke="#f4f0e8" stroke-width="5.6" stroke-linejoin="round"/>
      <path d="M34 70 V30 H57.5 C67.2 30 74 36 74 44.6 C74 53.2 67.2 59.2 57.5 59.2 H34" stroke="#f4f0e8" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M55.5 59.5 L74 70.5" stroke="#f4f0e8" stroke-width="7" stroke-linecap="round"/>
      <path d="M70 76.5 C82.3 76.5 90.5 68.3 90.5 56.2" stroke="#c75032" stroke-width="6.5" stroke-linecap="round"/>
      <path d="M90.5 56.2 L90.5 74.4 L73 74.4" stroke="#c75032" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
}

if (process.argv[1]?.endsWith('generate-doc-pages.js')) {
  for (const page of await renderDocPages()) {
    await writeFile(page.output, page.html, 'utf8');
    console.log(`wrote ${page.output}`);
  }
}
