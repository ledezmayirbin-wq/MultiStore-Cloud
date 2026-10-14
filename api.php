<?php
header("Content-Type: application/json; charset=UTF-8");

$host = 'localhost';
$dbname = 'catalogo_ropa';
$username = 'root';
$password = '';

try {
$conexion = new PDO("mysql:host=$host;dbname=$dbname;charset=utf8mb4", $username, $password);
$conexion->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

$sql = "SELECT p.id, p.nombre, p.descripcion, p.precio, p.tallas, p.colores, p.stock, p.url_imagen, c.nombre AS categoria
FROM productos p
LEFT JOIN categorias c ON p.categoria_id = c.id";

$stmt = $conexion->prepare($sql);
$stmt->execute();

$productos = $stmt->fetchAll(PDO::FETCH_ASSOC);

echo json_encode([
"estado" => "success",
"datos" => $productos
], JSON_UNESCAPED_UNICODE);

} catch (PDOException $e) {
http_response_code(500);
echo json_encode([
"estado" => "error",
"mensaje" => "Error de conexión: " . $e->getMessage()
], JSON_UNESCAPED_UNICODE);
}
?>