# E0-3b 커밋 상세·refs 배지·가상화 구현 계획 (사용자 피드백 #4·#6·#7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 커밋을 클릭하면 전체 메시지·변경 파일·파일별 diff를 보여주고(merge는 첫 부모 기준), 타임라인에 브랜치/병합 배지를 달고, 변경 목록·히스토리·diff를 가상화해 수천 건에서도 렉이 없게 한다.

**Architecture:** 엔진 우선 — adapter에 `commits.show`(메타+name-status)와 `commits.diffFile`(첫 부모 기준 단일 파일 patch)을 추가하고 log format을 `%D`(refs)·`%P`(parents)로 확장한다. renderer는 diff 렌더를 DiffView로 추출해 DiffPanel과 새 CommitDetailPanel이 공유하고, 목록 3종(변경 파일·히스토리·diff 행)을 @tanstack/react-virtual 동적 측정으로 가상화한다. E0-3a 이관: staged rename diff에 origPath를 동봉해 unstage와의 비대칭을 해소한다.

**Tech Stack:** 기존 + `@tanstack/react-virtual` (renderer 전용 신규 의존성 1개).

**사용자 피드백 매핑:** #6(커밋 클릭 상세) → Task 1·2·3·4·7·8, #7(refs/merge 배지 — 사용자 선택: "이번엔 배지까지, 레인 그래프는 1단계") → Task 1·8, #4(5000건 렉 — 가상화) → Task 5·6·8. E0-3a 후속 노트 이관: staged rename diff origPath 동봉 → Task 3, `-uall` 행 폭발 → Task 5 가상화로 흡수.

**2차 피드백 매핑 (2026-07-16, 사용자 승인 범위):** ①개별 올리기/내리기 버튼 제거(체크박스 일괄만) → Task 5, ②상단 체크박스·버튼 indent를 행과 정렬 → Task 5, ③파일명·경로 말줄임(…) 대신 가로 스크롤 → Task 5, ⑥다크/라이트 토글 버튼 → Task 8c, ⑩로그 50개 제한 해제(스크롤 끝 더 불러오기) → Task 4·7·8, ⑪선택 파일 변경 취소(확인창 방식 — 사용자 선택: "지금 바로, 확인창만") → Task 3b·4·7·8b. (⑦우클릭 메뉴·⑧브랜치 컨트롤은 다음 마일스톤 — 브랜치·되돌리기 엔진 필요.)

**실측으로 확정한 git 명령 (probe 저장소에서 검증됨):**
- merge 커밋에 `git diff-tree <sha>`는 **빈 출력**이다 — 부모가 있으면 `git diff --name-status -M -z <첫부모> <sha>`로 첫 부모 기준을 명시한다.
- root 커밋(부모 없음)은 `git diff-tree --no-commit-id --root -r -M -z --name-status <sha>`.
- name-status `-z`의 rename 레코드는 `R100 NUL 원래경로 NUL 새경로 NUL` 순서다.
- `%B` 대신 `%s%x1f%b`로 제목/본문을 git이 분리해 준다. `%P`는 부모 해시 공백 구분, `%D`는 `HEAD -> main, origin/main, tag: v1` 형식(없으면 빈 필드).
- staged rename에 pathspec을 새 경로만 주면 "새 파일 추가"로 표시되지만, **원래 경로를 함께 주면 `rename from/to` meta로 정상 표시**된다 (Task 3의 근거).
- `git rev-parse -q --verify <sha>^1`은 root면 exit 1, 아니면 첫 부모 해시를 출력한다.

**알려진 한계(의도적):** merge 커밋의 combined diff(`--cc`)는 다루지 않는다 — 모든 커밋 diff는 첫 부모 기준(스펙 원칙: 비개발자에게 "이 저장으로 무엇이 바뀌었나"만 답한다). 레인 그래프·두 번째 부모 비교는 1단계. 커밋 상세의 파일 목록도 rename 감지는 `-M`(기본 유사도)이다. shallow clone의 grafted 커밋은 `%P`가 비어 parents=[]로(root처럼) 보인다 — shallow의 본질적 한계로 수용한다.

---

## 파일 구조

```
packages/domain/src/repository.ts                       # CommitSummary 확장(refs·parents), CommitDetail·CommitFileChange (수정)
packages/git-adapter/src/log-parser.ts                  # %D·%P 파싱 (수정)
packages/git-adapter/src/commit-detail-parser.ts        # parseCommitMeta·parseNameStatus (신규)
packages/git-adapter/src/client.ts                      # commits.show·commits.diffFile, diff origPath (수정)
packages/ipc-contract/src/index.ts                      # commits.show/diffFile 채널, DiffOptions.origPath (수정)
apps/desktop/src/main/git-handlers.ts                   # assertHash, 새 핸들러 2개 (수정)
apps/desktop/src/preload/index.ts                       # 브리지 2개 (수정)
apps/desktop/src/renderer/src/components/change-kind.ts # KIND_LABELS·KIND_GLYPHS 공통화 (신규)
apps/desktop/src/renderer/src/components/diff-rows.ts   # FileDiff → 가상화용 flat rows (신규)
apps/desktop/src/renderer/src/components/DiffView.tsx   # 가상화 diff 렌더 — DiffPanel·CommitDetailPanel 공유 (신규)
apps/desktop/src/renderer/src/components/DiffPanel.tsx  # DiffView 위임 (수정)
apps/desktop/src/renderer/src/components/ChangesPanel.tsx # FileList 가상화 (수정)
apps/desktop/src/renderer/src/components/HistoryPanel.tsx # 가상화·클릭·refs/병합 배지 (수정)
apps/desktop/src/renderer/src/components/CommitDetailPanel.tsx # 커밋 상세 (신규)
apps/desktop/src/renderer/src/store/repository-store.ts # selectCommit·selectCommitFile·clearCommit·discard·loadMoreHistory (수정)
apps/desktop/src/renderer/src/App.tsx                   # 중앙 패널 분기·HistoryPanel 배선·테마 토글 (수정)
apps/desktop/src/renderer/src/ui/ConfirmDialog.tsx      # 되돌릴 수 없는 동작 확인창 (신규, Task 8b)
apps/desktop/src/renderer/src/ui/theme.ts               # 테마 결정·적용 로직 (신규, Task 8c)
```

---

### Task 1: domain 타입 확장 + log 파서 %D·%P

**Files:**
- Modify: `packages/domain/src/repository.ts`
- Modify: `packages/git-adapter/src/log-parser.ts`
- Test: `packages/git-adapter/test/log-parser.test.ts`

- [ ] **Step 1: domain 타입 확장**

`packages/domain/src/repository.ts`의 `CommitSummary` 블록(파일 끝)을 다음으로 교체:

```ts
/** 저장된 역사 한 항목 — log의 요약 */
export interface CommitSummary {
  hash: string
  shortHash: string
  subject: string
  authorName: string
  /** epoch 초 */
  committedAt: number
  /** 이 커밋을 가리키는 브랜치·태그 이름들 (%D에서 "HEAD -> "·"tag: " 접두사 제거). 없으면 빈 배열 */
  refs: string[]
  /** 부모 커밋 해시 — 2개 이상이면 병합 커밋 */
  parents: string[]
}

/** 커밋에 담긴 파일 하나의 변경 — 커밋 상세에서 사용한다 */
export interface CommitFileChange {
  path: string
  /** rename/copy일 때 원래 경로 */
  origPath: string | null
  kind: ChangeKind
}

/** 커밋 클릭 상세 — 전체 메시지와 변경 파일 목록. diff는 파일 단위로 따로 조회한다 */
export interface CommitDetail {
  hash: string
  shortHash: string
  subject: string
  /** 본문(멀티라인). 없으면 빈 문자열 */
  body: string
  authorName: string
  /** epoch 초 */
  committedAt: number
  parents: string[]
  files: CommitFileChange[]
}
```

- [ ] **Step 2: 실패하는 log 파서 테스트**

`packages/git-adapter/test/log-parser.test.ts` 전체를 다음으로 교체 (record 헬퍼가 7필드로 확장된다):

```ts
import { describe, expect, it } from 'vitest'
import { parseLog } from '../src/log-parser'

const US = '\x1f'

function record(
  hash: string,
  short: string,
  author: string,
  epoch: string,
  refs: string,
  parents: string,
  subject: string,
) {
  return [hash, short, author, epoch, refs, parents, subject].join(US)
}

describe('parseLog', () => {
  it('빈 출력이면 빈 배열', () => {
    expect(parseLog('')).toEqual([])
  })

  it('레코드를 CommitSummary로 변환한다', () => {
    const raw =
      record('a'.repeat(40), 'abc1234', '홍길동', '1752561600', '', 'b'.repeat(40), 'feat: 첫 커밋') +
      '\0'
    expect(parseLog(raw)).toEqual([
      {
        hash: 'a'.repeat(40),
        shortHash: 'abc1234',
        authorName: '홍길동',
        committedAt: 1752561600,
        refs: [],
        parents: ['b'.repeat(40)],
        subject: 'feat: 첫 커밋',
      },
    ])
  })

  it('refs — "HEAD -> "·"tag: " 접두사를 벗기고, detached의 단독 HEAD는 제외한다', () => {
    const raw =
      record('a'.repeat(40), 'aaaaaaa', 'A', '100', 'HEAD -> main, origin/main, tag: v1.0', '', 'x') +
      '\0' +
      record('b'.repeat(40), 'bbbbbbb', 'B', '100', 'HEAD', '', 'y') +
      '\0'
    const commits = parseLog(raw)
    expect(commits[0]?.refs).toEqual(['main', 'origin/main', 'v1.0'])
    expect(commits[1]?.refs).toEqual([])
  })

  it('refs — shallow clone의 pseudo-decoration grafted는 배지가 아니다', () => {
    const raw = record('a'.repeat(40), 'aaaaaaa', 'A', '100', 'grafted, HEAD -> main', '', 'x') + '\0'
    expect(parseLog(raw)[0]?.refs).toEqual(['main'])
  })

  it('parents — 공백 구분 해시를 배열로, root 커밋(빈 %P)은 빈 배열로', () => {
    const merge = record('a'.repeat(40), 'aaaaaaa', 'A', '100', '', `${'b'.repeat(40)} ${'c'.repeat(40)}`, 'merge') + '\0'
    const root = record('d'.repeat(40), 'ddddddd', 'D', '100', '', '', 'root') + '\0'
    expect(parseLog(merge)[0]?.parents).toEqual(['b'.repeat(40), 'c'.repeat(40)])
    expect(parseLog(root)[0]?.parents).toEqual([])
  })

  it('여러 레코드의 순서를 보존한다', () => {
    const raw =
      record('a'.repeat(40), 'aaaaaaa', 'A', '200', '', '', '두 번째') +
      '\0' +
      record('b'.repeat(40), 'bbbbbbb', 'B', '100', '', '', '첫 번째') +
      '\0'
    const commits = parseLog(raw)
    expect(commits.map((c) => c.subject)).toEqual(['두 번째', '첫 번째'])
  })

  it('subject에 필드 구분자가 섞여도 나머지를 subject로 합친다', () => {
    const raw = record('a'.repeat(40), 'abc1234', 'A', '100', '', '', `제목${US}에 구분자`) + '\0'
    expect(parseLog(raw)[0]?.subject).toBe(`제목${US}에 구분자`)
  })

  it('필드가 모자라거나 시간이 숫자가 아닌 기형 레코드는 건너뛴다', () => {
    const raw =
      ['broken', record('a'.repeat(40), 'abc1234', 'A', 'not-a-number', '', '', 'x')].join('\0') + '\0'
    expect(parseLog(raw)).toEqual([])
  })
})
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run packages/git-adapter/test/log-parser.test.ts`
Expected: FAIL — refs/parents 필드가 없고 7필드 레코드에서 subject가 어긋난다

- [ ] **Step 4: log-parser 구현**

`packages/git-adapter/src/log-parser.ts` 전체 교체:

```ts
import type { CommitSummary } from '@git-gui/domain'

const FIELD_SEPARATOR = '\x1f'

/**
 * `%D` 장식 문자열을 이름 배열로 정리한다.
 * "HEAD -> main, origin/main, tag: v1" → ['main', 'origin/main', 'v1'].
 * detached HEAD의 단독 "HEAD"와 shallow clone의 pseudo-decoration "grafted"는
 * ref가 아니므로 제외한다 (origin/HEAD·replace ref는 log 인자에서 장식 제외).
 */
function parseRefs(decoration: string): string[] {
  if (decoration === '') return []
  return decoration
    .split(', ')
    .map((ref) => {
      if (ref.startsWith('HEAD -> ')) return ref.slice('HEAD -> '.length)
      if (ref.startsWith('tag: ')) return ref.slice('tag: '.length)
      return ref
    })
    .filter((ref) => ref !== 'HEAD' && ref !== 'grafted')
}

/**
 * `git log --format=%H%x1f%h%x1f%an%x1f%ct%x1f%D%x1f%P%x1f%s -z` 출력을 파싱한다.
 * 레코드는 NUL, 필드는 US(0x1f)로 구분된다. %s(subject)는 git이 한 줄로 정리해 준다.
 * 기형 레코드는 추측해 채우지 않고 건너뛴다.
 */
export function parseLog(rawOutput: string): CommitSummary[] {
  const records = rawOutput.split('\0')
  if (records.length > 0 && records[records.length - 1] === '') records.pop()

  const commits: CommitSummary[] = []
  for (const record of records) {
    const fields = record.split(FIELD_SEPARATOR)
    if (fields.length < 7) continue
    const committedAt = Number(fields[3])
    if (!Number.isFinite(committedAt)) continue
    commits.push({
      hash: fields[0]!,
      shortHash: fields[1]!,
      authorName: fields[2]!,
      committedAt,
      refs: parseRefs(fields[4]!),
      parents: fields[5]! === '' ? [] : fields[5]!.split(' '),
      // subject에 구분자가 섞이는 일은 없지만 방어적으로 나머지를 합친다
      subject: fields.slice(6).join(FIELD_SEPARATOR),
    })
  }
  return commits
}
```

- [ ] **Step 5: client.ts의 log format 확장**

`packages/git-adapter/src/client.ts`의 history.list에서 기존 `'--format=%H%x1f%h%x1f%an%x1f%ct%x1f%s',` 행을 다음 4줄로 교체 (다른 인자는 그대로):

```ts
          // clone 기본 장식의 origin/HEAD와 replace ref는 배지 소음이다 — 장식에서 제외한다 (실측 확인)
          '--decorate-refs-exclude=refs/remotes/*/HEAD',
          '--decorate-refs-exclude=refs/replace/*',
          '--format=%H%x1f%h%x1f%an%x1f%ct%x1f%D%x1f%P%x1f%s',
```

- [ ] **Step 6: client 통합 테스트 — refs·parents 실측**

`packages/git-adapter/test/client.test.ts`의 `'history — 커밋이 없는 저장소(unborn)는 빈 목록이다'` 테스트 **앞**에 추가:

```ts
  it('history — refs와 parents를 반환하고 병합 커밋을 식별한다', async () => {
    const repo = await createFixtureRepo()
    await execGitOrThrow(['checkout', '-b', 'side'], { cwd: repo })
    await writeFixtureFile(repo, 'side.txt', 's\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'side'], { cwd: repo })
    await execGitOrThrow(['checkout', 'main'], { cwd: repo })
    await writeFixtureFile(repo, 'main.txt', 'm\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'main-side'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'merge', '--no-edit', 'side'], { cwd: repo })

    const history = await createGitClient(repo).history.list(10)
    const merge = history[0]!
    expect(merge.parents).toHaveLength(2)
    expect(merge.refs).toContain('main')
    // 일반 커밋은 부모 1개, 배지 없음
    const plain = history.find((c) => c.subject === 'main-side')!
    expect(plain.parents).toHaveLength(1)
    expect(plain.refs).toEqual([])
    // root 커밋은 부모 없음
    expect(history[history.length - 1]!.parents).toEqual([])
  })
```

