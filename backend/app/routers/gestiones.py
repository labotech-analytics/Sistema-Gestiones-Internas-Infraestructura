from fastapi import APIRouter, Depends, HTTPException, Query
from uuid import uuid4
from datetime import date, datetime
from decimal import Decimal
import json

from google.cloud import bigquery

from ..bq import bq_client, fqtn
from ..deps import qparams, require_roles
from ..models import GestionCreate, CambioEstado
from .. import sql_gestiones as Q

router = APIRouter(prefix="/gestiones", tags=["gestiones"])


def _run(query: str, cfg: bigquery.QueryJobConfig):
    return bq_client().query(query, job_config=cfg).result()


def _one(query: str, cfg: bigquery.QueryJobConfig):
    rows = list(_run(query, cfg))
    return dict(rows[0]) if rows else None


def _fmt_tables(sql_text: str) -> str:
    return sql_text.format(
        gestiones=fqtn("infra_gestion.gestiones"),
        eventos=fqtn("infra_gestion.gestiones_eventos"),
        geo_localidades=fqtn("geo_localidades"),
    )


def _json_safe(obj):
    if isinstance(obj, Decimal):
        return str(obj)
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    return str(obj)


def json_dumps_safe(d: dict) -> str:
    return json.dumps(d, ensure_ascii=False, default=_json_safe)


@router.get("/")
def list_gestiones(
    estado: str | None = None,
    ministerio: str | None = None,
    categoria: str | None = None,
    departamento: str | None = None,
    localidad: str | None = None,

    # búsqueda server-side
    q: str | None = None,

    # (opcionales por si después querés filtrar)
    tipo_gestion: str | None = None,
    canal_origen: str | None = None,

    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user=Depends(require_roles("Admin", "Supervisor", "Operador", "Consulta")),
):
    cfg_count = qparams([
        ("estado", "STRING", estado),
        ("ministerio", "STRING", ministerio),
        ("categoria", "STRING", categoria),
        ("departamento", "STRING", departamento),
        ("localidad", "STRING", localidad),
        ("q", "STRING", q),

        ("tipo_gestion", "STRING", tipo_gestion),
        ("canal_origen", "STRING", canal_origen),
    ])
    total_row = _one(_fmt_tables(Q.COUNT_GESTIONES), cfg_count)
    total = int(total_row["total"]) if total_row and "total" in total_row else 0

    cfg_list = qparams([
        ("estado", "STRING", estado),
        ("ministerio", "STRING", ministerio),
        ("categoria", "STRING", categoria),
        ("departamento", "STRING", departamento),
        ("localidad", "STRING", localidad),
        ("q", "STRING", q),

        ("tipo_gestion", "STRING", tipo_gestion),
        ("canal_origen", "STRING", canal_origen),

        ("limit", "INT64", limit),
        ("offset", "INT64", offset),
    ])
    items = [dict(r) for r in _run(_fmt_tables(Q.LIST_GESTIONES), cfg_list)]
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/{id_gestion}")
def get_gestion(
    id_gestion: str,
    user=Depends(require_roles("Admin", "Supervisor", "Operador", "Consulta")),
):
    cfg = qparams([("id_gestion", "STRING", id_gestion)])
    g = _one(_fmt_tables(Q.GET_GESTION), cfg)
    if not g:
        raise HTTPException(status_code=404, detail="Gestión no encontrada")
    return g


@router.get("/{id_gestion}/eventos")
def list_eventos(
    id_gestion: str,
    user=Depends(require_roles("Admin", "Supervisor", "Operador", "Consulta")),
):
    cfg = qparams([("id_gestion", "STRING", id_gestion)])
    return [dict(r) for r in _run(_fmt_tables(Q.LIST_EVENTOS), cfg)]


