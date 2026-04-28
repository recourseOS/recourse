#!/usr/bin/env python3
"""
Export the trained decision tree as TypeScript code.
"""

import pandas as pd
import numpy as np
from sklearn.tree import DecisionTreeClassifier
from sklearn.preprocessing import LabelEncoder

# Load and prepare data (same as train_classifier.py)
df = pd.read_csv('src/training/features.csv')

le_resource = LabelEncoder()
df['resource_type_encoded'] = le_resource.fit_transform(df['resource_type'])

le_tier = LabelEncoder()
df['tier_encoded'] = le_tier.fit_transform(df['tier'])

feature_cols = [
    'resource_type_encoded',
    'action_delete', 'action_update', 'action_create', 'action_replace',
    'has_deletion_protection', 'has_backup', 'has_snapshot', 'has_versioning',
    'has_pitr', 'has_retention_period', 'retention_days', 'skip_final_snapshot',
    'deletion_window_days', 'is_empty'
]

X = df[feature_cols].values
y = df['tier_encoded'].values

# Train tree
dt = DecisionTreeClassifier(max_depth=6, random_state=42)
dt.fit(X, y)

# Export as TypeScript
tier_names = ['recoverable-from-backup', 'recoverable-with-effort', 'reversible', 'unrecoverable']

def tree_to_ts(tree, feature_names, class_names, indent=2):
    """Convert sklearn decision tree to TypeScript if-else statements."""
    tree_ = tree.tree_
    feature_name = [
        feature_names[i] if i != -2 else "undefined"
        for i in tree_.feature
    ]

    lines = []

    def recurse(node, depth):
        indent_str = "  " * depth

        if tree_.feature[node] != -2:  # Not a leaf
            name = feature_name[node]
            threshold = tree_.threshold[node]

            # Handle the split
            lines.append(f"{indent_str}if (features.{name} <= {threshold:.2f}) {{")
            recurse(tree_.children_left[node], depth + 1)
            lines.append(f"{indent_str}}} else {{")
            recurse(tree_.children_right[node], depth + 1)
            lines.append(f"{indent_str}}}")
        else:  # Leaf node
            # Get class probabilities
            value = tree_.value[node][0]
            total = sum(value)
            probs = [v/total for v in value]
            predicted_class = np.argmax(value)
            confidence = probs[predicted_class]

            tier = class_names[predicted_class]
            lines.append(f"{indent_str}return {{ tier: '{tier}', confidence: {confidence:.3f} }};")

    recurse(0, indent)
    return "\n".join(lines)

ts_code = tree_to_ts(dt, feature_cols, tier_names)

print("""// Auto-generated from trained decision tree
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
""")
print(ts_code)
print("}")

# Also export resource type mapping
print("\n// Resource type to encoded value mapping")
print("export const RESOURCE_TYPE_ENCODING: Record<string, number> = {")
for rt, enc in zip(le_resource.classes_, range(len(le_resource.classes_))):
    print(f"  '{rt}': {enc},")
print("};")

print("""
// For unknown resource types, return -1
export function encodeResourceType(resourceType: string): number {
  return RESOURCE_TYPE_ENCODING[resourceType] ?? -1;
}
""")