- [ ] **Step 7: 통과 확인**

Run: `pnpm test && pnpm typecheck`
Expected: 전부 PASS (log-parser 8 + client에 1 추가), typecheck 5 Done

- [ ] **Step 8: Commit**

```bash
git add packages/domain/src/repository.ts packages/git-adapter/src/log-parser.ts packages/git-adapter/src/client.ts packages/git-adapter/test/log-parser.test.ts packages/git-adapter/test/client.test.ts
git commit -m "feat(adapter): log에 refs·parents 확장 — 배지·병합 식별·커밋 상세의 기반

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: adapter — 커밋 상세 파서 + commits.show

**Files:**
- Create: `packages/git-adapter/src/commit-detail-parser.ts`
- Modify: `packages/git-adapter/src/client.ts`, `packages/git-adapter/src/index.ts`
- Test: `packages/git-adapter/test/commit-detail-parser.test.ts`, `packages/git-adapter/test/client.test.ts`

- [ ] **Step 1: 실패하는 파서 테스트**

Create `packages/git-adapter/test/commit-detail-parser.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseCommitMeta, parseNameStatus } from '../src/commit-detail-parser'

const US = '\x1f'

describe('parseCommitMeta', () => {
  it('%H %h %an %ct %P %s %b 필드를 CommitDetail 메타로 변환한다', () => {
    const raw = [
      'a'.repeat(40),
      'abc1234',
      '홍길동',
      '1752561600',
      `${'b'.repeat(40)} ${'c'.repeat(40)}`,
      '제목 한 줄',
      '본문 첫 줄\n본문 둘째 줄\n',
    ].join(US)
    expect(parseCommitMeta(raw)).toEqual({
      hash: 'a'.repeat(40),
      shortHash: 'abc1234',
      authorName: '홍길동',
      committedAt: 1752561600,
      parents: ['b'.repeat(40), 'c'.repeat(40)],
      subject: '제목 한 줄',
      body: '본문 첫 줄\n본문 둘째 줄',
    })
  })

  it('본문 없는 커밋 — body는 빈 문자열, root — parents는 빈 배열', () => {
    const raw = ['a'.repeat(40), 'abc1234', 'A', '100', '', '제목', ''].join(US)
    const meta = parseCommitMeta(raw)
    expect(meta.body).toBe('')
    expect(meta.parents).toEqual([])
  })

  it('본문에 필드 구분자가 섞여도 나머지를 본문으로 합친다', () => {
    const raw = ['a'.repeat(40), 'abc1234', 'A', '100', '', '제목', `본${US}문`].join(US)
    expect(parseCommitMeta(raw).body).toBe(`본${US}문`)
  })

  it('필드가 모자라거나 시간이 숫자가 아니면 에러를 던진다 — 추측하지 않는다', () => {
    expect(() => parseCommitMeta('broken')).toThrow()
    expect(() => parseCommitMeta(['a'.repeat(40), 'a', 'A', 'NaN', '', 's', ''].join(US))).toThrow()
  })
})

describe('parseNameStatus', () => {
  it('M/A/D를 CommitFileChange로 변환한다', () => {
    const raw = 'M\0a.txt\0A\0b.txt\0D\0c.txt\0'
    expect(parseNameStatus(raw)).toEqual([
      { path: 'a.txt', origPath: null, kind: 'modified' },
      { path: 'b.txt', origPath: null, kind: 'added' },
      { path: 'c.txt', origPath: null, kind: 'deleted' },
    ])
  })

  it('R100은 원래경로→새경로 순서다 — origPath에 원래 경로를 담는다', () => {
    const raw = 'R100\0old.txt\0new.txt\0'
    expect(parseNameStatus(raw)).toEqual([{ path: 'new.txt', origPath: 'old.txt', kind: 'renamed' }])
  })

  it('C(복사)·T(형식 변경)도 매핑하고, 알 수 없는 상태는 건너뛴다', () => {
    const raw = 'C75\0src.txt\0copy.txt\0T\0mode.txt\0X\0weird.txt\0'
    expect(parseNameStatus(raw)).toEqual([
      { path: 'copy.txt', origPath: 'src.txt', kind: 'copied' },
      { path: 'mode.txt', origPath: null, kind: 'typechange' },
    ])
  })

  it('빈 출력이면 빈 배열', () => {
    expect(parseNameStatus('')).toEqual([])
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run packages/git-adapter/test/commit-detail-parser.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 파서 구현**

Create `packages/git-adapter/src/commit-detail-parser.ts`:

```ts
import type { ChangeKind, CommitDetail, CommitFileChange } from '@git-gui/domain'

const FIELD_SEPARATOR = '\x1f'

/**
 * `git show -s --format=%H%x1f%h%x1f%an%x1f%ct%x1f%P%x1f%s%x1f%b` 출력을 파싱한다.
 * %s/%b로 제목·본문을 git이 분리한다 — %b는 마지막 필드라 개행을 포함해도 안전하다.
 * 단일 커밋 전용이므로 기형 출력은 건너뛰지 않고 에러를 던진다.
 */
export function parseCommitMeta(rawOutput: string): Omit<CommitDetail, 'files'> {
  const fields = rawOutput.split(FIELD_SEPARATOR)
  if (fields.length < 7) {
    throw new Error('커밋 정보를 읽지 못했어요. 새로고침 후 다시 시도해 주세요.')
  }
  const committedAt = Number(fields[3])
  if (!Number.isFinite(committedAt)) {
    throw new Error('커밋 정보를 읽지 못했어요. 새로고침 후 다시 시도해 주세요.')
  }
  return {
    hash: fields[0]!,
    shortHash: fields[1]!,
    authorName: fields[2]!,
    committedAt,
    parents: fields[4]! === '' ? [] : fields[4]!.split(' '),
    subject: fields[5]!,
    // 본문에 구분자가 섞이는 일은 없지만 방어적으로 나머지를 합친다. 끝 개행은 표시용이 아니다
    body: fields.slice(6).join(FIELD_SEPARATOR).replace(/\n+$/, ''),
  }
}

/** name-status 상태 문자 → ChangeKind. 커밋 diff에는 U(충돌)·미추적이 없다 */
const STATUS_KINDS: Record<string, ChangeKind> = {
  M: 'modified',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'typechange',
}

/**
 * `git diff --name-status -M -z` 출력을 파싱한다 (root 커밋 경로의 diff-tree 출력도 동일 형식).
 * 레코드: `M NUL path NUL` / rename·copy: `R100 NUL 원래경로 NUL 새경로 NUL` (원래 경로가 먼저 — 실측 확정).
 * 알 수 없는 상태는 추측하지 않고 건너뛴다.
 */
export function parseNameStatus(rawOutput: string): CommitFileChange[] {
  const tokens = rawOutput.split('\0')
  if (tokens.length > 0 && tokens[tokens.length - 1] === '') tokens.pop()

  const files: CommitFileChange[] = []
  let index = 0
  while (index < tokens.length) {
    const status = tokens[index]!
    const kind = STATUS_KINDS[status[0] ?? '']
    const twoPaths = status.startsWith('R') || status.startsWith('C')
    const consumed = twoPaths ? 3 : 2
    if (kind === undefined || index + consumed > tokens.length) {
      index += consumed
      continue
    }
    if (twoPaths) {
      files.push({ path: tokens[index + 2]!, origPath: tokens[index + 1]!, kind })
    } else {
      files.push({ path: tokens[index + 1]!, origPath: null, kind })
    }
    index += consumed
  }
  return files
}
```

- [ ] **Step 4: 파서 테스트 통과 확인**

Run: `npx vitest run packages/git-adapter/test/commit-detail-parser.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: 실패하는 client 통합 테스트 — commits.show**

`packages/git-adapter/test/client.test.ts`의 `'빈 커밋 메시지는 GitError로 거부된다'` 테스트 **앞**에 추가:

```ts
  it('show — 전체 메시지(제목·본문)와 변경 파일 목록을 반환한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# changed\n')
    await writeFixtureFile(repo, 'new.txt', 'n\n')
    await client.changes.stage(['README.md', 'new.txt'])
    await client.commits.create('제목 한 줄\n\n본문 첫 줄\n본문 둘째 줄')

    const head = (await client.history.list(1))[0]!
    const detail = await client.commits.show(head.hash)
    expect(detail.subject).toBe('제목 한 줄')
    expect(detail.body).toBe('본문 첫 줄\n본문 둘째 줄')
    expect(detail.parents).toHaveLength(1)
    expect(detail.files).toEqual([
      { path: 'README.md', origPath: null, kind: 'modified' },
      { path: 'new.txt', origPath: null, kind: 'added' },
    ])
  })

  it('show — rename 커밋은 origPath를 담는다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await execGitOrThrow(['mv', 'README.md', 'DOCS.md'], { cwd: repo })
    await client.commits.create('rename')

    const head = (await client.history.list(1))[0]!
    const detail = await client.commits.show(head.hash)
    expect(detail.files).toEqual([{ path: 'DOCS.md', origPath: 'README.md', kind: 'renamed' }])
  })

  it('show — 병합 커밋은 첫 부모 기준의 파일만 나열한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await execGitOrThrow(['checkout', '-b', 'side'], { cwd: repo })
    await writeFixtureFile(repo, 'side.txt', 's\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'side'], { cwd: repo })
    await execGitOrThrow(['checkout', 'main'], { cwd: repo })
    await writeFixtureFile(repo, 'main.txt', 'm\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'main-side'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'merge', '--no-edit', 'side'], { cwd: repo })

    const merge = (await client.history.list(1))[0]!
    const detail = await client.commits.show(merge.hash)
    // 첫 부모(main-side) 기준: side에서 온 파일만 새로 추가로 보인다
    expect(detail.parents).toHaveLength(2)
    expect(detail.files).toEqual([{ path: 'side.txt', origPath: null, kind: 'added' }])
  })

  it('show — root 커밋(부모 없음)도 파일 목록을 반환한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    const history = await client.history.list(10)
    const root = history[history.length - 1]!
    const detail = await client.commits.show(root.hash)
    expect(detail.parents).toEqual([])
    expect(detail.files).toEqual([{ path: 'README.md', origPath: null, kind: 'added' }])
  })

  it('show — 40자 hex가 아닌 해시를 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await expect(client.commits.show('HEAD')).rejects.toThrow()
    await expect(client.commits.show('--help')).rejects.toThrow()
    await expect(client.commits.show('a'.repeat(39))).rejects.toThrow()
  })
```

- [ ] **Step 6: 실패 확인**

Run: `npx vitest run packages/git-adapter/test/client.test.ts --testNamePattern "show"`
Expected: FAIL — `client.commits.show is not a function`

- [ ] **Step 7: commits.show 구현**

`packages/git-adapter/src/client.ts` 수정:

(a) import에 파서와 타입 추가 — 파일 상단 import 블록을 다음으로 교체:

```ts
import {
  detectState,
  type CommitDetail,
  type CommitSummary,
  type DiffOptions,
  type FileDiff,
  type RepositoryStatus,
} from '@git-gui/domain'
import { execGit, execGitOrThrow, GitError } from '@git-gui/git-process'
import { parseCommitMeta, parseNameStatus } from './commit-detail-parser'
import { parseLog } from './log-parser'
import { parsePatch } from './diff-parser'
import { readGitDirMarkers } from './markers'
import { parseStatusV2 } from './status-parser'
```

(b) `GitClient` 인터페이스의 commits 블록을 교체:

```ts
  commits: {
    create(message: string): Promise<void>
    /** 커밋 상세 — 전체 메시지·변경 파일. 병합 커밋은 첫 부모 기준 */
    show(hash: string): Promise<CommitDetail>
  }
```

(c) `assertRepoRelative` 함수 아래에 추가:

```ts
/** renderer가 넘긴 해시는 40자 hex 전체 해시만 신뢰한다 — ref 표현식(HEAD~ 등)·옵션 밀수를 차단 */
function assertFullHash(hash: string): void {
  if (!/^[0-9a-f]{40}$/.test(hash)) {
    throw new Error(`올바른 커밋 해시가 아니에요: ${hash}`)
  }
}

/** CLI에서 rebase/gc로 사라진 커밋을 오래된 목록에서 클릭하는 흐름 — 원시 git 에러 대신 이 문구로 */
const MISSING_COMMIT_MESSAGE = '그 저장 시점을 찾을 수 없어요. 새로고침 후 다시 시도해 주세요.'
```

(d) 구현부 `commits:` 블록을 교체:

```ts
    commits: {
      async create(message) {
        const cwd = await topLevel()
        // 메시지는 stdin으로 전달해 따옴표·개행 이스케이프 문제를 피한다.
        // 빈 메시지는 git이 exit 1로 거부한다 — GitError로 전파된다.
        await execGitOrThrow(['commit', '-F', '-'], { cwd, stdin: message })
      },
      async show(hash) {
        const cwd = await topLevel()
        assertFullHash(hash)
        const showArgs = [
          'show',
          '-s',
          '--no-show-signature',
          '--format=%H%x1f%h%x1f%an%x1f%ct%x1f%P%x1f%s%x1f%b',
          '--end-of-options',
          hash,
        ]
        const metaRaw = await execGit(showArgs, { cwd })
        if (metaRaw.exitCode !== 0) {
          if (metaRaw.stderr.includes('bad object')) {
            throw new Error(MISSING_COMMIT_MESSAGE)
          }
          throw new GitError(showArgs, metaRaw)
        }
        const meta = parseCommitMeta(metaRaw.stdout)
        const firstParent = meta.parents[0] ?? null
        // 병합 커밋에 diff-tree 기본 호출은 빈 출력이다(실측) — 부모가 있으면 첫 부모를 명시한다.
        // root 커밋만 --root diff-tree를 쓴다.
        const filesArgs = firstParent
          ? ['diff', '--name-status', '-M', '-z', firstParent, hash]
          : ['diff-tree', '--no-commit-id', '--root', '-r', '-M', '-z', '--name-status', hash]
        const filesRaw = await execGitOrThrow(filesArgs, { cwd })
        return { ...meta, files: parseNameStatus(filesRaw.stdout) }
      },
    },
```

(e) `packages/git-adapter/src/index.ts`에 파서 export 추가 — 파일 끝에:

```ts
export { parseCommitMeta, parseNameStatus } from './commit-detail-parser'
```

- [ ] **Step 8: 통과 확인**

Run: `pnpm test && pnpm typecheck`
Expected: 전부 PASS, typecheck 5 Done

- [ ] **Step 9: Commit**

```bash
git add packages/git-adapter/src packages/git-adapter/test packages/domain/src
git commit -m "feat(adapter): commits.show — 전체 메시지·변경 파일, 병합은 첫 부모 기준

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2-보완: 사라진 커밋의 읽히는 에러 (품질 리뷰 반영)

CLI에서 rebase/gc로 커밋이 사라진 뒤 오래된 히스토리 목록에서 클릭하면 원시 git 에러(`… failed (exit 128): fatal: bad object …`)가 사용자에게 그대로 노출된다(실측). show의 `bad object`를 읽히는 메시지로 변환한다 — Task 2의 show 구현 블록과 parseNameStatus JSDoc이 갱신되었다.

**Files:**
- Modify: `packages/git-adapter/src/client.ts`, `packages/git-adapter/src/commit-detail-parser.ts` (JSDoc 한 줄)
- Test: `packages/git-adapter/test/client.test.ts`

- [ ] **Step 1: 실패하는 테스트**

`packages/git-adapter/test/client.test.ts`의 `'show — 40자 hex가 아닌 해시를 거부한다'` 테스트 **뒤**에 추가:

