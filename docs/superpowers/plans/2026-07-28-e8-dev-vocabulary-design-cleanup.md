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

- [ ] **Step 1: Red — 사전 무결성 테스트.** `apps/desktop/test/terms.test.ts` 신규:

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

- [ ] **Step 2: Red 확인** — `npx vitest run apps/desktop/test/terms.test.ts` 실행, 모듈 없음으로 실패.

- [ ] **Step 3: 구현.** `apps/desktop/src/renderer/src/terms.ts` 신규:

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
  head: '현재 위치(HEAD)',
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

- [ ] **Step 4: Green 확인** — `npx vitest run apps/desktop/test/terms.test.ts` 3건 통과.

- [ ] **Step 5: 게이트** — 루트 `pnpm test` → **523(520+3 — 실측 보고)**, `pnpm typecheck` 전부 Done.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/terms.ts apps/desktop/test/terms.test.ts
git commit -m "feat(desktop): E8 용어 사전 모듈 — 개발자 어휘 한 벌(쉬운 모드는 후속 표로)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: 화면 어휘 전환 (사전 참조로)

**Files:**
- Modify: 렌더러 전역(아래 목록) — 어휘가 박힌 모든 컴포넌트
- Modify: `apps/desktop/e2e/smoke.spec.ts` (문구 단언)

- [ ] **Step 1: E2E import 가능 여부 확인(먼저).** smoke.spec.ts 상단에 `import { T } from '../src/renderer/src/terms'`를 추가하고 아무 테스트에서 `T.commit`을 참조하도록 임시 수정한 뒤 `npx playwright test e2e/smoke.spec.ts -g "커밋"` 계열 1건만 돌려 **모듈 해석이 되는지** 확인한다. 실패하면 E2E는 리터럴을 쓰고(사전 미사용) **편차 보고** — 이후 Step 4를 리터럴 교체로 수행한다.

- [ ] **Step 2: 어휘 교체(화면).** 아래 매핑대로 전 파일을 바꾼다. **짧은 라벨은 `T.x` 참조**, 문장 속 어휘는 `${T.x}` 보간:

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
| 지금 여기 | 현재 위치(HEAD) | `T.head` |
| 겹침 | 충돌 | `T.conflict` |
| 재배치 | 리베이스 | `T.rebase` |
| 분리됨 | 분리 HEAD | `T.detached` |
| 없어진 폴더 | 정리 대상 | `T.prunable` |
| 연결 없음 | 업스트림 없음 | `T.noUpstream` |
| 리뷰 요청 | 풀 리퀘스트 | `T.pullRequest` |
| 변경 내용(패널 제목) | Diff | `T.diff` |
| 이 파일만 적용 | 이 파일만 체크아웃 | `T.checkoutFile` |
| 마지막 저장 실행취소 | 마지막 커밋 취소 | `T.undoCommit` |

문장은 구조를 유지한 채 어휘만 바꾼다. 예:
- `'다른 곳에 합쳐진 저장은 남아요…'` → `` `다른 곳에 ${T.merge}된 ${T.commit}은 남아요…` `` (조사는 자연스럽게 손본다)
- `'"${name}" 실험 공간을 지웠어요.'` → `` `"${name}" ${T.branch}를 지웠어요.` ``

**주의**: `저장`은 156곳으로 가장 많지만 `저장소`(repository)·`저장 위치` 등 **다른 뜻**이 섞여 있다 — 기계적 치환 금지. 커밋을 뜻하는 곳만 바꾼다.

- [ ] **Step 3: testid는 건드리지 않는다.** `data-testid`(예: `commit-button`·`branch-row-*`)는 어휘와 무관한 계약이다. 하나도 바꾸지 말 것(바꾸면 E2E 154곳 외에 추가 파장이 생긴다).

- [ ] **Step 4: E2E 문구 단언 전환.** Step 1이 성공했으면 `getByText('저장하기')` → `getByText(T.commit)` 식으로 **어휘 단언만** 사전 참조로 바꾼다(문장 단언은 새 문장 리터럴로 갱신). Step 1이 실패했으면 전부 새 리터럴로.

