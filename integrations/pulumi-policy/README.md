# RecourseOS Pulumi Policy Pack

Policy-as-Code for Pulumi that evaluates infrastructure changes for destructive consequences.

## Installation

```bash
# Clone or copy the policy pack
cd integrations/pulumi-policy
npm install
npm run build

# Enable the policy pack locally
pulumi policy enable recourse-policy --policy-pack ./bin
```

## Policies Included

### 1. recourse-evaluate-destructive (Advisory)

Evaluates high-risk resource changes and warns about risky configurations:

- RDS: `skipFinalSnapshot`, `deletionProtection`, `backupRetentionPeriod`
- S3: `forceDestroy`, `versioning`
- DynamoDB: `deletionProtectionEnabled`, `pointInTimeRecovery`
- EC2: `disableApiTermination`

### 2. recourse-block-unrecoverable (Mandatory)

Blocks stack updates that delete high-risk resources without verification:

- RDS instances/clusters
- S3 buckets
- DynamoDB tables
- EKS/ECS clusters
- Lambda functions

### 3. recourse-require-backups (Advisory)

Requires backup configurations on data resources:

- RDS: `backupRetentionPeriod > 0`
- S3: `versioning.enabled = true`
- DynamoDB: `pointInTimeRecovery.enabled = true`

### 4. recourse-require-deletion-protection (Advisory)

Requires deletion protection on critical resources:

- RDS: `deletionProtection = true`
- DynamoDB: `deletionProtectionEnabled = true`
- EC2: `disableApiTermination = true`

## Usage

### Local Development

```bash
# Run preview with policy checks
pulumi preview --policy-pack ./integrations/pulumi-policy/bin

# Apply with policy enforcement
pulumi up --policy-pack ./integrations/pulumi-policy/bin
```

### Pulumi Cloud

```bash
# Publish to your Pulumi organization
pulumi policy publish recourse-policy

# Enable for a stack
pulumi policy enable <org>/recourse-policy --policy-pack latest
```

### GitHub Actions

```yaml
- name: Install Policy Pack
  run: |
    cd integrations/pulumi-policy
    npm install
    npm run build

- name: Pulumi Preview
  uses: pulumi/actions@v4
  with:
    command: preview
    policy-pack: ./integrations/pulumi-policy/bin
```

## Configuration

### Enforcement Levels

Edit `index.ts` to change enforcement levels:

```typescript
// Change from advisory to mandatory to block deployments
const requireBackupConfig = new policy.ResourceValidationPolicy({
  name: 'recourse-require-backups',
  enforcementLevel: 'mandatory', // 'advisory' | 'mandatory' | 'disabled'
  // ...
});
```

### Adding Resource Types

Add to the `HIGH_RISK_TYPES` set:

```typescript
const HIGH_RISK_TYPES = new Set([
  // ... existing types
  'aws:elasticache/replicationGroup:ReplicationGroup',
  'aws:msk/cluster:Cluster',
]);
```

### Custom Properties

Add to `RISKY_PROPERTIES`:

```typescript
const RISKY_PROPERTIES: Record<string, string[]> = {
  // ... existing
  'aws:elasticache/replicationGroup:ReplicationGroup': [
    'automaticFailoverEnabled',
    'snapshotRetentionLimit',
  ],
};
```

## Example Output

```
Policies:
    ✅ recourse-policy@0.1.0
       - [advisory]  recourse-require-backups
         aws:rds:Instance (prod-database):
         warning: [RecourseOS] RDS instance should have backupRetentionPeriod > 0
       - [mandatory] recourse-block-unrecoverable
         aws:s3:Bucket (user-data):
         error: [RecourseOS] High-risk deletion detected: user-data (aws:s3/bucket:Bucket).
                This deletion may cause unrecoverable data loss.
                Verify backups exist before proceeding.
```

## Supported Resources

| Provider | Resource Type | Checks |
|----------|--------------|--------|
| AWS | RDS Instance | Backups, deletion protection, final snapshot |
| AWS | RDS Cluster | Backups, deletion protection, final snapshot |
| AWS | S3 Bucket | Versioning, force destroy |
| AWS | DynamoDB Table | PITR, deletion protection |
| AWS | EC2 Instance | Termination protection |
| AWS | Lambda Function | (deletion warning) |
| AWS | EKS Cluster | (deletion warning) |
| GCP | SQL Instance | (deletion warning) |
| GCP | Storage Bucket | (deletion warning) |
| Azure | SQL Database | (deletion warning) |
| Azure | Storage Account | (deletion warning) |

## License

MIT
