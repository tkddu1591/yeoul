# E12 사이드 접기 + 터미널 정체성 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 좌·우 사이드를 접을 수 있게 하고, 터미널 탭 이름이 "지금 이 워크트리에서 몇 번째"만 뜻하게 만들고, 터미널을 앱과 같은 톤으로 정리한다. 덤으로 내가 만든 E2E 플레이크를 근본에서 없앤다.

**Architecture:** 순수 함수 먼저(번호 재사용·접힘 폭) → 설정 영속 → 터미널 이름·외형 → 사이드 접기 UI → 플레이크 제거 → E2E.

**Tech Stack:** Electron + React + zustand, xterm.js, 순수 CSS 토큰, Vitest 순수 단위, Playwright Electron E2E.

**게이트 기준선(실측):** 루트 `pnpm test` **535** · `pnpm --filter @git-gui/desktop e2e` **108**(smoke 102 + hosting 6) · typecheck 6/6. **루트에 `build` 스크립트가 없다 — `pnpm --filter @git-gui/desktop build`.**

⚠️ **모든 Playwright 실행은 단일 포그라운드 Bash 호출 + `timeout: 600000`.**
⚠️ **자기가 띄우지 않은 Electron 프로세스는 건드리지 않는다** — 사용자가 개발 앱을 쓰고 있다. **OS 전체 화면 캡처 금지.**

**진단 재게(스펙):** `use-terminal-sessions.ts:45` `counterRef`는 단조 증가 **전역** 카운터(닫아도 안 줄고 그룹 무관). 제목은 `` `${counterRef.current}: ${options?.label ?? '쉘'}` ``(`:113`)이고 `label`은 워크트리 이름 — **번호는 남의 것을 암시하고 라벨은 중복**이다. `groupKey` 격리(E7h ④)는 정상이다. xterm은 `new Terminal({ fontSize: 12, theme, scrollback: 1000 })`로 **패밀리·줄간격 미지정**, 본문 패딩 4px, 빈 터미널 안내 없음.

---

### Task 1: 순수 함수 — 탭 번호 재사용 + 접힘 폭 (TDD)

**Files:**
- Create: `apps/desktop/src/renderer/src/ui/terminal/tab-number.ts`
- Modify: `apps/desktop/src/renderer/src/ui/column-resize.ts`
- Test: `apps/desktop/test/tab-number.test.ts`(신규) · `apps/desktop/test/column-resize.test.ts`(기존 11건에 이어붙임)

- [x] **Step 1: 실패하는 테스트 먼저 — 번호 재사용.** `apps/desktop/test/tab-number.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { nextTabNumber } from '../src/renderer/src/ui/terminal/tab-number'

describe('nextTabNumber', () => {
  it('비어 있으면 1', () => {
    expect(nextTabNumber([])).toBe(1)
  })

  it('연속이면 다음 번호', () => {
    expect(nextTabNumber([1, 2, 3])).toBe(4)
  })

  it('가운데가 비면 그 자리를 재사용한다 — 닫은 자리를 메워야 "몇 번째"가 거짓말을 안 한다', () => {
    expect(nextTabNumber([1, 3])).toBe(2)
    expect(nextTabNumber([2, 3])).toBe(1)
  })

  it('순서가 뒤죽박죽이어도 같은 답', () => {
    expect(nextTabNumber([3, 1])).toBe(2)
  })

  it('중복이 들어와도 견딘다', () => {
    expect(nextTabNumber([1, 1, 2])).toBe(3)
  })
})
```

- [x] **Step 2: 실패 확인.** `npx vitest run apps/desktop/test/tab-number.test.ts` — 모듈 없음으로 실패. 출력을 그대로 보고한다.

- [x] **Step 3: 구현.** `tab-number.ts`:

