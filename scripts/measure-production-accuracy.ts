/**
 * Measure production accuracy: BitNet + exact mappings
 *
 * This tests the actual production classifier behavior,
 * not just the raw BitNet model.
 */
import { BitNetResourceClassifier } from '../src/verification/classifier.js';
import { HELD_OUT_TEST_DATA } from '../src/verification/test-data.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const classifier = new BitNetResourceClassifier();

  // Load the model
  const weightsPath = join(__dirname, '..', 'src', 'verification', 'bitnet-weights.json');
  await classifier.loadModelFromFile(weightsPath);

  console.log('=== Production Accuracy (Exact Mappings + BitNet) ===\n');

  let correct = 0;
  let exactMatchCorrect = 0;
  let bitnetCorrect = 0;
  let exactMatchTotal = 0;
  let bitnetTotal = 0;

  interface Failure {
    rt: string;
    actual: string;
    predicted: string;
    source: string;
    confidence: number;
  }
  const failures: Failure[] = [];

  for (const example of HELD_OUT_TEST_DATA) {
    const result = classifier.classify(example.resourceType);
    const isCorrect = result.category === example.category;

    if (isCorrect) {
      correct++;
      if (result.source === 'exact-match') exactMatchCorrect++;
      else bitnetCorrect++;
    } else {
      failures.push({
        rt: example.resourceType,
        actual: example.category,
        predicted: result.category,
        source: result.source,
        confidence: result.confidence
      });
    }

    if (result.source === 'exact-match') exactMatchTotal++;
    else bitnetTotal++;
  }

  const accuracy = (correct / HELD_OUT_TEST_DATA.length * 100).toFixed(1);
  const exactAcc = exactMatchTotal > 0 ? (exactMatchCorrect / exactMatchTotal * 100).toFixed(0) : 'N/A';
  const bitnetAcc = bitnetTotal > 0 ? (bitnetCorrect / bitnetTotal * 100).toFixed(0) : 'N/A';

  console.log(`Total: ${correct}/${HELD_OUT_TEST_DATA.length} = ${accuracy}%`);
  console.log(`  Exact mappings: ${exactMatchCorrect}/${exactMatchTotal} (${exactAcc}%)`);
  console.log(`  BitNet: ${bitnetCorrect}/${bitnetTotal} (${bitnetAcc}%)`);

  console.log(`\nFailures (${failures.length}):`);
  for (const f of failures) {
    console.log(`  ${f.rt}`);
    console.log(`    actual: ${f.actual}, predicted: ${f.predicted} (${(f.confidence * 100).toFixed(0)}%) [${f.source}]`);
  }

  console.log('\n=== Summary ===');
  console.log(`Production accuracy: ${accuracy}%`);
  console.log(`Exact mappings cover: ${exactMatchTotal}/${HELD_OUT_TEST_DATA.length} test cases (${(exactMatchTotal/HELD_OUT_TEST_DATA.length*100).toFixed(0)}%)`);
  console.log(`BitNet handles: ${bitnetTotal}/${HELD_OUT_TEST_DATA.length} test cases (${(bitnetTotal/HELD_OUT_TEST_DATA.length*100).toFixed(0)}%)`);
}

main();
