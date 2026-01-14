from pydantic import BaseModel, Field
from typing import Optional, Literal
from decimal import Decimal

Rol = Literal["Admin", "Operador", "Supervisor", "Consulta"]
Estado = Literal[
    "INGRESADO",
    "DERIVADO A SUAC",
    "LISTA PARA INNAUGURAR",
    "FINALIZADA",
    "NO REMITE SUAC",
    "ARCHIVADO",
]
Urgencia = Literal["Alta", "Media", "Baja"]


class GestionCreate(BaseModel):
    ministerio_agencia_id: str
    categoria_general_id: str
    detalle: str = Field(min_length=1)

    departamento: str = Field(min_length=1)
    localidad: str = Field(min_length=1)

    direccion: Optional[str] = None
    observaciones: Optional[str] = None
    urgencia: Optional[Urgencia] = "Media"

    # nuevos campos (opcionales)
    organismo_id: Optional[str] = None
    subtipo_detalle: Optional[str] = None
    costo_estimado: Optional[Decimal] = None
    costo_moneda: Optional[str] = None
    nro_expediente: Optional[str] = None


class GestionUpdate(BaseModel):
    ministerio_agencia_id: Optional[str] = None
    categoria_general_id: Optional[str] = None
    detalle: Optional[str] = None
    observaciones: Optional[str] = None
    urgencia: Optional[Urgencia] = None
    direccion: Optional[str] = None

    organismo_id: Optional[str] = None
    subtipo_detalle: Optional[str] = None
    costo_estimado: Optional[Decimal] = None
    costo_moneda: Optional[str] = None
    nro_expediente: Optional[str] = None

    # obligatorios en edición también (si vienen, no pueden ser vacíos)
    departamento: Optional[str] = None
    localidad: Optional[str] = None


class CambioEstado(BaseModel):
    nuevo_estado: Estado
    comentario: Optional[str] = None
    derivado_a: Optional[str] = None
    acciones_implementadas: Optional[str] = None
