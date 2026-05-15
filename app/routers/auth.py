from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from .. import models, schemas
from ..database import get_db
from ..auth import verify_password, create_access_token, hash_password, get_current_user, require_admin
import os

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=schemas.Token)
def login(request: schemas.LoginRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.username == request.username).first()
    if not user or not verify_password(request.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario o contraseña incorrectos",
        )
    token = create_access_token({"sub": user.username})
    return {"access_token": token, "token_type": "bearer", "is_admin": user.is_admin}


@router.post("/setup", include_in_schema=False)
def setup_admin(db: Session = Depends(get_db)):
    """Crea el admin inicial. Usar solo una vez al desplegar."""
    existing = db.query(models.User).filter(models.User.username == "admin").first()
    if existing:
        raise HTTPException(status_code=400, detail="El admin ya existe")
    
    default_pass = os.getenv("ADMIN_PASSWORD", "Mirador2026")
    user = models.User(
        username="admin",
        hashed_password=hash_password(default_pass),
        is_admin=True,
    )
    db.add(user)
    db.commit()
    return {"message": "Admin creado", "username": "admin", "password": default_pass}


@router.put("/change-password")
def change_password(
    body: dict,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    new_pass = body.get("new_password")
    if not new_pass or len(new_pass) < 6:
        raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 6 caracteres")
    current_user.hashed_password = hash_password(new_pass)
    db.commit()
    return {"message": "Contraseña actualizada"}


@router.get("/me")
def me(current_user=Depends(get_current_user)):
    if not current_user:
        return {"authenticated": False, "is_admin": False}
    return {"authenticated": True, "is_admin": current_user.is_admin, "username": current_user.username}
