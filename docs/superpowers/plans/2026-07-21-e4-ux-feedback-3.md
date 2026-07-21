# E4 UX 피드백 라운드 3 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) 구문으로 추적한다.

**Goal:** 사용자 피드백 2건 — ① 히스토리 ref 배지가 여러 개·긴 이름이면 전부 말줄임되어 정보가 죽는다, ② "합치는 중" 머지 바가 나타날 때마다 본문이 밀린다(사용자는 알림으로 인식).

**Architecture:** ① 배지 우선순위 정렬+상위 2개만 표시+나머지 "+N" 접기(툴팁 전체 표시) — 정렬·접기는 순수 함수(`history-refs.ts`)로 분리(레이어 분리). ② 머지 바와 알림을 **하나의 오버레이 스택**(높이 0 레이어 + absolute 세로 스택)으로 통합 — 어떤 상단 바도 본문을 밀지 않고, 스택 안에서 머지 바(위)→알림(아래)으로 쌓여 서로 가리지도 않는다(E1c "배너가 취소 버튼 가림"의 구조적 해소).

**기준 커밋:** main = `05c3af8` (E3b 병합 직후). 브랜치 `feature/e4-ux-feedback-3`.

**피드백 원문 대응표:**

| # | 피드백 | 태스크 |
| --- | --- | --- |
| 1 | 트리에서 브랜치 명이 길거나 여러 개 겹치면 잘 안 보임 | Task 1 |
| 2 | 알림(머지 바)이 오버레이가 아니라 레이아웃 시프트를 만든다 | Task 2 |

---

### Task 1: 히스토리 ref 배지 — 우선순위 정렬 + "+N" 접기 + 툴팁

배지가 3개 이상이거나 이름이 길면 각각이 말줄임되어 "fe…" "origin…"만 남는다(피드백 1). 우선순위(현재 브랜치 > 로컬 > origin/원격)로 정렬해 **상위 2개만 보여주고 나머지는 "+N" 배지로 접는다**. 모든 배지에 title 툴팁(전체 이름), +N 툴팁에는 접힌 전체 목록. (태그는 파서가 `tag: ` 접두를 벗겨 문자열만으로 구분 불가 — 로컬과 동급으로 두고, 태그 하위 분류는 후속 노트.)

**Files:**
- Create: `apps/desktop/src/renderer/src/components/history-refs.ts`
- Test: `apps/desktop/test/history-refs.test.ts`
- Modify: `apps/desktop/src/renderer/src/components/HistoryPanel.tsx`
- Modify: `apps/desktop/src/renderer/src/components/history-panel.css`

- [ ] **Step 1: 실패하는 테스트** (`apps/desktop/test/history-refs.test.ts` 신규)

```ts
import { describe, expect, it } from 'vitest'
import { arrangeRefs } from '../src/renderer/src/components/history-refs'

describe('arrangeRefs', () => {
  it('현재 브랜치 > 로컬 > 원격(origin/) 순으로 정렬해 상위 2개만 보이고 나머지는 접는다', () => {
    const result = arrangeRefs(['origin/main', 'feature/login', 'main', 'v1.0'], 'main')
    expect(result.visible).toEqual(['main', 'feature/login'])
    // v1.0(태그)은 파서가 tag: 접두를 벗겨 구분 불가 — 로컬과 동급(원격보다 앞)
    expect(result.hidden).toEqual(['v1.0', 'origin/main'])
  })

  it('2개 이하면 전부 보이고 접힘이 없다', () => {
    expect(arrangeRefs(['main'], 'main')).toEqual({ visible: ['main'], hidden: [] })
    expect(arrangeRefs([], null)).toEqual({ visible: [], hidden: [] })
  })

  it('현재 브랜치가 없으면 로컬 우선 정렬만 적용한다', () => {
    const result = arrangeRefs(['origin/a', 'b', 'origin/c', 'd'], null)
    expect(result.visible).toEqual(['b', 'd'])
    expect(result.hidden).toEqual(['origin/a', 'origin/c'])
  })

  it('같은 우선순위 안에서는 입력 순서를 유지한다 (안정 정렬)', () => {
    const result = arrangeRefs(['z-branch', 'a-branch', 'main'], 'main')
    expect(result.visible).toEqual(['main', 'z-branch'])
    expect(result.hidden).toEqual(['a-branch'])
  })
})
```

- [ ] **Step 2: Red 확인** — `cd apps/desktop && npx vitest run test/history-refs.test.ts` → FAIL(모듈 없음). (주의: `pnpm --filter @git-gui/desktop test`는 test 스크립트가 없어 무음 exit 0 — 쓰지 않는다.)

- [ ] **Step 3: 구현** (`apps/desktop/src/renderer/src/components/history-refs.ts` 신규)

