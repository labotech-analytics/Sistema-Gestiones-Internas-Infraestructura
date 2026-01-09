# app/deps.py
from fastapi import Depends, Header, HTTPException
from google.cloud.bigquery import QueryJobConfig, ScalarQueryParameter
from typing import Iterable, Tuple, Any, Dict, Callable


def qparams(params: Iterable[Tuple[str, str, Any]]) -> QueryJobConfig:
    """
    Único helper: arma QueryJobConfig con parámetros tipados.
    params: iterable de (name, bq_type, value)
    """
    return QueryJobConfig(
        query_parameters=[ScalarQueryParameter(n, t, v) for n, t, v in params]
    )


def _require_user(authorization: str = Header(default="")) -> Dict[str, Any]:
    """
    Wrapper para evitar import circular.
    Importa require_user en runtime y le pasa el header real 'Authorization'.
    """
    from .auth import require_user  # <- import perezoso (evita circular import)
    return require_user(authorization)


def current_user(user: Dict[str, Any] = Depends(_require_user)) -> Dict[str, Any]:
    return user


def require_roles(*roles: str) -> Callable:
    """
    Dependency factory para exigir roles.
    Uso:
      user = Depends(require_roles("Admin"))
    """
    def _inner(user: Dict[str, Any] = Depends(_require_user)) -> Dict[str, Any]:
        if user.get("rol") not in roles:
            raise HTTPException(status_code=403, detail="Sin permiso")
        return user
    return _inner
