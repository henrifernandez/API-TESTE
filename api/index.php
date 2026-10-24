<?php

declare(strict_types=1);

/**
 * Entrada única da API. Funciona com ou sem vendor/: o deploy na Vercel não roda o Composer.
 */

// Nunca exibe erros de PHP ao cliente; eles seguem para o log do servidor.
ini_set('display_errors', '0');

$raiz = dirname(__DIR__);

if (is_file($raiz . '/vendor/autoload.php')) {
    require $raiz . '/vendor/autoload.php';
} else {
    spl_autoload_register(static function (string $classe) use ($raiz): void {
        $prefixo = 'ApiTeste\\';
        if (str_starts_with($classe, $prefixo)) {
            $arquivo = $raiz . '/src/' . str_replace('\\', '/', substr($classe, strlen($prefixo))) . '.php';
            if (is_file($arquivo)) {
                require $arquivo;
            }
        }
    });
}

(new ApiTeste\Router())->handle(ApiTeste\Request::fromGlobals())->enviar();
