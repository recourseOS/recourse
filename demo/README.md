# RecourseOS Live Demo: "The Save"

**RecourseOS doesn't just analyze. It saves.**

This demo shows real AWS infrastructure - a production-like application with databases, storage, and services. An agent attempts dangerous operations. RecourseOS intercepts, evaluates, and blocks. You see what *would have been lost* if RecourseOS wasn't there.

The money shot: **"RecourseOS said no, and here's why."**

---

## Quick Start

```bash
# 1. Deploy the WidgetCo app to AWS
cd demo/terraform
terraform init
terraform apply

# 2. Run all demo scenarios
cd ..
./run-all.sh

# 3. View results
ls results/       # JSON consequence reports
ls recordings/    # Terminal recordings (asciinema)

# 4. Clean up
cd terraform
terraform destroy
```

---

## The WidgetCo App

A realistic 3-tier application with intentionally dangerous configurations:

```
┌─────────────────────────────────────────────────────────────┐
│                        WidgetCo App                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   S3        │  │   S3        │  │   S3        │         │
│  │ (versioned) │  │ (uploads)   │  │ (backups)   │         │
│  │  audit-logs │  │  DANGER     │  │  versioned  │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│                                                             │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                      VPC                                ││
│  │  ┌───────────┐  ┌───────────┐  ┌───────────┐          ││
│  │  │  Subnet   │  │  Subnet   │  │  Subnet   │          ││
│  │  │  (public) │  │ (private) │  │ (private) │          ││
│  │  └───────────┘  └───────────┘  └───────────┘          ││
│  │        │              │              │                 ││
│  │  ┌─────┴─────┐  ┌─────┴─────┐  ┌─────┴─────┐          ││
│  │  │   EC2     │  │  Lambda   │  │    RDS    │          ││
│  │  │ (web tier)│  │  (API)    │  │ PostgreSQL│          ││
│  │  └───────────┘  └───────────┘  │  DANGER   │          ││
│  │                                 └───────────┘          ││
│  └─────────────────────────────────────────────────────────┘│
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │  DynamoDB   │  │    KMS      │  │    IAM      │         │
│  │  sessions   │  │  app-key    │  │  app-role   │         │
│  │  NO PITR    │  │  encrypts   │  │  used by    │         │
│  │  DANGER     │  │  everything │  │  Lambda+EC2 │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Dangerous Configurations (intentional)

| Resource | Why It's Dangerous |
|----------|-------------------|
| RDS PostgreSQL | `skip_final_snapshot = true`, `deletion_protection = false`, `backup_retention_period = 0` |
| S3 uploads bucket | No versioning, contains user data |
| DynamoDB sessions | PITR disabled, contains active sessions |
| IAM app-role | Used by Lambda and EC2 (cascade impact) |

### Protected Configurations (for contrast)

| Resource | Protection |
|----------|-----------|
| RDS replica | `deletion_protection = true` |
| S3 audit-logs | Versioning enabled |
| S3 backups | Cross-region replication |

---

## Demo Scenarios

### 1. Delete the Production Database
```bash
./scenarios/01-rds-unprotected.sh
```
**Verdict:** BLOCK / UNRECOVERABLE
- skip_final_snapshot = true
- backup_retention_period = 0
- No manual snapshots detected

**What you almost lost:** All customer data, order history, user accounts

---

### 2. Clean Up Old Uploads
```bash
./scenarios/02-s3-uploads.sh
```
**Verdict:** BLOCK / UNRECOVERABLE
- Versioning: disabled
- Object count: 23,847
- Total size: 4.2GB

**What you almost lost:** All user-uploaded files, profile photos, documents

---

### 3. Delete the Sessions Table
```bash
./scenarios/03-dynamodb-sessions.sh
```
**Verdict:** BLOCK / UNRECOVERABLE
- Point-in-time recovery: disabled
- Item count: 12,384 active sessions
- No AWS Backup recovery points

**What you almost lost:** All active user sessions (mass logout)

---

### 4. Remove Old IAM Role
```bash
./scenarios/04-iam-role-cascade.sh
```
**Verdict:** ESCALATE / RECOVERABLE_WITH_EFFORT
- 3 Lambda functions depend on this role
- 2 EC2 instances use this role
- Deletion will cause immediate service outage

**Cascade impact:** 5 services will fail immediately

---

### 5. Delete the VPC (Cascade Demo)
```bash
./scenarios/05-vpc-cascade.sh
```
**Verdict:** BLOCK / UNRECOVERABLE
- 3 subnets will be destroyed
- 2 EC2 instances will terminate
- 1 NAT gateway will be removed
- 1 RDS instance will be destroyed (UNRECOVERABLE)
- Elastic IP will be released (cannot reclaim)

**Cascade summary:** "3 subnets, 2 EC2, 1 NAT, 1 RDS (max depth: 2)"

---

### 6. Delete the Protected Database (Contrast)
```bash
./scenarios/06-rds-protected.sh
```
**Verdict:** ALLOW / REVERSIBLE
- deletion_protection = true
- AWS will reject the deletion at apply time
- No data at risk

**The lesson:** Protection flags work - RecourseOS recognizes them

---

### 7. Delete the KMS Key (Soft Delete)
```bash
./scenarios/07-kms-key.sh
```
**Verdict:** ESCALATE / RECOVERABLE_WITH_EFFORT
- Deletion window: 7 days (can be cancelled)
- BUT: 3 S3 buckets encrypted with this key
- BUT: 1 RDS instance encrypted with this key

**What you almost lost:** Access to all encrypted data (even with backups)

---

## Output Artifacts

```
demo/
├── plans/           # Pre-generated Terraform plan JSONs
├── results/         # JSON consequence reports
├── recordings/      # asciinema terminal recordings
└── screenshots/     # Static images for docs
```

---

## Estimated AWS Cost

| Resource | Hourly | Daily |
|----------|--------|-------|
| RDS db.t3.micro | $0.017 | $0.41 |
| NAT Gateway | $0.045 | $1.08 |
| EC2 t3.micro (2) | $0.021 | $0.50 |
| S3 + DynamoDB | minimal | ~$0.10 |
| **Total** | ~$0.08 | **~$2/day** |

**Recommended:** Deploy, capture all plans, run all scenarios, destroy. Total cost: < $5.

---

## Recording Demos

To record a scenario with asciinema:

```bash
asciinema rec -c "./scenarios/01-rds-unprotected.sh" recordings/01-rds-unprotected.cast
```

To play back:
```bash
asciinema play recordings/01-rds-unprotected.cast
```
