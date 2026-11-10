import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// armero.html guarda lo que se acomoda a mano con un POST a /api/guardar/<nombre>: este plugin lo
// escribe en src/<nombre>.json (solo en el servidor de desarrollo, solo los nombres de GUARDABLES).
const GUARDABLES = ['agarre', 'huesos'];

function guardarAjustes(): Plugin {
  return {
    name: 'guardar-ajustes',
    // Lo que guarda el armero no recarga la página: se perdía lo que no estaba guardado todavía.
    // El juego lo toma al recargarlo a mano.
    handleHotUpdate({ file }) {
      if (GUARDABLES.some((n) => file.endsWith(`/src/${n}.json`))) return [];
    },
    configureServer(server) {
      server.middlewares.use('/api/guardar', (req, res) => {
        const nombre = (req.url ?? '').replace(/^\//, '');
        if (req.method !== 'POST' || !GUARDABLES.includes(nombre)) {
          res.statusCode = req.method !== 'POST' ? 405 : 404;
          res.end();
          return;
        }
        let cuerpo = '';
        req.on('data', (parte) => (cuerpo += parte));
        req.on('end', () => {
          const datos = JSON.parse(cuerpo);
          writeFileSync(resolve(import.meta.dirname, `src/${nombre}.json`), JSON.stringify(datos, null, 2) + '\n');
          res.setHeader('Content-Type', 'application/json');
          res.end('{"ok":true}');
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [guardarAjustes()],
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
