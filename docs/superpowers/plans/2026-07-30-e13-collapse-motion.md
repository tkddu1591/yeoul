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

- [ ] **Step 1: 실패하는 테스트 먼저.** `apps/desktop/test/grid-tracks.test.ts`:

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

- [ ] **Step 2: 실패 확인.** `npx vitest run apps/desktop/test/grid-tracks.test.ts` — 모듈 없음. 출력을 그대로 보고한다.

- [ ] **Step 3: 구현.** `grid-tracks.ts`:

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

- [ ] **Step 4: 게이트.** `pnpm test` — **551**(545 + 6). 실제 숫자를 보고한다.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/ui/grid-tracks.ts apps/desktop/test/grid-tracks.test.ts
git commit -m "feat(desktop): E13 열 트랙 조립 순수 함수 — 간격을 트랙으로

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: 열 전환 — gap 이관 + 안전망 허용 확장

**Files:** `layout.css` · `App.tsx` · `apps/desktop/test/motion-tokens.test.ts`

- [ ] **Step 1: `gap`을 없앤다.** `layout.css:174-184`의 `.app__main`에서 `gap: var(--space-4)`를 제거한다. **행 간격도 같이 사라지므로** 2행(도크)과의 간격을 Task 3에서 행 트랙으로 되살려야 한다 — 이 태스크가 끝난 시점에 도크가 붙어 보이는 것은 **의도된 중간 상태**이고, Task 3에서 닫힌다. 커밋 메시지에 그 사실을 적는다.

- [ ] **Step 2: 접힌 열을 유지 마운트.** `App.tsx`에서 접혔을 때 `.app__left`·`.app__resizer`·`.app__right`를 **언마운트하지 않고** 유지하되 `overflow: hidden`으로 감춘다(0px 트랙 안에서 내용이 새지 않게). E11 Task 4가 상세 슬롯에서 쓴 것과 같은 수법이다.
  ⚠️ **E12가 "닫으면 DOM에서 사라진다"에 기대는 것이 있는지 확인하라** — 특히 ⌘F 스코프 라우팅(`data-find-scope`)은 접힌 패널이 언마운트라 "잡히지 않는다"는 성질에 의존한다고 E12 보고가 적었다. 유지 마운트로 바꾸면 **접힌 패널이 ⌘F 대상으로 잡힐 수 있다.** 접힘 시 `data-find-scope`를 떼거나 다른 방법으로 막고, **어떻게 했는지 보고한다.**

- [ ] **Step 3: 트랙 문자열을 Task 1 함수로.** `App.tsx:266-273`의 인라인 조립을 `buildMainColumns`로 교체한다. `dockGridColumn` 계산(`:278-279`)은 **트랙 개수가 이제 항상 7로 고정**이므로 그에 맞게 다시 쓴다 — 도크는 좌측 열과 그 간격을 건너뛴 3번째 트랙부터 끝까지다.

- [ ] **Step 4: 전환.** `layout.css`의 `.app__main`에 `transition: grid-template-columns var(--motion-slow) var(--ease-in-out)`.

- [ ] **Step 5: 안전망 허용 확장.** `motion-tokens.test.ts`가 `grid-template-columns`를 **금지 목록**에 넣어 두었다(실측 `:51`) — 이 태스크가 그 규칙을 정면으로 어긴다. `grid-template-rows`만 허용하던 예외를 **`grid-template-columns`까지** 넓히고, **왜 두 개만 예외인지**(Chromium이 보간하는 grid 트랙 경로) 주석에 남긴다. `grid-template`·`grid-template-areas` 금지는 **유지**한다.
  ⚠️ **허용 목록을 넓힌 뒤 안전망이 여전히 무는지 재확인하라** — `transition: grid-template-columns, height`가 여전히 실패해야 한다. 확인 출력을 붙인다.

