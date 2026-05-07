#!/usr/bin/env npx tsx
/**
 * Differential Test Runner
 *
 * Runs both TypeScript and Go implementations against the same Terraform plans
 * and compares their outputs field-by-field.
 */

import { execSync } from 'child_process';
import { readdirSync, readFileSync, existsSync, writeFileSync } from 'fs';
import { join, relative, dirname } from 'path';
import { fileURLToPath } from 'url';

// ESM compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Paths
const CORPUS_DIR = join(__dirname, 'corpus');
const TS_CLI = './bin/recourse';  // Run from TS_ROOT
const GO_CLI = 'go run ./cmd/recourse';
const RECOURSE_ROOT = join(__dirname, '../..');  // recourse-go directory
const TS_ROOT = join(__dirname, '../../..');     // recourseOS directory

interface ResourceResult {
  address: string;
  type: string;
  actions: string[];
  tier: number;
  label: string;
  reasoning: string;
}

interface NormalizedOutput {
  resources: ResourceResult[];
  error?: string;
}

interface Divergence {
  planFile: string;
  resource: string;
  field: string;
  tsValue: unknown;
  goValue: unknown;
  category: 'spec-ambiguity' | 'ts-bug' | 'go-bug' | 'intended-difference' | 'classifier-difference' | 'unknown';
}

// Tier number mapping for normalization
const TIER_MAP: Record<string, number> = {
  'reversible': 1,
  'recoverable-with-effort': 2,
  'recoverable_with_effort': 2,
  'recoverableWithEffort': 2,
  'recoverable-from-backup': 3,
  'recoverable_from_backup': 3,
  'recoverableFromBackup': 3,
  'unrecoverable': 4,
  'needs-review': 5,
  'needs_review': 5,
  'needsReview': 5,
};

function normalizeTierLabel(label: string): string {
  return label.toLowerCase().replace(/_/g, '-');
}

function normalizeTier(tier: number | string): number {
  if (typeof tier === 'number') return tier;
  return TIER_MAP[tier.toLowerCase()] || 0;
}