```ts
/**
 * 이 그룹(워크트리)에서 다음 탭 번호 — 닫아서 빈 자리가 있으면 **그 자리를 재사용**한다 (E12).
 * 전역 단조 증가 카운터였을 때는 3번을 닫고 새로 만들면 4번이 되고, 워크트리 A에서 둘을
 * 만들면 B의 첫 탭이 3번이었다 — 번호가 "남의 것이 어딘가 있다"고 거짓말을 했다
 */
export function nextTabNumber(used: readonly number[]): number {
  const taken = new Set(used)
  let candidate = 1
  while (taken.has(candidate)) candidate += 1
  return candidate
}
```

- [x] **Step 4: 실패하는 테스트 — 접힘 폭.** `column-resize.test.ts` 끝에 추가. **기존 `computeColumns(viewportWidth, storedRight)` 호출부를 깨지 않도록 3번째 인자는 선택**으로 만든다:

```ts
describe('computeColumns — 사이드 접기 (E12)', () => {
  it('좌측을 접으면 좌측 폭이 0이고 그만큼 중앙이 넓어진다', () => {
    const open = computeColumns(1400, 360)
    const collapsed = computeColumns(1400, 360, { left: true })
    expect(collapsed.left).toBe(0)
    expect(collapsed.right).toBe(open.right)
  })

  it('우측을 접으면 우측 폭이 0이고 좌측은 기본 폭을 되찾는다', () => {
    const collapsed = computeColumns(1400, 360, { right: true })
    expect(collapsed.right).toBe(0)
    expect(collapsed.left).toBe(LEFT_COLUMN_DEFAULT)
  })

  it('양쪽을 접으면 둘 다 0 — 중앙 전폭은 정당한 상태다', () => {
    expect(computeColumns(1400, 360, { left: true, right: true })).toEqual({ left: 0, right: 0 })
  })

  it('최소 창(960)에서 좌측을 접어도 우측이 클램프 하한 아래로 찌그러지지 않는다', () => {
    const { left, right } = computeColumns(960, 360, { left: true })
    expect(left).toBe(0)
    expect(right).toBeGreaterThanOrEqual(260)
  })

  it('접힘 인자를 주지 않으면 기존 동작 그대로다', () => {
    expect(computeColumns(1400, 360)).toEqual(computeColumns(1400, 360, {}))
  })
})
```

`LEFT_COLUMN_DEFAULT`를 import에 추가한다.

- [x] **Step 5: `computeColumns` 확장.** 기존(실측 `column-resize.ts:44-55`):

```ts
export function computeColumns(
  viewportWidth: number,
  storedRight: number,
): { left: number; right: number } {
  const budget = viewportWidth - MAIN_CHROME - CENTER_MIN
  let right = clampRightWidth(storedRight, viewportWidth)
  const left = Math.min(LEFT_COLUMN_DEFAULT, Math.max(LEFT_COLUMN_MIN, budget - right))
  if (budget - right < LEFT_COLUMN_MIN) {
    right = Math.max(RIGHT_COLUMN_FLOOR, budget - LEFT_COLUMN_MIN)
  }
  return { left, right }
}
```

접힘을 **폭 계산의 입력**으로 넣는다(새 CSS 분기를 만들지 않는다 — 그래야 최소 창·양쪽 접기 같은 조합이 저절로 정합한다). 접힌 열은 0이고, **접힌 쪽의 예산은 남은 쪽이 기존 우선순위대로 쓴다.** 정확한 코드는 위 테스트를 통과하도록 직접 짜되, **`MAIN_CHROME`(94)이 리사이저 6px + gap 3개를 포함한다**는 점을 반영해야 한다 — 열이 접히면 그 리사이저와 gap도 사라지므로 예산이 그만큼 늘어난다. **이 보정을 실제로 넣었는지 보고에 명시하라.**

- [x] **Step 6: 게이트.** `pnpm test` — **545**(535 + 신규 5 + 5). 실제 숫자를 보고한다.

- [x] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/src/ui apps/desktop/test
git commit -m "feat(desktop): E12 탭 번호 재사용 + 접힘 폭 산식 (순수)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: 터미널 탭 이름

**Files:** `apps/desktop/src/renderer/src/ui/terminal/use-terminal-sessions.ts` · `TerminalDock.tsx`

