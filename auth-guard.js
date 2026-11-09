/**
 * Auth Guard - MultiStore Cloud (Versión Blindada con Avisos Activos)
 * Protege rutas de SuperAdmin y Administrador de Tienda (Admin Normal).
 */
(function () {
    const pathLimpio = window.location.pathname.toLowerCase();
    const esSuperAdminPage = pathLimpio.includes("superadmin.html");
    const esAdminPage = pathLimpio.includes("admin.html") || pathLimpio.includes("admin_2.html");

    // ==========================================
    // A. PROTECCIÓN RUTA SUPERADMIN
    // ==========================================
    if (esSuperAdminPage) {
        const sesionSuper = localStorage.getItem("sesion_superadmin");
        if (!sesionSuper || sesionSuper.trim() === "") {
            alert("⚠️ ACCESO DENEGADO: Se requiere sesión de Superadministrador para ingresar a este panel.");
            window.location.href = "login.html";
            return;
        }
        return;
    }

    // ==========================================
    // B. PROTECCIÓN RUTA ADMINISTRADOR NORMAL (admin.html / admin_2.html)
    // ==========================================
    if (esAdminPage) {
        const tiendaSlug = localStorage.getItem("sesion_vendedor");
        if (!tiendaSlug || tiendaSlug.trim() === "") {
            alert("⚠️ ACCESO DENEGADO: Debe iniciar sesión con su tienda para acceder al panel de administración.");
            window.location.href = "login.html";
            return;
        }

        try {
            const dbLocal = localStorage.getItem("multi_tiendas_db");
            if (dbLocal) {
                const db = JSON.parse(dbLocal);
                const slugClean = tiendaSlug.trim().toLowerCase();
                const tienda = db[slugClean];

                if (!tienda) {
                    alert("⚠️ ACCESO DENEGADO: La tienda asociada a su sesión no existe o ha sido eliminada.");
                    localStorage.removeItem("sesion_vendedor");
                    window.location.href = "login.html";
                    return;
                }

                const estaBloqueado = tienda.bloqueado === true || tienda.bloqueado === 1 || Number(tienda.bloqueado) === 1;
                const diasRestantes = Number(tienda.diasSolventes !== undefined ? tienda.diasSolventes : 0);

                if (estaBloqueado) {
                    alert("🚫 TIENDA SUSPENDIDA: Su tienda ha sido bloqueada temporalmente. Contacte con soporte para reactivarla.");
                    localStorage.removeItem("sesion_vendedor");
                    window.location.href = "login.html";
                    return;
                }

                if (diasRestantes <= 0) {
                    alert("⏰ SUSCRIPCIÓN VENCIDA: Su cuenta ha llegado a 0 días solventes. Por favor, renueve su suscripción para reactivar su panel.");
                    localStorage.removeItem("sesion_vendedor");
                    window.location.href = "login.html";
                    return;
                }
            }
        } catch (e) {
            console.error("Error al evaluar sesión en AuthGuard:", e);
        }
    }
})();

/**
 * Función global auxiliar para cerrar sesión de forma segura
 */
function cerrarSesionYSalir() {
    localStorage.removeItem("sesion_vendedor");
    localStorage.removeItem("sesion_superadmin");
    window.location.href = "login.html";
}
