MultiStore Cloud - Cerebro Técnico
App.js:
/**
 * Cerebro Central de la Plataforma Multi-Tienda (Cloudflare D1 Conectado)
 */

const API_BASE_URL = 'https://api-multistore.ledezmayirbin.workers.dev/api';

/**
 * Obtiene la base de datos completa conectándose a Cloudflare D1.
 * Aplica el cálculo en tiempo real de los días restantes basados en la fecha de registro.
 */
async function obtenerBaseDatos() {
    try {
        const response = await fetch(`${API_BASE_URL}/obtener-db?_t=${Date.now()}`, {
            cache: 'no-store'
        });
        
        if (!response.ok) throw new Error("Error al conectar con la base de datos en la nube.");
        let data = await response.json();
        
        if (!data || typeof data !== 'object') {
            return {};
        }

        // Procesar automáticamente los días restantes reales para cada tienda
        const ahora = new Date();
        let dbModificada = false;

        Object.keys(data).forEach(slug => {
            const tienda = data[slug];
            
            // Si la tienda es antigua y no tiene fecha de registro guardada, 
            // establecemos hoy como su punto de partida real para que el descuento empiece a correr desde este momento.
            if (!tienda.fechaRegistro) {
                tienda.fechaRegistro = ahora.toISOString();
                // Si ya tenía días asignados (ej: 90 o 15), los respetamos como su total inicial
                if (tienda.diasTotalesOtorgados === undefined) {
                    tienda.diasTotalesOtorgados = tienda.diasSolventes !== undefined ? tienda.diasSolventes : 15;
                }
                dbModificada = true;
            }

            // Cálculo en tiempo real basado en la fecha de registro
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

        // Sincronizar si se fijó la fecha base por primera vez
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
 * (Protegido contra el error de cuota excedida de localStorage por imágenes pesadas)
 */
async function guardarBaseDatos(nuevaDb) {
    try {
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
 * Registro rápido y limpio conectado directamente a la API en la nube.
 * Se asegura de enviar la fecha de registro y los 15 días iniciales por defecto.
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

auth-guard.js:
/**
 * Auth Guard - MultiStore Cloud
 * Protege las rutas de administración y superadmin verificando sesiones y días solventes.
 */
(function () {
    const paginaActual = window.location.pathname.split("/").pop();

    // 1. EVALUAR RUTA DE SUPERADMIN
    if (paginaActual === "superadmin.html") {
        const sesionSuper = localStorage.getItem("sesion_superadmin");
        if (!sesionSuper) {
            alert("Acceso denegado: Se requiere rol de Superadministrador.");
            window.location.href = "login.html";
            return;
        }
        // Si existe la sesión de superadmin, permitimos el paso libre
        return;
    }

    // 2. EVALUAR RUTA DE ADMINISTRADOR DE TIENDA (admin.html)
    if (paginaActual === "admin.html" || paginaActual === "admin_2.html") {
        const tiendaSlug = localStorage.getItem("sesion_vendedor");

        // Verificar si existe el token de sesión del vendedor
        if (!tiendaSlug) {
            alert("Acceso denegado: Debe iniciar sesión con su tienda para acceder al panel.");
            window.location.href = "login.html";
            return;
        }

        // Validación cruzada de la base de datos (Cloudflare / LocalStorage) para chequear bloqueo o vencimiento
        try {
            const dbLocal = localStorage.getItem("multi_tiendas_db");
            if (dbLocal) {
                const db = JSON.parse(dbLocal);
                const tienda = db[tiendaSlug.trim().toLowerCase()];

                if (tienda) {
                    // Verificar si la tienda está bloqueada por suscripción vencida
                    if (tienda.bloqueado === true || Number(tienda.diasSolventes) <= 0) {
                        // Si ya está en la pantalla de vencido o el panel, el script de admin se encarga 
                        // de mostrar la vista de renovación, pero aquí podemos forzar una alerta si intentan evadirlo.
                        console.warn("Aviso de seguridad: La tienda tiene la suscripción inactiva.");
                    }
                }
            }
        } catch (e) {
            console.error("Error al validar el estado de la tienda en el AuthGuard:", e);
        }
    }
})();

// Función auxiliar global para limpiar sesiones y expulsar al login
function cerrarSesionYSalir() {
    localStorage.removeItem("sesion_vendedor");
    localStorage.removeItem("sesion_superadmin");
    window.location.href = "login.html";
}

index.html:

<!DOCTYPE html>
<html lang="es" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Plataforma Multi-Tienda - Cloudflare Edge</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = {
            darkMode: 'class',
            theme: {
                extend: {
                    colors: {
                        darkbg: '#0f172a',
                        cardbg: '#1e293b',
                    }
                }
            }
        }
    </script>
</head>
<body id="page-body" class="bg-darkbg text-slate-100 font-sans min-h-screen flex flex-col justify-between selection:bg-amber-500 selection:text-white">

    <header class="w-full border-b border-slate-800/80 backdrop-blur-md bg-darkbg/80 sticky top-0 z-50 shadow-md">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 h-16 sm:h-20 flex items-center justify-between">
            <div class="flex items-center space-x-2.5 cursor-pointer group" onclick="regresarInicio()">
                <div id="header-logo" class="h-9 w-9 sm:h-11 sm:w-11 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/30 overflow-hidden border border-slate-700 group-hover:scale-105 transition-transform">
                    <svg class="w-5 h-5 sm:w-6 sm:h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"></path>
                    </svg>
                </div>
                <span id="header-store-name" class="text-base sm:text-xl font-bold tracking-tight bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent truncate max-w-[140px] sm:max-w-xs">MultiStore Cloud</span>
            </div>
            <div id="nav-info" class="text-xs sm:text-sm text-slate-400 font-medium"></div>
        </div>
    </header>

    <!-- Contenedor principal -->
    <main class="max-w-7xl mx-auto px-3 sm:px-6 py-6 sm:py-8 flex-grow w-full">
        
        <!-- VISTA 1: Bienvenida -->
        <div id="view-welcome" class="max-w-4xl mx-auto text-center space-y-8 sm:space-y-12 transition-all duration-300 pt-4 sm:pt-8">
            <div class="space-y-3 sm:space-y-4">
                <span class="inline-flex items-center px-3 py-1 rounded-full text-[11px] sm:text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 shadow-sm">
                    Plataforma Global Multi-Tienda
                </span>
                <h1 class="text-3xl sm:text-6xl font-black tracking-tight text-white leading-tight">
                    Bienvenido a tu ecosistema <span class="bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent">digital</span>
                </h1>
                <p class="text-sm sm:text-lg text-slate-400 max-w-2xl mx-auto px-2">
                    Selecciona cómo deseas ingresar a la plataforma el día de hoy para continuar con tu experiencia personalizada.
                </p>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 max-w-2xl mx-auto pt-2 sm:pt-4">
                <button onclick="mostrarVistaCliente()" class="group relative p-6 sm:p-8 rounded-2xl sm:rounded-3xl bg-cardbg border border-slate-800 hover:border-amber-500/50 transition-all duration-300 hover:shadow-2xl hover:shadow-amber-500/10 text-left flex flex-col justify-between">
                    <div class="absolute inset-0 bg-gradient-to-b from-amber-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-3xl"></div>
                    <div class="relative z-10 space-y-3 sm:space-y-4">
                        <div class="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-amber-500/10 text-amber-400 flex items-center justify-center border border-amber-500/20 group-hover:scale-110 transition-transform">
                            <svg class="w-6 h-6 sm:w-7 sm:h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"></path>
                            </svg>
                        </div>
                        <div>
                            <h2 class="text-xl sm:text-2xl font-bold text-white group-hover:text-amber-400 transition-colors">Soy Cliente</h2>
                            <p class="text-xs sm:text-sm text-slate-400 mt-1">Explora catálogos de tiendas y realiza pedidos directos por WhatsApp.</p>
                        </div>
                    </div>
                    <div class="relative z-10 pt-6 sm:pt-8 flex items-center text-xs sm:text-sm font-semibold text-amber-400">
                        <span>Explorar tiendas</span>
                        <svg class="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
                        </svg>
                    </div>
                </button>

                <button onclick="window.location.href='login.html'" class="group relative p-6 sm:p-8 rounded-2xl sm:rounded-3xl bg-cardbg border border-slate-800 hover:border-orange-500/50 transition-all duration-300 hover:shadow-2xl hover:shadow-orange-500/10 text-left flex flex-col justify-between">
                    <div class="absolute inset-0 bg-gradient-to-b from-orange-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-3xl"></div>
                    <div class="relative z-10 space-y-3 sm:space-y-4">
                        <div class="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-orange-500/10 text-orange-400 flex items-center justify-center border border-orange-500/20 group-hover:scale-110 transition-transform">
                            <svg class="w-6 h-6 sm:w-7 sm:h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
                            </svg>
                        </div>
                        <div>
                            <h2 class="text-xl sm:text-2xl font-bold text-white group-hover:text-orange-400 transition-colors">Soy Administrador</h2>
                            <p class="text-xs sm:text-sm text-slate-400 mt-1">Inicia sesión para gestionar el inventario y personalizar tu tienda.</p>
                        </div>
                    </div>
                    <div class="relative z-10 pt-6 sm:pt-8 flex items-center text-xs sm:text-sm font-semibold text-orange-400">
                        <span>Iniciar sesión</span>
                        <svg class="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
                        </svg>
                    </div>
                </button>
            </div>
        </div>

        <!-- VISTA 2: Selector de Tiendas -->
        <div id="vista-selector-tiendas" class="w-full space-y-6 sm:space-y-8 hidden">
            <div class="flex items-center justify-between border-b border-slate-800 pb-4">
                <div>
                    <button onclick="regresarInicio()" class="text-xs font-semibold text-amber-400 hover:text-amber-300 flex items-center mb-1">
                        ← Volver al inicio
                    </button>
                    <h2 class="text-2xl sm:text-3xl font-black text-white">Explora nuestras tiendas</h2>
                    <p class="text-slate-400 text-xs sm:text-sm">Elige la tienda de tu preferencia para ver su catálogo exclusivo.</p>
                </div>
            </div>

            <div class="max-w-md mx-auto">
                <input type="text" id="input-buscar-tienda" oninput="filtrarTiendas()" placeholder="Buscar tienda por nombre..." class="w-full bg-cardbg border border-slate-800 rounded-2xl px-5 py-3 text-xs sm:text-sm text-white focus:outline-none focus:border-amber-500 placeholder-slate-500 shadow-inner">
            </div>

            <div id="grid-lista-tiendas" class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6 pt-2"></div>
        </div>
        
        <!-- VISTA 3: Vitrina de Productos con Búsqueda y Categorías Inteligentes -->
        <div id="vista-vitrina-productos" class="w-full space-y-6 sm:space-y-8 hidden">
            <div class="flex items-center justify-between border-b border-slate-800 pb-4">
                <div>
                    <button onclick="mostrarVistaCliente()" class="text-xs font-semibold text-amber-400 hover:text-amber-300 flex items-center mb-1">
                        ← Volver al listado
                    </button>
                    <h2 id="vitrina-titulo" class="text-xl sm:text-2xl font-black text-white">Catálogo de Productos</h2>
                    <p class="text-[11px] sm:text-xs text-slate-400">Haz clic en cualquier producto para ver su vista previa ampliada y pedir vía WhatsApp.</p>
                </div>
            </div>

            <!-- BARRA DE BÚSQUEDA Y FILTROS INTELIGENTES POR CATEGORÍA -->
            <div class="space-y-3 pb-2">
                <div class="w-full">
                    <input type="text" id="input-buscar-producto" oninput="filtrarProductosVitrina()" placeholder="Buscar producto en esta tienda..." class="w-full bg-cardbg border border-slate-800 rounded-2xl px-4 py-3 text-xs sm:text-sm text-white focus:outline-none focus:border-amber-500 placeholder-slate-500 shadow-inner">
                </div>
                <!-- Contenedor dinámico: Solo muestra las categorías que tienen stock real -->
                <div id="contenedor-categorias-dinamicas" class="flex flex-wrap gap-2 pt-1"></div>
            </div>

            <div id="grid-productos-tienda" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-6">
                <div class="col-span-full text-center py-20 text-slate-400">
                    <div class="spinner-border text-amber-500 mb-2" role="status"></div>
                    <p class="text-xs">Cargando catálogo...</p>
                </div>
            </div>
        </div>

    </main>

    <!-- MODAL DE VISTA PREVIA AMPLIADA DEL PRODUCTO -->
    <div class="modal fade" id="modalDetalleProducto" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered modal-lg">
            <div class="modal-content bg-cardbg border border-slate-800 text-white rounded-3xl p-4 sm:p-6 shadow-2xl relative">
                <button type="button" class="btn-close btn-close-white absolute top-4 right-4" data-bs-dismiss="modal" aria-label="Close"></button>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                    <div class="bg-white p-2 rounded-2xl shadow-inner border border-slate-700 flex items-center justify-center">
                        <img id="modal-prod-img" src="" alt="Producto" class="w-full h-64 sm:h-80 object-cover rounded-xl">
                    </div>
                    <div class="space-y-4 text-left">
                        <span id="modal-prod-categoria-badge" class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 uppercase"></span>
                        <h3 id="modal-prod-nombre" class="text-xl sm:text-2xl font-black text-white"></h3>
                        <div id="modal-prod-precio" class="text-2xl sm:text-3xl font-black text-emerald-400"></div>
                        <p id="modal-prod-desc" class="text-xs sm:text-sm text-slate-300 leading-relaxed"></p>
                        <div class="space-y-1 text-xs text-slate-400 font-mono pt-2 border-t border-slate-800">
                            <p id="modal-linea-tallas"><strong>Tallas:</strong> <span id="modal-prod-tallas" class="text-white"></span></p>
                            <p><strong>Colores:</strong> <span id="modal-prod-colores" class="text-white"></span></p>
                        </div>
                        <div class="pt-2">
                            <a id="modal-prod-btn-whatsapp" href="#" target="_blank" class="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold py-3 px-5 rounded-xl transition shadow-lg flex items-center justify-center gap-2 text-xs sm:text-sm">
                                🛍️ Pedir por WhatsApp
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <footer class="w-full border-t border-slate-800 py-6 text-center text-xs text-slate-500">
        Plataforma Multi-Tienda Cloudflare Edge &copy; 2026.
    </footer>

    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
    <script src="app.js"></script>
    <script>
        let dbCache = null;
        let modalProductoBootstrap = null;
        let tiendaWhatsAppGlobal = "";
        let slugTiendaActual = "";
        let categoriaFiltroActual = "todos";

        document.addEventListener('DOMContentLoaded', async () => {
            modalProductoBootstrap = new bootstrap.Modal(document.getElementById('modalDetalleProducto'));
            slugTiendaActual = obtenerParametroURL('tienda');
            
            if (slugTiendaActual) {
                document.getElementById('view-welcome').classList.add('hidden');
            }

            dbCache = await obtenerBaseDatos();

            if (slugTiendaActual && dbCache[slugTiendaActual]) {
                cargarVitrinaTienda(slugTiendaActual, dbCache);
            } else {
                regresarInicio();
            }
        });

        async function mostrarVistaCliente() {
            document.getElementById('view-welcome').classList.add('hidden');
            document.getElementById('vista-vitrina-productos').classList.add('hidden');
            document.getElementById('vista-selector-tiendas').classList.remove('hidden');

            dbCache = await obtenerBaseDatos();
            renderizarListaTiendas(dbCache);
        }

        function cargarVitrinaTienda(slugTienda, db) {
            document.getElementById('view-welcome').classList.add('hidden');
            document.getElementById('vista-selector-tiendas').classList.add('hidden');
            document.getElementById('vista-vitrina-productos').classList.remove('hidden');

            const tienda = db[slugTienda];
            tiendaWhatsAppGlobal = (tienda.whatsapp || "").replace(/\D/g, '');

            const estaBloqueada = tienda.bloqueado === 1 || tienda.bloqueado === true;
            if (estaBloqueada) {
                document.getElementById('vista-vitrina-productos').innerHTML = `
                    <div class="max-w-md mx-auto text-center py-20 space-y-4 bg-cardbg border border-slate-800 rounded-3xl p-8 shadow-2xl">
                        <div class="w-16 h-16 bg-rose-500/10 text-rose-500 rounded-2xl flex items-center justify-center mx-auto border border-rose-500/20">
                            <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                        </div>
                        <h2 class="text-2xl font-black text-white">Tienda Temporalmente Suspendida</h2>
                        <p class="text-sm text-slate-400">Este comercio se encuentra inactivo en este momento por actualización de suscripción o falta de pago.</p>
                        <button onclick="regresarInicio()" class="btn btn-warning fw-bold rounded-xl px-6 py-2.5 text-xs text-dark mt-2">← Volver al inicio</button>
                    </div>
                `;
                return;
            }
            document.getElementById('header-store-name').textContent = tienda.nombreTienda;
            if (tienda.logoUrl) {
                document.getElementById('header-logo').innerHTML = `<img src="${tienda.logoUrl}" class="w-full h-full object-cover">`;
            }

            document.getElementById('vitrina-titulo').textContent = `Catálogo de ${tienda.nombreTienda}`;
            
            // Construir botones dinámicamente según lo que tenga la tienda
            construirBotonesCategoriasDinamicos(tienda.productos || []);
            categoriaFiltroActual = 'todos';
            renderizarProductosFiltrados();
        }

        function construirBotonesCategoriasDinamicos(productos) {
            const contenedor = document.getElementById('contenedor-categorias-dinamicas');
            contenedor.innerHTML = "";

            const categoriasExistentes = [...new Set(productos.map(p => p.categoria || 'prendas'))];

            let htmlBotones = `<button onclick="filtrarPorCategoria('todos')" id="cat-btn-todos" class="bg-amber-500 text-dark font-bold px-4 py-2 rounded-xl text-xs transition shadow-sm">Todos</button>`;

            const nombresLegibles = {
                'prendas': 'Prendas y Ropa',
                'calzado': 'Calzado',
                'accesorios': 'Accesorios'
            };

            categoriasExistentes.forEach(cat => {
                const nombreMostrar = nombresLegibles[cat] || cat;
                htmlBotones += `<button onclick="filtrarPorCategoria('${cat}')" id="cat-btn-${cat}" class="bg-cardbg hover:bg-slate-800 text-slate-300 font-bold px-4 py-2 rounded-xl text-xs transition border border-slate-800">${nombreMostrar}</button>`;
            });

            contenedor.innerHTML = htmlBotones;
        }

        function filtrarPorCategoria(categoria) {
            categoriaFiltroActual = categoria;
            const botones = document.getElementById('contenedor-categorias-dinamicas').querySelectorAll('button');
            botones.forEach(btn => {
                if (btn.id === `cat-btn-${categoria}`) {
                    btn.className = "bg-amber-500 text-dark font-bold px-4 py-2 rounded-xl text-xs transition shadow-sm";
                } else {
                    btn.className = "bg-cardbg hover:bg-slate-800 text-slate-300 font-bold px-4 py-2 rounded-xl text-xs transition border border-slate-800";
                }
            });
            renderizarProductosFiltrados();
        }

        function filtrarProductosVitrina() {
            renderizarProductosFiltrados();
        }

        function renderizarProductosFiltrados() {
            if (!dbCache || !slugTiendaActual || !dbCache[slugTiendaActual]) return;
            const tienda = dbCache[slugTiendaActual];
            const textoBusqueda = document.getElementById('input-buscar-producto').value.toLowerCase().trim();
            const gridProductos = document.getElementById('grid-productos-tienda');
            gridProductos.innerHTML = "";

            let productos = tienda.productos || [];

            if (categoriaFiltroActual !== 'todos') {
                productos = productos.filter(p => (p.categoria || 'prendas') === categoriaFiltroActual);
            }

            if (textoBusqueda) {
                productos = productos.filter(p => p.nombre.toLowerCase().includes(textoBusqueda) || (p.descripcion || '').toLowerCase().includes(textoBusqueda));
            }

            if (productos.length === 0) {
                gridProductos.innerHTML = `<p class="col-span-full text-center text-slate-500 py-12 text-sm bg-cardbg/40 border border-slate-800 rounded-2xl">No se encontraron productos con estos criterios.</p>`;
                return;
            }

            productos.forEach((prod) => {
                const idxReal = tienda.productos.findIndex(p => p === prod);
                const catProd = prod.categoria || 'prendas';
                let infoDetalle = `Tallas: ${prod.tallas || 'Única'}`;
                if (catProd === 'calzado') infoDetalle = `Tallas: ${prod.tallasCalzado || 'N/D'}`;
                if (catProd === 'accesorios') infoDetalle = `Material: ${prod.especificacion || 'N/D'}`;

                const mensaje = encodeURIComponent(`Hola, me interesa el producto "${prod.nombre}" ($${parseFloat(prod.precio || 0).toFixed(2)}). ¿Está disponible?`);
                const linkWhatsApp = `https://wa.me/${tiendaWhatsAppGlobal}?text=${mensaje}`;

                gridProductos.innerHTML += `
                    <div onclick="abrirVistaPreviaProducto(${idxReal})" class="group bg-cardbg border border-slate-800/80 hover:border-amber-500/50 rounded-2xl sm:rounded-3xl overflow-hidden flex flex-col justify-between shadow-xl hover:shadow-2xl hover:shadow-amber-500/10 transition-all duration-300 hover:-translate-y-1 cursor-pointer">
                        <div>
                            <div class="h-36 sm:h-52 w-full bg-slate-900 overflow-hidden relative">
                                <img src="${prod.url_imagen || ''}" alt="${prod.nombre}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500">
                                <span class="absolute top-2 left-2 px-2 py-0.5 bg-slate-950/80 backdrop-blur text-amber-400 text-[9px] font-bold uppercase rounded-lg border border-slate-700">${catProd}</span>
                            </div>
                            <div class="p-3 sm:p-5 space-y-1.5 sm:space-y-2">
                                <h3 class="font-bold text-xs sm:text-base text-white group-hover:text-amber-400 transition-colors line-clamp-1">${prod.nombre}</h3>
                                <p class="text-[10px] sm:text-sm text-slate-400 line-clamp-2 leading-relaxed">${prod.descripcion || 'Sin descripción.'}</p>
                                <div class="hidden sm:flex flex-wrap gap-1.5 pt-1">
                                    <span class="text-[10px] font-medium bg-slate-900/80 text-slate-300 px-2 py-0.5 rounded-lg border border-slate-800">${infoDetalle}</span>
                                </div>
                            </div>
                        </div>
                        <div class="p-3 sm:p-5 pt-0 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 mt-auto">
                            <div class="flex flex-col">
                                <span class="text-[9px] uppercase font-bold text-slate-400 tracking-wider">Precio</span>
                                <span class="text-xs sm:text-xl font-black text-emerald-400">$${parseFloat(prod.precio || 0).toFixed(2)}</span>
                            </div>
                            <a href="${linkWhatsApp}" target="_blank" onclick="event.stopPropagation()" class="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-[10px] sm:text-xs font-bold px-3 py-2 sm:px-4 sm:py-2.5 rounded-xl transition-all duration-300 shadow-md text-center flex items-center justify-center gap-1">
                                Pedir
                            </a>
                        </div>
                    </div>
                `;
            });
        }

        async function abrirVistaPreviaProducto(indexProd) {
            if (!dbCache || !dbCache[slugTiendaActual]) return;
            const tienda = dbCache[slugTiendaActual];
            const prod = tienda.productos[indexProd];
            if (!prod) return;

            const catProd = prod.categoria || 'prendas';
            document.getElementById('modal-prod-img').src = prod.url_imagen || '';
            document.getElementById('modal-prod-categoria-badge').textContent = catProd;
            document.getElementById('modal-prod-nombre').textContent = prod.nombre;
            document.getElementById('modal-prod-precio').textContent = `$${parseFloat(prod.precio || 0).toFixed(2)} USD`;
            document.getElementById('modal-prod-desc').textContent = prod.descripcion || 'Sin descripción detallada para este artículo.';
            
            const lineaTallas = document.getElementById('modal-linea-tallas');
            if (catProd === 'accesorios') {
                lineaTallas.innerHTML = `<strong>Especificación:</strong> <span class="text-white">${prod.especificacion || 'N/D'}</span>`;
            } else if (catProd === 'calzado') {
                lineaTallas.innerHTML = `<strong>Tallas (Calzado):</strong> <span class="text-white">${prod.tallasCalzado || 'N/D'}</span>`;
            } else {
                lineaTallas.innerHTML = `<strong>Tallas (Ropa):</strong> <span class="text-white">${prod.tallas || 'Única'}</span>`;
            }

            document.getElementById('modal-prod-colores').textContent = prod.colores || 'Varios';

            const mensaje = encodeURIComponent(`Hola, me interesa el producto "${prod.nombre}" ($${parseFloat(prod.precio || 0).toFixed(2)}). ¿Está disponible?`);
            document.getElementById('modal-prod-btn-whatsapp').href = `https://wa.me/${tiendaWhatsAppGlobal}?text=${mensaje}`;

            modalProductoBootstrap.show();
        }

        function renderizarListaTiendas(tiendasObj) {
            const gridTiendas = document.getElementById('grid-lista-tiendas');
            gridTiendas.innerHTML = "";
            const slugs = Object.keys(tiendasObj || {});

            if (slugs.length === 0) {
                gridTiendas.innerHTML = `<p class="col-span-full text-center text-slate-500 py-12">No hay tiendas registradas.</p>`;
                return;
            }

            slugs.forEach(slug => {
                const tienda = tiendasObj[slug];
                const logoHtml = tienda.logoUrl ? `<img src="${tienda.logoUrl}" class="w-full h-full object-cover">` : `<span class="text-xl font-bold text-amber-400">${(tienda.nombreTienda || 'T').charAt(0)}</span>`;

                gridTiendas.innerHTML += `
                    <div onclick="window.location.href='index.html?tienda=${slug}'" class="bg-cardbg border border-slate-800/80 hover:border-slate-600 rounded-2xl sm:rounded-3xl p-5 sm:p-6 cursor-pointer transition-all duration-300 hover:shadow-2xl hover:-translate-y-1 flex flex-col justify-between space-y-4 group">
                        <div class="flex items-center space-x-4">
                            <div class="h-12 w-12 sm:h-14 sm:w-14 rounded-2xl bg-slate-900 flex items-center justify-center overflow-hidden border border-slate-700/80 group-hover:scale-105 transition-transform shrink-0">
                                ${logoHtml}
                            </div>
                            <div class="min-w-0">
                                <h3 class="font-bold text-base sm:text-lg text-white group-hover:text-amber-400 transition-colors truncate">${tienda.nombreTienda}</h3>
                                <p class="text-xs text-slate-400">${(tienda.productos || []).length} productos disponibles</p>
                            </div>
                        </div>
                        <div class="pt-2 flex items-center justify-between text-xs font-semibold text-amber-400">
                            <span>Visitar catálogo</span>
                            <span class="group-hover:translate-x-1 transition-transform">→</span>
                        </div>
                    </div>
                `;
            });
        }

        function filtrarTiendas() {
            const texto = document.getElementById('input-buscar-tienda').value.toLowerCase();
            const db = dbCache || {};
            const tiendasFiltradas = {};

            Object.keys(db).forEach(slug => {
                if (db[slug].nombreTienda && db[slug].nombreTienda.toLowerCase().includes(texto)) {
                    tiendasFiltradas[slug] = db[slug];
                }
            });

            renderizarListaTiendas(tiendasFiltradas);
        }

        function regresarInicio() {
            window.history.pushState({}, '', window.location.pathname);
            slugTiendaActual = "";
            document.getElementById('vista-vitrina-productos').classList.add('hidden');
            document.getElementById('vista-selector-tiendas').classList.add('hidden');
            document.getElementById('view-welcome').classList.remove('hidden');

            document.getElementById('header-store-name').textContent = "MultiStore Cloud";
            document.getElementById('header-logo').innerHTML = `<svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"></path></svg>`;
        }
    </script>
</body>
</html>


admin.html:

<!DOCTYPE html>
<html lang="es" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Panel de Administración - MultiStore Cloud</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = {
            darkMode: 'class',
            theme: {
                extend: {
                    colors: {
                        darkbg: '#0f172a',
                        cardbg: '#1e293b',
                    }
                }
            }
        }
    </script>
</head>
<body class="bg-darkbg text-slate-100 font-sans min-h-screen flex flex-col justify-between selection:bg-amber-500 selection:text-white">
<style>
    input[type="text"],
    input[type="password"],
    input[type="email"],
    input[type="number"],
    input[type="url"],
    input[type="file"],
    textarea,
    select,
    .form-control {
        background-color: #0b0f19 !important;
        color: #ffffff !important;
        border-color: #334155 !important;
    }

    input:-webkit-autofill,
    input:-webkit-autofill:hover,
    input:-webkit-autofill:focus,
    textarea:-webkit-autofill,
    textarea:-webkit-autofill:hover,
    textarea:-webkit-autofill:focus {
        -webkit-text-fill-color: #ffffff !important;
        -webkit-box-shadow: 0 0 0px 1000px #0b0f19 inset !important;
        transition: background-color 5000s ease-in-out 0s;
    }

    input:focus,
    textarea:focus,
    select:focus,
    .form-control:focus {
        background-color: #0b0f19 !important;
        color: #ffffff !important;
        border-color: #f59e0b !important;
        box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.2) !important;
    }

    ::placeholder {
        color: #64748b !important;
        opacity: 1 !important;
    }
</style>
    <header class="w-full border-b border-slate-800 backdrop-blur-md bg-darkbg/80 sticky top-0 z-50">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 h-16 sm:h-20 flex items-center justify-between">
            <div class="flex items-center space-x-2.5">
                <div id="nav-logo-container" class="h-9 w-9 sm:h-10 sm:w-10 rounded-xl bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center shadow-lg overflow-hidden border border-slate-700">
                    <svg class="w-5 h-5 sm:w-6 sm:h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"></path></svg>
                </div>
                <div>
                    <span id="nav-store-name" class="text-sm sm:text-lg font-bold tracking-tight text-white block truncate max-w-[120px] sm:max-w-xs">Mi Tienda</span>
                    <span class="text-[10px] sm:text-xs text-slate-400">Cloudflare Edge</span>
                </div>
            </div>
            <div class="flex items-center space-x-2 sm:space-x-4">
                <a id="link-ver-tienda" href="#" target="_blank" class="btn btn-outline-light btn-sm rounded-xl px-2.5 py-1.5 sm:px-3 sm:py-2 text-[11px] sm:text-xs font-semibold">
                    Ver Vitrina ↗
                </a>
                <button onclick="cerrarSesion()" class="btn btn-danger btn-sm rounded-xl px-2.5 py-1.5 sm:px-3 sm:py-2 text-[11px] sm:text-xs font-semibold">
                    Salir
                </button>
            </div>
        </div>
    </header>

    <main class="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-10 flex-grow w-full space-y-6 sm:space-y-10">
        
        <!-- PANTALLA DE BLOQUEO / SUSCRIPCIÓN VENCIDA -->
        <section id="pantalla-suscripcion-vencida" class="hidden max-w-xl mx-auto my-12 bg-cardbg border border-rose-500/30 rounded-3xl p-6 sm:p-8 shadow-2xl text-center space-y-6">
            <div class="w-16 h-16 bg-rose-500/10 text-rose-500 rounded-2xl flex items-center justify-center mx-auto border border-rose-500/20 shadow-inner">
                <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
            </div>
            
            <div class="space-y-2">
                <span class="px-3 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                    Suscripción Inactiva
                </span>
                <h2 class="text-2xl font-black text-white">Tu tienda está suspendida</h2>
                <p class="text-xs sm:text-sm text-slate-400 leading-relaxed">
                    El periodo de vigencia ha expirado. Elige tu plan ($5 mensual, $14 trimestral o $40 anual) para reactivar tu acceso de forma inmediata.
                </p>
            </div>

            <div class="pt-2">
                <a id="link-renovar-whatsapp" href="#" target="_blank" class="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold py-3.5 px-6 rounded-xl transition shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2 text-xs sm:text-sm">
                    Reportar Pago y Renovar por WhatsApp
                </a>
            </div>
        </section>

        <!-- BANNER DE ALERTA DE DÍAS -->
        <div id="alerta-suscripcion-banner" class="hidden rounded-2xl p-4 shadow-lg border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div class="flex items-center space-x-3">
                <svg class="w-6 h-6 text-amber-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                <div>
                    <h4 id="alerta-sus-titulo" class="text-xs sm:text-sm font-bold text-white m-0">Aviso de Suscripción</h4>
                    <p id="alerta-sus-texto" class="text-[11px] sm:text-xs text-slate-300 m-0 mt-0.5">Tus días solventes están por agotarse.</p>
                </div>
            </div>
        </div>

        <div id="sync-alert" class="alert alert-success d-none rounded-2xl py-3 text-xs fw-semibold shadow-sm" role="alert">
            <span id="sync-message">Cambios sincronizados correctamente.</span>
        </div>

        <!-- CONTENEDOR DE TRABAJO -->
        <div id="contenedor-panel-activo" class="space-y-6 sm:space-y-10">
            
            <!-- TARJETA DE ENLACE DE LA VITRINA -->
            <section class="bg-cardbg border border-slate-800 rounded-2xl sm:rounded-3xl p-5 sm:p-8 shadow-xl space-y-4">
                <div class="border-b border-slate-800 pb-3 flex items-center justify-between">
                    <div>
                        <h2 class="text-base sm:text-lg font-black text-white">Tu Enlace de Vitrina</h2>
                        <p class="text-xs text-slate-400">Comparte este enlace con tus clientes para que puedan ver tu catálogo y hacerte pedidos.</p>
                    </div>
                    <span class="px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Activo en Cloudflare</span>
                </div>

                <div class="flex flex-col sm:flex-row items-center gap-3 pt-2">
                    <div class="relative w-full">
                        <input type="text" id="input-enlace-tienda" readonly class="form-control bg-slate-900 border-slate-800 text-slate-300 rounded-xl py-3 px-4 text-xs sm:text-sm font-mono truncate w-full" value="">
                    </div>
                    
                    <div class="flex items-center gap-2 w-full sm:w-auto shrink-0">
                        <button onclick="copiarEnlaceTienda()" class="w-full sm:w-auto bg-slate-800 hover:bg-slate-700 text-white font-bold py-3 px-4 rounded-xl transition text-xs flex items-center justify-center gap-1.5 border border-slate-700 shadow-sm">
                            Copiar
                        </button>
                        <button onclick="compartirEnlaceTienda()" class="w-full sm:w-auto bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold py-3 px-4 rounded-xl transition text-xs flex items-center justify-center gap-1.5 shadow-md">
                            Compartir
                        </button>
                    </div>
                </div>
            </section>

            <!-- SECCIÓN DE LOS 3 PLANES -->
            <section class="grid grid-cols-1 md:grid-cols-3 gap-6">
                <!-- 1. Plan Mensual Pro -->
                <div class="bg-cardbg border border-slate-800 rounded-2xl sm:rounded-3xl p-5 sm:p-6 shadow-xl space-y-3 flex flex-col justify-between">
                    <div>
                        <span class="px-3 py-1 rounded-full text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700 uppercase">Estándar</span>
                        <h3 class="text-base font-black text-white mt-2">Plan Mensual Pro</h3>
                        <div class="text-2xl font-black text-white mt-1">$5.00 <span class="text-xs text-slate-400 font-normal">/ mes</span></div>
                        <p class="text-xs text-slate-400 mt-2 leading-relaxed">Ideal para mantener tu tienda activa mes a mes con respaldo en Cloudflare Edge.</p>
                    </div>
                    <div class="pt-2 border-t border-slate-800/80 text-[11px] text-slate-400">
                        Pago mes a mes sin ataduras.
                    </div>
                </div>

                <!-- 2. Plan Trimestral -->
                <div class="bg-cardbg border-2 border-amber-500/40 rounded-2xl sm:rounded-3xl p-5 sm:p-6 shadow-xl space-y-3 flex flex-col justify-between relative">
                    <span class="absolute top-4 right-4 bg-amber-500/20 text-amber-400 text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-500/30 uppercase">Popular</span>
                    <div>
                        <span class="px-3 py-1 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 uppercase">Ahorro Trimestral</span>
                        <h3 class="text-base font-black text-white mt-2">Plan Trimestral</h3>
                        <div class="text-2xl font-black text-amber-400 mt-1">$14.00 <span class="text-xs text-slate-300 font-normal">/ 3 meses</span></div>
                        <p class="text-xs text-slate-300 mt-2 leading-relaxed">Perfecto para proyectar tu comercio por trimestre con un pequeño descuento acumulado.</p>
                    </div>
                    <div class="pt-2 border-t border-slate-800/80 text-[11px] text-amber-400/90">
                        ⚡ Equivale a $4.66 por mes con comodidad.
                    </div>
                </div>

                <!-- 3. Plan Anual VIP -->
                <div class="bg-gradient-to-br from-amber-500/10 via-cardbg to-slate-900 border-2 border-amber-500/60 rounded-2xl sm:rounded-3xl p-5 sm:p-6 shadow-xl space-y-3 flex flex-col justify-between relative overflow-hidden">
                    <span class="absolute top-4 right-4 bg-amber-500 text-dark text-[10px] font-black px-2.5 py-1 rounded-full shadow-md uppercase">Ahorra $20</span>
                    <div>
                        <span class="px-3 py-1 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 uppercase">Máximo Ahorro</span>
                        <h3 class="text-base font-black text-white mt-2">Plan Anual VIP</h3>
                        <div class="text-3xl font-black text-amber-400 mt-1">$40.00 <span class="text-xs text-slate-300 font-normal">/ año</span></div>
                        <p class="text-xs text-slate-300 mt-2 leading-relaxed">¡Asegura 12 meses completos al mejor precio y olvídate de renovaciones frecuentes!</p>
                    </div>
                    <div class="pt-2 border-t border-amber-500/20 text-[11px] text-amber-300/90 font-medium">
                        ✨ ¡Solo $3.33 al mes con soporte VIP prioritario!
                    </div>
                </div>
            </section>

            <!-- TARJETA DE ESTADO Y MÉTODOS DE PAGO CON VISOR QR INTERACTIVO -->
            <section class="bg-cardbg border border-slate-800 rounded-2xl sm:rounded-3xl p-5 sm:p-8 shadow-xl space-y-4">
                <div class="border-b border-slate-800 pb-3 flex items-center justify-between">
                    <div>
                        <h2 class="text-base sm:text-lg font-black text-white">Métodos de Pago y Códigos QR</h2>
                        <p class="text-xs text-slate-400">Consulta los datos para tu plan elegido ($5, $14 o $40). Haz clic en cualquier QR para ampliarlo.</p>
                    </div>
                    <span id="badge-dias-panel" class="px-3 py-1 rounded-full text-xs font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">-- Días Solventes</span>
                </div>

                <!-- PESTAÑAS O BOTONES DE SELECCIÓN -->
                <div class="flex flex-wrap gap-2 pt-2">
                    <button onclick="cambiarVisorPago('mercantil')" id="btn-tab-mercantil" class="flex-1 bg-amber-500 text-dark font-bold py-2.5 px-4 rounded-xl text-xs transition shadow-md">
                        🏦 Pago Móvil Mercantil (QR)
                    </button>
                    <button onclick="cambiarVisorPago('binance')" id="btn-tab-binance" class="flex-1 bg-slate-900 hover:bg-slate-800 text-slate-300 font-bold py-2.5 px-4 rounded-xl text-xs transition border border-slate-800">
                        💎 Binance Pay (QR)
                    </button>
                </div>

                <!-- CONTENEDOR VISOR: MERCANTIL -->
                <div id="visor-mercantil" class="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4">
                    <div class="flex flex-col md:flex-row items-center justify-between gap-6">
                        <div class="text-left space-y-3 w-full">
                            <h4 class="text-xs font-bold text-amber-400 uppercase tracking-wider">🏦 Datos de Pago Móvil Mercantil</h4>
                            <div id="datos-pago-movil" class="text-xs text-slate-300 space-y-1.5 font-mono">
                                <p><strong>Banco:</strong> 0105 - Mercantil</p>
                                <p><strong>Teléfono:</strong> 0412-5941381</p>
                                <p><strong>Cédula / RIF:</strong> V-32.411.077</p>
                                <p><strong>Montos:</strong> <span class="text-emerald-400 font-bold">$5 (Mensual) | $14 (Trimestral) | $40 (Anual)</span></p>
                            </div>
                            <div>
                                <button onclick="copiarDatosPagoMovil()" class="bg-slate-800 hover:bg-slate-700 text-amber-400 border border-amber-500/30 text-xs font-bold py-2 px-3.5 rounded-xl transition shadow-sm flex items-center gap-1.5">
                                    📋 Copiar todos los datos de Pago Móvil
                                </button>
                            </div>
                        </div>
                        <div class="shrink-0 bg-white p-2 rounded-2xl shadow-inner border border-slate-700 cursor-pointer group relative" onclick="abrirModalQr('assets/img/qr-mercantil.webp', 'Pago Móvil Mercantil')">
                            <img src="assets/img/qr-mercantil.webp" alt="QR Pago Móvil Mercantil" class="w-32 h-32 sm:w-40 sm:h-40 object-contain rounded-xl transition group-hover:scale-105">
                            <span class="absolute bottom-2 right-2 bg-dark/80 text-white text-[9px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition">🔍 Ampliar</span>
                        </div>
                    </div>
                </div>

                <!-- CONTENEDOR VISOR: BINANCE -->
                <div id="visor-binance" class="hidden bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4">
                    <div class="flex flex-col md:flex-row items-center justify-between gap-6">
                        <div class="text-left space-y-2 w-full">
                            <h4 class="text-xs font-bold text-amber-400 uppercase tracking-wider">💎 Datos de Binance Pay (USDT)</h4>
                            <div class="text-xs text-slate-300 space-y-1.5 font-mono">
                                <p><strong>Binance ID:</strong> 1262454700</p>
                                <p><strong>Email:</strong> ledezmayirbin@gmail.com</p>
                                <p><strong>Red recomendada:</strong> BEP20 / TRC20</p>
                                <p><strong>Montos exactos:</strong> <span class="text-emerald-400 font-bold">$5.00 | $14.00 | $40.00 USDT</span></p>
                            </div>
                        </div>
                        <div class="shrink-0 bg-white p-2 rounded-2xl shadow-inner border border-slate-700 cursor-pointer group relative" onclick="abrirModalQr('assets/img/qr-binance.webp', 'Binance Pay USDT')">
                            <img src="assets/img/qr-binance.webp" alt="QR Binance Pay" class="w-32 h-32 sm:w-40 sm:h-40 object-contain rounded-xl transition group-hover:scale-105">
                            <span class="absolute bottom-2 right-2 bg-dark/80 text-white text-[9px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition">🔍 Ampliar</span>
                        </div>
                    </div>
                </div>

                <div class="pt-2">
                    <a id="link-panel-renovar-whatsapp" href="#" target="_blank" class="w-full inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 px-5 rounded-xl transition text-xs shadow-md">
                        💬 Reportar Pago de Renovación por WhatsApp (Adjuntar Captura)
                    </a>
                </div>
            </section>

            <!-- CONFIGURACIÓN GENERAL -->
            <section class="bg-cardbg border border-slate-800 rounded-2xl sm:rounded-3xl p-5 sm:p-8 shadow-xl space-y-6">
                <div class="border-b border-slate-800 pb-4">
                    <h2 class="text-lg sm:text-xl font-black text-white">Configuración General</h2>
                    <p class="text-xs sm:text-sm text-slate-400 mt-0.5">Personaliza la identidad visual y marca de tu negocio.</p>
                </div>

                <form id="form-config-tienda" onsubmit="guardarConfiguracionTienda(event)" class="row g-4">
                    <div class="col-md-7">
                        <label class="form-label text-xs font-semibold text-slate-400 uppercase tracking-wider">Nombre de la Tienda</label>
                        <input type="text" id="config-nombre" required class="form-control bg-slate-900 border-slate-800 text-white rounded-xl py-2.5 text-sm">
                    </div>
                    <div class="col-md-5">
                        <label class="form-label text-xs font-semibold text-slate-400 uppercase tracking-wider">WhatsApp de Pedidos</label>
                        <input type="text" id="config-whatsapp" placeholder="584125941381" required class="form-control bg-slate-900 border-slate-800 text-white rounded-xl py-2.5 text-sm">
                    </div>

                    <div class="col-12">
                        <label class="form-label text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Logotipo de la Tienda</label>
                        <div id="drop-zone" class="border-2 border-dashed border-slate-700 hover:border-amber-500 rounded-2xl p-4 sm:p-6 text-center bg-slate-900/50 transition cursor-pointer flex flex-col items-center justify-center space-y-3 relative overflow-hidden">
                            <input type="file" id="file-logo-input" accept="image/*" class="absolute inset-0 opacity-0 cursor-pointer w-full h-full">
                            <div id="drop-zone-content" class="flex flex-col items-center space-y-2 pointer-events-none">
                                <span class="text-xs sm:text-sm text-slate-300 font-medium">Arrastra o <span class="text-amber-400 underline">examina</span> tu logotipo</span>
                            </div>
                            <div id="logo-preview-container" class="hidden flex items-center space-x-4">
                                <img id="logo-preview-img" class="w-14 h-14 sm:w-16 sm:h-16 rounded-xl object-cover border border-slate-700 shadow-md">
                                <div class="text-start">
                                    <span class="text-xs text-emerald-400 font-semibold block">Logotipo cargado</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="col-12 text-end pt-2">
                        <button type="submit" id="btn-guardar-tienda" class="btn btn-warning fw-bold w-full sm:w-auto px-6 py-2.5 rounded-xl text-xs sm:text-sm shadow-lg">
                            Guardar Cambios
                        </button>
                    </div>
                </form>
            </section>

            <!-- GESTIÓN DE PRODUCTOS (HÍBRIDO: TARJETAS EN MÓVIL / TABLA EN PC) -->
            <section class="bg-cardbg border border-slate-800 rounded-2xl sm:rounded-3xl p-4 sm:p-8 shadow-xl space-y-5 sm:space-y-6">
                <div class="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3 border-b border-slate-800 pb-4">
                    <div>
                        <h2 class="text-lg sm:text-xl font-black text-white m-0">Catálogo de Productos</h2>
                        <p class="text-xs sm:text-sm text-slate-400 m-0 mt-0.5">Agrega o edita los artículos de tu inventario.</p>
                    </div>
                    <button onclick="abrirModalProducto()" class="btn btn-warning fw-bold text-dark px-4 py-2.5 rounded-xl text-xs sm:text-sm shadow-lg w-full sm:w-auto">
                        + Nuevo Producto
                    </button>
                </div>

                <!-- VISTA MÓVIL: TARJETAS VERTICALES COMPACTAS (SIN SCROLL LATERAL) -->
                <div id="cards-productos-movil" class="block md:hidden space-y-3"></div>

                <!-- VISTA ESCRITORIO / TABLET: TABLA CLÁSICA COMPLETA -->
                <div class="hidden md:block table-responsive">
                    <table class="table table-dark table-hover align-middle mb-0 bg-transparent text-sm">
                        <thead class="text-secondary uppercase text-xs">
                            <tr>
                                <th class="py-3 px-3">Producto</th>
                                <th class="py-3 px-3">Categoría</th>
                                <th class="py-3 px-3">Precio</th>
                                <th class="py-3 px-3">Detalles</th>
                                <th class="py-3 px-3 text-end">Acciones</th>
                            </tr>
                        </thead>
                        <tbody id="tabla-productos-admin" class="border-top-0"></tbody>
                    </table>
                </div>
            </section>
        </div>
    </main>

    <!-- MODAL DE BIENVENIDA Y SELECCIÓN DE PLANES -->
    <div class="modal fade" id="modalBienvenidaAdmin" data-bs-backdrop="static" data-bs-keyboard="false" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered modal-lg">
            <div class="modal-content bg-cardbg border border-amber-500/30 text-white rounded-3xl p-4 sm:p-6 shadow-2xl space-y-6">
                
                <div class="text-center space-y-2 pt-2">
                    <span class="px-3 py-1 rounded-full text-xs font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 uppercase tracking-widest">
                        🚀 ¡Bienvenido a MultiStore Cloud!
                    </span>
                    <h2 class="text-xl sm:text-2xl font-black text-white">Tu tienda ha sido desplegada en Cloudflare Edge</h2>
                    <p class="text-xs sm:text-sm text-slate-300 max-w-xl mx-auto leading-relaxed">
                        Nos alegra tenerte a bordo. Tienes activados <strong class="text-amber-400">15 días de prueba gratuita</strong> para configurar tu catálogo por categorías, probar tu vitrina y recibir pedidos por WhatsApp.
                    </p>
                </div>

                <div class="text-center pt-2">
                    <button onclick="cerrarModalBienvenida()" class="w-full sm:w-auto bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-dark font-black py-3 px-8 rounded-xl transition shadow-lg text-xs sm:text-sm">
                        ¡Entendido, ir a mi Panel de Administración! 🚀
                    </button>
                </div>

            </div>
        </div>
    </div>

    <!-- MODAL PARA AMPLIAR CÓDIGO QR -->
    <div class="modal fade" id="modalQrGrande" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered modal-sm">
            <div class="modal-content bg-cardbg border border-slate-800 text-white rounded-3xl p-4 shadow-2xl text-center space-y-4">
                <div class="flex items-center justify-between border-b border-slate-800 pb-2">
                    <h5 id="modal-qr-titulo" class="text-sm font-bold text-amber-400 m-0">Código QR</h5>
                    <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <div class="bg-white p-3 rounded-2xl shadow-inner border border-slate-700 inline-block mx-auto">
                    <img id="img-qr-modal" src="" alt="Código QR Ampliado" class="w-64 h-64 object-contain rounded-xl">
                </div>
                <p class="text-[11px] text-slate-400">Escanea este código desde tu aplicación bancaria o billetera.</p>
            </div>
        </div>
    </div>

    <!-- MODAL PRODUCTO CON CAMPOS DINÁMICOS POR CATEGORÍA -->
    <div class="modal fade" id="modalProducto" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
            <div class="modal-content bg-cardbg border border-slate-800 text-white rounded-2xl sm:rounded-3xl p-3 sm:p-4 shadow-2xl">
                <div class="modal-header border-bottom border-slate-800">
                    <h5 class="modal-title fw-bold text-base" id="modal-titulo">Nuevo Producto</h5>
                    <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <div class="modal-body">
                    <form id="form-producto" onsubmit="guardarProductoModal(event)" class="row g-3">
                        <input type="hidden" id="prod-index" value="-1">
                        
                        <div class="col-12">
                            <label class="form-label text-[11px] font-semibold text-slate-400 uppercase">Nombre del Producto</label>
                            <input type="text" id="prod-nombre" required class="form-control bg-slate-900 border-slate-800 text-white rounded-xl text-sm">
                        </div>

                        <!-- Selector de Categoría Principal -->
                        <div class="col-12">
                            <label class="form-label text-[11px] font-semibold text-slate-400 uppercase">Categoría</label>
                            <select id="prod-categoria" onchange="cambiarCamposCategoria()" class="form-control bg-slate-900 border-slate-800 text-white rounded-xl text-sm">
                                <option value="prendas">Prendas y Ropa</option>
                                <option value="calzado">Calzado</option>
                                <option value="accesorios">Accesorios y Otros</option>
                            </select>
                        </div>
                        
                        <div class="col-6">
                            <label class="form-label text-[11px] font-semibold text-slate-400 uppercase">Precio ($)</label>
                            <input type="number" step="0.01" id="prod-precio" required class="form-control bg-slate-900 border-slate-800 text-white rounded-xl text-sm">
                        </div>

                        <!-- Campos Dinámicos según la Categoría -->
                        <div class="col-6" id="contenedor-tallas-prendas">
                            <label class="form-label text-[11px] font-semibold text-slate-400 uppercase">Tallas (Ropa)</label>
                            <input type="text" id="prod-tallas" placeholder="Ej: S, M, L, XL" class="form-control bg-slate-900 border-slate-800 text-white rounded-xl text-sm">
                        </div>

                        <div class="col-6 hidden" id="contenedor-tallas-calzado">
                            <label class="form-label text-[11px] font-semibold text-slate-400 uppercase">Tallas (Calzado)</label>
                            <input type="text" id="prod-tallas-calzado" placeholder="Ej: 38, 39, 40, 42" class="form-control bg-slate-900 border-slate-800 text-white rounded-xl text-sm">
                        </div>

                        <div class="col-6 hidden" id="contenedor-especificacion-accesorio">
                            <label class="form-label text-[11px] font-semibold text-slate-400 uppercase">Especificación / Material</label>
                            <input type="text" id="prod-especificacion" placeholder="Ej: Acero, Ajustable" class="form-control bg-slate-900 border-slate-800 text-white rounded-xl text-sm">
                        </div>
                        
                        <div class="col-12">
                            <label class="form-label text-[11px] font-semibold text-slate-400 uppercase">Colores Disponibles</label>
                            <input type="text" id="prod-colores" placeholder="Ej: Negro, Blanco, Dorado" required class="form-control bg-slate-900 border-slate-800 text-white rounded-xl text-sm">
                        </div>

                        <div class="col-12">
                            <label class="form-label text-[11px] font-semibold text-slate-400 uppercase">Foto del Producto</label>
                            <input type="file" id="prod-file-input" accept="image/*" class="form-control bg-slate-900 border-slate-800 text-white rounded-xl text-xs py-2">
                        </div>

                        <div class="col-12 text-center">
                            <div id="prod-img-preview-box" class="hidden mt-1 p-2 bg-slate-900/60 rounded-xl border border-slate-800 inline-block">
                                <img id="prod-img-preview" class="w-16 h-16 object-cover rounded-lg mx-auto shadow-sm">
                            </div>
                        </div>
                        <input type="hidden" id="prod-imagen-base64">

                        <div class="col-12">
                            <label class="form-label text-[11px] font-semibold text-slate-400 uppercase">Descripción</label>
                            <textarea id="prod-descripcion" rows="2" class="form-control bg-slate-900 border-slate-800 text-white rounded-xl text-sm"></textarea>
                        </div>

                        <div class="col-12 text-end pt-3 flex gap-2 justify-end">
                            <button type="button" class="btn btn-secondary rounded-xl px-4 text-xs" data-bs-dismiss="modal">Cancelar</button>
                            <button type="submit" id="btn-guardar-prod" class="btn btn-warning fw-bold rounded-xl px-4 text-dark text-xs">Guardar</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    </div>

    <footer class="w-full border-t border-slate-800 py-6 text-center text-xs text-slate-500">
        Panel Cloudflare Edge &copy; 2026.
    </footer>

    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
    <script src="app.js"></script>
    <script src="auth-guard.js"></script>
    <script>
        let tiendaSlug = (localStorage.getItem('sesion_vendedor') || "").trim().toLowerCase();
        let modalBootstrap;
        let modalQrBootstrap;
        let modalBienvenidaBootstrap;
        let base64LogotipoTemp = "";
        let base64ProductoTemp = "";

        document.addEventListener('DOMContentLoaded', async () => {
            if (!tiendaSlug) {
                window.location.href = 'login.html';
                return;
            }
            modalBootstrap = new bootstrap.Modal(document.getElementById('modalProducto'));
            modalQrBootstrap = new bootstrap.Modal(document.getElementById('modalQrGrande'));
            modalBienvenidaBootstrap = new bootstrap.Modal(document.getElementById('modalBienvenidaAdmin'));
            
            configurarDragAndDropLogo();
            configurarInputProductoFoto();
            await cargarPanelAdmin();
        });

        function cambiarCamposCategoria() {
            const categoria = document.getElementById('prod-categoria').value;
            const boxPrendas = document.getElementById('contenedor-tallas-prendas');
            const boxCalzado = document.getElementById('contenedor-tallas-calzado');
            const boxAccesorio = document.getElementById('contenedor-especificacion-accesorio');

            boxPrendas.classList.add('hidden');
            boxCalzado.classList.add('hidden');
            boxAccesorio.classList.add('hidden');

            if (categoria === 'prendas') {
                boxPrendas.classList.remove('hidden');
            } else if (categoria === 'calzado') {
                boxCalzado.classList.remove('hidden');
            } else if (categoria === 'accesorios') {
                boxAccesorio.classList.remove('hidden');
            }
        }

        function cambiarVisorPago(metodo) {
            const visorMercantil = document.getElementById('visor-mercantil');
            const visorBinance = document.getElementById('visor-binance');
            const btnMercantil = document.getElementById('btn-tab-mercantil');
            const btnBinance = document.getElementById('btn-tab-binance');

            if (metodo === 'mercantil') {
                visorMercantil.classList.remove('hidden');
                visorBinance.classList.add('hidden');
                btnMercantil.className = "flex-1 bg-amber-500 text-dark font-bold py-2.5 px-4 rounded-xl text-xs transition shadow-md";
                btnBinance.className = "flex-1 bg-slate-900 hover:bg-slate-800 text-slate-300 font-bold py-2.5 px-4 rounded-xl text-xs transition border border-slate-800";
            } else {
                visorBinance.classList.remove('hidden');
                visorMercantil.classList.add('hidden');
                btnBinance.className = "flex-1 bg-amber-500 text-dark font-bold py-2.5 px-4 rounded-xl text-xs transition shadow-md";
                btnMercantil.className = "flex-1 bg-slate-900 hover:bg-slate-800 text-slate-300 font-bold py-2.5 px-4 rounded-xl text-xs transition border border-slate-800";
            }
        }

        function abrirModalQr(rutaImg, titulo) {
            document.getElementById('modal-qr-titulo').textContent = titulo;
            document.getElementById('img-qr-modal').src = rutaImg;
            modalQrBootstrap.show();
        }

        function cerrarModalBienvenida() {
            modalBienvenidaBootstrap.hide();
            localStorage.setItem(`bienvenida_vista_${tiendaSlug}`, 'true');
        }

        function copiarDatosPagoMovil() {
            const datosTexto = "Banco: 0105 - Mercantil\nTeléfono: 0412-5941381\nCédula/RIF: V-32.411.077\nMontos: $5 (Mensual) | $14 (Trimestral) | $40 (Anual)";
            navigator.clipboard.writeText(datosTexto).then(() => {
                mostrarAlertaSync("¡Datos de Pago Móvil copiados al portapapeles!");
            }).catch(err => {
                alert("No se pudieron copiar los datos.");
            });
        }

        async function cargarPanelAdmin() {
            try {
                const db = await obtenerBaseDatos();
                if (!db || Object.keys(db).length === 0) return;

                const tiendaSlugClean = tiendaSlug.trim().toLowerCase();
                const slugReal = Object.keys(db).find(k => k.trim().toLowerCase() === tiendaSlugClean);
                const tienda = slugReal ? db[slugReal] : null;

                if (!tienda) {
                    alert("Sesión no encontrada o expirada para esta tienda.");
                    localStorage.removeItem('sesion_vendedor');
                    window.location.href = 'login.html'; 
                    return; 
                }

                tiendaSlug = slugReal;

                const yaVioBienvenida = localStorage.getItem(`bienvenida_vista_${tiendaSlug}`);
                if (!yaVioBienvenida) {
                    modalBienvenidaBootstrap.show();
                }

                const pathnameLimpio = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/') + 1);
                const baseUrlActual = window.location.origin + pathnameLimpio;
                const enlaceVitrinaCompleto = `${baseUrlActual}index.html?tienda=${tiendaSlug}`;
                const inputEnlace = document.getElementById('input-enlace-tienda');
                if (inputEnlace) inputEnlace.value = enlaceVitrinaCompleto;

                document.getElementById('config-nombre').value = tienda.nombreTienda || "";
                document.getElementById('config-whatsapp').value = tienda.whatsapp || "";
                base64LogotipoTemp = tienda.logoUrl || "";

                document.getElementById('nav-store-name').textContent = tienda.nombreTienda || "Mi Tienda";
                document.getElementById('link-ver-tienda').href = `index.html?tienda=${tiendaSlug}`;

                if (base64LogotipoTemp) {
                    mostrarVistaPreviaLogo(base64LogotipoTemp);
                }

                const diasRestantes = tienda.diasSolventes !== undefined ? tienda.diasSolventes : 15;
                const banner = document.getElementById('alerta-suscripcion-banner');
                const tituloBanner = document.getElementById('alerta-sus-titulo');
                const textoBanner = document.getElementById('alerta-sus-texto');
                const panelActivo = document.getElementById('contenedor-panel-activo');
                const pantallaBloqueo = document.getElementById('pantalla-suscripcion-vencida');
                const badgeDias = document.getElementById('badge-dias-panel');

                badgeDias.textContent = `${diasRestantes} Días Solventes`;

                const mensajeWaPanel = encodeURIComponent(`Hola Maestro, soy el administrador de la tienda @${tiendaSlug}. Realicé el pago de mi renovación de suscripción. Adjunto mi comprobante.`);
                document.getElementById('link-panel-renovar-whatsapp').href = `https://wa.me/584125941381?text=${mensajeWaPanel}`;

                if (tienda.bloqueado) {
                    panelActivo.classList.add('hidden');
                    pantallaBloqueo.classList.remove('hidden');
                    banner.classList.add('hidden');

                    const mensajeWa = encodeURIComponent(`Hola Maestro, soy el administrador de la tienda @${tiendaSlug}. Realicé el pago de mi renovación. Adjunto mi comprobante para la reactivación.`);
                    document.getElementById('link-renovar-whatsapp').href = `https://wa.me/584125941381?text=${mensajeWa}`;
                    return;
                } else {
                    panelActivo.classList.remove('hidden');
                    pantallaBloqueo.classList.add('hidden');
                }

                if (diasRestantes <= 5 && diasRestantes > 0) {
                    banner.className = "rounded-2xl p-4 shadow-lg border bg-amber-500/10 border-amber-500/30 flex items-center justify-between";
                    tituloBanner.textContent = `¡Atención! Te quedan ${diasRestantes} días de prueba / suscripción`;
                    textoBanner.textContent = "Realiza tu pago mensual ($5), trimestral ($14) o anual ($40) a tiempo para evitar suspensiones.";
                    banner.classList.remove('hidden');
                } else if (diasRestantes > 5) {
                    banner.className = "rounded-2xl p-4 shadow-lg border bg-emerald-500/10 border-emerald-500/30 flex items-center justify-between";
                    tituloBanner.textContent = `Estado de Suscripción: Activa (Prueba Gratuita)`;
                    textoBanner.textContent = `Tienes ${diasRestantes} días de acceso continuo en la plataforma Cloudflare Edge.`;
                    banner.classList.remove('hidden');
                } else {
                    banner.classList.add('hidden');
                }

                await renderizarTablaProductos();

            } catch (err) {
                console.error("Error crítico al cargar el panel:", err);
            }
        }

        function copiarEnlaceTienda() {
            const inputEl = document.getElementById('input-enlace-tienda');
            inputEl.select();
            inputEl.setSelectionRange(0, 99999);

            navigator.clipboard.writeText(inputEl.value).then(() => {
                mostrarAlertaSync("¡Enlace copiado al portapapeles!");
            }).catch(err => {
                alert("No se pudo copiar el enlace.");
            });
        }

        async function compartirEnlaceTienda() {
            const enlace = document.getElementById('input-enlace-tienda').value;
            const nombreTienda = document.getElementById('nav-store-name').textContent;

            if (navigator.share) {
                try {
                    await navigator.share({
                        title: `Catálogo de ${nombreTienda}`,
                        text: `¡Visita nuestra tienda digital y haz tus pedidos aquí! 🛍️`,
                        url: enlace,
                    });
                } catch (err) {
                    console.log("Compartir cancelado o no disponible.");
                }
            } else {
                copiarEnlaceTienda();
                alert("Tu navegador no soporta el menú de compartir directo, pero hemos copiado el enlace en tu portapapeles.");
            }
        }

        function configurarDragAndDropLogo() {
            const fileInput = document.getElementById('file-logo-input');
            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) procesarArchivo(file, (base64) => {
                    base64LogotipoTemp = base64;
                    mostrarVistaPreviaLogo(base64);
                });
            });
        }

        function configurarInputProductoFoto() {
            const fileInput = document.getElementById('prod-file-input');
            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) procesarArchivo(file, (base64) => {
                    base64ProductoTemp = base64;
                    document.getElementById('prod-imagen-base64').value = base64;
                    
                    const box = document.getElementById('prod-img-preview-box');
                    const img = document.getElementById('prod-img-preview');
                    img.src = base64;
                    box.classList.remove('hidden');
                });
            });
        }

        function procesarArchivo(file, callback) {
            if (!file.type.startsWith('image/')) {
                alert('Selecciona una imagen válida.');
                return;
            }
            const reader = new FileReader();
            reader.onload = function(e) { callback(e.target.result); };
            reader.readAsDataURL(file);
        }

        function mostrarVistaPreviaLogo(urlBase64) {
            document.getElementById('drop-zone-content').classList.add('hidden');
            const previewContainer = document.getElementById('logo-preview-container');
            const previewImg = document.getElementById('logo-preview-img');
            previewImg.src = urlBase64;
            previewContainer.classList.remove('hidden');
            document.getElementById('nav-logo-container').innerHTML = `<img src="${urlBase64}" class="w-full h-full object-cover">`;
        }

        async function guardarConfiguracionTienda(event) {
            event.preventDefault();
            const btn = document.getElementById('btn-guardar-tienda');
            btn.disabled = true;
            btn.textContent = "Guardando...";

            try {
                const db = await obtenerBaseDatos();
                if (!db[tiendaSlug]) db[tiendaSlug] = {};
                
                db[tiendaSlug].nombreTienda = document.getElementById('config-nombre').value.trim();
                db[tiendaSlug].whatsapp = document.getElementById('config-whatsapp').value.trim();
                db[tiendaSlug].logoUrl = base64LogotipoTemp;

                const exito = await guardarBaseDatos(db);
                if (exito) {
                    mostrarAlertaSync("¡Configuración guardada exitosamente!");
                    await cargarPanelAdmin();
                } else {
                    alert("No se pudo sincronizar con la nube de Cloudflare.");
                }
            } catch (err) {
                alert("Error al guardar: " + err.message);
            } finally {
                btn.disabled = false;
                btn.textContent = "Guardar Cambios";
            }
        }

        async function renderizarTablaProductos() {
            const db = await obtenerBaseDatos();
            const tienda = db[tiendaSlug];
            const tabla = document.getElementById('tabla-productos-admin');
            const cardsMovil = document.getElementById('cards-productos-movil');
            
            tabla.innerHTML = "";
            cardsMovil.innerHTML = "";

            if (!tienda || !tienda.productos || tienda.productos.length === 0) {
                tabla.innerHTML = `<tr><td colspan="5" class="text-center py-5 text-secondary">No hay productos registrados.</td></tr>`;
                cardsMovil.innerHTML = `
                    <div class="text-center py-8 px-4 border border-dashed border-slate-800 rounded-2xl bg-slate-900/40">
                        <p class="text-slate-400 text-xs m-0">No hay productos registrados en el inventario.</p>
                    </div>
                `;
                return;
            }

            tienda.productos.forEach((prod, index) => {
                let categoriaBadge = prod.categoria || 'prendas';
                let detallesExtra = `Tallas: ${prod.tallas || 'Única'}`;
                if (categoriaBadge === 'calzado') detallesExtra = `Tallas: ${prod.tallasCalzado || 'N/D'}`;
                if (categoriaBadge === 'accesorios') detallesExtra = `Material: ${prod.especificacion || 'N/D'}`;

                // 1. RENDERIZADO DE TABLA (PANTALLAS GRANDES)
                tabla.innerHTML += `
                    <tr>
                        <td class="py-3 px-3">
                            <div class="d-flex align-items-center gap-2 sm:gap-3">
                                <img src="${prod.url_imagen || ''}" class="rounded-2 object-fit-cover shrink-0" width="38" height="38">
                                <div class="min-w-0">
                                    <span class="fw-bold text-white d-block text-xs sm:text-sm truncate">${prod.nombre}</span>
                                    <small class="text-secondary text-[10px] sm:text-xs truncate d-block" style="max-width: 140px;">${prod.descripcion || ''}</small>
                                </div>
                            </div>
                        </td>
                        <td class="py-3 px-3">
                            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-amber-400 uppercase border border-slate-700">${categoriaBadge}</span>
                        </td>
                        <td class="py-3 px-3 fw-bold text-success text-xs sm:text-sm">$${parseFloat(prod.precio || 0).toFixed(2)}</td>
                        <td class="py-3 px-3 text-secondary text-[11px]">${detallesExtra} <br> Colores: ${prod.colores || 'Varios'}</td>
                        <td class="py-3 px-3 text-end">
                            <div class="flex items-center justify-end gap-1">
                                <button onclick="abrirModalProducto(${index})" class="btn btn-outline-warning btn-sm rounded-pill px-2.5 py-1 text-[10px] sm:text-xs">Editar</button>
                                <button onclick="eliminarProducto(${index})" class="btn btn-outline-danger btn-sm rounded-pill px-2.5 py-1 text-[10px] sm:text-xs">Borrar</button>
                            </div>
                        </td>
                    </tr>
                `;

                // 2. RENDERIZADO DE TARJETAS (PANTALLAS MÓVILES - CERO SCROLL HORIZONTAL)
                cardsMovil.innerHTML += `
                    <div class="bg-slate-900/90 border border-slate-800 rounded-2xl p-3.5 space-y-3 shadow-md">
                        <div class="flex items-start gap-3">
                            <img src="${prod.url_imagen || ''}" class="w-14 h-14 rounded-xl object-cover shrink-0 border border-slate-700">
                            
                            <div class="min-w-0 flex-grow">
                                <div class="flex items-start justify-between gap-2">
                                    <h4 class="text-sm font-bold text-white truncate m-0">${prod.nombre}</h4>
                                    <span class="text-sm font-black text-emerald-400 shrink-0">$${parseFloat(prod.precio || 0).toFixed(2)}</span>
                                </div>
                                <p class="text-[11px] text-slate-400 line-clamp-1 m-0 mt-0.5">${prod.descripcion || 'Sin descripción'}</p>
                                
                                <div class="flex items-center gap-2 mt-1.5 flex-wrap">
                                    <span class="px-2 py-0.5 rounded-full text-[9px] font-bold bg-slate-800 text-amber-400 uppercase border border-slate-700">${categoriaBadge}</span>
                                    <span class="text-[10px] text-slate-400 truncate">${detallesExtra} • ${prod.colores || 'Varios'}</span>
                                </div>
                            </div>
                        </div>

                        <div class="grid grid-cols-2 gap-2 pt-1 border-t border-slate-800/80">
                            <button onclick="abrirModalProducto(${index})" class="w-full bg-slate-800 hover:bg-slate-700 text-amber-400 font-bold py-2 px-3 rounded-xl text-xs transition border border-amber-500/20 flex items-center justify-center gap-1 shadow-sm">
                                 Editar
                            </button>
                            <button onclick="eliminarProducto(${index})" class="w-full bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 font-bold py-2 px-3 rounded-xl text-xs transition border border-rose-500/20 flex items-center justify-center gap-1 shadow-sm">
                                 Borrar
                            </button>
                        </div>
                    </div>
                `;
            });
        }

        async function abrirModalProducto(index = -1) {
            const db = await obtenerBaseDatos();
            const tienda = db[tiendaSlug];
            const box = document.getElementById('prod-img-preview-box');

            document.getElementById('prod-file-input').value = "";

            if (index > -1 && tienda && tienda.productos && tienda.productos[index]) {
                const prod = tienda.productos[index];
                document.getElementById('modal-titulo').textContent = "Editar Producto";
                document.getElementById('prod-index').value = index;
                document.getElementById('prod-nombre').value = prod.nombre;
                document.getElementById('prod-categoria').value = prod.categoria || 'prendas';
                cambiarCamposCategoria();

                document.getElementById('prod-precio').value = prod.precio;
                document.getElementById('prod-tallas').value = prod.tallas || '';
                document.getElementById('prod-tallas-calzado').value = prod.tallasCalzado || '';
                document.getElementById('prod-especificacion').value = prod.especificacion || '';
                document.getElementById('prod-colores').value = prod.colores;
                document.getElementById('prod-descripcion').value = prod.descripcion;
                
                base64ProductoTemp = prod.url_imagen || "";
                document.getElementById('prod-imagen-base64').value = prod.url_imagen || "";
                document.getElementById('prod-img-preview').src = prod.url_imagen || "";
                box.classList.remove('hidden');
            } else {
                document.getElementById('modal-titulo').textContent = "Nuevo Producto";
                document.getElementById('form-producto').reset();
                document.getElementById('prod-index').value = -1;
                document.getElementById('prod-categoria').value = 'prendas';
                cambiarCamposCategoria();
                document.getElementById('prod-imagen-base64').value = "";
                base64ProductoTemp = "";
                box.classList.add('hidden');
            }
            modalBootstrap.show();
        }

        async function guardarProductoModal(event) {
            event.preventDefault();
            const btn = document.getElementById('btn-guardar-prod');
            btn.disabled = true;
            btn.textContent = "Guardando...";

            try {
                const index = parseInt(document.getElementById('prod-index').value);
                const imagenFinal = document.getElementById('prod-imagen-base64').value || base64ProductoTemp;

                if (!imagenFinal) {
                    alert("Por favor, selecciona una imagen para el producto.");
                    btn.disabled = false;
                    btn.textContent = "Guardar";
                    return;
                }

                const db = await obtenerBaseDatos();
                if (!db[tiendaSlug]) db[tiendaSlug] = {};
                if (!db[tiendaSlug].productos) db[tiendaSlug].productos = [];

                const productoExistente = (index > -1 && db[tiendaSlug].productos[index]) ? db[tiendaSlug].productos[index] : null;
                const categoriaSeleccionada = document.getElementById('prod-categoria').value;

                const nuevoProd = {
                    id: productoExistente ? productoExistente.id : undefined,
                    nombre: document.getElementById('prod-nombre').value.trim(),
                    categoria: categoriaSeleccionada,
                    precio: parseFloat(document.getElementById('prod-precio').value),
                    tallas: categoriaSeleccionada === 'prendas' ? document.getElementById('prod-tallas').value.trim() : '',
                    tallasCalzado: categoriaSeleccionada === 'calzado' ? document.getElementById('prod-tallas-calzado').value.trim() : '',
                    especificacion: categoriaSeleccionada === 'accesorios' ? document.getElementById('prod-especificacion').value.trim() : '',
                    colores: document.getElementById('prod-colores').value.trim(),
                    url_imagen: imagenFinal,
                    descripcion: document.getElementById('prod-descripcion').value.trim()
                };

                const response = await fetch(`${API_BASE_URL}/guardar-producto`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tiendaSlug: tiendaSlug, producto: nuevoProd })
                });

                if (!response.ok) throw new Error("Error al guardar el producto en la nube.");

                modalBootstrap.hide();
                mostrarAlertaSync("¡Producto guardado correctamente!");
                await renderizarTablaProductos();

            } catch (err) {
                alert("Error al guardar producto: " + err.message);
            } finally {
                btn.disabled = false;
                btn.textContent = "Guardar";
            }
        }

        async function eliminarProducto(index) {
            if (confirm("¿Estás seguro de eliminar este producto?")) {
                try {
                    const db = await obtenerBaseDatos();
                    const tienda = db[tiendaSlug];
                    
                    if (!tienda || !tienda.productos || !tienda.productos[index]) {
                        alert("Producto no encontrado.");
                        return;
                    }

                    const prodAEliminar = tienda.productos[index];

                    if (prodAEliminar.id) {
                        const res = await fetch(`${API_BASE_URL}/eliminar-producto`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ productoId: prodAEliminar.id })
                        });

                        const resultado = await res.json();
                        if (!res.ok) throw new Error(resultado.error || "No se pudo eliminar el producto en la nube.");
                    }

                    tienda.productos.splice(index, 1);
                    mostrarAlertaSync("Producto eliminado correctamente.");
                    await renderizarTablaProductos();

                } catch (err) {
                    alert("Error al eliminar producto: " + err.message);
                }
            }
        }

        function cerrarSesion() {
            localStorage.removeItem('sesion_vendedor');
            window.location.href = 'index.html';
        }

        function mostrarAlertaSync(mensaje) {
            const alerta = document.getElementById('sync-alert');
            const texto = document.getElementById('sync-message');
            texto.textContent = mensaje;
            alerta.classList.remove('d-none');
            setTimeout(() => { alerta.classList.add('d-none'); }, 3000);
        }
    </script>
    
