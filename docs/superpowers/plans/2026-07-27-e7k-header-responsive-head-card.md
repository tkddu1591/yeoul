# E7k 헤더 반응형 + 워크트리 HEAD 카드 보강 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 창이 좁아져도 앱 전체가 가로로 스크롤되지 않게 헤더를 접고, 워크트리 호버 카드에 커밋 제목·시각·(분리됨이면) 포함 브랜치를 더한다.

**Architecture:** 접힘 판정은 순수 함수(`isCompactHeader`)로 `column-resize.ts`에 두고 App이 이미 가진 `viewportWidth`로 계산해 `.app__header--compact` 클래스 하나만 토글한다 — 라벨·배지 숨김은 전부 CSS가 한다. 카드 정보는 E7j의 호버 1회 호출(`worktrees.forkPoint`)을 `worktrees.headInfo`로 통합·확장해 git 왕복을 늘리지 않는다.

**Tech Stack:** 기존과 동일(Electron·React·zustand·vitest·Playwright). **신규 의존성 없음**.

**Branch:** `feature/e7k-header-head-card` (main 66e8e0c 이후에서 생성)

**게이트 기준선:** 루트 테스트 **512**, desktop e2e **89**(smoke 83 + hosting 6). 태스크마다 "+N(실측 정정)"으로 누적하고, 실측이 다르면 구현자가 편차 보고·컨트롤러가 표를 정정한다(E7g~E7j 관례).

## 사전 실측 (플랜 작성 시 확인 — 재확인 불요)

1. **헤더 넘침 수치**(프로브): 1200px 창에서 `app__status` 394 + `app__actions` 683 + gap 40 + padding 100 = 1217 > 1200 → `app__repo`가 **폭 0**으로 뭉개짐. 970px에서 `headerScrollWidth 1059 > clientWidth 970`이고 `documentElement.scrollWidth 1059`로 **문서 전체가 가로 스크롤**.
2. **헤더 버튼의 라벨은 순수 텍스트 노드**다(`<DownloadCloud/> 받아오기 <Badge>pull</Badge>`) — CSS로 선택 숨김이 불가능하므로 **라벨을 `<span>`으로 감싸야** 한다. 대상: App.tsx의 `merge-open`·`pull`·`backup`·`refresh`·`terminal-toggle`(설정은 이미 아이콘만) + `ShelfPopover`(보관함)·`ReviewPopover`(리뷰) 트리거.
3. **`Badge`는 버튼 안(git 배지)과 밖(↑↓)에 모두 쓰인다** — 숨김 규칙은 `.ui-button .ui-badge`로 한정해야 ↑↓가 살아남는다.
4. **`computeColumns`는 `ui/column-resize.ts`**에 있고 App이 `viewportWidth` 상태를 이미 관리한다(App.tsx:177·209).
5. **git 출력 형식**: `git log -1 --format=%s%x1f%ct` → `제목\x1f1785101297`(단일 줄, US 구분자). `git branch --contains HEAD --format=%(refname:short)` → 브랜치명 줄 단위.
6. **E7j `forkPoint` 소비처 전수**(교체 대상): `packages/git-adapter/src/client.ts`(구현·인터페이스), `packages/ipc-contract/src/index.ts`(선언·채널), `apps/desktop/src/preload/index.ts:47`, `apps/desktop/src/main/git-handlers.ts:211`, `store/repository-store.ts:213-214·413·1328-1337`, `components/WorktreesPanel.tsx:29·42·113-115`, `App.tsx:717-718`.

**플랜 명시 미확정(실독·같은 취지·편차 보고):** `ShelfPopover`·`ReviewPopover` 트리거 버튼의 정확한 JSX 모양, `formatRelativeTime`의 시그니처(E0-3b 유틸 — `(epochSeconds|ms, now)` 여부), smoke.spec.ts 헬퍼 관례(무인자 `createRepoWithChange()`·`GIT_GUI_E2E_REPO`·`GIT_GUI_USER_DATA`).

---

### Task 1: `isCompactHeader` 순수 함수

**Files:**
- Modify: `apps/desktop/src/renderer/src/ui/column-resize.ts`
- Test: `apps/desktop/test/column-resize.test.ts`

- [ ] **Step 1: Red — 경계 테스트 3건.** `apps/desktop/test/column-resize.test.ts`의 기존 describe 뒤(실독)에 추가:

