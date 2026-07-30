# E13 접기 모션 + 부팅 흰 화면 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사이드 접기와 터미널 도크가 부드럽게 열리고 닫히게 하고, 앱을 켤 때 흰 화면이 뜨지 않게 한다.

**Architecture:** 순수 함수(트랙 문자열 조립) → `gap`을 트랙으로 이관 → 열 전환 → 도크 행 전환 → 부팅 흰 화면 → E2E.

**Tech Stack:** Electron main(`BrowserWindow` 옵션·`ready-to-show`), CSS grid 트랙 보간, Vitest 순수 단위, Playwright Electron E2E.

**게이트 기준선(실측):** 루트 `pnpm test` **545** · `pnpm --filter @git-gui/desktop e2e` **113**(smoke 107 + hosting 6) · typecheck 6/6. **루트에 `build` 스크립트가 없다 — `pnpm --filter @git-gui/desktop build`.**

⚠️ **모든 Playwright 실행은 단일 포그라운드 Bash 호출 + `timeout: 600000`.**
⚠️ **자기가 띄우지 않은 Electron 프로세스는 건드리지 않는다** — 사용자가 개발 앱을 쓰고 있다(PID 47316 계열). **OS 전체 화면 캡처 금지.**

**실측 근거:** 부팅 — 창 노출 **434ms** · React 첫 렌더 518ms · 완성 **714ms** · 렌더러 FCP 188ms(개발 빌드, 웜). `--color-surface` 라이트 `#ffffff` / 다크 `#1e2128`.

---

### Task 1: 트랙 문자열 조립을 순수 함수로 (TDD)

**Files:**
- Create: `apps/desktop/src/renderer/src/ui/grid-tracks.ts`
- Test: `apps/desktop/test/grid-tracks.test.ts`

지금 `App.tsx:266-273`이 트랙 문자열을 인라인으로 조립하면서 **접힌 열의 트랙을 아예 뺀다.** 없어진 것에서 전환할 수 없으므로 트랙을 **`0px`로 남겨야** 하는데, 그러면 `gap`이 그대로 남는다(CSS grid의 `gap`은 트랙이 0이어도 계산된다 — E11 Task 4 실측). 그래서 **간격도 트랙으로** 옮긴다.

- [x] **Step 1: 실패하는 테스트 먼저.** `apps/desktop/test/grid-tracks.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildMainColumns, MAIN_GAP, RESIZER_WIDTH } from '../src/renderer/src/ui/grid-tracks'

/** 트랙 문자열의 px 합 — 간격을 트랙으로 옮겼으므로 합이 곧 콘텐츠 폭이어야 한다 */
function sum(template: string): number {
  return template
    .split(' ')
    .filter((t) => t.endsWith('px'))
    .reduce((total, t) => total + Number(t.replace('px', '')), 0)
}

describe('buildMainColumns', () => {
  it('둘 다 펼침 — 좌·간격·중앙·간격·리사이저·간격·우 순서', () => {
    const template = buildMainColumns({ left: 380, right: 360 }, {})
    expect(template).toBe(
      `380px ${MAIN_GAP}px minmax(0, 1fr) ${MAIN_GAP}px ${RESIZER_WIDTH}px ${MAIN_GAP}px 360px`,
    )
  })

  it('좌측 접힘 — 트랙을 빼지 않고 0으로 둔다(전환의 시작점이 있어야 한다)', () => {
    const template = buildMainColumns({ left: 0, right: 360 }, { left: true })
    expect(template.startsWith('0px 0px minmax(0, 1fr)')).toBe(true)
  })

  it('우측 접힘 — 리사이저와 그 간격까지 0이다', () => {
    const template = buildMainColumns({ left: 380, right: 0 }, { right: true })
    expect(template).toBe(`380px ${MAIN_GAP}px minmax(0, 1fr) 0px 0px 0px 0px`)
  })

  it('양쪽 접힘 — 중앙만 남는다', () => {
    expect(buildMainColumns({ left: 0, right: 0 }, { left: true, right: true })).toBe(
      '0px 0px minmax(0, 1fr) 0px 0px 0px 0px',
    )
  })

  it('트랙 개수는 접힘과 무관하게 항상 같다 — 개수가 변하면 보간이 아니라 점프가 된다', () => {
    const count = (t: string) => t.split(' ').length
    const open = count(buildMainColumns({ left: 380, right: 360 }, {}))
    expect(count(buildMainColumns({ left: 0, right: 360 }, { left: true }))).toBe(open)
    expect(count(buildMainColumns({ left: 380, right: 0 }, { right: true }))).toBe(open)
    expect(count(buildMainColumns({ left: 0, right: 0 }, { left: true, right: true }))).toBe(open)
  })

  it('펼침 상태의 px 합 = 열 + 간격 3 + 리사이저', () => {
    expect(sum(buildMainColumns({ left: 380, right: 360 }, {}))).toBe(
      380 + 360 + MAIN_GAP * 3 + RESIZER_WIDTH,
    )
  })
})
```

**"트랙 개수가 항상 같다"가 이 태스크의 핵심 불변식**이다 — 개수가 달라지면 Chromium이 보간하지 못하고 그냥 점프한다.

