# E3b 리뷰 흐름 완결 — 코멘트 확인·답변·승인·병합 구현 계획 (스펙 §9 후반부·§5 문구 원칙)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 리뷰 팝오버의 목록 항목을 클릭하면 우측 열이 **리뷰 상세(ReviewDetailPanel)** 로 전환되어 코멘트 타임라인을 확인·답변하고, 승인(approve)·병합(merge)까지 앱 안에서 마친다. 병합 성공 후에는 "기본 공간으로 이동해 최신 받아오기"를 제안해 로컬을 따라잡게 한다(§9 후반부: "코멘트 확인·답변 → 승인 → 병합까지 앱 안에서"). 겸사겸사 E3a 후속 노트의 **PAT 입력 마스킹**을 처리한다.

**Architecture(핵심 결정 — 변경 불가):** hosting 패키지 확장은 E3a 관례 그대로 — **main 프로세스 전용·baseUrl 주입·친절 에러 매핑**. `pulls.get/comments/addComment/approve/merge` 5개 메서드를 더하고, 코멘트 병합·정렬은 **순수 함수 `buildPullTimeline`** (hosting 내 별도 모듈)로 분리해 단위 테스트한다(레이어 분리). 코멘트 타임라인 = 이슈 코멘트(GET /issues/{n}/comments) + 리뷰 요약(GET /pulls/{n}/reviews) 병합·시간순 — 라인 단위 리뷰 코멘트(/pulls/{n}/comments)는 범위 제외(후속 노트). 병합은 `merge_method: 'merge'`(병합 커밋 — 앱 철학: 조상 기록 보존). IPC는 `hosting:pull-detail`(상세+코멘트 한 번에)·`hosting:pull-comment`·`hosting:pull-approve`·`hosting:pull-merge` 4채널, 인자 검증은 기존 관례(assertPullNumber 재사용·body는 assertString+trim 빈 값 거부). UI는 CommitDetailPanel 패턴의 **우측 열 전환형** — store `pullDetail`이 열려 있으면 App 우측 열이 `pullDetail ? ReviewDetailPanel : commitDetail ? CommitDetailPanel : HistoryPanel` 3분기. **CLEAR_SELECTIONS에 pullDetail 포함**(커밋 상세와 상호 배타). 병합 성공 후 제안의 확인 경로는 **기존 `switchBranch(base)` → `pullLatest()` 재사용**(자동 보관 안전망 그대로). E2E는 E3a mock GitHub 서버를 코멘트·리뷰·병합 상태 반영으로 확장해 +3.

**Tech Stack:** 기존과 동일 (신규 외부 의존성 없음 — electron.vite.config exclude는 E3a에서 hosting이 이미 포함, 신규 패키지 없음).

**실측으로 확정한 동작 (현재 트리 91b1366):**

- 기준선: **280 tests**(`pnpm test` — E3a Task 10-보완 후 실측치, 메모리 기록 일치) + **E2E 32**(스펙 파일 `^test(` 계수 실측: smoke.spec.ts 29 + hosting.spec.ts 3).
- **기존 E2E에서 `review-pull-1`을 클릭하는 테스트는 없다**(전 저장소 grep 실측 — hosting.spec.ts:166의 `toContainText` 단언 1곳뿐). 따라서 "목록 항목 클릭=상세 열기"로 의미를 바꿔도 기존 E2E는 깨지지 않는다 — 제목 텍스트는 그대로 행 버튼 안에 남으므로 단언도 그대로 통과한다. 브라우저 열기는 별도 아이콘 버튼(`review-pull-open-{n}`)으로 분리한다.
- lucide-react 1.24.0(설치본) 아이콘 실측: `check`·`send`·`git-merge`·`message-square`·`external-link`·`arrow-left` 존재 — 승인(Check)·보내기(Send)·병합(GitMerge) 아이콘 사용 가능.
- `app__main--detail`은 CSS 규칙이 없는 마커 클래스다(레이아웃 grep 실측) — pullDetail 조건을 더해도 시각 변화 없음.
- 자기 PR 승인 시 실 GitHub 422 응답 본문에 `Can not approve your own pull request`가 포함된다(과제 명세의 실측 근거) — 이 부분 문자열로 매핑한다.
- ConfirmDialog는 닫혀 있으면 unmount된다(react-aria ModalOverlay) — App에 ConfirmDialog가 3개 공존해도 `confirm-accept`/`confirm-cancel` testid는 열린 1개에만 존재한다(기존 PromptDialog 3개 공존과 같은 관례).

**알려진 한계(의도적):**

- 라인 단위 리뷰 코멘트(diff 앵커, GET /pulls/{n}/comments)는 타임라인에서 빠진다 — 후속 노트.
- 코멘트·리뷰는 per_page=100까지 — 초과분은 잘린다(후속 노트: 페이징).
- 타임라인·상태는 상세를 열 때와 내가 쓸 때(답변·승인·병합 후 재조회)만 갱신된다 — 자동 새로고침 없음.
- 승인됨 판정은 "APPROVED 리뷰 존재" — 이후 CHANGES_REQUESTED로 뒤집혀도 승인됨으로 보일 수 있다(후속 노트).
- CLEAR_SELECTIONS 관례에 따라 저장소 내용이 바뀌는 작업(스테이지·커밋·전환 등)을 하면 리뷰 상세가 닫힌다 — 관례 일관성 우선. 단, 좌측 파일 diff 열기(selectFile)·충돌 뷰는 우측 열을 쓰지 않으므로 리뷰 상세를 유지한다(커밋 상세만 우측 열 경합으로 상호 배타).
- E2E (b)에서 병합 후 제안 다이얼로그는 **취소로 끝낸다** — 확인 경로(전환+받아오기)는 기존 smoke E2E('실험 공간을 만들고 바로 이동한다'·'원격의 새 저장을 받아온다')가 커버하고, 여기서 실행하면 mock GitHub(가짜 병합 상태)와 로컬 픽스처(원격 네트워크 없음)의 정합이 깨져 실 push/pull 실패로 오염되기 때문이다.

---

## 파일 구조

```
packages/hosting/src/pull-timeline.ts                            # PullComment·buildPullTimeline 순수 함수 (생성)
packages/hosting/src/github.ts                                   # pulls 5메서드 + PullDetail + 에러 매핑 (수정)
packages/hosting/src/index.ts                                    # 배럴 (수정)
packages/hosting/test/pull-timeline.test.ts                      # +5 (생성)
packages/hosting/test/github.test.ts                             # +11 (mock http 왕복, 라우터 mock 추가) (수정)
packages/ipc-contract/src/index.ts                               # PullDetailView·HostingApi 4메서드·채널 4 (수정)
apps/desktop/src/main/hosting-handlers.ts                        # requireHosting + 핸들러 4 (수정)
apps/desktop/src/preload/index.ts                                # pulls 브리지 4 (수정)
apps/desktop/src/renderer/src/store/repository-store.ts          # pullDetail 상태 + 액션 5 (수정)
apps/desktop/src/renderer/src/components/ReviewDetailPanel.tsx   # 리뷰 상세 패널 (생성)
apps/desktop/src/renderer/src/components/review-detail-panel.css # (생성)
apps/desktop/src/renderer/src/components/ReviewPopover.tsx       # 클릭=상세·아이콘=브라우저 분리 (수정)
apps/desktop/src/renderer/src/components/review-popover.css      # 행 flex·외부 아이콘 (수정)
apps/desktop/src/renderer/src/App.tsx                            # 우측 열 3분기 + 다이얼로그 2 (수정)
apps/desktop/src/renderer/src/ui/PromptDialog.tsx                # masked 옵션 (수정)
apps/desktop/e2e/hosting.spec.ts                                 # mock 확장 + E2E 3건 (수정)
README.md                                                        # 현재 상태 갱신 (수정)
```

---

### Task 1: hosting — buildPullTimeline 순수 함수 (코멘트 병합·정렬)

**Files:**
- Create: `packages/hosting/src/pull-timeline.ts`
- Modify: `packages/hosting/src/index.ts`
- Test: `packages/hosting/test/pull-timeline.test.ts`

`PullComment` 타입을 이 모듈에 둔다 — github.ts가 가져다 쓰므로 순환 의존이 없다.

- [ ] **Step 1: 실패하는 테스트 (Red)**

`packages/hosting/test/pull-timeline.test.ts` 생성:

```ts
import { describe, expect, it } from 'vitest'
import { buildPullTimeline } from '../src/pull-timeline'

describe('buildPullTimeline', () => {
  it('이슈 코멘트와 리뷰를 시간순(오래된 것 먼저)으로 병합한다', () => {
    const timeline = buildPullTimeline(
      [
        { id: 1, user: { login: 'octo' }, body: '질문이 있어요', created_at: '2026-07-20T10:00:00Z' },
        { id: 3, user: { login: 'octo' }, body: '확인했어요', created_at: '2026-07-20T12:00:00Z' },
      ],
      [
        {
          id: 2,
          user: { login: 'reviewer' },
          body: '전반적으로 좋아요',
          state: 'COMMENTED',
          submitted_at: '2026-07-20T11:00:00Z',
        },
      ],
    )
    expect(timeline.map((item) => item.id)).toEqual([1, 2, 3])
    expect(timeline[1]).toEqual({
      id: 2,
      author: 'reviewer',
      body: '전반적으로 좋아요',
      createdAt: 1784545200,
      kind: 'review',
      state: null,
    })
  })

  it('본문 없는 코멘트 리뷰(COMMENTED·PENDING)는 타임라인에서 뺀다', () => {
    const timeline = buildPullTimeline(
      [],
      [
        {
          id: 1,
          user: { login: 'r' },
          body: '',
          state: 'COMMENTED',
          submitted_at: '2026-07-20T10:00:00Z',
        },
        { id: 2, user: { login: 'r' }, body: null, state: 'PENDING' },
      ],
    )
    expect(timeline).toEqual([])
  })

  it('승인(APPROVED)은 본문이 없어도 남는다 — 승인됨 배지·판정의 근거', () => {
    const timeline = buildPullTimeline(
      [],
      [
        {
          id: 9,
          user: { login: 'reviewer' },
          body: '',
          state: 'APPROVED',
          submitted_at: '2026-07-20T10:00:00Z',
        },
      ],
    )
    expect(timeline).toEqual([
      { id: 9, author: 'reviewer', body: '', createdAt: 1784541600, kind: 'review', state: 'approved' },
    ])
  })

  it('작성자가 없으면(탈퇴 계정) "(알 수 없음)"으로 표시한다', () => {
    const timeline = buildPullTimeline(
      [{ id: 1, user: null, body: '남은 코멘트', created_at: '2026-07-20T10:00:00Z' }],
      [],
    )
    expect(timeline[0]!.author).toBe('(알 수 없음)')
  })

  it('시각을 해석할 수 없으면 0으로 두어 빠뜨리지 않고 맨 앞에 싣는다', () => {
    const timeline = buildPullTimeline(
      [
        { id: 1, user: { login: 'a' }, body: '정상 시각', created_at: '2026-07-20T10:00:00Z' },
        { id: 2, user: { login: 'b' }, body: '깨진 시각', created_at: 'not-a-date' },
      ],
      [],
    )
    expect(timeline.map((item) => item.id)).toEqual([2, 1])
  })
})
```

- [ ] **Step 2: 실패 확인 (Red 실증)**

Run: `npx vitest run packages/hosting/test/pull-timeline.test.ts`
Expected: FAIL — `Failed to resolve import "../src/pull-timeline"` (모듈 없음)

- [ ] **Step 3: 구현**

`packages/hosting/src/pull-timeline.ts` 생성:

