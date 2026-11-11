# Pilcha & Visera

Un polígono de tiro para probar al protagonista: camina con WASD, con Shift saca la Glock y apunta
(cámara al hombro y mira), con click dispara a latas y blancos, con Shift la guarda. El panel cambia
la ropa por lugar (arriba, abajo, pies) y el reposo (el zombie del apestado de argentina-1810, el mismo con el cuello
suavizado, el orco y uno de piernas abiertas).

    pnpm install
    pnpm dev

## Cómo se hace el modelo

1. Hojas de vista (SpriteCook, `spritecook-assets.json`): el cuerpo en boxers y cada conjunto como
   edición de esa misma hoja, en la misma pose A (`assets/protagonista/concept/`).
2. Las zapatillas, aparte: una vista de tres cuartos de cada una (SpriteCook, con las fotos de
   `references/` como referencia, fuera de git) y Tripo image-to-model (`assets/zapatillas/`).
   Tripo multiview para el cuerpo y para cada conjunto vestido (`tools/tripo.py`; si la descarga se
   cuelga, `tools/tripo_bajar.sh TAREA.json`), y el rig v1.0 del cuerpo (`assets/protagonista/3d/tripo/`).
3. El clip: `tools/blender/retarget_rot.py` con `zombie idle.fbx` (Mixamo, fuera de git en
   `tools/mocap/`), `--name reposo --feet`, a `assets/protagonista/3d/anims/reposo.glb`; igual
   `Orc Idle.fbx` (`reposo_orco`), `Idle.fbx` (`reposo_abierto`), `Walking.fbx` (`caminata`,
   `--gait --feet`) y `Running.fbx` (`corrida`, `--gait --feet`); `Pistol Aim.fbx` (`pistola_guardar`: de apuntar a guardarla; al revés la saca),
   `Pistol Idle.fbx` (`pistola_reposo`) y `Pistol Walk.fbx` (`pistola_caminata`), todos `--twist 1`.
   La Glock (`assets/pistola/`, de CGTrader) va colgada de la mano derecha, que con ella se cierra en puño. `vestir.py` arma además
   `reposo_suave` (el zombie con el cuello a un tercio y la cabeza mirando igual).
4. `tools/blender/vestir.py` corta la ropa de los vestidos, la pega al esqueleto del cuerpo y parte el
   cuerpo según qué prenda tapa cada pedazo: `public/models/protagonista.glb`.
5. `tools/blender/conjuntos.py` saca fotos de cada combinación para revisarla (`docs/conjuntos.png`).

```
B=/Applications/Blender.app/Contents/MacOS/Blender
$B -b --python tools/blender/vestir.py -- public/models/protagonista.glb \
  assets/protagonista/3d/anims/reposo.glb \
  assets/protagonista/3d/tripo/tracksuit/0e09bfd9-fe70-43be-b098-a9b7af4c0dfc_model_url.glb \
  assets/protagonista/3d/tripo/newells/9eb964a7-ed00-4c47-9d81-4fe5bcd66453_model_url.glb \
  assets/protagonista/3d/anims/reposo_orco.glb assets/protagonista/3d/anims/reposo_abierto.glb \
  assets/protagonista/3d/anims/caminata.glb assets/protagonista/3d/anims/corrida.glb \
  assets/protagonista/3d/anims/pistola_apuntar.glb \
  assets/protagonista/3d/anims/pistola_reposo.glb assets/protagonista/3d/anims/pistola_caminata.glb \
  assets/protagonista/3d/anims/muerte.glb \
  --jordan assets/zapatillas/3d/tripo/jordan/b6f8bcf0-efdd-444b-b24b-067eb0b0eb2d_model_url.glb \
  --nike assets/zapatillas/3d/tripo/nike/dd3fb45f-70e3-4cf1-b3f4-f03268b3e4e2_model_url.glb \
  --pistola assets/pistola/glock19.fbx --pistola-textura assets/pistola/glock_color_1k.png
```

## Los policías (enemigos)

Policía federal (PFA): lámina de SpriteCook (`spritecook-assets.json`, `policia`), Tripo multiview y
rig v1.0 (`assets/policia/3d/`), los mismos clips del protagonista más `Pistol Walk Patrulla.fbx`
(`patrulla`, `--gait --feet --twist 1`) y `Dying.fbx` (`muerte`, `--ground`; también va al
protagonista). Como la ropa viene puesta, `vestir.py --solo 1` arma el cuerpo entero con dedos, pies,
clips de pistola girados y la Glock:

```
A=assets/policia/3d/anims
$B -b --python tools/blender/vestir.py -- public/models/policia.glb assets/policia/3d/rig.glb \
  $A/reposo.glb $A/reposo_orco.glb $A/reposo_abierto.glb $A/caminata.glb $A/corrida.glb \
  $A/pistola_guardar.glb $A/pistola_reposo.glb $A/pistola_caminata.glb $A/patrulla.glb $A/muerte.glb \
  --solo 1 --pistola assets/pistola/glock19.fbx --pistola-textura assets/pistola/glock_color_1k.png
```

En el juego (`src/enemigos.ts`) aparecen sin parar por los bordes de la zona, como mucho cinco a la
vez; persiguen, se paran a disparar cuando te tienen a tiro y mueren con un tiro a la cabeza o cuatro
al cuerpo.