- [x] **Step 2: 실패 확인.** `npx vitest run apps/desktop/test/grid-tracks.test.ts` — 모듈 없음. 출력을 그대로 보고한다.

- [x] **Step 3: 구현.** `grid-tracks.ts`:

```ts
import type { ColumnCollapse } from './column-resize'

/** layout.css의 gap과 짝 — 간격을 트랙으로 옮겼으므로 여기가 정본이다 (E13) */
export const MAIN_GAP = 16
/** 우측 폭 조절 손잡이 */
export const RESIZER_WIDTH = 6

/**
 * .app__main의 열 트랙 문자열 (E13) — 접힌 열도 **트랙을 유지하고 0px로** 둔다.
 * 트랙을 빼면 전환의 시작점이 사라지고, 트랙만 0으로 두면 grid의 gap이 남는다
 * (gap은 트랙 크기와 무관하게 계산된다 — E11 Task 4 실측). 그래서 gap도 트랙으로 옮겨
 * 열·간격·리사이저가 **한 속성 안에서 함께 보간**되게 한다. 트랙 개수는 항상 7로 고정 —
 * 개수가 달라지면 보간이 아니라 점프가 된다
 */
export function buildMainColumns(
  columns: { left: number; right: number },
  collapse: ColumnCollapse,
): string {
  const leftGap = collapse.left === true ? 0 : MAIN_GAP
  const rightSide = collapse.right === true ? [0, 0, 0] : [MAIN_GAP, RESIZER_WIDTH, MAIN_GAP]
  return [
    `${columns.left}px`,
    `${leftGap}px`,
    'minmax(0, 1fr)',
    ...rightSide.map((px) => `${px}px`),
    `${columns.right}px`,
  ].join(' ')
}
```

`ColumnCollapse` 타입은 E12가 `column-resize.ts`에 만들어 뒀다 — **실독해 정확한 이름·형태를 확인**하고 맞춘다.

- [x] **Step 4: 게이트.** `pnpm test` — **551**(545 + 6). 실제 숫자를 보고한다.

- [x] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/ui/grid-tracks.ts apps/desktop/test/grid-tracks.test.ts
git commit -m "feat(desktop): E13 열 트랙 조립 순수 함수 — 간격을 트랙으로

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: 열 전환 — gap 이관 + 안전망 허용 확장

**Files:** `layout.css` · `App.tsx` · `apps/desktop/test/motion-tokens.test.ts`

- [x] **Step 1: `gap`을 없앤다.** `layout.css:174-184`의 `.app__main`에서 `gap: var(--space-4)`를 제거한다. **행 간격도 같이 사라지므로** 2행(도크)과의 간격을 Task 3에서 행 트랙으로 되살려야 한다 — 이 태스크가 끝난 시점에 도크가 붙어 보이는 것은 **의도된 중간 상태**이고, Task 3에서 닫힌다. 커밋 메시지에 그 사실을 적는다.

- [x] **Step 2: 접힌 열을 유지 마운트.** `App.tsx`에서 접혔을 때 `.app__left`·`.app__resizer`·`.app__right`를 **언마운트하지 않고** 유지하되 `overflow: hidden`으로 감춘다(0px 트랙 안에서 내용이 새지 않게). E11 Task 4가 상세 슬롯에서 쓴 것과 같은 수법이다.
  ⚠️ **E12가 "닫으면 DOM에서 사라진다"에 기대는 것이 있는지 확인하라** — 특히 ⌘F 스코프 라우팅(`data-find-scope`)은 접힌 패널이 언마운트라 "잡히지 않는다"는 성질에 의존한다고 E12 보고가 적었다. 유지 마운트로 바꾸면 **접힌 패널이 ⌘F 대상으로 잡힐 수 있다.** 접힘 시 `data-find-scope`를 떼거나 다른 방법으로 막고, **어떻게 했는지 보고한다.**

- [x] **Step 3: 트랙 문자열을 Task 1 함수로.** `App.tsx:266-273`의 인라인 조립을 `buildMainColumns`로 교체한다. `dockGridColumn` 계산(`:278-279`)은 **트랙 개수가 이제 항상 7로 고정**이므로 그에 맞게 다시 쓴다 — 도크는 좌측 열과 그 간격을 건너뛴 3번째 트랙부터 끝까지다.

- [x] **Step 4: 전환.** `layout.css`의 `.app__main`에 `transition: grid-template-columns var(--motion-slow) var(--ease-in-out)`.

- [x] **Step 5: 안전망 허용 확장.** `motion-tokens.test.ts`가 `grid-template-columns`를 **금지 목록**에 넣어 두었다(실측 `:51`) — 이 태스크가 그 규칙을 정면으로 어긴다. `grid-template-rows`만 허용하던 예외를 **`grid-template-columns`까지** 넓히고, **왜 두 개만 예외인지**(Chromium이 보간하는 grid 트랙 경로) 주석에 남긴다. `grid-template`·`grid-template-areas` 금지는 **유지**한다.
  ⚠️ **허용 목록을 넓힌 뒤 안전망이 여전히 무는지 재확인하라** — `transition: grid-template-columns, height`가 여전히 실패해야 한다. 확인 출력을 붙인다.

