import dayjs from 'dayjs';
import { TMarket } from './types';

const CMC_API_KEY = process.env.CMC_API_KEY || '';
const CMC_BASE = 'https://pro-api.coinmarketcap.com';
const AI_ANALYSIS_URL = 'https://charts-277369611639.us-central1.run.app/ai-analysis-general';

type GlobalMetricsResponse = {
  status: { error_code: number; error_message?: string };
  data: {
    btc_dominance: number;
    eth_dominance: number;
    quote: {
      USD: {
        total_market_cap: number;
        total_market_cap_yesterday?: number;
        total_market_cap_yesterday_percentage_change?: number;
        total_volume_24h: number;
        total_volume_24h_yesterday?: number;
        total_volume_24h_yesterday_percentage_change?: number;
      };
    };
  };
};

type QuotesLatestResponse = {
  status: { error_code: number; error_message?: string };
  data: Record<string, {
    name: string;
    symbol: string;
    quote: { USD: { price: number; percent_change_24h: number } };
  }>;
};

async function fetchGlobalMetrics(): Promise<{
  totalMarketCap: number;
  marketCapChangePct: number;
  volume24h: number;
  volumeChangePct: number;
  btcDom: number;
  ethDom: number;
}> {
  const res = await fetch(`${CMC_BASE}/v1/global-metrics/quotes/latest`, {
    headers: {
      'X-CMC_PRO_API_KEY': CMC_API_KEY,
      'Accept': 'application/json'
    }
  });
  if (!res.ok) throw new Error(`CMC global metrics HTTP ${res.status}`);
  const json = await res.json() as GlobalMetricsResponse;
  if (json.status.error_code !== 0) throw new Error(json.status.error_message || 'CMC global metrics error');
  const usd = json.data.quote.USD;
  return {
    totalMarketCap: usd.total_market_cap,
    marketCapChangePct: (usd.total_market_cap_yesterday_percentage_change ?? 0) / 100,
    volume24h: usd.total_volume_24h,
    volumeChangePct: (usd.total_volume_24h_yesterday_percentage_change ?? 0) / 100,
    btcDom: json.data.btc_dominance,
    ethDom: json.data.eth_dominance
  };
}

async function fetchQuotes(symbols: string[]): Promise<Array<{ symbol: string; name: string; price: number; changePct: number }>> {
  const params = new URLSearchParams({ symbol: symbols.join(',') });
  const res = await fetch(`${CMC_BASE}/v1/cryptocurrency/quotes/latest?${params.toString()}`, {
    headers: {
      'X-CMC_PRO_API_KEY': CMC_API_KEY,
      'Accept': 'application/json'
    }
  });
  if (!res.ok) throw new Error(`CMC quotes HTTP ${res.status}`);
  const json = await res.json() as QuotesLatestResponse;
  if (json.status.error_code !== 0) throw new Error(json.status.error_message || 'CMC quotes error');
  return symbols.map((sym) => {
    const item = json.data[sym];
    const usd = item.quote.USD;
    return {
      symbol: sym,
      name: item.name,
      price: usd.price,
      changePct: (usd.percent_change_24h ?? 0) / 100
    };
  });
}

async function fetchFearGreed(): Promise<number> {
  // Try CMC public data-api first (undocumented, may change)
  try {
    const end = Math.floor(Date.now() / 1000);
    const start = end - 7 * 24 * 60 * 60;
    const url = `https://api.coinmarketcap.com/data-api/v3/fear-greed/chart?start=${start}&end=${end}`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (res.ok) {
      const j = await res.json() as any;
      const points: any[] = j?.data?.points || j?.data?.values || [];
      if (Array.isArray(points) && points.length) {
        const latest: any = points[points.length - 1];
        const v = Number(latest?.y ?? latest?.value ?? latest?.score);
        if (Number.isFinite(v)) return Math.round(v);
      }
    }
  } catch (_e) {
    // ignore and fallback
  }
  // Fallback: Alternative.me Fear & Greed (free, reliable)
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=1', { headers: { 'Accept': 'application/json' } });
    if (res.ok) {
      const j = await res.json() as any;
      const v = Number(j?.data?.[0]?.value);
      if (Number.isFinite(v)) return v;
    }
  } catch (_e) {
    // ignore
  }
  return 50; // neutral default
}

function computeAltSeason(btcDom: number, ethDom: number): number {
  const exBtcEthShare = Math.max(0, 100 - (btcDom + ethDom));
  const score = Math.max(0, Math.min(100, Math.round(exBtcEthShare * 2)));// 0..50% -> 0..100
  return score;
}

export async function fetchMarketData(): Promise<TMarket> {
  if (!CMC_API_KEY) {
    console.warn('CMC_API_KEY is not set. Requests to CoinMarketCap Pro API will fail.');
  }

  const [global, coins, fearGreed] = await Promise.all([
    fetchGlobalMetrics(),
    fetchQuotes(['BTC','ETH','BNB','XRP','SOL','TRX','DOGE','ADA']),
    fetchFearGreed()
  ]);

  const altSeason = computeAltSeason(global.btcDom, global.ethDom);
  const aiAnalysis = await tryFetchAiAnalysis({
    date: dayjs().format('MMMM D'),
    fearGreed,
    altSeason,
    totalMarketCap: global.totalMarketCap,
    marketCapChangePct: global.marketCapChangePct,
    volume24h: global.volume24h,
    volumeChangePct: global.volumeChangePct,
    btcDom: global.btcDom,
    ethDom: global.ethDom,
    coins
  });

  return {
    date: dayjs().format('MMMM D'),
    fearGreed,
    altSeason,
    totalMarketCap: global.totalMarketCap,
    marketCapChangePct: global.marketCapChangePct,
    volume24h: global.volume24h,
    volumeChangePct: global.volumeChangePct,
    btcDom: global.btcDom,
    btcDomChangePct: 0,
    ethDom: global.ethDom,
    ethDomChangePct: 0,
    coins,
    aiAnalysis: aiAnalysis ? formatAiAnalysisText(aiAnalysis) : undefined
  };
}

