# E8 개발자 어휘 전환 + 디자인 정리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 화면 어휘를 개발자 표준(커밋·브랜치·스태시·병합·푸시)으로 바꾸되 용어 사전 모듈로 모아 다음 전환(쉬운 모드)을 싸게 만들고, AI-slop 인상을 주던 커밋 폼·영문 배지·좌측 레이아웃·행 액션을 정리한다.

**Architecture:** `terms.ts` 한 파일에 어휘를 모으고 화면·E2E가 키로 참조한다(문장은 리터럴 유지, 문장 속 어휘만 보간). 디자인 정리는 순서상 어휘 전환 뒤에 온다 — 배지를 지우고 폼을 다시 그릴 때 최종 문구가 이미 정해져 있어야 두 번 안 고친다.

**Tech Stack:** 기존과 동일(Electron·React·zustand·vitest·Playwright). **신규 의존성 없음**.

**Branch:** `feature/e8-dev-vocabulary` (main de1d8b2 이후에서 생성)

**게이트 기준선:** 루트 테스트 **520**, desktop e2e **92**(smoke 86 + hosting 6). 태스크마다 "+N(실측 정정)"으로 누적한다(E7g~E7k 관례).

## 사전 실측 (플랜 작성 시 확인 — 재확인 불요)

1. **E2E는 워크스페이스 모듈을 이미 import한다**(`import { execGitOrThrow } from '@git-gui/git-process'`) — playwright가 TS를 트랜스파일하므로 `../src/renderer/src/terms`(순수 상수 객체, 브라우저 API 미사용) import도 가능할 전망. **Task 2 Step 1에서 실제로 확인**하고, 실패하면 E2E는 리터럴 유지 + 편차 보고.
2. **`tone="git"` 배지 16곳 전수**: `App.tsx:381`(merge)·`409`(pull)·`450`(push), `ReviewPopover.tsx:76`(PR), `HistoryPanel.tsx:358`(log), `ConflictPanel.tsx:135`(conflict), `ShelfPopover.tsx:46`(stash), `BranchesPanel.tsx:208`(compare)·`359`(branch), `ChangesPanel.tsx:224`(`{termBadge}` — unstaged/staged), `ReviewDetailPanel.tsx:157`(approve)·`166`(merge), `DiffPanel.tsx:46`(diff), `WorktreesPanel.tsx:110`(worktree), `CommitDetailPanel.tsx:151`(stash|commit), `CommitForm.tsx:33`(commit).
3. **`CommitForm.tsx` 전문 확인**(43줄) — 라벨 `저장 메시지 <Badge>commit</Badge>`, 힌트 `<p className="commit-form__hint">비워 두고 저장하면 위 제안 문구로 저장돼요</p>`, 버튼 `저장하기 — {allowEmpty && stagedCount === 0 ? '합치기 마무리' : `${stagedCount}개 파일`}`. `commit-form.css`의 카드 크롬(테두리+그림자+radius-lg)과 `textarea:focus { outline: 2px solid var(--color-focus) }` 확인.
4. **좌측 두 목록의 반반 분할은 `layout.css:200`의 `.app__left > .changes-panel { flex: 1; min-height: 0 }`**이고 `.changes-panel` 자체는 `flex-direction: column`이다(내부에 Panel 2개가 아니라, ChangesPanel 컴포넌트가 두 번 렌더된다 — App 실독으로 확정할 것).
5. **행 액션 문구**: `ChangesPanel.tsx:258` `변경 취소 ({validChecked.length})` 형태. 확인창 `confirmLabel="변경 취소"`(314·372행)는 파괴적 동작 라벨이라 유지 대상.
6. **어휘 사용량**: `실험 공간` 59 · `보관함` 37 · `백업` 22 · `받아오기` 17 · `합치기` 16 · `지금 여기` 14. E2E 단언 154회(`저장` 계열 108).

**플랜 명시 미확정(실독·같은 취지·편차 보고):** App.tsx가 ChangesPanel을 두 번 렌더하는 방식과 각 title/termBadge 인자, `--color-focus`·`--color-accent` 실값, ReviewDetailPanel·ConflictPanel의 문구 맥락, notice/에러 문구에 박힌 어휘 위치.

---

### Task 1: 용어 사전 모듈 + 단위 테스트

**Files:**
- Create: `apps/desktop/src/renderer/src/terms.ts`
- Test: `apps/desktop/test/terms.test.ts`

- [x] **Step 1: Red — 사전 무결성 테스트.** `apps/desktop/test/terms.test.ts` 신규:

```ts
import { describe, expect, it } from 'vitest'
import { T } from '../src/renderer/src/terms'

describe('용어 사전 (E8)', () => {
  it('모든 값이 비어 있지 않다', () => {
    for (const [key, value] of Object.entries(T)) {
      expect(value, `빈 값: ${key}`).not.toBe('')
    }
  })

  it('같은 라벨이 두 키에 붙지 않는다(툴팁·E2E 단언이 모호해진다)', () => {
    const values = Object.values(T)
    expect(new Set(values).size).toBe(values.length)
  })

  it('핵심 어휘가 개발자 표준이다', () => {
    expect(T.commit).toBe('커밋')
    expect(T.branch).toBe('브랜치')
    expect(T.stash).toBe('스태시')
    expect(T.merge).toBe('병합')
    expect(T.push).toBe('푸시')
    expect(T.conflict).toBe('충돌')
  })
})
```

- [x] **Step 2: Red 확인** — `npx vitest run apps/desktop/test/terms.test.ts` 실행, 모듈 없음으로 실패.

- [x] **Step 3: 구현.** `apps/desktop/src/renderer/src/terms.ts` 신규:

```ts
/**
 * 화면 어휘 사전 (E8) — 개발자 표준 용어 한 벌.
 *
 * 왜 모으는가: 이 앱은 원래 "쉬운 말"(저장하기·실험 공간·보관함)을 썼고, 나중에 그것을
 * 다시 모드로 되살릴 계획이다. 문구를 컴포넌트에 하드코딩하면 그때 200곳을 다시 고쳐야 한다.
 * 여기 모아 두면 두 번째 표 + 토글로 끝난다.
 *
 * 넣는 것: 화면에 보이는 어휘·짧은 라벨(버튼·탭·패널 제목).
 * 넣지 않는 것: 안내 문장·확인창 본문 — 문장은 리터럴로 두고 그 안의 어휘만 보간한다
 * (문장까지 키로 만들면 i18n 시스템 규모가 된다 — YAGNI).
 */
export const T = {
  // 변경·커밋
  commit: '커밋',
  commitMessage: '커밋 메시지',
  unstaged: '변경 사항',
  staged: '스테이지',
  diff: 'Diff',
  // 브랜치·이력
  branch: '브랜치',
  history: '커밋 히스토리',
  head: '현재 위치',
  detached: '분리 HEAD',
  tag: '태그',
  // 원격
  pull: '가져오기',
  push: '푸시',
  fetch: '페치',
  noUpstream: '업스트림 없음',
  pullRequest: '풀 리퀘스트',
  // 통합 작업
  merge: '병합',
  rebase: '리베이스',
  conflict: '충돌',
  revert: '되돌리기',
  undoCommit: '마지막 커밋 취소',
  cherryPick: '체리픽',
  // 보관·워크트리
  stash: '스태시',
  worktree: '워크트리',
  prunable: '정리 대상',
  checkoutFile: '이 파일만 체크아웃',
} as const

/** 사전 키 — 잘못된 키 참조를 컴파일 타임에 막는다 */
export type TermKey = keyof typeof T
```

- [x] **Step 4: Green 확인** — `npx vitest run apps/desktop/test/terms.test.ts` 3건 통과.

- [x] **Step 5: 게이트** — 루트 `pnpm test` → **523(520+3 — 실측 보고)**, `pnpm typecheck` 전부 Done.

- [x] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/terms.ts apps/desktop/test/terms.test.ts
git commit -m "feat(desktop): E8 용어 사전 모듈 — 개발자 어휘 한 벌(쉬운 모드는 후속 표로)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Task 1 실행 편차 (소급 기록 — 리뷰 검증 완료):** 없음(2파일 byte-match, 값 중복 0, 523 실측 일치). **리뷰 실측 인계(Task 2 필독):** `저장` 총 516곳 중 `저장소`(repository)가 **94곳(18.2%)** — 렌더러 162곳 중 23곳, main 19곳 중 13곳(68%!). 추가로 **커밋이 아닌 `저장`(설정 영속화) 7곳**(`App.tsx:75,172`·`ui/theme.ts:3`·`SettingsDialog.tsx:26`·`dock-height.ts:10`·`column-resize.ts:9`·`worktree-select-action.ts:3`)이 주석에 있다 — 기계 치환 금지. **리뷰 Minor(Task 2 처리):** `T.diff='Diff'` 채택 시 `DiffView.tsx:107`의 `변경 내용이 없어요`도 함께 정리 · `checkoutFile` 단일 키로는 3변형(삭제됨/스태시 꺼내 적용/일반)의 "꺼내" 구분이 사라지므로 **문장 변형은 유지하고 어휘만 보간** · `revert`는 discard(`변경 취소`)·abort(`되돌리기 취소`)와 읽기 혼동이 있어 Task 3에서 툴팁 `되돌리기 (revert)`를 반드시 붙일 것.

---

### Task 1-보완: `head` 값 단축 (품질 리뷰 Important)