- [x] **Step 6: 전환을 꺼야 하는 세 순간.** 다음에는 전환이 돌면 안 된다. 각각 실제로 확인하고 보고한다:
  - **앱 시작** — 접힌 상태로 저장돼 있으면 첫 페인트에 240ms 애니메이션이 돈다. 부팅이 느려 보이는 것과 구별되지 않는다. 초기 렌더에 억제 클래스를 씌우고 첫 프레임 뒤 푼다(E11 `theme-switching`과 같은 기법 — **그 구현을 실독해 따르라**).
  - **드래그 리사이즈** — 커서를 1:1로 따라가야 한다. 드래그 중 전환 금지.
  - **창 리사이즈** — 열이 뒤따라오면 고무줄처럼 보인다.

- [x] **Step 7: 실측(필수).** (a) 접히는 240ms 동안 **프레임별** 트랙 폭이 단조 변화하는지(점프 없음) (b) 좌측 `ChangesPanel`·우측 `HistoryPanel`의 **가상 스크롤 행이 깨지지 않는지** — E11이 높이 방향에서 검증한 것과 같은 계열이지만 **폭 방향은 처음**이다 (c) 접힘 최종 폭이 E12와 동일한지(1200×800·960×600). **깨지면 이 태스크를 중단하고 보고하라** — 접힘 모션을 포기하고 도크만 남기는 것이 정답일 수 있다.

- [x] **Step 8: 게이트.** typecheck · 루트 551 · build · e2e **113 유지**(E12 접기 5건·E6a 열 폭이 특히 민감).

- [x] **Step 9: Commit**

```bash
git add apps/desktop/src apps/desktop/test
git commit -m "feat(desktop): E13 사이드 접기 전환 — 간격을 트랙으로 옮겨 계단 제거

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: 터미널 도크 행 전환

**Files:** `layout.css` · `App.tsx`

- [x] **Step 1: `display: none`을 걷어낸다.** `App.tsx:1108-1109`가 `style={{ display: dockOpen ? 'block' : 'none' }}`로 껐다 켠다. `display`는 보간되지 않는다 — 도크를 **항상 렌더**하고 `overflow: hidden`으로 두되, 2행 트랙을 `0px ↔ <높이>px`로 전환한다.

- [x] **Step 2: 행 트랙.** `.app__main`의 `grid-template-rows`는 지금 `minmax(0, 1fr) auto`다(`layout.css:179`). **`auto`는 보간되지 않는다** — 도크 높이는 `terminalHeight` 설정으로 이미 px를 알고 있으니 그 값을 쓴다. Task 2에서 없앤 **행 간격도 여기서 트랙으로** 되살린다(닫히면 0).

- [x] **Step 3: 전환.** `grid-template-rows`는 안전망이 이미 허용한다(E11). `--motion-slow` `--ease-in-out`으로 열과 같은 속도.

- [x] **Step 4: 도크 높이 드래그 중에는 전환 금지** — Task 2 Step 6과 같은 억제를 적용한다(두 전환이 겹치면 손보다 늦게 온다).

- [x] **Step 5: 실측(필수).** (a) 열고 닫는 동안 프레임별 높이가 단조 변화하는지 (b) **xterm이 깨지지 않는지** — 높이가 매 프레임 바뀌면 FitAddon이 재측정한다. E12가 창 폭 리사이즈용 리스너를 새로 달았을 만큼 민감한 곳이다 (c) 닫힌 뒤 중앙이 그만큼 커지는지.

- [x] **Step 6: 게이트.** typecheck · 루트 551 · build · e2e **113 유지**(E7b 도크 4건이 민감).

- [x] **Step 7: Commit**

```bash
git add apps/desktop/src
git commit -m "feat(desktop): E13 터미널 도크 행 전환 — display 토글 폐기

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: 부팅 흰 화면

**Files:** `apps/desktop/src/main/index.ts` · `apps/desktop/src/main/settings.ts`(읽기 노출) · `apps/desktop/src/renderer/index.html`

로고 스플래시는 **만들지 않는다** — 부팅이 714ms라 떴다 사라지는 로고가 오히려 번쩍임이다(스펙 ③).

- [x] **Step 1: 창 배경색.** `BrowserWindow` 옵션에 `backgroundColor`를 준다. 값은 **저장된 테마의 앱 배경색** — 라이트 `#ffffff` / 다크 `#1e2128`(`tokens.css:46`·`:105` `--color-surface` 실측). 앱이 실제로 칠하는 최상위 배경이 `--color-surface`가 맞는지 **실독으로 확인**하고, 다르면 그 값을 쓴다.
  `settings.ts`에는 내부 `loadSettings()`/`current()`가 있고 **읽기 함수가 export돼 있지 않다**(실측 — export는 `registerSettingsHandlers`·GitHub 토큰 계열뿐). 테마를 읽는 최소한의 export를 추가하되, **GitHub 토큰 계열을 노출하지 않도록** 범위를 좁게 잡는다(E3a가 토큰을 main 전용으로 못 박았다).

