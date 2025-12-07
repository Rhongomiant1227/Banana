"""
Nano Banana 图像生成后端服务
基于智增增平台 - 使用 Gemini 图像生成 API
"""
import os
import uuid
import base64
import asyncio
import re
import logging
from typing import Optional, List
from datetime import datetime

import httpx

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(
    title="Nano Banana 图像生成服务",
    description="基于智增增平台的AI图像生成API (Gemini Nano Banana)",
    version="1.0.0"
)

# CORS配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 配置 - 智增增平台 Google API 代理
# 文档: https://doc.zhizengzeng.com/doc-3979947
# 使用 Google 原生 API 格式 + x-goog-api-key header + 流式读取
GOOGLE_API_HOSTS = [
    "https://api.zzz-api.top/google",      # 国际主机 (优先)
    "https://api.zhizengzeng.com/google",   # 国内主机 (备用)
]

# API 密钥持久化存储
API_KEY_FILE = os.path.join(os.path.dirname(__file__), ".api_key")

def _load_api_key():
    """从文件加载 API 密钥"""
    if os.path.exists(API_KEY_FILE):
        with open(API_KEY_FILE, "r") as f:
            return f.read().strip()
    return os.getenv("NANOBANANA_API_KEY", "")

def _save_api_key(key: str):
    """保存 API 密钥到文件"""
    with open(API_KEY_FILE, "w") as f:
        f.write(key)

# 加载已保存的 API 密钥
user_api_key = _load_api_key()

# 模型映射 - 使用 Gemini 图像生成模型 (Nano Banana)
MODELS = {
    "nano-banana": "gemini-2.5-flash-image",        # Gemini 2.5 Flash Image - 快速版
    "nano-banana-pro": "gemini-3-pro-image-preview", # Gemini 3 Pro Image - 专业版
}

# 任务存储（生产环境建议使用Redis）
tasks = {}


class GenerateRequest(BaseModel):
    prompt: str
    aspect_ratio: Optional[str] = None  # 不限制，留空则由模型自动决定
    model: str = "nano-banana-pro"      # 默认使用 Gemini 3 Pro
    reference_images: Optional[List[str]] = None  # Base64 图片数据
    image_size: Optional[str] = None    # 仅 Pro 支持: "1K", "2K", "4K"




@app.get("/")
async def root():
    return {"message": "Nano Banana 图像生成服务运行中", "version": "1.0.0"}


@app.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}


@app.post("/api/generate")
async def generate_image(request: GenerateRequest):
    """
    使用智增增平台的 Gemini API 生成图像 (Nano Banana)
    支持 nano-banana (Gemini 2.5 Flash) 和 nano-banana-pro (Gemini 3 Pro)
    """
    logger.info(f"=== 收到生成请求 === prompt: {request.prompt[:50]}...")
    logger.info(f"当前API密钥: {user_api_key[:10]}..." if user_api_key else "API密钥未设置!")
    
    if not user_api_key:
        raise HTTPException(
            status_code=400, 
            detail="请先设置API密钥"
        )
    
    if not request.prompt.strip():
        raise HTTPException(status_code=400, detail="提示词不能为空")
    
    task_id = str(uuid.uuid4())
    
    # 获取真实模型名称
    model_name = MODELS.get(request.model, MODELS["nano-banana-pro"])
    
    # 构建 Google 原生 API 请求体
    payload = {
        "contents": [
            {
                "parts": [{"text": request.prompt}]
            }
        ]
    }
    
    # 添加参考图片（如果有）- 注意: REST API 使用 camelCase
    if request.reference_images:
        parts = payload["contents"][0]["parts"]
        for img_data in request.reference_images:
            if img_data.startswith("data:"):
                match = re.match(r"data:(image/\w+);base64,(.+)", img_data)
                if match:
                    mime_type = match.group(1)
                    base64_data = match.group(2)
                    parts.insert(0, {
                        "inlineData": {  # camelCase!
                            "mimeType": mime_type,  # camelCase!
                            "data": base64_data
                        }
                    })
    
    # Headers - 关键: 使用 x-goog-api-key
    headers = {
        "Content-Type": "application/json",
        "x-goog-api-key": user_api_key,
        "Connection": "keep-alive"
    }
    
    logger.info(f"模型: {model_name}")
    logger.info(f"请求体: {str(payload)[:200]}...")
    
    # 保存任务信息
    tasks[task_id] = {
        "status": "processing",
        "progress": 10,
        "result_url": None,
        "result_base64": None,
        "error": None,
        "created_at": datetime.now().isoformat(),
        "prompt": request.prompt,
        "model": model_name
    }
    
    # 异步执行生成任务
    asyncio.create_task(_execute_generation(task_id, model_name, payload, headers))
    
    return {
        "task_id": task_id,
        "status": "processing",
        "model": model_name,
        "message": "任务已提交，请轮询获取结果"
    }


