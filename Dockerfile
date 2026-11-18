FROM python:3.12-slim

WORKDIR /app

# Copy backend and crawler requirements
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copy self-contained backend source
COPY backend ./backend

# Default port (7860 for HuggingFace Spaces, 8765 for local/Render)
ENV PORT=8765
EXPOSE 8765 7860

CMD ["python", "backend/run_public_pipeline.py", "--host", "0.0.0.0", "--interval", "180"]
