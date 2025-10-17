import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import ejs from 'ejs';
import { Telegraf } from 'telegraf';
import { fetchMarketData } from './fetchData';
import { renderMarketPngFromUrl } from './shot';

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const PORT = Number(process.env.PORT) || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

const app = express();

// static assets (icons, logos, css)
app.use('/assets', express.static(path.resolve(process.cwd(), 'public', 'assets')));

// health
app.get('/health', (_req, res) => res.send('OK'));

// card route renders EJS -> HTML (used by preview & puppeteer)
app.get('/card', async (_req, res) => {
  try {
    const data = await fetchMarketData();
    const tpl = await fs.readFile(path.resolve(process.cwd(), 'templates', 'market.ejs'), 'utf8');
    const html = ejs.render(tpl, { data, assets: '/assets' });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    console.error(e);
    res.status(500).send('Card render error');
  }
});

// human preview
app.get('/preview', async (_req, res) => {
  res.redirect('/card');
});

// PNG preview
app.get('/preview.png', async (_req, res) => {
  try {
    const png = await renderMarketPngFromUrl(`${BASE_URL}/card`);
    res.setHeader('Content-Type', 'image/png');
    res.send(png);
  } catch (e) {
    console.error(e);
    res.status(500).send('PNG render error');
  }
});

// Telegram bot
let bot: Telegraf | null = null;
if (BOT_TOKEN) {
  bot = new Telegraf(BOT_TOKEN);
  bot.start((ctx) => ctx.reply('Hello! Send /market to get the card.'));
  bot.command('market', async (ctx) => {
    try {
      await ctx.replyWithChatAction('upload_photo');
      const png = await renderMarketPngFromUrl(`${BASE_URL}/card`);
      await ctx.replyWithPhoto({ source: Buffer.from(png) }, { caption: 'Market Overview • Spectre AI' });
    } catch (err) {
      console.error(err);
      await ctx.reply('⚠️ Error rendering card.');
    }
  });
  // Ensure polling mode receives updates even if a webhook was previously set
  (async () => {
    try {
      await bot!.telegram.deleteWebhook({ drop_pending_updates: true });
      await bot!.launch({ dropPendingUpdates: true });
      console.log('🤖 Bot started (long polling). Webhook cleared, listening for /market');
    } catch (e) {
      console.error('Failed to launch bot:', e);
    }
  })();
  process.once('SIGINT', () => bot?.stop('SIGINT'));
  process.once('SIGTERM', () => bot?.stop('SIGTERM'));
} else {
  console.warn('BOT_TOKEN not set — bot disabled, only preview server is available.');
}

app.listen(PORT, () => {
  console.log(`HTTP on :${PORT}  •  Preview: ${BASE_URL}/preview`);
});
