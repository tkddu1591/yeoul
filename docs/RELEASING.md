# macOS 릴리스

여울(Yeoul) 릴리스는 공개 소스 저장소 [`tkddu1591/yeoul`](https://github.com/tkddu1591/yeoul)에 `v<앱 버전>` 태그를 push하면 GitHub Actions가 다음 작업을 한 번에 수행합니다. 설치 파일과 자동 업데이트 메타데이터는 바이너리 전용 저장소 [`tkddu1591/yeoul-releases`](https://github.com/tkddu1591/yeoul-releases)에 발행합니다.

- lint, 타입 검사, 전체 테스트
- Apple Silicon과 Intel을 모두 포함한 Universal 앱 생성
- 인증 정보가 있으면 Developer ID Application 서명·Apple 공증·티켓 stapling
- 인증 정보가 없으면 임시 배포용 ad-hoc 서명
- 릴리스 방식에 맞는 서명, Universal 바이너리, 내장 터미널 실행 검증
- DMG, ZIP, `latest-mac.yml`, DMG SHA-512를 공개 바이너리 GitHub Release에 발행

## 무료 ad-hoc 릴리스

Apple Developer Program 없이 사용할 수 있는 기본 방식입니다. 공개 소스 저장소의 GitHub Actions에서 Universal DMG와 ZIP을 만든 뒤 바이너리 전용 저장소에 올립니다.

ad-hoc 앱은 Apple 공증을 받지 않았으므로 처음 실행할 때 Gatekeeper 경고가 표시될 수 있습니다. 테스트 사용자는 Finder에서 앱을 우클릭한 뒤 `열기`를 선택해야 할 수 있습니다.

앱은 공개 바이너리 저장소의 최신 릴리스를 시작 15초 후, 이후 6시간마다 확인합니다. 새 버전이 있으면 DMG와 `.sha512`를 내려받아 검증한 뒤 DMG를 엽니다. Developer ID 서명이 없는 동안에는 실행 중인 앱을 자동 교체하지 않으며, 사용자가 여울을 종료하고 DMG의 앱을 응용 프로그램 폴더에 덮어씁니다.

## 바이너리 저장소 권한

소스 저장소의 Actions secret에 `YEOUL_RELEASE_TOKEN`을 등록합니다. 이 토큰은 `tkddu1591/yeoul-releases`의 Contents 쓰기 권한만 가진 fine-grained token 또는 GitHub App token이어야 합니다. 앱과 빌드 산출물에는 이 토큰이 포함되지 않습니다.

fork에서 실행한 워크플로와 일반 Pull Request에는 이 secret을 전달하지 않습니다. 릴리스는 저장소 관리자가 만든 `v*` 태그에서만 실행합니다.

## 선택 사항: Developer ID 서명·공증

1. Apple Developer Program에서 `Developer ID Application` 인증서를 만들고 `.p12`로 내보냅니다.
2. App Store Connect에서 공증용 API Key(`.p8`)를 만듭니다.
3. GitHub 저장소의 Actions secrets에 아래 값을 등록합니다.

| Secret | 값 |
| --- | --- |
| `MACOS_CERTIFICATE_P12_BASE64` | `.p12` 파일의 base64 문자열 |
| `MACOS_CERTIFICATE_PASSWORD` | `.p12` 내보내기 암호 |
| `APPLE_API_KEY_P8_BASE64` | `.p8` 파일의 base64 문자열 |
| `APPLE_API_KEY_ID` | API Key ID |
| `APPLE_API_ISSUER` | Issuer ID |

파일은 `base64 -i <파일>` 결과를 줄바꿈 없이 secret으로 저장합니다. 인증서와 API Key 원본은 저장소에 커밋하지 않습니다.

## 릴리스

`apps/desktop/package.json`의 `version`을 먼저 올리고 같은 버전의 태그를 push합니다.

```bash
git tag v0.2.1
git push origin v0.2.1
```

태그와 앱 버전이 다르면 릴리스는 발행되지 않습니다. 서명 secret 5개가 모두 없으면 ad-hoc으로 발행하고, 모두 있으면 Developer ID 서명·공증으로 발행합니다. 일부만 등록된 경우에는 잘못된 보안 설정으로 간주해 릴리스를 중단합니다.

## 자동 업데이트와 크래시 자료

공개 업데이트 채널로 배포한 앱은 공개 릴리스 API만 읽습니다. 무료 ad-hoc 빌드에서는 SHA-512로 검증한 DMG를 열어 수동 교체를 안내합니다. Developer ID 서명·공증을 적용하면 같은 공개 저장소의 ZIP과 `latest-mac.yml`을 사용해 앱 내부 자동 교체로 확장할 수 있습니다.

Crashpad 덤프와 런타임 오류 로그는 외부로 보내지 않고 아래 로컬 폴더에 저장합니다.

```text
~/Library/Application Support/Yeoul/diagnostics
```

덤프에는 프로세스 메모리 일부가 포함될 수 있으므로 사용자의 동의 없이 업로드하지 않습니다. 원격 자동 수집이 필요하면 별도의 수집 서버와 개인정보 안내를 정한 뒤 `crashReporter`의 업로드를 활성화해야 합니다.
