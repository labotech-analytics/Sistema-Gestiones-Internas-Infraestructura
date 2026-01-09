# app/auth.py
from fastapi import Header, HTTPException
from google.oauth2 import id_token
from google.auth.transport import requests
from typing import Optional, Dict, Any

from .config import settings
from .bq import bq_client, fqtn
from .deps import qparams


def _get_bq_user(email: str) -> Optional[Dict[str, Any]]:
    """
    Busca el usuario en BigQuery (tabla usuarios_roles).
    Debe existir y estar activo para autorizar.
    """
    table = fqtn("infra_gestion.usuarios_roles")

    # Normalizamos 'activo' a BOOL:
    # - si activo ya es BOOL -> SAFE_CAST(activo AS BOOL) funciona
    # - si activo es STRING ("true"/"false") -> SAFE_CAST da NULL, entonces usamos LOWER(...) = "true"
    q = f"""
    SELECT
      email,
      nombre,
      rol,
      CASE
        WHEN SAFE_CAST(activo AS BOOL) IS NOT NULL THEN SAFE_CAST(activo AS BOOL)
        WHEN LOWER(CAST(activo AS STRING)) = "true" THEN TRUE
        ELSE FALSE
      END AS activo
    FROM `{table}`
    WHERE LOWER(email) = LOWER(@email)
    LIMIT 1
    """

    job = bq_client().query(q, job_config=qparams([("email", "STRING", email)]))
    rows = list(job.result())
    return dict(rows[0]) if rows else None


def require_user(authorization: str = Header(default="")) -> Dict[str, Any]:
    """
    Valida token de Google (id_token) y luego verifica permisos en usuarios_roles.
    Devuelve un dict con {email, nombre, rol}.
    """
    if not isinstance(authorization, str) or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")

    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Empty token")

    try:
        claims = id_token.verify_oauth2_token(
            token,
            requests.Request(),
            settings.google_client_id,
        )
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

    email = (claims.get("email") or "").lower().strip()
    if not email:
        raise HTTPException(status_code=401, detail="Token without email")

    user = _get_bq_user(email)
    if not user:
        raise HTTPException(status_code=403, detail="Not authorized (user not found)")

    if not bool(user.get("activo")):
        raise HTTPException(status_code=403, detail="Not authorized (inactive user)")

    return {
        "email": user["email"],
        "nombre": user.get("nombre"),
        "rol": user["rol"],
    }
