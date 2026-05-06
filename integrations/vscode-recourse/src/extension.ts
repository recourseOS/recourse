/**
 * RecourseOS VS Code Extension
 *
 * Provides inline warnings and diagnostics for Terraform and Kubernetes files.
 */

import * as vscode from 'vscode';
import { execSync } from 'child_process';

// Diagnostic collection
let diagnosticCollection: vscode.DiagnosticCollection;

// Risk patterns for Terraform
const TERRAFORM_PATTERNS = {
  'skip_final_snapshot\\s*=\\s*true': {
    severity: vscode.DiagnosticSeverity.Error,
    message: 'skip_final_snapshot=true will cause data loss on deletion',
    risk: 'block',
  },
  'deletion_protection\\s*=\\s*false': {
    severity: vscode.DiagnosticSeverity.Warning,
    message: 'deletion_protection=false allows accidental deletion',
    risk: 'escalate',
  },
  'force_destroy\\s*=\\s*true': {
    severity: vscode.DiagnosticSeverity.Error,
    message: 'force_destroy=true will delete non-empty bucket',
    risk: 'block',
  },
  'backup_retention_period\\s*=\\s*0': {
    severity: vscode.DiagnosticSeverity.Warning,
    message: 'No backup retention configured for RDS instance',
    risk: 'escalate',
  },
  'prevent_destroy\\s*=\\s*false': {
    severity: vscode.DiagnosticSeverity.Warning,
    message: 'prevent_destroy=false allows Terraform to destroy this resource',
    risk: 'warn',
  },
  'enable_deletion_protection\\s*=\\s*false': {
    severity: vscode.DiagnosticSeverity.Warning,
    message: 'enable_deletion_protection=false on load balancer',
    risk: 'warn',
  },
  'point_in_time_recovery\\s*\\{[^}]*enabled\\s*=\\s*false': {
    severity: vscode.DiagnosticSeverity.Warning,
    message: 'Point-in-time recovery disabled for DynamoDB',
    risk: 'escalate',
  },
  'versioning\\s*\\{[^}]*enabled\\s*=\\s*false': {
    severity: vscode.DiagnosticSeverity.Warning,
    message: 'Versioning disabled for S3 bucket',
    risk: 'warn',
  },
};

// Risk patterns for Kubernetes
const KUBERNETES_PATTERNS = {
  'kind:\\s*PersistentVolumeClaim': {
    severity: vscode.DiagnosticSeverity.Information,
    message: 'PVC deletion will cause data loss',
    risk: 'info',
  },
  'reclaimPolicy:\\s*Delete': {
    severity: vscode.DiagnosticSeverity.Warning,
    message: 'reclaimPolicy=Delete will destroy PV on PVC deletion',
    risk: 'escalate',
  },
  'kind:\\s*StatefulSet': {
    severity: vscode.DiagnosticSeverity.Information,
    message: 'StatefulSet changes may affect persistent data',
    risk: 'info',
  },
};

/**
 * Activate the extension
 */
export function activate(context: vscode.ExtensionContext): void {
  console.log('RecourseOS extension activated');

  // Create diagnostic collection
  diagnosticCollection = vscode.languages.createDiagnosticCollection('recourse');
  context.subscriptions.push(diagnosticCollection);

  // Analyze on open and save
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(analyzeDocument),
    vscode.workspace.onDidSaveTextDocument(analyzeDocument),
    vscode.workspace.onDidChangeTextDocument((e) => analyzeDocument(e.document))
  );

  // Analyze all open documents
  vscode.workspace.textDocuments.forEach(analyzeDocument);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('recourse.analyze', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        analyzeDocument(editor.document);
        vscode.window.showInformationMessage('RecourseOS: Analysis complete');
      }
    }),
    vscode.commands.registerCommand('recourse.evaluatePlan', evaluateTerraformPlan),
    vscode.commands.registerCommand('recourse.evaluateManifest', evaluateKubernetesManifest)
  );

  // Register code actions
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      [{ language: 'terraform' }, { pattern: '*.tf' }],
      new RecourseCodeActionProvider(),
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
    )
  );

  // Register hover provider
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      [{ language: 'terraform' }, { pattern: '*.tf' }],
      new RecourseHoverProvider()
    )
  );

  // Status bar item
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
  statusBar.text = '$(shield) RecourseOS';
  statusBar.command = 'recourse.analyze';
  statusBar.show();
  context.subscriptions.push(statusBar);
}

/**
 * Analyze a document for risky patterns
 */
