const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const NodeGeocoder = require('node-geocoder');

const app = express();
const PORT = process.env.PORT || 3000;

// Función mejorada para geocodificar direcciones de Bogotá
async function geocodeBogotaAddress(address, city, department) {
  try {
    // Limpiar y formatear la dirección para Bogotá
    let cleanAddress = address.trim();
    let cleanCity = city ? city.trim() : '';
    let cleanDepartment = department ? department.trim() : '';
    
    // Normalizar nombres comunes
    if (cleanCity.toLowerCase().includes('bogota') || cleanCity.toLowerCase().includes('bogotá')) {
      cleanCity = 'Bogotá';
    }
    if (cleanDepartment.toLowerCase().includes('cundinamarca') || cleanDepartment.toLowerCase().includes('dc')) {
      cleanDepartment = 'Cundinamarca';
    }
    
    // Construir dirección completa para geocodificación
    const fullAddress = `${cleanAddress}, ${cleanCity}, ${cleanDepartment}, Colombia`;
    
    console.log(`🔍 Geocodificando: ${fullAddress}`);
    
    // Usar Nominatim API (OpenStreetMap) - gratuita y sin límites estrictos
    const geocoder = require('node-geocoder');
    const options = {
      provider: 'openstreetmap',
      httpAdapter: 'https',
      formatter: null
    };
    
    const geocoderInstance = geocoder(options);
    
    try {
      const results = await geocoderInstance.geocode(fullAddress);
      
      if (results && results.length > 0) {
        const result = results[0];
        
        // Verificar que las coordenadas estén en el área de Bogotá
        const lat = result.latitude;
        const lon = result.longitude;
        
        // Coordenadas aproximadas del área metropolitana de Bogotá
        const bogotaBounds = {
          north: 4.8,
          south: 4.3,
          east: -73.9,
          west: -74.3
        };
        
        if (lat >= bogotaBounds.south && lat <= bogotaBounds.north &&
            lon >= bogotaBounds.west && lon <= bogotaBounds.east) {
          
          console.log(`✅ Dirección válida encontrada: ${result.formattedAddress}`);
          return {
            lat: lat,
            lon: lon,
            address: result.formattedAddress,
            confidence: 'high'
          };
        } else {
          console.log(`⚠️ Dirección fuera del área metropolitana de Bogotá`);
          return null;
        }
      }
    } catch (geocodeError) {
      console.log(`❌ Error en geocodificación: ${geocodeError.message}`);
    }
    
    // Fallback: coordenadas aleatorias dentro de Bogotá si no se encuentra la dirección
    console.log(`🔄 Usando coordenadas de fallback para: ${cleanAddress}`);
    return {
      lat: 4.6097 + (Math.random() - 0.5) * 0.1,
      lon: -74.0817 + (Math.random() - 0.5) * 0.1,
      address: fullAddress,
      confidence: 'low'
    };
    
  } catch (error) {
    console.error('Error en geocodificación:', error);
    return null;
  }
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configuración de multer para subida de archivos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || path.extname(file.originalname) === '.csv') {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos CSV'));
    }
  }
});

// Configuración de geocoder
const geocoder = NodeGeocoder({
  provider: 'openstreetmap'
});

// Crear directorio uploads si no existe
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Inicializar base de datos SQLite
const db = new sqlite3.Database('reconecta.db');

// Crear tablas para almacenar datos del CSV con historial
db.serialize(() => {
  // Tabla para historial de subidas
  db.run(`CREATE TABLE IF NOT EXISTS historial_subidas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre_archivo TEXT,
    fecha_subida DATETIME DEFAULT CURRENT_TIMESTAMP,
    registros_procesados INTEGER,
    peso_total REAL,
    ubicaciones_unicas INTEGER,
    estado TEXT DEFAULT 'procesado'
  )`);
  
  // Tabla para almacenar datos del CSV con referencia a subida
        db.run(`CREATE TABLE IF NOT EXISTS residuos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          subida_id INTEGER,
          categoria TEXT,
          subcategoria TEXT,
          aplica_metas TEXT,
          fecha TEXT,
          manifiesto TEXT,
          nombre_residuo TEXT,
          peso_kg REAL,
          canal_recoleccion TEXT,
          tipo_gestion TEXT,
          certificado TEXT,
          gestor TEXT,
          centro_acopio TEXT,
          razon_social TEXT,
          nit TEXT,
          responsable_envio TEXT,
          correo TEXT,
          direccion TEXT,
          departamento TEXT,
          ciudad TEXT,
          latitud REAL,
          longitud REAL,
          direccion_geocodificada TEXT,
          confianza_geocodificacion TEXT,
          procesado INTEGER DEFAULT 0,
          FOREIGN KEY (subida_id) REFERENCES historial_subidas (id)
        )`);
});

