# app/sql_usuarios.py

LIST_USUARIOS = """
SELECT
  email, nombre, rol, activo,
  created_at, created_by, updated_at, updated_by
FROM `{usuarios_roles}`
ORDER BY activo DESC, rol, email
"""

EXISTS_USUARIO = """
SELECT COUNT(1) AS c
FROM `{usuarios_roles}`
WHERE LOWER(email) = LOWER(@email)
"""

INSERT_USUARIO = """
INSERT INTO `{usuarios_roles}`
(email, nombre, rol, activo, created_at, created_by, updated_at, updated_by)
VALUES
(@email, @nombre, @rol, @activo, CURRENT_TIMESTAMP(), @actor, CURRENT_TIMESTAMP(), @actor)
"""

UPDATE_USUARIO = """
UPDATE `{usuarios_roles}`
SET
  nombre = COALESCE(@nombre, nombre),
  rol = COALESCE(@rol, rol),
  activo = COALESCE(@activo, activo),
  updated_at = CURRENT_TIMESTAMP(),
  updated_by = @actor
WHERE LOWER(email) = LOWER(@email)
"""

DISABLE_USUARIO = """
UPDATE `{usuarios_roles}`
SET
  activo = FALSE,
  updated_at = CURRENT_TIMESTAMP(),
  updated_by = @actor
WHERE LOWER(email) = LOWER(@email)
"""

INSERT_USUARIO_EVENTO = """
INSERT INTO `{usuarios_eventos}`
(id_evento, ts_evento, actor_email, tipo_evento, usuario_email, payload_json)
VALUES
(@id_evento, CURRENT_TIMESTAMP(), @actor_email, @tipo_evento, @usuario_email, @payload_json)
"""
