from sqlalchemy import Column, Integer, String, Boolean, DateTime, Float, ForeignKey, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from .database import Base


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    is_admin = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())


class Player(Base):
    __tablename__ = "players"
    id = Column(Integer, primary_key=True, index=True)
    id_number = Column(String, unique=True)   # Cédula - oculta para público
    full_name = Column(String, nullable=False)
    player_number = Column(Integer)
    phone = Column(String, nullable=True)
    health_info = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    photo_url = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    goals = relationship("Goal", back_populates="player", foreign_keys="Goal.player_id")
    assists = relationship("Goal", back_populates="assist_player", foreign_keys="Goal.assist_player_id")
    votes = relationship("Vote", back_populates="player")
    payments = relationship("Payment", back_populates="player")


class Match(Base):
    __tablename__ = "matches"
    id = Column(Integer, primary_key=True, index=True)
    opponent = Column(String, nullable=False)
    match_date = Column(DateTime, nullable=False)
    location = Column(String, nullable=True)
    phase = Column(String, nullable=True)       # Fase 1, Cuartos, Final, etc.
    is_played = Column(Boolean, default=False)
    home_score = Column(Integer, nullable=True)
    away_score = Column(Integer, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    goals = relationship("Goal", back_populates="match", cascade="all, delete-orphan")
    votes = relationship("Vote", back_populates="match", cascade="all, delete-orphan")


class Goal(Base):
    __tablename__ = "goals"
    id = Column(Integer, primary_key=True, index=True)
    match_id = Column(Integer, ForeignKey("matches.id", ondelete="CASCADE"))
    player_id = Column(Integer, ForeignKey("players.id"))
    assist_player_id = Column(Integer, ForeignKey("players.id"), nullable=True)
    count = Column(Integer, default=1)
    minute = Column(Integer, nullable=True)

    match = relationship("Match", back_populates="goals")
    player = relationship("Player", back_populates="goals", foreign_keys=[player_id])
    assist_player = relationship("Player", back_populates="assists", foreign_keys=[assist_player_id])


class Vote(Base):
    __tablename__ = "votes"
    id = Column(Integer, primary_key=True, index=True)
    match_id = Column(Integer, ForeignKey("matches.id", ondelete="CASCADE"))
    player_id = Column(Integer, ForeignKey("players.id"))
    voter_ip = Column(String, nullable=False)
    created_at = Column(DateTime, server_default=func.now())

    match = relationship("Match", back_populates="votes")
    player = relationship("Player", back_populates="votes")


class Payment(Base):
    __tablename__ = "payments"
    id = Column(Integer, primary_key=True, index=True)
    player_id = Column(Integer, ForeignKey("players.id"))
    payment_type = Column(String, nullable=False)   # "inscripcion" | "arbitraje"
    phase = Column(String, nullable=True)            # Fase 1, Fase 2, etc.
    amount = Column(Float, nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    player = relationship("Player", back_populates="payments")
