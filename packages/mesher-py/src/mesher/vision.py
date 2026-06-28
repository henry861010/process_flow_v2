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
            name = comp_names.get(comp_id, f"Component {index + 1}")
            rows.append({
                "id": comp_id,
                "name": name,
                "count": int(count),
                "color": palette[index],
            })
        return rows

    def _add_component_panel(
        self,
        plotter,
        rows,
        actors,
        element_count,
        node_count,
        on_visibility_change=None,
    ):
        x0 = 12
        top_y = plotter.window_size[1] - 28
        button_size = 22
        row_gap = 30
        text_gap = 18
        text_x = x0 + button_size + 10

        plotter.add_text(
            f"Elements: {element_count}",
            position=(x0, top_y),
            font_size=9,
            color="black",
            name="mesh_element_count",
            render=False,
        )
        plotter.add_text(
            f"Nodes: {node_count}",
            position=(x0, top_y - text_gap),
            font_size=9,
            color="black",
            name="mesh_node_count",
            render=False,
        )

        if not rows:
            return

        plotter.add_text(
            "Components",
            position=(x0, top_y - text_gap * 3),
            font_size=11,
            color="black",
            name="component_panel_title",
            render=False,
        )

        for index, row in enumerate(rows):
            y = top_y - text_gap * 4 - button_size - row_gap * index
            label = f"{row['name']}: {row['count']} elems"
            actor = actors[row["id"]]

            def toggle_component(is_visible, actor=actor):
                is_visible = bool(is_visible)
                actor.SetVisibility(is_visible)
                actor.SetPickable(is_visible)
                if on_visibility_change is not None:
                    on_visibility_change(render=False)
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

    def _visible_node_ids(self, actors, component_node_indices):
        visible_node_ids = [
            component_node_indices[comp_id]
            for comp_id, actor in actors.items()
            if actor.GetVisibility()
        ]
        if not visible_node_ids:
            return np.empty((0,), dtype=np.int32)
        return np.unique(np.concatenate(visible_node_ids)).astype(np.int32)

    def _nearest_visible_node(self, point, actors, component_node_indices):
        point = np.asarray(point, dtype=float)
        if point.shape != (3,) or not np.all(np.isfinite(point)):
            return None

        node_ids = self._visible_node_ids(actors, component_node_indices)
        if node_ids.size == 0:
            return None

        node_points = self.nodes[node_ids]
        nearest_index = int(np.argmin(np.sum((node_points - point) ** 2, axis=1)))
        node_id = int(node_ids[nearest_index])
        return {
            "id": node_id,
            "point": self.nodes[node_id].astype(float),
        }

    def _remove_actor(self, plotter, name, render=False):
        try:
            plotter.remove_actor(name, render=render)
        except TypeError:
            plotter.remove_actor(name)

    def _add_distance_measure_tool(self, plotter, actors, component_node_indices):
        picked_nodes = []
        actor_names = (
            "distance_measure_point_0",
            "distance_measure_point_1",
            "distance_measure_line",
            "distance_measure_label",
        )

        def clear_measurement(render=True):
            picked_nodes.clear()
            for name in actor_names:
                self._remove_actor(plotter, name, render=False)
            if render:
                plotter.render()

        def add_point_marker(node, index):
            colors = ("red", "blue")
            point_mesh = pv.PolyData(np.asarray([node["point"]]))
            plotter.add_mesh(
                point_mesh,
                color=colors[index],
                point_size=14,
                render_points_as_spheres=True,
                name=f"distance_measure_point_{index}",
                render=False,
            )

        def add_distance_annotation():
            start = picked_nodes[0]["point"]
            end = picked_nodes[1]["point"]
            delta = np.abs(end - start)
            distance = float(np.linalg.norm(end - start))
            midpoint = (start + end) / 2.0
            label = (
                f"X: {delta[0]:.6g}\n"
                f"Y: {delta[1]:.6g}\n"
                f"Z: {delta[2]:.6g}\n"
                f"Total: {distance:.6g}"
            )

            plotter.add_mesh(
                pv.Line(start, end),
                color="black",
                line_width=4,
                name="distance_measure_line",
                render=False,
            )
            plotter.add_point_labels(
                np.asarray([midpoint]),
                [label],
                font_size=12,
                text_color="black",
                shape_color="white",
                shape_opacity=0.75,
                show_points=False,
                always_visible=True,
                name="distance_measure_label",
                render=False,
            )

        def on_pick(point, picker=None):
            node = self._nearest_visible_node(point, actors, component_node_indices)
            if node is None:
                return

            if len(picked_nodes) >= 2:
                clear_measurement(render=False)

            picked_nodes.append(node)
            add_point_marker(node, len(picked_nodes) - 1)

            if len(picked_nodes) == 2:
                add_distance_annotation()

            plotter.render()

        picking_options = {
            "callback": on_pick,
            "tolerance": 0.03,
            "left_clicking": True,
            "picker": "point",
            "show_message": "Distance: left-click two visible nodes; press C to clear",
            "font_size": 10,
            "show_point": False,
            "use_picker": True,
            "pickable_window": False,
            "clear_on_no_selection": False,
        }
        optional_keys = (
            "clear_on_no_selection",
            "use_picker",
            "pickable_window",
            "picker",
            "left_clicking",
        )
        for key_count in range(len(optional_keys) + 1):
            current_options = picking_options.copy()
            for key in optional_keys[:key_count]:
                current_options.pop(key, None)
            try:
                plotter.enable_point_picking(**current_options)
                break
            except TypeError:
                if key_count == len(optional_keys):
                    raise

        plotter.add_key_event("c", clear_measurement)
        return clear_measurement

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
        component_node_indices = {}
        for row in rows:
            cell_indices = np.where(comp == row["id"])[0]
            component_grid = grid.extract_cells(cell_indices)
            component_node_indices[row["id"]] = np.unique(
                self.elements[cell_indices].ravel()
            ).astype(np.int32)
            actors[row["id"]] = plotter.add_mesh(
                component_grid,
                color=row["color"],
                show_edges=True,
                smooth_shading=False,
                show_scalar_bar=False,
                pickable=True,
                name=f"component_{row['id']}",
            )
        
        clear_measurement = self._add_distance_measure_tool(
            plotter,
            actors,
            component_node_indices,
        )
        self._add_component_panel(
            plotter,
            rows,
            actors,
            len(self.elements),
            len(self.nodes),
            on_visibility_change=clear_measurement,
        )
        plotter.add_axes()
        plotter.show()
