import {setGlobalOptions} from "firebase-functions";
import {onRequest} from "firebase-functions/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({maxInstances: 10});

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

function getClientIp(request: {get(name: string): string | undefined; ip?: string}): string {
  const forwardedFor = request.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }

  const realIp = request.get("x-real-ip");
  if (realIp) {
    return realIp;
  }

  return request.ip || "unknown";
}

function aplicarIpWhitelist(
  request: {get(name: string): string | undefined; ip?: string},
  response: any,
  next: () => void,
): void {
  const allowedIps = (process.env.ALLOWED_IPS || "")
      .split(",")
      .map((ip) => ip.trim())
      .filter(Boolean);

  if (allowedIps.length === 0) {
    next();
    return;
  }

  const isEmulator = process.env.FUNCTIONS_EMULATOR === "true";
  const clientIp = getClientIp(request);
  const isLocal = ["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost", "unknown"].includes(clientIp);

  if (isEmulator || isLocal || allowedIps.includes(clientIp)) {
    next();
    return;
  }

  response.status(403).send({error: `IP no autorizada (${clientIp}).`});
}

function normalizeString(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

export const helloWorld = onRequest((request, response) => {
  aplicarIpWhitelist(request, response, () => {
    logger.info("Hello logs!", {structuredData: true});
    response.send("Hello from Firebase!");
  });
});

interface PlaceResult {
  place_id: string;
  name: string;
  formatted_address?: string;
  formatted_phone_number?: string;
  website?: string;
}

interface PlacesApiResponse {
  results: PlaceResult[];
  status: string;
  error_message?: string;
}

interface PlaceDetailsResponse {
  result?: {
    formatted_phone_number?: string;
    website?: string;
  };
  status: string;
}

export const recolectarDirectorio = onRequest(async (request, response) => {
  aplicarIpWhitelist(request, response, async () => {
    const keyword = request.query.keyword as string;
    const zona = request.query.zona as string;
    const especialidad = request.query.especialidad as string;

    if (!keyword || !zona || !especialidad) {
      response.status(400).send({
        error: "Faltan parámetros. Se requiere: keyword, zona, especialidad.",
      });
      return;
    }

    const apiKey = process.env.PLACES_API_KEY;
    if (!apiKey) {
      logger.error("PLACES_API_KEY no está configurada.");
      response.status(500).send({error: "Configuración de API key faltante."});
      return;
    }

    const query = `${keyword} ${zona} Guatemala`;
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${apiKey}`;

    try {
      const apiResponse = await fetch(url);
      const data = (await apiResponse.json()) as PlacesApiResponse;

      if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
        logger.error("Error de Places API", {status: data.status, message: data.error_message});
        response.status(502).send({
          error: "Error consultando Places API.",
          detalle: data.error_message || data.status,
        });
        return;
      }

      const resultados = data.results.slice(0, 20);
      const fechaRecoleccion = new Date().toISOString();

      const batch = db.batch();
      let guardados = 0;

      for (const lugar of resultados) {
        let telefono = lugar.formatted_phone_number || "";
        let sitioWeb = lugar.website || "";

        // Si textsearch no trajo teléfono o sitio web, intentamos con Place Details
        if (!telefono || !sitioWeb) {
          try {
            const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${lugar.place_id}&fields=formatted_phone_number,website&key=${apiKey}`;
            const detailsResponse = await fetch(detailsUrl);
            const detailsData = (await detailsResponse.json()) as PlaceDetailsResponse;

            if (detailsData.status === "OK" && detailsData.result) {
              telefono = telefono || detailsData.result.formatted_phone_number || "";
              sitioWeb = sitioWeb || detailsData.result.website || "";
            }
          } catch (detailsError) {
            logger.warn(`No se pudo obtener detalles para ${lugar.place_id}`, {detailsError});
          }
        }

        const docRef = db.collection("directorio").doc(lugar.place_id);
        batch.set(docRef, {
          nombre: lugar.name,
          especialidad: especialidad,
          direccion: lugar.formatted_address || "",
          telefono: telefono,
          sitio_web: sitioWeb,
          zona: zona,
          place_id: lugar.place_id,
          fecha_recoleccion: fechaRecoleccion,
          keyword_usado: query,
        });
        guardados++;
      }

      await batch.commit();

      logger.info(`Guardados ${guardados} resultados para query: ${query}`);
      response.status(200).send({
        mensaje: "Recolección completada.",
        query_usada: query,
        resultados_guardados: guardados,
      });
    } catch (error) {
      logger.error("Error inesperado", {error});
      response.status(500).send({error: "Error interno al procesar la solicitud."});
    }
  });
});