</body>
</html>

login.html:

<!DOCTYPE html>
<html lang="es" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Acceso y Registro - MultiStore Cloud</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = {
            darkMode: 'class',
            theme: {
                extend: {
                    colors: {
                        darkbg: '#0f172a',
                        cardbg: '#1e293b',
                    }
                }
            }
        }
    </script>
</head>
<body class="bg-darkbg text-slate-100 font-sans min-h-screen flex flex-col justify-between selection:bg-amber-500 selection:text-white">
<style>
    input[type="text"],
    input[type="password"],
    input[type="email"],
    input[type="number"],
    input[type="url"],
    input[type="file"],
    textarea,
    select,
    .form-control {
        background-color: #0b0f19 !important;
        color: #ffffff !important;
        border-color: #334155 !important;
    }

    input:-webkit-autofill,
    input:-webkit-autofill:hover,
    input:-webkit-autofill:focus,
    textarea:-webkit-autofill,
    textarea:-webkit-autofill:hover,
    textarea:-webkit-autofill:focus {
        -webkit-text-fill-color: #ffffff !important;
        -webkit-box-shadow: 0 0 0px 1000px #0b0f19 inset !important;
        transition: background-color 5000s ease-in-out 0s;
    }

    input:focus,
    textarea:focus,
    select:focus,
    .form-control:focus {
        background-color: #0b0f19 !important;
        color: #ffffff !important;
        border-color: #f59e0b !important;
        box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.2) !important;
    }

    ::placeholder {
        color: #64748b !important;
        opacity: 1 !important;
    }
