#!/bin/bash

echo "======================================"
echo "   Nano Banana AI 图像生成服务"
echo "   基于智增增平台"
echo "======================================"
echo

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查 Python
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}[错误] 未找到 Python3，请先安装 Python 3.8+${NC}"
    exit 1
fi

# 检查 Node.js
if ! command -v npm &> /dev/null; then
    echo -e "${RED}[错误] 未找到 Node.js，请先安装 Node.js 18+${NC}"
    exit 1
fi

# 获取脚本所在目录
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$SCRIPT_DIR"

# 创建 Python 虚拟环境
if [ ! -d "backend/venv" ]; then
    echo -e "${YELLOW}[1/4] 创建 Python 虚拟环境...${NC}"
    cd backend
    python3 -m venv venv
    cd ..
fi

# 安装后端依赖
echo -e "${YELLOW}[2/4] 安装后端依赖...${NC}"
cd backend
source venv/bin/activate
pip install -r requirements.txt -q
cd ..

# 创建 .env 文件
if [ ! -f "backend/.env" ]; then
    echo -e "${YELLOW}[提示] 创建配置文件...${NC}"
    cp backend/.env.example backend/.env
    echo -e "${YELLOW}[提示] 请在 backend/.env 中配置 API 密钥${NC}"
fi

# 安装前端依赖
if [ ! -d "frontend/node_modules" ]; then
    echo -e "${YELLOW}[3/4] 安装前端依赖...${NC}"
    cd frontend
    npm install
    cd ..
else
    echo -e "${GREEN}[3/4] 前端依赖已安装${NC}"
fi

echo -e "${YELLOW}[4/4] 启动服务...${NC}"
echo
echo "后端服务: http://localhost:8000"
echo "前端服务: http://localhost:3000"
echo
echo "按 Ctrl+C 停止所有服务"
echo "======================================"
echo

# 清理函数
cleanup() {
    echo
    echo -e "${YELLOW}正在停止服务...${NC}"
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    exit 0
}

trap cleanup SIGINT SIGTERM

# 启动后端
cd backend
source venv/bin/activate
python -m uvicorn app:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
cd ..

# 等待后端启动
sleep 3

# 启动前端
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..

# 等待前端启动后打开浏览器
sleep 5
if command -v xdg-open &> /dev/null; then
    xdg-open http://localhost:3000
elif command -v open &> /dev/null; then
    open http://localhost:3000
fi

echo
echo -e "${GREEN}服务已启动！${NC}"
echo "请访问: http://localhost:3000"
echo

# 等待子进程
wait