```ts
export interface ArrangedRefs {
  /** 보여줄 배지 — 우선순위 상위 (현재 브랜치 > 로컬·태그 > 원격) */
  visible: string[]
  /** "+N"으로 접히는 나머지 — 툴팁으로만 보여준다 */
  hidden: string[]
}

/** 원격 ref 추정 — decorate 출력의 원격은 "<remote>/…" 형태다. origin 우선 규칙(push)과 동일 계열 휴리스틱 */
function refPriority(ref: string, currentBranch: string | null): number {
  if (ref === currentBranch) return 0
  if (!ref.includes('/')) return 1
  if (ref.startsWith('origin/')) return 2
  // 슬래시가 있지만 origin/이 아닌 것 — 로컬 폴더형(feature/a) 또는 다른 원격. 로컬 쪽에 가깝게 둔다
  return 1
}

/**
 * ref 배지를 우선순위로 정렬해 상위 max개만 보이게 나눈다 (피드백: 여러 개·긴 이름이면 전부 죽는다).
 * 같은 우선순위 안에서는 입력 순서를 유지한다(안정 정렬 — 예측 가능성).
 */
export function arrangeRefs(
  refs: string[],
  currentBranch: string | null,
  max = 2,
): ArrangedRefs {
  const sorted = refs
    .map((ref, index) => ({ ref, index, priority: refPriority(ref, currentBranch) }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map((entry) => entry.ref)
  return { visible: sorted.slice(0, max), hidden: sorted.slice(max) }
}
```

- [ ] **Step 4: Green 확인** — `cd apps/desktop && npx vitest run test/history-refs.test.ts` → 4건 PASS

- [ ] **Step 5: HistoryPanel 렌더 교체** — import 추가:

```ts
import { arrangeRefs } from './history-refs'
```

기존 refs 렌더 블록을 교체 — 기존:

```tsx
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
```

교체:

```tsx
                        {(() => {
                          // 배지 폭 경쟁으로 전부 말줄임되는 것을 막는다 — 상위 2개 + "+N" 접기 (피드백)
                          const arranged = arrangeRefs(commit.refs, currentBranch)
                          return (
                            <>
                              {arranged.visible.map((ref) => (
                                <span
                                  key={ref}
                                  title={ref}
                                  className={`history-item__ref${
                                    ref === currentBranch ? ' history-item__ref--head' : ''
                                  }`}
                                >
                                  {ref}
                                </span>
                              ))}
                              {arranged.hidden.length > 0 && (
                                <span
                                  className="history-item__ref history-item__ref--more"
                                  title={arranged.hidden.join('\n')}
                                  data-testid={`history-refs-more-${commit.hash}`}
                                >
                                  +{arranged.hidden.length}
                                </span>
                              )}
                            </>
                          )
                        })()}
```

- [ ] **Step 6: CSS** (`history-panel.css`의 `.history-item__ref--head` 블록 뒤에 추가)

```css
/* 접힌 배지 수 — 마우스를 올리면 전체 목록이 툴팁으로 보인다 (피드백) */
.history-item__ref--more {
  flex: none;
  min-width: 0;
  cursor: default;
}
```

- [ ] **Step 7: 실렌더 확인** — 브랜치 5개+origin이 한 커밋에 몰린 저장소에서 배지 2개+"+N"이 보이고, 각 배지·+N 툴팁이 전체 이름을 보여주는지, 현재 브랜치 배지가 우선 표시·강조되는지, 배지 1~2개인 행은 기존과 동일한지 확인.

- [ ] **Step 8: 게이트 + Commit** — 루트 `pnpm test`(**300**: 296+4) + 기존 E2E 35 회귀 없음

```bash
git add apps/desktop/test/history-refs.test.ts apps/desktop/src/renderer/src/components
git commit -m "feat(desktop): 히스토리 ref 배지 — 우선순위 정렬·+N 접기·툴팁 (피드백 1)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 상단 바 오버레이 스택 — 머지 바도 본문을 밀지 않는다

머지 바(`app__merge-bar`)는 E1d에서 "상주 상태 표시라 흐름에 남긴다"고 설계했지만, 사용자에게는 이것도 알림이고 나타날 때마다 본문 전체가 밀린다(피드백 2). 머지 바와 알림(error/notice)을 **하나의 오버레이 스택**으로 통합한다 — 높이 0 레이어 안의 absolute 스택에 머지 바(위)→알림(아래) 순서로 쌓여, 본문은 밀리지 않고 서로 가리지도 않는다.

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Modify: `apps/desktop/src/renderer/src/layout.css`

- [ ] **Step 1: App.tsx — 스택 통합** — 기존 merge-bar 블록과 banner-layer 블록(순서: merge-bar → banner-layer) 전체를 다음으로 교체:

```tsx
      {(status?.state === 'merging' ||
        status?.state === 'reverting' ||
        store.error !== null ||
        store.notice !== null) && (
        <div className="app__top-layer">
          <div className="app__top-stack">
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
            {store.error && (
              <p className="app__error" role="alert" data-testid="error">
                {store.error}
              </p>
            )}
            {store.notice && (
              <p className="app__notice" role="status" data-testid="notice">
                {store.notice}
              </p>
            )}
          </div>
        </div>
      )}
