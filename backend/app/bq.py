# app/bq.py
from google.cloud import bigquery
from .config import settings

_client = None


def bq_client() -> bigquery.Client:
    global _client
    if _client is None:
        # Si settings.gcp_project está vacío, BigQuery usa el proyecto por defecto de credenciales
        _client = bigquery.Client(project=settings.gcp_project or None)
    return _client


def fqtn(table: str) -> str:
    """
    Fully Qualified Table Name (FQTN).
    Permite usar:
      - "tabla"                 -> "project.dataset.tabla" (si hay proyecto) o "dataset.tabla"
      - "dataset.tabla"         -> "project.dataset.tabla" (si hay proyecto) o "dataset.tabla"
      - "project.dataset.tabla" -> se deja igual
    """
    # Ya viene completo: project.dataset.table
    if table.count(".") == 2:
        return table

    # Viene dataset.table
    if table.count(".") == 1:
        dataset, t = table.split(".", 1)
    else:
        dataset, t = settings.bq_dataset, table

    if settings.gcp_project:
        return f"{settings.gcp_project}.{dataset}.{t}"
    return f"{dataset}.{t}"
