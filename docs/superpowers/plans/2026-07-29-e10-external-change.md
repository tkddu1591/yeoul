# E10 외부 변경 감지 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 앱 밖에서 파일이 바뀌면(에디터 되돌리기·파일 삭제·외부 편집) 수동 새로고침 없이 화면이 따라오게 한다.

**Architecture:** 순수 함수(굶지 않는 디바운스 + `.git/` 배제 필터) → main 워킹트리 감시 추가 → main 포커스 push → 렌더러 수신 → E2E.

**Tech Stack:** Electron main `fs.watch`, Vitest 순수 단위(가짜 타이머), Playwright Electron E2E.

**게이트 기준선(실측):** 루트 `pnpm test` **523** · `pnpm --filter @git-gui/desktop e2e` **100**(smoke 94 + hosting 6) · typecheck 6/6. **루트에 `build` 스크립트가 없다 — `pnpm --filter @git-gui/desktop build`.**

⚠️ **모든 Playwright 실행은 단일 포그라운드 Bash 호출 + `timeout: 600000`.** 기본 120초 제한에 걸려 자동 백그라운드되면 워크플로가 멈춘다. E8·E9에서 반복된 사고다.

**진단 근거(스펙 실측 재게):** 추적 안 된 파일 생성·삭제·추적 파일 수정은 `.git` 이벤트가 **0건**. `git checkout -- <file>`만 41ms 내 3건. 워킹트리 루트 감시 시 유휴 **0건** · 소스 1개 touch **1건** · 빌드 1회 **209건**(전부 gitignore 대상 `out/`). `git status --porcelain=v2`는 **20~100ms**.

---

### Task 1: 굶지 않는 디바운스 + `.git/` 배제 필터 (순수)

**Files:**
- Modify: `apps/desktop/src/main/watch-filter.ts`
- Test: `apps/desktop/test/watch-filter.test.ts`

기존 `createTrailingDebounce`는 hit이 계속 오면 **영원히 발화하지 않는다**. 개발 서버가 파일을 계속 쓰는 상황이 정확히 그 경우다. 최대 대기를 더한다. 이 함수는 `.git` 감시도 쓰므로 함께 개선된다.

- [ ] **Step 1: 실패하는 테스트 먼저.** `watch-filter.test.ts`의 `describe('createTrailingDebounce', …)` 블록 안에 추가(이 파일은 `vi.useFakeTimers()` 관용을 이미 쓴다 — 실측 58~64행):

```ts
  it('hit이 계속 와도 maxWaitMs가 지나면 발화한다 — 개발 서버가 파일을 계속 쓰면 트레일링만으로는 굶는다', () => {
    const fire = vi.fn()
    const debounce = createTrailingDebounce(300, fire, 2000)
    // 100ms마다 hit — 트레일링 창(300)이 매번 갱신돼 혼자서는 영원히 발화하지 않는다
    for (let elapsed = 0; elapsed < 1900; elapsed += 100) {
      debounce.hit()
      vi.advanceTimersByTime(100)
    }
    expect(fire).not.toHaveBeenCalled()
    debounce.hit()
    vi.advanceTimersByTime(100)
    expect(fire).toHaveBeenCalledTimes(1)
  })

  it('maxWait 발화 후에는 새 사이클이다 — 다음 hit이 즉시 또 터지지 않는다', () => {
    const fire = vi.fn()
    const debounce = createTrailingDebounce(300, fire, 2000)
    for (let elapsed = 0; elapsed <= 2000; elapsed += 100) {
      debounce.hit()
      vi.advanceTimersByTime(100)
    }
    expect(fire).toHaveBeenCalledTimes(1)
    debounce.hit()
    vi.advanceTimersByTime(299)
    expect(fire).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(fire).toHaveBeenCalledTimes(2)
  })

  it('maxWaitMs를 주지 않으면 기존 트레일링 동작 그대로다', () => {
    const fire = vi.fn()
    const debounce = createTrailingDebounce(300, fire)
    for (let elapsed = 0; elapsed < 5000; elapsed += 100) {
      debounce.hit()
      vi.advanceTimersByTime(100)
    }
    expect(fire).not.toHaveBeenCalled()
  })
```

그리고 `isRelevantGitEvent` describe 옆에 새 describe 추가:

