# E9 커밋 컴포저 + 모서리·테두리 규칙 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 커밋 폼을 하나의 테두리 상자(컴포저)로 묶어 떠 있는 버튼·테두리 중첩·블롭 모서리를 동시에 없애고, 앱 전역 모서리·테두리 규칙을 용도 기반 3단으로 통일한다.

**Architecture:** 토큰 계층 먼저(`--radius-control/container/pill` + `--color-accent-soft`) → 전역 회수(raw px·구 토큰 참조 0건) → 컴포저 컴포넌트 재구성(⌘↵ 제출 포함) → E2E·스크린샷.

**Tech Stack:** Electron + React + zustand, 순수 CSS 커스텀 프로퍼티, Vitest 순수 단위, Playwright Electron E2E.

**게이트 기준선(실측):** 루트 `pnpm test` **523** · `pnpm --filter @git-gui/desktop e2e` **96**(smoke 90 + hosting 6) · typecheck 6/6. **루트에 `build` 스크립트가 없다 — `pnpm --filter @git-gui/desktop build`를 쓴다.**

⚠️ **모든 Playwright 실행은 단일 포그라운드 Bash 호출 + `timeout: 600000`.** E8에서 네 에이전트가 연속으로 백그라운드로 넘겨 워크플로가 멈췄다. 기본 120초 제한이 원인이니 파라미터는 선택이 아니다.

---

### Task 1: 토큰 — 용도 기반 모서리 3단 + accent-soft

**Files:**
- Modify: `apps/desktop/src/renderer/src/ui/tokens.css`
- Test: `apps/desktop/test/tokens-contrast.test.ts`

- [ ] **Step 1: 모서리 토큰 교체.** `tokens.css`의 기존(실측 26~29행):

```css
  /* 모서리·그림자 */
  --radius-sm: 6px;
  --radius-md: 9px;
  --radius-lg: 14px;
```

교체:

```css
  /* 모서리 — 크기가 아니라 용도로 부른다. 크기 이름(sm/md/lg)은 "어디에 쓰는지"를
     말하지 않아 실사용이 7가지 값으로 흩어졌다(E9 실측). 값을 고르는 대신 종류를 고른다 */
  --radius-control: 6px; /* 버튼·입력·행·메뉴 항목·탭·컴포저 상자 */
  --radius-container: 10px; /* 패널·다이얼로그·팝오버·카드·터미널 도크 */
  --radius-pill: 999px; /* 배지·ref 칩·개수 알약 */
```

- [ ] **Step 2: accent-soft 2벌 추가.** 라이트 블록의 `--color-accent-text: #ffffff;` **바로 다음 줄**에 추가:

```css
  /* E9 — 채운 강조가 좌측 열에서 유일한 큰 색 면적이라 튀었다. 컴포저 버튼은 옅은 배경 + 진한 글자로 */
  --color-accent-soft: #e6ebfd;
  --color-accent-soft-text: #1e44bd;
```

다크 블록(`:root[data-theme='dark']`)의 `--color-accent-text: #10131a;` 바로 다음 줄에 추가:

```css
  --color-accent-soft: #2f3a52;
  --color-accent-soft-text: #c3d0f5;
```

- [ ] **Step 3: 대비 회귀 테스트에 쌍 추가.** `tokens-contrast.test.ts`의 `PAIRS` 배열(실측 34행 시작)에서 기존:

```ts
  ['--color-accent-text', '--color-accent', 4.5],
```

바로 아래에 추가:

```ts
  ['--color-accent-soft-text', '--color-accent-soft', 4.5],
```

이 파일은 라이트·다크 **두 벌 모두** 같은 `PAIRS`로 검사한다(`darkTokens`가 라이트를 상속 후 덮어씀 — 실측 16~18행). 즉 한 줄로 두 테마가 함께 걸린다.

- [ ] **Step 4: 실패 확인.** `npx vitest run apps/desktop/test/tokens-contrast.test.ts` — Step 2를 건너뛴 상태라면 토큰 미정의로 실패해야 한다. 이미 Step 2를 했다면 통과를 확인하고, **일부러 `--color-accent-soft-text`를 `#9aa8c8`로 잠깐 바꿔 실패하는지 1회 확인**한 뒤 되돌린다(테스트가 실제로 물고 있는지 검증 — E8에서 공허한 단언이 통과하던 사례가 있었다).

