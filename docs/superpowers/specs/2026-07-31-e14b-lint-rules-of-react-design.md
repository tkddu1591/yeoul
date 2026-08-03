# E14b — eslint 게이트 + Rules of React 위반 해소 설계

**한 줄:** React 규칙을 검사하는 게이트를 처음으로 세우고, 그 게이트가 잡아낸 위반 중 이득이 명확한 것을 고친다.

E14a 후속. E14a가 `busy` 구역화를 하며 드러낸 것 — **이 저장소에는 lint 게이트가 하나도 없고,
`eslint-disable react-hooks/exhaustive-deps` 16곳이 한 번도 검사된 적이 없다.**

---

## 1. 실태 (실측)

`eslint@10` + `eslint-plugin-react-hooks@7.1.1` recommended를 `apps/desktop/src/renderer/src`에
돌린 결과다. 저장소는 건드리지 않고 스크래치패드에서 쟀다.

### 1-1. 억제를 존중했을 때 — 19건 (에러 11 · 경고 8)

| 규칙 | 수 | 정체 |
| --- | --- | --- |
| `react-hooks/incompatible-library` | 5 | `useVirtualizer` — `Compilation Skipped: Use of incompatible library` |
| `react-hooks/purity` | 5 | 렌더 중 `Date.now()` |
| `react-hooks/set-state-in-effect` | 4 | 이펙트에서 `setState` 직접 호출 |
| `react-hooks/refs` | 1 | `Tooltip` — 렌더 중 ref 접근 |
| `react-hooks/immutability` | 1 | `Tooltip` — `children` 수정 |
| (불필요한 `disable`) | 3 | `App.tsx:221` · `:355` · `:471` — 아무것도 안 막는다 |

### 1-2. 억제를 무시했을 때 — 30건

```
14  react-hooks/exhaustive-deps      ← 억제 13곳이 실제로 가리고 있던 것
 5  react-hooks/purity
 5  react-hooks/incompatible-library
 4  react-hooks/set-state-in-effect
 1  react-hooks/refs
 1  react-hooks/immutability
```

가려져 있던 14건의 성격:

| 위치 | 빠진 의존성 | 왜 뺐나 |
| --- | --- | --- |
| `App.tsx:349` · `:367` · `:489` | `store` | App이 스토어 **전체**를 구독해 넣으면 매 변경마다 재실행 |
| `TerminalDock.tsx` ×5 | `sessions` 등 | 매 렌더 새 객체 — 넣으면 무한 루프 |
| `HistoryPanel.tsx:246` | `jumpTo` · `onSearch` · `findPos` · 복합식 | E7i 리뷰가 플레이크를 잡으며 손본 이펙트 |
| `HistoryPanel.tsx:277` · `ConflictPanel` ×2 | `virtualizer` · `items` | 가상화 인스턴스가 매 렌더 새 참조 |
| `AddWorktreeDialog.tsx:55` | `available` · `mainPath` | 열릴 때 1회만 초기화하려고 |

