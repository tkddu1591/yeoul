# E2 충돌 하나씩 선택형 + 자세히 보기 구현 계획 (스펙 §7·§11 E2·§12 E-004)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 충돌을 파일 단위가 아니라 **겹침 블록 하나씩 카드로** 골라 해소하고(진행 표시 "겹침 N곳 중 M번째"), "자세히 보기"에서 합쳐진 결과를 직접 수정하며, 선택형↔상세 전환·앱 재시작에도 선택이 유지되게 한다(E-004). "처음부터 다시"로 언제든 선택을 되돌릴 수 있다.

**Architecture(핵심 결정 — 변경 불가):** **블록 선택은 파일에 즉시 반영(해당 블록 마커 제거·git add 없음), 확정(git add)은 전 블록 해소 후 사용자가 "고른 대로 확정"을 눌렀을 때만.** 이로써 (a) 스펙 "해결 완료 전 확정 없음" 충족(add 전이므로), (b) 선택형↔상세 전환 시 선택 유지(E-004 — 상태가 파일에 있음), (c) 앱 재시작 복원(스펙 §7 공통 원칙 — 파일 + MERGE_HEAD가 상태 전부)이 공짜로 성립하고, (d) "처음부터 다시"는 `git checkout -m -- <path>`로 마커를 재생성한다. 렌더러 로직 계층(conflict-markers.ts)에 순수 함수 파서/컴포저(`listConflictBlocks`·`applyBlockChoice`·`buildConflictView`)를 두고, 엔진에는 `conflicts.saveText`(add 없는 쓰기)·`conflicts.reset`(checkout -m)만 추가한다. UI는 기존 가상 스크롤을 유지하되 **블록 하나 = 카드 하나 = 단일 가상 row**(measureElement 동적 측정)로 절충한다. 확정은 기존 markResolved 흐름(최신 내용 hasConflictMarkers 검사 포함)을 재사용한다.

**Tech Stack:** 기존과 동일 (신규 의존성 없음).

**실측으로 확정한 git 동작 (probe 저장소 + 컨트롤러 실측):**
- 부분 해소(첫 블록만 ours로 고쳐 쓴 파일, index는 UU) 후 `git checkout -m -- f.txt` → **exit 0, 전체 마커 재생성**. 라벨이 브랜치명 대신 `<<<<<<< ours` / `>>>>>>> theirs`로 바뀐다 — 파서는 접두사(`<<<<<<<`) 기반이라 무관. `ls-files -u`의 3 stage(UU)는 그대로 유지된다 (컨트롤러 실측 + 로컬 재확인).
- 블록 2개 픽스처: **떨어진 두 변경(사이 context 3줄 이상)**이어야 한다 — `one\ntwo\nthree\nfour\nfive\nsix\nseven\n`에서 1행·7행을 양쪽이 다르게 바꾸면 마커 2쌍이 생긴다(로컬 실측: `grep -c '<<<<<<<'` = 2). 인접한 변경은 git이 한 블록으로 합친다.
- 마커 제거 후 `writeFile`만 하면(add 없음) porcelain v2는 여전히 `u UU`(conflicted) — 확정 전 상태 보존이 성립한다.
- 기준선 실측: **238 tests PASS, E2E 25** (pnpm test 실행 확인, smoke.spec.ts 25건 계수).

**알려진 한계(의도적):** "자세히 보기"는 스펙 상세 뷰(양쪽 버전 + 합쳐진 결과 3-way 나란히)의 **단순화 버전** — 합쳐진 결과(남은 마커 포함)를 textarea로 직접 수정한다. 3-way 나란히 고도화는 후속. 진행 표시의 분모(총 N곳)는 파일을 연 시점 기준이라 재시작 후에는 남은 블록 수로 재산정된다(해소된 블록은 파일에서 사라져 셀 수 없다 — E2E (c)는 남은 수 복원만 고정한다). 바이너리·1MB 초과 파일은 기존과 동일하게 뷰가 열리지 않는다.

---

## 파일 구조

```
apps/desktop/src/renderer/src/components/conflict-markers.ts # listConflictBlocks·applyBlockChoice·buildConflictView (수정)
apps/desktop/test/conflict-markers.test.ts                   # 블록 파서·컴포저 테스트 +10 (수정)
packages/git-adapter/src/client.ts                           # conflicts.saveText·reset (수정)
packages/git-adapter/test/client.test.ts                     # saveText·reset 테스트 +5 (수정)
packages/ipc-contract/src/index.ts                           # 채널 2개 (수정)
apps/desktop/src/main/git-handlers.ts                        # 핸들러 2개 (수정)
apps/desktop/src/preload/index.ts                            # 브리지 (수정)
apps/desktop/src/renderer/src/store/repository-store.ts      # chooseConflictBlock·saveConflictText·resetConflict (수정)
apps/desktop/src/renderer/src/components/ConflictPanel.tsx   # 카드 선택형·자세히 보기 (전면 개편)
apps/desktop/src/renderer/src/components/conflict-panel.css  # 카드·진행·편집기 스타일 (전면 개편)
apps/desktop/src/renderer/src/App.tsx                        # 새 props 3개 배선 (수정)
apps/desktop/e2e/smoke.spec.ts                               # E2E 4개 + 픽스처 헬퍼 (수정)
README.md                                                    # 현재 상태 갱신 (수정)
```

---

### Task 1: renderer 로직 — 블록 파서·컴포저 (순수 함수)

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/conflict-markers.ts`
- Test: `apps/desktop/test/conflict-markers.test.ts`

- [ ] **Step 1: 실패하는 테스트**

`apps/desktop/test/conflict-markers.test.ts`의 import 행을 교체:

기존:

```ts
import { parseConflictContent } from '../src/renderer/src/components/conflict-markers'
```

교체:

```ts
import {
  applyBlockChoice,
  buildConflictView,
  listConflictBlocks,
  parseConflictContent,
} from '../src/renderer/src/components/conflict-markers'
```

파일 끝(기존 `describe('parseConflictContent', …)` 블록 **뒤**)에 추가:

```ts
/** 떨어진 두 변경 — 블록 2개, 마지막 개행 있음 */
const TWO_BLOCKS = [
  'top',
  '<<<<<<< HEAD',
  'mine-1',
  '=======',
  'theirs-1',
  '>>>>>>> rival',
  'mid-a',
  'mid-b',
  'mid-c',
  '<<<<<<< HEAD',
  'mine-2a',
  'mine-2b',
  '=======',
  'theirs-2',
  '>>>>>>> rival',
  'bottom',
  '',
].join('\n')

describe('listConflictBlocks', () => {
  it('두 블록의 내용과 라인 범위를 추출한다', () => {
    const blocks = listConflictBlocks(TWO_BLOCKS)
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toEqual({ index: 0, start: 1, end: 5, ours: ['mine-1'], theirs: ['theirs-1'] })
    expect(blocks[1]).toEqual({
      index: 1,
      start: 9,
      end: 14,
      ours: ['mine-2a', 'mine-2b'],
      theirs: ['theirs-2'],
    })
  })

  it('마커가 없으면 빈 배열이다', () => {
    expect(listConflictBlocks('a\nb\n')).toEqual([])
  })

  it('비정상 마커(순서 꼬임·미완결)는 블록으로 세지 않는다', () => {
    // parseConflictContent와 같은 원칙 — 순서가 맞는 완결 구간만 블록이다
    expect(listConflictBlocks('=======\n>>>>>>> x\nplain\n')).toEqual([])
    expect(listConflictBlocks('<<<<<<< HEAD\nmine\n=======\ntheirs\n')).toEqual([])
  })
})

describe('applyBlockChoice', () => {
  it('첫 블록을 내 것으로 — 그 블록 마커·반대쪽만 사라지고 나머지는 그대로다', () => {
    const next = applyBlockChoice(TWO_BLOCKS, 0, 'ours')
    expect(next).toBe(
      [
        'top',
        'mine-1',
        'mid-a',
        'mid-b',
        'mid-c',
        '<<<<<<< HEAD',
        'mine-2a',
        'mine-2b',
        '=======',
        'theirs-2',
        '>>>>>>> rival',
        'bottom',
        '',
      ].join('\n'),
    )
    expect(listConflictBlocks(next!)).toHaveLength(1)
  })

  it('둘째 블록을 가져온 것으로 — 첫 블록은 건드리지 않는다', () => {
    const next = applyBlockChoice(TWO_BLOCKS, 1, 'theirs')
    expect(next).toContain('theirs-2')
    expect(next).not.toContain('mine-2a')
    expect(next).toContain('mine-1')
    expect(next).toContain('<<<<<<< HEAD')
  })

  it('범위 밖 blockIndex는 null — 파일이 그새 바뀐 경합을 호출자가 알 수 있다', () => {
    expect(applyBlockChoice(TWO_BLOCKS, 2, 'ours')).toBeNull()
    expect(applyBlockChoice('plain\n', 0, 'ours')).toBeNull()
  })

  it('마지막 줄 개행 유무를 원본 그대로 보존한다', () => {
    const noNewline = '<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> rival'
    expect(applyBlockChoice(noNewline, 0, 'ours')).toBe('mine')
    expect(applyBlockChoice(`${noNewline}\n`, 0, 'ours')).toBe('mine\n')
  })

  it('고른 쪽이 비어 있고 파일 전체가 블록이면 빈 파일이 된다', () => {
    const emptySide = '<<<<<<< HEAD\n=======\ntheirs\n>>>>>>> rival\n'
    expect(applyBlockChoice(emptySide, 0, 'ours')).toBe('')
  })
})

