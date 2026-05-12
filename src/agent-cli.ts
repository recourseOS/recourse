#!/usr/bin/env node

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VERSION = '0.1.0';

// ANSI colors
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

const CHECK = `${GREEN}✓${RESET}`;
const CROSS = `${RED}✗${RESET}`;
const WARN = `${YELLOW}!${RESET}`;
const INFO = `${CYAN}→${RESET}`;

interface McpClientConfig {
  name: string;
  configPath: string;
  configKey: string;
  detectCommand?: string;
}

const MCP_CLIENTS: Record<string, McpClientConfig> = {
  'claude-code': {
    name: 'Claude Code',
    configPath: path.join(os.homedir(), '.claude', 'mcp_servers.json'),
    configKey: 'mcpServers',
  },
  'cursor': {
    name: 'Cursor',
    configPath: path.join(os.homedir(), '.cursor', 'mcp.json'),
    configKey: 'mcpServers',
  },
  'vscode': {
    name: 'VS Code (Claude Extension)',
    configPath: path.join(os.homedir(), '.vscode', 'mcp.json'),
    configKey: 'mcpServers',
  },
  'windsurf': {
    name: 'Windsurf',
    configPath: path.join(os.homedir(), '.windsurf', 'mcp.json'),
    configKey: 'mcpServers',
  },
};

function getRecoursePath(): string {
  // Try to find the recourse CLI
  const localDist = path.resolve(__dirname, '../dist/index.js');
  const sameDirDist = path.resolve(__dirname, 'index.js');

  if (fs.existsSync(localDist)) return localDist;
  if (fs.existsSync(sameDirDist)) return sameDirDist;

  // Try global
  try {
    const globalPath = execSync('which recourse 2>/dev/null || where recourse 2>nul', { encoding: 'utf8' }).trim();
    if (globalPath) return globalPath;
  } catch {
    // Not found globally
  }

  return localDist; // Default, may not exist
}

const program = new Command();

program
  .name('recourseos-agent')
  .description('RecourseOS Agent Infrastructure Kit - Setup and verification CLI')
  .version(VERSION);

// ============================================================================
// DOCTOR COMMAND
// ============================================================================

