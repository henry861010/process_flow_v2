"""Acceptance tests for the schema-3 flow contract and schema-2 editor drafts."""
import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from process_flow_api.main import create_app
from process_flow_api.models import ProcessFlow, GeometryPreviewRequest, FlowConfiguration
from process_flow_api.fixture_export import build_fixture_archive
from process_flow_api.services import (
    resolve_preview_request, prepare_preview_execution, preview_request_identity,
    project_preview_flow, validate_preview_step, resolve_preview_flow_input,
)
from process_flow_kernel import FlowCompiler, GeometryKernel, InMemoryGeometryCatalog
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

    def draft(self, flow=None):
        flow = flow or self.flow
        state = {'metadata': {key: flow[key] for key in ('name', 'version', 'owner', 'description')},
                 'configuration': flow['configuration'], 'nodes': [], 'edges': [],
                 'viewport': {'x': -25, 'y': 31, 'zoom': .7}, 'editingRecipeIds': {'mold_cap': 'not-adopted'}}
        body = {'schemaVersion': 2, 'user': 'RD', 'name': 'Working draft', 'state': state}
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
        for change in ('duplicate', 'missing', 'type', 'unknown'):
            flow = copy.deepcopy(self.flow); candidate = copy.deepcopy(config['recipeCandidates'][0])
            candidate['recipeId'] = 'alternate'
            flow['configuration']['stepConfigurations']['mold_cap']['recipeCandidates'].append(candidate)
            if change == 'duplicate': candidate['recipeId'] = config['selectedRecipeId']
            if change == 'missing': flow['configuration']['stepConfigurations']['mold_cap']['selectedRecipeId'] = 'absent'
            if change == 'type': candidate['parameterValues']['thickness'] = 'bad'
            if change == 'unknown': candidate['parameterValues']['unexpected'] = 1
            response = self.client.post('/api/process-flows', json={**create_body(flow), 'name': change})
            self.assertIn(response.status_code, (400, 422), response.text)
        flow = copy.deepcopy(self.flow)
        flow['configuration']['stepConfigurations']['mold_cap']['recipeCandidates'].append(
            {'recipeId': 'unfinished', 'name': 'Alternate', 'description': '', 'parameterValues': {}})
        self.create(flow)

    def parameter_contract_flow(self):
        # Test-only schema exercises optional values without changing any shipped template.
        step = copy.deepcopy(next(s for s in self.bootstrap['processStepTemplates'] if s['id'] == 'step_tpl_molding'))
        step['id'] = 'step_tpl_parameter_contract_test'
        children = [
            {'id': 'amount', 'name': 'Amount', 'valueType': 'float', 'controlType': 'number', 'required': False},
            {'id': 'count', 'name': 'Count', 'valueType': 'integer', 'controlType': 'number', 'required': True},
        ]
        step['parameterDefinitions'] += [
            {'id': 'tolerance', 'name': 'Tolerance', 'valueType': 'float', 'controlType': 'number',
             'required': False, 'validation': {'min': 0, 'max': 10}},
            {'id': 'enabled', 'name': 'Enabled', 'valueType': 'boolean', 'controlType': 'checkbox', 'required': False},
            {'id': 'samples', 'name': 'Samples', 'valueType': 'float[]', 'controlType': 'text', 'required': False},
            {'id': 'groups', 'name': 'Groups', 'valueType': 'fieldGroupArray', 'controlType': 'repeater',
             'required': False, 'repeatDefinition': {'itemNameTemplate': 'Group {{index}}', 'indexBase': 0,
                 'itemParameterDefinitions': [
                     {'id': 'children', 'name': 'Children', 'valueType': 'fieldGroupArray', 'controlType': 'repeater',
                      'required': False, 'repeatDefinition': {'itemNameTemplate': 'Child {{index}}', 'indexBase': 0,
                          'itemParameterDefinitions': children}},
                 ]}},
        ]
        if self.app.state.store.get_process_step_template(step['id']) is None:
            self.app.state.store.insert_process_step_template(step)
        flow = copy.deepcopy(self.flow)
        next(ref for ref in flow['definition']['stepRefs'] if ref['stepRefId'] == 'mold_cap')['processStepTemplateId'] = step['id']
        return flow

    def compile_flow(self, flow):
        return FlowCompiler(InMemoryGeometryCatalog(self.bootstrap['geometries'])).compile(
            flow['definition'], flow['configuration'], self.app.state.store.list_process_step_templates(),
        )

    def test_optional_number_fill_clear_save_reload_and_compile(self):
        for empty in ('', None):
            with self.subTest(empty=empty):
                flow = self.parameter_contract_flow()
                values(flow, 'mold_cap')['tolerance'] = 2.5
                saved = self.create(flow, name=f'Optional numeric {empty!r}')
                self.assertEqual(values(saved, 'mold_cap')['tolerance'], 2.5)
                body = {**create_body(saved), 'revision': saved['revision']}
                values(body, 'mold_cap')['tolerance'] = empty
                response = self.client.put(f"/api/process-flows/{saved['id']}", json=body)
                self.assertEqual(response.status_code, 200, response.text)
                reloaded = self.client.get(f"/api/process-flows/{saved['id']}").json()
                self.assertEqual(response.json(), reloaded)
                self.assertNotIn('tolerance', values(reloaded, 'mold_cap'))
                step = next(step for step in self.compile_flow(reloaded).steps if step.step_ref_id == 'mold_cap')
                self.assertIsNone(step.parameter_values['tolerance'])
                self.assertNotIn('tolerance', step.raw_parameter_values)
                self.assertEqual(self.client.post(f"/api/process-flows/{saved['id']}/execute").status_code, 200)

    def test_required_legacy_missing_values_save_but_do_not_compile(self):
        for empty in ('', None):
            with self.subTest(empty=empty):
                flow = copy.deepcopy(self.flow)
                values(flow, 'mold_cap')['thickness'] = empty
                saved = self.create(flow, name=f'Required numeric {empty!r}')
                self.assertNotIn('thickness', values(saved, 'mold_cap'))
                with self.assertRaisesRegex(ValueError, 'Missing required parameter: thickness'):
                    self.compile_flow(saved)
                response = self.client.post(f"/api/process-flows/{saved['id']}/execute")
                self.assertEqual(response.status_code, 400)

    def test_nested_missing_values_preserve_zero_false_and_empty_collections(self):
        flow = self.parameter_contract_flow()
        values(flow, 'mold_cap').update(tolerance=0, enabled=False, samples=[], groups={'items': [
            {'itemId': 'parent', 'index': 0, 'values': {'children': {'items': [
                {'itemId': 'child', 'index': 0, 'values': {'amount': '', 'count': 0}},
            ]}}},
            {'itemId': 'empty', 'index': 1, 'values': {'children': {'items': []}}},
        ]})
        saved = self.create(flow)
        persisted = values(saved, 'mold_cap')
        self.assertEqual({key: persisted[key] for key in ('tolerance', 'enabled', 'samples')},
                         {'tolerance': 0, 'enabled': False, 'samples': []})
        parent, empty = persisted['groups']['items']
        self.assertEqual(parent['itemId'], 'parent')
        self.assertEqual(parent['index'], 0)
        self.assertEqual(parent['values']['children']['items'][0]['values'], {'count': 0})
        self.assertEqual(empty['values'], {'children': {'items': []}})
        step = next(step for step in self.compile_flow(saved).steps if step.step_ref_id == 'mold_cap')
        self.assertIsNone(step.parameter_values['groups'][0]['children'][0]['amount'])
        update = {**create_body(saved), 'revision': saved['revision']}
        child = values(update, 'mold_cap')['groups']['items'][0]['values']['children']['items'][0]
        child['values']['count'] = None
        response = self.client.put(f"/api/process-flows/{saved['id']}", json=update)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(values(response.json(), 'mold_cap')['groups']['items'][0]['values']['children']['items'][0]['values'], {})
        with self.assertRaisesRegex(ValueError, 'Missing required parameter: count'):
            self.compile_flow(response.json())

    def test_missing_normalization_does_not_hide_invalid_values_or_structures(self):
        base = self.parameter_contract_flow()
        cases = [
            {'tolerance': 'bad'}, {'tolerance': ' '}, {'tolerance': -1}, {'tolerance': 11},
            {'samples': [0, None]}, {'samples': [0, '']}, {'unknown': None}, {'unknown': ''},
            {'groups': {'items': [None]}},
            {'groups': {'items': [{'itemId': '', 'index': 0, 'values': {}}]}},
            {'groups': {'items': [{'itemId': 'a', 'index': 0, 'values': None}]}},
        ]
        for invalid in cases:
            with self.subTest(invalid=invalid):
                flow = copy.deepcopy(base)
                values(flow, 'mold_cap').update(invalid)
                response = self.client.post('/api/process-flows', json={**create_body(flow), 'name': 'Invalid'})
                self.assertEqual(response.status_code, 400, response.text)

    def test_legacy_load_import_and_inline_preview_use_canonical_recipe_values(self):
        flow = self.parameter_contract_flow()
        values(flow, 'mold_cap')['tolerance'] = ''
        # Simulate a pre-fix row; reads project compatibility without changing revision or raw storage.
        self.app.state.store._connection.execute('UPDATE process_flows SET payload=? WHERE id=?',
                                                (json.dumps(flow), flow['id']))
        self.app.state.store._connection.commit()
        reloaded = self.client.get(f"/api/process-flows/{flow['id']}").json()
        self.assertNotIn('tolerance', values(reloaded, 'mold_cap'))
        self.assertEqual(reloaded['revision'], flow['revision'])
        self.assertNotIn('tolerance', values(next(f for f in self.client.get('/api/bootstrap').json()['processFlows']
                                                if f['id'] == flow['id']), 'mold_cap'))
        inline = GeometryPreviewRequest(flow={key: flow[key] for key in ('definition', 'configuration')},
                                        target={'type': 'stepOutput', 'stepRefId': 'mold_cap'})
        context = resolve_preview_request(self.app.state.store, inline)
        self.assertNotIn('tolerance', context.configuration['stepConfigurations']['mold_cap']['recipeCandidates'][0]['parameterValues'])
        canonical = inline.model_copy(deep=True)
        canonical.flow.configuration.stepConfigurations['mold_cap'].recipeCandidates[0].parameterValues.pop('tolerance')
        self.assertEqual(preview_request_identity(context), preview_request_identity(resolve_preview_request(self.app.state.store, canonical)))
        fixtures = copy.deepcopy(self.bootstrap)
        fixtures['processStepTemplates'] = self.app.state.store.list_process_step_templates()
        fixtures['processFlows'] = [flow]
        for invalid in ({'tolerance': 'bad'}, {'samples': [None]}, {'unknown': ''}):
            with self.subTest(import_invalid=invalid):
                rejected = copy.deepcopy(fixtures)
                values(rejected['processFlows'][0], 'mold_cap').update(invalid)
                response = self.client.post('/api/reset-from-zip', content=build_fixture_archive(rejected),
                                            headers={'Content-Type': 'application/zip'})
                self.assertEqual(response.status_code, 400, response.text)
                self.assertEqual(self.client.get(f"/api/process-flows/{flow['id']}").json(), reloaded)
        response = self.client.post('/api/reset-from-zip', content=build_fixture_archive(fixtures),
                                    headers={'Content-Type': 'application/zip'})
        self.assertEqual(response.status_code, 200, response.text)
        row = self.app.state.store._connection.execute('SELECT payload FROM process_flows WHERE id=?', (flow['id'],)).fetchone()
        self.assertNotIn('tolerance', values(json.loads(row[0]), 'mold_cap'))
        self.compile_flow(self.client.get(f"/api/process-flows/{flow['id']}").json())

    def test_draft_raw_missing_and_invalid_values_survive_until_formal_commit(self):
        flow = self.parameter_contract_flow()
        values(flow, 'mold_cap').update(tolerance='', enabled=None, samples=['invalid'])
        draft = self.draft(flow)
        loaded = self.client.get('/api/process-flow-drafts/' + draft['id']).json()
        self.assertEqual(loaded['state']['configuration'], flow['configuration'])
        body = {'revision': draft['revision'], 'flow': {**create_body(flow), 'name': 'Committed values'}}
        response = self.client.post('/api/process-flow-drafts/' + draft['id'] + '/commit', json=body)
        self.assertEqual(response.status_code, 400, response.text)
        self.assertIsNotNone(self.app.state.store.get_flow_draft(draft['id']))
        values(body['flow'], 'mold_cap')['samples'] = []
        response = self.client.post('/api/process-flow-drafts/' + draft['id'] + '/commit', json=body)
        self.assertEqual(response.status_code, 200, response.text)
        persisted = values(response.json(), 'mold_cap')
        self.assertNotIn('tolerance', persisted)
        self.assertNotIn('enabled', persisted)
        self.assertEqual(persisted['samples'], [])

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

    def test_start_from_creates_independent_flow_and_only_updates_new_identity(self):
        source = self.create(name='Branch source')
        origin = {'flowId': source['id'], 'revision': source['revision']}
        before_count = len(self.app.state.store.list_process_flows())
        body = {**create_body(source), 'name': source['name'] + ' (branch)', 'origin': origin}
        response = self.client.post('/api/process-flows', json=body)
        self.assertEqual(response.status_code, 201, response.text)
        branch = response.json()
        self.assertNotEqual(branch['id'], source['id'])
        self.assertEqual(branch['revision'], 1)
        self.assertEqual(branch['origin'], origin)
        self.assertEqual(branch['definition'], source['definition'])
        self.assertEqual(branch['configuration'], source['configuration'])
        self.assertEqual(len(self.app.state.store.list_process_flows()), before_count + 1)
        update = {**create_body(branch), 'revision': 1}
        values(update, 'mold_cap')['thickness'] += 7
        updated = self.client.put('/api/process-flows/' + branch['id'], json=update)
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()['revision'], 2)
        self.assertEqual(updated.json()['origin'], origin)
        self.assertEqual(self.client.get('/api/process-flows/' + source['id']).json(), source)

    def test_start_from_draft_resume_and_commit_preserve_origin_and_source(self):
        source = self.create(name='Draft branch source')
        origin = {'flowId': source['id'], 'revision': source['revision']}
        draft = self.draft(source)
        draft_body = {key: copy.deepcopy(value) for key, value in draft.items()
                      if key not in ('id', 'createdAt', 'updatedAt')}
        draft_body['origin'] = origin
        draft_body['state']['metadata']['name'] = source['name'] + ' (branch)'
        response = self.client.put('/api/process-flow-drafts/' + draft['id'], json=draft_body)
        self.assertEqual(response.status_code, 200, response.text)
        resumed = self.client.get('/api/process-flow-drafts/' + draft['id']).json()
        self.assertEqual(resumed['origin'], origin)
        self.assertEqual(resumed['state']['configuration'], source['configuration'])
        before_count = len(self.app.state.store.list_process_flows())
        commit = {'revision': resumed['revision'], 'flow': {
            **create_body(source), **resumed['state']['metadata'], 'origin': resumed['origin']}}
        result = self.client.post('/api/process-flow-drafts/' + draft['id'] + '/commit', json=commit)
        self.assertEqual(result.status_code, 200, result.text)
        branch = result.json()
        self.assertNotEqual(branch['id'], source['id'])
        self.assertEqual(branch['revision'], 1)
        self.assertEqual(branch['origin'], origin)
        self.assertEqual(branch['definition'], source['definition'])
        self.assertEqual(branch['configuration'], source['configuration'])
        self.assertEqual(len(self.app.state.store.list_process_flows()), before_count + 1)
        self.assertIsNone(self.app.state.store.get_flow_draft(draft['id']))
        self.assertEqual(self.client.get('/api/process-flows/' + source['id']).json(), source)

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
        stale = self.client.put(f"/api/process-flows/{saved['id']}", json=update)
        self.assertEqual(stale.status_code, 409)
        self.assertNotIn('save as', stale.json()['message'].lower())
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

    def test_upstream_preview_ignores_incomplete_downstream_topology_and_configuration(self):
        original = {key: copy.deepcopy(self.flow[key]) for key in ('definition', 'configuration')}
        cases = {}
        for kind in ('wire', 'recipe', 'parameter', 'template', 'geometry'):
            content = copy.deepcopy(original)
            if kind == 'wire':
                content['definition']['flowEdges'] = [edge for edge in content['definition']['flowEdges']
                    if edge['target']['stepRefId'] != 'mold_cap']
            elif kind == 'recipe':
                content['configuration']['stepConfigurations']['mold_cap']['selectedRecipeId'] = None
            elif kind == 'parameter':
                del values(content, 'mold_cap')['thickness']
            elif kind == 'template':
                content['definition']['stepRefs'][1]['processStepTemplateId'] = 'unfinished-template'
            else:
                future = copy.deepcopy(content['definition']['flowInputs'][1])
                future['flowInputId'] = 'future_die'
                content['definition']['flowInputs'].append(future)
                content['configuration']['inputBindings']['future_die'] = {
                    'kind': 'catalog', 'geometryId': 'missing-future-geometry',
                }
                content['definition']['stepRefs'][1]['processStepTemplateId'] = 'step_tpl_pnp'
                content['configuration']['stepConfigurations']['mold_cap'] = copy.deepcopy(
                    content['configuration']['stepConfigurations']['pnp_hbm'])
                content['definition']['flowEdges'].append({
                    'edgeId': 'future-die', 'source': {'kind': 'flowInput', 'flowInputId': 'future_die'},
                    'target': {'stepRefId': 'mold_cap', 'inputPortId': 'die_geometry'},
                })
            cases[kind] = content

        for kind, content in cases.items():
            with self.subTest(kind=kind):
                request = {'flow': content, 'target': {
                    'type': 'stepOutput', 'stepRefId': 'pnp_hbm', 'outputPortId': 'result_geometry',
                }}
                context = resolve_preview_request(self.app.state.store, GeometryPreviewRequest.model_validate(request))
                before = copy.deepcopy(context)
                scope = project_preview_flow(context)
                self.assertEqual([ref['stepRefId'] for ref in scope.definition['stepRefs']], ['pnp_hbm'])
                self.assertEqual(set(scope.configuration['stepConfigurations']), {'pnp_hbm'})
                prepared = prepare_preview_execution(context, self.app.state.geometry_generators)
                self.assertEqual([step.step_ref_id for step in prepared.execution_plan.steps], ['pnp_hbm'])
                self.assertEqual(context, before)
                response = self.client.post('/api/preview-sessions', json=request)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual([snapshot['stepRefId'] for snapshot in response.json()['snapshots']], ['pnp_hbm'])
                # A full-flow save still requires the complete graph and valid resources.
                if kind in ('wire', 'template', 'geometry'):
                    save = self.client.post('/api/process-flows', json={
                        **create_body(self.flow), **content, 'name': 'Incomplete ' + kind,
                    })
                    self.assertIn(save.status_code, (400, 404), save.text)

    def test_isolated_flow_input_preview_does_not_require_any_step_or_wiring(self):
        content = {key: copy.deepcopy(self.flow[key]) for key in ('definition', 'configuration')}
        content['definition']['flowEdges'] = []
        content['definition']['stepRefs'][0]['processStepTemplateId'] = 'unfinished-template'
        content['configuration']['stepConfigurations'] = {}
        content['configuration']['inputBindings']['incoming_hbm'] = {
            'kind': 'generator', 'generatorId': 'unfinished-generator', 'generatorVersion': 1, 'parameters': {},
        }
        request = {'flow': content, 'target': {'type': 'flowInput', 'flowInputId': 'incoming_panel'}}
        response = self.client.post('/api/preview-sessions', json=request)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(response.json()['snapshots']), 1)
        content['configuration']['inputBindings'].pop('incoming_panel')
        self.assertEqual(self.client.post('/api/preview-sessions', json=request).status_code, 400)

    def test_preview_still_rejects_incomplete_target_upstream_scope(self):
        for kind in ('wire', 'recipe', 'parameter', 'template', 'geometry'):
            with self.subTest(kind=kind):
                content = {key: copy.deepcopy(self.flow[key]) for key in ('definition', 'configuration')}
                if kind == 'wire':
                    content['definition']['flowEdges'] = [edge for edge in content['definition']['flowEdges']
                        if edge['target'] != {'stepRefId': 'pnp_hbm', 'inputPortId': 'main_geometry'}]
                elif kind == 'recipe':
                    content['configuration']['stepConfigurations']['pnp_hbm']['selectedRecipeId'] = None
                elif kind == 'parameter':
                    del values(content, 'pnp_hbm')['placements']
                elif kind == 'template':
                    content['definition']['stepRefs'][0]['processStepTemplateId'] = 'unfinished-template'
                else:
                    content['configuration']['inputBindings']['incoming_panel']['geometryId'] = 'missing-target-geometry'
                response = self.client.post('/api/preview-sessions', json={
                    'flow': content, 'target': {'type': 'stepOutput', 'stepRefId': 'pnp_hbm'},
                })
                self.assertEqual(response.status_code, 400, response.text)

    def test_future_step_readiness_reuses_validation_without_compiling_or_generating(self):
        content = {key: copy.deepcopy(self.flow[key]) for key in ('definition', 'configuration')}
        content['configuration']['inputBindings']['incoming_hbm'] = {
            'kind': 'generator', 'generatorId': 'unfinished-generator', 'generatorVersion': 1, 'parameters': {},
        }
        context = resolve_preview_request(self.app.state.store, GeometryPreviewRequest.model_validate({
            'flow': content, 'target': {'type': 'stepOutput', 'stepRefId': 'pnp_hbm'},
        }))
        with (
            patch('process_flow_api.services.FlowCompiler.compile', side_effect=AssertionError('must not compile')),
            patch.object(self.app.state.geometry_generators, 'generate', side_effect=AssertionError('must not generate')),
        ):
            validate_preview_step(context, self.app.state.geometry_generators, 'mold_cap')
        with self.assertRaises(ValueError):
            resolve_preview_flow_input(context, self.app.state.geometry_generators, 'incoming_hbm')
        del values(content, 'mold_cap')['thickness']
        context = resolve_preview_request(self.app.state.store, GeometryPreviewRequest.model_validate({
            'flow': content, 'target': {'type': 'stepOutput', 'stepRefId': 'pnp_hbm'},
        }))
        with self.assertRaisesRegex(ValueError, 'Missing required parameter: thickness'):
            validate_preview_step(context, self.app.state.geometry_generators, 'mold_cap')

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

    def test_draft_crud_preserves_incomplete_values_and_ui_state(self):
        flow = copy.deepcopy(self.flow); values(flow, 'mold_cap')['thickness'] = ''
        draft = self.draft(flow)
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

    def test_draft_commit_is_atomic_for_create_and_revision_conflicts(self):
        draft = self.draft(); body = {'revision': 1, 'flow': {**create_body(self.flow), 'name': 'Draft result'}}
        with patch.object(self.app.state.store, '_delete_in_transaction', side_effect=RuntimeError('injected failure')):
            with self.assertRaises(RuntimeError): self.client.post('/api/process-flow-drafts/' + draft['id'] + '/commit', json=body)
        self.assertEqual(len(self.app.state.store.list_process_flows()), 5)
        self.assertIsNotNone(self.app.state.store.get_flow_draft(draft['id']))
        response = self.client.post('/api/process-flow-drafts/' + draft['id'] + '/commit', json=body)
        self.assertEqual(response.status_code, 200, response.text)
        saved = response.json(); self.assertIsNone(self.app.state.store.get_flow_draft(draft['id']))
        draft = self.draft(saved)
        body = {'revision': 1, 'flow': {**create_body(saved), 'name': 'Another draft result'}}
        route = '/api/process-flow-drafts/' + draft['id'] + '/commit'
        update = {key: value for key, value in draft.items() if key not in ('id', 'createdAt', 'updatedAt')}
        self.assertEqual(self.client.put('/api/process-flow-drafts/' + draft['id'], json=update).status_code, 200)
        self.assertEqual(self.client.post(route, json=body).status_code, 409)
        self.assertIsNotNone(self.app.state.store.get_flow_draft(draft['id']))
        body['revision'] = 2
        self.assertEqual(self.client.post(route, json=body).json()['revision'], 1)
        self.assertIsNone(self.app.state.store.get_flow_draft(draft['id']))

    def test_draft_requests_reject_existing_flow_targets(self):
        draft = self.draft()
        target = {'flowId': self.flow['id'], 'revision': self.flow['revision']}
        create = {'schemaVersion': 2, 'user': 'RD', 'name': 'Rejected', 'state': draft['state'], 'target': target}
        self.assertEqual(self.client.post('/api/process-flow-drafts', json=create).status_code, 422)
        update = {key: value for key, value in draft.items() if key not in ('id', 'createdAt', 'updatedAt')}
        self.assertEqual(self.client.put('/api/process-flow-drafts/' + draft['id'], json={**update, 'target': target}).status_code, 422)
        commit = {'revision': draft['revision'], 'flow': {**create_body(self.flow), 'name': 'Rejected commit'}, 'target': target}
        self.assertEqual(self.client.post('/api/process-flow-drafts/' + draft['id'] + '/commit', json=commit).status_code, 422)
        self.assertEqual(self.app.state.store.get_flow_draft(draft['id']), draft)

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