- [ ] **Step 6: 전환을 꺼야 하는 세 순간.** 다음에는 전환이 돌면 안 된다. 각각 실제로 확인하고 보고한다:
  - **앱 시작** — 접힌 상태로 저장돼 있으면 첫 페인트에 240ms 애니메이션이 돈다. 부팅이 느려 보이는 것과 구별되지 않는다. 초기 렌더에 억제 클래스를 씌우고 첫 프레임 뒤 푼다(E11 `theme-switching`과 같은 기법 — **그 구현을 실독해 따르라**).
  - **드래그 리사이즈** — 커서를 1:1로 따라가야 한다. 드래그 중 전환 금지.
  - **창 리사이즈** — 열이 뒤따라오면 고무줄처럼 보인다.

- [ ] **Step 7: 실측(필수).** (a) 접히는 240ms 동안 **프레임별** 트랙 폭이 단조 변화하는지(점프 없음) (b) 좌측 `ChangesPanel`·우측 `HistoryPanel`의 **가상 스크롤 행이 깨지지 않는지** — E11이 높이 방향에서 검증한 것과 같은 계열이지만 **폭 방향은 처음**이다 (c) 접힘 최종 폭이 E12와 동일한지(1200×800·960×600). **깨지면 이 태스크를 중단하고 보고하라** — 접힘 모션을 포기하고 도크만 남기는 것이 정답일 수 있다.

- [ ] **Step 8: 게이트.** typecheck · 루트 551 · build · e2e **113 유지**(E12 접기 5건·E6a 열 폭이 특히 민감).

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src apps/desktop/test
git commit -m "feat(desktop): E13 사이드 접기 전환 — 간격을 트랙으로 옮겨 계단 제거

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: 터미널 도크 행 전환

**Files:** `layout.css` · `App.tsx`

- [ ] **Step 1: `display: none`을 걷어낸다.** `App.tsx:1108-1109`가 `style={{ display: dockOpen ? 'block' : 'none' }}`로 껐다 켠다. `display`는 보간되지 않는다 — 도크를 **항상 렌더**하고 `overflow: hidden`으로 두되, 2행 트랙을 `0px ↔ <높이>px`로 전환한다.

- [ ] **Step 2: 행 트랙.** `.app__main`의 `grid-template-rows`는 지금 `minmax(0, 1fr) auto`다(`layout.css:179`). **`auto`는 보간되지 않는다** — 도크 높이는 `terminalHeight` 설정으로 이미 px를 알고 있으니 그 값을 쓴다. Task 2에서 없앤 **행 간격도 여기서 트랙으로** 되살린다(닫히면 0).

- [ ] **Step 3: 전환.** `grid-template-rows`는 안전망이 이미 허용한다(E11). `--motion-slow` `--ease-in-out`으로 열과 같은 속도.

- [ ] **Step 4: 도크 높이 드래그 중에는 전환 금지** — Task 2 Step 6과 같은 억제를 적용한다(두 전환이 겹치면 손보다 늦게 온다).

- [ ] **Step 5: 실측(필수).** (a) 열고 닫는 동안 프레임별 높이가 단조 변화하는지 (b) **xterm이 깨지지 않는지** — 높이가 매 프레임 바뀌면 FitAddon이 재측정한다. E12가 창 폭 리사이즈용 리스너를 새로 달았을 만큼 민감한 곳이다 (c) 닫힌 뒤 중앙이 그만큼 커지는지.

- [ ] **Step 6: 게이트.** typecheck · 루트 551 · build · e2e **113 유지**(E7b 도크 4건이 민감).

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src
git commit -m "feat(desktop): E13 터미널 도크 행 전환 — display 토글 폐기

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: 부팅 흰 화면

**Files:** `apps/desktop/src/main/index.ts` · `apps/desktop/src/main/settings.ts`(읽기 노출) · `apps/desktop/src/renderer/index.html`

로고 스플래시는 **만들지 않는다** — 부팅이 714ms라 떴다 사라지는 로고가 오히려 번쩍임이다(스펙 ③).

