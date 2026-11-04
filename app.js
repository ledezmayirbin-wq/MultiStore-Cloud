/**
 * Cerebro Central de la Plataforma Multi-Tienda (Cloudflare D1 Conectado)
 */

const API_BASE_URL = 'https://api-multistore.ledezmayirbin.workers.dev/api';

/**
 * Obtiene la base de datos completa conectándose a Cloudflare D1.
 * Aplica el cálculo en tiempo real de días restantes requiriendo 24 horas completas transcurridas.
 */
async function obtenerBaseDatos() {
    try {
        const response = await fetch(`${API_BASE_URL}/obtener-db?_t=${Date.now()}`, {
            cache: 'no-store'
        });
        
        if (!response.ok) throw new Error("Error al conectar con la base de datos en la nube.");
        let data = await response.json();
        
        if (!data || typeof data !== 'object') return {};

        const ahora = new Date();
        let dbModificada = false;

        Object.keys(data).forEach(slug => {
            const tienda = data[slug];

            // 1. Si la tienda no tiene fecha de registro/inicio fijada en la nube:
            if (!tienda.fechaRegistro) {
                tienda.fechaRegistro = ahora.toISOString();
                tienda.diasTotalesOtorgados = tienda.diasSolventes !== undefined ? Number(tienda.diasSolventes) : 15;
                dbModificada = true;
            }

            // 2. CÁLCULO DE DÍAS PASADOS (Requiere 24 Horas Exactas)
            const fechaReg = new Date(tienda.fechaRegistro);
            const diasOtorgados = Number(tienda.diasTotalesOtorgados !== undefined ? tienda.diasTotalesOtorgados : (tienda.diasSolventes || 15));
            const diferenciaMs = ahora - fechaReg;

            // Math.floor exige 24 horas completas (86.400.000 ms) para descontar 1 día
            const diasPasados = Math.floor(diferenciaMs / (1000 * 60 * 60 * 24));
            let diasRestantesReales = diasOtorgados - diasPasados;

            if (diasRestantesReales < 0) diasRestantesReales = 0;

            // Actualizar valor consumido en el panel
            tienda.diasSolventes = diasRestantesReales;

            // 3. SUSPENSIÓN AUTOMÁTICA AL LLEGAR A 0 DÍAS
            const estaBloqueado = tienda.bloqueado === 1 || tienda.bloqueado === true;
            if (diasRestantesReales <= 0 && slug !== 'superadmin') {
                tienda.bloqueado = true;
            }
        });

        // Guardar copia local en localStorage
        try {
            localStorage.setItem('multi_tiendas_db', JSON.stringify(data));
        } catch (e) {
            console.warn("localStorage lleno.");
        }

        // Si se asignó la fechaRegistro inicial a alguna tienda antigua, sincronizar a Cloudflare D1
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
 * Guarda o actualiza la base de datos completa enviándola a Cloudflare D1
 */
async function guardarBaseDatos(nuevaDb) {
    try {
        try {
            localStorage.setItem('multi_tiendas_db', JSON.stringify(nuevaDb));
        } catch (storageErr) {
            console.warn("Aviso: localStorage lleno.");
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
 * Registro de nueva tienda con 15 días de prueba fijados a partir de este instante
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
                diasTotalesOtorgados: 15, 
                diasSolventes: 15 
            })
        });

        const resultado = await response.json();
        if (!response.ok) {
            throw new Error(resultado.error || "El nombre de usuario ya está en uso. Elige otro.");
        }

        return true;
    } catch (err) {
        throw new Error(err.message);
    }
}

/**
 * Utilidad global para extraer parámetros limpios de la URL (?tienda=slug)
 */
function obtenerParametroURL(nombre) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(nombre);
}
