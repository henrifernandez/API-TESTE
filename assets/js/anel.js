import * as THREE from '../vendor/three/three.module.min.js';

const PARTICULAS = 1500;
const RAIO = 1.9;
const DURACAO_TREMOR = 0.6; // segundos
const PERIODO_PULSO = 2.6; // segundos
const VOLTA = Math.PI * 2;

const COR_ALVO = {
    repouso: new THREE.Color(0x3df0d2),
    sucesso: new THREE.Color(0x3df0d2),
    aguardando: new THREE.Color(0xffb454),
    erro: new THREE.Color(0xff7a7a),
};

function gerador(semente) {
    let s = semente;

    return () => {
        s = (s * 16807) % 2147483647;

        return (s - 1) / 2147483646;
    };
}

function criarTexturaPonto() {
    const tela = document.createElement('canvas');
    tela.width = 64;
    tela.height = 64;
    const ctx = tela.getContext('2d');
    const gradiente = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradiente.addColorStop(0, 'rgba(255,255,255,1)');
    gradiente.addColorStop(0.45, 'rgba(255,255,255,0.8)');
    gradiente.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradiente;
    ctx.fillRect(0, 0, 64, 64);

    return new THREE.CanvasTexture(tela);
}

/**
 * Anel de partículas que visualiza o estado da requisição.
 * Estados: repouso, aguardando (âmbar, girando), sucesso (ciano, pulso leve), erro (vermelho, tremor curto).
 */
