/**
 * Cerebro Central de la Plataforma Multi-Tienda (Cloudflare D1 Conectado)
 */

const API_BASE_URL = 'https://api-multistore.ledezmayirbin.workers.dev/api';

/**
 * Obtiene la base de datos completa conectándose a Cloudflare D1.
 */
async function obtenerBaseDatos() {
    try {
        const response = await fetch(`${API_BASE_URL}/obtener-db?_t=${Date.now()}`, {
            cache: 'no-store'
        });
        
        if (!response.ok) throw new Error("Error al conectar con la base de datos en la nube.");
        const data = await response.json();
        
        if (!data || typeof data !== 'object') {
            return {};
        }
        
        return data;
    } catch (err) {
        console.warn("Usando respaldo local por fallo de red:", err);
        const dbLocal = localStorage.getItem('multi_tiendas_db');
        if (!dbLocal) return {};
        try {
            return JSON.parse(dbLocal) || {};
        } catch {
            return {};
        }
    }
}

/**
 * Guarda o actualiza la base de datos completa enviándola al Cloudflare Worker.
 * (Protegido contra el error de cuota excedida de localStorage por imágenes pesadas)
 */
async function guardarBaseDatos(nuevaDb) {
    try {
        // Intentamos guardar en localStorage de forma segura (atrapando el error si las imágenes son muy grandes)
        try {
            localStorage.setItem('multi_tiendas_db', JSON.stringify(nuevaDb));
        } catch (storageErr) {
            console.warn("Aviso: El localStorage se llenó por el peso de las imágenes, pero la nube Cloudflare D1 recibirá los datos.");
        }

        const response = await fetch(`${API_BASE_URL}/guardar-db`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(nuevaDb)
        });

        if (!response.ok) throw new Error("No se pudo sincronizar con Cloudflare D1.");
        return true;
    } catch (err) {
        console.error("Error al guardar en la nube:", err);
        return false;
    }
}

/**
 * Registro rápido y limpio conectado directamente a la API en la nube
 */
async function registrarNuevaTienda({ usuario, password, nombreTienda, whatsapp }) {
    try {
        const response = await fetch(`${API_BASE_URL}/registrar-tienda`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario, password, nombreTienda, whatsapp })
        });

        const resultado = await response.json();
        if (!response.ok) {
            throw new Error(resultado.error || "El nombre de usuario o identificador de tienda ya está en uso. Elige otro.");
        }

        return true;
    } catch (err) {
        throw new Error(err.message);
    }
}

/**
 * Utilidad global para extraer parámetros limpios de la URL (ej: ?tienda=tu_tienda)
 */
function obtenerParametroURL(nombre) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(nombre);
}
