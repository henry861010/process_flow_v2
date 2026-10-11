"""Build create requests from persisted fixture records without server-owned IDs."""


def template_create_payload(template):
    return {key: value for key, value in template.items() if key != "id"}


def instance_create_payload(instance, *, for_new_template=False):
    excluded = {"id", "processFlowTemplateId"} if for_new_template else {"id"}
    return {key: value for key, value in instance.items() if key not in excluded}
