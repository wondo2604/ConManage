# 🚀 Render.com Node.js 배포 가이드

본 플랫폼(Node.js Express + SQLite + React)을 **Render (render.com)** 클라우드에 원클릭/간편 배포하는 방법입니다.

---

## 📌 주요 특징 및 이번 업데이트 내역

1. **단일 서비스 배포 (Full-Stack in 1 Service)**
   - 프론트엔드(React Vite 빌드)와 백엔드(Node.js API)가 하나의 포트에서 서비스되므로 별도의 복잡한 도메인 설정이나 CORS 이슈 없이 완벽하게 작동합니다.
2. **공지사항 디스코드 웹훅 개별 설정 & 메시지 양식 커스터마이징**
   - 납품 안내문을 비롯한 각 공지사항마다 별도의 디스코드 웹훅 URL 지정 가능 (미지정 시 기본 웹훅 사용)
   - 멘션 여부 선택: `@everyone` (전체 멘션), `@here` (접속자 멘션), 멘션 없음
   - 임베드 테두리 색상 선택 (컬러 피커 지원)
   - 메시지 본문 양식 템플릿 지원: `{title}`, `{content}`, `{author}`, `{date}` 변수 치환
   - 공지 수정 시 자동 발송 체크박스 및 "⚡ 디스코드 테스트 발송", "저장 & 즉시 알림" 지원
3. **슈퍼관리자 전용 데이터 JSON 추출 및 불러오기 (백업 & 복원)**
   - 슈퍼관리자(admin) 패널에서 **전체 14개 테이블**(계정, 역할, 재화, 물자, 납품 기록, 상점, 알바, 일정, 퀘스트, 공지사항, 설정 등)을 타임스탬프가 포함된 `.json` 파일 하나로 즉시 다운로드
   - 저장해 둔 `.json` 파일을 선택하여 원클릭으로 데이터베이스 전체 복원 (트랜잭션 안전 보장)

---

## 🛠️ Render 배포 단계 (초간단 5분 가이드)

### 1단계: GitHub에 소스코드 올리기
1. [GitHub](https://github.com)에 로그인 후 새로운 리포지토리(Repository)를 만듭니다 (예: `minecraft-platform`).
2. 로컬 프로젝트 폴더(`web1`)에서 Git 커밋 및 푸시를 진행합니다:
   ```bash
   git init
   git add .
   git commit -m "feat: render deployment & notice webhook & json backup"
   git branch -M main
   git remote add origin https://github.com/사용자아이디/minecraft-platform.git
   git push -u origin main
   ```

---

### 2단계: Render.com에서 Web Service 생성

1. [Render.com](https://render.com)에 접속하여 로그인합니다 (GitHub 계정으로 간편 로그인 추천).
2. 우측 상단 **[New +]** 버튼을 누르고 **[Web Service]**를 선택합니다.
3. 방금 푸시한 GitHub 리포지토리(`minecraft-platform`)를 찾아 **[Connect]**를 클릭합니다.
4. 아래 설정값을 입력합니다:

| 설정 항목 | 입력값 | 설명 |
| :--- | :--- | :--- |
| **Name** | `minecraft-platform` (원하는 이름) | 서비스 식별용 이름 |
| **Region** | `Singapore` (싱가포르) | 한국에서 가장 지연시간이 적은 리전 |
| **Branch** | `main` | 배포할 깃 브랜치 |
| **Runtime** | `Node` | Node.js 환경 |
| **Build Command** | `npm run build` | 프론트엔드 빌드 및 백엔드 설치 자동 수행 |
| **Start Command** | `npm start` | 백엔드 서버 구동 |
| **Instance Type** | `Free` | 무료 티어 선택 가능 |

---

### 3단계: 환경 변수(Environment Variables) 설정

스크롤을 내려 **[Environment Variables]** 섹션에서 [Add Environment Variable]을 눌러 다음 변수들을 추가합니다:

1. **`NODE_VERSION`** : `22.11.0` *(필수: 내장 SQLite 모듈 지원을 위해 Node 22 이상 필수)*
2. **`JWT_SECRET`** : 임의의 긴 보안 문자열 (예: `minecraft-secret-random-key-98765`)
3. **`DISCORD_WEBHOOK_URL`** (선택) : 기본 디스코드 웹훅 URL (웹사이트 관리자 패널에서도 설정 가능)
4. *(유료 디스크 마운트 사용 시)* **`DATA_DIR`** : `/var/data` (디스크 마운트 경로)

---

### 4단계: 배포 시작 및 접속!

1. 하단 **[Deploy Web Service]** 버튼을 누릅니다.
2. 약 1~2분 후 빌드와 실행이 완료되면 상단에 고유 주소가 생성됩니다:
   👉 `https://minecraft-platform-xxxx.onrender.com`
3. 해당 주소로 접속하면 마인크래프트 관리 플랫폼이 정상 작동합니다!
   - **초기 최고 관리자 계정**: `admin` / `admin` (접속 시 비밀번호 변경 요청)

---

## 💡 유용한 팁 & 데이터 보관 안내

### Render 무료 티어(Free Tier) 사용 시 주의사항
- Render 무료 인스턴스는 15분 동안 방문자가 없으면 슬립(Sleep) 상태로 전환되며, 새 접속 시 30~50초 정도 로딩이 걸릴 수 있습니다.
- 인스턴스가 재시작되거나 새로 배포될 때 로컬 디스크 파일이 초기화될 수 있으므로,
  **관리자 탭(슈퍼관리자 패널)의 [데이터베이스 백업 & 복원] 카드**에서 정기적으로 **[전체 데이터 JSON 내보내기]** 버튼을 눌러 백업 파일을 다운로드해 두시는 것을 권장합니다.
- 데이터 복원이 필요할 땐 **[JSON 백업 파일 선택 및 불러오기]**로 즉시 원상 복구할 수 있습니다.

### 디스크 영속성(Persistent Disk - 영구 보관)
- Render에서 유료 Disk(월 $1 수준)를 생성하여 마운트 경로를 `/var/data`로 설정하고 환경변수 `DATA_DIR=/var/data`를 지정하시면, 서버가 재배포되거나 재시작되어도 SQLite 데이터베이스와 업로드 이미지가 영구 보존됩니다.