// Algoritmo VRP avanzado con restricciones de Bogotá
class VRPAlgorithm {
  constructor(locations, vehicleCapacity = 1000) {
    this.locations = locations;
    this.vehicleCapacity = vehicleCapacity; // en kg
    this.depot = { lat: 4.6097, lon: -74.0817, peso: 0 }; // Bogotá centro
    
    // Restricciones operacionales
    this.workingHours = {
      start: 8, // 8:00 AM
      end: 17   // 5:00 PM
    };
    this.workingMinutes = (this.workingHours.end - this.workingHours.start) * 60; // 540 minutos
    
    // Parámetros de Bogotá
    this.averageSpeed = 25; // km/h promedio en Bogotá (considerando tráfico)
    this.fuelCostPerKm = 0.15; // USD por km
    this.serviceTimePerLocation = 15; // minutos por ubicación
    this.depotServiceTime = 30; // minutos en depósito
    
    // Factores de tráfico por hora
    this.trafficFactors = {
      8: 1.2,   // Hora pico mañana
      9: 1.5,
      10: 1.3,
      11: 1.1,
      12: 1.0, // Hora valle
      13: 1.0,
      14: 1.1,
      15: 1.3,
      16: 1.5, // Hora pico tarde
      17: 1.2
    };
  }

  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radio de la Tierra en km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  calculateTravelTime(distance, hour) {
    const trafficFactor = this.trafficFactors[hour] || 1.0;
    const effectiveSpeed = this.averageSpeed / trafficFactor;
    return (distance / effectiveSpeed) * 60; // minutos
  }

  calculateRouteCost(route) {
    let totalDistance = 0;
    let totalTime = 0;
    let currentHour = this.workingHours.start;
    
    for (let i = 0; i < route.length - 1; i++) {
      const distance = this.calculateDistance(
        route[i].lat, route[i].lon,
        route[i + 1].lat, route[i + 1].lon
      );
      
      const travelTime = this.calculateTravelTime(distance, Math.floor(currentHour));
      totalDistance += distance;
      totalTime += travelTime;
      
      // Tiempo de servicio
      if (i === 0) {
        totalTime += this.depotServiceTime; // Tiempo en depósito
      } else {
        totalTime += this.serviceTimePerLocation; // Tiempo en ubicación
      }
      
      currentHour += travelTime / 60;
    }
    
    return {
      distance: totalDistance,
      time: totalTime,
      fuelCost: totalDistance * this.fuelCostPerKm,
      feasible: totalTime <= this.workingMinutes
    };
  }

  solveVRP() {
    const routes = [];
    const unvisited = [...this.locations];
    let totalCost = 0;
    let totalDistance = 0;
    let totalTime = 0;
    
    // Algoritmo simplificado Nearest Neighbor
    while (unvisited.length > 0) {
      const route = [this.depot];
      let currentLoad = 0;
      let currentLocation = this.depot;
      
      while (unvisited.length > 0) {
        let nearestIndex = -1;
        let nearestDistance = Infinity;
        
        for (let i = 0; i < unvisited.length; i++) {
          const distance = this.calculateDistance(
            currentLocation.lat, currentLocation.lon,
            unvisited[i].lat, unvisited[i].lon
          );
          
          // Verificar capacidad
          if (currentLoad + unvisited[i].peso > this.vehicleCapacity) {
            continue;
          }
          
          // Calcular score considerando distancia, peso y tiempo
          const weightFactor = unvisited[i].peso / this.vehicleCapacity;
          const distanceFactor = 1 / (1 + distance);
          const score = distanceFactor + weightFactor * 0.5;
          
          if (score > bestScore) {
            bestScore = score;
            bestIndex = i;
          }
        }
        
        if (bestIndex === -1) break;
        
        const nextLocation = unvisited[bestIndex];
        route.push(nextLocation);
        currentLoad += nextLocation.peso;
        currentLocation = nextLocation;
        unvisited.splice(bestIndex, 1);
      }
      
      route.push(this.depot);
      
      // Calcular métricas de la ruta
      const routeMetrics = this.calculateRouteCost(route);
      
      if (!routeMetrics.feasible) {
        console.log(`⚠️ Ruta no factible por tiempo: ${routeMetrics.time.toFixed(1)} min > ${this.workingMinutes} min`);
      }
      
      routes.push({
        locations: route,
        load: currentLoad,
        capacity: this.vehicleCapacity,
        utilization: (currentLoad / this.vehicleCapacity) * 100,
        ...routeMetrics
      });
      
      totalCost += routeMetrics.fuelCost;
      totalDistance += routeMetrics.distance;
      totalTime += routeMetrics.time;
    }
    
    return {
      routes: routes,
      totalRoutes: routes.length,
      totalLocations: this.locations.length,
      totalCost: totalCost,
      totalDistance: totalDistance,
      totalTime: totalTime,
      averageUtilization: routes.reduce((sum, r) => sum + r.utilization, 0) / routes.length,
      feasibleRoutes: routes.filter(r => r.feasible).length
    };
  }
}

