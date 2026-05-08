# RecourseOS Kubernetes Admission Controller

Validating admission webhook that enforces RecourseOS evaluation on Kubernetes mutations.

**This is IN-LINE enforcement** - dangerous operations are blocked at the API server level before they can execute.

## How It Works

```
┌─────────────┐     ┌─────────────────────┐     ┌─────────────────┐
│   kubectl   │────▶│  K8s API Server     │────▶│ RecourseOS      │
│   delete    │     │  (AdmissionWebhook) │     │ Webhook         │
└─────────────┘     └─────────────────────┘     └─────────────────┘
                              │                         │
                              │   AdmissionReview       │   Evaluate
                              │   request               │   consequences
                              │                         ▼
                              │                  ┌─────────────────┐
                              │◀─────────────────│ RecourseOS API  │
                              │   Allow/Deny     │ (analyze)       │
                              ▼                  └─────────────────┘
                    ┌─────────────────┐
                    │ etcd (if allow) │
                    └─────────────────┘
```

## Evaluated Resources

| Resource | Operations | Risk Level |
|----------|------------|------------|
| PersistentVolumeClaim | DELETE, UPDATE | BLOCK (data loss) |
| PersistentVolume | DELETE | BLOCK (data loss) |
| StatefulSet | DELETE, UPDATE | ESCALATE (stateful workload) |
| Namespace | DELETE | BLOCK (cascading deletion) |
| CustomResourceDefinition | DELETE | ESCALATE (cascading deletion) |
| Secret | DELETE | WARN (may break workloads) |

## Installation

### Prerequisites

- Kubernetes cluster 1.19+
- cert-manager (for TLS certificates) or manual TLS setup
- RecourseOS API (deployed in-cluster or external)

### 1. Create TLS Certificate

**Option A: Using cert-manager**

```yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: recourse-webhook-cert
  namespace: recourse-system
spec:
  secretName: recourse-webhook-certs
  dnsNames:
    - recourse-webhook.recourse-system.svc
    - recourse-webhook.recourse-system.svc.cluster.local
  issuerRef:
    name: selfsigned-issuer
    kind: ClusterIssuer
```

**Option B: Manual (for testing)**

```bash
# Generate self-signed cert
./scripts/generate-certs.sh
kubectl create secret tls recourse-webhook-certs \
  --cert=tls.crt \
  --key=tls.key \
  -n recourse-system
```

### 2. Deploy the Webhook

```bash
# Apply manifests
kubectl apply -f manifests/deployment.yaml

# Wait for pods
kubectl -n recourse-system wait --for=condition=Ready pod -l app=recourse-webhook

# Apply webhook configuration
kubectl apply -f manifests/webhook-config.yaml
```

### 3. Verify Installation

```bash
# Test with a dry-run deletion
kubectl delete pvc test-data --dry-run=server

# Check webhook logs
kubectl -n recourse-system logs -l app=recourse-webhook
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Webhook server port | `8443` |
| `RECOURSE_API_URL` | RecourseOS API endpoint | `http://recourse-service:3001` |
| `DRY_RUN` | Log but don't block | `false` |
| `ALLOWED_RISK_LEVELS` | Comma-separated allowed levels | `allow,warn` |

### Risk Level Enforcement

| ALLOWED_RISK_LEVELS | Effect |
|---------------------|--------|
| `allow` | Only fully safe operations proceed |
| `allow,warn` | Safe + recoverable operations proceed |
| `allow,warn,escalate` | Only BLOCK is denied |
| `allow,warn,escalate,block` | Audit-only mode (everything allowed) |

### Opt-Out Annotation

Skip evaluation for specific resources:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: ephemeral-cache
  annotations:
    recourse.dev/skip: "true"
```

## Example Denials

### PVC Deletion Blocked

```
$ kubectl delete pvc production-data

Error from server: admission webhook "recourse.recourseos.dev" denied the request:
RecourseOS: BLOCK: PersistentVolumeClaim/production-data in default -
  PVC deletion would cause unrecoverable data loss
```

### Namespace Deletion Blocked

```
$ kubectl delete namespace staging

Error from server: admission webhook "recourse.recourseos.dev" denied the request:
RecourseOS: BLOCK: Namespace/staging -
  Namespace deletion cascades to 47 resources including 3 PVCs
```

## Audit Annotations

Every evaluated request gets annotations:

```yaml
auditAnnotations:
  recourse.dev/attestation-uri: "https://recourse.example.com/.well-known/attestations/abc123.json"
  recourse.dev/evaluated: "true"
  recourse.dev/risk-assessment: "allow"
```

These appear in Kubernetes audit logs for compliance.

## Dry-Run Mode

Test the webhook without blocking operations:

```yaml
env:
  - name: DRY_RUN
    value: "true"
```

In dry-run mode:
- All requests are allowed
- Would-be denials appear as warnings
- Annotations show `recourse.dev/would-deny: "true"`

## Monitoring

### Metrics

The webhook exposes Prometheus metrics:

- `recourse_evaluations_total{result="allow|deny"}`
- `recourse_evaluation_duration_seconds`
- `recourse_api_errors_total`

### Logs

Structured JSON logs for each evaluation:

```json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "kind": "PersistentVolumeClaim",
  "name": "data-volume",
  "namespace": "production",
  "operation": "DELETE",
  "user": "developer@example.com",
  "riskAssessment": "block",
  "allowed": false,
  "attestationUri": "https://..."
}
```

## Troubleshooting

### Webhook not receiving requests

```bash
# Check webhook configuration
kubectl get validatingwebhookconfigurations recourse-validating-webhook -o yaml

# Check CA bundle is set
kubectl get validatingwebhookconfigurations recourse-validating-webhook \
  -o jsonpath='{.webhooks[0].clientConfig.caBundle}'
```

### Webhook timing out

```bash
# Check webhook pods are running
kubectl -n recourse-system get pods

# Check RecourseOS API is reachable
kubectl -n recourse-system exec -it deploy/recourse-webhook -- \
  curl -s http://recourse-service:3001/api/health
```

### Bypass in emergency

```bash
# Temporarily disable webhook
kubectl delete validatingwebhookconfigurations recourse-validating-webhook

# Or set failure policy to Ignore in the config
```

## Security Considerations

1. **Fail Open**: The webhook uses `failurePolicy: Ignore` to prevent blocking the cluster if RecourseOS is unavailable
2. **System Namespaces**: kube-system and other system namespaces are excluded
3. **TLS Required**: All communication uses TLS
4. **Attestation Trail**: Every evaluation produces a signed attestation for audit

## License

MIT
