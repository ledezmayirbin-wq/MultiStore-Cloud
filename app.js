/**
 * Cerebro Central de la Plataforma Multi-Tienda (Cloudflare D1 Conectado)
 */

const API_BASE_URL = 'https://tienda1.ledezmayirbin.workers.dev/api';

/**
 * Obtiene la base de datos completa conectándose a Cloudflare D1 mediante el Worker.
 * Si falla la red, utiliza un respaldo local del navegador.
 */
async function obtenerBaseDatos() {
    try {
        const response = await fetch(`${API_BASE_URL}/obtener-db`);
        if (!response.ok) throw new Error("Error al conectar con la base de datos en la nube.");
        const data = await response.json();
        
        // Si la base de datos en la nube está completamente vacía, retorna un objeto vacío
        if (!data || Object.keys(data).length === 0) {
            return {};
        }
        
        return data;
    } catch (err) {
        console.error("Usando respaldo local por fallo de red:", err);
        let dbLocal = localStorage.getItem('multi_tiendas_db');
        if (!dbLocal) {
            let dbVacia = {};
            localStorage.setItem('multi_tiendas_db', JSON.stringify(dbVacia));
            return dbVacia;
        }
        return JSON.parse(dbLocal);
    }
}

/**
 * Guarda o actualiza la base de datos completa enviándola al Cloudflare Worker.
 */
async function guardarBaseDatos(nuevaDb) {
    try {
        localStorage.setItem('multi_tiendas_db', JSON.stringify(nuevaDb)); // Respaldo local

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