- [x] **Step 2: 그려진 뒤에 보여 준다.** `show: !isE2E || isE2EShow`(`index.ts:46`)를 `show: false`로 바꾸고 `window.once('ready-to-show', …)`에서 보여 준다.
  ⚠️ **E2E 숨김 규칙과 합성해야 한다** — E2E에서는 계속 숨어 있어야 하고(`isE2E && !isE2EShow`), `GIT_GUI_E2E_SHOW=1`일 때만 보인다. **기존 조건을 그대로 보존**하되 "보여 주는 시점"만 늦춘다. E2E가 `firstWindow()`로 창을 잡는 경로가 깨지지 않는지 확인하라(숨김 창도 첫 페인트는 일어난다 — `index.ts:45` 주석이 그 전제를 이미 적어 뒀다).

- [x] **Step 3: 테마를 React보다 먼저.** `index.html`에 배경을 미리 칠한다.
  ⚠️ **CSP가 인라인 `<script>`를 막는다** — `default-src 'self'`이고 `unsafe-inline`은 `style-src`에만 있다(`index.html` 실측). 그러므로 스크립트로 `localStorage`를 읽는 방식은 **불가능**하다. 게다가 이 앱은 `file://` origin이라 localStorage가 영속되지 않는다(E0-3b 실측 — 그래서 설정이 main에 있다).
  → **main이 아는 값을 렌더러 첫 페인트 전에 반영하는 경로**를 찾아야 한다. 후보: `backgroundColor`만으로 충분한지(창 배경이 이미 테마색이면 body가 투명한 동안 그 색이 보인다), 아니면 preload에서 `document.documentElement`에 `data-theme`을 먼저 붙이는 방법(preload는 CSP의 제약을 받지 않는다). **어느 쪽이 실제로 되는지 측정해서 정하고, 근거를 보고하라.**

- [x] **Step 4: 실측(필수).** 부팅을 **다시 재고** 전후를 비교한다: 창이 보이기 시작한 시각, 그 시점의 화면이 흰색인지 테마색인지, 완성까지 시각. **다크 테마로 켰을 때 흰 번쩍임이 없는지**가 이 태스크의 합격 조건이다. 창이 보이기 시작하는 시각이 늦어질 수 있는데(그려진 뒤 보여 주므로) **그건 의도된 것** — 대신 보이는 순간부터 내용이 있다. 두 수치를 다 보고한다.

- [x] **Step 5: 게이트.** typecheck · 루트 551 · build · e2e **113 유지**. **E2E가 창 표시에 의존하는 곳**(E6a 숨김 창 회귀 가드 `smoke.spec.ts:80`, E7f 타이틀바)이 특히 민감하다.

- [x] **Step 6: Commit**

```bash
git add apps/desktop/src
git commit -m "fix(desktop): E13 부팅 흰 화면 제거 — 배경색·ready-to-show·테마 선적용

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: E2E + 최종 게이트 + 스크린샷 + README

**Files:** `apps/desktop/e2e/smoke.spec.ts` · `README.md`

- [x] **Step 1: E2E 3건.**
  1. 접기 후 **전환이 끝난 뒤**의 최종 폭이 E12와 같다 — ⚠️ **240ms 동안 폭이 중간값이라 즉시 단언하면 흔들린다. E12에서 없앤 ⌘F 플레이크가 정확히 이 원인이었다**(E11 애니메이션 중 좌표 샘플링). 자동 재시도 단언으로 최종값을 기다리고 **고정 대기를 넣지 않는다.**
  2. 도크를 닫으면 중앙이 그만큼 커진다(같은 주의).
  3. `prefers-reduced-motion`에서 즉시 반영된다(E11 Task 5의 `page.emulateMedia` 관용 재사용 — 실독).

- [x] **Step 2: 각 신규 `-g` 2회씩** 비플레이키 확인. 이 에픽은 타이밍에 특히 민감하니 흔들리면 **고정 대기가 아니라 단언 타임아웃**을 올린다.

- [x] **Step 3: 최종 게이트.** typecheck 6/6 · 루트 **551** · build · smoke **110**(107+3) · e2e **116** · `last-screen` 0건.

- [x] **Step 4: 스크린샷 4장** — 접히는 **중간 프레임**(모션은 정지 이미지로 안 보인다 — E11 관례) · 접힘 완료 · 도크 닫히는 중간 프레임 · **다크 테마 부팅 직후 첫 화면**(흰색이 아님을 보이는 것이 목적). 하이픈 경로(`/private/tmp/claude-501/-Users-sangyeop-kim-git-gui/b4ef6d32-042d-440c-8252-b8944659aa01/scratchpad/`)에 저장하고 `ls`로 확인해 붙인다.

- [x] **Step 5: README.** 기존 E12 문장(**실독**) 뒤에:

```markdown
E13: 사이드와 터미널이 부드럽게 열리고 닫힙니다. 앱을 켤 때 흰 화면 대신 테마 색이 먼저 칠해지고, 화면이 다 그려진 뒤에 창이 나타납니다.
```

- [x] **Step 6: Commit**

```bash
git add apps/desktop/e2e/smoke.spec.ts README.md
git commit -m "test(desktop): E13 E2E 3건 — 접기·도크 전환·reduced-motion + README

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 게이트 표 (누적)

