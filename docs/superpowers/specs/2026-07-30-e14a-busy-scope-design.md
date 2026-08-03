# E14a — busy 구역화 설계

**한 줄:** diff를 읽는 조회가 앱 전체를 잠그지 않게 한다.

사용자 제보: *"파일 누르면 왜 헤더부터 사이드바 전체가 다 텍스트가 리렌더링되는것처럼 깜빡이는거야? diff부분만 바뀌면 될 것 같은데.."*

---

## 1. 실태 (실측)

`selectFile`은 diff만 읽는 조회인데도 `guard()`를 거치며 **전역 `busy`를 켰다 끈다**
(`store/repository-store.ts:694`). `busy`는 App.tsx에서만 19곳, 렌더러 전체 118곳에 스레드된다.

### 1-1. 파일 A → 파일 B 클릭 1회 (MutationObserver, 구역별)

| 구역 | 텍스트 변경 | 노드 추가·삭제 | 속성 변경 | 내역 |
| --- | --- | --- | --- | --- |
| 헤더 | 0 | 0 | **30** | `disabled`×10 · `tabindex`×10 · `data-disabled`×10 |
| 좌측 | **2** | 0 | **78** | `disabled`×22 · `name`×36 · `type`×18 · `class`×2 |
| 우측 | 0 | 0 | 2 | `disabled`×2 |
| 가운데 | 1 | 5 | 10 | ← **여기만 바뀌어야 한다** |

헤더 컨트롤이 비활성으로 머문 시간: **3.5ms → 32.3ms, 지속 28.8ms**.
좌측 텍스트 변경 2건의 정체는 `components/CommitForm.tsx:24` — `const status = busy ? '작업 중이에요' : …`.
즉 커밋 컴포저 상태 슬롯이 29ms 동안 "작업 중이에요"로 바뀌었다 되돌아온다.

### 1-2. 더 나쁜 경로 — 앱을 만지지 않아도 깜빡인다

`externalRefresh`도 조회로 표시돼 있는데, 이건 E10의 워킹트리 감시가 부르는 경로다.
**에디터에서 파일을 저장하기만 해도** 같은 일이 벌어진다:

```
외부 저장 1회 → 헤더 변형 20건 · 좌측 변형 6건
좌측 텍스트 변경: ["작업 중이에요", "1", "스테이지에 올린 파일이 없어요"]
```

**계측 범위 주의 (Task 3 실측으로 정정).** 위 20은 `attributeFilter: ['disabled', 'data-disabled']`
**두 개**로 잰 값이다. §1-1의 표(30)는 `tabindex`까지 **세 개**를 센 것이라 서로 직접 비교하면 안 된다.
같은 세 개 필터로 외부 저장을 다시 재면 **30건**이다 — 회귀 E2E 두 건은 둘 다 세 개 필터를 쓰므로
기준값이 30/30이다. 단언은 어느 쪽이든 0이라 테스트 결과에는 영향이 없다.

에디터 자동저장을 켜두면 이게 상시로 돈다. 사용자가 본 깜빡임의 상당 부분이 이쪽일 것이다.

### 1-3. E11이 이걸 더 잘 보이게 만들었다

버튼 색에 `--motion-fast`(100ms) 트랜지션이 걸려 있어, **29ms짜리 상태 변화가 100ms에 걸쳐
번지며 들어왔다 나간다**. 상태보다 잔상이 3배 길다.

### 1-4. 이미 코드에 있는 경계

스토어의 `guard` 호출 **65개 중 15개가 이미 `armSuppression=false`로 조회임이 표시돼 있다**
(E10이 "읽기 전용 재조회는 억제 창을 무장하지 않는다"를 위해 그은 경계).
실측: 단일행 `guard(set, get, …)` 50건이 전부 쓰기, 다중행 `await guard(\n set,\n get,\n …, false)`
15건이 전부 조회다.
경계는 이미 있고 `busy`만 그걸 안 지킨다 — 이 에픽은 **새 분류표를 만들지 않고 그 경계를 승계한다.**

---

## 2. 설계

### 2-1. `guard` → `runWrite` / `runRead` (새 모듈 `store/run-guard.ts`)