@router.post("", status_code=201)
@router.post("/", status_code=201)
def create_gestion(
    payload: GestionCreate,
    user=Depends(require_roles("Admin", "Supervisor", "Operador")),
):
    # geo lookup
    cfg_geo = qparams([
        ("departamento", "STRING", payload.departamento),
        ("localidad", "STRING", payload.localidad),
    ])
    geo = _one(_fmt_tables(Q.GET_GEO), cfg_geo)
    if not geo:
        raise HTTPException(
            status_code=400,
            detail="Departamento/Localidad inválidos (no existen en geo_localidades)"
        )

    now_dt = datetime.utcnow()
    today = date.today()

    new_id = str(uuid4())
    actor = user.get("email") or user.get("usuario") or ""
    rol = user.get("rol")

    # BigQuery NUMERIC: pasamos string
    lat_val = geo.get("lat")
    lon_val = geo.get("lon")
    lat_num = None if lat_val is None else str(lat_val)
    lon_num = None if lon_val is None else str(lon_val)

    cfg_ins = qparams([
        ("id_gestion", "STRING", new_id),
        ("nro_expediente", "STRING", getattr(payload, "nro_expediente", None)),
        ("origen", "STRING", "APP"),

        ("estado", "STRING", "INGRESADO"),
        ("fecha_ingreso", "DATE", today),
        ("fecha_estado", "TIMESTAMP", now_dt),
        ("fecha_finalizacion", "DATE", None),

        ("urgencia", "STRING", payload.urgencia or "Media"),

        ("ministerio_agencia_id", "STRING", payload.ministerio_agencia_id),
        ("organismo_id", "STRING", getattr(payload, "organismo_id", None)),
        ("derivado_a_id", "STRING", None),

        ("categoria_general_id", "STRING", payload.categoria_general_id),
        ("subcategoria_id", "STRING", None),
        ("tipo_demanda_principal_id", "STRING", None),
        ("subtipo_detalle", "STRING", getattr(payload, "subtipo_detalle", None)),

        ("detalle", "STRING", payload.detalle),
        ("observaciones", "STRING", payload.observaciones),

        ("geo_id", "STRING", geo.get("id_geo")),
        ("departamento", "STRING", payload.departamento),
        ("localidad", "STRING", payload.localidad),
        ("direccion", "STRING", payload.direccion),

        ("lat", "NUMERIC", lat_num),
        ("lon", "NUMERIC", lon_num),

        ("costo_estimado", "NUMERIC", getattr(payload, "costo_estimado", None)),
        ("costo_moneda", "STRING", getattr(payload, "costo_moneda", None)),

        ("created_at", "TIMESTAMP", now_dt),
        ("created_by", "STRING", actor),
        ("updated_at", "TIMESTAMP", now_dt),
        ("updated_by", "STRING", actor),

        # ✅ NUEVOS
        ("tipo_gestion", "STRING", getattr(payload, "tipo_gestion", None)),
        ("canal_origen", "STRING", getattr(payload, "canal_origen", None)),
    ])
    _run(_fmt_tables(Q.INSERT_GESTION), cfg_ins)

    meta = {
        "ministerio_agencia_id": payload.ministerio_agencia_id,
        "categoria_general_id": payload.categoria_general_id,
        "organismo_id": getattr(payload, "organismo_id", None),
        "subtipo_detalle": getattr(payload, "subtipo_detalle", None),
        "costo_estimado": getattr(payload, "costo_estimado", None),
        "costo_moneda": getattr(payload, "costo_moneda", None),
        "nro_expediente": getattr(payload, "nro_expediente", None),
        "departamento": payload.departamento,
        "localidad": payload.localidad,
        "geo_id": geo.get("id_geo"),

        # ✅ NUEVOS
        "tipo_gestion": getattr(payload, "tipo_gestion", None),
        "canal_origen": getattr(payload, "canal_origen", None),
    }

    cfg_ev = qparams([
        ("id_evento", "STRING", str(uuid4())),
        ("id_gestion", "STRING", new_id),
        ("fecha_evento", "TIMESTAMP", now_dt),
        ("usuario", "STRING", actor),
        ("rol_usuario", "STRING", rol),
        ("tipo_evento", "STRING", "CREACION"),
        ("estado_anterior", "STRING", None),
        ("estado_nuevo", "STRING", "INGRESADO"),
        ("campo_modificado", "STRING", None),
        ("valor_anterior", "STRING", None),
        ("valor_nuevo", "STRING", None),
        ("comentario", "STRING", None),
        ("metadata_json", "STRING", json_dumps_safe(meta)),
    ])
    _run(_fmt_tables(Q.INSERT_EVENTO), cfg_ev)

    return {"id_gestion": new_id}


