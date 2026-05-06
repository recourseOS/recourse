# kubectl-recourse

A kubectl plugin that evaluates Kubernetes changes for destructive consequences using RecourseOS.

## Installation

### npm (Recommended)

```bash
npm install -g kubectl-recourse
```

### Manual

```bash
cd integrations/kubectl-recourse
npm install
npm run build

# Link to kubectl plugin directory
ln -s $(pwd)/dist/kubectl-recourse.js /usr/local/bin/kubectl-recourse
# or
cp dist/kubectl-recourse.js /usr/local/bin/kubectl-recourse
```

### Krew (coming soon)

```bash
kubectl krew install recourse
```

## Usage

### Evaluate Manifest Changes

```bash
# Before applying
kubectl recourse diff -f deployment.yaml

# From stdin
cat manifest.yaml | kubectl recourse diff -f -

# Multiple manifests
kubectl recourse diff -f ./manifests/
```

### Evaluate Deletions

```bash
# Check deletion consequences
kubectl recourse delete deployment my-app

# With namespace
kubectl recourse delete pvc data-volume -n production

# StatefulSet deletion
kubectl recourse delete statefulset kafka -n kafka
```

### Check for Risky Configs

```bash
kubectl recourse check -f statefulset.yaml
```

## Risk Levels

| Level | Meaning | Example |
|-------|---------|---------|
| `BLOCK` | Unrecoverable data loss | PVC deletion, Namespace deletion |
| `ESCALATE` | Needs human review | StatefulSet scale-down, CRD deletion |
| `WARN` | Recoverable but notable | Secret deletion, Deployment removal |
| `ALLOW` | Safe to proceed | Config changes, label updates |

## High-Risk Resources

The plugin gives special attention to:

- **PersistentVolumeClaim (PVC)** - Direct data storage
- **PersistentVolume (PV)** - Backing storage
- **StatefulSet** - Stateful workloads with PVCs
- **Namespace** - Cascading deletions
- **CustomResourceDefinition** - Cascading CR deletions
- **Secret/ConfigMap** - May break running workloads

## Example Output

```
RecourseOS Kubernetes Evaluation
══════════════════════════════════════════════════

StatefulSet/postgres (production)
  Action: delete
  Risk:   ESCALATE
  Tier:   needs-review
  Reason: StatefulSet has associated PVCs that may be orphaned

PersistentVolumeClaim/postgres-data-0 (production)
  Action: delete
  Risk:   BLOCK
  Tier:   unrecoverable
  Reason: PersistentVolumeClaim contains persistent data that will be lost

══════════════════════════════════════════════════
✖ BLOCKED: One or more changes would cause unrecoverable data loss
  Review the flagged resources before proceeding.
```

## Flags

| Flag | Description |
|------|-------------|
| `-f, --filename` | Manifest file(s) to evaluate |
| `-n, --namespace` | Target namespace |
| `--json` | Output as JSON |
| `--force` | Proceed despite warnings |

## JSON Output

```bash
kubectl recourse delete pvc my-data --json
```

```json
{
  "results": [
    {
      "resource": "my-data",
      "namespace": "default",
      "kind": "PersistentVolumeClaim",
      "action": "delete",
      "riskLevel": "block",
      "tier": "unrecoverable",
      "reasoning": "PersistentVolumeClaim contains persistent data that will be lost"
    }
  ]
}
```

## CI/CD Integration

### GitHub Actions

```yaml
- name: Check Kubernetes Changes
  run: |
    kubectl recourse diff -f ./k8s/
    if [ $? -ne 0 ]; then
      echo "Blocked by RecourseOS"
      exit 1
    fi
```

### GitLab CI

```yaml
check_k8s:
  script:
    - kubectl recourse diff -f ./manifests/
  allow_failure: false
```

### ArgoCD Pre-Sync Hook

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: recourse-check
  annotations:
    argocd.argoproj.io/hook: PreSync
spec:
  template:
    spec:
      containers:
        - name: recourse
          image: node:18
          command:
            - npx
            - kubectl-recourse
            - diff
            - -f
            - /manifests/
```

## How It Works

1. **Parse Manifests**: Reads YAML/JSON Kubernetes manifests
2. **Fetch Cluster State**: Gets current resource state via kubectl
3. **Compare Changes**: Identifies creates, updates, and deletes
4. **Evaluate Risk**: Applies RecourseOS risk assessment
5. **Report Results**: Outputs colored terminal or JSON report

## Supported Resources

| Resource | Create | Update | Delete |
|----------|--------|--------|--------|
| PVC | ✅ | ✅ (size reduction blocked) | 🛑 BLOCK |
| PV | ✅ | ✅ | 🛑 BLOCK |
| StatefulSet | ✅ | ✅ (VCT changes blocked) | ⚠️ ESCALATE |
| Namespace | ✅ | ✅ | 🛑 BLOCK |
| CRD | ✅ | ✅ | ⚠️ ESCALATE |
| Secret | ✅ | ✅ | ⚡ WARN |
| ConfigMap | ✅ | ✅ | ⚡ WARN |
| Deployment | ✅ | ✅ | ⚡ WARN |
| DaemonSet | ✅ | ✅ | ⚡ WARN |

## License

MIT
