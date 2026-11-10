#!/bin/sh
# Baja con curl lo que hizo una tarea de Tripo, a partir de su JSON guardado (la descarga de
# urllib se colgaba). Uso: tools/tripo_bajar.sh TAREA.json
json="$1"; dir=$(dirname "$json"); task=$(basename "$json" .json)
python3 -c "
import json,sys
o=json.load(open(sys.argv[1]))['output']
for k,v in o.items():
    if isinstance(v,str) and v.startswith('http'): print(k, v)" "$json" | while read -r name url; do
  ext=$(printf %s "${url%%\?*}" | sed 's/.*\.//')
  curl -s --max-time 180 -o "$dir/${task}_${name}.${ext}" "$url" && echo "$dir/${task}_${name}.${ext}"
done