```ts
describe('isWorkingTreeEvent', () => {
  it('워킹트리 파일을 받는다', () => {
    expect(isWorkingTreeEvent('src/app.ts')).toBe(true)
    expect(isWorkingTreeEvent('README.md')).toBe(true)
  })

  it('.git 아래는 버린다 — 전용 감시가 이미 본다(중복 발화 방지)', () => {
    expect(isWorkingTreeEvent('.git')).toBe(false)
    expect(isWorkingTreeEvent('.git/index')).toBe(false)
    expect(isWorkingTreeEvent('.git/refs/heads/main')).toBe(false)
  })

  it('.git으로 시작하는 다른 이름은 워킹트리 파일이다', () => {
    expect(isWorkingTreeEvent('.gitignore')).toBe(true)
    expect(isWorkingTreeEvent('.github/workflows/ci.yml')).toBe(true)
  })
})
```

`import` 줄에 `isWorkingTreeEvent`를 추가한다.

- [ ] **Step 2: 실패 확인.** `npx vitest run apps/desktop/test/watch-filter.test.ts` — `isWorkingTreeEvent` 미정의로 실패하고, maxWait 테스트도 실패해야 한다. **출력을 그대로 보고한다.**

- [ ] **Step 3: 구현.** `watch-filter.ts`의 기존:

```ts
/** 마지막 hit 후 delayMs가 지나면 fire를 1회 부른다 — git 한 명령의 이벤트 폭주를 묶는다 */
export function createTrailingDebounce(delayMs: number, fire: () => void): TrailingDebounce {
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    hit() {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        fire()
      }, delayMs)
    },
    dispose() {
      if (timer !== null) clearTimeout(timer)
      timer = null
    },
  }
}
```

교체:

```ts
/**
 * 마지막 hit 후 delayMs가 지나면 fire를 1회 부른다 — git 한 명령의 이벤트 폭주를 묶는다.
 * maxWaitMs를 주면 **첫 hit로부터** 그만큼 지났을 때 조용해지길 기다리지 않고 발화한다:
 * 트레일링만 있으면 개발 서버처럼 계속 쓰는 프로세스 앞에서 영원히 굶는다(E10).
 */
export function createTrailingDebounce(
  delayMs: number,
  fire: () => void,
  maxWaitMs?: number,
): TrailingDebounce {
  let timer: ReturnType<typeof setTimeout> | null = null
  let cycleStartedAt: number | null = null
  const clear = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    cycleStartedAt = null
  }
  return {
    hit() {
      if (cycleStartedAt === null) cycleStartedAt = Date.now()
      const remaining =
        maxWaitMs === undefined ? delayMs : Math.min(delayMs, cycleStartedAt + maxWaitMs - Date.now())
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(
        () => {
          clear()
          fire()
        },
        Math.max(0, remaining),
      )
    },
    dispose: clear,
  }
}
```

⚠️ **`Date.now()`는 `vi.useFakeTimers()`가 함께 가짜로 만든다**(vitest 기본 `toFake`에 `Date` 포함). Step 1 테스트가 이 전제 위에 서 있으니, 만약 이 저장소 vitest 설정이 `Date`를 가짜로 만들지 않으면 **테스트가 통과하지 못한다 — 그때는 멈추고 보고하라.** 임의로 `performance.now()`나 실시간 대기로 바꾸지 말 것.

같은 파일 끝에 필터 추가:

```ts
/**
 * 워킹트리 감시 필터 (E10) — `.git` 아래는 전용 감시(isRelevantGitEvent)가 이미 본다.
 * **무시 목록을 두지 않는다**: 실측상 빌드 1회가 209 이벤트지만 디바운스가 재조회 1회로
 * 합치고 git status는 20~100ms다. .gitignore 의미론을 반쯤 흉내 내다 틀리는 쪽이 더 위험하다
 */
export function isWorkingTreeEvent(relativePath: string): boolean {
  return relativePath !== '.git' && !relativePath.startsWith('.git/')
}
```

- [ ] **Step 4: 통과 확인 + 게이트.** 같은 vitest 명령 통과. 루트 `pnpm test` — **529**(523 + 신규 6). **실제 숫자를 보고한다** — 이 저장소는 `describe.each`로 테스트가 배로 느는 파일이 있어 예측이 빗나간 적이 있다(E9 실측).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/watch-filter.ts apps/desktop/test/watch-filter.test.ts
git commit -m "feat(desktop): E10 굶지 않는 디바운스 + 워킹트리 이벤트 필터

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: 워킹트리 감시 (main)

