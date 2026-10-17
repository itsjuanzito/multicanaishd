// tests/axiom.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { axiomService } from '../../src/services/axiom-service.js';

// Mock do Axiom SDK
vi.mock('@axiomhq/js', () => {
    return {
        Axiom: vi.fn().mockImplementation(() => {
            return {
                ingest: vi.fn().mockResolvedValue({}),
            };
        }),
    };
});

// Mock do env-adapter
vi.mock('../src/services/env-adapter.js', () => ({
    getEnv: vi.fn((key) => {
        if (key === 'AXIOM_TOKEN') return 'test-token';
        if (key === 'AXIOM_DATASET') return 'test-dataset';
        return null;
    }),
}));

describe('AxiomService', () => {
    it('deve formatar corretamente o log de requisição', async () => {
        const spy = vi.spyOn(axiomService, 'ingest');
        
        await axiomService.logRequest({
            method: 'GET',
            url: '/test',
            status: 200,
            duration: 150,
            userAgent: 'Vitest',
            ip: '127.0.0.1'
        });

        expect(spy).toHaveBeenCalled();
        const event = spy.mock.calls[0][0];
        expect(event.type).toBe('http_request');
        expect(event.method).toBe('GET');
        expect(event.status).toBe(200);
        expect(event.ip).toBe('127.0.0.xxx'); // Sanitizado
    });

    it('deve formatar corretamente o log de erro', async () => {
        const spy = vi.spyOn(axiomService, 'ingest');
        const error = new Error('Teste de erro');
        
        await axiomService.logError(error, { userId: '123' });

        expect(spy).toHaveBeenCalled();
        const event = spy.mock.calls[1][0]; // Segundo call (acumulado do anterior se não resetado)
        expect(event.type).toBe('error');
        expect(event.message).toBe('Teste de erro');
        expect(event.userId).toBe('123');
    });
});