**별도 모듈로 뺀다.** `repository-store.ts`는 1678줄이고 **스토어 단위 테스트가 하나도 없다**
(테스트 31개가 전부 순수 함수 모듈이다 — 스토어가 `git()` IPC 브리지에 묶여 있어서다).
그런데 `guard`는 이미 `(set, get, run)`을 인자로 받아 **스토어에 대해 순수**하다. 그대로 꺼내면
가짜 `set`/`get`으로 단위 테스트가 되고, 이 저장소의 지배적 패턴에 정확히 맞는다.

모듈은 스토어 타입 전체가 아니라 **필요한 필드만** 구조적으로 요구한다(`RepositoryStore`가 이를
구조적으로 만족하므로 캐스팅이 필요 없다):

```ts
export type ReadTarget = 'snapshot' | 'center' | 'right' | 'left' | 'reviews'
interface GuardState {
  busy: boolean
  error: string | null
  notice: string | null
  reads: Record<ReadTarget, number>
}
type GuardSet = (partial: Partial<GuardState>) => void
type GuardGet = () => GuardState
```

억제 창 상태(`lastGuardEndAt`)도 이 모듈로 함께 옮긴다 — `runWrite`가 쓰고
`externalRefresh`(`repository-store.ts:524`)와 `init`(`:454`)이 읽고 지우므로, 두 개의 함수로 노출한다:
`isWithinSuppressWindow()` · `resetSuppression()`. `resetSuppression()`은 `init`이 이미 필요로 하던
동작이라 **테스트 전용 API가 아니다**(테스트도 같은 함수로 격리한다).

`guard`는 이름만 `runWrite`로 바뀌고 동작은 그대로다: 전역 `busy` 직렬화(`if (get().busy) return false`),
`error`/`notice` 초기화, 종료 시 억제 창 무장. `armSuppression` 인자는 사라진다 — 그 구분이 곧
두 함수의 구분이 됐기 때문이다.

조회 15개는 새 `runRead(set, get, target, run)`으로 간다.

```ts
/** 대상별 최신 조회 번호 — 늦게 도착한 응답을 버리기 위한 것 (E7i findSeqRef 선례) */
const readSeq: Record<ReadTarget, number> = { snapshot: 0, center: 0, right: 0, left: 0, reviews: 0 }

async function runRead(
  set: GuardSet,
  get: GuardGet,
  target: ReadTarget,
  run: (isCurrent: () => boolean) => Promise<void>,
): Promise<boolean> {
  const seq = (readSeq[target] += 1)
  const isCurrent = () => seq === readSeq[target]
  set({ reads: { ...get().reads, [target]: get().reads[target] + 1 } })
  try {
    await run(isCurrent)
    return true
  } catch (cause) {
    if (isCurrent()) set({ error: toErrorMessage(cause) }) // 늦게 온 실패는 최신을 안 덮는다
    return false
  } finally {
    set({ reads: { ...get().reads, [target]: get().reads[target] - 1 } })
  }
}
```

**`isCurrent`가 반드시 필요한 이유 (설계 결함 교정).** 결과를 스토어에 넣는 `set()`은 `runRead`가
아니라 **`run` 안에서** 일어난다. 그래서 `runRead`만으로는 늦게 온 응답을 막을 수 없다 —
느린 조회 A와 빠른 조회 B가 겹치면 B가 먼저 떨어진 뒤 A가 **다른 파일의 diff로 덮어쓴다**.
지금까지는 `busy` 재진입 거부가 우연히 이 경합을 막고 있었고, 그걸 빼는 순간 열린다.

따라서 **조회 15개 전부, 결과를 넣는 `set()`을 `if (isCurrent())`로 감싼다.** 예:

```ts
await runRead(set, get, 'center', async (isCurrent) => {
  const diff = await git().changes.diff(repoPath, selected.change.path, { … })
  if (!isCurrent()) return // 그 사이 다른 파일을 눌렀다 — 이 결과는 버린다
  set({ selected, diff, diffLabel: null, commitDetail: null, commitFile: null, conflictFile: null })
})
```

`reads` 카운터는 `isCurrent`와 무관하게 항상 증감한다 — 표시는 "지금 뭔가 돌고 있는가"이지
"최신인가"가 아니기 때문이다.

**`set`이 함수형 갱신자를 안 받는다.** 기존 `StoreSet`은 `(partial: Partial<RepositoryStore>) => void`라
`set((s) => …)`을 쓸 수 없다. `get()`으로 현재 값을 읽어 펼친다 — `get()`과 `set()` 사이에 `await`가
없으므로 단일 스레드에서 안전하다(기존 `guard`도 같은 방식으로 `get().busy`를 읽는다).

