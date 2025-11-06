# RECONECTA - Sistema de Optimización de Rutas VRP

## Descripción del Proyecto

Este es un aplicativo web desarrollado para el proyecto de grado de Ingeniería Industrial que implementa un sistema de optimización de rutas para la recolección de residuos electrónicos utilizando el algoritmo VRP (Vehicle Routing Problem).

## Características Principales

- **Subida de archivos CSV**: Interfaz intuitiva para cargar datos de residuos
- **Base de datos SQLite**: Almacenamiento eficiente de los datos procesados
- **Algoritmo VRP**: Optimización de rutas considerando capacidades de vehículos
- **Visualización en mapa**: Interfaz interactiva con Leaflet para mostrar rutas optimizadas
- **Geocodificación automática**: Conversión de direcciones a coordenadas GPS

## Estructura del Proyecto

```
proyecto_de_grado_3/
├── server.js              # Servidor principal Node.js
├── package.json           # Dependencias del proyecto
├── public/
│   └── index.html         # Interfaz web principal
├── uploads/               # Directorio para archivos temporales
└── reconecta.db           # Base de datos SQLite (se crea automáticamente)
```

## Instalación y Configuración

### Prerrequisitos
- Node.js (versión 14 o superior)
- npm (Node Package Manager)

### Pasos de Instalación

1. **Instalar dependencias**:
   ```bash
   npm install
   ```

2. **Ejecutar la aplicación**:
   ```bash
   npm start
   ```
   
   Para desarrollo con recarga automática:
   ```bash
   npm run dev
   ```

3. **Acceder a la aplicación**:
   Abrir navegador en `http://localhost:3000`

## Uso de la Aplicación

### 1. Subir Archivo CSV
- Arrastra y suelta un archivo CSV o haz clic para seleccionar
- El archivo debe tener el formato específico de RECONECTA
- La aplicación procesará automáticamente los datos y los geocodificará

### 2. Configurar Parámetros VRP
- Establece la capacidad del vehículo en kilogramos
- Por defecto: 1000 kg (configurable entre 100-5000 kg)

### 3. Calcular Rutas Optimizadas
- Haz clic en "Calcular Rutas Optimizadas"
- El algoritmo VRP procesará los datos y generará rutas eficientes
- Las rutas se mostrarán en el mapa con colores diferentes

### 4. Visualizar Resultados
- Cada ruta se muestra con un color único
- Los números indican el orden de visita
- El círculo rojo marca el depósito (punto de inicio/fin)
- Información detallada disponible al hacer clic en cada punto

## Formato del Archivo CSV

El archivo CSV debe contener las siguientes columnas:
- Categoría
- Subcategoria
- APLICA EN LAS METAS ACTUALES
- Fecha
- Manifiesto
- Nombre de Residuo
- Peso Disposición Final (kg)
- Canal o Mecanismo de recolección
- Tipo de Gestión (proceso)
- certificado
- Gestor
- Centro de acopio
- Razón social del generador
- Nit
- Responsable del envío
- Correo
- Dirección
- Departamento
- Ciudad

## Algoritmo VRP Implementado

El sistema utiliza una versión simplificada del algoritmo Nearest Neighbor con las siguientes características:

- **Restricción de capacidad**: Cada vehículo tiene una capacidad máxima
- **Optimización de distancia**: Minimiza la distancia total recorrida
- **Múltiples vehículos**: Genera rutas para múltiples vehículos según sea necesario
- **Depósito central**: Todas las rutas inician y terminan en el mismo punto

## Tecnologías Utilizadas

### Backend
- **Node.js**: Runtime de JavaScript
- **Express.js**: Framework web
- **SQLite3**: Base de datos ligera
- **Multer**: Manejo de archivos
- **csv-parser**: Procesamiento de archivos CSV
- **node-geocoder**: Geocodificación de direcciones

### Frontend
- **HTML5/CSS3**: Estructura y estilos
- **JavaScript (ES6+)**: Lógica del cliente
- **Leaflet**: Mapas interactivos
- **Font Awesome**: Iconos
- **CSS Grid/Flexbox**: Diseño responsive

## API Endpoints

### POST /upload
Sube y procesa un archivo CSV
- **Body**: FormData con archivo CSV
- **Response**: JSON con número de registros procesados

### GET /api/data
Obtiene todos los datos de residuos con coordenadas
- **Response**: Array de objetos con ubicaciones

### POST /api/calculate-routes
Calcula rutas optimizadas usando VRP
- **Body**: `{ vehicleCapacity: number }`
- **Response**: Objeto con rutas calculadas y estadísticas

## Características Técnicas

- **Geocodificación**: Conversión automática de direcciones a coordenadas GPS
- **Validación de datos**: Verificación de formato y contenido de archivos
- **Manejo de errores**: Gestión robusta de errores con mensajes informativos
- **Interfaz responsive**: Adaptable a diferentes tamaños de pantalla
- **Optimización de rendimiento**: Procesamiento eficiente de grandes volúmenes de datos

## Consideraciones para el Proyecto de Grado

Este sistema demuestra la aplicación de:
- **Optimización matemática** (algoritmo VRP)
- **Gestión de bases de datos** (SQLite)
- **Desarrollo web full-stack** (Node.js + Frontend)
- **Visualización de datos** (mapas interactivos)
- **Procesamiento de archivos** (CSV parsing)
- **Geocodificación** (conversión de direcciones)

## Limitaciones y Mejoras Futuras

### Limitaciones Actuales
- Algoritmo VRP simplificado (Nearest Neighbor)
- Geocodificación básica (puede fallar con direcciones complejas)
- Una sola capacidad de vehículo por cálculo

### Posibles Mejoras
- Implementar algoritmos VRP más avanzados (Genetic Algorithm, Simulated Annealing)
- Integrar múltiples capacidades de vehículos
- Agregar restricciones de tiempo (VRPTW)
- Implementar análisis de costos
- Agregar exportación de rutas a diferentes formatos

## Soporte y Contacto

Para consultas sobre el proyecto o reportar problemas, contactar a:
- **Estudiante**: Juliana Vargas
- **Programa**: Ingeniería Industrial
- **Proyecto**: Optimización de Rutas para Recolección de Residuos

---

**Nota**: Este proyecto es parte del trabajo de grado para optar al título de Ingeniera Industrial y demuestra la aplicación de conceptos de optimización, programación y gestión de datos en un contexto real de sostenibilidad ambiental.
