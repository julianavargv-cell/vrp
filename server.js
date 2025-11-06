const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const csv = require('fast-csv');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const utm = require('utm');
const ProfessionalVRPAlgorithm = require('./professional-vrp');

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
    this.depot = { lat: 4.715296787876153, lon: -74.24195462883601, peso: 0 };
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
    console.log('🚀 Iniciando VRP Híbrido Multi-Vehículo...');
    console.log(`📍 ${this.locations.length} ubicaciones a procesar`);

    // Paso 1: Clasificar ubicaciones por tipo de vehículo óptimo
    const vehicleAssignments = this.classifyLocationsByVehicle();
    
    // Paso 2: Crear rutas para cada tipo de vehículo
    const camionRoutes = this.createRoutesForVehicle(vehicleAssignments.camion, 'camion');
    const motoRoutes = this.createRoutesForVehicle(vehicleAssignments.moto, 'moto');
    
    // Paso 3: Combinar y optimizar rutas globalmente
    const allRoutes = [...camionRoutes, ...motoRoutes];
    
    // Paso 4: Calcular métricas combinadas
    const metrics = this.calculateCombinedMetrics(allRoutes);
    
    console.log(`🎯 VRP Híbrido completado:`);
    console.log(`   🚛 Rutas camión: ${camionRoutes.length}`);
    console.log(`   🏍️ Rutas moto: ${motoRoutes.length}`);
    console.log(`   📊 Total rutas: ${allRoutes.length}`);
    console.log(`   💰 Costo total: $${metrics.totalCost.toFixed(2)}`);
    console.log(`   ⏱️ Tiempo total: ${metrics.totalTime.toFixed(1)} min`);
    console.log(`   📦 Peso total: ${metrics.totalWeight.toFixed(1)} kg`);

    return {
      routes: allRoutes,
      metrics: metrics,
      vehicleBreakdown: {
        camion: {
          routes: camionRoutes.length,
          weight: vehicleAssignments.camion.reduce((sum, loc) => sum + loc.peso, 0),
          locations: vehicleAssignments.camion.length
        },
        moto: {
          routes: motoRoutes.length,
          weight: vehicleAssignments.moto.reduce((sum, loc) => sum + loc.peso, 0),
          locations: vehicleAssignments.moto.length
        }
      }
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
    this.depot = { lat: 4.715296787876153, lon: -74.24195462883601, peso: 0 };
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
      const depot = { lat: 4.715296787876153, lon: -74.24195462883601, peso: 0, direccion: 'Depósito Bogotá' };
      
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
        
        route.push({ lat: 4.715296787876153, lon: -74.24195462883601, peso: 0, direccion: 'Depósito Bogotá' });
        
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
        
        route.push({ lat: 4.715296787876153, lon: -74.24195462883601, peso: 0, direccion: 'Depósito Bogotá' });
        
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
    this.depot = { lat: 4.715296787876153, lon: -74.24195462883601, peso: 0 };
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
    this.depot = { lat: 4.715296787876153, lon: -74.24195462883601, peso: 0 };
  }

  calculateCustomRoutes() {
    console.log('🚛 Iniciando VRP con vehículos personalizados...');
    
    // Clasificar ubicaciones por vehículo óptimo
    const classifiedLocations = this.classifyLocationsByVehicle();
    
    // Crear rutas para cada tipo de vehículo
    const allRoutes = [];
    let totalCost = 0;
    let totalDistance = 0;
    let totalTime = 0;
    let totalWeight = 0;
    
    for (const vehicleType in classifiedLocations) {
      const locations = classifiedLocations[vehicleType];
      const vehicle = this.customVehicles.find(v => v.type === vehicleType);
      
      if (!vehicle || locations.length === 0) continue;
      
      console.log(`🔄 Creando rutas para ${vehicle.name} (${locations.length} ubicaciones)...`);
      
      const routes = this.createRoutesForVehicle(locations, vehicle);
      allRoutes.push(...routes);
      
      // Calcular métricas
      routes.forEach(route => {
        totalCost += route.totalCost;
        totalDistance += route.totalDistance;
        totalTime += route.totalTime;
        totalWeight += route.totalWeight;
      });
      
      console.log(`   ✅ ${routes.length} rutas ${vehicle.name} creadas`);
    }
    
    // Calcular métricas finales
    const metrics = {
      totalRoutes: allRoutes.length,
      totalCost: totalCost,
      totalDistance: totalDistance,
      totalTime: totalTime,
      totalWeight: totalWeight,
      feasibleRoutes: allRoutes.length,
      averageUtilization: allRoutes.length > 0 ? 
        allRoutes.reduce((sum, r) => sum + r.utilization, 0) / allRoutes.length : 0
    };
    
    console.log(`🎯 VRP Personalizado completado:`);
    console.log(`   📊 Total rutas: ${metrics.totalRoutes}`);
    console.log(`   💰 Costo total: $${metrics.totalCost.toFixed(2)}`);
    console.log(`   ⏱️ Tiempo total: ${metrics.totalTime.toFixed(1)} min`);
    console.log(`   📦 Peso total: ${metrics.totalWeight.toFixed(1)} kg`);
    
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
      }
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
    
    while (unvisited.length > 0) {
      const route = this.createSingleRoute(unvisited, vehicle);
      if (route.stops.length === 0) break; // No se pueden crear más rutas
      routes.push(route);
    }
    
    return routes;
  }

  createSingleRoute(unvisited, vehicle) {
    const route = {
      vehicleType: vehicle.type,
      vehicleName: vehicle.name,
      vehicleCapacity: vehicle.capacity,
      vehicleCostPerTrip: vehicle.costPerTrip,
      stops: [],
      totalWeight: 0,
      totalDistance: 0,
      totalTime: 0,
      totalCost: 0,
      utilization: 0
    };
    
    let currentLocation = this.depot;
    let currentLoad = 0;
    
    while (unvisited.length > 0 && currentLoad < vehicle.capacity) {
      // Encontrar la ubicación más cercana que quepa
      let nearestIndex = -1;
      let nearestDistance = Infinity;
      
      for (let i = 0; i < unvisited.length; i++) {
        const location = unvisited[i];
        if (currentLoad + location.peso <= vehicle.capacity) {
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
      
      if (nearestIndex === -1) break;
      
      const nextLocation = unvisited.splice(nearestIndex, 1)[0];
      const distance = this.calculateDistance(
        currentLocation.lat, currentLocation.lon,
        nextLocation.lat, nextLocation.lon
      );
      
      route.stops.push(nextLocation);
      currentLoad += nextLocation.peso;
      route.totalDistance += distance;
      currentLocation = nextLocation;
    }
    
    // Volver al depósito
    const returnDistance = this.calculateDistance(
      currentLocation.lat, currentLocation.lon,
      this.depot.lat, this.depot.lon
    );
    route.totalDistance += returnDistance;
    
    // Calcular métricas
    route.totalWeight = currentLoad;
    route.totalTime = (route.totalDistance / 30) * 60; // Asumiendo 30 km/h promedio
    route.totalCost = vehicle.costPerTrip; // Costo fijo por viaje
    route.utilization = (currentLoad / vehicle.capacity) * 100;
    
    return route;
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

// Calcular rutas VRP híbridas
app.post('/api/calculate-routes', (req, res) => {
  const { vehicleType = 'hibrido', subidaId, customVehicles = [], vehicleConfigs = null } = req.body;
  
  console.log(`🚀 Iniciando cálculo de rutas VRP ${vehicleType}...`);
  console.log(`🔍 DEBUG - vehicleType: ${vehicleType}`);
  console.log(`🔍 DEBUG - customVehicles.length: ${customVehicles ? customVehicles.length : 0}`);
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
      
      // Guardar las rutas en la base de datos
      const stmt = db.prepare(`
        INSERT INTO rutas_calculadas (
          subida_id, tipo_vehiculo, capacidad_vehiculo_kg, capacidad_vehiculo_m3,
          total_rutas, rutas_validas, peso_total_kg, distancia_total_km,
          tiempo_total_minutos, costo_total_usd, dias_trabajo, utilizacion_promedio, rutas_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      
      const diasTrabajo = Math.ceil((result.totalTime || result.analysis.totalTime || 0) / (VRP_CONFIG.workingHours * 60));
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
        JSON.stringify(result.routes)
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
      if (vehicleConfigs && vehicleConfigs[selectedVehicleType]) {
        vehicleConfigForResponse = vehicleConfigs[selectedVehicleType];
      } else if (useHybrid && vehicleConfigs) {
        vehicleConfigForResponse = { name: 'Híbrido', description: 'Configuración híbrida dinámica' };
      } else {
        vehicleConfigForResponse = VEHICLE_TYPES[vehicleType] || VEHICLE_TYPES.camion;
      }
      
      const analysis = {
        vehicleType: vehicleType,
        vehicleConfig: vehicleConfigForResponse,
        totalVehicles: result.routes.length,
        totalWorkingDays: diasTrabajo,
        averageUtilization: utilizacionPromedio,
        feasibleRoutes: result.feasibleRoutes || result.routes.length,
        totalCost: result.totalCost || result.analysis?.totalCost || 0,
        costPerTon: finalPesoTotal > 0 ? (result.totalCost || result.analysis?.totalCost || 0) / (finalPesoTotal / 1000) : 0,
        totalDistance: result.totalDistance || result.analysis?.totalDistance || 0,
        totalTime: result.totalTime || result.analysis?.totalTime || 0,
        pesoTotal: finalPesoTotal || result.analysis?.pesoTotal || result.analysis?.totalWeight || 0,
        totalWeight: finalPesoTotal || result.analysis?.pesoTotal || result.analysis?.totalWeight || 0,
        vehicleUtilization: vehicleUtilization
      };
      
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
    SELECT rutas_json, fecha_calculo, tipo_vehiculo
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
        
        // Configuración de trabajo
        const VRP_CONFIG = {
          workingHours: 9,
          workingMinutes: 9 * 60
        };
        
        const workingMinutesPerDay = VRP_CONFIG.workingMinutes;
        
        // Agrupar rutas por día
        const routesByDay = [];
        let currentDay = 1;
        let currentDayTime = 0;
        let currentDayRoutes = [];
        
        routesWithDetails.forEach((route) => {
          const routeTime = route.tiempoMinutos || 0;
          
          // Si agregar esta ruta excede el tiempo del día, empezar un nuevo día
          if (currentDayTime + routeTime > workingMinutesPerDay && currentDayRoutes.length > 0) {
            routesByDay.push({
              dia: currentDay,
              rutas: [...currentDayRoutes],
              tiempoTotal: currentDayTime
            });
            currentDay++;
            currentDayTime = 0;
            currentDayRoutes = [];
          }
          
          // Agregar la ruta al día actual
          currentDayRoutes.push(route);
          currentDayTime += routeTime;
        });
        
        // Agregar el último día si tiene rutas
        if (currentDayRoutes.length > 0) {
          routesByDay.push({
            dia: currentDay,
            rutas: currentDayRoutes,
            tiempoTotal: currentDayTime
          });
        }
        
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
    SELECT rutas_json, fecha_calculo, tipo_vehiculo
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
        
        // Agrupar rutas por día considerando restricciones de tiempo
        const workingHoursPerDay = VRP_CONFIG.workingHours; // 9 horas
        const workingMinutesPerDay = workingHoursPerDay * 60;
        
        const routesByDay = [];
        let currentDay = 1;
        let currentDayTime = 0;
        let currentDayRoutes = [];
        
        routes.forEach((route, routeIndex) => {
          const routeTime = route.totalTime || 0;
          
          // Si agregar esta ruta excede el tiempo del día, empezar un nuevo día
          if (currentDayTime + routeTime > workingMinutesPerDay && currentDayRoutes.length > 0) {
            routesByDay.push({
              dia: currentDay,
              rutas: [...currentDayRoutes],
              tiempoTotal: currentDayTime
            });
            currentDay++;
            currentDayTime = 0;
            currentDayRoutes = [];
          }
          
          // Agregar la ruta al día actual
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
          
          currentDayRoutes.push({
            rutaNumero: routeIndex + 1,
            tipoVehiculo: route.vehicleType || route.vehicleName || row.tipo_vehiculo,
            distanciaKm: (route.totalDistance || 0).toFixed(2),
            tiempoMinutos: (route.totalTime || 0).toFixed(1),
            pesoTotalKg: (route.totalWeight || 0).toFixed(2),
            ordenRecogidas: pickupOrder
          });
          
          currentDayTime += routeTime;
        });
        
        // Agregar el último día
        if (currentDayRoutes.length > 0) {
          routesByDay.push({
            dia: currentDay,
            rutas: currentDayRoutes,
            tiempoTotal: currentDayTime
          });
        }
        
        // Generar CSV
        const csv = require('fast-csv');
        const csvData = [];
        
        routesByDay.forEach(dayData => {
          dayData.rutas.forEach(route => {
            route.ordenRecogidas.forEach(pickup => {
              const residuosStr = pickup.residuos.map(r => `${r.nombre} (${r.peso}kg)`).join('; ');
              csvData.push({
                'Día': dayData.dia,
                'Ruta Número': route.rutaNumero,
                'Tipo Vehículo': route.tipoVehiculo,
                'Orden Recogida': pickup.orden,
                'Dirección': pickup.direccion,
                'Ciudad': pickup.ciudad,
                'Latitud': pickup.latitud,
                'Longitud': pickup.longitud,
                'Peso Total (kg)': pickup.pesoTotal,
                'Tipos de Residuo': residuosStr,
                'Distancia Ruta (km)': route.distanciaKm,
                'Tiempo Ruta (min)': route.tiempoMinutos,
                'Tiempo Total Día (min)': dayData.tiempoTotal.toFixed(1)
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
