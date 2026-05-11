import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/*visual.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/types.ts',
        'src/tools/**',
        'src/index.ts',
      ],
      thresholds: {
        // Minimum coverage thresholds (fail CI if below these)
        // Current baseline (May 2026): ~54% lines, ~50% branches
        // These prevent regression; increase targets as coverage improves
        lines: 50,
        functions: 50,
        branches: 45,
        statements: 50,
      },
    },
  },
});
