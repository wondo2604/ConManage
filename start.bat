@echo off
chcp 65001 > nul
echo ===================================================
echo  마인크래프트 국가전쟁 관리 플랫폼 실행 스크립트
echo ===================================================
echo [1/2] 백엔드 서버(Node.js + SQLite) 시작 중... (포트 5000)
start "Backend Server" cmd /k "cd backend && npm start"

echo [2/2] 프론트엔드 개발 서버(Vite React) 시작 중... (포트 3100)
start "Frontend Dev" cmd /k "cd frontend && npm run dev"

echo.
echo 잠시 후 브라우저에서 http://127.0.0.1:3100 으로 접속하세요!
echo 초기 관리자 계정: 아이디 admin / 비밀번호 admin
echo ===================================================
pause
