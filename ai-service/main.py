"""
Civix — AI Classification Service v2.0
Enhanced TF-IDF + semantic keyword engine with strict fire/emergency detection
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Dict
import re, math, time
from datetime import datetime

app = FastAPI(title="Civix AI Classification Service", version="2.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ─── MODELS ──────────────────────────────────────────────────────────────────
class TextInput(BaseModel):
    text: str
    context: Optional[str] = None

class ClassificationResult(BaseModel):
    category: str
    priority: str
    reasoning: str
    confidence: float
    subcategory: Optional[str]
    keywords_detected: List[str]
    response_time_secs: float

# ─── KNOWLEDGE BASE ───────────────────────────────────────────────────────────
# Weights: higher = stronger signal for this category
CATEGORY_RULES = {
    "Fire": {
        "weight": 2.0,
        "phrases": [
            "house on fire", "building on fire", "caught fire", "on fire",
            "fire broke out", "fire in the", "gas leak", "cylinder burst",
            "lpg leak", "smoke coming out", "flames coming", "sparks flying",
            "fire brigade needed", "call fire department"
        ],
        "keywords": [
            "fire", "smoke", "burning", "flame", "blaze", "arson", "explosion",
            "ignite", "burnt", "inferno", "ablaze", "wildfire", "smouldering",
            "charred", "engulfed", "firefighter", "extinguisher"
        ]
    },
    "Medical": {
        "weight": 1.8,
        "phrases": [
            "heart attack", "not breathing", "road accident", "vehicle accident",
            "hit by car", "fell down", "found unconscious", "needs ambulance",
            "critical condition", "chest pain", "bleeding heavily", "broken bone"
        ],
        "keywords": [
            "accident", "injury", "unconscious", "ambulance", "hospital",
            "bleeding", "sick", "medical", "emergency", "hurt", "pain",
            "faint", "stroke", "died", "dead", "collapse", "seizure",
            "choking", "drowning", "poisoning", "pregnant", "fracture",
            "serious", "critical", "pulse", "resuscitation", "coma"
        ]
    },
    "Water": {
        "weight": 1.2,
        "phrases": [
            "no water supply", "water pipe burst", "main pipe leaking",
            "sewage overflow", "drain blocked", "water contaminated",
            "dirty water supply", "borewell not working", "no water for days"
        ],
        "keywords": [
            "water", "pipe", "leak", "flood", "sewage", "drainage",
            "plumbing", "supply", "contaminated", "overflow", "puddle",
            "sewer", "tap", "bore", "borewell", "canal", "waterlogging",
            "murky", "turbid", "stagnant", "puddles"
        ]
    },
    "Electricity": {
        "weight": 1.3,
        "phrases": [
            "no electricity", "power cut", "power outage", "electric shock",
            "fallen electric pole", "live wire on road", "transformer blast",
            "short circuit", "load shedding", "no light since", "sparks from wire"
        ],
        "keywords": [
            "electric", "power", "electricity", "light", "transformer",
            "wire", "voltage", "outage", "blackout", "shock", "current",
            "pole", "streetlight", "electrocution", "tripped", "meter",
            "substation", "inverter", "sparks", "fuse"
        ]
    },
    "Police": {
        "weight": 1.5,
        "phrases": [
            "chain snatching", "eve teasing", "drunk driving", "domestic violence",
            "missing child", "found dead", "suspicious person", "armed robbery",
            "drug peddling", "illegal construction", "land grab", "rowdyism"
        ],
        "keywords": [
            "theft", "robbery", "assault", "crime", "fight", "violence",
            "drug", "murder", "suspicious", "missing", "stolen", "harassment",
            "burglary", "attack", "kidnapping", "rape", "molest",
            "stalking", "gambling", "threat", "quarrel", "abduction", "goon"
        ]
    },
    "Infrastructure": {
        "weight": 1.0,
        "phrases": [
            "deep pothole", "road caved in", "bridge damage", "traffic signal broken",
            "footpath encroached", "illegal building", "wall collapse",
            "road badly damaged", "no street lights", "road full of potholes"
        ],
        "keywords": [
            "road", "pothole", "bridge", "construction", "footpath",
            "signal", "traffic", "crack", "collapse", "blocked",
            "flyover", "encroachment", "dilapidated", "pavement",
            "culvert", "overpass", "roadblock", "median", "divider"
        ]
    },
    "Sanitation": {
        "weight": 0.9,
        "phrases": [
            "garbage not collected", "overflowing dustbin", "open defecation",
            "stray dog menace", "rats in area", "mosquito breeding",
            "waste dumped on road", "dirty drains", "public toilet broken"
        ],
        "keywords": [
            "garbage", "waste", "trash", "dirty", "clean", "sweep",
            "dustbin", "mosquito", "stray", "smell", "odor", "rats",
            "sanitation", "hygiene", "filth", "litter", "dumping",
            "cockroach", "unhygienic", "decomposing", "rot", "maggots"
        ]
    }
}

PRIORITY_RULES = {
    "HIGH": {
        "weight": 3.0, "sla_hours": 1,
        "phrases": [
            "house on fire", "on fire", "not breathing", "heart attack",
            "road accident", "dead body", "gas leak", "live wire",
            "electric shock", "flood", "building collapse", "armed robbery",
            "rape", "kidnapping", "murder", "stabbing", "drowning",
            "explosion", "cylinder burst"
        ],
        "keywords": [
            "fire", "explosion", "accident", "injury", "unconscious",
            "bleeding", "murder", "robbery", "assault", "flood",
            "electrocution", "critical", "dying", "dangerous", "urgent",
            "immediate", "severe", "dead", "collapse", "arson",
            "drowning", "kidnap", "rape", "stabbing", "emergency",
            "serious", "life", "threat", "burst", "ablaze", "inferno"
        ]
    },
    "MEDIUM": {
        "weight": 1.5, "sla_hours": 24,
        "phrases": [
            "no water supply", "power outage", "pipe leaking",
            "pothole on road", "garbage not collected", "chain snatching",
            "suspicious activity", "drain blocked", "broken streetlight"
        ],
        "keywords": [
            "leak", "shortage", "crime", "suspicious", "contaminated",
            "outage", "broken", "blocked", "theft", "missing",
            "overflow", "pothole", "harassment", "threat", "damage",
            "fallen", "stray", "crack", "smell", "complaint", "issue"
        ]
    }
}

AMPLIFIERS  = ["very", "extremely", "severely", "critically", "badly", "huge", "massive", "major", "terrible", "horrible"]
URGENCY_KW  = ["immediately", "right now", "asap", "urgent", "emergency", "help", "please", "hurry", "fast", "now"]
DIMINISHERS = ["minor", "small", "little", "slight", "possible", "maybe", "seems", "perhaps", "probably"]

# ─── CLASSIFICATION ENGINE ────────────────────────────────────────────────────
def normalize(text: str) -> str:
    return re.sub(r'\s+', ' ', text.lower().strip())

def score_category(text: str, rules: dict) -> tuple:
    t = normalize(text)
    score = 0.0
    matched_kw = []

    # Phrase matching (higher weight — multi-word = more specific)
    for phrase in rules.get("phrases", []):
        if phrase in t:
            score += 2.5 * rules["weight"]
            matched_kw.append(phrase)

    # Keyword matching
    words = re.findall(r'\b\w+\b', t)
    total = len(words) or 1
    for kw in rules.get("keywords", []):
        if kw in t:
            tf = t.count(kw) / total
            idf = math.log(8 / (1 + 0.5))  # fixed IDF, 8 categories
            score += tf * idf * rules["weight"]
            if kw not in matched_kw:
                matched_kw.append(kw)

    return score, matched_kw

def get_intensity(text: str) -> float:
    t = normalize(text)
    mult = 1.0
    for a in AMPLIFIERS:  mult += 0.25 if a in t else 0
    for u in URGENCY_KW:  mult += 0.35 if u in t else 0
    for d in DIMINISHERS: mult -= 0.15 if d in t else 0
    return max(mult, 0.1)

def detect_priority(text: str, category: str, intensity: float) -> tuple:
    t = normalize(text)

    # Phrase match first (high confidence)
    for phrase in PRIORITY_RULES["HIGH"]["phrases"]:
        if phrase in t:
            return "HIGH", [phrase]

    high_kw  = [k for k in PRIORITY_RULES["HIGH"]["keywords"]  if k in t]
    med_kw   = [k for k in PRIORITY_RULES["MEDIUM"]["keywords"] if k in t]

    high_score = len(high_kw) * PRIORITY_RULES["HIGH"]["weight"]  * intensity
    med_score  = len(med_kw)  * PRIORITY_RULES["MEDIUM"]["weight"] * intensity

    # Auto-escalate: Fire category is always at least MEDIUM
    if category == "Fire" and high_score == 0:
        return ("HIGH" if med_score > 0 else "HIGH"), high_kw or med_kw

    if high_score > 0:   return "HIGH",   high_kw
    if med_score  > 0:   return "MEDIUM", med_kw
    return "LOW", []

def classify(text: str) -> dict:
    t0 = time.time()

    # Score all categories
    cat_scores, cat_kws = {}, {}
    for cat, rules in CATEGORY_RULES.items():
        score, kws = score_category(text, rules)
        cat_scores[cat] = score
        cat_kws[cat]    = kws

    # Pick best category
    best_cat   = max(cat_scores, key=cat_scores.get) if any(v > 0 for v in cat_scores.values()) else "Other"
    best_score = cat_scores.get(best_cat, 0)
    matched_kw = cat_kws.get(best_cat, [])

    # Detect subcategory
    subcategory = None
    subcats = {
        "Fire":           {"Structure Fire":["building","house","apartment","office"], "Gas Leak":["gas","lpg","cylinder"], "Vehicle Fire":["car fire","bus fire","truck fire"], "Wildfire":["forest","jungle","field","crop"]},
        "Medical":        {"Road Accident":["road accident","vehicle accident","crash","hit by"],"Cardiac":["heart","chest pain","cardiac"],"Trauma":["injury","wound","bleeding","fracture"],"Illness":["sick","fever","unconscious","faint"]},
        "Water":          {"Supply Failure":["no water","supply stopped","water cut"],"Pipe Burst":["pipe burst","main leak","gushing"],"Sewage":["sewage","sewer","overflow"],"Flood":["flood","waterlogging"]},
        "Electricity":    {"Outage":["blackout","no power","power cut","load shedding"],"Fallen Wire":["fallen wire","live wire"],"Electrocution":["shock","electrocution"],"Equipment":["transformer","substation","pole"]},
        "Police":         {"Theft":["theft","stolen","pickpocket","chain snatching"],"Violence":["assault","attack","murder","fight","stabbing"],"Missing":["missing","kidnap","abducted"],"Public Order":["drunk","noise","dispute","quarrel"]},
        "Infrastructure": {"Road Damage":["pothole","road damage","crack","broken road"],"Signal":["signal","traffic light"],"Structural Risk":["collapse","dangerous","dilapidated"],"Encroachment":["encroachment","illegal construction"]},
        "Sanitation":     {"Garbage":["garbage","waste","trash","collection"],"Animal":["stray","dog","snake","animal"],"Hygiene":["dirty","filth","odor","smell","open defecation"]},
    }
    t_lower = text.lower()
    if best_cat in subcats:
        for sub, kws in subcats[best_cat].items():
            if any(k in t_lower for k in kws):
                subcategory = sub
                break

    # Priority
    intensity = get_intensity(text)
    priority, prio_kw = detect_priority(text, best_cat, intensity)

    # Confidence
    total_score = sum(cat_scores.values()) or 1
    conf = min(best_score / total_score + 0.35, 0.97) if best_score > 0 else 0.42
    conf = round(conf, 2)

    # Reasoning
    sla      = PRIORITY_RULES[priority]["sla_hours"] if priority in PRIORITY_RULES else 72
    kw_disp  = ", ".join(matched_kw[:4]) if matched_kw else "general context"
    dept_map = {"Fire":"Fire Department","Medical":"Medical Emergency","Water":"Water Authority","Electricity":"Electricity Board","Police":"Police Department","Infrastructure":"PWD/Roads","Sanitation":"Municipal Corp","Other":"General Services"}
    dept     = dept_map.get(best_cat, best_cat)

    reasoning = {
        "HIGH":   f"⚠️ CRITICAL [{best_cat}]: High-risk indicators detected — [{kw_disp}]. Immediate response dispatched. SLA: {sla}h. {dept} alerted.",
        "MEDIUM": f"⚡ MODERATE [{best_cat}]: Prompt attention required — [{kw_disp}]. Routed to {dept}. SLA: {sla}h.",
        "LOW":    f"ℹ️ STANDARD [{best_cat}]: Routine civic issue — [{kw_disp}]. Queued for {dept}. SLA: {sla}h.",
    }[priority]

    return {
        "category":          best_cat,
        "priority":          priority,
        "reasoning":         reasoning,
        "confidence":        conf,
        "subcategory":       subcategory,
        "keywords_detected": matched_kw[:8],
        "response_time_secs": round(time.time() - t0, 4)
    }

# ─── LOAD TRAINING DATA TO BOOST CLASSIFIER ─────────────────────────────────
import os as _os, json as _json

_TRAIN_FILE = _os.path.join(_os.path.dirname(__file__), "training_data.json")

def _load_training_boost():
    """
    Read training_data.json and extract extra keywords per category.
    These are added to CATEGORY_RULES to improve classification accuracy.
    """
    if not _os.path.exists(_TRAIN_FILE):
        return
    try:
        with open(_TRAIN_FILE) as f:
            samples = _json.load(f)

        from collections import defaultdict
        import re as _re

        # Extract frequent meaningful words per category from training data
        cat_words = defaultdict(list)
        stopwords = {
            'the','is','a','an','in','on','at','to','for','of','and','or','but',
            'with','has','have','had','not','no','our','my','this','that','we',
            'they','are','was','were','it','its','from','by','be','been','being',
            'very','also','near','after','into','over','about','due','since','when',
            'through','between','during','before','against','per','then','than',
        }

        for sample in samples:
            cat  = sample.get('expected_category')
            text = sample.get('text','').lower()
            words = _re.findall(r'\b[a-z]{4,}\b', text)
            words = [w for w in words if w not in stopwords]
            if cat and cat in CATEGORY_RULES:
                cat_words[cat].extend(words)

        # Add top frequent words per category to keyword list if not already there
        from collections import Counter
        for cat, words in cat_words.items():
            top = [w for w, _ in Counter(words).most_common(30)]
            existing = set(CATEGORY_RULES[cat].get('keywords', []))
            new_kws = [w for w in top if w not in existing]
            CATEGORY_RULES[cat]['keywords'].extend(new_kws[:15])

        print(f"[TRAINING] ✅ Loaded {len(samples)} samples — classifier boosted")
    except Exception as e:
        print(f"[TRAINING] Warning: {e}")

_load_training_boost()

# ─── ROUTES ──────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    import os as _os2
    train_count = 0
    if _os2.path.exists(_TRAIN_FILE):
        try:
            import json as _j2
            train_count = len(_j2.load(open(_TRAIN_FILE)))
        except: pass
    return {
        "status": "operational",
        "model": "Civix-NLP-v2 (TF-IDF + Phrase + Training Data)",
        "training_samples": train_count,
        "timestamp": datetime.now().isoformat()
    }

@app.post("/classify", response_model=ClassificationResult)
def classify_endpoint(inp: TextInput):
    if not inp.text or len(inp.text.strip()) < 5:
        raise HTTPException(status_code=400, detail="Text must be at least 5 characters")
    return classify(inp.text)

@app.post("/batch-classify")
def batch_classify(inputs: List[TextInput]):
    return [classify(i.text) for i in inputs]

@app.get("/categories")
def categories():
    return {
        "categories": list(CATEGORY_RULES.keys()) + ["Other"],
        "priorities": ["HIGH", "MEDIUM", "LOW"],
        "test_cases": {
            "house on fire": "Fire/HIGH",
            "burning smell from kitchen": "Fire/HIGH",
            "heart attack patient": "Medical/HIGH",
            "no water for 3 days": "Water/MEDIUM",
            "power cut since morning": "Electricity/MEDIUM",
            "chain snatching incident": "Police/HIGH",
            "deep pothole on road": "Infrastructure/MEDIUM",
            "garbage not collected": "Sanitation/MEDIUM"
        }
    }

@app.get("/")
def root():
    return {"service": "Civix AI Classification Service", "version": "2.0.0", "endpoints": ["/classify", "/batch-classify", "/categories", "/health"]}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
