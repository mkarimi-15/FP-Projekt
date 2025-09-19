import os
import io
import numpy as np
from PIL import Image
from datetime import datetime

os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"
import tensorflow as tf  # noqa: F401

from flask import Flask, render_template, request, jsonify
from deepface import DeepFace

DETECTOR_BACKEND = os.environ.get("DETECTOR_BACKEND", "retinaface")

app = Flask(__name__)


# ---- Helpers ----
def analyze_image_properties(pil_image: Image.Image):
    img_array = np.array(pil_image.convert("RGB"))
    width, height = pil_image.size
    file_size_kb = len(pil_image.tobytes()) / 1024.0
    brightness = float(np.mean(img_array)) / 255.0
    contrast = float(np.std(img_array)) / 255.0
    return {
        "dimensions": f"{width} × {height} px",
        "color_mode": pil_image.mode,
        "file_size_kb": round(file_size_kb, 2),
        "brightness": round(brightness * 100, 2),
        "contrast": round(contrast * 100, 2),
        "aspect_ratio": round(width / height, 4) if height else None,
        "resolution_mp": round((width * height) / 1_000_000.0, 3),
    }


def deepface_actions(include_race: bool):
    actions = ["age", "gender", "emotion"]
    if include_race:
        actions.append("race")
    return actions


def deepface_analyze_compat(np_img, actions, detector_backend):
    try:
        return DeepFace.analyze(
            img_path=np_img,
            actions=actions,
            detector_backend=detector_backend,
            enforce_detection=False,
            prog_bar=False,
        )
    except TypeError:
        return DeepFace.analyze(
            img_path=np_img,
            actions=actions,
            detector_backend=detector_backend,
            enforce_detection=False,
        )


def to_serializable(obj):
    """Recursively convert NumPy types → native Python."""
    if isinstance(obj, dict):
        return {k: to_serializable(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [to_serializable(v) for v in obj]
    elif isinstance(obj, (np.integer,)):
        return int(obj)
    elif isinstance(obj, (np.floating,)):
        return float(obj)
    elif isinstance(obj, (np.ndarray,)):
        return obj.tolist()
    else:
        return obj


# ---- Routes ----
@app.route("/")
def index():
    return render_template("index.html", now=datetime.utcnow())


@app.route("/analyze", methods=["POST"])
def analyze():
    if "image" not in request.files:
        return jsonify({"error": "No file part 'image' in request."}), 400

    f = request.files["image"]
    if f.filename == "":
        return jsonify({"error": "No selected file."}), 400

    try:
        include_race = request.form.get("include_race", "false").lower() == "true"
        detector_backend = request.form.get("detector", DETECTOR_BACKEND)

        img_bytes = f.read()
        pil_img = Image.open(io.BytesIO(img_bytes)).convert("RGB")

        props = analyze_image_properties(pil_img)
        np_img = np.array(pil_img)

        actions = deepface_actions(include_race)
        results = deepface_analyze_compat(np_img, actions, detector_backend)

        faces = [results] if isinstance(results, dict) else results
        parsed = []

        for i, face in enumerate(faces, start=1):
            region = face.get("region") or face.get("facial_area") or {}
            x = int(region.get("x", 0))
            y = int(region.get("y", 0))
            w = int(region.get("w", 0)) or int(region.get("width", 0) or 0)
            h = int(region.get("h", 0)) or int(region.get("height", 0) or 0)

            emotions = face.get("emotion", {}) or {}
            dominant_emotion = face.get("dominant_emotion")
            if not dominant_emotion and emotions:
                dominant_emotion = max(emotions.items(), key=lambda kv: kv[1])[0]

            gender_val = face.get("gender")
            if isinstance(gender_val, dict):
                gender = max(gender_val.items(), key=lambda kv: kv[1])[0]
                gender_conf = max(gender_val.values())
            else:
                gender = str(gender_val) if gender_val is not None else None
                gender_conf = face.get("gender_confidence", None)

            one = {
                "face_id": i,
                "box": {"x": x, "y": y, "w": w, "h": h},
                "age": int(face.get("age")) if face.get("age") is not None else None,
                "gender": gender,
                "gender_confidence": gender_conf,
                "emotions": emotions,
                "dominant_emotion": dominant_emotion,
            }

            if include_race:
                race_scores = face.get("race", {}) or {}
                dominant_race = face.get("dominant_race")
                if not dominant_race and race_scores:
                    dominant_race = max(race_scores.items(), key=lambda kv: kv[1])[0]
                one.update({"race": race_scores, "dominant_race": dominant_race})

            parsed.append(one)

        # Ensure everything is JSON-safe
        return jsonify(to_serializable({
            "ok": True,
            "detector": detector_backend,
            "properties": props,
            "faces": parsed,
        }))

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/health")
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=3000, debug=True)