- [x] **Step 1: 카운터 폐기.** `counterRef`(`:45`·`:96`)를 없애고, 탭 생성 시 **같은 `groupKey`의 기존 번호**로 `nextTabNumber`를 부른다. `TerminalTab`에 `number: number`를 더하고 `title`은 **번호만** 담게 한다(`options?.label`은 더 이상 제목에 넣지 않는다).
  `setTabs`가 함수형 업데이터라 **이전 상태에서 그룹 번호를 뽑아야 한다** — 바깥 `tabs` 클로저를 읽으면 같은 렌더에서 연속 생성 시 같은 번호가 나온다(`:133-137`의 기존 주석이 같은 함정을 이미 기록하고 있다).

- [x] **Step 2: 워크트리 이름은 도크 헤더로.** `TerminalDock.tsx`의 탭에서 워크트리 라벨을 빼고, 지금 저장소 이름을 보여주는 `terminal-dock__hint`(`terminal-dock.css:70`) 자리에 **현재 워크트리**를 표시한다. `activeWorktree`(`TerminalDock.tsx:13`)가 이미 `{ cwd, label }`로 넘어온다.

- [x] **Step 3: 셸·경로는 툴팁으로.** 탭에 E7j `Tooltip`을 씌워 `content`에 그 터미널의 cwd(또는 워크트리 라벨)를 넣는다. 라벨을 지운 대신 정보를 잃지 않게 한다.

- [x] **Step 4: 실측(필수).** Playwright로 (a) 워크트리 A에서 탭 2개 → B로 전환 → **B의 첫 탭이 `1`** (b) A로 돌아가면 여전히 `1`·`2` (c) `2`를 닫고 새로 만들면 **`2` 재사용** — 화면에 보이는 탭 문자열을 그대로 보고한다.

- [x] **Step 5: 게이트.** typecheck · 루트 545 유지 · build · e2e **108 유지**. 탭 제목을 단언하는 기존 E2E(E7b·E7h 계열)가 있으면 **새 이름으로 1:1 갱신**하고 어느 테스트인지 보고한다.

- [x] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/ui/terminal
git commit -m "fix(desktop): E12 터미널 탭 번호를 그룹 안에서 — 남의 것을 암시하지 않게

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: 터미널 외형 4종

**Files:** `terminal-dock.css` · `use-terminal-sessions.ts`(xterm 옵션) · `TerminalDock.tsx`(빈 상태)

- [x] **Step 1: 글꼴·여백.** `new Terminal({ fontSize: 12, theme, scrollback: 1000 })`(`:97`)에 **`fontFamily`·`lineHeight: 1.4`**를 더한다. 패밀리는 앱의 mono 토큰과 같은 스택을 쓴다(`tokens.css`의 `--font-mono` **실독** — 값이 없으면 그 사실을 보고하고 CSS 변수를 읽어 넘긴다). 본문 패딩 `var(--space-1)`(4px)을 상하 `var(--space-2)`·좌우 `var(--space-3)`로.
  ⚠️ **폰트·줄간격을 바꾸면 FitAddon의 셀 계산이 달라진다** — 적용 후 `fit()`을 다시 부르고, 도크 높이 드래그(E7b)와 창 리사이즈 양쪽에서 글자가 잘리거나 남지 않는지 확인한다.

- [x] **Step 2: 탭바.** 밑줄형(`border-bottom: 2px`)을 **알약형**으로: `--radius-control`, 활성은 배경 채움(`--color-surface-sunken` 계열), 비활성은 투명. 닫기 X는 **호버·활성일 때만** 보인다(항상 노출은 시끄럽다). `+`는 탭 줄 끝 고스트 버튼. E11 모션 토큰(`--motion-fast`)을 쓴다.

- [x] **Step 3: 색·프레임.** 테두리를 `--color-border-strong` → `--color-border`로 내려 패널들과 같은 위계로 맞춘다. **xterm 팔레트 배경과 프레임 배경이 같은 톤인지 두 테마에서 확인**한다 — E7d ③이 라이트 모드에서 검은 띠를 잡았던 지점이라 여기서 다시 어긋나기 쉽다.

