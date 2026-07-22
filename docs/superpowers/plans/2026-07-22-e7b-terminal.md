# E7b — 내장 터미널 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) 구문으로 추적한다.

**Goal:** 중앙+우측 하단 도크의 세션형 터미널(탭 여러 개, node-pty+xterm) + `.git` fs watch 상시 상태 동기화 — 스펙 `docs/superpowers/specs/2026-07-22-e7b-terminal-design.md` 확정안.

**Architecture:** pty·감시는 main 소유(스펙: 위험 리소스 main 전용), renderer는 세션 id·바이트 스트림만. 이 앱 최초의 push IPC(`terminal:data`·`terminal:exit`·`repo:changed`)를 도입하되 **window 배선 없이 invoke의 `event.sender`로 응답 대상 webContents를 잡는다**(실측·설계 확정 — createWindow 구조 무변). 도크는 기존 4트랙 그리드에 **2번째 행**을 추가(도크 `grid-column: 2 / 5`, 좌측 열 `grid-row: 1 / 3`)해 좌측 관리 존은 전체 높이를 유지한다. 도크 높이·열림은 settings.json 영속(rightWidth 관례).

**Tech Stack:** 기존 + `node-pty@^1.1.0`(main, 프리빌드 — 실측 2) + `@xterm/xterm`·`@xterm/addon-fit`(renderer).

**기준 커밋:** main = `9bb609d`. 기준선 실측: 단위 **392 tests**(29 files), E2E **52**(smoke 46 + hosting 6). 작업 브랜치: **`feature/e7b-terminal`** (Task 1 Step 0에서 생성).

## 사전 실측 기록 (2026-07-22, macOS Darwin 25.5.0 · Electron 35.7.5 · node-pty 1.1.0 · git 2.50.1)

### 실측 1. fs.watch(recursive) — .git 이벤트 패턴과 두 함정

스크래치 저장소에서 `fs.watch('<repo>/.git', { recursive: true })`로 git 명령별 이벤트를 계수했다(경로는 .git 상대, 타입은 rename/change):

| 명령 | 이벤트 수 | 대표 경로 |
| --- | --- | --- |
| commit | 18 | index.lock·index·HEAD.lock·refs/heads/main(.lock)·logs/*·objects/*·COMMIT_EDITMSG |
| checkout | 12 | index(.lock)·HEAD(.lock)·logs/HEAD·packed-refs.lock |
| branch 생성 | 3 | refs/heads/side(.lock)·logs/refs/heads/side |
| tag | 2 | refs/tags/v1(.lock) |
| **status(읽기 전용)** | **1** | **index.lock** |

- **함정 ①(루프):** 읽기 전용인 `git status`조차 `index.lock` 이벤트를 만든다 — 우리 스냅샷 조회(포치레인 status)가 자기 이벤트를 낳아 **무한 새로고침 루프**가 된다. → `*.lock` 필터 필수. 또한 status가 stat 캐시를 갱신하며 `index`를 실제로 다시 쓸 수 있다(기회적 갱신) — busy 중 드롭 + 억제 창(아래)이 잔여를 흡수한다.
- **함정 ②(이중 갱신):** 앱 자신의 작업도 busy 중에 이벤트를 쏟아낸다. 스펙 초안의 "busy 중 pending → 해제 시 1회 갱신"대로면 **모든 앱 작업이 이중 갱신**된다. → **스펙 보정: busy 중 이벤트는 드롭**(guard의 재진입 거부가 그대로 드롭이 된다) + **작업 종료 후 800ms 억제 창**(디바운스 300ms 꼬리 이벤트 흡수). 억제 창에 걸린 진짜 외부 변경은 다음 이벤트·수동 새로고침이 회수한다(희귀 경합 수용).
- 필터 설계: `*.lock`·`objects/`·`logs/` 제외, `HEAD`·`index`·`packed-refs`·`refs/**`·대문자 상태 마커(MERGE_HEAD 등)·`rebase-merge/`·`rebase-apply/` 수용.

### 실측 2. node-pty × Electron 35 — 재빌드 불필요 (프리빌드)

스크래치 npm 프로젝트(electron 35.7.5 + node-pty 1.1.0)에서:

- `node-pty@1.1.0`은 **`prebuilds/darwin-arm64`(+x64·win32)를 동봉** — 설치 시 node-gyp 컴파일 없음(`build/` 미생성), Electron 35(ABI `NODE_MODULE_VERSION 133`)에서 **@electron/rebuild 없이 require 성공**.
- **숨김 창(show: false — 이 저장소의 E2E 관례) main에서 zsh 스폰 → `echo hello-pty-roundtrip` 왕복 → 실제 프롬프트+에코 출력 수신 → `resize(120,40)` 무크래시** 전부 성공(run4 로그).
- 주의: 창 생성 전/특수 환경 변형에서 `posix_spawnp failed`가 관측됐다(run1) — **spawn은 app.whenReady 이후에만** 한다(우리 설계는 renderer 요청 기반이라 자동 충족).
- electron-vite: main의 `externalizeDepsPlugin`이 node-pty를 자동 외부화한다(설정 무변). pnpm 10은 의존성 빌드 스크립트를 기본 차단한다 — 프리빌드라 빌드 불필요지만, `pnpm install`이 ignored build scripts 경고를 내면 루트 package.json에 `"pnpm": { "onlyBuiltDependencies": ["node-pty"] }`를 추가하고 재설치한다(Task 1 Step 1에 조건 단계로 명시).

### 실측 3. 기존 구조 사실 (코드 실독)

- **push IPC 전무** — `ipcRenderer.on`/`webContents.send` 사용처 0. preload는 전부 invoke(+settings sendSync). 터미널·감시가 최초의 push 채널이다. invoke 핸들러의 `event.sender`가 응답 대상 webContents다 — **createWindow에서 window를 밖으로 빼는 재구조 불필요**.
- **before-quit 훅 부재** — pty 정리를 위해 신설한다.
- 설정 영속: `AppSettings`(ipc-contract) + `sanitizeSettings` + main `settings.ts`(userData/settings.json) + preload `settingsApi`(초기값 sendSync). rightWidth가 선례 — 도크 필드도 같은 길.
- 레이아웃: `app__main`은 4트랙 그리드(left/1fr/6px/right), 열 폭은 App inline style(computeColumns — `MAIN_CHROME=94`는 **열** 산식이라 행 추가와 무관). 도크는 행 추가로 해결: 좌측 `grid-row: 1 / 3`, 도크 `grid-column: 2 / 5`.
- vitest 프로젝트명 = 패키지명(`@git-gui/desktop` 등). smoke 마지막 테스트는 `'실험 공간 탭 — 원격 공간을 내 공간으로 가져온다(추적 checkout) (E7a)'`(파일 끝 앵커).

## 파일 구조 (책임 지도)

| 파일 | 책임 |
| --- | --- |
| `apps/desktop/package.json` (수정) | node-pty·@xterm/* 의존성 |
| `apps/desktop/src/main/terminal-manager.ts` (신규) | pty 세션 수명(생성·입출력·resize·kill·전체 정리)·쉘 결정 — 이벤트는 콜백 주입 |
| `apps/desktop/src/main/terminal-handlers.ts` (신규) | 터미널 IPC 등록(event.sender 기반 push)·before-quit 정리 |
| `apps/desktop/src/main/watch-filter.ts` (신규) | .git 이벤트 필터·트레일링 디바운스 — 순수 로직 |
| `apps/desktop/src/main/repo-watcher.ts` (신규) | fs.watch 수명 + repo:changed push (event.sender 기반) |
| `apps/desktop/test/watch-filter.test.ts` (신규) | 필터·디바운스 단위 |
| `apps/desktop/test/terminal-shell.test.ts` (신규) | resolveShell 단위 |
| `packages/ipc-contract/src/index.ts` (수정) | repo.watch/onChanged·TerminalApi·TERMINAL_CHANNELS·AppSettings 도크 필드 |
| `packages/ipc-contract/test/settings.test.ts` (수정) | 도크 필드 sanitize |
| `apps/desktop/src/preload/index.ts` (수정) | 최초 on() 브리지(repo.onChanged·terminalApi) |
| `apps/desktop/src/renderer/src/env.d.ts` (수정) | window.terminalApi 타입 |
| `apps/desktop/src/renderer/src/store/repository-store.ts` (수정) | externalRefresh(억제 창)·감시 시작 배선 |
| `apps/desktop/src/renderer/src/ui/terminal/dock-height.ts` (신규) + `test/dock-height.test.ts` | 도크 높이 클램프·영속 순수 함수 |
| `apps/desktop/src/renderer/src/ui/terminal/use-terminal-sessions.ts` (신규) | xterm 인스턴스·세션 탭 로직(훅 — 프레젠테이션 분리) |
| `apps/desktop/src/renderer/src/ui/terminal/TerminalDock.tsx` (신규) + `terminal-dock.css` | 도크 렌더(탭 바·드래그·xterm 컨테이너) |
| `apps/desktop/src/renderer/src/App.tsx` (수정) | 토글 버튼·단축키·그리드 행·도크 배선 |
| `apps/desktop/src/renderer/src/layout.css` (수정) | 그리드 행·도크·좌측 row span |
| `apps/desktop/e2e/smoke.spec.ts` (수정) | E2E +5 |

## 검증 게이트 요약

| 시점 | 기대치 |
| --- | --- |
| 기준선 (9bb609d, 실측) | **392 tests**(29 files) + E2E 52 (smoke 46 + hosting 6) |
| Task 1 후 | +6 → **398** (resolveShell 3 + clampPtyDims 2 + spawn 친절화 1 — 품질 리뷰 반영) + build·typecheck·pnpm 경고 0 |
| Task 2 후 | +7 → **405** (filter 4 + debounce 3) + smoke **47**(외부 변경 자동 갱신) |
| Task 3 후 | 405 유지 + typecheck Done (터미널 IPC 배선) |
| Task 4 후 | +5 → **410** (sanitize +1 · dock-height +4) + build Done |
| Task 5 후 | smoke **51** (echo 왕복·탭·접기 유지·터미널 commit 자동 갱신) |
| 최종 (Task 6) | **410 tests** + typecheck + build + E2E **57**(smoke 51 + hosting 6) + last-screen 0건 + 스크린샷 2장 + README |

---

### Task 1: 의존성 + main 터미널 매니저

**Files:**
- Modify: `apps/desktop/package.json` (pnpm add로)
- Create: `apps/desktop/src/main/terminal-manager.ts`
- Test: `apps/desktop/test/terminal-shell.test.ts` (신규, +3)

- [x] **Step 0: 브랜치 생성** — main(9bb609d)에서 `git checkout -b feature/e7b-terminal`. `git branch --show-current` 확인.

- [x] **Step 1: 의존성 설치.**

```bash
cd "/Users/sangyeop_kim/git gui" && pnpm --filter @git-gui/desktop add node-pty @xterm/xterm @xterm/addon-fit
```

설치 출력에서 **"Ignored build scripts: node-pty"류 경고를 확인**한다. 경고가 있으면 **`pnpm-workspace.yaml`의 기존 `onlyBuiltDependencies` 목록에** `- node-pty`를 추가하고 `pnpm install --force` 재실행(프리빌드라 실제 빌드는 일어나지 않지만 경고를 정리한다 — 실측 2).

> **실행 중 정정(Task 2에서 발견된 함정):** 초안은 루트 package.json의 `pnpm.onlyBuiltDependencies`를 지시했으나, 이 필드는 **pnpm-workspace.yaml의 기존 목록(electron·esbuild)을 통째로 덮어써** Electron postinstall이 죽고 바이너리(dist/)가 사라진다 — E2E 전체가 "Electron failed to install correctly"로 붕괴(실측). 반드시 workspace yaml 목록에 병기한다(보완 커밋 2fcd2da).

경고가 없으면 이 조건 단계는 건너뛴다(보고서에 어느 쪽이었는지 기록).

> **실행 중 실측 추가(Task 5에서 발견):** node-pty 1.1.0의 **발행 tarball 자체가 `prebuilds/darwin-*/spawn-helper`를 실행 권한 없이(-rw-r--r--) 담고 있다**(npm pack 실독 — pnpm/npm 무관, 새 설치마다 재현). 이 상태에서 모든 pty spawn이 `posix_spawnp failed`로 죽는다. 해법: `apps/desktop/package.json`에 postinstall 스크립트로 darwin 프리빌드 spawn-helper를 chmod 755(멱등, 재설치마다 자가치유 — fix(build) 커밋). 사전 실측 2의 프로브가 통과했던 것은 npm 설치 경로의 우연이었다. 설치 후 `node -e "console.log(require('/Users/sangyeop_kim/git gui/node_modules/.pnpm/node_modules/node-pty/package.json').version)"`가 실패하면 desktop의 node_modules 경로로 확인: `node -e "console.log(require('$(pwd)/apps/desktop/node_modules/node-pty/package.json').version)"` → **1.1.x**.

- [x] **Step 2: Red — resolveShell 테스트.** `apps/desktop/test/terminal-shell.test.ts` 신규:

```ts
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
```

- [x] **Step 3: Red 확인** — `pnpm vitest run --project @git-gui/desktop -t 'resolveShell'` → 모듈 부재로 실패 확인.

주의: 이 테스트는 `terminal-manager`를 import하므로 모듈 최상단에서 node-pty가 로드된다 — **plain node의 vitest에서도 프리빌드가 로드되는지가 함께 검증**된다(실측 2: prebuilds는 ABI별 로드라 plain node에서도 동작). 만약 로드 에러가 나면 BLOCKED로 보고(플랜 전제 붕괴).

- [x] **Step 4: 구현.** `apps/desktop/src/main/terminal-manager.ts` 신규:

```ts
import { spawn, type IPty } from 'node-pty'
import { randomUUID } from 'node:crypto'

