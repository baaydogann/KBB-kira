import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FlatCompat } from '@eslint/eslintrc'

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) })

const SAF_CEKIRDEK_MESAJI = 'src/core saf kalmalı: framework, veritabanı ve I/O importu yasak.'
const PARA_MESAJI = 'Para/oran hesabında kayan nokta yasak; decimal.js (D) kullanın.'

const config = [
  {
    ignores: [
      '.next/**', 'node_modules/**', 'src/generated/**', 'next-env.d.ts',
      '.stryker-tmp/**', 'reports/**', 'test-results/**', 'playwright-report/**', 'var/**',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: { '@typescript-eslint/no-unused-vars': ['warn', { ignoreRestSiblings: true }] },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['@/server/*', '@/app/*', '@/components/*', '@/generated/*', 'next', 'next/*', '@prisma/*', 'node:*', 'react', 'react/*'],
          message: SAF_CEKIRDEK_MESAJI,
        }],
      }],
    },
  },
  {
    files: ['src/core/hesap/**/*.ts', 'src/core/para.ts', 'src/core/hisse.ts', 'src/core/endeks/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error',
        { name: 'Number', message: PARA_MESAJI },
        { name: 'Math', message: PARA_MESAJI },
        { name: 'parseFloat', message: PARA_MESAJI },
        { name: 'parseInt', message: PARA_MESAJI },
      ],
    },
  },
  {
    files: ['src/server/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{ group: ['@/app/*', '@/components/*'], message: 'Servis katmanı UI importu yapamaz.' }],
      }],
    },
  },
]

export default config
