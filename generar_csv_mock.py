#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para generar un CSV de ejemplo con todos los puntos de recolección
de Bogotá basado en datos_mapa.json, usando solo residuos RAEE del consolidado
"""

import json
import csv
import random
from datetime import datetime, timedelta
from collections import defaultdict
import utm

# Esta lista se llenará con residuos RAEE del consolidado
RESIDUOS_RAEE = []

# Datos de ejemplo para generar información realista
EMPRESAS_EJEMPLO = [
    {"nombre": "SPECTRUM BRANDS CORP SAS", "nit": "800087297-6", "responsable": "LUZ STELLA CELIS", "correo": "co.recepcionfacturase@la.spectrumbrands.com"},
    {"nombre": "SIGNIFY COLOMBIANA SAS", "nit": "900836968-7", "responsable": "LEONARDO BENAVIDES", "correo": "test@signify.com"},
    {"nombre": "MTS CONSULTORIA + GESTION SAS", "nit": "830142201-4", "responsable": "LUZ DARY LEGUIZAMON", "correo": "test@mts.com.co"},
    {"nombre": "CENTRO COMERCIAL PORTAL 80", "nit": "830143447-3", "responsable": "Ana Maria Suarez", "correo": "test@portal80.com.co"},
    {"nombre": "DROGUERIAS Y FARMACIAS CRUZ VERDE SAS", "nit": "800149695-1", "responsable": "JENNY PRIETO", "correo": "gestionambiental@cruzverde.com.co"},
    {"nombre": "CASALIMPIA SA", "nit": "860010451-1", "responsable": "DANIELA PEÑA", "correo": "ambiental@casalimpia.com.co"},
    {"nombre": "METROPOLIS CENTRO COMERCIAL", "nit": "860518583-7", "responsable": "MARIA PAULA", "correo": "ambiental@ccmetropolis.com.co"},
    {"nombre": "UNIVERSIDAD DE LOS ANDES", "nit": "860007386", "responsable": "ANA LUCIA GOMEZ", "correo": "enlacesambientales@gmail.com"},
]

CERTIFICADOS = ["REP-86-9030", "REP - 14 - 9308", "REP - 15 - 9316", "REP - 29 - 9315", "REP - 30 - 9339"]
CANALES = ["Gestionado por Reconecta", "Centro de Acopio"]
TIPOS_GESTION = ["Aprovechamiento"]
GESTOR = "Eco Industria SAS"
CENTRO_ACOPIO = "Parque Industrial San Jorge"

def cargar_residuos_raee():
    """Carga todos los residuos RAEE únicos del consolidado con sus pesos"""
    residuos_dict = defaultdict(lambda: {
        "pesos": [],
        "categoria": "",
        "subcategoria": ""
    })
    
    print("📂 Cargando residuos RAEE del consolidado...")
    with open('Consolidado RECONECTA ENE-DIC.xlsx - Ene - DIC.csv', 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        # Crear mapeo de nombres limpios a nombres originales
        fieldnames_map = {}
        for orig in reader.fieldnames:
            clean = orig.strip()
            if clean not in fieldnames_map:
                fieldnames_map[clean] = orig
        
        for row in reader:
            # Usar nombres limpios para buscar en el mapa
            categoria_key = fieldnames_map.get('Categoría', 'Categoría')
            categoria = (row.get(categoria_key) or '').strip()
            # Solo categorías 1, 2 o 3 (RAEE)
            if categoria.startswith('1.') or categoria.startswith('2.') or categoria.startswith('3.'):
                nombre_key = fieldnames_map.get('Nombre de Residuo', 'Nombre de Residuo')
                subcategoria_key = fieldnames_map.get('Subcategoria', 'Subcategoria')
                peso_key = fieldnames_map.get('Peso Disposición Final (kg)', 'Peso Disposición Final (kg)')
                
                nombre_residuo = (row.get(nombre_key) or '').strip()
                subcategoria = (row.get(subcategoria_key) or '').strip()
                peso_str = (row.get(peso_key) or '').strip()
                
                if nombre_residuo:
                    # Limpiar y convertir peso (puede tener comas como separador decimal)
                    try:
                        peso_str = peso_str.replace(',', '.')
                        peso = float(peso_str) if peso_str else 0
                        if peso > 0:
                            residuos_dict[nombre_residuo]["pesos"].append(peso)
                            if not residuos_dict[nombre_residuo]["categoria"]:
                                residuos_dict[nombre_residuo]["categoria"] = categoria
                            if not residuos_dict[nombre_residuo]["subcategoria"]:
                                residuos_dict[nombre_residuo]["subcategoria"] = subcategoria
                    except (ValueError, AttributeError) as e:
                        pass
    
    # Convertir a lista con información completa
    global RESIDUOS_RAEE
    RESIDUOS_RAEE = []
    for nombre, info in residuos_dict.items():
        pesos = info["pesos"]
        if len(pesos) > 0:
            peso_min = min(pesos)
            peso_max = max(pesos)
            # Usar percentiles para rangos más realistas
            pesos_sorted = sorted(pesos)
            peso_p10 = pesos_sorted[int(len(pesos_sorted) * 0.1)] if len(pesos_sorted) > 0 else peso_min
            peso_p90 = pesos_sorted[int(len(pesos_sorted) * 0.9)] if len(pesos_sorted) > 0 else peso_max
            
            RESIDUOS_RAEE.append({
                "nombre_residuo": nombre,
                "categoria": info["categoria"],
                "subcategoria": info["subcategoria"],
                "peso_range": (peso_p10, peso_p90),  # Rango entre percentiles 10 y 90
                "pesos_ejemplo": pesos_sorted  # Para seleccionar pesos más realistas
            })
    
    print(f"✅ Cargados {len(RESIDUOS_RAEE)} tipos de residuos RAEE únicos")
    print(f"   Ejemplos: {', '.join([r['nombre_residuo'][:30] for r in RESIDUOS_RAEE[:5]])}...")

def obtener_residuo_aleatorio():
    """Selecciona aleatoriamente un residuo RAEE y genera peso"""
    if not RESIDUOS_RAEE:
        # Si no se cargaron, usar uno por defecto
        return {
            "categoria": "2. Electrónica y Equipos de Telecomunicación",
            "subcategoria": "2.4 Computadores y equipos para tratamiento de datos",
            "nombre_residuo": "CPU",
            "peso": round(random.uniform(5.0, 20.0), 2)
        }
    
    residuo = random.choice(RESIDUOS_RAEE)
    
    # Generar peso más realista usando los pesos del consolidado
    if residuo["pesos_ejemplo"]:
        # 70% probabilidad de usar un peso del consolidado, 30% de generar aleatorio
        if random.random() < 0.7:
            peso = random.choice(residuo["pesos_ejemplo"])
        else:
            peso = round(random.uniform(residuo["peso_range"][0], residuo["peso_range"][1]), 2)
    else:
        peso = round(random.uniform(residuo["peso_range"][0], residuo["peso_range"][1]), 2)
    
    return {
        "categoria": residuo["categoria"],
        "subcategoria": residuo["subcategoria"],
        "nombre_residuo": residuo["nombre_residuo"],
        "peso": peso
    }

def generar_manifiesto():
    """Genera un número de manifiesto"""
    return random.randint(9000, 12000)

def generar_fecha():
    """Genera una fecha aleatoria en 2024"""
    inicio = datetime(2024, 1, 1)
    fin = datetime(2024, 12, 31)
    fecha_random = inicio + timedelta(days=random.randint(0, (fin - inicio).days))
    return fecha_random.strftime("%Y-%m-%d")

def main():
    # Primero cargar los residuos RAEE del consolidado
    cargar_residuos_raee()
    
    if not RESIDUOS_RAEE:
        print("❌ Error: No se pudieron cargar residuos RAEE del consolidado")
        return
    
    print("\n📂 Leyendo datos_mapa.json...")
    with open('datos_mapa.json', 'r', encoding='utf-8') as f:
        puntos = json.load(f)
    
    print(f"✅ Encontrados {len(puntos)} puntos de recolección")
    
    print("\n📝 Generando CSV con residuos RAEE...")
    
    # Abrir archivo CSV para escritura
    with open('datos_bogota_completo.csv', 'w', newline='', encoding='utf-8') as csvfile:
        # Definir columnas EXACTAMENTE iguales a prueba_2_oficinas.csv (con espacios finales)
        # AGREGAR: Latitud, Longitud y coordenadas UTM de datos.json
        fieldnames = [
            'Categoría', 'Subcategoria', 'APLICA EN LAS METAS ACTUALES', 'Fecha',
            'Manifiesto', 'Nombre de Residuo', 'Peso Disposición Final (kg) ',  # NOTA: espacio al final
            'Canal o Mecanismo de recolección', 'Tipo de Gestión (proceso)', 'certificado ',  # NOTA: espacio al final
            'Gestor ', 'Centro de acopio', 'Razón social del generador', 'Nit',  # NOTA: espacio al final en Gestor
            'Responsable del envío', 'Correo ', 'Dirección', 'Departamento', 'Ciudad',  # NOTA: espacio al final en Correo
            'Latitud', 'Longitud',  # Coordenadas geográficas de datos.json
            'utm_x', 'utm_y', 'utm_zona'  # Coordenadas UTM calculadas
        ]
        
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        
        registros_generados = 0
        
        for i, punto in enumerate(puntos):
            # Extraer información del punto directamente del objeto
            nombre = punto.get('nombre', f'Punto de Recolección {i+1}')
            direccion = punto.get('direccion', 'Dirección no disponible')
            
            # Extraer coordenadas directamente de datos_mapa.json
            latitud = punto.get('latitud')
            longitud = punto.get('longitud')
            
            # Usar coordenadas UTM que ya vienen en datos_mapa.json
            utm_x = ''
            utm_y = ''
            utm_zona = ''
            
            # Si hay coordenadas UTM en el archivo, usarlas directamente
            utm_easting = punto.get('utm_easting')
            utm_northing = punto.get('utm_northing')
            utm_zona_num = punto.get('utm_zona')
            utm_letra = punto.get('utm_letra')
            
            if utm_easting is not None and utm_northing is not None and utm_zona_num is not None and utm_letra:
                utm_x = str(round(utm_easting, 2))
                utm_y = str(round(utm_northing, 2))
                utm_zona = f"{utm_zona_num}{utm_letra}"  # Zona + Letra (ej: 18N)
            elif latitud is not None and longitud is not None:
                # Si no hay UTM pero hay lat/lon, calcular UTM como fallback
                try:
                    utm_coords = utm.from_latlon(latitud, longitud)
                    utm_x = str(round(utm_coords[0], 2))
                    utm_y = str(round(utm_coords[1], 2))
                    utm_zona = f"{utm_coords[2]}{utm_coords[3]}"  # Zona + Letra (ej: 18N)
                except Exception as e:
                    print(f"⚠️  Error calculando UTM para lat={latitud}, lon={longitud}: {e}")
                    utm_x = ''
                    utm_y = ''
                    utm_zona = ''
            
            # Obtener un residuo RAEE aleatorio del consolidado
            residuo_info = obtener_residuo_aleatorio()
            
            # Seleccionar empresa aleatoria
            empresa = random.choice(EMPRESAS_EJEMPLO)
            
            # Generar datos
            fecha = generar_fecha()
            manifiesto = generar_manifiesto()
            certificado = random.choice(CERTIFICADOS)
            canal = random.choice(CANALES)
            
            # Crear registro (usando nombres EXACTOS con espacios finales)
            registro = {
                'Categoría': residuo_info['categoria'],
                'Subcategoria': residuo_info['subcategoria'],
                'APLICA EN LAS METAS ACTUALES': 'SI',
                'Fecha': fecha,
                'Manifiesto': str(manifiesto),
                'Nombre de Residuo': residuo_info['nombre_residuo'],
                'Peso Disposición Final (kg) ': str(residuo_info['peso']),  # Con espacio al final
                'Canal o Mecanismo de recolección': canal,
                'Tipo de Gestión (proceso)': random.choice(TIPOS_GESTION),
                'certificado ': certificado,  # Con espacio al final
                'Gestor ': GESTOR,  # Con espacio al final
                'Centro de acopio': CENTRO_ACOPIO,
                'Razón social del generador': nombre,
                'Nit': empresa['nit'],
                'Responsable del envío': empresa['responsable'],
                'Correo ': empresa['correo'],  # Con espacio al final
                'Dirección': direccion,
                'Departamento': 'BOGOTA, D. C.',
                'Ciudad': 'BOGOTA, D. C.',
                'Latitud': str(latitud) if latitud is not None else '',
                'Longitud': str(longitud) if longitud is not None else '',
                'utm_x': utm_x,
                'utm_y': utm_y,
                'utm_zona': utm_zona
            }
            
            writer.writerow(registro)
            registros_generados += 1
            
            if (i + 1) % 100 == 0:
                print(f"  📊 Procesados {i+1}/{len(puntos)} puntos...")
    
    print(f"\n✅ CSV generado exitosamente!")
    print(f"📊 Total de registros: {registros_generados}")
    print(f"📁 Archivo: datos_bogota_completo.csv")
    print(f"♻️  Todos los residuos son RAEE (categorías 1, 2 y 3)")

if __name__ == "__main__":
    main()

