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