**Files:**
- Modify: `apps/desktop/src/main/repo-watcher.ts`
- Modify: `apps/desktop/src/main/git-handlers.ts`

- [ ] **Step 1: `repo-watcher.ts`에 워킹트리 감시 추가.** 기존 `watchRepository`는 그대로 두고(`.git` 전용), 아래를 파일 끝에 추가한다. `import` 줄에 `isWorkingTreeEvent`를 더한다:

```ts
/** 워킹트리 이벤트는 파일 저장 한 번이 여러 건이라 묶고, 계속 쓰는 프로세스에 굶지 않게 상한을 둔다 */
const WORKTREE_MAX_WAIT_MS = 2000

/**
 * 저장소 루트(워킹트리)를 감시한다 (E10) — 파일 내용만 바뀌는 변화는 .git에 흔적이 없어
 * 기존 watchRepository로는 영원히 잡히지 않았다(실측: 추적 안 된 파일 생성·삭제·추적 파일
 * 수정 모두 .git 이벤트 0건). 실패는 기능 저하로만 — 던지지 않는다(watchRepository 관례)
 */
export function watchWorkingTree(rootPath: string, onChanged: () => void): () => void {
  const debounce = createTrailingDebounce(DEBOUNCE_MS, onChanged, WORKTREE_MAX_WAIT_MS)
  let watcher: FSWatcher | null = null
  try {
    watcher = watch(rootPath, { recursive: true }, (_type, file) => {
      if (file !== null && isWorkingTreeEvent(file.toString())) debounce.hit()
    })
    watcher.on('error', () => {
      watcher?.close()
      watcher = null
      debounce.dispose()
    })
  } catch {
    return () => {}
  }
  return () => {
    debounce.dispose()
    watcher?.close()
  }
}
```

- [ ] **Step 2: `git-handlers.ts` 배선.** 기존(실측 142~164행) `repoWatch` 핸들러에서 `stopWatching` 하나만 쓰던 것을 **두 감시**로 바꾼다. 기존:

```ts
    stopWatching?.()
    const sender = event.sender
    stopWatching = watchRepository(gitDir, () => {
      if (!sender.isDestroyed()) sender.send(CHANNELS.repoChanged, path)
    })
    if (!watchCleanupHooked.has(sender)) {
      watchCleanupHooked.add(sender)
      sender.once('destroyed', () => {
        stopWatching?.()
        stopWatching = null
      })
    }
```

교체:

```ts
    stopWatching?.()
    const sender = event.sender
    const notify = (): void => {
      if (!sender.isDestroyed()) sender.send(CHANNELS.repoChanged, path)
    }
    // .git 감시는 HEAD·refs·상태 마커를, 워킹트리 감시는 파일 내용을 본다 — 목적이 달라 둘 다 필요하다 (E10)
    const stopGit = watchRepository(gitDir, notify)
    const stopTree = watchWorkingTree(path, notify)
    stopWatching = () => {
      stopGit()
      stopTree()
    }
    if (!watchCleanupHooked.has(sender)) {
      watchCleanupHooked.add(sender)
      sender.once('destroyed', () => {
        stopWatching?.()
        stopWatching = null
      })
    }
```

`import` 줄에 `watchWorkingTree`를 더한다.

- [ ] **Step 3: 실측(필수) — 감시가 실제로 잡는지, 폭풍이 몇 번의 재조회가 되는지.** Playwright Electron 프로브로 실제 앱을 띄우고 저장소를 열어 다음을 **수치로** 보고한다:
  - (a) 앱 밖에서 추적 안 된 파일 생성 → 변경 목록에 뜨기까지 **ms**
  - (b) 그 파일 삭제 → 사라지기까지 **ms**
  - (c) 추적 파일 수정 → 뜨기까지 **ms**, 이어서 `git checkout --`로 되돌림 → 사라지기까지 **ms**
  - (d) **폭풍**: 저장소 안에서 파일 200개를 연속 생성(빌드 209 이벤트 재현) → 그동안 `externalRefresh`가 **몇 번** 불렸는지. **1~2회여야 한다.** 세는 방법은 스스로 정하되(예: 렌더러에 카운터를 노출) 방법을 보고에 적을 것.
  프로브는 측정 후 삭제.

