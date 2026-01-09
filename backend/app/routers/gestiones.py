# app/routers/gestiones.py
from fastapi import APIRouter, Depends, HTTPException, Query
from uuid import uuid4
import json

from ..deps import qparams
from ..auth import require_user
from ..bq import bq_client
from ..models import GestionCreate, GestionUpdate, CambioEstado
from .. import sql

router = APIRouter(prefix="/gestiones", tags=["gestiones"])


def must_non_empty(label: str, v: str):
    if v is None or str(v).strip() == "":
        raise HTTPException(status_code=400, detail=f"{label} es obligatorio")


@router.get("/")
def list_gestiones(
    estado: str | None = None,
    ministerio: str | None = None,
    categoria: str | None = None,
    departamento: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user=Depends(require_user),
):
    """
    Devuelve paginado + total:
      {
        items: [...],
        total: N,
        limit: X,
        offset: Y
      }
    """
    params_filtros = [
        ("estado", "STRING", estado),
        ("ministerio", "STRING", ministerio),
        ("categoria", "STRING", categoria),
        ("departamento", "STRING", departamento),
    ]

    # 1) Total (sin limit/offset)
    job_total = bq_client().query(
        sql.COUNT_GESTIONES,
        job_config=qparams(params_filtros),
    )
    total_row = list(job_total.result())
    total = int(total_row[0]["total"]) if total_row else 0

    # 2) Items (paginado)
    job_items = bq_client().query(
        sql.LIST_GESTIONES,
        job_config=qparams(params_filtros + [
            ("limit", "INT64", limit),
            ("offset", "INT64", offset),
        ]),
    )
    items = [dict(r) for r in job_items.result()]

    return {
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/{id_gestion}")
def get_gestion(id_gestion: str, user=Depends(require_user)):
    job = bq_client().query(
        sql.GET_GESTION,
        job_config=qparams([("id", "STRING", id_gestion)]),
    )
    rows = list(job.result())
    if not rows:
        raise HTTPException(status_code=404, detail="No existe")
    return dict(rows[0])


@router.post("/")
def create_gestion(payload: GestionCreate, user=Depends(require_user)):
    # obligatorios
    must_non_empty("departamento", payload.departamento)
    must_non_empty("localidad", payload.localidad)
    must_non_empty("ministerio_agencia_id", payload.ministerio_agencia_id)
    must_non_empty("categoria_general_id", payload.categoria_general_id)
    must_non_empty("detalle", payload.detalle)

    depto = payload.departamento.strip()
    loc = payload.localidad.strip()

    # 0) Lookup geo_localidades -> id_geo + lat/lon
    q_geo = """
    SELECT
      id_geo,
      lat_centro AS lat,
      lon_centro AS lon
    FROM `infra_gestion.geo_localidades`
    WHERE UPPER(TRIM(departamento)) = UPPER(TRIM(@depto))
      AND UPPER(TRIM(localidad)) = UPPER(TRIM(@loc))
      AND activo = TRUE
    LIMIT 1
    """
    job_geo = bq_client().query(
        q_geo,
        job_config=qparams([
            ("depto", "STRING", depto),
            ("loc", "STRING", loc),
        ]),
    )
    geo_rows = list(job_geo.result())
    if not geo_rows:
        raise HTTPException(
            status_code=400,
            detail="Departamento/Localidad inválidos (no existen o no están activos en geo_localidades)"
        )

    geo = dict(geo_rows[0])
    geo_id = geo["id_geo"]
    lat = geo.get("lat")
    lon = geo.get("lon")

    new_id = str(uuid4())

    # 1) Insert gestion con geo_id/lat/lon reales
    bq_client().query(
        sql.INSERT_GESTION,
        job_config=qparams([
            ("id_gestion", "STRING", new_id),
            ("urgencia", "STRING", payload.urgencia),
            ("ministerio", "STRING", payload.ministerio_agencia_id),
            ("categoria", "STRING", payload.categoria_general_id),
            ("detalle", "STRING", payload.detalle),
            ("observaciones", "STRING", payload.observaciones),
            ("geo_id", "STRING", geo_id),
            ("departamento", "STRING", depto),
            ("localidad", "STRING", loc),
            ("direccion", "STRING", payload.direccion),
            ("lat", "NUMERIC", lat),
            ("lon", "NUMERIC", lon),
            ("actor", "STRING", user["email"]),
        ]),
    ).result()

    # 2) evento CREACION
    bq_client().query(
        sql.INSERT_EVENTO,
        job_config=qparams([
            ("id_evento", "STRING", str(uuid4())),

            ("id_gestion", "STRING", new_id),
            ("actor_email", "STRING", user["email"]),
            ("actor_rol", "STRING", user["rol"]),
            ("tipo_evento", "STRING", "CREACION"),

            ("estado_anterior", "STRING", None),
            ("estado_nuevo", "STRING", "INGRESADO"),
            ("comentario", "STRING", None),

            ("payload_json", "STRING", json.dumps(payload.model_dump(), ensure_ascii=False)),
        ]),
    ).result()

    return {"id_gestion": new_id}

@router.put("/{id_gestion}")
def update_gestion(id_gestion: str, payload: GestionUpdate, user=Depends(require_user)):
    if user["rol"] == "Consulta":
        raise HTTPException(status_code=403, detail="Sin permiso")

    # si vienen depto/localidad, no pueden ser vacíos
    if payload.departamento is not None:
        must_non_empty("departamento", payload.departamento)
    if payload.localidad is not None:
        must_non_empty("localidad", payload.localidad)

    # Por defecto no tocamos geo/lat/lon, salvo que cambien depto/localidad (o venga alguno)
    geo_id = None
    lat = None
    lon = None

    depto = payload.departamento.strip() if payload.departamento else None
    loc = payload.localidad.strip() if payload.localidad else None

    # si cambia alguno de los dos, necesitamos ambos para recalcular
    if payload.departamento is not None or payload.localidad is not None:
        if not depto or not loc:
            raise HTTPException(status_code=400, detail="Para cambiar ubicación, departamento y localidad deben venir juntos")

        q_geo = """
        SELECT
          id_geo,
          lat_centro AS lat,
          lon_centro AS lon
        FROM `infra_gestion.geo_localidades`
        WHERE UPPER(TRIM(departamento)) = UPPER(TRIM(@depto))
          AND UPPER(TRIM(localidad)) = UPPER(TRIM(@loc))
          AND activo = TRUE
        LIMIT 1
        """
        job_geo = bq_client().query(
            q_geo,
            job_config=qparams([
                ("depto", "STRING", depto),
                ("loc", "STRING", loc),
            ]),
        )
        geo_rows = list(job_geo.result())
        if not geo_rows:
            raise HTTPException(
                status_code=400,
                detail="Departamento/Localidad inválidos (no existen o no están activos en geo_localidades)"
            )

        geo = dict(geo_rows[0])
        geo_id = geo["id_geo"]
        lat = geo.get("lat")
        lon = geo.get("lon")

    # UPDATE (incluye geo/lat/lon solo si recalculamos)
    q_update = """
    UPDATE `infra_gestion.gestiones`
    SET
      ministerio_agencia_id = COALESCE(@ministerio, ministerio_agencia_id),
      categoria_general_id  = COALESCE(@categoria, categoria_general_id),
      detalle               = COALESCE(@detalle, detalle),
      observaciones         = COALESCE(@observaciones, observaciones),
      urgencia              = COALESCE(@urgencia, urgencia),
      direccion             = COALESCE(@direccion, direccion),

      departamento          = COALESCE(@departamento, departamento),
      localidad             = COALESCE(@localidad, localidad),

      geo_id                = COALESCE(@geo_id, geo_id),
      lat                   = COALESCE(@lat, lat),
      lon                   = COALESCE(@lon, lon),

      updated_at = CURRENT_TIMESTAMP(),
      updated_by = @actor
    WHERE id_gestion = @id AND is_deleted = FALSE
    """
    bq_client().query(
        q_update,
        job_config=qparams([
            ("id", "STRING", id_gestion),
            ("ministerio", "STRING", payload.ministerio_agencia_id),
            ("categoria", "STRING", payload.categoria_general_id),
            ("detalle", "STRING", payload.detalle),
            ("observaciones", "STRING", payload.observaciones),
            ("urgencia", "STRING", payload.urgencia),
            ("direccion", "STRING", payload.direccion),
            ("departamento", "STRING", depto),
            ("localidad", "STRING", loc),

            ("geo_id", "STRING", geo_id),
            ("lat", "NUMERIC", lat),
            ("lon", "NUMERIC", lon),

            ("actor", "STRING", user["email"]),
        ]),
    ).result()

    # evento EDICION (igual que antes)
    bq_client().query(
        sql.INSERT_EVENTO,
        job_config=qparams([
            ("id_evento", "STRING", str(uuid4())),
            ("id_gestion", "STRING", id_gestion),
            ("actor_email", "STRING", user["email"]),
            ("actor_rol", "STRING", user["rol"]),
            ("tipo_evento", "STRING", "EDICION"),
            ("estado_anterior", "STRING", None),
            ("estado_nuevo", "STRING", None),
            ("comentario", "STRING", None),
            ("payload_json", "STRING", json.dumps(payload.model_dump(), ensure_ascii=False)),
        ]),
    ).result()

    return {"ok": True}


@router.post("/{id_gestion}/cambiar-estado")
def cambiar_estado(id_gestion: str, payload: CambioEstado, user=Depends(require_user)):
    # restricciones por rol
    if user["rol"] == "Consulta":
        raise HTTPException(status_code=403, detail="Sin permiso")

    if payload.nuevo_estado in ("FINALIZADA", "ARCHIVADO") and user["rol"] not in ("Admin", "Supervisor"):
        raise HTTPException(status_code=403, detail="Solo Supervisor/Admin")

    if payload.nuevo_estado in ("ARCHIVADO", "NO REMITE SUAC") and (
        payload.comentario is None or payload.comentario.strip() == ""
    ):
        raise HTTPException(status_code=400, detail="Comentario obligatorio")

    # obtener estado actual
    job = bq_client().query(
        sql.GET_GESTION,
        job_config=qparams([("id", "STRING", id_gestion)]),
    )
    rows = list(job.result())
    if not rows:
        raise HTTPException(status_code=404, detail="No existe")

    current = dict(rows[0])
    estado_anterior = current["estado"]

    # actualizar estado + fechas
    q_update = """
    UPDATE `infra_gestion.gestiones`
    SET
      estado = @nuevo,
      fecha_estado = CURRENT_TIMESTAMP(),
      fecha_finalizacion = IF(@nuevo = 'FINALIZADA', CURRENT_DATE(), fecha_finalizacion),
      updated_at = CURRENT_TIMESTAMP(),
      updated_by = @actor
    WHERE id_gestion = @id AND is_deleted = FALSE
    """
    bq_client().query(
        q_update,
        job_config=qparams([
            ("nuevo", "STRING", payload.nuevo_estado),
            ("actor", "STRING", user["email"]),
            ("id", "STRING", id_gestion),
        ]),
    ).result()

    # evento CAMBIO_ESTADO
    bq_client().query(
        sql.INSERT_EVENTO,
        job_config=qparams([
            ("id_evento", "STRING", str(uuid4())),
            ("id_gestion", "STRING", id_gestion),
            ("actor_email", "STRING", user["email"]),
            ("actor_rol", "STRING", user["rol"]),
            ("tipo_evento", "STRING", "CAMBIO_ESTADO"),
            ("estado_anterior", "STRING", estado_anterior),
            ("estado_nuevo", "STRING", payload.nuevo_estado),
            ("comentario", "STRING", payload.comentario),
            ("payload_json", "STRING", None),
        ]),
    ).result()

    return {"ok": True}


@router.delete("/{id_gestion}")
def delete_gestion(id_gestion: str, user=Depends(require_user)):
    if user["rol"] not in ("Admin", "Supervisor"):
        raise HTTPException(status_code=403, detail="Sin permiso")

    bq_client().query(
        sql.SOFT_DELETE,
        job_config=qparams([
            ("id", "STRING", id_gestion),
            ("actor", "STRING", user["email"]),
        ]),
    ).result()

    bq_client().query(
        sql.INSERT_EVENTO,
        job_config=qparams([
            ("id_evento", "STRING", str(uuid4())),
            ("id_gestion", "STRING", id_gestion),
            ("actor_email", "STRING", user["email"]),
            ("actor_rol", "STRING", user["rol"]),
            ("tipo_evento", "STRING", "BORRADO_LOGICO"),
            ("estado_anterior", "STRING", None),
            ("estado_nuevo", "STRING", None),
            ("comentario", "STRING", None),
            ("payload_json", "STRING", None),
        ]),
    ).result()

    return {"ok": True}


@router.get("/{id_gestion}/eventos")
def eventos(id_gestion: str, user=Depends(require_user)):
    job = bq_client().query(
        sql.GET_EVENTOS,
        job_config=qparams([("id", "STRING", id_gestion)]),
    )
    rows = list(job.result())
    return [dict(r) for r in rows]