- [ ] **Step 5: 게이트.** `pnpm test` — **524**(523 + 신규 대비 쌍 1건). 실제 숫자를 보고한다.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/ui/tokens.css apps/desktop/test/tokens-contrast.test.ts
git commit -m "feat(desktop): E9 모서리 토큰 용도 3단 + accent-soft 2벌

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: 전역 회수 — 구 토큰·raw px 0건

**Files:** `apps/desktop/src/renderer/src` 아래 CSS 전부

Task 1이 새 이름을 만들었을 뿐 **옛 이름은 아직 아무도 안 쓰게 정리되지 않았다.** 이 태스크가 없으면 앱 전체가 모서리 없이 렌더된다(정의되지 않은 var는 무효 → 초기값 0).

- [ ] **Step 1: `--radius-sm` → `--radius-control` 일괄 치환.** 실측 사용처 16개 파일(총 24회): `pictogram.css`·`tooltip.css`·`context-menu.css`(2)·`list-dialog.css`·`prompt-dialog.css`·`review-popover.css`(3)·`button.css`·`find-bar.css`·`shelf-popover.css`(2)·`branches-panel.css`(2)·`changes-panel.css`(2)·`worktrees-panel.css`·`branch-switcher.css`(3)·`conflict-panel.css`(2)·`commit-detail-panel.css`·`history-panel.css`.

```bash
grep -rl --include='*.css' -- '--radius-sm' apps/desktop/src/renderer/src | xargs sed -i '' 's/--radius-sm/--radius-control/g'
```

`changes-panel.css`에 `border-radius: 0 0 var(--radius-sm) var(--radius-sm);` 형태의 **부분 모서리**가 1건 있다(실측) — 치환으로 자연히 따라오지만 결과를 눈으로 확인한다.

- [ ] **Step 2: `--radius-lg` → `--radius-container`.** 실측 3곳: `ui/confirm-dialog.css:35`, `ui/panel.css:9`, `components/repo-picker.css:16`.

```bash
grep -rl --include='*.css' -- '--radius-lg' apps/desktop/src/renderer/src | xargs sed -i '' 's/--radius-lg/--radius-container/g'
```

**값이 14 → 10으로 줄어드는 변경**이다. 패널·확인창·저장소 선택 화면의 인상이 바뀌므로 Task 5 스크린샷에서 반드시 육안 확인한다.

- [ ] **Step 3: `--radius-md` 폐기.** 실측 4곳 — `ui/button.css:6`, `components/commit-form.css:22`, `components/review-detail-panel.css:81`, `components/conflict-panel.css:47`. **전부 `--radius-control`로 내린다**(9px이 블롭의 원인). `commit-form.css:22`는 Task 3에서 통째로 다시 쓰지만 여기서도 일단 치환해 중간 상태가 깨지지 않게 한다.

```bash
grep -rl --include='*.css' -- '--radius-md' apps/desktop/src/renderer/src | xargs sed -i '' 's/--radius-md/--radius-control/g'
```

- [ ] **Step 4: `999px` → `--radius-pill`.** 실측 7곳: `ui/badge.css:5`, `components/review-popover.css:83`, `components/manage-branches.css:34`, `components/shelf-popover.css:77`, `components/history-panel.css:99,128,138`.

```bash
grep -rl --include='*.css' 'border-radius: 999px' apps/desktop/src/renderer/src | xargs sed -i '' 's/border-radius: 999px/border-radius: var(--radius-pill)/g'
```

- [ ] **Step 5: raw px 회수 — 4곳, 각각 판단이 다르다.**

