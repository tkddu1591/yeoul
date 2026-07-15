# Git GUI

복잡한 Git 작업을 터미널 지식 없이도 안전하게 이해하고 수행할 수 있도록 만드는 데스크톱 Git 클라이언트입니다.

IntelliJ의 Git 도구가 제공하는 일상적인 작업 흐름을 출발점으로 삼되, 충돌·중단·복구·대형 저장소·다중 계정처럼 실제 현장에서 마주치는 어려운 상태까지 명확하게 보여 주고 제어하는 것을 목표로 합니다.

## 현재 상태

0단계(기반) 최소 수직 기능이 동작합니다: 저장소 열기, 상태 감지, 변경 파일 목록, diff 보기, stage/unstage, commit.

- [제품 목적과 범위](docs/PRODUCT_VISION.md)
- [Git 시나리오 카탈로그](docs/GIT_SCENARIOS.md)
- [쉬운 모드 설계](docs/superpowers/specs/2026-07-15-easy-mode-design.md)
- [기술 스택 설계](docs/superpowers/specs/2026-07-15-tech-stack-design.md)

### 실행

```
pnpm install
pnpm --filter @git-gui/desktop dev   # 앱 실행
pnpm test                            # 단위·통합 테스트
```

## 핵심 원칙

- Git의 현재 상태를 숨기지 않고 사람이 이해할 수 있는 언어로 설명한다.
- 실행 전 영향 범위를 보여 주고, 위험한 작업에는 복구 경로를 함께 제공한다.
- 일반 저장소뿐 아니라 worktree, submodule, LFS, sparse checkout 같은 구조도 일급 기능으로 다룬다.
- GitHub, GitLab, Bitbucket 및 여러 인증 프로필을 저장소와 명시적으로 연결한다.
- 대형 저장소에서도 파일 목록과 커밋 그래프가 점진적으로 반응해야 한다.

## 다음 단계

1. fetch/pull/push와 브랜치 생성·전환 (0단계 마무리)
2. 취소 가능한 Git 프로세스와 실행 로그
3. E0: 쉬운 모드 2패널 UI와 디자인 토큰 (React Aria)
4. 충돌 및 중단 상태별 테스트 fixture 확장

