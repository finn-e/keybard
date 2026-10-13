"""Decode bounded firmware definitions and select populated Svalboard positions."""
import json
import lzma
from .geometry import KEYS, keys_for_positions

MAX_DEFINITION_BYTES = 1024 * 1024


def decode_definition(payload):
    try:
        decoder = lzma.LZMADecompressor(format=lzma.FORMAT_ALONE, memlimit=128 * 1024 * 1024)
        raw = decoder.decompress(payload, max_length=MAX_DEFINITION_BYTES + 1)
        if len(raw) > MAX_DEFINITION_BYTES or not decoder.eof or decoder.unused_data:
            raise ValueError("Incomplete or oversized board definition")
        definition = json.loads(raw)
    except (lzma.LZMAError, UnicodeError, json.JSONDecodeError, RecursionError) as exc:
        raise ValueError("Invalid compressed board definition") from exc
    if not isinstance(definition, dict) or definition.get("matrix") != {"rows": 10, "cols": 6}:
        raise ValueError("Expected a Svalboard 10×6 matrix definition")
    return definition


def keyless_instances(definition):
    """Indices of fragment instances that add no keys, e.g. a pointing module slot.

    Their 0x18 byte reads 0xFF until the module probe settles, so they never
    affect the layout and are left out of any before/after comparison.
    """
    instances = (definition.get("composition") or {}).get("instances")
    if not isinstance(instances, list):
        return frozenset()
    keyless = set()
    for index, instance in enumerate(instances):
        if not isinstance(instance, dict):
            continue
        options = [instance] if "fragment" in instance else instance.get("fragment_options")
        if (isinstance(options, list) and options
                and all(isinstance(o, dict) and o.get("matrix_map") == [] for o in options)):
            keyless.add(index)
    return frozenset(keyless)


def geometry_from_definition(definition, hardware=(), selections=()):
    if "fragment_schema_version" not in definition and "fragments" not in definition:
        # Older definitions lack fragments. This remains explicitly a schematic.
        return KEYS
    if definition.get("fragment_schema_version") != 1:
        raise ValueError("Unsupported Svalboard fragment schema")
    fragments = definition.get("fragments")
    composition = definition.get("composition")
    if not isinstance(fragments, dict) or not isinstance(composition, dict):
        raise ValueError("Invalid fragment definition")
    instances = composition.get("instances")
    if not isinstance(instances, list) or not 1 <= len(instances) <= 21:
        raise ValueError("Invalid fragment instance count")
    if len(hardware) != len(instances) or len(selections) != len(instances):
        raise ValueError("Fragment state does not match board definition")
    positions = set()
    keyless = keyless_instances(definition)
    for index, instance in enumerate(instances):
        if not isinstance(instance, dict):
            raise ValueError("Invalid fragment instance")
        if index in keyless:
            continue  # no keys, so neither its hardware byte nor a stray selection matters
        option = instance
        if "fragment" not in instance:
            options = instance.get("fragment_options")
            if not isinstance(options, list) or not options or not all(isinstance(o, dict) and isinstance(o.get("fragment"), str) for o in options):
                raise ValueError("Invalid fragment options")
            detected = next((o for o in options if isinstance(fragments.get(o.get("fragment")), dict)
                             and fragments[o["fragment"]].get("id") == hardware[index]
                             and hardware[index] != 255), None)
            if detected is not None and instance.get("allow_override") is False:
                option = detected
            elif selections[index] != 255:
                if selections[index] >= len(options):
                    raise ValueError("Invalid saved fragment selection")
                option = options[selections[index]]  # EEPROM stores option index, not fragment ID.
            elif detected is not None:
                option = detected
            else:
                option = next((o for o in options if o.get("default") is True), options[0])
        name = option.get("fragment")
        if not isinstance(name, str) or not isinstance(fragments.get(name), dict):
            raise ValueError("Unknown selected fragment")
        matrix_map = option.get("matrix_map")
        if not isinstance(matrix_map, list):  # [] is a zero-key fragment, e.g. a pointing module
            raise ValueError("Missing selected fragment matrix map")
        for position in matrix_map:
            if (not isinstance(position, list) or len(position) != 2 or
                any(type(v) is not int for v in position) or
                not (0 <= position[0] < 10 and 0 <= position[1] < 6)):
                raise ValueError("Invalid fragment matrix position")
            pos = tuple(position)
            if pos in positions:
                raise ValueError("Overlapping fragment matrix positions")
            positions.add(pos)
    return keys_for_positions(positions)