| 위치 | 현재 | 조치 |
| --- | --- | --- |
| `components/history-panel.css:9` | `10px` | → `var(--radius-container)` (패널 카드) |
| `ui/terminal/terminal-dock.css:11` | `8px` | → `var(--radius-container)` (도크 프레임) |
| `components/settings-dialog.css:24` · `components/worktrees-panel.css:132` · `layout.css:234` | `6px` | → `var(--radius-control)` (전부 컨트롤) |
| `ui/base.css:41` | `5px` | **남긴다** — `::-webkit-scrollbar-thumb`. 썸 폭이 8px 남짓이라 6px이면 거의 원이 된다. 남기되 바로 위에 주석을 단다: `/* 스크롤바 썸은 폭이 8px 남짓이라 control(6px)이면 원이 된다 — 의도적 예외 */` |
| `layout.css:181` | `3px` | **남긴다** — `.app__resizer`는 폭 4px 요소다. 같은 형태의 주석을 단다 |

- [ ] **Step 6: 잔재 0 확인(필수).** 아래 세 grep이 **전부 0건**이어야 한다. 하나라도 남으면 그 요소는 모서리가 사라진 채 렌더된다.

```bash
grep -rn --include='*.css' -e '--radius-sm' -e '--radius-md' -e '--radius-lg' apps/desktop/src/renderer/src
grep -rn --include='*.css' 'border-radius: 999px' apps/desktop/src/renderer/src
grep -rn --include='*.css' 'border-radius: [0-9]' apps/desktop/src/renderer/src
```

세 번째는 **예외 2건(`base.css:41` 5px, `layout.css:181` 3px)만** 남아야 하고, 각각 바로 위에 이유 주석이 있어야 한다. 결과를 그대로 보고한다.

- [ ] **Step 7: 게이트.** typecheck · `pnpm test` **524 유지** · `pnpm --filter @git-gui/desktop build` · e2e **96 유지**(포그라운드, `timeout: 600000`).

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/renderer/src
git commit -m "refactor(desktop): E9 모서리 전역 회수 — 구 토큰·raw px 0건, 컨트롤 6·컨테이너 10

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: 커밋 컴포저 — 한 상자 + ⌘↵ 제출

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/CommitForm.tsx`
- Modify: `apps/desktop/src/renderer/src/components/commit-form.css`

- [ ] **Step 1: 컴포넌트 재구성.** `CommitForm.tsx`의 기존 `reason` 계산부(실측 21~30행)를 다음으로 교체 — **사유가 없을 때 빈 문자열이 아니라 대상 요약을 낸다**(빈 span이 높이 0이 되던 E8 함정을 구조적으로 제거):

```tsx
  // E9 — 왼쪽 슬롯은 항상 무언가를 말한다. 못 누르면 이유를, 누를 수 있으면 무엇을 커밋하는지.
  // (E8에서는 누를 수 있을 때 빈 문자열이라 span 높이가 0이 됐다)
  const status = busy
    ? '작업 중이에요'
    : stagedCount === 0 && !allowEmpty
      ? `${T.staged}에 올린 파일이 없어요`
      : effectiveMessage.trim().length === 0
        ? `${T.commitMessage}를 적어 주세요`
        : allowEmpty && stagedCount === 0
          ? `${T.merge} 마무리`
          : `${stagedCount}개 파일`
```

`return` 블록 전체를 다음으로 교체:

```tsx
  const submit = () => {
    if (disabled) return
    // 커밋이 실패하면(훅 거부, 충돌 상태 등) 입력한 메시지를 보존한다
    void onCommit(effectiveMessage).then((committed) => {
      if (committed) setMessage('')
    })
  }

  return (
    <form
      className="commit-form"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <label className="commit-form__label" htmlFor="commit-message">
        {T.commitMessage}
      </label>
      <div className="commit-form__box">
        <textarea
          id="commit-message"
          data-testid="commit-message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            // ⌘↵ / Ctrl+↵ 제출. 한글 조합 중 Enter는 확정용이라 제출하면 안 된다 (E1a PromptDialog 선례)
            if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return
            if (event.nativeEvent.isComposing) return
            event.preventDefault()
            submit()
          }}
          placeholder={suggestion ? `비워 두면: ${suggestion}` : '무엇을 바꿨는지 적어 주세요'}
          rows={3}
        />
        <div className="commit-form__foot">
          <span className="commit-form__status" data-testid="commit-hint">
            {status}
          </span>
          <Button variant="soft" size="sm" type="submit" isDisabled={disabled} testId="commit-button">
            {allowEmpty && stagedCount === 0 ? `${T.merge} 마무리` : T.commit}
            <kbd className="commit-form__kbd">⌘↵</kbd>
          </Button>
        </div>
      </div>
    </form>
  )
