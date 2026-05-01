/**
 * BitNet 1-bit Quantized Classifier for Resource Types
 *
 * A small, purpose-built neural network using 1-bit weight quantization.
 * Classifies cloud resource type strings into verification categories.
 *
 * Architecture:
 * - Tokenizer: splits resource types on underscores
 * - Embedding: maps tokens to vectors
 * - 1-bit Linear layers: weights in {-1, 0, +1}
 * - Output: 13 category logits
 */

import type { VerificationCategory } from './categories.js';
import { TRAINING_DATA, type TrainingExample } from './training-data.js';

// All 13 categories in fixed order for classification
const CATEGORIES: VerificationCategory[] = [
  'database-with-snapshots',
  'nosql-database',
  'block-storage',
  'file-storage',
  'object-storage',
  'cache-cluster',
  'search-cluster',
  'streaming-data',
  'message-queue',
  'container-registry',
  'secrets-and-keys',
  'stateful-compute',
  'no-verification-needed',
];

const CATEGORY_TO_INDEX = new Map(CATEGORIES.map((c, i) => [c, i]));
const NUM_CATEGORIES = CATEGORIES.length;

/**
 * Tokenize a resource type string
 * "aws_db_instance" → ["aws", "db", "instance"]
 */
function tokenize(resourceType: string): string[] {
  return resourceType.toLowerCase().split(/[_\-.]+/).filter(t => t.length > 0);
}

/**
 * Build vocabulary from training data
 */
function buildVocabulary(data: TrainingExample[]): Map<string, number> {
  const vocab = new Map<string, number>();
  vocab.set('<PAD>', 0);
  vocab.set('<UNK>', 1);

  for (const example of data) {
    for (const token of tokenize(example.resourceType)) {
      if (!vocab.has(token)) {
        vocab.set(token, vocab.size);
      }
    }
  }
  return vocab;
}

/**
 * Quantize weights to 1-bit: {-1, 0, +1}
 * Uses sign function with threshold for sparsity
 */
function quantize(value: number, threshold: number = 0.1): number {
  if (Math.abs(value) < threshold) return 0;
  return value > 0 ? 1 : -1;
}

/**
 * Softmax activation
 */
function softmax(logits: number[]): number[] {
  const maxLogit = Math.max(...logits);
  const exps = logits.map(l => Math.exp(l - maxLogit));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map(e => e / sum);
}

/**
 * ReLU activation
 */
function relu(x: number): number {
  return Math.max(0, x);
}

/**
 * BitNet classifier model
 */
export interface BitNetModel {
  vocabulary: Map<string, number>;
  embeddings: number[][];        // [vocab_size, embed_dim]
  hiddenWeights: number[][];     // [embed_dim, hidden_dim], quantized
  hiddenBias: number[];          // [hidden_dim]
  outputWeights: number[][];     // [hidden_dim, num_categories], quantized
  outputBias: number[];          // [num_categories]
  config: {
    embedDim: number;
    hiddenDim: number;
    maxTokens: number;
  };
}

/**
 * Forward pass through the BitNet model
 */
function forward(model: BitNetModel, resourceType: string): number[] {
  const tokens = tokenize(resourceType);
  const { vocabulary, embeddings, hiddenWeights, hiddenBias, outputWeights, outputBias, config } = model;

  // Token to embedding (average pooling)
  const pooled = new Array(config.embedDim).fill(0);
  let validTokens = 0;

  for (let i = 0; i < Math.min(tokens.length, config.maxTokens); i++) {
    const token = tokens[i];
    const tokenId = vocabulary.get(token) ?? vocabulary.get('<UNK>')!;
    const embedding = embeddings[tokenId];
    for (let j = 0; j < config.embedDim; j++) {
      pooled[j] += embedding[j];
    }
    validTokens++;
  }

  if (validTokens > 0) {
    for (let j = 0; j < config.embedDim; j++) {
      pooled[j] /= validTokens;
    }
  }

  // Hidden layer (1-bit weights)
  const hidden = new Array(config.hiddenDim).fill(0);
  for (let h = 0; h < config.hiddenDim; h++) {
    let sum = hiddenBias[h];
    for (let e = 0; e < config.embedDim; e++) {
      sum += pooled[e] * hiddenWeights[e][h];
    }
    hidden[h] = relu(sum);
  }

  // Output layer (1-bit weights)
  const logits = new Array(NUM_CATEGORIES).fill(0);
  for (let c = 0; c < NUM_CATEGORIES; c++) {
    let sum = outputBias[c];
    for (let h = 0; h < config.hiddenDim; h++) {
      sum += hidden[h] * outputWeights[h][c];
    }
    logits[c] = sum;
  }

  return logits;
}

/**
 * Initialize random weights
 */
