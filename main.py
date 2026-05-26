from fastapi import FastAPI, UploadFile, File
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
import random

app = FastAPI()

app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
def read_index():
    return FileResponse("static/index.html")

CLASSES = [
    "Avulsion fracture",
    "Comminuted fracture",
    "Fracture Dislocation",
    "Greenstick fracture",
    "Hairline Fracture",
    "Impacted fracture",
    "Longitudinal fracture",
    "Oblique fracture",
    "Pathological fracture",
    "Spiral Fracture"
]

@app.post("/analyze")
async def analyze(file: UploadFile = File(...)):
    probs = [random.random() for _ in CLASSES]
    s = sum(probs)
    probs = [p/s for p in probs]
    return JSONResponse({
        "predictions": dict(zip(CLASSES, probs)),
        "clinical_description": "Demo result"
    })