function runTypeScript(planFile: string): NormalizedOutput {
  try {
    const result = execSync(
      `${TS_CLI} plan "${planFile}" --format json`,
      {
        cwd: TS_ROOT,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    const parsed = JSON.parse(result);
    const resources: ResourceResult[] = (parsed.changes || []).map((c: any) => ({
      address: c.address,
      type: c.type,
      actions: c.actions.sort(),
      tier: normalizeTier(c.recoverability?.tier),
      label: normalizeTierLabel(c.recoverability?.label || ''),
      reasoning: c.recoverability?.reasoning || '',
    }));

    return { resources: resources.sort((a, b) => a.address.localeCompare(b.address)) };
  } catch (error: any) {
    // Check if there's stdout even with non-zero exit
    if (error.stdout) {
      try {
        const parsed = JSON.parse(error.stdout);
        const resources: ResourceResult[] = (parsed.changes || []).map((c: any) => ({
          address: c.address,
          type: c.type,
          actions: c.actions.sort(),
          tier: normalizeTier(c.recoverability?.tier),
          label: normalizeTierLabel(c.recoverability?.label || ''),
          reasoning: c.recoverability?.reasoning || '',
        }));
        return { resources: resources.sort((a, b) => a.address.localeCompare(b.address)) };
      } catch {
        // Fall through to error
      }
    }
    return { resources: [], error: error.message };
  }
}

function runGo(planFile: string): NormalizedOutput {
  try {
    const result = execSync(
      `${GO_CLI} plan "${planFile}" --format json`,
      {
        cwd: RECOURSE_ROOT,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    const parsed = JSON.parse(result);
    const resources: ResourceResult[] = (parsed.resources || []).map((r: any) => ({
      address: r.address,
      type: r.type,
      actions: r.actions.sort(),
      tier: normalizeTier(r.recoverability?.tier),
      label: normalizeTierLabel(r.recoverability?.label || ''),
      reasoning: r.recoverability?.reasoning || '',
    }));

    return { resources: resources.sort((a, b) => a.address.localeCompare(b.address)) };
  } catch (error: any) {
    // Check if there's stdout even with non-zero exit (block/escalate verdicts)
    if (error.stdout) {
      try {
        const parsed = JSON.parse(error.stdout);
        const resources: ResourceResult[] = (parsed.resources || []).map((r: any) => ({
          address: r.address,
          type: r.type,
          actions: r.actions.sort(),
          tier: normalizeTier(r.recoverability?.tier),
          label: normalizeTierLabel(r.recoverability?.label || ''),
          reasoning: r.recoverability?.reasoning || '',
        }));
        return { resources: resources.sort((a, b) => a.address.localeCompare(b.address)) };
      } catch {
        // Fall through to error
      }
    }
    return { resources: [], error: error.message };
  }
}

function compareOutputs(planFile: string, ts: NormalizedOutput, go: NormalizedOutput): Divergence[] {
  const divergences: Divergence[] = [];

  // Handle error cases
  if (ts.error && go.error) {
    // Both errored - check if same type of error
    return [];
  }
  if (ts.error || go.error) {
    divergences.push({
      planFile,
      resource: '*',
      field: 'execution',
      tsValue: ts.error || 'success',
      goValue: go.error || 'success',
      category: 'unknown',
    });
    return divergences;
  }

  // Compare resource counts
  if (ts.resources.length !== go.resources.length) {
    divergences.push({
      planFile,
      resource: '*',
      field: 'resource_count',
      tsValue: ts.resources.length,
      goValue: go.resources.length,
      category: 'unknown',
    });
  }

  // Build lookup maps
  const tsMap = new Map(ts.resources.map(r => [r.address, r]));
  const goMap = new Map(go.resources.map(r => [r.address, r]));

  // Check all resources from both sides
  const allAddresses = new Set([...tsMap.keys(), ...goMap.keys()]);

  for (const address of allAddresses) {
    const tsRes = tsMap.get(address);
    const goRes = goMap.get(address);

    if (!tsRes) {
      divergences.push({
        planFile,
        resource: address,
        field: 'presence',
        tsValue: 'absent',
        goValue: 'present',
        category: 'unknown',
      });
      continue;
    }

    if (!goRes) {
      divergences.push({
        planFile,
        resource: address,
        field: 'presence',
        tsValue: 'present',
        goValue: 'absent',
        category: 'unknown',
      });
      continue;
    }

    // Compare tier (the critical field)
    if (tsRes.tier !== goRes.tier) {
      divergences.push({
        planFile,
        resource: address,
        field: 'tier',
        tsValue: `${tsRes.tier} (${tsRes.label})`,
        goValue: `${goRes.tier} (${goRes.label})`,
        category: categorizeTierDivergence(tsRes, goRes),
      });
    }

    // Compare label normalization
    if (tsRes.label !== goRes.label && tsRes.tier === goRes.tier) {
      divergences.push({
        planFile,
        resource: address,
        field: 'label',
        tsValue: tsRes.label,
        goValue: goRes.label,
        category: 'spec-ambiguity',
      });
    }

    // Compare actions
    if (JSON.stringify(tsRes.actions) !== JSON.stringify(goRes.actions)) {
      divergences.push({
        planFile,
        resource: address,
        field: 'actions',
        tsValue: tsRes.actions,
        goValue: goRes.actions,
        category: 'unknown',
      });
    }
  }

  return divergences;
}

function categorizeTierDivergence(ts: ResourceResult, go: ResourceResult): Divergence['category'] {
  // If Go returns needs-review (5) and TS returns something else,
  // this is likely a classifier difference
  if (go.tier === 5 && ts.tier !== 5) {
    return 'classifier-difference';
  }

  // Otherwise, it's likely a spec ambiguity or bug
  return 'unknown';
}

function findAllPlanFiles(dir: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findAllPlanFiles(path));
    } else if (entry.name.endsWith('.json')) {
      files.push(path);
    }
  }

  return files;
}

function printReport(divergences: Divergence[]) {
  if (divergences.length === 0) {
    console.log('\n✅ No divergences found!\n');
    return;
  }

  console.log(`\n❌ Found ${divergences.length} divergence(s)\n`);

  // Group by category
  const byCategory = new Map<string, Divergence[]>();
  for (const d of divergences) {
    const list = byCategory.get(d.category) || [];
    list.push(d);
    byCategory.set(d.category, list);
  }

  // Print by category
  for (const [category, divs] of byCategory) {
    console.log(`\n## ${category.toUpperCase()} (${divs.length})\n`);

    for (const d of divs) {
      const relPath = relative(CORPUS_DIR, d.planFile);
      console.log(`  ${relPath}`);
      console.log(`    Resource: ${d.resource}`);
      console.log(`    Field:    ${d.field}`);
      console.log(`    TS:       ${JSON.stringify(d.tsValue)}`);
      console.log(`    Go:       ${JSON.stringify(d.goValue)}`);
      console.log('');
    }
  }
}

// Main
async function main() {
  console.log('RecourseOS Differential Test Harness');
  console.log('=====================================\n');

  // Check that both implementations are available
  try {
    execSync('go version', { stdio: 'pipe' });
  } catch {
    console.error('Error: Go not found. Please install Go.');
    process.exit(1);
  }

  // Find all plan files
  const planFiles = findAllPlanFiles(CORPUS_DIR);
  console.log(`Found ${planFiles.length} plan file(s) in corpus\n`);

  const allDivergences: Divergence[] = [];

  for (const planFile of planFiles) {
    const relPath = relative(CORPUS_DIR, planFile);
    process.stdout.write(`Testing ${relPath}... `);

    const tsOutput = runTypeScript(planFile);
    const goOutput = runGo(planFile);
    const divergences = compareOutputs(planFile, tsOutput, goOutput);

    if (divergences.length === 0) {
      console.log('✅');
    } else {
      console.log(`❌ (${divergences.length} divergence(s))`);
      allDivergences.push(...divergences);
    }
  }

  printReport(allDivergences);

  // Write detailed report
  const reportPath = join(__dirname, 'divergence-report.json');
  writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    totalPlans: planFiles.length,
    totalDivergences: allDivergences.length,
    divergences: allDivergences,
  }, null, 2));
  console.log(`\nDetailed report written to: ${reportPath}`);

  // Exit with non-zero if divergences found
  process.exit(allDivergences.length > 0 ? 1 : 0);
}

main().catch(console.error);
