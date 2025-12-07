@echo off
chcp 65001 >nul
title Nano Banana - 一键启动

echo ======================================
echo    Nano Banana AI 图像生成服务
echo    基于智增增平台
echo ======================================
echo.

:: 检查 Python
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未找到 Python，请先安装 Python 3.8+
    pause
    exit /b 1
)

:: 检查 Node.js
where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未找到 Node.js，请先安装 Node.js 18+
    pause
    exit /b 1
)

:: 创建 Python 虚拟环境（如果不存在）
if not exist "backend\venv" (
    echo [1/4] 创建 Python 虚拟环境...
    cd backend
    python -m venv venv
    cd ..
)

:: 安装后端依赖
echo [2/4] 安装后端依赖...
cd backend
call venv\Scripts\activate.bat
pip install -r requirements.txt -q
cd ..

:: 创建 .env 文件（如果不存在）
if not exist "backend\.env" (
    echo [提示] 创建配置文件...
    copy backend\.env.example backend\.env >nul
    echo [提示] 请在 backend\.env 中配置 API 密钥
)

:: 安装前端依赖
if not exist "frontend\node_modules" (
    echo [3/4] 安装前端依赖...
    cd frontend
    call npm install
    cd ..
) else (
    echo [3/4] 前端依赖已安装
)

echo [4/4] 启动服务...
echo.
echo 后端服务: http://localhost:8000
echo 前端服务: http://localhost:3000
echo.
echo 按 Ctrl+C 停止所有服务
echo ======================================
echo.

:: 启动后端（新窗口）
start "Nano Banana Backend" cmd /k "cd /d %~dp0backend && venv\Scripts\activate.bat && python -m uvicorn app:app --reload --host 0.0.0.0 --port 8000"

:: 等待后端启动
timeout /t 3 /nobreak >nul

:: 启动前端（新窗口）
start "Nano Banana Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

:: 等待前端启动后打开浏览器
timeout /t 5 /nobreak >nul
start http://localhost:3000

echo.
echo 服务已启动！浏览器将自动打开。
echo 如果没有自动打开，请手动访问: http://localhost:3000
echo.
pause