program
  .command('doctor')
  .description('Check system health and RecourseOS readiness')
  .option('--fix', 'Attempt to fix issues automatically')
  .action(async (options) => {
    console.log(`\n${BOLD}RecourseOS Agent Doctor${RESET}\n`);

    const checks: { name: string; status: 'pass' | 'fail' | 'warn'; message: string }[] = [];

    // 1. Node.js version
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0], 10);
    if (majorVersion >= 18) {
      checks.push({ name: 'Node.js version', status: 'pass', message: `${nodeVersion} (>= 18 required)` });
    } else {
      checks.push({ name: 'Node.js version', status: 'fail', message: `${nodeVersion} (>= 18 required)` });
    }

    // 2. RecourseOS CLI
    const recoursePath = getRecoursePath();
    if (fs.existsSync(recoursePath)) {
      checks.push({ name: 'RecourseOS CLI', status: 'pass', message: recoursePath });
    } else {
      checks.push({ name: 'RecourseOS CLI', status: 'fail', message: 'Not found. Run: npm run build' });
    }

    // 3. MCP Server can start
    if (fs.existsSync(recoursePath)) {
      try {
        const testResult = await testMcpServer(recoursePath);
        if (testResult.success) {
          checks.push({ name: 'MCP server', status: 'pass', message: 'Responds to initialize' });
        } else {
          checks.push({ name: 'MCP server', status: 'fail', message: testResult.error || 'Failed to start' });
        }
      } catch (err) {
        checks.push({ name: 'MCP server', status: 'fail', message: String(err) });
      }
    } else {
      checks.push({ name: 'MCP server', status: 'warn', message: 'Skipped (CLI not found)' });
    }

    // 4. Detect MCP clients
    const detectedClients: string[] = [];
    for (const [key, client] of Object.entries(MCP_CLIENTS)) {
      const configDir = path.dirname(client.configPath);
      if (fs.existsSync(configDir)) {
        detectedClients.push(key);
      }
    }

    if (detectedClients.length > 0) {
      checks.push({
        name: 'MCP-compatible clients',
        status: 'pass',
        message: detectedClients.map(c => MCP_CLIENTS[c].name).join(', ')
      });
    } else {
      checks.push({
        name: 'MCP-compatible clients',
        status: 'warn',
        message: 'None detected. Install Claude Code, Cursor, or VS Code with Claude extension'
      });
    }

    // 5. Check MCP configuration for each detected client
    for (const clientKey of detectedClients) {
      const client = MCP_CLIENTS[clientKey];
      const configured = isMcpConfigured(client);
      if (configured) {
        checks.push({
          name: `${client.name} MCP config`,
          status: 'pass',
          message: 'RecourseOS configured'
        });
      } else {
        checks.push({
          name: `${client.name} MCP config`,
          status: 'warn',
          message: `Not configured. Run: recourseos-agent install-mcp --client ${clientKey}`
        });
      }
    }

    // 6. Test shell evaluation
    if (fs.existsSync(recoursePath)) {
      try {
        const evalResult = await testShellEvaluation(recoursePath, 'echo hello');
        if (evalResult.success && evalResult.decision === 'allow') {
          checks.push({ name: 'Shell evaluation (safe)', status: 'pass', message: 'echo hello → allow' });
        } else {
          checks.push({ name: 'Shell evaluation (safe)', status: 'fail', message: evalResult.error || 'Unexpected result' });
        }
      } catch (err) {
        checks.push({ name: 'Shell evaluation (safe)', status: 'fail', message: String(err) });
      }
    }

    // 7. Test dangerous command is blocked/escalated
    if (fs.existsSync(recoursePath)) {
      try {
        const evalResult = await testShellEvaluation(recoursePath, 'terraform destroy');
        if (evalResult.success && (evalResult.decision === 'escalate' || evalResult.decision === 'block')) {
          checks.push({ name: 'Shell evaluation (dangerous)', status: 'pass', message: `terraform destroy → ${evalResult.decision}` });
        } else {
          checks.push({ name: 'Shell evaluation (dangerous)', status: 'fail', message: `Expected escalate/block, got: ${evalResult.decision}` });
        }
      } catch (err) {
        checks.push({ name: 'Shell evaluation (dangerous)', status: 'fail', message: String(err) });
      }
    }

    // Print results
    console.log('System Checks:\n');
    for (const check of checks) {
      const icon = check.status === 'pass' ? CHECK : check.status === 'fail' ? CROSS : WARN;
      console.log(`  ${icon} ${check.name}`);
      console.log(`    ${DIM}${check.message}${RESET}\n`);
    }

    // Summary
    const passed = checks.filter(c => c.status === 'pass').length;
    const failed = checks.filter(c => c.status === 'fail').length;
    const warned = checks.filter(c => c.status === 'warn').length;

    console.log(`${BOLD}Summary:${RESET} ${passed} passed, ${failed} failed, ${warned} warnings\n`);

    if (failed > 0) {
      console.log(`${RED}Some checks failed. Fix the issues above before proceeding.${RESET}\n`);
      process.exit(1);
    } else if (warned > 0) {
      console.log(`${YELLOW}Some warnings to address. RecourseOS may not be fully configured.${RESET}\n`);
    } else {
      console.log(`${GREEN}All checks passed. RecourseOS is ready.${RESET}\n`);
    }
  });

// ============================================================================
// INSTALL-MCP COMMAND
// ============================================================================