/** 세션 상한 — 무한 스폰 방어. 초과는 읽히는 메시지로 거부한다 */
const MAX_SESSIONS = 8

/** $SHELL 우선, 없으면 zsh→bash — 로그인 쉘(-l)로 사용자 rc·PATH를 살린다 (스펙) */
export function resolveShell(env: Record<string, string | undefined>): string {
  const shell = env.SHELL
  if (shell !== undefined && shell.trim() !== '') return shell
  return process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'
}

/** pty가 죽지 않는 바닥 — fit addon이 극단 레이아웃에서 0·소수를 줄 수 있다 (품질 리뷰: 순수 함수로 추출해 검증) */
export function clampPtyDims(cols: number, rows: number): { cols: number; rows: number } {
  return { cols: Math.max(2, Math.floor(cols)), rows: Math.max(1, Math.floor(rows)) }
}

export interface TerminalEvents {
  onData(sessionId: string, chunk: string): void
  onExit(sessionId: string, exitCode: number): void
}

/**
 * pty 세션 수명 관리 (E7b) — main 전용. renderer는 sessionId·바이트만 안다.
 * 이벤트는 콜백 주입 — IPC(webContents.send) 배선은 terminal-handlers 책임(테스트 분리)
 */
export class TerminalManager {
  private sessions = new Map<string, IPty>()

  constructor(private events: TerminalEvents) {}

  /** 세션 생성 — cwd는 호출자(핸들러)가 allowlist 검증을 마친 저장소 루트다 (E7c에서 워크트리 경로 확장점) */
  create(cwd: string): { sessionId: string } {
    if (this.sessions.size >= MAX_SESSIONS) {
      throw new Error(`터미널은 ${MAX_SESSIONS}개까지 열 수 있어요. 안 쓰는 탭을 닫아 주세요.`)
    }
    const sessionId = randomUUID()
    const shell = resolveShell(process.env)
    let pty: IPty
    try {
      pty = spawn(shell, ['-l'], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd,
        env: { ...process.env, TERM: 'xterm-256color' },
      })
    } catch {
      // 깨진 $SHELL(삭제된 바이너리 등) — posix_spawnp 원어를 사용자에게 노출하지 않는다 (품질 리뷰)
      throw new Error(`쉘(${shell})을 실행하지 못했어요. SHELL 환경 변수를 확인해 주세요.`)
    }
    this.sessions.set(sessionId, pty)
    pty.onData((chunk) => this.events.onData(sessionId, chunk))
    pty.onExit(({ exitCode }) => {
      // 명시적 kill이 먼저 지웠으면 no-op — exit 이벤트는 그대로 알린다(렌더러가 탭 정리)
      this.sessions.delete(sessionId)
      this.events.onExit(sessionId, exitCode)
    })
    return { sessionId }
  }

  private session(sessionId: string): IPty {
    const pty = this.sessions.get(sessionId)
    if (pty === undefined) throw new Error('이미 닫힌 터미널이에요.')
    return pty
  }

  input(sessionId: string, data: string): void {
    this.session(sessionId).write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const dims = clampPtyDims(cols, rows)
    this.session(sessionId).resize(dims.cols, dims.rows)
  }

  kill(sessionId: string): void {
    const pty = this.sessions.get(sessionId)
    if (pty === undefined) return
    this.sessions.delete(sessionId)
    pty.kill()
  }

  /** 앱 종료 정리 — 고아 쉘 프로세스를 남기지 않는다 (before-quit에서 호출) */
  killAll(): void {
    for (const pty of this.sessions.values()) pty.kill()
    this.sessions.clear()
  }
}
```

- [x] **Step 5: Green + 게이트** — `pnpm vitest run --project @git-gui/desktop -t 'resolveShell'` → 3 passed. 루트 `pnpm test` → **398 passed**. `pnpm typecheck` Done. `pnpm --filter @git-gui/desktop build` 성공. (externalize 확인 grep은 Task 3에서 — Task 1 시점엔 terminal-manager가 main 진입점에서 아직 import되지 않아 번들에 등장하지 않는 게 정상이다. 구현자 실측 정정.)

- [x] **Step 6: Commit**

```bash
git add apps/desktop/package.json pnpm-lock.yaml apps/desktop/src/main/terminal-manager.ts apps/desktop/test/terminal-shell.test.ts
git commit -m "feat(desktop): E7b 터미널 엔진 — node-pty 세션 매니저(main 전용, 프리빌드 실측·상한 8·쉘 결정)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(루트 package.json을 고쳤다면 `git add package.json`도 포함하고 보고에 명기.)

---

### Task 2: fs watch — 필터·디바운스·감시·자동 갱신 (E2E 포함)

**Files:**
- Create: `apps/desktop/src/main/watch-filter.ts`
- Test: `apps/desktop/test/watch-filter.test.ts` (신규, +7)
- Create: `apps/desktop/src/main/repo-watcher.ts`
- Modify: `packages/ipc-contract/src/index.ts` (repo.watch·onChanged)
- Modify: `apps/desktop/src/main/git-handlers.ts` (repoWatch 핸들러)
- Modify: `apps/desktop/src/preload/index.ts` (최초 on() 브리지)
- Modify: `apps/desktop/src/renderer/src/store/repository-store.ts` (externalRefresh·감시 시작)
- Modify: `apps/desktop/e2e/smoke.spec.ts` (+1)

- [x] **Step 1: Red — 필터·디바운스 테스트.** `apps/desktop/test/watch-filter.test.ts` 신규:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTrailingDebounce, isRelevantGitEvent } from '../src/main/watch-filter'

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
})
```

- [x] **Step 2: Red 확인** — `pnpm vitest run --project @git-gui/desktop -t 'isRelevantGitEvent'` → 모듈 부재로 실패 확인.

- [x] **Step 3: 필터·디바운스 구현.** `apps/desktop/src/main/watch-filter.ts` 신규:

```ts
/**
 * .git 감시 이벤트 필터 (E7b 실측 1):
 * - *.lock 제외 — git status(읽기)조차 index.lock을 만든다: 스냅샷 조회가 자기 이벤트를
 *   낳아 무한 새로고침 루프가 되는 함정
 * - objects/·logs/ 제외 — 커밋 내용물·reflog는 HEAD·refs 이벤트가 이미 대변한다
 * - 수용: HEAD·index·packed-refs·refs/**·대문자 상태 마커(MERGE_HEAD 등)·rebase 디렉터리
 */
export function isRelevantGitEvent(relativePath: string): boolean {
  if (relativePath.endsWith('.lock')) return false
  if (relativePath.startsWith('objects/') || relativePath.startsWith('logs/')) return false
  if (relativePath === 'HEAD' || relativePath === 'index' || relativePath === 'packed-refs') {
    return true
  }
  if (relativePath.startsWith('refs/')) return true
  if (relativePath.startsWith('rebase-merge/') || relativePath.startsWith('rebase-apply/')) {
    return true
  }
  // MERGE_HEAD·CHERRY_PICK_HEAD·REVERT_HEAD·FETCH_HEAD·ORIG_HEAD 등 top-level 상태 마커
  return /^[A-Z_]+$/.test(relativePath)
}

export interface TrailingDebounce {
  hit(): void
  dispose(): void
}

