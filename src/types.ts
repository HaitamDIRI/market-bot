export type TMarket = {
  date: string;
  fearGreed: number;
  altSeason: number;
  totalMarketCap: number;
  marketCapChangePct: number;
  volume24h: number;
  volumeChangePct: number;
  btcDom: number;
  btcDomChangePct: number;
  ethDom: number;
  ethDomChangePct: number;
  coins: Array<{ symbol: string; name: string; price: number; changePct: number; }>;
  aiAnalysis?: string;
};