</style>
    <header class="w-full border-b border-slate-800 backdrop-blur-md bg-darkbg/80 sticky top-0 z-50">
        <div class="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
            <a href="index.html" class="flex items-center space-x-3">
                <div class="h-10 w-10 rounded-xl bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/30">
                    <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"></path>
                    </svg>
                </div>
                <span class="text-xl font-bold tracking-tight bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">MultiStore Cloud</span>
            </a>
            <a href="index.html" class="text-xs font-semibold text-slate-400 hover:text-white transition flex items-center gap-1">
                ← Volver al inicio
            </a>
        </div>
    </header>

    <main class="flex-grow flex items-center justify-center px-4 py-12">
        <div class="max-w-md w-full bg-cardbg border border-slate-800 rounded-3xl p-8 shadow-2xl space-y-6">
            
            <!-- FORMULARIO DE INICIO DE SESIÓN -->
            <div id="section-login" class="space-y-6">
                <div>
                    <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 mb-3">
                        Portal de Vendedores
                    </span>
                    <h2 class="text-2xl font-black text-white">Iniciar Sesión</h2>
                    <p class="text-sm text-slate-400 mt-1">Ingresa tus credenciales para administrar tu tienda.</p>
                </div>

                <form id="login-form" onsubmit="manejarLogin(event)" class="space-y-4">
                    <div>
                        <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Usuario / ID de Tienda</label>
                        <input type="text" id="login-user" required placeholder="" class="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-amber-500 placeholder-slate-600">
                    </div>
                    <div>
                        <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Contraseña</label>
                        <input type="password" id="login-pass" required placeholder="••••••••" class="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-amber-500 placeholder-slate-600">
                    </div>
                    
                    <div id="login-error" class="hidden text-xs font-semibold text-rose-400 bg-rose-500/10 border border-rose-500/20 p-3 rounded-xl">
                        Usuario o contraseña incorrectos.
                    </div>

                    <button type="submit" id="login-btn-submit" class="w-full bg-amber-600 hover:bg-amber-500 text-white font-bold py-3 rounded-xl transition shadow-lg shadow-amber-600/20 mt-2">
                        Acceder al Panel
                    </button>
                </form>

                <div class="border-t border-slate-800 pt-4 text-center">
                    <p class="text-xs text-slate-400">¿No tienes una tienda?</p>
                    <button onclick="alternarFormularios('registro')" class="text-xs font-bold text-amber-400 hover:underline mt-1">
                        Regístrate aquí gratis →
                    </button>
                </div>
            </div>

            <!-- FORMULARIO DE REGISTRO -->
            <div id="section-registro" class="space-y-6 hidden">
                <div>
                    <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 mb-3">
                        Nuevo Comercio
                    </span>
                    <h2 class="text-2xl font-black text-white">Crea tu Tienda</h2>
                    <p class="text-sm text-slate-400 mt-1">Registro rápido. Podrás añadir tu logotipo y personalizar tu tienda en el panel.</p>
                </div>

                <form id="registro-form" onsubmit="manejarRegistro(event)" class="space-y-4">
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Usuario / ID</label>
                            <input type="text" id="reg-user" required placeholder="" class="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 placeholder-slate-600">
                        </div>
                        <div>
                            <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Contraseña</label>
                            <input type="password" id="reg-pass" required placeholder="••••••••" class="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 placeholder-slate-600">
                        </div>
                    </div>
                    <div>
                        <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Nombre Oficial de la Tienda</label>
                        <input type="text" id="reg-nombre" required placeholder="" class="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 placeholder-slate-600">
                    </div>
                    <div>
                        <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">WhatsApp de Pedidos</label>
                        <input type="text" id="reg-whatsapp" required placeholder="Ej. 584121234567" class="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 placeholder-slate-600">
                    </div>
                    
                    <div id="reg-error" class="hidden text-xs font-semibold text-rose-400 bg-rose-500/10 border border-rose-500/20 p-3 rounded-xl">
                        Error al registrar.
                    </div>

                    <button type="submit" id="reg-btn-submit" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-xl transition shadow-lg shadow-emerald-600/20 mt-2">
                        Registrar y Abrir mi Tienda
                    </button>
                </form>

                <div class="border-t border-slate-800 pt-4 text-center">
                    <p class="text-xs text-slate-400">¿Ya tienes una cuenta?</p>
                    <button onclick="alternarFormularios('login')" class="text-xs font-bold text-amber-400 hover:underline mt-1">
                        ← Iniciar sesión aquí
                    </button>
                </div>
            </div>

        </div>
    </main>

    <footer class="w-full border-t border-slate-800 py-6 text-center text-xs text-slate-500">
        Plataforma Multi-Tienda Cloudflare Edge &copy; 2026.
    </footer>

    <script src="app.js"></script>
    <script>
        function alternarFormularios(tipo) {
            const secLogin = document.getElementById('section-login');
            const secRegistro = document.getElementById('section-registro');

            if (tipo === 'registro') {
                secLogin.classList.add('hidden');
                secRegistro.classList.remove('hidden');
            } else {
                secRegistro.classList.add('hidden');
                secLogin.classList.remove('hidden');
            }
        }

        async function manejarLogin(event) {
            event.preventDefault();
            const usuarioInput = document.getElementById('login-user').value.trim().toLowerCase().replace(/\s+/g, '_');
            const passInput = document.getElementById('login-pass').value.trim();
            const errorDiv = document.getElementById('login-error');
            const btn = document.getElementById('login-btn-submit');

            errorDiv.classList.add('hidden');
            btn.disabled = true;
            btn.textContent = "Verificando...";

            try {
                const response = await fetch(`${API_BASE_URL}/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ usuario: usuarioInput, password: passInput })
                });

                const resultado = await response.json();

                if (!response.ok) {
                    throw new Error(resultado.error || "Usuario o contraseña incorrectos.");
                }

                if (resultado.rol === "superadmin") {
                    localStorage.setItem('sesion_superadmin', resultado.slug);
                    window.location.href = 'superadmin.html';
                } else {
                    localStorage.setItem('sesion_vendedor', resultado.slug);
                    window.location.href = 'admin.html';
                }
            } catch (err) {
                errorDiv.textContent = err.message || "Usuario o contraseña incorrectos.";
                errorDiv.classList.remove('hidden');
            } finally {
                btn.disabled = false;
                btn.textContent = "Acceder al Panel";
            }
        }

        async function manejarRegistro(event) {
            event.preventDefault();
            const usuario = document.getElementById('reg-user').value.trim().toLowerCase().replace(/\s+/g, '_');
            const password = document.getElementById('reg-pass').value.trim();
            const nombreTienda = document.getElementById('reg-nombre').value.trim();
            const whatsapp = document.getElementById('reg-whatsapp').value.trim();
            const errorDiv = document.getElementById('reg-error');
            const btn = document.getElementById('reg-btn-submit');

            errorDiv.classList.add('hidden');
            btn.disabled = true;
            btn.textContent = "Creando tienda...";

            try {
                await registrarNuevaTienda({ usuario, password, nombreTienda, whatsapp });
                localStorage.setItem('sesion_vendedor', usuario);
                await obtenerBaseDatos();
                window.location.href = 'admin.html';
            } catch (error) {
                errorDiv.textContent = error.message;
                errorDiv.classList.remove('hidden');
            } finally {
                btn.disabled = false;
                btn.textContent = "Registrar y Abrir mi Tienda";
            }
        }
    </script>

</body>
</html>

superadmin.html:

<!DOCTYPE html>
<html lang="es" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Panel SuperAdmin - Control Global</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = {
            darkMode: 'class',
            theme: {
                extend: {
                    colors: {
                        darkbg: '#0f172a',
                        cardbg: '#1e293b',
                    }
                }
            }
        }
    </script>
</head>
<body class="bg-darkbg text-slate-100 font-sans min-h-screen flex flex-col justify-between selection:bg-amber-500 selection:text-white">

    <header class="w-full border-b border-slate-800 backdrop-blur-md bg-darkbg/80 sticky top-0 z-50">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 h-16 sm:h-20 flex items-center justify-between">
            <div class="flex items-center space-x-2.5">
                <div class="h-9 w-9 sm:h-10 sm:w-10 rounded-xl bg-gradient-to-tr from-rose-500 to-amber-500 flex items-center justify-center shadow-lg border border-slate-700">
                    <svg class="w-5 h-5 sm:w-6 sm:h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path></svg>
                </div>
                <div>
                    <span class="text-sm sm:text-lg font-bold tracking-tight text-white block">SuperAdmin</span>
                    <span class="text-[10px] sm:text-xs text-rose-400 font-semibold">Control Maestro D1</span>
                </div>
            </div>
            <div class="flex items-center space-x-2">
                <button onclick="cerrarSesionSuperAdmin()" class="btn btn-danger btn-sm rounded-xl px-2.5 py-1.5 sm:px-3 sm:py-2 text-[11px] sm:text-xs font-semibold">
                    Cerrar Sesión
                </button>
            </div>
        </div>
    </header>

    <main class="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-10 flex-grow w-full space-y-6 sm:space-y-10">
        
        <div id="sync-alert" class="alert alert-success d-none rounded-2xl py-3 text-xs fw-semibold shadow-sm" role="alert">
            <span id="sync-message">Acción ejecutada correctamente.</span>
        </div>

        <!-- TARJETAS DE MÉTRICAS -->
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
            <div class="bg-cardbg border border-slate-800 rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-xl flex flex-col justify-between space-y-2">
                <span class="text-[10px] sm:text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Tiendas</span>
                <span id="stat-total-tiendas" class="text-2xl sm:text-3xl font-black text-white">0</span>
                <span class="text-[10px] text-slate-500">Registradas</span>
            </div>
            <div class="bg-cardbg border border-slate-800 rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-xl flex flex-col justify-between space-y-2">
                <span class="text-[10px] sm:text-xs font-semibold text-slate-400 uppercase tracking-wider">Activas</span>
                <span id="stat-tiendas-activas" class="text-2xl sm:text-3xl font-black text-emerald-400">0</span>
                <span class="text-[10px] text-slate-500">Operando</span>
            </div>
            <div class="bg-cardbg border border-slate-800 rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-xl flex flex-col justify-between space-y-2">
                <span class="text-[10px] sm:text-xs font-semibold text-slate-400 uppercase tracking-wider">Bloqueadas</span>
                <span id="stat-tiendas-bloqueadas" class="text-2xl sm:text-3xl font-black text-rose-400">0</span>
                <span class="text-[10px] text-slate-500">Suspendidas</span>
            </div>
            <div class="bg-cardbg border border-slate-800 rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-xl flex flex-col justify-between space-y-2">
                <span class="text-[10px] sm:text-xs font-semibold text-slate-400 uppercase tracking-wider">Productos</span>
                <span id="stat-productos-totales" class="text-2xl sm:text-3xl font-black text-amber-400">0</span>
                <span class="text-[10px] text-slate-500">Inventario red</span>
            </div>
        </div>

        <!-- SECCIÓN: GESTIÓN GLOBAL DE CATEGORÍAS -->
        <section class="bg-cardbg border border-slate-800 rounded-2xl sm:rounded-3xl p-5 sm:p-8 shadow-xl space-y-6">
            <div class="border-bottom border-slate-800 pb-4 flex flex-col sm:flex-row justify-content-between align-items-sm-center gap-3">
                <div>
                    <h2 class="text-lg sm:text-xl font-black text-white m-0">Gestión Global de Categorías</h2>
                    <p class="text-xs sm:text-sm text-slate-400 m-0 mt-0.5">Crea o administra las categorías maestras disponibles para las tiendas de la plataforma.</p>
                </div>
                <button onclick="abrirModalCategoria()" class="btn btn-warning fw-bold text-dark px-4 py-2.5 rounded-xl text-xs sm:text-sm shadow-lg">
                    + Nueva Categoría
                </button>
            </div>

            <div class="table-responsive">
                <table class="table table-dark table-hover align-middle mb-0 bg-transparent text-xs sm:text-sm">
                    <thead class="text-secondary uppercase text-[10px] sm:text-xs">
                        <tr>
                            <th class="py-3 px-3">Identificador (Slug)</th>
                            <th class="py-3 px-3">Nombre Visible</th>
                            <th class="py-3 px-3 text-end">Acciones</th>
                        </tr>
                    </thead>
                    <tbody id="tabla-superadmin-categorias" class="border-top-0">
                        <!-- Categorías por defecto precargadas -->
                        <tr>
                            <td class="py-3 px-3 font-mono text-amber-400">prendas</td>
                            <td class="py-3 px-3 text-white">Prendas y Ropa</td>
                            <td class="py-3 px-3 text-end">
                                <span class="text-xs text-slate-500 italic">Sistema por defecto</span>
                            </td>
                        </tr>
                        <tr>
                            <td class="py-3 px-3 font-mono text-amber-400">calzado</td>
                            <td class="py-3 px-3 text-white">Calzado</td>
                            <td class="py-3 px-3 text-end">
                                <span class="text-xs text-slate-500 italic">Sistema por defecto</span>
                            </td>
                        </tr>
                        <tr>
                            <td class="py-3 px-3 font-mono text-amber-400">accesorios</td>
                            <td class="py-3 px-3 text-white">Accesorios y Otros</td>
                            <td class="py-3 px-3 text-end">
                                <span class="text-xs text-slate-500 italic">Sistema por defecto</span>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>

        <!-- TABLA DE GESTIÓN DE TIENDAS -->
        <section class="bg-cardbg border border-slate-800 rounded-2xl sm:rounded-3xl p-5 sm:p-8 shadow-xl space-y-6">
            <div class="border-bottom border-slate-800 pb-4">
                <h2 class="text-lg sm:text-xl font-black text-white m-0">Gestión de Tiendas</h2>
                <p class="text-xs sm:text-sm text-slate-400 m-0 mt-0.5">Controla el estado y vigencia de los comercios.</p>
            </div>
            <div class="table-responsive">
                <table class="table table-dark table-hover align-middle mb-0 bg-transparent text-xs sm:text-sm">
                    <thead class="text-secondary uppercase text-[10px] sm:text-xs">
                        <tr>
                            <th class="py-3 px-3">Comercio</th>
                            <th class="py-3 px-3 hidden sm:table-cell">WhatsApp</th>
                            <th class="py-3 px-3">Días</th>
                            <th class="py-3 px-3">Estado</th>
                            <th class="py-3 px-3 text-end">Acciones</th>
                        </tr>
                    </thead>
                    <tbody id="tabla-superadmin-tiendas" class="border-top-0"></tbody>
                </table>
            </div>
        </section>

        <!-- SECCIÓN: HISTORIAL CONTABLE DE PAGOS -->
        <section class="bg-cardbg border border-slate-800 rounded-2xl sm:rounded-3xl p-5 sm:p-8 shadow-xl space-y-6">
            <div class="border-bottom border-slate-800 pb-4">
                <h2 class="text-lg sm:text-xl font-black text-white m-0">Historial Contable</h2>
                <p class="text-xs sm:text-sm text-slate-400 m-0 mt-0.5">Registro detallado de ingresos por suscripciones.</p>
            </div>
            <div class="table-responsive">
                <table class="table table-dark table-hover align-middle mb-0 bg-transparent text-xs sm:text-sm">
                    <thead class="text-secondary uppercase text-[10px] sm:text-xs">
                        <tr>
                            <th class="py-3 px-3">ID</th>
                            <th class="py-3 px-3">Tienda</th>
                            <th class="py-3 px-3">Monto</th>
                            <th class="py-3 px-3">Días</th>
                            <th class="py-3 px-3 text-end">Fecha</th>
                        </tr>
                    </thead>
                    <tbody id="tabla-historial-pagos" class="border-top-0"></tbody>
                </table>
            </div>
        </section>
    </main>

    <!-- MODAL NUEVA CATEGORÍA -->
    <div class="modal fade" id="modalCategoria" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content bg-cardbg border border-slate-800 text-white rounded-3xl p-4 shadow-2xl space-y-4">
                <div class="modal-header border-bottom border-slate-800 pb-2">
                    <h5 class="modal-title font-bold text-amber-400 text-base">Crear Nueva Categoría</h5>
                    <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <div class="modal-body">
                    <form id="form-categoria" onsubmit="guardarNuevaCategoria(event)" class="space-y-4">
                        <div>
                            <label class="form-label text-xs font-semibold text-slate-400 uppercase">Identificador único (Slug sin espacios)</label>
                            <input type="text" id="cat-slug" required placeholder="ej: juguetes, tecnologia" class="form-control bg-slate-900 border-slate-800 text-white rounded-xl text-sm">
                        </div>
                        <div>
                            <label class="form-label text-xs font-semibold text-slate-400 uppercase">Nombre Visible</label>
                            <input type="text" id="cat-nombre" required placeholder="ej: Juguetes y Entretenimiento" class="form-control bg-slate-900 border-slate-800 text-white rounded-xl text-sm">
                        </div>
                        <div class="text-end pt-2 flex gap-2 justify-end">
                            <button type="button" class="btn btn-secondary rounded-xl px-4 text-xs" data-bs-dismiss="modal">Cancelar</button>
                            <button type="submit" class="btn btn-warning fw-bold rounded-xl px-4 text-dark text-xs">Guardar Categoría</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    </div>

    <footer class="w-full border-t border-slate-800 py-6 text-center text-xs text-slate-500">
        Panel SuperAdmin Edge &copy; 2026.
    </footer>

    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
    <script src="app.js"></script>
    <script src="auth-guard.js"></script>
    <script>
        let modalCategoriaBootstrap = null;

        document.addEventListener('DOMContentLoaded', async () => {
            const sesionMaster = localStorage.getItem('sesion_superadmin');
            if (!sesionMaster) {
                window.location.href = 'login.html';
                return;
            }
            modalCategoriaBootstrap = new bootstrap.Modal(document.getElementById('modalCategoria'));
            await cargarPanelSuperAdmin();
        });

        function abrirModalCategoria() {
            document.getElementById('form-categoria').reset();
            modalCategoriaBootstrap.show();
        }

        function guardarNuevaCategoria(event) {
            event.preventDefault();
            const slug = document.getElementById('cat-slug').value.trim().toLowerCase().replace(/\s+/g, '_');
            const nombre = document.getElementById('cat-nombre').value.trim();

            // Guardar temporalmente en localStorage global para pruebas o sincronización con D1
            let categoriasCustom = JSON.parse(localStorage.getItem('multistore_categorias_globales') || '[]');
            if (!categoriasCustom.some(c => c.slug === slug)) {
                categoriasCustom.push({ slug, nombre });
                localStorage.setItem('multistore_categorias_globales', JSON.stringify(categoriasCustom));
            }

            modalCategoriaBootstrap.hide();
            mostrarAlertaSync(`¡Categoría "${nombre}" creada con éxito!`);
            renderizarCategoriasGlobales();
        }

        function renderizarCategoriasGlobales() {
            const tbody = document.getElementById('tabla-superadmin-categorias');
            // Mantener las 3 por defecto y agregar las personalizadas
            let htmlBase = `
                <tr>
                    <td class="py-3 px-3 font-mono text-amber-400">prendas</td>
                    <td class="py-3 px-3 text-white">Prendas y Ropa</td>
                    <td class="py-3 px-3 text-end"><span class="text-xs text-slate-500 italic">Sistema</span></td>
                </tr>
                <tr>
                    <td class="py-3 px-3 font-mono text-amber-400">calzado</td>
                    <td class="py-3 px-3 text-white">Calzado</td>
                    <td class="py-3 px-3 text-end"><span class="text-xs text-slate-500 italic">Sistema</span></td>
                </tr>
                <tr>
                    <td class="py-3 px-3 font-mono text-amber-400">accesorios</td>
                    <td class="py-3 px-3 text-white">Accesorios y Otros</td>
                    <td class="py-3 px-3 text-end"><span class="text-xs text-slate-500 italic">Sistema</span></td>
                </tr>
            `;

            let categoriasCustom = JSON.parse(localStorage.getItem('multistore_categorias_globales') || '[]');
            categoriasCustom.forEach((cat, index) => {
                htmlBase += `
                    <tr>
                        <td class="py-3 px-3 font-mono text-emerald-400">${cat.slug}</td>
                        <td class="py-3 px-3 text-white">${cat.nombre}</td>
                        <td class="py-3 px-3 text-end">
                            <button onclick="eliminarCategoriaGlobal(${index})" class="btn btn-outline-danger btn-sm rounded-pill px-2.5 py-1 text-[10px]">Borrar</button>
                        </td>
                    </tr>
                `;
            });

            tbody.innerHTML = htmlBase;
        }

        function eliminarCategoriaGlobal(index) {
            if (confirm("¿Estás seguro de eliminar esta categoría global?")) {
                let categoriasCustom = JSON.parse(localStorage.getItem('multistore_categorias_globales') || '[]');
                categoriasCustom.splice(index, 1);
                localStorage.setItem('multistore_categorias_globales', JSON.stringify(categoriasCustom));
                mostrarAlertaSync("Categoría eliminada.");
                renderizarCategoriasGlobales();
            }
        }

        async function cargarPanelSuperAdmin() {
            try {
                const response = await fetch(`${API_BASE_URL}/superadmin/obtener-datos`);
                const data = await response.json();
                
                const tiendasObj = data.tiendas || data;
                const pagosArr = data.historialPagos || [];

                window.dbCacheSuperAdmin = tiendasObj;
                renderizarPanel(tiendasObj);
                renderizarHistorialPagos(pagosArr);
                renderizarCategoriasGlobales();
            } catch (err) {
                console.error("Error al cargar datos del superadmin:", err);
                renderizarCategoriasGlobales();
            }
        }

        function renderizarPanel(db) {
            const tbody = document.getElementById('tabla-superadmin-tiendas');
            tbody.innerHTML = "";

            let totalTiendas = 0, tiendasActivas = 0, tiendasBloqueadas = 0, productosGlobales = 0;
            const slugs = Object.keys(db || {});

            if (slugs.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" class="text-center py-5 text-secondary">No hay tiendas registradas.</td></tr>`;
                return;
            }

            slugs.forEach(slug => {
                const tienda = db[slug];
                totalTiendas++;
                const cantProductos = (tienda.productos || []).length;
                productosGlobales += cantProductos;

                const estadoBloqueado = tienda.bloqueado === 1 || tienda.bloqueado === true;
                const diasRestantes = tienda.diasSolventes !== undefined ? tienda.diasSolventes : 30;

                if (estadoBloqueado) tiendasBloqueadas++; else tiendasActivas++;

                const badgeEstado = estadoBloqueado 
                    ? `<span class="badge bg-danger text-white px-2 py-0.5 rounded-pill text-[10px]">Susp.</span>` 
                    : `<span class="badge bg-success text-white px-2 py-0.5 rounded-pill text-[10px]">Activa</span>`;

                tbody.innerHTML += `
                    <tr>
                        <td class="py-3 px-3">
                            <span class="fw-bold text-white d-block text-xs sm:text-sm">${tienda.nombreTienda || 'Sin Nombre'}</span>
                            <small class="text-secondary text-[10px]">@${slug}</small>
                        </td>
                        <td class="py-3 px-3 text-slate-300 text-xs hidden sm:table-cell">${tienda.whatsapp || 'N/D'}</td>
                        <td class="py-3 px-3 text-slate-300 font-semibold text-xs">${diasRestantes} d</td>
                        <td class="py-3 px-3">${badgeEstado}</td>
                        <td class="py-3 px-3 text-end">
                            <div class="flex items-center justify-end gap-1">
                                <button onclick="cambiarEstadoBloqueo('${slug}', ${!estadoBloqueado})" class="btn ${estadoBloqueado ? 'btn-outline-success' : 'btn-outline-danger'} btn-sm rounded-pill px-2 py-1 text-[10px]">
                                    ${estadoBloqueado ? 'Activar' : 'Bloquear'}
                                </button>
                                <button onclick="ajustarSuscripcion('${slug}', ${diasRestantes}, ${estadoBloqueado})" class="btn btn-outline-warning btn-sm rounded-pill px-2 py-1 text-[10px]">
                                    Suscrip.
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
            });

            document.getElementById('stat-total-tiendas').textContent = totalTiendas;
            document.getElementById('stat-tiendas-activas').textContent = tiendasActivas;
            document.getElementById('stat-tiendas-bloqueadas').textContent = tiendasBloqueadas;
            document.getElementById('stat-productos-totales').textContent = productosGlobales;
        }

        function renderizarHistorialPagos(pagos) {
            const tbody = document.getElementById('tabla-historial-pagos');
            tbody.innerHTML = "";

            if (!pagos || pagos.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-secondary text-xs">No hay pagos registrados aún.</td></tr>`;
                return;
            }

            pagos.forEach(pago => {
                const fechaFormateada = new Date(pago.fecha_registro).toLocaleDateString();
                tbody.innerHTML += `
                    <tr>
                        <td class="py-3 px-3 text-slate-400 text-xs">#${pago.id}</td>
                        <td class="py-3 px-3 fw-bold text-white text-xs">@${pago.tienda_slug}</td>
                        <td class="py-3 px-3 text-emerald-400 fw-bold text-xs">$${parseFloat(pago.monto).toFixed(2)}</td>
                        <td class="py-3 px-3 text-amber-400 font-semibold text-xs">+${pago.dias_agregados}d</td>
                        <td class="py-3 px-3 text-end text-slate-400 text-[10px]">${fechaFormateada}</td>
                    </tr>
                `;
            });
        }

        async function cambiarEstadoBloqueo(slug, bloquear) {
            const accionTexto = bloquear ? "bloquear esta tienda" : "desbloquear esta tienda";
            if (confirm(`¿Estás seguro de ${accionTexto}?`)) {
                try {
                    const db = window.dbCacheSuperAdmin || {};
                    const diasActuales = db[slug] && db[slug].diasSolventes !== undefined ? db[slug].diasSolventes : 30;

                    const res = await fetch(`${API_BASE_URL}/superadmin/actualizar-tienda`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ slug: slug, bloqueado: bloquear, diasSolventes: diasActuales, registrarPago: false })
                    });

                    if (res.ok) {
                        mostrarAlertaSync(bloquear ? "Tienda bloqueada." : "Tienda desbloqueada.");
                        await cargarPanelSuperAdmin();
                    } else {
                        alert("Error al actualizar.");
                    }
                } catch (err) {
                    alert("Error de red: " + err.message);
                }
            }
        }

        async function ajustarSuscripcion(slug, diasActuales, estadoBloqueado) {
            const nuevosDias = prompt("Ingresa la cantidad de nuevos días solventes:", diasActuales);
            if (nuevosDias !== null && !isNaN(nuevosDias)) {
                const montoPago = prompt("Ingresa el monto cobrado ($):", "10.00");
                if (montoPago !== null && !isNaN(montoPago)) {
                    try {
                        const diasInt = parseInt(nuevosDias);
                        const nuevoBloqueo = diasInt > 0 ? 0 : (estadoBloqueado ? 1 : 0);

                        const res = await fetch(`${API_BASE_URL}/superadmin/actualizar-tienda`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ 
                                slug: slug, 
                                bloqueado: nuevoBloqueo, 
                                diasSolventes: diasInt, 
                                registrarPago: true, 
                                montoPago: parseFloat(montoPago) 
                            })
                        });

                        if (res.ok) {
                            mostrarAlertaSync("Suscripción renovada con éxito.");
                            await cargarPanelSuperAdmin();
                        } else {
                            alert("Error al guardar.");
                        }
                    } catch (err) {
                        alert("Error de red: " + err.message);
                    }
                }
            }
        }

        function cerrarSesionSuperAdmin() {
            localStorage.removeItem('sesion_superadmin');
            window.location.href = 'login.html';
        }

        function mostrarAlertaSync(mensaje) {
            const alerta = document.getElementById('sync-alert');
            const texto = document.getElementById('sync-message');
            texto.textContent = mensaje;
            alerta.classList.remove('d-none');
            setTimeout(() => { alerta.classList.add('d-none'); }, 3000);
        }
    </script>
    
</body>
</html>
