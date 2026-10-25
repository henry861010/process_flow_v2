"""Acceptance tests for the schema-3 flow contract and schema-2 editor drafts."""
import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from process_flow_api.main import create_app
from process_flow_api.models import ProcessFlow, GeometryPreviewRequest, FlowConfiguration
from process_flow_api.services import resolve_preview_request, prepare_preview_execution, preview_request_identity
from process_flow_kernel import GeometryKernel
from pydantic import ValidationError


def create_body(flow):
    return {key: copy.deepcopy(value) for key, value in flow.items() if key not in ('id', 'revision')}


def values(flow, ref):
    return flow['configuration']['stepConfigurations'][ref]['recipeCandidates'][0]['parameterValues']


class ProcessFlowTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.app = create_app(db_path=Path(self.tmp.name) / 'data.sqlite3')
        self.context = TestClient(self.app)
        self.client = self.context.__enter__()
        self.bootstrap = self.client.get('/api/bootstrap').json()
        self.flow = copy.deepcopy(next(f for f in self.bootstrap['processFlows'] if f['id'] == 'flow_inst_aaa_demo_hbm4_alpha'))

    def tearDown(self):
        self.context.__exit__(None, None, None)
        self.app.state.store.close()
        self.tmp.cleanup()

    def create(self, flow=None, name='New flow'):
        body = create_body(flow or self.flow); body['name'] = name
        response = self.client.post('/api/process-flows', json=body)
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def draft(self, flow=None, target=None):
        flow = flow or self.flow
        state = {'metadata': {key: flow[key] for key in ('name', 'version', 'owner', 'description')},
                 'configuration': flow['configuration'], 'nodes': [], 'edges': [],
                 'viewport': {'x': -25, 'y': 31, 'zoom': .7}, 'editingRecipeIds': {'mold_cap': 'not-adopted'}}
        body = {'schemaVersion': 2, 'user': 'RD', 'name': 'Working draft', 'state': state}
        if target: body['target'] = target
        response = self.client.post('/api/process-flow-drafts', json=body)
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def test_new_contract_and_retired_routes(self):
        self.assertNotIn('processFlowTemplates', self.bootstrap)
        self.assertNotIn('processFlowInstances', self.bootstrap)
        for route in ('process-flow-templates', 'process-flow-instances', 'process-flow-template-instances',
                      'process-flow-template-drafts', 'process-flow-instance-drafts'):
            self.assertEqual(self.client.get('/api/' + route).status_code, 404)
            self.assertEqual(self.client.post('/api/' + route, json={}).status_code, 404)
        for change in ({'schemaVersion': 2}, {'status': 'enabled'}, {'processFlowTemplateId': 'old'}):
            response = self.client.post('/api/process-flows', json={**create_body(self.flow), **change})
            self.assertEqual(response.status_code, 422)
        invalid = create_body(self.flow)
        invalid['definition']['stepRefs'][0]['parameterDefaults'] = {}
        self.assertEqual(self.client.post('/api/process-flows', json=invalid).status_code, 422)

    def test_null_selection_serialization_does_not_rewrite_parameter_names(self):
        config = FlowConfiguration.model_validate({'stepConfigurations': {'station': {
            'recipeCandidates': [{'recipeId': 'one', 'name': 'One', 'parameterValues': {'recipeCandidates': []}}],
            'selectedRecipeId': None}}}).payload()
        station = config['stepConfigurations']['station']
        self.assertIsNone(station['selectedRecipeId'])
        self.assertEqual(station['recipeCandidates'][0]['parameterValues'], {'recipeCandidates': []})

    def test_partial_configuration_and_empty_candidates_are_saved_without_execution(self):
        flow = copy.deepcopy(self.flow)
        flow['configuration'] = {'inputBindings': {}, 'stepConfigurations': {'mold_cap': {'recipeCandidates': [], 'selectedRecipeId': None}}}
        with patch('process_flow_api.services.GeometryKernel.execute', side_effect=AssertionError('save must not execute')):
            saved = self.create(flow)
        self.assertIsNone(saved['configuration']['stepConfigurations']['mold_cap']['selectedRecipeId'])
        self.assertEqual(self.client.post(f"/api/process-flows/{saved['id']}/execute").status_code, 400)

    def test_all_candidates_validate_names_types_and_selection(self):
        config = self.flow['configuration']['stepConfigurations']['mold_cap']
        for change in ('duplicate', 'missing', 'type', 'null', 'empty', 'unknown'):
            flow = copy.deepcopy(self.flow); candidate = copy.deepcopy(config['recipeCandidates'][0])
            candidate['recipeId'] = 'alternate'
            flow['configuration']['stepConfigurations']['mold_cap']['recipeCandidates'].append(candidate)
            if change == 'duplicate': candidate['recipeId'] = config['selectedRecipeId']
            if change == 'missing': flow['configuration']['stepConfigurations']['mold_cap']['selectedRecipeId'] = 'absent'
            if change == 'type': candidate['parameterValues']['thickness'] = 'bad'
            if change == 'null': candidate['parameterValues']['thickness'] = None
            if change == 'empty': candidate['parameterValues']['thickness'] = ''
            if change == 'unknown': candidate['parameterValues']['unexpected'] = 1
            response = self.client.post('/api/process-flows', json={**create_body(flow), 'name': change})
            self.assertIn(response.status_code, (400, 422), response.text)
        flow = copy.deepcopy(self.flow)
        flow['configuration']['stepConfigurations']['mold_cap']['recipeCandidates'].append(
            {'recipeId': 'unfinished', 'name': 'Alternate', 'description': '', 'parameterValues': {}})
        self.create(flow)

    def test_only_adopted_recipe_changes_execution_and_preview_identity(self):
        before = self.client.post(f"/api/process-flows/{self.flow['id']}/execute").json()
        config = self.flow['configuration']['stepConfigurations']['mold_cap']
        candidate = copy.deepcopy(config['recipeCandidates'][0]); candidate.update(recipeId='alternate', name='Alternate')
        candidate['parameterValues']['thickness'] += 10; config['recipeCandidates'].append(candidate)
        saved = self.create()
        self.assertEqual(self.client.post(f"/api/process-flows/{saved['id']}/execute").json(), before)
        request = GeometryPreviewRequest(flowId=saved['id'], target={'type': 'stepOutput', 'stepRefId': 'mold_cap', 'outputPortId': 'result_geometry'})
        identity = preview_request_identity(resolve_preview_request(self.app.state.store, request))
        config['selectedRecipeId'] = 'alternate'
        update = {**create_body(self.flow), 'name': saved['name'], 'revision': saved['revision']}
        self.assertEqual(self.client.put(f"/api/process-flows/{saved['id']}", json=update).status_code, 200)
        self.assertNotEqual(self.client.post(f"/api/process-flows/{saved['id']}/execute").json(), before)
        self.assertNotEqual(preview_request_identity(resolve_preview_request(self.app.state.store, request)), identity)

    def test_source_changes_and_deletion_do_not_change_copy(self):
        original = self.create(name='Source')
        copy_flow = {**original, 'origin': {'flowId': original['id'], 'revision': original['revision']}}
        child = self.create(copy_flow, name='Child')
        update = {**create_body(original), 'revision': 1, 'origin': {'flowId': 'forged', 'revision': 99}}
        values(update, 'mold_cap')['thickness'] += 11
        updated = self.client.put(f"/api/process-flows/{original['id']}", json=update).json()
        self.assertEqual(updated['origin'], original['origin'])
        self.assertEqual(self.client.get(f"/api/process-flows/{child['id']}").json(), child)
        self.assertEqual(self.client.delete(f"/api/process-flows/{original['id']}?revision=2").status_code, 204)
        self.assertEqual(self.client.get(f"/api/process-flows/{child['id']}").json(), child)
        self.assertEqual(self.client.post(f"/api/process-flows/{child['id']}/execute").status_code, 200)

    def test_step_default_updates_never_refill_saved_recipes(self):
        saved = self.create()
        result = self.client.post(f"/api/process-flows/{saved['id']}/execute").json()
        step = self.app.state.store.get_process_step_template('step_tpl_molding')
        next(parameter for parameter in step['parameterDefinitions'] if parameter['id'] == 'thickness')['defaultValue'] = 999
        response = self.client.put('/api/process-step-templates/' + step['id'], json=step)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.client.get(f"/api/process-flows/{saved['id']}").json(), saved)
        self.assertEqual(self.client.post(f"/api/process-flows/{saved['id']}/execute").json(), result)
        update = {**create_body(saved), 'revision': saved['revision']}
        del values(update, 'mold_cap')['thickness']
        response = self.client.put(f"/api/process-flows/{saved['id']}", json=update)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotIn('thickness', values(response.json(), 'mold_cap'))
        self.assertEqual(self.client.post(f"/api/process-flows/{saved['id']}/execute").status_code, 400)

    def test_preview_identity_changes_with_bindings_and_wiring(self):
        content = {key: copy.deepcopy(self.flow[key]) for key in ('definition', 'configuration')}
        target = {'type': 'stepOutput', 'stepRefId': 'mold_cap', 'outputPortId': 'result_geometry'}
        def identity(flow):
            request = GeometryPreviewRequest(flow=flow, target=target)
            return preview_request_identity(resolve_preview_request(self.app.state.store, request))
        original = identity(content)
        changed_binding = copy.deepcopy(content)
        changed_binding['configuration']['inputBindings']['incoming_hbm'] = copy.deepcopy(content['configuration']['inputBindings']['incoming_panel'])
        self.assertNotEqual(identity(changed_binding), original)
        changed_edge = copy.deepcopy(content)
        edge = next(edge for edge in changed_edge['definition']['flowEdges'] if edge['source'].get('flowInputId') == 'incoming_hbm')
        edge['source']['flowInputId'] = 'incoming_panel'
        self.assertNotEqual(identity(changed_edge), original)

    def test_zip_round_trip_keeps_all_candidates_null_selection_origin_and_revision(self):
        flow = copy.deepcopy(self.flow)
        config = flow['configuration']['stepConfigurations']['mold_cap']
        config['recipeCandidates'].append({'recipeId': 'unfinished', 'name': 'Incomplete alternate', 'description': 'Retain this note', 'parameterValues': {}})
        config['selectedRecipeId'] = None
        saved = self.create(flow)
        response = self.client.put(f"/api/process-flows/{saved['id']}", json={**create_body(saved), 'revision': 1})
        self.assertEqual(response.status_code, 200, response.text)
        saved = response.json()
        snapshot = self.client.get('/api/fixture-export').content
        restored = self.client.post('/api/reset-from-zip', content=snapshot, headers={'Content-Type': 'application/zip'})
        self.assertEqual(restored.status_code, 200, restored.text)
        self.assertEqual(self.client.get(f"/api/process-flows/{saved['id']}").json(), saved)

    def test_revision_cas_and_global_name_version_uniqueness(self):
        saved = self.create()
        update = {**create_body(saved), 'revision': 1}
        self.assertEqual(self.client.put(f"/api/process-flows/{saved['id']}", json=update).json()['revision'], 2)
        self.assertEqual(self.client.put(f"/api/process-flows/{saved['id']}", json=update).status_code, 409)
        self.assertEqual(self.client.delete(f"/api/process-flows/{saved['id']}?revision=1").status_code, 409)
        self.assertEqual(self.client.delete(f"/api/process-flows/{saved['id']}").status_code, 422)
        self.assertEqual(self.client.post('/api/process-flows', json=create_body(saved)).status_code, 409)

    def test_disabling_step_blocks_new_refs_but_not_existing_execution_and_updates(self):
        step = self.app.state.store.get_process_step_template('step_tpl_molding'); step['status'] = 'disabled'
        self.app.state.store.update_process_step_template(step)
        self.assertEqual(self.client.post('/api/process-flows', json={**create_body(self.flow), 'name': 'Blocked'}).status_code, 409)
        update = {**create_body(self.flow), 'revision': 1}
        response = self.client.put(f"/api/process-flows/{self.flow['id']}", json=update)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.client.post(f"/api/process-flows/{self.flow['id']}/execute").status_code, 200)
        update['revision'] = 2; update['definition']['stepRefs'][1]['stepRefId'] = 'new-disabled-ref'
        self.assertEqual(self.client.put(f"/api/process-flows/{self.flow['id']}", json=update).status_code, 409)

    def test_embedded_is_rejected_for_flows_drafts_and_previews(self):
        flow = copy.deepcopy(self.flow)
        flow['configuration']['inputBindings']['incoming_hbm'] = {'kind': 'embedded', 'localId': 'local'}
        self.assertEqual(self.client.post('/api/process-flows', json=create_body(flow)).status_code, 422)
        with self.assertRaises(ValidationError):
            GeometryPreviewRequest(flow={'definition': flow['definition'], 'configuration': flow['configuration']}, target={'type': 'flowInput', 'flowInputId': 'incoming_hbm'})
        flow['configuration'] = {'inputBindings': {}, 'stepConfigurations': {}, 'embeddedGeometries': {}}
        self.assertEqual(self.client.post('/api/process-flows', json=create_body(flow)).status_code, 422)

    def test_generator_save_does_not_materialize(self):
        flow = copy.deepcopy(self.flow)
        flow['configuration']['inputBindings']['incoming_hbm'] = {'kind': 'generator', 'generatorId': 'hbm', 'generatorVersion': 2, 'parameters': {}}
        with patch.object(self.app.state.geometry_generators, 'generate', side_effect=AssertionError('must not generate')):
            self.create(flow)

    def test_inline_preview_requires_exactly_one_flow_source_and_limits_dependencies(self):
        content = {key: copy.deepcopy(self.flow[key]) for key in ('definition', 'configuration')}
        content['configuration']['stepConfigurations']['rdl_build']['selectedRecipeId'] = None
        request = {'flow': content, 'target': {'type': 'stepOutput', 'stepRefId': 'mold_cap', 'outputPortId': 'result_geometry'}}
        context = resolve_preview_request(self.app.state.store, GeometryPreviewRequest.model_validate(request))
        plan = prepare_preview_execution(context, self.app.state.geometry_generators).execution_plan
        self.assertEqual([step.step_ref_id for step in plan.steps], ['pnp_hbm', 'mold_cap'])
        for invalid in ({'flowId': self.flow['id'], **request}, {'target': request['target']}, {'flowTemplate': {}, 'configuration': {}, 'target': request['target']}):
            self.assertEqual(self.client.post('/api/preview-sessions', json=invalid).status_code, 422)
        content['configuration']['stepConfigurations'] = {}
        request['target'] = {'type': 'flowInput', 'flowInputId': 'incoming_panel'}
        context = resolve_preview_request(self.app.state.store, GeometryPreviewRequest.model_validate(request))
        self.assertIsNotNone(prepare_preview_execution(context, self.app.state.geometry_generators).flow_input_geometry)

    def test_zero_placements_prune_unfinished_auxiliary_branch(self):
        flow = copy.deepcopy(next(f for f in self.bootstrap['processFlows'] if f['id'] == 'flow_inst_dual_bump_demo'))
        values(flow, 'pnp')['placements'] = []
        flow['configuration']['inputBindings'].pop('incoming_die')
        for ref in ('die_bump', 'die_flip'):
            flow['configuration']['stepConfigurations'][ref] = {'recipeCandidates': [], 'selectedRecipeId': None}
        saved = self.create(flow)
        response = self.client.post(f"/api/process-flows/{saved['id']}/execute")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(set(response.json()['stepOutputs']), {'main_bump', 'pnp', 'joint'})

    def test_draft_crud_preserves_incomplete_values_ui_and_target_revision(self):
        flow = copy.deepcopy(self.flow); values(flow, 'mold_cap')['thickness'] = ''
        draft = self.draft(flow, target={'flowId': flow['id'], 'revision': 1})
        body = {key: value for key, value in draft.items() if key not in ('id', 'createdAt', 'updatedAt')}
        body['state']['viewport']['x'] = 81
        updated = self.client.put('/api/process-flow-drafts/' + draft['id'], json=body)
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()['revision'], 2)
        self.assertEqual(updated.json()['createdAt'], draft['createdAt'])
        self.assertEqual(updated.json()['state']['editingRecipeIds'], {'mold_cap': 'not-adopted'})
        self.assertEqual(self.client.put('/api/process-flow-drafts/' + draft['id'], json=body).status_code, 409)
        self.assertEqual(self.client.delete('/api/process-flow-drafts/' + draft['id'] + '?revision=1').status_code, 409)
        listing = self.client.get('/api/process-flow-drafts?user=RD&search=Working').json()
        self.assertEqual(len(listing), 1); self.assertNotIn('state', listing[0])

    def test_draft_commit_is_atomic_for_create_update_and_revision_conflicts(self):
        draft = self.draft(); body = {'revision': 1, 'flow': {**create_body(self.flow), 'name': 'Draft result'}}
        with patch.object(self.app.state.store, '_delete_in_transaction', side_effect=RuntimeError('injected failure')):
            with self.assertRaises(RuntimeError): self.client.post('/api/process-flow-drafts/' + draft['id'] + '/commit', json=body)
        self.assertEqual(len(self.app.state.store.list_process_flows()), 5)
        self.assertIsNotNone(self.app.state.store.get_flow_draft(draft['id']))
        response = self.client.post('/api/process-flow-drafts/' + draft['id'] + '/commit', json=body)
        self.assertEqual(response.status_code, 200, response.text)
        saved = response.json(); self.assertIsNone(self.app.state.store.get_flow_draft(draft['id']))
        target = {'flowId': saved['id'], 'revision': 1}; draft = self.draft(saved, target)
        body = {'revision': 1, 'flow': create_body(saved), 'target': {**target, 'revision': 9}}
        route = '/api/process-flow-drafts/' + draft['id'] + '/commit'
        self.assertEqual(self.client.post(route, json=body).status_code, 409)
        self.assertIsNotNone(self.app.state.store.get_flow_draft(draft['id']))
        body['target'] = target
        self.assertEqual(self.client.post(route, json=body).json()['revision'], 2)

    def test_failed_draft_commit_validation_or_duplicate_keeps_draft(self):
        draft = self.draft(); route = '/api/process-flow-drafts/' + draft['id'] + '/commit'
        body = {'revision': 1, 'flow': create_body(self.flow)}
        self.assertEqual(self.client.post(route, json=body).status_code, 409)
        body['flow']['definition']['flowEdges'] = []
        self.assertEqual(self.client.post(route, json=body).status_code, 400)
        self.assertIsNotNone(self.app.state.store.get_flow_draft(draft['id']))

    def test_geometry_usage_checks_flows_and_drafts_and_releases_after_delete(self):
        geometry = copy.deepcopy(self.bootstrap['geometries'][0]); geometry['id'] = 'extra-geometry'
        self.app.state.store.insert_geometry(geometry)
        flow = copy.deepcopy(self.flow); flow['configuration']['inputBindings']['incoming_panel'] = {'kind': 'catalog', 'geometryId': geometry['id']}
        draft = self.draft(flow)
        self.assertEqual(self.client.delete('/api/geometries/' + geometry['id']).status_code, 409)
        self.assertEqual(self.client.delete('/api/process-flow-drafts/' + draft['id'] + '?revision=1').status_code, 204)
        self.assertEqual(self.client.delete('/api/geometries/' + geometry['id']).status_code, 204)
