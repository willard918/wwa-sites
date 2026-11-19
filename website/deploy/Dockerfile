# Build from the website/ folder:  docker build -f deploy/Dockerfile -t wwa-site .
# Run:  docker run -d -p 8787:8787 -v wwa-data:/data --env-file deploy/env.production wwa-site
FROM python:3.12-slim
WORKDIR /app
COPY index.html splash.html privacy.html ./
COPY lotcheck ./lotcheck
COPY outreach ./outreach
ENV WWA_HOST=0.0.0.0 WWA_DATA=/data WWA_TRUST_PROXY=1 PYTHONUNBUFFERED=1
VOLUME /data
EXPOSE 8787
USER nobody
CMD ["python", "lotcheck/server.py", "--port", "8787"]