function initWeights(rows: number, cols: number, scale: number = 0.1): number[][] {
  const weights: number[][] = [];
  for (let i = 0; i < rows; i++) {
    const row: number[] = [];
    for (let j = 0; j < cols; j++) {
      row.push((Math.random() - 0.5) * 2 * scale);
    }
    weights.push(row);
  }
  return weights;
}

/**
 * Quantize all weights in a matrix to 1-bit
 */
function quantizeMatrix(matrix: number[][], threshold: number = 0.1): number[][] {
  return matrix.map(row => row.map(v => quantize(v, threshold)));
}

/**
 * Cross-entropy loss
 */
function crossEntropyLoss(predicted: number[], targetIndex: number): number {
  const probs = softmax(predicted);
  return -Math.log(probs[targetIndex] + 1e-10);
}

/**
 * Train the BitNet model
 */
export function trainBitNet(
  data: TrainingExample[],
  config: { embedDim: number; hiddenDim: number; maxTokens: number; epochs: number; learningRate: number }
): BitNetModel {
  const vocabulary = buildVocabulary(data);
  const vocabSize = vocabulary.size;

  // Initialize model with random weights
  let embeddings = initWeights(vocabSize, config.embedDim, 0.5);
  let hiddenWeights = initWeights(config.embedDim, config.hiddenDim, 0.3);
  let hiddenBias = new Array(config.hiddenDim).fill(0);
  let outputWeights = initWeights(config.hiddenDim, NUM_CATEGORIES, 0.3);
  let outputBias = new Array(NUM_CATEGORIES).fill(0);

  // Training loop with SGD
  for (let epoch = 0; epoch < config.epochs; epoch++) {
    let totalLoss = 0;
    const shuffled = [...data].sort(() => Math.random() - 0.5);

    for (const example of shuffled) {
      const tokens = tokenize(example.resourceType);
      const targetIndex = CATEGORY_TO_INDEX.get(example.category)!;

      // Forward pass (with quantized hidden/output weights during training for STE)
      const quantizedHidden = quantizeMatrix(hiddenWeights, 0.05);
      const quantizedOutput = quantizeMatrix(outputWeights, 0.05);

      // Token embeddings (average pooling)
      const pooled = new Array(config.embedDim).fill(0);
      const tokenIds: number[] = [];
      for (let i = 0; i < Math.min(tokens.length, config.maxTokens); i++) {
        const tokenId = vocabulary.get(tokens[i]) ?? vocabulary.get('<UNK>')!;
        tokenIds.push(tokenId);
        for (let j = 0; j < config.embedDim; j++) {
          pooled[j] += embeddings[tokenId][j];
        }
      }
      if (tokenIds.length > 0) {
        for (let j = 0; j < config.embedDim; j++) {
          pooled[j] /= tokenIds.length;
        }
      }

      // Hidden layer
      const hidden = new Array(config.hiddenDim).fill(0);
      const preRelu = new Array(config.hiddenDim).fill(0);
      for (let h = 0; h < config.hiddenDim; h++) {
        let sum = hiddenBias[h];
        for (let e = 0; e < config.embedDim; e++) {
          sum += pooled[e] * quantizedHidden[e][h];
        }
        preRelu[h] = sum;
        hidden[h] = relu(sum);
      }

      // Output layer
      const logits = new Array(NUM_CATEGORIES).fill(0);
      for (let c = 0; c < NUM_CATEGORIES; c++) {
        let sum = outputBias[c];
        for (let h = 0; h < config.hiddenDim; h++) {
          sum += hidden[h] * quantizedOutput[h][c];
        }
        logits[c] = sum;
      }

      // Loss
      const probs = softmax(logits);
      totalLoss += crossEntropyLoss(logits, targetIndex);

      // Backward pass (gradients)
      // Output layer gradients
      const dLogits = [...probs];
      dLogits[targetIndex] -= 1; // softmax + cross-entropy gradient

      // Gradient for output weights (straight-through estimator for quantization)
      for (let h = 0; h < config.hiddenDim; h++) {
        for (let c = 0; c < NUM_CATEGORIES; c++) {
          outputWeights[h][c] -= config.learningRate * hidden[h] * dLogits[c];
        }
      }
      for (let c = 0; c < NUM_CATEGORIES; c++) {
        outputBias[c] -= config.learningRate * dLogits[c];
      }

      // Hidden layer gradients
      const dHidden = new Array(config.hiddenDim).fill(0);
      for (let h = 0; h < config.hiddenDim; h++) {
        for (let c = 0; c < NUM_CATEGORIES; c++) {
          dHidden[h] += quantizedOutput[h][c] * dLogits[c];
        }
        // ReLU gradient
        if (preRelu[h] <= 0) dHidden[h] = 0;
      }

      // Gradient for hidden weights
      for (let e = 0; e < config.embedDim; e++) {
        for (let h = 0; h < config.hiddenDim; h++) {
          hiddenWeights[e][h] -= config.learningRate * pooled[e] * dHidden[h];
        }
      }
      for (let h = 0; h < config.hiddenDim; h++) {
        hiddenBias[h] -= config.learningRate * dHidden[h];
      }

      // Embedding gradients
      const dPooled = new Array(config.embedDim).fill(0);
      for (let e = 0; e < config.embedDim; e++) {
        for (let h = 0; h < config.hiddenDim; h++) {
          dPooled[e] += quantizedHidden[e][h] * dHidden[h];
        }
      }

      for (const tokenId of tokenIds) {
        for (let e = 0; e < config.embedDim; e++) {
          embeddings[tokenId][e] -= config.learningRate * dPooled[e] / tokenIds.length;
        }
      }
    }

    if ((epoch + 1) % 10 === 0) {
      console.log(`Epoch ${epoch + 1}/${config.epochs}, Loss: ${(totalLoss / data.length).toFixed(4)}`);
    }
  }

  // Final quantization of weights
  const finalModel: BitNetModel = {
    vocabulary,
    embeddings, // Keep embeddings full precision
    hiddenWeights: quantizeMatrix(hiddenWeights, 0.05),
    hiddenBias,
    outputWeights: quantizeMatrix(outputWeights, 0.05),
    outputBias,
    config: {
      embedDim: config.embedDim,
      hiddenDim: config.hiddenDim,
      maxTokens: config.maxTokens,
    },
  };

  return finalModel;
}

