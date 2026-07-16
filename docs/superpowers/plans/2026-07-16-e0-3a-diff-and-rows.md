# E0-3a 표시 계층 개선 구현 계획 (사용자 피드백 #1·#2·#3·#5·#8)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 파일 행을 IntelliJ식 색상 표기로 바꾸고(오버플로 수정 포함), diff를 구조화된 모델로 전환해 좌우(side-by-side) 보기를 추가하고, diff 선택 해제와 타임라인 시작선을 정리한다.

**Architecture:** diff를 "원시 텍스트 렌더"에서 "도메인 모델 렌더"로 전환한다 — domain에 FileDiff/DiffHunk/DiffLine 타입, adapter에 patch 파서(비전 문서의 'Git 출력 → 도메인 모델' 원칙), IPC는 FileDiff를 반환, renderer는 unified/split을 모델에서 그린다. 기존 diff-lines.ts(표시용 휴리스틱)는 제거된다. 파일 행은 배지 대신 파일명 색상+선행 점으로 변경 종류를 표기하되 접근성(색 단독 금지)은 점+aria-label+title로 유지한다.

**Tech Stack:** 기존과 동일 (신규 의존성 없음).

**사용자 피드백 매핑:** #2·#3 → Task 1, #8·#5 → Task 2, #1 → Task 3·4. (#4 가상화, #6 커밋 상세, #7 refs 배지는 E0-3b 플랜.)

**알려진 한계(의도적):** merge commit의 combined diff(`--cc`)는 파서가 다루지 않는다(현재 UI는 커밋 diff를 보여주지 않음 — E0-3b 커밋 상세에서 첫 부모 기준으로 다룬다). split 뷰의 워드 단위 하이라이트는 후속.

---

## 파일 구조

```
packages/domain/src/diff.ts                  # FileDiff/DiffHunk/DiffLine (신규)
packages/git-adapter/src/diff-parser.ts     # parsePatch (신규, 순수)
packages/git-adapter/test/diff-parser.test.ts
packages/git-adapter/src/client.ts           # changes.diff → FileDiff 반환
packages/ipc-contract/src/index.ts           # diff 반환 타입 교체
apps/desktop/src/renderer/src/
  components/ChangesPanel.tsx + changes-panel.css   # 파일명 색상·오버플로 (Task 1)
  components/DiffPanel.tsx + diff-panel.css         # 모델 렌더 + 닫기 + split 토글
  components/diff-split.ts                    # split 짝짓기 (신규, 순수)
  components/history-panel.css                # 타임라인 커넥터 (Task 2)
  store/repository-store.ts                   # diffText → diff: FileDiff|null, clearSelection
  App.tsx                                     # onClose 연결
apps/desktop/test/diff-split.test.ts
apps/desktop/test/tokens-contrast.test.ts     # change-* 대비 쌍 추가
삭제: components/diff-lines.ts, apps/desktop/test/diff-lines.test.ts
```

---

### Task 1: FileRow — IntelliJ식 파일명 색상과 오버플로 수정 (#2·#3)

**Files:**
- Modify: `apps/desktop/test/tokens-contrast.test.ts` (change-* 대비 쌍 — surface 5 + selection-bg 6)
- Modify: `apps/desktop/src/renderer/src/ui/tokens.css` (라이트 change-modified/deleted 교정)
- Modify: `apps/desktop/src/renderer/src/components/ChangesPanel.tsx`, `components/changes-panel.css`
- Modify: `apps/desktop/src/renderer/src/ui/Pictogram.tsx`, `ui/pictogram.css` (죽은 코드 제거 — ChangeKindBadge·CHANGE_LABELS·.ui-change-badge 규칙: 이 커밋으로 사용처가 사라짐)

- [ ] **Step 1: 대비 회귀 테스트에 파일명 색 쌍 먼저 추가**

`apps/desktop/test/tokens-contrast.test.ts`의 PAIRS에서 `['--term-badge', '--term-badge-bg', 4.5],` 다음에 추가:
```ts
  // 파일명 자체를 변경 종류 색으로 표기한다(IntelliJ식) — 본문 텍스트 기준 대비 필요.
  // 선택 행(selection-bg) 위에서도 읽혀야 한다 — 사용자가 지금 보고 있는 바로 그 행이다.
  ['--change-modified', '--color-surface', 4.5],
  ['--change-added', '--color-surface', 4.5],
  ['--change-deleted', '--color-surface', 4.5],
  ['--change-renamed', '--color-surface', 4.5],
  ['--change-untracked', '--color-surface', 4.5],
  ['--change-modified', '--color-selection-bg', 4.5],
  ['--change-added', '--color-selection-bg', 4.5],
  ['--change-deleted', '--color-selection-bg', 4.5],
  ['--change-renamed', '--color-selection-bg', 4.5],
  ['--change-untracked', '--color-selection-bg', 4.5],
  ['--concept-conflict', '--color-selection-bg', 4.5],
```

Run: `pnpm test`
Expected: **124 tests** — 라이트 테마에서 `--change-modified`(4.42:1)·`--change-deleted`(4.16:1) vs selection-bg 쌍이 실패해야 한다(TDD Red). 확인 후 `apps/desktop/src/renderer/src/ui/tokens.css`의 라이트 값 두 개를 교정한다:
```
  --change-modified: #8f5a17;
  --change-deleted: #c62a1e;
```
(다크 값·나머지 색은 이미 통과 — 변경 금지. `--color-danger`는 별개 토큰이므로 그대로.) 재실행 → 124 tests 전부 통과.

- [ ] **Step 2: ChangesPanel — 배지 제거, 파일명 색상, 오버플로 수정**

