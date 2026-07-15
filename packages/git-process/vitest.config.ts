import { defineConfig } from 'vitest/config'
// 프로세스 spawn 테스트는 워커 경합 시 기본 5초를 넘길 수 있다
export default defineConfig({ test: { include: ['test/**/*.test.ts'], testTimeout: 15_000 } })