```

⚠️ **`variant="soft"`는 아직 없다.** Step 3에서 만든다. `Button`의 `variant` prop 타입에 없는 값을 넘기면 typecheck가 잡아 준다 — Step 3 전에는 적색이 정상이다.

⚠️ **`status`가 항상 비어 있지 않게 바뀌므로 `smoke.spec.ts:152`가 영향받는다.** E8 마무리가 그 자리를 `toHaveText('')`로 바꿔 놨다(실측). 이제 그 상태에서 `1개 파일`이 나오므로 **단언을 그 문구로 1:1 갱신**한다. 삭제·약화 금지.

- [ ] **Step 2: CSS 교체.** `commit-form.css` 전체를 다음으로:

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
.commit-form__label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  font-weight: 700;
}
/* E9 — 입력과 액션 줄을 한 상자로. 버튼이 상자에 소속되면 떠 있는 인상과 테두리 중첩이 함께 사라진다.
   테두리는 이 상자 하나만 갖는다(안쪽 textarea는 테두리 없음, 액션 줄은 border-top으로만 나눔) */
.commit-form__box {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-control);
  background: var(--color-surface);
  overflow: hidden;
}
/* 포커스 링을 textarea가 아니라 상자가 받는다 — "이 상자가 하나"라는 사실이 강화된다 */
.commit-form__box:focus-within {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 1px var(--color-accent);
}
.commit-form textarea {
  resize: none;
  min-height: 64px;
  padding: var(--space-2) var(--space-3);
  border: none;
  outline: none;
  background: transparent;
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  color: var(--color-text);
}
.commit-form__foot {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  justify-content: space-between;
  padding: var(--space-1) var(--space-1) var(--space-1) var(--space-3);
  border-top: 1px solid var(--color-border);
}
.commit-form__status {
  min-width: 0;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 단축키 힌트 — 라벨보다 한 단계 흐리게, 자체 배경 없이(칩이 하나 더 생기면 다시 시끄러워진다) */
.commit-form__kbd {
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  opacity: 0.65;
}
/* 좁은 창에서 버튼 라벨이 줄바꿈되지 않게 (E1a 이관) — 제출 버튼은 공용 Button이라 전용 클래스가 없다 */
.commit-form button[type='submit'] {
  white-space: nowrap;
}
```

- [ ] **Step 3: `Button`에 `soft` variant 추가.** `ui/Button.tsx`의 `variant` 유니언에 `'soft'`를 더하고, `ui/button.css`의 `.ui-button--primary` 블록(실측 21~30행) **바로 아래**에 추가:

```css
/* E9 — 채운 강조가 좌측 열에서 유일한 큰 색 면적이라 튀었다. 옅은 배경 + 진한 글자로 무게를 낮춘다 */
.ui-button--soft {
  background: var(--color-accent-soft);
  color: var(--color-accent-soft-text);
}
.ui-button--soft[data-hovered] {
  background: var(--color-accent);
  color: var(--color-accent-text);
}
.ui-button--soft[data-pressed] {
  background: var(--color-accent-active);
  color: var(--color-accent-text);
}
```

`Button.tsx`를 **실독**하고 그 파일의 기존 관용(유니언 정의 위치·클래스 조립 방식)을 따른다. 추측하지 말 것.

- [ ] **Step 4: 육안 검증(필수).** Playwright Electron으로 (a) 상자가 **테두리 1겹**인지(textarea에 자체 테두리가 없는지 `getComputedStyle`로 확인) (b) textarea 포커스 시 링이 **상자**에 뜨는지 (c) 버튼 `border-radius`가 6px인지 (d) 왼쪽 슬롯이 스테이지 0/1/병합 세 상태에서 각각 무엇을 말하는지 — 수치·문구를 그대로 보고한다. 임시 spec은 삭제.