describe('buildConflictView', () => {
  it('일반 줄과 블록 카드를 원본 순서대로 배치한다', () => {
    const items = buildConflictView(TWO_BLOCKS)
    expect(items.map((item) => item.type)).toEqual([
      'line',
      'block',
      'line',
      'line',
      'line',
      'block',
      'line',
    ])
    expect(items[0]).toEqual({ type: 'line', text: 'top' })
    const second = items[1]!
    expect(second.type).toBe('block')
    if (second.type === 'block') expect(second.block.ours).toEqual(['mine-1'])
  })

  it('마커 없는 파일은 전부 line이다', () => {
    expect(buildConflictView('a\nb\n')).toEqual([
      { type: 'line', text: 'a' },
      { type: 'line', text: 'b' },
    ])
  })
})
```

- [ ] **Step 2: 실패 확인 (Red 실증)**

Run: `npx vitest run apps/desktop/test/conflict-markers.test.ts`
Expected: FAIL — `does not provide an export named 'applyBlockChoice'` (모듈에 신규 export 없음)

- [ ] **Step 3: 구현**

`apps/desktop/src/renderer/src/components/conflict-markers.ts`의 `hasConflictMarkers` 함수 **뒤**에 추가:

```ts
/** 충돌 블록 하나 — 카드 렌더와 블록 선택(applyBlockChoice)의 단위 */
export interface ConflictBlock {
  /** 파일 안에서 몇 번째 블록인가 (0-based, 지금 남아 있는 블록 기준) */
  index: number
  /** `<<<<<<<` 줄의 원본 라인 위치 (0-based) */
  start: number
  /** `>>>>>>>` 줄의 원본 라인 위치 (0-based) */
  end: number
  /** 내 것(HEAD) 쪽 줄들 */
  ours: string[]
  /** 가져온 것 쪽 줄들 */
  theirs: string[]
}

/** split('\n') 전처리 — 마지막 개행 유무를 기억해 재조립 시 그대로 보존한다 */
function toLines(content: string): { lines: string[]; trailingNewline: boolean } {
  const trailingNewline = content.endsWith('\n')
  const lines = content.split('\n')
  if (trailingNewline) lines.pop()
  return { lines, trailingNewline }
}

/** 완결된 마커 3종 구간만 블록으로 센다 — parseConflictContent와 동일한 상태기계 순서 규칙 */
function findBlocks(lines: string[]): ConflictBlock[] {
  const blocks: ConflictBlock[] = []
  let zone: 'context' | 'ours' | 'theirs' = 'context'
  let start = 0
  let ours: string[] = []
  let theirs: string[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!
    if (zone === 'context' && line.startsWith('<<<<<<<')) {
      zone = 'ours'
      start = i
      ours = []
      theirs = []
      continue
    }
    if (zone === 'ours' && line.startsWith('=======')) {
      zone = 'theirs'
      continue
    }
    if (zone === 'theirs' && line.startsWith('>>>>>>>')) {
      blocks.push({ index: blocks.length, start, end: i, ours, theirs })
      zone = 'context'
      continue
    }
    if (zone === 'ours') ours.push(line)
    if (zone === 'theirs') theirs.push(line)
  }
  // EOF까지 닫히지 않은 마커는 블록이 아니다 — 확정 시 hasConflictMarkers 경고가 잡는다
  return blocks
}

/**
 * 충돌 블록 목록 — 완결된 `<<<<<<<`/`=======`/`>>>>>>>` 구간만 블록이다.
 * 순서가 꼬였거나 닫히지 않은 마커는 parseConflictContent와 같은 원칙으로 블록으로 세지 않는다.
 */
export function listConflictBlocks(content: string): ConflictBlock[] {
  return findBlocks(toLines(content).lines)
}

/**
 * blockIndex번째 블록을 한쪽으로 골라 마커 3줄 + 반대쪽을 제거한 새 내용을 만든다.
 * 범위 밖이면 null — 파일이 그새 바뀐 경합이니 호출자가 새로고침을 안내한다.
 * 마지막 줄 개행 유무는 원본 그대로 보존한다(toLines 왕복).
 */
export function applyBlockChoice(
  content: string,
  blockIndex: number,
  choice: 'ours' | 'theirs',
): string | null {
  const { lines, trailingNewline } = toLines(content)
  const block = findBlocks(lines)[blockIndex]
  if (block === undefined) return null
  const chosen = choice === 'ours' ? block.ours : block.theirs
  const next = [...lines.slice(0, block.start), ...chosen, ...lines.slice(block.end + 1)]
  // 파일 전체가 블록이고 고른 쪽이 비면 빈 파일 — ''.join 후 개행만 남는 것을 막는다
  if (next.length === 0) return ''
  return next.join('\n') + (trailingNewline ? '\n' : '')
}

/** 선택형 화면의 렌더 단위 — 일반 줄은 그대로, 블록 하나는 카드 하나(단일 가상 row) */
export type ConflictViewItem =
  | { type: 'line'; text: string }
  | { type: 'block'; block: ConflictBlock }

/** 파일 내용을 카드 뷰 아이템으로 — 블록 구간은 카드 하나로 접고 나머지 줄은 그대로 나열한다 */
export function buildConflictView(content: string): ConflictViewItem[] {
  const { lines } = toLines(content)
  const blocks = findBlocks(lines)
  const items: ConflictViewItem[] = []
  let cursor = 0
  for (const block of blocks) {
    for (let i = cursor; i < block.start; i += 1) items.push({ type: 'line', text: lines[i]! })
    items.push({ type: 'block', block })
    cursor = block.end + 1
  }
  for (let i = cursor; i < lines.length; i += 1) items.push({ type: 'line', text: lines[i]! })
  return items
}
```

- [ ] **Step 4: 통과 확인 + 게이트**

Run: `npx vitest run apps/desktop/test/conflict-markers.test.ts`
Expected: PASS (14 tests — 기존 4 + 신규 10)

Run: `pnpm test && pnpm typecheck`
Expected: **248 tests** PASS (238 + 10) + typecheck 전부 Done

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/components/conflict-markers.ts apps/desktop/test/conflict-markers.test.ts
git commit -m "feat(desktop): 충돌 블록 파서·컴포저 — listConflictBlocks·applyBlockChoice·buildConflictView

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 엔진 — conflicts.saveText(add 없는 쓰기)·conflicts.reset(처음부터 다시)

**Files:**
- Modify: `packages/git-adapter/src/client.ts`
- Test: `packages/git-adapter/test/client.test.ts`

- [ ] **Step 1: 실패하는 테스트 (Red)**

`packages/git-adapter/test/client.test.ts` 상단 import를 교체 — 기존:

```ts
import { mkdir, mkdtemp, symlink } from 'node:fs/promises'
```

교체:

```ts
import { mkdir, mkdtemp, symlink, unlink } from 'node:fs/promises'
```

`'conflicts.resolve — 충돌이 아닌 파일은 거부한다 (미저장 편집 덮어쓰기 차단)'` 테스트 **뒤**에 추가:

```ts
  it('conflicts.saveText — 겹침 파일에 add 없이 내용을 쓴다 (블록 선택 반영)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('rival', null)
    await client.branches.switch('rival')
    await writeFixtureFile(repo, 'README.md', '# rival\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'rival'], { cwd: repo })
    await client.branches.switch('main')
    await writeFixtureFile(repo, 'README.md', '# mine\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'mine'], { cwd: repo })
    await client.branches.merge('rival')

    await client.conflicts.saveText('README.md', '# mine\n')
    expect(await client.files.readText('README.md')).toBe('# mine\n')
    // add하지 않았다 — 여전히 충돌(unmerged)이어야 확정 전 전환 유지·복원이 성립한다
    const status = await client.repo.status()
    expect(status.changes.find((c) => c.path === 'README.md')?.unstaged).toBe('conflicted')
  })

  it('conflicts.saveText — 충돌이 아닌 파일은 거부한다 (조용한 유실 차단)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# precious edit\n')
    await expect(client.conflicts.saveText('README.md', '덮어쓰기')).rejects.toThrow(
      /충돌\) 상태가 아닌/,
    )
    expect(await client.files.readText('README.md')).toBe('# precious edit\n')
  })

  it('conflicts.saveText — 1MB 초과와 심볼릭 링크를 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('rival', null)
    await client.branches.switch('rival')
    await writeFixtureFile(repo, 'README.md', '# rival\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'rival'], { cwd: repo })
    await client.branches.switch('main')
    await writeFixtureFile(repo, 'README.md', '# mine\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'mine'], { cwd: repo })
    await client.branches.merge('rival')

    await expect(
      client.conflicts.saveText('README.md', 'x'.repeat(1_000_001)),
    ).rejects.toThrow(/너무 커요/)
    // 워크트리 파일을 링크로 바꿔치기해도(index는 여전히 UU) 링크 너머로 쓰지 않는다
    await unlink(join(repo, 'README.md'))
    await symlink('/etc/hosts', join(repo, 'README.md'))
    await expect(client.conflicts.saveText('README.md', '덮어쓰기')).rejects.toThrow(/링크 파일/)
  })

  it('conflicts.reset — 부분 해소를 버리고 겹침 표시를 되살린다 (index는 UU 유지)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('rival', null)
    await client.branches.switch('rival')
    await writeFixtureFile(repo, 'README.md', '# rival\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'rival'], { cwd: repo })
    await client.branches.switch('main')
    await writeFixtureFile(repo, 'README.md', '# mine\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'mine'], { cwd: repo })
    await client.branches.merge('rival')
    // 블록 선택을 흉내 — 마커 없이 한쪽으로 고쳐 쓴다 (add는 하지 않는다)
    await client.conflicts.saveText('README.md', '# mine\n')
    expect(await client.files.readText('README.md')).not.toContain('<<<<<<<')

    await client.conflicts.reset('README.md')
    // 실측: 라벨은 ours/theirs로 재생성된다 — 접두사(<<<<<<<) 기준으로 확인한다
    expect(await client.files.readText('README.md')).toContain('<<<<<<<')
    const status = await client.repo.status()
    expect(status.changes.find((c) => c.path === 'README.md')?.unstaged).toBe('conflicted')
  })

  it('conflicts.reset — 충돌이 아닌 파일은 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# precious edit\n')
    await expect(client.conflicts.reset('README.md')).rejects.toThrow(/충돌\) 상태가 아닌/)
    expect(await client.files.readText('README.md')).toBe('# precious edit\n')
  })
