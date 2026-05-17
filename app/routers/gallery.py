from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from sqlalchemy.orm import Session
from typing import Optional
import os, uuid, httpx
from .. import models
from ..database import get_db
from ..auth import require_admin

router = APIRouter(prefix="/gallery", tags=["gallery"])

SUPABASE_URL     = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY     = os.getenv("SUPABASE_SERVICE_KEY", "")
BUCKET           = "fotos"


def _supabase_headers():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }


def _public_url(path: str) -> str:
    return f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{path}"


@router.get("")
def list_photos(
    t: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(models.Photo)
    if t:
        q = q.filter(models.Photo.tournament_id == t)
    else:
        active = db.query(models.Tournament).filter(models.Tournament.is_active == True).first()
        if active:
            q = q.filter(models.Photo.tournament_id == active.id)
    photos = q.order_by(models.Photo.created_at.desc()).all()
    return [
        {
            "id": p.id,
            "url": p.url,
            "caption": p.caption,
            "storage_path": p.storage_path,
            "created_at": p.created_at.isoformat(),
        }
        for p in photos
    ]


@router.post("")
async def upload_photo(
    file: UploadFile = File(...),
    caption: str = Form(""),
    t: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    # Validar tipo
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Solo se permiten imágenes")

    # Verificar configuración de Supabase
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise HTTPException(
            status_code=500,
            detail="Supabase Storage no está configurado. Agrega SUPABASE_URL y SUPABASE_SERVICE_KEY al .env"
        )

    # Obtener tournament_id
    if t:
        tid = t
    else:
        active = db.query(models.Tournament).filter(models.Tournament.is_active == True).first()
        if not active:
            raise HTTPException(status_code=400, detail="No hay torneo activo")
        tid = active.id

    # Generar nombre único
    ext = file.filename.split(".")[-1] if "." in file.filename else "jpg"
    filename = f"{tid}/{uuid.uuid4().hex}.{ext}"

    # Subir a Supabase Storage
    content = await file.read()
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{filename}",
                headers={**_supabase_headers(), "Content-Type": file.content_type},
                content=content,
            )
            if resp.status_code not in (200, 201):
                raise HTTPException(status_code=500, detail=f"Error subiendo a Supabase: {resp.text[:200]}")
    except httpx.RequestError as e:
        raise HTTPException(status_code=500, detail=f"Error de conexión con Supabase: {str(e)}")

    # Guardar en BD
    photo = models.Photo(
        tournament_id=tid,
        url=_public_url(filename),
        storage_path=filename,
        caption=caption.strip(),
    )
    db.add(photo)
    db.commit()
    db.refresh(photo)

    return {
        "id": photo.id,
        "url": photo.url,
        "caption": photo.caption,
        "storage_path": photo.storage_path,
        "created_at": photo.created_at.isoformat(),
    }


@router.delete("/{photo_id}")
async def delete_photo(
    photo_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    photo = db.query(models.Photo).filter(models.Photo.id == photo_id).first()
    if not photo:
        raise HTTPException(status_code=404, detail="Foto no encontrada")

    # Eliminar de Supabase Storage
    async with httpx.AsyncClient() as client:
        await client.delete(
            f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{photo.storage_path}",
            headers=_supabase_headers(),
        )

    db.delete(photo)
    db.commit()
    return {"message": "Foto eliminada"}