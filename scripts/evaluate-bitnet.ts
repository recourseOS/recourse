/**
 * Evaluate BitNet classifier against held-out test set
 *
 * Run: npx tsx scripts/evaluate-bitnet.ts
 */

import {
  trainBitNet,
  evaluateBitNet,
  classifyWithBitNet,
  serializeModel,
  type BitNetModel,
} from '../src/verification/bitnet.js';
import { TRAINING_DATA } from '../src/verification/training-data.js';
import { HELD_OUT_TEST_DATA, getTestDistribution } from '../src/verification/test-data.js';
import { DecisionTreeClassifier } from '../src/verification/classifier.js';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

console.log('=== BitNet Classifier Evaluation ===\n');

// Show test data distribution
console.log('Held-out test data distribution:');
const distribution = getTestDistribution();
for (const [category, count] of Object.entries(distribution)) {
  console.log(`  ${category}: ${count}`);
}
console.log(`  Total: ${HELD_OUT_TEST_DATA.length}\n`);

// Train model on training data only
console.log('Training model on training data only...');
const model = trainBitNet(TRAINING_DATA, {
  embedDim: 32,
  hiddenDim: 64,
  maxTokens: 8,
  epochs: 100,
  learningRate: 0.1,
});

// Initialize decision tree for comparison
const decisionTree = new DecisionTreeClassifier();

// ============================================
// 1. Evaluate on held-out test set
// ============================================
console.log('\n=== Held-Out Test Set Evaluation ===\n');

interface Prediction {
  resourceType: string;
  actual: string;
  predicted: string;
  confidence: number;
  correct: boolean;
  notes?: string;
}

const predictions: Prediction[] = [];
let correct = 0;
const perCategory: Record<string, { correct: number; total: number }> = {};

for (const example of HELD_OUT_TEST_DATA) {
  const result = classifyWithBitNet(model, example.resourceType);
  const isCorrect = result.category === example.category;

  if (isCorrect) correct++;

  if (!perCategory[example.category]) {
    perCategory[example.category] = { correct: 0, total: 0 };
  }
  perCategory[example.category].total++;
  if (isCorrect) perCategory[example.category].correct++;

  predictions.push({
    resourceType: example.resourceType,
    actual: example.category,
    predicted: result.category,
    confidence: result.confidence,
    correct: isCorrect,
    notes: example.notes,
  });
}

const accuracy = correct / HELD_OUT_TEST_DATA.length;
console.log(`Overall accuracy: ${(accuracy * 100).toFixed(1)}% (${correct}/${HELD_OUT_TEST_DATA.length})\n`);

console.log('Per-category accuracy:');
for (const [category, stats] of Object.entries(perCategory).sort((a, b) => a[0].localeCompare(b[0]))) {
  const acc = stats.total > 0 ? (stats.correct / stats.total * 100).toFixed(0) : 'N/A';
  console.log(`  ${category}: ${stats.correct}/${stats.total} (${acc}%)`);
}

// ============================================
// 2. Show wrong predictions
// ============================================
console.log('\n=== Wrong Predictions ===\n');

const wrongPredictions = predictions.filter(p => !p.correct);
if (wrongPredictions.length === 0) {
  console.log('No wrong predictions!');
} else {
  for (const pred of wrongPredictions) {
    console.log(`${pred.resourceType}`);
    console.log(`  Actual: ${pred.actual}`);
    console.log(`  Predicted: ${pred.predicted} (${(pred.confidence * 100).toFixed(1)}%)`);
    if (pred.notes) console.log(`  Notes: ${pred.notes}`);
    console.log();
  }
}

// ============================================
// 3. Confidence calibration
// ============================================
console.log('\n=== Confidence Calibration ===\n');

const bins: Record<string, { correct: number; total: number }> = {
  '0.5-0.6': { correct: 0, total: 0 },
  '0.6-0.7': { correct: 0, total: 0 },
  '0.7-0.8': { correct: 0, total: 0 },
  '0.8-0.9': { correct: 0, total: 0 },
  '0.9-1.0': { correct: 0, total: 0 },
};

for (const pred of predictions) {
  let bin: string;
  if (pred.confidence < 0.6) bin = '0.5-0.6';
  else if (pred.confidence < 0.7) bin = '0.6-0.7';
  else if (pred.confidence < 0.8) bin = '0.7-0.8';
  else if (pred.confidence < 0.9) bin = '0.8-0.9';
  else bin = '0.9-1.0';

  bins[bin].total++;
  if (pred.correct) bins[bin].correct++;
}