async def _execute_generation(task_id: str, model_name: str, payload: dict, headers: dict):
    """异步执行图像生成 (使用 Google 原生 API + 流式读取)"""
    logger.info(f"=== 异步任务开始 === task_id: {task_id}")
    
    import json
    
    last_error = None
    
    # 尝试多个主机
    for host in GOOGLE_API_HOSTS:
        endpoint = f"{host}/v1beta/models/{model_name}:generateContent"
        logger.info(f"尝试主机: {endpoint}")
        
        try:
            tasks[task_id]["progress"] = 30
            
            # 使用流式读取 - 设置较长的超时 (10分钟)
            timeout = httpx.Timeout(600.0, connect=60.0)  # 10分钟读取，1分钟连接
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream("POST", endpoint, json=payload, headers=headers) as response:
                    
                    logger.info(f"API响应状态码: {response.status_code}")
                    
                    if response.status_code != 200:
                        error_text = ""
                        async for chunk in response.aiter_bytes():
                            error_text += chunk.decode("utf-8", errors="ignore")
                        last_error = f"API错误 ({response.status_code}): {error_text[:300]}"
                        logger.error(last_error)
                        continue  # 尝试下一个主机
                    
                    # 流式读取响应内容
                    content = b""
                    async for chunk in response.aiter_bytes(chunk_size=8192):
                        content += chunk
                        # 更新进度 (基于数据量估算)
                        progress = min(30 + int(len(content) / 50000 * 60), 90)
                        tasks[task_id]["progress"] = progress
                    
                    logger.info(f"总共读取: {len(content)} bytes")
                    tasks[task_id]["progress"] = 95
                    
                    # 解析 JSON 响应
                    data = json.loads(content.decode("utf-8"))
                    
                    # 解析 Google 原生格式响应
                    candidates = data.get("candidates", [])
                    if not candidates:
                        # 检查是否有错误信息或安全过滤
                        prompt_feedback = data.get("promptFeedback", {})
                        block_reason = prompt_feedback.get("blockReason", "")
                        if block_reason:
                            last_error = f"内容被安全策略阻止: {block_reason}"
                        else:
                            last_error = f"未生成任何结果 (响应: {str(data)[:200]})"
                        logger.error(last_error)
                        continue
                    
                    content_parts = candidates[0].get("content", {}).get("parts", [])
                    
                    image_data = None
                    text_response = []
                    
                    for part in content_parts:
                        if "inlineData" in part:
                            # 获取图像数据
                            inline_data = part["inlineData"]
                            mime_type = inline_data.get("mimeType", "image/png")
                            base64_data = inline_data.get("data", "")
                            image_data = f"data:{mime_type};base64,{base64_data}"
                            logger.info(f"找到图像数据: {len(base64_data)} chars")
                        elif "text" in part:
                            text_response.append(part["text"])
                    
                    if image_data:
                        tasks[task_id]["status"] = "completed"
                        tasks[task_id]["progress"] = 100
                        tasks[task_id]["result_base64"] = image_data
                        if text_response:
                            tasks[task_id]["thinking"] = "\n".join(text_response)
                        logger.info(f"✅ 图像生成成功: {task_id}")
                        return  # 成功，退出
                    else:
                        last_error = "响应中没有图像数据"
                        if text_response:
                            last_error += f" (模型回复: {text_response[0][:100]}...)"
                        logger.error(last_error)
                        continue
                        
        except Exception as e:
            last_error = f"{type(e).__name__}: {str(e)}"
            logger.error(f"主机 {host} 失败: {last_error}")
            continue
    
    # 所有主机都失败
    tasks[task_id]["status"] = "failed"
    tasks[task_id]["error"] = last_error or "所有主机都失败"
    logger.error(f"任务失败: {task_id} - {tasks[task_id]['error']}")


class TaskStatusResponse(BaseModel):
    task_id: str
    status: str
    progress: int
    result_url: Optional[str] = None
    result_base64: Optional[str] = None
    error: Optional[str] = None
    created_at: str
    model: Optional[str] = None


