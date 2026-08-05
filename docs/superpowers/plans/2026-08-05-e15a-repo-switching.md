# E15a 저장소 전환 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 앱을 끄지 않고 다른 저장소로 갈 수 있게 한다 — 헤더 전환기 + 최근 목록.

**Architecture:** 전환 기계(`openRepository()`)는 이미 있고 부를 방법만 없다. 헤더의 저장소 이름을 팝오버 트리거로 만들고(브랜치 스위처와 같은 관용구), 최근 목록을 설정에 영속하고, 다이얼로그 없이 경로로 여는 IPC를 더한다. 그 IPC가 이 에픽의 유일한 보안 표면이라 `repo.select()`와 **똑같이** 검증해야 한다.

**Tech Stack:** TypeScript · React 19 · zustand · react-aria-components · Electron 35 · Vitest(단위) · Playwright Electron(E2E)

## Global Constraints

- **정본 스펙:** `docs/superpowers/specs/2026-08-05-e15a-repo-switching-design.md`. 어긋나게 구현했다면 플랜에 편차로 기록한다.
- **언어:** 모든 주석·커밋 메시지·UI 문구는 한글. 주변 코드의 밀도를 따른다 — 이 저장소의 주석은 "왜"를 실측 숫자와 함께 적는다.
- **`pnpm lint`가 게이트다 (E14b).** `react-hooks` 규칙이 렌더러에 걸려 있고 **에러 0**이 조건이다. 특히 **`set-state-in-effect`는 에러다** — "무언가 바뀌면 로컬 상태를 리셋"은 이펙트가 아니라 **렌더 중 파생**으로 쓴다(`App.tsx`의 `findScopeRepo` 관용구가 본보기).
- **E2E는 반드시 단일 포그라운드 Bash 호출 + `timeout: 600000`.** 기본 120초 상한은 실행을 조용히 백그라운드로 보내고 멈춘다.
- **`npx playwright test`는 빌드하지 않는다.** `pnpm --filter @git-gui/desktop e2e`만 `electron-vite build &&`가 붙는다. 소스를 고친 뒤 `npx playwright test`를 돌리면 낡은 번들을 테스트하는 것이고 반증은 무의미해진다.
- **E2E 환경변수:** `GIT_GUI_E2E_REPO`(저장소 즉시 열기) · `GIT_GUI_USER_DATA`(설정 격리 — **하네스가 없으면 자동 주입한다**, `e2e/harness.ts:32`) · `GIT_GUI_E2E_SHOW=1`(실제 창).
- **OS 전체 화면 캡처 금지.** 사용자의 다른 창에 사적 정보가 있다. Playwright 창 캡처만 쓰고 `/private/tmp/claude-501/-Users-sangyeop-kim-git-gui/b4ef6d32-042d-440c-8252-b8944659aa01/scratchpad/`에 쓴다.
- **사용자의 실행 중인 dev 앱을 건드리거나 재시작하지 않는다.**
- **기준 게이트(시작 시점):** lint **0 errors / 5 warnings** · typecheck 6/6 · 루트 `pnpm test` **606** · build 성공 · e2e **128**.
- **알려진 플레이크(오귀속 금지):** `packages/git-adapter` 단위 테스트가 루트 전체 병렬 실행에서 3회 중 2회꼴로 1건 타임아웃한다 — 매번 다른 테스트·항상 정확히 15000ms·단독 실행은 242/242 초록. 실제 git 서브프로세스를 띄우는 탓이고 이 에픽과 무관하다.

---

## File Structure

| 파일 | 책임 |
| --- | --- |
| **생성** `apps/desktop/src/renderer/src/components/recent-repos.ts` | 최근 목록 순수 규칙(추가·제거·상한) |
| **생성** `apps/desktop/test/recent-repos.test.ts` | 위 단위 테스트 |
| **수정** `packages/ipc-contract/src/index.ts` | `repo.open(path)` 추가 · `recentRepos` 설정 · **신뢰 규칙 문장 갱신** |
| **수정** `apps/desktop/src/main/git-handlers.ts` | `repo.open` 핸들러 — `repoSelect`와 **동일한** 검증 |
| **수정** `apps/desktop/src/preload/index.ts` | `repo.open` 노출 |
| **생성** `apps/desktop/src/renderer/src/components/RepoSwitcher.tsx` + `.css` | 헤더 팝오버 — 최근 목록·다른 폴더 열기 |
| **수정** `apps/desktop/src/renderer/src/App.tsx` | 전환기 배선 · `⌘O` · `activeWorktree` 리셋 |
| **수정** `apps/desktop/src/renderer/src/store/repository-store.ts` | `openRepository(path?)` · `recentRepos` 상태 · 유출 2건 정리 |
| **수정** `apps/desktop/e2e/smoke.spec.ts` | E2E 5건 |

