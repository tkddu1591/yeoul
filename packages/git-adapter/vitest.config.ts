import { defineConfig } from 'vitest/config'
// GitClient 통합 테스트는 실제 git 프로세스를 스폰한다 — 워커 경합 시 기본 5초를 넘길 수 있다
export default defineConfig({ test: { include: ['test/**/*.test.ts'], testTimeout: 15_000 } })
