// Algoritmo VRP Profesional usando técnicas de OR-Tools
// Implementa: Savings Algorithm (Clark & Wright), 2-opt, Haversine distance
// Clustering por localidades de Bogotá

const { agruparPorLocalidad, obtenerEstadisticasLocalidades } = require('./bogota-localidades');

class ProfessionalVRPAlgorithm {
  constructor(locations, vehicleConfigs = null) {
    this.locations = locations;
    // Parque Industrial San Jorge, Cll 93A # 13 - 24P, Bogotá
    this.depot = { lat: 4.715254, lon: -74.242008, peso: 0, direccion: 'Parque Industrial San Jorge, Cll 93A # 13 - 24P, Bogotá' };
    
    // Configuración de vehículos
    // Costos en COP por día (8am-5pm)
    if (vehicleConfigs && vehicleConfigs.camion && vehicleConfigs.moto) {
      this.camionConfig = vehicleConfigs.camion;
      this.motoConfig = vehicleConfigs.moto;
    } else {
      this.camionConfig = {
        capacityKg: 5500,
        fuelCostPerKm: 0, // No se usa - costo es por día
        averageSpeedKmH: 25,
        serviceTimePerLocationMin: 15,
        depotServiceTimeMin: 30,
        costPerDayCOP: 350000, // 350,000 COP por día completo (8am-5pm)
        workingHoursPerDay: 9 // 8am-5pm = 9 horas
      };
      this.motoConfig = {
        capacityKg: 150,
        fuelCostPerKm: 0, // No se usa - costo es por día
        averageSpeedKmH: 35,
        serviceTimePerLocationMin: 10,
        depotServiceTimeMin: 15,
        costPerDayCOP: 100000, // 100,000 COP por día completo (8am-5pm)
        workingHoursPerDay: 9 // 8am-5pm = 9 horas
      };
    }
    
    this.routes = [];
    this.distanceMatrix = null;
  }

  // Calcular distancia Haversine (más precisa que Manhattan)
  calculateHaversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radio de la Tierra en km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // Construir matriz de distancias
  buildDistanceMatrix() {
    const allPoints = [this.depot, ...this.locations];
    this.distanceMatrix = [];
    
    for (let i = 0; i < allPoints.length; i++) {
      this.distanceMatrix[i] = [];
      for (let j = 0; j < allPoints.length; j++) {
        if (i === j) {
          this.distanceMatrix[i][j] = 0;
        } else {
          this.distanceMatrix[i][j] = this.calculateHaversineDistance(
            allPoints[i].lat, allPoints[i].lon,
            allPoints[j].lat, allPoints[j].lon
          );
        }
      }
    }
    
    return this.distanceMatrix;
  }