- [ ] **Step 1: 창 배경색.** `BrowserWindow` 옵션에 `backgroundColor`를 준다. 값은 **저장된 테마의 앱 배경색** — 라이트 `#ffffff` / 다크 `#1e2128`(`tokens.css:46`·`:105` `--color-surface` 실측). 앱이 실제로 칠하는 최상위 배경이 `--color-surface`가 맞는지 **실독으로 확인**하고, 다르면 그 값을 쓴다.
  `settings.ts`에는 내부 `loadSettings()`/`current()`가 있고 **읽기 함수가 export돼 있지 않다**(실측 — export는 `registerSettingsHandlers`·GitHub 토큰 계열뿐). 테마를 읽는 최소한의 export를 추가하되, **GitHub 토큰 계열을 노출하지 않도록** 범위를 좁게 잡는다(E3a가 토큰을 main 전용으로 못 박았다).

- [ ] **Step 2: 그려진 뒤에 보여 준다.** `show: !isE2E || isE2EShow`(`index.ts:46`)를 `show: false`로 바꾸고 `window.once('ready-to-show', …)`에서 보여 준다.
  ⚠️ **E2E 숨김 규칙과 합성해야 한다** — E2E에서는 계속 숨어 있어야 하고(`isE2E && !isE2EShow`), `GIT_GUI_E2E_SHOW=1`일 때만 보인다. **기존 조건을 그대로 보존**하되 "보여 주는 시점"만 늦춘다. E2E가 `firstWindow()`로 창을 잡는 경로가 깨지지 않는지 확인하라(숨김 창도 첫 페인트는 일어난다 — `index.ts:45` 주석이 그 전제를 이미 적어 뒀다).

- [ ] **Step 3: 테마를 React보다 먼저.** `index.html`에 배경을 미리 칠한다.
  ⚠️ **CSP가 인라인 `<script>`를 막는다** — `default-src 'self'`이고 `unsafe-inline`은 `style-src`에만 있다(`index.html` 실측). 그러므로 스크립트로 `localStorage`를 읽는 방식은 **불가능**하다. 게다가 이 앱은 `file://` origin이라 localStorage가 영속되지 않는다(E0-3b 실측 — 그래서 설정이 main에 있다).
  → **main이 아는 값을 렌더러 첫 페인트 전에 반영하는 경로**를 찾아야 한다. 후보: `backgroundColor`만으로 충분한지(창 배경이 이미 테마색이면 body가 투명한 동안 그 색이 보인다), 아니면 preload에서 `document.documentElement`에 `data-theme`을 먼저 붙이는 방법(preload는 CSP의 제약을 받지 않는다). **어느 쪽이 실제로 되는지 측정해서 정하고, 근거를 보고하라.**

- [ ] **Step 4: 실측(필수).** 부팅을 **다시 재고** 전후를 비교한다: 창이 보이기 시작한 시각, 그 시점의 화면이 흰색인지 테마색인지, 완성까지 시각. **다크 테마로 켰을 때 흰 번쩍임이 없는지**가 이 태스크의 합격 조건이다. 창이 보이기 시작하는 시각이 늦어질 수 있는데(그려진 뒤 보여 주므로) **그건 의도된 것** — 대신 보이는 순간부터 내용이 있다. 두 수치를 다 보고한다.

- [ ] **Step 5: 게이트.** typecheck · 루트 551 · build · e2e **113 유지**. **E2E가 창 표시에 의존하는 곳**(E6a 숨김 창 회귀 가드 `smoke.spec.ts:80`, E7f 타이틀바)이 특히 민감하다.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src
git commit -m "fix(desktop): E13 부팅 흰 화면 제거 — 배경색·ready-to-show·테마 선적용

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: E2E + 최종 게이트 + 스크린샷 + README

**Files:** `apps/desktop/e2e/smoke.spec.ts` · `README.md`

