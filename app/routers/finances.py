from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional
from .. import models
from ..database import get_db
from ..auth import require_admin

router = APIRouter(prefix="/finances", tags=["finances"])


def _get_tid(t: Optional[int], db: Session) -> Optional[int]:
    if t:
        return t
    active = db.query(models.Tournament).filter(models.Tournament.is_active == True).first()
    return active.id if active else None


def _eligible_players(tid: int, db: Session):
    """Jugadores que reciben nuevas deudas: activos y NO lesionados/inactivos."""
    return db.query(models.Player).filter(
        models.Player.tournament_id == tid,
        models.Player.is_active == True,
        models.Player.status == "activo",
    ).all()


@router.get("/summary")
def get_summary(t: Optional[int] = Query(None), db: Session = Depends(get_db)):
    tid = _get_tid(t, db)
    # Incluir todos los jugadores del torneo (activos, lesionados, inactivos)
    q = db.query(models.Player)
    if tid:
        q = q.filter(models.Player.tournament_id == tid)
    players = q.order_by(models.Player.player_number).all()

    result = []
    for p in players:
        deudas = [d for d in p.deudas if d.tournament_id == tid] if tid else p.deudas
        pagos  = [pay for pay in p.payments if pay.tournament_id == tid] if tid else p.payments

        deuda_insc  = sum(d.monto for d in deudas if d.tipo == "inscripcion")
        deuda_arb   = sum(d.monto for d in deudas if d.tipo == "arbitraje")
        deuda_manual= sum(d.monto for d in deudas if d.tipo == "manual")
        deuda_total = deuda_insc + deuda_arb + deuda_manual
        pago_insc   = sum(pay.amount for pay in pagos if pay.payment_type == "inscripcion")
        pago_arb    = sum(pay.amount for pay in pagos if pay.payment_type == "arbitraje")
        pago_total  = pago_insc + pago_arb + sum(pay.amount for pay in pagos if pay.payment_type == "manual")

        result.append({
            "player_id": p.id,
            "player_name": p.full_name,
            "player_number": p.player_number,
            "status": p.status or "activo",
            "is_active": p.is_active,
            "deuda_inscripcion": deuda_insc,
            "deuda_arbitraje": deuda_arb,
            "deuda_manual": deuda_manual,
            "deuda_total": deuda_total,
            "pagado_total": pago_total,
            "saldo_pendiente": deuda_total - pago_total,
            "deudas": [{"id":d.id,"tipo":d.tipo,"fase":d.fase,"monto":d.monto,"concepto":d.concepto,"created_at":d.created_at.isoformat()} for d in deudas],
            "payments": [{"id":pay.id,"tipo":pay.payment_type,"fase":pay.phase,"monto":pay.amount,"notas":pay.notes,"created_at":pay.created_at.isoformat()} for pay in pagos],
        })
    return result


@router.get("/configs")
def get_configs(t: Optional[int] = Query(None), db: Session = Depends(get_db)):
    tid = _get_tid(t, db)
    q_insc = db.query(models.InscripcionConfig)
    q_arb  = db.query(models.ArbitrajePhase)
    if tid:
        q_insc = q_insc.filter(models.InscripcionConfig.tournament_id == tid)
        q_arb  = q_arb.filter(models.ArbitrajePhase.tournament_id == tid)
    return {
        "inscripciones": [{"id":c.id,"total_amount":c.total_amount,"num_players":c.num_players,"amount_per_player":c.amount_per_player,"total_matches":c.total_matches,"notes":c.notes,"created_at":c.created_at.isoformat()} for c in q_insc.all()],
        "arbitrajes":    [{"id":a.id,"fase":a.fase,"num_games":a.num_games,"price_per_game":a.price_per_game,"num_players":a.num_players,"total_phase":a.total_phase,"amount_per_player":a.amount_per_player,"notes":a.notes,"created_at":a.created_at.isoformat()} for a in q_arb.all()],
    }