function analyzeDocument(document: vscode.TextDocument): void {
  const diagnostics: vscode.Diagnostic[] = [];

  // Skip non-relevant files
  const fileName = document.fileName.toLowerCase();
  const isTerraform = fileName.endsWith('.tf') || fileName.endsWith('.tfvars');
  const isKubernetes =
    fileName.endsWith('.yaml') ||
    fileName.endsWith('.yml') ||
    fileName.includes('kubernetes') ||
    fileName.includes('k8s');

  if (!isTerraform && !isKubernetes) {
    diagnosticCollection.delete(document.uri);
    return;
  }

  const text = document.getText();
  const patterns = isTerraform ? TERRAFORM_PATTERNS : KUBERNETES_PATTERNS;

  for (const [pattern, config] of Object.entries(patterns)) {
    const regex = new RegExp(pattern, 'gmi');
    let match;

    while ((match = regex.exec(text)) !== null) {
      const startPos = document.positionAt(match.index);
      const endPos = document.positionAt(match.index + match[0].length);
      const range = new vscode.Range(startPos, endPos);

      const diagnostic = new vscode.Diagnostic(
        range,
        `[RecourseOS] ${config.message}`,
        config.severity
      );
      diagnostic.source = 'RecourseOS';
      diagnostic.code = config.risk;
      diagnostics.push(diagnostic);
    }
  }

  diagnosticCollection.set(document.uri, diagnostics);
}

/**
 * Evaluate Terraform plan using CLI
 */
async function evaluateTerraformPlan(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('No active editor');
    return;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder');
    return;
  }

  const cwd = workspaceFolder.uri.fsPath;

  try {
    // Show progress
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'RecourseOS: Evaluating Terraform plan...',
        cancellable: false,
      },
      async () => {
        // Generate plan
        execSync('terraform plan -out=plan.out', { cwd, encoding: 'utf-8' });
        const planJson = execSync('terraform show -json plan.out', { cwd, encoding: 'utf-8' });

        // Evaluate with RecourseOS
        const result = execSync(`npx -y recourse-cli@latest plan - --format json`, {
          cwd,
          encoding: 'utf-8',
          input: planJson,
        });

        const report = JSON.parse(result);
        showEvaluationResult(report);
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    vscode.window.showErrorMessage(`RecourseOS: ${message}`);
  }
}

/**
 * Evaluate Kubernetes manifest
 */
async function evaluateKubernetesManifest(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('No active editor');
    return;
  }

  const document = editor.document;
  const text = document.getText();

  try {
    const result = execSync(
      `npx -y kubectl-recourse diff -f - --json`,
      {
        encoding: 'utf-8',
        input: text,
      }
    );

    const report = JSON.parse(result);
    showKubernetesResult(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    vscode.window.showErrorMessage(`RecourseOS: ${message}`);
  }
}

/**
 * Show evaluation result in panel
 */
