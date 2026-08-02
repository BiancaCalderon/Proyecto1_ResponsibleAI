# Estrategia de Búsqueda de Keywords

## Contexto

Los datos en Google Maps usan nomenclatura inconsistente para nombrar clínicas,
consultorios y especialidades médicas. Para minimizar resultados irrelevantes o
duplicados, el equipo definió una estrategia de construcción de keywords antes
de ejecutar recolecciones masivas.

## Formato de búsqueda

Cada búsqueda combina tres partes:

```
{especialidad} {zona} Guatemala
```

Ejemplo: si `especialidad = "cardiólogo"` y `zona = "zona 10"`, la query final
enviada a la Places API es:

```
cardiólogo zona 10 Guatemala
```

Se agrega "Guatemala" al final de cada búsqueda para reducir resultados fuera
del país o de zonas con nombres ambiguos.

## Parámetros de la Cloud Function

La función `recolectarDirectorio` recibe tres parámetros por separado en vez de
un solo texto libre:

- `keyword`: la especialidad médica en lenguaje coloquial (ej. "cardiólogo",
  "clínica pediátrica")
- `zona`: la zona de Ciudad de Guatemala (ej. "zona 10", "zona 1")
- `especialidad`: el valor que se guarda como filtro estructurado en Firestore
  (puede diferir ligeramente del `keyword`, ej. keyword="cardiólogo" pero
  especialidad="cardiología")

Esto permite que la API paginada (`GET /directorio`) filtre correctamente por
`especialidad` y `zona` sin tener que parsear texto libre.

## Ejemplos de combinaciones planeadas

| Especialidad         | Zona      | Keyword usado                      |
|-----------------------|-----------|-------------------------------------|
| Cardiología           | Zona 10   | cardiólogo zona 10 Guatemala       |
| Pediatría              | Zona 1    | clínica pediátrica zona 1 Guatemala |
| Dermatología           | Zona 15   | dermatólogo zona 15 Guatemala      |
| Ginecología            | Zona 9    | ginecólogo zona 9 Guatemala        |

## Manejo de datos incompletos

Google Maps no siempre retorna todos los campos para cada resultado. En
particular, el endpoint `textsearch` de Places API no incluye
`formatted_phone_number` ni `website` de forma consistente.

**Decisión del equipo:** estos campos se guardan como cadena vacía (`""`)
cuando no vienen en la respuesta de la API, en vez de intentar inferirlos o
completarlos manualmente. Esto se documenta honestamente en cada registro,
tal como indica el enunciado del proyecto.

## Control de duplicados

Cada documento en Firestore usa el `place_id` de Google como ID del documento.
Si la misma búsqueda se ejecuta más de una vez (por ejemplo, al repetir una
zona), los resultados se sobrescriben en vez de duplicarse, ya que `place_id`
es un identificador estable por lugar.