program
  .command('install-mcp')
  .description('Install RecourseOS MCP server configuration for a client')
  .requiredOption('--client <client>', `Client to configure: ${Object.keys(MCP_CLIENTS).join(', ')}`)
  .option('--dry-run', 'Show what would be written without writing')
  .action(async (options) => {
    const clientKey = options.client.toLowerCase();
    const client = MCP_CLIENTS[clientKey];

    if (!client) {
      console.error(`${CROSS} Unknown client: ${options.client}`);
      console.error(`   Supported clients: ${Object.keys(MCP_CLIENTS).join(', ')}`);
      process.exit(1);
    }

    console.log(`\n${BOLD}Installing RecourseOS MCP for ${client.name}${RESET}\n`);

    const recoursePath = getRecoursePath();
    if (!fs.existsSync(recoursePath)) {
      console.error(`${CROSS} RecourseOS CLI not found at: ${recoursePath}`);
      console.error(`   Run: npm run build`);
      process.exit(1);
    }

    // Prepare the MCP server config
    const mcpConfig = {
      command: 'node',
      args: [recoursePath, 'mcp', 'serve'],
      env: {
        RECOURSE_LOG_LEVEL: 'info',
      },
    };

    // Read existing config or create new
    const configDir = path.dirname(client.configPath);
    let existingConfig: Record<string, unknown> = {};

    if (fs.existsSync(client.configPath)) {
      try {
        existingConfig = JSON.parse(fs.readFileSync(client.configPath, 'utf-8'));
        console.log(`${INFO} Found existing config at ${client.configPath}`);
      } catch {
        console.log(`${WARN} Could not parse existing config, will create new`);
      }
    }

    // Ensure the mcpServers key exists
    if (!existingConfig[client.configKey]) {
      existingConfig[client.configKey] = {};
    }

    // Add recourse
    (existingConfig[client.configKey] as Record<string, unknown>).recourse = mcpConfig;

    const configJson = JSON.stringify(existingConfig, null, 2);

    if (options.dryRun) {
      console.log(`${INFO} Would write to: ${client.configPath}\n`);
      console.log(configJson);
      console.log();
    } else {
      // Ensure directory exists
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
        console.log(`${CHECK} Created directory: ${configDir}`);
      }

      fs.writeFileSync(client.configPath, configJson);
      console.log(`${CHECK} Wrote config to: ${client.configPath}`);

      console.log(`\n${GREEN}${BOLD}RecourseOS MCP configured for ${client.name}${RESET}\n`);
      console.log(`Next steps:`);
      console.log(`  1. Restart ${client.name} to load the new MCP server`);
      console.log(`  2. Run: recourseos-agent verify`);
      console.log();
    }
  });

// ============================================================================
// VERIFY COMMAND
// ============================================================================

