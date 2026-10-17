// mobile/src/services/epgService.ts
// Guia de programação via XMLTV do Superflix (superflixapi.pro/lista?category=guia)
// Os IDs de canal no XML batem diretamente com os IDs da API de canais (espn, hbo, globosp, etc.)

export interface NowPlayingInfo {
  title: string;
  start: number;
  stop: number;
  progress: number;
  next: { title: string; start: number } | null;
}

interface Programme {
  title: string;
  start: number;
  stop: number;
}

interface EpgState {
  gridCache: Record<string, Programme[]> | null;
  gridFetchedAt: number;
  currentFetchPromise: Promise<Record<string, Programme[]>> | null;
  calcCache: Record<string, { value: NowPlayingInfo; timestamp: number }>;
}

const state: EpgState = {
  gridCache: null,
  gridFetchedAt: 0,
  currentFetchPromise: null,
  calcCache: {}
};

const EPG_MEM_TTL = 60 * 60 * 1000; // 1 hora
const CALC_TTL = 30000; // 30s
const EPG_FETCH_TIMEOUT = 15000; // 15s

const EPG_DOMAINS = [
  'https://superflixapi.pro',
  'https://superflixapi.online',
  'https://superflixapi.buzz'
];

async function fetchAndParseEpg(): Promise<Record<string, Programme[]>> {
  let xmlText: string | null = null;

  for (const domain of EPG_DOMAINS) {
    try {
      const url = `${domain}/lista?category=guia`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), EPG_FETCH_TIMEOUT);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'Accept': 'text/xml, application/xml, */*' }
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        xmlText = await response.text();
        if (xmlText && xmlText.trim().length >= 100) {
          console.log(`✅ [EPG] Guia obtido de ${domain}`);
          break;
        }
        xmlText = null;
      }
    } catch (e) {
      // Silencioso, tenta o próximo domínio
    }
  }

  if (!xmlText) {
    console.warn('⚠️ [EPG] Nenhum XMLTV válido recebido.');
    return {};
  }

  return parseXmltv(xmlText);
}

/**
 * Parser XMLTV — extrai programas por canal sem regex para máxima performance.
 */
function parseXmltv(xmlText: string): Record<string, Programme[]> {
  const programmesByChannel: Record<string, Programme[]> = {};
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const windowStart = now - day / 4; // 6h atrás
  const windowEnd = now + day * 1.5; // 36h à frente

  let pos = 0;

  while (pos < xmlText.length) {
    const startTag = xmlText.indexOf('<programme', pos);
    if (startTag === -1) break;

    const endTag = xmlText.indexOf('</programme>', startTag);
    if (endTag === -1) break;

    const fullTag = xmlText.substring(startTag, endTag + 12);
    const attrEnd = fullTag.indexOf('>');
    const attrs = fullTag.substring(0, attrEnd);

    const channelId = getXmlAttr(attrs, 'channel');
    const startStr = getXmlAttr(attrs, 'start');
    const stopStr = getXmlAttr(attrs, 'stop');

    if (channelId && startStr && stopStr) {
      const startParts = startStr.split(' ');
      const stopParts = stopStr.split(' ');

      const start = parseXmltvDate(startParts[0], startParts[1] || '-0300');
      const stop = parseXmltvDate(stopParts[0], stopParts[1] || '-0300');

      if (!isNaN(start) && !isNaN(stop) && stop >= windowStart && start <= windowEnd) {
        const content = fullTag.substring(attrEnd + 1);
        const title = extractTitle(content);

        if (!programmesByChannel[channelId]) {
          programmesByChannel[channelId] = [];
        }
        programmesByChannel[channelId].push({ title, start, stop });
      }
    }

    pos = endTag + 12;
  }

  for (const id of Object.keys(programmesByChannel)) {
    programmesByChannel[id].sort((a, b) => a.start - b.start);
  }

  return programmesByChannel;
}

function getXmlAttr(attrs: string, name: string): string | null {
  let idx = attrs.indexOf(name + '="');
  if (idx !== -1) {
    const start = idx + name.length + 2;
    const end = attrs.indexOf('"', start);
    if (end !== -1) return attrs.substring(start, end);
  }
  idx = attrs.indexOf(name + "='");
  if (idx !== -1) {
    const start = idx + name.length + 2;
    const end = attrs.indexOf("'", start);
    if (end !== -1) return attrs.substring(start, end);
  }
  return null;
}