type AiInput = {
  date: string;
  fearGreed: number;
  altSeason: number;
  totalMarketCap: number;
  marketCapChangePct: number;
  volume24h: number;
  volumeChangePct: number;
  btcDom: number;
  ethDom: number;
  coins: Array<{ symbol: string; name: string; price: number; changePct: number }>;
};

function buildAiPromptText(input: AiInput): string {
  const lines: string[] = [];
  lines.push(`Fear Greed ${Math.round(input.fearGreed)} / 100,  Alt Season ${Math.round(input.altSeason)}/100`);
  const capT = `$${(input.totalMarketCap / 1e12).toFixed(2)}T`;
  const volB = `${(input.volume24h / 1e9).toFixed(1)}B+`;
  const mktPct = `${(input.marketCapChangePct * 100).toFixed(1)}%`;
  const volPct = `${(input.volumeChangePct * 100).toFixed(0)}%`;
  lines.push(`Total Market Cap ${capT} ${fmtSign(input.marketCapChangePct)}${mktPct}`);
  lines.push(`Market Volume 24h ${volB} ${fmtSign(input.volumeChangePct)}${volPct}`);
  input.coins.slice(0, 8).forEach(c => {
    lines.push(`${c.symbol}`);
    lines.push(`${c.name}`);
    lines.push(`$${formatPrice(c.price)} ${fmtSign(c.changePct)}${(c.changePct * 100).toFixed(2)}%`);
  });
  return lines.join('\n');
}

function fmtSign(n: number): string {
  if (n > 0) return '+';
  if (n < 0) return '';
  return '';
}

function formatPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

async function tryFetchAiAnalysis(input: AiInput): Promise<string | undefined> {
  try {
    const text = buildAiPromptText(input);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(AI_ANALYSIS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: text }),
      signal: controller.signal
    });
    clearTimeout(timer);
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok) {
      // Try to surface server-provided error text (useful for debugging)
      const errText = await safeReadText(res).catch(() => '');
      if (errText) console.error('[AI analysis] Body:', errText);
      if (errText && errText.trim().length > 0) return formatAiAnalysisText(errText.trim());
      return undefined;
    }
    if (contentType.includes('application/json')) {
      const json: any = await res.json().catch(() => ({}));
      try {  } catch (_e) { /* noop */ }
      const extracted = extractAnalysisText(json);
      if (typeof extracted === 'string' && extracted.trim().length > 0) {
        return formatAiAnalysisText(extracted.trim());
      }
      return JSON.stringify(json);
    }
    // Plain text or unknown content type
    const bodyText = await safeReadText(res).catch(() => '');
    if (bodyText) console.log('[AI analysis] Text:', bodyText);
    if (bodyText && bodyText.trim().length > 0) return formatAiAnalysisText(bodyText.trim());
    return undefined;
  } catch (_e) {
    // Avoid breaking the card rendering; just skip analysis on errors
    return undefined;
  }
}

function formatAiAnalysisText(raw: string): string {
  const normalized = raw
    .replace(/\u00A0/g, ' ') // NBSP -> space
    .replace(/\s+/g, ' ')
    .replace(/[;；]+\s*/g, '. ')
    .trim();
  const sentences = normalized.match(/[^.!?]+[.!?]?/g) || [];
  const lines = sentences
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      const firstIdx = s.search(/\S/);
      if (firstIdx >= 0) {
        s = s.slice(0, firstIdx) + s[firstIdx].toUpperCase() + s.slice(firstIdx + 1);
      }
      if (!/[.!?]$/.test(s)) s += '.';
      return s;
    });
  return lines.join('\n');
}

function extractAnalysisText(json: any): string | undefined {
  if (!json || typeof json !== 'object') return undefined;
  // Direct fields
  if (typeof json.analysis === 'string') return json.analysis;
  if (typeof json.summary === 'string') return json.summary;
  if (typeof json.text === 'string') return json.text;
  // Common wrapper: result may be array or JSON string with items containing { analysis }
  const result = (json as any).result;
  if (typeof result === 'string') {
    try {
      const parsed = JSON.parse(result);
      const fromParsed = extractAnalysisText({ result: parsed });
      if (fromParsed) return fromParsed;
    } catch (_e) {
      // Not JSON, fall through
    }
  }
  if (Array.isArray(result)) {
    const first = result[0];
    if (first && typeof first.analysis === 'string') return first.analysis;
    if (first && typeof first.summary === 'string') return first.summary;
    if (typeof result[0] === 'string') return result[0];
  }
  if (result && typeof result === 'object') {
    if (typeof result.analysis === 'string') return result.analysis;
    if (typeof result.summary === 'string') return result.summary;
  }
  if (Array.isArray(json.messages)) {
    const first = json.messages.find((m: any) => typeof m?.content === 'string');
    if (first) return first.content;
  }
  return undefined;
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch (_e) {
    return '';
  }
}