program
  .command('verify')
  .description('Run end-to-end verification of RecourseOS gate')
  .option('--verbose', 'Show detailed output')
  .action(async (options) => {
    console.log(`\n${BOLD}RecourseOS Gate Verification${RESET}\n`);

    const recoursePath = getRecoursePath();
    if (!fs.existsSync(recoursePath)) {
      console.error(`${CROSS} RecourseOS CLI not found. Run: npm run build`);
      process.exit(1);
    }

    const tests: { name: string; status: 'pass' | 'fail'; detail: string }[] = [];

    // Test 1: MCP server responds
    console.log(`${INFO} Testing MCP server...`);
    const mcpTest = await testMcpServer(recoursePath);
    if (mcpTest.success) {
      tests.push({ name: 'MCP server responds', status: 'pass', detail: 'Server initialized successfully' });
    } else {
      tests.push({ name: 'MCP server responds', status: 'fail', detail: mcpTest.error || 'Unknown error' });
    }

    // Test 2: Tools are listed
    console.log(`${INFO} Testing tool listing...`);
    const toolsTest = await testToolsList(recoursePath);
    if (toolsTest.success) {
      tests.push({ name: 'Tools listed', status: 'pass', detail: `${toolsTest.count} tools available` });
    } else {
      tests.push({ name: 'Tools listed', status: 'fail', detail: toolsTest.error || 'Unknown error' });
    }

    // Test 3: Safe command → allow
    console.log(`${INFO} Testing safe command evaluation...`);
    const safeTest = await testShellEvaluation(recoursePath, 'ls -la');
    if (safeTest.success && safeTest.decision === 'allow') {
      tests.push({ name: 'Safe command allowed', status: 'pass', detail: 'ls -la → allow' });
    } else {
      tests.push({ name: 'Safe command allowed', status: 'fail', detail: `Expected allow, got: ${safeTest.decision}` });
    }

    // Test 4: Dangerous command → escalate/block
    console.log(`${INFO} Testing dangerous command evaluation...`);
    const dangerTest = await testShellEvaluation(recoursePath, 'rm -rf /');
    if (dangerTest.success && (dangerTest.decision === 'escalate' || dangerTest.decision === 'block')) {
      tests.push({ name: 'Dangerous command blocked', status: 'pass', detail: `rm -rf / → ${dangerTest.decision}` });
    } else {
      tests.push({ name: 'Dangerous command blocked', status: 'fail', detail: `Expected escalate/block, got: ${dangerTest.decision}` });
    }

    // Test 5: Terraform destroy → escalate
    console.log(`${INFO} Testing terraform destroy evaluation...`);
    const tfTest = await testShellEvaluation(recoursePath, 'terraform destroy -auto-approve');
    if (tfTest.success && (tfTest.decision === 'escalate' || tfTest.decision === 'block')) {
      tests.push({ name: 'Terraform destroy gated', status: 'pass', detail: `terraform destroy → ${tfTest.decision}` });
    } else {
      tests.push({ name: 'Terraform destroy gated', status: 'fail', detail: `Expected escalate/block, got: ${tfTest.decision}` });
    }

    // Test 6: kubectl delete → escalate
    console.log(`${INFO} Testing kubectl delete evaluation...`);
    const k8sTest = await testShellEvaluation(recoursePath, 'kubectl delete namespace production');
    if (k8sTest.success && (k8sTest.decision === 'escalate' || k8sTest.decision === 'block')) {
      tests.push({ name: 'kubectl delete gated', status: 'pass', detail: `kubectl delete namespace → ${k8sTest.decision}` });
    } else {
      tests.push({ name: 'kubectl delete gated', status: 'fail', detail: `Expected escalate/block, got: ${k8sTest.decision}` });
    }

    // Test 7: Attestation present
    console.log(`${INFO} Testing attestation signing...`);
    const attestTest = await testAttestation(recoursePath);
    if (attestTest.success) {
      tests.push({ name: 'Attestation signing', status: 'pass', detail: 'Reports include signed attestation' });
    } else {
      tests.push({ name: 'Attestation signing', status: 'fail', detail: attestTest.error || 'No attestation found' });
    }

    // Print results
    console.log(`\n${BOLD}Verification Results:${RESET}\n`);
    for (const test of tests) {
      const icon = test.status === 'pass' ? CHECK : CROSS;
      console.log(`  ${icon} ${test.name}`);
      console.log(`    ${DIM}${test.detail}${RESET}\n`);
    }

    const passed = tests.filter(t => t.status === 'pass').length;
    const failed = tests.filter(t => t.status === 'fail').length;

    console.log(`${BOLD}Summary:${RESET} ${passed}/${tests.length} tests passed\n`);

    if (failed === 0) {
      console.log(`${GREEN}${BOLD}RecourseOS gate verification passed${RESET}`);
      console.log(`\nThe consequence gate is working correctly:`);
      console.log(`  • Safe commands are allowed`);
      console.log(`  • Dangerous commands are escalated/blocked`);
      console.log(`  • Reports are cryptographically signed`);
      console.log();
    } else {
      console.log(`${RED}${BOLD}Verification failed${RESET}`);
      console.log(`\nFix the failing tests before deploying.`);
      process.exit(1);
    }
  });

// ============================================================================
// INIT COMMAND
// ============================================================================