export function criarAnel(canvas, { aoPerderContexto = () => {} } = {}) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);

    const cena = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
    camera.position.z = 8;

    const sorteio = gerador(20261024);
    const angulos = new Float32Array(PARTICULAS);
    const raios = new Float32Array(PARTICULAS);
    const fases = new Float32Array(PARTICULAS * 2);
    const profundidade = new Float32Array(PARTICULAS);

    for (let i = 0; i < PARTICULAS; i++) {
        angulos[i] = (i / PARTICULAS) * VOLTA + (sorteio() - 0.5) * 0.004;
        raios[i] = RAIO + (sorteio() - 0.5) * 0.16;
        profundidade[i] = (sorteio() - 0.5) * 0.18;
        fases[i * 2] = sorteio() * VOLTA;
        fases[i * 2 + 1] = sorteio() * VOLTA;
    }

    const posicoes = new Float32Array(PARTICULAS * 3);
    const cores = new Float32Array(PARTICULAS * 3);
    const geometria = new THREE.BufferGeometry();
    geometria.setAttribute('position', new THREE.BufferAttribute(posicoes, 3));
    geometria.setAttribute('color', new THREE.BufferAttribute(cores, 3));

    const textura = criarTexturaPonto();
    const material = new THREE.PointsMaterial({
        size: 0.12,
        map: textura,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
    });
    const pontos = new THREE.Points(geometria, material);
    cena.add(pontos);

    let estado = 'repouso';
    let inicioEstado = 0;
    let relogio = 0;
    let movimento = false;
    let quadro = 0;
    let anterior = 0;
    let destruido = false;
    const corAtual = COR_ALVO.repouso.clone();

    function desenhar(t, dt) {
        const alvo = COR_ALVO[estado];
        if (movimento) {
            corAtual.lerp(alvo, 1 - Math.exp(-dt * 9));
        } else {
            corAtual.copy(alvo);
        }

        const ativo = movimento;
        const decorrido = t - inicioEstado;
        const pulso = ativo && (estado === 'sucesso' || estado === 'repouso')
            ? Math.sin((t * VOLTA) / PERIODO_PULSO) * 0.5 + 0.5
            : 0;
        const escala = 1 + (pulso - 0.5) * 0.05;
        const tremor = ativo && estado === 'erro' ? Math.max(0, 1 - decorrido / DURACAO_TREMOR) : 0;
        // Resíduo fixo no erro: o anel segue levemente irregular, mesmo sem movimento.
        const irregular = estado === 'erro' ? 0.045 : 0;
        const cabeca = (t * 2.8) % VOLTA;
        const base = estado === 'repouso' ? 0.7 : 1;

        for (let i = 0; i < PARTICULAS; i++) {
            const a = angulos[i];
            const r = raios[i] * escala;
            let x = Math.cos(a) * r;
            let y = Math.sin(a) * r;

            if (irregular > 0) {
                x += Math.sin(fases[i * 2]) * irregular;
                y += Math.sin(fases[i * 2 + 1]) * irregular;
            }
            if (tremor > 0) {
                x += (Math.sin(t * 61 + fases[i * 2]) + Math.sin(t * 37 + fases[i * 2 + 1])) * 0.11 * tremor;
                y += (Math.sin(t * 53 + fases[i * 2 + 1]) + Math.sin(t * 41 + fases[i * 2])) * 0.11 * tremor;
            }

            posicoes[i * 3] = x;
            posicoes[i * 3 + 1] = y;
            posicoes[i * 3 + 2] = profundidade[i];

            let brilho = base;
            if (estado === 'aguardando' && ativo) {
                // Cauda de cometa que gira: partículas atrás da cabeça ficam mais escuras.
                const atras = (((cabeca - a) % VOLTA) + VOLTA) % VOLTA;
                brilho = 0.1 + 0.9 * Math.pow(Math.max(0, 1 - atras / (VOLTA * 0.75)), 1.6);
            } else if (pulso > 0) {
                brilho = base * (0.8 + 0.2 * pulso);
            }

            cores[i * 3] = corAtual.r * brilho;
            cores[i * 3 + 1] = corAtual.g * brilho;
            cores[i * 3 + 2] = corAtual.b * brilho;
        }

        geometria.attributes.position.needsUpdate = true;
        geometria.attributes.color.needsUpdate = true;
        renderer.render(cena, camera);
    }

    function passo(agora) {
        if (!movimento || destruido) {
            return;
        }
        const dt = Math.min((agora - anterior) / 1000, 0.05);
        anterior = agora;
        relogio += dt;
        desenhar(relogio, dt);
        quadro = requestAnimationFrame(passo);
    }

    function desenharEstatico() {
        desenhar(relogio, 0);
    }

    function redimensionar() {
        const pai = canvas.parentElement;
        const largura = Math.max(1, pai ? pai.clientWidth : canvas.clientWidth);
        const altura = Math.max(1, pai ? pai.clientHeight : canvas.clientHeight);
        renderer.setSize(largura, altura, false);
        camera.aspect = largura / altura;
        // Garante que o anel inteiro caiba, inclusive em telas estreitas.
        const metadeFov = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        camera.position.z = Math.max(8, 5.6 / (2 * metadeFov * Math.min(1, camera.aspect)));
        camera.updateProjectionMatrix();
        if (!movimento) {
            desenharEstatico();
        }
    }

    const observador = new ResizeObserver(redimensionar);
    observador.observe(canvas.parentElement ?? canvas);

    canvas.addEventListener('webglcontextlost', (evento) => {
        evento.preventDefault();
        aoPerderContexto();
    });

    redimensionar();

    return {
        definirEstado(novo) {
            if (!(novo in COR_ALVO) || novo === estado) {
                return;
            }
            estado = novo;
            inicioEstado = relogio;
            if (!movimento) {
                desenharEstatico();
            }
        },
        definirMovimento(ligado) {
            if (destruido || ligado === movimento) {
                return;
            }
            movimento = ligado;
            cancelAnimationFrame(quadro);
            if (ligado) {
                anterior = performance.now();
                quadro = requestAnimationFrame(passo);
            } else {
                desenharEstatico();
            }
        },
        destruir() {
            destruido = true;
            movimento = false;
            cancelAnimationFrame(quadro);
            observador.disconnect();
            geometria.dispose();
            material.dispose();
            textura.dispose();
            renderer.dispose();
            renderer.forceContextLoss();
        },
    };
}