- [ ] **Step 4: 게이트.** typecheck · 루트 `pnpm test` 529 유지 · build · e2e **100 유지**(포그라운드, `timeout: 600000`). **자기 꼬리 억제 무회귀가 이 태스크의 최대 위험**이다 — 앱 내 작업(변경 취소·스태시 꺼내기)이 이제 워킹트리 이벤트를 낳는다. 기존 E2E가 깨지면 원인을 고친다(비활성·삭제 금지).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main
git commit -m "feat(desktop): E10 워킹트리 감시 — 파일만 바뀌는 변화도 따라온다

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: 포커스 갱신 (main → 렌더러)

**Files:**
- Modify: `packages/ipc-contract/src/index.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/renderer/src/store/repository-store.ts`

- [ ] **Step 1: 채널.** `WINDOW_CHANNELS`(전체화면 push가 쓰는 그 객체 — **실독해 정확한 이름·위치를 확인**)에 `focused: 'window:focused'`를 더한다. `repo:*`가 아니라 `window:*`인 이유: 저장소가 아니라 **창** 사건이다(전체화면 push와 같은 계열).

- [ ] **Step 2: main.** `index.ts`의 `createWindow()` 안, 기존 전체화면 push 옆(실측 59~64행)에 추가:

```ts
  // 창으로 돌아오면 재조회 — 감시가 못 잡은 잔여와 감시가 죽은 경우(watch error로 조용히 닫힘)를 메운다 (E10)
  window.on('focus', () => {
    window.webContents.send(WINDOW_CHANNELS.focused)
  })
```

- [ ] **Step 3: preload.** 전체화면 구독과 **같은 관용**으로 `onWindowFocused(listener): () => void`를 노출한다. `preload/index.ts`의 전체화면 부분을 실독하고 그 형태를 그대로 따를 것(리스너 래핑·removeListener 반환).

- [ ] **Step 4: 렌더러 구독.** `repository-store.ts`의 `init`에서 감시 구독 바로 아래(실측 437~440행 `git().repo.onChanged(…)`)에 추가:

```ts
    // 창 복귀 시 재조회 — 억제 창(WATCH_SUPPRESS_MS)을 일부러 무시한다. 사용자가 명시적으로
    // 돌아온 순간이라 최신화가 우선이고, 자기 꼬리 억제는 감시발 자동 재조회를 위한 장치다 (E10)
    window.api.onWindowFocused(() => {
      if (get().repoPath !== null) void get().refresh()
    })
```

⚠️ `externalRefresh`가 아니라 **`refresh`**를 부른다 — `externalRefresh`는 억제 창에 걸려 조용히 반환할 수 있다. 실제 API 이름·형태는 preload 실독에 맞춘다(위 `window.api` 표기는 예시).

- [ ] **Step 5: 수동 확인(E2E로 못 덮는다).** 스펙이 밝힌 대로 E2E는 숨김 창이라 `focus` 이벤트가 오지 않는다. `pnpm --filter @git-gui/desktop dev`로 앱을 띄우고 저장소를 연 뒤: 앱 밖에서 파일을 수정 → 다른 앱으로 갔다가 → Git GUI로 돌아왔을 때 즉시 반영되는지 확인하고 **본 것을 그대로 보고**한다. 확인이 불가능하면 **불가능하다고 적을 것 — 덮었다고 말하지 말 것.**

- [ ] **Step 6: 게이트.** typecheck(ipc-contract 포함 6/6) · 루트 529 · build · e2e 100.

- [ ] **Step 7: Commit**

