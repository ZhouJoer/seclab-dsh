import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import { standardDecoratorPlugin, vitestExecArgv } from '../../../vitest.shared.ts'
import { COVERAGE_TEST_TIMEOUT_ENV, coverageTestTimeoutOptions } from '../../../scripts/coverage-partitions.ts'

export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['./tsconfig.base.json'], loose: true }), standardDecoratorPlugin()],
  test: {
    include: ['.dsh/flare-context-study/direction-review/*.spec.ts'],
    environment: 'node', pool: 'forks', maxWorkers: 1, fileParallelism: false,
    execArgv: vitestExecArgv, testTimeout: 15000, hookTimeout: 15000,
    ...coverageTestTimeoutOptions(process.env[COVERAGE_TEST_TIMEOUT_ENV]),
  },
})