- [ ] **Step 1: E2E 3건.**
  1. 접기 후 **전환이 끝난 뒤**의 최종 폭이 E12와 같다 — ⚠️ **240ms 동안 폭이 중간값이라 즉시 단언하면 흔들린다. E12에서 없앤 ⌘F 플레이크가 정확히 이 원인이었다**(E11 애니메이션 중 좌표 샘플링). 자동 재시도 단언으로 최종값을 기다리고 **고정 대기를 넣지 않는다.**
  2. 도크를 닫으면 중앙이 그만큼 커진다(같은 주의).
  3. `prefers-reduced-motion`에서 즉시 반영된다(E11 Task 5의 `page.emulateMedia` 관용 재사용 — 실독).

- [ ] **Step 2: 각 신규 `-g` 2회씩** 비플레이키 확인. 이 에픽은 타이밍에 특히 민감하니 흔들리면 **고정 대기가 아니라 단언 타임아웃**을 올린다.

- [ ] **Step 3: 최종 게이트.** typecheck 6/6 · 루트 **551** · build · smoke **110**(107+3) · e2e **116** · `last-screen` 0건.

- [ ] **Step 4: 스크린샷 4장** — 접히는 **중간 프레임**(모션은 정지 이미지로 안 보인다 — E11 관례) · 접힘 완료 · 도크 닫히는 중간 프레임 · **다크 테마 부팅 직후 첫 화면**(흰색이 아님을 보이는 것이 목적). 하이픈 경로(`/private/tmp/claude-501/-Users-sangyeop-kim-git-gui/b4ef6d32-042d-440c-8252-b8944659aa01/scratchpad/`)에 저장하고 `ls`로 확인해 붙인다.

- [ ] **Step 5: README.** 기존 E12 문장(**실독**) 뒤에:

```markdown
E13: 사이드와 터미널이 부드럽게 열리고 닫힙니다. 앱을 켤 때 흰 화면 대신 테마 색이 먼저 칠해지고, 화면이 다 그려진 뒤에 창이 나타납니다.
```

- [ ] **Step 6: Commit**

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
| Task 2~4 후 | 551 유지 | 107 유지 | 113 유지 |
| Task 5 후 | 551 | +3 → **110** | **116** |

## Self-Review (플랜 자체 점검)

1. **스펙 커버리지**: ①간격을 트랙으로=T1(순수)+T2 · ②도크 행 전환=T3 · ③부팅 흰 화면=T4 · 안전망 확장=T2 Step 5. 에러표: 가상 스크롤=T2 Step 7·T3 Step 5(중단 조건 포함) · 시작 시 전환 금지·드래그·창 리사이즈=T2 Step 6 · `prefers-reduced-motion`=T5 Step 1-3 · E2E 폭 단언 플레이크=T5 Step 1 경고 · 패키징 부팅 재측정=범위 밖(후속).
2. **자리표시자**: T4 Step 3이 완본을 주지 않는다 — **의도적**. CSP가 인라인 스크립트를 막고 `file://` localStorage가 영속되지 않아 **가능한 경로가 측정으로만 정해진다**. 후보 둘과 판단 기준을 명시했다. 나머지는 완본.
3. **타입 정합**: `buildMainColumns`는 T1에서 정의되고 T2가 소비한다. `ColumnCollapse`는 E12가 이미 만든 타입을 재사용(실독 지시). `settings.ts`의 새 export는 T4 안에서 정의·소비가 닫힌다.
4. **알려진 위험**: ① **유지 마운트가 E12의 ⌘F 스코프 라우팅 전제를 깬다**(접힌 패널이 언마운트라 안 잡힌다는 성질) — T2 Step 2에 명시 ② 폭 방향 가상 스크롤은 처음이라 중단 조건을 뒀다 ③ T4 Step 2가 E2E 숨김 창 규칙과 얽힌다(E6a 회귀 가드가 직접 단언한다) ④ 트랙 개수 불변식이 깨지면 보간이 아니라 점프가 된다 — T1 테스트로 고정.
