from pathlib import Path
import os, subprocess, json
root=Path(__file__).resolve().parent
source=root/'controller.mjs';original=source.read_text()
mutant=original.replace("actionable(){return this.rows().filter(r=>r.kind!=='sender');}","actionable(){return this.rows().filter(r=>r.depth===0&&r.kind!=='sender');}")
assert mutant != original
try:
 source.write_text(mutant)
 result=subprocess.run([os.environ.get('NODE_BINARY','node'),'--test',str(root/'controller.test.mjs')],capture_output=True,text=True)
 assert result.returncode != 0, 'Regression mutation unexpectedly passed'
 summary=[line for line in result.stdout.splitlines() if line.startswith('# pass ') or line.startswith('# fail ')]
 print('Ungrouped-only action model rejected:', ', '.join(summary))
 (root.parent/'mutation-results.json').write_text(json.dumps({'mutation':'Exclude expanded group members from action/navigation model','rejected':True,'summary':summary},indent=2))
finally:
 source.write_text(original)