| 시점 | 루트 테스트 | smoke | e2e 합 |
| --- | --- | --- | --- |
| 시작 | 545 | 107 | 113 |
| Task 1 후 | +6 → **551** | 107 | 113 |
| Task 3 후 | +4 → **555** (buildMainRows) | 107 | 113 |
| Task 2~4 후 | 551 유지 | 107 유지 | 113 유지 |
| Task 5 후 | **555** | +3 → **110** | **116** | ← 실측 일치

## Self-Review (플랜 자체 점검)

1. **스펙 커버리지**: ①간격을 트랙으로=T1(순수)+T2 · ②도크 행 전환=T3 · ③부팅 흰 화면=T4 · 안전망 확장=T2 Step 5. 에러표: 가상 스크롤=T2 Step 7·T3 Step 5(중단 조건 포함) · 시작 시 전환 금지·드래그·창 리사이즈=T2 Step 6 · `prefers-reduced-motion`=T5 Step 1-3 · E2E 폭 단언 플레이크=T5 Step 1 경고 · 패키징 부팅 재측정=범위 밖(후속).
2. **자리표시자**: T4 Step 3이 완본을 주지 않는다 — **의도적**. CSP가 인라인 스크립트를 막고 `file://` localStorage가 영속되지 않아 **가능한 경로가 측정으로만 정해진다**. 후보 둘과 판단 기준을 명시했다. 나머지는 완본.
3. **타입 정합**: `buildMainColumns`는 T1에서 정의되고 T2가 소비한다. `ColumnCollapse`는 E12가 이미 만든 타입을 재사용(실독 지시). `settings.ts`의 새 export는 T4 안에서 정의·소비가 닫힌다.
4. **알려진 위험**: ① **유지 마운트가 E12의 ⌘F 스코프 라우팅 전제를 깬다**(접힌 패널이 언마운트라 안 잡힌다는 성질) — T2 Step 2에 명시 ② 폭 방향 가상 스크롤은 처음이라 중단 조건을 뒀다 ③ T4 Step 2가 E2E 숨김 창 규칙과 얽힌다(E6a 회귀 가드가 직접 단언한다) ④ 트랙 개수 불변식이 깨지면 보간이 아니라 점프가 된다 — T1 테스트로 고정.

---

## 실행 기록 (소급)

**Task 1·2.** `minmax(0, 1fr)`이 공백을 포함해 naive `split(' ')`에선 트랙이 7이 아니라 8로 세어진다 — 다만 모든 케이스에 동일하게 나타나므로 "개수 불변" 검증 자체는 유효했다(플랜 주석이 예견한 대로).

**플랜에 없던 진짜 버그를 구현자가 실측으로 잡았다.** 간격을 트랙으로 옮기며 열이 4개 → 7개가 됐는데 **간격 트랙에는 대응하는 DOM 자식이 없다.** CSS 그리드 암시적 배치는 명시적 위치가 없는 자식을 DOM 순서대로 앞 트랙부터 채우므로 `left→1, center→2(간격!), resizer→3(중앙!), right→4(간격!)`로 밀려 **리사이저가 중앙 폭 380px을 먹고 우측이 16px로 무너졌다.** 넷 다 `grid-column`을 명시해 해결 — E6a 드래그·960px 반응형 테스트가 이걸 잡았다. Task 3의 행 작업에서도 같은 함정이 재현돼 `grid-row`를 명시했다.

**⌘F 스코프 회귀(플랜이 경고한 것) 처리:** 접힘 시 `data-find-scope`를 비우고, 키다운 핸들러에서 `leftCollapsedRef`/`rightCollapsedRef`로 재계산해 접힌 쪽이면 `diff`로 대체(마운트 1회 리스너의 클로저 고정 문제까지 함께 해결). **실측 확인: `elementFromPoint`가 0px + `overflow: hidden` 박스를 기하학적으로도 찾지 못한다**(`scope: null`) — ref 가드는 그 위의 안전망.

**E12 접기 E2E 3건은 `toHaveCount(0)` 가정이 유지 마운트와 맞지 않아** `not.toBeVisible()` + 폭 0으로 다시 썼다 — 관찰 가능한 결과("접힘 = 안 보임·상호작용 불가")는 그대로 유지.

**Task 2 실측:** 240ms 프레임별 폭 단조, 점프 없음 · **가상 스크롤 생존**(좌측 접기 전후 21행 동일 — 폭 방향은 처음이었고 중단 조건 미발동) · 최종 폭이 E12 표와 정확히 일치(1200×800 좌접기 762·양쪽 1160 / 960×600 양쪽 920).

**Task 3 실측:** 열기 `0→2.8→13→…→240`, 닫기 `240→…→0` 단조 · xterm 정상(본문 210px·화면 176px, 마지막 출력 행이 안쪽) · 닫은 뒤 중앙 710px = 열기 전 710px 완전 동일.

