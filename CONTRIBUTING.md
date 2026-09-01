# 여울에 기여하기

버그 제보, 사용성 피드백, 문서와 코드 기여를 환영합니다.

## 시작하기 전에

- 동작 오류는 재현 절차, 기대 결과와 실제 결과를 이슈에 적어 주세요.
- UI 변경은 가능하면 화면 크기와 macOS 버전을 함께 알려 주세요.
- 큰 기능이나 패키지 경계를 바꾸는 작업은 구현 전에 이슈에서 방향을 먼저 맞춰 주세요.
- 보안 취약점과 토큰 노출은 공개 이슈가 아닌 [보안 정책](SECURITY.md)을 따라 주세요.

## 개발 환경

Node.js 22 이상, pnpm 10, Git 2.28 이상이 필요합니다.

```bash
pnpm install
pnpm --filter @git-gui/desktop dev
```

## 패키지 경계

- `domain`은 Electron, React와 Git 프로세스를 알지 않습니다.
- `git-adapter`는 Git 출력을 도메인 모델로 변환합니다.
- `git-process`는 명령 실행·취소·스트리밍만 담당합니다.
- `hosting`은 GitHub 같은 원격 호스팅 연동을 담당합니다.
- `ipc-contract`는 main과 renderer 사이 타입 계약만 제공합니다.
- `desktop`은 위 경계를 조합하고 사용자 인터페이스를 제공합니다.

다른 패키지의 내부 구현을 직접 가져오기보다 공개된 패키지 API를 사용해 주세요.

## 제출 전 확인

```bash
pnpm lint
pnpm typecheck
pnpm test
```

화면이나 Electron 동작을 바꿨다면 다음 검증도 실행해 주세요.

```bash
pnpm --filter @git-gui/desktop e2e
```

Pull Request에는 변경 이유, 사용자에게 달라지는 점, 실행한 검증을 적어 주세요. 한 PR에는 가능한 한 하나의 문제만 담아 리뷰와 되돌리기가 쉽도록 해 주세요.
