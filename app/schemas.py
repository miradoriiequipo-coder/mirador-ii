from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


# ── Auth ──────────────────────────────────────────
class LoginRequest(BaseModel):
    username: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str
    is_admin: bool


# ── Player ────────────────────────────────────────
class PlayerCreate(BaseModel):
    id_number: str
    full_name: str
    player_number: int
    phone: Optional[str] = None
    health_info: Optional[str] = None
    photo_url: Optional[str] = None

class PlayerUpdate(BaseModel):
    id_number: Optional[str] = None
    full_name: Optional[str] = None
    player_number: Optional[int] = None
    phone: Optional[str] = None
    health_info: Optional[str] = None
    photo_url: Optional[str] = None
    is_active: Optional[bool] = None

class PlayerPublic(BaseModel):
    id: int
    full_name: str
    player_number: int
    phone: Optional[str] = None
    health_info: Optional[str] = None
    photo_url: Optional[str] = None
    is_active: bool

    class Config:
        from_attributes = True

class PlayerAdmin(PlayerPublic):
    id_number: str
    created_at: datetime

    class Config:
        from_attributes = True


# ── Match ─────────────────────────────────────────
class MatchCreate(BaseModel):
    opponent: str
    match_date: datetime
    location: Optional[str] = None
    phase: Optional[str] = None
    notes: Optional[str] = None

class MatchUpdate(BaseModel):
    opponent: Optional[str] = None
    match_date: Optional[datetime] = None
    location: Optional[str] = None
    phase: Optional[str] = None
    notes: Optional[str] = None
    is_played: Optional[bool] = None
    home_score: Optional[int] = None
    away_score: Optional[int] = None

class GoalDetail(BaseModel):
    id: int
    player_id: int
    player_name: str
    player_number: int
    count: int
    minute: Optional[int] = None
    assist_player_id: Optional[int] = None
    assist_player_name: Optional[str] = None

class MatchResponse(BaseModel):
    id: int
    opponent: str
    match_date: datetime
    location: Optional[str] = None
    phase: Optional[str] = None
    notes: Optional[str] = None
    is_played: bool
    home_score: Optional[int] = None
    away_score: Optional[int] = None
    created_at: datetime
    goals: List[GoalDetail] = []

    class Config:
        from_attributes = True


# ── Goals ─────────────────────────────────────────
class GoalCreate(BaseModel):
    player_id: int
    count: int = 1
    minute: Optional[int] = None
    assist_player_id: Optional[int] = None


# ── Votes ─────────────────────────────────────────
class VoteCreate(BaseModel):
    player_id: int

class VoteResult(BaseModel):
    player_id: int
    player_name: str
    player_number: int
    vote_count: int
    percentage: float


# ── Payments ──────────────────────────────────────
class PaymentCreate(BaseModel):
    player_id: int
    payment_type: str        # "inscripcion" | "arbitraje"
    phase: Optional[str] = None
    amount: float
    notes: Optional[str] = None

class PaymentResponse(BaseModel):
    id: int
    player_id: int
    payment_type: str
    phase: Optional[str] = None
    amount: float
    notes: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True

class PlayerPaymentSummary(BaseModel):
    player_id: int
    player_name: str
    player_number: int
    inscripcion_total: float
    arbitraje_total: float
    total: float
    payments: List[PaymentResponse]