리뷰 실측: `head: '현재 위치(HEAD)'`(11자)는 현행 `지금 여기`(5자)의 2배 이상인데, 쓰이는 자리가 **줄지 않는 배지**다(`history-item__here`가 `flex: none`). 부모는 `overflow: hidden`이고 형제 ref 배지는 `flex: 0 1 auto`, 그 뒤가 커밋 제목이라 **+48px이 곧바로 ref 배지·제목에서 빠진다**(CSS 주석이 "제목이 최우선 생존자"라고 적은 의도와 충돌). 스펙 ②의 "영문 병기는 툴팁으로만" 규칙과도 어긋난다(`revert`·`undoCommit`은 괄호를 뺐는데 `head`만 남겼다).

**Files:** `apps/desktop/src/renderer/src/terms.ts` · `apps/desktop/test/terms.test.ts`

- [x] **Step 1: 값 교체** — `head: '현재 위치(HEAD)'` → `head: '현재 위치'`. 영문 병기는 Task 3에서 툴팁(`현재 위치 (HEAD)`)으로 붙인다.

- [x] **Step 2: 게이트** — `npx vitest run apps/desktop/test/terms.test.ts` 3건 통과(값 중복 없음 유지 확인), 루트 `pnpm test` **523 유지**, typecheck.

- [x] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/src/terms.ts
git commit -m "fix(desktop): E8 보완 — head 값 단축(배지 폭 잠식 방지·영문 병기는 툴팁으로)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Task 1-보완 실행 편차:** 없음(1줄 교체, 사전 무결성 유지).

---

### Task 2: 화면 어휘 전환 (사전 참조로)

**Files:**
- Modify: 렌더러 전역(아래 목록) — 어휘가 박힌 모든 컴포넌트
- Modify: `apps/desktop/e2e/smoke.spec.ts` (문구 단언)

- [x] **Step 1: E2E import 가능 여부 확인(먼저).** smoke.spec.ts 상단에 `import { T } from '../src/renderer/src/terms'`를 추가하고 아무 테스트에서 `T.commit`을 참조하도록 임시 수정한 뒤 `npx playwright test e2e/smoke.spec.ts -g "커밋"` 계열 1건만 돌려 **모듈 해석이 되는지** 확인한다. 실패하면 E2E는 리터럴을 쓰고(사전 미사용) **편차 보고** — 이후 Step 4를 리터럴 교체로 수행한다.

- [x] **Step 2: 어휘 교체(화면).** 아래 매핑대로 전 파일을 바꾼다. **짧은 라벨은 `T.x` 참조**, 문장 속 어휘는 `${T.x}` 보간:

| 지금 | 바꿀 말 | 키 |
| --- | --- | --- |
| 저장하기 / 저장(명사) | 커밋 | `T.commit` |
| 저장 메시지 | 커밋 메시지 | `T.commitMessage` |
| 지금 바뀐 것 | 변경 사항 | `T.unstaged` |
| 저장 예정 | 스테이지 | `T.staged` |
| 실험 공간 | 브랜치 | `T.branch` |
| 보관함 | 스태시 | `T.stash` |
| 합치기 | 병합 | `T.merge` |
| 받아오기 | 가져오기 | `T.pull` |
| 백업 | 푸시 | `T.push` |
| 원격 새로고침 | 페치 | `T.fetch` |
| 저장된 역사 | 커밋 히스토리 | `T.history` |
| 지금 여기 | 현재 위치 | `T.head` |
| 겹침 | 충돌 | `T.conflict` |
| 재배치 | 리베이스 | `T.rebase` |
| 분리됨 | 분리 HEAD | `T.detached` |
| 없어진 폴더 | 정리 대상 | `T.prunable` |
| 연결 없음 | 업스트림 없음 | `T.noUpstream` |
| 리뷰 요청 | 풀 리퀘스트 | `T.pullRequest` |
| 변경 내용(패널 제목) | Diff | `T.diff` |
| 이 파일만 적용 | 이 파일만 체크아웃 | `T.checkoutFile` |
| 마지막 저장 실행취소 | 마지막 커밋 취소 | `T.undoCommit` |
| 이 저장만 가져오기 | 체리픽 | `T.cherryPick` |
| 되돌리기(revert 계열) | 되돌리기 | `T.revert` |
| 태그 | 태그 | `T.tag` |
| 워크트리 | 워크트리 | `T.worktree` |

문장은 구조를 유지한 채 어휘만 바꾼다. 예:
- `'다른 곳에 합쳐진 저장은 남아요…'` → `` `다른 곳에 ${T.merge}된 ${T.commit}은 남아요…` `` (조사는 자연스럽게 손본다)
- `'"${name}" 실험 공간을 지웠어요.'` → `` `"${name}" ${T.branch}를 지웠어요.` ``

**주의**: `저장`은 156곳으로 가장 많지만 `저장소`(repository)·`저장 위치` 등 **다른 뜻**이 섞여 있다 — 기계적 치환 금지. 커밋을 뜻하는 곳만 바꾼다.

- [x] **Step 3: testid는 건드리지 않는다.** `data-testid`(예: `commit-button`·`branch-row-*`)는 어휘와 무관한 계약이다. 하나도 바꾸지 말 것(바꾸면 E2E 154곳 외에 추가 파장이 생긴다).

- [x] **Step 4: E2E 문구 단언 전환.** Step 1이 성공했으면 `getByText('저장하기')` → `getByText(T.commit)` 식으로 **어휘 단언만** 사전 참조로 바꾼다(문장 단언은 새 문장 리터럴로 갱신). Step 1이 실패했으면 전부 새 리터럴로.

- [x] **Step 5: 게이트** — typecheck Done, 루트 `pnpm test` 유지, build, `npx playwright test e2e/smoke.spec.ts` → **86 유지**(포그라운드 동기, **Bash timeout 파라미터 600000 필수**). 깨지는 테스트는 원인 수정(비활성·삭제 금지).

- [x] **Step 6: Commit**

