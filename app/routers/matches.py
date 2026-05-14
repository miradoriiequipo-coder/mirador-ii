from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from typing import List
from .. import models, schemas
from ..database import get_db
from ..auth import get_current_user, require_admin

router = APIRouter(tags=["matches"])


def _goal_detail(g: models.Goal) -> dict:
    return {
        "id": g.id,
        "player_id": g.player_id,
        "player_name": g.player.full_name if g.player else "—",
        "player_number": g.player.player_number if g.player else 0,
        "count": g.count,
        "minute": g.minute,
        "assist_player_id": g.assist_player_id,
        "assist_player_name": g.assist_player.full_name if g.assist_player else None,
    }


def _match_response(m: models.Match) -> dict:
    return {
        "id": m.id,
        "opponent": m.opponent,
        "match_date": m.match_date.isoformat(),
        "location": m.location,
        "phase": m.phase,
        "notes": m.notes,
        "is_played": m.is_played,
        "home_score": m.home_score,
        "away_score": m.away_score,
        "created_at": m.created_at.isoformat(),
        "goals": [_goal_detail(g) for g in m.goals],
    }


# ─── Matches CRUD ────────────────────────────────────────────────────────────

@router.get("/matches")
def list_matches(db: Session = Depends(get_db)):
    matches = (
        db.query(models.Match)
        .options(
            joinedload(models.Match.goals).joinedload(models.Goal.player),
            joinedload(models.Match.goals).joinedload(models.Goal.assist_player),
        )
        .order_by(models.Match.match_date)
        .all()
    )
    return [_match_response(m) for m in matches]


@router.get("/matches/{match_id}")
def get_match(match_id: int, db: Session = Depends(get_db)):
    m = (
        db.query(models.Match)
        .options(
            joinedload(models.Match.goals).joinedload(models.Goal.player),
            joinedload(models.Match.goals).joinedload(models.Goal.assist_player),
        )
        .filter(models.Match.id == match_id)
        .first()
    )
    if not m:
        raise HTTPException(status_code=404, detail="Partido no encontrado")
    return _match_response(m)


@router.post("/matches")
def create_match(
    body: schemas.MatchCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    match = models.Match(**body.model_dump())
    db.add(match)
    db.commit()
    db.refresh(match)
    return _match_response(match)


@router.put("/matches/{match_id}")
def update_match(
    match_id: int,
    body: schemas.MatchUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    match = db.query(models.Match).filter(models.Match.id == match_id).first()
    if not match:
        raise HTTPException(status_code=404, detail="Partido no encontrado")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(match, field, value)
    db.commit()
    db.refresh(match)
    # reload with goals
    return get_match(match_id, db)


@router.delete("/matches/{match_id}")
def delete_match(
    match_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    match = db.query(models.Match).filter(models.Match.id == match_id).first()
    if not match:
        raise HTTPException(status_code=404, detail="Partido no encontrado")
    db.delete(match)
    db.commit()
    return {"message": "Partido eliminado"}


# ─── Goals ───────────────────────────────────────────────────────────────────

@router.post("/matches/{match_id}/goals")
def add_goal(
    match_id: int,
    body: schemas.GoalCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    match = db.query(models.Match).filter(models.Match.id == match_id).first()
    if not match:
        raise HTTPException(status_code=404, detail="Partido no encontrado")
    player = db.query(models.Player).filter(models.Player.id == body.player_id).first()
    if not player:
        raise HTTPException(status_code=404, detail="Jugador no encontrado")
    
    goal = models.Goal(match_id=match_id, **body.model_dump())
    db.add(goal)
    db.commit()
    db.refresh(goal)
    # reload relationships
    goal = db.query(models.Goal).options(
        joinedload(models.Goal.player),
        joinedload(models.Goal.assist_player),
    ).filter(models.Goal.id == goal.id).first()
    return _goal_detail(goal)


@router.delete("/goals/{goal_id}")
def delete_goal(
    goal_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    goal = db.query(models.Goal).filter(models.Goal.id == goal_id).first()
    if not goal:
        raise HTTPException(status_code=404, detail="Gol no encontrado")
    db.delete(goal)
    db.commit()
    return {"message": "Gol eliminado"}
