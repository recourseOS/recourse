/**
 * RecourseOS Agent Gateway Types - v2 Enforcement Architecture
 *
 * The gateway is the enforcement layer that agents cannot bypass.
 * Key invariant: Agents never receive raw mutation capability.
 * They only receive consequence-aware gateway tools.
 */

export type GateDecision = 'allow' | 'warn' | 'escalate' | 'block';
export type Environment = 'dev' | 'staging' | 'prod';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';
export type ApprovalMethod = 'sso' | 'slack' | 'servicenow' | 'web_console' | 'github_environment' | 'cli';

// ============================================================================
// GATE RESULTS
// ============================================================================

export interface GateResult<T = unknown> {
  decision: GateDecision;
  executed: boolean;
  result?: T;
  error?: string;

  report: {
    riskAssessment: GateDecision;
    assessmentReason: string;
    tier: number;
    tierLabel: string;
    mutations: number;
    blastRadius: string[];
  };

  // For escalations
  approvalRequired?: boolean;
  approvalId?: string;

  // Audit trail
  recourseReportId?: string;
  attestationId?: string;
}

// ============================================================================
// APPROVAL SYSTEM - Human-only control plane
// ============================================================================

export interface ApprovalRequest {
  approvalId: string;

  // Who requested
  requestedByAgent: string;
  requestedByUser?: string;

  // What's being requested
  operation: string;
  target: string;
  environment: Environment;
  planId?: string;

  // Risk assessment
  risk: GateDecision;
  recourseReportId: string;
  blastRadius: string[];
  recoveryPath?: string;

  // Status
  status: ApprovalStatus;
  createdAt: string;
  expiresAt: string;

  // If approved/rejected
  resolution?: {
    humanUserId: string;
    humanEmail?: string;
    groups: string[];
    method: ApprovalMethod;
    reason: string;
    resolvedAt: string;
  };
}

// ============================================================================
// TERRAFORM PLAN-BOUND EXECUTION
// ============================================================================

export interface TerraformPlanRecord {
  planId: string;

  // Integrity verification
  planHash: string;
  planJsonHash: string;
  gitSha?: string;
  terraformVersion?: string;

  // Context
  workspace: string;
  environment: Environment;
  workingDirectory: string;

  // Who created
  createdByAgent: string;
  createdByUser?: string;
  createdAt: string;
  expiresAt: string;

  // RecourseOS evaluation
  recourseReportId: string;
  decision: GateDecision;

  // Approval (if needed)
  approvalId?: string;

  // Lifecycle
  status: 'planned' | 'approved' | 'applied' | 'rejected' | 'expired';
  appliedAt?: string;
}

export interface TerraformPlanInput {
  cwd?: string;
  workspace?: string;
  args?: string[];
  gitSha?: string;
}

export interface TerraformApplyInput {
  planId: string;
}

export interface TerraformDestroyInput {
  cwd?: string;
  workspace?: string;
  args?: string[];
  breakGlass?: boolean;
  breakGlassReason?: string;
}

// ============================================================================
// KUBERNETES OPERATION-SPECIFIC TYPES
// ============================================================================

export interface KubectlReadInput {
  resource?: string;
  name?: string;
  namespace?: string;
  selector?: string;
  allNamespaces?: boolean;
  output?: 'json' | 'yaml' | 'wide' | 'name';
}

export interface KubectlLogsInput {
  pod: string;
  namespace?: string;
  container?: string;
  follow?: boolean;
  tail?: number;
  since?: string;
  previous?: boolean;
}

export interface KubectlApplyInput {
  file?: string;
  manifest?: string;
  namespace?: string;
  dryRun?: 'none' | 'client' | 'server';
}

export interface KubectlDeleteInput {
  resource: string;
  name: string;
  namespace?: string;
  force?: boolean;
  gracePeriod?: number;
}

export interface KubectlScaleInput {
  resource: string;
  name: string;
  namespace?: string;
  replicas: number;
}

export interface KubectlExecInput {
  pod: string;
  namespace?: string;
  container?: string;
  command: string[];
}

export interface KubectlRolloutInput {
  resource: string;
  name: string;
  namespace?: string;
}

// ============================================================================
// SHELL SANDBOX
// ============================================================================

export interface ShellExecInput {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  sandbox?: boolean;
}

export interface ShellPolicy {
  default: 'allow' | 'block' | 'escalate';

  allowReadonly: string[];
  alwaysEscalate: string[];
  alwaysBlock: string[];

  // Sandbox settings
  noProductionCredentials: boolean;
  noUnrestrictedNetwork: boolean;
  noSudo: boolean;
  maxTimeout: number;
  redactSecrets: boolean;
}

// ============================================================================
// POLICY MODEL
// ============================================================================

export interface EnvironmentPolicy {
  defaultMutation: GateDecision;
  terraformDestroy: GateDecision;
  kubectlExec: GateDecision;
  kubectlDelete: GateDecision;
  shell: GateDecision;
}

export interface GatewayPolicy {
  version: string;

  // Per-environment rules
  environments: {
    dev: EnvironmentPolicy;
    staging: EnvironmentPolicy;
    prod: EnvironmentPolicy;
  };

  // Protected Kubernetes namespaces
  protectedNamespaces: string[];

  // Protected Terraform workspaces
  protectedWorkspaces: string[];

  // Patterns that always escalate
  alwaysEscalate: string[];

  // Patterns that always block
  alwaysBlock: string[];

  // Shell-specific policy
  shell: ShellPolicy;

  // Timing
  planTtlSeconds: number;
  approvalTtlSeconds: number;
}

