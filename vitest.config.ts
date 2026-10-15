import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  // tsconfig "jsx": "preserve" taşır (Next SWC için). Vite 8'de oxc kapatılıp
  // esbuild JSX dönüşümü kullanılır; yalnızca test tarafını etkiler.
  oxc: false,
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
})
