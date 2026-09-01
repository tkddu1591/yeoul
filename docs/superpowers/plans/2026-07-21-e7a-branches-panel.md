# E7a — IntelliJ식 실험 공간(브랜치) 패널 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) 구문으로 추적한다.

**Goal:** 좌측 열에 [변경 | 실험 공간] 탭을 만들고, 실험 공간 탭에서 브랜치를 IntelliJ처럼 관리한다 — 검색·폴더 그룹·상태 배지(↑↓·연결 없음·연결 끊김), 우클릭(이동·새 공간·합치기·재배치 rebase 풀 충돌 흐름·비교·업데이트·백업·이름 바꾸기·지우기), 원격 브랜치(가져오기·비교·원격에서 지우기).

**Architecture:** 스펙 `docs/superpowers/specs/2026-07-21-e7a-branches-panel-design.md` 확정안. 엔진은 for-each-ref 1회 일괄(`branches.overview`) + 신규 조작 5종 + `rebase` 네임스페이스(기존 rebasing 상태 감지·상태 바를 4겸용으로 확장), UI는 좌측 탭 + `BranchesPanel`(기존 ContextMenu·branch-groups·PromptDialog/ConfirmDialog 재사용), store는 guard 관례 그대로. 헤더 스위처·관리 다이얼로그는 유지.

**Tech Stack:** 기존 그대로 — TypeScript, Electron(main/preload/renderer), zustand, react-aria-components, vitest, Playwright(Electron E2E).

**기준 커밋:** main = `1118c48`. 기준선 실측: 단위 **360 tests**(27 files, `pnpm test`), E2E **46**(smoke 40 + hosting 6, `grep -c "^test("`). 작업 브랜치: **`feature/e7a-branches-panel`** (Task 1 Step 0에서 생성).

## 사전 실측 기록 (2026-07-21, macOS Darwin 25.5.0 · git 2.50.1 — 스크래치 저장소 실기동)

### 실측 1. for-each-ref — 포맷·track 변형·origin/HEAD 함정

`git for-each-ref refs/heads refs/remotes --format='%(refname)%1f%(refname:short)%1f%(symref)%1f%(upstream:short)%1f%(upstream:track)%1f%(committerdate:unix)%1f%(objectname)'` 확인 결과:

- `%1f`는 for-each-ref에서도 US(0x1f) 구분자로 동작한다(hex escape).
- `%(upstream:track)` 변형: `[ahead 1, behind 2]` · `[gone]`(원격이 지워진 upstream) · **빈 문자열**(동기화됨 **또는** upstream 없음 — 구분은 `%(upstream:short)`가 비었는지로 한다).
- **함정:** `refs/remotes/origin/HEAD`(심볼릭)가 short 이름 **`origin`** 인 행으로 나온다. `%(symref)`가 비어 있지 않은 행(`refs/remotes/origin/main` 값)을 걸러야 한다.
- `%(refname)` 전체 경로로 `refs/heads/` vs `refs/remotes/`를 분류한다.

### 실측 2. rebase 충돌 루프 — 상태 파일·stderr·빈 커밋 자동 드롭

로컬 저장소에서 2커밋 rebase 충돌을 실기동:

- 충돌 시 exit 1, 출력에 `Could not apply <shortHash>... <subject>`. `.git/rebase-merge/` 생성, **`msgnum`=현재 번째, `end`=전체**(1/2 → continue 후 2/2). status는 `UU`.
- 해소(add) 후 `git rebase --continue` → 다음 충돌(exit 1, msgnum 증가) 또는 완료(exit 0, `Successfully rebased`).
- **해소 결과가 빈 커밋이면 `--continue`가 자동으로 드롭하고 exit 0으로 성공한다** — 스펙의 "--skip 확인창"은 불필요(스펙 대비 단순화, 실측 근거).
- 미해소(UU) 또는 add 안 한 채 continue → `needs merge` + `You must edit all merge conflicts and then\nmark them as resolved using git add`.
- dirty 상태에서 rebase 시작 → `error: cannot rebase: You have unstaged changes.` + `error: Please commit or stash them.` (스마트 자동 보관 재시도의 판정 문자열).
- `git rebase --abort` → 시작 전 HEAD로 복원, rebase-merge 디렉터리 소멸.
- plain `rebase --continue`는 편집기를 열지 않지만(원 메시지 재사용), 방어적으로 `-c core.editor=true`를 앞세운다.

### 실측 3. fetch refspec — ff-only가 기본

- 비현재 브랜치가 원격보다 뒤(behind만): `git fetch origin <src>:<name>` 성공(ff), exit 0.
- 갈라진(ahead+behind) 비현재 브랜치: `! [rejected] feature -> feature (non-fast-forward)`, exit 1 — **fetch refspec은 강제 없이는 ff-only**.
- 체크아웃된 브랜치로 fetch: `fatal: refusing to fetch into branch 'refs/heads/…' checked out at …` (renderer가 현재 브랜치를 pull로 라우팅하지만, 다른 워크트리 체크아웃까지 이 문자열로 친절 매핑).

### 실측 4. 기타

- `git switch -c <local> --track <remote>/<branch>`에서 동명 로컬 존재 시: `fatal: a branch named '<local>' already exists` (우리는 rev-parse 선검사로 먼저 거른다).
- `git push origin <name>:<name>`(비현재 push)·`git push --delete origin <name>` 정상 동작 확인.
- `git symbolic-ref -q --short HEAD` → 현재 브랜치 이름(detached면 exit≠0).

## 파일 구조 (책임 지도)

| 파일 | 책임 |
| --- | --- |
| `packages/domain/src/repository.ts` (수정) | `LocalBranchStatus`·`RemoteBranchRef`·`BranchOverview`·`BranchCompare`·`RebaseResult`·`RebaseContinueResult`·`RebaseProgress` 타입 |
| `packages/git-adapter/src/overview-parser.ts` (신규) | for-each-ref 출력 → BranchOverview 순수 파서 |
| `packages/git-adapter/src/client.ts` (수정) | `branches.overview/update/backup/compare/checkoutRemote/removeRemote` + `rebase.start/continue/abort/progress` + `rejectIfRemoteAhead` 모듈 승격 |
| `packages/ipc-contract/src/index.ts` (수정) | 신규 채널·GitApi 확장 |
| `apps/desktop/src/main/git-handlers.ts` (수정) | 신규 핸들러 등록 |
| `apps/desktop/src/preload/index.ts` (수정) | 신규 브리징 |
| `apps/desktop/src/renderer/src/store/repository-store.ts` (수정) | `branchOverview`·`branchCompare`·`rebaseProgress` 상태 + 액션 9종 |
| `apps/desktop/src/renderer/src/components/branch-badges.ts` (신규) | 행 배지 문구 순수 함수 |
| `apps/desktop/src/renderer/src/components/branch-groups.ts` (수정) | `groupBranches` 제네릭화(하위 호환) |
| `apps/desktop/src/renderer/src/components/BranchesPanel.tsx` (신규) + `branches-panel.css` (신규) | 실험 공간 탭 본체(목록·검색·우클릭·비교 뷰) |
| `apps/desktop/src/renderer/src/App.tsx` (수정) | 좌측 탭·다이얼로그·rebase 상태 바 4겸용 |
| `apps/desktop/src/renderer/src/components/ConflictPanel.tsx` (수정) | mode 'rebasing' — ours/theirs 라벨 반전 |
| `apps/desktop/src/renderer/src/layout.css` (수정) | 좌측 탭바 스타일 |
| `apps/desktop/e2e/smoke.spec.ts` (수정) | E2E +6 |

## 검증 게이트 요약

| 시점 | 기대치 |
| --- | --- |
| 기준선 (1118c48, 실측) | **360 tests**(27 files) + E2E 46 (smoke 40 + hosting 6) |
| Task 1 후 | +9 → **369** (overview-parser 8 + client 통합 1) |
| Task 2 후 | +6 → **375** |
| Task 3 후 | +7 → **382** |
| Task 4 후 | +6 → **388** |
| Task 5 후 | 388 유지 + typecheck 전부 Done |
| Task 6 후 | +4 → **392** + smoke **43**(탭 E2E +3) |
| Task 7 후 | 392 유지 + smoke **44**(rebase 완주 +1) |
| Task 8 후 | smoke **46**(업데이트·원격 가져오기 +2) |
| 최종 (Task 9) | **392 tests** + typecheck + build + E2E **52**(smoke 46 + hosting 6) + last-screen 0건 + 스크린샷 2장 + README |

---

### Task 1: 엔진 — 도메인 타입 + overview 파서 + `branches.overview()`

**Files:**
- Modify: `packages/domain/src/repository.ts`
- Create: `packages/git-adapter/src/overview-parser.ts`
- Test: `packages/git-adapter/test/overview-parser.test.ts` (신규)
- Modify: `packages/git-adapter/src/client.ts`
- Test: `packages/git-adapter/test/client.test.ts` (+1)

- [x] **Step 0: 브랜치 생성** — `git checkout -b feature/e7a-branches-panel` (main=1118c48에서). `git branch --show-current`로 확인.

- [x] **Step 1: 도메인 타입.** `packages/domain/src/repository.ts` 기존:

```ts
/** 실험 공간(branch) 하나 — 스위처 목록용 */
export interface BranchSummary {
  name: string
  isCurrent: boolean
  /** epoch 초 — 이 공간의 마지막 저장 시점 */
  committedAt: number
  upstream: string | null
}
```

교체:

```ts
/** 실험 공간(branch) 하나 — 스위처 목록용 */
export interface BranchSummary {
  name: string
  isCurrent: boolean
  /** epoch 초 — 이 공간의 마지막 저장 시점 */
  committedAt: number
  upstream: string | null
}

/** 실험 공간 패널 한 행(로컬) — 상태 배지·우클릭 대상 정보 (E7a) */
export interface LocalBranchStatus {
  name: string
  isCurrent: boolean
  /** 'origin/main' 형태. 연결된 적 없으면 null */
  upstream: string | null
  /** 원격이 지워진 upstream([gone]) — 업데이트 불가, "연결 끊김" 표시 */
  upstreamGone: boolean
  /** upstream 대비 차이 — upstream이 없거나 gone이면 null (0/0으로 위장하지 않는다) */
  ahead: number | null
  behind: number | null
  /** epoch 초 — 마지막 저장 시점 */
  committedAt: number
  /** 끝 커밋 해시(40자) — "여기서 새 실험 공간"의 fromHash로 쓴다 */
  hash: string
}

/** 원격 브랜치 한 행 — 표시 이름이 곧 조작 키다 (E7a) */
export interface RemoteBranchRef {
  /** 'origin' — 첫 '/' 앞 */
  remote: string
  /** 'origin/feature/pay' — 전체 이름 */
  name: string
}

/** 실험 공간 패널 데이터 — for-each-ref 1회 일괄 수집 (E7a 스펙 접근안 A) */
export interface BranchOverview {
  locals: LocalBranchStatus[]
  remotes: RemoteBranchRef[]
}

/** "지금과 비교" 결과 — 양방향 전용 커밋 목록 (각 100개 상한) */
export interface BranchCompare {
  /** 선택 공간에만 있는 저장 (HEAD..name) */
  onlyInSelected: CommitSummary[]
  selectedOverflow: boolean
  /** 지금 공간에만 있는 저장 (name..HEAD) */
  onlyInCurrent: CommitSummary[]
  currentOverflow: boolean
}

/** 재배치 시작 결과 — conflict면 rebasing 상태가 남는다 (E7a) */
export interface RebaseResult {
  outcome: 'completed' | 'up-to-date' | 'conflict'
  autoShelved: boolean
}

/** 재배치 계속 결과 — 다음 저장이 또 겹치면 conflict */
export interface RebaseContinueResult {
  outcome: 'completed' | 'conflict'
}

/** 재배치 진행 위치 — .git/rebase-merge/msgnum·end (실측 2) */
export interface RebaseProgress {
  current: number
  total: number
}
```

- [x] **Step 2: 파서 Red.** `packages/git-adapter/test/overview-parser.test.ts` 신규:

```ts
import { describe, expect, it } from 'vitest'
import { parseOverview } from '../src/overview-parser'

const US = '\x1f'
const HASH_A = 'a'.repeat(40)
const HASH_B = 'b'.repeat(40)

/** 실측 1 포맷 — %(refname)%1f%(refname:short)%1f%(symref)%1f%(upstream:short)%1f%(upstream:track)%1f%(committerdate:unix)%1f%(objectname) */
function row(
  refname: string,
  short: string,
  symref: string,
  upstream: string,
  track: string,
  committedAt: string,
  hash: string,
): string {
  return [refname, short, symref, upstream, track, committedAt, hash].join(US)
}

describe('parseOverview', () => {
  it('로컬은 locals로, 원격은 remotes로 분류하고 현재 브랜치를 표시한다', () => {
    const raw = [
      row('refs/heads/main', 'main', '', 'origin/main', '', '100', HASH_A),
      row('refs/remotes/origin/main', 'origin/main', '', '', '', '100', HASH_A),
    ].join('\n')
    expect(parseOverview(raw, 'main')).toEqual({
      locals: [
        {
          name: 'main',
          isCurrent: true,
          upstream: 'origin/main',
          upstreamGone: false,
          ahead: 0,
          behind: 0,
          committedAt: 100,
          hash: HASH_A,
        },
      ],
      remotes: [{ remote: 'origin', name: 'origin/main' }],
    })
  })

  it('track "[ahead 1, behind 2]"를 숫자로 푼다 (한쪽만 있는 "[ahead 3]"도)', () => {
    const raw = [
      row('refs/heads/feature', 'feature', '', 'origin/feature', '[ahead 1, behind 2]', '100', HASH_A),
      row('refs/heads/solo', 'solo', '', 'origin/solo', '[ahead 3]', '100', HASH_B),
    ].join('\n')
    const { locals } = parseOverview(raw, null)
    expect(locals[0]).toMatchObject({ ahead: 1, behind: 2, upstreamGone: false })
    expect(locals[1]).toMatchObject({ ahead: 3, behind: 0 })
  })

  it('upstream이 없으면 ahead/behind는 null이다 (0/0으로 위장하지 않는다)', () => {
    const raw = row('refs/heads/nolink', 'nolink', '', '', '', '100', HASH_A)
    expect(parseOverview(raw, null).locals[0]).toMatchObject({
      upstream: null,
      ahead: null,
      behind: null,
      upstreamGone: false,
    })
  })

  it('[gone]은 upstreamGone으로 보존하고 ahead/behind는 null이다', () => {
    const raw = row('refs/heads/gonebr', 'gonebr', '', 'origin/gonebr', '[gone]', '100', HASH_A)
    expect(parseOverview(raw, null).locals[0]).toMatchObject({
      upstream: 'origin/gonebr',
      upstreamGone: true,
      ahead: null,
      behind: null,
    })
  })

  it('origin/HEAD 심볼릭 행(symref 비어 있지 않음 — 실측 1: short가 "origin")은 제외한다', () => {
    const raw = [
      row('refs/remotes/origin/HEAD', 'origin', 'refs/remotes/origin/main', '', '', '100', HASH_A),
      row('refs/remotes/origin/main', 'origin/main', '', '', '', '100', HASH_A),
    ].join('\n')
    expect(parseOverview(raw, null).remotes).toEqual([{ remote: 'origin', name: 'origin/main' }])
  })

  it('detached HEAD(현재 브랜치 null)면 isCurrent가 전부 false다', () => {
    const raw = row('refs/heads/main', 'main', '', '', '', '100', HASH_A)
    expect(parseOverview(raw, null).locals[0]!.isCurrent).toBe(false)
  })

  it('기형 행(필드 부족·숫자 아님)은 추측하지 않고 건너뛴다', () => {
    const raw = [
      'garbage-line',
      row('refs/heads/bad-time', 'bad-time', '', '', '', 'not-a-number', HASH_A),
      row('refs/heads/ok', 'ok', '', '', '', '100', HASH_A),
    ].join('\n')
    expect(parseOverview(raw, null).locals.map((b) => b.name)).toEqual(['ok'])
  })

  it('빈 입력이면 빈 개요다', () => {
    expect(parseOverview('', null)).toEqual({ locals: [], remotes: [] })
  })
})
```

- [x] **Step 3: Red 확인** — `pnpm vitest run --project @git-gui/git-adapter -t 'parseOverview'` 실행. **parseOverview 모듈 부재로 전부 실패**하는지 확인. (주의: `--project` 이름은 패키지 이름 `@git-gui/git-adapter`다 — 실측된 워크스페이스 관례.)

- [x] **Step 4: 파서 구현.** `packages/git-adapter/src/overview-parser.ts` 신규:

```ts
import type { BranchOverview, LocalBranchStatus, RemoteBranchRef } from '@git-gui/domain'

const FIELD_SEPARATOR = '\x1f'

/**
 * `%(upstream:track)` 해석 (실측 1): "[ahead 1, behind 2]" · "[ahead 3]" · "[behind 2]" ·
 * "[gone]"(원격이 지워짐) · ""(동기화 — upstream 없음과의 구분은 upstream 필드가 한다)
 */
function parseTrack(track: string): { ahead: number; behind: number; gone: boolean } {
  if (track === '[gone]') return { ahead: 0, behind: 0, gone: true }
  const ahead = /\bahead (\d+)/.exec(track)
  const behind = /\bbehind (\d+)/.exec(track)
  return {
    ahead: ahead ? Number(ahead[1]) : 0,
    behind: behind ? Number(behind[1]) : 0,
    gone: false,
  }
}

/**
 * `git for-each-ref refs/heads refs/remotes` 출력(줄 단위, 필드 US 구분)을 패널용 개요로 파싱한다.
 * - symref가 비어 있지 않은 행(origin/HEAD — 실측 1: short 이름이 "origin"으로 나온다)은 ref가 아니므로 제외
 * - refs/heads/* → locals, refs/remotes/* → remotes. 기형 행은 추측하지 않고 건너뛴다 (log-parser 관례)
 */
export function parseOverview(rawOutput: string, currentBranch: string | null): BranchOverview {
  const locals: LocalBranchStatus[] = []
  const remotes: RemoteBranchRef[] = []
  for (const line of rawOutput.split('\n')) {
    if (line === '') continue
    const fields = line.split(FIELD_SEPARATOR)
    if (fields.length < 7) continue
    const [refname, short, symref, upstream, track, committedAtRaw, hash] = fields as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ]
    if (symref !== '') continue
    const committedAt = Number(committedAtRaw)
    if (!Number.isFinite(committedAt)) continue
    if (refname.startsWith('refs/heads/')) {
      const { ahead, behind, gone } = parseTrack(track)
      const hasUpstream = upstream !== '' && !gone
      locals.push({
        name: short,
        isCurrent: short === currentBranch,
        upstream: upstream === '' ? null : upstream,
        upstreamGone: gone,
        ahead: hasUpstream ? ahead : null,
        behind: hasUpstream ? behind : null,
        committedAt,
        hash,
      })
    } else if (refname.startsWith('refs/remotes/')) {
      const slash = short.indexOf('/')
      if (slash <= 0) continue
      remotes.push({ remote: short.slice(0, slash), name: short })
    }
  }
  return { locals, remotes }
}
```