**대부분이 "무해한 억제"가 아니라 불안정 참조를 피하려고 일부러 뺀 것**이고, 그대로 넣으면
무한 루프가 된다 — E14a가 `HistoryPanel`에서 정확히 그것(React error #185)을 겪었다.

### 1-3. 컨트롤러가 E14a 때 한 두 주장은 틀렸다

- **"`exhaustive-deps` 억제 16곳도 컴파일러 바일아웃 위험"** — `exhaustive-deps`는 lint 사안이지
  컴파일 바일아웃 사유가 아니다. 실제 바일아웃(`Compilation Skipped`)은 `incompatible-library`
  5건뿐이다.
- **"`HistoryPanel`의 렌더 중 ref 쓰기 때문에 컴파일러가 확실히 건너뛴다"** — 그 코드는 **잡히지도
  않는다.** `HistoryPanel`이 건너뛰어지는 진짜 이유는 `useVirtualizer`다. E7i 리뷰가 넣은 그 가드는
  이 에픽에서 건드릴 필요가 없다.

**둘 다 확인 없이 한 말이었다.** 도구에 한 번 물어보니 조사 대상이 통째로 바뀌었다.

---

## 2. 범위

이 에픽은 **eslint 게이트 + 위반 14건 + 리렌더 측정 기준선**이다.

- `exhaustive-deps` 14건 → **E14c**(참조 안정화). 억제를 유지한 채 통과시킨다.
- React Compiler 도입 → **다음 에픽.** §6의 측정 결과를 보고 판단한다.
- `@tanstack/react-virtual` 교체 → 같은 판단에 종속.

**왜 컴파일러를 지금 안 붙이나.** E14a에서 깜빡임의 원인이 리렌더가 아니라 `busy`였다는 게 실측으로
드러났다(헤더 텍스트 변경 0 · 속성만 30). 남은 리렌더 비용은 **아무도 재본 적이 없다.** 게다가
컴파일러가 건너뛰는 5개가 하필 가장 무거운 가상 스크롤 목록들이라, 기대 이득의 상당 부분이 정작
비용이 큰 곳에서 실현되지 않는다. 재고 나서 정한다.

---

## 3. eslint 게이트

`eslint@10` · `eslint-plugin-react-hooks@7` · `typescript-eslint`(파서 전용).

- **대상은 `apps/desktop/src/renderer/src`만.** `packages/*`·`src/main`은 React 코드가 아니라
  이 규칙이 할 일이 없다.
- **규칙은 `react-hooks` recommended만.** `typescript-eslint` 권장 규칙셋을 모노레포 전체에 켜면
  수백 건이 쏟아지는데 이 에픽의 목적이 아니다 (YAGNI).
- 루트 `package.json`에 `lint` 스크립트를 더하고 **최종 게이트 목록에 넣는다**(typecheck · test ·
  build · e2e · **lint**).
- `--max-warnings`는 걸지 않는다 — `incompatible-library` 5건이 경고로 상주하기 때문이다.
  **에러 0**이 게이트 조건이다.
- `reportUnusedDisableDirectives`를 켠다. 그래야 §4-5의 죽은 억제가 다시 쌓이지 않는다.

**억제에는 이유를 요구한다.** 남기는 `exhaustive-deps` 억제 13곳은 각각 바로 위에 **왜 안전한지**
한 줄을 단다. 지금은 근거 없는 것도 있다. E14c가 그 줄을 읽고 판단하게 된다.

---

## 4. 고치는 것

### 4-1. `purity` 5건 — 렌더 중 `Date.now()`

`BranchSwitcher:47` · `BranchesPanel:376` · `ReviewDetailPanel:42` · `ShelfPopover:81` ·
`WorktreesPanel:132`. 다섯 다 `formatRelativeTime(x, Date.now())` 한 패턴이다
(`components/relative-time.ts:2` — `(epochSeconds, nowMs)`).

`useNow()` 훅 하나를 만들어 `nowMs`를 넘긴다. 틱 주기는 **60초**.

**타이머는 모듈 하나가 소유하고 구독자에게 나눠 준다.** 컴포넌트마다 `setInterval`을 걸면 5개가
따로 돌고 서로 다른 프레임에 깨어나 화면이 조금씩 어긋난 시각을 보인다. `useNow()`는 공용 타이머를
구독만 하고, 구독자가 0이 되면 타이머를 멈춘다.

**이건 실제 버그도 같이 고친다.** 지금은 상대 시각이 다른 이유로 리렌더될 때까지 "3분 전"에
멈춰 있다 — 시간이 흘러도 화면이 안 바뀐다. 틱이 그걸 해소한다.

60초 틱이 만드는 리렌더 비용은 §6에서 측정해 기록한다. 무시할 수준일 것으로 보지만 **재고 적는다.**

### 4-2. `set-state-in-effect` 4건

셋은 같은 모양("열릴 때/바뀔 때 로컬 상태 초기화")이고 하나는 다르다.

- **`ui/PromptDialog.tsx:42`** — 열릴 때 `initialValue`로 채우고 닫힐 때 비운다.
- **`components/AddWorktreeDialog.tsx:45`** — 열릴 때 폼 전체를 초기화한다.
- **`App.tsx:501`** — `repoPath`가 바뀌면 `setFindScope(null)`.

셋 다 React 공식 처방인 **`key`로 remount**를 적용해 이펙트를 없앤다.

> **주의 — `PromptDialog`는 E1a가 건 요구사항이 있다:** *"실패로 열려 있는 동안에는 입력이
> 보존된다."* `key`가 그걸 깨면 안 된다. `isOpen`만 key에 넣으면 열려 있는 동안에는 remount가
> 없으므로 보존된다. **회귀 테스트로 고정한다.**

- **`App.tsx:467`** — 성격이 다르다. `commitDetail`이 `null→값`으로 바뀔 때 우측 열을 편다.
  `ShelfPopover onPreview`처럼 **밖에서 `selectCommit`을 부르는 경로**가 있어 이펙트로 중앙집중한
  것이다. 두 안이 있고 플랜에서 고른다:
  - (a) 호출부마다 `expandRightIfCollapsed()`를 부른다 — 중앙집중이 깨지고 새 호출부가 생기면 빠뜨린다.
  - (b) 스토어가 "우측을 펴야 한다"는 신호를 준다 — 배선이 늘지만 한 곳이다.

### 4-3. `refs` · `immutability` 2건 — `ui/Tooltip.tsx:103` · `:109`

`cloneElement`가 `children`의 원본 ref에 직접 써서 걸린다. E7j가 만든 공용 컴포넌트이고
**호출부가 19곳**이다.

먼저 깔끔한 해법을 시도한다 — 원본 ref를 콜백 **밖에서** 지역 변수로 뽑아 `children`을 콜백 안에서
읽지 않게 한다.

**그것으로 `immutability`가 안 풀리면 근거를 적은 명시적 억제를 허용한다.** ref 병합은 본래 남의
ref 객체에 쓰는 일이고, 19곳을 깨뜨릴 위험을 감수할 만한 이득이 없다. 억제할 경우 **왜 안전한지와
무엇을 시도했는지**를 주석에 남긴다.

### 4-4. 불필요한 억제 3건 삭제

`App.tsx:221` · `:355` · `:471`. 아무것도 안 막는다.

### 4-5. 고치지 않는 것 — `incompatible-library` 5건

`ChangesPanel:170` · `CommitDetailPanel:130` · `ConflictPanel:80` · `DiffView:73` ·
`HistoryPanel:187`. 전부 `useVirtualizer`.

`@tanstack/react-virtual`은 **v3가 마지막**이고(설치 3.14.6 · 최신 3.14.9, 패치 차이뿐) 업스트림
수정이 없다. 우리 코드로 고칠 수 없다. **경고로 두고 기록한다** — 이 5개가 컴파일러에서 빠진다는
사실 자체가 다음 에픽의 판단 근거다.

완화책(가상화 부분만 잎 컴포넌트로 빼 부모는 컴파일되게)은 존재하지만, 이득이 측정되기 전에는
하지 않는다.

---

## 5. 테스트

- **`useNow()` 단위 테스트** — 공용 타이머가 하나만 돌고, 구독자가 0이 되면 멈추고, 틱마다 값이
  갱신되는가. 순수 로직이라 이 저장소의 다른 순수 모듈처럼 가짜 타이머로 잰다.
- **`PromptDialog` 회귀 E2E — 새로 만들어야 한다.** 확인 결과 "실패로 열려 있는 동안 입력이
  보존된다"(E1a)를 고정하는 테스트가 **저장소에 없다.** 즉 `key` 도입이 그 요구사항을 깨도 지금은
  아무도 못 잡는다. **이 테스트를 먼저 쓰고(현재 코드에서 초록임을 확인) 그다음 `key`를 도입한다** —
  순서를 지켜야 "원래 되던 것"임을 증명할 수 있다.
- **`AddWorktreeDialog` 회귀 E2E** — 닫았다 다시 열면 폼이 초기화된다. 같은 순서로 넣는다.
- **기존 게이트** — typecheck 6/6 · build · e2e 124(+회귀 2건) · 단위 600(+`useNow`).

새 E2E는 반드시 **반증**한다(수정을 되돌려 빨개지는 것을 재빌드 후 확인).

---

## 6. 리렌더 측정 기준선

다음 에픽(컴파일러·가상 스크롤)이 값어치를 하는지 판단할 숫자를 남긴다. **이 에픽의 산출물 중
가장 오래 쓰일 것이다.**

네 가지 조작에서 **컴포넌트별 렌더 횟수와 커밋 시간**을 잰다:

1. 파일 A→B 클릭
2. 에디터에서 외부 저장 (`externalRefresh`)
3. 히스토리 스크롤로 더 불러오기
4. 터미널에 한 줄 입력

측정은 `React.Profiler`의 `onRender`로 하고, 계측 코드는 **프로덕션에 남기지 않는다**(E14a의
MutationObserver 프로브와 같은 방식 — 임시 스펙으로 재고 결과만 문서에 남긴다).

`useNow()`의 60초 틱이 더하는 비용도 같은 표에 넣는다.

결과는 이 스펙에 표로 박고, 플랜 「실행 기록」에도 남긴다.

---

## 7. 성공 기준

- `pnpm lint`가 **에러 0**으로 통과한다. 남는 경고는 `incompatible-library` 5건뿐이다.
- 억제된 `exhaustive-deps` 13곳에 **각각 왜 안전한지 한 줄**이 붙어 있다.
- 기존 게이트가 그대로다 — typecheck 6/6 · build · 단위 600(+`useNow`) · e2e 124(+회귀 2건).
- 리렌더 기준선 표가 §6에 채워져 있다.
- 상대 시각이 시간이 지나면 실제로 갱신된다(4-1의 부수 효과).
