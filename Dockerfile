FROM python:3.12-slim
WORKDIR /srv
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
# Customer data is never baked into the image: the service downloads it from the
# portal at startup (needs LIO_PORTAL_TOKEN) into LIO_DATA_DIR.
ENV LIO_DATA_DIR=/tmp/lio/data LIO_STATE_DIR=/tmp/lio/state
EXPOSE 8000
# Single worker on purpose: limiter and agent status live in memory.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