```

- [ ] **Step 2: 실패 확인 (Red 실증)**

Run: `npx vitest run packages/git-adapter/test/client.test.ts --testNamePattern "saveText|conflicts.reset"`
Expected: 5 FAIL — `client.conflicts.saveText is not a function` / `client.conflicts.reset is not a function`

- [ ] **Step 3: 구현**

`packages/git-adapter/src/client.ts` 수정:

(a) fs import 행을 교체 — 기존:

```ts
import { lstat, readFile } from 'node:fs/promises'
```

교체:

```ts
import { lstat, readFile, writeFile } from 'node:fs/promises'
```

(b) `GitClient` 인터페이스 conflicts 블록의 `markResolved(path: string): Promise<void>` 행 **뒤**에 추가:

```ts
    /**
     * 충돌 파일의 워크트리 내용을 통째로 바꾼다(블록 선택·자세히 보기 저장) — add하지 않는다.
     * 확정은 markResolved가 담당한다. 비충돌 파일은 resolve와 동일 문구로 거부한다(조용한 유실 차단)
     */
    saveText(path: string, content: string): Promise<void>
    /** 처음부터 다시 — 부분 해소를 버리고 겹침 표시를 되살린다(git checkout -m). index는 UU 그대로다 */
    reset(path: string): Promise<void>
```

(c) 구현부 conflicts 블록의 `markResolved` 구현 **뒤**에 추가:

```ts
      async saveText(path, content) {
        const cwd = await topLevel()
        assertRepoRelative(path)
        // resolve와 동일 가드·동일 문구 — 비충돌 파일 쓰기는 미저장 편집의 조용한 유실 경로다
        const unmerged = await execGitOrThrow(['ls-files', '-u', '--', `:(literal)${path}`], { cwd })
        if (unmerged.stdout.trim() === '') {
          throw new Error('지금은 겹침(충돌) 상태가 아닌 파일이에요. 새로고침 후 다시 확인해 주세요.')
        }
        // readText와 대칭 상한 — 이보다 큰 파일은 애초에 뷰로 열리지 않는다 (심층 방어)
        if (Buffer.byteLength(content, 'utf8') > 1_000_000) {
          throw new Error('파일이 너무 커요. 외부 편집기로 열어 주세요.')
        }
        const filePath = join(cwd, path)
        // 심볼릭 링크는 저장소 밖에 쓸 수 있다 — readText와 동일하게 거부.
        // 파일이 없으면(삭제형 충돌) 새로 만드는 것이 맞으니 lstat 실패는 통과시킨다
        const stats = await lstat(filePath).catch(() => null)
        if (stats !== null && stats.isSymbolicLink()) {
          throw new Error('링크 파일이라 내용을 저장할 수 없어요.')
        }
        await writeFile(filePath, content, 'utf8')
      },
      async reset(path) {
        const cwd = await topLevel()
        assertRepoRelative(path)
        const unmerged = await execGitOrThrow(['ls-files', '-u', '--', `:(literal)${path}`], { cwd })
        if (unmerged.stdout.trim() === '') {
          throw new Error('지금은 겹침(충돌) 상태가 아닌 파일이에요. 새로고침 후 다시 확인해 주세요.')
        }
        // 실측: 부분 해소(일부 블록만 고쳐 쓴) 상태에서도 exit 0으로 전체 마커를 재생성한다.
        // 라벨은 브랜치명 대신 ours/theirs로 바뀌지만 파서는 접두사 기반이라 무관. index는 UU 유지
        await execGitOrThrow(['checkout', '-m', '--', `:(literal)${path}`], { cwd })
      },
```

- [ ] **Step 4: 통과 확인 + 게이트**

Run: `pnpm test && pnpm typecheck`
Expected: **253 tests** PASS (248 + 5) + typecheck 전부 Done

- [ ] **Step 5: Commit**

```bash
git add packages/git-adapter/src/client.ts packages/git-adapter/test/client.test.ts
git commit -m "feat(adapter): conflicts.saveText·reset — add 없는 부분 반영과 겹침 표시 되살리기

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: IPC — conflicts:save-text·conflicts:reset 채널

**Files:**
- Modify: `packages/ipc-contract/src/index.ts`, `apps/desktop/src/main/git-handlers.ts`, `apps/desktop/src/preload/index.ts`

- [ ] **Step 1: contract**

(a) `packages/ipc-contract/src/index.ts`의 `GitApi` conflicts 블록에 `markResolved(repoPath: string, path: string): Promise<void>` 행 **뒤**로 추가:

```ts
    /** 충돌 파일 내용 통째 저장(블록 선택·자세히 보기 직접 수정) — add하지 않는다. 비충돌 파일은 거부된다 */
    saveText(repoPath: string, path: string, content: string): Promise<void>
    /** 처음부터 다시 — 겹침 표시를 되살린다(checkout -m) */
    reset(repoPath: string, path: string): Promise<void>
```

(b) `CHANNELS`의 `conflictsMarkResolved: 'conflicts:mark-resolved',` 행 **뒤**에 추가:

```ts
  conflictsSaveText: 'conflicts:save-text',
  conflictsReset: 'conflicts:reset',
```

- [ ] **Step 2: main 핸들러**

`apps/desktop/src/main/git-handlers.ts`의 `CHANNELS.conflictsMarkResolved` 핸들러 **뒤**에 추가 (기존 unknown 검증 관례 — assertString):

```ts
  ipcMain.handle(
    CHANNELS.conflictsSaveText,
    (_event, repoPath: unknown, path: unknown, content: unknown) =>
      createGitClient(assertAllowedRepo(repoPath)).conflicts.saveText(
        assertString(path),
        assertString(content),
      ),
  )

  ipcMain.handle(CHANNELS.conflictsReset, (_event, repoPath: unknown, path: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).conflicts.reset(assertString(path)),
  )
```

- [ ] **Step 3: preload**

`apps/desktop/src/preload/index.ts`의 conflicts 블록에서 `markResolved:` 항목 **뒤**에 추가:

```ts
    saveText: (repoPath, path, content) =>
      ipcRenderer.invoke(CHANNELS.conflictsSaveText, repoPath, path, content),
    reset: (repoPath, path) => ipcRenderer.invoke(CHANNELS.conflictsReset, repoPath, path),
```

- [ ] **Step 4: 게이트 + Commit**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build`
Expected: 253 tests + typecheck 전부 Done + build 성공

```bash
git add packages/ipc-contract/src/index.ts apps/desktop/src/main/git-handlers.ts apps/desktop/src/preload/index.ts
git commit -m "feat(ipc): conflicts:save-text·conflicts:reset 채널

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: store — chooseConflictBlock·saveConflictText·resetConflict

**Files:**
- Modify: `apps/desktop/src/renderer/src/store/repository-store.ts`

- [ ] **Step 1: import**

`import { create } from 'zustand'` 아래의 `@git-gui/domain` import 블록(닫는 `} from '@git-gui/domain'` 행) **뒤**에 추가:

```ts
import { applyBlockChoice } from '../components/conflict-markers'
```

- [ ] **Step 2: 인터페이스**

`RepositoryStore` 인터페이스의 `markConflictResolved(path: string): Promise<void>` 행 **뒤**에 추가:

```ts
  /** 열린 겹침 파일의 blockIndex번째 블록만 한쪽으로 골라 파일에 즉시 반영한다 — 확정(add) 아님 */
  chooseConflictBlock(blockIndex: number, choice: 'ours' | 'theirs'): Promise<void>
  /** 자세히 보기에서 직접 수정한 결과를 파일에 저장한다 — 확정(add) 아님 */
  saveConflictText(content: string): Promise<void>
  /** 처음부터 다시 — 겹침 표시를 되살린다(checkout -m). 확인창(UI 책임) 경유 */
  resetConflict(): Promise<void>
```

- [ ] **Step 3: 구현**

`markConflictResolved` 구현 **뒤**에 추가. 셋 다 guard로 직렬화되고, **fetchSnapshot(CLEAR_SELECTIONS)을 쓰지 않는다** — 스냅샷 갱신은 충돌 뷰를 닫아 버리므로, 열려 있는 conflictFile은 유지한 채 status만 재조회한다:

```ts
  async chooseConflictBlock(blockIndex, choice) {
    const { repoPath, conflictFile } = get()
    if (!repoPath || !conflictFile) return
    await guard(set, get, async () => {
      // 외부 편집과의 경합 — 열 때 읽어 둔 내용이 아니라 최신 내용에 적용한다
      const fresh = await git().files.readText(repoPath, conflictFile.path)
      const next = applyBlockChoice(fresh, blockIndex, choice)
      if (next === null) {
        // 그 블록이 더는 없다 — 최신 내용을 보여 주고 다시 고르게 안내한다
        set({
          conflictFile: { path: conflictFile.path, content: fresh },
          notice: '파일이 밖에서 바뀌어 겹침 목록을 새로 불러왔어요. 다시 골라 주세요.',
        })
        return
      }
      await git().conflicts.saveText(repoPath, conflictFile.path, next)
      // 충돌 뷰는 연 채로 내용·상태만 갱신한다 — CLEAR_SELECTIONS를 쓰면 뷰가 닫힌다
      set({
        conflictFile: { path: conflictFile.path, content: next },
        status: await git().repo.status(repoPath),
      })
    })
  },

  async saveConflictText(content) {
    const { repoPath, conflictFile } = get()
    if (!repoPath || !conflictFile) return
    await guard(set, get, async () => {
      await git().conflicts.saveText(repoPath, conflictFile.path, content)
      set({
        conflictFile: { path: conflictFile.path, content },
        status: await git().repo.status(repoPath),
      })
    })
  },

  async resetConflict() {
    const { repoPath, conflictFile } = get()
    if (!repoPath || !conflictFile) return
    await guard(set, get, async () => {
      await git().conflicts.reset(repoPath, conflictFile.path)
      const content = await git().files.readText(repoPath, conflictFile.path)
      set({
        conflictFile: { path: conflictFile.path, content },
        status: await git().repo.status(repoPath),
      })
    })
  },
```

