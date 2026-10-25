"""Recipe selection shared by graph dependency analysis and compilation."""
from collections.abc import Mapping


def selected_recipe(step_configuration, *, required=False, step_ref_id=""):
    if not isinstance(step_configuration, Mapping):
        raise ValueError(f"Step {step_ref_id} configuration must be an object")
    candidates = step_configuration.get("recipeCandidates", [])
    if not isinstance(candidates, list):
        raise ValueError(f"Step {step_ref_id} recipeCandidates must be an array")
    if set(step_configuration) - {"recipeCandidates", "selectedRecipeId"}:
        raise ValueError(f"Step {step_ref_id} contains unsupported configuration fields")
    ids = set()
    for candidate in candidates:
        if not isinstance(candidate, Mapping):
            raise ValueError(f"Step {step_ref_id} recipe must be an object")
        rid = candidate.get("recipeId")
        if not isinstance(rid, str) or not rid.strip() or rid in ids:
            raise ValueError(f"Step {step_ref_id} has an invalid or duplicate recipeId")
        ids.add(rid)
        if not isinstance(candidate.get("parameterValues", {}), Mapping):
            raise ValueError(f"Step {step_ref_id} recipe parameterValues must be an object")
    selected = step_configuration.get("selectedRecipeId")
    if selected is not None and selected not in ids:
        raise ValueError(f"Step {step_ref_id} selectedRecipeId does not reference a candidate")
    if selected is None:
        if required:
            raise ValueError(f"Step {step_ref_id} requires a selected recipe")
        return None
    return next(recipe for recipe in candidates if recipe["recipeId"] == selected)


def selected_parameter_values(step_configuration, *, required=False, step_ref_id=""):
    recipe = selected_recipe(step_configuration, required=required, step_ref_id=step_ref_id)
    return recipe.get("parameterValues", {}) if recipe is not None else {}