function showEvaluationResult(report: any): void {
  const panel = vscode.window.createWebviewPanel(
    'recourseResult',
    'RecourseOS Evaluation',
    vscode.ViewColumn.Beside,
    {}
  );

  const { summary, changes } = report;
  const riskClass = summary.hasUnrecoverable
    ? 'block'
    : summary.needsReview > 0
    ? 'escalate'
    : 'allow';

  panel.webview.html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: var(--vscode-font-family); padding: 20px; }
        .block { color: #f44336; }
        .escalate { color: #ff9800; }
        .warn { color: #ffeb3b; }
        .allow { color: #4caf50; }
        .summary { margin: 20px 0; padding: 15px; background: var(--vscode-editor-background); border-radius: 4px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 8px; text-align: left; border-bottom: 1px solid var(--vscode-panel-border); }
        h1 { display: flex; align-items: center; gap: 10px; }
      </style>
    </head>
    <body>
      <h1>
        ${riskClass === 'block' ? '🛑' : riskClass === 'escalate' ? '⚠️' : '✅'}
        RecourseOS Evaluation
      </h1>
      <div class="summary">
        <p><strong>Risk Assessment:</strong> <span class="${riskClass}">${riskClass.toUpperCase()}</span></p>
        <p><strong>Total Changes:</strong> ${summary.totalChanges}</p>
        <p><strong>Unrecoverable:</strong> ${summary.unrecoverable}</p>
        <p><strong>Needs Review:</strong> ${summary.needsReview}</p>
      </div>
      <h2>Changes</h2>
      <table>
        <tr>
          <th>Resource</th>
          <th>Action</th>
          <th>Risk</th>
          <th>Reason</th>
        </tr>
        ${changes
          .map(
            (c: any) => `
          <tr>
            <td><code>${c.address}</code></td>
            <td>${c.action}</td>
            <td class="${c.recoverability.label.replace('-', '')}">${c.recoverability.label}</td>
            <td>${c.recoverability.reasoning || '-'}</td>
          </tr>
        `
          )
          .join('')}
      </table>
    </body>
    </html>
  `;
}

/**
 * Show Kubernetes result
 */
function showKubernetesResult(report: any): void {
  const { results } = report;
  const hasBlock = results.some((r: any) => r.riskLevel === 'block');
  const hasEscalate = results.some((r: any) => r.riskLevel === 'escalate');

  if (hasBlock) {
    vscode.window.showErrorMessage(
      `RecourseOS: BLOCKED - ${results.filter((r: any) => r.riskLevel === 'block').length} unrecoverable change(s)`
    );
  } else if (hasEscalate) {
    vscode.window.showWarningMessage(
      `RecourseOS: ${results.filter((r: any) => r.riskLevel === 'escalate').length} change(s) need review`
    );
  } else {
    vscode.window.showInformationMessage('RecourseOS: All changes are safe');
  }
}

/**
 * Code action provider for quick fixes
 */
class RecourseCodeActionProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      if (diagnostic.source !== 'RecourseOS') continue;

      const text = document.getText(diagnostic.range);

      // Fix skip_final_snapshot
      if (text.includes('skip_final_snapshot') && text.includes('true')) {
        const fix = new vscode.CodeAction(
          'Set skip_final_snapshot = false',
          vscode.CodeActionKind.QuickFix
        );
        fix.edit = new vscode.WorkspaceEdit();
        fix.edit.replace(
          document.uri,
          diagnostic.range,
          text.replace('true', 'false')
        );
        fix.diagnostics = [diagnostic];
        fix.isPreferred = true;
        actions.push(fix);
      }

      // Fix deletion_protection
      if (text.includes('deletion_protection') && text.includes('false')) {
        const fix = new vscode.CodeAction(
          'Set deletion_protection = true',
          vscode.CodeActionKind.QuickFix
        );
        fix.edit = new vscode.WorkspaceEdit();
        fix.edit.replace(
          document.uri,
          diagnostic.range,
          text.replace('false', 'true')
        );
        fix.diagnostics = [diagnostic];
        fix.isPreferred = true;
        actions.push(fix);
      }

      // Fix force_destroy
      if (text.includes('force_destroy') && text.includes('true')) {
        const fix = new vscode.CodeAction(
          'Set force_destroy = false',
          vscode.CodeActionKind.QuickFix
        );
        fix.edit = new vscode.WorkspaceEdit();
        fix.edit.replace(
          document.uri,
          diagnostic.range,
          text.replace('true', 'false')
        );
        fix.diagnostics = [diagnostic];
        fix.isPreferred = true;
        actions.push(fix);
      }
    }

    return actions;
  }
}

/**
 * Hover provider for recoverability info
 */
class RecourseHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.Hover | null {
    const line = document.lineAt(position.line).text;

    // Resource type detection
    const resourceMatch = line.match(/resource\s+"(\w+)"/);
    if (resourceMatch) {
      const resourceType = resourceMatch[1];
      const info = this.getResourceInfo(resourceType);
      if (info) {
        return new vscode.Hover(
          new vscode.MarkdownString(
            `**RecourseOS: ${resourceType}**\n\n` +
            `Default Tier: ${info.tier}\n\n` +
            `${info.notes}`
          )
        );
      }
    }

    return null;
  }

  private getResourceInfo(resourceType: string): { tier: string; notes: string } | null {
    const infos: Record<string, { tier: string; notes: string }> = {
      aws_db_instance: {
        tier: 'recoverable-from-backup',
        notes: 'Enable automated backups and final snapshot for recovery.',
      },
      aws_s3_bucket: {
        tier: 'recoverable-from-backup',
        notes: 'Enable versioning and cross-region replication.',
      },
      aws_dynamodb_table: {
        tier: 'recoverable-from-backup',
        notes: 'Enable point-in-time recovery and on-demand backups.',
      },
      aws_iam_role: {
        tier: 'recoverable-with-effort',
        notes: 'Keep IAM policies in version control.',
      },
      aws_lambda_function: {
        tier: 'recoverable-with-effort',
        notes: 'Source code should be in version control.',
      },
    };

    return infos[resourceType] || null;
  }
}

/**
 * Deactivate the extension
 */
export function deactivate(): void {
  diagnosticCollection.dispose();
}