```ts
/** 리뷰 요청 타임라인 항목 — 이슈 코멘트와 리뷰 요약을 하나의 시간순 목록으로 합친 것 */
export interface PullComment {
  id: number
  author: string
  body: string
  /** epoch 초 — UI 상대 시간 표기용 */
  createdAt: number
  /** comment: 이슈 코멘트 / review: 리뷰 요약(승인·코멘트 리뷰) */
  kind: 'comment' | 'review'
  /** kind='review'이고 승인(APPROVED)이면 'approved' — 그 외 null */
  state: 'approved' | null
}

/** GitHub 이슈 코멘트 응답 — 우리가 쓰는 필드만. user는 탈퇴 계정이면 null이다 */
interface RawIssueComment {
  id: number
  user: { login: string } | null
  body: string
  created_at: string
}

/** GitHub 리뷰 응답 — 우리가 쓰는 필드만. PENDING 리뷰는 submitted_at이 없다 */
interface RawReview {
  id: number
  user: { login: string } | null
  body: string | null
  state: string
  submitted_at?: string
}

function toEpochSeconds(iso: string | undefined): number {
  const ms = iso === undefined ? NaN : Date.parse(iso)
  // 해석 불가 시각은 0 — 항목을 빠뜨리는 것보다 순서가 어긋나는 쪽이 덜 위험하다
  return Number.isNaN(ms) ? 0 : Math.floor(ms / 1000)
}

/**
 * 이슈 코멘트 + 리뷰 요약을 병합해 시간순(오래된 것 먼저)으로 정렬한다 — 순수 함수(레이어 분리).
 * 리뷰는 본문 있는 항목만 싣되, 승인(APPROVED)은 본문이 없어도 싣는다 —
 * 상세의 "승인됨" 배지와 타임라인의 "승인했어요" 표시가 이 목록에서 나온다.
 * 라인 단위 리뷰 코멘트(/pulls/{n}/comments)는 이번 범위 제외(후속 노트).
 */
export function buildPullTimeline(rawComments: unknown[], rawReviews: unknown[]): PullComment[] {
  const comments: PullComment[] = rawComments.map((raw) => {
    const comment = raw as RawIssueComment
    return {
      id: comment.id,
      author: comment.user?.login ?? '(알 수 없음)',
      body: comment.body,
      createdAt: toEpochSeconds(comment.created_at),
      kind: 'comment',
      state: null,
    }
  })
  const reviews: PullComment[] = (rawReviews as RawReview[])
    .filter((review) => review.state === 'APPROVED' || (review.body ?? '') !== '')
    .map((review) => ({
      id: review.id,
      author: review.user?.login ?? '(알 수 없음)',
      body: review.body ?? '',
      createdAt: toEpochSeconds(review.submitted_at),
      kind: 'review',
      state: review.state === 'APPROVED' ? 'approved' : null,
    }))
  // 시간순 — 같은 시각이면 안정 정렬로 원래 순서(코멘트 먼저)를 유지한다
  return [...comments, ...reviews].sort((a, b) => a.createdAt - b.createdAt)
}
```

`packages/hosting/src/index.ts` 전체 교체:

```ts
export * from './remote-url'
export * from './github'
export * from './gh-token'
export * from './pull-timeline'
```

- [ ] **Step 4: Green 확인**

Run: `npx vitest run packages/hosting/test/pull-timeline.test.ts`
Expected: **5 passed**

Run: `pnpm test`
Expected: **285 tests** (280+5) 전부 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/hosting
git commit -m "feat(hosting): 리뷰 타임라인 병합·정렬 순수 함수(buildPullTimeline)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: hosting — pulls.get/comments/addComment/approve/merge + 친절 에러 매핑

**Files:**
- Modify: `packages/hosting/src/github.ts`
- Test: `packages/hosting/test/github.test.ts`

E3a의 node:http mock 왕복 패턴 그대로. `pulls.comments`는 한 호출이 두 경로(GET 이슈 코멘트 + GET 리뷰)를 왕복하므로 경로별 응답 mock(`startMockRouter`)을 추가한다.

- [ ] **Step 1: 실패하는 테스트 (Red)**

`packages/hosting/test/github.test.ts` 수정.

(a) `startMock` 함수 정의 **바로 뒤**(`const PULL_FIXTURE` 앞)에 라우터 mock 추가:

```ts
/** 경로별 응답 mock — pulls.comments처럼 한 호출이 두 경로를 왕복할 때 쓴다 */
async function startMockRouter(
  routes: Record<string, { status: number; body: unknown }>,
): Promise<{ baseUrl: string; requests: Recorded[] }> {
  const requests: Recorded[] = []
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf8')
    })
    req.on('end', () => {
      requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: raw })
      const key = `${req.method} ${(req.url ?? '/').split('?')[0]}`
      const route = routes[key] ?? { status: 404, body: { message: 'Not Found' } }
      res.writeHead(route.status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(route.body))
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { baseUrl: `http://127.0.0.1:${port}`, requests }
}
```

(b) `PULL_FIXTURE` 정의 **바로 뒤**에 상세 픽스처 추가:

```ts
const DETAIL_FIXTURE = { ...PULL_FIXTURE, state: 'open', merged: false }
```

(c) describe 블록 마지막 테스트(`'그 밖의 실패는 상태 코드를 남긴다'`) **뒤**에 신규 11건 추가:

```ts
  it('pulls.get — 상세를 매핑한다 (열림)', async () => {
    const mock = await startMock(200, DETAIL_FIXTURE)
    const hosting = createGitHubHosting({ baseUrl: mock.baseUrl, token: 't' })
    expect(await hosting.pulls.get('octo', 'hello', 7)).toEqual({
      number: 7,
      title: '로그인 버튼 색 실험',
      state: 'open',
      merged: false,
      url: 'https://github.com/octo/hello/pull/7',
      headBranch: 'feature',
      baseBranch: 'main',
    })
    expect(mock.requests[0]!.method).toBe('GET')
    expect(mock.requests[0]!.url).toBe('/repos/octo/hello/pulls/7')
  })

  it('pulls.get — 병합된 리뷰 요청은 state closed·merged true다', async () => {
    const mock = await startMock(200, { ...DETAIL_FIXTURE, state: 'closed', merged: true })
    const hosting = createGitHubHosting({ baseUrl: mock.baseUrl, token: 't' })
    const detail = await hosting.pulls.get('octo', 'hello', 7)
    expect(detail.state).toBe('closed')
    expect(detail.merged).toBe(true)
  })

  it('pulls.get 404 — 리뷰 요청을 찾지 못했다는 문구로 매핑한다 (저장소 404 문구가 아니다)', async () => {
    const mock = await startMock(404, { message: 'Not Found' })
    const hosting = createGitHubHosting({ baseUrl: mock.baseUrl, token: 't' })
    await expect(hosting.pulls.get('octo', 'hello', 7)).rejects.toThrow(
      '리뷰 요청을 찾지 못했어요. 목록을 새로 열어 주세요.',
    )
  })

  it('pulls.comments — 이슈 코멘트·리뷰 두 경로를 왕복해 시간순으로 병합한다', async () => {
    const mock = await startMockRouter({
      'GET /repos/octo/hello/issues/7/comments': {
        status: 200,
        body: [
          {
            id: 1,
            user: { login: 'octo' },
            body: '먼저 남긴 질문',
            created_at: '2026-07-20T10:00:00Z',
          },
        ],
      },
      'GET /repos/octo/hello/pulls/7/reviews': {
        status: 200,
        body: [
          {
            id: 2,
            user: { login: 'reviewer' },
            body: '',
            state: 'APPROVED',
            submitted_at: '2026-07-20T11:00:00Z',
          },
        ],
      },
    })
    const hosting = createGitHubHosting({ baseUrl: mock.baseUrl, token: 't' })
    expect(await hosting.pulls.comments('octo', 'hello', 7)).toEqual([
      { id: 1, author: 'octo', body: '먼저 남긴 질문', createdAt: 1784541600, kind: 'comment', state: null },
      { id: 2, author: 'reviewer', body: '', createdAt: 1784545200, kind: 'review', state: 'approved' },
    ])
    const urls = mock.requests.map((request) => request.url).sort()
    expect(urls).toEqual([
      '/repos/octo/hello/issues/7/comments?per_page=100',
      '/repos/octo/hello/pulls/7/reviews?per_page=100',
    ])
  })

  it('pulls.comments 404 — 리뷰 요청을 찾지 못했다는 문구로 매핑한다', async () => {
    const mock = await startMock(404, { message: 'Not Found' })
    const hosting = createGitHubHosting({ baseUrl: mock.baseUrl, token: 't' })
    await expect(hosting.pulls.comments('octo', 'hello', 7)).rejects.toThrow(
      '리뷰 요청을 찾지 못했어요. 목록을 새로 열어 주세요.',
    )
  })

  it('pulls.addComment — POST /issues/{n}/comments에 본문을 싣는다', async () => {
    const mock = await startMock(201, { id: 10 })
    const hosting = createGitHubHosting({ baseUrl: mock.baseUrl, token: 't' })
    await hosting.pulls.addComment('octo', 'hello', 7, '확인했어요. 감사합니다!')
    const request = mock.requests[0]!
    expect(request.method).toBe('POST')
    expect(request.url).toBe('/repos/octo/hello/issues/7/comments')
    expect(JSON.parse(request.body)).toEqual({ body: '확인했어요. 감사합니다!' })
  })

  it('pulls.approve — POST /pulls/{n}/reviews에 event APPROVE를 싣는다', async () => {
    const mock = await startMock(200, { id: 11, state: 'APPROVED' })
    const hosting = createGitHubHosting({ baseUrl: mock.baseUrl, token: 't' })
    await hosting.pulls.approve('octo', 'hello', 7)
    const request = mock.requests[0]!
    expect(request.method).toBe('POST')
    expect(request.url).toBe('/repos/octo/hello/pulls/7/reviews')
    expect(JSON.parse(request.body)).toEqual({ event: 'APPROVE' })
  })

  it('pulls.approve 422 자기 승인 — 스스로 승인할 수 없다는 문구로 매핑한다', async () => {
    // 실 GitHub 응답 본문 — errors[]에 이 문자열이 담긴다
    const mock = await startMock(422, {
      message: 'Unprocessable Entity',
      errors: ['Can not approve your own pull request'],
    })
    const hosting = createGitHubHosting({ baseUrl: mock.baseUrl, token: 't' })
    await expect(hosting.pulls.approve('octo', 'hello', 7)).rejects.toThrow(
      '내가 만든 리뷰 요청은 스스로 승인할 수 없어요. 다른 사람의 승인을 기다려 주세요.',
    )
  })

  it('pulls.merge — PUT /pulls/{n}/merge에 merge_method merge를 싣는다 (병합 커밋)', async () => {
    const mock = await startMock(200, { merged: true, message: 'Pull Request successfully merged' })
    const hosting = createGitHubHosting({ baseUrl: mock.baseUrl, token: 't' })
    await hosting.pulls.merge('octo', 'hello', 7)
    const request = mock.requests[0]!
    expect(request.method).toBe('PUT')
    expect(request.url).toBe('/repos/octo/hello/pulls/7/merge')
    expect(JSON.parse(request.body)).toEqual({ merge_method: 'merge' })
  })

  it('pulls.merge 405 — 아직 병합할 수 없다는 문구로 매핑한다 (충돌·검사 진행)', async () => {
    const mock = await startMock(405, { message: 'Pull Request is not mergeable' })
    const hosting = createGitHubHosting({ baseUrl: mock.baseUrl, token: 't' })
    await expect(hosting.pulls.merge('octo', 'hello', 7)).rejects.toThrow(
      '아직 병합할 수 없어요. 겹침(충돌)이나 진행 중인 검사가 있는지 브라우저에서 확인해 주세요.',
    )
  })

  it('pulls.merge 409 — 리뷰 요청이 방금 바뀌었다는 문구로 매핑한다 (head 경합)', async () => {
    const mock = await startMock(409, { message: 'Head branch was modified' })
    const hosting = createGitHubHosting({ baseUrl: mock.baseUrl, token: 't' })
    await expect(hosting.pulls.merge('octo', 'hello', 7)).rejects.toThrow(
      '리뷰 요청이 방금 바뀌었어요. 다시 열어 확인해 주세요.',
    )
  })
```

- [ ] **Step 2: 실패 확인 (Red 실증)**

Run: `npx vitest run packages/hosting/test/github.test.ts`
Expected: 기존 9건 PASS, **신규 11건 FAIL** — `hosting.pulls.get is not a function` 계열 (메서드 부재)

- [ ] **Step 3: 구현 — github.ts**

(a) 파일 맨 위에 import 추가 — 기존:

```ts
/** 리뷰 요청(pull request) 요약 — UI 목록과 생성 결과가 공유한다 */
export interface PullSummary {
```

교체:

```ts
import { buildPullTimeline, type PullComment } from './pull-timeline'

/** 리뷰 요청(pull request) 요약 — UI 목록과 생성 결과가 공유한다 */
export interface PullSummary {
```

(b) `CreatePullInput` 뒤에 상세 타입 추가 — 기존:

```ts
export interface CreatePullInput {
  title: string
  head: string
  base: string
  body: string
}
```

교체:

```ts
export interface CreatePullInput {
  title: string
  head: string
  base: string
  body: string
}

/** 리뷰 요청 상세 — 상태 배지(열림/승인됨/병합됨)와 병합 후 안내가 쓴다 */
export interface PullDetail {
  number: number
  title: string
  state: 'open' | 'closed'
  merged: boolean
  url: string
  headBranch: string
  baseBranch: string
}
```

(c) `GitHubHosting`의 pulls 인터페이스 교체 — 기존:

```ts
  pulls: {
    /** 열린 리뷰 요청 목록 — GET /repos/{owner}/{repo}/pulls?state=open */
    list(owner: string, repo: string): Promise<PullSummary[]>
    /** 리뷰 요청 생성 — 이미 있으면 GitHub 422를 친절 문구로 매핑해 던진다 */
    create(owner: string, repo: string, input: CreatePullInput): Promise<PullSummary>
  }
```

교체:

```ts
  pulls: {
    /** 열린 리뷰 요청 목록 — GET /repos/{owner}/{repo}/pulls?state=open */
    list(owner: string, repo: string): Promise<PullSummary[]>
    /** 리뷰 요청 생성 — 이미 있으면 GitHub 422를 친절 문구로 매핑해 던진다 */
    create(owner: string, repo: string, input: CreatePullInput): Promise<PullSummary>
    /** 상세 — GET /pulls/{n}. 밖에서 닫힘·삭제된 404는 친절 문구로 매핑한다 */
    get(owner: string, repo: string, number: number): Promise<PullDetail>
    /** 코멘트 타임라인 — 이슈 코멘트 + 리뷰 요약 병합·시간순(buildPullTimeline) */
    comments(owner: string, repo: string, number: number): Promise<PullComment[]>
    /** 답변 달기 — POST /issues/{n}/comments (빈 본문 거부는 IPC 책임) */
    addComment(owner: string, repo: string, number: number, body: string): Promise<void>
    /** 승인 — POST /pulls/{n}/reviews { event: APPROVE }. 자기 PR 422는 친절 문구로 */
    approve(owner: string, repo: string, number: number): Promise<void>
    /** 병합(병합 커밋 — 조상 기록 보존) — PUT /pulls/{n}/merge. 405·409는 친절 문구로 */
    merge(owner: string, repo: string, number: number): Promise<void>
  }
```

(d) `request` 함수 교체 — PUT 메서드와 상태별 문구 재정의를 더한다. 기존:

```ts
  async function request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    let response: Response
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'git-gui',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      // DNS 실패·연결 거부 등 상태 코드가 없는 실패는 전부 네트워크 문제다
      throw new Error('인터넷 연결을 확인해 주세요.')
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(toFriendlyMessage(response.status, text))
    }
    return response.json()
  }