```ts
  it('show — 사라진(존재하지 않는) 커밋은 원시 git 에러 대신 읽히는 메시지로 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await expect(client.commits.show('deadbeef'.repeat(5))).rejects.toThrow(
      /저장 시점을 찾을 수 없어요/,
    )
  })
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run packages/git-adapter/test/client.test.ts --testNamePattern "사라진"`
Expected: FAIL — `bad object`가 포함된 GitError 원문이 그대로 온다

- [ ] **Step 3: 갱신된 Task 2 블록에 byte 재동기화**

Task 2 Step 7(d)의 show 구현 블록(execGit + exitCode 분기 + bad object 친화 메시지)과 Step 3의 parseNameStatus JSDoc(root diff-tree 언급)이 갱신되었다 — 두 파일을 블록에 byte 재동기화한다.

- [ ] **Step 4: 통과 확인 + 게이트**

Run: `pnpm test && pnpm typecheck`
Expected: **151 tests** PASS + 5 Done

- [ ] **Step 5: Commit**

```bash
git add packages/git-adapter/src packages/git-adapter/test
git commit -m "fix(adapter): 사라진 커밋 클릭은 읽히는 메시지로 — 원시 git 에러 노출 방지

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: adapter — commits.diffFile + staged rename diff 비대칭 해소

**Files:**
- Modify: `packages/domain/src/repository.ts:44-48` (DiffOptions), `packages/git-adapter/src/client.ts`
- Test: `packages/git-adapter/test/client.test.ts`

- [ ] **Step 1: 실패하는 테스트 — staged rename diff와 diffFile**

`packages/git-adapter/test/client.test.ts`의 `'diff — unstaged, staged, untracked 각각 구조화된 diff를 반환한다'` 테스트 **뒤**에 추가:

```ts
  it('diff — staged rename은 origPath를 함께 주면 rename으로 표시된다 (전체 내용 추가로 위장하지 않는다)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await execGitOrThrow(['mv', 'README.md', 'DOCS.md'], { cwd: repo })

    const diff = await client.changes.diff('DOCS.md', {
      staged: true,
      untracked: false,
      origPath: 'README.md',
    })
    expect(diff.meta.some((line) => line.startsWith('rename from README.md'))).toBe(true)
    // R100(내용 동일)은 hunks가 없다 — 전체 내용이 add로 나오면 회귀
    expect(diff.hunks).toEqual([])
  })

  it('diffFile — 커밋의 단일 파일 diff를 반환한다 (root·rename·병합 첫 부모)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)

    // root 커밋의 파일
    const history1 = await client.history.list(10)
    const root = history1[history1.length - 1]!
    const rootDiff = await client.commits.diffFile(root.hash, 'README.md', null)
    expect(
      rootDiff.hunks.flatMap((h) => h.lines).some((l) => l.kind === 'add' && l.text === '# fixture'),
    ).toBe(true)

    // rename 커밋 — origPath 동봉 시 rename meta
    await execGitOrThrow(['mv', 'README.md', 'DOCS.md'], { cwd: repo })
    await client.commits.create('rename')
    const renameHead = (await client.history.list(1))[0]!
    const renameDiff = await client.commits.diffFile(renameHead.hash, 'DOCS.md', 'README.md')
    expect(renameDiff.meta.some((line) => line.startsWith('rename from README.md'))).toBe(true)

    // 병합 커밋 — 첫 부모 기준
    await execGitOrThrow(['checkout', '-b', 'side'], { cwd: repo })
    await writeFixtureFile(repo, 'side.txt', 's\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'side'], { cwd: repo })
    await execGitOrThrow(['checkout', 'main'], { cwd: repo })
    await writeFixtureFile(repo, 'main.txt', 'm\n')
    await execGitOrThrow(['add', '-A'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'commit', '-m', 'main-side'], { cwd: repo })
    await execGitOrThrow([...FIXTURE_IDENT, 'merge', '--no-edit', 'side'], { cwd: repo })
    const merge = (await client.history.list(1))[0]!
    const mergeDiff = await client.commits.diffFile(merge.hash, 'side.txt', null)
    expect(
      mergeDiff.hunks.flatMap((h) => h.lines).some((l) => l.kind === 'add' && l.text === 's'),
    ).toBe(true)
  })

  it('diffFile — 잘못된 해시·저장소 밖 경로를 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    const head = (await client.history.list(1))[0]!
    await expect(client.commits.diffFile('HEAD', 'README.md', null)).rejects.toThrow()
    await expect(client.commits.diffFile(head.hash, '../out.txt', null)).rejects.toThrow()
    await expect(client.commits.diffFile(head.hash, 'README.md', '../out.txt')).rejects.toThrow()
  })
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run packages/git-adapter/test/client.test.ts --testNamePattern "diffFile|origPath"`
Expected: FAIL — origPath 옵션 무시(rename meta 없음), diffFile 미존재

- [ ] **Step 3: DiffOptions에 origPath 추가**

`packages/domain/src/repository.ts`의 DiffOptions를 교체:

```ts
/** diff 조회 대상 — index(staged) 쪽인지, untracked 신규 파일인지. adapter와 IPC 계약이 공유한다 */
export interface DiffOptions {
  staged: boolean
  untracked: boolean
  /** staged rename일 때 원래 경로 — pathspec에 함께 넣어야 rename으로 표시된다 (없으면 "새 파일 추가"로 위장) */
  origPath?: string | null
}
```

- [ ] **Step 4: client.ts 구현 — changes.diff origPath + commits.diffFile**

(a) `GitClient` 인터페이스의 commits 블록을 교체:

```ts
  commits: {
    create(message: string): Promise<void>
    /** 커밋 상세 — 전체 메시지·변경 파일. 병합 커밋은 첫 부모 기준 */
    show(hash: string): Promise<CommitDetail>
    /** 커밋 안 단일 파일의 diff — 첫 부모 기준. rename이면 origPath를 함께 넘긴다 */
    diffFile(hash: string, path: string, origPath: string | null): Promise<FileDiff>
  }
```

(b) `changes.diff`의 staged/unstaged 분기(마지막 `const args = options.staged ? ... : ...` 와 `return parsePatch(...)`)를 다음으로 교체:

```ts
        const pathspecs = [`:(literal)${path}`]
        // staged rename은 원래 경로도 pathspec에 있어야 rename으로 감지된다(실측) —
        // 없으면 similarity 계산이 깨져 "새 파일 추가"로 위장된다
        if (options.staged && options.origPath != null) {
          assertRepoRelative(options.origPath)
          pathspecs.push(`:(literal)${options.origPath}`)
        }
        // -M: 사용자 전역 diff.renames=false여도 rename 감지를 고정한다 —
        // rename이 del+add 2파일 patch로 갈라지면 단일 파일 전용 parsePatch가 오분류한다(실측)
        const args = options.staged
          ? ['diff', '--cached', '-M', '--no-color', '--no-ext-diff', '--', ...pathspecs]
          : ['diff', '--no-color', '--no-ext-diff', '--', ...pathspecs]
        return parsePatch((await execGitOrThrow(args, { cwd })).stdout)
```

(c) 구현부 commits 블록의 `show` 뒤에 추가:

```ts
      async diffFile(hash, path, origPath) {
        const cwd = await topLevel()
        assertFullHash(hash)
        assertRepoRelative(path)
        if (origPath != null) assertRepoRelative(origPath)
        const pathspecs =
          origPath != null ? [`:(literal)${path}`, `:(literal)${origPath}`] : [`:(literal)${path}`]
        // 첫 부모 확인 — root 커밋(부모 없음)은 --root diff-tree로 다룬다 (병합 커밋 diff-tree는 빈 출력).
        // rev-parse는 root와 사라진 해시를 구분하지 못한다 — 커밋 존재를 따로 확인해 읽히는 에러를 낸다
        const parent = await execGit(['rev-parse', '-q', '--verify', `${hash}^1`], { cwd })
        if (parent.exitCode !== 0) {
          const exists = await execGit(['rev-parse', '-q', '--verify', `${hash}^{commit}`], { cwd })
          if (exists.exitCode !== 0) {
            throw new Error(MISSING_COMMIT_MESSAGE)
          }
        }
        const args =
          parent.exitCode === 0
            ? [
                'diff',
                '-M',
                '--no-color',
                '--no-ext-diff',
                '--end-of-options',
                parent.stdout.trim(),
                hash,
                '--',
                ...pathspecs,
              ]
            : [
                'diff-tree',
                '--no-commit-id',
                '--root',
                '-r',
                '-p',
                '-M',
                '--no-color',
                '--no-ext-diff',
                '--end-of-options',
                hash,
                '--',
                ...pathspecs,
              ]
        return parsePatch((await execGitOrThrow(args, { cwd })).stdout)
      },
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm test && pnpm typecheck`
Expected: 전부 PASS, typecheck 5 Done

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/repository.ts packages/git-adapter/src/client.ts packages/git-adapter/test/client.test.ts
git commit -m "feat(adapter): commits.diffFile + staged rename diff origPath 동봉 — 비대칭 해소

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3-보완: diffFile 사라진 해시 친화 에러·-M 고정·null 판정 통일 (품질 리뷰 반영)

품질 리뷰 실측 3건: (1) diffFile에 사라진 해시 → rev-parse가 root와 구분 못 해 diff-tree 분기에서 원시 git 에러 노출(show와 동일 흐름인데 비일관), (2) staged diff에 `-M`이 없어 사용자 전역 `diff.renames=false`면 rename이 2파일 patch로 갈라져 parsePatch 오분류, (3) origPath null 판정이 `!==`/`!=`로 갈라져 undefined 유입 시 crash. Task 3의 관련 블록들이 갱신되었다(MISSING_COMMIT_MESSAGE 상수 공유, show도 상수 사용).

**Files:**
- Modify: `packages/git-adapter/src/client.ts`
- Test: `packages/git-adapter/test/client.test.ts`

- [ ] **Step 1: 실패하는 테스트 2개**

`packages/git-adapter/test/client.test.ts`의 `'diffFile — 잘못된 해시·저장소 밖 경로를 거부한다'` 테스트 **뒤**에 추가:

```ts
  it('diffFile — 사라진(존재하지 않는) 커밋은 원시 git 에러 대신 읽히는 메시지로 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await expect(
      client.commits.diffFile('deadbeef'.repeat(5), 'README.md', null),
    ).rejects.toThrow(/저장 시점을 찾을 수 없어요/)
  })

  it('diff — 사용자 전역 diff.renames=false여도 staged rename은 rename으로 표시된다 (-M 고정)', async () => {
    const repo = await createFixtureRepo()
    await execGitOrThrow(['config', 'diff.renames', 'false'], { cwd: repo })
    const client = createGitClient(repo)
    await execGitOrThrow(['mv', 'README.md', 'DOCS.md'], { cwd: repo })
    const diff = await client.changes.diff('DOCS.md', {
      staged: true,
      untracked: false,
      origPath: 'README.md',
    })
    expect(diff.meta.some((line) => line.startsWith('rename from README.md'))).toBe(true)
    expect(diff.hunks).toEqual([])
  })
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run packages/git-adapter/test/client.test.ts --testNamePattern "사라진|renames"`
Expected: diffFile 테스트는 GitError 원문(`bad object`)으로, -M 테스트는 rename meta 부재로 FAIL (show의 '사라진 커밋' 테스트는 계속 PASS)

- [ ] **Step 3: 갱신된 Task 2·3 블록에 byte 재동기화**

client.ts를 갱신 블록에 맞춘다: MISSING_COMMIT_MESSAGE 상수(assertFullHash 아래), show의 상수 사용, changes.diff staged 인자에 `-M`(주석 포함), diffFile의 `!= null` 판정·커밋 존재 확인·`--end-of-options`.

- [ ] **Step 4: 통과 확인 + 게이트**

Run: `pnpm test && pnpm typecheck`
Expected: **156 tests** PASS + 5 Done

- [ ] **Step 5: Commit**

```bash
git add packages/git-adapter/src/client.ts packages/git-adapter/test/client.test.ts
git commit -m "fix(adapter): diffFile 사라진 해시 친화 에러·staged diff -M 고정·null 판정 통일

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3b: adapter — changes.discard (선택 파일 변경 취소, 피드백 ⑪)

**유일하게 데이터를 지우는 작업이다.** tracked 파일은 `git restore --`(worktree를 index 상태로 되돌림), untracked 파일은 `git clean -f --`(파일 삭제)로 나눠 처리한다 — restore는 untracked에 pathspec 불일치 에러를 내므로 섞어 보낼 수 없다. 확인창은 renderer(Task 8b) 책임이고, 엔진은 빈 pathspec 거부(전체 확대 방지)만 책임진다.

**Files:**
- Modify: `packages/git-adapter/src/client.ts`
- Test: `packages/git-adapter/test/client.test.ts`

- [ ] **Step 1: 실패하는 테스트**

`packages/git-adapter/test/client.test.ts`의 `'stage/unstage에 빈 배열을 넘기면 전체 작업으로 확대되지 않고 거부한다'` 테스트 **앞**에 추가:

```ts
  it('discard — tracked 수정은 마지막 저장 상태로 되돌리고, untracked는 삭제한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# changed\n')
    await writeFixtureFile(repo, 'new.txt', 'n\n')

    await client.changes.discard(['README.md'], ['new.txt'])
    const status = await client.repo.status()
    expect(status.changes).toEqual([])
    expect(existsSync(join(repo, 'new.txt'))).toBe(false)
    // tracked 파일은 삭제가 아니라 복원이다
    expect(existsSync(join(repo, 'README.md'))).toBe(true)
  })

  it('discard — staged 내용은 건드리지 않는다 (worktree만 되돌린다)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# staged\n')
    await client.changes.stage(['README.md'])
    await writeFixtureFile(repo, 'README.md', '# worktree\n')

    await client.changes.discard(['README.md'], [])
    const status = await client.repo.status()
    // staged 변경은 그대로, unstaged 변경만 사라진다 (worktree = index)
    expect(status.changes.find((c) => c.path === 'README.md')?.staged).toBe('modified')
    expect(status.changes.find((c) => c.path === 'README.md')?.unstaged).toBeNull()
  })

  it('discard — 글롭·매직 파일명을 리터럴로 처리해 다른 파일을 지우지 않는다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, '*.txt', 'glob\n')
    await writeFixtureFile(repo, 'victim.txt', 'v\n')
    await client.changes.discard([], ['*.txt'])
    expect(existsSync(join(repo, '*.txt'))).toBe(false)
    expect(existsSync(join(repo, 'victim.txt'))).toBe(true)
  })

  it('discard — 둘 다 빈 배열이면 거부한다 (전체 확대 방지)', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await expect(client.changes.discard([], [])).rejects.toThrow()
  })

  it('discard — 빈 문자열 경로를 거부한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await expect(client.changes.discard([''], [])).rejects.toThrow()
    await expect(client.changes.discard([], [''])).rejects.toThrow()
  })
```

그리고 파일 상단 import에 `existsSync` 추가 — 첫 행 `import { mkdir, mkdtemp } from 'node:fs/promises'` **앞**에:

```ts
import { existsSync } from 'node:fs'
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run packages/git-adapter/test/client.test.ts --testNamePattern "discard"`
Expected: FAIL — `client.changes.discard is not a function`

- [ ] **Step 3: 구현**

`packages/git-adapter/src/client.ts` 수정:

(a) `GitClient` 인터페이스의 changes 블록에 diff 앞 행으로 추가:

```ts
    /**
     * 선택 파일의 아직 올리지 않은(unstaged) 변경 취소 — tracked는 index 상태로 복원(staged 보존),
     * untracked는 삭제. 되돌릴 수 없다. 경로는 파일 단위여야 한다(-uall status가 공급) —
     * 디렉터리 pathspec을 주면 clean이 그 아래 미추적 전체를 지운다(실측).
     */
    discard(trackedPaths: string[], untrackedPaths: string[]): Promise<void>
```

