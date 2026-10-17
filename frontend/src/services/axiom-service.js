// src/services/axiom-service.js
import { Axiom } from '@axiomhq/js';
import { getEnv } from './env-adapter.js';

/**
 * AxiomService - Central de Observabilidade do MultiCanaisHD
 * Gerencia logs, métricas e rastreamento de erros.
 */
class AxiomService {
    constructor() {
        this.dataset = null;
        this.client = null;
    }

    /**
     * Inicializa o cliente sob demanda (Lazy Loading).
     * Necessário pois na Cloudflare as envs só ficam disponíveis após o início da requisição.
     */
    _init() {
        if (this.client) return true;

        const token = getEnv('AXIOM_TOKEN');
        this.dataset = getEnv('AXIOM_DATASET', 'multicanaishd');

        if (token) {
            try {
                this.client = new Axiom({ token });
                return true;
            } catch (e) {
                console.error("[AxiomService] Erro ao criar cliente:", e.message);
            }
        }
        return false;
    }

    /**
     * Envia eventos para o Axiom de forma otimizada.
     * @param {Object|Object[]} events 
     */
    async ingest(events) {
        if (!this._init()) return;

        try {
            const data = Array.isArray(events) ? events : [events];
            // `client.ingest()` do @axiomhq/js só ENFILEIRA no batch em memória — a função
            // interna (Batch.ingest) não tem `return`, então o `await` aqui sempre resolve
            // quase instantaneamente, ANTES de qualquer POST real acontecer. O envio de
            // verdade só ocorre via `flush()`, que roda sozinho num `setTimeout` de até 1s
            // ou ao acumular 1000 eventos — nenhum dos dois é algo que o Worker consiga
            // aguardar entre o fim de uma requisição e o encerramento do isolate.
            //
            // Esse SDK foi feito pra processo Node de vida longa, não pra invocação
            // stateless por requisição. Sem `flush()` explícito, todo `waitUntil(ingest(...))`
            // no projeto era um no-op disfarçado: a promise "terminava" antes do trabalho
            // real começar, e o isolate podia ser reciclado com o batch ainda na fila —
            // era por isso que só rotas de tráfego intenso (onde o isolate ficava quente
            // o suficiente pro timer disparar por acidente) apareciam no Axiom, e chamadas
            // isoladas de API (como as negadas pelo gate de VIP) nunca chegavam.
            //
            // Custa uma requisição HTTP por evento em vez de lote — é a troca certa aqui:
            // não dá pra confiar em estado compartilhado entre invocações de Worker.
            this.client.ingest(this.dataset, data);
            await this.client.flush();
        } catch (e) {
            // Em caso de erro no log, não quebramos a aplicação (Silent Fail)
            console.error("[AxiomService] Erro ao enviar logs:", e.message);
        }
    }

    /**
     * Log especializado para requisições HTTP (Middleware)
     */
    async logRequest({ method, url, status, duration, userAgent, ip, referer, host, platform = 'multicanaishd-web', query = null, sampleRate = 1 }) {
        const event = {
            _time: new Date().toISOString(),
            type: 'http_request',
            method,
            url,
            status,
            duration_ms: duration,
            userAgent,
            ip: this._sanitizeIp(ip),
            referer,
            host,
            platform,
            // `sampleRate` < 1 significa que este evento representa vários: multiplique a
            // contagem por 1/sampleRate pra estimar o volume real na query do Axiom.
            // Ex: `summarize volumeReal = sum(1.0 / sampleRate) by url`.
            sampleRate
        };

        // Só preenchido nas rotas de API amostradas — é onde a query string carrega a
        // informação que interessa (qual `source` foi pedido, qual conteúdo).
        if (query) event.query = query;

        return this.ingest(event);
    }

    /**
     * Executa uma query APL de leitura (usado pelo painel de monitoramento).
     * Retorna null em caso de falha, sem quebrar o chamador.
     */
    async query(apl, options = {}) {
        if (!this._init()) return null;

        try {
            // format 'tabular' é obrigatório aqui: sem isso o SDK responde no formato
            // legacy (buckets/matches) e o código chamador (que lê result.tables) sempre
            // via undefined, retornando vazio mesmo com a query funcionando perfeitamente.
            return await this.client.query(apl, { format: 'tabular', ...options });
        } catch (e) {
            console.error("[AxiomService] Erro ao consultar:", e.message);
            return null;
        }
    }

    /**
     * Rastreamento de erros críticos
     */
    async logError(error, context = {}) {
        const event = {
            _time: new Date().toISOString(),
            type: 'error',
            message: error.message,
            stack: error.stack,
            code: error.code || 'UNKNOWN_ERROR',
            platform: 'multicanaishd-web',
            ...context
        };

        // Log local para debug imediato
        console.error(`❌ [CriticalError] ${error.message}`, context);

        return this.ingest(event);
    }

    /**
     * Sanitiza o IP por questões de privacidade (GDPR/LGPD)
     */
    _sanitizeIp(ip) {
        if (!ip) return 'unknown';
        // Exemplo simples: remove o último octeto
        return ip.replace(/\.\d+$/, '.xxx');
    }
}

// Singleton para garantir uma única conexão
export const axiomService = new AxiomService();
export default axiomService;