/** 마지막 hit 후 delayMs가 지나면 fire를 1회 부른다 — git 한 명령의 이벤트 폭주를 묶는다 */
export function createTrailingDebounce(delayMs: number, fire: () => void): TrailingDebounce {
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    hit() {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        fire()
      }, delayMs)
    },
    dispose() {
      if (timer !== null) clearTimeout(timer)
      timer = null
    },
  }
}
```

- [x] **Step 4: Green** — `pnpm vitest run --project @git-gui/desktop -t 'isRelevantGitEvent'`·`-t 'createTrailingDebounce'` → 7 passed.

- [x] **Step 5: 감시자 구현.** `apps/desktop/src/main/repo-watcher.ts` 신규:

```ts
import { watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { createTrailingDebounce, isRelevantGitEvent } from './watch-filter'

/** 이벤트 폭주 묶음 창 (실측 1: 커밋 1회 = 18이벤트) */
const DEBOUNCE_MS = 300

/**
 * 저장소 하나의 .git을 감시한다 (E7b) — 관련 이벤트가 잦아들면 onChanged를 1회 부른다.
 * 반환값은 정리 함수. 감시 실패는 기능 저하로만(수동 새로고침은 그대로 동작) — 던지지 않는다
 */
export function watchRepository(repoPath: string, onChanged: () => void): () => void {
  const debounce = createTrailingDebounce(DEBOUNCE_MS, onChanged)
  let watcher: FSWatcher | null = null
  try {
    // {recursive: true}는 macOS/Windows 전용 — Linux에선 생성이 throw해 fail-soft(수동 새로고침만)가 된다
    watcher = watch(join(repoPath, '.git'), { recursive: true }, (_type, file) => {
      if (file !== null && isRelevantGitEvent(file.toString())) debounce.hit()
    })
    // fs.watch는 생성 후에도 비동기 'error'를 낼 수 있다(.git 소멸·이름 변경 등) —
    // 리스너가 없으면 main 프로세스가 죽는다. 감시만 조용히 내려놓는다 (품질 리뷰)
    watcher.on('error', () => {
      watcher?.close()
      watcher = null
      debounce.dispose()
    })
  } catch {
    return () => {}
  }
  return () => {
    debounce.dispose()
    watcher?.close()
  }
}
```

- [x] **Step 6: IPC 계약.** `packages/ipc-contract/src/index.ts` 기존:

```ts
  repo: {
    /** 폴더 선택 다이얼로그. 취소하면 null. 반환 경로는 저장소 루트로 정규화된다 */
    select(): Promise<string | null>
    /** E2E 등에서 환경 변수로 주입한 초기 저장소 경로. 반환 경로는 저장소 루트로 정규화된다 */
    initialPath(): Promise<string | null>
    status(repoPath: string): Promise<RepositoryStatus>
  }
```

교체:

```ts
  repo: {
    /** 폴더 선택 다이얼로그. 취소하면 null. 반환 경로는 저장소 루트로 정규화된다 */
    select(): Promise<string | null>
    /** E2E 등에서 환경 변수로 주입한 초기 저장소 경로. 반환 경로는 저장소 루트로 정규화된다 */
    initialPath(): Promise<string | null>
    status(repoPath: string): Promise<RepositoryStatus>
    /** .git 감시 시작 — 이후 외부 변경이 repo:changed push로 온다. 새 경로로 부르면 이전 감시는 교체된다 (E7b) */
    watch(repoPath: string): Promise<void>
    /** repo:changed 구독 — 해제 함수를 반환한다. 이 앱 최초의 push 채널 (E7b) */
    onChanged(listener: (repoPath: string) => void): () => void
  }
```

그리고 기존:

```ts
export const CHANNELS = {
  repoSelect: 'repo:select',
  repoInitialPath: 'repo:initial-path',
  repoStatus: 'repo:status',
```

교체:

```ts
export const CHANNELS = {
  repoSelect: 'repo:select',
  repoInitialPath: 'repo:initial-path',
  repoStatus: 'repo:status',
  repoWatch: 'repo:watch',
  /** push(main→renderer) — invoke가 아니라 webContents.send 채널 (E7b) */
  repoChanged: 'repo:changed',
```

- [x] **Step 7: 핸들러.** `apps/desktop/src/main/git-handlers.ts` — import 기존:

```ts
import { CHANNELS } from '@git-gui/ipc-contract'
```

(실독 확정: git-handlers.ts:5.) `watchRepository` import를 추가:

```ts
import { CHANNELS } from '@git-gui/ipc-contract'
import { watchRepository } from './repo-watcher'
```

그리고 `registerGitHandlers()` 안, 기존 `CHANNELS.repoStatus` 핸들러:

```ts
  ipcMain.handle(CHANNELS.repoStatus, (_event, repoPath: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).repo.status(),
  )
```

교체:

```ts
  ipcMain.handle(CHANNELS.repoStatus, (_event, repoPath: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).repo.status(),
  )

  // 저장소 감시 (E7b) — 한 번에 하나만. 새 경로가 오면 이전 감시를 교체한다.
  // 응답 대상은 invoke의 sender — window 배선 없이 push한다 (실측 3)
  let stopWatching: (() => void) | null = null
  // destroyed 정리는 sender당 1회만 등록한다 — watch 재호출마다 쌓이면 MaxListeners 경고 (통합 리뷰, terminal-handlers 관례)
  const watchCleanupHooked = new WeakSet<Electron.WebContents>()
  ipcMain.handle(CHANNELS.repoWatch, (event, repoPath: unknown) => {
    const path = assertAllowedRepo(repoPath)
    stopWatching?.()
    const sender = event.sender
    stopWatching = watchRepository(path, () => {
      if (!sender.isDestroyed()) sender.send(CHANNELS.repoChanged, path)
    })
    if (!watchCleanupHooked.has(sender)) {
      watchCleanupHooked.add(sender)
      sender.once('destroyed', () => {
        stopWatching?.()
        stopWatching = null
      })
    }
  })
```

- [x] **Step 8: preload 브리지.** `apps/desktop/src/preload/index.ts` 기존:

```ts
  repo: {
    select: () => ipcRenderer.invoke(CHANNELS.repoSelect),
    initialPath: () => ipcRenderer.invoke(CHANNELS.repoInitialPath),
    status: (repoPath) => ipcRenderer.invoke(CHANNELS.repoStatus, repoPath),
  },
```

교체:

```ts
  repo: {
    select: () => ipcRenderer.invoke(CHANNELS.repoSelect),
    initialPath: () => ipcRenderer.invoke(CHANNELS.repoInitialPath),
    status: (repoPath) => ipcRenderer.invoke(CHANNELS.repoStatus, repoPath),
    watch: (repoPath) => ipcRenderer.invoke(CHANNELS.repoWatch, repoPath),
    // 이 앱 최초의 push 구독 브리지 — 콜백을 감싸 등록하고 해제 함수를 돌려준다 (E7b)
    onChanged: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, repoPath: string) => listener(repoPath)
      ipcRenderer.on(CHANNELS.repoChanged, wrapped)
      return () => ipcRenderer.removeListener(CHANNELS.repoChanged, wrapped)
    },
  },
```

- [x] **Step 9: store — externalRefresh·감시 시작.** `apps/desktop/src/renderer/src/store/repository-store.ts` 편집 4곳.

(a) 인터페이스 기존:

```ts
  /** notice만 지운다 — 자동 소멸 타이머(App) 전용. 동기라 guard 불필요 */
  clearNotice(): void
```

교체:

```ts
  /** notice만 지운다 — 자동 소멸 타이머(App) 전용. 동기라 guard 불필요 */
  clearNotice(): void
  /**
   * 감시(repo:changed)발 재조회 (E7b) — 새로고침과 같은 의미론(선택 무효화)이되 hosting 호출은
   * 없다(감시 폭주가 네트워크를 때리지 않게). busy면 guard가 거부 = 자기 작업 이벤트 드롭(실측 1),
   * 작업 종료 직후 억제 창은 트레일링 이벤트를 흡수한다
   */
  externalRefresh(): Promise<void>
```

(b) guard 기존:

```ts
/** busy 재진입을 거부하고 busy/error 처리를 일원화한다. 성공 여부를 반환한다 */
async function guard(set: StoreSet, get: StoreGet, run: () => Promise<void>): Promise<boolean> {
  if (get().busy) return false
  set({ busy: true, error: null, notice: null })
  try {
    await run()
    return true
  } catch (cause) {
    set({ error: toErrorMessage(cause) })
    return false
  } finally {
    set({ busy: false })
  }
}
```

교체:

```ts
/** 마지막 guard 작업이 끝난 시각 — 감시발 재조회의 억제 창 기준 (E7b 실측 1: 트레일링 이벤트 흡수) */
let lastGuardEndAt = 0
/** 작업 종료 후 이 시간 안의 감시 이벤트는 자기 작업의 꼬리로 보고 무시한다 (디바운스 300ms + 여유) */
export const WATCH_SUPPRESS_MS = 800

/** busy 재진입을 거부하고 busy/error 처리를 일원화한다. 성공 여부를 반환한다 */
async function guard(set: StoreSet, get: StoreGet, run: () => Promise<void>): Promise<boolean> {
  if (get().busy) return false
  set({ busy: true, error: null, notice: null })
  try {
    await run()
    return true
  } catch (cause) {
    set({ error: toErrorMessage(cause) })
    return false
  } finally {
    lastGuardEndAt = Date.now()
    set({ busy: false })
  }
}
```

(c) init 기존:

```ts
  async init() {
    await guard(set, get, async () => {
      const initial = await git().repo.initialPath()
      if (!initial) return
      set({
        repoPath: initial,
        hostingStatus: await hosting().status(initial),
        ...(await fetchSnapshot(initial, get().historyLimit)),
      })
    })
  },
```

교체:

```ts
  async init() {
    await guard(set, get, async () => {
      const initial = await git().repo.initialPath()
      if (!initial) return
      set({
        repoPath: initial,
        hostingStatus: await hosting().status(initial),
        ...(await fetchSnapshot(initial, get().historyLimit)),
      })
      void git().repo.watch(initial)
    })
    // 이 guard는 읽기 전용(상태 조회)이라 자기 꼬리 이벤트가 없다 — 시작 직후 도착하는 첫 감시
    // 이벤트까지 억제 창에 걸려 삼켜지지 않도록 초기화한다 (E7b: 실측 — 실제 앱 기동~외부 커밋
    // 간격이 800ms 억제 창보다 짧을 수 있어 재현됨)
    lastGuardEndAt = 0
    // 감시 구독은 앱 수명 1회 — 이벤트가 온 저장소가 지금 저장소일 때만 재조회한다 (E7b)
    git().repo.onChanged((changedPath) => {
      if (get().repoPath === changedPath) void get().externalRefresh()
    })
  },
```

(d) refresh 구현 기존:

```ts
  async refresh() {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      // 외부(CLI 등)에서 상태가 바뀌었을 수 있다 — 보고 있던 diff·상세도 함께 무효화한다
      set({
        ...CLEAR_SELECTIONS,
        hostingStatus: await hosting().status(repoPath),
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
      })
    })
  },
```

교체:

```ts
  async refresh() {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      // 외부(CLI 등)에서 상태가 바뀌었을 수 있다 — 보고 있던 diff·상세도 함께 무효화한다
      set({
        ...CLEAR_SELECTIONS,
        hostingStatus: await hosting().status(repoPath),
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
      })
    })
  },

  async externalRefresh() {
    const { repoPath } = get()
    if (!repoPath) return
    // 자기 작업 꼬리 이벤트 억제 — 작업 직후의 감시발 재조회는 방금 갱신한 화면을 다시 지울 뿐이다
    if (Date.now() - lastGuardEndAt < WATCH_SUPPRESS_MS) return
    await guard(set, get, async () => {
      // 수동 새로고침과 같은 의미론(선택 무효화) — 단, 열려 있는 충돌 뷰는 지우지 않는다:
      // 편집 초안(draft)이 컴포넌트 로컬이라 언마운트되면 소리 없이 사라진다 (품질 리뷰 —
      // 카드 뷰의 낡음은 패널 자체의 onReload 최신 검사가 흡수한다)
      const { conflictFile } = get()
      set({
        ...CLEAR_SELECTIONS,
        conflictFile,
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
      })
    })
  },
```

(e) openRepository 기존:

```ts
      set({
        repoPath: path,
        historyLimit: HISTORY_LIMIT,
        hostingStatus: await hosting().status(path),
        pulls: [],
        ...CLEAR_SELECTIONS,
        ...(await fetchSnapshot(path, HISTORY_LIMIT)),
      })
    })
  },
```

교체:

```ts
      set({
        repoPath: path,
        historyLimit: HISTORY_LIMIT,
        hostingStatus: await hosting().status(path),
        pulls: [],
        ...CLEAR_SELECTIONS,
        ...(await fetchSnapshot(path, HISTORY_LIMIT)),
      })
      // 새 저장소로 감시 교체 (E7b) — 이전 저장소 감시는 main이 새 watch 호출에서 정리한다
      void git().repo.watch(path)
    })
  },
