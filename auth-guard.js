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
            // Mensaje más claro y descriptivo para el usuario
            alert("⚠️ Acceso Restringido: Esta sección es exclusiva para el Superadministrador de la plataforma.");
            window.location.href = "login.html";
            return;
        }
        return;
    }

    // 2. EVALUAR RUTA DE ADMINISTRADOR DE TIENDA (admin.html)
    if (paginaActual === "admin.html" || paginaActual === "admin_2.html") {
        const tiendaSlug = localStorage.getItem("sesion_vendedor");

        if (!tiendaSlug) {
            alert("⚠️ Acceso Denegado: Debe iniciar sesión con el identificador de su tienda para administrar el panel.");
            window.location.href = "login.html";
            return;
        }

        try {
            const dbLocal = localStorage.getItem("multi_tiendas_db");
            if (dbLocal) {
                const db = JSON.parse(dbLocal);
                const tienda = db[tiendaSlug.trim().toLowerCase()];

                if (tienda) {
                    if (tienda.bloqueado === true || Number(tienda.diasSolventes) <= 0) {
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