console.log('Confidence bin → Actual accuracy:');
for (const [bin, stats] of Object.entries(bins)) {
  if (stats.total === 0) continue;
  const actualAcc = (stats.correct / stats.total * 100).toFixed(0);
  const expectedAcc = bin.split('-').map(Number).reduce((a, b) => (a + b) / 2, 0) * 100;
  const calibration = Math.abs(parseFloat(actualAcc) - expectedAcc * 2);
  console.log(`  ${bin}: ${stats.correct}/${stats.total} = ${actualAcc}% (expected ~${(expectedAcc * 2).toFixed(0)}%)`);
}

// ============================================
// 4. Disagreements with decision tree
// ============================================
console.log('\n=== BitNet vs Decision Tree Disagreements ===\n');

let agreements = 0;
const disagreements: Array<{
  resourceType: string;
  bitnet: { category: string; confidence: number };
  decisionTree: { category: string; confidence: number };
  actual: string;
  bitnetCorrect: boolean;
  dtCorrect: boolean;
}> = [];

for (const example of HELD_OUT_TEST_DATA) {
  const bitnetResult = classifyWithBitNet(model, example.resourceType);
  const dtResult = decisionTree.classify(example.resourceType);

  if (bitnetResult.category === dtResult.category) {
    agreements++;
  } else {
    disagreements.push({
      resourceType: example.resourceType,
      bitnet: { category: bitnetResult.category, confidence: bitnetResult.confidence },
      decisionTree: { category: dtResult.category, confidence: dtResult.confidence },
      actual: example.category,
      bitnetCorrect: bitnetResult.category === example.category,
      dtCorrect: dtResult.category === example.category,
    });
  }
}

console.log(`Agreements: ${agreements}/${HELD_OUT_TEST_DATA.length} (${(agreements / HELD_OUT_TEST_DATA.length * 100).toFixed(1)}%)`);
console.log(`Disagreements: ${disagreements.length}\n`);

if (disagreements.length > 0) {
  console.log('Disagreement details:');
  for (const d of disagreements) {
    const bitnetMark = d.bitnetCorrect ? '✓' : '✗';
    const dtMark = d.dtCorrect ? '✓' : '✗';
    console.log(`\n${d.resourceType}`);
    console.log(`  Actual: ${d.actual}`);
    console.log(`  BitNet: ${d.bitnet.category} (${(d.bitnet.confidence * 100).toFixed(0)}%) ${bitnetMark}`);
    console.log(`  DecisionTree: ${d.decisionTree.category} (${(d.decisionTree.confidence * 100).toFixed(0)}%) ${dtMark}`);
  }

  // Summary of who wins
  const bitnetWins = disagreements.filter(d => d.bitnetCorrect && !d.dtCorrect).length;
  const dtWins = disagreements.filter(d => !d.bitnetCorrect && d.dtCorrect).length;
  const bothWrong = disagreements.filter(d => !d.bitnetCorrect && !d.dtCorrect).length;
  const bothRight = disagreements.filter(d => d.bitnetCorrect && d.dtCorrect).length;

  console.log('\nDisagreement outcomes:');
  console.log(`  BitNet correct, DT wrong: ${bitnetWins}`);
  console.log(`  DT correct, BitNet wrong: ${dtWins}`);
  console.log(`  Both wrong: ${bothWrong}`);
  console.log(`  Both right (different answers): ${bothRight}`);
}

// ============================================
// 5. Export model if accuracy is good enough
// ============================================
if (accuracy >= 0.8) {
  console.log('\n=== Exporting Model ===\n');

  const modelJson = serializeModel(model);
  const outputPath = join(__dirname, '..', 'src', 'verification', 'bitnet-weights.json');
  writeFileSync(outputPath, modelJson);
  console.log(`Model exported to: ${outputPath}`);
  console.log(`Model size: ${(modelJson.length / 1024).toFixed(1)} KB`);
} else {
  console.log('\n⚠️  Accuracy below 80%, model not exported for production use.');
  console.log('Consider adding more training data or adjusting model architecture.');
}

// ============================================
// 6. Summary
// ============================================
console.log('\n=== Summary ===\n');
console.log(`Held-out test accuracy: ${(accuracy * 100).toFixed(1)}%`);
console.log(`Classifier agreement rate: ${(agreements / HELD_OUT_TEST_DATA.length * 100).toFixed(1)}%`);
console.log(`Wrong predictions: ${wrongPredictions.length}`);

if (accuracy >= 0.9) {
  console.log('\n✓ Model ready for production promotion.');
} else if (accuracy >= 0.8) {
  console.log('\n⚡ Model ready for advisory mode (run alongside decision tree).');
} else {
  console.log('\n⚠️  Model needs more training data before deployment.');
}
