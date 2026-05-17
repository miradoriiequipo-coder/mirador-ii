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
        "status": p.status or "activo",
        "joined_at_match": p.joined_at_match,
    }
    if is_admin:
        data["id_number"] = p.id_number
        data["created_at"] = p.created_at.isoformat() if p.created_at else None
    return data


@router.get("")
def list_players(
    t: Optional[int] = Query(None),
    include_inactive: bool = Query(False),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    is_admin = bool(current_user and current_user.is_admin)
    tid = _get_tournament_id(t, db)
    q = db.query(models.Player)
    if tid:
        q = q.filter(models.Player.tournament_id == tid)
    # Público: solo activos. Admin puede pedir todos
    if not (is_admin and include_inactive):
        q = q.filter(models.Player.is_active == True)
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

    is_new = body.get("is_new_player", False)
    joined_at_match = int(body.get("joined_at_match", 0)) if is_new else None

    player = models.Player(
        tournament_id=tid,
        id_number=body.get("id_number"),
        full_name=body.get("full_name"),
        player_number=body.get("player_number"),
        phone=body.get("phone"),
        health_info=body.get("health_info"),
        photo_url=body.get("photo_url"),
        status="nuevo" if is_new else "activo",
        joined_at_match=joined_at_match,
    )
    db.add(player)
    db.flush()

    # Si es jugador nuevo, calcular deuda proporcional automáticamente
    if is_new and joined_at_match:
        _assign_proportional_debt(player, tid, joined_at_match, db)

    db.commit()
    db.refresh(player)

    # Cambiar status a "activo" después de asignar deudas proporcionales
    if is_new:
        player.status = "activo"
        db.commit()
        db.refresh(player)

    return _serialize_player(player, True)


def _assign_proportional_debt(player: models.Player, tid: int, joined_at_match: int, db: Session):
    """Calcula y asigna deuda proporcional al jugador nuevo."""

    # Inscripción proporcional
    insc = db.query(models.InscripcionConfig).filter(
        models.InscripcionConfig.tournament_id == tid
    ).order_by(models.InscripcionConfig.created_at.desc()).first()

    if insc and insc.total_matches and insc.total_matches > 0:
        matches_remaining = max(0, insc.total_matches - joined_at_match + 1)
        prop_insc = round((insc.amount_per_player * matches_remaining) / insc.total_matches, 0)
        if prop_insc > 0:
            db.add(models.Deuda(
                tournament_id=tid,
                player_id=player.id,
                tipo="inscripcion",
                monto=prop_insc,
                concepto=f"Inscripción proporcional — entra en partido {joined_at_match} de {insc.total_matches} ({matches_remaining} restantes)",
                config_id=insc.id,
                config_tipo="inscripcion",
            ))

    # Arbitrajes: solo las fases futuras (donde started_at_match <= joined_at_match)
    # No asignamos fases pasadas — esas ya se jugaron sin el jugador
    # Las fases futuras se asignarán automáticamente cuando el admin las configure


def _update_player_status(player: models.Player, new_status: str, db: Session):
    """Cambia el estado del jugador. Lesionado e inactivo no reciben nuevas deudas."""
    old_status = player.status
    player.status = new_status

    if new_status in ("inactivo",):
        player.is_active = False
    elif new_status == "lesionado":
        player.is_active = True  # sigue en plantilla pero no recibe deudas
    elif new_status == "activo":
        player.is_active = True

    db.commit()
    db.refresh(player)
    return player


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

    allowed = ["id_number", "full_name", "player_number", "phone", "health_info", "photo_url"]
    for field in allowed:
        if field in body and body[field] is not None:
            setattr(player, field, body[field])

    # Cambio de estado
    if "status" in body:
        new_status = body["status"]
        if new_status not in ("activo", "lesionado", "inactivo"):
            raise HTTPException(status_code=400, detail="Estado inválido")
        player.status = new_status
        if new_status == "inactivo":
            player.is_active = False
        else:
            player.is_active = True

    db.commit()
    db.refresh(player)
    return _serialize_player(player, True)


@router.patch("/{player_id}/status")
def change_status(
    player_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    """Endpoint rápido para cambiar solo el estado del jugador."""
    player = db.query(models.Player).filter(models.Player.id == player_id).first()
    if not player:
        raise HTTPException(status_code=404, detail="Jugador no encontrado")

    new_status = body.get("status")
    if new_status not in ("activo", "lesionado", "inactivo"):
        raise HTTPException(status_code=400, detail="Estado debe ser: activo, lesionado o inactivo")

    player.status = new_status
    player.is_active = new_status != "inactivo"
    db.commit()
    db.refresh(player)

    labels = {"activo": "Activo", "lesionado": "Lesionado", "inactivo": "Inactivo"}
    return {"message": f"{player.full_name} marcado como {labels[new_status]}", **_serialize_player(player, True)}


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
    player.status = "inactivo"
    db.commit()
    return {"message": f"Jugador {player.full_name} desactivado"}