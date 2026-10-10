# Chore Chart: one small container, no dependencies beyond the Python standard library.
FROM python:3.13-alpine

LABEL org.opencontainers.image.title="Chore Chart" \
      org.opencontainers.image.source="https://github.com/MorningstarOwl/chore-chart" \
      org.opencontainers.image.description="A shared household chore calendar: log chores from any phone, set per-person goals, schedule repeating chores." \
      org.opencontainers.image.licenses="MIT"

# tzdata so TZ=Region/City works ("today" follows the household's clock).
RUN apk add --no-cache tzdata \
 && addgroup -S -g 10001 chores \
 && adduser -S -D -H -u 10001 -G chores chores \
 && mkdir /data \
 && chown chores:chores /data

ENV CHORE_DATA_DIR=/data \
    CHORE_PORT=8420 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app
COPY server.py index.html styles.css ./
COPY js/ js/
COPY config/ config/

USER chores
VOLUME /data
EXPOSE 8420

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/api/household' % os.environ.get('CHORE_PORT', '8420'), timeout=4)"]

CMD ["python", "server.py"]
