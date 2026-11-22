"""WARNING: the shipped demo audio was generated with ElevenLabs (voice Jack Anthony, model eleven_v4, via the ElevenLabs connector), NOT with this script.
Running this script REPLACES those files with OpenAI voices (a fallback). The scene texts below are the script that was recorded.

Run: python scripts/make_demo_voice.py (needs OPENAI_API_KEY in .env, costs a few cents). Rewrites the mp3 files and demoManifest.json.

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

VOICE = os.environ.get("DEMO_VOICE", "marin")
MODEL = os.environ.get("DEMO_TTS_MODEL", "gpt-4o-mini-tts")
INSTR = ("Voice: a warm, confident founder on stage at a hackathon, telling the story to people they like. Natural and conversational, "
         "never robotic or announcer-like. Vary your pitch and pace. Slow down and lean in on the key numbers and on short punchy lines "
         "such as 'They're not.' and 'No.' Speed up slightly through the lists. Use real pauses at commas and full stops, and a "
         "small breath between thoughts. Sound like you are thinking and speaking, not reading. Friendly, a little dry humour, no hype.")

# id, spotlight selector, sheet tab (or None), short caption, narration
SCENES = [
    ("problem", '[data-demo="problem"]', None, "The problem",
     "It's Sunday, eight p.m. Trucks leave Hamburg with the biggest game of the year. Soony's sheet says the cards are fine. "
     "They're not. Our agent found six thousand eight hundred copies short."),
    ("parts", '[data-demo="parts"]', None, "What is short",
     "Every copy is a kit. The Collector's edition has eight parts, and the red ones are what's missing: game cards, art books, the statue."),
    ("agent", '[data-demo="agent"]', 'agent', "The agent at work",
     "Nobody clicked anything. The agent started on its own. It reads the records, finds conflicts and a supplier hold, "
     "compares transport, and drafts the messages. It reads, calculates and drafts. It never sends, pays or books."),
    ("map", '[data-demo="map"]', None, "The supply network",
     "Here's the network. Solid lines are air, dashed lines are sea. And the red markers? Shipments that won't make Sunday."),
    ("transport", '[data-demo="transport"]', None, "Transport options",
     "Can we fly it in? No. Even air is four days late. These costs are estimates, and we say so. A faster flight isn't the answer."),
    ("whatif", '[data-demo="whatif"]', None, "What if parts arrive sooner?",
     "There's also a what-if slider. If the parts land sooner, how many copies still ship? It's a calculation, not a guess."),
    ("decision", '[data-demo="decision"]', None, "The decision",
     "The answer is Boise. Thirty-six thousand cards are packed and on hold, because our order and their agreement disagree on delivery terms. "
     "That's over five times the gap, and it's Doctor Maren Vogt's call."),
    ("escalation", '[data-demo="escalation"]', 'messages', "Approve the escalation",
     "Two messages need a human. One is the escalation for Doctor Vogt, with every number checked by code. The agent can't send it. "
     "A named person reads it, types their name, and approves. Two steps."),
    ("email", '[data-demo="email"]', 'messages', "Approve the email",
     "The other is the email to Boise. Same rule: a human approves, then sends it from their own inbox. "
     "Boise's reply comes back as a file, and a person reviews it before any number changes."),
    ("tracking", '[data-demo="tracking"]', None, "Launch tracking",
     "You can follow it all like a parcel: data in, problem found, plan, approval, sent, reply. Right now, it's waiting for you."),
    ("close", '[data-demo="problem"]', None, "Launch Control",
     "That's Launch Control. It reads the mess, finds what breaks, and keeps a human in charge."),
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