`apps/desktop/src/renderer/src/components/ChangesPanel.tsx` 전체 교체:
```tsx
import { CircleMinus, CirclePlus } from 'lucide-react'
import type { ChangeKind, FileChange } from '@git-gui/domain'
import type { SelectedFile } from '../store/repository-store'
import { Badge } from '../ui/Badge'
import { Panel } from '../ui/Panel'
import './changes-panel.css'

interface ChangesPanelProps {
  changes: FileChange[]
  selected: SelectedFile | null
  /** 작업 중에는 모든 버튼을 비활성화한다 — 연타로 git 작업이 겹치면 index.lock 충돌이 난다 */
  busy: boolean
  onStage(paths: string[]): void
  onUnstage(paths: string[]): void
  onSelect(selected: SelectedFile): void
}

/** 변경 종류의 한국어 라벨 — 색 단독으로 의미를 전달하지 않기 위해 tooltip/aria에 병행한다 */
const KIND_LABELS: Record<ChangeKind, string> = {
  modified: '수정됨',
  added: '추가됨',
  deleted: '삭제됨',
  renamed: '이름 변경',
  copied: '복사됨',
  typechange: '형식 변경',
  untracked: '새 파일',
  conflicted: '충돌',
}

interface FileRowProps {
  change: FileChange
  staged: boolean
  isSelected: boolean
  busy: boolean
  onSelect(): void
  onAction(): void
}

/** 색과 함께 쓰는 형태 신호 — 색약(적록)에서 modified/added 색이 수렴해도 글자로 구분된다 */
const KIND_GLYPHS: Record<ChangeKind, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  typechange: 'T',
  untracked: 'U',
  conflicted: '!',
}

function FileRow({ change, staged, isSelected, busy, onSelect, onAction }: FileRowProps) {
  const kind = staged ? change.staged : change.unstaged
  const actionLabel = staged ? '내리기' : '올리기'
  const kindLabel = kind ? KIND_LABELS[kind] : ''
  // 이름 변경은 "무엇이었는지"가 핵심 정보 — 원래 경로를 툴팁에 병기한다
  const tooltip =
    kind === 'renamed' && change.origPath !== null
      ? `${change.origPath} → ${change.path} — ${kindLabel}`
      : `${change.path} — ${kindLabel}`
  // 좁은 열에서 파일명이 먼저 잘리지 않도록 디렉터리와 파일명을 분리해 디렉터리부터 축소한다
  const slashIndex = change.path.lastIndexOf('/')
  const directory = slashIndex >= 0 ? change.path.slice(0, slashIndex + 1) : ''
  const basename = slashIndex >= 0 ? change.path.slice(slashIndex + 1) : change.path
  return (
    <li className={`file-row${isSelected ? ' file-row--selected' : ''}`}>
      <button
        type="button"
        className={`file-row__main file-row__main--${kind ?? 'none'}`}
        disabled={busy}
        onClick={onSelect}
        title={tooltip}
        aria-label={tooltip}
        data-testid={`file-${staged ? 'staged' : 'unstaged'}-${change.path}`}
      >
        <span className="file-row__kind" aria-hidden="true">
          {kind ? KIND_GLYPHS[kind] : ''}
        </span>
        <span className="file-row__name">
          {directory && <span className="file-row__dir">{directory}</span>}
          <span className="file-row__base">{basename}</span>
        </span>
      </button>
      <button
        type="button"
        className="file-row__action"
        disabled={busy}
        onClick={onAction}
        aria-label={`${change.path} ${actionLabel}`}
        data-testid={`${staged ? 'unstage' : 'stage'}-${change.path}`}
      >
        {staged ? (
          <CircleMinus size={14} aria-hidden="true" />
        ) : (
          <CirclePlus size={14} aria-hidden="true" />
        )}
        {actionLabel}
      </button>
    </li>
  )
}

export function ChangesPanel({
  changes,
  selected,
  busy,
  onStage,
  onUnstage,
  onSelect,
}: ChangesPanelProps) {
  const stagedChanges = changes.filter((c) => c.staged !== null)
  const unstagedChanges = changes.filter((c) => c.unstaged !== null)

  return (
    <div className="changes-panel">
      <Panel
        title="지금 바뀐 것"
        accessory={
          <>
            <Badge tone="git">unstaged</Badge>
            <Badge tone="count">
              <span data-testid="unstaged-count">{unstagedChanges.length}</span>
            </Badge>
          </>
        }
      >
        {unstagedChanges.length === 0 ? (
          <p className="changes-panel__empty">바뀐 파일이 없어요</p>
        ) : (
          <ul className="changes-panel__list">
            {unstagedChanges.map((change) => (
              <FileRow
                key={`unstaged-${change.path}`}
                change={change}
                staged={false}
                isSelected={
                  selected !== null && !selected.staged && selected.change.path === change.path
                }
                busy={busy}
                onSelect={() => onSelect({ change, staged: false })}
                onAction={() => onStage([change.path])}
              />
            ))}
          </ul>
        )}
      </Panel>
      <Panel
        title="저장 예정"
        accessory={
          <>
            <Badge tone="git">staged</Badge>
            <Badge tone="count">
              <span data-testid="staged-count">{stagedChanges.length}</span>
            </Badge>
          </>
        }
      >
        {stagedChanges.length === 0 ? (
          <p className="changes-panel__empty">파일을 올리면 여기에 모여요</p>
        ) : (
          <ul className="changes-panel__list">
            {stagedChanges.map((change) => (
              <FileRow
                key={`staged-${change.path}`}
                change={change}
                staged
                isSelected={
                  selected !== null && selected.staged && selected.change.path === change.path
                }
                busy={busy}
                onSelect={() => onSelect({ change, staged: true })}
                onAction={() => onUnstage([change.path])}
              />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
```

