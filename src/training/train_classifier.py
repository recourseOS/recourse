#!/usr/bin/env python3
"""
Train a simple classifier to validate that recoverability patterns are learnable.
"""

import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.ensemble import RandomForestClassifier
from sklearn.tree import DecisionTreeClassifier, export_text
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import classification_report, confusion_matrix
import warnings
warnings.filterwarnings('ignore')

# Load the feature data
df = pd.read_csv('src/training/features.csv')

print(f"Loaded {len(df)} examples")
print(f"\nTier distribution:")
print(df['tier'].value_counts())

# Encode resource types
le_resource = LabelEncoder()
df['resource_type_encoded'] = le_resource.fit_transform(df['resource_type'])

# Encode tiers
le_tier = LabelEncoder()
df['tier_encoded'] = le_tier.fit_transform(df['tier'])

print(f"\nTier encoding: {dict(zip(le_tier.classes_, range(len(le_tier.classes_))))}")

# Features to use
feature_cols = [
    'resource_type_encoded',
    'action_delete', 'action_update', 'action_create', 'action_replace',
    'has_deletion_protection', 'has_backup', 'has_snapshot', 'has_versioning',
    'has_pitr', 'has_retention_period', 'retention_days', 'skip_final_snapshot',
    'deletion_window_days', 'is_empty'
]

X = df[feature_cols].values
y = df['tier_encoded'].values

# Split data
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)

print(f"\nTraining set: {len(X_train)} examples")
print(f"Test set: {len(X_test)} examples")

# =============================================================================
# Decision Tree (interpretable)
# =============================================================================
print("\n" + "="*60)
print("DECISION TREE")
print("="*60)

dt = DecisionTreeClassifier(max_depth=6, random_state=42)
dt.fit(X_train, y_train)

# Cross-validation
cv_scores = cross_val_score(dt, X, y, cv=5)
print(f"\nCross-validation accuracy: {cv_scores.mean():.3f} (+/- {cv_scores.std()*2:.3f})")

# Test accuracy
y_pred = dt.predict(X_test)
print(f"Test accuracy: {(y_pred == y_test).mean():.3f}")

print(f"\nClassification report:")
print(classification_report(y_test, y_pred, target_names=le_tier.classes_))

# Feature importance
print(f"\nFeature importance:")
importances = list(zip(feature_cols, dt.feature_importances_))
importances.sort(key=lambda x: x[1], reverse=True)
for feat, imp in importances[:10]:
    if imp > 0:
        print(f"  {feat}: {imp:.3f}")

# Print the decision tree rules
print(f"\nDecision tree rules (simplified):")
tree_rules = export_text(dt, feature_names=feature_cols, max_depth=4)
print(tree_rules[:2000])

# =============================================================================
# Random Forest (better generalization)
# =============================================================================
print("\n" + "="*60)
print("RANDOM FOREST")
print("="*60)

rf = RandomForestClassifier(n_estimators=100, max_depth=6, random_state=42)
rf.fit(X_train, y_train)

# Cross-validation
cv_scores = cross_val_score(rf, X, y, cv=5)
print(f"\nCross-validation accuracy: {cv_scores.mean():.3f} (+/- {cv_scores.std()*2:.3f})")

# Test accuracy
y_pred = rf.predict(X_test)
print(f"Test accuracy: {(y_pred == y_test).mean():.3f}")

print(f"\nClassification report:")
print(classification_report(y_test, y_pred, target_names=le_tier.classes_))

# Feature importance
print(f"\nFeature importance:")
importances = list(zip(feature_cols, rf.feature_importances_))
importances.sort(key=lambda x: x[1], reverse=True)
for feat, imp in importances[:10]:
    if imp > 0:
        print(f"  {feat}: {imp:.3f}")

# =============================================================================
# Test on specific examples
# =============================================================================
print("\n" + "="*60)
print("MANUAL TESTS")
print("="*60)

