import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { getSupportedResourceTypes } from '../src/resources/index.js';
import { renderResourceCoverage } from '../src/tools/generate-resource-coverage.js';

describe('resource coverage documentation', () => {
  it('matches the generated resource registry coverage', () => {
    const expected = renderResourceCoverage(getSupportedResourceTypes());
    const actual = readFileSync('docs/resource-coverage.md', 'utf8');

    expect(actual).toBe(expected);
  });

  it('mentions every deterministic resource type', () => {
    const coverage = readFileSync('docs/resource-coverage.md', 'utf8');

    for (const type of getSupportedResourceTypes()) {
      expect(coverage).toContain(`\`${type}\``);
    }
  });
});