- [ ] **Step 5: 게이트** — typecheck Done, 루트 `pnpm test` 유지, build, `npx playwright test e2e/smoke.spec.ts` → **86 유지**(포그라운드 동기, **Bash timeout 파라미터 600000 필수**). 깨지는 테스트는 원인 수정(비활성·삭제 금지).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src apps/desktop/e2e/smoke.spec.ts
git commit -m "refactor(desktop): E8 화면 어휘를 개발자 표준으로 — 사전 참조 전환

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: 영문 개념 배지 제거 + 툴팁 이관

**Files:**
- Modify: 사전 실측 2의 16곳 중 **개념 배지 14곳**(개수·상태 배지는 유지)
- Modify: `apps/desktop/e2e/smoke.spec.ts` (배지 문자열을 단언하는 곳이 있으면)

- [ ] **Step 1: 제거 대상 확정.** `tone="git"` 16곳 중 다음을 **제거**한다 — App(merge·pull·push), ReviewPopover(PR), HistoryPanel(log), ConflictPanel(conflict), ShelfPopover(stash), BranchesPanel(compare·branch), ChangesPanel(`{termBadge}`), ReviewDetailPanel(approve·merge), DiffPanel(diff), WorktreesPanel(worktree), CommitDetailPanel(stash|commit), CommitForm(commit → Task 4에서 폼과 함께). **유지**: `tone="count"` 전부, ref 배지, 상태 배지(진행 중 작업·충돌 표시).

- [ ] **Step 2: 원어를 툴팁으로.** 배지를 지운 버튼·패널 제목 중 **원어가 도움이 되는 것**은 E7j `Tooltip`으로 감싸 `<한글> (<원어>)` 형태를 남긴다. 대상과 문구:

```
합치기 버튼 → `병합 (merge)`      가져오기 버튼 → `가져오기 (pull)`
푸시 버튼   → `푸시 (push)`        스태시 트리거 → `스태시 (stash)`
브랜치 패널 → `브랜치 (branch)`    워크트리 패널 → `워크트리 (worktree)`
커밋 히스토리 패널 → `커밋 히스토리 (log)`   Diff 패널 → `Diff (diff)` 는 중복이라 생략
```

(헤더 버튼은 E7k에서 이미 Tooltip으로 감싸져 있다 — `content`만 원어 병기로 바꾼다. 패널 제목은 `ui/Panel.tsx`의 h2가 이미 Tooltip(E7j-보완)이라 그 `content`를 원어 병기로 넘길 수 있게 `Panel`에 선택적 prop `titleHint?: string`을 더한다.)

- [ ] **Step 3: `ChangesPanel`의 `termBadge` prop 제거.** 배지가 사라지면 그 prop과 전달부(App 실독)가 죽는다 — 함께 제거한다.