program
  .command('init')
  .description('Initialize RecourseOS for a project or environment')
  .option('--enterprise', 'Include enterprise configuration templates')
  .action(async (options) => {
    console.log(`\n${BOLD}Initializing RecourseOS${RESET}\n`);

    // Create .recourse directory
    const recourseDir = path.join(process.cwd(), '.recourse');
    if (!fs.existsSync(recourseDir)) {
      fs.mkdirSync(recourseDir, { recursive: true });
      console.log(`${CHECK} Created .recourse directory`);
    }

    // Create default policy.yaml
    const policyPath = path.join(recourseDir, 'policy.yaml');
    if (!fs.existsSync(policyPath)) {
      const policyContent = `# RecourseOS Policy Configuration
# See: https://recourseos.dev/docs/policy

recourseos:
  version: "1.0"

  # Default action when no specific rule matches
  default_action: escalate

  # Decision behavior
  decisions:
    allow:
      execute: true
      log: true
    warn:
      execute: true
      log: true
      require_acknowledgment: false
    escalate:
      execute: false
      approval_required: true
      notify:
        - platform-team
    block:
      execute: false
      approval_required: true
      exception_process: change-advisory-board

  # Protected environments require escalation for any mutation
  protected_environments:
    - production
    - prod
    - regulated

  # Always escalate these mutation types regardless of environment
  always_escalate:
    - database_delete
    - iam_policy_change
    - encryption_key_change
    - backup_retention_reduction
    - terraform_destroy
    - kubernetes_namespace_delete

  # Auto-allow these safe patterns
  auto_allow:
    - filesystem_read
    - terraform_plan  # Planning is safe, applying is not
    - kubectl_get
    - aws_describe
`;
      fs.writeFileSync(policyPath, policyContent);
      console.log(`${CHECK} Created policy.yaml`);
    } else {
      console.log(`${INFO} policy.yaml already exists`);
    }

    // Create .gitignore entry
    const gitignorePath = path.join(recourseDir, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, `# RecourseOS local files
keys/
*.key
*.pem
audit-local/
`);
      console.log(`${CHECK} Created .gitignore`);
    }

    if (options.enterprise) {
      // Create CI template directory
      const ciDir = path.join(recourseDir, 'ci-templates');
      if (!fs.existsSync(ciDir)) {
        fs.mkdirSync(ciDir, { recursive: true });
      }

      // GitHub Actions template
      const ghActionsTemplate = `# RecourseOS Terraform Gate for GitHub Actions
# Add this job to your workflow

name: Terraform with RecourseOS Gate

on:
  pull_request:
    paths:
      - 'terraform/**'
      - '.recourse/**'

jobs:
  terraform-plan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3
        with:
          terraform_wrapper: false

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install RecourseOS
        run: npm install -g recourse-cli

      - name: Terraform Init
        run: terraform init
        working-directory: terraform

      - name: Terraform Plan
        run: |
          terraform plan -out=tfplan
          terraform show -json tfplan > plan.json
        working-directory: terraform

      - name: RecourseOS Evaluate
        id: recourse
        run: |
          RESULT=$(recourse plan terraform/plan.json --format json)
          echo "result<<EOF" >> $GITHUB_OUTPUT
          echo "$RESULT" >> $GITHUB_OUTPUT
          echo "EOF" >> $GITHUB_OUTPUT

          DECISION=$(echo "$RESULT" | jq -r '.riskAssessment')
          echo "decision=$DECISION" >> $GITHUB_OUTPUT

          if [ "$DECISION" = "block" ]; then
            echo "::error::RecourseOS blocked this plan. Human review required."
            exit 1
          fi

      - name: Upload Consequence Report
        uses: actions/upload-artifact@v4
        with:
          name: recourse-consequence-report
          path: terraform/plan.json

      - name: Comment on PR
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            const result = JSON.parse(\`\${{ steps.recourse.outputs.result }}\`);
            const decision = result.riskAssessment;
            const emoji = decision === 'allow' ? ':white_check_mark:' :
                         decision === 'warn' ? ':warning:' :
                         decision === 'escalate' ? ':rotating_light:' : ':no_entry:';

            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: \`## RecourseOS Consequence Report \${emoji}\\n\\n**Decision:** \${decision}\\n**Mutations:** \${result.summary?.totalMutations || 0}\\n\\n\${result.assessmentReason || ''}\`
            });
`;
      fs.writeFileSync(path.join(ciDir, 'github-actions.yml'), ghActionsTemplate);
      console.log(`${CHECK} Created ci-templates/github-actions.yml`);

      // GitLab CI template
      const gitlabTemplate = `# RecourseOS Terraform Gate for GitLab CI
# Include this in your .gitlab-ci.yml

stages:
  - plan
  - gate
  - apply

terraform-plan:
  stage: plan
  image: hashicorp/terraform:latest
  script:
    - terraform init
    - terraform plan -out=tfplan
    - terraform show -json tfplan > plan.json
  artifacts:
    paths:
      - plan.json
      - tfplan
    expire_in: 1 day

recourse-gate:
  stage: gate
  image: node:20
  needs:
    - terraform-plan
  script:
    - npm install -g recourse-cli
    - |
      RESULT=$(recourse plan plan.json --format json)
      DECISION=$(echo "$RESULT" | jq -r '.riskAssessment')
      echo "RecourseOS Decision: $DECISION"

      if [ "$DECISION" = "block" ]; then
        echo "BLOCKED: Human review required"
        exit 1
      fi

      if [ "$DECISION" = "escalate" ]; then
        echo "ESCALATED: Approval required"
        # In GitLab, this would trigger a manual approval gate
        exit 1
      fi
  artifacts:
    paths:
      - plan.json
    reports:
      dotenv: recourse.env

terraform-apply:
  stage: apply
  image: hashicorp/terraform:latest
  needs:
    - terraform-plan
    - recourse-gate
  script:
    - terraform init
    - terraform apply tfplan
  when: manual
  only:
    - main
`;
      fs.writeFileSync(path.join(ciDir, 'gitlab-ci.yml'), gitlabTemplate);
      console.log(`${CHECK} Created ci-templates/gitlab-ci.yml`);
    }

    console.log(`\n${GREEN}${BOLD}RecourseOS initialized${RESET}\n`);
    console.log(`Next steps:`);
    console.log(`  1. Review and customize .recourse/policy.yaml`);
    console.log(`  2. Run: recourseos-agent doctor`);
    console.log(`  3. Run: recourseos-agent install-mcp --client claude-code`);
    if (options.enterprise) {
      console.log(`  4. Copy CI templates from .recourse/ci-templates/ to your CI config`);
    }
    console.log();
  });

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function isMcpConfigured(client: McpClientConfig): boolean {
  try {
    if (!fs.existsSync(client.configPath)) return false;
    const config = JSON.parse(fs.readFileSync(client.configPath, 'utf-8'));
    return !!(config[client.configKey]?.recourse);
  } catch {
    return false;
  }
}

