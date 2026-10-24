<?php

declare(strict_types=1);

/**
 * Roteador para desenvolvimento local: php -S localhost:8080 router.php
 *
 * Emula o vercel.json: /api/(.*) vai para api/index.php e o resto é servido como arquivo estático.
 */

$caminho = rawurldecode((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH));

if (str_starts_with($caminho, '/api/')) {
    $_SERVER['SCRIPT_NAME'] = '/api/index.php';
    require __DIR__ . '/api/index.php';

    return true;
}

if ($caminho === '/') {
    $caminho = '/index.html';
}

$arquivo = realpath(__DIR__ . $caminho);
$dentroDaRaiz = $arquivo !== false && str_starts_with($arquivo, __DIR__ . DIRECTORY_SEPARATOR);
$ehCodigo = $arquivo !== false && strtolower(pathinfo($arquivo, PATHINFO_EXTENSION)) === 'php';

if (!$dentroDaRaiz || !is_file($arquivo) || $ehCodigo) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo "404 Not Found\n";

    return true;
}

$tipos = [
    'html' => 'text/html; charset=utf-8',
    'css' => 'text/css; charset=utf-8',
    'js' => 'text/javascript; charset=utf-8',
    'mjs' => 'text/javascript; charset=utf-8',
    'json' => 'application/json; charset=utf-8',
    'yaml' => 'application/yaml; charset=utf-8',
    'yml' => 'application/yaml; charset=utf-8',
    'txt' => 'text/plain; charset=utf-8',
    'svg' => 'image/svg+xml',
];
$extensao = strtolower(pathinfo($arquivo, PATHINFO_EXTENSION));

header('Content-Type: ' . ($tipos[$extensao] ?? 'application/octet-stream'));
header('X-Content-Type-Options: nosniff');
readfile($arquivo);

return true;