(b) 구현부 changes의 `unstage` 뒤에 추가:

```ts
      async discard(trackedPaths, untrackedPaths) {
        if (trackedPaths.length === 0 && untrackedPaths.length === 0) {
          throw new Error('빈 경로 — 전체 작업으로 확대되는 것을 막기 위해 거부한다')
        }
        const cwd = await topLevel()
        // restore는 untracked에 pathspec 불일치 에러를 내므로 tracked/untracked를 나눠 실행한다
        if (trackedPaths.length > 0) {
          await execGitOrThrow(['restore', '--', ...toPathspecs(trackedPaths)], { cwd })
        }
        if (untrackedPaths.length > 0) {
          await execGitOrThrow(['clean', '-f', '--', ...toPathspecs(untrackedPaths)], { cwd })
        }
      },
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm test && pnpm typecheck`
Expected: 전부 PASS (156 + 5 = 161), typecheck 5 Done

- [ ] **Step 5: Commit**

```bash
git add packages/git-adapter/src/client.ts packages/git-adapter/test/client.test.ts
git commit -m "feat(adapter): changes.discard — 선택 파일 변경 취소 (restore + clean 분리)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: IPC — contract·handlers·preload 확장

**Files:**
- Modify: `packages/ipc-contract/src/index.ts`, `apps/desktop/src/main/git-handlers.ts`, `apps/desktop/src/preload/index.ts`

- [ ] **Step 1: contract 확장**

`packages/ipc-contract/src/index.ts` 수정:

(a) import를 교체:

```ts
import type {
  CommitDetail,
  CommitSummary,
  DiffOptions,
  FileDiff,
  RepositoryStatus,
} from '@git-gui/domain'
```

(b) `GitApi`의 changes·commits 블록을 교체:

```ts
  changes: {
    stage(repoPath: string, paths: string[]): Promise<void>
    unstage(repoPath: string, paths: string[]): Promise<void>
    /** 선택 파일 변경 취소 — tracked는 복원, untracked는 삭제. 되돌릴 수 없다 (확인창은 renderer 책임) */
    discard(repoPath: string, trackedPaths: string[], untrackedPaths: string[]): Promise<void>
    diff(repoPath: string, path: string, options: DiffOptions): Promise<FileDiff>
  }
  commits: {
    create(repoPath: string, message: string): Promise<void>
    /** 커밋 상세 — hash는 40자 hex 전체 해시만 허용된다 */
    show(repoPath: string, hash: string): Promise<CommitDetail>
    /** 커밋 안 단일 파일 diff — 첫 부모 기준. rename이면 origPath 동봉 */
    diffFile(repoPath: string, hash: string, path: string, origPath: string | null): Promise<FileDiff>
  }
```

(c) `CHANNELS`에 세 항목 추가 — `changesUnstage` 행 뒤에 `changesDiscard`, `commitsCreate` 행 뒤에 나머지 둘:

```ts
  changesDiscard: 'changes:discard',
```

```ts
  commitsShow: 'commits:show',
  commitsDiffFile: 'commits:diff-file',
```

(d) `GitApi.history`의 doc 주석에서 "limit은 1~500 정수"를 "limit은 1~10000 정수"로 교체 (로그 더 불러오기 — 피드백 ⑩).

- [ ] **Step 2: main 핸들러**

`apps/desktop/src/main/git-handlers.ts` 수정:

(a) `assertLimit` 함수 뒤에 추가:

```ts
/** 40자 hex 전체 해시만 통과 — ref 표현식·옵션 문자열 밀수를 IPC 경계에서 차단한다 (adapter의 검증은 심층 방어) */
function assertHash(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/.test(value)) {
    throw new Error('잘못된 요청 형식이에요.')
  }
  return value
}

function assertNullableString(value: unknown): string | null {
  if (value === null) return null
  return assertString(value)
}
```

(b) `assertDiffOptions`를 교체 (origPath 허용):

```ts
function assertDiffOptions(value: unknown): DiffOptions {
  const candidate = value as DiffOptions | null
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    typeof candidate.staged !== 'boolean' ||
    typeof candidate.untracked !== 'boolean' ||
    (candidate.origPath != null && typeof candidate.origPath !== 'string')
  ) {
    throw new Error('잘못된 요청 형식이에요.')
  }
  // 잉여 필드가 하류로 밀수되지 않도록 알려진 필드만 복사한다
  return { staged: candidate.staged, untracked: candidate.untracked, origPath: candidate.origPath ?? null }
}
```

(c) `commitsCreate` 핸들러 뒤에 추가:

```ts
  ipcMain.handle(CHANNELS.commitsShow, (_event, repoPath: unknown, hash: unknown) =>
    createGitClient(assertAllowedRepo(repoPath)).commits.show(assertHash(hash)),
  )

  ipcMain.handle(
    CHANNELS.commitsDiffFile,
    (_event, repoPath: unknown, hash: unknown, path: unknown, origPath: unknown) =>
      createGitClient(assertAllowedRepo(repoPath)).commits.diffFile(
        assertHash(hash),
        assertString(path),
        assertNullableString(origPath),
      ),
  )
```

(c-2) `changesUnstage` 핸들러 뒤에 추가:

```ts
  ipcMain.handle(
    CHANNELS.changesDiscard,
    (_event, repoPath: unknown, trackedPaths: unknown, untrackedPaths: unknown) =>
      createGitClient(assertAllowedRepo(repoPath)).changes.discard(
        assertStringArray(trackedPaths),
        assertStringArray(untrackedPaths),
      ),
  )
```

(c-3) `assertLimit`의 상한을 교체 — 로그 더 불러오기(⑩)가 상한을 키워 가며 재조회한다:

```ts
function assertLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 10000) {
    throw new Error('잘못된 요청 형식이에요.')
  }
  return value
}
```

(c-4) `packages/git-adapter/src/client.ts`의 history.list clamp도 맞춘다 — 기존 `Math.min(Math.max(Math.trunc(limit), 1), 500)` 행을 다음으로 교체하고, `GitClient.history`의 doc 주석 "limit은 1~500으로 잘린다"를 "limit은 1~10000으로 잘린다"로 교체:

```ts
        const safeLimit = Number.isFinite(limit)
          ? Math.min(Math.max(Math.trunc(limit), 1), 10000)
          : 50
```

- [ ] **Step 3: preload 브리지**

`apps/desktop/src/preload/index.ts`의 changes·commits 블록을 교체:

```ts
  changes: {
    stage: (repoPath, paths) => ipcRenderer.invoke(CHANNELS.changesStage, repoPath, paths),
    unstage: (repoPath, paths) => ipcRenderer.invoke(CHANNELS.changesUnstage, repoPath, paths),
    discard: (repoPath, trackedPaths, untrackedPaths) =>
      ipcRenderer.invoke(CHANNELS.changesDiscard, repoPath, trackedPaths, untrackedPaths),
    diff: (repoPath, path, options: DiffOptions) =>
      ipcRenderer.invoke(CHANNELS.changesDiff, repoPath, path, options),
  },
  commits: {
    create: (repoPath, message) => ipcRenderer.invoke(CHANNELS.commitsCreate, repoPath, message),
    show: (repoPath, hash) => ipcRenderer.invoke(CHANNELS.commitsShow, repoPath, hash),
    diffFile: (repoPath, hash, path, origPath) =>
      ipcRenderer.invoke(CHANNELS.commitsDiffFile, repoPath, hash, path, origPath),
  },
```

- [ ] **Step 4: 게이트**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build`
Expected: 전부 PASS/Done/성공 (신규 테스트 없음 — E2E는 Task 8에서)

- [ ] **Step 5: Commit**

```bash
git add packages/ipc-contract/src/index.ts apps/desktop/src/main/git-handlers.ts apps/desktop/src/preload/index.ts packages/git-adapter/src/client.ts
git commit -m "feat(ipc): commits.show·diffFile 채널 + DiffOptions.origPath

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: renderer — 행 UI 개편(①개별 버튼 제거·②정렬·③가로 스크롤) + 변경 목록 가상화

2차 피드백 반영: 행마다 있던 개별 올리기/내리기 버튼을 제거하고 체크박스 + 일괄 버튼만 남긴다(①). 상단 모두 선택 체크박스와 행 체크박스의 가로 위치를 정렬한다(②). 파일명·경로는 말줄임(…) 대신 가로 스크롤로 전체를 보여준다(③ — 가상 행이 절대 배치라 `min-width:100%; width:max-content` 행이 스크롤 폭을 만든다. 알려진 트레이드오프: 가로 스크롤 범위가 "렌더된 행 중 최장"이라 세로 스크롤 중 미세하게 변할 수 있다).

**Files:**
- Modify: `apps/desktop/package.json` (의존성), `apps/desktop/src/renderer/src/ui/panel.css`, `apps/desktop/src/renderer/src/components/ChangesPanel.tsx`, `apps/desktop/src/renderer/src/components/changes-panel.css`
- Create: `apps/desktop/src/renderer/src/components/change-kind.ts`
- Test: `apps/desktop/e2e/smoke.spec.ts`

- [ ] **Step 1: 의존성 설치**

Run: `pnpm --filter @git-gui/desktop add @tanstack/react-virtual`
Expected: dependencies에 `@tanstack/react-virtual` 추가 (v3.x)

- [ ] **Step 2: Panel body를 flex 컨테이너로**

`apps/desktop/src/renderer/src/ui/panel.css`의 `.ui-panel__body` 블록을 교체 (가상 리스트가 자체 스크롤 영역을 갖도록 body는 flex 분배만 한다 — 기존 콘텐츠는 stretch되어도 무해):

```css
.ui-panel__body {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
/* :where()로 특이도를 0으로 — 가상 스크롤 등 자식이 클래스 한 개로 결정적으로 이길 수 있다 */
.ui-panel__body > :where(*) {
  flex: none;
}
```

- [ ] **Step 3: 변경 종류 상수 공통화**

Create `apps/desktop/src/renderer/src/components/change-kind.ts` (커밋 상세 파일 행이 재사용한다):

```ts
import type { ChangeKind } from '@git-gui/domain'

/** 변경 종류의 한국어 라벨 — 색 단독으로 의미를 전달하지 않기 위해 tooltip/aria에 병행한다 */
export const KIND_LABELS: Record<ChangeKind, string> = {
  modified: '수정됨',
  added: '추가됨',
  deleted: '삭제됨',
  renamed: '이름 변경',
  copied: '복사됨',
  typechange: '형식 변경',
  untracked: '새 파일',
  conflicted: '충돌',
}

/** 색과 함께 쓰는 형태 신호 — 색약(적록)에서 modified/added 색이 수렴해도 글자로 구분된다 */
export const KIND_GLYPHS: Record<ChangeKind, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  typechange: 'T',
  untracked: 'U',
  conflicted: '!',
}
```

- [ ] **Step 4: ChangesPanel 가상화**

`apps/desktop/src/renderer/src/components/ChangesPanel.tsx` 전체 교체:

```tsx
import { useVirtualizer } from '@tanstack/react-virtual'
import { CircleMinus, CirclePlus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { FileChange } from '@git-gui/domain'
import type { SelectedFile } from '../store/repository-store'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import { KIND_GLYPHS, KIND_LABELS } from './change-kind'
import './changes-panel.css'

interface ChangesPanelProps {
  changes: FileChange[]
  selected: SelectedFile | null
  /** 작업 중에는 모든 버튼을 비활성화한다 — 연타로 git 작업이 겹치면 index.lock 충돌이 난다 */
  busy: boolean
  onStage(paths: string[]): void
  onUnstage(paths: string[]): void
  onSelect(selected: SelectedFile): void
}

/** 이름 변경은 새 경로와 원래 경로가 index에 쌍으로 있다 — 함께 넘겨야 반쪽 unstage가 안 된다 */
function actionPaths(change: FileChange, staged: boolean): string[] {
  if (staged && change.staged === 'renamed' && change.origPath !== null) {
    return [change.path, change.origPath]
  }
  return [change.path]
}

interface FileRowProps {
  change: FileChange
  staged: boolean
  isSelected: boolean
  isChecked: boolean
  busy: boolean
  onToggle(): void
  onSelect(): void
}

function FileRow({ change, staged, isSelected, isChecked, busy, onToggle, onSelect }: FileRowProps) {
  const kind = staged ? change.staged : change.unstaged
  const kindLabel = kind ? KIND_LABELS[kind] : ''
  // 이름 변경은 "무엇이었는지"가 핵심 정보 — 원래 경로를 툴팁에 병기한다
  const tooltip =
    kind === 'renamed' && change.origPath !== null
      ? `${change.origPath} → ${change.path} — ${kindLabel}`
      : `${change.path} — ${kindLabel}`
  // IntelliJ처럼 파일명을 먼저, 경로를 뒤에 흐리게 — 좁은 열에서는 경로부터 축소한다
  const slashIndex = change.path.lastIndexOf('/')
  const directory = slashIndex >= 0 ? change.path.slice(0, slashIndex) : ''
  const basename = slashIndex >= 0 ? change.path.slice(slashIndex + 1) : change.path
  return (
    <div className={`file-row${isSelected ? ' file-row--selected' : ''}`}>
      {/* 칩(sticky) — 가로 스크롤 중에도 체크박스가 왼쪽에 남는다 */}
      <span className="file-row__checkcell">
        <input
          type="checkbox"
          className="file-row__check"
          checked={isChecked}
          onChange={onToggle}
          disabled={busy}
          aria-label={`${change.path} 선택`}
          data-testid={`check-${staged ? 'staged' : 'unstaged'}-${change.path}`}
        />
      </span>
      <button
        type="button"
        className={`file-row__main file-row__main--${kind ?? 'none'}`}
        disabled={busy}
        onClick={onSelect}
        title={tooltip}
        aria-label={tooltip}
        data-testid={`file-${staged ? 'staged' : 'unstaged'}-${change.path}`}
      >
        <span className="file-row__kind" aria-hidden="true">
          {kind ? KIND_GLYPHS[kind] : ''}
        </span>
        <span className="file-row__name">
          <span className="file-row__base">{basename}</span>
          {directory && <span className="file-row__dir">{directory}</span>}
        </span>
      </button>
    </div>
  )
}

interface FileListProps {
  title: string
  termBadge: string
  countTestId: string
  emptyText: string
  changes: FileChange[]
  staged: boolean
  selected: SelectedFile | null
  busy: boolean
  bulkLabel: string
  onAction(paths: string[]): void
  onSelect(selected: SelectedFile): void
}

function FileList({
  title,
  termBadge,
  countTestId,
  emptyText,
  changes,
  staged,
  selected,
  busy,
  bulkLabel,
  onAction,
  onSelect,
}: FileListProps) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set())
  // 목록에서 사라진 경로는 체크에서 자동 제외한다 — stage/unstage 후 잔존 방지
  const validChecked = changes.filter((c) => checked.has(c.path))
  const allChecked = changes.length > 0 && validChecked.length === changes.length
  const side = staged ? 'staged' : 'unstaged'

  // 사라졌던 경로가 목록에 돌아와도 저절로 다시 체크되지 않게, 목록 변경 시 stale 경로를 정리한다
  useEffect(() => {
    setChecked((prev) => {
      const valid = new Set(changes.filter((c) => prev.has(c.path)).map((c) => c.path))
      return valid.size === prev.size ? prev : valid
    })
  }, [changes])

  // 수천 개 행에서도 DOM은 가시 범위만 유지한다 (#4). 행 높이는 실측(measureElement)한다
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count: changes.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 31,
    overscan: 10,
  })

  const toggle = (path: string) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }
  const toggleAll = () => {
    setChecked(allChecked ? new Set() : new Set(changes.map((c) => c.path)))
  }
  const runBulk = () => {
    onAction(validChecked.flatMap((change) => actionPaths(change, staged)))
    setChecked(new Set())
  }

  return (
    <Panel
      title={title}
      accessory={
        <>
          <Badge tone="git">{termBadge}</Badge>
          <Badge tone="count">
            <span data-testid={countTestId}>{changes.length}</span>
          </Badge>
        </>
      }
    >
      {changes.length === 0 ? (
        <p className="changes-panel__empty">{emptyText}</p>
      ) : (
        <>
          <div className="file-list__bulk">
            <label className="file-list__check-all">
              <input
                type="checkbox"
                checked={allChecked}
                ref={(element) => {
                  // 일부만 체크된 중간 상태 표시
                  if (element) element.indeterminate = validChecked.length > 0 && !allChecked
                }}
                onChange={toggleAll}
                disabled={busy}
                data-testid={`check-all-${side}`}
              />
              모두 선택
            </label>
            <Button
              variant="ghost"
              size="sm"
              isDisabled={busy || validChecked.length === 0}
              onPress={runBulk}
              testId={`${staged ? 'unstage' : 'stage'}-selected`}
            >
              {staged ? (
                <CircleMinus size={13} aria-hidden="true" />
              ) : (
                <CirclePlus size={13} aria-hidden="true" />
              )}
              선택 {bulkLabel} ({validChecked.length})
            </Button>
          </div>
          <div ref={scrollRef} className="virtual-scroll" data-testid={`file-scroll-${side}`}>
            <ul
              className="changes-panel__list"
              style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
            >
              {virtualizer.getVirtualItems().map((item) => {
                const change = changes[item.index]!
                return (
                  <li
                    key={`${side}-${change.path}`}
                    ref={virtualizer.measureElement}
                    data-index={item.index}
                    className="virtual-row virtual-row--wide"
                    style={{ transform: `translateY(${item.start}px)` }}
                  >
                    <FileRow
                      change={change}
                      staged={staged}
                      isSelected={
                        selected !== null &&
                        selected.staged === staged &&
                        selected.change.path === change.path
                      }
                      isChecked={checked.has(change.path)}
                      busy={busy}
                      onToggle={() => toggle(change.path)}
                      onSelect={() => onSelect({ change, staged })}
                    />
                  </li>
                )
              })}
            </ul>
          </div>
        </>
      )}
    </Panel>
  )
}