```

교체:

```ts
  async function request(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: unknown,
    // 호출 맥락이 더 정확한 문구를 아는 상태 코드만 재정의한다(null이면 기본 매핑으로 폴백)
    mapError?: (status: number, text: string) => string | null,
  ): Promise<unknown> {
    let response: Response
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'git-gui',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      // DNS 실패·연결 거부 등 상태 코드가 없는 실패는 전부 네트워크 문제다
      throw new Error('인터넷 연결을 확인해 주세요.')
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(mapError?.(response.status, text) ?? toFriendlyMessage(response.status, text))
    }
    return response.json()
  }
```

(e) `toPullSummary` 함수 뒤에 상세 매핑 추가 — 기존:

```ts
function toPullSummary(raw: unknown): PullSummary {
  const pull = raw as RawPull
  return {
    number: pull.number,
    title: pull.title,
    headBranch: pull.head.ref,
    baseBranch: pull.base.ref,
    url: pull.html_url,
    isDraft: pull.draft === true,
  }
}
```

교체:

```ts
function toPullSummary(raw: unknown): PullSummary {
  const pull = raw as RawPull
  return {
    number: pull.number,
    title: pull.title,
    headBranch: pull.head.ref,
    baseBranch: pull.base.ref,
    url: pull.html_url,
    isDraft: pull.draft === true,
  }
}

/** GitHub REST 응답의 pull 상세 — 우리가 쓰는 필드만 */
interface RawPullDetail extends RawPull {
  state: string
  merged?: boolean
}

function toPullDetail(raw: unknown): PullDetail {
  const pull = raw as RawPullDetail
  return {
    number: pull.number,
    title: pull.title,
    state: pull.state === 'closed' ? 'closed' : 'open',
    merged: pull.merged === true,
    url: pull.html_url,
    headBranch: pull.head.ref,
    baseBranch: pull.base.ref,
  }
}
```

(f) `repoPath` 헬퍼 뒤에 404 재정의 헬퍼 추가 — 기존:

```ts
  // 저장소 좌표는 remote URL에서 왔다 — URL 경로로 밀수되지 않게 세그먼트 단위로 인코딩한다
  const repoPath = (owner: string, repo: string): string =>
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
```

교체:

```ts
  // 저장소 좌표는 remote URL에서 왔다 — URL 경로로 밀수되지 않게 세그먼트 단위로 인코딩한다
  const repoPath = (owner: string, repo: string): string =>
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`

  // PR 단위 경로의 404는 "저장소 없음"이 아니라 "리뷰 요청 없음"이다(밖에서 닫힘·삭제)
  const pullNotFound = (status: number): string | null =>
    status === 404 ? '리뷰 요청을 찾지 못했어요. 목록을 새로 열어 주세요.' : null
```

(g) 반환 객체의 pulls 구현 교체 — 기존:

```ts
    pulls: {
      async list(owner, repo) {
        const raw = (await request(
          'GET',
          `${repoPath(owner, repo)}/pulls?state=open&per_page=50`,
        )) as unknown[]
        return raw.map(toPullSummary)
      },
      async create(owner, repo, input) {
        return toPullSummary(await request('POST', `${repoPath(owner, repo)}/pulls`, input))
      },
    },
```

교체:

```ts
    pulls: {
      async list(owner, repo) {
        const raw = (await request(
          'GET',
          `${repoPath(owner, repo)}/pulls?state=open&per_page=50`,
        )) as unknown[]
        return raw.map(toPullSummary)
      },
      async create(owner, repo, input) {
        return toPullSummary(await request('POST', `${repoPath(owner, repo)}/pulls`, input))
      },
      async get(owner, repo, number) {
        return toPullDetail(
          await request('GET', `${repoPath(owner, repo)}/pulls/${number}`, undefined, pullNotFound),
        )
      },
      async comments(owner, repo, number) {
        const [issueComments, reviews] = await Promise.all([
          request(
            'GET',
            `${repoPath(owner, repo)}/issues/${number}/comments?per_page=100`,
            undefined,
            pullNotFound,
          ),
          request(
            'GET',
            `${repoPath(owner, repo)}/pulls/${number}/reviews?per_page=100`,
            undefined,
            pullNotFound,
          ),
        ])
        return buildPullTimeline(issueComments as unknown[], reviews as unknown[])
      },
      async addComment(owner, repo, number, body) {
        await request(
          'POST',
          `${repoPath(owner, repo)}/issues/${number}/comments`,
          { body },
          pullNotFound,
        )
      },
      async approve(owner, repo, number) {
        await request(
          'POST',
          `${repoPath(owner, repo)}/pulls/${number}/reviews`,
          { event: 'APPROVE' },
          (status, text) => {
            // 실 GitHub 422 본문의 errors[]에 이 문자열이 담긴다 — 부분 문자열로 매핑
            if (status === 422 && text.includes('Can not approve your own pull request')) {
              return '내가 만든 리뷰 요청은 스스로 승인할 수 없어요. 다른 사람의 승인을 기다려 주세요.'
            }
            return pullNotFound(status)
          },
        )
      },
      async merge(owner, repo, number) {
        // 병합 커밋(merge commit) 고정 — 앱 철학: 조상 기록을 남긴다(squash·rebase 비목표)
        await request(
          'PUT',
          `${repoPath(owner, repo)}/pulls/${number}/merge`,
          { merge_method: 'merge' },
          (status) => {
            if (status === 405) {
              return '아직 병합할 수 없어요. 겹침(충돌)이나 진행 중인 검사가 있는지 브라우저에서 확인해 주세요.'
            }
            if (status === 409) return '리뷰 요청이 방금 바뀌었어요. 다시 열어 확인해 주세요.'
            return pullNotFound(status)
          },
        )
      },
    },
```

- [ ] **Step 4: Green + 게이트**

Run: `npx vitest run packages/hosting/test/github.test.ts`
Expected: **20 passed** (기존 9 + 신규 11)

Run: `pnpm test && pnpm typecheck`
Expected: **296 tests** (285+11) 전부 PASS + typecheck 전부 Done(6 프로젝트)

- [ ] **Step 5: Commit**

```bash
git add packages/hosting
git commit -m "feat(hosting): PR 상세·코멘트·답변·승인·병합 5메서드 + 친절 에러 매핑

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---
### Task 3: IPC — 계약(PullDetailView·채널 4) + main 핸들러 4 + preload

**Files:**
- Modify: `packages/ipc-contract/src/index.ts`
- Modify: `apps/desktop/src/main/hosting-handlers.ts`
- Modify: `apps/desktop/src/preload/index.ts`

main 핸들러는 Electron 의존이라 단위 테스트 부재(E3a 관례) — typecheck·build 게이트 후 Task 7 E2E가 실동작을 커버한다. `env.d.ts`는 HostingApi 타입 참조라 수정 불요.

- [ ] **Step 1: ipc-contract**

(a) 재노출 타입 확장 — 기존:

```ts
export type { DiffOptions } from '@git-gui/domain'
export type { PullSummary } from '@git-gui/hosting'

import type { PullSummary } from '@git-gui/hosting'
```

교체:

```ts
export type { DiffOptions } from '@git-gui/domain'
export type { PullComment, PullDetail, PullSummary } from '@git-gui/hosting'

import type { PullComment, PullDetail, PullSummary } from '@git-gui/hosting'
```

(b) `HostingStatus` 인터페이스 뒤(HostingApi 주석 앞)에 추가 — 기존:

```ts
/**
 * 호스팅(리뷰 요청) API 표면 — 네트워크·토큰은 전부 main 프로세스에서만 다룬다.
 * repoPath 신뢰 규칙은 GitApi와 동일(main의 allowlist).
 */
export interface HostingApi {
```

교체:

```ts
/** 리뷰 상세 화면 데이터 — 상세와 코멘트 타임라인을 한 번에(IPC 왕복 1회) */
export interface PullDetailView {
  detail: PullDetail
  comments: PullComment[]
}

/**
 * 호스팅(리뷰 요청) API 표면 — 네트워크·토큰은 전부 main 프로세스에서만 다룬다.
 * repoPath 신뢰 규칙은 GitApi와 동일(main의 allowlist).
 */
export interface HostingApi {
```

(c) `HostingApi.pulls` 확장 — 기존:

```ts
  pulls: {
    /** 열린 리뷰 요청 목록 */
    list(repoPath: string): Promise<PullSummary[]>
    /** 리뷰 요청 생성 — main이 브랜치·기본 공간을 검사하고 upstream 없으면 백업(push) 후 생성한다 */
    create(repoPath: string, input: { title: string; body: string }): Promise<PullSummary>
    /** 리뷰 요청을 브라우저로 연다 — URL은 main이 보관한 목록에서만 찾는다(임의 URL 열기 금지) */
    open(repoPath: string, number: number): Promise<void>
  }
```

교체:

```ts
  pulls: {
    /** 열린 리뷰 요청 목록 */
    list(repoPath: string): Promise<PullSummary[]>
    /** 리뷰 요청 생성 — main이 브랜치·기본 공간을 검사하고 upstream 없으면 백업(push) 후 생성한다 */
    create(repoPath: string, input: { title: string; body: string }): Promise<PullSummary>
    /** 리뷰 요청을 브라우저로 연다 — URL은 main이 보관한 목록에서만 찾는다(임의 URL 열기 금지) */
    open(repoPath: string, number: number): Promise<void>
    /** 상세 + 코멘트 타임라인 한 번에 — 밖에서 닫힌 404는 친절 문구로 온다 */
    detail(repoPath: string, number: number): Promise<PullDetailView>
    /** 답변 달기 — 빈 본문은 main에서 거부된다 */
    comment(repoPath: string, number: number, body: string): Promise<void>
    /** 승인 — 자기 PR이면 친절 문구로 거부된다 */
    approve(repoPath: string, number: number): Promise<void>
    /** 병합(병합 커밋) — 로컬 동기화는 별도(기존 전환·받아오기 흐름을 UI가 제안) */
    merge(repoPath: string, number: number): Promise<void>
  }
```

(d) 채널 추가 — 기존:

```ts
export const HOSTING_CHANNELS = {
  status: 'hosting:status',
  connectGh: 'hosting:connect-gh',
  connectToken: 'hosting:connect-token',
  disconnect: 'hosting:disconnect',
  pullsList: 'hosting:pulls-list',
  pullCreate: 'hosting:pull-create',
  pullOpen: 'hosting:pull-open',
} as const
```

교체:

```ts
export const HOSTING_CHANNELS = {
  status: 'hosting:status',
  connectGh: 'hosting:connect-gh',
  connectToken: 'hosting:connect-token',
  disconnect: 'hosting:disconnect',
  pullsList: 'hosting:pulls-list',
  pullCreate: 'hosting:pull-create',
  pullOpen: 'hosting:pull-open',
  pullDetail: 'hosting:pull-detail',
  pullComment: 'hosting:pull-comment',
  pullApprove: 'hosting:pull-approve',
  pullMerge: 'hosting:pull-merge',
} as const
```

- [ ] **Step 2: hosting-handlers**

(a) `assertPullNumber` 함수 뒤에 공용 헬퍼 추가 — 기존:

```ts
function assertPullNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error('잘못된 요청 형식이에요.')
  }
  return value
}
```

교체:

```ts
function assertPullNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error('잘못된 요청 형식이에요.')
  }
  return value
}

/** 연결·GitHub origin 확인을 통과한 API 좌표 — E3b 상세·답변·승인·병합 핸들러가 공유한다.
    (기존 pullsList·pullCreate는 E3a 검증 코드 그대로 둔다 — 회귀 면적 최소화) */
