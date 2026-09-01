# E5b 히스토리 전체 그래프 + 커밋 작업 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) 구문으로 추적한다.

**Goal:** 히스토리를 현재 브랜치 기준에서 **전체 그래프(`--all`)**로 전환하고 "지금 여기" 마커가 HEAD 커밋 행을 따라가게 하며(피드백 4), 원격(origin) ref 배지를 시각 구분하고(피드백 3), 커밋 우클릭 메뉴에 이동(switch)·이 저장만 가져오기(cherry-pick)·저장 실행취소(undo)·메시지 고치기(amend)·태그 만들기(tag)를 추가한다(피드백 5·6 잔여).

**Architecture:** git-adapter의 `history.list`를 `--exclude=refs/stash --exclude=refs/notes/* --exclude=refs/replace/* --all` 기반으로 전환하고(기존 `--date-order`·decorate-exclude 유지), `repo.status`가 이미 받고 있던 porcelain v2의 `# branch.oid`를 파싱해 `RepositoryStatus.headHash`로 노출한다(추가 git 호출 0회). 엔진 5개(`commits.cherryPick` — revert와 동일 골격의 스마트 가져오기, `cherryPickAbort`, `createTag`, `undoLast`, `reword`)를 기존 관례(상태 가드·assertFullHash·`--end-of-options`·친절 에러) 그대로 추가하고 IPC 5채널을 뚫는다. store에는 액션 5개, UI는 HistoryPanel 메뉴를 8항목+구분선으로 확장하되 콜백 폭발을 막기 위해 단일 `onAction(action: HistoryAction)`으로 묶는다(사용자 규칙: data options 패턴). 상태 바는 merging/reverting/cherry-picking 3겸용.

**Tech Stack:** 기존 그대로 — TypeScript, Electron(main/preload/renderer), zustand, vitest, Playwright(Electron E2E).

**기준 커밋:** `feature/e5b-history-commit-ops` = `ee644f3`. 기준선 실측: 단위 **315 tests**(26 files, `pnpm test` 실행), E2E **38**(smoke 32 + hosting 6, `grep -c "^test("` 실측).

## 사용자 피드백 원문 대응표

| # | 피드백 원문 | 태스크 |
| --- | --- | --- |
| 3 | "히스토리 트리에서 오리진과 로컬을 구분해서 다 보여줬으면 좋겠어" | Task 1(--all로 원격 커밋 포함)·Task 6·7(원격 배지 `☁` 접두 + 점선 테두리, +N 툴팁에도 구분) |
| 4 | "히스토리 트리에서 전체 트리목록을 보여주고 내가 어디있는지 보여주는게 좋지, 내 브랜치 기준으로 마지막을 보여주는것보다 저게 더 나아보여. 전체 히스토리 파악이 잘 안돼." | Task 1(`--all` 전환 + `headHash`)·Task 7("지금 여기" 마커를 index 0 고정에서 HEAD 행으로 이동) |
| 5 | "해당 브랜치로 이동, 체리픽, 커밋메세지 편집, 커밋 제거, 커밋 실행취소 등 기능이 없는것 같아" | Task 2(cherry-pick 엔진)·Task 3(undo·amend 엔진)·Task 7(메뉴: 이동은 기존 switchBranch 재사용). "커밋 제거"는 HEAD 전용 실행취소(undo)와 기존 되돌리기(revert)로 대응 — 임의 중간 커밋 drop(rebase)은 이번 범위 밖(후속 노트) |
| 6(잔여) | "태그 생성도 가능했으면 좋겠어." | Task 3(createTag 엔진)·Task 7(메뉴 "태그 만들기…") — 태그는 --all 그래프 decorate에 자동 반영(실측 8) |

## 사전 실측 기록 (2026-07-21, git 2.50.1 로컬 프로브)

플랜 지시의 실측 요구(①·②·amend·가드)를 포함해, 설계가 기대는 git 동작을 전부 실측했다. 프로브 저장소: scratchpad `/probe-all`·`/probe-empty`·`/probe-cp`·`/probe-cp2`·`/probe-amend`·`/probe-perf`·`/probe-remote`.

1. **`--all`은 refs/stash·refs/notes를 포함한다 → 제외 필수.** `git log --all`에 보관함의 WIP 커밋 3형제("On main: …"·"index on main: …"·"untracked files on main: …")와 `git notes`의 노트 커밋이 그대로 등장한다. `--exclude=refs/stash --exclude='refs/notes/*'`를 **`--all` 앞에** 두면 깨끗하게 빠진다(--exclude는 뒤따르는 --all에만 적용). refs/replace는 같은 계열의 예방 제외로 함께 건다.
2. **고아 루트·성능 (요구 ①)** — 브랜치 21개·병합·고아(orphan) 루트 2개를 가진 **5,003커밋** 저장소에서 `git log --all --date-order` 0.14초, 그 출력을 실제 소스(`parseLog`+`buildGraph`)에 통과: **2.8ms, max laneCount 21, 붕괴 행 0, 고아 루트 2개 모두 forkLanes 빈 배열로 정상**. 기존 레인 계산은 무변경으로 안전하다(고아 루트 = 대기 레인 없는 새 머리 + 부모 없는 종단 — 기존 로직이 이미 다루는 형태).
3. **빈 저장소·detached (요구 ②)** — 빈 저장소에서 `git log --all …`은 **exit 0 + 빈 출력**(기존 `--all` 없는 호출은 exit 128 "does not have any commits" — 기존 에러 분기는 심층 방어로 유지). detached HEAD는 `--all`에 HEAD가 포함되어 그 커밋이 목록에 남고, `%D`의 단독 "HEAD"는 기존 parseRefs가 걸러낸다. porcelain v2 `# branch.oid`는 정상일 때 40자 해시, unborn일 때 `(initial)`, detached일 때도 해시를 준다 — headHash의 소스로 충분(추가 git 호출 불필요).
4. **원격 동일 해시 dedup** — origin/main == main(같은 해시)이면 `--all` 커밋 수는 불변(1개)이고 decorate에 `origin/main` 배지만 추가된다. 기존 E2E history-count 단언 영향은 아래 전수 표.
5. **cherry-pick 골격 (revert와 동일 계열 확인)** — ⓐ merge commit: exit 128, stderr `is a merge but no -m option was given`(친절 거부 근거). ⓑ 충돌: exit 1, 출력에 `CONFLICT`, `.git/CHERRY_PICK_HEAD` 생성 → detectState 'cherry-picking'. ⓒ dirty 겹침: exit 128, `Your local changes … would be overwritten by merge`, CHERRY_PICK_HEAD 없음·dirty 무손상 → stash 후 재시도 성공(revert 스마트 패턴 그대로). ⓓ **이미 반영된 커밋(empty)**: exit 1, `The previous cherry-pick is now empty…`가 출력되고 **CHERRY_PICK_HEAD가 남는다** — 이때 `cherry-pick --abort`는 exit 0으로 흔적 없이 정리된다(트리 무손상 실측) → 엔진이 자동 정리 후 `empty` outcome으로 알린다. ⓔ abort(진행 중 아님): stderr `no cherry-pick or revert in progress`. ⓕ 사라진 해시: `fatal: bad object <hash>`(revert와 동일).
6. **기존 상태 가드의 cherry-picking 커버 (요구)** — cherry-picking 중 `git switch`: `fatal: cannot switch branch while cherry-picking` → 기존 switch 가드 문구(`cannot switch branch while`)가 그대로 잡는다 ✓. `git merge`: `You have not concluded your cherry-pick` → 합치기 버튼은 `state !== 'normal'`에서 이미 비활성(UI 게이트) ✓. `git stash push`: `could not write index` → 기존 shelf.save 가드 ✓. pull 버튼도 `state !== 'normal'` 비활성(UI 게이트 — 엔진 stderr 분기 불필요) ✓. revert·restoreFile은 detectState 가드가 cherry-picking을 이미 거부 ✓. 커밋(commits.create)은 cherry-pick 충돌 해소 후 실행 시 CHERRY_PICK_HEAD를 소비하며 정상 마무리(exit 0, 마커 제거 실측) — 머지 바 "저장하기로 마무리" 안내가 그대로 유효하다.
7. **amend (요구)** — staged 없는 상태(unstaged dirty 有)에서 `git commit --amend -F -`(stdin 메시지): **exit 0, HEAD tree 해시 불변, 메시지만 교체, unstaged 변경 그대로**. staged 감지는 `git diff --cached --quiet`(깨끗 exit 0 / staged exit 1)로 앞단 거부한다.
8. **undo(reset)** — `git reset --mixed HEAD~1`: 커밋만 물리고 내용은 워크트리에 남는다(커밋했던 새 파일은 untracked로 복귀 실측). 루트 커밋: `git rev-parse -q --verify HEAD~1`이 조용히 exit 1 → 선검사로 친절 거부.
9. **tag** — `git check-ref-format refs/tags/<name>`: 공백·`..` exit 1(선검증 근거). `git tag --end-of-options <name> <hash>` 후 `%D`에 `tag: v1`로 등장 → 기존 log-parser가 접두를 벗겨 배지에 자동 반영. 중복: `fatal: tag 'v1' already exists`. 사라진 해시: `nonexistent object`.
10. **date-order 동률의 [0] 안정성** — 병합 커밋은 부모(브랜치 끝)와 타임스탬프가 같아도 `--date-order`가 자식을 항상 위에 두므로(기존 테스트 419가 고정) 기존 단위 테스트의 `history.list(1)[0]` = 병합 커밋 가정은 --all에서도 유지된다(아래 전수 감사).

## pushed(백업됨) 판정 편차 표 (플랜 지시 ③)

undo·amend 확인창의 "이미 백업된 저장" 경고 병기 판정. renderer 순수 계산(`isHeadBackedUp(branch)`, Task 6)으로 status 스냅샷의 ahead/upstream만 사용한다.

| 상황 | 해석 | 경고 병기 |
| --- | --- | --- |
| `upstream === null` (백업된 적 없음) | HEAD가 원격에 있을 수 없다 | 없음 |
| `ahead > 0` | 안 올라간 커밋들의 맨 앞이 HEAD 자신 — 미백업 | 없음 |
| `ahead === 0` | HEAD ⊆ upstream — 백업됨 | **병기** |
| `ahead === null` (upstream ref 소실 등 판정 불가) | 알 수 없음 | **보수적으로 병기** — 경고를 놓치는 쪽이 원격 어긋남보다 위험 |

주의: behind만으로는 판정하지 않는다(원격이 앞서 있어도 HEAD 자체는 백업됐을 수 있다 — ahead 기준이 정확).

## 기존 E2E history-count 단언 — `--all` 영향 전수 조사 (플랜 지시 ①)

smoke.spec.ts의 `history-count` 단언 전수(hosting.spec.ts에는 없음 — grep 실측):

| 테스트 | 단언 | --all 영향 | 조치 |
| --- | --- | --- | --- |
| 열기→stage→commit→백업 | '1'→'2' | 단일 브랜치, push 후 origin/main 동일 해시 dedup(실측 4) | 불변 |
| 커밋을 누르면 우측이 상세로 | '2' | 단일 브랜치 | 불변 |
| 스크롤 끝에서 더 불러오기 | '50+'→'61' | 단일 브랜치 | 불변 |
| **우클릭한 저장 시점에서 실험 공간** | 이동 후 '1' | **깨짐** — root로 이동해도 main 커밋이 --all로 보인다 → '2' | Task 8에서 '2'로 갱신 + "지금 여기" root 행 단언 추가 |
| **다른 실험 공간을 합친다 (ff)** | 합치기 전 '1' | **깨짐** — exp의 커밋이 이미 보인다 → '2' | Task 8에서 '2'로 갱신 (합친 후 '2'는 불변) |
| 겹치면 충돌…마무리 / 전량 ours | '4' | 병합 후 전 커밋 도달 가능 — 동일 집합 | 불변 |
| 원격의 새 저장을 받아온다 | '1'→'2' | origin/main 동일 해시 dedup, pull 전 원격 ref는 낡은 해시 | 불변 |
| revert 2건 | '2'·'3' | 단일 브랜치 | 불변 |
| 보관함 넣기/꺼내기 계열 | (count 단언 없음) | refs/stash 제외로 WIP 커밋 미노출 | 불변 |

단위(client.test.ts) `history.list(1)[0]`(=HEAD 가정) 사용처 전수 감사(L80·90·104·114·299·316·334·452·603·717·867·1121·1289·1305·1318·1348·1363·1377·1400): 병합 직후(자식이 동률에서도 위 — 실측 10)이거나 단일 브랜치·미병합 곁가지가 더 오래된 픽스처뿐 → **기존 단위 테스트 깨짐 0건**. L1377(스마트 되돌리기)의 자동 보관 stash는 refs/stash 제외로 [0]에 등장하지 않는다.

---

### Task 1: 엔진 — `history.list` --all 전환 + `RepositoryStatus.headHash`

**Files:**
- Modify: `packages/domain/src/repository.ts`
- Modify: `packages/git-adapter/src/status-parser.ts`
- Modify: `packages/git-adapter/src/client.ts`
- Test: `packages/git-adapter/test/status-parser.test.ts`, `packages/git-adapter/test/client.test.ts`

- [ ] **Step 1: 실패하는 테스트 6건**

(1) `packages/git-adapter/test/status-parser.test.ts` — `  it('필드가 모자란 기형 레코드는 추측하지 않고 건너뛴다', () => {` 블록 **앞**에 추가:

```ts
  it('branch.oid를 headHash로 파싱한다', () => {
    const parsed = parseStatusV2(raw(['# branch.oid 1234567890abcdef', '# branch.head main']))
    expect(parsed.headHash).toBe('1234567890abcdef')
  })

  it('아직 저장이 없으면(initial) headHash가 null이다', () => {
    const parsed = parseStatusV2(raw(['# branch.oid (initial)', '# branch.head main']))
    expect(parsed.headHash).toBeNull()
  })

```

(2) `packages/git-adapter/test/client.test.ts` — `  it('branches — 목록(현재 표시·최신순)과 만들기, 특정 시점에서 만들기', async () => {` 블록 **앞**에 추가:

```ts
  it('history — 다른 실험 공간의 커밋도 전부 반환한다 (--all 전체 그래프)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await execGitOrThrow(['checkout', '-b', 'side'], { cwd: repo })
    await writeFixtureFile(repo, 'side.txt', 's\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'side work'], { cwd: repo })
    await execGitOrThrow(['checkout', 'main'], { cwd: repo })

    // 지금 공간(main)에서 도달할 수 없는 side 커밋이 함께 보인다 (피드백 4)
    const history = await client.history.list(10)
    expect(history.map((c) => c.subject).sort()).toEqual(['init', 'side work'])
    expect(history.find((c) => c.subject === 'side work')!.refs).toContain('side')
  })

  it('history — 보관함(refs/stash) 커밋은 역사에 나타나지 않는다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# dirty\n')
    await client.shelf.save('보관 실험')

    // 실측 1: --exclude=refs/stash 없는 --all은 WIP 커밋 3형제를 역사에 노출한다
    const history = await client.history.list(10)
    expect(history.map((c) => c.subject)).toEqual(['init'])
  })

  it('history — 분리된 루트(고아 브랜치)가 있어도 전체가 반환된다', async () => {
    const repo = await createFixtureRepo()
    await execGitOrThrow(['checkout', '--orphan', 'lonely'], { cwd: repo })
    await execGitOrThrow(['rm', '-rf', '--cached', '.'], { cwd: repo })
    await unlink(join(repo, 'README.md'))
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '--allow-empty', '-m', 'orphan root'], {
      cwd: repo,
    })

    const history = await createGitClient(repo).history.list(10)
    expect(history.map((c) => c.subject).sort()).toEqual(['init', 'orphan root'])
    // 고아 루트도 부모 없는 정상 레코드다 — 레인 그래프 전제(실측 2: buildGraph 5,003커밋 2.8ms 무붕괴)
    expect(history.find((c) => c.subject === 'orphan root')!.parents).toEqual([])
  })

  it('status — headHash가 HEAD 커밋을 가리키고, 저장이 없으면 null이다', async () => {
    const repo = await createFixtureRepo()
    const head = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
    expect((await createGitClient(repo).repo.status()).headHash).toBe(head)

    const unborn = await mkdtemp(join(tmpdir(), 'git-gui-unborn-'))
    await execGitOrThrow(['init', '--initial-branch=main'], { cwd: unborn })
    expect((await createGitClient(unborn).repo.status()).headHash).toBeNull()
  })

```