- [x] **Step 5: 파서 Green** — `pnpm vitest run --project @git-gui/git-adapter -t 'parseOverview'` → **8 passed**.

- [x] **Step 6: client 통합 Red.** `packages/git-adapter/test/client.test.ts`의 기존(branches.rename 테스트 전문 — 앵커):

```ts
  it('branches.rename — 이름을 바꾸고, 중복·잘못된 이름은 읽히는 메시지로 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('before', null)
    await client.branches.rename('before', 'after')
    expect((await client.branches.list()).map((b) => b.name).sort()).toEqual(['after', 'main'])
    await expect(client.branches.rename('after', 'main')).rejects.toThrow(/이미 있는 이름/)
    await expect(client.branches.rename('after', 'bad name')).rejects.toThrow(/만들 수 없어요/)
    await expect(client.branches.rename('no-such', 'x')).rejects.toThrow()
  })
```

바로 뒤에 추가:

```ts

  it('branches.overview — 로컬 ahead·연결 없음·원격을 한 번에 담고 현재를 표시한다 (E7a)', async () => {
    const { repo } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    await client.sync.push() // main upstream 연결(동기화 0/0)
    await writeFixtureFile(repo, 'a.txt', 'a\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', '앞선 저장'], { cwd: repo })
    await client.branches.create('nolink', null)
    const overview = await client.branches.overview()
    const main = overview.locals.find((b) => b.name === 'main')
    expect(main).toMatchObject({ isCurrent: true, upstream: 'origin/main', ahead: 1, behind: 0 })
    expect(main!.hash).toMatch(/^[0-9a-f]{40}$/)
    const nolink = overview.locals.find((b) => b.name === 'nolink')
    expect(nolink).toMatchObject({ isCurrent: false, upstream: null, ahead: null, behind: null })
    expect(overview.remotes).toEqual([{ remote: 'origin', name: 'origin/main' }])
  })
```

- [x] **Step 7: Red 확인** — `pnpm vitest run --project @git-gui/git-adapter -t 'overview'` → 신규 통합 1건이 **overview 메서드 부재(컴파일 에러)**로 실패 확인.

- [x] **Step 8: client 구현.** `packages/git-adapter/src/client.ts` — 편집 3곳.

(a) import 기존:

```ts
import { parseBranches, parseShelf } from './refs-parser'
```

교체:

```ts
import { parseOverview } from './overview-parser'
import { parseBranches, parseShelf } from './refs-parser'
```

(b) domain 타입 import 기존:

```ts
  type BranchSummary,
  type CherryPickResult,
```

교체:

```ts
  type BranchOverview,
  type BranchSummary,
  type CherryPickResult,
```

(c) 인터페이스 기존:

```ts
    /** 실험 공간 목록 — 마지막 저장 시점 최신순 */
    list(): Promise<BranchSummary[]>
```

교체:

```ts
    /** 실험 공간 목록 — 마지막 저장 시점 최신순 */
    list(): Promise<BranchSummary[]>
    /** 패널용 일괄 개요 — 로컬(upstream·ahead/behind·gone)+원격, for-each-ref 1회 (E7a) */
    overview(): Promise<BranchOverview>
```

(d) 런타임 기존(branches.list 전문 — 앵커):

```ts
      async list() {
        const cwd = await topLevel()
        const raw = await execGitOrThrow(
          [
            'for-each-ref',
            'refs/heads',
            '--sort=-committerdate',
            '--format=%(refname:short)\x1f%(HEAD)\x1f%(committerdate:unix)\x1f%(upstream:short)',
          ],
          { cwd },
        )
        return parseBranches(raw.stdout)
      },
```

교체:

```ts
      async list() {
        const cwd = await topLevel()
        const raw = await execGitOrThrow(
          [
            'for-each-ref',
            'refs/heads',
            '--sort=-committerdate',
            '--format=%(refname:short)\x1f%(HEAD)\x1f%(committerdate:unix)\x1f%(upstream:short)',
          ],
          { cwd },
        )
        return parseBranches(raw.stdout)
      },
      async overview() {
        const cwd = await topLevel()
        // %1f = US 구분자, symref = origin/HEAD 판별, refname 전체 경로 = heads/remotes 분류 (실측 1)
        const raw = await execGitOrThrow(
          [
            'for-each-ref',
            'refs/heads',
            'refs/remotes',
            '--sort=-committerdate',
            '--format=%(refname)%1f%(refname:short)%1f%(symref)%1f%(upstream:short)%1f%(upstream:track)%1f%(committerdate:unix)%1f%(objectname)',
          ],
          { cwd },
        )
        const head = await execGit(['symbolic-ref', '-q', '--short', 'HEAD'], { cwd })
        return parseOverview(raw.stdout, head.exitCode === 0 ? head.stdout.trim() : null)
      },
```

- [x] **Step 9: Green + 게이트** — `pnpm vitest run --project @git-gui/git-adapter` 전체 통과. 루트 `pnpm test` → **369 passed**. `pnpm typecheck` 전부 Done.

- [x] **Step 10: Commit**

```bash
git add packages/domain/src/repository.ts packages/git-adapter/src/overview-parser.ts packages/git-adapter/test/overview-parser.test.ts packages/git-adapter/src/client.ts packages/git-adapter/test/client.test.ts
git commit -m "feat(git-adapter): E7a branches.overview — for-each-ref 일괄(upstream·track·gone·origin/HEAD 제외 실측)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 엔진 — `branches.update`·`branches.backup` (+ rejectIfRemoteAhead 모듈 승격)

**Files:**
- Modify: `packages/git-adapter/src/client.ts`
- Test: `packages/git-adapter/test/client.test.ts` (+6)

- [x] **Step 1: Red — 실패 테스트 6건.** Task 1에서 추가한 `branches.overview` 테스트 바로 뒤에 추가:

```ts

  it('branches.update — 비현재 공간을 원격 최신으로 ff 업데이트한다 (실측 3)', async () => {
    const { repo, remote } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    await client.sync.push()
    await client.branches.create('old', null)
    await execGitOrThrow(['push', '-u', 'origin', 'old:old'], { cwd: repo })
    await execGitOrThrow(['config', 'branch.old.remote', 'origin'], { cwd: repo })
    await execGitOrThrow(['config', 'branch.old.merge', 'refs/heads/old'], { cwd: repo })
    // 다른 클론이 old를 앞세운다 — 로컬 old는 behind만 있는 상태
    const other = await mkdtemp(join(tmpdir(), 'git-gui-other-'))
    await execGitOrThrow(['clone', remote, other], { cwd: tmpdir() })
    await execGitOrThrow(['checkout', 'old'], { cwd: other })
    await writeFixtureFile(other, 'o.txt', 'o\n')
    await execGitOrThrow(['add', '-A'], { cwd: other })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'other old'], { cwd: other })
    await execGitOrThrow(['push'], { cwd: other })
    await client.branches.update('old')
    const localOld = (await execGitOrThrow(['rev-parse', 'old'], { cwd: repo })).stdout.trim()
    const remoteOld = (await execGitOrThrow(['rev-parse', 'origin/old'], { cwd: repo })).stdout.trim()
    expect(localOld).toBe(remoteOld)
  })

  it('branches.update — 갈라진 공간은 받아오기 안내로 거부한다 (non-fast-forward)', async () => {
    const { repo, remote } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    await client.sync.push()
    await client.branches.create('old', null)
    await execGitOrThrow(['push', '-u', 'origin', 'old:old'], { cwd: repo })
    await execGitOrThrow(['config', 'branch.old.remote', 'origin'], { cwd: repo })
    await execGitOrThrow(['config', 'branch.old.merge', 'refs/heads/old'], { cwd: repo })
    const other = await mkdtemp(join(tmpdir(), 'git-gui-other-'))
    await execGitOrThrow(['clone', remote, other], { cwd: tmpdir() })
    await execGitOrThrow(['checkout', 'old'], { cwd: other })
    await writeFixtureFile(other, 'o.txt', 'o\n')
    await execGitOrThrow(['add', '-A'], { cwd: other })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'other old'], { cwd: other })
    await execGitOrThrow(['push'], { cwd: other })
    // 로컬 old도 따로 전진 — 갈라짐(ahead+behind)
    await client.branches.switch('old')
    await writeFixtureFile(repo, 'l.txt', 'l\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'local old'], { cwd: repo })
    await client.branches.switch('main')
    await expect(client.branches.update('old')).rejects.toThrow(/갈라져 있어요/)
  })

  it('branches.update — upstream이 없으면 읽히는 메시지로 거부한다', async () => {
    const { repo } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    await client.branches.create('nolink', null)
    await expect(client.branches.update('nolink')).rejects.toThrow(/연결된 적이 없는/)
  })

  it('branches.update — 체크아웃된 공간은 pull 안내로 거부한다 (실측 3)', async () => {
    const { repo } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    await client.sync.push()
    await expect(client.branches.update('main')).rejects.toThrow(/받아오기\(pull\)로 업데이트/)
  })

  it('branches.backup — 비현재 공간을 checkout 없이 push한다 (upstream 없으면 -u 연결)', async () => {
    const { repo, remote } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    await client.sync.push()
    await client.branches.create('side', null)
    // 첫 백업 — upstream 없음 → -u 연결 경로
    await client.branches.backup('side')
    const upstream = await execGitOrThrow(['config', '--get', 'branch.side.remote'], { cwd: repo })
    expect(upstream.stdout.trim()).toBe('origin')
    // 연결된 뒤 두 번째 백업 — refspec 경로. side를 전진시키고 원격 해시 일치를 확인
    await client.branches.switch('side')
    await writeFixtureFile(repo, 's.txt', 's\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'side work'], { cwd: repo })
    await client.branches.switch('main')
    await client.branches.backup('side')
    const localSide = (await execGitOrThrow(['rev-parse', 'side'], { cwd: repo })).stdout.trim()
    const remoteSide = (
      await execGitOrThrow(['rev-parse', 'side'], { cwd: remote })
    ).stdout.trim()
    expect(remoteSide).toBe(localSide)
  })

  it('branches.backup — 원격이 앞서 있으면 받아오기 안내로 거부한다 (E6b 매핑 공유)', async () => {
    const { repo, remote } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    await client.sync.push()
    await client.branches.create('side', null)
    await client.branches.backup('side')
    // 다른 클론이 side를 앞세운다 — 로컬 side의 push는 fetch first 거부
    const other = await mkdtemp(join(tmpdir(), 'git-gui-other-'))
    await execGitOrThrow(['clone', remote, other], { cwd: tmpdir() })
    await execGitOrThrow(['checkout', 'side'], { cwd: other })
    await writeFixtureFile(other, 'o.txt', 'o\n')
    await execGitOrThrow(['add', '-A'], { cwd: other })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'other side'], { cwd: other })
    await execGitOrThrow(['push'], { cwd: other })
    await client.branches.switch('side')
    await writeFixtureFile(repo, 'l.txt', 'l\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'local side'], { cwd: repo })
    await client.branches.switch('main')
    await expect(client.branches.backup('side')).rejects.toThrow(
      '원격에 새 저장이 있어요. 먼저 받아오기(pull)로 합친 뒤 백업해 주세요.',
    )
  })
```

- [x] **Step 2: Red 확인** — `pnpm vitest run --project @git-gui/git-adapter -t 'branches.update'` + `-t 'branches.backup'` → 신규 6건이 **메서드 부재(컴파일 에러)**로 실패 확인.

- [x] **Step 3: rejectIfRemoteAhead 모듈 승격.** `packages/git-adapter/src/client.ts` 기존:

```ts
const CHERRY_PICK_SHELF_MESSAGE = '저장 가져오기 자동 보관'
```

교체:

```ts
const CHERRY_PICK_SHELF_MESSAGE = '저장 가져오기 자동 보관'

/**
 * 원격이 앞서 거부된 push (E5b 후속·E6b 실측) — stderr 4케이스 전부 "! [rejected] …
 * (fetch first|non-fast-forward)". undo(실행취소)로 로컬이 뒤로 간 경우도 같은
 * non-fast-forward 거부라 같은 문구로 커버된다. 'failed to push some refs'는 hook
 * 거부([remote rejected])에도 나와 쓰지 않는다 — 괄호 사유로만 판정한다.
 * E7a에서 브랜치별 백업(branches.backup)과 공유하려고 sync.push 안에서 모듈로 올렸다
 */
function rejectIfRemoteAhead(result: GitResult): void {
  if (
    result.stderr.includes('(fetch first)') ||
    result.stderr.includes('(non-fast-forward)')
  ) {
    throw new Error('원격에 새 저장이 있어요. 먼저 받아오기(pull)로 합친 뒤 백업해 주세요.')
  }
}
```

그리고 sync.push 안의 기존(중첩 정의 — E6b가 넣었다):

```ts
        // 원격이 앞서 거부된 push (E5b 후속) — 실측 stderr 4케이스 전부 "! [rejected] …
        // (fetch first|non-fast-forward)". undo(실행취소)로 로컬이 뒤로 간 경우도 같은
        // non-fast-forward 거부라 같은 문구로 커버된다. 'failed to push some refs'는 hook
        // 거부([remote rejected])에도 나와 쓰지 않는다 — 괄호 사유로만 판정한다
        const rejectIfRemoteAhead = (result: GitResult): void => {
          if (
            result.stderr.includes('(fetch first)') ||
            result.stderr.includes('(non-fast-forward)')
          ) {
            throw new Error('원격에 새 저장이 있어요. 먼저 받아오기(pull)로 합친 뒤 백업해 주세요.')
          }
        }
        const branch = await execGit(['symbolic-ref', '-q', '--short', 'HEAD'], { cwd })
```

교체(중첩 정의 삭제 — 모듈 함수를 그대로 참조한다):

```ts
        const branch = await execGit(['symbolic-ref', '-q', '--short', 'HEAD'], { cwd })
```

- [x] **Step 4: update·backup 구현.** 같은 파일, 인터페이스 기존:

```ts
    /** 패널용 일괄 개요 — 로컬(upstream·ahead/behind·gone)+원격, for-each-ref 1회 (E7a) */
    overview(): Promise<BranchOverview>
```

교체:

```ts
    /** 패널용 일괄 개요 — 로컬(upstream·ahead/behind·gone)+원격, for-each-ref 1회 (E7a) */
    overview(): Promise<BranchOverview>
    /**
     * 선택 공간을 원격 최신으로(비현재 전용 — 현재 공간은 renderer가 받아오기(pull)로 보낸다).
     * fetch refspec은 ff-only가 기본(실측 3) — 갈라졌으면 이동해서 pull 하도록 친절 거부한다
     */
    update(name: string): Promise<void>
    /** 선택 공간을 checkout 없이 백업(push). upstream 없으면 -u로 연결하며 올린다 (origin 우선 관례) */
    backup(name: string): Promise<void>
```

그리고 런타임의 Task 1에서 추가한 `overview()` 구현 끝 기존:

```ts
        const head = await execGit(['symbolic-ref', '-q', '--short', 'HEAD'], { cwd })
        return parseOverview(raw.stdout, head.exitCode === 0 ? head.stdout.trim() : null)
      },
