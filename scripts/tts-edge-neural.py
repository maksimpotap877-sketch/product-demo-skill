"""Small JSON-over-stdin wrapper around the unmodified, pinned upstream edge-tts client."""
import argparse
import asyncio
import importlib.metadata
import json
import pathlib
import sys

sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")


async def main():
    import edge_tts
    parser = argparse.ArgumentParser()
    parser.add_argument("--action", choices=["version", "voices", "synthesize"], required=True)
    args = parser.parse_args()
    version = importlib.metadata.version("edge-tts")
    if args.action == "version":
        return {"version": version}
    if args.action == "voices":
        voices = await edge_tts.list_voices()
        return {"version": version, "voices": [v for v in voices if v.get("Locale") == "ru-RU"]}
    request = json.load(sys.stdin)
    text = request.get("text", "")
    if not isinstance(text, str) or not text.strip() or len(text) > 5000:
        raise ValueError("Invalid speech text length")
    if request.get("allowExternalTts") is not True:
        raise ValueError("External speech transmission was not authorized")
    voice = request.get("voiceId")
    # Exact IDs must first be confirmed through the live service catalogue.
    if voice not in ("ru-RU-SvetlanaNeural", "ru-RU-DmitryNeural"):
        raise ValueError("Unsupported verified Russian neural voice")
    rate = request.get("speechRatePercent", 0)
    if isinstance(rate, bool) or not isinstance(rate, int) or abs(rate) > 10:
        raise ValueError("Unsupported delivery rate")
    output = pathlib.Path(request["outputPath"])
    output.parent.mkdir(parents=True, exist_ok=True)
    communicate = edge_tts.Communicate(text, voice, rate=f"{rate:+d}%", pitch="+0Hz", volume="+0%", connect_timeout=10, receive_timeout=45)
    marks = []
    with output.open("wb") as stream:
        async for message in communicate.stream():
            if message["type"] == "audio":
                stream.write(message["data"])
            elif message["type"] in ("WordBoundary", "SentenceBoundary"):
                marks.append({"kind": message["type"], "offsetMs": message["offset"] / 10000, "durationMs": message["duration"] / 10000, "text": message["text"]})
    return {"status": "passed", "version": version, "voiceId": voice, "providerMarks": marks, "outputBytes": output.stat().st_size, "synthesisRequests": 1}


try:
    print(json.dumps(asyncio.run(main()), ensure_ascii=False))
except Exception as error:
    # Service URLs, client headers, submitted text and secrets never enter error logs.
    print(json.dumps({"status": "blocked", "errorType": type(error).__name__, "message": "Neural TTS request failed; no fallback voice was substituted."}), file=sys.stderr)
    sys.exit(1)