- [x] **Step 4: 빈 터미널 안내.** 새 탭에 오버레이 한 줄 — 지금 폴더와 어느 워크트리인지. **셸에 문자를 주입하지 않는다**(히스토리 오염). 첫 입력 또는 첫 출력 중 **먼저 오는 것**에 사라진다.

- [x] **Step 5: 육안 검증(필수).** 라이트·다크 각각 (a) 탭 3개 있는 도크 (b) 빈 새 탭 — 4장을 스크래치패드(**하이픈 경로** `<temporary-scratchpad>/`)에 저장하고 `ls`로 확인해 붙인다. 컨트롤러가 육안 검수 후 사용자에게 보낸다.

- [x] **Step 6: 게이트.** typecheck · 루트 545 · build · e2e **108 유지**.

- [x] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/src/ui/terminal
git commit -m "feat(desktop): E12 터미널 외형 — 알약 탭·글꼴/여백·프레임 톤·빈 상태 안내

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: 좌·우 사이드 접기

**Files:** `packages/ipc-contract/src/index.ts` · `apps/desktop/src/renderer/src/App.tsx` · `layout.css`

- [x] **Step 1: 설정 필드.** `AppSettings`(실측 `:309-322`)에 `leftCollapsed?: boolean` · `rightCollapsed?: boolean`을 더하고 **`sanitizeSettings`에도 같이 넣는다**(`:325-345` — 여기를 빼먹으면 저장은 되는데 다시 읽을 때 조용히 버려진다. 기존 `terminalOpen` 처리를 그대로 따른다).

- [x] **Step 2: 접기 버튼.** 각 사이드 패널 바깥 모서리에 접기 버튼. **접힌 상태에서도 펼치기 버튼이 그 자리에 남아야 한다** — 완전히 사라지면 화면에서 되돌릴 방법이 없다. E7j `Tooltip` + `aria-label`(E7k 관례) 필수.

- [x] **Step 3: 단축키.** `App.tsx`의 기존 keydown 핸들러(실측 `:260`의 `⌘\``, `:266`의 `⌘F`)에 `⌘⌥1`·`⌘⌥2`를 더한다. **`event.altKey`까지 봐야 한다** — `⌘1`만 보면 다른 것과 부딪힌다. 입력 중(textarea·input) 가로채지 않는지 기존 핸들러의 관용을 실독해 따른다.

- [x] **Step 4: 죽은 클릭 방지.** 우측이 접힌 채 커밋을 클릭하면 상세가 안 보이는 곳에 뜬다 → **우측을 자동으로 펼친다.** ⌘F가 접힌 패널을 대상으로 하면 그 패널을 펼치고 연다. **두 경로를 실제로 확인하고 보고한다.**

- [x] **Step 5: 모션 금지 확인.** 접기/펼치기는 **전환하지 않는다** — 열 폭은 인라인 style이고 레이아웃 속성이라 전환하면 버벅인다(E11 안전망이 CSS의 레이아웃 전환을 금지한다). 인라인 style에는 안전망이 닿지 않으므로 **사람이 지킨다**: `transition`을 넣지 않았는지 보고에 명시하라.

- [x] **Step 6: 실측(필수).** (a) 접기 버튼으로 좌측이 0이 되고 중앙이 그만큼 넓어지는지 (b) 단축키도 같은지 (c) 앱을 다시 띄워도 접힘이 유지되는지 (d) 최소 창(960)에서 양쪽 접기 — 폭을 수치로 보고한다.

- [x] **Step 7: 게이트.** typecheck(ipc-contract 포함) · 루트 545 · build · e2e **108 유지**. E6a 열 폭 E2E가 특히 민감하다.

- [x] **Step 8: Commit**

