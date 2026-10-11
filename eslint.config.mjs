// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

const nodeGlobals = {
  __dirname: 'readonly',
  console: 'readonly',
  module: 'writable',
  process: 'readonly',
  require: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
};

export default tseslint.config(
  {
    ignores: [
      'out/**',
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'test/fixtures/**',
    ],
  },
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // A leading underscore marks a parameter kept for its signature
      // (visitor methods, callbacks).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      // The parser recovers by throwing parse errors, not Error objects
      // (no stack to capture).
      '@typescript-eslint/only-throw-error': [
        'error',
        {
          allow: [
            {
              from: 'file',
              name: 'ParseError',
              path: 'src/parser/models/parserError.ts',
            },
            { from: 'file', name: 'IParseError', path: 'src/parser/types.ts' },
          ],
        },
      ],
      // Groups of cases separated by a comment and a blank line.
      'no-fallthrough': ['error', { allowEmptyCase: true }],
    },
  },
  {
    // Script files declaring global helper types.
    files: ['src/utilities/types.ts', 'src/generator/types.ts'],
    languageOptions: { sourceType: 'script' },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { vars: 'local' }],
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: nodeGlobals },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
