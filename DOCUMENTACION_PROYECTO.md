# DOCUMENTACIÓN TÉCNICA DEL PROYECTO
## Sistema de Optimización de Rutas VRP para Recolección de Residuos Electrónicos

**Proyecto de Grado - Ingeniería Industrial**  
**Autor:** Juliana Vargas  
**Fecha:** 2025

---

## TABLA DE CONTENIDO

1. [Introducción](#1-introducción)
2. [Objetivos del Proyecto](#2-objetivos-del-proyecto)
3. [Arquitectura del Sistema](#3-arquitectura-del-sistema)
4. [Diagrama de Componentes](#4-diagrama-de-componentes)
5. [Diagrama de Secuencias](#5-diagrama-de-secuencias)
6. [Componentes Principales](#6-componentes-principales)
7. [Algoritmos VRP Implementados](#7-algoritmos-vrp-implementados)
8. [Funcionalidades del Sistema](#8-funcionalidades-del-sistema)
9. [Tecnologías Utilizadas](#9-tecnologías-utilizadas)
10. [Instalación y Configuración](#10-instalación-y-configuración)
11. [Manual de Uso](#11-manual-de-uso)
12. [Base de Datos](#12-base-de-datos)
13. [API REST](#13-api-rest)
14. [Conclusiones](#14-conclusiones)

---

## 1. INTRODUCCIÓN

Este proyecto implementa un sistema web de optimización de rutas para la recolección de residuos electrónicos utilizando algoritmos de VRP (Vehicle Routing Problem). El sistema permite gestionar múltiples vehículos, calcular rutas optimizadas considerando restricciones de capacidad y tiempo, y visualizar los resultados en un mapa interactivo.

### 1.1 Contexto del Problema

La recolección eficiente de residuos electrónicos requiere optimizar las rutas de múltiples vehículos considerando:
- Capacidades de carga de cada vehículo
- Restricciones de tiempo de trabajo
- Ubicaciones geográficas de los puntos de recogida
- Múltiples tipos de vehículos trabajando en paralelo
- Agrupación geográfica por localidades

### 1.2 Solución Propuesta

El sistema desarrollado resuelve el problema mediante:
- Algoritmos VRP profesionales (Savings Algorithm, Nearest Neighbor)
- Clustering geográfico por localidades de Bogotá
- Gestión de múltiples vehículos con capacidades personalizadas
- Visualización interactiva en mapas
- Exportación de planes de rutas en formato CSV

---

## 2. OBJETIVOS DEL PROYECTO

### 2.1 Objetivo General

Desarrollar un sistema web de optimización de rutas VRP para la recolección eficiente de residuos electrónicos, considerando múltiples vehículos, restricciones de capacidad y agrupación geográfica.

### 2.2 Objetivos Específicos

1. Implementar algoritmos VRP que optimicen rutas considerando capacidades de vehículos
2. Desarrollar sistema de clustering geográfico por localidades
3. Crear interfaz web interactiva para visualización de rutas
4. Implementar gestión de múltiples vehículos con capacidades personalizadas
5. Generar planes de rutas exportables en formato CSV
6. Considerar vehículos trabajando en paralelo para cálculo de días de trabajo

---

## 3. ARQUITECTURA DEL SISTEMA

### 3.1 Arquitectura General

El sistema sigue una arquitectura cliente-servidor con las siguientes capas:

```
┌─────────────────────────────────────────────────────────┐
│                    CAPA DE PRESENTACIÓN                  │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Frontend (HTML/CSS/JavaScript)                  │  │
│  │  - Interfaz de usuario                           │  │
│  │  - Visualización de mapas (Leaflet)              │  │
│  │  - Gestión de vehículos                          │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                          ↕ HTTP/REST
┌─────────────────────────────────────────────────────────┐
│                    CAPA DE APLICACIÓN                    │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Backend (Node.js/Express)                      │  │
│  │  - API REST                                      │  │
│  │  - Procesamiento de archivos CSV                 │  │
│  │  - Algoritmos VRP                                │  │
│  │  - Geocodificación                               │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                          ↕ SQL
┌─────────────────────────────────────────────────────────┐
│                    CAPA DE DATOS                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Base de Datos (SQLite)                         │  │
│  │  - Tabla: residuos                               │  │
│  │  - Tabla: historial_subidas                      │  │
│  │  - Tabla: rutas_calculadas                       │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 3.2 Flujo de Datos

1. **Carga de Datos**: Usuario sube archivo CSV → Backend procesa → Almacena en BD
2. **Cálculo de Rutas**: Usuario solicita cálculo → Backend ejecuta VRP → Retorna rutas optimizadas
3. **Visualización**: Frontend recibe rutas → Renderiza en mapa → Muestra clusters
4. **Exportación**: Usuario solicita descarga → Backend genera CSV → Descarga archivo

---

## 4. DIAGRAMA DE COMPONENTES

```
┌─────────────────────────────────────────────────────────────────────┐
│                         SISTEMA VRP                                  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        │                           │                           │
        ▼                           ▼                           ▼
┌───────────────┐          ┌───────────────┐          ┌───────────────┐
│   FRONTEND    │          │    BACKEND    │          │  BASE DATOS   │
│               │          │               │          │               │
│ ┌───────────┐ │          │ ┌───────────┐ │          │ ┌───────────┐ │
│ │  Mapa     │ │◄─────────┤ │  API REST │ │◄─────────┤ │  SQLite   │ │
│ │  Leaflet  │ │          │ │  Express  │ │          │ │   DB      │ │
│ └───────────┘ │          │ └───────────┘ │          │ └───────────┘ │
│               │          │               │          │               │
│ ┌───────────┐ │          │ ┌───────────┐ │          │ ┌───────────┐ │
│ │ Gestión   │ │          │ │ Procesador│ │          │ │  Tabla:   │ │
│ │ Vehículos │ │          │ │    CSV    │ │          │ │ residuos  │ │
│ └───────────┘ │          │ └───────────┘ │          │ └───────────┘ │
│               │          │               │          │               │
│ ┌───────────┐ │          │ ┌───────────┐ │          │ ┌───────────┐ │
│ │ Visualiz. │ │          │ │ Algoritmos│ │          │ │  Tabla:   │ │
│ │  Rutas    │ │          │ │    VRP    │ │          │ │ historial │ │
│ └───────────┘ │          │ └───────────┘ │          │ └───────────┘ │
│               │          │               │          │               │
│               │          │ ┌───────────┐ │          │ ┌───────────┐ │
│               │          │ │ Clustering│ │          │ │  Tabla:   │ │
│               │          │ │ Geográfico│ │          │ │  rutas_   │ │
│               │          │ └───────────┘ │          │ │ calculadas│ │
│               │          │               │          │ └───────────┘ │
│               │          │ ┌───────────┐ │          │               │
│               │          │ │Geocodif.  │ │          │               │
│               │          │ └───────────┘ │          │               │
└───────────────┘          └───────────────┘          └───────────────┘
        │                           │
        └───────────────────────────┘
                    │
        ┌───────────┼───────────┐
        │           │           │
        ▼           ▼           ▼
┌───────────┐ ┌───────────┐ ┌───────────┐
│ Algoritmo │ │ Algoritmo │ │ Algoritmo │
│Profesional│ │  Híbrido  │ │Personaliz.│
│    VRP    │ │    VRP    │ │    VRP    │
└───────────┘ └───────────┘ └───────────┘
```

### 4.1 Descripción de Componentes

#### 4.1.1 Frontend
- **Mapa Leaflet**: Visualización interactiva de rutas y ubicaciones
- **Gestión de Vehículos**: Interfaz para configurar vehículos personalizados
- **Visualización de Rutas**: Renderizado de rutas optimizadas en el mapa
- **Clustering**: Agrupación visual de puntos de recogida

#### 4.1.2 Backend
- **API REST**: Endpoints para comunicación cliente-servidor
- **Procesador CSV**: Lectura y procesamiento de archivos CSV
- **Algoritmos VRP**: Tres implementaciones diferentes de VRP
- **Clustering Geográfico**: Agrupación por localidades de Bogotá
- **Geocodificación**: Conversión de direcciones a coordenadas

#### 4.1.3 Base de Datos
- **Tabla residuos**: Almacena información de residuos y ubicaciones
- **Tabla historial_subidas**: Registro de archivos procesados
- **Tabla rutas_calculadas**: Almacena rutas optimizadas y métricas

---

## 5. DIAGRAMA DE SECUENCIAS

### 5.1 Secuencia: Carga de Archivo CSV y Cálculo de Rutas

```
Usuario          Frontend          Backend           Base Datos      Algoritmo VRP
  │                 │                 │                  │                 │
  │───Subir CSV────►│                 │                  │                 │
  │                 │───POST /upload─►│                  │                 │
  │                 │                 │───Procesar CSV──►│                 │
  │                 │                 │                  │───INSERT───────►│
  │                 │                 │◄──Registros──────│                 │
  │                 │◄──Respuesta─────│                  │                 │
  │◄──Confirmación──│                 │                  │                 │
  │                 │                 │                  │                 │
  │───Calcular──────│                 │                  │                 │
  │    Rutas        │                 │                  │                 │
  │                 │───POST /api/────►│                  │                 │
  │                 │  calculate-routes│                  │                 │
  │                 │                 │───SELECT───────►│                 │
  │                 │                 │◄──Ubicaciones───│                 │
  │                 │                 │───Ejecutar──────┼────────────────►│
  │                 │                 │                 │                 │───Clustering───┐
  │                 │                 │                 │                 │◄───────────────┘
  │                 │                 │                 │                 │───Savings Alg.─┐
  │                 │                 │                 │                 │◄───────────────┘
  │                 │                 │                 │                 │───2-opt───────┐
  │                 │                 │                 │                 │◄───────────────┘
  │                 │                 │◄──Rutas─────────│                 │
  │                 │                 │───INSERT───────►│                 │
  │                 │◄──Rutas─────────│                  │                 │
  │◄──Visualización─│                 │                  │                 │
  │                 │                 │                  │                 │
```

### 5.2 Secuencia: Agrupación por Día con Vehículos en Paralelo

```
Usuario          Frontend          Backend           Base Datos      Algoritmo
  │                 │                 │                  │                 │
  │───Descargar────►│                 │                  │                 │
  │    Plan        │                 │                  │                 │
  │                 │───GET /api/────►│                  │                 │
  │                 │  download-     │                  │                 │
  │                 │  route-plan    │                  │                 │
  │                 │                 │───SELECT───────►│                 │
  │                 │                 │◄──Rutas JSON────│                 │
  │                 │                 │───SELECT───────►│                 │
  │                 │                 │◄──Vehículos─────│                 │
  │                 │                 │                 │                 │
  │                 │                 │───Agrupar───────┼────────────────►│
  │                 │                 │  por tipo       │                 │───Distribuir──┐
  │                 │                 │                 │                 │  en días      │
  │                 │                 │                 │                 │◄──────────────┘
  │                 │                 │                 │                 │
  │                 │                 │───Generar CSV───│                 │
  │                 │◄──CSV───────────│                  │                 │
  │◄──Descarga──────│                 │                  │                 │
  │                 │                 │                  │                 │
```

---

## 6. COMPONENTES PRINCIPALES

### 6.1 Backend (server.js)

#### 6.1.1 Configuración del Servidor
```javascript
- Express.js: Framework web
- SQLite3: Base de datos
- Multer: Manejo de archivos
- CORS: Habilitación de CORS
```

#### 6.1.2 Endpoints Principales

**POST /upload**
- Procesa archivos CSV
- Geocodifica direcciones
- Almacena en base de datos

**POST /api/calculate-routes**
- Ejecuta algoritmos VRP
- Retorna rutas optimizadas
- Guarda resultados en BD

**GET /api/data**
- Obtiene ubicaciones de residuos
- Filtra por subida_id

**GET /api/download-route-plan/:subidaId**
- Genera CSV con plan de rutas
- Agrupa por día considerando vehículos

**GET /api/route-plan-preview/:subidaId**
- Vista previa del plan de rutas
- Formato JSON simplificado

### 6.2 Algoritmos VRP

#### 6.2.1 ProfessionalVRPAlgorithm (professional-vrp.js)

**Características:**
- Savings Algorithm (Clark & Wright)
- Optimización 2-opt
- Distancia Haversine
- Clustering por localidades

**Flujo:**
1. Agrupa ubicaciones por localidad
2. Construye matriz de distancias por localidad
3. Aplica Savings Algorithm
4. Optimiza con 2-opt
5. Clasifica por tipo de vehículo

#### 6.2.2 HybridVRPAlgorithm (server.js)

**Características:**
- Algoritmo híbrido multi-vehículo
- Clasificación inteligente por peso
- Clustering geográfico
- Soporte para camión y moto

**Flujo:**
1. Clustering por localidades
2. Clasificación por tipo de vehículo
3. Creación de rutas por localidad
4. Optimización global

#### 6.2.3 CustomVRPAlgorithm (server.js)

**Características:**
- Vehículos personalizados
- Capacidades configurables
- Costos por viaje
- Clustering geográfico

**Flujo:**
1. Clustering por localidades
2. Clasificación por vehículo óptimo
3. Creación de rutas por tipo
4. Cálculo de métricas

### 6.3 Clustering Geográfico (bogota-localidades.js)

**Funcionalidad:**
- Determina localidad de Bogotá por coordenadas
- Agrupa ubicaciones por localidad
- Calcula estadísticas por localidad

**Algoritmo:**
1. Obtiene coordenadas (lat, lon)
2. Determina localidad mediante polígonos
3. Agrupa ubicaciones
4. Calcula métricas (peso total, cantidad)

### 6.4 Frontend (public/index.html)

#### 6.4.1 Componentes Principales

**Gestión de Archivos:**
- Carga de CSV mediante drag & drop
- Validación de formato
- Procesamiento asíncrono

**Gestión de Vehículos:**
- Añadir vehículos personalizados
- Editar capacidades y costos
- Almacenamiento en localStorage

**Visualización de Mapas:**
- Leaflet para renderizado
- Marcadores individuales
- Clusters dinámicos
- Rutas con colores

**Cálculo de Rutas:**
- Selección de algoritmo
- Indicadores de progreso
- Visualización de resultados
- Métricas y estadísticas

---

## 7. ALGORITMOS VRP IMPLEMENTADOS

### 7.1 Savings Algorithm (Clark & Wright)

**Objetivo:** Minimizar distancia total recorrida

**Algoritmo:**
```
1. Calcular savings s(i,j) = d(depot,i) + d(depot,j) - d(i,j)
2. Ordenar savings de mayor a menor
3. Construir rutas combinando arcos con mayor saving
4. Verificar restricciones de capacidad
5. Aplicar optimización 2-opt
```

**Complejidad:** O(n² log n)

### 7.2 Nearest Neighbor

**Objetivo:** Construir rutas visitando el vecino más cercano

**Algoritmo:**
```
1. Iniciar desde depósito
2. Mientras haya ubicaciones sin visitar:
   a. Encontrar ubicación más cercana que quepa
   b. Agregar a ruta actual
   c. Verificar capacidad
3. Si no cabe más, volver al depósito y crear nueva ruta
```

**Complejidad:** O(n²)

### 7.3 Optimización 2-opt

**Objetivo:** Mejorar rutas intercambiando arcos

**Algoritmo:**
```
1. Para cada ruta:
   a. Seleccionar dos arcos (i,i+1) y (j,j+1)
   b. Si d(i,j) + d(i+1,j+1) < d(i,i+1) + d(j,j+1):
      - Intercambiar arcos
      - Invertir segmento entre i+1 y j
2. Repetir hasta no haya mejoras
```

**Complejidad:** O(n²) por iteración

### 7.4 Clustering por Localidades

**Objetivo:** Agrupar ubicaciones geográficamente cercanas

**Algoritmo:**
```
1. Para cada ubicación:
   a. Obtener coordenadas (lat, lon)
   b. Determinar localidad mediante polígonos
   c. Agregar a grupo de localidad
2. Para cada localidad:
   a. Aplicar algoritmo VRP
   b. Generar rutas optimizadas
3. Combinar rutas de todas las localidades
```

---

## 8. FUNCIONALIDADES DEL SISTEMA

### 8.1 Gestión de Datos

**Carga de Archivos CSV:**
- Validación de formato
- Procesamiento en lotes
- Geocodificación automática
- Almacenamiento en base de datos

**Historial de Subidas:**
- Registro de archivos procesados
- Fecha y hora de procesamiento
- Estadísticas por subida
- Selección de subida para cálculo

### 8.2 Gestión de Vehículos

**Vehículos Personalizados:**
- Nombre y tipo
- Capacidad en kilogramos
- Costo por viaje
- Almacenamiento persistente

**Configuración Predeterminada:**
- Camión: 5500 kg
- Moto: 150 kg
- Costos configurables

### 8.3 Cálculo de Rutas

**Algoritmos Disponibles:**
1. **Profesional**: Savings + 2-opt + Clustering
2. **Híbrido**: Multi-vehículo con clustering
3. **Personalizado**: Vehículos configurables

**Características:**
- Restricciones de capacidad
- Restricciones de tiempo (9 horas/día)
- Múltiples vehículos en paralelo
- Optimización de distancia

### 8.4 Visualización

**Mapa Interactivo:**
- Marcadores individuales
- Clusters dinámicos
- Rutas con colores
- Popups informativos

**Clustering Visual:**
- Agrupación automática después de calcular
- Suma de recogidas por cluster
- Información agregada en popups
- Zoom para separar clusters

### 8.5 Exportación

**Plan de Rutas CSV:**
- Agrupación por día
- Consideración de vehículos en paralelo
- Columnas: día, ruta, tipo vehículo, orden, dirección, peso, residuos
- Formato compatible con Excel

---

## 9. TECNOLOGÍAS UTILIZADAS

### 9.1 Backend

| Tecnología | Versión | Propósito |
|------------|---------|-----------|
| Node.js | 14+ | Runtime de JavaScript |
| Express.js | 4.18.2 | Framework web |
| SQLite3 | 5.1.6 | Base de datos |
| Multer | 1.4.5 | Manejo de archivos |
| fast-csv | 5.0.5 | Procesamiento CSV |
| node-geocoder | 4.2.0 | Geocodificación |
| cors | 2.8.5 | CORS habilitado |

### 9.2 Frontend

| Tecnología | Versión | Propósito |
|------------|---------|-----------|
| HTML5 | - | Estructura |
| CSS3 | - | Estilos |
| JavaScript ES6+ | - | Lógica cliente |
| Leaflet | 1.9.4 | Mapas interactivos |
| Leaflet.markercluster | 1.5.3 | Clustering de marcadores |
| Font Awesome | 6.0.0 | Iconos |

### 9.3 Base de Datos

- **SQLite3**: Base de datos relacional ligera
- **Tablas principales:**
  - `residuos`: Información de residuos y ubicaciones
  - `historial_subidas`: Registro de archivos procesados
  - `rutas_calculadas`: Rutas optimizadas y métricas

---

## 10. INSTALACIÓN Y CONFIGURACIÓN

### 10.1 Prerrequisitos

- Node.js versión 14 o superior
- npm (Node Package Manager)
- Navegador web moderno (Chrome, Firefox, Safari, Edge)

### 10.2 Instalación

```bash
# 1. Clonar o descargar el proyecto
cd /ruta/al/proyecto

# 2. Instalar dependencias
npm install

# 3. Verificar instalación
npm list
```

### 10.3 Configuración

**Puerto del Servidor:**
- Por defecto: 3000
- Modificar en `server.js`: `const PORT = 3000;`

**Base de Datos:**
- Se crea automáticamente: `reconecta.db`
- Tablas se crean al iniciar el servidor

**Directorio de Uploads:**
- Se crea automáticamente: `uploads/`
- Archivos temporales se almacenan aquí

### 10.4 Ejecución

```bash
# Modo producción
npm start

# Modo desarrollo (con recarga automática)
npm run dev
```

**Acceso:**
- Abrir navegador en: `http://localhost:3000`

---

## 11. MANUAL DE USO

### 11.1 Carga de Archivo CSV

1. **Preparar archivo CSV:**
   - Formato: UTF-8
   - Columnas requeridas: Dirección, Ciudad, Peso, etc.
   - Incluir coordenadas lat/lon si están disponibles

2. **Subir archivo:**
   - Arrastrar y soltar en la zona de carga
   - O hacer clic para seleccionar archivo
   - Esperar confirmación de procesamiento

3. **Verificar datos:**
   - Revisar número de registros procesados
   - Verificar que aparezcan puntos en el mapa

### 11.2 Configuración de Vehículos

1. **Añadir vehículo:**
   - Clic en "Añadir Vehículo"
   - Completar formulario:
     - Nombre
     - Tipo (camión, moto, otro)
     - Capacidad (kg)
     - Costo por viaje (COP)
   - Guardar

2. **Editar vehículos:**
   - Clic en "Editar Vehículos"
   - Modificar información
   - Guardar cambios

### 11.3 Cálculo de Rutas

1. **Seleccionar algoritmo:**
   - Híbrido (por defecto)
   - Personalizado (si hay vehículos configurados)
   - Profesional

2. **Calcular rutas:**
   - Clic en "Calcular Rutas Optimizadas"
   - Esperar procesamiento
   - Ver resultados en mapa

3. **Visualizar resultados:**
   - Rutas en colores diferentes
   - Números indican orden de visita
   - Clic en puntos para ver detalles
   - Clusters muestran suma de recogidas

### 11.4 Descarga de Plan de Rutas

1. **Generar plan:**
   - Después de calcular rutas
   - Clic en "Descargar Plan de Rutas por Día"

2. **Archivo CSV:**
   - Se descarga automáticamente
   - Formato: plan_rutas_dia_[id]_[timestamp].csv
   - Abrir en Excel o editor de texto

---

## 12. BASE DE DATOS

### 12.1 Esquema de Tablas

#### Tabla: residuos
```sql
CREATE TABLE residuos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subida_id INTEGER NOT NULL,
    categoria TEXT,
    subcategoria TEXT,
    nombre_residuo TEXT,
    peso_kg REAL,
    direccion TEXT,
    ciudad TEXT,
    latitud REAL,
    longitud REAL,
    procesado INTEGER DEFAULT 0,
    -- ... más columnas
    FOREIGN KEY (subida_id) REFERENCES historial_subidas(id)
);
```

#### Tabla: historial_subidas
```sql
CREATE TABLE historial_subidas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha_subida DATETIME DEFAULT CURRENT_TIMESTAMP,
    nombre_archivo TEXT,
    total_registros INTEGER,
    peso_total REAL,
    ubicaciones_unicas INTEGER
);
```

#### Tabla: rutas_calculadas
```sql
CREATE TABLE rutas_calculadas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subida_id INTEGER NOT NULL,
    fecha_calculo DATETIME DEFAULT CURRENT_TIMESTAMP,
    tipo_vehiculo TEXT,
    capacidad_vehiculo_kg REAL,
    total_rutas INTEGER,
    rutas_validas INTEGER,
    peso_total_kg REAL,
    distancia_total_km REAL,
    tiempo_total_minutos REAL,
    costo_total_usd REAL,
    dias_trabajo INTEGER,
    utilizacion_promedio REAL,
    rutas_json TEXT,
    vehiculos_disponibles TEXT,
    FOREIGN KEY (subida_id) REFERENCES historial_subidas(id)
);
```

### 12.2 Relaciones

```
historial_subidas (1) ──< (N) residuos
historial_subidas (1) ──< (N) rutas_calculadas
```

---

## 13. API REST

### 13.1 Endpoints Principales

#### POST /upload
**Descripción:** Sube y procesa archivo CSV

**Request:**
- Content-Type: multipart/form-data
- Body: archivo CSV

**Response:**
```json
{
  "success": true,
  "message": "Archivo procesado exitosamente",
  "registros": 150,
  "subidaId": 1
}
```

#### POST /api/calculate-routes
**Descripción:** Calcula rutas VRP optimizadas

**Request:**
```json
{
  "vehicleType": "hibrido",
  "subidaId": 1,
  "customVehicles": [
    {
      "name": "Camión",
      "type": "camion",
      "capacity": 5500,
      "costPerTrip": 350000
    }
  ]
}
```

**Response:**
```json
{
  "routes": [...],
  "analysis": {
    "totalVehicles": 5,
    "totalWorkingDays": 3,
    "totalDistance": 245.5,
    "totalTime": 1620,
    "totalCost": 1750000
  }
}
```

#### GET /api/data
**Descripción:** Obtiene ubicaciones de residuos

**Query Parameters:**
- `subidaId` (opcional): ID de subida específica

**Response:**
```json
[
  {
    "lat": 4.6097,
    "lon": -74.0817,
    "peso": 150.5,
    "direccion": "Calle 123 # 45-67",
    "ciudad": "BOGOTA, D. C."
  }
]
```

#### GET /api/download-route-plan/:subidaId
**Descripción:** Descarga plan de rutas en CSV

**Response:**
- Content-Type: text/csv
- Content-Disposition: attachment
- Body: Archivo CSV

#### GET /api/route-plan-preview/:subidaId
**Descripción:** Vista previa del plan de rutas

**Response:**
```json
{
  "preview": [
    {
      "dia": 1,
      "recogida": 1,
      "direccion": "Calle 123",
      "peso": 150.5
    }
  ]
}
```

---

## 14. CONCLUSIONES

### 14.1 Logros Alcanzados

1. **Sistema Completo:** Implementación funcional de optimización VRP
2. **Múltiples Algoritmos:** Tres variantes de VRP implementadas
3. **Clustering Geográfico:** Agrupación eficiente por localidades
4. **Gestión de Vehículos:** Sistema flexible de configuración
5. **Visualización Interactiva:** Mapas con clustering dinámico
6. **Exportación:** Generación de planes de rutas en CSV

### 14.2 Características Destacadas

- **Escalabilidad:** Maneja grandes volúmenes de datos (1500+ registros)
- **Eficiencia:** Clustering reduce complejidad computacional
- **Flexibilidad:** Múltiples tipos de vehículos y algoritmos
- **Usabilidad:** Interfaz intuitiva y visualización clara
- **Robustez:** Manejo de errores y validaciones

### 14.3 Mejoras Futuras

1. **Optimización Avanzada:**
   - Implementar algoritmos genéticos
   - Simulated Annealing
   - Tabu Search

2. **Funcionalidades Adicionales:**
   - Restricciones de ventanas de tiempo
   - Múltiples depósitos
   - Consideración de tráfico en tiempo real

3. **Análisis:**
   - Dashboard de métricas
   - Comparación de algoritmos
   - Análisis de costos detallado

4. **Integración:**
   - API para sistemas externos
   - Integración con GPS
   - Notificaciones automáticas

---

## ANEXOS

### A. Glosario de Términos

- **VRP (Vehicle Routing Problem):** Problema de optimización de rutas para múltiples vehículos
- **Savings Algorithm:** Algoritmo de Clark & Wright para VRP
- **2-opt:** Técnica de optimización local para mejorar rutas
- **Clustering:** Agrupación de elementos similares
- **Geocodificación:** Conversión de direcciones a coordenadas
- **Haversine:** Fórmula para calcular distancias en esfera

### B. Referencias

1. Clarke, G., & Wright, J. W. (1964). Scheduling of Vehicles from a Central Depot to a Number of Delivery Points. Operations Research, 12(4), 568-581.

2. Toth, P., & Vigo, D. (2002). The Vehicle Routing Problem. SIAM.

3. Laporte, G. (2009). Fifty Years of Vehicle Routing. Transportation Science, 43(4), 408-416.

---

**Fin del Documento**