```bash
git add packages/ipc-contract apps/desktop/src
git commit -m "feat(desktop): E12 좌·우 사이드 접기 — 버튼·단축키·영속·죽은 클릭 방지

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

**Task 1~4 실행 기록 (소급).**

**Task 1 — 구현자가 내 테스트의 한계를 정직하게 짚었다.** `MAIN_CHROME` 보정은 적용했다(트랙 수 기반으로 재계산: 양쪽 열림 4트랙/3갭/리사이저 = 94 그대로 · 좌만 접힘 3/2/리사이저 = 78 · 우만 접힘 2/1/무리사이저 = 56 — 리사이저는 우측 폭 조절 전용이라 우측이 접히면 사라진다). **그러나 내가 준 5건은 이 보정을 고정하지 못한다** — 모든 케이스에서 예산 여유가 커 ±16~38px 차이가 클램프 경계를 넘지 않아, 보정이 있든 없든 통과한다. 최소 창 테스트가 실제로 고정하는 건 다른 수정이다: **접힌 좌측을 위해 `LEFT_COLUMN_MIN`을 예약하던 기존 압박 분기를 건너뛰는 것**(안 그러면 렌더되지도 않는 열을 위해 우측이 260 아래로 찌그러진다). 테스트가 무엇을 고정하고 무엇을 못 고정하는지 구분해 보고한 것이 옳다.

**Task 2 실측(화면 문자열 그대로):** 본체 2탭 → `['1','2']` · 워크트리 전환 후 첫 탭 → `['1']` · 본체 복귀 → `['1','2']` · `2` 닫고 새로 만듦 → `['1','2']`(**재사용**). E7h 터미널 그룹 E2E 1건을 새 이름으로 1:1 갱신했고, **공허해진 부정 단언**(`not.toContainText('3: sideName')`)은 남기지 않고 양성 단언으로 교체했다.

**Task 3 판단 기록:** `--font-mono`는 `tokens.css:9`에 실재한다(`ui-monospace, 'SF Mono', Menlo, Consolas, monospace`). 다만 xterm에 `var(--font-mono)`를 직접 넘기지 않고 **리터럴을 상수로 복사**했다 — xterm의 문자 폭 측정 요소가 잠시 화면 밖으로 분리·재부착되는데 그 시점의 `var()` 해석을 검증하지 못했기 때문. `tokens.css:9`를 가리키는 주석을 달아 드리프트가 보이게 했다. **권한받지 않은 판단이라고 스스로 밝혔다** — 타당하다.

- **창 리사이즈 시 FitAddon 재계산이 원래 빠져 있었다.** 기존 effect가 `[height, activeId]`만 봐서 **폭만 바뀌는 리사이즈는 덮이지 않았다** — 구현자가 발견해 `resize` 리스너를 추가했다(E12 이전부터 있던 잠복 결함).
- **빈 상태 오버레이 1차안이 화면에서 안 보였다.** `--color-surface-sunken`만 깔았더니 xterm 팔레트 배경과 1~2 hex 차이라 경계가 없었다 — **스크린샷 검수에서 발견**해 테두리·그림자를 더했다. 눈으로 안 봤으면 "만들었다"고 넘어갔을 결함이다.

**Task 4 실측(1200×800):** 기본 좌 366·중앙 380 → 좌 접기 후 중앙 **762**(= 366 + gap 16 정확히 흡수) → 펼치면 366·380 복귀. `⌘⌥1`도 동일(762). 양쪽 접기 중앙 **1160**(= 1200 − padding 40). 재시작 후 접힘 유지 확인. 960px 양쪽 접기 중앙 **920**.

- **macOS는 Option 조합에서 `event.key`를 리맵한다** — `event.code === 'Digit1'`을 써야 한다(구현자 발견).
- **죽은 클릭 두 경로 확인:** 우측 접힘 상태에서 스태시 팝오버의 미리보기(= 우측 열 **바깥**에서 `selectCommit`을 부르는 유일한 실제 경로 — 히스토리 행 클릭은 그 열이 언마운트라 구조적으로 불가능)로 우측 자동 펼침 확인. ⌘F는 접힌 패널의 `data-find-scope`가 아예 언마운트라 마우스가 그 스코프를 잡을 수 없어 **재현 자체가 불가능**했다 — 방어 코드는 넣되 "재현 못 했다"고 정직하게 보고했다.
- **접기에 transition 없음 확인**(인라인 style이라 E11 안전망이 못 닿는 구간 — 사람이 지켜야 하는 곳).

**게이트:** typecheck 6/6 · 루트 **545** · build 성공 · e2e **108** — Task 1~4 전 구간 유지.



### Task 5: 포커스 테스트 플레이크 근본 제거 (내가 만든 결함)

**Files:** `apps/desktop/e2e/smoke.spec.ts`

E9a에서 넣은 `창이 포커스를 받으면…`은 `GIT_GUI_E2E_SHOW=1`로 **실제 창을 띄우고 OS 포커스를 가져간다.** 다른 Electron 창이 있으면 경합해 흔들린다 — **E11 병합 직후 실제로 한 번 실패**했다. E11의 `toPass` 재시도는 완화일 뿐 근본 해결이 아니다.

- [x] **Step 1: 자극 방식만 바꾼다.** 검증 대상은 "창이 `focus` 이벤트를 받으면 렌더러가 재조회한다"는 **우리 코드의 계약**이지 "macOS가 우리 창에 포커스를 준다"는 **Electron의 책임**이 아니다. main 프로세스에서 `BrowserWindow`의 `focus` 이벤트를 직접 발생시켜 계약만 검증하고, **실제 창을 띄우지 않는다**(`GIT_GUI_E2E_SHOW` 제거).
  **단언은 그대로 둔다** — 새로고침 버튼 `disabled` 전이 카운터와 "파일을 건드리지 않았으므로 감시가 만들 수 없다"는 논거를 유지한다.
  주석에 **왜 실제 포커스를 쓰지 않는지**(경합, E11에서 실제 실패) 남긴다 — 다음 사람이 "진짜 포커스로 바꿔야지" 하고 되돌리지 않게.

- [x] **Step 2: 이번엔 진짜 조건에서 검증한다(필수).** **개발 앱을 켜 둔 채로**(`pnpm --filter @git-gui/desktop dev`를 자기가 띄워서 — 사용자 것을 쓰지 말 것) 전체 스위트를 **2회** 돌린다. 지금까지 못 하던 조건이고, 이 태스크가 성공했는지의 유일한 증거다. 두 결과를 보고하고, 끝나면 **자기가 띄운 개발 앱만** 정리한다.

- [x] **Step 3: Commit**

```bash
git add apps/desktop/e2e/smoke.spec.ts
git commit -m "test(desktop): E12 포커스 테스트를 OS 포커스 경합에서 분리

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: E2E 5건 + 최종 게이트 + README

