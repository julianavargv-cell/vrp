#!/usr/bin/env node

const fs = require('fs');
const FormData = require('form-data');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

async function testUpload() {
    console.log('🧪 Probando subida de archivo CSV...');
    
    try {
        const form = new FormData();
        form.append('csvFile', fs.createReadStream('ejemplo_datos.csv'));
        
        const response = await fetch('http://localhost:3000/upload', {
            method: 'POST',
            body: form
        });
        
        const result = await response.json();
        
        if (result.error) {
            console.log('❌ Error:', result.error);
        } else {
            console.log('✅ Archivo procesado exitosamente');
            console.log('📊 Registros procesados:', result.recordsProcessed);
            
            // Verificar datos cargados
            const dataResponse = await fetch('http://localhost:3000/api/data');
            const data = await dataResponse.json();
            
            console.log('📍 Ubicaciones con coordenadas:', data.length);
            
            if (data.length > 0) {
                console.log('🎯 Primeras ubicaciones:');
                data.slice(0, 3).forEach((location, index) => {
                    console.log(`  ${index + 1}. ${location.razon_social}`);
                    console.log(`     Dirección: ${location.direccion}`);
                    console.log(`     Coordenadas: ${location.lat}, ${location.lon}`);
                    console.log(`     Peso: ${location.peso} kg`);
                    console.log('');
                });
            }
        }
    } catch (error) {
        console.log('❌ Error en la prueba:', error.message);
    }
}

testUpload();