- [ ] **Step 4: 게이트** — typecheck, 루트 유지, build, smoke **86 유지**(포그라운드 동기, timeout 600000). 배지 문자열(`unstaged`·`staged`·`merge` 등)을 단언하던 E2E가 있으면 같은 취지로 조정·편차 보고.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src apps/desktop/e2e/smoke.spec.ts
git commit -m "refactor(desktop): E8 영문 개념 배지 제거 — 원어는 툴팁으로 이관

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: 커밋 폼 재설계

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/CommitForm.tsx`
- Modify: `apps/desktop/src/renderer/src/components/commit-form.css`

- [ ] **Step 1: 컴포넌트 교체.** `CommitForm.tsx`의 return 블록을 다음으로(로직·props는 그대로, `Badge` import 제거):

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

- [ ] **Step 2: CSS 교체.** `commit-form.css`에서 카드 크롬을 걷고 하단 배치를 만든다. 기존:

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

- [ ] **Step 3: 강조색 정합 확인.** `ui/button.css`의 `.ui-button--primary`가 쓰는 `--color-accent` 실값이 앱의 보라 계열인지 실독한다. 파랑 계열이면 **토큰은 건드리지 말고**(다른 곳도 쓴다) 이 폼 버튼만 `--concept-branch` 계열로 맞추는 대신, 토큰이 이미 보라면 그대로 둔다 — 어느 쪽인지 **편차로 보고**.

- [ ] **Step 4: 게이트** — typecheck, 루트 유지, build, smoke **86 유지**(포그라운드 동기, timeout 600000). 커밋 버튼 라벨(`저장하기 — N개 파일`)을 단언하던 E2E는 Task 2에서 이미 갱신됐어야 한다 — 남아 있으면 여기서 조정·편차 보고.

- [ ] **Step 5: 육안 검증(필수).** 프로브로 (a) 비활성 상태에서 사유 문구가 보이는지 (b) 스테이지 후 활성 + 라벨이 `커밋` 한 단어인지 (c) 버튼이 우측 정렬 자연폭인지(폭 < 패널 폭) (d) textarea 포커스 시 링이 얇은지 측정해 수치·문구를 보고한다. 프로브 삭제·워킹트리 클린.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/components/CommitForm.tsx apps/desktop/src/renderer/src/components/commit-form.css
git commit -m "feat(desktop): E8 커밋 폼 재설계 — 우측 자연폭 버튼·사유 문구·얇은 포커스 링·카드 크롬 제거

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: 좌측 레이아웃 + 행 액션 + 헤더 통일

**Files:**
- Modify: `apps/desktop/src/renderer/src/layout.css`
- Modify: `apps/desktop/src/renderer/src/components/changes-panel.css`
- Modify: `apps/desktop/src/renderer/src/components/ChangesPanel.tsx`
- Modify: `apps/desktop/src/renderer/src/App.tsx` (헤더 버튼 variant)

- [ ] **Step 1: 두 목록을 내용 기반으로.** `layout.css`의 기존:

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

- [ ] **Step 2: 빈 섹션 접기.** `changes-panel.css`에 추가 — 목록이 비면 패널 본문이 최소 높이를 갖지 않게:

```css
/* E8 — 파일이 없으면 빈 상자 대신 한 줄로 접힌다 */
.changes-panel__empty {
  padding: var(--space-2) 0;
  margin: 0;
}
```

(기존 `.changes-panel__empty`가 큰 패딩·min-height를 갖고 있으면 그 값을 위로 교체 — 실독.)

- [ ] **Step 3: 행 액션의 괄호 숫자.** `ChangesPanel.tsx:258` 부근의 기존:

```tsx
                변경 취소 ({validChecked.length})
```

교체(선택이 없으면 숫자를 숨긴다 — 같은 패턴을 `선택 올리기`·`선택 내리기`에도 적용):

```tsx
                변경 취소{validChecked.length > 0 ? ` (${validChecked.length})` : ''}
