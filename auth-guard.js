/**
 * Auth Guard - MultiStore Cloud (Versión Blindada con Avisos Activos)
 * Protege rutas de SuperAdmin y Administrador de Tienda (Admin Normal).
 */
(function () {
    // 1. Limpieza de ruta (elimina parámetros ?tienda= y slashes de más)
    const pathLimpio = window.location.pathname.toLowerCase();
    const esSuperAdminPage = pathLimpio.includes("superadmin.html");
    const esAdminPage = pathLimpio.includes("admin.html") || pathLimpio.includes("admin_2.html");

    // ==========================================
    // A. PROTECCIÓN RUTA SUPERADMIN
    // ==========================================
    if (esSuperAdminPage) {
        const sesionSuper = localStorage.getItem("sesion_superadmin");
        if (!sesionSuper || sesionSuper.trim() === "") {
            alert("⚠️ ACCESO DENEGADO: Se requiere sesión de Superadministrador para acceder a este panel.");
            window.location.href = "login.html";
            return;
        }
        return; // Sesión válida de SuperAdmin
    }

    // ==========================================
    // B. PROTECCIÓN RUTA ADMINISTRADOR NORMAL (admin.html / admin_2.html)
    // ==========================================
    if (esAdminPage) {
        const tiendaSlug = localStorage.getItem("sesion_vendedor");

        // B1. Sin sesión activa -> AVISO + EXPULSIÓN
        if (!tiendaSlug || tiendaSlug.trim() === "") {
            alert("⚠️ ACCESO DENEGADO: Debe iniciar sesión con su cuenta de tienda para acceder al panel.");
            window.location.href = "login.html";
            return;
        }

        // B2. Validación de tienda en la base de datos local / caché
        try {
            const dbLocal = localStorage.getItem("multi_tiendas_db");
            
            if (dbLocal) {
                const db = JSON.parse(dbLocal);
                const slugClean = tiendaSlug.trim().toLowerCase();
                const tienda = db[slugClean];

                // B3. Tienda no registrada o eliminada -> AVISO + EXPULSIÓN
                if (!tienda) {
                    alert("⚠️ ACCESO DENEGADO: La tienda asociada a su sesión no existe o ha sido eliminada.");
                    localStorage.removeItem("sesion_vendedor");
                    window.location.href = "login.html";
                    return;
                }

                // B4. Verificación de estado de bloqueo (compatible con booleano true y entero 1)
                const estaBloqueado = tienda.bloqueado === true || tienda.bloqueado === 1 || Number(tienda.bloqueado) === 1;
                const diasRestantes = Number(tienda.diasSolventes !== undefined ? tienda.diasSolventes : 0);

                // B5. Tienda suspendida manualmente por SuperAdmin -> AVISO + EXPULSIÓN
                if (estaBloqueado) {
                    alert("🚫 TIENDA SUSPENDIDA: Su tienda se encuentra bloqueada temporalmente. Contacte con soporte para reactivarla.");
                    localStorage.removeItem("sesion_vendedor");
                    window.location.href = "login.html";
                    return;
                }

                // B6. Suscripción vencida (0 días) -> AVISO + EXPULSIÓN
                if (diasRestantes <= 0) {
                    alert("⏰ SUSCRIPCIÓN VENCIDA: Su cuenta ha llegado a 0 días solventes. Por favor, renueve su suscripción para ingresar a su panel.");
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
 * Función global auxiliar para cerrar sesión limpiamente
 */
function cerrarSesionYSalir() {
    localStorage.removeItem("sesion_vendedor");
    localStorage.removeItem("sesion_superadmin");
    window.location.href = "login.html";
}