```ts
describe('isCompactHeader (E7k)', () => {
  it('임계값 미만이면 접는다', () => {
    expect(isCompactHeader(1179)).toBe(true)
  })

  it('임계값과 같으면 펴 둔다', () => {
    expect(isCompactHeader(1180)).toBe(false)
  })

  it('넓으면 펴 둔다', () => {
    expect(isCompactHeader(1600)).toBe(false)
  })
})
```

import에 `isCompactHeader`를 추가한다(기존 import 줄 실독).

- [ ] **Step 2: Red 확인** — `npx vitest run apps/desktop/test/column-resize.test.ts` 실행, 3건이 "isCompactHeader is not a function"으로 실패.

- [ ] **Step 3: 구현.** `ui/column-resize.ts` 파일 끝에 추가:

```ts
/**
 * 헤더 접힘 임계 폭 (E7k) — 이 아래에서는 액션 버튼이 아이콘만 남는다.
 * 실측: 1200px 창에서 상태 394 + 액션 683 + gap 40 + padding 100 = 1217이라
 * 저장소 이름 자리가 0으로 뭉개졌다. 이름 자리를 지키는 지점이 1180이다.
 */
export const HEADER_COMPACT_WIDTH = 1180

/** 창이 좁아 헤더 라벨을 접어야 하는가 — 판정만 하고 숨김은 CSS가 한다 (E7k) */
export function isCompactHeader(viewportWidth: number): boolean {
  return viewportWidth < HEADER_COMPACT_WIDTH
}
```

- [ ] **Step 4: Green 확인** — `npx vitest run apps/desktop/test/column-resize.test.ts` 전건 통과.

- [ ] **Step 5: 게이트** — 루트 `pnpm test` → **515(512+3 — 실측 보고)**, `pnpm typecheck` 전부 Done.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/ui/column-resize.ts apps/desktop/test/column-resize.test.ts
git commit -m "feat(desktop): E7k 헤더 접힘 판정 순수 함수 — isCompactHeader(1180)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: 헤더 반응형 — 라벨 접기 + 문서 스크롤 차단

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.tsx` (헤더 클래스·라벨 span)
- Modify: `apps/desktop/src/renderer/src/components/ShelfPopover.tsx` · `ReviewPopover.tsx` (트리거 라벨 span)
- Modify: `apps/desktop/src/renderer/src/layout.css`
- Modify: `apps/desktop/src/renderer/src/components/branch-switcher.css`

- [ ] **Step 1: 헤더 클래스 토글.** App.tsx에서 `columns` 계산 근처(실독, 209행 부근)에 추가:

```tsx
  // E7k — 창이 좁으면 헤더 액션이 아이콘만 남는다(이름은 Tooltip이 담당). 판정만 여기서, 숨김은 CSS
  const compactHeader = isCompactHeader(viewportWidth)
```

`import { computeColumns, … }` 줄에 `isCompactHeader`를 추가하고, 헤더 엘리먼트를 교체:

```tsx
      <header className={`app__header${compactHeader ? ' app__header--compact' : ''}`}>
```

- [ ] **Step 2: 라벨 span 6곳.** App.tsx의 헤더 버튼 라벨을 감싼다(각 버튼의 아이콘·배지는 그대로):

```tsx
            <GitMerge size={13} aria-hidden="true" /> <span className="app__btn-label">합치기</span>{' '}
            <Badge tone="git">merge</Badge>
```

```tsx
            <DownloadCloud size={14} aria-hidden="true" />{' '}
            <span className="app__btn-label">받아오기</span> <Badge tone="git">pull</Badge>
```

```tsx
            <CloudUpload size={14} aria-hidden="true" /> <span className="app__btn-label">백업</span>{' '}
            <Badge tone="git">push</Badge>
```

```tsx
            <RefreshCw size={13} aria-hidden="true" /> <span className="app__btn-label">새로고침</span>
```

```tsx
            <Terminal size={13} aria-hidden="true" /> <span className="app__btn-label">터미널</span>