- [ ] **Step 5: 게이트.** typecheck · `pnpm test` **524 유지** · build · e2e **96 유지**(포그라운드, `timeout: 600000`). `smoke.spec.ts:152` 갱신 외에 깨지는 테스트가 있으면 원인을 고친다(비활성·삭제 금지).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src apps/desktop/e2e/smoke.spec.ts
git commit -m "feat(desktop): E9 커밋 컴포저 — 한 상자·상자 포커스 링·soft 버튼·⌘↵ 제출

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: E2E 3건 — ⌘↵ 동작·IME 가드·상태 문구

**Files:** `apps/desktop/e2e/smoke.spec.ts`

`T`는 `smoke.spec.ts:8`에서 이미 import돼 있고 `mkdtemp`·`tmpdir`·`rm`·`execGitOrThrow`·`electron`·`APP_ROOT`도 기존 import에 있다. 스테이징 관용은 **`check-unstaged-<이름>` 클릭 → `stage-selected` 클릭**이다(`stage-all`은 없다 — 실측).

- [ ] **Step 1: ⌘↵ 제출.** 파일 끝에 추가:

```ts
test('E9 — ⌘↵로 커밋된다', async () => {
  const repo = await createRepoWithChange()
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo, GIT_GUI_USER_DATA: await mkdtemp(join(tmpdir(), 'gg-ud-')) },
  })
  try {
    const window = await app.firstWindow()
    await window.getByTestId('check-unstaged-app.txt').click()
    await window.getByTestId('stage-selected').click()
    await expect(window.getByTestId('staged-count')).toHaveText('1')
    await window.getByTestId('commit-message').fill('e2e: 단축키 커밋')
    await window.getByTestId('commit-message').press('ControlOrMeta+Enter')
    await expect(window.getByTestId('staged-count')).toHaveText('0')
    const log = await execGitOrThrow(['log', '-1', '--format=%s'], { cwd: repo })
    expect(log.stdout.trim()).toBe('e2e: 단축키 커밋')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: 커밋 불가 상태에서 ⌘↵ 무시.** 스테이지가 빈 상태(파일을 올리지 않음)에서 메시지를 채우고 `ControlOrMeta+Enter`를 눌렀을 때 **커밋이 생기지 않는지**를 단언한다. `git log --oneline | wc -l`이 전후 동일한지, 또는 `git log -1 --format=%s`가 픽스처의 최초 커밋 제목 그대로인지로 확인한다 — **"아무 일도 안 일어남"을 시간 대기가 아니라 git 상태로 증명할 것.** 픽스처의 최초 커밋 제목은 `createRepoWithChange()`를 실독해 확인한다(추측 금지).

- [ ] **Step 3: 왼쪽 슬롯이 상태를 말한다.** ① 아무것도 스테이지하지 않은 상태 → `commit-hint`가 `올린 파일이 없어요`를 포함 ② 1개 스테이지 후 → `1개 파일`. **두 번째가 이 태스크의 핵심**이다 — E8에서는 이 자리가 빈 문자열이라 높이 0이었다. `toHaveText`로 정확 문구를 물고, `toBeVisible()`도 함께 걸어 높이 0 회귀를 잡는다.

- [ ] **Step 4: IME 가드는 E2E로 덮지 않는다 — 대신 실측 보고.** Playwright에서 `isComposing`을 신뢰성 있게 만들려면 CDP 저수준 이벤트가 필요해 테스트가 취약해진다. 대신 **실제 앱에서 한글 조합 중 ⌘↵를 눌러 제출되지 않는지 직접 확인**하고 결과를 보고한다. 확인이 불가능하면 그 사실을 명시하고 후속 노트로 남긴다 — **덮었다고 말하지 말 것.**

- [ ] **Step 5: 각 신규 테스트를 `-g`로 2회씩** 돌려 비플레이키를 확인하고 결과를 붙인다.

- [ ] **Step 6: 게이트.** `npx playwright test e2e/smoke.spec.ts` **93**(90+3) · `pnpm --filter @git-gui/desktop e2e` **99**(93+6) · `pnpm test` 524 · typecheck. 포그라운드, `timeout: 600000`.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/e2e/smoke.spec.ts
git commit -m "test(desktop): E9 E2E 3건 — ⌘↵ 커밋·불가 상태 무시·상태 문구

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: 최종 게이트 + 스크린샷 + README

**Files:** `README.md`

- [ ] **Step 1: 전체 게이트.** typecheck 6/6 · `pnpm test` **524** · `pnpm --filter @git-gui/desktop build` · `pnpm --filter @git-gui/desktop e2e` **99** · `last-screen` 아티팩트 0건. 실제 숫자를 보고한다.

- [ ] **Step 2: 스크린샷 4장.** 임시 spec `apps/desktop/e2e/tmp-shots-e9.spec.ts`(1440×900·try/finally 정리·촬영 후 spec 삭제·전체 e2e 재실행 금지):
  1. `e9-composer-idle.png` — 스테이지 0, 좌측 열
  2. `e9-composer-ready.png` — 1개 스테이지 + 메시지 입력, textarea 포커스 상태(상자 링이 보여야 한다)
  3. `e9-panels.png` — 모서리 10px 적용 후 전체 화면(패널 3개가 한 화면에)
  4. `e9-dialog.png` — 확인창 하나를 열어 컨테이너 모서리 확인
  스크래치패드(`/private/tmp/claude-501/-Users-sangyeop-kim-git-gui/b4ef6d32-042d-440c-8252-b8944659aa01/scratchpad/`)에 절대 경로로 보고 — 컨트롤러가 육안 검수 후 사용자에게 보낸다. **14→10 변경은 취향이 갈릴 수 있는 지점이라 3·4번이 특히 중요하다.**

- [ ] **Step 3: README.** 기존 E8 문장(실독) 뒤에 추가:

```markdown
E9: 커밋 폼을 입력과 액션 줄이 한 테두리 안에 있는 컴포저로 바꾸고(⌘↵로 커밋), 앱 전역 모서리를 용도 기반 3단(`--radius-control` 6px · `--radius-container` 10px · `--radius-pill`)으로 통일했습니다.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: E9 README — 컴포저·모서리 3단

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 게이트 표 (누적)

