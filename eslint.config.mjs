// E14b — 이 저장소의 첫 lint 게이트. React 규칙만, 렌더러만 본다.
// packages/*·src/main은 React 코드가 아니라 이 규칙이 할 일이 없고, typescript-eslint 권장
// 규칙셋을 모노레포 전체에 켜면 수백 건이 쏟아지는데 이 에픽의 목적이 아니다 (YAGNI, 스펙 §3)
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default [
  { ignores: ['**/node_modules/**', '**/out/**', '**/dist/**', '**/test-results/**'] },
  {
    files: ['apps/desktop/src/renderer/src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // E14c로 억제 12곳이 전부 해소돼 위반 0 — 지금 error로 올리는 것은 무비용이고,
      // warn인 채로 두면 --max-warnings 5의 TanStack 몸이 줄 때 새 위반이 그 여유에 숨는다
      // (E14c 리뷰 I-1). 래칫은 incompatible-library 수량 감시로만 남는다
      'react-hooks/exhaustive-deps': 'error',
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  {
    // 영구 완화 — @tanstack/react-virtual v3는 컴파일러와 호환되지 않고 업스트림 수정이 없다
    // (v3.14.9가 마지막, v4 없음). 우리 코드로 못 고치므로 경고로 둔다 (스펙 §4-5).
    // 주의: 이 다섯 파일은 규칙이 통째로 건너뛰어져 **다른 위반도 보고되지 않는다** —
    // 게이트가 초록이어도 이 안은 검사되지 않았다는 뜻이다. 가정이 아니라 실측이다:
    // 렌더 중 Date.now()가 7곳인데 린트는 5곳만 잡는다. 나머지 둘(HistoryPanel:520 ·
    // CommitDetailPanel:260)이 바로 이 목록 안에 있어 침묵한다 — grep 전수로 찾았다.
    // 이 게이트는 완전한 검사가 아니다.
    files: [
      'apps/desktop/src/renderer/src/components/ChangesPanel.tsx',
      'apps/desktop/src/renderer/src/components/CommitDetailPanel.tsx',
      'apps/desktop/src/renderer/src/components/ConflictPanel.tsx',
      'apps/desktop/src/renderer/src/components/DiffView.tsx',
      'apps/desktop/src/renderer/src/components/HistoryPanel.tsx',
    ],
    rules: { 'react-hooks/incompatible-library': 'warn' },
  },
  // ── E14b 규칙 부채 목록: 비었으므로 블록째 삭제했다 (Task 6) ──────────────────
  // Task 3이 purity 5건(BranchSwitcher·BranchesPanel·ReviewDetailPanel·ShelfPopover·
  // WorktreesPanel), Task 4가 set-state-in-effect 2건(PromptDialog·AddWorktreeDialog),
  // Task 5가 App.tsx의 나머지 2건, Task 6이 Tooltip의 immutability를 걷어냈다.
  // 마지막 항목을 빼면 `files: []`가 되는데 **eslint 10은 빈 files를 거부한다**
  // (`Key "files": Expected value to be a non-empty array` — 설정 로드 자체가 실패해
  // lint가 통째로 죽는다). 그래서 목록을 비우는 태스크가 곧 블록을 지우는 태스크다 —
  // "Task 8이 빈 목록을 확인하고 지운다"는 도달할 수 없는 상태였다.
  // 이제 렌더러 전역에서 purity·set-state-in-effect·refs·immutability는 전부 error다.
  // ── E14b 죽은 억제 부채 목록: 비었으므로 블록째 삭제했다 (Task 7) ─────────────
  // 예고된 3건 중 :471은 Task 5가 그 이펙트를 지우며 함께 사라졌고, 남은 :221·:355는 Task 7이
  // 지웠다(App.tsx에서 바깥 값을 안 읽는 마운트 1회 이펙트 둘 — 억제할 것이 애초에 없었다).
  // 여기도 `files: []`를 남기면 eslint 10이 설정 로드를 거부하므로 블록째 지운다(위 주석과 같은 함정).
  // 이제 렌더러 전역에서 reportUnusedDisableDirectives는 다시 error다(스펙 §3) — 남은
  // exhaustive-deps 억제 12곳은 전부 살아 있고 각각 이유가 주석으로 붙어 있다(E14c 인수인계).
]