@router.post("/inscripcion-config")
def create_inscripcion_config(body: dict, t: Optional[int] = Query(None), db: Session = Depends(get_db), current_user=Depends(require_admin)):
    tid = _get_tid(t, db)
    if not tid:
        raise HTTPException(status_code=400, detail="No hay torneo activo")
    total_amount = float(body.get("total_amount", 0))
    total_matches = int(body.get("total_matches", 0)) or None
    if total_amount <= 0:
        raise HTTPException(status_code=400, detail="El monto total debe ser mayor a 0")

    # Solo jugadores activos (no lesionados ni inactivos)
    players = _eligible_players(tid, db)
    if not players:
        raise HTTPException(status_code=400, detail="No hay jugadores activos en este torneo")

    num_players = len(players)
    amount_per_player = round(total_amount / num_players, 0)

    config = models.InscripcionConfig(
        tournament_id=tid,
        total_amount=total_amount,
        num_players=num_players,
        amount_per_player=amount_per_player,
        total_matches=total_matches,
        notes=body.get("notes", ""),
    )
    db.add(config)
    db.flush()

    concepto = f"Inscripción — ${int(total_amount):,} ÷ {num_players} jugadores"
    if total_matches:
        concepto += f" ({total_matches} partidos totales)"

    for player in players:
        db.add(models.Deuda(
            tournament_id=tid,
            player_id=player.id,
            tipo="inscripcion",
            monto=amount_per_player,
            concepto=concepto,
            config_id=config.id,
            config_tipo="inscripcion",
        ))
    db.commit()
    return {
        "message": f"Inscripción configurada. {num_players} jugadores activos. Cada uno debe ${int(amount_per_player):,}",
        "amount_per_player": amount_per_player,
        "num_players": num_players,
        "excluded_note": "Jugadores lesionados e inactivos no recibieron esta deuda."
    }


