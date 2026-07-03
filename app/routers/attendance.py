from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from .. import models
from ..database import get_db
from ..auth import require_admin

router = APIRouter(prefix="/matches", tags=["attendance"])


@router.get("/{match_id}/attendance")
def get_attendance(match_id: int, t: int = None, db: Session = Depends(get_db)):
    """Retorna la lista de jugadores con su estado de asistencia para un partido."""
    match = db.query(models.Match).filter(models.Match.id == match_id).first()
    if not match:
        raise HTTPException(status_code=404, detail="Partido no encontrado")

    tid = t or match.tournament_id
    players = db.query(models.Player).filter(
        models.Player.tournament_id == tid,
        models.Player.is_active == True,
        models.Player.status == "activo",
    ).order_by(models.Player.player_number).all()

    attendance_records = db.query(models.Attendance).filter(
        models.Attendance.match_id == match_id
    ).all()
    attendance_map = {a.player_id: a.status for a in attendance_records}

    result = []
    for p in players:
        result.append({
            "player_id": p.id,
            "player_number": p.player_number,
            "full_name": p.full_name,
            "status": attendance_map.get(p.id, "pending"),  # confirmed / declined / pending
        })

    confirmed = sum(1 for r in result if r["status"] == "confirmed")
    declined  = sum(1 for r in result if r["status"] == "declined")
    pending   = sum(1 for r in result if r["status"] == "pending")

    return {
        "match_id": match_id,
        "players": result,
        "confirmed": confirmed,
        "declined": declined,
        "pending": pending,
        "total": len(result),
    }


@router.post("/{match_id}/attendance")
def set_attendance(
    match_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    """Admin registra asistencia de un jugador."""
    player_id = body.get("player_id")
    status    = body.get("status", "confirmed")

    if not player_id:
        raise HTTPException(status_code=400, detail="player_id requerido")
    if status not in ("confirmed", "declined"):
        raise HTTPException(status_code=400, detail="status inválido")

    match = db.query(models.Match).filter(models.Match.id == match_id).first()
    if not match:
        raise HTTPException(status_code=404, detail="Partido no encontrado")

    existing = db.query(models.Attendance).filter(
        models.Attendance.match_id == match_id,
        models.Attendance.player_id == player_id,
    ).first()

    if existing:
        existing.status = status
    else:
        db.add(models.Attendance(match_id=match_id, player_id=player_id, status=status))

    db.commit()
    return {"success": True, "status": status}


@router.delete("/{match_id}/attendance/{player_id}")
def remove_attendance(
    match_id: int,
    player_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    """Admin puede borrar una confirmación."""
    rec = db.query(models.Attendance).filter(
        models.Attendance.match_id == match_id,
        models.Attendance.player_id == player_id,
    ).first()
    if rec:
        db.delete(rec)
        db.commit()
    return {"success": True}


@router.get("/{match_id}/attendance/stats")
def attendance_stats(match_id: int, db: Session = Depends(get_db)):
    """Stats de asistencia para mostrar en el partido jugado."""
    records = db.query(models.Attendance).filter(
        models.Attendance.match_id == match_id,
        models.Attendance.status == "confirmed",
    ).all()
    return [{"player_id": r.player_id} for r in records]


# ── Stats globales por jugador ────────────────────────────────────
@router.get("/attendance/player-stats")
def player_attendance_stats(t: int = None, db: Session = Depends(get_db)):
    """Retorna stats de asistencia de todos los jugadores del torneo."""
    players_q = db.query(models.Player).filter(models.Player.is_active == True)
    if t:
        players_q = players_q.filter(models.Player.tournament_id == t)
    players = players_q.all()

    # Partidos jugados o programados del torneo
    matches_q = db.query(models.Match)
    if t:
        matches_q = matches_q.filter(models.Match.tournament_id == t)
    total_matches = matches_q.count()

    result = []
    for p in players:
        confirmed = db.query(models.Attendance).filter(
            models.Attendance.player_id == p.id,
            models.Attendance.status == "confirmed",
        ).count()
        declined = db.query(models.Attendance).filter(
            models.Attendance.player_id == p.id,
            models.Attendance.status == "declined",
        ).count()
        result.append({
            "player_id": p.id,
            "player_number": p.player_number,
            "full_name": p.full_name,
            "confirmed": confirmed,
            "declined": declined,
            "total_matches": total_matches,
            "pct": round(confirmed / total_matches * 100) if total_matches > 0 else 0,
        })

    return sorted(result, key=lambda x: -x["confirmed"])