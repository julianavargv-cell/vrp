#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

console.log('🔄 Migrando base de datos para sistema de historial...');

// Verificar si existe la base de datos
if (!fs.existsSync('reconecta.db')) {
  console.log('❌ No se encontró la base de datos reconecta.db');
  process.exit(1);
}

// Crear backup de la base de datos existente
fs.copyFileSync('reconecta.db', 'reconecta_backup.db');
console.log('✅ Backup creado: reconecta_backup.db');

const db = new sqlite3.Database('reconecta.db');

// Crear tabla de historial si no existe
db.run(`CREATE TABLE IF NOT EXISTS historial_subidas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre_archivo TEXT,
  fecha_subida DATETIME DEFAULT CURRENT_TIMESTAMP,
  registros_procesados INTEGER,
  peso_total REAL,
  ubicaciones_unicas INTEGER,
  estado TEXT DEFAULT 'procesado'
)`, (err) => {
  if (err) {
    console.error('Error creando tabla historial_subidas:', err);
    db.close();
    return;
  }
  console.log('✅ Tabla historial_subidas creada/verificada');

  // Verificar si la tabla residuos tiene la columna subida_id
  db.all("PRAGMA table_info(residuos)", (err, columns) => {
    if (err) {
      console.error('Error obteniendo información de tabla:', err);
      db.close();
      return;
    }

    const hasSubidaId = columns.some(col => col.name === 'subida_id');
    
    if (!hasSubidaId) {
      console.log('🔄 Agregando columna subida_id a tabla residuos...');
      
      // Agregar columna subida_id
      db.run(`ALTER TABLE residuos ADD COLUMN subida_id INTEGER`, (err) => {
        if (err) {
          console.error('Error agregando columna subida_id:', err);
          db.close();
          return;
        }
        console.log('✅ Columna subida_id agregada');
        
        // Crear un registro de historial para datos existentes
        db.run(`INSERT INTO historial_subidas (nombre_archivo, registros_procesados, peso_total, ubicaciones_unicas) 
                SELECT 'Datos existentes', COUNT(*), SUM(peso_kg), COUNT(DISTINCT direccion || ciudad) 
                FROM residuos`, (err) => {
          if (err) {
            console.error('Error creando historial para datos existentes:', err);
            db.close();
            return;
          }
          console.log('✅ Historial creado para datos existentes');
          
          // Actualizar registros existentes con subida_id = 1
          db.run(`UPDATE residuos SET subida_id = 1 WHERE subida_id IS NULL`, (err) => {
            if (err) {
              console.error('Error actualizando registros existentes:', err);
            } else {
              console.log('✅ Registros existentes actualizados con subida_id = 1');
              console.log('🎉 Migración completada exitosamente!');
            }
            db.close();
          });
        });
      });
    } else {
      console.log('✅ La tabla residuos ya tiene la columna subida_id');
      console.log('🎉 Base de datos ya está actualizada!');
      db.close();
    }
  });
});