`apps/desktop/src/renderer/src/components/changes-panel.css` 전체 교체:
```css
.changes-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-height: 0;
}
.changes-panel > .ui-panel {
  flex: 1;
}
.changes-panel__list {
  list-style: none;
  margin: 0;
  padding: var(--space-1);
}
.changes-panel__empty {
  padding: var(--space-4);
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-faint);
  text-align: center;
}
.file-row {
  display: flex;
  align-items: stretch;
  gap: var(--space-1);
  border-radius: var(--radius-sm);
}
.file-row--selected {
  background: var(--color-selection-bg);
}
.file-row__main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 10px;
  border: none;
  background: none;
  cursor: pointer;
  text-align: left;
  border-radius: var(--radius-sm);
  color: var(--color-text);
}
.file-row__main:hover:not(:disabled) {
  background: var(--color-surface-sunken);
}
.file-row--selected .file-row__main:hover:not(:disabled) {
  background: transparent;
}
/* 변경 종류 = 파일명 색 + 선행 글리프(M/A/D/R/C/T/U/!) — 색약에서도 형태로 구분된다 (스펙 10장) */
.file-row__kind {
  flex: none;
  width: 12px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  text-align: center;
  color: currentColor;
}
.file-row__main--modified,
.file-row__main--typechange {
  color: var(--change-modified);
}
.file-row__main--added {
  color: var(--change-added);
}
.file-row__main--untracked {
  color: var(--change-untracked);
}
.file-row__main--deleted {
  color: var(--change-deleted);
}
.file-row__main--deleted .file-row__base {
  text-decoration: line-through;
}
.file-row__main--renamed,
.file-row__main--copied {
  color: var(--change-renamed);
}
.file-row__main--conflicted {
  color: var(--concept-conflict);
  font-weight: 700;
}
.file-row__name {
  display: flex;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}
/* 축소 우선순위: 디렉터리(1000)가 먼저 줄고, 그다음 파일명(1) — 액션 버튼은 절대 밀리지 않는다 */
.file-row__dir {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 0 1000 auto;
  color: var(--color-text-muted);
}
.file-row__base {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 0 1 auto;
  min-width: 48px;
}
.file-row__action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: none;
  cursor: pointer;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  font-weight: 600;
  padding: 0 10px;
  border-radius: var(--radius-sm);
  flex: none;
}
.file-row__action:hover:not(:disabled) {
  color: var(--color-accent);
  background: var(--color-surface-sunken);
}
.file-row__main:disabled,
.file-row__action:disabled {
  opacity: var(--opacity-disabled);
  cursor: default;
}
```

- [ ] **Step 3: 검증**

Step 2.5: 죽은 코드 제거 — `ui/Pictogram.tsx`에서 `CHANGE_LABELS`·`ChangeKindBadge`와 `ChangeKind` import 제거(개념 Pictogram만 남긴다), `ui/pictogram.css`에서 `.ui-change-badge` 관련 규칙 전부 제거.

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build && (cd apps/desktop && pnpm e2e)`
Expected: 124 tests + typecheck 5 + build + E2E 2 passed — 전부 exit 0 (E2E 셀렉터는 data-testid 기반이라 배지 제거와 무관)

추가 육안: 매우 긴 파일명(`veryveryverylongfilename-that-overflows-everything.tsx`)과 깊은 경로 fixture로 dev를 띄워 액션 버튼이 밀리지 않는지 스크린샷 확인 (일회성 스크립트, 커밋 미포함).

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/test/tokens-contrast.test.ts apps/desktop/src/renderer/src/components apps/desktop/src/renderer/src/ui
git commit -m "feat(desktop): 파일 행 IntelliJ식 색상 표기와 오버플로 수정

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: diff 선택 해제와 타임라인 커넥터 (#8·#5)

**Files:**
- Modify: `apps/desktop/src/renderer/src/store/repository-store.ts` (clearSelection 추가)
- Modify: `apps/desktop/src/renderer/src/components/DiffPanel.tsx` (닫기 버튼 — 이 시점엔 기존 diffText 기반 그대로, onClose만 추가)
- Modify: `apps/desktop/src/renderer/src/App.tsx` (onClose 연결)
- Modify: `apps/desktop/src/renderer/src/components/HistoryPanel.tsx`, `components/history-panel.css` (커넥터 방식 전환)

- [ ] **Step 1: 스토어 clearSelection**

`repository-store.ts`의 RepositoryStore 인터페이스에서 `selectFile` 다음에 추가:
```ts
  /** diff 선택 해제 — 동기 상태 변경이라 guard 불필요 */
  clearSelection(): void
```
구현부에서 `selectFile` 다음에 추가:
```ts
  clearSelection() {
    set({ selected: null, diffText: '' })
  },
```

- [ ] **Step 2: DiffPanel 닫기 버튼**

`apps/desktop/src/renderer/src/components/DiffPanel.tsx` 전체 교체:
```tsx
import { X } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import { classifyLines } from './diff-lines'
import './diff-panel.css'

interface DiffPanelProps {
  path: string | null
  diffText: string
  onClose(): void
}