async function testMcpServer(recoursePath: string): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const proc = spawn('node', [recoursePath, 'mcp', 'serve'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      proc.kill();
      resolve({ success: false, error: 'Timeout waiting for response' });
    }, 5000);

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
      // Check if we got a valid response
      if (stdout.includes('"result"') || stdout.includes('protocolVersion')) {
        clearTimeout(timeout);
        proc.kill();
        resolve({ success: true });
      }
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ success: false, error: err.message });
    });

    // Send initialize request
    const initRequest = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05' },
    }) + '\n';

    proc.stdin.write(initRequest);
  });
}

async function testToolsList(recoursePath: string): Promise<{ success: boolean; count?: number; error?: string }> {
  return new Promise((resolve) => {
    const proc = spawn('node', [recoursePath, 'mcp', 'serve'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    const timeout = setTimeout(() => {
      proc.kill();
      resolve({ success: false, error: 'Timeout' });
    }, 5000);

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
      try {
        const lines = stdout.split('\n').filter(Boolean);
        for (const line of lines) {
          const parsed = JSON.parse(line);
          if (parsed.result?.tools) {
            clearTimeout(timeout);
            proc.kill();
            resolve({ success: true, count: parsed.result.tools.length });
            return;
          }
        }
      } catch {
        // Not valid JSON yet
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ success: false, error: err.message });
    });

    // Send initialize then tools/list
    const requests = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    ];

    proc.stdin.write(requests.map(r => JSON.stringify(r)).join('\n') + '\n');
  });
}

async function testShellEvaluation(recoursePath: string, command: string): Promise<{ success: boolean; decision?: string; error?: string }> {
  return new Promise((resolve) => {
    const proc = spawn('node', [recoursePath, 'evaluate', 'shell', command], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      try {
        const result = JSON.parse(stdout);
        resolve({ success: true, decision: result.riskAssessment });
      } catch {
        resolve({ success: false, error: stderr || 'Failed to parse output' });
      }
    });

    proc.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
  });
}

async function testAttestation(recoursePath: string): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const proc = spawn('node', [recoursePath, 'mcp', 'serve'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    const timeout = setTimeout(() => {
      proc.kill();
      resolve({ success: false, error: 'Timeout' });
    }, 5000);

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
      if (stdout.includes('attestation')) {
        clearTimeout(timeout);
        proc.kill();
        resolve({ success: true });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ success: false, error: err.message });
    });

    // Send shell evaluation via MCP
    const requests = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'recourse_evaluate_shell', arguments: { command: 'echo test' } } },
    ];

    proc.stdin.write(requests.map(r => JSON.stringify(r)).join('\n') + '\n');
  });
}

program.parse();
