import {setGlobalOptions} from "firebase-functions";
import {onRequest} from "firebase-functions/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({maxInstances: 10});

export const helloWorld = onRequest((request, response) => {
  logger.info("Hello logs!", {structuredData: true});
  response.send("Hello from Firebase!");
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

export const recolectarDirectorio = onRequest(
  async (request, response) => {
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
      const fecha_recoleccion = new Date().toISOString();

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
          fecha_recoleccion: fecha_recoleccion,
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
  }
);