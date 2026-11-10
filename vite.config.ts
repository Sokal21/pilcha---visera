import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// armero.html guarda el agarre de la pistola con un POST a /api/agarre: este plugin lo escribe en
// src/agarre.json (solo en el servidor de desarrollo).
function guardarAgarre(): Plugin {
  return {
    name: 'guardar-agarre',
    configureServer(server) {
      server.middlewares.use('/api/agarre', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let cuerpo = '';
        req.on('data', (parte) => (cuerpo += parte));
        req.on('end', () => {
          const agarre = JSON.parse(cuerpo);
          writeFileSync(resolve(import.meta.dirname, 'src/agarre.json'), JSON.stringify(agarre, null, 2) + '\n');
          res.setHeader('Content-Type', 'application/json');
          res.end('{"ok":true}');
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [guardarAgarre()],
  build: {
    rollupOptions: {
      input: {
        juego: resolve(import.meta.dirname, 'index.html'),
        armero: resolve(import.meta.dirname, 'armero.html'),
        fotogramas: resolve(import.meta.dirname, 'fotogramas.html'),
      },
    },
  },
});