- [ ] **Step 2: Red 확인** — `cd packages/git-adapter && npx vitest run` → **5건 FAIL** (headHash 3건: undefined ≠ 기대값, --all 2건: side/orphan 커밋 미포함). stash 제외 테스트 1건은 --all이 없는 기존 구현에서도 통과한다 — --all 전환 후 `--exclude=refs/stash`를 빼면 죽는 **회귀 검출용**임을 인지하고 진행(검출력은 Task 8 변이 실증이 E2E에서 증명)

- [ ] **Step 3: domain 타입** — `packages/domain/src/repository.ts` 기존:

```ts
export interface RepositoryStatus {
  state: RepositoryStateKind
  branch: BranchInfo
  changes: FileChange[]
}
```

교체:

```ts
export interface RepositoryStatus {
  state: RepositoryStateKind
  branch: BranchInfo
  /** HEAD 커밋 해시 — 아직 저장이 없으면(unborn) null. "지금 여기" 마커가 이 값을 따라간다 (E5b) */
  headHash: string | null
  changes: FileChange[]
}
```

- [ ] **Step 4: status-parser** — `packages/git-adapter/src/status-parser.ts`

(1) 기존:

```ts
export type ParsedStatus = Pick<RepositoryStatus, 'branch' | 'changes'>
```

교체:

```ts
export type ParsedStatus = Pick<RepositoryStatus, 'branch' | 'changes' | 'headHash'>
```

(2) 기존:

```ts
  const branch: BranchInfo = { name: null, upstream: null, ahead: null, behind: null }
  const changes: FileChange[] = []
```

교체:

```ts
  const branch: BranchInfo = { name: null, upstream: null, ahead: null, behind: null }
  const changes: FileChange[] = []
  let headHash: string | null = null
```

(3) 기존:

```ts
    if (token.startsWith('# branch.head ')) {
```

교체:

```ts
    if (token.startsWith('# branch.oid ')) {
      const value = token.slice('# branch.oid '.length)
      // 아직 저장이 없는(unborn) 저장소는 "(initial)"이다 (실측 3)
      headHash = value === '(initial)' ? null : value
    } else if (token.startsWith('# branch.head ')) {
```

(4) 기존:

```ts
    // '!'(ignored)와 '# branch.oid'는 이번 범위에서 무시한다
```

교체:

```ts
    // '!'(ignored)는 이번 범위에서 무시한다
```

(5) 기존:

```ts
  return { branch, changes }
```

교체:

```ts
  return { branch, changes, headHash }
```

- [ ] **Step 5: client** — `packages/git-adapter/src/client.ts`

(1) repo.status 반환 — 기존:

```ts
        return { state: detectState(markers), branch: parsed.branch, changes: parsed.changes }
```

교체:

```ts
        return {
          state: detectState(markers),
          branch: parsed.branch,
          headHash: parsed.headHash,
          changes: parsed.changes,
        }
```

(2) history.list 인자 — 기존:

```ts
          // 타임스탬프가 같은 커밋(스크립트 연속 커밋 등)에서도 부모가 자식보다 아래에 오도록
          // 고정한다 — 레인 그래프는 "기다리던 커밋이 아래에 나타난다"를 전제한다 (실측: 동률에서 유령 레인)
          '--date-order',
```

교체:

```ts
          // 전체 그래프(피드백 4) — 로컬·원격·태그를 전부 순회한다. --exclude는 뒤의 --all에만
          // 적용되며, refs/stash를 빼지 않으면 보관함 WIP 커밋 3형제가, refs/notes를 빼지 않으면
          // 노트 커밋이 역사에 등장한다(실측 1). refs/replace는 같은 계열의 예방 제외다
          '--exclude=refs/stash',
          '--exclude=refs/notes/*',
          '--exclude=refs/replace/*',
          '--all',
          // 타임스탬프가 같은 커밋(스크립트 연속 커밋 등)에서도 부모가 자식보다 아래에 오도록
          // 고정한다 — 레인 그래프는 "기다리던 커밋이 아래에 나타난다"를 전제한다 (실측: 동률에서 유령 레인)
          '--date-order',
```

(3) unborn 분기 주석 — 기존:

```ts
          // 아직 커밋이 없는 저장소(unborn HEAD)는 빈 역사다 — 에러로 위장하지 않는다
```

교체:

```ts
          // 아직 커밋이 없는 저장소(unborn HEAD)는 빈 역사다 — --all은 exit 0 빈 출력이지만(실측 3) 심층 방어로 남긴다
```

- [ ] **Step 6: Green 확인** — `cd packages/git-adapter && npx vitest run` → 신규 6건 포함 전체 PASS

- [ ] **Step 7: 전체 게이트 + Commit** — 루트 `pnpm test` → **321 passed** (315+6), 루트 `pnpm typecheck` → 전 프로젝트 Done

```bash
git add packages/domain/src/repository.ts packages/git-adapter/src/status-parser.ts packages/git-adapter/src/client.ts packages/git-adapter/test/status-parser.test.ts packages/git-adapter/test/client.test.ts
git commit -m "feat(git-adapter): history.list --all 전체 그래프 + status.headHash (피드백 4)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 엔진 — `commits.cherryPick` + `cherryPickAbort` (이 저장만 가져오기)

**Files:**
- Modify: `packages/domain/src/repository.ts` (CherryPickResult 추가)
- Modify: `packages/git-adapter/src/client.ts`
- Test: `packages/git-adapter/test/client.test.ts`

- [ ] **Step 1: 실패하는 테스트 8건** — `packages/git-adapter/test/client.test.ts`의 `  it('reverting 중에는 전환·받아오기도 읽히는 메시지로 거부한다', async () => {` 블록 **앞**에 추가:

```ts
  it('cherryPick — 다른 공간의 저장 하나를 가져와 새 저장을 만든다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('side', null)
    await client.branches.switch('side')
    await writeFixtureFile(repo, 'side.txt', 's\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'side work'], { cwd: repo })
    const target = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
    await client.branches.switch('main')

    expect(await client.commits.cherryPick(target)).toEqual({
      outcome: 'picked',
      autoShelved: false,
    })
    expect(existsSync(join(repo, 'side.txt'))).toBe(true)
    // 새 저장이 main 끝에 생겼다 — side 커밋과 다른 해시의 복제다
    const head = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
    expect(head).not.toBe(target)
    expect(
      (await execGitOrThrow(['log', '-1', '--format=%s'], { cwd: repo })).stdout.trim(),
    ).toBe('side work')
  })

  it('cherryPick — 겹치면 conflict 상태(cherry-picking)로 남고, 취소로 돌아온다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('side', null)
    await client.branches.switch('side')
    await writeFixtureFile(repo, 'README.md', '# side\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'side edit'], { cwd: repo })
    const target = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
    await client.branches.switch('main')
    await writeFixtureFile(repo, 'README.md', '# mine\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'mine'], { cwd: repo })

    expect(await client.commits.cherryPick(target)).toEqual({
      outcome: 'conflict',
      autoShelved: false,
    })
    let status = await client.repo.status()
    expect(status.state).toBe('cherry-picking')
    expect(status.changes.some((c) => c.unstaged === 'conflicted')).toBe(true)

    await client.commits.cherryPickAbort()
    status = await client.repo.status()
    expect(status.state).toBe('normal')
    expect(await client.files.readText('README.md')).toBe('# mine\n')
  })

  it('cherryPick — 이미 반영된 저장은 empty로 알리고 진행 흔적을 남기지 않는다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'a.txt', '1\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'work'], { cwd: repo })
    const head = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()

    // HEAD 자신을 가져오기 — 바뀔 것이 없다(실측 5-ⓓ: CHERRY_PICK_HEAD가 남는 exit 1 → 엔진이 정리)
    expect(await client.commits.cherryPick(head)).toEqual({ outcome: 'empty', autoShelved: false })
    expect((await client.repo.status()).state).toBe('normal')
    expect((await client.history.list(10)).map((c) => c.subject)).toEqual(['work', 'init'])
  })

  it('cherryPick — 병합 커밋은 읽히는 메시지로 거부한다 (-m 재시도 없음)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('side', null)
    await client.branches.switch('side')
    await writeFixtureFile(repo, 'side.txt', 's\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'side'], { cwd: repo })
    await client.branches.switch('main')
    await writeFixtureFile(repo, 'main.txt', 'm\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'main work'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'merge', '--no-edit', 'side'], { cwd: repo })
    const mergeHash = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
    const root = (
      await execGitOrThrow(['rev-list', '--max-parents=0', 'HEAD'], { cwd: repo })
    ).stdout.trim()
    await client.branches.create('from-root', root)
    await client.branches.switch('from-root')

    await expect(client.commits.cherryPick(mergeHash)).rejects.toThrow(/통째로 가져올 수 없어요/)
    // 진행 흔적 없음 — 상태는 정상 그대로다
    expect((await client.repo.status()).state).toBe('normal')
  })

  it('cherryPick — 저장 안 된 변경이 겹치면 보관함에 넣고 가져온다 (스마트 가져오기)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('side', null)
    await client.branches.switch('side')
    await writeFixtureFile(repo, 'README.md', '# side\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'side edit'], { cwd: repo })
    const target = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
    await client.branches.switch('main')
    await writeFixtureFile(repo, 'README.md', '# dirty\n')

    expect(await client.commits.cherryPick(target)).toEqual({
      outcome: 'picked',
      autoShelved: true,
    })
    expect(await client.files.readText('README.md')).toBe('# side\n')
    const shelf = await client.shelf.list()
    expect(shelf).toHaveLength(1)
    expect(shelf[0]!.message).toContain('저장 가져오기 자동 보관')
  })

  it('cherryPick — 합치는 중(merging)에는 읽히는 메시지로 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await client.branches.create('rival', null)
    await client.branches.switch('rival')
    await writeFixtureFile(repo, 'README.md', '# rival\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'rival'], { cwd: repo })
    const target = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
    await client.branches.switch('main')
    await writeFixtureFile(repo, 'README.md', '# mine\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'mine'], { cwd: repo })
    await client.branches.merge('rival')

    await expect(client.commits.cherryPick(target)).rejects.toThrow(/먼저 마무리하거나 취소/)
  })

  it('cherryPick — 사라진 커밋·ref 표현식을 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await expect(
      client.commits.cherryPick('0123456789012345678901234567890123456789'),
    ).rejects.toThrow(/그 저장 시점을 찾을 수 없어요/)
    await expect(client.commits.cherryPick('HEAD')).rejects.toThrow(/올바른 커밋 해시가 아니에요/)
  })

  it('cherryPickAbort — 가져오는 중이 아니면 읽히는 메시지로 거부한다', async () => {
    const repo = await createFixtureRepo()
    await expect(createGitClient(repo).commits.cherryPickAbort()).rejects.toThrow(
      /지금은 가져오는 중이 아니에요/,
    )
  })

```

- [ ] **Step 2: Red 확인** — `cd packages/git-adapter && npx vitest run test/client.test.ts -t cherryPick` → **8건 FAIL** (`client.commits.cherryPick is not a function`)

- [ ] **Step 3: domain 타입** — `packages/domain/src/repository.ts`의 `/** 실험 공간 지우기 결과 — 합쳐지지 않은 저장이 있으면 지우지 않고 needsForce로 알린다 */` 줄 **앞**에 추가:

```ts
/** 가져오기(cherry-pick) 결과 — conflict면 CHERRY_PICK_HEAD가 남는다(상태 바 cherry-picking) */
export interface CherryPickResult {
  /** empty = 이미 반영된 저장 — 엔진이 빈 진행 상태(CHERRY_PICK_HEAD)를 정리(abort)하고 알려만 준다 */
  outcome: 'picked' | 'conflict' | 'empty'
  /** 막혀서 변경을 보관함에 자동 저장했는가 (스펙: 덮기 전 자동 보관) */
  autoShelved: boolean
}