// ============================================================================
// COMMAND RESULT
// ============================================================================

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

// ============================================================================
// STORES
// ============================================================================

export interface PlanStore {
  save(record: TerraformPlanRecord): Promise<void>;
  get(planId: string): Promise<TerraformPlanRecord | null>;
  updateStatus(planId: string, status: TerraformPlanRecord['status']): Promise<void>;
}

export interface ApprovalStore {
  save(request: ApprovalRequest): Promise<void>;
  get(approvalId: string): Promise<ApprovalRequest | null>;
  approve(approvalId: string, resolution: ApprovalRequest['resolution']): Promise<void>;
  reject(approvalId: string, resolution: ApprovalRequest['resolution']): Promise<void>;
  getExpired(): Promise<ApprovalRequest[]>;
}

// ============================================================================
// DEFAULT POLICY
// ============================================================================

export const DEFAULT_POLICY: GatewayPolicy = {
  version: '2.0',

  environments: {
    dev: {
      defaultMutation: 'allow',
      terraformDestroy: 'escalate',
      kubectlExec: 'escalate',
      kubectlDelete: 'warn',
      shell: 'warn',
    },
    staging: {
      defaultMutation: 'warn',
      terraformDestroy: 'escalate',
      kubectlExec: 'escalate',
      kubectlDelete: 'escalate',
      shell: 'escalate',
    },
    prod: {
      defaultMutation: 'escalate',
      terraformDestroy: 'block',
      kubectlExec: 'escalate',
      kubectlDelete: 'escalate',
      shell: 'escalate',
    },
  },

  protectedNamespaces: [
    'kube-system',
    'kube-public',
    'cert-manager',
    'ingress',
    'istio-system',
    'monitoring',
    'security',
    'vault',
  ],

  protectedWorkspaces: [
    'production',
    'prod',
  ],

  alwaysEscalate: [
    'database_delete',
    'iam_policy_change',
    'security_group_public_ingress',
    'encryption_key_change',
    'backup_retention_reduction',
    'kubernetes_secret_change',
    'namespace_delete',
    'pv_delete',
    'production_scale_down',
  ],

  alwaysBlock: [
    'disable_audit_logging',
    'delete_backup_vault',
    'destroy_prod_workspace',
    'expose_customer_data_publicly',
    'remove_encryption',
    'bypass_gateway',
    'curl_pipe_shell',
    'credential_dump',
  ],

  shell: {
    default: 'block',
    allowReadonly: [
      'ls', 'cat', 'head', 'tail', 'grep', 'find', 'wc',
      'jq', 'yq',
      'git status', 'git diff', 'git log', 'git show',
      'terraform show', 'terraform validate', 'terraform fmt',
      'kubectl get', 'kubectl describe', 'kubectl logs',
      'aws sts get-caller-identity',
      'echo', 'pwd', 'whoami', 'date', 'env',
    ],
    alwaysEscalate: [
      'rm', 'mv', 'cp', 'chmod', 'chown', 'mkdir', 'rmdir',
      'aws', 'gcloud', 'az',
      'kubectl apply', 'kubectl delete', 'kubectl exec', 'kubectl patch',
      'terraform apply', 'terraform destroy', 'terraform import',
      'helm install', 'helm upgrade', 'helm delete',
      'docker run', 'docker exec', 'docker rm',
    ],
    alwaysBlock: [
      'curl | sh', 'curl | bash', 'wget | sh', 'wget | bash',
      'bash <(curl', 'sh <(curl', 'python -c.*urllib',
      'rm -rf /', 'rm -rf /*', 'rm -rf ~',
      'chmod 777', 'chmod -R 777',
      'sudo su', 'sudo -i', 'sudo bash',
      '> /etc/', '> /var/', '> /usr/',
      'nc -e', 'bash -i >& /dev/tcp',
    ],
    noProductionCredentials: true,
    noUnrestrictedNetwork: true,
    noSudo: true,
    maxTimeout: 60000,
    redactSecrets: true,
  },

  planTtlSeconds: 3600,      // 1 hour
  approvalTtlSeconds: 86400, // 24 hours
};

// ============================================================================
// V1 BACKWARD COMPATIBILITY
// The following types support the v1 gateway implementation
// ============================================================================

/** @deprecated Use GatewayPolicy instead */
export interface GatePolicy {
  defaultAction?: GateDecision;
  alwaysEscalate?: string[];
  protectedEnvironments?: string[];
  environment?: string;
  executeOnWarn?: boolean;
  onEscalate?: (result: GateResult) => Promise<boolean>;
  onEvaluate?: (result: GateResult) => void;
}

/** @deprecated Use ShellExecInput instead */
export interface ShellExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
}

/** @deprecated Use KubectlApplyInput instead */
export interface KubectlApplyOptions {
  file?: string;
  manifest?: string;
  namespace?: string;
  dryRun?: 'none' | 'client' | 'server';
  args?: string[];
}

/** @deprecated Use TerraformApplyInput instead */
export interface TerraformApplyOptions {
  cwd?: string;
  planFile?: string;
  planJson?: unknown;
  stateJson?: unknown;
  autoApprove?: boolean;
  args?: string[];
}

export interface GateResult<T = unknown> {
  decision: GateDecision;
  executed: boolean;
  result?: T;
  error?: string;

  report: {
    riskAssessment: GateDecision;
    assessmentReason: string;
    tier: number;
    tierLabel: string;
    mutations: number;
    blastRadius: string[];
  };

  // For escalations
  approvalRequired?: boolean;
  approvalId?: string;

  // Audit trail
  recourseReportId?: string;
  attestationId?: string;
}