export function ChangesPanel({
  changes,
  selected,
  busy,
  onStage,
  onUnstage,
  onSelect,
}: ChangesPanelProps) {
  const stagedChanges = changes.filter((c) => c.staged !== null)
  const unstagedChanges = changes.filter((c) => c.unstaged !== null)

  return (
    <div className="changes-panel">
      <FileList
        title="지금 바뀐 것"
        termBadge="unstaged"
        countTestId="unstaged-count"
        emptyText="바뀐 파일이 없어요"
        changes={unstagedChanges}
        staged={false}
        selected={selected}
        busy={busy}
        bulkLabel="올리기"
        onAction={onStage}
        onSelect={onSelect}
      />
      <FileList
        title="저장 예정"
        termBadge="staged"
        countTestId="staged-count"
        emptyText="파일을 올리면 여기에 모여요"
        changes={stagedChanges}
        staged
        selected={selected}
        busy={busy}
        bulkLabel="내리기"
        onAction={onUnstage}
        onSelect={onSelect}
      />
    </div>
  )
}
```

- [ ] **Step 5: CSS — 가상 스크롤 공통 클래스 + file-row 조정**

`apps/desktop/src/renderer/src/components/changes-panel.css` 수정:

(a) 파일 상단 `.changes-panel` 블록 **앞**에 추가 (가상 리스트 공통 — HistoryPanel·DiffView도 사용한다):

```css
/* 가상 리스트 공통 — 스크롤 컨테이너는 flex 잔여 공간을 차지하고, 행은 절대 배치로 쌓인다.
   panel body의 자식 flex:none 규칙은 :where(특이도 0)라 이 클래스가 결정적으로 이긴다 */
.virtual-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}
.virtual-row {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
}
/* 가로 스크롤 리스트(③) — 절대 배치 행은 컨테이너 폭을 늘리지 못하므로 행 자신이 폭을 만든다 */
.virtual-row--wide {
  min-width: 100%;
  width: max-content;
}
```

(b) `.changes-panel__list` 블록을 교체 (padding이 가상 좌표를 어긋내지 않게 제거):

```css
.changes-panel__list {
  list-style: none;
  margin: 0;
  padding: 0;
}
```

(c) `.file-row` 블록을 교체 — li → div가 되었고, 좌측 여백은 체크박스 칩(아래 (d))이 담당한다:

```css
.file-row {
  display: flex;
  align-items: center;
  border-radius: var(--radius-sm);
  padding: 0 var(--space-3) 0 0;
  width: 100%;
}
```

(d) `.file-row__check` 블록을 다음 세 블록으로 교체 — 체크박스는 가로 스크롤 중에도 왼쪽에 고정된다(③과 ②의 양립, 리뷰 실측 반영). 칩의 좌측 padding `var(--space-3)`이 bulk 바와의 세로선 정렬(②)을 담당한다:

```css
/* 가로 스크롤 중에도 체크박스는 왼쪽에 고정 — 칩 배경이 밑을 지나는 텍스트를 가린다 */
.file-row__checkcell {
  flex: none;
  position: sticky;
  left: 0;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  align-self: stretch;
  padding: 0 var(--space-2) 0 var(--space-3);
  background: var(--color-surface);
}
.file-row--selected .file-row__checkcell {
  background: var(--color-selection-bg);
}
.file-row__check {
  flex: none;
}
```

(e) `.file-list__check-all` 블록의 `gap: 6px;`를 `gap: var(--space-2);`로 교체 (행 gap과 동일하게 — 체크박스 폭이 같으므로 세로선이 맞는다).

(f) 말줄임 제거(③) — `.file-row__name`·`.file-row__base`·`.file-row__dir` 블록을 다음으로 교체:

```css
.file-row__name {
  display: flex;
  align-items: baseline;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  white-space: nowrap;
}
/* IntelliJ식: 파일명 먼저, 경로는 뒤에 흐리게 — 잘라내지 않고 가로 스크롤로 전체를 보여준다(③) */
.file-row__base {
  flex: none;
}
.file-row__dir {
  flex: none;
  margin-left: var(--space-2);
  color: var(--color-text-faint);
}
```

(g) `.file-row__action` 블록과 `.file-row__action:hover:not(:disabled)` 블록을 삭제하고, `.file-row__main:disabled, .file-row__action:disabled` 선택자를 `.file-row__main:disabled`로 교체한다 (①).

- [ ] **Step 6: 기존 E2E를 체크박스 흐름으로 전환 (개별 버튼 제거에 따라)**

`apps/desktop/e2e/smoke.spec.ts`에서 `stage-app.txt` 클릭 2곳(1번 테스트 '열기 → stage → …'와 2번 테스트 '빈 메시지로 저장하면 …')을 각각 다음 두 줄로 교체:

```ts
    await window.getByTestId('check-unstaged-app.txt').click()
    await window.getByTestId('stage-selected').click()
```

- [ ] **Step 7: 실패하는 E2E — 가상화 검증**

`apps/desktop/e2e/smoke.spec.ts` 끝에 추가:

```ts
test('변경 목록 가상화 — 1500개 파일에서 DOM은 가시 범위만 유지하고 일괄 스테이징은 전체에 적용된다', async () => {
  const repo = await createRepoWithChange()
  // 저장소 루트에 미추적 파일 1500개 — 행 수 폭발 상황을 재현한다
  await Promise.all(
    Array.from({ length: 1500 }, (_, i) =>
      writeFile(join(repo, `bulk-${String(i).padStart(4, '0')}.txt`), `${i}\n`),
    ),
  )
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('unstaged-count')).toHaveText('1501')
    // 가상화 — 렌더된 행 수는 가시 범위 + overscan 수준이어야 한다.
    // 하한(> 0)이 없으면 컨테이너 부재/오타 시 count 0으로 공허하게 통과한다 — 함께 고정
    const rendered = await window.locator('[data-testid="file-scroll-unstaged"] .file-row').count()
    expect(rendered).toBeGreaterThan(0)
    expect(rendered).toBeLessThan(120)
    // 체크는 데이터 기반 — 화면 밖 행까지 전체에 적용된다
    await window.getByTestId('check-all-unstaged').click()
    await window.getByTestId('stage-selected').click()
    await expect(window.getByTestId('staged-count')).toHaveText('1501', { timeout: 30000 })
    await expect(window.getByTestId('unstaged-count')).toHaveText('0')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})
```

- [ ] **Step 8: 검출력 실증 → 통과 확인**

Run: `cd apps/desktop && pnpm e2e`
Expected: **E2E 5 passed**. 검출력 실증(test-the-test): 새 구현에서 `overscan: 10`을 잠시 `10000`으로 변이 → 가상화 테스트가 `Expected: < 120, Received: 1501`로 FAIL함을 확인 후 원복. (주의: 구 코드를 stash하는 방식은 red가 안 된다 — `file-scroll-unstaged` 컨테이너가 없으면 count가 0이 되어 상한 단언이 공허하게 통과한다. 그래서 테스트에 하한 `toBeGreaterThan(0)`도 있다.)

- [ ] **Step 9: 전체 게이트**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build && (cd apps/desktop && pnpm e2e)`
Expected: 161 tests + typecheck 5 + build + **E2E 5 passed** — 전부 exit 0

- [ ] **Step 10: Commit**

```bash
git add apps/desktop/package.json pnpm-lock.yaml apps/desktop/src/renderer/src/ui/panel.css apps/desktop/src/renderer/src/components apps/desktop/e2e/smoke.spec.ts
git commit -m "feat(desktop): 행 UI 개편과 변경 목록 가상화 — 개별 버튼 제거·가로 스크롤·수천 파일 (#4·①②③)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: renderer — diff 행 평탄화 + DiffView 추출(가상화)

**Files:**
- Create: `apps/desktop/src/renderer/src/components/diff-rows.ts`, `apps/desktop/src/renderer/src/components/DiffView.tsx`
- Modify: `apps/desktop/src/renderer/src/components/DiffPanel.tsx`, `apps/desktop/src/renderer/src/components/diff-panel.css`
- Test: `apps/desktop/test/diff-rows.test.ts`

- [ ] **Step 1: 실패하는 diff-rows 테스트**

Create `apps/desktop/test/diff-rows.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { DiffHunk, DiffLine } from '@git-gui/domain'
import { buildDiffRows } from '../src/renderer/src/components/diff-rows'

function line(kind: DiffLine['kind'], text: string): DiffLine {
  return { kind, oldLine: kind === 'add' ? null : 1, newLine: kind === 'del' ? null : 1, text }
}

