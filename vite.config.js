import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const PROXY_TIMEOUT_MS = 25_000;

function localCorsProxy() {
  return {
    name: 'local-cors-proxy',
    configureServer(server) {
      server.middlewares.use('/cors-proxy', async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Accept, Accept-Language, Content-Type, X-Requested-With');

        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }

        if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }

        try {
          const requestUrl = new URL(req.originalUrl || req.url || '', 'http://localhost');
          const target = requestUrl.searchParams.get('url');
          const referer = requestUrl.searchParams.get('referer');

          if (!target) {
            res.statusCode = 400;
            res.end('Missing url parameter');
            return;
          }

          const targetUrl = new URL(target);
          if (!['http:', 'https:'].includes(targetUrl.protocol)) {
            res.statusCode = 400;
            res.end('Only http and https URLs are supported');
            return;
          }

          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
          const upstreamHeaders = {
            Accept: req.headers.accept || 'text/html,application/xhtml+xml,application/json,*/*',
            Referer: referer || `${targetUrl.origin}/`,
            'User-Agent': DESKTOP_USER_AGENT,
          };

          if (req.headers['accept-language']) {
            upstreamHeaders['Accept-Language'] = Array.isArray(req.headers['accept-language'])
              ? req.headers['accept-language'][0]
              : req.headers['accept-language'];
          }
          if (req.headers['x-requested-with']) {
            upstreamHeaders['X-Requested-With'] = Array.isArray(req.headers['x-requested-with'])
              ? req.headers['x-requested-with'][0]
              : req.headers['x-requested-with'];
          }

          const upstream = await fetch(targetUrl, {
            method: req.method,
            redirect: 'follow',
            headers: upstreamHeaders,
            signal: controller.signal,
          }).finally(() => clearTimeout(timer));

          res.statusCode = upstream.status;
          const contentType = upstream.headers.get('content-type');
          if (contentType) res.setHeader('Content-Type', contentType);
          res.setHeader('Cache-Control', 'no-store');

          if (req.method === 'HEAD') {
            res.end();
            return;
          }

          const body = Buffer.from(await upstream.arrayBuffer());
          res.end(body);
        } catch (error) {
          res.statusCode = 502;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(`Proxy error: ${error.message}`);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localCorsProxy()],
  // Não recarregar o Vite ao compilar o Rust; porta fixa quando o Tauri
  // estiver dirigindo o dev-server (ver desktop/src-tauri/tauri.conf.json).
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: Boolean(process.env.TAURI_ENV_PLATFORM),
    host: process.env.TAURI_DEV_HOST || false,
    watch: {
      ignored: ['**/src-tauri/**', '**/desktop/**'],
    },
    proxy: {
      '/mdx-api': {
        target: 'https://api.mangadex.org',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/mdx-api/, ''),
      },
    },
  },
});