```

교체:

```ts
        const head = await execGit(['symbolic-ref', '-q', '--short', 'HEAD'], { cwd })
        return parseOverview(raw.stdout, head.exitCode === 0 ? head.stdout.trim() : null)
      },
      async update(name) {
        const cwd = await topLevel()
        const remote = await execGit(['config', '--get', `branch.${name}.remote`], { cwd })
        const mergeRef = await execGit(['config', '--get', `branch.${name}.merge`], { cwd })
        if (remote.exitCode !== 0 || mergeRef.exitCode !== 0) {
          throw new Error('원격과 연결된 적이 없는 공간이에요. 그 공간으로 이동해 백업(push)하면 연결돼요.')
        }
        const remoteName = remote.stdout.trim()
        const srcBranch = mergeRef.stdout.trim().replace(/^refs\/heads\//, '')
        // ff-only가 fetch refspec의 기본 동작이다(강제 없음) — 갈라졌으면 rejected로 끝난다 (실측 3)
        const args = ['fetch', '--end-of-options', remoteName, `${srcBranch}:${name}`]
        const result = await execGit(args, { cwd })
        if (result.exitCode !== 0) {
          if (result.stderr.includes('(non-fast-forward)')) {
            throw new Error(
              '이 공간은 원격과 갈라져 있어요. 그 공간으로 이동한 뒤 받아오기(pull)로 합쳐 주세요.',
            )
          }
          // 현재 공간(다른 워크트리 포함) — refspec fetch가 체크아웃된 브랜치를 거부한다 (실측 3)
          if (result.stderr.includes('refusing to fetch into branch')) {
            throw new Error('지금 체크아웃되어 있는 공간이에요. 받아오기(pull)로 업데이트해 주세요.')
          }
          if (result.stderr.includes("couldn't find remote ref")) {
            throw new Error('원격에 이 공간이 더 이상 없어요. 새로고침해 주세요.')
          }
          throw new GitError(args, result)
        }
      },
      async backup(name) {
        const cwd = await topLevel()
        const remoteConfig = await execGit(['config', '--get', `branch.${name}.remote`], { cwd })
        if (remoteConfig.exitCode !== 0) {
          // upstream 없음 — sync.push의 origin 우선 관례로 첫 연결하며 올린다
          const remotes = await execGitOrThrow(['remote'], { cwd })
          const remoteNames = remotes.stdout
            .trim()
            .split('\n')
            .filter((n) => n !== '')
          if (remoteNames.length === 0) {
            throw new Error('백업할 원격 저장소가 없어요. 먼저 원격 저장소를 연결해 주세요.')
          }
          const target = remoteNames.includes('origin') ? 'origin' : remoteNames[0]!
          const args = ['push', '-u', '--end-of-options', target, name]
          const linked = await execGit(args, { cwd })
          if (linked.exitCode !== 0) {
            rejectIfRemoteAhead(linked)
            throw new GitError(args, linked)
          }
          return
        }
        const remoteName = remoteConfig.stdout.trim()
        const mergeRef = await execGitOrThrow(['config', '--get', `branch.${name}.merge`], { cwd })
        const dstBranch = mergeRef.stdout.trim().replace(/^refs\/heads\//, '')
        const args = ['push', '--end-of-options', remoteName, `${name}:${dstBranch}`]
        const result = await execGit(args, { cwd })
        if (result.exitCode !== 0) {
          rejectIfRemoteAhead(result)
          throw new GitError(args, result)
        }
      },
```

- [x] **Step 5: Green + 게이트** — `pnpm vitest run --project @git-gui/git-adapter` 전체 통과(기존 sync.push 테스트 8건 무회귀 = 모듈 승격 검증). 루트 `pnpm test` → **375 passed**. `pnpm typecheck` Done.

- [x] **Step 6: Commit**

```bash
git add packages/git-adapter/src/client.ts packages/git-adapter/test/client.test.ts
git commit -m "feat(git-adapter): E7a 브랜치별 업데이트(ff-only fetch)·백업(checkout 없는 push) — E6b 원격 앞섬 매핑 공유

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 엔진 — `checkoutRemote`·`removeRemote`·`compare`

**Files:**
- Modify: `packages/git-adapter/src/client.ts`
- Test: `packages/git-adapter/test/client.test.ts` (+7)

- [x] **Step 1: Red — 실패 테스트 7건.** Task 2에서 추가한 `branches.backup — 원격이 앞서…` 테스트 바로 뒤에 추가:

```ts

  it('branches.checkoutRemote — 원격 공간을 추적 브랜치로 가져와 이동한다', async () => {
    const { repo, remote } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    await client.sync.push()
    const other = await mkdtemp(join(tmpdir(), 'git-gui-other-'))
    await execGitOrThrow(['clone', remote, other], { cwd: tmpdir() })
    await execGitOrThrow(['checkout', '-b', 'feature/pay'], { cwd: other })
    await writeFixtureFile(other, 'p.txt', 'p\n')
    await execGitOrThrow(['add', '-A'], { cwd: other })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'pay'], { cwd: other })
    await execGitOrThrow(['push', '-u', 'origin', 'feature/pay'], { cwd: other })
    await execGitOrThrow(['fetch', 'origin'], { cwd: repo })
    const result = await client.branches.checkoutRemote('origin/feature/pay')
    expect(result).toEqual({ autoShelved: false })
    const current = (
      await execGitOrThrow(['symbolic-ref', '--short', 'HEAD'], { cwd: repo })
    ).stdout.trim()
    expect(current).toBe('feature/pay')
    const upstream = await execGitOrThrow(['config', '--get', 'branch.feature/pay.remote'], {
      cwd: repo,
    })
    expect(upstream.stdout.trim()).toBe('origin')
  })

  it('branches.checkoutRemote — 동명 로컬이 있으면 읽히는 메시지로 거부한다 (실측 4)', async () => {
    const { repo, remote } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    await client.sync.push()
    await execGitOrThrow(['fetch', 'origin'], { cwd: repo })
    await expect(client.branches.checkoutRemote('origin/main')).rejects.toThrow(
      /이미 "main" 공간이 있어요/,
    )
  })

  it('branches.checkoutRemote — 겹치는 변경은 자동 보관 후 이동한다 (switch 관례)', async () => {
    const { repo, remote } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    await client.sync.push()
    const other = await mkdtemp(join(tmpdir(), 'git-gui-other-'))
    await execGitOrThrow(['clone', remote, other], { cwd: tmpdir() })
    await execGitOrThrow(['checkout', '-b', 'rival'], { cwd: other })
    await writeFixtureFile(other, 'README.md', '# rival\n')
    await execGitOrThrow(['add', '-A'], { cwd: other })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'rival'], { cwd: other })
    await execGitOrThrow(['push', '-u', 'origin', 'rival'], { cwd: other })
    await execGitOrThrow(['fetch', 'origin'], { cwd: repo })
    // 같은 파일을 로컬에서 수정해 둔다 — 그대로 이동하면 would be overwritten
    await writeFixtureFile(repo, 'README.md', '# local edit\n')
    const result = await client.branches.checkoutRemote('origin/rival')
    expect(result).toEqual({ autoShelved: true })
    expect((await client.shelf.list()).length).toBe(1)
  })

  it('branches.removeRemote — 원격에서 지운다 (bare 저장소에서 소멸 확인)', async () => {
    const { repo, remote } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    await client.sync.push()
    await client.branches.create('doomed', null)
    await client.branches.backup('doomed')
    expect(
      (await execGitOrThrow(['branch', '--list', 'doomed'], { cwd: remote })).stdout,
    ).toContain('doomed')
    await client.branches.removeRemote('origin/doomed')
    expect(
      (await execGitOrThrow(['branch', '--list', 'doomed'], { cwd: remote })).stdout.trim(),
    ).toBe('')
  })

  it('branches.removeRemote — 원격에 이미 없으면 읽히는 메시지로 거부한다', async () => {
    const { repo } = await createFixtureRepoWithRemote()
    const client = createGitClient(repo)
    await client.sync.push()
    await expect(client.branches.removeRemote('origin/no-such')).rejects.toThrow(/이미 없어요/)
  })

  it('branches.compare — 양방향 전용 저장을 나눠 담는다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('rival', null)
    await writeFixtureFile(repo, 'mine.txt', 'm\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', '내 전용 저장'], { cwd: repo })
    await client.branches.switch('rival')
    await writeFixtureFile(repo, 'rival.txt', 'r\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', '상대 전용 저장'], { cwd: repo })
    await client.branches.switch('main')
    const compare = await client.branches.compare('rival')
    expect(compare.onlyInSelected.map((c) => c.subject)).toEqual(['상대 전용 저장'])
    expect(compare.onlyInCurrent.map((c) => c.subject)).toEqual(['내 전용 저장'])
    expect(compare.selectedOverflow).toBe(false)
    expect(compare.currentOverflow).toBe(false)
  })

  it('branches.compare — 100개 상한을 넘으면 overflow로 알린다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('base-mark', null)
    for (let i = 0; i < 101; i += 1) {
      await execGitOrThrow(
        [...FIXTURE_IDENT, 'commit', '--allow-empty', '-m', `bulk ${i}`],
        { cwd: repo },
      )
    }
    const compare = await client.branches.compare('base-mark')
    expect(compare.onlyInCurrent.length).toBe(100)
    expect(compare.currentOverflow).toBe(true)
    expect(compare.onlyInSelected).toEqual([])
  })
```

- [x] **Step 2: Red 확인** — `pnpm vitest run --project @git-gui/git-adapter -t 'checkoutRemote'`·`-t 'removeRemote'`·`-t 'branches.compare'` → 신규 7건이 메서드 부재로 실패 확인.

- [x] **Step 3: 구현.** `packages/git-adapter/src/client.ts` — 편집 3곳.

(a) 모듈 상수: Task 2에서 승격한 `rejectIfRemoteAhead` 함수 정의 바로 앞(기존 `const CHERRY_PICK_SHELF_MESSAGE = '저장 가져오기 자동 보관'` 뒤 빈 줄)에 추가가 아니라 — 인터페이스·구현만 편집한다. compare 상한은 함수 지역이 아닌 모듈 상수로 `rejectIfRemoteAhead` 정의 바로 위에 둔다. 기존:

```ts
/**
 * 원격이 앞서 거부된 push (E5b 후속·E6b 실측) — stderr 4케이스 전부 "! [rejected] …
```

교체:

```ts
/** "지금과 비교" 한 방향 상한 — 초과분은 overflow 플래그로만 알린다 (E7a) */
const COMPARE_LIMIT = 100

/**
 * 원격이 앞서 거부된 push (E5b 후속·E6b 실측) — stderr 4케이스 전부 "! [rejected] …
```

(b) 인터페이스 기존:

```ts
    /** 선택 공간을 checkout 없이 백업(push). upstream 없으면 -u로 연결하며 올린다 (origin 우선 관례) */
    backup(name: string): Promise<void>
```

교체:

```ts
    /** 선택 공간을 checkout 없이 백업(push). upstream 없으면 -u로 연결하며 올린다 (origin 우선 관례) */
    backup(name: string): Promise<void>
    /** 원격 공간을 추적 로컬 브랜치로 가져와 이동한다. 동명 로컬이 있으면 거부, 겹치면 자동 보관 (switch 관례) */
    checkoutRemote(name: string): Promise<SwitchResult>
    /** 원격에서 이 공간을 지운다(push --delete) — 확인창은 UI 책임. 다른 사람에게도 영향이 있다 */
    removeRemote(name: string): Promise<void>
    /** 지금 공간과의 양방향 전용 저장 목록 — 각 100개 상한 + overflow (E7a) */
    compare(name: string): Promise<BranchCompare>
```

(c) 런타임 — Task 2에서 추가한 `backup()` 구현 끝 기존:

```ts
        const args = ['push', '--end-of-options', remoteName, `${name}:${dstBranch}`]
        const result = await execGit(args, { cwd })
        if (result.exitCode !== 0) {
          rejectIfRemoteAhead(result)
          throw new GitError(args, result)
        }
      },
```

교체:

```ts
        const args = ['push', '--end-of-options', remoteName, `${name}:${dstBranch}`]
        const result = await execGit(args, { cwd })
        if (result.exitCode !== 0) {
          rejectIfRemoteAhead(result)
          throw new GitError(args, result)
        }
      },
      async checkoutRemote(name) {
        const cwd = await topLevel()
        const slash = name.indexOf('/')
        if (slash <= 0) throw new Error(`"${name}"는 원격 공간 이름이 아니에요.`)
        const local = name.slice(slash + 1)
        // 동명 로컬 선검사 — switch -c의 원어 fatal(실측 4) 대신 행동 안내를 준다
        const existing = await execGit(['rev-parse', '-q', '--verify', `refs/heads/${local}`], {
          cwd,
        })
        if (existing.exitCode === 0) {
          throw new Error(
            `이미 "${local}" 공간이 있어요. 그 공간으로 이동해 "원격 최신으로 업데이트"해 주세요.`,
          )
        }
        const args = ['switch', '-c', local, '--track', '--end-of-options', name]
        const first = await execGit(args, { cwd })
        if (first.exitCode === 0) return { autoShelved: false }
        if (!first.stderr.includes('would be overwritten')) throw new GitError(args, first)
        // 겹쳐서 막혔다 — 스펙 원칙: 변경을 보관함에 자동 저장하고 진행한다 (switch 관례)
        await execGitOrThrow(['stash', 'push', '-u', '-m', AUTO_SHELF_MESSAGE], { cwd })
        await execGitOrThrow(args, { cwd })
        return { autoShelved: true }
      },
      async removeRemote(name) {
        const cwd = await topLevel()
        const slash = name.indexOf('/')
        if (slash <= 0) throw new Error(`"${name}"는 원격 공간 이름이 아니에요.`)
        const remoteName = name.slice(0, slash)
        const branch = name.slice(slash + 1)
        const args = ['push', '--delete', '--end-of-options', remoteName, branch]
        const result = await execGit(args, { cwd })
        if (result.exitCode !== 0) {
          if (result.stderr.includes('remote ref does not exist')) {
            throw new Error('원격에 이 공간이 이미 없어요. 새로고침해 주세요.')
          }
          throw new GitError(args, result)
        }
      },
      async compare(name) {
        const cwd = await topLevel()
        const valid = await execGit(['rev-parse', '-q', '--verify', `${name}^{commit}`], { cwd })
        if (valid.exitCode !== 0) {
          throw new Error(`"${name}"라는 공간을 찾을 수 없어요. 새로고침해 주세요.`)
        }
        // history.list와 같은 레코드 포맷 — parseLog를 그대로 재사용한다
        const listSide = async (range: string) => {
          const raw = await execGitOrThrow(
            [
              'log',
              '--format=%H%x1f%h%x1f%an%x1f%ct%x1f%D%x1f%P%x1f%s',
              '-z',
              '-n',
              String(COMPARE_LIMIT + 1),
              range,
            ],
            { cwd },
          )
          const commits = parseLog(raw.stdout)
          return {
            commits: commits.slice(0, COMPARE_LIMIT),
            overflow: commits.length > COMPARE_LIMIT,
          }
        }
        const selectedOnly = await listSide(`HEAD..${name}`)
        const currentOnly = await listSide(`${name}..HEAD`)
        return {
          onlyInSelected: selectedOnly.commits,
          selectedOverflow: selectedOnly.overflow,
          onlyInCurrent: currentOnly.commits,
          currentOverflow: currentOnly.overflow,
        }
      },
```

(d) domain 타입 import 기존:

```ts
  type BranchOverview,
  type BranchSummary,
```

교체:

```ts
  type BranchCompare,
  type BranchOverview,
  type BranchSummary,
```

- [x] **Step 4: Green + 게이트** — `pnpm vitest run --project @git-gui/git-adapter` 전체 통과. 루트 `pnpm test` → **382 passed**. `pnpm typecheck` Done.

- [x] **Step 5: Commit**

```bash
git add packages/git-adapter/src/client.ts packages/git-adapter/test/client.test.ts
git commit -m "feat(git-adapter): E7a 원격 공간 가져오기(추적)·원격에서 지우기·지금과 비교(양방향 100 상한)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 엔진 — `rebase` 네임스페이스 (start·continue·abort·progress)

**Files:**
- Modify: `packages/git-adapter/src/client.ts`
- Test: `packages/git-adapter/test/client.test.ts` (+6)

- [x] **Step 1: Red — 실패 테스트 6건.** Task 3에서 추가한 `branches.compare — 100개 상한…` 테스트 바로 뒤에 추가:

```ts

  it('rebase.start — 깨끗하면 완료되고 브랜치가 onto 위로 옮겨진다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('topic', null)
    await writeFixtureFile(repo, 'base.txt', 'b\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'main 전진'], { cwd: repo })
    await client.branches.switch('topic')
    await writeFixtureFile(repo, 'topic.txt', 't\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'topic 저장'], { cwd: repo })
    const result = await client.rebase.start('main')
    expect(result).toEqual({ outcome: 'completed', autoShelved: false })
    // topic의 부모가 main 끝이 됐다 — 재배치 성립
    const parent = (await execGitOrThrow(['rev-parse', 'HEAD^'], { cwd: repo })).stdout.trim()
    const main = (await execGitOrThrow(['rev-parse', 'main'], { cwd: repo })).stdout.trim()
    expect(parent).toBe(main)
  })

  it('rebase.start — 이미 그 위에 있으면 up-to-date다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('topic', null)
    await client.branches.switch('topic')
    await writeFixtureFile(repo, 'topic.txt', 't\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'topic 저장'], { cwd: repo })
    const result = await client.rebase.start('main')
    expect(result).toEqual({ outcome: 'up-to-date', autoShelved: false })
  })

  it('rebase.start — 작업 중 변경이 있으면 자동 보관 후 재시도한다 (실측 2 dirty 판정)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('topic', null)
    await writeFixtureFile(repo, 'base.txt', 'b\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'main 전진'], { cwd: repo })
    await client.branches.switch('topic')
    await writeFixtureFile(repo, 'topic.txt', 't\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'topic 저장'], { cwd: repo })
    await writeFixtureFile(repo, 'README.md', '# dirty\n')
    const result = await client.rebase.start('main')
    expect(result).toEqual({ outcome: 'completed', autoShelved: true })
    expect((await client.shelf.list()).length).toBe(1)
  })

  it('rebase — 충돌 루프: conflict → progress → 해소·continue → 완료 (실측 2)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('topic', null)
    await writeFixtureFile(repo, 'README.md', '# main version\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'main 편집'], { cwd: repo })
    await client.branches.switch('topic')
    await writeFixtureFile(repo, 'README.md', '# topic v1\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'topic 1'], { cwd: repo })
    await writeFixtureFile(repo, 'README.md', '# topic v2\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'topic 2'], { cwd: repo })
    const start = await client.rebase.start('main')
    expect(start).toEqual({ outcome: 'conflict', autoShelved: false })
    expect((await client.repo.status()).state).toBe('rebasing')
    expect(await client.rebase.progress()).toEqual({ current: 1, total: 2 })
    // 1번째 저장 해소 — 원본 topic 1 내용과 byte-identical하면 git이 2번째 저장의
    // 패치를 base=해소본으로 보고 무충돌 자동 적용해버린다(3-way merge fast path, 실기동 확인) —
    // 두 번째 충돌을 재현하려면 해소 내용을 원본과 다르게 한다 (플랜 대비 실측 보정)
    await writeFixtureFile(repo, 'README.md', '# topic v1 (resolved)\n')
    await execGitOrThrow(['add', 'README.md'], { cwd: repo })
    const mid = await client.rebase.continue()
    expect(mid).toEqual({ outcome: 'conflict' })
    expect(await client.rebase.progress()).toEqual({ current: 2, total: 2 })
    await writeFixtureFile(repo, 'README.md', '# topic v2\n')
    await execGitOrThrow(['add', 'README.md'], { cwd: repo })
    const done = await client.rebase.continue()
    expect(done).toEqual({ outcome: 'completed' })
    expect((await client.repo.status()).state).toBe('normal')
    const subjects = (
      await execGitOrThrow(['log', '--format=%s', '-n', '3'], { cwd: repo })
    ).stdout
      .trim()
      .split('\n')
    expect(subjects).toEqual(['topic 2', 'topic 1', 'main 편집'])
  })

  it('rebase.continue — 겹침이 남아 있으면 읽히는 메시지로 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('topic', null)
    await writeFixtureFile(repo, 'README.md', '# main version\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'main 편집'], { cwd: repo })
    await client.branches.switch('topic')
    await writeFixtureFile(repo, 'README.md', '# topic v1\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'topic 1'], { cwd: repo })
    await client.rebase.start('main')
    await expect(client.rebase.continue()).rejects.toThrow(/겹침이 남아 있어요/)
  })

  it('rebase.abort — 시작 전 상태로 복원하고, 재배치 중이 아니면 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await expect(client.rebase.abort()).rejects.toThrow(/재배치 중이 아니에요/)
    await client.branches.create('topic', null)
    await writeFixtureFile(repo, 'README.md', '# main version\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'main 편집'], { cwd: repo })
    await client.branches.switch('topic')
    await writeFixtureFile(repo, 'README.md', '# topic v1\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'topic 1'], { cwd: repo })
    const before = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
    await client.rebase.start('main')
    await client.rebase.abort()
    expect((await client.repo.status()).state).toBe('normal')
    expect((await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()).toBe(before)
    expect(await client.rebase.progress()).toBeNull()
  })
```

- [x] **Step 2: Red 확인** — `pnpm vitest run --project @git-gui/git-adapter -t 'rebase'` → 신규 6건이 **rebase 네임스페이스 부재(컴파일 에러)**로 실패 확인.

- [x] **Step 3: 구현.** `packages/git-adapter/src/client.ts` — 편집 4곳.

(a) 보관 메시지 상수 기존:

```ts
const CHERRY_PICK_SHELF_MESSAGE = '저장 가져오기 자동 보관'
```

교체:

```ts
const CHERRY_PICK_SHELF_MESSAGE = '저장 가져오기 자동 보관'

/** 재배치가 막혀 자동 보관할 때의 보관함 메시지 (E7a) */
const REBASE_SHELF_MESSAGE = '저장 재배치 자동 보관'
```

(b) domain 타입 import 기존:

```ts
  type PullResult,
  type RemoveBranchResult,
```

교체:

```ts
  type PullResult,
  type RebaseContinueResult,
  type RebaseProgress,
  type RebaseResult,
  type RemoveBranchResult,
```

(c) 인터페이스 — 기존(branches 네임스페이스가 끝나고 merge가 시작하는 지점):

```ts
    /** 이름 바꾸기 */
    rename(oldName: string, newName: string): Promise<void>
  }
  merge: {
```

교체:

```ts
    /** 이름 바꾸기 */
    rename(oldName: string, newName: string): Promise<void>
  }
  rebase: {
    /**
     * 현재 공간을 onto 위로 재배치. 작업 중 변경이 겹치면 자동 보관 후 재시도(merge 관례).
     * conflict면 rebasing 상태가 남는다 — 해소는 기존 충돌 카드, 진행은 continue, 취소는 abort
     */
    start(onto: string): Promise<RebaseResult>
    /**
     * 겹침을 모두 해소(add)한 뒤 다음 저장으로. 남은 저장이 또 겹치면 conflict.
     * 해소 결과가 빈 저장이면 git이 자동으로 건너뛴다(실측 2 — --skip 확인창 불필요)
     */
    continue(): Promise<RebaseContinueResult>
    /** 재배치 취소 — 시작 전 상태로 되돌린다 */
    abort(): Promise<void>
    /** 진행 위치(.git/rebase-merge/msgnum·end — 실측 2). rebasing이 아니면 null */
    progress(): Promise<RebaseProgress | null>
  }
  merge: {
```

(d) 런타임 — 기존(branches 런타임의 rename 구현 끝, `newName` 에러 문구가 유일 앵커):

```ts
        const args = ['branch', '-m', '--end-of-options', oldName, newName]
        const result = await execGit(args, { cwd })
        if (result.exitCode !== 0) {
          if (result.stderr.includes('already exists')) {
            throw new Error(`"${newName}"는 이미 있는 이름이에요. 다른 이름을 지어 주세요.`)
          }
          throw new GitError(args, result)
        }
      },
    },
```

교체:

```ts
        const args = ['branch', '-m', '--end-of-options', oldName, newName]
        const result = await execGit(args, { cwd })
        if (result.exitCode !== 0) {
          if (result.stderr.includes('already exists')) {
            throw new Error(`"${newName}"는 이미 있는 이름이에요. 다른 이름을 지어 주세요.`)
          }
          throw new GitError(args, result)
        }
      },
    },
    rebase: {
      async start(onto) {
        const cwd = await topLevel()
        const classify = (result: GitResult): RebaseResult['outcome'] | null => {
          const output = result.stdout + result.stderr
          if (result.exitCode === 0) {
            return output.includes('is up to date') ? 'up-to-date' : 'completed'
          }
          if (output.includes('Could not apply') || output.includes('CONFLICT')) return 'conflict'
          return null
        }
        // 사용자 전역 rebase.autostash가 켜져 있으면 git이 스스로 stash+pop 해버려 우리의
        // 자동 보관 경로·notice가 죽고, pop 충돌이 exit 0 뒤에 숨는다(품질 리뷰 재현) — 항상 끈다
        const args = ['-c', 'rebase.autostash=false', 'rebase', '--end-of-options', onto]
        const first = await execGit(args, { cwd })
        const firstOutcome = classify(first)
        if (firstOutcome !== null) return { outcome: firstOutcome, autoShelved: false }
        const firstOut = first.stdout + first.stderr
        if (firstOut.includes('invalid upstream')) {
          throw new Error(`"${onto}"라는 실험 공간이 없어요.`)
        }
        if (
          !firstOut.includes('You have unstaged changes') &&
          !firstOut.includes('Please commit or stash')
        ) {
          throw new GitError(args, first)
        }
        // 막혔다 — 스펙 원칙: 변경을 보관함에 자동 저장하고 재시도한다 (merge 관례, 실측 2 dirty 판정)
        await execGitOrThrow(['stash', 'push', '-u', '-m', REBASE_SHELF_MESSAGE], { cwd })
        const second = await execGit(args, { cwd })
        const secondOutcome = classify(second)
        if (secondOutcome !== null) return { outcome: secondOutcome, autoShelved: true }
        throw new GitError(args, second)
      },
      async continue() {
        const cwd = await topLevel()
        // 원 메시지를 그대로 쓴다 — 편집기가 열리면 앱이 멈추므로 방어적으로 무시한다
        const args = ['-c', 'core.editor=true', 'rebase', '--continue']
        const result = await execGit(args, { cwd })
        if (result.exitCode === 0) return { outcome: 'completed' as const }
        const output = result.stdout + result.stderr
        if (output.includes('Could not apply') || output.includes('CONFLICT')) {
          return { outcome: 'conflict' as const }
        }
        if (output.includes('needs merge') || output.includes('You must edit all merge conflicts')) {
          throw new Error('아직 겹침이 남아 있어요. 붉은 ! 파일을 모두 해결한 뒤 계속해 주세요.')
        }
        if (output.includes('no rebase in progress')) {
          throw new Error('지금은 재배치 중이 아니에요.')
        }
        throw new GitError(args, result)
      },
      async abort() {
        const cwd = await topLevel()
        const result = await execGit(['rebase', '--abort'], { cwd })
        if (result.exitCode !== 0) {
          if (result.stderr.includes('no rebase in progress')) {
            throw new Error('지금은 재배치 중이 아니에요.')
          }
          throw new GitError(['rebase', '--abort'], result)
        }
      },
      async progress() {
        const cwd = await topLevel()
        const gitDir = (
          await execGitOrThrow(['rev-parse', '--absolute-git-dir'], { cwd })
        ).stdout.trim()
        // merge 백엔드(이 앱이 시작하는 rebase의 기본)의 진행 파일 — msgnum=현재, end=전체 (실측 2).
        // 파일이 없으면(외부 apply 백엔드 등) 진행 표시를 생략한다 — 추측하지 않는다
        try {
          const [current, total] = await Promise.all([
            readFile(join(gitDir, 'rebase-merge', 'msgnum'), 'utf8'),
            readFile(join(gitDir, 'rebase-merge', 'end'), 'utf8'),
          ])
          const parsed = { current: Number(current.trim()), total: Number(total.trim()) }
          if (!Number.isFinite(parsed.current) || !Number.isFinite(parsed.total)) return null
          return parsed
        } catch {
          return null
        }
      },
    },
```

- [x] **Step 4: Green + 게이트** — `pnpm vitest run --project @git-gui/git-adapter` 전체 통과. 루트 `pnpm test` → **388 passed**. `pnpm typecheck` Done.

- [x] **Step 5: Commit**

```bash
git add packages/git-adapter/src/client.ts packages/git-adapter/test/client.test.ts
git commit -m "feat(git-adapter): E7a rebase 네임스페이스 — 자동 보관 재시도·충돌 루프(continue)·진행 위치(msgnum/end 실측)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: IPC 계약·preload·핸들러·store 배선

**Files:**
- Modify: `packages/ipc-contract/src/index.ts`
- Modify: `apps/desktop/src/main/git-handlers.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/renderer/src/store/repository-store.ts`

store 단위 테스트는 없다 — 이 저장소 관례상 store는 E2E(실제 Electron + hermetic git)로만 검증한다(Task 6~8). 이 태스크의 게이트는 typecheck와 기존 388 유지다.

- [x] **Step 1: ipc-contract — GitApi.branches 확장.** `packages/ipc-contract/src/index.ts` 기존:

```ts
  branches: {
    list(repoPath: string): Promise<BranchSummary[]>
    /** fromHash는 40자 hex 전체 해시 또는 null(지금 위치에서) */
    create(repoPath: string, name: string, fromHash: string | null): Promise<void>
    switch(repoPath: string, name: string): Promise<SwitchResult>
    /** name 공간을 지금 공간으로 합친다(스마트 병합) — conflict면 충돌 상태가 남는다 */
    merge(repoPath: string, name: string): Promise<MergeResult>
    remove(repoPath: string, name: string, force: boolean): Promise<RemoveBranchResult>
    rename(repoPath: string, oldName: string, newName: string): Promise<void>
  }
```

교체:

```ts
  branches: {
    list(repoPath: string): Promise<BranchSummary[]>
    /** 패널용 일괄 개요 — 로컬(upstream·ahead/behind·gone)+원격 (E7a) */
    overview(repoPath: string): Promise<BranchOverview>
    /** fromHash는 40자 hex 전체 해시 또는 null(지금 위치에서) */
    create(repoPath: string, name: string, fromHash: string | null): Promise<void>
    switch(repoPath: string, name: string): Promise<SwitchResult>
    /** name 공간을 지금 공간으로 합친다(스마트 병합) — conflict면 충돌 상태가 남는다 */
    merge(repoPath: string, name: string): Promise<MergeResult>
    remove(repoPath: string, name: string, force: boolean): Promise<RemoveBranchResult>
    rename(repoPath: string, oldName: string, newName: string): Promise<void>
    /** 비현재 공간을 원격 최신으로(ff-only) — 현재 공간은 renderer가 pull로 보낸다 (E7a) */
    update(repoPath: string, name: string): Promise<void>
    /** 선택 공간을 checkout 없이 백업(push) (E7a) */
    backup(repoPath: string, name: string): Promise<void>
    /** 원격 공간을 추적 로컬로 가져와 이동 (E7a) */
    checkoutRemote(repoPath: string, name: string): Promise<SwitchResult>
    /** 원격에서 지우기(push --delete) — 확인창은 UI 책임 (E7a) */
    removeRemote(repoPath: string, name: string): Promise<void>
    /** 지금 공간과의 양방향 전용 저장 목록 (E7a) */
    compare(repoPath: string, name: string): Promise<BranchCompare>
  }
  rebase: {
    /** 현재 공간을 onto 위로 재배치 — conflict면 rebasing 상태가 남는다 (E7a) */
    start(repoPath: string, onto: string): Promise<RebaseResult>
    /** 겹침 해소(add) 후 다음 저장으로 — 빈 저장은 git이 자동으로 건너뛴다(실측) */
    continue(repoPath: string): Promise<RebaseContinueResult>
    abort(repoPath: string): Promise<void>
    /** 진행 위치 — rebasing이 아니면 null */
    progress(repoPath: string): Promise<RebaseProgress | null>
  }
```

- [x] **Step 2: ipc-contract — 채널 추가.** 같은 파일 기존:

```ts
  branchesRename: 'branches:rename',
  mergeAbort: 'merge:abort',
```

교체:

```ts
  branchesRename: 'branches:rename',
  branchesOverview: 'branches:overview',
  branchesUpdate: 'branches:update',
  branchesBackup: 'branches:backup',
  branchesCheckoutRemote: 'branches:checkout-remote',
  branchesRemoveRemote: 'branches:remove-remote',
  branchesCompare: 'branches:compare',
  rebaseStart: 'rebase:start',
  rebaseContinue: 'rebase:continue',
  rebaseAbort: 'rebase:abort',
  rebaseProgress: 'rebase:progress',
  mergeAbort: 'merge:abort',
```

- [x] **Step 3: ipc-contract — 타입 import.** 같은 파일 상단의 `import type { … } from '@git-gui/domain'` 목록에 `BranchCompare`·`BranchOverview`·`RebaseContinueResult`·`RebaseProgress`·`RebaseResult`를 **알파벳 순서 자리**에 추가한다(기존 이름은 그대로). 추가 후 `grep -c "BranchOverview" packages/ipc-contract/src/index.ts` ≥ 2 확인.

- [x] **Step 4: git-handlers.** `apps/desktop/src/main/git-handlers.ts` 기존:

```ts
  ipcMain.handle(
    CHANNELS.branchesRename,
    (_event, repoPath: unknown, oldName: unknown, newName: unknown) =>
      createGitClient(assertAllowedRepo(repoPath)).branches.rename(
        assertString(oldName),
        assertString(newName),
      ),
  )
```

교체:

```ts
  ipcMain.handle(
    CHANNELS.branchesRename,
    (_event, repoPath: unknown, oldName: unknown, newName: unknown) =>
      createGitClient(assertAllowedRepo(repoPath)).branches.rename(
        assertString(oldName),
        assertString(newName),
      ),
  )

  ipcMain.handle(CHANNELS.branchesOverview, (_event, repoPath: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).branches.overview(),
  )

  ipcMain.handle(CHANNELS.branchesUpdate, (_event, repoPath: unknown, name: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).branches.update(assertString(name)),
  )

  ipcMain.handle(CHANNELS.branchesBackup, (_event, repoPath: unknown, name: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).branches.backup(assertString(name)),
  )

  ipcMain.handle(CHANNELS.branchesCheckoutRemote, (_event, repoPath: unknown, name: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).branches.checkoutRemote(assertString(name)),
  )

  ipcMain.handle(CHANNELS.branchesRemoveRemote, (_event, repoPath: unknown, name: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).branches.removeRemote(assertString(name)),
  )

  ipcMain.handle(CHANNELS.branchesCompare, (_event, repoPath: unknown, name: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).branches.compare(assertString(name)),
  )

  ipcMain.handle(CHANNELS.rebaseStart, (_event, repoPath: unknown, onto: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).rebase.start(assertString(onto)),
  )

  ipcMain.handle(CHANNELS.rebaseContinue, (_event, repoPath: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).rebase.continue(),
  )

  ipcMain.handle(CHANNELS.rebaseAbort, (_event, repoPath: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).rebase.abort(),
  )

  ipcMain.handle(CHANNELS.rebaseProgress, (_event, repoPath: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).rebase.progress(),
  )
```

- [x] **Step 5: preload.** `apps/desktop/src/preload/index.ts` 기존:

```ts
  branches: {
    list: (repoPath) => ipcRenderer.invoke(CHANNELS.branchesList, repoPath),
    create: (repoPath, name, fromHash) =>
      ipcRenderer.invoke(CHANNELS.branchesCreate, repoPath, name, fromHash),
    switch: (repoPath, name) => ipcRenderer.invoke(CHANNELS.branchesSwitch, repoPath, name),
    merge: (repoPath, name) => ipcRenderer.invoke(CHANNELS.branchesMerge, repoPath, name),
    remove: (repoPath, name, force) =>
      ipcRenderer.invoke(CHANNELS.branchesRemove, repoPath, name, force),
    rename: (repoPath, oldName, newName) =>
      ipcRenderer.invoke(CHANNELS.branchesRename, repoPath, oldName, newName),
  },
```

교체:

```ts
  branches: {
    list: (repoPath) => ipcRenderer.invoke(CHANNELS.branchesList, repoPath),
    overview: (repoPath) => ipcRenderer.invoke(CHANNELS.branchesOverview, repoPath),
    create: (repoPath, name, fromHash) =>
      ipcRenderer.invoke(CHANNELS.branchesCreate, repoPath, name, fromHash),
    switch: (repoPath, name) => ipcRenderer.invoke(CHANNELS.branchesSwitch, repoPath, name),
    merge: (repoPath, name) => ipcRenderer.invoke(CHANNELS.branchesMerge, repoPath, name),
    remove: (repoPath, name, force) =>
      ipcRenderer.invoke(CHANNELS.branchesRemove, repoPath, name, force),
    rename: (repoPath, oldName, newName) =>
      ipcRenderer.invoke(CHANNELS.branchesRename, repoPath, oldName, newName),
    update: (repoPath, name) => ipcRenderer.invoke(CHANNELS.branchesUpdate, repoPath, name),
    backup: (repoPath, name) => ipcRenderer.invoke(CHANNELS.branchesBackup, repoPath, name),
    checkoutRemote: (repoPath, name) =>
      ipcRenderer.invoke(CHANNELS.branchesCheckoutRemote, repoPath, name),
    removeRemote: (repoPath, name) =>
      ipcRenderer.invoke(CHANNELS.branchesRemoveRemote, repoPath, name),
    compare: (repoPath, name) => ipcRenderer.invoke(CHANNELS.branchesCompare, repoPath, name),
  },
  rebase: {
    start: (repoPath, onto) => ipcRenderer.invoke(CHANNELS.rebaseStart, repoPath, onto),
    continue: (repoPath) => ipcRenderer.invoke(CHANNELS.rebaseContinue, repoPath),
    abort: (repoPath) => ipcRenderer.invoke(CHANNELS.rebaseAbort, repoPath),
    progress: (repoPath) => ipcRenderer.invoke(CHANNELS.rebaseProgress, repoPath),
  },
```

- [x] **Step 6: store — 상태·인터페이스.** `apps/desktop/src/renderer/src/store/repository-store.ts` 편집 6곳.

(a) 상태 필드 기존:

```ts
  repoPath: string | null
  status: RepositoryStatus | null
  branches: BranchSummary[]
```

교체:

```ts
  repoPath: string | null
  status: RepositoryStatus | null
  branches: BranchSummary[]
  /** 실험 공간 탭 데이터 — 스냅샷마다 함께 갱신된다 (E7a) */
  branchOverview: BranchOverview | null
  /** "지금과 비교" 결과 — 열려 있으면 실험 공간 탭이 비교 뷰가 된다 */
  branchCompare: { name: string; result: BranchCompare } | null
  /** 재배치 진행 위치 — rebasing 상태에서만 non-null (상태 바 "M/N번째") */
  rebaseProgress: RebaseProgress | null
```

(b) 액션 선언 기존:

```ts
  /** 이름 바꾸기 — 성공 여부 반환(실패 시 다이얼로그 유지·입력 보존) */
  renameBranch(oldName: string, newName: string): Promise<boolean>
```

교체:

```ts
  /** 이름 바꾸기 — 성공 여부 반환(실패 시 다이얼로그 유지·입력 보존) */
  renameBranch(oldName: string, newName: string): Promise<boolean>
  /** 비현재 공간을 원격 최신으로(ff-only) — 현재 공간은 UI가 pullLatest로 보낸다 (E7a) */
  updateBranch(name: string): Promise<void>
  /** 선택 공간을 checkout 없이 백업 — 현재 공간은 UI가 backup으로 보낸다 (E7a) */
  backupBranch(name: string): Promise<void>
  /** "지금과 비교" 열기 — 결과는 branchCompare로, 실험 공간 탭이 비교 뷰가 된다 (E7a) */
  compareBranch(name: string): Promise<void>
  /** 비교 뷰 닫기 — 동기라 guard 불필요 */
  clearBranchCompare(): void
  /** 원격 공간을 추적 로컬로 가져와 이동 (E7a) */
  checkoutRemoteBranch(name: string): Promise<void>
  /** 원격에서 지우기 — 확인창(UI 책임) 경유. 다른 사람에게도 영향 (E7a) */
  removeRemoteBranch(name: string): Promise<void>
  /** 현재 공간을 name 위로 재배치 — 확인창(UI 책임) 경유. conflict면 rebasing 바가 안내 (E7a) */
  rebaseOnto(name: string): Promise<void>
  /** 겹침을 모두 해소한 뒤 다음 저장으로 — rebasing 바의 계속하기 (E7a) */
  continueRebase(): Promise<void>
  /** 재배치 취소 — 확인창(UI 책임) 경유 (E7a) */
  abortRebase(): Promise<void>
```

(c) fetchSnapshot 기존:

```ts
/** 상태·역사·실험 공간·보관함을 동시 조회해 같은 렌더에 함께 갱신한다 — 시점 차이를 최소화 (원자 스냅샷은 아님) */
async function fetchSnapshot(
  repoPath: string,
  limit: number,
): Promise<Pick<RepositoryStore, 'status' | 'history' | 'branches' | 'shelf'>> {
  const [status, history, branches, shelf] = await Promise.all([
    git().repo.status(repoPath),
    git().history.list(repoPath, limit),
    git().branches.list(repoPath),
    git().shelf.list(repoPath),
  ])
  return { status, history, branches, shelf }
}
```

교체:

```ts
/** 상태·역사·실험 공간·보관함을 동시 조회해 같은 렌더에 함께 갱신한다 — 시점 차이를 최소화 (원자 스냅샷은 아님) */
async function fetchSnapshot(
  repoPath: string,
  limit: number,
): Promise<
  Pick<RepositoryStore, 'status' | 'history' | 'branches' | 'shelf' | 'branchOverview' | 'rebaseProgress'>
> {
  const [status, history, branches, shelf, branchOverview] = await Promise.all([
    git().repo.status(repoPath),
    git().history.list(repoPath, limit),
    git().branches.list(repoPath),
    git().shelf.list(repoPath),
    git().branches.overview(repoPath),
  ])
  // 재배치 중일 때만 진행 위치를 읽는다 — 상태 바 "M/N번째" (E7a)
  const rebaseProgress =
    status.state === 'rebasing' ? await git().rebase.progress(repoPath) : null
  return { status, history, branches, shelf, branchOverview, rebaseProgress }
}
```

(d) CLEAR_SELECTIONS 기존:

```ts
const CLEAR_SELECTIONS = {
  selected: null,
  diff: null,
  diffLabel: null,
  commitDetail: null,
  commitFile: null,
  conflictFile: null,
  pullDetail: null,
} as const
```

교체:

```ts
const CLEAR_SELECTIONS = {
  selected: null,
  diff: null,
  diffLabel: null,
  commitDetail: null,
  commitFile: null,
  conflictFile: null,
  pullDetail: null,
  branchCompare: null,
} as const
```

(e) 초기 상태 기존:

```ts
  hostingStatus: null,
```

교체:

```ts
  hostingStatus: null,
  branchOverview: null,
  branchCompare: null,
  rebaseProgress: null,
```

(f) 액션 구현 — 기존(renameBranch 구현 전문):

```ts
  async renameBranch(oldName, newName) {
    const { repoPath } = get()
    if (!repoPath) return false
    return guard(set, get, async () => {
      await git().branches.rename(repoPath, oldName, newName)
      set({ ...(await fetchSnapshot(repoPath, get().historyLimit)) })
    })
  },
```

교체:

```ts
  async renameBranch(oldName, newName) {
    const { repoPath } = get()
    if (!repoPath) return false
    return guard(set, get, async () => {
      await git().branches.rename(repoPath, oldName, newName)
      set({ ...(await fetchSnapshot(repoPath, get().historyLimit)) })
    })
  },

  async updateBranch(name) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      await git().branches.update(repoPath, name)
      // 비교 뷰가 바로 이 공간을 보고 있었다면 낡은 목록이 남는다 — 대상일 때만 닫는다 (품질 리뷰)
      const stale = get().branchCompare?.name === name ? { branchCompare: null } : {}
      set({
        ...stale,
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
        notice: `"${name}"을 원격 최신으로 업데이트했어요.`,
      })
    })
  },

  async backupBranch(name) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      await git().branches.backup(repoPath, name)
      // push는 ref를 움직이지 않는다 — 비교 뷰 무효화 불필요 (update와의 비대칭은 의도 — 품질 리뷰)
      set({
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
        notice: `"${name}"을 백업(push)했어요.`,
      })
    })
  },

  async compareBranch(name) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      const result = await git().branches.compare(repoPath, name)
      set({ branchCompare: { name, result } })
    })
  },

  clearBranchCompare() {
    set({ branchCompare: null })
  },

  async checkoutRemoteBranch(name) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      const result = await git().branches.checkoutRemote(repoPath, name)
      // 다른 공간이다 — 보던 것들을 비우고 역사도 첫 페이지부터 (switchBranch 관례)
      set({
        historyLimit: HISTORY_LIMIT,
        ...CLEAR_SELECTIONS,
        ...(await fetchSnapshot(repoPath, HISTORY_LIMIT)),
        notice: result.autoShelved
          ? `원격 "${name}"을 내 공간으로 가져와 이동했어요. 저장 안 된 변경은 보관함에 넣어뒀어요.`
          : `원격 "${name}"을 내 공간으로 가져와 이동했어요.`,
      })
    })
  },

  async removeRemoteBranch(name) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      await git().branches.removeRemote(repoPath, name)
      // 비교 뷰가 바로 이 공간을 보고 있었다면 낡은 목록이 남는다 — 대상일 때만 닫는다 (품질 리뷰)
      const stale = get().branchCompare?.name === name ? { branchCompare: null } : {}
      set({
        ...stale,
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
        notice: `원격에서 "${name}"을 지웠어요.`,
      })
    })
  },

  async rebaseOnto(name) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      // 자동 보관까지 간 뒤 2차 시도가 실패해도 보관함 카운트가 낡지 않게 — 스냅샷은 finally로 보장 (merge 관례)
      let notice: string | null = null
      try {
        const result = await git().rebase.start(repoPath, name)
        const notices: Record<typeof result.outcome, string | null> = {
          completed: `"${name}" 위로 재배치했어요.`,
          'up-to-date': '이미 그 위에 있어요 — 재배치할 것이 없어요.',
          // 충돌 안내는 rebasing 상태 바가 상주하며 담당한다
          conflict: null,
        }
        const shelfNotice = result.autoShelved ? '저장 안 된 변경은 보관함에 넣어뒀어요.' : ''
        notice = [notices[result.outcome], shelfNotice].filter((part) => part).join(' ') || null
      } finally {
        set({
          ...CLEAR_SELECTIONS,
          ...(await fetchSnapshot(repoPath, get().historyLimit)),
          notice,
        })
      }
    })
  },

  async continueRebase() {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      let notice: string | null = null
      try {
        const result = await git().rebase.continue(repoPath)
        // 다음 충돌 안내는 rebasing 상태 바(진행 M/N)가 담당한다 — 완료만 notice로
        notice = result.outcome === 'completed' ? '재배치를 마쳤어요.' : null
      } finally {
        set({
          ...CLEAR_SELECTIONS,
          ...(await fetchSnapshot(repoPath, get().historyLimit)),
          notice,
        })
      }
    })
  },

  async abortRebase() {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      await git().rebase.abort(repoPath)
      set({
        ...CLEAR_SELECTIONS,
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
        notice: '재배치를 취소하고 이전 상태로 돌아왔어요.',
      })
    })
  },
```

(g) store 상단의 `import type { … } from '@git-gui/domain'` 목록에 `BranchCompare`·`BranchOverview`·`RebaseProgress`를 알파벳 순서 자리에 추가한다. 추가 후 `pnpm typecheck`가 판정한다.

- [x] **Step 7: 게이트** — `pnpm typecheck` 전 프로젝트 Done(배선 누락이 있으면 여기서 걸린다). 루트 `pnpm test` → **388 passed**(무변).

- [x] **Step 8: Commit**

```bash
git add packages/ipc-contract/src/index.ts apps/desktop/src/main/git-handlers.ts apps/desktop/src/preload/index.ts apps/desktop/src/renderer/src/store/repository-store.ts
git commit -m "feat(desktop): E7a IPC·store 배선 — branchOverview 스냅샷 동반·브랜치 조작 9액션·rebase 진행 상태

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: UI — 좌측 탭 + BranchesPanel(목록·검색·우클릭·비교 뷰)

**Files:**
- Create: `apps/desktop/src/renderer/src/components/branch-badges.ts`
- Test: `apps/desktop/test/branch-badges.test.ts` (신규, +4)
- Modify: `apps/desktop/src/renderer/src/components/branch-groups.ts` (제네릭화 — 하위 호환)
- Create: `apps/desktop/src/renderer/src/components/BranchesPanel.tsx`
- Create: `apps/desktop/src/renderer/src/components/branches-panel.css`
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Modify: `apps/desktop/src/renderer/src/layout.css`
- Modify: `apps/desktop/e2e/smoke.spec.ts` (+3)

- [x] **Step 1: 배지 Red.** `apps/desktop/test/branch-badges.test.ts` 신규:

```ts
import { describe, expect, it } from 'vitest'
import type { LocalBranchStatus } from '@git-gui/domain'
import { trackBadgeLabel } from '../src/renderer/src/components/branch-badges'

const b = (over: Partial<LocalBranchStatus>): LocalBranchStatus => ({
  name: 'x',
  isCurrent: false,
  upstream: 'origin/x',
  upstreamGone: false,
  ahead: 0,
  behind: 0,
  committedAt: 0,
  hash: 'a'.repeat(40),
  ...over,
})

describe('trackBadgeLabel', () => {
  it('upstream이 없으면 "연결 없음"이다', () => {
    expect(trackBadgeLabel(b({ upstream: null, ahead: null, behind: null }))).toBe('연결 없음')
  })

  it('[gone]이면 "연결 끊김"이다', () => {
    expect(trackBadgeLabel(b({ upstreamGone: true, ahead: null, behind: null }))).toBe('연결 끊김')
  })

  it('앞서고 뒤처진 수를 ↑·↓로 보여주고, 0인 쪽은 생략한다', () => {
    expect(trackBadgeLabel(b({ ahead: 1, behind: 3 }))).toBe('↑1 ↓3')
    expect(trackBadgeLabel(b({ ahead: 2, behind: 0 }))).toBe('↑2')
    expect(trackBadgeLabel(b({ ahead: 0, behind: 5 }))).toBe('↓5')
  })

  it('차이가 없으면 "동기화됨"이다', () => {
    expect(trackBadgeLabel(b({}))).toBe('동기화됨')
  })
})
```

- [x] **Step 2: Red 확인** — `pnpm vitest run --project @git-gui/desktop -t 'trackBadgeLabel'` → 모듈 부재로 실패 확인.

- [x] **Step 3: 배지 구현.** `apps/desktop/src/renderer/src/components/branch-badges.ts` 신규:

```ts
import type { LocalBranchStatus } from '@git-gui/domain'

/**
 * 실험 공간 행 우측 상태 배지 문구 (E7a) — 색이 아니라 글자로 전달한다(색약 대응 관례).
 * ahead/behind는 fetch 기준값이다 — "원격 최신으로 업데이트"가 fetch를 겸한다
 */
export function trackBadgeLabel(branch: LocalBranchStatus): string {
  if (branch.upstream === null) return '연결 없음'
  if (branch.upstreamGone) return '연결 끊김'
  const parts: string[] = []
  if (branch.ahead !== null && branch.ahead > 0) parts.push(`↑${branch.ahead}`)
  if (branch.behind !== null && branch.behind > 0) parts.push(`↓${branch.behind}`)
  return parts.length > 0 ? parts.join(' ') : '동기화됨'
}
```

- [x] **Step 4: 배지 Green** — 같은 명령 → **4 passed**.

- [x] **Step 5: branch-groups 제네릭화.** `apps/desktop/src/renderer/src/components/branch-groups.ts` — 파일 전체를 다음으로 교체(기존 소비자 BranchSwitcher는 타입 추론으로 무변 — 기존 branch-groups 테스트 통과가 하위 호환 게이트다):

```ts
import type { BranchSummary } from '@git-gui/domain'

export interface BranchFolder<T extends { name: string } = BranchSummary> {
  /** '/' 앞 첫 조각 — 폴더 이름 */
  name: string
  branches: T[]
}

export interface GroupedBranches<T extends { name: string } = BranchSummary> {
  /** '/' 없는 브랜치 — 목록 맨 위에 그대로 나열 */
  loose: T[]
  /** '/'가 있는 브랜치를 첫 조각으로 묶는다 — IntelliJ식 폴더 (피드백 5) */
  folders: BranchFolder<T>[]
}

/**
 * 입력 순서(최근 커밋순)를 유지한다 — 폴더 위치는 그 폴더 브랜치가 처음 등장한 곳.
 * E7a: 패널(LocalBranchStatus)과 스위처(BranchSummary)가 공유하도록 name만 요구하는 제네릭으로 넓혔다
 */
export function groupBranches<T extends { name: string }>(branches: T[]): GroupedBranches<T> {
  const loose: T[] = []
  const folders: BranchFolder<T>[] = []
  const byName = new Map<string, BranchFolder<T>>()
  for (const branch of branches) {
    const slash = branch.name.indexOf('/')
    if (slash <= 0) {
      loose.push(branch)
      continue
    }
    const name = branch.name.slice(0, slash)
    let folder = byName.get(name)
    if (folder === undefined) {
      folder = { name, branches: [] }
      byName.set(name, folder)
      folders.push(folder)
    }
    folder.branches.push(branch)
  }
  return { loose, folders }
}

/** 폴더 안에서는 접두사를 뗀 나머지만 보여준다 — 전체 이름은 title·동작 키로 유지 */
export function branchDisplayName(name: string): string {
  const slash = name.indexOf('/')
  return slash <= 0 ? name : name.slice(slash + 1)
}
```

- [x] **Step 6: BranchesPanel 생성.** `apps/desktop/src/renderer/src/components/BranchesPanel.tsx` 신규:

```tsx
import { useState, type MouseEvent } from 'react'
import type { BranchCompare, BranchOverview, CommitSummary, LocalBranchStatus } from '@git-gui/domain'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { ContextMenu, type ContextMenuEntry } from '../ui/ContextMenu'
import { Panel } from '../ui/Panel'
import { trackBadgeLabel } from './branch-badges'
import { branchDisplayName, groupBranches } from './branch-groups'
import './branches-panel.css'

export type BranchPanelAction =
  | { kind: 'switch'; name: string }
  | { kind: 'branch-from'; name: string; hash: string }
  | { kind: 'merge'; name: string }
  | { kind: 'rebase'; name: string }
  | { kind: 'compare'; name: string }
  | { kind: 'update'; name: string }
  | { kind: 'backup'; name: string }
  | { kind: 'rename'; name: string }
  | { kind: 'remove'; name: string }
  | { kind: 'checkout-remote'; name: string }
  | { kind: 'remove-remote'; name: string }

interface BranchesPanelProps {
  overview: BranchOverview | null
  /** "지금과 비교" 결과 — non-null이면 목록 대신 비교 뷰를 보여준다 */
  compare: { name: string; result: BranchCompare } | null
  currentBranch: string | null
  busy: boolean
  /** 진행 중 작업(merging 등) — 파괴적 항목을 사유와 함께 비활성한다 */
  actionsDisabled: boolean
  onAction(action: BranchPanelAction): void
  onCloseCompare(): void
}

interface MenuState {
  x: number
  y: number
  target: { kind: 'local'; branch: LocalBranchStatus } | { kind: 'remote'; name: string }
}

/** IntelliJ식 실험 공간 패널 (E7a) — 검색·폴더 그룹·상태 배지·우클릭 관리. 빠른 전환은 헤더 스위처가 담당 */
export function BranchesPanel({
  overview,
  compare,
  currentBranch,
  busy,
  actionsDisabled,
  onAction,
  onCloseCompare,
}: BranchesPanelProps) {
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<MenuState | null>(null)

  // 불가 항목은 숨기지 않고 사유와 함께 비활성한다 (HistoryPanel undo/reword 관례)
  const buildLocalMenu = (branch: LocalBranchStatus): ContextMenuEntry[] => {
    const isCurrent = branch.name === currentBranch
    const noUpstream = branch.upstream === null
    return [
      {
        key: 'switch',
        label: isCurrent
          ? '이 공간으로 이동 (checkout) — 지금 여기예요'
          : '이 공간으로 이동 (checkout)',
        disabled: busy || actionsDisabled || isCurrent,
        onSelect: () => onAction({ kind: 'switch', name: branch.name }),
      },
      {
        key: 'branch-from',
        label: '여기서 새 실험 공간…',
        disabled: busy,
        onSelect: () => onAction({ kind: 'branch-from', name: branch.name, hash: branch.hash }),
      },
      { key: 'sep-1', separator: true },
      {
        key: 'merge',
        label: isCurrent ? '지금 것과 합치기 (merge) — 자기 자신이에요' : '지금 것과 합치기 (merge)',
        disabled: busy || actionsDisabled || isCurrent,
        onSelect: () => onAction({ kind: 'merge', name: branch.name }),
      },
      {
        key: 'rebase',
        label: isCurrent
          ? '지금 것을 이 위로 재배치 (rebase) — 자기 자신이에요'
          : '지금 것을 이 위로 재배치 (rebase)',
        disabled: busy || actionsDisabled || isCurrent,
        onSelect: () => onAction({ kind: 'rebase', name: branch.name }),
      },
      {
        key: 'compare',
        label: isCurrent ? '지금과 비교 — 자기 자신이에요' : '지금과 비교…',
        disabled: busy || isCurrent,
        onSelect: () => onAction({ kind: 'compare', name: branch.name }),
      },
      { key: 'sep-2', separator: true },
      {
        key: 'update',
        label: isCurrent
          ? '원격 최신으로 업데이트 (pull)'
          : noUpstream
            ? '원격 최신으로 업데이트 — 원격과 연결된 적이 없어요'
            : branch.upstreamGone
              ? '원격 최신으로 업데이트 — 원격에서 지워졌어요'
              : '원격 최신으로 업데이트',
        disabled: busy || actionsDisabled || noUpstream || branch.upstreamGone,
        onSelect: () => onAction({ kind: 'update', name: branch.name }),
      },
      {
        key: 'backup',
        label: '백업 (push)',
        disabled: busy || actionsDisabled,
        onSelect: () => onAction({ kind: 'backup', name: branch.name }),
      },
      { key: 'sep-3', separator: true },
      {
        key: 'rename',
        label: '이름 바꾸기…',
        disabled: busy || actionsDisabled,
        onSelect: () => onAction({ kind: 'rename', name: branch.name }),
      },
      {
        key: 'remove',
        label: isCurrent ? '지우기 — 지금 있는 공간이에요' : '지우기…',
        disabled: busy || actionsDisabled || isCurrent,
        onSelect: () => onAction({ kind: 'remove', name: branch.name }),
      },
    ]
  }

  const buildRemoteMenu = (name: string): ContextMenuEntry[] => [
    {
      key: 'checkout-remote',
      label: '내 공간으로 가져오기 (checkout)',
      disabled: busy || actionsDisabled,
      onSelect: () => onAction({ kind: 'checkout-remote', name }),
    },
    {
      key: 'compare-remote',
      label: '지금과 비교…',
      disabled: busy,
      onSelect: () => onAction({ kind: 'compare', name }),
    },
    { key: 'sep-1', separator: true },
    {
      key: 'remove-remote',
      label: '원격에서 지우기…',
      disabled: busy || actionsDisabled,
      onSelect: () => onAction({ kind: 'remove-remote', name }),
    },
  ]

  const openMenu = (event: MouseEvent, target: MenuState['target']) => {
    event.preventDefault()
    // 키보드(Enter/Space) 활성화는 좌표가 (0,0)으로 온다 — 커서 대신 행 자체에 앵커한다 (품질 리뷰)
    if (event.clientX === 0 && event.clientY === 0) {
      const rect = event.currentTarget.getBoundingClientRect()
      setMenu({ x: rect.left + 8, y: rect.bottom, target })
      return
    }
    setMenu({ x: event.clientX, y: event.clientY, target })
  }

  if (compare !== null) {
    const { result } = compare
    const section = (title: string, commits: CommitSummary[], overflow: boolean, empty: string) => (
      <>
        <p className="branch-compare__section">
          {title} <span className="branch-row__badge">{commits.length}</span>
        </p>
        {commits.length === 0 ? (
          <p className="branches-panel__empty">{empty}</p>
        ) : (
          commits.map((commit) => (
            <div
              key={commit.hash}
              className="branch-compare__row"
              data-testid={`compare-row-${commit.hash}`}
            >
              <span className="branch-compare__hash">{commit.shortHash}</span>
              <span className="branch-row__name">{commit.subject}</span>
            </div>
          ))
        )}
        {overflow && <p className="branch-compare__overflow">100개까지만 보여요 — 더 있어요.</p>}
      </>
    )
    return (
      <Panel
        title={`지금 ↔ "${compare.name}"`}
        accessory={<Badge tone="git">compare</Badge>}
        testId="branches-panel"
      >
        <div className="branches-panel">
          <div>
            <Button variant="ghost" size="sm" onPress={onCloseCompare} testId="branch-compare-back">
              ← 목록으로
            </Button>
          </div>
          <div className="branches-panel__scroll" data-testid="branch-compare-view">
            {section(
              `"${compare.name}"에만 있는 저장`,
              result.onlyInSelected,
              result.selectedOverflow,
              '없어요 — 전부 지금 공간에도 있어요.',
            )}
            {section(
              '지금 공간에만 있는 저장',
              result.onlyInCurrent,
              result.currentOverflow,
              '없어요 — 전부 그 공간에도 있어요.',
            )}
          </div>
        </div>
      </Panel>
    )
  }

  const locals = (overview?.locals ?? []).filter((branch) => branch.name.includes(query))
  const remotes = (overview?.remotes ?? []).filter((remote) => remote.name.includes(query))
  const grouped = groupBranches(locals)
  const remoteGroups = new Map<string, typeof remotes>()
  for (const remote of remotes) {
    const list = remoteGroups.get(remote.remote) ?? []
    list.push(remote)
    remoteGroups.set(remote.remote, list)
  }

  const localRow = (branch: LocalBranchStatus, displayName: string) => (
    <button
      key={branch.name}
      type="button"
      className="branch-row"
      title={branch.name}
      onClick={(event) => openMenu(event, { kind: 'local', branch })}
      onContextMenu={(event) => openMenu(event, { kind: 'local', branch })}
      data-testid={`branch-row-${branch.name}`}
    >
      <span className="branch-row__name">⎇ {displayName}</span>
      {branch.name === currentBranch && <Badge tone="git">지금 여기</Badge>}
      <span className="branch-row__badge">{trackBadgeLabel(branch)}</span>
    </button>
  )

  return (
    <Panel title="실험 공간" accessory={<Badge tone="git">branch</Badge>} testId="branches-panel">
      <div className="branches-panel">
        <input
          className="branches-panel__search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="이름으로 찾기"
          aria-label="실험 공간 검색"
          data-testid="branches-search"
        />
        <div className="branches-panel__scroll" data-testid="branches-list">
          {locals.length === 0 && remotes.length === 0 ? (
            <p className="branches-panel__empty">보여줄 실험 공간이 없어요.</p>
          ) : (
            <>
              {locals.length > 0 && <p className="branches-panel__group">내 공간 (로컬)</p>}
              {grouped.loose.map((branch) => localRow(branch, branch.name))}
              {grouped.folders.map((folder) => (
                <div key={folder.name}>
                  <p className="branches-panel__folder">📁 {folder.name}/</p>
                  {folder.branches.map((branch) =>
                    localRow(branch, branchDisplayName(branch.name)),
                  )}
                </div>
              ))}
              {[...remoteGroups.entries()].map(([remoteName, refs]) => (
                <div key={remoteName}>
                  <p className="branches-panel__group">{remoteName} (원격)</p>
                  {refs.map((ref) => (
                    <button
                      key={ref.name}
                      type="button"
                      className="branch-row branch-row--remote"
                      title={ref.name}
                      onClick={(event) => openMenu(event, { kind: 'remote', name: ref.name })}
                      onContextMenu={(event) => openMenu(event, { kind: 'remote', name: ref.name })}
                      data-testid={`branch-row-${ref.name}`}
                    >
                      <span className="branch-row__name">☁ {ref.name}</span>
                    </button>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
      {menu !== null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={
            menu.target.kind === 'local'
              ? buildLocalMenu(menu.target.branch)
              : buildRemoteMenu(menu.target.name)
          }
          onClose={() => setMenu(null)}
        />
      )}
    </Panel>
  )
}
```

- [x] **Step 7: CSS.** `apps/desktop/src/renderer/src/components/branches-panel.css` 신규:

```css
.branches-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}
.branches-panel__search {
  width: 100%;
  box-sizing: border-box;
  margin-bottom: var(--space-4);
  padding: 6px 10px;
  font-size: var(--text-sm);
  color: inherit;
  background: transparent;
  border: 1px solid var(--color-border-strong);
  border-radius: 6px;
}
.branches-panel__scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.branches-panel__group {
  margin: var(--space-4) 0 4px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-faint);
}
.branches-panel__folder {
  margin: 2px 0;
  padding: 2px 4px;
  font-size: var(--text-sm);
  color: var(--color-text-faint);
}
.branches-panel__empty {
  padding: var(--space-4);
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-faint);
  text-align: center;
}
.branch-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 4px 6px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font-size: var(--text-sm);
  text-align: left;
  cursor: pointer;
}
.branch-row:hover {
  background: var(--color-surface);
}
.branch-row__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.branch-row__badge {
  flex: none;
  font-size: 10px;
  color: var(--color-text-faint);
}
.branch-row--remote {
  color: var(--color-text-faint);
}
.branch-compare__section {
  margin: var(--space-4) 0 4px;
  font-weight: 600;
  font-size: var(--text-sm);
}
.branch-compare__row {
  display: flex;
  gap: 8px;
  padding: 3px 4px;
  font-size: var(--text-sm);
}
.branch-compare__hash {
  color: var(--color-text-faint);
  font-family: monospace;
}
.branch-compare__overflow {
  padding: 2px 4px;
  font-size: var(--text-sm);
  color: var(--color-text-faint);
}
```

- [x] **Step 8: 좌측 탭바 CSS.** `apps/desktop/src/renderer/src/layout.css` 기존:

```css
.app__left > .changes-panel {
  flex: 1;
  min-height: 0;
}
```

교체:

```css
.app__left > .changes-panel {
  flex: 1;
  min-height: 0;
}
/* 좌측 탭바 (E7a) — [변경 | 실험 공간]. 기본은 변경(커밋 흐름 무변), 워크트리 탭은 E7c 예약석.
   position+z-index — app__top-layer(머지/재배치 바, z-index 40)가 절대 위치로 app__main 상단을 덮는데,
   좌측 열의 첫 자식인 이 탭바가 바로 그 자리다. 겹치면 탭 클릭이 막힌다(E7a rebase 충돌 흐름 실측) —
   탭바를 그 위로 올려 상태 바가 떠 있어도 항상 눌린다 */
.app__left-tabs {
  display: flex;
  gap: 6px;
  flex: none;
  position: relative;
  z-index: 41;
}
.app__left-tab {
  appearance: none;
  background: transparent;
  color: var(--color-text-faint);
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 4px 12px;
  font-size: var(--text-sm);
  cursor: pointer;
}
.app__left-tab[aria-selected='true'] {
  color: inherit;
  background: var(--color-surface);
  border-color: var(--color-border-strong);
  font-weight: 600;
}
.app__left > .branches-panel,
.app__left > .ui-panel {
  flex: 1;
  min-height: 0;
}
```

- [x] **Step 9: App 배선 (1) — import·상태.** `apps/desktop/src/renderer/src/App.tsx` 기존:

```ts
import { BranchSwitcher } from './components/BranchSwitcher'
```

교체:

```ts
import { BranchesPanel } from './components/BranchesPanel'
import { BranchSwitcher } from './components/BranchSwitcher'
```

그리고 기존:

```ts
  // 합치기 대상 선택·취소 확인
  const [mergePicker, setMergePicker] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [confirmingAbort, setConfirmingAbort] = useState(false)
```

교체:

```ts
  // 합치기 대상 선택·취소 확인
  const [mergePicker, setMergePicker] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [confirmingAbort, setConfirmingAbort] = useState(false)

  // E7a 좌측 탭 — [변경 | 실험 공간]. 기본은 변경(커밋 흐름 무변). 탭 상태는 렌더 로컬(store 오염 없음)
  const [leftTab, setLeftTab] = useState<'changes' | 'branches'>('changes')
  // E7a 실험 공간 우클릭 다이얼로그 — 재배치 확인·이름 바꾸기·지우기(needsForce 2단)·원격 지우기
  const [confirmingRebase, setConfirmingRebase] = useState<{ name: string } | null>(null)
  const [renamePrompt, setRenamePrompt] = useState<{ name: string } | null>(null)
  const [confirmingRemove, setConfirmingRemove] = useState<{ name: string; force: boolean } | null>(
    null,
  )
  const [confirmingRemoveRemote, setConfirmingRemoveRemote] = useState<{ name: string } | null>(
    null,
  )
```

- [x] **Step 10: App 배선 (2) — 좌측 열 JSX.** 기존:

```tsx
        {/* 좌측 열 = 변경 목록(위) + 저장 폼(하단 푸터) — 고르고 저장하기까지 한 열에서 끝난다 (E6a) */}
        <div className="app__left">
          <ChangesPanel
            changes={status?.changes ?? []}
            selected={store.selected}
            busy={store.busy}
            onStage={(paths) => void store.stage(paths)}
            onUnstage={(paths) => void store.unstage(paths)}
            onDiscard={(trackedPaths, untrackedPaths) =>
              void store.discard(trackedPaths, untrackedPaths)
            }
            onRemoveFile={(path) => void store.removeFile(path)}
            onSelect={(selected) => void store.selectFile(selected)}
          />
          <CommitForm
            stagedCount={stagedCount}
            busy={store.busy}
            suggestion={suggestion}
            allowEmpty={status?.state === 'merging'}
            onCommit={(message) => store.commit(message)}
          />
        </div>
```

교체:

```tsx
        {/* 좌측 열 = [변경 | 실험 공간] 탭 (E7a) — 변경 탭은 기존 그대로(목록+저장 폼, E6a), 커밋 흐름 무변.
            빠른 전환은 헤더 스위처가 계속 담당하고, 탭은 관리 화면이다 (스펙: 이원화) */}
        <div className="app__left">
          <div className="app__left-tabs" role="tablist" aria-label="왼쪽 패널 전환">
            <button
              type="button"
              role="tab"
              aria-selected={leftTab === 'changes'}
              className="app__left-tab"
              onClick={() => setLeftTab('changes')}
              data-testid="left-tab-changes"
            >
              변경{(status?.changes.length ?? 0) > 0 ? ` ${status?.changes.length}` : ''}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={leftTab === 'branches'}
              className="app__left-tab"
              onClick={() => setLeftTab('branches')}
              data-testid="left-tab-branches"
            >
              실험 공간
            </button>
          </div>
          {leftTab === 'changes' ? (
            <>
              <ChangesPanel
                changes={status?.changes ?? []}
                selected={store.selected}
                busy={store.busy}
                onStage={(paths) => void store.stage(paths)}
                onUnstage={(paths) => void store.unstage(paths)}
                onDiscard={(trackedPaths, untrackedPaths) =>
                  void store.discard(trackedPaths, untrackedPaths)
                }
                onRemoveFile={(path) => void store.removeFile(path)}
                onSelect={(selected) => void store.selectFile(selected)}
              />
              <CommitForm
                stagedCount={stagedCount}
                busy={store.busy}
                suggestion={suggestion}
                allowEmpty={status?.state === 'merging'}
                onCommit={(message) => store.commit(message)}
              />
            </>
          ) : (
            <BranchesPanel
              overview={store.branchOverview}
              compare={store.branchCompare}
              currentBranch={status?.branch.name ?? null}
              busy={store.busy}
              actionsDisabled={status?.state !== 'normal'}
              onCloseCompare={() => store.clearBranchCompare()}
              onAction={(action) => {
                switch (action.kind) {
                  case 'switch':
                    void store.switchBranch(action.name)
                    break
                  case 'branch-from':
                    store.clearError()
                    setBranchPrompt({ fromHash: action.hash })
                    break
                  case 'merge':
                    void store.mergeBranch(action.name)
                    break
                  case 'rebase':
                    setConfirmingRebase({ name: action.name })
                    break
                  case 'compare':
                    void store.compareBranch(action.name)
                    break
                  case 'update':
                    // 현재 공간은 기존 받아오기(pull)로 — 엔진 update는 비현재 전용 (스펙)
                    if (action.name === status?.branch.name) void store.pullLatest()
                    else void store.updateBranch(action.name)
                    break
                  case 'backup':
                    if (action.name === status?.branch.name) void store.backup()
                    else void store.backupBranch(action.name)
                    break
                  case 'rename':
                    store.clearError()
                    setRenamePrompt({ name: action.name })
                    break
                  case 'remove':
                    setConfirmingRemove({ name: action.name, force: false })
                    break
                  case 'checkout-remote':
                    void store.checkoutRemoteBranch(action.name)
                    break
                  case 'remove-remote':
                    setConfirmingRemoveRemote({ name: action.name })
                    break
                }
              }}
            />
          )}
        </div>
```

- [x] **Step 11: App 배선 (3) — 다이얼로그 4종.** 기존(파일 끝 부분):

```tsx
        병합 완료 — 기본 공간({mergeFollowUp})으로 이동해 최신을 받아올까요? 나중에 해도 돼요.
      </ConfirmDialog>
    </div>
  )
}
```

교체:

```tsx
        병합 완료 — 기본 공간({mergeFollowUp})으로 이동해 최신을 받아올까요? 나중에 해도 돼요.
      </ConfirmDialog>
      <ConfirmDialog
        isOpen={confirmingRebase !== null}
        title={`"${confirmingRebase?.name}" 위로 재배치할까요?`}
        confirmLabel="재배치 (rebase)"
        onConfirm={() => {
          const name = confirmingRebase?.name ?? null
          setConfirmingRebase(null)
          if (name !== null) void store.rebaseOnto(name)
        }}
        onCancel={() => setConfirmingRebase(null)}
      >
        지금 공간의 저장들을 그 위로 다시 쌓아요. 내용이 겹치면 하나씩 해결하는 화면이 열려요. 이미
        백업(push)한 공간이라면 원격과 어긋날 수 있어요.
      </ConfirmDialog>
      <PromptDialog
        isOpen={renamePrompt !== null}
        title="실험 공간 이름 바꾸기"
        description="이 공간의 이름만 바뀌어요. 저장 내용은 그대로예요."
        label="새 이름"
        placeholder="예: feature/login"
        submitLabel="바꾸기"
        initialValue={renamePrompt?.name ?? ''}
        errorText={renamePrompt !== null ? store.error : null}
        onSubmit={(newName) => {
          void (async () => {
            const prompt = renamePrompt
            if (prompt === null) return
            // 실패하면 다이얼로그를 유지해 입력을 보존한다 — 에러는 인라인으로 (branchPrompt 관례)
            if (await store.renameBranch(prompt.name, newName)) setRenamePrompt(null)
          })()
        }}
        onCancel={() => setRenamePrompt(null)}
      />
      <ConfirmDialog
        isOpen={confirmingRemove !== null}
        title={
          confirmingRemove?.force === true
            ? '합쳐지지 않은 저장이 있어요 — 그래도 지울까요?'
            : `"${confirmingRemove?.name}" 실험 공간을 지울까요?`
        }
        confirmLabel={confirmingRemove?.force === true ? '그래도 지우기' : '지우기'}
        onConfirm={() => {
          const target = confirmingRemove
          setConfirmingRemove(null)
          if (target === null) return
          void (async () => {
            // 합쳐지지 않은 저장이 있으면 엔진이 지우지 않고 needsForce로 알린다 — 2단 확인 (ManageBranches 관례)
            if (await store.removeBranch(target.name, target.force)) {
              if (!target.force) setConfirmingRemove({ name: target.name, force: true })
            }
          })()
        }}
        onCancel={() => setConfirmingRemove(null)}
      >
        {confirmingRemove?.force === true
          ? '이 공간에만 있는 저장은 함께 사라져요. 되돌릴 수 없어요.'
          : '다른 곳에 합쳐진 저장은 남아요. 합쳐지지 않은 저장이 있으면 한 번 더 물어봐요.'}
      </ConfirmDialog>
      <ConfirmDialog
        isOpen={confirmingRemoveRemote !== null}
        title={`원격에서 "${confirmingRemoveRemote?.name}"을 지울까요?`}
        confirmLabel="원격에서 지우기"
        onConfirm={() => {
          const name = confirmingRemoveRemote?.name ?? null
          setConfirmingRemoveRemote(null)
          if (name !== null) void store.removeRemoteBranch(name)
        }}
        onCancel={() => setConfirmingRemoveRemote(null)}
      >
        원격 저장소에서 지워져요 — 함께 쓰는 다른 사람에게도 영향이 있어요.
      </ConfirmDialog>
    </div>
  )
}
```

- [x] **Step 12: E2E +3.** `apps/desktop/e2e/smoke.spec.ts` — 파일 맨 끝(마지막 테스트 `'커밋이 삭제한 파일은 "이 파일만 적용"이 사유와 함께 비활성이다'`의 닫는 `})` 뒤)에 추가:

```ts

test('실험 공간 탭 — 목록·상태 배지·검색 (E7a)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  const remote = await addBareRemote(repo)
  await execGitOrThrow(['push', '-u', 'origin', 'main'], { cwd: repo })
  await execGitOrThrow(['branch', 'feature/login'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('left-tab-branches').click()
    await expect(window.getByTestId('branches-panel')).toBeVisible()
    await expect(window.getByTestId('branch-row-main')).toContainText('지금 여기')
    await expect(window.getByTestId('branch-row-main')).toContainText('동기화됨')
    await expect(window.getByTestId('branch-row-feature/login')).toContainText('연결 없음')
    await expect(window.getByTestId('branch-row-origin/main')).toBeVisible()
    // 검색 — login만 남는다
    await window.getByTestId('branches-search').fill('login')
    await expect(window.getByTestId('branch-row-main')).toHaveCount(0)
    await expect(window.getByTestId('branch-row-feature/login')).toBeVisible()
    // 변경 탭 복귀 — 저장 폼이 그대로다 (커밋 흐름 무변)
    await window.getByTestId('left-tab-changes').click()
    await expect(window.getByTestId('commit-button')).toBeVisible()
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(remote, { recursive: true, force: true })
  }
})

test('실험 공간 탭 — 우클릭 이동(checkout)에 현재 표시가 따라온다 (E7a)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['branch', 'sidework'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('left-tab-branches').click()
    await window.getByTestId('branch-row-sidework').click({ button: 'right' })
    await window.getByTestId('context-switch').click()
    await expect(window.getByTestId('branch-row-sidework')).toContainText('지금 여기')
    const current = await execGitOrThrow(['branch', '--show-current'], { cwd: repo })
    expect(current.stdout.trim()).toBe('sidework')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('실험 공간 탭 — 지금과 비교가 양방향 전용 저장을 보여준다 (E7a)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  await execGitOrThrow(['checkout', '-b', 'rival'], { cwd: repo })
  await writeFile(join(repo, 'rival.txt'), 'r\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', '상대 전용 저장'], { cwd: repo })
  await execGitOrThrow(['checkout', 'main'], { cwd: repo })
  await writeFile(join(repo, 'mine.txt'), 'm\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', '내 전용 저장'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('left-tab-branches').click()
    await window.getByTestId('branch-row-rival').click({ button: 'right' })
    await window.getByTestId('context-compare').click()
    await expect(window.getByTestId('branch-compare-view')).toContainText('상대 전용 저장')
    await expect(window.getByTestId('branch-compare-view')).toContainText('내 전용 저장')
    await window.getByTestId('branch-compare-back').click()
    await expect(window.getByTestId('branches-list')).toBeVisible()
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})
```

- [x] **Step 13: 게이트** — 루트 `pnpm test` → **392 passed**(branch-badges +4, branch-groups 기존 통과 = 하위 호환). `pnpm typecheck` Done. `cd apps/desktop && npx electron-vite build && npx playwright test e2e/smoke.spec.ts` → **43 passed**.

- [x] **Step 14: Commit**

```bash
git add apps/desktop/src/renderer/src/components/branch-badges.ts apps/desktop/test/branch-badges.test.ts apps/desktop/src/renderer/src/components/branch-groups.ts apps/desktop/src/renderer/src/components/BranchesPanel.tsx apps/desktop/src/renderer/src/components/branches-panel.css apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/layout.css apps/desktop/e2e/smoke.spec.ts
git commit -m "feat(desktop): E7a 좌측 탭 + 실험 공간 패널 — 검색·폴더 그룹·상태 배지·우클릭 관리·비교 뷰

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: UI — rebase 상태 바 4겸용·계속하기·ConflictPanel 라벨 반전

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Modify: `apps/desktop/src/renderer/src/components/ConflictPanel.tsx`
- Modify: `apps/desktop/e2e/smoke.spec.ts` (+1)

- [x] **Step 1: OP_BAR 4겸용.** `apps/desktop/src/renderer/src/App.tsx` 기존:

```ts
/** 진행 중 작업 상태 바 문구 — merging/reverting/cherry-picking 3겸용 (E5b) */
const OP_BAR = {
  merging: { doing: '실험 공간 합치는 중', abort: '합치기 취소' },
  reverting: { doing: '저장 되돌리는 중', abort: '되돌리기 취소' },
  'cherry-picking': { doing: '저장 가져오는 중', abort: '가져오기 취소' },
} as const
```

교체:

```ts
/** 진행 중 작업 상태 바 문구 — merging/reverting/cherry-picking/rebasing 4겸용 (E5b·E7a) */
const OP_BAR = {
  merging: { doing: '실험 공간 합치는 중', abort: '합치기 취소' },
  reverting: { doing: '저장 되돌리는 중', abort: '되돌리기 취소' },
  'cherry-picking': { doing: '저장 가져오는 중', abort: '가져오기 취소' },
  rebasing: { doing: '저장 재배치 중', abort: '재배치 취소' },
} as const
```

- [x] **Step 2: 상태 바 JSX.** 같은 파일 기존(상단 레이어 + 머지 바 블록):

```tsx
      {(status?.state === 'merging' ||
        status?.state === 'reverting' ||
        status?.state === 'cherry-picking' ||
        store.error !== null ||
        store.notice !== null) && (
        <div className="app__top-layer">
          <div className="app__top-stack">
            {(status?.state === 'merging' ||
              status?.state === 'reverting' ||
              status?.state === 'cherry-picking') && (
              <div className="app__merge-bar" data-testid="merge-bar">
                <Pictogram kind="conflict" size={14} label={OP_BAR[status.state].doing} />
                <span className="app__merge-text" data-testid="merge-remaining">
                  {`${OP_BAR[status.state].doing} — ${
                    conflictCount > 0
                      ? `겹침 ${conflictCount}개 남음. 붉은 ! 파일에서 한쪽을 고르고, 다 정리되면 저장하기로 마무리해요.`
                      : status.state !== 'merging' && stagedCount === 0
                        ? `겹침 0개 남음. 전부 내 것을 유지해서 바뀌는 내용이 없어요 — ${OP_BAR[status.state].abort}를 눌러 마무리해요.`
                        : '겹침 0개 남음. 이제 저장하기로 마무리해요.'
                  }`}
                </span>
                <Button
                  variant="danger"
                  size="sm"
                  isDisabled={store.busy}
                  onPress={() => setConfirmingAbort(true)}
                  testId="merge-abort"
                >
                  {OP_BAR[status.state].abort}
                </Button>
              </div>
            )}
```

교체:

```tsx
      {(status?.state === 'merging' ||
        status?.state === 'reverting' ||
        status?.state === 'cherry-picking' ||
        status?.state === 'rebasing' ||
        store.error !== null ||
        store.notice !== null) && (
        <div className="app__top-layer">
          <div className="app__top-stack">
            {(status?.state === 'merging' ||
              status?.state === 'reverting' ||
              status?.state === 'cherry-picking' ||
              status?.state === 'rebasing') && (
              <div className="app__merge-bar" data-testid="merge-bar">
                <Pictogram kind="conflict" size={14} label={OP_BAR[status.state].doing} />
                <span className="app__merge-text" data-testid="merge-remaining">
                  {`${OP_BAR[status.state].doing}${
                    status.state === 'rebasing' && store.rebaseProgress !== null
                      ? ` (${store.rebaseProgress.total}개 중 ${store.rebaseProgress.current}번째)`
                      : ''
                  } — ${
                    conflictCount > 0
                      ? `겹침 ${conflictCount}개 남음. 붉은 ! 파일에서 한쪽을 고르고, 다 정리되면 ${
                          status.state === 'rebasing'
                            ? '계속하기로 다음 저장으로 넘어가요'
                            : '저장하기로 마무리해요'
                        }.`
                      : status.state === 'rebasing'
                        ? '겹침 0개 남음. 계속하기를 눌러 다음 저장으로 넘어가요.'
                        : status.state !== 'merging' && stagedCount === 0
                          ? `겹침 0개 남음. 전부 내 것을 유지해서 바뀌는 내용이 없어요 — ${OP_BAR[status.state].abort}를 눌러 마무리해요.`
                          : '겹침 0개 남음. 이제 저장하기로 마무리해요.'
                  }`}
                </span>
                {status.state === 'rebasing' && conflictCount === 0 && (
                  <Button
                    variant="primary"
                    size="sm"
                    isDisabled={store.busy}
                    onPress={() => void store.continueRebase()}
                    testId="rebase-continue"
                  >
                    계속하기
                  </Button>
                )}
                <Button
                  variant="danger"
                  size="sm"
                  isDisabled={store.busy}
                  onPress={() => setConfirmingAbort(true)}
                  testId="merge-abort"
                >
                  {OP_BAR[status.state].abort}
                </Button>
              </div>
            )}
```

- [x] **Step 3: 취소 확인창 라우팅.** 같은 파일 기존:

```tsx
      <ConfirmDialog
        isOpen={confirmingAbort}
        title={
          status?.state === 'reverting'
            ? '되돌리기를 취소할까요?'
            : status?.state === 'cherry-picking'
              ? '가져오기를 취소할까요?'
              : '합치기를 취소할까요?'
        }
        confirmLabel={
          status?.state === 'reverting'
            ? '되돌리기 취소'
            : status?.state === 'cherry-picking'
              ? '가져오기 취소'
              : '합치기 취소'
        }
        onConfirm={() => {
          setConfirmingAbort(false)
          if (status?.state === 'reverting') void store.abortRevert()
          else if (status?.state === 'cherry-picking') void store.abortCherryPick()
          else void store.abortMerge()
        }}
        onCancel={() => setConfirmingAbort(false)}
      >
        지금까지 고른 것을 되돌리고 이전 상태로 돌아가요.
      </ConfirmDialog>
```

교체:

```tsx
      <ConfirmDialog
        isOpen={confirmingAbort}
        title={
          status?.state === 'reverting'
            ? '되돌리기를 취소할까요?'
            : status?.state === 'cherry-picking'
              ? '가져오기를 취소할까요?'
              : status?.state === 'rebasing'
                ? '재배치를 취소할까요?'
                : '합치기를 취소할까요?'
        }
        confirmLabel={
          status?.state === 'reverting'
            ? '되돌리기 취소'
            : status?.state === 'cherry-picking'
              ? '가져오기 취소'
              : status?.state === 'rebasing'
                ? '재배치 취소'
                : '합치기 취소'
        }
        onConfirm={() => {
          setConfirmingAbort(false)
          if (status?.state === 'reverting') void store.abortRevert()
          else if (status?.state === 'cherry-picking') void store.abortCherryPick()
          else if (status?.state === 'rebasing') void store.abortRebase()
          else void store.abortMerge()
        }}
        onCancel={() => setConfirmingAbort(false)}
      >
        지금까지 고른 것을 되돌리고 이전 상태로 돌아가요.
      </ConfirmDialog>
```

- [x] **Step 4: ConflictPanel mode 전달.** 같은 파일 기존:

```tsx
              busy={store.busy}
              // cherry-picking은 merging 취급 — 상대 라벨 '가져온 것'이 "이 저장만 가져오기" 어휘와 일치한다 (E5b 설계 판단)
              mode={status?.state === 'reverting' ? 'reverting' : 'merging'}
```

교체:

```tsx
              busy={store.busy}
              // cherry-picking은 merging 취급 — 상대 라벨 '가져온 것'이 "이 저장만 가져오기" 어휘와 일치한다 (E5b 설계 판단).
              // rebasing은 git의 ours/theirs가 뒤집힌다(내 것=새 기반) — 전용 mode로 라벨을 정직하게 (E7a)
              mode={
                status?.state === 'reverting'
                  ? 'reverting'
                  : status?.state === 'rebasing'
                    ? 'rebasing'
                    : 'merging'
              }
```

- [x] **Step 5: ConflictPanel 라벨 반전.** `apps/desktop/src/renderer/src/components/ConflictPanel.tsx` — 편집 5곳.

(a) 기존:

```ts
  /** 어느 흐름의 충돌인가 — merge는 "가져온 것", revert는 "되돌린 결과물"로 문구를 분기한다 (품질 리뷰) */
  mode: 'merging' | 'reverting'
```

교체:

```ts
  /**
   * 어느 흐름의 충돌인가 — merge는 "가져온 것", revert는 "되돌린 결과물"로 문구를 분기한다 (품질 리뷰).
   * rebase는 git의 ours/theirs가 뒤집힌다 — 초록(ours)=새 기반, 보라(theirs)=재배치 중인 내 저장 (E7a)
   */
  mode: 'merging' | 'reverting' | 'rebasing'
```

(b) 기존:

```ts
  const takenLabel = mode === 'reverting' ? '되돌린 결과물' : '가져온 것'
```

교체:

```ts
  const takenLabel =
    mode === 'reverting' ? '되돌린 결과물' : mode === 'rebasing' ? '재배치 중인 내 저장' : '가져온 것'
  // rebase에서는 초록(ours)이 "내 것"이 아니라 새 기반이다 — 이름을 정직하게 바꾼다 (E7a)
  const mineLabel = mode === 'rebasing' ? '새 기반' : '내 것'
```

(c) 기존:

```tsx
            두 버전이 같은 곳을 다르게 고쳤어요. 겹침마다 카드에서 한쪽을 골라 주세요 — 초록이{' '}
            <strong>내 것</strong>, 보라가 <strong>{takenLabel}</strong>이에요. 고르면 파일에 바로
```

교체:

```tsx
            두 버전이 같은 곳을 다르게 고쳤어요. 겹침마다 카드에서 한쪽을 골라 주세요 — 초록이{' '}
            <strong>{mineLabel}</strong>, 보라가 <strong>{takenLabel}</strong>이에요. 고르면 파일에 바로
```

(d) 기존:

```tsx
              <User size={13} aria-hidden="true" /> 내 것 유지
```

교체:

```tsx
              <User size={13} aria-hidden="true" /> {mineLabel} 유지
```

(e) 기존:

```tsx
                            <span className="conflict-card__side-label">
                              <User size={12} aria-hidden="true" /> 내 것
                            </span>
```

교체:

```tsx
                            <span className="conflict-card__side-label">
                              <User size={12} aria-hidden="true" /> {mineLabel}
                            </span>
```

- [x] **Step 6: E2E — rebase 충돌 완주.** `apps/desktop/e2e/smoke.spec.ts` — 파일 맨 끝(Task 6에서 추가한 비교 테스트의 닫는 `})` 뒤)에 추가:

```ts

test('재배치(rebase) — 충돌 → 새 기반/내 저장 선택 → 계속하기 → 완료 (E7a)', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'git-gui-e2e-'))
  await execGitOrThrow(['init', '--initial-branch=main'], { cwd: repo })
  await execGitOrThrow(['config', 'user.name', 'E2E'], { cwd: repo })
  await execGitOrThrow(['config', 'user.email', 'e2e@test.local'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'base\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', 'init'], { cwd: repo })
  await execGitOrThrow(['checkout', '-b', 'topic'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'topic\n')
  await execGitOrThrow(['commit', '-am', 'topic 저장'], { cwd: repo })
  await execGitOrThrow(['checkout', 'main'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'main\n')
  await execGitOrThrow(['commit', '-am', 'main 저장'], { cwd: repo })
  await execGitOrThrow(['checkout', 'topic'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('left-tab-branches').click()
    await window.getByTestId('branch-row-main').click({ button: 'right' })
    await window.getByTestId('context-rebase').click()
    await window.getByRole('button', { name: '재배치 (rebase)' }).click()
    // 충돌 — 4겸용 상태 바 + 진행 표시(실측 2: msgnum/end)
    await expect(window.getByTestId('merge-bar')).toContainText('저장 재배치 중 (1개 중 1번째)')
    // 변경 탭의 ! 파일에서 해결 — rebase 라벨 반전(초록=새 기반, 보라=재배치 중인 내 저장)
    await window.getByTestId('left-tab-changes').click()
    await window.getByTestId('file-unstaged-app.txt').click()
    await expect(window.getByTestId('conflict-panel')).toBeVisible()
    await expect(window.getByTestId('conflict-ours')).toContainText('새 기반 유지')
    await window.getByTestId('conflict-theirs').click()
    await expect(window.getByTestId('merge-bar')).toContainText('겹침 0개 남음')
    await window.getByTestId('rebase-continue').click()
    await expect(window.getByTestId('notice')).toContainText('재배치를 마쳤어요')
    await expect(window.getByTestId('merge-bar')).toHaveCount(0)
    // 재배치 성립 — topic의 부모가 main이고 내 저장 내용이 남았다
    const parent = await execGitOrThrow(['rev-parse', 'topic^'], { cwd: repo })
    const main = await execGitOrThrow(['rev-parse', 'main'], { cwd: repo })
    expect(parent.stdout.trim()).toBe(main.stdout.trim())
    expect(await readFile(join(repo, 'app.txt'), 'utf8')).toBe('topic\n')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})
```

- [x] **Step 7: 게이트** — 루트 `pnpm test` → **392 passed**. `pnpm typecheck` Done. `cd apps/desktop && npx electron-vite build && npx playwright test e2e/smoke.spec.ts` → **44 passed** (기존 merge·revert·cherry-pick 충돌 흐름 전부 통과 = 4겸용 확장·라벨 변수화의 무회귀 게이트).

- [x] **Step 8: Commit**

```bash
git add apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/components/ConflictPanel.tsx apps/desktop/e2e/smoke.spec.ts
git commit -m "feat(desktop): E7a rebase 상태 바 4겸용 — 진행 M/N·계속하기·취소, 충돌 라벨 반전(새 기반/내 저장)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

> **실행 중 편차 기록:** Task 6의 좌측 탭바가 app__top-layer(z-40) 오버레이에 가려 상태 바가 떠 있는 동안 클릭 불가였다(구현자가 rebase 충돌 E2E에서 실측 — Playwright pointer-events 차단 + 스크린샷 확증). 테스트 우회가 아니라 실사용 결함이라 layout.css의 탭바에 `position: relative; z-index: 41`을 병기해 수리했다(위 Task 6 CSS 블록에 소급 반영됨). 잔여 코스메틱(배너 좌측 텍스트와 탭의 시각적 겹침)은 Task 9 검수에서 실결함으로 판정되어 즉시 해소했다 — layout.css의 `.app__merge-text` 규칙 뒤에 다음을 추가(커밋 4f2985f), 공식 스크린샷 재촬영·육안 재검수 통과:

```css
/* E7a — 좌측 탭바(z-41)가 배너 위에 뜬다. 배너 텍스트가 탭 뒤로 숨지 않게 콘텐츠만 탭 구역 오른쪽에서 시작(배경은 전체 폭 유지) */
.app__error,
.app__notice,
.app__merge-bar {
  padding-left: 210px;
}
```

---

### Task 8: E2E — 업데이트·원격 가져오기

**Files:**
- Modify: `apps/desktop/e2e/smoke.spec.ts` (+2)

- [x] **Step 1: E2E 추가.** 파일 맨 끝(Task 7의 rebase 테스트 닫는 `})` 뒤)에 추가:

```ts