**Files:** `apps/desktop/e2e/smoke.spec.ts` · `README.md`

- [x] **Step 1: E2E 5건.** ① 좌측 접기 버튼 → 폭 0, 펼치면 복귀 ② 단축키(`⌘⌥1`)로도 동일 ③ 접힌 채 재시작해도 유지(`GIT_GUI_USER_DATA` 격리 유지 — 설정이 그 안에 쓰인다) ④ 워크트리 A에 탭 2개 → B로 전환 시 **B 첫 탭이 `1`** ⑤ 탭을 닫고 새로 만들면 **빈 번호 재사용**. 자동 재시도 단언을 쓰고 고정 대기 금지.

- [x] **Step 2: 각 신규 `-g` 2회씩** 비플레이키 확인.

- [x] **Step 3: 최종 게이트.** typecheck 6/6 · 루트 **545** · build · smoke **107**(102+5) · e2e **113** · `last-screen` 0건.

- [x] **Step 4: 스크린샷 3장** — 좌측 접힘 / 양쪽 접힘 / 새 터미널 외형(전체 화면). 하이픈 경로에 저장하고 `ls`로 확인.

- [x] **Step 5: README.** 기존 E11 문장(**실독**) 뒤에:

```markdown
E12: 좌·우 사이드를 접을 수 있습니다(버튼 또는 ⌘⌥1·⌘⌥2, 접힘 상태는 기억됩니다). 터미널 탭 번호는 보고 있는 워크트리 안에서만 1부터 매겨지고 닫은 번호를 재사용합니다.
```

