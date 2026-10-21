#!/usr/bin/env bash
# The library pipeline for every video without a recipe: Gemini recipe (hook + demo steps), then the hook / demo cut.
# Run detached:  setsid nohup bash scripts/curation/pipeline.sh >> .data/curation/pipeline.log 2>&1 &
cd /home/farhan/mavya-video
echo "=== pipeline start $(date -Is)"
python3 -u scripts/curation/recipe.py
python3 -u scripts/curation/split.py
echo "=== pipeline end $(date -Is)"