```

- [ ] **Step 4: 헤더 버튼 크롬 통일.** App.tsx 헤더에서 `variant="neutral"`인 액션 버튼(가져오기·푸시 — 실독)을 `variant="ghost"`로 바꿔 헤더 전체를 고스트로 통일한다. 헤더는 도구 모음이고 주 동작 강조는 각 패널이 맡는다.

- [ ] **Step 5: 게이트** — typecheck, 루트 유지, build, smoke **86 유지**(포그라운드 동기, timeout 600000).

- [ ] **Step 6: 육안 검증(필수).** 프로브로 변경 파일 2개·스테이지 1개 상태에서 (a) 두 목록의 실제 높이가 내용에 맞는지(빈 공간 픽셀) (b) 변경 0개일 때 빈 상자가 아니라 한 줄인지 (c) 선택 0일 때 `(0)`이 없는지 (d) 헤더 버튼 테두리가 균일한지 측정·보고. 프로브 삭제.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/src/layout.css apps/desktop/src/renderer/src/components/changes-panel.css apps/desktop/src/renderer/src/components/ChangesPanel.tsx apps/desktop/src/renderer/src/App.tsx
git commit -m "feat(desktop): E8 좌측 레이아웃 내용 기반·행 액션 괄호 정리·헤더 크롬 통일

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: E2E 3건 + 최종 게이트 + 스크린샷 + README

**Files:**
- Modify: `apps/desktop/e2e/smoke.spec.ts`
- Modify: `README.md`

- [ ] **Step 1: E2E 신규 3건.** smoke.spec.ts 끝에 추가:

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
    await window.getByTestId('stage-all').click()
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

- [ ] **Step 2: 게이트** — build + `npx playwright test e2e/smoke.spec.ts` → **89 passed**(86+3), 신규 3건 각각 단독 `-g` 1회 non-flaky, 루트 `pnpm test` 유지, typecheck.

- [ ] **Step 3: 전체 게이트** — 루트 `pnpm test` **523(520+3 — 실측 확정)** · typecheck 전부 Done · desktop build · `pnpm --filter @git-gui/desktop e2e` → **95**(smoke 89 + hosting 6) · last-screen 아티팩트 0건.

- [ ] **Step 4: 공식 스크린샷 3장** — 임시 spec `apps/desktop/e2e/tmp-shots-e8.spec.ts`(관례: harness electron·1440×900·try/finally 정리·촬영 후 spec 삭제·전체 e2e 재실행 금지): **(1) e8-commit-form.png** — 변경 3개·스테이지 1개 상태의 좌측 열(새 커밋 폼·접힌 빈 공간). **(2) e8-header.png** — 배지 없는 헤더. **(3) e8-full.png** — 전체 화면. 스크래치패드(`/private/tmp/claude-501/-Users-sangyeop-kim-git-gui/b4ef6d32-042d-440c-8252-b8944659aa01/scratchpad/`)에 사본.

- [ ] **Step 5: README.** 기존 E7k 문단 끝(실독) 뒤에 추가:

```markdown
E8: 화면 용어를 개발자 표준(커밋·브랜치·스태시·병합·푸시)으로 통일하고, 한글 라벨 옆에 붙던 영문 개념 배지를 걷어 원어는 호버 툴팁으로 옮겼습니다. 커밋 폼은 전폭 버튼 대신 우측 자연폭 버튼 + 못 누르는 사유 한 줄로 바뀌었고, 좌측 목록은 내용만큼만 자리를 차지합니다. 용어는 `terms.ts` 한 곳에 모여 있어 나중에 "쉬운 말 모드"를 표 하나로 되살릴 수 있습니다.
```

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/e2e/smoke.spec.ts README.md
git commit -m "test(desktop): E8 E2E 3건 — 커밋 버튼 사유·배지 부재·목록 접힘 + README

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 게이트 표 (누적 — 실측 정정 대상)

| 시점 | 루트 테스트 | smoke |
| --- | --- | --- |
| 시작 | 520 | 86 |
| Task 1 후 | +3 → 523 | 86 |
| Task 2 후 | 523 | 86 유지 |
| Task 3 후 | 523 | 86 유지 |
| Task 4 후 | 523 | 86 유지 |
| Task 5 후 | 523 | 86 유지 |
| Task 6 후 | 523 · e2e **95**(89+6) | +3 → 89 |

## Self-Review (플랜 자체 점검)

1. **스펙 커버리지**: ①사전 모듈=T1 · ②어휘 매핑 전체=T2(표 그대로) · ③커밋 폼=T4 · ④배지 제거·툴팁 이관=T3 · ⑤좌측 레이아웃=T5 · ⑥행 액션·헤더=T5 · 테스트=T1 단위 3건 + T6 E2E 3건 + 스크린샷. 에러표: 없는 키(as const 타입) · 문장 보간(T2 Step 2) · E2E import 실패(T2 Step 1의 사전 확인 + 편차 경로) · 배지 제거 후 헤더 여유(무해) · 우측 정렬 버튼의 좁은 창(자연폭이라 안전) · 빈 섹션 접힘과 리사이즈(세로만 변경) 전부 매핑.
2. **플레이스홀더**: 없음. T2의 어휘 교체는 파일 목록을 "렌더러 전역"으로 두되 **매핑표와 금지 규칙(저장소 오치환 금지·testid 불변)**을 명시해 기계적 판단이 가능하게 했다.
3. **타입 일관성**: `T`·`TermKey`(T1) ↔ 전 태스크 참조. `commit-form__foot`·`commit-form__reason`(T4 CSS) ↔ T4 JSX 클래스명 일치. testid(`commit-button`·`commit-hint`·`commit-message`)는 전 구간 불변.
4. **알려진 위험 3건**: (a) T2가 이 에픽에서 가장 크다(200곳+E2E 154) — 한 커밋으로 몰면 리뷰가 불가능하니 **파일군별로 나눠 커밋해도 된다**(편차 보고). (b) `저장` 156곳 중 `저장소`는 다른 뜻 — 기계적 치환이 사고를 낸다. (c) E2E가 사전을 import 못 하면 T2·T6의 단언 방식이 달라진다 — Step 1에서 먼저 확인하게 배치했다.
