#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🎯 RECONECTA - Sistema VRP para Proyecto de Grado');
console.log('================================================\n');

// Verificar que todos los archivos necesarios existen
const requiredFiles = [
    'server.js',
    'package.json',
    'public/index.html',
    'ejemplo_datos.csv'
];

console.log('📁 Verificando archivos del proyecto...');
let allFilesExist = true;

requiredFiles.forEach(file => {
    if (fs.existsSync(file)) {
        console.log(`✅ ${file} - OK`);
    } else {
        console.log(`❌ ${file} - FALTANTE`);
        allFilesExist = false;
    }
});

if (!allFilesExist) {
    console.log('\n❌ Algunos archivos necesarios no se encontraron.');
    process.exit(1);
}

console.log('\n🚀 Instrucciones para ejecutar la aplicación:');
console.log('==========================================');
console.log('1. El servidor ya está ejecutándose en segundo plano');
console.log('2. Abre tu navegador web');
console.log('3. Ve a: http://localhost:3000');
console.log('4. Sube el archivo "ejemplo_datos.csv" para probar');
console.log('5. Configura la capacidad del vehículo (ej: 1000 kg)');
console.log('6. Haz clic en "Calcular Rutas Optimizadas"');
console.log('7. Observa las rutas en el mapa interactivo');

console.log('\n📊 Características del sistema:');
console.log('============================');
console.log('• Subida de archivos CSV con drag & drop');
console.log('• Base de datos SQLite para almacenamiento');
console.log('• Algoritmo VRP (Vehicle Routing Problem)');
console.log('• Geocodificación automática de direcciones');
console.log('• Visualización de rutas en mapa interactivo');
console.log('• Interfaz responsive y moderna');

console.log('\n🎓 Para tu proyecto de grado:');
console.log('============================');
console.log('• Demuestra optimización matemática');
console.log('• Aplicación práctica en sostenibilidad');
console.log('• Desarrollo web full-stack');
console.log('• Visualización de datos geográficos');
console.log('• Gestión de bases de datos');

console.log('\n✨ ¡Tu aplicativo está listo para usar!');
console.log('=====================================');
