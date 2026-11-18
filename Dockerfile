# floresta-ui: the relay server and the static UI. Python standard library only.
FROM python:3.13-slim

WORKDIR /app
COPY server/serve.py server/config.py server/mock_florestad.py server/
COPY static static

# Inside the container the UI listens on all interfaces; docker-compose.yml
# publishes it on 127.0.0.1 of the host only.
ENV UI_BIND=0.0.0.0:3000 \
    FLORESTA_DATADIR=/data/.floresta \
    PYTHONUNBUFFERED=1

EXPOSE 3000
CMD ["python3", "server/serve.py"]