test('실험 공간 탭 — 비현재 공간을 원격 최신으로 업데이트한다 (E7a)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  const remote = await addBareRemote(repo)
  await execGitOrThrow(['push', '-u', 'origin', 'main'], { cwd: repo })
  await execGitOrThrow(['push', 'origin', 'main:old'], { cwd: repo })
  await execGitOrThrow(['branch', '--track', 'old', 'origin/old'], { cwd: repo })
  // 다른 클론이 old를 앞세운다 — 로컬 old는 뒤처진(ff 가능) 상태
  const other = await mkdtemp(join(tmpdir(), 'git-gui-e2e-other-'))
  await execGitOrThrow(['clone', remote, other], { cwd: tmpdir() })
  await execGitOrThrow(['config', 'user.name', 'E2E'], { cwd: other })
  await execGitOrThrow(['config', 'user.email', 'e2e@test.local'], { cwd: other })
  await execGitOrThrow(['checkout', 'old'], { cwd: other })
  await writeFile(join(other, 'o.txt'), 'o\n')
  await execGitOrThrow(['add', '-A'], { cwd: other })
  await execGitOrThrow(['commit', '-m', 'other old'], { cwd: other })
  await execGitOrThrow(['push'], { cwd: other })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('left-tab-branches').click()
    await window.getByTestId('branch-row-old').click({ button: 'right' })
    await window.getByTestId('context-update').click()
    await expect(window.getByTestId('notice')).toContainText('원격 최신으로 업데이트했어요')
    await expect(window.getByTestId('branch-row-old')).toContainText('동기화됨')
    const localOld = await execGitOrThrow(['rev-parse', 'old'], { cwd: repo })
    const remoteOld = await execGitOrThrow(['rev-parse', 'old'], { cwd: remote })
    expect(localOld.stdout.trim()).toBe(remoteOld.stdout.trim())
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(remote, { recursive: true, force: true })
    await rm(other, { recursive: true, force: true })
  }
})