```

- [ ] **Step 4: 구현** — `packages/git-adapter/src/client.ts`

(1) import 추가 — 기존:

```ts
import {
  detectState,
  type BranchSummary,
```

교체:

```ts
import {
  detectState,
  type BranchSummary,
  type CherryPickResult,
```

(2) GitClient 인터페이스 commits — 기존:

```ts
    /** 되돌리기 취소 — 충돌 상태를 버리고 이전으로 */
    revertAbort(): Promise<void>
```

교체:

```ts
    /** 되돌리기 취소 — 충돌 상태를 버리고 이전으로 */
    revertAbort(): Promise<void>
    /**
     * 이 저장 하나만 지금 공간으로 가져오는 새 저장을 만든다(cherry-pick) — revert와 동일 골격.
     * merge commit은 친절 거부(-m 재시도 없음 — "이 저장만"의 의미가 병합 전체와 어긋난다).
     * 이미 반영된 저장은 빈 진행 상태를 정리하고 empty로 알린다. dirty 겹침은 자동 보관 후 재시도
     */
    cherryPick(hash: string): Promise<CherryPickResult>
    /** 가져오기 취소 — 충돌 상태를 버리고 이전으로 */
    cherryPickAbort(): Promise<void>
```

(3) 상수 — 기존:

```ts
/** 파일 단위 적용이 미저장 변경을 덮기 전 자동 보관할 때의 보관함 메시지 */
const RESTORE_FILE_SHELF_MESSAGE = '파일 적용 자동 보관'
```

교체:

```ts
/** 파일 단위 적용이 미저장 변경을 덮기 전 자동 보관할 때의 보관함 메시지 */
const RESTORE_FILE_SHELF_MESSAGE = '파일 적용 자동 보관'

/** 가져오기(cherry-pick)가 막혀 자동 보관할 때의 보관함 메시지 */
const CHERRY_PICK_SHELF_MESSAGE = '저장 가져오기 자동 보관'
```

(4) 구현 본체 — `      async revert(hash) {` 줄 **앞**에 추가:

```ts
      async cherryPick(hash) {
        const cwd = await topLevel()
        assertFullHash(hash)
        // merging·reverting 도중의 cherry-pick은 진행 중 상태를 오염시킨다 — revert와 동일 관례로 먼저 마무리를 안내한다
        const gitDir = (await execGitOrThrow(['rev-parse', '--absolute-git-dir'], { cwd })).stdout.trim()
        if (detectState(await readGitDirMarkers(gitDir)) !== 'normal') {
          throw new Error('지금 진행 중인 작업을 먼저 마무리하거나 취소해야 가져올 수 있어요.')
        }
        const runOnce = () => execGit(['cherry-pick', '--no-edit', '--end-of-options', hash], { cwd })
        const classify = async (
          result: GitResult,
          autoShelved: boolean,
        ): Promise<CherryPickResult | null> => {
          if (result.exitCode === 0) return { outcome: 'picked', autoShelved }
          const output = result.stdout + result.stderr
          // merge commit은 -m 없이 거부된다(실측 5-ⓐ) — revert와 달리 재시도하지 않는다:
          // "이 저장만"과 병합 전체 가져오기는 의미가 다르다 (추측 금지 원칙)
          if (output.includes('is a merge but no -m option')) {
            throw new Error('합쳐진 저장은 통째로 가져올 수 없어요. 안에 있는 저장을 하나씩 가져와 주세요.')
          }
          if (output.includes('bad object')) {
            throw new Error(MISSING_COMMIT_MESSAGE)
          }
          // 이미 반영된 저장 — CHERRY_PICK_HEAD가 남는다(실측 5-ⓓ). 빈 진행 상태를 정리하고 알려만 준다
          if (output.includes('is now empty')) {
            await execGitOrThrow(['cherry-pick', '--abort'], { cwd })
            return { outcome: 'empty', autoShelved }
          }
          if (output.includes('CONFLICT') || output.includes('after resolving the conflicts')) {
            return { outcome: 'conflict', autoShelved }
          }
          return null
        }
        const first = await runOnce()
        const classified = await classify(first, false)
        if (classified !== null) return classified
        if (!(first.stdout + first.stderr).includes('would be overwritten')) {
          throw new GitError(['cherry-pick', '--no-edit', '--end-of-options', hash], first)
        }
        // 막혔다 — 스펙 원칙: 변경을 보관함에 자동 저장하고 진행한다 (switch·merge·pull·revert와 동일 패턴)
        await execGitOrThrow(['stash', 'push', '-u', '-m', CHERRY_PICK_SHELF_MESSAGE], { cwd })
        const second = await runOnce()
        const secondClassified = await classify(second, true)
        if (secondClassified !== null) return secondClassified
        throw new GitError(['cherry-pick', '--no-edit', '--end-of-options', hash], second)
      },
      async cherryPickAbort() {
        const cwd = await topLevel()
        const result = await execGit(['cherry-pick', '--abort'], { cwd })
        if (result.exitCode !== 0) {
          // 실측 5-ⓔ stderr: "error: no cherry-pick or revert in progress"
          if (result.stderr.includes('cherry-pick or revert in progress')) {
            throw new Error('지금은 가져오는 중이 아니에요.')
          }
          throw new GitError(['cherry-pick', '--abort'], result)
        }
      },
```

- [ ] **Step 5: Green 확인** — `cd packages/git-adapter && npx vitest run test/client.test.ts -t cherryPick` → **8건 PASS**

- [ ] **Step 6: 전체 게이트 + Commit** — 루트 `pnpm test` → **329 passed** (321+8)

```bash
git add packages/domain/src/repository.ts packages/git-adapter/src/client.ts packages/git-adapter/test/client.test.ts
git commit -m "feat(git-adapter): commits.cherryPick·cherryPickAbort — 이 저장만 가져오기 (피드백 5)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 엔진 — `createTag`·`undoLast`·`reword`

**설계 판단:** undo·reword는 renderer가 HEAD 행에서만 활성화하지만, CLI 경합으로 화면 목록이 낡았을 수 있다 — 엔진이 `hash` 인자를 받아 **실제 HEAD와 일치할 때만** 실행한다(엉뚱한 커밋이 물리는 것을 원천 차단). reword는 amend가 staged를 조용히 흡수하는 함정을 `git diff --cached --quiet` 선검사(실측 7)로 막는다.

**Files:**
- Modify: `packages/git-adapter/src/client.ts`
- Test: `packages/git-adapter/test/client.test.ts`

- [ ] **Step 1: 실패하는 테스트 11건** — `packages/git-adapter/test/client.test.ts`의 `  it('reverting 중에는 전환·받아오기도 읽히는 메시지로 거부한다', async () => {` 블록 **앞**(= Task 2에서 추가한 cherryPickAbort 테스트 뒤)에 추가:

```ts
  it('createTag — 태그를 만들면 역사 refs 배지에 나타난다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    const head = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()

    await client.commits.createTag('v1.0', head)
    // decorate가 "tag: v1.0"을 주고 기존 log-parser가 접두를 벗긴다 (실측 9)
    expect((await client.history.list(1))[0]!.refs).toContain('v1.0')
  })

  it('createTag — 잘못된 이름·중복 이름을 읽히는 메시지로 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    const head = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
    await expect(client.commits.createTag('bad name', head)).rejects.toThrow(/이름으로는 만들 수 없어요/)
    await client.commits.createTag('v1.0', head)
    await expect(client.commits.createTag('v1.0', head)).rejects.toThrow(/이미 있는 태그예요/)
  })

  it('createTag — 사라진 커밋·ref 표현식을 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await expect(
      client.commits.createTag('v9', '0123456789012345678901234567890123456789'),
    ).rejects.toThrow(/그 저장 시점을 찾을 수 없어요/)
    await expect(client.commits.createTag('v9', 'HEAD')).rejects.toThrow(/올바른 커밋 해시가 아니에요/)
  })

  it('undoLast — 마지막 저장만 취소하고 내용은 작업 폴더에 남는다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# v2\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'v2'], { cwd: repo })
    const head = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()

    await client.commits.undoLast(head)
    expect((await client.history.list(10)).map((c) => c.subject)).toEqual(['init'])
    // 내용은 그대로 — 미저장 변경으로 돌아온다 (reset --mixed 실측 8, 유실 없음)
    expect(await readFile(join(repo, 'README.md'), 'utf8')).toBe('# v2\n')
    const status = await client.repo.status()
    expect(status.changes.find((c) => c.path === 'README.md')?.unstaged).toBe('modified')
  })

  it('undoLast — 맨 처음 저장(루트)은 읽히는 메시지로 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    const head = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
    await expect(client.commits.undoLast(head)).rejects.toThrow(/맨 처음 저장은 실행취소할 수 없어요/)
  })

  it('undoLast — 화면 목록이 낡았으면(HEAD 불일치) 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    const stale = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
    await writeFixtureFile(repo, 'README.md', '# v2\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'v2'], { cwd: repo })

    // CLI 경합으로 HEAD가 이미 바뀐 상황 — 엉뚱한 저장이 물리면 안 된다
    await expect(client.commits.undoLast(stale)).rejects.toThrow(/가장 최근 저장이 바뀌었어요/)
    expect((await client.history.list(10))).toHaveLength(2)
  })

  it('undoLast — 합치는 중(merging)에는 읽히는 메시지로 거부한다', async () => {
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
    const head = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()

    await expect(client.commits.undoLast(head)).rejects.toThrow(/먼저 마무리하거나 취소/)
  })

  it('reword — 메시지만 바꾸고 내용(tree)·미저장 변경은 그대로다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# 작업 중\n')
    const head = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
    const beforeTree = (await execGitOrThrow(['rev-parse', 'HEAD^{tree}'], { cwd: repo })).stdout.trim()

    await client.commits.reword(head, '고친 제목')
    // 실측 7: staged 없는 amend -F -는 tree 불변 — 메시지만 바뀐다
    const afterTree = (await execGitOrThrow(['rev-parse', 'HEAD^{tree}'], { cwd: repo })).stdout.trim()
    expect(afterTree).toBe(beforeTree)
    expect(
      (await execGitOrThrow(['log', '-1', '--format=%s'], { cwd: repo })).stdout.trim(),
    ).toBe('고친 제목')
    // 미저장 변경은 건드리지 않는다
    expect(await client.files.readText('README.md')).toBe('# 작업 중\n')
  })

  it('reword — 저장 예정(staged)이 있으면 흡수 함정을 막기 위해 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    const head = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
    await writeFixtureFile(repo, 'README.md', '# staged\n')
    await client.changes.stage(['README.md'])

    await expect(client.commits.reword(head, '고친 제목')).rejects.toThrow(/저장 예정에 올린 파일이 있어요/)
    // 메시지도 staged도 그대로다
    expect(
      (await execGitOrThrow(['log', '-1', '--format=%s'], { cwd: repo })).stdout.trim(),
    ).toBe('init')
    expect((await client.repo.status()).changes.find((c) => c.path === 'README.md')?.staged).toBe(
      'modified',
    )
  })

  it('reword — 화면 목록이 낡았으면(HEAD 불일치) 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    const stale = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
    await writeFixtureFile(repo, 'README.md', '# v2\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'v2'], { cwd: repo })

    await expect(client.commits.reword(stale, '고친 제목')).rejects.toThrow(/가장 최근 저장이 바뀌었어요/)
  })

  it('reword — 합치는 중(merging)에는 읽히는 메시지로 거부한다', async () => {
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
    const head = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()

    await expect(client.commits.reword(head, '고친 제목')).rejects.toThrow(/먼저 마무리하거나 취소/)
  })

```

- [ ] **Step 2: Red 확인** — `cd packages/git-adapter && npx vitest run test/client.test.ts` → 신규 **11건 FAIL** 포함(`createTag`·`undoLast`·`reword`가 함수가 아님), 기존은 전부 PASS

- [ ] **Step 3: 구현** — `packages/git-adapter/src/client.ts`

(1) 인터페이스 — Task 2에서 넣은 `    cherryPickAbort(): Promise<void>` 줄 **뒤**에 추가:

```ts
    /** 이 시점에 태그(lightweight)를 만든다 — 이름은 check-ref-format 선검증, 중복은 친절 에러 */
    createTag(name: string, hash: string): Promise<void>
    /**
     * 마지막 저장 실행취소(reset --mixed HEAD~1) — 내용은 작업 폴더에 남는다(실측 8, 유실 없음).
     * hash는 화면이 아는 HEAD — 실제 HEAD와 다르면(낡은 목록) 거부한다. 루트 커밋·진행 중 상태 거부
     */
    undoLast(hash: string): Promise<void>
    /**
     * 마지막 저장의 메시지를 바꾼다(commit --amend -F -, 메시지만 — 실측 7: tree 불변).
     * staged가 있으면 amend가 조용히 흡수하므로 거부. hash는 undoLast와 동일한 HEAD 일치 가드
     */
    reword(hash: string, message: string): Promise<void>
```

(2) 구현 본체 — Task 2에서 넣은 cherryPickAbort 구현의 닫는 `      },` 바로 **뒤**(= `      async revert(hash) {` 앞)에 추가:

```ts
      async createTag(name, hash) {
        const cwd = await topLevel()
        assertFullHash(hash)
        // 태그 이름 선검증 — branch create/rename의 check-ref-format 관례를 태그 네임스페이스로 (실측 9)
        const valid = await execGit(['check-ref-format', `refs/tags/${name}`], { cwd })
        if (valid.exitCode !== 0) {
          throw new Error(`"${name}"라는 이름으로는 만들 수 없어요. 공백 없이 지어 주세요.`)
        }
        const args = ['tag', '--end-of-options', name, hash]
        const result = await execGit(args, { cwd })
        if (result.exitCode !== 0) {
          if (result.stderr.includes('already exists')) {
            throw new Error(`"${name}"는 이미 있는 태그예요. 다른 이름을 지어 주세요.`)
          }
          // 실측 9 stderr: "nonexistent object" — 목록이 낡아 사라진 해시
          if (result.stderr.includes('nonexistent object')) {
            throw new Error(MISSING_COMMIT_MESSAGE)
          }
          throw new GitError(args, result)
        }
      },
      async undoLast(hash) {
        const cwd = await topLevel()
        assertFullHash(hash)
        // merging 등 도중의 reset은 진행 중 작업을 반쯤 무너뜨린다 — revert 관례로 먼저 마무리를 안내한다
        const gitDir = (await execGitOrThrow(['rev-parse', '--absolute-git-dir'], { cwd })).stdout.trim()
        if (detectState(await readGitDirMarkers(gitDir)) !== 'normal') {
          throw new Error('지금 진행 중인 작업을 먼저 마무리하거나 취소해야 실행취소할 수 있어요.')
        }
        // 화면 목록이 낡은 채 실행취소하면 엉뚱한 저장이 물린다(CLI 경합) — 실제 HEAD와 일치를 확인한다
        const head = await execGit(['rev-parse', '-q', '--verify', 'HEAD'], { cwd })
        if (head.exitCode !== 0 || head.stdout.trim() !== hash) {
          throw new Error('가장 최근 저장이 바뀌었어요. 새로고침 후 다시 확인해 주세요.')
        }
        // 루트 커밋(부모 없음) — HEAD~1이 없다(실측 8: 조용히 exit 1). 원문 git 에러 대신 읽히는 메시지로
        const parent = await execGit(['rev-parse', '-q', '--verify', 'HEAD~1'], { cwd })
        if (parent.exitCode !== 0) {
          throw new Error('맨 처음 저장은 실행취소할 수 없어요.')
        }
        // --mixed: 커밋만 물리고 내용은 작업 폴더에 그대로 남긴다 — 유실 없음 (스펙 §6 계열)
        await execGitOrThrow(['reset', '--mixed', 'HEAD~1'], { cwd })
      },
      async reword(hash, message) {
        const cwd = await topLevel()
        assertFullHash(hash)
        const gitDir = (await execGitOrThrow(['rev-parse', '--absolute-git-dir'], { cwd })).stdout.trim()
        if (detectState(await readGitDirMarkers(gitDir)) !== 'normal') {
          throw new Error('지금 진행 중인 작업을 먼저 마무리하거나 취소해야 메시지를 고칠 수 있어요.')
        }
        const head = await execGit(['rev-parse', '-q', '--verify', 'HEAD'], { cwd })
        if (head.exitCode !== 0 || head.stdout.trim() !== hash) {
          throw new Error('가장 최근 저장이 바뀌었어요. 새로고침 후 다시 확인해 주세요.')
        }
        // amend는 staged를 조용히 흡수한다 — 메시지만 바꾸는 의도와 어긋나므로 거부한다 (실측 7: --cached --quiet)
        const staged = await execGit(['diff', '--cached', '--quiet'], { cwd })
        if (staged.exitCode !== 0) {
          throw new Error('저장 예정에 올린 파일이 있어요 — 함께 들어가지 않게 먼저 비워 주세요.')
        }
        // 메시지만 교체(실측 7: staged 없음 + amend -F - → tree 불변) — stdin으로 개행·따옴표 안전
        await execGitOrThrow(['commit', '--amend', '-F', '-'], { cwd, stdin: message })
      },
```

- [ ] **Step 4: Green 확인** — `cd packages/git-adapter && npx vitest run test/client.test.ts` → 신규 11건 포함 전체 PASS

- [ ] **Step 5: 전체 게이트 + Commit** — 루트 `pnpm test` → **340 passed** (329+11)

```bash
git add packages/git-adapter/src/client.ts packages/git-adapter/test/client.test.ts
git commit -m "feat(git-adapter): createTag·undoLast·reword — 태그·실행취소·메시지 고치기 (피드백 5·6)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: IPC 5채널 — contract·main 핸들러·preload

**Files:**
- Modify: `packages/ipc-contract/src/index.ts`
- Modify: `apps/desktop/src/main/git-handlers.ts`
- Modify: `apps/desktop/src/preload/index.ts`

- [ ] **Step 1: contract** — `packages/ipc-contract/src/index.ts`

(1) domain import — 기존:

```ts
import type {
  BranchSummary,
  CommitDetail,
```

교체:

```ts
import type {
  BranchSummary,
  CherryPickResult,
  CommitDetail,
```

(2) GitApi commits — 기존:

```ts
    revert(repoPath: string, hash: string): Promise<RevertResult>
    revertAbort(repoPath: string): Promise<void>
```

교체:

```ts
    revert(repoPath: string, hash: string): Promise<RevertResult>
    revertAbort(repoPath: string): Promise<void>
    /** 이 저장 하나만 지금 공간으로 가져온다(cherry-pick) — 병합 커밋은 거부된다 */
    cherryPick(repoPath: string, hash: string): Promise<CherryPickResult>
    cherryPickAbort(repoPath: string): Promise<void>
    /** 이 시점에 태그(lightweight)를 만든다 — 이름·중복·사라진 해시는 친절 에러 */
    createTag(repoPath: string, name: string, hash: string): Promise<void>
    /** 마지막 저장 실행취소(reset --mixed) — hash는 화면이 아는 HEAD(낡은 목록이면 거부) */
    undoLast(repoPath: string, hash: string): Promise<void>
    /** 마지막 저장 메시지 고치기(amend, 메시지만) — staged가 있으면 거부된다 */
    reword(repoPath: string, hash: string, message: string): Promise<void>
```

(3) CHANNELS — 기존:

```ts
  commitsRevert: 'commits:revert',
  commitsRevertAbort: 'commits:revert-abort',
```

교체:

```ts
  commitsRevert: 'commits:revert',
  commitsRevertAbort: 'commits:revert-abort',
  commitsCherryPick: 'commits:cherry-pick',
  commitsCherryPickAbort: 'commits:cherry-pick-abort',
  commitsCreateTag: 'commits:create-tag',
  commitsUndoLast: 'commits:undo-last',
  commitsReword: 'commits:reword',
```

- [ ] **Step 2: main 핸들러** — `apps/desktop/src/main/git-handlers.ts` 기존:

```ts
  ipcMain.handle(CHANNELS.commitsRevertAbort, (_event, repoPath: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).commits.revertAbort(),
  )
```

교체 (기존 unknown 검증 관례 — assertHash·assertString):

```ts
  ipcMain.handle(CHANNELS.commitsRevertAbort, (_event, repoPath: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).commits.revertAbort(),
  )

  ipcMain.handle(CHANNELS.commitsCherryPick, (_event, repoPath: unknown, hash: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).commits.cherryPick(assertHash(hash)),
  )

  ipcMain.handle(CHANNELS.commitsCherryPickAbort, (_event, repoPath: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).commits.cherryPickAbort(),
  )

  ipcMain.handle(
    CHANNELS.commitsCreateTag,
    (_event, repoPath: unknown, name: unknown, hash: unknown) =>
      createGitClient(assertAllowedRepo(repoPath)).commits.createTag(
        assertString(name),
        assertHash(hash),
      ),
  )

  ipcMain.handle(CHANNELS.commitsUndoLast, (_event, repoPath: unknown, hash: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).commits.undoLast(assertHash(hash)),
  )

  ipcMain.handle(
    CHANNELS.commitsReword,
    (_event, repoPath: unknown, hash: unknown, message: unknown) =>
      createGitClient(assertAllowedRepo(repoPath)).commits.reword(
        assertHash(hash),
        assertString(message),
      ),
  )
```

- [ ] **Step 3: preload** — `apps/desktop/src/preload/index.ts` 기존:

```ts
    revert: (repoPath, hash) => ipcRenderer.invoke(CHANNELS.commitsRevert, repoPath, hash),
    revertAbort: (repoPath) => ipcRenderer.invoke(CHANNELS.commitsRevertAbort, repoPath),
```

교체:

```ts
    revert: (repoPath, hash) => ipcRenderer.invoke(CHANNELS.commitsRevert, repoPath, hash),
    revertAbort: (repoPath) => ipcRenderer.invoke(CHANNELS.commitsRevertAbort, repoPath),
    cherryPick: (repoPath, hash) => ipcRenderer.invoke(CHANNELS.commitsCherryPick, repoPath, hash),
    cherryPickAbort: (repoPath) => ipcRenderer.invoke(CHANNELS.commitsCherryPickAbort, repoPath),
    createTag: (repoPath, name, hash) =>
      ipcRenderer.invoke(CHANNELS.commitsCreateTag, repoPath, name, hash),
    undoLast: (repoPath, hash) => ipcRenderer.invoke(CHANNELS.commitsUndoLast, repoPath, hash),
    reword: (repoPath, hash, message) =>
      ipcRenderer.invoke(CHANNELS.commitsReword, repoPath, hash, message),
```

- [ ] **Step 4: 게이트 + Commit** — 루트 `pnpm typecheck` → 전 프로젝트 Done(**6 Done**, 에러 0), 루트 `pnpm test` → **340 유지**

```bash
git add packages/ipc-contract/src/index.ts apps/desktop/src/main/git-handlers.ts apps/desktop/src/preload/index.ts
git commit -m "feat(desktop): E5b IPC 5채널 — cherry-pick·tag·undo·reword

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: store — 액션 5개

**Files:**
- Modify: `apps/desktop/src/renderer/src/store/repository-store.ts`

- [ ] **Step 1: 액션 시그니처** — 기존:

```ts
  /** 되돌리기 취소 — 확인창(UI 책임) 경유 */
  abortRevert(): Promise<void>
```

교체:

```ts
  /** 되돌리기 취소 — 확인창(UI 책임) 경유 */
  abortRevert(): Promise<void>
  /** 이 저장 하나만 가져오는 새 저장(cherry-pick) — 충돌이면 cherry-picking 상태 바가 안내 */
  cherryPickCommit(hash: string): Promise<void>
  /** 가져오기 취소 — 확인창(UI 책임) 경유 */
  abortCherryPick(): Promise<void>
  /** 이 시점에 태그 만들기 — 성공 여부 반환(실패 시 다이얼로그 유지·입력 보존) */
  createTag(name: string, hash: string): Promise<boolean>
  /** 마지막 저장 실행취소 — 확인창(UI 책임) 경유. 내용은 변경 목록으로 돌아온다 */
  undoLastCommit(hash: string): Promise<void>
  /** 마지막 저장 메시지 고치기 — 성공 여부 반환(실패 시 다이얼로그 유지·입력 보존) */
  rewordLastCommit(hash: string, message: string): Promise<boolean>
```

- [ ] **Step 2: 구현 5개** — 기존:

```ts
      set({
        ...CLEAR_SELECTIONS,
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
        notice: '되돌리기를 취소하고 이전 상태로 돌아왔어요.',
      })
    })
  },
```

교체 (abortRevert 뒤에 5개 액션이 이어진다):

```ts
      set({
        ...CLEAR_SELECTIONS,
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
        notice: '되돌리기를 취소하고 이전 상태로 돌아왔어요.',
      })
    })
  },

  async cherryPickCommit(hash) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      // 자동 보관까지 간 뒤 2차 시도가 실패해도 보관함 카운트가 낡지 않게 — 스냅샷은 finally로 보장 (revert 관례)
      let notice: string | null = null
      try {
        const result = await git().commits.cherryPick(repoPath, hash)
        const notices: Record<typeof result.outcome, string | null> = {
          picked: '이 저장을 가져와 새 저장을 만들었어요.',
          // 충돌 안내는 cherry-picking 상태 바가 담당한다 — 보관 안내만 남긴다
          conflict: null,
          empty: '이미 지금 내용에 들어 있는 저장이에요 — 새로 만든 저장은 없어요.',
        }
        const shelfNotice = result.autoShelved ? ' 저장 안 된 변경은 보관함에 넣어뒀어요.' : ''
        notice = `${notices[result.outcome] ?? ''}${shelfNotice}` || null
      } finally {
        set({
          ...CLEAR_SELECTIONS,
          ...(await fetchSnapshot(repoPath, get().historyLimit)),
          notice,
        })
      }
    })
  },

  async abortCherryPick() {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      await git().commits.cherryPickAbort(repoPath)
      set({
        ...CLEAR_SELECTIONS,
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
        notice: '가져오기를 취소하고 이전 상태로 돌아왔어요.',
      })
    })
  },

  async createTag(name, hash) {
    const { repoPath } = get()
    if (!repoPath) return false
    return guard(set, get, async () => {
      await git().commits.createTag(repoPath, name, hash)
      // 파괴 작업이 아니다 — 보던 것은 유지하고 태그 배지만 스냅샷으로 반영한다
      set({
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
        notice: `"${name}" 태그를 만들었어요.`,
      })
    })
  },

  async undoLastCommit(hash) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      // 이력을 바꾸는 파괴 작업 — 실패해도 낡은 목록을 남기지 않게 스냅샷은 finally로 (discard 관례)
      let notice: string | null = null
      try {
        await git().commits.undoLast(repoPath, hash)
        notice = '마지막 저장을 취소했어요. 바뀐 내용은 왼쪽 변경 목록에 그대로 남아 있어요.'
      } finally {
        set({ ...CLEAR_SELECTIONS, ...(await fetchSnapshot(repoPath, get().historyLimit)), notice })
      }
    })
  },

  async rewordLastCommit(hash, message) {
    const { repoPath } = get()
    if (!repoPath) return false
    return guard(set, get, async () => {
      await git().commits.reword(repoPath, hash, message)
      // HEAD 해시가 바뀐다 — 보던 상세·diff를 비우고 새 목록으로
      set({
        ...CLEAR_SELECTIONS,
        ...(await fetchSnapshot(repoPath, get().historyLimit)),
        notice: '저장 메시지를 고쳤어요.',
      })
    })
  },
```

- [ ] **Step 3: 게이트 + Commit** — 루트 `pnpm typecheck` → 전부 Done, 루트 `pnpm test` → **340 유지**

```bash
git add apps/desktop/src/renderer/src/store/repository-store.ts
git commit -m "feat(desktop): store — cherryPick·abortCherryPick·createTag·undoLast·reword 액션

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: renderer 순수 로직 — `isRemoteRef`·`isHeadBackedUp` + 원격 배지 CSS

**설계 판단:** 원격 판정은 E4 관례의 `origin/` 접두 휴리스틱을 그대로 쓴다(arrangeRefs의 refPriority와 동일 기준 — 폴더형 로컬 `feature/a`를 원격으로 오인하지 않는 안전한 쪽). pushed 판정은 상단의 편차 표대로 순수 함수 `isHeadBackedUp`으로 renderer에 둔다(프레젠테이션·로직 분리).

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/history-refs.ts`
- Create: `apps/desktop/src/renderer/src/components/backup-state.ts`
- Modify: `apps/desktop/src/renderer/src/components/history-panel.css`
- Test: `apps/desktop/test/history-refs.test.ts`, Create: `apps/desktop/test/backup-state.test.ts`

- [ ] **Step 1: 실패하는 테스트 6건**

(1) `apps/desktop/test/history-refs.test.ts` — import 줄 기존:

```ts
import { arrangeRefs } from '../src/renderer/src/components/history-refs'
```

교체:

```ts
import { arrangeRefs, isRemoteRef } from '../src/renderer/src/components/history-refs'
```

파일 맨 끝에 추가:

```ts

describe('isRemoteRef', () => {
  it('origin/ 접두만 원격으로 본다 (E4 휴리스틱 — refPriority와 동일 기준)', () => {
    expect(isRemoteRef('origin/main')).toBe(true)
    expect(isRemoteRef('main')).toBe(false)
  })

  it('폴더형 로컬 이름(feature/a)은 원격이 아니다', () => {
    expect(isRemoteRef('feature/login')).toBe(false)
    expect(isRemoteRef('origin/feature/login')).toBe(true)
  })
})
```

(2) `apps/desktop/test/backup-state.test.ts` 새 파일:

```ts
import { describe, expect, it } from 'vitest'
import { isHeadBackedUp } from '../src/renderer/src/components/backup-state'

describe('isHeadBackedUp', () => {
  it('upstream이 없으면 백업된 적이 없다', () => {
    expect(isHeadBackedUp({ name: 'main', upstream: null, ahead: null, behind: null })).toBe(false)
  })

  it('ahead 0이면 HEAD가 원격에 있다 — 경고 대상', () => {
    expect(isHeadBackedUp({ name: 'main', upstream: 'origin/main', ahead: 0, behind: 0 })).toBe(true)
  })

  it('ahead가 있으면 HEAD 자신은 아직 안 올라갔다', () => {
    expect(isHeadBackedUp({ name: 'main', upstream: 'origin/main', ahead: 2, behind: 0 })).toBe(false)
  })

  it('판정 불가(ahead null)는 보수적으로 백업됐다고 본다 — 경고를 놓치지 않는다', () => {
    expect(isHeadBackedUp({ name: 'main', upstream: 'origin/main', ahead: null, behind: null })).toBe(
      true,
    )
  })
})
```

- [ ] **Step 2: Red 확인** — `cd apps/desktop && npx vitest run test/history-refs.test.ts test/backup-state.test.ts` → **6건 FAIL** (isRemoteRef·backup-state 모듈 없음)

- [ ] **Step 3: 구현**

(1) `apps/desktop/src/renderer/src/components/history-refs.ts` 파일 맨 끝에 추가:

```ts

/**
 * 원격 ref 추정 — decorate 출력의 원격은 "origin/…" 형태다(E4 관례 휴리스틱, refPriority와 동일 기준).
 * 폴더형 로컬 이름(feature/a)과의 구분은 origin/ 접두만 신뢰한다
 */
export function isRemoteRef(ref: string): boolean {
  return ref.startsWith('origin/')
}
```

(2) `apps/desktop/src/renderer/src/components/backup-state.ts` 새 파일:

```ts
import type { BranchInfo } from '@git-gui/domain'

/**
 * 마지막 저장(HEAD)이 원격에 이미 백업됐는가 — 실행취소(undo)·메시지 고치기(amend) 확인창의
 * 경고 병기 판정 (E5b). ahead === 0이면 HEAD ⊆ upstream(백업됨), ahead > 0이면 HEAD 자신이
 * 아직 안 올라갔다. ahead === null(upstream ref 소실 등 판정 불가)은 보수적으로 "백업됐을 수
 * 있음"으로 본다 — 경고를 놓치는 쪽이 원격 어긋남보다 위험하다 (판정 편차 표는 플랜 참조)
 */
export function isHeadBackedUp(branch: BranchInfo): boolean {
  if (branch.upstream === null) return false
  return branch.ahead === 0 || branch.ahead === null
}
```

(3) `apps/desktop/src/renderer/src/components/history-panel.css` 기존:

```css
.history-item__ref--head {
  background: var(--color-selection-bg);
  border-color: var(--color-accent);
  color: var(--color-accent);
}
```

교체:

```css
.history-item__ref--head {
  background: var(--color-selection-bg);
  border-color: var(--color-accent);
  color: var(--color-accent);
}
/* 원격(origin) 배지 — 점선 테두리 + ☁ 접두로 로컬과 시각 구분한다 (피드백 3).
   색은 기존 토큰 그대로라 대비(WCAG)가 유지된다 */
.history-item__ref--remote {
  border-style: dashed;
}
```

- [ ] **Step 4: Green 확인 + 전체 게이트 + Commit** — `cd apps/desktop && npx vitest run test/history-refs.test.ts test/backup-state.test.ts` → 신규 6건 PASS, 루트 `pnpm test` → **346 passed** (340+6)

```bash
git add apps/desktop/src/renderer/src/components/history-refs.ts apps/desktop/src/renderer/src/components/backup-state.ts apps/desktop/src/renderer/src/components/history-panel.css apps/desktop/test/history-refs.test.ts apps/desktop/test/backup-state.test.ts
git commit -m "feat(desktop): 원격 배지 판정·백업됨 판정 순수 로직 + 원격 배지 스타일 (피드백 3)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: HistoryPanel 메뉴 8항목 + "지금 여기" HEAD 추적 + ContextMenu 구분선 + App 3겸용 배선

**설계 판단:**
- **props 폭발 방지(사용자 규칙)** — 커밋 작업 콜백 7개를 낱개 props로 늘리지 않고 단일 `onAction(action: HistoryAction)`(판별 유니언)으로 묶는다. 분기·다이얼로그·store 호출은 App이 담당(로직·프레젠테이션 분리).
- **HEAD 전용 항목(undo·amend)은 숨기지 않고 비활성 + 사유를 라벨에 병기**("— 가장 최근 저장에서만") — ContextMenu disabled 관례("상태를 숨기지 않는다").
- **이동(switch) 항목은 그 커밋에 로컬 브랜치 ref가 있고 현재 브랜치가 아닐 때만 생성** — 원격 배지 휴리스틱 대신 store.branches의 정확한 이름 목록(`localBranches`)과 교집합으로 판별한다. 첫 매치 브랜치가 대상.
- **cherry-pick은 HEAD 행에서도 활성** — 엔진이 empty를 친절히 알린다(실측 5-ⓓ). 태그 만들기는 진행 중 상태와 무관하게 활성(객체만 필요, 비파괴).
- **충돌 뷰 mode 판단(플랜 지시)**: cherry-picking은 **merging 취급**으로 확정 — ConflictPanel의 상대 라벨이 '가져온 것'이고, 이는 "이 저장만 가져오기" 어휘와 정확히 일치한다(reverting만 '되돌린 결과물'로 분기하는 기존 코드가 무변경으로 옳다).

**Files:**
- Modify: `apps/desktop/src/renderer/src/ui/ContextMenu.tsx` (전체 교체)
- Modify: `apps/desktop/src/renderer/src/ui/context-menu.css`
- Modify: `apps/desktop/src/renderer/src/components/HistoryPanel.tsx` (전체 교체)
- Modify: `apps/desktop/src/renderer/src/App.tsx`

- [ ] **Step 1: ContextMenu.tsx 전체를 다음 내용으로 교체** (separator 최소 확장 — 기존 3개 사용처의 items 배열은 타입 넓힘으로 그대로 호환된다)

```tsx
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import './context-menu.css'

export interface ContextMenuItem {
  key: string
  label: string
  /** 지금 상태에서 실행할 수 없는 항목 — 숨기지 않고 비활성으로 보여준다 (상태를 숨기지 않는다) */
  disabled?: boolean
  onSelect(): void
}

/** 구분선 — 항목 그룹 사이 시각 구분 (E5b: 커밋 메뉴가 8항목으로 커졌다) */
export interface ContextMenuSeparator {
  key: string
  separator: true
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuEntry[]
  onClose(): void
}

function isSeparator(entry: ContextMenuEntry): entry is ContextMenuSeparator {
  return 'separator' in entry
}

/** 우클릭 메뉴 — 바깥 클릭·ESC로 닫힌다. 항목 실행 후에도 닫힌다 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    // 스크롤하면 메뉴가 행에서 분리되어 엉뚱한 행을 가리키게 된다 — 닫는다 (리뷰 실측)
    const onWheel = () => onClose()
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', onWheel, { passive: true })
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', onWheel)
    }
  }, [onClose])
  // 화면 가장자리에서 잘리지 않게 최소한만 보정한다 (구분선은 행보다 낮다 — 행 높이 근사치로 충분)
  const left = Math.min(x, window.innerWidth - 240)
  const top = Math.min(y, window.innerHeight - items.length * 34 - 12)
  return createPortal(
    <div ref={ref} className="ui-context-menu" role="menu" style={{ left, top }}>
      {items.map((item) =>
        isSeparator(item) ? (
          <div key={item.key} className="ui-context-menu__separator" role="separator" />
        ) : (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            className="ui-context-menu__item"
            disabled={item.disabled === true}
            onClick={() => {
              item.onSelect()
              onClose()
            }}
            data-testid={`context-${item.key}`}
          >
            {item.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  )
}
```

- [ ] **Step 2: context-menu.css** — 파일 맨 끝에 추가:

```css
.ui-context-menu__separator {
  height: 1px;
  margin: var(--space-1) 0;
  background: var(--color-border);
}
```

- [ ] **Step 3: HistoryPanel.tsx 전체를 다음 내용으로 교체**

```tsx
import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useRef, useState } from 'react'
import type { CommitSummary } from '@git-gui/domain'
import { ContextMenu, type ContextMenuEntry } from '../ui/ContextMenu'
import { Badge } from '../ui/Badge'
import { Panel } from '../ui/Panel'
import { Pictogram } from '../ui/Pictogram'
import { buildGraph, type GraphRow } from './history-graph'
import { arrangeRefs, isRemoteRef } from './history-refs'
import { formatAbsoluteTime, formatRelativeTime } from './relative-time'
import './history-panel.css'
import './virtual.css'

/** 우클릭 메뉴에서 고른 커밋 작업 — 분기·다이얼로그는 App이 담당한다 (data options 패턴: props 폭발 방지) */
export type HistoryAction =
  | { kind: 'switch'; branch: string }
  | { kind: 'branch-here'; hash: string }
  | { kind: 'cherry-pick'; hash: string }
  | { kind: 'revert'; hash: string }
  | { kind: 'undo'; hash: string }
  | { kind: 'reword'; hash: string; subject: string }
  | { kind: 'tag'; hash: string }

interface HistoryPanelProps {
  history: CommitSummary[]
  /** 현재 조회 상한 — 목록이 상한에 닿으면 "N+"로 표기하고, 스크롤 끝에서 더 불러온다 (⑩) */
  historyLimit: number
  /** 현재 브랜치 — 같은 이름의 ref 배지를 강조한다 */
  currentBranch: string | null
  /** HEAD 커밋 해시 — "지금 여기" 마커가 이 행을 따라간다 (피드백 4). unborn이면 null */
  headHash: string | null
  /** 로컬 실험 공간 이름 전체 — "이동(switch)" 메뉴 대상 판별(원격 배지 휴리스틱과 달리 정확한 목록) */
  localBranches: string[]
  selectedHash: string | null
  busy: boolean
  /** merging 등 진행 중에는 이력 조작(이동·가져오기·되돌리기·실행취소·메시지 고치기)을 비활성 */
  actionsDisabled: boolean
  onSelect(hash: string): void
  onLoadMore(): void
  onAction(action: HistoryAction): void
}

/** 레인 간격·행 높이 — 행 높이는 고정이라 그래프 좌표가 단순해진다 (measureElement 불필요) */
const LANE_WIDTH = 12
const ROW_HEIGHT = 52
const NODE_Y = ROW_HEIGHT / 2
/** 레인 색 — 위치가 1차 신호, 색은 보조(색약 대응: 인접 레인이 형태·위치로 구분된다) */
const LANE_COLORS = [
  'var(--concept-commit)',
  'var(--concept-branch)',
  'var(--concept-mine)',
  'var(--concept-shelf)',
  'var(--concept-backup)',
  'var(--concept-conflict)',
]

function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length]!
}

function laneX(lane: number): number {
  return lane * LANE_WIDTH + LANE_WIDTH / 2
}

/** 한 행의 그래프 거터 — 세로선(pass), 위→점 합류(join), 점→아래 분기(fork), 커밋 점 */
function GraphCell({ row, isHead }: { row: GraphRow; isHead: boolean }) {
  const width = row.laneCount * LANE_WIDTH
  const nodeX = laneX(row.nodeLane)
  return (
    <svg
      className="history-item__graph"
      width={width}
      height={ROW_HEIGHT}
      viewBox={`0 0 ${width} ${ROW_HEIGHT}`}
      aria-hidden="true"
    >
      {row.passLanes.map((lane) => (
        <line
          key={`pass-${lane}`}
          x1={laneX(lane)}
          y1={0}
          x2={laneX(lane)}
          y2={ROW_HEIGHT}
          stroke={laneColor(lane)}
          strokeWidth={2}
        />
      ))}
      {/* 점의 레인이 위에서 내려올 때만 위쪽 선을 그린다 — 첫 행·새 갈래 머리의 stub 방지 */}
      {row.hasIncoming && (
        <line
          x1={nodeX}
          y1={0}
          x2={nodeX}
          y2={NODE_Y}
          stroke={laneColor(row.nodeLane)}
          strokeWidth={2}
        />
      )}
      {row.joinLanes.map((lane) => (
        <path
          key={`join-${lane}`}
          d={`M ${laneX(lane)} 0 C ${laneX(lane)} ${NODE_Y * 0.7}, ${nodeX} ${NODE_Y * 0.5}, ${nodeX} ${NODE_Y}`}
          stroke={laneColor(lane)}
          strokeWidth={2}
          fill="none"
        />
      ))}
      {row.forkLanes.map((lane) => (
        <path
          key={`fork-${lane}`}
          d={
            lane === row.nodeLane
              ? `M ${nodeX} ${NODE_Y} L ${nodeX} ${ROW_HEIGHT}`
              : `M ${nodeX} ${NODE_Y} C ${nodeX} ${NODE_Y * 1.5}, ${laneX(lane)} ${NODE_Y * 1.3}, ${laneX(lane)} ${ROW_HEIGHT}`
          }
          stroke={laneColor(lane)}
          strokeWidth={2}
          fill="none"
        />
      ))}
      <circle
        cx={nodeX}
        cy={NODE_Y}
        r={4.5}
        fill={isHead ? laneColor(row.nodeLane) : 'var(--color-surface)'}
        stroke={laneColor(row.nodeLane)}
        strokeWidth={2}
      />
    </svg>
  )
}

export function HistoryPanel({
  history,
  historyLimit,
  currentBranch,
  headHash,
  localBranches,
  selectedHash,
  busy,
  actionsDisabled,
  onSelect,
  onLoadMore,
  onAction,
}: HistoryPanelProps) {
  const [menu, setMenu] = useState<{ x: number; y: number; commit: CommitSummary } | null>(null)
  const truncated = history.length >= historyLimit
  // 수천 커밋에서도 DOM은 가시 범위만 유지한다 (#4)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  // 레인 그래프 — 목록이 바뀔 때마다 전체를 다시 배정한다 (E5b 실측: --all 5,003커밋 2.8ms — 무해)
  const graph = buildGraph(history)
  const virtualizer = useVirtualizer({
    count: history.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 52,
    overscan: 10,
  })
  const virtualItems = virtualizer.getVirtualItems()
  const lastRendered = virtualItems[virtualItems.length - 1]?.index ?? -1

  // 마지막 행이 렌더 범위에 들어오면 다음 페이지를 불러온다 (⑩) — busy·상한은 store가 이중 방어한다
  useEffect(() => {
    if (truncated && !busy && lastRendered >= history.length - 1) onLoadMore()
  }, [truncated, busy, lastRendered, history.length, onLoadMore])

  // 메뉴 8항목 + 구분선 — HEAD 전용 항목은 숨기지 않고 사유와 함께 비활성 (상태를 숨기지 않는다)
  const buildMenu = (commit: CommitSummary): ContextMenuEntry[] => {
    const isHead = commit.hash === headHash
    // 이 커밋을 끝으로 갖는 첫 로컬 실험 공간 — 현재 공간이면 이동 항목을 만들지 않는다
    const switchTarget =
      commit.refs.find((ref) => ref !== currentBranch && localBranches.includes(ref)) ?? null
    const entries: ContextMenuEntry[] = []
    if (switchTarget !== null) {
      entries.push({
        key: 'switch-here',
        label: `"${switchTarget}" 실험 공간으로 이동 (switch)`,
        disabled: actionsDisabled,
        onSelect: () => onAction({ kind: 'switch', branch: switchTarget }),
      })
    }
    entries.push(
      {
        key: 'branch-here',
        label: '여기서 실험 공간 만들기…',
        onSelect: () => onAction({ kind: 'branch-here', hash: commit.hash }),
      },
      { key: 'sep-1', separator: true },
      {
        key: 'cherry-pick',
        label: '이 저장만 가져오기 (cherry-pick)',
        disabled: actionsDisabled,
        onSelect: () => onAction({ kind: 'cherry-pick', hash: commit.hash }),
      },
      {
        key: 'revert',
        label: '이 저장 되돌리기 (revert)',
        disabled: actionsDisabled,
        onSelect: () => onAction({ kind: 'revert', hash: commit.hash }),
      },
      {
        key: 'undo-last',
        label: isHead ? '저장 실행취소 (undo)' : '저장 실행취소 (undo) — 가장 최근 저장에서만',
        disabled: actionsDisabled || !isHead,
        onSelect: () => onAction({ kind: 'undo', hash: commit.hash }),
      },
      {
        key: 'reword',
        label: isHead
          ? '저장 메시지 고치기… (amend)'
          : '저장 메시지 고치기 (amend) — 가장 최근 저장에서만',
        disabled: actionsDisabled || !isHead,
        onSelect: () => onAction({ kind: 'reword', hash: commit.hash, subject: commit.subject }),
      },
      {
        key: 'tag-here',
        label: '태그 만들기… (tag)',
        onSelect: () => onAction({ kind: 'tag', hash: commit.hash }),
      },
      { key: 'sep-2', separator: true },
      {
        key: 'copy-hash',
        label: `해시 복사 (${commit.shortHash})`,
        onSelect: () => {
          void navigator.clipboard.writeText(commit.hash)
        },
      },
    )
    return entries
  }

  return (
    <Panel
      title="저장된 역사"
      accessory={
        <>
          <Badge tone="git">log</Badge>
          <Badge tone="count">
            <span data-testid="history-count">
              {truncated ? `${historyLimit}+` : history.length}
            </span>
          </Badge>
        </>
      }
      testId="history-panel"
    >
      {history.length === 0 ? (
        <div className="history-panel__empty">
          <Pictogram kind="commit" size={20} label="저장 시점" />
          <p>
            아직 저장된 시점이 없어요.
            <br />
            저장할 때마다 여기에 쌓여요.
          </p>
        </div>
      ) : (
        <div ref={scrollRef} className="virtual-scroll" data-testid="history-scroll">
          <ol
            className="history-panel__list"
            data-testid="history-list"
            style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
          >
            {virtualItems.map((item) => {
              const commit = history[item.index]!
              // "지금 여기"는 index 0 고정이 아니라 HEAD 커밋 행을 따라간다 (피드백 4 — --all에서는 다를 수 있다)
              const isHead = commit.hash === headHash
              return (
                <li
                  key={commit.hash}
                  className="virtual-row"
                  style={{ height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
                >
                  <button
                    type="button"
                    className={[
                      'history-item',
                      isHead ? 'history-item--head' : '',
                      selectedHash === commit.hash ? 'history-item--selected' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    disabled={busy}
                    onClick={() => onSelect(commit.hash)}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      setMenu({ x: event.clientX, y: event.clientY, commit })
                    }}
                    title={`${commit.subject}\n${formatAbsoluteTime(commit.committedAt)} · ${commit.authorName}`}
                    aria-current={selectedHash === commit.hash ? 'true' : undefined}
                    data-testid={`history-item-${commit.hash}`}
                  >
                    <GraphCell row={graph[item.index]!} isHead={isHead} />
                    <div className="history-item__body">
                      <span className="history-item__title">
                        {isHead && <span className="history-item__here">지금 여기</span>}
                        {(() => {
                          // 배지 폭 경쟁으로 전부 말줄임되는 것을 막는다 — 상위 2개 + "+N" 접기 (피드백)
                          const arranged = arrangeRefs(commit.refs, currentBranch)
                          return (
                            <>
                              {arranged.visible.map((ref) => (
                                <span
                                  key={ref}
                                  title={ref}
                                  className={[
                                    'history-item__ref',
                                    ref === currentBranch ? 'history-item__ref--head' : '',
                                    // 원격은 ☁ 접두 + 점선으로 구분한다 (피드백 3)
                                    isRemoteRef(ref) ? 'history-item__ref--remote' : '',
                                  ]
                                    .filter(Boolean)
                                    .join(' ')}
                                >
                                  {isRemoteRef(ref) ? `☁ ${ref}` : ref}
                                </span>
                              ))}
                              {arranged.hidden.length > 0 && (
                                <span
                                  className="history-item__ref history-item__ref--more"
                                  title={arranged.hidden
                                    .map((ref) => (isRemoteRef(ref) ? `☁ ${ref}` : ref))
                                    .join('\n')}
                                  data-testid={`history-refs-more-${commit.hash}`}
                                >
                                  +{arranged.hidden.length}
                                </span>
                              )}
                            </>
                          )
                        })()}
                        {commit.parents.length >= 2 && (
                          <span className="history-item__mergemark">병합</span>
                        )}
                        <span className="history-item__subject" title={commit.subject}>
                          {commit.subject}
                        </span>
                      </span>
                      <span className="history-item__meta">
                        {formatRelativeTime(commit.committedAt, Date.now())} · {commit.authorName}
                      </span>
                    </div>
                    <span className="history-item__hash">{commit.shortHash}</span>
                  </button>
                </li>
              )
            })}
          </ol>
          {truncated && (
            <div className="history-panel__more" aria-hidden="true">
              이전 기록 불러오는 중…
            </div>
          )}
        </div>
      )}
      {menu !== null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildMenu(menu.commit)}
          onClose={() => setMenu(null)}
        />
      )}
    </Panel>
  )
}
```

- [ ] **Step 4: App.tsx 배선** — 앵커별 교체:

(1) import — 기존:

```tsx
import { BranchSwitcher } from './components/BranchSwitcher'
```

교체:

```tsx
import { isHeadBackedUp } from './components/backup-state'
import { BranchSwitcher } from './components/BranchSwitcher'
```

(2) OP_BAR 상수 — 기존:

```tsx
  bisecting: '원인 찾는 중',
}
```

교체:

```tsx
  bisecting: '원인 찾는 중',
}

/** 진행 중 작업 상태 바 문구 — merging/reverting/cherry-picking 3겸용 (E5b) */
const OP_BAR = {
  merging: { doing: '실험 공간 합치는 중', abort: '합치기 취소' },
  reverting: { doing: '저장 되돌리는 중', abort: '되돌리기 취소' },
  'cherry-picking': { doing: '저장 가져오는 중', abort: '가져오기 취소' },
} as const
```

(3) 다이얼로그 상태 — 기존:

```tsx
  const [confirmingAbort, setConfirmingAbort] = useState(false)
```

교체:

```tsx
  const [confirmingAbort, setConfirmingAbort] = useState(false)

  // E5b 커밋 작업 다이얼로그 — 태그 이름·실행취소 확인·메시지 고치기 (대상 커밋 정보를 함께 보관)
  const [tagPrompt, setTagPrompt] = useState<{ hash: string } | null>(null)
  const [confirmingUndo, setConfirmingUndo] = useState<{ hash: string } | null>(null)
  const [rewordPrompt, setRewordPrompt] = useState<{ hash: string; subject: string } | null>(null)
```

(4) headBackedUp 계산 — 기존:

```tsx
  const repoName = store.repoPath.split('/').pop() ?? store.repoPath
```

교체:

```tsx
  const repoName = store.repoPath.split('/').pop() ?? store.repoPath
  // 마지막 저장(HEAD)이 원격에 이미 백업됐는가 — 실행취소·메시지 고치기 확인창의 경고 병기 (판정 편차는 플랜 표)
  const headBackedUp = status !== null && isHeadBackedUp(status.branch)
```

(5) 상단 레이어 조건 — 기존:

```tsx
      {(status?.state === 'merging' ||
        status?.state === 'reverting' ||
        store.error !== null ||
        store.notice !== null) && (
```

교체:

```tsx
      {(status?.state === 'merging' ||
        status?.state === 'reverting' ||
        status?.state === 'cherry-picking' ||
        store.error !== null ||
        store.notice !== null) && (
```

(6) 상태 바 3겸용 — 기존:

```tsx
            {(status?.state === 'merging' || status?.state === 'reverting') && (
              <div className="app__merge-bar" data-testid="merge-bar">
                <Pictogram
                  kind="conflict"
                  size={14}
                  label={status.state === 'merging' ? '합치는 중' : '되돌리는 중'}
                />
                <span className="app__merge-text" data-testid="merge-remaining">
                  {`${status.state === 'merging' ? '실험 공간 합치는 중' : '저장 되돌리는 중'} — ${
                    conflictCount > 0
                      ? `겹침 ${conflictCount}개 남음. 붉은 ! 파일에서 한쪽을 고르고, 다 정리되면 저장하기로 마무리해요.`
                      : status.state === 'reverting' && stagedCount === 0
                        ? '겹침 0개 남음. 전부 내 것을 유지해서 바뀌는 내용이 없어요 — 되돌리기 취소를 눌러 마무리해요.'
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
                  {status.state === 'merging' ? '합치기 취소' : '되돌리기 취소'}
                </Button>
              </div>
            )}
```

교체:

```tsx
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

(7) 충돌 뷰 mode 판단 명시 — 기존:

```tsx
              mode={status?.state === 'reverting' ? 'reverting' : 'merging'}
```

교체:

```tsx
              // cherry-picking은 merging 취급 — 상대 라벨 '가져온 것'이 "이 저장만 가져오기" 어휘와 일치한다 (E5b 설계 판단)
              mode={status?.state === 'reverting' ? 'reverting' : 'merging'}
```

(8) HistoryPanel 배선 — 기존:

```tsx
          <HistoryPanel
            history={store.history}
            historyLimit={store.historyLimit}
            currentBranch={status?.branch.name ?? null}
            selectedHash={null}
            busy={store.busy}
            onSelect={(hash) => void store.selectCommit(hash)}
            onLoadMore={() => void store.loadMoreHistory()}
            revertDisabled={status?.state !== 'normal'}
            onCreateBranchAt={(hash) => {
              store.clearError()
              setBranchPrompt({ fromHash: hash })
            }}
            onRevert={(hash) => void store.revertCommit(hash)}
          />
```

교체:

```tsx
          <HistoryPanel
            history={store.history}
            historyLimit={store.historyLimit}
            currentBranch={status?.branch.name ?? null}
            headHash={status?.headHash ?? null}
            localBranches={store.branches.map((branch) => branch.name)}
            selectedHash={null}
            busy={store.busy}
            actionsDisabled={status?.state !== 'normal'}
            onSelect={(hash) => void store.selectCommit(hash)}
            onLoadMore={() => void store.loadMoreHistory()}
            onAction={(action) => {
              switch (action.kind) {
                case 'switch':
                  void store.switchBranch(action.branch)
                  break
                case 'branch-here':
                  store.clearError()
                  setBranchPrompt({ fromHash: action.hash })
                  break
                case 'cherry-pick':
                  void store.cherryPickCommit(action.hash)
                  break
                case 'revert':
                  void store.revertCommit(action.hash)
                  break
                case 'undo':
                  setConfirmingUndo({ hash: action.hash })
                  break
                case 'reword':
                  store.clearError()
                  setRewordPrompt({ hash: action.hash, subject: action.subject })
                  break
                case 'tag':
                  store.clearError()
                  setTagPrompt({ hash: action.hash })
                  break
              }
            }}
          />
```

(9) 취소 확인창 3겸용 + 신규 다이얼로그 3개 — 기존:

```tsx
      <ConfirmDialog
        isOpen={confirmingAbort}
        title={status?.state === 'reverting' ? '되돌리기를 취소할까요?' : '합치기를 취소할까요?'}
        confirmLabel={status?.state === 'reverting' ? '되돌리기 취소' : '합치기 취소'}
        onConfirm={() => {
          setConfirmingAbort(false)
          if (status?.state === 'reverting') void store.abortRevert()
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
      <PromptDialog
        isOpen={tagPrompt !== null}
        title="태그 만들기"
        description="이 저장 시점에 이름표(태그)를 붙여요. 역사 목록에 배지로 함께 보여요."
        label="태그 이름"
        placeholder="예: v1.0"
        submitLabel="만들기"
        errorText={tagPrompt !== null ? store.error : null}
        onSubmit={(name) => {
          void (async () => {
            const prompt = tagPrompt
            if (prompt === null) return
            // 실패하면 다이얼로그를 유지해 입력을 보존한다 — 에러는 인라인으로 (branchPrompt 관례)
            if (await store.createTag(name, prompt.hash)) setTagPrompt(null)
          })()
        }}
        onCancel={() => setTagPrompt(null)}
      />
      <ConfirmDialog
        isOpen={confirmingUndo !== null}
        title="마지막 저장을 실행취소할까요?"
        confirmLabel="실행취소"
        onConfirm={() => {
          const hash = confirmingUndo?.hash ?? null
          setConfirmingUndo(null)
          if (hash !== null) void store.undoLastCommit(hash)
        }}
        onCancel={() => setConfirmingUndo(null)}
      >
        저장만 취소하고 바뀐 내용은 그대로 남아요 — 왼쪽 변경 목록에서 다시 저장할 수 있어요.
        {headBackedUp && ' 이미 백업된 저장이에요 — 취소하면 원격과 어긋나요.'}
      </ConfirmDialog>
      <PromptDialog
        isOpen={rewordPrompt !== null}
        title="저장 메시지 고치기"
        description={`가장 최근 저장의 메시지를 새 한 줄로 바꿔요. 본문이 있었다면 함께 이 한 줄로 바뀌어요.${
          headBackedUp ? ' 이미 백업된 저장이에요 — 고치면 원격과 어긋나요.' : ''
        }`}
        label="메시지"
        placeholder="예: 로그인 버튼 색 수정"
        submitLabel="고치기"
        initialValue={rewordPrompt?.subject ?? ''}
        errorText={rewordPrompt !== null ? store.error : null}
        onSubmit={(message) => {
          void (async () => {
            const prompt = rewordPrompt
            if (prompt === null) return
            if (await store.rewordLastCommit(prompt.hash, message)) setRewordPrompt(null)
          })()
        }}
        onCancel={() => setRewordPrompt(null)}
      />
```

- [ ] **Step 5: 게이트 + 실렌더 확인** — 루트 `pnpm typecheck` 전부 Done, 루트 `pnpm test` → **346 유지**. `pnpm --filter @git-gui/desktop dev`로 실행해 확인:
  1. 브랜치 2개 저장소에서 히스토리에 **두 브랜치 커밋이 모두** 보이고, "지금 여기"가 HEAD 행에(브랜치 전환 후 이동 확인),
  2. push된 저장소에서 `☁ origin/main` 배지가 점선 테두리로 구분,
  3. 커밋 우클릭 → 8항목 + 구분선 2개(HEAD 행: 실행취소·메시지 고치기 활성 / 다른 행: "— 가장 최근 저장에서만" 사유와 함께 비활성 / 다른 로컬 브랜치 끝 커밋: "…로 이동 (switch)" 항목),
  4. cherry-pick 충돌 → 상태 바 "저장 가져오는 중 — 겹침 N개 남음"·버튼 "가져오기 취소" → 확인창 "가져오기를 취소할까요?" → 취소 복귀,
  5. HEAD 커밋 cherry-pick → "이미 지금 내용에 들어 있는 저장이에요" notice(상태 오염 없음),
  6. 태그 만들기 → 배지 즉시 반영, 실행취소 → 변경 목록 복귀, 메시지 고치기 → 제목 초기값 채워짐·변경 반영,
  7. (upstream 있는 저장소, ahead 0) 실행취소·메시지 고치기 확인창에 "이미 백업된 저장이에요" 경고 병기.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/ui/ContextMenu.tsx apps/desktop/src/renderer/src/ui/context-menu.css apps/desktop/src/renderer/src/components/HistoryPanel.tsx apps/desktop/src/renderer/src/App.tsx
git commit -m "feat(desktop): 히스토리 전체 그래프 UI — HEAD 마커·원격 배지·커밋 메뉴 8항목·상태 바 3겸용 (피드백 3·4·5·6)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: E2E — 기존 2건 갱신 + 신규 4건 + 검출력 변이 1건

**Files:**
- Modify: `apps/desktop/e2e/smoke.spec.ts`

- [ ] **Step 1: --all로 깨지는 기존 단언 2건 갱신** (전수 조사 표 참조)

(1) 기존:

```ts
    await expect(window.getByTestId('header-branch')).toContainText('from-root')
    // root 시점으로 이동했으므로 역사는 1개
    await expect(window.getByTestId('history-count')).toHaveText('1')
```

교체:

```ts
    await expect(window.getByTestId('header-branch')).toContainText('from-root')
    // 전체 그래프(--all) — root로 이동해도 main의 커밋까지 2개가 그대로 보인다 (E5b)
    await expect(window.getByTestId('history-count')).toHaveText('2')
    // "지금 여기"는 이동한 root 커밋 행을 따라온다
    const rootHash = (
      await execGitOrThrow(['rev-list', '--max-parents=0', 'HEAD'], { cwd: repo })
    ).stdout.trim()
    await expect(window.getByTestId(`history-item-${rootHash}`)).toContainText('지금 여기')
```

(2) 기존:

```ts
    const window = await app.firstWindow()
    await expect(window.getByTestId('history-count')).toHaveText('1')
    await window.getByTestId('merge-open').click()
```

교체:

```ts
    const window = await app.firstWindow()
    // 전체 그래프(--all) — 합치기 전에도 exp의 커밋이 함께 보인다 (E5b)
    await expect(window.getByTestId('history-count')).toHaveText('2')
    await window.getByTestId('merge-open').click()
```

- [ ] **Step 2: 신규 테스트 4건** — 파일 맨 끝(마지막 test 블록 뒤)에 추가:

```ts
test('히스토리 전체 그래프 — 다른 실험 공간·원격(☁)이 함께 보이고 "지금 여기"가 나를 따라온다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  const remote = await addBareRemote(repo)
  await execGitOrThrow(['push', '-u', 'origin', 'main'], { cwd: repo })
  await execGitOrThrow(['checkout', '-b', 'other'], { cwd: repo })
  await writeFile(join(repo, 'other.txt'), 'o\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', 'other 저장'], { cwd: repo })
  await execGitOrThrow(['checkout', 'main'], { cwd: repo })
  // 보관함(stash) 커밋은 전체 그래프에 나타나면 안 된다 — 픽스처에 하나 심는다 (검출력 변이 대상)
  await writeFile(join(repo, 'app.txt'), 'dirty\n')
  await execGitOrThrow(['stash', 'push', '-u', '-m', '픽스처 보관'], { cwd: repo })
  const mainHash = (await execGitOrThrow(['rev-parse', 'main'], { cwd: repo })).stdout.trim()
  const otherHash = (await execGitOrThrow(['rev-parse', 'other'], { cwd: repo })).stdout.trim()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    // main(=origin/main 동일 해시 dedup) 1개 + other 1개 — stash WIP 커밋은 제외된다
    await expect(window.getByTestId('history-count')).toHaveText('2')
    await expect(window.getByTestId('history-list')).not.toContainText('픽스처 보관')
    // 원격 배지 — origin/은 ☁ 접두로 로컬과 구분된다 (피드백 3)
    await expect(window.getByTestId('history-list')).toContainText('☁ origin/main')
    // "지금 여기"는 index 0(최신 행 = other)이 아니라 HEAD(main) 행에 붙는다 (피드백 4)
    await expect(window.getByTestId(`history-item-${mainHash}`)).toContainText('지금 여기')
    await expect(window.getByTestId(`history-item-${otherHash}`)).not.toContainText('지금 여기')
    // 전환하면 마커가 따라온다 — 목록은 그대로 전체
    await window.getByTestId('header-branch').click()
    await window.getByTestId('branch-item-other').click()
    await expect(window.getByTestId('header-branch')).toContainText('other')
    await expect(window.getByTestId('history-count')).toHaveText('2')
    await expect(window.getByTestId(`history-item-${otherHash}`)).toContainText('지금 여기')
    await expect(window.getByTestId(`history-item-${mainHash}`)).not.toContainText('지금 여기')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(remote, { recursive: true, force: true })
  }
})

test('이 저장만 가져오기 (cherry-pick) — 성공과 충돌·취소', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  // 깔끔히 가져올 수 있는 저장(새 파일)과 겹치는 저장(app.txt 수정)을 각각 다른 공간에 만든다
  await execGitOrThrow(['checkout', '-b', 'feature'], { cwd: repo })
  await writeFile(join(repo, 'feature.txt'), 'f\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', '기능 저장'], { cwd: repo })
  await execGitOrThrow(['checkout', '-b', 'rival', 'main'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'rival\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', 'rival 저장'], { cwd: repo })
  await execGitOrThrow(['checkout', 'main'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'mine\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', 'mine 저장'], { cwd: repo })
  const featureHash = (await execGitOrThrow(['rev-parse', 'feature'], { cwd: repo })).stdout.trim()
  const rivalHash = (await execGitOrThrow(['rev-parse', 'rival'], { cwd: repo })).stdout.trim()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('history-count')).toHaveText('4')
    // (1) 깔끔한 가져오기 — 새 저장이 생기고 파일이 도착한다
    await window.getByTestId(`history-item-${featureHash}`).click({ button: 'right' })
    await window.getByTestId('context-cherry-pick').click()
    await expect(window.getByTestId('notice')).toContainText('가져와 새 저장을 만들었어요')
    await expect(window.getByTestId('history-count')).toHaveText('5')
    expect(await readFile(join(repo, 'feature.txt'), 'utf8')).toBe('f\n')
    // (2) 겹치는 가져오기 — cherry-picking 상태 바가 뜨고 취소로 돌아온다
    await window.getByTestId(`history-item-${rivalHash}`).click({ button: 'right' })
    await window.getByTestId('context-cherry-pick').click()
    await expect(window.getByTestId('merge-bar')).toContainText('저장 가져오는 중')
    await expect(window.getByTestId('merge-abort')).toHaveText('가져오기 취소')
    await window.getByTestId('merge-abort').click()
    await window.getByTestId('confirm-accept').click()
    await expect(window.getByTestId('merge-bar')).toHaveCount(0)
    await expect(window.getByTestId('notice')).toContainText('가져오기를 취소')
    await expect(window.getByTestId('history-count')).toHaveText('5')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('태그 만들기 (tag) — 배지로 나타난다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await window.locator('[data-testid^="history-item-"]').first().click({ button: 'right' })
    await window.getByTestId('context-tag-here').click()
    await window.getByTestId('prompt-input').fill('v1.0')
    await window.getByTestId('prompt-submit').click()
    await expect(window.getByTestId('notice')).toContainText('태그를 만들었어요')
    // 태그는 --all 그래프의 decorate 배지로 자동 반영된다 (실측 9)
    await expect(window.getByTestId('history-list')).toContainText('v1.0')
    const tags = await execGitOrThrow(['tag', '--list'], { cwd: repo })
    expect(tags.stdout.trim()).toBe('v1.0')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('저장 실행취소 (undo)와 메시지 고치기 (amend)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', '두 번째 저장'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('history-count')).toHaveText('2')
    await expect(window.getByTestId('unstaged-count')).toHaveText('0')
    // HEAD가 아닌 행에서는 실행취소·메시지 고치기가 사유와 함께 비활성이다
    await window.locator('[data-testid^="history-item-"]').last().click({ button: 'right' })
    await expect(window.getByTestId('context-undo-last')).toBeDisabled()
    await expect(window.getByTestId('context-reword')).toBeDisabled()
    await window.keyboard.press('Escape')
    // 실행취소 — 확인창은 내용이 남는다는 안내를 담는다
    await window.locator('[data-testid^="history-item-"]').first().click({ button: 'right' })
    await window.getByTestId('context-undo-last').click()
    await expect(window.getByRole('alertdialog')).toContainText('바뀐 내용은 그대로 남아요')
    await window.getByTestId('confirm-accept').click()
    await expect(window.getByTestId('history-count')).toHaveText('1')
    // 취소된 저장의 내용(v2)이 변경 목록으로 돌아왔다 — 유실 없음
    await expect(window.getByTestId('unstaged-count')).toHaveText('1')
    expect(await readFile(join(repo, 'app.txt'), 'utf8')).toBe('v2\n')
    // 메시지 고치기 — 남은 HEAD(init)의 제목이 초기값으로 채워진다
    await window.locator('[data-testid^="history-item-"]').first().click({ button: 'right' })
    await window.getByTestId('context-reword').click()
    await expect(window.getByTestId('prompt-input')).toHaveValue('init')
    await window.getByTestId('prompt-input').fill('고친 첫 저장')
    await window.getByTestId('prompt-submit').click()
    await expect(window.getByTestId('history-list')).toContainText('고친 첫 저장')
    const log = await execGitOrThrow(['log', '-1', '--format=%s'], { cwd: repo })
    expect(log.stdout.trim()).toBe('고친 첫 저장')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})
```

- [ ] **Step 3: E2E 실행** — `pnpm --filter @git-gui/desktop e2e` → **42 passed** (smoke 36 + hosting 6)

- [ ] **Step 4: 검출력 변이 실증 1건** — `packages/git-adapter/src/client.ts`의 history.list 인자에서 다음 한 줄을 임시 삭제:

```ts
          '--exclude=refs/stash',
```

그리고 (앱은 빌드 산출물을 실행하므로 **반드시 재빌드 후**) `cd apps/desktop && npx electron-vite build && npx playwright test e2e/smoke.spec.ts -g "히스토리 전체 그래프"` 실행 → **FAIL** 확인(기대 history-count '2', 실측 stash WIP 커밋 노출로 상승 + '픽스처 보관' 텍스트 등장 — 보관함이 역사를 오염시키는 회귀를 이 테스트가 잡는다). 확인 즉시 원복하고 `npx electron-vite build && npx playwright test e2e/smoke.spec.ts -g "히스토리 전체 그래프"` 재실행 → PASS. 변이 결과(FAIL 단언 위치)를 작업 로그에 남긴다.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/e2e/smoke.spec.ts
git commit -m "test(e2e): E5b 4건 — 전체 그래프·cherry-pick 충돌 바·태그·undo/amend + --all 단언 갱신 2건

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: 최종 게이트 + 공식 스크린샷 3장 + README

- [ ] **Step 1: 전체 게이트** — 순서대로 전부 exit 0:
  - 루트 `pnpm test` → **346 passed**
  - 루트 `pnpm typecheck` → 전 프로젝트 Done
  - `pnpm --filter @git-gui/desktop build`
  - `pnpm --filter @git-gui/desktop e2e` → **42 passed**

- [ ] **Step 2: README 한 줄** — `README.md` 기존:

```
좌측 변경 목록에서 올리기/내리기/이 파일만 되돌리기/파일 삭제.
```

교체:

```
좌측 변경 목록에서 올리기/내리기/이 파일만 되돌리기/파일 삭제. E5b로 히스토리가 전체 그래프(--all)로 바뀌었습니다 — 로컬·원격(☁)·태그를 한 화면에서 보고 "지금 여기" 마커가 HEAD를 따라가며, 커밋 우클릭으로 실험 공간 이동(switch)·이 저장만 가져오기(cherry-pick, 충돌 시 상태 바·취소)·저장 실행취소(undo, 내용 보존)·메시지 고치기(amend)·태그 만들기(tag)를 할 수 있습니다.
```

- [ ] **Step 3: 공식 스크린샷 3장** (1440×900, `test-results/` + scratchpad `<temporary-scratchpad>/` 사본, **생성 후 e2e 재실행 금지** — 재실행하면 test-results가 갈린다)

임시 파일 `apps/desktop/e2e/screens-e5b.spec.ts`를 다음 내용으로 만들고:

```ts
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { execGitOrThrow } from '@git-gui/git-process'

const APP_ROOT = join(__dirname, '..')
const SCRATCH =
  '<temporary-scratchpad>'

test('공식 스크린샷 — E5b 전체 그래프·커밋 메뉴·가져오기 바 3장 (1440×900)', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'git-gui-shot-'))
  await execGitOrThrow(['init', '--initial-branch=main'], { cwd: repo })
  await execGitOrThrow(['config', 'user.name', 'E2E'], { cwd: repo })
  await execGitOrThrow(['config', 'user.email', 'e2e@test.local'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'v1\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', '화면 구성 저장'], { cwd: repo })
  const remote = await mkdtemp(join(tmpdir(), 'git-gui-shot-remote-'))
  await execGitOrThrow(['init', '--bare', '--initial-branch=main'], { cwd: remote })
  await execGitOrThrow(['remote', 'add', 'origin', remote], { cwd: repo })
  await execGitOrThrow(['push', '-u', 'origin', 'main'], { cwd: repo })
  await execGitOrThrow(['tag', 'v1.0'], { cwd: repo })
  await execGitOrThrow(['checkout', '-b', 'feature'], { cwd: repo })
  await writeFile(join(repo, 'feature.txt'), 'f\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', '기능 실험 저장'], { cwd: repo })
  await execGitOrThrow(['checkout', '-b', 'rival', 'main'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'rival\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', '경쟁 수정 저장'], { cwd: repo })
  await execGitOrThrow(['checkout', 'main'], { cwd: repo })
  await writeFile(join(repo, 'app.txt'), 'mine\n')
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(['commit', '-m', '내 수정 저장'], { cwd: repo })
  const rivalHash = (await execGitOrThrow(['rev-parse', 'rival'], { cwd: repo })).stdout.trim()
  const headHash = (await execGitOrThrow(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]!.setSize(1440, 900)
    })
    // (1) 전체 그래프 — 레인·원격 ☁ 배지·태그·"지금 여기"
    await expect(window.getByTestId('history-count')).toHaveText('4')
    await expect(window.getByTestId(`history-item-${headHash}`)).toContainText('지금 여기')
    await window.screenshot({ path: 'test-results/e5b-graph.png' })
    // (2) 커밋 우클릭 메뉴 — 8항목 + 구분선
    await window.getByTestId(`history-item-${headHash}`).click({ button: 'right' })
    await expect(window.getByTestId('context-cherry-pick')).toBeVisible()
    await window.screenshot({ path: 'test-results/e5b-commit-menu.png' })
    await window.keyboard.press('Escape')
    // (3) 가져오기 충돌 상태 바
    await window.getByTestId(`history-item-${rivalHash}`).click({ button: 'right' })
    await window.getByTestId('context-cherry-pick').click()
    await expect(window.getByTestId('merge-bar')).toContainText('저장 가져오는 중')
    await window.screenshot({ path: 'test-results/e5b-cherry-bar.png' })
    await copyFile('test-results/e5b-graph.png', join(SCRATCH, 'e5b-graph.png'))
    await copyFile('test-results/e5b-commit-menu.png', join(SCRATCH, 'e5b-commit-menu.png'))
    await copyFile('test-results/e5b-cherry-bar.png', join(SCRATCH, 'e5b-cherry-bar.png'))
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
    await rm(remote, { recursive: true, force: true })
  }
})
```

실행·정리 (build는 Step 1에서 이미 됐다 — 재빌드 없이 이 파일만 실행):

```bash
cd apps/desktop && npx playwright test e2e/screens-e5b.spec.ts
rm apps/desktop/e2e/screens-e5b.spec.ts
```

스크린샷 3장(`e5b-graph.png`·`e5b-commit-menu.png`·`e5b-cherry-bar.png`)이 test-results/와 scratchpad 양쪽에 있는지, 그래프 레인·메뉴·상태 바가 실제로 찍혔는지 눈으로 확인한다. 이후 e2e를 다시 돌리지 않는다.

- [ ] **Step 4: Commit** (README만 — 스크린샷·test-results/는 미추적)

```bash
git add README.md
git commit -m "docs: README — E5b 히스토리 전체 그래프·커밋 작업 반영

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8-보완: 품질 리뷰 4건 (실측 반영)

