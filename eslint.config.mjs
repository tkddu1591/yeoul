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
    rules: reactHooks.configs.recommended.rules,
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
  {
    // ── E14b 부채 목록 (임시) ──────────────────────────────────────────────
    // 게이트를 먼저 세우고 위반을 태스크별로 걷어내기 위한 ratchet이다.
    // 태스크가 한 파일을 고칠 때마다 여기서 그 항목을 지운다. Task 8이 이 블록 전체가
    // 사라졌음을 확인한다 — 남아 있으면 그 태스크가 안 끝난 것이다.
    // Task 3이 purity 5건(BranchSwitcher·BranchesPanel·ReviewDetailPanel·ShelfPopover·
    // WorktreesPanel)을 걷어냈다 — 이제 그 파일들에서 purity는 경고가 아니라 에러다.
    files: [
      'apps/desktop/src/renderer/src/App.tsx',
      'apps/desktop/src/renderer/src/components/AddWorktreeDialog.tsx',
      'apps/desktop/src/renderer/src/ui/PromptDialog.tsx',
      'apps/desktop/src/renderer/src/ui/Tooltip.tsx',
    ],
    rules: {
      'react-hooks/purity': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
    },
  },
  {
    // ── E14b 부채 목록 (임시) — 죽은 억제 3건 · Task 7 몫 ────────────────────
    // 위 규칙 부채와 별개의 항목이라 블록을 나눈다. reportUnusedDisableDirectives는 규칙이
    // 아니라 linterOptions라서 위 블록의 rules로는 못 낮추고, 무엇보다 **걷어내는 태스크가
    // 다르다** — App.tsx의 규칙 부채는 Task 5가, 죽은 억제 3건(:221·:355·:471)은 Task 7이
    // 치운다. 한 블록에 묶으면 Task 5가 App.tsx를 빼는 순간 아직 남아 있는 억제 3건이
    // 에러로 튀어 브랜치가 빨개진다.
    // Task 7이 억제를 지우고 이 블록도 함께 지운다 → 그때부터 다시 error(스펙 §3).
    files: ['apps/desktop/src/renderer/src/App.tsx'],
    linterOptions: { reportUnusedDisableDirectives: 'warn' },
  },
]
