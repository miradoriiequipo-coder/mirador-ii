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


@router.get("/summary")
def get_summary(t: Optional[int] = Query(None), db: Session = Depends(get_db)):
    tid = _get_tid(t, db)
    q = db.query(models.Player).filter(models.Player.is_active == True)
    if tid:
        q = q.filter(models.Player.tournament_id == tid)
    players = q.order_by(models.Player.player_number).all()

    result = []
    for p in players:
        # Deudas del torneo
        deudas = [d for d in p.deudas if d.tournament_id == tid] if tid else p.deudas
        pagos  = [pay for pay in p.payments if pay.tournament_id == tid] if tid else p.payments

        deuda_insc  = sum(d.monto for d in deudas if d.tipo == "inscripcion")
        deuda_arb   = sum(d.monto for d in deudas if d.tipo == "arbitraje")
        deuda_total = deuda_insc + deuda_arb
        pago_insc   = sum(pay.amount for pay in pagos if pay.payment_type == "inscripcion")
        pago_arb    = sum(pay.amount for pay in pagos if pay.payment_type == "arbitraje")
        pago_total  = pago_insc + pago_arb

        result.append({
            "player_id": p.id,
            "player_name": p.full_name,
            "player_number": p.player_number,
            "deuda_inscripcion": deuda_insc,
            "deuda_arbitraje": deuda_arb,
            "deuda_total": deuda_total,
            "pagado_inscripcion": pago_insc,
            "pagado_arbitraje": pago_arb,
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
        "inscripciones": [{"id":c.id,"total_amount":c.total_amount,"num_players":c.num_players,"amount_per_player":c.amount_per_player,"notes":c.notes,"created_at":c.created_at.isoformat()} for c in q_insc.all()],
        "arbitrajes":    [{"id":a.id,"fase":a.fase,"num_games":a.num_games,"price_per_game":a.price_per_game,"num_players":a.num_players,"total_phase":a.total_phase,"amount_per_player":a.amount_per_player,"notes":a.notes,"created_at":a.created_at.isoformat()} for a in q_arb.all()],
    }


@router.post("/inscripcion-config")
def create_inscripcion_config(body: dict, t: Optional[int] = Query(None), db: Session = Depends(get_db), current_user=Depends(require_admin)):
    tid = _get_tid(t, db)
    if not tid:
        raise HTTPException(status_code=400, detail="No hay torneo activo")
    total_amount = float(body.get("total_amount", 0))
    if total_amount <= 0:
        raise HTTPException(status_code=400, detail="El monto total debe ser mayor a 0")
    players = db.query(models.Player).filter(models.Player.is_active == True, models.Player.tournament_id == tid).all()
    if not players:
        raise HTTPException(status_code=400, detail="No hay jugadores en este torneo")
    num_players = len(players)
    amount_per_player = round(total_amount / num_players, 0)
    config = models.InscripcionConfig(tournament_id=tid, total_amount=total_amount, num_players=num_players, amount_per_player=amount_per_player, notes=body.get("notes",""))
    db.add(config); db.flush()
    concepto = f"Inscripción — ${int(total_amount):,} ÷ {num_players} jugadores"
    for player in players:
        db.add(models.Deuda(tournament_id=tid, player_id=player.id, tipo="inscripcion", monto=amount_per_player, concepto=concepto, config_id=config.id, config_tipo="inscripcion"))
    db.commit()
    return {"message": f"Inscripción configurada. Cada jugador debe ${int(amount_per_player):,}", "amount_per_player": amount_per_player}


@router.delete("/inscripcion-config/{config_id}")
def delete_inscripcion_config(config_id: int, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    db.query(models.Deuda).filter(models.Deuda.config_id == config_id, models.Deuda.config_tipo == "inscripcion").delete()
    config = db.query(models.InscripcionConfig).filter(models.InscripcionConfig.id == config_id).first()
    if config: db.delete(config)
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
    players = db.query(models.Player).filter(models.Player.is_active == True, models.Player.tournament_id == tid).all()
    if not players:
        raise HTTPException(status_code=400, detail="No hay jugadores en este torneo")
    num_players = len(players)
    total_phase = num_games * price_per_game
    amount_per_player = round(total_phase / num_players, 0)
    phase_config = models.ArbitrajePhase(tournament_id=tid, fase=fase, num_games=num_games, price_per_game=price_per_game, num_players=num_players, total_phase=total_phase, amount_per_player=amount_per_player, notes=body.get("notes",""))
    db.add(phase_config); db.flush()
    concepto = f"Arbitraje {fase} — {num_games} partidos × ${int(price_per_game):,} ÷ {num_players} jugadores"
    for player in players:
        db.add(models.Deuda(tournament_id=tid, player_id=player.id, tipo="arbitraje", fase=fase, monto=amount_per_player, concepto=concepto, config_id=phase_config.id, config_tipo="arbitraje"))
    db.commit()
    return {"message": f"{fase}: cada jugador debe ${int(amount_per_player):,}", "amount_per_player": amount_per_player}


@router.delete("/arbitraje-phase/{phase_id}")
def delete_arbitraje_phase(phase_id: int, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    db.query(models.Deuda).filter(models.Deuda.config_id == phase_id, models.Deuda.config_tipo == "arbitraje").delete()
    phase = db.query(models.ArbitrajePhase).filter(models.ArbitrajePhase.id == phase_id).first()
    if phase: db.delete(phase)
    db.commit()
    return {"message": "Fase eliminada"}


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
    db.add(models.Payment(tournament_id=tid, player_id=player_id, payment_type=payment_type, phase=body.get("phase"), amount=amount, notes=body.get("notes","")))
    db.commit()
    return {"message": f"Pago de ${int(amount):,} registrado para {player.full_name}"}


@router.delete("/payment/{payment_id}")
def delete_payment(payment_id: int, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    payment = db.query(models.Payment).filter(models.Payment.id == payment_id).first()
    if not payment:
        raise HTTPException(status_code=404, detail="Pago no encontrado")
    db.delete(payment); db.commit()
    return {"message": "Pago eliminado"}