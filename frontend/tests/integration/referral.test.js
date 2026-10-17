import { describe, it, expect, vi, beforeEach } from "vitest";

// Usa vi.hoisted para garantir que estas variaveis sejam declaradas antes das importacoes
const { mockProfiles, mockReferrals } = vi.hoisted(() => {
    return {
        mockProfiles: new Map(),
        mockReferrals: []
    };
});

vi.mock("../../src/services/supabase.js", () => {
    return {
        supabaseAdmin: {
            from: (table) => {
                const filters = {};
                const chain = {
                    select: () => chain,
                    eq: (col, val) => {
                        filters[col] = val;
                        return chain;
                    },
                    order: () => chain,
                    limit: () => chain,
                    single: async () => {
                        if (table === "profiles") {
                            const entry = [...mockProfiles.values()].find(p => {
                                return Object.entries(filters).every(([col, val]) => p[col] === val);
                            });
                            return { data: entry ?? null, error: entry ? null : { message: "Not found" } };
                        }
                        return { data: null, error: null };
                    },
                    maybeSingle: async () => {
                        if (table === "profiles") {
                            const entry = [...mockProfiles.values()].find(p => {
                                return Object.entries(filters).every(([col, val]) => p[col] === val);
                            });
                            return { data: entry ?? null, error: null };
                        }
                        if (table === "referrals") {
                            const entry = mockReferrals.find(r => {
                                return Object.entries(filters).every(([col, val]) => r[col] === val);
                            });
                            return { data: entry ?? null, error: null };
                        }
                        return { data: null, error: null };
                    },
                    update: (data) => {
                        // Encontra e atualiza o profiles
                        return {
                            eq: (col, val) => {
                                const entry = [...mockProfiles.values()].find(p => p[col] === val);
                                if (entry) Object.assign(entry, data);
                                return { error: null };
                            }
                        };
                    },
                    insert: (data) => {
                        if (table === "referrals") {
                            mockReferrals.push({ ...data, id: `ref-${mockReferrals.length}` });
                        }
                        return { error: null };
                    },
                    then: (onFulfilled) => {
                        // Para getAffiliateStats (select e orders encadeados chamados direto via Promise.all)
                        const data = mockReferrals.filter(r => {
                            return Object.entries(filters).every(([col, val]) => r[col] === val);
                        });
                        return Promise.resolve({ data, error: null }).then(onFulfilled);
                    }
                };
                return chain;
            },
        },
    };
});

// Agora importamos o servico, garantindo que o mock do supabase esteja ativo
import {
    getOrCreateAffiliateCode,
    resolveCodeToUserId,
    processReward,
    getAffiliateStats,
} from "../../src/services/affiliateService.js";

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe("Affiliate Service — Integration Tests", () => {
    beforeEach(() => {
        mockProfiles.clear();
        mockReferrals.length = 0;

        // Seed: dois usuarios
        mockProfiles.set("referrer-1", { id: "referrer-1", affiliate_code: "CODE123", vip_until: null, is_vip: false });
        mockProfiles.set("buyer-1", { id: "buyer-1", affiliate_code: null, vip_until: null, is_vip: false });
    });

    // ─── Golden Path ───────────────────────────────────────────────────────

    it("Golden Path: processReward credits +30 days to referrer", async () => {
        const rewarded = await processReward("CODE123", "buyer-1", "payment-abc");
        expect(rewarded).toEqual({ rewarded: true, daysGranted: 30 });
        expect(mockReferrals.length).toBe(1);
        expect(mockReferrals[0].status).toBe("rewarded");
        expect(mockReferrals[0].days_granted).toBe(30);
    });

    // ─── Self-Referral Block ───────────────────────────────────────────────

    it("Self-referral is blocked", async () => {
        const rewarded = await processReward("CODE123", "referrer-1", "payment-self");
        expect(rewarded).toBe(false);
        expect(mockReferrals.length).toBe(0);
    });

    // ─── Idempotency ──────────────────────────────────────────────────────

    it("Idempotency: duplicate payment webhook is ignored", async () => {
        await processReward("CODE123", "buyer-1", "payment-dup");
        const secondCall = await processReward("CODE123", "buyer-1", "payment-dup");
        expect(secondCall).toBe(false);
        expect(mockReferrals.length).toBe(1); // Apenas um registro
    });

    // ─── Invalid Code ─────────────────────────────────────────────────────

    it("Invalid affiliate code returns false", async () => {
        const rewarded = await processReward("INVALID", "buyer-1", "payment-bad");
        expect(rewarded).toBe(false);
    });

    // ─── Code Generation ──────────────────────────────────────────────────

    it("getOrCreateAffiliateCode returns existing code if present", async () => {
        const code = await getOrCreateAffiliateCode("referrer-1");
        expect(code).toBe("CODE123");
    });

    // ─── Stats ────────────────────────────────────────────────────────────

    it("getAffiliateStats returns correct totals", async () => {
        mockReferrals.push({
            id: "r1",
            referrer_id: "ref-id",
            days_granted: 30,
            converted_at: new Date().toISOString(),
            status: "rewarded",
        });
        mockProfiles.set("ref-id", { id: "ref-id", affiliate_code: "MYCODE" });

        const stats = await getAffiliateStats("ref-id");
        expect(stats.totalConverted).toBe(1);
        expect(stats.daysGranted).toBe(30);
        expect(stats.code).toBe("MYCODE");
    });
});
