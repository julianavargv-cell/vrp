const CustomVRPAlgorithm = require('./server.js').CustomVRPAlgorithm || class {
  constructor(locations, customVehicles) {
    this.locations = locations;
    this.customVehicles = customVehicles;
    this.depot = { lat: 4.715296787876153, lon: -74.24195462883601, peso: 0 };
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
  
  createSingleRoute(unvisited, vehicle) {
    const route = {
      vehicleType: vehicle.type,
      vehicleName: vehicle.name,
      vehicleCapacity: vehicle.capacity,
      stops: [],
      totalWeight: 0,
      totalDistance: 0,
      totalTime: 0
    };
    
    let currentLocation = this.depot;
    let currentLoad = 0;
    
    while (unvisited.length > 0 && currentLoad < vehicle.capacity) {
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
    
    const returnDistance = this.calculateDistance(
      currentLocation.lat, currentLocation.lon,
      this.depot.lat, this.depot.lon
    );
    route.totalDistance += returnDistance;
    route.totalWeight = currentLoad;
    route.totalTime = (route.totalDistance / 30) * 60; // 30 km/h
    
    return route;
  }
  
  createRoutesForVehicle(locations, vehicle) {
    const routes = [];
    const unvisited = [...locations];
    
    while (unvisited.length > 0) {
      const route = this.createSingleRoute(unvisited, vehicle);
      if (route.stops.length === 0) break;
      routes.push(route);
    }
    
    return routes;
  }
  
  calculateCustomRoutes() {
    // Simular clustering: todas las ubicaciones en un solo grupo
    const allRoutes = [];
    let totalTime = 0;
    let totalDistance = 0;
    let totalWeight = 0;
    
    // Asignar ubicaciones a vehículos individuales
    const ubicacionesOrdenadas = [...this.locations].sort((a, b) => (b.peso || 0) - (a.peso || 0));
    const vehicleAssignments = this.customVehicles.map(vehicle => ({
      vehicle: vehicle,
      assignedLocations: [],
      totalAssignedWeight: 0
    }));
    
    ubicacionesOrdenadas.forEach(location => {
      const locationWeight = location.peso || 0;
      const compatibleVehicles = vehicleAssignments.filter(va => 
        va.vehicle.capacity >= locationWeight
      );
      
      if (compatibleVehicles.length > 0) {
        compatibleVehicles.sort((a, b) => {
          if (Math.abs(a.totalAssignedWeight - b.totalAssignedWeight) > 100) {
            return a.totalAssignedWeight - b.totalAssignedWeight;
          }
          const distA = this.calculateDistance(this.depot.lat, this.depot.lon, location.lat, location.lon);
          const distB = this.calculateDistance(this.depot.lat, this.depot.lon, location.lat, location.lon);
          return distA - distB;
        });
        
        const bestVehicle = compatibleVehicles[0];
        bestVehicle.assignedLocations.push(location);
        bestVehicle.totalAssignedWeight += locationWeight;
      }
    });
    
    vehicleAssignments.forEach(assignment => {
      if (assignment.assignedLocations.length === 0) return;
      
      const routes = this.createRoutesForVehicle(assignment.assignedLocations, assignment.vehicle);
      routes.forEach(route => {
        route.vehicleName = assignment.vehicle.name;
        route.vehicleCapacity = assignment.vehicle.capacity;
      });
      
      allRoutes.push(...routes);
      
      routes.forEach(route => {
        totalTime += route.totalTime || 0;
        totalDistance += route.totalDistance || 0;
        totalWeight += route.totalWeight || 0;
      });
    });
    
    return {
      routes: allRoutes,
      analysis: {
        totalTime: totalTime,
        totalDistance: totalDistance,
        totalWeight: totalWeight
      }
    };
  }
};

// Datos de prueba
const testLocations = [
  { lat: 4.6097, lon: -74.0817, peso: 500, direccion: 'Calle 100 # 50-30' },
  { lat: 4.6533, lon: -74.0836, peso: 300, direccion: 'Calle 80 # 40-20' },
  { lat: 4.7110, lon: -74.0721, peso: 800, direccion: 'Calle 70 # 30-10' },
  { lat: 4.6286, lon: -74.0640, peso: 400, direccion: 'Calle 60 # 20-50' },
  { lat: 4.6700, lon: -74.0500, peso: 600, direccion: 'Calle 50 # 10-40' },
  { lat: 4.6900, lon: -74.0900, peso: 700, direccion: 'Calle 40 # 5-30' },
  { lat: 4.6500, lon: -74.0700, peso: 450, direccion: 'Calle 30 # 15-20' },
  { lat: 4.6800, lon: -74.0600, peso: 550, direccion: 'Calle 20 # 25-10' }
];

console.log('🧪 PRUEBA: Comparación 1 vehículo vs 2 vehículos\n');
console.log('='.repeat(60));

// CASO 1: 1 vehículo
console.log('\n📊 CASO 1: 1 VEHÍCULO (Camión 5500kg)');
console.log('-'.repeat(60));

const vehicles1 = [
  { id: 'camion1', name: 'Camión 1', type: 'camion', capacity: 5500, costPerTrip: 350000 }
];

const vrp1 = new CustomVRPAlgorithm(testLocations, vehicles1);
const result1 = vrp1.calculateCustomRoutes();

const workingMinutesPerDay = 9 * 60; // 540 minutos

// Agrupar rutas por vehículo
const routesByVehicle1 = {};
result1.routes.forEach(route => {
  const vehicleId = route.vehicleName || 'desconocido';
  if (!routesByVehicle1[vehicleId]) {
    routesByVehicle1[vehicleId] = {
      routes: [],
      totalTime: 0,
      totalWeight: 0,
      totalDistance: 0
    };
  }
  routesByVehicle1[vehicleId].routes.push(route);
  routesByVehicle1[vehicleId].totalTime += route.totalTime || 0;
  routesByVehicle1[vehicleId].totalWeight += route.totalWeight || 0;
  routesByVehicle1[vehicleId].totalDistance += route.totalDistance || 0;
});

let maxDays1 = 0;
Object.keys(routesByVehicle1).forEach(vehicleId => {
  const assignment = routesByVehicle1[vehicleId];
  const dias = Math.ceil(assignment.totalTime / workingMinutesPerDay);
  maxDays1 = Math.max(maxDays1, dias);
  
  console.log(`\n🚛 ${vehicleId}:`);
  console.log(`   Rutas: ${assignment.routes.length}`);
  console.log(`   Peso total: ${assignment.totalWeight.toFixed(1)} kg`);
  console.log(`   Distancia total: ${assignment.totalDistance.toFixed(2)} km`);
  console.log(`   Tiempo total: ${assignment.totalTime.toFixed(1)} min`);
  console.log(`   Días necesarios: ${dias}`);
});

console.log(`\n📅 DÍAS TOTALES (CASO 1): ${maxDays1} días`);

// CASO 2: 2 vehículos
console.log('\n\n📊 CASO 2: 2 VEHÍCULOS (2 Camiones de 5500kg cada uno)');
console.log('-'.repeat(60));

const vehicles2 = [
  { id: 'camion1', name: 'Camión 1', type: 'camion', capacity: 5500, costPerTrip: 350000 },
  { id: 'camion2', name: 'Camión 2', type: 'camion', capacity: 5500, costPerTrip: 350000 }
];

const vrp2 = new CustomVRPAlgorithm(testLocations, vehicles2);
const result2 = vrp2.calculateCustomRoutes();

// Agrupar rutas por vehículo
const routesByVehicle2 = {};
result2.routes.forEach(route => {
  const vehicleId = route.vehicleName || 'desconocido';
  if (!routesByVehicle2[vehicleId]) {
    routesByVehicle2[vehicleId] = {
      routes: [],
      totalTime: 0,
      totalWeight: 0,
      totalDistance: 0
    };
  }
  routesByVehicle2[vehicleId].routes.push(route);
  routesByVehicle2[vehicleId].totalTime += route.totalTime || 0;
  routesByVehicle2[vehicleId].totalWeight += route.totalWeight || 0;
  routesByVehicle2[vehicleId].totalDistance += route.totalDistance || 0;
});

let maxDays2 = 0;
Object.keys(routesByVehicle2).forEach(vehicleId => {
  const assignment = routesByVehicle2[vehicleId];
  const dias = Math.ceil(assignment.totalTime / workingMinutesPerDay);
  maxDays2 = Math.max(maxDays2, dias);
  
  console.log(`\n🚛 ${vehicleId}:`);
  console.log(`   Rutas: ${assignment.routes.length}`);
  console.log(`   Peso total: ${assignment.totalWeight.toFixed(1)} kg`);
  console.log(`   Distancia total: ${assignment.totalDistance.toFixed(2)} km`);
  console.log(`   Tiempo total: ${assignment.totalTime.toFixed(1)} min`);
  console.log(`   Días necesarios: ${dias}`);
});

console.log(`\n📅 DÍAS TOTALES (CASO 2): ${maxDays2} días`);

// COMPARACIÓN
console.log('\n\n' + '='.repeat(60));
console.log('📊 COMPARACIÓN DE RESULTADOS');
console.log('='.repeat(60));

console.log(`\n1 Vehículo:  ${maxDays1} días`);
console.log(`2 Vehículos: ${maxDays2} días`);
console.log(`\nDiferencia: ${Math.abs(maxDays1 - maxDays2)} días`);

if (maxDays1 !== maxDays2) {
  console.log('\n✅ CONFIRMADO: Los resultados SON DIFERENTES');
  console.log(`   Con 2 vehículos trabajando en paralelo, se reducen los días de ${maxDays1} a ${maxDays2}`);
} else {
  console.log('\n⚠️  ADVERTENCIA: Los resultados son iguales');
  console.log('   Esto podría indicar que el sistema no está considerando vehículos en paralelo correctamente');
}

console.log('\n' + '='.repeat(60));


