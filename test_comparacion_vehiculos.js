const http = require('http');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Configuración
const PORT = 3000;
const DB_PATH = path.join(__dirname, 'reconecta.db');

console.log('🧪 PRUEBA: Comparación 1 vehículo vs 2 vehículos');
console.log('='.repeat(60));

// Crear datos de prueba en la base de datos
const db = new sqlite3.Database(DB_PATH);

// Limpiar datos de prueba anteriores
db.run('DELETE FROM residuos WHERE direccion LIKE "TEST_%"', (err) => {
  if (err) console.error('Error limpiando:', err);
  
  // Calcular peso total
  const testLocations = [
    { lat: 4.6097, lon: -74.0817, peso: 500, direccion: 'TEST_Calle 100 # 50-30', ciudad: 'BOGOTA, D. C.' },
    { lat: 4.6533, lon: -74.0836, peso: 300, direccion: 'TEST_Calle 80 # 40-20', ciudad: 'BOGOTA, D. C.' },
    { lat: 4.7110, lon: -74.0721, peso: 800, direccion: 'TEST_Calle 70 # 30-10', ciudad: 'BOGOTA, D. C.' },
    { lat: 4.6286, lon: -74.0640, peso: 400, direccion: 'TEST_Calle 60 # 20-50', ciudad: 'BOGOTA, D. C.' },
    { lat: 4.6700, lon: -74.0500, peso: 600, direccion: 'TEST_Calle 50 # 10-40', ciudad: 'BOGOTA, D. C.' },
    { lat: 4.6900, lon: -74.0900, peso: 700, direccion: 'TEST_Calle 40 # 5-30', ciudad: 'BOGOTA, D. C.' },
    { lat: 4.6500, lon: -74.0700, peso: 450, direccion: 'TEST_Calle 30 # 15-20', ciudad: 'BOGOTA, D. C.' },
    { lat: 4.6800, lon: -74.0600, peso: 550, direccion: 'TEST_Calle 20 # 25-10', ciudad: 'BOGOTA, D. C.' },
    { lat: 4.6200, lon: -74.0800, peso: 600, direccion: 'TEST_Calle 15 # 35-25', ciudad: 'BOGOTA, D. C.' },
    { lat: 4.6400, lon: -74.0700, peso: 500, direccion: 'TEST_Calle 12 # 45-15', ciudad: 'BOGOTA, D. C.' },
    { lat: 4.6600, lon: -74.0900, peso: 750, direccion: 'TEST_Calle 10 # 55-35', ciudad: 'BOGOTA, D. C.' },
    { lat: 4.7000, lon: -74.0800, peso: 650, direccion: 'TEST_Calle 8 # 65-45', ciudad: 'BOGOTA, D. C.' },
    { lat: 4.6300, lon: -74.0600, peso: 550, direccion: 'TEST_Calle 6 # 75-55', ciudad: 'BOGOTA, D. C.' },
    { lat: 4.6500, lon: -74.0500, peso: 600, direccion: 'TEST_Calle 4 # 85-65', ciudad: 'BOGOTA, D. C.' },
    { lat: 4.6800, lon: -74.0400, peso: 700, direccion: 'TEST_Calle 2 # 95-75', ciudad: 'BOGOTA, D. C.' },
    { lat: 4.7100, lon: -74.0300, peso: 650, direccion: 'TEST_Calle 1 # 105-85', ciudad: 'BOGOTA, D. C.' }
  ];
  
  const pesoTotal = testLocations.reduce((sum, loc) => sum + loc.peso, 0);
  
  // Crear subida de prueba
  db.run(`INSERT INTO historial_subidas (nombre_archivo, peso_total) 
          VALUES ('test_comparacion.csv', ${pesoTotal})`, function(err) {
    if (err) {
      console.error('Error creando subida:', err);
      return;
    }
    
    const subidaId = this.lastID;
    console.log(`✅ Subida de prueba creada: ID ${subidaId}\n`);
    
    // Insertar ubicaciones de prueba (más ubicaciones para que se necesiten más días)
    const testLocations = [
      { lat: 4.6097, lon: -74.0817, peso: 500, direccion: 'TEST_Calle 100 # 50-30', ciudad: 'BOGOTA, D. C.' },
      { lat: 4.6533, lon: -74.0836, peso: 300, direccion: 'TEST_Calle 80 # 40-20', ciudad: 'BOGOTA, D. C.' },
      { lat: 4.7110, lon: -74.0721, peso: 800, direccion: 'TEST_Calle 70 # 30-10', ciudad: 'BOGOTA, D. C.' },
      { lat: 4.6286, lon: -74.0640, peso: 400, direccion: 'TEST_Calle 60 # 20-50', ciudad: 'BOGOTA, D. C.' },
      { lat: 4.6700, lon: -74.0500, peso: 600, direccion: 'TEST_Calle 50 # 10-40', ciudad: 'BOGOTA, D. C.' },
      { lat: 4.6900, lon: -74.0900, peso: 700, direccion: 'TEST_Calle 40 # 5-30', ciudad: 'BOGOTA, D. C.' },
      { lat: 4.6500, lon: -74.0700, peso: 450, direccion: 'TEST_Calle 30 # 15-20', ciudad: 'BOGOTA, D. C.' },
      { lat: 4.6800, lon: -74.0600, peso: 550, direccion: 'TEST_Calle 20 # 25-10', ciudad: 'BOGOTA, D. C.' },
      { lat: 4.6200, lon: -74.0800, peso: 600, direccion: 'TEST_Calle 15 # 35-25', ciudad: 'BOGOTA, D. C.' },
      { lat: 4.6400, lon: -74.0700, peso: 500, direccion: 'TEST_Calle 12 # 45-15', ciudad: 'BOGOTA, D. C.' },
      { lat: 4.6600, lon: -74.0900, peso: 750, direccion: 'TEST_Calle 10 # 55-35', ciudad: 'BOGOTA, D. C.' },
      { lat: 4.7000, lon: -74.0800, peso: 650, direccion: 'TEST_Calle 8 # 65-45', ciudad: 'BOGOTA, D. C.' },
      { lat: 4.6300, lon: -74.0600, peso: 550, direccion: 'TEST_Calle 6 # 75-55', ciudad: 'BOGOTA, D. C.' },
      { lat: 4.6500, lon: -74.0500, peso: 600, direccion: 'TEST_Calle 4 # 85-65', ciudad: 'BOGOTA, D. C.' },
      { lat: 4.6800, lon: -74.0400, peso: 700, direccion: 'TEST_Calle 2 # 95-75', ciudad: 'BOGOTA, D. C.' },
      { lat: 4.7100, lon: -74.0300, peso: 650, direccion: 'TEST_Calle 1 # 105-85', ciudad: 'BOGOTA, D. C.' }
    ];
    
    const pesoTotal = testLocations.reduce((sum, loc) => sum + loc.peso, 0);
    
    const stmt = db.prepare(`INSERT INTO residuos 
      (subida_id, direccion, ciudad, peso_kg, latitud, longitud, procesado) 
      VALUES (?, ?, ?, ?, ?, ?, 0)`);
    
    testLocations.forEach(loc => {
      stmt.run(subidaId, loc.direccion, loc.ciudad, loc.peso, loc.lat, loc.lon);
    });
    
    stmt.finalize();
    
    console.log('✅ Ubicaciones de prueba insertadas\n');
    
    // Función para hacer petición al servidor
    function calcularRutas(vehiculos, casoNum) {
      return new Promise((resolve, reject) => {
        const postData = JSON.stringify({
          vehicleType: 'personalizado',
          subidaId: subidaId,
          customVehicles: vehiculos
        });
        
        const options = {
          hostname: 'localhost',
          port: PORT,
          path: '/api/calculate-routes',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
          }
        };
        
        const req = http.request(options, (res) => {
          let data = '';
          
          res.on('data', (chunk) => {
            data += chunk;
          });
          
          res.on('end', () => {
            try {
              const result = JSON.parse(data);
              resolve(result);
            } catch (e) {
              reject(new Error('Error parseando respuesta: ' + e.message));
            }
          });
        });
        
        req.on('error', (e) => {
          reject(e);
        });
        
        req.write(postData);
        req.end();
      });
    }
    
    // CASO 1: 1 vehículo
    console.log('📊 CASO 1: 1 VEHÍCULO (Camión 5500kg)');
    console.log('-'.repeat(60));
    
    const vehicles1 = [
      { id: 'camion1', name: 'Camión 1', type: 'camion', capacity: 5500, costPerTrip: 350000 }
    ];
    
    calcularRutas(vehicles1, 1)
      .then(result1 => {
        const analysis1 = result1.analysis || {};
        const dias1 = analysis1.totalWorkingDays || 0;
        
        console.log(`\n📊 Resultados CASO 1:`);
        console.log(`   Rutas totales: ${result1.routes?.length || 0}`);
        console.log(`   Días de trabajo: ${dias1}`);
        console.log(`   Tiempo total: ${analysis1.totalTime?.toFixed(1) || 0} min`);
        console.log(`   Distancia total: ${analysis1.totalDistance?.toFixed(2) || 0} km`);
        
        // Verificar distribución de rutas por vehículo
        if (result1.routes && result1.routes.length > 0) {
          const routesByVehicle = {};
          result1.routes.forEach(route => {
            const vehicleName = route.vehicleName || route.vehicleType || 'desconocido';
            if (!routesByVehicle[vehicleName]) {
              routesByVehicle[vehicleName] = {
                count: 0,
                totalTime: 0,
                totalWeight: 0
              };
            }
            routesByVehicle[vehicleName].count++;
            routesByVehicle[vehicleName].totalTime += route.totalTime || 0;
            routesByVehicle[vehicleName].totalWeight += route.totalWeight || 0;
          });
          
          console.log(`\n   📋 Distribución de rutas por vehículo:`);
          Object.keys(routesByVehicle).forEach(vehicleName => {
            const stats = routesByVehicle[vehicleName];
            const dias = Math.ceil(stats.totalTime / 540);
            console.log(`     ${vehicleName}: ${stats.count} ruta(s), ${stats.totalTime.toFixed(1)} min, ${stats.totalWeight.toFixed(1)} kg, ${dias} día(s)`);
          });
        }
        
        if (analysis1.vehicleTypeDetails) {
          Object.keys(analysis1.vehicleTypeDetails).forEach(tipo => {
            const details = analysis1.vehicleTypeDetails[tipo];
            console.log(`\n   Tipo ${tipo}:`);
            console.log(`     Vehículos: ${details.cantidadVehiculos}`);
            console.log(`     Días promedio por vehículo: ${details.diasPromedioPorVehiculo?.toFixed(1) || 0}`);
            console.log(`     Ocupación promedio: ${details.ocupacionPromedioDiaria?.toFixed(1) || 0}%`);
          });
        }
        
        // CASO 2: 2 vehículos
        console.log('\n\n📊 CASO 2: 2 VEHÍCULOS (2 Camiones de 5500kg cada uno)');
        console.log('-'.repeat(60));
        
        const vehicles2 = [
          { id: 'camion1', name: 'Camión 1', type: 'camion', capacity: 5500, costPerTrip: 350000 },
          { id: 'camion2', name: 'Camión 2', type: 'camion', capacity: 5500, costPerTrip: 350000 }
        ];
        
        return calcularRutas(vehicles2, 2)
          .then(result2 => {
            const analysis2 = result2.analysis || {};
            const dias2 = analysis2.totalWorkingDays || 0;
            
            console.log(`\n📊 Resultados CASO 2:`);
            console.log(`   Rutas totales: ${result2.routes?.length || 0}`);
            console.log(`   Días de trabajo: ${dias2}`);
            console.log(`   Tiempo total: ${analysis2.totalTime?.toFixed(1) || 0} min`);
            console.log(`   Distancia total: ${analysis2.totalDistance?.toFixed(2) || 0} km`);
            
            // Verificar distribución de rutas por vehículo
            if (result2.routes && result2.routes.length > 0) {
              const routesByVehicle = {};
              result2.routes.forEach(route => {
                const vehicleName = route.vehicleName || route.vehicleType || 'desconocido';
                if (!routesByVehicle[vehicleName]) {
                  routesByVehicle[vehicleName] = {
                    count: 0,
                    totalTime: 0,
                    totalWeight: 0
                  };
                }
                routesByVehicle[vehicleName].count++;
                routesByVehicle[vehicleName].totalTime += route.totalTime || 0;
                routesByVehicle[vehicleName].totalWeight += route.totalWeight || 0;
              });
              
              console.log(`\n   📋 Distribución de rutas por vehículo:`);
              Object.keys(routesByVehicle).forEach(vehicleName => {
                const stats = routesByVehicle[vehicleName];
                const dias = Math.ceil(stats.totalTime / 540);
                console.log(`     ${vehicleName}: ${stats.count} ruta(s), ${stats.totalTime.toFixed(1)} min, ${stats.totalWeight.toFixed(1)} kg, ${dias} día(s)`);
              });
            }
            
            if (analysis2.vehicleTypeDetails) {
              Object.keys(analysis2.vehicleTypeDetails).forEach(tipo => {
                const details = analysis2.vehicleTypeDetails[tipo];
                console.log(`\n   Tipo ${tipo}:`);
                console.log(`     Vehículos: ${details.cantidadVehiculos}`);
                console.log(`     Días promedio por vehículo: ${details.diasPromedioPorVehiculo?.toFixed(1) || 0}`);
                console.log(`     Ocupación promedio: ${details.ocupacionPromedioDiaria?.toFixed(1) || 0}%`);
                
                if (details.vehicles && details.vehicles.length > 0) {
                  console.log(`     Vehículos individuales:`);
                  details.vehicles.forEach((v, idx) => {
                    console.log(`       ${v.name}: ${v.routes} rutas, ${v.days} días, ${v.occupancy.toFixed(1)}% ocupación`);
                  });
                }
              });
            }
            
            // COMPARACIÓN
            console.log('\n\n' + '='.repeat(60));
            console.log('📊 COMPARACIÓN DE RESULTADOS');
            console.log('='.repeat(60));
            
            console.log(`\n1 Vehículo:`);
            console.log(`   Días: ${dias1}`);
            console.log(`   Rutas: ${result1.routes?.length || 0}`);
            console.log(`   Tiempo: ${analysis1.totalTime?.toFixed(1) || 0} min`);
            
            console.log(`\n2 Vehículos:`);
            console.log(`   Días: ${dias2}`);
            console.log(`   Rutas: ${result2.routes?.length || 0}`);
            console.log(`   Tiempo: ${analysis2.totalTime?.toFixed(1) || 0} min`);
            
            console.log(`\nDiferencia en días: ${Math.abs(dias1 - dias2)}`);
            
            if (dias1 !== dias2) {
              console.log('\n✅ CONFIRMADO: Los resultados SON DIFERENTES');
              if (dias2 < dias1) {
                console.log(`   ✅ Con 2 vehículos se reducen los días de ${dias1} a ${dias2} (reducción del ${((dias1 - dias2) / dias1 * 100).toFixed(1)}%)`);
              } else {
                console.log(`   ⚠️  Con 2 vehículos aumentan los días (esto puede ser por distribución de carga)`);
              }
            } else {
              console.log('\n⚠️  ADVERTENCIA: Los días son iguales');
              console.log('   Esto podría indicar que el sistema no está considerando vehículos en paralelo correctamente');
            }
            
            // Verificar distribución de rutas
            if (analysis2.vehicleTypeDetails && analysis2.vehicleTypeDetails.camion) {
              const camionDetails = analysis2.vehicleTypeDetails.camion;
              if (camionDetails.vehicles && camionDetails.vehicles.length === 2) {
                console.log('\n📋 Distribución de rutas entre vehículos:');
                camionDetails.vehicles.forEach((v, idx) => {
                  console.log(`   Vehículo ${idx + 1} (${v.name}): ${v.routes} rutas, ${v.days} días, ${v.occupancy.toFixed(1)}% ocupación`);
                });
              }
            }
            
            console.log('\n' + '='.repeat(60));
            
            // Limpiar
            db.close();
            process.exit(0);
          });
      })
      .catch(error => {
        console.error('❌ Error:', error.message);
        db.close();
        process.exit(1);
      });
  });
});

