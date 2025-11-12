const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const csv = require('fast-csv');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const utm = require('utm');
const ProfessionalVRPAlgorithm = require('./professional-vrp');
const { agruparPorLocalidad, obtenerEstadisticasLocalidades } = require('./bogota-localidades');

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

// Manejar favicon.ico ANTES del middleware estático para evitar error 404
app.get('/favicon.ico', (req, res) => {
  res.status(204).end(); // 204 No Content
});

// Middleware estático (después de la ruta del favicon)
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
    utm_x REAL,
    utm_y REAL,
    utm_zona TEXT,
    direccion_geocodificada TEXT,
    confianza_geocodificacion TEXT,
    procesado INTEGER DEFAULT 0,
    FOREIGN KEY (subida_id) REFERENCES historial_subidas (id)
  )`);
  
  // Migración: Agregar columnas UTM si no existen (para bases de datos antiguas)
  db.run(`ALTER TABLE residuos ADD COLUMN utm_x REAL`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      // Ignorar errores de columna duplicada, significa que ya existe
    }
  });
  db.run(`ALTER TABLE residuos ADD COLUMN utm_y REAL`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      // Ignorar errores de columna duplicada, significa que ya existe
    }
  });
  db.run(`ALTER TABLE residuos ADD COLUMN utm_zona TEXT`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      // Ignorar errores de columna duplicada, significa que ya existe
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS rutas_calculadas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subida_id INTEGER NOT NULL,
    fecha_calculo DATETIME DEFAULT CURRENT_TIMESTAMP,
    tipo_vehiculo TEXT NOT NULL DEFAULT 'camion',
    capacidad_vehiculo_kg REAL NOT NULL,
    capacidad_vehiculo_m3 REAL DEFAULT NULL,
    total_rutas INTEGER NOT NULL,
    rutas_validas INTEGER NOT NULL,
    peso_total_kg REAL NOT NULL,
    distancia_total_km REAL NOT NULL,
    tiempo_total_minutos REAL NOT NULL,
    costo_total_usd REAL NOT NULL,
    dias_trabajo INTEGER NOT NULL,
    utilizacion_promedio REAL NOT NULL,
    rutas_json TEXT NOT NULL,
    vehiculos_disponibles TEXT DEFAULT NULL,
    FOREIGN KEY (subida_id) REFERENCES historial_subidas (id)
  )`);
  
  // Agregar columna vehiculos_disponibles si no existe (para bases de datos existentes)
  db.run(`ALTER TABLE rutas_calculadas ADD COLUMN vehiculos_disponibles TEXT DEFAULT NULL`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      // Ignorar errores de columna duplicada, significa que ya existe
    }
  });
  
  // Tabla para guardar vehículos personalizados
  db.run(`CREATE TABLE IF NOT EXISTS vehiculos_personalizados (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE,
    tipo TEXT NOT NULL,
    capacidad_kg REAL NOT NULL,
    costo_viaje REAL NOT NULL,
    fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion DATETIME DEFAULT CURRENT_TIMESTAMP
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
    
    // OPTIMIZACIÓN: Timeout más agresivo (2 segundos máximo)
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => resolve(null), 2000); // 2 segundos máximo
    });
    
    const geocodePromise = (async () => {
      try {
    const geocoder = require('node-geocoder');
    const options = {
      provider: 'openstreetmap',
      httpAdapter: 'https',
          formatter: null,
          timeout: 1500 // Timeout de 1.5 segundos
    };
    
    const geocoderInstance = geocoder(options);
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
          return {
            lat: lat,
            lon: lon,
            address: result.formattedAddress,
            confidence: 'high'
          };
        }
      }
    } catch (geocodeError) {
        // Error silencioso, usar fallback
      }
      return null;
    })();
    
    // Usar el que responda primero (geocodificación o timeout)
    const result = await Promise.race([geocodePromise, timeoutPromise]);
    
    if (result) {
      return result;
    }
    
    // Si timeout o sin resultado, usar coordenadas de fallback rápidamente
    // Generar coordenadas aleatorias dentro de Bogotá de forma más determinística
    const hash = cleanAddress.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const latOffset = ((hash % 1000) / 10000) - 0.05; // -0.05 a +0.05
    const lonOffset = (((hash * 7) % 1000) / 10000) - 0.05;
    
    return {
      lat: 4.6097 + latOffset,
      lon: -74.0817 + lonOffset,
      address: fullAddress,
      confidence: 'low'
    };
    
  } catch (error) {
    // En caso de error, usar fallback inmediato
    const hash = address.trim().split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const latOffset = ((hash % 1000) / 10000) - 0.05;
    const lonOffset = (((hash * 7) % 1000) / 10000) - 0.05;
    
    return {
      lat: 4.6097 + latOffset,
      lon: -74.0817 + lonOffset,
      address: `${address}, ${city}, ${department}, Colombia`,
      confidence: 'low'
    };
  }
}

// Configuración de vehículos (SOLO VALORES POR DEFECTO - FALLBACK)
// ⚠️ IMPORTANTE: Estas capacidades NO se usan si el usuario ha configurado vehículos.
// Solo se utilizan como último recurso cuando no hay configuraciones dinámicas del usuario.
// Las capacidades reales vienen de las configuraciones que el usuario define mediante
// los botones "Añadir Vehículo" y "Editar Vehículos" en la interfaz.
const VEHICLE_TYPES = {
  camion: {
    name: 'Camión',
    capacityKg: 5500, // ⚠️ Solo fallback - se reemplaza por configuración del usuario
    capacityM3: null,
    fuelCostPerKm: 0.15,
    averageSpeedKmH: 25,
    serviceTimePerLocationMin: 15,
    depotServiceTimeMin: 30,
    costPerHour: 25, // USD por hora
    description: 'Camión de carga pesada'
  },
  moto: {
    name: 'Moto',
    capacityKg: 150, // ⚠️ Solo fallback - se reemplaza por configuración del usuario
    capacityM3: 1.0,
    fuelCostPerKm: 0.05,
    averageSpeedKmH: 35,
    serviceTimePerLocationMin: 10,
    depotServiceTimeMin: 15,
    costPerHour: 8, // USD por hora
    description: 'Moto para entregas ligeras'
  }
};

// Configuración VRP
const VRP_CONFIG = {
  workingHours: 9, // 8 AM a 5 PM = 9 horas
  trafficFactors: {
    morning: 1.3,    // 8-10 AM: tráfico pesado
    midday: 1.1,     // 10 AM-2 PM: tráfico moderado
    afternoon: 1.4,  // 2-5 PM: tráfico pesado
    evening: 1.0     // 5+ PM: tráfico ligero
  }
};

// Algoritmo VRP Híbrido Multi-Vehículo
class HybridVRPAlgorithm {
  constructor(locations, vehicleConfigs = null) {
    this.locations = locations;
    // Bodega: Parque Industrial San Jorge, Cll 93A # 13 - 24P, Mosquera, Cundinamarca
    this.depot = { lat: 4.715254, lon: -74.242008, peso: 0 };
    // Usar configuraciones proporcionadas o valores por defecto
    if (vehicleConfigs && vehicleConfigs.camion && vehicleConfigs.moto) {
      this.camionConfig = vehicleConfigs.camion;
      this.motoConfig = vehicleConfigs.moto;
    } else {
      // Valores por defecto si no se proporcionan
    this.camionConfig = VEHICLE_TYPES.camion;
    this.motoConfig = VEHICLE_TYPES.moto;
    }
    this.routes = [];
  }

  // Calcular rutas híbridas optimizadas
  calculateHybridRoutes() {
    console.log('🚀 Iniciando VRP Híbrido Multi-Vehículo con Clustering...');
    console.log(`📍 ${this.locations.length} ubicaciones a procesar`);

    // PASO 1: Agrupar por localidades de Bogotá (clustering geográfico)
    console.log('🏘️ Agrupando ubicaciones por localidades de Bogotá...');
    const gruposPorLocalidad = agruparPorLocalidad(this.locations);
    const estadisticas = obtenerEstadisticasLocalidades(gruposPorLocalidad);
    
    console.log(`✅ ${Object.keys(gruposPorLocalidad).length} localidades identificadas:`);
    estadisticas.forEach(stat => {
      console.log(`   📍 ${stat.localidad}: ${stat.cantidad} ubicaciones, ${stat.pesoTotal.toFixed(1)}kg`);
    });

    // PASO 2: Crear rutas por localidad
    const allRoutes = [];
    const localidadRoutes = {};
    const ubicacionesCompletas = this.locations;

    for (const [localidad, ubicacionesLocalidad] of Object.entries(gruposPorLocalidad)) {
      if (ubicacionesLocalidad.length === 0) continue;
      
      console.log(`\n🏘️ Procesando localidad: ${localidad} (${ubicacionesLocalidad.length} ubicaciones)`);
      
      // Usar solo ubicaciones de esta localidad
      this.locations = ubicacionesLocalidad;
      
      // Clasificar ubicaciones por tipo de vehículo óptimo
    const vehicleAssignments = this.classifyLocationsByVehicle();
    
      // Crear rutas para cada tipo de vehículo en esta localidad
    const camionRoutes = this.createRoutesForVehicle(vehicleAssignments.camion, 'camion');
    const motoRoutes = this.createRoutesForVehicle(vehicleAssignments.moto, 'moto');
    
      // Agregar información de localidad a las rutas
      camionRoutes.forEach(route => {
        route.localidad = localidad;
      });
      motoRoutes.forEach(route => {
        route.localidad = localidad;
      });
      
      allRoutes.push(...camionRoutes, ...motoRoutes);
      localidadRoutes[localidad] = {
        camion: camionRoutes.length,
        moto: motoRoutes.length,
        total: camionRoutes.length + motoRoutes.length
      };
      
      console.log(`   ✅ ${localidad}: ${camionRoutes.length} rutas camión, ${motoRoutes.length} rutas moto`);
      
      // Restaurar locations originales
      this.locations = ubicacionesCompletas;
    }
    
    // Restaurar locations completa
    this.locations = ubicacionesCompletas;
    
    // PASO 3: Calcular métricas combinadas
    const metrics = this.calculateCombinedMetrics(allRoutes);
    
    console.log(`\n🎯 VRP Híbrido con Clustering completado:`);
    console.log(`   🗺️  Localidades procesadas: ${estadisticas.length}`);
    console.log(`   🚛 Rutas camión: ${allRoutes.filter(r => r.vehicleType === 'camion').length}`);
    console.log(`   🏍️ Rutas moto: ${allRoutes.filter(r => r.vehicleType === 'moto').length}`);
    console.log(`   📊 Total rutas: ${allRoutes.length}`);
    console.log(`   💰 Costo total: $${metrics.totalCost.toFixed(2)}`);
    console.log(`   ⏱️ Tiempo total: ${metrics.totalTime.toFixed(1)} min`);
    console.log(`   📦 Peso total: ${metrics.totalWeight.toFixed(1)} kg`);
    
    console.log(`\n📋 Resumen por localidad:`);
    for (const [localidad, stats] of Object.entries(localidadRoutes)) {
      console.log(`   ${localidad}: ${stats.total} rutas (🚛${stats.camion} 🏍️${stats.moto})`);
    }

    // Calcular vehicleBreakdown total
    const totalCamionWeight = allRoutes
      .filter(r => r.vehicleType === 'camion')
      .reduce((sum, r) => sum + (r.totalWeight || 0), 0);
    const totalMotoWeight = allRoutes
      .filter(r => r.vehicleType === 'moto')
      .reduce((sum, r) => sum + (r.totalWeight || 0), 0);
    const totalCamionLocations = allRoutes
      .filter(r => r.vehicleType === 'camion')
      .reduce((sum, r) => sum + ((r.locations || r.stops || []).length - 2), 0); // -2 para excluir depósitos
    const totalMotoLocations = allRoutes
      .filter(r => r.vehicleType === 'moto')
      .reduce((sum, r) => sum + ((r.locations || r.stops || []).length - 2), 0);

    return {
      routes: allRoutes,
      metrics: metrics,
      vehicleBreakdown: {
        camion: {
          routes: allRoutes.filter(r => r.vehicleType === 'camion').length,
          weight: totalCamionWeight,
          locations: totalCamionLocations
        },
        moto: {
          routes: allRoutes.filter(r => r.vehicleType === 'moto').length,
          weight: totalMotoWeight,
          locations: totalMotoLocations
        }
      },
      localidades: estadisticas
    };
  }

  // Clasificar ubicaciones según el vehículo más eficiente
  classifyLocationsByVehicle() {
    const camionLocations = [];
    const motoLocations = [];

    console.log('🔍 Clasificando ubicaciones por vehículo óptimo...');

    for (const location of this.locations) {
      const assignment = this.assignLocationToVehicle(location);
      
      if (assignment.vehicle === 'camion') {
        camionLocations.push(location);
        console.log(`   🚛 ${location.direccion}: ${location.peso}kg → Camión (${assignment.reason})`);
      } else {
        motoLocations.push(location);
        console.log(`   🏍️ ${location.direccion}: ${location.peso}kg → Moto (${assignment.reason})`);
      }
    }

    return {
      camion: camionLocations,
      moto: motoLocations
    };
  }

  // Asignar ubicación individual al vehículo más eficiente
  assignLocationToVehicle(location) {
    const weight = location.peso;
    
    // Calcular umbrales dinámicos basados en las capacidades configuradas
    const motoCapacity = this.motoConfig.capacityKg;
    const camionCapacity = this.camionConfig.capacityKg;
    
    // Umbrales relativos: usar porcentajes de la capacidad de la moto
    const pesoMedio = motoCapacity * 0.67; // 67% de la capacidad de la moto
    const pesoLigero = motoCapacity * 0.33; // 33% de la capacidad de la moto
    
    // Reglas de asignación inteligente
    if (weight > motoCapacity) {
      return { vehicle: 'camion', reason: 'Excede capacidad moto' };
    }
    
    if (weight > pesoMedio) {
      return { vehicle: 'camion', reason: 'Carga pesada' };
    }
    
    if (weight <= pesoLigero) {
      return { vehicle: 'moto', reason: 'Carga ligera' };
    }
    
    // Para cargas intermedias, considerar factores adicionales
    const distanceFromDepot = this.calculateDistance(this.depot, location);
    const costPerKgCamion = this.calculateCostPerKg(weight, 'camion', distanceFromDepot);
    const costPerKgMoto = this.calculateCostPerKg(weight, 'moto', distanceFromDepot);
    
    if (costPerKgMoto < costPerKgCamion) {
      return { vehicle: 'moto', reason: 'Más económico' };
    } else {
      return { vehicle: 'camion', reason: 'Más económico' };
    }
  }

  // Calcular costo por kg para un vehículo específico
  calculateCostPerKg(weight, vehicleType, distance) {
    const config = vehicleType === 'camion' ? this.camionConfig : this.motoConfig;
    const fuelCost = distance * config.fuelCostPerKm;
    const timeCost = (distance / config.averageSpeedKmH) * (config.costPerHour / 60);
    const serviceCost = config.serviceTimePerLocationMin * (config.costPerHour / 60);
    
    return (fuelCost + timeCost + serviceCost) / weight;
  }

  // Crear rutas para un tipo específico de vehículo
  createRoutesForVehicle(locations, vehicleType) {
    if (locations.length === 0) return [];
    
    // Usar configuraciones dinámicas si están disponibles, sino valores por defecto
    const config = vehicleType === 'camion' ? this.camionConfig : this.motoConfig;
    const routes = [];
    const unvisited = [...locations];
    
    console.log(`🔄 Creando rutas para ${vehicleType} (${locations.length} ubicaciones)...`);
    
    while (unvisited.length > 0) {
      const route = this.createSingleRoute(unvisited, vehicleType);
      routes.push(route);
      
      // Remover ubicaciones visitadas
      route.locations.forEach(routeLocation => {
        const index = unvisited.findIndex(loc => 
          loc.lat === routeLocation.lat && loc.lon === routeLocation.lon
        );
        if (index !== -1) {
          unvisited.splice(index, 1);
        }
      });
    }
    
    return routes;
  }

  // Crear una ruta individual usando Nearest Neighbor
  createSingleRoute(availableLocations, vehicleType) {
    const config = vehicleType === 'camion' ? this.camionConfig : this.motoConfig;
    const route = {
      id: `route_${vehicleType}_${this.routes.length + 1}`,
      vehicleType: vehicleType,
      locations: [this.depot],
      totalWeight: 0,
      totalDistance: 0,
      totalTime: 0,
      totalCost: 0,
      utilization: 0,
      isOversized: false
    };

    let currentLocation = this.depot;
    let remainingCapacity = config.capacityKg;
    const unvisited = [...availableLocations];

    // Algoritmo Nearest Neighbor con restricciones de capacidad
    while (unvisited.length > 0 && remainingCapacity > 0) {
      let nearestIndex = -1;
      let nearestDistance = Infinity;
      let nearestLocation = null;

      // Encontrar la ubicación más cercana que quepa en la capacidad
      for (let i = 0; i < unvisited.length; i++) {
        const location = unvisited[i];
        if (location.peso <= remainingCapacity) {
          const distance = this.calculateDistance(currentLocation, location);
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestIndex = i;
            nearestLocation = location;
          }
        }
      }

      // Si no se encuentra ubicación válida, terminar ruta
      if (nearestIndex === -1) break;

      // Agregar ubicación a la ruta
      route.locations.push(nearestLocation);
      route.totalWeight += nearestLocation.peso;
      route.totalDistance += nearestDistance;
      remainingCapacity -= nearestLocation.peso;
      
      // Calcular tiempo y costo
      const travelTime = (nearestDistance / config.averageSpeedKmH) * 60;
      const serviceTime = config.serviceTimePerLocationMin;
      route.totalTime += travelTime + serviceTime;
      
      const fuelCost = nearestDistance * config.fuelCostPerKm;
      const timeCost = (travelTime + serviceTime) * (config.costPerHour / 60);
      route.totalCost += fuelCost + timeCost;

      currentLocation = nearestLocation;
      unvisited.splice(nearestIndex, 1);
    }

    // Regresar al depósito
    const returnDistance = this.calculateDistance(currentLocation, this.depot);
    route.locations.push(this.depot);
    route.totalDistance += returnDistance;
    
    const returnTime = (returnDistance / config.averageSpeedKmH) * 60;
    const depotServiceTime = config.depotServiceTimeMin;
    route.totalTime += returnTime + depotServiceTime;
    
    const returnFuelCost = returnDistance * config.fuelCostPerKm;
    const returnTimeCost = (returnTime + depotServiceTime) * (config.costPerHour / 60);
    route.totalCost += returnFuelCost + returnTimeCost;

    // Calcular utilización
    route.utilization = (route.totalWeight / config.capacityKg) * 100;
    route.isOversized = route.totalWeight > config.capacityKg;

    console.log(`   ✅ Ruta ${vehicleType} creada: ${route.totalWeight.toFixed(1)}kg, ${route.totalDistance.toFixed(1)}km`);
    
    return route;
  }

  // Calcular métricas combinadas
  calculateCombinedMetrics(routes) {
    const totalWeight = routes.reduce((sum, route) => sum + route.totalWeight, 0);
    const totalDistance = routes.reduce((sum, route) => sum + route.totalDistance, 0);
    const totalTime = routes.reduce((sum, route) => sum + route.totalTime, 0);
    const totalCost = routes.reduce((sum, route) => sum + route.totalCost, 0);
    
    const totalWorkingDays = Math.ceil(totalTime / (VRP_CONFIG.workingHours * 60));
    const averageUtilization = routes.reduce((sum, route) => sum + route.utilization, 0) / routes.length;
    
    return {
      totalWeight,
      totalDistance,
      totalTime,
      totalCost,
      totalWorkingDays,
      averageUtilization,
      totalRoutes: routes.length,
      feasibleRoutes: routes.filter(route => !route.isOversized).length
    };
  }

  // Calcular distancia Manhattan entre dos puntos
  calculateDistance(point1, point2) {
    // Distancia Manhattan: |lat1-lat2| + |lon1-lon2|
    // Convertir grados a km aproximadamente (1 grado ≈ 111 km)
    const latDiff = Math.abs(point2.lat - point1.lat) * 111;
    const lonDiff = Math.abs(point2.lon - point1.lon) * 111 * Math.cos(point1.lat * Math.PI / 180);
    return latDiff + lonDiff;
  }
}

// Algoritmo VRP avanzado con múltiples vehículos
class AdvancedVRPAlgorithm {
  constructor(locations, vehicleType = 'camion', vehicleConfig = null) {
    this.locations = locations;
    this.vehicleType = vehicleType;
    // Usar configuración proporcionada o valor por defecto
    if (vehicleConfig) {
      this.vehicleConfig = vehicleConfig;
    } else {
      this.vehicleConfig = VEHICLE_TYPES[vehicleType] || VEHICLE_TYPES.camion;
    }
    // Bodega: Parque Industrial San Jorge, Cll 93A # 13 - 24P, Mosquera, Cundinamarca
    this.depot = { lat: 4.715254, lon: -74.242008, peso: 0 };
    this.routes = [];
    this.totalDistance = 0;
    this.totalTime = 0;
    this.totalCost = 0;
    this.feasibleRoutes = 0;
    
    console.log(`🚛 Iniciando VRP con ${this.vehicleConfig.name}`);
    console.log(`📊 Capacidad: ${this.vehicleConfig.capacityKg}kg${this.vehicleConfig.capacityM3 ? ` / ${this.vehicleConfig.capacityM3}m³` : ''}`);
  }

  // Calcular distancia Manhattan entre dos puntos
  calculateDistance(lat1, lon1, lat2, lon2) {
    // Distancia Manhattan: |lat1-lat2| + |lon1-lon2|
    // Convertir grados a km aproximadamente (1 grado ≈ 111 km)
    const latDiff = Math.abs(lat2 - lat1) * 111;
    const lonDiff = Math.abs(lon2 - lon1) * 111 * Math.cos(lat1 * Math.PI / 180);
    return latDiff + lonDiff;
  }

  // Algoritmo Nearest Neighbor mejorado
  calculateRoutes() {
    console.log(`🔄 Procesando ${this.locations.length} ubicaciones...`);
    
    // Separar ubicaciones que exceden la capacidad
    const oversizedLocations = this.locations.filter(loc => loc.peso > this.vehicleConfig.capacityKg);
    const normalLocations = this.locations.filter(loc => loc.peso <= this.vehicleConfig.capacityKg);
    
    console.log(`📊 Ubicaciones normales: ${normalLocations.length}, Sobredimensionadas: ${oversizedLocations.length}`);
    
    // Crear rutas para ubicaciones sobredimensionadas (una ruta por ubicación)
    oversizedLocations.forEach((location, index) => {
      const route = [];
      // Bodega: Parque Industrial San Jorge, Cll 93A # 13 - 24P, Mosquera, Cundinamarca
      const depot = { lat: 4.715254, lon: -74.242008, peso: 0, direccion: 'Parque Industrial San Jorge, Cll 93A # 13 - 24P, Mosquera, Cundinamarca' };
      
      route.push(depot);
      route.push(location);
      route.push(depot);
      
      const routeDistance = this.calculateRouteDistance(route);
      const routeTime = this.calculateRouteTime(route);
      const routeCost = this.calculateRouteCost(route, routeTime);
      
      this.routes.push({
        id: `oversized_${index + 1}`,
        locations: route,
        totalWeight: location.peso,
        totalDistance: routeDistance,
        totalTime: routeTime,
        totalCost: routeCost,
        utilization: (location.peso / this.vehicleConfig.capacityKg) * 100,
        isOversized: true
      });
      
      console.log(`⚠️ Ruta sobredimensionada ${index + 1}: ${location.peso}kg, ${routeDistance.toFixed(1)}km`);
    });
    
    // Algoritmo Nearest Neighbor para ubicaciones normales
    if (normalLocations.length > 0) {
      const normalUnvisited = [...normalLocations];
      let routeNumber = this.routes.length + 1;
      
      while (normalUnvisited.length > 0) {
        const route = [];
        let currentLoad = 0;
        let currentLocation = this.depot;
        
        // Bodega: Parque Industrial San Jorge
        route.push({ lat: 4.715254, lon: -74.242008, peso: 0, direccion: 'Parque Industrial San Jorge, Cll 93A # 13 - 24P, Mosquera, Cundinamarca' });
        
        while (normalUnvisited.length > 0 && currentLoad < this.vehicleConfig.capacityKg) {
          let nearestIndex = -1;
          let nearestDistance = Infinity;
          
          // Encontrar la ubicación más cercana que quepa en la capacidad
          for (let i = 0; i < normalUnvisited.length; i++) {
            const location = normalUnvisited[i];
            if (currentLoad + location.peso <= this.vehicleConfig.capacityKg) {
              const distance = this.calculateDistance(
                currentLocation.lat, currentLocation.lon,
                location.lat, location.lon
              );
              if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestIndex = i;
              }
            }
          }
          
          if (nearestIndex === -1) break; // No hay más ubicaciones que quepan
          
          const nearestLocation = normalUnvisited[nearestIndex];
          route.push(nearestLocation);
          currentLoad += nearestLocation.peso;
          currentLocation = nearestLocation;
          normalUnvisited.splice(nearestIndex, 1);
        }
        
        // Bodega: Parque Industrial San Jorge
        route.push({ lat: 4.715254, lon: -74.242008, peso: 0, direccion: 'Parque Industrial San Jorge, Cll 93A # 13 - 24P, Mosquera, Cundinamarca' });
        
        const routeDistance = this.calculateRouteDistance(route);
        const routeTime = this.calculateRouteTime(route);
        const routeCost = this.calculateRouteCost(route, routeTime);
        
        this.routes.push({
          id: `route_${routeNumber}`,
          locations: route,
          totalWeight: currentLoad,
          totalDistance: routeDistance,
          totalTime: routeTime,
          totalCost: routeCost,
          utilization: (currentLoad / this.vehicleConfig.capacityKg) * 100,
          isOversized: false
        });
        
        console.log(`✅ Ruta ${routeNumber} creada: ${currentLoad}kg, ${routeDistance.toFixed(1)}km`);
        routeNumber++;
      }
    }
    
    // Calcular totales
    this.totalDistance = this.routes.reduce((sum, route) => sum + route.totalDistance, 0);
    this.totalTime = this.routes.reduce((sum, route) => sum + route.totalTime, 0);
    this.totalCost = this.routes.reduce((sum, route) => sum + route.totalCost, 0);
    this.feasibleRoutes = this.routes.filter(route => route.totalTime <= VRP_CONFIG.workingHours * 60).length;
    
    console.log(`🎯 VRP completado: ${this.routes.length} rutas, ${Math.ceil(this.totalTime / (VRP_CONFIG.workingHours * 60))} días`);
    
    return {
      routes: this.routes,
      totalDistance: this.totalDistance,
      totalTime: this.totalTime,
      totalCost: this.totalCost,
      feasibleRoutes: this.feasibleRoutes,
      vehicleType: this.vehicleType,
      vehicleConfig: this.vehicleConfig
    };
  }

  calculateRouteDistance(route) {
    let distance = 0;
    for (let i = 0; i < route.length - 1; i++) {
      distance += this.calculateDistance(
        route[i].lat, route[i].lon,
        route[i + 1].lat, route[i + 1].lon
      );
    }
    return distance;
  }

  calculateRouteTime(route) {
    const routeDistance = this.calculateRouteDistance(route);
    const travelTime = (routeDistance / this.vehicleConfig.averageSpeedKmH) * 60; // minutos
    const serviceTime = (route.length - 2) * this.vehicleConfig.serviceTimePerLocationMin; // excluyendo depósito
    const depotTime = this.vehicleConfig.depotServiceTimeMin;
    
    return travelTime + serviceTime + depotTime;
  }

  calculateRouteCost(route, routeTime) {
    const routeDistance = this.calculateRouteDistance(route);
    const fuelCost = routeDistance * this.vehicleConfig.fuelCostPerKm;
    const timeCost = (routeTime / 60) * this.vehicleConfig.costPerHour;
    
    return fuelCost + timeCost;
  }
}

// Algoritmo VRP simplificado (mantener para compatibilidad)
class SimpleVRPAlgorithm {
  constructor(locations, vehicleCapacityKg = 1000, vehicleConfig = null) {
    this.locations = locations;
    // Usar configuración proporcionada o valor por defecto
    if (vehicleConfig && vehicleConfig.capacityKg) {
      this.vehicleCapacityKg = vehicleConfig.capacityKg;
    } else {
    this.vehicleCapacityKg = vehicleCapacityKg;
    }
    // Bodega: Parque Industrial San Jorge, Cll 93A # 13 - 24P, Mosquera, Cundinamarca
    this.depot = { lat: 4.715254, lon: -74.242008, peso: 0 };
    this.routes = [];
    this.totalDistance = 0;
    this.totalTime = 0;
    this.totalCost = 0;
    this.feasibleRoutes = 0;
    
    // Configuración simplificada
    this.workingHours = 9; // 9 horas de trabajo (8 AM - 5 PM)
    this.fuelCostPerKm = vehicleConfig?.fuelCostPerKm || 0.15; // USD por km
    this.serviceTimePerLocation = vehicleConfig?.serviceTimePerLocationMin || 15; // minutos por ubicación
    this.depotServiceTime = vehicleConfig?.depotServiceTimeMin || 30; // minutos en depósito
    this.averageSpeed = vehicleConfig?.averageSpeedKmH || 25; // km/h promedio en Bogotá
  }

  calculateDistance(lat1, lon1, lat2, lon2) {
    // Distancia Manhattan: |lat1-lat2| + |lon1-lon2|
    // Convertir grados a km aproximadamente (1 grado ≈ 111 km)
    const latDiff = Math.abs(lat2 - lat1) * 111;
    const lonDiff = Math.abs(lon2 - lon1) * 111 * Math.cos(lat1 * Math.PI / 180);
    return latDiff + lonDiff;
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

// Algoritmo VRP con vehículos personalizados
class CustomVRPAlgorithm {
  constructor(locations, customVehicles) {
    this.locations = locations;
    this.customVehicles = customVehicles;
    // Bodega: Parque Industrial San Jorge, Cll 93A # 13 - 24P, Mosquera, Cundinamarca
    this.depot = { lat: 4.715254, lon: -74.242008, peso: 0 };
  }

  calculateCustomRoutes() {
    console.log('🚛 Iniciando VRP con vehículos personalizados (clusters como guía, permitiendo cruce de localidades)...');
    console.log(`📍 ${this.locations.length} ubicaciones a procesar`);
    
    // PASO 1: Agrupar por localidades SOLO para información (no para restringir rutas)
    console.log('🏘️ Agrupando ubicaciones por localidades de Bogotá (solo para referencia)...');
    const gruposPorLocalidad = agruparPorLocalidad(this.locations);
    const estadisticas = obtenerEstadisticasLocalidades(gruposPorLocalidad);
    
    console.log(`✅ ${Object.keys(gruposPorLocalidad).length} localidades identificadas:`);
    estadisticas.forEach(stat => {
      console.log(`   📍 ${stat.localidad}: ${stat.cantidad} ubicaciones, ${stat.pesoTotal.toFixed(1)}kg`);
    });
    
    // PASO 2: Procesar TODAS las ubicaciones juntas (sin restricción de localidad)
    // Los clusters son solo una guía - un vehículo puede cruzar localidades si mejora la ocupación
    console.log(`\n🔄 Procesando TODAS las ubicaciones juntas (permitiendo cruce de localidades)...`);
    
    // Agregar función auxiliar para determinar localidad (debe estar antes de su uso)
    if (!this.determinarLocalidad) {
      this.determinarLocalidad = (lat, lon) => {
        // Buscar en gruposPorLocalidad la localidad más cercana
        let closestLocalidad = null;
        let minDistance = Infinity;
        
        Object.entries(gruposPorLocalidad).forEach(([localidad, ubicaciones]) => {
          if (ubicaciones.length === 0) return;
          const centerLat = ubicaciones.reduce((sum, loc) => sum + loc.lat, 0) / ubicaciones.length;
          const centerLon = ubicaciones.reduce((sum, loc) => sum + loc.lon, 0) / ubicaciones.length;
          const distance = this.calculateDistance(lat, lon, centerLat, centerLon);
          if (distance < minDistance) {
            minDistance = distance;
            closestLocalidad = localidad;
          }
        });
        
        return closestLocalidad;
      };
    }
    
    const allRoutes = [];
    let totalCost = 0;
    let totalDistance = 0;
    let totalTime = 0;
    let totalWeight = 0;
    
    // Usar TODAS las ubicaciones, no solo las de una localidad
    const todasLasUbicaciones = this.locations.filter(loc => (loc.peso || 0) > 0);
    
    // MEJORA: Agrupar ubicaciones geográficamente por cuadrantes alrededor del depósito
    // Esto crea rutas organizadas por áreas geográficas (como en el diagrama)
    console.log(`\n📍 Agrupando ${todasLasUbicaciones.length} ubicaciones por cuadrantes geográficos...`);
    
    // Calcular ángulo y distancia desde el depósito para cada ubicación
    const ubicacionesConAngulo = todasLasUbicaciones.map(loc => {
      const dx = loc.lon - this.depot.lon;
      const dy = loc.lat - this.depot.lat;
      const distancia = this.calculateDistance(this.depot.lat, this.depot.lon, loc.lat, loc.lon);
      // Calcular ángulo en grados (0-360)
      let angulo = Math.atan2(dy, dx) * (180 / Math.PI);
      if (angulo < 0) angulo += 360;
      
      return {
        ...loc,
        distanciaAlDepot: distancia,
        angulo: angulo,
        cuadrante: Math.floor(angulo / 90) // 0=Norte, 1=Este, 2=Sur, 3=Oeste
      };
    });
    
    // Agrupar por cuadrantes
    const ubicacionesPorCuadrante = {};
    ubicacionesConAngulo.forEach(loc => {
      const cuadrante = loc.cuadrante;
      if (!ubicacionesPorCuadrante[cuadrante]) {
        ubicacionesPorCuadrante[cuadrante] = [];
      }
      ubicacionesPorCuadrante[cuadrante].push(loc);
    });
    
    // Ordenar ubicaciones dentro de cada cuadrante: primero por distancia, luego por peso
    Object.keys(ubicacionesPorCuadrante).forEach(cuadrante => {
      ubicacionesPorCuadrante[cuadrante].sort((a, b) => {
        // Primero por distancia al depósito (más cercanas primero)
        if (Math.abs(a.distanciaAlDepot - b.distanciaAlDepot) > 2) {
          return a.distanciaAlDepot - b.distanciaAlDepot;
        }
        // Si están a distancia similar, priorizar las más pesadas
        return (b.peso || 0) - (a.peso || 0);
      });
    });
    
    const cuadranteNombres = ['Norte', 'Este', 'Sur', 'Oeste'];
    console.log(`   ✅ Ubicaciones agrupadas por cuadrantes:`);
    Object.keys(ubicacionesPorCuadrante).sort().forEach(cuadrante => {
      const pesoTotal = ubicacionesPorCuadrante[cuadrante].reduce((sum, loc) => sum + (loc.peso || 0), 0);
      console.log(`      ${cuadranteNombres[cuadrante]}: ${ubicacionesPorCuadrante[cuadrante].length} ubicaciones, ${pesoTotal.toFixed(1)}kg`);
    });
    
    // Crear lista ordenada: procesar cuadrantes en orden, pero permitir cruce si mejora ocupación
    // Esto permite que las rutas se agrupen geográficamente pero mantengan flexibilidad
    const ubicacionesOrdenadas = [];
    Object.keys(ubicacionesPorCuadrante).sort().forEach(cuadrante => {
      ubicacionesOrdenadas.push(...ubicacionesPorCuadrante[cuadrante]);
    });
    
    console.log(`   📊 Total de ubicaciones ordenadas: ${ubicacionesOrdenadas.length}`);
    
    // Ordenar vehículos por eficiencia (capacidad/costo) - usar primero los más eficientes
    const vehiclesSorted = [...this.customVehicles].sort((a, b) => {
      const efficiencyA = a.capacity / (a.costPerTrip || 1); // kg por peso de costo
      const efficiencyB = b.capacity / (b.costPerTrip || 1);
      return efficiencyB - efficiencyA; // Mayor eficiencia primero
    });
    
    console.log(`   🎯 Vehículos ordenados por eficiencia (capacidad/costo):`);
    vehiclesSorted.forEach((v, idx) => {
      const efficiency = v.capacity / (v.costPerTrip || 1);
      console.log(`      ${idx + 1}. ${v.name}: ${efficiency.toFixed(1)} kg/COP`);
    });
    
    // VRP: Evaluar TODAS las combinaciones posibles de vehículos para optimizar:
    // 1. Ocupación (maximizar)
    // 2. Costo (minimizar)
    // 3. Distancia (minimizar)
    const pesoTotalUbicaciones = ubicacionesOrdenadas.reduce((sum, loc) => sum + (loc.peso || 0), 0);
    const maxCapacity = vehiclesSorted.length > 0 ? vehiclesSorted[0].capacity : 2000;
    
    console.log(`   🎯 VRP: Evaluando combinaciones de vehículos para optimizar ocupación, costo y distancia...`);
    console.log(`      Peso total: ${pesoTotalUbicaciones.toFixed(1)}kg`);
    console.log(`      Ubicaciones: ${ubicacionesOrdenadas.length}`);
    console.log(`      Vehículos disponibles: ${vehiclesSorted.length}`);
    
    // Agrupar vehículos por tipo para generar combinaciones
    const vehiclesByType = {};
    vehiclesSorted.forEach(v => {
      if (!vehiclesByType[v.type]) {
        vehiclesByType[v.type] = [];
      }
      vehiclesByType[v.type].push(v);
    });
    
    // MEJORA: Usar TODOS los vehículos disponibles, no solo una combinación
    // Esto asegura que todos los vehículos se utilicen para distribuir mejor la carga
    console.log(`   🚛 Usando TODOS los ${vehiclesSorted.length} vehículos disponibles para mejor distribución`);
    
    // Crear asignaciones para TODOS los vehículos disponibles
    const allVehiclesAssignments = vehiclesSorted.map(v => ({
      vehicle: v,
      assignedLocations: [],
      totalAssignedWeight: 0,
      estimatedDistance: 0,
      estimatedTime: 0
    }));
    
    // Usar todos los vehículos en lugar de buscar la mejor combinación
    const bestCombination = {
      vehicles: vehiclesSorted,
      assignments: allVehiclesAssignments,
      metrics: {
        totalCost: 0,
        totalDistance: 0,
        totalTime: 0,
        avgOccupancy: 0,
        totalAssignedWeight: 0
      }
    };
    
    // Generar combinaciones de vehículos (hasta un máximo razonable para evitar explosión combinatoria)
    // NOTA: Ya no se usa, pero se mantiene por si se necesita en el futuro
    const maxVehiclesPerType = 3; // Máximo 3 vehículos de cada tipo para evaluar
    const combinations = [];
    
    // Generar combinaciones: para cada tipo, probar 0, 1, 2, ... hasta maxVehiclesPerType
    const types = Object.keys(vehiclesByType);
    
    function generateCombinations(typeIndex, currentCombination) {
      if (typeIndex >= types.length) {
        // Si la combinación tiene al menos un vehículo, agregarla
        const totalVehicles = Object.values(currentCombination).reduce((sum, arr) => sum + arr.length, 0);
        if (totalVehicles > 0 && totalVehicles <= 10) { // Máximo 10 vehículos totales
          combinations.push({ ...currentCombination });
        }
        return;
      }
      
      const type = types[typeIndex];
      const vehiclesOfType = vehiclesByType[type];
      const maxForType = Math.min(maxVehiclesPerType, vehiclesOfType.length);
      
      for (let count = 0; count <= maxForType; count++) {
        const newCombination = { ...currentCombination };
        newCombination[type] = vehiclesOfType.slice(0, count);
        generateCombinations(typeIndex + 1, newCombination);
      }
    }
    
    // Ya no generamos combinaciones, usamos todos los vehículos
    // generateCombinations(0, {});
    
    console.log(`   📊 Usando ${bestCombination.vehicles.length} vehículos (todos los disponibles)`);
    
    // Ya no evaluamos combinaciones, usamos todos los vehículos directamente
    // El código de evaluación de combinaciones se mantiene comentado por si se necesita en el futuro
    /*
    // Evaluar cada combinación
    let bestCombination = null;
    let bestScore = -Infinity;
    
    for (const combination of combinations) {
      // Crear lista de vehículos para esta combinación
      const vehiclesInCombination = [];
      Object.values(combination).forEach(vehicles => {
        vehiclesInCombination.push(...vehicles);
      });
      
      if (vehiclesInCombination.length === 0) continue;
      
      // Asignar ubicaciones a estos vehículos (simulación rápida)
      const testAssignments = vehiclesInCombination.map(v => ({
        vehicle: v,
        assignedLocations: [],
        totalAssignedWeight: 0,
        estimatedDistance: 0,
        estimatedTime: 0
      }));
      
      // Asignación rápida: distribuir ubicaciones balanceadamente
      ubicacionesOrdenadas.forEach(location => {
        const locationWeight = location.peso || 0;
        const compatible = testAssignments.filter(va => va.vehicle.capacity >= locationWeight);
        
        if (compatible.length > 0) {
          // Elegir el vehículo con menos carga actual
          compatible.sort((a, b) => {
            const loadDiff = a.totalAssignedWeight - b.totalAssignedWeight;
            if (Math.abs(loadDiff) > 50) return loadDiff;
            // Si carga similar, priorizar eficiencia
            const effA = a.vehicle.capacity / (a.vehicle.costPerTrip || 1);
            const effB = b.vehicle.capacity / (b.vehicle.costPerTrip || 1);
            return effB - effA;
          });
          
          const best = compatible[0];
          best.assignedLocations.push(location);
          best.totalAssignedWeight += locationWeight;
          
          // Estimar distancia real
          let distanceTraveled = 0;
          if (best.assignedLocations.length === 1) {
            // Primera ubicación: distancia desde depósito
            distanceTraveled = this.calculateDistance(
              this.depot.lat, this.depot.lon,
              location.lat, location.lon
            );
            best.estimatedDistance += distanceTraveled;
          } else {
            // Ubicaciones siguientes: distancia desde la última ubicación
            const lastLocation = best.assignedLocations[best.assignedLocations.length - 2];
            distanceTraveled = this.calculateDistance(
              lastLocation.lat, lastLocation.lon,
              location.lat, location.lon
            );
            best.estimatedDistance += distanceTraveled;
          }
          
          // Estimar tiempo: distancia / velocidad + tiempo de servicio
          const speed = 30; // km/h promedio
          const serviceTime = 15; // minutos por ubicación
          best.estimatedTime += (distanceTraveled / speed) * 60 + serviceTime;
        }
      });
      
      // Calcular métricas para esta combinación
      const totalCost = testAssignments.reduce((sum, va) => {
        const numRoutes = Math.ceil(va.totalAssignedWeight / (va.vehicle.capacity * 0.6)); // Asumiendo 60% ocupación promedio
        return sum + (va.vehicle.costPerTrip * numRoutes);
      }, 0);
      
      // Agregar distancia de retorno al depósito para cada vehículo
      const totalDistance = testAssignments.reduce((sum, va) => {
        if (va.assignedLocations.length > 0) {
          const lastLocation = va.assignedLocations[va.assignedLocations.length - 1];
          const returnDistance = this.calculateDistance(
            lastLocation.lat, lastLocation.lon,
            this.depot.lat, this.depot.lon
          );
          return sum + va.estimatedDistance + returnDistance;
        }
        return sum + va.estimatedDistance;
      }, 0);
      
      const totalTime = Math.max(...testAssignments.map(va => {
        if (va.assignedLocations.length > 0) {
          const lastLocation = va.assignedLocations[va.assignedLocations.length - 1];
          const returnDistance = this.calculateDistance(
            lastLocation.lat, lastLocation.lon,
            this.depot.lat, this.depot.lon
          );
          return va.estimatedTime + (returnDistance / 30) * 60; // Agregar tiempo de retorno
        }
        return va.estimatedTime;
      }), 0); // Tiempo máximo (paralelo)
      
      const totalAssignedWeight = testAssignments.reduce((sum, va) => sum + va.totalAssignedWeight, 0);
      const avgOccupancy = testAssignments.reduce((sum, va) => {
        const occupancy = va.totalAssignedWeight / va.vehicle.capacity;
        return sum + occupancy;
      }, 0) / testAssignments.length;
      
      // Score: maximizar ocupación, minimizar costo y distancia
      // Score = (ocupación * 100) - (costo normalizado) - (distancia normalizada)
      const costNormalized = totalCost / 1000000; // Normalizar a millones
      const distanceNormalized = totalDistance / 1000; // Normalizar a miles de km
      const score = (avgOccupancy * 100) - (costNormalized * 10) - (distanceNormalized * 5);
      
      if (score > bestScore) {
        bestScore = score;
        bestCombination = {
          vehicles: vehiclesInCombination,
          assignments: testAssignments,
          metrics: {
            totalCost,
            totalDistance,
            totalTime,
            avgOccupancy,
            totalAssignedWeight
          }
        };
      }
    }
    */
    
    // Ya no necesitamos el fallback porque siempre usamos todos los vehículos
    // bestCombination ya está definido arriba con todos los vehículos
    
    console.log(`   ✅ Usando todos los vehículos disponibles:`);
    console.log(`      Vehículos: ${bestCombination.vehicles.map(v => v.name).join(', ')}`);
    console.log(`      Total: ${bestCombination.vehicles.length} vehículos`);
    
    // Usar la mejor combinación para la asignación real
    const vehicleAssignments = bestCombination.assignments.map(assignment => ({
      vehicle: assignment.vehicle,
      assignedLocations: [],
      totalAssignedWeight: 0,
      estimatedTime: 0
    }));
    
    // Variable para rastrear vehículos usados (para compatibilidad con código existente)
    let vehiclesUsed = vehicleAssignments.length;
    const availableVehicles = vehiclesSorted.length;
    
    console.log(`   ✅ Usando ${vehicleAssignments.length} vehículos de la mejor combinación`);
    
    // MEJORA: Distribuir vehículos por cuadrantes para evitar cruces entre rutas
    // Asignar cada vehículo a un cuadrante específico (o distribuir cuadrantes entre vehículos)
    const cuadrantes = Object.keys(ubicacionesPorCuadrante).sort();
    const vehiclesPerQuadrant = Math.ceil(vehicleAssignments.length / cuadrantes.length);
    
    console.log(`   🗺️  Distribuyendo ${vehicleAssignments.length} vehículos entre ${cuadrantes.length} cuadrantes (${vehiclesPerQuadrant} vehículos por cuadrante aprox.)`);
    
    // Asignar cada vehículo a un cuadrante específico (round-robin)
    vehicleAssignments.forEach((assignment, idx) => {
      const cuadranteIndex = idx % cuadrantes.length;
      const cuadrante = cuadrantes[cuadranteIndex];
      assignment.assignedQuadrant = cuadrante;
      const cuadranteNombre = ['Norte', 'Este', 'Sur', 'Oeste'][cuadrante] || `Cuadrante ${cuadrante}`;
      console.log(`      ${assignment.vehicle.name} → ${cuadranteNombre}`);
    });
    
    // MEJORA: Agrupar ubicaciones pequeñas antes de asignarlas
    // Separar ubicaciones grandes de pequeñas (usar capacidad del vehículo más grande disponible)
    const ubicacionesGrandes = ubicacionesOrdenadas.filter(loc => (loc.peso || 0) > maxCapacity * 0.2);
    const ubicacionesPequenas = ubicacionesOrdenadas.filter(loc => (loc.peso || 0) <= maxCapacity * 0.2);
    
    console.log(`   📊 Ubicaciones grandes (>20% capacidad): ${ubicacionesGrandes.length}, pequeñas (≤20%): ${ubicacionesPequenas.length}`);
    
    // Primero asignar ubicaciones grandes, priorizando vehículos del mismo cuadrante
    ubicacionesGrandes.forEach(location => {
      const locationWeight = location.peso || 0;
      
      // VRP: Encontrar el mejor vehículo para esta ubicación
      // Considerar: capacidad disponible, carga actual (balanceo), y eficiencia
      let compatibleVehicles = vehicleAssignments.filter(va => 
        va.vehicle.capacity >= locationWeight
      );
      
      // Si no hay vehículos compatibles, usar el de mayor capacidad disponible
      if (compatibleVehicles.length === 0) {
        const fallbackVehicle = vehiclesSorted.find(v => v.capacity >= locationWeight);
        if (fallbackVehicle) {
          // Agregar nuevo vehículo si es necesario y hay disponibles
          const alreadyExists = vehicleAssignments.find(va => va.vehicle.name === fallbackVehicle.name);
          if (!alreadyExists && vehicleAssignments.length < availableVehicles) {
            // Asignar cuadrante al nuevo vehículo (usar el cuadrante de la ubicación)
            const locationCuadrante = location.cuadrante !== undefined ? location.cuadrante :
              Math.floor((Math.atan2(location.lat - this.depot.lat, location.lon - this.depot.lon) * (180 / Math.PI) + 360) % 360 / 90);
            
            vehicleAssignments.push({
              vehicle: fallbackVehicle,
              assignedLocations: [],
              totalAssignedWeight: 0,
              estimatedTime: 0,
              assignedQuadrant: locationCuadrante // Asignar al cuadrante de la ubicación
            });
            compatibleVehicles = vehicleAssignments.filter(va => 
              va.vehicle.capacity >= locationWeight
            );
            const cuadranteNombre = ['Norte', 'Este', 'Sur', 'Oeste'][locationCuadrante] || `Cuadrante ${locationCuadrante}`;
            console.log(`   ➕ Agregando vehículo ${fallbackVehicle.name} para ubicación de ${locationWeight}kg (${cuadranteNombre})`);
          }
        }
      }
      
      if (compatibleVehicles.length > 0) {
        // MEJORA: Priorizar vehículos del mismo cuadrante geográfico para evitar cruces
        const locationCuadrante = location.cuadrante !== undefined ? location.cuadrante :
          Math.floor((Math.atan2(location.lat - this.depot.lat, location.lon - this.depot.lon) * (180 / Math.PI) + 360) % 360 / 90);
        
        // OPTIMIZACIÓN: Priorizar cuadrante, luego eficiencia y balanceo de carga
        compatibleVehicles.sort((a, b) => {
          // PRIMERO: Vehículos del mismo cuadrante (evitar cruces)
          const aSameQuadrant = a.assignedQuadrant === locationCuadrante ? 0 : 1;
          const bSameQuadrant = b.assignedQuadrant === locationCuadrante ? 0 : 1;
          if (aSameQuadrant !== bSameQuadrant) {
            return aSameQuadrant - bSameQuadrant; // Mismo cuadrante primero
          }
          
          // SEGUNDO: Calcular eficiencia del vehículo
          const efficiencyA = a.vehicle.capacity / (a.vehicle.costPerTrip || 1);
          const efficiencyB = b.vehicle.capacity / (b.vehicle.costPerTrip || 1);
          
          // Si hay mucha diferencia en eficiencia (>20%), priorizar el más eficiente
          const efficiencyDiff = Math.abs(efficiencyA - efficiencyB) / Math.max(efficiencyA, efficiencyB);
          if (efficiencyDiff > 0.2) {
            return efficiencyB - efficiencyA; // Más eficiente primero
          }
          
          // TERCERO: Balancear carga (menos peso asignado primero)
          const weightDiff = a.totalAssignedWeight - b.totalAssignedWeight;
          if (Math.abs(weightDiff) > 100) { // Diferencia significativa (>100kg)
            return weightDiff; // Priorizar el que tenga menos peso
          }
          
          // CUARTO: Priorizar el que tenga menos ubicaciones
          const countDiff = a.assignedLocations.length - b.assignedLocations.length;
          if (countDiff !== 0) {
            return countDiff;
          }
          
          // Si todo es igual, mantener orden (round-robin implícito)
          return 0;
        });
        
        const bestVehicle = compatibleVehicles[0];
        bestVehicle.assignedLocations.push(location);
        bestVehicle.totalAssignedWeight += locationWeight;
        
        // DEBUG: Mostrar asignación (solo para primeros casos para no saturar logs)
        if (ubicacionesOrdenadas.indexOf(location) < 3) {
          console.log(`      📍 ${location.direccion?.substring(0, 30)}... (${locationWeight}kg) → ${bestVehicle.vehicle.name} (${bestVehicle.totalAssignedWeight.toFixed(1)}kg total)`);
        }
      } else {
        // Si ningún vehículo tiene capacidad suficiente, usar el de mayor capacidad disponible
        const fallbackVehicle = vehiclesSorted.find(v => v.capacity >= locationWeight) || vehiclesSorted[0];
        let fallbackAssignment = vehicleAssignments.find(va => va.vehicle.name === fallbackVehicle.name);
        if (!fallbackAssignment) {
          // Asignar cuadrante al nuevo vehículo (usar el cuadrante de la ubicación)
          const locationCuadrante = location.cuadrante !== undefined ? location.cuadrante :
            Math.floor((Math.atan2(location.lat - this.depot.lat, location.lon - this.depot.lon) * (180 / Math.PI) + 360) % 360 / 90);
          
          fallbackAssignment = {
            vehicle: fallbackVehicle,
            assignedLocations: [],
            totalAssignedWeight: 0,
            assignedQuadrant: locationCuadrante // Asignar al cuadrante de la ubicación
          };
          vehicleAssignments.push(fallbackAssignment);
          vehiclesUsed++;
        }
        fallbackAssignment.assignedLocations.push(location);
        fallbackAssignment.totalAssignedWeight += locationWeight;
        console.warn(`   ⚠️  Ubicación de ${locationWeight}kg excede capacidad de vehículos disponibles, asignada a ${fallbackVehicle.name}`);
      }
    });
    
    // Luego, agrupar ubicaciones pequeñas antes de asignarlas
    // Intentar agrupar ubicaciones pequeñas para llenar mejor los vehículos
    console.log(`   🔄 Agrupando ${ubicacionesPequenas.length} ubicaciones pequeñas...`);
    
    ubicacionesPequenas.forEach(location => {
      const locationWeight = location.peso || 0;
      
      // Buscar vehículos que puedan llevar esta ubicación Y que tengan espacio para más
      let compatibleVehicles = vehicleAssignments.filter(va => {
        const capacidadDisponible = va.vehicle.capacity - va.totalAssignedWeight;
        return va.vehicle.capacity >= locationWeight && capacidadDisponible >= locationWeight;
      });
      
      if (compatibleVehicles.length === 0) {
        // Si no hay vehículos con espacio, buscar cualquier vehículo compatible
        compatibleVehicles = vehicleAssignments.filter(va => 
          va.vehicle.capacity >= locationWeight
        );
      }
      
      if (compatibleVehicles.length > 0) {
        // MEJORA: Priorizar vehículos del mismo cuadrante para ubicaciones pequeñas también
        const locationCuadrante = location.cuadrante !== undefined ? location.cuadrante :
          Math.floor((Math.atan2(location.lat - this.depot.lat, location.lon - this.depot.lon) * (180 / Math.PI) + 360) % 360 / 90);
        
        // Para ubicaciones pequeñas, priorizar vehículos del mismo cuadrante y que ya tienen carga
        compatibleVehicles.sort((a, b) => {
          // Primero: vehículos del mismo cuadrante
          const aSameQuadrant = a.assignedQuadrant === locationCuadrante ? 0 : 1;
          const bSameQuadrant = b.assignedQuadrant === locationCuadrante ? 0 : 1;
          if (aSameQuadrant !== bSameQuadrant) {
            return aSameQuadrant - bSameQuadrant;
          }
          
          // Segundo: vehículos que ya tienen carga (para consolidar)
          // Priorizar vehículos que ya tienen carga pero tienen espacio
          const espacioA = a.vehicle.capacity - a.totalAssignedWeight;
          const espacioB = b.vehicle.capacity - b.totalAssignedWeight;
          
          // Si un vehículo tiene carga pero aún tiene mucho espacio, priorizarlo
          if (a.totalAssignedWeight > 0 && b.totalAssignedWeight === 0) {
            return -1; // Priorizar el que ya tiene carga
          }
          if (b.totalAssignedWeight > 0 && a.totalAssignedWeight === 0) {
            return 1;
          }
          
          // Si ambos tienen carga, priorizar el que tiene menos espacio disponible (más lleno)
          if (espacioA !== espacioB) {
            return espacioA - espacioB; // Menos espacio disponible = más lleno = mejor
          }
          
          // Si tienen espacio similar, priorizar el más eficiente
          const efficiencyA = a.vehicle.capacity / (a.vehicle.costPerTrip || 1);
          const efficiencyB = b.vehicle.capacity / (b.vehicle.costPerTrip || 1);
          return efficiencyB - efficiencyA;
        });
        
        const bestVehicle = compatibleVehicles[0];
        bestVehicle.assignedLocations.push(location);
        bestVehicle.totalAssignedWeight += locationWeight;
      } else {
        // Si no hay vehículos compatibles, agregar uno nuevo si es necesario
        if (vehiclesUsed < vehiclesSorted.length) {
          const nextVehicle = vehiclesSorted.find(v => v.capacity >= locationWeight);
          if (nextVehicle) {
            // Asignar cuadrante al nuevo vehículo (usar el cuadrante de la ubicación)
            const locationCuadrante = location.cuadrante !== undefined ? location.cuadrante :
              Math.floor((Math.atan2(location.lat - this.depot.lat, location.lon - this.depot.lon) * (180 / Math.PI) + 360) % 360 / 90);
            
            vehicleAssignments.push({
              vehicle: nextVehicle,
              assignedLocations: [location],
              totalAssignedWeight: locationWeight,
              assignedQuadrant: locationCuadrante // Asignar al cuadrante de la ubicación
            });
            vehiclesUsed++;
          }
        }
      }
    });
    
    // POST-OPTIMIZACIÓN: Verificar si se pueden consolidar vehículos poco utilizados
    // Si un vehículo tiene muy poca carga (<20% de su capacidad), intentar mover sus ubicaciones a vehículos más eficientes
    console.log(`   🔍 Evaluando consolidación de vehículos poco utilizados...`);
    vehicleAssignments.forEach((assignment, idx) => {
      const utilization = (assignment.totalAssignedWeight / assignment.vehicle.capacity) * 100;
      if (utilization < 20 && assignment.assignedLocations.length > 0) {
        console.log(`      ⚠️  ${assignment.vehicle.name} tiene solo ${utilization.toFixed(1)}% de utilización`);
        // Intentar mover ubicaciones a vehículos más eficientes si es posible
        const moreEfficientVehicles = vehicleAssignments.filter(va => {
          const efficiencyA = assignment.vehicle.capacity / (assignment.vehicle.costPerTrip || 1);
          const efficiencyB = va.vehicle.capacity / (va.vehicle.costPerTrip || 1);
          return efficiencyB > efficiencyA && va !== assignment;
        });
        
        if (moreEfficientVehicles.length > 0) {
          const locationsToMove = [...assignment.assignedLocations];
          locationsToMove.forEach(location => {
            const locationWeight = location.peso || 0;
            const compatible = moreEfficientVehicles.find(va => 
              va.vehicle.capacity >= (va.totalAssignedWeight + locationWeight)
            );
            if (compatible) {
              // Mover ubicación a vehículo más eficiente
              assignment.assignedLocations = assignment.assignedLocations.filter(loc => loc !== location);
              assignment.totalAssignedWeight -= locationWeight;
              compatible.assignedLocations.push(location);
              compatible.totalAssignedWeight += locationWeight;
              console.log(`      ✅ Moviendo ${locationWeight}kg de ${assignment.vehicle.name} a ${compatible.vehicle.name} (más eficiente)`);
            }
          });
        }
      }
    });
    
    // MEJORA CRÍTICA: Asegurar que cada vehículo tenga al menos el 15% de las rutas
    // Calcular número estimado de rutas totales
    const pesoTotal = ubicacionesOrdenadas.reduce((sum, loc) => sum + (loc.peso || 0), 0);
    const capacidadTotal = vehicleAssignments.reduce((sum, va) => sum + va.vehicle.capacity, 0);
    const ocupacionPromedioEsperada = 0.7; // 70% de ocupación promedio
    const capacidadUtilPromedio = capacidadTotal * ocupacionPromedioEsperada;
    const numRutasEstimadas = Math.ceil(pesoTotal / capacidadUtilPromedio);
    const minRutasPorVehiculo = Math.max(1, Math.ceil(numRutasEstimadas * 0.15)); // Mínimo 15% de las rutas
    
    console.log(`   📊 Distribución mínima de rutas:`);
    console.log(`      Rutas estimadas totales: ${numRutasEstimadas}`);
    console.log(`      Mínimo de rutas por vehículo (15%): ${minRutasPorVehiculo}`);
    console.log(`      Peso total: ${pesoTotal.toFixed(1)}kg, Capacidad total: ${capacidadTotal.toFixed(1)}kg`);
    
    // Calcular peso mínimo que cada vehículo debe tener asignado
    const pesoMinimoPorVehiculo = vehicleAssignments.map(va => {
      // Peso mínimo = capacidad del vehículo * ocupación mínima * número mínimo de rutas
      const capacidadPorRuta = va.vehicle.capacity * ocupacionPromedioEsperada;
      return capacidadPorRuta * minRutasPorVehiculo;
    });
    
    console.log(`   🎯 Peso mínimo requerido por vehículo:`);
    vehicleAssignments.forEach((va, idx) => {
      console.log(`      ${va.vehicle.name}: ${pesoMinimoPorVehiculo[idx].toFixed(1)}kg mínimo (actual: ${va.totalAssignedWeight.toFixed(1)}kg)`);
    });
    
    // Redistribuir ubicaciones para asegurar que cada vehículo alcance el mínimo
    vehicleAssignments.forEach((assignment, idx) => {
      const pesoMinimo = pesoMinimoPorVehiculo[idx];
      const pesoActual = assignment.totalAssignedWeight;
      const deficit = pesoMinimo - pesoActual;
      
      if (deficit > 0 && assignment.assignedLocations.length > 0) {
        console.log(`   🔄 ${assignment.vehicle.name} necesita ${deficit.toFixed(1)}kg más para alcanzar el mínimo`);
        
        // Buscar ubicaciones de otros vehículos que puedan moverse
        const otrosVehiculos = vehicleAssignments.filter((va, i) => i !== idx && va.assignedLocations.length > 0);
        
        // Ordenar otros vehículos por exceso de peso (los que tienen más del mínimo)
        otrosVehiculos.sort((a, b) => {
          const aIndex = vehicleAssignments.indexOf(a);
          const bIndex = vehicleAssignments.indexOf(b);
          const aExceso = a.totalAssignedWeight - pesoMinimoPorVehiculo[aIndex];
          const bExceso = b.totalAssignedWeight - pesoMinimoPorVehiculo[bIndex];
          return bExceso - aExceso; // Más exceso primero
        });
        
        // Mover ubicaciones de vehículos con exceso a este vehículo
        let pesoMovido = 0;
        for (const otroVehiculo of otrosVehiculos) {
          if (pesoMovido >= deficit) break;
          
          const otroIndex = vehicleAssignments.indexOf(otroVehiculo);
          const otroExceso = otroVehiculo.totalAssignedWeight - pesoMinimoPorVehiculo[otroIndex];
          
          if (otroExceso > 100) { // Solo mover si hay exceso significativo (>100kg)
            // Buscar ubicaciones que puedan moverse (mismo cuadrante preferiblemente)
            const ubicacionesMovibles = otroVehiculo.assignedLocations.filter(loc => {
              const locPeso = loc.peso || 0;
              const cuadranteMatch = loc.cuadrante === assignment.assignedQuadrant;
              const cabeEnDestino = assignment.totalAssignedWeight + pesoMovido + locPeso <= assignment.vehicle.capacity * 2; // Permitir hasta 2x capacidad
              const noRompeMinimo = (otroVehiculo.totalAssignedWeight - locPeso) >= pesoMinimoPorVehiculo[otroIndex] * 0.8; // No romper el mínimo del otro
              
              return cabeEnDestino && noRompeMinimo;
            });
            
            // Ordenar por compatibilidad (mismo cuadrante primero)
            ubicacionesMovibles.sort((a, b) => {
              const aCuadrante = a.cuadrante === assignment.assignedQuadrant ? 0 : 1;
              const bCuadrante = b.cuadrante === assignment.assignedQuadrant ? 0 : 1;
              return aCuadrante - bCuadrante;
            });
            
            // Mover ubicaciones hasta llenar el déficit
            for (const loc of ubicacionesMovibles) {
              if (pesoMovido >= deficit) break;
              
              const locPeso = loc.peso || 0;
              if (assignment.totalAssignedWeight + pesoMovido + locPeso <= assignment.vehicle.capacity * 2) {
                // Mover ubicación
                otroVehiculo.assignedLocations = otroVehiculo.assignedLocations.filter(l => l !== loc);
                otroVehiculo.totalAssignedWeight -= locPeso;
                assignment.assignedLocations.push(loc);
                assignment.totalAssignedWeight += locPeso;
                pesoMovido += locPeso;
                
                console.log(`      ✅ Moviendo ${locPeso}kg de ${otroVehiculo.vehicle.name} a ${assignment.vehicle.name}`);
              }
            }
          }
        }
        
        if (pesoMovido > 0) {
          console.log(`      ✅ ${assignment.vehicle.name} ahora tiene ${assignment.totalAssignedWeight.toFixed(1)}kg (movidos ${pesoMovido.toFixed(1)}kg)`);
        }
      }
    });
    
    // Eliminar vehículos que quedaron sin ubicaciones después de la redistribución
    const emptyAssignments = vehicleAssignments.filter(va => va.assignedLocations.length === 0);
    emptyAssignments.forEach(empty => {
      const index = vehicleAssignments.indexOf(empty);
      if (index > -1) {
        vehicleAssignments.splice(index, 1);
        console.log(`      🗑️  Eliminando ${empty.vehicle.name} (sin ubicaciones asignadas después de redistribución)`);
      }
    });
    
    // DEBUG: Mostrar distribución de ubicaciones después de redistribución
    console.log(`   📊 Distribución final de ubicaciones por vehículo:`);
    vehicleAssignments.forEach((assignment, idx) => {
      const utilizacion = (assignment.totalAssignedWeight / assignment.vehicle.capacity) * 100;
      const rutasEstimadas = Math.ceil(assignment.totalAssignedWeight / (assignment.vehicle.capacity * ocupacionPromedioEsperada));
      const porcentajeRutas = numRutasEstimadas > 0 ? (rutasEstimadas / numRutasEstimadas * 100).toFixed(1) : 0;
      console.log(`      ${assignment.vehicle.name}: ${assignment.assignedLocations.length} ubicaciones, ${assignment.totalAssignedWeight.toFixed(1)}kg, ${utilizacion.toFixed(1)}% utilización, ~${rutasEstimadas} rutas (${porcentajeRutas}% del total)`);
    });
    
    // Crear rutas optimizadas para cada vehículo individual
    vehicleAssignments.forEach(assignment => {
      if (assignment.assignedLocations.length === 0) {
        console.log(`   ⚠️  ${assignment.vehicle.name}: Sin ubicaciones asignadas, saltando...`);
        return;
      }
      
      const vehicle = assignment.vehicle;
      console.log(`   🔄 Creando rutas para ${vehicle.name} (${vehicle.capacity}kg) - ${assignment.assignedLocations.length} ubicaciones asignadas...`);
      
      // Crear rutas usando VRP (Nearest Neighbor) para este vehículo específico
      const routes = this.createRoutesForVehicle(assignment.assignedLocations, vehicle);
      
      // Agregar información de vehículo a las rutas (sin restricción de localidad)
      routes.forEach(route => {
        // Determinar localidad de la ruta basándose en las ubicaciones (puede ser múltiple)
        const localidadesEnRuta = new Set();
        route.stops.forEach(stop => {
          const localidadStop = this.determinarLocalidad(stop.lat, stop.lon);
          if (localidadStop) localidadesEnRuta.add(localidadStop);
        });
        route.localidad = Array.from(localidadesEnRuta).join(', ') || 'Múltiples';
        route.vehicleName = vehicle.name; // Identificar vehículo específico
        route.vehicleCapacity = vehicle.capacity; // Capacidad específica
      });
      
      allRoutes.push(...routes);
      
      // Calcular métricas
      routes.forEach(route => {
        totalCost += route.totalCost || 0;
        totalDistance += route.totalDistance || 0;
        totalTime += route.totalTime || 0;
        totalWeight += route.totalWeight || 0;
      });
      
      console.log(`      ✅ ${routes.length} rutas ${vehicle.name} creadas (${assignment.totalAssignedWeight.toFixed(1)}kg asignados)`);
      
      // Guardar número de rutas por vehículo para verificación posterior
      assignment.numRoutes = routes.length;
    });
    
    // VERIFICACIÓN FINAL: Asegurar que cada vehículo tenga al menos el 15% de las rutas
    const totalRutasCreadas = allRoutes.length;
    const minRutasPorVehiculoFinal = Math.max(1, Math.ceil(totalRutasCreadas * 0.15));
    
    console.log(`\n   🔍 Verificación final: Total de rutas creadas: ${totalRutasCreadas}`);
    console.log(`      Mínimo de rutas por vehículo (15%): ${minRutasPorVehiculoFinal}`);
    
    // Identificar vehículos que no alcanzan el mínimo
    const vehiculosBajoMinimo = vehicleAssignments.filter(va => (va.numRoutes || 0) < minRutasPorVehiculoFinal);
    
    if (vehiculosBajoMinimo.length > 0) {
      console.log(`   ⚠️  ${vehiculosBajoMinimo.length} vehículos no alcanzan el mínimo de ${minRutasPorVehiculoFinal} rutas:`);
      vehiculosBajoMinimo.forEach(va => {
        console.log(`      ${va.vehicle.name}: ${va.numRoutes || 0} rutas (necesita ${minRutasPorVehiculoFinal})`);
      });
      
      // Buscar vehículos con exceso de rutas para redistribuir
      const vehiculosConExceso = vehicleAssignments.filter(va => (va.numRoutes || 0) > minRutasPorVehiculoFinal * 1.5);
      
      if (vehiculosConExceso.length > 0) {
        console.log(`   🔄 Redistribuyendo rutas desde vehículos con exceso...`);
        
        vehiculosBajoMinimo.forEach(vehiculoBajo => {
          const rutasNecesarias = minRutasPorVehiculoFinal - (vehiculoBajo.numRoutes || 0);
          
          if (rutasNecesarias > 0) {
            // Buscar rutas de vehículos con exceso que puedan moverse
            for (const vehiculoExceso of vehiculosConExceso) {
              if (rutasNecesarias <= 0) break;
              
              // Encontrar rutas del vehículo con exceso que sean compatibles
              const rutasDelVehiculo = allRoutes.filter(r => r.vehicleName === vehiculoExceso.vehicle.name);
              
              // Ordenar por peso (rutas más pequeñas primero para mover)
              rutasDelVehiculo.sort((a, b) => (a.totalWeight || 0) - (b.totalWeight || 0));
              
              // Mover rutas hasta alcanzar el mínimo
              for (const ruta of rutasDelVehiculo) {
                if (rutasNecesarias <= 0) break;
                if ((vehiculoExceso.numRoutes || 0) <= minRutasPorVehiculoFinal * 1.2) break; // No quitar demasiadas
                
                // Verificar que el vehículo destino pueda manejar esta ruta
                const pesoRuta = ruta.totalWeight || 0;
                if (pesoRuta <= vehiculoBajo.vehicle.capacity) {
                  // Cambiar el vehículo de la ruta
                  ruta.vehicleName = vehiculoBajo.vehicle.name;
                  ruta.vehicleCapacity = vehiculoBajo.vehicle.capacity;
                  
                  // Actualizar contadores
                  vehiculoExceso.numRoutes = (vehiculoExceso.numRoutes || 0) - 1;
                  vehiculoBajo.numRoutes = (vehiculoBajo.numRoutes || 0) + 1;
                  
                  console.log(`      ✅ Moviendo ruta de ${pesoRuta.toFixed(1)}kg de ${vehiculoExceso.vehicle.name} a ${vehiculoBajo.vehicle.name}`);
                }
              }
            }
          }
        });
      }
    }
    
    // Mostrar distribución final de rutas
    console.log(`\n   📊 Distribución final de rutas por vehículo:`);
    vehicleAssignments.forEach(assignment => {
      const numRutas = allRoutes.filter(r => r.vehicleName === assignment.vehicle.name).length;
      const porcentaje = totalRutasCreadas > 0 ? ((numRutas / totalRutasCreadas) * 100).toFixed(1) : 0;
      const utilizacion = (assignment.totalAssignedWeight / assignment.vehicle.capacity) * 100;
      console.log(`      ${assignment.vehicle.name}: ${numRutas} rutas (${porcentaje}%), ${utilizacion.toFixed(1)}% utilización`);
    });
    
    // PASO 3: Calcular métricas finales
    const metrics = {
      totalRoutes: allRoutes.length,
      totalCost: totalCost,
      totalDistance: totalDistance,
      totalTime: totalTime,
      totalWeight: totalWeight,
      feasibleRoutes: allRoutes.length,
      averageUtilization: allRoutes.length > 0 ? 
        allRoutes.reduce((sum, r) => sum + (r.utilization || 0), 0) / allRoutes.length : 0
    };
    
    console.log(`\n🎯 VRP Personalizado con Clustering completado:`);
    console.log(`   🗺️  Localidades procesadas: ${estadisticas.length}`);
    console.log(`   📊 Total rutas: ${metrics.totalRoutes}`);
    console.log(`   💰 Costo total: $${metrics.totalCost.toFixed(2)}`);
    console.log(`   ⏱️ Tiempo total: ${metrics.totalTime.toFixed(1)} min`);
    console.log(`   📦 Peso total: ${metrics.totalWeight.toFixed(1)} kg`);
    
    console.log(`\n📋 Resumen por localidad (las rutas pueden cruzar múltiples localidades):`);
    const localidadesEnRutas = {};
    allRoutes.forEach(route => {
      const localidades = route.localidad ? route.localidad.split(', ') : ['Desconocida'];
      localidades.forEach(loc => {
        localidadesEnRutas[loc] = (localidadesEnRutas[loc] || 0) + 1;
      });
    });
    for (const [localidad, count] of Object.entries(localidadesEnRutas)) {
      console.log(`   ${localidad}: ${count} rutas`);
    }
    
    return {
      routes: allRoutes,
      analysis: {
        vehicleType: 'personalizado',
        vehicleConfig: { 
          name: 'Vehículos Personalizados', 
          description: `${this.customVehicles.length} vehículos configurados` 
        },
        totalVehicles: metrics.totalRoutes,
        totalWorkingDays: Math.ceil(metrics.totalTime / (8 * 60)), // Asumiendo 8 horas de trabajo
        averageUtilization: metrics.averageUtilization,
        feasibleRoutes: metrics.feasibleRoutes,
        totalCost: metrics.totalCost,
        costPerTon: metrics.totalWeight > 0 ? metrics.totalCost / (metrics.totalWeight / 1000) : 0,
        totalDistance: metrics.totalDistance,
        totalTime: metrics.totalTime,
        pesoTotal: metrics.totalWeight,
        vehicleBreakdown: this.getVehicleBreakdown(allRoutes)
      },
      localidades: estadisticas
    };
  }

  classifyLocationsByVehicle() {
    const classified = {};
    
    this.customVehicles.forEach(vehicle => {
      classified[vehicle.type] = [];
    });
    
    this.locations.forEach(location => {
      // Encontrar el vehículo más económico que pueda transportar esta carga
      let bestVehicle = null;
      let bestCostPerKg = Infinity;
      
      this.customVehicles.forEach(vehicle => {
        if (location.peso <= vehicle.capacity) {
          // Calcular costo por kg (costo por viaje dividido por capacidad)
          const costPerKg = vehicle.costPerTrip / vehicle.capacity;
          if (costPerKg < bestCostPerKg) {
            bestCostPerKg = costPerKg;
            bestVehicle = vehicle;
          }
        }
      });
      
      if (bestVehicle) {
        classified[bestVehicle.type].push(location);
        console.log(`   🚛 ${location.direccion}: ${location.peso}kg → ${bestVehicle.name}`);
      }
    });
    
    return classified;
  }

  createRoutesForVehicle(locations, vehicle) {
    const routes = [];
    const unvisited = [...locations];
    
    // MEJORA: Definir umbral mínimo de ocupación para crear una nueva ruta
    // CRÍTICO: No crear rutas con menos del 60% de ocupación para evitar ineficiencias
    const MIN_ROUTE_OCCUPATION = 0.6; // Mínimo 60% de ocupación para considerar crear una nueva ruta
    const minWeightForNewRoute = vehicle.capacity * MIN_ROUTE_OCCUPATION;
    
    while (unvisited.length > 0) {
      const route = this.createSingleRoute(unvisited, vehicle);
      
      // Solo agregar rutas que tengan al menos una ubicación (no solo depósito)
      if (route.stops.length === 0 || route.totalWeight === 0) {
        // Si no se pudo crear una ruta válida, puede ser porque:
        // 1. No hay más ubicaciones que quepan en la capacidad
        // 2. Todas las ubicaciones restantes exceden la capacidad
        // En este caso, debemos intentar asignar las ubicaciones restantes de otra manera
        if (unvisited.length > 0) {
          console.warn(`⚠️ No se pudo crear ruta para ${unvisited.length} ubicaciones restantes con vehículo ${vehicle.name} (capacidad: ${vehicle.capacity}kg)`);
          // Intentar asignar ubicaciones individuales que excedan la capacidad
          const oversizedLocations = unvisited.filter(loc => loc.peso > vehicle.capacity);
          if (oversizedLocations.length > 0) {
            console.warn(`   ${oversizedLocations.length} ubicaciones exceden la capacidad del vehículo`);
            // Estas ubicaciones necesitarían un vehículo más grande o múltiples viajes
          }
        }
        break; // No se pueden crear más rutas con este vehículo
      }
      
      // MEJORA: Solo agregar la ruta si tiene un peso mínimo razonable O si alcanzó el límite de paradas
      // Si la ruta alcanza 50 paradas, aceptarla aunque no tenga el 60% de ocupación
      const MAX_STOPS_PER_ROUTE = 50;
      const routeReachedMaxStops = route.stops.length >= MAX_STOPS_PER_ROUTE;
      
      if (route.totalWeight < minWeightForNewRoute && unvisited.length > 0 && !routeReachedMaxStops) {
        // Intentar agregar más ubicaciones pequeñas a esta ruta antes de considerarla completa
        const remainingCapacity = vehicle.capacity - route.totalWeight;
        let currentLastLocation = route.stops[route.stops.length - 1];
        
        // Buscar ubicaciones pequeñas cercanas que puedan agregarse
        const smallLocations = unvisited.filter(loc => 
          loc.peso <= remainingCapacity && 
          loc.peso <= vehicle.capacity * 0.2 // Ubicaciones pequeñas (<= 20% de capacidad)
        );
        
        if (smallLocations.length > 0) {
          // Ordenar por distancia desde la última ubicación
          smallLocations.sort((a, b) => {
            const distA = this.calculateDistance(
              currentLastLocation.lat, currentLastLocation.lon,
              a.lat, a.lon
            );
            const distB = this.calculateDistance(
              currentLastLocation.lat, currentLastLocation.lon,
              b.lat, b.lon
            );
            return distA - distB;
          });
          
          // Agregar ubicaciones pequeñas cercanas hasta llenar mejor la ruta
          // PERO respetar el límite de 50 paradas
          for (const smallLoc of smallLocations) {
            // Verificar límite de paradas ANTES de agregar
            if (route.stops.length >= MAX_STOPS_PER_ROUTE) {
              console.log(`   ⚠️  Límite de ${MAX_STOPS_PER_ROUTE} paradas alcanzado en sección de ubicaciones pequeñas`);
              break;
            }
            
            if (route.totalWeight + smallLoc.peso <= vehicle.capacity) {
              const distance = this.calculateDistance(
                currentLastLocation.lat, currentLastLocation.lon,
                smallLoc.lat, smallLoc.lon
              );
              
              route.stops.push(smallLoc);
              route.totalWeight += smallLoc.peso;
              route.totalDistance += distance;
              
              // Remover de unvisited
              const index = unvisited.findIndex(loc => 
                loc.lat === smallLoc.lat && loc.lon === smallLoc.lon && loc.peso === smallLoc.peso
              );
              if (index !== -1) {
                unvisited.splice(index, 1);
              }
              
              currentLastLocation = smallLoc;
              
              // Si ya tenemos buen peso o alcanzamos el límite, parar
              if (route.totalWeight >= minWeightForNewRoute || route.stops.length >= MAX_STOPS_PER_ROUTE) {
                break;
              }
            }
          }
          
          // Recalcular distancia total y tiempo
          let totalRouteDistance = 0;
          for (let i = 0; i < route.stops.length; i++) {
            if (i === 0) {
              totalRouteDistance += this.calculateDistance(
                this.depot.lat, this.depot.lon,
                route.stops[i].lat, route.stops[i].lon
              );
            } else {
              totalRouteDistance += this.calculateDistance(
                route.stops[i-1].lat, route.stops[i-1].lon,
                route.stops[i].lat, route.stops[i].lon
              );
            }
          }
          // Distancia de regreso al depósito
          totalRouteDistance += this.calculateDistance(
            route.stops[route.stops.length - 1].lat, route.stops[route.stops.length - 1].lon,
            this.depot.lat, this.depot.lon
          );
          route.totalDistance = totalRouteDistance;
          route.totalTime = (route.totalDistance / 30) * 60;
          route.utilization = (route.totalWeight / vehicle.capacity) * 100;
        }
      }
      
      // CRÍTICO: Aceptar rutas con al menos 60% de ocupación O que hayan alcanzado el límite de 50 paradas
      // Si una ruta alcanza 50 paradas, aceptarla aunque no tenga el 60% de ocupación (para distribuir mejor)
      const reachedMaxStops = route.stops.length >= MAX_STOPS_PER_ROUTE;
      const hasMinOccupation = route.totalWeight >= minWeightForNewRoute;
      
      if (hasMinOccupation || reachedMaxStops) {
      routes.push(route);
        const reason = reachedMaxStops ? `límite de ${MAX_STOPS_PER_ROUTE} paradas` : `buena ocupación`;
        console.log(`   ✅ Ruta aceptada para ${vehicle.name} (${reason}): ${route.totalWeight.toFixed(1)}kg (${((route.totalWeight / vehicle.capacity) * 100).toFixed(1)}% ocupación), ${route.stops.length} paradas`);
      } else if (unvisited.length === 0) {
        // Última ruta posible - aceptarla aunque tenga poco peso
        routes.push(route);
        console.log(`   ⚠️ Última ruta aceptada (no hay más ubicaciones) para ${vehicle.name}: ${route.totalWeight.toFixed(1)}kg (${((route.totalWeight / vehicle.capacity) * 100).toFixed(1)}% ocupación), ${route.stops.length} paradas`);
      } else {
        // Ruta con poco peso y aún hay ubicaciones - devolver ubicaciones y parar
        console.log(`   ❌ Ruta rechazada (${route.totalWeight.toFixed(1)}kg < ${minWeightForNewRoute.toFixed(1)}kg, ${((route.totalWeight / vehicle.capacity) * 100).toFixed(1)}% ocupación). Devolviendo ${route.stops.length} ubicaciones. Aún quedan ${unvisited.length} ubicaciones.`);
        unvisited.push(...route.stops);
        // Parar la creación de rutas para este vehículo - las ubicaciones serán manejadas por otro vehículo
        break;
      }
    }
    
    return routes;
  }

  createSingleRoute(unvisited, vehicle) {
    // Debug: Verificar que vehicle tenga costPerTrip
    if (!vehicle.costPerTrip) {
      console.warn(`⚠️ DEBUG createSingleRoute: vehicle ${vehicle.name || vehicle.id} no tiene costPerTrip. vehicle:`, {
        name: vehicle.name,
        type: vehicle.type,
        capacity: vehicle.capacity,
        costPerTrip: vehicle.costPerTrip
      });
    }
    
    let route = {
      vehicleType: vehicle.type,
      vehicleName: vehicle.name || vehicle.id || `vehicle_${vehicle.type}`, // Asegurar que siempre tenga nombre
      vehicleCapacity: vehicle.capacity,
      vehicleCostPerTrip: vehicle.costPerTrip || 0, // Asegurar que siempre tenga un valor
      stops: [],
      totalWeight: 0,
      totalDistance: 0,
      totalTime: 0,
      totalCost: 0,
      utilization: 0
    };
    
    let currentLocation = this.depot;
    let currentLoad = 0;
    
    // MEJORA: Intentar llenar la ruta de manera más eficiente
    // Primero, intentar agregar ubicaciones grandes que quepan
    // Luego, agregar ubicaciones pequeñas cercanas para llenar el espacio restante
    
    const MIN_OCCUPATION_THRESHOLD = 0.7; // Mínimo 70% de ocupación antes de considerar la ruta completa (MUY agresivo)
    const minWeightForRoute = vehicle.capacity * MIN_OCCUPATION_THRESHOLD;
    
    // CRÍTICO: Continuar agregando ubicaciones hasta que la ruta esté bien llena (≥60%) o no haya más ubicaciones
    // LIMITACIÓN: Máximo 50 paradas por ruta para evitar rutas demasiado largas
    const MAX_STOPS_PER_ROUTE = 50;
    
    while (unvisited.length > 0 && currentLoad < vehicle.capacity && route.stops.length < MAX_STOPS_PER_ROUTE) {
      const remainingCapacity = vehicle.capacity - currentLoad;
      
      // Si la ruta tiene < 60% de ocupación, buscar CUALQUIER ubicación que quepa
      // Si tiene ≥ 60%, usar scoring para optimizar
      let bestIndex = -1;
      
      if (currentLoad < vehicle.capacity * 0.6) {
        // MODE 1: Ruta con poco peso - agregar CUALQUIER ubicación que quepa, sin importar distancia
        console.log(`   🔄 Ruta con ${currentLoad.toFixed(1)}kg (${((currentLoad/vehicle.capacity)*100).toFixed(1)}% ocupación), ${route.stops.length}/${MAX_STOPS_PER_ROUTE} paradas. Buscando CUALQUIER ubicación que quepa...`);
      
      for (let i = 0; i < unvisited.length; i++) {
        const location = unvisited[i];
        if (currentLoad + location.peso <= vehicle.capacity) {
            bestIndex = i;
            console.log(`   ✅ Agregando ubicación de ${location.peso}kg (total será ${(currentLoad + location.peso).toFixed(1)}kg)`);
            break;
          }
        }
      } else {
        // MODE 2: Ruta con buen peso (≥60%) - usar scoring para optimizar
        let bestScore = -Infinity;
        
        for (let i = 0; i < unvisited.length; i++) {
          const location = unvisited[i];
          const locationWeight = location.peso || 0;
          
          // Solo considerar ubicaciones que quepan
          if (currentLoad + locationWeight <= vehicle.capacity) {
          const distance = this.calculateDistance(
            currentLocation.lat, currentLocation.lon,
            location.lat, location.lon
          );
            
            // Score mejorado: PRIORIZAR DISTANCIA sobre peso para evitar zigzags
            // La distancia tiene 3x más peso que el peso de la ubicación
            // Esto asegura que siempre se prefiera la ubicación más cercana
            const distanceScore = 1 / (distance + 0.1); // Mayor score = más cercano
            const weightScore = locationWeight / vehicle.capacity; // Normalizar peso (0-1)
            
            // Priorizar distancia (70%) sobre peso (30%) para evitar zigzags
            let score = (distanceScore * 0.7) + (weightScore * 0.3);
            
            // BONUS GEOGRÁFICO: Si la ubicación está en el mismo cuadrante que la última parada
            // (o si es la primera parada de la ruta), dar bonus para mantener agrupación geográfica
            if (route.stops.length > 0) {
              const lastStop = route.stops[route.stops.length - 1];
              const lastStopAngulo = lastStop.angulo !== undefined ? lastStop.angulo : 
                (Math.atan2(lastStop.lat - this.depot.lat, lastStop.lon - this.depot.lon) * (180 / Math.PI) + 360) % 360;
              const locationAngulo = location.angulo !== undefined ? location.angulo :
                (Math.atan2(location.lat - this.depot.lat, location.lon - this.depot.lon) * (180 / Math.PI) + 360) % 360;
              
              const lastCuadrante = Math.floor(lastStopAngulo / 90);
              const locationCuadrante = Math.floor(locationAngulo / 90);
              
              if (lastCuadrante === locationCuadrante) {
                score *= 1.3; // Bonus significativo por estar en el mismo cuadrante
              }
            } else {
              // Primera parada: bonus si está en un cuadrante con muchas ubicaciones
              const locationAngulo = location.angulo !== undefined ? location.angulo :
                (Math.atan2(location.lat - this.depot.lat, location.lon - this.depot.lon) * (180 / Math.PI) + 360) % 360;
              const locationCuadrante = Math.floor(locationAngulo / 90);
              score *= 1.1; // Pequeño bonus para primera parada
            }
            
            // Bonus: si agregar esta ubicación nos acerca al 80-90% de capacidad, dar bonus pequeño
            const newLoad = currentLoad + locationWeight;
            const utilizationAfter = newLoad / vehicle.capacity;
            if (utilizationAfter >= 0.7 && utilizationAfter <= 0.95) {
              score *= 1.1; // Bonus pequeño para no afectar la prioridad de distancia
            }
            
            if (score > bestScore) {
              bestScore = score;
              bestIndex = i;
            }
          }
        }
      }
      
      // Si no se encontró ninguna ubicación que quepa, terminar la ruta
      if (bestIndex === -1) {
        console.log(`   ⏹️  No hay más ubicaciones que quepan. Ruta terminada con ${currentLoad.toFixed(1)}kg (${((currentLoad/vehicle.capacity)*100).toFixed(1)}% ocupación)`);
        break;
      }
      
      // Verificar límite de paradas antes de agregar
      if (route.stops.length >= MAX_STOPS_PER_ROUTE) {
        console.log(`   ⚠️  Límite de ${MAX_STOPS_PER_ROUTE} paradas alcanzado. Ruta terminada con ${route.stops.length} paradas, ${currentLoad.toFixed(1)}kg (${((currentLoad/vehicle.capacity)*100).toFixed(1)}% ocupación)`);
        break;
      }
      
      const nextLocation = unvisited.splice(bestIndex, 1)[0];
      
      // CRÍTICO: Verificar límite de paradas ANTES de agregar
      if (route.stops.length >= MAX_STOPS_PER_ROUTE) {
        console.log(`   ⚠️  Límite de ${MAX_STOPS_PER_ROUTE} paradas alcanzado antes de agregar. Devolviendo ubicación a la lista.`);
        unvisited.push(nextLocation);
        break;
      }
      
      const distance = this.calculateDistance(
        currentLocation.lat, currentLocation.lon,
        nextLocation.lat, nextLocation.lon
      );
      
      // Verificación final antes de agregar (por seguridad)
      if (route.stops.length >= MAX_STOPS_PER_ROUTE) {
        console.log(`   ⚠️  ERROR: Límite alcanzado justo antes de push. Esto no debería pasar.`);
        unvisited.push(nextLocation);
        break;
      }
      
      route.stops.push(nextLocation);
      
      // Verificación después de agregar para asegurar que no se excedió
      if (route.stops.length > MAX_STOPS_PER_ROUTE) {
        console.error(`   ❌ ERROR CRÍTICO: Se excedió el límite de ${MAX_STOPS_PER_ROUTE} paradas. Ruta tiene ${route.stops.length} paradas.`);
        route.stops.pop(); // Remover la última parada agregada
        unvisited.push(nextLocation);
        break;
      }
      
      currentLoad += nextLocation.peso;
      route.totalDistance += distance;
      currentLocation = nextLocation;
      
      // MEJORA: Continuar agregando ubicaciones hasta llenar mejor la ruta
      // No terminar automáticamente, solo cuando realmente no quepan más ubicaciones
      // Si la ruta está bien llena (>= 80%), intentar agregar ubicaciones pequeñas cercanas
      // PERO respetar el límite de 50 paradas
      if (currentLoad >= vehicle.capacity * 0.8 && route.stops.length < MAX_STOPS_PER_ROUTE) {
        // Intentar agregar ubicaciones pequeñas cercanas si hay espacio
        const remainingCapacity = vehicle.capacity - currentLoad;
        const nearbySmallLocations = unvisited.filter(loc => 
          loc.peso <= remainingCapacity && 
          loc.peso <= vehicle.capacity * 0.2 // Ubicaciones pequeñas (≤20% de capacidad)
        );
        
        if (nearbySmallLocations.length > 0) {
          // Ordenar por distancia
          nearbySmallLocations.sort((a, b) => {
            const distA = this.calculateDistance(currentLocation.lat, currentLocation.lon, a.lat, a.lon);
            const distB = this.calculateDistance(currentLocation.lat, currentLocation.lon, b.lat, b.lon);
            return distA - distB;
          });
          
          // Agregar ubicaciones pequeñas cercanas (hasta 10km de distancia)
          for (const smallLoc of nearbySmallLocations) {
            // Verificar límite de paradas antes de agregar
            if (route.stops.length >= MAX_STOPS_PER_ROUTE) {
              break;
            }
            
            if (currentLoad + smallLoc.peso <= vehicle.capacity) {
              const distance = this.calculateDistance(
                currentLocation.lat, currentLocation.lon,
                smallLoc.lat, smallLoc.lon
              );
              
              // Solo agregar si está relativamente cerca (≤10km) o si la ruta aún tiene mucho espacio
              if (distance <= 10 || currentLoad < vehicle.capacity * 0.9) {
                route.stops.push(smallLoc);
                currentLoad += smallLoc.peso;
                route.totalDistance += distance;
                currentLocation = smallLoc;
                
                // Remover de unvisited
                const index = unvisited.findIndex(loc => 
                  loc.lat === smallLoc.lat && loc.lon === smallLoc.lon && loc.peso === smallLoc.peso
                );
                if (index !== -1) {
                  unvisited.splice(index, 1);
                }
                
                // Si la ruta está muy llena (≥95%) o alcanzó el límite de paradas, parar
                if (currentLoad >= vehicle.capacity * 0.95 || route.stops.length >= MAX_STOPS_PER_ROUTE) {
                  break;
                }
              }
            }
          }
        }
      }
    }
    
    // MEJORA CRÍTICA: Si la ruta tiene poco peso, intentar agregar MÁS ubicaciones para llenarla mejor
    // CRÍTICO: No aceptar rutas con menos del 60% de ocupación
    if (currentLoad < vehicle.capacity * 0.6 && unvisited.length > 0) {
      console.log(`   🔄 Ruta con ${currentLoad.toFixed(1)}kg (${((currentLoad/vehicle.capacity)*100).toFixed(1)}% ocupación), intentando agregar más ubicaciones...`);
      
      const remainingCapacity = vehicle.capacity - currentLoad;
      // Buscar TODAS las ubicaciones que quepan, no solo las pequeñas
      const availableLocations = unvisited.filter(loc => loc.peso <= remainingCapacity);
      
      if (availableLocations.length > 0) {
        // Ordenar por distancia desde la última ubicación
        availableLocations.sort((a, b) => {
          const distA = this.calculateDistance(currentLocation.lat, currentLocation.lon, a.lat, a.lon);
          const distB = this.calculateDistance(currentLocation.lat, currentLocation.lon, b.lat, b.lon);
          return distA - distB;
        });
        
        // Agregar ubicaciones hasta llenar la ruta al menos al 60% O hasta alcanzar el límite de 50 paradas
        let addedCount = 0;
        for (const loc of availableLocations) {
          // CRÍTICO: Verificar límite de paradas ANTES de agregar
          if (route.stops.length >= MAX_STOPS_PER_ROUTE) {
            console.log(`   ⚠️  Límite de ${MAX_STOPS_PER_ROUTE} paradas alcanzado. Ruta terminada con ${route.stops.length} paradas`);
            break;
          }
          
          if (currentLoad + loc.peso <= vehicle.capacity) {
            const distance = this.calculateDistance(
              currentLocation.lat, currentLocation.lon,
              loc.lat, loc.lon
            );
            
            route.stops.push(loc);
            currentLoad += loc.peso;
            route.totalDistance += distance;
            currentLocation = loc;
            addedCount++;
            
            // Remover de unvisited
            const index = unvisited.findIndex(u => 
              u.lat === loc.lat && u.lon === loc.lon && u.peso === loc.peso
            );
            if (index !== -1) {
              unvisited.splice(index, 1);
            }
            
            // Si ya tenemos buen peso (≥60%) o alcanzamos el límite, parar
            if (currentLoad >= vehicle.capacity * 0.6 || route.stops.length >= MAX_STOPS_PER_ROUTE) {
              console.log(`   ✅ Agregadas ${addedCount} ubicaciones adicionales. Ruta ahora con ${currentLoad.toFixed(1)}kg (${((currentLoad/vehicle.capacity)*100).toFixed(1)}% ocupación), ${route.stops.length} paradas`);
              break;
            }
          }
        }
        
        if (addedCount > 0 && currentLoad < vehicle.capacity * 0.6) {
          console.log(`   ⚠️  Agregadas ${addedCount} ubicaciones pero aún con ${currentLoad.toFixed(1)}kg (${((currentLoad/vehicle.capacity)*100).toFixed(1)}% ocupación)`);
        }
      } else {
        console.log(`   ⚠️  No hay más ubicaciones que quepan (capacidad restante: ${remainingCapacity.toFixed(1)}kg)`);
      }
    }
    
    // Volver al depósito
    const returnDistance = this.calculateDistance(
      currentLocation.lat, currentLocation.lon,
      this.depot.lat, this.depot.lon
    );
    route.totalDistance += returnDistance;
    
    // OPTIMIZACIÓN 2-OPT: Mejorar el orden de las paradas para reducir zigzags
    // Solo aplicar si hay al menos 3 paradas (depot + 2 paradas + depot)
    if (route.stops.length >= 2) {
      route = this.optimizeRouteWith2Opt(route);
    }
    
    // Calcular métricas
    route.totalWeight = currentLoad;
    route.totalTime = (route.totalDistance / 30) * 60; // Asumiendo 30 km/h promedio
    route.totalCost = vehicle.costPerTrip; // Costo fijo por viaje
    route.utilization = (currentLoad / vehicle.capacity) * 100;
    
    return route;
  }

  // Optimización 2-opt mejorada para reducir zigzags y cruces
  optimizeRouteWith2Opt(route) {
    if (route.stops.length < 3) return route; // Necesitamos al menos 3 paradas para optimizar
    
    let improved = true;
    let iterations = 0;
    const maxIterations = 25; // Aumentar iteraciones para mejor optimización
    
    while (improved && iterations < maxIterations) {
      improved = false;
      iterations++;
      
      let bestDistance = this.calculateRouteDistance(route);
      let bestImprovement = 0;
      let bestI = -1;
      let bestJ = -1;
      
      // Probar TODOS los intercambios posibles y elegir el mejor (no solo el primero)
      for (let i = 0; i < route.stops.length - 1; i++) {
        for (let j = i + 2; j < route.stops.length; j++) {
          // Crear nueva ruta con aristas intercambiadas
          const newStops = [
            ...route.stops.slice(0, i + 1),
            ...route.stops.slice(i + 1, j + 1).reverse(),
            ...route.stops.slice(j + 1)
          ];
          
          const newRoute = {
            ...route,
            stops: newStops
          };
          
          const newDistance = this.calculateRouteDistance(newRoute);
          const improvement = bestDistance - newDistance;
          
          // Guardar el mejor intercambio (no solo el primero que mejore)
          if (improvement > bestImprovement) {
            bestImprovement = improvement;
            bestI = i;
            bestJ = j;
          }
        }
      }
      
      // Aplicar el mejor intercambio si hay mejora significativa (al menos 100m)
      if (bestImprovement > 0.1) {
        const newStops = [
          ...route.stops.slice(0, bestI + 1),
          ...route.stops.slice(bestI + 1, bestJ + 1).reverse(),
          ...route.stops.slice(bestJ + 1)
        ];
        
        route.stops = newStops;
        route.totalDistance = this.calculateRouteDistance(route);
        improved = true;
      }
    }
    
    return route;
  }
  
  // Calcular distancia total de una ruta (incluyendo depósito al inicio y fin)
  calculateRouteDistance(route) {
    let totalDistance = 0;
    
    // Distancia del depósito a la primera parada
    if (route.stops.length > 0) {
      totalDistance += this.calculateDistance(
        this.depot.lat, this.depot.lon,
        route.stops[0].lat, route.stops[0].lon
      );
    }
    
    // Distancia entre paradas consecutivas
    for (let i = 0; i < route.stops.length - 1; i++) {
      totalDistance += this.calculateDistance(
        route.stops[i].lat, route.stops[i].lon,
        route.stops[i + 1].lat, route.stops[i + 1].lon
      );
    }
    
    // Distancia de la última parada al depósito
    if (route.stops.length > 0) {
      const lastStop = route.stops[route.stops.length - 1];
      totalDistance += this.calculateDistance(
        lastStop.lat, lastStop.lon,
        this.depot.lat, this.depot.lon
      );
    }
    
    return totalDistance;
  }

  getVehicleBreakdown(routes) {
    const breakdown = {};
    
    routes.forEach(route => {
      if (!breakdown[route.vehicleType]) {
        breakdown[route.vehicleType] = {
          count: 0,
          totalWeight: 0,
          totalDistance: 0,
          totalCost: 0,
          averageUtilization: 0
        };
      }
      
      breakdown[route.vehicleType].count++;
      breakdown[route.vehicleType].totalWeight += route.totalWeight;
      breakdown[route.vehicleType].totalDistance += route.totalDistance;
      breakdown[route.vehicleType].totalCost += route.totalCost;
    });
    
    // Calcular utilización promedio
    Object.keys(breakdown).forEach(vehicleType => {
      const vehicleRoutes = routes.filter(r => r.vehicleType === vehicleType);
      breakdown[vehicleType].averageUtilization = vehicleRoutes.length > 0 ?
        vehicleRoutes.reduce((sum, r) => sum + r.utilization, 0) / vehicleRoutes.length : 0;
    });
    
    return breakdown;
  }

  calculateDistance(lat1, lon1, lat2, lon2) {
    // Distancia Manhattan: |lat1-lat2| + |lon1-lon2|
    // Convertir grados a km aproximadamente (1 grado ≈ 111 km)
    const latDiff = Math.abs(lat2 - lat1) * 111;
    const lonDiff = Math.abs(lon2 - lon1) * 111 * Math.cos(lat1 * Math.PI / 180);
    return latDiff + lonDiff;
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

      csv.parseFile(filePath, { headers: true, trimHeaders: true, ignoreEmpty: true })
        .on('data', (data) => {
          // Normalizar nombres de columnas (eliminar espacios extra)
          const normalizedData = {};
          for (const key in data) {
            const normalizedKey = key.trim();
            normalizedData[normalizedKey] = data[key];
          }
          results.push(normalizedData);
          recordsProcessed++;
          
          // Obtener peso - trimHeaders elimina espacios del nombre de columna, así que buscar sin espacio
          const peso = parseFloat(
            normalizedData['Peso Disposición Final (kg)'] ||  // Sin espacio (trimHeaders lo eliminó)
            normalizedData['Peso Disposición Final (kg) '] ||  // Con espacio (por si acaso)
            0
          );
          
          // Debug: verificar peso en los primeros registros
          if (recordsProcessed <= 5) {
            const pesoRaw1 = normalizedData['Peso Disposición Final (kg)'];
            const pesoRaw2 = normalizedData['Peso Disposición Final (kg) '];
            console.log(`🔍 Registro ${recordsProcessed}:`);
            console.log(`   Peso sin espacio="${pesoRaw1}", Peso con espacio="${pesoRaw2}"`);
            console.log(`   Peso parseado=${peso}`);
            console.log(`   Claves con "peso":`, Object.keys(normalizedData).filter(k => k.toLowerCase().includes('peso')));
          }
          
          pesoTotal += peso;
          
          const direccion = normalizedData['Dirección'] || '';
          const ciudad = normalizedData['Ciudad'] || '';
          ubicacionesUnicas.add(`${direccion}, ${ciudad}`);
          
          // Debug: verificar coordenadas en los primeros registros
          if (recordsProcessed <= 3) {
            const lat = normalizedData['Latitud'];
            const lon = normalizedData['Longitud'];
            console.log(`🔍 Registro ${recordsProcessed}: Lat="${lat}", Lon="${lon}"`);
          }
        })
        .on('end', async () => {
          console.log(`📊 Total de registros leídos: ${recordsProcessed}`);
          
          // Optimización: Agrupar por direcciones únicas y geocodificar solo una vez por dirección
          console.log(`🗺️ Iniciando procesamiento de coordenadas...`);
          
          const direccionesMap = new Map(); // Mapa para almacenar resultados de geocodificación por dirección
          const direccionesUnicas = new Set();
          
          // Verificar si el CSV tiene coordenadas
          const tieneCoordenadasEnCSV = results.some(data => {
            const lat = data['Latitud'] ? parseFloat(data['Latitud']) : null;
            const lon = data['Longitud'] ? parseFloat(data['Longitud']) : null;
            return lat !== null && lon !== null && !isNaN(lat) && !isNaN(lon);
          });
          
          if (tieneCoordenadasEnCSV) {
            console.log(`✅ El CSV incluye coordenadas. Omitiendo geocodificación.`);
            // Si el CSV tiene coordenadas, no necesitamos geocodificar
          } else {
            // Primero, identificar todas las direcciones únicas que necesitan geocodificación
            results.forEach(data => {
            const direccion = data['Dirección'] || '';
            const ciudad = data['Ciudad'] || '';
              const key = `${direccion}|${ciudad}`;
              // Solo geocodificar si no tiene coordenadas en el CSV
              const lat = data['Latitud'] ? parseFloat(data['Latitud']) : null;
              const lon = data['Longitud'] ? parseFloat(data['Longitud']) : null;
              if (direccion && !direccionesUnicas.has(key) && (lat === null || lon === null || isNaN(lat) || isNaN(lon))) {
                direccionesUnicas.add(key);
              }
            });
            
            console.log(`📍 Geocodificando ${direccionesUnicas.size} direcciones únicas de ${results.length} registros`);
            
            // Solo geocodificar si hay direcciones que lo necesitan
            if (direccionesUnicas.size > 0) {
            // Geocodificar direcciones únicas en lotes paralelos (con límite de concurrencia)
            // OPTIMIZACIÓN: Para archivos grandes, usar más paralelismo
            const direccionesArray = Array.from(direccionesUnicas);
            const batchSize = direccionesArray.length > 100 ? 10 : 5; // Más paralelismo para archivos grandes
            
            console.log(`🔄 Procesando ${direccionesArray.length} direcciones en lotes de ${batchSize}...`);
            
            for (let i = 0; i < direccionesArray.length; i += batchSize) {
              const batch = direccionesArray.slice(i, i + batchSize);
              const promises = batch.map(async (key) => {
                const [direccion, ciudad] = key.split('|');
                const departamento = 'BOGOTA, D. C.'; // Asumir Bogotá por defecto
                
                try {
            const geocodeResult = await geocodeBogotaAddress(direccion, ciudad, departamento);
                  direccionesMap.set(key, geocodeResult);
                  return true;
                } catch (error) {
                  // En caso de error, usar fallback rápido
                  const hash = direccion.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
                  const latOffset = ((hash % 1000) / 10000) - 0.05;
                  const lonOffset = (((hash * 7) % 1000) / 10000) - 0.05;
                  
                  direccionesMap.set(key, {
                    lat: 4.6097 + latOffset,
                    lon: -74.0817 + lonOffset,
                    address: `${direccion}, ${ciudad}, ${departamento}, Colombia`,
                    confidence: 'low'
                  });
                  return false;
                }
              });
              
              await Promise.all(promises);
              const progress = Math.min(i + batchSize, direccionesArray.length);
              console.log(`✅ Procesadas ${progress}/${direccionesArray.length} direcciones (${Math.round(progress/direccionesArray.length*100)}%)`);
            }
            
              console.log(`✅ Geocodificación completada`);
            } else {
              console.log(`✅ No se requiere geocodificación - todas las direcciones tienen coordenadas en el CSV`);
            }
          }
          
          // Insertar datos en la base de datos usando transacción para mayor velocidad
          const insertStmt = db.prepare(`INSERT INTO residuos (
              subida_id, categoria, subcategoria, aplica_metas, fecha, manifiesto,
              nombre_residuo, peso_kg, canal_recoleccion, tipo_gestion, certificado,
              gestor, centro_acopio, razon_social, nit, responsable_envio, correo,
              direccion, departamento, ciudad, latitud, longitud,
              direccion_geocodificada, confianza_geocodificacion, procesado, utm_x, utm_y, utm_zona
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            
          // Iniciar transacción
          db.run('BEGIN TRANSACTION', (err) => {
            if (err) {
              console.error('Error iniciando transacción:', err);
            }
            
            // Insertar todos los registros
            let coordsCount = 0;
            let coordsStats = { minLat: Infinity, maxLat: -Infinity, minLon: Infinity, maxLon: -Infinity };
            
            for (const data of results) {
              const direccion = data['Dirección'] || '';
              const ciudad = data['Ciudad'] || '';
              
              // Obtener peso - trimHeaders elimina espacios del nombre de columna
              let pesoKg = parseFloat(
                data['Peso Disposición Final (kg)'] ||  // Sin espacio (trimHeaders lo eliminó)
                data['Peso Disposición Final (kg) '] ||  // Con espacio (por si acaso)
                0
              );
              
              // Si el peso es 0 o NaN, intentar buscar en todas las claves que contengan "peso"
              if (pesoKg === 0 || isNaN(pesoKg)) {
                for (const key in data) {
                  if (key.toLowerCase().includes('peso') && key.toLowerCase().includes('disposición')) {
                    pesoKg = parseFloat(data[key] || 0);
                    if (pesoKg > 0) {
                      console.log(`✅ Peso encontrado en columna alternativa: "${key}" = ${pesoKg}`);
                      break;
                    }
                  }
                }
              }
              
              // Debug para primeros registros
              if (coordsCount < 3) {
                console.log(`🔍 INSERT Registro ${coordsCount + 1}: peso_kg=${pesoKg}, direccion=${direccion.substring(0, 30)}...`);
              }
              
              // PRIORIDAD: Si el CSV ya tiene coordenadas (Latitud/Longitud), usarlas directamente
              let latitud, longitud, direccionGeocodificada, confianzaGeocodificacion;
              let utmX = null, utmY = null, utmZona = null;
              
              // Leer coordenadas del CSV normalizado (ya se hizo trim en normalizedData)
              const latRaw = data['Latitud'] || '';
              const lonRaw = data['Longitud'] || '';
              
              // Leer coordenadas UTM del CSV
              const utmXRaw = data['utm_x'] || '';
              const utmYRaw = data['utm_y'] || '';
              const utmZonaRaw = data['utm_zona'] || '';
              
              // Limpiar y parsear coordenadas (remover comillas si existen, espacios, etc.)
              let latitudCSV = null;
              let longitudCSV = null;
              
              if (latRaw) {
                const latStr = String(latRaw).trim().replace(/"/g, '').replace(/'/g, '');
                latitudCSV = parseFloat(latStr);
              }
              
              if (lonRaw) {
                const lonStr = String(lonRaw).trim().replace(/"/g, '').replace(/'/g, '');
                longitudCSV = parseFloat(lonStr);
              }
              
              // Leer UTM del CSV si está disponible
              if (utmXRaw) {
                const utmXStr = String(utmXRaw).trim().replace(/"/g, '').replace(/'/g, '');
                utmX = parseFloat(utmXStr);
              }
              
              if (utmYRaw) {
                const utmYStr = String(utmYRaw).trim().replace(/"/g, '').replace(/'/g, '');
                utmY = parseFloat(utmYStr);
              }
              
              if (utmZonaRaw) {
                utmZona = String(utmZonaRaw).trim().replace(/"/g, '').replace(/'/g, '');
              }
              
              if (latitudCSV !== null && longitudCSV !== null && !isNaN(latitudCSV) && !isNaN(longitudCSV)) {
                // Usar coordenadas del CSV directamente
                latitud = latitudCSV;
                longitud = longitudCSV;
                direccionGeocodificada = `${direccion}, ${ciudad}, Colombia`;
                confianzaGeocodificacion = 'csv';
                
                // Si no hay UTM en el CSV pero hay lat/lon, calcularlo
                if ((utmX === null || utmY === null || !utmZona) && !isNaN(latitud) && !isNaN(longitud)) {
                  try {
                    const utmCoords = utm.fromLatLon(latitud, longitud);
                    utmX = utmCoords.easting;
                    utmY = utmCoords.northing;
                    utmZona = `${utmCoords.zoneNum}${utmCoords.zoneLetter}`;
                  } catch (e) {
                    console.warn(`⚠️  Error calculando UTM para lat=${latitud}, lon=${longitud}: ${e.message}`);
                  }
                }
                
                // Acumular estadísticas
                coordsCount++;
                coordsStats.minLat = Math.min(coordsStats.minLat, latitud);
                coordsStats.maxLat = Math.max(coordsStats.maxLat, latitud);
                coordsStats.minLon = Math.min(coordsStats.minLon, longitud);
                coordsStats.maxLon = Math.max(coordsStats.maxLon, longitud);
                if (results.indexOf(data) < 5) {
                  console.log(`📍 CSV coords [${results.indexOf(data)}]: Lat=${latitud}, Lon=${longitud}, UTM=${utmX?.toFixed(2)},${utmY?.toFixed(2)},${utmZona}`);
                }
              } else {
                // Si no hay coordenadas en el CSV, usar geocodificación
                const key = `${direccion}|${ciudad}`;
                const geocodeResult = direccionesMap.get(key);
                
                latitud = geocodeResult ? geocodeResult.lat : 4.6097;
                longitud = geocodeResult ? geocodeResult.lon : -74.0817;
                direccionGeocodificada = geocodeResult ? geocodeResult.address : direccion;
                confianzaGeocodificacion = geocodeResult ? geocodeResult.confidence : 'fallback';
                
                // Calcular UTM desde lat/lon geocodificados
                try {
                  const utmCoords = utm.fromLatLon(latitud, longitud);
                  utmX = utmCoords.easting;
                  utmY = utmCoords.northing;
                  utmZona = `${utmCoords.zoneNum}${utmCoords.zoneLetter}`;
                } catch (e) {
                  // Si falla el cálculo UTM, dejar como null
                }
              }
              
              insertStmt.run(
              subidaId,
              data['Categoría'] || '',
              data['Subcategoria'] || '',
              data['APLICA EN LAS METAS ACTUALES'] || '',
              data['Fecha'] || '',
              data['Manifiesto'] || '',
              data['Nombre de Residuo'] || '',
              pesoKg,  // Usar pesoKg que ya se calculó correctamente arriba
              data['Canal o Mecanismo de recolección'] || '',
              data['Tipo de Gestión (proceso)'] || '',
              data['certificado '] || '',
              data['Gestor '] || '',
              data['Centro de acopio'] || '',
              data['Razón social del generador'] || '',
              data['Nit'] || '',
              data['Responsable del envío'] || '',
              data['Correo '] || '',
              direccion,
              data['Departamento'] || 'BOGOTA, D. C.',
              ciudad,
              latitud,
              longitud,
              direccionGeocodificada,
              confianzaGeocodificacion,
              0,  // procesado = 0 (no procesado)
              utmX,
              utmY,
              utmZona
              );
            }
            
            // Finalizar statement y hacer commit
            insertStmt.finalize((err) => {
              if (err) {
                console.error('Error finalizando statement:', err);
                db.run('ROLLBACK');
              } else {
                db.run('COMMIT', (err) => {
                  if (err) {
                    console.error('Error en commit:', err);
                  } else {
                    console.log(`✅ ${results.length} registros insertados en la base de datos`);
                    
                    // Mostrar estadísticas de coordenadas
                    if (coordsCount > 0) {
                      console.log(`\n📍 ESTADÍSTICAS DE COORDENADAS DEL CSV:`);
                      console.log(`   Total con coordenadas válidas: ${coordsCount} de ${results.length} registros`);
                      console.log(`   Rango Latitud: ${coordsStats.minLat.toFixed(6)} a ${coordsStats.maxLat.toFixed(6)}`);
                      console.log(`   Diferencia Latitud: ${(coordsStats.maxLat - coordsStats.minLat).toFixed(6)} grados (~${((coordsStats.maxLat - coordsStats.minLat) * 111).toFixed(2)} km)`);
                      console.log(`   Rango Longitud: ${coordsStats.minLon.toFixed(6)} a ${coordsStats.maxLon.toFixed(6)}`);
                      console.log(`   Diferencia Longitud: ${(coordsStats.maxLon - coordsStats.minLon).toFixed(6)} grados (~${((coordsStats.maxLon - coordsStats.minLon) * 111 * Math.cos((coordsStats.minLat + coordsStats.maxLat) / 2 * Math.PI / 180)).toFixed(2)} km)\n`);
                    } else {
                      console.log(`⚠️  ADVERTENCIA: No se encontraron coordenadas válidas en el CSV`);
                    }
                    
                    continueAfterInsert();
                  }
                });
              }
            });
          });
          
          // Función para continuar después de insertar
          function continueAfterInsert() {
            console.log(`✅ Datos guardados en base de datos`);
          
          // Actualizar historial con estadísticas
          const updateStmt = db.prepare(`UPDATE historial_subidas SET 
            registros_procesados = ?, peso_total = ?, ubicaciones_unicas = ?
            WHERE id = ?`);
          
            updateStmt.run(recordsProcessed, pesoTotal, ubicacionesUnicas.size, subidaId, (err) => {
              if (err) {
                console.error('Error actualizando historial:', err);
              }
              
              updateStmt.finalize();
          
          console.log(`✅ Subida ${subidaId} completada: ${recordsProcessed} registros, ${pesoTotal} kg, ${ubicacionesUnicas.size} ubicaciones`);
          
          // Limpiar archivo temporal
              try {
          fs.unlinkSync(filePath);
              } catch (unlinkErr) {
                console.error('Error eliminando archivo temporal:', unlinkErr);
              }
          
          res.json({
            message: 'Archivo procesado exitosamente',
            subidaId: subidaId,
            recordsProcessed: recordsProcessed,
            pesoTotal: pesoTotal,
            ubicacionesUnicas: ubicacionesUnicas.size
          });
            });
          }
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
  
  // Obtener cada registro individual con sus coordenadas del CSV
  // SOLO usar latitud y longitud del CSV cargado
  let query = `
    SELECT 
      direccion,
      ciudad,
      peso_kg as peso_total,
      1 as cantidad_residuos,
      razon_social as empresas,
      nombre_residuo as tipos_residuo,
      latitud,
      longitud
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
  
  // SOLO filtrar registros con latitud y longitud válidas del CSV
  query += ' AND latitud IS NOT NULL AND longitud IS NOT NULL';
  query += ' AND latitud != 0 AND longitud != 0';
  query += ' ORDER BY peso_kg DESC';
  
  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('Error obteniendo datos:', err);
      return res.status(500).json({ error: 'Error obteniendo datos' });
    }
    
    // Filtrar y validar coordenadas
    const locations = rows
      .map((row, index) => {
        const lat = parseFloat(row.latitud);
        const lon = parseFloat(row.longitud);
        
        // Solo incluir si las coordenadas son válidas
        if (isNaN(lat) || isNaN(lon) || lat === 0 || lon === 0) {
          return null;
        }
        
        return {
          id: `location_${index}`,
          lat: lat,
          lon: lon,
          peso: parseFloat(row.peso_total) || 0,
          direccion: row.direccion || '',
          ciudad: row.ciudad || '',
          cantidad_residuos: row.cantidad_residuos || 1,
          empresas: row.empresas || '',
          tipos_residuo: row.tipos_residuo || ''
        };
      })
      .filter(location => location !== null);
    
    console.log(`📍 ${locations.length} puntos con coordenadas válidas (lat/lon del CSV) para subida ${subidaId || 'más reciente'}`);
    
    res.json(locations);
  });
});

// Endpoints para gestión de vehículos personalizados
app.get('/api/vehicles', (req, res) => {
  db.all('SELECT * FROM vehiculos_personalizados ORDER BY fecha_actualizacion DESC', (err, rows) => {
    if (err) {
      console.error('Error obteniendo vehículos:', err);
      return res.status(500).json({ error: 'Error obteniendo vehículos' });
    }
    
    const vehicles = rows.map(row => ({
      id: row.id,
      name: row.nombre,
      type: row.tipo,
      capacity: row.capacidad_kg,
      costPerTrip: row.costo_viaje
    }));
    
    res.json({ vehicles });
  });
});

app.post('/api/vehicles/update', (req, res) => {
  const { vehicles } = req.body;
  
  if (!Array.isArray(vehicles)) {
    return res.status(400).json({ error: 'vehicles debe ser un array' });
  }
  
  console.log(`🔄 Actualizando ${vehicles.length} vehículos en el backend...`);
  
  // Iniciar transacción
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    
    // Eliminar todos los vehículos existentes
    db.run('DELETE FROM vehiculos_personalizados', (err) => {
      if (err) {
        console.error('Error eliminando vehículos:', err);
        db.run('ROLLBACK');
        return res.status(500).json({ error: 'Error actualizando vehículos' });
      }
      
      // Insertar nuevos vehículos
      if (vehicles.length > 0) {
        const stmt = db.prepare('INSERT INTO vehiculos_personalizados (nombre, tipo, capacidad_kg, costo_viaje) VALUES (?, ?, ?, ?)');
        let completed = 0;
        
        vehicles.forEach((vehicle) => {
          stmt.run(
            vehicle.name,
            vehicle.type,
            vehicle.capacity,
            vehicle.costPerTrip,
            (err) => {
              if (err) {
                console.error(`Error insertando vehículo ${vehicle.name}:`, err);
              } else {
                console.log(`   ✅ Vehículo guardado: ${vehicle.name} (${vehicle.capacity}kg)`);
              }
              
              completed++;
              // Si es el último vehículo, finalizar transacción
              if (completed === vehicles.length) {
                stmt.finalize((err) => {
                  if (err) {
                    console.error('Error finalizando statement:', err);
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: 'Error actualizando vehículos' });
                  }
                  
                  db.run('COMMIT', (err) => {
                    if (err) {
                      console.error('Error haciendo commit:', err);
                      return res.status(500).json({ error: 'Error actualizando vehículos' });
                    }
                    
                    console.log(`✅ ${vehicles.length} vehículos actualizados exitosamente en el backend`);
                    res.json({ success: true, message: `${vehicles.length} vehículos actualizados exitosamente` });
                  });
                });
              }
            }
          );
        });
      } else {
        // Si no hay vehículos, solo hacer commit
        db.run('COMMIT', (err) => {
          if (err) {
            console.error('Error haciendo commit:', err);
            return res.status(500).json({ error: 'Error actualizando vehículos' });
          }
          
          console.log('✅ Vehículos eliminados (lista vacía)');
          res.json({ success: true, message: 'Vehículos actualizados exitosamente' });
        });
      }
    });
  });
});

// Calcular rutas VRP híbridas
app.post('/api/calculate-routes', (req, res) => {
  const { vehicleType = 'hibrido', subidaId, customVehicles = [], vehicleConfigs = null } = req.body;
  
  console.log(`🚀 Iniciando cálculo de rutas VRP ${vehicleType}...`);
  console.log(`🔍 DEBUG - vehicleType: ${vehicleType}`);
  console.log(`🔍 DEBUG - customVehicles.length: ${customVehicles ? customVehicles.length : 0}`);
  console.log(`🔍 DEBUG - customVehicles:`, customVehicles.map(v => ({ name: v.name, type: v.type, capacity: v.capacity, costPerTrip: v.costPerTrip })));
  console.log(`🔍 DEBUG - VEHICLE_TYPES[vehicleType]: ${VEHICLE_TYPES[vehicleType] ? 'exists' : 'not exists'}`);
  
  // Determinar algoritmo a usar
  let useHybrid = false;
  let selectedVehicleType = vehicleType;
  let useCustomVehicles = false;
  
  // Verificar si hay vehículos personalizados disponibles
  if (customVehicles && customVehicles.length > 0) {
    useCustomVehicles = true;
    console.log(`🚛 Usando ${customVehicles.length} vehículos personalizados`);
    customVehicles.forEach(vehicle => {
      console.log(`   📋 ${vehicle.name}: ${vehicle.capacity}kg, $${vehicle.costPerTrip} COP/viaje`);
    });
  }
  
  if (vehicleType === 'hibrido' || vehicleType === 'auto') {
    useHybrid = true;
    console.log('🤖 Usando VRP Híbrido Multi-Vehículo');
  } else if (vehicleType === 'personalizado') {
    useCustomVehicles = true;
    console.log('🚛 Usando VRP con vehículos personalizados');
  } else if (!VEHICLE_TYPES[vehicleType]) {
    return res.status(400).json({ error: `Tipo de vehículo no válido: ${vehicleType}` });
  }
  
  // Para el cálculo VRP, también usar cada registro individual con sus coordenadas exactas
  let query = `
    SELECT 
      direccion,
      ciudad,
      peso_kg as peso_total,
      latitud,
      longitud
    FROM residuos 
    WHERE procesado = 0
    AND latitud IS NOT NULL AND longitud IS NOT NULL
  `;
  
  const params = [];
  if (subidaId) {
    query += ' AND subida_id = ?';
    params.push(subidaId);
  } else {
    query += ' AND subida_id = (SELECT MAX(id) FROM historial_subidas)';
  }
  
  query += ' ORDER BY peso_kg DESC';
  
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
    
    // Verificar que las ubicaciones tengan peso
    const locationsWithWeight = locations.filter(loc => loc.peso > 0);
    const totalPeso = locations.reduce((sum, loc) => sum + (loc.peso || 0), 0);
    
    console.log(`📍 ${locations.length} ubicaciones encontradas para VRP`);
    console.log(`⚖️ ${locationsWithWeight.length} ubicaciones con peso > 0`);
    console.log(`📦 Peso total: ${totalPeso.toFixed(2)} kg`);
    if (locations.length > 0) {
      console.log(`🔍 Ejemplo ubicación:`, {
        direccion: locations[0].direccion,
        peso: locations[0].peso,
        lat: locations[0].lat,
        lon: locations[0].lon
      });
    }
    
    try {
      let result;
      
      if (useCustomVehicles) {
        // Usar vehículos personalizados
        console.log('🚛 Calculando rutas con vehículos personalizados...');
        console.log('🔍 DEBUG - customVehicles:', customVehicles);
        const customVRP = new CustomVRPAlgorithm(locations, customVehicles);
        result = customVRP.calculateCustomRoutes();
        console.log('🔍 DEBUG - result:', result);
      } else if (useHybrid) {
        // Usar algoritmo VRP PROFESIONAL con Savings Algorithm y 2-opt
        console.log('🎯 Usando VRP Profesional (Savings Algorithm + 2-opt)');
        const professionalVRP = new ProfessionalVRPAlgorithm(locations, vehicleConfigs);
        const professionalResult = professionalVRP.calculateOptimizedRoutes();
        
        // Obtener peso total del historial si los locations tienen peso 0
        let pesoTotalForAnalysis = professionalResult.metrics.totalWeight;
        if (pesoTotalForAnalysis === 0 && currentSubidaId) {
          const historialRow = db.prepare('SELECT peso_total FROM historial_subidas WHERE id = ?').get(currentSubidaId);
          if (historialRow && historialRow.peso_total > 0) {
            pesoTotalForAnalysis = historialRow.peso_total;
            console.log(`✅ Usando peso del historial para análisis: ${pesoTotalForAnalysis} kg`);
          }
        }
        
        result = {
          routes: professionalResult.routes,
          analysis: {
            vehicleType: 'hibrido',
            vehicleConfig: { name: 'VRP Profesional - Savings + 2-opt', description: 'Camión + Moto optimizado con algoritmos profesionales' },
            totalVehicles: professionalResult.metrics.totalRoutes,
            totalWorkingDays: professionalResult.metrics.totalWorkingDays,
            averageUtilization: professionalResult.metrics.averageUtilization,
            feasibleRoutes: professionalResult.metrics.feasibleRoutes,
            totalCost: professionalResult.metrics.totalCost,
            costPerTon: pesoTotalForAnalysis > 0 ? professionalResult.metrics.totalCost / (pesoTotalForAnalysis / 1000) : 0,
            totalDistance: professionalResult.metrics.totalDistance,
            totalTime: professionalResult.metrics.totalTime,
            pesoTotal: pesoTotalForAnalysis || professionalResult.metrics.totalWeight || 0,  // Usar peso del historial si está disponible
            totalWeight: pesoTotalForAnalysis || professionalResult.metrics.totalWeight || 0,  // También como totalWeight para compatibilidad
            vehicleBreakdown: professionalResult.vehicleBreakdown
          }
        };
      } else {
        // Usar algoritmo VRP tradicional con configuración dinámica
        let vehicleConfig = null;
        if (vehicleConfigs && vehicleConfigs[selectedVehicleType]) {
          vehicleConfig = vehicleConfigs[selectedVehicleType];
        }
        const vrp = new AdvancedVRPAlgorithm(locations, selectedVehicleType, vehicleConfig);
        result = vrp.calculateRoutes();
      }
      
      // Obtener el ID de la subida más reciente si no se proporciona
      let currentSubidaId = subidaId;
      
      if (!currentSubidaId) {
        const latestSubida = db.prepare('SELECT MAX(id) as id FROM historial_subidas').get();
        currentSubidaId = latestSubida?.id;
        console.log(`🔍 SubidaId no proporcionado, usando el más reciente: ${currentSubidaId}`);
      }
      
      if (!currentSubidaId) {
        console.error('❌ No se encontró ID de subida válido');
        return res.status(400).json({ error: 'No se encontró subida válida para asociar las rutas' });
      }
      
      // Calcular cantidad de vehículos disponibles por tipo
      const vehiculosDisponibles = {};
      if (useCustomVehicles && customVehicles && customVehicles.length > 0) {
        // Contar vehículos por tipo desde customVehicles
        customVehicles.forEach(vehicle => {
          const tipo = vehicle.type || 'desconocido';
          if (!vehiculosDisponibles[tipo]) {
            vehiculosDisponibles[tipo] = 0;
          }
          vehiculosDisponibles[tipo]++;
        });
        console.log(`🚛 Vehículos disponibles por tipo:`, vehiculosDisponibles);
      } else if (useHybrid) {
        // Para híbrido, asumir 1 de cada tipo por defecto
        vehiculosDisponibles['camion'] = 1;
        vehiculosDisponibles['moto'] = 1;
      } else {
        // Para un solo tipo, asumir 1 vehículo
        vehiculosDisponibles[selectedVehicleType] = 1;
      }
      
      // Guardar las rutas en la base de datos
      const stmt = db.prepare(`
        INSERT INTO rutas_calculadas (
          subida_id, tipo_vehiculo, capacidad_vehiculo_kg, capacidad_vehiculo_m3,
          total_rutas, rutas_validas, peso_total_kg, distancia_total_km,
          tiempo_total_minutos, costo_total_usd, dias_trabajo, utilizacion_promedio, rutas_json, vehiculos_disponibles
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const pesoTotal = locations.reduce((sum, loc) => sum + loc.peso, 0);
      
      // Si el pesoTotal es 0 pero sabemos que hay datos, obtener del historial
      // Esto es un workaround cuando los pesos individuales no se guardaron correctamente
      let pesoTotalFromHistorial = 0;
      if (pesoTotal === 0 && currentSubidaId) {
        const historialRow = db.prepare('SELECT peso_total FROM historial_subidas WHERE id = ?').get(currentSubidaId);
        if (historialRow && historialRow.peso_total > 0) {
          pesoTotalFromHistorial = historialRow.peso_total;
          console.log(`✅ Peso total obtenido del historial (workaround): ${pesoTotalFromHistorial} kg`);
        }
      }
      
      // Usar el peso del historial si está disponible y el calculado es 0
      const finalPesoTotal = pesoTotalFromHistorial > 0 ? pesoTotalFromHistorial : pesoTotal;
      
      console.log(`📊 Peso total para análisis:`);
      console.log(`   Calculado de locations: ${pesoTotal} kg`);
      console.log(`   Obtenido del historial: ${pesoTotalFromHistorial} kg`);
      console.log(`   Final usado: ${finalPesoTotal} kg`);
      
      // Calcular peso total de las rutas asignadas
      const pesoTotalRutas = result.routes.reduce((sum, route) => sum + (route.totalWeight || 0), 0);
      
      // Verificar que todas las ubicaciones estén incluidas en las rutas
      const ubicacionesEnRutas = new Set();
      result.routes.forEach(route => {
        const routeLocations = route.locations || route.stops || [];
        routeLocations.forEach(loc => {
          if (loc && loc.lat && loc.lon && loc.peso > 0) {
            // Usar coordenadas como identificador único
            const key = `${loc.lat.toFixed(6)}_${loc.lon.toFixed(6)}`;
            ubicacionesEnRutas.add(key);
          }
        });
      });
      
      // Contar ubicaciones únicas en las rutas
      const ubicacionesUnicasEnRutas = ubicacionesEnRutas.size;
      const ubicacionesTotales = locations.length;
      
      console.log(`   Peso total de rutas asignadas: ${pesoTotalRutas} kg`);
      console.log(`   Ubicaciones totales: ${ubicacionesTotales}`);
      console.log(`   Ubicaciones en rutas: ${ubicacionesUnicasEnRutas}`);
      console.log(`   Diferencia de ubicaciones: ${ubicacionesTotales - ubicacionesUnicasEnRutas}`);
      console.log(`   Diferencia de peso: ${(finalPesoTotal - pesoTotalRutas).toFixed(1)} kg (${((finalPesoTotal - pesoTotalRutas) / finalPesoTotal * 100).toFixed(1)}%)`);
      
      if (ubicacionesTotales !== ubicacionesUnicasEnRutas) {
        console.warn(`⚠️ ADVERTENCIA: No todas las ubicaciones están en las rutas.`);
        console.warn(`   Ubicaciones totales: ${ubicacionesTotales}, Ubicaciones en rutas: ${ubicacionesUnicasEnRutas}`);
        console.warn(`   Faltan ${ubicacionesTotales - ubicacionesUnicasEnRutas} ubicaciones.`);
      }
      
      if (Math.abs(finalPesoTotal - pesoTotalRutas) > 100) { // Más de 100kg de diferencia
        console.warn(`⚠️ ADVERTENCIA: Hay una diferencia significativa entre el peso total (${finalPesoTotal}kg) y el peso de las rutas asignadas (${pesoTotalRutas}kg)`);
        console.warn(`   Esto puede indicar que algunas ubicaciones no fueron incluidas en las rutas.`);
      }
      
      // Usar el peso del historial si hay diferencia, pero mostrar ambos valores
      // El peso total debe ser el del historial (todos los registros), no solo las rutas asignadas
      
      // Calcular días de trabajo considerando vehículos trabajando en paralelo
      // IMPORTANTE: Las rutas ya fueron calculadas por el VRP con vehículos específicos asignados
      // No redistribuir, solo agrupar por vehículo individual y calcular días
      const workingMinutesPerDay = VRP_CONFIG.workingHours * 60; // 540 minutos (9 horas)
      
      // Agrupar rutas por vehículo individual (usando vehicleName si está disponible)
      const routesByVehicle = {};
      const vehicleTypeDetails = {};
      
      console.log(`🔍 DEBUG: Iniciando cálculo de vehicleTypeDetails`);
      console.log(`   result.analysis existe: ${!!result.analysis}`);
      console.log(`   result.analysis.vehicleAssignments existe: ${!!(result.analysis && result.analysis.vehicleAssignments)}`);
      console.log(`   result.routes.length: ${result.routes.length}`);
      
      result.routes.forEach(route => {
        // Identificar vehículo: usar vehicleName si está disponible, sino usar vehicleType
        const vehicleId = route.vehicleName || route.vehicleType || 'desconocido';
        const vehicleType = route.vehicleType || 'desconocido';
        // Obtener capacidad y costo del vehículo: primero de route, luego buscar en customVehicles
        let vehicleCapacity = route.vehicleCapacity;
        let vehicleCostPerTrip = route.vehicleCostPerTrip || 0;
        
        // Si no están en la ruta, buscar en customVehicles
        if ((!vehicleCapacity || !vehicleCostPerTrip) && customVehicles && customVehicles.length > 0) {
          const vehicle = customVehicles.find(v => v.name === vehicleId || v.type === vehicleType);
          if (vehicle) {
            if (!vehicleCapacity) vehicleCapacity = vehicle.capacity;
            if (!vehicleCostPerTrip) vehicleCostPerTrip = vehicle.costPerTrip || 0;
          }
        }
        
        if (!routesByVehicle[vehicleId]) {
          routesByVehicle[vehicleId] = {
            vehicleId: vehicleId,
            vehicleType: vehicleType,
            vehicleCapacity: vehicleCapacity,
            vehicleCostPerTrip: vehicleCostPerTrip,
            routes: [],
            totalTime: 0,
            totalWeight: 0,
            totalDistance: 0
          };
        } else {
          // Actualizar vehicleCostPerTrip si la ruta tiene un valor y el actual es 0 o undefined
          if (vehicleCostPerTrip && (!routesByVehicle[vehicleId].vehicleCostPerTrip || routesByVehicle[vehicleId].vehicleCostPerTrip === 0)) {
            routesByVehicle[vehicleId].vehicleCostPerTrip = vehicleCostPerTrip;
            console.log(`🔍 DEBUG: Actualizando vehicleCostPerTrip para ${vehicleId} a ${vehicleCostPerTrip}`);
          }
          // Actualizar vehicleCapacity si la ruta tiene un valor y el actual es undefined
          if (vehicleCapacity && !routesByVehicle[vehicleId].vehicleCapacity) {
            routesByVehicle[vehicleId].vehicleCapacity = vehicleCapacity;
          }
        }
        
        routesByVehicle[vehicleId].routes.push(route);
        routesByVehicle[vehicleId].totalTime += route.totalTime || 0;
        routesByVehicle[vehicleId].totalWeight += route.totalWeight || 0;
        routesByVehicle[vehicleId].totalDistance += route.totalDistance || 0;
        
        // Asegurar que vehicleCostPerTrip esté actualizado si la ruta lo tiene
        if (route.vehicleCostPerTrip && route.vehicleCostPerTrip > 0) {
          routesByVehicle[vehicleId].vehicleCostPerTrip = route.vehicleCostPerTrip;
        }
      });
      
      // Debug: Verificar que vehicleCostPerTrip se guardó correctamente
      console.log(`🔍 DEBUG routesByVehicle después de agrupar:`);
      Object.keys(routesByVehicle).forEach(vId => {
        console.log(`   ${vId}: vehicleCostPerTrip=${routesByVehicle[vId].vehicleCostPerTrip}, vehicleCapacity=${routesByVehicle[vId].vehicleCapacity}`);
      });
      
      // Si no hay vehicleName en las rutas, agrupar por tipo y distribuir
      let maxDaysNeeded = 0;
      
      if (Object.keys(routesByVehicle).length === 0 || Object.keys(routesByVehicle).every(k => !routesByVehicle[k].vehicleCapacity)) {
        // Fallback: agrupar por tipo y distribuir (para algoritmos que no asignan vehículos individuales)
        console.log('⚠️ Las rutas no tienen vehículos individuales asignados, agrupando por tipo...');
        
        const routesByType = {};
        result.routes.forEach(route => {
          const tipo = route.vehicleType || 'desconocido';
          if (!routesByType[tipo]) {
            routesByType[tipo] = [];
          }
          routesByType[tipo].push(route);
        });
        
        // Crear lista de vehículos individuales
        const individualVehicles = [];
        if (useCustomVehicles && customVehicles && customVehicles.length > 0) {
          customVehicles.forEach((vehicle, index) => {
            individualVehicles.push({
              id: vehicle.id || `vehicle_${index}`,
              name: vehicle.name,
              type: vehicle.type,
              capacity: vehicle.capacity
            });
          });
        } else if (useHybrid) {
          individualVehicles.push({ id: 'camion_1', name: 'Camión', type: 'camion', capacity: VEHICLE_TYPES.camion.capacityKg });
          individualVehicles.push({ id: 'moto_1', name: 'Moto', type: 'moto', capacity: VEHICLE_TYPES.moto.capacityKg });
        } else {
          const config = VEHICLE_TYPES[selectedVehicleType] || VEHICLE_TYPES.camion;
          individualVehicles.push({ id: `${selectedVehicleType}_1`, name: config.name, type: selectedVehicleType, capacity: config.capacityKg });
        }
        
        // Distribuir rutas entre vehículos
        const vehicleAssignments = individualVehicles.map(v => ({
          vehicle: v,
          routes: [],
          totalTime: 0
        }));
        
        Object.keys(routesByType).forEach(tipo => {
          const rutasTipo = routesByType[tipo];
          rutasTipo.sort((a, b) => (b.totalWeight || 0) - (a.totalWeight || 0));
          
          rutasTipo.forEach(route => {
            const compatibleVehicles = vehicleAssignments.filter(va => 
              va.vehicle.type === tipo && va.vehicle.capacity >= (route.totalWeight || 0)
            );
            
            if (compatibleVehicles.length > 0) {
              compatibleVehicles.sort((a, b) => a.totalTime - b.totalTime);
              const bestVehicle = compatibleVehicles[0];
              bestVehicle.routes.push(route);
              bestVehicle.totalTime += route.totalTime || 0;
            }
          });
        });
        
        // Calcular días
        vehicleAssignments.forEach(assignment => {
          const diasVehiculo = Math.ceil(assignment.totalTime / workingMinutesPerDay);
          maxDaysNeeded = Math.max(maxDaysNeeded, diasVehiculo);
          
          // Calcular peso total de las rutas asignadas a este vehículo
          const pesoTotalVehiculo = assignment.routes.reduce((sum, route) => sum + (route.totalWeight || 0), 0);
          
          const tipo = assignment.vehicle.type;
          if (!vehicleTypeDetails[tipo]) {
            vehicleTypeDetails[tipo] = {
              cantidadVehiculos: 0,
              totalRutas: 0,
              diasMaximos: 0,
              diasPromedioPorVehiculo: 0,
              ocupacionPromedioDiaria: 0,
              tiempoTotal: 0,
              tiempoPromedioPorVehiculo: 0,
              pesoTotal: 0,
              vehicles: []
            };
          }
          
          vehicleTypeDetails[tipo].cantidadVehiculos++;
          vehicleTypeDetails[tipo].totalRutas += assignment.routes.length;
          vehicleTypeDetails[tipo].diasMaximos = Math.max(vehicleTypeDetails[tipo].diasMaximos, diasVehiculo);
          vehicleTypeDetails[tipo].tiempoTotal += assignment.totalTime;
          vehicleTypeDetails[tipo].pesoTotal += pesoTotalVehiculo;
          
          // CORRECCIÓN: Ocupación diaria por PESO
          // Cada ruta es un viaje completo (salida bodega → recogidas → vuelta bodega)
          // La ocupación diaria es el promedio de ocupación de todas las rutas
          // porque cada ruta ya representa un viaje completo con su propia ocupación
          const numRutas = assignment.routes.length;
          
          // Calcular ocupación por cada ruta (cada ruta es un viaje completo)
          const ocupacionesPorRuta = assignment.routes.map(route => {
            const pesoRuta = route.totalWeight || 0;
            return assignment.vehicle.capacity > 0 
              ? Math.min((pesoRuta / assignment.vehicle.capacity) * 100, 100) // Cada ruta no puede exceder 100%
              : 0;
          });
          
          // Ocupación diaria = promedio de ocupación de todas las rutas
          // Esto representa qué tan bien se está usando la capacidad del vehículo en promedio
          const ocupacionDiariaPorPeso = ocupacionesPorRuta.length > 0
            ? ocupacionesPorRuta.reduce((sum, occ) => sum + occ, 0) / ocupacionesPorRuta.length
            : 0;
          
          // Debug: Mostrar estadísticas de ocupación
          const pesoPromedioPorRuta = pesoTotalVehiculo / numRutas;
          const ocupacionPromedioPorRuta = ocupacionDiariaPorPeso;
          console.log(`   📊 ${assignment.vehicle.name}: ${numRutas} rutas, ${pesoTotalVehiculo.toFixed(1)}kg total, ${pesoPromedioPorRuta.toFixed(1)}kg/ruta promedio, capacidad=${assignment.vehicle.capacity}kg, ocupación promedio/ruta=${ocupacionPromedioPorRuta.toFixed(1)}%`);
          
          // Calcular costo total del vehículo: costo por viaje (COP) * días estimados
          // PRIORIDAD: Buscar costPerTrip directamente en customVehicles usando el nombre del vehículo
          let costPerTrip = 0;
          
          // PRIMERO: Buscar en customVehicles por nombre exacto (más confiable)
          if (customVehicles && customVehicles.length > 0) {
            const vehicleName = assignment.vehicle.name || assignment.vehicle.id || '';
            console.log(`🔍 DEBUG: Buscando costPerTrip en customVehicles para vehículo: "${vehicleName}"`);
            console.log(`   customVehicles disponibles:`, customVehicles.map(v => ({ name: v.name, costPerTrip: v.costPerTrip })));
            
            // Buscar por nombre exacto primero
            let vehicleConfig = customVehicles.find(v => v.name === vehicleName);
            
            // Si no se encuentra, buscar por nombre sin mayúsculas
            if (!vehicleConfig) {
              vehicleConfig = customVehicles.find(v => 
                v.name && vehicleName && v.name.toLowerCase() === vehicleName.toLowerCase()
              );
            }
            
            // Si no se encuentra, buscar por tipo y capacidad más cercana
            if (!vehicleConfig && assignment.vehicle.type) {
              const vehiclesOfType = customVehicles.filter(v => v.type === assignment.vehicle.type);
              if (vehiclesOfType.length > 0) {
                if (assignment.vehicle.capacity) {
                  vehicleConfig = vehiclesOfType.reduce((closest, current) => {
                    const currentDiff = Math.abs(current.capacity - assignment.vehicle.capacity);
                    const closestDiff = Math.abs(closest.capacity - assignment.vehicle.capacity);
                    return currentDiff < closestDiff ? current : closest;
                  });
                } else {
                  vehicleConfig = vehiclesOfType[0];
                }
              }
            }
            
            if (vehicleConfig && vehicleConfig.costPerTrip) {
              costPerTrip = vehicleConfig.costPerTrip;
              console.log(`✅ DEBUG: Encontrado costPerTrip en customVehicles: ${vehicleConfig.name} -> ${costPerTrip} COP`);
            } else {
              console.log(`⚠️ DEBUG: No se encontró costPerTrip en customVehicles para "${vehicleName}"`);
            }
          }
          
          // SEGUNDO: Si no se encontró en customVehicles, buscar en el vehicle assignment
          if (!costPerTrip) {
            costPerTrip = assignment.vehicle.costPerTrip || 0;
            if (costPerTrip) {
              console.log(`🔍 DEBUG: Obteniendo costPerTrip del vehicle assignment: ${costPerTrip}`);
            }
          }
          
          // TERCERO: Si aún no está, buscar en las rutas
          if (!costPerTrip && assignment.routes && assignment.routes.length > 0) {
            const routeWithCost = assignment.routes.find(r => r.vehicleCostPerTrip && r.vehicleCostPerTrip > 0);
            if (routeWithCost) {
              costPerTrip = routeWithCost.vehicleCostPerTrip;
              console.log(`🔍 DEBUG: Obteniendo costPerTrip de la ruta: ${costPerTrip}`);
            }
          }
          
          // Calcular costo total: costPerTrip * número de rutas (cada ruta es un viaje completo)
          // numRutas ya está declarado arriba
          const costoTotalVehiculo = costPerTrip * numRutas; // Costo total en COP
          
          console.log(`💰 DEBUG costo final ${assignment.vehicle.name}: costPerTrip=${costPerTrip} COP, rutas=${numRutas}, costoTotal=${costoTotalVehiculo} COP`);
          
          // Debug: Log para verificar cálculo
          console.log(`🔍 DEBUG ocupación ${assignment.vehicle.name}: ${numRutas} rutas, ${diasVehiculo} días, ocupación promedio/ruta=${ocupacionDiariaPorPeso.toFixed(1)}%, costo por viaje=${costPerTrip} COP, costo total=${costoTotalVehiculo.toFixed(2)} COP`);
          
          // Verificar que los valores estén definidos antes de guardar
          if (!costPerTrip || costPerTrip === 0) {
            console.error(`❌ ERROR: costPerTrip es 0 o undefined para ${assignment.vehicle.name}`);
          }
          if (!costoTotalVehiculo || costoTotalVehiculo === 0) {
            console.error(`❌ ERROR: costoTotalVehiculo es 0 o undefined para ${assignment.vehicle.name}`);
          }
          
          const vehicleData = {
            name: assignment.vehicle.name,
            capacity: assignment.vehicle.capacity,
            routes: assignment.routes.length,
            days: diasVehiculo,
            time: assignment.totalTime,
            weight: pesoTotalVehiculo,
            occupancy: ocupacionDiariaPorPeso,
            cost: costoTotalVehiculo,
            costPerTrip: costPerTrip
          };
          
          console.log(`💾 Guardando en vehicleTypeDetails[${tipo}]:`, JSON.stringify(vehicleData, null, 2));
          
          vehicleTypeDetails[tipo].vehicles.push(vehicleData);
        });
      } else {
        // Usar las rutas ya asignadas por el VRP
        console.log(`✅ Usando asignaciones del VRP: ${Object.keys(routesByVehicle).length} vehículos identificados`);
        
        Object.keys(routesByVehicle).forEach(vehicleId => {
          const assignment = routesByVehicle[vehicleId];
          const diasVehiculo = Math.ceil(assignment.totalTime / workingMinutesPerDay);
          
          // CORRECCIÓN: La ocupación diaria debe calcularse por PESO
          // Cada ruta es un viaje completo (salida bodega → recogidas → vuelta bodega)
          // La ocupación diaria es el promedio de ocupación de todas las rutas
          // porque cada ruta ya representa un viaje completo con su propia ocupación
          const numRutas = assignment.routes.length;
          const capacidadVehiculo = assignment.vehicleCapacity || 0;
          
          // Calcular ocupación por cada ruta (cada ruta es un viaje completo)
          const ocupacionesPorRuta = assignment.routes.map(route => {
            const pesoRuta = route.totalWeight || 0;
            return capacidadVehiculo > 0 
              ? Math.min((pesoRuta / capacidadVehiculo) * 100, 100) // Cada ruta no puede exceder 100%
              : 0;
          });
          
          // Ocupación diaria = promedio de ocupación de todas las rutas
          // Esto representa qué tan bien se está usando la capacidad del vehículo en promedio
          const ocupacionDiaria = ocupacionesPorRuta.length > 0
            ? ocupacionesPorRuta.reduce((sum, occ) => sum + occ, 0) / ocupacionesPorRuta.length
            : 0;
          
          // Obtener costo por viaje del vehículo: PRIORIDAD buscar en customVehicles
          let costPerTrip = 0;
          
          // PRIMERO: Buscar en customVehicles por nombre exacto (más confiable)
          if (customVehicles && customVehicles.length > 0) {
            console.log(`🔍 DEBUG: Buscando costPerTrip en customVehicles para vehículo: "${vehicleId}" (tipo: ${assignment.vehicleType})`);
            console.log(`   customVehicles disponibles:`, customVehicles.map(v => ({ name: v.name, type: v.type, costPerTrip: v.costPerTrip })));
            
            // Buscar por nombre exacto primero
            let vehicleConfig = customVehicles.find(v => v.name === vehicleId);
            
            // Si no se encuentra, buscar por nombre sin mayúsculas
            if (!vehicleConfig) {
              vehicleConfig = customVehicles.find(v => 
                v.name && vehicleId && v.name.toLowerCase() === vehicleId.toLowerCase()
              );
            }
            
            // Si no se encuentra, buscar por tipo y capacidad más cercana
            if (!vehicleConfig && assignment.vehicleType) {
              const vehiclesOfType = customVehicles.filter(v => v.type === assignment.vehicleType);
              if (vehiclesOfType.length > 0) {
                if (assignment.vehicleCapacity) {
                  vehicleConfig = vehiclesOfType.reduce((closest, current) => {
                    const currentDiff = Math.abs(current.capacity - assignment.vehicleCapacity);
                    const closestDiff = Math.abs(closest.capacity - assignment.vehicleCapacity);
                    return currentDiff < closestDiff ? current : closest;
                  });
                } else {
                  vehicleConfig = vehiclesOfType[0];
                }
              }
            }
            
            if (vehicleConfig && vehicleConfig.costPerTrip) {
              costPerTrip = vehicleConfig.costPerTrip;
              console.log(`✅ DEBUG: Encontrado costPerTrip en customVehicles: ${vehicleConfig.name} -> ${costPerTrip} COP`);
            } else {
              console.log(`⚠️ DEBUG: No se encontró costPerTrip en customVehicles para "${vehicleId}"`);
            }
          }
          
          // SEGUNDO: Si no se encontró en customVehicles, usar el valor del assignment
          if (!costPerTrip) {
            costPerTrip = assignment.vehicleCostPerTrip || 0;
            if (costPerTrip) {
              console.log(`🔍 DEBUG: Obteniendo costPerTrip del assignment: ${costPerTrip}`);
            }
          }
          
          // Calcular costo total del vehículo: costo por viaje (COP) * número de rutas (cada ruta es un viaje completo)
          // numRutas ya está declarado arriba
          const costoTotalVehiculo = costPerTrip * numRutas; // Costo total en COP
          
          console.log(`💰 DEBUG costo final ${vehicleId}: costPerTrip=${costPerTrip} COP, rutas=${numRutas}, costoTotal=${costoTotalVehiculo} COP`);
          
          // Debug: Log para verificar cálculo
          console.log(`🔍 DEBUG ocupación ${vehicleId}: ${numRutas} rutas, ${diasVehiculo} días, ocupación promedio/ruta=${ocupacionDiaria.toFixed(1)}%, costo por viaje=${costPerTrip} COP, costo total=${costoTotalVehiculo.toFixed(2)} COP`);
          
          // Verificar que los valores estén definidos antes de guardar
          if (!costPerTrip || costPerTrip === 0) {
            console.error(`❌ ERROR: costPerTrip es 0 o undefined para ${vehicleId}`);
          }
          if (!costoTotalVehiculo || costoTotalVehiculo === 0) {
            console.error(`❌ ERROR: costoTotalVehiculo es 0 o undefined para ${vehicleId}`);
          }
          
          maxDaysNeeded = Math.max(maxDaysNeeded, diasVehiculo);
          
          const tipo = assignment.vehicleType;
          if (!vehicleTypeDetails[tipo]) {
            vehicleTypeDetails[tipo] = {
              cantidadVehiculos: 0,
              totalRutas: 0,
              diasMaximos: 0,
              diasPromedioPorVehiculo: 0,
              ocupacionPromedioDiaria: 0,
              tiempoTotal: 0,
              tiempoPromedioPorVehiculo: 0,
              pesoTotal: 0,
              vehicles: []
            };
          }
          
          vehicleTypeDetails[tipo].cantidadVehiculos++;
          vehicleTypeDetails[tipo].totalRutas += assignment.routes.length;
          vehicleTypeDetails[tipo].diasMaximos = Math.max(vehicleTypeDetails[tipo].diasMaximos, diasVehiculo);
          vehicleTypeDetails[tipo].tiempoTotal += assignment.totalTime;
          vehicleTypeDetails[tipo].pesoTotal += assignment.totalWeight;
          
          const vehicleData = {
            name: vehicleId,
            capacity: assignment.vehicleCapacity || 'N/A',
            routes: assignment.routes.length,
            days: diasVehiculo,
            time: assignment.totalTime,
            weight: assignment.totalWeight,
            occupancy: ocupacionDiaria,
            cost: costoTotalVehiculo,
            costPerTrip: costPerTrip
          };
          
          console.log(`💾 Guardando en vehicleTypeDetails[${tipo}]:`, JSON.stringify(vehicleData, null, 2));
          
          vehicleTypeDetails[tipo].vehicles.push(vehicleData);
          
          console.log(`🚛 ${vehicleId} (${assignment.vehicleCapacity || 'N/A'}kg): ${assignment.routes.length} ruta(s), ${assignment.totalWeight.toFixed(1)}kg, ${diasVehiculo} día(s), ${ocupacionDiaria.toFixed(1)}% ocupación diaria (por peso)`);
        });
      }
      
      // Calcular promedios por tipo
      Object.keys(vehicleTypeDetails).forEach(tipo => {
        const details = vehicleTypeDetails[tipo];
        details.tiempoPromedioPorVehiculo = details.tiempoTotal / details.cantidadVehiculos;
        details.diasPromedioPorVehiculo = details.tiempoPromedioPorVehiculo / workingMinutesPerDay;
        
        // CORRECCIÓN: La ocupación promedio diaria debe calcularse por PESO, no por tiempo
        // Para cada vehículo: ocupación diaria = (Peso total / días trabajados) / Capacidad del vehículo * 100
        // Luego promediar todas las ocupaciones diarias
        if (details.vehicles && details.vehicles.length > 0) {
          const ocupacionesDiarias = details.vehicles.map(v => {
            // Para cada vehículo, calcular su ocupación diaria promedio por PESO
            // Peso por día = peso total / días trabajados
            // Ocupación diaria = (peso por día / capacidad) * 100
            // La ocupación ya viene calculada correctamente desde el código anterior
            // (ocupación promedio por ruta × rutas por día, limitada a 100%)
            return v.occupancy || 0;
          });
          
          // Promedio de todas las ocupaciones diarias
          details.ocupacionPromedioDiaria = ocupacionesDiarias.length > 0
            ? ocupacionesDiarias.reduce((sum, occ) => sum + occ, 0) / ocupacionesDiarias.length
            : 0;
        } else {
          // Fallback: calcular basado en peso promedio por vehículo
          // Peso promedio por vehículo / días promedio = peso promedio por día
          // Ocupación = (peso promedio por día / capacidad promedio) * 100
          const pesoPromedioPorVehiculo = details.pesoTotal / details.cantidadVehiculos;
          const pesoPromedioPorDia = details.diasPromedioPorVehiculo > 0 
            ? pesoPromedioPorVehiculo / details.diasPromedioPorVehiculo 
            : 0;
          // Necesitamos la capacidad promedio del tipo de vehículo
          const capacidadPromedio = details.vehicles && details.vehicles.length > 0
            ? details.vehicles.reduce((sum, v) => {
                const cap = v.capacity && v.capacity !== 'N/A' ? parseFloat(v.capacity) : 0;
                return sum + cap;
              }, 0) / details.vehicles.length
            : 0;
          details.ocupacionPromedioDiaria = capacidadPromedio > 0 
            ? (pesoPromedioPorDia / capacidadPromedio) * 100
            : 0;
        }
        
        // NO limitar a 100% - si un vehículo hace múltiples viajes por día, puede exceder 100%
        // Esto indica que el vehículo está trabajando a máxima capacidad o más
        
        console.log(`📊 Tipo ${tipo}: ${details.cantidadVehiculos} vehículo(s), ${details.totalRutas} ruta(s), ${details.diasMaximos} día(s) máximo, ${details.ocupacionPromedioDiaria.toFixed(1)}% ocupación promedio diaria`);
      });
      
      // Si no hay rutas agrupadas por tipo, usar cálculo simple
      const diasTrabajo = maxDaysNeeded > 0 ? maxDaysNeeded : Math.ceil((result.totalTime || result.analysis.totalTime || 0) / workingMinutesPerDay);
      
      console.log(`📅 Días de trabajo calculados: ${diasTrabajo} (considerando ${JSON.stringify(vehiculosDisponibles)} vehículos en paralelo)`);
      
      const utilizacionPromedio = result.routes.length > 0 
        ? result.routes.reduce((sum, route) => sum + route.utilization, 0) / result.routes.length 
        : 0;
      
      // Determinar valores para guardar según el tipo de algoritmo
      let tipoVehiculo, capacidadKg, capacidadM3;
      
      if (useHybrid) {
        tipoVehiculo = 'hibrido';
        capacidadKg = 0; // Capacidad combinada
        capacidadM3 = 0; // Capacidad combinada
      } else if (useCustomVehicles) {
        tipoVehiculo = 'personalizado';
        capacidadKg = 0; // Capacidad variable según vehículos personalizados
        capacidadM3 = 0; // Capacidad variable según vehículos personalizados
      } else {
        tipoVehiculo = selectedVehicleType;
        // Usar configuraciones dinámicas si están disponibles
        if (vehicleConfigs && vehicleConfigs[selectedVehicleType]) {
          capacidadKg = vehicleConfigs[selectedVehicleType].capacityKg;
          capacidadM3 = vehicleConfigs[selectedVehicleType].capacityM3;
        } else {
          // Solo usar valores por defecto como último recurso
        capacidadKg = VEHICLE_TYPES[selectedVehicleType].capacityKg;
        capacidadM3 = VEHICLE_TYPES[selectedVehicleType].capacityM3;
        }
      }
      
      stmt.run(
        currentSubidaId,
        tipoVehiculo,
        capacidadKg,
        capacidadM3,
        result.routes.length,
        result.analysis.feasibleRoutes || result.feasibleRoutes || result.routes.length,
        pesoTotal,
        result.totalDistance || result.analysis.totalDistance || 0,
        result.totalTime || result.analysis.totalTime || 0,
        result.totalCost || result.analysis.totalCost || 0,
        diasTrabajo,
        utilizacionPromedio,
        JSON.stringify(result.routes),
        JSON.stringify(vehiculosDisponibles)
      );
      
      console.log(`✅ Usando subidaId: ${currentSubidaId}`);
      console.log(`💾 Rutas guardadas en historial: ID ${stmt.lastID} para subida ${currentSubidaId}`);
      
      // Calcular utilización por tipo de vehículo
      const vehicleUtilization = {};
      console.log('🔍 DEBUG - useHybrid:', useHybrid);
      console.log('🔍 DEBUG - useCustomVehicles:', useCustomVehicles);
      console.log('🔍 DEBUG - result.vehicleBreakdown:', result.vehicleBreakdown);
      
      if (useHybrid && result.vehicleBreakdown) {
        // Usar configuraciones dinámicas si están disponibles
        const camionCapacity = (vehicleConfigs && vehicleConfigs.camion) ? vehicleConfigs.camion.capacityKg : VEHICLE_TYPES.camion.capacityKg;
        const motoCapacity = (vehicleConfigs && vehicleConfigs.moto) ? vehicleConfigs.moto.capacityKg : VEHICLE_TYPES.moto.capacityKg;
        
        vehicleUtilization.camion = {
          routes: result.vehicleBreakdown.camion.routes,
          weight: result.vehicleBreakdown.camion.weight,
          utilization: result.vehicleBreakdown.camion.weight > 0 ? 
            (result.vehicleBreakdown.camion.weight / (camionCapacity * result.vehicleBreakdown.camion.routes)) * 100 : 0,
          locations: result.vehicleBreakdown.camion.locations
        };
        vehicleUtilization.moto = {
          routes: result.vehicleBreakdown.moto.routes,
          weight: result.vehicleBreakdown.moto.weight,
          utilization: result.vehicleBreakdown.moto.weight > 0 ? 
            (result.vehicleBreakdown.moto.weight / (motoCapacity * result.vehicleBreakdown.moto.routes)) * 100 : 0,
          locations: result.vehicleBreakdown.moto.locations
        };
      } else if (useCustomVehicles && result.analysis && result.analysis.vehicleBreakdown) {
        console.log('🔍 DEBUG - Condición vehículos personalizados cumplida');
        console.log('🔍 DEBUG - Condición vehículos personalizados cumplida');
        console.log('🔍 DEBUG - Condición vehículos personalizados cumplida');
        console.log('🔍 DEBUG - Condición vehículos personalizados cumplida');
        console.log('🔍 DEBUG - Entrando en sección vehículos personalizados');
        console.log('🔍 DEBUG - result.analysis.vehicleBreakdown:', result.analysis.vehicleBreakdown);
        // Para vehículos personalizados, usar las capacidades de los vehículos personalizados
        for (const vehicleType in result.analysis.vehicleBreakdown) {
          const vehicle = customVehicles.find(v => v.type === vehicleType);
          if (vehicle) {
            vehicleUtilization[vehicleType] = {
              routes: result.analysis.vehicleBreakdown[vehicleType].count || 0,
              weight: result.analysis.vehicleBreakdown[vehicleType].totalWeight || 0,
              utilization: result.analysis.vehicleBreakdown[vehicleType].averageUtilization || 0,
              locations: result.analysis.vehicleBreakdown[vehicleType].count || 0 // Aproximación
            };
          }
        }
      } else if (!useCustomVehicles) {
        // Para algoritmos no híbridos y no personalizados, calcular utilización general
        // Usar configuraciones dinámicas si están disponibles
        const camionCapacity = (vehicleConfigs && vehicleConfigs.camion) ? vehicleConfigs.camion.capacityKg : VEHICLE_TYPES.camion.capacityKg;
        const motoCapacity = (vehicleConfigs && vehicleConfigs.moto) ? vehicleConfigs.moto.capacityKg : VEHICLE_TYPES.moto.capacityKg;
        
        const camionRoutes = result.routes.filter(route => route.vehicleType === 'camion');
        const motoRoutes = result.routes.filter(route => route.vehicleType === 'moto');
        
        if (camionRoutes.length > 0) {
          const camionWeight = camionRoutes.reduce((sum, route) => sum + route.totalWeight, 0);
          vehicleUtilization.camion = {
            routes: camionRoutes.length,
            weight: camionWeight,
            utilization: (camionWeight / (camionCapacity * camionRoutes.length)) * 100,
            locations: camionRoutes.reduce((sum, route) => sum + (route.locations ? route.locations.length - 2 : 0), 0) // excluyendo depósitos
          };
        }
        
        if (motoRoutes.length > 0) {
          const motoWeight = motoRoutes.reduce((sum, route) => sum + route.totalWeight, 0);
          vehicleUtilization.moto = {
            routes: motoRoutes.length,
            weight: motoWeight,
            utilization: (motoWeight / (motoCapacity * motoRoutes.length)) * 100,
            locations: motoRoutes.reduce((sum, route) => sum + (route.locations ? route.locations.length - 2 : 0), 0) // excluyendo depósitos
          };
        }
      }
      
      // Preparar respuesta con análisis detallado
      // Usar configuraciones dinámicas si están disponibles
      let vehicleConfigForResponse = null;
      if (useCustomVehicles && customVehicles && customVehicles.length > 0) {
        // Para vehículos personalizados, crear un objeto de configuración basado en los vehículos personalizados
        vehicleConfigForResponse = {
          name: 'Vehículos Personalizados',
          description: `${customVehicles.length} vehículo(s) personalizado(s)`,
          customVehicles: customVehicles.map(v => ({
            name: v.name,
            type: v.type,
            capacity: v.capacity,
            costPerTrip: v.costPerTrip
          }))
        };
      } else if (vehicleConfigs && vehicleConfigs[selectedVehicleType]) {
        vehicleConfigForResponse = vehicleConfigs[selectedVehicleType];
      } else if (useHybrid && vehicleConfigs) {
        vehicleConfigForResponse = { name: 'Híbrido', description: 'Configuración híbrida dinámica' };
      } else {
        vehicleConfigForResponse = VEHICLE_TYPES[vehicleType] || VEHICLE_TYPES.camion;
      }
      
      // pesoTotalRutas ya fue calculado anteriormente (línea 2402)
      // No redeclarar, solo usar la variable existente
      
      // IMPORTANTE: El peso total debe ser el del historial (todos los registros procesados)
      // Si hay diferencia, significa que algunas ubicaciones no se asignaron a rutas
      // Pero el peso total mostrado debe ser el del historial para reflejar la realidad
      // El peso por vehículo se calcula de las rutas asignadas, que puede ser menor si faltan ubicaciones
      const pesoTotalParaMostrar = finalPesoTotal; // Usar siempre el peso del historial
      
      // Debug: Verificar que vehicleTypeDetails tenga los valores de cost
      console.log(`🔍 DEBUG antes de enviar respuesta - vehicleTypeDetails:`);
      Object.keys(vehicleTypeDetails).forEach(tipo => {
        const details = vehicleTypeDetails[tipo];
        console.log(`   Tipo ${tipo}:`);
        if (details.vehicles && details.vehicles.length > 0) {
          details.vehicles.forEach((v, idx) => {
            console.log(`      Vehículo ${idx + 1} (${v.name}): cost=${v.cost}, costPerTrip=${v.costPerTrip}, days=${v.days}`);
          });
        } else {
          console.log(`      Sin vehículos individuales`);
        }
      });
      
      const analysis = {
        vehicleType: vehicleType,
        vehicleConfig: vehicleConfigForResponse,
        totalVehicles: result.routes.length,
        totalWorkingDays: diasTrabajo,
        averageUtilization: utilizacionPromedio,
        feasibleRoutes: result.feasibleRoutes || result.routes.length,
        totalCost: result.totalCost || result.analysis?.totalCost || 0,
        costPerTon: pesoTotalParaMostrar > 0 ? (result.totalCost || result.analysis?.totalCost || 0) / (pesoTotalParaMostrar / 1000) : 0,
        totalDistance: result.totalDistance || result.analysis?.totalDistance || 0,
        totalTime: result.totalTime || result.analysis?.totalTime || 0,
        pesoTotal: pesoTotalParaMostrar,
        totalWeight: pesoTotalParaMostrar,
        pesoTotalHistorial: finalPesoTotal, // Guardar el peso del historial para referencia
        pesoTotalRutas: pesoTotalRutas, // Guardar el peso de las rutas para referencia
        vehicleUtilization: vehicleUtilization,
        vehiculosDisponibles: vehiculosDisponibles,
        vehicleTypeDetails: vehicleTypeDetails,
        workingHours: VRP_CONFIG.workingHours
      };
      
      // Debug: Verificar que analysis tenga vehicleTypeDetails con cost
      console.log(`🔍 DEBUG antes de enviar - analysis.vehicleTypeDetails:`);
      if (analysis.vehicleTypeDetails) {
        Object.keys(analysis.vehicleTypeDetails).forEach(tipo => {
          const details = analysis.vehicleTypeDetails[tipo];
          if (details.vehicles && details.vehicles.length > 0) {
            details.vehicles.forEach((v, idx) => {
              console.log(`   ${tipo}[${idx}] (${v.name}): cost=${v.cost}, costPerTrip=${v.costPerTrip}, routes=${v.routes}, days=${v.days}`);
              console.log(`      Cálculo esperado: costPerTrip(${v.costPerTrip}) * routes(${v.routes}) = ${(v.costPerTrip || 0) * (v.routes || 0)}`);
              console.log(`      Cost actual: ${v.cost}`);
            });
          } else {
            console.log(`   ${tipo}: Sin vehículos individuales`);
          }
        });
      } else {
        console.log(`⚠️ DEBUG: analysis.vehicleTypeDetails es null o undefined`);
      }
      
      // Debug: Serializar y verificar que los valores estén en el JSON
      const jsonString = JSON.stringify(analysis);
      const vehicleTypeDetailsMatch = jsonString.match(/"vehicleTypeDetails":\{[^}]*\}/);
      if (vehicleTypeDetailsMatch) {
        console.log(`🔍 DEBUG: vehicleTypeDetails encontrado en JSON (primeros 500 caracteres):`, vehicleTypeDetailsMatch[0].substring(0, 500));
      }
      
      // Verificar específicamente los valores de cost y costPerTrip
      const costMatches = jsonString.match(/"cost":\d+/g);
      const costPerTripMatches = jsonString.match(/"costPerTrip":\d+/g);
      console.log(`🔍 DEBUG: Encontrados ${costMatches ? costMatches.length : 0} valores de "cost" en JSON`);
      console.log(`🔍 DEBUG: Encontrados ${costPerTripMatches ? costPerTripMatches.length : 0} valores de "costPerTrip" en JSON`);
      if (costMatches && costMatches.length > 0) {
        console.log(`   Ejemplos de cost:`, costMatches.slice(0, 3));
      }
      if (costPerTripMatches && costPerTripMatches.length > 0) {
        console.log(`   Ejemplos de costPerTrip:`, costPerTripMatches.slice(0, 3));
      }
      
      res.json({
        success: true,
        routes: result.routes,
        analysis: analysis,
        subidaId: currentSubidaId
      });
      
    } catch (error) {
      console.error('Error en cálculo VRP:', error);
      res.status(500).json({ error: 'Error calculando rutas VRP: ' + error.message });
    }
  });
});

// Función auxiliar para calcular distancia Manhattan
function calculateDistance(lat1, lon1, lat2, lon2) {
  // Distancia Manhattan: |lat1-lat2| + |lon1-lon2|
  // Convertir grados a km aproximadamente (1 grado ≈ 111 km)
  const latDiff = Math.abs(lat2 - lat1) * 111;
  const lonDiff = Math.abs(lon2 - lon1) * 111 * Math.cos(lat1 * Math.PI / 180);
  return latDiff + lonDiff;
}

// Obtener historial de subidas
app.get('/api/historial', (req, res) => {
  db.all(`
    SELECT 
      h.*,
      COUNT(r.id) as registros_totales,
      SUM(r.peso_kg) as peso_total_kg,
      COUNT(DISTINCT r.direccion) as ubicaciones_unicas,
      COUNT(rc.id) as rutas_calculadas_count
    FROM historial_subidas h
    LEFT JOIN residuos r ON h.id = r.subida_id
    LEFT JOIN rutas_calculadas rc ON h.id = rc.subida_id
    GROUP BY h.id
    ORDER BY h.fecha_subida DESC
  `, (err, rows) => {
    if (err) {
      console.error('Error obteniendo historial:', err);
      return res.status(500).json({ error: 'Error obteniendo historial' });
    }
    res.json(rows);
  });
});

// Obtener historial de rutas calculadas
app.get('/api/historial-rutas', (req, res) => {
  db.all(`
    SELECT 
      rc.*,
      h.nombre_archivo,
      h.fecha_subida
    FROM rutas_calculadas rc
    JOIN historial_subidas h ON rc.subida_id = h.id
    ORDER BY rc.fecha_calculo DESC
  `, (err, rows) => {
    if (err) {
      console.error('Error obteniendo historial de rutas:', err);
      return res.status(500).json({ error: 'Error obteniendo historial de rutas' });
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

// Obtener porcentajes de tipos de residuo para una subida
app.get('/api/residue-percentages/:subidaId', (req, res) => {
  const subidaId = req.params.subidaId;
  
  const query = `
    SELECT 
      nombre_residuo,
      SUM(peso_kg) as peso_total
    FROM residuos
    WHERE subida_id = ? AND nombre_residuo IS NOT NULL AND nombre_residuo != ''
    GROUP BY nombre_residuo
  `;
  
  db.all(query, [subidaId], (err, rows) => {
    if (err) {
      console.error('Error obteniendo porcentajes de residuos:', err);
      return res.status(500).json({ error: 'Error obteniendo porcentajes' });
    }
    
    if (rows.length === 0) {
      return res.json({ percentages: {} });
    }
    
    const totalWeight = rows.reduce((sum, row) => sum + (row.peso_total || 0), 0);
    const percentages = {};
    
    rows.forEach(row => {
      if (row.nombre_residuo && totalWeight > 0) {
        percentages[row.nombre_residuo] = (row.peso_total / totalWeight) * 100;
      }
    });
    
    res.json({ percentages });
  });
});

// Descargar plan de rutas por día
// Obtener plan de rutas por día en formato JSON (para vista previa)
app.get('/api/route-plan-preview/:subidaId', (req, res) => {
  const subidaId = req.params.subidaId;
  
  // Obtener las rutas calculadas para esta subida
  db.get(`
    SELECT rutas_json, fecha_calculo, tipo_vehiculo, vehiculos_disponibles
    FROM rutas_calculadas
    WHERE subida_id = ?
    ORDER BY fecha_calculo DESC
    LIMIT 1
  `, [subidaId], (err, row) => {
    if (err) {
      console.error('Error obteniendo rutas:', err);
      return res.status(500).json({ error: 'Error obteniendo rutas' });
    }
    
    if (!row || !row.rutas_json) {
      return res.status(404).json({ error: 'No se encontraron rutas calculadas para esta subida' });
    }
    
    try {
      const routes = JSON.parse(row.rutas_json);
      
      // Obtener información de los residuos de la subida
      db.all(`
        SELECT direccion, ciudad, nombre_residuo, peso_kg, latitud, longitud
        FROM residuos
        WHERE subida_id = ?
      `, [subidaId], (err, residues) => {
        if (err) {
          console.error('Error obteniendo residuos:', err);
          return res.status(500).json({ error: 'Error obteniendo residuos' });
        }
        
        // Crear mapa de direcciones a información de residuos
        const residueMap = {};
        residues.forEach(residue => {
          const key = `${residue.direccion}|${residue.ciudad}`;
          if (!residueMap[key]) {
            residueMap[key] = {
              direccion: residue.direccion,
              ciudad: residue.ciudad,
              lat: residue.latitud,
              lon: residue.longitud,
              residuos: []
            };
          }
          residueMap[key].residuos.push({
            nombre: residue.nombre_residuo,
            peso: residue.peso_kg
          });
        });
        
        // Construir estructura de rutas con información de residuos
        const routesWithDetails = routes.map((route, index) => {
          const locations = route.locations || route.stops || [];
          const ordenRecogidas = [];
          
          console.log(`🔍 Ruta ${index + 1}: ${locations.length} ubicaciones, totalWeight: ${route.totalWeight}`);
          
          locations.forEach((location, locIndex) => {
            if (locIndex === 0 || locIndex === locations.length - 1) {
              // Es el depósito, saltar
              return;
            }
            
            // Usar peso directamente de location si está disponible
            let pesoTotal = location.peso || 0;
            
            // Si no hay peso en location, intentar obtenerlo del mapa de residuos
            if (pesoTotal === 0) {
              const direccion = location.direccion || location.address || '';
              const ciudad = location.ciudad || location.city || 'BOGOTA, D. C.';
              const key = `${direccion}|${ciudad}`;
              const residueInfo = residueMap[key];
              
              if (residueInfo) {
                pesoTotal = residueInfo.residuos.reduce((sum, r) => sum + (r.peso || 0), 0);
              } else {
                // Si no se encuentra en el mapa, buscar directamente en la base de datos
                // Buscar por dirección exacta
                const matchingResidues = residues.filter(r => 
                  (r.direccion === direccion || r.direccion === direccion.trim()) && 
                  (r.ciudad === ciudad || r.ciudad === ciudad.trim())
                );
                if (matchingResidues.length > 0) {
                  pesoTotal = matchingResidues.reduce((sum, r) => sum + (r.peso_kg || 0), 0);
                  console.log(`✅ Peso encontrado en BD para ${direccion}: ${pesoTotal}kg`);
                } else {
                  console.log(`⚠️ No se encontró peso para ${direccion} (${ciudad})`);
                }
              }
            }
            
            // Agregar recogida incluso si no se encontró en el mapa (usar datos de location)
            ordenRecogidas.push({
              orden: locIndex,
              direccion: location.direccion || location.address || 'N/A',
              ciudad: location.ciudad || location.city || 'BOGOTA, D. C.',
              pesoTotal: pesoTotal,
              residuos: (residueMap[`${location.direccion || location.address}|${location.ciudad || location.city || 'BOGOTA, D. C.'}`] || {}).residuos || []
            });
          });
          
          // Si ninguna ubicación tiene peso pero la ruta tiene totalWeight, distribuir el peso
          const totalPesoRuta = ordenRecogidas.reduce((sum, p) => sum + p.pesoTotal, 0);
          if (totalPesoRuta === 0 && route.totalWeight > 0 && ordenRecogidas.length > 0) {
            const pesoPorUbicacion = route.totalWeight / ordenRecogidas.length;
            console.log(`⚠️ Ruta ${index + 1}: Distribuyendo peso ${route.totalWeight}kg entre ${ordenRecogidas.length} ubicaciones (${pesoPorUbicacion.toFixed(2)}kg cada una)`);
            ordenRecogidas.forEach(pickup => {
              pickup.pesoTotal = pesoPorUbicacion;
            });
          } else if (totalPesoRuta === 0 && route.totalWeight === 0 && ordenRecogidas.length > 0) {
            // Si ni la ruta ni las ubicaciones tienen peso, intentar obtener de la BD por ubicación
            console.log(`⚠️ Ruta ${index + 1}: Sin peso en ruta ni ubicaciones, buscando en BD...`);
            ordenRecogidas.forEach(pickup => {
              const matchingResidues = residues.filter(r => 
                (r.direccion === pickup.direccion || r.direccion === pickup.direccion.trim()) && 
                (r.ciudad === pickup.ciudad || r.ciudad === pickup.ciudad.trim())
              );
              if (matchingResidues.length > 0) {
                pickup.pesoTotal = matchingResidues.reduce((sum, r) => sum + (r.peso_kg || 0), 0);
                console.log(`   ✅ ${pickup.direccion}: ${pickup.pesoTotal}kg`);
              }
            });
          }
          
          return {
            rutaNumero: index + 1,
            tipoVehiculo: route.vehicleType || route.tipoVehiculo || 'Desconocido',
            distanciaKm: route.distance || route.totalDistance || 0,
            tiempoMinutos: route.time || route.totalTime || 0,
            ordenRecogidas: ordenRecogidas,
            totalWeight: route.totalWeight || 0
          };
        });
        
        // Obtener información de vehículos disponibles
        let vehiculosDisponibles = {};
        if (row.vehiculos_disponibles) {
          try {
            vehiculosDisponibles = JSON.parse(row.vehiculos_disponibles);
          } catch (e) {
            console.warn('⚠️ Error parseando vehiculos_disponibles, usando valores por defecto');
            vehiculosDisponibles = {};
          }
        }
        // Si no hay información de vehículos, asumir 1 de cada tipo
        if (Object.keys(vehiculosDisponibles).length === 0) {
          routes.forEach(route => {
            const tipo = route.vehicleType || route.vehicleName || row.tipo_vehiculo || 'desconocido';
            if (!vehiculosDisponibles[tipo]) {
              vehiculosDisponibles[tipo] = 1;
            }
          });
        }
        console.log(`🚛 Vehículos disponibles para agrupación (vista previa):`, vehiculosDisponibles);
        
        // Configuración de trabajo
        const VRP_CONFIG = {
          workingHours: 9,
          workingMinutes: 9 * 60
        };
        
        const workingMinutesPerDay = VRP_CONFIG.workingMinutes;
        
        // Agrupar rutas por día considerando cantidad de vehículos disponibles por tipo
        // Agrupar rutas por tipo de vehículo
        const routesByVehicleType = {};
        routesWithDetails.forEach(route => {
          const tipo = route.tipoVehiculo || 'desconocido';
          if (!routesByVehicleType[tipo]) {
            routesByVehicleType[tipo] = [];
          }
          routesByVehicleType[tipo].push({
            ...route,
            tiempoMinutosNum: route.tiempoMinutos || 0
          });
        });
        
        // Distribuir rutas por día considerando vehículos disponibles
        const routesByDay = [];
        let currentDay = 1;
        
        // Para cada tipo de vehículo, distribuir sus rutas
        Object.keys(routesByVehicleType).forEach(tipoVehiculo => {
          const rutasTipo = routesByVehicleType[tipoVehiculo];
          const cantidadVehiculos = vehiculosDisponibles[tipoVehiculo] || 1;
          
          // Ordenar rutas por tiempo (de mayor a menor)
          rutasTipo.sort((a, b) => b.tiempoMinutosNum - a.tiempoMinutosNum);
          
          // Distribuir rutas en "slots" de vehículos trabajando en paralelo
          let routeIndex = 0;
          while (routeIndex < rutasTipo.length) {
            // Obtener o crear el día actual
            let dayData = routesByDay.find(d => d.dia === currentDay);
            if (!dayData) {
              dayData = {
              dia: currentDay,
                rutas: [],
                tiempoMaximo: 0
              };
              routesByDay.push(dayData);
            }
            
            // Contar cuántas rutas de este tipo ya hay en el día
            const rutasTipoEnDia = dayData.rutas.filter(r => r.tipoVehiculo === tipoVehiculo).length;
            
            // Si aún hay espacio para más vehículos de este tipo en este día
            if (rutasTipoEnDia < cantidadVehiculos) {
              // Agregar rutas hasta llenar los vehículos disponibles o hasta que se acaben
              const rutasParaAgregar = Math.min(
                cantidadVehiculos - rutasTipoEnDia,
                rutasTipo.length - routeIndex
              );
              
              for (let i = 0; i < rutasParaAgregar && routeIndex < rutasTipo.length; i++) {
                const route = rutasTipo[routeIndex];
                dayData.rutas.push(route);
                dayData.tiempoMaximo = Math.max(dayData.tiempoMaximo, route.tiempoMinutosNum);
                routeIndex++;
              }
            } else {
              // No hay más espacio para este tipo en este día, pasar al siguiente día
            currentDay++;
            }
            
            // Si el tiempo máximo del día excede el límite, pasar al siguiente día
            if (dayData.tiempoMaximo > workingMinutesPerDay) {
              currentDay++;
            }
          }
        });
        
        // Renumerar días y calcular tiempo total
        routesByDay.sort((a, b) => a.dia - b.dia);
        routesByDay.forEach((dayData, index) => {
          dayData.dia = index + 1;
          dayData.tiempoTotal = dayData.tiempoMaximo;
        });
        
        // Construir respuesta simplificada (solo día, recogida, dirección, peso)
        const previewData = [];
        routesByDay.forEach(dayData => {
          let recogidaCounter = 1;
          dayData.rutas.forEach(route => {
            route.ordenRecogidas.forEach((pickup) => {
              previewData.push({
                dia: dayData.dia,
                recogida: recogidaCounter++,
                direccion: pickup.direccion,
                peso: pickup.pesoTotal
              });
            });
          });
        });
        
        res.json({ preview: previewData });
      });
    } catch (error) {
      console.error('Error procesando rutas:', error);
      res.status(500).json({ error: 'Error procesando rutas' });
    }
  });
});

app.get('/api/download-route-plan/:subidaId', (req, res) => {
  const subidaId = req.params.subidaId;
  
  // Obtener las rutas calculadas para esta subida
  db.get(`
    SELECT rutas_json, fecha_calculo, tipo_vehiculo, vehiculos_disponibles
    FROM rutas_calculadas
    WHERE subida_id = ?
    ORDER BY fecha_calculo DESC
    LIMIT 1
  `, [subidaId], (err, row) => {
    if (err) {
      console.error('Error obteniendo rutas:', err);
      return res.status(500).json({ error: 'Error obteniendo rutas' });
    }
    
    if (!row || !row.rutas_json) {
      return res.status(404).json({ error: 'No se encontraron rutas calculadas para esta subida' });
    }
    
    try {
      const routes = JSON.parse(row.rutas_json);
      
      // Obtener información de vehículos disponibles
      let vehiculosDisponibles = {};
      if (row.vehiculos_disponibles) {
        try {
          vehiculosDisponibles = JSON.parse(row.vehiculos_disponibles);
        } catch (e) {
          console.warn('⚠️ Error parseando vehiculos_disponibles, usando valores por defecto');
          vehiculosDisponibles = {};
        }
      }
      // Si no hay información de vehículos, asumir 1 de cada tipo
      if (Object.keys(vehiculosDisponibles).length === 0) {
        routes.forEach(route => {
          const tipo = route.vehicleType || route.vehicleName || row.tipo_vehiculo || 'desconocido';
          if (!vehiculosDisponibles[tipo]) {
            vehiculosDisponibles[tipo] = 1;
          }
        });
      }
      console.log(`🚛 Vehículos disponibles para agrupación (descarga):`, vehiculosDisponibles);
      
      // Obtener información de los residuos de la subida
      db.all(`
        SELECT direccion, ciudad, nombre_residuo, peso_kg, latitud, longitud
        FROM residuos
        WHERE subida_id = ?
      `, [subidaId], (err, residues) => {
        if (err) {
          console.error('Error obteniendo residuos:', err);
          return res.status(500).json({ error: 'Error obteniendo residuos' });
        }
        
        // Crear mapa de direcciones a información de residuos
        const residueMap = {};
        residues.forEach(residue => {
          const key = `${residue.direccion}|${residue.ciudad}`;
          if (!residueMap[key]) {
            residueMap[key] = {
              direccion: residue.direccion,
              ciudad: residue.ciudad,
              lat: residue.latitud,
              lon: residue.longitud,
              residuos: []
            };
          }
          residueMap[key].residuos.push({
            nombre: residue.nombre_residuo,
            peso: residue.peso_kg
          });
        });
        
        // Agrupar rutas por día considerando cantidad de vehículos disponibles
        const workingHoursPerDay = VRP_CONFIG.workingHours; // 9 horas
        const workingMinutesPerDay = workingHoursPerDay * 60;
        
        // Primero, preparar todas las rutas con su información completa
        const preparedRoutes = routes.map((route, routeIndex) => {
          const locations = route.locations || route.stops || [];
          const pickupOrder = [];
          
          locations.forEach((location, locIndex) => {
            if (location.peso && location.peso > 0) { // Excluir depósito
              const key = `${location.direccion}|${location.ciudad}`;
              const residueInfo = residueMap[key];
              
              pickupOrder.push({
                orden: pickupOrder.length + 1,
                direccion: location.direccion,
                ciudad: location.ciudad || '',
                latitud: location.lat || location.latitud || '',
                longitud: location.lon || location.longitud || '',
                pesoTotal: location.peso,
                residuos: residueInfo ? residueInfo.residuos : []
              });
            }
          });
          
          return {
            rutaNumero: routeIndex + 1,
            tipoVehiculo: route.vehicleType || route.vehicleName || row.tipo_vehiculo,
            distanciaKm: (route.totalDistance || 0).toFixed(2),
            tiempoMinutos: (route.totalTime || 0).toFixed(1),
            tiempoMinutosNum: route.totalTime || 0,
            pesoTotalKg: (route.totalWeight || 0).toFixed(2),
            ordenRecogidas: pickupOrder
          };
        });
        
        // Distribuir rutas en días considerando cantidad de vehículos disponibles por tipo
        // Agrupar rutas por tipo de vehículo
        const routesByVehicleType = {};
        preparedRoutes.forEach(route => {
          const tipo = route.tipoVehiculo || 'desconocido';
          if (!routesByVehicleType[tipo]) {
            routesByVehicleType[tipo] = [];
          }
          routesByVehicleType[tipo].push(route);
        });
        
        // Distribuir rutas por día considerando vehículos disponibles
        const routesByDay = [];
        let currentDay = 1;
        
        // Para cada tipo de vehículo, distribuir sus rutas
        Object.keys(routesByVehicleType).forEach(tipoVehiculo => {
          const rutasTipo = routesByVehicleType[tipoVehiculo];
          const cantidadVehiculos = vehiculosDisponibles[tipoVehiculo] || 1;
          
          // Ordenar rutas por tiempo (de mayor a menor)
          rutasTipo.sort((a, b) => b.tiempoMinutosNum - a.tiempoMinutosNum);
          
          // Distribuir rutas en "slots" de vehículos trabajando en paralelo
          let routeIndex = 0;
          while (routeIndex < rutasTipo.length) {
            // Obtener o crear el día actual
            let dayData = routesByDay.find(d => d.dia === currentDay);
            if (!dayData) {
              dayData = {
            dia: currentDay,
                rutas: [],
                tiempoMaximo: 0,
                vehiculosPorTipo: {}
              };
              routesByDay.push(dayData);
            }
            
            // Contar cuántas rutas de este tipo ya hay en el día
            const rutasTipoEnDia = dayData.rutas.filter(r => r.tipoVehiculo === tipoVehiculo).length;
            
            // Si aún hay espacio para más vehículos de este tipo en este día
            if (rutasTipoEnDia < cantidadVehiculos) {
              // Agregar rutas hasta llenar los vehículos disponibles o hasta que se acaben
              const rutasParaAgregar = Math.min(
                cantidadVehiculos - rutasTipoEnDia,
                rutasTipo.length - routeIndex
              );
              
              for (let i = 0; i < rutasParaAgregar && routeIndex < rutasTipo.length; i++) {
                const route = rutasTipo[routeIndex];
                dayData.rutas.push(route);
                dayData.tiempoMaximo = Math.max(dayData.tiempoMaximo, route.tiempoMinutosNum);
                routeIndex++;
              }
            } else {
              // No hay más espacio para este tipo en este día, pasar al siguiente día
              currentDay++;
            }
            
            // Si el tiempo máximo del día excede el límite, pasar al siguiente día
            if (dayData.tiempoMaximo > workingMinutesPerDay) {
              currentDay++;
            }
          }
        });
        
        // Renumerar días y calcular tiempo total
        routesByDay.sort((a, b) => a.dia - b.dia);
        routesByDay.forEach((dayData, index) => {
          dayData.dia = index + 1;
          dayData.tiempoTotal = dayData.tiempoMaximo;
        });
        
        // Generar CSV
        const csv = require('fast-csv');
        const csvData = [];
        
        routesByDay.forEach(dayData => {
          dayData.rutas.forEach(route => {
            route.ordenRecogidas.forEach(pickup => {
              const residuosStr = pickup.residuos.map(r => `${r.nombre} (${r.peso}kg)`).join('; ');
              csvData.push({
                'día': dayData.dia,
                'Ruta numero': route.rutaNumero,
                'tipo de vehiculo': route.tipoVehiculo,
                'orden de recogida': pickup.orden,
                'dirección': pickup.direccion,
                'Peso total': pickup.pesoTotal,
                'tipo de residuo': residuosStr
              });
            });
          });
        });
        
        // Crear stream CSV
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="plan_rutas_dia_${subidaId}_${Date.now()}.csv"`);
        
        csv.writeToStream(res, csvData, { headers: true })
          .on('error', (error) => {
            console.error('Error generando CSV:', error);
            res.status(500).json({ error: 'Error generando archivo CSV' });
          });
      });
    } catch (error) {
      console.error('Error procesando rutas:', error);
      res.status(500).json({ error: 'Error procesando rutas' });
    }
  });
});

// Eliminar un registro del historial
app.delete('/api/historial/:id', (req, res) => {
  const subidaId = req.params.id;
  
  console.log(`🗑️ Eliminando registro del historial: ID ${subidaId}`);
  
  // Primero verificar que existe
  db.get('SELECT id FROM historial_subidas WHERE id = ?', [subidaId], (err, row) => {
    if (err) {
      console.error('Error verificando subida:', err);
      return res.status(500).json({ error: 'Error verificando registro' });
    }
    
    if (!row) {
      return res.status(404).json({ error: 'Registro no encontrado' });
    }
    
    // Eliminar en cascada: primero los residuos, luego las rutas calculadas, y finalmente el registro del historial
    db.serialize(() => {
      db.run('DELETE FROM residuos WHERE subida_id = ?', [subidaId], (err) => {
        if (err) {
          console.error('Error eliminando residuos:', err);
          return res.status(500).json({ error: 'Error eliminando datos relacionados' });
        }
        
        db.run('DELETE FROM rutas_calculadas WHERE subida_id = ?', [subidaId], (err) => {
          if (err) {
            console.error('Error eliminando rutas:', err);
            return res.status(500).json({ error: 'Error eliminando rutas relacionadas' });
          }
          
          db.run('DELETE FROM historial_subidas WHERE id = ?', [subidaId], (err) => {
            if (err) {
              console.error('Error eliminando registro del historial:', err);
              return res.status(500).json({ error: 'Error eliminando registro' });
            }
            
            console.log(`✅ Registro ${subidaId} eliminado exitosamente`);
            res.json({ success: true, message: 'Registro eliminado exitosamente' });
          });
        });
      });
    });
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor ejecutándose en http://localhost:${PORT}`);
});