def predict_example(resource_type, action, **attrs):
    """Predict tier for a new example"""
    # Encode resource type
    if resource_type in le_resource.classes_:
        rt_enc = le_resource.transform([resource_type])[0]
    else:
        rt_enc = -1  # Unknown resource type

    features = [
        rt_enc,
        1 if action == 'delete' else 0,
        1 if action == 'update' else 0,
        1 if action == 'create' else 0,
        1 if action == 'replace' else 0,
        attrs.get('has_deletion_protection', -1),
        attrs.get('has_backup', -1),
        attrs.get('has_snapshot', -1),
        attrs.get('has_versioning', -1),
        attrs.get('has_pitr', -1),
        attrs.get('has_retention_period', -1),
        attrs.get('retention_days', -1),
        attrs.get('skip_final_snapshot', -1),
        attrs.get('deletion_window_days', -1),
        attrs.get('is_empty', -1),
    ]

    pred = rf.predict([features])[0]
    proba = rf.predict_proba([features])[0]
    tier = le_tier.inverse_transform([pred])[0]

    return tier, dict(zip(le_tier.classes_, proba))

# Test known patterns
print("\nKnown patterns:")
print("-" * 40)

tier, proba = predict_example('aws_s3_bucket', 'delete', is_empty=0)
print(f"S3 bucket delete (not empty): {tier}")
print(f"  Probabilities: {proba}")

tier, proba = predict_example('aws_s3_bucket', 'delete', is_empty=1)
print(f"S3 bucket delete (empty): {tier}")
print(f"  Probabilities: {proba}")

tier, proba = predict_example('aws_db_instance', 'delete', has_deletion_protection=1)
print(f"RDS delete (deletion_protection=true): {tier}")
print(f"  Probabilities: {proba}")

tier, proba = predict_example('aws_db_instance', 'delete', skip_final_snapshot=1, has_backup=0)
print(f"RDS delete (skip_snapshot=true, no backup): {tier}")
print(f"  Probabilities: {proba}")

tier, proba = predict_example('aws_s3_object', 'delete', has_versioning=1)
print(f"S3 object delete (versioning=true): {tier}")
print(f"  Probabilities: {proba}")

# Test UNKNOWN resource types - can it generalize?
print("\n" + "-" * 40)
print("Unknown resource types (generalization test):")
print("-" * 40)

tier, proba = predict_example('aws_elasticache_cluster', 'delete', has_snapshot=1)
print(f"ElastiCache delete (has_snapshot=true): {tier}")
print(f"  Probabilities: {proba}")

tier, proba = predict_example('aws_elasticache_cluster', 'delete', has_snapshot=0)
print(f"ElastiCache delete (has_snapshot=false): {tier}")
print(f"  Probabilities: {proba}")

tier, proba = predict_example('aws_redshift_cluster', 'delete', has_deletion_protection=1)
print(f"Redshift delete (deletion_protection=true): {tier}")
print(f"  Probabilities: {proba}")

tier, proba = predict_example('aws_redshift_cluster', 'delete', skip_final_snapshot=1, has_backup=0)
print(f"Redshift delete (skip_snapshot=true, no backup): {tier}")
print(f"  Probabilities: {proba}")

tier, proba = predict_example('aws_documentdb_cluster', 'delete', has_pitr=1)
print(f"DocumentDB delete (PITR=true): {tier}")
print(f"  Probabilities: {proba}")

tier, proba = predict_example('aws_msk_cluster', 'update')
print(f"MSK update: {tier}")
print(f"  Probabilities: {proba}")

print("\n" + "="*60)
print("CONCLUSION")
print("="*60)
print("""
If the classifier achieves high accuracy on known patterns AND
generalizes reasonably to unknown resource types based on their
safety attributes, then the approach is validated.

Next step: Generate more training data and try BitNet for efficient
inference that can ship with the CLI.
""")
