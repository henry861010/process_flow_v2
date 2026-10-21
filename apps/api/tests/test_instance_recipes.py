from __future__ import annotations

import copy
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient
from process_flow_kernel import instance_flow_configuration, resolve_instance_configuration
from process_flow_api.main import create_app
from process_flow_api.models import InstanceStepConfiguration, StepRecipeCreate
from process_flow_api.repository import SQLiteStore, ResourceConflictError
from process_flow_api.seed import load_seed_fixtures
from flow_requests import instance_create_payload, instance_configuration


class InstanceRecipeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.app = create_app(db_path=Path(self.tmp.name) / 'business.sqlite3')
        self.context = TestClient(self.app)
        self.client = self.context.__enter__()
        self.bootstrap = self.client.get('/api/bootstrap').json()
        self.source = self.bootstrap['processFlowInstances'][0]
        self.template_id = self.source['processFlowTemplateId']
        self.base = '/api/process-flow-instances'

    def tearDown(self):
        self.context.__exit__(None, None, None)
        self.app.state.store.close()
        self.tmp.cleanup()

    def create(self, **extra):
        response = self.client.post(self.base, json=dict(name='R&D', version='V0', owner='rd', processFlowTemplateId=self.template_id, **extra))
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def add(self, instance, step='mold_cap', **extra):
        response = self.client.post(f"{self.base}/{instance['id']}/steps/{step}/recipes", json=dict(revision=instance['revision'], name='Trial', parameterValues={}, **extra))
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def test_empty_create_and_reopen_do_not_compile_or_resolve_geometry(self):
        with mock.patch('process_flow_api.services._compiler', side_effect=AssertionError('must not compile')):
            instance = self.create()
        self.assertEqual(instance['revision'], 1)
        self.assertEqual(instance['inputBindings'], {})
        self.assertTrue(all(station == dict(recipes=[], activeRecipeId=None) for station in instance['stepConfigurations'].values()))
        self.assertEqual(self.client.get(f"{self.base}/{instance['id']}").json(), instance)
        response = self.client.post(f"{self.base}/{instance['id']}/execute")
        self.assertEqual(response.status_code, 400)
        self.assertIn('no active recipe', response.json()['message'])

    def test_home_defaults_create_one_active_recipe_for_every_station_and_reopen(self):
        template = next(item for item in self.bootstrap['processFlowTemplates'] if item['id'] == self.template_id)
        # Home sends resolved defaults through the existing initialConfiguration contract.
        values = {ref['stepRefId']: dict(parameterValues=copy.deepcopy(ref.get('parameterDefaults', {})))
                  for ref in template['stepRefs']}
        configuration = dict(inputBindings={}, embeddedGeometries={}, stepConfigurations=values)
        with mock.patch('process_flow_api.services._compiler', side_effect=AssertionError('must not compile')):
            instance = self.create(initialConfiguration=configuration)
        self.assertEqual(instance['inputBindings'], {})
        self.assertEqual(set(instance['stepConfigurations']), set(values))
        recipe_ids = []
        for step_id, station in instance['stepConfigurations'].items():
            self.assertEqual(len(station['recipes']), 1)
            recipe = station['recipes'][0]
            self.assertEqual(recipe['name'], 'Default')
            self.assertEqual(recipe['parameterValues'], values[step_id]['parameterValues'])
            self.assertEqual(station['activeRecipeId'], recipe['id'])
            self.assertRegex(recipe['id'], r'^[0-9a-f]{32}$')
            self.assertTrue(recipe['createdAt'])
            recipe_ids.append(recipe['id'])
        self.assertEqual(len(recipe_ids), len(set(recipe_ids)))
        self.assertEqual(self.client.get(f"{self.base}/{instance['id']}").json(), instance)
        stored = self.client.get('/api/bootstrap').json()['processFlowInstances']
        self.assertEqual(next(item for item in stored if item['id'] == instance['id']), instance)

    def test_first_recipe_active_later_recipes_preserve_choice_and_can_activate(self):
        first = self.add(self.create())
        station = first['stepConfigurations']['mold_cap']
        recipe = station['recipes'][0]
        self.assertRegex(recipe['id'], r'^[0-9a-f]{32}$')
        self.assertTrue(recipe['createdAt'])
        self.assertEqual(station['activeRecipeId'], recipe['id'])
        second = self.add(first)
        self.assertEqual(second['stepConfigurations']['mold_cap']['activeRecipeId'], recipe['id'])
        third = self.add(second, activate=True)
        self.assertEqual(third['revision'], 4)
        self.assertEqual(third['stepConfigurations']['mold_cap']['activeRecipeId'], third['stepConfigurations']['mold_cap']['recipes'][-1]['id'])
        self.assertEqual(third['stepConfigurations']['mold_cap']['recipes'][0], recipe)

    def test_activation_is_scoped_non_clearable_and_revision_checked(self):
        instance = self.add(self.add(self.create()), step='c4_bump')
        wrong = instance['stepConfigurations']['c4_bump']['activeRecipeId']
        path = f"{self.base}/{instance['id']}/steps/mold_cap/active-recipe"
        self.assertEqual(self.client.put(path, json=dict(revision=instance['revision'], recipeId=wrong)).status_code, 404)
        for recipe_id in (None, '', '   '):
            self.assertEqual(self.client.put(path, json=dict(revision=instance['revision'], recipeId=recipe_id)).status_code, 422)
        self.assertEqual(self.client.get(f"{self.base}/{instance['id']}").json(), instance)
        instance = self.add(instance)
        recipe_id = instance['stepConfigurations']['mold_cap']['recipes'][-1]['id']
        updated = self.client.put(path, json=dict(revision=instance['revision'], recipeId=recipe_id))
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()['stepConfigurations']['mold_cap']['activeRecipeId'], recipe_id)
        self.assertEqual(self.client.put(path, json=dict(revision=instance['revision'], recipeId=recipe_id)).status_code, 409)
        self.assertEqual(self.client.get(f"{self.base}/{instance['id']}").json(), updated.json())

    def test_nonempty_station_requires_active_even_in_repository_mutations(self):
        instance = self.add(self.create())
        station = instance['stepConfigurations']['mold_cap']
        with self.assertRaises(ValueError):
            InstanceStepConfiguration.model_validate({**station, 'activeRecipeId': None})
        def clear_active(current):
            current['stepConfigurations']['mold_cap']['activeRecipeId'] = None
            return current, []
        with self.assertRaises(ValueError):
            self.app.state.store.update_process_flow_instance(instance['id'], instance['revision'], clear_active)
        self.assertEqual(self.client.get(f"{self.base}/{instance['id']}").json(), instance)

    def test_unknown_instance_or_station_and_stale_add_never_write(self):
        instance = self.create()
        body = dict(revision=1, name='Trial', parameterValues={})
        self.assertEqual(self.client.post(f"{self.base}/missing/steps/mold_cap/recipes", json=body).status_code, 404)
        self.assertEqual(self.client.post(f"{self.base}/{instance['id']}/steps/missing/recipes", json=body).status_code, 404)
        saved = self.add(instance)
        self.assertEqual(self.client.post(f"{self.base}/{instance['id']}/steps/mold_cap/recipes", json=body).status_code, 409)
        self.assertEqual(self.client.get(f"{self.base}/{instance['id']}").json(), saved)

    def test_saved_recipes_cannot_be_overwritten_or_deleted(self):
        instance = self.add(self.create())
        path = f"{self.base}/{instance['id']}"
        self.assertEqual(self.client.put(path, json=instance).status_code, 405)
        recipe_id = instance['stepConfigurations']['mold_cap']['activeRecipeId']
        self.assertIn(self.client.put(f'{path}/steps/mold_cap/recipes/{recipe_id}', json={}).status_code, (404, 405))
        self.assertIn(self.client.delete(f'{path}/steps/mold_cap/recipes/{recipe_id}').status_code, (404, 405))
        def overwrite(current):
            current['stepConfigurations']['mold_cap']['recipes'][0]['parameterValues']['thickness'] = 9
            return current, []
        with self.assertRaises(ResourceConflictError):
            self.app.state.store.update_process_flow_instance(instance['id'], instance['revision'], overwrite)
        self.assertEqual(self.client.get(path).json(), instance)

    def test_legacy_metadata_is_preserved_during_mutation(self):
        instance = self.create()
        instance['name'] = '  Legacy name  '
        store = self.app.state.store
        with store._connection:
            store._connection.execute('UPDATE process_flow_instances SET name=?,payload=? WHERE id=?',
                                      (instance['name'], json.dumps(instance), instance['id']))
        saved = self.add(instance)
        self.assertEqual(saved['name'], instance['name'])

    def test_incomplete_recipe_is_stored_and_source_copy_has_new_recipe_ids(self):
        initial = instance_configuration(self.source)
        initial['stepConfigurations']['mold_cap']['parameterValues'] = {'material': 'EMC'}
        instance = self.create(initialConfiguration=initial)
        self.assertEqual(instance_flow_configuration(instance), initial)
        self.assertNotEqual(instance['stepConfigurations']['pnp_hbm']['activeRecipeId'], self.source['stepConfigurations']['pnp_hbm']['activeRecipeId'])
        self.assertEqual(self.client.post(f"{self.base}/{instance['id']}/execute").status_code, 400)

    def test_input_bindings_can_be_filled_replaced_and_cleared(self):
        instance = self.create()
        path = f"{self.base}/{instance['id']}/input-bindings"
        for bindings in (self.source['inputBindings'], {}, {'incoming_hbm': {'kind': 'generator', 'generatorId': 'hbm', 'generatorVersion': 2, 'parameters': {}}}):
            response = self.client.put(path, json=dict(revision=instance['revision'], inputBindings=bindings))
            self.assertEqual(response.status_code, 200, response.text)
            instance = response.json()
            self.assertEqual(instance['inputBindings'], bindings)
        before = copy.deepcopy(instance)
        bad = self.client.put(path, json=dict(revision=instance['revision'], inputBindings={'incoming_panel': {'kind': 'catalog', 'geometryId': 'missing'}}))
        self.assertEqual(bad.status_code, 404)
        self.assertEqual(self.client.get(f"{self.base}/{instance['id']}").json(), before)
        self.assertEqual(self.client.put(path, json=dict(revision=1, inputBindings={})).status_code, 409)

    def test_binding_materialization_rolls_back_all_writes(self):
        instance = self.create()
        geometries = self.bootstrap['geometries'][:2]
        embedded = {str(index): {key: value for key, value in geometry.items() if key != 'id'} for index, geometry in enumerate(geometries)}
        body = dict(revision=1, inputBindings={key: dict(kind='embedded', localId=str(index)) for index, key in enumerate(('incoming_panel', 'incoming_hbm'))}, embeddedGeometries=embedded)
        store = self.app.state.store
        before = store.list_geometries()
        original = store._insert_geometry_in_transaction
        count = 0
        def insert(geometry):
            nonlocal count
            count += 1
            original(geometry)
            if count == 2:
                raise RuntimeError('insert failed')
        with mock.patch.object(store, '_insert_geometry_in_transaction', side_effect=insert):
            with self.assertRaisesRegex(RuntimeError, 'insert failed'):
                self.client.put(f"{self.base}/{instance['id']}/input-bindings", json=body)
        self.assertEqual(store.list_geometries(), before)
        self.assertEqual(store.get_process_flow_instance(instance['id']), instance)

    def test_only_active_recipe_affects_execution_and_preview(self):
        instance = self.create(initialConfiguration=instance_configuration(self.source))
        before = self.client.post(f"{self.base}/{instance['id']}/execute").json()
        added = self.client.post(f"{self.base}/{instance['id']}/steps/mold_cap/recipes", json=dict(revision=1, name='Incomplete', parameterValues={})).json()
        self.assertEqual(self.client.post(f"{self.base}/{instance['id']}/execute").json(), before)
        path = f"{self.base}/{instance['id']}/steps/mold_cap/active-recipe"
        active = self.client.put(path, json=dict(revision=added['revision'], recipeId=added['stepConfigurations']['mold_cap']['recipes'][-1]['id'])).json()
        self.assertEqual(self.client.post(f"{self.base}/{instance['id']}/execute").status_code, 400)
        values = {'material': 'EMC-G700', 'thickness': 210}
        changed = self.client.post(f"{self.base}/{instance['id']}/steps/mold_cap/recipes", json=dict(revision=active['revision'], name='210', parameterValues=values, activate=True)).json()
        output = self.client.post(f"{self.base}/{instance['id']}/execute")
        self.assertEqual(output.status_code, 200, output.text)
        self.assertNotEqual(output.json()['geometryStructure'], before['geometryStructure'])
        preview = self.client.post('/api/geometry-preview', json=dict(processFlowTemplateId=self.template_id, configuration=instance_flow_configuration(changed), target=dict(type='stepOutput', stepRefId='mold_cap', outputPortId='result_geometry')))
        self.assertEqual(preview.status_code, 200, preview.text)

    def test_unused_branch_needs_no_active_recipe_and_target_preview_checks_it(self):
        source = next(item for item in self.bootstrap['processFlowInstances'] if item['id'] == 'flow_inst_dual_bump_demo')
        initial = instance_configuration(source)
        initial['stepConfigurations']['pnp']['parameterValues']['placements'] = []
        for key in ('die_bump', 'die_flip'):
            initial['stepConfigurations'].pop(key)
        initial['inputBindings'].pop('incoming_die')
        payload = instance_create_payload({**source, 'name': 'Unused branch', 'initialConfiguration': initial})
        response = self.client.post(self.base, json=payload)
        self.assertEqual(response.status_code, 201, response.text)
        instance = response.json()
        self.assertIsNone(instance['stepConfigurations']['die_bump']['activeRecipeId'])
        self.assertEqual(self.client.post(f"{self.base}/{instance['id']}/execute").status_code, 200)
        template = next(item for item in self.bootstrap['processFlowTemplates'] if item['id'] == source['processFlowTemplateId'])
        with self.assertRaisesRegex(ValueError, 'no active recipe'):
            resolve_instance_configuration(instance, template, self.bootstrap['processStepTemplates'], output_step_ref_id='die_bump')

    def test_disabled_flow_blocks_create_but_existing_instance_can_change(self):
        instance = self.create()
        template = next(item for item in self.bootstrap['processFlowTemplates'] if item['id'] == self.template_id)
        self.client.put(f'/api/process-flow-templates/{self.template_id}', json={**template, 'status': 'disabled'})
        response = self.client.post(self.base, json=dict(name='Disabled', version='V0', owner='rd', processFlowTemplateId=self.template_id))
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.add(instance)['revision'], 2)

    def test_instance_draft_routes_and_table_removed_template_drafts_remain(self):
        self.assertFalse(any('instance-drafts' in path for path in self.app.openapi()['paths']))
        self.assertIn('/api/process-flow-template-drafts', self.app.openapi()['paths'])
        self.assertEqual(self.client.get('/api/process-flow-instance-drafts').status_code, 404)
        self.assertFalse(self.app.state.store._table_exists('process_flow_instance_drafts'))

    def test_new_fixture_archive_round_trip_preserves_all_recipes(self):
        instance = self.add(self.add(self.create()))
        archive = self.client.get('/api/fixture-export').content
        restored = self.client.post('/api/reset-from-zip', content=archive, headers={'Content-Type': 'application/zip'})
        self.assertEqual(restored.status_code, 200, restored.text)
        self.assertEqual(self.client.get(f"{self.base}/{instance['id']}").json(), instance)

    def test_legacy_fixture_archive_converts_values_without_changing_instance_identity(self):
        from process_flow_api.fixture_export import build_fixture_archive
        fixtures = copy.deepcopy(self.bootstrap)
        for instance in fixtures['processFlowInstances']:
            instance.pop('revision')
            instance['stepConfigurations'] = instance_configuration(instance)['stepConfigurations']
        legacy = next(item for item in fixtures['processFlowInstances'] if item['id'] == self.source['id'])
        legacy['stepConfigurations'].pop('rdl_build')
        archive = build_fixture_archive(fixtures)
        response = self.client.post('/api/reset-from-zip', content=archive, headers={'Content-Type': 'application/zip'})
        self.assertEqual(response.status_code, 200, response.text)
        migrated = next(item for item in response.json()['processFlowInstances'] if item['id'] == self.source['id'])
        self.assertEqual(migrated['revision'], 1)
        self.assertEqual(instance_flow_configuration(migrated), instance_configuration(legacy))
        self.assertEqual(migrated['stepConfigurations']['rdl_build'], dict(recipes=[], activeRecipeId=None))
        self.assertEqual(migrated['name'], self.source['name'])

    def test_zip_repairs_missing_active_but_rejects_invalid_reference_atomically(self):
        from process_flow_api.fixture_export import build_fixture_archive
        instance = self.add(self.add(self.create()))
        fixtures = self.client.get('/api/bootstrap').json()
        imported = next(item for item in fixtures['processFlowInstances'] if item['id'] == instance['id'])
        imported['stepConfigurations']['mold_cap']['activeRecipeId'] = None
        response = self.client.post('/api/reset-from-zip', content=build_fixture_archive(fixtures), headers={'Content-Type': 'application/zip'})
        self.assertEqual(response.status_code, 200, response.text)
        restored = self.client.get(f"{self.base}/{instance['id']}").json()
        expected = copy.deepcopy(instance)
        expected['revision'] += 1
        self.assertEqual(restored, expected)
        imported['stepConfigurations']['mold_cap']['activeRecipeId'] = 'nonexistent'
        rejected = self.client.post('/api/reset-from-zip', content=build_fixture_archive(fixtures), headers={'Content-Type': 'application/zip'})
        self.assertEqual(rejected.status_code, 400, rejected.text)
        self.assertEqual(self.client.get(f"{self.base}/{instance['id']}").json(), restored)

    def test_non_finite_parameters_rejected_before_persistence(self):
        with self.assertRaises(ValueError):
            StepRecipeCreate(revision=1, name='Invalid', parameterValues={'thickness': float('inf')})