describe('buildDiffRows', () => {
  const hunks: DiffHunk[] = [
    { header: '@@ -1,2 +1,2 @@', lines: [line('context', 'a'), line('del', 'b'), line('add', 'c')] },
    { header: '@@ -10,1 +10,1 @@', lines: [line('context', 'z')] },
  ]

  it('unified — hunk 헤더 행과 라인 행을 순서대로 평탄화한다', () => {
    const rows = buildDiffRows(hunks, 'unified')
    expect(rows.map((r) => r.kind)).toEqual(['hunk', 'line', 'line', 'line', 'hunk', 'line'])
    expect(rows[0]).toEqual({ kind: 'hunk', header: '@@ -1,2 +1,2 @@' })
    expect(rows[1]).toEqual({ kind: 'line', line: hunks[0]!.lines[0]! })
  })

  it('split — pairHunkLines 결과를 행으로 평탄화한다 (del|add가 한 행)', () => {
    const rows = buildDiffRows(hunks, 'split')
    expect(rows.map((r) => r.kind)).toEqual(['hunk', 'split', 'split', 'hunk', 'split'])
    const paired = rows[2]!
    if (paired.kind !== 'split') throw new Error('unreachable')
    expect(paired.left?.kind).toBe('del')
    expect(paired.right?.kind).toBe('add')
  })

  it('빈 hunks면 빈 배열', () => {
    expect(buildDiffRows([], 'unified')).toEqual([])
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run apps/desktop/test/diff-rows.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: diff-rows 구현**

Create `apps/desktop/src/renderer/src/components/diff-rows.ts`:

```ts
import type { DiffHunk, DiffLine } from '@git-gui/domain'
import { pairHunkLines } from './diff-split'

/** 가상화를 위해 hunk 중첩 구조를 한 층의 행 배열로 편다 — 행 하나가 가상 아이템 하나다 */
export type DiffRow =
  | { kind: 'hunk'; header: string }
  | { kind: 'line'; line: DiffLine }
  | { kind: 'split'; left: DiffLine | null; right: DiffLine | null }

export function buildDiffRows(hunks: DiffHunk[], view: 'unified' | 'split'): DiffRow[] {
  const rows: DiffRow[] = []
  for (const hunk of hunks) {
    rows.push({ kind: 'hunk', header: hunk.header })
    if (view === 'unified') {
      for (const line of hunk.lines) rows.push({ kind: 'line', line })
    } else {
      for (const pair of pairHunkLines(hunk.lines)) {
        rows.push({ kind: 'split', left: pair.left, right: pair.right })
      }
    }
  }
  return rows
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run apps/desktop/test/diff-rows.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: DiffView 추출 (가상화 렌더)**

Create `apps/desktop/src/renderer/src/components/DiffView.tsx` (DiffPanel의 본문 렌더를 이관 — UnifiedLine·SplitCell은 여기로 이사한다):

```tsx
import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef } from 'react'
import type { DiffLine, FileDiff } from '@git-gui/domain'
import { buildDiffRows } from './diff-rows'
import './diff-panel.css'

interface DiffViewProps {
  diff: FileDiff
  view: 'unified' | 'split'
}

function UnifiedLine({ line }: { line: DiffLine }) {
  return (
    <div className={`diff-line diff-line--${line.kind}`}>
      <span className="diff-line__no" aria-hidden="true">
        {line.oldLine ?? ''}
      </span>
      <span className="diff-line__no" aria-hidden="true">
        {line.newLine ?? ''}
      </span>
      <span className="diff-line__text">{line.text || ' '}</span>
    </div>
  )
}

function SplitCell({
  line,
  side,
  duplicate = false,
}: {
  line: DiffLine | null
  side: 'left' | 'right'
  /** 좌우에 같은 라인이 놓인 사본(context 등) — 오른쪽 사본은 스크린리더 중복 낭독을 막는다 */
  duplicate?: boolean
}) {
  if (line === null) {
    return <div className="diff-cell diff-cell--empty" aria-hidden="true" />
  }
  const lineNo = side === 'left' ? line.oldLine : line.newLine
  return (
    <div className={`diff-cell diff-line--${line.kind}`} aria-hidden={duplicate ? true : undefined}>
      <span className="diff-line__no" aria-hidden="true">
        {lineNo ?? ''}
      </span>
      <span className="diff-line__text">{line.text || ' '}</span>
    </div>
  )
}

/**
 * 구조화된 diff의 본문 렌더 — DiffPanel(작업 diff)과 CommitDetailPanel(커밋 diff)이 공유한다.
 * 행을 평탄화해 가상화한다 (#4) — 수십만 줄 diff에서도 DOM은 가시 범위만 유지된다.
 */
export function DiffView({ diff, view }: DiffViewProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const rows = buildDiffRows(diff.hunks, view)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 21,
    overscan: 20,
  })

  if (diff.isBinary) {
    return <p className="diff-panel__empty">텍스트가 아닌 파일이라 내용 비교를 보여드릴 수 없어요</p>
  }
  if (diff.hunks.length === 0 && diff.meta.length > 0) {
    // 내용 변경 없는 메타 변경(권한 모드·rename 등) — 원문을 그대로 보여준다 (정보 손실 방지)
    return (
      <div className="diff-panel__code">
        {diff.meta.map((line, index) => (
          <div key={index} className="diff-line diff-line--note">
            <span className="diff-line__text">{line}</span>
          </div>
        ))}
      </div>
    )
  }
  if (diff.hunks.length === 0) {
    return <p className="diff-panel__empty">변경 내용이 없어요</p>
  }
  return (
    <div ref={scrollRef} className="virtual-scroll" data-testid={`diff-view-${view}`}>
      <div
        className="diff-panel__code"
        style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index]!
          return (
            <div
              key={item.index}
              ref={virtualizer.measureElement}
              data-index={item.index}
              className="virtual-row"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              {row.kind === 'hunk' ? (
                <div className="diff-line diff-line--hunk">{row.header}</div>
              ) : row.kind === 'line' ? (
                <UnifiedLine line={row.line} />
              ) : (
                <div className="diff-split-row">
                  <SplitCell line={row.left} side="left" />
                  <SplitCell
                    line={row.right}
                    side="right"
                    duplicate={row.right !== null && row.left === row.right}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: DiffPanel을 DiffView 위임으로 축소**

`apps/desktop/src/renderer/src/components/DiffPanel.tsx` 전체 교체:

```tsx
import { Columns2, Rows3, X } from 'lucide-react'
import { useState } from 'react'
import type { FileDiff } from '@git-gui/domain'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import { DiffView } from './DiffView'
import './diff-panel.css'

interface DiffPanelProps {
  path: string | null
  diff: FileDiff | null
  /** in-flight selectFile이 clear를 덮어쓰는 레이스 방지 — busy 중엔 닫기도 잠근다 */
  busy: boolean
  onClose(): void
}

export function DiffPanel({ path, diff, busy, onClose }: DiffPanelProps) {
  const [view, setView] = useState<'unified' | 'split'>('unified')

  if (!path || diff === null) {
    return (
      <Panel title="변경 내용" testId="diff-panel">
        <p className="diff-panel__empty">파일을 선택하면 무엇이 바뀌었는지 보여드려요</p>
      </Panel>
    )
  }
  return (
    <Panel
      title={path}
      accessory={
        <>
          <Badge tone="git">diff</Badge>
          {/* 가시 라벨이 접근 이름이 된다 — aria-label로 덮지 않는다 (WCAG 2.5.3) */}
          <Button
            variant="ghost"
            size="sm"
            onPress={() => setView(view === 'unified' ? 'split' : 'unified')}
            testId="diff-view-toggle"
          >
            {view === 'unified' ? (
              <Columns2 size={13} aria-hidden="true" />
            ) : (
              <Rows3 size={13} aria-hidden="true" />
            )}
            {view === 'unified' ? '좌우 보기' : '한 줄 보기'}
          </Button>
          {/* 가시 라벨 "닫기"가 접근 이름이 된다 — aria-label로 덮지 않는다 (WCAG 2.5.3) */}
          <Button variant="ghost" size="sm" isDisabled={busy} onPress={onClose} testId="diff-close">
            <X size={13} aria-hidden="true" /> 닫기
          </Button>
        </>
      }
      testId="diff-panel"
    >
      <DiffView diff={diff} view={view} />
    </Panel>
  )
}
```

- [ ] **Step 7: diff CSS 조정**

`apps/desktop/src/renderer/src/components/diff-panel.css`의 `.diff-panel__code` 블록을 교체 (세로 padding이 가상 좌표를 어긋내지 않게 제거):

```css
.diff-panel__code {
  padding: 0;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 1.7;
}
```

- [ ] **Step 8: 전체 게이트 (diff 토글 E2E가 기존 회귀 방어)**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build && (cd apps/desktop && pnpm e2e)`
Expected: 164 tests + typecheck 5 + build + **E2E 5 passed** — 전부 exit 0

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/renderer/src/components apps/desktop/test/diff-rows.test.ts
git commit -m "feat(desktop): DiffView 추출 + diff 행 가상화 — 대형 diff 렌더 (#4)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: renderer — store 커밋 선택 상태 + 변경 취소 + 로그 더 불러오기

**Files:**
- Modify: `apps/desktop/src/renderer/src/store/repository-store.ts`

- [ ] **Step 1: store 확장**

`apps/desktop/src/renderer/src/store/repository-store.ts` 전체 교체:

```ts
import { create } from 'zustand'
import type {
  CommitDetail,
  CommitFileChange,
  CommitSummary,
  FileChange,
  FileDiff,
  RepositoryStatus,
} from '@git-gui/domain'

const git = () => window.gitApi

/** 히스토리 첫 페이지 크기 — 스크롤 끝에서 HISTORY_PAGE씩 상한을 늘려 다시 불러온다 (⑩) */
export const HISTORY_LIMIT = 50
const HISTORY_PAGE = 200
/** IPC assertLimit와 동일한 상한 — 이 이상은 더 불러오지 않는다 */
const HISTORY_MAX = 10000

export interface SelectedFile {
  change: FileChange
  staged: boolean
}

interface RepositoryStore {
  repoPath: string | null
  status: RepositoryStatus | null
  history: CommitSummary[]
  /** 현재 히스토리 조회 상한 — history.length >= historyLimit이면 뒤가 더 있을 수 있다 */
  historyLimit: number
  selected: SelectedFile | null
  diff: FileDiff | null
  /** 커밋 클릭 상세 — 열려 있으면 중앙 패널이 커밋 상세로 바뀐다. 파일 diff 선택과 상호 배타 */
  commitDetail: CommitDetail | null
  /** 커밋 상세 안에서 선택된 파일 — diff는 공용 diff 슬롯을 쓴다 */
  commitFile: CommitFileChange | null
  error: string | null
  busy: boolean

  init(): Promise<void>
  openRepository(): Promise<void>
  refresh(): Promise<void>
  stage(paths: string[]): Promise<void>
  unstage(paths: string[]): Promise<void>
  /** 선택 파일 변경 취소 — 확인창(UI 책임)을 통과한 뒤에만 호출된다. 되돌릴 수 없다 (⑪) */
  discard(trackedPaths: string[], untrackedPaths: string[]): Promise<void>
  selectFile(selected: SelectedFile): Promise<void>
  /** diff 선택 해제 — 동기 상태 변경이라 guard 불필요 */
  clearSelection(): void
  selectCommit(hash: string): Promise<void>
  selectCommitFile(file: CommitFileChange): Promise<void>
  /** 커밋 상세 닫기 — 동기 상태 변경이라 guard 불필요 */
  clearCommit(): void
  /** 스크롤 끝에서 히스토리 상한을 늘려 다시 불러온다 (⑩) */
  loadMoreHistory(): Promise<void>
  /** 성공 여부를 반환한다 — 실패 시 입력 메시지를 보존하기 위해 */
  commit(message: string): Promise<boolean>
  backup(): Promise<void>
}

/** IPC 에러 메시지의 Electron 래핑 접두사를 벗겨 사용자 메시지만 남긴다 (GitError 등 커스텀 이름 포함) */
function toErrorMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause)
  return message.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '')
}

/** 상태와 역사를 동시 조회해 같은 렌더에 함께 갱신한다 — 시점 차이를 최소화 (원자 스냅샷은 아님) */
async function fetchSnapshot(
  repoPath: string,
  limit: number,
): Promise<Pick<RepositoryStore, 'status' | 'history'>> {
  const [status, history] = await Promise.all([
    git().repo.status(repoPath),
    git().history.list(repoPath, limit),
  ])
  return { status, history }
}

/** 선택 상태 일괄 해제 — 저장소 내용이 바뀌는 모든 지점에서 보던 diff·상세를 무효화한다 */
const CLEAR_SELECTIONS = {
  selected: null,
  diff: null,
  commitDetail: null,
  commitFile: null,
} as const

type StoreSet = (partial: Partial<RepositoryStore>) => void
type StoreGet = () => RepositoryStore

/** busy 재진입을 거부하고 busy/error 처리를 일원화한다. 성공 여부를 반환한다 */
async function guard(set: StoreSet, get: StoreGet, run: () => Promise<void>): Promise<boolean> {
  if (get().busy) return false
  set({ busy: true, error: null })
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

export const useRepositoryStore = create<RepositoryStore>((set, get) => ({
  repoPath: null,
  status: null,
  history: [],
  historyLimit: HISTORY_LIMIT,
  selected: null,
  diff: null,
  commitDetail: null,
  commitFile: null,
  error: null,
  busy: false,

  async init() {
    await guard(set, get, async () => {
      const initial = await git().repo.initialPath()
      if (!initial) return
      set({ repoPath: initial, ...(await fetchSnapshot(initial, get().historyLimit)) })
    })
  },

  async openRepository() {
    await guard(set, get, async () => {
      const path = await git().repo.select()
      if (!path) return
      // guard가 재진입을 거부하므로 refresh()를 부르지 않고 직접 조회한다.
      // 다른 저장소다 — 히스토리 상한도 첫 페이지로 되돌린다
      set({
        repoPath: path,
        historyLimit: HISTORY_LIMIT,
        ...CLEAR_SELECTIONS,
        ...(await fetchSnapshot(path, HISTORY_LIMIT)),
      })
    })
  },

  async refresh() {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      // 외부(CLI 등)에서 상태가 바뀌었을 수 있다 — 보고 있던 diff·상세도 함께 무효화한다
      set({ ...CLEAR_SELECTIONS, ...(await fetchSnapshot(repoPath, get().historyLimit)) })
    })
  },

  async stage(paths) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      await git().changes.stage(repoPath, paths)
      // stage 후에는 보고 있던 diff의 의미가 달라진다(오인 커밋 방지) — 선택을 비운다
      set({ ...CLEAR_SELECTIONS, ...(await fetchSnapshot(repoPath, get().historyLimit)) })
    })
  },

  async unstage(paths) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      await git().changes.unstage(repoPath, paths)
      set({ ...CLEAR_SELECTIONS, ...(await fetchSnapshot(repoPath, get().historyLimit)) })
    })
  },

  async discard(trackedPaths, untrackedPaths) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      // 파괴적 작업 — 부분 실행으로 실패해도 이미 지워진 것이 있다.
      // finally로 스냅샷을 갱신해 stale한 "수정됨" 표시를 남기지 않는다 (리뷰 실측 반영)
      try {
        await git().changes.discard(repoPath, trackedPaths, untrackedPaths)
      } finally {
        set({ ...CLEAR_SELECTIONS, ...(await fetchSnapshot(repoPath, get().historyLimit)) })
      }
    })
  },

  async selectFile(selected) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      const untracked = selected.change.unstaged === 'untracked'
      const diff = await git().changes.diff(repoPath, selected.change.path, {
        staged: selected.staged,
        untracked,
        // staged rename은 원래 경로를 동봉해야 rename으로 표시된다 (unstage와 대칭)
        origPath: selected.staged ? selected.change.origPath : null,
      })
      // 파일 diff와 커밋 상세는 상호 배타 — 중앙 패널이 하나다
      set({ selected, diff, commitDetail: null, commitFile: null })
    })
  },

  clearSelection() {
    set({ selected: null, diff: null })
  },

  async selectCommit(hash) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      const commitDetail = await git().commits.show(repoPath, hash)
      set({ commitDetail, commitFile: null, selected: null, diff: null })
    })
  },

  async selectCommitFile(file) {
    const { repoPath, commitDetail } = get()
    if (!repoPath || !commitDetail) return
    await guard(set, get, async () => {
      const diff = await git().commits.diffFile(repoPath, commitDetail.hash, file.path, file.origPath)
      set({ diff, commitFile: file })
    })
  },

  clearCommit() {
    set({ commitDetail: null, commitFile: null, diff: null })
  },

  async loadMoreHistory() {
    const { repoPath, history, historyLimit } = get()
    // 끝까지 다 봤거나(뒤가 없음) 상한에 닿았으면 더 부르지 않는다
    if (!repoPath || history.length < historyLimit || historyLimit >= HISTORY_MAX) return
    await guard(set, get, async () => {
      const next = Math.min(historyLimit + HISTORY_PAGE, HISTORY_MAX)
      const more = await git().history.list(repoPath, next)
      set({ history: more, historyLimit: next })
    })
  },

  async commit(message) {
    const { repoPath } = get()
    if (!repoPath) return false
    return guard(set, get, async () => {
      await git().commits.create(repoPath, message)
      set({ ...CLEAR_SELECTIONS, ...(await fetchSnapshot(repoPath, get().historyLimit)) })
    })
  },

  async backup() {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      await git().sync.push(repoPath)
      // 백업 후 upstream/ahead/behind가 바뀐다 — 스냅샷 갱신
      set({ ...(await fetchSnapshot(repoPath, get().historyLimit)) })
    })
  },
}))
```

- [ ] **Step 2: 게이트**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build`
Expected: 전부 PASS/Done/성공

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/src/store/repository-store.ts
git commit -m "feat(desktop): store 커밋 선택 상태 — selectCommit·selectCommitFile·무효화 일원화

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: renderer — HistoryPanel 클릭·배지·가상화 + CommitDetailPanel + App 배선

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/HistoryPanel.tsx`, `apps/desktop/src/renderer/src/components/history-panel.css`, `apps/desktop/src/renderer/src/App.tsx`
- Create: `apps/desktop/src/renderer/src/components/CommitDetailPanel.tsx`, `apps/desktop/src/renderer/src/components/commit-detail-panel.css`
- Test: `apps/desktop/e2e/smoke.spec.ts`

- [ ] **Step 1: HistoryPanel — 클릭·refs/병합 배지·가상화**

`apps/desktop/src/renderer/src/components/HistoryPanel.tsx` 전체 교체:

```tsx
import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useRef } from 'react'
import type { CommitSummary } from '@git-gui/domain'
import { Badge } from '../ui/Badge'
import { Panel } from '../ui/Panel'
import { Pictogram } from '../ui/Pictogram'
import { formatRelativeTime } from './relative-time'
import './history-panel.css'

interface HistoryPanelProps {
  history: CommitSummary[]
  /** 현재 조회 상한 — 목록이 상한에 닿으면 "N+"로 표기하고, 스크롤 끝에서 더 불러온다 (⑩) */
  historyLimit: number
  /** 현재 브랜치 — 같은 이름의 ref 배지를 강조한다 */
  currentBranch: string | null
  selectedHash: string | null
  busy: boolean
  onSelect(hash: string): void
  onLoadMore(): void
}