export const directorioApi = onRequest(async (request, response) => {
  aplicarIpWhitelist(request, response, async () => {
    if (request.method !== "GET") {
      response.status(405).send({error: "Método no permitido. Solo se admite GET."});
      return;
    }

    const pageParam = Number(request.query.page ?? 1);
    const pageSizeParam = Number(request.query.pageSize ?? DEFAULT_PAGE_SIZE);
    const especialidad = typeof request.query.especialidad === "string" ? request.query.especialidad.trim() : "";
    const zona = typeof request.query.zona === "string" ? request.query.zona.trim() : "";

    const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
    let pageSize = Number.isFinite(pageSizeParam) && pageSizeParam > 0 ? pageSizeParam : DEFAULT_PAGE_SIZE;
    pageSize = Math.min(pageSize, MAX_PAGE_SIZE);

    try {
      let docs: admin.firestore.QueryDocumentSnapshot[] = [];
      try {
        let query: admin.firestore.Query = db.collection("directorio");
        if (!especialidad && !zona) {
          query = query.orderBy("fecha_recoleccion", "desc");
        }
        const snapshot = await query.get();
        docs = snapshot.docs;
      } catch (queryErr) {
        logger.warn("Consulta Firestore inicial con ordenamiento falló, recuperando sin ordenamiento", {queryErr});
        const snapshot = await db.collection("directorio").get();
        docs = snapshot.docs;
      }

      let itemsData = docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as Array<any>;

      // Ordenar por fecha_recoleccion desc (más reciente primero)
      itemsData.sort((a, b) => {
        const dateA = a.fecha_recoleccion ? String(a.fecha_recoleccion) : "";
        const dateB = b.fecha_recoleccion ? String(b.fecha_recoleccion) : "";
        return dateB.localeCompare(dateA);
      });

      // Filtrado flexible e insensible a mayúsculas y tildes
      if (especialidad) {
        const normEsp = normalizeString(especialidad);
        itemsData = itemsData.filter((item) => {
          const itemEsp = normalizeString(item.especialidad || "");
          return itemEsp.includes(normEsp) || normEsp.includes(itemEsp);
        });
      }

      if (zona) {
        const normZona = normalizeString(zona);
        itemsData = itemsData.filter((item) => {
          const itemZona = normalizeString(item.zona || "");
          return itemZona.includes(normZona) || normZona.includes(itemZona);
        });
      }

      const total = itemsData.length;
      const start = (page - 1) * pageSize;
      const items = itemsData.slice(start, start + pageSize);

      response.status(200).send({
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        hasNextPage: start + items.length < total,
        items,
      });
    } catch (error) {
      logger.error("Error al consultar directorio", {error});
      response.status(500).send({error: "No se pudo obtener el directorio."});
    }
  });
});

export const sembrarDirectorio = onRequest(async (request, response) => {
  aplicarIpWhitelist(request, response, async () => {
    const fecha = new Date().toISOString();
    const datosSemilla = [
      {
        place_id: "place_demo_1",
        nombre: "Dr. Carlos Mendoza - Cardiólogo",
        especialidad: "Cardiología",
        zona: "Zona 10",
        direccion: "6a Avenida 12-34, Zona 10, Ciudad de Guatemala",
        telefono: "+502 2345-6789",
        sitio_web: "https://ejemplo-cardiologia.gt",
        fecha_recoleccion: fecha,
        keyword_usado: "cardiólogo zona 10 Guatemala",
      },
      {
        place_id: "place_demo_2",
        nombre: "Dra. Ana Lucía Gómez - Pediatra",
        especialidad: "Pediatría",
        zona: "Zona 1",
        direccion: "10a Calle 4-56, Zona 1, Ciudad de Guatemala",
        telefono: "+502 2234-5678",
        sitio_web: "https://ejemplo-pediatria.gt",
        fecha_recoleccion: fecha,
        keyword_usado: "clínica pediátrica zona 1 Guatemala",
      },
      {
        place_id: "place_demo_3",
        nombre: "Dr. Juan Francisco Reyes - Dermatólogo",
        especialidad: "Dermatología",
        zona: "Zona 15",
        direccion: "Bulevar Vista Hermosa 15-20, Zona 15, Ciudad de Guatemala",
        telefono: "+502 2456-7890",
        sitio_web: "https://ejemplo-dermatologia.gt",
        fecha_recoleccion: fecha,
        keyword_usado: "dermatólogo zona 15 Guatemala",
      },
      {
        place_id: "place_demo_4",
        nombre: "Dra. María José Morales - Ginecóloga",
        especialidad: "Ginecología",
        zona: "Zona 9",
        direccion: "7a Avenida 8-90, Zona 9, Ciudad de Guatemala",
        telefono: "+502 2333-4444",
        sitio_web: "https://ejemplo-ginecologia.gt",
        fecha_recoleccion: fecha,
        keyword_usado: "ginecólogo zona 9 Guatemala",
      },
    ];

    const batch = db.batch();
    for (const doc of datosSemilla) {
      const ref = db.collection("directorio").doc(doc.place_id);
      batch.set(ref, doc);
    }
    await batch.commit();

    response.status(200).send({
      mensaje: "Datos de prueba (semilla) insertados exitosamente.",
      total_insertados: datosSemilla.length,
    });
  });
});