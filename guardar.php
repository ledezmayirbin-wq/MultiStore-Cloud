<?php
$host = 'localhost';
$dbname = 'catalogo_ropa';
$username = 'root';
$password = '';

try {
    $pdo = new PDO("mysql:host=$host;dbname=$dbname;charset=utf8", $username, $password);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $nombre = $_POST['nombre'];
        $descripcion = $_POST['descripcion'];
        $precio = $_POST['precio'];
        $tallas = $_POST['tallas'];
        $colores = $_POST['colores'];
        $stock = $_POST['stock'];
        $url_imagen = $_POST['url_imagen'];
        $categoria_id = $_POST['categoria_id'];

        $sql = "INSERT INTO productos (nombre, descripcion, precio, tallas, colores, stock, url_imagen, categoria_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
        $stmt = $pdo->prepare($sql);
        $stmt->execute([$nombre, $descripcion, $precio, $tallas, $colores, $stock, $url_imagen, $categoria_id]);

        header("Location: admin.php?exito=1");
        exit();
    }
} catch (PDOException $e) {
    echo "Error de conexión: " . $e->getMessage();
}
?>