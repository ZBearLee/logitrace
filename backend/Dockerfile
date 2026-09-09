# syntax=docker/dockerfile:1

# 单阶段镜像（安装依赖 + 运行）
# 多阶段构建 + 体积优化推迟到后期工程收口，当前目标是"能跑通编排"。

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# 先只拷依赖文件：改代码不会让这一层缓存失效
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# 再拷源码（.dockerignore 已排除 .venv / __pycache__ / tests / .env）
COPY backend/app ./app

EXPOSE 8000

# 容器内 backend 需要连接 mysql/redis 服务名，由 compose 注入环境变量
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