**전역 `busy`를 아예 건드리지 않는다.** `error`/`notice`를 안 지우는 것과 억제 창을 안 무장하는
것은 이제 **구성상 저절로** 지켜진다 — E10이 `armSuppression=false`라는 인자로 표현하던 규칙이
함수가 나뉘면서 구조로 옮겨간다. `armSuppression` 인자는 사라진다.

`runWrite`는 재진입 방어(`busy`)를 그대로 갖고, `runRead`는 갖지 않는다 — 조회는 겹쳐 돌아도
되고(카운터), 늦게 온 응답만 버리면 된다.

### 2-2. `ReadTarget` — "결과가 어디에 떨어지는가" 기준 5개

| target | 액션 | 로딩 표시 |
| --- | --- | --- |
| `snapshot` | `refresh` · `externalRefresh` | 없음 (배경 갱신) |
| `center` | `selectFile` · `selectCommitFile` · `compareFileWithWorktree` · `selectConflict` | 가운데 패널 |
| `right` | `selectCommit` · `openPullDetail` · `viewHistory` · `clearHistoryView` · `loadMoreHistory` · `ensureHistoryLoaded` · `revealHead` | 우측 패널 |
| `left` | `compareBranch` | 좌측 비교 뷰 |
| `reviews` | `refreshPulls` | 리뷰 팝오버 |

액션이 아니라 **결과가 떨어지는 자리**로 나눈 이유: 로딩을 보여줄 곳이 곧 그 자리이고,
액션 기준으로 나누면 액션이 늘 때마다 표가 늘지만 자리는 레이아웃이 바뀔 때만 는다.

`snapshot`에 표시가 없는 이유: 배경 갱신이라 사용자가 시작하지 않았고, 화면 전체가 대상이라
어디에 붙일 자리가 없다. 그래도 target을 두는 이유는 진행 여부가 테스트에서 관측 가능해야 하기 때문이다.

스토어에 새 필드 하나가 는다:

```ts
reads: Record<ReadTarget, number>   // 초기값 전부 0
```

### 2-3. 조회 표시 — CSS만, `animation-delay`

JS 타이머로 "150ms 넘으면 띄운다"를 만들지 않는다. 처음부터 DOM에 붙이되 지연을 준다.

```css
/* E14a — 조회 로딩. 지연이 끝나기 전에 사라지는 빠른 조회는 한 프레임도 보이지 않는다 */
@keyframes ui-pending-in {
  from { opacity: 0; }
}
.ui-pending {
  animation: ui-pending-in var(--motion-base) var(--ease-out) var(--motion-pending-delay) both;
  pointer-events: none; /* 지연 중에도 DOM에 있으므로 클릭을 가로채지 않게 */
}
```

새 토큰 하나를 `ui/tokens.css`에 추가한다:

```css
--motion-pending-delay: 400ms; /* 조회 로딩이 배어나오기 시작하는 시점 */
```

**400ms 근거:** 실측 diff 조회가 29ms다. 400ms면 평범한 조회는 전부 지연 안에서 끝나 아무것도
보이지 않고, 사람이 "멈췄나?"를 느끼기 시작하는 구간에서만 표시가 시작된다.

**`prefers-reduced-motion`은 별도 규칙이 필요 없다.** `ui/base.css:85`의 기존 블록이
`animation-duration`만 `0.01ms`로 줄이고 `animation-delay`는 건드리지 않는다 — 그래서 이 클래스는
저절로 "지연 400ms는 그대로, 페이드만 없음"이 된다. 이게 바로 원하는 동작이다(페이드까지 없애면
지연도 함께 사라져 빠른 조회가 오히려 번쩍인다).

`--motion-base`(150ms)를 쓰는 이유: 로딩 표시는 "내용 교체"에 해당하고 `--motion-slow`(240ms)는
상세 슬롯처럼 크게 움직이는 것 전용이다.

**표시의 생김새와 이전 내용의 처리** — 여기를 비워두면 구현자가 지어내게 되므로 못박는다.