```

- [x] **Step 10: E2E — 외부 변경 자동 갱신.** `apps/desktop/e2e/smoke.spec.ts` 파일 끝(마지막 테스트 `'실험 공간 탭 — 원격 공간을 내 공간으로 가져온다(추적 checkout) (E7a)'`의 닫는 `})` 뒤)에 추가:

```ts

test('감시 — 밖에서 저장하면 화면이 스스로 갱신된다 (E7b fs watch)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('history-count')).toHaveText('1')
    // 앱 밖(터미널 상당)에서 커밋 — 클릭 없이 역사·브랜치 화면이 따라와야 한다
    await execGitOrThrow(['commit', '--allow-empty', '-m', '외부 저장'], { cwd: repo })
    await expect(window.getByTestId('history-count')).toHaveText('2', { timeout: 5_000 })
    await expect(window.getByTestId('history-list')).toContainText('외부 저장')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})
```

- [x] **Step 11: 게이트** — 루트 `pnpm test` → **405 passed**. `pnpm typecheck` Done. `cd apps/desktop && npx electron-vite build && npx playwright test e2e/smoke.spec.ts` → **47 passed**(기존 46 전체 무회귀 — 감시 도입이 기존 스냅샷 타이밍 단언을 흔들지 않는지의 게이트. 흔들리면 E2E 한정 비활성이 아니라 원인 수정 — 스펙 명시).

- [x] **Step 12: Commit**

```bash
git add apps/desktop/src/main/watch-filter.ts apps/desktop/test/watch-filter.test.ts apps/desktop/src/main/repo-watcher.ts packages/ipc-contract/src/index.ts apps/desktop/src/main/git-handlers.ts apps/desktop/src/preload/index.ts apps/desktop/src/renderer/src/store/repository-store.ts apps/desktop/e2e/smoke.spec.ts
git commit -m "feat(desktop): E7b .git 감시 자동 갱신 — lock 루프·이중 갱신 실측 방어(필터·디바운스·억제 창), 최초 push IPC

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 터미널 IPC — 계약·핸들러·preload

**Files:**
- Modify: `packages/ipc-contract/src/index.ts` (TerminalApi)
- Create: `apps/desktop/src/main/terminal-handlers.ts`
- Modify: `apps/desktop/src/main/index.ts` (핸들러 등록) — git-handlers.ts는 무변(assertAllowedRepo 기존 export 확인만, Step 2)

- Modify: `apps/desktop/src/preload/index.ts` (terminalApi)
- Modify: `apps/desktop/src/renderer/src/env.d.ts` (window.terminalApi)

- [x] **Step 1: 계약.** `packages/ipc-contract/src/index.ts` — 파일 끝 기존:

```ts
export const SETTINGS_CHANNELS = {
  /** preload 전용 동기 채널 — 첫 렌더 전에 테마를 결정해야 깜빡임이 없다 */
  getSync: 'settings:get-sync',
  set: 'settings:set',
} as const
```

교체:

```ts
export const SETTINGS_CHANNELS = {
  /** preload 전용 동기 채널 — 첫 렌더 전에 테마를 결정해야 깜빡임이 없다 */
  getSync: 'settings:get-sync',
  set: 'settings:set',
} as const

/** 터미널 표면 (E7b) — pty는 main 전용. renderer는 세션 id와 바이트 스트림만 다룬다 */
export interface TerminalApi {
  /** 세션 생성 — cwd는 allowlist된 저장소 루트로 고정된다 (E7c에서 워크트리 인자 확장) */
  create(repoPath: string): Promise<{ sessionId: string }>
  input(sessionId: string, data: string): Promise<void>
  resize(sessionId: string, cols: number, rows: number): Promise<void>
  kill(sessionId: string): Promise<void>
  /** 출력 push 구독 — 해제 함수를 반환한다 */
  onData(listener: (sessionId: string, chunk: string) => void): () => void
  /** 종료 push 구독 — 쉘 exit·명시적 kill 모두 */
  onExit(listener: (sessionId: string, exitCode: number) => void): () => void
}

export const TERMINAL_API_KEY = 'terminalApi' as const

export const TERMINAL_CHANNELS = {
  create: 'terminal:create',
  input: 'terminal:input',
  resize: 'terminal:resize',
  kill: 'terminal:kill',
  /** push(main→renderer) — invoke가 아니라 webContents.send 채널 */
  data: 'terminal:data',
  exit: 'terminal:exit',
} as const
```

- [x] **Step 2: assertAllowedRepo 확인.** 플랜 작성 시 실독 확정: `apps/desktop/src/main/git-handlers.ts:10`이 이미 `export function assertAllowedRepo(repoPath: unknown): string {`다 — **수정 불필요**, `grep -n "export function assertAllowedRepo"`로 1회 매치만 확인하고 넘어간다.

- [x] **Step 3: 핸들러.** `apps/desktop/src/main/terminal-handlers.ts` 신규:

```ts
import { app, ipcMain } from 'electron'
import { TERMINAL_CHANNELS } from '@git-gui/ipc-contract'
import { assertAllowedRepo, assertString } from './git-handlers'
import { TerminalManager } from './terminal-manager'

export function registerTerminalHandlers(): void {
  // 이벤트의 목적지는 세션을 만든 창(invoke의 event.sender) — 창 배선 없이 push한다 (실측 3)
  const targets = new Map<string, Electron.WebContents>()
  const manager = new TerminalManager({
    onData(sessionId, chunk) {
      const target = targets.get(sessionId)
      if (target !== undefined && !target.isDestroyed()) {
        target.send(TERMINAL_CHANNELS.data, sessionId, chunk)
      }
    },
    onExit(sessionId, exitCode) {
      const target = targets.get(sessionId)
      targets.delete(sessionId)
      if (target !== undefined && !target.isDestroyed()) {
        target.send(TERMINAL_CHANNELS.exit, sessionId, exitCode)
      }
    },
  })

  // 창이 닫히거나 renderer가 죽으면 그 창의 세션을 전부 정리한다 — 렌더러 예절에 의존하지 않는다.
  // macOS는 창을 닫아도 앱이 살아 고아 쉘이 남는다 (품질 리뷰). sender당 1회만 등록한다
  const cleanupHooked = new WeakSet<Electron.WebContents>()

  ipcMain.handle(TERMINAL_CHANNELS.create, (event, repoPath: unknown) => {
    const cwd = assertAllowedRepo(repoPath)
    const created = manager.create(cwd)
    targets.set(created.sessionId, event.sender)
    if (!cleanupHooked.has(event.sender)) {
      cleanupHooked.add(event.sender)
      event.sender.once('destroyed', () => {
        const ids = [...targets.entries()]
          .filter(([, target]) => target === event.sender)
          .map(([id]) => id)
        for (const id of ids) {
          targets.delete(id)
          manager.kill(id)
        }
      })
    }
    return created
  })

  ipcMain.handle(TERMINAL_CHANNELS.input, (_event, sessionId: unknown, data: unknown) => {
    manager.input(assertString(sessionId), assertString(data))
  })

  ipcMain.handle(
    TERMINAL_CHANNELS.resize,
    (_event, sessionId: unknown, cols: unknown, rows: unknown) => {
      // typeof만으로는 NaN·Infinity가 새어 node-pty 원어 에러가 노출된다 (품질 리뷰 — fit 0폭 도크)
      if (
        typeof cols !== 'number' ||
        typeof rows !== 'number' ||
        !Number.isFinite(cols) ||
        !Number.isFinite(rows)
      ) {
        throw new Error('잘못된 요청 형식이에요.')
      }
      manager.resize(assertString(sessionId), cols, rows)
    },
  )

  ipcMain.handle(TERMINAL_CHANNELS.kill, (_event, sessionId: unknown) => {
    manager.kill(assertString(sessionId))
  })

  // 고아 쉘 방지 — 앱 종료 시 전 세션 정리 (실측 3: before-quit 훅은 이 앱에 없어 신설)
  app.on('before-quit', () => manager.killAll())
}
```

- [x] **Step 4: main 등록.** `apps/desktop/src/main/index.ts` 기존:

```ts
import { registerGitHandlers } from './git-handlers'
import { registerHostingHandlers } from './hosting-handlers'
import { registerSettingsHandlers } from './settings'
```

교체:

```ts
import { registerGitHandlers } from './git-handlers'
import { registerHostingHandlers } from './hosting-handlers'
import { registerSettingsHandlers } from './settings'
import { registerTerminalHandlers } from './terminal-handlers'
```

그리고 기존:

```ts
    registerGitHandlers()
    registerSettingsHandlers()
    registerHostingHandlers()
    createWindow()
```

교체:

```ts
    registerGitHandlers()
    registerSettingsHandlers()
    registerHostingHandlers()
    registerTerminalHandlers()
    createWindow()
```

- [x] **Step 5: preload.** `apps/desktop/src/preload/index.ts` — import 기존:

```ts
import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings, DiffOptions, GitApi, HostingApi, SettingsApi } from '@git-gui/ipc-contract'
import {
  CHANNELS,
  GIT_API_KEY,
  HOSTING_API_KEY,
  HOSTING_CHANNELS,
  SETTINGS_API_KEY,
  SETTINGS_CHANNELS,
} from '@git-gui/ipc-contract'
```

교체:

```ts
import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  DiffOptions,
  GitApi,
  HostingApi,
  SettingsApi,
  TerminalApi,
} from '@git-gui/ipc-contract'
import {
  CHANNELS,
  GIT_API_KEY,
  HOSTING_API_KEY,
  HOSTING_CHANNELS,
  SETTINGS_API_KEY,
  SETTINGS_CHANNELS,
  TERMINAL_API_KEY,
  TERMINAL_CHANNELS,
} from '@git-gui/ipc-contract'
```

그리고 파일 끝 기존:

```ts
contextBridge.exposeInMainWorld(SETTINGS_API_KEY, settingsApi)
```

교체:

```ts
contextBridge.exposeInMainWorld(SETTINGS_API_KEY, settingsApi)

const terminalApi: TerminalApi = {
  create: (repoPath) => ipcRenderer.invoke(TERMINAL_CHANNELS.create, repoPath),
  input: (sessionId, data) => ipcRenderer.invoke(TERMINAL_CHANNELS.input, sessionId, data),
  resize: (sessionId, cols, rows) =>
    ipcRenderer.invoke(TERMINAL_CHANNELS.resize, sessionId, cols, rows),
  kill: (sessionId) => ipcRenderer.invoke(TERMINAL_CHANNELS.kill, sessionId),
  onData: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, sessionId: string, chunk: string) =>
      listener(sessionId, chunk)
    ipcRenderer.on(TERMINAL_CHANNELS.data, wrapped)
    return () => ipcRenderer.removeListener(TERMINAL_CHANNELS.data, wrapped)
  },
  onExit: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, sessionId: string, exitCode: number) =>
      listener(sessionId, exitCode)
    ipcRenderer.on(TERMINAL_CHANNELS.exit, wrapped)
    return () => ipcRenderer.removeListener(TERMINAL_CHANNELS.exit, wrapped)
  },
}

contextBridge.exposeInMainWorld(TERMINAL_API_KEY, terminalApi)
```

- [x] **Step 6: env.d.ts.** `apps/desktop/src/renderer/src/env.d.ts` 기존:

```ts
import type { GitApi, HostingApi, SettingsApi } from '@git-gui/ipc-contract'

declare global {
  interface Window {
    gitApi: GitApi
    hostingApi: HostingApi
    settingsApi: SettingsApi
  }
}
```

