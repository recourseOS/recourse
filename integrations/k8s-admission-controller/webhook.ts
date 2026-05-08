/**
 * RecourseOS Kubernetes Validating Admission Webhook
 *
 * Intercepts Kubernetes API requests and evaluates them with RecourseOS
 * before allowing them to proceed.
 *
 * This is IN-LINE enforcement - requests are blocked at the API server level.
 */

import { createServer, IncomingMessage, ServerResponse } from 'https';
import { readFileSync } from 'fs';

// Environment configuration
interface Config {
  port: number;
  certPath: string;
  keyPath: string;
  recourseApiUrl: string;
  dryRun: boolean;
  allowedRiskLevels: string[];
}

// Kubernetes AdmissionReview types
interface AdmissionReview {
  apiVersion: string;
  kind: 'AdmissionReview';
  request?: AdmissionRequest;
  response?: AdmissionResponse;
}

interface AdmissionRequest {
  uid: string;
  kind: { group: string; version: string; kind: string };
  resource: { group: string; version: string; resource: string };
  subResource?: string;
  requestKind?: { group: string; version: string; kind: string };
  requestResource?: { group: string; version: string; resource: string };
  name?: string;
  namespace?: string;
  operation: 'CREATE' | 'UPDATE' | 'DELETE' | 'CONNECT';
  userInfo: { username: string; uid?: string; groups?: string[] };
  object?: unknown;
  oldObject?: unknown;
  options?: unknown;
  dryRun?: boolean;
}

interface AdmissionResponse {
  uid: string;
  allowed: boolean;
  status?: { code: number; message: string };
  warnings?: string[];
  auditAnnotations?: Record<string, string>;
}

// RecourseOS API types
interface RecourseEvaluateResponse {
  riskAssessment: 'allow' | 'warn' | 'escalate' | 'block';
  assessmentReason: string;
  mutations: Array<{
    intent: { action: string; target: unknown };
    recoverability: { tier: number; label: string; reasoning: string };
  }>;
  attestation?: {
    attestation_uri: string;
    signature: string;
    key_id: string;
  };
}

// High-risk resource types that warrant evaluation
const HIGH_RISK_RESOURCES = new Set([
  'persistentvolumeclaims',
  'persistentvolumes',
  'statefulsets',
  'namespaces',
  'customresourcedefinitions',
  'secrets',
  'configmaps',
  'deployments',
  'daemonsets',
  'services',
]);

// Operations that warrant evaluation
const EVALUATED_OPERATIONS = new Set(['DELETE', 'UPDATE']);

/**
 * Check if this request should be evaluated
 */
function shouldEvaluate(request: AdmissionRequest): boolean {
  // Skip if not a high-risk resource
  if (!HIGH_RISK_RESOURCES.has(request.resource.resource)) {
    return false;
  }

  // Skip if not a risky operation
  if (!EVALUATED_OPERATIONS.has(request.operation)) {
    return false;
  }

  // Skip kube-system namespace (don't block system operations)
  if (request.namespace === 'kube-system') {
    return false;
  }

  return true;
}

/**
 * Convert K8s admission request to RecourseOS evaluation format
 */
function toRecourseInput(request: AdmissionRequest): object {
  const kind = request.kind.kind;
  const name = request.name || (request.object as any)?.metadata?.name || 'unknown';
  const namespace = request.namespace || 'default';

  if (request.operation === 'DELETE') {
    return {
      source: 'kubernetes',
      operation: 'delete',
      resource: {
        apiVersion: `${request.kind.group}/${request.kind.version}`,
        kind: kind,
        name: name,
        namespace: namespace,
      },
      object: request.oldObject || request.object,
    };
  }

  return {
    source: 'kubernetes',
    operation: request.operation.toLowerCase(),
    resource: {
      apiVersion: `${request.kind.group}/${request.kind.version}`,
      kind: kind,
      name: name,
      namespace: namespace,
    },
    object: request.object,
    oldObject: request.oldObject,
  };
}

/**
 * Evaluate request with RecourseOS
 */
