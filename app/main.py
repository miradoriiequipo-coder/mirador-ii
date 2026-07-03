from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
import os

from .database import engine
from . import models
from .routers import auth, players, matches, payments, votes, finances, tournaments, gallery, ai, attendance

models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Mirador II FC", version="3.0.0")

# ── Middleware: no cachear archivos JS/CSS/HTML ──────────────────
class NoCacheMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        path = request.url.path
        if path.endswith(('.js', '.css', '.html')) or path == '/':
            response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
            response.headers['Pragma'] = 'no-cache'
            response.headers['Expires'] = '0'
        return response

app.add_middleware(NoCacheMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router,        prefix="/api")
app.include_router(players.router,     prefix="/api")
app.include_router(matches.router,     prefix="/api")
app.include_router(payments.router,    prefix="/api")
app.include_router(votes.router,       prefix="/api")
app.include_router(finances.router,    prefix="/api")
app.include_router(tournaments.router, prefix="/api")
app.include_router(gallery.router,     prefix="/api")
app.include_router(ai.router,          prefix="/api")
app.include_router(attendance.router,  prefix="/api")

BASE_DIR   = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR = os.path.join(BASE_DIR, "static")

if os.path.isdir(STATIC_DIR):
    app.mount("/assets", StaticFiles(directory=STATIC_DIR), name="static")

    @app.get("/", include_in_schema=False)
    def serve_index():
        return FileResponse(os.path.join(STATIC_DIR, "index.html"))

    @app.get("/{path:path}", include_in_schema=False)
    def serve_spa(path: str = ""):
        if path.startswith("api/") or path.startswith("assets/"):
            from fastapi import HTTPException
            raise HTTPException(status_code=404)
        index = os.path.join(STATIC_DIR, "index.html")
        if os.path.exists(index):
            return FileResponse(index)

@app.get("/api/health")
def health():
    return {"status": "ok", "app": "Mirador II FC v3"}