const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const importPlugin = require('eslint-plugin-import');
const unusedImports = require('eslint-plugin-unused-imports');
const stylistic = require('@stylistic/eslint-plugin');
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.husky/**', '**/logs/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: globals.node,
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      import: importPlugin,
      'unused-imports': unusedImports,
      '@stylistic': stylistic,
    },
    rules: {
      'no-unused-vars': 'off',
      'import/order': 'off',
      'no-unsafe-finally': 'off',
      'unused-imports/no-unused-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@stylistic/brace-style': ['error', 'stroustrup', { allowSingleLine: true }],
      '@stylistic/indent': ['error', 2],
      '@stylistic/padding-line-between-statements': [
        'error',
        {
          blankLine: 'always',
          prev: 'block-like',
          next: '*',
        },
        {
          blankLine: 'always',
          prev: '*',
          next: 'block-like',
        },
      ],
    },
  },
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
    plugins: {
      import: importPlugin,
      'unused-imports': unusedImports,
    },
    rules: {
      'import/order': 'off',
      'no-unsafe-finally': 'off',
      'unused-imports/no-unused-imports': 'error',
    },
  },
];