@router.delete("/inscripcion-config/{config_id}")
def delete_inscripcion_config(config_id: int, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    db.query(models.Deuda).filter(models.Deuda.config_id == config_id, models.Deuda.config_tipo == "inscripcion").delete()
    config = db.query(models.InscripcionConfig).filter(models.InscripcionConfig.id == config_id).first()
    if config:
        db.delete(config)
    db.commit()
    return {"message": "Configuración eliminada"}


@router.post("/arbitraje-phase")
def create_arbitraje_phase(body: dict, t: Optional[int] = Query(None), db: Session = Depends(get_db), current_user=Depends(require_admin)):
    tid = _get_tid(t, db)
    if not tid:
        raise HTTPException(status_code=400, detail="No hay torneo activo")
    fase = body.get("fase", "").strip()
    num_games = int(body.get("num_games", 0))
    price_per_game = float(body.get("price_per_game", 0))
    if not fase or num_games <= 0 or price_per_game <= 0:
        raise HTTPException(status_code=400, detail="Fase, partidos y precio son obligatorios")

    # Solo jugadores activos — lesionados e inactivos NO reciben esta deuda
    players = _eligible_players(tid, db)
    if not players:
        raise HTTPException(status_code=400, detail="No hay jugadores activos en este torneo")

    num_players = len(players)
    total_phase = num_games * price_per_game
    amount_per_player = round(total_phase / num_players, 0)

    phase_config = models.ArbitrajePhase(
        tournament_id=tid,
        fase=fase,
        num_games=num_games,
        price_per_game=price_per_game,
        num_players=num_players,
        total_phase=total_phase,
        amount_per_player=amount_per_player,
        notes=body.get("notes", ""),
    )
    db.add(phase_config)
    db.flush()

    concepto = f"Arbitraje {fase} — {num_games} partidos × ${int(price_per_game):,} ÷ {num_players} jugadores activos"
    for player in players:
        db.add(models.Deuda(
            tournament_id=tid,
            player_id=player.id,
            tipo="arbitraje",
            fase=fase,
            monto=amount_per_player,
            concepto=concepto,
            config_id=phase_config.id,
            config_tipo="arbitraje",
        ))
    db.commit()

    excluded = db.query(models.Player).filter(
        models.Player.tournament_id == tid,
        models.Player.status.in_(["lesionado", "inactivo"]),
    ).count()

    return {
        "message": f"{fase}: {num_players} jugadores activos deben ${int(amount_per_player):,} c/u",
        "amount_per_player": amount_per_player,
        "excluded_players": excluded,
        "excluded_note": f"{excluded} jugador(es) lesionado(s)/inactivo(s) no recibieron esta deuda." if excluded else ""
    }


@router.delete("/arbitraje-phase/{phase_id}")
def delete_arbitraje_phase(phase_id: int, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    db.query(models.Deuda).filter(models.Deuda.config_id == phase_id, models.Deuda.config_tipo == "arbitraje").delete()
    phase = db.query(models.ArbitrajePhase).filter(models.ArbitrajePhase.id == phase_id).first()
    if phase:
        db.delete(phase)
    db.commit()
    return {"message": "Fase eliminada"}


@router.post("/deuda-manual")
def add_deuda_manual(body: dict, t: Optional[int] = Query(None), db: Session = Depends(get_db), current_user=Depends(require_admin)):
    """Agregar deuda manual a un jugador específico (jugador nuevo, ajuste, etc.)."""
    tid = _get_tid(t, db)
    player_id = int(body.get("player_id", 0))
    monto = float(body.get("monto", 0))
    concepto = body.get("concepto", "").strip()
    tipo = body.get("tipo", "manual")

    if not player_id or monto <= 0:
        raise HTTPException(status_code=400, detail="Jugador y monto son obligatorios")

    player = db.query(models.Player).filter(models.Player.id == player_id).first()
    if not player:
        raise HTTPException(status_code=404, detail="Jugador no encontrado")

    db.add(models.Deuda(
        tournament_id=tid,
        player_id=player_id,
        tipo=tipo if tipo in ("inscripcion","arbitraje","manual") else "manual",
        fase=body.get("fase"),
        monto=monto,
        concepto=concepto or f"Deuda manual — {player.full_name}",
        config_id=None,
        config_tipo="manual",
    ))
    db.commit()
    return {"message": f"Deuda de ${int(monto):,} asignada a {player.full_name}"}


@router.delete("/deuda/{deuda_id}")
def delete_deuda(deuda_id: int, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    deuda = db.query(models.Deuda).filter(models.Deuda.id == deuda_id).first()
    if not deuda:
        raise HTTPException(status_code=404, detail="Deuda no encontrada")
    db.delete(deuda)
    db.commit()
    return {"message": "Deuda eliminada"}


@router.post("/payment")
def add_payment(body: dict, t: Optional[int] = Query(None), db: Session = Depends(get_db), current_user=Depends(require_admin)):
    tid = _get_tid(t, db)
    player_id = int(body.get("player_id", 0))
    payment_type = body.get("payment_type", "")
    amount = float(body.get("amount", 0))
    if not player_id or not payment_type or amount <= 0:
        raise HTTPException(status_code=400, detail="Jugador, tipo y monto son obligatorios")
    player = db.query(models.Player).filter(models.Player.id == player_id).first()
    if not player:
        raise HTTPException(status_code=404, detail="Jugador no encontrado")
    db.add(models.Payment(
        tournament_id=tid,
        player_id=player_id,
        payment_type=payment_type,
        phase=body.get("phase"),
        amount=amount,
        notes=body.get("notes", ""),
    ))
    db.commit()
    return {"message": f"Pago de ${int(amount):,} registrado para {player.full_name}"}


@router.delete("/payment/{payment_id}")
def delete_payment(payment_id: int, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    payment = db.query(models.Payment).filter(models.Payment.id == payment_id).first()
    if not payment:
        raise HTTPException(status_code=404, detail="Pago no encontrado")
    db.delete(payment)
    db.commit()
    return {"message": "Pago eliminado"}