test('실험 공간 탭 — 원격 공간을 내 공간으로 가져온다(추적 checkout) (E7a)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  const remote = await addBareRemote(repo)
  await execGitOrThrow(['push', '-u', 'origin', 'main'], { cwd: repo })
  // 원격에만 있는 공간 — push refspec으로 만들면 로컬 remote-tracking ref도 함께 생긴다
  await execGitOrThrow(['push', 'origin', 'main:incoming'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('left-tab-branches').click()
    await window.getByTestId('branch-row-origin/incoming').click({ button: 'right' })
    await window.getByTestId('context-checkout-remote').click()
    await expect(window.getByTestId('notice')).toContainText('가져와 이동했어요')
    await expect(window.getByTestId('branch-row-incoming')).toContainText('지금 여기')
    const current = await execGitOrThrow(['branch', '--show-current'], { cwd: repo })
    expect(current.stdout.trim()).toBe('incoming')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(remote, { recursive: true, force: true })
  }
})
```

- [x] **Step 2: 게이트** — `cd apps/desktop && npx electron-vite build && npx playwright test e2e/smoke.spec.ts` → **46 passed**. 루트 `pnpm test` → 392, `pnpm typecheck` Done.

- [x] **Step 3: Commit**

```bash
git add apps/desktop/e2e/smoke.spec.ts
git commit -m "test(desktop): E7a E2E — 비현재 공간 업데이트·원격 공간 추적 가져오기

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: 최종 게이트 + 공식 스크린샷 2장 + README

