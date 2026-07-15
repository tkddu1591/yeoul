# 기술 스택 설계

작성일: 2026-07-15
상태: 사용자 승인된 브레인스토밍 결과

## 1. 핵심 결정

| 항목 | 결정 | 근거 |
| --- | --- | --- |
| 데스크톱 런타임 | Electron | GitHub Desktop·VS Code로 검증. Node에서 git 프로세스 실행·취소·스트리밍 제어가 용이. 팀 역량(JS/TS)과 일치 |
| UI | React + TypeScript | 사용자 표준 스택 |
| 컴포넌트 기반 | React Aria Components + 자체 디자인 토큰 | Spectrum 품질의 접근성·상호작용을 얻으면서 디자인 자유도 확보. "AI 생성물처럼 보이지 않는 세련된 디자인" 목표에 부합 |
| Git 실행 | git CLI 번들(dugite 방식) + 출력 파싱 | LFS·sparse·partial clone·credential helper 등 전체 기능 호환. "실행한 명령 로그" 요구와 일치. libgit2는 성능 병목 확인 후 하이브리드로 도입 검토 |

## 2. 세부 스택

| 항목 | 선택 |
| --- | --- |
| 빌드 | Vite + electron-vite, electron-builder |
| 언어 | TypeScript strict 모드 |
| 스타일 | 디자인 토큰(CSS 변수) + vanilla-extract 또는 CSS Modules. Tailwind 미사용 |
| 아이콘 | Lucide 단일 세트 |
| 한글 서체 | Pretendard |
| 상태 관리 | 도메인 상태는 스토어(Zustand)로 UI와 분리. React 성능 훅(useMemo/useCallback)은 React Compiler에 위임 |
| 단위/통합 테스트 | Vitest |
| E2E | Playwright (Electron 지원) |
| Git fixture | 시나리오 카탈로그 원칙대로 로컬 bare remote 기반 스크립트 생성 |

## 3. 프로세스·계층 배치

비전 문서 8장의 계층을 Electron 구조에 매핑한다.

| 계층 | 위치 |
| --- | --- |
| UI | renderer 프로세스 (React) |
| Application | renderer — UI와 파일 분리 |
| Domain | 공유 패키지 (순수 TS, 프로세스 무관) |
| Git adapter | main 프로세스 |
| Git process | main 프로세스 — spawn, 취소, 스트리밍, 환경 변수 격리 |
| Hosting adapter | main 프로세스 |
| Credential | main 프로세스 — OS 보안 저장소(keytar 계열/safeStorage) |

- renderer ↔ main 경계는 **타입이 정의된 IPC 계약**으로만 통신한다. renderer는 Node API에 직접 접근하지 않는다(contextIsolation 유지).
- Domain 패키지는 Electron에 의존하지 않는 순수 TypeScript로 두어 단위 테스트와 향후 재사용(웹 버전 등)이 가능하게 한다.

## 4. 저장소 구조 (초안)

```
apps/desktop            # Electron main + renderer 진입점
packages/domain         # 상태 모델, 작업 정책, 위험도·복구 정책
packages/git-adapter    # CLI 출력 → 도메인 모델 변환
packages/git-process    # git 실행, 취소, 스트리밍
packages/ui             # 디자인 토큰, 공통 컴포넌트 (React Aria 기반)
packages/ipc-contract   # renderer ↔ main 타입 계약
```

pnpm workspace 모노레포로 관리한다.

## 5. 리스크와 대응

- **Electron 용량·메모리**: 수용. 대형 저장소 응답성은 런타임보다 점진 로딩·가상화 설계(비전 문서 원칙)로 해결한다.
- **CLI 파싱 취약성**: porcelain v2, `-z` 구분자 등 기계용 출력 형식을 우선 사용하고, 파서는 git-adapter 패키지에 격리해 Git 버전별 테스트를 둔다.
- **성능 병목 시**: 읽기 경로(graph, blame)에 한해 libgit2 하이브리드를 검토한다. Git process 계층이 격리되어 있어 교체 비용이 낮다.
