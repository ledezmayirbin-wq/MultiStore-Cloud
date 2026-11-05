/**
 * Cerebro Central de la Plataforma Multi-Tienda (Cloudflare D1 Conectado 100%)
 */

window.API_BASE_URL = 'https://api-multistore.ledezmayirbin.workers.dev/api';
var API_BASE_URL = window.API_BASE_URL;

/**
 * Obtiene la base de datos completa DIRECTAMENTE desde Cloudflare D1.
 */
async function obtenerBaseDatos() {
    try {
        const response = await fetch(`${API_BASE_URL}/obtener-db?_t=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) throw new Error("Error al conectar con la base de datos en la nube.");
        let data = await response.json();
        
        if (!data || typeof data !== 'object') {
            return {};
        }

        const ahora = new Date();
        Object.keys(data).forEach(slug => {
            const tienda = data[slug];
            if (!tienda) return;

            if (!tienda.fechaRegistro) {
                tienda.fechaRegistro = ahora.toISOString();
                if (tienda.diasTotalesOtorgados === undefined) {
                    tienda.diasTotalesOtorgados = tienda.diasSolventes !== undefined ? tienda.diasSolventes : 15;
                }
            }

            if (tienda.fechaRegistro) {
                const fechaReg = new Date(tienda.fechaRegistro);
                const diasOtorgados = tienda.diasTotalesOtorgados || 15;
                const diferenciaMs = ahora - fechaReg;
                const diasPasados = Math.floor(diferenciaMs / (1000 * 60 * 60 * 24));
                
                let diasRestantesReales = diasOtorgados - diasPasados;
                if (diasRestantesReales < 0) diasRestantesReales = 0;
                
                tienda.diasSolventes = diasRestantesReales;
                if (diasRestantesReales === 0 && slug !== 'superadmin') {
                    tienda.bloqueado = true;
                }
            }
        });

        return data;
    } catch (err) {
        console.error("Error crítico de conexión con Cloudflare D1:", err);
        return {};
    }
}

/**
 * Guarda o actualiza la base de datos DIRECTAMENTE en Cloudflare D1.
 */
async function guardarBaseDatos(nuevaDb) {
    try {
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
 * Registro rápido conectado directamente a la API en la nube.
 */
async function registrarNuevaTienda({ usuario, password, nombreTienda, whatsapp }) {
    try {
        const urlFetch = `${window.API_BASE_URL}/registrar-tienda`;
        const response = await fetch(urlFetch, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                usuario,
                password,
                nombreTienda,
                whatsapp,
                fechaRegistro: new Date().toISOString(),
                diasTotalesOtorgados: 15
            })
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
 * Extrae parámetros de la URL de forma limpia (?tienda=slug)
 */
function obtenerParametroURL(nombre) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(nombre);
}