export function HistoryPanel({
  history,
  historyLimit,
  currentBranch,
  selectedHash,
  busy,
  onSelect,
  onLoadMore,
}: HistoryPanelProps) {
  const truncated = history.length >= historyLimit
  // 수천 커밋에서도 DOM은 가시 범위만 유지한다 (#4)
  const scrollRef = useRef<HTMLDivElement | null>(null)
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
              // 가상화에서는 :last-child가 "전체의 마지막"이 아니다 — 커넥터·잘림 표시는 index로 판정한다
              const isLast = item.index === history.length - 1
              const connected = !isLast || truncated
              return (
                <li
                  key={commit.hash}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  className="virtual-row"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <button
                    type="button"
                    className={[
                      'history-item',
                      item.index === 0 ? 'history-item--head' : '',
                      connected ? 'history-item--connected' : '',
                      isLast && truncated ? 'history-item--truncated' : '',
                      selectedHash === commit.hash ? 'history-item--selected' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    disabled={busy}
                    onClick={() => onSelect(commit.hash)}
                    data-testid={`history-item-${commit.hash}`}
                  >
                    <span className="history-item__dot" aria-hidden="true" />
                    <div className="history-item__body">
                      <span className="history-item__title">
                        {commit.refs.map((ref) => (
                          <span
                            key={ref}
                            className={`history-item__ref${
                              ref === currentBranch ? ' history-item__ref--head' : ''
                            }`}
                          >
                            {ref}
                          </span>
                        ))}
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
        </div>
      )}
    </Panel>
  )
}
```

- [ ] **Step 2: history CSS — 버튼 행·배지·커넥터 클래스 전환**

`apps/desktop/src/renderer/src/components/history-panel.css`의 `.history-panel__list` 블록부터 파일 끝까지를 다음으로 교체 (`.history-panel__empty` 블록 2개는 그대로 둔다):

```css
.history-panel__list {
  list-style: none;
  margin: 0;
  padding: 0;
}
/* 커넥터는 항목 단위로 그린다 — 가상화에서 :last-child가 전체의 끝이 아니므로 JS가 클래스로 판정한다 (#5) */
.history-item--connected::after {
  content: '';
  position: absolute;
  left: 16px;
  top: 21px; /* 점 아래에서 시작 */
  bottom: -12px; /* 다음 항목의 점 위까지 */
  width: 2px;
  background: var(--color-border);
}
/* 목록이 상한에 잘렸을 때만: 마지막 점 아래로 흐려지며 이어지는 표시 */
.history-item--truncated::after {
  bottom: auto;
  height: 16px;
  background: linear-gradient(var(--color-border), transparent);
}
.history-item {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  position: relative;
  width: 100%;
  border: none;
  background: none;
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: inherit;
}
.history-item:hover:not(:disabled) {
  background: var(--color-surface-sunken);
}
.history-item--selected,
.history-item--selected:hover:not(:disabled) {
  background: var(--color-selection-bg);
}
.history-item:disabled {
  cursor: default;
}
.history-item__dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 2px solid var(--concept-commit);
  background: var(--color-surface);
  margin-top: 4px;
  flex: none;
  position: relative;
  z-index: 1;
}
.history-item--head .history-item__dot {
  background: var(--concept-commit);
}
.history-item__body {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.history-item__title {
  display: flex;
  align-items: baseline;
  gap: var(--space-1);
  min-width: 0;
}
/* 브랜치/태그 배지 (#7) — 이 커밋이 어느 실험 공간의 끝인지 보여준다 */
.history-item__ref {
  flex: none;
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--color-surface-sunken);
  border: 1px solid var(--color-border);
  color: var(--color-text-muted);
}
.history-item__ref--head {
  background: var(--color-selection-bg);
  border-color: var(--color-accent);
  color: var(--color-accent);
}
/* 병합 커밋 표시 (#7) — 두 흐름이 합쳐진 저장임을 알린다 */
.history-item__mergemark {
  flex: none;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--color-surface-sunken);
  border: 1px solid var(--color-border);
  color: var(--concept-branch);
}
.history-item__subject {
  font-size: var(--text-sm);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.history-item__meta {
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}
.history-item__hash {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--color-text-faint);
  flex: none;
}
```

- [ ] **Step 3: CommitDetailPanel**

Create `apps/desktop/src/renderer/src/components/CommitDetailPanel.tsx`:

```tsx
import { useVirtualizer } from '@tanstack/react-virtual'
import { Columns2, Rows3, X } from 'lucide-react'
import { useRef, useState } from 'react'
import type { CommitDetail, CommitFileChange, FileDiff } from '@git-gui/domain'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import { KIND_GLYPHS, KIND_LABELS } from './change-kind'
import { DiffView } from './DiffView'
import { formatRelativeTime } from './relative-time'
import './commit-detail-panel.css'

interface CommitDetailPanelProps {
  detail: CommitDetail
  /** 상세 안에서 선택된 파일과 그 diff — 공용 diff 슬롯 */
  selectedFile: CommitFileChange | null
  diff: FileDiff | null
  busy: boolean
  onSelectFile(file: CommitFileChange): void
  onClose(): void
}

function CommitFileRow({
  file,
  isSelected,
  busy,
  onSelect,
}: {
  file: CommitFileChange
  isSelected: boolean
  busy: boolean
  onSelect(): void
}) {
  const kindLabel = KIND_LABELS[file.kind]
  const tooltip =
    file.kind === 'renamed' && file.origPath !== null
      ? `${file.origPath} → ${file.path} — ${kindLabel}`
      : `${file.path} — ${kindLabel}`
  const slashIndex = file.path.lastIndexOf('/')
  const directory = slashIndex >= 0 ? file.path.slice(0, slashIndex) : ''
  const basename = slashIndex >= 0 ? file.path.slice(slashIndex + 1) : file.path
  return (
    <button
      type="button"
      className={`file-row__main file-row__main--${file.kind} commit-file-row${
        isSelected ? ' commit-file-row--selected' : ''
      }`}
      disabled={busy}
      onClick={onSelect}
      title={tooltip}
      aria-label={tooltip}
      data-testid={`commit-file-${file.path}`}
    >
      <span className="file-row__kind" aria-hidden="true">
        {KIND_GLYPHS[file.kind]}
      </span>
      <span className="file-row__name">
        <span className="file-row__base">{basename}</span>
        {directory && <span className="file-row__dir">{directory}</span>}
      </span>
    </button>
  )
}

/** 커밋 클릭 상세 (#6) — 전체 메시지·변경 파일 목록·파일별 diff(첫 부모 기준) */
export function CommitDetailPanel({
  detail,
  selectedFile,
  diff,
  busy,
  onSelectFile,
  onClose,
}: CommitDetailPanelProps) {
  const [view, setView] = useState<'unified' | 'split'>('unified')
  // 대형 커밋(수천 파일)에서도 파일 목록은 가시 범위만 렌더한다 (#4)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count: detail.files.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 31,
    overscan: 10,
  })

  return (
    <Panel
      title={detail.subject}
      accessory={
        <>
          <Badge tone="git">commit</Badge>
          <Badge tone="count">{detail.shortHash}</Badge>
          {selectedFile !== null && (
            <Button
              variant="ghost"
              size="sm"
              onPress={() => setView(view === 'unified' ? 'split' : 'unified')}
              testId="diff-view-toggle"
            >
              {view === 'unified' ? (
                <Columns2 size={13} aria-hidden="true" />
              ) : (
                <Rows3 size={13} aria-hidden="true" />
              )}
              {view === 'unified' ? '좌우 보기' : '한 줄 보기'}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            isDisabled={busy}
            onPress={onClose}
            testId="commit-detail-close"
          >
            <X size={13} aria-hidden="true" /> 닫기
          </Button>
        </>
      }
      testId="commit-detail-panel"
    >
      <div className="commit-detail__message">
        <p className="commit-detail__subject" data-testid="commit-detail-subject">
          {detail.subject}
        </p>
        {detail.body !== '' && (
          <pre className="commit-detail__body" data-testid="commit-detail-body">
            {detail.body}
          </pre>
        )}
        <p className="commit-detail__meta">
          {formatRelativeTime(detail.committedAt, Date.now())} · {detail.authorName}
          {detail.parents.length >= 2 && ' · 병합 (첫 번째 흐름 기준으로 보여드려요)'}
        </p>
      </div>
      <div className="commit-detail__files-head">
        바뀐 파일 <span data-testid="commit-detail-file-count">{detail.files.length}</span>개
        {detail.files.length > 0 && ' — 파일을 누르면 무엇이 바뀌었는지 보여드려요'}
      </div>
      <div ref={scrollRef} className="virtual-scroll commit-detail__files">
        <ul
          className="changes-panel__list"
          style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const file = detail.files[item.index]!
            return (
              <li
                key={file.path}
                ref={virtualizer.measureElement}
                data-index={item.index}
                className="virtual-row"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <CommitFileRow
                  file={file}
                  isSelected={selectedFile?.path === file.path}
                  busy={busy}
                  onSelect={() => onSelectFile(file)}
                />
              </li>
            )
          })}
        </ul>
      </div>
      {selectedFile !== null && diff !== null && (
        <div className="commit-detail__diff">
          <DiffView diff={diff} view={view} />
        </div>
      )}
    </Panel>
  )
}
```

- [ ] **Step 4: 상세 CSS**

Create `apps/desktop/src/renderer/src/components/commit-detail-panel.css`:

```css
.commit-detail__message {
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--color-border);
}
.commit-detail__subject {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: 700;
}
.commit-detail__body {
  margin: var(--space-2) 0 0;
  font-family: inherit;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.commit-detail__meta {
  margin: var(--space-2) 0 0;
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}
.commit-detail__files-head {
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  border-bottom: 1px solid var(--color-border);
}
/* 파일 목록과 diff가 세로 공간을 나눈다 — 목록은 상한을 갖고 diff가 잔여를 차지한다.
   .virtual-scroll(flex:1)보다 특이도 높은 복합 선택자로 결정적으로 이긴다 (!important 불요) */
.commit-detail__files.virtual-scroll {
  flex: 0 1 220px;
}
.commit-detail__diff {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--color-border);
}
.commit-file-row {
  width: 100%;
}
.commit-file-row--selected {
  background: var(--color-selection-bg);
}
```

- [ ] **Step 5: App 배선**

`apps/desktop/src/renderer/src/App.tsx` 수정:

(a) import에 CommitDetailPanel 추가 — `import { CommitForm } ...` 행 앞에:

```tsx
import { CommitDetailPanel } from './components/CommitDetailPanel'
```

(b) `<main className="app__main">` 안의 `.app__center` 블록과 HistoryPanel을 다음으로 교체:

```tsx
        <div className="app__center">
          {store.commitDetail !== null ? (
            <CommitDetailPanel
              detail={store.commitDetail}
              selectedFile={store.commitFile}
              diff={store.diff}
              busy={store.busy}
              onSelectFile={(file) => void store.selectCommitFile(file)}
              onClose={() => store.clearCommit()}
            />
          ) : (
            <DiffPanel
              path={store.selected?.change.path ?? null}
              diff={store.diff}
              busy={store.busy}
              onClose={() => store.clearSelection()}
            />
          )}
          <CommitForm
            stagedCount={stagedCount}
            busy={store.busy}
            suggestion={suggestion}
            onCommit={(message) => store.commit(message)}
          />
        </div>
        <HistoryPanel
          history={store.history}
          historyLimit={store.historyLimit}
          currentBranch={status?.branch.name ?? null}
          selectedHash={store.commitDetail?.hash ?? null}
          busy={store.busy}
          onSelect={(hash) => void store.selectCommit(hash)}
          onLoadMore={() => void store.loadMoreHistory()}
        />
```

(c) `HISTORY_LIMIT` import가 더는 쓰이지 않는다 — `import { HISTORY_LIMIT, useRepositoryStore } from './store/repository-store'` 행을 `import { useRepositoryStore } from './store/repository-store'`로 교체.

- [ ] **Step 6: 실패하는 E2E — 커밋 상세**

`apps/desktop/e2e/smoke.spec.ts` 끝에 추가:

```ts
test('커밋을 누르면 전체 메시지·바뀐 파일·diff가 보인다', async () => {
  const repo = await createRepoWithChange()
  // 본문 있는 커밋을 하나 더 쌓는다 — 상세에서 본문 표시를 검증한다
  await execGitOrThrow(['add', '-A'], { cwd: repo })
  await execGitOrThrow(
    ['commit', '-m', '두 번째 저장', '-m', '자세한 설명 줄'],
    { cwd: repo },
  )
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('history-count')).toHaveText('2')
    // 최신 커밋 클릭 → 상세: 제목·본문·파일 목록
    await window.locator('[data-testid^="history-item-"]').first().click()
    await expect(window.getByTestId('commit-detail-subject')).toHaveText('두 번째 저장')
    await expect(window.getByTestId('commit-detail-body')).toHaveText('자세한 설명 줄')
    await expect(window.getByTestId('commit-detail-file-count')).toHaveText('1')
    // 파일 클릭 → diff (v1 → v2 수정이 보인다)
    await window.getByTestId('commit-file-app.txt').click()
    await expect(window.getByTestId('diff-view-unified')).toContainText('v2')
    // 닫기 → 원래 diff 패널로 복귀
    await window.getByTestId('commit-detail-close').click()
    await expect(window.getByTestId('diff-panel')).toBeVisible()
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('스크롤 끝에서 저장 역사를 더 불러온다 (50개 제한 해제)', async () => {
  const repo = await createRepoWithChange()
  for (let i = 0; i < 60; i += 1) {
    await execGitOrThrow(['commit', '--allow-empty', '-m', `bulk ${i}`], { cwd: repo })
  }
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('history-count')).toHaveText('50+')
    // 히스토리 스크롤을 끝까지 내리면 다음 페이지를 불러온다 (⑩)
    await window.getByTestId('history-scroll').evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    await expect(window.getByTestId('history-count')).toHaveText('61')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})
```

- [ ] **Step 7: 실패 확인 → 전체 게이트**

Run: `cd apps/desktop && pnpm e2e`
Expected: Step 1~5 적용 전이면 새 테스트 2개 FAIL(클릭 불가·상세 없음·50+ 고정), 적용 후 **E2E 7 passed**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build && (cd apps/desktop && pnpm e2e)`
Expected: 164 tests + typecheck 5 + build + **E2E 7 passed** — 전부 exit 0

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/renderer/src apps/desktop/e2e/smoke.spec.ts
git commit -m "feat(desktop): 커밋 클릭 상세·refs/병합 배지·히스토리 가상화 (#6·#7)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8b: renderer — 선택 파일 변경 취소 UI (확인창, 피드백 ⑪)

사용자 결정: "지금 바로, 확인창만" — 되돌릴 수 없음을 명시한 확인창을 거쳐 store.discard를 호출한다. unstaged 목록에만 붙는다(staged는 내리기가 이미 안전한 취소다).

**Files:**
- Modify: `apps/desktop/src/renderer/src/ui/Button.tsx`, `apps/desktop/src/renderer/src/ui/button.css`, `apps/desktop/src/renderer/src/components/ChangesPanel.tsx`, `apps/desktop/src/renderer/src/App.tsx`
- Create: `apps/desktop/src/renderer/src/ui/ConfirmDialog.tsx`, `apps/desktop/src/renderer/src/ui/confirm-dialog.css`
- Test: `apps/desktop/e2e/smoke.spec.ts`

- [ ] **Step 1: Button danger 변형**

`apps/desktop/src/renderer/src/ui/Button.tsx`의 `type Variant = 'primary' | 'neutral' | 'ghost'`를 다음으로 교체:

```ts
type Variant = 'primary' | 'neutral' | 'ghost' | 'danger'
```

`apps/desktop/src/renderer/src/ui/button.css` 끝에 추가:

```css
/* 되돌릴 수 없는 동작 전용 — 색만으로 전달하지 않도록 라벨에 항상 동작명을 쓴다 */
.ui-button--danger {
  background: transparent;
  border: 1px solid transparent;
  color: var(--color-danger);
}
.ui-button--danger[data-hovered] {
  background: var(--color-surface-sunken);
}
.ui-button--danger[data-pressed] {
  background: var(--color-border);
}
```

- [ ] **Step 2: ConfirmDialog**

Create `apps/desktop/src/renderer/src/ui/ConfirmDialog.tsx`:

```tsx
import type { ReactNode } from 'react'
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { Button } from './Button'
import './confirm-dialog.css'

interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  onConfirm(): void
  onCancel(): void
}

/** 되돌릴 수 없는 동작 전용 확인창 — ESC·바깥 클릭은 취소와 같다 */
export function ConfirmDialog({
  isOpen,
  title,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <ModalOverlay
      className="ui-modal-overlay"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
      isDismissable
    >
      <Modal className="ui-modal">
        <Dialog role="alertdialog" className="ui-dialog">
          <Heading slot="title" className="ui-dialog__title">
            {title}
          </Heading>
          <div className="ui-dialog__body">{children}</div>
          <div className="ui-dialog__actions">
            <Button variant="ghost" size="sm" onPress={onCancel} testId="confirm-cancel">
              그만두기
            </Button>
            <Button variant="danger" size="sm" onPress={onConfirm} testId="confirm-accept">
              {confirmLabel}
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
```

