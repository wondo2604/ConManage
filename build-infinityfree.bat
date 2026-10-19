@echo off
chcp 65001 > nul
echo ========================================================
echo  InfinityFree 전용 React 프론트엔드 빌드 도구
echo ========================================================
echo.
echo 백엔드 서버가 호스팅된 API URL 주소를 입력하세요.
echo (예: https://your-backend.onrender.com/api)
echo * 엔터를 그냥 누르면 기본 상대 경로(/api)로 빌드됩니다.
echo.
set /p API_URL="백엔드 API 주소 입력: "

cd /d "%~dp0frontend"

if "%API_URL%"=="" (
    echo.
    echo [/api 상대경로로 빌드 진행 중...]
    npm run build
) else (
    echo.
    echo [%API_URL% 주소로 빌드 진행 중...]
    set VITE_API_URL=%API_URL%
    npm run build
)

echo.
echo [InfinityFree htdocs 패키징 중...]
cd /d "%~dp0"
powershell -Command "Copy-Item -Recurse -Force 'frontend\dist\*' 'infinityfree_htdocs\'; Compress-Archive -Force -Path 'infinityfree_htdocs\*' -DestinationPath 'infinityfree-htdocs.zip'"

echo.
echo ========================================================
echo  빌드 및 패키징 완료!
echo  파일: infinityfree-htdocs.zip
echo  InfinityFree 파일 관리자(File Manager)의 'htdocs' 폴더 안에
echo  압축을 풀어 업로드하시면 됩니다!
echo ========================================================
pause
