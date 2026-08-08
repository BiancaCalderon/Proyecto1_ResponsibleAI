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

  const clientIp = getClientIp(request);
  if (!allowedIps.includes(clientIp)) {
    response.status(403).send({error: "IP no autorizada."});
    return;
  }

  next();
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
        const docRef = db.collection("directorio").doc(lugar.place_id);
        batch.set(docRef, {
          nombre: lugar.name,
          especialidad: especialidad,
          direccion: lugar.formatted_address || "",
          telefono: lugar.formatted_phone_number || "",
          sitio_web: lugar.website || "",
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
      let query = db.collection("directorio").orderBy("fecha_recoleccion", "desc");

      if (especialidad) {
        query = query.where("especialidad", "==", especialidad);
      }

      if (zona) {
        query = query.where("zona", "==", zona);
      }

      const snapshot = await query.get();
      const total = snapshot.size;
      const start = (page - 1) * pageSize;
      const items = snapshot.docs.slice(start, start + pageSize).map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

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