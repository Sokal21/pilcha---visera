"""Make some colours of a finished model's texture shine: those pixels repainted one colour and
given as the model's emissive texture, which the game lays on the figure as a light of its own
(three/figure.ts). For the plague-dead soldier's sores, in a sickly, half radioactive green.

    Blender -b --python scripts/blender/glow.py -- IN.glb OUT.glb --colors 193,207,108/151,160,98 [--to 160,255,60] [--near 12]

The last step after prepare_rigged.py (or prepare_model.py) and decimate.py; IN and OUT may be the
same file. --colors are the texture's colours that shine, as scripts/blender/flatten.py left them
(it prints its palette); a pixel within --near of one of them, on each channel, is taken.
"""
import sys

import bpy
import numpy as np

args = sys.argv[sys.argv.index('--') + 1:]
src, dst = args[0], args[1]
opts = dict(zip(args[2::2], args[3::2]))
SHINE = np.array([[int(c) for c in rgb.split(',')] for rgb in opts['--colors'].split('/')], dtype=np.float32) / 255
TO = np.array([int(c) for c in opts.get('--to', '160,255,60').split(',')], dtype=np.float32) / 255
NEAR = float(opts.get('--near', 12)) / 255

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

shone = 0
for material in bpy.data.materials:
    if not material.node_tree:
        continue
    nodes, links = material.node_tree.nodes, material.node_tree.links
    texture = next((n for n in nodes if n.type == 'TEX_IMAGE' and n.image), None)
    bsdf = next((n for n in nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if not texture or not bsdf:
        continue
    image = texture.image
    w, h = image.size
    px = np.array(image.pixels[:], dtype=np.float32).reshape(-1, 4)
    lit = (np.abs(px[:, None, :3] - SHINE[None]) <= NEAR).all(2).any(1)
    if not lit.any():
        continue
    shone += int(lit.sum())
    px[lit, :3] = TO
    image.pixels[:] = px.ravel()
    image.pack()
    # The emissive texture: the shining pixels in their colour, black elsewhere.
    mask = np.zeros_like(px)
    mask[:, 3] = 1
    mask[lit, :3] = TO
    glow = bpy.data.images.new(f'{image.name}_brillo', w, h)
    glow.pixels[:] = mask.ravel()
    glow.pack()
    node = nodes.new('ShaderNodeTexImage')
    node.image, node.interpolation = glow, 'Closest'
    uv = next((l.from_socket for l in links if l.to_socket == texture.inputs['Vector']), None)
    if uv:
        links.new(uv, node.inputs['Vector'])
    links.new(node.outputs['Color'], bsdf.inputs['Emission Color'])
    bsdf.inputs['Emission Strength'].default_value = 1

# Each clip exported as one of its own, as prepare_rigged.py and decimate.py export them.
armature = next((o for o in bpy.data.objects if o.type == 'ARMATURE'), None)
if armature is not None:
    for o in bpy.data.objects:
        if o is not armature:
            o.animation_data_clear()
    armature.animation_data_clear()
    armature.animation_data_create()
    for action in bpy.data.actions:
        action.use_fake_user = True
        track = armature.animation_data.nla_tracks.new()
        track.name = action.name
        track.strips.new(action.name, int(action.frame_range[0]), action)
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_yup=True,
                          export_animation_mode='NLA_TRACKS', export_apply=False)
print('WROTE', dst, f'{shone} pixels shine')