async function requireHosting(
  repoPath: string,
): Promise<{ api: GitHubHosting; owner: string; repo: string }> {
  const token = currentToken()
  if (token === null) throw new Error('GitHub와 연결한 뒤 이용할 수 있어요.')
  const ref = await gitHubRepoRef(repoPath)
  if (ref === null) throw new Error('이 저장소의 원격(origin)은 GitHub가 아니에요.')
  return { api: hosting(token), owner: ref.owner, repo: ref.repo }
}
```

(b) `registerHostingHandlers` 마지막 핸들러 뒤에 4개 추가 — 기존:

```ts
  ipcMain.handle(HOSTING_CHANNELS.pullOpen, async (_event, repoPath: unknown, number: unknown) => {
    const path = assertAllowedRepo(repoPath)
    const url = knownPullUrls.get(pullUrlKey(path, assertPullNumber(number)))
    // main이 목록·생성에서 보관한 주소만 연다 — renderer가 만든 임의 URL은 여기 없다 (https 재확인은 심층 방어)
    if (url === undefined || !url.startsWith('https://')) {
      throw new Error('리뷰 요청 주소를 찾지 못했어요. 리뷰 목록을 다시 열어 주세요.')
    }
    await shell.openExternal(url)
  })
}
```

교체:

```ts
  ipcMain.handle(HOSTING_CHANNELS.pullOpen, async (_event, repoPath: unknown, number: unknown) => {
    const path = assertAllowedRepo(repoPath)
    const url = knownPullUrls.get(pullUrlKey(path, assertPullNumber(number)))
    // main이 목록·생성에서 보관한 주소만 연다 — renderer가 만든 임의 URL은 여기 없다 (https 재확인은 심층 방어)
    if (url === undefined || !url.startsWith('https://')) {
      throw new Error('리뷰 요청 주소를 찾지 못했어요. 리뷰 목록을 다시 열어 주세요.')
    }
    await shell.openExternal(url)
  })

  ipcMain.handle(
    HOSTING_CHANNELS.pullDetail,
    async (_event, repoPath: unknown, number: unknown) => {
      const path = assertAllowedRepo(repoPath)
      const pullNumber = assertPullNumber(number)
      const { api, owner, repo } = await requireHosting(path)
      const [detail, comments] = await Promise.all([
        api.pulls.get(owner, repo, pullNumber),
        api.pulls.comments(owner, repo, pullNumber),
      ])
      // 상세로 확인한 주소도 보관한다 — 목록 갱신 없이도 "브라우저에서 열기"가 동작하게
      knownPullUrls.set(pullUrlKey(path, detail.number), detail.url)
      return { detail, comments }
    },
  )

  ipcMain.handle(
    HOSTING_CHANNELS.pullComment,
    async (_event, repoPath: unknown, number: unknown, body: unknown) => {
      const path = assertAllowedRepo(repoPath)
      const pullNumber = assertPullNumber(number)
      const text = assertString(body).trim()
      if (text === '') throw new Error('답변 내용을 입력해 주세요.')
      const { api, owner, repo } = await requireHosting(path)
      await api.pulls.addComment(owner, repo, pullNumber, text)
    },
  )

  ipcMain.handle(
    HOSTING_CHANNELS.pullApprove,
    async (_event, repoPath: unknown, number: unknown) => {
      const path = assertAllowedRepo(repoPath)
      const pullNumber = assertPullNumber(number)
      const { api, owner, repo } = await requireHosting(path)
      await api.pulls.approve(owner, repo, pullNumber)
    },
  )

  ipcMain.handle(
    HOSTING_CHANNELS.pullMerge,
    async (_event, repoPath: unknown, number: unknown) => {
      const path = assertAllowedRepo(repoPath)
      const pullNumber = assertPullNumber(number)
      const { api, owner, repo } = await requireHosting(path)
      await api.pulls.merge(owner, repo, pullNumber)
    },
  )
}
```

- [ ] **Step 3: preload**

`apps/desktop/src/preload/index.ts`의 hostingApi.pulls 교체 — 기존:

```ts
  pulls: {
    list: (repoPath) => ipcRenderer.invoke(HOSTING_CHANNELS.pullsList, repoPath),
    create: (repoPath, input) => ipcRenderer.invoke(HOSTING_CHANNELS.pullCreate, repoPath, input),
    open: (repoPath, number) => ipcRenderer.invoke(HOSTING_CHANNELS.pullOpen, repoPath, number),
  },
```

교체:

```ts
  pulls: {
    list: (repoPath) => ipcRenderer.invoke(HOSTING_CHANNELS.pullsList, repoPath),
    create: (repoPath, input) => ipcRenderer.invoke(HOSTING_CHANNELS.pullCreate, repoPath, input),
    open: (repoPath, number) => ipcRenderer.invoke(HOSTING_CHANNELS.pullOpen, repoPath, number),
    detail: (repoPath, number) => ipcRenderer.invoke(HOSTING_CHANNELS.pullDetail, repoPath, number),
    comment: (repoPath, number, body) =>
      ipcRenderer.invoke(HOSTING_CHANNELS.pullComment, repoPath, number, body),
    approve: (repoPath, number) =>
      ipcRenderer.invoke(HOSTING_CHANNELS.pullApprove, repoPath, number),
    merge: (repoPath, number) => ipcRenderer.invoke(HOSTING_CHANNELS.pullMerge, repoPath, number),
  },
```

- [ ] **Step 4: 게이트**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build`
Expected: **296 tests** + typecheck 전부 Done(6 프로젝트) + build 성공

- [ ] **Step 5: Commit**

```bash
git add packages/ipc-contract apps/desktop/src/main apps/desktop/src/preload
git commit -m "feat(desktop): E3b IPC — pull-detail·comment·approve·merge 채널 4개

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: store — pullDetail 상태 + 액션 5개 (guard 직렬화)

**Files:**
- Modify: `apps/desktop/src/renderer/src/store/repository-store.ts`

- [ ] **Step 1: import·상태 필드**

(a) 기존:

```ts
import type { HostingStatus, PullSummary } from '@git-gui/ipc-contract'
```

교체:

```ts
import type { HostingStatus, PullDetailView, PullSummary } from '@git-gui/ipc-contract'
```

(b) 상태 필드 — 기존:

```ts
  /** 열린 리뷰 요청 — null이면 마지막 조회 실패(빈 목록으로 위장하지 않는다 — 품질 리뷰) */
  pulls: PullSummary[] | null
```

교체:

```ts
  /** 열린 리뷰 요청 — null이면 마지막 조회 실패(빈 목록으로 위장하지 않는다 — 품질 리뷰) */
  pulls: PullSummary[] | null
  /** 리뷰 상세(상세+코멘트) — 열려 있으면 우측 열이 리뷰 상세로 전환된다. 커밋 상세와 상호 배타 */
  pullDetail: PullDetailView | null
```

(c) 액션 선언 — 기존:

```ts
  /** 리뷰 요청을 브라우저로 연다 — 주소는 main이 보관한 목록에서만 */
  openPull(number: number): Promise<void>
}
```

교체:

```ts
  /** 리뷰 요청을 브라우저로 연다 — 주소는 main이 보관한 목록에서만 */
  openPull(number: number): Promise<void>
  /** 리뷰 상세 열기(상세+코멘트 한 번에) — 우측 열이 리뷰 상세로 전환된다. 커밋 상세와 상호 배타 */
  openPullDetail(number: number): Promise<void>
  /** 리뷰 상세 닫기 — 동기 상태 변경이라 guard 불필요 */
  closePullDetail(): void
  /** 답변 달기 — 성공 여부 반환(성공 시에만 입력을 비운다). 성공 후 타임라인을 서버 상태로 재조회 */
  addPullComment(body: string): Promise<boolean>
  /** 승인 — 자기 PR이면 main이 친절 문구로 거부한다. 성공 후 상세 재조회(승인됨 배지 갱신) */
  approvePull(): Promise<void>
  /** 병합(병합 커밋) — 성공 여부 반환(App이 기본 공간 이동 제안을 연다). 성공 후 상세 재조회 */
  mergePull(): Promise<boolean>
}
```

- [ ] **Step 2: CLEAR_SELECTIONS·초기값·상호 배타**

(a) 기존:

```ts
const CLEAR_SELECTIONS = {
  selected: null,
  diff: null,
  commitDetail: null,
  commitFile: null,
  conflictFile: null,
} as const
```

교체:

```ts
const CLEAR_SELECTIONS = {
  selected: null,
  diff: null,
  commitDetail: null,
  commitFile: null,
  conflictFile: null,
  pullDetail: null,
} as const
```

(b) 초기값 — 기존:

```ts
  hostingStatus: null,
  pulls: [],
```

교체:

```ts
  hostingStatus: null,
  pulls: [],
  pullDetail: null,
```

(c) `selectCommit`의 set 교체 — 우측 열 경합(커밋 상세 ↔ 리뷰 상세) 해소. 기존:

```ts
      const commitDetail = await git().commits.show(repoPath, hash)
      set({ commitDetail, commitFile: null, conflictFile: null, selected: null, diff: null })
```

교체:

```ts
      const commitDetail = await git().commits.show(repoPath, hash)
      // 우측 열은 하나 — 리뷰 상세가 열려 있었다면 닫고 커밋 상세로 전환한다 (상호 배타)
      set({
        commitDetail,
        commitFile: null,
        conflictFile: null,
        selected: null,
        diff: null,
        pullDetail: null,
      })
```

(selectFile·selectConflict는 중앙 패널만 쓰므로 pullDetail을 건드리지 않는다 — 리뷰를 읽으며 파일을 확인하는 흐름을 유지한다. openRepository·refresh·전환·커밋 등은 CLEAR_SELECTIONS 경유로 자동으로 닫힌다.)

- [ ] **Step 3: 액션 구현 5개**

파일 끝 — 기존:

```ts
  async openPull(number) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      await hosting().pulls.open(repoPath, number)
    })
  },
}))
```

교체:

```ts
  async openPull(number) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      await hosting().pulls.open(repoPath, number)
    })
  },

  async openPullDetail(number) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      const pullDetail = await hosting().pulls.detail(repoPath, number)
      // 우측 열은 하나다 — 커밋 상세·diff·충돌 뷰를 정리하고 리뷰 상세로 전환한다
      set({ ...CLEAR_SELECTIONS, pullDetail })
    })
  },

  closePullDetail() {
    set({ pullDetail: null })
  },

  async addPullComment(body) {
    const { repoPath, pullDetail } = get()
    if (!repoPath || pullDetail === null) return false
    return guard(set, get, async () => {
      const number = pullDetail.detail.number
      await hosting().pulls.comment(repoPath, number, body)
      // 내 답변만 붙이지 않고 서버 상태로 다시 읽는다 — 그 사이 달린 다른 코멘트도 함께 온다
      set({ pullDetail: await hosting().pulls.detail(repoPath, number) })
    })
  },

  async approvePull() {
    const { repoPath, pullDetail } = get()
    if (!repoPath || pullDetail === null) return
    await guard(set, get, async () => {
      const number = pullDetail.detail.number
      await hosting().pulls.approve(repoPath, number)
      set({
        pullDetail: await hosting().pulls.detail(repoPath, number),
        notice: `리뷰 요청 #${number}을 승인했어요.`,
      })
    })
  },

  async mergePull() {
    const { repoPath, pullDetail } = get()
    if (!repoPath || pullDetail === null) return false
    return guard(set, get, async () => {
      const number = pullDetail.detail.number
      const base = pullDetail.detail.baseBranch
      await hosting().pulls.merge(repoPath, number)
      // 상세를 다시 읽어 '병합됨' 배지로 갱신한다. 로컬 반영은 App의 후속 제안(전환+받아오기)이 담당
      set({
        pullDetail: await hosting().pulls.detail(repoPath, number),
        notice: `리뷰 요청 #${number}을 "${base}"에 병합했어요. 로컬은 아직 그대로예요 — 기본 공간에서 받아오기(pull)를 하면 반영돼요.`,
      })
    })
  },
}))
```

- [ ] **Step 4: 게이트**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build`
Expected: **296 tests** + typecheck 전부 Done(6 프로젝트) + build 성공

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/store
git commit -m "feat(desktop): store — pullDetail 상태·리뷰 상세 액션 5개(guard 직렬화)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---
### Task 5: UI — ReviewDetailPanel + ReviewPopover 클릭 분리 + App 배선

**Files:**
- Create: `apps/desktop/src/renderer/src/components/ReviewDetailPanel.tsx`, `apps/desktop/src/renderer/src/components/review-detail-panel.css`
- Modify: `apps/desktop/src/renderer/src/components/ReviewPopover.tsx`, `apps/desktop/src/renderer/src/components/review-popover.css`, `apps/desktop/src/renderer/src/App.tsx`

프레젠테이션 컴포넌트는 단위 테스트 부재(기존 관례 — 로직은 store·hosting에 있고 컴포넌트는 표시만) — Task 7 E2E가 커버.