// Rutas de la API

// Subir archivo CSV
app.post('/upload', upload.single('csvFile'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se subió ningún archivo' });
    }

    const filePath = req.file.path;
    const fileName = req.file.originalname;
    const results = [];

    // Crear registro de historial de subida usando callback
    db.run(`INSERT INTO historial_subidas (nombre_archivo) VALUES (?)`, [fileName], function(err) {
      if (err) {
        console.error('Error creando historial:', err);
        return res.status(500).json({ error: 'Error creando historial de subida' });
      }
      
      const subidaId = this.lastID;
      console.log(`📁 Nueva subida registrada: ID ${subidaId} - ${fileName}`);

      // Leer y procesar el archivo CSV
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (data) => {
          // Limpiar y procesar los datos
          const processedData = {
            subida_id: subidaId,
            categoria: data['Categoría'] || '',
            subcategoria: data['Subcategoria'] || '',
            aplica_metas: data['APLICA EN LAS METAS ACTUALES'] || '',
            fecha: data['Fecha'] || '',
            manifiesto: data['Manifiesto'] || '',
            nombre_residuo: data['Nombre de Residuo'] || '',
            peso_kg: parseFloat((data['Peso Disposición Final (kg) '] || '0').replace(',', '.')),
            canal_recoleccion: data['Canal o Mecanismo de recolección'] || '',
            tipo_gestion: data['Tipo de Gestión (proceso)'] || '',
            certificado: data['certificado '] || '',
            gestor: data['Gestor '] || '',
            centro_acopio: data['Centro de acopio'] || '',
            razon_social: data['Razón social del generador'] || '',
            nit: data['Nit'] || '',
            responsable_envio: data['Responsable del envío'] || '',
            correo: data['Correo '] || '',
            direccion: data['Dirección'] || '',
            departamento: data['Departamento'] || '',
            ciudad: data['Ciudad'] || '',
            latitud: null, // Se calculará con geocodificación
            longitud: null // Se calculará con geocodificación
          };

          console.log(`📝 Procesando: ${processedData.razon_social} - ${processedData.direccion}`);
          results.push(processedData);
        })
        .on('end', async () => {
          console.log(`📊 Total de registros leídos: ${results.length}`);
          
          // Geocodificar direcciones
          console.log('🗺️ Iniciando geocodificación de direcciones...');
          for (let i = 0; i < results.length; i++) {
            const data = results[i];
            if (data.direccion && data.ciudad) {
              try {
                const geocodeResult = await geocodeBogotaAddress(data.direccion, data.ciudad, data.departamento);
                if (geocodeResult) {
                  data.latitud = geocodeResult.lat;
                  data.longitud = geocodeResult.lon;
                  data.direccion_geocodificada = geocodeResult.address;
                  data.confianza_geocodificacion = geocodeResult.confidence;
                } else {
                  // Usar coordenadas de fallback
                  data.latitud = 4.6097 + (Math.random() - 0.5) * 0.1;
                  data.longitud = -74.0817 + (Math.random() - 0.5) * 0.1;
                  data.direccion_geocodificada = `${data.direccion}, ${data.ciudad}, ${data.departamento}`;
                  data.confianza_geocodificacion = 'low';
                }
              } catch (error) {
                console.error(`Error geocodificando ${data.direccion}:`, error);
                // Usar coordenadas de fallback
                data.latitud = 4.6097 + (Math.random() - 0.5) * 0.1;
                data.longitud = -74.0817 + (Math.random() - 0.5) * 0.1;
                data.direccion_geocodificada = `${data.direccion}, ${data.ciudad}, ${data.departamento}`;
                data.confianza_geocodificacion = 'low';
              }
            }
          }
          console.log('✅ Geocodificación completada');
          
          // Insertar datos en la base de datos
          const stmt = db.prepare(`INSERT INTO residuos (
            subida_id, categoria, subcategoria, aplica_metas, fecha, manifiesto, nombre_residuo,
            peso_kg, canal_recoleccion, tipo_gestion, certificado, gestor, centro_acopio,
            razon_social, nit, responsable_envio, correo, direccion, departamento, ciudad,
            latitud, longitud, direccion_geocodificada, confianza_geocodificacion
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

          let insertedCount = 0;
          let pesoTotal = 0;
          results.forEach(data => {
            try {
              stmt.run([
                data.subida_id, data.categoria, data.subcategoria, data.aplica_metas, data.fecha,
                data.manifiesto, data.nombre_residuo, data.peso_kg, data.canal_recoleccion,
                data.tipo_gestion, data.certificado, data.gestor, data.centro_acopio,
                data.razon_social, data.nit, data.responsable_envio, data.correo,
                data.direccion, data.departamento, data.ciudad, data.latitud, data.longitud,
                data.direccion_geocodificada, data.confianza_geocodificacion
              ]);
              insertedCount++;
              pesoTotal += data.peso_kg;
            } catch (error) {
              console.error('Error insertando registro:', error);
            }
          });

          stmt.finalize();

          // Contar ubicaciones únicas para esta subida
          db.get(`SELECT COUNT(DISTINCT direccion || ciudad) as ubicaciones_unicas FROM residuos WHERE subida_id = ?`, [subidaId], (err, row) => {
            if (err) {
              console.error('Error contando ubicaciones:', err);
            }

            // Actualizar historial con estadísticas
            db.run(`UPDATE historial_subidas SET 
              registros_procesados = ?, 
              peso_total = ?, 
              ubicaciones_unicas = ? 
              WHERE id = ?`, [insertedCount, pesoTotal, row ? row.ubicaciones_unicas : 0, subidaId], (err) => {
              if (err) {
                console.error('Error actualizando historial:', err);
              } else {
                console.log(`📊 Historial actualizado: ${insertedCount} registros, ${pesoTotal.toFixed(1)} kg, ${row ? row.ubicaciones_unicas : 0} ubicaciones`);
              }
            });

            // Limpiar archivo temporal
            fs.unlinkSync(filePath);

            console.log(`✅ Subida ${subidaId} completada: ${insertedCount} registros, ${pesoTotal.toFixed(1)} kg, ${row ? row.ubicaciones_unicas : 0} ubicaciones`);
            res.json({ 
              message: 'Archivo procesado exitosamente',
              subidaId: subidaId,
              recordsProcessed: insertedCount,
              pesoTotal: pesoTotal,
              ubicacionesUnicas: row ? row.ubicaciones_unicas : 0
            });
          });
        })
        .on('error', (error) => {
          console.error('Error procesando CSV:', error);
          res.status(500).json({ error: 'Error procesando el archivo CSV' });
        });
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Obtener historial de subidas
app.get('/api/historial', (req, res) => {
  db.all(`SELECT * FROM historial_subidas ORDER BY fecha_subida DESC`, (err, rows) => {
    if (err) {
      console.error('Error consultando historial:', err);
      return res.status(500).json({ error: 'Error consultando historial' });
    }
    res.json(rows);
  });
});

// Obtener estadísticas de una subida específica
app.get('/api/subida/:id', (req, res) => {
  const subidaId = req.params.id;
  
  db.get(`SELECT * FROM historial_subidas WHERE id = ?`, [subidaId], (err, row) => {
    if (err) {
      console.error('Error consultando subida:', err);
      return res.status(500).json({ error: 'Error consultando subida' });
    }
    
    if (!row) {
      return res.status(404).json({ error: 'Subida no encontrada' });
    }
    
    // Calcular capacidad recomendada del camión (en toneladas)
    const pesoTotalKg = row.peso_total || 0;
    const capacidadRecomendadaToneladas = Math.ceil(pesoTotalKg / 1000); // Convertir kg a toneladas y redondear hacia arriba
    
    res.json({
      ...row,
      capacidadRecomendadaToneladas: capacidadRecomendadaToneladas,
      pesoTotalToneladas: (pesoTotalKg / 1000).toFixed(2)
    });
  });
});

// Obtener datos para VRP (solo de la subida especificada)
app.get('/api/data', (req, res) => {
  const { subidaId } = req.query;
  
  if (!subidaId) {
    return res.json([]); // Si no hay subidaId, devolver array vacío
  }
  
  const query = `
    SELECT 
      direccion,
      ciudad,
      AVG(latitud) as latitud_promedio,
      AVG(longitud) as longitud_promedio,
      SUM(peso_kg) as peso_total,
      COUNT(*) as cantidad_residuos,
      GROUP_CONCAT(DISTINCT razon_social) as empresas,
      GROUP_CONCAT(DISTINCT nombre_residuo) as tipos_residuo
    FROM residuos 
    WHERE latitud IS NOT NULL AND longitud IS NOT NULL 
    AND subida_id = ?
    GROUP BY direccion, ciudad 
    ORDER BY peso_total DESC
  `;
  
  db.all(query, [subidaId], (err, rows) => {
    if (err) {
      console.error('Error consultando base de datos:', err);
      return res.status(500).json({ error: 'Error consultando datos' });
    }
    
    const locations = rows.map((row, index) => ({
      id: `location_${index}`,
      lat: row.latitud_promedio,
      lon: row.longitud_promedio,
      peso: row.peso_total,
      direccion: row.direccion,
      ciudad: row.ciudad,
      cantidad_residuos: row.cantidad_residuos,
      empresas: row.empresas.split(',').slice(0, 3).join(', '), // Máximo 3 empresas
      tipos_residuo: row.tipos_residuo.split(',').slice(0, 2).join(', ') // Máximo 2 tipos
    }));
    
    console.log(`📍 ${locations.length} ubicaciones únicas encontradas para subida ${subidaId}`);
    res.json(locations);
  });
});

// Calcular rutas VRP
app.post('/api/calculate-routes', (req, res) => {
  const { vehicleCapacity = 1000, subidaId } = req.body;
  
  let query = `
    SELECT 
      direccion,
      ciudad,
      AVG(latitud) as latitud_promedio,
      AVG(longitud) as longitud_promedio,
      SUM(peso_kg) as peso_total,
      COUNT(*) as cantidad_residuos,
      GROUP_CONCAT(DISTINCT razon_social) as empresas,
      GROUP_CONCAT(DISTINCT nombre_residuo) as tipos_residuo
    FROM residuos 
    WHERE latitud IS NOT NULL AND longitud IS NOT NULL 
  `;
  
  const params = [];
  if (subidaId) {
    query += ` AND subida_id = ?`;
    params.push(subidaId);
  } else {
    // Si no se especifica subida, usar la más reciente
    query += ` AND subida_id = (SELECT id FROM historial_subidas ORDER BY fecha_subida DESC LIMIT 1)`;
  }
  
  query += ` GROUP BY direccion, ciudad ORDER BY peso_total DESC`;
  
  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('Error consultando base de datos:', err);
      return res.status(500).json({ error: 'Error consultando datos' });
    }
    
    const locations = rows.map((row, index) => ({
      id: `location_${index}`,
      lat: row.latitud_promedio,
      lon: row.longitud_promedio,
      peso: row.peso_total,
      direccion: row.direccion,
      ciudad: row.ciudad,
      cantidad_residuos: row.cantidad_residuos,
      empresas: row.empresas.split(',').slice(0, 3).join(', '),
      tipos_residuo: row.tipos_residuo.split(',').slice(0, 2).join(', ')
    }));
    
    console.log(`🚛 Calculando rutas VRP para ${locations.length} ubicaciones únicas${subidaId ? ` (subida ${subidaId})` : ' (última subida)'}`);
    const vrp = new VRPAlgorithm(locations, vehicleCapacity);
    const result = vrp.solveVRP();
    
    // Calcular días necesarios
    const workingDaysNeeded = Math.ceil(result.totalTime / (9 * 60)); // 9 horas por día
    
    res.json({
      ...result,
      workingDaysNeeded: workingDaysNeeded,
      analysis: {
        totalVehicles: result.totalRoutes,
        totalWorkingDays: workingDaysNeeded,
        averageUtilization: result.averageUtilization,
        feasibleRoutes: result.feasibleRoutes,
        totalCost: result.totalCost,
        costPerTon: result.totalCost / (locations.reduce((sum, loc) => sum + loc.peso, 0) / 1000)
      },
      subidaId: subidaId || 'ultima'
    });
  });
});

// Servir archivos estáticos
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor ejecutándose en http://localhost:${PORT}`);
});

// Manejo de errores
process.on('SIGINT', () => {
  console.log('\nCerrando servidor...');
  db.close();
  process.exit(0);
});