@router.post("/{id_gestion}/cambiar-estado")
def cambiar_estado(
    id_gestion: str,
    payload: CambioEstado,
    user=Depends(require_roles("Admin", "Supervisor", "Operador")),
):
    cfg_get = qparams([("id_gestion", "STRING", id_gestion)])
    g = _one(_fmt_tables(Q.GET_GESTION), cfg_get)
    if not g:
        raise HTTPException(status_code=404, detail="Gestión no encontrada")

    estado_anterior = g.get("estado")
    now_dt = datetime.utcnow()
    actor = user.get("email") or user.get("usuario") or ""
    rol = user.get("rol")

    cfg_upd = qparams([
        ("id_gestion", "STRING", id_gestion),
        ("nuevo_estado", "STRING", payload.nuevo_estado),
        ("fecha_estado", "TIMESTAMP", now_dt),
        ("derivado_a_id", "STRING", getattr(payload, "derivado_a", None)),
        ("updated_at", "TIMESTAMP", now_dt),
        ("updated_by", "STRING", actor),
    ])
    _run(_fmt_tables(Q.UPDATE_ESTADO_GESTION), cfg_upd)

    meta = {
        "derivado_a": getattr(payload, "derivado_a", None),
        "acciones_implementadas": getattr(payload, "acciones_implementadas", None),
    }

    cfg_ev = qparams([
        ("id_evento", "STRING", str(uuid4())),
        ("id_gestion", "STRING", id_gestion),
        ("fecha_evento", "TIMESTAMP", now_dt),
        ("usuario", "STRING", actor),
        ("rol_usuario", "STRING", rol),
        ("tipo_evento", "STRING", "CAMBIO_ESTADO"),
        ("estado_anterior", "STRING", estado_anterior),
        ("estado_nuevo", "STRING", payload.nuevo_estado),
        ("campo_modificado", "STRING", None),
        ("valor_anterior", "STRING", None),
        ("valor_nuevo", "STRING", None),
        ("comentario", "STRING", payload.comentario),
        ("metadata_json", "STRING", json_dumps_safe(meta)),
    ])
    _run(_fmt_tables(Q.INSERT_EVENTO), cfg_ev)

    return {"ok": True, "id_gestion": id_gestion, "estado": payload.nuevo_estado}


@router.delete("/{id_gestion}")
def delete_gestion(
    id_gestion: str,
    user=Depends(require_roles("Admin", "Supervisor")),
):
    now_dt = datetime.utcnow()
    actor = user.get("email") or user.get("usuario") or ""
    rol = user.get("rol")

    cfg_del = qparams([
        ("id_gestion", "STRING", id_gestion),
        ("updated_at", "TIMESTAMP", now_dt),
        ("updated_by", "STRING", actor),
    ])
    _run(_fmt_tables(Q.DELETE_GESTION), cfg_del)

    cfg_ev = qparams([
        ("id_evento", "STRING", str(uuid4())),
        ("id_gestion", "STRING", id_gestion),
        ("fecha_evento", "TIMESTAMP", now_dt),
        ("usuario", "STRING", actor),
        ("rol_usuario", "STRING", rol),
        ("tipo_evento", "STRING", "ARCHIVO"),
        ("estado_anterior", "STRING", None),
        ("estado_nuevo", "STRING", None),
        ("campo_modificado", "STRING", "is_deleted"),
        ("valor_anterior", "STRING", "FALSE"),
        ("valor_nuevo", "STRING", "TRUE"),
        ("comentario", "STRING", "Borrado lógico desde UI"),
        ("metadata_json", "STRING", json_dumps_safe({})),
    ])
    _run(_fmt_tables(Q.INSERT_EVENTO), cfg_ev)

    return {"ok": True}