/**
 * Evaluate model accuracy
 */
export function evaluateBitNet(model: BitNetModel, data: TrainingExample[]): { accuracy: number; perCategory: Record<string, { correct: number; total: number }> } {
  let correct = 0;
  const perCategory: Record<string, { correct: number; total: number }> = {};

  for (const category of CATEGORIES) {
    perCategory[category] = { correct: 0, total: 0 };
  }

  for (const example of data) {
    const logits = forward(model, example.resourceType);
    const predicted = logits.indexOf(Math.max(...logits));
    const actual = CATEGORY_TO_INDEX.get(example.category)!;

    perCategory[example.category].total++;
    if (predicted === actual) {
      correct++;
      perCategory[example.category].correct++;
    }
  }

  return {
    accuracy: correct / data.length,
    perCategory,
  };
}

/**
 * Classify a resource type using the trained model
 */
export function classifyWithBitNet(
  model: BitNetModel,
  resourceType: string
): { category: VerificationCategory; confidence: number; allScores: Record<string, number> } {
  const logits = forward(model, resourceType);
  const probs = softmax(logits);

  const maxIndex = probs.indexOf(Math.max(...probs));
  const category = CATEGORIES[maxIndex];

  const allScores: Record<string, number> = {};
  for (let i = 0; i < CATEGORIES.length; i++) {
    allScores[CATEGORIES[i]] = probs[i];
  }

  return {
    category,
    confidence: probs[maxIndex],
    allScores,
  };
}

/**
 * Serialize model to JSON (for shipping with package)
 */
export function serializeModel(model: BitNetModel): string {
  return JSON.stringify({
    vocabulary: Array.from(model.vocabulary.entries()),
    embeddings: model.embeddings,
    hiddenWeights: model.hiddenWeights,
    hiddenBias: model.hiddenBias,
    outputWeights: model.outputWeights,
    outputBias: model.outputBias,
    config: model.config,
  });
}

/**
 * Deserialize model from JSON
 */
export function deserializeModel(json: string): BitNetModel {
  const data = JSON.parse(json);
  return {
    vocabulary: new Map(data.vocabulary),
    embeddings: data.embeddings,
    hiddenWeights: data.hiddenWeights,
    hiddenBias: data.hiddenBias,
    outputWeights: data.outputWeights,
    outputBias: data.outputBias,
    config: data.config,
  };
}

/**
 * Train and export a model using the built-in training data
 */
export function trainDefaultModel(): BitNetModel {
  return trainBitNet(TRAINING_DATA, {
    embedDim: 32,
    hiddenDim: 64,
    maxTokens: 8,
    epochs: 100,
    learningRate: 0.1,
  });
}

// Pre-trained model weights (generated by running trainDefaultModel())
// This will be populated after training
let cachedModel: BitNetModel | null = null;

/**
 * Get the pre-trained model (lazy load)
 */
export function getPretrainedModel(): BitNetModel {
  if (cachedModel) return cachedModel;

  // Train on first use (in production, we'd ship pre-computed weights)
  console.log('Training BitNet classifier (first use)...');
  cachedModel = trainDefaultModel();
  const { accuracy } = evaluateBitNet(cachedModel, TRAINING_DATA);
  console.log(`BitNet classifier trained. Accuracy: ${(accuracy * 100).toFixed(1)}%`);

  return cachedModel;
}

/**
 * Load pre-trained weights if available
 */
export function loadPretrainedWeights(json: string): void {
  cachedModel = deserializeModel(json);
}
