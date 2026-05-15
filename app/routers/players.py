from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional
from .. import models
from ..database import get_db
from ..auth import get_current_user, require_admin

router = APIRouter(prefix="/players", tags=["players"])


def _get_tournament_id(t: Optional[int], db: Session) -> Optional[int]:
    if t:
        return t
    active = db.query(models.Tournament).filter(models.Tournament.is_active == True).first()
    return active.id if active else None


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


@router.get("")
def list_players(
    t: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    is_admin = bool(current_user and current_user.is_admin)
    tid = _get_tournament_id(t, db)
    q = db.query(models.Player).filter(models.Player.is_active == True)
    if tid:
        q = q.filter(models.Player.tournament_id == tid)
    players = q.order_by(models.Player.player_number).all()
    return [_serialize_player(p, is_admin) for p in players]


@router.post("")
def create_player(
    body: dict,
    t: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    tid = _get_tournament_id(t, db)
    if not tid:
        raise HTTPException(status_code=400, detail="No hay torneo activo. Crea uno primero.")

    existing = db.query(models.Player).filter(
        models.Player.id_number == body.get("id_number"),
        models.Player.tournament_id == tid
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Ya existe un jugador con esa cédula en este torneo")

    player = models.Player(
        tournament_id=tid,
        id_number=body.get("id_number"),
        full_name=body.get("full_name"),
        player_number=body.get("player_number"),
        phone=body.get("phone"),
        health_info=body.get("health_info"),
        photo_url=body.get("photo_url"),
    )
    db.add(player)
    db.commit()
    db.refresh(player)
    return _serialize_player(player, True)


@router.put("/{player_id}")
def update_player(
    player_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    player = db.query(models.Player).filter(models.Player.id == player_id).first()
    if not player:
        raise HTTPException(status_code=404, detail="Jugador no encontrado")
    allowed = ["id_number","full_name","player_number","phone","health_info","photo_url","is_active"]
    for field in allowed:
        if field in body and body[field] is not None:
            setattr(player, field, body[field])
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