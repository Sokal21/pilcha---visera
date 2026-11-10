"""What every model made ready for the game goes through: flat colours, nothing shiny."""
import bpy
import numpy as np


def flatten(colours: int, size: int) -> None:
    """Each texture to `size` pixels in `colours` colours (k-means over its own pixels), nearest
    filtered; every material rough and not metal, so the engine's light alone shades it."""
    for image in list(bpy.data.images):
        if image.size[0] == 0:
            continue
        image.scale(size, size)
        px = np.array(image.pixels[:], dtype=np.float32).reshape(-1, 4)
        rgb = px[:, :3]
        centres = rgb[np.random.default_rng(1).choice(len(rgb), colours, replace=False)]
        for _ in range(20):
            nearest = ((rgb[:, None, :] - centres[None]) ** 2).sum(2).argmin(1)
            for k in range(colours):
                mine = rgb[nearest == k]
                if len(mine):
                    centres[k] = mine.mean(0)
        px[:, :3] = centres[nearest]
        image.pixels[:] = px.ravel()
        image.pack()
        print('PALETTE', image.name, [tuple(int(c * 255) for c in centre) for centre in centres])
    for material in bpy.data.materials:
        if not material.node_tree:
            continue
        for node in material.node_tree.nodes:
            if node.type == 'TEX_IMAGE':
                node.interpolation = 'Closest'
            if node.type == 'BSDF_PRINCIPLED':
                node.inputs['Metallic'].default_value = 0
                node.inputs['Roughness'].default_value = 1
