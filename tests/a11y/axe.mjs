// Verifica o console com axe-core (WCAG 2.0, 2.1 e 2.2, níveis A e AA) em vários estados.
// Uso: BASE_URL=http://localhost:8080 node axe.mjs
import AxeBuilder from '@axe-core/playwright';
import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8080';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];

const cenarios = [
    { nome: 'desktop, estado inicial', contexto: { viewport: { width: 1280, height: 800 } } },
    {
        nome: 'desktop, resposta de sucesso (GET /api/v1/status)',
        contexto: { viewport: { width: 1280, height: 800 } },
        clicar: 'Consultar status',
        esperar: '200 OK',
    },
    {
        nome: 'desktop, resposta de erro (GET /api/v1/mensagens/99)',
        contexto: { viewport: { width: 1280, height: 800 } },
        clicar: 'Testar erro 404',
        esperar: '404 Not Found',
    },
    {
        nome: 'celular, estado inicial',
        contexto: { viewport: { width: 375, height: 812 }, isMobile: true },
    },
    {
        nome: 'movimento reduzido (SVG estático, sem three.js)',
        contexto: { viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' },
        clicar: 'Testar erro 404',
        esperar: '404 Not Found',
        semThree: true,
    },
];

const navegador = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
let falhas = 0;

for (const cenario of cenarios) {
    const contexto = await navegador.newContext(cenario.contexto);
    const pagina = await contexto.newPage();
    const baixados = [];
    pagina.on('request', (requisicao) => baixados.push(requisicao.url()));

    await pagina.goto(BASE_URL, { waitUntil: 'networkidle' });

    if (cenario.clicar) {
        await pagina.getByRole('button', { name: new RegExp(cenario.clicar) }).click();
        await pagina.locator('#r-status', { hasText: cenario.esperar }).waitFor({ timeout: 10000 });
    }

    const resultado = await new AxeBuilder({ page: pagina }).withTags(TAGS).analyze();
    const problemas = [];

    if (resultado.violations.length > 0) {
        for (const violacao of resultado.violations) {
            problemas.push(`${violacao.id} (${violacao.impact}): ${violacao.help}`);
            for (const no of violacao.nodes) {
                problemas.push(`    ${no.target.join(' ')}`);
            }
        }
    }

    if (cenario.semThree && baixados.some((url) => url.includes('/vendor/three/'))) {
        problemas.push('three.js foi baixado mesmo com movimento reduzido');
    }

    if (problemas.length > 0) {
        falhas += 1;
        console.error(`FALHOU: ${cenario.nome}`);
        problemas.forEach((linha) => console.error(`  ${linha}`));
    } else {
        console.log(`OK: ${cenario.nome} (${resultado.passes.length} regras aprovadas)`);
    }

    await contexto.close();
}

await navegador.close();

if (falhas > 0) {
    console.error(`\n${falhas} cenário(s) com violações de acessibilidade.`);
    process.exit(1);
}

console.log('\nNenhuma violação de acessibilidade encontrada.');