class InstanceMigrationTests(unittest.TestCase):
    def test_v14_repairs_only_missing_active_and_increments_revision_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'v14.sqlite3'
            store = SQLiteStore(path)
            store.seed(load_seed_fixtures())
            original = store.list_process_flow_instances()
            old = copy.deepcopy(original[0])
            keys = list(old['stepConfigurations'])[:2]
            for key in keys:
                old['stepConfigurations'][key]['activeRecipeId'] = None
            old['stepConfigurations']['empty_station'] = dict(recipes=[], activeRecipeId=None)
            expected = copy.deepcopy(old)
            for key in keys:
                expected['stepConfigurations'][key]['activeRecipeId'] = old['stepConfigurations'][key]['recipes'][0]['id']
            expected['revision'] += 1
            with store._connection:
                store._connection.execute('UPDATE process_flow_instances SET payload=? WHERE id=?', (json.dumps(old), old['id']))
                store._connection.execute("UPDATE schema_metadata SET value='14' WHERE key='databaseSchemaVersion'")
            dataset = store.dataset_id
            store.close()
            migrated = SQLiteStore(path)
            self.assertEqual(migrated.get_process_flow_instance(old['id']), expected)
            self.assertEqual(migrated.dataset_id, dataset)
            self.assertEqual(migrated._connection.execute("SELECT value FROM schema_metadata WHERE key='databaseSchemaVersion'").fetchone()[0], '15')
            for item in original[1:]:
                self.assertEqual(migrated.get_process_flow_instance(item['id']), item)
            migrated.close()
            again = SQLiteStore(path)
            self.assertEqual(again.get_process_flow_instance(old['id']), expected)
            again.close()

    def test_failed_v15_migration_rolls_back_repairs_and_marker(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'v14-rollback.sqlite3'
            store = SQLiteStore(path)
            store.seed(load_seed_fixtures())
            old = store.list_process_flow_instances()[0]
            next(iter(old['stepConfigurations'].values()))['activeRecipeId'] = None
            with store._connection:
                store._connection.execute('UPDATE process_flow_instances SET payload=? WHERE id=?', (json.dumps(old), old['id']))
                store._connection.execute("UPDATE schema_metadata SET value='14' WHERE key='databaseSchemaVersion'")
            store.close()
            original = SQLiteStore._migrate_v14_to_v15
            def fail_after_repair(current):
                original(current)
                raise ValueError('repair interrupted')
            with mock.patch.object(SQLiteStore, '_migrate_v14_to_v15', new=fail_after_repair):
                with self.assertRaisesRegex(ValueError, 'repair interrupted'):
                    SQLiteStore(path)
            with sqlite3.connect(path) as connection:
                self.assertEqual(connection.execute("SELECT value FROM schema_metadata WHERE key='databaseSchemaVersion'").fetchone()[0], '14')
                payload = connection.execute('SELECT payload FROM process_flow_instances WHERE id=?', (old['id'],)).fetchone()[0]
                self.assertEqual(json.loads(payload), old)

    def test_v15_invalid_active_reference_rolls_back_other_repairs(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'v14-invalid.sqlite3'
            store = SQLiteStore(path)
            store.seed(load_seed_fixtures())
            old = store.list_process_flow_instances()[:2]
            next(iter(old[0]['stepConfigurations'].values()))['activeRecipeId'] = None
            next(iter(old[1]['stepConfigurations'].values()))['activeRecipeId'] = 'invalid-reference'
            with store._connection:
                for instance in old:
                    store._connection.execute('UPDATE process_flow_instances SET payload=? WHERE id=?', (json.dumps(instance), instance['id']))
                store._connection.execute("UPDATE schema_metadata SET value='14' WHERE key='databaseSchemaVersion'")
            store.close()
            with self.assertRaisesRegex(ValueError, 'Active recipe must belong'):
                SQLiteStore(path)
            with sqlite3.connect(path) as connection:
                self.assertEqual(connection.execute("SELECT value FROM schema_metadata WHERE key='databaseSchemaVersion'").fetchone()[0], '14')
                for instance in old:
                    payload = connection.execute('SELECT payload FROM process_flow_instances WHERE id=?', (instance['id'],)).fetchone()[0]
                    self.assertEqual(json.loads(payload), instance)

    def test_failed_v14_migration_rolls_back_payloads_table_removal_and_marker(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'rollback.sqlite3'
            store = SQLiteStore(path)
            fixtures = load_seed_fixtures()
            store.seed(fixtures)
            old = copy.deepcopy(fixtures['processFlowInstances'][0])
            old.pop('revision')
            old['stepConfigurations'] = instance_configuration(old)['stepConfigurations']
            with store._connection:
                store._connection.execute('UPDATE process_flow_instances SET payload=? WHERE id=?', (json.dumps(old), old['id']))
                store._connection.execute("UPDATE schema_metadata SET value='13' WHERE key='databaseSchemaVersion'")
                store._connection.execute('CREATE TABLE process_flow_instance_drafts (id TEXT PRIMARY KEY, payload TEXT)')
                store._connection.execute("INSERT INTO process_flow_instance_drafts VALUES ('draft','{}')")
            store.close()
            original = SQLiteStore._migrate_v13_to_v14
            def fail_after_conversion(current):
                original(current)
                raise ValueError('migration interrupted')
            with mock.patch.object(SQLiteStore, '_migrate_v13_to_v14', new=fail_after_conversion):
                with self.assertRaisesRegex(ValueError, 'migration interrupted'):
                    SQLiteStore(path)
            with sqlite3.connect(path) as connection:
                self.assertEqual(connection.execute("SELECT value FROM schema_metadata WHERE key='databaseSchemaVersion'").fetchone()[0], '13')
                self.assertEqual(connection.execute('SELECT COUNT(*) FROM process_flow_instance_drafts').fetchone()[0], 1)
                payload = connection.execute('SELECT payload FROM process_flow_instances WHERE id=?', (old['id'],)).fetchone()[0]
                self.assertEqual(json.loads(payload), old)

    def test_v13_migrates_in_place_and_drops_instance_drafts_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'legacy.sqlite3'
            store = SQLiteStore(path)
            fixtures = load_seed_fixtures()
            store.seed(fixtures)
            old = {key: value for key, value in fixtures['processFlowInstances'][0].items() if key != 'revision'}
            old['stepConfigurations'] = instance_configuration(old)['stepConfigurations']
            with store._connection:
                store._connection.execute('UPDATE process_flow_instances SET payload=? WHERE id=?', (json.dumps(old), old['id']))
                store._connection.execute("UPDATE schema_metadata SET value='13' WHERE key='databaseSchemaVersion'")
                store._connection.execute('CREATE TABLE process_flow_instance_drafts (id TEXT PRIMARY KEY, payload TEXT)')
                store._connection.execute("INSERT INTO process_flow_instance_drafts VALUES ('draft','{}')")
            dataset = store.dataset_id
            store.close()
            reopened = SQLiteStore(path)
            migrated = reopened.get_process_flow_instance(old['id'])
            self.assertEqual(migrated['revision'], 1)
            self.assertEqual(instance_flow_configuration(migrated)['stepConfigurations'], old['stepConfigurations'])
            self.assertEqual(migrated['inputBindings'], old['inputBindings'])
            self.assertEqual(migrated['name'], old['name'])
            self.assertEqual(reopened.dataset_id, dataset)
            self.assertFalse(reopened._table_exists('process_flow_instance_drafts'))
            self.assertTrue(reopened._table_exists('process_flow_template_drafts'))
            reopened.close()
            again = SQLiteStore(path)
            self.assertEqual(again.get_process_flow_instance(old['id']), migrated)
            again.close()
