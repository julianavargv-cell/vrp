// Módulo para determinar localidades de Bogotá basado en coordenadas
// Bogotá tiene 20 localidades administrativas

// Rangos aproximados de coordenadas para cada localidad de Bogotá
// Coordenadas aproximadas: latitud (4.0 - 5.0), longitud (-74.4 - -73.9)
const LOCALIDADES_BOGOTA = {
  // Localidades del Norte
  'Usaquén': { 
    latMin: 4.70, latMax: 4.80, 
    lonMin: -74.10, lonMax: -73.95,
    zona: 'Norte'
  },
  'Chapinero': { 
    latMin: 4.63, latMax: 4.70, 
    lonMin: -74.10, lonMax: -73.95,
    zona: 'Centro-Norte'
  },
  'Santa Fe': { 
    latMin: 4.58, latMax: 4.65, 
    lonMin: -74.10, lonMax: -73.95,
    zona: 'Centro'
  },
  'San Cristóbal': { 
    latMin: 4.52, latMax: 4.62, 
    lonMin: -74.18, lonMax: -74.05,
    zona: 'Sur'
  },
  'Usme': { 
    latMin: 4.40, latMax: 4.55, 
    lonMin: -74.15, lonMax: -74.00,
    zona: 'Sur'
  },
  'Tunjuelito': { 
    latMin: 4.50, latMax: 4.58, 
    lonMin: -74.20, lonMax: -74.10,
    zona: 'Sur'
  },
  'Bosa': { 
    latMin: 4.58, latMax: 4.65, 
    lonMin: -74.25, lonMax: -74.15,
    zona: 'Suroccidente'
  },
  'Ciudad Bolívar': { 
    latMin: 4.45, latMax: 4.58, 
    lonMin: -74.25, lonMax: -74.10,
    zona: 'Sur'
  },
  'Sumapaz': { 
    latMin: 4.00, latMax: 4.45, 
    lonMin: -74.30, lonMax: -74.10,
    zona: 'Rural'
  },
  'Kennedy': { 
    latMin: 4.58, latMax: 4.68, 
    lonMin: -74.20, lonMax: -74.10,
    zona: 'Suroccidente'
  },
  'Fontibón': { 
    latMin: 4.68, latMax: 4.75, 
    lonMin: -74.20, lonMax: -74.10,
    zona: 'Occidente'
  },
  'Engativá': { 
    latMin: 4.68, latMax: 4.75, 
    lonMin: -74.15, lonMax: -74.05,
    zona: 'Occidente'
  },
  'Suba': { 
    latMin: 4.72, latMax: 4.80, 
    lonMin: -74.15, lonMax: -74.05,
    zona: 'Norte'
  },
  'Barrios Unidos': { 
    latMin: 4.65, latMax: 4.72, 
    lonMin: -74.10, lonMax: -74.00,
    zona: 'Norte'
  },
  'Teusaquillo': { 
    latMin: 4.62, latMax: 4.68, 
    lonMin: -74.10, lonMax: -74.00,
    zona: 'Centro'
  },
  'Los Mártires': { 
    latMin: 4.60, latMax: 4.65, 
    lonMin: -74.12, lonMax: -74.05,
    zona: 'Centro'
  },
  'Antonio Nariño': { 
    latMin: 4.55, latMax: 4.62, 
    lonMin: -74.12, lonMax: -74.05,
    zona: 'Centro-Sur'
  },
  'Puente Aranda': { 
    latMin: 4.58, latMax: 4.65, 
    lonMin: -74.15, lonMax: -74.08,
    zona: 'Centro-Occidente'
  },
  'La Candelaria': { 
    latMin: 4.58, latMax: 4.62, 
    lonMin: -74.10, lonMax: -74.05,
    zona: 'Centro'
  },
  'Rafael Uribe Uribe': { 
    latMin: 4.55, latMax: 4.62, 
    lonMin: -74.15, lonMax: -74.08,
    zona: 'Sur'
  }
};