품질 리뷰(파괴 작업 안전 전 시나리오 통과) 지적:

- **(Important 1) HEAD가 로드 범위 밖이면 "내가 어디 있는지"를 찾을 수 없다** — 전환 직후 스크롤·로드 범위가 그대로라 "지금 여기"가 DOM에도 없음(피드백 4 핵심 미완). → HEAD 변화 시 자동 스크롤 + 범위 밖이면 "지금 여기로" 버튼(찾을 때까지 상한 확장).
- **(Important 2) 빈 커밋 reword 원어 에러** — amend가 "would make it empty"로 거부, 영어 원문 노출. → `--allow-empty` 병기(빈 커밋의 메시지 고치기는 빈 채로 유지 — 안전).
- **(Minor 3) HEAD 행 배지 crush** — '지금 여기'+N 접기와 폭 경쟁으로 `main`도 "m…". → 현재 브랜치 배지는 flex none(최우선 생존자).
- **(Minor 5) 체리픽 충돌+자동 보관 notice 선행 공백**. → join 방식 정리.

**Files:**
- Modify: `packages/git-adapter/src/client.ts` (+`packages/git-adapter/test/client.test.ts`)
- Modify: `apps/desktop/src/renderer/src/store/repository-store.ts`
- Modify: `apps/desktop/src/renderer/src/components/HistoryPanel.tsx` (+`history-panel.css`)
- Modify: `apps/desktop/src/renderer/src/App.tsx`