교체:

```ts
import type { GitApi, HostingApi, SettingsApi, TerminalApi } from '@git-gui/ipc-contract'

declare global {
  interface Window {
    gitApi: GitApi
    hostingApi: HostingApi
    settingsApi: SettingsApi
    terminalApi: TerminalApi
  }
}
```

- [x] **Step 7: 게이트** — `pnpm typecheck` 전부 Done. 루트 `pnpm test` → **405 passed**(무변). `pnpm --filter @git-gui/desktop build` 성공 + `grep -c "node-pty" apps/desktop/out/main/index.js` → 1 이상(require 참조 존재 = externalize 정상, Task 1에서 이관된 확인).

- [x] **Step 8: Commit**

```bash
git add packages/ipc-contract/src/index.ts apps/desktop/src/main/terminal-handlers.ts apps/desktop/src/main/git-handlers.ts apps/desktop/src/main/index.ts apps/desktop/src/preload/index.ts apps/desktop/src/renderer/src/env.d.ts
git commit -m "feat(desktop): E7b 터미널 IPC — sender 기반 push 채널·before-quit 정리·allowlist cwd

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: UI — TerminalDock·그리드 행·설정 영속·토글

**Files:**
- Modify: `packages/ipc-contract/src/index.ts` (AppSettings 도크 필드)
- Test: `packages/ipc-contract/test/settings.test.ts` (+1)
- Create: `apps/desktop/src/renderer/src/ui/terminal/dock-height.ts`
- Test: `apps/desktop/test/dock-height.test.ts` (신규, +4)
- Create: `apps/desktop/src/renderer/src/ui/terminal/use-terminal-sessions.ts`
- Create: `apps/desktop/src/renderer/src/ui/terminal/TerminalDock.tsx`
- Create: `apps/desktop/src/renderer/src/ui/terminal/terminal-dock.css`
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Modify: `apps/desktop/src/renderer/src/layout.css`

- [x] **Step 1: 설정 Red.** `packages/ipc-contract/test/settings.test.ts` 기존:

```ts
  it('객체가 아니면 빈 설정', () => {
    expect(sanitizeSettings(null)).toEqual({})
    expect(sanitizeSettings('{}')).toEqual({})
    expect(sanitizeSettings([1, 2])).toEqual({})
  })
})
```

교체:

```ts
  it('객체가 아니면 빈 설정', () => {
    expect(sanitizeSettings(null)).toEqual({})
    expect(sanitizeSettings('{}')).toEqual({})
    expect(sanitizeSettings([1, 2])).toEqual({})
  })

  it('터미널 도크 필드(terminalOpen·terminalHeight)를 통과시키고 잘못된 타입은 버린다 (E7b)', () => {
    expect(sanitizeSettings({ terminalOpen: true, terminalHeight: 240 })).toEqual({
      terminalOpen: true,
      terminalHeight: 240,
    })
    expect(sanitizeSettings({ terminalOpen: 'yes', terminalHeight: NaN })).toEqual({})
  })
})
```

- [x] **Step 2: Red 확인** — `pnpm vitest run --project @git-gui/ipc-contract -t '터미널 도크 필드'` → 단언 실패 확인.

- [x] **Step 3: 설정 구현.** `packages/ipc-contract/src/index.ts` 기존:

```ts
export interface AppSettings {
  theme?: 'light' | 'dark'
  rightWidth?: number
}
```

교체:

```ts
export interface AppSettings {
  theme?: 'light' | 'dark'
  rightWidth?: number
  /** 터미널 도크 열림 (E7b) */
  terminalOpen?: boolean
  /** 터미널 도크 높이(px) (E7b) */
  terminalHeight?: number
}
```

그리고 기존:

```ts
  if (typeof candidate.rightWidth === 'number' && Number.isFinite(candidate.rightWidth)) {
    settings.rightWidth = candidate.rightWidth
  }
  return settings
}
```

교체:

```ts
  if (typeof candidate.rightWidth === 'number' && Number.isFinite(candidate.rightWidth)) {
    settings.rightWidth = candidate.rightWidth
  }
  if (typeof candidate.terminalOpen === 'boolean') settings.terminalOpen = candidate.terminalOpen
  if (typeof candidate.terminalHeight === 'number' && Number.isFinite(candidate.terminalHeight)) {
    settings.terminalHeight = candidate.terminalHeight
  }
  return settings
}
```

- [x] **Step 4: 도크 높이 Red.** `apps/desktop/test/dock-height.test.ts` 신규:

```ts
import { describe, expect, it } from 'vitest'
import {
  clampDockHeight,
  DOCK_HEIGHT_DEFAULT,
  parseStoredDockHeight,
} from '../src/renderer/src/ui/terminal/dock-height'

describe('clampDockHeight', () => {
  it('최소 120, 최대 뷰포트 60%로 자른다', () => {
    expect(clampDockHeight(50, 800)).toBe(120)
    expect(clampDockHeight(600, 800)).toBe(480)
    expect(clampDockHeight(240, 800)).toBe(240)
  })

  it('아주 낮은 창에서도 최소는 지킨다', () => {
    expect(clampDockHeight(240, 150)).toBe(120)
  })
})

describe('parseStoredDockHeight', () => {
  it('깨진 값·미설정은 기본값이다 (column-resize 관례)', () => {
    expect(parseStoredDockHeight(undefined)).toBe(DOCK_HEIGHT_DEFAULT)
    expect(parseStoredDockHeight('tall')).toBe(DOCK_HEIGHT_DEFAULT)
    expect(parseStoredDockHeight(10)).toBe(DOCK_HEIGHT_DEFAULT)
  })

  it('정상 값은 반올림해 쓴다', () => {
    expect(parseStoredDockHeight(240.6)).toBe(241)
  })
})
```

- [x] **Step 5: Red 확인 후 구현.** `pnpm vitest run --project @git-gui/desktop -t 'clampDockHeight'` 실패 확인 → `apps/desktop/src/renderer/src/ui/terminal/dock-height.ts` 신규:

```ts
export const DOCK_HEIGHT_DEFAULT = 240
export const DOCK_HEIGHT_MIN = 120

/** 도크 높이 제한 — 최소 120px, 최대 뷰포트 60%(중앙 diff·우측 역사 생존 — 스펙) */
export function clampDockHeight(px: number, viewportHeight: number): number {
  const max = Math.max(DOCK_HEIGHT_MIN, Math.floor(viewportHeight * 0.6))
  return Math.min(Math.max(Math.round(px), DOCK_HEIGHT_MIN), max)
}

/** 저장값 → 높이. 깨진 값은 조용히 기본값으로 (column-resize 관례) */
export function parseStoredDockHeight(raw: unknown): number {
  const parsed = Number(raw)
  if (raw == null || !Number.isFinite(parsed) || parsed < DOCK_HEIGHT_MIN) {
    return DOCK_HEIGHT_DEFAULT
  }
  return Math.round(parsed)
}

export function loadDockHeight(): number {
  return parseStoredDockHeight(window.settingsApi.initial.terminalHeight)
}

export function saveDockHeight(px: number): void {
  void window.settingsApi.set({ terminalHeight: px })
}

export function loadDockOpen(): boolean {
  return window.settingsApi.initial.terminalOpen === true
}

export function saveDockOpen(open: boolean): void {
  void window.settingsApi.set({ terminalOpen: open })
}
```

Green: 4 passed.

- [x] **Step 6: 세션 훅.** `apps/desktop/src/renderer/src/ui/terminal/use-terminal-sessions.ts` 신규:

```ts
import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

export interface TerminalTab {
  sessionId: string
  /** 탭 라벨 — "1: 쉘" 형태 */
  title: string
  exited: boolean
}

interface SessionView {
  terminal: Terminal
  fit: FitAddon
}

/**
 * xterm 고정 팔레트 — 쉘 출력 영역이라 앱 테마와 독립(후속: 테마 연동 검토).
 * 기본 DOM 렌더러를 쓴다 — 텍스트가 DOM에 남아 E2E가 출력을 읽을 수 있다
 */
const TERMINAL_THEME = {
  background: '#1a1b23',
  foreground: '#e2e2ea',
  cursor: '#9f8fff',
}

/** IPC 래핑 접두 제거 — store toErrorMessage와 같은 규칙(모듈 비공개라 지역 복제) */
function stripIpcPrefix(message: string): string {
  return message.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '')
}

/**
 * 터미널 세션 로직 (E7b) — 세션 생성·xterm 인스턴스 수명·push 라우팅을 소유한다.
 * TerminalDock(프레젠테이션)은 이 훅의 값·콜백만 렌더한다 (레이어 분리)
 */
export function useTerminalSessions(repoPath: string | null) {
  const [tabs, setTabs] = useState<TerminalTab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const viewsRef = useRef(new Map<string, SessionView>())
  /** create 응답이 돌아오기 전 도착한 청크(로그인 쉘 프롬프트가 invoke 왕복을 이길 수 있다 — Task 3 리뷰) */
  const pendingRef = useRef(new Map<string, string[]>())
  const counterRef = useRef(0)

  // push 구독은 훅 수명 1회 — sessionId로 해당 xterm에 라우팅한다
  useEffect(() => {
    const offData = window.terminalApi.onData((sessionId, chunk) => {
      const view = viewsRef.current.get(sessionId)
      if (view === undefined) {
        const pending = pendingRef.current.get(sessionId) ?? []
        pending.push(chunk)
        pendingRef.current.set(sessionId, pending)
        return
      }
      view.terminal.write(chunk)
    })
    const offExit = window.terminalApi.onExit((sessionId) => {
      setTabs((prev) =>
        prev.map((tab) => (tab.sessionId === sessionId ? { ...tab, exited: true } : tab)),
      )
    })
    return () => {
      offData()
      offExit()
    }
  }, [])

  const refit = (sessionId: string) => {
    const view = viewsRef.current.get(sessionId)
    if (view === undefined || view.terminal.element === undefined) return
    view.fit.fit()
    void window.terminalApi.resize(sessionId, view.terminal.cols, view.terminal.rows)
  }

  const create = async () => {
    if (repoPath === null) return
    try {
      const { sessionId } = await window.terminalApi.create(repoPath)
      counterRef.current += 1
      const terminal = new Terminal({ fontSize: 12, theme: TERMINAL_THEME, scrollback: 1000 })
      const fit = new FitAddon()
      terminal.loadAddon(fit)
      terminal.onData((data) => void window.terminalApi.input(sessionId, data))
      viewsRef.current.set(sessionId, { terminal, fit })
      // 먼저 도착해 대기 중인 청크 재생 — 첫 프롬프트 유실 방지 (Task 3 리뷰)
      const pending = pendingRef.current.get(sessionId)
      if (pending !== undefined) {
        pendingRef.current.delete(sessionId)
        for (const chunk of pending) terminal.write(chunk)
      }
      setTabs((prev) => [...prev, { sessionId, title: `${counterRef.current}: 쉘`, exited: false }])
      setActiveId(sessionId)
      setError(null)
    } catch (cause) {
      setError(stripIpcPrefix(cause instanceof Error ? cause.message : String(cause)))
    }
  }

  const close = (sessionId: string) => {
    void window.terminalApi.kill(sessionId)
    const view = viewsRef.current.get(sessionId)
    viewsRef.current.delete(sessionId)
    view?.terminal.dispose()
    const next = tabs.filter((tab) => tab.sessionId !== sessionId)
    setTabs(next)
    if (activeId === sessionId) setActiveId(next[next.length - 1]?.sessionId ?? null)
  }

  /** 세션 뷰를 DOM에 붙인다 — 숨김 탭에서 붙으면 크기가 0이라, 보이는 시점의 refit이 바로잡는다 */
  const attach = (sessionId: string, element: HTMLDivElement | null) => {
    if (element === null) return
    const view = viewsRef.current.get(sessionId)
    if (view === undefined) return
    if (view.terminal.element !== undefined) {
      refit(sessionId)
      return
    }
    view.terminal.open(element)
    refit(sessionId)
  }

  const refitActive = () => {
    if (activeId !== null) refit(activeId)
  }

  return { tabs, activeId, error, create, close, select: setActiveId, attach, refitActive }
}
```

- [x] **Step 7: 도크 컴포넌트.** `apps/desktop/src/renderer/src/ui/terminal/TerminalDock.tsx` 신규:

```tsx
import { Plus, X } from 'lucide-react'
import { useEffect } from 'react'
import { Button } from '../Button'
import { useTerminalSessions } from './use-terminal-sessions'
import './terminal-dock.css'

