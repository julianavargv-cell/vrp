// Módulo para determinar localidades de Bogotá basado en coordenadas
// Bogotá tiene 20 localidades administrativas

// Definición aproximada de las 20 localidades de Bogotá con coordenadas centrales
// y rangos aproximados (basado en datos geográficos de Bogotá)
const LOCALIDADES_BOGOTA = {
  'Usaquén': {
    centro: { lat: 4.698, lon: -74.065 },
    bounds: { minLat: 4.65, maxLat: 4.75, minLon: -74.10, maxLon: -74.03 }
  },
  'Chapinero': {
    centro: { lat: 4.648, lon: -74.063 },
    bounds: { minLat: 4.62, maxLat: 4.68, minLon: -74.08, maxLon: -74.04 }
  },
  'Santa Fe': {
    centro: { lat: 4.610, lon: -74.082 },
    bounds: { minLat: 4.60, maxLat: 4.62, minLon: -74.09, maxLon: -74.07 }
  },
  'San Cristóbal': {
    centro: { lat: 4.560, lon: -74.085 },
    bounds: { minLat: 4.52, maxLat: 4.60, minLon: -74.10, maxLon: -74.05 }
  },
  'Usme': {
    centro: { lat: 4.500, lon: -74.110 },
    bounds: { minLat: 4.45, maxLat: 4.55, minLon: -74.15, maxLon: -74.08 }
  },
  'Tunjuelito': {
    centro: { lat: 4.580, lon: -74.125 },
    bounds: { minLat: 4.55, maxLat: 4.61, minLon: -74.14, maxLon: -74.11 }
  },
  'Bosa': {
    centro: { lat: 4.615, lon: -74.188 },
    bounds: { minLat: 4.58, maxLat: 4.65, minLon: -74.22, maxLon: -74.15 }
  },
  'Kennedy': {
    centro: { lat: 4.640, lon: -74.150 },
    bounds: { minLat: 4.60, maxLat: 4.68, minLon: -74.18, maxLon: -74.12 }
  },
  'Fontibón': {
    centro: { lat: 4.680, lon: -74.142 },
    bounds: { minLat: 4.65, maxLat: 4.72, minLon: -74.16, maxLon: -74.12 }
  },
  'Engativá': {
    centro: { lat: 4.700, lon: -74.110 },
    bounds: { minLat: 4.67, maxLat: 4.73, minLon: -74.13, maxLon: -74.09 }
  },
  'Suba': {
    centro: { lat: 4.750, lon: -74.085 },
    bounds: { minLat: 4.70, maxLat: 4.80, minLon: -74.11, maxLon: -74.06 }
  },
  'Barrios Unidos': {
    centro: { lat: 4.670, lon: -74.088 },
    bounds: { minLat: 4.64, maxLat: 4.70, minLon: -74.10, maxLon: -74.07 }
  },
  'Teusaquillo': {
    centro: { lat: 4.640, lon: -74.078 },
    bounds: { minLat: 4.62, maxLat: 4.66, minLon: -74.085, maxLon: -74.07 }
  },
  'Los Mártires': {
    centro: { lat: 4.605, lon: -74.088 },
    bounds: { minLat: 4.59, maxLat: 4.62, minLon: -74.095, maxLon: -74.08 }
  },
  'Antonio Nariño': {
    centro: { lat: 4.590, lon: -74.095 },
    bounds: { minLat: 4.57, maxLat: 4.61, minLon: -74.10, maxLon: -74.09 }
  },
  'Puente Aranda': {
    centro: { lat: 4.625, lon: -74.105 },
    bounds: { minLat: 4.60, maxLat: 4.65, minLon: -74.115, maxLon: -74.095 }
  },
  'La Candelaria': {
    centro: { lat: 4.595, lon: -74.076 },
    bounds: { minLat: 4.58, maxLat: 4.61, minLon: -74.082, maxLon: -74.07 }
  },
  'Rafael Uribe Uribe': {
    centro: { lat: 4.570, lon: -74.105 },
    bounds: { minLat: 4.54, maxLat: 4.60, minLon: -74.12, maxLon: -74.09 }
  },
  'Ciudad Bolívar': {
    centro: { lat: 4.520, lon: -74.140 },
    bounds: { minLat: 4.48, maxLat: 4.56, minLon: -74.16, maxLon: -74.12 }
  },
  'Sumapaz': {
    centro: { lat: 4.450, lon: -74.150 },
    bounds: { minLat: 4.30, maxLat: 4.50, minLon: -74.20, maxLon: -74.10 }
  }
};

// Función para determinar la localidad de una coordenada
function determinarLocalidad(lat, lon) {
  // Primero, verificar si está dentro de los bounds de alguna localidad
  for (const [nombre, datos] of Object.entries(LOCALIDADES_BOGOTA)) {
    const bounds = datos.bounds;
    if (lat >= bounds.minLat && lat <= bounds.maxLat &&
        lon >= bounds.minLon && lon <= bounds.maxLon) {
      return nombre;
    }
  }
  
  // Si no está en ningún bound, usar distancia al centro más cercano
  let localidadMasCercana = 'Usaquén';
  let distanciaMinima = Infinity;
  
  for (const [nombre, datos] of Object.entries(LOCALIDADES_BOGOTA)) {
    const centro = datos.centro;
    const distancia = calcularDistanciaHaversine(lat, lon, centro.lat, centro.lon);
    
    if (distancia < distanciaMinima) {
      distanciaMinima = distancia;
      localidadMasCercana = nombre;
    }
  }
  
  return localidadMasCercana;
}

// Calcular distancia Haversine
function calcularDistanciaHaversine(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radio de la Tierra en km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Agrupar ubicaciones por localidad
function agruparPorLocalidad(locations) {
  const grupos = {};
  
  for (const location of locations) {
    const localidad = determinarLocalidad(location.lat, location.lon);
    
    if (!grupos[localidad]) {
      grupos[localidad] = [];
    }
    
    grupos[localidad].push({
      ...location,
      localidad: localidad
    });
  }
  
  return grupos;
}

// Obtener estadísticas de localidades
function obtenerEstadisticasLocalidades(grupos) {
  const estadisticas = [];
  
  for (const [localidad, ubicaciones] of Object.entries(grupos)) {
    const pesoTotal = ubicaciones.reduce((sum, loc) => sum + (loc.peso || 0), 0);
    const cantidad = ubicaciones.length;
    
    estadisticas.push({
      localidad: localidad,
      cantidad: cantidad,
      pesoTotal: pesoTotal,
      pesoPromedio: pesoTotal / cantidad
    });
  }
  
  // Ordenar por cantidad descendente
  estadisticas.sort((a, b) => b.cantidad - a.cantidad);
  
  return estadisticas;
}

module.exports = {
  determinarLocalidad,
  agruparPorLocalidad,
  obtenerEstadisticasLocalidades,
  LOCALIDADES_BOGOTA
};

