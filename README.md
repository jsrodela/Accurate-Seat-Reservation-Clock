# Accurate-Seat-Reservation-Clock

좌석 예약 시 서버 시간을 추정해 **정확한 로컬 클릭 시각**을 계산하는 도구입니다.

---

## 기능

* 1초 간격 `HEAD` 요청으로 서버 시각 추정
* 최소 RTT 기반 오프셋 계산, 지터(표준편차) 확인 가능
* 입력한 목표 시각을 서버 기준으로 변환 후 **추천 클릭 시각** 출력

계산식:

```
local_click = target_server
             - offset
             - prefire_ms
             - (use_best_half_rtt ? bestRTT/2 : 0)
```

---

## 설치 & 실행

### 1) Electron 앱 (GUI, 설치파일 생성)

```bash
cd electron
npm i
npm run dev      # 개발 실행
npm run build    # 설치파일 dist/ 에 생성
```

### 2) Node.js CLI (가볍게 사용)

```bash
cd cli-node
npm i
node index.js --url https://example.com/reserve_list.asp \
  --mode local --target "2025-09-08 21:00:00" --prefire 120 --halfrtt
```

윈도우 단일 실행파일:

```bash
npm run build:win   # dist/RusselClockCLI.exe 생성
```

### 3) C 버전 (libcurl, 네이티브)

```bash
cd cli-c
mkdir build && cd build
cmake -G "MinGW Makefiles" -DCMAKE_BUILD_TYPE=Release ..
cmake --build . --config Release

./russel_clock_c.exe "https://example.com/reserve_list.asp" local "2025-09-08 21:00:00" 120 1
```

---

## 실행 옵션

공통 CLI 인자:

* `--url` : 예약 엔드포인트
* `--mode` : `local` (로컬 목표시각), `server` (서버 기준시각)
* `--target` : `"YYYY-MM-DD HH:MM:SS"`
* `--prefire` : 사전 발사(ms), 기본 120
* `--halfrtt` : 지정 시 bestRTT/2 반영

---

## 확인 방법

* 추정된 서버 시각을 NTP 동기화 시계와 비교
* best RTT 및 offset 변동폭 모니터링 (불안정하면 네트워크 문제 가능)

---

## 문제 해결

* 실행 직후 꺼짐 → 콘솔에서 실행해 로그 확인
* SSL 인증서 오류 → Node는 `NODE_EXTRA_CA_CERTS` 옵션 활용 가능
* 브라우저 단독 실행은 CORS 문제로 불가 (Electron/Node/C 환경 권장)

---