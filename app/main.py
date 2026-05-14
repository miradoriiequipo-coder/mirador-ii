from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import os

from .database import engine
from . import models
from .routers import auth, players, matches, payments, votes

# Crea todas las tablas automáticamente
models.Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Mirador II FC",
    description="API para el equipo de fútbol Mirador II",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Incluir routers
app.include_router(auth.router, prefix="/api")
app.include_router(players.router, prefix="/api")
app.include_router(matches.router, prefix="/api")
app.include_router(payments.router, prefix="/api")
app.include_router(votes.router, prefix="/api")

# Servir el frontend estático
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR = os.path.join(BASE_DIR, "static")

if os.path.isdir(STATIC_DIR):
    app.mount("/assets", StaticFiles(directory=STATIC_DIR), name="static")

    @app.get("/", include_in_schema=False)
    @app.get("/{path:path}", include_in_schema=False)
    def serve_spa(path: str = ""):
        # No interceptar rutas de la API
        if path.startswith("api/") or path.startswith("assets/"):
            from fastapi import HTTPException
            raise HTTPException(status_code=404)
        index = os.path.join(STATIC_DIR, "index.html")
        if os.path.exists(index):
            return FileResponse(index)
        return {"message": "Frontend no encontrado"}


@app.get("/api/health")
def health():
    return {"status": "ok", "app": "Mirador II FC"}