---

### Task 1: 최근 목록 순수 함수

**Files:**
- Create: `apps/desktop/src/renderer/src/components/recent-repos.ts`
- Create: `apps/desktop/test/recent-repos.test.ts`

**Interfaces:**
- Produces: `RECENT_REPOS_MAX = 10` · `pushRecentRepo(recent: readonly string[], path: string): string[]` · `removeRecentRepo(recent: readonly string[], path: string): string[]`. Task 4가 쓴다.
- Consumes: 없음.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/desktop/test/recent-repos.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  pushRecentRepo,
  removeRecentRepo,
  RECENT_REPOS_MAX,
} from '../src/renderer/src/components/recent-repos'

describe('최근 저장소 목록', () => {
  it('RECENT_REPOS_MAX는 10 — 헤더 팝오버가 스크롤 없이 담기는 길이', () => {
    expect(RECENT_REPOS_MAX).toBe(10)
  })

  it('연 저장소가 맨 앞에 온다', () => {
    expect(pushRecentRepo(['/a', '/b'], '/c')).toEqual(['/c', '/a', '/b'])
  })

  it('이미 있던 것을 다시 열면 중복이 아니라 맨 앞으로 이동한다', () => {
    expect(pushRecentRepo(['/a', '/b', '/c'], '/c')).toEqual(['/c', '/a', '/b'])
  })

  it('맨 앞을 다시 열어도 그대로다', () => {
    expect(pushRecentRepo(['/a', '/b'], '/a')).toEqual(['/a', '/b'])
  })

  it('상한을 넘으면 가장 오래된 것부터 버린다', () => {
    const full = Array.from({ length: RECENT_REPOS_MAX }, (_, i) => `/repo-${i}`)
    const next = pushRecentRepo(full, '/new')
    expect(next).toHaveLength(RECENT_REPOS_MAX)
    expect(next[0]).toBe('/new')
    expect(next).not.toContain(`/repo-${RECENT_REPOS_MAX - 1}`)
  })

  it('원본을 바꾸지 않는다 — 설정 객체를 그대로 쓰는 호출부가 있다', () => {
    const original = ['/a', '/b']
    pushRecentRepo(original, '/c')
    expect(original).toEqual(['/a', '/b'])
  })

  it('없어진 경로를 뺀다', () => {
    expect(removeRecentRepo(['/a', '/b', '/c'], '/b')).toEqual(['/a', '/c'])
  })

  it('없는 것을 빼라고 해도 그대로다', () => {
    expect(removeRecentRepo(['/a'], '/zzz')).toEqual(['/a'])
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd "/Users/sangyeop_kim/git gui" && npx vitest run --root apps/desktop test/recent-repos.test.ts`
Expected: FAIL — `Failed to resolve import ".../recent-repos"`

- [ ] **Step 3: 구현한다**

`apps/desktop/src/renderer/src/components/recent-repos.ts`:

```ts
/**
 * 최근 연 저장소 목록 규칙 (E15a).
 * 헤더 전환기가 보여 주고 설정(userData/settings.json)에 영속된다 — 순수 규칙만 여기에 둔다.
 */

/** 헤더 팝오버가 스크롤 없이 담기는 길이 */
export const RECENT_REPOS_MAX = 10

/** 연 저장소를 맨 앞으로 — 이미 있으면 중복을 만들지 않고 옮긴다 */
export function pushRecentRepo(recent: readonly string[], path: string): string[] {
  return [path, ...recent.filter((entry) => entry !== path)].slice(0, RECENT_REPOS_MAX)
}

/** 없어진 저장소를 목록에서 뺀다 (전환기가 열기 실패 시 부른다) */
export function removeRecentRepo(recent: readonly string[], path: string): string[] {
  return recent.filter((entry) => entry !== path)
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `cd "/Users/sangyeop_kim/git gui" && npx vitest run --root apps/desktop test/recent-repos.test.ts`
Expected: PASS — 8 passed

- [ ] **Step 5: 반증한다**

세 변이를 각각 넣고 어느 테스트가 빨개지는지 **실제로 확인한 뒤 원복**한다. 빨강/초록 출력을 그대로 보고에 붙인다.
1. `pushRecentRepo`의 `.filter(...)`를 지운다(중복 허용)
2. `.slice(0, RECENT_REPOS_MAX)`를 지운다(상한 없음)
3. `RECENT_REPOS_MAX`를 20으로 바꾼다

> **예상 개수를 적지 않는다.** 이 에픽 시리즈에서 컨트롤러가 반증 예상을 적을 때마다 틀렸다
> (E14b Task 2는 3개 예상이 3개 다 틀렸다). **어느 변이가 어느 테스트를 무는지 실제 대응을 보고하고**,
> 어떤 변이에도 안 물리는 테스트가 있으면 그것도 그대로 적는다.

- [ ] **Step 6: 커밋**

```bash
cd "/Users/sangyeop_kim/git gui"
git add apps/desktop/src/renderer/src/components/recent-repos.ts apps/desktop/test/recent-repos.test.ts
git commit -m "feat(desktop): E15a 최근 저장소 목록 순수 규칙

헤더 전환기가 보여 주고 설정에 영속될 목록의 규칙만 먼저 분리한다 — 이 저장소가
순수 로직을 모듈로 빼 단위 테스트하는 관례(branch-tree·file-tree·run-guard…) 그대로.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `repo.open(path)` IPC — 보안 경계

**Files:**
- Modify: `packages/ipc-contract/src/index.ts` (`GitApi.repo`에 `open` 추가 · `CHANNELS` · **신뢰 규칙 주석** · `AppSettings.recentRepos` · `sanitizeSettings`)
- Modify: `apps/desktop/src/main/git-handlers.ts` (핸들러)
- Modify: `apps/desktop/src/preload/index.ts` (노출)

**Interfaces:**
- Produces: `git().repo.open(path: string): Promise<string>` — 저장소 루트로 정규화된 경로를 돌려주고 allowlist에 등록한다. 저장소가 아니면 throw. Task 4가 쓴다.
- Produces: `AppSettings.recentRepos?: string[]`. Task 4가 읽고 쓴다.

> **이 태스크가 이 에픽의 유일한 보안 표면이다.** 최근 목록의 경로는 **디스크의 `settings.json`에서
> 온 렌더러 입력**이다. 사용자가 예전에 골랐다는 사실은 지금 그 값이 안전하다는 보장이 아니다 —
> 파일은 편집될 수 있다. **렌더러가 준 경로를 그냥 `registerRepoPath`에 넘기면 렌더러가 임의
> 디렉터리에서 git을 돌리게 만드는 통로가 된다.**

- [ ] **Step 1: 계약서에 더한다**

`packages/ipc-contract/src/index.ts`의 `GitApi.repo`에:

```ts
    /**
     * 다이얼로그 없이 경로로 연다 — 최근 목록에서 고를 때 (E15a).
     * 반환 경로는 저장소 루트로 정규화된다. **select()와 동일한 검증을 거친다** —
     * 이 인자는 디스크 설정에서 온 렌더러 입력이라 신뢰할 수 없다.
     * 저장소가 아니면 throw (전환기가 그 신호로 목록에서 제거한다)
     */
    open(path: string): Promise<string>
```

**신뢰 규칙 문장(`:36`)을 갱신한다** — 안 하면 계약서가 스스로 거짓이 된다:

```
 * 신뢰 규칙: `repoPath`는 repo.select()·repo.initialPath()·repo.open()이 반환한 값만 유효하다 —
 * main은 자신이 돌려준 경로만 allowlist로 신뢰하고 그 외는 거부한다. 셋 다 같은 검증
 * (rev-parse --is-inside-work-tree + 루트 정규화)을 거친 뒤에만 값을 돌려준다 (E15a).
```

`AppSettings`에:

```ts
  /** 최근 연 저장소 — 최신이 앞 (E15a) */
  recentRepos?: string[]
```

`sanitizeSettings`에 그 필드의 방어를 더한다 — **문자열 배열만, 문자열 아닌 원소는 버린다.** 기존
필드들의 방어 방식을 그대로 따른다(이 함수는 렌더러 입력과 디스크 파일 양쪽에 쓰인다).

- [ ] **Step 2: main 핸들러 — `repoSelect`와 같은 검증**

`git-handlers.ts`의 `repoSelect`(`:118`) 바로 아래에:

```ts
  // 최근 목록에서 고른 경로로 연다 (E15a). 인자는 디스크 설정에서 온 렌더러 입력이라
  // repoSelect와 **똑같이** 검증한다 — 그냥 registerRepoPath에 넘기면 렌더러가 임의
  // 디렉터리에서 git을 돌리는 통로가 된다
  ipcMain.handle(CHANNELS.repoOpen, async (_event, repoPath: unknown) => {
    const path = assertString(repoPath)
    // 폴더가 없으면 execGit은 exit code가 아니라 spawn ENOENT로 **reject**한다 —
    // 없어진 폴더가 최근 목록의 가장 흔한 실패라, catch를 빼면 "spawn git ENOENT"가
    // 그대로 렌더러로 샌다(git이 안 깔린 것처럼 읽힌다). 실측 정정: 아래 exitCode
    // 분기만으로는 그 경로에 절대 도달하지 못한다
    const check = await execGit(['rev-parse', '--is-inside-work-tree'], { cwd: path }).catch(
      () => null,
    )
    // bare repo와 .git 디렉터리는 "false"를 출력하며 exit 0으로 끝난다 — stdout까지 확인한다
    if (check === null || check.exitCode !== 0 || check.stdout.trim() !== 'true') {
      throw new Error('그 폴더는 이제 Git 저장소가 아니에요. 목록에서 지울게요.')
    }
    return registerRepoPath(path)
  })
```

`assertString`이 그 파일에 이미 있는지 확인하고(실측: `git-handlers.ts:19`에 이미 있다), 없으면
기존 방어 함수를 쓴다.

- [ ] **Step 3: preload에 노출한다**

`repo.select`·`repo.initialPath` 옆에 같은 모양으로 `open`을 더한다.

- [ ] **Step 4: 게이트**

```bash
cd "/Users/sangyeop_kim/git gui" && pnpm lint && pnpm typecheck && pnpm test
```
Expected: lint 에러 0 · typecheck 6/6 · Tests **621** (606 + Task 1의 8건 + `sanitizeSettings`
방어 7건 — 아래 Step 2a. 원래 이 플랜은 614를 못박았으나, `recentRepos` 방어를 새로 넣으면서
그 방어를 무는 테스트를 함께 넣었다)

- [ ] **Step 2a: `sanitizeSettings`의 `recentRepos` 방어를 테스트로 문다**

`packages/ipc-contract/test/settings.test.ts`(이미 있다 — 9건)에 더한다. **빈 배열은 필드를
남긴다**: `settings.ts:52`가 `save({ ...current(), ...sanitizeSettings(partial) })`로 얕은
병합이라, 빈 배열에서 필드를 빼면 디스크의 옛 목록이 살아남아 "목록을 다 비웠다"를 영속할
방법이 사라진다.

- [ ] **Step 5: 보안 경계를 실측한다**

임시 프로브로 **저장소가 아닌 경로**(예: `/tmp`)를 `repo.open`에 넘겨 **거부되는지** 확인한다.
그리고 거부된 뒤 그 경로가 `allowedRepoPaths`에 **안 들어갔는지**도 본다(들어갔다면 이후 모든
핸들러가 그 경로를 신뢰하게 된다 — 그게 이 검증의 전부다). 프로브는 삭제하고 출력을 보고에 붙인다.

- [ ] **Step 6: 커밋**

```bash
cd "/Users/sangyeop_kim/git gui"
git add packages/ipc-contract/src/index.ts apps/desktop/src/main/git-handlers.ts apps/desktop/src/preload/index.ts
git commit -m "feat(desktop): E15a repo.open(path) — 다이얼로그 없이 경로로 열기

최근 목록에서 고른 경로로 여는 IPC. 인자는 디스크 settings.json에서 온 렌더러 입력이라
repo.select()와 똑같이 rev-parse --is-inside-work-tree로 검증한 뒤에만 registerRepoPath로
allowlist에 넣는다 — 그냥 넘기면 렌더러가 임의 디렉터리에서 git을 돌리는 통로가 된다.

ipc-contract의 신뢰 규칙 문장도 갱신했다. repo.open이 세 번째 진입점이 되므로 그대로
두면 계약서가 스스로 거짓이 된다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: 헤더 저장소 전환기

**Files:**
- Create: `apps/desktop/src/renderer/src/components/RepoSwitcher.tsx` · `repo-switcher.css`
- Modify: `apps/desktop/src/renderer/src/App.tsx:562-570` (`app__repo`를 트리거로) · `⌘O`
- Modify: `apps/desktop/src/renderer/src/store/repository-store.ts` (`openRepository(path?)` · `recentRepos`)

**Interfaces:**
- Consumes: Task 1의 `pushRecentRepo`/`removeRecentRepo`/`RECENT_REPOS_MAX` · Task 2의 `git().repo.open(path)`.
- Produces: `store.recentRepos: string[]` · `store.openRepository(path?: string): Promise<void>` · testid `repo-switcher`(트리거) · `repo-switcher-item-<path>` · `repo-switcher-browse`. Task 4·5의 E2E가 쓴다.

> **본보기는 `BranchSwitcher.tsx`다.** react-aria의 `MenuTrigger`/`Popover`/`Menu`/`MenuItem` +
> `useEscapeFallback(open, close)` 제어형 패턴을 그대로 따른다. 새 팝오버 관용구를 만들지 않는다.

- [ ] **Step 1: 스토어 — `openRepository(path?)` + `recentRepos`**

지금 `openRepository()`(`:465`)는 `git().repo.select()`만 부른다. 인자를 받게 고친다:

```ts
  async openRepository(path) {
    await runWrite(set, get, async () => {
      // 인자가 있으면 최근 목록에서 고른 것 — 다이얼로그를 건너뛴다. 검증은 main이 한다 (E15a)
      const opened = path === undefined ? await git().repo.select() : await git().repo.open(path)
      if (!opened) return
      // …기존 본문 그대로…
      // 최근 목록 갱신 — 성공한 뒤에만
      const recentRepos = pushRecentRepo(get().recentRepos, opened)
      set({ recentRepos })
      void window.settingsApi.set({ recentRepos })
    })
  },
```

`recentRepos` 초기값은 `settingsApi.initial.recentRepos ?? []`. 스토어의 `pullMode`가
`loadPullMode()`로 설정에서 읽어오는 관용구를 그대로 따른다.

**실패 시 목록에서 제거**하는 경로도 필요하다 — `repo.open`이 throw하면 `runWrite`가 `error`를
세우고 끝난다. 전환기가 그 실패를 알고 `removeRecentRepo`를 부를 수 있어야 하므로,
`openRepository`가 **성공 여부를 반환**하게 한다 — `runWrite`가 이미 `Promise<boolean>`을 준다.
**인터페이스 선언도 함께 바꾼다**: `openRepository(path?: string): Promise<boolean>`
(`repository-store.ts`의 `RepositoryStore` 인터페이스). 지금은 `openRepository(): Promise<void>`다.
호출부는 App 하나(`RepoPicker`의 `onOpen`)뿐이라 `void`로 버리던 것이 그대로 통한다.

- [ ] **Step 2: `RepoSwitcher.tsx`**

```tsx
interface RepoSwitcherProps {
  /** 지금 열려 있는 저장소 절대 경로 */
  currentPath: string
  /** 최신이 앞 (E15a) */
  recent: string[]
  busy: boolean
  /** 경로를 주면 그것을, 안 주면 폴더 선택 다이얼로그를 연다 */
  onOpen(path?: string): void
}
```

- 트리거: 지금의 `app__repo`(이름 굵게 + 경로 흐리게)를 그대로 감싸고 `ChevronDown`을 붙인다.
  `data-testid="repo-switcher"`.
- 목록: `recent`를 그리되 **현재 저장소는 `Check`로 표시**(BranchSwitcher가 현재 브랜치에 쓰는 것과 같은 아이콘).
  각 항목 `data-testid={`repo-switcher-item-${path}`}`. 이름은 마지막 폴더명을 굵게, 그 위 경로를 흐리게 —
  `worktree-label.ts`의 `shortenParent`/`shortenAbove`가 이미 같은 문제를 푼다. **재사용할 수 있는지
  확인하고, 안 되면 왜인지 보고한다** (E7j가 워크트리용으로 만든 것이라 저장소에도 맞는지는 확인이 필요하다).
- 맨 아래 구분선 + **"다른 폴더 열기…"** `data-testid="repo-switcher-browse"` → `onOpen()`.

> **스펙 대비 의도적 편차 — "없어진 경로를 흐리게" 는 하지 않는다.** 스펙 §3이 그렇게 적었지만,
> 클릭 **전에** 없어진 것을 알려면 팝오버를 열 때마다 항목 10개의 존재 여부를 IPC로 물어야 한다.
> 매번 10번의 왕복을 "이미 지운 폴더가 목록에 남아 있을 때"만을 위해 치르는 건 과하다 (YAGNI).
> **누르면 실패하고 목록에서 빠지며 이유를 알려 주는 것**으로 충분하다 — 스펙의 나머지 절반이자
> Task 2의 에러 경로가 이미 그 신호를 준다. 이 편차를 플랜 실행 기록에도 적는다.

- [ ] **Step 3: App 배선 + `⌘O`**

`App.tsx:562-570`의 `<div className="app__repo">`를 `<RepoSwitcher …/>`로 교체한다.
`repo-path` testid는 **그대로 유지한다** — E7h ③이 전환 검증용으로 넣었고 기존 E2E가 쓴다.

`⌘O` — 기존 `⌘F` 키다운 리스너와 같은 자리에 더한다. **macOS는 Option 조합에서 `event.key`를
리맵하므로 `event.code`를 쓴다**(E12 실측) — `⌘O`는 Option이 없으니 `event.key === 'o'`로 충분하지만,
그 리스너의 기존 관용구를 확인하고 맞춘다.

- [ ] **Step 4: 게이트**

```bash
cd "/Users/sangyeop_kim/git gui" && pnpm lint && pnpm typecheck && pnpm test
cd "/Users/sangyeop_kim/git gui" && pnpm --filter @git-gui/desktop e2e
```
Expected: lint 에러 0 · 6/6 · **621** · e2e **128** (아직 새 E2E 없음 — 기존이 안 깨지는지만 본다)

- [ ] **Step 5: 스크린샷 1장**

전환기를 연 상태를 Playwright 창 캡처로 찍어 스크래치패드에 저장하고 `ls -la`를 보고에 붙인다.
컨트롤러가 눈으로 검수한다.

- [ ] **Step 6: 커밋**

```bash
cd "/Users/sangyeop_kim/git gui"
git add apps/desktop/src/renderer/src
git commit -m "feat(desktop): E15a 헤더 저장소 전환기 — 최근 목록·다른 폴더 열기

헤더의 저장소 이름을 팝오버 트리거로 만든다. 전환 기계(openRepository)는 이미 있었고
부를 방법만 없었다 — App.tsx:521이 repoPath가 있으면 RepoPicker를 아예 안 그렸다.

BranchSwitcher의 MenuTrigger/Popover + useEscapeFallback 관용구를 그대로 따른다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: 전환 시 상태 유출 — **테스트 먼저, 그다음 수정**

**Files:**
- Modify: `apps/desktop/e2e/smoke.spec.ts` (유출 E2E)
- Modify: `apps/desktop/src/renderer/src/store/repository-store.ts` (`headInfos`·`lastFetchAt`)
- Modify: `apps/desktop/src/renderer/src/App.tsx` (`activeWorktree`)

> **컨트롤러가 플랜 작성 중 스토어 27개 필드를 전수 대조했다. 유출은 3건이다** — 다시 탐색하지 마라.
>
> | 상태 | 어디 | 증상 |
> | --- | --- | --- |
> | `lastFetchAt` | 스토어 | **사용자에게 보인다** — `BranchesPanel:376`이 옛 저장소의 "n분 전 가져옴"을 그린다 |
> | `headInfos` | 스토어 | `경로::HEAD` 캐시에 옛 항목이 남는다(무해하지만 전환할수록 쌓인다) |
> | `activeWorktree` | **App 로컬**(`App.tsx:116` `useState`) | 옛 저장소의 워크트리를 가리켜 **터미널 cwd·도크 라벨이 틀린다** |
>
> 나머지 24개는 `CLEAR_SELECTIONS`·`fetchSnapshot`·`runWrite`·명시 `set`이 이미 덮는다.
> **스펙 초안이 `notice`/`error`도 샌다고 적었는데 틀렸다** — `runWrite`가 진입할 때 지운다(`run-guard.ts:85`).

- [ ] **Step 1: 유출 E2E를 먼저 쓴다 (수정 전)**

세 유출을 각각 잡는 단언을 한 테스트에 담는다. 저장소 A(워크트리 추가·페치까지 해 상태를 만든 뒤)
→ 전환기로 저장소 B → 흔적이 없는지.

`activeWorktree`는 화면에서 **도크 헤더의 워크트리 이름**으로 드러난다(E12가 거기로 옮겼다).
`lastFetchAt`은 **브랜치 탭의 "n분 전 가져옴"**으로 드러난다. `headInfos`는 화면에 직접 안 드러나니
스토어를 볼 수 없다면 **그 항목은 단언하지 않고 그렇게 보고한다** — 안 보이는 것을 본다고 하지 않는다.

- [ ] **Step 2: 현재 코드에서 빨간 것을 확인한다**

```bash
cd "/Users/sangyeop_kim/git gui" && pnpm --filter @git-gui/desktop e2e
```
Expected: **새 테스트가 빨강.** 초록이면 그 유출이 실제로는 없다는 뜻이니 **멈추고 보고한다** —
컨트롤러의 대조가 틀렸을 수 있다. 어느 단언이 빨갛고 어느 것이 초록인지 그대로 적는다.

- [ ] **Step 3: 세 유출을 고친다**

- `lastFetchAt`·`headInfos` — `openRepository`의 결과 `set`에 `lastFetchAt: null, headInfos: {}`를 더한다.
- `activeWorktree` — App에서 **렌더 중 파생**으로 리셋한다. `set-state-in-effect`가 lint 에러이므로
  이펙트를 쓰면 게이트가 막는다. `App.tsx`의 `findScopeRepo` 관용구를 그대로 따른다:

```tsx
// E15a — 저장소가 바뀌면 옛 저장소의 워크트리를 가리킨 채 남으면 안 된다(터미널 cwd·도크 라벨이 틀린다).
// activeWorktree는 스토어 밖이라 openRepository가 닿지 않는다. 이펙트가 아니라 렌더 중 파생으로
// 표현한다 — set-state-in-effect는 lint 에러다 (E14b)
const [activeWorktreeRepo, setActiveWorktreeRepo] = useState(store.repoPath)
if (activeWorktreeRepo !== store.repoPath) {
  setActiveWorktreeRepo(store.repoPath)
  setActiveWorktree(null)
}
```

- [ ] **Step 4: 초록을 확인하고 반증한다**

수정 후 초록을 확인한 뒤, **세 수정을 하나씩 되돌려 재빌드해** 각각 해당 단언이 빨개지는지 본다.
`npx playwright test`는 빌드하지 않으므로 `pnpm --filter @git-gui/desktop e2e`를 쓴다.
빨강/초록 출력을 그대로 붙인다.

- [ ] **Step 5: 커밋**

```bash
cd "/Users/sangyeop_kim/git gui"
git add apps/desktop
git commit -m "fix(desktop): E15a 저장소 전환 시 상태 유출 3건

스토어 27개 필드를 openRepository가 쓰는 것과 전수 대조해 찾았다.
lastFetchAt은 사용자에게 보인다(옛 저장소의 'n분 전 가져옴'), headInfos는 캐시 누수,
activeWorktree는 스토어 밖(App useState)이라 openRepository가 닿지 않아 터미널 cwd가 틀렸다.

유출을 잡는 E2E를 먼저 써 현재 코드에서 빨간 것을 확인한 뒤 고쳤다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: 나머지 E2E + 최종 게이트 + 실행 기록

**Files:**
- Modify: `apps/desktop/e2e/smoke.spec.ts`
- Modify: `docs/superpowers/plans/2026-08-05-e15a-repo-switching.md` (이 파일 — 실행 기록)
- Modify: `README.md` (해당하면)

> **이 에픽이 "저장소를 두 번 여는" E2E를 처음 만든다.** E14b가 실측으로 확인했듯 지금 저장소에
> 그런 시나리오가 **하나도 없다** — 그래서 E14b의 "저장소가 바뀌면 옛 ⌘F 스코프 무효"도 그물 없이
> 코드 리뷰로만 지켜지고 있다. 여력이 되면 그 단언도 함께 넣고, 넣었는지 보고한다.

- [ ] **Step 1: E2E 4건을 더한다**

1. **전환기로 다른 저장소를 열면 화면이 그 저장소로 바뀐다** — `repo-path`가 B가 되고 B의 파일이 목록에 뜬다.
2. **최근 목록이 재시작 후에도 남는다** — 같은 `GIT_GUI_USER_DATA`로 두 번 launch(재시작 지속성 테스트의 기존 관용구를 따른다 — 그 경우 호출자가 `GIT_GUI_USER_DATA`를 직접 넘겨야 하네스가 존중한다).
3. **없어진 경로를 누르면 열리지 않고 목록에서 빠진다** — B를 연 뒤 B 폴더를 지우고 목록에서 B를 누른다.
4. **`⌘O`가 폴더 선택을 연다** — OS 다이얼로그는 Playwright로 열 수 없으니 **main에서 `repo:select`
   IPC 핸들러를 감싸 호출 수를 센다.** E14b가 `repo:status`에 같은 기법을 써 검증된 방식이다:

   ```ts
   const patched = await app.evaluate(({ ipcMain }) => {
     const impl = ipcMain as unknown as { _invokeHandlers: Map<string, (...a: unknown[]) => unknown> }
     const original = impl._invokeHandlers.get('repo:select')
     if (original === undefined) return false
     const globals = globalThis as unknown as { __selectCalls: number }
     globals.__selectCalls = 0
     // 다이얼로그를 실제로 띄우지 않도록 원본을 부르지 않고 null(취소)로 답한다
     impl._invokeHandlers.set('repo:select', () => { globals.__selectCalls += 1; return null })
     return true
   })
   expect(patched, 'repo:select 핸들러를 감싸지 못했다 — 이 테스트는 아무것도 재지 못한다').toBe(true)
   ```
   `patched` 단언이 있어야 계측이 안 걸린 채 0을 세고 통과하는 공허한 성공을 막는다.
   **채널 이름이 `repo:select`가 맞는지 `CHANNELS`에서 확인하고, 다르면 실제 이름을 쓰고 보고한다.**
   `_invokeHandlers`는 Electron 내부 필드라 업그레이드 시 깨질 수 있으나, `patched` 단언이
   그때 조용히 통과하는 대신 명시적으로 실패하게 한다 (E14b와 같은 절충).

- [ ] **Step 2: 반증**

각 테스트를 해당 기능을 무력화해 빨개지는지 확인하고 원복한다(재빌드 필수). 출력을 붙인다.

- [ ] **Step 3: 다섯 게이트**

```bash
cd "/Users/sangyeop_kim/git gui" && pnpm lint
cd "/Users/sangyeop_kim/git gui" && pnpm typecheck
cd "/Users/sangyeop_kim/git gui" && pnpm test
cd "/Users/sangyeop_kim/git gui" && pnpm --filter @git-gui/desktop build
cd "/Users/sangyeop_kim/git gui" && pnpm --filter @git-gui/desktop e2e
```
Expected: lint **0 errors / 5 warnings** · 6/6 · **621** · 성공 · **133** (128 + Task 4의 1건 + 여기 4건)

- [ ] **Step 4: 실행 기록**

이 플랜 말미에 「실행 기록」절을 추가한다. 반드시 담을 것:
- 플랜과 다르게 구현한 모든 편차와 이유
- Task 2에서 없어진 폴더에 `execGit`이 어떻게 반응했는지
- Task 3에서 `worktree-label.ts` 재사용이 됐는지, 안 됐으면 왜
- Task 4 Step 2에서 어느 단언이 빨갛고 어느 것이 초록이었는지
- Task 5의 `⌘O` 단언을 무엇으로 했는지(또는 왜 뺐는지)
- 각 반증의 빨강/초록 출력
- 최종 게이트 다섯

- [ ] **Step 5: 커밋**

```bash
cd "/Users/sangyeop_kim/git gui"
git add docs/superpowers apps/desktop/e2e README.md
git commit -m "docs: E15a 실행 기록 + 저장소 전환 E2E

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 후속 노트 (이 에픽에서 하지 않음)

- **E15b — 여러 창 + macOS 네이티브 탭.** `tabbingIdentifier`(Electron 35에 `addTabbedWindow`·`mergeAllWindows`·`selectNextTab` 확인)를 주면 탭바·드래그 분리·창 병합이 OS 기능으로 딸려온다. **선행 조건**: `git-handlers.ts:153`의 `stopWatching`이 모듈 전역 하나라 두 번째 창이 첫 창의 감시를 죽인다 · 창별 UI 설정(`leftCollapsed`·`rightWidth`·`terminalOpen`·`terminalHeight`·`rightCollapsed`)과 앱 공용 설정(`theme`·`pullMode`·`autoFetch`·`worktreeSelectAction`·`recentRepos`) 분리 · `MAX_SESSIONS = 8`이 창별인지 전체인지.
- **뒤로가기 스택** — 만들지 않기로 했다(스펙 §8). 최근 목록을 써 보고도 부족하면 그때 다시 본다.
- **터미널 상한 8을 여러 저장소가 나눠 쓴다** — 저장소를 바꿔도 pty를 죽이지 않기로 한 결정(사용자)의 대가. E15b에서 함께 정리한다.
- **`packages/**`가 eslint 범위 밖이다** (Task 2b 실측). `eslint.config.mjs:10`이 `apps/desktop/src/renderer/src/**`만 잡아서, `packages/` 아래 파일은 `File ignored because no matching configuration was supplied`가 된다. E14b가 의도적으로 좁힌 범위가 맞지만 부작용이 있다 — 거기 적은 `eslint-disable` 지시자는 **죽은 주석**이 되고, `reportUnusedDisableDirectives: 'error'`도 렌더러 블록에만 걸려 있어 아무도 알려주지 않는다(규칙이 도는 것처럼 오해시킨다). `apps/desktop/test/**`가 tsconfig `include` 밖인 것과 같은 부류다.
- E14b에서 넘어온 것들: E14c(참조 안정화로 `exhaustive-deps` 억제 12곳 해소) · `TerminalDock`의 `[]` 이펙트 두 개가 마운트 시점 `sessions`를 굳혀 **사이드 접기 refit이 실제로 안 돈다**(창 리사이즈는 `attach` 부수효과가 가려 준다) · `apps/desktop/test/**`가 tsconfig `include` 밖.
- **`sanitizeSettings`의 `leftCollapsed`·`rightCollapsed`(E12)에 아직 그물이 없다** (Task 2b 실측). `packages/ipc-contract/test/settings.test.ts`는 있지만 나중에 추가된 필드가 테스트 없이 들어온 이력이 있다 — `recentRepos`는 이번에 막았고, 나머지 둘은 남아 있다.
