/**
 * Minimal dev server for the Quiz App.
 * All backend logic is now handled by Supabase (DB + Realtime).
 * This server is only responsible for serving the Vite frontend.
 */
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createServer } from 'http';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const httpServer = createServer(app);

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = process.env.PORT || 3000;
  httpServer.listen(PORT, () => {
    console.log(`🚀 Quiz App running at http://localhost:${PORT}`);
    console.log(`   Supabase URL: ${process.env.VITE_SUPABASE_URL || '(not set)'}`);
  });
}

startServer();
