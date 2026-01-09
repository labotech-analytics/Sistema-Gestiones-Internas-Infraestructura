# app/sql.py

# -------------------------
# GESTIONES
# -------------------------

LIST_GESTIONES = """
SELECT
  id_gestion, departamento, localidad, estado, urgencia,
  ministerio_agencia_id, categoria_general_id,
  fecha_ingreso,
  DATE_DIFF(CURRENT_DATE(), fecha_ingreso, DAY) AS dias_transcurridos
FROM `infra_gestion.gestiones`
WHERE is_deleted = FALSE
  AND (@estado IS NULL OR estado = @estado)
  AND (@ministerio IS NULL OR ministerio_agencia_id = @ministerio)
  AND (@categoria IS NULL OR categoria_general_id = @categoria)
  AND (@departamento IS NULL OR departamento = @departamento)
ORDER BY fecha_ingreso DESC
LIMIT @limit OFFSET @offset
"""

COUNT_GESTIONES = """
SELECT
  COUNT(1) AS total
FROM `infra_gestion.gestiones`
WHERE is_deleted = FALSE
  AND (@estado IS NULL OR estado = @estado)
  AND (@ministerio IS NULL OR ministerio_agencia_id = @ministerio)
  AND (@categoria IS NULL OR categoria_general_id = @categoria)
  AND (@departamento IS NULL OR departamento = @departamento)
"""

GET_GESTION = """
SELECT * FROM `infra_gestion.gestiones`
WHERE id_gestion = @id AND is_deleted = FALSE
LIMIT 1
"""

INSERT_GESTION = """
INSERT INTO `infra_gestion.gestiones` (
  id_gestion, nro_expediente, origen,
  estado, fecha_ingreso, fecha_estado, fecha_finalizacion,
  urgencia,
  ministerio_agencia_id, categoria_general_id,
  detalle, observaciones,
  geo_id, departamento, localidad, direccion, lat, lon,
  created_at, created_by, updated_at, updated_by,
  is_deleted
)
VALUES (
  @id_gestion, NULL, 'ACTUAL',
  'INGRESADO', CURRENT_DATE(), CURRENT_TIMESTAMP(), NULL,
  @urgencia,
  @ministerio, @categoria,
  @detalle, @observaciones,
  @geo_id, @departamento, @localidad, @direccion, @lat, @lon,
  CURRENT_TIMESTAMP(), @actor, CURRENT_TIMESTAMP(), @actor,
  FALSE
)
"""

UPDATE_GESTION = """
UPDATE `infra_gestion.gestiones`
SET
  ministerio_agencia_id = COALESCE(@ministerio, ministerio_agencia_id),
  categoria_general_id = COALESCE(@categoria, categoria_general_id),
  detalle = COALESCE(@detalle, detalle),
  observaciones = COALESCE(@observaciones, observaciones),
  urgencia = COALESCE(@urgencia, urgencia),
  direccion = COALESCE(@direccion, direccion),
  departamento = COALESCE(@departamento, departamento),
  localidad = COALESCE(@localidad, localidad),
  updated_at = CURRENT_TIMESTAMP(),
  updated_by = @actor
WHERE id_gestion = @id AND is_deleted = FALSE
"""

SOFT_DELETE = """
UPDATE `infra_gestion.gestiones`
SET is_deleted = TRUE, updated_at = CURRENT_TIMESTAMP(), updated_by = @actor
WHERE id_gestion = @id AND is_deleted = FALSE
"""

# -------------------------
# EVENTOS GESTIONES
# -------------------------
# ESQUEMA REAL (según lo que pasaste):
# id_evento STRING NOT NULL
# id_gestion STRING NOT NULL
# fecha_evento TIMESTAMP NOT NULL
# usuario STRING NOT NULL
# rol_usuario STRING
# tipo_evento STRING NOT NULL
# estado_anterior STRING
# estado_nuevo STRING
# campo_modificado STRING
# valor_anterior STRING
# valor_nuevo STRING
# comentario STRING
# metadata_json JSON

INSERT_EVENTO = """
INSERT INTO `infra_gestion.gestiones_eventos` (
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
  CURRENT_TIMESTAMP(),
  @actor_email,
  @actor_rol,
  @tipo_evento,
  @estado_anterior,
  @estado_nuevo,
  NULL,
  NULL,
  NULL,
  @comentario,
  IF(@payload_json IS NULL, NULL, PARSE_JSON(@payload_json))
)
"""

GET_EVENTOS = """
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
FROM `infra_gestion.gestiones_eventos`
WHERE id_gestion = @id
ORDER BY fecha_evento DESC
LIMIT 200
"""

# -------------------------
# USUARIOS (roles) - opcional (por si querés centralizar queries)
# -------------------------

GET_USUARIO_ROLE = """
SELECT email, nombre, rol, activo
FROM `infra_gestion.usuarios_roles`
WHERE LOWER(email) = LOWER(@email)
LIMIT 1
"""

LIST_USUARIOS_ROLES = """
SELECT
  email, nombre, rol, activo,
  created_at, created_by, updated_at, updated_by
FROM `infra_gestion.usuarios_roles`
ORDER BY activo DESC, rol, email
"""

INSERT_USUARIO_ROLE = """
INSERT INTO `infra_gestion.usuarios_roles`
(email, nombre, rol, activo, created_at, created_by, updated_at, updated_by)
VALUES
(@email, @nombre, @rol, @activo, CURRENT_TIMESTAMP(), @actor, CURRENT_TIMESTAMP(), @actor)
"""

UPDATE_USUARIO_ROLE = """
UPDATE `infra_gestion.usuarios_roles`
SET
  nombre = COALESCE(@nombre, nombre),
  rol = COALESCE(@rol, rol),
  activo = COALESCE(@activo, activo),
  updated_at = CURRENT_TIMESTAMP(),
  updated_by = @actor
WHERE LOWER(email) = LOWER(@email)
"""

DISABLE_USUARIO_ROLE = """
UPDATE `infra_gestion.usuarios_roles`
SET
  activo = FALSE,
  updated_at = CURRENT_TIMESTAMP(),
  updated_by = @actor
WHERE LOWER(email) = LOWER(@email)
"""

INSERT_USUARIO_EVENTO = """
INSERT INTO `infra_gestion.usuarios_eventos`
(id_evento, ts_evento, actor_email, tipo_evento, usuario_email, payload_json)
VALUES
(@id_evento, CURRENT_TIMESTAMP(), @actor_email, @tipo_evento, @usuario_email, @payload_json)
"""
