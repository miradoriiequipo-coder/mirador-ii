from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session
from typing import List
from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/matches", tags=["votes"])


@router.get("/{match_id}/votes")
def get_votes(match_id: int, db: Session = Depends(get_db)):
    results = (
        db.query(
            models.Vote.player_id,
            models.Player.full_name,
            models.Player.player_number,
            func.count(models.Vote.id).label("vote_count"),
        )
        .join(models.Player, models.Vote.player_id == models.Player.id)
        .filter(models.Vote.match_id == match_id)
        .group_by(models.Vote.player_id, models.Player.full_name, models.Player.player_number)
        .order_by(func.count(models.Vote.id).desc())
        .all()
    )
    total = sum(r.vote_count for r in results)
    return [
        {
            "player_id": r.player_id,
            "player_name": r.full_name,
            "player_number": r.player_number,
            "vote_count": r.vote_count,
            "percentage": round((r.vote_count / total * 100) if total > 0 else 0, 1),
        }
        for r in results
    ]


@router.post("/{match_id}/votes")
def cast_vote(
    match_id: int,
    body: schemas.VoteCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    match = db.query(models.Match).filter(models.Match.id == match_id).first()
    if not match:
        raise HTTPException(status_code=404, detail="Partido no encontrado")
    if not match.is_played:
        raise HTTPException(status_code=400, detail="Solo se puede votar por partidos ya jugados")

    # Obtener IP real (considera proxies de Render/Cloudflare)
    voter_ip = request.headers.get("X-Forwarded-For", request.client.host)
    voter_ip = voter_ip.split(",")[0].strip()

    already_voted = (
        db.query(models.Vote)
        .filter(models.Vote.match_id == match_id, models.Vote.voter_ip == voter_ip)
        .first()
    )
    if already_voted:
        raise HTTPException(status_code=409, detail="Ya votaste en este partido")

    player = db.query(models.Player).filter(models.Player.id == body.player_id).first()
    if not player:
        raise HTTPException(status_code=404, detail="Jugador no encontrado")

    vote = models.Vote(match_id=match_id, player_id=body.player_id, voter_ip=voter_ip)
    db.add(vote)
    db.commit()
    return {"message": f"¡Voto registrado para {player.full_name}!"}
