from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from typing import Optional
from .. import models
from ..database import get_db
from ..auth import get_current_user, require_admin

router = APIRouter(tags=["matches"])


def _get_tournament_id(t: Optional[int], db: Session) -> Optional[int]:
    if t:
        return t
    active = db.query(models.Tournament).filter(models.Tournament.is_active == True).first()
    return active.id if active else None


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


@router.get("/matches")
def list_matches(
    t: Optional[int] = Query(None),
    db: Session = Depends(get_db)
):
    tid = _get_tournament_id(t, db)
    q = db.query(models.Match).options(
        joinedload(models.Match.goals).joinedload(models.Goal.player),
        joinedload(models.Match.goals).joinedload(models.Goal.assist_player),
    )
    if tid:
        q = q.filter(models.Match.tournament_id == tid)
    matches = q.order_by(models.Match.match_date.desc()).all()
    return [_match_response(m) for m in matches]


@router.get("/matches/{match_id}")
def get_match(match_id: int, db: Session = Depends(get_db)):
    m = db.query(models.Match).options(
        joinedload(models.Match.goals).joinedload(models.Goal.player),
        joinedload(models.Match.goals).joinedload(models.Goal.assist_player),
    ).filter(models.Match.id == match_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Partido no encontrado")
    return _match_response(m)


@router.post("/matches")
def create_match(
    body: dict,
    t: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    tid = _get_tournament_id(t, db)
    if not tid:
        raise HTTPException(status_code=400, detail="No hay torneo activo. Crea uno primero.")
    from datetime import datetime
    match = models.Match(
        tournament_id=tid,
        opponent=body.get("opponent"),
        match_date=datetime.fromisoformat(body.get("match_date").replace("Z", "")),
        location=body.get("location"),
        phase=body.get("phase"),
        notes=body.get("notes"),
    )
    db.add(match)
    db.commit()
    db.refresh(match)
    return get_match(match.id, db)


@router.put("/matches/{match_id}")
def update_match(
    match_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    match = db.query(models.Match).filter(models.Match.id == match_id).first()
    if not match:
        raise HTTPException(status_code=404, detail="Partido no encontrado")
    allowed = ["opponent","match_date","location","phase","notes","is_played","home_score","away_score"]
    for field in allowed:
        if field in body:
            val = body[field]
            if field == "match_date" and val:
                from datetime import datetime
                val = datetime.fromisoformat(str(val).replace("Z", ""))
            setattr(match, field, val)
    db.commit()
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


@router.post("/matches/{match_id}/goals")
def add_goal(
    match_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    match = db.query(models.Match).filter(models.Match.id == match_id).first()
    if not match:
        raise HTTPException(status_code=404, detail="Partido no encontrado")
    goal = models.Goal(
        match_id=match_id,
        player_id=body.get("player_id"),
        count=body.get("count", 1),
        assist_player_id=body.get("assist_player_id"),
        minute=body.get("minute"),
    )
    db.add(goal)
    db.commit()
    db.refresh(goal)
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