- [ ] **Step 4: 게이트 + Commit**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build`
Expected: 253 tests + typecheck 전부 Done + build 성공

```bash
git add apps/desktop/src/renderer/src/store/repository-store.ts
git commit -m "feat(desktop): store — 블록 선택·직접 수정 저장·처음부터 다시 (확정 없는 부분 반영)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: UI — ConflictPanel 카드 선택형·자세히 보기·고른 대로 확정 + App 배선

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/ConflictPanel.tsx` (전면 교체), `apps/desktop/src/renderer/src/components/conflict-panel.css` (전면 교체), `apps/desktop/src/renderer/src/App.tsx`

설계 요점:
- **가상화 절충**: 블록 하나 = 카드 하나 = 단일 가상 row. `buildConflictView`가 일반 줄과 카드를 섞은 아이템 배열을 만들고, `estimateSize`는 아이템 종류별(줄 21px / 카드 132px)로 추정하며 `measureElement`가 실제 높이를 측정한다 — 5000줄 성능 유지.
- **진행 표시**: 분모(총 N곳)는 파일을 연 시점의 블록 수를 state로 잡고, "처음부터 다시"·외부 편집으로 블록이 늘면 렌더 중 보정한다(React의 render-time state 조정 패턴). M = 해소된 수 + 1.
- **파일 전체 3종 버튼(내 것 유지·가져온 것 사용·직접 수정했어요)과 다음 겹침은 유지**(빠른 길, 기존 E2E testId 불변). "고른 대로 확정"은 기존 markResolved 흐름(onReload 최신 검사 → hasConflictMarkers 경고)을 그대로 재사용한다.
- **자세히 보기 진입 시에도 onReload로 최신 내용을 읽어** 편집 시작점을 잡는다(외부 편집 경합 — "직접 수정했어요"와 동일 원칙).

- [ ] **Step 1: ConflictPanel.tsx 전면 교체**

`apps/desktop/src/renderer/src/components/ConflictPanel.tsx` 전체를 다음으로 교체:

```tsx
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, Check, CheckCheck, Download, PenLine, RotateCcw, User } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Panel } from '../ui/Panel'
import { buildConflictView, hasConflictMarkers } from './conflict-markers'
import './conflict-panel.css'
import './virtual.css'

interface ConflictPanelProps {
  path: string
  content: string
  busy: boolean
  /** 어느 흐름의 충돌인가 — merge는 "가져온 것", revert는 "되돌린 결과물"로 문구를 분기한다 (품질 리뷰) */
  mode: 'merging' | 'reverting'
  /** 파일 전체 한쪽 확정 — ours=내 것 유지, theirs=가져온 것 사용 (빠른 길) */
  onResolve(choice: 'ours' | 'theirs'): void
  /** 확정(git add) — "고른 대로 확정"과 "직접 수정했어요"가 공유한다. 마커가 남아 있으면 확인창을 거친다 */
  onMarkResolved(): void
  /** 최신 파일 내용 재조회 — 외부 편집 후의 stale 검사(거짓 경고)를 막는다. 실패 시 null */
  onReload(): Promise<string | null>
  /** 블록 하나를 한쪽으로 — 파일에 즉시 반영된다(확정 아님, add하지 않는다) */
  onChooseBlock(blockIndex: number, choice: 'ours' | 'theirs'): void
  /** 자세히 보기에서 직접 수정한 결과 저장(확정 아님) */
  onSaveText(content: string): void
  /** 처음부터 다시 — 겹침 표시를 되살린다(checkout -m). 확인창은 이 컴포넌트가 담당한다 */
  onReset(): void
}

/**
 * 충돌 해결 화면 (스펙 §7 2단 구조) — 기본은 하나씩 선택형: 겹침 블록마다 카드로
 * 양쪽을 나란히 보여 주고 한쪽을 고르면 파일에 즉시 반영된다(확정은 "고른 대로 확정"에서만).
 * "자세히 보기"는 합쳐진 결과(남은 마커 포함)를 직접 수정하는 상세 뷰의 단순화 버전이다.
 * 초록 = 내 것(HEAD), 보라 = 가져온 것(revert에서는 되돌린 결과물).
 */
