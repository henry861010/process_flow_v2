"""Package conversion acceptance tests using real compiler and kernel execution."""
from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from flow_requests import flow_create_payload, selected_values
from process_flow_api.main import create_app
from process_flow_geometry_generators.support import PanelCarrierGenerator
from process_flow_kernel import ProcessGeometryState


def recipe(parameters):
    return {
        "selectedRecipeId": "adopted",
        "recipeCandidates": [
            {"recipeId": "adopted", "name": "Production", "parameterValues": parameters},
            {"recipeId": "untouched", "name": "Alternative", "parameterValues": copy.deepcopy(parameters)},
        ],
    }


def step_edge(source, target):
    return {
        "edgeId": f"{source}-{target}",
        "source": {"kind": "stepOutput", "stepRefId": source, "outputPortId": "result_geometry"},
        "target": {"stepRefId": target, "inputPortId": "main_geometry"},
    }


def package_profile():
    return {
        "schemaVersion": 1, "id": "representative-package", "version": "1",
        "fields": [
            {"id": "mold-material", "object": "cow.mold", "property": "material", "stage": "deposited",
             "path": "/package/molding/material", "kind": "material"},
            {"id": "final-mold-thickness", "object": "cow.mold", "property": "thickness", "stage": "finished",
             "path": "/package/molding/thickness/value", "kind": "length", "unitPath": "/package/molding/thickness/unit"},
            {"id": "c4-density", "object": "cow.c4", "property": "density", "stage": "formed",
             "path": "/package/c4/density", "kind": "density", "unit": "fraction"},
        ],
        "rules": [
            {"id": "set-mold-material", "type": "parameter", "fact": "mold-material",
             "role": "cow.mold.deposit", "parameter": "material",
             "verify": {"kind": "body", "property": "material", "terminal": True}},
            {"id": "finish-mold", "type": "molding_final_thickness", "fact": "final-mold-thickness",
             "moldingRole": "cow.mold.deposit", "grindingRole": "cow.mold.finish", "terminal": True},
            {"id": "set-c4-density", "type": "parameter", "fact": "c4-density",
             "role": "cow.c4.form", "parameter": "density",
             "verify": {"kind": "bump", "property": "density", "terminal": True}},
        ],
        "materialMap": {"company-epoxy": "EMC-G700"},
        "lengthTolerance": 1e-5,
    }


class PackageConversionTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app(db_path=":memory:", analytics_db_path=":memory:")
        self.context = TestClient(self.app)
        self.client = self.context.__enter__()
        state = ProcessGeometryState.create()
        state.initialize_box_layer(
            material="Si", key="carrier", bottom_left=[0, 0, 0], top_right=[100, 100, 0], thickness=200,
        )
        self.geometry = {
            "id": "package-conversion-carrier", "name": "Conversion carrier", "entityType": "panel",
            "category": "carrier.panel", "owner": "integration", "dim": "100 x 100 x 200 um",
            "structureFormat": "standard", "structure": state.to_geometry_structure(),
        }
        self.app.state.store.insert_geometry(self.geometry)
        self.base, self.bindings = self.make_flow()
        self.source = {"package": {"molding": {"material": "company-epoxy",
                       "thickness": {"value": .6, "unit": "mm"}}, "c4": {"density": .58}}}
        self.profile = package_profile()

    def tearDown(self):
        self.context.__exit__(None, None, None)
        self.app.state.store.close()

    def make_flow(self, variant=False, *, generator=False, downstream_grind=False):
        mold, grind, bump = ("product_mold", "product_finish", "product_c4") if variant else ("mold", "grind", "c4")
        steps = [
            (mold, "step_tpl_molding", {"material": "EMC-BASE", "thickness": 800}),
            (grind, "step_tpl_grinding", {"thk": 100}),
            (bump, "step_tpl_c4_bump_formation", {"material": "SAC305", "thk": 30, "density": 20, "koz": 0}),
        ]
        if variant:
            steps[:0] = [
                ("other_bump", "step_tpl_c4_bump_formation", {"material": "SAC305", "thk": 10, "density": 12, "koz": 0}),
                ("other_mold", "step_tpl_molding", {"material": "EMC-G700", "thickness": 100}),
                ("other_grind", "step_tpl_grinding", {"thk": 50}),
            ]
        if downstream_grind:
            steps.append(("later_grind", "step_tpl_grinding", {"thk": 100}))
        edges = [{"edgeId": "incoming-first", "source": {"kind": "flowInput", "flowInputId": "incoming"},
                  "target": {"stepRefId": steps[0][0], "inputPortId": "main_geometry"}}]
        edges.extend(step_edge(left[0], right[0]) for left, right in zip(steps, steps[1:]))
        binding = {"kind": "catalog", "geometryId": self.geometry["id"]}
        if generator:
            binding = {"kind": "generator", "generatorId": "panel-carrier", "generatorVersion": 1,
                       "parameters": {"packageX": 100, "packageY": 100, "carrierThickness": 150, "carrierMaterial": "Si"}}
        payload = {
            "schemaVersion": 3, "name": "Variant base" if variant else "Generator base" if generator else "Later grinding base" if downstream_grind else "Conversion base",
            "version": "V1", "owner": "integration", "description": "Baseline recipe is retained unless mapped.",
            "definition": {
                "flowInputs": [{"flowInputId": "incoming", "name": "Incoming", "dataType": "geometry", "required": True}],
                # Reverse storage order to ensure conversion follows graph dependencies.
                "stepRefs": [{"stepRefId": ref, "stepLabel": "Repeated station", "processStepTemplateId": template}
                             for ref, template, _ in (reversed(steps) if variant else steps)],
                "flowEdges": edges,
            },
            "configuration": {"inputBindings": {"incoming": binding},
                              "stepConfigurations": {ref: recipe(values) for ref, _, values in steps}},
        }
        response = self.client.post("/api/process-flows", json=payload)
        self.assertEqual(response.status_code, 201, response.text)
        return response.json(), {"roles": {"cow.mold.deposit": mold, "cow.mold.finish": grind, "cow.c4.form": bump}, "inputs": {}}

    def request(self, *, base=None, bindings=None):
        base = base or self.base
        return {"source": copy.deepcopy(self.source), "baseFlowId": base["id"], "baseRevision": base["revision"],
                "metadata": {"name": "Converted package", "version": "V1", "owner": "package-team", "description": "From source package"},
                "profile": copy.deepcopy(self.profile), "bindings": copy.deepcopy(bindings or self.bindings)}

    def snapshot(self):
        return self.client.get("/api/bootstrap").json()

    def base_with_parameter_definition(self, ref, parameter, **changes):
        base = flow_create_payload(self.base)
        step_ref = next(step for step in base["definition"]["stepRefs"] if step["stepRefId"] == ref)
        template = self.client.get(f"/api/process-step-templates/{step_ref['processStepTemplateId']}").json()
        template["id"] = f"conversion-clone-{ref}"
        template["name"] = f"Conversion clone {ref}"
        next(item for item in template["parameterDefinitions"] if item["id"] == parameter).update(changes)
        response = self.client.post("/api/process-step-templates", json=template)
        self.assertEqual(response.status_code, 201, response.text)
        base["name"] = f"Base with cloned {ref} definition"
        step_ref["processStepTemplateId"] = template["id"]
        response = self.client.post("/api/process-flows", json=base)
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def assert_failure_without_writes(self, payload, *, message=None):
        before = self.snapshot()
        response = self.client.post("/api/package-conversions/import", json=payload)
        self.assertEqual(response.status_code, 400, response.text)
        self.assertEqual(response.json()["report"]["status"], "failed")
        self.assertTrue(response.json()["report"]["errors"])
        if message:
            self.assertIn(message, json.dumps(response.json()))
        self.assertEqual(self.snapshot(), before)
        return response.json()

    def test_preview_normalizes_source_and_derives_removal_without_writing(self):
        before = self.snapshot()
        response = self.client.post("/api/package-conversions/preview", json=self.request())
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        flow, report = result["flow"], result["report"]
        self.assertNotIn("id", flow)
        self.assertNotIn("revision", flow)
        self.assertEqual(flow["origin"], {"flowId": self.base["id"], "revision": self.base["revision"]})
        self.assertEqual(flow["definition"], self.base["definition"])
        self.assertEqual(selected_values(flow, "mold"), {"material": "EMC-G700", "thickness": 800})
        self.assertAlmostEqual(selected_values(flow, "grind")["thk"], 200)
        self.assertAlmostEqual(selected_values(flow, "c4")["density"], 58)
        self.assertEqual(report["status"], "validated")
        self.assertEqual(len(report["facts"]), 3)
        self.assertEqual(report["baseFlow"]["id"], self.base["id"])
        self.assertEqual(report["baseFlow"]["revision"], self.base["revision"])
        self.assertTrue(report["sourceSha256"])
        self.assertTrue(report["profile"]["sha256"])
        self.assertTrue(report["assumptions"])
        self.assertTrue(report["checks"])
        self.assertTrue(all(check["passed"] for check in report["checks"]))
        change = next(change for change in report["changes"] if change["ruleId"] == "finish-mold")
        self.assertEqual(change["origin"], "derived")
        self.assertEqual(change["baselineValue"], 100)
        self.assertAlmostEqual(change["value"], 200)
        self.assertEqual(change["sourcePath"], "/package/molding/thickness/value")
        self.assertTrue(change["formula"])
        self.assertTrue(change["inputs"])
        for ref, config in flow["configuration"]["stepConfigurations"].items():
            self.assertEqual(config["selectedRecipeId"], "adopted")
            self.assertEqual(config["recipeCandidates"][1], self.base["configuration"]["stepConfigurations"][ref]["recipeCandidates"][1])
        self.assertEqual(self.snapshot(), before)

    def test_import_creates_executable_copy_and_preserves_base_and_catalog(self):
        before = self.snapshot()
        preview = self.client.post("/api/package-conversions/preview", json=self.request())
        self.assertEqual(preview.status_code, 200, preview.text)
        response = self.client.post("/api/package-conversions/import", json=self.request())
        self.assertEqual(response.status_code, 201, response.text)
        result = response.json()
        flow = result["flow"]
        self.assertNotEqual(flow["id"], self.base["id"])
        self.assertEqual(flow["revision"], 1)
        self.assertEqual(flow_create_payload(flow), preview.json()["flow"])
        self.assertEqual(result["report"]["status"], "imported")
        self.assertEqual(result["report"]["importedFlow"], {"id": flow["id"], "revision": 1})
        executed = self.client.post(f"/api/process-flows/{flow['id']}/execute")
        self.assertEqual(executed.status_code, 200, executed.text)
        final = ProcessGeometryState.from_structure(executed.json()["stepOutputs"]["c4"])
        mold = final.find_geometry(kind="body", key="molding")
        self.assertEqual(len(mold), 1)
        self.assertAlmostEqual(mold[0]["zMin"], 200)
        self.assertAlmostEqual(mold[0]["zMax"], 800)
        self.assertEqual(len(final.find_geometry(kind="bump")), 1)
        self.assertAlmostEqual(executed.json()["stepOutputs"]["c4"]["root"]["bumps"][0]["density"], 58)
        after = self.snapshot()
        self.assertEqual(after["geometries"], before["geometries"])
        self.assertEqual(after["processStepTemplates"], before["processStepTemplates"])
        self.assertEqual(self.client.get(f"/api/process-flows/{self.base['id']}").json(), self.base)
        self.assertEqual(len(after["processFlows"]), len(before["processFlows"]) + 1)

    def test_common_profile_handles_reordered_flow_and_repeated_stations(self):
        variant, bindings = self.make_flow(variant=True)
        response = self.client.post("/api/package-conversions/import", json=self.request(base=variant, bindings=bindings))
        self.assertEqual(response.status_code, 201, response.text)
        flow = response.json()["flow"]
        self.assertAlmostEqual(selected_values(flow, "product_finish")["thk"], 200)
        self.assertAlmostEqual(selected_values(flow, "product_c4")["density"], 58)
        for ref in ("other_mold", "other_grind", "other_bump"):
            self.assertEqual(flow["configuration"]["stepConfigurations"][ref], variant["configuration"]["stepConfigurations"][ref])
        executed = self.client.post(f"/api/process-flows/{flow['id']}/execute")
        self.assertEqual(executed.status_code, 200, executed.text)
        state = ProcessGeometryState.from_structure(executed.json()["stepOutputs"]["product_finish"])
        molds = state.find_geometry(kind="body", key="molding")
        self.assertEqual(sorted(round(mold["zMax"] - mold["zMin"], 5) for mold in molds), [50, 600])

    def test_unknown_source_unit_and_unmapped_material_identify_source_field(self):
        payload = self.request()
        payload["source"]["package"]["molding"]["thickness"]["unit"] = "mil"
        self.assert_failure_without_writes(payload, message="/package/molding/thickness")
        payload = self.request()
        payload["source"]["package"]["molding"]["material"] = "unmapped-epoxy"
        self.assert_failure_without_writes(payload, message="/package/molding/material")

    def test_missing_source_path_and_invalid_density_fail_without_import(self):
        for value in (-.01, 1.01, True):
            payload = self.request()
            payload["source"]["package"]["c4"]["density"] = value
            self.assert_failure_without_writes(payload, message="/package/c4/density")
        payload = self.request()
        del payload["source"]["package"]["molding"]["thickness"]["value"]
        self.assert_failure_without_writes(payload, message="/package/molding/thickness/value")

    def test_missing_wrong_or_reversed_role_bindings_are_rejected(self):
        for binding in (None, "does-not-exist", "c4", "mold"):
            payload = self.request()
            if binding is None:
                del payload["bindings"]["roles"]["cow.mold.finish"]
            else:
                payload["bindings"]["roles"]["cow.mold.finish"] = binding
            self.assert_failure_without_writes(payload)
        payload = self.request()
        payload["bindings"]["roles"]["cow.mold.deposit"] = "c4"
        self.assert_failure_without_writes(payload)

    def test_zero_and_negative_removal_require_new_baseline(self):
        for target_mm in (.8, .9):
            payload = self.request()
            payload["source"]["package"]["molding"]["thickness"]["value"] = target_mm
            self.assert_failure_without_writes(payload, message="finish-mold")

    def test_conflicting_rules_cannot_silently_overwrite_same_parameter(self):
        payload = self.request()
        payload["profile"]["rules"].append({
            "id": "conflicting-grind", "type": "parameter", "fact": "final-mold-thickness",
            "role": "cow.mold.finish", "parameter": "thk", "verify": {"kind": "body", "property": "thickness"},
        })
        self.assert_failure_without_writes(payload)

    def test_unselected_recipe_is_not_chosen_implicitly(self):
        changed = flow_create_payload(self.base)
        changed["name"] = "Base requiring recipe choice"
        changed["configuration"]["stepConfigurations"]["grind"]["selectedRecipeId"] = None
        response = self.client.post("/api/process-flows", json=changed)
        self.assertEqual(response.status_code, 201, response.text)
        self.assert_failure_without_writes(self.request(base=response.json()))

    def test_terminal_validation_detects_later_changes_to_target_thickness(self):
        base, bindings = self.make_flow(downstream_grind=True)
        payload = self.request(base=base, bindings=bindings)
        self.assert_failure_without_writes(payload, message="finish-mold")
        # Explicitly limiting the requirement to its measured stage remains valid.
        payload["profile"]["rules"][1]["terminal"] = False
        payload["profile"]["rules"][2]["verify"]["terminal"] = False
        response = self.client.post("/api/package-conversions/preview", json=payload)
        self.assertEqual(response.status_code, 200, response.text)

    def test_generator_input_parameter_is_copied_and_verified(self):
        base, bindings = self.make_flow(generator=True)
        bindings["inputs"]["package.incoming"] = "incoming"
        payload = self.request(base=base, bindings=bindings)
        payload["source"]["package"]["incomingThickness"] = .2
        payload["profile"]["fields"].append({
            "id": "incoming-thickness", "object": "incoming", "property": "thickness", "stage": "incoming",
            "path": "/package/incomingThickness", "kind": "length", "unit": "mm",
        })
        payload["profile"]["rules"].append({
            "id": "set-incoming-thickness", "type": "generator_parameter", "fact": "incoming-thickness",
            "inputRole": "package.incoming", "parameterPath": "/carrierThickness",
            "verify": {"kind": "body", "property": "thickness", "key": "carrier"},
        })
        response = self.client.post("/api/package-conversions/preview", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        binding = response.json()["flow"]["configuration"]["inputBindings"]["incoming"]
        self.assertEqual(binding["parameters"]["carrierThickness"], 200)
        self.assertEqual(binding["parameters"]["packageX"], 100)
        self.assertEqual(self.client.get(f"/api/process-flows/{base['id']}").json(), base)
        payload["baseFlowId"] = self.base["id"]
        self.assert_failure_without_writes(payload)

    def test_revision_and_request_boundary_fail_before_writing(self):
        before = self.snapshot()
        payload = self.request()
        payload["baseRevision"] += 1
        self.assertEqual(self.client.post("/api/package-conversions/import", json=payload).status_code, 409)
        payload = self.request()
        payload["baseFlowId"] = "missing-base"
        self.assertEqual(self.client.post("/api/package-conversions/import", json=payload).status_code, 404)
        payload = self.request()
        payload["profile"]["schemaVersion"] = 2
        self.assertEqual(self.client.post("/api/package-conversions/import", json=payload).status_code, 422)
        self.assertEqual(self.snapshot(), before)

    def test_documented_profile_is_executable_against_demo_flow(self):
        directory = Path(__file__).resolve().parents[3] / "docs" / "examples" / "package-conversion"
        payload = self.request()
        for key, filename in (("source", "package.json"), ("profile", "profile.json"), ("bindings", "bindings.json")):
            payload[key] = json.loads((directory / filename).read_text())
        base = self.client.get("/api/process-flows/flow_inst_aaa_demo_hbm4_alpha").json()
        payload["baseFlowId"], payload["baseRevision"] = base["id"], base["revision"]
        response = self.client.post("/api/package-conversions/preview", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["report"]["status"], "validated")
        self.assertEqual(selected_values(response.json()["flow"], "mold_cap")["thickness"], 180)
        self.assertAlmostEqual(selected_values(response.json()["flow"], "c4_bump")["density"], 58)

    def test_source_array_and_escaped_json_pointer_are_supported(self):
        payload = self.request()
        payload["source"] = [{"package/parts": payload["source"]["package"]}]
        for field in payload["profile"]["fields"]:
            field["path"] = field["path"].replace("/package/", "/0/package~1parts/")
            if "unitPath" in field:
                field["unitPath"] = field["unitPath"].replace("/package/", "/0/package~1parts/")
        response = self.client.post("/api/package-conversions/preview", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertAlmostEqual(selected_values(response.json()["flow"], "grind")["thk"], 200)

    def test_dependent_derivations_follow_topology_instead_of_profile_order(self):
        base, bindings = self.make_flow(variant=True)
        bindings["roles"].update({"prep.deposit": "other_mold", "prep.finish": "other_grind"})
        payload = self.request(base=base, bindings=bindings)
        payload["source"]["package"]["prepThickness"] = .06
        payload["profile"]["fields"].append({
            "id": "prep-thickness", "object": "prep.mold", "property": "thickness", "stage": "finished",
            "path": "/package/prepThickness", "kind": "length", "unit": "mm",
        })
        # This upstream rule is deliberately listed after its dependent rule.
        payload["profile"]["rules"].append({
            "id": "finish-prep", "type": "molding_final_thickness", "fact": "prep-thickness",
            "moldingRole": "prep.deposit", "grindingRole": "prep.finish", "terminal": True,
        })
        response = self.client.post("/api/package-conversions/preview", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertAlmostEqual(selected_values(result["flow"], "other_grind")["thk"], 40)
        self.assertAlmostEqual(selected_values(result["flow"], "product_finish")["thk"], 200)
        derived = [change for change in result["report"]["changes"] if change["origin"] == "derived"]
        self.assertEqual([change["ruleId"] for change in derived], ["finish-prep", "finish-mold"])
        self.assertAlmostEqual(derived[1]["inputs"]["moldingZMin"], 260)
        self.assertAlmostEqual(derived[1]["inputs"]["incomingZMax"], 1060)

    def test_duplicate_import_uses_native_uniqueness_and_does_not_write(self):
        payload = self.request()
        first = self.client.post("/api/package-conversions/import", json=payload)
        self.assertEqual(first.status_code, 201, first.text)
        before = self.snapshot()
        duplicate = self.client.post("/api/package-conversions/import", json=payload)
        self.assertEqual(duplicate.status_code, 409, duplicate.text)
        self.assertEqual(self.snapshot(), before)

    def test_unknown_parameter_and_wrong_geometry_verification_cannot_import(self):
        payload = self.request()
        payload["profile"]["rules"][0]["parameter"] = "undeclared-material"
        self.assert_failure_without_writes(payload, message="set-mold-material")
        payload = self.request()
        payload["profile"]["rules"][2]["verify"]["kind"] = "body"
        failure = self.assert_failure_without_writes(payload, message="set-c4-density")
        self.assertTrue(any(not check["passed"] for check in failure["report"]["checks"]))

    def test_catalog_geometry_with_unscaled_non_um_units_cannot_import(self):
        geometry = copy.deepcopy(self.geometry)
        geometry["id"] = "package-conversion-mm-carrier"
        geometry["name"] = "Millimetre carrier"
        geometry["structure"]["unitSystem"] = "mm"
        # Legacy catalog rows can bypass the current geometry-create boundary.
        self.app.state.store.insert_geometry(geometry)
        base = flow_create_payload(self.base)
        base["name"] = "Base with millimetre input"
        base["configuration"]["inputBindings"]["incoming"]["geometryId"] = geometry["id"]
        response = self.client.post("/api/process-flows", json=base)
        self.assertEqual(response.status_code, 201, response.text)
        self.assert_failure_without_writes(self.request(base=response.json()))

    def test_nonfinite_raw_source_json_is_rejected_without_server_error_or_writes(self):
        before = self.snapshot()
        for value in (float("nan"), float("inf"), float("-inf")):
            with self.subTest(value=value):
                payload = self.request()
                payload["source"]["package"]["molding"]["thickness"]["value"] = value
                # json= would reject these in httpx before reaching the API.
                response = self.client.post("/api/package-conversions/import", content=json.dumps(payload),
                                            headers={"Content-Type": "application/json"})
                self.assertIn(response.status_code, (400, 422), response.text)
                self.assertEqual(self.snapshot(), before)

    def test_generator_geometry_with_non_um_units_cannot_import(self):
        class MillimetreCarrier(PanelCarrierGenerator):
            generator_id = "millimetre-carrier"

            def evaluate(self, parameters):
                evaluation = super().evaluate(parameters)
                evaluation.geometry_structure["unitSystem"] = "mm"
                return evaluation

        self.app.state.geometry_generators.register(MillimetreCarrier())
        base, bindings = self.make_flow(generator=True)
        payload = flow_create_payload(base)
        payload["name"] = "Base with millimetre generator"
        payload["configuration"]["inputBindings"]["incoming"]["generatorId"] = "millimetre-carrier"
        response = self.client.post("/api/process-flows", json=payload)
        self.assertEqual(response.status_code, 201, response.text)
        self.assert_failure_without_writes(self.request(base=response.json(), bindings=bindings))

    def test_derived_grinding_requires_um_parameter_definition(self):
        base = self.base_with_parameter_definition("grind", "thk", unit="mm")
        self.assert_failure_without_writes(self.request(base=base), message="finish-mold")

    def test_derived_molding_requires_um_parameter_definition(self):
        base = self.base_with_parameter_definition("mold", "thickness", unit="mm")
        self.assert_failure_without_writes(self.request(base=base), message="finish-mold")

    def test_integral_derived_removal_supports_integer_parameter_definition(self):
        base = self.base_with_parameter_definition("grind", "thk", valueType="integer")
        response = self.client.post("/api/package-conversions/import", json=self.request(base=base))
        self.assertEqual(response.status_code, 201, response.text)
        removal = selected_values(response.json()["flow"], "grind")["thk"]
        self.assertIs(type(removal), int)
        self.assertEqual(removal, 200)

    def test_flipped_or_removed_target_mold_cannot_be_derived(self):
        for operation, template, parameters in (("flip", "step_tpl_flip", {}),
                                                ("strip", "step_tpl_grinding", {"thk": 900})):
            with self.subTest(operation=operation):
                base = flow_create_payload(self.base)
                base["name"] = f"{operation} target mold"
                base["definition"]["stepRefs"].append({"stepRefId": operation, "processStepTemplateId": template})
                base["configuration"]["stepConfigurations"][operation] = recipe(parameters)
                base["definition"]["flowEdges"] = [edge for edge in base["definition"]["flowEdges"]
                                                    if edge["edgeId"] != "mold-grind"]
                base["definition"]["flowEdges"].extend([step_edge("mold", operation), step_edge(operation, "grind")])
                response = self.client.post("/api/process-flows", json=base)
                self.assertEqual(response.status_code, 201, response.text)
                self.assert_failure_without_writes(self.request(base=response.json()), message="finish-mold")


if __name__ == "__main__":
    unittest.main()