- **`.terminal-dock`의 `border`가 0높이에서 2px을 남겨 E7b `toBeHidden()`을 깼다** — `box-shadow: inset`으로 바꾸고 `height: 100%`로 부모 트랙을 따라가게 했다(처음엔 고정 px 높이로 두려다 자기 박스가 0이 안 돼 실패). **⚠️ 정정(아래 「후속 ①」) — 이 `height: 100%`는 `f523ed0`이 바로 그 크러시의 원인으로 지목해 폐기했다. 지금은 다시 인라인 고정 높이이고, 0이 되는 쪽은 부모 클리퍼 `.app__dock`이며 `data-testid="terminal-dock"`도 그리로 옮겨 `toBeHidden()`을 지킨다.**
- 도크 행 애니메이션을 매 프레임 추적하도록 `ResizeObserver`를 새로 달았다(E12가 창 폭용으로 단 `resize` 리스너와는 별개). **⚠️ 정정(아래 「후속 ①」) — `f523ed0` 이후 `.terminal-dock`의 높이는 행 전환 중 **변하지 않는다**(실측: 행 트랙이 240↔0을 오가는 내내 `innerH: 240` 고정). 이 옵저버가 실제로 잡는 것은 세로가 아니라 **가로**뿐이다 — 창 크기 변화 없이 도크 폭이 바뀌는 유일한 경로인 사이드 접기다. 코드 주석도 같은 내용으로 고쳤다(`TerminalDock.tsx`).**

**Task 4 — 플랜의 전제 두 개가 틀렸다.**

① **배경색 토큰이 틀렸다.** 앱의 최상위 배경은 `--color-surface`가 아니라 **`--color-bg`**다(`base.css`의 `body { background: var(--color-bg) }`, `.app`·`#root`는 배경 미지정이라 body가 비친다). 내가 지정한 `--color-surface`(카드용)를 썼으면 body와 미묘하게 어긋났다. 실제 값 라이트 `#f4f5f7` / 다크 `#16181d`.

② **샌드박스 preload에서 `document.documentElement`는 모듈 최상단에 `null`이다.** 그대로 대입하면 `TypeError`로 **preload 전체가 죽어 contextBridge 노출이 통째로 무산되고 렌더러가 백지로 뜬다** — 첫 구현에서 E2E가 전부 깨졌다(`Cannot read properties of null`). `readystatechange`(HTML 파싱 완료, `interactive` 진입)까지 기다려 해결했다. 이 시점은 지연 실행되는 `<script type="module">`(main.tsx)보다 앞선다.

**`backgroundColor`만으로는 부족했다(측정으로 확인).** `show: false` + `ready-to-show`를 쓰면 사용자가 보는 첫 프레임은 이미 **페이지가 그린 픽셀**이라 네이티브 배경색이 아니다 — 그 시점에 `data-theme`이 없으면 `:root`(라이트)로 칠해진다. preload가 직접 새기는 방법이 필요했다.

**결정적 증거(다크 강제, 고빈도 폴링):** 수정 전 `t=22ms`·`49ms`에 `rgb(244,245,247)`(라이트)·`theme=undefined`, `71ms`에야 dark → **49ms 이상 라이트 노출**. 수정 후 `t=21ms`부터 마지막 샘플까지 전부 `rgb(22,24,29)`·`theme=dark` → **라이트 프레임 0건.** 컨트롤러 육안 확인: 부팅 첫 프레임 스크린샷이 완전한 다크.

**Time-to-visible은 늦어진다(의도된 절충)** — 그려진 뒤 보여 주므로 창이 뜨는 순간은 밀리지만, 보이는 순간부터 내용이 있다.

**Task 5.** 신규 3건 중 reduced-motion 테스트가 1회 실패 — `firstWindow()`가 React 마운트 전에 반환될 수 있다는 **기존 E7d 주석(`:426`)이 기록해 둔 레이스**였다. `.app__left` 가시성 대기를 `emulateMedia` 앞으로 옮겨 해결. **타임아웃을 올리지 않았다 — 순수 로직 버그였다.** 이후 3건 × 2회 = 6/6 통과.

**최종 게이트(컨트롤러 재실행):** typecheck 6/6 · 루트 **555** · build 성공 · smoke **110** · e2e **116** · `last-screen` 0건.

---

## 후속 ① — `f523ed0` 뭉개짐 수정 (플랜 커밋 이후, 사용자 실측 피드백)

플랜 커밋(`4ac81c8`)은 이 변경을 모른다. **브랜치에서 가장 큰 구조 변경**이라 여기에 소급 기록한다.

**증상(사용자):** "접힐 때 텍스트가 뭉개진다." 원인은 유지 마운트 설계의 필연적 부작용이었다 — 트랙이 380→0으로 줄어드는 240ms 동안 그 안의 탭바·파일 행·터미널 바가 **매 프레임 좁아진 폭으로 다시 흐른다(reflow)**. `overflow: hidden`은 넘치는 걸 자르기만 할 뿐 내용이 좁아지는 것 자체를 막지 못한다.

**해법 — 클리퍼 / 안쪽 상자 2단 분리.** 세 곳 모두 같은 모양으로 바꿨다.

| 클리퍼(트랙 크기 그대로) | 안쪽 상자(펼친 크기 고정) | 고정 값의 출처 |
| --- | --- | --- |
| `.app__left` (`overflow: hidden`) | `.app__left-inner` | `leftExpandedWidth` (인라인 `width`) |
| `.app__right` (`overflow: hidden` + `display: flex`) | `.app__right-inner` (`flex-shrink: 0`) | `rightExpandedWidth` (인라인 `width`) |
| `.app__dock` (`overflow: hidden` + `display: flex`) | `.terminal-dock` (`flex-shrink: 0`) | `dockHeight` (인라인 `height`) |

