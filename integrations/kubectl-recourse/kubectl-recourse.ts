#!/usr/bin/env npx ts-node
/**
 * kubectl-recourse - Kubernetes plugin for RecourseOS consequence evaluation
 *
 * Usage:
 *   kubectl recourse diff -f manifest.yaml
 *   kubectl recourse check <resource> <name>
 *   kubectl recourse delete <resource> <name> --dry-run
 *
 * Install:
 *   npm install -g kubectl-recourse
 *   # or
 *   ln -s $(pwd)/kubectl-recourse /usr/local/bin/kubectl-recourse
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Types
type RiskLevel = 'allow' | 'warn' | 'escalate' | 'block';

interface K8sResource {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  spec?: Record<string, any>;
}

interface EvaluationResult {
  resource: string;
  namespace: string;
  kind: string;
  action: string;
  riskLevel: RiskLevel;
  tier: string;
  reasoning: string;
}

// High-risk Kubernetes resource types
const HIGH_RISK_KINDS = new Set([
  'PersistentVolumeClaim',
  'PersistentVolume',
  'StatefulSet',
  'Deployment',
  'DaemonSet',
  'Secret',
  'ConfigMap',
  'Namespace',
  'ServiceAccount',
  'ClusterRole',
  'ClusterRoleBinding',
  'CustomResourceDefinition',
]);

// Data-bearing workloads
const DATA_WORKLOADS = new Set([
  'StatefulSet',
  'PersistentVolumeClaim',
  'PersistentVolume',
]);

// Colors for terminal output
const colors = {
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
};

/**
 * Print colored output
 */
function print(text: string, color?: keyof typeof colors): void {
  if (color && process.stdout.isTTY) {
    console.log(`${colors[color]}${text}${colors.reset}`);
  } else {
    console.log(text);
  }
}

/**
 * Print risk level with appropriate color
 */
function printRisk(level: RiskLevel): string {
  switch (level) {
    case 'block':
      return `${colors.red}${colors.bold}BLOCK${colors.reset}`;
    case 'escalate':
      return `${colors.yellow}${colors.bold}ESCALATE${colors.reset}`;
    case 'warn':
      return `${colors.yellow}WARN${colors.reset}`;
    case 'allow':
      return `${colors.green}ALLOW${colors.reset}`;
  }
}

/**
 * Get current resource from cluster
 */
