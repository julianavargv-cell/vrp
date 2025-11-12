# DIAGRAMAS DEL SISTEMA VRP

Este documento contiene los diagramas del sistema en formato Mermaid, que pueden ser renderizados en GitHub, GitLab o convertidos a imágenes.

---

## DIAGRAMA DE COMPONENTES

```mermaid
graph TB
    subgraph "SISTEMA VRP"
        subgraph Frontend["FRONTEND"]
            Mapa[Mapa Leaflet]
            GestionVeh[Gestión Vehículos]
            Visualizacion[Visualización Rutas]
            ClusteringViz[Clustering Visual]
        end
        
        subgraph Backend["BACKEND"]
            APIREST[API REST Express]
            ProcesadorCSV[Procesador CSV]
            Geocodificador[Geocodificador]
            AlgoritmosVRP[Algoritmos VRP]
            ClusteringGeo[Clustering Geográfico]
        end
        
        subgraph BaseDatos["BASE DE DATOS"]
            TablaResiduos[(Tabla: residuos)]
            TablaHistorial[(Tabla: historial_subidas)]
            TablaRutas[(Tabla: rutas_calculadas)]
        end
        
        subgraph Algoritmos["ALGORITMOS VRP"]
            AlgoProfesional[ProfessionalVRP<br/>Savings + 2-opt]
            AlgoHibrido[HybridVRP<br/>Multi-vehículo]
            AlgoCustom[CustomVRP<br/>Personalizado]
        end
    end
    
    Frontend -->|HTTP/REST| Backend
    Backend -->|SQL| BaseDatos
    Backend -->|Ejecuta| Algoritmos
    
    Mapa --> ClusteringViz
    GestionVeh --> APIREST
    Visualizacion --> APIREST
    
    APIREST --> ProcesadorCSV
    APIREST --> Geocodificador
    APIREST --> AlgoritmosVRP
    AlgoritmosVRP --> ClusteringGeo
    
    AlgoritmosVRP --> AlgoProfesional
    AlgoritmosVRP --> AlgoHibrido
    AlgoritmosVRP --> AlgoCustom
    
    ProcesadorCSV --> TablaResiduos
    AlgoritmosVRP --> TablaRutas
    ProcesadorCSV --> TablaHistorial
```

---

## DIAGRAMA DE SECUENCIA: Carga de CSV y Cálculo de Rutas

```mermaid
sequenceDiagram
    participant U as Usuario
    participant F as Frontend
    participant B as Backend
    participant DB as Base de Datos
    participant VRP as Algoritmo VRP
    participant Geo as Geocodificador
    
    U->>F: Subir archivo CSV
    F->>B: POST /upload
    B->>B: Procesar CSV
    B->>Geo: Geocodificar direcciones
    Geo-->>B: Coordenadas
    B->>DB: INSERT residuos
    DB-->>B: Confirmación
    B-->>F: Respuesta éxito
    F-->>U: Confirmación procesamiento
    
    U->>F: Calcular Rutas Optimizadas
    F->>B: POST /api/calculate-routes
    B->>DB: SELECT ubicaciones
    DB-->>B: Lista ubicaciones
    B->>VRP: Ejecutar algoritmo
    VRP->>VRP: Clustering por localidades
    VRP->>VRP: Savings Algorithm
    VRP->>VRP: Optimización 2-opt
    VRP-->>B: Rutas optimizadas
    B->>DB: INSERT rutas_calculadas
    DB-->>B: Confirmación
    B-->>F: Rutas + métricas
    F->>F: Visualizar en mapa
    F->>F: Activar clustering
    F-->>U: Mostrar resultados
```

---

## DIAGRAMA DE SECUENCIA: Agrupación por Día con Vehículos Paralelos