- **`leftExpandedWidth`/`rightExpandedWidth`** — "지금 펼치면 몇 px일지"를 `computeColumns`를 **반대쪽 접힘만 반영해 다시 호출**해 구한다. 접기 직전 값을 상태로 기억하는 대안을 버린 이유: 접은 채 창을 줄이면 나중에 펼칠 폭도 좁아져야 맞는데, 기억해 둔 값은 낡는다. 정본은 계속 `computeColumns` 하나다.
- **정렬 반전.** 그리드에서 마지막 트랙의 **끝 선**은 컨테이너 끝과 같아 움직이지 않는다. 그래서 `.app__right`는 `justify-content: flex-end`, `.app__dock`은 `align-items: flex-end`로 고정변(오른쪽·아래)에 붙였다. 기본 정렬로 두면 고정폭 상자가 **움직이는 변**에 붙어 "반대쪽 끝이 잘려 사라지는" 어색한 모양이 된다. `.app__left`는 고정변이 왼쪽이라 기본 정렬 그대로면 맞는다.
- **`data-testid="terminal-dock"`이 `.terminal-dock` → `.app__dock`으로 이사.** 안쪽 상자는 이제 고정 높이라 자기 박스가 안 줄어든다 — 거기 testid가 남아 있으면 닫혀도 `toBeHidden()`이 거짓을 준다. 실제로 0이 되는 박스(행 트랙 = `.app__dock`)를 봐야 맞다.
- **`.app__right--detail-open` → `.app__right-inner--detail-open`.** E11의 상세 슬롯 중첩 grid(11fr/9fr)가 안쪽 상자로 통째로 내려갔다. 세로 축(상세 열림)과 가로 축(폭 고정)은 별개라 서로 간섭하지 않는다.

**실측(후속 ②에서 자동화):** 좌측 트랙 `366→346→312→254→186→…→0`이 흐르는 내내 `.app__left-inner`는 366 고정 · 도크 행 트랙 `240→…→0` 내내 `.terminal-dock`은 240 고정.

---

## 후속 ② — 적대적 리뷰 7건 해소

**BLOCKING 1 — 닫힌 도크·접힌 사이드가 tab order에 남아 있었다 (E13이 만든 회귀).**
E12까지는 `display: none`이거나 언마운트라 저절로 빠졌는데, "전환의 시작점을 남긴다"로 바꾸며 **박스만 0px이고 포커스는 그대로 들어가는** 상태가 됐다. 마우스는 `overflow: hidden`이 히트 테스트까지 잘라 안전 — **키보드 전용 결함**이었다. 리뷰어 실측: 도크를 닫은 채 `document.body`에서 Tab 15번이면 숨은 `.xterm-helper-textarea`에 포커스가 앉고, 거기 친 `echo GHOSTKEY_PROOF`가 **살아 있는 pty에서 실제로 실행돼** 다시 열었을 때 스크롤백에 남아 있었다. 접힌 사이드도 각각 21개가 포커스 가능(`left-tab-changes`가 x=20에, 커밋 메시지 입력까지).
→ 세 클리퍼에 `inert`(+`aria-hidden`). React 19라 boolean prop 그대로 쓴다(typecheck 6/6이 이를 확인). 레이아웃 효과가 0이라 240ms 전환 무영향 · 언마운트가 아니라 E7b 세션 유지 그대로 · 박스 크기 불변이라 `toBeHidden()`/`toBeVisible()`도 그대로.
**반증:** `inert` 없이 신규 테스트 실행 → `Tab 2회에 접힌 영역(.app__left)으로 포커스가 들어갔다 — <button class="app__left-tab" data-testid="left-tab-changes">`. `inert` 적용 후 119/119 통과.

**IMPORTANT 2 — 애니메이션 본체에 회귀 테스트가 0건이었다.**
`.app__main`의 `transition:` 선언을 통째로 지우고 다시 빌드해도 E13 신규 3건과 E12 접기 5건이 **전부 초록**이었다 — 전부 정착한 최종 상태만 본다. reduced-motion 테스트의 증거 (a)(`transitionDuration < 0.001`)조차 전환이 없을 때 통과해 전제가 무너졌다.
→ 신규 e2e 1건: (a) 평상시 `transitionDuration`이 `0.24s` 두 대상 (b) 접는 동안 `.app__left` 트랙 폭이 중간값 프레임을 실제로 지난다(rAF 프레임 표본, 중간값 ≥3).
**반증:** 선언 삭제 후 (a)는 `transitionDuration="0s"`로, (a)를 일시 제거하고 (b)만 남기면 `중간값 프레임 수 … Expected: >= 3 / Received: 0`으로 각각 빨개졌다. 중간값이 **구조적으로 0**이라(스타일 커밋 한 번에 366→0) 프레임률 흔들림과는 무관한 종류의 단언이다.

