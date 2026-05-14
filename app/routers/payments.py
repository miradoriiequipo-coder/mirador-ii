from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from .. import models, schemas
from ..database import get_db
from ..auth import require_admin

router = APIRouter(prefix="/payments", tags=["payments"])


@router.get("/")
def list_payments(db: Session = Depends(get_db)):
    """Resumen de pagos por jugador"""
    players = (
        db.query(models.Player)
        .filter(models.Player.is_active == True)
        .order_by(models.Player.player_number)
        .all()
    )
    result = []
    for p in players:
        pays = [
            schemas.PaymentResponse(
                id=pay.id,
                player_id=pay.player_id,
                payment_type=pay.payment_type,
                phase=pay.phase,
                amount=pay.amount,
                notes=pay.notes,
                created_at=pay.created_at,
            )
            for pay in p.payments
        ]
        inscripcion = sum(pay.amount for pay in p.payments if pay.payment_type == "inscripcion")
        arbitraje = sum(pay.amount for pay in p.payments if pay.payment_type == "arbitraje")
        result.append(
            {
                "player_id": p.id,
                "player_name": p.full_name,
                "player_number": p.player_number,
                "inscripcion_total": inscripcion,
                "arbitraje_total": arbitraje,
                "total": inscripcion + arbitraje,
                "payments": [pay.model_dump() for pay in pays],
            }
        )
    return result


@router.post("/")
def add_payment(
    body: schemas.PaymentCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    player = db.query(models.Player).filter(models.Player.id == body.player_id).first()
    if not player:
        raise HTTPException(status_code=404, detail="Jugador no encontrado")

    payment = models.Payment(**body.model_dump())
    db.add(payment)
    db.commit()
    db.refresh(payment)
    return payment


@router.delete("/{payment_id}")
def delete_payment(
    payment_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    payment = db.query(models.Payment).filter(models.Payment.id == payment_id).first()
    if not payment:
        raise HTTPException(status_code=404, detail="Pago no encontrado")
    db.delete(payment)
    db.commit()
    return {"message": "Pago eliminado"}