```mermaid
sequenceDiagram
    participant U as Usuario
    participant F as Frontend
    participant B as Backend
    participant DB as Base de Datos
    participant Algo as Algoritmo Agrupación
    
    U->>F: Descargar Plan de Rutas
    F->>B: GET /api/download-route-plan/:id
    B->>DB: SELECT rutas_calculadas
    DB-->>B: Rutas JSON
    B->>DB: SELECT vehiculos_disponibles
    DB-->>B: Cantidad vehículos
    B->>B: Parsear JSON rutas
    B->>B: Parsear JSON vehículos
    B->>Algo: Agrupar por tipo vehículo
    Algo->>Algo: Distribuir rutas por día
    Algo->>Algo: Considerar vehículos paralelos
    Algo->>Algo: Calcular tiempo máximo por día
    Algo-->>B: Rutas agrupadas por día
    B->>B: Generar CSV
    B-->>F: Archivo CSV
    F-->>U: Descarga automática
```

---

## DIAGRAMA DE FLUJO: Algoritmo VRP con Clustering

```mermaid
flowchart TD
    Start([Inicio: Calcular Rutas]) --> LoadData[Cargar Ubicaciones]
    LoadData --> Cluster[Clustering por Localidades]
    Cluster --> Localidad{¿Hay más<br/>localidades?}
    
    Localidad -->|Sí| SelectLocalidad[Seleccionar Localidad]
    SelectLocalidad --> BuildMatrix[Construir Matriz<br/>de Distancias]
    BuildMatrix --> Classify[Clasificar por<br/>Tipo Vehículo]
    
    Classify --> Camion{¿Hay<br/>ubicaciones<br/>para camión?}
    Camion -->|Sí| RoutesCamion[Crear Rutas<br/>Camión]
    Camion -->|No| Moto
    
    RoutesCamion --> Moto{¿Hay<br/>ubicaciones<br/>para moto?}
    Moto -->|Sí| RoutesMoto[Crear Rutas<br/>Moto]
    Moto -->|No| Optimize
    
    RoutesMoto --> Optimize[Optimizar con 2-opt]
    Optimize --> Localidad
    
    Localidad -->|No| Combine[Combinar Rutas<br/>de Todas las Localidades]
    Combine --> CalculateMetrics[Calcular Métricas]
    CalculateMetrics --> SaveDB[Guardar en<br/>Base de Datos]
    SaveDB --> Return([Retornar Rutas])
    
    style Start fill:#27ae60
    style Return fill:#27ae60
    style Cluster fill:#3498db
    style Optimize fill:#f39c12
```

---

## DIAGRAMA DE FLUJO: Agrupación por Día

```mermaid
flowchart TD
    Start([Inicio: Agrupar por Día]) --> LoadRutas[Cargar Rutas]
    LoadRutas --> LoadVehiculos[Cargar Vehículos<br/>Disponibles]
    LoadVehiculos --> GroupByType[Agrupar Rutas<br/>por Tipo Vehículo]
    
    GroupByType --> ForEachType{¿Hay más<br/>tipos de<br/>vehículo?}
    
    ForEachType -->|Sí| SelectType[Seleccionar Tipo]
    SelectType --> GetCount[Obtener Cantidad<br/>Vehículos Disponibles]
    GetCount --> SortRoutes[Ordenar Rutas<br/>por Tiempo]
    
    SortRoutes --> InitDay[Día = 1]
    InitDay --> CheckDay{¿Hay espacio<br/>en día actual<br/>para este tipo?}
    
    CheckDay -->|Sí| AddRoute[Agregar Ruta<br/>al Día]
    AddRoute --> UpdateTime[Actualizar Tiempo<br/>Máximo del Día]
    UpdateTime --> CheckLimit{¿Tiempo > 540<br/>minutos?}
    
    CheckLimit -->|Sí| NextDay[Día = Día + 1]
    CheckLimit -->|No| CheckDay
    
    NextDay --> CheckDay
    CheckDay -->|No| NextDay
    
    CheckDay -->|No espacio| CheckMore{¿Hay más<br/>rutas de<br/>este tipo?}
    CheckMore -->|Sí| NextDay
    CheckMore -->|No| ForEachType
    
    ForEachType -->|No| Renumber[Renumerar Días]
    Renumber --> GenerateCSV[Generar CSV]
    GenerateCSV --> End([Fin: CSV Generado])
    
    style Start fill:#27ae60
    style End fill:#27ae60
    style GroupByType fill:#3498db
    style UpdateTime fill:#f39c12
```