- [x] **Step 1: 전체 게이트** — 순서대로 전부 exit 0:
  - 루트 `pnpm test` → **392 passed**
  - 루트 `pnpm typecheck` → 전 프로젝트 Done
  - `pnpm --filter @git-gui/desktop build`
  - `pnpm --filter @git-gui/desktop e2e` → **52 passed** (smoke 46 + hosting 6, 실행 내내 창 미노출)
  - `find apps/desktop/test-results -name 'last-screen-*.png'` → 0건

- [x] **Step 2: README 반영.** `README.md` 기존(E6b 문단 끝 문장):

```
E2E는 실패한 테스트의 마지막 화면을 test-results에 남기고, GIT_GUI_E2E_SHOW=1로 창을 보면서 디버깅할 수 있습니다.
```

교체:

```
E2E는 실패한 테스트의 마지막 화면을 test-results에 남기고, GIT_GUI_E2E_SHOW=1로 창을 보면서 디버깅할 수 있습니다. E7a로 좌측에 [변경 | 실험 공간] 탭이 생겨 브랜치를 IntelliJ처럼 관리합니다 — 검색·폴더 그룹·상태 배지(↑↓·연결 없음), 우클릭으로 이동·합치기·재배치(rebase — 겹치면 카드로 하나씩 해결하고 계속하기)·원격 최신 업데이트·checkout 없는 백업·이름 바꾸기·지우기, 원격 브랜치 가져오기(추적)·원격에서 지우기·지금과 비교까지 됩니다.
```