@app.get("/api/task/{task_id}")
async def get_task_status(task_id: str):
    """
    查询任务状态
    """
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="任务不存在")
    
    task = tasks[task_id]
    
    return TaskStatusResponse(
        task_id=task_id,
        status=task["status"],
        progress=task["progress"],
        result_url=task.get("result_url"),
        result_base64=task.get("result_base64"),
        error=task.get("error"),
        created_at=task["created_at"],
        model=task.get("model")
    )


@app.post("/api/upload-reference")
async def upload_reference_image(file: UploadFile = File(...)):
    """
    上传参考图片（Base64编码返回，或可扩展为上传到云存储）
    """
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="只支持图片文件")
    
    # 限制文件大小 (10MB)
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="文件大小不能超过10MB")
    
    # 返回Base64编码
    base64_data = base64.b64encode(content).decode("utf-8")
    
    return {
        "filename": file.filename,
        "content_type": file.content_type,
        "size": len(content),
        "base64": f"data:{file.content_type};base64,{base64_data}"
    }


@app.get("/api/tasks")
async def list_tasks(limit: int = 20):
    """
    获取最近的任务列表
    """
    sorted_tasks = sorted(
        tasks.items(),
        key=lambda x: x[1]["created_at"],
        reverse=True
    )[:limit]
    
    return [
        {
            "task_id": task_id,
            "status": task["status"],
            "progress": task["progress"],
            "result_url": task.get("result_url"),
            "prompt": task.get("prompt", "")[:50],
            "created_at": task["created_at"]
        }
        for task_id, task in sorted_tasks
    ]


@app.delete("/api/task/{task_id}")
async def delete_task(task_id: str):
    """
    删除任务记录
    """
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="任务不存在")
    
    del tasks[task_id]
    return {"message": "任务已删除"}


# API 密钥管理
class ApiKeyRequest(BaseModel):
    api_key: str


@app.post("/api/set-key")
async def set_api_key(request: ApiKeyRequest):
    """
    设置 API 密钥 (会持久化保存)
    """
    global user_api_key
    user_api_key = request.api_key
    _save_api_key(request.api_key)  # 持久化保存
    logger.info(f"API密钥已保存: {request.api_key[:10]}...")
    return {"success": True, "message": "API密钥已设置并保存"}


@app.get("/api/check-key")
async def check_api_key():
    """
    检查当前 API 密钥是否已设置
    """
    has_key = bool(user_api_key)
    # 只显示部分密钥
    masked_key = ""
    if user_api_key:
        masked_key = user_api_key[:8] + "..." + user_api_key[-4:] if len(user_api_key) > 12 else "***"
    return {"has_key": has_key, "masked_key": masked_key}


@app.post("/api/verify-key")
async def verify_api_key(request: ApiKeyRequest):
    """
    验证 API 密钥是否有效
    """
    headers = {
        "Content-Type": "application/json",
        "x-goog-api-key": request.api_key
    }
    
    # 使用简单的文本请求测试 API
    test_payload = {
        "contents": [{"parts": [{"text": "Hi"}]}]
    }
    
    # 尝试国际主机
    test_endpoint = f"{GOOGLE_API_HOSTS[0]}/v1beta/models/gemini-2.0-flash:generateContent"
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(test_endpoint, json=test_payload, headers=headers)
            
            if response.status_code == 200:
                return {"valid": True, "message": "API密钥有效"}
            elif response.status_code == 401 or response.status_code == 403:
                return {"valid": False, "message": "API密钥无效或已过期"}
            else:
                error_msg = response.text[:200]
                return {"valid": False, "message": f"验证失败: {error_msg}"}
                
    except Exception as e:
        return {"valid": False, "message": f"网络错误: {str(e)}"}


# ==================== 静态文件服务 (生产环境) ====================
# 在所有 API 路由之后挂载静态文件
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")

if os.path.exists(FRONTEND_DIR):
    # 挂载静态资源 (JS, CSS, 图片等)
    assets_dir = os.path.join(FRONTEND_DIR, "assets")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")
    
    # 首页
    @app.get("/")
    async def serve_index():
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))
    
    # 所有其他非 API 请求返回 index.html (SPA 路由)
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # 如果是 API 请求，跳过
        if full_path.startswith("api"):
            raise HTTPException(status_code=404)
        
        # 检查是否是静态文件
        file_path = os.path.join(FRONTEND_DIR, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        
        # 否则返回 index.html (SPA)
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))
else:
    @app.get("/")
    async def root():
        return {"message": "Nano Banana API", "docs": "/docs", "note": "Frontend not built. Run 'npm run build' in frontend/"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
