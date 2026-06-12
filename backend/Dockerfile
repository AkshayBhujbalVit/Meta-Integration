FROM python:3.11-slim

WORKDIR /app

# System libs needed by psycopg2, lxml, av (ffmpeg), pdfplumber
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps first (layer cache — only re-runs when requirements.txt changes)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Uploads dir must exist (mounted as a volume at runtime)
RUN mkdir -p uploads

EXPOSE 8009

# Run DB migrations then start the API server
CMD ["sh", "-c", "python init_db.py && uvicorn main:app --host 0.0.0.0 --port 8009"]