async function evaluateWithRecourse(
  input: object,
  config: Config
): Promise<RecourseEvaluateResponse> {
  const response = await fetch(`${config.recourseApiUrl}/api/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: 'mcp', // Use MCP evaluator for arbitrary operations
      input: {
        tool: 'kubernetes_mutation',
        arguments: input,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`RecourseOS API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Create admission response
 */
function createResponse(
  uid: string,
  allowed: boolean,
  message?: string,
  attestationUri?: string
): AdmissionResponse {
  const response: AdmissionResponse = {
    uid,
    allowed,
  };

  if (!allowed && message) {
    response.status = {
      code: 403,
      message: `RecourseOS: ${message}`,
    };
  }

  if (attestationUri) {
    response.auditAnnotations = {
      'recourse.dev/attestation-uri': attestationUri,
      'recourse.dev/evaluated': 'true',
    };
  }

  return response;
}

/**
 * Handle admission review request
 */
async function handleAdmissionReview(
  review: AdmissionReview,
  config: Config
): Promise<AdmissionReview> {
  const request = review.request;

  if (!request) {
    return {
      apiVersion: 'admission.k8s.io/v1',
      kind: 'AdmissionReview',
      response: createResponse('', false, 'No request in AdmissionReview'),
    };
  }

  // Check if we should evaluate this request
  if (!shouldEvaluate(request)) {
    return {
      apiVersion: 'admission.k8s.io/v1',
      kind: 'AdmissionReview',
      response: createResponse(request.uid, true),
    };
  }

  try {
    // Convert to RecourseOS format
    const recourseInput = toRecourseInput(request);

    // Evaluate with RecourseOS
    const result = await evaluateWithRecourse(recourseInput, config);

    // Determine if allowed based on risk level
    const allowed = config.allowedRiskLevels.includes(result.riskAssessment);

    // Build message for denied requests
    let message = result.assessmentReason;
    if (!allowed) {
      const resource = `${request.kind.kind}/${request.name || 'unknown'}`;
      const ns = request.namespace ? ` in ${request.namespace}` : '';
      message = `${result.riskAssessment.toUpperCase()}: ${resource}${ns} - ${result.assessmentReason}`;
    }

    // Log evaluation
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      kind: request.kind.kind,
      name: request.name,
      namespace: request.namespace,
      operation: request.operation,
      user: request.userInfo.username,
      riskAssessment: result.riskAssessment,
      allowed: allowed || config.dryRun,
      attestationUri: result.attestation?.attestation_uri,
      dryRun: config.dryRun,
    }));

    // In dry-run mode, always allow but add warning
    if (config.dryRun && !allowed) {
      return {
        apiVersion: 'admission.k8s.io/v1',
        kind: 'AdmissionReview',
        response: {
          uid: request.uid,
          allowed: true,
          warnings: [`RecourseOS (dry-run): Would DENY - ${message}`],
          auditAnnotations: {
            'recourse.dev/attestation-uri': result.attestation?.attestation_uri || '',
            'recourse.dev/would-deny': 'true',
            'recourse.dev/risk-assessment': result.riskAssessment,
          },
        },
      };
    }

    return {
      apiVersion: 'admission.k8s.io/v1',
      kind: 'AdmissionReview',
      response: createResponse(
        request.uid,
        allowed,
        allowed ? undefined : message,
        result.attestation?.attestation_uri
      ),
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('RecourseOS evaluation failed:', errorMessage);

    // Fail open (allow) on error to not block cluster operations
    return {
      apiVersion: 'admission.k8s.io/v1',
      kind: 'AdmissionReview',
      response: {
        uid: request.uid,
        allowed: true,
        warnings: [`RecourseOS evaluation failed: ${errorMessage}`],
      },
    };
  }
}

/**
 * HTTP request handler
 */
async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: Config
): Promise<void> {
  // Health check
  if (req.url === '/healthz' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  // Ready check
  if (req.url === '/readyz' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  // Admission webhook endpoint
  if (req.url === '/validate' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

    try {
      const review: AdmissionReview = JSON.parse(body);
      const response = await handleAdmissionReview(review, config);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
    } catch (error) {
      console.error('Error processing admission review:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

/**
 * Start the webhook server
 */
export function startServer(config: Partial<Config> = {}): void {
  const fullConfig: Config = {
    port: parseInt(process.env.PORT || '8443'),
    certPath: process.env.TLS_CERT_PATH || '/etc/webhook/certs/tls.crt',
    keyPath: process.env.TLS_KEY_PATH || '/etc/webhook/certs/tls.key',
    recourseApiUrl: process.env.RECOURSE_API_URL || 'http://recourse-service:3001',
    dryRun: process.env.DRY_RUN === 'true',
    allowedRiskLevels: (process.env.ALLOWED_RISK_LEVELS || 'allow,warn').split(','),
    ...config,
  };

  const serverOptions = {
    cert: readFileSync(fullConfig.certPath),
    key: readFileSync(fullConfig.keyPath),
  };

  const server = createServer(serverOptions, (req, res) => {
    handleRequest(req, res, fullConfig);
  });

  server.listen(fullConfig.port, () => {
    console.log(`RecourseOS Admission Webhook listening on port ${fullConfig.port}`);
    console.log(`Dry-run mode: ${fullConfig.dryRun}`);
    console.log(`Allowed risk levels: ${fullConfig.allowedRiskLevels.join(', ')}`);
    console.log(`RecourseOS API: ${fullConfig.recourseApiUrl}`);
  });
}

// Start if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