- [ ] **Step 1: reword 빈 커밋 테스트 (Red)** — reword 테스트 묶음 끝에 추가:

```ts
  it('reword — 빈 커밋(변경 없는 저장)의 메시지도 고칠 수 있다 (원어 에러 없음)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '--allow-empty', '-m', '빈 저장'], { cwd: repo })
    const head = (await client.history.list(1))[0]!
    await client.commits.reword(head.hash, '고친 제목')
    expect((await client.history.list(1))[0]!.subject).toBe('고친 제목')
  })
```

Run: FAIL 확인(GitError — "would make it empty" 원문).

- [ ] **Step 2: 엔진** — reword의 amend 실행 줄 교체:

```ts
        // 메시지만 교체(실측 7: staged 없음 + amend -F - → tree 불변) — stdin으로 개행·따옴표 안전.
        // --allow-empty: 빈 커밋의 메시지 고치기가 "would make it empty" 원어로 죽지 않게 (품질 리뷰)
        await execGitOrThrow(['commit', '--amend', '--allow-empty', '-F', '-'], { cwd, stdin: message })
```

Green: **347 tests**.

- [ ] **Step 3: store**

(a) `cherryPickCommit`의 notice 조합 교체 — 기존:

```ts
        const shelfNotice = result.autoShelved ? ' 저장 안 된 변경은 보관함에 넣어뒀어요.' : ''
        notice = `${notices[result.outcome] ?? ''}${shelfNotice}` || null
```

