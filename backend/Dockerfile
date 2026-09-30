FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY alembic.ini pytest.ini ./
COPY alembic ./alembic
COPY app ./app
COPY tests ./tests

RUN useradd --create-home --uid 10001 sentinel && chown -R sentinel /app
USER sentinel

EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=5 \
  CMD python -c "import json,urllib.request,sys; h=json.load(urllib.request.urlopen('http://127.0.0.1:8000/v1/ops/health', timeout=2)); sys.exit(0 if h['db']=='ok' and h['redis']=='ok' else 1)"

# Migrations are forward-only and idempotent (docs/11 §8), so the container applies them before serving.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000"]