**IMPORTANT 3 — 뭉개짐 수정(후속 ①)에도 회귀 테스트가 0건이었다.**
최소 되돌림(안쪽 인라인 폭 → `'100%'`, `flex-shrink: 0` 제거, 도크 `height` → `'100%'`)으로도 관련 12건(E8 4 + E12 5 + E13 3)이 전부 초록이었다.
→ 신규 e2e 1건: 접히는 내내 `.app__left-inner` 폭 / `.terminal-dock` 높이가 **전 프레임 불변**(허용 오차 1px = 서브픽셀 반올림만)이고, 안쪽이 트랙보다 큰(=잘리는) 프레임이 ≥3.
**반증:** 되돌린 뒤 `.app__left-inner 폭이 흔들렸다 — 추이 366→366→362→346→312→254→186→…→0` / `.terminal-dock 높이가 흔들렸다 — 추이 240→…→0`. 복원 후 초록.

**IMPORTANT 4 — 플랜이 `f523ed0`을 몰랐고 두 문장이 사실과 달랐다.** 위 「실행 기록」의 Task 3 두 줄에 정정을 달고(`height: 100%` 폐기 · ResizeObserver의 실제 역할), 「후속 ①」을 새로 썼다. `TerminalDock.tsx`의 같은 오기도 고쳤다.

**NOTE 5 — `MAIN_GAP`이 4곳 중복이고 단위 테스트가 항진명제였다.** `grid-tracks.ts:MAIN_GAP`만 16→24로 바꿔도 `grid-tracks.test.ts` 10건과 루트 555건이 **전부 통과**했다(기대값을 상수 자신으로 쓴 탓). → `column-resize.ts`가 `MAIN_GAP`·`RESIZER_WIDTH`를 `grid-tracks.ts`에서 import(자기 `GRID_GAP=16`·`RESIZER_WIDTH=6` 삭제, `MAIN_CHROME`은 하드코딩 94 → 성분식). `grid-tracks.ts`가 가져가는 `ColumnCollapse`는 `import type`이라 지워지므로 런타임 순환은 없다. 단위 테스트에 리터럴 못박기 4건 추가(`MAIN_GAP`=16 · `RESIZER_WIDTH`=6 · `MAIN_TRACK_COUNT`=7 · `MAIN_ROW_COUNT`=3)와 "두 모듈이 같은 간격을 쓴다"는 유도식 검산 1건.
**반증:** 16→24로 바꾸니 `expected 24 to be 16`. 옛 중복 상태(각자 자기 값)를 재현하니 유도식 검산까지 `expected 366 to be 342`.

**NOTE 6 — 죽은 export 2개 → 삭제 쪽을 골랐다.** `MAIN_LEFT_GRID_ROW`·`MAIN_CONTENT_GRID_ROW`는 아무도 import하지 않았고 값은 `layout.css`에 리터럴로 따로 있었다. **`App.tsx`에서 쓰게 하는 대안을 버린 이유:** 그 넷(좌·중앙·리사이저·우)은 인라인 style이 아예 없는 요소라, 상수를 참조하게 하려면 정적 배치를 CSS에서 JSX로 끌어내야 한다 — 더 복잡해지지 더 안전해지지 않는다. 게다가 `buildMainRows`는 3트랙을 본문에 직접 적어 돌려주므로 `MAIN_ROW_COUNT`가 바뀐다고 자동으로 따라오지도 않는다(상수를 써도 "정본이 하나"가 되지 않는다). `MAIN_DOCK_GRID_ROW`만 남는 이유는 **쓰는 쪽이 이미 인라인 style이라서**다(`gridColumn`과 한 자리). 대신 ⓐ `MAIN_ROW_COUNT`를 단위 테스트로 리터럴 3에 못박고 ⓑ `layout.css`의 `grid-row: 1 / 4`에 "이 리터럴은 MAIN_ROW_COUNT에 걸려 있다"는 주석을 달아, 행 수를 바꾸려면 테스트가 먼저 빨개지게 했다.

**NOTE 7 — 부팅 하드코딩 색이 토큰과 어긋나도 아무도 몰랐다.** `main/index.ts`의 `APP_BACKGROUND`와 `tokens.css`의 `--color-bg`를 맞대는 단위 테스트 3건 추가(`tokens-contrast.test.ts` — 이미 tokens.css를 파싱하고 있던 자리). `main/index.ts`를 import하지 않고 소스 텍스트를 정규식으로 읽는다(그 모듈은 최상단에서 electron을 import하고 `app.setName` 부작용을 실행해 vitest에서 로드되지 않는다 — `motion-tokens.test.ts`의 파일 파싱 관용구). 선언 자체를 못 찾으면 테스트가 조용히 무력화되므로 "찾아냈는가"도 함께 단언한다.
**반증:** 앱 쪽만 `#ffffff`로 바꾸니 `expected '#ffffff' to be '#f4f5f7'`, 토큰 쪽만 바꾸니 `expected '#16181d' to be '#101216'` — 양방향 모두 잡힌다.

## 게이트 표 (후속 ② 반영)

| 시점 | 루트 테스트 | smoke | e2e 합 |
| --- | --- | --- | --- |
| Task 5 후(플랜 종료) | 555 | 110 | 116 |
| 후속 ② 후 | +7 → **562** (상수 못박기 4 + 부팅 배경색 3) | +3 → **113** | **119** |