- [x] **Step 3: 공식 스크린샷 2장** — `test-results/` + 세션 scratchpad 사본(경로가 없으면 `mkdir -p`로 만든다: `<temporary-scratchpad>`). **생성 후 e2e 재실행 금지**(test-results가 갈린다). 임시 파일 `apps/desktop/e2e/tmp-shots-e7a.spec.ts`:

```ts
// 임시 파일 — 공식 스크린샷 생성 후 삭제한다 (커밋 금지)
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { execGitOrThrow } from '@git-gui/git-process'

const APP_ROOT = join(__dirname, '..')
const SCRATCH =
  '<temporary-scratchpad>'

test('공식 스크린샷 — E7a 실험 공간 탭·rebase 진행 바 2장', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'git-gui-shot-'))
  await execGitOrThrow(['init', '--initial-branch=main'], { cwd: repo })
  await execGitOrThrow(['config', 'user.name', 'E2E'], { cwd: repo })
  await execGitOrThrow(['config', 'user.email', 'e2e@test.local'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'base\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', '첫 화면 저장'], { cwd: repo })
  const remote = await mkdtemp(join(tmpdir(), 'git-gui-shot-remote-'))
  await execGitOrThrow(['init', '--bare', '--initial-branch=main'], { cwd: remote })
  await execGitOrThrow(['remote', 'add', 'origin', remote], { cwd: repo })
  await execGitOrThrow(['push', '-u', 'origin', 'main'], { cwd: repo })
  await execGitOrThrow(['branch', 'feature/login'], { cwd: repo })
  // rebase 충돌 재료 — topic이 main과 같은 파일을 다르게 고친다
  await execGitOrThrow(['checkout', '-b', 'topic'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'topic\n')
  await execGitOrThrow(['commit', '-am', '실험 저장'], { cwd: repo })
  await execGitOrThrow(['checkout', 'main'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'main\n')
  await execGitOrThrow(['commit', '-am', '기본 저장'], { cwd: repo })
  await execGitOrThrow(['checkout', 'topic'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]!.setSize(1440, 900)
    })
    await expect.poll(() => window.evaluate(() => window.innerWidth)).toBe(1440)
    // (1) 실험 공간 탭 — 배지 3종(지금 여기·동기화됨/↑·연결 없음)과 원격 그룹
    await window.getByTestId('left-tab-branches').click()
    await expect(window.getByTestId('branch-row-topic')).toContainText('지금 여기')
    await expect(window.getByTestId('branch-row-feature/login')).toContainText('연결 없음')
    await expect(window.getByTestId('branch-row-origin/main')).toBeVisible()
    await window.screenshot({ path: 'test-results/e7a-branches-panel.png' })
    // (2) rebase 진행 바 — 충돌 상태의 4겸용 바(M/N·계속하기 없음 — 겹침 남음)와 취소 버튼
    await window.getByTestId('branch-row-main').click({ button: 'right' })
    await window.getByTestId('context-rebase').click()
    await window.getByRole('button', { name: '재배치 (rebase)' }).click()
    await expect(window.getByTestId('merge-bar')).toContainText('저장 재배치 중 (1개 중 1번째)')
    await window.screenshot({ path: 'test-results/e7a-rebase-bar.png' })
    await copyFile('test-results/e7a-branches-panel.png', join(SCRATCH, 'e7a-branches-panel.png'))
    await copyFile('test-results/e7a-rebase-bar.png', join(SCRATCH, 'e7a-rebase-bar.png'))
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(remote, { recursive: true, force: true })
  }
})
```