export function DiffPanel({ path, diffText, onClose }: DiffPanelProps) {
  if (!path) {
    return (
      <Panel title="변경 내용" testId="diff-panel">
        <p className="diff-panel__empty">파일을 선택하면 무엇이 바뀌었는지 보여드려요</p>
      </Panel>
    )
  }
  const lines = diffText.length > 0 ? diffText.split('\n') : []
  const tones = classifyLines(lines)
  return (
    <Panel
      title={path}
      accessory={
        <>
          <Badge tone="git">diff</Badge>
          <Button variant="ghost" size="sm" onPress={onClose} testId="diff-close" aria-label="선택 해제">
            <X size={13} aria-hidden="true" /> 닫기
          </Button>
        </>
      }
      testId="diff-panel"
    >
      {lines.length === 0 ? (
        <p className="diff-panel__empty">변경 내용이 없어요</p>
      ) : (
        <pre className="diff-panel__code">
          {lines.map((line, index) => (
            <span key={index} className={`diff-line diff-line--${tones[index]}`}>
              {line || ' '}
            </span>
          ))}
        </pre>
      )}
    </Panel>
  )
}
```

`App.tsx`의 DiffPanel 사용부를 다음으로 교체:
```tsx
          <DiffPanel
            path={store.selected?.change.path ?? null}
            diffText={store.diffText}
            onClose={() => store.clearSelection()}
          />
```

닫기 버튼이 제목 오른쪽 끝에 붙도록 `apps/desktop/src/renderer/src/ui/panel.css`의 `.ui-panel__head`에 한 줄 추가:
```css
.ui-panel__head > .ui-button {
  margin-left: auto;
}
```

- [ ] **Step 3: 타임라인 커넥터 전환 (#5 — 시작·끝이 점에서 멈추게)**

`HistoryPanel.tsx`에서 `<ol className="history-panel__list" ...>` 를 다음으로 교체 (잘렸을 때만 아래로 이어지는 표시):
```tsx
        <ol
          className={`history-panel__list${history.length >= limit ? ' history-panel__list--truncated' : ''}`}
          data-testid="history-list"
        >
