from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from .. import models, schemas
from ..database import get_db
from ..auth import get_current_user, require_admin

router = APIRouter(prefix="/players", tags=["players"])


def _serialize_player(p: models.Player, is_admin: bool) -> dict:
    data = {
        "id": p.id,
        "full_name": p.full_name,
        "player_number": p.player_number,
        "phone": p.phone,
        "health_info": p.health_info,
        "photo_url": p.photo_url,
        "is_active": p.is_active,
    }
    if is_admin:
        data["id_number"] = p.id_number
        data["created_at"] = p.created_at.isoformat() if p.created_at else None
    return data


@router.get("/")
def list_players(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    is_admin = bool(current_user and current_user.is_admin)
    players = (
        db.query(models.Player)
        .filter(models.Player.is_active == True)
        .order_by(models.Player.player_number)
        .all()
    )
    return [_serialize_player(p, is_admin) for p in players]


@router.get("/all")
def list_all_players(
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    """Admin: incluye jugadores inactivos"""
    players = db.query(models.Player).order_by(models.Player.player_number).all()
    return [_serialize_player(p, True) for p in players]


@router.post("/")
def create_player(
    body: schemas.PlayerCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    existing = db.query(models.Player).filter(models.Player.id_number == body.id_number).first()
    if existing:
        raise HTTPException(status_code=400, detail="Ya existe un jugador con esa cédula")
    
    player = models.Player(**body.model_dump())
    db.add(player)
    db.commit()
    db.refresh(player)
    return _serialize_player(player, True)


@router.put("/{player_id}")
def update_player(
    player_id: int,
    body: schemas.PlayerUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    player = db.query(models.Player).filter(models.Player.id == player_id).first()
    if not player:
        raise HTTPException(status_code=404, detail="Jugador no encontrado")
    
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(player, field, value)
    db.commit()
    db.refresh(player)
    return _serialize_player(player, True)


@router.delete("/{player_id}")
def deactivate_player(
    player_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    player = db.query(models.Player).filter(models.Player.id == player_id).first()
    if not player:
        raise HTTPException(status_code=404, detail="Jugador no encontrado")
    player.is_active = False
    db.commit()
    return {"message": f"Jugador {player.full_name} desactivado"}