export function ConflictPanel({
  path,
  content,
  busy,
  mode,
  onResolve,
  onMarkResolved,
  onReload,
  onChooseBlock,
  onSaveText,
  onReset,
}: ConflictPanelProps) {
  const takenLabel = mode === 'reverting' ? '되돌린 결과물' : '가져온 것'
  const [confirmingMark, setConfirmingMark] = useState(false)
  const [confirmingReset, setConfirmingReset] = useState(false)
  const [view, setView] = useState<'cards' | 'edit'>('cards')
  const [draft, setDraft] = useState('')
  const items = buildConflictView(content)
  // 블록 카드의 아이템 위치 — "다음 겹침" 순환 점프·선택 후 자동 스크롤에 쓴다
  const blockItemIndexes = items.reduce<number[]>((acc, item, index) => {
    if (item.type === 'block') acc.push(index)
    return acc
  }, [])
  const blockCount = blockItemIndexes.length
  // 진행 표시 분모 — 연 시점의 블록 수. "처음부터 다시"·외부 편집으로 늘면 렌더 중 보정한다
  const [total, setTotal] = useState(blockCount)
  if (blockCount > total) setTotal(blockCount)
  const done = total - blockCount
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    // 카드(블록)는 줄보다 크게 추정한다 — 실제 높이는 measureElement가 잡는다
    estimateSize: (index) => (items[index]!.type === 'block' ? 132 : 21),
    overscan: 20,
  })
  const [jumpCursor, setJumpCursor] = useState(0)
  const jumpNext = () => {
    if (blockItemIndexes.length === 0) return
    virtualizer.scrollToIndex(blockItemIndexes[jumpCursor % blockItemIndexes.length]!, {
      align: 'center',
    })
    setJumpCursor(jumpCursor + 1)
  }
  // 블록을 고르면 반영된 내용이 prop으로 돌아온 뒤 첫 미해결 블록으로 스크롤한다
  const pendingScrollRef = useRef(false)
  const chooseBlock = (blockIndex: number, choice: 'ours' | 'theirs') => {
    pendingScrollRef.current = true
    onChooseBlock(blockIndex, choice)
  }
  useEffect(() => {
    if (!pendingScrollRef.current) return
    pendingScrollRef.current = false
    const nextIndex = items.findIndex((item) => item.type === 'block')
    if (nextIndex >= 0) virtualizer.scrollToIndex(nextIndex, { align: 'center' })
    // 선택이 반영된 content 변화 시점에만 — items·virtualizer는 content에서 파생된다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content])
  const markResolved = () => {
    void (async () => {
      // 외부 편집기에서 마커를 지웠을 수 있다 — 열 때 읽은 내용이 아니라 최신 내용으로 검사한다 (거짓 경고 방지)
      const fresh = await onReload()
      if (fresh === null) return
      if (hasConflictMarkers(fresh)) setConfirmingMark(true)
      else onMarkResolved()
    })()
  }
  const openDetail = () => {
    void (async () => {
      // 외부 편집이 있었을 수 있다 — 최신 내용으로 편집을 시작한다 (markResolved와 동일 원칙)
      const fresh = await onReload()
      if (fresh === null) return
      setDraft(fresh)
      setView('edit')
    })()
  }

  return (
    <Panel
      title={`${path} — 겹침 해결`}
      accessory={<Badge tone="git">conflict</Badge>}
      testId="conflict-panel"
    >
      {view === 'cards' ? (
        <>
          <p className="conflict-panel__hint">
            두 버전이 같은 곳을 다르게 고쳤어요. 겹침마다 카드에서 한쪽을 골라 주세요 — 초록이{' '}
            <strong>내 것</strong>, 보라가 <strong>{takenLabel}</strong>이에요. 고르면 파일에 바로
            반영되지만, "고른 대로 확정"을 누르기 전에는 아무것도 확정되지 않아요. 선택하지 않은
            쪽도 사라지지 않고 저장된 역사에 남아 있어요.
          </p>
          {/* 해결 버튼은 헤더가 아니라 전용 줄에 — 좁은 폭에서도 잘리지 않고 줄바꿈된다 (리뷰 실측) */}
          <div className="conflict-panel__actions">
            {blockCount > 0 ? (
              <span className="conflict-panel__progress" data-testid="conflict-progress">
                겹침 {total}곳 중 {done + 1}번째
              </span>
            ) : (
              <span
                className="conflict-panel__progress conflict-panel__progress--done"
                data-testid="conflict-progress"
              >
                모두 골랐어요
              </span>
            )}
            {blockCount === 0 && (
              <Button
                variant="primary"
                size="sm"
                isDisabled={busy}
                onPress={markResolved}
                testId="conflict-confirm"
              >
                <CheckCheck size={13} aria-hidden="true" /> 고른 대로 확정
              </Button>
            )}
            <Button
              variant="neutral"
              className="conflict-panel__btn--mine"
              size="sm"
              isDisabled={busy}
              onPress={() => onResolve('ours')}
              testId="conflict-ours"
            >
              <User size={13} aria-hidden="true" /> 내 것 유지
            </Button>
            <Button
              variant="neutral"
              className="conflict-panel__btn--branch"
              size="sm"
              isDisabled={busy}
              onPress={() => onResolve('theirs')}
              testId="conflict-theirs"
            >
              <Download size={13} aria-hidden="true" /> {takenLabel} 사용
            </Button>
            <Button
              variant="ghost"
              size="sm"
              isDisabled={busy}
              onPress={markResolved}
              testId="conflict-mark"
            >
              <Check size={13} aria-hidden="true" /> 직접 수정했어요
            </Button>
            <Button
              variant="ghost"
              size="sm"
              isDisabled={busy || blockCount === 0}
              onPress={jumpNext}
              testId="conflict-next"
            >
              <ArrowDown size={13} aria-hidden="true" /> 다음 겹침 ({blockCount})
            </Button>
            <Button
              variant="ghost"
              size="sm"
              isDisabled={busy}
              onPress={openDetail}
              testId="conflict-detail-toggle"
            >
              <PenLine size={13} aria-hidden="true" /> 자세히 보기
            </Button>
            <Button
              variant="ghost"
              size="sm"
              isDisabled={busy}
              onPress={() => setConfirmingReset(true)}
              testId="conflict-reset"
            >
              <RotateCcw size={13} aria-hidden="true" /> 처음부터 다시
            </Button>
          </div>
          <div ref={scrollRef} className="virtual-scroll" data-testid="conflict-view">
            <div
              className="conflict-panel__code"
              style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
            >
              {virtualizer.getVirtualItems().map((virtualItem) => {
                const item = items[virtualItem.index]!
                return (
                  <div
                    key={virtualItem.index}
                    ref={virtualizer.measureElement}
                    data-index={virtualItem.index}
                    className="virtual-row"
                    style={{ transform: `translateY(${virtualItem.start}px)` }}
                  >
                    {item.type === 'line' ? (
                      <div className="conflict-line conflict-line--context">
                        <span className="conflict-line__text">{item.text || ' '}</span>
                      </div>
                    ) : (
                      <div className="conflict-card" data-testid={`conflict-card-${item.block.index}`}>
                        <p className="conflict-card__title">
                          {done + item.block.index + 1}번째 겹침 — 어느 쪽을 쓸까요?
                        </p>
                        <div className="conflict-card__sides">
                          <div className="conflict-card__side conflict-card__side--mine">
                            <span className="conflict-card__side-label">
                              <User size={12} aria-hidden="true" /> 내 것
                            </span>
                            <pre className="conflict-card__code">
                              {item.block.ours.join('\n') || '(비어 있음)'}
                            </pre>
                            <Button
                              variant="neutral"
                              className="conflict-panel__btn--mine"
                              size="sm"
                              isDisabled={busy}
                              onPress={() => chooseBlock(item.block.index, 'ours')}
                              testId={`conflict-block-ours-${item.block.index}`}
                            >
                              이쪽 사용
                            </Button>
                          </div>
                          <div className="conflict-card__side conflict-card__side--branch">
                            <span className="conflict-card__side-label">
                              <Download size={12} aria-hidden="true" /> {takenLabel}
                            </span>
                            <pre className="conflict-card__code">
                              {item.block.theirs.join('\n') || '(비어 있음)'}
                            </pre>
                            <Button
                              variant="neutral"
                              className="conflict-panel__btn--branch"
                              size="sm"
                              isDisabled={busy}
                              onPress={() => chooseBlock(item.block.index, 'theirs')}
                              testId={`conflict-block-theirs-${item.block.index}`}
                            >
                              이쪽 사용
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </>
      ) : (
        <>
          <p className="conflict-panel__hint">
            합쳐진 결과를 직접 고칠 수 있어요. 남은 겹침 표시(&lt;&lt;&lt;&lt;&lt;&lt;&lt;)도
            그대로 보여요 — 표시 줄까지 지우고 원하는 내용만 남긴 뒤 저장해 주세요. 저장해도 확정은
            아니에요.
          </p>
          <div className="conflict-panel__actions">
            <Button
              variant="primary"
              size="sm"
              isDisabled={busy}
              onPress={() => {
                onSaveText(draft)
                setView('cards')
              }}
              testId="conflict-edit-save"
            >
              <Check size={13} aria-hidden="true" /> 저장하고 선택형으로
            </Button>
            <Button
              variant="ghost"
              size="sm"
              isDisabled={busy}
              onPress={() => setView('cards')}
              testId="conflict-edit-cancel"
            >
              저장 없이 돌아가기
            </Button>
          </div>
          <textarea
            className="conflict-panel__editor"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
            aria-label="합쳐진 결과 직접 수정"
            data-testid="conflict-edit-text"
          />
        </>
      )}
      <ConfirmDialog
        isOpen={confirmingMark}
        title="겹침 표시가 아직 남아 있어요"
        confirmLabel="그래도 표시"
        onConfirm={() => {
          setConfirmingMark(false)
          onMarkResolved()
        }}
        onCancel={() => setConfirmingMark(false)}
      >
        파일에 겹침 표시(&lt;&lt;&lt;&lt;&lt;&lt;&lt;)가 그대로 있어요. 이대로 해결 표시하면 표시
        줄까지 저장돼요. 편집기에서 정리한 뒤 다시 시도하는 것을 권해요.
      </ConfirmDialog>
      <ConfirmDialog
        isOpen={confirmingReset}
        title="처음부터 다시 고를까요?"
        confirmLabel="처음부터 다시"
        onConfirm={() => {
          setConfirmingReset(false)
          onReset()
        }}
        onCancel={() => setConfirmingReset(false)}
      >
        이 파일에서 지금까지 고른 것을 버리고 겹침 표시(&lt;&lt;&lt;&lt;&lt;&lt;&lt;)를 되살려요.
        저장된 역사와 다른 파일은 그대로예요.
      </ConfirmDialog>
    </Panel>
  )
}
```

- [ ] **Step 2: conflict-panel.css 전면 교체**

`apps/desktop/src/renderer/src/components/conflict-panel.css` 전체를 다음으로 교체 (파일 단위 뷰 전용이던 `conflict-line--ours/theirs/marker-*` 규칙은 카드 뷰에서 렌더되지 않아 제거한다):

```css
.conflict-panel__hint {
  margin: 0;
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  border-bottom: 1px solid var(--color-border);
  line-height: 1.7;
}
/* 좁은 폭에서 버튼이 잘리는 대신 줄바꿈된다 */
.conflict-panel__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  border-bottom: 1px solid var(--color-border);
}
/* 진행 표시 — 스펙 §7 "N곳 중 M번째". 다 고르면 개념색이 초록(내 작업 완료 톤)으로 */
.conflict-panel__progress {
  font-size: var(--text-xs);
  font-weight: 700;
  color: var(--concept-conflict);
  white-space: nowrap;
}
.conflict-panel__progress--done {
  color: var(--concept-mine);
}
.conflict-panel__code {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 1.7;
}
.conflict-line {
  display: flex;
}
.conflict-line__text {
  flex: 1;
  min-width: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  padding: 0 var(--space-4);
}
/* 겹침 카드 — 블록 하나가 단일 가상 row. 양쪽을 나란히 보여 주고 각자 "이쪽 사용" */
.conflict-card {
  margin: var(--space-2) var(--space-4);
  border: 1px solid var(--concept-conflict);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  padding: var(--space-2) var(--space-3) var(--space-3);
  font-family: inherit;
}
.conflict-card__title {
  margin: 0 0 var(--space-2);
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--color-text-muted);
}
.conflict-card__sides {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-2);
}
/* 좁은 폭에서는 위아래로 쌓인다 — 코드가 잘리는 것보다 낫다 */
@media (max-width: 960px) {
  .conflict-card__sides {
    grid-template-columns: 1fr;
  }
}
.conflict-card__side {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-1);
  border-radius: var(--radius-sm);
  padding: var(--space-2);
}
/* 초록 = 내 것(mine), 보라 = 가져온 것(branch) — 앱 전체의 개념 색과 일치 (스펙 10장) */
.conflict-card__side--mine {
  background: var(--concept-mine-bg);
}
.conflict-card__side--branch {
  background: var(--concept-branch-bg);
}
.conflict-card__side-label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-xs);
  font-weight: 700;
}
.conflict-card__side--mine .conflict-card__side-label {
  color: var(--concept-mine);
}
.conflict-card__side--branch .conflict-card__side-label {
  color: var(--concept-branch);
}
.conflict-card__code {
  margin: 0;
  align-self: stretch;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 200px;
  overflow-y: auto;
}
/* 버튼과 구간 색을 연결한다 — 초록=내 것, 보라=가져온 것 (스펙 개념색) */
.conflict-panel__btn--mine {
  border-color: var(--concept-mine);
  color: var(--concept-mine);
}
.conflict-panel__btn--branch {
  border-color: var(--concept-branch);
  color: var(--concept-branch);
}
/* 자세히 보기 — 합쳐진 결과를 그대로 편집한다. 패널 잔여 높이를 차지한다
   (panel body 자식의 flex:none은 :where 특이도 0이라 이 클래스가 이긴다) */
.conflict-panel__editor {
  flex: 1 1 auto;
  min-height: 0;
  margin: var(--space-2) var(--space-4) var(--space-4);
  padding: var(--space-2) var(--space-3);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 1.7;
  color: var(--color-text);
  background: var(--color-surface-sunken);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  resize: none;
  white-space: pre;
  overflow: auto;
}
```

- [ ] **Step 3: App.tsx 배선**

`apps/desktop/src/renderer/src/App.tsx`의 `<ConflictPanel …/>` 블록을 교체 — 기존:

```tsx
            <ConflictPanel
              key={store.conflictFile.path}
              path={store.conflictFile.path}
              content={store.conflictFile.content}
              busy={store.busy}
              mode={status?.state === 'reverting' ? 'reverting' : 'merging'}
              onResolve={(choice) => void store.resolveConflict(store.conflictFile!.path, choice)}
              onMarkResolved={() => void store.markConflictResolved(store.conflictFile!.path)}
              onReload={() => store.reloadConflict(store.conflictFile!.path)}
            />
```

교체:

```tsx
            <ConflictPanel
              key={store.conflictFile.path}
              path={store.conflictFile.path}
              content={store.conflictFile.content}
              busy={store.busy}
              mode={status?.state === 'reverting' ? 'reverting' : 'merging'}
              onResolve={(choice) => void store.resolveConflict(store.conflictFile!.path, choice)}
              onMarkResolved={() => void store.markConflictResolved(store.conflictFile!.path)}
              onReload={() => store.reloadConflict(store.conflictFile!.path)}
              onChooseBlock={(blockIndex, choice) =>
                void store.chooseConflictBlock(blockIndex, choice)
              }
              onSaveText={(content) => void store.saveConflictText(content)}
              onReset={() => void store.resetConflict()}
            />
```

참고: 기존 `<ConflictPanel key={store.conflictFile.path} …>`가 App.tsx에 이미 있으므로(E1d 시점 코드) 위 "기존" 블록과 byte 일치해야 한다. 어긋나면 실제 파일을 읽고 신규 3 props만 추가한다. abort(그만두고 원래대로)는 기존대로 **머지 바가 상주하며 담당**한다 — 스펙 "항상 보임" 충족, 이 태스크에서 건드리지 않는다.

- [ ] **Step 4: 게이트 (기존 E2E 회귀 없음 확인)**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build && (cd apps/desktop && pnpm e2e)`
Expected: 253 tests + typecheck 전부 Done + build + **E2E 25 passed** — 기존 충돌 E2E(conflict-ours/theirs/mark, conflict-view 내용 단언)가 카드 뷰에서도 그대로 통과한다 (testId 불변, 카드 pre에 양쪽 내용이 렌더된다)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/components/ConflictPanel.tsx apps/desktop/src/renderer/src/components/conflict-panel.css apps/desktop/src/renderer/src/App.tsx
git commit -m "feat(desktop): ConflictPanel 카드 선택형 — 진행 표시·자세히 보기·처음부터 다시·고른 대로 확정

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: E2E — 블록 선택 완주·E-004·재시작 복원·처음부터 다시

**Files:**
- Test: `apps/desktop/e2e/smoke.spec.ts`

- [ ] **Step 1: import·픽스처 헬퍼**

`apps/desktop/e2e/smoke.spec.ts`의 첫 import 행을 교체 — 기존:

```ts
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
```

교체:

```ts
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
```

`addBareRemote` 함수 **뒤**에 추가:

```ts
/**
 * 겹침 블록 2개짜리 충돌 픽스처 — 떨어진 두 변경(사이 context 5줄)이어야 블록이 2개 생긴다.
 * 인접한 변경은 git이 한 블록으로 합쳐 버린다(실측). 합치기 실행은 각 테스트가 앱에서 한다.
 */
async function createTwoBlockConflictRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'git-gui-e2e-'))
  await execGitOrThrow(['init', '--initial-branch=main'], { cwd: dir })
  await execGitOrThrow(['config', 'user.name', 'E2E'], { cwd: dir })
  await execGitOrThrow(['config', 'user.email', 'e2e@test.local'], { cwd: dir })
  await writeFile(join(dir, 'app.txt'), 'one\ntwo\nthree\nfour\nfive\nsix\nseven\n')
  await execGitOrThrow(['add', '-A'], { cwd: dir })
  await execGitOrThrow(['commit', '-m', 'init'], { cwd: dir })
  await execGitOrThrow(['checkout', '-b', 'rival'], { cwd: dir })
  await writeFile(join(dir, 'app.txt'), 'rival-top\ntwo\nthree\nfour\nfive\nsix\nrival-bottom\n')
  await execGitOrThrow(['commit', '-am', 'rival'], { cwd: dir })
  await execGitOrThrow(['checkout', 'main'], { cwd: dir })
  await writeFile(join(dir, 'app.txt'), 'mine-top\ntwo\nthree\nfour\nfive\nsix\nmine-bottom\n')
  await execGitOrThrow(['commit', '-am', 'mine'], { cwd: dir })
  return dir
}
```

- [ ] **Step 2: E2E 4개 추가** (`smoke.spec.ts` 끝)

```ts
test('겹침 두 곳을 카드에서 하나씩 골라 확정하고 저장하기로 마무리한다', async () => {
  const repo = await createTwoBlockConflictRepo()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('merge-open').click()
    await window.getByTestId('list-option-rival').click()
    await expect(window.getByTestId('merge-bar')).toContainText('겹침 1개 남음')
    await window.getByTestId('file-unstaged-app.txt').click()
    await expect(window.getByTestId('conflict-progress')).toHaveText('겹침 2곳 중 1번째')
    // 1번째 겹침은 내 것 — 반영되면 남은 블록이 파일 기준 다시 0번이 된다
    await window.getByTestId('conflict-block-ours-0').click()
    await expect(window.getByTestId('conflict-progress')).toHaveText('겹침 2곳 중 2번째')
    await window.getByTestId('conflict-block-theirs-0').click()
    await expect(window.getByTestId('conflict-progress')).toHaveText('모두 골랐어요')
    // 확정 전에는 여전히 겹침(unmerged) 파일이다 — add는 확정 버튼에서만
    await expect(window.getByTestId('merge-bar')).toContainText('겹침 1개 남음')
    await window.getByTestId('conflict-confirm').click()
    await expect(window.getByTestId('merge-bar')).toContainText('겹침 0개 남음')
    await expect(window.getByTestId('staged-count')).toHaveText('1')
    // 저장하기 = 병합 마무리 (부모 2)
    await window.getByTestId('commit-message').fill('겹침 정리해서 합치기')
    await window.getByTestId('commit-button').click()
    await expect(window.getByTestId('merge-bar')).toHaveCount(0)
    expect(await readFile(join(repo, 'app.txt'), 'utf8')).toBe(
      'mine-top\ntwo\nthree\nfour\nfive\nsix\nrival-bottom\n',
    )
    const parents = await execGitOrThrow(['log', '-1', '--format=%P'], { cwd: repo })
    expect(parents.stdout.trim().split(' ')).toHaveLength(2)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('선택형 일부 선택 → 자세히 보기 직접 수정 → 선택 유지 (E-004)', async () => {
  const repo = await createTwoBlockConflictRepo()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('merge-open').click()
    await window.getByTestId('list-option-rival').click()
    await window.getByTestId('file-unstaged-app.txt').click()
    await window.getByTestId('conflict-block-ours-0').click()
    await expect(window.getByTestId('conflict-progress')).toHaveText('겹침 2곳 중 2번째')
    await window.getByTestId('conflict-detail-toggle').click()
    // 선택형에서 고른 것이 결과에 유지된 채로 열린다 — 남은 겹침 표시도 그대로 (E-004)
    await expect(window.getByTestId('conflict-edit-text')).toHaveValue(/mine-top/)
    await expect(window.getByTestId('conflict-edit-text')).toHaveValue(/<<<<<<</)
    await window
      .getByTestId('conflict-edit-text')
      .fill('mine-top\ntwo\nthree\nfour\nfive\nsix\nhand-merged\n')
    await window.getByTestId('conflict-edit-save').click()
    // 선택형으로 복귀 — 직접 수정이 반영되어 남은 겹침이 없다
    await expect(window.getByTestId('conflict-progress')).toHaveText('모두 골랐어요')
    await expect(window.getByTestId('conflict-view')).toContainText('hand-merged')
    await window.getByTestId('conflict-confirm').click()
    await expect(window.getByTestId('staged-count')).toHaveText('1')
    expect(await readFile(join(repo, 'app.txt'), 'utf8')).toBe(
      'mine-top\ntwo\nthree\nfour\nfive\nsix\nhand-merged\n',
    )
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('일부만 고르고 재시작해도 고른 결과와 남은 겹침이 복원된다', async () => {
  const repo = await createTwoBlockConflictRepo()
  const env = { ...process.env, GIT_GUI_E2E_REPO: repo }
  const app = await electron.launch({ args: [APP_ROOT], env })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('merge-open').click()
    await window.getByTestId('list-option-rival').click()
    await window.getByTestId('file-unstaged-app.txt').click()
    await window.getByTestId('conflict-block-ours-0').click()
    await expect(window.getByTestId('conflict-progress')).toHaveText('겹침 2곳 중 2번째')
  } finally {
    await app.close()
  }
  // 재실행 — 선택은 파일에, 합치는 중 상태는 MERGE_HEAD에 있어 그대로 복원된다 (스펙 §7 공통 원칙)
  const second = await electron.launch({ args: [APP_ROOT], env })
  try {
    const window = await second.firstWindow()
    await expect(window.getByTestId('merge-bar')).toContainText('겹침 1개 남음')
    await window.getByTestId('file-unstaged-app.txt').click()
    // 남은 블록 1개부터 이어서 — 앞서 고른 mine-top은 일반 줄로 남아 있다
    await expect(window.getByTestId('conflict-progress')).toHaveText('겹침 1곳 중 1번째')
    await expect(window.getByTestId('conflict-view')).toContainText('mine-top')
    await expect(window.getByTestId('conflict-card-1')).toHaveCount(0)
  } finally {
    await second.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('처음부터 다시를 누르면 겹침 표시가 되살아난다', async () => {
  const repo = await createTwoBlockConflictRepo()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('merge-open').click()
    await window.getByTestId('list-option-rival').click()
    await window.getByTestId('file-unstaged-app.txt').click()
    await window.getByTestId('conflict-block-ours-0').click()
    await expect(window.getByTestId('conflict-progress')).toHaveText('겹침 2곳 중 2번째')
    await window.getByTestId('conflict-reset').click()
    await window.getByTestId('confirm-accept').click()
    // 마커 재생성(실측: 라벨은 ours/theirs) — 카드 2개와 진행 표시가 처음으로 돌아온다
    await expect(window.getByTestId('conflict-progress')).toHaveText('겹침 2곳 중 1번째')
    await expect(window.getByTestId('conflict-card-1')).toBeVisible()
    expect(await readFile(join(repo, 'app.txt'), 'utf8')).toContain('<<<<<<<')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})
```

- [ ] **Step 3: 검출력 실증 (Red) → 전체 게이트**

검출력: `ConflictPanel.tsx`의 `testId="conflict-confirm"`을 임시로 `testId="conflict-confirm-x"`로 변이 → 첫 신규 테스트가 FAIL(타임아웃)하는 것을 확인 후 **원복**.

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build && (cd apps/desktop && pnpm e2e)`
Expected: **253 tests + typecheck 전부 Done + build + E2E 29 passed** — 전부 exit 0

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/e2e/smoke.spec.ts
git commit -m "test(desktop): E2E — 블록 선택 완주·E-004 전환 유지·재시작 복원·처음부터 다시

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6-보완: 품질 리뷰 5건 (실렌더 실측 반영)

품질 리뷰(실기동)가 잡은 결함:

- **(Important 2) 순서 건너뛴 선택 시 스크롤이 맨 위로** — 중간 카드를 먼저 고르면 `findIndex`가 "전체 첫 미해결"로 스크롤(실측 43484→838). 고른 위치 **이후**의 첫 미해결로 가야 한다. 남은 블록은 0부터 재번호되므로 옛 인덱스 k를 고르면 다음 미해결의 새 인덱스가 곧 k다.
- **(Important 1) 960px 최소 창에서 충돌 뷰 붕괴** — conflict-view가 0px 높이(실측). 힌트·버튼 줄이 좁은 폭에서 세로로 커지며 목록을 짜부라뜨리고, 카드 세로 스택 media query는 창 폭 기준이라 좁은 '중앙 열'에 반응하지 못한다. → 컨테이너 쿼리 전환 + 목록 최소 높이. (근본인 고정 340/360 열 반응형 개편은 별도 태스크 — 후속 노트.)
- **(Minor 3) 열 때 첫 겹침이 화면 밖** — 진행 표시 "1번째"와 어긋난다 → mount 시 첫 블록으로 점프.
- **(Minor 4) 자세히 보기 저장 실패 시 초안 유실** — 저장 거부(외부 비충돌화·용량 초과)여도 무조건 선택형 복귀 → 성공 시에만 복귀.
- **(Minor 5) 카드 라벨이 모노스페이스** — `.conflict-card{font-family:inherit}`가 조상 `.conflict-panel__code`의 mono를 상속 → 라벨은 산세리프, 코드(`__code`)만 mono.

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/ConflictPanel.tsx`
- Modify: `apps/desktop/src/renderer/src/components/conflict-panel.css`
- Modify: `apps/desktop/src/renderer/src/layout.css`
- Modify: `apps/desktop/src/renderer/src/store/repository-store.ts`
- Modify: `apps/desktop/src/renderer/src/App.tsx`

- [ ] **Step 1: 960px 진단 실측** — electron 960×800, 블록 2개 충돌에서 충돌 뷰를 열고 `.conflict-panel__hint`·`.conflict-panel__actions`·`[data-testid="conflict-view"]`의 boundingBox 높이를 기록한다. 전제(힌트·버튼 줄이 커져 목록이 0으로 짜부라짐)가 어긋나면 **NEEDS_CONTEXT로 멈춰라**.

- [ ] **Step 2: ConflictPanel.tsx**

(a) 선택 후 스크롤 블록 교체 — 기존:

```tsx
  // 블록을 고르면 반영된 내용이 prop으로 돌아온 뒤 첫 미해결 블록으로 스크롤한다
  const pendingScrollRef = useRef(false)
  const chooseBlock = (blockIndex: number, choice: 'ours' | 'theirs') => {
    pendingScrollRef.current = true
    onChooseBlock(blockIndex, choice)
  }
  useEffect(() => {
    if (!pendingScrollRef.current) return
    pendingScrollRef.current = false
    const nextIndex = items.findIndex((item) => item.type === 'block')
    if (nextIndex >= 0) virtualizer.scrollToIndex(nextIndex, { align: 'center' })
    // 선택이 반영된 content 변화 시점에만 — items·virtualizer는 content에서 파생된다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content])
```

교체:

```tsx
  // 블록을 고르면 반영된 내용이 prop으로 돌아온 뒤, 고른 위치 "이후"의 첫 미해결 블록으로
  // 스크롤한다 — 중간부터 골라도 맨 위로 끌려가지 않는다 (품질 리뷰). 남은 블록은 0부터
  // 재번호되므로, 옛 인덱스 k를 고르면 다음 미해결의 새 인덱스가 곧 k다
  const pendingScrollRef = useRef<number | null>(null)
  const chooseBlock = (blockIndex: number, choice: 'ours' | 'theirs') => {
    pendingScrollRef.current = blockIndex
    onChooseBlock(blockIndex, choice)
  }
  useEffect(() => {
    const from = pendingScrollRef.current
    if (from === null) return
    pendingScrollRef.current = null
    const after = items.findIndex((item) => item.type === 'block' && item.block.index >= from)
    const nextIndex = after >= 0 ? after : items.findIndex((item) => item.type === 'block')
    if (nextIndex >= 0) virtualizer.scrollToIndex(nextIndex, { align: 'center' })
    // 선택이 반영된 content 변화 시점에만 — items·virtualizer는 content에서 파생된다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content])
  // 열 때 첫 겹침으로 — 진행 표시("1번째")와 화면이 어긋나지 않게 한다 (품질 리뷰).
  // key={path}로 파일마다 리마운트되므로 mount 1회면 충분하다
  useEffect(() => {
    const first = items.findIndex((item) => item.type === 'block')
    if (first >= 0) virtualizer.scrollToIndex(first, { align: 'center' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
```

(b) props의 `onSaveText` 교체:

```tsx
  /** 자세히 보기에서 직접 수정한 결과 저장(확정 아님). 성공 여부를 반환한다 — 실패 시 초안 보존 */
  onSaveText(content: string): Promise<boolean>
```

(c) "저장하고 선택형으로" 버튼의 onPress 교체:

```tsx
              onPress={() => {
                void (async () => {
                  // 저장이 거부되면(외부 비충돌화·용량 초과) 초안을 잃지 않게 편집 화면을 유지한다 (품질 리뷰)
                  if (await onSaveText(draft)) setView('cards')
                })()
              }}
```

(d) 충돌 목록 컨테이너에 스코프 클래스 추가 — `className="virtual-scroll"`을:

```tsx
          <div ref={scrollRef} className="virtual-scroll conflict-panel__scroll" data-testid="conflict-view">
```

- [ ] **Step 3: store — saveConflictText 성공 여부 반환**

인터페이스 교체(`saveConflictText(content: string): Promise<void>` →):

```ts
  /** 자세히 보기 저장 — 성공 여부를 반환한다(실패 시 편집 화면·초안 보존) */
  saveConflictText(content: string): Promise<boolean>
```

구현 교체:

```ts
  async saveConflictText(content) {
    const { repoPath, conflictFile } = get()
    if (!repoPath || !conflictFile) return false
    return await guard(set, get, async () => {
      await git().conflicts.saveText(repoPath, conflictFile.path, content)
      set({
        conflictFile: { path: conflictFile.path, content },
        status: await git().repo.status(repoPath),
      })
    })
  },
```

- [ ] **Step 4: App.tsx** — `onSaveText={(content) => void store.saveConflictText(content)}`를 다음으로 교체:

```tsx
              onSaveText={(content) => store.saveConflictText(content)}
```

- [ ] **Step 5: CSS**

(a) `conflict-panel.css`의 `.conflict-card` 블록에서 `font-family: inherit;`를 교체:

```css
  /* 라벨·제목은 산세리프 — 조상(.conflict-panel__code)의 mono 상속을 끊는다. 코드는 __code가 mono (품질 리뷰) */
  font-family: var(--font-sans);
```

(b) `conflict-panel.css`의 `@media (max-width: 960px)` 블록(주석 포함) 교체:

```css
/* 좁은 '중앙 열'에서는 위아래로 쌓인다 — 창 폭이 아니라 실제 열 폭 기준 (품질 리뷰 실측:
   960px 창에서 media query는 무력했다. 열을 컨테이너로 선언한 layout.css와 짝).
   임계값은 실측 기반 — 중앙 열 폭: 960창 156px / 1200창 406px / 1440창 646px.
   400px면 960은 스택·1200부터 나란히가 성립한다 */
@container center (max-width: 400px) {
  .conflict-card__sides {
    grid-template-columns: 1fr;
  }
}
```

(c) `conflict-panel.css` 끝에 추가:

```css
/* 힌트·버튼 줄이 좁은 폭에서 여러 줄로 커져도 목록이 0px로 짜부라지지 않게 (품질 리뷰 실측).
   virtual.css의 .virtual-scroll { min-height: 0 }과 특이도 동률이면 번들 순서에 밀린다(실측) —
   복합 셀렉터(0,2,0)로 확정적으로 이긴다 */
.virtual-scroll.conflict-panel__scroll {
  min-height: 220px;
}
```

(d) `layout.css`의 `.app__center` 블록에 추가(`min-height: 0;` 줄 뒤):

```css
  /* 중앙 열을 컨테이너로 — 충돌 카드가 창 폭이 아니라 실제 열 폭에 반응한다 (품질 리뷰) */
  container-type: inline-size;
  container-name: center;
```

- [ ] **Step 6: 실렌더 확인 5건** — (1) 960×800에서 충돌 뷰 높이 ≥ 200px·카드 세로 스택·"이쪽 사용" 실클릭 성공, (2) 1200px에서 나란히 유지, (3) 블록 5개+에서 중간(3번째) 카드 선택 → 스크롤이 그 아래 미해결로(맨 위로 튀지 않음), (4) 열 때 첫 카드가 화면 안, (5) 카드 제목·라벨 산세리프·코드 mono.

- [ ] **Step 7: 게이트** — 루트 `pnpm test`(**253**) + typecheck(5 Done) + build + E2E 전체(**29 passed**)

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/renderer/src
git commit -m "fix(desktop): 품질 리뷰 — 스크롤 목적지·첫 겹침 점프·저장 실패 초안 보존·컨테이너 쿼리·카드 폰트

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: 최종 게이트 + 공식 스크린샷 3장 + README

- [ ] **Step 1: 전체 게이트**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build && (cd apps/desktop && pnpm e2e)`
Expected: **253 tests + typecheck 전부 Done + build + E2E 29 passed** — 전부 exit 0

- [ ] **Step 2: 스크린샷 3장** (1440×900, `apps/desktop/test-results/` + scratchpad 사본. **생성 후 playwright/e2e 재실행 금지** — playwright가 test-results를 청소한다)

임시 스펙 `apps/desktop/e2e/shots.spec.ts`를 만든다 (**커밋 금지 — 촬영 후 삭제**):

```ts
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { execGitOrThrow } from '@git-gui/git-process'

const APP_ROOT = join(__dirname, '..')

async function createTwoBlockConflictRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'git-gui-shot-'))
  await execGitOrThrow(['init', '--initial-branch=main'], { cwd: dir })
  await execGitOrThrow(['config', 'user.name', 'E2E'], { cwd: dir })
  await execGitOrThrow(['config', 'user.email', 'e2e@test.local'], { cwd: dir })
  await writeFile(join(dir, 'app.txt'), 'one\ntwo\nthree\nfour\nfive\nsix\nseven\n')
  await execGitOrThrow(['add', '-A'], { cwd: dir })
  await execGitOrThrow(['commit', '-m', 'init'], { cwd: dir })
  await execGitOrThrow(['checkout', '-b', 'rival'], { cwd: dir })
  await writeFile(join(dir, 'app.txt'), 'rival-top\ntwo\nthree\nfour\nfive\nsix\nrival-bottom\n')
  await execGitOrThrow(['commit', '-am', 'rival'], { cwd: dir })
  await execGitOrThrow(['checkout', 'main'], { cwd: dir })
  await writeFile(join(dir, 'app.txt'), 'mine-top\ntwo\nthree\nfour\nfive\nsix\nmine-bottom\n')
  await execGitOrThrow(['commit', '-am', 'mine'], { cwd: dir })
  return dir
}

