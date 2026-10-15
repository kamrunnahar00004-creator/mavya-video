D=/home/farhan/mavya-video/scripts/curation
# Full pipeline for every account the founder sends (queue in .data/curation/picks.json):
#   Meta: scan (50K+ views, downloadable only) -> import as pending -> covers -> files
#   Gemini: fit check (match/flag + style) -> finalize (delete flags, publish matches, cap 10/account)
#           -> summary -> polish (bold product, no dashes) -> tighten (2-3 lines)
# AI steps don't use the Meta API, so they run every round, even while Meta is rate-limiting.
ai_steps() {
  python3 -u -I "$D/fitcheck.py" | grep -E 'checking|DONE|OUT OF|DAILY'
  python3 -u -I "$D/finalize.py"
  python3 -u -I "$D/summarize.py" | grep -E 'summarizing|DONE'
  python3 -u -I "$D/polish.py" | grep -E 'polishing|DONE'
  python3 -u -I "$D/tighten.py" | grep -E 'tightening|DONE'
}
for i in $(seq 1 32); do
  out=$(python3 -I "$D/runqueue.py" "$D/add.py")
  echo "$out"
  python3 -I "$D/import_picks.py"
  if ! echo "$out" | grep -q 'RATE LIMITED'; then
    t=$(python3 -I "$D/thumbs.py"); echo "$t" | grep -E 'RATE|covers done'
    if ! echo "$t" | grep -q 'RATE LIMITED'; then
      f=$(python3 -I "$D/files.py"); echo "$f" | grep -E 'FILE|no file|RATE|DONE|more'
      python3 -I "$D/import_picks.py"
      if echo "$f" | grep -q 'DONE'; then
        ai_steps
        echo "PIPELINE DONE $(date)"
        exit 0
      fi
    fi
  fi
  ai_steps
  sleep 900
done