function getClusterResource(kind: string, name: string, namespace?: string): K8sResource | null {
  const ns = namespace ? `-n ${namespace}` : '';
  try {
    const output = execSync(`kubectl get ${kind} ${name} ${ns} -o json`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return JSON.parse(output);
  } catch {
    return null;
  }
}

/**
 * Check if resource has associated PVC
 */
function hasAssociatedPVC(resource: K8sResource): boolean {
  if (resource.kind === 'StatefulSet') {
    const volumeClaimTemplates = resource.spec?.volumeClaimTemplates;
    return Array.isArray(volumeClaimTemplates) && volumeClaimTemplates.length > 0;
  }
  return false;
}

/**
 * Check if resource has finalizers (indicates data)
 */
function hasFinalizers(resource: K8sResource): boolean {
  const finalizers = resource.metadata.annotations?.['finalizers'];
  return !!finalizers;
}

/**
 * Evaluate deletion risk
 */
function evaluateDeletion(kind: string, name: string, namespace?: string): EvaluationResult {
  const existing = getClusterResource(kind, name, namespace);
  const ns = namespace || 'default';

  const result: EvaluationResult = {
    resource: name,
    namespace: ns,
    kind,
    action: 'delete',
    riskLevel: 'allow',
    tier: 'reversible',
    reasoning: 'Resource can be recreated',
  };

  if (!existing) {
    result.reasoning = 'Resource does not exist';
    return result;
  }

  // PVC/PV deletion
  if (DATA_WORKLOADS.has(kind)) {
    result.riskLevel = 'block';
    result.tier = 'unrecoverable';
    result.reasoning = `${kind} contains persistent data that will be lost`;
    return result;
  }

  // StatefulSet with PVC
  if (kind === 'StatefulSet' && hasAssociatedPVC(existing)) {
    result.riskLevel = 'escalate';
    result.tier = 'needs-review';
    result.reasoning = 'StatefulSet has associated PVCs that may be orphaned';
    return result;
  }

  // Namespace deletion (cascades to all resources)
  if (kind === 'Namespace') {
    result.riskLevel = 'block';
    result.tier = 'unrecoverable';
    result.reasoning = 'Namespace deletion cascades to all contained resources';
    return result;
  }

  // CRD deletion
  if (kind === 'CustomResourceDefinition') {
    result.riskLevel = 'escalate';
    result.tier = 'needs-review';
    result.reasoning = 'CRD deletion will remove all custom resources of this type';
    return result;
  }

  // Secret/ConfigMap with references
  if (kind === 'Secret' || kind === 'ConfigMap') {
    result.riskLevel = 'warn';
    result.tier = 'recoverable-with-effort';
    result.reasoning = `${kind} may be referenced by running workloads`;
    return result;
  }

  // RBAC resources
  if (kind === 'ClusterRole' || kind === 'ClusterRoleBinding' || kind === 'ServiceAccount') {
    result.riskLevel = 'warn';
    result.tier = 'recoverable-with-effort';
    result.reasoning = `${kind} deletion may affect running workloads`;
    return result;
  }

  // Deployments/DaemonSets
  if (kind === 'Deployment' || kind === 'DaemonSet') {
    result.riskLevel = 'warn';
    result.tier = 'recoverable-with-effort';
    result.reasoning = 'Workload can be recreated but may cause downtime';
    return result;
  }

  return result;
}

/**
 * Evaluate manifest changes
 */
function evaluateManifest(manifest: K8sResource, action: 'apply' | 'delete'): EvaluationResult {
  const { kind, metadata } = manifest;
  const name = metadata.name;
  const namespace = metadata.namespace;

  if (action === 'delete') {
    return evaluateDeletion(kind, name, namespace);
  }

  // For apply, check if it's a create or update
  const existing = getClusterResource(kind, name, namespace);

  const result: EvaluationResult = {
    resource: name,
    namespace: namespace || 'default',
    kind,
    action: existing ? 'update' : 'create',
    riskLevel: 'allow',
    tier: 'reversible',
    reasoning: existing ? 'Update can be reverted' : 'New resource',
  };

  // StatefulSet updates
  if (kind === 'StatefulSet' && existing) {
    const oldReplicas = existing.spec?.replicas || 0;
    const newReplicas = manifest.spec?.replicas || 0;

    if (newReplicas < oldReplicas) {
      result.riskLevel = 'escalate';
      result.tier = 'needs-review';
      result.reasoning = `Scaling down StatefulSet from ${oldReplicas} to ${newReplicas} may cause data loss`;
    }

    // Check for volumeClaimTemplate changes
    const oldVCT = JSON.stringify(existing.spec?.volumeClaimTemplates || []);
    const newVCT = JSON.stringify(manifest.spec?.volumeClaimTemplates || []);
    if (oldVCT !== newVCT) {
      result.riskLevel = 'block';
      result.tier = 'unrecoverable';
      result.reasoning = 'VolumeClaimTemplate changes require StatefulSet recreation';
    }
  }

  // PVC changes
  if (kind === 'PersistentVolumeClaim' && existing) {
    // Storage reduction
    const oldStorage = existing.spec?.resources?.requests?.storage;
    const newStorage = manifest.spec?.resources?.requests?.storage;
    if (oldStorage && newStorage && newStorage < oldStorage) {
      result.riskLevel = 'block';
      result.tier = 'unrecoverable';
      result.reasoning = 'PVC storage cannot be reduced';
    }
  }

  return result;
}

/**
 * Parse YAML manifests
 */
function parseManifests(content: string): K8sResource[] {
  // Simple YAML parser for multi-doc files
  const docs = content.split(/^---$/m).filter(d => d.trim());
  const resources: K8sResource[] = [];

  for (const doc of docs) {
    try {
      // Use kubectl to parse YAML
      const json = execSync('kubectl create --dry-run=client -f - -o json', {
        encoding: 'utf-8',
        input: doc,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      resources.push(JSON.parse(json));
    } catch {
      // Try simple parsing
      const lines = doc.split('\n');
      const resource: any = {};
      let currentKey = '';

      for (const line of lines) {
        const keyMatch = line.match(/^(\w+):\s*(.*)$/);
        if (keyMatch) {
          currentKey = keyMatch[1];
          resource[currentKey] = keyMatch[2] || {};
        }
      }

      if (resource.kind && resource.apiVersion) {
        resources.push(resource as K8sResource);
      }
    }
  }

  return resources;
}

/**
 * Print evaluation results
 */
function printResults(results: EvaluationResult[]): void {
  console.log('\n' + colors.bold + 'RecourseOS Kubernetes Evaluation' + colors.reset);
  console.log('═'.repeat(50));

  let hasBlock = false;
  let hasEscalate = false;

  for (const result of results) {
    const fqn = `${result.kind}/${result.resource}`;
    const ns = result.namespace !== 'default' ? ` (${result.namespace})` : '';

    console.log(`\n${colors.bold}${fqn}${ns}${colors.reset}`);
    console.log(`  Action: ${result.action}`);
    console.log(`  Risk:   ${printRisk(result.riskLevel)}`);
    console.log(`  Tier:   ${result.tier}`);
    console.log(`  Reason: ${result.reasoning}`);

    if (result.riskLevel === 'block') hasBlock = true;
    if (result.riskLevel === 'escalate') hasEscalate = true;
  }

  console.log('\n' + '═'.repeat(50));

  if (hasBlock) {
    print('✖ BLOCKED: One or more changes would cause unrecoverable data loss', 'red');
    console.log('  Review the flagged resources before proceeding.');
    process.exit(1);
  } else if (hasEscalate) {
    print('⚠ ESCALATE: One or more changes need human review', 'yellow');
    console.log('  Use --force to proceed anyway.');
  } else {
    print('✓ All changes are safe to apply', 'green');
  }
}

/**
 * Main CLI handler
 */
function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(`
kubectl-recourse - Evaluate Kubernetes changes for consequences

Usage:
  kubectl recourse diff -f <manifest>     Evaluate manifest changes
  kubectl recourse delete <kind> <name>   Evaluate deletion
  kubectl recourse check -f <manifest>    Check manifest for risky configs
  kubectl recourse help                   Show this help

Options:
  -n, --namespace <ns>    Specify namespace
  -f, --filename <file>   Manifest file (- for stdin)
  --force                 Proceed despite warnings
  --json                  Output as JSON

Examples:
  kubectl recourse diff -f deployment.yaml
  kubectl recourse delete pvc my-data -n production
  kubectl recourse check -f statefulset.yaml
`);
    return;
  }

  // Parse flags
  let namespace: string | undefined;
  let filename: string | undefined;
  let outputJson = false;
  let force = false;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '-n' || args[i] === '--namespace') {
      namespace = args[++i];
    } else if (args[i] === '-f' || args[i] === '--filename') {
      filename = args[++i];
    } else if (args[i] === '--json') {
      outputJson = true;
    } else if (args[i] === '--force') {
      force = true;
    }
  }

  const results: EvaluationResult[] = [];

  switch (command) {
    case 'diff':
    case 'apply':
    case 'check': {
      if (!filename) {
        console.error('Error: -f/--filename is required');
        process.exit(1);
      }

      let content: string;
      if (filename === '-') {
        content = fs.readFileSync(0, 'utf-8'); // stdin
      } else {
        content = fs.readFileSync(path.resolve(filename), 'utf-8');
      }

      const manifests = parseManifests(content);
      for (const manifest of manifests) {
        if (namespace) {
          manifest.metadata.namespace = namespace;
        }
        results.push(evaluateManifest(manifest, 'apply'));
      }
      break;
    }

    case 'delete': {
      const kind = args[1];
      const name = args[2];

      if (!kind || !name) {
        console.error('Error: kubectl recourse delete <kind> <name>');
        process.exit(1);
      }

      results.push(evaluateDeletion(kind, name, namespace));
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }

  if (outputJson) {
    console.log(JSON.stringify({ results }, null, 2));
  } else {
    printResults(results);
  }
}

main();