interface TerminalDockProps {
  repoPath: string | null
  /** 도크가 보이는가 — 접힘은 숨김일 뿐 언마운트가 아니다(세션 유지 — 스펙) */
  open: boolean
  height: number
  /** 세로 드래그 시작 — 클램프·영속은 App 소유 (column-resize 관례) */
  onResizeStart(event: React.PointerEvent<HTMLDivElement>): void
  onClose(): void
}

/** 하단 터미널 도크 (E7b) — 렌더 전용. 세션 로직은 useTerminalSessions가 소유한다 */
export function TerminalDock({ repoPath, open, height, onResizeStart, onClose }: TerminalDockProps) {
  const sessions = useTerminalSessions(repoPath)

  // 처음 "열릴 때" 세션을 만든다 — 앱 시작만으로 쉘을 스폰하지 않는다. 열릴 때마다 크기를 다시 맞춘다
  useEffect(() => {
    if (!open) return
    if (sessions.tabs.length === 0) void sessions.create()
    else sessions.refitActive()
    // open 전이에만 반응한다 — sessions는 렌더마다 새 참조
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // 높이·활성 탭이 바뀌면 활성 세션을 다시 맞춘다
  useEffect(() => {
    sessions.refitActive()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, sessions.activeId])

  return (
    <div className="terminal-dock" style={{ height }} data-testid="terminal-dock">
      <div
        className="terminal-dock__bar"
        onPointerDown={onResizeStart}
        role="separator"
        aria-orientation="horizontal"
        aria-label="터미널 높이 조절"
        data-testid="terminal-resizer"
      >
        <span className="terminal-dock__label">터미널</span>
        <div className="terminal-dock__tabs" onPointerDown={(event) => event.stopPropagation()}>
          {sessions.tabs.map((tab) => (
            <span
              key={tab.sessionId}
              className={`terminal-dock__tab${
                tab.sessionId === sessions.activeId ? ' terminal-dock__tab--on' : ''
              }`}
            >
              <button
                type="button"
                className="terminal-dock__tab-name"
                onClick={() => sessions.select(tab.sessionId)}
              >
                {tab.title}
                {tab.exited ? ' (종료)' : ''}
              </button>
              <button
                type="button"
                className="terminal-dock__tab-close"
                aria-label={`${tab.title} 닫기`}
                onClick={() => sessions.close(tab.sessionId)}
              >
                <X size={11} aria-hidden="true" />
              </button>
            </span>
          ))}
          <Button variant="ghost" size="sm" onPress={() => void sessions.create()} testId="terminal-new-tab">
            <Plus size={13} aria-hidden="true" />
          </Button>
        </div>
        <span className="terminal-dock__hint">{repoPath?.split('/').pop() ?? ''}</span>
        <div onPointerDown={(event) => event.stopPropagation()}>
          <Button variant="ghost" size="sm" onPress={onClose} testId="terminal-close">
            <X size={13} aria-hidden="true" /> 접기
          </Button>
        </div>
      </div>
      {sessions.error !== null && (
        <p className="terminal-dock__error" role="alert" data-testid="terminal-error">
          {sessions.error}
        </p>
      )}
      <div className="terminal-dock__body" data-testid="terminal-body">
        {sessions.tabs.map((tab) => (
          <div
            key={tab.sessionId}
            className="terminal-dock__view"
            style={{ display: tab.sessionId === sessions.activeId ? 'block' : 'none' }}
            ref={(element) => sessions.attach(tab.sessionId, element)}
          />
        ))}
      </div>
    </div>
  )
}
```

- [x] **Step 8: 도크 CSS.** `apps/desktop/src/renderer/src/ui/terminal/terminal-dock.css` 신규:

```css
/* E7b 터미널 도크 — 중앙+우측 하단(grid-column 2/5). 좌측 관리 존은 전체 높이 유지 (스펙 v2 목업) */
.app__dock {
  grid-column: 2 / 5;
  min-height: 0;
}
.terminal-dock {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--color-border-strong);
  border-radius: 8px;
  background: #1a1b23;
  overflow: hidden;
}
.terminal-dock__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 8px;
  cursor: row-resize;
  border-bottom: 1px solid var(--color-border-strong);
  background: var(--color-surface);
}
.terminal-dock__label {
  font-weight: 600;
  font-size: var(--text-sm);
}
.terminal-dock__tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: default;
}
.terminal-dock__tab {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 0 2px;
}
.terminal-dock__tab--on {
  border-color: var(--color-border-strong);
}
.terminal-dock__tab-name {
  appearance: none;
  background: transparent;
  border: none;
  color: inherit;
  font-size: var(--text-sm);
  padding: 2px 6px;
  cursor: pointer;
}
.terminal-dock__tab-close {
  appearance: none;
  background: transparent;
  border: none;
  color: var(--color-text-faint);
  cursor: pointer;
  padding: 2px;
  display: inline-flex;
}
.terminal-dock__hint {
  margin-left: auto;
  font-size: var(--text-sm);
  color: var(--color-text-faint);
}
.terminal-dock__error {
  margin: 0;
  padding: 4px 10px;
  font-size: var(--text-sm);
  color: #ff9191;
}
.terminal-dock__body {
  flex: 1;
  min-height: 0;
  padding: 4px;
}
.terminal-dock__view {
  height: 100%;
}
.terminal-dock__view .xterm {
  height: 100%;
}
```

- [x] **Step 9: 레이아웃 그리드 행.** `apps/desktop/src/renderer/src/layout.css` 기존:

```css
.app__main {
  display: grid;
  /* 열 폭은 App이 inline style로 관리한다 (computeColumns — 중앙 380px 보장) — 여기 값은 초기 페인트 폴백 */
  grid-template-columns: 380px minmax(0, 1fr) 6px 360px;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  flex: 1;
  min-height: 0;
}
```

교체:

```css
.app__main {
  display: grid;
  /* 열 폭은 App이 inline style로 관리한다 (computeColumns — 중앙 380px 보장) — 여기 값은 초기 페인트 폴백 */
  grid-template-columns: 380px minmax(0, 1fr) 6px 360px;
  /* 2행 = 터미널 도크 (E7b) — 도크가 숨겨지면 auto 행은 0으로 접힌다. 열 산식(MAIN_CHROME)과 무관 */
  grid-template-rows: minmax(0, 1fr) auto;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  flex: 1;
  min-height: 0;
}
```

그리고 기존:

```css
.app__left {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-height: 0;
}
```

교체:

```css
.app__left {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-height: 0;
  /* 좌측 관리 존은 도크 행까지 전체 높이 — 도크는 중앙+우측 아래에만 (E7b 스펙 v2) */
  grid-row: 1 / 3;
}
```

- [x] **Step 10: App 배선.** `apps/desktop/src/renderer/src/App.tsx` — 편집 5곳.

(a) lucide import 기존:

```ts
import { CloudUpload, DownloadCloud, GitMerge, Moon, RefreshCw, Sun } from 'lucide-react'
```

교체:

```ts
import { CloudUpload, DownloadCloud, GitMerge, Moon, RefreshCw, Sun, Terminal } from 'lucide-react'
```

(b) ui import 기존:

```ts
import { NOTICE_TTL_MS, useRepositoryStore } from './store/repository-store'
```

교체:

```ts
import {
  clampDockHeight,
  loadDockHeight,
  loadDockOpen,
  saveDockHeight,
  saveDockOpen,
} from './ui/terminal/dock-height'
import { TerminalDock } from './ui/terminal/TerminalDock'
import { NOTICE_TTL_MS, useRepositoryStore } from './store/repository-store'
```

(c) 상태 기존:

```ts
  const [confirmingRemoveRemote, setConfirmingRemoveRemote] = useState<{ name: string } | null>(
    null,
  )
```

교체:

```ts
  const [confirmingRemoveRemote, setConfirmingRemoveRemote] = useState<{ name: string } | null>(
    null,
  )

  // E7b 터미널 도크 — 중앙+우측 하단. 열림·높이는 설정 영속(rightWidth 관례).
  // 접힘은 숨김일 뿐 언마운트가 아니다 — 언마운트하면 xterm 인스턴스가 죽어 세션 유지가 깨진다 (스펙)
  const [dockOpen, setDockOpen] = useState<boolean>(() => loadDockOpen())
  const [dockHeight, setDockHeight] = useState<number>(() =>
    clampDockHeight(loadDockHeight(), window.innerHeight),
  )
  const toggleDock = () => {
    setDockOpen((prev) => {
      saveDockOpen(!prev)
      return !prev
    })
  }
  const startDockResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const onMove = (move: PointerEvent) => {
      setDockHeight(clampDockHeight(window.innerHeight - move.clientY - 20, window.innerHeight))
    }
    const onUp = (up: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      saveDockHeight(clampDockHeight(window.innerHeight - up.clientY - 20, window.innerHeight))
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }
```

(c-2) 창 리사이즈 재클램프 — 기존 창 리사이즈 effect의:

```ts
    const onWindowResize = () => {
      setViewportWidth(window.innerWidth)
      setRightWidth((width) => clampRightWidth(width, window.innerWidth))
    }
```

교체:

```ts
    const onWindowResize = () => {
      setViewportWidth(window.innerWidth)
      setRightWidth((width) => clampRightWidth(width, window.innerWidth))
      // 도크도 창 세로 축소를 따라 재클램프 — 60% 상한 초과로 1행이 짓눌리는 것을 막는다 (품질 리뷰, rightWidth 선례)
      setDockHeight((height) => clampDockHeight(height, window.innerHeight))
    }
