# https://pyvista.org/projects/index.html

import numpy as np
import pyvista as pv
import matplotlib.pyplot as plt
from matplotlib.colors import to_hex
import random

random.seed(1)

class Vision:
    def __init__(self):
        ### 3D elements
        self.comps = {}
        self.component_names = {}
        self.elements = np.empty((0, 8), dtype=np.int32)
        self.element_comps = np.empty((0), dtype=np.int32)
        self.nodes = np.empty((0, 3), dtype=np.float32)
    
    def set(self, comps, elements, element_comps, nodes, component_names=None):
        self.elements = elements
        self.element_comps = element_comps
        self.nodes = nodes
        self.comps = comps
        self.component_names = component_names or {}

    def _build_grid(self):
        ### Build the cell
        n = self.elements.shape[0]
        cells = np.hstack([np.column_stack([np.full((n,1), 8, dtype=self.elements.dtype), self.elements]).ravel()])

        ### Cell types
        celltypes = np.full(n, pv.CellType.HEXAHEDRON, dtype=np.uint8)

        ### Create grid
        grid = pv.UnstructuredGrid(cells, celltypes, self.nodes)

        ### Attach component ids as cell data for coloring
        grid.cell_data['comp'] = self.element_comps.astype(np.int32)
        return grid

    def _to_int(self, value):
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    def _update_component_name_map(self, comp_names, mapping, overwrite=False):
        if mapping is None:
            return

        if isinstance(mapping, (list, tuple)):
            mapping = dict(enumerate(mapping))

        for key, value in mapping.items():
            key_id = self._to_int(key)
            value_id = self._to_int(value)

            if key_id is not None and value_id is None:
                comp_id = key_id
                name = str(value)
            elif value_id is not None:
                comp_id = value_id
                name = str(key)
            elif key in self.comps and self._to_int(self.comps[key]) is not None:
                comp_id = int(self.comps[key])
                name = str(value)
            else:
                continue

            if overwrite or comp_id not in comp_names:
                comp_names[comp_id] = name

    def _component_name_map(self, component_names=None):
        comp_names = {}
        self._update_component_name_map(comp_names, self.comps)
        self._update_component_name_map(comp_names, self.component_names, overwrite=True)
        self._update_component_name_map(comp_names, component_names, overwrite=True)
        return comp_names

    def _component_rows(self, comp, isRandomColor, component_names=None):
        vals, counts = np.unique(comp, return_counts=True)
        comp_names = self._component_name_map(component_names)

        base = plt.get_cmap('viridis', max(len(vals), 1))
        palette = [to_hex(base(i)) for i in np.linspace(0, 1, max(len(vals), 1))]
        if isRandomColor:
            random.shuffle(palette)

        rows = []
        for index, (comp_id, count) in enumerate(zip(vals, counts)):
            comp_id = int(comp_id)
            name = comp_names.get(comp_id, f"comp {comp_id}")
            rows.append({
                "id": comp_id,
                "name": name,
                "count": int(count),
                "color": palette[index],
            })
        return rows

    def _add_component_panel(self, plotter, rows, actors):
        if not rows:
            return

        x0 = 12
        y0 = 12
        button_size = 22
        row_gap = 30
        text_x = x0 + button_size + 10
        title_y = y0 + row_gap * len(rows) + 8

        plotter.add_text(
            "Components",
            position=(x0, title_y),
            font_size=11,
            color="black",
            name="component_panel_title",
            render=False,
        )

        for index, row in enumerate(rows):
            y = y0 + row_gap * (len(rows) - index - 1)
            label = f"{row['name']} ({row['id']}): {row['count']} elems"
            actor = actors[row["id"]]

            def toggle_component(is_visible, actor=actor):
                actor.SetVisibility(is_visible)
                plotter.render()

            plotter.add_checkbox_button_widget(
                toggle_component,
                value=True,
                position=(x0, y),
                size=button_size,
                border_size=2,
                color_on=row["color"],
                color_off="lightgrey",
                background_color="white",
            )
            plotter.add_text(
                label,
                position=(text_x, y + 3),
                font_size=9,
                color=row["color"],
                name=f"component_panel_label_{row['id']}",
                render=False,
            )

    def show(self, isRandomColor=False, component_names=None):
        grid = self._build_grid()

        ### colors
        if 'comp' in grid.point_data and 'comp' not in grid.cell_data:
            grid = grid.point_data_to_cell_data(pass_point_data=False)
        comp = grid.cell_data['comp'].astype(int)
        rows = self._component_rows(comp, isRandomColor, component_names)
        
        ### Plot
        plotter = pv.Plotter()
        actors = {}
        for row in rows:
            component_grid = grid.extract_cells(np.where(comp == row["id"])[0])
            actors[row["id"]] = plotter.add_mesh(
                component_grid,
                color=row["color"],
                show_edges=True,
                smooth_shading=False,
                show_scalar_bar=False,
                name=f"component_{row['id']}",
            )
        
        legend = [[f"{row['name']} ({row['id']}): {row['count']} elems", row["color"]] for row in rows]
        legend = [[f"Node Num: {len(self.nodes)}", "black"]] + legend
        legend = [[f"Elem Num: {len(self.elements)}", "black"]] + legend
        
        plotter.add_legend(legend, loc='upper left', bcolor='white', border=True) 
        self._add_component_panel(plotter, rows, actors)
        plotter.add_axes()
        plotter.show()