```bash
git add apps/desktop/src apps/desktop/e2e/smoke.spec.ts
git commit -m "refactor(desktop): E8 화면 어휘를 개발자 표준으로 — 사전 참조 전환

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Task 2 실행 편차 (소급 기록 — 리뷰 검증 완료):** ① 파일 범위 확장 — `e2e/hosting.spec.ts`·`test/branch-badges.test.ts` 동반 수정(`branch-badges.ts`가 `'연결 없음'`을 **반환하는 실코드**였다). ② 보간으로 받침이 바뀌며 틀어진 조사 5곳 교정. ③ cherry-pick 문구를 전부 `T.cherryPick`으로 통일(`T.pull`(가져오기)과 겹쳐 혼동되던 것 해소). ④ `checkoutFile`은 3변형(삭제됨/스태시 "꺼내"/일반) 구분 보존을 위해 리터럴 유지 — 결과적으로 키가 미사용. ⑤ ConflictPanel의 "저장"은 **파일 편집 저장**(git commit 아님)이라 미변경. ⑥ 단일 커밋 23파일(플랜이 허용한 분할을 쓰지 않음).

**리뷰 실측:** `저장소` 오치환 **0건** · 설정 영속 주석 7곳 보존 · testid 변경 0 · E2E `expect(` 376→376·`toContainText|toHaveText` 197→197(강도 유지) · 매핑표 25행 전부 최소 1회 사용. **다만 Important 4건 발견 → Task 2-보완.**

---

### Task 2-보완: E2E 사전 참조·조사·잔여 어휘·업스트림 일관 (품질 리뷰 Important 4건)

- **I-1 스펙 ① 절반 미이행 + 죽은 import**: `smoke.spec.ts:8`에 `import { T } from '../src/renderer/src/terms'`를 넣어 놓고 **`T.` 사용 0회** — 47곳 전부 새 리터럴로 바꿨다. 사전을 도입한 이유(다음 어휘 전환 때 테스트를 안 고쳐도 됨)가 E2E 쪽에서 무효가 됐고, `apps/desktop/tsconfig.json`의 `include: ["src"]` 때문에 e2e는 타입체크 범위 밖이라 **죽은 import가 영원히 안 걸린다**.
- **I-2 조사 오류 9곳**(받침 없는 값에 받침용 조사): AddWorktreeDialog `:86`(2곳)·`:113`, BranchesPanel `:384`, ShelfPopover `:55`, ReviewPopover `:85`·`:127`·`:142`·`:156`.
- **I-3 매핑표 1행(`저장→커밋`) 15곳 누락**: `저장 안 된 변경` 11곳(repository-store.ts `:512,523,524,545,701,743,784,804,847,997,1032`) + `미저장 변경` 4곳(App.tsx `:517,541,1257`·CommitDetailPanel.tsx `:300`). `repository-store.ts:512`는 **한 문장 안에서** `저장 안 된 변경이 ${T.conflict}해서 ${T.stash}에` — 혼재가 즉시 보인다.
- **I-4 `연결 끊김` 비일관**: 같은 함수에서 `upstream === null → '업스트림 없음'`(전환됨) 옆에 `upstreamGone → '연결 끊김'`(쉬운말)이 나란히 있어 다른 개념처럼 읽힌다.

**Files:** `apps/desktop/e2e/smoke.spec.ts` · `components/AddWorktreeDialog.tsx`·`BranchesPanel.tsx`·`ShelfPopover.tsx`·`ReviewPopover.tsx` · `store/repository-store.ts` · `App.tsx` · `components/CommitDetailPanel.tsx` · `components/branch-badges.ts` · `test/branch-badges.test.ts`

- [x] **Step 1: I-1 — E2E 47곳을 사전 참조로.** `smoke.spec.ts`에서 어휘 리터럴(`'커밋'`·`'브랜치'`·`'스태시'`·`'충돌'`·`'병합'`·`'푸시'`·`'가져오기'` 등 사전 값과 정확히 같은 문자열)을 `T.x`로 바꾼다. **문장 단언은 그대로 리터럴 유지**(사전에 없는 것). 바꾼 뒤 `import { T }`가 실제로 쓰이는지 확인한다.

- [x] **Step 2: I-2 — 조사 9곳 교정.** 위 목록대로 `을→를`·`은→는`·`이→가`로. 받침 규칙: `브랜치`·`풀 리퀘스트`·`체리픽`·`스태시`는 받침 없음, `커밋`·`병합`·`푸시`(ㅣ)·`충돌`은 있음/없음이 섞이니 **각 문장을 눈으로 확인**할 것.

- [x] **Step 3: I-3 — 잔여 15곳.** `저장 안 된 변경` → `커밋 안 된 변경`(11곳), `미저장 변경` → `커밋 안 된 변경`(4곳). 문장 안에서 `${T.commit}` 보간이 자연스러운 자리면 보간을 쓴다.

- [x] **Step 4: I-4 — 업스트림 어휘 통일.** `branch-badges.ts`의 `'연결 끊김'` → `'업스트림 삭제됨'`(git `[gone]` = 원격에서 upstream ref가 사라짐). 짝이 되는 툴팁 2곳도: `BranchesPanel.tsx:260` `원격에서 사라진 연결. 푸시하면 다시 만들어져요` → `업스트림이 원격에서 사라졌어요. 푸시하면 다시 만들어져요`, `:261` `아직 원격과 연결 안 됨` → `아직 업스트림 없음`. **`test/branch-badges.test.ts`와 `smoke.spec.ts:1323`의 정규식 단언도 함께 갱신**(강도 유지).

- [x] **Step 5: Minor 3건.** ① 미사용 키 `checkoutFile`을 사전에서 제거하거나 3변형의 공통부에 쓴다(택일·편차 보고). ② `App.tsx:797` 주석이 사라진 어휘(`이 저장만 가져오기`)를 근거로 대고 있다 — 근거를 `체리픽`으로 갱신. ③ `ReviewPopover.tsx:138` `이 {T.branch} {T.pullRequest}하기` → `이 {T.branch}로 {T.pullRequest} 만들기`.

- [x] **Step 6: 게이트** — typecheck, 루트 `pnpm test` **523 유지**, build, `pnpm --filter @git-gui/desktop e2e` **92 유지**(포그라운드 동기, **Bash timeout 파라미터 600000 필수**).

- [x] **Step 7: 잔여 확인(수치 보고)** — `저장`(커밋 의미)·`실험 공간`·`보관함`·`백업`·`받아오기`·`겹침`·`지금 여기`의 **사용자 문자열** 잔여를 전수 grep해 0인지 보고한다(주석·`저장소`·파일 저장은 제외). `T.` 사용 횟수도 함께 보고.

- [x] **Step 8: Commit**

```bash
git add apps/desktop/src apps/desktop/e2e apps/desktop/test
git commit -m "fix(desktop): E8 보완 — E2E 사전 참조 전환·조사 9곳·잔여 어휘 15곳·업스트림 어휘 통일

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Task 2 리뷰 Minor 후속 노트(기록만):** `기본 공간`·`이 공간`·`그 공간` 등 `공간` 축약형이 App·BranchesPanel·ManageBranchesDialog에 다수 남아 있다(매핑표에 없던 형태) — 어휘 전환이 반쯤 걸친 인상을 준다. 별도 후속으로 `브랜치`계 표현으로 정리할 것.

**Task 2-보완 실행 편차 (소급 기록 — 리뷰 재검 Approve):** ① hosting.spec.ts는 T import가 없어 죽은 import 문제가 없으므로 전환 대상 아님. ② `checkoutFile`은 공통부 재사용이 아니라 **키 제거**를 택함(3변형이 서로 다른 수식어를 품음 — 근거 주석 잔존). ③ `미저장 변경` 문구 변경이 플랜에 없던 E2E 단언 1건을 추가로 깨뜨려 동반 수정. **재검 실측:** `T.` 58회 전부 단언/로케이터 인자(주석·조립 0), numstat 53+/53− 완전 대칭으로 1:1 치환·**약화 0건**, 조사 288곳 역방향 스윕 오류 0, `업스트림 삭제됨`이 배지·툴팁 2·단위·E2E 4면 일관, 렌더러 사용자 문자열 잔여 쉬운말 0. **관찰(후속):** `new RegExp(T.head)`는 사전 값에 정규식 메타문자가 없다는 전제 — 쉬운 모드 표 추가 시 확인 필요.

---

### Task 2-B: 엔진 사용자 문구 어휘 정리 (품질 리뷰 Important — 어휘 혼재 차단)

리뷰 실측: `packages/git-adapter/src/client.ts` 등 **엔진이 사용자에게 그대로 보이는 한글 문구를 던진다** — `겹침(!)을 모두 정리해야 저장할 수 있어요.`(client.ts:1289) · `아직 저장된 시점이 없어요. 먼저 저장(commit)한 뒤 백업해 주세요.`(:1174) · `원격에 새 저장이 있어요. 먼저 받아오기(pull)로 합친 뒤 백업해 주세요.`(:300) · `저장 예정에 올린 파일이 있어요…`(:1557). packages 잔존량: `보관함` 33 · `실험 공간` 26 · `백업` 17 · `겹침` 15 · `받아오기` 9. **그대로 두면 버튼은 "커밋"인데 알림은 "저장 예정"이 되는 혼재**가 생긴다.

**설계 결정**: 엔진은 렌더러의 `terms.ts`를 import하지 않는다(계층 역전). 대신 **엔진 문구는 리터럴로 개발자 어휘에 맞춘다**. 쉬운 모드가 생기면 엔진 메시지는 렌더러에서 매핑하는 별도 과제로 남긴다(후속 노트).

**Files:** `packages/git-adapter/src/client.ts` 외 사용자 문구가 있는 packages 파일(실독 — `throw new Error('…한글…')` 전수)

- [x] **Step 1: 전수 조사.** `grep -rn "Error('.*[가-힣]" packages/*/src` 로 사용자 노출 문구를 모두 찾아 목록화한다(테스트가 문구를 단언하는 곳도 함께 — `grep -rn "toThrow" packages/*/test | grep [가-힣]`).

- [x] **Step 2: 어휘 교체.** Task 2와 **같은 매핑표**를 적용하되 리터럴로 바꾼다. 예:
  - `겹침(!)을 모두 정리해야 저장할 수 있어요.` → `충돌(!)을 모두 정리해야 커밋할 수 있어요.`
  - `아직 저장된 시점이 없어요. 먼저 저장(commit)한 뒤 백업해 주세요.` → `아직 커밋이 없어요. 먼저 커밋한 뒤 푸시해 주세요.`
  - `원격에 새 저장이 있어요. 먼저 받아오기(pull)로 합친 뒤 백업해 주세요.` → `원격에 새 커밋이 있어요. 먼저 가져오기로 병합한 뒤 푸시해 주세요.`
  - `저장 예정에 올린 파일이 있어요…` → `스테이지에 올린 파일이 있어요…`
  - **`저장소`(repository)는 건드리지 않는다** — 리뷰 실측: packages의 `저장` 225곳 중 `저장소`가 53곳(23.6%)이다.

- [x] **Step 3: 문구를 단언하는 테스트 갱신.** git-adapter 단위 테스트가 옛 문구를 `toThrow(...)`로 단언하는 곳을 새 문구로 갱신한다(같은 강도 유지 — 단언 삭제 금지).

- [x] **Step 4: 게이트** — `npx vitest run packages/git-adapter/test/client.test.ts` 전건, 루트 `pnpm test` **523 유지**, typecheck, build, smoke **86 유지**(포그라운드 동기, Bash timeout 600000 필수 — 엔진 문구를 단언하는 E2E가 있으면 함께 갱신·편차 보고).

- [x] **Step 5: Commit**

```bash
git add packages
git commit -m "refactor(git-adapter): E8 엔진 사용자 문구를 개발자 어휘로 — UI와 어휘 혼재 차단

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Task 2-B 실행 편차 (리뷰 검증 완료):** ① 범위가 `client.ts`의 `throw new Error(...)` 리터럴을 넘어 **stash 자동 보관 메시지 상수 7개**(`AUTO_SHELF_MESSAGE` 등 — `-m` 인자로 `git stash push`에 실제로 들어가 ShelfPopover에 표시되는 사용자 문구)와 **`packages/hosting/src/github.ts`의 `toFriendlyMessage`/`pullNotFound`/인라인 에러 매퍼 반환 문자열 8곳**(리뷰 요청→풀 리퀘스트, 겹침(충돌)→충돌)까지 포함했다 — 둘 다 "엔진이 사용자에게 그대로 보이는 한글 문구"이지 comment가 아니다. ② `보관(하다)`은 명사형 매핑표에 없어 동사 활용을 새로 정했다 — `보관함`(명사)은 `스태시`, `보관하다`(동사)는 `스태시하다`. ③ cherry-pick 관련 엔진 문구의 `가져오다`(범용 동사, T.pull "가져오기"와 겹침)는 Task 2-보완 I-3의 선례(체리픽 통일)를 따라 전부 `체리픽`으로 교체했다(`지금은 가져오는 중이 아니에요` → `지금은 체리픽 중이 아니에요` 등 3곳) — 매핑표에 명시되진 않았지만 태스크의 핵심 목표(어휘 혼재 차단)와 정확히 같은 방향이라 판단했다. ④ **문장 안에서만 등장하는 `저장`(commit 의미) 6곳**을 매핑표 예시 밖에서 추가로 찾아 바꿨다(`맨 처음 저장은/가장 최근 저장이/반영되어 있는 저장이에요` 등). ⑤ `client.ts:946`의 `겹치는 부분이 있어`(형용사절)는 매핑표의 명사 `겹침`이 아니라서 원문 유지, `보관함에도` 부분만 `스태시에도`로 교체 — 편차 아님(스코프 판단 기록).
**리뷰 실측:** 저장소 오치환 0건 · `packages/git-adapter/test/client.test.ts` 186/186 · `packages/hosting/test/github.test.ts` 20/20 · 루트 `pnpm test` 523/523 유지 · typecheck 전부 Done · build 성공 · `pnpm --filter @git-gui/desktop e2e` 92/92 유지(smoke 86 + hosting 6) · Note 5(렌더러 문구 부분 매칭) 전수 조사 — `apps/desktop/src` 전체에서 `.includes('[가-힣]`) 패턴은 `hosting-handlers.ts`의 `'연결이 만료됐어요'` 2곳뿐이며 이번 변경과 무관(미변경 문구) — **분기 깨짐 없음**.

**후속 노트:** 쉬운 모드를 만들 때 엔진 메시지는 사전으로 못 덮는다(계층). 렌더러에서 메시지 매핑 계층을 두거나, 엔진이 코드+파라미터를 던지고 렌더러가 문장을 만드는 구조로 바꿔야 한다 — 이번 범위 밖.

**Task 2-B 실행 편차 (소급 기록 — 리뷰 검증 완료):** ① 범위 확장 — throw 리터럴 외에 **stash 자동 보관 메시지 상수 7개**(`git stash push -m`으로 실제 커밋돼 ShelfPopover에 표시)와 `packages/hosting/src/github.ts` 매퍼 반환 **5곳**(보고의 8곳은 부정확)도 포함. ② `보관하다`(동사) → `스태시하다`. ③ cherry-pick 문맥의 `가져오다` 3곳 → `체리픽`. ④ 매핑표 밖 `저장`(commit) 6곳 추가 교체. ⑤ **문구 매칭 분기 없음 확인** — 리뷰 독립 재검: 한글 문자열을 `includes/startsWith/match/===`로 분기하는 곳은 `hosting-handlers.ts:139,155`(`'연결이 만료됐어요'`) 2곳뿐이고 그 문구의 생산지 `github.ts:70`은 **손대지 않았다**(정확한 판단). ⑥ 최초 grep 누락 8곳을 테스트 실행으로 발견·수정. ⑦ `겹치는 부분이 있어`(형용사절)는 원문 유지.

**리뷰 실측:** stash 상수는 **쓰기 8곳·읽기 0곳**이고 `parseShelfMessage`는 git 접두사만 파싱 → **기존 스태시 호환성 문제 없음**(옛 문구 스태시도 그대로 표시, `refs-parser.test.ts`의 옛 형식 픽스처가 통과하는 것이 방증). 테스트 46/46·6/6 전부 1:1 치환, 삭제·약화 0. 조사·활용 38문구 전부 정확. **다만 범위 구멍 발견 → Task 2-C.**

**후속 노트(기록만):** `hosting-handlers.ts`의 `includes('연결이 만료됐어요')` 분기에 **테스트가 없다** — `github.ts:70`을 나중에 고치면 gh CLI·토큰 재연결이 조용히 깨진다.

---

### Task 2-C: main 프로세스 문구 (품질 리뷰 Important — 범위 구멍)

리뷰 발견: `apps/desktop/src/main/hosting-handlers.ts`가 **렌더러(Task 2)와 packages(Task 2-B) 사이 구멍**에 있어 어느 태스크도 다루지 않았다. 이 파일의 문구도 IPC → `toErrorMessage` → 알림 배너로 **packages 문구와 똑같은 경로**로 사용자에게 간다. 결과: 같은 PR 흐름에서 `github.ts`는 **풀 리퀘스트**, 핸들러는 **리뷰 요청**이라고 말한다 — 이 태스크가 막으려던 혼재 그 자체.

**Files:** `apps/desktop/src/main/hosting-handlers.ts` · `packages/git-adapter/src/client.ts` · `apps/desktop/src/renderer/src/components/ShelfPopover.tsx`

- [x] **Step 1: main 문구 4곳.**
  - `:190` `지금은 실험 공간이 아닌 시점에 있어요. 실험 공간으로 이동한 뒤…` → `지금은 브랜치가 아닌 시점(분리 HEAD)에 있어요. 브랜치로 이동한 뒤…`
  - `:195` `진행 중인 작업(합치기·되돌리기)` → `진행 중인 작업(병합·되돌리기)`
  - `:202` `모두가 함께 쓰는 기본 공간이에요. 실험 공간(branch)을 만들어…` → `모두가 함께 쓰는 기본 브랜치예요. 새 브랜치를 만들어…`
  - `:225` `리뷰 요청 주소를 찾지 못했어요. 리뷰 목록을…` → `풀 리퀘스트 주소를 찾지 못했어요. 풀 리퀘스트 목록을…`
  **`:139`·`:155`의 `includes('연결이 만료됐어요')`와 그 생산지 `github.ts:70`은 절대 건드리지 말 것**(분기가 문자열에 의존하고 테스트가 없다).

- [x] **Step 2: Minor 2건.** `client.ts:432`의 `가져오기로 합쳐 주세요` → `가져오기로 병합해 주세요`(같은 커밋에서 `:300`은 이미 병합으로 바뀌었는데 여기만 누락). `ShelfPopover.tsx:50`의 버튼 `지금 변경 보관하기` → `지금 변경 스태시하기`(누르면 엔진이 `스태시할 변경이 없어요`라고 답해 어휘가 어긋난다).

- [x] **Step 3: Nit 2건.** `client.ts:837` `지금은 병합하는 중이 아니에요` → `지금은 병합 중이 아니에요`(형제 문구 `리베이스 중`·`체리픽 중`과 평행). `client.ts:1533` `맨 처음 커밋은 실행취소할 수 없어요` → `맨 처음 커밋은 취소할 수 없어요`(UI의 `마지막 커밋 취소`와 어휘 일치).

- [x] **Step 4: 게이트** — `npx vitest run packages/git-adapter/test/client.test.ts` 전건, 루트 `pnpm test` **523 유지**, typecheck, `pnpm --filter @git-gui/desktop e2e` **92 유지**(포그라운드 동기, Bash timeout 600000 필수). 문구를 단언하는 테스트가 있으면 같은 강도로 갱신.

- [x] **Step 5: 잔여 확인** — `apps/desktop/src/main`·`packages/*/src`의 **사용자 노출 문자열**에 쉬운말(`실험 공간`·`보관함`·`합치기`·`백업`·`받아오기`·`리뷰 요청`·`겹침`)이 0인지 전수 grep해 보고(주석 제외).

- [x] **Step 6: Commit**

```bash
git add apps/desktop/src/main/hosting-handlers.ts packages/git-adapter/src/client.ts apps/desktop/src/renderer/src/components/ShelfPopover.tsx
git commit -m "fix: E8 보완 — main 프로세스 문구 어휘 통일(리뷰 요청↔풀 리퀘스트 혼재 차단)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

**Task 2-C 실행 편차 (소급 기록):** ① 지시에 없던 테스트 단언 2건(`client.test.ts:736`·`:1700`)이 문구를 정규식으로 물고 있어 1:1 갱신(삭제·약화 0). ② `ShelfPopover.tsx:50`은 파일이 이미 `T.stash`를 쓰고 있어 리터럴 대신 `지금 변경 {T.stash}하기`로 관용 일치. ③ 주석 2곳(`:198`·`:205`)도 같이 갱신 — 문구와 주석이 다른 어휘로 남으면 다음 사람이 헷갈린다.

**게이트 실측:** git-adapter 186/186 · 루트 **523/523** · typecheck 6/6 · E2E **92/92**(3.2분 포그라운드). `'연결이 만료됐어요'` 3곳(`github.ts:70`, `hosting-handlers.ts:139`·`:155`) grep으로 무변경 확인.

**잔여 발견 → Task 3으로 이월:** ① `client.ts:1528` `…실행취소할 수 있어요` (같은 함수의 `:1538`만 지시에 있었다) ② **`ReviewPopover.tsx`가 Task 2에서 누락** — 컨트롤러 실측 확인: `:142` `기본 공간`(방금 고친 `hosting-handlers.ts:202`의 렌더러 쪽 쌍둥이 가드가 **서로 다른 어휘로 말한다**), 헤더 버튼 라벨·툴팁·aria-label `리뷰`(팝오버 본문은 `풀 리퀘스트`), `hosting.spec.ts:323`·`:473`이 `기본 공간`을 단언해 게이트가 이 불일치를 잡지 못했다.

---


### Task 3: 영문 개념 배지 제거 + 툴팁 이관

**Files:**
- Modify: 사전 실측 2의 16곳 중 **개념 배지 14곳**(개수·상태 배지는 유지)
- Modify: `apps/desktop/e2e/smoke.spec.ts` (배지 문자열을 단언하는 곳이 있으면)


- [x] **Step 0: Task 2-C 이월분 (어휘 누락 — 이 태스크가 헤더·배지를 어차피 건드린다)**

  - `apps/desktop/src/renderer/src/components/ReviewPopover.tsx:142` — `"{currentBranch}"는 모두가 함께 쓰는 기본 공간이에요.` → `…기본 브랜치예요.` **main 프로세스의 같은 가드(`hosting-handlers.ts:202`)가 이미 `기본 브랜치`라 지금은 한 가드가 두 목소리로 말한다.** 이어지는 `{T.branch}(branch)를 만들어…`의 영문 병기는 아래 배지 제거 규칙대로 툴팁으로 옮기거나 지운다.
  - 같은 파일 `:68`·`:74`·`:76` — 툴팁 content/summary·`aria-label`·버튼 라벨이 모두 `리뷰`. 팝오버 본문은 전부 `{T.pullRequest}`라 헤더와 내용이 어긋난다. 라벨은 `{T.pullRequest}`로 통일하되, **헤더 폭이 늘어나면 E7k compact 임계(1180)에서 잘리는지 반드시 실측**하고 잘리면 라벨만 짧게(`PR` 금지 — 배지 제거 취지와 충돌) 조정 근거를 보고한다.
  - 같은 파일 `:85`·`:126`의 `(pull request)`·`(push)` 인라인 영문 병기 — 이 태스크의 배지 제거 규칙과 같은 취지이므로 함께 정리.
  - `apps/desktop/e2e/hosting.spec.ts:323`·`:473`이 `toContainText('기본 공간')`을 단언한다 → 사전 참조로 1:1 갱신(삭제·약화 금지). 이 단언이 옛 문구에 맞춰져 있어 92건 게이트가 불일치를 못 잡았다.
  - `packages/git-adapter/src/client.ts:1528` — `지금 진행 중인 작업을 먼저 마무리하거나 취소해야 실행취소할 수 있어요.` → `…취소할 수 있어요.` (같은 함수의 `:1538`은 Task 2-C에서 이미 정리했다).

- [x] **Step 1: 제거 대상 확정.** `tone="git"` 16곳 중 다음을 **제거**한다 — App(merge·pull·push), ReviewPopover(PR), HistoryPanel(log), ConflictPanel(conflict), ShelfPopover(stash), BranchesPanel(compare·branch), ChangesPanel(`{termBadge}`), ReviewDetailPanel(approve·merge), DiffPanel(diff), WorktreesPanel(worktree), CommitDetailPanel(stash|commit), CommitForm(commit → Task 4에서 폼과 함께). **유지**: `tone="count"` 전부, ref 배지, 상태 배지(진행 중 작업·충돌 표시).

- [x] **Step 2: 원어를 툴팁으로.** 배지를 지운 버튼·패널 제목 중 **원어가 도움이 되는 것**은 E7j `Tooltip`으로 감싸 `<한글> (<원어>)` 형태를 남긴다. 대상과 문구:

```
합치기 버튼 → `병합 (merge)`      가져오기 버튼 → `가져오기 (pull)`
푸시 버튼   → `푸시 (push)`        스태시 트리거 → `스태시 (stash)`
브랜치 패널 → `브랜치 (branch)`    워크트리 패널 → `워크트리 (worktree)`
커밋 히스토리 패널 → `커밋 히스토리 (log)`   Diff 패널 → `Diff (diff)` 는 중복이라 생략
```

(헤더 버튼은 E7k에서 이미 Tooltip으로 감싸져 있다 — `content`만 원어 병기로 바꾼다. 패널 제목은 `ui/Panel.tsx`의 h2가 이미 Tooltip(E7j-보완)이라 그 `content`를 원어 병기로 넘길 수 있게 `Panel`에 선택적 prop `titleHint?: string`을 더한다.)

- [x] **Step 3: `ChangesPanel`의 `termBadge` prop 제거.** 배지가 사라지면 그 prop과 전달부(App 실독)가 죽는다 — 함께 제거한다.

- [x] **Step 4: 게이트** — typecheck, 루트 유지, build, smoke **86 유지**(포그라운드 동기, timeout 600000). 배지 문자열(`unstaged`·`staged`·`merge` 등)을 단언하던 E2E가 있으면 같은 취지로 조정·편차 보고.

- [x] **Step 5: Commit**

```bash
git add apps/desktop/src apps/desktop/e2e/smoke.spec.ts
git commit -m "refactor(desktop): E8 영문 개념 배지 제거 — 원어는 툴팁으로 이관

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

**Task 3 실행 편차 (소급 기록):** ① 배지 제거는 15곳(플랜의 "14곳"은 Task 2-C에서 발견한 ReviewPopover `PR` 이전 집계 — 리뷰 실측 `tone="git"` 부모 16 → HEAD 1). ② `ConflictPanel`의 `conflict`는 **상태 배지가 아니라 개념 배지로 판정해 제거** — `App.tsx:791`이 `conflictFile !== null`일 때만 렌더하고 제목이 이미 `충돌 해결`이라 순수 중복(리뷰 독립 확인). 같은 근거로 `CommitDetailPanel`의 `stash|commit`도 제거. ③ `layout.css`의 `.app__header--compact .ui-button .ui-badge--git { display: none }`가 죽어 함께 제거(남은 1곳 `CommitForm`은 좌측 열 `<label>`이라 헤더에 들어갈 수 없음 — 리뷰 확인). ④ `hosting.spec.ts:473`이 가리키는 원문이 `ReviewPopover`가 아니라 **`App.tsx:1151/1161`의 병합 후 이동 다이얼로그**여서 그쪽도 `기본 브랜치`로 교체 — 단언을 1:1로 고치는 것이 원문 수정 없이는 불가능했다(리뷰: 범위 확장 아님). 조사도 `으로`→`로`(브랜치는 받침 없음). ⑤ `Panel`에 `titleHint?: string` 신설 — 미전달 패널의 동작·`summary`·보이는 `<h2>`는 무변경(리뷰 호버 실측).

**리뷰 실측 (헤더 폭 — 과거 회귀 재발 방지 항목):** 9개 폭(1400/1280/1200/1181/1180/1179/1100/970/900)에서 긴 브랜치명 픽스처로 `getBoundingClientRect()` + `elementFromPoint()` 히트테스트. 전 폭에서 8개 헤더 버튼 모두 `clickable: true · inViewport: true` — `overflow: hidden` 뒤에 잘려 숨은 버튼 없음. 최악은 1180(비compact 최협) `settingsRight=1160`. 라벨 `리뷰`→`풀 리퀘스트`는 `.app__actions` +31px지만 배지 4개 삭제로 **부모보다 오히려 좁아졌다**. compact 경계 1180=false / 1179=true 확인.

**Task 3-보완 (리뷰 Blocking + Important):** ① **Blocking — 헤더 3버튼(`App.tsx:372`·`:400`·`:441`)이 배지만 잃고 툴팁 이관을 못 받았다.** 실측 툴팁이 `병합`·`가져오기`·`푸시`뿐이라 `merge`·`pull`·`push`가 앱 어디에도 남지 않았고, compact(<1180)에서 버튼이 35~36px 아이콘만 되면 툴팁이 **유일한 이름표**라 순손실. → `${T.x} (원어)`로 이관. ② **Important — 플랜 지시 자체가 틀렸다**: `client.ts:1528`의 `실행취소`→`취소` 축자 적용 결과 `취소해야 취소할 수 있어요`(앞 취소=진행 중 작업 중단, 뒤 취소=마지막 커밋 취소)가 됐다. → `되돌려야 마지막 커밋을 취소할 수 있어요`. ③ **Important — `repository-store.ts:1547`**이 이 커밋이 없앤 `기본 공간`과 `${T.pull}(pull)` 인라인 병기를 **같은 PR 병합 흐름에서** 그대로 쓴다(직후 다이얼로그는 `기본 브랜치`라 한 상호작용에 두 이름). 동일 패턴 4곳(`:968`·`SettingsDialog.tsx:106`·`App.tsx:1037`·`:1175`)도 함께 정리. ④ Minor — `ReviewDetailPanel.tsx:151`의 하드코딩 `"승인 (approve)"` → `terms.ts`에 `approve` 키 신설 후 참조.

**게이트 실측(리뷰 재실행):** typecheck 6/6 · 루트 **523** · E2E **92**.

**기록만:** 배지 15개가 사라졌는데 E2E가 한 건도 깨지지 않았다 — 배지 텍스트를 단언한 테스트가 원래 0건이었다(리뷰 전수 확인). 이 커밋의 결함이 아니라 **기존 커버리지 공백**이다.


**Task 3-보완 결과 (`00657f2`):** 헤더 3버튼 툴팁 **실측 재확인** — `병합 (merge)` · `가져오기 (pull)` · `푸시 (push)`(실제 Electron 창 호버 후 `[data-testid="tooltip"]` 판독). `client.ts:1528`은 `되돌려야 마지막 커밋을 취소할 수 있어요`로 정정하고 `:1530` 주석 동기화 — 이 파일은 `T`를 import하지 않아(패키지 레이어) 리터럴 `커밋` 유지가 맞다. `client.test.ts:1731`의 정규식 1건만 갱신(같은 정규식 5건은 revert·cherryPick·reword·restoreFile용 별개 문구라 무변경). 인라인 병기 5곳·`approve` 키 신설 완료. 게이트 6/6 · **523** · **92**.

### Task 4: 커밋 폼 재설계

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/CommitForm.tsx`
- Modify: `apps/desktop/src/renderer/src/components/commit-form.css`

- [x] **Step 1: 컴포넌트 교체.** `CommitForm.tsx`의 return 블록을 다음으로(로직·props는 그대로, `Badge` import 제거):

```tsx
  const reason = busy
    ? '작업 중이에요'
    : stagedCount === 0 && !allowEmpty
      ? `${T.staged}에 올린 파일이 없어요`
      : effectiveMessage.trim().length === 0
        ? `${T.commitMessage}를 적어 주세요`
        : ''

  return (
    <form
      className="commit-form"
      onSubmit={(event) => {
        event.preventDefault()
        // 커밋이 실패하면(훅 거부, 충돌 상태 등) 입력한 메시지를 보존한다
        void onCommit(effectiveMessage).then((committed) => {
          if (committed) setMessage('')
        })
      }}
    >
      <label className="commit-form__label" htmlFor="commit-message">
        {T.commitMessage}
      </label>
      <textarea
        id="commit-message"
        data-testid="commit-message"
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        // 제안 문구가 곧 실제 커밋 문구다 — 상시 회색 안내 줄 대신 placeholder가 그 사실을 말한다
        placeholder={suggestion ? `비워 두면: ${suggestion}` : '무엇을 바꿨는지 적어 주세요'}
        rows={3}
      />
      <div className="commit-form__foot">
        <span className="commit-form__reason" data-testid="commit-hint">
          {reason}
        </span>
        <Button variant="primary" type="submit" isDisabled={disabled} testId="commit-button">
          {allowEmpty && stagedCount === 0 ? `${T.merge} 마무리` : T.commit}
        </Button>
      </div>
    </form>
  )
```

`import { T } from '../terms'` 추가. **`data-testid`는 그대로**(`commit-message`·`commit-hint`·`commit-button`) — 기존 E2E 계약 유지.

- [x] **Step 2: CSS 교체.** `commit-form.css`에서 카드 크롬을 걷고 하단 배치를 만든다. 기존:

```css
.commit-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-1);
  flex: none;
}
```

교체:

```css
/* E8 — 카드 3겹 중첩을 줄인다. 커밋 폼은 좌측 열 하단의 영역이지 또 하나의 카드가 아니다 */
.commit-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-1) 0;
  border-top: 1px solid var(--color-border);
  flex: none;
}
```

포커스 링 기존:

```css
.commit-form textarea:focus {
  outline: 2px solid var(--color-focus);
  outline-offset: 1px;
  border-color: transparent;
}
```

교체:

```css
/* E8 — 2px 링이 폼 전체를 번쩍이게 했다. 얇은 강조 테두리 + 미세 링으로 */
.commit-form textarea:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 1px var(--color-accent);
}
```

`.commit-form__hint` 블록을 다음으로 교체하고 하단 줄을 추가:

```css
/* E8 — 버튼은 우측 정렬 자연폭, 왼쪽엔 못 누르는 사유(색이 아니라 말로 상태를 알린다) */
.commit-form__foot {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  justify-content: flex-end;
}
.commit-form__reason {
  flex: 1;
  min-width: 0;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [x] **Step 3: 강조색 정합 확인.** `ui/button.css`의 `.ui-button--primary`가 쓰는 `--color-accent` 실값이 앱의 보라 계열인지 실독한다. 파랑 계열이면 **토큰은 건드리지 말고**(다른 곳도 쓴다) 이 폼 버튼만 `--concept-branch` 계열로 맞추는 대신, 토큰이 이미 보라면 그대로 둔다 — 어느 쪽인지 **편차로 보고**.

- [x] **Step 4: 게이트** — typecheck, 루트 유지, build, smoke **86 유지**(포그라운드 동기, timeout 600000). 커밋 버튼 라벨(`저장하기 — N개 파일`)을 단언하던 E2E는 Task 2에서 이미 갱신됐어야 한다 — 남아 있으면 여기서 조정·편차 보고.

- [x] **Step 5: 육안 검증(필수).** 프로브로 (a) 비활성 상태에서 사유 문구가 보이는지 (b) 스테이지 후 활성 + 라벨이 `커밋` 한 단어인지 (c) 버튼이 우측 정렬 자연폭인지(폭 < 패널 폭) (d) textarea 포커스 시 링이 얇은지 측정해 수치·문구를 보고한다. 프로브 삭제·워킹트리 클린.

- [x] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/components/CommitForm.tsx apps/desktop/src/renderer/src/components/commit-form.css
git commit -m "feat(desktop): E8 커밋 폼 재설계 — 우측 자연폭 버튼·사유 문구·얇은 포커스 링·카드 크롬 제거

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

**Task 4 실행 편차 (소급 기록):** ① **Step 3의 스펙 전제가 틀렸다** — "지금의 채도 높은 파랑은 앱 어디에도 없는 톤"은 거짓. `tokens.css:44 --color-accent: #2e5ce6`이고 `button.css:22 .ui-button--primary { background: var(--color-accent) }`이며 커밋 버튼은 이미 `variant="primary"`였다. **색조는 애초에 문제가 아니었고 전폭 슬래브 + 문장형 라벨이 문제였다.** 색 토큰·variant 무변경. ② **Trap A(컨트롤러가 사전 경고)** — `commit-hint`가 "조건부 제안 안내 `<p>`"에서 "상시 사유 `<span>`"으로 의미가 바뀌면 `smoke.spec.ts:152`의 `toBeVisible()`이 빈 span(높이 0)에서 실패한다. 구현자 선택: **두 개념을 우선순위 체인의 마지막 분기로 합쳐** 메시지 비움+제안 있음 상태에서 사유 대신 `비워 두고 커밋하면 위 제안 문구로 커밋돼요`를 내고, 단언은 `toBeVisible()` → `toHaveText(정확 문구)`로 **강화**했다(약화 아님). ③ Trap B — placeholder 단언 `'app.txt 수정'` → `'비워 두면: app.txt 수정'` 1:1. ④ `tone="git"` 마지막 소비자가 사라져 `Badge` 타입 유니언과 `.ui-badge--git` 규칙 제거(사전·사후 grep 0건). `--term-badge` 토큰은 `layout.css:123-124`가 아직 써서 존치.

**실측(구현자) + 육안(컨트롤러):** 버튼 폭 **51.61px** vs 폼 **380px**(13.6% — 우측 자연폭 확정) · 라벨 정확히 `커밋` · 비활성 사유 `스테이지에 올린 파일이 없어요` · 포커스 시 `outline-width: 0px`, `box-shadow: 0 0 0 1px accent`(2px 링 제거) · `--color-text-muted` 대비 라이트 **5.78:1** / 다크 **6.98:1**(AA 통과라 색 변경 불필요). 스크린샷 2장 육안 확인 — 비활성/활성 색 구분 뚜렷, 카드 3겹이 2겹으로 줄었다. 게이트 6/6 · **523** · build 성공 · **92**.

**플랜 오타:** Step 4의 `pnpm build`는 루트에 스크립트가 없다 — `pnpm --filter @git-gui/desktop build`가 맞다(Task 5·6에도 동일 적용).


### Task 5: 좌측 레이아웃 + 행 액션 + 헤더 통일

**Files:**
- Modify: `apps/desktop/src/renderer/src/layout.css`
- Modify: `apps/desktop/src/renderer/src/components/changes-panel.css`
- Modify: `apps/desktop/src/renderer/src/components/ChangesPanel.tsx`
- Modify: `apps/desktop/src/renderer/src/App.tsx` (헤더 버튼 variant)

- [x] **Step 1: 두 목록을 내용 기반으로.** `layout.css`의 기존:

```css
.app__left > .changes-panel {
  flex: 1;
  min-height: 0;
}
```

교체:

```css
/* E8 — 반반 고정이라 파일 2~3개일 때 좌측에 수백 px가 비었다. 내용만큼만 차지하고
   길어지면 그때 남은 공간을 나눈다(각 목록의 가상 스크롤은 그대로) */
.app__left > .changes-panel {
  flex: 0 1 auto;
  min-height: 0;
}
```

- [x] **Step 2: 빈 섹션 접기.** `changes-panel.css`에 추가 — 목록이 비면 패널 본문이 최소 높이를 갖지 않게:

```css
/* E8 — 파일이 없으면 빈 상자 대신 한 줄로 접힌다 */
.changes-panel__empty {
  padding: var(--space-2) 0;
  margin: 0;
}
```

(기존 `.changes-panel__empty`가 큰 패딩·min-height를 갖고 있으면 그 값을 위로 교체 — 실독.)

- [x] **Step 3: 행 액션의 괄호 숫자.** `ChangesPanel.tsx:258` 부근의 기존:

```tsx
                변경 취소 ({validChecked.length})
```

교체(선택이 없으면 숫자를 숨긴다 — 같은 패턴을 `선택 올리기`·`선택 내리기`에도 적용):

```tsx
                변경 취소{validChecked.length > 0 ? ` (${validChecked.length})` : ''}
```

- [x] **Step 4: 헤더 버튼 크롬 통일.** App.tsx 헤더에서 `variant="neutral"`인 액션 버튼(가져오기·푸시 — 실독)을 `variant="ghost"`로 바꿔 헤더 전체를 고스트로 통일한다. 헤더는 도구 모음이고 주 동작 강조는 각 패널이 맡는다.

- [x] **Step 5: 게이트** — typecheck, 루트 유지, build, smoke **86 유지**(포그라운드 동기, timeout 600000).

- [x] **Step 6: 육안 검증(필수).** 프로브로 변경 파일 2개·스테이지 1개 상태에서 (a) 두 목록의 실제 높이가 내용에 맞는지(빈 공간 픽셀) (b) 변경 0개일 때 빈 상자가 아니라 한 줄인지 (c) 선택 0일 때 `(0)`이 없는지 (d) 헤더 버튼 테두리가 균일한지 측정·보고. 프로브 삭제.

- [x] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/src/layout.css apps/desktop/src/renderer/src/components/changes-panel.css apps/desktop/src/renderer/src/components/ChangesPanel.tsx apps/desktop/src/renderer/src/App.tsx
git commit -m "feat(desktop): E8 좌측 레이아웃 내용 기반·행 액션 괄호 정리·헤더 크롬 통일

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

**Task 5 실행 편차 (소급 기록):** ① **Step 1의 지시 대상이 한 단계 안으로 이동했다.** 플랜은 `.app__left > .changes-panel`을 `flex: 0 1 auto`로 바꾸라 했는데, 그대로 하면 E2E `960px 최소 창…`이 **결정적으로** 실패한다(플레이크 아님 — 3/3). 원인은 react-virtual 스크롤포트의 조상 사슬이 전부 auto가 되면 리사이즈 시 `ResizeObserver`가 `clientHeight: 0`을 재고 고착되는 것(계측: `scrollClientHeight 0`·`ulChildCount 0`인데 `<ul>` 인라인 높이는 31px). 그래서 바깥은 `flex: 1`로 되돌리고 **`.changes-panel > .ui-panel`을 `flex: 0 1 auto`로** 바꿨다. ② Step 2 패딩 `var(--space-2) 0` → `var(--space-2) var(--space-4)`(0은 텍스트가 카드 테두리에 붙는다). ③ `text-align: center` → `left`(플랜에 없던 판단). ④ 인라인 영문 병기 제거를 컨텍스트 메뉴 전역으로 확대 — `ContextMenuItem`(`ui/ContextMenu.tsx:5-11`)은 `key|label|disabled|onSelect`뿐이라 툴팁 이관 경로가 아예 없다(리뷰 확인). 그래서 이관이 아니라 **삭제**가 유일한 일관 선택.

**리뷰가 잡은 Blocking (실사용 파손):** `flex-shrink`는 **flex-basis 비율로** 줄이므로 한쪽 목록이 길면 짧은 쪽이 자기 몫의 거의 전부를 빼앗긴다. `.ui-panel`은 `overflow: hidden` + `min-height: 0`이라 헤더에서 멈추지도 않는다. 실측(1200×800, `.changes-panel` 514px):

| 픽스처 | 변경 사항 | 스테이지 | DOM 내 스테이지 행 |
| --- | --- | --- | --- |
| 1500 / 0 | 495.2 | **2.8** | — |
| 200 / 3 | 483.1 | **14.9** | **0** |
| 100 / 2 | 475.4 | **22.6** | **0** |
| 30 / 2 | 432.4 | 65.6 | **0** (본문 23.6px = 벌크 바뿐) |

**사용자에게 무슨 일이 벌어지나:** 변경 200·스테이지 3이면 스테이지 카드가 15px 빈 줄이 되어 제목·개수 배지·행·빈 안내까지 전부 사라지는데(`file-staged-*` 조회 0건 — 잘린 게 아니라 가상 스크롤이 아무것도 안 그린다), **커밋 버튼은 활성이고 placeholder는 `비워 두면: f000.txt 외 2개 수정`이라 보이지도 취소하지도 못하는 파일을 커밋하라고 권한다.** 변경 30개에서 이미 시작되는 평범한 상태다. 기존 92건 중 **길이가 다른 두 목록을 만드는 테스트가 하나도 없어서** 통과했다.

**Task 5-보완:** `max-height: 70%`로 한쪽 압사를 막고 `:last-child { flex-grow: 1 }`로 스테이지 카드(커밋 버튼 바로 위)가 남는 세로를 흡수한다 — 컨트롤러가 스크린샷에서 지적한 **"빈 상자 대신 빈 배경 313~600px"** 문제도 같은 한 줄로 사라진다(2/1에서 여백 313 → 26.2px). 함께: `layout.css`의 **틀린 근본 원인 주석** 정정(바깥 규칙은 무죄, 진범은 안쪽 `flex-grow: 1`), 죽은 `margin-top: auto` + 폐기된 아키텍처의 실측을 인용하던 주석 제거(전 상태에서 used value `0px` 실측), `합이 넘치면 나눠 갖는다`·`E7c 예약석` 낡은 주석 정정, 빈 안내 x=33 → 37(제목 레일 일치), 컨텍스트 메뉴 병기 잔여 8곳(`HistoryPanel:285,319`·`BranchesPanel:81,82,119,153`) 삭제.

**리뷰가 검증한 정상 항목:** 헤더 8버튼 고스트 균일(`border 1px rgba(0,0,0,0)`·`box-shadow: none`), 호버(`bg → rgb(25,28,34)`)·`focus-visible`(2px 링) 구분 유지, `variant="neutral"` 잔여 0, `(0)` 제거 렌더, 의도한 케이스의 내용 기반 축소(2+1 → 128/73, 이전 249/249), 1500·1500+1500 가상 스크롤 양쪽 독립 동작(index 1499 도달).

**남은 판단(리뷰 권고 수용):** 행 액션 바가 첫 체크 시 ~16px 흔들린다 — 0선택에서 두 버튼 모두 `disabled`라 오클릭 위험은 없어 Nit로 둔다.

**후속(Task 6에서 반드시):** **길이가 다른 두 목록**(200 unstaged + 3 staged → `file-staged-*` 가시)을 E2E로 덮는다. 이 공백이 Blocking을 통과시켰다.


### Task 6: E2E 3건 + 최종 게이트 + 스크린샷 + README

**Files:**
- Modify: `apps/desktop/e2e/smoke.spec.ts`
- Modify: `README.md`

- [x] **Step 1: E2E 신규 3건.** smoke.spec.ts 끝에 추가:

```ts
test('E8 — 커밋 버튼은 스테이지가 비면 사유와 함께 비활성이다', async () => {
  const repo = await createRepoWithChange()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: await mkdtemp(join(tmpdir(), 'gg-ud-')) },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('commit-button')).toBeDisabled()
    await expect(window.getByTestId('commit-hint')).toContainText('올린 파일이 없어요')
    // 스테이지에 올리면 활성 + 라벨은 한 단어
    await window.getByTestId('check-unstaged-app.txt').click()
    await window.getByTestId('stage-selected').click()
    await expect(window.getByTestId('commit-button')).toBeEnabled()
    await expect(window.getByTestId('commit-button')).toHaveText(T.commit)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('E8 — 화면에 영문 개념 배지가 남아 있지 않다', async () => {
  const repo = await createRepoWithChange()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: await mkdtemp(join(tmpdir(), 'gg-ud-')) },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('history-panel')).toBeVisible()
    // 배지로 쓰이던 원어들이 화면 텍스트로 존재하지 않는다(툴팁 안은 호버해야 뜨므로 무관)
    for (const word of ['unstaged', 'staged', 'commit', 'log', 'merge', 'pull', 'push']) {
      await expect(window.locator('.ui-badge', { hasText: new RegExp(`^${word}$`) })).toHaveCount(0)
    }
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})

test('E8 — 변경이 없으면 목록이 빈 상자로 자리를 먹지 않는다', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: await mkdtemp(join(tmpdir(), 'gg-ud-')) },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('history-panel')).toBeVisible()
    const heights = await window.evaluate(() =>
      [...document.querySelectorAll('.app__left > .changes-panel')].map((el) =>
        Math.round((el as HTMLElement).getBoundingClientRect().height),
      ),
    )
    // 파일 0개인 목록은 헤더+한 줄 수준(200px 미만)이어야 한다 — 반반 고정이면 300px를 넘었다
    for (const height of heights) expect(height).toBeLessThan(200)
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})
```

(`stage-all`·`commit-hint` 등 testid와 `T` import는 실독 확인 — Task 2 Step 1 결과에 따라 `T.commit` 대신 리터럴 `'커밋'`을 쓸 수도 있다. `mkdtemp`·`tmpdir` import 확인.)

**Step 1 실측 정정 (컨트롤러):** `stage-all` testid는 **존재하지 않는다** — 실제 계약은 `check-unstaged-app.txt` 클릭 후 `stage-selected` 클릭이다(`smoke.spec.ts:143-144` 기존 관용). `T`는 `smoke.spec.ts:8`에서 이미 import돼 있고, `mkdtemp`·`tmpdir`·`rm`·`execGitOrThrow`·`cleanupScreens`도 전부 기존 import에 있다. `commit-hint`는 Task 4에서 "조건부 제안 안내"와 "상시 사유"가 합쳐진 자리라 스테이지 0일 때 `올린 파일이 없어요`가 맞다.

**Step 1-B: 4번째 E2E (Task 5-보완이 드러낸 커버리지 공백 — 필수).** 기존 92건 중 **길이가 다른 두 목록**을 만드는 테스트가 하나도 없어서 "짧은 목록 압사" Blocking이 통과했다. 변경 다수 + 스테이지 소수 픽스처를 만들어 ① 스테이지 카드의 제목·개수 배지가 보이고 ② `file-staged-<이름>` 행이 **DOM에 실재**하며(`toBeVisible()` — 높이 0이면 실패한다) ③ 두 카드 높이가 각각 `.changes-panel` 높이의 70% 이하인지 단언한다. 파일 개수는 200까지 갈 필요 없다 — 실측상 **30 unstaged / 2 staged**에서 이미 스테이지 행이 0개였으므로 그 정도면 회귀를 잡는다(E2E 시간도 짧다).

- [x] **Step 2: 게이트** — build + `npx playwright test e2e/smoke.spec.ts` → **89 passed**(86+3), 신규 3건 각각 단독 `-g` 1회 non-flaky, 루트 `pnpm test` 유지, typecheck.

- [x] **Step 3: 전체 게이트** — 루트 `pnpm test` **523(520+3 — 실측 확정)** · typecheck 전부 Done · desktop build · `pnpm --filter @git-gui/desktop e2e` → **95**(smoke 89 + hosting 6) · last-screen 아티팩트 0건.

- [x] **Step 4: 공식 스크린샷 3장** — 임시 spec `apps/desktop/e2e/tmp-shots-e8.spec.ts`(관례: harness electron·1440×900·try/finally 정리·촬영 후 spec 삭제·전체 e2e 재실행 금지): **(1) e8-commit-form.png** — 변경 3개·스테이지 1개 상태의 좌측 열(새 커밋 폼·접힌 빈 공간). **(2) e8-header.png** — 배지 없는 헤더. **(3) e8-full.png** — 전체 화면. 스크래치패드(`/private/tmp/claude-501/-Users-sangyeop-kim-git-gui/b4ef6d32-042d-440c-8252-b8944659aa01/scratchpad/`)에 사본.

- [x] **Step 5: README.** 기존 E7k 문단 끝(실독) 뒤에 추가:

```markdown
E8: 화면 용어를 개발자 표준(커밋·브랜치·스태시·병합·푸시)으로 통일하고, 한글 라벨 옆에 붙던 영문 개념 배지를 걷어 원어는 호버 툴팁으로 옮겼습니다. 커밋 폼은 전폭 버튼 대신 우측 자연폭 버튼 + 못 누르는 사유 한 줄로 바뀌었고, 좌측 목록은 내용만큼만 자리를 차지합니다. 용어는 `terms.ts` 한 곳에 모여 있어 나중에 "쉬운 말 모드"를 표 하나로 되살릴 수 있습니다.
```

- [x] **Step 6: Commit**

```bash
git add apps/desktop/e2e/smoke.spec.ts README.md
git commit -m "test(desktop): E8 E2E 3건 — 커밋 버튼 사유·배지 부재·목록 접힘 + README

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

**Task 6 실행 편차 (소급 기록):** ① **플랜의 테스트 3 지시가 설계와 모순이었다** — "두 카드 모두 200px 미만"은 Task 5-보완이 **의도적으로** 넣은 `:last-child { flex-grow: 1 }`(스테이지가 여백 흡수)와 충돌한다. 구현자가 실측(unstaged 73px / staged 359.8px)으로 잡아내 첫 카드만 검사하도록 고쳤다 — 그리고 **최종 리뷰가 그 `flex-grow` 자체를 무효로 판정**해 결국 둘 다 검사하게 됐다(아래). ② 인라인 병기 정리를 10곳으로 확대 — 툴팁 7곳(의도)과 보이는 라벨을 분리. `BranchSwitcher.tsx:54`는 `ui/Pictogram.tsx:52-54` 실독 결과 `role="img"` + `aria-label`이라 **스크린리더가 "브랜치 브랜치"로 읽던 중복**을 없앤 것(시각 텍스트 아님). ③ E2E 4번째(비대칭 목록)는 Task 5-보완이 드러낸 커버리지 공백을 메운다. ④ 신규 4건 각각 `-g` 2회 비플레이키 확인.

**게이트 실측:** typecheck 6/6 · 루트 **523** · build 성공 · smoke **90**(86+4) · e2e **96**(90+6).

---

## 최종 통합 리뷰 (`main..5e9205f` 전 범위) — 판정 `Fix Important first`

게이트는 전부 초록이고 회귀도 없었지만, **에픽의 명분 자체가 25곳쯤에서 깨져 있었다.**

- **I-1 `공간` 19곳 생존, 그중 8곳은 한 문장 안에서 혼재.** `실험 공간`은 죽였는데 축약형 `공간`을 안 죽였다. 최악: `ManageBranchesDialog.tsx:58` — 제목 "**브랜치** 관리", 본문 "다 쓴 **브랜치**를 지워요. 지금 있는 **공간**은 지울 수 없어요." `BranchesPanel.tsx:392`는 `<Panel title={T.branch}>` 바로 아래 그룹 헤더가 `내 공간 (로컬)`이었다.
- **I-2 `'직접 보관'` — 네 번째 범위 구멍.** `repository-store.ts:562`(렌더러 **스토어**)가 Task 2(컴포넌트)와 Task 2-B(패키지) 사이에 껴 있었다. 버튼은 `지금 변경 스태시하기`인데 눌러서 생긴 항목은 `직접 보관`이고, 바로 위 항목들은 `브랜치 전환 자동 스태시`다. 폐기 확인창의 `"직접 보관"를 버려요`는 조사도 틀렸다(관은 받침 있음 → 을).
- **I-3 제거한 영문 5개가 대체 없이 증발.** `titleHint`가 3개 패널에만 붙어 `unstaged`·`staged`·`conflict`·`compare`·`commit/stash`는 툴팁에도 없다. **`unstaged`가 가장 아프다** — 한글 라벨이 `변경 사항`이라, 커밋·브랜치·스태시 같은 음차어와 달리 원어로 돌아갈 길이 없다(`git status` 개념과 연결이 끊긴다).
- **I-4 `flex-grow: 1`이 주석의 약속을 실제로 이행하지 않는다.** 실측(1440×900, `.changes-panel` 614px): `max-height: 70%`가 430px에서 성장을 막아 **빈 카드(내부 사장 388px)와 배경 여백(95px)이 동시에** 남는다. 스펙의 성공 기준 "파일이 없는 섹션은 헤더 한 줄로 접힌다"를 변경 사항(73px)은 만족하고 스테이지(430px, 0행)는 위반한다. 리뷰 판단: **제목·개수 배지를 단 빈 테두리 카드는 "고장"으로 읽힌다 — 테두리는 내용이 있다는 약속이다.** 게다가 `smoke.spec.ts:2852`가 그 거짓 전제로 둘째 카드를 면제해, 제목이 본문보다 많은 것을 주장하는 테스트가 됐다.

**최종 보완:** I-1~I-4 + M-1(`합쳐진 결과`→`병합 결과`) + M-2(`T.worktree` 하드코딩 15곳·`T.approve` 4곳 — 쉬운 말 모드가 반쪽만 번역되는 것을 막는다) + M-3(README `현재 상태` 문단이 E8 이전 앱을 설명) + M-4(커밋 폼이 placeholder와 사유 줄로 **같은 말을 두 번**) + N-3(`resize: vertical` 그립).

**리뷰가 검증한 정상 항목:** 조사 **162개 보간 지점 오류 0**(받침 계산 `(code-0xAC00)%28`로 을/를·은/는·이/가·과/와·으로/로 전수) · 엔진·main 어휘 완결(잔여는 주석뿐) · 사전 죽은 키 0·중복 값 0 · **테스트 무결성**(`main..HEAD` 테스트 diff에 `.skip`·`.only`·`toBeAttached`·`toBeHidden` **0건**, 520→523·92→96 델타가 정확히 신규분) · 데드코드 정리 완료 · 접근성 무회귀(31개 컨트롤 중 접근명 없는 2개는 **main과 바이트 동일한 기존 문제**).

**범위 밖으로 명시 제외:** e2e 테스트 **제목** 33개의 옛 어휘(단언은 0건 영향), `--term-badge*` 토큰 이름(`.app__notice`가 아직 소비), `settings-open`·`terminal-new-tab` 접근명 누락(E8 원인 아님 — 후속).



## 게이트 표 (누적 — 실측 정정 대상)

| 시점 | 루트 테스트 | smoke |
| --- | --- | --- |
| 시작 | 520 | 86 |
| Task 1 후 | +3 → 523 | 86 |
| Task 1-보완 후 | 523 유지 | 86 |
| Task 2 후 | 523 | 86 유지 |
| Task 2-보완 후 | 523 유지 | 86 유지 |
| Task 2-B 후 | 523 유지 | 86 유지 |
| Task 3 후 | 523 | 86 유지 |
| Task 4 후 | 523 | 86 유지 |
| Task 5 후 | 523 | 86 유지 |
| Task 6 후 | 523 · e2e **95**(89+6) | +3 → 89 |

## Self-Review (플랜 자체 점검)

1. **스펙 커버리지**: ①사전 모듈=T1 · ②어휘 매핑 전체=T2(표 그대로) · ③커밋 폼=T4 · ④배지 제거·툴팁 이관=T3 · ⑤좌측 레이아웃=T5 · ⑥행 액션·헤더=T5 · 테스트=T1 단위 3건 + T6 E2E 3건 + 스크린샷. 에러표: 없는 키(as const 타입) · 문장 보간(T2 Step 2) · E2E import 실패(T2 Step 1의 사전 확인 + 편차 경로) · 배지 제거 후 헤더 여유(무해) · 우측 정렬 버튼의 좁은 창(자연폭이라 안전) · 빈 섹션 접힘과 리사이즈(세로만 변경) 전부 매핑.
2. **플레이스홀더**: 없음. T2의 어휘 교체는 파일 목록을 "렌더러 전역"으로 두되 **매핑표와 금지 규칙(저장소 오치환 금지·testid 불변)**을 명시해 기계적 판단이 가능하게 했다.
3. **타입 일관성**: `T`·`TermKey`(T1) ↔ 전 태스크 참조. `commit-form__foot`·`commit-form__reason`(T4 CSS) ↔ T4 JSX 클래스명 일치. testid(`commit-button`·`commit-hint`·`commit-message`)는 전 구간 불변.
4. **알려진 위험 3건**: (a) T2가 이 에픽에서 가장 크다(200곳+E2E 154) — 한 커밋으로 몰면 리뷰가 불가능하니 **파일군별로 나눠 커밋해도 된다**(편차 보고). (b) `저장` 156곳 중 `저장소`는 다른 뜻 — 기계적 치환이 사고를 낸다. (c) E2E가 사전을 import 못 하면 T2·T6의 단언 방식이 달라진다 — Step 1에서 먼저 확인하게 배치했다.