교체:

```ts
        const shelfNotice = result.autoShelved ? '저장 안 된 변경은 보관함에 넣어뒀어요.' : ''
        // conflict(안내 null) + 자동 보관 조합에서 선행 공백이 남지 않게 join으로 조립한다 (품질 리뷰)
        notice = [notices[result.outcome], shelfNotice].filter((part) => part).join(' ') || null
```

(b) 인터페이스에 추가(`loadMoreHistory(): Promise<void>` 줄 뒤):

```ts
  /** "지금 여기"(HEAD)가 로드 범위 밖일 때 — 찾을 때까지 역사 상한을 넓혀 다시 읽는다 (품질 리뷰) */
  revealHead(): Promise<void>
```

(c) `loadMoreHistory` 구현 뒤에 추가:

```ts
  async revealHead() {
    const { repoPath, status } = get()
    const headHash = status?.headHash ?? null
    if (!repoPath || headHash === null) return
    await guard(set, get, async () => {
      // 큰 저장소에서 HEAD가 한참 아래일 수 있다 — 찾을 때까지 상한을 넓힌다(상한 10회 × 2000)
      let limit = get().historyLimit
      for (let round = 0; round < 10; round += 1) {
        if (get().history.some((commit) => commit.hash === headHash)) return
        limit += 2000
        set({ historyLimit: limit, history: await git().history.list(repoPath, limit) })
      }
    })
  },
```

