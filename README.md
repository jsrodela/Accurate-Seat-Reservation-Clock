# Accurate-Seat-Reservation-Clock
좌석 예약 시 서버 시간을 고정밀로 추정하고, **정확한 로컬 클릭 시각**을 계산해 주는 도구입니다.

> HTTP `HEAD` 요청의 `Date` 헤더(RFC 7231)를 1초 간격으로 샘플링하여 **서버 시각**, **왕복 지연(RTT)**, **오프셋(서버−로컬)**을 추정합니다.

---

## ✨ 주요 기능
- 1Hz 주기의 `HEAD` 샘플링으로 서버 시각 추정
- **최소 RTT 샘플** 기반 오프셋 추정 + 중앙값/표준편차(지터) 리포트
- “추천 로컬 클릭 시각” 계산:
```

local\_click = target\_server
\- offset
\- prefire\_ms
\- (use\_best\_half\_rtt ? bestRTT/2 : 0)

```
- 배포 옵션(원하는 것만 사용 가능)
- **Electron 데스크톱 앱**(UI · 설치파일) — 배포 추천
- **Node.js CLI**(경량 콘솔)
- **C(libcurl) CLI**(네이티브, 최소 의존성)

---

## 🧠 동작 원리
1. 대상 예약 엔드포인트에 주기적으로 `HEAD` 요청을 전송.
2. 응답의 `Date` 헤더(GMT)를 파싱해 서버 epoch(ms) 추출.
3. 로컬 송신/수신 시각 `t0`, `t3`로 RTT/오프셋 계산:
 - `RTT = t3 - t0`
 - `offset = server_epoch - ((t0 + t3) / 2)`
4. 네트워크 비대칭을 줄이기 위해 **RTT 최솟값** 샘플을 신뢰 기준으로 사용.
5. 사용자가 입력한 목표 시각(local/server 기준)을 **서버 시각**으로 변환 후 위 공식을 적용해 클릭 시각 계산.

> 주의: 일부 CDN/프록시는 `Date`를 재작성할 수 있습니다. 실제 대상 엔드포인트에서 안정적으로 동작하는지 테스트하세요.

---

## 📦 저장소 구조(권장)
```

/ (repo root)
electron/          # Electron 데스크톱 앱(UI)
package.json
main.js
preload.js
renderer.html
renderer.js
icon.ico
cli-node/          # Node.js 콘솔 버전
package.json
index.js
cli-c/             # C(libcurl) 콘솔 버전
CMakeLists.txt
russel\_clock.c
README.md
.gitignore
LICENSE            # (선택) MIT 등

````
> 한 종류만 쓸 계획이면 해당 폴더만 유지해도 됩니다.

---

## 🚀 빠른 시작

### 옵션 A — Electron 데스크톱 앱(추천)
```bash
cd electron
npm i
npm run dev      # 개발 실행(창 실행)
npm run build    # Windows 설치파일(NSIS) 생성 -> dist/
````

* 설치파일은 `dist/`에 생성됩니다.
* 자동 업데이트가 필요하면 `electron-builder`의 `build.publish`를 GitHub Releases/S3 등으로 설정하세요.
* 코드 서명: Windows 인증서(Authenticode) 준비 후 환경변수(`CSC_LINK`, `CSC_KEY_PASSWORD`) 또는 Windows 인증서 저장소 사용.

### 옵션 B — Node.js CLI(경량)

```bash
cd cli-node
npm i
node index.js --url https://example.com/reserve_list.asp \
  --mode local --target "2025-09-08 21:00:00" --prefire 120 --halfrtt
```

* 단일 EXE(Windows)로 묶기:

  ```bash
  npm run build:win   # dist/RusselClockCLI.exe 생성
  ```

### 옵션 C — C(libcurl) CLI(네이티브)

```bash
cd cli-c
mkdir build && cd build
cmake -G "MinGW Makefiles" -DCMAKE_BUILD_TYPE=Release ..
cmake --build . --config Release
# 실행 예:
./russel_clock_c.exe "https://example.com/reserve_list.asp" local "2025-09-08 21:00:00" 120 1
```

---

## ⚙️ 설정(런타임)

CLI 공통 인자:

* `--url` : 예약 엔드포인트(HEAD 지원 필요)
* `--mode`: `local`(로컬 목표 시각을 알고 있음) 또는 `server`(서버 기준 시각)
* `--target`: `"YYYY-MM-DD HH:MM:SS"`
* `--prefire`: 사전 발사(ms), 기본 `120`
* `--halfrtt`: 지정 시 `bestRTT/2`를 추가로 빼서 전파지연 보정

Electron 앱은 UI에서 동일 항목을 설정할 수 있습니다.

---

## 🧪 검증 팁

* 추정된 서버 시각을 NTP 동기화된 기준 시계와 비교해 오차를 확인하세요.
* **best RTT**와 **offset σ**(표준편차)을 감시하세요. 큰 변동은 경로 불안정 또는 서버/CDN 문제를 시사합니다.
* 대상 엔드포인트가 `HEAD`에 빠르게 응답하고 올바른 `Date`를 반환하는지 확인하세요.

---

## 🛠️ 문제 해결

* **앱/EXE가 바로 종료**: 디버그 실행(Electron: `npm run dev`, Node: `node index.js`, C: 터미널 실행)으로 로그 확인.
* **SSL/인증서 오류(Windows)**: Electron은 시스템 CA 사용. Node CLI는 필요한 경우 `NODE_EXTRA_CA_CERTS` 사용을 고려.
* **브라우저 순수 JS로 CORS 에러**: 본 프로젝트는 Electron/Node/C 네이티브 실행을 전제로 합니다. 브라우저 단독 실행은 권장하지 않습니다.

---

## 🔐 배포 체크리스트

* **자동 업데이트**: GitHub Releases/S3 구성 + 코드 서명
* **로그/크래시 리포트**: 파일 로그(순환), 치명적 예외 시 crashlog 생성
* **리버스 방지(합리적 수준)**: Electron은 asar 패키징 및 민감정보 외부화, Node CLI는 단일 바이너리/간단 난독화, C는 정적 링크 및 심볼 최소화
* **오픈소스 라이선스 고지**: 의존성 NOTICE 포함

---

## 📄 라이선스

원하는 라이선스를 사용하세요. 예시(MIT):

```
MIT © Your Name
```

---

## 🙌 크레딧

* `HTTP Date` 기반 시각 추정(왕복 지연 중간점 추정) 아이디어에 기반.

```

필요하면 이 한글 README를 저장소의 실제 구조(어떤 변형을 채택할지)와 문구(앱 이름/엔드포인트 기본값/회사명/라이선스)에 맞춰 더 다듬어 드리겠습니다.
::contentReference[oaicite:0]{index=0}
```
