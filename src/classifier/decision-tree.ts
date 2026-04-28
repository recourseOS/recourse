// Auto-generated from trained decision tree
// DO NOT EDIT - regenerate with: python src/training/export_tree.py

export type ClassifierTier = 'reversible' | 'recoverable-with-effort' | 'recoverable-from-backup' | 'unrecoverable';

export interface ClassifierResult {
  tier: ClassifierTier;
  confidence: number;
}

export interface ClassifierFeatures {
  resource_type_encoded: number;
  action_delete: number;
  action_update: number;
  action_create: number;
  action_replace: number;
  has_deletion_protection: number;
  has_backup: number;
  has_snapshot: number;
  has_versioning: number;
  has_pitr: number;
  has_retention_period: number;
  retention_days: number;
  skip_final_snapshot: number;
  deletion_window_days: number;
  is_empty: number;
}

export function classifyFromFeatures(features: ClassifierFeatures): ClassifierResult {

    if (features.action_delete <= 0.50) {
      return { tier: 'reversible', confidence: 1.000 };
    } else {
      if (features.resource_type_encoded <= 6.50) {
        if (features.has_snapshot <= 0.50) {
          if (features.has_deletion_protection <= 0.50) {
            if (features.resource_type_encoded <= 0.50) {
              return { tier: 'recoverable-with-effort', confidence: 1.000 };
            } else {
              if (features.has_backup <= 0.50) {
                return { tier: 'unrecoverable', confidence: 0.917 };
              } else {
                return { tier: 'recoverable-from-backup', confidence: 1.000 };
              }
            }
          } else {
            return { tier: 'reversible', confidence: 1.000 };
          }
        } else {
          return { tier: 'recoverable-from-backup', confidence: 1.000 };
        }
      } else {
        if (features.resource_type_encoded <= 15.50) {
          return { tier: 'recoverable-with-effort', confidence: 1.000 };
        } else {
          if (features.resource_type_encoded <= 20.50) {
            if (features.has_versioning <= 0.50) {
              if (features.has_deletion_protection <= 0.50) {
                return { tier: 'unrecoverable', confidence: 0.727 };
              } else {
                return { tier: 'reversible', confidence: 1.000 };
              }
            } else {
              return { tier: 'recoverable-from-backup', confidence: 1.000 };
            }
          } else {
            if (features.is_empty <= -0.50) {
              return { tier: 'recoverable-with-effort', confidence: 1.000 };
            } else {
              if (features.is_empty <= 0.50) {
                return { tier: 'unrecoverable', confidence: 1.000 };
              } else {
                return { tier: 'recoverable-with-effort', confidence: 1.000 };
              }
            }
          }
        }
      }
    }
}

// Resource type to encoded value mapping
export const RESOURCE_TYPE_ENCODING: Record<string, number> = {
  'aws_alb': 0,
  'aws_cloudwatch_log_group': 1,
  'aws_db_instance': 2,
  'aws_dynamodb_table': 3,
  'aws_ebs_snapshot': 4,
  'aws_ebs_volume': 5,
  'aws_eip': 6,
  'aws_iam_policy': 7,
  'aws_iam_role': 8,
  'aws_iam_user': 9,
  'aws_instance': 10,
  'aws_internet_gateway': 11,
  'aws_kms_key': 12,
  'aws_lambda_function': 13,
  'aws_lb': 14,
  'aws_nat_gateway': 15,
  'aws_rds_cluster': 16,
  'aws_route53_record': 17,
  'aws_route53_zone': 18,
  'aws_s3_bucket': 19,
  'aws_s3_object': 20,
  'aws_security_group': 21,
  'aws_sns_topic': 22,
  'aws_sns_topic_subscription': 23,
  'aws_sqs_queue': 24,
  'aws_subnet': 25,
  'aws_vpc': 26,
};

// For unknown resource types, return -1
export function encodeResourceType(resourceType: string): number {
  return RESOURCE_TYPE_ENCODING[resourceType] ?? -1;
}