```

- [ ] **Step 2: layout.css — 스택 규칙 교체** — 기존 `.app__banner-layer` 블록 2개(주석 포함)를 다음으로 교체:

```css
/* 상단 바(머지 바·알림)는 전부 흐름 밖 오버레이 스택 — 무엇이 떠도 본문이 밀리지 않는다 (피드백).
   스택 안에서는 머지 바가 위, 알림이 아래로 쌓여 서로 가리지 않는다(E1c 가림 문제의 구조적 해소) */
.app__top-layer {
  position: relative;
  height: 0;
  z-index: 40;
  flex: none;
}
.app__top-stack {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  flex-direction: column;
}
.app__top-stack .app__error,
.app__top-stack .app__notice {
  box-shadow: var(--shadow-2);
}
```

그리고 `.app__merge-bar` 블록에 그림자 한 줄 추가(`flex: none;` 줄 뒤):

```css
  box-shadow: var(--shadow-2);
```

- [ ] **Step 3: 실렌더 확인 (시프트 실측 필수)** — (1) merging 진입 전/중/취소 후 `.app__main` boundingBox가 완전히 동일(y·height 무변 — 시프트 0), (2) merging 중 에러 배너까지 뜬 상태에서 머지 바가 위·배너가 아래로 쌓이고 '합치기 취소' 실클릭 성공, (3) 알림만 뜰 때 기존과 동일(오버레이+그림자), (4) 머지 바가 본문 상단(좌측 패널 헤더)을 덮는 정도가 수용 가능한지 시각 확인(오버레이의 대가 — E1d에서 수용한 트레이드오프와 동일), (5) 960px 확인.

- [ ] **Step 4: 게이트** — 기존 E2E의 merge-bar·notice·error 단언은 가시성 기반이라 통과해야 한다. 루트 `pnpm test`(300) + typecheck(6 Done) + build + E2E 전체(**35 passed**).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/layout.css
git commit -m "fix(desktop): 상단 바 오버레이 스택 — 머지 바도 본문을 밀지 않는다 (피드백 2)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 최종 게이트 + 공식 스크린샷 2장

- [ ] **Step 1: 전체 게이트** — 루트 `pnpm test`(**300**) + typecheck(6 Done) + build + E2E **35 passed** — 전부 exit 0

- [ ] **Step 2: 스크린샷 2장** (1440×900, test-results/ + scratchpad `/private/tmp/claude-501/-Users-sangyeop-kim-git-gui/47e198c4-f65c-435f-b962-13de0c0d68a0/scratchpad/` 사본, **생성 후 e2e 재실행 금지**)

- (a) `e4-refs.png` — 한 커밋에 브랜치 5개+origin이 몰린 히스토리: 배지 2개 + "+N", 현재 브랜치 강조
- (b) `e4-overlay.png` — merging 충돌 + notice 동시 상태: 머지 바(위)·알림(아래) 스택, 본문 무시프트

- [ ] **Step 3: Commit** (변경이 스크린샷뿐이면 커밋 생략 — test-results/는 미추적)

---

## 검증 게이트 요약

| 시점 | 기대치 |
| --- | --- |
| 기준선 (05c3af8, 실측) | 296 tests + E2E 35 |
| Task 1 후 | +4 → **300 tests**, E2E 35 회귀 없음 |
| Task 2 후 | 300 + E2E 35 (기존 단언 가시성 기반) |
| 최종 | 300 tests + typecheck 6 Done + build + E2E 35 — 전부 exit 0 + 스크린샷 2장 |

## 후속 노트 (이관 후보)

- "+N" 배지 클릭 시 전체 ref 목록 팝오버(지금은 툴팁만 — 트랙패드 hover가 어려운 환경 고려)
- 원격 ref 판정이 origin/ 접두사 휴리스틱 — 커스텀 remote 이름은 로컬로 분류된다(무해: 우선순위만 영향)
- 태그를 로컬과 구분해 뒤로 보내려면 log 파서가 `tag: ` 접두 정보를 보존해야 한다(CommitSummary.refs 구조 확장) — 우선순위 하위 분류 후속
- 오버레이 스택이 본문 상단을 덮는 트레이드오프 — 장시간 머무는 merging 중에는 좌측 패널 헤더가 가려질 수 있어, 필요시 "스택에 마우스 올리면 반투명" 같은 완화 검토
