import copy
import sqlite3

import pytest
from fastapi.testclient import TestClient

from process_flow_api.main import create_app
from process_flow_api.models import DataFieldWrite, DataFieldAction, RecipeDataWrite
from process_flow_api.data_fields import write_field, review_field, act_on_field, save_recipe_data
from process_flow_api.repository import SQLiteStore, ResourceConflictError


@pytest.fixture
def store():
    db = SQLiteStore(':memory:')
    db.insert_process_step_template({'id': 'step', 'name': 'Step', 'category': 'test', 'owner': 'RD',
        'version': '1', 'parameterDefinitions': []})
    for id_ in ('one', 'two'):
        db.insert_process_flow({'id': id_, 'name': id_, 'version': '1', 'owner': 'RD', 'revision': 1,
            'definition': {'stepRefs': [{'stepRefId': 's', 'processStepTemplateId': 'step'}]},
            'configuration': {'stepConfigurations': {'s': {'recipeCandidates': [
                {'recipeId': 'r', 'name': 'Recipe', 'parameterValues': {}},
                {'recipeId': 'unused', 'name': 'Other', 'parameterValues': {}}], 'selectedRecipeId': 'r'}}}})
    yield db
    db.close()


def add(store, **overrides):
    body = dict(name='Power', valueType='float', reason='Machine setting', min=0, max=500,
                actor='Engineer', revision=store.get_process_step_template('step').get('dataFieldsRevision', 1))
    body.update(overrides)
    return write_field(store, 'step', DataFieldWrite(**body))['dataFieldDefinitions'][-1]


def save(store, field, value, *, id_='one', recipe='r', kind='flow'):
    doc = (store.get_process_flow if kind == 'flow' else store.get_flow_draft)(id_)
    return save_recipe_data(store, kind, id_, 's', recipe, RecipeDataWrite(
        revision=doc['revision'], dataFieldsRevision=store.get_process_step_template('step')['dataFieldsRevision'],
        dataValues={field['id']: value}))


def action(store, field, **kw):
    return act_on_field(store, 'step', field['id'], DataFieldAction(
        actor='Reviewer', reviewToken=review_field(store, 'step', field['id'])['reviewToken']), **kw)


def draft(store):
    flow = store.get_process_flow('one')
    return store.insert_flow_draft({'id': 'draft', 'name': 'Draft', 'user': 'RD', 'revision': 1,
        'createdAt': 'now', 'updatedAt': 'now', 'state': {'nodes': [
            {'kind': 'processStep', 'stepRef': flow['definition']['stepRefs'][0]}],
            'configuration': copy.deepcopy(flow['configuration'])}})


def test_shared_field_soft_validation_approval_and_formal_validation(store):
    original = store.get_process_flow('two')
    field = add(store)
    assert store.get_process_flow('two') == original
    save(store, field, 'approximately 150', recipe='unused')
    review = review_field(store, 'step', field['id'])
    assert review['issueCount'] == 1 and review['valueCount'] == 1
    with pytest.raises(ResourceConflictError):
        action(store, field)
    save(store, field, 0, recipe='unused')
    action(store, field)
    assert store.get_process_step_template('step')['dataFieldDefinitions'][0]['status'] == 'formal'
    with pytest.raises(ValueError):
        save(store, field, 501)
    with pytest.raises(ResourceConflictError):
        action(store, field, remove=True)
    assert store.get_process_flow('one')['configuration']['stepConfigurations']['s']['recipeCandidates'][1]['dataValues'][field['id']] == 0