---

## DIAGRAMA DE ARQUITECTURA DE CAPAS

```mermaid
graph TB
    subgraph "CAPA DE PRESENTACIÓN"
        UI[Interfaz de Usuario]
        Map[Mapa Interactivo]
        Forms[Formularios]
    end
    
    subgraph "CAPA DE APLICACIÓN"
        API[API REST]
        Business[Lógica de Negocio]
        VRPAlgo[Algoritmos VRP]
    end
    
    subgraph "CAPA DE DATOS"
        DB[(SQLite Database)]
        Files[Archivos CSV]
    end
    
    UI --> API
    Map --> API
    Forms --> API
    
    API --> Business
    Business --> VRPAlgo
    Business --> DB
    Business --> Files
    
    VRPAlgo --> DB
```

---

## DIAGRAMA DE ESTADOS: Proceso de Cálculo de Rutas

```mermaid
stateDiagram-v2
    [*] --> CargandoDatos: Subir CSV
    CargandoDatos --> Procesando: CSV Válido
    CargandoDatos --> Error: CSV Inválido
    
    Procesando --> Geocodificando: Datos Cargados
    Geocodificando --> Guardando: Coordenadas Obtenidas
    Guardando --> ListoParaCalcular: Datos Guardados
    
    ListoParaCalcular --> Calculando: Usuario solicita cálculo
    Calculando --> Clustering: Datos obtenidos
    Clustering --> Optimizando: Localidades agrupadas
    Optimizando --> GuardandoRutas: Rutas optimizadas
    GuardandoRutas --> Visualizando: Rutas guardadas
    
    Visualizando --> MostrandoClusters: Rutas mostradas
    MostrandoClusters --> [*]: Proceso completo
    
    Error --> [*]
```

---

## DIAGRAMA DE CLASES (Simplificado)

```mermaid
classDiagram
    class ProfessionalVRPAlgorithm {
        -locations: Array
        -depot: Object
        -routes: Array
        -distanceMatrix: Array
        +calculateOptimizedRoutes(): Object
        +buildDistanceMatrix(): Array
        +calculateSavings(): Array
        +createRoutesWithSavings(type): Array
        +improveRouteWith2Opt(route): Object
    }
    
    class HybridVRPAlgorithm {
        -locations: Array
        -depot: Object
        -camionConfig: Object
        -motoConfig: Object
        +calculateHybridRoutes(): Object
        +classifyLocationsByVehicle(): Object
        +createRoutesForVehicle(locations, type): Array
    }
    
    class CustomVRPAlgorithm {
        -locations: Array
        -customVehicles: Array
        -depot: Object
        +calculateCustomRoutes(): Object
        +classifyLocationsByVehicle(): Object
        +createRoutesForVehicle(locations, vehicle): Array
    }
    
    class ClusteringModule {
        +agruparPorLocalidad(locations): Object
        +obtenerEstadisticasLocalidades(grupos): Array
        +determinarLocalidad(lat, lon): String
    }
    
    ProfessionalVRPAlgorithm --> ClusteringModule
    HybridVRPAlgorithm --> ClusteringModule
    CustomVRPAlgorithm --> ClusteringModule
```

---

## NOTAS SOBRE LOS DIAGRAMAS

### Cómo usar estos diagramas:

1. **En GitHub/GitLab:** Los diagramas Mermaid se renderizan automáticamente
2. **En Markdown:** Compatible con editores que soporten Mermaid
3. **Exportar a imagen:** Usar herramientas como:
   - Mermaid Live Editor: https://mermaid.live
   - VS Code con extensión Mermaid
   - Online tools de conversión

### Personalización:

Los diagramas pueden ser modificados editando el código Mermaid. Para más información sobre sintaxis Mermaid, consultar: https://mermaid.js.org