- [x] **Step 6: Commit**

```bash
git add apps/desktop/e2e/smoke.spec.ts README.md
git commit -m "test(desktop): E12 E2E 5건 — 사이드 접기·탭 번호 + README

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

**Task 5 — 포커스 플레이크 근본 제거.** `GIT_GUI_E2E_SHOW`와 실제 `blur()/focus()`를 걷어내고 main에서 `BrowserWindow.emit('focus')`로 자극만 바꿨다. **단언은 그대로**(새로고침 버튼 `disabled` 전이 카운터 + 파일 무변경 논거). 도달 확인: `main/index.ts:66`이 표준 `EventEmitter` API로 `window.on('focus', …)`를 등록하므로 `.emit('focus')`가 그 리스너를 동기 호출한다 — 격리 실행으로 검증. **포기한 커버리지를 정직하게 밝혔다**: OS→Electron 네이티브 포커스 변환 경로는 더 이상 안 덮는다(그건 Electron의 계약). 창이 하나뿐이라 "엉뚱한 창에 리스너가 붙는" 부류는 여전히 덮인다.

**Task 6 — 신규 5건, `-g` 2회씩 전부 통과.** 작성 중 **기존 함정에 또 물렸다**: 공유 `settings.json` 탓에 `dockOpen`이 이미 true라 첫 `terminal-toggle` 클릭이 도크를 **닫아** 버렸다(`smoke.spec.ts:1537`이 같은 함정을 이미 문서화 중이었다). 이게 아래 격리 보완의 방아쇠가 됐다.

---

## 병합 전 보완 2건

**보완 A — E2E 설정 기본 격리 (`4b041c2`).** 실측: launch **113개 중 34개만** `GIT_GUI_USER_DATA`를 넘긴다. E12 이전엔 새는 설정이 테마·도크 높이 정도였지만, **E12가 열 전체를 언마운트시키는 `leftCollapsed`·`rightCollapsed`를 영속화**하면서 위험해졌다(E12 자신의 접기 테스트 2건도 격리 없이 좌측을 접었다). `harness.ts`에서 호출자가 안 넘겼을 때만 임시 디렉터리를 주입하도록 바꿔 79개를 한 번에 안전하게 만들었다. 재시작 지속성 테스트 3건(자기 userData를 두 launch에 넘기는 것들)은 그대로 통과. 임시 디렉터리는 `app.close()` 후 즉시 정리(전체 2회 실행 후 잔여 0).

**보완 A의 정직한 결론:** 이 격리는 **E7h ⌘F 플레이크의 원인이 아니었다** — 격리 전후 모두 1/8, 같은 실패 시그니처. 구현자가 "고쳤다"고 하지 않고 그대로 보고했다.

**보완 A의 부작용(기록):** "수정 전" 재현 측정이 공유 설정을 요구했기 때문에 **사용자의 실제 `~/Library/Application Support/Git GUI/settings.json`에 값을 썼다**(`theme: light`·`rightWidth: 294` 등 평범한 값, 라이브 프로세스는 무접촉). 사용자에게 밝혔다.

**보완 B — ⌘F 플레이크의 진짜 원인 (`7cbaddc`).** 앞선 가설(호버 등록 경합)을 **증거로 기각**했다 — 라우팅 코드에 호버 등록 상태 같은 건 없고, keydown에서 `pointerRef.current`를 읽어 `elementFromPoint`를 **동기로** 부른다. 비동기 간극 자체가 없다.

**진짜 원인은 E11이 만든 것이었다.** E11의 상세 슬롯 `grid-template-rows` 애니메이션(240ms) 때문에 `toBeVisible()`이 **행이 0이 아니게 되는 즉시** 통과하고, 그 순간의 `boundingBox()`가 아직 자라는 중인 패널 **밖** 좌표를 집는다 → 스코프가 `diff`로 폴백 → 그 테스트는 파일을 고른 적이 없어 `DiffPanel`이 빈 상태라 FindBar가 **아예 마운트되지 않는다**. 계측으로 실패 순간을 직접 포착: `x=1000 y=769 scope=diff scopeElClass=null`(통과 시엔 `scope=commit-files`, y가 730~769로 흔들림 — 애니메이션 중 샘플링의 직접 증거).

**앞선 세 번의 "기존 결함" 판정은 기준선에 E11이 이미 들어 있었기 때문이다.** E12 이전이라는 뜻이었지 E11 이전이라는 뜻이 아니었다.

**제품이 아니라 테스트 문제로 판정** — 실제 사용자의 클릭→마우스 이동→⌘F는 240ms보다 훨씬 오래 걸린다. Playwright의 지연 0 합성 동작만이 이 창을 노출한다. `App.tsx`는 건드리지 않았다. 헬퍼를 `toPass`로 감싸 **좌표가 실제로 대상 안에 떨어졌는지 확인한 뒤** 키를 누르게 했다(고정 대기가 아니라 조건 대기 — 고정 대기는 확률만 낮춘다).

**통계 증명:** 수정 전 40회 중 **3회 실패(7.5%)** → 수정 후 **60회 중 0회**. 다른 ⌘F 테스트 7건 `--repeat-each=5` **35/35** 무회귀.

**최종 게이트:** typecheck 6/6 · 루트 **545** · build 성공 · e2e **113**(전체 2회 연속).



## 게이트 표 (누적)

| 시점 | 루트 테스트 | smoke | e2e 합 |
| --- | --- | --- | --- |
| 시작 | 535 | 102 | 108 |
| Task 1 후 | +10 → **545** | 102 | 108 |
| Task 2~5 후 | 545 유지 | 102 유지 | 108 유지 |
| Task 6 후 | 545 | +5 → **107** | **113** | ← 실측 일치
| 보완 A·B 후 | 545 | 107 | 113 (플레이크 7.5% → 0%) |

## Self-Review (플랜 자체 점검)

1. **스펙 커버리지**: ①사이드 접기=T1(산식)+T4(UI·영속·죽은 클릭) · ②탭 번호=T1(순수)+T2 · ③워크트리 라벨 중복=T2 Step 2·3 · 외형 4종=T3 · ④플레이크=T5. 에러표: 양쪽 접힘+최소창=T1 Step 4 테스트 · 접힌 채 커밋 클릭·⌘F=T4 Step 4 · 번호 재사용×`lastActiveRef`=`sessionId` 기준이라 무영향(스펙 근거) · 그룹 소멸=그룹별 관리라 자연 해소 · 빈 안내×프롬프트=T3 Step 4 · 폰트×FitAddon=T3 Step 1 경고.
2. **자리표시자**: `computeColumns` 확장 본문(T1 Step 5)과 접기 버튼 배치(T4 Step 2)를 완본으로 주지 않았다 — **의도적**. 전자는 `MAIN_CHROME`이 리사이저·gap을 포함해 접힘 시 예산 보정이 필요하고 그 정확한 값은 테스트로 고정하는 편이 안전하다(테스트는 완본으로 줬다). 후자는 두 패널의 실제 마크업을 봐야 어느 모서리가 맞는지 정해진다. 나머지는 완본.
3. **타입 정합**: `computeColumns`의 3번째 인자는 **선택**이라 기존 호출부가 그대로 컴파일된다. `TerminalTab.number` 추가는 T2 안에서 정의·소비가 닫힌다. `AppSettings` 두 필드는 T4에서 스키마·sanitize를 함께 건드린다(둘 중 하나만 하면 조용히 버려진다 — Step 1에 명시).
4. **알려진 위험**: ① T2의 `setTabs` 함수형 업데이터 안에서 번호를 뽑지 않으면 같은 렌더 연속 생성 시 중복 번호가 난다(기존 주석이 같은 함정을 기록 중) ② T3의 폰트 변경이 FitAddon 계산을 흔든다 ③ T4의 인라인 style에는 E11 안전망이 닿지 않아 사람이 지켜야 한다 ④ T5는 **개발 앱을 켜 둔 조건에서 2회**를 통과해야만 성공이다.