- 조회 중에도 **이전 내용을 그대로 둔다.** 비우지 않는다 — 파일을 넘길 때마다 가운데가 빈 상자가
  됐다 채워지면 그게 다시 깜빡임이다(이 에픽이 없애려는 바로 그것). E7d의 "새로고침은 최신화지
  닫기가 아니다"와 같은 원칙이다.
- 표시는 **패널 헤더 우측에 붙는 작은 원형 스피너 하나**다. 이전 내용 위를 덮는 오버레이가 아니다 —
  덮으면 읽던 자리를 가린다. 크기는 본문 글자 높이에 맞춘다.
- 스피너 회전은 `transform: rotate`이므로 안전망(레이아웃 속성 전환 금지, `motion-tokens.test.ts`)에
  걸리지 않는다. `prefers-reduced-motion`에서는 기존 블록이 `animation-duration`을 0.01ms로 만들어
  회전이 멎는다 — 정지한 원이 남는 것은 "진행 중"을 뜻하는 표시로 그대로 유효하다.

**`readSeq`의 위치** — 스토어 바깥 모듈 수준 변수로 둔다. 기존 `lastGuardEndAt`(`repository-store.ts:375`)이
이미 같은 자리에 같은 방식으로 있으므로 관용구가 일치한다.

### 2-4. 경합·동시성

- **write끼리**: 지금 그대로 `busy` 하나로 직렬화된다. 무변.
- **read끼리**: 대상별 카운터라 겹쳐도 안전하고, 대상별 `seq` + `isCurrent()`로 늦게 온 응답을
  버린다(§2-1의 교정 참조 — 이건 선택이 아니라 `busy` 재진입 거부가 하던 일을 대신하는 필수 장치다).
- **write 중 read**: **허용한다.** git은 읽기가 쓰기와 겹쳐도 안전하고, write가 끝나면 스냅샷이
  다시 돌아 낡게 본 값은 곧 교정된다. 커밋이 도는 30초 동안 diff를 못 넘기는 편이 더 나쁘다.
- **read 중 write**: `busy`가 false이므로 그대로 시작된다. 무변.

### 2-4-1. `busy`는 재진입 차단기이기도 했다 (Task 2 실측으로 발견 — 설계 누락 정정)

