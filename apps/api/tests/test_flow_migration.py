import copy
import hashlib
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from process_flow_api.repository import SQLiteStore
from process_flow_api.models import ProcessFlow, FlowDraft
from process_flow_api.flow_migration import canvas
from process_flow_kernel import FlowCompiler, GeometryKernel, InMemoryGeometryCatalog

FIXTURES = Path(__file__).parent / 'fixtures' / 'schema13'
# Captured with the unmodified schema-13 compiler/kernel at sourceCommit.
# Keep this baseline independent of the new compiler and migration implementation.
LEGACY_EXECUTION_DIGESTS = json.loads((FIXTURES / 'execution-digests.json').read_text())['instances']

def old_data():
    return {name.replace('-', '_'): json.loads((FIXTURES / f'{name}.json').read_text())
            for name in ('process-step-templates', 'process-flow-templates', 'process-flow-instances', 'geometries')}


def legacy_database(path, version=13, mutate=lambda data: None):
    data = old_data()
    template = data['process_flow_templates'][0]; instance = data['process_flow_instances'][0]
    metadata = {key: instance[key] for key in ('name', 'version', 'description', 'owner')}
    draft = {'schemaVersion': 1, 'id': 'template-draft', 'user': 'RD', 'name': 'Topology', 'revision': 7,
             'createdAt': '2025-01-01', 'updatedAt': '2025-02-03', 'state': {**canvas(template),
             'metadata': metadata, 'configuration': {key: copy.deepcopy(instance[key]) for key in ('inputBindings', 'stepConfigurations')}}}
    draft['state']['edges'] = []
    draft['state']['nodes'][0]['position'] = {'x': -52, 'y': 81}
    draft['state']['configuration']['stepConfigurations']['mold_cap']['parameterValues']['thickness'] = ''
    instance_draft = {**copy.deepcopy(draft), 'id': 'instance-draft', 'processFlowTemplateId': template['id']}
    instance_draft['state'] = {key: instance_draft['state'][key] for key in ('metadata', 'configuration')}
    if version >= 12:
        data['process_flow_template_drafts'] = [draft]
        data['process_flow_instance_drafts'] = [instance_draft]
    else:
        data['process_flow_workspaces'] = [{**{key: instance_draft[key] for key in ('id', 'name', 'revision', 'createdAt', 'updatedAt', 'processFlowTemplateId')},
                                           'status': 'draft', **instance_draft['state']['configuration']}]
    mutate(data)
    with sqlite3.connect(path) as db:
        db.execute('CREATE TABLE schema_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
        db.executemany('INSERT INTO schema_metadata VALUES (?, ?)', [('databaseSchemaVersion', str(version)), ('analyticsDatasetId', 'original-dataset')])
        for table, records in data.items():
            if table == 'process_step_templates':
                db.execute(f'CREATE TABLE {table} (id TEXT PRIMARY KEY, name TEXT, category TEXT, version TEXT, owner TEXT, payload TEXT)')
                for item in records:
                    db.execute(f'INSERT INTO {table} VALUES (?,?,?,?,?,?)', (item['id'], item['name'], item['category'], item['version'], item['owner'], json.dumps(item)))
            elif table == 'geometries':
                db.execute('CREATE TABLE geometries (id TEXT PRIMARY KEY, name TEXT, category TEXT, entity_type TEXT, dim TEXT, vendor TEXT, type1 TEXT, type2 TEXT, owner TEXT, payload TEXT)')
                for item in records:
                    db.execute('INSERT INTO geometries VALUES (?,?,?,?,?,?,?,?,?,?)', (item['id'], item['name'], item.get('category'), item['entityType'], item.get('dim', ''), item.get('vendor'), item.get('type1'), item.get('type2'), item.get('owner'), json.dumps(item)))
            else:
                db.execute(f'CREATE TABLE {table} (id TEXT PRIMARY KEY, payload TEXT NOT NULL)')
                for item in records: db.execute(f'INSERT INTO {table} VALUES (?, ?)', (item['id'], json.dumps(item)))
    return data


class FlowMigrationTests(unittest.TestCase):
    def test_schema_11_and_13_preserve_formal_values_and_all_drafts(self):
        for version in (11, 13):
            with self.subTest(version=version), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / 'legacy.sqlite3'; old = legacy_database(path, version)
                store = SQLiteStore(path)
                self.assertEqual(store.dataset_id, 'original-dataset')
                self.assertTrue(store.migration_backup_path.exists())
                with sqlite3.connect(store.migration_backup_path) as backup:
                    self.assertEqual(backup.execute("SELECT value FROM schema_metadata WHERE key='databaseSchemaVersion'").fetchone()[0], str(version))
                flows = {flow['id']: flow for flow in store.list_process_flows()}
                self.assertEqual(len(flows), 5)
                compiler = FlowCompiler(InMemoryGeometryCatalog(old['geometries']))
                for instance in old['process_flow_instances']:
                    migrated = flows[instance['id']]; ProcessFlow.model_validate(migrated)
                    self.assertEqual(migrated['origin'], {'flowId': instance['processFlowTemplateId'], 'revision': 1})
                    self.assertEqual(migrated['configuration']['inputBindings'], instance['inputBindings'])
                    plan = compiler.compile(migrated['definition'], migrated['configuration'], old['process_step_templates'])
                    for step in plan.steps:
                        self.assertEqual(step.raw_parameter_values, instance['stepConfigurations'][step.step_ref_id]['parameterValues'])
                    result = GeometryKernel().execute(plan)
                    payload = {'geometryStructure': result.geometry(), 'stepOutputs': result.step_outputs(),
                               'terminalStepRefIds': result.terminal_step_ref_ids()}
                    digest = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
                    self.assertEqual(digest, LEGACY_EXECUTION_DIGESTS[instance['id']])
                for template in old['process_flow_templates']:
                    for ref in template['stepRefs']:
                        if 'parameterDefaults' in ref:
                            self.assertEqual(flows[template['id']]['configuration']['stepConfigurations'][ref['stepRefId']]['recipeCandidates'][0]['parameterValues'], ref['parameterDefaults'])
                expected_count = 2 if version == 13 else 1
                self.assertEqual(len(store.list_flow_drafts()), expected_count)
                draft = store.get_flow_draft('instance-draft'); FlowDraft.model_validate(draft)
                self.assertEqual(draft['revision'], 7); self.assertEqual(draft['updatedAt'], '2025-02-03')
                self.assertEqual(draft['state']['configuration']['stepConfigurations']['mold_cap']['recipeCandidates'][0]['parameterValues']['thickness'], '')
                self.assertTrue(draft['state']['nodes']); self.assertTrue(draft['state']['edges'])
                if version == 13:
                    draft = store.get_flow_draft('template-draft')
                    self.assertEqual(draft['state']['edges'], [])
                    self.assertEqual(draft['state']['nodes'][0]['position'], {'x': -52, 'y': 81})
                before = store.list_process_flows(); store.close()
                reopened = SQLiteStore(path)
                self.assertEqual(reopened.list_process_flows(), before)
                self.assertFalse(hasattr(reopened, 'migration_backup_path')); reopened.close()
                self.assertEqual(len(list(Path(directory).glob('*.bak'))), 1)

    def test_preliminary_schema_8_and_9_upgrades_preserve_metadata_and_catalog(self):
        for version in (8, 9):
            def mutate(data):
                for geometry in data['geometries']:
                    geometry.pop('dim', None)
                    geometry['version'] = 'legacy-label'
                    geometry['description'] = '10 x 20 um — old description'
                if version == 8:
                    for flow in data['process_flow_instances']:
                        for key in ('version', 'owner', 'description'):
                            flow.pop(key, None)
            with self.subTest(version=version), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / 'old.sqlite3'
                old = legacy_database(path, version=version, mutate=mutate)
                store = SQLiteStore(path)
                try:
                    self.assertEqual(store.dataset_id, 'original-dataset')
                    self.assertEqual(len(store.list_geometries()), len(old['geometries']))
                    self.assertTrue(all(g['dim'] == '10 x 20 um' and 'version' not in g for g in store.list_geometries()))
                    for old_flow in old['process_flow_instances']:
                        flow = store.get_process_flow(old_flow['id'])
                        self.assertEqual(flow['version'], old_flow.get('version', 'V0.0.0'))
                        self.assertTrue(flow['owner'])
                    self.assertIsNotNone(store.get_flow_draft('instance-draft'))
                finally:
                    store.close()

    def test_embedded_bound_and_unbound_draft_geometry_become_catalog_records(self):
        def mutate(data):
            geometry = {key: value for key, value in data['geometries'][0].items() if key != 'id'}
            config = data['process_flow_template_drafts'][0]['state']['configuration']
            config['embeddedGeometries'] = {'bound': geometry, 'unbound': {**geometry, 'name': 'Unbound kept'}}
            config['inputBindings']['incoming_panel'] = {'kind': 'embedded', 'localId': 'bound'}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'legacy.sqlite3'; old = legacy_database(path, mutate=mutate)
            store = SQLiteStore(path)
            self.assertEqual(len(store.list_geometries()), len(old['geometries']) + 2)
            config = store.get_flow_draft('template-draft')['state']['configuration']
            self.assertNotIn('embeddedGeometries', config)
            binding = config['inputBindings']['incoming_panel']; self.assertEqual(binding['kind'], 'catalog')
            self.assertIsNotNone(store.get_geometry(binding['geometryId']))
            self.assertTrue(any(g['name'] == 'Unbound kept' for g in store.list_geometries()))
            store.close()

    def test_conflicts_missing_sources_and_invalid_embedded_abort_without_deleting_data(self):
        def same_id(data): data['process_flow_instances'][0]['id'] = data['process_flow_templates'][0]['id']
        def same_identity(data):
            data['process_flow_instances'][0].update({key: data['process_flow_templates'][0][key] for key in ('name', 'version')})
        def normalized_identity(data):
            same_identity(data)
            data['process_flow_instances'][0]['name'] += ' '
        def missing_source(data): data['process_flow_instances'][0]['processFlowTemplateId'] = 'missing'
        def invalid_embedded(data): data['process_flow_template_drafts'][0]['state']['configuration']['embeddedGeometries'] = {'bad': {'structure': {}}}
        def invalid_embedded_structure(data):
            geometry = copy.deepcopy(data['geometries'][0]); geometry.pop('id')
            geometry['structure']['root']['bodies'][0]['geometry']['thk'] = -1
            data['process_flow_template_drafts'][0]['state']['configuration']['embeddedGeometries'] = {'bad-shape': geometry}
        for mutate in (same_id, same_identity, normalized_identity, missing_source, invalid_embedded, invalid_embedded_structure):
            with self.subTest(case=mutate.__name__), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / 'legacy.sqlite3'; old = legacy_database(path, mutate=mutate)
                with self.assertRaises(ValueError): SQLiteStore(path)
                with sqlite3.connect(path) as db:
                    self.assertEqual(db.execute("SELECT value FROM schema_metadata WHERE key='databaseSchemaVersion'").fetchone()[0], '13')
                    self.assertEqual(db.execute('SELECT COUNT(*) FROM process_flow_instances').fetchone()[0], len(old['process_flow_instances']))
                    self.assertIsNone(db.execute("SELECT name FROM sqlite_master WHERE name='process_flows'").fetchone())

    def test_mid_transaction_failure_restores_tables_rows_and_marker(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'legacy.sqlite3'; legacy_database(path)
            with patch.object(SQLiteStore, '_set_schema_version', side_effect=RuntimeError('interrupted')):
                with self.assertRaisesRegex(RuntimeError, 'interrupted'): SQLiteStore(path)
            with sqlite3.connect(path) as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM process_flow_templates').fetchone()[0], 2)
                self.assertEqual(db.execute("SELECT value FROM schema_metadata WHERE key='databaseSchemaVersion'").fetchone()[0], '13')
                self.assertIsNone(db.execute("SELECT name FROM sqlite_master WHERE name='process_flows'").fetchone())
            store = SQLiteStore(path); self.assertEqual(len(store.list_process_flows()), 5); store.close()

    def test_unknown_and_experimental_versions_are_rejected_without_reset(self):
        for version in (7, 15, 99):
            with self.subTest(version=version), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / 'legacy.sqlite3'; legacy_database(path, version)
                with self.assertRaisesRegex(RuntimeError, 'Unsupported'): SQLiteStore(path)
                with sqlite3.connect(path) as db:
                    self.assertEqual(db.execute('SELECT COUNT(*) FROM process_flow_instances').fetchone()[0], 3)
