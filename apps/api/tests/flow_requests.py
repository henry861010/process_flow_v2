"""Canonical test fixtures; no runtime compatibility or legacy payload adapters."""
from copy import deepcopy


def flow_create_payload(flow):
    return {key: deepcopy(value) for key, value in flow.items() if key not in ('id', 'revision')}


def fixture_flow(bootstrap, id_='flow_inst_aaa_demo_hbm4_alpha'):
    return deepcopy(next(flow for flow in bootstrap['processFlows'] if flow['id'] == id_))


def selected_values(flow, ref):
    config = flow['configuration']['stepConfigurations'][ref]
    return next(recipe['parameterValues'] for recipe in config['recipeCandidates'] if recipe['recipeId'] == config['selectedRecipeId'])
