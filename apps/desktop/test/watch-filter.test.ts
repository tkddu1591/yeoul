import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTrailingDebounce, isRelevantGitEvent, isWorkingTreeEvent } from '../src/main/watch-filter'

describe('isRelevantGitEvent', () => {
  it('lock 파일은 무시한다 — status(읽기)조차 index.lock을 만들어 자기 이벤트 루프가 된다 (실측 1)', () => {
    expect(isRelevantGitEvent('index.lock')).toBe(false)
    expect(isRelevantGitEvent('refs/heads/main.lock')).toBe(false)
    expect(isRelevantGitEvent('HEAD.lock')).toBe(false)
  })

  it('objects/·logs/는 무시한다 — HEAD·refs 이벤트가 이미 대변한다', () => {
    expect(isRelevantGitEvent('objects/63/abc')).toBe(false)
    expect(isRelevantGitEvent('logs/HEAD')).toBe(false)
    expect(isRelevantGitEvent('logs/refs/heads/main')).toBe(false)
  })

  it('HEAD·index·packed-refs·refs/**는 수용한다', () => {
    expect(isRelevantGitEvent('HEAD')).toBe(true)
    expect(isRelevantGitEvent('index')).toBe(true)
    expect(isRelevantGitEvent('packed-refs')).toBe(true)
    expect(isRelevantGitEvent('refs/heads/main')).toBe(true)
    expect(isRelevantGitEvent('refs/tags/v1')).toBe(true)
  })

  it('상태 마커(MERGE_HEAD 등 대문자)와 rebase 디렉터리를 수용한다', () => {
    expect(isRelevantGitEvent('MERGE_HEAD')).toBe(true)
    expect(isRelevantGitEvent('CHERRY_PICK_HEAD')).toBe(true)
    expect(isRelevantGitEvent('rebase-merge/msgnum')).toBe(true)
    expect(isRelevantGitEvent('rebase-apply/next')).toBe(true)
    // 소문자 임의 파일은 아니다
    expect(isRelevantGitEvent('config')).toBe(false)
  })

  it('링크드 워크트리 경로(worktrees/<이름>/)는 접두를 벗겨 같은 규칙을 적용한다 (E7c 실측 H2)', () => {
    expect(isRelevantGitEvent('worktrees/wt-feat/HEAD')).toBe(true)
    expect(isRelevantGitEvent('worktrees/wt-feat/index')).toBe(true)
    expect(isRelevantGitEvent('worktrees/wt-feat/rebase-merge/msgnum')).toBe(true)
  })

  it('worktrees/ 아래 lock·logs도 걸러진다', () => {
    expect(isRelevantGitEvent('worktrees/wt-feat/index.lock')).toBe(false)
    expect(isRelevantGitEvent('worktrees/wt-feat/logs/HEAD')).toBe(false)
  })

  it('워크트리 등록 메타 파일(worktrees/<이름>/gitdir 등 소문자)은 무시한다', () => {
    expect(isRelevantGitEvent('worktrees/wt-feat/gitdir')).toBe(false)
    expect(isRelevantGitEvent('worktrees/wt-feat')).toBe(false)
  })

  it('FETCH_HEAD는 무시한다 — 무변화 fetch의 헛갱신 차단, 변화는 refs/remotes/가 잡는다 (E7e 실측 1)', () => {
    expect(isRelevantGitEvent('FETCH_HEAD')).toBe(false)
    expect(isRelevantGitEvent('refs/remotes/origin/main')).toBe(true)
    // 다른 대문자 상태 마커는 그대로 수용
    expect(isRelevantGitEvent('MERGE_HEAD')).toBe(true)
  })
})

describe('createTrailingDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('마지막 hit 후 delay가 지나면 1회 발화한다 — 이벤트 폭주(실측 커밋 18개)를 묶는다', () => {
    const fire = vi.fn()
    const debounce = createTrailingDebounce(300, fire)
    debounce.hit()
    debounce.hit()
    vi.advanceTimersByTime(299)
    expect(fire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fire).toHaveBeenCalledTimes(1)
  })

  it('발화 후 새 hit은 새 사이클이다', () => {
    const fire = vi.fn()
    const debounce = createTrailingDebounce(300, fire)
    debounce.hit()
    vi.advanceTimersByTime(300)
    debounce.hit()
    vi.advanceTimersByTime(300)
    expect(fire).toHaveBeenCalledTimes(2)
  })

  it('dispose하면 대기 중 발화도 취소된다 (저장소 전환·종료 정리)', () => {
    const fire = vi.fn()
    const debounce = createTrailingDebounce(300, fire)
    debounce.hit()
    debounce.dispose()
    vi.advanceTimersByTime(1000)
    expect(fire).not.toHaveBeenCalled()
  })

  it('hit이 계속 와도 maxWaitMs가 지나면 발화한다 — 개발 서버가 파일을 계속 쓰면 트레일링만으로는 굶는다', () => {
    const fire = vi.fn()
    const debounce = createTrailingDebounce(300, fire, 2000)
    for (let elapsed = 0; elapsed < 1900; elapsed += 100) {
      debounce.hit()
      vi.advanceTimersByTime(100)
    }
    expect(fire).not.toHaveBeenCalled()
    debounce.hit()
    vi.advanceTimersByTime(100)
    expect(fire).toHaveBeenCalledTimes(1)
  })

  it('maxWait 발화 후에는 새 사이클이다 — 다음 hit이 즉시 또 터지지 않는다', () => {
    const fire = vi.fn()
    const debounce = createTrailingDebounce(300, fire, 2000)
    for (let elapsed = 0; elapsed <= 2000; elapsed += 100) {
      debounce.hit()
      vi.advanceTimersByTime(100)
    }
    expect(fire).toHaveBeenCalledTimes(1)
    debounce.hit()
    vi.advanceTimersByTime(299)
    expect(fire).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(fire).toHaveBeenCalledTimes(2)
  })

  it('maxWaitMs를 주지 않으면 기존 트레일링 동작 그대로다', () => {
    const fire = vi.fn()
    const debounce = createTrailingDebounce(300, fire)
    for (let elapsed = 0; elapsed < 5000; elapsed += 100) {
      debounce.hit()
      vi.advanceTimersByTime(100)
    }
    expect(fire).not.toHaveBeenCalled()
  })
})

describe('isWorkingTreeEvent', () => {
  it('워킹트리 파일을 받는다', () => {
    expect(isWorkingTreeEvent('src/app.ts')).toBe(true)
    expect(isWorkingTreeEvent('README.md')).toBe(true)
  })

  it('.git 아래는 버린다 — 전용 감시가 이미 본다(중복 발화 방지)', () => {
    expect(isWorkingTreeEvent('.git')).toBe(false)
    expect(isWorkingTreeEvent('.git/index')).toBe(false)
    expect(isWorkingTreeEvent('.git/refs/heads/main')).toBe(false)
  })

  it('.git으로 시작하는 다른 이름은 워킹트리 파일이다', () => {
    expect(isWorkingTreeEvent('.gitignore')).toBe(true)
    expect(isWorkingTreeEvent('.github/workflows/ci.yml')).toBe(true)
  })
})