```

`history-panel.css`에서 `.history-panel__list::before` 블록을 삭제하고 다음으로 교체:
```css
/* 커넥터는 항목 단위로 그린다 — 첫 점 위·마지막 점 아래에 선이 남지 않는다 (#5) */
.history-item:not(:last-child)::after {
  content: '';
  position: absolute;
  left: 16px;
  top: 21px; /* 점 아래에서 시작 */
  bottom: -12px; /* 다음 항목의 점 위까지 */
  width: 2px;
  background: var(--color-border);
}
/* 목록이 상한에 잘렸을 때만: 마지막 점 아래로 흐려지며 이어지는 표시 */
.history-panel__list--truncated .history-item:last-child::after {
  content: '';
  position: absolute;
  left: 16px;
  top: 21px;
  height: 16px;
  width: 2px;
  background: linear-gradient(var(--color-border), transparent);
}
```

- [ ] **Step 4: 검증**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build && (cd apps/desktop && pnpm e2e)`
Expected: 112 tests + typecheck 5 + build + E2E 2 passed — 전부 exit 0

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src
git commit -m "feat(desktop): diff 선택 해제 버튼과 타임라인 커넥터 정리

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: diff 도메인 모델 — 파서·adapter·IPC·unified 렌더 (#1 기반)

**Files:**
- Create: `packages/domain/src/diff.ts`, Modify: `packages/domain/src/index.ts`
- Create: `packages/git-adapter/src/diff-parser.ts`, Test: `packages/git-adapter/test/diff-parser.test.ts`
- Modify: `packages/git-adapter/src/client.ts`, `src/index.ts`, `test/client.test.ts`(diff 단언 갱신)
- Modify: `packages/ipc-contract/src/index.ts`
- Modify: `apps/desktop/src/renderer/src/store/repository-store.ts`, `components/DiffPanel.tsx`, `components/diff-panel.css`, `App.tsx`
- Delete: `apps/desktop/src/renderer/src/components/diff-lines.ts`, `apps/desktop/test/diff-lines.test.ts` (`git rm`)

- [ ] **Step 1: domain 타입**

`packages/domain/src/diff.ts`:
```ts
export type DiffLineKind = 'context' | 'add' | 'del' | 'note'

export interface DiffLine {
  kind: DiffLineKind
  /** 변경 전 파일의 줄 번호. add·note면 null */
  oldLine: number | null
  /** 변경 후 파일의 줄 번호. del·note면 null */
  newLine: number | null
  /** 접두 기호(+/-/공백)를 제거한 내용 */
  text: string
}

export interface DiffHunk {
  /** @@ -a,b +c,d @@ 원문 헤더 */
  header: string
  lines: DiffLine[]
}

export interface FileDiff {
  /** diff/index/mode 등 파일 메타 라인 원문 */
  meta: string[]
  hunks: DiffHunk[]
  /** 텍스트 diff가 없는 바이너리 변경 */
  isBinary: boolean
}
```

`packages/domain/src/index.ts` 전체 교체:
```ts
export * from './repository'
export * from './state'
export * from './commit-message'
export * from './diff'
```

- [ ] **Step 2: 실패하는 파서 테스트**

`packages/git-adapter/test/diff-parser.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { parsePatch } from '../src/diff-parser'

const SAMPLE = [
  'diff --git a/f.ts b/f.ts',
  'index abc..def 100644',
  '--- a/f.ts',
  '+++ b/f.ts',
  '@@ -1,3 +1,3 @@',
  ' context1',
  '-old line',
  '+new line',
  ' context2',
].join('\n')

describe('parsePatch', () => {
  it('빈 입력이면 빈 diff', () => {
    expect(parsePatch('')).toEqual({ meta: [], hunks: [], isBinary: false })
  })

  it('메타·hunk·줄 번호를 구조화한다', () => {
    const diff = parsePatch(SAMPLE)
    expect(diff.meta).toEqual([
      'diff --git a/f.ts b/f.ts',
      'index abc..def 100644',
      '--- a/f.ts',
      '+++ b/f.ts',
    ])
    expect(diff.hunks).toHaveLength(1)
    expect(diff.hunks[0]?.header).toBe('@@ -1,3 +1,3 @@')
    expect(diff.hunks[0]?.lines).toEqual([
      { kind: 'context', oldLine: 1, newLine: 1, text: 'context1' },
      { kind: 'del', oldLine: 2, newLine: null, text: 'old line' },
      { kind: 'add', oldLine: null, newLine: 2, text: 'new line' },
      { kind: 'context', oldLine: 3, newLine: 3, text: 'context2' },
    ])
  })

  it('여러 hunk의 줄 번호가 각 헤더에서 다시 시작한다', () => {
    const raw = [
      'diff --git a/f.ts b/f.ts',
      '@@ -1,1 +1,1 @@',
      '-a',
      '+b',
      '@@ -10,2 +10,1 @@',
      ' keep',
      '-drop',
    ].join('\n')
    const diff = parsePatch(raw)
    expect(diff.hunks[1]?.lines).toEqual([
      { kind: 'context', oldLine: 10, newLine: 10, text: 'keep' },
      { kind: 'del', oldLine: 11, newLine: null, text: 'drop' },
    ])
  })

  it("hunk 안의 '--'/'++' 시작 라인은 내용으로 분류한다 (위치 기반)", () => {
    const raw = ['@@ -1,1 +1,1 @@', '--- SQL comment', '+++counter'].join('\n')
    const diff = parsePatch(raw)
    expect(diff.hunks[0]?.lines.map((l) => l.kind)).toEqual(['del', 'add'])
    expect(diff.hunks[0]?.lines[0]?.text).toBe('-- SQL comment')
  })

  it('개행 없음 마커는 note로 분류한다', () => {
    const raw = ['@@ -1,1 +1,1 @@', '-old', '+new', '\\ No newline at end of file'].join('\n')
    const diff = parsePatch(raw)
    expect(diff.hunks[0]?.lines[2]).toEqual({
      kind: 'note',
      oldLine: null,
      newLine: null,
      text: '\\ No newline at end of file',
    })
  })

  it('바이너리 diff는 isBinary로 표시한다', () => {
    const raw = ['diff --git a/img.png b/img.png', 'Binary files a/img.png and b/img.png differ'].join(
      '\n',
    )
    const diff = parsePatch(raw)
    expect(diff.isBinary).toBe(true)
    expect(diff.hunks).toEqual([])
  })

  it('마지막 빈 줄(trailing newline)은 라인으로 세지 않는다', () => {
    const diff = parsePatch(SAMPLE + '\n')
    expect(diff.hunks[0]?.lines).toHaveLength(4)
  })
})
```

Run: `pnpm test`
Expected: FAIL — `Cannot find module '../src/diff-parser'` (기존 통과)

- [ ] **Step 3: 파서 구현**

`packages/git-adapter/src/diff-parser.ts`:
```ts
import type { DiffHunk, DiffLine, FileDiff } from '@git-gui/domain'

/**
 * 단일 파일 patch(`git diff -- <path>` 출력)를 FileDiff로 구조화한다.
 * 줄 번호는 @@ -a,b +c,d @@ 헤더에서 시작해 누적한다.
 * 위치 기반 분류 — 헤더 구간(첫 @@ 이전)은 meta, hunk 안 '-'/'+'는 내용이다.
 */
export function parsePatch(rawPatch: string): FileDiff {
  const lines = rawPatch.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

  const meta: string[] = []
  const hunks: DiffHunk[] = []
  let isBinary = false
  let current: DiffHunk | null = null
  let oldLine = 0
  let newLine = 0

  for (const line of lines) {
    const hunkMatch = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (hunkMatch) {
      oldLine = Number(hunkMatch[1])
      newLine = Number(hunkMatch[2])
      current = { header: line, lines: [] }
      hunks.push(current)
      continue
    }
    if (current === null) {
      if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
        isBinary = true
      }
      meta.push(line)
      continue
    }
    if (line.startsWith('\\')) {
      current.lines.push({ kind: 'note', oldLine: null, newLine: null, text: line })
      continue
    }
    if (line.startsWith('+')) {
      current.lines.push({ kind: 'add', oldLine: null, newLine, text: line.slice(1) })
      newLine += 1
      continue
    }
    if (line.startsWith('-')) {
      current.lines.push({ kind: 'del', oldLine, newLine: null, text: line.slice(1) })
      oldLine += 1
      continue
    }
    const entry: DiffLine = { kind: 'context', oldLine, newLine, text: line.slice(1) }
    current.lines.push(entry)
    oldLine += 1
    newLine += 1
  }

  return { meta, hunks, isBinary }
}
```

`packages/git-adapter/src/index.ts` 전체 교체:
```ts
export * from './status-parser'
export * from './client'
export * from './markers'
export * from './log-parser'
export * from './diff-parser'
```

Run: `pnpm test`
Expected: 파서 7개 통과 (전체 119)

- [ ] **Step 4: adapter diff가 FileDiff 반환**

`packages/git-adapter/src/client.ts`:

(a) import에 FileDiff·parsePatch 추가:
```ts
import {
  detectState,
  type CommitSummary,
  type DiffOptions,
  type FileDiff,
  type RepositoryStatus,
} from '@git-gui/domain'
```
그리고 log-parser import 다음 줄에:
```ts
import { parsePatch } from './diff-parser'
```

(b) GitClient 인터페이스의 diff 시그니처 교체:
```ts
    diff(path: string, options: DiffOptions): Promise<FileDiff>
```

(c) 구현의 diff 반환 두 곳을 parsePatch로 감싼다:
- untracked 분기의 `return result.stdout` → `return parsePatch(result.stdout)`
- 마지막 `return (await execGitOrThrow(args, { cwd })).stdout` → `return parsePatch((await execGitOrThrow(args, { cwd })).stdout)`

(d) `packages/git-adapter/test/client.test.ts`의 diff 테스트('diff — unstaged, staged, untracked 각각 patch 텍스트를 반환한다')를 다음으로 교체:
```ts
  it('diff — unstaged, staged, untracked 각각 구조화된 diff를 반환한다', async () => {
    const repo = await createFixtureRepo()
    const client = createGitClient(repo)
    await writeFixtureFile(repo, 'README.md', '# changed\n')
    await writeFixtureFile(repo, 'new.txt', 'hello\n')

    const unstaged = await client.changes.diff('README.md', { staged: false, untracked: false })
    const unstagedLines = unstaged.hunks.flatMap((hunk) => hunk.lines)
    expect(unstagedLines).toContainEqual({ kind: 'del', oldLine: 1, newLine: null, text: '# fixture' })
    expect(unstagedLines).toContainEqual({ kind: 'add', oldLine: null, newLine: 1, text: '# changed' })

    await client.changes.stage(['README.md'])
    const staged = await client.changes.diff('README.md', { staged: true, untracked: false })
    expect(staged.hunks.flatMap((h) => h.lines).some((l) => l.kind === 'add' && l.text === '# changed')).toBe(true)

    const untracked = await client.changes.diff('new.txt', { staged: false, untracked: true })
    expect(untracked.hunks.flatMap((h) => h.lines).some((l) => l.kind === 'add' && l.text === 'hello')).toBe(true)
  })
```

- [ ] **Step 5: IPC 계약**

`packages/ipc-contract/src/index.ts`:
- import에 FileDiff 추가: `import type { CommitSummary, DiffOptions, FileDiff, RepositoryStatus } from '@git-gui/domain'`
- changes.diff 시그니처 교체: `diff(repoPath: string, path: string, options: DiffOptions): Promise<FileDiff>`
(main 핸들러·preload는 위임만 하므로 변경 불필요 — typecheck로 확인)

- [ ] **Step 6: renderer — 스토어·DiffPanel 모델 렌더**

`repository-store.ts`:
- import에 FileDiff 추가: `import type { CommitSummary, FileChange, FileDiff, RepositoryStatus } from '@git-gui/domain'`
- 상태 교체: `diffText: string` → `diff: FileDiff | null` (인터페이스·초기값 `diff: null`·모든 `diffText: ''` 대입을 `diff: null`로)
- selectFile 구현 교체:
```ts
  async selectFile(selected) {
    const { repoPath } = get()
    if (!repoPath) return
    await guard(set, get, async () => {
      const untracked = selected.change.unstaged === 'untracked'
      const diff = await git().changes.diff(repoPath, selected.change.path, {
        staged: selected.staged,
        untracked,
      })
      set({ selected, diff })
    })
  },
```
- clearSelection: `set({ selected: null, diff: null })`

`apps/desktop/src/renderer/src/components/DiffPanel.tsx` 전체 교체 (diff-lines 제거, 모델 렌더 — split 토글은 Task 4에서 추가):
```tsx
import { X } from 'lucide-react'
import type { FileDiff } from '@git-gui/domain'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import './diff-panel.css'

interface DiffPanelProps {
  path: string | null
  diff: FileDiff | null
  onClose(): void
}

export function DiffPanel({ path, diff, onClose }: DiffPanelProps) {
  if (!path || diff === null) {
    return (
      <Panel title="변경 내용" testId="diff-panel">
        <p className="diff-panel__empty">파일을 선택하면 무엇이 바뀌었는지 보여드려요</p>
      </Panel>
    )
  }
  const isEmpty = diff.hunks.length === 0 && !diff.isBinary
  return (
    <Panel
      title={path}
      accessory={
        <>
          <Badge tone="git">diff</Badge>
          <Button variant="ghost" size="sm" onPress={onClose} testId="diff-close" aria-label="선택 해제">
            <X size={13} aria-hidden="true" /> 닫기
          </Button>
        </>
      }
      testId="diff-panel"
    >
      {diff.isBinary ? (
        <p className="diff-panel__empty">텍스트가 아닌 파일이라 내용 비교를 보여드릴 수 없어요</p>
      ) : isEmpty ? (
        <p className="diff-panel__empty">변경 내용이 없어요</p>
      ) : (
        <div className="diff-panel__code">
          {diff.hunks.map((hunk, hunkIndex) => (
            <div key={hunkIndex} className="diff-hunk">
              <div className="diff-line diff-line--hunk">{hunk.header}</div>
              {hunk.lines.map((line, lineIndex) => (
                <div key={lineIndex} className={`diff-line diff-line--${line.kind}`}>
                  <span className="diff-line__no" aria-hidden="true">
                    {line.oldLine ?? ''}
                  </span>
                  <span className="diff-line__no" aria-hidden="true">
                    {line.newLine ?? ''}
                  </span>
                  <span className="diff-line__text">{line.text || ' '}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}
```

`apps/desktop/src/renderer/src/components/diff-panel.css` 전체 교체:
```css
.diff-panel__empty {
  padding: var(--space-6);
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-faint);
  text-align: center;
}
.diff-panel__code {
  padding: var(--space-3) 0;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 1.7;
}
.diff-line {
  display: flex;
  align-items: baseline;
}
.diff-line__no {
  flex: none;
  width: 42px;
  padding-right: 8px;
  text-align: right;
  color: var(--color-text-faint);
  user-select: none;
}
.diff-line__text {
  flex: 1;
  min-width: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  padding-right: var(--space-4);
}
.diff-line--add {
  background: var(--diff-add-bg);
  color: var(--diff-add-text);
}
.diff-line--del {
  background: var(--diff-del-bg);
  color: var(--diff-del-text);
}
.diff-line--hunk {
  background: var(--diff-hunk-bg);
  color: var(--diff-hunk-text);
  padding: 0 var(--space-4);
}
.diff-line--note {
  color: var(--color-text-faint);
}
```

`App.tsx`의 DiffPanel 사용부:
```tsx
          <DiffPanel
            path={store.selected?.change.path ?? null}
            diff={store.diff}
            onClose={() => store.clearSelection()}
          />
```

diff-lines 삭제:
```bash
git rm apps/desktop/src/renderer/src/components/diff-lines.ts apps/desktop/test/diff-lines.test.ts
```

- [ ] **Step 7: 검증**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build && (cd apps/desktop && pnpm e2e)`
Expected: **126 tests** (124 + 파서 7 − diff-lines 5), typecheck 5, build, E2E 2 passed — 전부 exit 0

- [ ] **Step 8: Commit**

```bash
git add packages/domain packages/git-adapter packages/ipc-contract apps/desktop
git commit -m "feat: diff 도메인 모델 전환 — 파서·구조화 IPC·줄 번호 렌더

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 좌우(side-by-side) 보기 토글 (#1 완성)

**Files:**
- Create: `apps/desktop/src/renderer/src/components/diff-split.ts`, Test: `apps/desktop/test/diff-split.test.ts`
- Modify: `components/DiffPanel.tsx`, `components/diff-panel.css`
- Modify: `apps/desktop/e2e/smoke.spec.ts` (split 토글 검증 추가)

- [ ] **Step 1: 실패하는 짝짓기 테스트**

`apps/desktop/test/diff-split.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import type { DiffLine } from '@git-gui/domain'
import { pairHunkLines } from '../src/renderer/src/components/diff-split'

function line(kind: DiffLine['kind'], text: string): DiffLine {
  return { kind, oldLine: kind === 'add' || kind === 'note' ? null : 1, newLine: kind === 'del' || kind === 'note' ? null : 1, text }
}

describe('pairHunkLines', () => {
  it('context는 양쪽에 놓인다', () => {
    const rows = pairHunkLines([line('context', 'same')])
    expect(rows).toEqual([{ left: line('context', 'same'), right: line('context', 'same') }])
  })

  it('del 다음 add 런은 순서대로 짝지어진다', () => {
    const rows = pairHunkLines([
      line('del', 'a'),
      line('del', 'b'),
      line('add', 'A'),
      line('add', 'B'),
    ])
    expect(rows).toEqual([
      { left: line('del', 'a'), right: line('add', 'A') },
      { left: line('del', 'b'), right: line('add', 'B') },
    ])
  })

  it('짝이 남으면 한쪽이 비어 있다', () => {
    const rows = pairHunkLines([line('del', 'a'), line('add', 'A'), line('add', 'B')])
    expect(rows).toEqual([
      { left: line('del', 'a'), right: line('add', 'A') },
      { left: null, right: line('add', 'B') },
    ])
  })

  it('add만 있으면 왼쪽이 비고, del만 있으면 오른쪽이 빈다', () => {
    expect(pairHunkLines([line('add', 'A')])).toEqual([{ left: null, right: line('add', 'A') }])
    expect(pairHunkLines([line('del', 'a')])).toEqual([{ left: line('del', 'a'), right: null }])
  })

  it('note는 양쪽에 걸치는 단독 행이다', () => {
    const rows = pairHunkLines([line('note', '\\ No newline at end of file')])
    expect(rows).toEqual([
      { left: line('note', '\\ No newline at end of file'), right: line('note', '\\ No newline at end of file') },
    ])
  })
})
```

Run: `pnpm test`
Expected: FAIL — 모듈 없음

- [ ] **Step 2: 짝짓기 구현**

`apps/desktop/src/renderer/src/components/diff-split.ts`:
```ts
import type { DiffLine } from '@git-gui/domain'

export interface SplitRow {
  left: DiffLine | null
  right: DiffLine | null
}

/**
 * hunk 라인을 좌(변경 전)/우(변경 후) 행으로 짝짓는다.
 * 연속된 del 런과 그 뒤의 add 런을 순서대로 zip — 남는 쪽은 반대편을 비운다.
 */
export function pairHunkLines(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = []
  let index = 0
  while (index < lines.length) {
    const current = lines[index]!
    if (current.kind === 'context' || current.kind === 'note') {
      rows.push({ left: current, right: current })
      index += 1
      continue
    }
    const dels: DiffLine[] = []
    while (index < lines.length && lines[index]!.kind === 'del') {
      dels.push(lines[index]!)
      index += 1
    }
    const adds: DiffLine[] = []
    while (index < lines.length && lines[index]!.kind === 'add') {
      adds.push(lines[index]!)
      index += 1
    }
    const rowCount = Math.max(dels.length, adds.length)
    for (let i = 0; i < rowCount; i += 1) {
      rows.push({ left: dels[i] ?? null, right: adds[i] ?? null })
    }
  }
  return rows
}
```

- [ ] **Step 3: DiffPanel에 토글 추가**

`apps/desktop/src/renderer/src/components/DiffPanel.tsx` 전체 교체:
```tsx
import { Columns2, Rows3, X } from 'lucide-react'
import { useState } from 'react'
import type { DiffLine, FileDiff } from '@git-gui/domain'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import { pairHunkLines } from './diff-split'
import './diff-panel.css'

interface DiffPanelProps {
  path: string | null
  diff: FileDiff | null
  onClose(): void
}

function UnifiedLine({ line }: { line: DiffLine }) {
  return (
    <div className={`diff-line diff-line--${line.kind}`}>
      <span className="diff-line__no" aria-hidden="true">
        {line.oldLine ?? ''}
      </span>
      <span className="diff-line__no" aria-hidden="true">
        {line.newLine ?? ''}
      </span>
      <span className="diff-line__text">{line.text || ' '}</span>
    </div>
  )
}

function SplitCell({ line, side }: { line: DiffLine | null; side: 'left' | 'right' }) {
  if (line === null) {
    return <div className="diff-cell diff-cell--empty" aria-hidden="true" />
  }
  const lineNo = side === 'left' ? line.oldLine : line.newLine
  return (
    <div className={`diff-cell diff-line--${line.kind === 'context' || line.kind === 'note' ? line.kind : side === 'left' ? 'del' : 'add'}`}>
      <span className="diff-line__no" aria-hidden="true">
        {lineNo ?? ''}
      </span>
      <span className="diff-line__text">{line.text || ' '}</span>
    </div>
  )
}

export function DiffPanel({ path, diff, onClose }: DiffPanelProps) {
  const [view, setView] = useState<'unified' | 'split'>('unified')

  if (!path || diff === null) {
    return (
      <Panel title="변경 내용" testId="diff-panel">
        <p className="diff-panel__empty">파일을 선택하면 무엇이 바뀌었는지 보여드려요</p>
      </Panel>
    )
  }
  const isEmpty = diff.hunks.length === 0 && !diff.isBinary
  return (
    <Panel
      title={path}
      accessory={
        <>
          <Badge tone="git">diff</Badge>
          <Button
            variant="ghost"
            size="sm"
            onPress={() => setView(view === 'unified' ? 'split' : 'unified')}
            testId="diff-view-toggle"
            aria-label={view === 'unified' ? '좌우로 비교 보기' : '한 줄로 보기'}
          >
            {view === 'unified' ? (
              <Columns2 size={13} aria-hidden="true" />
            ) : (
              <Rows3 size={13} aria-hidden="true" />
            )}
            {view === 'unified' ? '좌우 보기' : '한 줄 보기'}
          </Button>
          <Button variant="ghost" size="sm" onPress={onClose} testId="diff-close" aria-label="선택 해제">
            <X size={13} aria-hidden="true" /> 닫기
          </Button>
        </>
      }
      testId="diff-panel"
    >
      {diff.isBinary ? (
        <p className="diff-panel__empty">텍스트가 아닌 파일이라 내용 비교를 보여드릴 수 없어요</p>
      ) : isEmpty ? (
        <p className="diff-panel__empty">변경 내용이 없어요</p>
      ) : (
        <div className="diff-panel__code" data-testid={`diff-view-${view}`}>
          {diff.hunks.map((hunk, hunkIndex) => (
            <div key={hunkIndex} className="diff-hunk">
              <div className="diff-line diff-line--hunk">{hunk.header}</div>
              {view === 'unified'
                ? hunk.lines.map((line, lineIndex) => <UnifiedLine key={lineIndex} line={line} />)
                : pairHunkLines(hunk.lines).map((row, rowIndex) => (
                    <div key={rowIndex} className="diff-split-row">
                      <SplitCell line={row.left} side="left" />
                      <SplitCell line={row.right} side="right" />
                    </div>
                  ))}
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}
```

`diff-panel.css` 끝에 추가:
```css
.diff-split-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
}
.diff-cell {
  display: flex;
  align-items: baseline;
  min-width: 0;
  border-left: 1px solid var(--color-border);
}
.diff-split-row .diff-cell:first-child {
  border-left: none;
}
.diff-cell--empty {
  background: var(--color-surface-sunken);
}
```

- [ ] **Step 4: E2E에 split 검증 추가**

`apps/desktop/e2e/smoke.spec.ts`의 첫 테스트에서 stage 이후·commit 이전에 추가:
```ts
    // diff 확인 — 좌우 보기 토글과 선택 해제
    await window.getByTestId('file-staged-app.txt').click()
    await expect(window.getByTestId('diff-view-unified')).toBeVisible()
    await window.getByTestId('diff-view-toggle').click()
    await expect(window.getByTestId('diff-view-split')).toBeVisible()
    await window.getByTestId('diff-close').click()
    await expect(window.getByTestId('diff-panel')).toContainText('파일을 선택하면')
```

- [ ] **Step 5: 검증**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build && (cd apps/desktop && pnpm e2e)`
Expected: **131 tests** (126 + split 5), typecheck 5, build, E2E 2 passed — 전부 exit 0

- [ ] **Step 6: Commit**

```bash
git add apps/desktop
git commit -m "feat(desktop): 좌우(side-by-side) diff 보기 토글

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 최종 게이트 + 스크린샷 + README

- [ ] **Step 1: 전체 게이트**

Run: `pnpm test && pnpm typecheck && pnpm --filter @git-gui/desktop build && (cd apps/desktop && pnpm e2e)`
Expected: 131 tests + typecheck 5 + build + E2E 2 passed — 전부 exit 0

- [ ] **Step 2: 스크린샷**

일회성 스크립트(커밋 미포함)로: (a) 색상 파일 행(수정·추가·삭제 혼합 + 긴 파일명), (b) 좌우 diff 보기, (c) 다크 모드 한 장 — `test-results/`에 캡처. 코디네이터가 사용자에게 전달.

- [ ] **Step 3: README "현재 상태" 한 줄 갱신**

"diff 보기"를 "diff 보기(한 줄/좌우 전환, 줄 번호)"로 교체.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README — E0-3a 표시 개선 반영

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
