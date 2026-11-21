-- Base de datos de la Subcomisión de Inventariado y Auditoría Interna
-- Movimiento Estudiantil UAM-I · meuami.org
--
-- Se pega en la consola de la base en el tablero de Cloudflare.
-- Volver a ejecutarla no hace daño: todo va con IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS bienes (
  -- Identidad
  folio        TEXT PRIMARY KEY,
  unidad       TEXT NOT NULL DEFAULT 'IZT',

  -- Datos del bien. Son los que viajan al catálogo público.
  fecha        TEXT NOT NULL,
  categoria    TEXT NOT NULL DEFAULT '',
  procedencia  TEXT NOT NULL DEFAULT '',
  descripcion  TEXT NOT NULL DEFAULT '',
  marca        TEXT NOT NULL DEFAULT '',
  inventario   TEXT NOT NULL DEFAULT '',
  cantidad     INTEGER NOT NULL DEFAULT 1,
  ubicacion    TEXT NOT NULL DEFAULT '',
  estado       TEXT NOT NULL DEFAULT 'Bueno',

  -- Datos de personas. Van en columnas aparte a propósito: nunca salen por la
  -- ruta pública, y si más adelante se decide cifrarlos desde el navegador,
  -- se cambia lo que guardan sin rehacer la tabla.
  prestador    TEXT NOT NULL DEFAULT '',
  responsable  TEXT NOT NULL DEFAULT '',
  observaciones TEXT NOT NULL DEFAULT '',

  -- Control
  tiene_foto   INTEGER NOT NULL DEFAULT 0,
  baja         INTEGER NOT NULL DEFAULT 0,   -- 1 = dado de baja, se conserva el renglón
  creado       TEXT NOT NULL,
  actualizado  TEXT NOT NULL,
  capturado_por TEXT NOT NULL DEFAULT ''
);

-- El catálogo público se ordena y filtra por estas columnas.
CREATE INDEX IF NOT EXISTS idx_bienes_unidad      ON bienes (unidad, baja);
CREATE INDEX IF NOT EXISTS idx_bienes_ubicacion   ON bienes (ubicacion);
CREATE INDEX IF NOT EXISTS idx_bienes_procedencia ON bienes (procedencia);
-- Para que la sincronización pida solo lo que cambió desde la última vez.
CREATE INDEX IF NOT EXISTS idx_bienes_actualizado ON bienes (actualizado);

-- Quién tocó qué. Para un órgano de auditoría esto no es adorno: es la
-- diferencia entre un registro y un registro del que se puede responder.
CREATE TABLE IF NOT EXISTS bitacora (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  cuando   TEXT NOT NULL,
  folio    TEXT NOT NULL,
  accion   TEXT NOT NULL,              -- alta | cambio | baja
  quien    TEXT NOT NULL DEFAULT '',
  detalle  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_bitacora_folio  ON bitacora (folio);
CREATE INDEX IF NOT EXISTS idx_bitacora_cuando ON bitacora (cuando);

-- El consecutivo deja de vivir en un navegador: así dos personas no pueden
-- tomar el mismo folio.
CREATE TABLE IF NOT EXISTS consecutivos (
  unidad TEXT PRIMARY KEY,
  ultimo INTEGER NOT NULL DEFAULT 0
);

-- Documentos del archivo publico. El PDF no vive aqui: D1 topa en 2 MB por
-- valor y los escaneos pasan de eso. La columna "archivo" guarda a donde
-- apunta, sea el repositorio o el almacen R2.
CREATE TABLE IF NOT EXISTS documentos (
  id          TEXT PRIMARY KEY,
  tipo        TEXT NOT NULL DEFAULT '',
  etiqueta    TEXT NOT NULL DEFAULT '',
  titulo      TEXT NOT NULL DEFAULT '',
  resumen     TEXT NOT NULL DEFAULT '',
  firmas      TEXT NOT NULL DEFAULT '',
  nota        TEXT NOT NULL DEFAULT '',
  archivo     TEXT NOT NULL DEFAULT '',
  peso        TEXT NOT NULL DEFAULT '',
  fecha       TEXT NOT NULL DEFAULT '',
  orden       INTEGER NOT NULL DEFAULT 0,
  publicado   INTEGER NOT NULL DEFAULT 1,
  creado      TEXT NOT NULL,
  actualizado TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documentos_lista ON documentos (publicado, orden, fecha);
