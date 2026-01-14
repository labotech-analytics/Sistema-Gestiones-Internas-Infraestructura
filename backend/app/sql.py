# app/sql.py

LIST_GESTIONES = """
SELECT
  g.id_gestion,
  g.departamento,
  g.localidad,
  g.estado,
  g.urgencia,
  g.ministerio_agencia_id,
  g.categoria_general_id,

  -- IMPORTANTES para la tabla
  g.detalle,
  g.costo_estimado,
  g.costo_moneda,

  g.fecha_ingreso,
  DATE_DIFF(CURRENT_DATE(), g.fecha_ingreso, DAY) AS dias_transcurridos
FROM `{gestiones}` g
WHERE
  g.is_deleted = FALSE
  AND (@estado IS NULL OR g.estado = @estado)
  AND (@ministerio IS NULL OR g.ministerio_agencia_id = @ministerio)
  AND (@categoria IS NULL OR g.categoria_general_id = @categoria)

  -- robusto a mayúsculas/espacios
  AND (@departamento IS NULL OR UPPER(TRIM(g.departamento)) = UPPER(TRIM(@departamento)))
  AND (@localidad IS NULL OR UPPER(TRIM(g.localidad)) = UPPER(TRIM(@localidad)))

ORDER BY g.fecha_ingreso DESC, g.created_at DESC
LIMIT @limit
OFFSET @offset
"""

COUNT_GESTIONES = """
SELECT COUNT(1) AS total
FROM `{gestiones}` g
WHERE
  g.is_deleted = FALSE
  AND (@estado IS NULL OR g.estado = @estado)
  AND (@ministerio IS NULL OR g.ministerio_agencia_id = @ministerio)
  AND (@categoria IS NULL OR g.categoria_general_id = @categoria)

  AND (@departamento IS NULL OR UPPER(TRIM(g.departamento)) = UPPER(TRIM(@departamento)))
  AND (@localidad IS NULL OR UPPER(TRIM(g.localidad)) = UPPER(TRIM(@localidad)))
"""

GET_GESTION = """
SELECT * FROM `{gestiones}`
WHERE id_gestion = @id_gestion
  AND is_deleted = FALSE
LIMIT 1
"""

# Usa la misma lógica que /catalogos/geo
GET_GEO = """
SELECT
  id_geo,
  departamento,
  localidad,
  lat_centro AS lat,
  lon_centro AS lon
FROM `{geo_localidades}`
WHERE activo = TRUE
  AND UPPER(TRIM(departamento)) = UPPER(TRIM(@departamento))
  AND UPPER(TRIM(localidad)) = UPPER(TRIM(@localidad))
LIMIT 1
"""

INSERT_GESTION = """
INSERT INTO `{gestiones}` (
  id_gestion,
  nro_expediente,
  origen,

  estado,
  fecha_ingreso,
  fecha_estado,
  fecha_finalizacion,

  urgencia,

  ministerio_agencia_id,
  organismo_id,
  derivado_a_id,

  categoria_general_id,
  subcategoria_id,
  tipo_demanda_principal_id,
  subtipo_detalle,

  detalle,
  observaciones,

  geo_id,
  departamento,
  localidad,
  direccion,
  lat,
  lon,

  costo_estimado,
  costo_moneda,

  created_at,
  created_by,
  updated_at,
  updated_by,

  is_deleted
)
VALUES (
  @id_gestion,
  @nro_expediente,
  @origen,

  @estado,
  @fecha_ingreso,
  @fecha_estado,
  @fecha_finalizacion,

  @urgencia,

  @ministerio_agencia_id,
  @organismo_id,
  @derivado_a_id,

  @categoria_general_id,
  @subcategoria_id,
  @tipo_demanda_principal_id,
  @subtipo_detalle,

  @detalle,
  @observaciones,

  @geo_id,
  @departamento,
  @localidad,
  @direccion,
  @lat,
  @lon,

  @costo_estimado,
  @costo_moneda,

  @created_at,
  @created_by,
  @updated_at,
  @updated_by,

  FALSE
)
"""

UPDATE_ESTADO_GESTION = """
UPDATE `{gestiones}`
SET
  estado = @nuevo_estado,
  fecha_estado = @fecha_estado,
  fecha_finalizacion = IF(@nuevo_estado = 'FINALIZADA' AND fecha_finalizacion IS NULL, CURRENT_DATE(), fecha_finalizacion),
  derivado_a_id = IF(@derivado_a_id IS NULL, derivado_a_id, @derivado_a_id),
  updated_at = @updated_at,
  updated_by = @updated_by
WHERE id_gestion = @id_gestion
  AND is_deleted = FALSE
"""

DELETE_GESTION = """
UPDATE `{gestiones}`
SET
  is_deleted = TRUE,
  updated_at = @updated_at,
  updated_by = @updated_by
WHERE id_gestion = @id_gestion
  AND is_deleted = FALSE
"""

LIST_EVENTOS = """
SELECT
  id_evento,
  id_gestion,
  fecha_evento,
  usuario,
  rol_usuario,
  tipo_evento,
  estado_anterior,
  estado_nuevo,
  campo_modificado,
  valor_anterior,
  valor_nuevo,
  comentario,
  metadata_json
FROM `{eventos}`
WHERE id_gestion = @id_gestion
ORDER BY fecha_evento DESC
LIMIT 500
"""

INSERT_EVENTO = """
INSERT INTO `{eventos}` (
  id_evento,
  id_gestion,
  fecha_evento,

  usuario,
  rol_usuario,

  tipo_evento,

  estado_anterior,
  estado_nuevo,

  campo_modificado,
  valor_anterior,
  valor_nuevo,

  comentario,
  metadata_json
)
VALUES (
  @id_evento,
  @id_gestion,
  @fecha_evento,

  @usuario,
  @rol_usuario,

  @tipo_evento,

  @estado_anterior,
  @estado_nuevo,

  @campo_modificado,
  @valor_anterior,
  @valor_nuevo,

  @comentario,
  PARSE_JSON(@metadata_json)
)
"""