```

(설정 버튼은 이미 아이콘만이라 손대지 않는다.)

- [ ] **Step 3: 팝오버 트리거 라벨 2곳.** `ShelfPopover.tsx`의 트리거(실독 — 35행 부근 `<Archive size={13} aria-hidden="true" /> 보관함{' '}`)와 `ReviewPopover.tsx`의 트리거 라벨을 같은 방식으로 `<span className="app__btn-label">…</span>`으로 감싼다. 두 컴포넌트는 헤더 전용이 아니지만 현재 사용처가 헤더뿐이므로(실독 확인) 클래스만 붙이고 동작은 무변.

- [ ] **Step 4: CSS.** `layout.css`에서 기존:

```css
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}
```

교체:

```css
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  /* E7k — 앱 셸은 절대 스크롤되지 않는다. 스크롤은 각 패널이 자기 영역에서만 갖는다
     (실측: 970px 창에서 헤더가 1059px로 넘쳐 문서 전체가 가로 스크롤됐다) */
  overflow: hidden;
}
```

`.app__repo` 블록에 최소 폭을 더한다(기존 `min-width: 0` 줄 교체):

```css
  /* E7k — 저장소 이름이 통째로 사라지지 않게 자리를 지킨다(실측: 1200px에서 폭 0이었다) */
  min-width: 120px;
```

파일 끝(또는 `.app__actions` 블록 뒤)에 접힘 규칙 추가:

```css
/* E7k — 좁은 창: 액션 라벨과 버튼 안 배지를 접어 아이콘만 남긴다.
   이름은 E7j Tooltip이 담당하므로 정보 손실이 없다. ↑↓ 배지는 버튼 밖이라 살아남는다 */
