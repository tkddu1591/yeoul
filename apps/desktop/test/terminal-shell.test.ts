import { tmpdir } from 'node:os'
import { spawn } from 'node-pty'
import { describe, expect, it, vi } from 'vitest'
import { clampPtyDims, resolveShell, TerminalManager } from '../src/main/terminal-manager'

// node-pty의 실제 프리빌드는 그대로 로드한다 — 모듈 최상단 require가 plain vitest에서도
// 성공하는지 함께 검증한다는 원래 의도(Task 1 실측 2)를 유지한다. spawn만 스파이해 실패를
// 결정적으로 재현한다.
// 편차(Task 5 실측): spawn-helper에 실행 권한이 있으면(정상 패키징 상태) posix_spawnp는
// 존재하지 않는 $SHELL에도 더 이상 동기 throw하지 않는다 — spawn-helper 자체는 fork에
// 성공하고, 실제 exec 실패는 자식 프로세스 안에서 일어나 onExit(exitCode!=0)으로만 보고된다
// (실측: node -e 재현, exitCode 1). 원래 테스트는 이 사실을 몰랐던 채로 "OS가 동기 throw
// 해줄 것"을 가정했고, 우리 환경에서 spawn-helper가 실행 권한을 잃어(fix(build) 커밋 참고)
// 우연히 통과하고 있었다 — 근본 원인 수정 후 재현되지 않아 이 스파이로 교체한다. catch 블록의
// "원어 차단 → 읽히는 메시지" 재포장 로직 자체는 이 스파이로도 동일하게, 더 결정적으로 검증된다.
vi.mock('node-pty', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node-pty')>()
  return { ...actual, spawn: vi.fn(actual.spawn) }
})

describe('resolveShell', () => {
  it('$SHELL이 있으면 그대로 쓴다 — 사용자 쉘 존중', () => {
    expect(resolveShell({ SHELL: '/opt/homebrew/bin/fish' })).toBe('/opt/homebrew/bin/fish')
  })

  it('$SHELL이 비어 있으면 macOS 기본 zsh로 폴백한다', () => {
    expect(resolveShell({})).toBe(process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
    expect(resolveShell({ SHELL: '' })).toBe(process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  })

  it('공백뿐인 $SHELL도 폴백한다 (깨진 env 방어)', () => {
    expect(resolveShell({ SHELL: '   ' })).toBe(process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  })
})

describe('clampPtyDims', () => {
  it('0·음수·소수를 pty가 죽지 않는 바닥으로 자른다', () => {
    expect(clampPtyDims(0, 0)).toEqual({ cols: 2, rows: 1 })
    expect(clampPtyDims(120.7, 40.2)).toEqual({ cols: 120, rows: 40 })
  })

  it('정상 값은 그대로다', () => {
    expect(clampPtyDims(80, 24)).toEqual({ cols: 80, rows: 24 })
  })
})

describe('TerminalManager.create', () => {
  it('깨진 $SHELL이면 읽히는 메시지로 거부한다 (posix_spawnp 원어 차단 — 품질 리뷰)', () => {
    vi.mocked(spawn).mockImplementationOnce(() => {
      throw new Error('posix_spawnp failed.')
    })
    const manager = new TerminalManager({ onData() {}, onExit() {} })
    const original = process.env.SHELL
    process.env.SHELL = '/no/such/shell-e7b'
    try {
      expect(() => manager.create(tmpdir())).toThrow(/실행하지 못했어요/)
    } finally {
      if (original === undefined) delete process.env.SHELL
      else process.env.SHELL = original
    }
  })
})