- [ ] **Step 1: ReviewDetailPanel 컴포넌트**

`apps/desktop/src/renderer/src/components/ReviewDetailPanel.tsx` 생성:

```tsx
import { ArrowLeft, Check, ExternalLink, GitMerge, Send } from 'lucide-react'
import { useState } from 'react'
import type { PullComment, PullDetailView } from '@git-gui/ipc-contract'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import { formatRelativeTime } from './relative-time'
import './review-detail-panel.css'

interface ReviewDetailPanelProps {
  view: PullDetailView
  busy: boolean
  /** 브라우저에서 열기 — 주소는 main이 보관한 목록에서만 찾는다(기존 pull-open) */
  onOpenBrowser(): void
  onBack(): void
  /** 답변 달기 — 성공 여부 반환(성공 시에만 입력을 비운다) */
  onComment(body: string): Promise<boolean>
  onApprove(): void
  /** 병합 — 확인창은 App이 관리한다(실제 병합은 확인 후) */
  onMerge(): void
}

/** 상태 배지 — 병합됨 > 닫힘 > 승인됨 > 열림 순으로 판정한다(§5 일상어+원어 병기) */
function statusOf(view: PullDetailView): { label: string; raw: string } {
  if (view.detail.merged) return { label: '병합됨', raw: 'merged' }
  if (view.detail.state === 'closed') return { label: '닫힘', raw: 'closed' }
  if (view.comments.some((comment) => comment.state === 'approved')) {
    return { label: '승인됨', raw: 'approved' }
  }
  return { label: '열림', raw: 'open' }
}

function CommentRow({ comment }: { comment: PullComment }) {
  return (
    <li className="review-detail__comment" data-testid={`review-comment-${comment.kind}-${comment.id}`}>
      <p className="review-detail__comment-meta">
        <strong>@{comment.author}</strong>
        <span>{formatRelativeTime(comment.createdAt, Date.now())}</span>
        {comment.state === 'approved' && <Badge>승인했어요</Badge>}
      </p>
      {comment.body !== '' && <p className="review-detail__comment-body">{comment.body}</p>}
    </li>
  )
}

/**
 * 리뷰 상세 (스펙 §9 후반부 E3b) — 우측 열 전환형(CommitDetailPanel 패턴):
 * 상단 제목·상태 배지, 중단 코멘트 타임라인(스크롤 — 가상화 불필요, per_page=100 상한),
 * 하단 답변 입력 + [승인하기]·[병합하기]. 네트워크·판정은 전부 store/main 몫이고 여기는 표시만.
 */
export function ReviewDetailPanel({
  view,
  busy,
  onOpenBrowser,
  onBack,
  onComment,
  onApprove,
  onMerge,
}: ReviewDetailPanelProps) {
  const [reply, setReply] = useState('')
  const status = statusOf(view)
  // 병합·닫힘 뒤에는 승인·병합이 의미 없다 — 코멘트는 닫힌 뒤에도 달 수 있다(GitHub 동작 그대로)
  const settled = view.detail.merged || view.detail.state === 'closed'
  const submitReply = () => {
    const body = reply.trim()
    if (body === '') return
    void onComment(body).then((sent) => {
      if (sent) setReply('')
    })
  }
  return (
    <Panel
      title={`#${view.detail.number} ${view.detail.title}`}
      accessory={
        <>
          <span className="review-detail__status" data-testid="review-detail-status">
            {status.label} <span className="review-detail__status-raw">{status.raw}</span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            isDisabled={busy}
            onPress={onBack}
            testId="review-detail-back"
          >
            <ArrowLeft size={13} aria-hidden="true" /> 목록으로
          </Button>
        </>
      }
      testId="review-detail-panel"
    >
      <div className="review-detail__meta">
        <span
          className="review-detail__branches"
          title={`${view.detail.headBranch} → ${view.detail.baseBranch}`}
        >
          {view.detail.headBranch} → {view.detail.baseBranch}
        </span>
        <Button
          variant="ghost"
          size="sm"
          isDisabled={busy}
          onPress={onOpenBrowser}
          testId="review-detail-browser"
        >
          <ExternalLink size={13} aria-hidden="true" /> 브라우저에서 열기
        </Button>
      </div>
      <div className="review-detail__timeline" data-testid="review-detail-timeline">
        {view.comments.length === 0 ? (
          <p className="review-detail__empty">아직 코멘트가 없어요.</p>
        ) : (
          <ul className="review-detail__comments">
            {view.comments.map((comment) => (
              <CommentRow key={`${comment.kind}-${comment.id}`} comment={comment} />
            ))}
          </ul>
        )}
      </div>
      <div className="review-detail__reply">
        <textarea
          data-testid="review-reply-input"
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          placeholder="답변을 입력해 주세요"
          rows={2}
          aria-label="답변"
        />
        <Button
          variant="neutral"
          size="sm"
          isDisabled={busy || reply.trim() === ''}
          onPress={submitReply}
          testId="review-reply-send"
        >
          <Send size={13} aria-hidden="true" /> 보내기
        </Button>
      </div>
      <div className="review-detail__actions">
        <Button
          variant="neutral"
          size="sm"
          isDisabled={busy || settled}
          onPress={onApprove}
          testId="review-approve"
        >
          <Check size={13} aria-hidden="true" /> 승인하기 <Badge tone="git">approve</Badge>
        </Button>
        <Button
          variant="primary"
          size="sm"
          isDisabled={busy || settled}
          onPress={onMerge}
          testId="review-merge"
        >
          <GitMerge size={13} aria-hidden="true" /> 병합하기 <Badge tone="git">merge</Badge>
        </Button>
      </div>
    </Panel>
  )
}
```

- [ ] **Step 2: CSS**

`apps/desktop/src/renderer/src/components/review-detail-panel.css` 생성:

```css
/* 우측 열 전환형(E3b) — 상단 메타, 중단 타임라인(잔여 공간 스크롤), 하단 답변·동작 */
.review-detail__status {
  font-size: var(--text-xs);
  font-weight: 700;
  white-space: nowrap;
}
.review-detail__status-raw {
  font-family: var(--font-mono);
  font-weight: 400;
  color: var(--color-text-faint);
}
.review-detail__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  border-bottom: 1px solid var(--color-border);
}
.review-detail__branches {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.review-detail__timeline {
  flex: 1 1 auto;
  min-height: 120px;
  overflow-y: auto;
  padding: var(--space-2) var(--space-4);
}
.review-detail__empty {
  margin: 0;
  padding: var(--space-4) 0;
  font-size: var(--text-xs);
  color: var(--color-text-faint);
  text-align: center;
}
.review-detail__comments {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.review-detail__comment-meta {
  margin: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}
.review-detail__comment-meta strong {
  color: var(--color-text);
}
.review-detail__comment-body {
  margin: 2px 0 0;
  font-size: var(--text-sm);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.review-detail__reply {
  display: flex;
  align-items: flex-end;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--color-border);
}
.review-detail__reply textarea {
  flex: 1;
  min-width: 0;
  resize: vertical;
  min-height: 40px;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  color: var(--color-text);
  background: var(--color-surface);
}
.review-detail__reply textarea:focus {
  outline: 2px solid var(--color-focus);
  outline-offset: 1px;
  border-color: transparent;
}
.review-detail__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  padding: 0 var(--space-4) var(--space-3);
}
```

- [ ] **Step 3: ReviewPopover — 클릭=상세, 아이콘=브라우저 분리**

`apps/desktop/src/renderer/src/components/ReviewPopover.tsx` 수정.

(a) props — 기존:

```tsx
  /** 리뷰 요청을 브라우저로 — 주소는 main이 보관한 목록에서만 찾는다 */
  onOpenPull(number: number): void
```

교체:

```tsx
  /** 목록 항목 클릭 — 팝오버를 닫고 우측 열을 리뷰 상세로 전환한다 */
  onSelectPull(number: number): void
  /** 리뷰 요청을 브라우저로 — 주소는 main이 보관한 목록에서만 찾는다. 항목의 바깥 링크 아이콘 전용 */
  onOpenPull(number: number): void
```

(b) 컴포넌트 doc·구조 분해 — 기존:

```tsx
/** 리뷰 (스펙 §9 E3a) — GitHub 연결과 리뷰 요청(pull request) 생성·목록. ShelfPopover 패턴 */
export function ReviewPopover({
  status,
  pulls,
  busy,
  currentBranch,
  stateBlocked,
  onOpen,
  onConnectGh,
  onConnectToken,
  onDisconnect,
  onCreate,
  onOpenPull,
}: ReviewPopoverProps) {
```

교체:

```tsx
/** 리뷰 (스펙 §9 E3a·E3b) — GitHub 연결·리뷰 요청 생성·목록·상세 진입. ShelfPopover 패턴 */
export function ReviewPopover({
  status,
  pulls,
  busy,
  currentBranch,
  stateBlocked,
  onOpen,
  onConnectGh,
  onConnectToken,
  onDisconnect,
  onCreate,
  onSelectPull,
  onOpenPull,
}: ReviewPopoverProps) {
```

(c) 목록 항목 — 클릭 영역 분리. 기존:

```tsx
                      {pulls.map((pull) => (
                        <li key={pull.number} className="review-popover__row">
                          <button
                            type="button"
                            className="review-popover__pull"
                            title="브라우저에서 열기"
                            onClick={() => onOpenPull(pull.number)}
                            data-testid={`review-pull-${pull.number}`}
                          >
                            <span className="review-popover__pull-title">
                              #{pull.number} {pull.title}
                              {pull.isDraft && <Badge>초안</Badge>}
                            </span>
                            <span className="review-popover__pull-branch">{pull.headBranch}</span>
                            <ExternalLink size={12} aria-hidden="true" />
                          </button>
                        </li>
                      ))}
```

교체:

```tsx
                      {pulls.map((pull) => (
                        <li key={pull.number} className="review-popover__row">
                          <button
                            type="button"
                            className="review-popover__pull"
                            title="코멘트·승인·병합 보기"
                            onClick={() => openDialog(() => onSelectPull(pull.number))}
                            data-testid={`review-pull-${pull.number}`}
                          >
                            <span className="review-popover__pull-title">
                              #{pull.number} {pull.title}
                              {pull.isDraft && <Badge>초안</Badge>}
                            </span>
                            <span className="review-popover__pull-branch">{pull.headBranch}</span>
                          </button>
                          <button
                            type="button"
                            className="review-popover__pull-external"
                            title="브라우저에서 열기"
                            aria-label={`#${pull.number} 브라우저에서 열기`}
                            onClick={() => onOpenPull(pull.number)}
                            data-testid={`review-pull-open-${pull.number}`}
                          >
                            <ExternalLink size={12} aria-hidden="true" />
                          </button>
                        </li>
                      ))}
```

(항목 클릭은 `openDialog` 경유 — 팝오버를 닫고 상세를 연다. 기존 E2E `review-pull-1`의 `toContainText` 단언은 제목이 행 버튼 안에 그대로 있어 통과한다 — 실측 근거는 헤더 참조.)

(d) `apps/desktop/src/renderer/src/components/review-popover.css` — 행을 flex로. 기존:

```css
.review-popover__row {
  border-top: 1px solid var(--color-border);
}
.review-popover__pull {
  width: 100%;
  display: flex;
```

교체:

```css
.review-popover__row {
  border-top: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  gap: 2px;
}
.review-popover__pull {
  flex: 1;
  min-width: 0;
  display: flex;
```

(e) 같은 파일 `.review-popover__pull-branch` 블록 뒤에 추가 — 기존:

```css
.review-popover__pull-branch {
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--color-surface-sunken);
  border: 1px solid var(--color-border);
  color: var(--color-text-muted);
}
```

교체:

```css
.review-popover__pull-branch {
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--color-surface-sunken);
  border: 1px solid var(--color-border);
  color: var(--color-text-muted);
}
/* 항목의 바깥 링크 아이콘 — 클릭 영역을 행(상세 열기)과 분리한다 (E3b) */
.review-popover__pull-external {
  flex: none;
  display: inline-flex;
  align-items: center;
  background: none;
  border: 0;
  margin: 0;
  padding: var(--space-2) 4px;
  cursor: pointer;
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
}
.review-popover__pull-external:hover {
  background: var(--color-surface-sunken);
  color: var(--color-text);
}
```

- [ ] **Step 4: App 배선**

`apps/desktop/src/renderer/src/App.tsx` 수정.

(a) import — 기존:

```tsx
import { ReviewPopover } from './components/ReviewPopover'
```

교체:

```tsx
import { ReviewDetailPanel } from './components/ReviewDetailPanel'
import { ReviewPopover } from './components/ReviewPopover'
```

(b) 다이얼로그 상태 — 기존:

```tsx
  // 리뷰(호스팅) 다이얼로그 — 토큰 붙여넣기·리뷰 요청 제목 (팝오버는 닫고 연다)
  const [tokenPrompt, setTokenPrompt] = useState(false)
  const [pullPrompt, setPullPrompt] = useState(false)
```

교체:

```tsx
  // 리뷰(호스팅) 다이얼로그 — 토큰 붙여넣기·리뷰 요청 제목 (팝오버는 닫고 연다)
  const [tokenPrompt, setTokenPrompt] = useState(false)
  const [pullPrompt, setPullPrompt] = useState(false)

  // 리뷰 상세의 병합 확인과 병합 후 "기본 공간 이동+받아오기" 제안(base 이름 보관)
  const [confirmingMerge, setConfirmingMerge] = useState(false)
  const [mergeFollowUp, setMergeFollowUp] = useState<string | null>(null)
```

(c) main 클래스 — 기존:

```tsx
      <main
        className={`app__main${store.commitDetail !== null ? ' app__main--detail' : ''}`}
```

교체:

```tsx
      <main
        className={`app__main${
          store.commitDetail !== null || store.pullDetail !== null ? ' app__main--detail' : ''
        }`}
```

(d) ReviewPopover 배선 — 기존:

```tsx
            onOpenPull={(number) => void store.openPull(number)}
```

교체:

```tsx
            onSelectPull={(number) => void store.openPullDetail(number)}
            onOpenPull={(number) => void store.openPull(number)}
```

(e) 우측 열 3분기 — 기존:

```tsx
        {store.commitDetail !== null ? (
          <CommitDetailPanel
            detail={store.commitDetail}
            shelfPreview={shelfPreview}
            selectedFile={store.commitFile}
            busy={store.busy}
            onSelectFile={(file) => void store.selectCommitFile(file)}
            onBack={() => store.clearCommit()}
          />
        ) : (
```

교체:

```tsx
        {store.pullDetail !== null ? (
          <ReviewDetailPanel
            view={store.pullDetail}
            busy={store.busy}
            onOpenBrowser={() => void store.openPull(store.pullDetail!.detail.number)}
            onBack={() => store.closePullDetail()}
            onComment={(body) => store.addPullComment(body)}
            onApprove={() => void store.approvePull()}
            onMerge={() => setConfirmingMerge(true)}
          />
        ) : store.commitDetail !== null ? (
          <CommitDetailPanel
            detail={store.commitDetail}
            shelfPreview={shelfPreview}
            selectedFile={store.commitFile}
            busy={store.busy}
            onSelectFile={(file) => void store.selectCommitFile(file)}
            onBack={() => store.clearCommit()}
          />
        ) : (
```

(f) 다이얼로그 2개 — 기존(파일 끝 부분):

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
    </div>
  )
}
```

교체:

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
      <ConfirmDialog
        isOpen={confirmingMerge}
        title="리뷰 요청을 병합할까요?"
        confirmLabel="병합하기"
        onConfirm={() => {
          setConfirmingMerge(false)
          void (async () => {
            // base 이름은 병합 전에 붙잡아 둔다 — 성공 후 제안 다이얼로그가 쓴다
            const base = store.pullDetail?.detail.baseBranch ?? null
            if (await store.mergePull()) setMergeFollowUp(base)
          })()
        }}
        onCancel={() => setConfirmingMerge(false)}
      >
        "{store.pullDetail?.detail.baseBranch}"에 합쳐져요. 이 동작은 GitHub에서 일어나요.
      </ConfirmDialog>
      <ConfirmDialog
        isOpen={mergeFollowUp !== null}
        title="기본 공간으로 이동할까요?"
        confirmLabel="이동하고 받아오기"
        onConfirm={() => {
          const base = mergeFollowUp
          setMergeFollowUp(null)
          void (async () => {
            if (base === null) return
            // 기존 안전망 그대로 — 전환(자동 보관)·받아오기(충돌 흐름)를 순서대로 실행한다
            await store.switchBranch(base)
            await store.pullLatest()
          })()
        }}
        onCancel={() => setMergeFollowUp(null)}
      >
        병합 완료 — 기본 공간({mergeFollowUp})으로 이동해 최신을 받아올까요? 나중에 해도 돼요.
      </ConfirmDialog>
    </div>
  )
}
```

(취소 시에는 아무 것도 하지 않는다 — mergePull이 이미 "로컬은 아직 그대로예요 — 받아오기를 하면 반영돼요" notice를 남겨 두었다.)

- [ ] **Step 5: 게이트 (기존 E2E 회귀 포함)**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build && (cd apps/desktop && pnpm e2e)`
Expected: **296 tests** + typecheck 전부 Done(6 프로젝트) + build + **E2E 32 passed** (기존 회귀 없음 — review-pull-1 클릭 의미 변경은 기존 단언과 호환, 실측 근거는 헤더)

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src
git commit -m "feat(desktop): ReviewDetailPanel — 코멘트 타임라인·답변·승인·병합 + 팝오버 클릭 분리

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: PromptDialog masked 옵션 — 토큰 입력 마스킹 (E3a 후속 노트)

**Files:**
- Modify: `apps/desktop/src/renderer/src/ui/PromptDialog.tsx`
- Modify: `apps/desktop/src/renderer/src/App.tsx`

컴포넌트라 단위 테스트 불가(기존 관례) — 기존 E2E '미연결 안내가 보이고 잘못된 토큰은 친절한 에러로 거부된다'가 `prompt-input` fill·`toHaveValue` 단언으로 회귀를 커버한다(password 타입에서도 동일하게 동작). IME 가드·initialValue·errorText는 불변.

- [ ] **Step 1: PromptDialog**

(a) props — 기존:

```tsx
  /** 열릴 때 채워 둘 값 — 이름 바꾸기 등. 기본은 빈 값 */
  initialValue?: string
```

교체:

```tsx
  /** 열릴 때 채워 둘 값 — 이름 바꾸기 등. 기본은 빈 값 */
  initialValue?: string
  /** 입력을 가린다(type=password) — 토큰 등 비밀값 전용 (E3a 후속 노트: PAT 마스킹) */
  masked?: boolean
```

(b) 구조 분해 — 기존:

```tsx
  submitLabel,
  initialValue,
  errorText,
  onSubmit,
  onCancel,
}: PromptDialogProps) {
```

교체:

```tsx
  submitLabel,
  initialValue,
  masked,
  errorText,
  onSubmit,
  onCancel,
}: PromptDialogProps) {
```

(c) Input — 기존:

```tsx
            <Input className="ui-prompt__input" placeholder={placeholder} data-testid="prompt-input" />
```

교체:

```tsx
            <Input
              className="ui-prompt__input"
              type={masked ? 'password' : 'text'}
              placeholder={placeholder}
              data-testid="prompt-input"
            />
```

- [ ] **Step 2: App — 토큰 다이얼로그에만 적용**

기존:

```tsx
      <PromptDialog
        isOpen={tokenPrompt}
        title="GitHub 토큰으로 연결"
        description="github.com → Settings → Developer settings → Personal access tokens에서 만들 수 있어요. 만든 토큰을 붙여넣어 주세요."
        label="토큰"
        placeholder="ghp_..."
        submitLabel="연결"
```

교체:

```tsx
      <PromptDialog
        isOpen={tokenPrompt}
        title="GitHub 토큰으로 연결"
        description="github.com → Settings → Developer settings → Personal access tokens에서 만들 수 있어요. 만든 토큰을 붙여넣어 주세요."
        label="토큰"
        placeholder="ghp_..."
        masked
        submitLabel="연결"
```

- [ ] **Step 3: 게이트**

Run: `pnpm typecheck && pnpm --filter @git-gui/desktop build && (cd apps/desktop && npx playwright test e2e/hosting.spec.ts)`
Expected: typecheck 전부 Done + build + **3 passed** (토큰 연결 E2E가 password 입력으로도 통과)

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/src/ui/PromptDialog.tsx apps/desktop/src/renderer/src/App.tsx
git commit -m "feat(desktop): 토큰 입력 마스킹 — PromptDialog masked 옵션(E3a 후속 노트)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---
### Task 7: E2E 3건 — mock GitHub 확장(코멘트·리뷰·병합 상태 반영)

> **구현 실측 추기(Step 0):** 병합 확인 다이얼로그가 진입 애니메이션 120ms가 끝나기 전에 닫히면
> react-aria가 animationend까지 unmount를 미뤄 후속 제안 다이얼로그와 alertdialog 2개가 겹친다
> (실측: `data-entering`·`data-exiting` 동시 존재 — E1c의 확인창 공존 문제와 같은 뿌리).
> `confirm-dialog.css`에 퇴장 즉시화 1규칙을 추가한다:
>
> ```css
> /* 퇴장 애니메이션을 없앤다 — 연속 확인창(병합→이동 제안)에서
>    alertdialog 2개가 잠깐 겹친다(E3b 실측: data-entering·data-exiting 동시 존재) */
> .ui-modal-overlay[data-exiting] {
>   animation: none;
> }
> ```

**Files:**
- Modify: `apps/desktop/e2e/hosting.spec.ts`

mock 서버를 상태 반영형으로 확장한다: 코멘트·리뷰 GET/POST, 상세 GET, 병합 PUT. 기존 3건은 그대로 두고(생성 POST만 MockPull 확장 필드를 채우도록 수정) 신규 3건을 뒤에 붙인다.

- [ ] **Step 1: mock 서버 교체**

`apps/desktop/e2e/hosting.spec.ts`에서 `/** mock GitHub — ... */` 주석부터 `startMockGitHub` 함수 끝(`}` — `createGitHubFixtureRepo` doc 주석 앞)까지의 구획 전체를 다음으로 교체:

```ts
/** mock GitHub — /user·/repos·/pulls + 코멘트·리뷰·병합 최소 구현. 쓰기를 메모리에 반영한다 */
interface MockPull {
  number: number
  title: string
  head: string
  base: string
  merged: boolean
  comments: Array<{ id: number; body: string; login: string; created_at: string }>
  reviews: Array<{ id: number; body: string; state: string; login: string; submitted_at: string }>
}

interface MockGitHub {
  url: string
  pulls: MockPull[]
  close(): Promise<void>
}

function toApiPull(pull: MockPull) {
  return {
    number: pull.number,
    title: pull.title,
    draft: false,
    html_url: `https://github.com/e2e/fixture/pull/${pull.number}`,
    head: { ref: pull.head },
    base: { ref: pull.base },
  }
}

function toApiPullDetail(pull: MockPull) {
  return { ...toApiPull(pull), state: pull.merged ? 'closed' : 'open', merged: pull.merged }
}

async function startMockGitHub(options: { rejectApprove?: boolean } = {}): Promise<MockGitHub> {
  const pulls: MockGitHub['pulls'] = []
  let nextId = 1000
  const server: Server = createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (req.headers.authorization !== 'Bearer e2e-token') {
      send(401, { message: 'Bad credentials' })
      return
    }
    const path = (req.url ?? '/').split('?')[0]!
    const readBody = (done: (raw: string) => void) => {
      let raw = ''
      req.on('data', (chunk: Buffer) => {
        raw += chunk.toString('utf8')
      })
      req.on('end', () => done(raw))
    }
    const pullOf = (segment: string | undefined) =>
      pulls.find((pull) => String(pull.number) === segment)
    if (req.method === 'GET' && path === '/user') {
      send(200, { login: 'e2e-user' })
      return
    }
    if (req.method === 'GET' && path === '/repos/e2e/fixture') {
      send(200, { default_branch: 'main' })
      return
    }
    if (req.method === 'GET' && path === '/repos/e2e/fixture/pulls') {
      // state=open 요청 — 병합된 것은 목록에서 뺀다
      send(200, pulls.filter((pull) => !pull.merged).map(toApiPull))
      return
    }
    if (req.method === 'POST' && path === '/repos/e2e/fixture/pulls') {
      readBody((raw) => {
        const input = JSON.parse(raw) as { title: string; head: string; base: string }
        if (pulls.some((pull) => pull.head === input.head)) {
          send(422, {
            message: 'Validation Failed',
            errors: [{ message: `A pull request already exists for e2e:${input.head}.` }],
          })
          return
        }
        const pull: MockPull = {
          number: pulls.length + 1,
          title: input.title,
          head: input.head,
          base: input.base,
          merged: false,
          comments: [],
          reviews: [],
        }
        pulls.push(pull)
        send(201, toApiPull(pull))
      })
      return
    }
    const detailMatch = /^\/repos\/e2e\/fixture\/pulls\/(\d+)$/.exec(path)
    if (req.method === 'GET' && detailMatch !== null) {
      const pull = pullOf(detailMatch[1])
      if (pull === undefined) {
        send(404, { message: 'Not Found' })
        return
      }
      send(200, toApiPullDetail(pull))
      return
    }
    const commentsMatch = /^\/repos\/e2e\/fixture\/issues\/(\d+)\/comments$/.exec(path)
    if (commentsMatch !== null) {
      const pull = pullOf(commentsMatch[1])
      if (pull === undefined) {
        send(404, { message: 'Not Found' })
        return
      }
      if (req.method === 'GET') {
        send(
          200,
          pull.comments.map((comment) => ({
            id: comment.id,
            user: { login: comment.login },
            body: comment.body,
            created_at: comment.created_at,
          })),
        )
        return
      }
      if (req.method === 'POST') {
        readBody((raw) => {
          const input = JSON.parse(raw) as { body: string }
          nextId += 1
          pull.comments.push({
            id: nextId,
            body: input.body,
            login: 'e2e-user',
            created_at: new Date().toISOString(),
          })
          send(201, { id: nextId })
        })
        return
      }
    }
    const reviewsMatch = /^\/repos\/e2e\/fixture\/pulls\/(\d+)\/reviews$/.exec(path)
    if (reviewsMatch !== null) {
      const pull = pullOf(reviewsMatch[1])
      if (pull === undefined) {
        send(404, { message: 'Not Found' })
        return
      }
      if (req.method === 'GET') {
        send(
          200,
          pull.reviews.map((review) => ({
            id: review.id,
            user: { login: review.login },
            body: review.body,
            state: review.state,
            submitted_at: review.submitted_at,
          })),
        )
        return
      }
      if (req.method === 'POST') {
        readBody(() => {
          if (options.rejectApprove === true) {
            // 실 GitHub 자기 PR 승인 응답 본문 — 이 부분 문자열로 친절 매핑된다
            send(422, {
              message: 'Unprocessable Entity',
              errors: ['Can not approve your own pull request'],
            })
            return
          }
          nextId += 1
          pull.reviews.push({
            id: nextId,
            body: '',
            state: 'APPROVED',
            login: 'e2e-user',
            submitted_at: new Date().toISOString(),
          })
          send(200, { id: nextId, state: 'APPROVED' })
        })
        return
      }
    }
    const mergeMatch = /^\/repos\/e2e\/fixture\/pulls\/(\d+)\/merge$/.exec(path)
    if (req.method === 'PUT' && mergeMatch !== null) {
      const pull = pullOf(mergeMatch[1])
      if (pull === undefined) {
        send(404, { message: 'Not Found' })
        return
      }
      readBody(() => {
        pull.merged = true
        send(200, { merged: true, message: 'Pull Request successfully merged' })
      })
      return
    }
    send(404, { message: 'Not Found' })
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    pulls,
    close: () =>
      new Promise<void>((resolve) => {
        // 앱 종료 후에도 keep-alive 소켓이 남아 close가 지연될 수 있다 — 강제로 끊는다
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
```

(기존 테스트 1의 `mock.pulls[0]` `toMatchObject`·`pulls.some(head)` 검사와 호환 — 필드가 늘었을 뿐 기존 단언은 그대로 통과한다.)

- [ ] **Step 2: 신규 E2E 3건**

파일 끝(기존 세 번째 테스트 뒤)에 추가:

```ts
test('리뷰 요청 상세를 열어 코멘트를 확인하고 답변을 단다', async () => {
  const mock = await startMockGitHub()
  mock.pulls.push({
    number: 1,
    title: '로그인 버튼 색 실험',
    head: 'feature',
    base: 'main',
    merged: false,
    comments: [
      {
        id: 100,
        body: '버튼 색이 좋아요. 문구만 다듬어 주세요.',
        login: 'reviewer',
        created_at: '2026-07-20T09:00:00Z',
      },
    ],
    reviews: [],
  })
  const repo = await createGitHubFixtureRepo({ branch: 'feature', withUpstream: true })
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: {
      ...process.env,
      GIT_GUI_E2E_REPO: repo,
      GIT_GUI_USER_DATA: userData,
      GIT_GUI_GITHUB_API: mock.url,
      GIT_GUI_E2E_GH_TOKEN: 'e2e-token',
    },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('review-open').click()
    await window.getByTestId('review-pull-1').click()
    // 팝오버가 닫히고 우측 열이 리뷰 상세로 전환된다 — 제목·상태·타임라인
    await expect(window.getByTestId('review-detail-panel')).toContainText('#1 로그인 버튼 색 실험')
    await expect(window.getByTestId('review-detail-status')).toContainText('열림')
    await expect(window.getByTestId('review-detail-timeline')).toContainText(
      '버튼 색이 좋아요. 문구만 다듬어 주세요.',
    )
    // 답변 — 성공하면 서버 상태를 다시 읽어 타임라인에 반영된다
    await window.getByTestId('review-reply-input').fill('고마워요! 문구를 다듬었어요.')
    await window.getByTestId('review-reply-send').click()
    await expect(window.getByTestId('review-detail-timeline')).toContainText(
      '고마워요! 문구를 다듬었어요.',
    )
    // mock 상태에 실제 반영됐다
    expect(mock.pulls[0]!.comments).toHaveLength(2)
    expect(mock.pulls[0]!.comments[1]).toMatchObject({ body: '고마워요! 문구를 다듬었어요.' })
  } finally {
    await app.close()
    await mock.close()
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('승인하면 승인됨 배지, 병합하면 병합됨 배지와 기본 공간 이동 제안이 뜬다', async () => {
  // mock은 타인 PR 시나리오 — 승인이 성공한다(자기 승인 거부는 다음 테스트)
  const mock = await startMockGitHub()
  mock.pulls.push({
    number: 1,
    title: '로그인 버튼 색 실험',
    head: 'feature',
    base: 'main',
    merged: false,
    comments: [],
    reviews: [],
  })
  const repo = await createGitHubFixtureRepo({ branch: 'feature', withUpstream: true })
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: {
      ...process.env,
      GIT_GUI_E2E_REPO: repo,
      GIT_GUI_USER_DATA: userData,
      GIT_GUI_GITHUB_API: mock.url,
      GIT_GUI_E2E_GH_TOKEN: 'e2e-token',
    },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('review-open').click()
    await window.getByTestId('review-pull-1').click()
    await expect(window.getByTestId('review-detail-status')).toContainText('열림')
    // 승인 → 상세 재조회로 '승인됨' 배지 + 타임라인의 승인 항목
    await window.getByTestId('review-approve').click()
    await expect(window.getByTestId('review-detail-status')).toContainText('승인됨')
    await expect(window.getByTestId('review-detail-timeline')).toContainText('승인했어요')
    expect(mock.pulls[0]!.reviews).toHaveLength(1)
    // 병합 — 확인창을 거친다
    await window.getByTestId('review-merge').click()
    await expect(window.getByRole('alertdialog')).toContainText('이 동작은 GitHub에서 일어나요.')
    await window.getByTestId('confirm-accept').click()
    await expect(window.getByTestId('review-detail-status')).toContainText('병합됨')
    expect(mock.pulls[0]!.merged).toBe(true)
    // 병합 후 기본 공간 이동 제안 — '나중에'(그만두기)를 고르면 안내 notice만 남는다.
    // 확인 경로(전환+받아오기)는 기존 smoke E2E가 커버하고, 여기서 실행하면 mock GitHub(가짜
    // 병합)와 로컬 픽스처(원격 네트워크 없음)의 정합이 깨진다 — 취소로 끝낸다(근거: 헤더)
    await expect(window.getByRole('alertdialog')).toContainText('기본 공간(main)으로 이동해')
    await window.getByTestId('confirm-cancel').click()
    await expect(window.getByTestId('notice')).toContainText('병합했어요')
  } finally {
    await app.close()
    await mock.close()
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('내가 만든 리뷰 요청은 스스로 승인할 수 없다는 친절 에러를 보여준다', async () => {
  // mock이 실 GitHub의 자기 승인 422 본문을 그대로 돌려주는 모드
  const mock = await startMockGitHub({ rejectApprove: true })
  mock.pulls.push({
    number: 1,
    title: '로그인 버튼 색 실험',
    head: 'feature',
    base: 'main',
    merged: false,
    comments: [],
    reviews: [],
  })
  const repo = await createGitHubFixtureRepo({ branch: 'feature', withUpstream: true })
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-e2e-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: {
      ...process.env,
      GIT_GUI_E2E_REPO: repo,
      GIT_GUI_USER_DATA: userData,
      GIT_GUI_GITHUB_API: mock.url,
      GIT_GUI_E2E_GH_TOKEN: 'e2e-token',
    },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('review-open').click()
    await window.getByTestId('review-pull-1').click()
    await expect(window.getByTestId('review-detail-panel')).toBeVisible()
    await window.getByTestId('review-approve').click()
    await expect(window.getByTestId('error')).toContainText('스스로 승인할 수 없어요')
    // 상세는 열린 채 남는다 — 다른 사람의 승인을 기다리면 된다
    await expect(window.getByTestId('review-detail-status')).toContainText('열림')
  } finally {
    await app.close()
    await mock.close()
    await rm(repo, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})
```

- [ ] **Step 3: 게이트**

Run: `cd apps/desktop && pnpm e2e`
Expected: **E2E 35 passed** (32+3)

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/e2e/hosting.spec.ts
git commit -m "test(e2e): E3b 리뷰 흐름 3건 — mock GitHub 코멘트·리뷰·병합 확장

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---
### Task 8: 최종 게이트 + 공식 스크린샷 3장 + README

- [ ] **Step 1: 전체 게이트**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build && (cd apps/desktop && pnpm e2e)`
Expected: **296 tests + typecheck 전부 Done(6 프로젝트) + build + E2E 35 passed** — 전부 exit 0

- [ ] **Step 2: 스크린샷 3장** (1440×900, `apps/desktop/test-results/` + scratchpad 사본. **생성 후 playwright/e2e 재실행 금지** — playwright가 test-results를 청소한다)

임시 스펙 `apps/desktop/e2e/shots.spec.ts`를 만든다 (**커밋 금지 — 촬영 후 삭제**). mock 서버·픽스처는 Task 7의 hosting.spec.ts와 동일 코드를 복사한다(임시 파일이라 중복 허용):

```ts
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { execGitOrThrow } from '@git-gui/git-process'

const APP_ROOT = join(__dirname, '..')

interface MockPull {
  number: number
  title: string
  head: string
  base: string
  merged: boolean
  comments: Array<{ id: number; body: string; login: string; created_at: string }>
  reviews: Array<{ id: number; body: string; state: string; login: string; submitted_at: string }>
}

function toApiPull(pull: MockPull) {
  return {
    number: pull.number,
    title: pull.title,
    draft: false,
    html_url: `https://github.com/e2e/fixture/pull/${pull.number}`,
    head: { ref: pull.head },
    base: { ref: pull.base },
  }
}

function toApiPullDetail(pull: MockPull) {
  return { ...toApiPull(pull), state: pull.merged ? 'closed' : 'open', merged: pull.merged }
}

async function startMockGitHub(): Promise<{
  url: string
  pulls: MockPull[]
  close(): Promise<void>
}> {
  const pulls: MockPull[] = []
  let nextId = 1000
  const server: Server = createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (req.headers.authorization !== 'Bearer e2e-token') {
      send(401, { message: 'Bad credentials' })
      return
    }
    const path = (req.url ?? '/').split('?')[0]!
    const readBody = (done: (raw: string) => void) => {
      let raw = ''
      req.on('data', (chunk: Buffer) => {
        raw += chunk.toString('utf8')
      })
      req.on('end', () => done(raw))
    }
    const pullOf = (segment: string | undefined) =>
      pulls.find((pull) => String(pull.number) === segment)
    if (req.method === 'GET' && path === '/user') {
      send(200, { login: 'e2e-user' })
      return
    }
    if (req.method === 'GET' && path === '/repos/e2e/fixture') {
      send(200, { default_branch: 'main' })
      return
    }
    if (req.method === 'GET' && path === '/repos/e2e/fixture/pulls') {
      send(200, pulls.filter((pull) => !pull.merged).map(toApiPull))
      return
    }
    const detailMatch = /^\/repos\/e2e\/fixture\/pulls\/(\d+)$/.exec(path)
    if (req.method === 'GET' && detailMatch !== null) {
      const pull = pullOf(detailMatch[1])
      if (pull === undefined) {
        send(404, { message: 'Not Found' })
        return
      }
      send(200, toApiPullDetail(pull))
      return
    }
    const commentsMatch = /^\/repos\/e2e\/fixture\/issues\/(\d+)\/comments$/.exec(path)
    if (commentsMatch !== null) {
      const pull = pullOf(commentsMatch[1])
      if (pull === undefined) {
        send(404, { message: 'Not Found' })
        return
      }
      if (req.method === 'GET') {
        send(
          200,
          pull.comments.map((comment) => ({
            id: comment.id,
            user: { login: comment.login },
            body: comment.body,
            created_at: comment.created_at,
          })),
        )
        return
      }
    }
    const reviewsMatch = /^\/repos\/e2e\/fixture\/pulls\/(\d+)\/reviews$/.exec(path)
    if (reviewsMatch !== null) {
      const pull = pullOf(reviewsMatch[1])
      if (pull === undefined) {
        send(404, { message: 'Not Found' })
        return
      }
      if (req.method === 'GET') {
        send(
          200,
          pull.reviews.map((review) => ({
            id: review.id,
            user: { login: review.login },
            body: review.body,
            state: review.state,
            submitted_at: review.submitted_at,
          })),
        )
        return
      }
      if (req.method === 'POST') {
        readBody(() => {
          nextId += 1
          pull.reviews.push({
            id: nextId,
            body: '',
            state: 'APPROVED',
            login: 'e2e-user',
            submitted_at: new Date().toISOString(),
          })
          send(200, { id: nextId, state: 'APPROVED' })
        })
        return
      }
    }
    const mergeMatch = /^\/repos\/e2e\/fixture\/pulls\/(\d+)\/merge$/.exec(path)
    if (req.method === 'PUT' && mergeMatch !== null) {
      const pull = pullOf(mergeMatch[1])
      if (pull === undefined) {
        send(404, { message: 'Not Found' })
        return
      }
      readBody(() => {
        pull.merged = true
        send(200, { merged: true, message: 'Pull Request successfully merged' })
      })
      return
    }
    send(404, { message: 'Not Found' })
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    pulls,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

async function createGitHubFixtureRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'git-gui-shot-'))
  await execGitOrThrow(['init', '--initial-branch=main'], { cwd: dir })
  await execGitOrThrow(['config', 'user.name', 'E2E'], { cwd: dir })
  await execGitOrThrow(['config', 'user.email', 'e2e@test.local'], { cwd: dir })
  await writeFile(join(dir, 'app.txt'), 'v1\n')
  await execGitOrThrow(['add', '-A'], { cwd: dir })
  await execGitOrThrow(['commit', '-m', 'init'], { cwd: dir })
  await execGitOrThrow(['remote', 'add', 'origin', 'https://github.com/e2e/fixture.git'], {
    cwd: dir,
  })
  await execGitOrThrow(['checkout', '-b', 'feature'], { cwd: dir })
  await writeFile(join(dir, 'feat.txt'), 'f\n')
  await execGitOrThrow(['add', '-A'], { cwd: dir })
  await execGitOrThrow(['commit', '-m', '로그인 버튼 색 실험'], { cwd: dir })
  await execGitOrThrow(['config', 'branch.feature.remote', 'origin'], { cwd: dir })
  await execGitOrThrow(['config', 'branch.feature.merge', 'refs/heads/feature'], { cwd: dir })
  await execGitOrThrow(['update-ref', 'refs/remotes/origin/feature', 'HEAD'], { cwd: dir })
  return dir
}

test('E3b 공식 스크린샷 3장', async () => {
  const mock = await startMockGitHub()
  mock.pulls.push({
    number: 1,
    title: '로그인 버튼 색 실험',
    head: 'feature',
    base: 'main',
    merged: false,
    comments: [
      {
        id: 100,
        body: '버튼 색이 좋아요. 문구만 다듬어 주세요.',
        login: 'reviewer',
        created_at: '2026-07-20T09:00:00Z',
      },
    ],
    reviews: [],
  })
  const repo = await createGitHubFixtureRepo()
  const userData = await mkdtemp(join(tmpdir(), 'git-gui-shot-userdata-'))
  const app = await electron.launch({
    args: [APP_ROOT],
    env: {
      ...process.env,
      GIT_GUI_E2E_REPO: repo,
      GIT_GUI_USER_DATA: userData,
      GIT_GUI_GITHUB_API: mock.url,
      GIT_GUI_E2E_GH_TOKEN: 'e2e-token',
    },
  })
  const window = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]!.setSize(1440, 900)
  })
  // 1) 상세 — 타임라인·답변 입력
  await window.getByTestId('review-open').click()
  await window.getByTestId('review-pull-1').click()
  await expect(window.getByTestId('review-detail-timeline')).toContainText('버튼 색이 좋아요')
  await window.screenshot({ path: 'test-results/e3b-detail.png' })
  // 2) 승인됨
  await window.getByTestId('review-approve').click()
  await expect(window.getByTestId('review-detail-status')).toContainText('승인됨')
  await window.screenshot({ path: 'test-results/e3b-approved.png' })
  // 3) 병합됨 + 기본 공간 이동 제안 다이얼로그
  await window.getByTestId('review-merge').click()
  await expect(window.getByRole('alertdialog')).toContainText('이 동작은 GitHub에서 일어나요.')
  await window.getByTestId('confirm-accept').click()
  await expect(window.getByRole('alertdialog')).toContainText('기본 공간(main)으로 이동해')
  await window.screenshot({ path: 'test-results/e3b-merged.png' })
  await window.getByTestId('confirm-cancel').click()
  await app.close()
  await mock.close()
})
```

Run (Step 1 게이트의 build 산출물을 그대로 사용 — 다시 build하지 않는다):

```bash
cd apps/desktop && npx playwright test e2e/shots.spec.ts
```

Expected: 1 passed. 촬영물 확인·사본·정리:

```bash
ls apps/desktop/test-results/e3b-detail.png apps/desktop/test-results/e3b-approved.png apps/desktop/test-results/e3b-merged.png
cp apps/desktop/test-results/e3b-detail.png apps/desktop/test-results/e3b-approved.png apps/desktop/test-results/e3b-merged.png "/private/tmp/claude-501/-Users-sangyeop-kim-git-gui/47e198c4-f65c-435f-b962-13de0c0d68a0/scratchpad/"
rm apps/desktop/e2e/shots.spec.ts
```

각 장의 확인 포인트: (a) `e3b-detail.png` — 우측 열 리뷰 상세(#1 제목·'열림 open' 배지·@reviewer 코멘트·답변 입력·[승인하기]·[병합하기]), (b) `e3b-approved.png` — '승인됨 approved' 배지 + 타임라인의 "승인했어요", (c) `e3b-merged.png` — '병합됨 merged' 배지 뒤로 기본 공간 이동 제안 다이얼로그. **이후 playwright/e2e를 다시 실행하지 않는다.**

- [ ] **Step 3: README 갱신**

`README.md`의 "현재 상태" 구간에서 다음을 교체 — 기존:

```
0단계(기반)와 E0·E1·E2·E3a(쉬운 모드 — 실험 공간·보관함·합치기·충돌 카드·리뷰 요청)가 동작합니다
```

교체:

```
0단계(기반)와 E0·E1·E2·E3(쉬운 모드 — 실험 공간·보관함·합치기·충돌 카드·리뷰 흐름 완결)가 동작합니다
```

기존:

```
GitHub 연결(gh CLI 감지·토큰 붙여넣기, safeStorage 암호화 저장)과 리뷰 요청(pull request) 만들기·열린 목록·브라우저 열기 — 디자인 토큰
```

교체:

```
GitHub 연결(gh CLI 감지·토큰 붙여넣기, safeStorage 암호화 저장)과 리뷰 요청(pull request) 만들기·열린 목록·상세(코멘트 확인·답변)·승인·병합(병합 후 기본 공간 이동+받아오기 제안)·브라우저 열기 — 디자인 토큰
```

("다음 단계" 목록에는 협업 항목이 애초에 없다(실측 — 항목 2개뿐: 취소 가능한 Git 프로세스·fixture 확장) — 협업 완결 반영은 "현재 상태" 문구가 담당하고 "다음 단계"는 변경하지 않는다.)

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README — E3b 리뷰 흐름 완결(코멘트·답변·승인·병합) 반영

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 검증 게이트 요약

| 시점 | 기대치 |
| --- | --- |
| 기준선 (91b1366, 실측) | **280 tests + E2E 32** |
| Task 1 후 | +5 (buildPullTimeline) → **285 tests** |
| Task 2 후 | +11 (pulls 5메서드 정상+에러 매핑) → **296 tests** |
| Task 3 후 | 296 tests + typecheck + build |
| Task 4 후 | 296 tests + typecheck + build |
| Task 5 후 | 296 tests + build + **E2E 32** (기존 회귀 없음 — 팝오버 클릭 의미 변경 호환) |
| Task 6 후 | typecheck + build + hosting E2E 3 (토큰 연결이 password 입력으로 통과) |
| Task 7 후 | **E2E 35** (+3) |
| 최종 (Task 8) | **296 tests + typecheck 전부 Done(6 프로젝트) + build + E2E 35** — 전부 exit 0 + 스크린샷 3장 + README |

(수치가 어긋나면 이 표를 갱신한다 — 본질은 "전부 PASS + 신규 테스트 실존 + Red 실증 수행".)

## 스펙 요구 커버리지 (§9 후반부 + 확정 아키텍처 1~6)

| 요구 | 구현 지점 |
| --- | --- |
| 코멘트 병합·정렬 순수 함수 + 단위 테스트(레이어 분리) | buildPullTimeline + 5 tests (Task 1) |
| pulls.get — state·merged 포함 상세, 404 "리뷰 요청을 찾지 못했어요" | github.ts get + pullNotFound (Task 2) |
| pulls.comments — 이슈 코멘트+리뷰 병합·시간순, 라인 코멘트 제외 | github.ts comments → buildPullTimeline (Task 1·2) |
| pulls.addComment / approve(자기 PR 422 친절 문구) / merge(병합 커밋, 405·409 문구) | github.ts + mapError (Task 2) |
| 단위 테스트: 각 메서드 정상+에러 매핑 전수 (mock http 왕복) | github.test.ts +11 (Task 2) |
| IPC 4채널 + 인자 검증(assertPullNumber·body trim 거부) + knownPullUrls 갱신 | hosting-handlers + requireHosting (Task 3) |
| 토큰 renderer 미노출 유지 | 신규 경로 전부 main에서 hosting() 생성 — renderer는 number·body만 보낸다 (Task 3) |
| 우측 열 전환형 ReviewDetailPanel(제목·번호·상태 배지·브라우저 열기·목록으로) | ReviewDetailPanel + statusOf (Task 5) |
| 코멘트 타임라인(작성자·상대 시간·본문·승인 배지, 가상화 없음) | CommentRow + formatRelativeTime 재사용 (Task 5) |
| 답변 textarea+보내기(빈 값 비활성), 승인하기·병합하기(ConfirmDialog "…GitHub에서 일어나요") | ReviewDetailPanel 하단 + App confirmingMerge (Task 5) |
| 병합 성공 후 '병합됨' 갱신 + 이동 제안 → switchBranch(base)→pullLatest, 취소 시 notice | store.mergePull + App mergeFollowUp (Task 4·5) |
| store pullDetail — CLEAR_SELECTIONS 포함·커밋 상세 상호 배타·guard 직렬화·액션 5 | repository-store (Task 4) |
| 팝오버 "클릭=상세, 외부 아이콘=브라우저" 분리 + 기존 E2E 호환 판단 | ReviewPopover (Task 5, 실측 근거 헤더) |
| PAT 마스킹(E3a 후속) — masked 옵션, IME 가드·initialValue·errorText 불변 | PromptDialog (Task 6) |
| E2E 3건(mock 확장: comments·reviews·merge 상태 반영, 취소 종료 근거 명시) | hosting.spec.ts (Task 7) |
| 문구 일상어+원어 병기(§5) | '병합됨 merged'·'승인하기 approve' 등 전 문구 (Task 5) |
| 최종 게이트 + 스크린샷 3장 + README 협업 완결 | Task 8 |

## 후속 노트 (E3b 이후 이관 후보)

- **라인 단위 리뷰 코멘트(/pulls/{n}/comments):** diff 위치에 달린 코멘트는 타임라인에 없다 — diff 뷰 앵커 표시와 함께 별도 설계 필요.
- **타임라인 자동 새로고침:** 열 때·쓸 때만 갱신 — 폴링 또는 수동 새로고침 버튼 검토.
- **코멘트·리뷰 per_page=100 초과:** 잘린다 — 페이징(오래된 코멘트 접기 UI와 함께).
- **승인 뒤집힘(CHANGES_REQUESTED·dismiss):** 승인됨 판정이 "APPROVED 존재"라 뒤집혀도 승인됨으로 보일 수 있다 — 최신 리뷰 상태 기준 판정으로 개선.
- **merge_method 고정(merge):** squash·rebase는 앱 철학(조상 기록)상 비목표 — 저장소 설정이 병합 커밋을 금지하면 405 문구로만 안내된다. 설정 감지 후 안내 개선 검토.
- **병합 후 원격 실험 공간 정리:** head 브랜치 삭제(DELETE /git/refs) 미지원 — 로컬 실험 공간 지우기 흐름과 묶어 검토.
- **CLEAR_SELECTIONS로 리뷰 상세가 닫히는 폭:** 스테이지·커밋 등 로컬 작업마다 닫힌다(관례 일관) — 리뷰를 보며 작업하는 흐름이 잦으면 유지 정책 재검토.
- **draft PR:** 상세에서 초안 여부를 표시하지 않는다(목록만 배지) — 병합 시 405 문구로 걸러진다.
- **닫힘(closed·미병합) 상태의 재열기(reopen):** 미지원 — 브라우저 안내.
- (E3a에서 유지) 401 재연결 유도 UX, 기본 공간 이름 캐시, pulls 목록 페이지네이션, GitHub Enterprise.
- (해소 기록) E3a 후속 노트의 **PAT 입력 마스킹**은 Task 6에서 해소됐다.
