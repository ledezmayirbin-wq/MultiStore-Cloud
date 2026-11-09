/**
 * Cerebro Central de la Plataforma Multi-Tienda (Cloudflare D1 Conectado)
 */

window.API_BASE_URL = 'https://api-multistore.ledezmayirbin.workers.dev/api';
var API_BASE_URL = window.API_BASE_URL;

/**
 * Obtiene la base de datos completa conectándose a Cloudflare D1.
 * Sincroniza y calcula los días solventes de forma precisa con el servidor.
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
        let dbModificada = false;

        Object.keys(data).forEach(slug => {
            const tienda = data[slug];
            if (!tienda) return;

            // Tomamos los días que vienen directamente de la base de datos
            const diasEnDb = tienda.diasSolventes !== undefined ? Number(tienda.diasSolventes) : 15;

            // SINCRONIZACIÓN AUTOMÁTICA INTELIGENTE:
            // Si la tienda no tiene registro o TÚ cambiaste los días manualmente en la BD, 
            // el sistema actualiza el punto de partida a hoy para que coincida exactamente.
            if (!tienda.fechaRegistro || tienda.diasTotalesOtorgados === undefined || tienda.diasTotalesOtorgados !== diasEnDb) {
                tienda.fechaRegistro = ahora.toISOString();
                tienda.diasTotalesOtorgados = diasEnDb;
                dbModificada = true;
            }

            // Cálculo automático en tiempo real: A partir de hoy, empezará a descontar con el paso de los días
            if (tienda.fechaRegistro) {
                const fechaReg = new Date(tienda.fechaRegistro);
                const diasOtorgados = tienda.diasTotalesOtorgados;
                
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

        // Si detectó un cambio manual en la BD, actualizamos la referencia en la nube
        if (dbModificada) {
            guardarBaseDatos(data);
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
 */
async function guardarBaseDatos(nuevaDb) {
    try {
        try {
            localStorage.setItem('multi_tiendas_db', JSON.stringify(nuevaDb));
        } catch (storageErr) {
            console.warn("Aviso: El localStorage se llenó, pero la nube Cloudflare D1 recibirá los datos.");
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
 * Registro rápido y limpio conectado directamente a la API en la nube.
 */
async function registrarNuevaTienda({ usuario, password, nombreTienda, whatsapp }) {
    try {
        const response = await fetch(`${API_BASE_URL}/registrar-tienda`, {
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
 * Utilidad global para extraer parámetros limpios de la URL (ej: ?tienda=tu_tienda)
 */
function obtenerParametroURL(nombre) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(nombre);
}