```bash
git add packages/ipc-contract apps/desktop/src
git commit -m "feat(desktop): E10 창 복귀 시 재조회 — 감시 사각지대를 메운다

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: E2E 3건 + 최종 게이트 + README

**Files:** `apps/desktop/e2e/smoke.spec.ts` · `README.md`

세 테스트 모두 **E10 이전 코드에서는 반드시 실패**한다(수동 새로고침 없이는 영원히 안 뜬다) — 회귀 검출력이 확실하다.

- [ ] **Step 1: E2E 3건.** 기존 관용을 따른다: `createRepoWithChange()`, `check-unstaged-<이름>`→`stage-selected`, `GIT_GUI_USER_DATA` 격리. 파일 조작은 `node:fs/promises`의 `writeFile`/`rm`(이미 import돼 있는지 실독).

```ts
test('E10 — 앱 밖에서 만든 파일이 새로고침 없이 나타난다', async () => { … })
test('E10 — 앱 밖에서 지운 파일이 새로고침 없이 사라진다', async () => { … })
test('E10 — 앱 밖에서 되돌린 수정이 새로고침 없이 사라진다', async () => { … })
```

각각: 앱을 띄우고 목록이 안정된 뒤 → **앱 API를 쓰지 않고** `writeFile`/`rm`/`execGitOrThrow(['checkout','--',…])`로 저장소를 바꾼다 → `expect(...).toBeVisible()`/`toHaveCount(0)` 등으로 **폴링 단언**(Playwright가 자동 재시도한다 — `waitForTimeout` 고정 대기 금지). 세 번째는 수정→변경으로 뜸→`checkout --`→사라짐까지 한 흐름으로 본다.

- [ ] **Step 2: 각 신규 테스트 `-g`로 2회씩** 돌려 비플레이키 확인, 결과를 붙인다. 디바운스 300ms + 감시 지연이 있어 **타이밍에 민감한 테스트**다 — 불안정하면 고정 대기를 넣지 말고 단언 타임아웃을 늘려라.

- [ ] **Step 3: 최종 게이트.** typecheck 6/6 · 루트 **529** · build · smoke **97**(94+3) · e2e **103**(97+6) · `last-screen` 아티팩트 0건.

- [ ] **Step 4: README.** 기존 E9 문장(**실독**) 뒤에 추가:

```markdown
E10: 앱 밖에서 파일이 바뀌면(에디터 되돌리기·파일 삭제·외부 편집) 새로고침 없이 화면이 따라옵니다. 창으로 돌아올 때도 다시 조회합니다.
```

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/e2e/smoke.spec.ts README.md
git commit -m "test(desktop): E10 E2E 3건 — 외부 생성·삭제·되돌림 + README

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 게이트 표 (누적)

| 시점 | 루트 테스트 | smoke | e2e 합 |
| --- | --- | --- | --- |
| 시작 | 523 | 94 | 100 |
| Task 1 후 | +6 → **529** | 94 | 100 |
| Task 2 후 | 529 유지 | 94 유지 | 100 유지 |
| Task 3 후 | 529 유지 | 94 유지 | 100 유지 |
| Task 4 후 | 529 | +3 → **97** | **103** |

## Self-Review (플랜 자체 점검)

1. **스펙 커버리지**: ①워킹트리 감시=T2(+필터 T1) · ②굶지 않는 디바운스=T1 · ③포커스 갱신=T3 · ④자기 꼬리 억제 관계=T2 Step 4 위험 명시 + T3 Step 4의 `refresh` 선택 근거. 에러표: 루트 소멸=`watch` error 핸들러(T2 Step 1) · 링크드 워크트리=`.git/` 접두 필터(T1) · 큰 저장소=T2 Step 3 (d) 폭풍 실측 · 저장소 전환=`stopWatching` 교체 유지(T2 Step 2) · 숨김 창 포커스=T3 Step 5 수동 확인 명시.
2. **자리표시자**: 없음. "실독하라"고 남긴 4곳(`WINDOW_CHANNELS` 위치·preload 전체화면 관용·`window.api` 실제 표기·README E9 문단 위치)은 **플랜이 단정하면 틀릴 수 있는 값**이라 의도적으로 지시로 남겼다. E2E 본문은 관용이 이미 확립돼 있어 시나리오와 금지사항(고정 대기 금지)을 지정했다.
3. **타입 정합**: `createTrailingDebounce`의 3번째 인자는 **선택**이라 기존 `.git` 감시 호출부(인자 2개)가 그대로 컴파일된다 — T1이 T2보다 먼저다. `isWorkingTreeEvent`는 T1에서 정의되고 T2가 소비한다.
4. **알려진 위험**: ① `Date.now()`가 가짜 타이머에 포함되지 않으면 T1 테스트가 통과 못 한다 → 멈추고 보고하도록 명시. ② 앱 자신의 워킹트리 쓰기가 자기 꼬리 이벤트를 늘린다 → T2 Step 4가 최대 위험으로 지목. ③ E2E 3건이 타이밍 민감 → 고정 대기 금지 + 타임아웃 조절로 지시.
