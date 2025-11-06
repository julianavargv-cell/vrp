const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const csv = require('csv-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Configuración de multer para subir archivos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage: storage });

// Crear directorio uploads si no existe
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Base de datos SQLite
const db = new sqlite3.Database('reconecta.db');

// Crear tablas
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS historial_subidas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre_archivo TEXT,
    fecha_subida DATETIME DEFAULT CURRENT_TIMESTAMP,
    registros_procesados INTEGER,
    peso_total REAL,
    ubicaciones_unicas INTEGER,
    estado TEXT DEFAULT 'procesado'
  )`);
  
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

// Función de geocodificación simplificada
async function geocodeBogotaAddress(address, city, department) {
  try {
    let cleanAddress = address.trim();
    let cleanCity = city ? city.trim() : '';
    let cleanDepartment = department ? department.trim() : '';
    
    if (cleanCity.toLowerCase().includes('bogota') || cleanCity.toLowerCase().includes('bogotá')) {
      cleanCity = 'Bogotá';
    }
    if (cleanDepartment.toLowerCase().includes('cundinamarca') || cleanDepartment.toLowerCase().includes('dc')) {
      cleanDepartment = 'Cundinamarca';
    }
    
    const fullAddress = `${cleanAddress}, ${cleanCity}, ${cleanDepartment}, Colombia`;
    
    console.log(`🔍 Geocodificando: ${fullAddress}`);
    
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
        
        const lat = result.latitude;
        const lon = result.longitude;
        
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

// Algoritmo VRP simplificado
class SimpleVRPAlgorithm {
  constructor(locations, vehicleCapacityKg = 1000) {
    this.locations = locations;
    this.vehicleCapacityKg = vehicleCapacityKg;
    this.depot = { lat: 4.6097, lon: -74.0817, peso: 0 };
    this.routes = [];
    this.totalDistance = 0;
    this.totalTime = 0;
    this.totalCost = 0;
    this.feasibleRoutes = 0;
    
    // Configuración simplificada
    this.workingHours = 9; // 9 horas de trabajo (8 AM - 5 PM)
    this.fuelCostPerKm = 0.15; // USD por km
    this.serviceTimePerLocation = 15; // minutos por ubicación
    this.depotServiceTime = 30; // minutos en depósito
    this.averageSpeed = 25; // km/h promedio en Bogotá
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

  solveVRP() {
    const routes = [];
    const unvisited = [...this.locations];
    let totalCost = 0;
    let totalDistance = 0;
    let totalTime = 0;
    
    // Algoritmo Nearest Neighbor simplificado
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
          
          if (currentLoad + unvisited[i].peso <= this.vehicleCapacityKg && distance < nearestDistance) {
            nearestDistance = distance;
            nearestIndex = i;
          }
        }
        
        if (nearestIndex === -1) break; // No hay más ubicaciones que quepan
        
        const nextLocation = unvisited.splice(nearestIndex, 1)[0];
        const distance = this.calculateDistance(
          currentLocation.lat, currentLocation.lon,
          nextLocation.lat, nextLocation.lon
        );
        
        route.push(nextLocation);
        currentLoad += nextLocation.peso;
        currentLocation = nextLocation;
      }
      
      // Volver al depósito
      const returnDistance = this.calculateDistance(
        currentLocation.lat, currentLocation.lon,
        this.depot.lat, this.depot.lon
      );
      
      route.push(this.depot);
      
      // Calcular métricas simplificadas
      let routeDistance = 0;
      for (let i = 0; i < route.length - 1; i++) {
        routeDistance += this.calculateDistance(
          route[i].lat, route[i].lon,
          route[i + 1].lat, route[i + 1].lon
        );
      }
      
      const routeTime = (routeDistance / this.averageSpeed) * 60 + (route.length - 2) * this.serviceTimePerLocation + this.depotServiceTime;
      const routeFuelCost = routeDistance * this.fuelCostPerKm;
      const isFeasible = routeTime <= (this.workingHours * 60);
      
      routes.push({
        locations: route,
        totalWeight: currentLoad,
        totalDistance: routeDistance,
        totalTime: routeTime,
        fuelCost: routeFuelCost,
        feasible: isFeasible,
        utilization: (currentLoad / this.vehicleCapacityKg) * 100
      });
      
      totalCost += routeFuelCost;
      totalDistance += routeDistance;
      totalTime += routeTime;
      
      if (isFeasible) {
        this.feasibleRoutes++;
      }
    }
    
    return {
      routes: routes,
      totalLocations: this.locations.length,
      totalRoutes: routes.length,
      totalDistance: totalDistance,
      totalTime: totalTime,
      totalCost: totalCost,
      feasibleRoutes: this.feasibleRoutes,
      averageUtilization: routes.length > 0 ? routes.reduce((sum, r) => sum + r.utilization, 0) / routes.length : 0
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

    console.log(`📁 Procesando archivo: ${fileName}`);

    // Primero registrar la subida en historial
    const historialStmt = db.prepare(`INSERT INTO historial_subidas (nombre_archivo) VALUES (?)`);
    historialStmt.run(fileName, function(err) {
      if (err) {
        console.error('Error registrando subida:', err);
        return res.status(500).json({ error: 'Error registrando subida' });
      }

      const subidaId = this.lastID;
      console.log(`📁 Nueva subida registrada: ID ${subidaId} - ${fileName}`);

      // Procesar CSV
      const results = [];
      let recordsProcessed = 0;
      let pesoTotal = 0;
      const ubicacionesUnicas = new Set();

      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (data) => {
          results.push(data);
          recordsProcessed++;
          
          const peso = parseFloat(data['Peso Disposición Final (kg)']) || 0;
          pesoTotal += peso;
          
          const direccion = data['Dirección'] || '';
          const ciudad = data['Ciudad'] || '';
          ubicacionesUnicas.add(`${direccion}, ${ciudad}`);
          
          console.log(`📝 Procesando: ${data['Razón Social']} - ${direccion}`);
        })
        .on('end', async () => {
          console.log(`📊 Total de registros leídos: ${recordsProcessed}`);
          
          // Geocodificar direcciones
          console.log(`🗺️ Iniciando geocodificación de direcciones...`);
          
          for (const data of results) {
            const direccion = data['Dirección'] || '';
            const ciudad = data['Ciudad'] || '';
            const departamento = data['Departamento'] || '';
            
            const geocodeResult = await geocodeBogotaAddress(direccion, ciudad, departamento);
            
            const stmt = db.prepare(`INSERT INTO residuos (
              subida_id, categoria, subcategoria, aplica_metas, fecha, manifiesto,
              nombre_residuo, peso_kg, canal_recoleccion, tipo_gestion, certificado,
              gestor, centro_acopio, razon_social, nit, responsable_envio, correo,
              direccion, departamento, ciudad, latitud, longitud, 
              direccion_geocodificada, confianza_geocodificacion
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            
            stmt.run(
              subidaId,
              data['Categoría'] || '',
              data['Subcategoria'] || '',
              data['Aplica Metas'] || '',
              data['Fecha'] || '',
              data['Manifiesto'] || '',
              data['Nombre de Residuo'] || '',
              parseFloat(data['Peso Disposición Final (kg)']) || 0,
              data['Canal de Recolección'] || '',
              data['Tipo de Gestión'] || '',
              data['Certificado'] || '',
              data['Gestor'] || '',
              data['Centro de Acopio'] || '',
              data['Razón Social'] || '',
              data['NIT'] || '',
              data['Responsable del Envío'] || '',
              data['Correo'] || '',
              direccion,
              departamento,
              ciudad,
              geocodeResult ? geocodeResult.lat : 4.6097,
              geocodeResult ? geocodeResult.lon : -74.0817,
              geocodeResult ? geocodeResult.address : direccion,
              geocodeResult ? geocodeResult.confidence : 'fallback'
            );
          }
          
          console.log(`✅ Geocodificación completada`);
          
          // Actualizar historial con estadísticas
          const updateStmt = db.prepare(`UPDATE historial_subidas SET 
            registros_procesados = ?, peso_total = ?, ubicaciones_unicas = ?
            WHERE id = ?`);
          
          updateStmt.run(recordsProcessed, pesoTotal, ubicacionesUnicas.size, subidaId);
          
          console.log(`✅ Subida ${subidaId} completada: ${recordsProcessed} registros, ${pesoTotal} kg, ${ubicacionesUnicas.size} ubicaciones`);
          console.log(`📊 Historial actualizado: ${recordsProcessed} registros, ${pesoTotal} kg, ${ubicacionesUnicas.size} ubicaciones`);
          
          // Limpiar archivo temporal
          fs.unlinkSync(filePath);
          
          res.json({
            message: 'Archivo procesado exitosamente',
            subidaId: subidaId,
            recordsProcessed: recordsProcessed,
            pesoTotal: pesoTotal,
            ubicacionesUnicas: ubicacionesUnicas.size
          });
        })
        .on('error', (error) => {
          console.error('Error procesando CSV:', error);
          res.status(500).json({ error: 'Error procesando archivo CSV' });
        });
    });
    
  } catch (error) {
    console.error('Error en upload:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Obtener datos agrupados por ubicación
app.get('/api/data', (req, res) => {
  const subidaId = req.query.subidaId;
  
  let query = `
    SELECT 
      direccion,
      ciudad,
      SUM(peso_kg) as peso_total,
      COUNT(*) as cantidad_residuos,
      GROUP_CONCAT(DISTINCT razon_social) as empresas,
      GROUP_CONCAT(DISTINCT nombre_residuo) as tipos_residuo,
      AVG(latitud) as latitud,
      AVG(longitud) as longitud
    FROM residuos 
    WHERE procesado = 0
  `;
  
  const params = [];
  if (subidaId) {
    query += ' AND subida_id = ?';
    params.push(subidaId);
  } else {
    query += ' AND subida_id = (SELECT MAX(id) FROM historial_subidas)';
  }
  
  query += ' GROUP BY direccion, ciudad ORDER BY peso_total DESC';
  
  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('Error obteniendo datos:', err);
      return res.status(500).json({ error: 'Error obteniendo datos' });
    }
    
    const locations = rows.map((row, index) => ({
      id: `location_${index}`,
      lat: row.latitud,
      lon: row.longitud,
      peso: row.peso_total,
      direccion: row.direccion,
      ciudad: row.ciudad,
      cantidad_residuos: row.cantidad_residuos,
      empresas: row.empresas,
      tipos_residuo: row.tipos_residuo
    }));
    
    console.log(`📍 ${locations.length} ubicaciones únicas encontradas para subida ${subidaId || 'más reciente'}`);
    
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
      SUM(peso_kg) as peso_total,
      AVG(latitud) as latitud,
      AVG(longitud) as longitud
    FROM residuos 
    WHERE procesado = 0
  `;
  
  const params = [];
  if (subidaId) {
    query += ' AND subida_id = ?';
    params.push(subidaId);
  } else {
    query += ' AND subida_id = (SELECT MAX(id) FROM historial_subidas)';
  }
  
  query += ' GROUP BY direccion, ciudad ORDER BY peso_total DESC';
  
  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('Error obteniendo datos para VRP:', err);
      return res.status(500).json({ error: 'Error obteniendo datos' });
    }
    
    const locations = rows.map(row => ({
      lat: row.latitud,
      lon: row.longitud,
      peso: row.peso_total,
      direccion: row.direccion,
      ciudad: row.ciudad
    }));
    
    console.log(`🚛 Calculando rutas VRP para ${locations.length} ubicaciones únicas (subida ${subidaId || 'más reciente'})`);
    
    const vrp = new SimpleVRPAlgorithm(locations, vehicleCapacity);
    const result = vrp.solveVRP();
    
    // Calcular días de trabajo necesarios
    const workingDaysNeeded = Math.ceil(result.totalTime / (9 * 60)); // 9 horas por día
    
    const analysis = {
      totalVehicles: result.totalRoutes,
      totalWorkingDays: workingDaysNeeded,
      averageUtilization: result.averageUtilization,
      feasibleRoutes: result.feasibleRoutes,
      totalCost: result.totalCost,
      costPerTon: result.totalCost / (result.routes.reduce((sum, r) => sum + r.totalWeight, 0) / 1000)
    };
    
    res.json({
      routes: result.routes,
      analysis: analysis,
      totalLocations: result.totalLocations,
      totalDistance: result.totalDistance,
      totalTime: result.totalTime
    });
  });
});

// Obtener historial de subidas
app.get('/api/historial', (req, res) => {
  db.all('SELECT * FROM historial_subidas ORDER BY fecha_subida DESC', (err, rows) => {
    if (err) {
      console.error('Error obteniendo historial:', err);
      return res.status(500).json({ error: 'Error obteniendo historial' });
    }
    res.json(rows);
  });
});

// Obtener detalles de una subida específica
app.get('/api/subida/:id', (req, res) => {
  const subidaId = req.params.id;
  
  db.get('SELECT * FROM historial_subidas WHERE id = ?', [subidaId], (err, row) => {
    if (err) {
      console.error('Error obteniendo subida:', err);
      return res.status(500).json({ error: 'Error obteniendo subida' });
    }
    
    if (!row) {
      return res.status(404).json({ error: 'Subida no encontrada' });
    }
    
    // Calcular capacidad recomendada
    const capacidadRecomendadaToneladas = Math.ceil(row.peso_total / 1000);
    const pesoTotalToneladas = row.peso_total / 1000;
    
    res.json({
      ...row,
      capacidadRecomendadaToneladas: capacidadRecomendadaToneladas,
      pesoTotalToneladas: pesoTotalToneladas
    });
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor ejecutándose en http://localhost:${PORT}`);
});