function extractTitle(content: string): string {
  const tStart = content.indexOf('<title');
  if (tStart === -1) return 'Sem título';
  const tValStart = content.indexOf('>', tStart);
  if (tValStart === -1) return 'Sem título';
  const tEnd = content.indexOf('</title>', tValStart);
  if (tEnd === -1) return 'Sem título';
  return decodeHtmlEntities(content.substring(tValStart + 1, tEnd).trim());
}

function parseXmltvDate(dateStr: string, offset: string = '-0300'): number {
  if (!dateStr || dateStr.length < 8) return NaN;
  const year = dateStr.substring(0, 4);
  const month = dateStr.substring(4, 6);
  const day = dateStr.substring(6, 8);
  const hour = dateStr.length >= 10 ? dateStr.substring(8, 10) : '00';
  const min = dateStr.length >= 12 ? dateStr.substring(10, 12) : '00';
  const sec = dateStr.length >= 14 ? dateStr.substring(12, 14) : '00';

  const formattedOffset = offset.replace(/([+-]\d{2})(\d{2})/, '$1:$2');
  const isoString = `${year}-${month}-${day}T${hour}:${min}:${sec}${formattedOffset}`;
  const ts = new Date(isoString).getTime();
  if (!isNaN(ts)) return ts;
  return new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}Z`).getTime();
}

function decodeHtmlEntities(text: string): string {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'");
}

function calcCurrentProgram(schedule: Programme[], now: number): NowPlayingInfo | null {
  if (!Array.isArray(schedule) || schedule.length === 0) return null;

  let currentProg = schedule.find(p => now >= p.start && now <= p.stop);
  if (!currentProg) {
    currentProg = [...schedule].reverse().find(p => now >= p.start) || undefined;
  }
  if (!currentProg) return null;

  const currentIndex = schedule.indexOf(currentProg);
  const nextProg = schedule[currentIndex + 1] || null;
  const duration = currentProg.stop - currentProg.start;
  const progress = duration > 0 ? Math.round(((now - currentProg.start) / duration) * 100) : 0;

  return {
    title: currentProg.title,
    start: currentProg.start,
    stop: currentProg.stop,
    progress: Math.min(Math.max(progress, 0), 100),
    next: nextProg ? { title: nextProg.title, start: nextProg.start } : null
  };
}

async function getEpgGrid(): Promise<Record<string, Programme[]>> {
  const now = Date.now();

  if (state.gridCache && now - state.gridFetchedAt < EPG_MEM_TTL) {
    return state.gridCache;
  }

  if (state.currentFetchPromise) {
    return state.currentFetchPromise;
  }

  state.currentFetchPromise = (async () => {
    try {
      const data = await fetchAndParseEpg();
      if (Object.keys(data).length > 0) {
        state.gridCache = data;
        state.gridFetchedAt = Date.now();
        state.calcCache = {};
        console.log(`📦 [EPG] Grade carregada: ${Object.keys(data).length} canais.`);
      }
      return state.gridCache || {};
    } catch (e) {
      console.warn('[EPG] Falha ao buscar grade:', e);
      return state.gridCache || {};
    } finally {
      state.currentFetchPromise = null;
    }
  })();

  return state.currentFetchPromise;
}

/**
 * Retorna os programas atuais de múltiplos canais de uma vez (bulk).
 */
export async function getNowPlayingBulk(channelIds: string[]): Promise<Record<string, NowPlayingInfo>> {
  if (!channelIds || channelIds.length === 0) return {};

  try {
    const now = Date.now();
    const results: Record<string, NowPlayingInfo> = {};
    const missing: string[] = [];

    for (const id of channelIds) {
      const cached = state.calcCache[id];
      if (cached && now - cached.timestamp < CALC_TTL && now >= cached.value.start && now <= cached.value.stop) {
        results[id] = cached.value;
      } else {
        missing.push(id);
      }
    }

    if (missing.length === 0) return results;

    const grid = await getEpgGrid();

    for (const id of missing) {
      const schedule = grid[id];
      if (!schedule) continue;
      const result = calcCurrentProgram(schedule, now);
      if (result) {
        state.calcCache[id] = { value: result, timestamp: now };
        results[id] = result;
      }
    }

    return results;
  } catch (e) {
    console.error('[EPG] Erro ao buscar programas em lote:', e);
    return {};
  }
}
