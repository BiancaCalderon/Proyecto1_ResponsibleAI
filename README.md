# Proyecto1_ResponsibleAI

## Directorio de Médicos Especialistas

Proyecto para crear un directorio de médicos especialistas usando:
- Firebase Functions v2
- Firestore
- Google Places API
- Firebase Hosting (UI mínima)

## Comandos para correr el proyecto localmente

### 1. Desde la raíz del proyecto

```bash
cd /home/user/Proyecto1_ResponsibleAI
```

### 2. Definir variables de entorno en tu terminal

```bash
export PLACES_API_KEY="TU_API_KEY_DE_PLACES"
export ALLOWED_IPS="129.222.59.177"
```

> Para utilizar otra IP, se cambia en `ALLOWED_IPS`.

### 3. Iniciar emuladores de funciones y Firestore

```bash
npx firebase emulators:start --only functions,firestore
```

### 4. En otra terminal, probar la recolección de datos

```bash
curl -H "x-forwarded-for: 129.222.59.177" "http://127.0.0.1:5001/proyecto1-resai/us-central1/recolectarDirectorio?keyword=cardiologo&zona=zona%2010&especialidad=Cardiología"
```

### 5. Probar el API paginado

```bash
curl -H "x-forwarded-for: 129.222.59.177" "http://127.0.0.1:5001/proyecto1-resai/us-central1/directorioApi?page=1&pageSize=10&especialidad=Cardiología&zona=zona%2010"
```

### 6. Ver la UI mínima si arrastras Hosting

Para ver la página web necesitas poder arrancar `hosting`.
Con Java 21+:

```bash
npx firebase emulators:start --only functions,firestore,hosting
```

Luego abre:

```bash
http://127.0.0.1:5000
```