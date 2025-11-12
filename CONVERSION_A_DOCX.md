
# INSTRUCCIONES PARA CONVERTIR A DOCX

Los documentos están en formato Markdown (.md). Para convertirlos a Word (.docx), tienes varias opciones:

## OPCIÓN 1: Usar Herramientas Online (Más Fácil)

### 1. Markdown to Word Online
- Visita: https://www.markdowntoword.com/
- Sube el archivo `DOCUMENTACION_PROYECTO.md`
- Descarga el archivo .docx generado

### 2. Dillinger.io
- Visita: https://dillinger.io/
- Abre el archivo Markdown
- Exporta como Word (.docx)

### 3. CloudConvert
- Visita: https://cloudconvert.com/md-to-docx
- Sube el archivo .md
- Descarga el .docx

## OPCIÓN 2: Usar Microsoft Word (Directo)

1. Abre Microsoft Word
2. Ve a: Archivo → Abrir
3. Selecciona el archivo `DOCUMENTACION_PROYECTO.md`
4. Word lo convertirá automáticamente
5. Guarda como .docx

## OPCIÓN 3: Instalar Pandoc (Avanzado)

```bash
# En macOS con Homebrew
brew install pandoc

# Luego convertir
pandoc DOCUMENTACION_PROYECTO.md -o DOCUMENTACION_PROYECTO.docx
```

## OPCIÓN 4: Usar VS Code

1. Instala la extensión "Markdown PDF" en VS Code
2. Abre el archivo .md
3. Presiona Cmd+Shift+P (Mac) o Ctrl+Shift+P (Windows)
4. Busca "Markdown PDF: Export (docx)"
5. Selecciona y exporta

## ARCHIVOS A CONVERTIR

1. **DOCUMENTACION_PROYECTO.md** - Documentación técnica completa
2. **DIAGRAMAS.md** - Diagramas del sistema (puede requerir ajustes)
3. **RESUMEN_EJECUTIVO.md** - Resumen ejecutivo

## NOTA SOBRE DIAGRAMAS

Los diagramas en formato Mermaid pueden no convertirse correctamente. Opciones:
- Convertir manualmente usando https://mermaid.live (exportar como PNG)
- Insertar las imágenes en el documento Word
- Usar herramientas de diagramación como Draw.io

## RECOMENDACIÓN

Para un trabajo de grado, recomiendo:
1. Convertir `DOCUMENTACION_PROYECTO.md` a Word
2. Convertir los diagramas de `DIAGRAMAS.md` a imágenes
3. Insertar las imágenes en el documento Word
4. Ajustar formato según requerimientos de tu universidad

