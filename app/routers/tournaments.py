from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime
from .. import models
from ..database import get_db
from ..auth import require_admin

router = APIRouter(prefix="/tournaments", tags=["tournaments"])


def _serialize(t: models.Tournament) -> dict:
    return {
        "id": t.id,
        "name": t.name,
        "season": t.season,
        "description": t.description,
        "is_active": t.is_active,
        "created_at": t.created_at.isoformat(),
        "closed_at": t.closed_at.isoformat() if t.closed_at else None,
    }


@router.get("")
def list_tournaments(db: Session = Depends(get_db)):
    tournaments = db.query(models.Tournament).order_by(models.Tournament.created_at.desc()).all()
    return [_serialize(t) for t in tournaments]


@router.get("/active")
def get_active(db: Session = Depends(get_db)):
    t = db.query(models.Tournament).filter(models.Tournament.is_active == True).first()
    if not t:
        return None
    return _serialize(t)


@router.post("")
def create_tournament(
    body: dict,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    name = body.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="El nombre del torneo es obligatorio")

    # Cerrar el torneo activo actual
    current = db.query(models.Tournament).filter(models.Tournament.is_active == True).first()
    if current:
        current.is_active = False
        current.closed_at = datetime.utcnow()

    # Crear nuevo torneo activo
    tournament = models.Tournament(
        name=name,
        season=body.get("season", "").strip() or None,
        description=body.get("description", "").strip() or None,
        is_active=True,
    )
    db.add(tournament)
    db.commit()
    db.refresh(tournament)
    return _serialize(tournament)


@router.get("/{tournament_id}/stats")
def get_tournament_stats(tournament_id: int, db: Session = Depends(get_db)):
    """Resumen rápido de un torneo para mostrar en el historial."""
    t = db.query(models.Tournament).filter(models.Tournament.id == tournament_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Torneo no encontrado")

    players = db.query(models.Player).filter(
        models.Player.tournament_id == tournament_id,
        models.Player.is_active == True
    ).count()

    matches_played = db.query(models.Match).filter(
        models.Match.tournament_id == tournament_id,
        models.Match.is_played == True
    ).count()

    matches_total = db.query(models.Match).filter(
        models.Match.tournament_id == tournament_id
    ).count()

    # Récord W/D/L
    matches = db.query(models.Match).filter(
        models.Match.tournament_id == tournament_id,
        models.Match.is_played == True
    ).all()
    wins = sum(1 for m in matches if m.home_score is not None and m.home_score > m.away_score)
    draws = sum(1 for m in matches if m.home_score is not None and m.home_score == m.away_score)
    losses = sum(1 for m in matches if m.home_score is not None and m.home_score < m.away_score)

    goals_scored = sum(m.home_score or 0 for m in matches)
    goals_against = sum(m.away_score or 0 for m in matches)

    total_recaudado = sum(
        p.amount for p in db.query(models.Payment).filter(
            models.Payment.tournament_id == tournament_id
        ).all()
    )

    return {
        **_serialize(t),
        "players": players,
        "matches_played": matches_played,
        "matches_total": matches_total,
        "wins": wins,
        "draws": draws,
        "losses": losses,
        "goals_scored": goals_scored,
        "goals_against": goals_against,
        "total_recaudado": total_recaudado,
    }