test('E2 공식 스크린샷 3장', async () => {
  const repo = await createTwoBlockConflictRepo()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  const window = await app.firstWindow()
  // Electron 창은 page.setViewportSize가 아니라 BrowserWindow로 크기를 고정한다 (1440×900)
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]!.setSize(1440, 900)
  })
  await window.getByTestId('merge-open').click()
  await window.getByTestId('list-option-rival').click()
  await window.getByTestId('file-unstaged-app.txt').click()
  await expect(window.getByTestId('conflict-progress')).toHaveText('겹침 2곳 중 1번째')
  await window.screenshot({ path: 'test-results/e2-cards.png' })
  await window.getByTestId('conflict-block-ours-0').click()
  await window.getByTestId('conflict-detail-toggle').click()
  await expect(window.getByTestId('conflict-edit-text')).toHaveValue(/<<<<<<</)
  await window.screenshot({ path: 'test-results/e2-detail-edit.png' })
  await window
    .getByTestId('conflict-edit-text')
    .fill('mine-top\ntwo\nthree\nfour\nfive\nsix\nhand-merged\n')
  await window.getByTestId('conflict-edit-save').click()
  await expect(window.getByTestId('conflict-progress')).toHaveText('모두 골랐어요')
  await window.screenshot({ path: 'test-results/e2-progress-done.png' })
  await app.close()
})
```

Run (Step 1 게이트의 build 산출물을 그대로 사용 — 다시 build하지 않는다):

```bash
cd apps/desktop && npx playwright test e2e/shots.spec.ts
```

Expected: 1 passed. 촬영물 확인·사본·정리:

```bash
ls apps/desktop/test-results/e2-cards.png apps/desktop/test-results/e2-detail-edit.png apps/desktop/test-results/e2-progress-done.png
cp apps/desktop/test-results/e2-cards.png apps/desktop/test-results/e2-detail-edit.png apps/desktop/test-results/e2-progress-done.png "<temporary-scratchpad>/"
rm apps/desktop/e2e/shots.spec.ts
```

각 장의 확인 포인트: (a) `e2-cards.png` — 카드 2개(초록/보라 양쪽 나란히 + "이쪽 사용" 2개), 진행 표시 "겹침 2곳 중 1번째", 머지 바(합치기 취소 상주), (b) `e2-detail-edit.png` — 자세히 보기 textarea(앞선 선택 mine-top 유지 + 남은 마커), (c) `e2-progress-done.png` — "모두 골랐어요" + "고른 대로 확정" 버튼. **이후 playwright/e2e를 다시 실행하지 않는다.**

- [ ] **Step 3: README "현재 상태" 갱신**

`README.md`의 다음 구간을 교체 — 기존:

```
실험 공간 합치기(merge — 충돌 시 한쪽 고르기/직접 수정/취소, 막히면 자동 보관)
```

교체:

```
실험 공간 합치기(merge — 충돌은 겹침 카드에서 하나씩 고르기·파일 단위 한쪽 선택·자세히 보기 직접 수정·처음부터 다시·취소, 막히면 자동 보관)
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README — E2 충돌 하나씩 선택형·자세히 보기 반영

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 검증 게이트 요약

