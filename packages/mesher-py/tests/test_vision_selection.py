import unittest
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np

from mesher.vision import Vision


class FakeActor:
    def __init__(self):
        self.visible = True
        self.pickable = True

    def GetVisibility(self):
        return self.visible

    def SetVisibility(self, visible):
        self.visible = bool(visible)

    def SetPickable(self, pickable):
        self.pickable = bool(pickable)


class FakePicker:
    def __init__(self):
        self.actor = None
        self.position = (0.0, 0.0, 0.0)
        self.tolerance = None

    def SetTolerance(self, tolerance):
        self.tolerance = tolerance

    def Pick(self, *_args):
        return int(self.actor is not None)

    def GetActor(self):
        return self.actor

    def GetPickPosition(self):
        return self.position


class FakePlotter:
    def __init__(self):
        self.renderer = object()
        self.window_size = (1024, 768)
        self.callbacks = {}
        self.checkbox_callbacks = []
        self.visuals = {}
        self.render_count = 0

    def track_click_position(self, callback, *, double, **_kwargs):
        self.callbacks[double] = callback

    def add_mesh(self, mesh, **kwargs):
        self.visuals[kwargs["name"]] = (mesh, kwargs)

    def add_point_labels(self, points, labels, **kwargs):
        self.visuals[kwargs["name"]] = (points, labels, kwargs)

    def add_text(self, _text, **kwargs):
        actor = SimpleNamespace(prop=SimpleNamespace(bold=False))
        self.visuals[kwargs["name"]] = actor
        return actor

    def add_checkbox_button_widget(self, callback, **_kwargs):
        self.checkbox_callbacks.append(callback)

    def remove_actor(self, name, render=False):
        del render
        self.visuals.pop(name, None)

    def render(self):
        self.render_count += 1


class VisionSelectionTests(unittest.TestCase):
    def setUp(self):
        self.vision = Vision()
        self.vision.nodes = np.array(
            [
                [1.0, 2.0, 3.0],
                [5.0, 5.0, 5.0],
            ],
            dtype=np.float32,
        )
        self.component_1 = FakeActor()
        self.component_2 = FakeActor()
        self.actors = {1: self.component_1, 2: self.component_2}
        self.labels = {
            1: SimpleNamespace(prop=SimpleNamespace(bold=False)),
            2: SimpleNamespace(prop=SimpleNamespace(bold=False)),
        }
        self.component_nodes = {
            1: np.array([0], dtype=np.int32),
            2: np.array([1], dtype=np.int32),
        }
        self.plotter = FakePlotter()
        self.cell_picker = FakePicker()
        self.point_picker = FakePicker()

        patches = (
            patch("mesher.vision.vtkCellPicker", return_value=self.cell_picker),
            patch("mesher.vision.vtkPointPicker", return_value=self.point_picker),
        )
        self.patchers = patches
        for current_patch in self.patchers:
            current_patch.start()
            self.addCleanup(current_patch.stop)

        self.on_visibility_change = self.vision._add_selection_tool(
            self.plotter,
            self.actors,
            self.labels,
            self.component_nodes,
        )
        self.on_click = self.plotter.callbacks[False]

    def test_node_click_shows_coordinates_and_bolds_component(self):
        self.cell_picker.actor = self.component_1
        self.point_picker.actor = self.component_1
        self.point_picker.position = (1.0, 2.0, 3.0)

        self.on_click((100, 120))

        self.assertTrue(self.labels[1].prop.bold)
        self.assertFalse(self.labels[2].prop.bold)
        self.assertIn("selected_node_marker", self.plotter.visuals)
        label_visual = self.plotter.visuals["selected_node_label"]
        self.assertEqual(label_visual[1], ["X: 1\nY: 2\nZ: 3"])

    def test_element_face_click_selects_component_without_node_label(self):
        self.cell_picker.actor = self.component_2
        self.point_picker.actor = None

        self.on_click((100, 120))

        self.assertFalse(self.labels[1].prop.bold)
        self.assertTrue(self.labels[2].prop.bold)
        self.assertNotIn("selected_node_marker", self.plotter.visuals)
        self.assertNotIn("selected_node_label", self.plotter.visuals)

    def test_blank_click_clears_point_and_component_selection(self):
        self.cell_picker.actor = self.component_1
        self.point_picker.actor = self.component_1
        self.point_picker.position = (1.0, 2.0, 3.0)
        self.on_click((100, 120))

        self.cell_picker.actor = None
        self.on_click((10, 10))

        self.assertFalse(self.labels[1].prop.bold)
        self.assertFalse(self.labels[2].prop.bold)
        self.assertNotIn("selected_node_marker", self.plotter.visuals)
        self.assertNotIn("selected_node_label", self.plotter.visuals)

    def test_hiding_selected_component_clears_selection(self):
        self.cell_picker.actor = self.component_1
        self.point_picker.actor = self.component_1
        self.point_picker.position = (1.0, 2.0, 3.0)
        self.on_click((100, 120))

        self.on_visibility_change(1, False, render=False)

        self.assertFalse(self.labels[1].prop.bold)
        self.assertNotIn("selected_node_marker", self.plotter.visuals)
        self.assertNotIn("selected_node_label", self.plotter.visuals)

    def test_component_panel_returns_labels_and_disables_hidden_actor(self):
        plotter = FakePlotter()
        actor = FakeActor()
        visibility_changes = []

        labels = self.vision._add_component_panel(
            plotter,
            [{"id": 1, "name": "Body", "count": 2, "color": "#123456"}],
            {1: actor},
            element_count=2,
            node_count=8,
            on_visibility_change=lambda comp_id, visible, render: (
                visibility_changes.append((comp_id, visible, render))
            ),
        )
        plotter.checkbox_callbacks[0](False)

        self.assertIn(1, labels)
        self.assertFalse(actor.visible)
        self.assertFalse(actor.pickable)
        self.assertEqual(visibility_changes, [(1, False, False)])


if __name__ == "__main__":
    unittest.main()
