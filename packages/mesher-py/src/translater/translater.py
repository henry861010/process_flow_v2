def translater(geometry_entity):
    structure_format = geometry_entity.get("structureFormat", "")
    version = geometry_entity.get("version", "")
    
    if structure_format == "standard" and version == "v1.0.0":
        from translater_standard_v1 import Translater