/**
 * Auth Guard - MultiStore Cloud (Con Avisos de Seguridad Activos)
 * Protege las rutas de SuperAdmin y Administrador de Tienda (Admin Normal).
 */
(function () {
    // 1. Ruta actual limpia (sin query params ni slashes extras)
    const pathLimpio = window.location.pathname.toLowerCase();
    const esSuperAdminPage = pathLimpio.includes("superadmin.html");
    const esAdminPage = pathLimpio.includes("admin.html") || pathLimpio.includes("admin_2.html");

    // ==========================================
    // A. PROTECCIÓN RUTA SUPERADMIN
    // ==========================================
    if (esSuperAdminPage) {
        const sesionSuper = localStorage.getItem("sesion_superadmin");
        if (!sesionSuper || sesionSuper.trim() === "") {
            alert("⚠️ ACCESO DENEGADO: Se requiere sesión de Superadministrador para ingresar a esta sección.");
            window.location.href = "login.html";
            return;
        }
        return; // Permite el paso al SuperAdmin
    }

    // ==========================================
    // B. PROTECCIÓN RUTA ADMINISTRADOR NORMAL (admin.html / admin_2.html)
    // ==========================================
    if (esAdminPage) {
        const tiendaSlug = localStorage.getItem("sesion_vendedor");

        // B1. Sin sesión activa -> AVISO + EXPULSIÓN
        if (!tiendaSlug || tiendaSlug.trim() === "") {
            alert("⚠️ ACCESO DENEGADO: Debe iniciar sesión con su tienda para acceder al panel de administración.");
            window.location.href = "login.html";
            return;
        }

        // B2. Validación contra la base de datos local
        try {
            const dbLocal = localStorage.getItem("multi_tiendas_db");
            
            if (dbLocal) {
                const db = JSON.parse(dbLocal);
                const slugClean = tiendaSlug.trim().toLowerCase();
                const tienda = db[slugClean];

                // B3. Tienda inexistente -> AVISO + EXPULSIÓN
                if (!tienda) {
                    alert("⚠️ ACCESO DENEGADO: La tienda asociada a su sesión no existe o ha sido eliminada.");
                    localStorage.removeItem("sesion_vendedor");
                    window.location.href = "login.html";
                    return;
                }

                // B4. Verificación de bloqueo y días solventes
                const estaBloqueado = tienda.bloqueado === true || tienda.bloqueado === 1 || Number(tienda.bloqueado) === 1;
                const diasRestantes = Number(tienda.diasSolventes || 0);

                // B5. Si está suspendida manualmente -> AVISO + EXPULSIÓN
                if (estaBloqueado) {
                    alert("🚫 TIENDA BLOQUEADA: Su tienda ha sido suspendida. Contacte con soporte para más información.");
                    localStorage.removeItem("sesion_vendedor");
                    window.location.href = "login.html";
                    return;
                }

                // B6. Si se le acabaron los días solventes -> AVISO + EXPULSIÓN
                if (diasRestantes <= 0) {
                    alert("⏰ SUSCRIPCIÓN VENCIDA: Cuenta con 0 días solventes. Por favor, renueve su suscripción para reactivar su panel.");
                    localStorage.removeItem("sesion_vendedor");
                    window.location.href = "login.html";
                    return;
                }
            }
        } catch (e) {
            console.error("Error al validar sesión en AuthGuard:", e);
        }
    }
})();

/**
 * Función global para cerrar sesión limpiamente
 */
function cerrarSesionYSalir() {
    localStorage.removeItem("sesion_vendedor");
    localStorage.removeItem("sesion_superadmin");
    window.location.href = "login.html";
}