- [ ] **Step 4: HistoryPanel + App + CSS**

(a) HistoryPanel props에 추가(`onLoadMore(): void` 줄 뒤):

```ts
  /** "지금 여기"가 로드 범위 밖일 때 누른다 — 찾을 때까지 더 읽어 스크롤한다 (품질 리뷰) */
  onLocateHead(): void
```

(구조 분해에도 `onLocateHead` 추가.)

(b) virtualizer 선언 **뒤**에 HEAD 추적 추가:

```tsx
  // "지금 여기"(HEAD)가 바뀌거나, "지금 여기로"로 로드 범위에 처음 들어온 순간 그 행으로 스크롤한다
  // (품질 리뷰 — 구현 실측 정정: revealHead는 headHash를 바꾸지 않으므로 발견 전이(headFound)도 봐야 한다.
  //  불리언 전이만 보므로 이미 보이는 상태의 단순 더 불러오기로는 튀지 않는다)
  const headIndex = headHash === null ? -1 : history.findIndex((commit) => commit.hash === headHash)
  const headFound = headIndex >= 0
  useEffect(() => {
    if (headIndex >= 0) virtualizer.scrollToIndex(headIndex, { align: 'center' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headHash, headFound])
```

(`useEffect`를 react import에 추가 — 기존 import 형태에 맞춰.)