| 시점 | 루트 테스트 | smoke | e2e 합 |
| --- | --- | --- | --- |
| 시작 | 523 | 90 | 96 |
| Task 1 후 | +1 → **524** | 90 | 96 |
| Task 2 후 | 524 유지 | 90 유지 | 96 유지 |
| Task 3 후 | 524 유지 | 90 유지 | 96 유지 |
| Task 4 후 | 524 유지 | +3 → **93** | **99** |
| Task 5 후 | 524 | 93 | 99 |

## Self-Review (플랜 자체 점검)

1. **스펙 커버리지**: ①컴포저=T3 · ②모서리 3단=T1(토큰)+T2(회수) · ③테두리 규칙=T3(상자 1겹·focus-within)+T2(중첩 제거) · 에러표: IME 가드=T3 Step 1 코드 + T4 Step 4 실측 · 불가 상태 ⌘↵=T3 `submit()`의 `disabled` 조기 반환(분기 재사용) + T4 Step 2 · textarea 링 제거=T3 CSS · 좁은 창=`min-width: 0` · 14→10 파급=T5 스크린샷 · `--radius-md` 잔존=T2 Step 6 grep · accent-soft 대비=T1 Step 3.
2. **자리표시자**: 없음. 모든 CSS·TSX 블록이 완본이고, "실독하라"고 쓴 3곳(`Button.tsx` 관용·`createRepoWithChange()` 최초 커밋 제목·README E8 문단 위치)은 **플랜이 알 수 없는 값**이라 의도적으로 지시로 남겼다.
3. **타입 정합**: `variant="soft"`가 T3 Step 1(사용)보다 Step 3(정의)에 늦게 나온다 — 같은 태스크·같은 커밋 안이고 Step 1에 경고를 달았다. `status`/`submit`은 T3 안에서 정의·사용이 닫힌다. `--radius-*` 새 이름은 T1에서 정의되고 T2가 소비한다(순서 맞음).
4. **알려진 위험**: T2 Step 1~4의 `sed -i ''`는 macOS 전용 형식이다(이 저장소는 darwin). 치환 후 Step 6 grep이 안전망이다.
