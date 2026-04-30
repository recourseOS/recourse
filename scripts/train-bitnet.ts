/**
 * Train BitNet classifier and export weights
 *
 * Run: npx tsx scripts/train-bitnet.ts
 */

import { trainBitNet, evaluateBitNet, serializeModel, classifyWithBitNet } from '../src/verification/bitnet.js';
import { TRAINING_DATA, splitTrainTest, getCategoryDistribution } from '../src/verification/training-data.js';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

console.log('=== BitNet Resource Type Classifier Training ===\n');

// Show training data distribution
console.log('Training data distribution:');
const distribution = getCategoryDistribution();
for (const [category, count] of Object.entries(distribution)) {
  console.log(`  ${category}: ${count}`);
}
console.log(`  Total: ${TRAINING_DATA.length}\n`);

// Split into train/test
const { train, test } = splitTrainTest(TRAINING_DATA, 0.2);
console.log(`Train set: ${train.length}, Test set: ${test.length}\n`);

// Train the model
console.log('Training...');
const model = trainBitNet(TRAINING_DATA, {
  embedDim: 32,
  hiddenDim: 64,
  maxTokens: 8,
  epochs: 100,
  learningRate: 0.1,
});

// Evaluate on full dataset
console.log('\n=== Evaluation ===\n');
const { accuracy, perCategory } = evaluateBitNet(model, TRAINING_DATA);
console.log(`Overall accuracy: ${(accuracy * 100).toFixed(1)}%\n`);

console.log('Per-category accuracy:');
for (const [category, stats] of Object.entries(perCategory)) {
  const acc = stats.total > 0 ? (stats.correct / stats.total * 100).toFixed(0) : 'N/A';
  console.log(`  ${category}: ${stats.correct}/${stats.total} (${acc}%)`);
}

// Test on some examples
console.log('\n=== Sample Predictions ===\n');
const testCases = [
  // AWS
  'aws_db_instance',
  'aws_s3_bucket',
  'aws_eks_cluster',
  'aws_lambda_function',
  // GCP
  'google_sql_database_instance',
  'google_storage_bucket',
  'google_container_cluster',
  'google_compute_instance',
  // Azure
  'azurerm_postgresql_server',
  'azurerm_storage_account',
  'azurerm_kubernetes_cluster',
  'azurerm_virtual_machine',
  // OCI
  'oci_database_db_system',
  'oci_objectstorage_bucket',
  'oci_containerengine_cluster',
  'oci_core_instance',
  // Unknown (test generalization)
  'aws_rds_proxy',
  'google_compute_disk',
  'azurerm_redis_cache',
  'oci_vault_secret',
];

for (const resourceType of testCases) {
  const result = classifyWithBitNet(model, resourceType);
  console.log(`${resourceType}`);
  console.log(`  → ${result.category} (${(result.confidence * 100).toFixed(1)}%)\n`);
}

// Export model weights
const modelJson = serializeModel(model);
const outputPath = join(__dirname, '..', 'src', 'verification', 'bitnet-weights.json');
writeFileSync(outputPath, modelJson);
console.log(`\nModel weights exported to: ${outputPath}`);
console.log(`Model size: ${(modelJson.length / 1024).toFixed(1)} KB`);
