import { writeFile } from 'fs/promises';
import { getSupportedResourceTypes } from '../resources/index.js';

const OUTPUT_PATH = 'docs/resource-coverage.md';

interface ProviderGroup {
  title: string;
  prefix: string;
  servicePatterns: Array<[string, string[]]>;
}

const providerGroups: ProviderGroup[] = [
  {
    title: 'AWS',
    prefix: 'aws_',
    servicePatterns: [
      ['Databases', ['db_', 'rds_', 'dynamodb', 'elasticache', 'neptune']],
      ['Storage and Backups', ['s3_', 'ebs_', 'efs_', 'ami']],
      ['Compute', ['instance', 'lambda']],
      ['Networking', ['vpc', 'subnet', 'security_group', 'eip', 'lb', 'alb', 'nat_gateway', 'internet_gateway', 'route53']],
      ['Identity and Security', ['iam_', 'kms_', 'secretsmanager']],
      ['Messaging and Observability', ['sns_', 'sqs_', 'cloudwatch']],
    ],
  },
  {
    title: 'GCP',
    prefix: 'google_',
    servicePatterns: [
      ['Storage', ['storage']],
      ['Databases', ['sql', 'bigquery']],
      ['Identity and Access', ['iam', 'service_account', 'secret_manager']],
      ['Core Infrastructure', ['dns', 'compute', 'kms', 'container']],
    ],
  },
  {
    title: 'Azure',
    prefix: 'azurerm_',
    servicePatterns: [
      ['Storage', ['storage']],
      ['Databases', ['sql', 'mssql', 'postgresql', 'mysql', 'mariadb', 'cosmosdb']],
      ['Identity and Access', ['role_']],
      ['Core Infrastructure', ['dns', 'disk', 'snapshot', 'key_vault', 'kubernetes']],
    ],
  },
  {
    title: 'Azure AD',
    prefix: 'azuread_',
    servicePatterns: [
      ['Identity and Credentials', ['application', 'service_principal']],
    ],
  },
];

export function renderResourceCoverage(types = getSupportedResourceTypes()): string {
  const sortedTypes = [...types].sort();
  const lines: string[] = [
    '# Resource Coverage',
    '',
    `Total deterministic resource types: ${sortedTypes.length}`,
    '',
    'Known resource handlers are authoritative. Unknown resource types can still be evaluated with `--classifier`, which uses provider-neutral semantic safety signals and returns `needs-review` when evidence is weak.',
    '',
    '```bash',
    'recourse resources',
    'recourse plan plan.json --classifier',
    'recourse evaluate terraform plan.json --classifier',
    '```',
    '',
  ];

  const remaining = new Set(sortedTypes);
  for (const provider of providerGroups) {
    const providerTypes = sortedTypes.filter(type => type.startsWith(provider.prefix));
    for (const type of providerTypes) remaining.delete(type);
    if (!providerTypes.length) continue;

    lines.push(`## ${provider.title}`, '');
    lines.push(`Supported deterministic types: ${providerTypes.length}`, '');

    const grouped = groupByService(providerTypes, provider.servicePatterns);
    for (const [service, serviceTypes] of grouped) {
      lines.push(`### ${service}`, '');
      for (const type of serviceTypes) {
        lines.push(`- \`${type}\``);
      }
      lines.push('');
    }
  }

  if (remaining.size > 0) {
    lines.push('## Other', '');
    for (const type of [...remaining].sort()) {
      lines.push(`- \`${type}\``);
    }
    lines.push('');
  }

  lines.push('## Coverage Notes', '');
  lines.push('- Deterministic rules classify known resource types by explicit safety signals such as deletion protection, versioning, soft delete, snapshots, backup retention, PITR, and credential material.');
  lines.push('- `--classifier` is for unknown or long-tail resources; it builds a provider-neutral semantic profile and does not override deterministic handlers.');
  lines.push('- Low-evidence destructive changes should resolve to `needs-review` rather than being treated as safe.');
  lines.push('- Live cloud state is only available where explicit evidence commands exist; out-of-band backups must be supplied as evidence before Recourse can rely on them.');
  lines.push('');

  return `${lines.join('\n')}`;
}

function groupByService(
  types: string[],
  servicePatterns: Array<[string, string[]]>
): Array<[string, string[]]> {
  const remaining = new Set(types);
  const groups: Array<[string, string[]]> = [];

  for (const [service, patterns] of servicePatterns) {
    const matches = types.filter(type =>
      remaining.has(type) && patterns.some(pattern => type.includes(pattern))
    );
    for (const match of matches) remaining.delete(match);
    if (matches.length) groups.push([service, matches.sort()]);
  }

  if (remaining.size) {
    groups.push(['Other', [...remaining].sort()]);
  }

  return groups;
}

if (process.argv[1]?.endsWith('generate-resource-coverage.js')) {
  await writeFile(OUTPUT_PATH, renderResourceCoverage(), 'utf8');
  console.log(`wrote ${OUTPUT_PATH}`);
}