Create `apps/desktop/src/renderer/src/ui/confirm-dialog.css`:

```css
.ui-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.ui-modal {
  outline: none;
}
.ui-dialog {
  width: 340px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-2);
  padding: var(--space-4);
  outline: none;
}
.ui-dialog__title {
  margin: 0 0 var(--space-2);
  font-size: var(--text-sm);
  font-weight: 700;
}
.ui-dialog__body {
  margin: 0 0 var(--space-4);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  line-height: 1.7;
}
.ui-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
```

- [ ] **Step 3: ChangesPanel에 변경 취소 흐름**

`apps/desktop/src/renderer/src/components/ChangesPanel.tsx` 수정:

(a) import에 ConfirmDialog 추가 — `import { Button } from '../ui/Button'` 뒤에:

```tsx
import { ConfirmDialog } from '../ui/ConfirmDialog'
```

(b) `ChangesPanelProps`에 `onUnstage` 뒤 행으로 추가:

```ts
  /** 선택 파일 변경 취소 — tracked 경로와 untracked 경로를 분리해 넘긴다. 되돌릴 수 없다 */
  onDiscard(trackedPaths: string[], untrackedPaths: string[]): void
```

(c) `FileListProps`에 `bulkLabel: string` 뒤 행으로 추가:

```ts
  /** unstaged 목록에만 있다 — 확인창을 거쳐 선택 파일의 변경을 취소한다 */
  onDiscard?: (trackedPaths: string[], untrackedPaths: string[]) => void
```

(d) `FileList` 파라미터 구조 분해의 `bulkLabel,` 뒤에 `onDiscard,` 추가.

(e) `FileList` 본문의 `const runBulk = () => { ... }` 뒤에 추가:

```tsx
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const discardTracked = validChecked.filter((c) => c.unstaged !== 'untracked').map((c) => c.path)
  const discardUntracked = validChecked.filter((c) => c.unstaged === 'untracked').map((c) => c.path)
  const runDiscard = () => {
    setConfirmingDiscard(false)
    onDiscard?.(discardTracked, discardUntracked)
    setChecked(new Set())
  }
```

(f) bulk 바의 일괄 버튼(`선택 {bulkLabel} …` Button) 바로 뒤에 추가:

```tsx
            {onDiscard && (
              <Button
                variant="danger"
                size="sm"
                isDisabled={busy || validChecked.length === 0}
                onPress={() => setConfirmingDiscard(true)}
                testId="discard-selected"
              >
                변경 취소 ({validChecked.length})
              </Button>
            )}
```

(g) `</Panel>` 닫기 직전(가상 리스트 `</div>` 뒤, `</>` 앞)에 추가:

```tsx
          {onDiscard && (
            <ConfirmDialog
              isOpen={confirmingDiscard}
              title="변경 내용을 취소할까요?"
              confirmLabel="변경 취소"
              onConfirm={runDiscard}
              onCancel={() => setConfirmingDiscard(false)}
            >
              선택한 파일 {validChecked.length}개의 아직 올리지 않은 변경 내용을 되돌려요. 올려둔
              (staged) 내용은 남아요.
              {discardUntracked.length > 0 && ` 새 파일 ${discardUntracked.length}개는 삭제돼요.`} 이
              동작은 되돌릴 수 없어요.
            </ConfirmDialog>
          )}
```

(h) `ChangesPanel` 함수: props 구조 분해에 `onDiscard,` 추가(`onUnstage,` 뒤), unstaged 쪽 `<FileList …>`에 `onDiscard={onDiscard}` prop 추가 (`onAction={onStage}` 뒤 행).

- [ ] **Step 4: App 배선**

`apps/desktop/src/renderer/src/App.tsx`의 `<ChangesPanel …>`에 `onUnstage` 행 뒤로 추가:

```tsx
          onDiscard={(trackedPaths, untrackedPaths) =>
            void store.discard(trackedPaths, untrackedPaths)
          }
```

- [ ] **Step 5: 실패하는 E2E**

`apps/desktop/e2e/smoke.spec.ts` 끝에 추가:

```ts
test('선택한 파일의 변경을 확인창을 거쳐 취소한다 — 새 파일은 삭제된다', async () => {
  const repo = await createRepoWithChange()
  await writeFile(join(repo, 'temp.txt'), 'temp\n')
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('unstaged-count')).toHaveText('2')
    await window.getByTestId('check-all-unstaged').click()
    await window.getByTestId('discard-selected').click()
    // 그만두기 — 아무 일도 일어나지 않고 체크는 유지된다
    await window.getByTestId('confirm-cancel').click()
    await expect(window.getByTestId('unstaged-count')).toHaveText('2')
    // 다시 열어 변경 취소 — tracked는 복원, untracked(temp.txt)는 삭제
    await window.getByTestId('discard-selected').click()
    await window.getByTestId('confirm-accept').click()
    await expect(window.getByTestId('unstaged-count')).toHaveText('0')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})
```

- [ ] **Step 6: 실패 확인 → 전체 게이트**

Run: `cd apps/desktop && pnpm e2e`
Expected: 구현 전 새 테스트 FAIL(`discard-selected` 없음), 구현 후 **E2E 8 passed**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build && (cd apps/desktop && pnpm e2e)`
Expected: 164 tests + typecheck 5 + build + **E2E 8 passed** — 전부 exit 0

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/src apps/desktop/e2e/smoke.spec.ts
git commit -m "feat(desktop): 선택 파일 변경 취소 — 되돌릴 수 없음을 확인창으로 (⑪)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8c: renderer — 다크/라이트 테마 토글 (피드백 ⑥)

시스템 설정을 초기값으로 쓰되 버튼으로 전환하고 localStorage에 기억한다. tokens.css의 다크 블록을 media query에서 `:root[data-theme='dark']` 선택자로 옮겨 단일 정본을 유지한다(토큰 중복 없음).

**Files:**
- Modify: `apps/desktop/src/renderer/src/ui/tokens.css`, `apps/desktop/test/tokens-contrast.test.ts`, `apps/desktop/src/renderer/src/App.tsx`
- Create: `apps/desktop/src/renderer/src/ui/theme.ts`
- Test: `apps/desktop/test/theme.test.ts`, `apps/desktop/e2e/smoke.spec.ts`

- [ ] **Step 1: 실패하는 theme 단위 테스트**

Create `apps/desktop/test/theme.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { resolveInitialTheme } from '../src/renderer/src/ui/theme'

describe('resolveInitialTheme', () => {
  it('저장된 값이 있으면 시스템 설정보다 우선한다', () => {
    expect(resolveInitialTheme('light', true)).toBe('light')
    expect(resolveInitialTheme('dark', false)).toBe('dark')
  })

  it('저장된 값이 없으면 시스템 설정을 따른다', () => {
    expect(resolveInitialTheme(null, true)).toBe('dark')
    expect(resolveInitialTheme(null, false)).toBe('light')
  })

  it('알 수 없는 저장값은 무시하고 시스템 설정을 따른다', () => {
    expect(resolveInitialTheme('sepia', true)).toBe('dark')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run apps/desktop/test/theme.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: theme.ts 구현**

Create `apps/desktop/src/renderer/src/ui/theme.ts`:

```ts
const THEME_KEY = 'git-gui-theme'

export type Theme = 'light' | 'dark'

/** 저장된 값이 있으면 그것을, 없으면 시스템 설정을 따른다 — 순수 함수라 단위 테스트한다 */
export function resolveInitialTheme(stored: string | null, systemDark: boolean): Theme {
  if (stored === 'light' || stored === 'dark') return stored
  return systemDark ? 'dark' : 'light'
}

/** 첫 렌더에서 호출해 문서 루트에 테마를 새기고 현재 값을 돌려준다 */
export function initTheme(): Theme {
  const theme = resolveInitialTheme(
    localStorage.getItem(THEME_KEY),
    window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  document.documentElement.dataset.theme = theme
  return theme
}

/** 테마를 적용하고 기억한다 */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  localStorage.setItem(THEME_KEY, theme)
}
```

Run: `npx vitest run apps/desktop/test/theme.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 4: tokens.css — 다크 블록을 data-theme 선택자로**

`apps/desktop/src/renderer/src/ui/tokens.css`에서:

(a) 다크 블록을 여는 두 줄을 한 줄로 교체:

기존:
```css
@media (prefers-color-scheme: dark) {
  :root {
```
교체:
```css
:root[data-theme='dark'] {
```

(b) 파일 끝의 닫는 중괄호 두 줄(`  }` + `}`)을 한 줄 `}`로 교체. (블록 안 토큰 행들의 4칸 들여쓰기는 그대로 둔다 — 유효한 CSS.)

- [ ] **Step 5: 대비 회귀 테스트의 다크 블록 추출부 갱신**

`apps/desktop/test/tokens-contrast.test.ts`의 다음 세 줄을 교체:

기존:
```ts
const mediaIndex = css.indexOf('@media')
const lightTokens = parseTokens(css.slice(0, mediaIndex))
const darkTokens = new Map([...lightTokens, ...parseTokens(css.slice(mediaIndex))])
```
교체:
```ts
const darkIndex = css.indexOf(":root[data-theme='dark']")
const lightTokens = parseTokens(css.slice(0, darkIndex))
const darkTokens = new Map([...lightTokens, ...parseTokens(css.slice(darkIndex))])
```

Run: `npx vitest run apps/desktop/test/tokens-contrast.test.ts`
Expected: PASS (다크 대비 쌍이 계속 계산되는지 — 전멸 방어로 다크 토큰 수가 0이면 이 테스트가 실패해야 한다. 통과 후 `darkIndex`가 -1이 아님을 한 번 확인)

- [ ] **Step 6: App 헤더에 토글 버튼**

`apps/desktop/src/renderer/src/App.tsx` 수정:

(a) import 교체 — `import { CloudUpload, RefreshCw } from 'lucide-react'` → `import { CloudUpload, Moon, RefreshCw, Sun } from 'lucide-react'`, `import { useEffect } from 'react'` → `import { useEffect, useState } from 'react'`, 그리고 `import { Badge } from './ui/Badge'` 행 앞에:

```tsx
import { applyTheme, initTheme, type Theme } from './ui/theme'
```

(b) `const store = useRepositoryStore()` 뒤에 추가:

```tsx
  // 첫 렌더에서 문서에 테마를 새긴다 — 저장값 우선, 없으면 시스템 설정 (⑥)
  const [theme, setTheme] = useState<Theme>(() => initTheme())
  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    setTheme(next)
  }
```

(c) `app__actions`의 백업 버튼 **앞**에 추가:

```tsx
          <Button variant="ghost" size="sm" onPress={toggleTheme} testId="theme-toggle">
            {theme === 'dark' ? (
              <Sun size={13} aria-hidden="true" />
            ) : (
              <Moon size={13} aria-hidden="true" />
            )}
            {theme === 'dark' ? '밝게' : '어둡게'}
          </Button>
```

- [ ] **Step 7: E2E — 전환·기억**

`apps/desktop/e2e/smoke.spec.ts` 끝에 추가:

```ts
test('테마를 버튼으로 전환하고 기억한다', async () => {
  const repo = await createRepoWithChange()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    const initial = await window.evaluate(() => document.documentElement.dataset.theme)
    expect(['light', 'dark']).toContain(initial)
    await window.getByTestId('theme-toggle').click()
    const flipped = await window.evaluate(() => document.documentElement.dataset.theme)
    expect(flipped).not.toBe(initial)
    // 선택은 저장되어 다음 실행의 초기값이 된다
    const stored = await window.evaluate(() => localStorage.getItem('git-gui-theme'))
    expect(stored).toBe(flipped)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})
```

- [ ] **Step 8: 전체 게이트**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build && (cd apps/desktop && pnpm e2e)`
Expected: 167 tests + typecheck 5 + build + **E2E 9 passed** — 전부 exit 0

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/renderer/src apps/desktop/test apps/desktop/e2e/smoke.spec.ts
git commit -m "feat(desktop): 다크/라이트 테마 토글 — 시스템 초기값·localStorage 기억 (⑥)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: 최종 게이트 + 스크린샷 + README

- [ ] **Step 1: 전체 게이트**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build && (cd apps/desktop && pnpm e2e)`
Expected: 167 tests + typecheck 5 + build + **E2E 9 passed** — 전부 exit 0

- [ ] **Step 2: 스크린샷**

일회성 스크립트(커밋 미포함)로 실제 앱을 fixture로 구동해 `apps/desktop/test-results/`에 캡처 (1440×900):
- (a) `e0-3b-commit-detail.png` — 커밋 상세: 제목·본문·병합 안내 문구·파일 목록·파일 diff까지 한 화면 (merge 커밋 fixture)
- (b) `e0-3b-history-badges.png` — 타임라인: 현재 브랜치 강조 배지 + 다른 브랜치 배지 + "병합" 표시가 보이는 히스토리
- (c) `e0-3b-virtual.png` — 1500개 파일 변경 목록(개별 버튼 없는 새 행 UI + 긴 경로 가로 스크롤 중간 위치), 다크 모드로 촬영 — 테마 토글 확인 겸용
- (d) `e0-3b-discard.png` — 파일 여러 개 체크 후 "변경 취소 (N)" 확인창이 열린 모습

캡처 후 임시 스크립트·fixture 정리. 코디네이터가 사용자에게 전달.

- [ ] **Step 3: README "현재 상태" 갱신**

"diff 보기(한 줄/좌우 전환, 줄 번호)" 뒤의 나열에 커밋 상세와 가상화가 드러나도록, 해당 문장에서 "저장된 역사 타임라인"을 "저장된 역사 타임라인(브랜치·병합 배지, 커밋 클릭 상세, 스크롤로 이어서 불러오기)"로 교체하고, "stage/unstage"를 "체크박스 일괄 stage/unstage/변경 취소"로 교체하고, 문장 끝에 " 다크/라이트 테마를 전환할 수 있고, 대형 저장소를 위해 변경 목록·역사·diff는 가상 스크롤로 렌더됩니다."를 추가한다.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README — E0-3b 커밋 상세·배지·가상화 반영

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 검증 게이트 요약

| 시점 | 기대치 |
| --- | --- |
| Task 1 후 | 137 tests (133 − log 5 + log 8 + client 1) |
| Task 2 후 | +8 (parser) +5 (client show) → 150, 보완 +1 → 151 |
| Task 3 후 | +3 → 154, 보완 +2 → 156 |
| Task 3b 후 | +5 (discard) → 161 |
| Task 5 후 | E2E 5 (가상화, 기존 2개는 체크박스 흐름 전환) |
| Task 6 후 | +3 (diff-rows) → **164 tests** |
| Task 8 후 | **E2E 7** (커밋 상세·로그 더 불러오기) |
| Task 8b 후 | **E2E 8** (변경 취소) |
| Task 8c 후 | +3 (theme) → **167 tests**, **E2E 9** (테마) |
| 최종 | 167 tests + typecheck 5 + build + E2E 9 — 전부 exit 0 |

(테스트 수는 파일 재구성에 따라 ±1 오차가 있을 수 있다 — 게이트의 본질은 "전부 PASS + 신규 테스트가 실제로 존재"다. 최종 수치가 다르면 커밋 메시지가 아니라 이 표를 갱신한다.)

## 후속 노트 (1단계 이관 후보)

- 히스토리 무한 스크롤/페이지네이션 (지금은 HISTORY_LIMIT=50 — 가상화는 준비됨)
- 레인 그래프 (#7의 나머지 절반 — 사용자 결정: 1단계)
- 커밋 상세에서 두 번째 부모 기준 비교 (combined diff)
- split 뷰 워드 단위 하이라이트