| 시점 | 기대치 |
| --- | --- |
| 기준선 (d1d9fc8, 실측) | 238 tests + E2E 25 |
| Task 1 후 | +10 (블록 파서·컴포저) → **248 tests** |
| Task 2 후 | +5 (saveText·reset) → **253 tests** |
| Task 3 후 | 253 tests + build |
| Task 4 후 | 253 tests + build |
| Task 5 후 | 253 tests + build + **E2E 25** (기존 회귀 없음 — 충돌 testId 불변) |
| Task 6 후 | **E2E 29** (+4) |
| 최종 (Task 7) | **253 tests + typecheck 전부 Done + build + E2E 29** — 전부 exit 0 + 스크린샷 3장 + README |

(수치가 어긋나면 이 표를 갱신한다 — 본질은 "전부 PASS + 신규 테스트 실존 + Red 실증 수행".)

## 스펙 요구 커버리지 (§7·§12)

| 스펙 요구 | 구현 지점 |
| --- | --- |
| 진행 표시 "N곳 중 M번째" | ConflictPanel `conflict-progress` (Task 5) + E2E (a) |
| 양쪽 코드 나란히 + 한쪽 선택 → 다음 충돌 진행 | 카드 `__sides` + 선택 후 첫 미해결 블록 스크롤 (Task 5) |
| "그만두고 원래대로 abort" 항상 보임 | 기존 머지 바 상주(변경 없음 — 충돌 뷰와 독립) |
| 해결 완료 전 확정 없음 | saveText는 add하지 않는다(Task 2 테스트로 고정), 확정은 "고른 대로 확정"에서만 |
| 선택형→상세 전환 시 선택 유지 (E-004) | 상태가 파일에 있음 — E2E (b) |
| 앱 재시작 복원 | 파일 + MERGE_HEAD — E2E (c) |
| 결과 직접 수정 | 자세히 보기 textarea + saveConflictText (Task 4·5) |
| 선택 결과 설명 3층(§10) | 상단 안내문 + 카드 라벨 + "선택하지 않은 쪽도 역사에 남는다" 안심 문구 (Task 5 hint) |