def test_stale_review_and_delete_all_candidates_and_drafts(store):
    field = add(store)
    save(store, field, 10)
    draft(store)
    before = review_field(store, 'step', field['id'])
    save(store, field, 20, recipe='unused')
    with pytest.raises(ResourceConflictError):
        act_on_field(store, 'step', field['id'], DataFieldAction(actor='RD', reviewToken=before['reviewToken']), remove=True)
    unaffected = store.get_process_flow('two')
    old = store.get_process_flow('one')
    action(store, field, remove=True)
    assert store.get_process_flow('two') == unaffected
    assert store.get_process_flow('one')['revision'] == old['revision'] + 1
    for resource in (store.get_process_flow('one'), store.get_flow_draft('draft')['state']):
        assert all(field['id'] not in r.get('dataValues', {}) for r in resource['configuration']['stepConfigurations']['s']['recipeCandidates'])
    with pytest.raises(ResourceConflictError):
        store.update_process_flow(old, old['revision'])
    with pytest.raises(ResourceConflictError):
        save_recipe_data(store, 'flow', 'two', 's', 'r', RecipeDataWrite(revision=1, dataFieldsRevision=3, dataValues={field['id']: 3}))


def test_remove_rollback(store, monkeypatch):
    field = add(store)
    save(store, field, 10)
    draft(store)
    old_flow, old_draft = store.get_process_flow('one'), store.get_flow_draft('draft')
    def fail(_):
        raise RuntimeError('injected failure')
    monkeypatch.setattr(store, '_upsert_process_step_template_in_transaction', fail)
    with pytest.raises(RuntimeError):
        action(store, field, remove=True)
    assert store.get_process_flow('one') == old_flow
    assert store.get_flow_draft('draft') == old_draft
    assert review_field(store, 'step', field['id'])['valueCount'] == 2