```

(d) 단축키 — notice 타이머 effect 기존:

```ts
  useEffect(() => {
    if (store.notice === null) return
    const timer = window.setTimeout(() => store.clearNotice(), NOTICE_TTL_MS)
    return () => window.clearTimeout(timer)
    // store 객체는 렌더마다 새 참조 — notice 값 변화에만 반응해야 임의 갱신이 타이머를 연장하지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.notice])
```

교체:

```ts
  useEffect(() => {
    if (store.notice === null) return
    const timer = window.setTimeout(() => store.clearNotice(), NOTICE_TTL_MS)
    return () => window.clearTimeout(timer)
    // store 객체는 렌더마다 새 참조 — notice 값 변화에만 반응해야 임의 갱신이 타이머를 연장하지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.notice])

  // ⌘`(맥)/Ctrl+` — 터미널 도크 토글 (E7b). 수정키 조합이라 입력 필드와 충돌하지 않는다
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === '`') {
        event.preventDefault()
        setDockOpen((prev) => {
          saveDockOpen(!prev)
          return !prev
        })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
```

(e) 헤더 토글 버튼 — 기존(새로고침 버튼과 헤더 닫힘):

```tsx
          <Button
            variant="ghost"
            size="sm"
            isDisabled={store.busy}
            onPress={() => void store.refresh()}
            testId="refresh"
          >
            <RefreshCw size={13} aria-hidden="true" /> 새로고침
          </Button>
        </div>
      </header>
```

교체:

```tsx
          <Button
            variant="ghost"
            size="sm"
            isDisabled={store.busy}
            onPress={() => void store.refresh()}
            testId="refresh"
          >
            <RefreshCw size={13} aria-hidden="true" /> 새로고침
          </Button>
          <Button variant="ghost" size="sm" onPress={toggleDock} testId="terminal-toggle">
            <Terminal size={13} aria-hidden="true" /> 터미널
          </Button>
        </div>
      </header>
```

(f) 도크 렌더 — 기존(main 닫힘 앞, 우측 열 마지막):

```tsx
        </div>
      </main>
```

교체:

```tsx
        </div>
        {/* E7b 터미널 도크 — 접힘은 display:none(세션 유지). 행(auto)은 숨김 시 0으로 접힌다 */}
        {store.repoPath !== null && (
          <div className="app__dock" style={{ display: dockOpen ? 'block' : 'none' }}>
            <TerminalDock
              repoPath={store.repoPath}
              open={dockOpen}
              height={dockHeight}
              onResizeStart={startDockResize}
              onClose={toggleDock}
            />
          </div>
        )}
      </main>
```

- [x] **Step 11: 게이트** — 루트 `pnpm test` → **410 passed**. `pnpm typecheck` Done. `pnpm --filter @git-gui/desktop build` 성공. `cd apps/desktop && npx electron-vite build && npx playwright test e2e/smoke.spec.ts` → **47 passed**(도크 기본 접힘 — 기존 무회귀 확인).

- [x] **Step 12: Commit**

```bash
git add packages/ipc-contract/src/index.ts packages/ipc-contract/test/settings.test.ts apps/desktop/src/renderer/src/ui/terminal/dock-height.ts apps/desktop/test/dock-height.test.ts apps/desktop/src/renderer/src/ui/terminal/use-terminal-sessions.ts apps/desktop/src/renderer/src/ui/terminal/TerminalDock.tsx apps/desktop/src/renderer/src/ui/terminal/terminal-dock.css apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/layout.css
git commit -m "feat(desktop): E7b 터미널 도크 — 중앙+우측 하단 그리드 행·탭·높이 드래그·설정 영속·⌘\` 토글

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: E2E — 터미널 4건

**Files:**
- Modify: `apps/desktop/e2e/smoke.spec.ts` (+4)

- [x] **Step 1: E2E 추가.** 파일 맨 끝(Task 2의 감시 테스트 닫는 `})` 뒤)에 추가:

```ts

test('터미널 — 열고 명령을 치면 결과가 보인다 (E7b)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  // 터미널 토글은 dockOpen을 settings.json에 영속한다(rightWidth 선례) — 격리된 userData가
  // 없으면 이전 터미널 테스트가 남긴 열림 상태를 물려받아 이번 클릭이 반대로 닫아버린다
  // (실측: 기본 워커·순차 실행에서도 재현되는 결정적 실패 — 실측 뒤 추가한 최소 보정)
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('terminal-toggle').click()
    await expect(window.getByTestId('terminal-dock')).toBeVisible()
    await expect(window.locator('.terminal-dock__view .xterm')).toBeVisible()
    // pty가 키 입력을 버퍼링하므로 프롬프트 완성을 기다릴 필요 없다 (실측 2: echo 왕복)
    await window.locator('.terminal-dock__view').first().click()
    await window.keyboard.type('echo e7b-roundtrip-marker')
    await window.keyboard.press('Enter')
    await expect(window.getByTestId('terminal-body')).toContainText('e7b-roundtrip-marker', {
      timeout: 10_000,
    })
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('터미널 — 터미널에서 저장하면 화면이 따라온다 (E7b 감시 연동)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  // dockOpen 영속 격리 — 위 테스트와 동일 사유 (실측 후 최소 보정)
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('history-count')).toHaveText('1')
    await window.getByTestId('terminal-toggle').click()
    await window.locator('.terminal-dock__view').first().click()
    // 로그인 쉘 rc가 cwd를 바꿀 수 있다 — 테스트는 명시적으로 저장소로 이동해 rc 의존을 없앤다
    await window.keyboard.type(`cd "${repo}" && git commit --allow-empty -m e7b-terminal-commit`)
    await window.keyboard.press('Enter')
    await expect(window.getByTestId('history-count')).toHaveText('2', { timeout: 10_000 })
    await expect(window.getByTestId('history-list')).toContainText('e7b-terminal-commit')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('터미널 — 탭을 추가·전환·닫을 수 있다 (E7b)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  // dockOpen 영속 격리 — 위 테스트와 동일 사유 (실측 후 최소 보정)
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('terminal-toggle').click()
    await expect(window.locator('.terminal-dock__tab')).toHaveCount(1)
    await window.getByTestId('terminal-new-tab').click()
    await expect(window.locator('.terminal-dock__tab')).toHaveCount(2)
    // 첫 탭으로 전환 후 둘째 탭 닫기
    await window.locator('.terminal-dock__tab-name').first().click()
    await window.locator('.terminal-dock__tab-close').nth(1).click()
    await expect(window.locator('.terminal-dock__tab')).toHaveCount(1)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('터미널 — 접었다 펴도 세션이 유지된다 (E7b)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  // dockOpen 영속 격리 — 위 테스트와 동일 사유 (실측 후 최소 보정)
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('terminal-toggle').click()
    await window.locator('.terminal-dock__view').first().click()
    await window.keyboard.type('echo keep-alive-proof')
    await window.keyboard.press('Enter')
    await expect(window.getByTestId('terminal-body')).toContainText('keep-alive-proof', {
      timeout: 10_000,
    })
    // 접기 — 숨김일 뿐 세션은 산다 (스펙)
    await window.getByTestId('terminal-close').click()
    await expect(window.getByTestId('terminal-dock')).toBeHidden()
    await window.getByTestId('terminal-toggle').click()
    await expect(window.getByTestId('terminal-dock')).toBeVisible()
    await expect(window.getByTestId('terminal-body')).toContainText('keep-alive-proof')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})
```

- [x] **Step 2: 게이트** — `cd apps/desktop && npx electron-vite build && npx playwright test e2e/smoke.spec.ts` → **51 passed**. 신규 4건을 각각 단독(-g)으로 1회씩 재실행해 non-flaky 확인. 루트 `pnpm test` → 410, `pnpm typecheck` Done.

- [x] **Step 3: Commit**

```bash
git add apps/desktop/e2e/smoke.spec.ts
git commit -m "test(desktop): E7b E2E — 터미널 echo 왕복·터미널 저장 자동 갱신·탭·접기 세션 유지

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

> **실행 기록(편차 3건 — 전부 소급 반영됨):** ① spawn-helper 실행 권한 결손(위 Task 1 실측 추가 — fix(build) 별도 커밋), ② 4개 테스트에 `GIT_GUI_USER_DATA` 임시 격리 적용 — terminal-toggle이 dockOpen을 영속해 공유 userData로 다음 테스트에 새는 것을 차단(기존 rightWidth·theme 테스트와 동일 관례, 위 블록에 반영), ③ Task 1의 깨진 $SHELL 테스트가 권한 결손 덕에 우연히 통과 중이었음이 드러나 spawn 스파이로 교체(test(desktop) 별도 커밋 — 단언 무약화).

---

### Task 6: 최종 게이트 + 공식 스크린샷 2장 + README

- [x] **Step 1: 전체 게이트** — 순서대로 전부 exit 0:
  - 루트 `pnpm test` → **410 passed**
  - 루트 `pnpm typecheck` → 전 프로젝트 Done
  - `pnpm --filter @git-gui/desktop build`
  - `pnpm --filter @git-gui/desktop e2e` → **57 passed** (smoke 51 + hosting 6, 실행 내내 창 미노출)
  - `find apps/desktop/test-results -name 'last-screen-*.png'` → 0건

- [x] **Step 2: README 반영.** `README.md` 기존(E7a 문단 끝 문장):

```
원격 브랜치 가져오기(추적)·원격에서 지우기·지금과 비교까지 됩니다.
```

교체:

```
원격 브랜치 가져오기(추적)·원격에서 지우기·지금과 비교까지 됩니다. E7b로 중앙+우측 하단에 터미널 도크가 생겼습니다 — 탭 여러 개(상한 8)의 진짜 쉘(node-pty)이 저장소 루트에서 열리고(⌘\`/헤더 버튼 토글, 접어도 세션 유지, 높이 드래그 기억), 터미널이나 다른 도구로 저장소를 바꾸면 .git 감시가 화면(변경·역사·실험 공간)을 자동으로 따라 갱신합니다.
```

- [x] **Step 3: 공식 스크린샷 2장** — `test-results/` + 세션 scratchpad 사본(경로 없으면 `mkdir -p`: `/private/tmp/claude-501/-Users-sangyeop-kim-git-gui/b4ef6d32-042d-440c-8252-b8944659aa01/scratchpad`). **생성 후 e2e 재실행 금지.** 임시 파일 `apps/desktop/e2e/tmp-shots-e7b.spec.ts`:

```ts
// 임시 파일 — 공식 스크린샷 생성 후 삭제한다 (커밋 금지)
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { execGitOrThrow } from '@git-gui/git-process'

const APP_ROOT = join(__dirname, '..')
const SCRATCH =
  '/private/tmp/claude-501/-Users-sangyeop-kim-git-gui/b4ef6d32-042d-440c-8252-b8944659aa01/scratchpad'

test('공식 스크린샷 — E7b 터미널 도크·탭 2장', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'git-gui-shot-'))
  await execGitOrThrow(['init', '--initial-branch=main'], { cwd: repo })
  await execGitOrThrow(['config', 'user.name', 'E2E'], { cwd: repo })
  await execGitOrThrow(['config', 'user.email', 'e2e@test.local'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'v1\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', '첫 화면 저장'], { cwd: repo })
  // terminalOpen이 공유 userData에 영속되면 toggle이 닫기로 뒤집힌다 — 격리 필수 (Task 5·6 실측)
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-shot-data-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: userData },
  })
  try {
    const window = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]!.setSize(1440, 900)
    })
    await expect.poll(() => window.evaluate(() => window.innerWidth)).toBe(1440)
    // (1) 도크 열림 + 명령 '출력' — 타이핑 줄(printf 'result-%s\n' …)과 출력 줄(result-e7b-official-shot)이
    // 문자열로 구분되므로, 출력 단언은 실행 완료를 증명한다 (Task 6 검수 보완)
    await window.getByTestId('terminal-toggle').click()
    await expect(window.locator('.terminal-dock__view .xterm')).toBeVisible()
    await window.locator('.terminal-dock__view').first().click()
    await window.keyboard.type("printf 'result-%s\\n' e7b-official-shot")
    await window.keyboard.press('Enter')
    await expect(window.getByTestId('terminal-body')).toContainText('result-e7b-official-shot', {
      timeout: 10_000,
    })
    await window.screenshot({ path: 'test-results/e7b-terminal-dock.png' })
    // (2) 탭 2개 — 세션 탭 바
    await window.getByTestId('terminal-new-tab').click()
    await expect(window.locator('.terminal-dock__tab')).toHaveCount(2)
    await window.screenshot({ path: 'test-results/e7b-terminal-tabs.png' })
    await copyFile('test-results/e7b-terminal-dock.png', join(SCRATCH, 'e7b-terminal-dock.png'))
    await copyFile('test-results/e7b-terminal-tabs.png', join(SCRATCH, 'e7b-terminal-tabs.png'))
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})
```

실행·정리(재빌드 없이): `cd apps/desktop && npx playwright test e2e/tmp-shots-e7b.spec.ts` → `rm apps/desktop/e2e/tmp-shots-e7b.spec.ts` + `rm -rf apps/desktop/test-results/tmp-shots-e7b-*`. **육안 검수(Read로 실제 열람)**: (a) e7b-terminal-dock — 도크가 중앙+우측 아래에만 있고 **좌측 열은 바닥까지 온전**한지, 터미널에 `e7b-official-shot` 출력이 보이는지, (b) e7b-terminal-tabs — 탭 2개(`1: 쉘`·`2: 쉘`)와 + 버튼·접기가 온전한지. 이후 e2e 재실행 금지.

- [x] **Step 4: Commit** (README만)

```bash
git add README.md
git commit -m "docs: README — E7b 터미널 도크(탭 세션·⌘\` 토글·fs watch 자동 갱신) 반영

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(플랜 문서는 실행을 마친 컨트롤러가 실행 기록을 붙여 별도 `docs:` 커밋으로 남긴다 — E6b·E7a 관례.)

## 인용 앵커 검증 기록

**스크립트 실검증(2026-07-22, main=9bb609d):** "기존:" 블록 28개 전수 — 기준선 파일에서 **정확히 1회 매칭 28개, 불일치 0개**. 오타 함정·placeholder 없음.

작성 시점(main=9bb609d) 실측 원문에서 발췌한 앵커: App.tsx(lucide import·store import·confirmingRemoveRemote 상태 블록·notice 타이머 effect·새로고침 버튼+헤더 닫힘·`        </div>\n      </main>` 꼬리), layout.css(.app__main 블록·.app__left 블록), preload(import 블록·repo 블록·SETTINGS expose 꼬리), ipc-contract(CHANNELS 선두 3줄·SETTINGS_CHANNELS 꼬리·AppSettings·sanitizeSettings rightWidth 분기), settings.test.ts('객체가 아니면 빈 설정' 블록), main/index.ts(핸들러 import 3줄·whenReady 등록 4줄), store(guard 전문·init 전문·refresh 전문·clearNotice 선언부), git-handlers(repoStatus 핸들러), smoke.spec.ts(마지막 테스트 꼬리 — 파일 끝 추가만). 작성 중 미확정이던 앵커 5곳(ipc-contract repo 블록·git-handlers import 줄·assertAllowedRepo·env.d.ts·store openRepository)은 **작성 완료 전에 전부 실독해 확정 앵커로 치환**했다 — assertAllowedRepo는 이미 export되어 있어 수정 단계 자체를 무력화했다. 구현 각 태스크는 앵커 grep 정확 1회를 확인하고 0/2+면 BLOCKED로 보고한다(선행 태스크 산출 앵커는 순서 준수 — 예: Task 5의 삽입 위치는 Task 2가 만든 감시 테스트 꼬리다).

## Self-review 수정 기록 (인라인 반영)

1. **스펙 "pending 후 1회 갱신" 폐기 — 실측 1로 반증.** 앱 자신의 작업이 busy 중 이벤트를 만들므로 pending은 모든 작업을 이중 갱신한다. busy 드롭(guard 재진입 거부) + 종료 후 800ms 억제 창으로 교체(스펙 보정, 근거 병기).
2. **감시 push의 window 배선 제거** — createWindow에서 window를 빼내는 재구조 대신 invoke `event.sender`로 목적지를 잡는다(터미널도 동일). isDestroyed 가드 + sender destroyed 시 감시 정리.
3. **도크 접힘을 언마운트가 아니라 숨김으로** — 언마운트하면 xterm 인스턴스·구독이 죽어 "세션 유지"가 깨지고 main pty가 고아가 된다. display:none + `open` prop으로 첫 열림에만 세션 생성(앱 시작만으로 쉘을 스폰하지 않음).
4. **터미널 commit E2E의 rc 의존 제거** — 로그인 쉘 rc가 cwd를 바꿀 수 있어 명시적 `cd "<repo>" &&`로 고정.
5. **externalRefresh는 hosting을 부르지 않는다** — 감시 폭주가 네트워크를 때리지 않게 refresh()와 분리(의미론은 동일: 선택 무효화).
6. **resize 바닥 클램프** — fit addon이 극단 레이아웃에서 0·소수를 줄 수 있어 pty.resize에 min 2×1을 깐다.
7. **테스트 수 재검산(품질 리뷰 반영 재수정)** — resolveShell 3 + clampPtyDims 2 + spawn 친절화 1 + watch-filter 7(필터 4·디바운스 3) + settings 1 + dock-height 4 = +18 → 392+18=**410**. smoke 46+1(감시)+4(터미널)=**51**, 전체 57.

## 후속 노트 (이관 후보)

- **터미널 테마 연동** — xterm 팔레트가 앱 라이트/다크와 독립(고정 다크). 토큰 매핑 검토.
- **작업 트리 파일 편집 감시** — 변경 목록 실시간화(스펙 범위 밖 명시).
- **감시 억제 창의 경합** — 앱 작업 직후 800ms 안의 진짜 외부 변경은 다음 이벤트까지 화면이 낡는다(수용된 트레이드오프 — 실측 1).
- **externalRefresh의 선택 무효화** — 터미널 커밋마다 보고 있던 diff·비교 뷰가 닫힌다(수동 새로고침과 동일 의미론). 유지 가능한 선택(해시 기준 재조회) 검토.
- **세션 8개 상한·스크롤백 1000행** — 필요 시 설정화.
- **xterm 링크 클릭·검색·분할** — addon 후속.
- **E7c 연동** — 세션 생성 cwd 인자(워크트리 경로)·탭 라벨에 워크트리 이름.

## 실행 기록 (2026-07-23, subagent-driven — 태스크별 스펙 byte-match 리뷰 + 품질 리뷰 + 최종 통합 리뷰 전부 통과)

- 커밋 14건: 07368cc(T1) · 4eb2ec6(T1 보완) · 2fcd2da(pnpm 통합) · 77974d6(T2) · ade1061(T2 보완) · 184d489(T3) · 3dfd3b9(T3 보완) · 487400e(T4) · 15dba2c(T4 보완) · 322edf9(spawn-helper) · 8408876(쉘 테스트 교체) · 130fa00(T5 E2E) · d027563(T6 README) · 9505e39(통합 리뷰 보완). 최종 게이트: 단위 **410** · typecheck 전부 Done · E2E **57**(smoke 51 + hosting 6) · last-screen 0건 · 공식 스크린샷 2장 육안 검수(출력 줄 분리 재촬영 포함) 통과.
- **품질 리뷰 Important 6건 → 보완 커밋으로 전부 폐쇄·재승인:** ① 매니저 clampPtyDims 추출·spawn 친절화·env 캐스트 제거, ② fs.watch 비동기 error 무해화 + 충돌 초안 보존(externalRefresh가 conflictFile 유지), ③ 창 파괴 시 pty 세션 정리(WeakSet sender당 1회) + resize 유한성 + assertString 공용화, ④ 도크 높이 창 축소 재클램프, ⑤ (통합) repoWatch destroyed 훅 중복 등록 해소.
- **실행 중 실측 발견 4건(플랜 소급 반영):** ⓐ Task 1의 package.json pnpm 필드가 워크스페이스 onlyBuiltDependencies를 덮어써 Electron postinstall 붕괴 → pnpm-workspace.yaml 통합(2fcd2da). ⓑ 억제 창이 읽기 전용 init까지 무장해 첫 외부 이벤트를 삼킴 → init에서 lastGuardEndAt 리셋. ⓒ **node-pty 1.1.0 발행 tarball의 spawn-helper 실행 권한 결손**(모든 새 설치에서 pty 전멸) → desktop postinstall chmod 755 자가치유(322edf9). 워크스페이스 프로젝트의 postinstall은 pnpm 10 빌드 차단 정책의 대상이 아님을 실증(의존성 스코프인 patch-package·onlyBuiltDependencies로는 불가한 위치 선택 근거). ⓓ 깨진 $SHELL 단위 테스트가 ⓒ의 결손 덕에 우연히 통과 중이었음(정상 패키징에선 exec 실패가 자식에서 비동기 발생) → spawn 스파이로 결정적 대체(8408876). 부수: 도크 설정(terminalOpen) 영속이 공유 userData로 테스트 간 누출 → E2E 4건 + 스크린샷 스펙에 GIT_GUI_USER_DATA 격리 적용(기존 관례).

### 리뷰 Minor 후속 노트 (이관 — 전부 비차단)

- **(T5 실측 — 아키텍처 갭) 깨진 $SHELL의 침묵 실패** — 정상 패키징에선 spawn이 동기 throw하지 않고 자식 exec 실패가 onExit(exitCode≠0)으로만 와서, 매니저의 친절 메시지가 그 시나리오에 더는 발화하지 않는다(탭에 "(종료)"만). renderer의 onExit에서 exitCode≠0 + 무출력 조합에 안내 문구 표출 검토.
- **(T2 억제 창 쌍둥이)** 앱 작업 직후 800ms 내 진짜 외부 변경은 삼켜진다(다음 이벤트·수동 새로고침으로 회복). **주의: "쓰기 작업만 무장" naive fix는 위험** — 읽기 경로(git status)도 index를 재작성할 수 있다. 근본 해법은 스냅샷 시그니처 dedup.
- **(T2) repoWatch 단일 stopWatching의 다중 창 한계**(현 단일 창 앱에선 잠복) · externalRefresh의 선택 무효화(충돌 뷰 외 diff·비교 뷰는 닫힘 — 해시 기준 유지 검토).
- **(T4) 빠른 토글 이중 세션 스폰(스테일 클로저, in-flight 가드 검토)** · 저장소 전환 시 옛 cwd 탭 잔존(탭 라벨에 저장소 병기 or E7c에서 정리) · setState 업데이터 내 saveDockOpen 부수효과 · ⌘`가 macOS 창 순환 단축키와 겹침(단일 창이라 실해 없음).
- **(T4/T5) xterm 포커스 클릭 타깃** — `.terminal-dock__view` 클릭의 포커스 레이스 가능성(플레이크 시 .xterm 스크린/helper-textarea로 전환). **(T1)** 실스폰 echo 왕복 단위 smoke는 E2E가 대체(후속 불요 판단 가능).
- **(스펙 이관)** 터미널 테마 앱 연동 · 작업 트리 감시 · 세션 상한/스크롤백 설정화 · xterm 링크/검색 addon · E7c cwd 인자.