(c) 패널 헤더 accessory(기존 log Badge·count가 있는 자리)에 조건부 버튼 추가 — 정확한 삽입 지점은 기존 accessory 마크업을 읽고 count 요소 **뒤**에:

```tsx
          {headHash !== null && headIndex < 0 && (
            <Button variant="ghost" size="sm" isDisabled={busy} onPress={onLocateHead} testId="history-locate-head">
              지금 여기로
            </Button>
          )}
```

(Button import가 없으면 추가. 삽입 지점이 플랜 전제와 다르면 NEEDS_CONTEXT.)

(d) App의 HistoryPanel 배선에 추가(`onLoadMore=` 줄 뒤):

```tsx
            onLocateHead={() => void store.revealHead()}
```

(e) `history-panel.css`의 `.history-item__ref--head` 블록 교체:

```css
.history-item__ref--head {
  /* 현재 브랜치 배지는 줄어들지 않는다 — "내가 어디 있는지"가 최우선 생존자 (품질 리뷰) */
  flex: none;
  background: var(--color-selection-bg);
  border-color: var(--color-accent);
  color: var(--color-accent);
}
```

- [ ] **Step 5: 실렌더 확인 4건** — (1) 5000커밋 저장소에서 HEAD가 범위 밖인 브랜치로 전환 → "지금 여기로" 버튼 노출 → 클릭 → HEAD 행 도달·중앙 표시; 범위 안 케이스는 전환 즉시 자동 스크롤, (2) 빈 커밋 메시지 고치기 → 친절 동작(원어 에러 없음), (3) HEAD 행에서 `main` 배지 온전(+N·병합 배지 공존 상태), (4) 체리픽 충돌+자동 보관 notice 선행 공백 없음.

- [ ] **Step 6: 게이트** — 루트 `pnpm test`(**347**) + typecheck(6 Done) + build + E2E 전체(**42 passed**) 전부 exit 0

- [ ] **Step 7: Commit**

```bash
git add packages/git-adapter apps/desktop/src
git commit -m "fix: 품질 리뷰 — HEAD 추적 스크롤·지금 여기로 버튼·빈 커밋 reword·배지 생존·notice 공백

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9-보완: 통합 리뷰 2건 (실측 반영)

- **(Important) 비조상 커밋 revert 원어 에러** — --all로 다른 브랜치 커밋에 revert 우클릭이 가능해졌는데, 변경이 이미 없는 경우 `nothing to commit` 원문 노출(상태 훼손은 없음 — REVERT_HEAD 미생성 실측). cherryPick의 empty 친절 처리와 비대칭. → classify에 친절 분기.
- **(Minor 4) notice join 일관화** — 선행 공백 방지 join 패턴을 cherryPick에만 적용했다. → mergeBranch·pullLatest·revertCommit 3곳 동일 패턴으로.

**Files:**
- Modify: `packages/git-adapter/src/client.ts` (+`packages/git-adapter/test/client.test.ts`)
- Modify: `apps/desktop/src/renderer/src/store/repository-store.ts`

- [ ] **Step 1: revert empty 테스트 (Red)** — revert 테스트 묶음 끝에 추가:

```ts
  it('revert — 되돌려도 바뀌는 내용이 없으면 읽히는 메시지로 알린다 (비조상·이미 반영)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    // 같은 내용을 되돌린 뒤 또 되돌리면 변경이 없다 — "이미 반영"의 최소 재현
    await writeFixtureFile(repo, 'README.md', 'v2\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'v2'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'revert', '--no-edit', 'HEAD'], { cwd: repo })
    const middle = (await client.history.list(2))[1]!
    await expect(client.commits.revert(middle.hash)).rejects.toThrow(/바뀌는 내용이 없어요/)
    // 상태가 오염되지 않았다
    expect((await client.repo.status()).state).toBe('normal')
  })
```

Run: FAIL 확인(GitError — `nothing to commit` 원문).

- [ ] **Step 2: 엔진** — revert의 `classify`에서 CONFLICT 분기 **뒤**에 추가:

```ts
          if (output.includes('nothing to commit')) {
            throw new Error(
              '되돌려도 바뀌는 내용이 없어요 — 이미 지금 내용에 반영되어 있는 저장이에요.',
            )
          }
```

Green: **348 tests**.

- [ ] **Step 3: store notice join 3곳** — 각 액션의 shelfNotice 선언·notice 조립을 교체:

(a) `mergeBranch`·`pullLatest` 공통 형태(각각):

```ts
        const shelfNotice = result.autoShelved ? '저장 안 된 변경은 보관함에 넣어뒀어요.' : ''
        notice = [notices[result.outcome], shelfNotice].filter((part) => part).join(' ') || null
```

(mergeBranch의 여러 줄 shelfNotice 선언 포함 기존 블록을 위 2줄로. 주석은 기존 것 유지.)

(b) `revertCommit`:

```ts
      const shelfNotice = result.autoShelved ? '저장 안 된 변경은 보관함에 넣어뒀어요.' : ''
      // 충돌 안내는 reverting 상태 바가 담당한다 — 보관 안내만 남긴다 (join으로 선행 공백 방지)
      notice =
        [result.outcome === 'reverted' ? '되돌리는 새 저장을 만들었어요.' : null, shelfNotice]
          .filter((part) => part)
          .join(' ') || null
```

(기존 단언 문구는 그대로 유지되므로 E2E 무영향 — `toContainText` 부분 매칭.)

- [ ] **Step 4: 게이트** — 루트 `pnpm test`(**348**) + typecheck(6 Done) + build + E2E 전체(**42 passed**) → **공식 스크린샷 3장 복원**(scratchpad 사본 → test-results/, 이후 e2e 재실행 금지)

- [ ] **Step 5: Commit**

```bash
git add packages/git-adapter apps/desktop/src
git commit -m "fix: 통합 리뷰 — 빈 revert 친절 안내·notice join 일관화

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 검증 게이트 요약

| 시점 | 기대치 |
| --- | --- |
| 기준선 (ee644f3, 실측) | **315 tests**(26 files) + E2E **38** (smoke 32 + hosting 6) |
| Task 1 후 | +6 → **321 tests** (기존 테스트 깨짐 0건 — history.list(1)[0] 전수 감사 표 참조) |
| Task 2 후 | +8 → **329 tests** |
| Task 3 후 | +11 → **340 tests** |
| Task 4·5 후 | 340 유지 + typecheck 전부 Done |
| Task 6 후 | +6 → **346 tests** |
| Task 7 후 | 346 유지 + typecheck 전부 Done + 실렌더 확인 7항목 |
| Task 8 후 | E2E **42 passed** (smoke 36 + hosting 6) + 변이 실증 1건(FAIL→원복 PASS, 재빌드 포함) |
| 최종 (Task 9) | **346 tests** + typecheck + build + E2E 42 — 전부 exit 0 + 스크린샷 3장 + README |

## 인용 앵커 검증 기록

플랜의 "기존:" 코드 블록은 전부 `grep -cF`(다중 행은 python 부분 문자열 검사)로 대상 파일에서 **정확히 1회** 매칭됨을 확인했다(2026-07-21, ee644f3): repository.ts의 `export interface RepositoryStatus {…}` 블록·`/** 실험 공간 지우기 결과…`, status-parser.ts의 `ParsedStatus` 줄·branch/changes 선언 2줄·`# branch.head ` 분기 줄·branch.oid 주석 줄·return 줄, client.ts의 status 반환 줄·`--date-order` 주석 3줄 블록·unborn 주석 줄·`revertAbort(): Promise<void>` 인터페이스 블록·`RESTORE_FILE_SHELF_MESSAGE` 블록·`      async revert(hash) {` 줄·import 선두 3줄, client.test.ts의 `branches — 목록(현재 표시…` it 줄·`reverting 중에는 전환·받아오기도…` it 줄, status-parser.test.ts의 `필드가 모자란 기형 레코드…` it 줄, ipc-contract의 import 선두 3줄·revert/revertAbort 2줄·CHANNELS 2줄, git-handlers의 commitsRevertAbort 핸들러 3줄, preload의 revert/revertAbort 2줄, store의 abortRevert 시그니처 2줄·abortRevert 구현 꼬리 7줄(notice '되돌리기를 취소하고…' 포함), history-refs.test.ts의 import 줄, history-panel.css의 `--head` 블록, App.tsx의 `bisecting…}` 2줄·confirmingAbort 줄·BranchSwitcher import 줄·repoName 줄·상단 레이어 조건 4줄·상태 바 블록·mode 줄·HistoryPanel 블록·ConfirmDialog(abort) 블록, smoke.spec.ts의 from-root 꼬리 3줄·merge(ff) 선두 3줄, README 문장 꼬리. 다중 매칭 위험이 있던 앵커(`return { branch, changes }`·단독 `revertAbort` 등)는 전부 다중 행 블록 또는 유일 문구 포함 형태로 유일화했다.

## 후속 노트 (이관 후보)

- **HEAD가 조회 상한 밖이면 "지금 여기"가 안 보인다**: --all에서 다른 브랜치의 최신 커밋이 상한(50)을 채우면 오래된 HEAD 행이 목록 밖일 수 있다 — "지금 여기로 스크롤" 버튼(HEAD 행 자동 스크롤·상한 자동 확장) 검토. (Task 8-보완으로 구현 — 완료)
- (통합 리뷰 Minor) undo 후 백업(push)이 원어 에러(`failed to push some refs`) — 원격이 앞선 기존 상황과 동일 노출. 친절 매핑 또는 "받아온 뒤 백업" 안내 검토.
- (통합 리뷰 Minor) undo 후 리뷰 요청은 upstream 일치로 push를 생략해 원격 잔존분(실행취소한 커밋)이 PR에 포함될 수 있다 — 안내 검토.
- (통합 리뷰 Minor) headFound 전이 스크롤이 일반 더 불러오기로 HEAD가 우연히 로드될 때도 발동(스크롤 강탈 가능), revealHead 10회×2000 캡 초과 시 무통보 종료 — 다듬기 후보.
- **레인 폭 상한**: 실측상 브랜치 21개에서 laneCount 21(거터 252px)까지 커진다. 수십 브랜치 저장소는 거터가 제목을 짓누른다 — 레인 수 상한 + "그 외" 축약 렌더 검토.
- **"커밋 제거"(임의 중간 커밋 drop)**: 피드백 5의 잔여. rebase 계열이라 진행 중 상태·충돌 흐름 설계가 따로 필요 — HEAD 실행취소(undo)·revert로 대응한 현 범위 밖.
- **reword의 본문 유실**: 한 줄 입력이라 본문 있는 커밋을 고치면 본문이 사라진다(다이얼로그에 경고 문구로 고지). 멀티라인 편집 다이얼로그 승격 검토.
- **cherry-pick 연속 범위 가져오기**: 지금은 한 커밋씩. 범위(A..B) 가져오기는 sequencer 진행 상태(멀티 커밋 충돌 반복)가 필요해 별도 설계.
- **원격 휴리스틱의 한계**: `origin/` 접두만 원격으로 본다(E4 관례). origin이 아닌 이름의 remote(upstream 등)는 로컬 톤으로 보인다 — `git remote` 목록 기반 판정으로 승격 검토.
- **undo 후 merge commit**: 병합 커밋 실행취소도 허용된다(reset --mixed는 첫 부모로 — 내용은 변경 목록에 남아 유실 없음). 병합을 통째로 물리는 의미를 확인창에 병기할지 검토.
- **empty cherry-pick의 autoShelved 조합**: dirty 자동 보관까지 간 뒤 empty로 판명되면 보관 항목만 남는다(안내 문구에 보관 병기됨) — 자동 복원까지 이어줄지 검토.
- **태그 삭제·주석 태그(annotated)**: 이번 범위는 lightweight 생성만. 우클릭 "태그 지우기"·메시지 있는 태그는 후속.