def test_approval_rollback_and_serialized_data_write(store, tmp_path, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    field = add(store)
    snapshot = store.get_process_step_template('step')
    upsert = store._upsert_process_step_template_in_transaction
    def fail_after_write(payload):
        upsert(payload)
        raise RuntimeError('injected failure after approval write')
    monkeypatch.setattr(store, '_upsert_process_step_template_in_transaction', fail_after_write)
    with pytest.raises(RuntimeError):
        action(store, field)
    assert store.get_process_step_template('step') == snapshot

    # Separate SQLite connections must serialize approval and data writes.
    path = tmp_path / 'concurrent.sqlite3'
    with sqlite3.connect(path) as connection:
        store._connection.backup(connection)
    reviewer, writer = SQLiteStore(path), SQLiteStore(path)
    approved_but_uncommitted, release_approval, writer_started = Event(), Event(), Event()
    original = reviewer._upsert_process_step_template_in_transaction
    def pause_after_write(payload):
        original(payload)
        approved_but_uncommitted.set()
        assert release_approval.wait(5)
    monkeypatch.setattr(reviewer, '_upsert_process_step_template_in_transaction', pause_after_write)
    def write_invalid():
        writer_started.set()
        # Even knowing the next field revision cannot bypass formal validation.
        return save_recipe_data(writer, 'flow', 'one', 's', 'r', RecipeDataWrite(
            revision=1, dataFieldsRevision=3, dataValues={field['id']: 'invalid'}))
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            approval = pool.submit(action, reviewer, field)
            try:
                assert approved_but_uncommitted.wait(5)
                saving = pool.submit(write_invalid)
                assert writer_started.wait(5)
            finally:
                release_approval.set()
            approval.result()
            with pytest.raises(ValueError, match='Expected a finite number'):
                saving.result()
        assert reviewer.get_process_flow('one')['revision'] == 1
        assert review_field(reviewer, 'step', field['id'])['valueCount'] == 0
    finally:
        reviewer.close()
        writer.close()


def test_whole_document_save_preserves_values_and_commit(store):
    field = add(store, name='Flag', valueType='boolean', min=None, max=None)
    save(store, field, False)
    flow = store.get_process_flow('one')
    flow['configuration']['stepConfigurations']['s']['recipeCandidates'][0].pop('dataValues')
    saved = store.update_process_flow(flow, flow['revision'])
    assert saved['configuration']['stepConfigurations']['s']['recipeCandidates'][0]['dataValues'][field['id']] is False
    d = draft(store)
    save(store, field, True, id_='draft', kind='draft')
    saved['id'] = 'committed'; saved['name'] = 'Committed'; saved['revision'] = 1
    store.commit_flow_draft('draft', d['revision'] + 1, saved)
    assert store.get_process_flow('committed')['configuration']['stepConfigurations']['s']['recipeCandidates'][0]['dataValues'][field['id']] is True


def test_field_revision_duplicate_names_and_primitive_values(store):
    field = add(store)
    with pytest.raises(ResourceConflictError):
        add(store, name=' power ')
    with pytest.raises(ValueError):
        save(store, field, {'raw': 'text'})
    with pytest.raises(ValueError):
        save(store, field, float('inf'))
    with pytest.raises(ValueError):
        save(store, field, 10 ** 400)
    save(store, field, '')
    assert review_field(store, 'step', field['id'])['valueCount'] == 0
    with pytest.raises(ResourceConflictError):
        write_field(store, 'step', DataFieldWrite(name='Other', valueType='string', reason='Reason', actor='RD', revision=1))


def test_schema_16_upgrade_backup_and_no_payload_rewrite(tmp_path):
    path = tmp_path / 'db.sqlite3'
    db = SQLiteStore(path)
    db._connection.execute("UPDATE schema_metadata SET value='16' WHERE key='databaseSchemaVersion'")
    db._connection.commit(); db.close()
    db = SQLiteStore(path)
    assert db._connection.execute("SELECT value FROM schema_metadata WHERE key='databaseSchemaVersion'").fetchone()[0] == '17'
    assert list(tmp_path.glob('*.pre-v17-*.bak'))
    with sqlite3.connect(db.migration_backup_path) as backup:
        assert backup.execute("SELECT value FROM schema_metadata WHERE key='databaseSchemaVersion'").fetchone()[0] == '16'
    db.close()


def test_api_collection_does_not_change_execution_parameters(tmp_path):
    app = create_app(db_path=tmp_path / 'api.sqlite3')
    with TestClient(app) as client:
        flow = client.get('/api/bootstrap').json()['processFlows'][0]
        ref = flow['definition']['stepRefs'][0]
        sid, tid = ref['stepRefId'], ref['processStepTemplateId']
        recipe = flow['configuration']['stepConfigurations'][sid]['recipeCandidates'][0]
        response = client.post(f'/api/process-step-templates/{tid}/data-fields', json={
            'revision': 1, 'actor': 'Engineer', 'name': 'Notes', 'valueType': 'string', 'reason': 'Record setup'})
        assert response.status_code == 201, response.text
        template = response.json(); field = template['dataFieldDefinitions'][0]
        response = client.put(f"/api/process-flows/{flow['id']}/steps/{sid}/recipes/{recipe['recipeId']}/data-values", json={
            'revision': flow['revision'], 'dataFieldsRevision': 2, 'dataValues': {field['id']: 'Observed'}})
        assert response.status_code == 200, response.text
        saved = response.json()
        assert saved['configuration']['stepConfigurations'][sid]['recipeCandidates'][0]['parameterValues'] == recipe['parameterValues']
        reviews = client.get('/api/data-field-reviews').json()
        assert reviews[0]['valueCount'] == 1
        # Ordinary template updates cannot promote the field.
        template['dataFieldDefinitions'][0]['status'] = 'formal'
        assert client.put(f'/api/process-step-templates/{tid}', json=template).status_code == 409
    app.state.store.close()


def test_all_formal_entrypoints_and_draft_invalid_values(store):
    field = add(store)
    draft(store)
    save(store, field, 'unconfirmed', id_='draft', kind='draft')
    assert review_field(store, 'step', field['id'])['draftCount'] == 1
    with pytest.raises(ResourceConflictError):
        action(store, field)
    save(store, field, 10, id_='draft', kind='draft')
    action(store, field)
    with pytest.raises(ValueError):
        save(store, field, 'bad', id_='draft', kind='draft')
    new = copy.deepcopy(store.get_process_flow('two'))
    new.update(id='bad-copy', name='Bad copy')
    new['configuration']['stepConfigurations']['s']['recipeCandidates'][0]['dataValues'] = {field['id']: 999}
    with pytest.raises(ValueError):
        store.insert_process_flow(new)
    assert store.get_process_flow('bad-copy') is None


def test_edit_rules_rechecks_values_without_coercion_and_stales_review(store):
    field = add(store)
    save(store, field, 100)
    before = review_field(store, 'step', field['id'])
    write_field(store, 'step', DataFieldWrite(name='Power', valueType='float', max=50, unit='kW',
                reason='Reviewed specification', actor='Reviewer', revision=2), field['id'])
    review = review_field(store, 'step', field['id'])
    assert review['usages'][0]['value'] == 100 and review['issueCount'] == 1
    with pytest.raises(ResourceConflictError):
        act_on_field(store, 'step', field['id'], DataFieldAction(actor='Reviewer', reviewToken=before['reviewToken']))


def test_stale_template_metadata_cannot_undo_field_changes(store):
    stale = store.get_process_step_template('step')
    field = add(store)
    stale['owner'] = 'New owner'
    saved = store.update_process_step_template(stale)
    assert saved['owner'] == 'New owner'
    assert saved['dataFieldDefinitions'][0]['id'] == field['id']
    action(store, field)
    saved = store.update_process_step_template(saved)
    assert saved['dataFieldDefinitions'][0]['status'] == 'formal'
    assert saved['dataFieldsRevision'] == 3


def test_api_fixture_roundtrip_and_kernel_inputs_are_unchanged(tmp_path):
    from process_flow_kernel import FlowCompiler, InMemoryGeometryCatalog
    app = create_app(db_path=tmp_path / 'roundtrip.sqlite3')
    with TestClient(app) as client:
        original = client.get('/api/bootstrap').json()
        flow = next(f for f in original['processFlows'] if f['id'] == 'flow_inst_aaa_demo_hbm4_alpha')
        ref = flow['definition']['stepRefs'][0]
        sid, tid = ref['stepRefId'], ref['processStepTemplateId']
        recipe = flow['configuration']['stepConfigurations'][sid]['recipeCandidates'][0]
        compiler = FlowCompiler(InMemoryGeometryCatalog(original['geometries']))
        before = compiler.compile(flow['definition'], flow['configuration'], original['processStepTemplates'])
        created = client.post(f'/api/process-step-templates/{tid}/data-fields', json={
            'revision': 1, 'actor': 'Engineer', 'name': 'Flag', 'valueType': 'boolean', 'reason': 'Collection only'}).json()
        field = created['dataFieldDefinitions'][0]
        saved = client.put(f"/api/process-flows/{flow['id']}/steps/{sid}/recipes/{recipe['recipeId']}/data-values", json={
            'revision': flow['revision'], 'dataFieldsRevision': 2, 'dataValues': {field['id']: False}}).json()
        review = client.get(f'/api/process-step-templates/{tid}/data-fields/{field["id"]}/review').json()
        assert client.post(f'/api/process-step-templates/{tid}/data-fields/{field["id"]}/approve', json={
            'actor': 'Reviewer', 'reviewToken': review['reviewToken']}).status_code == 200
        current = client.get('/api/bootstrap').json()
        after = compiler.compile(saved['definition'], saved['configuration'], current['processStepTemplates'])
        assert [(s.raw_parameter_values, s.parameter_values) for s in before.steps] == [(s.raw_parameter_values, s.parameter_values) for s in after.steps]
        archive = client.get('/api/fixture-export').content
        response = client.post('/api/reset-from-zip', content=archive, headers={'Content-Type': 'application/zip'})
        assert response.status_code == 200, response.text
        restored = client.get(f"/api/process-flows/{flow['id']}").json()
        assert restored['configuration']['stepConfigurations'][sid]['recipeCandidates'][0]['dataValues'][field['id']] is False
        exported = client.get('/api/process-step-templates/export').json()
        assert client.post('/api/process-step-templates/import', json=exported).status_code == 200
        proposed_bypass = next(t for t in exported if t['id'] == tid)
        proposed_bypass['dataFieldDefinitions'] = []
        assert client.post('/api/process-step-templates/import', json=[proposed_bypass]).status_code == 409
    app.state.store.close()