/**
 * Determina la localidad de Bogotá basada en coordenadas
 * @param {number} lat - Latitud
 * @param {number} lon - Longitud
 * @returns {string} - Nombre de la localidad o 'Desconocida'
 */
function determinarLocalidad(lat, lon) {
  // Validar que las coordenadas estén en el rango aproximado de Bogotá
  if (lat < 4.0 || lat > 5.0 || lon < -74.5 || lon > -73.9) {
    return 'Fuera de Bogotá';
  }

  // Buscar en qué localidad cae el punto
  for (const [nombreLocalidad, rango] of Object.entries(LOCALIDADES_BOGOTA)) {
    if (
      lat >= rango.latMin && lat <= rango.latMax &&
      lon >= rango.lonMin && lon <= rango.lonMax
    ) {
      return nombreLocalidad;
    }
  }

  // Si no se encuentra, determinar por proximidad al centro
  const centroLat = 4.6097; // Centro de Bogotá
  const centroLon = -74.0817;
  
  // Calcular distancia al centro y asignar a la localidad más cercana
  let minDistance = Infinity;
  let localidadMasCercana = 'Desconocida';
  
  for (const [nombreLocalidad, rango] of Object.entries(LOCALIDADES_BOGOTA)) {
    const centroLocalidadLat = (rango.latMin + rango.latMax) / 2;
    const centroLocalidadLon = (rango.lonMin + rango.lonMax) / 2;
    
    const distance = Math.sqrt(
      Math.pow(lat - centroLocalidadLat, 2) + 
      Math.pow(lon - centroLocalidadLon, 2)
    );
    
    if (distance < minDistance) {
      minDistance = distance;
      localidadMasCercana = nombreLocalidad;
    }
  }
  
  return localidadMasCercana;
}

/**
 * Agrupa ubicaciones por localidad
 * @param {Array} locations - Array de ubicaciones con lat, lon
 * @returns {Object} - Objeto con localidades como keys y arrays de ubicaciones como values
 */
function agruparPorLocalidad(locations) {
  const gruposPorLocalidad = {};
  
  locations.forEach(location => {
    const localidad = determinarLocalidad(location.lat, location.lon);
    
    if (!gruposPorLocalidad[localidad]) {
      gruposPorLocalidad[localidad] = [];
    }
    
    gruposPorLocalidad[localidad].push({
      ...location,
      localidad: localidad
    });
  });
  
  return gruposPorLocalidad;
}

/**
 * Obtiene estadísticas de localidades
 * @param {Object} gruposPorLocalidad - Grupos de ubicaciones por localidad
 * @returns {Array} - Array con estadísticas de cada localidad
 */
function obtenerEstadisticasLocalidades(gruposPorLocalidad) {
  const estadisticas = [];
  
  for (const [localidad, ubicaciones] of Object.entries(gruposPorLocalidad)) {
    const pesoTotal = ubicaciones.reduce((sum, loc) => sum + (loc.peso || 0), 0);
    const cantidad = ubicaciones.length;
    
    // Calcular centroide de la localidad
    const latPromedio = ubicaciones.reduce((sum, loc) => sum + loc.lat, 0) / cantidad;
    const lonPromedio = ubicaciones.reduce((sum, loc) => sum + loc.lon, 0) / cantidad;
    
    estadisticas.push({
      localidad: localidad,
      cantidad: cantidad,
      pesoTotal: pesoTotal,
      latPromedio: latPromedio,
      lonPromedio: lonPromedio,
      zona: LOCALIDADES_BOGOTA[localidad]?.zona || 'Desconocida'
    });
  }
  
  // Ordenar por cantidad descendente
  return estadisticas.sort((a, b) => b.cantidad - a.cantidad);
}

module.exports = {
  determinarLocalidad,
  agruparPorLocalidad,
  obtenerEstadisticasLocalidades,
  LOCALIDADES_BOGOTA
};