## 후속 노트 (E2 이후 이관 후보)

- **3-way 나란히 상세 뷰**(스펙 §7-2 완전판): 현재 자세히 보기는 합쳐진 결과 단일 textarea — 양쪽 버전을 좌우에 두고 결과에 즉시 반영되는 편집기는 후속 밀도 작업.
- 진행 표시 분모의 세션 경계: 재시작하면 총 N이 남은 블록 수로 재산정된다(해소 블록은 파일에서 사라짐). 세션 간 유지가 필요하면 `.git` 밖 부수 상태가 필요해 이번 범위에서 제외했다.
- `conflicts.reset`은 stash pop형 충돌(unmerged인데 MERGE_HEAD 없음)에서도 동작한다(ls-files -u 기반) — 머지 바 부재 상태의 안내 문구는 E1b 후속 노트와 동일하게 미해결.
- 카드 밖 원본 마커 줄 보기(디버그용 raw 뷰) — 필요 시 토글로.
- **앱 레이아웃 반응형 개편**(품질 리뷰 Important 1의 근본): 고정 340px 좌열·360px 우열이 960px 창에서 중앙을 ~200px로 짜부라뜨린다 — 좁은 창에서 열 폭 축소/접힘 설계 필요(리뷰어가 별도 태스크 칩 생성).
- 자세히 보기 IME 한글 입력은 Playwright로 실측 불가(표준 controlled textarea라 위험 낮음 — 미실측 항목으로 기록).
- (통합 리뷰 Minor) 부분 선택 후 파일 전체 버튼(내 것 유지/가져온 것 사용)이 이미 고른 블록을 무통보 폐기 — "지금까지 고른 N곳 선택이 사라져요" 확인창 검토.
- (통합 리뷰 Minor) stash pop형 충돌은 상주 바가 없어 마무리 안내가 파일 `!` 하나뿐 — 반응형 개편 태스크와 함께 안내 강화 검토.
- (통합 리뷰 Minor) chooseConflictBlock 실패 시 pendingScrollRef 미해제로 다음 content 변화 때 스크롤 1회 오발(코스메틱).