.app__header--compact .app__btn-label {
  display: none;
}
.app__header--compact .ui-button .ui-badge {
  display: none;
}
.app__header--compact .app__status,
.app__header--compact .app__actions {
  gap: var(--space-2);
}
```

- [ ] **Step 5: 브랜치 스위처 상한.** `components/branch-switcher.css`의 기존:

```css
.branch-switcher__current {
  max-width: 180px;
```

교체:

```css
.branch-switcher__current {
  max-width: 180px;
```

그리고 파일 끝에 추가:

```css
/* E7k — 좁은 창에서는 브랜치 이름 자리도 줄인다(전체 이름은 Tooltip·스위처 목록에서 본다) */
.app__header--compact .branch-switcher__current {
  max-width: 120px;
}
```

- [ ] **Step 6: 게이트** — typecheck, 루트 `pnpm test` 유지, `cd apps/desktop && npx electron-vite build` 성공, `npx playwright test e2e/smoke.spec.ts` → **83 유지**(포그라운드 동기, **Bash timeout 파라미터 600000 필수**). 헤더 버튼 라벨 텍스트를 단언하는 기존 E2E가 있으면(실독) 아이콘 버튼은 `testId`로 찾으므로 대개 무영향 — 깨지면 같은 취지로 조정·편차 보고.

- [ ] **Step 7: 육안·수치 검증(필수).** 프로브 spec으로 **1200px·970px** 두 폭에서 다음을 측정해 보고한다: `documentElement.scrollWidth === clientWidth`(가로 스크롤 0), `.app__repo` 실제 폭 > 0, 970px에서 `.app__btn-label`이 안 보이고 `terminal-toggle` 버튼이 여전히 클릭되는지. 프로브는 확인 후 삭제하고 워킹트리를 클린으로 남긴다.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/components/ShelfPopover.tsx apps/desktop/src/renderer/src/components/ReviewPopover.tsx apps/desktop/src/renderer/src/layout.css apps/desktop/src/renderer/src/components/branch-switcher.css
git commit -m "fix(desktop): E7k 헤더 반응형 — 좁은 창 라벨 접기·저장소 이름 자리 보장·문서 가로 스크롤 차단

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: 엔진 `worktrees.headInfo` (forkPoint 통합·확장)

**Files:**
- Modify: `packages/domain/src/repository.ts` (WorktreeHeadInfo)
- Modify: `packages/git-adapter/src/client.ts` (worktrees.forkPoint → headInfo)
- Test: `packages/git-adapter/test/client.test.ts`

- [ ] **Step 1: 도메인 타입.** `packages/domain/src/repository.ts`의 `ForkPoint` 선언 뒤에 추가:

```ts
/** 워크트리 HEAD 요약 (E7k) — 호버 카드 한 장에 필요한 것을 한 번에 모은다 */
export interface WorktreeHeadInfo {
  /** HEAD 커밋 제목(첫 줄) */
  subject: string
  /** HEAD 커밋 시각(epoch 초) */
  committedAt: number
  /** 이 커밋을 포함하는 로컬 브랜치(최대 3개) — 분리됨 워크트리에서만 의미가 있다 */
  containedIn: string[]
  /** 포함 브랜치가 3개를 넘어 잘렸는가 */
  containedTruncated: boolean
  /** 기준 브랜치에서 갈라진 지점 — 없으면 null (E7j 규칙 그대로) */
  fork: ForkPoint | null
}
```

- [ ] **Step 2: Red — 엔진 테스트 4건.** `packages/git-adapter/test/client.test.ts`의 `worktrees.forkPoint` describe를 **`worktrees.headInfo (E7k)`로 이름만 바꾸고**(기존 4건은 `forkPoint(...)` → `(await ...headInfo(path))?.fork`로 호출부만 조정 — 기대값 유지), 그 안에 4건을 더한다:

```ts
    it('HEAD 커밋 제목과 시각을 담는다', async () => {
      const repo = await createFixtureRepo()
      await commitFile(repo, 'a.txt', 'a', '로그인 폼 검증 추가')
      const info = await createGitClient(repo).worktrees.headInfo(repo)
      expect(info).not.toBeNull()
      expect(info!.subject).toBe('로그인 폼 검증 추가')
      expect(info!.committedAt).toBeGreaterThan(1_600_000_000)
    })

    it('분리됨 워크트리는 그 커밋을 포함하는 브랜치를 담는다', async () => {
      const repo = await createFixtureRepo()
      await commitFile(repo, 'a.txt', 'a', 'base')
      const head = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
      await execGitOrThrow(['branch', 'holder'], { cwd: repo })
      const wtPath = `${repo}-detached`
      await execGitOrThrow(['worktree', 'add', '--detach', '--end-of-options', wtPath, head], { cwd: repo })
      const info = await createGitClient(repo).worktrees.headInfo(wtPath)
      expect(info!.containedIn).toContain('holder')
      expect(info!.containedTruncated).toBe(false)
      await execGitOrThrow(['worktree', 'remove', '--force', '--end-of-options', wtPath], { cwd: repo })
    })

    it('포함 브랜치가 많으면 3개까지만 담고 잘렸다고 알린다', async () => {
      const repo = await createFixtureRepo()
      await commitFile(repo, 'a.txt', 'a', 'base')
      for (const name of ['b1', 'b2', 'b3', 'b4']) {
        await execGitOrThrow(['branch', name], { cwd: repo })
      }
      const info = await createGitClient(repo).worktrees.headInfo(repo)
      expect(info!.containedIn).toHaveLength(3)
      expect(info!.containedTruncated).toBe(true)
    })

    it('커밋이 없는 저장소는 null이다', async () => {
      const repo = await createFixtureRepo()
      expect(await createGitClient(repo).worktrees.headInfo(repo)).toBeNull()
    })
```

- [ ] **Step 3: Red 확인** — `npx vitest run packages/git-adapter/test/client.test.ts` 실행, headInfo 미구현으로 실패 확인.

- [ ] **Step 4: 구현.** client.ts의 worktrees 인터페이스에서 기존 `forkPoint(path: string): Promise<ForkPoint | null>` 선언을 교체:

```ts
    /**
     * 워크트리 HEAD 요약 (E7k) — 제목·시각·포함 브랜치·분기점을 한 번에.
     * 계산 비용이 있어 호출부(호버)가 필요할 때만 부른다
     */
    headInfo(path: string): Promise<WorktreeHeadInfo | null>
```

구현은 기존 `forkPoint` 본문을 내부 헬퍼로 남기고 감싼다 — `async forkPoint(path) { … }`를 다음으로 교체:

```ts
      async headInfo(path) {
        // 제목·시각 — 커밋이 없으면(unborn) 카드에 담을 게 없다
        const head = await execGit(['log', '-1', '--format=%s%x1f%ct'], { cwd: path })
        if (head.exitCode !== 0) return null
        const [subject = '', rawTime = ''] = head.stdout.trim().split('\x1f')
        const committedAt = Number(rawTime)
        if (!Number.isFinite(committedAt)) return null
        // 포함 브랜치 — 분리됨 워크트리에서 "어디 소속인지"를 알려준다. 상한 3개
        const contains = await execGit(
          ['branch', '--contains', 'HEAD', '--format=%(refname:short)'],
          { cwd: path },
        )
        const all =
          contains.exitCode === 0
            ? contains.stdout
                .split('\n')
                .map((line) => line.trim())
                .filter((line) => line !== '')
            : []
        return {
          subject,
          committedAt,
          containedIn: all.slice(0, 3),
          containedTruncated: all.length > 3,
          fork: await forkPointOf(path),
        }
      },
```

그리고 파일의 worktrees 네임스페이스 **바깥**(같은 팩토리 함수 스코프 안, 실독으로 위치 결정)에 기존 forkPoint 본문을 헬퍼로 옮긴다:

```ts
  /** 기준 브랜치에서 갈라진 지점 (E7j) — headInfo가 감싸 쓴다 */
  async function forkPointOf(path: string): Promise<ForkPoint | null> {
    // (기존 forkPoint 본문을 그대로 옮긴다 — origin/HEAD→main→master 결정, 동일 SHA 가드,
    //  merge-base 필수, rev-list --left-right --count 해석까지 무변)
  }
```

**주의**: 헬퍼는 기존 본문을 **한 글자도 바꾸지 말고** 옮긴다(E7j-보완이 실측으로 확정한 로직이다). `WorktreeHeadInfo`를 `@git-gui/domain` import에 추가.

- [ ] **Step 5: Green 확인** — `npx vitest run packages/git-adapter/test/client.test.ts` 전건 통과(기존 forkPoint 4건이 headInfo 경유로 그대로 통과해야 한다).

- [ ] **Step 6: 게이트** — 루트 `pnpm test` → **519(515+4 — 실측 보고)**, typecheck Done.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/repository.ts packages/git-adapter/src/client.ts packages/git-adapter/test/client.test.ts
git commit -m "feat(git-adapter): E7k worktrees.headInfo — 제목·시각·포함 브랜치·분기점 한 번에

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: IPC·store 전환 (forkPoint → headInfo)

**Files:**
- Modify: `packages/ipc-contract/src/index.ts` · `apps/desktop/src/preload/index.ts` · `apps/desktop/src/main/git-handlers.ts`
- Modify: `apps/desktop/src/renderer/src/store/repository-store.ts`

- [ ] **Step 1: contract.** `worktrees` 블록의 기존 `forkPoint(repoPath: string, path: string): Promise<ForkPoint | null>` 선언을 교체:

```ts
    /** 워크트리 HEAD 요약 (E7k) — 호버 카드용. 실패·정보 없음은 null */
    headInfo(repoPath: string, path: string): Promise<WorktreeHeadInfo | null>
```

채널 상수 `worktreeForkPoint: 'worktree:fork-point'` → `worktreeHeadInfo: 'worktree:head-info'`. `WorktreeHeadInfo`를 domain re-export 목록에 추가(`ForkPoint`는 카드가 계속 쓰므로 유지).

- [ ] **Step 2: preload.** 기존 `forkPoint: (repoPath, path) => ipcRenderer.invoke(CHANNELS.worktreeForkPoint, repoPath, path),`를 교체:

```ts
    headInfo: (repoPath, path) => ipcRenderer.invoke(CHANNELS.worktreeHeadInfo, repoPath, path),
```

- [ ] **Step 3: main 핸들러.** git-handlers.ts의 기존 forkPoint 핸들러 블록(211행 부근 — `assertAllowedRepo`+`assertWorktreePath` 재사용 형태)에서 채널명과 호출만 바꾼다:

```ts
  ipcMain.handle(CHANNELS.worktreeHeadInfo, async (_event, repoPath: unknown, path: unknown) => {
    const root = assertAllowedRepo(repoPath)
    const target = await assertWorktreePath(root, assertString(path))
    return createGitClient(root).worktrees.headInfo(target)
  })
```

(경로 검증은 **그대로 유지** — 목록 밖 임의 경로 차단이 이 핸들러의 보안 축이다.)

- [ ] **Step 4: store.** repository-store.ts에서 상태·액션 이름을 바꾼다. 인터페이스 기존:

```ts
  forkPoints: Record<string, ForkPoint | null>
  loadForkPoint(path: string, headHash: string | null): Promise<void>
```

교체:

```ts
  /** 워크트리 HEAD 요약 캐시 — 키는 `경로::HEAD해시` (E7k) */
  headInfos: Record<string, WorktreeHeadInfo | null>
  /** 호버 시점에만 그 워크트리 하나를 조회한다 (E7k) */
  loadHeadInfo(path: string, headHash: string | null): Promise<void>
```

초기값 `forkPoints: {}` → `headInfos: {}`. 구현 기존:

```ts
  async loadForkPoint(path, headHash) {
    const { repoPath, forkPoints } = get()
    const key = `${path}::${headHash ?? ''}`
    if (!repoPath || key in forkPoints) return
    // 조회성 — guard(busy 잠금·에러 배너)를 쓰지 않고 실패는 조용히 null로 캐시한다
    try {
      const fork = await git().worktrees.forkPoint(repoPath, path)
      set({ forkPoints: { ...get().forkPoints, [key]: fork } })
    } catch {
      set({ forkPoints: { ...get().forkPoints, [key]: null } })
    }
  },
```

교체:

```ts
  async loadHeadInfo(path, headHash) {
    const { repoPath, headInfos } = get()
    const key = `${path}::${headHash ?? ''}`
    if (!repoPath || key in headInfos) return
    // 조회성 — guard(busy 잠금·에러 배너)를 쓰지 않고 실패는 조용히 null로 캐시한다
    try {
      const info = await git().worktrees.headInfo(repoPath, path)
      set({ headInfos: { ...get().headInfos, [key]: info } })
    } catch {
      set({ headInfos: { ...get().headInfos, [key]: null } })
    }
  },
```

(기존 store 구현이 위 문면과 다르면 실독한 형태를 기준으로 같은 취지로 교체하고 편차 보고. `WorktreeHeadInfo` import 추가, 더 이상 안 쓰면 `ForkPoint` import 정리 — 카드가 쓰면 유지.)

- [ ] **Step 5: 게이트** — `pnpm typecheck`(3면 정합을 타입이 강제한다 — WorktreesPanel·App이 아직 옛 이름을 쓰면 여기서 잡힌다. Task 5에서 고칠 것이므로 **이 태스크는 Task 5와 함께 커밋해도 된다** — 순서상 typecheck가 붉게 남으면 Task 5까지 진행 후 한 번에 확인하고 편차 보고), 루트 `pnpm test` 유지.

- [ ] **Step 6: Commit** (Task 5와 함께 검증되므로 커밋은 여기서 하되 게이트는 Task 5 후 최종 확인)

```bash
git add packages/ipc-contract/src/index.ts apps/desktop/src/preload/index.ts apps/desktop/src/main/git-handlers.ts apps/desktop/src/renderer/src/store/repository-store.ts
git commit -m "refactor(desktop): E7k forkPoint → headInfo 전환 — IPC 3면·store 캐시

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: 카드에 제목·시각·포함 브랜치

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/WorktreesPanel.tsx`
- Modify: `apps/desktop/src/renderer/src/App.tsx` (배선 이름)

- [ ] **Step 1: props 이름 교체.** `WorktreesPanelProps`의 기존 `forkPoints: Record<string, ForkPoint | null>`·`onHoverWorktree(path, headHash)`를 교체:

```ts
  /** HEAD 요약 캐시 — 키는 `경로::HEAD해시` (E7k) */
  headInfos: Record<string, WorktreeHeadInfo | null>
  /** 행에 마우스가 머물면 그 워크트리 하나만 조회한다 */
  onHoverWorktree(path: string, headHash: string | null): void
```

구조 분해에서 `forkPoints,` → `headInfos,`. import에서 `ForkPoint` → `WorktreeHeadInfo`(둘 다 쓰면 둘 다).

- [ ] **Step 2: 카드 내용.** 기존 forkKey·fork 계산(113-115행 부근):

```tsx
            // E7j — store의 forkPoints와 문자 단위로 일치해야 하는 캐시 키. 한 번만 계산해 재사용한다
            const forkKey = `${worktree.path}::${worktree.headHash ?? ''}`
            const fork = forkPoints[forkKey]
```

교체:

```tsx
            // E7j/E7k — store의 headInfos와 문자 단위로 일치해야 하는 캐시 키. 한 번만 계산해 재사용한다
            const headKey = `${worktree.path}::${worktree.headHash ?? ''}`
            const head = headInfos[headKey] ?? null
            const fork = head?.fork ?? null
```

카드의 meta 줄(기존 `출처 …` 블록)을 교체해 제목·시각을 잇는다:

```tsx
                    <div className="ui-tooltip__meta">
                      출처 {sourceChip(worktree.path, home)}
                      {worktree.headHash !== null && ` · HEAD ${worktree.headHash.slice(0, 7)}`}
                      {head !== null && ` · ${head.subject}`}
                      {head !== null && ` · ${formatRelativeTime(head.committedAt * 1000, Date.now())}`}
                      {worktree.path === currentPath && ' · 지금 여기'}
                      {worktree.locked && ' · 잠김'}
                    </div>
```

(`formatRelativeTime`의 인자 단위는 실독 — epoch 초를 받으면 `* 1000`을 빼고, `(value)` 한 인자면 그대로. 편차 보고.)

분기점 줄 뒤에 포함 브랜치 줄을 더한다(분리됨일 때만):

```tsx
                    {worktree.branch === null && head !== null && head.containedIn.length > 0 && (
                      <div className="ui-tooltip__meta">
                        {head.containedIn.join('·')}
                        {head.containedTruncated && ' 외 여러 곳'}에 포함된 저장
                      </div>
                    )}
```

`formatRelativeTime` import를 추가한다(`./relative-time` — 실독).

- [ ] **Step 3: App 배선.** App.tsx의 기존:

```tsx
              forkPoints={store.forkPoints}
              onHoverWorktree={(path, headHash) => void store.loadForkPoint(path, headHash)}
```

교체:

```tsx
              headInfos={store.headInfos}
              onHoverWorktree={(path, headHash) => void store.loadHeadInfo(path, headHash)}
```

- [ ] **Step 4: 게이트** — `pnpm typecheck` 전부 Done(Task 4의 붉은 부분이 여기서 해소된다), 루트 `pnpm test` 유지, build, `npx playwright test e2e/smoke.spec.ts` → **83 유지**(포그라운드 동기, Bash timeout 600000 필수).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/components/WorktreesPanel.tsx apps/desktop/src/renderer/src/App.tsx
git commit -m "feat(desktop): E7k 워크트리 카드 — 커밋 제목·시각·분리됨 포함 브랜치

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: E2E 3건 + 최종 게이트 + 스크린샷 + README

**Files:**
- Modify: `apps/desktop/e2e/smoke.spec.ts`
- Modify: `README.md`

- [ ] **Step 1: E2E 신규 3건.** smoke.spec.ts 끝에 추가:

```ts
test('E7k — 좁은 창에서도 앱이 가로로 스크롤되지 않는다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  // 긴 브랜치 이름이 방아쇠였다 — 그 상태로도 넘치지 않아야 한다
  await execGitOrThrow(
    ['checkout', '-q', '-b', 'feature/DW-1051-very-long-branch-name-for-header-overflow'],
    { cwd: repo },
  )
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('history-panel')).toBeVisible()
    for (const width of [1200, 970]) {
      await window.setViewportSize({ width, height: 800 })
      const box = await window.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        repoW: Math.round(
          (document.querySelector('.app__repo') as HTMLElement).getBoundingClientRect().width,
        ),
      }))
      expect(box.scrollW).toBe(box.clientW)
      expect(box.repoW).toBeGreaterThan(0)
    }
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('E7k — 좁은 창에서는 헤더 라벨이 접히고 버튼은 계속 눌린다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('history-panel')).toBeVisible()
    await window.setViewportSize({ width: 1400, height: 800 })
    await expect(window.getByTestId('pull').locator('.app__btn-label')).toBeVisible()
    await window.setViewportSize({ width: 970, height: 800 })
    await expect(window.getByTestId('pull').locator('.app__btn-label')).toBeHidden()
    // 접힌 상태에서도 아이콘 버튼은 그대로 동작한다(터미널 도크 토글로 확인)
    await window.getByTestId('terminal-toggle').click()
    await expect(window.getByTestId('terminal-dock')).toBeVisible()
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('E7k — 분리됨 워크트리 카드에 제목·시각·포함 브랜치가 뜬다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['branch', 'holder'], { cwd: repo })
  const head = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
  const wtPath = `${repo}-detached`
  await execGitOrThrow(['worktree', 'add', '--detach', '--end-of-options', wtPath, head], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('left-tab-worktrees').click()
    const row = window.getByTestId(`worktree-row-${wtPath.split('/').pop()}`)
    await row.hover()
    const tip = window.getByTestId('tooltip')
    await expect(tip).toBeVisible()
    // 제목(첫 저장 메시지)·포함 브랜치가 카드에 있다
    await expect(tip).toContainText('holder')
    await expect(tip).toContainText('에 포함된 저장')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(wtPath, { recursive: true, force: true }).catch(() => {})
  }
})
```

(픽스처 헬퍼·testid는 실독 확인. `worktree-row-*`가 리프 이름 기준인 점은 E7j 관례 그대로.)

- [ ] **Step 2: 게이트** — build + `npx playwright test e2e/smoke.spec.ts` → **86 passed**(83+3), 신규 3건 각각 단독 `-g` 1회 non-flaky, 루트 `pnpm test` 유지, typecheck.

- [ ] **Step 3: 전체 게이트** — 루트 `pnpm test` **519(512+3+4 — 실측 확정)** · typecheck 전부 Done · desktop build · `pnpm --filter @git-gui/desktop e2e` → **92**(smoke 86 + hosting 6) · last-screen 아티팩트 0건.

- [ ] **Step 4: 공식 스크린샷 1장** — 임시 spec `apps/desktop/e2e/tmp-shots-e7k.spec.ts`(관례: harness electron·**970×800**·try/finally 정리·촬영 후 spec 삭제·전체 e2e 재실행 금지): **e7k-header-compact.png** — 좁은 창에서 헤더가 아이콘만으로 접히고 저장소 이름이 살아 있는 상태. 스크래치패드(`/private/tmp/claude-501/-Users-sangyeop-kim-git-gui/b4ef6d32-042d-440c-8252-b8944659aa01/scratchpad/`)에 사본.

- [ ] **Step 5: README.** 기존 E7j 문단 끝(실독) 뒤에 추가:

```markdown
E7k: 창을 좁혀도 앱이 가로로 스크롤되지 않습니다 — 헤더 버튼이 아이콘만 남게 접히고(이름은 호버로), 저장소 이름 자리는 지켜집니다. 워크트리 호버 카드에는 마지막 저장의 제목·시각이 함께 뜨고, 브랜치 없이 붙은(분리됨) 워크트리는 그 저장이 어느 브랜치에 포함되는지 알려줍니다.
```

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/e2e/smoke.spec.ts README.md
git commit -m "test(desktop): E7k E2E 3건 — 가로 스크롤 0·라벨 접힘·분리됨 카드 + README

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 게이트 표 (누적 — 실측 정정 대상)

| 시점 | 루트 테스트 | smoke |
| --- | --- | --- |
| 시작 | 512 | 83 |
| Task 1 후 | +3 → 515 | 83 |
| Task 2 후 | 515 | 83 유지 |
| Task 3 후 | +4 → 519 | 83 유지 |
| Task 4·5 후 | 519 | 83 유지 |
| Task 6 후 | 519 · e2e **92**(86+6) | +3 → 86 |

## Self-Review (플랜 자체 점검)

1. **스펙 커버리지**: ①문서 스크롤 차단=T2 Step 4 · 라벨 접기=T1(판정)+T2(span·CSS) · repo 최소폭=T2 · 스위처 상한=T2 Step 5 · 임계 1180=T1 · ②headInfo 통합=T3 · IPC/store=T4 · 카드 표시(제목·시각·포함 브랜치 분리됨 한정·상한 문구)=T5 · 테스트=T1·T3 단위 + T6 E2E 3건 + 스크린샷. 에러표: unborn(T3 log 실패 → null) · prunable(git 실패 → store catch null) · 포함 0개(T5 `length > 0` 가드) · 리사이즈 중 툴팁(E7j가 이미 닫음) · 전체화면(viewportWidth 갱신) · 960px 최소창(T2 compact+overflow) 전부 매핑.
2. **플레이스홀더**: 없음. T3 Step 4의 `forkPointOf` 헬퍼는 "기존 본문을 한 글자도 바꾸지 말고 옮긴다"로 못 박았다(E7j-보완이 실측으로 확정한 로직이라 재작성 금지).
3. **타입 일관성**: `WorktreeHeadInfo{subject,committedAt,containedIn,containedTruncated,fork}`가 domain(T3)→contract(T4)→store(T4)→panel props(T5)에서 동명. `headInfos`·`loadHeadInfo`·`headKey`·`onHoverWorktree` 이름이 T4·T5에서 일치. `isCompactHeader`/`HEADER_COMPACT_WIDTH`(T1)↔App(T2) 일치.
4. **알려진 위험 2건**: (a) T4에서 이름을 바꾸면 T5 전까지 typecheck가 붉다 — 플랜이 명시적으로 허용하고 T5에서 확인하게 했다. (b) `.app { overflow: hidden }`이 기존 레이아웃(세로 스크롤을 문서에 기대는 곳)을 깨뜨릴 수 있다 — 각 패널이 자기 `overflow-y`를 갖는 구조라 예상 영향 없으나, T2 Step 7 프로브에서 **세로 스크롤 동작도 함께 확인**할 것.