이 절은 스펙 초안에 없었다. Task 2 전환 후 e2e를 돌려 **무한 렌더 루프(React error #185)로 우측
열 전체가 언마운트되는 것**을 실측하고 나서야 드러난 구멍이다.

`HistoryPanel.tsx:271`:

```tsx
useEffect(() => {
  if (truncated && !busy && lastRendered >= history.length - 1) onLoadMore()
}, [truncated, busy, lastRendered, history.length, onLoadMore])
```

`onLoadMore`는 `App.tsx:1123`에서 `() => void store.loadMoreHistory()`로 **매 렌더 새로 만들어지는
참조**다(이 저장소는 `useCallback`을 쓰지 않고 React Compiler도 아직 없다 — E14b). 따라서 이 이펙트는
**렌더마다 재발화**한다. 지금까지 루프가 안 돌았던 유일한 이유는 `!busy`였다:

호출 → `busy: true` → 재렌더 → 이펙트 재발화 → `!busy`가 거짓이라 **호출 안 함** → 완료 →
`busy: false` + `history` 증가 → 조건 자체가 거짓 → 정지.

`loadMoreHistory`가 `busy`를 안 켜게 되는 순간 이 사슬이 끊기고, 호출 → `reads` 변경 → 재렌더 →
새 `onLoadMore` → 이펙트 재발화 → 호출 …이 무한히 돈다.

**즉 `busy`는 "UI를 잠그는 표시"이자 동시에 "이펙트가 스스로를 다시 부르는 것을 막는 차단기"였다.**
스펙 §2-5의 "소비처는 대부분 손대지 않는다"는 첫 역할만 보고 쓴 문장이고, 두 번째 역할을 놓쳤다.

**조치:** 이펙트의 의도는 "바닥에 닿았고 **아무것도 불러오는 중이 아닐 때** 더 불러온다"이다.
`!busy`가 표현하던 그 의도를 새 상태로 다시 쓴다 — `!busy && !pending`(여기서 `pending`은
`reads.right > 0`, §2-3의 표시와 같은 값이다). Task 4가 이 패널에 `pending`을 이미 내려주므로
새 배선이 필요 없다.

**~~전수 확인~~ — 이 문장은 틀렸다 (최종 적대적 리뷰가 정정).** 초안은 "`useEffect` 안에서 `busy`를
차단기로 쓰는 곳은 이 한 곳뿐이고 나머지 117곳은 전부 표시용"이라고 썼다. `!busy`만 grep한
불완전한 조사였다. **`isDisabled={busy}`로 위장한 경합 가드가 두 곳 더 있다** — 둘 다 자기 주석에
목적을 명시하고 있었다:

- `components/DiffPanel.tsx:13` — *"in-flight selectFile이 clear를 덮어쓰는 레이스 방지 — busy 중엔 닫기도 잠근다"*
- `components/BranchesPanel.tsx:219` — *"in-flight revive가 clear를 덮어쓰는 레이스 방지"*

조회가 `busy`를 안 켜게 되면서 이 두 버튼이 조회 중에도 활성이 되고, 주석이 막던 경합이 **UI로
도달 가능해진다**(리뷰 실측: 닫은 뒤 선택이 `a.txt`로 되살아남). 근본 해법은 §2-4-2다.

**교훈:** `busy`의 역할을 "표시"와 "차단기"로 나눠 세려면 `!busy`가 아니라 **`busy`의 모든 사용처를
읽어야** 한다. `isDisabled={busy}`는 겉보기에 표시지만 실제로는 차단기일 수 있다.

### 2-4-2. seq는 target 안에서만 돈다 — 교차 무효화가 필요하다 (최종 리뷰 Blocking 2건)

§2-2의 target 모델은 **"각 target은 서로 겹치지 않는 상태를 소유한다"**고 암묵적으로 가정했다.
거짓이다. 리뷰가 실측으로 두 경로를 깼다.

**(B1) `snapshot` 조회가 `center`·`right` 상태를 쓴다.** `refresh`/`externalRefresh`가 부르는
`reviveSelections`(`repository-store.ts:302`)는 `revived.selected` · `revived.diff` ·
`revived.commitDetail`을 채운다 — 즉 보고 있던 파일을 재조회해 되살린다(E7d ⑤). 그런데 `seq`는
target별이라 `snapshot`과 `center`가 서로를 무효화하지 못한다:

```
창 포커스 복귀 → refresh 시작 → 사용자가 b.txt 클릭 → refresh의 revive가 늦게 끝남
→ 화면에 a.txt가 남는다
[실측] 마지막으로 누른 파일=b.txt · 화면에 남은 파일=a.txt
```

`refresh`의 지연 구간은 revive + `hosting().status()`(gh CLI 셸아웃)까지라 수백 ms급이다.
**이 에픽이 막으려던 바로 그 실패 모드**(다른 파일의 diff가 남는다)가 교차 target 경로로 열려 있었다.

**(B2) `runWrite`가 in-flight 조회를 무효화하지 않는다.** `openRepository`가 도는 동안 이전
저장소의 조회가 끝나면, **새 저장소 화면에 옛 저장소의 선택이 되살아난다**:

```
[실측] repoPath=/other 인데 남은 선택= a.txt (/repo의 파일)
```

main에서는 같은 시나리오가 다른 방식으로 깨져 있었다(조회가 잡은 `busy` 때문에 `openRepository`
자체가 무시됐다) — 어느 쪽도 옳지 않지만 E14a는 **저장소 간 내용 유출**이라는 새 모양을 만든다.

**조치 — 무효화를 1급 연산으로 만든다.**

1. `runRead`에 `writes?: ReadTarget[]`를 더한다(기본값 `[target]`). 시작할 때 `writes`의 **모든**
   target seq를 올리고, `isCurrent()`는 **전부**에서 최신일 때만 참이다. `target`은 그대로 표시용
   (스피너가 뜰 자리)이고, `writes`는 "이 조회가 실제로 건드리는 상태"다.

   **`refresh`·`externalRefresh`의 `writes`는 `['snapshot', 'center', 'right', 'left']`다** —
   `reviveSelections`가 `selected`·`diff`(center) · `commitDetail`(right) 뿐 아니라
   **`branchCompare`(left)까지**(`repository-store.ts:355`) 되살린다. 초안이 `left`를 빠뜨렸는데,
   그러면 비교 뷰에 B1과 똑같은 버그가 그대로 남는다 (구현자 실측으로 정정).

### 2-4-3. 배경 새로고침은 사용자의 선택을 이기면 안 된다 (§2-4-2의 후속 정정)

§2-4-2의 `writes`는 **"claim(선점)"과 "defer to(양보)"를 뭉갰다.** 그래서 거울상 버그가 생긴다:

```
사용자가 b.txt 클릭(조회 시작) → 그 직후 창 포커스 복귀로 refresh 시작
→ refresh가 center seq를 잡아 사용자의 클릭을 무효화
→ refresh가 자기 시작 시점에 읽은 a.txt를 되살린다
[실측] 마지막으로 누른 파일=b.txt · 화면에 남은 파일=a.txt
```

**이건 `main` 대비 회귀다.** main에서는 `selectFile`이 켠 `busy` 때문에 포커스 `refresh`가 `guard`에
거부돼 `b.txt`가 그대로 남았다 — 올바른 동작이었다.

**규칙:** 사용자가 시작한 조회는 배경 조회를 이긴다. 반대는 성립하지 않는다.

- `selectFile` 같은 **사용자 조회**는 자기 target을 **선점**한다(seq를 올린다).
- `refresh`·`externalRefresh` 같은 **배경 조회**는 `snapshot`만 선점하고, `center`·`right`·`left`에는
  **양보**한다 — 시작 시점의 seq를 기억해 두었다가, 착지할 때 그 target이 그사이 선점됐으면
  **해당 필드만 버린다**(스냅샷의 나머지는 여전히 유효하므로 통째로 버리지 않는다).

즉 `runRead`의 인자는 `writes`(선점) 하나가 아니라 `claims`와 `defersTo` 두 갈래다. `defersTo`는
착지 시점에 "그사이 남이 가져갔는가"만 묻고 자신은 아무것도 잡지 않는다.
2. `invalidateReads()`를 `run-guard`에서 내보내 **모든 target의 seq를 한 칸씩 올린다.** 호출처:
   - `runWrite` 진입 — 쓰기는 상태를 갈아엎으므로 진행 중이던 조회 결과는 전부 낡았다 (B2 해소)
   - `clearSelection()` · 비교 뷰 닫기 — "닫았으면 닫힌 채로" (I1의 근본 해소)

`isDisabled={busy}` 두 곳은 그대로 둔다 — 경합은 이제 스토어에서 막히므로 그 버튼의 비활성은
**쓰기 중 잠금**이라는 원래 의미만 남는다. 주석은 그 사실에 맞게 고친다.

### 2-5. 소비처 118곳 — 대부분 손대지 않는다

`busy`의 **의미**가 "저장소를 바꾸는 중"으로 좁아질 뿐 이름과 타입은 그대로다. 따라서 헤더·사이드바
비활성은 커밋·병합·푸시 때만 걸리게 되고, 이는 원래 그 코드가 의도했던 동작이다.

`CommitForm.tsx:24`의 `'작업 중이에요'`도 그대로 둔다 — 이제 진짜 작업 중에만 뜬다.

이것이 A안(대상별 카운터)을 고른 핵심 이유다: **코드 수정이 스토어에 집중되고 소비처는 무변**이라
118곳을 하나씩 판단하는 일이 생기지 않는다.

---

## 3. 테스트

### 3-1. 단위 — `test/run-guard.test.ts` (가짜 `set`/`get`)

- `runRead`가 `busy`를 켜지 않는다
- `runRead`가 대상별 카운터를 올렸다 내린다 (성공·실패 양쪽)
- **늦게 온 조회의 결과가 최신 결과를 덮지 않는다** — 느린 A·빠른 B를 겹쳐 돌리고, A의
  `isCurrent()`가 `false`임을 확인한다 (§2-1 교정의 회귀 테스트)
- 늦게 온 조회 실패가 최신 `error`를 덮지 않는다
- 서로 다른 target의 조회는 상대의 `isCurrent()`를 무너뜨리지 않는다
- `runWrite`의 재진입 거부·`error`/`notice` 초기화·억제 창 무장이 기존과 동일하다
- `runWrite` 중에도 `runRead`가 시작된다 (§2-4의 동시성 결정)

### 3-2. E2E — 실측을 그대로 테스트로

앞 둘은 컨트롤러가 프로브로 미리 돌려 검출력을 확인한 형태다(§1의 숫자가 그 출력이다).

1. **파일 클릭 중 헤더 잠금 0건** — **이미 한 파일이 선택된 상태에서** 다른 파일로 옮기는 동안
   `.app__header` 하위의 `disabled`/`data-disabled` 변형이 0. (지금 30)
   *A→B로 재는 이유:* "선택 없음 → 첫 파일"은 좌측 행 액션이 정당하게 활성화되므로
   (실측: `disabled` 대상 20→3) 좌측 변형 0을 요구할 수 없다. A→B에서는 그 정당한 변화가 이미
   끝나 있어, 남는 변형은 전부 `busy` 탓이다. 같은 이유로 좌측은 `disabled` 개수 대신
   **커밋 컴포저 텍스트가 `'작업 중이에요'`로 바뀌지 않는다**를 단언한다(그게 눈에 보이는 증상이다).
2. **외부 저장 중 헤더 잠금 0건** — 앱 밖에서 파일을 쓰는 동안 같은 측정이 0. (지금 20)
   여기서는 사용자가 앱을 만지지 않았으므로 좌측 `disabled` 변형도 0을 요구할 수 있다.
3. **커밋이 도는 중에도 파일 클릭이 동작한다** — §2-4의 결정을 고정한다.
4. **느린 조회는 로딩이 뜨고 빠른 조회는 안 뜬다** — 400ms 지연이 실제로 그 역할을 하는지.

3·4는 시간에 의존하므로 고정 sleep 대신 재측정(`toPass`/`poll`)으로 짠다.

### 3-3. `busy`를 계측 도구로 쓰던 기존 E2E는 갱신해야 한다

`E10 — 창이 포커스를 받으면 파일 변화 없이도 재조회가 돈다`는 새로고침 **버튼의 `disabled` 토글
횟수**로 재조회를 셌다. 그 토글이 바로 이 에픽이 없애는 대상이라, 동작은 그대로인데 **계측 도구가
사라져** 실패한다. 제품 회귀가 아니다.

계측을 바꾼다: 렌더러에 이미 노출된 `window.gitApi.status`를 테스트 쪽에서 감싸 호출 횟수를 센다.
프로덕션 코드 변경이 0이고, 프록시(버튼 상태)가 아니라 **실제로 재조회가 일어났는가**를 직접 재므로
원래 테스트보다 낫다. `contextBridge`가 노출한 객체가 감싸지지 않으면 그 사실을 보고하고 대안을 정한다.

**반증 필수:** 각 테스트는 수정을 되돌린 상태에서 실제로 빨개지는 것을 재빌드 후 확인한다.
`npx playwright test`는 빌드하지 않는다 — `pnpm --filter @git-gui/desktop e2e`를 쓴다.

---

## 4. 이 에픽에서 하지 않는 것

- **구독 셀렉터화·`React.memo`** — App이 셀렉터 없이 스토어 전체를 구독(`App.tsx:95`)하고 셀렉터
  사용처가 0건이라 모든 스토어 변경이 전체 트리를 리렌더한다. 다만 §1의 헤더 측정에서 텍스트 변경이
  0인데 속성만 30번 바뀐 것이 보여주듯, **깜빡임의 원인은 리렌더가 아니라 `busy`다.** 별도 건.
- **React Compiler·eslint·Rules of React 위반 수정** — E14b로 분리했다. `HistoryPanel.tsx:204`의
  렌더 중 ref 쓰기는 E7i 리뷰가 실측 재현으로 잡은 버그를 고치려 일부러 넣은 가드라, 건드리면 그
  회귀를 다시 열 수 있다. busy 변경과 한 브랜치에 섞으면 원인 분리가 어려워진다.
- **좌측 `name`×36 · `type`×18 속성 처닝** — §1-1 표에 잡힌 별개 냄새(입력 요소 속성이 다시
  세팅됨 — key 불안정이나 react-aria id 재생성 의심). 원인이 다르므로 후속 노트로 남긴다.

---

## 5. 성공 기준

이미 한 파일을 보고 있는 상태에서 다른 파일로 옮기거나, 에디터에서 파일을 저장할 때
**가운데 diff 말고는 아무것도 변하지 않는다** — 헤더·우측의 `disabled` 변형 0건,
커밋 컴포저 텍스트 변경 0건.

커밋·병합·푸시 같은 진짜 작업일 때는 지금과 똑같이 전역이 잠긴다 — 이 에픽은 잠금을 없애는 게
아니라 **조회를 잠금에서 빼는** 것이다.