  // Savings Algorithm (Clark & Wright) - Algoritmo profesional para VRP
  calculateSavings() {
    const savings = [];
    const n = this.locations.length;
    
    // Calcular savings: s(i,j) = d(depot,i) + d(depot,j) - d(i,j)
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const di0 = this.distanceMatrix[0][i + 1]; // distancia depot -> i
        const d0j = this.distanceMatrix[0][j + 1]; // distancia depot -> j
        const dij = this.distanceMatrix[i + 1][j + 1]; // distancia i -> j
        
        const saving = di0 + d0j - dij;
        savings.push({
          i: i,
          j: j,
          saving: saving,
          distance: dij
        });
      }
    }
    
    // Ordenar por savings descendente
    savings.sort((a, b) => b.saving - a.saving);
    
    return savings;
  }

  // Crear rutas usando Savings Algorithm (versión simplificada pero efectiva)
  createRoutesWithSavings(vehicleType) {
    const config = vehicleType === 'camion' ? this.camionConfig : this.motoConfig;
    const routes = [];
    
    // Filtrar ubicaciones que caben en este tipo de vehículo
    const validLocations = this.locations
      .map((loc, idx) => ({ ...loc, originalIndex: idx }))
      .filter(loc => loc.peso <= config.capacityKg);
    
    if (validLocations.length === 0) return routes;
    
    // Construir matriz de distancias si no existe
    if (!this.distanceMatrix) {
      this.buildDistanceMatrix();
    }
    
    // Crear rutas usando Nearest Neighbor mejorado (más simple pero efectivo)
    const unvisited = [...validLocations];
    let routeNumber = 1;
    
    while (unvisited.length > 0) {
      const route = [this.depot];
      let currentLoad = 0;
      let currentLocation = this.depot;
      let currentIndex = 0; // índice del depot en la matriz
      
      // Agregar ubicaciones a la ruta mientras quepa capacidad
      while (unvisited.length > 0) {
        let nearestIndex = -1;
        let nearestDistance = Infinity;
        let nearestLocation = null;
        let nearestLocationIndex = -1;
        
        // Encontrar la ubicación más cercana que quepa
        for (let i = 0; i < unvisited.length; i++) {
          const location = unvisited[i];
          const matrixIndex = location.originalIndex + 1; // +1 porque depot es 0
          
          if (currentLoad + location.peso <= config.capacityKg) {
            const distance = this.distanceMatrix[currentIndex][matrixIndex];
            if (distance < nearestDistance) {
              nearestDistance = distance;
              nearestIndex = i;
              nearestLocation = location;
              nearestLocationIndex = matrixIndex;
            }
          }
        }
        
        if (nearestIndex === -1) break; // No hay más ubicaciones que quepan
        
        // Agregar ubicación a la ruta
        route.push({
          ...nearestLocation,
          index: nearestLocationIndex
        });
        currentLoad += nearestLocation.peso;
        currentLocation = nearestLocation;
        currentIndex = nearestLocationIndex;
        unvisited.splice(nearestIndex, 1);
      }
      
      // Regresar al depósito
      route.push({
        ...this.depot,
        index: 0
      });
      
      // Finalizar ruta
      const finalRoute = this.finalizeRoute(route, vehicleType, routeNumber);
      routes.push(finalRoute);
      routeNumber++;
    }
    
    return routes;
  }

  // Mejora local 2-opt (optimiza rutas intercambiando aristas)
  improveRouteWith2Opt(route, vehicleType) {
    const config = vehicleType === 'camion' ? this.camionConfig : this.motoConfig;
    let improved = true;
    let bestRoute = [...route.locations];
    let bestDistance = route.totalDistance;
    
    while (improved) {
      improved = false;
      
      for (let i = 1; i < bestRoute.length - 2; i++) {
        for (let j = i + 1; j < bestRoute.length - 1; j++) {
          // Crear nueva ruta intercambiando segmento
          const newRoute = [
            ...bestRoute.slice(0, i),
            ...bestRoute.slice(i, j + 1).reverse(),
            ...bestRoute.slice(j + 1)
          ];
          
          // Calcular nueva distancia
          let newDistance = 0;
          for (let k = 0; k < newRoute.length - 1; k++) {
            const idx1 = newRoute[k].index || 0;
            const idx2 = newRoute[k + 1].index || 0;
            newDistance += this.distanceMatrix[idx1][idx2];
          }
          
          // Si mejora, actualizar
          if (newDistance < bestDistance) {
            bestRoute = newRoute;
            bestDistance = newDistance;
            improved = true;
            break;
          }
        }
        if (improved) break;
      }
    }
    
    // Recalcular métricas de la ruta mejorada
    return this.finalizeRoute(bestRoute, vehicleType, route.id || 1);
  }

  // Finalizar ruta calculando métricas completas
  finalizeRoute(routeLocations, vehicleType, routeId) {
    const config = vehicleType === 'camion' ? this.camionConfig : this.motoConfig;
    
    // Calcular distancia total
    let totalDistance = 0;
    for (let i = 0; i < routeLocations.length - 1; i++) {
      const idx1 = routeLocations[i].index || 0;
      const idx2 = routeLocations[i + 1].index || 0;
      totalDistance += this.distanceMatrix[idx1][idx2];
    }
    
    // Calcular peso total
    const totalWeight = routeLocations
      .filter(loc => loc !== this.depot)
      .reduce((sum, loc) => sum + (loc.peso || 0), 0);
    
    // Calcular tiempo total
    const travelTime = (totalDistance / config.averageSpeedKmH) * 60; // minutos
    const serviceTime = (routeLocations.length - 2) * config.serviceTimePerLocationMin;
    const depotTime = config.depotServiceTimeMin;
    const totalTime = travelTime + serviceTime + depotTime;
    
    // Calcular costo total
    // Si tiene costPerDayCOP, usar costo por día (8am-5pm = 540 minutos)
    // Si no, usar cálculo tradicional por hora/km
    let totalCost;
    const workingMinutesPerDay = (config.workingHoursPerDay || 9) * 60; // 540 minutos (8am-5pm)
    
    if (config.costPerDayCOP) {
      // Costo por día completo en COP
      const daysNeeded = Math.ceil(totalTime / workingMinutesPerDay);
      totalCost = daysNeeded * config.costPerDayCOP;
    } else if (config.costPerHour) {
      // Cálculo tradicional por hora
      const fuelCost = totalDistance * (config.fuelCostPerKm || 0);
      const timeCost = (totalTime / 60) * config.costPerHour;
      totalCost = fuelCost + timeCost;
    } else {
      // Fallback
      totalCost = 0;
    }
    
    // Calcular utilización
    const utilization = (totalWeight / config.capacityKg) * 100;
    
    return {
      id: `route_${vehicleType}_${routeId}`,
      vehicleType: vehicleType,
      locations: routeLocations,
      totalWeight: totalWeight,
      totalDistance: totalDistance,
      totalTime: totalTime,
      totalCost: totalCost,
      utilization: utilization,
      isOversized: totalWeight > config.capacityKg
    };
  }

  // Calcular rutas optimizadas (método principal)
  calculateOptimizedRoutes() {
    console.log('🚀 Iniciando VRP Profesional con Savings Algorithm...');
    console.log(`📍 ${this.locations.length} ubicaciones a procesar`);
    
    // PASO 1: Agrupar por localidades de Bogotá
    console.log('🏘️ Agrupando ubicaciones por localidades de Bogotá...');
    const gruposPorLocalidad = agruparPorLocalidad(this.locations);
    const estadisticas = obtenerEstadisticasLocalidades(gruposPorLocalidad);
    
    console.log(`✅ ${Object.keys(gruposPorLocalidad).length} localidades identificadas:`);
    estadisticas.forEach(stat => {
      console.log(`   📍 ${stat.localidad}: ${stat.cantidad} ubicaciones, ${stat.pesoTotal.toFixed(1)}kg`);
    });
    
    // NO construir matriz global - se construirá por localidad (más eficiente para grandes volúmenes)
    console.log('✅ Usando matrices por localidad (optimizado para 1500+ registros)');
    
    // PASO 2: Crear rutas por localidad (clustering geográfico)
    const allRoutes = [];
    const localidadRoutes = {};
    const ubicacionesCompletas = this.locations; // Guardar ubicaciones completas al inicio
    
    for (const [localidad, ubicacionesLocalidad] of Object.entries(gruposPorLocalidad)) {
      if (ubicacionesLocalidad.length === 0) continue;
      
      console.log(`\n🏘️ Procesando localidad: ${localidad} (${ubicacionesLocalidad.length} ubicaciones)`);
      
      // Guardar ubicaciones originales
      const ubicacionesOriginales = this.locations;
      
      // Usar solo ubicaciones de esta localidad
      this.locations = ubicacionesLocalidad;
      
      // Reconstruir matriz de distancias para esta localidad
      this.buildDistanceMatrix();
      
      // Clasificar ubicaciones de esta localidad por vehículo
      const vehicleAssignments = this.classifyLocationsByVehicle();
      
      // Crear rutas para esta localidad
      const camionRoutes = this.createRoutesWithSavings('camion');
      const motoRoutes = this.createRoutesWithSavings('moto');
      
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
      this.locations = ubicacionesOriginales;
    }
    
    // Restaurar locations completa para estadísticas
    this.locations = ubicacionesCompletas;
    
    // Mejorar rutas con 2-opt (optimizado: solo si la ruta tiene suficientes puntos)
    console.log('\n🔧 Optimizando rutas con 2-opt...');
    const improvedRoutes = allRoutes.map((route, idx) => {
      // Solo optimizar rutas con más de 2 puntos (además del depot)
      if (route.locations.length <= 3) {
        return route; // Ruta muy corta, no necesita optimización
      }
      
      // Reconstruir matriz de distancias solo para esta ruta
      const ubicacionesRuta = route.locations.filter(loc => loc !== this.depot);
      const tempLocations = this.locations;
      this.locations = ubicacionesRuta;
      this.buildDistanceMatrix();
      
      const improved = this.improveRouteWith2Opt(route, route.vehicleType);
      
      // Restaurar
      this.locations = tempLocations;
      
      if ((idx + 1) % 10 === 0) {
        console.log(`   ⚙️ Optimizadas ${idx + 1}/${allRoutes.length} rutas...`);
      }
      
      return improved;
    });
    
    // Calcular métricas combinadas
    const metrics = this.calculateCombinedMetrics(improvedRoutes);
    
    // Restaurar ubicaciones originales
    this.locations = ubicacionesOriginales;
    
    // Calcular desglose por vehículo
    const vehicleAssignments = this.classifyLocationsByVehicle();
    
    console.log(`\n🎯 VRP Profesional con Clustering por Localidades completado:`);
    console.log(`   🗺️  Localidades procesadas: ${estadisticas.length}`);
    console.log(`   🚛 Rutas camión: ${improvedRoutes.filter(r => r.vehicleType === 'camion').length}`);
    console.log(`   🏍️ Rutas moto: ${improvedRoutes.filter(r => r.vehicleType === 'moto').length}`);
    console.log(`   📊 Total rutas: ${improvedRoutes.length}`);
    console.log(`   💰 Costo total: $${metrics.totalCost.toFixed(2)}`);
    console.log(`   ⏱️ Tiempo total: ${metrics.totalTime.toFixed(1)} min`);
    console.log(`   📦 Peso total: ${metrics.totalWeight.toFixed(1)} kg`);
    
    console.log(`\n📋 Resumen por localidad:`);
    for (const [localidad, stats] of Object.entries(localidadRoutes)) {
      console.log(`   ${localidad}: ${stats.total} rutas (🚛${stats.camion} 🏍️${stats.moto})`);
    }
    
    return {
      routes: improvedRoutes,
      metrics: metrics,
      vehicleBreakdown: {
        camion: {
          routes: improvedRoutes.filter(r => r.vehicleType === 'camion').length,
          weight: vehicleAssignments.camion.reduce((sum, loc) => sum + loc.peso, 0),
          locations: vehicleAssignments.camion.length
        },
        moto: {
          routes: improvedRoutes.filter(r => r.vehicleType === 'moto').length,
          weight: vehicleAssignments.moto.reduce((sum, loc) => sum + loc.peso, 0),
          locations: vehicleAssignments.moto.length
        }
      },
      localidades: estadisticas,
      localidadRoutes: localidadRoutes
    };
  }

  // Clasificar ubicaciones por vehículo (misma lógica que HybridVRP)
  classifyLocationsByVehicle() {
    const camionLocations = [];
    const motoLocations = [];
    
    for (const location of this.locations) {
      const weight = location.peso;
      const motoCapacity = this.motoConfig.capacityKg;
      const pesoMedio = motoCapacity * 0.67;
      const pesoLigero = motoCapacity * 0.33;
      
      if (weight > motoCapacity || weight > pesoMedio) {
        camionLocations.push(location);
      } else {
        motoLocations.push(location);
      }
    }
    
    return { camion: camionLocations, moto: motoLocations };
  }

  // Calcular métricas combinadas
  calculateCombinedMetrics(routes) {
    const totalWeight = routes.reduce((sum, route) => sum + route.totalWeight, 0);
    const totalDistance = routes.reduce((sum, route) => sum + route.totalDistance, 0);
    const totalTime = routes.reduce((sum, route) => sum + route.totalTime, 0);
    
    // Calcular costo total respetando restricciones de horario (8am-5pm = 540 minutos)
    const workingMinutesPerDay = 9 * 60; // 540 minutos (8am-5pm)
    
    // Agrupar rutas por vehículo y calcular días de trabajo por tipo
    let totalCost = 0;
    let camionDays = 0;
    let motoDays = 0;
    
    // Agrupar rutas por tipo de vehículo y calcular días de trabajo
    const camionRoutes = routes.filter(r => r.vehicleType === 'camion');
    const motoRoutes = routes.filter(r => r.vehicleType === 'moto');
    
    // Calcular tiempo total por tipo de vehículo
    const camionTotalTime = camionRoutes.reduce((sum, r) => sum + r.totalTime, 0);
    const motoTotalTime = motoRoutes.reduce((sum, r) => sum + r.totalTime, 0);
    
    // Calcular días de trabajo necesarios por tipo (8am-5pm = 540 minutos)
    camionDays = Math.ceil(camionTotalTime / workingMinutesPerDay);
    motoDays = Math.ceil(motoTotalTime / workingMinutesPerDay);
    
    // Calcular costo total: costo por día × días necesarios
    const camionConfig = this.camionConfig;
    const motoConfig = this.motoConfig;
    
    if (camionConfig.costPerDayCOP) {
      totalCost += camionDays * camionConfig.costPerDayCOP;
    } else {
      totalCost += camionRoutes.reduce((sum, r) => sum + r.totalCost, 0);
    }
    
    if (motoConfig.costPerDayCOP) {
      totalCost += motoDays * motoConfig.costPerDayCOP;
    } else {
      totalCost += motoRoutes.reduce((sum, r) => sum + r.totalCost, 0);
    }
    
    // Total de días de trabajo (máximo entre camión y moto si trabajan en paralelo)
    const totalWorkingDays = Math.max(camionDays, motoDays);
    
    const averageUtilization = routes.length > 0 
      ? routes.reduce((sum, route) => sum + route.utilization, 0) / routes.length 
      : 0;
    
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
}

module.exports = ProfessionalVRPAlgorithm;

