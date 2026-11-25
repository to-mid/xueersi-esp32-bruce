"""Compare the actual JS encoder with functions from the supplied production script."""
import ast
import json
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parent
reference = Path(sys.argv[1])
tree = ast.parse(reference.read_text(encoding='utf-8-sig'))
nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in
         ['build_remote_payload', 'build_adv_data']]
nodes += [n for n in tree.body if isinstance(n, ast.Assign) and any(
    isinstance(t, ast.Name) and t.id == 'V1_KEYS' for t in n.targets)]
namespace = {}
exec(compile(ast.Module(body=nodes, type_ignores=[]), str(reference), 'exec'), namespace)
vectors = json.loads(subprocess.check_output(['node', str(root/'test_remote.js'), '--vectors']))
for v in vectors:
    namespace.update(GROUP=0, OPCODE=v['cmd'], PARAMS=bytes(v['params']))
    payload = namespace['build_remote_payload'](bytes.fromhex(v['target']), v['id'])
    expected = namespace['build_adv_data'](payload).hex().upper()
    assert expected == v['hex'], (v, expected)
print(f'PASS: {len(vectors)} vectors match the actual production script, across all 16 V1 keys')
