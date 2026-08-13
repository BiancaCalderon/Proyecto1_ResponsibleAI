# Proyecto1_ResponsibleAI

## Directorio de Médicos Especialistas

Proyecto para crear un directorio de médicos especialistas utilizando:
- **Firebase Functions v2** (TypeScript)
- **Cloud Firestore**
- **Google Places API**
- **Firebase Hosting** (Interfaz web en HTML/JS)

---

## Comandos para Ejecutar el Proyecto Localmente

### 1. Prerrequisitos e Instalación de Dependencias

Antes de iniciar los emuladores por primera vez, es importante instalar las dependencias y **compilar el código TypeScript** de las Cloud Functions:

```bash
# 1. Navegar a la carpeta de funciones e instalar dependencias
cd functions
npm install

# 2. Compilar el código TypeScript a JavaScript (genera functions/lib)
npm run build

# 3. Volver a la raíz del proyecto
cd ..
```

---

### 2. Liberar Puertos (Si ya tienes una instancia corriendo)

Si obtienes un error de puerto ocupado (`Port 8080 is not open`), libera los puertos ejecutando:

```bash
fuser -k 8080/tcp 5000/tcp 5001/tcp
```

---

### 3. Definir Variables de Entorno

En tu terminal de Linux/WSL, exporta tu API key de Google Places y la lista de IPs autorizadas:

```bash
export PLACES_API_KEY="TU_API_KEY_DE_PLACES"
export ALLOWED_IPS="[IP_ADDRESS]"
```

---

### 4. Iniciar los Emuladores de Firebase

Inicia los emuladores de Functions, Firestore y Hosting:

```bash
npx firebase emulators:start --only functions,firestore,hosting
```

Una vez iniciados, abre la página web en tu navegador:
👉 **[http://127.0.0.1:5000](http://127.0.0.1:5000)**

---

### 5. Poblar la Base de Datos (En una segunda ventana de terminal)

Al iniciar el emulador local, la base de datos Firestore inicia limpia. Puedes poblarla con los datos de prueba y con datos reales de Google Places API:

#### 1) Sembrar datos de prueba con teléfono y sitio web
```bash
curl http://127.0.0.1:5000/sembrar
```

#### 2) Recolectar datos reales por especialidad desde Google Places API
```bash
# Cardiología (Zona 10)
curl "http://127.0.0.1:5000/recolectar?keyword=cardiologo&zona=zona%2010&especialidad=Cardiologia"

# Ginecología (Zona 9)
curl "http://127.0.0.1:5000/recolectar?keyword=ginecologo&zona=zona%209&especialidad=Ginecologia"

# Dermatología (Zona 15)
curl "http://127.0.0.1:5000/recolectar?keyword=dermatologo&zona=zona%2015&especialidad=Dermatologia"

# Pediatría (Zona 1)
curl "http://127.0.0.1:5000/recolectar?keyword=pediatra&zona=zona%201&especialidad=Pediatria"
```

#### 3) Probar la API de directorio paginada directamente
```bash
curl "http://127.0.0.1:5000/directorio?page=1&pageSize=10&especialidad=Cardiologia&zona=zona%2010"
```

---

## Estructura del Proyecto

- `public/index.html`: Interfaz de usuario con tabla y buscador (auto-carga al inicio, búsquedas case/accent-insensitive y soporte para la tecla Enter).
- `functions/src/index.ts`: Definición de endpoints HTTP de Firebase Functions:
  - `directorioApi`: Consulta paginada con filtrado flexible.
  - `recolectarDirectorio`: Integración con Google Places API y almacenamiento en Firestore.
  - `sembrarDirectorio`: Generación de datos semilla de prueba.
- `firestore.indexes.json`: Índices compuestos para Firestore.
- `firebase.json`: Configuración de emuladores y reescritura de rutas (*rewrites*) de Hosting a Functions.