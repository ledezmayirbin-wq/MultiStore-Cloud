/**
 * Cerebro Central de la Plataforma Multi-Tienda (Cloudflare Edge Ready)
 * Este archivo gestiona la base de datos global simulada, el manejo de URLs 
 * y las funciones asíncronas listas para conectar con APIs en la nube.
 */

const DB_STORAGE_KEY = 'multi_tiendas_db';

// Base de datos inicial con tiendas de prueba (incluyendo soporte para colorPrimario)
const baseDatosInicial = {
    "tia_marta": {
        pass: "1234",
        nombreTienda: "Modas Tía Marta",
        logoUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80",
        colorPrimario: "#f59e0b", // Ámbar por defecto
        whatsapp: "584121234567",
        productos: [
            { 
                nombre: "Blusa Elegante Floral", 
                descripcion: "Blusa fresca ideal para verano con estampado de flores.", 
                precio: 25.50, 
                tallas: "S, M, L", 
                colores: "Rojo, Azul", 
                url_imagen: "https://images.unsplash.com/photo-1584273143981-41c073dfe8f8?auto=format&fit=crop&w=500&q=80" 
            }
        ]
    },
    "sofia_style": {
        pass: "5678",
        nombreTienda: "Boutique Sofía",
        logoUrl: "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=200&q=80",
        colorPrimario: "#f59e0b",
        whatsapp: "584149876543",
        productos: [
            { 
                nombre: "Vestido de Noche Verano", 
                descripcion: "Vestido elegante y sofisticado para ocasiones especiales.", 
                precio: 45.00, 
                tallas: "S, M", 
                colores: "Negro, Esmeralda", 
                url_imagen: "https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=500&q=80" 
            }
        ]
    }
};

/**
 * Obtiene la base de datos completa. Si no existe en el navegador, 
 * la inicializa automáticamente con los datos por defecto.
 */
function obtenerBaseDatos() {
    let db = localStorage.getItem(DB_STORAGE_KEY);
    if (!db) {
        localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(baseDatosInicial));
        return baseDatosInicial;
    }
    return JSON.parse(db);
}

/**
 * Guarda o actualiza la base de datos de manera asíncrona.
 * Preparado para futura integración con Cloudflare Worker o base de datos D1.
 */
async function guardarBaseDatos(nuevaDb) {
    return new Promise((resolve) => {
        setTimeout(() => {
            localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(nuevaDb));
            
            /* 
               EJEMPLO DE INTEGRACIÓN FUTURA CON CLOUDFLARE WORKER / API:
               fetch('https://tu-api.workers.dev/actualizar-db', {
                   method: 'POST',
                   headers: { 'Content-Type': 'application/json' },
                   body: JSON.stringify(nuevaDb)
               }).catch(err => console.error("Error sincronizando con Cloudflare:", err));
            */

            resolve(true);
        }, 300);
    });
}

/**
 * Registro rápido y limpio (Sin URL de logotipo obligatoria al inicio)
 */
async function registrarNuevaTienda({ usuario, password, nombreTienda, whatsapp }) {
    let db = obtenerBaseDatos();
    
    if (db[usuario]) {
        throw new Error("El nombre de usuario o identificador de tienda ya está en uso. Elige otro.");
    }

    db[usuario] = {
        pass: password,
        nombreTienda: nombreTienda,
        logoUrl: "",
        colorPrimario: "#f59e0b", // Color por defecto
        whatsapp: whatsapp,
        productos: []
    };

    await guardarBaseDatos(db);
    return true;
}

/**
 * Utilidad global para extraer parámetros limpios de la URL (ej: ?tienda=tia_marta)
 */
function obtenerParametroURL(nombre) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(nombre);
}