실행·정리 (build는 Step 1에서 이미 됐다 — 재빌드 없이 이 파일만 실행):

```bash
cd apps/desktop && npx playwright test e2e/tmp-shots-e7a.spec.ts
rm apps/desktop/e2e/tmp-shots-e7a.spec.ts
rm -rf apps/desktop/test-results/tmp-shots-e7a-*
```

스크린샷 2장이 test-results/와 scratchpad 양쪽에 있는지 확인하고 **육안 검수**한다: (a) e7a-branches-panel — 좌측 탭바에서 "실험 공간"이 활성, 목록에 `⎇ topic`+지금 여기 / `📁 feature/` 아래 login+연결 없음 / `origin (원격)` 그룹의 `☁ origin/main`이 서로 구분되어 보이는지, 중앙·우측(diff·역사)이 그대로인지. (b) e7a-rebase-bar — 상단 바에 "저장 재배치 중 (1개 중 1번째) — 겹침 1개 남음…"과 "재배치 취소" 버튼이 겹침·잘림 없이 보이는지. 이후 e2e를 다시 돌리지 않는다.

- [x] **Step 4: Commit** (README만 — 스크린샷·test-results/는 미추적)

```bash
git add README.md
git commit -m "docs: README — E7a 실험 공간 탭(IntelliJ식 브랜치 관리·rebase·원격 조작) 반영

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(플랜 문서 자체는 실행을 마친 컨트롤러가 실행 기록·후속 노트를 붙여 별도 `docs:` 커밋으로 남긴다 — E6b 관례.)

## 인용 앵커 검증 기록

**스크립트 실검증(2026-07-21, main=1118c48):** 플랜의 "기존:" 블록 44개 전수 — 기준선 파일에서 정확히 1회 매칭 **37개**, 선행 태스크의 교체 결과로만 존재하는 미래 앵커 **7개**(각각이 앞선 교체 블록의 부분 문자열임을 확인 — 자기 일관), 불일치 **0개**. `HEEAD`류 오타 함정·placeholder 없음.

플랜의 "기존:" 코드 블록은 작성 시점(main=1118c48)의 실제 파일에서 발췌했다 — client.ts(list 구현·rename 꼬리·CHERRY_PICK 상수·인터페이스 branches 블록·E6b rejectIfRemoteAhead 중첩 블록), domain repository.ts(BranchSummary), ipc-contract(branches 인터페이스·CHANNELS branchesRename 줄), git-handlers(branchesRename 핸들러), preload(branches 블록), repository-store(상태 선두 3필드·renameBranch 선언·fetchSnapshot·CLEAR_SELECTIONS·hostingStatus: null·renameBranch 구현), App.tsx(OP_BAR·상단 레이어 블록·좌측 열 블록·BranchSwitcher import·confirmingAbort 상태 블록·취소 확인창·ConflictPanel mode 줄·mergeFollowUp 꼬리), ConflictPanel(mode props·takenLabel·hint·내 것 유지·카드 라벨), layout.css(.app__left > .changes-panel), branch-groups.ts(전문 교체), smoke.spec.ts(파일 끝 추가만 — 앵커는 직전 태스크가 추가한 테스트의 꼬리), README(E6b 문단 끝 문장). **구현 각 태스크의 첫 단계에서 앵커가 정확히 1회 매칭되는지 grep으로 확인하고, 0회·2회 이상이면 BLOCKED로 보고한다** (실행 중 선행 태스크가 만든 앵커는 해당 태스크 완료 후에만 존재한다 — Task 2~4의 앵커 일부는 Task 1~3의 교체 결과다, 순서 엄수).

## Self-review 수정 기록 (인라인 반영)

1. **스펙의 "빈 커밋 --skip 확인창" 폐기 — 실측으로 반증.** git 2.50의 rebase(merge 백엔드)는 해소 결과가 빈 커밋이면 `--continue`가 자동 드롭하고 성공 종료한다(실측 2). UI 확인창·엔진 skip 경로를 만들지 않는다.
2. **for-each-ref의 origin/HEAD 함정 실측 반영** — `%(refname:short)`가 `origin`으로 나오는 심볼릭 행을 `%(symref)`로 걸렀다. 초안의 "이름에 / 없으면 스킵" 휴리스틱은 폐기(리모트 이름과 충돌).
3. **rebase 충돌의 ours/theirs 반전을 UI에 정직하게 반영** — ConflictPanel에 mode 'rebasing'을 추가해 초록=새 기반, 보라=재배치 중인 내 저장으로 라벨을 바꿨다. merging으로 뭉개면 "내 것 유지"가 실제로는 상대 것을 고르는 거짓 라벨이 된다.
4. **branches.update의 대상 원격을 origin 고정이 아니라 `branch.<name>.remote`/`merge` config로** — upstream 브랜치 이름이 로컬과 다른 경우(refspec 소스)와 origin이 아닌 remote를 정확히 따른다.
5. **overview에 `%(objectname)` 추가** — "여기서 새 실험 공간"의 fromHash(엔진 create가 40자 해시를 요구)를 패널 행에서 바로 공급하기 위해. 초안 6필드 → 7필드.
6. **removeRemote의 `--end-of-options` 위치 수정** — `--delete`는 옵션이므로 `push --delete --end-of-options <remote> <branch>` 순서다(초안은 delete가 positional로 밀렸다).
7. **groupBranches 제네릭화로 패널·스위처 공유** — LocalBranchStatus용 그룹핑을 복제하지 않고 `<T extends { name: string }>`로 넓혔다. 기존 테스트 통과가 하위 호환 게이트.
8. **테스트 수 산정 재검** — E6b의 산수 오기 교훈: overview-parser 8(it 단위) + client 통합 1 + update/backup 6 + remote/compare 7 + rebase 6 + branch-badges 4 = +32 → 360+32=**392**. smoke 40 + 탭 3 + rebase 1 + 원격 2 = **46**.

## 후속 노트 (이관 후보)

- **rebase 충돌 시 변경 탭 자동 전환** — 지금은 실험 공간 탭에 머물러 사용자가 직접 변경 탭으로 가야 ! 파일이 보인다. 충돌 발생 시 `setLeftTab('changes')` 자동 전환 검토.
- **원격 목록의 신선도** — remotes는 fetch된 remote-tracking ref 기준이라 받아오기(pull) 전에는 낡을 수 있다. "원격 새로고침(fetch --all)" 버튼 검토.
- **ManageBranchesDialog 통합** — 패널이 이름 바꾸기·지우기를 흡수했으므로 관리 다이얼로그·헤더 "관리" 진입점의 제거/통합 검토(안착 후).
- **BranchSwitcher와 패널의 데이터 이원화** — branches.list(스위처)와 branches.overview(패널)가 병행 조회된다. 스위처를 overview 기반으로 통합하면 호출 1회가 준다.
- **비교 뷰 커밋 클릭 → 상세 연동** — v1은 목록만. 클릭 시 우측 커밋 상세와 연결 검토.
- **compare의 브랜치 이름 인자** — `--end-of-options` 없이 range(`A..B`)로 넘긴다. 이름은 check-ref-format이 보증하지만(대시 시작 불가) log 옵션 파싱과의 경계는 후속 정밀화 후보.
- **긴 브랜치 이름·많은 브랜치의 가상화** — 목록이 수백 개면 기존 가상화 관례(react-virtual) 적용 검토. v1은 일반 스크롤.

## 실행 기록 (2026-07-22, subagent-driven — 태스크별 스펙 byte-match 리뷰 + 품질 리뷰 + 최종 통합 리뷰 전부 통과)

- 커밋 15건: 793e848(T1) · 3cd85bc(T2) · 6589103(T2 보완) · 641698b(T3) · 7ed10dd(T3 보완) · c14ffc7(T4) · cdc8d47(T4 보완) · e9897e2(T5) · 37f5e93(T5 보완) · b67c8c7(T6) · 24ae165(T6 보완) · 9f34829(T7) · 9252ef4(T8) · b2cd8cd(T9 README) · 4f2985f(T9 검수 보완). 최종 게이트: 단위 **392** · typecheck 전부 Done · E2E **52**(smoke 46 + hosting 6) · last-screen 0건 · 공식 스크린샷 2장 육안 검수(재촬영 포함) 통과.
- **품질 리뷰 Important 5건 → 보완 커밋으로 전부 폐쇄·재승인:** ① backup 반쪽 연결(-u 폴백, update 대칭), ② compare 태그 동명 가림(refs/heads 우선 해석 — Red로 가림 재현 후 해소), ③ rebase autostash 고정(-c rebase.autostash=false — 전역 설정 비간섭·자동 보관 결정성, autostash=true 환경 실증), ④ 비교 뷰 무효화(update·원격 삭제가 대상 공간이면 닫기), ⑤ 브랜치 행 키보드 활성화 메뉴 (0,0)→행 앵커.
- **실행 중 실측 보정 2건(플랜 소급 반영):** rebase 충돌 루프 테스트의 해소 내용이 원본과 byte-identical하면 3-way fast path로 다음 커밋이 자동 병합됨 → 해소 문자열 차등화. Task 6 탭바가 top-layer(z-40)에 가려 클릭 불가 → z-41 승격, 이어서 Task 9 검수에서 탭이 배너 텍스트를 가리는 역방향 겹침 확정 → 배너 3종 padding-left 210px 인셋(배경 전체 폭 유지)으로 최종 해소 + 스크린샷 재촬영.

### 리뷰 Minor 후속 노트 (이관 — 전부 비차단)

- **(통합 리뷰 #1 — E7b 폴리시 최우선 후보) 충돌 발생 시 변경 탭 자동 전환** — 실험 공간 탭에서 시작한 rebase/merge가 충돌하면 ! 파일은 변경 탭에 있는데 패널은 실험 공간 탭에 머문다. `setLeftTab('changes')` 자동 전환 또는 바 문구에 "왼쪽 '변경' 탭에서" 병기 검토(초심자 UX 핵심).
- **(통합 리뷰) rebase 중 저장 폼 이중 완료 경로** — 해소 스테이징 후 저장하기도 활성이다(무해하나 계속하기와 이원화). 문구·비활성 검토.
- **(통합 리뷰) 현재 브랜치 update 항목의 사유 미병기** — upstream 없는 현재 브랜치의 "(pull)" 라벨이 사유 없이 비활성. "사유 병기" 원칙 정합화.
- **(통합 리뷰) README 배지 나열 불완전** — 연결 끊김·동기화됨 미기재. **(통합 리뷰) 배너 인셋 210px 상수** — 탭바 폭("변경 N")이 아주 넓어지면 부족할 수 있음(960px 바닥에서는 여유 확인).
- **(T1 품질) overview 파서** — behind-only track 회귀 테스트·다단 원격 브랜치 이름 테스트·슬래시 원격 이름 근사 주석. **(T3 품질)** compare exact-100 무overflow 경계 테스트·두 log 호출 Promise.all·원격 기본 브랜치 삭제 거부 친절화. **(T4 품질)** detached HEAD rebase 가드·progress 빈 파일 NaN 엣지·빈 커밋 자동 드롭 고정 테스트. **(T5 품질)** compareBranch self-heal 부재(refresh 시 드롭 검토)·"비교 열고 그 브랜치 update" E2E 잠금. **(T6 품질)** removeBranch needsForce 시맨틱 주석·dead CSS(.app__left > .branches-panel)·검색 대소문자 무시·탭 ARIA(tabpanel/aria-controls·방향키)·메뉴 빌더 branch-menu.ts 추출+비활성 매트릭스 단위 테스트. **(T7 품질)** 탭바 z-41의 스태킹 컨텍스트 전제(조상 transform/opacity 금지) 주석·충돌 힌트의 "저장된 역사에 남아 있어요"가 rebase에선 reflog 한정·빈 커밋 드롭 시 안내 부재. **(E2E 위생)** 임시 저장소·bare remote 미삭제 누적(기존 관례).
