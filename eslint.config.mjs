import tseslint from 'typescript-eslint'

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    ignores: ['node_modules/**', 'dist/**', 'coverage/**', 'package.json', 'tsconfig.json'],
  },
  {
    rules: {
      'no-undef': 'off',
      'no-require-imports': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'warn',
    },
  }
)