# Depth Advantage Strategy

RecourseOS competes on **consequence depth**, not gateway breadth. While competitors like hoop.dev offer shallow pattern matching ("block `rm -rf`"), RecourseOS explains *why* an action is dangerous, *what* the blast radius is, and provides *cryptographic proof* of the evaluation.

---

## Focus Areas

### 1. Consequence Reasoning Quality
**Current:** "Bucket deletion is destructive"
**Target:** "Bucket contains 47GB across 12,000 objects, last modified 2 hours ago, no cross-region replication, deletion is UNRECOVERABLE"

- Pull live AWS state, not just Terraform state
- Surface concrete metrics (object count, last modified, size)
- Show what's actually at risk, not just that something is at risk

### 2. Cascade Analysis
**Current:** Single-resource evaluation
**Target:** Full dependency graph with downstream impact

- "Deleting this VPC affects 3 subnets, 2 NAT gateways, 14 EC2 instances, 1 RDS cluster"
- Visualize blast radius as a graph
- Identify hidden dependencies (security group → ENI → Lambda)

### 3. Verification Suggestions
**Current:** Generic suggestions
**Target:** Copy-paste commands with expected output patterns

- "Run `aws s3api list-objects-v2 --bucket X --query 'length(Contents)'` to confirm object count"
- Include expected output patterns for re-evaluation
- Feedback loop: gather evidence → re-evaluate → updated verdict

### 4. Attestation Richness ← START HERE
**Current:** Signed input/output pair
**Target:** Full reasoning chain, independently verifiable

- Include intermediate evaluation steps in attestation
- Embed evidence gathered during evaluation
- Support third-party verification without RecourseOS access
- Machine-readable reasoning trace

### 5. Cross-Action Analysis
**Current:** Evaluate each change independently
**Target:** Detect interactions between changes

- "Deleting security group while EC2 still references it → failure"
- "Replacing RDS instance while app still points to old endpoint → outage"
- Temporal dependencies and ordering requirements

---

## Competitive Positioning

| Capability | Hoop.dev | RecourseOS |
|------------|----------|------------|
| Pattern matching | `rm -rf` → block | ✓ |
| Consequence depth | ✗ | Full blast radius |
| Recoverability tiers | Binary | 4-tier + reasoning |
| Attestation | Audit logs | Cryptographic proof chain |
| Evidence verification | ✗ | Re-evaluate with evidence |
| Cascade analysis | ✗ | Dependency graph |

---

## Implementation Order

1. **Attestation Richness** — cryptographic proof of full reasoning chain
2. **Consequence Reasoning** — live state, concrete metrics
3. **Cascade Analysis** — dependency graph visualization
4. **Verification Loop** — evidence gathering and re-evaluation
5. **Cross-Action** — multi-change interaction detection

---

## Success Metrics

- Attestation includes full reasoning trace (not just verdict)
- Third party can verify attestation without RecourseOS access
- Consequence reports include live state metrics
- Cascade impact shows affected resource count and types
- Verification suggestions are copy-paste ready with expected outputs
