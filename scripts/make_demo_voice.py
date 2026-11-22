"""Run: python scripts/make_demo_voice.py (needs OPENAI_API_KEY in .env, costs a few cents). Rewrites the mp3 files and demoManifest.json.

Generate the demo voice-over with the OpenAI speech API. Reads the key from the repo .env without printing it.
Outputs mp3 files + a manifest with exact durations into the repo (frontend/public/audio/demo, frontend/src/lib/demoManifest.json)."""
import json, os, sys, urllib.request, urllib.error

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
env = {}
for line in open(os.path.join(REPO, ".env"), encoding="utf-8-sig"):
    line = line.rstrip("\r\n")
    if "=" in line and not line.lstrip().startswith("#"):
        k, v = line.split("=", 1); env[k.strip()] = v
KEY = env["OPENAI_API_KEY"]

VOICE = os.environ.get("DEMO_VOICE", "coral")
MODEL = os.environ.get("DEMO_TTS_MODEL", "gpt-4o-mini-tts")
INSTR = ("You are the narrator of a polished product demo. Speak clearly and warmly at a steady, confident pace, "
         "like a friendly founder walking a customer through the product. Short pauses between sentences. Do not rush.")

# id, spotlight selector, sheet tab (or None), short caption, narration
SCENES = [
    ("problem", '[data-demo="problem"]', None, "The problem",
     "Sunday, eight p.m., the trucks leave Hamburg with Grand Heist 6. Soony's sheet says the game cards are fine. "
     "Our agent read every file and found six thousand eight hundred Standard copies short."),
    ("parts", '[data-demo="parts"]', None, "What is short",
     "Every copy is a kit of parts. The Collector's box adds a steel case, art book, poster, statue and four lid magnets. "
     "Red chips mark the parts that are short, shown with the real pictures from the brief."),
    ("agent", '[data-demo="agent"]', 'agent', "The agent at work",
     "The agent starts by itself. It reads the records, finds conflicts and a supplier hold, compares transport, checks the approval policy and drafts the messages. "
     "It can read, compute and draft, but it can never send, pay or book."),
    ("map", '[data-demo="map"]', None, "The supply network",
     "Here is the network: suppliers in Korea, China, India, Poland and the US. Air is solid, sea is dashed. "
     "Red markers will miss Sunday."),
    ("transport", '[data-demo="transport"]', None, "Transport options",
     "For the game cards, no transport mode makes the deadline. Air is four days late. Costs are labelled estimates. So a faster flight is not the answer."),
    ("decision", '[data-demo="decision"]', None, "The decision",
     "The answer is Boise: thirty six thousand cards are packed and on hold, because our order and their agreement disagree on delivery terms. "
     "That is five times the gap. The approver is Doctor Maren Vogt."),
    ("approval", '[data-demo="decision"]', None, "Human in charge",
     "A named person approves, in two steps. The app never sends email: a person sends it from their own mailbox, "
     "and the reply comes back as a file for review."),
    ("tracking", '[data-demo="tracking"]', None, "Launch tracking",
     "Launch tracking shows the workflow like a parcel: data in, problem found, agent plan, approval, sent, reply. "
     "Right now it waits for your approval."),
    ("close", '[data-demo="problem"]', None, "Launch Control",
     "Launch Control reads the mess, finds what breaks, and keeps a human in charge. It works for any launch with a fixed date."),
]

def speak(text, fmt):
    body = {"model": MODEL, "voice": VOICE, "input": text, "response_format": fmt}
    if MODEL.startswith("gpt-4o"):
        body["instructions"] = INSTR
    req = urllib.request.Request("https://api.openai.com/v1/audio/speech", data=json.dumps(body).encode(),
                                 headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
    return urllib.request.urlopen(req, timeout=120).read()

out_dir = os.path.join(REPO, "frontend", "public", "audio", "demo")
os.makedirs(out_dir, exist_ok=True)
manifest = []
total = 0.0
for i, (sid, sel, tab, cap, text) in enumerate(SCENES, 1):
    try:
        mp3 = speak(text, "mp3"); wav = speak(text, "wav")
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, e.read().decode()[:300]); sys.exit(1)
    secs = (len(wav) - 44) / 48000.0  # 24 kHz, 16-bit, mono PCM
    total += secs
    name = f"{i:02d}-{sid}.mp3"
    open(os.path.join(out_dir, name), "wb").write(mp3)
    manifest.append({"id": sid, "selector": sel, "sheetTab": tab, "caption": cap, "text": text, "file": f"/audio/demo/{name}", "ms": round(secs * 1000)})
    print(f"{name}: {secs:5.1f}s  ({len(text.split())} words, {len(mp3)//1024} KB)")
print(f"TOTAL narration: {total:.1f}s  | with 0.5 s gaps: {total + 0.5*len(SCENES):.1f}s | voice={VOICE} model={MODEL}")
json.dump({"voice": VOICE, "model": MODEL, "total_ms": round(total * 1000), "scenes": manifest}, open(os.path.join(REPO, "frontend", "src", "lib", "demoManifest.json"), "w", encoding="utf-8"), indent=2, ensure_ascii=False)
